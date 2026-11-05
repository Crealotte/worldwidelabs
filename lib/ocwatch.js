// lib/ocwatch.js — who is NOT in an organized crime, who never was (as far as WWL can see) and how long it has been. Drawn in the leader to do (site and script) like the onboarding overview.
//
//   wwl:oc-last:<factionId>   hash playerId -> the last time (seconds) the member was seen in an OC: in one now, or in a crime that finished / that they joined
//   wwl:oc-meta:<factionId>   JSON { since, wm }: since = when WWL began to track (ms), wm = up to where the finished crimes have been read (seconds)
//   wwl:oc-cache:<factionId>  JSON { at, data }: the answer, kept 10 minutes
//
// Torn tells for free who is in an OC right now (the faction member list, is_in_oc). For the history there is no per-member number, so the finished crimes of the faction
// (who sat in a slot, when they joined and when it was executed) are read forward from a start point (the last 30 days to begin with, a few pages per round until it has caught up)
// and the latest time per member is kept. So "never" means: no OC since the window began, and the answer says that.

const { tornFetch } = require('./tornFetch');

const LAST = f => `wwl:oc-last:${f}`, META = f => `wwl:oc-meta:${f}`, CACHE = f => `wwl:oc-cache:${f}`, NOTIFIED = f => `wwl:ob-notified:${f}`;
const WINDOW_DAYS = 30, PAST_DAYS = 2, MIN_DAYS_IN_FACTION = 3, MAX_PAGES = 4, REFRESH_MS = 10 * 60000, DAY = 86400; // PAST_DAYS: out of an OC this many days counts as "past" (2 since 5 Nov 2026, was 7)
const parse = (raw, dflt) => { try { return raw ? JSON.parse(raw) : dflt; } catch (e) { return dflt; } };

async function tornJson(url) {
    const r = await tornFetch(url, { headers: { accept: 'application/json' } });
    const d = await r.json();
    if (d.error) throw new Error(d.error.error || 'Torn would not answer');
    return d;
}

async function ocOverview({ redis, factionId, key, force }) {
    if (!force) { const c = parse(await redis(['GET', CACHE(factionId)]), null); if (c && c.data && Date.now() - c.at < REFRESH_MS) return withNotified(redis, factionId, c.data); }
    const nowS = Math.floor(Date.now() / 1000), k = encodeURIComponent(key);
    const md = await tornJson(`https://api.torn.com/v2/faction/members?striptags=true&key=${k}`);
    const members = (Array.isArray(md.members) ? md.members : Object.values(md.members || {})).map(m => ({ id: String(m.id), name: m.name, days: m.days_in_faction ?? null, position: m.position || '', inOc: !!m.is_in_oc }));

    const meta = parse(await redis(['GET', META(factionId)]), null) || { since: Date.now(), wm: nowS - WINDOW_DAYS * DAY };
    const flat = (await redis(['HGETALL', LAST(factionId)])) || [], last = {};
    for (let i = 0; i < flat.length; i += 2) last[flat[i]] = Number(flat[i + 1]) || 0;
    const pending = {}, note = (id, t) => { if (id && t > (pending[id] || last[id] || 0)) pending[id] = t; };

    // the finished crimes since the last point: a few pages a round (oldest first), so a new faction catches up over a few rounds and then reads only what is new
    let wm = meta.wm, pages = 0, more = true;
    try {
        while (more && pages < MAX_PAGES) {
            const d = await tornJson(`https://api.torn.com/v2/faction/crimes?cat=completed&from=${wm}&sort=ASC&limit=100&offset=${pages * 100}&key=${k}`);
            const list = Array.isArray(d.crimes) ? d.crimes : Object.values(d.crimes || {});
            for (const c of list) {
                const when = Number(c.executed_at) || Number(c.ready_at) || Number(c.created_at) || 0;
                for (const s of (Array.isArray(c.slots) ? c.slots : Object.values(c.slots || {}))) if (s && s.user && s.user.id) note(String(s.user.id), Math.max(Number(s.user.joined_at) || 0, when));
                if (when > meta.wm) meta.wm = when;
            }
            pages++; more = list.length >= 100;
        }
        if (!more) meta.wm = Math.max(meta.wm, nowS - 60); // read up to now: the next round starts there
    } catch (e) { /* the list still works with what is known; the next round tries again */ }
    meta.building = more; // still reading older crimes: a member may look like "never" for now

    // whoever is in an OC right now counts as seen now (written at most every 12 hours per member, in ONE command)
    for (const m of members) if (m.inOc && nowS - (last[m.id] || 0) > 12 * 3600) note(m.id, nowS);
    const writes = Object.entries(pending); if (writes.length) for (let i = 0; i < writes.length; i += 200) await redis(['HSET', LAST(factionId), ...writes.slice(i, i + 200).flat().map(String)]);
    await redis(['SET', META(factionId), JSON.stringify({ since: meta.since, wm: meta.wm })]);
    for (const [id, t] of writes) last[id] = t;

    const ago = t => { const dd = Math.floor((nowS - t) / DAY); return dd < 1 ? 'today' : dd === 1 ? 'yesterday' : `${dd} days ago`; };
    const out = [], never = [];
    for (const m of members) {
        if (m.inOc || m.days == null || m.days < MIN_DAYS_IN_FACTION || /recruit/i.test(m.position)) continue; // in an OC, or too new to be asked
        const t = last[m.id] || 0;
        const p = { id: m.id, name: m.name, days: m.days };
        if (t) out.push({ ...p, info: `last in an OC ${ago(t)}`, since: nowS - t });
        else never.push({ ...p, info: `no OC in the last ${WINDOW_DAYS} days that WWL knows of`, since: nowS - WINDOW_DAYS * DAY });
    }
    out.sort((a, b) => b.since - a.since);
    const past = [...never, ...out.filter(p => p.since >= PAST_DAYS * DAY)].map(p => ({ id: p.id, name: p.name, days: p.days, info: p.info }));
    const data = { days: PAST_DAYS, window: WINDOW_DAYS, building: !!meta.building, trackedSince: meta.since, ocout: out.map(({ since, ...p }) => p), ocnever: never.map(({ since, ...p }) => p), past, inOc: members.filter(m => m.inOc).length, total: members.length };
    await redis(['SET', CACHE(factionId), JSON.stringify({ at: Date.now(), data }), 'EX', 3600]);
    return withNotified(redis, factionId, data);
}

// the "Notified" marks (shared with the onboarding overview: one hash, kinds 'ocout' and 'ocnever')
async function withNotified(redis, factionId, data) {
    const notified = {};
    try { const f = (await redis(['HGETALL', NOTIFIED(factionId)])) || []; for (let i = 0; i < f.length; i += 2) notified[f[i]] = Number(f[i + 1]) || 0; } catch (e) { /* none marked */ }
    const tag = (kind, list) => (list || []).map(p => ({ ...p, notified: notified[`${kind}:${p.id}`] || 0 }));
    return { ...data, ocout: tag('ocout', data.ocout), ocnever: tag('ocnever', data.ocnever) };
}

module.exports = { ocOverview };
