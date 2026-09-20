// lib/memberOverview.js — backend for the Member Overview page (leader/council only): who is
// following the rules and who needs an extra push. Routed from api/war-payout.js ('mo-*' actions,
// behind its leader gate — "leader" there means a key with faction API access, i.e. leader/council).
//
// What it tracks so far:
//   - Hits per member over the last 5 ended wars, split into WAR hits (Torn's own ranked-war flag,
//     same rule the payout calculator uses) and CHAIN hits (successful hits inside a chain that
//     weren't war hits — from the war's start to 24h after its end, so the chain that carries on
//     after the war is included). Each finished war is computed once and cached forever (a past
//     war never changes), so opening the page later is instant.
//   - Energy tier per member (1.5m+ total battle stats -> 4400 E/week, under -> 2200 E/week). Torn
//     hides other players' battle stats, so the leader sets each member's tier by hand.
//   - The rule thresholds and points weights the traffic lights/leaderboard use (per faction).
// Candy, alcohol and energy drinks used per week come from Torn personal-stat snapshots (mo-stats).
// Energy trained per week and blood bags filled are NOT connected yet: 'mo-probe' finds out what
// Torn actually exposes for them (see there) so they can be added on real data, not guesses.

const { sleep, isRateLimited } = require('./warHits');
const { energyBetween } = require('./steadfast');
const { importIntelText } = require('./energyImport');

const settingsKey = (f) => `wwl:mo-settings:${f}`;
const tiersKey = (f) => `wwl:mo-tiers:${f}`;
const warKey = (f, warId) => `wwl:mo-war:${f}:${warId}`;
const ENERGY_TARGET = { high: 4400, low: 2200 }; // energy per week: 1.5m+ total battle stats vs under (they still do jumps)
const TIER_LIMIT = 1500000; // total battle stats
const rosterKey = (f) => `wwl:mo-roster:${f}`;
const warsKey = (f) => `wwl:mo-wars:${f}`;
const battleKey = (f) => `wwl:mo-battle:${f}`; // hash: playerId -> { total, at }, from members' own keys
const DEFAULT_SETTINGS = { minWarHits: 10, minChainHits: 20, needWars: 3 }; // war rule: 10 war hits per war (or 0 war hits + 20 chain hits), met in 3 of the last 5 wars

async function tornV2(path, key) {
    const r = await fetch(`https://api.torn.com/v2${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } });
    const d = await r.json();
    if (d.error) throw new Error(d.error.error);
    return d;
}

async function recentWars(key, factionId, n = 5) {
    const d = await tornV2('/faction?selections=rankedwars', key);
    return Object.values(d.rankedwars || {}).filter(w => w.end).sort((a, b) => b.end - a.end).slice(0, n).map(w => {
        const them = (w.factions || []).find(f => String(f.id) !== factionId);
        return { id: String(w.id), start: w.start, end: w.end, opponent: them?.name || 'Unknown' };
    });
}

// Walks our own outgoing attacks from the war's start to 24h after its end (never past "now").
// Time-boxed: a war that can't be finished within the budget is reported `partial` and NOT cached,
// so the next attempt just tries again.
async function scanWar(key, factionId, war, resume) {
    const perMember = resume?.perMember || {};
    const to = Math.min(war.end + 86400, Math.floor(Date.now() / 1000));
    const started = Date.now();
    let from = resume?.from || war.start, pages = 0, partial = false;
    while (from <= to) {
        if (Date.now() - started > 42000 || pages >= 40) { partial = true; break; }
        if (pages > 0) await sleep(1000);
        const r = await fetch(`https://api.torn.com/v2/faction/attacks?from=${from}&to=${to}&sort=ASC&key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } });
        const data = await r.json();
        if (data.error) { if (isRateLimited(data)) { partial = true; break; } throw new Error(`War attacks: ${data.error.error}`); }
        const list = Array.isArray(data.attacks) ? data.attacks : Object.values(data.attacks || {});
        if (!list.length) break;
        pages++;
        let newest = from;
        for (const att of list) {
            const ts = att.ended ?? att.started ?? from;
            if (ts > newest) newest = ts;
            if (String(att.attacker?.faction?.id ?? '') !== factionId) continue;
            const id = String(att.attacker?.id ?? '');
            if (!id) continue;
            const isWar = !!(att.is_ranked_war ?? att.ranked_war);
            const isChain = !isWar && Number(att.chain) > 0 && Number(att.respect_gain) > 0;
            if (!isWar && !isChain) continue;
            const m = perMember[id] || (perMember[id] = { war: 0, chain: 0 });
            if (isWar) m.war++; else m.chain++;
        }
        if (newest <= from) break;
        from = newest + 1;
    }
    return { perMember, partial, pages, from };
}

