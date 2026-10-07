// api/armory-tracker.js — WorldWideLabs Consumption Tracker.
// Parses Torn's faction armory news feed (uses/loans — no structured JSON for this, only
// human-readable sentences, same situation api/respect.js handles for attacknews) into a
// category -> item -> player consumption report for a picked date range.
//
// Rewritten to fetch live, per request, for the exact range asked for — no pre-synced cache.
// The first version cached recent news into Redis via separate Sync/Dig-deeper steps, and the
// report only ever read from that cache; picking a date range that hadn't been synced correctly
// found nothing. Confirmed against Jimidy's Faction Tools' own (currently-disabled, but genuine)
// consumption tracker source, which does exactly this: for a chosen [from, to], page backward
// through /v2/faction/news?cat=armoryAction with `from` held fixed at the range start and only
// `to` shrinking, no caching layer at all. Adopted that directly rather than re-guessing.
//
// Endpoint/response shape confirmed the same way: /v2/faction/news?cat=armoryAction,
// striptags=false (so the player-ID link survives for lib/armoryNewsParser.js's XID extraction),
// both from+to required together, response is { news: [{id, text, timestamp}] }. What's NOT
// confirmed: wording for anything other than "used" events (that reference tool only ever
// tracked consumption, never loans — loaned/retrieved/returned/filled/opened here are still
// educated guesses) — unparsed entries are counted and sampled in the response rather than
// silently dropped, so a leader can report back what a real one looks like.
//
// Only "used" events count as consumption — loans/deposits/retrieves/returns don't, since a
// loaned weapon/armor piece is still faction property until it isn't returned. (There used to be
// a separate "current outstanding loans" live view here too, but the leader doesn't want loaned
// weapons/armor tracked here at all, so it was removed rather than fixed.) The one exception:
// loaning a Temporary-tab item (single-use throwables) counts as consumption too, same as a real
// "used" event — see the isConsumingLoan check below for why. On top of that, only items in
// lib/trackedItems.js's curated allowlist are counted at all — a hand-picked list (based on
// Jimidy's own tracker, plus the leader's own additions), not "every item Torn types as
// Drug/Medical/etc." — that broader version turned out too noisy in practice.
//
// POST { key, action: 'consumption-report', from, to }  -> leader-only: everything consumed in a
//                                                          date range, grouped category -> item ->
//                                                          player; Xanax's players additionally
//                                                          carry hits/required/shortfall for the
//                                                          10-hits-per-xanax check, from the same
//                                                          [from, to] window (not tied to a war)

