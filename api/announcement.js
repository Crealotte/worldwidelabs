// api/announcement.js — WorldWideLabs faction announcements + optional poll.
// GET  ?key=...                          -> current announcement, poll tally, and the caller's own vote (if any)
// POST { key, text, poll }               -> leaders only: create/replace the announcement (and its poll, if given)
// POST { key, action:'vote', optionIndex } -> any member: cast (or change) their vote on the current poll

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
    // Same faction-API-access check used for Chain Payout — only leaders/co-leaders with that
    // permission can read faction-scoped endpoints like this one.
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
            let totalVotes = 0;
            let myVote = null;

            if (announcement?.poll) {
                const voteKey = `wwl:poll:votes:${announcement.poll.pollId}`;
                const flat = await redis(['HGETALL', voteKey]); // [playerId, optionIndex, playerId, optionIndex, ...]
                const votes = {};
                for (let i = 0; i < flat.length; i += 2) votes[flat[i]] = flat[i + 1];
                totalVotes = Object.keys(votes).length;
                Object.values(votes).forEach(v => { tally[v] = (tally[v] || 0) + 1; });

                if (key) {
                    const profile = await tornProfile(key);
                    if (!profile.error) myVote = votes[String(profile.player_id)] ?? null;
                }
            }

            return res.status(200).json({ announcement, tally, totalVotes, myVote });
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

                const profile = await tornProfile(key);
                if (profile.error) return res.status(403).json({ error: 'Torn rejected the key' });

                const voteKey = `wwl:poll:votes:${announcement.poll.pollId}`;
                await redis(['HSET', voteKey, String(profile.player_id), String(optionIndex)]);
                return res.status(200).json({ ok: true });
            }

            // Anything else = create/replace the announcement — leaders only.
            if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });

            const { text, poll } = req.body;
            const announcement = {
                text: text || '',
                poll: (poll && poll.question && poll.options?.length >= 2)
                    ? { question: poll.question, options: poll.options, pollId: Date.now() } // new pollId = fresh vote count
                    : null,
                updatedAt: Date.now(),
            };
            await redis(['SET', ANNOUNCEMENT_KEY, JSON.stringify(announcement)]);
            return res.status(200).json({ ok: true, announcement });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
    }
};
