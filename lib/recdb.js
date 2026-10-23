// lib/recdb.js — the recruiting database: the factions of Torn's respect Hall of Fame (inside a respect range), their members, and the stats of the best candidates.
// Filled in small steps (`rec-db-step`, about 40 seconds of work each, driven by the owner's Recruiter page which keeps asking until it is done), so it never needs a long job.
// Torn is asked slowly (one call per 650 ms, under its 100 calls a minute) with plain fetch and the owner's own key; the key is only ever used for the request it came with.
//
//   wwl:rdb:state          JSON { minR, maxR, phase: 'list' | 'members' | 'done', offset, mi, ei, factions, membersDone, enriched, startedAt, updatedAt }
//   wwl:rdb:list           JSON [[factionId, name, members, respect], ...] in respect order
//   wwl:rdb:m:<0..15>      hash factionId -> JSON { at, m: [[playerId, name, level, daysInFaction, lastActionTimestamp, position], ...] }   (shard = factionId mod 16)
//   wwl:rec:tg             the shared player stats of the Recruiter script ({ n, ws, x, a, s, ts }); the candidates' stats are read into it, and the script's own reads count too
//
// Owner only for now (see rdbHandle's caller in lib/recruit.js).

const STATE = 'wwl:rdb:state', LIST = 'wwl:rdb:list', SHARDS = 16, TG = 'wwl:rec:tg';
const shardKey = fid => `wwl:rdb:m:${Number(fid) % SHARDS}`;
const BUDGET_MS = 40000, GAP_MS = 650, DAY = 86400;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const idOf = v => { const s = String(v == null ? '' : v).replace(/\D/g, '').slice(0, 10); return s && Number(s) > 0 ? s : ''; };
const num = (v, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0; };
const pairs = raw => { const flat = Array.isArray(raw) ? raw : Object.entries(raw || {}).flat(), out = []; for (let i = 0; i < flat.length; i += 2) out.push([String(flat[i]), flat[i + 1]]); return out; };
const parse = (raw, dflt) => { try { return raw ? JSON.parse(raw) : dflt; } catch (e) { return dflt; } };

async function torn(url) { // one plain call; returns the parsed answer
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    return await r.json();
}
const rateLimited = d => d && d.error && Number(d.error.code) === 5;

async function loadState(redis) { return parse(await redis(['GET', STATE]), null); }
async function saveState(redis, st) { st.updatedAt = Date.now(); await redis(['SET', STATE, JSON.stringify(st)]); }

// ---- step 1: the faction list from the respect Hall of Fame, between minR and maxR ----
async function stepList(redis, key, st, t0) {
    const list = parse(await redis(['GET', LIST]), []) || [];
    while (Date.now() - t0 < BUDGET_MS) {
        const d = await torn(`https://api.torn.com/v2/torn/factionhof?cat=respect&limit=100&offset=${st.offset}&key=${encodeURIComponent(key)}`);
        if (d.error) {
            if (rateLimited(d)) { await redis(['SET', LIST, JSON.stringify(list)]); return { paused: 'Torn asked us to slow down: it continues in a moment.' }; }
            throw new Error(`Torn: ${d.error.error}`);
        }
        const rows = Array.isArray(d.factionhof) ? d.factionhof : [];
        if (!rows.length) { st.phase = 'members'; st.mi = 0; break; }
        let below = false;
        for (const f of rows) {
            const r = Number(f.values && f.values.respect) || 0;
            if (r < st.minR) { below = true; break; }
            if (r > st.maxR) continue;
            list.push([String(f.id), String(f.name || '').slice(0, 40), Number(f.members) || 0, r]);
        }
        st.offset += rows.length; st.factions = list.length;
        if (below) { st.phase = 'members'; st.mi = 0; break; }
        await sleep(GAP_MS);
    }
    await redis(['SET', LIST, JSON.stringify(list)]);
    return {};
}

