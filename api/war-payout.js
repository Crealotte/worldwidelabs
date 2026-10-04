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

const { tornFetch } = require('../lib/tornFetch');
const { fetchWarHits, sleep, fetchLiveChainHits, isRateLimited } = require('../lib/warHits');
const { fetchWarBadgeStats } = require('../lib/warBadgeStats');
const { tornToDiscordIds, resolveDiscordIds, discordStatus } = require('../lib/discordMap');
const { moHandle, moMe, moStandings, loadExtra, isEventId } = require('../lib/memberOverview');
const { evHandle } = require('../lib/evaluation');
const { gymHandle } = require('../lib/gymStats');
const { warReports } = require('../lib/warReports');
const { sendBugReport, bugsHandle, suggestHandle } = require('../lib/bugReport');
const { steadfastHandle, steadfastImage, energyDaily } = require('../lib/steadfast');
const { tzHandle } = require('../lib/tzMap');
const { planHandle } = require('../lib/planSync');
const { nightlyHandle, nightlyRun, getVaultKey } = require('../lib/nightly');
const { usageFor } = require('../lib/tornFetch');
const { targetsHandle } = require('../lib/targets');
const { mentoringHandle } = require('../lib/mentoring');
const { labsIsOwner, labsHasOwners, labsHandle, labsRecordReceipt } = require('../lib/labsLedger');

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
const manualVerifyKey = (factionId) => `wwl:manual-verify:${factionId}`; // hash: playerId -> { intel, cat, updatedAt } — Torn Intel / CAT have no API to check, so a leader ticks it by hand
const userscriptSeenKey = (factionId) => `wwl:userscript-seen:${factionId}`; // hash: playerId -> last-seen epoch ms, stamped by the userscript itself (see 'script-checkin') for Who's on board
const userscriptInfoKey = (factionId) => `wwl:userscript-info:${factionId}`; // hash: playerId -> "version|pda" (or "version|pc"), sent by the script's own check-in
const ocRequestsKey = (factionId) => `wwl:oc-requests:${factionId}`; // hash: playerId -> { id, name, level, note, at, pinged, pingedLevel }
// Availability "plans": several trackers can exist at once (this weekend AND next weekend), each
// with its own grid, entries and linked war, picked from a dropdown. 'main' is the original
// single-tracker key from before plans existed, so an existing tracker keeps working untouched;
// new plans get their own key. A small index per faction holds just the light metadata the
// dropdown needs, so listing plans never loads every plan's entries.
const availabilityIndexKey = (factionId) => `wwl:availability-index:${factionId}`;
const availabilityKey = (factionId, planId) => (!planId || planId === 'main')
    ? `wwl:availability:${factionId}` : `wwl:availability:${factionId}:${planId}`;

async function loadPlanIndex(factionId) {
    const raw = await redis(['GET', availabilityIndexKey(factionId)]);
    if (raw) return JSON.parse(raw);
    const legacy = await redis(['GET', availabilityKey(factionId, 'main')]); // a tracker from before plans existed
    if (!legacy) return [];
    const d = JSON.parse(legacy);
    return [{ id: 'main', name: d.name || '', startDate: d.startDate, days: d.days, war: d.war || null, createdAt: 0 }];
}

