// lib/finances.js — the owner's finances page (CreaLotte): every income and every payout of the owner's Torn side hustles, for the past AND the coming weeks, so
// it is clear when enough money is available for the next move (for example a buddy bank that needs 500m now, 500m a month later and 1b a month after that).
// The timeline itself is worked out in the browser (finances.js); this file stores the owner's settings and gathers what only the server can read:
//   - the owner's cash (Torn user/money, read live with the owner's own key),
//   - what each company sent in the past weeks (from the saved company days, see lib/companyReports.js weekly()),
//   - the rent-to-own contracts (lib/labstracking.js data), which pay rent + equity every 30 days.
//
//   wwl:finances -> JSON { fundsMode: 'auto' | 'manual', fundsManual, reserve, investors: [{ id, name, amount, payout (null = by the ROI table), mode: 'weekly' | 'monthly', start, active, nettedIn (company id or ''), note }],
//                          income: [{ id, name, amount, freq: 'weekly' | 'monthly' | 'once', date, active }], outlays: [{ id, name, amount, date }],
//                          plans: [{ id, name, steps: [{ label, amount, afterWeeks }] }], roi: [{ amount, weekly }],
//                          buddies: [{ id, name, tornId, tier: bronze | silver | gold | '', amount (given), term (days), given (date), profit (0 = estimate), share (her % of the profit, 70), status: active | returned, note }],
//                          coEst: { '{companyId}': { daily (net profit a day, estimate until real weeks exist), staff: 14 | 16, sold } },
//                          loans: [{ id, name, lent, owed (0 = same as lent), repaid, freq: weekly | monthly | once | open, payment, date (lent on), from (first payment), active, note }],
//                          ventures: [{ id, name, type, capital, weekly, note, active }], capitals: { 'co:{companyId}': capital, 'pi:{4100|3600|2600}': capital per island } }
// The owner's ROI table (investor payout a week, paid on Sundays; a monthly investor is paid the grouped weeks on the last Sunday of the month): 250m -> 1,442,000,
// 500m -> 3,125,000, and from 1b 6,731,000 for every billion (so 10b -> 67,310,000). At most 35% a year.

const R = require('./companyReports');

