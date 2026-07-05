// api/announcement.js — WorldWideLabs faction announcement text (polls live in api/polls.js now —
// they used to be bundled together, which meant editing the text could disturb an active poll,
// and a closed poll had nowhere to go. Keeping them fully separate fixes both).
// The key is ALWAYS sent in the POST body, never a URL query string.
// Multi-faction: resolves the caller's own faction ID from their key, server-side.
//
// POST { key, action:'read' } -> { text, updatedAt } for the caller's faction
// POST { key, text }          -> leaders only: replace THEIR faction's announcement text

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

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
    const r = await fetch(`https://api.torn.com/user/?selections=profile&key=${encodeURIComponent(key)}`);
    const profile = await r.json();
    if (profile.error || !profile.faction?.faction_id) return null;
    return String(profile.faction.faction_id);
}

async function isLeader(key) {
    const r = await fetch(`https://api.torn.com/v2/faction/balance?key=${encodeURIComponent(key)}`,
        { headers: { accept: 'application/json' } });
    const d = await r.json();
    return !d.error;
}

const announcementKey = (factionId) => `wwl:announcement:${factionId}`;

module.exports = async function handler(req, res) {
    try {
        if (!REDIS_URL || !REDIS_TOKEN) {
            return res.status(500).json({ error: 'Database not connected. In Vercel: Storage -> Create Database -> Upstash Redis, and connect it to this project.' });
        }

        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

        const { key, action, text } = req.body || {};
        if (!key) return res.status(400).json({ error: 'Missing key' });

        const factionId = await getFactionId(key);
        if (!factionId) return res.status(403).json({ error: 'Could not determine your faction from this key' });

        if (action === 'read') {
            const raw = await redis(['GET', announcementKey(factionId)]);
            const announcement = raw ? JSON.parse(raw) : null;
            return res.status(200).json({ announcement });
        }

        // Anything else = save this faction's announcement text — leaders only.
        if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });

        const announcement = { text: text || '', updatedAt: Date.now() };
        await redis(['SET', announcementKey(factionId), JSON.stringify(announcement)]);
        return res.status(200).json({ ok: true, announcement });
    } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
    }
};
