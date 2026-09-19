// api/war-payout.js — WorldWideLabs War Payout Calculator.
// Hit-count-based payout for ranked wars. Two genuinely different kinds of hits feed the payout,
// pulled from two different Torn endpoints:
//
//   - War hits: the authoritative count of every attack that actually counted toward the ranked
//     war score, pulled straight from /v2/faction/attacks for the war's own start/end window and
//     filtered on each attack's own is_ranked_war flag. This is deliberately NOT derived from
//     chain reports — a member can rack up real war hits outside of any chain (solo hits, a
//     chain the leader forgot to add, hits between chains), and those must still count. Relying
//     only on chain reports was the earlier bug: any war hit that didn't happen to fall inside a
//     chain ID the leader manually added simply never got counted.
//   - Chain (overflow) hits: hits inside a chain the leader adds that Torn itself did NOT count
//     toward the war — almost always chain hits thrown after the war already ended, to milk a
//     few more before the chain drops. Same endpoint the existing Chain Payout tool uses:
//     /v2/faction/{chainId}/chainreport returns, per attacker, both attacks.total and attacks.war
//     for that specific chain, so attacks.total - attacks.war IS "hits in this chain that weren't
//     war hits" directly, computed by Torn itself. These are intentionally paid a flat rate
//     rather than a pool share (typically $20k/hit) — see the "split" payout mode.
//
// A war hit and an overflow hit can never be the same hit (chainreport's own total-minus-war
// already excludes war hits), so summing the two sources never double-counts.
//
// The actual war-hit fetching lives in lib/warHits.js — a separate, self-contained piece, since
// it's a genuinely different concern (talking to Torn's raw attack log) from the chain-report
// handling and payout math below.

const { fetchWarHits, sleep } = require('../lib/warHits');
const { fetchWarBadgeStats } = require('../lib/warBadgeStats');
const { tornToDiscordIds, resolveDiscordIds } = require('../lib/discordMap');

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

const restockedKey = (factionId) => `wwl:restocked-wars:${factionId}`;
const availabilityKey = (factionId) => `wwl:availability:${factionId}`;

// Resolves faction + the caller's own identity in one profile fetch — the availability tracker
// (any member, not just leaders) needs to know who's actually recording their own slots.
async function getProfile(key) {
    const r = await fetch(`https://api.torn.com/user/?selections=profile&key=${encodeURIComponent(key)}`);
    const profile = await r.json();
    if (profile.error || !profile.faction?.faction_id) return null;
    return { factionId: String(profile.faction.faction_id), playerId: String(profile.player_id), name: profile.name };
}
async function isLeader(key) {
    const r = await fetch(`https://api.torn.com/v2/faction/balance?key=${encodeURIComponent(key)}`,
        { headers: { accept: 'application/json' } });
    const d = await r.json();
    return !d.error;
}

// Ranked wars with no end yet — i.e. matched-but-not-started, or still running. What the
// availability tracker links to, so the war's start time (and the overdose window derived from
// it) comes straight from Torn instead of being typed in.
async function getUpcomingWars(key, factionId) {
    const r = await fetch(`https://api.torn.com/v2/faction?selections=rankedwars&key=${encodeURIComponent(key)}`,
        { headers: { accept: 'application/json' } });
    const d = await r.json();
    if (d.error) throw new Error(d.error.error);
    return Object.values(d.rankedwars || {})
        .filter(w => !w.end)
        .map(w => {
            const them = (w.factions || []).find(f => String(f.id) !== factionId);
            return { id: String(w.id), start: w.start ?? w.war?.start ?? null, opponent: them?.name || 'Unknown opponent' };
        })
        .filter(w => w.start)
        .sort((a, b) => a.start - b.start);
}

// ---- Discord destination, per faction. Several factions can use this app, so where a faction's
// pings go can't be one global setting. Each faction's leader saves its own: a channel ID (the
// shared WorldWideLabs bot posts there) or a webhook URL (works for a faction on ANY Discord
// server, no bot needed). Bot posting is only allowed for factions that actually live on the
// shared server — otherwise any faction's leader could aim the bot at any channel ID in it.
const discordSettingsKey = (factionId) => `wwl:discord-settings:${factionId}`;
const WEBHOOK_RE = /^https:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