// The stats compared week to week. (Torn has no per-member "energy trained" stat — see 'mo-probe'.)
const PS_STATS = ['candyused', 'alcoholused', 'energydrinkused', 'bloodwithdrawn']; // bloodwithdrawn = blood bags filled
const PS_HASH = 'wwl:mo-personalstats-v2'; // field "<playerId>:<timestamp>" -> { stat: value }

async function fetchStats(id, timestamp, key) {
    const r = await fetch(`https://api.torn.com/user/${encodeURIComponent(id)}?selections=personalstats&stat=${PS_STATS.join(',')}&timestamp=${timestamp}&key=${encodeURIComponent(key)}`);
    const d = await r.json();
    if (d.error) throw new Error(d.error.error);
    const ps = d.personalstats;
    const out = {};
    for (const s of PS_STATS) {
        let v;
        if (Array.isArray(ps)) v = ps.find(x => x.name === s)?.value;
        else if (ps && typeof ps === 'object') {
            v = ps[s];
            if (v === undefined) for (const c of Object.values(ps)) if (c && typeof c === 'object' && s in c) { v = c[s]; break; }
        }
        if (v === undefined || v === null || !Number.isFinite(Number(v))) throw new Error(`Could not read "${s}" from Torn's answer: ${JSON.stringify(d).slice(0, 300)}`); // unreadable — never cache a guess
        out[s] = Number(v);
    }
    return out;
}


// ---- Member dashboard card ("My standing"), open to every member ------------------------------------
// Same periods as the page for leaders: weeks run Sunday to Sunday; the newsletter comes out the first
// Sunday of each month, so "this month" is the running period since the last first-Sunday (or the last
// finished one if nothing has run yet).
const DAY = 86400;
function firstSunday(y, m) { const first = new Date(Date.UTC(y, m, 1)); return Math.floor(Date.UTC(y, m, 1 + (7 - first.getUTCDay()) % 7) / 1000); }
function currentPeriod(now) {
    const d = new Date(now * 1000);
    const latest = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - d.getUTCDay()) / 1000);
    const dates = [];
    for (let i = 0; dates.length < 3 && i < 12; i++) {
        const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
        const t = firstSunday(dt.getUTCFullYear(), dt.getUTCMonth());
        if (t <= now) dates.push(t);
    }
    const running = latest > dates[0];
    const start = running ? dates[0] : dates[1], end = running ? latest : dates[0];
    // The month as planned (first Sunday to the next first Sunday) — 4 or 5 weeks — for the energy requirement.
    const nd = new Date(start * 1000);
    let nextFirst = firstSunday(nd.getUTCFullYear(), nd.getUTCMonth() + 1);
    if (nextFirst <= start) nextFirst = firstSunday(nd.getUTCFullYear(), nd.getUTCMonth() + 2);
    return { start, end, running, plannedEnd: nextFirst, plannedWeeks: Math.round((nextFirst - start) / (7 * DAY)) };
}

