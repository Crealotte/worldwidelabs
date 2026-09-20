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
        { id: 'choco4', name: 'Big Choco jump (4 Xanax)', sessions: 2, items: { choco: 49, ecstasy: 1, xanax: 4 }, addHappy: 1715, energy: fill + 1000, ecstasy: true, refill: true },
        { id: 'edvd5', name: '5x EDVD jump', sessions: 1, items: { edvd: 5, ecstasy: 1, xanax: 4 }, addHappy: job ? 25000 : 12500, energy: fill + 1000, ecstasy: true, refill: true },
        { id: 'edvd9', name: '9x EDVD jump', sessions: 1, items: { edvd: 9, ecstasy: 1, xanax: 4 }, addHappy: job ? 45000 : 22500, energy: fill + 1000, ecstasy: true, refill: true },
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
    // natural method: the member's own day (bars + Xanax + refill) times 4 training days; with a jump, their natural bars
    // on top of it. The weekly number is only a minimum to reach — the plan is never cut down to it.
    const natDaily = inp.bars * inp.fill + inp.xan * 250 + inp.refill * inp.fill;
    const rest = m.id === 'natural' ? 4 * natDaily : 4 * inp.bars * inp.fill;
    const r = gpSession(S, inp.base, rest, inp);
    gain += r.gain; energyUsed += r.trains * inp.E;
    let cost = 0, priced = true;
    for (const [k, qty] of Object.entries(m.items)) {
        const p = prices[GP_ITEMS[k]];
        if (p == null) priced = false; else cost += p * qty * m.sessions;
    }
    return { gain, cost, priced, energyUsed, perSession, restEnergy: r.trains * inp.E };
}

// ---- energy group: worked out from the member's own total battle stats (1.5m+ = 4,400 E a week and
// natural energy, since jumping is no longer normal there; under = 2,200 E a week and the jump methods).
// A member can override it with the buttons on the page; "Automatic" goes back to their stats.
const GP_GROUP_KEY = 'wwl_gym_group_override';
const GP_TIER_LIMIT = 1500000;
function gpTotalStats() {
    try {
        const ps = profile?.personalstats;
        const t = Number(ps?.totalstats) || ['strength', 'defense', 'speed', 'dexterity'].reduce((s, k) => s + (Number(ps?.[k]) || 0), 0);
        return t > 0 ? t : null;
    } catch (e) { return null; }
}
function gpGroup() {
    let o = null;
    try { o = localStorage.getItem(GP_GROUP_KEY); } catch (e) { /* automatic */ }
    const total = gpTotalStats();
    if (o === 'a' || o === 'b') return { group: o, total, source: 'chosen' };
    if (total !== null) return { group: total >= GP_TIER_LIMIT ? 'a' : 'b', total, source: 'auto' };
    return { group: 'b', total, source: 'unknown' }; // nothing known: show the full set of methods
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
        weekly: num('gp-weekly', 2200), fill: (n => (n >= 50 && n <= 250 ? n : 150))(num('gp-fill', 150)), job: $('gp-job').checked,
        bars: Math.min(4, Math.max(1, Math.round(num('gp-bars', 3)))), xan: Math.min(4, Math.max(0, Math.round(Number($('gp-xan').value) || 0))), refill: $('gp-refill').checked ? 1 : 0,
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
        const bar = Number(profile?.energy?.maximum);
        $('gp-fill').value = (bar >= 100 && bar <= 150) ? bar : (profile?.donator ? 150 : 100);
        if (!$('gp-bars').value) $('gp-bars').value = 3;
        if ($('gp-xan').value === '') $('gp-xan').value = 2;
        $('gp-weekly').value = gpGroup().group === 'a' ? 4400 : 2200;
    } catch (e) { /* the boxes just stay editable */ }
}

// ---- plan + chart ----
const gpWeekKey = () => `wwl_gym_plan_${new Date().toISOString().slice(0, 4)}_${Math.floor(Date.now() / (7 * 86400e3))}`;
const gpN = n => Math.round(n).toLocaleString();
const gpMoney = n => `$${Math.round(n).toLocaleString()}`;

