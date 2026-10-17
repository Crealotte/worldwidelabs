// funding.js — "Trading Funding" (CreaLotte > Opportunities, owner only): money you put up for a trader to trade with, for a weekly fee. Every funding is one amount with its own clock; the fee follows a ladder that goes down the longer the
// money stays (2.5% a week for the first 4 weeks, down to 1.25% after a year), or a fixed fee a week typed on the line (for a loan that was agreed in its own way). It shares the data and the list editors of finances.js (the same wwl:finances
// record) and saves only its own list (fin-part-save). The fees also feed the week-by-week forecast on the Finances page (finModel).
'use strict';

// the ladder: [first week, last week, % a week]; the weeks count from the start of a funding (week 1 = the first 7 days)
const FN_LADDER = [[1, 4, 2.5], [5, 12, 2.25], [13, 24, 2.0], [25, 36, 1.75], [37, 52, 1.5], [53, 1e9, 1.25]];
const FN_SHARE_MAX = 15; // % of the total capital that may sit with one person before the page warns
const fnPct = n => (FN_LADDER.find(s => n >= s[0] && n <= s[1]) || FN_LADDER[FN_LADDER.length - 1])[2];
const fnFixed = f => f.feeWeekly !== null && f.feeWeekly !== undefined && Number(f.feeWeekly) > 0;
const fnFee = (f, n) => (fnFixed(f) ? Math.round(Number(f.feeWeekly)) : Math.round(f.amount * fnPct(n) / 100));
const fnWeekNo = (f, iso) => Math.max(1, Math.floor((finD(iso) - finD(f.start)) / 86400000 / 7) + 1); // the funding week a date is in
// the fees that came due up to a date: week k is paid at its end, 7 x k days after the start; nothing after the money was returned
function fnDues(f, upTo) {
    const out = [];
    for (let k = 1; k < 700; k++) {
        const date = finAdd(f.start, 7 * k);
        if (date > upTo || (f.endedOn && date > f.endedOn)) break;
        out.push({ date, week: k, pct: fnFixed(f) ? (f.amount ? Number(f.feeWeekly) / f.amount * 100 : 0) : fnPct(k), amount: fnFee(f, k) });
    }
    return out;
}
const fnPaidSum = f => fnDues(f, f.paidUntil || '0000-00-00').reduce((s, p) => s + p.amount, 0);
// how many weeks of fees it takes to earn the amount itself back
function fnPayback(f) {
    if (!f.amount) return null;
    let sum = 0;
    for (let k = 1; k < 700; k++) { sum += fnFee(f, k); if (sum >= f.amount) return k; }
    return null;
}
const fnMoney = n => finMoney(n);
const fnPctText = p => `${(Math.round(p * 100) / 100).toString()}%`;

FIN_LISTS.fundings = { title: 'Fundings', add: '+ Funding', fresh: () => ({ id: finId(), name: '', tornId: '', amount: 500000000, start: new Date().toISOString().slice(0, 10), method: '', feeWeekly: null, active: true, note: '', paidUntil: '', endedOn: '', payments: [] }), cols: [
    { f: 'active', l: 'On', t: 'bool' }, { f: 'name', l: 'Trader', t: 'text', w: 130 }, { f: 'tornId', l: 'Torn ID', t: 'text', w: 80 }, { f: 'amount', l: 'Funded', t: 'money', w: 120 },
    { f: 'start', l: 'Since', t: 'date' }, { f: 'feeWeekly', l: 'Fixed fee a week (empty = the ladder)', t: 'money', w: 110, nullable: true },
    { f: 'method', l: 'Trades', t: 'sel', opts: [['', '?'], ['items', 'Items'], ['caches', 'Caches'], ['rw', 'RW weapons']] }, { f: 'endedOn', l: 'Money returned on', t: 'date' }, { f: 'note', l: 'Note', t: 'text', w: 110 }] };

