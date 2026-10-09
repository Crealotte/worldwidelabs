// calimport.js — import of the pay calendar (the sheet with a row per Sunday and a column per investor, a weekly part, a monthly part and the accumulated total), on the Payout calendar page.
// The calendar holds what was REALLY paid, so from it WWL learns: what every person was paid in total (kept as a small correction on their first line, so "paid out" is exact), whether they are paid on the
// weekly or the monthly sheet, and who is no longer paid (their lines are ended on the day of their last payout, the history stays). Names that match no investor and investors that are not in the calendar are listed.
'use strict';

const finCalNorm = n => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function finLev(a, b) { // the number of edits between two names (a typo or two)
    const m = []; for (let i = 0; i <= a.length; i++) { m[i] = [i]; } for (let j = 1; j <= b.length; j++) m[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return m[a.length][b.length];
}
function finParseCalendar(text) {
    const lines = String(text || '').split(/\r?\n/).filter(l => l.trim() !== '');
    const hi = lines.findIndex(l => l.split('\t').some(c => c.trim().toLowerCase() === 'total'));
    if (hi < 0) return { error: 'I could not find the line with the names and the word "total". Copy the calendar including the header line with the names.' };
    const head = lines[hi].split('\t').map(s => s.trim()), totals = head.map((h, i) => (h.toLowerCase() === 'total' ? i : -1)).filter(i => i >= 0);
    if (totals.length < 1) return { error: 'No "total" column found.' };
    const wEnd = totals[0], mEnd = totals.length >= 3 ? totals[1] : head.length, accCol = totals.length >= 2 ? totals[totals.length - 1] : -1;
    const cols = [];
    for (let i = 1; i < head.length; i++) if (head[i] && head[i].toLowerCase() !== 'total' && i !== accCol) cols.push({ name: head[i], col: i, sheet: i < wEnd ? 'weekly' : i < mEnd ? 'monthly' : null });
    const byNorm = {}, accum = {}, dates = [];
    const num = c => { const v = finParse(String(c || '').replace(/^\$/, '')); return v && v > 0 ? v : 0; };
    for (const l of lines.slice(hi + 1)) {
        const c = l.split('\t'), m = (c[0] || '').trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
        if (!m) continue;
        const date = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        dates.push(date);
        if (accCol >= 0) accum[date] = num(c[accCol]);
        for (const p of cols) {
            if (!p.sheet) continue;
            const a = num(c[p.col]); if (!a) continue;
            const e = (byNorm[finCalNorm(p.name)] = byNorm[finCalNorm(p.name)] || { name: p.name, norm: finCalNorm(p.name), byDate: {}, latest: { date: '', sheet: p.sheet } });
            e.byDate[date] = (e.byDate[date] || 0) + a;
            (e.sheets = e.sheets || { weekly: {}, monthly: {} })[p.sheet][date] = a; // per sheet: someone who moved from the weekly to the monthly sheet has both
            if (date >= e.latest.date) e.latest = { date, sheet: p.sheet };
        }
    }
    if (!dates.length) return { error: 'No rows with a date (like 4-10-2026) found.' };
    // people who have no amount at all still count as a column of the calendar
    cols.forEach(p => { if (p.sheet && !byNorm[finCalNorm(p.name)]) byNorm[finCalNorm(p.name)] = { name: p.name, norm: finCalNorm(p.name), byDate: {}, latest: { date: '', sheet: p.sheet } }; });
    return { people: Object.values(byNorm), dates: dates.sort(), accum };
}
// what the calendar says about every person, set against the lines in WWL; `T` = the last Sunday that has been paid
function finCalAnalyze(parsed) {
    const today = finSrv.today, T = finAdd(today, -new Date(finD(today)).getUTCDay());
    const idxByNorm = {}; finData.investors.forEach((x, k) => { (idxByNorm[finCalNorm(x.name)] = idxByNorm[finCalNorm(x.name)] || []).push(k); });
    const norms = Object.keys(idxByNorm), plans = [], unmatched = [], used = new Set();
    for (const p of parsed.people) {
        let key = idxByNorm[p.norm] ? p.norm : null, fuzzy = '';
        if (!key) { const near = norms.filter(n => finLev(n, p.norm) <= 2 && !used.has(n)); if (near.length === 1) { key = near[0]; fuzzy = finData.investors[idxByNorm[key][0]].name; } }
        const entries = Object.entries(p.byDate), actual = entries.filter(([d]) => d <= T).reduce((s, [, a]) => s + a, 0);
        const future = entries.some(([d]) => d > T), lastPaid = entries.map(([d]) => d).filter(d => d <= T).sort().pop() || '';
        // on both sheets: the plan changed. From the Sunday after the last weekly payout the payouts are monthly (or the other way round), so the change date is kept
        let sw = null;
        if (p.sheets && Object.keys(p.sheets.weekly).length && Object.keys(p.sheets.monthly).length) {
            const lw = Object.keys(p.sheets.weekly).sort().pop(), lm = Object.keys(p.sheets.monthly).sort().pop(), fw = Object.keys(p.sheets.weekly).sort()[0], fm = Object.keys(p.sheets.monthly).sort()[0];
            if (lm > lw) sw = { date: finAdd(lw, 7), from: 'weekly', to: 'monthly' }; else if (lw > lm && fw > fm) sw = { date: finAdd(lm, 7), from: 'monthly', to: 'weekly' };
        }
        if (!key) { unmatched.push({ name: p.name, actual }); continue; }
        used.add(key);
        const ix = idxByNorm[key], lines = ix.map(k => finData.investors[k]);
        plans.push({ sw, name: finData.investors[ix[ix.length - 1]].name, calName: p.name, fuzzy, ix, actual, future, lastPaid, mode: p.latest.sheet, wasActive: lines.some(l => l.active), modeChange: lines.some(l => l.mode !== p.latest.sheet) });
    }
    const missing = Object.entries(idxByNorm).filter(([n, ix]) => !used.has(n) && ix.some(k => finData.investors[k].active)).map(([n, ix]) => finData.investors[ix[0]].name);
    return { T, plans, unmatched, missing, accumT: parsed.accum[T] || parsed.accum[parsed.dates.filter(d => d <= T).pop()] || 0 };
}
let finCalPending = null;
function finCalPanel() {
    return `<details class="panel"><summary class="av-sum"><b>Import your pay calendar</b> <span style="font-size:12px;color:var(--muted);">(the real history: what everybody was paid in total, who is no longer paid)</span></summary>
        <p style="font-size:12px;color:var(--muted);margin:8px 0;">Select the whole calendar (header lines with the names, the dates, the weekly part, the monthly part and the accumulated column), copy it and paste it here. First press Preview.</p>
        <textarea id="cal-text" rows="5" style="width:100%;font-family:var(--mono);font-size:11px;" placeholder="paste the calendar here"></textarea>
        <div style="display:flex;gap:8px;margin-top:6px;"><button class="ghost small" data-calprev="1" type="button">Preview</button><button class="small" data-calgo="1" type="button">Import</button></div><div id="cal-out" style="margin-top:8px;font-size:12px;"></div></details>`;
}
function finClickCal(b) {
    const out = $('cal-out');
    const parsed = finParseCalendar($('cal-text').value);
    if (parsed.error) { finCalPending = null; out.innerHTML = `<span style="color:var(--danger);">${esc(parsed.error)}</span>`; return; }
    const a = finCalAnalyze(parsed);
    if (b.dataset.calprev !== undefined) {
        finCalPending = { parsed, a };
        const calc = p => p.ix.reduce((s, k) => s + finSum(finInvPeriods(finData.investors[k], a.T, '')), 0);
        const stops = a.plans.filter(p => p.wasActive && !p.future), changes = a.plans.filter(p => p.modeChange);
        out.innerHTML = `<div><b>${parsed.people.length}</b> people in the calendar, <b>${a.plans.length}</b> matched with investors. Paid through <b>${esc(finDate(a.T))}</b>; the accumulated total in the calendar then: <b>${finMoney(a.accumT)}</b>.</div>
            ${a.unmatched.length ? `<div style="color:#e0a030;margin-top:4px;">In the calendar but no investor with that name: ${a.unmatched.map(u => `${esc(u.name)} (${finMoney(u.actual)})`).join(', ')}. Their money stays in the total as a correction; add them as investors if they are active.</div>` : ''}
            ${a.missing.length ? `<div style="color:#e0a030;margin-top:4px;">Active here but not in the calendar: ${a.missing.map(esc).join(', ')}.</div>` : ''}
            ${stops.length ? `<div style="margin-top:4px;">No longer paid in the calendar, they will be ended on their last payout day: ${stops.map(p => `${esc(p.name)} (${p.lastPaid ? esc(finDate(p.lastPaid)) : 'never paid'})`).join(', ')}.</div>` : ''}
            ${changes.length ? `<div style="margin-top:4px;">Paid on the other sheet than I have now: ${changes.map(p => `${esc(p.name)} → ${p.mode}${p.sw ? ` (changed on ${esc(finDate(p.sw.date))})` : ''}`).join(', ')}.</div>` : ''}
            ${a.plans.some(p => p.fuzzy) ? `<div style="margin-top:4px;color:var(--muted);">Matched by a slightly different spelling: ${a.plans.filter(p => p.fuzzy).map(p => `${esc(p.calName)} = ${esc(p.fuzzy)}`).join(', ')}.</div>` : ''}
            <details style="margin-top:6px;"><summary style="cursor:pointer;">What was paid per person (calendar) against what WWL works out now</summary><table style="border-collapse:collapse;margin-top:4px;">${a.plans.map(p => { const c = calc(p); return `<tr><td style="padding:1px 10px 1px 0;">${esc(p.name)}</td><td style="padding:1px 10px;text-align:right;font-family:var(--mono);">${finFull(p.actual)}</td><td style="padding:1px 10px;text-align:right;font-family:var(--mono);">${finFull(c)}</td><td style="padding:1px 10px;text-align:right;font-family:var(--mono);color:${p.actual === c ? 'var(--muted)' : '#e0a030'};">${finFull(p.actual - c)}</td></tr>`; }).join('')}</table></details>`;
        return;
    }
    if (!finCalPending) { out.innerHTML = '<span style="color:var(--danger);">Press Preview first.</span>'; return; }
    if (!confirm('Import the calendar? People the calendar no longer pays are ended, pay sheets are set as in the calendar, and the totals are corrected to match it.')) return;
    const T = a.T;
    for (const p of a.plans) { // 1. the way they are paid and who is still paid
        const lines = p.ix.map(k => finData.investors[k]);
        lines.forEach(l => { if (l.mode !== p.mode) l.mode = p.mode; l.switches = p.sw ? [p.sw] : []; });
        if (p.wasActive && !p.future) lines.forEach(l => { if (l.active) { l.active = false; l.returnedOn = p.lastPaid || l.start; l.paidUntil = ''; } });
        else lines.forEach(l => { if (l.active && finInvPeriods(l, T, '').length) { l.paidUntil = T; l.skip = []; l.extra = []; } });
    }
    for (const p of a.plans) { // 2. what they were paid in total: the difference with the schedule is kept on the first line
        const lines = p.ix.map(k => finData.investors[k]);
        lines.forEach(l => { l.paidAdj = 0; });
        const calc = lines.reduce((s, l) => s + finSum(finPaidList(l).filter(x => x.date <= T)), 0);
        lines[0].paidAdj = Math.round(p.actual - calc);
    }
    const total = finData.investors.reduce((s, i) => s + finSum(finPaidList(i).filter(x => x.date <= T)) + (i.paidAdj || 0), 0);
    finData.paidOffset = a.accumT ? Math.round(a.accumT - total) : 0; // what is left (people who are not investors here) so the total is the calendar's
    finCalPending = null;
    finRenderAll(); finTouch();
    toast('Calendar imported');
}
