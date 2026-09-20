// gym-planner.js — the "Tailored training plan" on the Energy planner page.
// A member picks how they train (natural energy, or one of the happy jump methods from the guide
// below), and gets: a week plan on top of our ideal week (4 training days, 2 war prep days, 1 war
// day — only realistic when we have a termed war), tick boxes to track it, and an ESTIMATE of the
// stat growth and item cost of that method next to all the others, so a newer player can see what
// each method really buys them.
//
// The gain maths is the widely used community gym formula (Vladar's), fed with the member's own
// numbers. It is an ESTIMATE: Torn adds a random amount to every train, so treat the result as a
// range. Assumptions are written next to the numbers on the page. The "training" chart of stats over
// time is separate and is NOT built from which items someone used.
'use strict';

const GP_KEY = 'wwl_gym_inputs';
const GP_METHOD_KEY = 'wwl_gym_method';
// Per-stat constants of the formula: [A, B]
const GP_STAT_AB = { strength: [1600, 1700], defense: [2100, -600], speed: [1600, 2000], dexterity: [1800, 1500] };
const GP_ITEMS = { lollipop: 'Lollipop', choco: 'Big Box of Chocolate Bars', edvd: 'Erotic DVD', ecstasy: 'Ecstasy', xanax: 'Xanax' };

// Each method: what it costs per jump session, how much happy the items add, how much energy the
// session spends, and how many sessions fit in a normal week by default (editable on the page).
function gpMethods(fill, job) {
    return [
        { id: 'natural', name: 'Natural energy (no jump)', sessions: 0, items: {}, addHappy: 0, energy: 0, ecstasy: false },
        { id: 'lollipop', name: 'Lollipop jump', sessions: 4, items: { lollipop: 49, ecstasy: 1 }, addHappy: 1225, energy: fill, ecstasy: true },
        { id: 'choco1', name: 'Big Choco jump (1 Xanax)', sessions: 4, items: { choco: 49, ecstasy: 1, xanax: 1 }, addHappy: 1715, energy: fill + 250, ecstasy: true },
        { id: 'choco4', name: 'Big Choco jump (4 Xanax)', sessions: 2, items: { choco: 49, ecstasy: 1, xanax: 4 }, addHappy: 1715, energy: fill + 1000, ecstasy: true },
        { id: 'edvd5', name: '5x EDVD jump', sessions: 1, items: { edvd: 5, ecstasy: 1, xanax: 4 }, addHappy: job ? 25000 : 12500, energy: fill + 1000, ecstasy: true },
        { id: 'edvd9', name: '9x EDVD jump', sessions: 1, items: { edvd: 9, ecstasy: 1, xanax: 4 }, addHappy: job ? 45000 : 22500, energy: fill + 1000, ecstasy: true },
    ];
}

const gpR4 = x => Math.round(x * 1e4) / 1e4;
// Gain of ONE train. S = the stat now, H = happy now, E = energy per train, G = gym multiplier.
function gpTrain(S, H, E, G, stat, perk) {
    const [A, B] = GP_STAT_AB[stat];
    const happyPart = gpR4(1 + 0.07 * gpR4(Math.log(1 + H / 250)));
    return (S * happyPart + 8 * Math.pow(H, 1.05) + (1 - Math.pow(H / 99999, 2)) * A + B) / 200000 * G * E * perk;
}
// Spend `energy` in trains starting at happy H0; happy drops by about half of each train's energy.
function gpSession(S, H0, energy, inp) {
    const trains = Math.floor(energy / inp.E);
    let H = H0, gain = 0;
    for (let i = 0; i < trains; i++) {
        gain += gpTrain(S + gain, Math.max(0, H), inp.E, inp.G, inp.stat, inp.perk);
        H -= inp.E * 0.5;
    }
    return { gain, trains };
}