function finRenderFunding() {
    const ladderRows = FN_LADDER.map(([a, b, p]) => `<tr><td style="padding:2px 14px 2px 0;">${b >= 1e9 ? `after week ${a - 1}` : `weeks ${a} to ${b}`}</td><td style="padding:2px 14px 2px 0;font-weight:700;">${fnPctText(p)}</td><td style="padding:2px 14px 2px 0;color:var(--muted);">${Math.round(p * 52)}% a year</td><td style="padding:2px 14px 2px 0;font-family:var(--mono);">${fnMoney(500000000 * p / 100)}</td><td style="padding:2px 14px 2px 0;font-family:var(--mono);">${fnMoney(1000000000 * p / 100)}</td><td style="padding:2px 0;font-family:var(--mono);">${fnMoney(2000000000 * p / 100)}</td></tr>`).join('');
    $('fn-body').innerHTML = `<div id="fn-summary"></div>
        <details class="panel"><summary class="av-sum"><b>The fee ladder</b> <span style="font-size:12px;color:var(--muted);">(what a funding pays a week; it goes down the longer the money stays)</span></summary>
            <table style="border-collapse:collapse;font-size:13px;margin-top:8px;"><thead><tr style="color:var(--muted);font-size:11px;text-align:left;"><th style="padding:2px 14px 2px 0;">Step</th><th style="padding:2px 14px 2px 0;">Fee a week</th><th style="padding:2px 14px 2px 0;">Per year</th><th style="padding:2px 14px 2px 0;">On 500m</th><th style="padding:2px 14px 2px 0;">On 1b</th><th style="padding:2px 0;">On 2b</th></tr></thead><tbody>${ladderRows}</tbody></table>
            <div style="font-size:11px;color:var(--muted);margin-top:6px;">Every amount that is added has its own clock, so a second funding for the same trader starts at the top of the ladder again. A fixed fee typed on a line (for a funding that was agreed in its own way) replaces the ladder for that line.</div></details>
        <div class="panel" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:13px;"><label style="display:flex;gap:6px;align-items:center;">My total capital (to judge how much one trader holds): <input type="text" inputmode="decimal" id="fn-cap" value="${finData.fundingCap ? finFull(finData.fundingCap) : ''}" placeholder="e.g. 60b" style="width:140px;text-align:right;font-family:var(--mono);"></label><span id="fn-share" style="font-size:12px;"></span></div>
        ${finListEditor('fundings')}`;
    finWire('fn-body');
    $('fn-cap').addEventListener('change', e => {
        const txt = e.target.value.trim(), v = txt === '' ? 0 : finParse(txt);
        if (v === null) { toast('Write it as 60b or 60,000,000,000'); return; }
        finData.fundingCap = v; e.target.value = v ? finFull(v) : ''; finTouch();
    });
    finRefresh();
}

