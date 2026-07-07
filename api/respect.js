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
//                                                        and syncs any newly-completed chains + hits
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
    if (profile.error || !profile.faction?.faction_id) return null;
    return String(profile.faction.faction_id);
}
async function isLeader(key) {
    const r = await fetch(`https://api.torn.com/v2/faction/balance?key=${encodeURIComponent(key)}`,
        { headers: { accept: 'application/json' } });
    const d = await r.json();
    return !d.error;
}

const snapshotsKey = (factionId) => `wwl:respect-snapshots:${factionId}`;
const ocDailyKey = (factionId) => `wwl:oc-respect-daily:${factionId}`; // written by oc-fit.js
const chainDailyKey = (factionId) => `wwl:chain-respect-daily:${factionId}`;
const chainSeenKey = (factionId) => `wwl:chain-respect-seen:${factionId}`;
const hitsDailyKey = (factionId) => `wwl:hits-respect-daily:${factionId}`;
const hitsSeenKey = (factionId) => `wwl:hits-respect-seen:${factionId}`;
const warEntriesKey = (factionId) => `wwl:war-respect:${factionId}`;
const goalKey = (factionId) => `wwl:respect-goal:${factionId}`;

function todayKey() { return new Date().toISOString().slice(0, 10); }

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
    return { synced };
}

// Pulls real per-attack respect from faction:attacksfull — every attack any member made or
// received, with its own respect_gain. Chain-tagged attacks are skipped here since Chains
// already covers those; this is specifically the non-chain hit respect, measured directly
// rather than guessed. Limited to whatever's in Torn's current rolling window (~1000 attacks),
// same self-building philosophy as everything else in this app.
async function syncHits(key, factionId) {
    const r = await fetch(`https://api.torn.com/faction/?selections=attacksfull&key=${encodeURIComponent(key)}`);
    const data = await r.json();
    if (data.error) return { synced: 0, error: data.error.error };

    const attacks = data.attacks || {};
    const dailyRaw = await redis(['GET', hitsDailyKey(factionId)]);
    const daily = dailyRaw ? JSON.parse(dailyRaw) : {};
    let synced = 0;
    for (const [attackId, attack] of Object.entries(attacks)) {
        if (attack.chain) continue; // already counted under Chains
        const added = await redis(['SADD', hitsSeenKey(factionId), attackId]);
        if (added !== 1) continue; // already counted
        const respect = Number(attack.respect_gain || 0);
        if (!respect) continue; // known Torn quirk: losses don't always populate this — nothing to add either way
        const dayKey = new Date((attack.timestamp_ended || attack.timestamp_started) * 1000).toISOString().slice(0, 10);
        daily[dayKey] = (daily[dayKey] || 0) + respect;
        synced++;
    }
    if (synced > 0) await redis(['SET', hitsDailyKey(factionId), JSON.stringify(daily)]);
    return { synced };
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

        if (action === 'read') {
            const [snapRaw, ocDailyRaw, chainDailyRaw, hitsDailyRaw, warRaw, goalRaw] = await Promise.all([
                redis(['GET', snapshotsKey(factionId)]),
                redis(['GET', ocDailyKey(factionId)]),
                redis(['GET', chainDailyKey(factionId)]),
                redis(['GET', hitsDailyKey(factionId)]),
                redis(['GET', warEntriesKey(factionId)]),
                redis(['GET', goalKey(factionId)]),
            ]);
            return res.status(200).json({
                snapshots: snapRaw ? JSON.parse(snapRaw) : {},
                ocDaily: ocDailyRaw ? JSON.parse(ocDailyRaw) : {},
                chainDaily: chainDailyRaw ? JSON.parse(chainDailyRaw) : {},
                hitsDaily: hitsDailyRaw ? JSON.parse(hitsDailyRaw) : {},
                warEntries: warRaw ? JSON.parse(warRaw) : [],
                goal: goalRaw ? JSON.parse(goalRaw) : null,
            });
        }

        // Everything below is leaders only.
        if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });

        if (action === 'sync-chains') {
            const result = await syncChains(key, factionId);
            if (result.error) return res.status(403).json({ error: result.error });
            return res.status(200).json({ ok: true, synced: result.synced });
        }

        if (action === 'sync-hits') {
            const result = await syncHits(key, factionId);
            if (result.error) return res.status(403).json({ error: result.error });
            return res.status(200).json({ ok: true, synced: result.synced });
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

            // Piggyback chain and hit syncing onto every snapshot, so both stay current
            // automatically without needing a separate visit.
            await syncChains(key, factionId).catch(() => {});
            await syncHits(key, factionId).catch(() => {});

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

        return res.status(400).json({ error: 'Unknown action' });
    } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
    }
};