// ---- step 2: the members of every faction on the list ----
async function stepMembers(redis, key, st, t0) {
    const list = parse(await redis(['GET', LIST]), []) || [], batch = {}, rec = fid => shardKey(fid);
    let paused = null;
    while (st.mi < list.length && Date.now() - t0 < BUDGET_MS) {
        const [fid] = list[st.mi];
        const d = await torn(`https://api.torn.com/v2/faction/${fid}/members?striptags=true&key=${encodeURIComponent(key)}`);
        if (d.error) {
            if (rateLimited(d)) { paused = 'Torn asked us to slow down: it continues in a moment.'; break; }
            if ([2, 8, 9, 10, 13, 18].includes(Number(d.error.code))) throw new Error(`Torn: ${d.error.error}`); // the key itself is the problem
            // this one faction cannot be read (gone, hidden): it is skipped
            (batch[rec(fid)] = batch[rec(fid)] || []).push(fid, JSON.stringify({ at: Date.now(), m: [] }));
        } else {
            const m = (Array.isArray(d.members) ? d.members : Object.values(d.members || {})).map(x => [String(x.id), String(x.name || '').slice(0, 24), Number(x.level) || 0, Number(x.days_in_faction) || 0, Number(x.last_action && x.last_action.timestamp) || 0, String(x.position || '').slice(0, 20)]);
            (batch[rec(fid)] = batch[rec(fid)] || []).push(fid, JSON.stringify({ at: Date.now(), m }));
            st.membersDone = (st.membersDone || 0) + 1;
        }
        st.mi++;
        await sleep(GAP_MS);
    }
    for (const [k, args] of Object.entries(batch)) await redis(['HSET', k, ...args]); // one write per shard, not one per faction
    if (st.mi >= list.length) st.phase = 'done';
    return paused ? { paused } : {};
}

// ---- step 3: the stats of the best candidates of each faction (a few per faction, most recently online first, leaders left out) ----
async function members(redis) { // all members, by faction
    const out = {};
    for (let s = 0; s < SHARDS; s++) for (const [fid, raw] of pairs(await redis(['HGETALL', `wwl:rdb:m:${s}`]))) out[fid] = parse(raw, { m: [] });
    return out;
}
const isLeader = pos => /leader/i.test(pos || '');
async function stepEnrich(redis, key, st, t0, perFaction, onlineHours) {
    const list = parse(await redis(['GET', LIST]), []) || [], mem = await members(redis), now = Math.floor(Date.now() / 1000);
    const put = []; let paused = null, read = 0;
    while ((st.ei || 0) < list.length && Date.now() - t0 < BUDGET_MS) {
        const [fid] = list[st.ei || 0], f = mem[fid];
        const cands = ((f && f.m) || []).filter(p => !isLeader(p[5]) && p[4] >= now - onlineHours * 3600).sort((a, b) => b[4] - a[4]).slice(0, perFaction * 2); // a few extra, some are already known
        const have = cands.length ? (await redis(['HMGET', TG, ...cands.map(p => p[0])])) || [] : [];
        const todo = cands.filter((p, i) => { const t = parse(have[i], null); return !(t && t.ts && Date.now() - t.ts < 14 * DAY * 1000); }).slice(0, perFaction);
        let stop = false;
        for (const p of todo) {
            if (Date.now() - t0 >= BUDGET_MS) { stop = true; break; }
            const d = await torn(`https://api.torn.com/user/${p[0]}?selections=profile,personalstats,hof&key=${encodeURIComponent(key)}`);
            if (d.error) { if (rateLimited(d)) { paused = 'Torn asked us to slow down: it continues in a moment.'; stop = true; break; } if ([2, 8, 9, 10, 13, 18].includes(Number(d.error.code))) throw new Error(`Torn: ${d.error.error}`); await sleep(GAP_MS); continue; }
            const ws = (d.halloffame && d.halloffame.working_stats && d.halloffame.working_stats.value) || (d.hof && d.hof.working_stats && d.hof.working_stats.value) || 0;
            put.push(p[0], JSON.stringify({ n: String(d.name || p[1]).slice(0, 40), ws: num(ws, 1e13), x: num(d.personalstats && d.personalstats.xantaken, 1e9), a: num(d.personalstats && d.personalstats.rankedwarhits, 1e7), s: num(d.personalstats && d.personalstats.activestreak, 1e5), ts: Date.now() }));
            read++; st.enriched = (st.enriched || 0) + 1;
            await sleep(GAP_MS);
        }
        if (stop) break; // this faction is read again next time (the known players are skipped)
        st.ei = (st.ei || 0) + 1;
    }
    for (let i = 0; i < put.length; i += 200) await redis(['HSET', TG, ...put.slice(i, i + 200)]);
    return paused ? { paused, read } : { read };
}

