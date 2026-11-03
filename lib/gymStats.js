// lib/gymStats.js — backend for the Gym stats page (any member, only ever about the caller): a history of
// their own four battle stats, for the growth graph, and personal goals per stat.
//
// Torn only shows a player's battle stats to that player, so the history is built from what each member's
// own key can read: one snapshot per day, saved whenever they open the app or the page. The first time,
// it also tries Torn's historical personal stats to fill in the past; if Torn doesn't keep battle stats
// that way, the history simply starts today. Routed from api/war-payout.js ('gym-*' actions, open to
// every member — the caller can only ever read and change their own).

const { tornFetch } = require('./tornFetch');
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
    const d = await (await tornFetch(url)).json();
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

// ---- Growth planner (growth-planner.js): a member's own saved plan, and the faction's templates (leaders make those) ----
const growthKey = (id) => `wwl:gym-growth:${id}`;
const templatesKey = (factionId) => `wwl:gym-templates:${factionId}`;
const nOr = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
// keeps only what the planner understands, with sane limits: a plan is a start, an energy split per stat, some settings and up to 12 phases ("up to X total stats")
function cleanPlan(p) {
    p = p && typeof p === 'object' ? p : {};
    const arr4 = (a, lo, hi, d) => [0, 1, 2, 3].map(i => nOr(Array.isArray(a) ? a[i] : d, lo, hi, d));
    return {
        name: String(p.name || '').trim().slice(0, 60), desc: String(p.desc || '').trim().slice(0, 240),
        start: arr4(p.start, 0, 1e12, 0), split: arr4(p.split, 0, 100, 25), gym: Math.round(nOr(p.gym, 0, 23, 0)),
        rotation: p.rotation !== false, extra: nOr(p.extra, 0, 100, 0), model: p.model === 'wiki' ? 'wiki' : 'arcane',
        phases: (Array.isArray(p.phases) ? p.phases : []).slice(0, 12).map(f => ({ target: Math.round(nOr(f && f.target, 1, 1e12, 100000)), energy: nOr(f && f.energy, 1, 2000, 630), happy: Math.round(nOr(f && f.happy, 100, 99999, 5025)), dots: f && f.dots ? nOr(f.dots, 1, 10, 5) : null })),
    };
}

async function gymHandle(action, body, { redis, key, playerId, factionId, isLeader }) {
    if (action === 'gym-growth-get') { // everything the planner page needs in one go: my saved plan, the faction templates, and whether I can edit those
        const [mine, tpl] = await Promise.all([redis(['GET', growthKey(playerId)]), redis(['GET', templatesKey(factionId)])]);
        return { mine: mine ? JSON.parse(mine) : null, templates: tpl ? JSON.parse(tpl) : [], leader: await isLeader() };
    }
    if (action === 'gym-growth-save') { // my own plan (one per member)
        const plan = cleanPlan(body.plan);
        await redis(['SET', growthKey(playerId), JSON.stringify(plan)]);
        return { ok: true, plan };
    }
    if (action === 'gym-growth-templates-save') { // leaders: the whole list of faction templates
        if (!(await isLeader())) throw new Error('Only leaders can change the faction templates.');
        const list = (Array.isArray(body.templates) ? body.templates : []).slice(0, 30).map(cleanPlan).filter(t => t.name && t.phases.length);
        await redis(['SET', templatesKey(factionId), JSON.stringify(list)]);
        return { ok: true, templates: list };
    }

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
