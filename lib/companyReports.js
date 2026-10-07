// lib/companyReports.js — what a company's director gets every day and every week, and the daily numbers that make a history (like TornStats) possible,
// because Torn only ever shows the CURRENT numbers. A director switches on "daily saving" once on their company page (their key is kept encrypted, like
// nightly saving for a faction); a scheduled job then runs after the company tick (Sunday 18:00-18:10 TCT, all days alike) and:
//   1. saves the day's numbers (income, customers, wages, ad budget, bank, popularity, efficiency, employees, stock),
//   2. posts the DAILY report to the company's own Discord channel (stock, addiction, rehab, who has been away),
//   3. on Sunday also posts the WEEKLY financials: the week is Monday-Sunday by report date, so the Sunday tick is in the week it ends.
// It posts at most once per company per day (lastPosted), so a late or repeated run can never double-post.
//
//   wwl:company-vault       -> hash: companyId -> JSON { enc, playerId, name, since, lastRun, lastOk, lastError, lastPosted }
//   wwl:company-days:{id}   -> hash: 'YYYY-MM-DD' (TCT date of the report) -> JSON snapshot; the newest 90 days are kept
//
// Weekly maths (as the old report did, see the owner's example):
//   Weekly Profit  = the sum over the days counted of (daily income - wages for a day - advertising for a day - the cost of the stock sold): confirmed against the old bot and TornStats
//   Director Cut   = cut % of the Weekly Profit
//   Keep wage/ads  = a day's wages / ad budget x 7 (next week's)
//   Send to owner  = Bank - Total to keep - Director Cut - Investment amount   (negative: the owner sends the difference instead)

const { encrypt, decrypt } = require('./nightly');

const VAULT = 'wwl:company-vault';
const daysKey = id => `wwl:company-days:${id}`;
const KEEP_DAYS = 90;
const DAY = 86400;

const tctDate = ts => new Date(ts * 1000).toISOString().slice(0, 10);
const reportDate = ts => tctDate(ts - 18 * 3600 - 10 * 60); // the date a reading belongs to: from 18:10 TCT it is today's, before that it is still yesterday's tick
const addDays = (iso, n) => tctDate(Date.parse(`${iso}T00:00:00Z`) / 1000 + n * DAY);
const isSunday = iso => new Date(`${iso}T00:00:00Z`).getUTCDay() === 0;

// $173.08M style, as in the old report
function money(n) {
    if (n == null || !Number.isFinite(n)) return '—';
    const sign = n < 0 ? '-' : '';
    const a = Math.abs(n);
    if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
    return `${sign}$${Math.round(a).toLocaleString('en-US')}`;
}

// What is stored for one day. Richer than the reports need on purpose: a history can not be filled in afterwards, so everything a TornStats-style view could
// want later (per-employee stats and effectiveness over time, per-product sales and prices, popularity, efficiency, environment, customers) is kept from day one.
function snapshotOf(d) {
    return {
        income: d.dailyIncome, weeklyIncome: d.weeklyIncome, customers: d.dailyCustomers, weeklyCustomers: d.weeklyCustomers, wages: d.wagesPerDay, ads: d.advertising,
        bank: d.bank ?? d.funds, funds: d.funds, stockCost: d.stock.reduce((s, x) => s + (x.cost || 0) * (x.sold || 0), 0), popularity: d.popularity, efficiency: d.efficiency, environment: d.environment, rating: d.rating, trains: d.trains, hired: d.hired, capacity: d.capacity,
        addiction: Object.fromEntries(d.employees.filter(e => e.addiction != null).map(e => [e.id, e.addiction])),
        emps: d.employees.map(e => [e.id, e.name, e.position, e.days, e.wage, e.manual, e.intelligence, e.endurance, e.effectiveness, e.addiction, e.lastTs, e.effAll]), // id, name, position, days, wage, manual, intelligence, endurance, effectiveness, addiction, last seen, the whole effectiveness breakdown (Torn's own names)
        stock: d.stock.map(s => ({ name: s.name, inStock: s.inStock, onOrder: s.onOrder, sold: s.sold, soldWorth: s.soldWorth, price: s.price, cost: s.cost, rrp: s.rrp })),
    };
}
async function loadDays(redis, id) {
    const flat = (await redis(['HGETALL', daysKey(id)])) || [];
    const out = {};
    for (let i = 0; i < flat.length; i += 2) { try { out[flat[i]] = JSON.parse(flat[i + 1]); } catch (e) { /* skip */ } }
    return out;
}
async function saveDay(redis, id, date, snap) {
    await redis(['HSET', daysKey(id), date, JSON.stringify(snap)]);
    const all = Object.keys(await loadDays(redis, id)).sort();
    if (all.length > KEEP_DAYS) await redis(['HDEL', daysKey(id), ...all.slice(0, all.length - KEEP_DAYS)]);
}

// The week that ends on `weekEnd` (a Sunday date) or, mid-week, the week so far: Monday..weekEnd by report date.
function weekly(co, days, weekEnd) {
    const dates = [];
    for (let i = 6; i >= 0; i--) { const d = addDays(weekEnd, -i); if (days[d]) dates.push(d); }
    const perDay = dates.map(d => { const s = days[d]; const profit = (s.income || 0) - (s.wages || 0) - (s.ads || 0) - (s.stockCost || 0); return { date: d, income: s.income, wages: s.wages, ads: s.ads, stockCost: s.stockCost || 0, profit }; });
    const profit = perDay.reduce((s, x) => s + x.profit, 0);
    const last = days[dates[dates.length - 1]] || {};
    const cut = Math.max(0, profit) * ((co.cutPct ?? 30) / 100);
    const keepWage = (last.wages || 0) * 7, keepAds = (last.ads || 0) * 7, keep = keepWage + keepAds;
    const investment = co.investment || 0;
    const send = (last.bank || 0) - keep - cut - investment;
    return { daysCounted: dates.length, perDay, profit, cut, investment, bank: last.bank, wagesDay: last.wages, adsDay: last.ads, keepWage, keepAds, keep, send };
}