function renderGymPlanner() {
    const inp = gpInputs();
    const grp = gpGroup();
    let showJumps = false;
    try { showJumps = localStorage.getItem('wwl_gym_show_jumps') === '1'; } catch (e) { /* hidden */ }
    const high = grp.group === 'a';
    const jumpsOff = false; // every option is always listed, so everyone can compare the estimates
    $('gp-show-jumps').textContent = showJumps ? 'Hide the happy jump options' : 'I do happy jumps — show the jump options';
    $('gp-show-jumps').style.display = 'none';
    $('gp-group-note').innerHTML = grp.total === null && grp.source === 'unknown'
        ? 'Your battle stats couldn\'t be read, so pick your group with the buttons below.'
        : `${grp.source === 'chosen' ? 'You picked' : 'From your own battle stats'}: <b style="color:var(--text);">${high ? '1.5m+' : 'under 1.5m'}</b>${grp.total ? ` (${(grp.total / 1e6).toFixed(2)}m total)` : ''} — <b style="color:var(--text);">at least ${high ? '4,400' : '2,200'} energy a week</b>${high ? ', and most people at this level train on natural energy — the jump options below are there to compare.' : ', and you can plan happy jumps below.'}`;
    ['a', 'b'].forEach(g => { const b = $(`eg-group-${g}`); b.style.borderColor = grp.source === 'chosen' && grp.group === g ? 'var(--reagent)' : 'var(--line)'; b.style.color = grp.source === 'chosen' && grp.group === g ? 'var(--reagent)' : 'var(--text)'; });
    $('gp-group-auto').style.borderColor = grp.source === 'chosen' ? 'var(--line)' : 'var(--reagent)';
    $('gp-group-auto').style.color = grp.source === 'chosen' ? 'var(--text)' : 'var(--reagent)';
    if (Number($('gp-weekly').value) !== (high ? 4400 : 2200) && $('gp-weekly').dataset.group !== grp.group) $('gp-weekly').value = high ? 4400 : 2200;
    $('gp-weekly').dataset.group = grp.group;
    ['gp-how', 'gp-chart-head', 'gp-chart', 'gp-methods'].forEach(id => { $(id).style.display = jumpsOff ? 'none' : ''; });
    const all = gpMethods(inp.fill, inp.job);
    const methods = jumpsOff ? all.filter(m => m.id === 'natural') : all; // 1.5m+ trains on natural energy unless they switch jumps on
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

    // Week plan for the chosen method, laid out like the standard planner: one block per day, each
    // step its own tick box, progress counted in energy. Ideal termed-war week: 4 training days,
    // 2 war prep days, 1 war day.
    const w = rows.find(r => r.m.id === sel).w;
    let checks = {};
    try { checks = JSON.parse(localStorage.getItem(gpWeekKey()) || '{}'); } catch (e) { /* none */ }
    // jump sessions spread over the 4 training days (1 -> day 1, 2 -> days 1 & 3, 3 -> days 1-3, 4 -> every day)
    const jumpDayOf = {}; // training day index (0-3) -> session number
    for (let k = 0; k < chosen.sessions; k++) jumpDayOf[Math.floor(k * 4 / chosen.sessions)] = k;
    const restTotal = w.restEnergy;
    const restPerDay = Math.round(restTotal / 4);
    const fillsFor = (energy) => { // natural energy split into bars, like the standard planner
        const out = [];
        for (let left = Math.round(energy), i = 1; left > 0; i++) { const part = Math.min(inp.fill, left); out.push({ label: `Natural energy fill #${i} (${gpN(part)} E) — at your normal happy`, value: part }); left -= part; }
        return out;
    };
    const blocks = [];
    for (let i = 0; i < 4; i++) {
        const day = `d${i + 1}`;
        const items = [];
        const s = jumpDayOf[i] !== undefined ? w.perSession[jumpDayOf[i]] : null;
        let note = '';
        if (s) {
            note = `${chosen.name}: happy ≈ ${gpN(s.peak)}, estimated +${gpN(s.gain)} ${inp.stat} from this jump.`;
            gpJumpSteps(chosen, inp).forEach((label, n) => items.push({ key: `${day}s${n}`, label, value: 0 }));
            const jumpTrain = chosen.refill ? s.energy - inp.fill : s.energy;
            items.push({ key: `${day}train`, label: `Train: spend ${gpN(jumpTrain)} E`, value: jumpTrain });
            if (chosen.refill) items.push({ key: `${day}refill`, label: `Spend 25 points on an energy refill and train again (${gpN(inp.fill)} E)`, value: inp.fill });
        }
        if (chosen.id === 'natural') {
            // The natural energy day: bars through the day (Xanax with the morning and evening ones first) plus a refill.
            const names = ['Morning', 'Lunch', 'Evening', 'Night'];
            const xanAt = [0, 2, 1, 3];
            const withBar = new Set(xanAt.filter(b => b < inp.bars).slice(0, inp.xan));
            for (let b = 0; b < inp.bars; b++) {
                items.push({ key: `${day}b${b}`, label: `${names[b]}: natural energy bar (${gpN(inp.fill)} E)`, value: inp.fill });
                if (withBar.has(b)) items.push({ key: `${day}x${b}`, label: `${names[b]}: Xanax (250 E)`, value: 250 });
            }
            for (let x = withBar.size; x < inp.xan; x++) items.push({ key: `${day}xe${x}`, label: 'Extra Xanax (250 E)', value: 250 });
            if (inp.refill) items.push({ key: `${day}ref`, label: `Energy refill (${gpN(inp.fill)} E)`, value: inp.fill });
        } else {
            fillsFor(restPerDay).forEach((it, n) => items.push({ key: `${day}n${n}`, label: it.label, value: it.value }));
        }
        blocks.push({ title: `Training day ${i + 1}`, note, items });
    }
    blocks.push({ title: 'War prep day 1', note: 'No gym in this ideal week — get ready for the war.', items: [] });
    blocks.push({ title: 'War prep day 2', note: 'No gym in this ideal week — get ready for the war.', items: [] });
    blocks.push({ title: 'War day', note: 'Hit! (Only when we have a termed war — this is the ideal week.)', items: [] });

    $('gp-plan').innerHTML = blocks.map(b => `
        <div class="stat" style="margin-bottom:10px;">
            <div class="k">${esc(b.title)}</div>
            ${b.note ? `<div class="s" style="margin:4px 0 8px;line-height:1.5;">${esc(b.note)}</div>` : ''}
            ${b.items.map(it => `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;">
                <input type="checkbox" class="gp-check" data-k="${it.key}" data-value="${it.value}" ${checks[it.key] ? 'checked' : ''} style="width:auto;">
                ${esc(it.label)}
            </label>`).join('')}
        </div>`).join('');
    $('gp-plan').querySelectorAll('.gp-check').forEach(cb => cb.addEventListener('change', () => {
        checks[cb.dataset.k] = cb.checked;
        try { localStorage.setItem(gpWeekKey(), JSON.stringify(checks)); } catch (e) { /* not critical */ }
        renderGpProgress();
    }));
    renderGpProgress();
    const gap = inp.weekly - w.energyUsed;
    const reqNote = gap > 0 ? `<div style="color:var(--danger);font-size:13px;margin-top:4px;">That is ${gpN(gap)} E short of your minimum of ${gpN(inp.weekly)} E a week — add a bar, a Xanax or a refill.</div>` : `<div style="color:var(--reagent);font-size:13px;margin-top:4px;">Meets your minimum of ${gpN(inp.weekly)} E a week.</div>`;
    $('gp-summary').innerHTML = `<b>${esc(chosen.name)}</b> for a week: about <b style="color:var(--reagent);">+${gpN(w.gain)} ${inp.stat}</b> from ${gpN(w.energyUsed)} energy${w.priced ? `, jump items ≈ <b>${gpMoney(w.cost)}</b>` : ''}.${reqNote}`;
}