const KEY = 'wwl:finances';
const DEFAULT_ROI = [{ amount: 100000000, weekly: 529000 }, { amount: 250000000, weekly: 1442000 }, { amount: 500000000, weekly: 3125000 }, { amount: 1000000000, weekly: 6731000 }];
const num = (v, d = 0) => { const n = Number(String(v ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) && String(v ?? '') !== '' ? n : d; };
const id6 = () => Math.random().toString(36).slice(2, 8);

// Every write keeps a copy of the record as it was BEFORE the change (one per hour, for 14 days): if a save ever loses something, an earlier state can be put back (fin-bak-restore).
async function writeRecord(redis, d, prev) {
    if (prev) await redis(['SET', `${KEY}:bak:${new Date().toISOString().slice(0, 13)}`, prev, 'NX', 'EX', 1209600]);
    await redis(['SET', KEY, JSON.stringify(d)]);
}
// the tiers (Copper 100m = 529,000, Bronze 250m, Silver 500m, Gold 1b, Platinum from 2b): a pay table saved before Copper existed gets its row added
const withCopper = tbl => (tbl.some(r => r.amount === 100000000) ? tbl : [{ amount: 100000000, weekly: 529000 }].concat(tbl));
async function load(redis) {
    try { const raw = await redis(['GET', KEY]); const d = raw ? JSON.parse(raw) : {}; return { fundsMode: d.fundsMode === 'manual' ? 'manual' : 'auto', fundsManual: num(d.fundsManual), reserve: num(d.reserve), investors: d.investors || [], income: d.income || [], outlays: d.outlays || [], plans: d.plans || [], roi: withCopper(d.roi && d.roi.length ? d.roi : DEFAULT_ROI), ventures: d.ventures || [], paidOffset: num(d.paidOffset), terms: d.terms && typeof d.terms === 'object' ? d.terms : {}, buddyTerms: d.buddyTerms && typeof d.buddyTerms === 'object' ? d.buddyTerms : {}, capitals: d.capitals || {}, coEst: d.coEst || {}, coSends: d.coSends && typeof d.coSends === 'object' ? d.coSends : {}, invRequests: Array.isArray(d.invRequests) ? d.invRequests : [], autoRenewed: Array.isArray(d.autoRenewed) ? d.autoRenewed : [], loans: d.loans || [], buddies: d.buddies || [] }; }
    catch (e) { throw new Error('The finances could not be read, so nothing was changed (' + String(e.message || e).slice(0, 80) + ')'); }
}

function clean(b) {
    const date = s => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : new Date().toISOString().slice(0, 10));
    const date0 = s => (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s || '') ? s : ''); // a date that may stay empty
    const str = (s, n) => String(s || '').trim().slice(0, n);
    return {
        fundsMode: b.fundsMode === 'manual' ? 'manual' : 'auto', fundsManual: Math.round(num(b.fundsManual)), reserve: Math.round(num(b.reserve)),
        investors: (Array.isArray(b.investors) ? b.investors : []).slice(0, 300).map(i => ({ id: str(i.id, 12) || id6(), name: str(i.name, 60) || 'Investor', amount: Math.round(num(i.amount)), payout: i.payout === null || i.payout === '' || i.payout === undefined ? null : Math.round(num(i.payout)), mode: i.mode === 'monthly' ? 'monthly' : 'weekly', start: date(i.start), active: i.active !== false, nettedIn: str(i.nettedIn, 12), note: str(i.note, 120), fundId: str(i.fundId, 8), tornId: String(i.tornId || '').replace(/D/g, '').slice(0, 10), paidUntil: date0(i.paidUntil), payments: (Array.isArray(i.payments) ? i.payments : []).slice(-100).map(p => ({ date: date(p.date), amount: Math.round(num(p.amount)), through: date0(p.through) })), termEnd: date0(i.termEnd), returnedOn: date0(i.returnedOn), renewals: (Array.isArray(i.renewals) ? i.renewals : []).slice(-20).map(r => ({ from: date0(r.from), to: date0(r.to), auto: !!r.auto })), leaving: !!i.leaving, noticeOn: date0(i.noticeOn), paidAdj: Math.round(num(i.paidAdj)), paused: (Array.isArray(i.paused) ? i.paused : []).slice(-60).map(date0).filter(Boolean), pauseFrom: date0(i.pauseFrom), pauseTo: date0(i.pauseTo), switches: (Array.isArray(i.switches) ? i.switches : []).slice(-10).map(w => ({ date: date0(w.date), from: w.from === 'monthly' ? 'monthly' : 'weekly', to: w.to === 'monthly' ? 'monthly' : 'weekly' })).filter(w => w.date), skip: (Array.isArray(i.skip) ? i.skip : []).slice(-60).map(date0).filter(Boolean), extra: (Array.isArray(i.extra) ? i.extra : []).slice(-60).map(date0).filter(Boolean) })),
        income: (Array.isArray(b.income) ? b.income : []).slice(0, 60).map(i => ({ id: str(i.id, 12) || id6(), name: str(i.name, 60) || 'Income', amount: Math.round(num(i.amount)), freq: ['weekly', 'monthly', 'once'].includes(i.freq) ? i.freq : 'weekly', date: date(i.date), active: i.active !== false })),
        outlays: (Array.isArray(b.outlays) ? b.outlays : []).slice(0, 60).map(o => ({ id: str(o.id, 12) || id6(), name: str(o.name, 60) || 'Planned', amount: Math.round(num(o.amount)), date: date(o.date) })),
        plans: (Array.isArray(b.plans) ? b.plans : []).slice(0, 12).map(p => ({ id: str(p.id, 12) || id6(), name: str(p.name, 60) || 'Plan', steps: (Array.isArray(p.steps) ? p.steps : []).slice(0, 12).map(s => ({ label: str(s.label, 60), amount: Math.round(num(s.amount)), afterWeeks: Math.max(0, Math.round(num(s.afterWeeks))) })) })),
        ventures: (Array.isArray(b.ventures) ? b.ventures : []).slice(0, 40).map(v => ({ id: str(v.id, 12) || id6(), name: str(v.name, 60) || 'Venture', type: str(v.type, 30), capital: Math.round(num(v.capital)), weekly: Math.round(num(v.weekly)), note: str(v.note, 120), active: v.active !== false })),
        paidOffset: Math.round(num(b.paidOffset)),
        buddyTerms: Object.fromEntries(Object.entries(b.buddyTerms && typeof b.buddyTerms === 'object' ? b.buddyTerms : {}).slice(0, 400).filter(([k]) => /^[0-9]{1,10}$/.test(k)).map(([k, v]) => [k, { on: date0(v && v.on), v: str(v && v.v, 12) }])),
        terms: Object.fromEntries(Object.entries(b.terms && typeof b.terms === 'object' ? b.terms : {}).slice(0, 800).filter(([k]) => /^[0-9]{1,10}$/.test(k)).map(([k, v]) => [k, { on: date0(v && v.on), v: str(v && v.v, 12) }])),
        capitals: Object.fromEntries(Object.entries(b.capitals || {}).slice(0, 40).filter(([k]) => /^(co:[0-9]{1,9}|pi:(4100|3600|2600))$/.test(k)).map(([k, v]) => [k, Math.round(num(v))])),
        coSends: Object.fromEntries(Object.entries(b.coSends && typeof b.coSends === 'object' ? b.coSends : {}).slice(0, 40).filter(([k]) => /^[0-9]{1,9}$/.test(k)).map(([k, v]) => [k, Object.fromEntries(Object.entries(v || {}).filter(([dt]) => /^d{4}-d{2}-d{2}$/.test(dt)).sort().slice(-40).map(([dt, a]) => [dt, Math.round(num(a))]))])),
        coEst: Object.fromEntries(Object.entries(b.coEst || {}).slice(0, 40).filter(([k]) => /^[0-9]{1,9}$/.test(k)).map(([k, v]) => [k, { daily: Math.round(num(v && v.daily)), staff: [14, 16].includes(Number(v && v.staff)) ? Number(v.staff) : 0, sold: !!(v && v.sold) }])),
        autoRenewed: (Array.isArray(b.autoRenewed) ? b.autoRenewed : []).slice(-80).map(e => ({ id: str(e.id, 12), name: str(e.name, 60), from: date0(e.from), to: date0(e.to), on: date0(e.on) })),
        invRequests: (Array.isArray(b.invRequests) ? b.invRequests : []).slice(-300).map(q => ({ id: str(q.id, 12) || id6(), tornId: String(q.tornId || '').replace(/\D/g, '').slice(0, 10), name: str(q.name, 60), type: ['renew', 'topup', 'withdraw', 'merge'].includes(q.type) ? q.type : 'renew', rowId: str(q.rowId, 12), amount: Math.round(num(q.amount)), days: Number(q.days) === 90 ? 90 : Number(q.days) === 180 ? 180 : 0, createdOn: date(q.createdOn), status: ['open', 'approved', 'declined'].includes(q.status) ? q.status : 'open', resolvedOn: date0(q.resolvedOn), late: !!q.late, termEnd: date0(q.termEnd), note: str(q.note, 120) })),
        loans: (Array.isArray(b.loans) ? b.loans : []).slice(0, 60).map(l => ({ id: str(l.id, 12) || id6(), name: str(l.name, 60) || 'Borrower', lent: Math.round(num(l.lent)), owed: Math.round(num(l.owed)), repaid: Math.round(num(l.repaid)), freq: ['weekly', 'monthly', 'once', 'open'].includes(l.freq) ? l.freq : 'open', payment: Math.round(num(l.payment)), date: date(l.date), from: date(l.from), active: l.active !== false, note: str(l.note, 120) })),
        buddies: (Array.isArray(b.buddies) ? b.buddies : []).slice(0, 80).map(x => ({ id: str(x.id, 12) || id6(), name: str(x.name, 60) || 'Buddy', tornId: String(x.tornId || '').replace(/\D/g, '').slice(0, 10), tier: ['bronze', 'silver', 'gold', ''].includes(x.tier) ? x.tier : '', amount: Math.round(num(x.amount)), term: Math.max(1, Math.min(400, Math.round(num(x.term, 30)))), given: date(x.given), profit: Math.round(num(x.profit)), share: Math.max(0, Math.min(100, num(x.share, 70))), status: x.status === 'returned' ? 'returned' : 'active', note: str(x.note, 120), reinvest: x.reinvest !== false, returnedOn: date0(x.returnedOn), bank: x.bank && typeof x.bank === 'object' ? { amount: Math.round(num(x.bank.amount)), endsAt: Math.round(num(x.bank.endsAt)), at: Math.round(num(x.bank.at)) } : null })),
        roi: (Array.isArray(b.roi) ? b.roi : []).slice(0, 12).map(r => ({ amount: Math.round(num(r.amount)), weekly: Math.round(num(r.weekly)) })).filter(r => r.amount > 0 && r.weekly > 0).sort((a, b) => a.amount - b.amount),
    };
}

