// lib/tzMap.js — the Timezone map page: where in the world the faction plays from. Each member's browser tells us
// its timezone once in a while (the IANA name such as "Europe/Brussels" and the current UTC offset in minutes) —
// nothing more precise than that, never a location. Everyone only ever sees anonymous counts per offset and per
// timezone name, not who is where. One hash per faction: playerId -> { zone, offset, at }.

const key = factionId => `wwl:tz:${factionId}`;
const ZONE_RE = /^(UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+\-]+){1,2})$/;

async function tzHandle(action, body, { redis, factionId, playerId }) {
    if (action === 'tz-report') {
        const zone = String(body.zone || '');
        const offset = Math.round(Number(body.offset));
        if (!ZONE_RE.test(zone) || !Number.isFinite(offset) || offset < -720 || offset > 840) throw new Error('Unusable timezone');
        await redis(['HSET', key(factionId), playerId, JSON.stringify({ zone, offset, at: Math.floor(Date.now() / 1000) })]);
        return { ok: true };
    }
    if (action === 'tz-get') {
        const flat = (await redis(['HGETALL', key(factionId)])) || [];
        const bands = {}, zones = {};
        let total = 0, me = null;
        for (let i = 0; i < flat.length; i += 2) {
            let e; try { e = JSON.parse(flat[i + 1]); } catch (err) { continue; }
            total++;
            const hour = Math.floor(e.offset / 60); // half-hour zones (e.g. India +5:30) are counted in the hour below
            bands[hour] = (bands[hour] || 0) + 1;
            const label = e.zone.replace(/_/g, ' ');
            zones[label] = zones[label] || { count: 0, offset: e.offset };
            zones[label].count++;
            if (flat[i] === String(playerId)) me = hour;
        }
        return { total, bands, zones, me };
    }
    throw new Error('Unknown action');
}

module.exports = { tzHandle };