// The shared server's factions: the ones already listed in DISCORD_ROLE_MAP (the existing
// multi-faction config for that server), plus any extra IDs in DISCORD_WAR_FACTION_IDS.
function isSharedServerFaction(factionId) {
    let roleMap = {};
    try { roleMap = JSON.parse(process.env.DISCORD_ROLE_MAP || '{}'); } catch (e) { /* bad JSON = none configured */ }
    const extra = (process.env.DISCORD_WAR_FACTION_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    return Object.keys(roleMap).includes(String(factionId)) || extra.includes(String(factionId));
}

// Resolves to { post(content, users) } for this faction, { error }, or null if not set up yet.
async function getDiscordPoster(factionId) {
    const raw = await redis(['GET', discordSettingsKey(factionId)]);
    const s = raw ? JSON.parse(raw) : {};
    if (s.webhookUrl) {
        if (!WEBHOOK_RE.test(s.webhookUrl)) return { error: 'The saved Discord webhook URL doesn\'t look valid — save it again in the Discord settings.' };
        return { post: (content, users) => fetch(s.webhookUrl, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, username: 'WWLabs', allowed_mentions: { parse: [], users } }),
        }) };
    }
    if (s.channelId && isSharedServerFaction(factionId) && process.env.DISCORD_BOT_TOKEN) {
        return { post: (content, users) => fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(s.channelId)}/messages`, {
            method: 'POST', headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, allowed_mentions: { parse: [], users } }),
        }) };
    }
    return null;
}

async function getRoster(key) {
    const r = await fetch(`https://api.torn.com/v2/faction/members?striptags=true&key=${encodeURIComponent(key)}`,
        { headers: { accept: 'application/json' } });
    const d = await r.json();
    if (d.error) throw new Error(d.error.error);
    return (d.members || []).map(m => ({ id: String(m.id), name: m.name }));
}

// Everyone who has actually filled the tracker in for this war: ticked at least one slot, or
// marked themselves not available. An entry left behind by ticking and then un-ticking
// everything doesn't count as having responded.
function respondedMap(data) {
    const out = {};
    for (const [id, entry] of Object.entries(data?.entries || {})) {
        const slotCount = Object.keys(entry.slots || {}).length;
        if (slotCount) out[id] = { id, name: entry.name, slotCount, out: false };
    }
    for (const [id, u] of Object.entries(data?.unavailable || {})) out[id] = { id, name: u.name, slotCount: out[id]?.slotCount || 0, out: true };
    return out;
}