// the owner's money right now, read live
async function readCash(key) {
    try {
        const r = await fetch(`https://api.torn.com/user/?selections=money&key=${encodeURIComponent(key)}`);
        const d = await r.json();
        if (d.error) return { error: d.error.error || `Torn error ${d.error.code}` };
        const m = d.money || d;
        return { onHand: num(m.money_onhand ?? m.onhand), vault: num(m.vault_amount ?? m.vault), cityBank: num(m.city_bank?.amount ?? m.cayman_bank ?? 0), points: num(m.points) };
    } catch (e) { return { error: String(e.message || e).slice(0, 100) }; }
}

// what each company sent in the last weeks (a week's Send is only known when the last day of it has a bank amount; imported days have none)
async function companyWeeks(redis, getAllCompanies) {
    const today = R.reportDate(Math.floor(Date.now() / 1000));
    let end = today; for (let i = 0; i < 7 && !R.isSunday(end); i++) end = R.addDays(end, -1); // the latest Sunday on or before the report date
    const out = [];
    for (const co of await getAllCompanies()) {
        const days = await R.loadDays(redis, co.id);
        const weeks = [];
        for (let i = 0; i < 12; i++) {
            const weekEnd = R.addDays(end, -7 * i);
            const w = R.weekly(co, days, weekEnd);
            if (!w.daysCounted) continue;
            const lastDay = Object.keys(days).filter(d => d <= weekEnd).sort().pop();
            weeks.push({ weekEnd, days: w.daysCounted, profit: w.profit, cut: w.cut, investment: w.investment, daily: w.perDay.map(x => ({ date: x.date, profit: Math.round(x.profit) })), send: lastDay && days[lastDay].bank != null && w.daysCounted >= 5 ? w.send : null });
        }
        out.push({ id: co.id, name: co.name, directorName: co.directorName, cutPct: co.cutPct ?? 30, weeks });
    }
    return out;
}

