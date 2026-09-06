// api/armory-tracker.js — WorldWideLabs Consumption Tracker.
// Parses Torn's faction armory news feed (deposits/uses/loans/returns — no structured JSON for
// this, only human-readable sentences, same situation as api/respect.js's attacknews parsing) into
// a running per-faction log, using lib/armoryNewsParser.js for the actual text-to-event work.
//
// Endpoint risk worth flagging: "armorynews" is used here as a v1 selection (faction/?selections=
// armorynews), matching the naming convention of the already-proven attacknews/attacksfull calls
// in api/respect.js. This has NOT been verified against a live key — if it 404s/errors, or if real
// entries don't match lib/armoryNewsParser.js's patterns, `sync` surfaces that as unparsed/error
// counts rather than silently losing data, so a leader running this for the first time can tell
// something needs adjusting and report back what a real entry looks like.
//
// POST { key, action: 'sync' }                          -> leader-only: pulls recent armory news,
//                                                            parses, dedupes, appends to the log
// POST { key, action: 'deep-sync' }                      -> leader-only: walks further back in time
// POST { key, action: 'get-log' }                        -> leader-only: full stored event log
// POST { key, action: 'current-loans' }                  -> leader-only: live faction/armor snapshot
//                                                            of outstanding temp-weapon loans + $ value
// POST { key, action: 'list-wars' }                      -> leader-only: past ranked wars (for xanax-check)
// POST { key, action: 'xanax-check', warStart, warEnd }  -> leader-only: xanax taken vs war hits landed
// POST { key, action: 'shopping-list', from, to }        -> leader-only: items consumed in a date range

const { parseArmoryNewsEntry } = require('../lib/armoryNewsParser');
const { fetchWarHits } = require('../lib/warHits');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function isRateLimited(data) {
    return data?.error?.code === 5 || /too many requests/i.test(data?.error?.error || '');
}

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

const eventsKey = (factionId) => `wwl:armory-events:${factionId}`;
const seenKey = (factionId) => `wwl:armory-seen:${factionId}`;
const unparsedKey = (factionId) => `wwl:armory-unparsed:${factionId}`;
const deepCursorKey = (factionId) => `wwl:armory-deep-cursor:${factionId}`;
const MAX_STORED_EVENTS = 3000; // keep the log bounded — oldest entries drop off, newest always kept
const MAX_STORED_UNPARSED = 30; // just enough of a sample to diagnose a bad pattern

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

// One page of armorynews -> parsed, deduped, appended to the stored log. Shared by sync/deep-sync.
async function syncPage(factionId, newsEntries) {
    const eventsRaw = await redis(['GET', eventsKey(factionId)]);
    const events = eventsRaw ? JSON.parse(eventsRaw) : [];
    const unparsedRaw = await redis(['GET', unparsedKey(factionId)]);
    const unparsed = unparsedRaw ? JSON.parse(unparsedRaw) : [];

    let synced = 0, unparsedCount = 0, oldestSeen = null;
    for (const [id, entry] of Object.entries(newsEntries)) {
        const ts = entry.timestamp;
        if (ts && (oldestSeen === null || ts < oldestSeen)) oldestSeen = ts;
        const added = await redis(['SADD', seenKey(factionId), id]);
        if (added !== 1) continue; // already processed
        const parsed = parseArmoryNewsEntry(id, entry);
        if (parsed.unparsed) {
            unparsedCount++;
            if (unparsed.length < MAX_STORED_UNPARSED) unparsed.push(parsed);
            continue;
        }
        events.push(parsed);
        synced++;
    }
    events.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const trimmed = events.slice(0, MAX_STORED_EVENTS);
    await redis(['SET', eventsKey(factionId), JSON.stringify(trimmed)]);
    if (unparsed.length) await redis(['SET', unparsedKey(factionId), JSON.stringify(unparsed)]);
    return { synced, unparsedCount, oldestSeen, totalAvailable: Object.keys(newsEntries).length };
}

