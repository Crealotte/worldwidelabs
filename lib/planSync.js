// lib/planSync.js — keeps a member's weekly energy plan (the checklist from the Energy planner page) on the server,
// so the WWL userscript inside Torn (userscripts/energy-plan.user.js, served as worldwidelabs.user.js) can show
// the same checklist and tick it off. The
// planner page saves its plan here every time it draws it; ticking a box on either side goes through 'plan-check'.
// One JSON per player: { week, stat, method, summary, blocks: [{ title, note, items: [{ key, label, value }] }],
// checks: { key: true }, weekly, savedAt }. A plan does NOT have to be picked again every week: when a new week starts, the first read keeps the same
// method and plan and only clears the ticks (see rollWeek). It expires after three months without any use.
//
// `weekly` is this member's own personal weekly energy minimum (gym-planner.js's gpInputs().weekly — 4,400 or
// 2,200, from THEIR OWN total battle stats, which is private and never visible to anyone else's key, faction
// API included). Piggybacking it onto this same per-player record — already written every time they open the
// Energy planner — is how the Energy Tracker leaderboard (api/war-payout.js's 'energy-board') can show each
// member's own requirement next to their numbers, without ever asking Torn for someone else's battle stats.

const { energyBetween } = require('./steadfast');

const key = playerId => `wwl:gym-plan:${playerId}`;
const TTL = 90 * 86400; // a plan stays for as long as it is used (it rolls over to each new week by itself, see below)
const txt = (s, n) => String(s ?? '').slice(0, n);

// A member picks a method once; each new week the same plan carries on with fresh (empty) ticks, so nobody has to open the planner just to
// make the "plan for this week" — the script used to nag about that every week. Opening the planner still saves a fresh plan as before.
const weekNow = () => Math.floor(Date.now() / (7 * 86400e3));
// A member can say which day THEIR training week starts on (it depends on the war and how it ended): `startDay` (YYYY-MM-DD, TCT). Weeks then run in blocks of 7 days
// from that day. Without it the week is the calendar week of before. weekIdOf is the number that names the current week (a custom week gets a number far above any
// calendar week, so the two never clash), weekStartOf is the first second of it.
const DAY = 86400, validDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
function weekStartOf(cur) {
    if (!cur || !validDay(cur.startDay)) return weekNow() * 7 * DAY;
    const start = Date.parse(cur.startDay + 'T00:00:00Z') / 1000;
    return start + Math.floor((Date.now() / 1000 - start) / (7 * DAY)) * 7 * DAY;
}
const weekIdOf = cur => (cur && validDay(cur.startDay)) ? 1000000 + weekStartOf(cur) / DAY : weekNow();
async function rollWeek(redis, playerId, cur) {
    if (!cur || cur.week === weekIdOf(cur)) return cur;
    cur.week = weekIdOf(cur); cur.checks = {}; cur.rolledAt = Math.floor(Date.now() / 1000);
    await redis(['SET', key(playerId), JSON.stringify(cur), 'EX', TTL]);
    return cur;
}

// How a member follows the plan: 'boxes' (their own ticks, the default) or 'counter' (the energy they really trained this week, from the energy tracker's daily snapshots).
// The boxes can be ticked in both ways; the choice only decides what the progress bar counts.
async function withCounter(redis, factionId, playerId, plan) {
    if (!plan) return plan;
    const from = weekStartOf(plan), out = { ...plan, currentWeek: weekIdOf(plan), weekStart: from }; // the script and the site show the week from these
    if (plan.track !== 'counter' || !factionId) return out;
    try {
        const e = await energyBetween(redis, factionId, from, Math.floor(Date.now() / 1000));
        out.counter = { trained: e.perMember?.[playerId]?.total ?? 0, partial: !!e.partial, known: e.snapshots > 0, from };
    } catch (err) { /* no counter */ }
    return out;
}

async function planHandle(action, body, { redis, playerId, factionId }) {
    const raw = await redis(['GET', key(playerId)]);
    const cur = await rollWeek(redis, playerId, raw ? JSON.parse(raw) : null);

    if (action === 'plan-get') return { plan: await withCounter(redis, factionId, playerId, cur) };

    if (action === 'plan-start') { // the first day of my training week ('' = automatic again). The ticks stay: only the edges of the week move.
        if (!cur) throw new Error('No plan saved yet - open the Energy planner on WWL once.');
        const d = String(body.startDay || '').trim();
        if (d) {
            if (!validDay(d)) throw new Error('Pick a date.');
            const ago = (Date.now() / 1000 - Date.parse(d + 'T00:00:00Z') / 1000) / DAY;
            if (ago < 0 || ago > 60) throw new Error('Pick a day from the last 60 days up to today.');
            cur.startDay = d;
        } else delete cur.startDay;
        cur.week = weekIdOf(cur);
        await redis(['SET', key(playerId), JSON.stringify(cur), 'EX', TTL]);
        return { plan: await withCounter(redis, factionId, playerId, cur) };
    }

    if (action === 'plan-track') {
        if (!cur) throw new Error('No plan saved yet - open the Energy planner on WWL once.');
        cur.track = body.mode === 'counter' ? 'counter' : 'boxes';
        await redis(['SET', key(playerId), JSON.stringify(cur), 'EX', TTL]);
        return { plan: await withCounter(redis, factionId, playerId, cur) };
    }

    if (action === 'plan-save') {
        const blocks = (Array.isArray(body.blocks) ? body.blocks : []).slice(0, 10).map(b => ({
            title: txt(b.title, 60), note: txt(b.note, 300),
            items: (Array.isArray(b.items) ? b.items : []).slice(0, 60).map(it => ({ key: txt(it.key, 20).replace(/[^\w]/g, ''), label: txt(it.label, 240), value: Math.max(0, Math.round(Number(it.value) || 0)) })),
        }));
        const week = cur ? weekIdOf(cur) : weekNow(); // named by the server: the member's own week start decides it
        const seed = {}; for (const [k, v] of Object.entries(body.checks || {})) if (v && /^\w{1,20}$/.test(k)) seed[k] = true; // ticks made before the plan was ever saved
        // A broad sane range rather than only today's exact 2,200/4,400 — so this doesn't quietly start
        // dropping the value the day Torn's own numbers change.
        const weeklyIn = Number(body.weekly);
        const weekly = Number.isFinite(weeklyIn) && weeklyIn >= 100 && weeklyIn <= 50000 ? Math.round(weeklyIn) : (cur?.weekly ?? null);
        const plan = { week, stat: txt(body.stat, 20), method: txt(body.method, 80), summary: txt(body.summary, 300), blocks,
            checks: cur && cur.week === week ? cur.checks || {} : seed, weekly, track: cur?.track === 'counter' ? 'counter' : 'boxes', ...(cur && validDay(cur.startDay) ? { startDay: cur.startDay } : {}), savedAt: Math.floor(Date.now() / 1000) };
        await redis(['SET', key(playerId), JSON.stringify(plan), 'EX', TTL]);
        return { plan: await withCounter(redis, factionId, playerId, plan) };
    }

    if (action === 'plan-check') {
        if (!cur) throw new Error('No plan saved yet — open the Energy planner on WWL once.');
        const k = txt(body.step, 20).replace(/[^\w]/g, '');
        if (!k) throw new Error('Unknown step');
        if (body.checked) cur.checks[k] = true; else delete cur.checks[k];
        await redis(['SET', key(playerId), JSON.stringify(cur), 'EX', TTL]);
        return { ok: true };
    }
    throw new Error('Unknown action');
}

module.exports = { planHandle, weekIdOf };
