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
    finData = { fundsMode: r.fundsMode, fundsManual: r.fundsManual, reserve: r.reserve, investors: r.investors, income: r.income, outlays: r.outlays, plans: r.plans, roi: r.roi, ventures: r.ventures, capitals: r.capitals, coEst: r.coEst || {}, loans: r.loans || [], buddies: r.buddies || [] };
    finRenderAll();
}
const loadInvestFund = () => finLoadLight('fund', 'fund-status');
const loadBuddyBank = () => finLoadLight('buddy', 'bb-status');


// ---- Investment fund ----
function finRenderFund() {
    $('fund-body').innerHTML = `<div id="fund-summary"></div>${finListEditor('investors')}<div id="fund-people"></div><div id="fund-history"></div>${finListEditor('roi')}${finImportPanel()}`;
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
    if (b.dataset.impprev !== undefined || b.dataset.impgo !== undefined) { finClickImport(b); return; }
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

// ---- import of the investor sheet (the list of investors with the date the money was sent, the end of the first 6 months, the renewals and what was paid back) ----
// How the sheet is read: every line is one deposit (an investor who invests again later gets an extra line). An investor's weekly amount is the sum of the weekly cells of their lines and is divided over
// their lines by amount (so 2 x 500m = 6,731,000 together, 3,365,500 each). A line with a "pay back" amount has ended, and so has an investor whose lines have no amount (the red ones in the sheet: they
// took their money out); for those the total paid back is divided equally over their lines. The day the money was returned is not in the sheet: it is estimated from the term end and can be corrected.
// The sheet's own numbering is kept in the note.
const FIN_MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function finSheetDate(s) {
    const t = String(s || '').trim(); if (!t) return '';
    let m = t.match(/^(\d{1,2})[-\/ .]([A-Za-z]{3})[A-Za-z]*[-\/ .](\d{4})$/);
    if (m && FIN_MON[m[2].toLowerCase()]) return `${m[3]}-${String(FIN_MON[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    m = t.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/);
    return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}
function finParseSheet(text, markPaid) {
    const lines = String(text || '').split(/\r?\n/).filter(l => l.trim());
    const hi = lines.findIndex(l => /investorid|amount invested/i.test(l));
    if (hi < 0) return { error: 'The first line (InvestorID, Name, Amount invested, ...) is missing: copy the sheet including its top row.' };
    const head = lines[hi].split('\t').map(h => h.trim().toLowerCase());
    const col = re => head.findIndex(h => re.test(h));
    const ix = { id: col(/investorid|^id$/), name: col(/^name/), amount: col(/amount invested/), weekly: col(/weekly/), sent: col(/sent on/), first: col(/first.*end/), pay: col(/pay.?back/) };
    const ren = head.map((h, i) => (/days renewal/.test(h) ? i : -1)).filter(i => i >= 0), nd = head.map((h, i) => (/new date/.test(h) ? i : -1)).filter(i => i >= 0);
    ix.mode = ix.weekly >= 0 ? ix.weekly + 1 : -1;
    if (ix.name < 0 || ix.sent < 0 || ix.amount < 0) return { error: 'I could not find the Name, Amount invested and Sent on columns in the first line.' };
    const money = x => { const v = finParse(String(x || '')); return v && v > 0 ? v : 0; };
    const raw = [];
    for (const l of lines.slice(hi + 1)) {
        const c = l.split('\t'), name = (c[ix.name] || '').trim(), start = finSheetDate(c[ix.sent]);
        if (!name || !start) continue; // empty lines and the totals line
        const mode = (c[ix.mode] || '').trim().toLowerCase();
        raw.push({ sheetId: (c[ix.id] || '').trim(), name, amount: money(c[ix.amount]), weekly: money(c[ix.weekly]), mode: mode === 'monthly' ? 'monthly' : mode === 'weekly' ? 'weekly' : '', start, first: finSheetDate(c[ix.first]),
            r1: (c[ren[0]] || '').trim(), n1: finSheetDate(c[nd[0]]), r2: (c[ren[1]] || '').trim(), n2: finSheetDate(c[nd[1]]), back: money(c[ix.pay]) });
    }
    if (!raw.length) return { error: 'No investor lines found below the first line.' };
    const people = {};
    raw.forEach(r => { const k = `${r.sheetId}|${r.name.toLowerCase()}`; (people[k] = people[k] || []).push(r); });
    const today = finSrv.today, sun = finAdd(today, -new Date(finD(today)).getUTCDay());
    const rows = [], warnings = [], latest = a => a.filter(Boolean).sort().pop() || '';
    for (const list of Object.values(people)) {
        list.sort((a, b) => (a.start < b.start ? -1 : 1));
        const fixed = list.filter(r => r.amount > 0), blanks = list.filter(r => !r.amount);
        const backAll = list.reduce((s, r) => s + r.back, 0), backFixed = fixed.reduce((s, r) => s + r.back, 0), backBlank = Math.max(0, backAll - backFixed);
        if (blanks.length && backBlank > 0) blanks.forEach(r => { r.amount = Math.round(backBlank / blanks.length); r.guessed = true; });
        const A = list.reduce((s, r) => s + r.amount, 0), W = list.reduce((s, r) => s + r.weekly, 0);
        const rate = W > 0 && fixed.length ? W / fixed.reduce((s, r) => s + r.amount, 0) : A > 0 ? finRoi(A, finData.roi) / A : 0;
        const modeOf = (list.find(r => r.mode) || {}).mode || 'weekly';
        for (const r of list) {
            const gone = !r.amount; // withdrew, and the sheet has no amount for it
            const ended = r.back > 0 || r.guessed || gone, termEnd = latest([r.first, r.n1, r.n2]);
            const renewals = []; if (r.n1 && r.n1 !== r.first) renewals.push({ from: r.first, to: r.n1 }); if (r.n2 && r.n2 !== r.n1) renewals.push({ from: r.n1 || r.first, to: r.n2 });
            const word = [r.r1, r.r2].filter(x => x && !/^\d+$/.test(x)).join(', ');
            const row = { id: finId(), name: r.name, tornId: '', amount: r.amount || 0, payout: Math.round((r.amount || 0) * rate), mode: r.mode || modeOf, start: r.start, active: !ended, nettedIn: '', note: `#${r.sheetId}${word ? ` · ${word}` : ''}${r.guessed ? ' · amount split from the total paid back' : ''}${gone ? ' · withdrew, amount not in the sheet' : ''}`.slice(0, 120),
                paidUntil: '', payments: [], termEnd, returnedOn: ended ? termEnd : '', renewals };
            if (!ended && markPaid) { const dow = new Date(finD(r.start)).getUTCDay(), first = finAdd(r.start, dow === 0 ? 7 : 7 - dow); if (first <= sun) row.paidUntil = sun; }
            if (r.guessed && r === list.find(x => x.guessed)) warnings.push(`${r.name} (#${r.sheetId}): ${finShort(backBlank)} paid back, divided equally over ${blanks.length} line${blanks.length === 1 ? '' : 's'}; the term end is taken as the day the money was returned.`);
            if (gone) warnings.push(`${r.name} (#${r.sheetId}): withdrew but the sheet has no amount for this line (kept as amount 0).`);
            rows.push(row);
        }
    }
    const act = rows.filter(r => r.active);
    return { rows, warnings, stats: { people: new Set(act.map(r => r.name.toLowerCase())).size, invested: act.reduce((s, r) => s + r.amount, 0), weekly: act.reduce((s, r) => s + r.payout, 0), ended: rows.length - act.length } };
}
let finImpPending = null;
function finImportPanel() {
    return `<details class="panel"><summary class="av-sum"><h3 style="display:inline;margin:0;">Import the investor sheet</h3></summary>
        <p style="font-size:12px;color:var(--muted);margin:8px 0;">Select the cells of your investor sheet (including its top row), copy them and paste them here. First look at the preview; nothing is changed until you press Import.</p>
        <textarea id="fund-imp-text" rows="6" style="width:100%;font-family:var(--mono);font-size:11px;" placeholder="InvestorID, Name, Amount invested, weekly amount, ..."></textarea>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:6px;font-size:13px;">
            <label style="display:flex;gap:6px;align-items:center;cursor:pointer;"><input type="checkbox" id="fund-imp-paid" checked style="width:auto;"> Everything up to the last Sunday is already paid out</label>
            <select id="fund-imp-mode"><option value="replace">Replace the list above</option><option value="add">Add to the list above</option></select>
            <button class="ghost small" data-impprev="1" type="button">Preview</button><button class="small" data-impgo="1" type="button">Import</button></div>
        <div id="fund-imp-out" style="margin-top:8px;font-size:12px;"></div></details>`;
}
function finClickImport(b) {
    const out = $('fund-imp-out');
    if (b.dataset.impprev !== undefined) {
        const r = finParseSheet($('fund-imp-text').value, $('fund-imp-paid').checked);
        if (r.error) { finImpPending = null; out.innerHTML = `<span style="color:var(--danger);">${esc(r.error)}</span>`; return; }
        finImpPending = r;
        const s = r.stats;
        out.innerHTML = `<div><b>${r.rows.length}</b> investments from <b>${new Set(r.rows.map(x => x.name.toLowerCase())).size}</b> people. Active now: <b>${s.people}</b> people, <b>${finMoney(s.invested)}</b> invested, <b>${finMoney(s.weekly)}</b> a week; ${s.ended} investments already ended.</div>
            ${r.warnings.length ? `<details style="margin:6px 0;"><summary style="cursor:pointer;color:#e0a030;">${r.warnings.length} remark${r.warnings.length === 1 ? '' : 's'}</summary>${r.warnings.map(w => `<div>${esc(w)}</div>`).join('')}</details>` : ''}
            <div style="max-height:260px;overflow:auto;margin-top:6px;"><table style="border-collapse:collapse;">${r.rows.map(x => `<tr style="${x.active ? '' : 'opacity:.6;'}"><td style="padding:1px 10px 1px 0;">${esc(x.name)}</td><td style="padding:1px 10px;text-align:right;font-family:var(--mono);">${finShort(x.amount)}</td><td style="padding:1px 10px;text-align:right;font-family:var(--mono);">${finShort(x.payout)}</td><td style="padding:1px 10px;">${x.mode}</td><td style="padding:1px 10px;">${esc(x.start)}</td><td style="padding:1px 10px;">${x.active ? `until ${esc(x.termEnd)}` : `returned ${esc(x.returnedOn)}`}</td><td style="padding:1px 0;color:var(--muted);">${esc(x.note)}</td></tr>`).join('')}</table></div>`;
    } else if (b.dataset.impgo !== undefined) {
        if (!finImpPending) { out.innerHTML = '<span style="color:var(--danger);">Press Preview first.</span>'; return; }
        const replace = $('fund-imp-mode').value === 'replace';
        if (replace && finData.investors.length && !confirm(`Replace the ${finData.investors.length} investors in the list with the ${finImpPending.rows.length} from the sheet?`)) return;
        const keyOf = x => `${x.name.toLowerCase()}|${x.start}|${x.amount}`, have = new Set(finData.investors.map(keyOf));
        finData.investors = replace ? finImpPending.rows : finData.investors.concat(finImpPending.rows.filter(x => !have.has(keyOf(x))));
        finImpPending = null;
        finRenderAll(); finTouch();
        toast('Imported');
    }
}

FIN_PAGES.fund = { status: 'fund-status', render: finRenderFund, refresh: finRefreshFund, click: finClickFund, parts: ['investors', 'roi'] };
FIN_PAGES.buddy = { status: 'bb-status', render: finRenderBuddy, refresh: finRefreshBuddy, click: finClickBuddy, parts: ['buddies'] };