async function readOwnBattleStats(key) {
    const r = await fetch(`https://api.torn.com/user/?selections=personalstats&key=${encodeURIComponent(key)}`);
    const d = await r.json();
    const ps = d.personalstats || {};
    let total = Number(ps.totalstats);
    if (!Number.isFinite(total) || total <= 0) total = ['strength', 'defense', 'speed', 'dexterity'].reduce((s, k) => s + (Number(ps[k]) || 0), 0);
    return total > 0 ? total : null;
}

// Everything the caller's dashboard card shows. Uses the caller's own key only for their own battle
// stats (which Torn shows only to the owner); the rest is read from what leaders' pages already stored.
async function moMe({ redis, key, factionId, playerId, daysInFaction }) {
    const now = Math.floor(Date.now() / 1000);

    // Remember my total battle stats (refreshed at most every 6 hours) — this puts me in the right energy group.
    let total = null;
    try {
        const saved = await redis(['HGET', battleKey(factionId), playerId]);
        const s = saved ? JSON.parse(saved) : null;
        if (s && now - s.at < 6 * 3600) total = s.total;
        else {
            total = await readOwnBattleStats(key);
            if (total) await redis(['HSET', battleKey(factionId), playerId, JSON.stringify({ total, at: now })]);
            else total = s?.total ?? null;
        }
    } catch (e) { /* stats stay unknown */ }
    const manual = await redis(['HGET', tiersKey(factionId), playerId]);
    const tier = manual || (total === null ? null : total >= TIER_LIMIT ? 'high' : 'low');
    const period = currentPeriod(now);
    const weekly = tier ? ENERGY_TARGET[tier] : null;

    // Wars: last 5, from what a leader's page stored.
    const settingsRaw = await redis(['GET', settingsKey(factionId)]);
    const settings = { ...DEFAULT_SETTINGS, ...(settingsRaw ? JSON.parse(settingsRaw) : {}) };
    const warsRaw = await redis(['GET', warsKey(factionId)]);
    const wars = warsRaw ? JSON.parse(warsRaw) : [];
    const cached = wars.length ? await redis(['MGET', ...wars.map(w => warKey(factionId, w.id))]) : [];
    const joinedBy = daysInFaction == null ? 0 : now - daysInFaction * DAY;
    const warRows = [];
    let okWars = 0, eligible = 0;
    wars.slice().sort((a, b) => a.end - b.end).forEach(w => {
        const raw = cached[wars.findIndex(x => x.id === w.id)];
        if (!raw) { warRows.push({ opponent: w.opponent, end: w.end, unknown: true }); return; }
        const h = JSON.parse(raw)[playerId] || {};
        const p = { opponent: w.opponent, end: w.end, war: h.war || 0, chain: h.chain || 0 };
        if (joinedBy > w.start) p.notIn = true;
        else { eligible++; p.ok = p.war >= settings.minWarHits || (p.war < settings.minWarHits && p.chain >= settings.minChainHits); if (p.ok) okWars++; }
        warRows.push(p);
    });
    const need = Math.min(settings.needWars, eligible);

    // Place this month, per category, among the roster members whose numbers are known.
    const rosterRaw = await redis(['GET', rosterKey(factionId)]);
    const roster = rosterRaw ? JSON.parse(rosterRaw) : [];
    const places = {};
    if (roster.length) {
        const cats = { war: {}, chain: {} };
        wars.forEach((w, i) => {
            if (!cached[i]) return;
            const h = JSON.parse(cached[i]);
            for (const m of roster) { cats.war[m.id] = (cats.war[m.id] || 0) + (h[m.id]?.war || 0); cats.chain[m.id] = (cats.chain[m.id] || 0) + (h[m.id]?.chain || 0); }
        });
        const fields = [];
        for (const m of roster) fields.push(`${m.id}:${period.start}`, `${m.id}:${period.end}`);
        const snaps = await redis(['HMGET', PS_HASH, ...fields]);
        for (const s of PS_STATS) cats[s] = {};
        roster.forEach((m, i) => {
            const a = snaps[i * 2], b = snaps[i * 2 + 1];
            if (!a || !b) return;
            const A = JSON.parse(a), B = JSON.parse(b);
            for (const s of PS_STATS) cats[s][m.id] = Math.max(0, B[s] - A[s]);
        });
        for (const [cat, vals] of Object.entries(cats)) {
            if (vals[playerId] === undefined) continue;
            const mine = vals[playerId];
            places[cat] = { value: mine, place: 1 + Object.values(vals).filter(v => v > mine).length, of: Object.keys(vals).length };
        }
    }

    // Energy trained in the gym: since the month started, and over the rolling 4-5 weeks. From the daily contributor
    // snapshots (lib/steadfast.js); null until at least one snapshot exists.
    let energy = null;
    try {
        const rollFrom = now - period.plannedWeeks * 7 * DAY;
        const [mo, ro] = await Promise.all([energyBetween(redis, factionId, period.start, now), energyBetween(redis, factionId, rollFrom, now)]);
        if (mo.snapshots > 0) energy = {
            month: { trained: mo.perMember[playerId]?.total ?? 0, partial: mo.partial, sinceDay: mo.sinceDay },
            rolling: { trained: ro.perMember[playerId]?.total ?? 0, partial: ro.partial, sinceDay: ro.sinceDay },
        };
    } catch (e) { /* the card just shows no energy figure */ }

    return {
        total, tier, tierSource: manual ? 'leader' : 'auto', weeklyEnergy: weekly,
        period: { start: period.start, end: period.end, running: period.running, plannedWeeks: period.plannedWeeks, plannedEnd: period.plannedEnd },
        energyNeeded: weekly ? weekly * period.plannedWeeks : null,
        wars: warRows, okWars, eligible, need, rule: { minWarHits: settings.minWarHits, minChainHits: settings.minChainHits, needWars: settings.needWars },
        places, energy,
    };
}

