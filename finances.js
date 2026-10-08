// finances.js — the owner's finances page (CreaLotte menu, owners only): every income and payout of her Torn side hustles for the past AND the coming weeks, a
// "when can I afford this" finder for plans in steps (for example a buddy bank: 500m now, 500m a month later, 1b a month after that), the investors and what they are
// paid, and a ranking of everything she does to earn money by return on the capital in it. Backend: fin-* in api/war-payout.js, lib/finances.js.
// The numbers of the timeline are worked out here in the browser from the saved settings plus what the server read (Torn cash, what each company sent, the rent-to-own contracts).
'use strict';

const FIN_PAST = 8, FIN_HORIZON = 52;
// buddy banking: she puts up the cash, the buddy invests it in their City Bank, and when the term ends keeps 30% of the profit and sends back the principal + 70% of it.
// The profit estimate is the Torn bank's rate for 10/10 merits (no TCI) on that term: 5.14% for 1 month, 11.93% for 2 months (Torn's bank page); a real profit can be typed per buddy.
const FIN_TIERS = { bronze: { amount: 500000000, days: 30 }, silver: { amount: 1000000000, days: 30 }, gold: { amount: 2000000000, days: 60 } };
const finBankRate = days => (days <= 45 ? 0.0514 : 0.1193);
const finBuddy = b => { const profit = b.profit > 0 ? b.profit : Math.round(b.amount * finBankRate(b.term)); return { profit, back: b.amount + Math.round(profit * b.share / 100), due: finAdd(b.given, b.term) }; };
let finData = null, finSrv = null, finAhead = 16, finShowPlan = '', finTimer = null, finSaving = false;
let finPage = 'finances'; const FIN_PAGES = {}, finBound = {}; // the pages that share this file: Finances, Investment fund, Buddy banking (each registers itself with its render, status line and the lists it saves)

