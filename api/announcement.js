// api/announcement.js — WorldWideLabs faction announcements + optional poll.
// Multi-faction: every request resolves the caller's OWN faction ID from their key first
// (server-side, never trusted from the client), then reads/writes that faction's own slot.
// This is what lets multiple factions share one WorldWideLabs deployment safely — a leader
// from Faction A can never see or overwrite Faction B's announcement.
//
// GET  ?key=...                            -> the caller's faction's announcement, tally,
//                                              per-option voters, their own vote, and whether closed
// POST { key, text, poll }                 -> leaders only: create/replace THEIR faction's announcement.
//                                              poll: { question, options, durationMs } | null.
//                                              Votes only reset if the poll's question actually changed
//                                              (or there was no previous poll) — editing just the
//                                              announcement text keeps the current poll's votes intact.
// POST { key, action:'vote', optionIndex } -> any member: cast (or change) their vote, name attached

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

async function tornProfile(key) {
    const r = await fetch(`https://api.torn.com/user/?selections=profile&key=${encodeURIComponent(key)}`);
    return r.json();
}

// Resolves which faction a key belongs to. Never trust a faction ID supplied by the client —
// always derive it from the key itself, so nobody can address another faction's data.
async function getFactionId(key) {
    const profile = await tornProfile(key);
    if (profile.error || !profile.faction?.faction_id) return null;
    return String(profile.faction.faction_id);
}

async function isLeader(key) {
    const r = await fetch(`https://api.torn.com/v2/faction/balance?key=${encodeURIComponent(key)}`,
        { headers: { accept: 'application/json' } });
    const d = await r.json();
    return !d.error;
}

const announcementKey = (factionId) => `wwl:announcement:${factionId}`;

module.exports = async function handler(req, res) {
    try {
        if (!REDIS_URL || !REDIS_TOKEN) {
            return res.status(500).json({ error: 'Database not connected. In Vercel: Storage -> Create Database -> Upstash Redis, and connect it to this project.' });
        }

        if (req.method === 'GET') {
            const key = req.query.key;
            if (!key) return res.status(400).json({ error: 'Missing key' });

            const factionId = await getFactionId(key);
            if (!factionId) return res.status(403).json({ error: 'Could not determine your faction from this key' });

            const raw = await redis(['GET', announcementKey(factionId)]);
            const announcement = raw ? JSON.parse(raw) : null;

            let tally = {};
            let voters = {};       // { optionIndex: [{ playerId, name }, ...] }
            let totalVotes = 0;
            let myVote = null;
            let closed = false;

            if (announcement?.poll) {
                closed = !!(announcement.poll.expiresAt && Date.now() > announcement.poll.expiresAt);

                const voteKey = `wwl:poll:votes:${factionId}:${announcement.poll.pollId}`;
                const flat = await redis(['HGETALL', voteKey]); // [playerId, jsonValue, playerId, jsonValue, ...]
                const votes = {}; // playerId -> { optionIndex, name }
                for (let i = 0; i < flat.length; i += 2) {
                    try { votes[flat[i]] = JSON.parse(flat[i + 1]); } catch (e) { /* skip a corrupted entry */ }
                }
                totalVotes = Object.keys(votes).length;
                for (const [playerId, v] of Object.entries(votes)) {
                    tally[v.optionIndex] = (tally[v.optionIndex] || 0) + 1;
                    (voters[v.optionIndex] ||= []).push({ playerId, name: v.name });
                }

                const profile = await tornProfile(key);
                if (!profile.error) {
                    const mine = votes[String(profile.player_id)];
                    myVote = mine ? mine.optionIndex : null;
                }
            }

            return res.status(200).json({ announcement, tally, voters, totalVotes, myVote, closed });
        }

        if (req.method === 'POST') {
            const { key, action } = req.body || {};
            if (!key) return res.status(400).json({ error: 'Missing key' });

            const factionId = await getFactionId(key);
            if (!factionId) return res.status(403).json({ error: 'Could not determine your faction from this key' });

            if (action === 'vote') {
                const { optionIndex } = req.body;
                if (optionIndex === undefined) return res.status(400).json({ error: 'Missing optionIndex' });

                const raw = await redis(['GET', announcementKey(factionId)]);
                const announcement = raw ? JSON.parse(raw) : null;
                if (!announcement?.poll) return res.status(400).json({ error: 'There is no active poll right now.' });
                if (announcement.poll.expiresAt && Date.now() > announcement.poll.expiresAt) {
                    return res.status(400).json({ error: 'This poll has closed.' });
                }

                const profile = await tornProfile(key);
                if (profile.error) return res.status(403).json({ error: 'Torn rejected the key' });

                const voteKey = `wwl:poll:votes:${factionId}:${announcement.poll.pollId}`;
                await redis(['HSET', voteKey, String(profile.player_id), JSON.stringify({ optionIndex, name: profile.name })]);
                return res.status(200).json({ ok: true });
            }

            // Anything else = create/replace this faction's announcement — leaders only.
            if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });

            const { text, poll } = req.body; // poll: { question, options, durationMs } | null
            const existingRaw = await redis(['GET', announcementKey(factionId)]);
            const existing = existingRaw ? JSON.parse(existingRaw) : null;

            let newPoll = null;
            if (poll && poll.question && poll.options?.length >= 2) {
                // Reuse the same pollId (keeping votes) only if this is literally the same question
                // as before. Any other change — new question, or no previous poll — starts fresh.
                const samePoll = existing?.poll?.question === poll.question;
                let expiresAt;
                if (poll.durationMs) {
                    expiresAt = Date.now() + poll.durationMs; // a new duration was explicitly chosen
                } else if (samePoll) {
                    expiresAt = existing.poll.expiresAt ?? null; // no duration picked — don't wipe an existing time limit
                } else {
                    expiresAt = null; // brand new poll, no duration picked = no time limit
                }
                newPoll = {
                    question: poll.question,
                    options: poll.options,
                    pollId: samePoll ? existing.poll.pollId : Date.now(),
                    expiresAt,
                };
            }

            const announcement = { text: text || '', poll: newPoll, updatedAt: Date.now() };
            await redis(['SET', announcementKey(factionId), JSON.stringify(announcement)]);
            return res.status(200).json({ ok: true, announcement });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
    }
};
