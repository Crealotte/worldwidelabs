// lib/labsLedger.js — the Labs funds ledger, for the owner of all Labs.
//
// Every faction keeps a cut ("retained", 20% by default) out of each war's payout pool. This file
// keeps one running ledger of those cuts across ALL factions using the app, so the owner can see
// the money per faction and in total, plus the history of every war payout.
//
// The ledger is one Redis hash (`wwl:labs-ledger`, field = entry id, value = one JSON entry), so
// adding an entry never rewrites the others (no read-modify-write race between factions saving
// receipts at the same time). An entry is:
//   { id, factionKey, factionId, factionName, kind, amount, date, opponent, note, source, receiptId }
//   kind:   'war'    = a war's retained cut coming IN            (amount positive)
//           'spend'  = money the faction/owner took OUT / spent  (amount stored negative)
//           'adjust' = a manual correction                       (amount signed as typed)
//   source: 'auto' (saved automatically with a payout receipt), 'import' (pulled from receipts saved
//           before the ledger existed), or 'manual' (typed in by the owner, e.g. for the past)
//
// Who is the owner: see the OWNERS notes below. Leaders of any faction can view; only owners change.

const { tornFetch } = require('./tornFetch');
const LEDGER = 'wwl:labs-ledger';
const EXCLUDED = 'wwl:labs-excluded'; // factions the owner doesn't want counted as Labs (e.g. outside users of the app)

