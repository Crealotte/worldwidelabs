// api/respect.js — WorldWideLabs faction Respect Tracker.
// Daily totals are built entirely from real, individually-tracked sources — no snapshot-diffing
// against Torn's total respect field. That was tried first and reported as unreliable/inconsistent
// day to day, so it's gone: every day's total is simply the sum of what's actually been measured.
//   - Organized Crimes: shared with OC Fit's existing tracking
//   - Chains: Torn's own per-chain respect totals, genuinely backfillable from history
//   - Hits: real per-attack respect from faction:attacksfull for our own outgoing attacks
//   - Losses: exact per-event loss figures parsed from faction:attacknews, for when we're attacked
//   - War: auto-tracked from each ranked war's own report, plus a manual log as a fallback/supplement
// A real tradeoff of dropping the snapshot comparison: genuinely untracked respect sources
// (territory, raids, etc.) that used to surface via an "Other" column are no longer visible —
// but a wrong number was worse than a missing one.
//
// POST { key, action: 'snapshot' }                  -> leader-only: fetches the current live total
//                                                        respect (for the Goal panel's progress bar
//                                                        only, not stored as daily history), and
//                                                        triggers all the auto-syncing below
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
// POST { key, action: 'set-goal', target, deadline, label }  -> leader-only: adds a new goal
//                                                                to the list (multiple goals supported)
// POST { key, action: 'remove-goal', id }                    -> leader-only

const { tornFetch } = require('../lib/tornFetch');
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// Torn's rate limit error is error code 5. Distinguishing this from other failures matters:
// a multi-page backfill that gets rate-limited partway through should say so honestly, not
// silently report whatever partial data it gathered as if it were the complete picture.
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

async function getFactionId(key) {
    const r = await tornFetch(`https://api.torn.com/user/?selections=profile&key=${encodeURIComponent(key)}`);
    const profile = await r.json();
    if (profile.error) return { error: profile.error.error || `Torn error code ${profile.error.code}` };
    if (!profile.faction?.faction_id) return { error: 'This key\'s account isn\'t in a faction right now' };
    return { factionId: String(profile.faction.faction_id) };
}
async function isLeader(key) {
    const r = await tornFetch(`https://api.torn.com/v2/faction/balance?key=${encodeURIComponent(key)}`,
        { headers: { accept: 'application/json' } });
    const d = await r.json();
    return !d.error;
}

const ocRewardsKey = (factionId) => `wwl:oc-rewards:${factionId}`; // shared with oc-fit.js
const ocSeenKey = (factionId) => `wwl:oc-rewards-seen:${factionId}`; // shared dedup with oc-fit.js (cumulative totals only)
const ocDailySeenKey = (factionId) => `wwl:oc-daily-seen:${factionId}`; // separate dedup, just for day-bucketing
const ocDailyKey = (factionId) => `wwl:oc-respect-daily:${factionId}`; // shared with oc-fit.js
const chainDailyKey = (factionId) => `wwl:chain-respect-daily:${factionId}`;
const chainSeenKey = (factionId) => `wwl:chain-respect-seen:${factionId}`;
const hitsDailyKey = (factionId) => `wwl:hits-respect-daily:${factionId}`;
const hitsSeenKey = (factionId) => `wwl:hits-respect-seen:${factionId}`;
const lossesSeenKey = (factionId) => `wwl:losses-respect-seen:${factionId}`;
const warEntriesKey = (factionId) => `wwl:war-respect:${factionId}`; // manual entries
const warBonusDailyKey = (factionId) => `wwl:war-bonus-daily:${factionId}`; // auto-tracked
const warBonusSeenKey = (factionId) => `wwl:war-bonus-seen:${factionId}`;
const warBonusEntriesKey = (factionId) => `wwl:war-bonus-entries:${factionId}`; // [{ warId, end, bonus, won }] — per-war, for the effort calculator's win/loss split (warBonusDaily above is day-summed only, loses which war each bonus came from)
const rankUpCheckedKey = (factionId) => `wwl:rankup-checked:${factionId}`; // SET of warIds already checked for their rank-change news line, so a war already resolved (found or genuinely not found) isn't re-checked forever
const warHitsCheckedKey = (factionId) => `wwl:warhits-checked:${factionId}`; // SET of warIds already checked for their real hit count (lib/warHits.js), for the effort calculator's score-per-hit calibration
const goalKey = (factionId) => `wwl:respect-goal:${factionId}`;

// Goals used to be stored as a single object ({target, deadline, label}) before multiple goals
// were supported. Any faction that set a goal before that migration still has that old shape
// sitting in Redis — parsing it and calling .push()/.filter() on it throws, since it's a plain
// object, not an array. This migrates it into the new array format transparently.
function normalizeGoals(raw) {
    if (!raw) return [];
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return []; }
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object' && parsed.target != null) {
        return [{ id: Math.random().toString(36).slice(2, 10), ...parsed }];
    }
    return [];
}


function todayKey() { return new Date().toISOString().slice(0, 10); }

