// lib/onlineHours.js — "When are you usually online?": every member ticks the hours of a normal day they are usually around, stored in TCT
// (Torn City Time = UTC) like the availability tracker does. Leaders use it to pair mentors and pupils whose hours overlap
// (mentoring admin page). One hash per faction: playerId -> { hours: [0..23 TCT], at }. Torn has no timezone or online history to read, so this is
// what members tell us.

const key = factionId => `wwl:online-hours:${factionId}`;

async function ohHandle(action, body, { redis, factionId, playerId }) {
    if (action === 'oh-get') {
        const raw = await redis(['HGET', key(factionId), String(playerId)]);
        let hours = null;
        try { hours = raw ? JSON.parse(raw).hours : null; } catch (e) { /* treated as not set */ }
        return { hours };
    }
    if (action === 'oh-set') {
        const hours = [...new Set((Array.isArray(body.hours) ? body.hours : []).map(Number).filter(h => Number.isInteger(h) && h >= 0 && h <= 23))].sort((a, b) => a - b);
        if (!hours.length) { await redis(['HDEL', key(factionId), String(playerId)]); return { ok: true, hours: null }; }
        await redis(['HSET', key(factionId), String(playerId), JSON.stringify({ hours, at: Math.floor(Date.now() / 1000) })]);
        return { ok: true, hours };
    }
    if (action === 'oh-all') { // leaders only (checked by the caller)
        const flat = (await redis(['HGETALL', key(factionId)])) || [];
        const all = {};
        for (let i = 0; i < flat.length; i += 2) { try { all[flat[i]] = JSON.parse(flat[i + 1]).hours; } catch (e) { /* skip */ } }
        return { all };
    }
    throw new Error('Unknown action');
}

module.exports = { ohHandle };
