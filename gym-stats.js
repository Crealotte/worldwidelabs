// gym-stats.js — the "Gym stats" page under Training: a graph of the member's own battle stats over
// time, the split between the four stats, the growth over recent weeks, and personal goals with an
// estimate of when each will be reached. Backend: gym-* actions in lib/gymStats.js.
// The history is one snapshot per day, saved from the member's own key whenever they open WWL, so it
// grows over time (and is filled in from Torn's past stats on the first visit when Torn allows it).
'use strict';

const GS_STATS = ['strength', 'defense', 'speed', 'dexterity'];
const GS_COLORS = { strength: '#3b6fd4', defense: '#e5531d', speed: '#f5a30b', dexterity: '#1f9d3a', total: '#a01fa8' };
const GS_LABEL = { strength: 'Strength', defense: 'Defense', speed: 'Speed', dexterity: 'Dexterity', total: 'Total' };
let gsHistory = []; // [[day, str, def, spd, dex], ...] oldest first
let gsGoals = {};
let gsRangeDays = 180;
let gsHidden = new Set(['total']); // lines switched off in the legend

const gsN = n => Math.round(n).toLocaleString();
const gsDate = day => new Date(day * 86400e3).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
const gsValue = (row, key) => key === 'total' ? row[1] + row[2] + row[3] + row[4] : row[1 + GS_STATS.indexOf(key)];

async function gsFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}

async function loadGymStats() {
    const st = $('gs-status');
    st.className = 'status ok'; st.textContent = 'Loading your stats…';
    const r = await gsFetch({ action: 'gym-snapshot' });
    if (r.error) { st.className = 'status err'; st.textContent = r.error; return; }
    gsHistory = r.history || [];
    gsGoals = r.goals || {};
    st.textContent = ''; st.className = 'status';
    GS_STATS.forEach(s => { const el = $(`gs-goal-${s}`); if (document.activeElement !== el) el.value = gsGoals[s] ? gsN(gsGoals[s]) : ''; });
    renderGymStats();
    initGymSim(); // the growth simulator below the goals, filled in with these numbers
}

// The value of a stat `days` ago (the closest snapshot at or before then, else the earliest one).
function gsAgo(key, days) {
    if (!gsHistory.length) return null;
    const target = gsHistory[gsHistory.length - 1][0] - days;
    let row = gsHistory[0];
    for (const r of gsHistory) if (r[0] <= target) row = r; else break;
    return { value: gsValue(row, key), day: row[0] };
}