// ---- Discord texts (embeds), the same shape as the old bot's ----
function dailyEmbed(co, d, prev) {
    const now = Math.floor(Date.now() / 1000);
    const stock = d.stock.length ? d.stock.map(s => `${s.name}: ${s.inStock ?? '?'} in stock, ${s.sold ?? '?'} sold, ${money(s.soldWorth)} worth`).join('\n') : 'None';
    const addicted = d.employees.filter(e => e.addiction != null && Math.abs(e.addiction) >= 12).map(e => `${e.name} (${e.addiction})`);
    // rehab: an employee whose addiction clearly improved since yesterday's reading (Torn does not report rehab itself)
    const rehab = prev ? d.employees.filter(e => e.addiction != null && prev.addiction && prev.addiction[e.id] != null && e.addiction - prev.addiction[e.id] >= 5).map(e => e.name) : [];
    const away = e => `${e.name} — last seen ${Math.floor((now - e.lastTs) / DAY)}d ago`;
    const day = d.employees.filter(e => e.lastTs && now - e.lastTs >= DAY && now - e.lastTs < 2 * DAY).map(away);
    const long = d.employees.filter(e => e.lastTs && now - e.lastTs >= 2 * DAY).map(away);
    const list = a => a.length ? a.join('\n') : 'None';
    return { title: `${co.name} — Company Summary`, color: 0x35d99b, fields: [
        { name: 'Stock', value: stock.slice(0, 1000) }, { name: 'Addiction (12<)', value: list(addicted).slice(0, 1000) }, { name: 'Rehab last 24hrs', value: list(rehab).slice(0, 1000) },
        { name: 'Inactive (24–48h)', value: list(day).slice(0, 1000) }, { name: 'Inactive (>48h)', value: list(long).slice(0, 1000) },
    ] };
}
function weeklyEmbed(co, w, ownerName) {
    const sendLine = w.send >= 0 ? `**Send to ${ownerName || 'the owner'}: ${money(w.send)}**` : `**${ownerName || 'The owner'} sends you: ${money(-w.send)}**`;
    return { title: `${co.name} — Weekly Financials`, color: 0xF0B432, description: [
        `Days counted: ${w.daysCounted}`, '', '**Totals**', `Weekly Profit: ${money(w.profit)}`, `Director Cut: ${money(w.cut)}`, `Investment amount: ${money(w.investment)}`, sendLine, '',
        '**Bank**', `Bank Amount: ${money(w.bank)}`, `Keep wage: ${money(w.wagesDay)} → ${money(w.keepWage)}`, `Keep ads: ${money(w.adsDay)} → ${money(w.keepAds)}`, `Total to keep: ${money(w.keep)}`,
    ].join('\n') };
}

// ---- the scheduled job ----
async function runCompanyReports({ redis, tornCompany, normalize, getAllCompanies, getPoster, force = false, onlyId = null }) {
    const now = Math.floor(Date.now() / 1000);
    const today = reportDate(now);
    const results = [];
    const flat = (await redis(['HGETALL', VAULT])) || [];
    const companies = Object.fromEntries((await getAllCompanies()).map(c => [String(c.id), c]));
    for (let i = 0; i < flat.length; i += 2) {
        const id = flat[i];
        if (onlyId && String(onlyId) !== id) continue;
        let entry; try { entry = JSON.parse(flat[i + 1]); } catch (e) { continue; }
        const co = companies[id];
        if (!co) continue; // no longer registered
        try {
            // only after the company tick (18:00-18:10 TCT): an earlier run would save the day before's numbers
            const afterTick = now % DAY >= 18 * 3600 + 20 * 60;
            if (!force && (!afterTick || entry.lastPosted === today)) { results.push({ id, skipped: afterTick ? 'already posted today' : 'before the tick' }); continue; }
            const d = normalize(await tornCompany(decrypt(entry.enc)));
            const prevDates = Object.keys(await loadDays(redis, id)).filter(x => x < today).sort();
            const prev = prevDates.length ? (await loadDays(redis, id))[prevDates[prevDates.length - 1]] : null;
            await saveDay(redis, id, today, snapshotOf(d));
            const poster = await getPoster(id);
            let posted = false;
            if (poster && !poster.error) {
                const r = await poster.post('', [], [dailyEmbed(co, d, prev)]);
                posted = r.ok;
                if (isSunday(today)) {
                    const days = await loadDays(redis, id);
                    await poster.post('', [], [weeklyEmbed(co, weekly(co, days, today), co.ownerName)]);
                }
            }
            entry.lastRun = now; entry.lastOk = true; entry.lastError = null; if (posted || !poster) entry.lastPosted = today;
            results.push({ id, ok: true, posted });
        } catch (e) {
            entry.lastRun = now; entry.lastOk = false; entry.lastError = String(e.message || e).slice(0, 120);
            results.push({ id, ok: false, error: entry.lastError });
        }
        await redis(['HSET', VAULT, id, JSON.stringify(entry)]);
    }
    return results;
}

module.exports = { runCompanyReports, weekly, loadDays, snapshotOf, saveDay, tctDate, reportDate, addDays, isSunday, money, dailyEmbed, weeklyEmbed, VAULT, encrypt, decrypt };
