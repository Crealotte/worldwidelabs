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
// POST { key, action: 'read' } -> the caller's full cached+refreshed OC fit catalog

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
        if (cached && Date.now() - cached.fetchedAt < ROLE_WEIGHTS_TTL_MS) return cached.weights;

        const res = await fetch('https://tornprobability.com:3000/api/GetRoleWeights');
        const weights = await res.json();
        await redis(['SET', ROLE_WEIGHTS_KEY, JSON.stringify({ weights, fetchedAt: Date.now() })]);
        return weights;
    } catch (e) {
        // If tornprobability is unreachable, fall back to whatever we last cached (even if stale)
        // rather than showing nothing — weight is a nice-to-have, not required for CPR itself.
        try {
            const raw = await redis(['GET', ROLE_WEIGHTS_KEY]);
            return raw ? JSON.parse(raw).weights : {};
        } catch (e2) { return {}; }
    }
}

function findWeight(weights, scenarioName, roleName) {
    const key = normScenario(scenarioName);
    const roles = weights?.[key] || weights?.[scenarioName] || null;
    if (!roles) return null;
    const roleKey = normRole(roleName);
    for (const [r, w] of Object.entries(roles)) {
        if (normRole(r) === roleKey) return w;
    }
    return null;
}

module.exports = async function handler(req, res) {
    try {
        if (!REDIS_URL || !REDIS_TOKEN) {
            return res.status(500).json({ error: 'Database not connected. In Vercel: Storage -> Create Database -> Upstash Redis, and connect it to this project.' });
        }
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

        const { key, action } = req.body || {};
        if (!key) return res.status(400).json({ error: 'Missing key' });
        if (action !== 'read') return res.status(400).json({ error: 'Unknown action' });

        // Live pull: whatever this member's faction currently has spawned, from their own POV.
        const liveRes = await fetch(`https://api.torn.com/v2/user?selections=organizedcrimes,profile&key=${encodeURIComponent(key)}`,
            { headers: { accept: 'application/json' } });
        const liveData = await liveRes.json();
        if (liveData.error) return res.status(403).json({ error: liveData.error.error || 'Torn rejected the key' });

        const myId = String(liveData.profile?.id || '');
        const crimes = liveData.organizedcrimes || liveData.organized_crimes || {};
        const weights = await getRoleWeights();

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
                catalog[entryKey] = {
                    difficulty, scenario, role, cpr,
                    weight: findWeight(weights, scenario, role),
                    category: cat.label,
                    categoryHint: cat.hint,
                    lastSeenLive: now,
                    live: true,
                };
            }
        }

        // Anything not observed just now is stale (still shown, just marked as cached).
        for (const [k, entry] of Object.entries(catalog)) {
            if (!seenNow.has(k)) entry.live = false;
        }

        await redis(['SET', fitKey(myId), JSON.stringify(catalog)]);

        return res.status(200).json({ catalog: Object.values(catalog) });
    } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
    }
};
