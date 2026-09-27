// lib/armoryConsumption.js — per-day, per-member Candy/Alcohol/Blood-bags numbers, sourced from the
// faction's own real armory news log (the same one a leader can read by hand), not from Torn's personal
// lifetime stats. Those personal stats (candyused/alcoholused/bloodwithdrawn) count EVERYTHING a member
// has ever done, from any source — bought themselves, gifted, market — not specifically what came out
// of THIS faction's own armory, which is what the competitions and "Your standing" actually mean.
//
// Sourced from cat=armoryAction news entries (see lib/armoryNewsParser.js), same feed the Consumption
// Tracker already reads: "X used one of the faction's <item> items" (candy/alcohol, from
// lib/trackedItems.js's curated list) and "X filled a <Blood Bag> for the faction armory" (the "filled"
// wording is an educated guess, same caveat as in armoryNewsParser.js — if the numbers look off after
// this ships, send a real news line and the pattern can be corrected).
//
// Stored as day buckets (UTC calendar day), like the respect tracker's daily logs, so a day once
// written never needs re-reading, and summing a period is just adding up the days it covers.
//
// Coverage is a single contiguous range [backfillFrom, through] that only ever grows at either end:
//   - `through` is pushed forward automatically, a little at a time, whenever a leader opens Member
//     Overview (syncForward) — cheap, usually nothing to do.
//   - `backfillFrom` is pushed backward only when a leader presses "Dig deeper" (digDeeper), same idea
//     as the respect tracker's own deep-sync buttons.
// Because the two cursors only ever move apart (forward one grows up, backward one grows down), the
// same news entry can never be counted by both, so no per-entry dedup set is needed at all — cheaper
// on the database than the respect tracker's SADD-per-id approach, and just as correct.

const { tornFetch } = require('./tornFetch');
const { isRateLimited, sleep } = require('./warHits');
const { parseArmoryNewsEntry } = require('./armoryNewsParser');
const { TRACKED_ITEMS } = require('./trackedItems');

const DAY = 86400;
const dailyKey = (f) => `wwl:armory-consumed-daily:${f}`; // { "<date>": { "<playerId>": { candyused, alcoholused, bloodwithdrawn } } }
const throughKey = (f) => `wwl:armory-consumed-through:${f}`; // everything up to and including this second is accounted for
const backfillFromKey = (f) => `wwl:armory-consumed-from:${f}`; // everything from this second on is accounted for (moves back on "Dig deeper")
const verKey = (f) => `wwl:armory-consumed-ver:${f}`;
// Bump this if a parsing pattern that's already been applied turns out wrong — the next sync then wipes
// and rebuilds everything from scratch with the corrected pattern, instead of leaving old, silently-wrong
// counts baked into already-covered days that neither cursor will ever re-read.
// v2 (2026-09-27): the "filled" pattern was a wrong guess for its first day live — real wording confirmed
// as "X filled one of the faction's Empty Blood Bags to create a <type>", fixed in armoryNewsParser.js.
const SCHEMA_VERSION = '2';

function dayStr(ts) { return new Date(ts * 1000).toISOString().slice(0, 10); }

// Applies one news entry to the day log if it's a candy/alcohol "used" event or a blood-bag "filled"
// event. Returns true if it actually changed something.
function applyEntry(daily, entry) {
    const parsed = parseArmoryNewsEntry(String(entry.id), entry);
    if (parsed.unparsed || !parsed.actorId) return false;
    let field = null;
    if (parsed.action === 'used') {
        const cat = TRACKED_ITEMS[parsed.item.toLowerCase()];
        if (cat === 'Candy') field = 'candyused';
        else if (cat === 'Alcohol') field = 'alcoholused';
    } else if (parsed.action === 'filled' && /blood bag/i.test(parsed.item)) {
        field = 'bloodwithdrawn';
    }
    if (!field || !parsed.timestamp) return false;
    const date = dayStr(parsed.timestamp);
    const day = daily[date] || (daily[date] = {});
    const p = day[parsed.actorId] || (day[parsed.actorId] = { candyused: 0, alcoholused: 0, bloodwithdrawn: 0 });
    p[field] += parsed.quantity || 1;
    return true;
}

