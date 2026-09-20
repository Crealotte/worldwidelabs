// lib/tzMap.js — the Timezone map page: where in the world the faction lives. Each member picks their own
// country on the page (nothing is detected automatically); for the United States they also pick a state.
// Everyone only sees anonymous counts, never who lives where. One hash per faction:
// playerId -> { country, state?, at }, where country is the map's country id (the ISO numeric code, e.g. "056"
// for Belgium, "840" for the US) and state is the US state's FIPS code (e.g. "06" for California).

const key = factionId => `wwl:tz:${factionId}`;

async function tzHandle(action, body, { redis, factionId, playerId }) {
    if (action === 'tz-set') {
        const country = String(body.country || '');
        if (!/^\d{1,3}$/.test(country)) throw new Error('Pick a country from the list.');
        const entry = { country, at: Math.floor(Date.now() / 1000) };
        if (country === '840') {
            const state = String(body.state || '');
            if (!/^\d{2}$/.test(state) || Number(state) > 56) throw new Error('Pick your state.');
            entry.state = state;
        }
        await redis(['HSET', key(factionId), playerId, JSON.stringify(entry)]);
        return { ok: true };
    }
    if (action === 'tz-clear') {
        await redis(['HDEL', key(factionId), playerId]);
        return { ok: true };
    }
    if (action === 'tz-get') {
        const flat = (await redis(['HGETALL', key(factionId)])) || [];
        const countries = {}, states = {};
        let total = 0, me = null;
        for (let i = 0; i < flat.length; i += 2) {
            let e; try { e = JSON.parse(flat[i + 1]); } catch (err) { continue; }
            if (!e.country) continue;
            total++;
            countries[e.country] = (countries[e.country] || 0) + 1;
            if (e.state) states[e.state] = (states[e.state] || 0) + 1;
            if (flat[i] === String(playerId)) me = { country: e.country, state: e.state || null };
        }
        return { total, countries, states, me };
    }
    throw new Error('Unknown action');
}

module.exports = { tzHandle };
