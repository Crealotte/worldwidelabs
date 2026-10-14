// buddy.js — "My buddy plan": what a buddy of Labs buddy banking sees after logging in with their own Torn API key: the money they were given, the term and the due date, the profit estimate, what they keep and what they
// send back, the buddy banking terms to accept — and what Torn itself says about their City Bank investment (read straight from Torn in the browser with their own key, nothing stored).
// Only their own lines (see budHandle in lib/finances.js); nothing of the owner's other money.
'use strict';

let budData = null;
async function budFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}
// Called by login() with the server's access check: shows "My buddy plan" for anyone who is a buddy.
function checkBuddyAccess(acc) {
    const el = document.querySelector('.nav-item[data-page="buddy"]');
    if (el) el.style.display = acc && acc.buddy ? '' : 'none';
}
async function loadBuddy() {
    const st = $('bud-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    const r = await budFetch({ action: 'bud-my' });
    if (r.error) { st.className = 'status err'; st.textContent = r.error; return; }
    st.textContent = ''; st.className = 'status';
    budData = r;
    budRender();
}
function budRender() {
    const r = budData, m = n => finMoney(n), today = r.today;
    const rows = r.rows.slice().sort((a, b) => (a.given < b.given ? 1 : -1)), act = rows.filter(b => b.status === 'active'), done = rows.filter(b => b.status !== 'active');
    const card = b => {
        const f = finBuddy(b), mine = Math.round(f.profit * (100 - b.share) / 100), days = Math.round((finD(f.due) - finD(today)) / 86400000);
        return `<div class="panel" style="margin:0 0 12px;"><div style="display:flex;gap:16px;flex-wrap:wrap;align-items:baseline;"><h3 style="margin:0;font-family:var(--mono);">${m(b.amount)}</h3><span style="color:var(--muted);font-size:12px;">${esc((b.tier || 'plan').replace(/^./, c => c.toUpperCase()))} · given ${esc(finDate(b.given))} · ${b.term} days</span></div>
            <div style="font-size:13px;line-height:1.7;margin-top:6px;">Due back: <b>${esc(finDate(f.due))}</b> <span style="color:${days < 0 ? 'var(--danger)' : days < 5 ? '#e0a030' : 'var(--muted)'};">(${days < 0 ? `${-days} days late` : days === 0 ? 'today' : `in ${days} days`})</span><br>
            Expected profit from your City Bank: <b>${m(f.profit)}</b>${b.profit > 0 ? '' : finBankProfit(b) ? ' <span style="color:var(--muted);font-size:12px;">(read from your bank: what it holds minus what you were given)</span>' : ' <span style="color:var(--muted);font-size:12px;">(an estimate from the Torn bank rate; your own bank gives the real number once this page has read it)</span>'}<br>
            You keep <b>${100 - b.share}%</b> of the profit: <b>${m(mine)}</b><br>
            ${b.reinvest !== false ? `You send me <b>${m(f.mine)}</b> <span style="color:var(--muted);font-size:12px;">(${b.share}% of the profit). The ${m(b.amount)} you were given stays invested: put it in your next City Bank round.</span>` : `You send back <b>${m(f.back)}</b> <span style="color:var(--muted);font-size:12px;">(the ${m(b.amount)} you were given plus ${b.share}% of the profit)</span>`}</div></div>`;
    };
    const cards = () => (act.length ? `<h3 style="margin:14px 0 8px;">Your buddy plan now</h3>${act.map(card).join('')}` : `<div class="panel" style="color:var(--muted);">You have no active buddy banking plan at the moment.</div>`);
    const old = b => { const f = finBuddy(b); return `<div style="font-size:13px;padding:4px 0;border-top:1px solid var(--line);color:var(--muted);"><b style="font-family:var(--mono);color:var(--text);">${m(b.amount)}</b> · ${esc(finDate(b.given))} → ${b.returnedOn ? `paid back ${esc(finDate(b.returnedOn))}` : 'paid back'} · you sent ${m(f.cash)}</div>`; };
    $('bud-body').innerHTML = `${termsPanel('buddy', r.terms)}
        <div id="bud-cards">${cards()}</div>
        <div class="panel"><h3 style="margin-top:0;">🔎 Your City Bank, as Torn shows it</h3>
            <div style="font-size:13px;margin-bottom:6px;">This is read from Torn with your own key right now (nothing is saved). It shows whether your investment is there, how much it is and how long it still runs.</div>
            <button class="ghost small" id="bud-bank-btn" type="button">Check my City Bank</button>
            <div id="bud-bank-out" style="font-size:13px;margin-top:8px;line-height:1.7;"></div><div id="bud-bank-cmp" style="font-size:13px;margin-top:6px;line-height:1.7;"></div></div>
        ${done.length ? `<div class="panel"><h3 style="margin-top:0;">Earlier plans</h3>${done.map(old).join('')}</div>` : ''}`;
    termsWire(loadBuddy);
    const run = async () => {
        if (/^test:/.test(apiKey)) { // a test person has no Torn key: show what the real check looks like, marked as an example
            const plan0 = act.reduce((s, b) => s + b.amount, 0);
            $('bud-bank-out').innerHTML = `<span style="color:var(--muted);">This is a test person, so there is no real Torn bank to read. With a real key this part shows (example):</span><br><b style="color:var(--success,#35d99b);">✅ This key can see an active City Bank investment of ${m(plan0 || 500000000)}.</b><br><span style="color:var(--muted);">…and the other bank fields Torn sends, such as how long it still runs. To see the real thing, choose Me (my own key) in the orange bar and add yourself as a buddy on the Buddy banking page.</span>`;
            $('bud-bank-cmp').innerHTML = '';
            return;
        }
        const cb = await finBankCheck($('bud-bank-out'));
        const cmp = $('bud-bank-cmp'), plan = act.reduce((s, b) => s + b.amount, 0);
        if (!cmp) return;
        if (!act.length || !cb) { cmp.innerHTML = ''; return; }
        const inBank = Number(cb.amount) || 0, left = Number(cb.time_left) || 0, endDate = left > 0 ? new Date(Date.now() + left * 1000).toISOString().slice(0, 10) : '';
        // Torn's amount is what was given plus the interest: the interest is the difference, the buddy keeps their share of it and sends back the rest
        const lines = [];
        if (plan && inBank > plan) {
            const profit = inBank - plan, share = act[0].share, keep = Math.round(profit * (100 - share) / 100), back = plan + Math.round(profit * share / 100);
            lines.push(`<b style="color:var(--success,#35d99b);">✅ Your bank holds ${m(inBank)}: the ${m(plan)} you were given plus <b>${m(profit)}</b> profit.</b>`);
            lines.push(act[0].reinvest !== false ? `You keep ${100 - share}%: <b>${m(keep)}</b>. You send me <b>${m(Math.round(profit * share / 100))}</b> (${share}% of the profit) and reinvest the ${m(plan)}.` : `You keep ${100 - share}%: <b>${m(keep)}</b>. You send back <b>${m(back)}</b> (the ${m(plan)} plus ${share}% of the profit).`);
        } else if (plan && inBank >= plan * 0.95) lines.push(`<b style="color:var(--success,#35d99b);">✅ Your bank holds ${m(inBank)}, in line with the ${m(plan)} you were given.</b> No interest shows yet.`);
        else lines.push(`<b style="color:#e0a030;">Your bank shows ${m(inBank)}, less than the ${m(plan)} you were given. If this is not right, tell the owner.</b>`);
        const due = act.map(b => finBuddy(b).due).sort()[0];
        if (endDate && due) { const gap = Math.round((finD(endDate) - finD(due)) / 86400000); lines.push(Math.abs(gap) <= 2 ? `Your bank ends on ${esc(finDate(endDate))}, as planned.` : `<span style="color:#e0a030;">Your bank ends on ${esc(finDate(endDate))}, the plan says ${esc(finDate(due))}.</span>`); }
        cmp.innerHTML = lines.join('<br>');
        // remember what Torn showed (the key is not kept) so the owner sees it, and show the real profit on the plan above
        const saved = await budFetch({ action: 'bud-bank' });
        if (saved && saved.bank) { act.forEach(b => { b.bank = saved.bank; }); $('bud-cards').innerHTML = cards(); cmp.innerHTML += '<br><span style="color:var(--muted);font-size:12px;">The owner can see this check (the amount and the end date, never your key).</span>'; }
    };
    $('bud-bank-btn').addEventListener('click', run);
    run();
}
