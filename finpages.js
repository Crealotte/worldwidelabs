// finpages.js — the Investment fund and Buddy banking pages (CreaLotte menu, owners only). They share the data, the list editors and the helpers of finances.js
// (the same wwl:finances record) but are their own pages, each saving only its own lists (fin-part-save), so they can never overwrite the Finances page or each other.
'use strict';

async function finLoadLight(page, statusId) {
    finPage = page;
    const st = $(statusId);
    st.className = 'status ok'; st.textContent = 'Loading…';
    const r = await finFetch({ action: 'fin-get', light: true });
    if (r.error) { st.className = 'status err'; st.textContent = r.error; return; }
    st.textContent = ''; st.className = 'status';
    finSrv = { cash: null, companies: r.companies || [], rto: null, today: r.today };
    finData = { fundsMode: r.fundsMode, fundsManual: r.fundsManual, reserve: r.reserve, investors: r.investors, income: r.income, outlays: r.outlays, plans: r.plans, roi: r.roi, ventures: r.ventures, capitals: r.capitals, loans: r.loans || [], buddies: r.buddies || [] };
    finRenderAll();
}
const loadInvestFund = () => finLoadLight('fund', 'fund-status');
const loadBuddyBank = () => finLoadLight('buddy', 'bb-status');


// ---- Investment fund ----
function finRenderFund() {
    $('fund-body').innerHTML = `<div id="fund-summary"></div>${finListEditor('investors')}<div id="fund-people"></div><div id="fund-history"></div>${finListEditor('roi')}`;
    finWire('fund-body');
    finRefresh();
}
function finRefreshFund() {
    const today = finSrv.today, act = finData.investors.filter(i => i.active), cost = finInvestorCost();
    const own = act.filter(i => !i.nettedIn && i.paidUntil);
    const dueNow = own.reduce((s, i) => s + finSum(finInvPeriods(i, today, i.paidUntil)), 0);
    const sun = finSun(today), nextAmt = act.filter(i => !i.nettedIn).reduce((s, i) => s + finSum(finInvPeriods(i, sun, finAdd(sun, -1))), 0);
    const paidOut = finData.investors.reduce((s, i) => s + (i.payments || []).reduce((a, p) => a + p.amount, 0), 0);
    const over = act.filter(i => i.amount > 0 && finPayout(i) * 52 / i.amount * 100 > 35.05).length;
    const box = (l, v, extra = '') => `<div><div style="color:var(--muted);font-size:11px;">${l}</div><b style="font-family:var(--mono);${extra}">${v}</b></div>`;
    $('fund-summary').innerHTML = `<div class="panel" style="display:flex;gap:26px;flex-wrap:wrap;font-size:13px;">
        ${box('Investors', act.length)}${box('Invested', finShort(cost.invested))}${box('Paid out a week', finShort(cost.weekly))}
        <div><div style="color:var(--muted);font-size:11px;">Costs you a year</div><b style="color:${cost.pct !== null && cost.pct > 35.05 ? 'var(--danger)' : 'inherit'};">${cost.pct === null ? '—' : `${cost.pct.toFixed(1)}%`}</b> <span style="color:var(--muted);font-size:11px;">(max 35%)</span></div>
        ${box('Payouts due now', finShort(dueNow), dueNow > 0 ? 'color:#e0a030;' : '')}${box(`Next payouts (Sunday ${esc(finDate(sun))})`, finShort(nextAmt))}${box('Paid out so far (recorded)', finShort(paidOut))}
        ${over ? `<div style="color:var(--danger);">⚠ ${over} investor${over === 1 ? ' is' : 's are'} above 35% a year.</div>` : ''}</div>
        <div style="font-size:12px;color:var(--muted);margin:-4px 0 10px;">Fill in "Paid through" (the last Sunday that is already paid out) for each investor once; after that the page tells you what is due, and "Mark paid" moves it forward and keeps a history. An investor whose pay is netted in a company send is not counted here.</div>`;
    document.querySelectorAll('[data-invdue]').forEach(el => {
        const i = finData.investors[+el.dataset.invdue]; if (!i) return;
        if (!i.active) { el.innerHTML = '<span style="color:var(--muted);">' + (i.returnedOn ? 'ended' : 'off') + '</span>'; return; }
        if (i.nettedIn) { el.innerHTML = '<span style="color:var(--muted);">via company send</span>'; return; }
        if (!i.paidUntil) {
            const p = finInvPeriods(i, today, '');
            el.innerHTML = p.length ? `<button class="ghost small" data-invsync="${el.dataset.invdue}" type="button" title="Everything up to the last Sunday is already paid">Paid until ${esc(finDate(p[p.length - 1].date))}</button>` : `<span style="color:var(--muted);">first payout ${esc(finDate(finInvPeriods(i, finAdd(today, 400), '')[0]?.date || i.start))}</span>`;
            return;
        }
        const due = finInvPeriods(i, today, i.paidUntil);
        if (due.length) { el.innerHTML = `<b style="color:#e0a030;">${finShort(finSum(due))}</b> <span style="color:var(--muted);">(${due.length} payout${due.length === 1 ? '' : 's'})</span> <button class="small" data-invpay="${el.dataset.invdue}" type="button">Mark paid</button>`; return; }
        const nx = finInvPeriods(i, finAdd(today, 400), i.paidUntil)[0];
        el.innerHTML = `<span style="color:var(--success,#35d99b);">paid up</span>${nx ? ` <span style="color:var(--muted);">· next ${esc(finDate(nx.date))} ${finShort(nx.amount)}</span>` : ''}`;
    });
    // the term of each investment: when it ends, renew it (the old end is kept in the history)
    document.querySelectorAll('[data-invterm]').forEach(el => {
        const i = finData.investors[+el.dataset.invterm]; if (!i) return;
        if (!i.active) { el.innerHTML = i.returnedOn ? `<span style="color:var(--muted);">returned ${esc(finDate(i.returnedOn))}</span>` : ''; return; }
        const n = (i.renewals || []).length;
        el.innerHTML = i.termEnd ? `${i.termEnd < today ? '<span style="color:var(--danger);">ended ' : '<span>until '}${esc(finDate(i.termEnd))}</span> <button class="ghost small" data-invrenew="${el.dataset.invterm}" type="button" title="${n ? `Renewed ${n} time${n === 1 ? '' : 's'}` : 'Not renewed yet'}">Renewed${n ? ` (${n})` : ''}</button>` : '<span style="color:var(--muted);">no end date</span>';
    });
    // everyone who ever invested, with every investment (a person who got the money back and joined again keeps the whole history)
    const key = i => (i.tornId || String(i.name || '').trim().toLowerCase());
    const people = {};
    finData.investors.forEach(i => { (people[key(i)] = people[key(i)] || []).push(i); });
    const paidOf = i => ((i.payments || []).length ? (i.payments || []).reduce((a, p) => a + p.amount, 0) : (i.paidUntil ? finSum(finInvPeriods(i, i.paidUntil, '')) : 0));
    const rows = Object.values(people).map(list => { list.sort((a, b) => (a.start < b.start ? -1 : 1)); return { name: list[list.length - 1].name, list, now: list.filter(i => i.active).reduce((s, i) => s + i.amount, 0), paid: list.reduce((s, i) => s + paidOf(i), 0) }; }).sort((a, b) => b.now - a.now || (a.name < b.name ? -1 : 1));
    $('fund-people').innerHTML = rows.length ? `<div class="panel"><h3 style="margin-top:0;">People and their history</h3><div style="font-size:12px;color:var(--muted);margin:-4px 0 8px;">Grouped by Torn ID (or the name when there is none). Money that was given back stays here, so a person who joins again still has the whole history.</div>${rows.map(r => `<details style="border-top:1px solid var(--line);padding:5px 0;"><summary class="av-sum"><b>${esc(r.name)}</b> <span style="color:var(--muted);font-size:12px;">· in now ${finShort(r.now)} · ${r.list.length} investment${r.list.length === 1 ? '' : 's'} · paid out ${finShort(r.paid)}</span></summary>
        ${r.list.map(i => `<div style="font-size:12px;padding:2px 0 2px 14px;"><span style="font-family:var(--mono);">${finShort(i.amount)}</span> · ${esc(finDate(i.start))} → ${i.returnedOn ? `money returned ${esc(finDate(i.returnedOn))}` : i.termEnd ? `until ${esc(finDate(i.termEnd))}` : 'ongoing'}${(i.renewals || []).length ? ` · renewed ${(i.renewals || []).map(x => `${esc(finDate(x.from))} → ${esc(finDate(x.to))}`).join(', ')}` : ''} · ${i.active ? 'active' : 'ended'} · paid out ${finShort(paidOf(i))}</div>`).join('')}</details>`).join('')}</div>` : '';
    const hist = finData.investors.flatMap(i => (i.payments || []).map(p => ({ ...p, name: i.name }))).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 30);
    $('fund-history').innerHTML = hist.length ? `<div class="panel"><h3 style="margin-top:0;">Payout history</h3><table style="border-collapse:collapse;font-size:13px;">${hist.map(p => `<tr><td style="padding:2px 10px 2px 0;font-family:var(--mono);">${esc(p.date)}</td><td style="padding:2px 14px 2px 0;">${esc(p.name)}</td><td style="padding:2px 14px 2px 0;font-family:var(--mono);text-align:right;">${finMoney(p.amount)}</td><td style="padding:2px 0;color:var(--muted);font-size:12px;">${p.through ? `through ${esc(finDate(p.through))}` : ''}</td></tr>`).join('')}</table></div>` : '';
}
function finClickFund(b) {
    if (b.dataset.invrenew !== undefined) { // the investor renewed: a new end date; the old one is kept in the history
        const i = finData.investors[+b.dataset.invrenew]; if (!i) return;
        const to = prompt('New end date of the investment (YYYY-MM-DD):', i.termEnd ? finAdd(i.termEnd, 30) : '');
        if (!to) return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) { toast('Write the date as YYYY-MM-DD'); return; }
        i.renewals = (i.renewals || []).concat({ from: i.termEnd || '', to }).slice(-20); i.termEnd = to;
        finRenderAll(); finTouch(); return;
    }
    const i = finData.investors[+(b.dataset.invsync ?? b.dataset.invpay)];
    if (!i) return;
    const today = finSrv.today;
    if (b.dataset.invsync !== undefined) { const p = finInvPeriods(i, today, ''); if (!p.length) return; i.paidUntil = p[p.length - 1].date; }
    else if (b.dataset.invpay !== undefined) {
        const p = finInvPeriods(i, today, i.paidUntil); if (!p.length) return;
        i.payments = (i.payments || []).concat({ date: today, amount: finSum(p), through: p[p.length - 1].date }).slice(-100);
        i.paidUntil = p[p.length - 1].date;
    } else return;
    finRenderAll(); finTouch();
}