function renderGymStats() {
    const last = gsHistory[gsHistory.length - 1];
    if (!last) {
        $('gs-chart').innerHTML = '<p style="color:var(--muted);">Your battle stats couldn\'t be read yet. Open the page again in a moment.</p>';
        $('gs-stats').innerHTML = ''; $('gs-growth').innerHTML = ''; $('gs-goals').innerHTML = ''; $('gs-legend').innerHTML = '';
        return;
    }
    document.querySelectorAll('.gs-range').forEach(b => b.classList.toggle('active-toggle', Number(b.dataset.days) === gsRangeDays));

    // legend (click a name to show or hide its line)
    $('gs-legend').innerHTML = [...GS_STATS, 'total'].map(k => `
        <span class="gs-leg" data-k="${k}" style="cursor:pointer;${gsHidden.has(k) ? 'opacity:.4;text-decoration:line-through;' : ''}">
            <span style="display:inline-block;width:14px;height:8px;background:${GS_COLORS[k]};margin-right:5px;"></span>${GS_LABEL[k]}</span>`).join('');
    $('gs-legend').querySelectorAll('.gs-leg').forEach(el => el.addEventListener('click', () => { gsHidden.has(el.dataset.k) ? gsHidden.delete(el.dataset.k) : gsHidden.add(el.dataset.k); renderGymStats(); }));

    // chart: one polyline per stat over the chosen range (an inline SVG, no library)
    const from = gsRangeDays ? last[0] - gsRangeDays : gsHistory[0][0];
    const rows = gsHistory.filter(r => r[0] >= from);
    const keys = [...GS_STATS, 'total'].filter(k => !gsHidden.has(k));
    const W = 900, H = 320, L = 62, R = 12, T = 10, B = 28;
    const days0 = rows[0][0], span = Math.max(1, rows[rows.length - 1][0] - days0);
    const maxV = Math.max(1, ...rows.flatMap(r => keys.map(k => gsValue(r, k)))) * 1.05;
    const x = d => L + (d - days0) / span * (W - L - R);
    const y = v => T + (1 - v / maxV) * (H - T - B);
    let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;">`;
    for (let i = 0; i <= 4; i++) { // horizontal grid + labels
        const v = maxV * i / 4, yy = y(v);
        svg += `<line x1="${L}" y1="${yy}" x2="${W - R}" y2="${yy}" stroke="currentColor" stroke-opacity=".12"/><text x="${L - 6}" y="${yy + 4}" text-anchor="end" font-size="11" fill="currentColor" fill-opacity=".6">${v >= 1e6 ? (v / 1e6).toFixed(1) + 'm' : Math.round(v / 1e3) + 'k'}</text>`;
    }
    for (let i = 0; i <= 5; i++) { // date labels
        const d = days0 + span * i / 5;
        svg += `<text x="${x(d)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="currentColor" fill-opacity=".6">${gsDate(Math.round(d))}</text>`;
    }
    for (const k of keys) {
        const pts = rows.map(r => `${x(r[0]).toFixed(1)},${y(gsValue(r, k)).toFixed(1)}`).join(' ');
        svg += rows.length > 1 ? `<polyline points="${pts}" fill="none" stroke="${GS_COLORS[k]}" stroke-width="2"/>` : '';
        const lr = rows[rows.length - 1];
        svg += `<circle cx="${x(lr[0]).toFixed(1)}" cy="${y(gsValue(lr, k)).toFixed(1)}" r="3.5" fill="${GS_COLORS[k]}"/>`;
    }
    $('gs-chart').innerHTML = svg + '</svg>';
    $('gs-chart-note').textContent = gsHistory.length < 3
        ? `Your history starts ${gsDate(gsHistory[0][0])} — the graph fills in as you open WWL each day.`
        : `${gsHistory.length} snapshots, from ${gsDate(gsHistory[0][0])}.`;

    // battle stats table with each stat's share of the total
    const total = gsValue(last, 'total');
    $('gs-stats').innerHTML = `<table style="width:100%;font-size:14px;border-collapse:collapse;">${GS_STATS.map(k => `
        <tr style="border-top:1px solid var(--line);"><td style="padding:5px 4px;"><b style="color:${GS_COLORS[k]};">${GS_LABEL[k]}</b></td>
        <td style="padding:5px 4px;font-family:var(--mono);text-align:right;">${gsN(gsValue(last, k))}</td>
        <td style="padding:5px 4px;color:var(--muted);text-align:right;">${(gsValue(last, k) / total * 100).toFixed(0)}%</td></tr>`).join('')}
        <tr style="border-top:1px solid var(--line);"><td style="padding:5px 4px;"><b>Total</b></td><td style="padding:5px 4px;font-family:var(--mono);text-align:right;font-weight:700;">${gsN(total)}</td><td></td></tr></table>`;

    // growth over the last week and month
    const grow = k => { const a = gsAgo(k, 7), b = gsAgo(k, 28), now = gsValue(last, k); return { w: a ? now - a.value : null, m: b ? now - b.value : null, wDays: a ? last[0] - a.day : 0, mDays: b ? last[0] - b.day : 0 }; };
    $('gs-growth').innerHTML = `<table style="width:100%;font-size:14px;border-collapse:collapse;"><tr style="color:var(--muted);font-size:12px;"><td></td><td style="text-align:right;">Last 7 days</td><td style="text-align:right;">Last 28 days</td></tr>${[...GS_STATS, 'total'].map(k => {
        const g = grow(k);
        return `<tr style="border-top:1px solid var(--line);"><td style="padding:5px 4px;"><b style="color:${GS_COLORS[k]};">${GS_LABEL[k]}</b></td>
            <td style="padding:5px 4px;font-family:var(--mono);text-align:right;">${g.w !== null && g.wDays ? '+' + gsN(g.w) : '—'}</td>
            <td style="padding:5px 4px;font-family:var(--mono);text-align:right;">${g.m !== null && g.mDays ? '+' + gsN(g.m) : '—'}</td></tr>`; }).join('')}</table>
        ${gsHistory.length < 2 ? '<p style="color:var(--muted);font-size:12px;margin:8px 0 0;">Growth shows once you have more than one day of history.</p>' : ''}`;

    // goals: progress and an estimate from the recent pace (last 28 days, or all the history there is)
    const goalRows = GS_STATS.filter(k => gsGoals[k]).map(k => {
        const now = gsValue(last, k), goal = gsGoals[k], pct = Math.min(100, now / goal * 100);
        const ref = gsAgo(k, 28), days = ref ? last[0] - ref.day : 0;
        const pace = ref && days >= 1 ? (now - ref.value) / days : 0; // stat points per day
        let eta;
        if (now >= goal) eta = '<span style="color:var(--reagent);">Reached! 🎉</span>';
        else if (pace <= 0) eta = '<span style="color:var(--muted);">No recent growth to estimate from</span>';
        else { const d = Math.ceil((goal - now) / pace); eta = `about <b>${d} day${d === 1 ? '' : 's'}</b> at your recent pace (${new Date((last[0] + d) * 86400e3).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })})`; }
        return `<div style="margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;gap:10px;font-size:14px;"><b style="color:${GS_COLORS[k]};">${GS_LABEL[k]}</b><span style="font-family:var(--mono);">${gsN(now)} / ${gsN(goal)} (${pct.toFixed(0)}%)</span></div>
            <div style="background:var(--bench-2);border-radius:4px;height:10px;margin:4px 0;"><div style="width:${pct.toFixed(1)}%;background:${GS_COLORS[k]};height:10px;border-radius:4px;"></div></div>
            <div style="font-size:13px;color:var(--muted);">${eta}</div></div>`;
    });
    $('gs-goals').innerHTML = goalRows.length ? goalRows.join('') : '<p style="color:var(--muted);margin:0;">No goals set yet — fill in a target above and press Save.</p>';
}

