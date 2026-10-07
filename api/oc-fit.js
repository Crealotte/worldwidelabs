// api/oc-fit.js — WorldWideLabs OC 2.0 personal fit tracker.
// Self-building catalog: whatever scenarios/roles Torn's API actually shows this member
// (currently live in their faction) get cached under their own player ID. Anything not
// currently live stays visible with its last-known CPR, clearly marked as cached/stale,
// rather than disappearing — exactly like a real player's own mental model of "what I know
// about my fit," refreshed opportunistically whenever they open the tracker.
//
// CPR itself comes straight from Torn's own API (checkpoint_pass_rate on each OC slot) —
// for an OPEN slot this is Torn's own prediction of THIS caller's pass rate if they joined.
// Role "weight" (how much a role matters to a scenario's success) comes from tornprobability.com's
// public, community-maintained API — the same open source used by several Torn tools — cached
// briefly server-side so we're not hammering their service on every single request.
//
// Category hints (e.g. "leans on Battle Stats") are our own simple keyword classification based
// on Torn's own wiki description of how CPR works, not a precise formula — presented as general
// guidance, not gospel.
//
// POST { key, action: 'read' }               -> the caller's full cached+refreshed OC fit catalog
//                                                (personal tracker — also feeds everything below)
// POST { key, action: 'team-catalog' }        -> leader-only: every scenario+role the faction has
//                                                ever seen (live or cached), aggregated across all
//                                                members' own trackers, plus any saved team plan
// POST { key, action: 'team-plan-save' }      -> leader-only: save a role->member assignment plan
//                                                for one scenario (a planning board, not an auto-joiner —
//                                                Torn's API is read-only, members still join manually)
// POST { key, action: 'team-plan-clear' }     -> leader-only: remove a scenario's saved plan
//
// Completed-crime rewards are also captured (self-building, minimal first step toward a future
// full reporting feature) whenever a leader loads the team catalog, to power rough payout estimates.

const { tornFetch } = require('../lib/tornFetch');
const { factionAllowed, DENIED: ACCESS_DENIED } = require('../lib/access');
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const ROLE_WEIGHTS_KEY = 'wwl:oc-role-weights';
const ROLE_WEIGHTS_TTL_MS = 12 * 60 * 60 * 1000; // refresh community weight data at most every 12h

async function redis(command) {
    const res = await fetch(REDIS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.result;
}

const fitKey = (playerId) => `wwl:ocfit:${playerId}`;

async function getFactionId(key) {
    const r = await tornFetch(`https://api.torn.com/user/?selections=profile&key=${encodeURIComponent(key)}`);
    const profile = await r.json();
    if (profile.error || !profile.faction?.faction_id) return null;
    return String(profile.faction.faction_id);
}
async function isLeader(key) {
    const r = await tornFetch(`https://api.torn.com/v2/faction/balance?key=${encodeURIComponent(key)}`,
        { headers: { accept: 'application/json' } });
    const d = await r.json();
    return !d.error;
}

// Normalises an OC/scenario name for stable grouping (strips version suffixes like "V2").
function normScenario(name) {
    return (name || 'Unknown').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/\s+v\d+$/i, '').trim();
}
function normRole(name) {
    return (name || '').toLowerCase().trim();
}

