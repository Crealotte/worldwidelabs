// tenant.js — "My rental": what a tenant of a Labs private island (rent-to-buy) sees after logging in with their own Torn API key: their contract, what they paid, what is left, the next payment and the
// rental terms to accept. Only their own contract (see tenHandle in lib/labstracking.js); nothing of the owner's costs or profit.
'use strict';

let tenData = null;
async function tenFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}
function checkTenantAccess(acc) {
    const el = document.querySelector('.nav-item[data-page="tenant"]');
    if (el) el.style.display = acc && acc.tenant ? '' : 'none';
}
async function loadTenant() {
    const st = $('tenant-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    const r = await tenFetch({ action: 'ten-my' });
    if (r.error) { st.className = 'status err'; st.textContent = r.error; return; }
    st.textContent = ''; st.className = 'status';
    tenData = r;
    tenRender();
}
function tenRender() {
    const r = tenData, m = n => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`, today = r.today;
    const card = c => {
        const pct = c.goal ? Math.min(100, Math.round(c.paid / c.goal * 100)) : 0, left = Math.max(0, c.goal - c.paid);
        const days = Math.round((Date.parse(`${c.due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
        const pays = c.payments.slice().reverse();
        return `<div class="panel" style="margin:0 0 12px;"><div style="display:flex;gap:16px;flex-wrap:wrap;align-items:baseline;"><h3 style="margin:0;">🏝️ ${esc(c.tier)} happy private island</h3><span style="color:var(--muted);font-size:12px;">contract since ${esc(c.startDate)}${c.months ? ` · ${c.months} months in total` : ''}</span></div>
            <div style="display:flex;gap:26px;flex-wrap:wrap;font-size:13px;margin:10px 0;"><div><div style="color:var(--muted);font-size:11px;">Every 30 days</div><b style="font-family:var(--mono);">${m(c.rent + c.equity)}</b><div style="font-size:11px;color:var(--muted);">${m(c.rent)} rent + ${m(c.equity)} equity</div></div>
                <div><div style="color:var(--muted);font-size:11px;">Equity built up</div><b style="font-family:var(--mono);color:var(--reagent);">${m(c.paid)}</b></div><div><div style="color:var(--muted);font-size:11px;">Still to pay for the island</div><b style="font-family:var(--mono);">${m(left)}</b></div><div><div style="color:var(--muted);font-size:11px;">Full price</div><b style="font-family:var(--mono);">${m(c.goal)}</b></div></div>
            <div style="height:10px;background:var(--bench-2);border-radius:5px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:var(--reagent);"></div></div><div style="font-size:12px;color:var(--muted);margin:4px 0 8px;">${pct}% of the full price</div>
            <div style="font-size:13px;line-height:1.7;">Next payment: <b>${esc(c.due)}</b> <span style="color:${days <= 5 ? '#e0a030' : 'var(--muted)'};">(${days < 0 ? `${-days} day${days === -1 ? '' : 's'} late` : days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`})</span>${c.leaseDays !== null ? `<br>Your lease on Torn: <b>${c.leaseDays} days</b> left at the last check` : ''}${c.offered ? '<br><span style="color:#e0a030;">A lease extension was offered to you: accept it in Torn.</span>' : ''}</div>
            ${pays.length ? `<details style="margin-top:8px;"><summary class="av-sum" style="font-size:12px;color:var(--muted);">Your payments (${pays.length})</summary>${pays.map(p => `<div style="display:flex;gap:14px;font-size:12px;padding:1px 0;"><span style="font-family:var(--mono);">${esc(p.date)}</span><span style="font-family:var(--mono);">${m((p.rent || 0) + (p.equity || 0))}</span><span style="color:var(--muted);">(${m(p.rent)} rent + ${m(p.equity)} equity)</span></div>`).join('')}</details>` : ''}</div>`;
    };
    $('tenant-body').innerHTML = `${termsPanel('property', r.terms)}${r.contracts.map(card).join('')}<div style="font-size:11px;color:var(--muted);">The equity and payments are what the Labs owner has recorded. The lease days come from the last check of the island on Torn.</div>`;
    termsWire(loadTenant);
}