// ---- the investors' own side: what an investor sees of their portfolio, and the requests they can make (renew, add money, withdraw at the end of the term) ----
// An investor is found by their Torn ID, or by their name until the first visit (then the ID is written down, so a changed name does not break the link). They only ever get their own investments.
// A request does nothing by itself: the owner decides (fin-req-resolve). Withdrawing needs 30 days notice before the term ends and the owner must have the money: the Finances page checks that.
const str = (s, n) => String(s || '').trim().slice(0, n);
const norm = s => String(s || '').trim().toLowerCase();
const mine = (d, who) => d.investors.filter(i => (i.tornId ? String(i.tornId) === String(who.playerId) : norm(i.name) === norm(who.name)));
// buddy banking: a buddy is the person on a line of the Buddy banking page, found by Torn ID (by name on the first visit, then the ID is stored)
const mineB = (d, who) => d.buddies.filter(b => (b.tornId ? String(b.tornId) === String(who.playerId) : norm(b.name) === norm(who.name)));
async function isBuddy(redis, who) { try { return mineB(await load(redis), who).length > 0; } catch (e) { return false; } }
// the investor and the buddy flag of the login's access check from ONE read of the record (the login must not cost two reads)
async function finRoles(redis, who) { try { const d = await load(redis); return { investor: mine(d, who).length > 0, buddy: mineB(d, who).length > 0 }; } catch (e) { return { investor: false, buddy: false }; } }
const todayIso = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const NOTICE_DAYS = 30; // the terms: a withdrawal needs 30 days notice before the end date, otherwise the deposit renews on its own for another 180 days
const TERM_DAYS = 180;
// The terms ("Investor Increment Flexibility"): an investor can grow gradually instead of jumping to the next tier. Money is added in steps that depend on the tier the investor is in: Copper 25m, Bronze 50m, Silver 100m, Gold and up 250m; the rate only changes when the next tier is reached.
const topupStep = total => (total < 250000000 ? 25000000 : total < 500000000 ? 50000000 : total < 1000000000 ? 100000000 : 250000000); // by the tier the investor is in: Copper 25m, Bronze 50m, Silver 100m, Gold and up 250m
// the deposits of one person that end on the same day are renewed and withdrawn as ONE amount (a merge makes them share a date); a deposit with another end date stays on its own
const samePerson = (a, b) => (a.tornId && b.tornId ? String(a.tornId) === String(b.tornId) : String(a.name || '').trim().toLowerCase() === String(b.name || '').trim().toLowerCase());
const termGroup = (d, row) => { const g = d.investors.filter(i => i.active && !i.leaving && i.termEnd && i.termEnd === row.termEnd && samePerson(i, row)); return g.length ? g : [row]; };
// A deposit whose end date has passed renews itself for another 180 days (once for every period that passed), unless it is leaving or the investor asked to withdraw in time (a withdrawal request that is not late and still waits for the owner).
// Worked out when the fund or an investor page is read, not by a timer: the changed dates are saved straight away (with the usual backup copy).
function autoRenew(d, today) {
    let n = 0;
    d.investors.forEach(i => {
        if (!i.active || i.leaving || !i.termEnd || i.returnedOn) return;
        // a withdrawal or a renewal that was asked in time and waits for the owner: nothing renews by itself over it
        if (d.invRequests.some(q => { if (q.status !== 'open' || (q.type !== 'withdraw' && q.type !== 'renew') || q.late) return false; const r0 = d.investors.find(x => x.id === q.rowId); return q.rowId === i.id || (!!r0 && r0.termEnd === i.termEnd && samePerson(r0, i)); })) return; // notice was given in time for this deposit or for the amount it is one with
        for (let g = 0; i.termEnd < today && g < 20; g++) { const to = addDays(i.termEnd, TERM_DAYS); (d.autoRenewed = d.autoRenewed || []).push({ id: i.id, name: i.name, from: i.termEnd, to, on: today }); i.renewals = (i.renewals || []).concat({ from: i.termEnd, to, auto: true }).slice(-20); i.termEnd = to; n++; }
    });
    return n;
}
async function loadRenewed(redis) {
    const d = await load(redis), prev = JSON.stringify(d);
    if (autoRenew(d, todayIso())) await writeRecord(redis, clean(d), prev);
    return d;
}
const TERMS_V = '2026-10-14'; // the version of the investment terms shown in terms.js
// what the pay table gives a week for an amount: an exact row, linear per billion above the top row, otherwise scaled from the row below
function roiWeekly(amount, tbl) {
    const t = (tbl || []).slice().sort((a, b) => a.amount - b.amount);
    if (!t.length || !amount) return 0;
    const exact = t.find(r => r.amount === amount); if (exact) return exact.weekly;
    const top = t[t.length - 1]; if (amount > top.amount) return Math.round(amount * top.weekly / top.amount);
    const lower = t.filter(r => r.amount < amount).pop() || t[0];
    return Math.round(lower.weekly * amount / lower.amount);
}
async function isInvestor(redis, who) { try { return mine(await load(redis), who).length > 0; } catch (e) { return false; } }

