// api/respect.js — WorldWideLabs faction Respect Tracker.
// Total faction respect is a real, simple API field, so we snapshot it daily as the ground truth.
// Everything else is tracked from genuinely real sources, not guesswork:
//   - Organized Crimes: shared with OC Fit's existing tracking
//   - Chains: Torn's own per-chain respect totals, genuinely backfillable from history
//   - Hits: real per-attack respect_gain from faction:attacksfull, excluding chain-tagged
//     attacks (those are already counted under Chains) — this used to be a leftover guess,
//     now it's directly measured. One known imperfection, confirmed by the community: Torn's
//     own respect_gain field doesn't always populate reliably for losses (being attacked and
//     losing respect) — gains are solid, losses are spottier. Worth knowing, not fixable on our end.
//   - War: manually logged (not independently recoverable from any API source)
//   - Other/unaccounted: whatever's left after all of the above — territory, raids, dirty
//     bombs, or any data-quality gaps. Kept visible rather than hidden, so a big number here is
//     a signal something's off, not silently absorbed into "hits" and mislabeled.
//
// POST { key, action: 'snapshot' }                  -> leader-only: records today's total respect,
//                                                        and syncs any newly-completed OC/chains/hits
// POST { key, action: 'sync-oc' }                    -> leader-only: one-off sync of whatever OC
//                                                        history is currently visible
// POST { key, action: 'deep-sync-oc' }               -> leader-only: walks backward through time
//                                                        using Torn's own date-range filtering to
//                                                        pull real OC history beyond the current window
// POST { key, action: 'sync-chains' }                -> leader-only: one-off backfill of chain
//                                                        history — also runs automatically on snapshot
// POST { key, action: 'sync-hits' }                  -> leader-only: one-off backfill of recent
//                                                        attack history — also runs on snapshot
// POST { key, action: 'read' }                       -> anyone: full history + goal + daily breakdown
// POST { key, action: 'add-war-entry', date, amount, label } -> leader-only
// POST { key, action: 'remove-war-entry', id }       -> leader-only
// POST { key, action: 'set-goal', target, deadline, label }  -> leader-only
// POST { key, action: 'clear-goal' }                 -> leader-only

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

async function getFactionId(key) {
    const r = await fetch(`https://api.torn.com/user/?selections=profile&key=${encodeURIComponent(key)}`);
    const profile = await r.json();
    if (profile.error) return { error: profile.error.error || `Torn error code ${profile.error.code}` };
    if (!profile.faction?.faction_id) return { error: 'This key\'s account isn\'t in a faction right now' };
    return { factionId: String(profile.faction.faction_id) };
}
async function isLeader(key) {
    const r = await fetch(`https://api.torn.com/v2/faction/balance?key=${encodeURIComponent(key)}`,
        { headers: { accept: 'application/json' } });
    const d = await r.json();
    return !d.error;
}

const snapshotsKey = (factionId) => `wwl:respect-snapshots:${factionId}`;
const ocRewardsKey = (factionId) => `wwl:oc-rewards:${factionId}`; // shared with oc-fit.js
const ocSeenKey = (factionId) => `wwl:oc-rewards-seen:${factionId}`; // shared dedup with oc-fit.js (cumulative totals only)
const ocDailySeenKey = (factionId) => `wwl:oc-daily-seen:${factionId}`; // separate dedup, just for day-bucketing
const ocDailyKey = (factionId) => `wwl:oc-respect-daily:${factionId}`; // shared with oc-fit.js
const chainDailyKey = (factionId) => `wwl:chain-respect-daily:${factionId}`;
const chainSeenKey = (factionId) => `wwl:chain-respect-seen:${factionId}`;
const hitsDailyKey = (factionId) => `wwl:hits-respect-daily:${factionId}`;
const hitsSeenKey = (factionId) => `wwl:hits-respect-seen:${factionId}`;
const warEntriesKey = (factionId) => `wwl:war-respect:${factionId}`; // manual entries
const warBonusDailyKey = (factionId) => `wwl:war-bonus-daily:${factionId}`; // auto-tracked
const warBonusSeenKey = (factionId) => `wwl:war-bonus-seen:${factionId}`;
const chainWindowsKey = (factionId) => `wwl:chain-windows:${factionId}`; // for cross-referencing against attacks
const goalKey = (factionId) => `wwl:respect-goal:${factionId}`;

