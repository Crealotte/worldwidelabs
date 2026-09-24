// lib/planSync.js — keeps a member's weekly energy plan (the checklist from the Energy planner page) on the server,
// so the WWL userscript inside Torn (userscripts/energy-plan.user.js, served as worldwidelabs.user.js) can show
// the same checklist and tick it off. The
// planner page saves its plan here every time it draws it; ticking a box on either side goes through 'plan-check'.
// One JSON per player: { week, stat, method, summary, blocks: [{ title, note, items: [{ key, label, value }] }],
// checks: { key: true }, savedAt }. It expires after three weeks without a visit.

const key = playerId => `wwl:gym-plan:${playerId}`;
const TTL = 21 * 86400;
const txt = (s, n) => String(s ?? '').slice(0, n);

async function planHandle(action, body, { redis, playerId }) {
    const raw = await redis(['GET', key(playerId)]);
    const cur = raw ? JSON.parse(raw) : null;

    if (action === 'plan-get') return { plan: cur };

    if (action === 'plan-save') {
        const blocks = (Array.isArray(body.blocks) ? body.blocks : []).slice(0, 10).map(b => ({
            title: txt(b.title, 60), note: txt(b.note, 300),
            items: (Array.isArray(b.items) ? b.items : []).slice(0, 60).map(it => ({ key: txt(it.key, 20).replace(/[^\w]/g, ''), label: txt(it.label, 240), value: Math.max(0, Math.round(Number(it.value) || 0)) })),
        }));
        const week = Math.round(Number(body.week)) || 0;
        const seed = {}; for (const [k, v] of Object.entries(body.checks || {})) if (v && /^\w{1,20}$/.test(k)) seed[k] = true; // ticks made before the plan was ever saved
        const plan = { week, stat: txt(body.stat, 20), method: txt(body.method, 80), summary: txt(body.summary, 300), blocks,
            checks: cur && cur.week === week ? cur.checks || {} : seed, savedAt: Math.floor(Date.now() / 1000) };
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
