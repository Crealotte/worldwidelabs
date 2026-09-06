// api/war-badges.js — WorldWideLabs War Badges.
// Fun, per-war "awards ceremony" — 1st and 2nd place across 8 categories for a single ranked war,
// scoped to your own faction (not a cross-faction global leaderboard). All the underlying counting
// happens in lib/warBadgeStats.js (one pass over Torn's own attack log for the war's window); this
// file is just auth, war lookup, and handing the raw per-member numbers to the frontend, which
// decides how to rank/label each badge (see war-badges-tracker.js).

const { fetchWarBadgeStats } = require('../lib/warBadgeStats');

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

module.exports = async function handler(req, res) {
    try {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const { key, action } = req.body || {};
        if (!key) return res.status(400).json({ error: 'Missing key' });

        const factionId = await getFactionId(key);
        if (!factionId) return res.status(403).json({ error: 'Could not determine your faction from this key' });
        if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });

        if (action === 'list-wars') {
            const r = await fetch(`https://api.torn.com/v2/faction?selections=rankedwars&key=${encodeURIComponent(key)}`,
                { headers: { accept: 'application/json' } });
            const data = await r.json();
            if (data.error) return res.status(403).json({ error: data.error.error });
            const wars = Object.values(data.rankedwars || {});
            const list = wars.filter(w => w.end).map(w => {
                const us = (w.factions || []).find(f => String(f.id) === factionId);
                const them = (w.factions || []).find(f => String(f.id) !== factionId);
                return {
                    id: w.id, start: w.start, end: w.end,
                    us: us ? { id: us.id, name: us.name, score: us.score } : null,
                    them: them ? { id: them.id, name: them.name, score: them.score } : null,
                    winner: w.winner,
                };
            }).sort((a, b) => b.end - a.end);
            return res.status(200).json({ wars: list });
        }

        if (action === 'calculate') {
            const { warStart, warEnd, enemyFactionId } = req.body;
            if (!warStart || !warEnd || !enemyFactionId) return res.status(400).json({ error: 'Pick a war first.' });

            const result = await fetchWarBadgeStats(key, factionId, String(enemyFactionId), warStart, warEnd);

            const membersRes = await fetch(`https://api.torn.com/v2/faction/members?key=${encodeURIComponent(key)}`,
                { headers: { accept: 'application/json' } });
            const membersData = await membersRes.json();
            const nameById = {};
            for (const m of (membersData.members || [])) nameById[String(m.id)] = m.name;

            const members = Object.entries(result.perAttacker).map(([id, stats]) => ({
                id, name: nameById[id] || `Ex-member #${id}`, ...stats,
            }));

            return res.status(200).json({
                members,
                meta: { scanned: result.scanned, matched: result.ownOutgoing, rateLimited: result.rateLimited, pagesFetched: result.pagesFetched },
            });
        }

        return res.status(400).json({ error: 'Unknown action' });
    } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
    }
};
