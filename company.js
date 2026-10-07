// company.js — the company side of WWL: the director's "My company" page (income, employees, stock, the standing Investment amount) and the owner's
// "Companies" page (register a company by its Torn ID, set the director's cut and the Investment amount). A company director logs in with their own key and
// sees ONLY this (enterDirectorMode); everything else is closed to them on the server too. Backend: co-* in api/war-payout.js, lib/company.js.
'use strict';

let directorMode = false, coOwner = false, coMyId = null;
async function coFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}
const coMoney = n => n == null ? '—' : `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const coN = n => n == null ? '—' : Math.round(n).toLocaleString('en-US');
const coAgo = ts => { if (!ts) return '—'; const s = Date.now() / 1000 - ts; return s < 3600 ? `${Math.max(1, Math.round(s / 60))} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };

// Called by login() with the answer of the server's access check: shows the "My company" / "Companies" menu items to those it concerns.
function checkCompanyAccess(acc) {
    coOwner = !!(acc && acc.owner);
    const mine = document.querySelector('.nav-item[data-page="company"]'), all = document.querySelector('.nav-item[data-page="companies"]');
    if (mine) mine.style.display = acc && (acc.director) ? '' : 'none';
    if (all) all.style.display = coOwner ? '' : 'none';
}
// A company director who is not in one of the allowed factions: WWL is just their company page.
function enterDirectorMode() {
    directorMode = true;
    document.querySelectorAll('nav.side .nav-item, nav.side .nav-group').forEach(el => { el.style.display = 'none'; });
    const mine = document.querySelector('.nav-item[data-page="company"]');
    if (mine) mine.style.display = '';
    goToPage('company');
}