// Automatic, incremental: walks forward from wherever it last left off, up to now. Meant to run every
// time a leader opens Member Overview — the gap is normally a day or two, so this is usually 1 page.
async function syncForward(key, factionId, redis) {
    const now = Math.floor(Date.now() / 1000);
    const ver = await redis(['GET', verKey(factionId)]);
    if (ver !== SCHEMA_VERSION) {
        await Promise.all([redis(['DEL', dailyKey(factionId)]), redis(['DEL', throughKey(factionId)]), redis(['DEL', backfillFromKey(factionId)])]);
        await redis(['SET', verKey(factionId), SCHEMA_VERSION]);
    }
    const throughRaw = await redis(['GET', throughKey(factionId)]);
    let from;
    if (throughRaw) from = Number(throughRaw) + 1;
    else {
        from = now - 2 * DAY; // first time ever: a short recent window is enough to get going
        const bf = await redis(['GET', backfillFromKey(factionId)]);
        if (!bf) await redis(['SET', backfillFromKey(factionId), String(from)]); // "Dig deeper" starts from here
    }
    if (from > now) return { synced: 0, pages: 0 };

    const raw = await redis(['GET', dailyKey(factionId)]);
    const daily = raw ? JSON.parse(raw) : {};
    // caughtUp only ever becomes true on a path that actually confirms nothing is left before `now` —
    // running out of the page budget on a big backlog must NOT be mistaken for having finished, or the
    // unprocessed remainder between here and `now` would be marked done and silently never picked up.
    let synced = 0, pages = 0, cursor = from, caughtUp = false, rateLimited = false;
    for (; pages < 10; pages++) {
        if (pages > 0) await sleep(900);
        const r = await tornFetch(`https://api.torn.com/v2/faction/news?striptags=false&limit=100&sort=ASC&from=${cursor}&to=${now}&cat=armoryAction&key=${encodeURIComponent(key)}`,
            { headers: { accept: 'application/json' } });
        const data = await r.json();
        if (data.error) { if (isRateLimited(data)) rateLimited = true; break; }
        const news = Array.isArray(data.news) ? data.news : Object.values(data.news || {});
        if (!news.length) { caughtUp = true; break; } // nothing at all in [cursor, now] — genuinely done
        for (const entry of news) { if (applyEntry(daily, entry)) synced++; }
        if (news.length < 100) { caughtUp = true; break; } // fewer than a full page = reached `now` for real
        const latest = Math.max(...news.map(e => e.timestamp));
        if (latest < cursor) break; // no progress — stop rather than loop forever
        cursor = latest + 1;
        if (cursor > now) { caughtUp = true; break; }
    }
    if (synced > 0) await redis(['SET', dailyKey(factionId), JSON.stringify(daily)]);
    await redis(['SET', throughKey(factionId), String(caughtUp ? now : Math.max(from - 1, cursor - 1))]);
    return { synced, pages, rateLimited };
}

// Manual, leader-pressed "Dig deeper": walks further back in time from wherever backfill has already
// reached, same bounded-pages-per-press pattern as the respect tracker's own deep-sync buttons.
async function digDeeper(key, factionId, redis, maxPages = 15) {
    const bfRaw = await redis(['GET', backfillFromKey(factionId)]);
    if (!bfRaw) return { synced: 0, pagesFetched: 0, stopReason: 'Open Member Overview once first.' };
    let cursor = Number(bfRaw) - 1;
    if (cursor <= 0) return { synced: 0, pagesFetched: 0, stopReason: 'reached-start', reachedStart: true };

    const raw = await redis(['GET', dailyKey(factionId)]);
    const daily = raw ? JSON.parse(raw) : {};
    let synced = 0, pagesFetched = 0, rateLimited = false, stopReason = 'max-pages', reachedStart = false;
    let earliest = cursor + 1;
    for (let page = 0; page < maxPages; page++) {
        if (page > 0) await sleep(900);
        const r = await tornFetch(`https://api.torn.com/v2/faction/news?striptags=false&limit=100&sort=DESC&to=${cursor}&cat=armoryAction&key=${encodeURIComponent(key)}`,
            { headers: { accept: 'application/json' } });
        const data = await r.json();
        if (data.error) { if (isRateLimited(data)) rateLimited = true; stopReason = `Torn said: ${data.error.error || data.error.code}`; break; }
        const news = Array.isArray(data.news) ? data.news : Object.values(data.news || {});
        pagesFetched++;
        if (!news.length) { stopReason = 'reached-start (no more armory news before this point)'; reachedStart = true; earliest = 0; break; } // 0 so the next press short-circuits instead of re-asking Torn the same thing
        for (const entry of news) { if (applyEntry(daily, entry)) synced++; }
        const oldest = Math.min(...news.map(e => e.timestamp));
        earliest = Math.min(earliest, oldest);
        if (oldest >= cursor) { stopReason = 'no-progress'; break; }
        cursor = oldest - 1;
    }
    if (synced > 0) await redis(['SET', dailyKey(factionId), JSON.stringify(daily)]);
    await redis(['SET', backfillFromKey(factionId), String(earliest)]);
    return { synced, pagesFetched, rateLimited, stopReason, reachedStart };
}

// Sums the day log over [from, to) for every member with any recorded activity in that range.
async function armoryConsumedBetween(redis, factionId, from, to) {
    const [raw, bfRaw] = await Promise.all([redis(['GET', dailyKey(factionId)]), redis(['GET', backfillFromKey(factionId)])]);
    const daily = raw ? JSON.parse(raw) : {};
    const perMember = {};
    const fromDay = Math.floor(from / DAY), toDay = Math.floor((to - 1) / DAY);
    for (let d = fromDay; d <= toDay; d++) {
        const bucket = daily[dayStr(d * DAY)];
        if (!bucket) continue;
        for (const [id, v] of Object.entries(bucket)) {
            const p = perMember[id] || (perMember[id] = { candyused: 0, alcoholused: 0, bloodwithdrawn: 0 });
            p.candyused += v.candyused || 0; p.alcoholused += v.alcoholused || 0; p.bloodwithdrawn += v.bloodwithdrawn || 0;
        }
    }
    const backfillFrom = bfRaw ? Number(bfRaw) : null;
    const partial = backfillFrom != null && from < backfillFrom; // the period reaches back further than we've recorded/backfilled
    // hasData: has the tracker actually started (not whether it's found anything yet — a quiet day or
    // two with no matching armory news is a real, legitimate all-zeros result, not "unknown").
    return { perMember, partial, sinceDay: backfillFrom != null ? Math.floor(backfillFrom / DAY) : null, hasData: backfillFrom != null };
}

module.exports = { syncForward, digDeeper, armoryConsumedBetween };