async function invHandle(action, body, { redis, who }) {
    const d = await loadRenewed(redis), rows = mine(d, who), prev = JSON.stringify(d);
    if (!rows.length) throw new Error('You have no investments in the fund.');
    const today = todayIso();
    const save = () => writeRecord(redis, clean(d), prev);
    if (action === 'inv-request') {
        const row = rows.find(i => i.id === body.rowId);
        if (!row || !row.active) throw new Error('That investment is not active.');
        const type = ['renew', 'topup', 'withdraw', 'merge'].includes(body.type) ? body.type : '';
        if (!type) throw new Error('Unknown request.');
        if (d.invRequests.some(q => q.status === 'open' && q.rowId === row.id && q.type === type && type !== 'topup')) throw new Error('You already have a request like that waiting.');
        const q = { id: id6(), tornId: String(who.playerId), name: row.name, type, rowId: row.id, amount: 0, days: 0, createdOn: today, status: 'open', resolvedOn: '', late: false, termEnd: row.termEnd || '', note: str(body.note, 120) };
        if (type === 'topup') { q.amount = Math.round(num(body.amount)); const step = topupStep(rows.filter(i => i.active).reduce((s, i) => s + i.amount, 0)); if (q.amount < step || q.amount % step) throw new Error(`At your level you add money in steps of ${step / 1000000}m (${step / 1000000}m, ${step / 500000}m, ${step * 1.5 / 1000000}m ...).`); }
        if (type === 'merge') { const act = rows.filter(i => i.active && !i.leaving && i.termEnd); const ends = new Set(act.map(i => i.termEnd)); if (act.length < 2 || ends.size < 2) throw new Error('You have no deposits with different end dates to merge.'); const last = act.slice().sort((a, b) => (a.termEnd < b.termEnd ? 1 : -1))[0]; q.rowId = last.id; q.termEnd = last.termEnd; q.amount = act.reduce((s, i) => s + i.amount, 0); }
        if (type === 'renew') {
            // the terms: an investor can choose to renew for 90 or 180 days if they say so at least 30 days before the end date; after that the deposit renews by itself for 180 days
            if (row.termEnd && daysBetween(today, row.termEnd) < NOTICE_DAYS) throw new Error(`The last ${NOTICE_DAYS} days before the end date have started, so this deposit renews automatically for 180 days.`);
            q.days = Number(body.days) === 90 ? 90 : 180;
        }
        if (type === 'withdraw') { if (!row.termEnd) throw new Error('This investment has no end date yet: ask the fund owner.'); q.amount = termGroup(d, row).reduce((s, i) => s + i.amount, 0); q.late = daysBetween(today, row.termEnd) < NOTICE_DAYS; if (q.late) q.termEnd = addDays(row.termEnd, TERM_DAYS); }
        d.invRequests.push(q);
        await save();
        return { ok: true, request: q };
    }
    if (action === 'inv-terms-accept') { // the investor accepts the terms (the version they saw); the owner sees the date
        d.terms = d.terms || {}; d.terms[String(who.playerId)] = { on: today, v: TERMS_V };
        await save();
        return { ok: true };
    }
    if (action === 'inv-cancel') {
        const q = d.invRequests.find(x => x.id === body.id && String(x.tornId) === String(who.playerId));
        if (!q || q.status !== 'open') throw new Error('That request can not be withdrawn.');
        d.invRequests = d.invRequests.filter(x => x.id !== q.id);
        await save();
        return { ok: true };
    }
    if (action === 'inv-my') {
        const link = rows.filter(i => !i.tornId);
        if (link.length) { link.forEach(i => { i.tornId = String(who.playerId); }); await save(); } // first visit by name: remember the Torn ID
        return {
            name: who.name, today: R.reportDate(Math.floor(Date.now() / 1000)), roi: d.roi, notice: NOTICE_DAYS, terms: (d.terms || {})[String(who.playerId)] || null,
            rows: rows.map(i => ({ id: i.id, amount: i.amount, payout: i.payout, mode: i.mode, start: i.start, termEnd: i.termEnd, returnedOn: i.returnedOn, active: i.active, leaving: !!i.leaving, renewals: i.renewals, paidUntil: i.paidUntil })),
            requests: d.invRequests.filter(q => String(q.tornId) === String(who.playerId)).slice(-30),
        };
    }
    throw new Error('Unknown action');
}