const { tornFetch } = require('../lib/tornFetch');
const { parseArmoryNewsEntry } = require('../lib/armoryNewsParser');
const { fetchWarHits } = require('../lib/warHits');
const { moXanaxAll } = require('../lib/memberOverview');
const { TRACKED_ITEMS, BLOOD_BAG_RE } = require('../lib/trackedItems');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
async function redis(command) {
    if (!REDIS_URL || !REDIS_TOKEN) throw new Error('Database not connected.');
    const res = await fetch(REDIS_URL, { method: 'POST', headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.result;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function isRateLimited(data) {
    return data?.error?.code === 5 || /too many requests/i.test(data?.error?.error || '');
}

async function getFactionId(key) {
    const r = await tornFetch(`https://api.torn.com/user/?selections=profile&key=${encodeURIComponent(key)}`);
    const profile = await r.json();
    if (profile.error || !profile.faction?.faction_id) return null;
    return String(profile.faction.faction_id);
}
async function isLeader(key) {
    const r = await tornFetch(`https://api.torn.com/v2/faction/balance?key=${encodeURIComponent(key)}`,
        { headers: { accept: 'application/json' } });
    const d = await r.json();
    return !d.error;
}

// Pages backward through armory news for the exact [from, to] window — `from` stays fixed at the
// caller's requested range start, only the `to` cursor shrinks, matching the reference tool.
// Capped well below its 100-page allowance since this runs inside a serverless function with a
// real time budget, not a browser tab with no such limit. `hitPageCap` tells the caller whether
// the loop ran out of page budget with (as far as we can tell) more data still further back —
// silently truncating a long/busy date range was a real undercounting risk, now at least surfaced
// rather than hidden.
async function fetchAllArmoryNews(key, from, to, cat = 'armoryAction') {
    const all = [];
    const seenIds = new Set();
    let cursor = to;
    let page = 0, rateLimited = false;
    const MAX_PAGES = 40;
    while (page < MAX_PAGES) {
        if (page > 0) await sleep(900);
        const r = await tornFetch(`https://api.torn.com/v2/faction/news?striptags=false&limit=100&sort=DESC&to=${cursor}&from=${from}${cat ? `&cat=${cat}` : ''}&key=${encodeURIComponent(key)}`,
            { headers: { accept: 'application/json' } });
        const data = await r.json();
        if (data.error) {
            if (isRateLimited(data)) { rateLimited = true; break; }
            throw new Error(data.error.error);
        }
        const news = Array.isArray(data.news) ? data.news : Object.values(data.news || {});
        page++;
        if (!news.length) break;

        let addedAny = false;
        for (const entry of news) {
            if (entry.timestamp < from || entry.timestamp > to) continue;
            if (entry.id != null && seenIds.has(entry.id)) continue; // an entry with no id can never be a confirmed dupe
            if (entry.id != null) seenIds.add(entry.id);
            all.push(entry);
            addedAny = true;
        }
        if (!addedAny) break;
        const oldest = Math.min(...news.map(e => e.timestamp));
        if (oldest < from) break; // paged past the start of the requested range
        cursor = oldest - 1;
    }
    const hitPageCap = page >= MAX_PAGES; // loop only ends this way without having hit any natural break condition
    return { entries: all, pagesFetched: page, rateLimited, hitPageCap };
}

// ---- Finished days of the armory news are kept (compressed) so the same period is never read from Torn twice ----
// Torn limits how many times a key may read these logs per day ("Daily read limit reached"), and a report, a By war run and the Xanax
// check all re-read the same finished days. A day that is completely over (and was read completely — no rate limit, no page cap) is stored
// once as one gzipped value and served from there from then on. Today and the last hour are never stored. If the database is unreachable
// this quietly falls back to reading Torn, so a report never fails because of the cache.
const zlib = require('zlib');
const { factionAllowed, DENIED: ACCESS_DENIED } = require('../lib/access');
const DAY_S = 86400;
const NEWS_CACHE_TTL = 60 * 86400;
const newsDayKey = (factionId, cat, day) => `wwl:armory-news:${factionId}:${cat || 'all'}:${day}`; // day = UTC day number

async function fetchArmoryNewsCached(key, factionId, from, to, cat = 'armoryAction') {
    const live = (a, b) => fetchAllArmoryNews(key, a, b, cat);
    if (!factionId) return live(from, to);
    const settledBefore = Math.floor(Date.now() / 1000) - 3600; // a day only counts once it ended more than an hour ago
    const firstDay = Math.ceil(from / DAY_S), lastDay = Math.floor((Math.min(to, settledBefore) + 1) / DAY_S) - 1;
    if (lastDay < firstDay) return live(from, to);
    const days = [];
    for (let d = firstDay; d <= lastDay; d++) days.push(d);

    let stored;
    try { stored = await redis(['MGET', ...days.map(d => newsDayKey(factionId, cat, d))]); }
    catch (e) { return live(from, to); }

    const entries = [];
    const have = new Set();
    days.forEach((d, i) => {
        if (!stored[i]) return;
        try {
            for (const [id, timestamp, text] of JSON.parse(zlib.gunzipSync(Buffer.from(stored[i], 'base64')).toString())) entries.push({ id, timestamp, text });
            have.add(d);
        } catch (e) { /* unreadable: read that day again */ }
    });

    // what is still missing: everything in [from, to] outside the stored days, as runs
    const gaps = [];
    let cur = from;
    for (const d of days) {
        if (!have.has(d)) continue;
        if (d * DAY_S > cur) gaps.push([cur, d * DAY_S - 1]);
        cur = (d + 1) * DAY_S;
    }
    if (cur <= to) gaps.push([cur, to]);

    let pagesFetched = 0, rateLimited = false, hitPageCap = false;
    for (const [a, b] of gaps) {
        const r = await live(a, b);
        pagesFetched += r.pagesFetched; rateLimited = rateLimited || r.rateLimited; hitPageCap = hitPageCap || r.hitPageCap;
        entries.push(...r.entries);
        if (r.rateLimited || r.hitPageCap) continue; // incomplete: never store it
        for (let d = Math.ceil(a / DAY_S); d <= Math.floor((b + 1) / DAY_S) - 1; d++) {
            if (d < firstDay || d > lastDay) continue;
            const rows = r.entries.filter(e => Math.floor(e.timestamp / DAY_S) === d).map(e => [e.id, e.timestamp, e.text ?? e.news ?? '']);
            try { await redis(['SET', newsDayKey(factionId, cat, d), zlib.gzipSync(JSON.stringify(rows)).toString('base64'), 'EX', NEWS_CACHE_TTL]); } catch (e) { /* not critical */ }
        }
    }
    entries.sort((x, y) => y.timestamp - x.timestamp);
    return { entries, pagesFetched, rateLimited, hitPageCap, fromCache: have.size };
}

// Deposits ("Name deposited 1x Xanax") live in their OWN news category, armoryDeposit — confirmed with the deposit-log check on the
// evaluation page (2026-10-04: 11 deposit lines there, none in armoryAction). That log is small, so a whole month is a page or two. Only if
// the API refuses that category does this fall back to the busy armoryAction log, which can run past the page limit on a long period.
async function fetchDepositEntries(key, from, to, factionId) {
    try {
        return await fetchArmoryNewsCached(key, factionId, from, to, 'armoryDeposit');
    } catch (e) {
        if (/daily read limit/i.test(String(e.message))) throw new Error('Torn says this key has reached its daily limit for reading the armory log (it resets at midnight TCT). Days read earlier are kept, so pressing the button again tomorrow only reads what is missing.');
        return await fetchAllArmoryNews(key, from, to, 'armoryAction');
    }
}

module.exports = async function handler(req, res) {
    try {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const { key, action } = req.body || {};
        if (!key) return res.status(400).json({ error: 'Missing key' });

        const factionId = await getFactionId(key);
        if (!factionId) return res.status(403).json({ error: 'Could not determine your faction from this key' });
        if (!(await factionAllowed(factionId))) return res.status(403).json(ACCESS_DENIED); // only factions on the owner's list may use WWL
        if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });

        // Xanax taken out of the armory during one war's window (from `leadHours` before the war starts until 24h after it ends — the
        // same end as the war's hit count). It counts what each member USED straight from the armory ("used one of the faction's
        // Xanax items"); Xanax GIVEN to a member (competition prizes) is deliberately not counted. A finished war's answer is kept
        // (wwl:xanax-war:<faction>:<war>:<lead>) so the evaluation can use it later without reading the armory log again.
        // Pairs with the hits of that war (Member Overview already stores them per war) to see who took more than they hit for.
        if (action === 'xanax-war-scan' || action === 'xanax-war-get') {
            const leadHours = [0, 6, 12, 24, 48].includes(Number(req.body.leadHours)) ? Number(req.body.leadHours) : 48; // 48 h = the faction's Xanax stacking window
            const cacheKey = (warId) => `wwl:xanax-war:${factionId}:${warId}:${leadHours}`;
            if (action === 'xanax-war-get') { // cached answers only, no Torn calls
                const ids = (Array.isArray(req.body.warIds) ? req.body.warIds : []).map(String).filter(x => /^\d+$/.test(x)).slice(0, 10);
                const raws = ids.length ? await redis(['MGET', ...ids.map(cacheKey)]) : [];
                const out = {};
                ids.forEach((id, i) => { if (raws[i]) out[id] = JSON.parse(raws[i]); });
                return res.status(200).json({ leadHours, wars: out });
            }
            const warId = String(req.body.warId || '').replace(/\D/g, '');
            if (!warId) return res.status(400).json({ error: 'Pick a war first.' });
            if (!req.body.force) { const c = await redis(['GET', cacheKey(warId)]); if (c) return res.status(200).json({ ...JSON.parse(c), cached: true }); }
            const wr = await tornFetch(`https://api.torn.com/v2/faction?selections=rankedwars&key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } });
            const wd = await wr.json();
            if (wd.error) return res.status(403).json({ error: wd.error.error || 'Torn could not list the wars.' });
            const war = Object.values(wd.rankedwars || {}).find(w => String(w.id) === warId);
            if (!war || !war.start || !war.end) return res.status(400).json({ error: 'That war was not found or has not finished yet.' });
            const now = Math.floor(Date.now() / 1000);
            const from = war.start - leadHours * 3600, to = Math.min(war.end + 86400, now);
            const news = await fetchAllArmoryNews(key, from, to);
            const taken = {};
            let unparsed = 0;
            for (const entry of news.entries) {
                const p = parseArmoryNewsEntry(String(entry.id), entry);
                if (p.unparsed) { unparsed++; continue; }
                if (p.action !== 'used' || String(p.item).toLowerCase() !== 'xanax') continue;
                const id = p.actorId || p.actor;
                const t = taken[id] || (taken[id] = { name: p.actor, n: 0 });
                t.n += p.quantity || 1;
            }
            const result = { warId, leadHours, from, to, taken, entries: news.entries.length, rateLimited: news.rateLimited, hitPageCap: news.hitPageCap, unparsed, at: Date.now() };
            // only keep it when the window is closed and the whole log was read (a partial answer must not stick)
            if (now > war.end + 86400 && !news.rateLimited && !news.hitPageCap) {
                await redis(['SET', cacheKey(warId), JSON.stringify(result)]);
                try { await moXanaxAll({ redis, factionId }); } catch (e) { /* the stored per-member list is refreshed next time */ }
            }
            return res.status(200).json(result);
        }

        // Diagnostic for "a deposit is not being read": shows the deposit lines of the last 3 days exactly as Torn sends them, and from which
        // news category each one came, so the reader can be pointed at the right place. Changes nothing.
        if (action === 'xanax-deposit-probe') {
            const to = Math.floor(Date.now() / 1000), from = to - 3 * 86400;
            const out = [];
            for (const cat of ['armoryAction', 'armoryDeposit', '']) {
                try {
                    const r = await tornFetch(`https://api.torn.com/v2/faction/news?striptags=true&limit=100&sort=DESC&from=${from}&to=${to}${cat ? `&cat=${cat}` : ''}&key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } });
                    const d = await r.json();
                    if (d.error) { out.push({ cat: cat || '(no category)', error: d.error.error || `Torn error ${d.error.code}` }); continue; }
                    const list = Array.isArray(d.news) ? d.news : Object.values(d.news || {});
                    const lines = list.map(e => String(e.text ?? e.news ?? '')).filter(t => /deposit/i.test(t));
                    out.push({ cat: cat || '(no category)', read: list.length, deposits: lines.length, sample: lines.slice(0, 5) });
                } catch (e) { out.push({ cat: cat || '(no category)', error: String(e.message || e).slice(0, 80) }); }
                await sleep(900);
            }
            return res.status(200).json({ probe: out });
        }

        // Xanax put BACK into the armory since `from` (a deposit line in the armory log: "Name deposited 1x Xanax"), per member — what the
        // evaluation counts against the Xanax someone still owes. It changes whenever someone deposits, so it is only kept for 15 minutes;
        // `cacheOnly` returns the kept answer (or null) without reading the log.
        if (action === 'xanax-deposits') {
            const from = Math.floor(Number(req.body.from));
            if (!(from > 0)) return res.status(400).json({ error: 'Missing start time.' });
            const ck = `wwl:xanax-dep:${factionId}:${Math.floor(from / 3600)}`;
            const kept = await redis(['GET', ck]);
            if (kept && !req.body.force) return res.status(200).json({ ...JSON.parse(kept), cached: true });
            if (req.body.cacheOnly) return res.status(200).json({ none: true });
            const to = Math.floor(Date.now() / 1000);
            const news = await fetchDepositEntries(key, from, to, factionId);
            const deposited = {};
            for (const entry of news.entries) {
                const p = parseArmoryNewsEntry(String(entry.id), entry);
                if (p.unparsed || p.action !== 'deposited' || String(p.item).toLowerCase() !== 'xanax') continue;
                const id = p.actorId || p.actor;
                const d = deposited[id] || (deposited[id] = { name: p.actor, n: 0, events: [] });
                d.n += p.quantity || 1; (d.events || (d.events = [])).push([entry.timestamp, p.quantity || 1]);
            }
            const result = { v: 2, from, to, deposited, entries: news.entries.length, rateLimited: news.rateLimited, hitPageCap: news.hitPageCap, at: Date.now() };
            if (!news.rateLimited && !news.hitPageCap) {
                await redis(['SET', ck, JSON.stringify(result), 'EX', '900']);
                await redis(['SET', `wwl:xanax-dep-last:${factionId}`, JSON.stringify(result)]); // no expiry: members' own Xanax card reads this (it says when it was read)
                try { await moXanaxAll({ redis, factionId }); } catch (e) { /* the stored per-member list is refreshed next time */ }
            }
            return res.status(200).json(result);
        }

        // The finished wars, newest first — for the consumption tracker's "By war" picker (up to 16, so there is also a war before the oldest
        // one that can be ticked, which the period rule needs).
        if (action === 'armory-wars') {
            const wr = await tornFetch(`https://api.torn.com/v2/faction?selections=rankedwars&key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } });
            const wd = await wr.json();
            if (wd.error) return res.status(403).json({ error: wd.error.error || 'Torn could not list the wars.' });
            const wars = Object.values(wd.rankedwars || {}).filter(w => w.start && w.end)
                .sort((a, b) => b.end - a.end).slice(0, 16)
                .map(w => ({ id: String(w.id), start: w.start, end: w.end, opponent: ((w.factions || []).find(f => String(f.id) !== String(factionId)) || {}).name || 'Unknown' }));
            return res.status(200).json({ wars });
        }

        if (action === 'consumption-report') {
            const { from, to } = req.body;
            if (!from || !to) return res.status(400).json({ error: 'Pick a date range first.' });

            const [newsResult, itemsRes] = await Promise.all([
                fetchArmoryNewsCached(key, factionId, from, to),
                tornFetch(`https://api.torn.com/torn/?selections=items&key=${encodeURIComponent(key)}`),
            ]);
            const itemsData = await itemsRes.json();
            const catalog = {}; // lowercased item name -> { type, price }
            for (const it of Object.values(itemsData.items || {})) {
                catalog[String(it.name).toLowerCase()] = { type: it.type || 'Other', price: it.market_value ?? null };
            }

            let unparsedCount = 0;
            const unparsedSample = [];
            const byItem = {}; // item name -> { item, category, quantity, value, hasPrice, deposited, players: { name -> {quantity, value} } }
            const ensureItem = (name, category) => byItem[name] || (byItem[name] = {
                item: name, category, quantity: 0, value: 0,
                hasPrice: (catalog[name.toLowerCase()]?.price ?? null) != null, deposited: 0, given: 0, givenTo: {}, players: {},
            });
            let emptyBloodBagDeposited = 0; // "Empty Blood Bag" itself isn't a tracked item (see below), so it isn't in byItem at all
            for (const entry of newsResult.entries) {
                const parsed = parseArmoryNewsEntry(String(entry.id), entry);
                if (parsed.unparsed) {
                    unparsedCount++;
                    if (unparsedSample.length < 10) unparsedSample.push(parsed.text);
                    continue;
                }

                // How much was actually bought back, alongside how much the report below says was
                // needed — a deposit is real restocking, tracked separately from consumption so the
                // two can be compared (e.g. "needed 2,000, deposited 10,000" for a surplus).
                if (parsed.action === 'deposited') {
                    if (parsed.item.toLowerCase() === 'empty blood bag') { emptyBloodBagDeposited += parsed.quantity; continue; }
                    const category = TRACKED_ITEMS[parsed.item.toLowerCase()];
                    if (category) ensureItem(parsed.item, category).deposited += parsed.quantity;
                    continue;
                }

                const category = TRACKED_ITEMS[parsed.item.toLowerCase()];
                // Loans/retrieves/returns normally aren't consumption — a loaned weapon or armor
                // piece is still faction property until it isn't returned. Temporary-tab items are
                // the one exception: they're single-use throwables, and once one is loaned out into
                // a member's own inventory, using it in a fight never generates a "used one of the
                // faction's items" news event at all (that wording only fires for using an item
                // straight from the shared armory) — so the loan is the only signal it's ever gone,
                // and counts as consumption exactly like a real "used" event.
                const isConsumingLoan = parsed.action === 'loaned' && category === 'Temporary';
                // A drug or medical item GIVEN to a member out of the armory is gone for good (it is not loaned and returned),
                // and the member then uses it from their own inventory — which never produces a "used" line either.
                const isConsumingGive = parsed.action === 'gave' && (category === 'Drug' || category === 'Medical');
                if (parsed.action !== 'used' && !isConsumingLoan && !isConsumingGive) continue;
                if (!category) continue; // not on the curated tracked-items list
                const price = catalog[parsed.item.toLowerCase()]?.price ?? null;

                const item = ensureItem(parsed.item, category);
                item.quantity += parsed.quantity;
                if (price != null) item.value += price * parsed.quantity;
                // Something GIVEN out (the competition prizes) is a faction expense — it counts in the item's quantity, value and
                // the totals above — but it is not the member's own consumption, so it is kept apart from `players` (which also
                // drives the 10-hits-per-Xanax check) and listed under `givenTo` instead.
                if (isConsumingGive) {
                    item.given += parsed.quantity;
                    const to = parsed.otherParty || parsed.actor;
                    item.givenTo[to] = (item.givenTo[to] || 0) + parsed.quantity;
                    continue;
                }
                // a loan is attributed to whoever it was loaned TO (the sentence's actor is the leader handing it out)
                const who = isConsumingLoan && parsed.otherParty ? parsed.otherParty : parsed.actor;
                const p = item.players[who] || (item.players[who] = { name: who, quantity: 0, value: 0 });
                p.quantity += parsed.quantity;
                if (price != null) p.value += price * parsed.quantity;
            }

            // Fold the 10-hits-per-xanax check directly into Xanax's own player list, over this
            // same [from, to] window (not tied to picking a specific war) — one less panel to
            // hunt down, per the leader's own feedback that Jimidy's tool shows it this way.
            const xanaxItem = Object.values(byItem).find(it => /^xanax$/i.test(it.item));
            let warHitsMeta = null;
            if (xanaxItem && Object.keys(xanaxItem.players).length) { // only prizes given out: nobody to check hits for
                const warHitsResult = await fetchWarHits(key, factionId, from, to);
                warHitsMeta = { scanned: warHitsResult.scanned, matched: warHitsResult.ownAttacks };
                const hitsByName = {};
                for (const entry of Object.values(warHitsResult.perAttacker)) {
                    if (entry.name) hitsByName[entry.name] = (hitsByName[entry.name] || 0) + entry.count;
                }
                for (const p of Object.values(xanaxItem.players)) {
                    p.hits = hitsByName[p.name] || 0;
                    p.required = p.quantity * 10;
                    p.shortfall = Math.max(0, p.required - p.hits);
                }
            }

            // Shopping-list-only derived line: every type-specific full blood bag used started
            // life as one plain "Empty Blood Bag" a member filled, so that's the real restock
            // number, not the (untracked) empty bag's own usage. Computed from the 8 separate
            // type entries BEFORE merging them below.
            const shoppingExtras = [];
            const bloodBagQty = Object.values(byItem)
                .filter(it => BLOOD_BAG_RE.test(it.item))
                .reduce((s, it) => s + it.quantity, 0);
            if (bloodBagQty > 0 || emptyBloodBagDeposited > 0) {
                const price = catalog['empty blood bag']?.price ?? null;
                shoppingExtras.push({ category: 'Medical', item: 'Empty Blood Bag', quantity: bloodBagQty, value: price != null ? price * bloodBagQty : 0, hasPrice: price != null, deposited: emptyBloodBagDeposited });
            }

            // Merge the 8 type-specific full blood bags (Blood Bag : A+, : O-, etc.) into one
            // "Blood Bag" line — matches Jimidy's own tool, which also merges rather than listing
            // each type — and group it under Medical alongside First Aid Kit etc. rather than as
            // its own top-level category, per the leader's preference.
            const bloodBagEntries = Object.values(byItem).filter(it => BLOOD_BAG_RE.test(it.item));
            if (bloodBagEntries.length) {
                const merged = { item: 'Blood Bag', category: 'Medical', quantity: 0, value: 0, hasPrice: false, deposited: 0, given: 0, givenTo: {}, players: {} };
                for (const it of bloodBagEntries) {
                    merged.quantity += it.quantity;
                    merged.value += it.value;
                    merged.deposited += it.deposited;
                    merged.given += it.given;
                    for (const [n, q] of Object.entries(it.givenTo)) merged.givenTo[n] = (merged.givenTo[n] || 0) + q;
                    if (it.hasPrice) merged.hasPrice = true;
                    delete byItem[it.item];
                    for (const p of Object.values(it.players)) {
                        const mp = merged.players[p.name] || (merged.players[p.name] = { name: p.name, quantity: 0, value: 0 });
                        mp.quantity += p.quantity;
                        mp.value += p.value;
                    }
                }
                byItem['Blood Bag'] = merged;
            }

            const categoriesMap = {};
            for (const it of Object.values(byItem)) {
                const cat = categoriesMap[it.category] || (categoriesMap[it.category] = { category: it.category, quantity: 0, value: 0, items: [] });
                cat.quantity += it.quantity;
                cat.value += it.value;
                cat.items.push({ ...it, players: Object.values(it.players).sort((a, b) => b.quantity - a.quantity), givenTo: Object.entries(it.givenTo).map(([name, quantity]) => ({ name, quantity })).sort((a, b) => b.quantity - a.quantity) });
            }
            const categories = Object.values(categoriesMap);
            for (const c of categories) c.items.sort((a, b) => b.value - a.value);
            categories.sort((a, b) => b.value - a.value);
            const grandTotal = categories.reduce((s, c) => s + c.value, 0);

            return res.status(200).json({
                categories, grandTotal, shoppingExtras, warHitsMeta,
                meta: {
                    entriesScanned: newsResult.entries.length, pagesFetched: newsResult.pagesFetched,
                    rateLimited: newsResult.rateLimited, hitPageCap: newsResult.hitPageCap, unparsedCount, unparsedSample,
                },
            });
        }

        // Live current armory stock, straight from Torn — no news-parsing, no date range, always
        // exactly right. Only drugs/medical/boosters/temporary have their own selection (Candy and
        // Alcohol don't, so those two categories can't be shown this way). Temporary items are also
        // "loanable" in Torn's schema (available/loaned/loaned_to), which is genuinely useful here:
        // a temp weapon someone's currently holding on loan hasn't been consumed yet, but it also
        // isn't sitting ready in the armory, so seeing that split (and who has it) matters for a
        // leader checking whether the armory is actually war-ready right now.
        if (action === 'armory-stock') {
            const [r, membersRes] = await Promise.all([
                tornFetch(`https://api.torn.com/v2/faction?selections=drugs,medical,boosters,temporary&key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } }),
                tornFetch(`https://api.torn.com/v2/faction/members?striptags=true&key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } }),
            ]);
            const data = await r.json();
            if (data.error) return res.status(403).json({ error: data.error.error });
            const membersData = await membersRes.json();
            const nameById = {};
            for (const m of (membersData.members || [])) nameById[String(m.id)] = m.name;

            const categoriesMap = {};
            const addItem = (name, fields) => {
                const category = TRACKED_ITEMS[String(name).toLowerCase()];
                if (!category) return; // not on the curated tracked-items list
                const cat = categoriesMap[category] || (categoriesMap[category] = { category, items: [] });
                cat.items.push({ item: name, ...fields });
            };
            for (const it of (data.drugs || [])) addItem(it.name, { quantity: it.quantity });
            for (const it of (data.medical || [])) addItem(it.name, { quantity: it.quantity });
            for (const it of (data.boosters || [])) addItem(it.name, { quantity: it.quantity });
            for (const it of (data.temporary || [])) {
                const loanedTo = String(it.loaned_to || '').split(',').map(s => s.trim()).filter(Boolean)
                    .map(id => ({ id, name: nameById[id] || `#${id}` }));
                addItem(it.name, { quantity: it.quantity, available: it.available, loaned: it.loaned, loanedTo });
            }
            const categories = Object.values(categoriesMap);
            for (const c of categories) c.items.sort((a, b) => a.item.localeCompare(b.item));
            categories.sort((a, b) => a.category.localeCompare(b.category));
            return res.status(200).json({ categories });
        }
        return res.status(400).json({ error: 'Unknown action' });
    } catch (e) {

        const msg = String(e.message || e);
        if (/daily read limit/i.test(msg)) return res.status(429).json({ error: 'Torn says this key has reached its daily limit for reading the armory log (it resets at midnight TCT). Days that were read before are kept, so trying again tomorrow only reads what is missing.' });
        return res.status(500).json({ error: msg });
    }
};