// ---- Buddy banking ----
function finRenderBuddy() {
    const t = (n, l, d) => `<div style="padding:6px 12px;border:1px solid var(--line);border-radius:8px;"><b>${n}</b><div style="font-size:12px;color:var(--muted);">${l} · ${d}</div></div>`;
    $('bb-body').innerHTML = `<div class="panel"><h3 style="margin-top:0;">How it works</h3>
        <p style="font-size:13px;margin:0 0 8px;">You put up the cash. The buddy invests it in their City Bank and earns the interest. When the term ends they keep 30% of the profit and send you back the principal plus 70% of the profit. The profit is whatever Torn's bank gives them, so it depends on their bank merits (they need 10/10 for this).</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">${t('🥉 Bronze', finShort(FIN_TIERS.bronze.amount), `${FIN_TIERS.bronze.days} days`)}${t('🥈 Silver', finShort(FIN_TIERS.silver.amount), `${FIN_TIERS.silver.days} days, after a promotion`)}${t('🥇 Gold', finShort(FIN_TIERS.gold.amount), `${FIN_TIERS.gold.days} days, after a promotion`)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:8px;">Everyone starts at Bronze. When you leave the expected profit at 0, the page estimates it from Torn's bank rate for 10/10 merits (5.14% for 1 month, 11.93% for 2 months); type the real profit in when you know it.</div></div>
        <div id="bb-summary"></div>${finListEditor('buddies')}`;
    finWire('bb-body');
    finRefresh();
}
function finRefreshBuddy() {
    const today = finSrv.today, act = finData.buddies.filter(b => b.status === 'active'), done = finData.buddies.filter(b => b.status === 'returned');
    const out = act.reduce((s, b) => s + b.amount, 0), back = act.reduce((s, b) => s + finBuddy(b).back, 0);
    const late = act.filter(b => finBuddy(b).due < today).length;
    const earned = done.reduce((s, b) => s + finBuddy(b).back - b.amount, 0);
    const box = (l, v, extra = '') => `<div><div style="color:var(--muted);font-size:11px;">${l}</div><b style="font-family:var(--mono);${extra}">${v}</b></div>`;
    $('bb-summary').innerHTML = `<div class="panel" style="display:flex;gap:26px;flex-wrap:wrap;font-size:13px;">
        ${box('Out with buddies', finShort(out))}${box('Comes back (with your share)', finShort(back))}${box('Your share of the profit', finShort(back - out))}
        ${box('Late', late, late ? 'color:var(--danger);' : '')}${box('Paid back so far', done.length)}${box('Earned so far (paid back)', finShort(earned))}</div>`;
    document.querySelectorAll('[data-bbact]').forEach(el => {
        const b = finData.buddies[+el.dataset.bbact]; if (!b) return;
        el.innerHTML = b.status === 'active' ? `<button class="small" data-bbpaid="${el.dataset.bbact}" type="button">Paid back</button>` : `<button class="ghost small" data-bbnew="${el.dataset.bbact}" type="button" title="Start a new round with the same buddy">New round</button>`;
    });
}
function finClickBuddy(btn) {
    const idx = +(btn.dataset.bbpaid ?? btn.dataset.bbnew), b = finData.buddies[idx];
    if (!b) return;
    if (btn.dataset.bbpaid !== undefined) { b.status = 'returned'; b.returnedOn = finSrv.today; }
    else if (btn.dataset.bbnew !== undefined) finData.buddies.splice(idx + 1, 0, { ...b, id: finId(), status: 'active', given: finSrv.today, profit: 0, returnedOn: '' });
    else return;
    finRenderAll(); finTouch();
}

FIN_PAGES.fund = { status: 'fund-status', render: finRenderFund, refresh: finRefreshFund, click: finClickFund, parts: ['investors', 'roi'] };
FIN_PAGES.buddy = { status: 'bb-status', render: finRenderBuddy, refresh: finRefreshBuddy, click: finClickBuddy, parts: ['buddies'] };