// The owner decides on a request: renew (a new end date), money received (a top-up becomes an investment), approve a withdrawal (the investment leaves at its term end), or decline.
async function resolveRequest(redis, body) {
    const d = await load(redis), prev = JSON.stringify(d), q = d.invRequests.find(x => x.id === body.id);
    if (!q || q.status !== 'open') throw new Error('That request is no longer open.');
    const today = todayIso(), row = d.investors.find(i => i.id === q.rowId), decision = body.decision;
    if (decision === 'decline') { q.status = 'declined'; q.resolvedOn = today; }
    else if (!row) throw new Error('The investment of this request no longer exists.');
    else if (q.type === 'renew' && decision === 'approve') {
        const from = row.termEnd || today, to = addDays(from, q.days || 180); // the new term starts where the old one ends
        termGroup(d, row).forEach(l => { l.renewals = (l.renewals || []).concat({ from: l.termEnd || '', to }).slice(-20); l.termEnd = to; }); // every deposit that ends on the same day is renewed with it
        q.status = 'approved'; q.resolvedOn = today;
    } else if (q.type === 'topup' && decision === 'received') {
        const active = d.investors.filter(i => i.active && (i.tornId ? i.tornId === row.tornId : norm(i.name) === norm(row.name)));
        const before = active.reduce((s, i) => s + (i.payout !== null && i.payout !== undefined ? i.payout : roiWeekly(i.amount, d.roi)), 0);
        const total = active.reduce((s, i) => s + i.amount, 0) + q.amount;
        d.investors.push({ id: id6(), name: row.name, tornId: row.tornId, fundId: row.fundId || '', amount: q.amount, payout: Math.max(0, roiWeekly(total, d.roi) - before), mode: row.mode, start: today, active: true, nettedIn: '', note: 'top-up',
            paidUntil: '', payments: [], termEnd: addDays(today, 180), returnedOn: '', renewals: [], leaving: false, noticeOn: '' });
        q.status = 'approved'; q.resolvedOn = today;
    } else if (q.type === 'merge' && decision === 'approve') {
        const mine = d.investors.filter(i => i.active && !i.leaving && (i.tornId ? i.tornId === row.tornId : norm(i.name) === norm(row.name)));
        const to = mine.reduce((m, i) => (i.termEnd && i.termEnd > m ? i.termEnd : m), row.termEnd || today);
        mine.forEach(i => { if (i.termEnd !== to) { i.renewals = (i.renewals || []).concat({ from: i.termEnd || '', to }).slice(-20); i.termEnd = to; } });
        q.status = 'approved'; q.resolvedOn = today; q.termEnd = to;
    } else if (q.type === 'withdraw' && decision === 'approve') {
        termGroup(d, row).forEach(l => { // every deposit that ends on the same day leaves together
            if (q.late && l.termEnd && q.termEnd && l.termEnd < q.termEnd) { l.renewals = (l.renewals || []).concat({ from: l.termEnd, to: q.termEnd, auto: true }).slice(-20); l.termEnd = q.termEnd; } // less than 30 days notice: this term renews first, the money goes back at the end of the next one
            l.leaving = true; l.noticeOn = q.createdOn;
        });
        q.status = 'approved'; q.resolvedOn = today;
    } else throw new Error('That decision does not fit this request.');
    await writeRecord(redis, clean(d), prev);
    return { ok: true };
}