function todayKey() { return new Date().toISOString().slice(0, 10); }

function normScenario(name) {
    return (name || 'Unknown').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/\s+v\d+$/i, '').trim();
}

// Processes one page of crimes into the cumulative + daily stores. Shared between the regular
// (single-page, auto-triggered) sync and the deep multi-page backfill below.
async function processCrimesPage(crimesList, factionId, rewards, daily) {
    let synced = 0, rewardsChanged = false, dailyChanged = false, oldestSeen = null;
    for (const oc of crimesList) {
        if (!oc || !oc.executed_at) continue;
        if (oldestSeen === null || oc.executed_at < oldestSeen) oldestSeen = oc.executed_at;
        const status = (oc.status || '').toLowerCase();
        if (!['successful', 'failed', 'expired'].includes(status)) continue;

        // Cumulative totals — gated by the original dedup shared with oc-fit.js (unchanged).
        const addedCumulative = await redis(['SADD', ocSeenKey(factionId), String(oc.id)]);
        if (addedCumulative === 1) {
            const sKey = normScenario(oc.name);
            if (!rewards[sKey]) rewards[sKey] = { scenario: oc.name || sKey, difficulty: oc.difficulty ?? '?', totalMoney: 0, totalRespect: 0, successCount: 0, totalRuns: 0 };
            rewards[sKey].totalRuns++;
            if (status === 'successful') {
                rewards[sKey].successCount++;
                rewards[sKey].totalMoney += Number(oc.rewards?.money ?? 0);
                rewards[sKey].totalRespect += Number(oc.rewards?.respect ?? 0);
            }
            rewardsChanged = true;
        }

        // Daily bucket — its own independent dedup, so crimes already claimed by the older
        // cumulative-only tracking (before day-bucketing existed) still get backfilled here.
        if (status === 'successful') {
            const addedDaily = await redis(['SADD', ocDailySeenKey(factionId), String(oc.id)]);
            if (addedDaily === 1) {
                const dayKey = new Date(oc.executed_at * 1000).toISOString().slice(0, 10);
                daily[dayKey] = (daily[dayKey] || 0) + Number(oc.rewards?.respect ?? 0);
                dailyChanged = true;
                synced++;
            }
        }
    }
    return { synced, rewardsChanged, dailyChanged, oldestSeen };
}

// Captures completed-crime respect independently of OC Fit's own tracking, so the Respect
// Tracker doesn't depend on someone having visited Team Builder first. Shares the exact same
// "seen" dedup set as oc-fit.js, so whichever feature runs first claims each OC and the other
// just skips it — no double-counting between the two. Single page — whatever's currently live.
async function syncOc(key, factionId) {
    const r = await fetch(`https://api.torn.com/v2/faction?selections=crimes&key=${encodeURIComponent(key)}`,
        { headers: { accept: 'application/json' } });
    const data = await r.json();
    if (data.error) return { synced: 0, error: data.error.error };

    const crimesList = Object.values(data.crimes || {});
    const rewardsRaw = await redis(['GET', ocRewardsKey(factionId)]);
    const rewards = rewardsRaw ? JSON.parse(rewardsRaw) : {};
    const dailyRaw = await redis(['GET', ocDailyKey(factionId)]);
    const daily = dailyRaw ? JSON.parse(dailyRaw) : {};

    const result = await processCrimesPage(crimesList, factionId, rewards, daily);
    if (result.rewardsChanged) await redis(['SET', ocRewardsKey(factionId), JSON.stringify(rewards)]);
    if (result.dailyChanged) await redis(['SET', ocDailyKey(factionId), JSON.stringify(daily)]);
    return { synced: result.synced, totalAvailable: crimesList.length };
}

