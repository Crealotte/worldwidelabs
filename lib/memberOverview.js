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

const settingsKey = (f) => `wwl:mo-settings:${f}`;
const tiersKey = (f) => `wwl:mo-tiers:${f}`;
const warKey = (f, warId) => `wwl:mo-war:${f}:${warId}`;
const ENERGY_TARGET = { high: 4400, low: 2200 };
const DEFAULT_SETTINGS = { minHitsPerWar: 10, warPoints: 1, chainPoints: 1 };

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
async function scanWar(key, factionId, war) {
    const perMember = {};
    const to = Math.min(war.end + 86400, Math.floor(Date.now() / 1000));
    const started = Date.now();
    let from = war.start, pages = 0, partial = false;
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
    return { perMember, partial, pages };
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
        if (v === undefined || v === null || !Number.isFinite(Number(v))) return null; // unreadable — don't cache a guess
        out[s] = Number(v);
    }
    return out;
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
            recentWars(key, factionId, 12), // enough history for a 4-5 week newsletter period (or a custom range)
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
        return { members, wars, hits, tiers, energyTarget: ENERGY_TARGET, settings: { ...DEFAULT_SETTINGS, ...(rawSettings ? JSON.parse(rawSettings) : {}) } };
    }

    if (action === 'mo-war') {
        const war = (await recentWars(key, factionId, 12)).find(w => w.id === String(body.warId));
        if (!war) throw new Error('War not found');
        const result = await scanWar(key, factionId, war);
        if (!result.partial) await redis(['SET', warKey(factionId, war.id), JSON.stringify(result.perMember)]);
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
        let failed = 0;
        for (let i = 0; i < todo.length && Date.now() - started < 40000; i += 5) {
            const batch = todo.slice(i, i + 5);
            const results = await Promise.all(batch.map(async f => {
                const [id, ts] = f.split(':');
                try { return [f, await fetchStats(id, ts, key)]; } catch (e) { return [f, null]; }
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
        return { values, pending: todo.filter(f => !values[f]).length, failed };
    }

    if (action === 'mo-settings') {
        const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
        const s = {
            minHitsPerWar: num(body.minHitsPerWar, DEFAULT_SETTINGS.minHitsPerWar),
            warPoints: num(body.warPoints, DEFAULT_SETTINGS.warPoints),
            chainPoints: num(body.chainPoints, DEFAULT_SETTINGS.chainPoints),
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
        return { statKeys: Object.keys(d.personalstats || {}).length, allKeys: Object.keys(d.personalstats || {}).sort(), stats, bloodLines, gymTypes, gymSample, gymError };
    }

    throw new Error('Unknown action');
}

module.exports = { moHandle };
