// energy-tracker.js — the "Energy tracker" page under Training: the energy every member has trained in the gym, per
// stat, over the last days — like Torn Intel's leaderboard. One row per member (avg per day, STR / SPD / DEF / DEX,
// total); click a row to open the day-by-day rows. Everyone can follow themselves (their own row is marked and
// summed at the top) and the faction. Backend: 'energy-board' in api/war-payout.js, data from lib/steadfast.js
// (the days imported from Intel + our own daily counters).
'use strict';

let etData = null;
let etDays = 30;
let etRange = null; // { from, to } as YYYY-MM-DD when a calendar range is picked, else null (= the last etDays days)
let etOpen = new Set();

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

// One member's numbers over the shown days. A day's array is [STR, DEF, SPD, DEX]; Intel's column order is STR, SPD, DEF, DEX.
function etRow(id, m) {
    const totals = [0, 0, 0, 0];
    const days = Object.entries(m.days).sort((a, b) => b[0].localeCompare(a[0]));
    for (const [, arr] of days) arr.forEach((v, k) => { totals[k] += v; });
    const total = etSum(totals);
    return { id, name: m.name || `#${id}`, totals, total, avg: etData.days ? total / etData.days : 0, days };
}

function renderEnergyTracker() {
    const rows = Object.entries(etData.members).map(([id, m]) => etRow(id, m)).filter(r => r.total > 0 || r.id === etData.me).sort((a, b) => b.total - a.total);
    document.querySelectorAll('.et-range').forEach(b => b.classList.toggle('active-toggle', !etRange && Number(b.dataset.days) === etDays));
    const iso = d => new Date(d * 86400e3).toISOString().slice(0, 10);
    $('et-from').value = iso(etData.fromDay); $('et-to').value = iso(etData.toDay);
    $('et-news').classList.toggle('active-toggle', !!etRange && etRange.news);
    const label = etRange ? `${etDate(iso(etData.fromDay))} → ${etDate(iso(etData.toDay))}` : `last ${etData.days} days`;

    const mine = rows.find(r => r.id === etData.me);
    $('et-me').innerHTML = mine ? `
        <div class="grid3">
            <div class="stat"><div class="k">You — ${label}</div><div class="v good">${Math.round(mine.total).toLocaleString()}</div><div class="s">energy trained in the gym</div></div>
            <div class="stat"><div class="k">Per day</div><div class="v">${Math.round(mine.avg).toLocaleString()}</div><div class="s">on average</div></div>
            <div class="stat"><div class="k">Your place</div><div class="v">#${rows.indexOf(mine) + 1}</div><div class="s">of ${rows.length}</div></div>
        </div>` : '<p style="color:var(--muted);margin:0;">No energy of yours has been counted in these days yet.</p>';

    const first = etData.firstSnapshotDay;
    $('et-note').textContent = first
        ? `Counted from Torn Intel up to ${new Date((first) * 86400e3).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })}, and from our own daily counters after that.`
        : 'Only what was imported from Torn Intel so far — our own daily counting starts soon.';

    $('et-table').innerHTML = rows.length ? `
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <thead><tr style="color:var(--muted);text-align:right;">
                <th style="padding:4px 8px;text-align:left;">Member</th><th style="padding:4px 8px;">Avg E/day</th><th style="padding:4px 8px;">STR Energy</th><th style="padding:4px 8px;">SPD Energy</th><th style="padding:4px 8px;">DEF Energy</th><th style="padding:4px 8px;">DEX Energy</th><th style="padding:4px 8px;">Total E</th>
            </tr></thead>
            <tbody>${rows.map((r, i) => `
                <tr class="et-row" data-id="${esc(r.id)}" style="border-top:1px solid var(--line);cursor:pointer;${r.id === etData.me ? 'background:rgba(53,217,155,.10);' : ''}">
                    <td style="padding:5px 8px;text-align:left;white-space:nowrap;"><span style="color:var(--muted);">${i + 1}</span> <b>${esc(r.name)}</b> <span style="color:var(--muted);font-size:11px;">${etOpen.has(r.id) ? '▾' : '▸'}</span></td>
                    <td style="padding:5px 8px;text-align:right;color:var(--muted);font-family:var(--mono);">${etK(r.avg)}</td>
                    <td style="padding:5px 8px;text-align:right;font-family:var(--mono);">${etK(r.totals[0])}</td>
                    <td style="padding:5px 8px;text-align:right;font-family:var(--mono);">${etK(r.totals[2])}</td>
                    <td style="padding:5px 8px;text-align:right;font-family:var(--mono);">${etK(r.totals[1])}</td>
                    <td style="padding:5px 8px;text-align:right;font-family:var(--mono);">${etK(r.totals[3])}</td>
                    <td style="padding:5px 8px;text-align:right;font-family:var(--mono);font-weight:700;color:var(--reagent);">${etK(r.total)}</td>
                </tr>
                ${etOpen.has(r.id) ? r.days.filter(([, a]) => etSum(a) > 0).map(([date, a]) => `
                <tr style="background:var(--bench-2);">
                    <td style="padding:3px 8px 3px 26px;text-align:left;color:var(--muted);">${etDate(date)}</td><td></td>
                    <td style="padding:3px 8px;text-align:right;font-family:var(--mono);">${etK(a[0])}</td><td style="padding:3px 8px;text-align:right;font-family:var(--mono);">${etK(a[2])}</td>
                    <td style="padding:3px 8px;text-align:right;font-family:var(--mono);">${etK(a[1])}</td><td style="padding:3px 8px;text-align:right;font-family:var(--mono);">${etK(a[3])}</td>
                    <td style="padding:3px 8px;text-align:right;font-family:var(--mono);">${etK(etSum(a))}</td></tr>`).join('') : ''}`).join('')}
            </tbody>
        </table>` : '<p style="color:var(--muted);margin:0;">Nothing counted yet — the numbers appear once the first days are imported or counted.</p>';
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
// the current newsletter month: from the latest first Sunday of a month until today
$('et-news').addEventListener('click', () => {
    const now = new Date();
    const firstSunday = (y, m) => { const f = new Date(Date.UTC(y, m, 1)); return new Date(Date.UTC(y, m, 1 + (7 - f.getUTCDay()) % 7)); };
    let s = firstSunday(now.getUTCFullYear(), now.getUTCMonth());
    if (s > now) s = firstSunday(now.getUTCFullYear(), now.getUTCMonth() - 1);
    etRange = { from: s.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10), news: true }; etOpen = new Set(); loadEnergyTracker();
});
