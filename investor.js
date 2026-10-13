// investor.js — "My investments": what an investor of the Labs fund sees after logging in with their own Torn API key: their investments (current and earlier, from when to when, what was paid out in total),
// the next payouts, and the requests they can make: renew, add money (both at any time) and withdraw at the end of the term (4 weeks notice; the fund owner decides and needs the money).
// They only ever get their own investments (see invHandle in lib/finances.js). The payout schedule is worked out here with the same helpers as the owner's pages (finances.js).
'use strict';

let invMode = false, invData = null;
async function invFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}
// Called by login() with the server's access check: shows "My investments" for anyone who invests with the fund.
function checkInvestorAccess(acc) {
    const el = document.querySelector('.nav-item[data-page="investor"]');
    if (el) el.style.display = acc && acc.investor ? '' : 'none';
}
// An investor who is not in one of the allowed factions (or whose key is too small for the rest of WWL): WWL is just their investments page.
function enterInvestorMode(acc) { // the portal of an investor and/or a tenant: only their own pages
    invMode = true;
    document.querySelectorAll('nav.side .nav-item, nav.side .nav-group').forEach(el => { el.style.display = 'none'; });
    const show = p => { const el = document.querySelector(`.nav-item[data-page="${p}"]`); if (el) el.style.display = ''; };
    if (!acc || acc.investor) show('investor');
    if (acc && acc.tenant) show('tenant');
    show('bug-report'); // Bugs & suggestions: they only see what belongs to their pages (the server filters)
    goToPage(!acc || acc.investor ? 'investor' : 'tenant');
}

