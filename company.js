// company.js — the company side of WWL: the director's "My company" page (live numbers, history, payslip, who has been away, employees, stock, the standing
// Investment amount) and the owner's "Companies" page (register a company by its Torn ID, the director's cut, the Investment amount, the company's own Discord
// channel and the key for the daily saving). A company director logs in with their own key and sees ONLY this (enterDirectorMode); everything else is closed
// to them on the server too. Backend: co-* in api/war-payout.js, lib/company.js, lib/companyReports.js.
'use strict';

let directorMode = false, coOwner = false, coMyId = null;
async function coFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}
const coMoney = n => n == null ? '—' : `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const coM = n => { if (n == null) return '—'; const a = Math.abs(n); const s = n < 0 ? '−' : ''; return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(2)}M` : `${s}$${Math.round(a).toLocaleString('en-US')}`; };
const coN = n => n == null ? '—' : Math.round(n).toLocaleString('en-US');
const coAgo = ts => { if (!ts) return '—'; const s = Date.now() / 1000 - ts; return s < 3600 ? `${Math.max(1, Math.round(s / 60))} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
const coDay = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

// Called by login() with the answer of the server's access check: shows the "My company" menu item to directors and the CreaLotte menu to the owner.
function checkCompanyAccess(acc) {
    coOwner = !!(acc && acc.owner);
    const mine = document.querySelector('.nav-item[data-page="company"]'), ownerGroup = $('nav-owner-group');
    if (mine) mine.style.display = acc && (acc.director) ? '' : 'none';
    if (ownerGroup) ownerGroup.style.display = coOwner ? '' : 'none'; // the CreaLotte menu: only for the owner
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
    const h = await coFetch({ action: 'co-history', companyId: coMyId });
    renderCompany(r, h.error ? null : h);
}
function renderPayslip(h) {
    if (!h || !h.weeks.length) return '<p style="color:var(--muted);margin:0;">No days saved yet. Once the daily saving is on, the first week fills in here.</p>';
    const line = (k, v, strong) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:2px 0;${strong ? 'font-weight:700;border-top:1px solid var(--line);margin-top:4px;padding-top:6px;' : ''}"><span style="color:${strong ? 'var(--text)' : 'var(--muted)'};">${k}</span><span style="font-family:var(--mono);">${v}</span></div>`;
    return h.weeks.map((w, i) => `<details ${i === 0 ? 'open' : ''} style="margin:6px 0;border:1px solid var(--line);border-radius:8px;padding:6px 12px;">
        <summary class="av-sum"><b style="font-size:14px;">Week ending ${coDay(w.weekEnd)}${w.running ? ' (so far)' : ''}</b> <span style="color:var(--muted);font-size:12px;">${w.daysCounted} day${w.daysCounted === 1 ? '' : 's'} counted · ${w.send >= 0 ? `send ${coM(w.send)}` : `you receive ${coM(-w.send)}`}</span></summary>
        <div style="max-width:420px;margin-top:6px;">
            ${line('Weekly profit', coM(w.profit))}${line('Director cut', coM(w.cut))}${line('Investment amount', coM(w.investment))}
            ${line('Bank', coM(w.bank))}${line(`Keep wages (${coM(w.wagesDay)} a day × 7)`, coM(w.keepWage))}${line(`Keep ads (${coM(w.adsDay)} a day × 7)`, coM(w.keepAds))}${line('Total to keep', coM(w.keep))}
            ${line(w.send >= 0 ? `Send to ${esc(h.sendTo)}` : `${esc(h.sendTo)} sends you`, coM(Math.abs(w.send)), true)}
        </div>
        <div style="margin-top:8px;overflow-x:auto;"><table style="width:100%;font-size:12px;border-collapse:collapse;"><thead><tr style="color:var(--muted);text-align:left;"><th style="padding:3px 8px;">Day</th><th style="padding:3px 8px;">Income</th><th style="padding:3px 8px;">Wages</th><th style="padding:3px 8px;">Ads</th><th style="padding:3px 8px;">Profit</th></tr></thead><tbody>${w.perDay.map(d => `<tr style="border-top:1px solid var(--line);"><td style="padding:3px 8px;">${coDay(d.date)}</td><td style="padding:3px 8px;font-family:var(--mono);">${coM(d.income)}</td><td style="padding:3px 8px;font-family:var(--mono);">${coM(d.wages)}</td><td style="padding:3px 8px;font-family:var(--mono);">${coM(d.ads)}</td><td style="padding:3px 8px;font-family:var(--mono);">${coM(d.profit)}</td></tr>`).join('')}</tbody></table></div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">Profit per day = income − wages − ads. Send = bank − total to keep − director cut − investment amount.</div>
    </details>`).join('');
}
function renderHistory(h) {
    if (!h || !h.days.length) return '<p style="color:var(--muted);margin:0;">The history starts the day the daily saving is switched on.</p>';
    const max = Math.max(1, ...h.days.map(d => d.income || 0));
    return `<div style="display:flex;align-items:flex-end;gap:3px;height:110px;margin-bottom:6px;">${h.days.map(d => `<div title="${coDay(d.date)}: income ${coM(d.income)}, profit ${coM((d.income || 0) - (d.wages || 0) - (d.ads || 0))}" style="flex:1;min-width:6px;height:${Math.max(2, (d.income || 0) / max * 100)}%;background:var(--reagent);border-radius:2px 2px 0 0;opacity:.85;"></div>`).join('')}</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:8px;">Daily income, the last ${h.days.length} saved day${h.days.length === 1 ? '' : 's'}. Hover a bar for the day.</div>
        <div style="overflow-x:auto;"><table style="width:100%;font-size:12px;border-collapse:collapse;"><thead><tr style="color:var(--muted);text-align:left;"><th style="padding:3px 8px;">Day</th><th style="padding:3px 8px;">Income</th><th style="padding:3px 8px;">Customers</th><th style="padding:3px 8px;">Bank</th><th style="padding:3px 8px;">Popularity</th><th style="padding:3px 8px;">Efficiency</th><th style="padding:3px 8px;">Staff</th></tr></thead><tbody>${h.days.slice(-14).reverse().map(d => `<tr style="border-top:1px solid var(--line);"><td style="padding:3px 8px;">${coDay(d.date)}</td><td style="padding:3px 8px;font-family:var(--mono);">${coM(d.income)}</td><td style="padding:3px 8px;font-family:var(--mono);">${coN(d.customers)}</td><td style="padding:3px 8px;font-family:var(--mono);">${coM(d.bank)}</td><td style="padding:3px 8px;font-family:var(--mono);">${d.popularity != null ? coN(d.popularity) + '%' : '—'}</td><td style="padding:3px 8px;font-family:var(--mono);">${d.efficiency != null ? coN(d.efficiency) + '%' : '—'}</td><td style="padding:3px 8px;font-family:var(--mono);">${coN(d.hired)}</td></tr>`).join('')}</tbody></table></div>`;
}
function renderCompany(r, h) {
    const d = r.data, c = r.company, sv = r.saving || { on: false };
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
        <div class="panel"><h3 style="margin-top:0;">Payslip <span style="font-weight:400;font-size:12px;color:var(--muted);">— the week runs Monday to Sunday; the Sunday tick (18:00–18:10 TCT) is in the week it ends</span></h3>
            ${c.investment > 0 ? `<p style="margin:0 0 8px;">CreaLotte owes you <b style="font-family:var(--mono);">${coMoney(c.investment)}</b>${c.invNote ? ` <span style="color:var(--muted);">(${esc(c.invNote)})</span>` : ''}. It is taken off what you send, so the money only moves once.</p>` : ''}
            ${renderPayslip(h)}</div>
        <div class="panel"><h3 style="margin-top:0;">Daily saving and the Discord reports</h3>
            ${sv.on ? `<p style="margin:0 0 8px;"><b style="color:var(--reagent);">On</b>: the numbers are saved every day after the tick${sv.lastRun ? `, last run ${coAgo(sv.lastRun)}` : ''}${sv.lastOk === false ? ` <span style="color:var(--danger);">(last run failed: ${esc(sv.lastError || '')})</span>` : ''}. The daily report (and the weekly one on Sunday) goes to your company's Discord channel.</p>` : '<p style="margin:0 0 8px;color:var(--muted);">Off: there is no history yet and no Discord report. Turn it on and your API key is kept (encrypted) only to read your company once a day.</p>'}
            ${r.isDirector ? `<button class="ghost small" id="co-daily" type="button">${sv.on ? 'Turn the daily saving off' : 'Turn the daily saving on'}</button>` : ''}</div>
        <div class="panel"><h3 style="margin-top:0;">History</h3>${renderHistory(h)}</div>
        <div class="panel"><h3 style="margin-top:0;">Who has been away</h3>
            ${inactive(d.inactive.day, 'Inactive 24–48 h', '#f0b432')}${inactive(d.inactive.long, 'Inactive over 48 h', 'var(--danger)')}</div>
        <div class="panel"><h3 style="margin-top:0;">Employees</h3>
            ${d.employees.length ? `<div style="overflow-x:auto;"><table style="width:100%;font-size:13px;border-collapse:collapse;"><thead><tr style="color:var(--muted);text-align:left;"><th style="padding:4px 8px;">Name</th><th style="padding:4px 8px;">Position</th><th style="padding:4px 8px;">Days</th><th style="padding:4px 8px;">Wage</th><th style="padding:4px 8px;">Manual</th><th style="padding:4px 8px;">Intelligence</th><th style="padding:4px 8px;">Endurance</th><th style="padding:4px 8px;">Effect.</th><th style="padding:4px 8px;">Addiction</th><th style="padding:4px 8px;">Last seen</th></tr></thead><tbody>${d.employees.map(e => `<tr style="border-top:1px solid var(--line);"><td style="padding:4px 8px;font-weight:700;">${esc(e.name)}</td><td style="padding:4px 8px;">${esc(e.position)}</td><td style="padding:4px 8px;font-family:var(--mono);">${coN(e.days)}</td><td style="padding:4px 8px;font-family:var(--mono);">${coMoney(e.wage)}</td><td style="padding:4px 8px;font-family:var(--mono);">${coN(e.manual)}</td><td style="padding:4px 8px;font-family:var(--mono);">${coN(e.intelligence)}</td><td style="padding:4px 8px;font-family:var(--mono);">${coN(e.endurance)}</td><td style="padding:4px 8px;font-family:var(--mono);">${coN(e.effectiveness)}</td><td style="padding:4px 8px;font-family:var(--mono);${e.addiction != null && Math.abs(e.addiction) >= 12 ? 'color:var(--danger);' : ''}">${coN(e.addiction)}</td><td style="padding:4px 8px;color:var(--muted);">${esc(e.lastRel) || coAgo(e.lastTs)}</td></tr>`).join('')}</tbody></table></div>` : '<p style="color:var(--muted);margin:0;">Torn gave no employee list for this key.</p>'}</div>
        <div class="panel"><h3 style="margin-top:0;">Stock</h3>
            ${d.stock.length ? `<table style="width:100%;font-size:13px;border-collapse:collapse;"><thead><tr style="color:var(--muted);text-align:left;"><th style="padding:4px 8px;">Product</th><th style="padding:4px 8px;">In stock</th><th style="padding:4px 8px;">On order</th><th style="padding:4px 8px;">Sold</th><th style="padding:4px 8px;">Sold worth</th></tr></thead><tbody>${d.stock.map(s => `<tr style="border-top:1px solid var(--line);"><td style="padding:4px 8px;font-weight:700;">${esc(s.name)}</td><td style="padding:4px 8px;font-family:var(--mono);">${coN(s.inStock)}</td><td style="padding:4px 8px;font-family:var(--mono);">${coN(s.onOrder)}</td><td style="padding:4px 8px;font-family:var(--mono);">${coN(s.sold)}</td><td style="padding:4px 8px;font-family:var(--mono);">${coMoney(s.soldWorth)}</td></tr>`).join('')}</tbody></table>` : '<p style="color:var(--muted);margin:0;">Torn gave no stock for this company.</p>'}</div>
        <details style="margin-top:8px;"><summary class="av-sum"><span style="font-size:12px;color:var(--muted);">Show Torn's raw answer (to check the numbers)</span></summary><pre id="co-raw" style="white-space:pre-wrap;word-break:break-all;font-size:11px;color:var(--muted);"></pre><button class="ghost small" id="co-raw-btn" type="button">Load the raw answer</button></details>`;
    $('co-pick')?.addEventListener('change', () => { coMyId = $('co-pick').value; loadCompany(); });
    $('co-raw-btn').addEventListener('click', async () => { const x = await coFetch({ action: 'co-raw', companyId: coMyId }); $('co-raw').textContent = x.error || x.raw; });
    $('co-daily')?.addEventListener('click', async () => { const x = await coFetch({ action: 'co-daily', companyId: coMyId, on: !sv.on }); if (x.error) { toast(x.error); return; } toast(!sv.on ? 'Daily saving is on' : 'Daily saving is off'); loadCompany(); });
}

