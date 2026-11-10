// ownerdash.js — (1) every logged-in person's browser reports which WWL pages they open, in small batches (for the owner dashboard), and (2) the owner's dashboard page:
// which role of which faction uses which page, how many people were there each day, and what each server action costs in hosting CPU (sampled).
// Reporting is cheap on purpose (the hosting has a monthly CPU limit): visits are only counted in memory and sent in one call at most every 10 minutes, or when the tab is left. Nothing is sent for a test person.
// The server side is in api/war-payout.js (actions 'track' and 'dash-stats').
'use strict';

const odPending = {};
let odLast = 0, odCount = 0;
async function odFlush(unloading) {
    const pages = { ...odPending };
    if (!Object.keys(pages).length || typeof apiKey === 'undefined' || !apiKey || /^test:/.test(apiKey)) return;
    Object.keys(odPending).forEach(k => delete odPending[k]); odCount = 0; odLast = Date.now();
    try { await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: !!unloading, body: JSON.stringify({ key: apiKey, action: 'track', pages }) }); } catch (e) { /* a lost batch is only a missing count */ }
}
function wwlTrackPage(page) {
    if (!page || typeof apiKey === 'undefined' || !apiKey || /^test:/.test(apiKey)) return;
    odPending[page] = (odPending[page] || 0) + 1; odCount++;
    if (odCount >= 12 && Date.now() - odLast > 600000) odFlush(false);
}
// leaving the tab sends what is waiting, but at most once every 3 minutes (switching tabs a lot must not make a call each time; what is left waits for the next send)
const odLeave = () => { if (Date.now() - odLast > 180000) odFlush(true); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') odLeave(); });
window.addEventListener('pagehide', odLeave);
setInterval(() => { if (odCount && Date.now() - odLast > 600000) odFlush(false); }, 300000);

// ---- the owner's dashboard ----
let odDays = 7;
async function odFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}
const odPageName = p => { const el = document.querySelector(`.nav-item[data-page="${p}"]`); const t = el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; return t || p; };
async function loadOwnerDash() {
    const st = $('od-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    const r = await odFetch({ action: 'dash-stats', days: odDays });
    if (r.error) { st.className = 'status err'; st.textContent = r.error; return; }
    st.textContent = ''; st.className = 'status';
    odRender(r);
}
function odRender(r) {
    const fname = f => r.names[f] ? `${esc(r.names[f])} <span style="color:var(--muted);font-size:11px;">[${esc(f)}]</span>` : `Faction ${esc(f)}`;
    const factions = [...new Set(r.rows.map(x => x.f).concat(r.people.map(x => x.f)))];
    const roles = [...new Set(r.rows.map(x => x.r))].sort((a, b) => r.rows.filter(x => x.r === b).reduce((s, x) => s + x.n, 0) - r.rows.filter(x => x.r === a).reduce((s, x) => s + x.n, 0));
    const tile = (l, v) => `<div style="padding:8px 14px;border:1px solid var(--line);border-radius:8px;"><div style="color:var(--muted);font-size:11px;">${l}</div><b style="font-size:18px;font-family:var(--mono);">${v}</b></div>`;
    const sel = `<select id="od-days">${[[1, 'Today'], [7, 'Last 7 days'], [30, 'Last 30 days']].map(([v, l]) => `<option value="${v}" ${v === odDays ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const views = r.rows.reduce((s, x) => s + x.n, 0), peopleAll = r.people.reduce((s, x) => s + x.n, 0);
    const facSections = factions.map(f => {
        const rows = r.rows.filter(x => x.f === f), tot = rows.reduce((s, x) => s + x.n, 0), ppl = r.people.filter(x => x.f === f);
        const byPage = {}; rows.forEach(x => { byPage[x.p] = (byPage[x.p] || 0) + x.n; });
        const top = Object.entries(byPage).sort((a, b) => b[1] - a[1]).slice(0, 8);
        const dd = r.daily.filter(x => x.f === f);
        return `<div class="panel"><h3 style="margin-top:0;">${fname(f)}</h3>
            <div style="font-size:13px;margin-bottom:6px;">${tot.toLocaleString('en-US')} page views · people (by role): ${ppl.map(x => `${esc(x.r)} <b>${x.n}</b>`).join(', ') || 'none'}</div>
            <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">People a day: ${dd.map(x => `${esc(x.day.slice(5))} <b>${x.n}</b>`).join(' · ') || 'no data'}</div>
            <div style="font-size:13px;">Most used: ${top.map(([p, n]) => `${esc(odPageName(p))} <b>${n}</b>`).join(' · ') || 'nothing yet'}</div></div>`;
    }).join('');
    const pages = {}; r.rows.forEach(x => { (pages[x.p] = pages[x.p] || { t: 0 }); pages[x.p].t += x.n; pages[x.p][x.r] = (pages[x.p][x.r] || 0) + x.n; });
    const pageRows = Object.entries(pages).sort((a, b) => b[1].t - a[1].t);
    const td = 'padding:3px 10px 3px 0;';
    $('od-body').innerHTML = `<div class="panel" style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;">${sel}${tile('Page views', views.toLocaleString('en-US'))}${tile('Factions', factions.length)}${tile('Person-roles seen', peopleAll)}
            <span style="font-size:12px;color:var(--muted);max-width:420px;">A person is counted once per day per faction and role; the counts start from the day this dashboard went live. Views are sent by each person's browser in small batches, so the last few minutes can be missing.</span></div>
        ${facSections || '<div class="panel" style="color:var(--muted);font-size:13px;">No visits recorded yet: they appear after members have opened WWL pages (batches are sent every few minutes or when a tab is left).</div>'}
        <div class="panel" style="overflow-x:auto;"><h3 style="margin-top:0;">Pages by role</h3>
            ${pageRows.length ? `<table style="border-collapse:collapse;font-size:12px;"><tr style="color:var(--muted);text-align:left;"><th style="${td}">Page</th><th style="${td}">Views</th>${roles.map(x => `<th style="${td}">${esc(x)}</th>`).join('')}</tr>
            ${pageRows.map(([p, o]) => `<tr style="border-top:1px solid var(--line);"><td style="${td}">${esc(odPageName(p))}</td><td style="${td}font-family:var(--mono);"><b>${o.t}</b></td>${roles.map(x => `<td style="${td}font-family:var(--mono);">${o[x] || ''}</td>`).join('')}</tr>`).join('')}</table>` : '<span style="color:var(--muted);font-size:13px;">Nothing yet.</span>'}
            <div style="font-size:11px;color:var(--muted);margin-top:6px;">All factions together; the sections above split it per faction.</div></div>
        <div class="panel" style="overflow-x:auto;"><h3 style="margin-top:0;">Server cost by action</h3>
            <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">1 request in 10 is timed, so calls are an estimate. The hosting's free limit is 4 hours of CPU a month: the actions with the most CPU seconds are the ones to make cheaper. Covers up to the last 12 days.</div>
            ${r.cpu && r.cpu.length ? `<table style="border-collapse:collapse;font-size:12px;"><tr style="color:var(--muted);text-align:left;"><th style="${td}">Action</th><th style="${td}">Calls (est.)</th><th style="${td}">Avg ms</th><th style="${td}">Avg CPU ms</th><th style="${td}">CPU seconds (est.)</th></tr>
            ${r.cpu.map(x => `<tr style="border-top:1px solid var(--line);"><td style="${td}">${esc(x.action)}</td><td style="${td}font-family:var(--mono);">${x.calls.toLocaleString('en-US')}</td><td style="${td}font-family:var(--mono);">${x.avgMs}</td><td style="${td}font-family:var(--mono);">${x.avgCpuMs}</td><td style="${td}font-family:var(--mono);"><b>${x.cpuSec}</b></td></tr>`).join('')}</table>` : '<span style="color:var(--muted);font-size:13px;">No timing recorded yet.</span>'}</div>`;
    $('od-days').addEventListener('change', e => { odDays = +e.target.value; loadOwnerDash(); });
}
