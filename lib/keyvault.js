// lib/keyvault.js — optional storage of a member's own Torn API key, encrypted, so the server can read that member's own data (for example their City Bank) when they are not on the site.
//
//   * Opt-in only: the member ticks the consent and presses "Store my key"; "Delete my key" removes it at once. Nothing is stored for anybody who did not do that.
//   * The secret that encrypts the keys is WWL_VAULT_SECRET (a Vercel environment variable, at least 32 characters). It is NOT in the database, the code or the browser. Without it the feature is off:
//     nothing can be stored and nothing is decrypted. (The older faction nightly vault in lib/nightly.js has its own, database-token based secret and is left as it is.)
//   * AES-256-GCM with a new random IV for every key. Stored value: "v1:<iv>:<tag>:<ciphertext>" (base64). The "v1" prefix lets a later secret or format live next to old rows.
//   * A key is only decrypted on the server, right before a call to Torn. It is never sent to a browser, never logged, and the member only ever sees a short preview (ab…yz).
//
//   wwl:memberkeys -> hash: playerId -> JSON { enc, preview, since, name, factionId, access, lastUsed, lastOk }

const crypto = require('crypto');

const HASH = 'wwl:memberkeys';
const secretKey = () => { const s = process.env.WWL_VAULT_SECRET; return s && String(s).length >= 32 ? crypto.createHash('sha256').update(`${s}|wwl-memberkeys`).digest() : null; };
const available = () => !!secretKey();
const b64 = b => b.toString('base64');

function encrypt(text) {
    const k = secretKey();
    if (!k) throw new Error('Key storage is not switched on yet (the server secret is missing).');
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', k, iv);
    const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
    return `v1:${b64(iv)}:${b64(c.getAuthTag())}:${b64(ct)}`;
}
function decrypt(value) {
    const [ver, iv, tag, ct] = String(value || '').split(':');
    if (ver !== 'v1') throw new Error('Unknown key format.');
    const k = secretKey();
    if (!k) throw new Error('Key storage is not switched on (the server secret is missing).');
    const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}
const preview = k => `${String(k).slice(0, 2)}…${String(k).slice(-2)}`;
const readEntry = async (redis, playerId) => { try { const raw = await redis(['HGET', HASH, String(playerId)]); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } };

// What the server uses: the decrypted key of one member, or null (not opted in, secret missing, or unreadable). Never hand the result to a browser or a log.
async function getStoredKey(redis, playerId) {
    if (!available()) return null;
    const e = await readEntry(redis, playerId);
    if (!e || !e.enc) return null;
    try { return decrypt(e.enc); } catch (err) { return null; }
}
// note how it went (so the member can see "last used" and a revoked key shows up)
async function noteUsed(redis, playerId, ok) {
    const e = await readEntry(redis, playerId);
    if (!e) return;
    e.lastUsed = Math.floor(Date.now() / 1000); e.lastOk = !!ok;
    await redis(['HSET', HASH, String(playerId), JSON.stringify(e)]);
}

// the member's own actions: mkey-status, mkey-save (stores the key they are logged in with), mkey-delete
async function mkeyHandle(action, body, { redis, who, key }) {
    const pid = String(who.playerId);
    if (action === 'mkey-status') {
        const e = await readEntry(redis, pid);
        return { available: available(), enabled: !!(e && e.enc), preview: e ? e.preview : '', since: e ? e.since : null, access: e ? e.access || '' : '', lastUsed: e ? e.lastUsed || null : null, lastOk: e && e.lastOk !== undefined ? e.lastOk : null };
    }
    if (action === 'mkey-save') {
        if (!available()) throw new Error('Key storage is not switched on yet.');
        if (body.accept !== true) throw new Error('Read the explanation and tick that you accept it.');
        if (typeof key !== 'string' || !/^[A-Za-z0-9]{16}$/.test(key)) throw new Error('This does not look like a Torn API key.');
        let access = '';
        try { const r = await fetch(`https://api.torn.com/key/?selections=info&key=${encodeURIComponent(key)}`), j = await r.json(); if (!j.error) access = String(j.access_type || j.access_level || '').slice(0, 30); } catch (e) { /* the access level is only for showing */ }
        const now = Math.floor(Date.now() / 1000);
        await redis(['HSET', HASH, pid, JSON.stringify({ enc: encrypt(key), preview: preview(key), since: now, name: String(who.name || '').slice(0, 60), factionId: who.factionId || '', access })]);
        return { ok: true, enabled: true, preview: preview(key), since: now, access };
    }
    if (action === 'mkey-delete') {
        await redis(['HDEL', HASH, pid]);
        return { ok: true, enabled: false };
    }
    throw new Error('Unknown action');
}

module.exports = { mkeyHandle, getStoredKey, noteUsed, available };
