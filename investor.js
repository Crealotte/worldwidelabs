// investor.js — "My investments": what an investor of the Labs fund sees after logging in with their own Torn API key: their investments (current and earlier, from when to when, what was paid out in total),
// the next payouts, and the requests they can make: renew, add money (both at any time) and withdraw at the end of the term (30 days notice; the fund owner decides and needs the money).
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
    if (acc && acc.buddy) show('buddy');
    if (acc && acc.trader) show('ledger');
    show('join'); show('bug-report'); // Bugs & suggestions: they only see what belongs to their pages (the server filters)
    goToPage(!acc || acc.investor ? 'investor' : acc.tenant ? 'tenant' : acc.buddy ? 'buddy' : 'ledger');
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
    const monthly = active.some(i => i.mode === 'monthly');
    // one person is paid one amount: the payouts of all the deposits are added up per date
    const byDate = list => { const m = {}; list.forEach(p => { m[p.date] = (m[p.date] || 0) + p.amount; }); return Object.entries(m).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, amount]) => ({ date, amount })); };
    const next = byDate(active.flatMap(i => finInvPeriods(i, finAdd(today, 400), finAdd(today, -1)).slice(0, 4)));
    const paidList = byDate(active.flatMap(i => finPaidList(i)));
    const reqOf = i => r.requests.filter(q => q.rowId === i.id && q.status === 'open');
    const reqLine = q => `<div style="font-size:12px;color:#e0a030;">Asked ${esc(finDate(q.createdOn))}: ${q.type === 'renew' ? `renew for ${q.days} days` : q.type === 'topup' ? `add ${finShort(q.amount)}` : q.type === 'merge' ? `merge your deposits onto the same end date (${esc(finDate(q.termEnd))})` : 'withdraw at the end of the term'}${q.late ? ' (less than 30 days before the end: this term renews for 180 days first, so you get your money back at the end of the next term)' : ''}, waiting for the fund owner <a href="#" class="inv-cancel" data-id="${esc(q.id)}" style="color:var(--danger);">cancel</a></div>`;
    // the deposits that end on the same day are ONE amount to renew or withdraw (a merge makes them share a date); a deposit with another end date has its own term
    const groups = [];
    active.forEach(i => { const k = `${i.termEnd || ''}|${i.leaving ? 1 : 0}`; let g = groups.find(x => x.k === k); if (!g) { g = { k, end: i.termEnd || '', leaving: !!i.leaving, lines: [] }; groups.push(g); } g.lines.push(i); });
    groups.sort((a, b) => ((a.end || '9') < (b.end || '9') ? -1 : 1));
    const grp = g => {
        const ids = g.lines.map(l => l.id), total = g.lines.reduce((s, l) => s + l.amount, 0), first = g.lines[0].id;
        const left = g.end ? Math.round((finD(g.end) - finD(today)) / 86400000) : null;
        const reqs = r.requests.filter(q => ids.includes(q.rowId) && q.status === 'open' && q.type !== 'topup' && q.type !== 'merge');
        const rn = []; g.lines.forEach(l => (l.renewals || []).forEach(x => { if (!rn.some(y => y.from === x.from && y.to === x.to)) rn.push(x); }));
        const status = g.leaving ? `<span style="color:#e0a030;font-weight:700;">You get this money back at the end of the term.</span>` : g.end ? `<span style="color:var(--muted);">Renews by itself for 180 days unless you give notice before ${esc(finDate(finAdd(g.end, -r.notice)))}.</span>` : '';
        return `<div style="border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin:8px 0;">
            <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:baseline;font-size:13px;"><b style="font-family:var(--mono);font-size:15px;">${finMoney(total)}</b><span>term ends <b>${g.end ? esc(finDate(g.end)) : 'not set'}</b>${left !== null ? ` <span style="color:${left < 30 ? '#e0a030' : 'var(--muted)'};">(${left < 0 ? 'ended' : `in ${left} days`})</span>` : ''}</span></div>
            <div style="font-size:12px;margin-top:2px;">${status}${rn.length ? ` <span style="color:var(--muted);">Renewed: ${rn.map(x => `${esc(finDate(x.from))} → ${esc(finDate(x.to))}${x.auto ? ' (automatic)' : ''}`).join(', ')}</span>` : ''}</div>
            <div style="margin:6px 0;border-left:2px solid var(--line);padding-left:10px;">${g.lines.map(l => `<div style="font-size:12px;color:var(--muted);"><span style="font-family:var(--mono);color:var(--text);">${finMoney(l.amount)}</span> · deposited ${esc(finDate(l.start))}</div>`).join('')}</div>
            ${reqs.map(reqLine).join('')}
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px;">
                ${!g.leaving && left !== null && left >= r.notice ? `<select class="inv-days" data-row="${esc(first)}"><option value="180">180 days</option><option value="90">90 days</option></select><button class="ghost small inv-req" data-type="renew" data-row="${esc(first)}" type="button">Ask to renew ${finMoney(total)}</button>` : ''}
                ${!g.leaving && left !== null && left < r.notice ? `<span style="font-size:12px;color:var(--muted);">The last ${r.notice} days before the end date have started: this deposit renews automatically for 180 days.</span>` : ''}
                ${g.leaving ? '' : `<button class="ghost small inv-req" data-type="withdraw" data-row="${esc(first)}" type="button">Ask to withdraw ${finMoney(total)} at the end of the term</button>`}</div></div>`;
    };
    const old = i => { const list = finPaidList(i); return `<details style="border-top:1px solid var(--line);padding:6px 0;"><summary class="av-sum"><b style="font-family:var(--mono);">${finMoney(i.amount)}</b> <span style="color:var(--muted);font-size:13px;">· ${esc(finDate(i.start))} → ${i.returnedOn ? esc(finDate(i.returnedOn)) : 'ended'} · paid out ${finMoney(finPaidTotal(i))}</span></summary>
        <div style="font-size:12px;padding:4px 0 2px 14px;color:var(--muted);">${i.returnedOn ? `The money was returned on ${esc(finDate(i.returnedOn))}. ` : ''}${(i.renewals || []).length ? `Renewed: ${i.renewals.map(x => `${esc(finDate(x.from))} → ${esc(finDate(x.to))}`).join(', ')}.` : ''}</div>
        ${list.length ? `<div style="max-height:200px;overflow:auto;padding-left:14px;">${list.slice().reverse().map(p => `<div style="display:flex;gap:14px;font-size:12px;padding:1px 0;"><span style="font-family:var(--mono);">${esc(p.date)}</span><span style="font-family:var(--mono);">${finMoney(p.amount)}</span></div>`).join('')}</div>` : ''}</details>`; };
    const tier = finTierOf(inNow), nxt = finTierNext(inNow), ends = new Set(active.filter(i => !i.leaving && i.termEnd).map(i => i.termEnd));
    const canMerge = active.filter(i => !i.leaving && i.termEnd).length > 1 && ends.size > 1, mergeAsked = r.requests.some(q => q.type === 'merge' && q.status === 'open');
    const step = inNow < 250000000 ? 25000000 : inNow < 500000000 ? 50000000 : inNow < 1000000000 ? 100000000 : 250000000; // the terms: grow gradually, in steps by tier (Copper 25m, Bronze 50m, Silver 100m, Gold and up 250m)
    const main = active.length ? `<div class="panel">
        <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:baseline;"><h3 style="margin:0;font-family:var(--mono);font-size:22px;">${finMoney(inNow)}</h3>${tier ? `<span style="font-weight:700;">${tier[2]} ${tier[1]}</span>` : ''}<span style="font-size:12px;color:var(--muted);">${active.length} deposit${active.length === 1 ? '' : 's'}</span></div>
        <div style="font-size:13px;line-height:1.7;margin-top:6px;">You are paid <b>${finMoney(weekNow)}</b> a week${monthly ? ', added up and paid on the last Sunday of the month' : ', every Sunday'}.${next[0] ? `<br>Next payout: <b>${esc(finDate(next[0].date))}</b> (${finMoney(next[0].amount)})` : ''}
            <br><span style="color:var(--muted);">Your total sets your tier, and the tier sets what you are paid. ${nxt ? `Add <b>${finMoney(nxt[0] - inNow)}</b> to reach <b>${nxt[2]} ${nxt[1]}</b> (from ${finMoney(nxt[0])}).` : 'You are in the top tier.'}</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px;"><input class="inv-amt" data-row="${esc(active[0].id)}" type="text" inputmode="decimal" placeholder="Amount to add (${step / 1000000}m steps)" style="width:170px;"><button class="ghost small inv-req" data-type="topup" data-step="${step}" data-row="${esc(active[0].id)}" type="button">Ask to add money</button><span style="font-size:11px;color:var(--muted);">you can add money in steps of ${step / 1000000}m (for example ${step / 1000000}m, ${step / 500000}m or ${step * 5 / 1000000}m)</span>
            ${canMerge ? `<button class="ghost small inv-req" data-type="merge" data-row="${esc(active[0].id)}" type="button" ${mergeAsked ? 'disabled' : ''}>${mergeAsked ? 'Merge asked, waiting for the fund owner' : 'Ask to merge my deposits onto one end date'}</button>` : ''}</div>
        <h4 style="margin:14px 0 2px;">Your deposits</h4>
        <div style="font-size:12px;color:var(--muted);margin-bottom:2px;">Deposits that end on the same day are renewed or withdrawn together as one amount. A deposit with another end date has its own term, so you can take it out at the end of its term without touching the others.${canMerge ? ' If you prefer one date for everything you can merge them: they then all end on the latest date.' : ''}</div>
        ${groups.map(grp).join("")}
        <div style="font-size:11px;color:var(--muted);margin-top:6px;">To withdraw at the end of a term, give notice at least ${r.notice} days before it ends. If you do not, the deposit renews automatically for another 180 days. The money goes back when the term ends, if the fund owner has it available. The fund owner approves every request.</div>
        ${paidList.length ? `<details style="margin-top:8px;"><summary class="av-sum" style="font-size:12px;color:var(--muted);">Payouts so far (${paidList.length})</summary><div style="max-height:220px;overflow:auto;">${paidList.slice().reverse().map(p => `<div style="display:flex;gap:14px;font-size:12px;padding:1px 0;"><span style="font-family:var(--mono);">${esc(p.date)}</span><span style="font-family:var(--mono);">${finMoney(p.amount)}</span></div>`).join('')}</div></details>` : ''}</div>` : '';
    return `${termsPanel('invest', r.terms)}<div class="panel" style="display:flex;gap:26px;flex-wrap:wrap;font-size:13px;">${box('Invested now', finMoney(inNow))}${box('Paid to you a week', finMoney(weekNow))}${box('Paid out to you in total', finMoney(paidAll))}${box('Invested over time (all investments)', finMoney(everIn))}</div>
        ${active.length ? `<h3 style="margin:14px 0 8px;">Your investment now</h3>${main}` : `<div class="panel" style="color:var(--muted);">You have no active investment at the moment. Everything you had before is listed below. Ask the fund owner if you want to invest again.</div>`}
        ${next.length ? `<div class="panel"><h3 style="margin-top:0;">Next payouts</h3>${next.slice(0, 6).map(p => `<div style="display:flex;gap:16px;font-size:13px;padding:2px 0;"><span style="font-family:var(--mono);min-width:96px;">${esc(finDate(p.date))}</span><span style="font-family:var(--mono);">${finMoney(p.amount)}</span></div>`).join('')}</div>` : ''}
        ${ended.length ? `<div class="panel"><h3 style="margin-top:0;">Earlier investments</h3><div style="font-size:12px;color:var(--muted);margin:-4px 0 6px;">Everything you invested before, from when to when, and what was paid out to you.</div>${ended.slice().reverse().map(old).join('')}</div>` : ''}
        <div style="font-size:11px;color:var(--muted);">Payouts are shown as worked out from the schedule up to the date they were marked as paid.</div>`;
}
function invWire() {
    termsWire(loadInvestor);
    document.querySelectorAll('.inv-req').forEach(b => b.addEventListener('click', async () => {
        const row = b.dataset.row, type = b.dataset.type, body = { action: 'inv-request', type, rowId: row };
        if (type === 'renew') body.days = Number(document.querySelector(`.inv-days[data-row="${row}"]`).value);
        if (type === 'topup') { const v = finParse(document.querySelector(`.inv-amt[data-row="${row}"]`).value); if (!v) { toast('Write the amount as 500m or 1.5b'); return; } const stp = Number(b.dataset.step) || 0; if (stp && v % stp) { toast(`Add money in steps of ${stp / 1000000}m`); return; } body.amount = v; }
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
