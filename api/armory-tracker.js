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
async function fetchAllArmoryNews(key, from, to) {
    const all = [];
    const seenIds = new Set();
    let cursor = to;
    let page = 0, rateLimited = false;
    const MAX_PAGES = 40;
    while (page < MAX_PAGES) {
        if (page > 0) await sleep(900);
        const r = await tornFetch(`https://api.torn.com/v2/faction/news?striptags=false&limit=100&sort=DESC&to=${cursor}&from=${from}&cat=armoryAction&key=${encodeURIComponent(key)}`,
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

module.exports = async function handler(req, res) {
    try {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const { key, action } = req.body || {};
        if (!key) return res.status(400).json({ error: 'Missing key' });

        const factionId = await getFactionId(key);
        if (!factionId) return res.status(403).json({ error: 'Could not determine your faction from this key' });
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
            if (now > war.end + 86400 && !news.rateLimited && !news.hitPageCap) await redis(['SET', cacheKey(warId), JSON.stringify(result)]);
            return res.status(200).json(result);
        }

        if (action === 'consumption-report') {
            const { from, to } = req.body;
            if (!from || !to) return res.status(400).json({ error: 'Pick a date range first.' });

            const [newsResult, itemsRes] = await Promise.all([
                fetchAllArmoryNews(key, from, to),
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
        return res.status(500).json({ error: String(e.message || e) });
    }
};
