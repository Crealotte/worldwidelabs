// war-reports.js — the "War reports" page under War: all past war payout reports of the faction, newest
// first, with the opponent, win / loss, the score, the link to the full report, and the pay details
// (leaders see every member's pay, everyone else only their own line). Backend: lib/warReports.js.
'use strict';

const wrMoney = n => `$${Math.round(Number(n) || 0).toLocaleString()}`;
const wrDate = ts => new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

async function loadWarReports() {
    const st = $('wr-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    try {
        const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, action: 'receipts-report' }) });
        const text = await res.text();
        let r; try { r = JSON.parse(text); } catch (e) { throw new Error(`Server problem (${res.status})`); }
        if (r.error) throw new Error(r.error);
        st.textContent = ''; st.className = 'status';
        renderWarReports(r);
    } catch (e) { st.className = 'status err'; st.textContent = e.message; }
}

function renderWarReports(r) {
    if (!r.reports.length) { $('wr-list').innerHTML = '<div class="panel"><p style="color:var(--muted);margin:0;">No payout reports have been saved yet.</p></div>'; return; }
    const wins = r.reports.filter(x => x.won === true).length, losses = r.reports.filter(x => x.won === false).length;
    const head = `<div style="color:var(--muted);font-size:13px;margin-bottom:10px;">${r.reports.length} reports · <span style="color:var(--reagent);">${wins} won</span> · <span style="color:var(--danger);">${losses} lost</span></div>`;
    $('wr-list').innerHTML = head + r.reports.map(x => {
        const result = x.won === true ? '<span style="color:var(--reagent);font-weight:700;">Win</span>' : x.won === false ? '<span style="color:var(--danger);font-weight:700;">Loss</span>' : '<span style="color:var(--muted);">Result unknown</span>';
        const score = x.scoreUs != null && x.scoreThem != null ? `<span style="color:var(--muted);font-family:var(--mono);font-size:12px;">${Math.round(x.scoreUs).toLocaleString()} – ${Math.round(x.scoreThem).toLocaleString()}</span>` : '';
        const rows = x.rows || [];
        const details = rows.length ? `
            <details style="margin-top:8px;">
                <summary class="av-sum"><span style="font-size:13px;">Pay details${r.leader ? ` (${rows.length} members · ${wrMoney(x.totalPaid)} paid)` : ''}</span></summary>
                <div class="table-scroll" style="max-height:340px;overflow:auto;margin-top:6px;"><table style="width:100%;font-size:13px;border-collapse:collapse;">
                    <thead><tr style="color:var(--muted);text-align:left;"><th style="padding:4px 8px;">Member</th><th style="padding:4px 8px;">War hits</th><th style="padding:4px 8px;">Chain hits</th><th style="padding:4px 8px;">Penalty</th><th style="padding:4px 8px;text-align:right;">Paid</th></tr></thead>
                    <tbody>${rows.slice().sort((a, b) => (b.net || 0) - (a.net || 0)).map(m => `<tr style="border-top:1px solid var(--line);">
                        <td style="padding:4px 8px;">${esc(m.name)}</td><td style="padding:4px 8px;font-family:var(--mono);">${m.warHits ?? 0}</td><td style="padding:4px 8px;font-family:var(--mono);">${m.overflowHits ?? 0}</td>
                        <td style="padding:4px 8px;font-family:var(--mono);">${m.penalty ? wrMoney(m.penalty) : '—'}</td><td style="padding:4px 8px;font-family:var(--mono);text-align:right;font-weight:700;color:var(--reagent);">${wrMoney(m.net)}</td></tr>`).join('')}</tbody>
                </table></div>
            </details>`
            : (r.leader ? '' : '<div style="color:var(--muted);font-size:12px;margin-top:8px;">You weren\'t paid in this war.</div>');
        return `
        <div class="panel">
            <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;">
                <h3 style="margin:0;">vs ${esc(x.opponent)}</h3>
                ${result} ${score}
                <span style="color:var(--muted);font-size:12px;">${wrDate(x.warEnd)}</span>
                <a href="/?receipt=${esc(x.id)}" target="_blank" rel="noopener" class="ghost small" style="margin-left:auto;text-decoration:none;padding:4px 10px;">Open report ↗</a>
            </div>
            ${details}
        </div>`;
    }).join('');
}
