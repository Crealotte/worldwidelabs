// lib/nightly.js — lets a leader switch on the nightly saving of their faction's gym counters and upgrade
// levels WITHOUT anyone touching Vercel: the leader presses a button while logged in, and their own (Limited)
// API key is kept on the server, encrypted, and used once a night by the cron job (see vercel.json) to read the
// same things the app reads when a leader opens it. Nothing is ever shown to anyone, the key is only used for
// that one job (and the owner's read-only look at the faction's Member Overview and Who's on board, which the leaders are told about), and it stops when the leader turns it off or deletes the key in Torn.
//
// The key is encrypted with a secret derived from the database token, which lives only in Vercel — so a copy of
// the stored data alone can't be read. One key is kept per faction (a new one replaces the old).

const crypto = require('crypto');
const { steadfastRefresh } = require('./steadfast');

const VAULT = 'wwl:snapshot-vault'; // hash: factionId -> { enc, playerId, name, since, lastRun, lastOk, lastError }

function secret() {
    return crypto.createHash('sha256').update(`${process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || ''}|wwl-vault`).digest();
}
function encrypt(text) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', secret(), iv);
    const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
function decrypt(b64) {
    const buf = Buffer.from(b64, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', secret(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

async function nightlyHandle(action, { redis, key, factionId, playerId, name }) {
    if (action === 'nightly-status') {
        const raw = await redis(['HGET', VAULT, factionId]);
        if (!raw) return { enabled: false };
        const e = JSON.parse(raw);
        return { enabled: true, by: e.name, since: e.since, lastRun: e.lastRun || null, lastOk: e.lastOk ?? null, lastError: e.lastError || null };
    }
    if (action === 'nightly-enable') {
        await steadfastRefresh({ redis, key, factionId, force: true }); // proves the key can read what the job needs (throws if not)
        const now = Math.floor(Date.now() / 1000);
        await redis(['HSET', VAULT, factionId, JSON.stringify({ enc: encrypt(key), playerId, name, since: now, lastRun: now, lastOk: true })]);
        return { enabled: true, by: name, since: now, lastRun: now, lastOk: true };
    }
    if (action === 'nightly-disable') {
        await redis(['HDEL', VAULT, factionId]);
        return { enabled: false };
    }
    throw new Error('Unknown action');
}

// Used by the cron job: every faction that switched it on, with its key decrypted, and a way to note how it went.
async function nightlyRun(redis, extraKeys, getProfile, afterRefresh) {
    const results = [];
    const flat = (await redis(['HGETALL', VAULT])) || [];
    for (let i = 0; i < flat.length; i += 2) {
        const factionId = flat[i];
        let entry; try { entry = JSON.parse(flat[i + 1]); } catch (e) { continue; }
        const now = Math.floor(Date.now() / 1000);
        try {
            const plainKey = decrypt(entry.enc);
            await steadfastRefresh({ redis, key: plainKey, factionId, force: true });
            if (afterRefresh) { try { entry.tracking = await afterRefresh(plainKey, factionId); } catch (e) { entry.tracking = { error: String(e.message || e).slice(0, 60) }; } } // respect tracker catch-up; a failure here never marks the saving itself as failed
            entry.lastRun = now; entry.lastOk = true; entry.lastError = null;
            results.push({ ok: true, faction: factionId });
        } catch (e) {
            entry.lastRun = now; entry.lastOk = false; entry.lastError = String(e.message || e).slice(0, 120);
            results.push({ ok: false, faction: factionId, error: entry.lastError });
        }
        await redis(['HSET', VAULT, factionId, JSON.stringify(entry)]);
    }
    for (const k of extraKeys) { // keys set in Vercel (WWL_SNAPSHOT_KEYS) still work as an extra
        try {
            const p = await getProfile(k);
            if (!p) { results.push({ ok: false, error: 'key not usable' }); continue; }
            await steadfastRefresh({ redis, key: k, factionId: p.factionId, force: true });
            results.push({ ok: true, faction: p.factionId, via: 'env' });
        } catch (e) { results.push({ ok: false, error: String(e.message || e).slice(0, 120) }); }
    }
    return results;
}

// The leader key kept for the nightly job, decrypted — used for things only a leader key can read, such as every member's
// faction-vault balance (bank requests). null when nightly saving was never switched on for this faction.
async function getVaultKey(redis, factionId) {
    const raw = await redis(['HGET', VAULT, factionId]);
    if (!raw) return null;
    try { return decrypt(JSON.parse(raw).enc); } catch (e) { return null; }
}

module.exports = { nightlyHandle, nightlyRun, getVaultKey };