async function finFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}
const finFull = n => Math.round(Number(n) || 0).toLocaleString('en-US');
const finMoney = n => `${Number(n) < 0 ? '-' : ''}$${finFull(Math.abs(Number(n) || 0))}`;
const finShort = n => { const v = Number(n) || 0, a = Math.abs(v), s = v < 0 ? '-' : ''; return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(1)}M` : `${s}$${finFull(a)}`; };
// "500m", "1.5b", "6,731,000" and "6.731.000" (dots as thousands, as in her sheets) all work; anything else is refused (null)
function finParse(s) {
    let t = String(s ?? '').toLowerCase().replace(/[$\s]/g, '');
    if (/^-?[0-9]{1,3}(\.[0-9]{3}){2,}$/.test(t) || /^-?[0-9]{1,3}(\.[0-9]{3})+,[0-9]+$/.test(t)) t = t.replace(/\./g, '').replace(',', '.'); // 6.731.000 or 6.731.000,50
    t = t.replace(/,/g, '');
    const m = t.match(/^(-?[0-9]*\.?[0-9]+)([kmb]?)$/);
    if (!m) return null;
    return Math.round(Number(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[m[2]] || 1));
}
const finD = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const finIso = ms => new Date(ms).toISOString().slice(0, 10);
const finAdd = (iso, n) => finIso(finD(iso) + n * 86400000);
const finSun = iso => { const dow = new Date(finD(iso)).getUTCDay(); return dow === 0 ? iso : finAdd(iso, 7 - dow); }; // the Sunday on or after a date
const finDate = iso => new Date(finD(iso)).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC', ...(iso.slice(0, 4) === new Date().toISOString().slice(0, 4) ? {} : { year: '2-digit' }) });
const finId = () => Math.random().toString(36).slice(2, 8);

// what an investor of this size is paid a week by the table: an exact row, linear per billion above the top row, otherwise scaled from the nearest lower row
function finRoi(amount, tbl) {
    const t = (tbl || []).slice().sort((a, b) => a.amount - b.amount);
    if (!t.length || !amount) return 0;
    const exact = t.find(r => r.amount === amount);
    if (exact) return exact.weekly;
    const top = t[t.length - 1];
    if (amount > top.amount) return Math.round(amount * top.weekly / top.amount);
    const lower = t.filter(r => r.amount < amount).pop() || t[0];
    return Math.round(lower.weekly * amount / lower.amount);
}
const finPayout = i => (i.payout !== null && i.payout !== undefined ? i.payout : finRoi(i.amount, finData.roi));
// Companies: until a company has real weeks, an estimate stands in (her numbers, October 2026: the 16-person mines CreaLabs 20.66m and CreaLabs1 21m a day net, the 14-person ones CreaLabs4 15m, CreaLabs5 19.2m
// and CreaLabs6 21.77m; CreaLabs3 was sold to its director). A 14-person mine costs about 9b to get, a 16-person one 12b; optimized they make about 25m / 35m a day, but these ones are no longer optimized.
// The numbers are net profit of the company; the director cut of that company is taken off (what is left is hers). All of it can be changed per company on the page.
const FIN_CO_DEFAULTS = { crealabs: { staff: 16, daily: 20660000 }, crealabs1: { staff: 16, daily: 21000000 }, crealabs3: { staff: 16, daily: 0, sold: true }, crealabs4: { staff: 14, daily: 15000000 }, crealabs5: { staff: 14, daily: 19200000 }, crealabs6: { staff: 14, daily: 21770000 } };
const FIN_STAFF_COST = { 14: 9000000000, 16: 12000000000 }, FIN_STAFF_OPT = { 14: 25000000, 16: 35000000 };
const finCoKey = n => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const finEstOf = c => (finData.coEst || {})[c.id] || FIN_CO_DEFAULTS[finCoKey(c.name)] || { daily: 0, staff: 0, sold: false };
const finEstWeekly = c => finEstOf(c).daily * 7 * (1 - (c.cutPct ?? 30) / 100);
const finFunds = () => finData.fundsManual; // the amount she types: her money sits in cash, stocks, a faction vault and more, so Torn's cash alone says little

// ---- investor payouts ----
const finMonthLastSunday = (y, m) => { const last = Date.UTC(y, m + 1, 0); return finIso(last - new Date(last).getUTCDay() * 86400000); };
// The payouts of an investor dated after `from` and up to `upTo` (and not after the day the money was returned). The first payout is pro rata: the day after the money arrived counts as the first day,
// up to the first Sunday (a Wednesday investor gets Thursday to Sunday = 4 days of the week's pay), rounded to the nearest 100 (1b: 6,731,000 / 7 x 4 = 3,846,286 -> 3,846,300). Weekly = every Sunday;
// monthly = the last Sunday of each month, with all the Sundays of that month (from the first payout) together.
function finInvPeriods(i, upTo, from) {
    const pay = finPayout(i), out = [];
    if (!pay || !i.start) return out;
    const cap = i.returnedOn && i.returnedOn < upTo ? i.returnedOn : upTo;
    const dow = new Date(finD(i.start)).getUTCDay(), off = dow === 0 ? 7 : 7 - dow, first = finAdd(i.start, off);
    const amt = s => (s === first && off < 7 ? Math.round(pay / 7 * off / 100) * 100 : pay);
    if (i.mode === 'weekly') { for (let s = first, n = 0; s <= cap && n < 800; s = finAdd(s, 7), n++) if (s > from) out.push({ date: s, amount: amt(s) }); }
    else {
        const y0 = +first.slice(0, 4), m0 = +first.slice(5, 7) - 1;
        for (let k = 0; k < 800; k++) {
            const y = y0 + Math.floor((m0 + k) / 12), m = (m0 + k) % 12, L = finMonthLastSunday(y, m);
            if (L > cap) break;
            if (L <= from) continue;
            let sum = 0, cnt = 0; for (let s = L; new Date(finD(s)).getUTCMonth() === m && s >= first; s = finAdd(s, -7)) { sum += amt(s); cnt++; }
            if (cnt) out.push({ date: L, amount: sum, weeks: cnt });
        }
    }
    return out;
}
const finSum = a => a.reduce((s, p) => s + p.amount, 0);

// ---- the timeline: weeks end on Sunday; 8 weeks back, 52 ahead ----
function finModel(plan, planStart) {
    const D = finData, S = finSrv, cur = finSun(S.today);
    const weeks = [];
    for (let w = -FIN_PAST; w < FIN_HORIZON; w++) weeks.push({ w, end: finAdd(cur, 7 * w), co: 0, coParts: [], rto: 0, inc: 0, inv: 0, invParts: [], out: 0, plan: 0, loan: 0, loanParts: [], bb: 0, bbParts: [] });
    const idx = iso => { const w = Math.ceil(Math.round((finD(iso) - finD(cur)) / 86400000) / 7); return w >= -FIN_PAST && w < FIN_HORIZON ? w + FIN_PAST : -1; };
    const place = (iso, amt, key) => { const j = idx(iso); if (j >= 0) weeks[j][key] += amt; };
    const firstDay = finAdd(weeks[0].end, -6), lastDay = weeks[weeks.length - 1].end;
    // dates of a monthly thing: the same day of the month as `from`, until the end of the timeline
    const monthly = (from, fn) => {
        const y0 = +from.slice(0, 4), m0 = +from.slice(5, 7) - 1, day = +from.slice(8, 10);
        for (let k = 0; k < 600; k++) {
            const y = y0 + Math.floor((m0 + k) / 12), m = (m0 + k) % 12;
            const iso = finIso(Date.UTC(y, m, Math.min(day, new Date(Date.UTC(y, m + 1, 0)).getUTCDate())));
            if (iso > lastDay) break;
            if (iso >= firstDay) fn(iso);
        }
    };
    // companies: what they really sent in the past weeks, the average of the last (up to) 4 known weeks from now on
    const coAvg = {};
    for (const c of S.companies) {
        const known = c.weeks.filter(x => x.send != null).sort((a, b) => (a.weekEnd < b.weekEnd ? 1 : -1)).slice(0, 4);
        // a sold company brings nothing more; one without a known week yet uses the estimate (see FIN_CO_DEFAULTS) until real weeks exist
        coAvg[c.id] = finEstOf(c).sold ? 0 : known.length ? known.reduce((s, x) => s + x.send, 0) / known.length : finEstWeekly(c);
        for (const wk of weeks) {
            const rec = c.weeks.find(x => x.weekEnd === wk.end);
            const real = rec && rec.send != null;
            const v = real ? rec.send : (wk.w >= 0 ? coAvg[c.id] : null);
            if (v) { wk.co += v; wk.coParts.push(`${c.name}: ${finMoney(v)}${real ? '' : known.length ? ' (average)' : ' (estimate)'}`); }
        }
    }
    // rent-to-own: a payment (rent + equity) each time the lease runs out, until the full price is paid. Past weeks: the payments that were recorded (or, without a record, the 30-day dates from the start as an estimate).
    // Coming weeks: the next payment is when the lease runs out on Torn (the days left at the last sync), else 30 days after the last recorded payment, else the contract calendar; then every 30 days.
    const synced = S.rto.syncedAt ? finIso(S.rto.syncedAt) : null;
    for (const r of (S.rto.rtoItems || [])) {
        if (!r.startDate) continue;
        const eq = Number(r.cycleEquity) || 0, rent = Number(r.monthlyRent) || 0, goal = Number(r.totalEquityNeeded) || Infinity;
        const recPays = r.payments || [], recorded = recPays.length > 0 || Number(r.opening) > 0;
        const typed = !recorded && r.manualEquityPaid !== null && r.manualEquityPaid !== undefined && r.manualEquityPaid !== '';
        const cycles = Math.max(1, Math.floor(Math.max(0, Math.round((finD(S.today) - finD(r.startDate)) / 86400000)) / 30) + 1);
        let paid;
        if (recorded) { paid = (Number(r.opening) || 0) + recPays.reduce((s, p) => s + (Number(p.equity) || 0), 0); for (const p of recPays) if (p.date >= firstDay && p.date <= lastDay) place(p.date, (Number(p.rent) || 0) + (Number(p.equity) || 0), 'rto'); }
        else if (typed) paid = Number(r.manualEquityPaid);
        else { paid = cycles * eq; for (let n = 0; n < cycles; n++) { if (eq && n * eq >= goal) break; const iso = finAdd(r.startDate, 30 * n); if (iso >= firstDay) place(iso, rent + eq, 'rto'); } }
        let left = eq ? Math.max(0, Math.ceil((goal - paid) / eq)) : 0;
        const pi = (S.rto.pis || []).find(p => (r.propertyId && String(p.id) === String(r.propertyId)) || (r.tenantId && p.tenantID && String(p.tenantID) === String(r.tenantId)));
        let first = pi && pi.isRented && synced ? finAdd(synced, Number(pi.daysLeft) || 0) : recPays.length ? finAdd(recPays.map(p => p.date).sort().pop(), 30) : finAdd(r.startDate, 30 * cycles);
        if (first < S.today) first = S.today;
        for (let iso = first; left > 0 && iso <= lastDay; left--, iso = finAdd(iso, 30)) place(iso, rent + eq, 'rto');
    }
    for (const i of D.income) {
        if (!i.active || !i.amount) continue;
        if (i.freq === 'once') place(i.date, i.amount, 'inc');
        else if (i.freq === 'weekly') weeks.forEach(wk => { if (wk.end >= i.date) wk.inc += i.amount; });
        else monthly(i.date, iso => place(iso, i.amount, 'inc'));
    }
    // investors: paid on Sundays (the first payout is pro rata, see finInvPeriods); a monthly investor is paid the Sundays of the month together on the last Sunday of it. An investor whose pay is netted in a company's send is not an outflow again,
    // and one who got the money back stops after that date. What was due before this week and is not marked paid yet is counted in the current week.
    const week0 = finAdd(cur, -6);
    for (const i of D.investors) {
        if (i.nettedIn || (!i.active && !i.returnedOn)) continue;
        for (const p of finInvPeriods(i, lastDay, finAdd(firstDay, -1))) { place(p.date, p.amount, 'inv'); const j = idx(p.date); if (j >= 0) weeks[j].invParts.push(`${i.name}: ${finMoney(p.amount)}`); }
        if (i.paidUntil) { const old = finInvPeriods(i, finAdd(week0, -1), i.paidUntil); if (old.length) { place(S.today, finSum(old), 'inv'); const j = idx(S.today); if (j >= 0) weeks[j].invParts.push(`${i.name}: ${finMoney(finSum(old))} (still due)`); } }
    }
    for (const o of D.outlays) place(o.date, o.amount, 'out');
    // buddy banking: the cash leaves on the day it is given (if that is still ahead) and comes back, plus her share of the profit, when the term ends; a late one counts in the current week
    for (const b of D.buddies) {
        if (b.status !== 'active' || !b.amount) continue;
        if (b.given > S.today) place(b.given, b.amount, 'out');
        const f = finBuddy(b), j = idx(f.due < S.today ? S.today : f.due);
        if (j >= 0) { weeks[j].bb += f.back; weeks[j].bbParts.push(`${b.name}: ${finMoney(f.back)}`); }
    }
    // loans given to people: what is still to come back arrives on the repayment dates; a loan that is not given yet leaves on its date. An overdue payment counts in the current week.
    for (const L of D.loans) {
        if (!L.active) continue;
        if (L.date > S.today) place(L.date, L.lent, 'out');
        let rest = Math.max(0, (L.owed > 0 ? L.owed : L.lent) - L.repaid);
        if (!rest || L.freq === 'open') continue;
        const put = (iso, amt) => { const a = Math.min(amt, rest); if (a <= 0) return; rest -= a; const j = idx(iso < S.today ? S.today : iso); if (j >= 0) { weeks[j].loan += a; weeks[j].loanParts.push(`${L.name}: ${finMoney(a)}`); } };
        const pay = L.freq === 'once' || !(L.payment > 0) ? rest : L.payment;
        if (L.freq === 'once') put(L.from, rest);
        else if (L.freq === 'weekly') { for (let n = 0; n < 400 && rest > 0; n++) { const iso = finAdd(L.from, 7 * n); if (iso > lastDay) break; if (iso >= S.today) put(iso, pay); } }
        else monthly(L.from, iso => { if (rest > 0 && iso >= S.today) put(iso, pay); });
    }
    if (plan && planStart != null) for (const s of plan.steps) { const j = FIN_PAST + planStart + s.afterWeeks; if (s.amount > 0 && j < weeks.length) weeks[j].plan += s.amount; }
    // the balance runs forward from the money available now
    const funds = finFunds(); let bal = funds;
    for (const wk of weeks) {
        wk.net = wk.co + wk.rto + wk.inc + wk.loan + wk.bb - wk.inv - wk.out;
        if (wk.w >= 0) { bal += wk.net - wk.plan; wk.bal = bal; } else wk.bal = null;
    }
    return { weeks, funds, cur, coAvg };
}

// the earliest week a plan can start so that every step is paid and the balance never drops below the reserve afterwards
function finFind(plan, m) {
    const steps = plan.steps.filter(s => s.amount > 0);
    if (!steps.length) return null;
    const fut = m.weeks.filter(w => w.w >= 0), reserve = finData.reserve, maxAfter = Math.max(...steps.map(s => s.afterWeeks));
    let best = -Infinity;
    for (let s = 0; s + maxAfter < fut.length; s++) {
        let margin = Infinity;
        for (let w = s; w < fut.length; w++) {
            const spent = steps.filter(st => s + st.afterWeeks <= w).reduce((a, st) => a + st.amount, 0);
            margin = Math.min(margin, fut[w].bal - spent - reserve);
        }
        if (s === 0) margin = Math.min(margin, m.funds - steps.filter(st => st.afterWeeks === 0).reduce((a, st) => a + st.amount, 0) - reserve);
        if (margin >= 0) return { start: s, date: fut[s].end, steps: steps.map(st => ({ ...st, date: fut[s + st.afterWeeks].end })), margin };
        best = Math.max(best, margin);
    }
    return { start: null, short: -best };
}

// ---- the ventures: what each thing she does earns on the capital in it ----
function finVentures(m) {
    const D = finData, S = finSrv, rows = [];
    for (const c of S.companies) {
        const est = finEstOf(c); if (est.sold) continue; // sold to its director: no longer earns
        const w = c.weeks.filter(x => x.days >= 5).sort((a, b) => (a.weekEnd < b.weekEnd ? 1 : -1)).slice(0, 4), cut = c.cutPct ?? 30;
        const real = w.length >= 3; // until 3 full weeks are saved the estimate stands in
        const weekly = real ? w.reduce((s, x) => s + x.profit - x.cut, 0) / w.length : est.daily ? finEstWeekly(c) : (w.length ? w.reduce((s, x) => s + x.profit - x.cut, 0) / w.length : 0);
        rows.push({ name: c.name + (!real && est.daily ? ' (estimate)' : ''), type: est.staff ? `Company, ${est.staff} people` : 'Company', capital: D.capitals[`co:${c.id}`] ?? FIN_STAFF_COST[est.staff] ?? 0, weekly,
            note: real ? `profit after the director cut, average of ${w.length} weeks` : est.daily ? `estimate: ${finShort(est.daily)} a day net, minus the ${cut}% director cut; the real average takes over after 3 full weeks (${w.length} so far)` : 'no full weeks saved yet' });
    }
    for (const staff of [16, 14]) rows.push({ name: `A new ${staff}-person mine, optimized`, type: 'Company, benchmark', capital: FIN_STAFF_COST[staff], weekly: FIN_STAFF_OPT[staff] * 7 * 0.7, note: `about ${finShort(FIN_STAFF_OPT[staff])} a day net when optimized, 30% director cut taken off` });
    const rent = S.rto.defaults.rent, eqs = S.rto.defaults.equity;
    for (const tier of [4100, 3600, 2600]) {
        const cap = D.capitals[`pi:${tier}`] ?? S.rto.defaults.cost[tier], eq = eqs[tier];
        // rent-to-own: the equity the tenant pays is the sale price coming in by instalments, and every month a part of the money is back (and can be reinvested)
        const goal = (S.rto.defaults.goals || {})[tier] || 0, st = goal && eq ? finRtoStats(cap, rent[tier], eq, goal) : null;
        rows.push(st ? { name: `Island ${tier} rent-to-own`, type: 'Private Island', capital: cap, weekly: st.weeklyEquiv, irr: st.irr, payMonths: st.payMonths, note: `${st.months.toFixed(1)} months: rent plus the sale at ${finShort(goal)}; after ${st.payMonths} months the money is back and the rest is profit (still tied up after 6 months: ${finShort(Math.max(0, cap - st.back6))})` }
            : { name: `Island ${tier} rent-to-own`, type: 'Private Island', capital: cap, weekly: (rent[tier] + eq) * 7 / 30, note: 'rent + the equity the tenant builds up' });
    }
    for (const [tier, t] of Object.entries(FIN_TIERS)) { // buddy banking: her share of the bank's profit on the cash she puts up
        const weekly = t.amount * finBankRate(t.days) * 0.7 / (t.days / 7);
        rows.push({ name: `Buddy bank ${tier[0].toUpperCase() + tier.slice(1)}`, type: 'Buddy banking', capital: t.amount, weekly, note: `${t.days} days, 70% of the bank profit (estimate at 10/10 merits)` });
    }
    for (const v of D.ventures) if (v.active) rows.push({ name: v.name, type: v.type || 'Other', capital: v.capital, weekly: v.weekly, note: v.note });
    return rows.map(r => ({ ...r, roi: r.capital > 0 ? r.weekly * 52 / r.capital * 100 : null }))
        .sort((a, b) => (b.roi ?? -1e9) - (a.roi ?? -1e9));
}
// A rent-to-own island as cash flows: a payment of rent + equity at the start and then every month until the sale price is paid. Her simple yearly return is the profit over the capital,
// spread over the months it lasts (profit / capital x 12 / months); the IRR counts that a part of the money is back every month (a monthly rate, times 12).
function finRtoStats(cost, rent, eq, goal) {
    const months = goal / eq, n = Math.ceil(months - 1e-9), flows = []; let rem = goal;
    for (let k = 0; k < n; k++) { const e = Math.min(eq, rem); rem -= e; flows.push(rent + e); }
    const profit = flows.reduce((s, x) => s + x, 0) - cost;
    let lo = 0, hi = 1; const npv = r => flows.reduce((s, x, k) => s + x / Math.pow(1 + r, k), 0) - cost;
    for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (npv(mid) > 0) lo = mid; else hi = mid; }
    let cum = 0, payMonths = n; for (let k = 0; k < n; k++) { cum += flows[k]; if (cum >= cost) { payMonths = k + 1; break; } }
    return { months, profit, irr: lo * 12 * 100, payMonths, back6: flows.slice(0, 6).reduce((s, x) => s + x, 0), weeklyEquiv: profit / (months * 52 / 12) };
}
function finInvestorCost() {
    const act = finData.investors.filter(i => i.active && i.amount > 0);
    const invested = act.reduce((s, i) => s + i.amount, 0), weekly = act.reduce((s, i) => s + finPayout(i), 0);
    return { invested, weekly, pct: invested ? weekly * 52 / invested * 100 : null };
}

// ---- drawing ----
const FIN_LISTS = {
    investors: { title: 'Investors', add: '+ Investor', fresh: () => ({ id: finId(), name: '', amount: 0, payout: null, mode: 'weekly', start: new Date().toISOString().slice(0, 10), active: true, nettedIn: '', note: '', tornId: '', paidUntil: '', payments: [], termEnd: '', returnedOn: '', renewals: [] }), cols: [
        { f: 'active', l: 'On', t: 'bool' }, { f: 'name', l: 'Name', t: 'text', w: 120 }, { f: 'tornId', l: 'Torn ID', t: 'text', w: 80 }, { f: 'amount', l: 'Invested', t: 'money', w: 110 }, { f: 'payout', l: 'Paid a week (empty = by the table)', t: 'money', w: 130, nullable: true },
        { f: 'mode', l: 'Paid', t: 'sel', opts: [['weekly', 'Every Sunday'], ['monthly', 'Last Sunday of the month']] }, { f: 'start', l: 'Since', t: 'date' }, { f: 'termEnd', l: 'Term ends', t: 'date' }, { f: 'returnedOn', l: 'Money returned on', t: 'date' }, { f: 'paidUntil', l: 'Paid through', t: 'date' }, { f: 'nettedIn', l: 'Already netted in the send of', t: 'company' }] },
    income: { title: 'Other income', add: '+ Income', fresh: () => ({ id: finId(), name: '', amount: 0, freq: 'weekly', date: new Date().toISOString().slice(0, 10), active: true }), cols: [
        { f: 'active', l: 'On', t: 'bool' }, { f: 'name', l: 'What', t: 'text', w: 160 }, { f: 'amount', l: 'Amount', t: 'money', w: 120 }, { f: 'freq', l: 'How often', t: 'sel', opts: [['weekly', 'Every week'], ['monthly', 'Every month'], ['once', 'Once']] }, { f: 'date', l: 'From / on', t: 'date' }] },
    outlays: { title: 'Planned spending (one time)', add: '+ Spending', fresh: () => ({ id: finId(), name: '', amount: 0, date: new Date().toISOString().slice(0, 10) }), cols: [
        { f: 'name', l: 'What', t: 'text', w: 180 }, { f: 'amount', l: 'Amount', t: 'money', w: 120 }, { f: 'date', l: 'On', t: 'date' }] },
    buddies: { title: 'Buddy banking', add: '+ Buddy', fresh: () => ({ id: finId(), name: '', tornId: '', tier: 'bronze', amount: FIN_TIERS.bronze.amount, term: FIN_TIERS.bronze.days, given: new Date().toISOString().slice(0, 10), profit: 0, share: 70, status: 'active', note: '', returnedOn: '' }), cols: [
        { f: 'name', l: 'Who', t: 'text', w: 120 }, { f: 'tornId', l: 'Torn ID', t: 'text', w: 80 }, { f: 'tier', l: 'Tier', t: 'sel', opts: [['bronze', 'Bronze'], ['silver', 'Silver'], ['gold', 'Gold'], ['', 'Other']] }, { f: 'amount', l: 'Given', t: 'money', w: 120 }, { f: 'term', l: 'Days', t: 'money', w: 60 },
        { f: 'given', l: 'Given on', t: 'date' }, { f: 'profit', l: 'Expected profit (0 = estimate)', t: 'money', w: 120 }, { f: 'share', l: 'Your share %', t: 'money', w: 60 }, { f: 'status', l: 'Status', t: 'sel', opts: [['active', 'Invested'], ['returned', 'Paid back']] }, { f: 'note', l: 'Note', t: 'text', w: 110 }] },
    loans: { title: 'Loans I gave', add: '+ Loan', fresh: () => ({ id: finId(), name: '', lent: 0, owed: 0, repaid: 0, freq: 'open', payment: 0, date: new Date().toISOString().slice(0, 10), from: new Date().toISOString().slice(0, 10), active: true, note: '' }), cols: [
        { f: 'active', l: 'On', t: 'bool' }, { f: 'name', l: 'Who', t: 'text', w: 120 }, { f: 'lent', l: 'Lent', t: 'money', w: 110 }, { f: 'owed', l: 'To get back (0 = same as lent)', t: 'money', w: 120 }, { f: 'repaid', l: 'Paid back so far', t: 'money', w: 110 },
        { f: 'freq', l: 'Pays back', t: 'sel', opts: [['open', 'No fixed plan'], ['weekly', 'Every week'], ['monthly', 'Every month'], ['once', 'All at once']] }, { f: 'payment', l: 'Per payment', t: 'money', w: 100 }, { f: 'from', l: 'First / due on', t: 'date' }, { f: 'date', l: 'Lent on', t: 'date' }, { f: 'note', l: 'Note', t: 'text', w: 120 }] },
    ventures: { title: 'Other ways you earn', add: '+ Venture', fresh: () => ({ id: finId(), name: '', type: '', capital: 0, weekly: 0, note: '', active: true }), cols: [
        { f: 'active', l: 'On', t: 'bool' }, { f: 'name', l: 'Name', t: 'text', w: 150 }, { f: 'type', l: 'Kind (market, stocks, buddy bank…)', t: 'text', w: 130 }, { f: 'capital', l: 'Capital in it', t: 'money', w: 120 }, { f: 'weekly', l: 'Earns a week', t: 'money', w: 120 }, { f: 'note', l: 'Note', t: 'text', w: 170 }] },
    roi: { title: 'Investor pay table', add: '+ Row', fresh: () => ({ amount: 0, weekly: 0 }), cols: [{ f: 'amount', l: 'Invested', t: 'money', w: 130 }, { f: 'weekly', l: 'Paid a week', t: 'money', w: 130 }] },
};
function finCell(list, i, col, row, extra = '') {
    const a = `data-l="${list}" data-i="${i}" data-f="${col.f}" data-t="${col.t}" ${extra}`;
    const v = row[col.f], w = `width:${col.w || 110}px;`;
    if (col.t === 'bool') return `<input type="checkbox" ${a} ${v ? 'checked' : ''} style="width:auto;">`;
    if (col.t === 'sel') return `<select ${a}>${col.opts.map(([k, l]) => `<option value="${esc(k)}" ${v === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    if (col.t === 'company') return `<select ${a} style="max-width:150px;"><option value="">—</option>${finSrv.companies.map(c => `<option value="${esc(String(c.id))}" ${String(v) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`;
    if (col.t === 'date') return `<input type="date" ${a} value="${esc(v || '')}">`;
    if (col.t === 'money') return `<input type="text" inputmode="decimal" ${a} ${list === 'investors' && col.f === 'payout' ? `data-phinv="${i}"` : ''} value="${v === null || v === undefined ? '' : finFull(v)}" style="${w}text-align:right;font-family:var(--mono);">`;
    return `<input type="text" ${a} value="${esc(v || '')}" style="${w}">`;
}
function finListEditor(list) {
    const L = FIN_LISTS[list], rows = finData[list];
    const extra = list === 'investors' ? ['Yearly', 'Payout due', 'Term'] : list === 'loans' ? ['Still to come back'] : list === 'buddies' ? ['Due / comes back', ''] : [];
    return `<div class="panel"><h3 style="margin-top:0;">${L.title}</h3>${list === 'roi' ? '<p style="font-size:12px;color:var(--muted);margin:0 0 8px;">From the top row up, an investor is paid per billion the same as the top row. In between rows it is scaled from the row below it. At most 35% a year.</p>' : ''}
        <div style="overflow-x:auto;"><table style="border-collapse:collapse;font-size:13px;"><thead><tr>${L.cols.map(c => `<th style="text-align:left;padding:4px 8px;font-size:11px;color:var(--muted);font-weight:600;">${c.l}</th>`).join('')}${extra.map(x => `<th style="padding:4px 8px;font-size:11px;color:var(--muted);font-weight:600;text-align:left;">${x}</th>`).join('')}<th></th></tr></thead>
        <tbody>${rows.map((r, i) => `<tr>${L.cols.map(c => `<td style="padding:3px 6px;">${finCell(list, i, c, r)}</td>`).join('')}${list === 'investors' ? `<td style="padding:3px 8px;white-space:nowrap;" data-pct="${i}"></td><td style="padding:3px 8px;font-size:12px;" data-invdue="${i}"></td><td style="padding:3px 8px;font-size:12px;white-space:nowrap;" data-invterm="${i}"></td>` : list === 'loans' ? `<td style="padding:3px 8px;white-space:nowrap;font-family:var(--mono);" data-loanleft="${i}"></td>` : list === 'buddies' ? `<td style="padding:3px 8px;white-space:nowrap;font-size:12px;" data-bbinfo="${i}"></td><td style="padding:3px 8px;white-space:nowrap;" data-bbact="${i}"></td>` : ''}<td><button class="ghost small" data-del="${list}" data-i="${i}" type="button" title="Remove">✕</button></td></tr>`).join('') || `<tr><td colspan="${L.cols.length + 2}" style="color:var(--muted);padding:6px 8px;">Nothing yet.</td></tr>`}</tbody></table></div>
        <button class="ghost small" data-add="${list}" type="button" style="margin-top:8px;">${L.add}</button></div>`;
}
function finPlansPanel() {
    return `<div class="panel"><h3 style="margin-top:0;">🎯 When can I afford it?</h3>
        <p style="font-size:12px;color:var(--muted);margin:0 0 10px;">Write a plan as steps: how much, and how many weeks after the start it is needed (4 weeks is about a month). The page finds the earliest Sunday you can start so that every step is paid and the balance never drops below your reserve.</p>
        ${finData.plans.map((p, pi) => `<div class="panel" style="margin:0 0 10px;"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px;"><input type="text" data-pl="${pi}" data-f="name" data-t="text" value="${esc(p.name)}" style="width:220px;font-weight:700;" placeholder="Plan name"><button class="ghost small" data-delplan="${pi}" type="button">Remove plan</button></div>
            <table style="border-collapse:collapse;font-size:13px;"><tbody>${p.steps.map((s, si) => `<tr><td style="padding:2px 6px;"><input type="text" data-p="${pi}" data-i="${si}" data-f="label" data-t="text" value="${esc(s.label)}" placeholder="What" style="width:150px;"></td>
                <td style="padding:2px 6px;"><input type="text" inputmode="decimal" data-p="${pi}" data-i="${si}" data-f="amount" data-t="money" value="${s.amount ? finFull(s.amount) : ''}" placeholder="Amount (500m)" style="width:130px;text-align:right;font-family:var(--mono);"></td>
                <td style="padding:2px 6px;white-space:nowrap;">after <input type="number" min="0" max="51" data-p="${pi}" data-i="${si}" data-f="afterWeeks" data-t="int" value="${s.afterWeeks}" style="width:60px;"> weeks</td>
                <td><button class="ghost small" data-delstep="${pi}" data-i="${si}" type="button">✕</button></td></tr>`).join('')}</tbody></table>
            <button class="ghost small" data-addstep="${pi}" type="button" style="margin-top:4px;">+ Step</button>
            <div class="fin-plan-res" data-res="${esc(p.id)}" style="margin-top:8px;font-size:13px;"></div></div>`).join('') || '<div style="color:var(--muted);font-size:13px;margin-bottom:8px;">No plans yet.</div>'}
        <button class="ghost small" id="fin-addplan" type="button">+ Plan</button></div>`;
}
function finCapitalsPanel() {
    const S = finSrv, D = finData;
    const inp = (attrs, val, w = 130) => `<input type="text" inputmode="decimal" ${attrs} data-t="money" value="${finFull(val)}" style="width:${w}px;text-align:right;font-family:var(--mono);">`;
    const coRows = S.companies.map(c => {
        const e = finEstOf(c), cap = D.capitals[`co:${c.id}`] ?? FIN_STAFF_COST[e.staff] ?? 0;
        return `<tr><td style="padding:3px 8px;">${esc(c.name)}</td><td style="padding:3px 8px;"><select data-est="${esc(String(c.id))}" data-f="staff" data-t="staff"><option value="0" ${!e.staff ? 'selected' : ''}>?</option><option value="14" ${e.staff === 14 ? 'selected' : ''}>14 people</option><option value="16" ${e.staff === 16 ? 'selected' : ''}>16 people</option></select></td>
            <td style="padding:3px 8px;">${inp(`data-est="${esc(String(c.id))}" data-f="daily"`, e.daily)}</td><td style="padding:3px 8px;">${inp(`data-cap="co:${esc(String(c.id))}"`, cap)}</td>
            <td style="padding:3px 8px;text-align:center;"><input type="checkbox" data-est="${esc(String(c.id))}" data-f="sold" data-t="bool" ${e.sold ? 'checked' : ''} style="width:auto;"></td></tr>`;
    }).join('');
    return `<div class="panel"><h3 style="margin-top:0;">Companies: estimate and capital</h3><p style="font-size:12px;color:var(--muted);margin:0 0 8px;">Until a company has 3 full weeks of saved numbers, the earnings table and the week-by-week page use your estimate: the net profit a day, with the company's director cut taken off. A 14-person mine costs about 9b to get and a 16-person one 12b (filled in when the capital is not set). A company that was sold earns nothing more.</p>
        <div style="overflow-x:auto;"><table style="border-collapse:collapse;font-size:13px;"><thead><tr>${['Company', 'Size', 'Net profit a day (estimate)', 'Capital in it', 'Sold'].map(h => `<th style="text-align:left;padding:4px 8px;font-size:11px;color:var(--muted);font-weight:600;">${h}</th>`).join('')}</tr></thead><tbody>${coRows}</tbody></table></div></div>
        <div class="panel"><h3 style="margin-top:0;">Capital per island</h3><p style="font-size:12px;color:var(--muted);margin:0 0 8px;">What you paid for an island (the buying prices are filled in). The return table needs it to work out the percentage a year.</p>
        <table style="border-collapse:collapse;font-size:13px;"><tbody>${[4100, 3600, 2600].map(t => `<tr><td style="padding:3px 8px;">Island ${t}</td><td style="padding:3px 8px;">${inp(`data-cap="pi:${t}"`, D.capitals[`pi:${t}`] ?? S.rto.defaults.cost[t], 140)}</td></tr>`).join('')}</tbody></table></div>`;
}

async function loadFinances() {
    finPage = 'finances';
    const st = $('fin-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    const r = await finFetch({ action: 'fin-get' });
    if (r.error) { st.className = 'status err'; st.textContent = r.error; return; }
    st.textContent = ''; st.className = 'status';
    finSrv = { cash: r.cash, companies: r.companies || [], rto: r.rto || { rtoItems: [], pis: [], defaults: { rent: { 4100: 27000000, 3600: 15000000, 2600: 12000000 }, equity: { 4100: 81000000, 3600: 45000000, 2600: 36000000 }, goals: { 4100: 1701000000, 3600: 855000000, 2600: 612000000 }, cost: { 4100: 1482500000, 3600: 757500000, 2600: 557500000 } } }, today: r.today };
    finData = { fundsMode: r.fundsMode, fundsManual: r.fundsManual, reserve: r.reserve, investors: r.investors, income: r.income, outlays: r.outlays, plans: r.plans, roi: r.roi, ventures: r.ventures, capitals: r.capitals, coEst: r.coEst || {}, loans: r.loans || [], buddies: r.buddies || [] };
    finRenderAll();
}
function finRenderAll() { FIN_PAGES[finPage].render(); }
function finRenderFinances() {
    const c = finSrv.cash, D = finData;
    $('fin-body').innerHTML = `
        <div id="fin-summary"></div>
        <div class="panel"><h3 style="margin-top:0;">Money available now</h3>
            <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-end;font-size:13px;">
                <div class="field" style="margin:0;"><label>The money I have to work with</label><input type="text" inputmode="decimal" data-s="fundsManual" data-t="money" value="${finFull(D.fundsManual)}" style="width:170px;text-align:right;font-family:var(--mono);"></div>
                <div class="field" style="margin:0;"><label>Keep at least (reserve)</label><input type="text" inputmode="decimal" data-s="reserve" data-t="money" value="${finFull(D.reserve)}" style="width:140px;text-align:right;font-family:var(--mono);"></div>
                ${c && !c.error ? `<div style="color:var(--muted);font-size:12px;">In Torn right now: ${finShort(c.onHand + c.vault)} (cash + vault) <button class="ghost small" data-usetorn="${c.onHand + c.vault}" type="button">Use this</button></div>` : ''}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:6px;">Type what you can actually spend, wherever it sits (cash, vault, stocks, faction). Everything below is worked out from this amount forward, so update it now and then. Money you lent out is not part of it: add it under "Loans I gave".</div></div>
        <div class="panel"><div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-bottom:8px;"><h3 style="margin:0;">📅 Week by week</h3>
            <label style="font-size:13px;">Weeks ahead <select id="fin-ahead">${[8, 16, 26, 52].map(n => `<option value="${n}" ${finAhead === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
            <label style="font-size:13px;">Show a plan <select id="fin-overlay"><option value="">none</option>${D.plans.map(p => `<option value="${esc(p.id)}" ${finShowPlan === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label></div>
            <div id="fin-timeline" style="overflow-x:auto;"></div>
            <p style="font-size:11px;color:var(--muted);margin:8px 0 0;">Weeks end on Sunday. In past weeks the companies column is what they really sent (from the saved days with a bank amount); the rest is what your settings say should have happened. From now on the companies column is the average of the last four known weeks.</p></div>
        ${finPlansPanel()}
        <div class="panel"><h3 style="margin-top:0;">🏆 What earns the most on its capital</h3><div id="fin-vent" style="overflow-x:auto;"></div></div>
        ${finListEditor('income')}${finListEditor('outlays')}${finListEditor('loans')}${finListEditor('ventures')}${finCapitalsPanel()}<div class="panel" style="font-size:13px;color:var(--muted);">The investors and their pay table are on the 📈 Investment fund page, the buddy banks on the 🤝 Buddy banking page (both in the CreaLotte menu). What you enter there counts here automatically.</div>`;
    finWire('fin-body');
    finRefresh();
}
function finRefreshMain() {
    const base = finModel(null);
    const res = Object.fromEntries(finData.plans.map(p => [p.id, finFind(p, base)]));
    const sel = finData.plans.find(p => p.id === finShowPlan);
    const m = sel && res[sel.id] && res[sel.id].start != null ? finModel(sel, res[sel.id].start) : base;
    const reserve = finData.reserve, fut = m.weeks.filter(w => w.w >= 0);
    // top numbers
    const next = fut.slice(0, 12), avg = k => next.reduce((s, w) => s + w[k], 0) / next.length; // 12 weeks: rent-to-own pays once per 30 days, so a short window would jump around
    const cost = finInvestorCost();
    const dip = fut.find(w => w.bal < reserve);
    const noCo = finSrv.companies.filter(c => !c.weeks.some(x => x.send != null)).map(c => c.name);
    const inAvg = avg('co') + avg('rto') + avg('inc') + avg('loan');
    const loanOut = finData.loans.filter(l => l.active).reduce((s, l) => s + Math.max(0, (l.owed > 0 ? l.owed : l.lent) - l.repaid), 0);
    const bbOut = finData.buddies.filter(b => b.status === 'active'), bbBack = bbOut.reduce((s, b) => s + finBuddy(b).back, 0);
    $('fin-summary').innerHTML = `<div class="panel" style="display:flex;gap:26px;flex-wrap:wrap;font-size:13px;">
        <div><div style="color:var(--muted);font-size:11px;">Available now</div><b style="font-family:var(--mono);">${finShort(m.funds)}</b></div>
        <div><div style="color:var(--muted);font-size:11px;">Coming in a week (average of the next 12 weeks)</div><b style="font-family:var(--mono);color:var(--success,#35d99b);">${finShort(inAvg)}</b>
            <div style="font-size:11px;color:var(--muted);">companies ${finShort(avg('co'))} · rent-to-own ${finShort(avg('rto'))} · other ${finShort(avg('inc'))} · loans ${finShort(avg('loan'))}</div><div style="font-size:11px;color:var(--muted);">Buddy banks paying back (${finShort(avg('bb'))} a week) is mostly your own cash returning, so it is not counted here.</div>${noCo.length ? `<div style="font-size:11px;color:#e0a030;">No weekly send known yet for ${esc(noCo.join(', '))}, so that part is counted as 0.</div>` : ''}</div>
        <div><div style="color:var(--muted);font-size:11px;">Paid to investors a week</div><b style="font-family:var(--mono);">${finShort(avg('inv'))}</b></div>
        <div><div style="color:var(--muted);font-size:11px;">Left over a week (before one-time spending)</div><b style="font-family:var(--mono);">${finShort(inAvg - avg('inv'))}</b></div>
        <div><div style="color:var(--muted);font-size:11px;">In buddy banks</div><b style="font-family:var(--mono);">${finShort(bbOut.reduce((s, b) => s + b.amount, 0))}</b> <span style="color:var(--muted);font-size:11px;">(${bbOut.length}; back with profit ${finShort(bbBack)})</span></div>
        <div><div style="color:var(--muted);font-size:11px;">Lent out, still to come back</div><b style="font-family:var(--mono);">${finShort(loanOut)}</b></div>
        <div><div style="color:var(--muted);font-size:11px;">Invested by others</div><b style="font-family:var(--mono);">${finShort(cost.invested)}</b></div>
        <div><div style="color:var(--muted);font-size:11px;">They cost you a year</div><b style="color:${cost.pct !== null && cost.pct > 35.05 ? 'var(--danger)' : 'inherit'};">${cost.pct === null ? '—' : `${cost.pct.toFixed(1)}%`}</b> <span style="color:var(--muted);font-size:11px;">(max 35%)</span></div>
        ${dip ? `<div style="color:var(--danger);">⚠ The balance drops below your reserve in the week of ${esc(finDate(dip.end))}.</div>` : ''}</div>`;
    // the timeline
    const shown = m.weeks.filter(w => w.w < finAhead);
    const th = (t, r) => `<th style="padding:5px 9px;font-size:11px;color:var(--muted);font-weight:600;text-align:${r ? 'right' : 'left'};white-space:nowrap;">${t}</th>`;
    const td = (v, o = {}) => `<td style="padding:4px 9px;text-align:right;font-family:var(--mono);white-space:nowrap;${o.color ? `color:${o.color};` : ''}${o.b ? 'font-weight:700;' : ''}" ${o.title ? `title="${esc(o.title)}"` : ''}>${v}</td>`;
    $('fin-timeline').innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr>${th('Week ending')}${th('Companies', 1)}${th('Rent-to-own', 1)}${th('Other income', 1)}${th('Loans back', 1)}${th('Buddy banks', 1)}${th('Investors', 1)}${th('Planned', 1)}${sel && res[sel.id] && res[sel.id].start != null ? th(esc(sel.name), 1) : ''}${th('Net', 1)}${th('Balance', 1)}</tr></thead>
        <tbody>${shown.map(w => {
            const past = w.w < 0, now = w.w === 0;
            return `<tr style="${past ? 'opacity:.6;' : ''}${now ? 'background:rgba(53,217,155,.10);' : ''}border-top:1px solid var(--border,rgba(255,255,255,.08));"><td style="padding:4px 9px;white-space:nowrap;">${esc(finDate(w.end))}${now ? ' <span style="font-size:11px;color:var(--muted);">this week</span>' : ''}</td>
            ${td(w.co ? finShort(w.co) : '—', { title: w.coParts.join('\n') })}${td(w.rto ? finShort(w.rto) : '—')}${td(w.inc ? finShort(w.inc) : '—')}${td(w.loan ? finShort(w.loan) : '—', { title: w.loanParts.join('\n') })}${td(w.bb ? finShort(w.bb) : '—', { title: w.bbParts.join('\n') })}${td(w.inv ? '-' + finShort(w.inv) : '—', { title: w.invParts.join('\n') })}${td(w.out ? '-' + finShort(w.out) : '—')}
            ${sel && res[sel.id] && res[sel.id].start != null ? td(w.plan ? '-' + finShort(w.plan) : '—', { color: '#e0a030' }) : ''}${td(finShort(w.net), { color: w.net < 0 ? 'var(--danger)' : '' })}${td(w.bal === null ? '—' : finShort(w.bal), { b: 1, color: w.bal !== null && w.bal < reserve ? 'var(--danger)' : '' })}</tr>`;
        }).join('')}</tbody></table>`;
    // plan results
    document.querySelectorAll('.fin-plan-res').forEach(el => {
        const p = finData.plans.find(x => x.id === el.dataset.res), r = p ? res[p.id] : null;
        if (!p) return;
        if (!r) { el.innerHTML = '<span style="color:var(--muted);">Add at least one step with an amount.</span>'; return; }
        if (r.start === null) { el.innerHTML = `<span style="color:var(--danger);">Not within the next ${FIN_HORIZON} weeks as things stand: it comes up about <b>${finShort(r.short)}</b> short. More income, a smaller first step or a lower reserve would change that.</span>`; return; }
        el.innerHTML = `<span style="color:var(--success,#35d99b);font-weight:700;">${r.start === 0 ? 'You can start right now' : `Earliest start: Sunday ${esc(finDate(r.date))} (in ${r.start} week${r.start > 1 ? 's' : ''})`}</span>
            <span style="color:var(--muted);"> — ${r.steps.map(s => `${esc(s.label || 'step')} ${finShort(s.amount)} on ${esc(finDate(s.date))}`).join(' · ')}. Spare after the tightest week: ${finShort(r.margin)}.</span>
            <button class="ghost small" data-show="${esc(p.id)}" type="button" style="margin-left:8px;">${finShowPlan === p.id ? 'Hide in the table' : 'Show in the table'}</button>`;
    });
    // ventures ranked by return
    const rows = finVentures(m), pct = cost.pct;
    $('fin-vent').innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr>${th('Venture')}${th('Kind')}${th('Capital', 1)}${th('Earns a week', 1)}${th('Return a year', 1)}${th('Counting money coming back', 1)}${th('Pays back in', 1)}${th(pct === null ? 'After investor cost, a week' : `After paying investors ${pct.toFixed(0)}%, a week`, 1)}</tr></thead>
        <tbody>${rows.map(r => {
            const margin = r.capital > 0 ? r.weekly - r.capital * (pct ?? 35) / 100 / 52 : null;
            const good = r.roi !== null && pct !== null && r.roi > pct;
            return `<tr style="border-top:1px solid var(--border,rgba(255,255,255,.08));"><td style="padding:4px 9px;">${esc(r.name)}${r.note ? `<div style="font-size:11px;color:var(--muted);">${esc(r.note)}</div>` : ''}</td><td style="padding:4px 9px;color:var(--muted);">${esc(r.type)}</td>
            ${td(r.capital ? finShort(r.capital) : '<span style="color:var(--muted);">set it</span>')}${td(finShort(r.weekly))}${td(r.roi === null ? '—' : `${r.roi.toFixed(1)}%`, { b: 1, color: r.roi === null ? '' : good ? 'var(--success,#35d99b)' : pct === null ? '' : 'var(--danger)' })}
            ${td(r.irr == null ? '—' : `${r.irr.toFixed(0)}%`)}${td(r.payMonths ? `${r.payMonths} months` : r.capital > 0 && r.weekly > 0 ? `${(r.capital / r.weekly / 52 * 12).toFixed(1)} months` : '—')}${td(margin === null ? '—' : finShort(margin), { color: margin !== null && margin < 0 ? 'var(--danger)' : '' })}</tr>`;
        }).join('')}</tbody></table>
        <p style="font-size:11px;color:var(--muted);margin:8px 0 0;">Green earns more a year than your investors cost you; red earns less, so money borrowed for it would cost more than it brings in. Companies use the profit after the director cut; islands are rent-to-own only; rent-to-own counts the rent plus the sale at the end (price minus capital), spread over the months it lasts. "Counting money coming back" is the monthly return when the part of the money that returns every month is taken into account: you can reinvest it, so the money is not stuck for the whole contract. The capital per island is set below.</p>`;
}
function finRefresh() { if (finPage === 'finances') finRefreshMain(); finRefreshCells(); if (FIN_PAGES[finPage].refresh) FIN_PAGES[finPage].refresh(); }
function finRefreshCells() {
    // the yearly percentage and the placeholder (what the table pays) in the investor list
    document.querySelectorAll('[data-pct]').forEach(el => {
        const i = finData.investors[+el.dataset.pct]; if (!i) return;
        const y = i.amount > 0 ? finPayout(i) * 52 / i.amount * 100 : 0;
        el.innerHTML = `<span style="color:${y > 35.05 ? 'var(--danger)' : 'var(--muted)'};">${y.toFixed(1)}%${y > 35.05 ? ' ⚠' : ''}</span>`;
    });
    document.querySelectorAll('[data-phinv]').forEach(el => { const i = finData.investors[+el.dataset.phinv]; if (i) el.placeholder = finFull(finRoi(i.amount, finData.roi)); });
    document.querySelectorAll('[data-bbinfo]').forEach(el => {
        const b = finData.buddies[+el.dataset.bbinfo]; if (!b) return;
        const f = finBuddy(b);
        el.innerHTML = b.status === 'returned' ? `<span style="color:var(--muted);">paid back${b.returnedOn ? ` ${esc(finDate(b.returnedOn))}` : ''}</span>` : `${esc(finDate(f.due))}${f.due < finSrv.today ? ' <span style="color:var(--danger);">late</span>' : ''}<div style="font-family:var(--mono);color:var(--muted);">${finShort(f.back)} (profit ${finShort(f.profit)}${b.profit > 0 ? '' : ', est.'})</div>`;
    });
    document.querySelectorAll('[data-loanleft]').forEach(el => {
        const l = finData.loans[+el.dataset.loanleft]; if (!l) return;
        const left = Math.max(0, (l.owed > 0 ? l.owed : l.lent) - l.repaid);
        el.innerHTML = left ? finShort(left) : '<span style="color:var(--muted);">paid back</span>';
    });
}

// ---- saving: a moment after the last change, never while typing ----
const finStatusEl = () => $(FIN_PAGES[finPage].status);
function finTouch() {
    const st = finStatusEl(); st.className = 'status ok'; st.textContent = 'Changes not saved yet…';
    clearTimeout(finTimer);
    finTimer = setTimeout(finSaveNow, 1200);
    finRefresh();
}
async function finSaveNow() {
    if (finSaving) { finTimer = setTimeout(finSaveNow, 800); return; }
    finSaving = true;
    const P = FIN_PAGES[finPage];
    // the Finances page saves everything except the lists of the investment fund and buddy banking pages; those pages save only their own lists
    const r = P.parts ? await finFetch({ action: 'fin-part-save', parts: Object.fromEntries(P.parts.map(k => [k, finData[k]])) })
        : await finFetch({ action: 'fin-save', data: Object.fromEntries(Object.entries(finData).filter(([k]) => !['investors', 'buddies', 'roi'].includes(k))) });
    finSaving = false;
    const st = finStatusEl();
    if (r.error) { st.className = 'status err'; st.textContent = `Not saved: ${r.error}`; return; }
    st.className = 'status ok'; st.textContent = 'Saved.';
    setTimeout(() => { if (st.textContent === 'Saved.') { st.textContent = ''; st.className = 'status'; } }, 2500);
}

function finWire(bodyId) {
    if (finBound[bodyId]) return;
    finBound[bodyId] = true;
    const body = $(bodyId);
    body.addEventListener('change', e => {
        const el = e.target;
        if (el.id === 'fin-ahead') { finAhead = +el.value; finRefresh(); return; }
        if (el.id === 'fin-overlay') { finShowPlan = el.value; finRefresh(); return; }
        const read = () => {
            if (el.dataset.t === 'bool') return el.checked;
            if (el.dataset.t === 'staff') return Number(el.value) || 0;
            if (el.dataset.t === 'money') { const n = finParse(el.value); return n; }
            if (el.dataset.t === 'int') return Math.max(0, Math.min(51, parseInt(el.value, 10) || 0));
            return el.value;
        };
        let target = null, field = el.dataset.f;
        if (el.dataset.s) { target = finData; field = el.dataset.s; }
        else if (el.dataset.cap) { target = finData.capitals; field = el.dataset.cap; }
        else if (el.dataset.est) { const c = finSrv.companies.find(x => String(x.id) === el.dataset.est); finData.coEst = finData.coEst || {}; target = finData.coEst[el.dataset.est] = finData.coEst[el.dataset.est] || { ...finEstOf(c || {}) }; field = el.dataset.f; }
        else if (el.dataset.p !== undefined) target = (finData.plans[+el.dataset.p] || {}).steps?.[+el.dataset.i];
        else if (el.dataset.pl !== undefined) target = finData.plans[+el.dataset.pl];
        else if (el.dataset.l) target = (finData[el.dataset.l] || [])[+el.dataset.i];
        if (!target) return;
        let v = read();
        if (el.dataset.t === 'money') {
            if (v === null && el.value.trim() === '' && FIN_LISTS[el.dataset.l]?.cols.find(c => c.f === field)?.nullable) { target[field] = null; el.value = ''; finTouch(); return; }
            if (v === null) { el.value = target[field] === null || target[field] === undefined ? '' : finFull(target[field]); toast('Write it as 500m, 1.5b or 6,731,000'); return; }
            el.value = finFull(v);
        }
        if (el.dataset.s === 'fundsMode') v = el.value;
        target[field] = v;
        if (el.dataset.est && (field === 'staff' || field === 'sold')) finRenderAll();
        if (el.dataset.l === 'investors' && field === 'returnedOn') { target.active = !v; finRenderAll(); } // the money was given back: stops the payouts after that date; clearing the date (they came back) switches it on again
        if (el.dataset.l === 'buddies' && field === 'tier' && FIN_TIERS[v]) { target.amount = FIN_TIERS[v].amount; target.term = FIN_TIERS[v].days; finRenderAll(); } // a tier brings its usual amount and term
        finTouch();
    });
    body.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.add) { finData[b.dataset.add].push(FIN_LISTS[b.dataset.add].fresh()); finRenderAll(); finTouch(); }
        else if (b.dataset.del) { finData[b.dataset.del].splice(+b.dataset.i, 1); finRenderAll(); finTouch(); }
        else if (b.id === 'fin-addplan') { finData.plans.push({ id: finId(), name: 'New plan', steps: [{ label: '', amount: 0, afterWeeks: 0 }] }); finRenderAll(); finTouch(); }
        else if (b.dataset.delplan !== undefined) { const p = finData.plans.splice(+b.dataset.delplan, 1)[0]; if (p && finShowPlan === p.id) finShowPlan = ''; finRenderAll(); finTouch(); }
        else if (b.dataset.addstep !== undefined) { finData.plans[+b.dataset.addstep].steps.push({ label: '', amount: 0, afterWeeks: 4 }); finRenderAll(); finTouch(); }
        else if (b.dataset.delstep !== undefined) { finData.plans[+b.dataset.delstep].steps.splice(+b.dataset.i, 1); finRenderAll(); finTouch(); }
        else if (b.dataset.show) { finShowPlan = finShowPlan === b.dataset.show ? '' : b.dataset.show; finRenderAll(); }
        else if (b.dataset.usetorn) { finData.fundsManual = Math.round(Number(b.dataset.usetorn)); finRenderAll(); finTouch(); }
        else if (FIN_PAGES[finPage].click) FIN_PAGES[finPage].click(b);
    });
}

FIN_PAGES.finances = { status: 'fin-status', render: finRenderFinances, parts: null };