// Walks backward through time using Torn's "to" timestamp filter, pulling real historical OC
// pages beyond whatever's currently visible in a single live call — genuinely deeper backfill,
// not just "whatever's in the rolling window right now". Stops after a bounded number of pages
// (to keep this a reasonable one-click action rather than an unbounded crawl) or once a page
// contributes no new completions, whichever comes first.
async function deepSyncOc(key, factionId, maxPages = 15) {
    const rewardsRaw = await redis(['GET', ocRewardsKey(factionId)]);
    const rewards = rewardsRaw ? JSON.parse(rewardsRaw) : {};
    const dailyRaw = await redis(['GET', ocDailyKey(factionId)]);
    const daily = dailyRaw ? JSON.parse(dailyRaw) : {};

    let to = Math.floor(Date.now() / 1000);
    let totalSynced = 0, pagesFetched = 0, emptyPagesInARow = 0;

    for (let page = 0; page < maxPages; page++) {
        const r = await fetch(`https://api.torn.com/v2/faction?selections=crimes&to=${to}&key=${encodeURIComponent(key)}`,
            { headers: { accept: 'application/json' } });
        const data = await r.json();
        if (data.error) break;
        const crimesList = Object.values(data.crimes || {});
        if (!crimesList.length) break;
        pagesFetched++;

        const result = await processCrimesPage(crimesList, factionId, rewards, daily);
        totalSynced += result.synced;
        if (result.rewardsChanged) await redis(['SET', ocRewardsKey(factionId), JSON.stringify(rewards)]);
        if (result.dailyChanged) await redis(['SET', ocDailyKey(factionId), JSON.stringify(daily)]);

        if (result.oldestSeen === null || result.oldestSeen >= to) break; // no older data available, stop
        to = result.oldestSeen - 1;
        emptyPagesInARow = result.synced === 0 ? emptyPagesInARow + 1 : 0;
        if (emptyPagesInARow >= 3) break; // several pages of already-seen data — likely hit the edge
    }
    return { synced: totalSynced, pagesFetched };
}

// Pulls the faction's past chains (Torn keeps these with their own respect totals and end
// timestamps) and buckets any not-yet-counted ones by the day the chain ended — genuinely
// retroactive, unlike total respect, since this is real history Torn already retains.
async function syncChains(key, factionId) {
    const r = await fetch(`https://api.torn.com/faction/?selections=chains&key=${encodeURIComponent(key)}`);
    const data = await r.json();
    if (data.error) return { synced: 0, error: data.error.error };

    const chains = data.chains || {};
    const dailyRaw = await redis(['GET', chainDailyKey(factionId)]);
    const daily = dailyRaw ? JSON.parse(dailyRaw) : {};
    const windowsRaw = await redis(['GET', chainWindowsKey(factionId)]);
    const windows = windowsRaw ? JSON.parse(windowsRaw) : [];
    let synced = 0;
    for (const [chainId, chain] of Object.entries(chains)) {
        if (!chain.end || !chain.respect) continue;
        const added = await redis(['SADD', chainSeenKey(factionId), chainId]);
        if (added !== 1) continue; // already counted
        const dayKey = new Date(chain.end * 1000).toISOString().slice(0, 10);
        daily[dayKey] = (daily[dayKey] || 0) + Number(chain.respect);
        if (chain.start) windows.push({ start: chain.start, end: chain.end });
        synced++;
    }
    if (synced > 0) {
        await redis(['SET', chainDailyKey(factionId), JSON.stringify(daily)]);
        await redis(['SET', chainWindowsKey(factionId), JSON.stringify(windows)]);
    }
    return { synced, totalAvailable: Object.keys(chains).length };
}

