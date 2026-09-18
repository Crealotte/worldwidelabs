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
            const result = {
                config: data ? { startDate: data.startDate, days: data.days } : null,
                mine,
            };
            if (await isLeader(key)) {
                // Aggregate per slot: how many, and who — leaders want to actually act on this,
                // not just see a number.
                const summary = {};
                for (const [id, entry] of Object.entries(data?.entries || {})) {
                    for (const slot of Object.keys(entry.slots || {})) {
                        const s = summary[slot] || (summary[slot] = { count: 0, names: [] });
                        s.count++;
                        s.names.push(entry.name || `#${id}`);
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

        if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });

        // Starts a fresh tracker for the newly-matched war — wipes any previous entries, since
        // this is meant to answer "who's around for THIS war", not accumulate forever. days is
        // capped generously (a war dragging a day or two past a normal weekend is expected; this
        // just guards against a fat-fingered huge number blowing up the grid).
        if (action === 'availability-start') {
            const { startDate, days } = req.body;
            const dayCount = Math.min(14, Math.max(1, Number(days) || 5));
            if (!startDate) return res.status(400).json({ error: 'Missing startDate' });
            await redis(['SET', availabilityKey(factionId), JSON.stringify({ startDate, days: dayCount, entries: {} })]);
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