// ---- the owner's page: register companies, set the cut, the Investment amount, the Discord channel and the key ----
async function loadCompanies() {
    const st = $('cs-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    const r = await coFetch({ action: 'co-list' });
    if (r.error) { st.className = 'status err'; st.textContent = r.error; return; }
    st.textContent = ''; st.className = 'status';
    $('cs-list').innerHTML = r.companies.length ? r.companies.map(c => {
        const sv = c.saving || {};
        return `<div class="panel" style="margin-bottom:12px;" data-id="${esc(c.id)}">
        <div style="display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;"><h3 style="margin:0;">${esc(c.name)}</h3><span style="color:var(--muted);font-size:12px;">company ${esc(c.id)} · director <b style="color:var(--text);">${esc(c.directorName || c.directorId)}</b> [${esc(c.directorId)}]</span><button class="ghost small cs-open" style="margin-left:auto;">Open the company</button><button class="ghost small cs-del" style="color:var(--danger);">Remove</button></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-top:10px;">
            <div class="field" style="margin:0;width:110px;"><label>Director cut %</label><input class="cs-cut" type="number" min="0" max="100" value="${esc(c.cutPct)}"></div>
            <button class="ghost small cs-cutsave">Save cut</button>
            <div class="field" style="margin:0;width:170px;"><label>Investment amount ($)</label><input class="cs-amount" inputmode="numeric" placeholder="${esc(Math.round(c.investment || 0))}" value=""></div>
            <div class="field" style="margin:0;flex:1;min-width:160px;"><label>Note (who it is for)</label><input class="cs-note" maxlength="120" value="${esc(c.invNote)}"></div>
            <button class="ghost small cs-inv" data-mode="set">Set</button><button class="ghost small cs-inv" data-mode="add">+ Add</button><button class="ghost small cs-inv" data-mode="take">− Take out</button>
        </div>
        <div style="margin-top:8px;font-size:13px;">Investment amount now: <b style="font-family:var(--mono);color:${c.investment > 0 ? '#f0b432' : 'var(--muted)'};">${coMoney(c.investment)}</b> <span style="color:var(--muted);font-size:12px;">— stays until you change it; 0 means nothing to settle</span></div>
        ${c.invLog.length ? `<details style="margin-top:6px;"><summary class="av-sum"><span style="font-size:12px;color:var(--muted);">History of the investment amount</span></summary>${c.invLog.map(l => `<div style="font-size:12px;color:var(--muted);padding:2px 0;">${new Date(l.t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${l.delta >= 0 ? '+' : '−'}${coMoney(Math.abs(l.delta))} → ${coMoney(l.after)}${l.note ? ` · ${esc(l.note)}` : ''} · ${esc(l.by)}</div>`).join('')}</details>` : ''}
        <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--line);">
            <div style="font-weight:700;font-size:13px;margin-bottom:6px;">Discord channel for this company's reports</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
                <div class="field" style="margin:0;width:230px;"><label>Channel ID (the bot posts there)</label><input class="cs-chan" inputmode="numeric" value="${esc(c.discord.channelId)}" placeholder="e.g. 123456789012345678"></div>
                <div class="field" style="margin:0;width:270px;"><label>Or a webhook URL ${c.discord.webhookSet ? `<span style="color:var(--reagent);">(saved: ${esc(c.discord.webhookHint)})</span>` : ''}</label><input class="cs-hook" type="password" autocomplete="off" placeholder="${c.discord.webhookSet ? 'Saved: paste a new one to replace it' : 'https://discord.com/api/webhooks/…'}"></div>
                <button class="ghost small cs-dsave">Save</button><button class="ghost small cs-dtest">Send a test message</button>${c.discord.webhookSet ? '<button class="ghost small cs-dclear">Remove webhook</button>' : ''}
            </div>
        </div>
        <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--line);">
            <div style="font-weight:700;font-size:13px;margin-bottom:4px;">Daily saving and reports</div>
            <div style="font-size:13px;margin-bottom:6px;">${sv.on ? `<b style="color:var(--reagent);">On</b> (${esc(sv.by || '')})${sv.lastRun ? `, last run ${coAgo(sv.lastRun)}` : ', has not run yet'}${sv.lastPosted ? `, last report ${esc(sv.lastPosted)}` : ''}${sv.lastOk === false ? ` <span style="color:var(--danger);">failed: ${esc(sv.lastError || '')}</span>` : ''}` : '<span style="color:var(--muted);">Off: no history and no reports. Save the director\'s API key to start.</span>'}</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
                <div class="field" style="margin:0;width:230px;"><label>Director's API key</label><input class="cs-key" type="password" autocomplete="off" placeholder="${sv.on ? 'Saved: paste a new one to replace it' : '16 characters'}"></div>
                <button class="ghost small cs-ksave">Save key</button>${sv.on ? '<button class="ghost small cs-kremove">Remove key</button>' : ''}
                <button class="ghost small cs-now" ${sv.on ? '' : 'disabled'}>Post today's report now</button>
            </div>
            <div style="font-size:11px;color:var(--muted);margin-top:4px;">The key is stored encrypted and only used to read this company once a day (after the 18:00–18:10 TCT tick).</div>
        </div>
    </div>`; }).join('') : '<p style="color:var(--muted);">No companies registered yet.</p>';
    document.querySelectorAll('#cs-list [data-id]').forEach(card => {
        const id = card.dataset.id, q = s => card.querySelector(s), on = (s, fn) => { const el = q(s); if (el) el.addEventListener('click', fn); };
        const run = async (body, ok) => { const x = await coFetch({ companyId: id, ...body }); if (x.error) { toast(x.error); return null; } if (ok) toast(ok); return x; };
        on('.cs-del', async () => { if (!confirm('Remove this company? Its director can no longer log in to WWL.')) return; if (await run({ action: 'co-remove' })) loadCompanies(); });
        on('.cs-open', () => { coMyId = id; goToPage('company'); });
        on('.cs-cutsave', async () => { if (await run({ action: 'co-save', cutPct: q('.cs-cut').value }, 'Cut saved')) loadCompanies(); });
        card.querySelectorAll('.cs-inv').forEach(b => b.addEventListener('click', async () => {
            const amount = q('.cs-amount').value;
            if (amount === '' && b.dataset.mode !== 'set') { toast('Enter an amount first.'); return; }
            if (await run({ action: 'co-invest', mode: b.dataset.mode, amount: amount === '' ? 0 : amount, note: q('.cs-note').value }, 'Investment amount updated')) loadCompanies();
        }));
        on('.cs-dsave', async () => { if (await run({ action: 'co-discord-set', channelId: q('.cs-chan').value, webhookUrl: q('.cs-hook').value }, 'Discord saved')) loadCompanies(); });
        on('.cs-dtest', async () => { if (!(await run({ action: 'co-discord-set', channelId: q('.cs-chan').value, webhookUrl: q('.cs-hook').value }))) return; if (await run({ action: 'co-discord-test' }, 'Test message sent: check the channel')) loadCompanies(); });
        on('.cs-dclear', async () => { if (await run({ action: 'co-discord-set', clearWebhook: true }, 'Webhook removed')) loadCompanies(); });
        on('.cs-ksave', async () => { const k = q('.cs-key').value.trim(); if (!k) { toast('Paste the key first.'); return; } if (await run({ action: 'co-key-set', companyKey: k }, 'Key saved: the daily saving is on')) loadCompanies(); });
        on('.cs-kremove', async () => { if (!confirm('Remove the saved key? The daily saving and the reports stop.')) return; if (await run({ action: 'co-key-remove' }, 'Key removed')) loadCompanies(); });
        on('.cs-now', async () => { const b = q('.cs-now'); b.disabled = true; const x = await run({ action: 'co-report-now' }); b.disabled = false; if (x) { const r0 = x.results[0] || {}; toast(r0.ok ? (r0.posted ? 'Report posted' : 'Saved, but nothing could be posted: set the Discord channel') : (r0.error || 'Could not run')); loadCompanies(); } });
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
