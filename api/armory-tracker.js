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
// weapons/armor tracked here at all, so it was removed rather than fixed.) On top of that, only
// items in lib/trackedItems.js's curated allowlist are counted at all — a hand-picked list (based
// on Jimidy's own tracker, plus the leader's own additions), not "every item Torn types as
// Drug/Medical/etc." — that broader version turned out too noisy in practice.
//
// POST { key, action: 'consumption-report', from, to }  -> leader-only: everything consumed in a
//                                                          date range, grouped category -> item ->
//                                                          player; Xanax's players additionally
//                                                          carry hits/required/shortfall for the
//                                                          10-hits-per-xanax check, from the same
//                                                          [from, to] window (not tied to a war)

const { parseArmoryNewsEntry } = require('../lib/armoryNewsParser');
const { fetchWarHits } = require('../lib/warHits');
const { TRACKED_ITEMS, BLOOD_BAG_RE } = require('../lib/trackedItems');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function isRateLimited(data) {
    return data?.error?.code === 5 || /too many requests/i.test(data?.error?.error || '');
}

async function getFactionId(key) {
    const r = await fetch(`https://api.torn.com/user/?selections=profile&key=${encodeURIComponent(key)}`);
    const profile = await r.json();
    if (profile.error || !profile.faction?.faction_id) return null;
    return String(profile.faction.faction_id);
}
async function isLeader(key) {
    const r = await fetch(`https://api.torn.com/v2/faction/balance?key=${encodeURIComponent(key)}`,
        { headers: { accept: 'application/json' } });
    const d = await r.json();
    return !d.error;
}

// Pages backward through armory news for the exact [from, to] window — `from` stays fixed at the
// caller's requested range start, only the `to` cursor shrinks, matching the reference tool.
// Capped well below its 100-page allowance since this runs inside a serverless function with a
// real time budget, not a browser tab with no such limit — should still comfortably cover months
// of activity for a normal-sized faction.
async function fetchAllArmoryNews(key, from, to) {
    const all = [];
    const seenIds = new Set();
    let cursor = to;
    let page = 0, rateLimited = false;
    const MAX_PAGES = 40;
    while (page < MAX_PAGES) {
        if (page > 0) await sleep(900);
        const r = await fetch(`https://api.torn.com/v2/faction/news?striptags=false&limit=100&sort=DESC&to=${cursor}&from=${from}&cat=armoryAction&key=${encodeURIComponent(key)}`,
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
            if (seenIds.has(entry.id)) continue;
            seenIds.add(entry.id);
            all.push(entry);
            addedAny = true;
        }
        if (!addedAny) break;
        const oldest = Math.min(...news.map(e => e.timestamp));
        if (oldest < from) break; // paged past the start of the requested range
        cursor = oldest - 1;
    }
    return { entries: all, pagesFetched: page, rateLimited };
}

module.exports = async function handler(req, res) {
    try {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const { key, action } = req.body || {};
        if (!key) return res.status(400).json({ error: 'Missing key' });

        const factionId = await getFactionId(key);
        if (!factionId) return res.status(403).json({ error: 'Could not determine your faction from this key' });
        if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });

        if (action === 'consumption-report') {
            const { from, to } = req.body;
            if (!from || !to) return res.status(400).json({ error: 'Pick a date range first.' });

            const [newsResult, itemsRes] = await Promise.all([
                fetchAllArmoryNews(key, from, to),
                fetch(`https://api.torn.com/torn/?selections=items&key=${encodeURIComponent(key)}`),
            ]);
            const itemsData = await itemsRes.json();
            const catalog = {}; // lowercased item name -> { type, price }
            for (const it of Object.values(itemsData.items || {})) {
                catalog[String(it.name).toLowerCase()] = { type: it.type || 'Other', price: it.market_value ?? null };
            }

            let unparsedCount = 0;
            const unparsedSample = [];
            const byItem = {}; // item name -> { item, category, quantity, value, hasPrice, players: { name -> {quantity, value} } }
            for (const entry of newsResult.entries) {
                const parsed = parseArmoryNewsEntry(String(entry.id), entry);
                if (parsed.unparsed) {
                    unparsedCount++;
                    if (unparsedSample.length < 10) unparsedSample.push(parsed.text);
                    continue;
                }
                if (parsed.action !== 'used') continue; // loans/deposits/retrieves/returns aren't consumption
                const category = TRACKED_ITEMS[parsed.item.toLowerCase()];
                if (!category) continue; // not on the curated tracked-items list
                const meta = catalog[parsed.item.toLowerCase()];
                const price = meta?.price ?? null;

                const item = byItem[parsed.item] || (byItem[parsed.item] = { item: parsed.item, category, quantity: 0, value: 0, hasPrice: price != null, players: {} });
                item.quantity += parsed.quantity;
                if (price != null) item.value += price * parsed.quantity;
                const p = item.players[parsed.actor] || (item.players[parsed.actor] = { name: parsed.actor, quantity: 0, value: 0 });
                p.quantity += parsed.quantity;
                if (price != null) p.value += price * parsed.quantity;
            }

            // Fold the 10-hits-per-xanax check directly into Xanax's own player list, over this
            // same [from, to] window (not tied to picking a specific war) — one less panel to
            // hunt down, per the leader's own feedback that Jimidy's tool shows it this way.
            const xanaxItem = Object.values(byItem).find(it => /^xanax$/i.test(it.item));
            let warHitsMeta = null;
            if (xanaxItem) {
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

            const categoriesMap = {};
            for (const it of Object.values(byItem)) {
                const cat = categoriesMap[it.category] || (categoriesMap[it.category] = { category: it.category, quantity: 0, value: 0, items: [] });
                cat.quantity += it.quantity;
                cat.value += it.value;
                cat.items.push({ ...it, players: Object.values(it.players).sort((a, b) => b.quantity - a.quantity) });
            }
            const categories = Object.values(categoriesMap);
            for (const c of categories) c.items.sort((a, b) => b.value - a.value);
            categories.sort((a, b) => b.value - a.value);
            const grandTotal = categories.reduce((s, c) => s + c.value, 0);

            // Shopping-list-only derived lines — things that don't themselves get "used" as
            // consumption, but are what actually needs restocking as a result of it. Right now
            // just the one: every type-specific full blood bag used started life as one plain
            // "Empty Blood Bag" a member filled, so that's the real restock number, not the
            // (untracked) empty bag's own usage.
            const shoppingExtras = [];
            const bloodBagQty = Object.values(byItem)
                .filter(it => BLOOD_BAG_RE.test(it.item))
                .reduce((s, it) => s + it.quantity, 0);
            if (bloodBagQty > 0) {
                const price = catalog['empty blood bag']?.price ?? null;
                shoppingExtras.push({ category: 'Blood Bags', item: 'Empty Blood Bag', quantity: bloodBagQty, value: price != null ? price * bloodBagQty : 0, hasPrice: price != null });
            }

            return res.status(200).json({
                categories, grandTotal, shoppingExtras, warHitsMeta,
                meta: { entriesScanned: newsResult.entries.length, pagesFetched: newsResult.pagesFetched, rateLimited: newsResult.rateLimited, unparsedCount, unparsedSample },
            });
        }

        return res.status(400).json({ error: 'Unknown action' });
    } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
    }
};