// Pulls the faction's past ranked wars, then each war's detailed report for its own
// reward_respect field — the end-of-war bonus specifically, separate from all the individual
// hit respect gained during the war (that part's already covered by Chains and Hits above).
// Bucketed by the day the war ended. This is genuinely automatic — no more manually looking up
// and typing in a number after every war.
// Pulls the faction's past ranked wars, then each war's detailed report for its own
// rewards.respect field — the end-of-war bonus specifically, separate from all the individual
// hit respect gained during the war (that part's already covered by Chains and Hits above).
// Bucketed by the day the war ended. Confirmed against a real sample: `factions` is an object
// keyed by faction ID (e.g. {"51197": {...}}), and the bonus lives under factions[id].rewards.respect.
async function syncWarBonus(key, factionId) {
    const r = await fetch(`https://api.torn.com/v2/faction?selections=rankedwars&key=${encodeURIComponent(key)}`,
        { headers: { accept: 'application/json' } });
    const data = await r.json();
    if (data.error) return { synced: 0, error: data.error.error };

    const wars = Object.values(data.rankedwars || data.ranked_wars || {});
    const dailyRaw = await redis(['GET', warBonusDailyKey(factionId)]);
    const daily = dailyRaw ? JSON.parse(dailyRaw) : {};
    let synced = 0, skippedUnresolved = 0;
    for (const war of wars) {
        const warId = war.id || war.war_id;
        const endTs = war.war?.end || war.end;
        if (!warId || !endTs) continue; // still ongoing, or missing data

        // Check first, without marking anything — a failed/inconclusive extraction attempt
        // must NOT block a future retry once the field-matching logic gets fixed.
        const alreadySeen = await redis(['SISMEMBER', warBonusSeenKey(factionId), String(warId)]);
        if (alreadySeen === 1) continue;

        try {
            const reportRes = await fetch(`https://api.torn.com/torn/${warId}?selections=rankedwarreport&key=${encodeURIComponent(key)}`);
            const report = await reportRes.json();
            if (report.error) { skippedUnresolved++; continue; }
            const factions = report.rankedwarreport?.war?.factions || {};
            const mine = factions[factionId];
            const bonus = mine?.rewards?.respect != null ? Number(mine.rewards.respect) : null;
            if (bonus === null) { skippedUnresolved++; continue; } // couldn't find our side — don't mark as seen, retry later

            // Only mark as seen once we've genuinely resolved a value (even 0 counts as resolved).
            await redis(['SADD', warBonusSeenKey(factionId), String(warId)]);
            if (bonus > 0) {
                const dayKey = new Date(endTs * 1000).toISOString().slice(0, 10);
                daily[dayKey] = (daily[dayKey] || 0) + bonus;
                synced++;
            }
        } catch (e) { skippedUnresolved++; /* network hiccup — don't mark as seen, retry later */ }
    }
    if (synced > 0) await redis(['SET', warBonusDailyKey(factionId), JSON.stringify(daily)]);
    return { synced, totalAvailable: wars.length, skippedUnresolved };
}

// Processes one page of attacks. Shared between the regular single-page sync and the deep
// multi-page backfill below. attacksfull has no field marking chain membership (confirmed
// against a real sample — the "chain" field simply doesn't exist there), so instead this
// cross-references each attack's timestamp against known chain start/end windows to exclude
// anything already counted under Chains.
async function processAttacksPageAsync(attacks, factionId, daily, chainWindows) {
    let synced = 0, dailyChanged = false, oldestSeen = null;
    for (const [attackId, attack] of Object.entries(attacks)) {
        const ts = attack.timestamp_ended || attack.timestamp_started;
        if (ts && (oldestSeen === null || ts < oldestSeen)) oldestSeen = ts;
        const duringChain = chainWindows.some(w => ts >= w.start && ts <= w.end);
        if (duringChain) continue; // already counted under Chains
        const added = await redis(['SADD', hitsSeenKey(factionId), attackId]);
        if (added !== 1) continue; // already counted
        const respect = Number(attack.respect ?? attack.respect_gain ?? 0);
        if (!respect) continue; // known Torn quirk: losses don't always populate this — nothing to add either way
        const dayKey = new Date(ts * 1000).toISOString().slice(0, 10);
        daily[dayKey] = (daily[dayKey] || 0) + respect;
        dailyChanged = true;
        synced++;
    }
    return { synced, dailyChanged, oldestSeen };
}

// Pulls real per-attack respect from faction:attacksfull — one page (whatever's currently in
// Torn's rolling window of the most recent ~1000 attacks/defends). For a busy faction that window
// can be just a few hours, which is why a single sync often only catches a handful of a day's
// hits — use deepSyncHits below to page further back and get the rest.
async function syncHits(key, factionId) {
    const r = await fetch(`https://api.torn.com/faction/?selections=attacksfull&key=${encodeURIComponent(key)}`);
    const data = await r.json();
    if (data.error) return { synced: 0, error: data.error.error };

    const attacks = data.attacks || {};
    const dailyRaw = await redis(['GET', hitsDailyKey(factionId)]);
    const daily = dailyRaw ? JSON.parse(dailyRaw) : {};
    const windowsRaw = await redis(['GET', chainWindowsKey(factionId)]);
    const chainWindows = windowsRaw ? JSON.parse(windowsRaw) : [];
    const result = await processAttacksPageAsync(attacks, factionId, daily, chainWindows);
    if (result.dailyChanged) await redis(['SET', hitsDailyKey(factionId), JSON.stringify(daily)]);
    return { synced: result.synced, totalAvailable: Object.keys(attacks).length };
}

