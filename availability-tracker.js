// availability-tracker.js — WorldWideLabs War Availability Tracker (frontend).
// Open to every member, not leader-gated — everyone marks their own day/hour slots (Torn City
// Time = UTC) for the window after being matched, before the war starts. Leaders/council
// additionally see the whole faction added up per slot (backend only includes that `summary` for
// a leader-tier key, see api/war-payout.js's 'availability-get' action), so this page shows more
// to a leader than to a regular member from the exact same load, no separate leader page needed.
'use strict';

let avConfig = null; // { startDate, days } from the backend, or null if no tracker is active
let avMine = {}; // my own slots: "day-hour" -> true
let avSummary = null; // "day-hour" -> { count, names } — present only when the caller is a leader

// Posts to /api/war-payout, not its own endpoint — merged in to stay under Vercel Hobby's
// 12-Serverless-Function-per-deployment limit, same reason War Badges lives there too.
async function avFetch(body) {
    const res = await fetch('/api/war-payout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: apiKey, ...body }),
    });
    return res.json();
}

async function loadAvailability() {
    const st = $('av-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    try {
        const result = await avFetch({ action: 'availability-get' });
        if (result.error) throw new Error(result.error);
        avConfig = result.config;
        avMine = result.mine || {};
        avSummary = result.summary || null; // only ever present for a leader-tier key
        st.textContent = ''; st.className = 'status';
        renderAvailabilityPage();
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    }
}

// A day column's date, computed from the tracker's own start date + offset — displayed, never
// relied on for anything else (slots are keyed by plain day-offset, not a date string, so this is
// purely cosmetic labeling).
function avDayLabel(startDate, dayIdx) {
    const d = new Date(`${startDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dayIdx);
    return d.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
}

function renderAvailabilityPage() {
    $('av-start-panel').style.display = avSummary !== null ? 'block' : 'none'; // leader-only, inferred from whether summary came back at all
    if (!avConfig) {
        $('av-none-msg').style.display = 'block';
        $('av-grid-panel').style.display = 'none';
        return;
    }
    $('av-none-msg').style.display = 'none';
    $('av-grid-panel').style.display = 'block';
    renderAvGrid();
    $('av-summary-panel').style.display = avSummary ? 'block' : 'none';
    if (avSummary) renderAvSummaryGrid();
}

function avGridHeader(days) {
    let html = '<thead><tr><th></th>';
    for (let d = 0; d < days; d++) html += `<th>${esc(avDayLabel(avConfig.startDate, d))}</th>`;
    return html + '</tr></thead>';
}

function renderAvGrid() {
    const days = avConfig.days;
    let html = `<table class="av-table">${avGridHeader(days)}<tbody>`;
    for (let h = 0; h < 24; h++) {
        html += `<tr><td class="av-hour-label">${h}:00</td>`;
        for (let d = 0; d < days; d++) {
            const mine = !!avMine[`${d}-${h}`];
            html += `<td class="av-cell${mine ? ' av-cell-mine' : ''}" data-day="${d}" data-hour="${h}"></td>`;
        }
        html += '</tr>';
    }
    $('av-grid-body').innerHTML = html + '</tbody></table>';
    $('av-grid-body').querySelectorAll('.av-cell').forEach(cell => {
        cell.addEventListener('click', () => toggleAvCell(Number(cell.dataset.day), Number(cell.dataset.hour), cell));
    });
}

// Instant-save, optimistic — flips the box immediately, reverts with a toast if the save fails,
// rather than making the leader/member wait on a round-trip for every single click.
async function toggleAvCell(day, hour, cellEl) {
    const key = `${day}-${hour}`;
    const newVal = !avMine[key];
    if (newVal) avMine[key] = true; else delete avMine[key];
    cellEl.classList.toggle('av-cell-mine', newVal);
    try {
        const result = await avFetch({ action: 'availability-set', day, hour, available: newVal });
        if (result.error) throw new Error(result.error);
    } catch (e) {
        if (newVal) delete avMine[key]; else avMine[key] = true;
        cellEl.classList.toggle('av-cell-mine', !!avMine[key]);
        toast(`Couldn't save that: ${e.message}`);
    }
}

function renderAvSummaryGrid() {
    const days = avConfig.days;
    const maxCount = Math.max(1, ...Object.values(avSummary).map(s => s.count));
    let html = `<table class="av-table">${avGridHeader(days)}<tbody>`;
    for (let h = 0; h < 24; h++) {
        html += `<tr><td class="av-hour-label">${h}:00</td>`;
        for (let d = 0; d < days; d++) {
            const s = avSummary[`${d}-${h}`];
            const count = s ? s.count : 0;
            const bg = count ? `rgba(53,217,155,${(0.15 + (count / maxCount) * 0.65).toFixed(2)})` : 'transparent';
            const title = s ? s.names.join(', ') : 'Nobody yet';
            html += `<td class="av-cell av-summary-cell" style="background:${bg};" title="${esc(title)}">${count || ''}</td>`;
        }
        html += '</tr>';
    }
    $('av-summary-body').innerHTML = html + '</tbody></table>';
}

$('av-start-btn').addEventListener('click', async () => {
    const startDate = $('av-start-date').value;
    const days = Number($('av-days').value) || 5;
    if (!startDate) { toast('Pick a start date first.'); return; }
    if (!confirm('Start a new tracker? This wipes everyone\'s current entries.')) return;
    const btn = $('av-start-btn');
    btn.disabled = true;
    try {
        const result = await avFetch({ action: 'availability-start', startDate, days });
        if (result.error) throw new Error(result.error);
        toast('Tracker started');
        await loadAvailability();
    } catch (e) {
        toast(`Couldn't start it: ${e.message}`);
    } finally {
        btn.disabled = false;
    }
});
