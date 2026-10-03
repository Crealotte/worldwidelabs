// energy-tracker.js — the "Energy tracker" page under Training: the energy every member has trained in the gym, per
// stat, over the last days — like Torn Intel's leaderboard. One row per member (avg per day, STR / SPD / DEF / DEX,
// total); click a row to open the day-by-day rows. Everyone can follow themselves (their own row is marked and
// summed at the top) and the faction. Backend: 'energy-board' in api/war-payout.js, data from lib/steadfast.js
// (the days imported from Intel + our own daily counters).
'use strict';

// The two "first Sunday of the month" newsletter cycles — the same definition Member Overview and the
// Newsletter page use. `cyclesBack` 0 = the period still running (up to today), 1 = the last one that
// actually finished.
function etFirstSunday(y, m) { const f = new Date(Date.UTC(y, m, 1)); return new Date(Date.UTC(y, m, 1 + (7 - f.getUTCDay()) % 7)); }
function etNewsletterRange(cyclesBack) {
    const now = new Date();
    let end = etFirstSunday(now.getUTCFullYear(), now.getUTCMonth());
    if (end > now) end = etFirstSunday(now.getUTCFullYear(), now.getUTCMonth() - 1);
    // The running period starts at the latest first Sunday and runs up to today; each step back is the
    // finished period before it (first Sunday to first Sunday, whole days only).
    if (cyclesBack === 0) return { from: end.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
    for (let i = 1; i < cyclesBack; i++) end = etFirstSunday(end.getUTCFullYear(), end.getUTCMonth() - 1);
    const start = etFirstSunday(end.getUTCFullYear(), end.getUTCMonth() - 1);
    return { from: start.toISOString().slice(0, 10), to: new Date(end.getTime() - 86400e3).toISOString().slice(0, 10) };
}

let etData = null;
let etDays = 30;
// Defaults to the newsletter period still RUNNING (first Sunday up to today) rather than a rolling 30 days — that is the cycle
// being built right now, and opening the page already showing it means no re-pick (and no
// second fetch) is needed just to see the current numbers.
let etRange = { ...etNewsletterRange(0), period: 'now' }; // { from, to, period: 'now' | 'last' | undefined (a custom pick) }
let etOpen = new Set();
let etSort = { key: 'total', dir: 'desc' }; // sortable table state — see core.js's sortRows/wireSort

async function loadEnergyTracker() {
    const st = $('et-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    try {
        const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, action: 'energy-board', days: etDays, ...(etRange || {}) }) });
        const text = await res.text();
        let r; try { r = JSON.parse(text); } catch (e) { throw new Error(`Server problem (${res.status})`); }
        if (r.error) throw new Error(r.error);
        etData = r;
        st.textContent = ''; st.className = 'status';
        renderEnergyTracker();
    } catch (e) { st.className = 'status err'; st.textContent = e.message; }
}

const etK = n => (n >= 1000 ? `${(Math.round(n / 100) / 10).toFixed(1)}k` : n > 0 ? String(Math.round(n)) : '—');
const etSum = a => a.reduce((s, v) => s + v, 0);
const etDate = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { day: '2-digit', month: 'short', timeZone: 'UTC' });
// Same wording as Member Overview's own "Energy tier" column (member-overview.js) — 'high' = 1.5m+ total
// battle stats, 'low' = under. Read-only here (the edit dropdown stays a Member Overview thing).
const etTierLabel = tier => tier === 'high' ? '1.5m+' : tier === 'low' ? '&lt;1.5m' : 'not seen yet';

// One member's numbers over the shown days. A day's array is [STR, DEF, SPD, DEX]; Intel's column order is STR, SPD, DEF, DEX.
function etRow(id, m) {
    const totals = [0, 0, 0, 0];
    const days = Object.entries(m.days).sort((a, b) => b[0].localeCompare(a[0]));
    for (const [, arr] of days) arr.forEach((v, k) => { totals[k] += v; });
    const total = etSum(totals);
    const avg = etData.days ? total / etData.days : 0;
    // This member's own tier + weekly energy minimum — the SAME source as Member Overview's "Energy tier"
    // column (see api/war-payout.js's energy-board action): a leader's override, else auto-detected from
    // their own battle stats once they've opened their dashboard or the userscript. "Weekly average" is
    // just the daily average scaled to a week, so it compares like for like whatever period is picked.
    return { id, name: m.name || `#${id}`, totals, total, avg, weeklyAvg: avg * 7, weekly: m.weekly || null, tier: m.tier || null, days };
}