document.querySelectorAll('.gs-range').forEach(b => b.addEventListener('click', () => { gsRangeDays = Number(b.dataset.days); renderGymStats(); }));
GS_STATS.forEach(s => $(`gs-goal-${s}`).addEventListener('blur', () => { const n = Number($(`gs-goal-${s}`).value.replace(/[^\d]/g, '')); $(`gs-goal-${s}`).value = n ? gsN(n) : ''; }));
$('gs-goal-save').addEventListener('click', async () => {
    const goals = {};
    GS_STATS.forEach(s => { const n = Number($(`gs-goal-${s}`).value.replace(/[^\d]/g, '')); if (n > 0) goals[s] = n; });
    const r = await gsFetch({ action: 'gym-goals-save', goals });
    if (r.error) { toast(r.error); return; }
    gsGoals = r.goals || {};
    toast('Goals saved');
    renderGymStats();
});

// ---- Growth simulator: ArcaneReaper's "Compounding Gains Simulator", rebuilt in WWL (same formula, same inputs), filled in from your own stats ----
const GSIM_KEY = 'wwl_gsim';
// the Steadfast rotation (see the newsletter): per month, the two stats on the top perk first, then the two on the lower one (swapped on the first Sunday; calendar month is close enough here)
const GSIM_STEADFAST = [
    ['speed', 'dexterity', 'strength', 'defense'], ['dexterity', 'strength', 'defense', 'speed'], ['strength', 'defense', 'speed', 'dexterity'], ['defense', 'speed', 'dexterity', 'strength'],
    ['speed', 'dexterity', 'strength', 'defense'], ['dexterity', 'strength', 'defense', 'speed'], ['strength', 'defense', 'speed', 'dexterity'], ['defense', 'speed', 'dexterity', 'strength'],
    ['speed', 'dexterity', 'strength', 'defense'], ['dexterity', 'strength', 'defense', 'speed'], ['strength', 'defense', 'speed', 'dexterity'], ['defense', 'speed', 'dexterity', 'strength'],
];
const gsSteadfast = stat => { const i = GSIM_STEADFAST[new Date().getUTCMonth()].indexOf(stat); return i < 0 ? 0 : i < 2 ? 8 : 3; };
let gsim = null; // the simulator's inputs; primary is per stat in the order below
const GSIM_PRIMARY = ['speed', 'strength', 'defense', 'dexterity'];

