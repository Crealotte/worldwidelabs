// availability-tracker.js — WorldWideLabs War Availability Tracker (frontend).
// Open to every member, not leader-gated — everyone marks their own day/hour slots for the window
// after being matched, before the war starts. Leaders/council additionally see the whole faction
// added up per slot (backend only includes that `summary` for a leader-tier key, see
// api/war-payout.js's 'availability-get' action), so this page shows more to a leader than to a
// regular member from the exact same load, no separate leader page needed.
//
// Everything is STORED in TCT (Torn City Time = UTC) as "day-hour" slots, relative to the tracker's
// start date — that never changes, so leaders always see one consistent picture. The "show in my
// timezone" toggle is purely a display/click mapping on top of that: a local-time cell is just
// translated to whichever TCT slot it falls on before being read or saved.
'use strict';

let avConfig = null; // { startDate, days } from the backend, or null if no tracker is active
let avMine = {}; // my own slots: "day-hour" (TCT) -> true
let avSummary = null; // "day-hour" (TCT) -> { count, names } — present only when the caller is a leader
const AV_TZ_KEY = 'wwl_av_local_tz';
let avLocal = false; // show/click in my own timezone instead of TCT
try { avLocal = localStorage.getItem(AV_TZ_KEY) === '1'; } catch (e) { /* storage blocked — just default to TCT */ }

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

const avPad = n => String(n).padStart(2, '0');
function avStartParts() { return avConfig.startDate.split('-').map(Number); } // [y, m, d]

// My timezone's offset from UTC in hours, evaluated in the middle of the tracker's window (a
// couple of days is far too short for a DST change to matter in practice). Fractional offsets
// (e.g. India's +5:30) can't line up with whole-hour slots, so those report as unsupported.
function avLocalOffset() {
    const [y, m, d] = avStartParts();
    const mid = new Date(Date.UTC(y, m - 1, d + Math.floor(avConfig.days / 2), 12));
    return -mid.getTimezoneOffset() / 60;
}
function avOffsetSupported() { return Number.isInteger(avLocalOffset()); }
function avOffset() { return (avLocal && avOffsetSupported()) ? avLocalOffset() : 0; }
function avZoneName(offset) { return offset === 0 && !avLocal ? 'TCT' : `UTC${offset >= 0 ? '+' : ''}${offset}`; }

// A column's date label. In TCT mode that's the UTC calendar date; in local mode it's the local one.
function avColLabel(col, offset) {
    const [y, m, d] = avStartParts();
    const fmt = { weekday: 'short', day: '2-digit', month: 'short' };
    if (!avLocal || offset === 0) return new Date(Date.UTC(y, m - 1, d + col)).toLocaleDateString(undefined, { ...fmt, timeZone: 'UTC' });
    return new Date(y, m - 1, d + col).toLocaleDateString(undefined, fmt);
}

// "00:00 - 01:00" rather than a bare hour — wraps midnight -> "23:00 - 00:00" correctly.
function avHourLabel(h) { return `${avPad(h)}:00 - ${avPad((h + 1) % 24)}:00`; }

// What a slot is in TCT, for tooltips — so someone viewing in local time can still see the TCT
// equivalent (what leaders/the war itself run on).
function avTctLabel(day, hour) {
    const [y, m, d] = avStartParts();
    const date = new Date(Date.UTC(y, m - 1, d + day)).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
    return `${date} ${avPad(hour)}:00 TCT`;
}

function renderAvailabilityPage() {
    $('av-start-panel').style.display = avSummary !== null ? 'block' : 'none'; // leader-only, inferred from whether summary came back at all
    if (!avConfig) {
        $('av-none-msg').style.display = 'block';
        $('av-grid-panel').style.display = 'none';
        $('av-tz-bar').style.display = 'none';
        return;
    }
    $('av-none-msg').style.display = 'none';
    $('av-grid-panel').style.display = 'block';
    renderAvTzBar();
    renderAvGrid();
    $('av-summary-panel').style.display = avSummary ? 'block' : 'none';
    if (avSummary) renderAvSummaryGrid();
}

function renderAvTzBar() {
    const bar = $('av-tz-bar');
    const supported = avOffsetSupported();
    bar.style.display = 'block';
    $('av-tz-toggle').checked = avLocal && supported;
    $('av-tz-toggle').disabled = !supported;
    const offset = avLocalOffset();
    $('av-tz-note').textContent = !supported
        ? `(your timezone, UTC${offset >= 0 ? '+' : ''}${offset}, has a half-hour offset that can't line up with hourly slots — showing TCT)`
        : avLocal
            ? `— showing your local time (${avZoneName(offset)}). Everything is still saved in TCT, so leaders see it in TCT; hover a box for its TCT time.`
            : '— currently showing TCT (Torn City Time, UTC).';
}

// Builds a table for either grid. In TCT mode that's plainly `days` columns x 24 rows; in local
// mode the same absolute hours get re-bucketed into LOCAL days, which can spill into one extra
// column at the edge (e.g. UTC+2: the last two TCT hours of the final day land on the next local
// day) — so column range is derived from the offset rather than assumed. A cell that falls outside
// the tracker's window entirely is rendered disabled instead of clickable.
function avBuildTable(cellHtml) {
    const offset = avOffset();
    const total = avConfig.days * 24;
    const minCol = Math.floor(offset / 24);
    const maxCol = Math.floor((total - 1 + offset) / 24);
    let html = '<table class="av-table"><thead><tr><th></th>';
    for (let c = minCol; c <= maxCol; c++) html += `<th>${esc(avColLabel(c, offset))}</th>`;
    html += '</tr></thead><tbody>';
    for (let row = 0; row < 24; row++) {
        html += `<tr><td class="av-hour-label">${avHourLabel(row)}</td>`;
        for (let c = minCol; c <= maxCol; c++) {
            const idx = c * 24 + row - offset; // absolute TCT hour index from the tracker's start
            html += (idx < 0 || idx >= total) ? '<td class="av-cell av-cell-off"></td>' : cellHtml(Math.floor(idx / 24), idx % 24);
        }
        html += '</tr>';
    }
    return html + '</tbody></table>';
}

function renderAvGrid() {
    $('av-grid-body').innerHTML = avBuildTable((day, hour) => {
        const mine = !!avMine[`${day}-${hour}`];
        return `<td class="av-cell${mine ? ' av-cell-mine' : ''}" data-day="${day}" data-hour="${hour}" title="${esc(avTctLabel(day, hour))}"></td>`;
    });
    $('av-grid-body').querySelectorAll('.av-cell:not(.av-cell-off)').forEach(cell => {
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
    const maxCount = Math.max(1, ...Object.values(avSummary).map(s => s.count));
    $('av-summary-body').innerHTML = avBuildTable((day, hour) => {
        const s = avSummary[`${day}-${hour}`];
        const count = s ? s.count : 0;
        const bg = count ? `rgba(53,217,155,${(0.15 + (count / maxCount) * 0.65).toFixed(2)})` : 'transparent';
        const title = `${avTctLabel(day, hour)} — ${s ? s.names.join(', ') : 'nobody yet'}`;
        return `<td class="av-cell av-summary-cell" style="background:${bg};" title="${esc(title)}">${count || ''}</td>`;
    });
}

$('av-tz-toggle').addEventListener('change', () => {
    avLocal = $('av-tz-toggle').checked;
    try { localStorage.setItem(AV_TZ_KEY, avLocal ? '1' : '0'); } catch (e) { /* not critical */ }
    if (avConfig) renderAvailabilityPage();
});

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
