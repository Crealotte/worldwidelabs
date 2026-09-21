// api/faction-share.js — opt-in faction overview sharing between leaders.
// The key is ALWAYS sent in the POST body, never a URL query string — a GET with ?key=...
// would put the key straight into Vercel's own request-path logs in plaintext.
//
// A leader flips a toggle to share a snapshot of their own faction's roster overview
// (WWLabs adoption + Discord status per member) — no key ever leaves their faction.
// Other leaders can then see that snapshot, refreshed automatically whenever the
// sharing faction's own leader visits their Dashboard.
//
// POST { key, action:'read' }             -> { mine: {enabled, ...snapshot}, others: [snapshot, ...] }
// POST { key, action:'toggle', enabled }  -> leaders only: turn sharing on (builds+saves a fresh snapshot) or off

const { tornFetch } = require('../lib/tornFetch');
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const LOGINS_HASH = 'wwl:logins';
const SHARE_INDEX = 'wwl:faction-share:index';

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

async function tornProfile(key) {
    const r = await tornFetch(`https://api.torn.com/user/?selections=profile&key=${encodeURIComponent(key)}`);
    return r.json();
}
async function getFactionId(key) {
    const p = await tornProfile(key);
    if (p.error || !p.faction?.faction_id) return null;
    return String(p.faction.faction_id);
}
async function isLeader(key) {
    const r = await tornFetch(`https://api.torn.com/v2/faction/balance?key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } });
    const d = await r.json();
    return !d.error;
}

const shareKey = (factionId) => `wwl:faction-share:${factionId}`;

async function buildSnapshot(key, factionId) {
    const profile = await tornProfile(key);
    const factionName = profile.faction?.faction_name || 'Unknown faction';

    const membersRes = await tornFetch(`https://api.torn.com/v2/faction/members?striptags=true&key=${encodeURIComponent(key)}`,
        { headers: { accept: 'application/json' } });
    const membersData = await membersRes.json();
    if (membersData.error) throw new Error(membersData.error.error || 'Could not load this faction\'s roster.');
    const members = membersData.members || [];

    const loginsFlat = await redis(['HGETALL', LOGINS_HASH]);
    const logins = {};
    for (let i = 0; i < loginsFlat.length; i += 2) {
        try { logins[loginsFlat[i]] = JSON.parse(loginsFlat[i + 1]); } catch (e) { /* skip a bad entry */ }
    }

    // Discord status is best-effort — if the bot isn't configured, snapshots just omit it.
    let discordByTornId = null;
    try {
        const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
        const GUILD_ID = process.env.DISCORD_GUILD_ID;
        if (BOT_TOKEN && GUILD_ID) {
            let ROLE_MAP = {};
            try { ROLE_MAP = JSON.parse(process.env.DISCORD_ROLE_MAP || '{}'); } catch (e) { /* no map = no faction-specific role */ }
            const roleId = ROLE_MAP[factionId] || null;

            let dMembers = [], after = '0';
            while (true) {
                const dres = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members?limit=1000&after=${after}`,
                    { headers: { Authorization: `Bot ${BOT_TOKEN}` } });
                if (!dres.ok) break;
                const batch = await dres.json();
                if (!Array.isArray(batch) || !batch.length) break;
                dMembers = dMembers.concat(batch);
                if (batch.length < 1000) break;
                after = batch[batch.length - 1].user.id;
            }
            discordByTornId = {};
            for (const m of dMembers) {
                const label = m.nick || m.user?.global_name || m.user?.username || '';
                const match = label.match(/\[(\d+)\]/);
                if (!match) continue;
                discordByTornId[match[1]] = (roleId && (m.roles || []).includes(roleId)) ? 'verified' : 'in_server';
            }
        }
    } catch (e) { discordByTornId = null; }

    const snapshotMembers = members.map(m => ({
        id: m.id,
        name: m.name,
        onWWLabs: !!logins[m.id],
        discord: discordByTornId ? (discordByTornId[m.id] || 'not_found') : null,
    }));

    return { factionId, factionName, updatedAt: Date.now(), members: snapshotMembers };
}

module.exports = async function handler(req, res) {
    try {
        if (!REDIS_URL || !REDIS_TOKEN) {
            return res.status(500).json({ error: 'Database not connected. In Vercel: Storage -> Create Database -> Upstash Redis, and connect it to this project.' });
        }

        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

        const { key, action, enabled } = req.body || {};
        if (!key) return res.status(400).json({ error: 'Missing key' });

        const factionId = await getFactionId(key);
        if (!factionId) return res.status(403).json({ error: 'Could not determine your faction from this key' });
        if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });

        if (action === 'read') {
            // Refresh my own faction's snapshot whenever I load this, but only if sharing is on.
            const mineRaw = await redis(['GET', shareKey(factionId)]);
            let mine = mineRaw ? JSON.parse(mineRaw) : { enabled: false };
            if (mine.enabled) {
                try {
                    const snap = await buildSnapshot(key, factionId);
                    mine = { enabled: true, ...snap };
                    await redis(['SET', shareKey(factionId), JSON.stringify(mine)]);
                } catch (e) { /* keep the last good snapshot if a refresh attempt fails */ }
            }

            const factionIds = (await redis(['SMEMBERS', SHARE_INDEX])) || [];
            const others = [];
            for (const fid of factionIds) {
                if (fid === factionId) continue;
                const raw = await redis(['GET', shareKey(fid)]);
                if (!raw) continue;
                const data = JSON.parse(raw);
                if (data.enabled) others.push(data);
            }

            return res.status(200).json({ mine, others });
        }

        if (action === 'toggle') {
            if (!enabled) {
                await redis(['SET', shareKey(factionId), JSON.stringify({ enabled: false, factionId })]);
                await redis(['SREM', SHARE_INDEX, factionId]);
                return res.status(200).json({ ok: true });
            }

            const snap = await buildSnapshot(key, factionId);
            const data = { enabled: true, ...snap };
            await redis(['SET', shareKey(factionId), JSON.stringify(data)]);
            await redis(['SADD', SHARE_INDEX, factionId]);
            return res.status(200).json({ ok: true, data });
        }

        return res.status(400).json({ error: 'Unknown action' });
    } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
    }
};