// Owners = the ones stored in the database (`wwl:labs-owners`, id -> name) plus, optionally, any
// player IDs in the WWL_OWNER_IDS env var. The very first leader to press "Claim ownership" while
// nobody is an owner yet becomes one; after that only an owner can add another.
const OWNERS = 'wwl:labs-owners';
const envOwners = () => (process.env.WWL_OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

async function ownerMap(redis) {
    const flat = (await redis(['HGETALL', OWNERS])) || [];
    const out = {};
    for (let i = 0; i < flat.length; i += 2) out[flat[i]] = flat[i + 1];
    return out;
}
async function labsIsOwner(redis, playerId) {
    if (envOwners().includes(String(playerId))) return true;
    return !!(await redis(['HEXISTS', OWNERS, String(playerId)]));
}
async function labsHasOwners(redis) {
    return envOwners().length > 0 || Object.keys(await ownerMap(redis)).length > 0;
}

const factionKeyOf = (factionId, factionName) => factionId ? String(factionId) : `name:${String(factionName || '').trim().toLowerCase()}`;

// Called whenever any faction saves a payout receipt — this is the "automated in the future" part.
// Keyed by receipt id, so saving the same receipt twice can't double count.
async function labsRecordReceipt(redis, { receiptId, factionId, factionName, receipt, source = 'auto' }) {
    const entry = {
        id: `r:${receiptId}`, factionKey: factionKeyOf(factionId), factionId: String(factionId), factionName: factionName || '',
        kind: 'war', amount: Math.round(Number(receipt.retained) || 0), date: receipt.warEnd || Math.floor(Date.now() / 1000),
        opponent: receipt.opponent || '', note: '', source, receiptId,
    };
    await redis(['HSET', LEDGER, entry.id, JSON.stringify(entry)]);
}

async function readAll(redis) {
    const flat = (await redis(['HGETALL', LEDGER])) || [];
    const entries = [];
    for (let i = 1; i < flat.length; i += 2) { try { entries.push(JSON.parse(flat[i])); } catch (e) { /* skip a corrupt row */ } }
    return entries;
}

async function factionNameFor(id, key) {
    try {
        const r = await tornFetch(`https://api.torn.com/faction/${encodeURIComponent(id)}?selections=basic&key=${encodeURIComponent(key)}`);
        const d = await r.json();
        return d.name || '';
    } catch (e) { return ''; }
}

// Pulls in receipts that were saved BEFORE the ledger existed (every faction's, found by scanning the
// receipt indexes). Safe to run repeatedly — existing entries are left alone.
async function importReceipts(redis, key) {
    const have = new Set((await readAll(redis)).map(e => e.id));
    const names = {};
    let cursor = '0', imported = 0, seen = 0;
    do {
        const [next, keys] = await redis(['SCAN', cursor, 'MATCH', 'wwl:receipts-index:*', 'COUNT', 200]);
        cursor = String(next);
        for (const k of keys) {
            const factionId = k.split(':').pop();
            const raw = await redis(['GET', k]);
            for (const item of (raw ? JSON.parse(raw) : [])) {
                seen++;
                if (have.has(`r:${item.id}`)) continue;
                const rr = await redis(['GET', `wwl:payout-receipt:${item.id}`]);
                if (!rr) continue;
                const receipt = JSON.parse(rr);
                if (!(factionId in names)) names[factionId] = await factionNameFor(factionId, key);
                await labsRecordReceipt(redis, { receiptId: item.id, factionId, factionName: names[factionId], receipt, source: 'import' });
                imported++;
            }
        }
    } while (cursor !== '0');
    return { imported, seen };
}

async function labsHandle(action, body, { redis, key, playerId, playerName }) {
    if (action === 'labs-claim') {
        if (await labsHasOwners(redis)) throw new Error('This already has an owner');
        await redis(['HSET', OWNERS, String(playerId), playerName || '']);
        return { ok: true };
    }

    if (action === 'labs-add-owner') {
        const id = String(body.playerId || '').replace(/\D/g, '');
        if (!id) throw new Error('Enter a Torn player ID (numbers only)');
        await redis(['HSET', OWNERS, id, String(body.playerName || '').slice(0, 40)]);
        return { ok: true };
    }

    if (action === 'labs-get') {
        const excludedFlat = (await redis(['HGETALL', EXCLUDED])) || [];
        const excluded = [];
        for (let i = 0; i < excludedFlat.length; i += 2) excluded.push(excludedFlat[i]);
        const entries = (await readAll(redis)).sort((a, b) => b.date - a.date);
        return { entries, excluded, owners: await ownerMap(redis) };
    }

    if (action === 'labs-add') {
        const factionName = String(body.factionName || '').trim().slice(0, 60);
        const factionId = String(body.factionId || '').replace(/\D/g, '');
        if (!factionName && !factionId) throw new Error('Pick or type a faction');
        const kind = ['war', 'spend', 'adjust'].includes(body.kind) ? body.kind : 'war';
        let amount = Math.round(Number(body.amount));
        if (!Number.isFinite(amount) || !amount) throw new Error('Enter an amount');
        if (kind === 'war') amount = Math.abs(amount);
        if (kind === 'spend') amount = -Math.abs(amount);
        const id = `m:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const entry = {
            id, factionKey: factionKeyOf(factionId, factionName), factionId, factionName, kind, amount,
            date: Number(body.date) || Math.floor(Date.now() / 1000),
            opponent: String(body.opponent || '').slice(0, 60), note: String(body.note || '').slice(0, 140), source: 'manual',
        };
        await redis(['HSET', LEDGER, id, JSON.stringify(entry)]);
        return { ok: true, entry };
    }

    if (action === 'labs-delete') {
        if (!body.id) throw new Error('Missing id');
        await redis(['HDEL', LEDGER, String(body.id)]);
        return { ok: true };
    }

    if (action === 'labs-exclude') {
        if (!body.factionKey) throw new Error('Missing faction');
        if (body.excluded) await redis(['HSET', EXCLUDED, String(body.factionKey), '1']);
        else await redis(['HDEL', EXCLUDED, String(body.factionKey)]);
        return { ok: true };
    }

    if (action === 'labs-import') return { ok: true, ...(await importReceipts(redis, key)) };

    throw new Error('Unknown action');
}

module.exports = { labsIsOwner, labsHasOwners, labsHandle, labsRecordReceipt };
