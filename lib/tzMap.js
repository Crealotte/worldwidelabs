// lib/tzMap.js — the Timezone map page: where in the world the faction lives. Each member picks their own
// country on the page (nothing is detected automatically); everyone only sees anonymous counts per country, never
// who lives where. One hash per faction: playerId -> { country, at }, where country is the map's country id
// (the ISO numeric code, e.g. "056" for Belgium).

const key = factionId => `wwl:tz:${factionId}`;

async function tzHandle(action, body, { redis, factionId, playerId }) {
    if (action === 'tz-set') {
        const country = String(body.country || '');
        if (!/^\d{1,3}$/.test(country)) throw new Error('Pick a country from the list.');
        await redis(['HSET', key(factionId), playerId, JSON.stringify({ country, at: Math.floor(Date.now() / 1000) })]);
        return { ok: true };
    }
    if (action === 'tz-clear') {
        await redis(['HDEL', key(factionId), playerId]);
        return { ok: true };
    }
    if (action === 'tz-get') {
        const flat = (await redis(['HGETALL', key(factionId)])) || [];
        const countries = {};
        let total = 0, me = null;
        for (let i = 0; i < flat.length; i += 2) {
            let e; try { e = JSON.parse(flat[i + 1]); } catch (err) { continue; }
            if (!e.country) continue;
            total++;
            countries[e.country] = (countries[e.country] || 0) + 1;
            if (flat[i] === String(playerId)) me = e.country;
        }
        return { total, countries, me };
    }
    throw new Error('Unknown action');
}

module.exports = { tzHandle };
