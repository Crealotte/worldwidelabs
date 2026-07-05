// api/feedback-form.js — WorldWideLabs feedback form + live results chart.
// GET  ?key=...              -> current form (title, form embed URL, chart embed URL)
// POST { key, title, formUrl, chartUrl } -> leaders only: set/replace the current form
// POST { key, action:'clear' }           -> leaders only: remove the current form

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const FORM_KEY = 'wwl:feedback-form';

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

async function isLeader(key) {
    const r = await fetch(`https://api.torn.com/v2/faction/balance?key=${encodeURIComponent(key)}`,
        { headers: { accept: 'application/json' } });
    const d = await r.json();
    return !d.error;
}

module.exports = async function handler(req, res) {
    try {
        if (!REDIS_URL || !REDIS_TOKEN) {
            return res.status(500).json({ error: 'Database not connected. In Vercel: Storage -> Create Database -> Upstash Redis, and connect it to this project.' });
        }

        if (req.method === 'GET') {
            const raw = await redis(['GET', FORM_KEY]);
            return res.status(200).json({ form: raw ? JSON.parse(raw) : null });
        }

        if (req.method === 'POST') {
            const { key, action } = req.body || {};
            if (!key) return res.status(400).json({ error: 'Missing key' });
            if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });

            if (action === 'clear') {
                await redis(['DEL', FORM_KEY]);
                return res.status(200).json({ ok: true });
            }

            const { title, formUrl, chartUrl } = req.body;
            if (!formUrl) return res.status(400).json({ error: 'A form embed URL is required.' });

            const form = { title: title || 'Faction feedback', formUrl, chartUrl: chartUrl || null, updatedAt: Date.now() };
            await redis(['SET', FORM_KEY, JSON.stringify(form)]);
            return res.status(200).json({ ok: true, form });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
    }
};