// Category hints — a mix of well-documented mechanics (Torn wiki + forum guides, some
// confirmed by staff) and honest community observations that are still unconfirmed.
// Each rule says explicitly which tier it is so nobody mistakes a guess for a fact.
const CATEGORY_RULES = [
    { keywords: ['negotiator'], label: 'Crime Skills (confirmed)',
      hint: 'Confirmed by Torn staff: leans on your Hustling and Scamming Crime Skills. Grind those two crimes directly.' },
    { keywords: ['assassin'], label: 'Hunting Skill (documented)',
      hint: 'Leans on your Hunting Skill specifically, not generic Battle Stats — raised by hunting animals.' },
    { keywords: ['driver', 'hijacker'], label: 'Racing Skill (documented)',
      hint: 'Leans on your Racing Skill specifically — raised by competing in races.' },
    { keywords: ['reviver'], label: 'Reviving Skill (documented)',
      hint: 'Leans on your Reviving Skill specifically — raised by reviving other players.' },
    { keywords: ['muscle', 'enforcer', 'sniper'], label: 'Battle Stats',
      hint: 'Tends to lean on Battle Stats (Strength/Defense-style roles) — train in the gym.' },
    { keywords: ['bomber'], label: 'Crime Skills (unconfirmed)',
      hint: 'Community reports (not officially confirmed, and somewhat conflicting) point to Forgery, Disposal, and/or Cracking. Worth trying, not guaranteed.' },
    { keywords: ['cat burglar'], label: 'Crime Skills (unconfirmed)',
      hint: 'Community observation (unconfirmed) suggests Burglary and/or Shoplifting.' },
    { keywords: ['robber'], label: 'Crime Skills (unconfirmed)',
      hint: 'Community observation (unconfirmed) suggests Shoplifting.' },
    { keywords: ['thief', 'pickpocket', 'picklock', 'looter', 'burglar', 'car thief'], label: 'Crime Skills (theft, general)',
      hint: 'Likely tied to one or more theft-category crimes (Burglary, Shoplifting, Pickpocketing) — the exact one isn\'t confirmed, but this category is a reasonable bet.' },
    { keywords: ['hacker'], label: 'Crime Skills (unconfirmed)',
      hint: 'Possibly Cracking (the cybercrime skill) — thematically likely, not confirmed.' },
    { keywords: ['hustler', 'imitator', 'scammer'], label: 'Crime Skills (social)',
      hint: 'Tends to lean on social Crime Skills like Hustling and Scamming.' },
    { keywords: ['techie', 'engineer'], label: 'Technical Skills',
      hint: 'Tends to lean on technical Crime Skills — exact crime unconfirmed.' },
    { keywords: ['interrogator', 'kidnapper'], label: 'Crime Skills (coercion)',
      hint: 'Tends to lean on coercion-style Crime Skills — exact crime unconfirmed.' },
    { keywords: ['lookout'], label: 'Awareness/Support', hint: 'A support-style role — likely benefits from general experience more than one specific stat.' },
];
function categorize(roleName) {
    const r = normRole(roleName);
    for (const rule of CATEGORY_RULES) {
        if (rule.keywords.some(k => r.includes(k))) return rule;
    }
    return { label: 'Mixed', hint: 'No strong single pattern — likely a mix of skills specific to this role.' };
}

async function getRoleWeights() {
    try {
        const raw = await redis(['GET', ROLE_WEIGHTS_KEY]);
        const cached = raw ? JSON.parse(raw) : null;
        if (cached && Date.now() - cached.fetchedAt < ROLE_WEIGHTS_TTL_MS) return { weights: cached.weights, source: 'cache' };

        const res = await fetch('https://tornprobability.com:3000/api/GetRoleWeights');
        if (!res.ok) {
            console.error(`[oc-fit] tornprobability returned HTTP ${res.status}`);
            throw new Error(`HTTP ${res.status}`);
        }
        const weights = await res.json();
        if (!weights || typeof weights !== 'object' || !Object.keys(weights).length) {
            console.error('[oc-fit] tornprobability returned an empty/unexpected response:', JSON.stringify(weights).slice(0, 300));
            throw new Error('Empty or unexpected response shape');
        }
        await redis(['SET', ROLE_WEIGHTS_KEY, JSON.stringify({ weights, fetchedAt: Date.now() })]);
        return { weights, source: 'live' };
    } catch (e) {
        console.error('[oc-fit] getRoleWeights failed:', e.message);
        // Fall back to whatever we last cached (even if stale) rather than showing nothing —
        // weight is a nice-to-have, not required for CPR itself.
        try {
            const raw = await redis(['GET', ROLE_WEIGHTS_KEY]);
            return { weights: raw ? JSON.parse(raw).weights : {}, source: raw ? 'stale-cache' : 'unavailable' };
        } catch (e2) {
            return { weights: {}, source: 'unavailable' };
        }
    }
}

// Torn occasionally renames OC roles, and tornprobability's dataset doesn't always catch up
// immediately — "Imitator" was renamed from "Impersonator" is one confirmed case from the
// community. This lets a role match under either name rather than silently missing.
const ROLE_ALIASES = {
    imitator: ['impersonator'],
    impersonator: ['imitator'],
};