// ---- the answer to a search: players matching the filters, best first ----
const SCORE = (st, ws) => Math.round(100 * (0.4 * Math.min((st.s || 0) / 400, 1) + 0.3 * Math.min((st.a || 0) / 300, 1) + 0.3 * Math.min((st.x || 0) / 3000, 1)));
async function query(redis, ownerId, q) {
    const list = parse(await redis(['GET', LIST]), []) || [], mem = await members(redis), now = Math.floor(Date.now() / 1000);
    const n = (v, d) => { const x = Number(v); return Number.isFinite(x) && v !== '' && v !== null && v !== undefined ? x : d; };
    const minR = n(q.minR, 0), maxR = n(q.maxR, 1e12), minM = n(q.minMembers, 0), maxM = n(q.maxMembers, 1e6), hours = n(q.onlineHours, 24);
    const minL = n(q.minLevel, 0), maxL = n(q.maxLevel, 100), minD = n(q.minDays, 0);
    const fac = {}; for (const [fid, name, m, r] of list) if (r >= minR && r <= maxR && m >= minM && m <= maxM) fac[fid] = { name, m, r };
    let base = [];
    for (const [fid, f] of Object.entries(fac)) for (const p of ((mem[fid] && mem[fid].m) || [])) {
        if (p[4] < now - hours * 3600 || p[2] < minL || p[2] > maxL || p[3] < minD) continue;
        if (q.hideLeaders !== false && isLeader(p[5])) continue;
        base.push({ p, fid });
    }
    const baseCount = base.length;
    const states = {}; // my own F / C / S / U marks
    for (const [tid, raw] of pairs(await redis(['HGETALL', `wwl:rec:st:${ownerId}`]))) { const s = parse(raw, null); if (s) states[tid] = s; }
    const stats = {};
    const needStats = q.onlyWithStats || ['minStreak', 'minWar', 'minXanax', 'minWork'].some(k => n(q[k], 0) > 0) || ['score', 'streak', 'war', 'xanax', 'work'].includes(q.sort || 'score');
    if (needStats) {
        if (base.length > 30000) return { error: `${baseCount} players match the first filters: narrow them (a shorter "online within", or a smaller respect range) before searching on stats.`, baseCount };
        const ids = base.map(x => x.p[0]);
        for (let i = 0; i < ids.length; i += 1000) { const vals = (await redis(['HMGET', TG, ...ids.slice(i, i + 1000)])) || []; vals.forEach((raw, j) => { const t = parse(raw, null); if (t) stats[ids[i + j]] = t; }); }
    }
    let rows = [];
    const why = { marked: 0, noStats: 0, streak: 0, war: 0, xanax: 0, work: 0, withStats: 0 }; // where the players dropped out, so a surprising result can be understood
    for (const { p, fid } of base) {
        const t = stats[p[0]] || null, s = states[p[0]] || null;
        if (t) why.withStats++;
        if (q.hideContacted !== false && s && (s.f || s.c || s.s || s.u)) { why.marked++; continue; }
        if (q.onlyWithStats && !t) { why.noStats++; continue; }
        if (n(q.minStreak, 0) > 0 && !(t && t.s >= n(q.minStreak, 0))) { why.streak++; continue; }
        if (n(q.minWar, 0) > 0 && !(t && t.a >= n(q.minWar, 0))) { why.war++; continue; }
        if (n(q.minXanax, 0) > 0 && !(t && t.x >= n(q.minXanax, 0))) { why.xanax++; continue; }
        if (n(q.minWork, 0) > 0 && !(t && t.ws >= n(q.minWork, 0))) { why.work++; continue; }
        const f = fac[fid];
        rows.push({ id: p[0], name: p[1], level: p[2], days: p[3], last: p[4], pos: p[5], fid, faction: f.name, fresp: f.r, fmem: f.m, xan: t ? t.x : null, war: t ? t.a : null, streak: t ? t.s : null, work: t ? t.ws : null, score: t ? SCORE(t) : null, f: s ? s.f || 0 : 0, c: s ? s.c || 0 : 0, sm: s ? s.s || 0 : 0 });
    }
    const sort = q.sort || 'score', val = { score: r => r.score ?? -1, streak: r => r.streak ?? -1, war: r => r.war ?? -1, xanax: r => r.xan ?? -1, work: r => r.work ?? -1, online: r => r.last, level: r => r.level, days: r => r.days, respect: r => r.fresp }[sort] || (r => r.score ?? -1);
    rows.sort((a, b) => val(b) - val(a) || b.last - a.last);
    if (q.onePerFaction) { const seen = new Set(); rows = rows.filter(r => !seen.has(r.fid) && seen.add(r.fid)); }
    return { total: rows.length, baseCount, why, factions: Object.keys(fac).length, rows: rows.slice(0, Math.min(500, Math.max(10, n(q.limit, 100)))) };
}

