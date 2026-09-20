// lib/gymStats.js — backend for the Gym stats page (any member, only ever about the caller): a history of
// their own four battle stats, for the growth graph, and personal goals per stat.
//
// Torn only shows a player's battle stats to that player, so the history is built from what each member's
// own key can read: one snapshot per day, saved whenever they open the app or the page. The first time,
// it also tries Torn's historical personal stats to fill in the past; if Torn doesn't keep battle stats
// that way, the history simply starts today. Routed from api/war-payout.js ('gym-*' actions, open to
// every member — the caller can only ever read and change their own).

const histKey = (id) => `wwl:gym-hist:${id}`; // hash: day number (unix / 86400) -> [str, def, spd, dex]
const goalsKey = (id) => `wwl:gym-goals:${id}`; // { strength, defense, speed, dexterity } targets
const STATS = ['strength', 'defense', 'speed', 'dexterity'];
const DAY = 86400;

function pick(ps, name) {
    let v;
    if (Array.isArray(ps)) v = ps.find(x => x.name === name)?.value;
    else if (ps && typeof ps === 'object') {
        v = ps[name];
        if (v === undefined) for (const c of Object.values(ps)) if (c && typeof c === 'object' && name in c) { v = c[name]; break; }
    }
    return Number.isFinite(Number(v)) && v !== undefined && v !== null ? Number(v) : null;
}

// The four stats now (timestamp omitted) or as Torn recorded them at a moment in the past; null if unreadable.
async function readStats(key, timestamp) {
    const url = timestamp
        ? `https://api.torn.com/user/?selections=personalstats&stat=${STATS.join(',')}&timestamp=${timestamp}&key=${encodeURIComponent(key)}`
        : `https://api.torn.com/user/?selections=personalstats&key=${encodeURIComponent(key)}`;
    const d = await (await fetch(url)).json();
    if (d.error) return null;
    const vals = STATS.map(s => pick(d.personalstats, s));
    return vals.every(v => v !== null && v > 0) ? vals : null;
}

async function readHistory(redis, playerId) {
    const flat = (await redis(['HGETALL', histKey(playerId)])) || [];
    const out = [];
    for (let i = 0; i < flat.length; i += 2) { try { out.push([Number(flat[i]), ...JSON.parse(flat[i + 1])]); } catch (e) { /* skip */ } }
    return out.sort((a, b) => a[0] - b[0]);
}

async function gymHandle(action, body, { redis, key, playerId }) {
    if (action === 'gym-snapshot') {
        const now = Math.floor(Date.now() / 1000);
        const today = Math.floor(now / DAY);
        let history = await readHistory(redis, playerId);
        const current = await readStats(key);
        if (current) {
            // First visit: try to fill in the past from Torn's historical stats (monthly, a year back).
            if (!history.length) {
                const stamps = [];
                for (let m = 1; m <= 12; m++) stamps.push(now - m * 30 * DAY);
                const found = [];
                for (let i = 0; i < stamps.length; i += 4) {
                    const got = await Promise.all(stamps.slice(i, i + 4).map(async t => [t, await readStats(key, t).catch(() => null)]));
                    for (const [t, v] of got) if (v) found.push([Math.floor(t / DAY), v]);
                }
                // Only trust it if the past actually differs from today (otherwise Torn just repeated the current values).
                if (found.some(([, v]) => v.some((x, i) => x !== current[i]))) {
                    await redis(['HSET', histKey(playerId), ...found.flatMap(([day, v]) => [String(day), JSON.stringify(v)])]);
                }
            }
            await redis(['HSET', histKey(playerId), String(today), JSON.stringify(current)]);
            history = await readHistory(redis, playerId);
        }
        const rawGoals = await redis(['GET', goalsKey(playerId)]);
        return { history, goals: rawGoals ? JSON.parse(rawGoals) : {}, current };
    }

    if (action === 'gym-goals-save') {
        const goals = {};
        for (const s of STATS) { const n = Math.round(Number(body.goals?.[s])); if (Number.isFinite(n) && n > 0) goals[s] = n; }
        await redis(['SET', goalsKey(playerId), JSON.stringify(goals)]);
        return { ok: true, goals };
    }

    throw new Error('Unknown action');
}

module.exports = { gymHandle };