// Strips anything that isn't a letter or number so minor punctuation/spacing differences
// between Torn's own role names and tornprobability's keys don't cause a missed match.
function looseKey(name) {
    return (name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');
}

function findWeight(weights, scenarioName, roleName) {
    const scenarioCandidates = [normScenario(scenarioName), scenarioName, looseKey(scenarioName)];
    let roles = null;
    for (const key of scenarioCandidates) {
        const found = Object.keys(weights || {}).find(k => looseKey(k) === looseKey(key));
        if (found) { roles = weights[found]; break; }
    }
    if (!roles) return null;

    const roleName2 = normRole(roleName);
    const namesToTry = [roleName2, ...(ROLE_ALIASES[roleName2] || [])];
    for (const [r, w] of Object.entries(roles)) {
        if (namesToTry.some(n => looseKey(r) === looseKey(n))) return w;
    }
    return null;
}


// Same thresholds the original OC Manager script used as sensible defaults.
const WEIGHT_HIGH = 25;
const WEIGHT_LOW = 15;
const CPR_WARN = 70;

// How long a cached entry can go without being seen live again before we quietly drop it,
// so old one-off observations (a role that was open once, months ago) don't accumulate
// forever and clutter the tracker with stale debris.
const CATALOG_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const ACTIVE_STATUSES = new Set(['recruiting', 'planning', 'ready', 'blocked', 'awaiting', 'initiated']);

// Builds a map of every role that exists in every currently-live OC instance — filled or open,
// not just open ones. A role occupied by someone who's never opened their own OC Fit Tracker
// would otherwise be completely invisible, which was the bigger of two bugs found here. Shared
// between the leader's Team Builder and each member's own personal tracker, so both benefit.
function buildLiveRoleSkeleton(crimesList) {
    const liveByKey = {}; // `${difficulty}::${normScenario}` -> { scenario, difficulty, roles: { normRole: {role, open} } }
    for (const oc of crimesList) {
        if (!oc || !ACTIVE_STATUSES.has((oc.status || '').toLowerCase())) continue;
        const difficulty = oc.difficulty ?? '?';
        const scenario = oc.name || 'Unknown';
        const sKey = `${difficulty}::${normScenario(scenario)}`;
        const slots = Array.isArray(oc.slots) ? oc.slots : Object.values(oc.slots || []);
        if (!liveByKey[sKey]) liveByKey[sKey] = { scenario, difficulty, roles: {} };
        for (const slot of slots) {
            const role = slot.position_info?.label || slot.position || 'Unknown role';
            const rKey = normRole(role);
            const isOpen = !slot.user?.id;
            const already = liveByKey[sKey].roles[rKey];
            liveByKey[sKey].roles[rKey] = { role, open: isOpen || (already?.open ?? false) };
        }
    }
    return liveByKey;
}

module.exports = async function handler(req, res) {
    try {
        if (!REDIS_URL || !REDIS_TOKEN) {
            return res.status(500).json({ error: 'Database not connected. In Vercel: Storage -> Create Database -> Upstash Redis, and connect it to this project.' });
        }
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

        const { key, action } = req.body || {};
        if (!key) return res.status(400).json({ error: 'Missing key' });

        if (action === 'team-catalog') {
            if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });
            const factionId = await getFactionId(key);
            if (!factionId) return res.status(403).json({ error: 'Could not determine your faction from this key' });
            if (!(await factionAllowed(factionId))) return res.status(403).json(ACCESS_DENIED); // only factions on the owner's list may use WWL

            // One faction-crimes pull, reused for open-slot detection AND completed-crime capture.
            const crimesRes = await tornFetch(`https://api.torn.com/v2/faction?selections=crimes&key=${encodeURIComponent(key)}`,
                { headers: { accept: 'application/json' } });
            const crimesData = await crimesRes.json();
            if (crimesData.error) return res.status(403).json({ error: crimesData.error.error || 'Could not load faction crimes' });
            const crimesList = Object.values(crimesData.crimes || {});

            // ---- Capture completed-crime rewards (minimal first step, self-building over time) ----
            const seenKey = `wwl:oc-rewards-seen:${factionId}`;
            const rewardsKey = `wwl:oc-rewards:${factionId}`;
            const ocDailyKey = `wwl:oc-respect-daily:${factionId}`;
            const rewardsRaw = await redis(['GET', rewardsKey]);
            const rewards = rewardsRaw ? JSON.parse(rewardsRaw) : {};
            const ocDailyRaw = await redis(['GET', ocDailyKey]);
            const ocDaily = ocDailyRaw ? JSON.parse(ocDailyRaw) : {};
            let rewardsChanged = false;
            for (const oc of crimesList) {
                if (!oc || !oc.executed_at) continue;
                const status = (oc.status || '').toLowerCase();
                if (!['successful', 'failed', 'expired'].includes(status)) continue;
                const added = await redis(['SADD', seenKey, String(oc.id)]);
                if (added !== 1) continue; // already counted on a previous visit
                const sKey = normScenario(oc.name);
                if (!rewards[sKey]) rewards[sKey] = { scenario: oc.name || sKey, difficulty: oc.difficulty ?? '?', totalMoney: 0, totalRespect: 0, successCount: 0, totalRuns: 0 };
                rewards[sKey].totalRuns++;
                if (status === 'successful') {
                    rewards[sKey].successCount++;
                    rewards[sKey].totalMoney += Number(oc.rewards?.money ?? 0);
                    rewards[sKey].totalRespect += Number(oc.rewards?.respect ?? 0);
                    // Also bucket by calendar day, feeding the Respect Tracker's daily breakdown —
                    // shares this same completion-detection pass so nothing gets counted twice.
                    const dayKey = new Date(oc.executed_at * 1000).toISOString().slice(0, 10);
                    ocDaily[dayKey] = (ocDaily[dayKey] || 0) + Number(oc.rewards?.respect ?? 0);
                }
                rewardsChanged = true;
            }
            if (rewardsChanged) {
                await redis(['SET', rewardsKey, JSON.stringify(rewards)]);
                await redis(['SET', ocDailyKey, JSON.stringify(ocDaily)]);
            }

            // ---- Which scenarios/roles are live right now, and which of those are still open ----
            const liveByKey = buildLiveRoleSkeleton(crimesList);

            // ---- Aggregate every member's own cached fit catalog into one faction-wide view ----
            const membersRes = await tornFetch(`https://api.torn.com/v2/faction/members?striptags=true&key=${encodeURIComponent(key)}`,
                { headers: { accept: 'application/json' } });
            const membersData = await membersRes.json();
            const members = membersData.members || [];

            const merged = {}; // sKey -> { scenario, difficulty, roles: { normRole: { role, candidates:[] } } }
            for (const m of members) {
                const id = String(m.id);
                const raw = await redis(['GET', fitKey(id)]);
                if (!raw) continue;
                const catalog = JSON.parse(raw);
                for (const entry of Object.values(catalog)) {
                    // Skip placeholder entries (roles this member has never personally had a real
                    // CPR for — just filled-by-teammate awareness for their own tracker). Without
                    // this, a null cpr behaves like 0 in sorting/math and quietly shows up as a
                    // fake "0%" candidate here — that's exactly the bug that just got reported.
                    if (entry.noPersonalData || entry.cpr == null) continue;
                    const sKey = `${entry.difficulty}::${normScenario(entry.scenario)}`;
                    if (!merged[sKey]) merged[sKey] = { scenario: entry.scenario, difficulty: entry.difficulty, roles: {} };
                    const rKey = normRole(entry.role);
                    if (!merged[sKey].roles[rKey]) merged[sKey].roles[rKey] = { role: entry.role, candidates: [] };
                    merged[sKey].roles[rKey].candidates.push({ id, name: m.name, cpr: entry.cpr, live: entry.live, lastSeenLive: entry.lastSeenLive });
                }
            }
            // Every role in every currently-live OC instance needs to show up, even ones nobody's
            // personal tracker has ever cached — self-building, faction-wide, filled or open alike.
            for (const [sKey, live] of Object.entries(liveByKey)) {
                if (!merged[sKey]) merged[sKey] = { scenario: live.scenario, difficulty: live.difficulty, roles: {} };
                for (const [rKeyNorm, info] of Object.entries(live.roles)) {
                    if (!merged[sKey].roles[rKeyNorm]) merged[sKey].roles[rKeyNorm] = { role: info.role, candidates: [] };
                }
            }

            const { weights } = await getRoleWeights();
            const plansRaw = await redis(['GET', `wwl:ocplan:${factionId}`]);
            const plans = plansRaw ? JSON.parse(plansRaw) : {};

            const scenarios = Object.entries(merged).map(([sKey, data]) => {
                const live = liveByKey[sKey] || null;
                const rewardInfo = rewards[normScenario(data.scenario)] || null;
                const plan = plans[sKey] || null;
                const roles = Object.entries(data.roles).map(([rKeyNorm, r]) => {
                    const sortedCandidates = [...r.candidates].sort((a, b) => b.cpr - a.cpr);
                    const weight = findWeight(weights, data.scenario, r.role);
                    const isOpen = !!live?.roles[rKeyNorm]?.open;
                    const assigned = plan?.roles?.[rKeyNorm] || null;
                    return { roleKey: rKeyNorm, role: r.role, candidates: sortedCandidates, weight, open: isOpen, assigned };
                }).sort((a, b) => (b.weight ?? -1) - (a.weight ?? -1));

                return {
                    scenarioKey: sKey, scenario: data.scenario, difficulty: data.difficulty,
                    live: !!live, openSlotCount: live ? Object.values(live.roles).filter(r => r.open).length : 0,
                    roles,
                    estimatedPayout: rewardInfo && rewardInfo.successCount > 0
                        ? { money: Math.round(rewardInfo.totalMoney / rewardInfo.successCount), respect: Math.round(rewardInfo.totalRespect / rewardInfo.successCount), sample: rewardInfo.successCount }
                        : null,
                };
            }).sort((a, b) => (Number(a.difficulty) || 0) - (Number(b.difficulty) || 0));

            return res.status(200).json({ scenarios });
        }

        if (action === 'team-plan-save') {
            if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });
            const factionId = await getFactionId(key);
            if (!factionId) return res.status(403).json({ error: 'Could not determine your faction from this key' });
            if (!(await factionAllowed(factionId))) return res.status(403).json(ACCESS_DENIED); // only factions on the owner's list may use WWL
            const { scenarioKey, scenario, difficulty, roles } = req.body; // roles: { normRole: {memberId, memberName} | null }
            if (!scenarioKey) return res.status(400).json({ error: 'Missing scenarioKey' });
            const plansRaw = await redis(['GET', `wwl:ocplan:${factionId}`]);
            const plans = plansRaw ? JSON.parse(plansRaw) : {};
            plans[scenarioKey] = { scenario, difficulty, roles: roles || {}, savedAt: Date.now() };
            await redis(['SET', `wwl:ocplan:${factionId}`, JSON.stringify(plans)]);
            return res.status(200).json({ ok: true });
        }

        if (action === 'team-plan-clear') {
            if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });
            const factionId = await getFactionId(key);
            if (!factionId) return res.status(403).json({ error: 'Could not determine your faction from this key' });
            if (!(await factionAllowed(factionId))) return res.status(403).json(ACCESS_DENIED); // only factions on the owner's list may use WWL
            const { scenarioKey } = req.body;
            if (!scenarioKey) return res.status(400).json({ error: 'Missing scenarioKey' });
            const plansRaw = await redis(['GET', `wwl:ocplan:${factionId}`]);
            const plans = plansRaw ? JSON.parse(plansRaw) : {};
            delete plans[scenarioKey];
            await redis(['SET', `wwl:ocplan:${factionId}`, JSON.stringify(plans)]);
            return res.status(200).json({ ok: true });
        }

        if (action !== 'read') return res.status(400).json({ error: 'Unknown action' });

        // Live pull: whatever this member's faction currently has spawned, from their own POV.
        const liveRes = await tornFetch(`https://api.torn.com/v2/user?selections=organizedcrimes,profile&key=${encodeURIComponent(key)}`,
            { headers: { accept: 'application/json' } });
        const liveData = await liveRes.json();
        if (liveData.error) return res.status(403).json({ error: liveData.error.error || 'Torn rejected the key' });

        const myId = String(liveData.profile?.id || '');
        const crimes = liveData.organizedcrimes || liveData.organized_crimes || {};
        const { weights, source: weightsSource } = await getRoleWeights();

        // Payout estimates are captured per-faction (see team-catalog above) — attach them here
        // too so every member sees "here's roughly what this crime pays" on their own tracker.
        const factionId = await getFactionId(key);
        let rewards = {};
        if (factionId) {
            const rewardsRaw = await redis(['GET', `wwl:oc-rewards:${factionId}`]);
            rewards = rewardsRaw ? JSON.parse(rewardsRaw) : {};
        }

        // Best-effort: if this member's key happens to have faction API access, use it to see
        // EVERY role in every live crime — filled or open — same as the leader's Team Builder.
        // Torn will never reveal a personal CPR prediction for a role someone else occupies, so
        // those show up as "no data yet" rather than a number, but at least the role itself won't
        // be invisible just because it happened to be filled when this member checked. If the key
        // doesn't have that access, this silently does nothing — no error shown to the member.
        let liveRoleSkeleton = {};
        try {
            const crimesRes = await tornFetch(`https://api.torn.com/v2/faction?selections=crimes&key=${encodeURIComponent(key)}`,
                { headers: { accept: 'application/json' } });
            const crimesData = await crimesRes.json();
            if (!crimesData.error) liveRoleSkeleton = buildLiveRoleSkeleton(Object.values(crimesData.crimes || {}));
        } catch (e) { /* no faction API access on this key — fine, just skip the supplement */ }

        // Load this player's existing cached catalog.
        const existingRaw = await redis(['GET', fitKey(myId)]);
        const catalog = existingRaw ? JSON.parse(existingRaw) : {}; // key: `${difficulty}::${normScenario}::${normRole}`

        const now = Date.now();
        const seenNow = new Set();

        for (const oc of Object.values(crimes)) {
            if (!oc || typeof oc !== 'object') continue;
            const difficulty = oc.difficulty ?? '?';
            const scenario = oc.name || 'Unknown';
            const slots = Array.isArray(oc.slots) ? oc.slots : Object.values(oc.slots || []);
            for (const slot of slots) {
                // Only slots that represent THIS caller's own fit: open slots (Torn predicts their
                // own CPR there) or a slot they're actually occupying right now.
                const occupantId = slot.user?.id ? String(slot.user.id) : null;
                if (occupantId && occupantId !== myId) continue;
                const role = slot.position_info?.label || slot.position || 'Unknown role';
                const cpr = slot.checkpoint_pass_rate ?? null;
                if (cpr === null) continue;

                const entryKey = `${difficulty}::${normScenario(scenario)}::${normRole(role)}`;
                seenNow.add(entryKey);
                const cat = categorize(role);
                const rewardInfo = rewards[normScenario(scenario)] || null;
                catalog[entryKey] = {
                    difficulty, scenario, role, cpr,
                    weight: findWeight(weights, scenario, role),
                    category: cat.label,
                    categoryHint: cat.hint,
                    lastSeenLive: now,
                    live: true,
                    estimatedPayout: rewardInfo && rewardInfo.successCount > 0
                        ? { money: Math.round(rewardInfo.totalMoney / rewardInfo.successCount), respect: Math.round(rewardInfo.totalRespect / rewardInfo.successCount), sample: rewardInfo.successCount }
                        : null,
                };
            }
        }

        // Fill in any role this member has never personally had open, but that genuinely exists
        // right now (learned from the supplemental faction-wide call above, same as Team Builder).
        // These get no CPR — Torn never reveals that for a role someone else occupies — but at
        // least the role itself is visible instead of silently missing.
        for (const [sKey, live] of Object.entries(liveRoleSkeleton)) {
            const [difficulty] = sKey.split('::');
            for (const info of Object.values(live.roles)) {
                const entryKey = `${difficulty}::${normScenario(live.scenario)}::${normRole(info.role)}`;
                seenNow.add(entryKey);
                if (catalog[entryKey]) continue; // real personal data already captured above — don't overwrite it
                const cat = categorize(info.role);
                const rewardInfo = rewards[normScenario(live.scenario)] || null;
                catalog[entryKey] = {
                    difficulty, scenario: live.scenario, role: info.role, cpr: null,
                    weight: findWeight(weights, live.scenario, info.role),
                    category: cat.label,
                    categoryHint: cat.hint,
                    lastSeenLive: now,
                    live: true,
                    noPersonalData: true,
                    estimatedPayout: rewardInfo && rewardInfo.successCount > 0
                        ? { money: Math.round(rewardInfo.totalMoney / rewardInfo.successCount), respect: Math.round(rewardInfo.totalRespect / rewardInfo.successCount), sample: rewardInfo.successCount }
                        : null,
                };
            }
        }

        // Anything not observed just now is stale (still shown, just marked as cached) —
        // unless it's been stale for a long time, in which case it's dropped entirely rather
        // than accumulating forever as dead weight (e.g. a role that was open once, months ago).
        for (const [k, entry] of Object.entries(catalog)) {
            if (!seenNow.has(k)) {
                entry.live = false;
                if (now - entry.lastSeenLive > CATALOG_MAX_AGE_MS) delete catalog[k];
            }
        }

        await redis(['SET', fitKey(myId), JSON.stringify(catalog)]);

        return res.status(200).json({ catalog: Object.values(catalog), weightsSource });
    } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
    }
};