async function rdbHandle(action, body, { redis, who, key, owner }) {
    if (!owner) throw new Error('Owner only.');
    if (action === 'rec-db-info') {
        const st = await loadState(redis), list = parse(await redis(['GET', LIST]), []) || [];
        let tg = 0; try { tg = Number(await redis(['HLEN', TG])) || 0; } catch (e) { tg = 0; }
        return { state: st, factions: list.length, knownStats: tg };
    }
    if (action === 'rec-db-step') {
        const t0 = Date.now(), mode = body.mode;
        let st = await loadState(redis);
        if (mode === 'build') {
            if (body.start || !st) {
                const minR = Math.max(0, num(body.minR, 1e9) || 20000), maxR = Math.max(minR, num(body.maxR, 1e10) || 500000);
                st = { minR, maxR, phase: 'list', offset: 0, mi: 0, ei: 0, factions: 0, membersDone: 0, enriched: 0, startedAt: Date.now() };
                await redis(['SET', LIST, '[]']);
            }
            if (st.phase === 'done') return { state: st, done: true };
            const r = st.phase === 'list' ? await stepList(redis, key, st, t0) : await stepMembers(redis, key, st, t0);
            await saveState(redis, st);
            return { state: st, paused: r.paused || null, done: st.phase === 'done' };
        }
        if (mode === 'enrich') {
            if (!st || st.phase !== 'done') throw new Error('Build the faction list and the members first.');
            if (body.start) st.ei = 0;
            const perFaction = Math.min(10, Math.max(1, num(body.perFaction, 10) || 3)), hours = Math.min(720, Math.max(1, num(body.onlineHours, 1e4) || 72));
            const r = await stepEnrich(redis, key, st, t0, perFaction, hours);
            await saveState(redis, st);
            const list = parse(await redis(['GET', LIST]), []) || [];
            return { state: st, read: r.read || 0, paused: r.paused || null, done: (st.ei || 0) >= list.length, total: list.length };
        }
        throw new Error('Unknown mode.');
    }
    if (action === 'rec-db-query') return await query(redis, who.playerId, body.q || {});
    throw new Error('Unknown action');
}

module.exports = { rdbHandle };
