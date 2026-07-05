// api/feedback-form.js — WorldWideLabs feedback form + live results chart.
// Multi-faction: resolves the caller's own faction ID from their key (never from the client),
// so each faction gets its own form/chart and one faction's leader can never touch another's.
//
// GET  ?key=...                          -> the caller's faction's current form (title, form/chart URLs)
// POST { key, title, formUrl, chartUrl } -> leaders only: set/replace THEIR faction's form
// POST { key, action:'clear' }           -> leaders only: remove THEIR faction's form

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

const formKey = (factionId) => `wwl:feedback-form:${factionId}`;

module.exports = async function handler(req, res) {
    try {
        if (!REDIS_URL || !REDIS_TOKEN) {
            return res.status(500).json({ error: 'Database not connected. In Vercel: Storage -> Create Database -> Upstash Redis, and connect it to this project.' });
        }

        const key = req.method === 'GET' ? req.query.key : (req.body || {}).key;
        if (!key) return res.status(400).json({ error: 'Missing key' });

        const factionId = await getFactionId(key);
        if (!factionId) return res.status(403).json({ error: 'Could not determine your faction from this key' });

        if (req.method === 'GET') {
            const raw = await redis(['GET', formKey(factionId)]);
            return res.status(200).json({ form: raw ? JSON.parse(raw) : null });
        }

        if (req.method === 'POST') {
            const { action } = req.body || {};
            if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });

            if (action === 'clear') {
                await redis(['DEL', formKey(factionId)]);
                return res.status(200).json({ ok: true });
            }

            const { title, formUrl, chartUrl } = req.body;
            if (!formUrl) return res.status(400).json({ error: 'A form embed URL is required.' });

            const form = { title: title || 'Faction feedback', formUrl, chartUrl: chartUrl || null, updatedAt: Date.now() };
            await redis(['SET', formKey(factionId), JSON.stringify(form)]);
            return res.status(200).json({ ok: true, form });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
    }
};