module.exports = async function handler(req, res) {
    try {
        if (!REDIS_URL || !REDIS_TOKEN) {
            return res.status(500).json({ error: 'Database not connected. In Vercel: Storage -> Create Database -> Upstash Redis, and connect it to this project.' });
        }
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const { key, action } = req.body || {};

        // Receipts are readable by anyone with the link — genuinely public, no key or login
        // required, since the whole point is being shareable outside the faction too.
        if (action === 'get-receipt') {
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: 'Missing id' });
            const raw = await redis(['GET', `wwl:payout-receipt:${id}`]);
            if (!raw) return res.status(404).json({ error: 'Receipt not found — the link may be wrong, or it may have been generated on a different deployment.' });
            return res.status(200).json({ receipt: JSON.parse(raw) });
        }

        if (!key) return res.status(400).json({ error: 'Missing key' });

        const profile = await getProfile(key);
        if (!profile) return res.status(403).json({ error: 'Could not determine your faction from this key' });
        const { factionId, playerId, name: playerName } = profile;

        // Open to any logged-in member of the faction, not leader-gated — this is what lets the
        // faction dashboard show the latest war's badge winners to everyone, not just leaders.
        if (action === 'get-latest-badges') {
            const latestId = await redis(['GET', `wwl:latest-receipt:${factionId}`]);
            if (!latestId) return res.status(200).json({ receipt: null });
            const raw = await redis(['GET', `wwl:payout-receipt:${latestId}`]);
            if (!raw) return res.status(200).json({ receipt: null });
            const receipt = JSON.parse(raw);
            return res.status(200).json({
                receipt: { opponent: receipt.opponent, warEnd: receipt.warEnd, badgeStats: receipt.badgeStats, rows: receipt.rows, receiptId: latestId },
            });
        }

        // Also open to any member — the index of every saved receipt for this faction, newest
        // first. Backs both the War Badges page's war picker (badges are read from whichever
        // receipt a war maps to, no live recompute needed) and doubles as "browse past receipts"
        // — each entry already carries its own shareable link via receiptId.
        if (action === 'list-receipts') {
            const indexRaw = await redis(['GET', `wwl:receipts-index:${factionId}`]);
            const index = indexRaw ? JSON.parse(indexRaw) : [];
            return res.status(200).json({ receipts: index });
        }

        // ---- War Availability Tracker: for the window after being matched, before the war
        // starts. Every member marks the day/hour slots (Torn City Time = UTC) they expect to be
        // around; leaders/council see it all added up per slot ("Saturday 18 TCT: 5") so they
        // know when the faction can actually mobilize. Grid shape (which dates, how many days) is
        // whatever the leader set with 'availability-start' for the current war — open-ended
        // rather than hardcoded to a specific day count, since a war can drag a day past its
        // normal length. Slots are keyed "day-hour" (day = 0-indexed offset from the tracker's
        // start date), one flat object per member for O(1) toggling.
        if (action === 'availability-get') {
            const raw = await redis(['GET', availabilityKey(factionId)]);
            const data = raw ? JSON.parse(raw) : null;
            const mine = data?.entries?.[playerId]?.slots || {};
            const unavailable = data?.unavailable || {};
            const result = {
                // war = the ranked war this tracker is linked to ({ id, start, opponent }), if any
                config: data ? { startDate: data.startDate, days: data.days, war: data.war || null } : null,
                mine,
                myUnavailable: unavailable[playerId] || null, // { name, note, at } if I marked myself out
            };
            if (await isLeader(key)) {
                // Everyone who hit "I can't make this war" (the forum-post equivalent) — listed
                // for the leader, and their ticked slots are left out of the heatmap below so a
                // leader never counts on someone who already said they can't make it.
                result.unavailable = Object.entries(unavailable).map(([id, u]) => ({ id, name: u.name, note: u.note || '', at: u.at }));

                // Who has filled the tracker in (ticked a slot or hit "can't make it"), and — from
                // the member roster — who hasn't yet, so they can be chased.
                if (data) {
                    const responded = respondedMap(data);
                    result.responded = Object.values(responded);
                    try { result.notResponded = (await getRoster(key)).filter(m => !responded[m.id]); }
                    catch (e) { result.notResponded = null; result.rosterError = String(e.message || e); }
                }

                // Aggregate per slot: how many, and who — leaders want to actually act on this,
                // not just see a number.
                const summary = {};
                for (const [id, entry] of Object.entries(data?.entries || {})) {
                    if (unavailable[id]) continue; // marked themselves out — don't count their slots
                    for (const slot of Object.keys(entry.slots || {})) {
                        const s = summary[slot] || (summary[slot] = { count: 0, names: [], ids: [] });
                        s.count++;
                        s.names.push(entry.name || `#${id}`);
                        s.ids.push(id); // lets the leader view link each name to their Torn profile for pinging
                    }
                }
                result.summary = summary;
            }
            return res.status(200).json(result);
        }

        if (action === 'availability-set') {
            const { day, hour, available } = req.body;
            if (day == null || hour == null) return res.status(400).json({ error: 'Missing day/hour' });
            const raw = await redis(['GET', availabilityKey(factionId)]);
            const data = raw ? JSON.parse(raw) : null;
            if (!data) return res.status(400).json({ error: 'No availability tracker is active for this faction right now — ask a leader to start one.' });
            const entry = data.entries[playerId] || (data.entries[playerId] = { name: playerName, slots: {} });
            entry.name = playerName; // keep it current in case of a name change
            const slotKey = `${day}-${hour}`;
            if (available) entry.slots[slotKey] = true; else delete entry.slots[slotKey];
            await redis(['SET', availabilityKey(factionId), JSON.stringify(data)]);
            return res.status(200).json({ ok: true });
        }

        // "I can't make this war" — real life happens, and there's a forum post for it too; this
        // puts the same thing in the tool so leaders see it next to the availability numbers.
        // Any member can set/undo their own. Cleared automatically when a new tracker starts.
        if (action === 'availability-unavailable') {
            const { unavailable: flag, note } = req.body;
            const raw = await redis(['GET', availabilityKey(factionId)]);
            const data = raw ? JSON.parse(raw) : null;
            if (!data) return res.status(400).json({ error: 'No availability tracker is active for this faction right now — ask a leader to start one.' });
            data.unavailable = data.unavailable || {};
            if (flag) data.unavailable[playerId] = { name: playerName, note: String(note || '').slice(0, 140), at: Date.now() };
            else delete data.unavailable[playerId];
            await redis(['SET', availabilityKey(factionId), JSON.stringify(data)]);
            return res.status(200).json({ ok: true });
        }

        if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });

        // Starts a fresh tracker for the newly-matched war — wipes any previous entries, since
        // this is meant to answer "who's around for THIS war", not accumulate forever. days is
        // capped generously (a war dragging a day or two past a normal weekend is expected; this
        // just guards against a fat-fingered huge number blowing up the grid).
        // This faction's own Discord destination (see getDiscordPoster). Leader-only. The webhook
        // URL is a secret — it's never sent back, only a hint of which webhook is saved.
        if (action === 'discord-settings-get') {
            const raw = await redis(['GET', discordSettingsKey(factionId)]);
            const s = raw ? JSON.parse(raw) : {};
            return res.status(200).json({
                factionId,
                shared: isSharedServerFaction(factionId), // on the shared server -> the bot can post here
                channelId: s.channelId || '',
                webhookSet: !!s.webhookUrl,
                webhookHint: s.webhookUrl ? `webhook …${s.webhookUrl.match(/\/webhooks\/(\d+)\//)?.[1]?.slice(-6) || ''}` : '',
            });
        }

        if (action === 'discord-settings-set') {
            const raw = await redis(['GET', discordSettingsKey(factionId)]);
            const s = raw ? JSON.parse(raw) : {};
            const { webhookUrl, channelId, clearWebhook } = req.body;
            if (clearWebhook) delete s.webhookUrl;
            if (typeof webhookUrl === 'string' && webhookUrl.trim()) {
                if (!WEBHOOK_RE.test(webhookUrl.trim())) return res.status(400).json({ error: 'That doesn\'t look like a Discord webhook URL (it should start with https://discord.com/api/webhooks/).' });
                s.webhookUrl = webhookUrl.trim();
            }
            if (typeof channelId === 'string') {
                if (channelId.trim() && !/^\d{15,25}$/.test(channelId.trim())) return res.status(400).json({ error: 'A channel ID is just a long number — right-click the channel in Discord (Developer Mode on) and choose Copy Channel ID.' });
                if (channelId.trim() && !isSharedServerFaction(factionId)) return res.status(400).json({ error: 'The shared bot can only post for factions on the shared Discord server — use a webhook instead.' });
                if (channelId.trim()) s.channelId = channelId.trim(); else delete s.channelId;
            }
            await redis(['SET', discordSettingsKey(factionId), JSON.stringify(s)]);
            return res.status(200).json({ ok: true });
        }

        // Sends a harmless test message (mentions nobody) so a leader can confirm the destination
        // works before the first real ping.
        if (action === 'discord-settings-test') {
            const poster = await getDiscordPoster(factionId);
            if (poster?.error) return res.status(400).json({ error: poster.error });
            if (!poster) return res.status(400).json({ error: 'Nothing saved yet — add a channel ID or webhook first.' });
            const r = await poster.post(`✅ WWLabs is connected — war availability pings for your faction will post here.`, []);
            if (!r.ok) {
                const body = await r.text().catch(() => '');
                return res.status(502).json({ error: `Discord rejected the test (${r.status})${body ? `: ${body.slice(0, 120)}` : ''} — check the bot can see and post in that channel.` });
            }
            return res.status(200).json({ ok: true });
        }

        // Posts an @mention message to Discord for everyone who signed up for a slot ('slot') or
        // hasn't filled the tracker in yet ('missing'). The mention list is built HERE from the
        // stored data — never taken from the client — and allowed_mentions is locked to exactly
        // those users, so the free-text message can't smuggle in an @everyone. Needs THIS faction's Discord
        // destination saved (channel ID or webhook, see discord-settings-*); without it, this returns
        // the ready-made text so the leader can paste it into Discord themselves.
        // People whose nickname carries no [TornID] (not verified in Discord) can't be mentioned —
        // they're returned in noDiscord so the leader knows who was left out.
        if (action === 'availability-ping') {
            const { kind, day, hour, message } = req.body;
            const raw = await redis(['GET', availabilityKey(factionId)]);
            const data = raw ? JSON.parse(raw) : null;
            if (!data) return res.status(400).json({ error: 'No availability tracker is active right now.' });

            let targets = [];
            if (kind === 'slot') {
                const slot = `${Number(day)}-${Number(hour)}`;
                for (const [id, entry] of Object.entries(data.entries || {})) {
                    if (data.unavailable?.[id]) continue; // said they can't make it — don't ping them
                    if (entry.slots?.[slot]) targets.push({ id, name: entry.name });
                }
            } else if (kind === 'missing') {
                try {
                    const responded = respondedMap(data);
                    targets = (await getRoster(key)).filter(m => !responded[m.id]);
                } catch (e) { return res.status(403).json({ error: `Couldn't read the member list: ${e.message}` }); }
            } else return res.status(400).json({ error: 'Unknown ping kind' });
            if (!targets.length) return res.status(400).json({ error: 'Nobody to ping for that.' });

            // Optional push time, so the message always states WHEN. Discord's <t:unix:F> markup
            // renders in each reader's own timezone (and :R as "in 3 hours"); the plain TCT text is
            // alongside it since TCT is what the war itself runs on.
            const pushAt = Math.floor(Number(req.body.pushAt) || 0);
            let timeLine = '';
            if (pushAt > 1e9 && pushAt < 4e9) {
                const tct = new Date(pushAt * 1000).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
                timeLine = `⏰ **Push: <t:${pushAt}:F>** (<t:${pushAt}:R>) — ${tct} TCT`;
            }
            const intro = [String(message || '').slice(0, 400).trim(), timeLine].filter(Boolean).join('\n');
            // Torn ID -> Discord ID. Factions on the shared Discord server get the bot's own
            // nickname lookup first (one bulk fetch); everyone else — and any gaps — goes through
            // Torn's own Discord link, which works for any faction on any server.
            let guildMap = null, mapError = null;
            if (isSharedServerFaction(factionId)) {
                try { guildMap = await tornToDiscordIds(); } catch (e) { mapError = String(e.message || e); }
            }
            const idMap = await resolveDiscordIds(targets, { key, redis, guildMap });
            const mentions = [], noDiscord = [];
            for (const t of targets) {
                const did = idMap[t.id];
                if (did) mentions.push(`<@${did}>`); else noDiscord.push(t.name);
            }

            const text = [intro, mentions.join(' ')].filter(Boolean).join('\n');
            // Where this faction's pings go is THIS faction's own saved setting (see the
            // discord-settings actions) — never a global one, or every faction using the app would
            // post into the same channel.
            const poster = await getDiscordPoster(factionId);
            if (poster?.error) return res.status(400).json({ error: poster.error });
            const configured = !!poster;
            if (!configured || !mentions.length) {
                return res.status(200).json({ sent: false, configured, text, mentioned: mentions.length, noDiscord, mapError });
            }
            const postToDiscord = poster.post;

            // Discord caps a message at 2000 chars — split a long mention list across several.
            const chunks = [];
            let cur = intro ? `${intro}\n` : '';
            for (const m of mentions) {
                if ((cur + m + ' ').length > 1900) { chunks.push(cur.trim()); cur = ''; }
                cur += `${m} `;
            }
            if (cur.trim()) chunks.push(cur.trim());
            for (const content of chunks) {
                const users = [...content.matchAll(/<@(\d+)>/g)].map(x => x[1]);
                const r = await postToDiscord(content, users);
                if (!r.ok) {
                    const body = await r.text().catch(() => '');
                    return res.status(502).json({ error: `Discord rejected the message (${r.status})${body ? `: ${body.slice(0, 120)}` : ''}` });
                }
            }
            return res.status(200).json({ sent: true, mentioned: mentions.length, noDiscord, messages: chunks.length });
        }

        // Matched/upcoming wars a tracker can be linked to (picker in the start form).
        if (action === 'availability-wars') {
            try { return res.status(200).json({ wars: await getUpcomingWars(key, factionId) }); }
            catch (e) { return res.status(403).json({ error: String(e.message || e) }); }
        }

        // Optionally linked to a ranked war (warId — start time and opponent are taken from Torn
        // itself, not trusted from the client) or given a manual war start (warStart, unix). The
        // tracker isn't otherwise tied to any war, so both are optional.
        if (action === 'availability-start') {
            const { startDate, days, warId, warStart } = req.body;
            const dayCount = Math.min(14, Math.max(1, Number(days) || 5));
            if (!startDate) return res.status(400).json({ error: 'Missing startDate' });
            let war = null;
            if (warId) {
                let wars;
                try { wars = await getUpcomingWars(key, factionId); }
                catch (e) { return res.status(403).json({ error: String(e.message || e) }); }
                const w = wars.find(x => x.id === String(warId));
                if (!w) return res.status(400).json({ error: "Couldn't find that war among your matched/upcoming wars — it may have already ended." });
                war = { id: w.id, start: w.start, opponent: w.opponent };
            } else if (Number(warStart) > 0) {
                war = { id: null, start: Number(warStart), opponent: '' };
            }
            await redis(['SET', availabilityKey(factionId), JSON.stringify({ startDate, days: dayCount, war, entries: {}, unavailable: {} })]);
            return res.status(200).json({ ok: true });
        }

        if (action === 'list-wars') {
            const [r, restockedRaw] = await Promise.all([
                fetch(`https://api.torn.com/v2/faction?selections=rankedwars&key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } }),
                redis(['GET', restockedKey(factionId)]),
            ]);
            const data = await r.json();
            if (data.error) return res.status(403).json({ error: data.error.error });
            const restocked = restockedRaw ? JSON.parse(restockedRaw) : {};
            const wars = Object.values(data.rankedwars || {});
            const list = wars.filter(w => w.end).map(w => {
                const us = (w.factions || []).find(f => String(f.id) === factionId);
                const them = (w.factions || []).find(f => String(f.id) !== factionId);
                return {
                    id: w.id, start: w.start, end: w.end,
                    us: us ? { id: us.id, name: us.name, score: us.score } : null,
                    them: them ? { id: them.id, name: them.name, score: them.score } : null,
                    winner: w.winner,
                    restocked: !!restocked[w.id],
                };
            }).sort((a, b) => b.end - a.end);
            return res.status(200).json({ wars: list });
        }

        // Manual "did I restock after this war yet" checkbox, per war, stored per faction — the
        // leader sometimes skips restocking for a war or two before catching up, and checking
        // Torn's own history to remember what's already been done was tedious. Deliberately just
        // a plain marker, not tied to the Consumption Tracker's own numbers at all.
        if (action === 'set-restocked') {
            const { warId, restocked: value } = req.body;
            if (!warId) return res.status(400).json({ error: 'Missing warId' });
            const raw = await redis(['GET', restockedKey(factionId)]);
            const map = raw ? JSON.parse(raw) : {};
            if (value) map[warId] = true; else delete map[warId];
            await redis(['SET', restockedKey(factionId), JSON.stringify(map)]);
            return res.status(200).json({ ok: true });
        }

        if (action === 'calculate') {
            const { chainIds, warStart, warEnd } = req.body;
            const chains = Array.isArray(chainIds) ? chainIds : [];
            if (!warStart || !warEnd) return res.status(400).json({ error: 'Pick a war first — war hits are counted directly from it.' });

            const membersByAttacker = {}; // attackerId -> { warHits, overflowHits, perChain: { chainId: totalHitsInThatChain } }

            // War hits: authoritative, straight from the war itself — covers every member who
            // landed a war hit whether or not it happened inside a chain the leader added below.
            const warHitsResult = await fetchWarHits(key, factionId, warStart, warEnd);
            const nameFromAttacks = {};
            for (const [id, entry] of Object.entries(warHitsResult.perAttacker)) {
                if (!membersByAttacker[id]) membersByAttacker[id] = { warHits: 0, overflowHits: 0, perChain: {} };
                membersByAttacker[id].warHits += entry.count;
                if (entry.name) nameFromAttacks[id] = entry.name;
            }
            // Did the direct war-hit fetch actually find anything? If it scanned real attacks but
            // matched none as war hits, that's a strong signal Torn's ranked-war flag isn't the
            // field name assumed here — rather than confidently reporting 0 war hits for everyone,
            // fall back to summing chainreport's own (proven, already-used-elsewhere) war field
            // for whatever chains get added below. That fallback still misses hits outside any
            // added chain — same gap as before this fix — but it's real Torn data either way.
            const warHitsLookedBroken = warHitsResult.scanned > 0 && warHitsResult.ownAttacks === 0;
            const chainReportWarByAttacker = {}; // only populated/used if the fallback kicks in

            // Chain (overflow) hits: only from chains the leader explicitly adds — these are the
            // hits Torn itself did NOT count toward the war (almost always post-war chain
            // continuation), paid separately at a flat rate rather than a pool share.
            const perChainMeta = [];
            for (let i = 0; i < chains.length; i++) {
                const chainId = chains[i];
                if (i > 0) await sleep(1100); // stay well clear of Torn's rate limit across multiple chains
                const r = await fetch(`https://api.torn.com/v2/faction/${chainId}/chainreport?key=${encodeURIComponent(key)}`,
                    { headers: { accept: 'application/json' } });
                const data = await r.json();
                if (data.error) return res.status(403).json({ error: `Chain #${chainId}: ${data.error.error}` });
                const report = data.chainreport;
                perChainMeta.push({ id: chainId, totalHits: report?.details?.chain ?? null });
                for (const att of (report?.attackers || [])) {
                    const total = att.attacks?.total ?? 0;
                    const war = att.attacks?.war ?? 0;
                    const nonWar = Math.max(0, total - war); // hits in this chain that weren't war hits
                    const id = String(att.id);
                    if (!membersByAttacker[id]) membersByAttacker[id] = { warHits: 0, overflowHits: 0, perChain: {} };
                    membersByAttacker[id].overflowHits += nonWar;
                    membersByAttacker[id].perChain[chainId] = (membersByAttacker[id].perChain[chainId] || 0) + total;
                    chainReportWarByAttacker[id] = (chainReportWarByAttacker[id] || 0) + war;
                }
            }

            let usedFallback = false;
            if (warHitsLookedBroken && chains.length) {
                usedFallback = true;
                for (const [id, war] of Object.entries(chainReportWarByAttacker)) {
                    membersByAttacker[id].warHits = war; // replace the (broken) direct fetch's 0 with chainreport's own war count
                }
            }

            // Resolve attacker names via the current member list — best-effort, ex-members won't
            // resolve. The name carried directly off the attack record (nameFromAttacks) is
            // preferred when available, since it doesn't depend on this separate lookup matching
            // up by ID at all.
            const membersRes = await fetch(`https://api.torn.com/v2/faction/members?striptags=true&key=${encodeURIComponent(key)}`,
                { headers: { accept: 'application/json' } });
            const membersData = await membersRes.json();
            const nameById = {};
            for (const m of (membersData.members || [])) nameById[String(m.id)] = m.name;

            const members = Object.entries(membersByAttacker).map(([id, counts]) => ({
                id, name: nameFromAttacks[id] || nameById[id] || `Ex-member #${id}`,
                warHits: counts.warHits, overflowHits: counts.overflowHits,
                totalHits: counts.warHits + counts.overflowHits,
                perChain: counts.perChain,
            })).sort((a, b) => b.totalHits - a.totalHits);

            // Lets the UI flag a suspicious result, or tell the leader the fallback kicked in
            // (meaning: only chain-covered hits are counted this time, same limits as before).
            const warHitsMeta = {
                scanned: warHitsResult.scanned, matched: warHitsResult.ownAttacks,
                rateLimited: warHitsResult.rateLimited, pagesFetched: warHitsResult.pagesFetched,
                usedFallback, brokenWithNoChains: warHitsLookedBroken && !chains.length,
            };

            return res.status(200).json({ members, chains: perChainMeta, warHitsMeta });
        }

        // War Badges' own per-member stats (see lib/warBadgeStats.js / war-badges-tracker.js).
        // Lives here rather than its own api/war-badges.js file — merged in to stay under
        // Vercel Hobby's 12-Serverless-Function-per-deployment limit, which a separate file
        // pushed this project over. The two tools already shared list-wars/getProfile/isLeader
        // verbatim, so this isn't a stretch: it's the same "war data" endpoint answering one more
        // kind of question.
        if (action === 'badge-stats') {
            const { warStart, warEnd, enemyFactionId } = req.body;
            if (!warStart || !warEnd || !enemyFactionId) return res.status(400).json({ error: 'Pick a war first.' });

            const result = await fetchWarBadgeStats(key, factionId, String(enemyFactionId), warStart, warEnd);

            const membersRes = await fetch(`https://api.torn.com/v2/faction/members?striptags=true&key=${encodeURIComponent(key)}`,
                { headers: { accept: 'application/json' } });
            const membersData = await membersRes.json();
            const nameById = {};
            for (const m of (membersData.members || [])) nameById[String(m.id)] = m.name;

            const members = Object.entries(result.perAttacker).map(([id, stats]) => {
                const { name: nameFromAttacks, ...rest } = stats;
                return { id, name: nameFromAttacks || nameById[id] || `Ex-member #${id}`, ...rest };
            });

            return res.status(200).json({
                members,
                meta: { scanned: result.scanned, matched: result.ownOutgoing, rateLimited: result.rateLimited, pagesFetched: result.pagesFetched },
            });
        }

        if (action === 'save-receipt') {
            const { receipt } = req.body;
            if (!receipt) return res.status(400).json({ error: 'Missing receipt' });

            // Bake War Badges into the receipt at save time, so the public receipt page (no API
            // key, not leader-gated) can show them without ever calling Torn itself. Best-effort:
            // a badge-computation failure must not block saving the actual payout receipt, which
            // is the whole point of this action.
            let badgeStats = null;
            if (receipt.warStart && receipt.warEnd && receipt.enemyFactionId) {
                try {
                    const badgeResult = await fetchWarBadgeStats(key, factionId, String(receipt.enemyFactionId), receipt.warStart, receipt.warEnd);
                    const membersRes = await fetch(`https://api.torn.com/v2/faction/members?striptags=true&key=${encodeURIComponent(key)}`,
                        { headers: { accept: 'application/json' } });
                    const membersData = await membersRes.json();
                    const nameById = {};
                    for (const m of (membersData.members || [])) nameById[String(m.id)] = m.name;
                    badgeStats = Object.entries(badgeResult.perAttacker).map(([id, stats]) => {
                        const { name: nameFromAttacks, ...rest } = stats;
                        return { id, name: nameFromAttacks || nameById[id] || `Ex-member #${id}`, ...rest };
                    });
                } catch (e) { /* receipt still saves without badges */ }
            }

            const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
            await redis(['SET', `wwl:payout-receipt:${id}`, JSON.stringify({ ...receipt, badgeStats, factionId, createdAt: Date.now() })]);
            await redis(['SET', `wwl:latest-receipt:${factionId}`, id]);

            // Keep a running index of every receipt for this faction (newest first, capped) —
            // read by 'list-receipts' above. A read-modify-write on one small JSON blob, same
            // pattern the Consumption Tracker's event log already uses elsewhere in this codebase.
            const indexKey = `wwl:receipts-index:${factionId}`;
            const indexRaw = await redis(['GET', indexKey]);
            const index = indexRaw ? JSON.parse(indexRaw) : [];
            index.unshift({ id, opponent: receipt.opponent, warEnd: receipt.warEnd, hasBadges: !!badgeStats, createdAt: Date.now() });
            await redis(['SET', indexKey, JSON.stringify(index.slice(0, 200))]);

            return res.status(200).json({ ok: true, id });
        }

        return res.status(400).json({ error: 'Unknown action' });
    } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
    }
};
