// Competition page (Faction menu) — the full standings of every competition for the running newsletter period and
// the last finished one, open to every member (the newsletter only lists the winners and points here). Backend:
// mo-standings in lib/memberOverview.js, built from stored data only.
'use strict';

let cpData = null;
let cpPeriod = null;

const cpFmt = ts => new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

async function loadCompetition() {
    const st = $('cp-status');
    st.className = 'status ok'; st.textContent = cpData ? '' : 'Loading the standings…';
    try {
        const res = await fetch('/api/war-payout', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: apiKey, action: 'mo-standings' }),
        });
        const r = await res.json();
        if (r.error) throw new Error(r.error);
        cpData = r;
        if (!cpData[cpPeriod]) cpPeriod = cpData.now ? 'now' : 'last'; // opens on the running period when there is one
        st.textContent = '';
        renderCompetition();
    } catch (e) { st.className = 'status err'; st.textContent = e.message; }
}

function renderCompetition() {
    if (!cpData) return;
    const p = cpData[cpPeriod];
    $('cp-period').innerHTML = ['now', 'last'].filter(k => cpData[k]).map(k => {
        const x = cpData[k];
        return `<option value="${k}" ${k === cpPeriod ? 'selected' : ''}>${k === 'now' ? 'Running now' : 'Last finished'} — ${cpFmt(x.start)} → ${cpFmt(x.running ? x.end : x.end - 86400)}${x.running ? ' (so far)' : ''}</option>`;
    }).join('');
    const medal = ['🥇', '🥈', '🥉'];
    const num = v => Math.round(v).toLocaleString();
    const row = (r, i) => `<div style="display:flex;gap:8px;font-size:13px;padding:2px 0;"><span style="min-width:28px;color:var(--muted);">${medal[i] || `${i + 1}.`}</span><span style="flex:1;">${esc(r.name)}</span><span style="font-family:var(--mono);">${num(r.value)}</span></div>`;
    $('cp-body').innerHTML = p.categories.map(c => {
        const top = c.rows.slice(0, 10), rest = c.rows.slice(10);
        return `<div class="panel" style="margin:0;">
            <h3 style="margin:0 0 8px;">${esc(c.label)}</h3>
            ${!c.known ? '<div style="color:var(--muted);font-size:12px;">Not recorded for this period yet.</div>'
                : !c.rows.length ? '<div style="color:var(--muted);font-size:12px;">Nobody has scored in this one yet.</div>'
                : top.map(row).join('') + (rest.length ? `<details style="margin-top:6px;"><summary style="cursor:pointer;color:var(--muted);font-size:12px;">Show the other ${rest.length}</summary>${rest.map((r, i) => row(r, i + 10)).join('')}</details>` : '')}
        </div>`;
    }).join('');
}

$('cp-period').addEventListener('change', () => { cpPeriod = $('cp-period').value; renderCompetition(); });
