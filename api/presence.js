// api/presence.js — WorldWideLabs login presence log.
// POST { key }  -> verifies the key with Torn, records { id, name, last-seen }. The key is never stored.
// GET ?key=...  -> returns the login list, but only for keys with faction API access (leaders).

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const HASH = 'wwl:logins';

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

module.exports = async function handler(req, res) {
    try {
        if (!REDIS_URL || !REDIS_TOKEN) {
            return res.status(500).json({ error: 'Database not connected. In Vercel: Storage -> Create Database -> Upstash Redis, and connect it to this project.' });
        }

        // ---- Record a login ----
        if (req.method === 'POST') {
            const { key } = req.body || {};
            if (!key) return res.status(400).json({ error: 'Missing key' });

            // Identity comes from Torn itself, so it cannot be spoofed.
            const r = await fetch(`https://api.torn.com/user/?selections=profile&key=${encodeURIComponent(key)}`);
            const user = await r.json();
            if (user.error) return res.status(403).json({ error: 'Torn rejected the key' });

            const entry = {
                id: user.player_id,
                name: user.name,
                faction: user.faction?.faction_id || 0,
                last: Date.now(),
            };
            await redis(['HSET', HASH, String(user.player_id), JSON.stringify(entry)]);
            return res.status(200).json({ ok: true });
        }

        // ---- Leaders read the list ----
        if (req.method === 'GET') {
            const key = req.query.key;
            if (!key) return res.status(400).json({ error: 'Missing key' });

            // Only keys with the faction API Access permission may read the list.
            const r = await fetch(`https://api.torn.com/v2/faction/balance?key=${encodeURIComponent(key)}`,
                { headers: { accept: 'application/json' } });
            const check = await r.json();
            if (check.error) return res.status(403).json({ error: 'Leaders only' });

            const flat = await redis(['HGETALL', HASH]); // [id, json, id, json, ...]
            const logins = {};
            for (let i = 0; i < flat.length; i += 2) {
                try { logins[flat[i]] = JSON.parse(flat[i + 1]); } catch (e) { /* skip bad entry */ }
            }
            return res.status(200).json({ logins });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
    }
}
