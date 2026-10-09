// payouts.js — the payout calendar (CreaLotte menu, owners only): the pay calendar of the sheet, in WWL. A row per Sunday, a column per active investor, the amount to pay in every cell;
// you click a cell when you have paid it and it turns green (click again to take it back). One sheet for the weekly investors and one for the monthly ones (paid together on the last Sunday of the month).
// Under the calendar: the Discord weekly update for a chosen week, ready to copy. It shares the data and the helpers of finances.js (the same wwl:finances record, only the investors are saved).
'use strict';

let finPaySheet = 'weekly', finPayWeeks = 8, finPayWeek = '';
const loadPayouts = () => finLoadLight('pay', 'pay-status');

const finPayShortAmt = a => (a >= 1e9 ? `${+(a / 1e9).toFixed(2)}b` : `${+(a / 1e6).toFixed(0)}m`); // 1b, 500m, 1.5b, as in the sheet
// each person's payouts per Sunday: { date: { amount, lines: [index of every line paying that day] } }
function finPayPeople(upTo, fromIso) {
    const groups = {};
    finData.investors.forEach((x, idx) => { if (x.active) (groups[finPersonKey(x)] = groups[finPersonKey(x)] || []).push(idx); });
    return Object.entries(groups).map(([key, ix]) => {
        const days = {};
        ix.forEach(k => finInvPeriods(finData.investors[k], upTo, fromIso).forEach(p => { const d = (days[p.date] = days[p.date] || { amount: 0, lines: [] }); d.amount += p.amount; d.lines.push(k); }));
        const first = finData.investors[ix[0]];
        return { key, ix, days, name: finData.investors[ix[ix.length - 1]].name, id: parseInt(first.fundId, 10) || 1e9, mode: first.mode, invested: ix.reduce((s, k) => s + finData.investors[k].amount, 0), nettedIn: ix.every(k => finData.investors[k].nettedIn) };
    }).sort((a, b) => a.id - b.id);
}
const finCellState = (p, date) => { const d = p.days[date]; if (!d) return null; const lines = d.lines.map(k => finData.investors[k]); if (lines.every(i => finIsPaid(i, date))) return 'paid'; return lines.every(i => !finTracked(i)) ? 'unknown' : 'due'; };

