// lib/todoKnown.js — the owner's "Services" to do: everything that comes from the Labs services (investor requests, money going back, automatic renewals, join requests, rent-to-own leases) is shown as ONE to do
// that opens up to its items, and any item can be marked "Known": it stays in the list but does not count or flag, until it changes (its text changes, then it is new again).
//
//   wwl:todo-known -> hash: item id -> signature of the item at the moment it was marked known

const KEY = 'wwl:todo-known';

const sigOf = it => { let h = 5381; const s = `${it.id}|${it.text}`; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h >>> 0); };

async function knownMap(redis) {
    const flat = (await redis(['HGETALL', KEY])) || [], m = {};
    for (let i = 0; i < flat.length; i += 2) m[flat[i]] = flat[i + 1];
    return m;
}
async function setKnown(redis, id, sig, on) {
    const field = String(id || '').slice(0, 80);
    if (!field) throw new Error('Missing item.');
    if (on) await redis(['HSET', KEY, field, String(sig || '').slice(0, 20)]);
    else await redis(['HDEL', KEY, field]);
}
// each item gets its signature and whether it is known: marked by the owner at exactly this state, or waiting for somebody else (an offered lease)
async function serviceView(redis, items) {
    const m = await knownMap(redis);
    return items.map(it => { const sig = sigOf(it); return { ...it, sig, known: !!it.waiting || m[it.id] === sig }; });
}

module.exports = { knownMap, setKnown, sigOf, serviceView };