// "My buddy plan": a buddy sees only their own lines (what was given, the term and due date, the profit estimate and what is sent back) and accepts the buddy banking terms; nothing of the owner's other money.
const BUDDY_TERMS_V = '2026-10-14'; // the version shown in terms.js
async function budHandle(action, body, { redis, who }) {
    const d = await load(redis), rows = mineB(d, who), prev = JSON.stringify(d), pid = String(who.playerId);
    if (!rows.length) throw new Error('You have no buddy banking plan.');
    if (action === 'bud-terms-accept') { d.buddyTerms = d.buddyTerms || {}; d.buddyTerms[pid] = { on: todayIso(), v: BUDDY_TERMS_V }; await writeRecord(redis, clean(d), prev); return { ok: true }; }
    if (action === 'bud-bank') { // asks Torn for this buddy's City Bank with the key of this very request (the key is not kept) and remembers the amount and the end date on their plan, so the owner can see it
        const r = await fetch(`https://api.torn.com/user/?selections=money&key=${encodeURIComponent(body.key)}`), j = await r.json();
        if (j.error) throw new Error(`Torn says: ${j.error.error || `error ${j.error.code}`}`);
        const cb = (j.money || j).city_bank || null, amount = Math.round(num(cb && cb.amount)), left = Math.round(num(cb && cb.time_left)), now = Date.now();
        const bank = { amount, endsAt: amount > 0 && left > 0 ? now + left * 1000 : 0, at: now };
        rows.filter(b => b.status === 'active').forEach(b => { b.bank = bank; });
        await writeRecord(redis, clean(d), prev);
        return { ok: true, bank };
    }
    if (action !== 'bud-my') throw new Error('Unknown action');
    if (rows.some(b => !b.tornId)) { rows.forEach(b => { if (!b.tornId) b.tornId = pid; }); await writeRecord(redis, clean(d), prev); } // first visit by name: remember the Torn ID
    return { name: who.name, today: R.reportDate(Math.floor(Date.now() / 1000)), terms: (d.buddyTerms || {})[pid] || null,
        rows: rows.map(b => ({ id: b.id, tier: b.tier, amount: b.amount, term: b.term, given: b.given, share: b.share, profit: b.profit, status: b.status, returnedOn: b.returnedOn, bank: b.bank || null })) };
}

// A new deposit from a "join Labs" request (the owner pressed Money received): a new investor gets the next fund ID, someone who invests already keeps their ID and pay plan and the extra payout is the difference the pay table makes (the same as a top-up).
async function addInvestorLine(redis, { tornId, name, amount, mode }) {
    const d = await load(redis), prev = JSON.stringify(d), today = todayIso();
    const same = d.investors.filter(i => (i.tornId ? String(i.tornId) === String(tornId) : norm(i.name) === norm(name))), active = same.filter(i => i.active), first = same[0];
    const before = active.reduce((s, i) => s + (i.payout !== null && i.payout !== undefined ? i.payout : roiWeekly(i.amount, d.roi)), 0);
    const total = active.reduce((s, i) => s + i.amount, 0) + amount;
    d.investors.push({ id: id6(), name, tornId: String(tornId), fundId: first ? first.fundId : String(Math.max(0, ...d.investors.map(i => parseInt(i.fundId, 10) || 0)) + 1), amount, payout: active.length ? Math.max(0, roiWeekly(total, d.roi) - before) : null,
        mode: first ? first.mode : (mode === 'weekly' ? 'weekly' : 'monthly'), start: today, active: true, nettedIn: '', note: 'join request', paidUntil: '', payments: [], termEnd: addDays(today, TERM_DAYS), returnedOn: '', renewals: [], leaving: false, noticeOn: '' });
    await writeRecord(redis, clean(d), prev);
}

// The owner's To do (the dashboard card and the script): one line for the investor requests that are waiting (renew, add money, withdraw, merge)
async function fundRequestTodos(redis) {
    const d = await loadRenewed(redis), out = [];
    const money = n => `$${Math.round(n).toLocaleString('en-US')}`, day = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const open = d.invRequests.filter(q => q.status === 'open');
    const say = q => q.type === 'withdraw' ? `${q.name} wants ${money(q.amount)} back on ${day(q.termEnd)}` : q.type === 'topup' ? `${q.name} adds ${money(q.amount)}` : q.type === 'merge' ? `${q.name}: merge deposits` : `${q.name}: renew`;
    if (open.length) out.push({ id: 'fund-requests', svc: true, n: open.length, text: `${open.length} investor request${open.length === 1 ? '' : 's'}: ${open.slice(0, 4).map(say).join('; ')}${open.length > 4 ? ` and ${open.length - 4} more` : ''}`, cta: 'Open Investment fund', page: 'fund', anchor: 'fund-requests' });
    // money that is going back (asked in time and approved, or marked as leaving by hand), until it is marked as returned: to plan the other investments around
    const leaving = d.investors.filter(i => i.active && i.leaving && !i.returnedOn && i.termEnd).sort((a, b) => (a.termEnd < b.termEnd ? -1 : 1));
    const lg = {}; leaving.forEach(i => { const k = `${i.tornId || String(i.name).trim().toLowerCase()}|${i.termEnd}`; (lg[k] = lg[k] || { name: i.name, amount: 0, termEnd: i.termEnd }).amount += i.amount; }); // deposits that end on the same day count as one amount
    const lgl = Object.values(lg);
    if (lgl.length) out.push({ id: 'fund-withdrawals', svc: true, text: `Money going back to investors: ${lgl.slice(0, 6).map(i => `${i.name} ${money(i.amount)} on ${day(i.termEnd)}`).join('; ')}${lgl.length > 6 ? ` and ${lgl.length - 6} more` : ''}`, cta: 'Open Investment fund', page: 'fund', anchor: 'fund-requests' });
    const recent = (d.autoRenewed || []).filter(e => e.on >= addDays(todayIso(), -14)), names = [...new Set(recent.map(e => e.name))]; // renewed by themselves because no notice was given: check that nobody had actually left
    if (names.length) out.push({ id: 'fund-autorenew', svc: true, text: `${names.length} investor${names.length === 1 ? '' : 's'} renewed automatically for 180 days (no notice was given): ${names.slice(0, 6).join(', ')}${names.length > 6 ? ` and ${names.length - 6} more` : ''}. If someone had left, press They are leaving on the Investment fund page.`, cta: 'Open Investment fund', page: 'fund', anchor: 'fund-autorenew' });
    return out;
}