function finRenderPay() {
    const opt = (list, cur) => list.map(([v, l]) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${l}</option>`).join('');
    $('pay-body').innerHTML = `<div class="panel" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:8px 12px;margin-bottom:8px;"><select id="pay-sheet">${opt([['weekly', 'Weekly investors'], ['monthly', 'Monthly investors (last Sunday of the month)']], finPaySheet)}</select>
            <label style="font-size:12px;color:var(--muted);">Weeks <select id="pay-weeks">${opt([[4, '4'], [8, '8'], [13, '13'], [26, '26']], finPayWeeks)}</select></label><span id="pay-count" style="font-size:12px;color:var(--muted);"></span><span style="flex:1;"></span>
            <span style="font-size:12px;"><span style="background:rgba(53,217,155,.28);padding:1px 8px;border-radius:4px;">paid</span> <span style="background:rgba(240,180,50,.30);padding:1px 8px;border-radius:4px;">still to pay</span> <span style="padding:1px 8px;border:1px solid var(--line);border-radius:4px;">not followed / later</span></span></div>
        <div id="pay-grid" class="panel" style="padding:0;overflow:auto;max-height:70vh;"></div>
        <div class="panel"><h3 style="margin-top:0;">Weekly update for Discord</h3><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;"><label style="font-size:13px;">Week ending <select id="pay-week"></select></label><button class="small" data-paycopy="1" type="button">Copy</button></div>
            <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">It counts what you marked as paid in the calendar (green): mark the week first, then copy.</div><textarea id="pay-text" rows="13" readonly style="width:100%;font-family:var(--mono);font-size:12px;"></textarea>
            <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px;"><span>Total paid out in your sheet for this week:</span><input id="pay-sheet-total" type="text" inputmode="decimal" placeholder="18,342,463,300" style="width:170px;text-align:right;font-family:var(--mono);"><button class="ghost small" data-paymatch="1" type="button">Match my total</button></div><div id="pay-offset-note" style="font-size:12px;color:var(--muted);margin-top:4px;"></div></div>`;
    finWire('pay-body');
    finRefresh();
}
function finRefreshPay() {
    const today = finSrv.today, end = finSun(today), start = finAdd(end, -7 * (finPayWeeks - 1)), dates = [];
    for (let d = start; d <= end; d = finAdd(d, 7)) dates.push(d);
    const people = finPayPeople(end, finAdd(start, -1)).filter(p => p.mode === finPaySheet && dates.some(d => p.days[d]));
    const cell = (p, d) => {
        const c = p.days[d]; if (!c) return '<td style="padding:0;border:1px solid var(--line);"></td>';
        const st = finCellState(p, d), bg = st === 'paid' ? 'rgba(53,217,155,.28)' : st === 'due' ? 'rgba(240,180,50,.30)' : 'transparent';
        return `<td style="padding:0;border:1px solid var(--line);background:${bg};"><button type="button" data-pc="${c.lines.join(',')}" data-d="${d}" style="all:unset;display:block;cursor:pointer;padding:3px 8px;text-align:right;font-family:var(--mono);font-size:12px;white-space:nowrap;min-width:84px;" title="${esc(p.name)}: click when paid">${finFull(c.amount)}</button></td>`;
    };
    const sticky = 'position:sticky;left:0;background:var(--bench-2,#1b212b);z-index:1;';
    const th = 'padding:3px 8px;font-size:11px;font-weight:600;white-space:nowrap;border:1px solid var(--line);';
    $('pay-grid').innerHTML = people.length ? `<table style="border-collapse:collapse;font-size:12px;"><thead>
        <tr><th style="${th}${sticky}"></th>${people.map(p => `<th style="${th}color:var(--muted);text-align:right;">${finPayShortAmt(p.invested)}</th>`).join('')}<th style="${th}"></th></tr>
        <tr><th style="${th}${sticky}">Sunday</th>${people.map(p => `<th style="${th}text-align:right;">${esc(p.name)}</th>`).join('')}<th style="${th}text-align:right;">Total</th></tr></thead>
        <tbody>${dates.map(d => { const tot = people.reduce((s, p) => s + (p.days[d] ? p.days[d].amount : 0), 0), todo = people.some(p => finCellState(p, d) === 'due');
            return `<tr><th style="${th}${sticky}text-align:left;${d === end ? 'color:#35d99b;' : ''}">${esc(finDate(d))}${todo ? ` <button type="button" class="ghost small" data-payrow="${d}" title="Mark every payout of this Sunday as paid" style="padding:0 6px;">✓ all</button>` : ''}</th>${people.map(p => cell(p, d)).join('')}<td style="${th}text-align:right;font-family:var(--mono);">${tot ? finFull(tot) : ''}</td></tr>`; }).join('')}</tbody>
        <tfoot><tr><th style="${th}${sticky}text-align:left;">Total</th>${people.map(p => `<td style="${th}text-align:right;font-family:var(--mono);">${finFull(dates.reduce((s, d) => s + (p.days[d] ? p.days[d].amount : 0), 0))}</td>`).join('')}<td style="${th}text-align:right;font-family:var(--mono);">${finFull(people.reduce((s, p) => s + dates.reduce((a, d) => a + (p.days[d] ? p.days[d].amount : 0), 0), 0))}</td></tr></tfoot></table>`
        : '<div style="padding:14px;color:var(--muted);">Nothing to pay in these weeks.</div>';
    if ($('pay-count')) $('pay-count').textContent = `${people.length} investors`;
    // the Discord update: the weeks of the calendar, the latest week as the default
    const sel = $('pay-week'), weeks = dates.slice().reverse();
    if (!finPayWeek || !weeks.includes(finPayWeek)) finPayWeek = weeks.find(d => d <= today) || weeks[0];
    sel.innerHTML = weeks.map(d => `<option value="${d}" ${d === finPayWeek ? 'selected' : ''}>${esc(finDate(d))}</option>`).join('');
    $('pay-text').value = finWeeklyText(finPayWeek);
    $('pay-offset-note').textContent = `WWL works out ${finMoney(finPaidUpTo(finPayWeek))} for this week; correction ${finData.paidOffset ? (finData.paidOffset > 0 ? '+' : '') + finMoney(finData.paidOffset) : 'none'}.`;
}
// everything paid out up to a Sunday, as WWL works it out from the lines (without the correction)
const finPaidUpTo = sun => finData.investors.reduce((s, i) => s + finSum(finPaidList(i).filter(p => p.date <= sun)), 0);
// the weekly update, in the shape of the Discord post. It counts what was PAID (the cells marked green in the calendar): the weekly investors paid that Sunday; on the monthly payday the monthly investors paid, on other
// weeks the date of the next monthly payday; the active money and investors now; and everything paid out since the start up to that Sunday.
function finWeeklyText(sun) {
    const fmt = d => new Date(finD(d)).toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' });
    const live = finData.investors.filter(i => i.active || i.returnedOn);
    const paidOn = i => finSum(finInvPeriods(i, sun, finAdd(sun, -1)).filter(p => p.date === sun && finIsPaid(i, sun)));
    const weekly = live.filter(i => i.mode === 'weekly').reduce((s, i) => s + paidOn(i), 0);
    const last = finMonthLastSunday(+sun.slice(0, 4), +sun.slice(5, 7) - 1), payday = sun === last;
    const monthly = live.filter(i => i.mode === 'monthly').reduce((s, i) => s + paidOn(i), 0);
    const dateText = `${last.slice(8, 10)}${new Date(finD(last)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}${last.slice(0, 4)}`; // 25Oct2026
    const act = finData.investors.filter(i => i.active);
    const people = new Set(act.map(finPersonKey)).size, capital = act.reduce((s, i) => s + i.amount, 0);
    const paid = finPaidUpTo(sun) + (finData.paidOffset || 0); // plus the correction that makes the total match the sheet (the lines of people who left are only estimates)
    return ['@everyone', '💰 CreaLabs Weekly Update', `[${fmt(finAdd(sun, -6))} → ${fmt(sun)}]`, '', 'Investor Payouts', `💵 Weekly investors paid: ${finMoney(weekly)}`, `🗓️ Monthly investors paid: ${payday ? finMoney(monthly) : dateText}`, '', 'Fund Overview',
        `💎 Total investment capital: ${finMoney(capital)}`, `🤝 Number of investors: ${people}`, `💰 Total paid out since start: ${finMoney(paid)}`].join('\n');
}
// click a cell: paid / not paid. Before "paid through" a week left unpaid is remembered in `skip`, after it a single paid week in `extra`; a run of paid weeks right after "paid through" moves it forward.
function finTogglePaid(i, date) {
    if (!finTracked(i)) { const before = finInvPeriods(i, finAdd(date, -1), '').pop(); i.paidUntil = before ? before.date : finAdd(i.start, -1); } // first click on a line nobody followed yet: what is before it counts as paid
    const t = finPaidThrough(i), paid = finIsPaid(i, date);
    i.skip = i.skip || []; i.extra = i.extra || [];
    if (date <= t) { i.skip = paid ? i.skip.concat(date) : i.skip.filter(d => d !== date); } else { i.extra = paid ? i.extra.filter(d => d !== date) : i.extra.concat(date); }
    for (let n = 0; n < 60; n++) { // paid weeks that now follow "paid through" without a gap become part of it
        const nx = finInvPeriods(i, finAdd(i.paidUntil || t, 400), i.paidUntil || t)[0];
        if (!nx || !i.extra.includes(nx.date)) break;
        i.paidUntil = nx.date; i.extra = i.extra.filter(d => d !== nx.date);
    }
}
function finClickPay(b) {
    if (b.dataset.paymatch !== undefined) { // make the total of the selected week equal to the sheet's: the difference is kept as a correction (the lines of people who left are only estimates)
        const v = finParse($('pay-sheet-total').value);
        if (v === null) { toast('Write the total as 18,342,463,300'); return; }
        finData.paidOffset = v - finPaidUpTo(finPayWeek);
        finTouch(); return;
    }
    if (b.dataset.pc !== undefined) { b.dataset.pc.split(',').forEach(k => { const i = finData.investors[+k]; if (i) finTogglePaid(i, b.dataset.d); }); finTouch(); return; }
    if (b.dataset.payrow !== undefined) { // every payout of this Sunday that is still to pay
        const d = b.dataset.payrow;
        finData.investors.forEach(i => { if (i.active && finTracked(i) && !finIsPaid(i, d) && finInvPeriods(i, d, finAdd(d, -1)).some(p => p.date === d)) finTogglePaid(i, d); });
        finTouch(); return;
    }
    if (b.dataset.paycopy !== undefined) {
        const v = $('pay-text').value;
        (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).catch(() => { $('pay-text').select(); try { document.execCommand('copy'); } catch (e) { /* select by hand */ } }).then(() => toast('Copied'));
    }
}
FIN_PAGES.pay = { status: 'pay-status', render: finRenderPay, refresh: finRefreshPay, click: finClickPay, parts: ['investors', 'paidOffset'] };
