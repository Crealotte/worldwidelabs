// lib/bars.js — what Member Overview shows next to each member: energy (current / max), nerve, and the drug and medical cooldowns, with "stacking" (energy above the maximum) easy to see.
// WWL does not hold members' keys (only the faction's nightly-saving key), so it learns a member's bars from the member's OWN key at the moments they use WWL: when they log in on the site and when the
// script asks for its to-do list. Both call pushBars, which reads Torn's bars + cooldowns with that key and keeps them; a member who was read in the last 25 minutes is skipped, so the Redis and Torn
// cost stays tiny and nothing polls. A limited key is enough (the same level WWL asks at login).
//
//   wwl:bars:{factionId} -> hash: playerId -> JSON { e, em, n, nm, d, m, b, at }   (energy, max, nerve, max, drug / medical / booster cooldown seconds left at `at`, time read)

const barsKey = f => `wwl:bars:${f}`;
const THROTTLE_MS = 25 * 60000;

async function pushBars({ redis, key, factionId, playerId }) {
    const raw = await redis(['HGET', barsKey(factionId), String(playerId)]);
    if (raw) { try { if (Date.now() - JSON.parse(raw).at < THROTTLE_MS) return { skipped: true }; } catch (e) { /* read again */ } }
    const r = await fetch(`https://api.torn.com/user/?selections=bars,cooldowns&key=${encodeURIComponent(key)}`);
    const d = await r.json();
    if (d.error) return { error: d.error.error || `Torn error ${d.error.code}` };
    const cur = x => (x && Number.isFinite(Number(x.current)) ? Number(x.current) : null), max = x => (x && Number.isFinite(Number(x.maximum)) ? Number(x.maximum) : null), cd = d.cooldowns || {};
    const entry = { e: cur(d.energy), em: max(d.energy), n: cur(d.nerve), nm: max(d.nerve), d: Number(cd.drug) || 0, m: Number(cd.medical) || 0, b: Number(cd.booster) || 0, at: Date.now() };
    await redis(['HSET', barsKey(factionId), String(playerId), JSON.stringify(entry)]);
    return { ok: true };
}
async function getBars(redis, factionId) {
    const flat = (await redis(['HGETALL', barsKey(factionId)])) || [], out = {};
    for (let i = 0; i < flat.length; i += 2) { try { out[flat[i]] = JSON.parse(flat[i + 1]); } catch (e) { /* skip */ } }
    return out;
}
module.exports = { pushBars, getBars };
