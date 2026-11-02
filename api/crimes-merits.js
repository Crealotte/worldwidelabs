// api/crimes-merits.js — tracks which Crimes 2.0 honor bars each faction member has earned.
// Binary only (earned / not earned) — Torn's API doesn't expose a running counter toward honors
// like "5 of 7 rotten items found", only whether the honor itself has been awarded yet. Self-builds
// faction-wide the same way OC Fit does: each member's own key reports their own status when they
// visit, accumulating into a shared view over time.

const { tornFetch } = require('../lib/tornFetch');
const REDIS_URL = require('../lib/env').redisUrl();
const REDIS_TOKEN = require('../lib/env').redisToken();
const HONORS_CACHE_KEY = 'wwl:torn-honors-cache';
const HONORS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Every honor bar we currently track, tied to the crime it belongs to. Extend this as more
// crimes get added to the guide.
const TRACKED_HONORS = [
    { crime: 'searchforcash', name: 'Pay Dirt' },
    { crime: 'searchforcash', name: 'Spoiled Rotten' },
    { crime: 'searchforcash', name: 'Shore Thing' },
    { crime: 'bootlegging', name: 'Box Office' },
    { crime: 'bootlegging', name: 'Online Entrepreneur' },
    { crime: 'bootlegging', name: 'Cinephile' },
    { crime: 'graffiti', name: 'Let Us Spray' },
    { crime: 'graffiti', name: 'Fresh Blud' },
    { crime: 'graffiti', name: 'Urban Legend' },
    { crime: 'shoplifting', name: 'Retail Therapy' },
    { crime: 'shoplifting', name: 'Notorious' },
    { crime: 'shoplifting', name: 'Crown Jewel' },
];

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

async function getFactionId(key) {
    const r = await tornFetch(`https://api.torn.com/user/?selections=profile&key=${encodeURIComponent(key)}`);
    const profile = await r.json();
    if (profile.error || !profile.faction?.faction_id) return null;
    return String(profile.faction.faction_id);
}

// Torn's full honor directory (name -> id) — cached since this barely changes.
async function getHonorDirectory(key) {
    try {
        const raw = await redis(['GET', HONORS_CACHE_KEY]);
        const cached = raw ? JSON.parse(raw) : null;
        if (cached && Date.now() - cached.fetchedAt < HONORS_CACHE_TTL_MS) return cached.honors;

        const res = await tornFetch(`https://api.torn.com/torn/?selections=honors&key=${encodeURIComponent(key)}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error.error);
        await redis(['SET', HONORS_CACHE_KEY, JSON.stringify({ honors: data.honors, fetchedAt: Date.now() })]);
        return data.honors;
    } catch (e) {
        try {
            const raw = await redis(['GET', HONORS_CACHE_KEY]);
            return raw ? JSON.parse(raw).honors : {};
        } catch (e2) { return {}; }
    }
}

module.exports = async function handler(req, res) {
    try {
        if (require('../lib/env').blockUntilTestDb(req, res)) return; // a test site without its own test database stays closed (lib/env.js)
        if (!REDIS_URL || !REDIS_TOKEN) {
            return res.status(500).json({ error: 'Database not connected. In Vercel: Storage -> Create Database -> Upstash Redis, and connect it to this project.' });
        }
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const { key, action } = req.body || {};
        if (!key) return res.status(400).json({ error: 'Missing key' });
        if (action !== 'read') return res.status(400).json({ error: 'Unknown action' });

        const [honorDirectory, myHonorsRes, myProfileRes] = await Promise.all([
            getHonorDirectory(key),
            tornFetch(`https://api.torn.com/user/?selections=honors&key=${encodeURIComponent(key)}`),
            tornFetch(`https://api.torn.com/user/?selections=profile&key=${encodeURIComponent(key)}`),
        ]);
        const myHonorsData = await myHonorsRes.json();
        const myProfile = await myProfileRes.json();
        if (myHonorsData.error) return res.status(403).json({ error: myHonorsData.error.error });
        // honors_awarded is a plain array of honor IDs (e.g. [1, 3, 4, 9, ...]) — confirmed
        // against a real sample. Reading Object.keys() on that (as before) returns array
        // indices ("0","1","2"...) instead of the actual ID values, which is why this silently
        // never matched. Defensively also handle an object-keyed shape in case that ever varies.
        const rawAwarded = myHonorsData.honors_awarded ?? myHonorsData.honors ?? [];
        const myEarnedIds = new Set(
            Array.isArray(rawAwarded) ? rawAwarded.map(String) : Object.keys(rawAwarded)
        );
        const myId = String(myProfile.player_id || '');
        const myName = myProfile.name || 'You';

        // Match each tracked honor name against Torn's directory to find its ID, then check if
        // this player has it. Name matching is case-insensitive since we can't be 100% sure of
        // Torn's exact casing without having tested live.
        const nameToId = {};
        for (const [id, honor] of Object.entries(honorDirectory || {})) {
            if (honor?.name) nameToId[honor.name.toLowerCase()] = id;
        }

        const results = TRACKED_HONORS.map(h => {
            const honorId = nameToId[h.name.toLowerCase()];
            const earned = honorId != null && myEarnedIds.has(honorId);
            return { crime: h.crime, name: h.name, earned, resolvable: honorId != null };
        });

        // Self-building faction record, same pattern as OC Fit — captures this player's status
        // into a shared faction view, so leadership (and eventually everyone) can see coverage
        // build up over time as more members visit this page.
        const factionId = await getFactionId(key);
        if (factionId && myId) {
            for (const r of results) {
                if (!r.resolvable) continue;
                const setKey = `wwl:merit-earned:${factionId}:${r.crime}:${r.name}`;
                if (r.earned) await redis(['SADD', setKey, myId]);
                else await redis(['SREM', setKey, myId]);
            }
            await redis(['SET', `wwl:merit-name:${factionId}:${myId}`, myName]);
        }

        return res.status(200).json({ honors: results });
    } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
    }
};
