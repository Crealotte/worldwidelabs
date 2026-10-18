// payouts.js — the payout calendar (CreaLotte menu, owners only): the pay calendar of the sheet, in WWL. A row per Sunday, a column per active investor, the amount to pay in every cell;
// you click a cell when you have paid it and it turns green (click again to take it back). One sheet for the weekly investors and one for the monthly ones (paid together on the last Sunday of the month).
// Under the calendar: the Discord weekly update for a chosen week, ready to copy. It shares the data and the helpers of finances.js (the same wwl:finances record, only the investors are saved).
'use strict';

let finPaySheet = 'weekly', finPayWeeks = 8, finPayAhead = 8, finPaySort = 'amount', finPayWeek = '', finPayTool = 'paid';
const loadPayouts = () => finLoadLight('pay', 'pay-status');
// Torn ID by lower-case name, from the members of your faction: an investor without a Torn ID filled in still gets a link to their profile when their name is a member's name
let finPayRoster = null;
async function finPayLoadRoster() {
    if (finPayRoster) return;
    finPayRoster = {};
    try { const r = await tornV2('/faction/members?striptags=true'); (r.members || []).forEach(m => { finPayRoster[String(m.name).trim().toLowerCase()] = String(m.id); }); finRenderPay(); } catch (e) { /* the links then only exist for the investors that have a Torn ID */ }
}

const finPayShortAmt = a => (a >= 1e9 ? `${+(a / 1e9).toFixed(2)}b` : `${+(a / 1e6).toFixed(0)}m`); // 1b, 500m, 1.5b, as in the sheet
// each person's payouts per Sunday: { date: { amount, lines: [index of every line paying that day] } }; `week` = what they are paid a week now (to group people who get the same)
function finPayPeople(upTo, fromIso) {
    const groups = {};
    finData.investors.forEach((x, idx) => { if (x.active) (groups[finPersonKey(x)] = groups[finPersonKey(x)] || []).push(idx); });
    return Object.entries(groups).map(([key, ix]) => {
        const daysBy = { weekly: {}, monthly: {} }; // the payouts per pay plan: a person whose plan changed shows on both sheets
        ix.forEach(k => finInvPeriods(finData.investors[k], upTo, fromIso).forEach(p => { const m = daysBy[p.mode], d = (m[p.date] = m[p.date] || { amount: 0, lines: [] }); d.amount += p.amount; d.lines.push(k); }));
        // when the money goes back (an approved withdrawal at the end of the term) and when a term simply ends, on the Sunday of that week
        const back = {}, ends = {};
        ix.forEach(k => { const l = finData.investors[k]; if (!l.termEnd) return; const d = finSun(l.termEnd), target = l.leaving ? back : ends; (target[d] = target[d] || { amount: 0, lines: [] }); target[d].amount += l.amount; target[d].lines.push(k); });
        const first = finData.investors[ix[0]];
        return { key, ix, daysBy, changed: ix.some(k => (finData.investors[k].switches || []).length), back, ends, name: finData.investors[ix[ix.length - 1]].name, tornId: (ix.map(k => String(finData.investors[k].tornId || '').replace(/\D/g, '')).find(Boolean) || ix.map(k => (finPayRoster || {})[String(finData.investors[k].name || '').trim().toLowerCase()]).find(Boolean) || ''), id: parseInt(first.fundId, 10) || 1e9, mode: first.mode, invested: ix.reduce((s, k) => s + finData.investors[k].amount, 0), week: ix.reduce((s, k) => s + finPayout(finData.investors[k]), 0), nettedIn: ix.every(k => finData.investors[k].nettedIn) };
    });
}
const finCellState = (p, date) => {
    const d = p.days[date]; if (!d) return null;
    const lines0 = d.lines.map(k => finData.investors[k]);
    if (lines0.every(i => !finIsPaid(i, date) && finIsPausedAt(i, date))) return 'paused'; // held: the investor is on pause mode, released in full when they are back
    if (date > finSrv.today) return 'later'; // a payout of a coming Sunday: nothing to colour yet
    const lines = d.lines.map(k => finData.investors[k]);
    if (lines.every(i => finIsPaid(i, date))) return 'paid';
    return lines.every(i => !finTracked(i)) ? 'unknown' : 'due';
};

