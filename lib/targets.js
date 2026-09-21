// lib/targets.js — two things for the target pages:
//  1. 'target-status': whether a target is Okay / in Hospital (with the time it gets out) / travelling ... A target's status is public and the same for
//     everybody, so every answer is kept for ~90 seconds and shared between all members: opening the target pages costs at most one Torn call per
//     target per minute and a half, however many people look. A few unknown targets are looked up per call and `pending` says how many are left.
//  2. 'mytargets-*': a member's own list of targets (easy to beat, decent respect), kept per player so it follows them from PC to TornPDA.

const { tornFetch } = require('./tornFetch');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const STATUS_TTL = 120;   // seconds a looked-up status stays in the database
const STATUS_FRESH = 90;  // seconds it counts as fresh
const MAX_LOOKUPS = 10;   // Torn calls per request (the page asks again for the rest)
const myKey = playerId => `wwl:mytargets:${playerId}`;

async function targetsHandle(action, body, { redis, key, playerId }) {
    if (action === 'target-status') {
        const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(String).filter(s => /^\d{1,10}$/.test(s)))].slice(0, 60);
        const now = Math.floor(Date.now() / 1000);
        const cached = ids.length ? await redis(['MGET', ...ids.map(i => `wwl:tstatus:${i}`)]) : [];
        const status = {}, todo = [];
        ids.forEach((id, i) => {
            let c = null; try { c = cached?.[i] ? JSON.parse(cached[i]) : null; } catch (e) { /* unreadable */ }
            if (c && now - c.at < STATUS_FRESH) status[id] = c; else todo.push(id);
        });
        let rateLimited = false, done = 0;
        for (const id of todo.slice(0, MAX_LOOKUPS)) {
            try {
                const r = await tornFetch(`https://api.torn.com/user/${id}?selections=profile&key=${encodeURIComponent(key)}`);
                const d = await r.json();
                if (d.error) { if (Number(d.error.code) === 5) { rateLimited = true; break; } status[id] = { state: 'Unknown', until: null, at: now }; done++; continue; }
                const c = { state: d.status?.state || 'Unknown', until: d.status?.until || null, name: d.name || '', level: d.level ?? null, at: now };
                status[id] = c; done++;
                await redis(['SET', `wwl:tstatus:${id}`, JSON.stringify(c), 'EX', STATUS_TTL]);
                await sleep(250);
            } catch (e) { done++; }
        }
        return { status, pending: Math.max(0, todo.length - done), rateLimited };
    }

    if (action === 'mytargets-get') {
        const flat = (await redis(['HGETALL', myKey(playerId)])) || [];
        const list = [];
        for (let i = 0; i < flat.length; i += 2) { try { list.push(JSON.parse(flat[i + 1])); } catch (e) { /* skip */ } }
        return { targets: list.sort((a, b) => b.addedAt - a.addedAt) };
    }
    if (action === 'mytargets-add') {
        const id = String(body.id || '');
        if (!/^\d{1,10}$/.test(id)) throw new Error('That is not a player ID.');
        if ((await redis(['HLEN', myKey(playerId)])) >= 100 && !(await redis(['HEXISTS', myKey(playerId), id]))) throw new Error('Your list is full (100) — remove some targets first.');
        const old = await redis(['HGET', myKey(playerId), id]);
        const prev = old ? JSON.parse(old) : {};
        const t = { id, name: String(body.name || prev.name || '').slice(0, 40), level: Number.isFinite(Number(body.level)) ? Number(body.level) : (prev.level ?? null),
            note: body.note !== undefined ? String(body.note).slice(0, 120) : (prev.note || ''), addedAt: prev.addedAt || Date.now() };
        await redis(['HSET', myKey(playerId), id, JSON.stringify(t)]);
        return { ok: true };
    }
    if (action === 'mytargets-remove') {
        await redis(['HDEL', myKey(playerId), String(body.id || '')]);
        return { ok: true };
    }
    throw new Error('Unknown action');
}

module.exports = { targetsHandle };