// The plan to show when none is asked for: the earliest one that hasn't finished yet, else the
// most recently created.
function defaultPlanId(plans) {
    if (!plans.length) return null;
    const today = new Date().toISOString().slice(0, 10);
    const endOf = p => { const d = new Date(`${p.startDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + p.days); return d.toISOString().slice(0, 10); };
    const live = plans.filter(p => endOf(p) >= today).sort((a, b) => a.startDate.localeCompare(b.startDate));
    return (live[0] || plans[plans.length - 1]).id;
}

// `allowArchived` (leaders only, and only when they explicitly picked one) lets an archived plan be opened —
// otherwise a requested archived plan is ignored and the usual default (never archived) is used instead, so a
// member whose browser still remembers an old plan id is never quietly shown one that was hidden from them.
async function resolvePlan(factionId, requestedId, allowArchived = false) {
    const plans = await loadPlanIndex(factionId);
    let id = plans.find(p => p.id === requestedId)?.id;
    if (id && plans.find(p => p.id === id)?.archived && !allowArchived) id = null;
    id = id || defaultPlanId(plans.filter(p => !p.archived));
    if (!id) return { plans, id: null, data: null };
    const raw = await redis(['GET', availabilityKey(factionId, id)]);
    return { plans, id, data: raw ? JSON.parse(raw) : null };
}

// Resolves faction + the caller's own identity in one profile fetch — the availability tracker
// (any member, not just leaders) needs to know who's actually recording their own slots.
// Torn's profile lookup, retried once when Torn answers "too many requests" or a passing backend error
// (a leader running a payout uses up their own 100-calls-a-minute, and the script's check lands in the middle).
// If it still fails, the reason is kept in getProfile.lastError so the caller can say WHY, not just "no faction".
async function getProfile(key) {
    getProfile.lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        const r = await tornFetch(`https://api.torn.com/user/?selections=profile&key=${encodeURIComponent(key)}`);
        const profile = await r.json();
        if (profile.error) {
            getProfile.lastError = `Torn says: ${profile.error.error || 'error'} (code ${profile.error.code ?? '?'})`;
            if (attempt === 0 && [5, 17].includes(Number(profile.error.code))) { await sleep(2000); continue; }
            return null;
        }
        if (!profile.faction?.faction_id) { getProfile.lastError = 'Torn returned no faction for this key — is the key from a player in a faction?'; return null; }
        return { factionId: String(profile.faction.faction_id), factionName: profile.faction.faction_name || '', daysInFaction: profile.faction.days_in_faction ?? null, playerId: String(profile.player_id), name: profile.name, position: profile.faction.position || '' };
    }
    return null;
}
async function isLeader(key) {
    const r = await tornFetch(`https://api.torn.com/v2/faction/balance?key=${encodeURIComponent(key)}`,
        { headers: { accept: 'application/json' } });
    const d = await r.json();
    return !d.error;
}
// "Leader" or "Co-leader" specifically, not just any position with API access (Council) — Torn assigns
// these two exact, unrenameable position names. Used where the AUDIT.md spec says Leader/Co-leader
// only, not Council (currently just Labs Funds — the rest of that spec is still preview-only).
const isLeaderRank = (profile) => profile?.position === 'Leader' || profile?.position === 'Co-leader';

// Ranked wars with no end yet — i.e. matched-but-not-started, or still running. What the
// availability tracker links to, so the war's start time (and the overdose window derived from
// it) comes straight from Torn instead of being typed in.
async function getUpcomingWars(key, factionId) {
    const r = await tornFetch(`https://api.torn.com/v2/faction?selections=rankedwars&key=${encodeURIComponent(key)}`,
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

// DISCORD_KINDS: the named destinations a faction can point at different channels. 'default' is the
// original single destination (availability pings); 'feedback' and 'whatsnew' are separate so a leader
// can, say, keep availability pings in a war channel but feedback nudges somewhere quieter.
const DISCORD_KINDS = ['default', 'feedback', 'whatsnew', 'oc', 'bank'];
// Resolves to { post(content, users, embeds?) } for this faction and kind, { error }, or null if
// nothing is set up for it. Newer saves live under `channels`, one destination per kind; a kind with
// no destination of its own falls back to 'default', and 'default' itself still understands the old
// flat { webhookUrl, channelId } shape from before named channels existed, so nobody's existing setup
// silently broke when this was added.
async function getDiscordPoster(factionId, kind = 'default') {
    const raw = await redis(['GET', discordSettingsKey(factionId)]);
    const all = raw ? JSON.parse(raw) : {};
    const legacy = (all.webhookUrl || all.channelId) ? { webhookUrl: all.webhookUrl, channelId: all.channelId } : null;
    const s = all.channels?.[kind] || (kind === 'default' ? legacy : null) || all.channels?.default || legacy || {};
    if (s.webhookUrl) {
        if (!WEBHOOK_RE.test(s.webhookUrl)) return { error: 'The saved Discord webhook URL doesn\'t look valid — save it again in the Discord settings.' };
        const u = (params) => { const q = Object.entries(params).filter(([, v]) => v).map(([k]) => `${k}=true`); return q.length ? `${s.webhookUrl}${s.webhookUrl.includes('?') ? '&' : '?'}${q.join('&')}` : s.webhookUrl; };
        return {
            // `wait` makes Discord answer with the posted message (so its id can be remembered and the message edited later)
            post: (content, users, embeds, components, wait) => fetch(u({ with_components: !!components, wait: !!wait }), {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content, username: 'WWLabs', allowed_mentions: { parse: [], users }, ...(embeds ? { embeds } : {}), ...(components ? { components } : {}) }),
            }),
            // edit a message this webhook posted earlier (components: [] removes the buttons)
            edit: (messageId, content, components, embeds) => fetch(`${u({ with_components: !!(components && components.length) }).replace(s.webhookUrl, `${s.webhookUrl.split('?')[0]}/messages/${encodeURIComponent(messageId)}`)}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content, allowed_mentions: { parse: [] }, ...(embeds ? { embeds } : {}), ...(components ? { components } : {}) }),
            }),
        };
    }
    if (s.channelId && isSharedServerFaction(factionId) && process.env.DISCORD_BOT_TOKEN) {
        const base = `https://discord.com/api/v10/channels/${encodeURIComponent(s.channelId)}/messages`, auth = { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' };
        return {
            post: (content, users, embeds, components) => fetch(base, {
                method: 'POST', headers: auth,
                body: JSON.stringify({ content, allowed_mentions: { parse: [], users }, ...(embeds ? { embeds } : {}), ...(components ? { components } : {}) }),
            }),
            edit: (messageId, content, components, embeds) => fetch(`${base}/${encodeURIComponent(messageId)}`, {
                method: 'PATCH', headers: auth,
                body: JSON.stringify({ content, allowed_mentions: { parse: [] }, ...(embeds ? { embeds } : {}), ...(components ? { components } : {}) }),
            }),
        };
    }
    return null;
}

// ---- Overdose tracking, from Torn's own "times overdosed" personal stat — no bot, no hospital
// status. Torn lets any key read that stat for any member, right now or as of a past timestamp,
// so "who overdosed since <window start>" is just (count now) - (count at window start). It can't
// say WHICH drug (that lives in each member's private logs), and personalstats history is daily-
// ish snapshots, so a member's baseline can sit a little before the exact window start. Every scan
// also compares against the previous scan and logs any increase as an event with when it was
// noticed — the start of a log that's ours, instead of depending on another service's.
const odDocKey = (factionId) => `wwl:od-tracker:${factionId}`;

// The window: from midnight (TCT) of the day 48h before the linked war starts. With no war
// linked (e.g. nothing matched yet this week) it falls back to the last ~3 days so there's still
// something to look at.
function odWindowFor(plans) {
    const now = Math.floor(Date.now() / 1000);
    // Across all plans with a war start: the nearest upcoming one, else the most recent that
    // started within the last two weeks.
    const starts = (plans || []).map(p => p.war?.start).filter(s => s && s > now - 14 * 86400);
    const upcoming = starts.filter(s => s >= now).sort((a, b) => a - b)[0];
    const warStart = upcoming ?? starts.sort((a, b) => b - a)[0] ?? null;
    if (warStart) return { start: Math.floor((warStart - 48 * 3600) / 86400) * 86400, warStart, fallback: false };
    return { start: Math.floor((now - 2 * 86400) / 86400) * 86400, warStart: null, fallback: true };
}

// Reads one member's overdosed count (now, or as of `timestamp`). The response nesting isn't
// something I could verify against a live key, so this accepts a flat object, a category-nested
// one, or a name/value list — and returns null rather than 0 if it can't find the number, so a
// parsing miss can never masquerade as "zero overdoses".
async function fetchOverdosed(id, key, timestamp) {
    const r = await tornFetch(`https://api.torn.com/user/${encodeURIComponent(id)}?selections=personalstats&stat=overdosed${timestamp ? `&timestamp=${timestamp}` : ''}&key=${encodeURIComponent(key)}`);
    const d = await r.json();
    if (d.error) { const e = new Error(d.error.error); e.code = d.error.code; throw e; }
    const ps = d.personalstats;
    let v;
    if (Array.isArray(ps)) v = ps.find(x => x.name === 'overdosed')?.value;
    else if (ps && typeof ps === 'object') {
        v = ps.overdosed;
        if (v === undefined) for (const c of Object.values(ps)) if (c && typeof c === 'object' && 'overdosed' in c) { v = c.overdosed; break; }
    }
    return Number.isFinite(Number(v)) && v !== undefined && v !== null ? Number(v) : null;
}

async function getRoster(key) {
    const r = await tornFetch(`https://api.torn.com/v2/faction/members?striptags=true&key=${encodeURIComponent(key)}`,
        { headers: { accept: 'application/json' } });
    const d = await r.json();
    if (d.error) throw new Error(d.error.error);
    return (d.members || []).map(m => ({ id: String(m.id), name: m.name }));
}


// A plan linked to a war (or given a start time by hand) only counts hours from that start on: a slot before it is
// not open to tick, and ticks that were made there before are left out of every count.
function slotBeforeStart(data, slotKey) {
    const start = data?.war?.start;
    if (!start || !data?.startDate) return false;
    const [y, m, d] = String(data.startDate).split('-').map(Number);
    const [day, hour] = String(slotKey).split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 1000 + (day * 24 + hour) * 3600 < Math.floor(start / 3600) * 3600;
}

// Blue ring: one primary and one backup per hour. Who holds an hour, in the order they took it (a plain `true` from before is oldest);
// members who said they can't make it, and marks on hours that are no longer ticked, don't count.
const WATCH_MAX = 2;
function watchOrder(data, slotKey) {
    const list = [];
    for (const [id, entry] of Object.entries(data?.entries || {})) {
        if (data.unavailable?.[id]) continue;
        const t = entry.watch?.[slotKey];
        if (t && entry.slots?.[slotKey]) list.push({ id, name: entry.name || `#${id}`, at: t === true ? 0 : Number(t) || 0 });
    }
    return list.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}
// Everyone who has actually filled the tracker in for this war: ticked at least one slot, or
// marked themselves not available. An entry left behind by ticking and then un-ticking
// everything doesn't count as having responded.
function respondedMap(data) {
    const out = {};
    for (const [id, entry] of Object.entries(data?.entries || {})) {
        const vals = Object.entries(entry.slots || {}).filter(([k]) => !slotBeforeStart(data, k)).map(e => e[1]);
        const slotCount = vals.length, maybe = vals.filter(v => v === 'maybe').length; // green = the rest
        const watch = Object.keys(entry.watch || {}).filter(k => (entry.slots || {})[k] && !slotBeforeStart(data, k)).length;
        if (slotCount) out[id] = { id, name: entry.name, slotCount, green: slotCount - maybe, maybe, watch, out: false };
    }
    for (const [id, u] of Object.entries(data?.unavailable || {})) out[id] = { id, name: u.name, slotCount: out[id]?.slotCount || 0, out: true };
    return out;
}


// ---- Banners: short messages a leader pins at the top of every page (a new feature, a Torn event, a reminder). One list per faction:
// [{ id, text, page, linkLabel, audience: 'all'|'leaders', tone: 'info'|'event'|'warn', expires: 'YYYY-MM-DD'|'', createdAt }].
const bannersKey = factionId => `wwl:banners:${factionId}`;
async function loadBanners(factionId) {
    const raw = await redis(['GET', bannersKey(factionId)]);
    try { return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
}
const bannerLive = b => !b.expires || b.expires >= new Date().toISOString().slice(0, 10); // the expiry day itself still counts
// The leader to-do card on the dashboard: things only a leader can fix, worked out from what WWL already stores (plus the cached member list),
// so it costs (almost) no Torn calls. Every item says where to go: { id, text, cta, page, anchor } — anchor is an element on that page to scroll to.
async function leaderTodos(key, factionId) {
    const todos = [];
    const add = (id, text, cta, page, anchor) => todos.push({ id, text, cta, page, anchor });

    // 1. Discord destination
    try {
        const poster = await getDiscordPoster(factionId);
        if (!poster) add('discord', 'Discord is not connected yet, so the availability pings and reminders cannot be sent.', 'Set up Discord', 'leader-settings', 'av-discord-panel');
        else if (poster.error) add('discord', poster.error, 'Fix the Discord settings', 'leader-settings', 'av-discord-panel');
    } catch (e) { /* skip this check */ }

    // 2. nightly saving
    try {
        const vault = await redis(['HGET', 'wwl:snapshot-vault', factionId]);
        const envKeys = String(process.env.WWL_SNAPSHOT_KEYS || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!vault && !envKeys.length) add('nightly', 'Nightly saving is off — on days nobody opens WWL the energy trained, respect and perk levels are not saved.', 'Turn it on', 'leader-settings', 'pc-nightly');
        else if (vault) { const v = JSON.parse(vault); if (v.lastOk === false) add('nightly', `Nightly saving failed the last time it ran (${v.lastError || 'unknown reason'}). ${v.name || 'The leader who switched it on'} may need to turn it on again.`, 'Check it', 'leader-settings', 'pc-nightly'); }
    } catch (e) { /* skip */ }

    // 3 + 4. availability plan: one for what is coming up, and everyone has filled it in
    try {
        const plans = (await loadPlanIndex(factionId)).filter(p => !p.archived); // an archived plan is exactly the kind we don't want nagging leaders about any more
        const today = new Date().toISOString().slice(0, 10);
        const endOf = p => { const d = new Date(`${p.startDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + p.days); return d.toISOString().slice(0, 10); };
        const live = plans.filter(p => endOf(p) >= today).sort((a, b) => a.startDate.localeCompare(b.startDate));
        if (!live.length) add('plan', 'There is no availability plan for an upcoming war or weekend yet.', 'Create a plan', 'availability-leaders', 'av-start-panel');
        else {
            const p = live[0];
            const raw = await redis(['GET', availabilityKey(factionId, p.id)]);
            const data = raw ? JSON.parse(raw) : null;
            // Shows as soon as the plan exists — even a war that hasn't been matched yet (a placeholder start
            // date further out) — rather than waiting until 4 days before the (possibly guessed) start date.
            if (data) {
                const responded = respondedMap(data);
                const roster = await getRoster(key);
                const missing = roster.filter(m => !responded[m.id]);
                if (missing.length) add('members', `${missing.length} of ${roster.length} members have not filled in ${p.name ? `"${p.name}"` : 'the availability plan'} yet.`, 'See who and ping them', 'availability-leaders', 'av-out-panel');
            }
        }
    } catch (e) { /* skip */ }

    // 5. feedback form: everyone has filled it in (same idea as the availability check above,
    // just against the feedback-responses hash instead of a plan's entries)
    try {
        const formRaw = await redis(['GET', `wwl:feedback-form:${factionId}`]);
        const form = formRaw ? JSON.parse(formRaw) : null;
        if (form?.mode === 'native') {
            const respondedIds = new Set((await redis(['HKEYS', `wwl:feedback-responses:${factionId}`])) || []);
            const roster = await getRoster(key);
            const missing = roster.filter(m => !respondedIds.has(m.id));
            if (missing.length) add('feedback', `${missing.length} of ${roster.length} members have not filled in ${form.title ? `"${form.title}"` : 'the feedback form'} yet.`, 'See who and ping them', 'feedback-edit', 'fb-responses-panel');
        }
    } catch (e) { /* skip */ }

    // 5b. members who asked for an OC at some level (see ocreq-submit)
    try {
        const flat = (await redis(['HGETALL', ocRequestsKey(factionId)])) || [];
        const reqs = [];
        for (let i = 0; i < flat.length; i += 2) { try { reqs.push(JSON.parse(flat[i + 1])); } catch (e) { /* skip */ } }
        if (reqs.length) add('oc-requests', `${reqs.length} member${reqs.length === 1 ? ' has' : 's have'} asked for an OC to be spawned: ${reqs.slice(0, 6).map(r => `${r.name} (level ${r.level})`).join(', ')}${reqs.length > 6 ? ` and ${reqs.length - 6} more` : ''}.`, 'See the requests', 'oc-requests', null);
    } catch (e) { /* skip */ }

    // 6. Steadfast: every stat has reached its challenge
    try {
        const sf = await steadfastHandle('steadfast-get', {}, { redis, key, factionId, leader: false });
        if (sf?.countdown?.allDone) add('steadfast', 'All the Steadfast challenges are done — time to upgrade.', 'Open the Steadfast planner', 'steadfast', null);
    } catch (e) { /* skip */ }

    return { todos };
}



// ---- Bank requests (see 'bank-info' / 'bank-submit' in the handler) ----
const bankRequestsKey = (factionId) => `wwl:bank-requests:${factionId}`; // hash: requestId -> { id, playerId, name, amount, balance, at, status, claimedBy }
// Digs the faction-vault amount out of a /user money answer, wherever it sits: a number or { money | balance } under a key
// that starts with "faction" (faction, faction_balance, factionMoney ...) at any depth. null when there is none.
function findFactionMoney(d, depth = 0) {
    if (!d || typeof d !== 'object' || depth > 4) return null;
    for (const [k, v] of Object.entries(d)) {
        if (/^faction/i.test(k)) {
            if (typeof v === 'number') return v;
            if (v && typeof v === 'object') { const m = v.money ?? v.balance ?? v.cash; if (typeof m === 'number') return m; }
        }
    }
    for (const v of Object.values(d)) { const m = findFactionMoney(v, depth + 1); if (m !== null) return m; }
    return null;
}
// A member's faction-vault balance, live (never from the 10-minute cache). First choice: the member's OWN key (opts.ownKey) —
// no leader needed. Otherwise a leader key can read everyone's balance: the one passed in (opts.leaderKey, e.g. the banker
// claiming a request) or the one kept for nightly saving.
async function bankBalanceOf(factionId, playerId, opts = {}) {
    let hint = '';
    if (opts.ownKey) {
        try {
            const r = await fetch(`https://api.torn.com/v2/user/money?key=${encodeURIComponent(opts.ownKey)}`, { headers: { accept: 'application/json' } });
            const d = await r.json();
            if (!d.error) {
                const m = findFactionMoney(d);
                if (m !== null) return { balance: Math.max(0, Math.floor(m)), source: 'own key' };
                hint = ` (your key's money answer had: ${Object.keys(d.money || d).join(', ').slice(0, 120)})`;
            }
        } catch (e) { /* fall through to the leader key */ }
    }
    const lk = opts.leaderKey || await getVaultKey(redis, factionId);
    if (!lk) return { balance: null, error: `Could not read your balance with your own key${hint}, and no leader key is available either — a leader has to switch on "nightly saving" (Leader settings).` };
    try {
        // plain fetch, NOT tornFetch: that caches the faction balance for 10 minutes, and a bank request needs the real number now
        const r = await fetch(`https://api.torn.com/v2/faction/balance?key=${encodeURIComponent(lk)}`, { headers: { accept: 'application/json' } });
        const d = await r.json();
        if (d.error) return { balance: null, error: `Could not read the faction balance: ${d.error.error || d.error.code}` };
        const b = d.balance || d;
        const members = Array.isArray(b.members) ? b.members : Object.entries(b.members || {}).map(([id, m]) => ({ id, ...m }));
        const mine = members.find(m => String(m.id ?? m.user_id) === String(playerId));
        if (!mine) return { balance: null, error: 'You are not in the faction balance list.' };
        const money = Number(mine.money ?? mine.balance ?? mine.cash);
        if (!Number.isFinite(money)) return { balance: null, error: 'Torn returned a balance in a form WWL does not recognise.' };
        return { balance: Math.max(0, Math.floor(money)) };
    } catch (e) { return { balance: null, error: `Could not read the faction balance: ${String(e.message || e).slice(0, 80)}` }; }

// The banker cookie for the instant Claim button (see GET ?bankgo): a signed { player id, name, faction } that only 'bank-token'
// (leader-gated) hands out. It says WHO is clicking so the Discord message can name them; the signature stops anyone from forging it.
const bankCookieSecret = () => require('crypto').createHash('sha256').update(`${REDIS_TOKEN || ''}|wwl-bank-cookie`).digest();
function bankCookieValue(playerId, name, factionId) {
    const crypto = require('crypto');
    const p = Buffer.from(JSON.stringify({ i: String(playerId), n: String(name), f: String(factionId), t: Date.now() })).toString('base64url');
    return `${p}.${crypto.createHmac('sha256', bankCookieSecret()).update(p).digest('base64url')}`;
}
function bankCookieParse(header) {
    const crypto = require('crypto');
    const m = /(?:^|;\s*)wwl_banker=([^;]+)/.exec(String(header || ''));
    if (!m) return null;
    const [p, sig] = m[1].split('.');
    if (!p || !sig) return null;
    const good = crypto.createHmac('sha256', bankCookieSecret()).update(p).digest('base64url');
    if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
    try { const d = JSON.parse(Buffer.from(p, 'base64url').toString()); return Date.now() - d.t < 30 * 86400000 ? d : null; } catch (e) { return null; }
}
}
// Updates the Discord message of a bank request once it is claimed or cancelled: the buttons are removed or disabled and a line
// says who claimed it, so nobody can press Claim again and pay it twice. Best effort — the claim itself is already exclusive on
// the server (SET NX), this is the visible half of it.
// The look of a bank request in Discord (an embed, like other banking bots): who, the amount, when — never the member's balance.
// state: 'open' | 'claimed' (a banker is on it) | 'cancelled'.
function bankEmbed(r, state, by) {
    const when = new Date(r.at).toISOString();
    const line = `[${r.name}](https://www.torn.com/profiles.php?XID=${r.playerId}) (${r.playerId}) — **$${Number(r.amount).toLocaleString('en-US')}** requested on ${when.slice(0, 10)} at ${when.slice(11, 16)} TCT`;
    const extra = state === 'claimed' ? `\n⏳ **${by}** is on it…` : state === 'cancelled' ? `\n❌ **This request has been cancelled by ${by}**` : '';
    return { description: line + extra, color: state === 'cancelled' ? 0xE05555 : 0xF0B432 };
}
// Updates the Discord message of a bank request once it is claimed or cancelled: the Claim button is greyed out ("Claimed") or all
// buttons are removed (cancelled), and the text says who did it, so nobody can press Claim again and pay it twice. Best effort —
// the claim itself is already exclusive on the server (SET NX), this is the visible half of it.
async function bankMarkDiscord(factionId, r, status, byName) {
    if (!r.msgId) return;
    try {
        const poster = await getDiscordPoster(factionId, 'bank');
        if (!poster || poster.error || !poster.edit) return;
        const embeds = [bankEmbed(r, status, byName)];
        const comps = status === 'claimed' && r.claimUrl ? [{ type: 1, components: [{ type: 2, style: 5, label: '⏳ Claimed', url: r.claimUrl, disabled: true }] }] : [];
        const x = await poster.edit(r.msgId, '', comps, embeds);
        if (!x.ok) await poster.edit(r.msgId, '', [], embeds); // a setup that will not show the disabled button: just drop the buttons
    } catch (e) { /* the message stays as posted; the server-side claim still protects against double payouts */ }
}
// This member's open (unclaimed) request, if any
async function bankOpenOf(factionId, playerId) {
    const flat = (await redis(['HGETALL', bankRequestsKey(factionId)])) || [];
    for (let i = 0; i < flat.length; i += 2) { try { const r = JSON.parse(flat[i + 1]); if (r.playerId === playerId && r.status === 'open') return r; } catch (e) { /* skip */ } }
    return null;
}

// Turns the work file into a separately installable "DEV" userscript (see the GET handler: ?script=1&dev=1): its own
// name/namespace and update address, a DEV tag on the button and window, a separate update channel for the version
// check, and its own saved update/check-in state (it shares the saved key and position with the normal script).
function devizeScript(src) {
    return src
        .replace(/\/worldwidelabs\.user\.js/g, '/worldwidelabs-dev.user.js')
        .replace(/(\/\/ @name\s+)World Wide Labs/, '$1World Wide Labs (DEV)')
        .replace(/(\/\/ @namespace\s+\S+)/, '$1/dev')
        .replace("{ action: 'script-version' }", "{ action: 'script-version', channel: 'dev' }")
        .replace(/'wwl_update_check'/g, "'wwl_update_check_dev'")
        .replace(/'wwl_script_checkin_at'/g, "'wwl_script_checkin_at_dev'")
        .replace(/'wwl_script_checkin_v'/g, "'wwl_script_checkin_v_dev'")
        .replace('<b>WWL</b>', '<b>WWL DEV</b>')
        .replace(/(<b style="flex:1;">World Wide Labs)/, '$1 DEV');
}
module.exports = async function handler(req, res) {
    try {
        // The WWL userscript runs on torn.com and reads/ticks the energy plan from here, so torn.com may call these actions.
        res.setHeader('Access-Control-Allow-Origin', 'https://www.torn.com');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Vary', 'Origin');
        if (req.method === 'OPTIONS') return res.status(204).end();
        // The WWL userscript for Torn: GET /worldwidelabs.user.js, or the older /wwl-energy-planner.user.js
        // (both rewritten to this same handler — see vercel.json; the old path is kept alive so
        // existing installs, whose @updateURL is baked in from whenever they first installed, keep
        // updating). Tampermonkey installs it straight from this link; the site's own address is
        // filled in so the script talks to the right place.
        if (req.method === 'GET' && req.query?.script) {
            // ?dev=1 serves the WORK file (userscripts/energy-plan.dev.user.js) as its own, separate userscript for testing:
            // different name, its own update address and channel, and its own saved-state names, so it can sit next to
            // (or replace) the normal one without the two confusing each other. Members never see it; a release is just
            // copying the work file over energy-plan.user.js.
            const dev = !!req.query.dev;
            let src = require('fs').readFileSync(require('path').join(process.cwd(), 'userscripts', dev ? 'energy-plan.dev.user.js' : 'energy-plan.user.js'), 'utf8');
            if (dev) src = devizeScript(src);
            const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').replace(/[^\w.:-]/g, '');
            res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
            res.setHeader('Cache-Control', dev ? 'no-store' : 'public, max-age=300');
            return res.status(200).send(src.split('__WWL_BASE__').join(`https://${host}`).split('__WWL_HOST__').join(host));
        }
        if (!REDIS_URL || !REDIS_TOKEN) {
            return res.status(500).json({ error: 'Database not connected. In Vercel: Storage -> Create Database -> Upstash Redis, and connect it to this project.' });
        }
        // The Discord "Claim" button for a bank request: GET /bank-go?id=...  A banker who has opened WWL before carries a signed
        // cookie (set by 'bank-token'), so this claims the request on the spot, edits the Discord message ("Claimed by ..."),
        // and answers with a plain redirect straight to Torn's vault screen with the member and amount filled in — no WWL page
        // in between. Without the cookie it sends the banker to the normal WWL claim page once (which sets the cookie).
        if (req.method === 'GET' && req.query?.bankgo) {
            const id = String(req.query.id || '').replace(/[^0-9a-f]/g, '');
            const page = (status, msg) => res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui,sans-serif;background:#0e1116;color:#e6ebf0;padding:32px;max-width:560px;margin:auto"><h2>Bank request</h2><p>${msg}</p>`);
            const who = bankCookieParse(req.headers.cookie);
            if (!id) return page(400, 'This link is missing its request id.');
            if (!who) return res.status(302).setHeader('Location', `/bank-claim?id=${id}`).end();
            const raw = await redis(['HGET', bankRequestsKey(who.f), id]);
            if (!raw) return page(404, 'That request was cancelled or no longer exists.');
            const r = JSON.parse(raw);
            const got = await redis(['SET', `wwl:bank-claim:${who.f}:${id}`, who.i, 'NX', 'EX', String(7 * 86400)]);
            if (!got) {
                const by = await redis(['GET', `wwl:bank-claim:${who.f}:${id}`]);
                if (by !== who.i) return page(409, `Already claimed by <b>${String(r.claimedBy || 'another banker').replace(/[<>&]/g, '')}</b>. Nothing to do here.`);
            }
            // never send a banker to a payout larger than the member's balance right now (best effort: needs a readable balance)
            let pay = r.amount;
            try { const lk = await getVaultKey(redis, who.f); if (lk) { const live = await bankBalanceOf(who.f, r.playerId, { leaderKey: lk }); if (live.balance !== null && live.balance < pay) pay = live.balance; } } catch (e) { /* keep the requested amount */ }
            if (pay < 1) return page(400, `${String(r.name).replace(/[<>&]/g, '')}'s balance is now $0, so there is nothing to pay out.`);
            if (got) {
                r.status = 'claimed'; r.claimedBy = who.n; r.claimedAt = Date.now();
                await redis(['HSET', bankRequestsKey(who.f), id, JSON.stringify(r)]);
                await bankMarkDiscord(who.f, r, 'claimed', who.n);
            }
            return res.status(302).setHeader('Location', `https://www.torn.com/factions.php?step=your#/tab=controls&giveMoneyTo=${encodeURIComponent(r.playerId)}&money=${encodeURIComponent(pay)}`).end();
        }

        // The daily snapshot (Vercel Cron, see vercel.json): saves the faction's gym counters and upgrade levels once a day
        // without anyone having to log in. It uses the API key(s) in the WWL_SNAPSHOT_KEYS environment variable — one
        // key per faction, of a leader with faction API access, separated by commas. Harmless to call by hand: it only
        // refreshes stored numbers.
        if (req.method === 'GET' && req.query?.cron) {
            const extra = String(process.env.WWL_SNAPSHOT_KEYS || '').split(',').map(s => s.trim()).filter(Boolean);
            const results = await nightlyRun(redis, extra, getProfile, (k, fid) => require('./respect').runTracking(k, fid));
            return res.status(200).json({ ran: results.length, results });
        }

        // The Steadfast countdown picture for a faction announcement: GET /api/war-payout?steadfast=<code> (no login;
        // the long random code in the link is the "key"). See lib/steadfast.js.
        if (req.method === 'GET' && req.query?.steadfast) {
            const png = await steadfastImage(redis, req.query.steadfast);
            if (!png) return res.status(404).send('Not found');
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
            return res.status(200).send(png);
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

        // Lets the userscript flag a newer version without doing its own raw GET-and-regex fetch of the live .user.js file
        // (TornPDA's script manager only has a POST bridge). Reads the same on-disk file the /worldwidelabs.user.js download
        // serves, so it is the one source of truth. It sits ABOVE the key and profile checks on purpose: the version number
        // is public anyway, and answering it with no key means no Torn call and no database command at all — the cheapest
        // way to check for an update, so it can be asked as often as needed.
        if (action === 'script-version') {
            const src = require('fs').readFileSync(require('path').join(process.cwd(), 'userscripts', req.body?.channel === 'dev' ? 'energy-plan.dev.user.js' : 'energy-plan.user.js'), 'utf8');
            const m = /@version\s+([\d.]+)/.exec(src);
            return res.status(200).json({ version: m ? m[1] : null });
        }
        if (!key) return res.status(400).json({ error: 'Missing key' });

        const profile = await getProfile(key);
        if (!profile) return res.status(403).json({ error: `Could not determine your faction from this key${getProfile.lastError ? ` — ${getProfile.lastError}` : ''}` });
        const { factionId, playerId, name: playerName, factionName, daysInFaction } = profile;
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
            const leaderFlag = await isLeader(key);
            const { plans: allPlans, id: planId, data } = await resolvePlan(factionId, req.body.planId, leaderFlag);
            const mine = data?.entries?.[playerId]?.slots || {};
            const unavailable = data?.unavailable || {};
            const viewingArchived = !!allPlans.find(p => p.id === planId)?.archived;
            const result = {
                plans: allPlans.filter(p => !p.archived), // the everyday dropdown — archived plans never show here, for anyone
                archivedPlans: leaderFlag ? allPlans.filter(p => p.archived) : [], // leaders only: the separate "pick one to view" list
                planId, viewingArchived,
                // war = the ranked war this tracker is linked to ({ id, start, opponent }), if any
                config: data ? { startDate: data.startDate, days: data.days, war: data.war || null, name: data.name || '' } : null,
                mine,
                mineWatch: data?.entries?.[playerId]?.watch || {}, // hours I marked as chain watch / war coordinator
                myUnavailable: unavailable[playerId] || null, // { name, note, at } if I marked myself out
            };
            { // how many of the two places (primary + backup) are taken per hour, and which one I hold
                const taken = {}, role = {}, slots = new Set();
                for (const entry of Object.values(data?.entries || {})) for (const k of Object.keys(entry.watch || {})) slots.add(k);
                for (const k of slots) { const order = watchOrder(data, k); if (order.length) taken[k] = Math.min(WATCH_MAX, order.length); const i = order.findIndex(o => o.id === playerId); if (i >= 0) role[k] = i === 0 ? 'primary' : 'backup'; }
                result.watchTaken = taken; result.mineRole = role;
            }
            if (leaderFlag) {
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
                    for (const [slot, val] of Object.entries(entry.slots || {})) {
                        if (slotBeforeStart(data, slot)) continue;
                        const s = summary[slot] || (summary[slot] = { count: 0, names: [], ids: [], maybe: 0, maybeNames: [], maybeIds: [] });
                        const name = entry.name || `#${id}`;
                        if (val === 'maybe') { s.maybe++; s.maybeNames.push(name); s.maybeIds.push(id); }
                        else { s.count++; s.names.push(name); s.ids.push(id); } // ids let the leader link each name to their Torn profile
                    }
                }
                for (const [slot, s] of Object.entries(summary)) { // the blue ring: primary first, then the backup
                    const order = watchOrder(data, slot).slice(0, WATCH_MAX);
                    if (order.length) { s.watch = order.length; s.watchNames = order.map(o => o.name); s.watchIds = order.map(o => o.id); }
                }
                result.summary = summary;
            }
            return res.status(200).json(result);
        }

        if (action === 'availability-set') {
            const { day, hour, available } = req.body;
            if (day == null || hour == null) return res.status(400).json({ error: 'Missing day/hour' });
            const { id: planId, data } = await resolvePlan(factionId, req.body.planId);
            if (!data) return res.status(400).json({ error: 'No availability tracker is active for this faction right now — ask a leader to start one.' });
            const entry = data.entries[playerId] || (data.entries[playerId] = { name: playerName, slots: {} });
            entry.name = playerName; // keep it current in case of a name change
            const slotKey = `${day}-${hour}`;
            if (slotBeforeStart(data, slotKey)) return res.status(400).json({ error: 'That hour is before the start — you can only tick hours from the start on.' });
            // state: 'yes' (green) | 'maybe' (yellow — likely, but might be busy) | '' (off).
            // Older clients sent a plain boolean `available`, which still means yes/off.
            const state = req.body.state !== undefined ? req.body.state : (available ? 'yes' : '');
            if (state === 'yes') entry.slots[slotKey] = true;
            else if (state === 'maybe') entry.slots[slotKey] = 'maybe';
            else { delete entry.slots[slotKey]; if (entry.watch) delete entry.watch[slotKey]; }
            await redis(['SET', availabilityKey(factionId, planId), JSON.stringify(data)]);
            return res.status(200).json({ ok: true });
        }

        // Hits of a chain that is still running (leaders): read from the attack log in pieces; the page keeps asking with `from`
        // set to the `next` it was given until that comes back empty. Used by the hits comparison on the Availability overview.
        if (action === 'av-live-hits') {
            if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });
            const from = Math.floor(Number(req.body.from)), to = Math.floor(Date.now() / 1000);
            if (!(from > 0) || from > to) return res.status(400).json({ error: 'Pick a start time that is in the past.' });
            return res.status(200).json(await fetchLiveChainHits(key, factionId, from, to));
        }
        // The blue ring: an hour I can watch the chain (no war) or coordinate the war (calls, plan changes, keeping the chat clear).
        // Marking an hour that was not ticked yet also makes it green; taking the ring off leaves the colour as it is.
        if (action === 'availability-watch') {
            const { day, hour, watch } = req.body;
            if (day == null || hour == null) return res.status(400).json({ error: 'Missing day/hour' });
            const { id: planId, data } = await resolvePlan(factionId, req.body.planId);
            if (!data) return res.status(400).json({ error: 'No availability tracker is active for this faction right now — ask a leader to start one.' });
            const entry = data.entries[playerId] || (data.entries[playerId] = { name: playerName, slots: {} });
            entry.name = playerName;
            const slotKey = `${day}-${hour}`;
            if (slotBeforeStart(data, slotKey)) return res.status(400).json({ error: 'That hour is before the start — you can only tick hours from the start on.' });
            entry.watch = entry.watch || {};
            if (watch) {
                if (entry.watch[slotKey]) return res.status(200).json({ ok: true });
                const roleName = data.war?.id ? 'War guard' : 'Chain saver';
                if (watchOrder(data, slotKey).length >= WATCH_MAX) return res.status(409).json({ error: `That hour already has a ${roleName} and a backup — pick another hour.` });
                entry.watch[slotKey] = Date.now(); if (!entry.slots[slotKey]) entry.slots[slotKey] = true;
            } else delete entry.watch[slotKey];
            await redis(['SET', availabilityKey(factionId, planId), JSON.stringify(data)]);
            return res.status(200).json({ ok: true });
        }

        // "I can't make this war" — real life happens, and there's a forum post for it too; this
        // puts the same thing in the tool so leaders see it next to the availability numbers.
        // Any member can set/undo their own. Cleared automatically when a new tracker starts.
        if (action === 'availability-unavailable') {
            const { unavailable: flag, note } = req.body;
            const { id: planId, data } = await resolvePlan(factionId, req.body.planId);
            if (!data) return res.status(400).json({ error: 'No availability tracker is active for this faction right now — ask a leader to start one.' });
            data.unavailable = data.unavailable || {};
            if (flag) data.unavailable[playerId] = { name: playerName, note: String(note || '').slice(0, 140), at: Date.now() };
            else delete data.unavailable[playerId];
            await redis(['SET', availabilityKey(factionId, planId), JSON.stringify(data)]);
            return res.status(200).json({ ok: true });
        }

        // My standing (dashboard card) — open to every member; only ever describes the caller. See lib/memberOverview.js.
        if (action === 'mo-me') return res.status(200).json(await moMe({ redis, key, factionId, playerId, daysInFaction }));
        // Competition page — the full standings, open to every member (built from stored data only).
        if (action === 'mo-standings') return res.status(200).json(await moStandings({ redis, factionId }));
        // OC requests — a member who sees no OC that suits them asks for one at a level, instead of everyone spawning crimes.
        // The request lands in the leaders' To do list and, if a Discord channel is set for it, is posted there once. One open
        // request per member (a new one replaces the old). Members only ever see their own; leaders list and close them below.
        if (action === 'ocreq-my') {
            const raw = await redis(['HGET', ocRequestsKey(factionId), playerId]);
            return res.status(200).json({ request: raw ? JSON.parse(raw) : null });
        }
        if (action === 'ocreq-submit') {
            const level = Math.round(Number(req.body.level));
            if (!(level >= 1 && level <= 10)) return res.status(400).json({ error: 'Pick a level from 1 to 10.' });
            const note = String(req.body.note || '').trim().slice(0, 140);
            const oldRaw = await redis(['HGET', ocRequestsKey(factionId), playerId]);
            const old = oldRaw ? JSON.parse(oldRaw) : null;
            const request = { id: playerId, name: playerName, level, note, at: Date.now(), pinged: old?.pinged || 0, pingedLevel: old?.pingedLevel || 0 };
            // Discord: once per member per level per 6 hours, so re-saving or flipping levels cannot spam the channel
            if (!(request.pingedLevel === level && Date.now() - request.pinged < 6 * 3600000)) {
                try {
                    const poster = await getDiscordPoster(factionId, 'oc');
                    if (poster && !poster.error) {
                        await poster.post(`🧩 **${playerName}** would like to join a **level ${level}** Organized Crime and cannot find one that suits them.${note ? `\n> ${note}` : ''}\nCan someone spawn one?`, []);
                        request.pinged = Date.now(); request.pingedLevel = level;
                    }
                } catch (e) { /* the request is saved either way; it still shows in the leaders' To do */ }
            }
            await redis(['HSET', ocRequestsKey(factionId), playerId, JSON.stringify(request)]);
            return res.status(200).json({ ok: true, request });
        }
        if (action === 'ocreq-cancel') {
            await redis(['HDEL', ocRequestsKey(factionId), playerId]);
            return res.status(200).json({ ok: true });
        }

        // Bank requests — a member asks for money out of their OWN faction balance; a banker claims it from Discord (or the page)
        // and lands in Torn's vault screen with the member and amount already filled in. The amount can never be more than the
        // member's own balance, which is read with the leader key kept for nightly saving (a member key cannot see balances).
        // Nothing is paid by WWL: the banker still confirms the payout in Torn, and a claim is exclusive (SET NX).
        if (action === 'bank-info') {
            const [raw, open] = await Promise.all([bankBalanceOf(factionId, playerId, { ownKey: key }), bankOpenOf(factionId, playerId)]);
            return res.status(200).json({ balance: raw.balance, balanceError: raw.error || null, request: open });
        }
        if (action === 'bank-submit') {
            const amount = Math.floor(Number(String(req.body.amount || '').replace(/[,\s$]/g, '')));
            if (!(amount >= 1)) return res.status(400).json({ error: 'Enter an amount of at least 1.' });
            const bal = await bankBalanceOf(factionId, playerId, { ownKey: key });
            if (bal.balance === null) return res.status(400).json({ error: bal.error || 'Could not read your balance right now.' });
            if (amount > bal.balance) return res.status(400).json({ error: `You can only ask for up to your own balance ($${bal.balance.toLocaleString('en-US')}).` });
            const old = await bankOpenOf(factionId, playerId);
            if (old) await redis(['HDEL', bankRequestsKey(factionId), old.id]); // one open request per member: a new one replaces it
            const id = require('crypto').randomBytes(5).toString('hex');
            const request = { id, playerId, name: playerName, amount, balance: bal.balance, at: Date.now(), status: 'open', posted: false };
            const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').replace(/[^\w.:-]/g, '');
            try {
                const poster = await getDiscordPoster(factionId, 'bank');
                if (poster && !poster.error) {
                    const claimUrl = `https://${host}/bank-go?id=${id}`, cancelUrl = `https://${host}/bank-claim?id=${id}&cancel=1`;
                    const embeds = [bankEmbed(request, 'open')]; // who, the amount, when — never the member's balance
                    // Claim / Cancel as link buttons (they open WWL, which needs the banker's own login); if this Discord setup
                    // cannot show buttons, the same two links are sent as plain text instead
                    const buttons = [{ type: 1, components: [{ type: 2, style: 5, label: 'Claim', url: claimUrl }, { type: 2, style: 5, label: 'Cancel', url: cancelUrl }] }];
                    let r = await poster.post('', [], embeds, buttons, true);
                    if (!r.ok) r = await poster.post(`Claim: ${claimUrl}
Cancel: ${cancelUrl}`, [], embeds, undefined, true);
                    request.posted = r.ok;
                    // remember the Discord message so it can be edited when the request is claimed or cancelled (buttons disabled,
                    // "Claimed by ..." added) — that is what stops a second banker from also paying it out
                    if (r.ok) { try { request.msgId = (await r.json())?.id || null; } catch (e) { /* no id: the message just stays as posted */ } request.claimUrl = claimUrl; }
                }
            } catch (e) { /* the request still shows on the Bank request page */ }
            await redis(['HSET', bankRequestsKey(factionId), id, JSON.stringify(request)]);
            return res.status(200).json({ ok: true, request });
        }
        if (action === 'bank-cancel') {
            const id = String(req.body.id || '').replace(/[^0-9a-f]/g, '');
            const raw = id && await redis(['HGET', bankRequestsKey(factionId), id]);
            if (!raw) return res.status(404).json({ error: 'That request no longer exists.' });
            const r = JSON.parse(raw);
            if (r.playerId !== playerId && !(await isLeader(key))) return res.status(403).json({ error: 'Only the person who asked, or a banker, can cancel it.' });
            if (r.status === 'claimed') return res.status(400).json({ error: `Already claimed by ${r.claimedBy}.` });
            await redis(['HDEL', bankRequestsKey(factionId), id]);
            await bankMarkDiscord(factionId, r, 'cancelled', playerName);
            return res.status(200).json({ ok: true, name: r.name });
        }


        // Gym stats page (history graph + goals) — open to every member, only ever about the caller. See lib/gymStats.js.
        if (action.startsWith('gym-')) return res.status(200).json(await gymHandle(action, req.body, { redis, key, playerId }));
        // War reports page — every saved payout report with result and pay details (all lines for leaders, own line for members).
        if (action === 'receipts-report') return res.status(200).json(await warReports({ redis, key, factionId, playerId, leader: await isLeader(key) }));
        // Bug reports page — posts a member's report (and screenshot) to a Discord channel. See lib/bugReport.js.
        if (action === 'bug-report') return res.status(200).json(await sendBugReport({ redis, playerId, name: playerName, factionName, body: req.body }));
        // Energy tracker page — energy trained per member per day (like Torn Intel's leaderboard), open to every member.
        if (action === 'energy-board') {
            const today = Math.floor(Date.now() / 1000 / 86400);
            const isoDay = s => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? Math.floor(Date.parse(`${s}T00:00:00Z`) / 1000 / 86400) : null);
            let fromDay = isoDay(req.body.from), toDay = isoDay(req.body.to);
            if (fromDay === null || toDay === null || toDay < fromDay) { // no calendar range picked: the last N days
                const n = Math.min(120, Math.max(7, Number(req.body.days) || 30));
                fromDay = today - n + 1; toDay = today;
            }
            toDay = Math.min(toDay, today); fromDay = Math.max(fromDay, toDay - 365); // at most a year at once
            const days = toDay - fromDay + 1;
            const r = await energyDaily(redis, factionId, fromDay, toDay);
            const rosterRaw = await redis(['GET', `wwl:mo-roster:${factionId}`]); // names a leader's page saved, for members without one yet
            for (const m of (rosterRaw ? JSON.parse(rosterRaw) : [])) if (r.members[m.id] && !r.members[m.id].name) r.members[m.id].name = m.name;
            // Each member's own Energy tier + weekly minimum — the exact same source Member Overview's own
            // "Energy tier" column uses (lib/memberOverview.js): a leader's manual override (wwl:mo-tiers),
            // else auto-detected the moment that member has opened their own dashboard or the userscript once
            // (wwl:mo-battle — Torn only ever shows a player their OWN battle stats, never a faction-wide
            // list, so this is genuinely the only way to know it). Two HGETALLs cover the whole faction, not
            // one Redis call per member. Falls back to a saved Energy planner plan (lib/planSync.js) only for
            // the rare member who's used the planner but never opened the dashboard, so nothing already known
            // is lost.
            const ids = Object.keys(r.members);
            if (ids.length) {
                const toMap = flat => { const o = {}; for (let i = 0; i < (flat || []).length; i += 2) o[flat[i]] = flat[i + 1]; return o; };
                const [tiersRaw, battleRaw] = await Promise.all([
                    redis(['HGETALL', `wwl:mo-tiers:${factionId}`]),
                    redis(['HGETALL', `wwl:mo-battle:${factionId}`]),
                ]);
                const tiersMap = toMap(tiersRaw), battleMap = toMap(battleRaw);
                const ENERGY_TARGET = { high: 4400, low: 2200 }, TIER_LIMIT = 1500000;
                for (const id of ids) {
                    let tier = tiersMap[id] === 'high' || tiersMap[id] === 'low' ? tiersMap[id] : null;
                    if (!tier && battleMap[id]) { try { tier = JSON.parse(battleMap[id]).total >= TIER_LIMIT ? 'high' : 'low'; } catch (e) { /* skip a bad record */ } }
                    if (tier) { r.members[id].tier = tier; r.members[id].weekly = ENERGY_TARGET[tier]; }
                }
                const stillUnknown = ids.filter(id => !r.members[id].weekly);
                if (stillUnknown.length) {
                    const plansRaw = await redis(['MGET', ...stillUnknown.map(id => `wwl:gym-plan:${id}`)]);
                    stillUnknown.forEach((id, i) => {
                        if (!plansRaw[i]) return;
                        try { const w = JSON.parse(plansRaw[i]).weekly; if (Number.isFinite(w) && w > 0) r.members[id].weekly = w; } catch (e) { /* skip a bad record */ }
                    });
                }
            }
            return res.status(200).json({ ...r, days, today, fromDay, toDay, me: playerId });
        }
        // Steadfast countdown — everyone can read the stored numbers; refreshing, the share link and the goals are for leaders.
        if (action.startsWith('steadfast-')) return res.status(200).json(await steadfastHandle(action, req.body, { redis, key, factionId, leader: action === 'steadfast-get' ? false : await isLeader(key) }));
        // Nightly saving switched on by a leader from the app (their key is kept encrypted for the cron job). See lib/nightly.js.
        if (action.startsWith('nightly-')) {
            if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });
            return res.status(200).json(await nightlyHandle(action, { redis, key, factionId, playerId, name: playerName }));
        }
        // Target pages: shared, briefly remembered target statuses, and each member's own target list. See lib/targets.js.
        if (action === 'target-status' || action.startsWith('mytargets-')) return res.status(200).json(await targetsHandle(action, req.body, { redis, key, playerId }));
        // How many calls WWL made to Torn with the caller's own key (see lib/tornFetch.js) — shown in Member Overview → Checks for the developer.
        if (action === 'torn-usage') return res.status(200).json(await usageFor(key));

        // Manual verification for tools WWL can't check by itself (Torn Intel, CAT — no API to ask them whether a
        // member has joined/verified there, unlike Discord). A leader ticks it by hand on the Who's on board list;
        // 'verify-mine' just lets the Tools & Links page show the caller their own two badges.
        if (action === 'verify-mine') {
            const raw = await redis(['HGET', manualVerifyKey(factionId), playerId]);
            const v = raw ? JSON.parse(raw) : {};
            return res.status(200).json({ intel: !!v.intel, cat: !!v.cat, discordExempt: !!v.discordExempt });
        }
        // The userscript stamping "I'm here" — called from Torn itself, at most about once an hour
        // per browser (throttled client-side), so this is a real signal of actual use, not just of
        // having installed it once and never opening it again. Nothing sensitive, just a timestamp
        // keyed by the caller's own verified playerId. Has to live ABOVE the leader-only gate below:
        // it used to sit under it, so every non-leader's check-in was rejected with a 403 (which the
        // script swallows silently) and only leaders ever showed up in the Userscript column.
        // The caller's own userscript status for the dashboard's install/update card: when their script last checked in,
        // which version it reported, and the newest version — two small reads, only about the caller.
        if (action === 'script-status') {
            const [seen, info] = await Promise.all([redis(['HGET', userscriptSeenKey(factionId), playerId]), redis(['HGET', userscriptInfoKey(factionId), playerId])]);
            const [v, p] = info ? String(info).split('|') : [null, null];
            let latest = null;
            try { latest = (/@version\s+([\d.]+)/.exec(require('fs').readFileSync(require('path').join(process.cwd(), 'userscripts', 'energy-plan.user.js'), 'utf8')) || [])[1] || null; } catch (e) { /* no comparison */ }
            return res.status(200).json({ seen: Number(seen) || 0, version: v, pda: p === 'pda', latest });
        }
        if (action === 'script-checkin') {
            await redis(['HSET', userscriptSeenKey(factionId), playerId, String(Date.now())]);
            const ver = String(req.body.v || '').replace(/[^0-9.]/g, '').slice(0, 12);
            if (ver) await redis(['HSET', userscriptInfoKey(factionId), playerId, `${ver}|${req.body.pda ? 'pda' : 'pc'}`]);
            return res.status(200).json({ ok: true });
        }
        // Banners at the top of every page. Everyone reads the ones meant for them; leaders write them for THEIR OWN faction, and only an owner
        // (the same owners as Labs funds) can also write one for ALL factions (stored apart, under 'global').
        if (action === 'banners-get') {
            const [facList, globList, leader, owner] = await Promise.all([loadBanners(factionId), loadBanners('global'), isLeader(key), labsIsOwner(redis, playerId)]);
            if (req.body.manage) {
                if (!leader) return res.status(403).json({ error: 'Leaders only' });
                return res.status(200).json({ banners: [...facList.map(b => ({ ...b, scope: 'faction' })), ...globList.map(b => ({ ...b, scope: 'all' }))], leader, owner });
            }
            const mine = [...globList, ...facList].filter(b => bannerLive(b) && (b.audience !== 'leaders' || leader));
            return res.status(200).json({ banners: mine, leader, owner });
        }
        if (action === 'banners-save') {
            if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });
            const b = req.body;
            const toAll = b.scope === 'all';
            if (toAll && !(await labsIsOwner(redis, playerId))) return res.status(403).json({ error: 'Only an owner can show a banner to all factions.' });
            const text = String(b.text || '').trim().slice(0, 280);
            if (text.length < 3) return res.status(400).json({ error: 'Write the message for the banner first.' });
            const page = /^[a-z0-9-]{1,40}$/.test(String(b.page || '')) ? String(b.page) : '';
            const target = toAll ? 'global' : factionId;
            const list = await loadBanners(target);
            if (list.length >= 6) return res.status(400).json({ error: `You already have 6 banners${toAll ? ' for all factions' : ''} — delete an old one first.` });
            list.push({ id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, text, page,
                linkLabel: page ? String(b.linkLabel || '').trim().slice(0, 30) || 'Open' : '',
                icon: String(b.icon || '').trim().slice(0, 4), countdownAt: Number(b.countdownAt) > 1e9 && Number(b.countdownAt) < 4e9 ? Math.floor(Number(b.countdownAt)) : 0,
                audience: b.audience === 'leaders' ? 'leaders' : 'all', tone: ['event', 'warn'].includes(b.tone) ? b.tone : 'info',
                expires: /^\d{4}-\d{2}-\d{2}$/.test(String(b.expires || '')) ? String(b.expires) : '', createdAt: Date.now() });
            await redis(['SET', bannersKey(target), JSON.stringify(list)]);
            return res.status(200).json({ ok: true });
        }
        if (action === 'banners-delete') {
            if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });
            const id = String(req.body.id);
            const facList = await loadBanners(factionId);
            if (facList.some(x => x.id === id)) await redis(['SET', bannersKey(factionId), JSON.stringify(facList.filter(x => x.id !== id))]);
            else {
                if (!(await labsIsOwner(redis, playerId))) return res.status(403).json({ error: 'Only an owner can delete a banner for all factions.' });
                await redis(['SET', bannersKey('global'), JSON.stringify((await loadBanners('global')).filter(x => x.id !== id))]);
            }
            return res.status(200).json({ ok: true });
        }
        // The leader to-do card (dashboard) — leaders only.
        if (action === 'leader-todos') {
            if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });
            return res.status(200).json(await leaderTodos(key, factionId));
        }
        // The weekly energy plan, shared between the Energy planner page and the userscript in Torn.
        if (action === 'plan-get') {
            // Only the userscript calls this, and every version of it does — including the ones from before
            // 'script-checkin' existed — so it also counts as a sign of life for Who's on board's Userscript column
            // (at most one write an hour per member).
            try {
                const seen = Number(await redis(['HGET', userscriptSeenKey(factionId), playerId])) || 0;
                if (Date.now() - seen > 3600000) await redis(['HSET', userscriptSeenKey(factionId), playerId, String(Date.now())]);
            } catch (e) { /* the plan still loads */ }
        }
        if (action.startsWith('plan-')) return res.status(200).json(await planHandle(action, req.body, { redis, playerId }));
        // Timezone map — every member reports their own timezone; everyone reads anonymous counts.
        if (action.startsWith('tz-')) return res.status(200).json(await tzHandle(action, req.body, { redis, factionId, playerId }));

        // The userscript's own "To do" tab — small personal reminders for the calling member, not
        // faction-wide like leader-todos above. Each check is independent and best-effort: one
        // failing (e.g. Torn hiccups on the profile call) must not hide the others.
        //   - Revive setting: confirmed live against a real key across all three settings —
        //     `revivable` is true for both "Everyone" and "Friends and faction", false only for
        //     "No one". So it can't tell Everyone and Friends-and-faction apart, but it doesn't need
        //     to: either way someone other than "no one" can revive you, which is the thing worth
        //     flagging either way.
        //   - Feedback / timezone: exact same data the Feedback and Timezone map pages already use
        //     (see api/feedback-form.js's 'read' action and lib/tzMap.js's 'tz-get'), just read
        //     directly here instead of a second round trip.
        //   - Availability: same "live" + "soon" plan and respondedMap() the leader to-do card
        //     (leaderTodos above) uses to find who's missing, just checked against one player's own id.
        //   - Discord / Intel / CAT: Intel and CAT have no API of their own, so this reads the same
        //     manual-verify record a leader ticks by hand on "Who's on board" (manualVerifyKey);
        //     Discord is the real discordStatus() check, skipped entirely for anyone a leader has
        //     marked discordExempt (e.g. a member in a country where Discord is banned).
        if (action === 'member-todo') {
            const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').replace(/[^\w.:-]/g, '');
            const site = host ? `https://${host}` : '';
            const items = [];

            try {
                // lib/tornFetch.js caches any /user/?selections=profile& call for 10 minutes — great for the
                // routine "who is this key" identity lookups every action does, but wrong here: this needs
                // THIS member's actual current setting, not whatever it was up to 10 minutes ago. So this
                // skips tornFetch and its cache entirely with a plain fetch (which also avoids the ~6 Redis
                // commands tornFetch spends per call on cache lookup, usage counters and a cache write —
                // real cost against the database's monthly request quota). Not counted in the Torn usage panel.
                // organizedcrimes is bundled into the same call (below) rather than a second one — it's this
                // member's own key, so no faction-level API access is needed to see their own OC membership.
                const r = await fetch(`https://api.torn.com/v2/user/?selections=profile,organizedcrime&key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } });
                const d = await r.json();
                // v2's response nests everything under "profile" (confirmed against a real reference
                // userscript's own code, `data.profile.revivable`) — reading `d.revivable` directly
                // was always undefined regardless of the real setting.
                if (!d.error && d.profile?.revivable) {
                    items.push({ id: 'revive', text: "You have your revives on, set them to \"no one\".", cta: 'Open Preferences', url: 'https://www.torn.com/preferences.php#tab=privacy' });
                }
                // Torn's v2 "organizedcrime" (singular) is "your current ongoing organized crime" — null when you are not in one.
                // (The plural "organizedcrimes" this used to read is something else entirely: the open slots of crimes that are
                // still recruiting, which has nothing to do with whether THIS member is in one — that is why the reminder never
                // showed.) The selection is valid, so a profile that came back with no organized-crime field means null: not in one.
                if (!d.error && d.profile) {
                    const known = ['organizedCrime', 'organizedcrime', 'organized_crime'].find(k => k in d);
                    {
                        const oc = known ? d[known] : null;
                        const inOC = Array.isArray(oc) ? oc.length > 0 : !!(oc && typeof oc === 'object' && Object.keys(oc).length > 0);
                        if (!inOC) { const reqRaw = await redis(['HGET', ocRequestsKey(factionId), playerId]); items.push({ id: 'oc', text: "You're not in an Organized Crime right now. Nothing that suits you? Ask for one on WWL (Crimes, OC requests).", cta: 'Join an OC', url: 'https://www.torn.com/factions.php?step=your#/tab=crimes', request: reqRaw ? JSON.parse(reqRaw) : null }); } // request: the member's open OC request, if any, so the script can show it
                    }
                }
            } catch (e) { /* skip this check on failure, don't fail the others */ }

            try {
                // Shows as soon as there is a live plan you haven't responded to yet — even a war that hasn't
                // been matched yet, so a plan made well ahead of time (a placeholder start date) still reminds
                // people early rather than waiting until 4 days out (that "soon" gate used to hide it entirely).
                const plans = (await loadPlanIndex(factionId)).filter(p => !p.archived);
                const today = new Date().toISOString().slice(0, 10);
                const endOf = p => { const d = new Date(`${p.startDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + p.days); return d.toISOString().slice(0, 10); };
                const live = plans.filter(p => endOf(p) >= today).sort((a, b) => a.startDate.localeCompare(b.startDate));
                if (live.length) {
                    const p = live[0];
                    const raw = await redis(['GET', availabilityKey(factionId, p.id)]);
                    const data = raw ? JSON.parse(raw) : null;
                    if (data && !respondedMap(data)[playerId]) {
                        items.push({ id: 'availability', text: `Fill in your availability for ${p.name ? `"${p.name}"` : 'the upcoming war/weekend'}.`, cta: 'Open Availability', url: site ? `${site}/availability` : null });
                    }
                }
            } catch (e) { /* skip */ }

            try {
                const formRaw = await redis(['GET', `wwl:feedback-form:${factionId}`]);
                const form = formRaw ? JSON.parse(formRaw) : null;
                if (form?.mode === 'native') {
                    const mineRaw = await redis(['HGET', `wwl:feedback-responses:${factionId}`, playerId]);
                    if (!mineRaw) items.push({ id: 'feedback', text: `Fill in the "${form.title || 'Feedback'}" form.`, cta: 'Open Feedback', url: site ? `${site}/feedback` : null });
                }
            } catch (e) { /* skip */ }

            try {
                const tz = await tzHandle('tz-get', {}, { redis, factionId, playerId });
                if (!tz.me) items.push({ id: 'timezone', text: 'Pick your country on the Timezone map.', cta: 'Open Timezone map', url: site ? `${site}/tz-map` : null });
            } catch (e) { /* skip */ }

            // Discord / Torn Intel / CAT: same manual-verify record "Who's on board" already ticks by
            // hand (Torn Intel and CAT have no API to check automatically). URLs match core.js's own
            // REQUIRED_LINKS, shown on the Tools & Links page.
            try {
                const raw = await redis(['HGET', manualVerifyKey(factionId), playerId]);
                const v = raw ? JSON.parse(raw) : {};
                if (!v.intel) items.push({ id: 'intel', text: 'Join Torn Intel and ask a leader to verify you on "Who\'s on board".', cta: 'Open Torn Intel', url: 'https://torn-intel.com/' });
                if (!v.cat) items.push({ id: 'cat', text: 'Install the CAT script and ask a leader to verify you on "Who\'s on board".', cta: 'Open CAT', url: 'https://cat-script.com/' });
                if (!v.discordExempt) {
                    let guildMap = null;
                    if (isSharedServerFaction(factionId)) { try { guildMap = await tornToDiscordIds(); } catch (e) { /* fall back to the per-user Torn lookup below */ } }
                    const { status } = await discordStatus([playerId], { key, redis, guildMap, resolve: true, limit: 1 });
                    if (status[playerId] !== 'yes') items.push({ id: 'discord', text: 'Join the faction Discord and link it to your Torn account.', cta: 'Open Discord', url: 'https://discord.gg/HFmPUd2zyh' });
                }
            } catch (e) { /* skip */ }

            // For leaders and council only: the open requests (OC and bank), so they show in the script's To do too. Worked out
            // here on the server and only displayed by the script — no script update needed. The leader check is the usual
            // cached one, so members cost almost nothing extra.
            try {
                if (await isLeader(key)) {
                    const flat = async k => { const f = (await redis(['HGETALL', k])) || []; const out = []; for (let i = 0; i < f.length; i += 2) { try { out.push(JSON.parse(f[i + 1])); } catch (e) { /* skip */ } } return out; };
                    const [ocs, banks] = await Promise.all([flat(ocRequestsKey(factionId)), flat(bankRequestsKey(factionId))]);
                    if (ocs.length) items.push({ id: 'oc-requests', text: `${ocs.length} OC request${ocs.length === 1 ? '' : 's'}: ${ocs.slice(0, 4).map(r => `${r.name} (level ${r.level})`).join(', ')}${ocs.length > 4 ? ` +${ocs.length - 4} more` : ''}.`, cta: 'See requests', url: `${site}/oc-requests` });
                    const openBanks = banks.filter(r => r.status === 'open');
                    if (openBanks.length) items.push({ id: 'bank-requests', text: `${openBanks.length} bank request${openBanks.length === 1 ? '' : 's'}: ${openBanks.slice(0, 4).map(r => `${r.name} ($${Number(r.amount).toLocaleString('en-US')})`).join(', ')}${openBanks.length > 4 ? ` +${openBanks.length - 4} more` : ''}.`, cta: 'Open bank requests', url: `${site}/bank` });
                }
            } catch (e) { /* skip */ }

            return res.status(200).json({ items });
        }
        // Suggestions — everyone can read, add and vote; only leaders set a status or delete.
        if (action.startsWith('sug-')) {
            const leader = ['sug-list', 'sug-status', 'sug-delete'].includes(action) ? await isLeader(key) : false;
            if (['sug-status', 'sug-delete'].includes(action) && !leader) return res.status(403).json({ error: 'Leaders only' });
            return res.status(200).json(await suggestHandle(action, req.body, { redis, playerId, name: playerName, isLeader: leader }));
        }
        // Mentoring Platform — everyone reads their own status/checklist/chat; only leaders run the program itself,
        // and a leader can look in on any pair for oversight. See lib/mentoring.js. `leaderLazy` only actually
        // calls Torn the moment (and if) mentoringHandle needs to know — an ordinary mentor/pupil already found to
        // belong to their own pair never triggers it, so polling a chat doesn't cost an extra call every time.
        if (action.startsWith('mentor-') || action.startsWith('pupil-')) {
            let leaderCache = null;
            const leaderLazy = async () => { if (leaderCache === null) leaderCache = await isLeader(key); return leaderCache; };
            return res.status(200).json(await mentoringHandle(action, req.body, { redis, playerId, name: playerName, leaderLazy, factionId }));
        }
        // Known bugs list — anyone can read it and press "I have this too"; only leaders change the list.
        if (action.startsWith('bugs-')) {
            if (!['bugs-list', 'bugs-metoo', 'bugs-shot'].includes(action) && !(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });
            return res.status(200).json(await bugsHandle(action, req.body, { redis, playerId, leader: action === 'bugs-list' ? await isLeader(key) : false }));
        }

        // ---- Labs funds ------------------------------------------------------------------------
        // Every faction's war-pay history and the retained cut ("the 20%") each one keeps. Any
        // faction leader can VIEW it; only an owner can change it. Owners are kept in the database
        // (first leader to press "Claim ownership" becomes the owner, and can add more owners) —
        // WWL_OWNER_IDS in Vercel still works as an extra, optional way to name them.
        // Logic lives in lib/labsLedger.js; this is just the routing.
        if (action.startsWith('labs-')) {
            const owner = await labsIsOwner(redis, playerId);
            if (action === 'labs-status') {
                const leader = owner || isLeaderRank(profile); // Leader/Co-leader only, not Council — see AUDIT.md
                return res.status(200).json({ owner, leader, claimable: leader && !owner && !(await labsHasOwners(redis)) });
            }
            const readOnly = action === 'labs-get';
            if (action === 'labs-claim') {
                if (!isLeaderRank(profile)) return res.status(403).json({ error: 'Leaders and Co-leaders only' });
            } else if (readOnly) {
                if (!owner && !isLeaderRank(profile)) return res.status(403).json({ error: 'Leaders and Co-leaders only' });
            } else if (!owner) {
                return res.status(403).json({ error: 'Owner only' });
            }
            return res.status(200).json(await labsHandle(action, req.body, { redis, key, playerId, playerName }));
        }

        if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });

        // Member Overview (who follows the rules / needs a push) — logic in lib/memberOverview.js.
        if (action.startsWith('mo-')) return res.status(200).json(await moHandle(action, req.body, { redis, key, factionId }));
        if (action.startsWith('ev-')) return res.status(200).json(await evHandle(action, req.body, { redis, factionId }));
        // OC requests, the leaders' side: the open requests (oldest first) and closing one — spawned, or dismissed.
        if (action === 'ocreq-list') {
            const flat = (await redis(['HGETALL', ocRequestsKey(factionId)])) || [];
            const list = [];
            for (let i = 0; i < flat.length; i += 2) { try { list.push(JSON.parse(flat[i + 1])); } catch (e) { /* skip a broken entry */ } }
            return res.status(200).json({ requests: list.sort((a, b) => a.at - b.at) });
        }
        if (action === 'ocreq-done') {
            const id = String(req.body.id || '').replace(/\D/g, '');
            if (!id) return res.status(400).json({ error: 'Missing member' });
            await redis(['HDEL', ocRequestsKey(factionId), id]);
            return res.status(200).json({ ok: true });
        }
        // Hands a banker (anyone with faction API access) the signed cookie that lets the Discord Claim button redirect straight to Torn.
        if (action === 'bank-token') {
            res.setHeader('Set-Cookie', `wwl_banker=${bankCookieValue(playerId, playerName, factionId)}; Path=/; Max-Age=${30 * 86400}; HttpOnly; Secure; SameSite=Lax`);
            return res.status(200).json({ ok: true });
        }
        // Bank requests, the bankers' side: claim one (exclusive — whoever gets it first), and list the open ones.
        if (action === 'bank-claim') {
            const id = String(req.body.id || '').replace(/[^0-9a-f]/g, '');
            const raw = id && await redis(['HGET', bankRequestsKey(factionId), id]);
            if (!raw) return res.status(404).json({ error: 'That request was cancelled or no longer exists.' });
            const r = JSON.parse(raw);
            // The balance may have changed since the request: re-read it NOW and never send a banker to a payout larger than what
            // the member has — the amount is lowered to the balance and the banker is told.
            const live = await bankBalanceOf(factionId, r.playerId, { leaderKey: key });
            let pay = r.amount, lowered = false;
            if (live.balance !== null && live.balance < r.amount) { pay = live.balance; lowered = true; }
            if (pay < 1) return res.status(400).json({ error: `${r.name}'s balance is now $0, so there is nothing to pay out.` });
            const link = `https://www.torn.com/factions.php?step=your#/tab=controls&giveMoneyTo=${encodeURIComponent(r.playerId)}&money=${encodeURIComponent(pay)}`;
            // SET NX: only one banker can claim; the same banker opening it again just gets the link again
            const got = await redis(['SET', `wwl:bank-claim:${factionId}:${id}`, playerId, 'NX', 'EX', String(7 * 86400)]);
            if (!got) {
                const by = await redis(['GET', `wwl:bank-claim:${factionId}:${id}`]);
                if (by !== playerId) return res.status(409).json({ error: `Already claimed by ${r.claimedBy || 'another banker'}.`, claimedBy: r.claimedBy || null });
            } else {
                r.status = 'claimed'; r.claimedBy = playerName; r.claimedAt = Date.now();
                await redis(['HSET', bankRequestsKey(factionId), id, JSON.stringify(r)]);
                await bankMarkDiscord(factionId, r, 'claimed', playerName);
            }
            return res.status(200).json({ ok: true, link, request: r, pay, lowered, liveBalance: live.balance });
        }
        if (action === 'bank-list') {
            const flat = (await redis(['HGETALL', bankRequestsKey(factionId)])) || [];
            const list = [];
            for (let i = 0; i < flat.length; i += 2) { try { list.push(JSON.parse(flat[i + 1])); } catch (e) { /* skip */ } }
            // claimed ones stay visible for a day (so two bankers do not both pay), then drop out
            return res.status(200).json({ requests: list.filter(r => r.status === 'open' || Date.now() - (r.claimedAt || 0) < 86400000).sort((a, b) => a.at - b.at) });
        }

        // The leader's side of manual verification (see 'verify-mine' above): the whole faction's Intel/CAT
        // status, and ticking one member's for either tool.
        if (action === 'verify-get') {
            const flat = (await redis(['HGETALL', manualVerifyKey(factionId)])) || [];
            const map = {};
            for (let i = 0; i < flat.length; i += 2) { try { map[flat[i]] = JSON.parse(flat[i + 1]); } catch (e) { /* skip */ } }
            return res.status(200).json({ map });
        }
        if (action === 'verify-set') {
            const { id, tool, value } = req.body;
            // 'discordExempt' is not a tool a member joins — it's a leader marking someone (e.g. in a
            // country where Discord is banned) as not expected to link it, so the to-do list stops nagging them.
            if (!/^\d+$/.test(String(id)) || !['intel', 'cat', 'discordExempt'].includes(tool)) return res.status(400).json({ error: 'Bad request' });
            const raw = await redis(['HGET', manualVerifyKey(factionId), String(id)]);
            const v = raw ? JSON.parse(raw) : {};
            v[tool] = !!value; v.updatedAt = Date.now();
            await redis(['HSET', manualVerifyKey(factionId), String(id), JSON.stringify(v)]);
            return res.status(200).json({ ok: true });
        }
        // Who's on board's "Userscript" column: the whole faction's last-seen timestamps. (The check-in
        // that fills this in is 'script-checkin', up above the leader-only gate — every member calls it.)
        if (action === 'userscript-get') {
            const flat = (await redis(['HGETALL', userscriptSeenKey(factionId)])) || [];
            const map = {};
            for (let i = 0; i < flat.length; i += 2) map[flat[i]] = Number(flat[i + 1]) || 0;
            // version + platform each script reported (only scripts new enough to send it), and the newest version, so
            // Who's on board can tell "installed but an old version" from "not installed at all"
            const infoFlat = (await redis(['HGETALL', userscriptInfoKey(factionId)])) || [];
            const info = {};
            for (let i = 0; i < infoFlat.length; i += 2) { const [v, p] = String(infoFlat[i + 1]).split('|'); info[infoFlat[i]] = { v, pda: p === 'pda' }; }
            let latest = null;
            try { latest = (/@version\s+([\d.]+)/.exec(require('fs').readFileSync(require('path').join(process.cwd(), 'userscripts', 'energy-plan.user.js'), 'utf8')) || [])[1] || null; } catch (e) { /* no comparison shown */ }
            return res.status(200).json({ map, info, latest });
        }

        // This faction's own Discord destination(s) (see getDiscordPoster). Leader-only. The webhook
        // URL is a secret — it's never sent back, only a hint of which webhook is saved. `kind` picks
        // which named destination to read/write ('default', 'feedback', 'whatsnew'); omitted = 'default'.
        if (action === 'discord-settings-get') {
            const kind = DISCORD_KINDS.includes(req.body.kind) ? req.body.kind : 'default';
            const raw = await redis(['GET', discordSettingsKey(factionId)]);
            const all = raw ? JSON.parse(raw) : {};
            const legacy = (all.webhookUrl || all.channelId) ? { webhookUrl: all.webhookUrl, channelId: all.channelId } : null;
            const ownSetting = all.channels?.[kind] || (kind === 'default' ? legacy : null);
            const s = ownSetting || {};
            return res.status(200).json({
                factionId, kind,
                shared: isSharedServerFaction(factionId), // on the shared server -> the bot can post here
                channelId: s.channelId || '',
                webhookSet: !!s.webhookUrl,
                webhookHint: s.webhookUrl ? `webhook …${s.webhookUrl.match(/\/webhooks\/(\d+)\//)?.[1]?.slice(-6) || ''}` : '',
                usingDefault: kind !== 'default' && !ownSetting, // this kind has nothing of its own yet — falls back to 'default'
            });
        }

        if (action === 'discord-settings-set') {
            const kind = DISCORD_KINDS.includes(req.body.kind) ? req.body.kind : 'default';
            const raw = await redis(['GET', discordSettingsKey(factionId)]);
            const all = raw ? JSON.parse(raw) : {};
            if (!all.channels) all.channels = {};
            const s = { ...(all.channels[kind] || (kind === 'default' ? { webhookUrl: all.webhookUrl, channelId: all.channelId } : {})) };
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
            all.channels[kind] = s;
            // Once 'default' is saved under the new shape, drop the old flat fields so it's the one
            // source of truth from now on — getDiscordPoster's legacy fallback still covers anyone
            // who saved before named channels existed and hasn't touched settings since.
            if (kind === 'default') { delete all.webhookUrl; delete all.channelId; }
            await redis(['SET', discordSettingsKey(factionId), JSON.stringify(all)]);
            return res.status(200).json({ ok: true });
        }

        // Sends a harmless test message (mentions nobody) so a leader can confirm the destination
        // works before the first real ping.
        if (action === 'discord-settings-test') {
            const kind = DISCORD_KINDS.includes(req.body.kind) ? req.body.kind : 'default';
            const poster = await getDiscordPoster(factionId, kind);
            if (poster?.error) return res.status(400).json({ error: poster.error });
            if (!poster) return res.status(400).json({ error: 'Nothing saved yet — add a channel ID or webhook first.' });
            const what = kind === 'feedback' ? 'feedback reminders' : kind === 'whatsnew' ? 'What\'s new posts' : 'war availability pings';
            const r = await poster.post(`✅ WWLabs is connected — ${what} for your faction will post here.`, []);
            if (!r.ok) {
                const body = await r.text().catch(() => '');
                return res.status(502).json({ error: `Discord rejected the test (${r.status})${body ? `: ${body.slice(0, 120)}` : ''} — check the bot can see and post in that channel.` });
            }
            return res.status(200).json({ ok: true });
        }

        // Which members can be pinged on Discord (leaders): 'yes' / 'no' / 'unknown' per member id. Without `resolve` it only reads what is
        // already remembered (no Torn calls); with it, up to 25 unknown members are looked up per call.
        if (action === 'discord-status') {
            if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });
            const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : []).map(String).filter(s => /^\d+$/.test(s)))].slice(0, 150);
            let guildMap = null;
            if (isSharedServerFaction(factionId)) { try { guildMap = await tornToDiscordIds(); } catch (e) { /* the remembered links still work */ } }
            return res.status(200).json(await discordStatus(ids, { key, redis, guildMap, resolve: !!req.body.resolve }));
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
            const { data } = await resolvePlan(factionId, req.body.planId);
            if (!data) return res.status(400).json({ error: 'No availability tracker is active right now.' });

            let targets = [];
            if (kind === 'slot') {
                const slot = `${Number(day)}-${Number(hour)}`;
                for (const [id, entry] of Object.entries(data.entries || {})) {
                    if (data.unavailable?.[id]) continue; // said they can't make it — don't ping them
                    if (entry.slots?.[slot] === true) targets.push({ id, name: entry.name });
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
            // On the shared server the bot's own list decides (someone who is not in the server can't be reached anyway); only a faction on its own
            // Discord server falls back to the account linked on Torn.
            const idMap = guildMap ? Object.fromEntries(targets.filter(t => guildMap[t.id]).map(t => [t.id, guildMap[t.id]])) : await resolveDiscordIds(targets, { key, redis, guildMap });
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

        // Who hasn't answered the live feedback form yet — the same list feedback-ping (below) mentions,
        // shown as its own chip list on the feedback editor page (mirrors availability's "who's missing" view).
        if (action === 'feedback-missing') {
            const formRaw = await redis(['GET', `wwl:feedback-form:${factionId}`]);
            const form = formRaw ? JSON.parse(formRaw) : null;
            if (form?.mode !== 'native') return res.status(200).json({ missing: [], total: 0 });
            const respondedIds = new Set((await redis(['HKEYS', `wwl:feedback-responses:${factionId}`])) || []);
            const roster = await getRoster(key);
            const missing = roster.filter(m => !respondedIds.has(m.id));
            return res.status(200).json({ missing, total: roster.length });
        }

        // Posts an @mention reminder to Discord for every member who hasn't answered the feedback form
        // yet. Same target-resolution and chunking pattern as availability-ping just above, against the
        // feedback-responses hash instead of a plan's entries — and posted to this faction's 'feedback'
        // Discord destination (see discord-settings-*), so it can go to a different channel if wanted.
        if (action === 'feedback-ping') {
            const { message } = req.body;
            const formRaw = await redis(['GET', `wwl:feedback-form:${factionId}`]);
            const form = formRaw ? JSON.parse(formRaw) : null;
            if (form?.mode !== 'native') return res.status(400).json({ error: 'There is no feedback form open right now.' });

            const respondedIds = new Set((await redis(['HKEYS', `wwl:feedback-responses:${factionId}`])) || []);
            let targets;
            try { targets = (await getRoster(key)).filter(m => !respondedIds.has(m.id)); }
            catch (e) { return res.status(403).json({ error: `Couldn't read the member list: ${e.message}` }); }
            if (!targets.length) return res.status(400).json({ error: 'Everyone has already filled it in.' });

            const intro = String(message || '').slice(0, 400).trim();
            let guildMap = null, mapError = null;
            if (isSharedServerFaction(factionId)) {
                try { guildMap = await tornToDiscordIds(); } catch (e) { mapError = String(e.message || e); }
            }
            const idMap = guildMap ? Object.fromEntries(targets.filter(t => guildMap[t.id]).map(t => [t.id, guildMap[t.id]])) : await resolveDiscordIds(targets, { key, redis, guildMap });
            const mentions = [], noDiscord = [];
            for (const t of targets) {
                const did = idMap[t.id];
                if (did) mentions.push(`<@${did}>`); else noDiscord.push(t.name);
            }

            const text = [intro, mentions.join(' ')].filter(Boolean).join('\n');
            const poster = await getDiscordPoster(factionId, 'feedback');
            if (poster?.error) return res.status(400).json({ error: poster.error });
            const configured = !!poster;
            if (!configured || !mentions.length) {
                return res.status(200).json({ sent: false, configured, text, mentioned: mentions.length, noDiscord, mapError });
            }
            const postToDiscord = poster.post;

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

        // What's New posts to Discord, as embeds instead of plain message content — an embed description
        // allows ~4096 characters (vs. 2000 for a normal message), which is what actually fixes a long
        // version's bullets being "too big to paste" rather than just moving the copy-paste elsewhere.
        // WHATS_NEW itself lives client-side (whats-new.js) — the client builds the embed objects (one
        // per version, already chunked to Discord's 6000-char-per-message/10-embeds-per-message caps) and
        // this just forwards them to the faction's 'whatsnew' Discord destination (see discord-settings-*).
        if (action === 'whatsnew-post') {
            const { embeds } = req.body;
            if (!Array.isArray(embeds) || !embeds.length) return res.status(400).json({ error: 'Nothing to post.' });
            if (embeds.length > 10) return res.status(400).json({ error: 'Too many entries for one message (Discord allows 10 embeds) — post in smaller batches.' });
            const safeEmbeds = embeds.map(e => ({
                title: String(e.title || '').slice(0, 256),
                description: String(e.description || '').slice(0, 4096),
                color: Number.isInteger(e.color) ? e.color : 0x35d99b,
            }));
            const totalLen = safeEmbeds.reduce((s, e) => s + e.title.length + e.description.length, 0);
            if (totalLen > 6000) return res.status(400).json({ error: 'That\'s too much text for one Discord message (6000 character limit across all embeds) — post in smaller batches.' });
            const poster = await getDiscordPoster(factionId, 'whatsnew');
            if (poster?.error) return res.status(400).json({ error: poster.error });
            if (!poster) return res.status(400).json({ error: 'The What\'s new Discord channel isn\'t set up yet (see Discord settings under Leader settings).' });
            const r = await poster.post('', [], safeEmbeds);
            if (!r.ok) {
                const body = await r.text().catch(() => '');
                return res.status(502).json({ error: `Discord rejected the message (${r.status})${body ? `: ${body.slice(0, 120)}` : ''}` });
            }
            return res.status(200).json({ ok: true });
        }
        // Which version was last posted to Discord — moved server-side (was localStorage-only, so
        // different leaders on different devices each had their own independent "posted up to" marker
        // instead of one shared, faction-wide fact).
        if (action === 'whatsnew-posted-get') {
            const v = await redis(['GET', `wwl:whatsnew-posted:${factionId}`]);
            return res.status(200).json({ posted: v || null });
        }
        if (action === 'whatsnew-posted-set') {
            const { version } = req.body;
            if (!version) return res.status(400).json({ error: 'Missing version' });
            await redis(['SET', `wwl:whatsnew-posted:${factionId}`, String(version)]);
            return res.status(200).json({ ok: true });
        }

        // Matched/upcoming wars a tracker can be linked to (picker in the start form).
        if (action === 'availability-wars') {
            try { return res.status(200).json({ wars: await getUpcomingWars(key, factionId) }); }
            catch (e) { return res.status(403).json({ error: String(e.message || e) }); }
        }

        // Adds a new plan (tracker) alongside any existing ones — e.g. next weekend's while this
        // weekend's is still running. Optionally linked to a ranked war (warId — start time and
        // opponent are taken from Torn itself, not trusted from the client) or given a manual war
        // start (warStart, unix); neither is required. Capped at 10 plans so the dropdown and
        // storage can't grow forever.
        if (action === 'availability-create') {
            if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });
            const { startDate, days, warId, warStart, name } = req.body;
            const dayCount = Math.min(14, Math.max(1, Number(days) || 5));
            if (!startDate) return res.status(400).json({ error: 'Missing startDate' });
            const plans = await loadPlanIndex(factionId);
            if (plans.length >= 10) return res.status(400).json({ error: 'You already have 10 plans — delete an old one first.' });
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
            const planId = Math.random().toString(36).slice(2, 8);
            const planName = String(name || '').trim().slice(0, 40);
            await redis(['SET', availabilityKey(factionId, planId), JSON.stringify({ name: planName, startDate, days: dayCount, war, entries: {}, unavailable: {} })]);
            plans.push({ id: planId, name: planName, startDate, days: dayCount, war, createdAt: Date.now() });
            await redis(['SET', availabilityIndexKey(factionId), JSON.stringify(plans)]);
            return res.status(200).json({ ok: true, planId });
        }

        // Links (or re-links) a plan to a matched war afterwards, and records what kind of war it is: termed or not and, for a
        // termed war, how it ended (won / lost) and the score. The war itself comes from Torn (not trusted from the client);
        // if the plan is already linked to that war, its saved details are kept. Leaders only.
        if (action === 'availability-link-war') {
            if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });
            const { warId, warStart, termed, agreed, lead, loserPct, ourScore, theirScore, expectDays } = req.body;
            const { plans, id: planId, data } = await resolvePlan(factionId, req.body.planId, true);
            if (!data) return res.status(400).json({ error: 'There is no plan to link — create one first.' });
            let war;
            if (warId && String(data.war?.id) === String(warId)) war = { ...data.war };
            else if (warId) {
                let wars;
                try { wars = await getUpcomingWars(key, factionId); } catch (e) { return res.status(403).json({ error: String(e.message || e) }); }
                const w = wars.find(x => x.id === String(warId));
                if (!w) return res.status(400).json({ error: "Couldn't find that war among your matched/upcoming wars — it may have already ended." });
                war = { id: w.id, start: w.start, opponent: w.opponent };
            } else if (Number(warStart) > 0) war = { id: null, start: Number(warStart), opponent: data.war?.opponent || '' };
            else return res.status(400).json({ error: 'Pick a matched war, or enter the war start time.' });
            war.termed = !!termed;
            const score = n => (Number.isFinite(Number(n)) && n !== '' && n !== null && Number(n) >= 0 ? Math.round(Number(n)) : null);
            war.agreed = war.termed && ['win', 'lose'].includes(agreed) ? agreed : ''; // decided before the war starts
            war.lead = war.termed ? score(lead) : null; war.loserPct = war.termed ? (Number.isFinite(Number(loserPct)) && Number(loserPct) >= 0 && Number(loserPct) <= 100 ? Number(loserPct) : 40) : null;
            delete war.result;
            war.ourScore = war.termed ? score(ourScore) : null;
            war.theirScore = war.termed ? score(theirScore) : null;
            // How many days this war is expected to run — a termed war especially can end much sooner than the grid's
            // full width, or (if the terms break down) run longer than planned; just a guess to highlight in the
            // grid, changeable any time, never used to lock anyone out of ticking a box.
            const ed = Math.round(Number(expectDays));
            war.expectDays = Number.isFinite(ed) && ed >= 1 && ed <= 14 ? ed : null;
            data.war = war;
            await redis(['SET', availabilityKey(factionId, planId), JSON.stringify(data)]);
            const meta = plans.find(p => p.id === planId);
            if (meta) { meta.war = war; await redis(['SET', availabilityIndexKey(factionId), JSON.stringify(plans)]); }
            return res.status(200).json({ ok: true, war });
        }

        // Changes how many days a plan's grid shows (and, optionally, its start date) after it was already created —
        // a termed war is often shorter than the 5 days first guessed, so there's no need to delete and recreate the
        // whole plan (and lose everyone's ticks) just to shrink or grow it. Leaders only.
        if (action === 'availability-resize') {
            if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });
            const { plans, id: planId, data } = await resolvePlan(factionId, req.body.planId, true);
            if (!data) return res.status(400).json({ error: 'There is no plan to change — create one first.' });
            const days = Math.min(14, Math.max(1, Math.round(Number(req.body.days)) || data.days));
            const startDate = /^\d{4}-\d{2}-\d{2}$/.test(req.body.startDate) ? req.body.startDate : data.startDate;
            data.days = days; data.startDate = startDate;
            await redis(['SET', availabilityKey(factionId, planId), JSON.stringify(data)]);
            const meta = plans.find(p => p.id === planId);
            if (meta) { meta.days = days; meta.startDate = startDate; await redis(['SET', availabilityIndexKey(factionId), JSON.stringify(plans)]); }
            return res.status(200).json({ ok: true, days, startDate });
        }

        if (action === 'availability-delete') {
            if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });
            const { planId } = req.body;
            const plans = await loadPlanIndex(factionId);
            if (!plans.find(p => p.id === planId)) return res.status(400).json({ error: 'That plan doesn\'t exist.' });
            await redis(['DEL', availabilityKey(factionId, planId)]);
            await redis(['SET', availabilityIndexKey(factionId), JSON.stringify(plans.filter(p => p.id !== planId))]);
            return res.status(200).json({ ok: true });
        }

        // Archives (or restores) a plan: it stops showing in the everyday plan dropdown (so members stop seeing it and can't fill it in),
        // but everything already on it — the entries, the war link, the overdose history — stays, and a leader can still open it from the
        // "Archived plans" list to check it later. Leaders only.
        if (action === 'availability-archive') {
            if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });
            const { planId, archived } = req.body;
            const plans = await loadPlanIndex(factionId);
            const meta = plans.find(p => p.id === planId);
            if (!meta) return res.status(400).json({ error: 'That plan doesn\'t exist.' });
            meta.archived = !!archived;
            await redis(['SET', availabilityIndexKey(factionId), JSON.stringify(plans)]);
            return res.status(200).json({ ok: true, archived: meta.archived });
        }

        // Overdose view: who's overdosed since the window start, from the last scan. Reads only
        // stored data (no Torn calls) — the scanning is od-scan below.
        if (action === 'od-get') {
            const plans = await loadPlanIndex(factionId);
            const window = odWindowFor(plans);
            const raw = await redis(['GET', odDocKey(factionId)]);
            const doc = raw ? JSON.parse(raw) : null;
            const valid = !!doc && doc.windowStart === window.start; // baselines belong to one window
            const members = [];
            if (valid) {
                for (const [id, latest] of Object.entries(doc.latest || {})) {
                    const base = doc.base?.[id];
                    if (base == null) continue;
                    const delta = latest.count - base;
                    if (delta <= 0) continue;
                    const last = [...(doc.events || [])].reverse().find(e => e.id === id);
                    const w = doc.when?.[id]; members.push({ id, name: doc.names?.[id] || `#${id}`, delta, total: latest.count, detectedAt: last?.at || null, when: w && w.count === latest.count ? w : null });
                }
                members.sort((a, b) => b.delta - a.delta);
            }
            // Sanity check on the historical baselines: if lots of members who have overdosed at
            // some point show a baseline of exactly zero, the history lookup probably returned
            // zeros rather than real values, and the counts above would be inflated.
            let suspect = false;
            if (valid) {
                const ever = Object.entries(doc.latest || {}).filter(([, l]) => l.count > 0);
                const zeroBase = ever.filter(([id]) => doc.base?.[id] === 0);
                suspect = ever.length >= 5 && zeroBase.length / ever.length > 0.5;
            }
            return res.status(200).json({ window, scannedAt: doc?.scannedAt || 0, scannedCount: valid ? Object.keys(doc.latest || {}).length : 0, needsScan: !valid || !doc.scannedAt, members, suspect });
        }

        // Scans a slice of the roster: each member's overdosed count now, plus (once per window)
        // their count at the window start. Paced under Torn's rate limit, so the browser calls
        // this repeatedly with an advancing cursor until done — one call can't cover a whole
        // faction inside a serverless function's time budget.
        if (action === 'od-scan') {
            const cursor = Math.max(0, Number(req.body.cursor) || 0);
            const CHUNK = 12;
            const plans = await loadPlanIndex(factionId);
            const window = odWindowFor(plans);
            const now = Math.floor(Date.now() / 1000);
            const raw = await redis(['GET', odDocKey(factionId)]);
            const doc = raw ? JSON.parse(raw) : { base: {}, latest: {}, names: {}, events: [], roster: [], scannedAt: 0 };
            if (doc.windowStart !== window.start) { doc.windowStart = window.start; doc.base = {}; doc.scannedAt = 0; } // baselines are per window
            if (cursor === 0) {
                try { doc.roster = await getRoster(key); }
                catch (e) { return res.status(403).json({ error: `Couldn't read the member list: ${e.message}` }); }
            }
            const slice = (doc.roster || []).slice(cursor, cursor + CHUNK);
            let errors = 0, rateLimited = false;
            for (const m of slice) {
                try {
                    const cur = await fetchOverdosed(m.id, key);
                    await sleep(600);
                    if (cur === null) { errors++; continue; }
                    if (doc.base[m.id] == null) {
                        const base = await fetchOverdosed(m.id, key, window.start);
                        await sleep(600);
                        if (base !== null) doc.base[m.id] = base; else errors++;
                    }
                    const prev = doc.latest[m.id];
                    if (prev && cur > prev.count) doc.events.push({ id: m.id, name: m.name, at: now, from: prev.count, to: cur }); // an increase since the last scan = an overdose noticed
                    doc.latest[m.id] = { count: cur, at: now };
                    doc.names[m.id] = m.name;
                } catch (e) {
                    errors++;
                    if (e.code === 5) { rateLimited = true; break; } // Torn's "too many requests" — stop, the browser can retry from here
                }
            }
            const nextCursor = rateLimited ? cursor : cursor + slice.length;
            const done = !rateLimited && nextCursor >= (doc.roster || []).length;
            if (done) doc.scannedAt = now;
            doc.events = (doc.events || []).slice(-500);
            await redis(['SET', odDocKey(factionId), JSON.stringify(doc)]);
            return res.status(200).json({ done, nextCursor, total: (doc.roster || []).length, errors, rateLimited });
        }

        // When did each overdose show up? Torn keeps a member's stats history as snapshots, so we look up the count at a few moments between the
        // window start and now (binary search) and find when it first went up: "seen in Torn's history by" that moment. A few members per call
        // (each needs several lookups); the page keeps asking until `remaining` is 0. Leaders only.
        if (action === 'od-when') {
            if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });
            const plans = await loadPlanIndex(factionId);
            const window = odWindowFor(plans);
            const raw = await redis(['GET', odDocKey(factionId)]);
            const doc = raw ? JSON.parse(raw) : null;
            if (!doc || doc.windowStart !== window.start) return res.status(200).json({ remaining: 0, done: true });
            const now = Math.floor(Date.now() / 1000);
            doc.when = doc.when || {};
            const need = Object.entries(doc.latest || {}).filter(([id, l]) => doc.base?.[id] != null && l.count > doc.base[id] && doc.when[id]?.count !== l.count);
            const search = async (id, target, lo, hi) => { // smallest moment (about an hour exact) at which the recorded count is at least `target`
                for (let step = 0; step < 8 && hi - lo > 3600; step++) {
                    const mid = Math.floor((lo + hi) / 2);
                    const v = await fetchOverdosed(id, key, mid); await sleep(500);
                    if (v === null) break;
                    if (v >= target) hi = mid; else lo = mid;
                }
                return { from: lo, to: hi };
            };
            let done = 0, rateLimited = false;
            for (const [id, l] of need.slice(0, 3)) {
                try {
                    const base = doc.base[id];
                    const first = await search(id, base + 1, window.start, now);
                    const last = l.count - base > 1 ? await search(id, l.count, first.from, now) : first;
                    doc.when[id] = { count: l.count, first, last };
                    done++;
                } catch (e) { if (e.code === 5) { rateLimited = true; break; } }
            }
            await redis(['SET', odDocKey(factionId), JSON.stringify(doc)]);
            return res.status(200).json({ remaining: Math.max(0, need.length - done), rateLimited });
        }

        if (action === 'list-wars') {
            const [r, restockedRaw, register] = await Promise.all([
                tornFetch(`https://api.torn.com/v2/faction?selections=rankedwars&key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } }),
                redis(['GET', restockedKey(factionId)]),
                loadExtra(redis, factionId), // the war & chain register: chain events and which chains belong where
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
            return res.status(200).json({ wars: list, events: register.events, links: register.links });
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
            const { warStart, warEnd, itemId } = req.body;
            // The chains come from the register (a war's or chain event's assigned chains), never from the request,
            // so a chain can't be paid for twice under two different wars.
            const register = await loadExtra(redis, factionId);
            const isEvent = isEventId(itemId);
            const chains = (register.links[String(itemId)] || []).map(String);
            if (!itemId) return res.status(400).json({ error: 'Pick a war or chain event first.' });
            if (!isEvent && (!warStart || !warEnd)) return res.status(400).json({ error: 'Pick a war first — war hits are counted directly from it.' });

            const membersByAttacker = {}; // attackerId -> { warHits, overflowHits, perChain: { chainId: totalHitsInThatChain } }

            // War hits: authoritative, straight from the war itself — covers every member who
            // landed a war hit whether or not it happened inside a chain the leader added below.
            // A chain event has no war, so nothing to scan — all its hits come from its chains.
            const warHitsResult = isEvent ? { perAttacker: {}, scanned: 0, ownAttacks: 0, rateLimited: false, pagesFetched: 0 } : await fetchWarHits(key, factionId, warStart, warEnd);
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
                if (i > 0) await sleep(600); // stay well clear of Torn's rate limit across multiple chains
                const r = await tornFetch(`https://api.torn.com/v2/faction/${chainId}/chainreport?key=${encodeURIComponent(key)}`,
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
            const membersRes = await tornFetch(`https://api.torn.com/v2/faction/members?striptags=true&key=${encodeURIComponent(key)}`,
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
        // One-off diagnostic: 4 of the 8 War Badges never show (Rogue Element/abroad, Catalyst/assists,
        // Detonator/hospitalized, Volatile Compound/timesDowned) — all four depend on lib/warBadgeStats.js's
        // guess at Torn's `result` string and `modifiers.overseas` field, which was never confirmed against
        // a real response (see its own top comment). This dumps a few raw attacks from a real war so the
        // actual field names/values can be read directly instead of guessing again.
        if (action === 'badge-probe') {
            const { warStart, warEnd } = req.body;
            if (!warStart || !warEnd) return res.status(400).json({ error: 'Pick a war first.' });
            // Walks the whole war (not just one page), tallying every distinct `result` value and every
            // distinct `overseas` modifier value seen — not just a small raw sample — so a value that's
            // rare (an assist, a hospitalization, a real abroad hit) isn't missed just because it wasn't
            // in the first page.
            const resultCounts = { outgoing: {}, incoming: {} };
            const overseasValues = {};
            let outgoingExample = null, hospitalLikeExample = null;
            let from = warStart, scanned = 0, pages = 0;
            const MAX_PAGES = 20;
            while (from <= warEnd && pages < MAX_PAGES) {
                if (pages > 0) await sleep(1100);
                const r = await tornFetch(`https://api.torn.com/v2/faction/attacks?from=${from}&to=${warEnd}&sort=ASC&key=${encodeURIComponent(key)}`,
                    { headers: { accept: 'application/json' } });
                const data = await r.json();
                if (data.error) { if (isRateLimited(data)) break; return res.status(403).json({ error: data.error.error }); }
                const list = Array.isArray(data.attacks) ? data.attacks : Object.values(data.attacks || {});
                if (!list.length) break;
                pages++;
                let newest = from;
                for (const a of list) {
                    const ts = a.ended ?? a.started ?? from;
                    if (ts > newest) newest = ts;
                    scanned++;
                    const r0 = String(a.result ?? '');
                    const ov = a.modifiers?.overseas;
                    if (ov !== undefined) overseasValues[String(ov)] = (overseasValues[String(ov)] || 0) + 1;
                    if (String(a.attacker?.faction?.id ?? '') === factionId) {
                        resultCounts.outgoing[r0] = (resultCounts.outgoing[r0] || 0) + 1;
                        if (!outgoingExample) outgoingExample = { result: a.result, modifiers: a.modifiers, is_ranked_war: a.is_ranked_war };
                        if (/hospital|mug|assist/i.test(r0) && !hospitalLikeExample) hospitalLikeExample = { result: a.result, modifiers: a.modifiers, respect_gain: a.respect_gain };
                    }
                    if (String(a.defender?.faction?.id ?? '') === factionId) {
                        resultCounts.incoming[r0] = (resultCounts.incoming[r0] || 0) + 1;
                    }
                }
                if (newest <= from) break;
                from = newest + 1;
            }
            return res.status(200).json({ scanned, pages, resultCounts, overseasValues, outgoingExample, hospitalLikeExample });
        }

        if (action === 'badge-stats') {
            const { warStart, warEnd, enemyFactionId } = req.body;
            if (!warStart || !warEnd || !enemyFactionId) return res.status(400).json({ error: 'Pick a war first.' });

            const result = await fetchWarBadgeStats(key, factionId, String(enemyFactionId), warStart, warEnd);

            const membersRes = await tornFetch(`https://api.torn.com/v2/faction/members?striptags=true&key=${encodeURIComponent(key)}`,
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
                    const membersRes = await tornFetch(`https://api.torn.com/v2/faction/members?striptags=true&key=${encodeURIComponent(key)}`,
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
            try { await labsRecordReceipt(redis, { receiptId: id, factionId, factionName, receipt }); } catch (e) { /* the ledger must never block saving a payout receipt */ }

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

        // A receipt made and saved with WWL before the War reports list existed still has its own
        // page (get-receipt above works on any id, no faction check — that's what makes the link
        // shareable outside the faction), but was never added to this faction's receipts-index, so
        // it never showed up on War reports. Pasting its link/id back in just adds that missing
        // index entry — nothing about the receipt itself changes.
        if (action === 'reindex-receipt') {
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: 'Missing id' });
            const raw = await redis(['GET', `wwl:payout-receipt:${id}`]);
            if (!raw) return res.status(404).json({ error: 'No receipt found with that link/id — check it was copied in full.' });
            const rc = JSON.parse(raw);
            if (String(rc.factionId) !== factionId) return res.status(403).json({ error: 'That receipt belongs to a different faction.' });

            const indexKey = `wwl:receipts-index:${factionId}`;
            const indexRaw = await redis(['GET', indexKey]);
            const index = indexRaw ? JSON.parse(indexRaw) : [];
            if (index.some(e => e.id === id)) return res.status(200).json({ ok: true, alreadyListed: true });
            index.unshift({ id, opponent: rc.opponent, warEnd: rc.warEnd, hasBadges: !!rc.badgeStats, createdAt: rc.createdAt || Date.now() });
            await redis(['SET', indexKey, JSON.stringify(index.slice(0, 200))]);
            return res.status(200).json({ ok: true });
        }

        // A receipt can be missing warId (and so has no restocked checkbox) for reasons the
        // automatic backfill in lib/warReports.js can't fix on its own — the war it's from may have
        // aged out of Torn's own rankedwars history, or the receipt predates enemyFactionId being
        // stored at all. Letting a leader pick the war by hand here covers both: it also opportunistically
        // fills in won/scores/enemyFactionId if the receipt doesn't have them yet.
        if (action === 'set-receipt-war') {
            const { id, warId } = req.body;
            if (!id || !warId) return res.status(400).json({ error: 'Missing id or warId' });
            const raw = await redis(['GET', `wwl:payout-receipt:${id}`]);
            if (!raw) return res.status(404).json({ error: 'Receipt not found' });
            const rc = JSON.parse(raw);
            if (String(rc.factionId) !== factionId) return res.status(403).json({ error: 'That receipt belongs to a different faction.' });

            const r = await tornFetch(`https://api.torn.com/v2/faction?selections=rankedwars&key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } });
            const data = await r.json();
            if (data.error) return res.status(403).json({ error: data.error.error });
            const w = Object.values(data.rankedwars || {}).find(x => String(x.id) === String(warId));
            if (!w) return res.status(404).json({ error: 'That war was not found on this key.' });
            const us = (w.factions || []).find(f => String(f.id) === factionId);
            const them = (w.factions || []).find(f => String(f.id) !== factionId);
            rc.warId = w.id;
            rc.warStart = rc.warStart ?? w.start;
            rc.enemyFactionId = rc.enemyFactionId ?? them?.id;
            if (rc.won === undefined || rc.won === null) rc.won = w.winner != null ? String(w.winner) === factionId : null;
            if (rc.scoreUs == null) rc.scoreUs = us?.score ?? null;
            if (rc.scoreThem == null) rc.scoreThem = them?.score ?? null;
            await redis(['SET', `wwl:payout-receipt:${id}`, JSON.stringify(rc)]);
            return res.status(200).json({ ok: true });
        }

        // Removing a wrongly-added report from THIS list — the exact inverse of reindex-receipt,
        // not a destroy: the receipt itself, its shareable link and its Labs ledger entry are left
        // alone, so pasting the same link back in later (reindex-receipt) recovers it exactly as it
        // was. Deliberately not a hard delete — there is no "are you sure" step drastic enough to
        // justify losing a payout report's actual numbers over one wrong click.
        if (action === 'remove-receipt') {
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: 'Missing id' });
            const raw = await redis(['GET', `wwl:payout-receipt:${id}`]);
            if (raw && String(JSON.parse(raw).factionId) !== factionId) return res.status(403).json({ error: 'That receipt belongs to a different faction.' });

            const indexKey = `wwl:receipts-index:${factionId}`;
            const indexRaw = await redis(['GET', indexKey]);
            const index = (indexRaw ? JSON.parse(indexRaw) : []).filter(e => e.id !== id);
            await redis(['SET', indexKey, JSON.stringify(index)]);
            return res.status(200).json({ ok: true });
        }

        return res.status(400).json({ error: 'Unknown action' });
    } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
    }
};
