// api/announcement.js — WorldWideLabs faction announcements + optional poll.
// GET  ?key=...                            -> current announcement, tally, per-option voters, the
//                                              caller's own vote, and whether the poll has closed
// POST { key, text, poll }                 -> leaders only: create/replace the announcement.
//                                              poll: { question, options, durationMs } | null.
//                                              Votes only reset if the poll's question actually changed
//                                              (or there was no previous poll) — editing just the
//                                              announcement text keeps the current poll's votes intact.
// POST { key, action:'vote', optionIndex } -> any member: cast (or change) their vote, name attached

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const ANNOUNCEMENT_KEY = 'wwl:announcement';

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

        if (req.method === 'GET') {
            const key = req.query.key;
            const raw = await redis(['GET', ANNOUNCEMENT_KEY]);
            const announcement = raw ? JSON.parse(raw) : null;

            let tally = {};
            let voters = {};       // { optionIndex: [{ playerId, name }, ...] }
            let totalVotes = 0;
            let myVote = null;
            let closed = false;

            if (announcement?.poll) {
                closed = !!(announcement.poll.expiresAt && Date.now() > announcement.poll.expiresAt);

                const voteKey = `wwl:poll:votes:${announcement.poll.pollId}`;
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

                if (key) {
                    const profile = await tornProfile(key);
                    if (!profile.error) {
                        const mine = votes[String(profile.player_id)];
                        myVote = mine ? mine.optionIndex : null;
                    }
                }
            }

            return res.status(200).json({ announcement, tally, voters, totalVotes, myVote, closed });
        }

        if (req.method === 'POST') {
            const { key, action } = req.body || {};
            if (!key) return res.status(400).json({ error: 'Missing key' });

            if (action === 'vote') {
                const { optionIndex } = req.body;
                if (optionIndex === undefined) return res.status(400).json({ error: 'Missing optionIndex' });

                const raw = await redis(['GET', ANNOUNCEMENT_KEY]);
                const announcement = raw ? JSON.parse(raw) : null;
                if (!announcement?.poll) return res.status(400).json({ error: 'There is no active poll right now.' });
                if (announcement.poll.expiresAt && Date.now() > announcement.poll.expiresAt) {
                    return res.status(400).json({ error: 'This poll has closed.' });
                }

                const profile = await tornProfile(key);
                if (profile.error) return res.status(403).json({ error: 'Torn rejected the key' });

                const voteKey = `wwl:poll:votes:${announcement.poll.pollId}`;
                await redis(['HSET', voteKey, String(profile.player_id), JSON.stringify({ optionIndex, name: profile.name })]);
                return res.status(200).json({ ok: true });
            }

            // Anything else = create/replace the announcement — leaders only.
            if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });

            const { text, poll } = req.body; // poll: { question, options, durationMs } | null
            const existingRaw = await redis(['GET', ANNOUNCEMENT_KEY]);
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
            await redis(['SET', ANNOUNCEMENT_KEY, JSON.stringify(announcement)]);
            return res.status(200).json({ ok: true, announcement });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
    }
};
