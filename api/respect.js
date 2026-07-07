// api/respect.js — WorldWideLabs faction Respect Tracker.
// Total faction respect is a real, simple API field, so we snapshot it daily and let the numbers
// speak for themselves rather than trying to model every source of gain/loss precisely (regular
// hits, war hits, raids, dirty bombs, etc. all move this number, and modelling every mechanic
// would be a huge and fragile undertaking). Instead: track the ground truth daily, subtract out
// the two sources we CAN cleanly identify (Organized Crimes — shared with OC Fit's existing
// tracking — and manually-logged war respect), and whatever's left over is attributed to "hits" —
// exactly the approach the faction's own leader proposed.
//
// POST { key, action: 'snapshot' }                  -> leader-only: records today's total respect
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
const warEntriesKey = (factionId) => `wwl:war-respect:${factionId}`;
const goalKey = (factionId) => `wwl:respect-goal:${factionId}`;

function todayKey() { return new Date().toISOString().slice(0, 10); }

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
            const [snapRaw, ocDailyRaw, warRaw, goalRaw] = await Promise.all([
                redis(['GET', snapshotsKey(factionId)]),
                redis(['GET', ocDailyKey(factionId)]),
                redis(['GET', warEntriesKey(factionId)]),
                redis(['GET', goalKey(factionId)]),
            ]);
            return res.status(200).json({
                snapshots: snapRaw ? JSON.parse(snapRaw) : {},
                ocDaily: ocDailyRaw ? JSON.parse(ocDailyRaw) : {},
                warEntries: warRaw ? JSON.parse(warRaw) : [],
                goal: goalRaw ? JSON.parse(goalRaw) : null,
            });
        }

        // Everything below is leaders only.
        if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });

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
