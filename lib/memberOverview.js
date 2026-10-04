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

const { tornFetch } = require('./tornFetch');
const { sleep, isRateLimited } = require('./warHits');
const { energyBetween } = require('./steadfast');
const { importIntelText } = require('./energyImport');
const { syncForward: syncArmoryConsumption, digDeeper: digDeeperArmoryConsumption, armoryConsumedBetween } = require('./armoryConsumption');

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
    const r = await tornFetch(`https://api.torn.com/v2${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } });
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
        const r = await tornFetch(`https://api.torn.com/v2/faction/attacks?from=${from}&to=${to}&sort=ASC&key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } });
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

// ---- Linked chains and chain events -------------------------------------------------------------------
// The war rule counts chain hits only from a war's start to 24h after it ends, so a chain thrown later
// (to use up faction-paid energy) counted for nothing — and a chain done INSTEAD of a war counted nowhere.
// A leader can now (1) link chains to a war, and (2) create a "chain event" that takes a slot among the
// last 5 like a war does (it has no war hits, so it's passed with the chain-hit minimum).
//
// Stored per faction: { events: [{ id, name, start, end }], links: { <warId or eventId>: [chainId, ...] } }.
// A linked chain's per-member hits come from Torn's chain report — the same numbers the payout calculator
// uses: hits in that chain that were NOT war hits (attacks.total - attacks.war) — and are remembered once
// per chain (a finished chain never changes). Nothing here changes what a war's own automatic count stores.
const extraKey = (f) => `wwl:mo-extra:${f}`;
const chainKey = (f, chainId) => `wwl:mo-chain:${f}:${chainId}`; // { hits: { attackerId: nonWarHits }, total, at }
const MAX_EVENTS = 20, MAX_CHAINS_PER_ITEM = 30;

async function loadExtra(redis, factionId) {
    try {
        const raw = await redis(['GET', extraKey(factionId)]);
        const e = raw ? JSON.parse(raw) : {};
        return { events: Array.isArray(e.events) ? e.events : [], links: e.links && typeof e.links === 'object' ? e.links : {}, ignored: Array.isArray(e.ignored) ? e.ignored : [] };
    } catch (err) { return { events: [], links: {}, ignored: [] }; } // this is an add-on: never let it break the page it decorates
}
const saveExtra = (redis, factionId, extra) => redis(['SET', extraKey(factionId), JSON.stringify(extra)]);
const eventAsWar = (e) => ({ id: e.id, start: e.start, end: e.end, opponent: e.name, event: true });
const isEventId = (id) => /^e[0-9a-z]+$/.test(String(id));

// Accepts a bare ID or a pasted Torn link (…chainID=123456 / …/chainreport/123456).
function parseChainId(v) {
    const s = String(v ?? '').trim();
    const m = s.match(/chainID=(\d+)/i) || s.match(/(\d{3,})\s*$/) || s.match(/^(\d+)$/);
    return m ? m[1] : null;
}

// One chain's non-war hits per member, from Torn's chain report.
async function fetchChainHits(key, chainId) {
    const d = await tornV2(`/faction/${chainId}/chainreport`, key);
    const report = d.chainreport;
    if (!report) throw new Error(`Chain #${chainId} has no report yet — is it finished, and is it your faction's?`);
    const hits = {};
    for (const att of (report.attackers || [])) {
        const nonWar = Math.max(0, (att.attacks?.total ?? 0) - (att.attacks?.war ?? 0));
        if (nonWar > 0) hits[String(att.id)] = nonWar;
    }
    return { hits, total: report.details?.chain ?? null, at: Math.floor(Date.now() / 1000) };
}

// Linked-chain hits per item id, for the given items, in ONE round trip: { itemId: { attackerId: hits } | null }
// plus each chain's total for display. Sums the chains linked to an item.
async function linkedForItems(redis, factionId, extra, itemIds) {
    const chainIds = [...new Set(itemIds.flatMap(id => extra.links[id] || []))];
    const out = {}, totals = {};
    if (!chainIds.length) return { linked: out, totals };
    const raws = await redis(['MGET', ...chainIds.map(c => chainKey(factionId, c))]);
    const byChain = {};
    chainIds.forEach((c, i) => { try { byChain[c] = raws[i] ? JSON.parse(raws[i]) : null; } catch (e) { byChain[c] = null; } if (byChain[c]) totals[c] = byChain[c].total; });
    for (const id of itemIds) {
        const ids = extra.links[id] || [];
        if (!ids.length) continue;
        const sum = {};
        for (const c of ids) for (const [a, n] of Object.entries(byChain[c]?.hits || {})) sum[a] = (sum[a] || 0) + n;
        out[id] = sum;
    }
    return { linked: out, totals };
}

// Combine a war's own automatic count with the chains the register assigns to it. Once a war has assigned
// chains, THEY are its chain hits and the automatic chain scan is dropped for that war (the war hits stay).
// A chain belongs to exactly one war or event (see assignChain), so nothing is counted twice: not by two
// wars, and not by the automatic scan plus an assigned chain covering the same hits.
function mergeLinked(base, linked) {
    const out = {};
    for (const [id, v] of Object.entries(base || {})) out[id] = { ...v, chain: linked?.[id] || 0 };
    for (const [id, n] of Object.entries(linked || {})) if (!out[id]) out[id] = { war: 0, chain: n };
    return out;
}

// ---- The register: every chain belongs to one war, one chain event, "ignored", or nothing yet ----
// Puts a chain in exactly one place (removing it from anywhere else), so it can never be counted twice.
// target: a war id, a chain event id, 'ignore', or '' (back to unassigned).
function assignChain(extra, chainId, target) {
    for (const k of Object.keys(extra.links)) {
        extra.links[k] = extra.links[k].filter(c => c !== chainId);
        if (!extra.links[k].length) delete extra.links[k];
    }
    extra.ignored = extra.ignored.filter(c => c !== chainId);
    if (target === 'ignore') extra.ignored.push(chainId);
    else if (target) extra.links[target] = [...(extra.links[target] || []), chainId];
}

// Torn's list of our completed chains, newest first: [{ id, length, respect, start, end }]
async function listChains(key) {
    const d = await tornV2('/faction/chains?limit=100&sort=desc', key);
    const list = Array.isArray(d.chains) ? d.chains : Object.values(d.chains || {});
    return list.filter(c => c && c.id && c.end).map(c => ({ id: String(c.id), length: c.chain ?? null, respect: c.respect ?? null, start: c.start, end: c.end }))
        .sort((a, b) => b.end - a.end);
}

// The war a chain most likely belongs to: the one whose window (start → 24h after its end) it overlaps most.
function suggestWar(chain, wars) {
    let best = null, bestOverlap = 0;
    for (const w of wars) {
        const overlap = Math.min(chain.end, w.end + 86400) - Math.max(chain.start, w.start);
        if (overlap > bestOverlap) { best = w.id; bestOverlap = overlap; }
    }
    return best;
}

// Candy/Alcohol/Blood-bags used to come from Torn's personal lifetime stats (candyused/alcoholused/
// bloodwithdrawn) diffed between two snapshots — replaced because those count EVERYTHING a member has
// ever done, any source, not specifically what came out of THIS faction's own armory (which is what a
// leader actually means, and what they can check by hand in the real armory log). See
// lib/armoryConsumption.js for the real, armory-news-sourced replacement. energydrinkused was dropped
// entirely per the leader's request — not tracked here or as a competition any more.

// ---- Member dashboard card ("My standing"), open to every member ------------------------------------
// Same periods as the page for leaders: weeks run Sunday to Sunday; the newsletter comes out the first
// Sunday of each month, so "this month" is the running period since the last first-Sunday (or the last
// finished one if nothing has run yet).
const DAY = 86400;
function firstSunday(y, m) { const first = new Date(Date.UTC(y, m, 1)); return Math.floor(Date.UTC(y, m, 1 + (7 - first.getUTCDay()) % 7) / 1000); }
function currentPeriod(now) {
    const d = new Date(now * 1000);
    // The running period counts every day up to and including today — not just full weeks — so
    // something a member does midweek shows up right away instead of waiting for Sunday.
    const today = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
    const dates = [];
    for (let i = 0; dates.length < 3 && i < 12; i++) {
        const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
        const t = firstSunday(dt.getUTCFullYear(), dt.getUTCMonth());
        if (t <= now) dates.push(t);
    }
    const running = today > dates[0];
    const start = running ? dates[0] : dates[1], end = running ? today : dates[0];
    // The month as planned (first Sunday to the next first Sunday) — 4 or 5 weeks — for the energy requirement.
    const nd = new Date(start * 1000);
    let nextFirst = firstSunday(nd.getUTCFullYear(), nd.getUTCMonth() + 1);
    if (nextFirst <= start) nextFirst = firstSunday(nd.getUTCFullYear(), nd.getUTCMonth() + 2);
    return { start, end, running, prevStart: (running ? dates[1] : dates[2]) || start, plannedEnd: nextFirst, plannedWeeks: Math.round((nextFirst - start) / (7 * DAY)) };
}

async function readOwnBattleStats(key) {
    const r = await tornFetch(`https://api.torn.com/user/?selections=personalstats&key=${encodeURIComponent(key)}`);
    const d = await r.json();
    const ps = d.personalstats || {};
    let total = Number(ps.totalstats);
    if (!Number.isFinite(total) || total <= 0) total = ['strength', 'defense', 'speed', 'dexterity'].reduce((s, k) => s + (Number(ps[k]) || 0), 0);
    return total > 0 ? total : null;
}

// Everything the caller's dashboard card shows. Uses the caller's own key only for their own battle
// stats (which Torn shows only to the owner); the rest is read from what leaders' pages already stored.

// Members who said "I can't make this war" in the war availability tracker. A plan is tied to a war (by id, or
// failing that by a start time within 12 hours); whoever hit the button on that plan told the faction beforehand,
// so that war is not held against them — `before` says whether they did it before the war started (a flag set
// later is still shown, but does not excuse). Returns { warId: { memberId: { note, at, before } } }.
// Only the few plans that match one of the wars are read, never the whole list.
async function loadExcuses(redis, factionId, wars, info) {
    const out = {};
    const real = (wars || []).filter(w => !w.event);
    if (!real.length) return out;
    let plans = null;
    try { plans = JSON.parse(await redis(['GET', `wwl:availability-index:${factionId}`]) || 'null'); } catch (e) { plans = null; }
    if (!plans) { // a tracker from before plans existed has just the one record
        try { const legacy = JSON.parse(await redis(['GET', `wwl:availability:${factionId}`]) || 'null'); plans = legacy ? [{ id: 'main', war: legacy.war, startDate: legacy.startDate, days: legacy.days, name: legacy.name }] : []; } catch (e) { plans = []; }
    }
    const DAY_S = 86400;
    // A plan belongs to a war if it is linked to it (by id, or a start time within 12 hours), or — when it was never
    // linked to any war — if the days it covers overlap the war (a day of slack each side). Every matching plan counts.
    const planMatches = (p, w) => {
        if (p.war && (p.war.id || p.war.start)) return String(p.war.id) === String(w.id) || (!!p.war.start && Math.abs(Number(p.war.start) - w.start) < 12 * 3600);
        const s = Date.parse(`${p.startDate}T00:00:00Z`) / 1000;
        if (!Number.isFinite(s) || !p.days) return false;
        return s < w.end + DAY_S && s + p.days * DAY_S > w.start - DAY_S;
    };
    for (const w of real) {
        const matched = plans.filter(p => planMatches(p, w));
        if (info) info[w.id] = matched.map(p => p.name || p.startDate || p.id); // which plans were looked at, so a missing excuse can be traced
        for (const plan of matched) {
            try {
                const raw = await redis(['GET', plan.id === 'main' ? `wwl:availability:${factionId}` : `wwl:availability:${factionId}:${plan.id}`]);
                const un = raw ? (JSON.parse(raw).unavailable || {}) : {};
                for (const [id, u] of Object.entries(un)) {
                    const prev = out[w.id]?.[id];
                    const e = { note: u.note || '', at: u.at || 0, before: !!u.at && u.at / 1000 <= w.start };
                    if (!prev || (e.before && !prev.before)) (out[w.id] = out[w.id] || {})[id] = e; // keep the one that excuses
                }
            } catch (e) { /* this plan just shows no excuses */ }
        }
    }
    return out;
}
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
    // Each item's hits per member: its own automatic count, combined with any chains a leader linked to it.
    // A chain event has no automatic count of its own (nothing to scan), only what's linked.
    const extra = await loadExtra(redis, factionId);
    const { linked } = await linkedForItems(redis, factionId, extra, wars.map(w => w.id));
    const perWarHits = wars.map((w, i) => {
        const base = cached[i] ? JSON.parse(cached[i]) : (w.event && linked[w.id] ? {} : null); // an event only counts once a chain is linked
        if (!base) return null;
        return linked[w.id] ? mergeLinked(base, linked[w.id]) : base;
    });
    const excused = await loadExcuses(redis, factionId, wars);
    const joinedBy = daysInFaction == null ? 0 : now - daysInFaction * DAY;
    const warRows = [];
    let okWars = 0, eligible = 0;
    wars.slice().sort((a, b) => a.end - b.end).forEach(w => {
        const all = perWarHits[wars.findIndex(x => x.id === w.id)];
        if (!all) { warRows.push({ opponent: w.opponent, end: w.end, unknown: true }); return; }
        const h = all[playerId] || {};
        const p = { opponent: w.opponent, end: w.end, event: !!w.event, war: h.war || 0, chain: h.chain || 0 };
        const ex = excused[w.id]?.[playerId];
        if (joinedBy > w.start) p.notIn = true;
        else {
            p.ok = p.war >= settings.minWarHits || (p.war < settings.minWarHits && p.chain >= settings.minChainHits);
            if (ex) p.excused = { note: ex.note, before: ex.before };
            // Said beforehand they could not make it: a war they missed for that reason is not held against them.
            if (ex?.before && !p.ok) p.skipped = true;
            else { eligible++; if (p.ok) okWars++; }
        }
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
            if (!perWarHits[i]) return;
            // The war/chain-hit COMPETITION only counts a war or event that ended within THIS newsletter period —
            // "wars" here is the rolling last 5 (for the 3-of-5 rule above), and one of those can easily still be
            // sitting in the "last 5" during the NEXT period's newsletter too, which would hand out the same
            // hits as a competition win twice. The 3-of-5 rule itself is unaffected — it stays about the last 5.
            if (w.end < period.start || (!period.running && w.end >= period.end)) return; // a running period includes a war that ended today
            const h = perWarHits[i];
            for (const m of roster) { cats.war[m.id] = (cats.war[m.id] || 0) + (h[m.id]?.war || 0); cats.chain[m.id] = (cats.chain[m.id] || 0) + (h[m.id]?.chain || 0); }
        });
        // Every roster member gets a real number (0 if they used nothing) once the tracker has any
        // coverage at all — someone absent from the armory log genuinely did nothing, that's not
        // "unknown", so they still get ranked (rather than sitting on "place not known yet" forever).
        const consumed = await armoryConsumedBetween(redis, factionId, period.start, period.end);
        for (const s of ['candyused', 'alcoholused', 'bloodwithdrawn']) {
            cats[s] = {};
            if (consumed.hasData) for (const m of roster) cats[s][m.id] = consumed.perMember[m.id]?.[s] || 0;
        }
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

    // This member's own Xanax picture for the period, from what a leader has already loaded on the evaluation page (the saved
    // per-war answers and the last deposits read) — nothing is read from Torn here. Only wars that ended inside the period count; each
    // Xanax covers 10 hits (rounded up); deposits go against the oldest war first. `known` is false until a leader has checked every war.
    let xanax = null;
    try {
        const pw = wars.filter(w => !w.event && w.end >= period.prevStart).sort((a, b) => a.end - b.end);
        if (pw.length) {
            const raws = await redis(['MGET', ...pw.map(w => `wwl:xanax-war:${factionId}:${w.id}:48`)]);
            const depRaw = await redis(['GET', `wwl:xanax-dep-last:${factionId}`]);
            const dep = depRaw ? JSON.parse(depRaw) : null;
            const myName = String((roster.find(x => x.id === playerId) || {}).name || '').toLowerCase();
            const mine = map => (map && (map[playerId] || Object.values(map).find(v => String(v.name).toLowerCase() === myName))) || null;
            const rows = [];
            pw.forEach((w, i) => {
                if (!raws[i]) return;
                const taken = (mine(JSON.parse(raws[i]).taken) || { n: 0 }).n;
                const h = (perWarHits[wars.findIndex(x => x.id === w.id)] || {})[playerId] || {};
                const hits = (h.war || 0) + (h.chain || 0), covered = Math.ceil(hits / 10);
                rows.push({ opponent: w.opponent, start: w.start, taken, hits, covered, returned: 0, outstanding: 0 });
            });
            // Hits above what the Xanax taken needed in one war (a surplus) balance out a shortfall in another war of the period — e.g. someone who
            // took one too many in the first war and made up for it by hitting enough for it in the next. Surplus is used against the oldest
            // shortfall first; what is left after that is what has to be put back.
            let pool = rows.reduce((s, r) => s + Math.max(0, r.covered - r.taken), 0);
            for (const r of rows) { r.over = Math.max(0, r.taken - r.covered); r.offset = Math.min(r.over, pool); pool -= r.offset; r.owed = r.over - r.offset; }
            const depOk = !!dep && dep.v === 2 && dep.from <= Math.min(...pw.map(w => w.start)) - 48 * 3600 + 3600; // v2 = deposits saved with their times
            if (depOk) allocateDeposits(rows, (mine(dep.deposited) || {}).events); else for (const r of rows) { r.returned = 0; r.outstanding = r.owed; }
            xanax = { known: rows.length > 0, wars: rows, owed: rows.reduce((s, r) => s + r.owed, 0), returned: rows.reduce((s, r) => s + r.returned, 0), outstanding: rows.reduce((s, r) => s + r.outstanding, 0), depositsAt: depOk ? dep.at : null, total: pw.length };
        }
    } catch (e) { /* the card just shows no Xanax figure */ }

    return {
        total, tier, tierSource: manual ? 'leader' : 'auto', weeklyEnergy: weekly,
        period: { start: period.start, end: period.end, running: period.running, plannedWeeks: period.plannedWeeks, plannedEnd: period.plannedEnd },
        energyNeeded: weekly ? weekly * period.plannedWeeks : null,
        wars: warRows, okWars, eligible, need, rule: { minWarHits: settings.minWarHits, minChainHits: settings.minChainHits, needWars: settings.needWars },
        places, energy, xanax,
    };
}