// The steps before the training itself, per method (shortened from the jump guide below).
function gpJumpSteps(m, inp) {
    const items = Object.entries(m.items).map(([k, q]) => `${q}× ${GP_ITEMS[k]}`).join(' + ');
    const peak = Math.min(99999, (inp.base + m.addHappy) * 2);
    const steps = [`Have everything ready: ${items}`];
    if (m.items.xanax === 1) steps.push('Take 1 Xanax and wait out the drug cooldown (6–8 h)');
    else if (m.items.xanax) steps.push(`Stack ${m.items.xanax} Xanax back-to-back to reach 1,000 E, then wait out all the cooldowns`);
    else steps.push(`Wait until your energy bar is full (${gpN(inp.fill)} E)`);
    steps.push('Wait until just past a :00 / :15 / :30 / :45 reset');
    const main = m.items.lollipop ? `all ${m.items.lollipop} Lollipops` : m.items.choco ? `all ${m.items.choco} Big Boxes of Chocolate Bars` : `all ${m.items.edvd} Erotic DVDs`;
    steps.push(`Take ${main}`);
    steps.push(`Use the Ecstasy — it doubles your happy (about ${gpN(peak)})`);
    return steps;
}
function renderGpProgress() {
    let done = 0, total = 0;
    document.querySelectorAll('#gp-plan .gp-check').forEach(cb => { const v = parseInt(cb.dataset.value, 10) || 0; total += v; if (cb.checked) done += v; });
    $('gp-progress').textContent = `${gpN(done)} / ${gpN(total)} E`;
    $('gp-progress-fill').style.width = `${total ? Math.min(100, done / total * 100) : 0}%`;
}

async function loadGymPlanner() {
    if (!$('gp-s').value) gpAutofill();
    await gpLoadPrices();
    renderGymPlanner();
}
['gp-stat', 'gp-s', 'gp-base', 'gp-e', 'gp-g', 'gp-perk', 'gp-weekly', 'gp-fill', 'gp-job', 'gp-bars', 'gp-xan', 'gp-refill'].forEach(id => {
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

// The group buttons override the automatic group; "Automatic" goes back to the member's own battle stats.
['a', 'b'].forEach(g => $(`eg-group-${g}`).addEventListener('click', () => {
    try { localStorage.setItem(GP_GROUP_KEY, g); } catch (e) { /* not critical */ }
    $('gp-weekly').dataset.group = ''; renderGymPlanner();
}));
$('gp-group-auto').addEventListener('click', () => {
    try { localStorage.removeItem(GP_GROUP_KEY); } catch (e) { /* not critical */ }
    $('gp-weekly').dataset.group = ''; renderGymPlanner();
});
$('gp-show-jumps').addEventListener('click', () => {
    let on = false;
    try { on = localStorage.getItem('wwl_gym_show_jumps') === '1'; localStorage.setItem('wwl_gym_show_jumps', on ? '0' : '1'); } catch (e) { /* not critical */ }
    renderGymPlanner();
});
