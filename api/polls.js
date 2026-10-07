// api/polls.js — WorldWideLabs polls, fully independent from the announcement text.
// Every faction keeps a LIST of polls (newest first). The most recent one is the "active"
// poll — the one shown for voting on the Dashboard. Anything older stays visible as history,
// with its final results, so nothing just vanishes when its time limit passes or a new poll
// gets created. Leaders can delete any poll (active or past) outright.
// The key is ALWAYS sent in the POST body, never a URL query string.
//
// POST { key, action:'read' }                              -> { active, past: [...] }, each with
//                                                              tally/voters/totalVotes/myVote/closed
// POST { key, action:'create', question, options, durationMs } -> leaders only: starts a brand-new poll
// POST { key, action:'close', pollId }                     -> leaders only: ends a poll immediately,
//                                                              whether or not it had a duration set
// POST { key, action:'hide', pollId, hidden }               -> leaders only: hides a poll from members' dashboard (or shows it again) without deleting it
// POST { key, action:'delete', pollId }                     -> leaders only: removes a poll entirely
// POST { key, action:'vote', pollId, optionIndex }          -> any member: vote on the ACTIVE poll only

const { tornFetch } = require('../lib/tornFetch');
const { factionAllowed, DENIED: ACCESS_DENIED } = require('../lib/access');
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
    const r = await tornFetch(`https://api.torn.com/user/?selections=profile&key=${encodeURIComponent(key)}`);
    return r.json();
}
async function getFactionId(key) {
    const p = await tornProfile(key);
    if (p.error || !p.faction?.faction_id) return null;
    return String(p.faction.faction_id);
}
async function isLeader(key) {
    const r = await tornFetch(`https://api.torn.com/v2/faction/balance?key=${encodeURIComponent(key)}`,
        { headers: { accept: 'application/json' } });
    const d = await r.json();
    return !d.error;
}

const listKey = (factionId) => `wwl:polls:list:${factionId}`;
const pollKey = (factionId, pollId) => `wwl:poll:${factionId}:${pollId}`;
const votesKey = (factionId, pollId) => `wwl:poll:votes:${factionId}:${pollId}`;

async function withResults(poll, factionId, key) {
    const closed = !!(poll.expiresAt && Date.now() > poll.expiresAt);
    const flat = await redis(['HGETALL', votesKey(factionId, poll.pollId)]);
    const votes = {}; // playerId -> { optionIndex, name }
    for (let i = 0; i < flat.length; i += 2) {
        try { votes[flat[i]] = JSON.parse(flat[i + 1]); } catch (e) { /* skip a corrupted entry */ }
    }
    const tally = {}, voters = {};
    for (const [playerId, v] of Object.entries(votes)) {
        tally[v.optionIndex] = (tally[v.optionIndex] || 0) + 1;
        (voters[v.optionIndex] ||= []).push({ playerId, name: v.name });
    }
    let myVote = null;
    const profile = await tornProfile(key);
    if (!profile.error) {
        const mine = votes[String(profile.player_id)];
        myVote = mine ? mine.optionIndex : null;
    }
    return { ...poll, tally, voters, totalVotes: Object.keys(votes).length, myVote, closed };
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
        if (!(await factionAllowed(factionId))) return res.status(403).json(ACCESS_DENIED); // only factions on the owner's list may use WWL

        if (action === 'read') {
            const pollIds = (await redis(['LRANGE', listKey(factionId), 0, -1])) || []; // newest first
            const polls = [];
            for (const pollId of pollIds) {
                const raw = await redis(['GET', pollKey(factionId, pollId)]);
                if (!raw) continue;
                polls.push(await withResults(JSON.parse(raw), factionId, key));
            }
            const [active, ...past] = polls;
            return res.status(200).json({ active: active || null, past });
        }

        if (action === 'vote') {
            const { pollId, optionIndex } = req.body;
            if (!pollId || optionIndex === undefined) return res.status(400).json({ error: 'Missing pollId or optionIndex' });

            const pollIds = (await redis(['LRANGE', listKey(factionId), 0, 0])) || []; // only the newest counts as "active"
            if (String(pollIds[0]) !== String(pollId)) {
                return res.status(400).json({ error: 'That poll is no longer active — only the current poll accepts votes.' });
            }
            const raw = await redis(['GET', pollKey(factionId, pollId)]);
            const poll = raw ? JSON.parse(raw) : null;
            if (!poll) return res.status(404).json({ error: 'Poll not found' });
            if (poll.expiresAt && Date.now() > poll.expiresAt) return res.status(400).json({ error: 'This poll has closed.' });

            const profile = await tornProfile(key);
            if (profile.error) return res.status(403).json({ error: 'Torn rejected the key' });

            await redis(['HSET', votesKey(factionId, pollId), String(profile.player_id), JSON.stringify({ optionIndex, name: profile.name })]);
            return res.status(200).json({ ok: true });
        }

        // Everything below is leaders only.
        if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });

        if (action === 'create') {
            const { question, options, durationMs } = req.body;
            if (!question || !options || options.length < 2) {
                return res.status(400).json({ error: 'A poll needs a question and at least 2 options.' });
            }
            const poll = {
                pollId: String(Date.now()),
                question,
                options,
                createdAt: Date.now(),
                expiresAt: durationMs ? Date.now() + durationMs : null,
            };
            await redis(['SET', pollKey(factionId, poll.pollId), JSON.stringify(poll)]);
            await redis(['LPUSH', listKey(factionId), poll.pollId]); // newest goes to the front — becomes "active"
            return res.status(200).json({ ok: true, poll });
        }

        if (action === 'close') {
            const { pollId } = req.body;
            if (!pollId) return res.status(400).json({ error: 'Missing pollId' });
            const raw = await redis(['GET', pollKey(factionId, pollId)]);
            const poll = raw ? JSON.parse(raw) : null;
            if (!poll) return res.status(404).json({ error: 'Poll not found' });
            // Setting expiresAt to now closes it immediately, whether it originally had a
            // duration or not (a no-duration poll has expiresAt: null, which never auto-closes).
            poll.expiresAt = Date.now();
            await redis(['SET', pollKey(factionId, pollId), JSON.stringify(poll)]);
            return res.status(200).json({ ok: true });
        }

        // Take a poll off the dashboard (or put it back) without deleting it — its votes and results stay
        // safe, leaders can still see it in the editor list, and members no longer see it at all.
        if (action === 'hide') {
            const { pollId, hidden } = req.body;
            if (!pollId) return res.status(400).json({ error: 'Missing pollId' });
            const raw = await redis(['GET', pollKey(factionId, pollId)]);
            const poll = raw ? JSON.parse(raw) : null;
            if (!poll) return res.status(404).json({ error: 'Poll not found' });
            poll.hidden = !!hidden;
            await redis(['SET', pollKey(factionId, pollId), JSON.stringify(poll)]);
            return res.status(200).json({ ok: true });
        }

        if (action === 'delete') {
            const { pollId } = req.body;
            if (!pollId) return res.status(400).json({ error: 'Missing pollId' });
            await redis(['LREM', listKey(factionId), 0, pollId]);
            await redis(['DEL', pollKey(factionId, pollId)]);
            await redis(['DEL', votesKey(factionId, pollId)]);
            return res.status(200).json({ ok: true });
        }

        return res.status(400).json({ error: 'Unknown action' });
    } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
    }
};