// The war rule for several members at once, worked out from what is stored (nothing is read from Torn): in how many of the last 5 wars each one met
// the minimum. Same rule as moMe above, used for the Chemist role ("the war rule met in 3 of the last 5 wars").
async function moWarOk({ redis, factionId, members }) {
    const now = Math.floor(Date.now() / 1000);
    const settingsRaw = await redis(['GET', settingsKey(factionId)]);
    const settings = { ...DEFAULT_SETTINGS, ...(settingsRaw ? JSON.parse(settingsRaw) : {}) };
    const warsRaw = await redis(['GET', warsKey(factionId)]);
    const wars = warsRaw ? JSON.parse(warsRaw) : [];
    const cached = wars.length ? await redis(['MGET', ...wars.map(w => warKey(factionId, w.id))]) : [];
    const extra = await loadExtra(redis, factionId);
    const { linked } = await linkedForItems(redis, factionId, extra, wars.map(w => w.id));
    const perWarHits = wars.map((w, i) => {
        const base = cached[i] ? JSON.parse(cached[i]) : (w.event && linked[w.id] ? {} : null);
        if (!base) return null;
        return linked[w.id] ? mergeLinked(base, linked[w.id]) : base;
    });
    const excused = await loadExcuses(redis, factionId, wars);
    const ok = {};
    for (const m of members) {
        const joinedBy = m.days == null ? 0 : now - m.days * DAY;
        let n = 0;
        wars.forEach((w, i) => {
            if (!perWarHits[i] || joinedBy > w.start) return;
            const h = perWarHits[i][m.id] || {};
            const pass = (h.war || 0) >= settings.minWarHits || ((h.war || 0) < settings.minWarHits && (h.chain || 0) >= settings.minChainHits);
            const ex = excused[w.id]?.[m.id];
            if (ex?.before && !pass) return; // said beforehand they could not make it: not held against them
            if (pass) n++;
        });
        ok[m.id] = n;
    }
    return { ok, need: settings.needWars };
}

