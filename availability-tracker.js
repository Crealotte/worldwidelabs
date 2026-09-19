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
    // Big, hard-to-miss banner above each grid while viewing in local time, so nobody mistakes
    // their own hours for TCT (or vice versa) when ticking boxes or reading the heatmap.
    const showBanner = avLocal && supported;
    const bannerText = showBanner
        ? `🌍 You're viewing YOUR LOCAL TIME (${avZoneName(avLocalOffset())}) — not TCT. Boxes you tick are saved as the matching TCT hour.`
        : '';
    for (const id of ['av-tz-banner', 'av-tz-banner-2']) {
        $(id).style.display = showBanner ? 'block' : 'none';
        $(id).textContent = bannerText;
    }
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

let avSelected = null; // { day, hour } — the summary slot whose signups are currently shown

function renderAvSummaryGrid() {
    const maxCount = Math.max(1, ...Object.values(avSummary).map(s => s.count));
    const el = $('av-summary-body');
    el.innerHTML = avBuildTable((day, hour) => {
        const s = avSummary[`${day}-${hour}`];
        const count = s ? s.count : 0;
        const bg = count ? `rgba(53,217,155,${(0.15 + (count / maxCount) * 0.65).toFixed(2)})` : 'transparent';
        const title = `${avTctLabel(day, hour)} — ${s ? s.names.join(', ') : 'nobody yet'}`;
        const sel = avSelected && avSelected.day === day && avSelected.hour === hour ? ' av-cell-selected' : '';
        return `<td class="av-cell av-summary-cell${count ? ' av-clickable' : ''}${sel}" style="background:${bg};" data-day="${day}" data-hour="${hour}" title="${esc(title)}">${count || ''}</td>`;
    });
    el.querySelectorAll('.av-clickable').forEach(cell => {
        cell.addEventListener('click', () => {
            avSelected = { day: Number(cell.dataset.day), hour: Number(cell.dataset.hour) };
            renderAvSummaryGrid(); // re-render so the selection highlight moves
            renderAvDetail();
        });
    });
    renderAvDetail();
}

// Who signed up for the picked slot, each name linked to their Torn profile — so a leader can
// ping exactly the right people when it's time. "Copy names" gives a plain comma-separated list.
function renderAvDetail() {
    const el = $('av-detail');
    const s = avSelected && avSummary?.[`${avSelected.day}-${avSelected.hour}`];
    if (!s) { el.style.display = 'none'; el.innerHTML = ''; return; }
    const offset = avOffset();
    const idx = avSelected.day * 24 + avSelected.hour + offset;
    const localNote = offset !== 0
        ? ` <span style="color:var(--muted);font-weight:400;">(${esc(avColLabel(Math.floor(idx / 24), offset))} ${avPad(((idx % 24) + 24) % 24)}:00 your time)</span>`
        : '';
    el.style.display = 'block';
    el.innerHTML = `
        <div class="av-detail-box">
            <div style="font-weight:700;margin-bottom:8px;">${esc(avTctLabel(avSelected.day, avSelected.hour))}${localNote} — ${s.count} available</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
                ${s.names.map((n, i) => `<a class="chip" style="text-decoration:none;" target="_blank" rel="noopener" href="https://www.torn.com/profiles.php?XID=${esc(s.ids?.[i] ?? '')}">${esc(n)}</a>`).join('')}
            </div>
            <button class="ghost small" id="av-copy-names">Copy names</button>
            <button class="ghost small" id="av-close-detail">Close</button>
        </div>`;
    $('av-copy-names').addEventListener('click', () => {
        navigator.clipboard.writeText(s.names.join(', ')).then(() => toast('Names copied'));
    });
    $('av-close-detail').addEventListener('click', () => {
        avSelected = null;
        renderAvSummaryGrid();
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