// Used by the nightly job (api/war-payout.js ?cron=1) with a leader's stored key: brings the deposits up to date incrementally (only the
// armory log since the last reading, a page or two) and refreshes everyone's outstanding-Xanax list, so a member who has put Xanax back
// stops being reminded without a leader pressing anything. Does nothing until the deposits were read once on the evaluation page.
module.exports.refreshXanaxOwed = async function refreshXanaxOwed(key, factionId) {
    const depRaw = await redis(['GET', `wwl:xanax-dep-last:${factionId}`]);
    if (!depRaw) return { skipped: 'deposits not read yet' };
    const dep = JSON.parse(depRaw);
    if (dep.v !== 2) return { skipped: 'deposits were saved in an older form — press Re-check deposits once on the evaluation page' };
    const now = Math.floor(Date.now() / 1000);
    const news = await fetchDepositEntries(key, dep.to + 1, now, factionId);
    if (!news.rateLimited && !news.hitPageCap) {
        for (const entry of news.entries) {
            const p = parseArmoryNewsEntry(String(entry.id), entry);
            if (p.unparsed || p.action !== 'deposited' || String(p.item).toLowerCase() !== 'xanax') continue;
            const id = p.actorId || p.actor;
            const d = dep.deposited[id] || (dep.deposited[id] = { name: p.actor, n: 0, events: [] });
            d.n += p.quantity || 1; (d.events || (d.events = [])).push([entry.timestamp, p.quantity || 1]);
        }
        dep.to = now; dep.at = Date.now();
        await redis(['SET', `wwl:xanax-dep-last:${factionId}`, JSON.stringify(dep)]);
    }
    return await moXanaxAll({ redis, factionId });
};
