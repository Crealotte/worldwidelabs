// lib/awards.js — the awards tracker (honors, medals, merits), like YATA's: the catalog of every award from Torn, which ones a member already has, the awards a member
// follows, and (next step) the progress of each award worked out from the member's own Torn stats.
//
//   wwl:aw:cat          JSON { at, items: [{ k: 'h12' | 'm34' | 'r5', t: 'honor' | 'medal' | 'merit', n: name, d: description, c: category, r: circulation, y: rarity }] }
//                       read from Torn (public key) when it is older than a week, by whoever asks first; kept in this server's memory for an hour
//   wwl:aw:follow       hash playerId -> JSON [award keys the member follows]
//
// Torn's own lists: v2 /torn/honors, /torn/medals, /torn/merits (public key, paged), /user/honors and /user/medals (the ones a member has).

const { ruleFor, RANKS } = require('./awardRules');
const { catOf } = require('./awardCats');
const CAT = 'wwl:aw:cat', LOCK = 'wwl:aw:cat-lock', FOLLOW = 'wwl:aw:follow', WEEK = 7 * 86400000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let catMem = null, mineMem = new Map(), ruledMem = null, progMem = new Map();

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
            ...honors.map(h => ({ k: 'h' + h.id, t: 'honor', n: clip(h.name, 80), d: clip(h.description, 240), c: clip(h.type && (h.type.title || h.type.id), 30) || 'Other', r: Number(h.circulation) || 0, y: clip(h.rarity, 20), cv: h.crimes_version || '' })),
            ...medals.map(m => ({ k: 'm' + m.id, t: 'medal', n: clip(m.name, 80), d: clip(m.description, 240), c: clip(m.type && (m.type.title || m.type.id), 30) || 'Other', r: Number(m.circulation) || 0, y: clip(m.rarity, 20), cv: m.crimes_version || '' })),
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

const OLD_CRIMES = /^(Commit [d,]+ (Grand theft auto|Fraud|Computer|Theft|Murder|Drug dealing) crimes|Achieve [d,]+ [a-z/ ]+ crimes|Commit [d,]+ criminal offenses)$/;
// the catalog with the rule, the category and the old-system mark of every award (worked out once per catalog)
function ruled(c) {
    if (ruledMem && ruledMem.at === c.at) return ruledMem;
    const items = [];
    for (const i of c.items) {
        if (/^In memory of our dear friend/.test(i.d)) continue; // tributes, nothing to work towards
        const x = { ...i }, rl = ruleFor(i), cc = catOf(i.d);
        if (rl) x.rl = rl;
        if (cc) x.cc = cc;
        // the awards of the old crimes system cannot be earned any more: shown only to the members who have them (the page decides)
        if (i.cv === 'v1' || OLD_CRIMES.test(i.d)) x.old = 1;
        items.push(x);
    }
    ruledMem = { at: c.at, items, paths: new Set(['age']) };
    for (const i of items) if (i.rl) { if (i.rl.s) ruledMem.paths.add(i.rl.s); for (const p of i.rl.p || []) ruledMem.paths.add(p[0]); if (i.rl.e && i.rl.e.base) ruledMem.paths.add(i.rl.e.base); }
    return ruledMem;
}
// Torn's nested personalstats -> { 'attacking.attacks.won': 123, ... }
function flatten(o, prefix, out) {
    for (const k of Object.keys(o || {})) {
        const v = o[k], p = prefix ? prefix + '.' + k : k;
        if (v && typeof v === 'object') flatten(v, p, out);
        else if (typeof v === 'number') out[p] = v;
    }
    return out;
}
async function tornV1(path, key) {
    const r = await fetch(`https://api.torn.com/${path}&key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } });
    const d = await r.json();
    if (d.error) { const e = new Error(d.error.error || 'Torn did not answer'); e.code = d.error.code; throw e; }
    return d;
}

async function awHandle(action, body, { redis, playerId, key, owner }) {
    if (action === 'aw-catalog') {
        const c = await loadCatalog(redis, key);
        return { at: c.at, items: ruled(c).items };
    }
    if (action === 'aw-mine') { // which honors and medals this member already has (kept 10 minutes in memory)
        const hit = mineMem.get(playerId);
        if (hit && Date.now() - hit.at < 600000) return hit.v;
        const [h, m] = [await tornV2('/user/honors', key), await tornV2('/user/medals', key)];
        const v = { honors: (h.honors || []).map(x => x.id), medals: (m.medals || []).map(x => x.id), hts: (h.honors || []).map(x => x.timestamp || 0), mts: (m.medals || []).map(x => x.timestamp || 0), at: Date.now() };
        if (mineMem.size > 500) mineMem.clear();
        mineMem.set(playerId, { at: Date.now(), v });
        return v;
    }
    if (action === 'aw-progress') { // the member's own numbers for the awards that can be measured (kept 5 minutes in memory)
        const hit = progMem.get(playerId);
        if (hit && Date.now() - hit.at < 300000) return hit.v;
        const paths = ruled(await loadCatalog(redis, key)).paths, stats = {}, warn = [];
        try {
            const ps = await tornV2('/user/personalstats', key, 'cat=all');
            const flat = flatten(ps.personalstats, '', {});
            for (const p of paths) if (typeof flat[p] === 'number') stats[p] = flat[p];
            const w = ['endurance', 'intelligence', 'manual'].map(k => flat['jobs.stats.' + k]);
            if (w.every(x => typeof x === 'number')) stats['jobs.stats.max'] = Math.max(...w);
        } catch (e) { warn.push('Your statistics could not be read: ' + e.message); }
        try {
            const p = await tornV1('user/?selections=profile,education', key);
            stats.lvl = Number(p.level) || 0;
            stats.age = Number(p.age) || 0;
            stats.awd = Number(p.awards) || 0;
            stats.mar = p.married && Number(p.married.duration) || 0;
            stats.fac = p.faction && Number(p.faction.days_in_faction) || 0;
            stats.edu = Array.isArray(p.education_completed) ? p.education_completed.length : 0;
            const ri = RANKS.indexOf(String(p.rank || '').toLowerCase().replace(/\s+\d.*$/, '').trim());
            if (ri >= 0) stats.rank = ri;
        } catch (e) { warn.push('Your profile could not be read: ' + e.message); }
        const v = { stats, warn, at: Date.now() };
        if (progMem.size > 500) progMem.clear();
        if (Object.keys(stats).length) progMem.set(playerId, { at: Date.now(), v });
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
