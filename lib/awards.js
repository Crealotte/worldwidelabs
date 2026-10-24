// lib/awards.js — the awards tracker (honors, medals, merits), like YATA's: the catalog of every award from Torn, which ones a member already has, the awards a member
// follows, and (next step) the progress of each award worked out from the member's own Torn stats.
//
//   wwl:aw:cat          JSON { at, items: [{ k: 'h12' | 'm34' | 'r5', t: 'honor' | 'medal' | 'merit', n: name, d: description, c: category, r: circulation, y: rarity }] }
//                       read from Torn (public key) when it is older than a week, by whoever asks first; kept in this server's memory for an hour
//   wwl:aw:follow       hash playerId -> JSON [award keys the member follows]
//
// Torn's own lists: v2 /torn/honors, /torn/medals, /torn/merits (public key, paged), /user/honors and /user/medals (the ones a member has).

const CAT = 'wwl:aw:cat', LOCK = 'wwl:aw:cat-lock', FOLLOW = 'wwl:aw:follow', WEEK = 7 * 86400000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let catMem = null, mineMem = new Map();

async function tornV2(path, key, params = '') {
    const r = await fetch(`https://api.torn.com/v2${path}?${params}${params ? '&' : ''}key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } });
    const d = await r.json();
    if (d.error) { const e = new Error(d.error.error || 'Torn did not answer'); e.code = d.error.code; throw e; }
    return d;
}
// a paged list from Torn: keeps asking until a page comes back short
async function pagedList(path, field, key) {
    const out = [], size = 100;
    for (let offset = 0; offset < 6000; offset += size) {
        const d = await tornV2(path, key, `limit=${size}&offset=${offset}`);
        const list = Array.isArray(d[field]) ? d[field] : Object.values(d[field] || {});
        out.push(...list);
        if (list.length < size) break;
        await sleep(350);
    }
    return out;
}
const clip = (s, n) => String(s == null ? '' : s).replace(/<[^>]*>/g, '').slice(0, n);

async function loadCatalog(redis, key) {
    if (catMem && Date.now() - catMem.at < 3600000) return catMem;
    let c = null; try { const raw = await redis(['GET', CAT]); c = raw ? JSON.parse(raw) : null; } catch (e) { c = null; }
    if (c && c.items && c.items.length && Date.now() - c.at < WEEK) { catMem = c; return c; }
    // older than a week (or never read): read it again, once for everybody
    const got = await redis(['SET', LOCK, '1', 'NX', 'EX', 120]);
    if (!got && c && c.items) { catMem = c; return c; } // somebody else is reading it: the old list is fine meanwhile
    try {
        const [honors, medals, merits] = [await pagedList('/torn/honors', 'honors', key), await pagedList('/torn/medals', 'medals', key), await pagedList('/torn/merits', 'merits', key)];
        const items = [
            ...honors.map(h => ({ k: 'h' + h.id, t: 'honor', n: clip(h.name, 80), d: clip(h.description, 240), c: clip(h.type && (h.type.title || h.type.id), 30) || 'Other', r: Number(h.circulation) || 0, y: clip(h.rarity, 20) })),
            ...medals.map(m => ({ k: 'm' + m.id, t: 'medal', n: clip(m.name, 80), d: clip(m.description, 240), c: clip(m.type && (m.type.title || m.type.id), 30) || 'Other', r: Number(m.circulation) || 0, y: clip(m.rarity, 20) })),
            ...merits.map(m => ({ k: 'r' + m.id, t: 'merit', n: clip(m.name, 80), d: clip(m.description, 240), c: 'Merits', r: 0, y: '' })),
        ];
        if (!items.length) throw new Error('Torn gave an empty list');
        c = { at: Date.now(), items };
        await redis(['SET', CAT, JSON.stringify(c)]);
        catMem = c;
        return c;
    } catch (e) {
        if (c && c.items) { catMem = c; return c; }
        throw e;
    } finally { try { await redis(['DEL', LOCK]); } catch (e) { /* the lock expires by itself */ } }
}

async function awHandle(action, body, { redis, playerId, key, owner }) {
    if (action === 'aw-catalog') {
        const c = await loadCatalog(redis, key);
        return { at: c.at, items: c.items };
    }
    if (action === 'aw-mine') { // which honors and medals this member already has (kept 10 minutes in memory)
        const hit = mineMem.get(playerId);
        if (hit && Date.now() - hit.at < 600000) return hit.v;
        const [h, m] = [await tornV2('/user/honors', key), await tornV2('/user/medals', key)];
        const v = { honors: (h.honors || []).map(x => x.id), medals: (m.medals || []).map(x => x.id), at: Date.now() };
        if (mineMem.size > 500) mineMem.clear();
        mineMem.set(playerId, { at: Date.now(), v });
        return v;
    }
    if (action === 'aw-follow-get') {
        let list = []; try { list = JSON.parse((await redis(['HGET', FOLLOW, playerId])) || '[]'); } catch (e) { list = []; }
        return { follow: list };
    }
    if (action === 'aw-follow-set') {
        const k = String(body.id || '').replace(/[^a-z0-9]/g, '').slice(0, 12);
        if (!/^[hmr]\d+$/.test(k)) throw new Error('Unknown award');
        let list = []; try { list = JSON.parse((await redis(['HGET', FOLLOW, playerId])) || '[]'); } catch (e) { list = []; }
        list = list.filter(x => x !== k);
        if (body.on) { if (list.length >= 150) throw new Error('You can follow up to 150 awards.'); list.push(k); }
        await redis(['HSET', FOLLOW, playerId, JSON.stringify(list)]);
        return { follow: list };
    }
    throw new Error('Unknown action');
}

module.exports = { awHandle, loadCatalog };