// ---- the director's page ----
async function loadCompany() {
    const st = $('co-status');
    st.className = 'status ok'; st.textContent = 'Loading your company…';
    const r = await coFetch({ action: 'co-my', companyId: coMyId });
    if (r.error) { st.className = 'status err'; st.textContent = r.error; $('co-body').innerHTML = ''; return; }
    st.textContent = ''; st.className = 'status';
    coMyId = r.company.id;
    renderCompany(r);
}
function renderCompany(r) {
    const d = r.data, c = r.company;
    const tile = (k, v, sub) => `<div style="min-width:130px;"><div style="color:var(--muted);font-size:11px;">${k}</div><div style="font-weight:700;font-family:var(--mono);">${v}</div>${sub ? `<div style="color:var(--muted);font-size:11px;">${sub}</div>` : ''}</div>`;
    const inactive = (list, title, color) => `<div style="margin:6px 0;"><b style="font-size:13px;">${title}</b> ${list.length ? list.map(e => `<span class="chip" style="cursor:default;border-color:${color};">${esc(e.name)} <span style="color:var(--muted);font-size:11px;">${esc(e.rel)}</span></span>`).join(' ') : '<span style="color:var(--muted);font-size:13px;">none</span>'}</div>`;
    $('co-body').innerHTML = `
        ${r.companies.length > 1 ? `<div class="field" style="max-width:300px;"><label for="co-pick">Company</label><select id="co-pick">${r.companies.map(x => `<option value="${esc(x.id)}" ${x.id === c.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>` : ''}
        <div class="panel"><h3 style="margin-top:0;">${esc(d.name || c.name)}</h3>
            <div style="display:flex;gap:26px;flex-wrap:wrap;">
                ${tile('Daily income', coMoney(d.dailyIncome))}${tile('Weekly income', coMoney(d.weeklyIncome))}
                ${tile('Daily customers', coN(d.dailyCustomers))}${tile('Weekly customers', coN(d.weeklyCustomers))}
                ${tile('Employees', d.hired != null ? `${d.hired}${d.capacity ? ` / ${d.capacity}` : ''}` : '—')}
                ${tile('Wages a day', coMoney(d.wagesPerDay))}${tile('Advertising a day', coMoney(d.advertising))}
                ${tile('Bank', coMoney(d.bank ?? d.funds))}
                ${tile('Popularity', d.popularity != null ? `${coN(d.popularity)}%` : '—')}${tile('Efficiency', d.efficiency != null ? `${coN(d.efficiency)}%` : '—')}
            </div></div>
        <div class="panel"><h3 style="margin-top:0;">Investment amount</h3>
            ${c.investment > 0 ? `<p style="margin:0;">CreaLotte owes you <b style="font-family:var(--mono);">${coMoney(c.investment)}</b>${c.invNote ? ` <span style="color:var(--muted);">(${esc(c.invNote)})</span>` : ''}. This is taken off what you send, so the money only has to move once.</p>` : '<p style="margin:0;color:var(--muted);">Nothing to settle right now.</p>'}</div>
        <div class="panel"><h3 style="margin-top:0;">Who has been away</h3>
            ${inactive(d.inactive.day, 'Inactive 24–48 h', '#f0b432')}${inactive(d.inactive.long, 'Inactive over 48 h', 'var(--danger)')}</div>
        <div class="panel"><h3 style="margin-top:0;">Employees</h3>
            ${d.employees.length ? `<div style="overflow-x:auto;"><table style="width:100%;font-size:13px;border-collapse:collapse;"><thead><tr style="color:var(--muted);text-align:left;"><th style="padding:4px 8px;">Name</th><th style="padding:4px 8px;">Position</th><th style="padding:4px 8px;">Days</th><th style="padding:4px 8px;">Wage</th><th style="padding:4px 8px;">Manual</th><th style="padding:4px 8px;">Intelligence</th><th style="padding:4px 8px;">Endurance</th><th style="padding:4px 8px;">Effect.</th><th style="padding:4px 8px;">Addiction</th><th style="padding:4px 8px;">Last seen</th></tr></thead><tbody>${d.employees.map(e => `<tr style="border-top:1px solid var(--line);"><td style="padding:4px 8px;font-weight:700;">${esc(e.name)}</td><td style="padding:4px 8px;">${esc(e.position)}</td><td style="padding:4px 8px;font-family:var(--mono);">${coN(e.days)}</td><td style="padding:4px 8px;font-family:var(--mono);">${coMoney(e.wage)}</td><td style="padding:4px 8px;font-family:var(--mono);">${coN(e.manual)}</td><td style="padding:4px 8px;font-family:var(--mono);">${coN(e.intelligence)}</td><td style="padding:4px 8px;font-family:var(--mono);">${coN(e.endurance)}</td><td style="padding:4px 8px;font-family:var(--mono);">${coN(e.effectiveness)}</td><td style="padding:4px 8px;font-family:var(--mono);${e.addiction != null && Math.abs(e.addiction) >= 12 ? 'color:var(--danger);' : ''}">${coN(e.addiction)}</td><td style="padding:4px 8px;color:var(--muted);">${esc(e.lastRel) || coAgo(e.lastTs)}</td></tr>`).join('')}</tbody></table></div>` : '<p style="color:var(--muted);margin:0;">Torn gave no employee list for this key.</p>'}</div>
        <div class="panel"><h3 style="margin-top:0;">Stock</h3>
            ${d.stock.length ? `<table style="width:100%;font-size:13px;border-collapse:collapse;"><thead><tr style="color:var(--muted);text-align:left;"><th style="padding:4px 8px;">Product</th><th style="padding:4px 8px;">In stock</th><th style="padding:4px 8px;">On order</th><th style="padding:4px 8px;">Sold</th><th style="padding:4px 8px;">Sold worth</th></tr></thead><tbody>${d.stock.map(s => `<tr style="border-top:1px solid var(--line);"><td style="padding:4px 8px;font-weight:700;">${esc(s.name)}</td><td style="padding:4px 8px;font-family:var(--mono);">${coN(s.inStock)}</td><td style="padding:4px 8px;font-family:var(--mono);">${coN(s.onOrder)}</td><td style="padding:4px 8px;font-family:var(--mono);">${coN(s.sold)}</td><td style="padding:4px 8px;font-family:var(--mono);">${coMoney(s.soldWorth)}</td></tr>`).join('')}</tbody></table>` : '<p style="color:var(--muted);margin:0;">Torn gave no stock for this company.</p>'}</div>
        <details style="margin-top:8px;"><summary class="av-sum"><span style="font-size:12px;color:var(--muted);">Show Torn's raw answer (to check the numbers)</span></summary><pre id="co-raw" style="white-space:pre-wrap;word-break:break-all;font-size:11px;color:var(--muted);"></pre><button class="ghost small" id="co-raw-btn" type="button">Load the raw answer</button></details>`;
    $('co-pick')?.addEventListener('change', () => { coMyId = $('co-pick').value; loadCompany(); });
    $('co-raw-btn').addEventListener('click', async () => { const x = await coFetch({ action: 'co-raw' }); $('co-raw').textContent = x.error || x.raw; });
}

// ---- the owner's page: register companies, set the cut and the Investment amount ----
async function loadCompanies() {
    const st = $('cs-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    const r = await coFetch({ action: 'co-list' });
    if (r.error) { st.className = 'status err'; st.textContent = r.error; return; }
    st.textContent = ''; st.className = 'status';
    $('cs-list').innerHTML = r.companies.length ? r.companies.map(c => `<div class="panel" style="margin-bottom:12px;" data-id="${esc(c.id)}">
        <div style="display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;"><h3 style="margin:0;">${esc(c.name)}</h3><span style="color:var(--muted);font-size:12px;">company ${esc(c.id)} · director <b style="color:var(--text);">${esc(c.directorName || c.directorId)}</b> [${esc(c.directorId)}]</span><button class="ghost small cs-del" style="margin-left:auto;color:var(--danger);">Remove</button></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-top:10px;">
            <div class="field" style="margin:0;width:110px;"><label>Director cut %</label><input class="cs-cut" type="number" min="0" max="100" value="${esc(c.cutPct)}"></div>
            <button class="ghost small cs-cutsave">Save cut</button>
            <div class="field" style="margin:0;width:170px;"><label>Investment amount ($)</label><input class="cs-amount" inputmode="numeric" placeholder="${esc(Math.round(c.investment || 0))}" value=""></div>
            <div class="field" style="margin:0;flex:1;min-width:160px;"><label>Note (who it is for)</label><input class="cs-note" maxlength="120" value="${esc(c.invNote)}"></div>
            <button class="ghost small cs-inv" data-mode="set">Set</button><button class="ghost small cs-inv" data-mode="add">+ Add</button><button class="ghost small cs-inv" data-mode="take">− Take out</button>
        </div>
        <div style="margin-top:8px;font-size:13px;">Investment amount now: <b style="font-family:var(--mono);color:${c.investment > 0 ? '#f0b432' : 'var(--muted)'};">${coMoney(c.investment)}</b> <span style="color:var(--muted);font-size:12px;">— stays until you change it; 0 means nothing to settle</span></div>
        ${c.invLog.length ? `<details style="margin-top:6px;"><summary class="av-sum"><span style="font-size:12px;color:var(--muted);">History of the investment amount</span></summary>${c.invLog.map(l => `<div style="font-size:12px;color:var(--muted);padding:2px 0;">${new Date(l.t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${l.delta >= 0 ? '+' : '−'}${coMoney(Math.abs(l.delta))} → ${coMoney(l.after)}${l.note ? ` · ${esc(l.note)}` : ''} · ${esc(l.by)}</div>`).join('')}</details>` : ''}
    </div>`).join('') : '<p style="color:var(--muted);">No companies registered yet.</p>';
    document.querySelectorAll('#cs-list [data-id]').forEach(card => {
        const id = card.dataset.id;
        card.querySelector('.cs-del').addEventListener('click', async () => { if (!confirm('Remove this company? Its director can no longer log in to WWL.')) return; const x = await coFetch({ action: 'co-remove', companyId: id }); if (x.error) { toast(x.error); return; } loadCompanies(); });
        card.querySelector('.cs-cutsave').addEventListener('click', async () => { const x = await coFetch({ action: 'co-save', companyId: id, cutPct: card.querySelector('.cs-cut').value }); if (x.error) { toast(x.error); return; } toast('Cut saved'); loadCompanies(); });
        card.querySelectorAll('.cs-inv').forEach(b => b.addEventListener('click', async () => {
            const amount = card.querySelector('.cs-amount').value;
            if (amount === '' && b.dataset.mode !== 'set') { toast('Enter an amount first.'); return; }
            const x = await coFetch({ action: 'co-invest', companyId: id, mode: b.dataset.mode, amount: amount === '' ? 0 : amount, note: card.querySelector('.cs-note').value });
            if (x.error) { toast(x.error); return; }
            toast('Investment amount updated'); loadCompanies();
        }));
    });
}
$('cs-add').addEventListener('click', async () => {
    const id = $('cs-id').value.replace(/\D/g, '');
    if (!id) return;
    const b = $('cs-add'); b.disabled = true;
    const x = await coFetch({ action: 'co-save', companyId: id });
    b.disabled = false;
    if (x.error) { toast(x.error); return; }
    $('cs-id').value = ''; toast(`${x.company.name} added, director ${x.company.directorName || x.company.directorId}`); loadCompanies();
});