function finRefreshFunding() {
    const today = finSrv.today, rows = finData.fundings || [];
    const act = rows.filter(f => f.active && f.amount && f.start), weekNow = f => fnFee(f, fnWeekNo(f, today));
    const out = act.reduce((s, f) => s + f.amount, 0), feeWeek = act.reduce((s, f) => s + weekNow(f), 0);
    const earned = rows.reduce((s, f) => s + fnPaidSum(f), 0), dueAll = act.reduce((s, f) => s + fnDues(f, today).filter(p => !f.paidUntil || p.date > f.paidUntil).reduce((a, p) => a + p.amount, 0), 0);
    const box = (l, v, extra = '') => `<div><div style="color:var(--muted);font-size:11px;">${l}</div><b style="font-family:var(--mono);${extra}">${v}</b></div>`;
    $('fn-summary').innerHTML = `<div class="panel" style="display:flex;gap:26px;flex-wrap:wrap;font-size:13px;">${box('Out with traders', fnMoney(out))}${box('Fees a week now', fnMoney(feeWeek))}${box('Per year at this rate', fnMoney(feeWeek * 52), 'color:var(--success,#35d99b);')}
        ${box('Per year, of what is out', out ? `${(feeWeek * 52 / out * 100).toFixed(0)}%` : '—')}${box('Earned so far (paid)', fnMoney(earned))}${box('Due now', dueAll ? fnMoney(dueAll) : '—', dueAll ? 'color:#e0a030;' : '')}</div>`;
    // how much one trader holds, against the total capital typed above
    const share = $('fn-share');
    if (share) {
        const per = {}; act.forEach(f => { const k = f.tornId || String(f.name || '').trim().toLowerCase(); (per[k] = per[k] || { name: f.name, sum: 0 }).sum += f.amount; });
        const cap = finData.fundingCap || 0, big = Object.values(per).sort((a, b) => b.sum - a.sum);
        share.innerHTML = cap && big.length ? big.map(p => { const pct = p.sum / cap * 100; return `<span style="color:${pct > FN_SHARE_MAX ? 'var(--danger)' : 'var(--muted)'};margin-right:12px;">${esc(p.name)} ${pct.toFixed(1)}%${pct > FN_SHARE_MAX ? ' ⚠' : ''}</span>`; }).join('') + `<span style="color:var(--muted);">(more than ${FN_SHARE_MAX}% with one trader is a warning)</span>` : cap ? '' : '<span style="color:var(--muted);">Fill in your capital to see how much each trader holds.</span>';
    }
    document.querySelectorAll('[data-fninfo]').forEach(el => {
        const f = rows[+el.dataset.fninfo]; if (!f) return;
        if (!f.start || !f.amount) { el.innerHTML = '<span style="color:var(--muted);">fill in the amount and the start date</span>'; return; }
        const n = fnWeekNo(f, f.endedOn && f.endedOn < today ? f.endedOn : today), fee = fnFee(f, n), pct = fnFixed(f) ? fee / f.amount * 100 : fnPct(n), earnedF = fnPaidSum(f), pb = fnPayback(f);
        el.innerHTML = f.endedOn && f.endedOn <= today ? `<span style="color:var(--muted);">returned ${esc(finDate(f.endedOn))} · earned ${fnMoney(earnedF)} (${(earnedF / f.amount * 100).toFixed(0)}%)</span>`
            : `<div><b>week ${n}</b> · ${fnPctText(Math.round(pct * 100) / 100)}${fnFixed(f) ? ' (fixed)' : ''} · <b>${fnMoney(fee)}</b> a week${fnFixed(f) ? '' : ` <span style="color:var(--muted);">(${Math.round(pct * 52)}% a year)</span>`}</div>
               <div style="color:var(--muted);">earned ${fnMoney(earnedF)} (${(earnedF / f.amount * 100).toFixed(0)}% of the funding)${pb ? ` · earns itself back in week ${pb}` : ''}</div>`;
    });
    document.querySelectorAll('[data-fnact]').forEach(el => {
        const f = rows[+el.dataset.fnact]; if (!f || !f.start || !f.amount) { el.innerHTML = ''; return; }
        const due = fnDues(f, today).filter(p => !f.paidUntil || p.date > f.paidUntil), sum = due.reduce((s, p) => s + p.amount, 0);
        el.innerHTML = due.length ? `<b style="color:#e0a030;">${fnMoney(sum)}</b> <span style="color:var(--muted);font-size:11px;">${due.length} week${due.length === 1 ? '' : 's'}</span> <button class="small" data-fnpaid="${el.dataset.fnact}" type="button">Paid</button>` : '<span style="color:var(--muted);">up to date</span>';
    });
}
// the Paid button: every fee due up to now is paid: remember it as a payment and move "paid through" forward
function finClickFunding(btn) {
    if (btn.dataset.fnpaid === undefined) return;
    const f = finData.fundings[+btn.dataset.fnpaid]; if (!f) return;
    const due = fnDues(f, finSrv.today).filter(p => !f.paidUntil || p.date > f.paidUntil);
    if (!due.length) return;
    f.payments = (f.payments || []).concat({ date: finSrv.today, amount: due.reduce((s, p) => s + p.amount, 0), through: due[due.length - 1].date }).slice(-100);
    f.paidUntil = due[due.length - 1].date;
    finRenderAll(); finTouch();
}
FIN_PAGES.funding = { status: 'fn-status', render: finRenderFunding, refresh: finRefreshFunding, click: finClickFunding, parts: ['fundings', 'fundingCap'] };
