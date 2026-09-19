// lib/discordMap.js — Torn ID -> Discord user ID for members of the shared Discord server, so the
// War Availability tracker can actually @mention people (a Discord mention needs the Discord user
// ID, not a name). Same convention api/discord-members.js already relies on: the YATA verification
// bot sets every member's nickname to "Name [TornID] TAG", so the Torn ID is read back out of that
// — never matched by name alone, since names can collide. Uses the same DISCORD_BOT_TOKEN /
// DISCORD_GUILD_ID env vars that file does. Returns null if the bot isn't configured.

const DISCORD_API = 'https://discord.com/api/v10';

async function tornToDiscordIds() {
    const token = process.env.DISCORD_BOT_TOKEN;
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!token || !guildId) return null;

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

    const map = {};
    for (const m of members) {
        const label = m.nick || m.user?.global_name || m.user?.username || '';
        const match = label.match(/\[(\d+)\]/);
        if (match && m.user?.id) map[match[1]] = m.user.id;
    }
    return map;
}

module.exports = { tornToDiscordIds };
