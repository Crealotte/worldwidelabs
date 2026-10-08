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
//                          loans: [{ id, name, lent, owed (0 = same as lent), repaid, freq: weekly | monthly | once | open, payment, date (lent on), from (first payment), active, note }],
//                          ventures: [{ id, name, type, capital, weekly, note, active }], capitals: { 'co:{companyId}': capital, 'pi:{4100|3600|2600}': capital per island } }
// The owner's ROI table (investor payout a week, paid on Sundays; a monthly investor is paid the grouped weeks on the last Sunday of the month): 250m -> 1,442,000,
// 500m -> 3,125,000, and from 1b 6,731,000 for every billion (so 10b -> 67,310,000). At most 35% a year.

const R = require('./companyReports');

const KEY = 'wwl:finances';
const DEFAULT_ROI = [{ amount: 250000000, weekly: 1442000 }, { amount: 500000000, weekly: 3125000 }, { amount: 1000000000, weekly: 6731000 }];
const num = (v, d = 0) => { const n = Number(String(v ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) && String(v ?? '') !== '' ? n : d; };
const id6 = () => Math.random().toString(36).slice(2, 8);

async function load(redis) {
    try { const raw = await redis(['GET', KEY]); const d = raw ? JSON.parse(raw) : {}; return { fundsMode: d.fundsMode === 'manual' ? 'manual' : 'auto', fundsManual: num(d.fundsManual), reserve: num(d.reserve), investors: d.investors || [], income: d.income || [], outlays: d.outlays || [], plans: d.plans || [], roi: d.roi && d.roi.length ? d.roi : DEFAULT_ROI, ventures: d.ventures || [], capitals: d.capitals || {}, loans: d.loans || [], buddies: d.buddies || [] }; }
    catch (e) { return { fundsMode: 'auto', fundsManual: 0, reserve: 0, investors: [], income: [], outlays: [], plans: [], roi: DEFAULT_ROI, ventures: [], capitals: {}, loans: [], buddies: [] }; }
}

function clean(b) {
    const date = s => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : new Date().toISOString().slice(0, 10));
    const date0 = s => (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s || '') ? s : ''); // a date that may stay empty
    const str = (s, n) => String(s || '').trim().slice(0, n);
    return {
        fundsMode: b.fundsMode === 'manual' ? 'manual' : 'auto', fundsManual: Math.round(num(b.fundsManual)), reserve: Math.round(num(b.reserve)),
        investors: (Array.isArray(b.investors) ? b.investors : []).slice(0, 80).map(i => ({ id: str(i.id, 12) || id6(), name: str(i.name, 60) || 'Investor', amount: Math.round(num(i.amount)), payout: i.payout === null || i.payout === '' || i.payout === undefined ? null : Math.round(num(i.payout)), mode: i.mode === 'monthly' ? 'monthly' : 'weekly', start: date(i.start), active: i.active !== false, nettedIn: str(i.nettedIn, 12), note: str(i.note, 120), tornId: String(i.tornId || '').replace(/D/g, '').slice(0, 10), paidUntil: date0(i.paidUntil), payments: (Array.isArray(i.payments) ? i.payments : []).slice(-100).map(p => ({ date: date(p.date), amount: Math.round(num(p.amount)), through: date0(p.through) })) })),
        income: (Array.isArray(b.income) ? b.income : []).slice(0, 60).map(i => ({ id: str(i.id, 12) || id6(), name: str(i.name, 60) || 'Income', amount: Math.round(num(i.amount)), freq: ['weekly', 'monthly', 'once'].includes(i.freq) ? i.freq : 'weekly', date: date(i.date), active: i.active !== false })),
        outlays: (Array.isArray(b.outlays) ? b.outlays : []).slice(0, 60).map(o => ({ id: str(o.id, 12) || id6(), name: str(o.name, 60) || 'Planned', amount: Math.round(num(o.amount)), date: date(o.date) })),
        plans: (Array.isArray(b.plans) ? b.plans : []).slice(0, 12).map(p => ({ id: str(p.id, 12) || id6(), name: str(p.name, 60) || 'Plan', steps: (Array.isArray(p.steps) ? p.steps : []).slice(0, 12).map(s => ({ label: str(s.label, 60), amount: Math.round(num(s.amount)), afterWeeks: Math.max(0, Math.round(num(s.afterWeeks))) })) })),
        ventures: (Array.isArray(b.ventures) ? b.ventures : []).slice(0, 40).map(v => ({ id: str(v.id, 12) || id6(), name: str(v.name, 60) || 'Venture', type: str(v.type, 30), capital: Math.round(num(v.capital)), weekly: Math.round(num(v.weekly)), note: str(v.note, 120), active: v.active !== false })),
        capitals: Object.fromEntries(Object.entries(b.capitals || {}).slice(0, 40).filter(([k]) => /^(co:[0-9]{1,9}|pi:(4100|3600|2600))$/.test(k)).map(([k, v]) => [k, Math.round(num(v))])),
        loans: (Array.isArray(b.loans) ? b.loans : []).slice(0, 60).map(l => ({ id: str(l.id, 12) || id6(), name: str(l.name, 60) || 'Borrower', lent: Math.round(num(l.lent)), owed: Math.round(num(l.owed)), repaid: Math.round(num(l.repaid)), freq: ['weekly', 'monthly', 'once', 'open'].includes(l.freq) ? l.freq : 'open', payment: Math.round(num(l.payment)), date: date(l.date), from: date(l.from), active: l.active !== false, note: str(l.note, 120) })),
        buddies: (Array.isArray(b.buddies) ? b.buddies : []).slice(0, 80).map(x => ({ id: str(x.id, 12) || id6(), name: str(x.name, 60) || 'Buddy', tornId: String(x.tornId || '').replace(/\D/g, '').slice(0, 10), tier: ['bronze', 'silver', 'gold', ''].includes(x.tier) ? x.tier : '', amount: Math.round(num(x.amount)), term: Math.max(1, Math.min(400, Math.round(num(x.term, 30)))), given: date(x.given), profit: Math.round(num(x.profit)), share: Math.max(0, Math.min(100, num(x.share, 70))), status: x.status === 'returned' ? 'returned' : 'active', note: str(x.note, 120), returnedOn: date0(x.returnedOn) })),
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
            weeks.push({ weekEnd, days: w.daysCounted, profit: w.profit, cut: w.cut, investment: w.investment, send: lastDay && days[lastDay].bank != null && w.daysCounted >= 5 ? w.send : null });
        }
        out.push({ id: co.id, name: co.name, directorName: co.directorName, weeks });
    }
    return out;
}