function gsimDefaults(stat) {
    const primary = GSIM_PRIMARY.map(s => s === stat ? gsSteadfast(stat) : 0); // only the stat you train carries its own Steadfast perk
    return { stat, startCustom: false, start: 0, dots: 5, happy: 5025, energy: 650, milestone: 0, mileCustom: false, primary, secondary: [0, 0], tertiary: 0 };
}
function gsimLoad() {
    let saved = null; try { saved = JSON.parse(localStorage.getItem(GSIM_KEY) || 'null'); } catch (e) { saved = null; }
    gsim = { ...gsimDefaults(saved && GS_STATS.includes(saved.stat) ? saved.stat : 'strength'), ...(saved || {}) };
    if (!Array.isArray(gsim.primary) || gsim.primary.length !== 4) gsim.primary = gsimDefaults(gsim.stat).primary;
    if (!Array.isArray(gsim.secondary) || gsim.secondary.length !== 2) gsim.secondary = [0, 0];
}
function gsimSave() { try { localStorage.setItem(GSIM_KEY, JSON.stringify(gsim)); } catch (e) { /* the simulator works without saving */ } }

// the formula of the original tool: gain per day from the current stat, gym dots, happy, energy a day and the faction bonus
const gsimGain = (stat, dots, happy, energy, perk) => (((dots * 4) * ((0.00019106 * stat) + (0.00226263 * happy) + 0.55)) / 150 * 10) * (energy / 10) * perk;
const gsimPerk = () => 1 + (gsim.primary.reduce((a, b) => a + b, 0) + gsim.secondary.reduce((a, b) => a + b, 0) + gsim.tertiary) / 100;
const GSIM_MAX_DAYS = 50000;
function gsimDaysTo(target) {
    if (gsim.start >= target) return 0;
    const perk = gsimPerk(); let s = gsim.start;
    for (let d = 1; d <= GSIM_MAX_DAYS; d++) { s += gsimGain(s, gsim.dots, gsim.happy, gsim.energy, perk); if (s >= target) return d; }
    return null; // not within 50,000 days
}
const gsShort = n => { const a = Math.abs(n); return a >= 1e9 ? (n / 1e9).toFixed(3).replace(/\.?0+$/, '') + 'b' : a >= 1e6 ? (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'm' : a >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.?0+$/, '') + 'k' : String(Math.round(n)); };
const gsParse = str => { const m = String(str).trim().replace(/,/g, '').toLowerCase().match(/^([\d.]+)\s*([kmb]?)$/); if (!m) return NaN; return parseFloat(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[m[2]] || 1); };
const gsDay = days => new Date(Date.now() + Math.round(days) * 86400e3).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

// start from the member's real numbers: the stat's value from the latest snapshot, a goal (or a round step up) as the milestone
function gsimFillFromStats() {
    const last = gsHistory[gsHistory.length - 1]; if (!last) return;
    const cur = gsValue(last, gsim.stat);
    if (!gsim.startCustom) gsim.start = cur;
    if (!gsim.mileCustom) {
        const goal = gsGoals[gsim.stat];
        if (goal && goal > gsim.start) gsim.milestone = goal;
        else { const mag = Math.pow(10, Math.floor(Math.log10(Math.max(1, gsim.start)))); gsim.milestone = Math.ceil((gsim.start * 1.5) / mag) * mag; }
    }
}

