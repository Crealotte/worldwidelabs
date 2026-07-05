// api/discord-members.js — reads your Discord server's member list via a bot token,
// and matches each member to a Torn ID by parsing the "Name [ID] TAG" nickname format
// that the YATA verification bot sets. Leaders only (same faction-API-access check
// used by Chain Payout and Announcements).

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

module.exports = async function handler(req, res) {
    try {
        const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
        const GUILD_ID = process.env.DISCORD_GUILD_ID;
        const VERIFIED_ROLE_ID = process.env.DISCORD_VERIFIED_ROLE_ID || null; // optional

        if (!BOT_TOKEN || !GUILD_ID) {
            return res.status(500).json({ error: 'Discord bot not configured yet. Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID in Vercel environment variables.' });
        }

        const key = req.query.key;
        if (!key) return res.status(400).json({ error: 'Missing key' });

        const members = await fetchAllMembers(GUILD_ID, BOT_TOKEN);

        // Match by Torn ID found in "Name [ID] TAG" — never by name alone, since names can collide.
        const byTornId = {};
        for (const m of members) {
            const label = m.nick || m.user?.global_name || m.user?.username || '';
            const match = label.match(/\[(\d+)\]/);
            if (!match) continue;
            const tornId = match[1];
            const verified = VERIFIED_ROLE_ID ? (m.roles || []).includes(VERIFIED_ROLE_ID) : true;
            byTornId[tornId] = { discordName: label, verified };
        }

        // Every caller can see their own match — this only reveals info about themselves.
        let mine = null;
        const profileRes = await fetch(`https://api.torn.com/user/?selections=profile&key=${encodeURIComponent(key)}`);
        const profile = await profileRes.json();
        if (!profile.error) mine = byTornId[String(profile.player_id)] || { discordName: null, verified: false };

        // The full faction roster is a leadership-overview feature — keep that part leader-gated.
        const leaderRes = await fetch(`https://api.torn.com/v2/faction/balance?key=${encodeURIComponent(key)}`,
            { headers: { accept: 'application/json' } });
        const leaderData = await leaderRes.json();
        const isLeader = !leaderData.error;

        return res.status(200).json({
            mine,
            members: isLeader ? byTornId : undefined,
            totalDiscordMembers: members.length,
        });
    } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
    }
};