// Walks backward through time using Torn's "to" timestamp filter on attacksfull — since the
// rolling window can be as little as a few hours of activity for a busy faction, a single sync
// only ever sees a sliver of any given day. This pages back to actually capture full days,
// bounded to a reasonable number of pages per click.
async function deepSyncHits(key, factionId, maxPages = 15) {
    const dailyRaw = await redis(['GET', hitsDailyKey(factionId)]);
    const daily = dailyRaw ? JSON.parse(dailyRaw) : {};
    const windowsRaw = await redis(['GET', chainWindowsKey(factionId)]);
    const chainWindows = windowsRaw ? JSON.parse(windowsRaw) : [];

    let to = Math.floor(Date.now() / 1000);
    let totalSynced = 0, pagesFetched = 0, emptyPagesInARow = 0;

    for (let page = 0; page < maxPages; page++) {
        const r = await fetch(`https://api.torn.com/faction/?selections=attacksfull&to=${to}&key=${encodeURIComponent(key)}`);
        const data = await r.json();
        if (data.error) break;
        const attacks = data.attacks || {};
        if (!Object.keys(attacks).length) break;
        pagesFetched++;

        const result = await processAttacksPageAsync(attacks, factionId, daily, chainWindows);
        totalSynced += result.synced;
        if (result.dailyChanged) await redis(['SET', hitsDailyKey(factionId), JSON.stringify(daily)]);

        if (result.oldestSeen === null || result.oldestSeen >= to) break; // no older data available, stop
        to = result.oldestSeen - 1;
        emptyPagesInARow = result.synced === 0 ? emptyPagesInARow + 1 : 0;
        if (emptyPagesInARow >= 3) break; // several pages of already-seen data — likely hit the edge
    }
    return { synced: totalSynced, pagesFetched };
}