async function finHandle(action, body, { redis, key, getAllCompanies, getRto }) {
    if (action === 'fin-get' && body.light) { // the investment fund and buddy banking pages: no cash, no company weeks, no rent-to-own (a few Redis commands, not dozens)
        const d = await loadRenewed(redis);
        return { ...d, cash: null, companies: (await getAllCompanies()).map(c => ({ id: c.id, name: c.name, cutPct: c.cutPct ?? 30, weeks: [] })), rto: null, today: R.reportDate(Math.floor(Date.now() / 1000)) };
    }
    if (action === 'fin-get') {
        const d = await loadRenewed(redis);
        const [cash, cw] = await Promise.all([readCash(key), companyWeeks(redis, getAllCompanies)]);
        return { ...d, cash, companies: cw, rto: await getRto(), today: R.reportDate(Math.floor(Date.now() / 1000)) };
    }
    if (action === 'fin-bak-list') { const keys = (await redis(['KEYS', `${KEY}:bak:*`])) || []; return { stamps: keys.map(k => k.slice(KEY.length + 5)).sort().reverse() }; }
    if (action === 'fin-bak-restore') { // put investors that are missing back from an earlier copy (nothing that exists now is changed)
        const raw = await redis(['GET', `${KEY}:bak:${String(body.stamp || '').replace(/[^0-9T-]/g, '')}`]);
        if (!raw) throw new Error('That backup is gone.');
        const old = JSON.parse(raw), cur = await load(redis), prev = JSON.stringify(cur), have = new Set(cur.investors.map(i => i.id));
        const back = (old.investors || []).filter(i => i && !have.has(i.id));
        cur.investors = cur.investors.concat(back);
        await writeRecord(redis, clean(cur), prev);
        return { ok: true, restored: back.length, names: [...new Set(back.map(i => i.name))].slice(0, 20) };
    }
    if (action === 'fin-req-resolve') return resolveRequest(redis, body);
    if (action === 'fin-autorenew-undo') { // a deposit that was renewed by itself but whose investor had left: it is marked as leaving at the end date it had, so it is not renewed again
        const d = await load(redis), prev = JSON.stringify(d), row = d.investors.find(i => i.id === body.rowId);
        if (!row) throw new Error('That deposit no longer exists.');
        const log = (d.autoRenewed || []).filter(e => e.id === row.id).sort((a, b) => (a.from < b.from ? -1 : 1));
        if (!log.length) throw new Error('That deposit was not renewed automatically.');
        const first = log[0];
        row.termEnd = first.from; row.leaving = true; row.noticeOn = row.noticeOn || first.from;
        row.renewals = (row.renewals || []).filter(r => !(r.auto && r.from >= first.from));
        d.autoRenewed = (d.autoRenewed || []).filter(e => e.id !== row.id);
        await writeRecord(redis, clean(d), prev);
        return { ok: true };
    }
    if (action === 'fin-part-save') { // the investment fund and buddy banking pages save only their own lists, so they can never overwrite the rest
        const cur = await load(redis), parts = body.parts || {}, next = { ...cur };
        for (const k of ['investors', 'buddies', 'roi']) if (Array.isArray(parts[k])) next[k] = parts[k];
        if (typeof parts.paidOffset === 'number') next.paidOffset = parts.paidOffset;
        const d = clean(next), prev = JSON.stringify(cur);
        await writeRecord(redis, d, prev);
        return { ok: true };
    }
    if (action === 'fin-save') {
        const cur = await load(redis), data = { ...(body.data || {}) }; // the Finances page does not send the lists of the investment fund and buddy banking pages: those stay as they are
        for (const k of ['investors', 'buddies', 'roi', 'invRequests']) if (!Array.isArray(data[k])) data[k] = cur[k];
        if (data.paidOffset === undefined) data.paidOffset = cur.paidOffset;
        if (data.terms === undefined) data.terms = cur.terms;
        const d = clean(data), prev = JSON.stringify(cur);
        await writeRecord(redis, d, prev);
        return { ok: true, data: d };
    }
    throw new Error('Unknown action');
}

module.exports = { finHandle, invHandle, isInvestor, isBuddy, finRoles, budHandle, fundRequestTodos, addInvestorLine, loadFinances: load, DEFAULT_ROI };