// One method's week: its jump sessions at peak happy, then the rest of the weekly energy at normal happy.
function gpWeek(m, inp, prices) {
    let S = inp.S, gain = 0, energyUsed = 0;
    const perSession = [];
    for (let i = 0; i < m.sessions; i++) {
        const peak = Math.min(99999, (inp.base + m.addHappy) * (m.ecstasy ? 2 : 1));
        const r = gpSession(S, peak, m.energy, inp);
        S += r.gain; gain += r.gain; energyUsed += r.trains * inp.E;
        perSession.push({ peak, gain: r.gain, energy: r.trains * inp.E });
    }
    const rest = Math.max(0, inp.weekly - energyUsed);
    const r = gpSession(S, inp.base, rest, inp);
    gain += r.gain; energyUsed += r.trains * inp.E;
    let cost = 0, priced = true;
    for (const [k, qty] of Object.entries(m.items)) {
        const p = prices[GP_ITEMS[k]];
        if (p == null) priced = false; else cost += p * qty * m.sessions;
    }
    return { gain, cost, priced, energyUsed, perSession, restEnergy: r.trains * inp.E };
}

// ---- inputs, prices ----
let gpPrices = {};
async function gpLoadPrices() {
    try { const c = JSON.parse(sessionStorage.getItem('wwl_gym_prices') || 'null'); if (c && Date.now() - c.at < 6 * 3600e3) { gpPrices = c.p; return; } } catch (e) { /* fetch fresh */ }
    try {
        const res = await fetch(`https://api.torn.com/torn/?selections=items&key=${encodeURIComponent(apiKey)}`);
        const d = await res.json();
        if (d.error) return;
        const want = new Set(Object.values(GP_ITEMS));
        const p = {};
        for (const it of Object.values(d.items || {})) if (want.has(it.name)) p[it.name] = it.market_value || null;
        gpPrices = p;
        try { sessionStorage.setItem('wwl_gym_prices', JSON.stringify({ at: Date.now(), p })); } catch (e) { /* not critical */ }
    } catch (e) { /* prices stay unknown — costs shown as "?" */ }
}

function gpInputs() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(GP_KEY) || '{}'); } catch (e) { /* defaults */ }
    const num = (id, d) => { const v = Number($(id).value); return Number.isFinite(v) && v > 0 ? v : d; };
    return {
        stat: $('gp-stat').value, S: num('gp-s', saved.S || 100000), base: num('gp-base', saved.base || 5000),
        E: num('gp-e', 10), G: num('gp-g', 7.3), perk: 1 + (Number($('gp-perk').value) || 0) / 100, // perks in %, 0 = none
        weekly: num('gp-weekly', 2200), fill: num('gp-fill', 150), job: $('gp-job').checked,
    };
}
function gpSave() {
    const i = gpInputs();
    try { localStorage.setItem(GP_KEY, JSON.stringify({ S: i.S, base: i.base })); } catch (e) { /* not critical */ }
}

// Fills the boxes from what the login already fetched about the member (their own stats and bars).
function gpAutofill() {
    try {
        const stat = $('gp-stat').value;
        if (profile?.personalstats?.[stat] != null) $('gp-s').value = Math.round(profile.personalstats[stat]);
        if (profile?.happy?.maximum) $('gp-base').value = profile.happy.maximum;
        if (profile?.energy?.maximum) $('gp-fill').value = profile.energy.maximum;
        const g = (typeof egGroup !== 'undefined' && egGroup) || localStorage.getItem('wwl_energy_group');
        $('gp-weekly').value = g === 'a' ? 4400 : 2200;
    } catch (e) { /* the boxes just stay editable */ }
}

// ---- plan + chart ----
const gpWeekKey = () => `wwl_gym_plan_${new Date().toISOString().slice(0, 4)}_${Math.floor(Date.now() / (7 * 86400e3))}`;
const gpN = n => Math.round(n).toLocaleString();
const gpMoney = n => `$${Math.round(n).toLocaleString()}`;