module.exports = async function handler(req, res) {
    try {
        if (!REDIS_URL || !REDIS_TOKEN) {
            return res.status(500).json({ error: 'Database not connected. In Vercel: Storage -> Create Database -> Upstash Redis, and connect it to this project.' });
        }
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

        const { key, action } = req.body || {};
        if (!key) return res.status(400).json({ error: 'Missing key' });

        const factionResult = await getFactionId(key);
        if (factionResult.error) return res.status(403).json({ error: `Could not check your faction right now: ${factionResult.error}` });
        const factionId = factionResult.factionId;

        if (action === 'read') {
            const [snapRaw, ocDailyRaw, chainDailyRaw, hitsDailyRaw, warBonusDailyRaw, warRaw, goalRaw] = await Promise.all([
                redis(['GET', snapshotsKey(factionId)]),
                redis(['GET', ocDailyKey(factionId)]),
                redis(['GET', chainDailyKey(factionId)]),
                redis(['GET', hitsDailyKey(factionId)]),
                redis(['GET', warBonusDailyKey(factionId)]),
                redis(['GET', warEntriesKey(factionId)]),
                redis(['GET', goalKey(factionId)]),
            ]);
            return res.status(200).json({
                snapshots: snapRaw ? JSON.parse(snapRaw) : {},
                ocDaily: ocDailyRaw ? JSON.parse(ocDailyRaw) : {},
                chainDaily: chainDailyRaw ? JSON.parse(chainDailyRaw) : {},
                hitsDaily: hitsDailyRaw ? JSON.parse(hitsDailyRaw) : {},
                warBonusDaily: warBonusDailyRaw ? JSON.parse(warBonusDailyRaw) : {},
                warEntries: warRaw ? JSON.parse(warRaw) : [],
                goal: goalRaw ? JSON.parse(goalRaw) : null,
            });
        }

        // Everything below is leaders only.
        if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });

        if (action === 'sync-chains') {
            const result = await syncChains(key, factionId);
            if (result.error) return res.status(403).json({ error: result.error });
            return res.status(200).json({ ok: true, synced: result.synced, totalAvailable: result.totalAvailable });
        }

        if (action === 'sync-war-bonus') {
            const result = await syncWarBonus(key, factionId);
            if (result.error) return res.status(403).json({ error: result.error });
            return res.status(200).json({ ok: true, synced: result.synced, totalAvailable: result.totalAvailable, skippedUnresolved: result.skippedUnresolved });
        }

        if (action === 'sync-hits') {
            const result = await syncHits(key, factionId);
            if (result.error) return res.status(403).json({ error: result.error });
            return res.status(200).json({ ok: true, synced: result.synced, totalAvailable: result.totalAvailable });
        }

        if (action === 'deep-sync-hits') {
            const result = await deepSyncHits(key, factionId);
            return res.status(200).json({ ok: true, synced: result.synced, pagesFetched: result.pagesFetched });
        }

        if (action === 'reset-hits-tracking') {
            // Anything synced before the chain-window fix could be double-counted with Chains
            // (attacksfull has no chain field, so the old filter silently did nothing). This
            // wipes both the daily totals and the dedup set so it rebuilds cleanly.
            await redis(['DEL', hitsDailyKey(factionId)]);
            await redis(['DEL', hitsSeenKey(factionId)]);
            return res.status(200).json({ ok: true });
        }

        if (action === 'sync-oc') {
            const result = await syncOc(key, factionId);
            if (result.error) return res.status(403).json({ error: result.error });
            return res.status(200).json({ ok: true, synced: result.synced, totalAvailable: result.totalAvailable });
        }

        if (action === 'deep-sync-oc') {
            const result = await deepSyncOc(key, factionId);
            return res.status(200).json({ ok: true, synced: result.synced, pagesFetched: result.pagesFetched });
        }

        if (action === 'snapshot') {
            const r = await fetch(`https://api.torn.com/faction/?selections=basic&key=${encodeURIComponent(key)}`);
            const data = await r.json();
            if (data.error) return res.status(403).json({ error: data.error.error || 'Could not read faction respect' });
            const totalRespect = data.respect ?? data.faction?.respect ?? null;
            if (totalRespect == null) return res.status(500).json({ error: 'Faction respect field not found in response' });

            const raw = await redis(['GET', snapshotsKey(factionId)]);
            const snapshots = raw ? JSON.parse(raw) : {};
            snapshots[todayKey()] = totalRespect;
            await redis(['SET', snapshotsKey(factionId), JSON.stringify(snapshots)]);

            // Piggyback OC, chain, hit, and war-bonus syncing onto every snapshot, so everything
            // stays current automatically without needing a separate visit to any other page.
            await syncOc(key, factionId).catch(() => {});
            await syncChains(key, factionId).catch(() => {});
            await syncHits(key, factionId).catch(() => {});
            await syncWarBonus(key, factionId).catch(() => {});

            return res.status(200).json({ ok: true, totalRespect });
        }

        if (action === 'add-war-entry') {
            const { date, amount, label } = req.body;
            if (!date || amount == null) return res.status(400).json({ error: 'Missing date or amount' });
            const raw = await redis(['GET', warEntriesKey(factionId)]);
            const entries = raw ? JSON.parse(raw) : [];
            entries.push({ id: String(Date.now()), date, amount: Number(amount), label: label || 'War', addedAt: Date.now() });
            await redis(['SET', warEntriesKey(factionId), JSON.stringify(entries)]);
            return res.status(200).json({ ok: true });
        }

        if (action === 'remove-war-entry') {
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: 'Missing id' });
            const raw = await redis(['GET', warEntriesKey(factionId)]);
            const entries = (raw ? JSON.parse(raw) : []).filter(e => e.id !== id);
            await redis(['SET', warEntriesKey(factionId), JSON.stringify(entries)]);
            return res.status(200).json({ ok: true });
        }

        if (action === 'set-goal') {
            const { target, deadline, label } = req.body;
            if (!target) return res.status(400).json({ error: 'Missing target' });
            await redis(['SET', goalKey(factionId), JSON.stringify({ target: Number(target), deadline: deadline || null, label: label || 'Respect goal', setAt: Date.now() })]);
            return res.status(200).json({ ok: true });
        }

        if (action === 'clear-goal') {
            await redis(['DEL', goalKey(factionId)]);
            return res.status(200).json({ ok: true });
        }

        if (action === 'reset-war-bonus-tracking') {
            // The first version of syncWarBonus marked wars as "seen" before confirming
            // extraction actually worked, so any war checked before this fix is stuck as
            // permanently skipped. This wipes that dedup set (not the daily totals already
            // saved) so the fixed logic gets a genuine first attempt at every war.
            await redis(['DEL', warBonusSeenKey(factionId)]);
            return res.status(200).json({ ok: true });
        }

        return res.status(400).json({ error: 'Unknown action' });
    } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
    }
};
