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

const key = playerId => `wwl:gym-plan:${playerId}`;
const TTL = 90 * 86400; // a plan stays for as long as it is used (it rolls over to each new week by itself, see below)
const txt = (s, n) => String(s ?? '').slice(0, n);

// A member picks a method once; each new week the same plan carries on with fresh (empty) ticks, so nobody has to open the planner just to
// make the "plan for this week" — the script used to nag about that every week. Opening the planner still saves a fresh plan as before.
const weekNow = () => Math.floor(Date.now() / (7 * 86400e3));
async function rollWeek(redis, playerId, cur) {
    if (!cur || cur.week === weekNow()) return cur;
    cur.week = weekNow(); cur.checks = {}; cur.rolledAt = Math.floor(Date.now() / 1000);
    await redis(['SET', key(playerId), JSON.stringify(cur), 'EX', TTL]);
    return cur;
}

async function planHandle(action, body, { redis, playerId }) {
    const raw = await redis(['GET', key(playerId)]);
    const cur = await rollWeek(redis, playerId, raw ? JSON.parse(raw) : null);

    if (action === 'plan-get') return { plan: cur };

    if (action === 'plan-save') {
        const blocks = (Array.isArray(body.blocks) ? body.blocks : []).slice(0, 10).map(b => ({
            title: txt(b.title, 60), note: txt(b.note, 300),
            items: (Array.isArray(b.items) ? b.items : []).slice(0, 60).map(it => ({ key: txt(it.key, 20).replace(/[^\w]/g, ''), label: txt(it.label, 240), value: Math.max(0, Math.round(Number(it.value) || 0)) })),
        }));
        const week = Math.round(Number(body.week)) || 0;
        const seed = {}; for (const [k, v] of Object.entries(body.checks || {})) if (v && /^\w{1,20}$/.test(k)) seed[k] = true; // ticks made before the plan was ever saved
        // A broad sane range rather than only today's exact 2,200/4,400 — so this doesn't quietly start
        // dropping the value the day Torn's own numbers change.
        const weeklyIn = Number(body.weekly);
        const weekly = Number.isFinite(weeklyIn) && weeklyIn >= 100 && weeklyIn <= 50000 ? Math.round(weeklyIn) : (cur?.weekly ?? null);
        const plan = { week, stat: txt(body.stat, 20), method: txt(body.method, 80), summary: txt(body.summary, 300), blocks,
            checks: cur && cur.week === week ? cur.checks || {} : seed, weekly, savedAt: Math.floor(Date.now() / 1000) };
        await redis(['SET', key(playerId), JSON.stringify(plan), 'EX', TTL]);
        return { plan };
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

module.exports = { planHandle };