async function hgetall(redis, key) {
    const flat = (await redis(['HGETALL', key])) || [];
    const out = {};
    for (let i = 0; i < flat.length; i += 2) out[flat[i]] = flat[i + 1];
    return out;
}

async function moHandle(action, body, { redis, key, factionId }) {
    if (action === 'mo-get') {
        const [membersData, realWars, rawSettings, tiers, extra] = await Promise.all([
            tornV2('/faction/members?striptags=true', key),
            recentWars(key, factionId, 5), // the war rule looks at the last 5 wars, rolling
            redis(['GET', settingsKey(factionId)]),
            hgetall(redis, tiersKey(factionId)),
            loadExtra(redis, factionId),
        ]);
        // Keep the armory-consumption log up to date automatically — usually a no-op (a day or two's
        // gap at most). Never let this block the page if it fails.
        try { await syncArmoryConsumption(key, factionId, redis); } catch (e) { /* picked up again next visit */ }
        // The last 5 items counted: real wars and chain events together, newest first — a chain event
        // takes a slot exactly as a war does.
        const wars = [...realWars, ...extra.events.map(eventAsWar)].sort((a, b) => b.end - a.end).slice(0, 5);
        const cached = wars.length ? await redis(['MGET', ...wars.map(w => warKey(factionId, w.id))]) : [];
        const { linked, totals: chainTotals } = await linkedForItems(redis, factionId, extra, wars.map(w => w.id));
        const hits = {};
        wars.forEach((w, i) => {
            // An event has no automatic count, only its linked chains — and until one is linked it isn't counted
            // at all (otherwise a brand-new empty event would mark every member as having failed that slot).
            const base = cached[i] ? JSON.parse(cached[i]) : (w.event && linked[w.id] ? {} : null);
            if (base) hits[w.id] = linked[w.id] ? mergeLinked(base, linked[w.id]) : base;
        });
        const excusedInfo = {};
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
        // Cross-check: chains newer than the oldest counted item that the register hasn't placed anywhere yet
        // (they may hold hits that count for nobody). Best effort — never breaks the page.
        let unassigned = null;
        try {
            const since = Math.min(...wars.map(w => w.start), Infinity);
            const placed = new Set([...Object.values(extra.links).flat(), ...extra.ignored]);
            unassigned = (await listChains(key)).filter(c => c.end >= since && !placed.has(c.id)).length;
        } catch (e) { /* no warning shown */ }
        return {
            excused: await loadExcuses(redis, factionId, wars, excusedInfo),
            excusedInfo,
            members, wars, hits, tiers, autoTier, energyTarget: ENERGY_TARGET, settings: { ...DEFAULT_SETTINGS, ...(rawSettings ? JSON.parse(rawSettings) : {}) },
            extra: { events: extra.events, links: extra.links, chainTotals, unassigned },
        };
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
        // Combined with any chains linked to this war, same as mo-get does — the page stores whatever this returns.
        const extra = await loadExtra(redis, factionId);
        const { linked } = await linkedForItems(redis, factionId, extra, [war.id]);
        return { warId: war.id, hits: linked[war.id] ? mergeLinked(result.perMember, linked[war.id]) : result.perMember, partial: result.partial };
    }

    // ---- linked chains and chain events (see the block of helpers near the top) ----
    // Link a chain to a war or to a chain event. Reads the chain's report NOW, with the leader's key (members'
    // own keys can't read it), so a wrong or unfinished chain is refused here rather than silently counting 0.
    if (action === 'mo-link-chain') {
        const itemId = String(body.itemId || '');
        const chainId = parseChainId(body.chainId);
        if (!chainId) throw new Error('Paste a chain ID, or the link to its chain report.');
        const extra = await loadExtra(redis, factionId);
        if (isEventId(itemId)) { if (!extra.events.some(e => e.id === itemId)) throw new Error('That chain event no longer exists.'); }
        else if (!(await recentWars(key, factionId, 12)).some(w => w.id === itemId)) throw new Error('War not found.');
        const list = extra.links[itemId] || [];
        if (list.includes(chainId)) throw new Error(`Chain #${chainId} is already linked here.`);
        if (list.length >= MAX_CHAINS_PER_ITEM) throw new Error(`Up to ${MAX_CHAINS_PER_ITEM} chains per war or event.`);
        const chain = await fetchChainHits(key, chainId);
        await redis(['SET', chainKey(factionId, chainId), JSON.stringify(chain)]);
        assignChain(extra, chainId, itemId);
        await saveExtra(redis, factionId, extra);
        return { ok: true, chainId, total: chain.total, membersWithHits: Object.keys(chain.hits).length };
    }

    // ---- the register: all wars and chains in one place (page: Member Overview → War & chain register) ----
    if (action === 'mo-reg-get') {
        const [wars, chains, extra] = await Promise.all([recentWars(key, factionId, 30), listChains(key), loadExtra(redis, factionId)]);
        const owner = {};
        for (const [item, ids] of Object.entries(extra.links)) for (const c of ids) owner[c] = item;
        const rows = chains.map(c => ({
            ...c,
            target: owner[c.id] || (extra.ignored.includes(c.id) ? 'ignore' : ''),
            suggest: owner[c.id] || extra.ignored.includes(c.id) ? null : suggestWar(c, wars),
        }));
        return { wars, chains: rows, events: extra.events };
    }
    if (action === 'mo-reg-assign') {
        const chainId = parseChainId(body.chainId);
        const target = String(body.target || '');
        if (!chainId) throw new Error('Unknown chain.');
        const extra = await loadExtra(redis, factionId);
        if (target && target !== 'ignore') {
            if (isEventId(target)) { if (!extra.events.some(e => e.id === target)) throw new Error('That chain event no longer exists.'); }
            else if (!(await recentWars(key, factionId, 30)).some(w => w.id === target)) throw new Error('War not found.');
            if ((extra.links[target] || []).filter(c => c !== chainId).length >= MAX_CHAINS_PER_ITEM) throw new Error(`Up to ${MAX_CHAINS_PER_ITEM} chains per war or event.`);
            // read the report now so a wrong or unfinished chain is refused here, not silently counted as 0
            await redis(['SET', chainKey(factionId, chainId), JSON.stringify(await fetchChainHits(key, chainId))]);
        }
        assignChain(extra, chainId, target);
        await saveExtra(redis, factionId, extra);
        return { ok: true };
    }
    if (action === 'mo-unlink-chain') {
        const itemId = String(body.itemId || ''), chainId = parseChainId(body.chainId);
        const extra = await loadExtra(redis, factionId);
        extra.links[itemId] = (extra.links[itemId] || []).filter(c => c !== chainId);
        if (!extra.links[itemId].length) delete extra.links[itemId];
        await saveExtra(redis, factionId, extra);
        return { ok: true };
    }
    // A chain event: a chain done instead of a war. `date` is the day it happened; it counts from the start of
    // that day and is treated as ended by the end of it (only used to order it among the last 5 and to judge who
    // was in the faction yet — the hits themselves come from the chains linked to it).
    if (action === 'mo-event-save') {
        const name = String(body.name || '').trim().slice(0, 40);
        const date = String(body.date || '');
        if (name.length < 2) throw new Error('Give the chain event a name.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Pick the date of the chain event.');
        const start = Math.floor(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 1000);
        if (!(start > 1.4e9 && start < 4e9)) throw new Error('That date does not look right.');
        const extra = await loadExtra(redis, factionId);
        if (extra.events.length >= MAX_EVENTS) throw new Error(`Up to ${MAX_EVENTS} chain events — delete an old one first.`);
        const id = `e${Date.now().toString(36)}`;
        extra.events.push({ id, name, start, end: start + 86399 });
        await saveExtra(redis, factionId, extra);
        return { ok: true, id };
    }
    if (action === 'mo-event-delete') {
        const id = String(body.id || '');
        const extra = await loadExtra(redis, factionId);
        extra.events = extra.events.filter(e => e.id !== id);
        delete extra.links[id];
        await saveExtra(redis, factionId, extra);
        return { ok: true };
    }

    // Candy/Alcohol/Blood-bags actually used from or filled for THIS faction's armory, over a period —
    // see lib/armoryConsumption.js. Mirrors 'mo-energy' below.
    if (action === 'mo-consumption') {
        const from = Number(body.from), to = Number(body.to);
        if (!(from > 0 && to > from)) throw new Error('Missing period');
        return await armoryConsumedBetween(redis, factionId, from, to);
    }

    // Leader-pressed backfill: reaches further back into the armory news log than the automatic sync
    // (which only ever creeps forward from whenever this first started recording) has covered.
    if (action === 'mo-consumption-deepsync') {
        return await digDeeperArmoryConsumption(key, factionId, redis);
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
        return await importIntelText(redis, factionId, roster, text, key);
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
        const r = await tornFetch(`https://api.torn.com/user/?selections=personalstats&key=${encodeURIComponent(key)}`);
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
            const lt = await (await tornFetch(`https://api.torn.com/torn/?selections=logtypes&key=${encodeURIComponent(key)}`)).json();
            for (const [id, title] of Object.entries(lt.logtypes || {})) if (/gym|train/i.test(String(title))) gymTypes[id] = title;
            const ids = Object.keys(gymTypes).slice(0, 10).join(',');
            if (ids) {
                const lg = await (await tornFetch(`https://api.torn.com/user/?selections=log&log=${ids}&limit=4&key=${encodeURIComponent(key)}`)).json();
                if (lg.error) gymError = lg.error.error; else gymSample = JSON.stringify(lg.log || lg, null, 1).slice(0, 2500);
            }
        } catch (e) { gymError = e.message; }
        // Which access level is the key, and does the newer (v2) log endpoint accept it where v1 didn't?
        let keyInfo = null, gymSampleV2 = null;
        try {
            const ki = await (await tornFetch(`https://api.torn.com/key/?selections=info&key=${encodeURIComponent(key)}`)).json();
            keyInfo = ki.error ? `error: ${ki.error.error}` : `${ki.access_type || ki.access_level || JSON.stringify(ki).slice(0, 200)}`;
        } catch (e) { keyInfo = `error: ${e.message}`; }
        try {
            const lg2 = await (await tornFetch(`https://api.torn.com/v2/user/log?log=5300,5301,5302,5303&limit=3&key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } })).json();
            gymSampleV2 = lg2.error ? `error: ${lg2.error.error}` : JSON.stringify(lg2.log || lg2, null, 1).slice(0, 2500);
        } catch (e) { gymSampleV2 = `error: ${e.message}`; }
        // The newer (v2) personal-stats endpoint can expose more stats than the old one (Torn Intel talks
        // of 217+). List every name it returns that the old one didn't, plus anything gym/energy-like.
        let v2Extra = null, v2Gym = null, v2Error = null;
        try {
            const p2 = await (await tornFetch(`https://api.torn.com/v2/user/personalstats?cat=all&key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } })).json();
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
        try { const d = await (await tornFetch(`https://api.torn.com/faction/?selections=upgrades&key=${encodeURIComponent(key)}`)).json(); out.v1 = d.error ? `error: ${d.error.error}` : cut(d.upgrades || d); } catch (e) { out.v1 = `error: ${e.message}`; }
        try { const d = await (await tornFetch(`https://api.torn.com/v2/faction/upgrades?key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } })).json(); out.v2 = d.error ? `error: ${d.error.error}` : cut(d); } catch (e) { out.v2 = `error: ${e.message}`; }
        // The Steadfast "challenge" (energy spent on training a stat) is not in the upgrades list. The contributors
        // endpoint is what the game's "All challenge contributors" uses — try the likely stat names and show what each says.
        // The faction's own totals per stat (the challenge counters are very likely these): keep the gym ones.
        try {
            const d = await (await tornFetch(`https://api.torn.com/v2/faction/stats?key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } })).json();
            const list = Array.isArray(d.stats) ? d.stats : Object.entries(d.stats || d).map(([name, value]) => ({ name, value }));
            out.fstats = d.error ? `error: ${d.error.error}` : JSON.stringify(list.filter(s => /gym|energy|train/i.test(String(s.name)))).slice(0, 1500);
        } catch (e) { out.fstats = `error: ${e.message}`; }
        out.contrib = {};
        for (const stat of ['gymspeed', 'gymstrength', 'gymdefense', 'gymdexterity']) {
            try {
                const d = await (await tornFetch(`https://api.torn.com/v2/faction/contributors?stat=${stat}&key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } })).json();
                out.contrib[`v2 ${stat}`] = d.error ? `error: ${d.error.error}` : cut(d, 350);
            } catch (e) { out.contrib[`v2 ${stat}`] = `error: ${e.message}`; }
        }
        try { const d = await (await tornFetch(`https://api.torn.com/faction/?selections=contributors&stat=gymspeed&key=${encodeURIComponent(key)}`)).json(); out.contrib['v1 gymspeed'] = d.error ? `error: ${d.error.error}` : cut(d, 350); } catch (e) { out.contrib['v1 gymspeed'] = `error: ${e.message}`; }
        return out;
    }

    throw new Error('Unknown action');
}


// Matches a member's deposits (each with the time it was made: [[timestamp, quantity], ...]) against what they owe per war, oldest war
// first. A deposit only counts for a war if it was made from that war's START on (not the stocking up before it),
// and one deposit is used once. rows: [{ start, owed }] in war order; fills in `returned` and `outstanding`.
function allocateDeposits(rows, events) {
    const evs = (events || []).map(([t, n]) => ({ t, n })).sort((a, b) => a.t - b.t);
    for (const r of rows) {
        let need = r.owed;
        for (const e of evs) {
            if (need <= 0) break;
            if (e.n <= 0 || e.t < r.start) continue;
            const use = Math.min(need, e.n); e.n -= use; need -= use;
        }
        r.returned = r.owed - need; r.outstanding = need;
    }
    return rows;
}

// Everyone's outstanding Xanax for the current period, worked out ONCE from what is already saved (the per-war Xanax answers, the war hits
// Member Overview stored, the last deposits read) and kept in one hash — so the script's To do can show "N Xanax to put back" with a single
// cheap lookup per member instead of recomputing it. Nothing is read from Torn. Same rules as the evaluation: only wars that ended inside
// the period, 10 hits per Xanax (rounded up), a spare in one war balances a shortfall in another, deposits count against the oldest war first.
// Returns { count } = how many members have something to put back; { incomplete: true } when a war of the period has not been checked yet
// (then the stored list is cleared rather than left stale).
const xanaxOwedKey = (f) => `wwl:xanax-owed:${f}`;
async function moXanaxAll({ redis, factionId }) {
    const period = currentPeriod(Math.floor(Date.now() / 1000));
    const warsRaw = await redis(['GET', warsKey(factionId)]);
    const wars = warsRaw ? JSON.parse(warsRaw) : [];
    const pw0 = wars.filter(w => !w.event && w.end >= period.prevStart).sort((a, b) => a.end - b.end);
    const clear = async () => { await redis(['DEL', xanaxOwedKey(factionId)]); };
    if (!pw0.length) { await clear(); return { count: 0 }; }
    const raws0 = await redis(['MGET', ...pw0.map(w => `wwl:xanax-war:${factionId}:${w.id}:48`)]);
    const cached0 = await redis(['MGET', ...pw0.map(w => warKey(factionId, w.id))]);
    // wars a leader has not checked yet (or whose hits are not stored) are left out instead of blocking everyone's list
    const keep = pw0.map((w, i) => !!raws0[i] && !!cached0[i]);
    const pw = pw0.filter((w, i) => keep[i]), raws = raws0.filter((r, i) => keep[i]), cached = cached0.filter((c, i) => keep[i]);
    if (!pw.length) { await clear(); return { count: 0, incomplete: true }; }
    const results = raws.map(r => JSON.parse(r));
    const extra = await loadExtra(redis, factionId);
    const { linked } = await linkedForItems(redis, factionId, extra, pw.map(w => w.id));
    const hitsByWar = pw.map((w, i) => (linked[w.id] ? mergeLinked(JSON.parse(cached[i]), linked[w.id]) : JSON.parse(cached[i])));
    const depRaw = await redis(['GET', `wwl:xanax-dep-last:${factionId}`]);
    const dep = depRaw ? JSON.parse(depRaw) : null;
    const depOk = !!dep && dep.v === 2 && dep.from <= Math.min(...pw.map(w => w.start)) - 48 * 3600 + 3600; // v2 = deposits saved with their times
    const rosterRaw = await redis(['GET', rosterKey(factionId)]);
    const roster = rosterRaw ? JSON.parse(rosterRaw) : [];
    const findIn = (map, id, name) => (map && (map[id] || Object.values(map).find(v => String(v.name).toLowerCase() === name))) || null;
    const fields = [];
    let count = 0;
    for (const m of roster) {
        const name = String(m.name || '').toLowerCase();
        const rows = pw.map((w, i) => {
            const taken = (findIn(results[i].taken, m.id, name) || { n: 0 }).n;
            const h = hitsByWar[i][m.id] || {};
            const covered = Math.ceil(((h.war || 0) + (h.chain || 0)) / 10);
            return { start: pw[i].start, taken, covered, over: Math.max(0, taken - covered) };
        });
        let pool = rows.reduce((s, r) => s + Math.max(0, r.covered - r.taken), 0);
        for (const r of rows) { const offset = Math.min(r.over, pool); pool -= offset; r.owed = r.over - offset; }
        const owed = rows.reduce((s, r) => s + r.owed, 0);
        // a deposit only counts for a war if it was made after that war ended; without the deposits (or saved in the old form) nothing is returned yet
        if (depOk) allocateDeposits(rows, (findIn(dep.deposited, m.id, name) || {}).events); else for (const r of rows) r.outstanding = r.owed;
        const outstanding = rows.reduce((s, r) => s + r.outstanding, 0);
        if (outstanding > 0) { count++; fields.push(String(m.id), JSON.stringify({ outstanding, owed, at: Date.now(), depositsAt: depOk ? dep.at : null })); }
    }
    await clear();
    if (fields.length) await redis(['HSET', xanaxOwedKey(factionId), ...fields]);
    return { count };
}

// The full competition standings for the Competition page (Faction menu) — open to every member, so the newsletter
// can say "the full standings are on WWL". Built only from what is already stored (roster, the last 5 wars' hits,
// the armory log, the energy snapshots), so a member's own key is enough and nothing is read from Torn here.
// Two periods: the one still running (up to and including today) and the last one that finished.
async function moStandings({ redis, factionId }) {
    const now = Math.floor(Date.now() / 1000);
    const d = new Date(now * 1000);
    const today = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
    const dates = []; // first Sundays up to now, newest first
    for (let i = 0; dates.length < 3 && i < 12; i++) {
        const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
        const t = firstSunday(dt.getUTCFullYear(), dt.getUTCMonth());
        if (t <= now) dates.push(t);
    }
    const periods = {
        last: { start: dates[1], end: dates[0], running: false },
        ...(today > dates[0] ? { now: { start: dates[0], end: now, running: true } } : {}),
    };

    const rosterRaw = await redis(['GET', rosterKey(factionId)]);
    const roster = rosterRaw ? JSON.parse(rosterRaw) : [];
    const names = Object.fromEntries(roster.map(m => [m.id, m.name]));

    const warsRaw = await redis(['GET', warsKey(factionId)]);
    const wars = warsRaw ? JSON.parse(warsRaw) : [];
    const cached = wars.length ? await redis(['MGET', ...wars.map(w => warKey(factionId, w.id))]) : [];
    const extra = await loadExtra(redis, factionId);
    const { linked } = await linkedForItems(redis, factionId, extra, wars.map(w => w.id));
    const perWarHits = wars.map((w, i) => {
        const base = cached[i] ? JSON.parse(cached[i]) : (w.event && linked[w.id] ? {} : null);
        if (!base) return null;
        return linked[w.id] ? mergeLinked(base, linked[w.id]) : base;
    });

    const out = {};
    for (const [name, p] of Object.entries(periods)) {
        const vals = { war: {}, chain: {}, candy: {}, alcohol: {}, blood: {}, energy: {} };
        wars.forEach((w, i) => {
            if (!perWarHits[i]) return;
            // only a war or event that ended inside this period counts for it (a running one includes a war that ended today)
            if (w.end < p.start || (!p.running && w.end >= p.end)) return;
            for (const m of roster) {
                vals.war[m.id] = (vals.war[m.id] || 0) + (perWarHits[i][m.id]?.war || 0);
                vals.chain[m.id] = (vals.chain[m.id] || 0) + (perWarHits[i][m.id]?.chain || 0);
            }
        });
        let consumptionKnown = false, energyKnown = false;
        try {
            const c = await armoryConsumedBetween(redis, factionId, p.start, p.end);
            consumptionKnown = !!c.hasData;
            if (c.hasData) for (const m of roster) {
                vals.candy[m.id] = c.perMember[m.id]?.candyused || 0;
                vals.alcohol[m.id] = c.perMember[m.id]?.alcoholused || 0;
                vals.blood[m.id] = c.perMember[m.id]?.bloodwithdrawn || 0;
            }
        } catch (e) { /* those competitions just show no data */ }
        try {
            const e = await energyBetween(redis, factionId, p.start, p.end);
            energyKnown = e.snapshots > 0;
            if (energyKnown) for (const m of roster) vals.energy[m.id] = e.perMember[m.id]?.total || 0;
        } catch (e) { /* no energy competition */ }
        const cats = [
            ['war', 'War hits', wars.length > 0], ['chain', 'Chain hits', wars.length > 0],
            ['candy', 'Candy used', consumptionKnown], ['alcohol', 'Alcohol used', consumptionKnown], ['blood', 'Blood bags filled', consumptionKnown],
            ['energy', 'Energy trained', energyKnown],
        ];
        out[name] = {
            start: p.start, end: p.end, running: p.running,
            categories: cats.map(([key, label, known]) => ({
                key, label, known,
                rows: Object.entries(vals[key]).filter(([id, v]) => v > 0 && names[id]).sort((a, b) => b[1] - a[1]).map(([id, v]) => ({ id, name: names[id], value: v })),
            })),
        };
    }
    return out;
}
module.exports = { moHandle, moMe, moStandings, moXanaxAll, moWarOk, xanaxOwedKey, loadExtra, isEventId };
