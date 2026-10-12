// api/discord-members.js — reads your Discord server's member list via a bot token,
// and matches each member to a Torn ID by parsing the "Name [ID] TAG" nickname format
// that the YATA verification bot sets. The key is ALWAYS sent in the POST body, never a
// URL query string — a GET with ?key=... would put the key into Vercel's request-path logs.
//
// Multi-faction: one shared Discord server, but each faction has its own "verified" role.
// DISCORD_ROLE_MAP is a JSON object mapping Torn faction ID -> Discord role ID, e.g.
//   {"12345": "111111111111111111", "67890": "222222222222222222"}
// "Verified" for any given person is always checked against THEIR OWN faction's role,
// resolved server-side from their key — never something the client can choose.

const { tornFetch } = require('../lib/tornFetch');
const { factionAllowed, DENIED: ACCESS_DENIED } = require('../lib/access');
const DISCORD_API = 'https://discord.com/api/v10';

async function fetchAllMembers(guildId, token) {
    let members = [];
    let after = '0';
    while (true) {
        const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members?limit=1000&after=${after}`, {
            headers: { Authorization: `Bot ${token}` },
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(`Discord API error (${res.status}): ${body.message || res.statusText}`);
        }
        const batch = await res.json();
        if (!Array.isArray(batch) || !batch.length) break;
        members = members.concat(batch);
        if (batch.length < 1000) break;
        after = batch[batch.length - 1].user.id;
    }
    return members;
}

async function getFactionId(key) {
    const r = await tornFetch(`https://api.torn.com/user/?selections=profile&key=${encodeURIComponent(key)}`);
    const profile = await r.json();
    if (profile.error || !profile.faction?.faction_id) return null;
    return String(profile.faction.faction_id);
}

module.exports = async function handler(req, res) {
    try {
        if (require('../lib/env').blockUntilTestDb(req, res)) return; // a test site without its own test database stays closed (lib/env.js)
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

        const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
        const GUILD_ID = process.env.DISCORD_GUILD_ID;
        let ROLE_MAP = {};
        try { ROLE_MAP = JSON.parse(process.env.DISCORD_ROLE_MAP || '{}'); } catch (e) { /* treat a bad JSON value as "no roles configured" */ }

        if (!BOT_TOKEN || !GUILD_ID) {
            return res.status(500).json({ error: 'Discord bot not configured yet. Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID in Vercel environment variables.' });
        }

        const { key } = req.body || {};
        if (!key) return res.status(400).json({ error: 'Missing key' });

        const factionId = await getFactionId(key);
        if (!factionId) return res.status(403).json({ error: 'Could not determine your faction from this key' });
        if (!(await factionAllowed(factionId))) return res.status(403).json(ACCESS_DENIED); // only factions on the owner's list may use WWL
        // The owner looking at another faction's Who's on board: the same Discord roster, checked against THAT faction's verified role.
        let viewFaction = factionId;
        const asF = String(req.body.asFaction || '').replace(/\D/g, '');
        if (asF && asF !== factionId) {
            const pr = await (await tornFetch(`https://api.torn.com/user/?selections=profile&key=${encodeURIComponent(key)}`)).json(); // cached by tornFetch
            if (!(await require('../lib/labsLedger').labsIsOwner(require('../lib/access').redis, String(pr.player_id)))) return res.status(403).json({ error: 'Only the owner can look at another faction.' });
            viewFaction = asF;
        }
        const roleId = ROLE_MAP[viewFaction] || null; // this faction's own verified role — if unset, "in server" counts as verified

        const members = await fetchAllMembers(GUILD_ID, BOT_TOKEN);

        // Match by Torn ID found in "Name [ID] TAG" — never by name alone, since names can collide.
        // Store the raw roles list per member; "verified" gets computed per-request against
        // whichever faction's role is relevant, since one shared server holds all factions' roles.
        const byTornId = {};
        for (const m of members) {
            const label = m.nick || m.user?.global_name || m.user?.username || '';
            const match = label.match(/\[(\d+)\]/);
            if (!match) continue;
            byTornId[match[1]] = { discordName: label, roles: m.roles || [] };
        }

        const withVerified = (entry) => entry && {
            discordName: entry.discordName,
            verified: roleId ? entry.roles.includes(roleId) : true,
        };

        // Every caller can see their own match — this only reveals info about themselves.
        let mine = null;
        const profileRes = await tornFetch(`https://api.torn.com/user/?selections=profile&key=${encodeURIComponent(key)}`);
        const profile = await profileRes.json();
        if (!profile.error) mine = withVerified(byTornId[String(profile.player_id)]) || { discordName: null, verified: false };

        // The full faction roster is a leadership-overview feature — keep that part leader-gated.
        const leaderRes = await tornFetch(`https://api.torn.com/v2/faction/balance?key=${encodeURIComponent(key)}`,
            { headers: { accept: 'application/json' } });
        const leaderData = await leaderRes.json();
        const isLeader = !leaderData.error;

        let members_out;
        if (isLeader) {
            members_out = {};
            for (const [tornId, entry] of Object.entries(byTornId)) members_out[tornId] = withVerified(entry);
        }

        return res.status(200).json({
            mine,
            members: members_out,
            totalDiscordMembers: members.length,
        });
    } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
    }
};