function finRenderPay() {
    finPayLoadRoster();
    const opt = (list, cur) => list.map(([v, l]) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${l}</option>`).join('');
    $('pay-body').innerHTML = `<div class="panel" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:8px 12px;margin-bottom:8px;"><select id="pay-sheet">${opt([['weekly', 'Weekly investors'], ['monthly', 'Monthly investors (last Sunday of the month)']], finPaySheet)}</select>
            <label style="font-size:12px;color:var(--muted);">Weeks back <select id="pay-weeks">${opt([[4, '4'], [8, '8'], [13, '13'], [26, '26']], finPayWeeks)}</select></label>
            <label style="font-size:12px;color:var(--muted);">Weeks ahead <select id="pay-ahead">${opt([[0, '0'], [4, '4'], [8, '8'], [13, '13']], finPayAhead)}</select></label>
            <label style="font-size:12px;color:var(--muted);">A click marks <select id="pay-tool">${opt([['paid', 'paid (green)'], ['pause', 'paused (blue)']], finPayTool)}</select></label>
            <label style="font-size:12px;color:var(--muted);">Order <select id="pay-sort">${opt([['amount', 'What they get a week (groups)'], ['id', 'ID'], ['invested', 'Invested (high first)'], ['name', 'Name']], finPaySort)}</select></label><span id="pay-count" style="font-size:12px;color:var(--muted);"></span><span style="flex:1;"></span>
            <span style="font-size:12px;"><span style="background:rgba(53,217,155,.28);padding:1px 8px;border-radius:4px;">paid</span> <span style="background:rgba(240,180,50,.30);padding:1px 8px;border-radius:4px;">still to pay</span> <span style="background:rgba(70,140,255,.38);padding:1px 8px;border-radius:4px;">paused (held)</span> <span style="padding:1px 8px;border:1px solid var(--line);border-radius:4px;">not followed / later</span></span></div>
        <div id="pay-grid" class="panel" style="padding:0;overflow:auto;max-height:72vh;"></div>
        <div style="font-size:12px;color:var(--muted);margin:-4px 0 10px;">With the order on "what they get a week", people who get the same amount stand together; press the amount at the top of a group to mark this week's payout of the whole group as paid.</div>
        <div class="panel"><h3 style="margin-top:0;">Weekly update for Discord</h3><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;"><label style="font-size:13px;">Week ending <select id="pay-week"></select></label><button class="small" data-paycopy="1" type="button">Copy</button></div>
            <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">It counts what you marked as paid in the calendar (green): mark the week first, then copy.</div><textarea id="pay-text" rows="13" readonly style="width:100%;font-family:var(--mono);font-size:12px;"></textarea>
            <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px;"><span>Total paid out in your sheet for this week:</span><input id="pay-sheet-total" type="text" inputmode="decimal" placeholder="18,342,463,300" style="width:170px;text-align:right;font-family:var(--mono);"><button class="ghost small" data-paymatch="1" type="button">Match my total</button></div><div id="pay-offset-note" style="font-size:12px;color:var(--muted);margin-top:4px;"></div></div>
        ${finCalPanel()}`;
    finWire('pay-body');
    finRefresh();
}
function finRefreshPay() {
    const today = finSrv.today, cur = finSun(today), start = finAdd(cur, -7 * (finPayWeeks - 1)), end = finAdd(cur, 7 * finPayAhead), dates = [];
    for (let d = start; d <= end; d = finAdd(d, 7)) dates.push(d);
    const payDay = dates.filter(d => d <= today).pop() || dates[0]; // the Sunday that is being paid now
    const people = finPayPeople(end, finAdd(start, -1)).map(p => ({ ...p, days: p.daysBy[finPaySheet] })).filter(p => Object.keys(p.days).length || (p.mode === finPaySheet && !p.changed)); // the people of this sheet (also when nothing falls in these weeks); someone who changed plan is on both sheets
    people.forEach(p => { Object.keys(p.back).filter(d => d < start).forEach(d => { const e = p.back[d], t = (p.back[payDay] = p.back[payDay] || { amount: 0, lines: [] }); t.amount += e.amount; t.lines.push(...e.lines); delete p.back[d]; }); }); // a payback that is overdue before the first week shown is placed on the Sunday being paid
    const cmp = { amount: (a, b) => (a.week - b.week) || (a.id - b.id), id: (a, b) => a.id - b.id, invested: (a, b) => (b.invested - a.invested) || (a.id - b.id), name: (a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1) }[finPaySort];
    people.sort(cmp);
    // groups of people who get the same amount a week (only when ordered by amount)
    const grp = []; if (finPaySort === 'amount') people.forEach((p, n) => { const g = grp[grp.length - 1]; if (g && g.week === p.week) { g.count++; g.ix.push(...p.ix); } else grp.push({ week: p.week, count: 1, start: n, ix: p.ix.slice() }); });
    const gStart = new Set(grp.map(g => g.start));
    const cell = (p, n, d) => {
        const c = p.days[d], bl = gStart.has(n) && n > 0 ? 'border-left:2px solid var(--muted);' : '', pb = p.back[d];
        if (!c && !pb) return `<td style="padding:0;border:1px solid var(--line);${bl}"></td>`;
        const st = c ? finCellState(p, d) : null, bg = st === 'paid' ? 'rgba(53,217,155,.28)' : st === 'due' ? 'rgba(240,180,50,.30)' : st === 'paused' ? 'rgba(70,140,255,.38)' : 'transparent';
        const btn = c ? `<button type="button" data-pc="${c.lines.join(',')}" data-d="${d}" style="all:unset;display:block;cursor:pointer;padding:3px 8px;text-align:right;font-family:var(--mono);font-size:12px;white-space:nowrap;min-width:84px;${st === 'later' ? 'opacity:.75;' : ''}" title="${esc(p.name)}: click when paid">${finFull(c.amount)}</button>` : '';
        const late = pb && d <= today, back = pb ? `<button type="button" data-payback="${pb.lines.join(',')}" data-d="${d}" style="all:unset;display:block;cursor:pointer;padding:2px 8px;text-align:right;font-size:11px;font-weight:700;white-space:nowrap;background:${late ? 'rgba(224,85,85,.45)' : 'rgba(155,89,182,.40)'};" title="${esc(p.name)} withdraws: pay the money back, then click to mark it returned">↩ pay back ${finFull(pb.amount)}</button>` : '';
        return `<td style="padding:0;border:1px solid var(--line);${bl}background:${bg};">${btn}${back}</td>`;
    };
    const sticky = 'position:sticky;left:0;background:var(--bench-2,#1b212b);z-index:1;';
    const th = 'padding:3px 8px;font-size:11px;font-weight:600;white-space:nowrap;border:1px solid var(--line);';
    const nm = (p, n) => `<th style="${th}text-align:right;${gStart.has(n) && n > 0 ? 'border-left:2px solid var(--muted);' : ''}">${p.tornId ? `<a href="https://www.torn.com/profiles.php?XID=${esc(p.tornId)}" target="_blank" rel="noopener" title="Open ${esc(p.name)}'s Torn profile" style="color:inherit;text-decoration:underline dotted;">${esc(p.name)}</a>` : esc(p.name)}</th>`;
    const inv = (p, n) => `<th style="${th}color:var(--muted);text-align:right;${gStart.has(n) && n > 0 ? 'border-left:2px solid var(--muted);' : ''}">${finPayShortAmt(p.invested)}</th>`;
    $('pay-grid').innerHTML = people.length ? `<table style="border-collapse:collapse;font-size:12px;"><thead>
        ${grp.length ? `<tr><th style="${th}${sticky}text-align:left;">Per week</th>${grp.map(g => `<th colspan="${g.count}" style="${th}text-align:center;border-left:2px solid var(--muted);"><button type="button" class="ghost small" data-paygroup="${g.ix.join(',')}" data-d="${payDay}" title="Mark the payout of ${esc(finDate(payDay))} of these ${g.count} investor${g.count === 1 ? '' : 's'} as paid" style="padding:0 8px;font-family:var(--mono);">${finFull(g.week)} · ${g.count} ✓</button></th>`).join('')}<th style="${th}"></th></tr>` : ''}
        <tr><th style="${th}${sticky}"></th>${people.map(inv).join('')}<th style="${th}"></th></tr>
        <tr><th style="${th}${sticky}">Sunday</th>${people.map(nm).join('')}<th style="${th}text-align:right;">Total</th></tr></thead>
        <tbody>${dates.map(d => { const tot = people.reduce((s, p) => s + (p.days[d] ? p.days[d].amount : 0), 0), todo = people.some(p => finCellState(p, d) === 'due'), later = d > today;
            return `<tr><th style="${th}${sticky}text-align:left;${d === payDay ? 'color:#35d99b;' : later ? 'color:var(--muted);' : ''}">${esc(finDate(d))}${todo ? ` <button type="button" class="ghost small" data-payrow="${d}" title="Mark every payout of this Sunday as paid" style="padding:0 6px;">✓ all</button>` : ''}</th>${people.map((p, n) => cell(p, n, d)).join('')}<td style="${th}text-align:right;font-family:var(--mono);">${tot ? finFull(tot) : ''}</td></tr>`; }).join('')}</tbody>
        <tfoot><tr><th style="${th}${sticky}text-align:left;">Total</th>${people.map(p => `<td style="${th}text-align:right;font-family:var(--mono);">${finFull(dates.reduce((s, d) => s + (p.days[d] ? p.days[d].amount : 0), 0))}</td>`).join('')}<td style="${th}text-align:right;font-family:var(--mono);">${finFull(people.reduce((s, p) => s + dates.reduce((a, d) => a + (p.days[d] ? p.days[d].amount : 0), 0), 0))}</td></tr></tfoot></table>`
        : '<div style="padding:14px;color:var(--muted);">Nobody on this sheet.</div>';
    if ($('pay-count')) { const noLink = people.filter(p => !p.tornId).length; $('pay-count').textContent = `${people.length} investors${noLink ? `, ${noLink} without a profile link (no Torn ID filled in, and not a member of your faction): ${people.filter(p => !p.tornId).map(p => p.name).join(', ')}` : ''}`; }
    // the Discord update: the weeks of the calendar, the latest paid week as the default
    const sel = $('pay-week'), weeks = dates.slice().reverse();
    if (!finPayWeek || !weeks.includes(finPayWeek)) finPayWeek = payDay;
    sel.innerHTML = weeks.map(d => `<option value="${d}" ${d === finPayWeek ? 'selected' : ''}>${esc(finDate(d))}</option>`).join('');
    $('pay-text').value = finWeeklyText(finPayWeek);
    $('pay-offset-note').textContent = `WWL works out ${finMoney(finPaidUpTo(finPayWeek))} for this week; correction ${finData.paidOffset ? (finData.paidOffset > 0 ? '+' : '') + finMoney(finData.paidOffset) : 'none'}.`;
}
// everything paid out up to a Sunday, as WWL works it out from the lines (without the correction)
const finPaidUpTo = sun => finData.investors.reduce((s, i) => s + finSum(finPaidList(i).filter(p => p.date <= sun)) + (i.paidAdj || 0), 0);
// the weekly update, in the shape of the Discord post. It counts what was PAID (the cells marked green in the calendar): the weekly investors paid that Sunday; on the monthly payday the monthly investors paid, on other
// weeks the date of the next monthly payday; the active money and investors now; and everything paid out since the start up to that Sunday.
function finWeeklyText(sun) {
    const fmt = d => new Date(finD(d)).toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' });
    const live = finData.investors.filter(i => i.active || i.returnedOn);
    const paidOn = (i, mode) => finSum(finInvPeriods(i, sun, finAdd(sun, -1)).filter(p => p.date === sun && p.mode === mode && finIsPaid(i, sun)));
    const weekly = live.reduce((s, i) => s + paidOn(i, 'weekly'), 0);
    const last = finMonthLastSunday(+sun.slice(0, 4), +sun.slice(5, 7) - 1), payday = sun === last;
    const monthly = live.reduce((s, i) => s + paidOn(i, 'monthly'), 0);
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
    if (b.dataset.payback !== undefined) { // the money of a withdrawing investor was paid back: the investment ends
        const idx = b.dataset.payback.split(',').map(Number), lines = idx.map(k => finData.investors[k]).filter(Boolean);
        const amount = lines.reduce((s, l) => s + l.amount, 0);
        if (!confirm(`Mark ${finMoney(amount)} as paid back to ${lines[0].name}? The investment ends and the payouts stop.`)) return;
        lines.forEach(l => { l.returnedOn = l.termEnd && l.termEnd <= finSrv.today ? l.termEnd : finSrv.today; l.active = false; l.leaving = false; });
        finTouch(); return;
    }
    if (b.dataset.calprev !== undefined || b.dataset.calgo !== undefined) { finClickCal(b); return; }
    if (b.dataset.paygroup !== undefined) { // the payout of the Sunday being paid, for a whole group of investors who get the same amount
        const d = b.dataset.d;
        b.dataset.paygroup.split(',').forEach(k => { const i = finData.investors[+k]; if (i && i.active && !finIsPaid(i, d) && !finIsPausedAt(i, d) && finInvPeriods(i, d, finAdd(d, -1)).some(p => p.date === d)) finTogglePaid(i, d); });
        finTouch(); return;
    }
    if (b.dataset.paymatch !== undefined) { // make the total of the selected week equal to the sheet's: the difference is kept as a correction (the lines of people who left are only estimates)
        const v = finParse($('pay-sheet-total').value);
        if (v === null) { toast('Write the total as 18,342,463,300'); return; }
        finData.paidOffset = v - finPaidUpTo(finPayWeek);
        finTouch(); return;
    }
    if (b.dataset.pc !== undefined) {
        const d = b.dataset.d, lines = b.dataset.pc.split(',').map(k => finData.investors[+k]).filter(Boolean);
        if (finPayTool === 'pause') { // a single payout is held (blue) or taken back: only when it is not paid; a pause that comes from the pay plan is changed in the Investment fund
            if (lines.some(i => finIsPausedAt(i, d) && !(i.paused || []).includes(d))) { toast('This week is on hold because of the pay plan: change that in the Investment fund (Paid choice).'); return; }
            lines.forEach(i => { if (finIsPaid(i, d)) return; i.paused = (i.paused || []).includes(d) ? i.paused.filter(x => x !== d) : (i.paused || []).concat(d); });
            finTouch(); return;
        }
        const held = lines.filter(i => finIsPausedAt(i, d));
        if (held.length && !lines.some(i => finIsPaid(i, d))) { // a click on a held payout: released in full, together with all the others that were held for this person
            const all = lines.flatMap(i => finHeldList(i).map(p => ({ i, x: p.date, a: p.amount }))), sum = all.reduce((s, h) => s + h.a, 0);
            if (all.length > 1 && confirm(`Release all ${all.length} held payouts of ${lines[0].name} (${finMoney(sum)}) now?`)) { finReleaseHeld(lines, finSrv.today); finTouch(); return; }
            held.forEach(i => { i.paused = (i.paused || []).filter(y => y !== d); });
        }
        lines.forEach(i => finTogglePaid(i, d)); // a week held through the pay plan is simply paid: paid wins over held
        finTouch(); return;
    }
    if (b.dataset.payrow !== undefined) { // every payout of this Sunday that is still to pay
        const d = b.dataset.payrow;
        finData.investors.forEach(i => { if (i.active && finTracked(i) && !finIsPaid(i, d) && !finIsPausedAt(i, d) && finInvPeriods(i, d, finAdd(d, -1)).some(p => p.date === d)) finTogglePaid(i, d); });
        finTouch(); return;
    }
    if (b.dataset.paycopy !== undefined) {
        const v = $('pay-text').value;
        (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).catch(() => { $('pay-text').select(); try { document.execCommand('copy'); } catch (e) { /* select by hand */ } }).then(() => toast('Copied'));
    }
}
FIN_PAGES.pay = { status: 'pay-status', render: finRenderPay, refresh: finRefreshPay, click: finClickPay, parts: ['investors', 'paidOffset'] };