const etAccessors = {
    name: r => r.name.toLowerCase(),
    avg: r => r.avg,
    weeklyAvg: r => r.weeklyAvg,
    tier: r => r.tier === 'high' ? 2 : r.tier === 'low' ? 1 : 0,
    str: r => r.totals[0], spd: r => r.totals[2], def: r => r.totals[1], dex: r => r.totals[3],
    total: r => r.total,
};

function renderEnergyTracker() {
    let rows = Object.entries(etData.members).map(([id, m]) => etRow(id, m)).filter(r => r.total > 0 || r.id === etData.me);
    rows = sortRows(rows, etSort, etAccessors);
    document.querySelectorAll('.et-range').forEach(b => b.classList.toggle('active-toggle', !etRange && Number(b.dataset.days) === etDays));
    const iso = d => new Date(d * 86400e3).toISOString().slice(0, 10);
    $('et-from').value = iso(etData.fromDay); $('et-to').value = iso(etData.toDay);
    $('et-news').classList.toggle('active-toggle', etRange?.period === 'now');
    $('et-news-last').classList.toggle('active-toggle', etRange?.period === 'last');
    const label = etRange?.period === 'now' ? 'this newsletter period (so far)' : etRange?.period === 'last' ? 'last newsletter period'
        : etRange ? `${etDate(iso(etData.fromDay))} → ${etDate(iso(etData.toDay))}` : `last ${etData.days} days`;

    const mine = rows.find(r => r.id === etData.me);
    $('et-me').innerHTML = mine ? `
        <div class="grid3">
            <div class="stat"><div class="k">You — ${label}</div><div class="v good">${Math.round(mine.total).toLocaleString()}</div><div class="s">energy trained in the gym</div></div>
            <div class="stat"><div class="k">Per day</div><div class="v">${Math.round(mine.avg).toLocaleString()}</div><div class="s">on average</div></div>
            <div class="stat"><div class="k">Your place</div><div class="v">#${1 + rows.filter(r => r.total > mine.total).length}</div><div class="s">of ${rows.length}</div></div>
        </div>
        ${mine.weekly ? `<p style="color:var(--muted);font-size:12px;margin:8px 0 0;">Your weekly average is ${etK(mine.weeklyAvg)} E against your own weekly minimum of ${etK(mine.weekly)} E (${mine.tier ? etTierLabel(mine.tier).replace('&lt;', '<') : 'from your total battle stats'}) — <span style="color:${mine.weeklyAvg >= mine.weekly ? 'var(--reagent)' : 'var(--danger)'};font-weight:700;">${mine.weeklyAvg >= mine.weekly ? 'meeting it' : 'below it'}</span>.</p>`
            : `<p style="color:var(--muted);font-size:12px;margin:8px 0 0;">Open your Dashboard once to have your Energy tier and personal weekly minimum shown here and in the table below.</p>`}`
        : '<p style="color:var(--muted);margin:0;">No energy of yours has been counted in these days yet.</p>';

    const first = etData.firstSnapshotDay;
    const base = first
        ? `Counted from Torn Intel up to ${new Date((first) * 86400e3).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })}, and from our own daily counters after that.`
        : 'Only what was imported from Torn Intel so far — our own daily counting starts soon.';
    // Today's own number updates through the day (roughly hourly, whenever a leader has WWL open or the owner set up an hourly check) —
    // this says how fresh it is right now, since "today" is the one row that keeps moving.
    const upd = etData.todayUpdatedHour;
    $('et-note').textContent = base + (upd ? ` Today's row is up to date as of ${new Date(upd * 3600e3).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} TCT.` : '');

    // Weekly avg vs. this member's OWN weekly minimum (see etRow()): green if they're meeting it, red if
    // not, muted with a tooltip if their tier isn't known yet — never guessed.
    const reqCell = r => r.weekly
        ? `<td style="padding:5px 8px;text-align:right;font-family:var(--mono);font-weight:700;color:${r.weeklyAvg >= r.weekly ? 'var(--reagent)' : 'var(--danger)'};" title="Weekly minimum: ${etK(r.weekly)} E">${etK(r.weeklyAvg)}</td>`
        : `<td style="padding:5px 8px;text-align:right;font-family:var(--mono);color:var(--muted);" title="Energy tier not known yet — needs to open their dashboard once">${etK(r.weeklyAvg)}</td>`;
    $('et-table').innerHTML = rows.length ? `
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <thead><tr style="color:var(--muted);text-align:right;">
                <th data-sort="name" style="padding:4px 8px;text-align:left;">Member</th><th data-sort="avg" style="padding:4px 8px;">Avg E/day</th><th data-sort="weeklyAvg" style="padding:4px 8px;" title="Daily average scaled to a week, against this member's own weekly minimum">Weekly avg</th><th data-sort="tier" style="padding:4px 8px;" title="1.5m+ battle stats = 4,400 E/week, under = 2,200 E/week — same as Member Overview's Energy tier">Tier</th><th data-sort="str" style="padding:4px 8px;">STR Energy</th><th data-sort="spd" style="padding:4px 8px;">SPD Energy</th><th data-sort="def" style="padding:4px 8px;">DEF Energy</th><th data-sort="dex" style="padding:4px 8px;">DEX Energy</th><th data-sort="total" style="padding:4px 8px;">Total E</th>
            </tr></thead>
            <tbody>${rows.map((r, i) => `
                <tr class="et-row" data-id="${esc(r.id)}" style="border-top:1px solid var(--line);cursor:pointer;${r.id === etData.me ? 'background:rgba(53,217,155,.10);' : ''}">
                    <td style="padding:5px 8px;text-align:left;white-space:nowrap;"><span style="color:var(--muted);">${i + 1}</span> <b>${esc(r.name)}</b> <span style="color:var(--muted);font-size:11px;">${etOpen.has(r.id) ? '▾' : '▸'}</span></td>
                    <td style="padding:5px 8px;text-align:right;color:var(--muted);font-family:var(--mono);">${etK(r.avg)}</td>
                    ${reqCell(r)}
                    <td style="padding:5px 8px;text-align:right;font-size:12px;color:var(--muted);">${etTierLabel(r.tier)}</td>
                    <td style="padding:5px 8px;text-align:right;font-family:var(--mono);">${etK(r.totals[0])}</td>
                    <td style="padding:5px 8px;text-align:right;font-family:var(--mono);">${etK(r.totals[2])}</td>
                    <td style="padding:5px 8px;text-align:right;font-family:var(--mono);">${etK(r.totals[1])}</td>
                    <td style="padding:5px 8px;text-align:right;font-family:var(--mono);">${etK(r.totals[3])}</td>
                    <td style="padding:5px 8px;text-align:right;font-family:var(--mono);font-weight:700;color:var(--reagent);">${etK(r.total)}</td>
                </tr>
                ${etOpen.has(r.id) ? r.days.filter(([, a]) => etSum(a) > 0).map(([date, a]) => `
                <tr style="background:var(--bench-2);">
                    <td style="padding:3px 8px 3px 26px;text-align:left;color:var(--muted);">${etDate(date)}</td><td></td><td></td><td></td>
                    <td style="padding:3px 8px;text-align:right;font-family:var(--mono);">${etK(a[0])}</td><td style="padding:3px 8px;text-align:right;font-family:var(--mono);">${etK(a[2])}</td>
                    <td style="padding:3px 8px;text-align:right;font-family:var(--mono);">${etK(a[1])}</td><td style="padding:3px 8px;text-align:right;font-family:var(--mono);">${etK(a[3])}</td>
                    <td style="padding:3px 8px;text-align:right;font-family:var(--mono);">${etK(etSum(a))}</td></tr>`).join('') : ''}`).join('')}
            </tbody>
        </table>` : '<p style="color:var(--muted);margin:0;">Nothing counted yet — the numbers appear once the first days are imported or counted.</p>';
    wireSort($('et-table'), etSort, rows, etAccessors, renderEnergyTracker);
    $('et-table').querySelectorAll('.et-row').forEach(tr => tr.addEventListener('click', () => {
        etOpen.has(tr.dataset.id) ? etOpen.delete(tr.dataset.id) : etOpen.add(tr.dataset.id);
        renderEnergyTracker();
    }));
}

document.querySelectorAll('.et-range').forEach(b => b.addEventListener('click', () => { etDays = Number(b.dataset.days); etRange = null; loadEnergyTracker(); }));

// the calendar: pick any from / to date (both days included)
$('et-apply').addEventListener('click', () => {
    const from = $('et-from').value, to = $('et-to').value;
    if (!from || !to || to < from) { toast('Pick a from date that is not after the to date.'); return; }
    etRange = { from, to }; etOpen = new Set(); loadEnergyTracker();
});
// the newsletter period still running: from the latest first Sunday of a month until today
$('et-news').addEventListener('click', () => { etRange = { ...etNewsletterRange(0), period: 'now' }; etOpen = new Set(); loadEnergyTracker(); });
// the last newsletter period that actually finished — also this page's own default on open
$('et-news-last').addEventListener('click', () => { etRange = { ...etNewsletterRange(1), period: 'last' }; etOpen = new Set(); loadEnergyTracker(); });
