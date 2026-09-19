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

// Works for ANY faction, not just the one whose Discord server the bot sits in: Torn itself links
// Discord accounts to Torn accounts (the same link verification bots like YATA/Tornium read), and
// that's queryable per user. So a faction with its own separate Discord server still gets real
// @mentions, as long as each member has linked their Discord on Torn (others are skipped, and
// reported so the leader knows).
async function tornLookupDiscordId(tornId, key) {
    const r = await fetch(`https://api.torn.com/user/${encodeURIComponent(tornId)}?selections=discord&key=${encodeURIComponent(key)}`);
    const d = await r.json();
    if (d.error) throw new Error(d.error.error);
    const id = d.discord?.discordID ?? d.discordID ?? '';
    return id ? String(id) : '';
}

// Resolves Torn IDs to Discord IDs. `guildMap` (the bot's own server nicknames, home faction only)
// is tried first since it's one bulk fetch; anything it doesn't cover falls back to the per-user
// Torn lookup. Results are cached in one shared Redis hash — the link belongs to the Torn
// account, not to any faction — a found ID stays cached, a "not linked" answer for a day (so
// people who link later get picked up), and a failed lookup (e.g. rate limited) isn't cached.
async function resolveDiscordIds(targets, { key, redis, guildMap }) {
    const HASH = 'wwl:discord-ids';
    const now = Math.floor(Date.now() / 1000);
    const out = {};
    const need = [];
    for (const t of targets) {
        if (guildMap?.[t.id]) out[t.id] = guildMap[t.id]; else need.push(t);
    }
    if (!need.length) return out;

    const cached = await redis(['HMGET', HASH, ...need.map(t => t.id)]);
    const lookups = [];
    need.forEach((t, i) => {
        const c = cached?.[i] ? JSON.parse(cached[i]) : null;
        if (c && c.id) out[t.id] = c.id;
        else if (!(c && now - c.at < 86400)) lookups.push(t);
    });

    for (let i = 0; i < lookups.length; i += 5) { // small parallel batches — gentle on Torn's rate limit
        const results = await Promise.all(lookups.slice(i, i + 5).map(async t => {
            try { return [t, await tornLookupDiscordId(t.id, key)]; } catch (e) { return [t, null]; }
        }));
        const store = [];
        for (const [t, id] of results) {
            if (id === null) continue; // lookup failed — try again next time rather than cache a guess
            if (id) out[t.id] = id;
            store.push(t.id, JSON.stringify({ id, at: now }));
        }
        if (store.length) await redis(['HSET', HASH, ...store]);
    }
    return out;
}

module.exports = { tornToDiscordIds, resolveDiscordIds };