async function finHandle(action, body, { redis, key, getAllCompanies, getRto }) {
    if (action === 'fin-get' && body.light) { // the investment fund and buddy banking pages: no cash, no company weeks, no rent-to-own (a few Redis commands, not dozens)
        const d = await load(redis);
        return { ...d, cash: null, companies: (await getAllCompanies()).map(c => ({ id: c.id, name: c.name, weeks: [] })), rto: null, today: R.reportDate(Math.floor(Date.now() / 1000)) };
    }
    if (action === 'fin-get') {
        const d = await load(redis);
        const [cash, cw] = await Promise.all([readCash(key), companyWeeks(redis, getAllCompanies)]);
        return { ...d, cash, companies: cw, rto: await getRto(), today: R.reportDate(Math.floor(Date.now() / 1000)) };
    }
    if (action === 'fin-part-save') { // the investment fund and buddy banking pages save only their own lists, so they can never overwrite the rest
        const cur = await load(redis), parts = body.parts || {}, next = { ...cur };
        for (const k of ['investors', 'buddies', 'roi']) if (Array.isArray(parts[k])) next[k] = parts[k];
        const d = clean(next);
        await redis(['SET', KEY, JSON.stringify(d)]);
        return { ok: true };
    }
    if (action === 'fin-save') {
        const cur = await load(redis), data = { ...(body.data || {}) }; // the Finances page does not send the lists of the investment fund and buddy banking pages: those stay as they are
        for (const k of ['investors', 'buddies', 'roi']) if (!Array.isArray(data[k])) data[k] = cur[k];
        const d = clean(data);
        await redis(['SET', KEY, JSON.stringify(d)]);
        return { ok: true, data: d };
    }
    throw new Error('Unknown action');
}

module.exports = { finHandle, DEFAULT_ROI };