function renderGsimInputs() {
    const box = $('gs-sim-inputs'); if (!box) return;
    const num = (id, label, v, min, max, step) => `<div class="field" style="margin:0;min-width:130px;flex:1;"><label for="${id}">${label}</label><input id="${id}" type="number" min="${min}" max="${max}" step="${step}" value="${v}"></div>`;
    const txt = (id, label, v) => `<div class="field" style="margin:0;min-width:150px;flex:1;"><label for="${id}">${label}</label><input id="${id}" type="text" inputmode="decimal" autocomplete="off" value="${esc(gsN(v))}"></div>`;
    box.innerHTML = `
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px;">
            <div class="field" style="margin:0;min-width:150px;flex:1;"><label for="gsim-stat">Stat to simulate</label><select id="gsim-stat">${GS_STATS.map(s => `<option value="${s}" ${gsim.stat === s ? 'selected' : ''}>${GS_LABEL[s]}</option>`).join('')}</select></div>
            ${txt('gsim-start', 'Starting stat', gsim.start)}${txt('gsim-mile', 'Milestone target', gsim.milestone)}
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px;">
            ${num('gsim-dots', 'Gym dots', gsim.dots, 1, 10, 0.1)}${num('gsim-happy', 'Happy when you train', gsim.happy, 1000, 10000, 25)}${num('gsim-energy', 'Energy per day', gsim.energy, 100, 1300, 10)}
        </div>
        <details style="margin-bottom:6px;"><summary class="av-sum" style="font-size:13px;">Faction perks <span id="gsim-perk-sum" style="color:var(--reagent);font-weight:700;"></span></summary>
            <p style="color:var(--muted);font-size:12px;margin:6px 0;">Filled with this month's Steadfast perk for the stat you train (${gsSteadfast(gsim.stat)}%). Change them if your faction perks are different: all of them are added up, as in the original tool.</p>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
                ${GSIM_PRIMARY.map((s, i) => num(`gsim-p${i}`, `${GS_LABEL[s]} training (%)`, gsim.primary[i], 0, 10, 1)).join('')}
                <div class="field" style="margin:0;min-width:160px;flex:1;"><label for="gsim-s0">Speed / Strength extra</label><select id="gsim-s0"><option value="0" ${gsim.secondary[0] ? '' : 'selected'}>0%</option><option value="5" ${gsim.secondary[0] ? 'selected' : ''}>5%</option></select></div>
                <div class="field" style="margin:0;min-width:160px;flex:1;"><label for="gsim-s1">Defense / Dexterity extra</label><select id="gsim-s1"><option value="0" ${gsim.secondary[1] ? '' : 'selected'}>0%</option><option value="5" ${gsim.secondary[1] ? 'selected' : ''}>5%</option></select></div>
                <div class="field" style="margin:0;min-width:160px;flex:1;"><label for="gsim-t">Extra on one stat</label><select id="gsim-t"><option value="0" ${gsim.tertiary ? '' : 'selected'}>None (0%)</option><option value="5" ${gsim.tertiary ? 'selected' : ''}>5% bonus</option></select></div>
            </div></details>`;
    const upd = () => { gsimSave(); renderGsimOut(); };
    $('gsim-stat').addEventListener('change', e => { const stat = e.target.value; gsim = { ...gsimDefaults(stat), dots: gsim.dots, happy: gsim.happy, energy: gsim.energy }; gsimFillFromStats(); gsimSave(); renderGsimInputs(); renderGsimOut(); });
    for (const [id, key, custom] of [['gsim-start', 'start', 'startCustom'], ['gsim-mile', 'milestone', 'mileCustom']]) {
        const el = $(id);
        el.addEventListener('input', () => { const v = gsParse(el.value); if (!isNaN(v) && v >= 0) { gsim[key] = v; gsim[custom] = true; upd(); } });
        el.addEventListener('blur', () => { el.value = gsN(gsim[key]); });
    }
    [['gsim-dots', 'dots'], ['gsim-happy', 'happy'], ['gsim-energy', 'energy']].forEach(([id, key]) => $(id).addEventListener('input', () => { const v = parseFloat($(id).value); if (!isNaN(v) && v > 0) { gsim[key] = v; upd(); } }));
    GSIM_PRIMARY.forEach((s, i) => $(`gsim-p${i}`).addEventListener('input', () => { const v = parseInt($(`gsim-p${i}`).value, 10); if (!isNaN(v)) { gsim.primary[i] = Math.max(0, Math.min(10, v)); upd(); } }));
    [0, 1].forEach(i => $(`gsim-s${i}`).addEventListener('change', e => { gsim.secondary[i] = parseInt(e.target.value, 10) || 0; upd(); }));
    $('gsim-t').addEventListener('change', e => { gsim.tertiary = parseInt(e.target.value, 10) || 0; upd(); });
}

