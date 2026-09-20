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