// ---- Torn's real chain-bonus formula, for the Effort Calculator ----
// respect per hit = base(target level) * chainScale(hit position) * Fair Fight. chainScale is flat at
// 1.00 for the first 10 hits, then climbs on a log curve for the rest of the chain — this (not a flat
// rate) is why a hit late in a long chain earns more respect than an early one, and why a 1500-hit
// chain earns more respect PER HIT on average than a 1000-hit one. Milestone bonuses (10/25/50/100/
// 250/500/1000/2500/5000/10000/25000/50000/100000) are flat, one-off amounts that double at each step
// (10, 20, 40, 80, ... 40960). Cross-checked against community documentation of the official mechanic.
const CHAIN_MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
const chainScale = hit => (hit <= 10 ? 1 : 0.25 * Math.log10(hit) + 0.75);
function chainScaleSum(length) {
    const L = Math.max(0, Math.floor(length));
    if (!L) return 0;
    let sum = Math.min(L, 10);
    for (let h = 11; h <= L; h++) sum += chainScale(h);
    return sum;
}
function milestoneBonusSum(length) {
    let sum = 0;
    CHAIN_MILESTONES.forEach((m, i) => { if (length >= m) sum += 10 * Math.pow(2, i); });
    return sum;
}

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
    const r = await tornFetch(`https://api.torn.com/v2/faction?selections=crimes&key=${encodeURIComponent(key)}`,
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
const ocDeepCursorKey = (factionId) => `wwl:oc-deep-cursor:${factionId}`;

async function deepSyncOc(key, factionId, maxPages = 15) {
    const rewardsRaw = await redis(['GET', ocRewardsKey(factionId)]);
    const rewards = rewardsRaw ? JSON.parse(rewardsRaw) : {};
    const dailyRaw = await redis(['GET', ocDailyKey(factionId)]);
    const daily = dailyRaw ? JSON.parse(dailyRaw) : {};

    // Resume from wherever the last click left off, rather than starting over from "now" every
    // time — restarting from the top meant every fresh click just re-walked the same already-seen
    // recent pages (finding nothing new there) and gave up before ever reaching older territory.
    const cursorRaw = await redis(['GET', ocDeepCursorKey(factionId)]);
    let to = cursorRaw ? Number(cursorRaw) : Math.floor(Date.now() / 1000);
    let totalSynced = 0, pagesFetched = 0, emptyPagesInARow = 0, rateLimited = false, stopReason = 'max-pages';

    for (let page = 0; page < maxPages; page++) {
        if (page > 0) await sleep(1100); // stay well clear of Torn's rate limit across a multi-page loop
        const r = await tornFetch(`https://api.torn.com/v2/faction?selections=crimes&to=${to}&key=${encodeURIComponent(key)}`,
            { headers: { accept: 'application/json' } });
        const data = await r.json();
        if (data.error) {
            if (isRateLimited(data)) rateLimited = true;
            stopReason = `torn-error: ${data.error.error || data.error.code}`;
            break;
        }
        const crimesList = Object.values(data.crimes || {});
        if (!crimesList.length) { stopReason = 'empty-page (Torn returned no crimes at this point in time)'; break; }
        pagesFetched++;

        const result = await processCrimesPage(crimesList, factionId, rewards, daily);
        totalSynced += result.synced;
        if (result.rewardsChanged) await redis(['SET', ocRewardsKey(factionId), JSON.stringify(rewards)]);
        if (result.dailyChanged) await redis(['SET', ocDailyKey(factionId), JSON.stringify(daily)]);

        if (result.oldestSeen === null || result.oldestSeen >= to) { stopReason = 'no-progress (oldest crime on this page wasn\'t older than the last page)'; break; }
        to = result.oldestSeen - 1;
        await redis(['SET', ocDeepCursorKey(factionId), String(to)]); // save progress after every page, not just at the end
        emptyPagesInARow = result.synced === 0 ? emptyPagesInARow + 1 : 0;
        if (emptyPagesInARow >= 3) { stopReason = '3-empty-pages-in-a-row (everything on these pages was already tracked)'; break; }
    }
    return { synced: totalSynced, pagesFetched, rateLimited, stopReason };
}

// Pulls the faction's past chains (Torn keeps these with their own respect totals and end
// timestamps) and buckets any not-yet-counted ones by the day the chain ended — genuinely
// retroactive, unlike total respect, since this is real history Torn already retains.
async function syncChains(key, factionId) {
    const r = await tornFetch(`https://api.torn.com/faction/?selections=chains&key=${encodeURIComponent(key)}`);
    const data = await r.json();
    if (data.error) return { synced: 0, error: data.error.error };

    const chains = data.chains || {};
    const dailyRaw = await redis(['GET', chainDailyKey(factionId)]);
    const daily = dailyRaw ? JSON.parse(dailyRaw) : {};
    let synced = 0;
    for (const [chainId, chain] of Object.entries(chains)) {
        if (!chain.end || !chain.respect) continue;
        const added = await redis(['SADD', chainSeenKey(factionId), chainId]);
        if (added !== 1) continue; // already counted
        const dayKey = new Date(chain.end * 1000).toISOString().slice(0, 10);
        daily[dayKey] = (daily[dayKey] || 0) + Number(chain.respect);
        synced++;
    }
    if (synced > 0) await redis(['SET', chainDailyKey(factionId), JSON.stringify(daily)]);
    return { synced, totalAvailable: Object.keys(chains).length };
}

// Pulls the faction's past ranked wars, then each war's detailed report for its own
// reward_respect field — the end-of-war bonus specifically, separate from all the individual
// hit respect gained during the war (that part's already covered by Chains and Hits above).
// Bucketed by the day the war ended. This is genuinely automatic — no more manually looking up
// and typing in a number after every war.
// Pulls the faction's past ranked wars, then each war's detailed report for its own
// rewards.respect field turned out NOT to be the real "war bonus" a member actually sees (or isn't
// reliably present) — the real, always-present source is the rank change itself: Torn posts "X ranked
// up/down from A to B and received N bonus respect, ..." as its own faction news line the moment the
// war resolves (confirmed against two real examples, one showing the exact same timestamp as the
// war's own "defeated ... in a ranked war" result line). Every war ends in a rank change one way or
// the other — up on a win, down on a loss — so this always exists, unlike rewards.respect which this
// used to rely on. Bucketed by the day it posted.
async function syncWarBonus(key, factionId) {
    const r = await tornFetch(`https://api.torn.com/v2/faction?selections=rankedwars&key=${encodeURIComponent(key)}`,
        { headers: { accept: 'application/json' } });
    const data = await r.json();
    if (data.error) return { synced: 0, error: data.error.error };

    const wars = Object.values(data.rankedwars || data.ranked_wars || {});
    const dailyRaw = await redis(['GET', warBonusDailyKey(factionId)]);
    const daily = dailyRaw ? JSON.parse(dailyRaw) : {};
    const entriesRaw = await redis(['GET', warBonusEntriesKey(factionId)]);
    const entries = entriesRaw ? JSON.parse(entriesRaw) : [];
    const entriesStartLength = entries.length;
    let synced = 0, skippedUnresolved = 0, rateLimited = false, fetchedCount = 0, warHitsFetchedCount = 0;
    for (const war of wars) {
        const warId = war.id || war.war_id;
        const startTs = war.war?.start || war.start;
        const endTs = war.war?.end || war.end;
        if (!warId || !endTs) continue; // still ongoing, or missing data

        // Check first, without marking anything — a failed/inconclusive extraction attempt
        // must NOT block a future retry once the field-matching logic gets fixed.
        const alreadySeen = await redis(['SISMEMBER', warBonusSeenKey(factionId), String(warId)]);
        if (alreadySeen === 1) continue;

        if (fetchedCount > 0) await sleep(1100); // one Torn call per war here — stay well clear of rate limits
        fetchedCount++;
        try {
            const reportRes = await tornFetch(`https://api.torn.com/torn/${warId}?selections=rankedwarreport&key=${encodeURIComponent(key)}`);
            const report = await reportRes.json();
            if (report.error) {
                if (isRateLimited(report)) { rateLimited = true; break; } // stop rather than burn through the rest
                skippedUnresolved++; continue;
            }
            const factions = report.rankedwarreport?.war?.factions || {};
            const mine = factions[factionId];

            // Final scores from this same report — no extra API call for these. Kept (not just win/loss)
            // so the Effort Calculator can show real past war scores as a reference — Torn's own
            // target-score formula isn't published anywhere, so a real example beats a guessed one.
            // `won` here is a fallback only; the rank-change news below (when found) overrides it, since
            // that's Torn's own explicit statement rather than a score comparison this code is doing itself.
            const them = Object.entries(factions).find(([id]) => id !== String(factionId))?.[1];
            const scoreUs = mine?.score != null ? Number(mine.score) : null;
            const scoreThem = them?.score != null ? Number(them.score) : null;
            let won = (scoreUs != null && scoreThem != null) ? scoreUs > scoreThem : null;

            // This war's own real hit count (from Torn's attack log, same source the War Payout
            // Calculator uses — see lib/warHits.js), paired with scoreUs above, is what lets the Effort
            // Calculator back out a real "score per hit" for this faction's usual matchups, instead of
            // guessing at Torn's undocumented target-score formula. Capped to a couple of NEW wars per
            // sync (it pages through the whole war's attack log, the most expensive single step here) —
            // any backlog just gets picked up a war or two at a time on later visits.
            let warHits = null;
            if (startTs && warHitsFetchedCount < 2) {
                const alreadyCheckedHits = await redis(['SISMEMBER', warHitsCheckedKey(factionId), String(warId)]);
                if (alreadyCheckedHits !== 1) {
                    warHitsFetchedCount++;
                    await sleep(1100);
                    try {
                        const hitsResult = await fetchWarHits(key, factionId, startTs, endTs);
                        if (!hitsResult.rateLimited) {
                            warHits = hitsResult.ownAttacks || 0;
                            await redis(['SADD', warHitsCheckedKey(factionId), String(warId)]);
                        } else { rateLimited = true; }
                    } catch (e) { /* network hiccup — not marked checked, retried later */ }
                }
            }

            // The real war bonus: read from the rank-change news line right around this war's end,
            // rather than the report's own rewards.respect (see the function comment above for why).
            // No documented news category for this line, so it reads general news in a narrow window
            // and matches the exact wording instead of guessing a cat= value that might return nothing.
            let bonus = null, newsCheckOk = false;
            const alreadyCheckedBonus = await redis(['SISMEMBER', rankUpCheckedKey(factionId), String(warId)]);
            if (alreadyCheckedBonus === 1) {
                newsCheckOk = true; // already resolved on a previous sync — this war just needs its entry recorded now
            } else {
                await sleep(1100);
                try {
                    const newsRes = await tornFetch(`https://api.torn.com/v2/faction/news?striptags=true&limit=20&sort=ASC&from=${endTs - 30}&to=${endTs + 600}&key=${encodeURIComponent(key)}`,
                        { headers: { accept: 'application/json' } });
                    const newsData = await newsRes.json();
                    if (!newsData.error) {
                        const list = Array.isArray(newsData.news) ? newsData.news : Object.values(newsData.news || {});
                        for (const item of list) {
                            const text = String(item.text ?? item.news ?? '');
                            const m = /ranked (up|down) from .+? to .+? and received ([\d,]+) bonus respect/i.exec(text);
                            if (!m) continue;
                            bonus = Number(m[2].replace(/,/g, ''));
                            won = m[1].toLowerCase() === 'up'; // Torn's own word for it, more reliable than comparing scores ourselves
                        }
                        newsCheckOk = true; // the read itself succeeded — even finding nothing is a resolved answer, not a failure to retry
                        await redis(['SADD', rankUpCheckedKey(factionId), String(warId)]);
                    } else if (isRateLimited(newsData)) { rateLimited = true; }
                } catch (e) { /* network hiccup — newsCheckOk stays false, whole war retried next sync */ }
            }
            if (!newsCheckOk) { skippedUnresolved++; continue; } // don't mark seen or record yet — try again next sync

            // Only mark as seen once genuinely resolved (even a real "no bonus found" counts).
            await redis(['SADD', warBonusSeenKey(factionId), String(warId)]);
            if (bonus > 0) {
                const dayKey = new Date(endTs * 1000).toISOString().slice(0, 10);
                daily[dayKey] = (daily[dayKey] || 0) + bonus;
                synced++;
            }
            // Recorded whenever a war resolves at all (even a null/0 bonus) — the start/end window is
            // also how the calculator tells a "war chain" (hits mostly at war's 2x rate) from a "peace
            // chain", and warHits/scores feed the score-per-hit calibration and the score reference list.
            entries.push({ warId: String(warId), start: startTs || null, end: endTs, bonus: bonus || 0, won, scoreUs, scoreThem, warHits });
        } catch (e) { skippedUnresolved++; /* network hiccup — don't mark as seen, retry later */ }
    }
    if (synced > 0) await redis(['SET', warBonusDailyKey(factionId), JSON.stringify(daily)]);
    if (entries.length > entriesStartLength) {
        // Kept for the effort calculator's win/loss split — a faction's real war count stays small,
        // so this never needs aggressive trimming, but capped anyway against runaway growth.
        await redis(['SET', warBonusEntriesKey(factionId), JSON.stringify(entries.slice(-300))]);
    }
    return { synced, totalAvailable: wars.length, skippedUnresolved, rateLimited };
}

// Processes one page of attacks. Shared between the regular single-page sync and the deep
// multi-page backfill below. Only counts OUR OWN outgoing attacks (attacker_faction === us) —
// attacksfull's "respect" field is always the attacker's own gain, so for our outgoing attacks
// it's directly correct across every result type (Mugged, Hospitalized, Attacked, etc.).
// Two things this deliberately does NOT do, after reconsidering both against real data:
//   - No chain-window exclusion. Chain completion bonuses (the "Chains" category) are a separate
//     milestone reward on top of each hit's own respect, not an aggregate replacing it — excluding
//     hits during a chain window would incorrectly remove real respect, not prevent double-counting.
//   - No defender-side loss estimate. Guessing 25% of the attacker's gain was never verified and
//     is being replaced by attacknews's own exact computed loss figure (see syncLosses below).
async function processAttacksPageAsync(attacks, factionId, daily) {
    let synced = 0, dailyChanged = false, oldestSeen = null;
    for (const [attackId, attack] of Object.entries(attacks)) {
        const ts = attack.timestamp_ended || attack.timestamp_started;
        if (ts && (oldestSeen === null || ts < oldestSeen)) oldestSeen = ts;
        if (String(attack.attacker_faction) !== factionId) continue; // not our own outgoing attack
        const added = await redis(['SADD', hitsSeenKey(factionId), attackId]);
        if (added !== 1) continue; // already counted
        const respect = Number(attack.respect ?? attack.respect_gain ?? 0);
        if (!respect) continue; // a loss gives 0 respect — nothing to add

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
    const r = await tornFetch(`https://api.torn.com/faction/?selections=attacksfull&key=${encodeURIComponent(key)}`);
    const data = await r.json();
    if (data.error) return { synced: 0, error: data.error.error };

    const attacks = data.attacks || {};
    const dailyRaw = await redis(['GET', hitsDailyKey(factionId)]);
    const daily = dailyRaw ? JSON.parse(dailyRaw) : {};
    const result = await processAttacksPageAsync(attacks, factionId, daily);
    if (result.dailyChanged) await redis(['SET', hitsDailyKey(factionId), JSON.stringify(daily)]);
    return { synced: result.synced, totalAvailable: Object.keys(attacks).length };
}

// Walks backward through time using Torn's "to" timestamp filter on attacksfull — since the
// rolling window can be as little as a few hours of activity for a busy faction, a single sync
// only ever sees a sliver of any given day. This pages back to actually capture full days,
// bounded to a reasonable number of pages per click.
const hitsDeepCursorKey = (factionId) => `wwl:hits-deep-cursor:${factionId}`;

async function deepSyncHits(key, factionId, maxPages = 15) {
    const dailyRaw = await redis(['GET', hitsDailyKey(factionId)]);
    const daily = dailyRaw ? JSON.parse(dailyRaw) : {};

    const cursorRaw = await redis(['GET', hitsDeepCursorKey(factionId)]);
    let to = cursorRaw ? Number(cursorRaw) : Math.floor(Date.now() / 1000);
    let totalSynced = 0, pagesFetched = 0, emptyPagesInARow = 0, rateLimited = false, stopReason = 'max-pages';

    for (let page = 0; page < maxPages; page++) {
        if (page > 0) await sleep(1100); // stay well clear of Torn's rate limit across a multi-page loop
        const r = await tornFetch(`https://api.torn.com/faction/?selections=attacksfull&to=${to}&key=${encodeURIComponent(key)}`);
        const data = await r.json();
        if (data.error) {
            if (isRateLimited(data)) rateLimited = true;
            stopReason = `torn-error: ${data.error.error || data.error.code}`;
            break;
        }
        const attacks = data.attacks || {};
        if (!Object.keys(attacks).length) { stopReason = 'empty-page (Torn returned no attacks at this point in time)'; break; }
        pagesFetched++;

        const result = await processAttacksPageAsync(attacks, factionId, daily);
        totalSynced += result.synced;
        if (result.dailyChanged) await redis(['SET', hitsDailyKey(factionId), JSON.stringify(daily)]);

        if (result.oldestSeen === null || result.oldestSeen >= to) { stopReason = 'no-progress (oldest attack on this page wasn\'t older than the last page)'; break; }
        to = result.oldestSeen - 1;
        await redis(['SET', hitsDeepCursorKey(factionId), String(to)]); // save progress after every page, not just at the end
        emptyPagesInARow = result.synced === 0 ? emptyPagesInARow + 1 : 0;
        if (emptyPagesInARow >= 3) { stopReason = '3-empty-pages-in-a-row (everything on these pages was already tracked, or was defend-side which this doesn\'t count)'; break; }
    }
    return { synced: totalSynced, pagesFetched, rateLimited, stopReason };
}

// attacksfull only ever shows the attacker's own gain — it has no field for what OUR faction
// lost when one of our members gets attacked. attacknews instead gives Torn's own exact,
// human-readable computed number for every event, e.g. "X attacked Y (-0.29)". A NEGATIVE
// number in this feed is our own faction's real loss from being attacked — exact, not a
// guessed percentage. Positive numbers here are just our own outgoing attacks restated (already
// covered by attacksfull above), so those are skipped to avoid double-counting.
const NEWS_RESPECT_RE = /\(([+-]\d+(?:\.\d+)?)\)/;

function processNewsPage(newsEntries, factionId, daily, seenIds) {
    let synced = 0, dailyChanged = false, oldestSeen = null;
    for (const [newsId, entry] of Object.entries(newsEntries)) {
        const ts = entry.timestamp;
        if (ts && (oldestSeen === null || ts < oldestSeen)) oldestSeen = ts;
        if (seenIds.has(newsId)) continue;
        const match = NEWS_RESPECT_RE.exec(entry.news || '');
        if (!match) continue; // no parseable number (e.g. "attacked X but lost" has none) — nothing to add
        const value = Number(match[1]);
        if (value >= 0) continue; // our own outgoing gain, already counted via attacksfull
        seenIds.add(newsId);
        const dayKey = new Date(ts * 1000).toISOString().slice(0, 10);
        daily[dayKey] = (daily[dayKey] || 0) + value; // already negative — a genuine subtraction
        dailyChanged = true;
        synced++;
    }
    return { synced, dailyChanged, oldestSeen };
}

async function syncLosses(key, factionId) {
    const r = await tornFetch(`https://api.torn.com/faction/?selections=attacknews&key=${encodeURIComponent(key)}`);
    const data = await r.json();
    if (data.error) return { synced: 0, error: data.error.error };

    const newsEntries = data.attacknews || {};
    const dailyRaw = await redis(['GET', hitsDailyKey(factionId)]);
    const daily = dailyRaw ? JSON.parse(dailyRaw) : {};
    const seenRaw = await redis(['GET', lossesSeenKey(factionId)]);
    const seenIds = new Set(seenRaw ? JSON.parse(seenRaw) : []);
    const result = processNewsPage(newsEntries, factionId, daily, seenIds);
    if (result.dailyChanged) {
        await redis(['SET', hitsDailyKey(factionId), JSON.stringify(daily)]);
        await redis(['SET', lossesSeenKey(factionId), JSON.stringify([...seenIds])]);
    }
    return { synced: result.synced, totalAvailable: Object.keys(newsEntries).length };
}

// Deep backfill for losses — attacknews needs both "from" and "to" to page beyond the most
// recent ~100 entries (a single timestamp alone gets ignored by Torn's API for news-type
// selections), so this walks backward in fixed time chunks rather than relying on "oldest seen".
const lossesDeepCursorKey = (factionId) => `wwl:losses-deep-cursor:${factionId}`;

async function deepSyncLosses(key, factionId, maxPages = 15) {
    const dailyRaw = await redis(['GET', hitsDailyKey(factionId)]);
    const daily = dailyRaw ? JSON.parse(dailyRaw) : {};
    const seenRaw = await redis(['GET', lossesSeenKey(factionId)]);
    const seenIds = new Set(seenRaw ? JSON.parse(seenRaw) : []);

    const CHUNK_SECONDS = 6 * 60 * 60; // 6-hour windows
    const cursorRaw = await redis(['GET', lossesDeepCursorKey(factionId)]);
    let to = cursorRaw ? Number(cursorRaw) : Math.floor(Date.now() / 1000);
    let totalSynced = 0, pagesFetched = 0, emptyPagesInARow = 0, rateLimited = false, stopReason = 'max-pages';

    for (let page = 0; page < maxPages; page++) {
        if (page > 0) await sleep(1100);
        const from = to - CHUNK_SECONDS;
        const r = await tornFetch(`https://api.torn.com/faction/?selections=attacknews&from=${from}&to=${to}&key=${encodeURIComponent(key)}`);
        const data = await r.json();
        if (data.error) {
            if (isRateLimited(data)) rateLimited = true;
            stopReason = `torn-error: ${data.error.error || data.error.code}`;
            break;
        }
        const newsEntries = data.attacknews || {};
        pagesFetched++;

        const result = processNewsPage(newsEntries, factionId, daily, seenIds);
        totalSynced += result.synced;
        if (result.dailyChanged) {
            await redis(['SET', hitsDailyKey(factionId), JSON.stringify(daily)]);
            await redis(['SET', lossesSeenKey(factionId), JSON.stringify([...seenIds])]);
        }

        to = from - 1; // always move the window back, even if this chunk was empty
        await redis(['SET', lossesDeepCursorKey(factionId), String(to)]); // save progress after every chunk, not just at the end
        emptyPagesInARow = result.synced === 0 ? emptyPagesInARow + 1 : 0;
        if (emptyPagesInARow >= 5) { stopReason = '5-empty-chunks-in-a-row (no losses found in these 6-hour windows, or reached the edge of available history)'; break; }
    }
    return { synced: totalSynced, pagesFetched, rateLimited, stopReason };
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
            const [ocDailyRaw, chainDailyRaw, hitsDailyRaw, warBonusDailyRaw, warRaw, goalRaw] = await Promise.all([
                redis(['GET', ocDailyKey(factionId)]),
                redis(['GET', chainDailyKey(factionId)]),
                redis(['GET', hitsDailyKey(factionId)]),
                redis(['GET', warBonusDailyKey(factionId)]),
                redis(['GET', warEntriesKey(factionId)]),
                redis(['GET', goalKey(factionId)]),
            ]);
            return res.status(200).json({
                ocDaily: ocDailyRaw ? JSON.parse(ocDailyRaw) : {},
                chainDaily: chainDailyRaw ? JSON.parse(chainDailyRaw) : {},
                hitsDaily: hitsDailyRaw ? JSON.parse(hitsDailyRaw) : {},
                warBonusDaily: warBonusDailyRaw ? JSON.parse(warBonusDailyRaw) : {},
                warEntries: warRaw ? JSON.parse(warRaw) : [],
                goals: normalizeGoals(goalRaw),
            });
        }

        // Everything below is leaders only.
        if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });

        // Real numbers for the "how much effort do we need to put in" calculator (respect-tracker.js's
        // Effort calculator, e.g. for a termed loss where members should be free to also train instead
        // of maxing the chain): this faction's own recent OC/week average, war bonus split by win/loss
        // (from the same per-war reports syncWarBonus already reads, see warBonusEntriesKey), and a real
        // respect-per-hit ratio from the faction's own last 100 chains — Torn's own per-chain totals,
        // not a guess. A leader can still type over any of these in the calculator itself.
        if (action === 'calc-data') {
            const [ocDailyRaw, entriesRaw, membersRes, chainsRes] = await Promise.all([
                redis(['GET', ocDailyKey(factionId)]),
                redis(['GET', warBonusEntriesKey(factionId)]),
                tornFetch(`https://api.torn.com/v2/faction/members?striptags=true&key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } }).catch(() => null),
                tornFetch(`https://api.torn.com/v2/faction/chains?limit=100&sort=desc&key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } }).catch(() => null),
            ]);

            const ocDaily = ocDailyRaw ? JSON.parse(ocDailyRaw) : {};
            const ocDays = Object.keys(ocDaily).sort().slice(-90); // last ~90 days of real coverage, whatever there is
            const ocWeeklyAvg = ocDays.length ? (ocDays.reduce((s, d) => s + (ocDaily[d] || 0), 0) / ocDays.length) * 7 : null;

            // War bonus: each war's real rank-change respect (see syncWarBonus), split by win/loss —
            // the amount depends on which way the rank moved, exactly as expected.
            const entries = entriesRaw ? JSON.parse(entriesRaw) : [];
            const bySide = won => { const list = entries.filter(e => e.won === won && e.bonus > 0); return list.length ? { avg: list.reduce((s, e) => s + e.bonus, 0) / list.length, count: list.length } : null; };
            const warBonus = { win: bySide(true), loss: bySide(false) };

            // Real recent war scores, for reference — Torn's own target-score formula (the lead needed
            // to win) isn't published anywhere reliable, so rather than guess one, this shows what
            // actually happened in the faction's own recent wars instead.
            const warScores = entries.filter(e => e.scoreUs != null && e.scoreThem != null)
                .sort((a, b) => b.end - a.end).slice(0, 10)
                .map(e => ({ end: e.end, scoreUs: e.scoreUs, scoreThem: e.scoreThem, won: e.won }));

            // Chain calibration: back out K (this faction's own average target-level x Fair Fight) from
            // real chains using Torn's actual chain-bonus formula (chainScaleSum/milestoneBonusSum
            // above), instead of a flat respect/hit average that can't tell a 1000-hit chain from a
            // 1500-hit one apart. Split into "war" chains (their time window overlaps a real war — hits
            // during a war are worth 2x, "inside" attacks on the enemy) and "peace" chains, calibrated
            // separately — a war chain's real K already reflects whatever mix of inside/outside hits
            // this faction actually gets during a war, more honest than just doubling the peace figure.
            let kPeace = null, kWar = null, peaceSample = null, warSample = null;
            try {
                const chainsData = chainsRes ? await chainsRes.json() : null;
                const list = Array.isArray(chainsData?.chains) ? chainsData.chains : Object.values(chainsData?.chains || {});
                const usable = list.filter(c => c && c.end && Number(c.chain) > 0 && Number(c.respect) > 0);
                const warWindows = entries.filter(e => e.start && e.end);
                const overlaps = (cs, ce) => warWindows.some(w => cs <= w.end && ce >= w.start);

                const calibrate = chains => {
                    const ks = [];
                    let hits = 0, respect = 0;
                    for (const c of chains) {
                        const L = Number(c.chain);
                        const scaleSum = chainScaleSum(L);
                        if (scaleSum <= 0) continue;
                        const k = (Number(c.respect) - milestoneBonusSum(L)) / scaleSum;
                        if (k > 0 && Number.isFinite(k)) { ks.push(k); hits += L; respect += Number(c.respect); }
                    }
                    if (!ks.length) return { k: null, sample: null };
                    return { k: ks.reduce((s, v) => s + v, 0) / ks.length, sample: { chains: ks.length, hits, respect } };
                };

                const warChains = usable.filter(c => c.start && overlaps(Number(c.start), Number(c.end)));
                const peaceChains = usable.filter(c => !(c.start && overlaps(Number(c.start), Number(c.end))));
                const peaceCal = calibrate(peaceChains); kPeace = peaceCal.k; peaceSample = peaceCal.sample;
                const warCal = calibrate(warChains); kWar = warCal.k; warSample = warCal.sample;
                // Too few chains for the split to mean anything — fall back to one blend across everything.
                if (kPeace == null && kWar == null) { const all = calibrate(usable); kPeace = all.k; peaceSample = all.sample; }
            } catch (e) { /* leave nulls — the calculator asks for it by hand instead */ }

            // Hits from one natural energy bar: a real, faction-specific average instead of a guessed 4
            // or 6 — worked out from how many of the roster are actually donators (150E bar) vs not
            // (100E), at Torn's standard 25 energy per attack (100/25=4, 150/25=6).
            let rosterCount = null, hitsPerBarAuto = null;
            try {
                const membersData = membersRes ? await membersRes.json() : null;
                const members = Array.isArray(membersData?.members) ? membersData.members : [];
                rosterCount = members.length || null;
                const known = members.filter(m => typeof m.is_donator === 'boolean');
                if (known.length) {
                    const donators = known.filter(m => m.is_donator).length;
                    hitsPerBarAuto = (donators * 6 + (known.length - donators) * 4) / known.length;
                }
            } catch (e) { /* leave null */ }

            return res.status(200).json({ ocWeeklyAvg, ocDays: ocDays.length, warBonus, warScores, kPeace, kWar, peaceSample, warSample, rosterCount, hitsPerBarAuto });
        }

        if (action === 'sync-chains') {
            const result = await syncChains(key, factionId);
            if (result.error) return res.status(403).json({ error: result.error });
            return res.status(200).json({ ok: true, synced: result.synced, totalAvailable: result.totalAvailable });
        }

        if (action === 'sync-war-bonus') {
            const result = await syncWarBonus(key, factionId);
            if (result.error) return res.status(403).json({ error: result.error });
            return res.status(200).json({ ok: true, synced: result.synced, totalAvailable: result.totalAvailable, skippedUnresolved: result.skippedUnresolved, rateLimited: result.rateLimited });
        }

        if (action === 'sync-hits') {
            const result = await syncHits(key, factionId);
            if (result.error) return res.status(403).json({ error: result.error });
            return res.status(200).json({ ok: true, synced: result.synced, totalAvailable: result.totalAvailable });
        }

        if (action === 'deep-sync-hits') {
            const result = await deepSyncHits(key, factionId);
            return res.status(200).json({ ok: true, synced: result.synced, pagesFetched: result.pagesFetched, rateLimited: result.rateLimited, stopReason: result.stopReason });
        }

        if (action === 'sync-losses') {
            const result = await syncLosses(key, factionId);
            if (result.error) return res.status(403).json({ error: result.error });
            return res.status(200).json({ ok: true, synced: result.synced, totalAvailable: result.totalAvailable });
        }

        if (action === 'deep-sync-losses') {
            const result = await deepSyncLosses(key, factionId);
            return res.status(200).json({ ok: true, synced: result.synced, pagesFetched: result.pagesFetched, rateLimited: result.rateLimited, stopReason: result.stopReason });
        }

        if (action === 'reset-hits-tracking') {
            // Reworked the whole calculation (removed a flawed defender-side percentage guess
            // and an incorrect chain-window exclusion, added exact loss tracking from
            // attacknews) — old stored numbers used the previous logic, so this wipes
            // everything and lets it rebuild cleanly from scratch.
            await redis(['DEL', hitsDailyKey(factionId)]);
            await redis(['DEL', hitsSeenKey(factionId)]);
            await redis(['DEL', lossesSeenKey(factionId)]);
            await redis(['DEL', hitsDeepCursorKey(factionId)]);
            await redis(['DEL', lossesDeepCursorKey(factionId)]);
            return res.status(200).json({ ok: true });
        }

        if (action === 'sync-oc') {
            const result = await syncOc(key, factionId);
            if (result.error) return res.status(403).json({ error: result.error });
            return res.status(200).json({ ok: true, synced: result.synced, totalAvailable: result.totalAvailable });
        }

        if (action === 'deep-sync-oc') {
            const result = await deepSyncOc(key, factionId);
            return res.status(200).json({ ok: true, synced: result.synced, pagesFetched: result.pagesFetched, rateLimited: result.rateLimited, stopReason: result.stopReason });
        }

        if (action === 'current-respect') {
            // Lightweight — just the live respect figure, no sync side effects. Used for repeat
            // reads within the same session so the Goal panel doesn't re-trigger a full sync
            // (OC/Chains/Hits/Losses/War) every time it's viewed.
            const r = await tornFetch(`https://api.torn.com/faction/?selections=basic&key=${encodeURIComponent(key)}`);
            const data = await r.json();
            const totalRespect = data.error ? null : (data.respect ?? data.faction?.respect ?? null);
            return res.status(200).json({ ok: true, totalRespect });
        }

        if (action === 'snapshot') {
            // No longer stores daily snapshot history — reported as unreliable/inconsistent day
            // to day, and the log-based categories (OC/Chains/Hits/Losses/War) are the sole
            // source of truth for daily totals now. Still fetches the LIVE current respect figure
            // (for the Goal panel's progress bar) and still triggers all the auto-syncing — that
            // side effect is relied on by every other part of this tracker and must stay.
            const r = await tornFetch(`https://api.torn.com/faction/?selections=basic&key=${encodeURIComponent(key)}`);
            const data = await r.json();
            const totalRespect = data.error ? null : (data.respect ?? data.faction?.respect ?? null);

            await syncOc(key, factionId).catch(() => {});
            await syncChains(key, factionId).catch(() => {});
            await syncHits(key, factionId).catch(() => {});
            await syncLosses(key, factionId).catch(() => {});
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
            const { target, deadline, label, windowDays } = req.body;
            if (!target) return res.status(400).json({ error: 'Missing target' });
            // Each goal keeps its OWN pace window (was a single setting shared by every goal, so
            // making a 28-day estimate and then a 3-month one for a second goal silently switched
            // the first goal's pace too, since there was only ever one stored value).
            const win = [14, 21, 28, 90].includes(Number(windowDays)) ? Number(windowDays) : 28;
            const raw = await redis(['GET', goalKey(factionId)]);
            const goals = normalizeGoals(raw);
            const id = Math.random().toString(36).slice(2, 10);
            goals.push({ id, target: Number(target), deadline: deadline || null, label: label || 'Respect goal', windowDays: win, setAt: Date.now() });
            await redis(['SET', goalKey(factionId), JSON.stringify(goals)]);
            return res.status(200).json({ ok: true, id });
        }

        if (action === 'remove-goal') {
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: 'Missing id' });
            const raw = await redis(['GET', goalKey(factionId)]);
            const goals = normalizeGoals(raw);
            const filtered = goals.filter(g => g.id !== id);
            await redis(['SET', goalKey(factionId), JSON.stringify(filtered)]);
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
