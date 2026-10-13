// lib/access.js — the list of factions that may use WWL. When the list has at least one faction on it, only members of those factions can use the app
// (every server endpoint checks this right after it works out the member's faction); anyone else is turned away with a clear message. While the list is
// still empty nothing is restricted, so switching this on is a deliberate step (the owner adds the first faction) and nobody is locked out by accident.
// An owner (the same owners as Labs funds) is never turned away, and the owner's own faction can not be removed from the list.
//
//   wwl:allowed-factions -> hash: factionId -> JSON { name, by, at }
//
// The list is small and read often, so each warm server instance keeps it for 60 seconds instead of asking the database on every request;
// changes made through the owner page show up straight away on the instance that made them and within a minute everywhere else.

const { labsIsOwner } = require('./labsLedger');

const URL_ = require('./env').redisUrl();
const TOKEN = require('./env').redisToken();
const LIST = 'wwl:allowed-factions';
const DENIED = { error: 'Your faction is not on the list of factions that can use WWL yet. Ask the WWL owner to add it.', code: 'faction-not-allowed' };

async function redis(command) {
    const res = await fetch(URL_, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.result;
}

let cache = { at: 0, list: null };
async function allowedList(fresh) {
    if (!fresh && cache.list && Date.now() - cache.at < 60000) return cache.list;
    const flat = (await redis(['HGETALL', LIST])) || [];
    const list = {};
    for (let i = 0; i < flat.length; i += 2) { try { list[flat[i]] = JSON.parse(flat[i + 1]); } catch (e) { list[flat[i]] = {}; } }
    cache = { at: Date.now(), list };
    return list;
}
function resetCache() { cache = { at: 0, list: null }; }

// true when this faction may use WWL. `playerId` is optional: with it, an owner always passes.
async function factionAllowed(factionId, playerId) {
    const list = await allowedList(false);
    if (!Object.keys(list).length) return true; // nothing listed yet: not switched on
    if (list[String(factionId)]) return true;
    if (playerId) { try { if (await labsIsOwner(redis, playerId)) return true; } catch (e) { /* not an owner */ } }
    return false;
}

module.exports = { factionAllowed, allowedList, resetCache, redis, DENIED, LIST };