module.exports = async function handler(req, res) {
    try {
        if (!REDIS_URL || !REDIS_TOKEN) {
            return res.status(500).json({ error: 'Database not connected. In Vercel: Storage -> Create Database -> Upstash Redis, and connect it to this project.' });
        }
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const { key, action } = req.body || {};
        if (!key) return res.status(400).json({ error: 'Missing key' });

        const factionId = await getFactionId(key);
        if (!factionId) return res.status(403).json({ error: 'Could not determine your faction from this key' });
        if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });

        if (action === 'sync') {
            const now = Math.floor(Date.now() / 1000);
            const r = await fetch(`https://api.torn.com/faction/?selections=armorynews&from=0&to=${now}&key=${encodeURIComponent(key)}`);
            const data = await r.json();
            if (data.error) return res.status(403).json({ error: data.error.error });
            const result = await syncPage(factionId, data.armorynews || {});
            return res.status(200).json(result);
        }

        if (action === 'deep-sync') {
            const cursorRaw = await redis(['GET', deepCursorKey(factionId)]);
            let to = cursorRaw ? Number(cursorRaw) : Math.floor(Date.now() / 1000);
            const maxPages = 10;
            let totalSynced = 0, totalUnparsed = 0, pagesFetched = 0, rateLimited = false, stopReason = 'max-pages';
            for (let page = 0; page < maxPages; page++) {
                if (page > 0) await sleep(1100);
                const r = await fetch(`https://api.torn.com/faction/?selections=armorynews&from=0&to=${to}&key=${encodeURIComponent(key)}`);
                const data = await r.json();
                if (data.error) {
                    if (isRateLimited(data)) rateLimited = true;
                    stopReason = `torn-error: ${data.error.error || data.error.code}`;
                    break;
                }
                const entries = data.armorynews || {};
                if (!Object.keys(entries).length) { stopReason = 'empty-page'; break; }
                pagesFetched++;
                const result = await syncPage(factionId, entries);
                totalSynced += result.synced; totalUnparsed += result.unparsedCount;
                if (result.oldestSeen === null || result.oldestSeen >= to) { stopReason = 'no-progress'; break; }
                to = result.oldestSeen - 1;
                await redis(['SET', deepCursorKey(factionId), String(to)]);
            }
            return res.status(200).json({ synced: totalSynced, unparsedCount: totalUnparsed, pagesFetched, rateLimited, stopReason });
        }

        if (action === 'get-log') {
            const eventsRaw = await redis(['GET', eventsKey(factionId)]);
            const unparsedRaw = await redis(['GET', unparsedKey(factionId)]);
            return res.status(200).json({
                events: eventsRaw ? JSON.parse(eventsRaw) : [],
                unparsedSample: unparsedRaw ? JSON.parse(unparsedRaw) : [],
            });
        }

        if (action === 'current-loans') {
            const armorRes = await fetch(`https://api.torn.com/v2/faction/armor?key=${encodeURIComponent(key)}`,
                { headers: { accept: 'application/json' } });
            const armorData = await armorRes.json();
            if (armorData.error) return res.status(403).json({ error: armorData.error.error });
            const items = (armorData.armor || []).filter(i => Number(i.loaned) > 0);
            if (!items.length) return res.status(200).json({ loans: [] });

            const [membersRes, itemsRes] = await Promise.all([
                fetch(`https://api.torn.com/v2/faction/members?striptags=true&key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } }),
                fetch(`https://api.torn.com/torn/?selections=items&key=${encodeURIComponent(key)}`),
            ]);
            const membersData = await membersRes.json();
            const itemsData = await itemsRes.json();
            const nameById = {};
            for (const m of (membersData.members || [])) nameById[String(m.id)] = m.name;
            const priceById = {};
            for (const [id, it] of Object.entries(itemsData.items || {})) priceById[id] = it.market_value ?? null;

            const loans = items.map(i => {
                const holderIds = String(i.loaned_to || '').split(',').map(s => s.trim()).filter(Boolean);
                const holders = holderIds.map(id => nameById[id] || `#${id}`);
                const price = priceById[String(i.ID)] ?? null;
                return {
                    id: i.ID, name: i.name, type: i.type, loaned: Number(i.loaned),
                    holders, unitValue: price, totalValue: price != null ? price * Number(i.loaned) : null,
                };
            });
            return res.status(200).json({ loans });
        }

        if (action === 'list-wars') {
            const r = await fetch(`https://api.torn.com/v2/faction?selections=rankedwars&key=${encodeURIComponent(key)}`,
                { headers: { accept: 'application/json' } });
            const data = await r.json();
            if (data.error) return res.status(403).json({ error: data.error.error });
            const wars = Object.values(data.rankedwars || {});
            const list = wars.filter(w => w.end).map(w => {
                const us = (w.factions || []).find(f => String(f.id) === factionId);
                const them = (w.factions || []).find(f => String(f.id) !== factionId);
                return { id: w.id, start: w.start, end: w.end, them: them ? { name: them.name } : null, winner: w.winner, usId: us?.id };
            }).sort((a, b) => b.end - a.end);
            return res.status(200).json({ wars: list });
        }

        if (action === 'xanax-check') {
            const { warStart, warEnd } = req.body;
            if (!warStart || !warEnd) return res.status(400).json({ error: 'Pick a war first.' });

            const eventsRaw = await redis(['GET', eventsKey(factionId)]);
            const events = eventsRaw ? JSON.parse(eventsRaw) : [];
            const xanaxByName = {};
            for (const e of events) {
                if (e.action !== 'used') continue;
                if (!/xanax/i.test(e.item)) continue;
                if (e.timestamp < warStart || e.timestamp > warEnd) continue;
                xanaxByName[e.actor] = (xanaxByName[e.actor] || 0) + e.quantity;
            }

            const warHitsResult = await fetchWarHits(key, factionId, warStart, warEnd);
            const hitsByName = {};
            for (const entry of Object.values(warHitsResult.perAttacker)) {
                if (entry.name) hitsByName[entry.name] = (hitsByName[entry.name] || 0) + entry.count;
            }

            const names = new Set([...Object.keys(xanaxByName), ...Object.keys(hitsByName)]);
            const rows = [...names].map(name => {
                const xanaxTaken = xanaxByName[name] || 0;
                const hits = hitsByName[name] || 0;
                const required = xanaxTaken * 10;
                return { name, xanaxTaken, hits, required, shortfall: Math.max(0, required - hits) };
            }).sort((a, b) => b.shortfall - a.shortfall || b.xanaxTaken - a.xanaxTaken);

            return res.status(200).json({
                rows,
                meta: { warHitsScanned: warHitsResult.scanned, warHitsMatched: warHitsResult.ownAttacks, eventsScanned: events.length },
            });
        }

        if (action === 'shopping-list') {
            const { from, to } = req.body;
            if (!from || !to) return res.status(400).json({ error: 'Pick a date range first.' });
            const eventsRaw = await redis(['GET', eventsKey(factionId)]);
            const events = eventsRaw ? JSON.parse(eventsRaw) : [];
            const byItem = {};
            for (const e of events) {
                if (e.action !== 'used') continue;
                if (e.timestamp < from || e.timestamp > to) continue;
                byItem[e.item] = (byItem[e.item] || 0) + e.quantity;
            }
            const items = Object.entries(byItem).map(([item, quantity]) => ({ item, quantity })).sort((a, b) => b.quantity - a.quantity);
            return res.status(200).json({ items });
        }

        return res.status(400).json({ error: 'Unknown action' });
    } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
    }
};