async function hgetall(redis, key) {
    const flat = (await redis(['HGETALL', key])) || [];
    const out = {};
    for (let i = 0; i < flat.length; i += 2) out[flat[i]] = flat[i + 1];
    return out;
}

async function moHandle(action, body, { redis, key, factionId }) {
    if (action === 'mo-get') {
        const [membersData, wars, rawSettings, tiers] = await Promise.all([
            tornV2('/faction/members?striptags=true', key),
            recentWars(key, factionId, 5), // the war rule looks at the last 5 wars, rolling
            redis(['GET', settingsKey(factionId)]),
            hgetall(redis, tiersKey(factionId)),
        ]);
        const cached = wars.length ? await redis(['MGET', ...wars.map(w => warKey(factionId, w.id))]) : [];
        const hits = {};
        wars.forEach((w, i) => { if (cached[i]) hits[w.id] = JSON.parse(cached[i]); });
        const members = (membersData.members || []).map(m => ({
            id: String(m.id), name: m.name, level: m.level,
            lastAction: m.last_action?.timestamp || null, daysInFaction: m.days_in_faction ?? null,
        }));
        // Members' own dashboard card (mo-me) can't read faction-wide data with a member key, so
        // whatever a leader loads here is kept for it: the roster and the last 5 wars.
        await redis(['SET', rosterKey(factionId), JSON.stringify(members.map(m => ({ id: m.id, name: m.name })))]);
        await redis(['SET', warsKey(factionId), JSON.stringify(wars)]);
        const battle = await hgetall(redis, battleKey(factionId));
        const autoTier = {};
        for (const [id, raw] of Object.entries(battle)) { try { autoTier[id] = { total: JSON.parse(raw).total, tier: JSON.parse(raw).total >= TIER_LIMIT ? 'high' : 'low' }; } catch (e) { /* skip */ } }
        return { members, wars, hits, tiers, autoTier, energyTarget: ENERGY_TARGET, settings: { ...DEFAULT_SETTINGS, ...(rawSettings ? JSON.parse(rawSettings) : {}) } };
    }

    if (action === 'mo-war') {
        const war = (await recentWars(key, factionId, 12)).find(w => w.id === String(body.warId));
        if (!war) throw new Error('War not found');
        // A big war can't be read in one go, so progress is saved and the next call carries on from
        // where this one stopped (the page keeps asking until it reports done).
        const progKey = `${warKey(factionId, war.id)}:progress`;
        const savedRaw = await redis(['GET', progKey]);
        const result = await scanWar(key, factionId, war, savedRaw ? JSON.parse(savedRaw) : null);
        if (result.partial) {
            await redis(['SET', progKey, JSON.stringify({ from: result.from, perMember: result.perMember }), 'EX', 86400]);
        } else {
            await redis(['SET', warKey(factionId, war.id), JSON.stringify(result.perMember)]);
            await redis(['DEL', progKey]);
        }
        return { warId: war.id, hits: result.perMember, partial: result.partial };
    }

    // Personal-stat snapshots (candy / alcohol / energy drinks used ...) at given moments, so the page
    // can turn "total ever" into "used per week" by subtracting one Monday from the next. A snapshot of
    // the past never changes, so each one is stored once (one shared hash) and never asked for again.
    // Time-boxed, so a first run for a big roster comes back in pieces: `pending` says how many are
    // still missing and the page simply asks again.
    if (action === 'mo-stats') {
        const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter(s => /^\d+$/.test(s)).slice(0, 100);
        const stamps = (Array.isArray(body.timestamps) ? body.timestamps : []).map(Number).filter(n => n > 0).slice(0, 6);
        const fields = [];
        for (const id of ids) for (const ts of stamps) fields.push(`${id}:${ts}`);
        const cached = fields.length ? await redis(['HMGET', PS_HASH, ...fields]) : [];
        const values = {};
        const todo = [];
        fields.forEach((f, i) => { if (cached[i]) values[f] = JSON.parse(cached[i]); else todo.push(f); });
        const started = Date.now();
        let failed = 0, firstError = null;
        for (let i = 0; i < todo.length && Date.now() - started < 40000; i += 5) {
            const batch = todo.slice(i, i + 5);
            const results = await Promise.all(batch.map(async f => {
                const [id, ts] = f.split(':');
                try { return [f, await fetchStats(id, ts, key)]; } catch (e) { firstError = firstError || `${f}: ${e.message}`; return [f, null]; }
            }));
            const store = [];
            for (const [f, v] of results) {
                if (!v) { failed++; continue; }
                values[f] = v;
                store.push(f, JSON.stringify(v));
            }
            if (store.length) await redis(['HSET', PS_HASH, ...store]);
            await sleep(700); // gentle on Torn's per-key rate limit
        }
        return { values, pending: todo.filter(f => !values[f]).length, failed, firstError };
    }

    // Energy each member trained in the gym over a period (from the daily contributor snapshots).
    if (action === 'mo-energy') {
        const from = Number(body.from), to = Number(body.to);
        if (!(from > 0 && to > from)) throw new Error('Missing period');
        const r = await energyBetween(redis, factionId, from, to);
        return { perMember: Object.fromEntries(Object.entries(r.perMember).map(([id, v]) => [id, v.total])), partial: r.partial, sinceDay: r.sinceDay, snapshots: r.snapshots };
    }

    // Fill in the past energy trained from Torn Intel's leaderboard (a leader pastes the table with the members
    // expanded). See lib/energyImport.js for the format.
    if (action === 'mo-energy-import') {
        const text = String(body.text || '');
        if (text.length < 20) throw new Error('Paste the table from Torn Intel first.');
        if (text.length > 1500000) throw new Error('That is a lot of text — paste fewer members at a time.');
        const m = await tornV2('/faction/members?striptags=true', key);
        const roster = (m.members || []).map(x => ({ id: String(x.id), name: x.name }));
        return await importIntelText(redis, factionId, roster, text);
    }

    if (action === 'mo-settings') {
        const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
        const s = {
            minWarHits: num(body.minWarHits, DEFAULT_SETTINGS.minWarHits),
            minChainHits: num(body.minChainHits, DEFAULT_SETTINGS.minChainHits),
            needWars: Math.min(5, Math.max(1, num(body.needWars, DEFAULT_SETTINGS.needWars))),
        };
        await redis(['SET', settingsKey(factionId), JSON.stringify(s)]);
        return { ok: true, settings: s };
    }

    if (action === 'mo-tier') {
        const id = String(body.id || '').replace(/\D/g, '');
        if (!id) throw new Error('Missing member');
        if (body.tier === 'high' || body.tier === 'low') await redis(['HSET', tiersKey(factionId), id, body.tier]);
        else await redis(['HDEL', tiersKey(factionId), id]);
        return { ok: true };
    }

    // Discovery for the two things not connected yet. (1) Every personal-stat name on YOUR account
    // that mentions gym/train/energy/refill/drink/xanax, with its current value — so the "energy
    // trained" number can be tied to a real Torn stat. (2) Armory news lines from the last 3 days
    // that mention blood bags — so "blood bags filled" can be matched to Torn's real wording.
    if (action === 'mo-probe') {
        const r = await fetch(`https://api.torn.com/user/?selections=personalstats&key=${encodeURIComponent(key)}`);
        const d = await r.json();
        const stats = {};
        for (const [k, v] of Object.entries(d.personalstats || {})) if (/gym|train|energy|refill|drink|xan|blood|candy|alcohol|overdos|strength|defense|speed|dexterity/i.test(k)) stats[k] = v;
        const now = Math.floor(Date.now() / 1000);
        let bloodLines = [];
        try {
            const n = await tornV2(`/faction/news?striptags=true&limit=100&sort=DESC&from=${now - 3 * 86400}&to=${now}&cat=armoryAction`, key);
            const list = Array.isArray(n.news) ? n.news : Object.values(n.news || {});
            bloodLines = list.map(e => String(e.text || e.news || '').replace(/<[^>]+>/g, '')).filter(t => /blood/i.test(t)).slice(0, 15);
        } catch (e) { bloodLines = [`(could not read the armory feed: ${e.message})`]; }
        // Members' own keys can read their own activity log (if the key is Limited access or higher),
        // which is where per-stat gym energy would come from. Find the gym log types and show a few
        // real entries so the exact fields are known before anything is built on them.
        let gymTypes = {}, gymSample = null, gymError = null;
        try {
            const lt = await (await fetch(`https://api.torn.com/torn/?selections=logtypes&key=${encodeURIComponent(key)}`)).json();
            for (const [id, title] of Object.entries(lt.logtypes || {})) if (/gym|train/i.test(String(title))) gymTypes[id] = title;
            const ids = Object.keys(gymTypes).slice(0, 10).join(',');
            if (ids) {
                const lg = await (await fetch(`https://api.torn.com/user/?selections=log&log=${ids}&limit=4&key=${encodeURIComponent(key)}`)).json();
                if (lg.error) gymError = lg.error.error; else gymSample = JSON.stringify(lg.log || lg, null, 1).slice(0, 2500);
            }
        } catch (e) { gymError = e.message; }
        // Which access level is the key, and does the newer (v2) log endpoint accept it where v1 didn't?
        let keyInfo = null, gymSampleV2 = null;
        try {
            const ki = await (await fetch(`https://api.torn.com/key/?selections=info&key=${encodeURIComponent(key)}`)).json();
            keyInfo = ki.error ? `error: ${ki.error.error}` : `${ki.access_type || ki.access_level || JSON.stringify(ki).slice(0, 200)}`;
        } catch (e) { keyInfo = `error: ${e.message}`; }
        try {
            const lg2 = await (await fetch(`https://api.torn.com/v2/user/log?log=5300,5301,5302,5303&limit=3&key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } })).json();
            gymSampleV2 = lg2.error ? `error: ${lg2.error.error}` : JSON.stringify(lg2.log || lg2, null, 1).slice(0, 2500);
        } catch (e) { gymSampleV2 = `error: ${e.message}`; }
        // The newer (v2) personal-stats endpoint can expose more stats than the old one (Torn Intel talks
        // of 217+). List every name it returns that the old one didn't, plus anything gym/energy-like.
        let v2Extra = null, v2Gym = null, v2Error = null;
        try {
            const p2 = await (await fetch(`https://api.torn.com/v2/user/personalstats?cat=all&key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } })).json();
            if (p2.error) v2Error = p2.error.error;
            else {
                const flat = {};
                const walk = (o) => { if (Array.isArray(o)) { for (const x of o) if (x && x.name !== undefined) flat[x.name] = x.value; } else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (v && typeof v === 'object') walk(v); else flat[k] = v; } };
                walk(p2.personalstats || p2);
                const old = new Set(Object.keys(d.personalstats || {}));
                v2Extra = Object.keys(flat).filter(k => !old.has(k)).sort();
                v2Gym = Object.fromEntries(Object.entries(flat).filter(([k]) => /gym|train|energy|spent|refill|drink/i.test(k)));
            }
        } catch (e) { v2Error = e.message; }
        return { statKeys: Object.keys(d.personalstats || {}).length, allKeys: Object.keys(d.personalstats || {}).sort(), stats, bloodLines, gymTypes, gymSample, gymError, keyInfo, gymSampleV2, v2Extra, v2Gym, v2Error };
    }

    // Discovery for the "energy left before the next upgrade" countdown: what does Torn tell us about the
    // faction's upgrades (levels, costs, progress)? Shows the raw answer of the old and the new endpoint.
    if (action === 'mo-probe-upgrades') {
        const cut = (o, n = 6000) => JSON.stringify(o).slice(0, n); // compact, so more fits
        const out = {};
        try { const d = await (await fetch(`https://api.torn.com/faction/?selections=upgrades&key=${encodeURIComponent(key)}`)).json(); out.v1 = d.error ? `error: ${d.error.error}` : cut(d.upgrades || d); } catch (e) { out.v1 = `error: ${e.message}`; }
        try { const d = await (await fetch(`https://api.torn.com/v2/faction/upgrades?key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } })).json(); out.v2 = d.error ? `error: ${d.error.error}` : cut(d); } catch (e) { out.v2 = `error: ${e.message}`; }
        // The Steadfast "challenge" (energy spent on training a stat) is not in the upgrades list. The contributors
        // endpoint is what the game's "All challenge contributors" uses — try the likely stat names and show what each says.
        // The faction's own totals per stat (the challenge counters are very likely these): keep the gym ones.
        try {
            const d = await (await fetch(`https://api.torn.com/v2/faction/stats?key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } })).json();
            const list = Array.isArray(d.stats) ? d.stats : Object.entries(d.stats || d).map(([name, value]) => ({ name, value }));
            out.fstats = d.error ? `error: ${d.error.error}` : JSON.stringify(list.filter(s => /gym|energy|train/i.test(String(s.name)))).slice(0, 1500);
        } catch (e) { out.fstats = `error: ${e.message}`; }
        out.contrib = {};
        for (const stat of ['gymspeed', 'gymstrength', 'gymdefense', 'gymdexterity']) {
            try {
                const d = await (await fetch(`https://api.torn.com/v2/faction/contributors?stat=${stat}&key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } })).json();
                out.contrib[`v2 ${stat}`] = d.error ? `error: ${d.error.error}` : cut(d, 350);
            } catch (e) { out.contrib[`v2 ${stat}`] = `error: ${e.message}`; }
        }
        try { const d = await (await fetch(`https://api.torn.com/faction/?selections=contributors&stat=gymspeed&key=${encodeURIComponent(key)}`)).json(); out.contrib['v1 gymspeed'] = d.error ? `error: ${d.error.error}` : cut(d, 350); } catch (e) { out.contrib['v1 gymspeed'] = `error: ${e.message}`; }
        return out;
    }

    throw new Error('Unknown action');
}

module.exports = { moHandle, moMe };