function renderGymPlanner() {
    const inp = gpInputs();
    const methods = gpMethods(inp.fill, inp.job);
    let sel = 'natural';
    try { sel = localStorage.getItem(GP_METHOD_KEY) || 'natural'; } catch (e) { /* default */ }
    if (!methods.find(m => m.id === sel)) sel = 'natural';
    // sessions per week the member set for a method (max 4: one per training day)
    let overrides = {};
    try { overrides = JSON.parse(localStorage.getItem('wwl_gym_sessions') || '{}'); } catch (e) { /* defaults */ }
    methods.forEach(m => { if (m.id !== 'natural' && overrides[m.id] !== undefined) m.sessions = Math.min(4, Math.max(0, Number(overrides[m.id]) || 0)); });
    const chosen = methods.find(m => m.id === sel);
    if ($('gp-sessions').dataset.method !== sel) { $('gp-sessions').value = chosen.sessions; $('gp-sessions').dataset.method = sel; }
    $('gp-sessions-wrap').style.display = chosen.id === 'natural' ? 'none' : 'inline-flex';

    // method picker
    $('gp-methods').innerHTML = methods.map(m => `<button class="ghost small gp-method${m.id === sel ? ' active-toggle' : ''}" data-id="${m.id}">${esc(m.name)}</button>`).join(' ');
    $('gp-methods').querySelectorAll('.gp-method').forEach(b => b.addEventListener('click', () => {
        try { localStorage.setItem(GP_METHOD_KEY, b.dataset.id); } catch (e) { /* not critical */ }
        $('gp-sessions').dataset.method = ''; renderGymPlanner();
    }));

    // estimates for every method (the chosen one with the member's own sessions/week)
    const rows = methods.map(m => ({ m, w: gpWeek(m, inp, gpPrices) }));
    const maxGain = Math.max(1, ...rows.map(r => r.w.gain));
    const maxCost = Math.max(1, ...rows.map(r => r.w.priced ? r.w.cost : 0));
    $('gp-chart').innerHTML = rows.map(({ m, w }) => `
        <div style="margin-bottom:12px;${m.id === sel ? 'outline:1px solid var(--reagent);outline-offset:4px;border-radius:6px;' : ''}">
            <div style="display:flex;justify-content:space-between;gap:10px;font-size:13px;"><b>${esc(m.name)}</b>
                <span style="color:var(--muted);">${m.sessions ? `${m.sessions} jump${m.sessions === 1 ? '' : 's'}/week · ` : ''}${gpN(w.energyUsed)} E</span></div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
                <div style="width:70px;font-size:11px;color:var(--muted);">Stat gain</div>
                <div style="flex:1;background:var(--bench-2);border-radius:4px;height:14px;"><div style="width:${(w.gain / maxGain * 100).toFixed(1)}%;background:var(--reagent);height:14px;border-radius:4px;"></div></div>
                <div style="width:110px;text-align:right;font-family:var(--mono);font-size:12px;">+${gpN(w.gain)}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:3px;">
                <div style="width:70px;font-size:11px;color:var(--muted);">Item cost</div>
                <div style="flex:1;background:var(--bench-2);border-radius:4px;height:14px;"><div style="width:${w.priced ? (w.cost / maxCost * 100).toFixed(1) : 0}%;background:#f0b432;height:14px;border-radius:4px;"></div></div>
                <div style="width:110px;text-align:right;font-family:var(--mono);font-size:12px;">${w.priced ? gpMoney(w.cost) : '?'}</div>
            </div>
            ${m.id !== 'natural' ? (w.gain - rows[0].w.gain > 0 ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;">+${gpN(w.gain - rows[0].w.gain)} stat points more than natural${w.priced && w.cost > 0 ? ` — about ${gpMoney(w.cost / (w.gain - rows[0].w.gain))} per extra point` : ''}</div>` : '<div style="font-size:11px;color:var(--muted);margin-top:2px;">No gain over natural with these numbers</div>') : ''}
        </div>`).join('');

    // week plan for the chosen method: 4 training days, 2 war prep days, 1 war day (ideal termed-war week)
    const w = rows.find(r => r.m.id === sel).w;
    let checks = {};
    try { checks = JSON.parse(localStorage.getItem(gpWeekKey()) || '{}'); } catch (e) { /* none */ }
    const trainDays = [1, 2, 3, 4];
    // jump sessions spread over the 4 training days (1 -> day 1, 2 -> days 1 & 3, 3 -> days 1-3, 4 -> every day)
    const jumpDayOf = {}; // training day index (0-3) -> session number
    for (let k = 0; k < chosen.sessions; k++) jumpDayOf[Math.floor(k * 4 / chosen.sessions)] = k;
    const restPerDay = Math.round((chosen.id === 'natural' ? inp.weekly : w.restEnergy) / 4);
    const dayRows = [];
    trainDays.forEach((d, i) => {
        const s = jumpDayOf[i] !== undefined ? w.perSession[jumpDayOf[i]] : null;
        const text = s
            ? `<b>${esc(chosen.name)}</b> — ${Object.entries(chosen.items).map(([k, q]) => `${q}× ${GP_ITEMS[k]}`).join(', ')}. Wait for a :00/:15/:30/:45 reset, take everything, then spend ${gpN(s.energy)} E. Happy ≈ ${gpN(s.peak)}, est. +${gpN(s.gain)} ${inp.stat}.${restPerDay ? ` Plus about ${gpN(restPerDay)} E of natural energy at normal happy.` : ''}`
            : `Train about ${gpN(restPerDay)} E of natural energy at normal happy.`;
        dayRows.push({ key: `d${d}`, title: `Training day ${d}`, text });
    });
    dayRows.push({ key: 'p1', title: 'War prep day 1', text: 'No gym in this ideal week — get ready for the war.', info: true });
    dayRows.push({ key: 'p2', title: 'War prep day 2', text: 'No gym in this ideal week — get ready for the war.', info: true });
    dayRows.push({ key: 'w', title: 'War day', text: 'Hit! (Only when we have a termed war — this is the ideal week.)', info: true });
    $('gp-plan').innerHTML = dayRows.map(r => `
        <label style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid var(--line);${r.info ? 'opacity:.75;' : 'cursor:pointer;'}">
            ${r.info ? '<span style="width:16px;"></span>' : `<input type="checkbox" class="gp-check" data-k="${r.key}" ${checks[r.key] ? 'checked' : ''} style="width:auto;margin-top:3px;">`}
            <span><b style="font-size:13px;">${r.title}</b><br><span style="font-size:13px;color:var(--muted);">${r.text}</span></span>
        </label>`).join('');
    $('gp-plan').querySelectorAll('.gp-check').forEach(cb => cb.addEventListener('change', () => {
        checks[cb.dataset.k] = cb.checked;
        try { localStorage.setItem(gpWeekKey(), JSON.stringify(checks)); } catch (e) { /* not critical */ }
        renderGpProgress(checks);
    }));
    renderGpProgress(checks);
    $('gp-summary').innerHTML = `<b>${esc(chosen.name)}</b> for a week: about <b style="color:var(--reagent);">+${gpN(w.gain)} ${inp.stat}</b> from ${gpN(w.energyUsed)} energy${w.priced ? `, jump items ≈ <b>${gpMoney(w.cost)}</b>` : ''}.`;
}
function renderGpProgress(checks) {
    const done = ['d1', 'd2', 'd3', 'd4'].filter(k => checks[k]).length;
    $('gp-progress').textContent = `${done} of 4 training days done this week`;
    $('gp-progress-fill').style.width = `${done * 25}%`;
}

async function loadGymPlanner() {
    if (!$('gp-s').value) gpAutofill();
    await gpLoadPrices();
    renderGymPlanner();
}
['gp-stat', 'gp-s', 'gp-base', 'gp-e', 'gp-g', 'gp-perk', 'gp-weekly', 'gp-fill', 'gp-job'].forEach(id => {
    $(id).addEventListener('change', () => {
        if (id === 'gp-stat' && typeof profile !== 'undefined' && profile?.personalstats?.[$('gp-stat').value] != null) $('gp-s').value = Math.round(profile.personalstats[$('gp-stat').value]);
        gpSave(); renderGymPlanner();
    });
});
$('gp-sessions').addEventListener('change', () => {
    let o = {}; try { o = JSON.parse(localStorage.getItem('wwl_gym_sessions') || '{}'); } catch (e) { /* fresh */ }
    o[$('gp-sessions').dataset.method] = Math.min(4, Math.max(0, Number($('gp-sessions').value) || 0));
    try { localStorage.setItem('wwl_gym_sessions', JSON.stringify(o)); } catch (e) { /* not critical */ }
    renderGymPlanner();
});
$('gp-autofill').addEventListener('click', () => { gpAutofill(); renderGymPlanner(); });