function renderGsimOut() {
    const out = $('gs-sim-out'); if (!out) return;
    const perk = gsimPerk(), pct = Math.round((perk - 1) * 100);
    const sum = $('gsim-perk-sum'); if (sum) sum.textContent = `+${pct}% (×${perk.toFixed(2)})`;
    if (!(gsim.start > 0) || !(gsim.milestone > 0)) { out.innerHTML = '<p style="color:var(--muted);">Fill in a starting stat and a milestone to see the estimate.</p>'; return; }
    const days = gsimDaysTo(gsim.milestone), gain0 = gsimGain(gsim.start, gsim.dots, gsim.happy, gsim.energy, perk);
    // your real pace of the last 28 days for this stat, to compare with the simulator's first day
    const ref = gsAgo(gsim.stat, 28), last = gsHistory[gsHistory.length - 1], span = ref && last ? last[0] - ref.day : 0;
    const real = ref && span >= 1 ? (gsValue(last, gsim.stat) - ref.value) / span : null;
    // the curve: compound growth and a straight line at the first day's pace, up to the milestone day (or a year when it is already reached)
    const total = days ? Math.max(1, days) : 365;
    const step = Math.max(1, Math.ceil(total / 300)), pts = [[0, gsim.start, gsim.start]];
    for (let d = 1, s = gsim.start; d <= total; d++) { s += gsimGain(s, gsim.dots, gsim.happy, gsim.energy, perk); if (d % step === 0 || d === total) pts.push([d, s, gsim.start + gain0 * d]); }
    const W = 900, H = 280, L = 62, R = 12, T = 10, B = 28, maxV = Math.max(...pts.map(p => Math.max(p[1], p[2]))) * 1.05;
    const x = d => L + d / total * (W - L - R), y = v => T + (1 - v / maxV) * (H - T - B);
    let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;">`;
    for (let i = 0; i <= 4; i++) { const v = maxV * i / 4; svg += `<line x1="${L}" y1="${y(v)}" x2="${W - R}" y2="${y(v)}" stroke="currentColor" stroke-opacity=".12"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="currentColor" fill-opacity=".6">${gsShort(v)}</text>`; }
    for (let i = 0; i <= 5; i++) { const d = total * i / 5; svg += `<text x="${x(d)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="currentColor" fill-opacity=".6">day ${Math.round(d).toLocaleString()}</text>`; }
    svg += `<polyline points="${pts.map(p => `${x(p[0]).toFixed(1)},${y(p[2]).toFixed(1)}`).join(' ')}" fill="none" stroke="#9ca3af" stroke-width="1.5" stroke-dasharray="5 4"/><polyline points="${pts.map(p => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ')}" fill="none" stroke="${GS_COLORS[gsim.stat]}" stroke-width="2"/>`;
    out.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:8px 0;">
            <div style="background:var(--bench-2);border-radius:6px;padding:10px 12px;"><div style="color:var(--muted);font-size:12px;">Days to ${gsShort(gsim.milestone)}</div><div style="font-size:26px;font-weight:700;">${days === null ? '50,000+' : days === 0 ? 'reached' : gsN(days)}</div><div style="color:var(--muted);font-size:11px;">${days ? gsDay(days) : ''}</div></div>
            <div style="background:var(--bench-2);border-radius:6px;padding:10px 12px;"><div style="color:var(--muted);font-size:12px;">Gain on day one</div><div style="font-size:26px;font-weight:700;">+${gsN(gain0)}</div><div style="color:var(--muted);font-size:11px;">per day, ${GS_LABEL[gsim.stat]}</div></div>
            <div style="background:var(--bench-2);border-radius:6px;padding:10px 12px;"><div style="color:var(--muted);font-size:12px;">Your last 28 days</div><div style="font-size:26px;font-weight:700;">${real === null ? '—' : '+' + gsN(real)}</div><div style="color:var(--muted);font-size:11px;">per day, for comparison</div></div>
        </div>
        <div style="margin-top:8px;">${svg}</svg></div>
        <div style="display:flex;gap:14px;font-size:12px;color:var(--muted);margin:4px 0 12px;"><span><span style="display:inline-block;width:14px;height:3px;background:${GS_COLORS[gsim.stat]};margin-right:5px;vertical-align:middle;"></span>With compounding</span><span><span style="display:inline-block;width:14px;border-top:2px dashed #9ca3af;margin-right:5px;vertical-align:middle;"></span>Straight line at day one's pace</span></div>
        <table style="width:100%;font-size:13px;border-collapse:collapse;"><tr style="color:var(--muted);font-size:12px;text-align:left;"><td>Milestone</td><td style="text-align:right;">Days</td><td style="text-align:right;">Date</td></tr>
        ${[1e5, 5e5, 1e6, 5e6, 1e7, 5e7, 1e8, 5e8, 1e9].filter(t => t > gsim.start).map(t => { const d = gsimDaysTo(t); return `<tr style="border-top:1px solid var(--line);"><td style="padding:5px 4px;font-weight:600;">${gsShort(t)}</td><td style="padding:5px 4px;text-align:right;font-family:var(--mono);">${d === null ? '50,000+' : gsN(d)}</td><td style="padding:5px 4px;text-align:right;color:var(--muted);">${d === null ? '—' : gsDay(d)}</td></tr>`; }).join('')}</table>`;
}

function initGymSim() { // called after the stats are loaded: fill in the member's own numbers once, then draw
    if (!gsim) gsimLoad();
    if (!gsim.startCustom || !gsim.mileCustom) gsimFillFromStats();
    renderGsimInputs(); renderGsimOut();
}