async function loadInvestor() {
    const st = $('inv-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    const r = await invFetch({ action: 'inv-my' });
    if (r.error) { st.className = 'status err'; st.textContent = r.error; return; }
    st.textContent = ''; st.className = 'status';
    invData = r;
    invRender();
}
function invRender() {
    const saved = typeof finData !== 'undefined' ? finData : null;
    finData = { roi: invData.roi, investors: invData.rows }; // the pay table and the person's lines, for the helpers of finances.js
    try { $('inv-body').innerHTML = invHtml(invData); } finally { finData = saved; }
    invWire();
}
function invHtml(r) {
    const today = r.today, rows = r.rows.slice().sort((a, b) => (a.start < b.start ? -1 : 1));
    const active = rows.filter(i => i.active), ended = rows.filter(i => !i.active);
    const inNow = active.reduce((s, i) => s + i.amount, 0), weekNow = active.reduce((s, i) => s + finPayout(i), 0);
    const paidAll = rows.reduce((s, i) => s + finPaidTotal(i), 0), everIn = rows.reduce((s, i) => s + i.amount, 0);
    const box = (l, v) => `<div><div style="color:var(--muted);font-size:11px;">${l}</div><b style="font-family:var(--mono);">${v}</b></div>`;
    const reqOf = i => r.requests.filter(q => q.rowId === i.id && q.status === 'open');
    const modeText = i => (i.mode === 'monthly' ? `monthly: the weekly amounts of the month added up (${finMoney(finPayout(i))} a week), paid on the last Sunday of the month` : `${finMoney(finPayout(i))} every Sunday`);
    const next = [];
    active.forEach(i => finInvPeriods(i, finAdd(today, 400), finAdd(today, -1)).slice(0, 4).forEach(p => next.push({ ...p, amt: i.amount })));
    next.sort((a, b) => (a.date < b.date ? 1 : -1)).reverse();
    const card = i => {
        const left = i.termEnd ? Math.round((finD(i.termEnd) - finD(today)) / 86400000) : null, reqs = reqOf(i), list = finPaidList(i);
        const reqLine = q => `<div style="font-size:12px;color:#e0a030;">Asked ${esc(finDate(q.createdOn))}: ${q.type === 'renew' ? `renew for ${q.days} days` : q.type === 'topup' ? `add ${finShort(q.amount)}` : q.type === 'merge' ? `merge your deposits onto the same end date (${esc(finDate(q.termEnd))})` : 'withdraw at the end of the term'}${q.late ? ' (less than 30 days before the end)' : ''}, waiting for the fund owner <a href="#" class="inv-cancel" data-id="${esc(q.id)}" style="color:var(--danger);">cancel</a></div>`;
        const nx = finInvPeriods(i, finAdd(today, 400), finAdd(today, -1))[0];
        return `<div class="panel" style="margin:0 0 12px;"><div style="display:flex;gap:18px;flex-wrap:wrap;align-items:baseline;"><h3 style="margin:0;font-family:var(--mono);">${finMoney(i.amount)}</h3><span style="color:var(--muted);font-size:12px;">since ${esc(finDate(i.start))}</span>${i.leaving ? '<span style="color:#e0a030;font-size:12px;font-weight:700;">You will get this money back at the end of the term.</span>' : ''}</div>
            <div style="font-size:13px;line-height:1.7;margin-top:6px;">Payout: ${modeText(i)}<br>${nx ? `Next payout: <b>${esc(finDate(nx.date))}</b> (${finMoney(nx.amount)})<br>` : ''}Term ends: <b>${i.termEnd ? esc(finDate(i.termEnd)) : 'not set'}</b>${left !== null ? ` <span style="color:${left < 28 ? '#e0a030' : 'var(--muted)'};">(${left < 0 ? 'ended' : `in ${left} days`})</span>` : ''}<br>Paid out to you on this investment: <b>${finMoney(finPaidTotal(i))}</b>${(i.renewals || []).length ? `<br><span style="color:var(--muted);font-size:12px;">Renewed: ${i.renewals.map(x => `${esc(finDate(x.from))} → ${esc(finDate(x.to))}`).join(', ')}</span>` : ''}</div>
            ${reqs.map(reqLine).join('')}
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px;">
                <select class="inv-days" data-row="${esc(i.id)}"><option value="180">180 days</option><option value="90">90 days</option></select><button class="ghost small inv-req" data-type="renew" data-row="${esc(i.id)}" type="button">Ask to renew</button>
                <input class="inv-amt" data-row="${esc(i.id)}" type="text" inputmode="decimal" placeholder="Amount to add (100m or more)" style="width:150px;"><button class="ghost small inv-req" data-type="topup" data-row="${esc(i.id)}" type="button">Ask to add money</button>
                ${i.leaving ? '' : `<button class="ghost small inv-req" data-type="withdraw" data-row="${esc(i.id)}" type="button">Ask to withdraw at the end of the term</button>`}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:6px;">You can renew or add money at any time. To withdraw at the end of your term you give ${r.notice} days notice (before ${i.termEnd ? esc(finDate(finAdd(i.termEnd, -r.notice))) : 'the end'}); the money goes back when the term ends, if the fund owner has it available. The fund owner approves every request.</div>
            ${list.length ? `<details style="margin-top:8px;"><summary class="av-sum" style="font-size:12px;color:var(--muted);">Payouts so far (${list.length})</summary><div style="max-height:220px;overflow:auto;">${list.slice().reverse().map(p => `<div style="display:flex;gap:14px;font-size:12px;padding:1px 0;"><span style="font-family:var(--mono);">${esc(p.date)}</span><span style="font-family:var(--mono);">${finMoney(p.amount)}</span></div>`).join('')}</div></details>` : ''}</div>`;
    };
    const old = i => { const list = finPaidList(i); return `<details style="border-top:1px solid var(--line);padding:6px 0;"><summary class="av-sum"><b style="font-family:var(--mono);">${finMoney(i.amount)}</b> <span style="color:var(--muted);font-size:13px;">· ${esc(finDate(i.start))} → ${i.returnedOn ? esc(finDate(i.returnedOn)) : 'ended'} · paid out ${finMoney(finPaidTotal(i))}</span></summary>
        <div style="font-size:12px;padding:4px 0 2px 14px;color:var(--muted);">${i.returnedOn ? `The money was returned on ${esc(finDate(i.returnedOn))}. ` : ''}${(i.renewals || []).length ? `Renewed: ${i.renewals.map(x => `${esc(finDate(x.from))} → ${esc(finDate(x.to))}`).join(', ')}.` : ''}</div>
        ${list.length ? `<div style="max-height:200px;overflow:auto;padding-left:14px;">${list.slice().reverse().map(p => `<div style="display:flex;gap:14px;font-size:12px;padding:1px 0;"><span style="font-family:var(--mono);">${esc(p.date)}</span><span style="font-family:var(--mono);">${finMoney(p.amount)}</span></div>`).join('')}</div>` : ''}</details>`; };
    const tier = finTierOf(inNow), nxt = finTierNext(inNow), ends = new Set(active.filter(i => !i.leaving && i.termEnd).map(i => i.termEnd));
    const canMerge = active.filter(i => !i.leaving && i.termEnd).length > 1 && ends.size > 1, mergeAsked = r.requests.some(q => q.type === 'merge' && q.status === 'open');
    const tierPanel = active.length ? `<div class="panel"><div style="display:flex;gap:14px;flex-wrap:wrap;align-items:baseline;"><h3 style="margin:0;">${tier ? `${tier[2]} ${tier[1]} tier` : 'Your tier'}</h3><span style="font-size:13px;color:var(--muted);">your total of ${finMoney(inNow)} sets the tier, and the tier sets what you are paid</span></div>
        <div style="font-size:13px;line-height:1.7;margin-top:6px;">${nxt ? `Add <b>${finMoney(nxt[0] - inNow)}</b> to reach <b>${nxt[2]} ${nxt[1]}</b> (from ${finMoney(nxt[0])}).` : 'You are in the top tier.'} You are paid ${active.some(i => i.mode === 'monthly') ? 'monthly' : 'weekly'} on all your deposits. Every deposit keeps its own end date: you can take out one deposit at its end date without touching the others.${canMerge ? ` If you prefer one date for everything, you can merge them: all your deposits then end on the latest date.<br><button class="ghost small inv-req" data-type="merge" data-row="${esc(active[0].id)}" type="button" ${mergeAsked ? 'disabled' : ''}>${mergeAsked ? 'Merge asked, waiting for the fund owner' : 'Ask to merge my deposits onto the same end date'}</button>` : ''}</div></div>` : '';
    return `${termsPanel('invest', r.terms)}<div class="panel" style="display:flex;gap:26px;flex-wrap:wrap;font-size:13px;">${box('Invested now', finMoney(inNow))}${box('Paid to you a week', finMoney(weekNow))}${box('Paid out to you in total', finMoney(paidAll))}${box('Invested over time (all investments)', finMoney(everIn))}</div>
        ${tierPanel}
        ${active.length ? `<h3 style="margin:14px 0 8px;">Your investments now</h3>${active.map(card).join('')}` : `<div class="panel" style="color:var(--muted);">You have no active investment at the moment. Everything you had before is listed below. Ask the fund owner if you want to invest again.</div>`}
        ${next.length ? `<div class="panel"><h3 style="margin-top:0;">Next payouts</h3>${next.slice(0, 6).map(p => `<div style="display:flex;gap:16px;font-size:13px;padding:2px 0;"><span style="font-family:var(--mono);min-width:96px;">${esc(finDate(p.date))}</span><span style="font-family:var(--mono);">${finMoney(p.amount)}</span></div>`).join('')}</div>` : ''}
        ${ended.length ? `<div class="panel"><h3 style="margin-top:0;">Earlier investments</h3><div style="font-size:12px;color:var(--muted);margin:-4px 0 6px;">Everything you invested before, from when to when, and what was paid out to you.</div>${ended.slice().reverse().map(old).join('')}</div>` : ''}
        <div style="font-size:11px;color:var(--muted);">Payouts are shown as worked out from the schedule up to the date they were marked as paid.</div>`;
}
function invWire() {
    termsWire(loadInvestor);
    document.querySelectorAll('.inv-req').forEach(b => b.addEventListener('click', async () => {
        const row = b.dataset.row, type = b.dataset.type, body = { action: 'inv-request', type, rowId: row };
        if (type === 'renew') body.days = Number(document.querySelector(`.inv-days[data-row="${row}"]`).value);
        if (type === 'topup') { const v = finParse(document.querySelector(`.inv-amt[data-row="${row}"]`).value); if (!v) { toast('Write the amount as 500m or 1.5b'); return; } body.amount = v; }
        if (type === 'withdraw' && !confirm('Ask to withdraw your money at the end of your term? The fund owner has to approve it and have the money available.')) return;
        b.disabled = true;
        const r = await invFetch(body);
        if (r.error) { toast(r.error); b.disabled = false; return; }
        toast('Request sent'); loadInvestor();
    }));
    document.querySelectorAll('.inv-cancel').forEach(a => a.addEventListener('click', async e => {
        e.preventDefault();
        const r = await invFetch({ action: 'inv-cancel', id: a.dataset.id });
        if (r.error) { toast(r.error); return; }
        loadInvestor();
    }));
}
