// lib/labstracking.js — Labstracking inside WWL (owner only): the owner's Private Islands (PIs) read from Torn, and the rent-to-own (RTO) contracts on them.
// It used to be a separate page (labstracking.vercel.app) that kept its data in one browser; here it lives on the server, so it works from anywhere and the
// script can read it. The Torn side is the same as before: user/properties with the owner's own key; an island's base happy is worked out from its upgrades
// (yacht = 4100, superior interior = 3600, otherwise 2600).
//
//   wwl:labstracking -> JSON { rtoItems: [{ id, clientName, tierName, originalHappy, propertyId, tenantId, startDate, cycleEquity, monthlyRent, totalEquityNeeded, manualEquityPaid }],
//                              pis: [{ id, propertyName, originalHappy, tierName, currentHappyWithStaff, isLivingHere, isRented, tenantID, daysLeft, status }], syncedAt }

const KEY = 'wwl:labstracking';
// the goal an island is bought off at, and the monthly rent per tier (from the owner's rental terms: 290k / 410k / 820k a day); both can be changed per contract
const DEFAULT_GOALS = { 4100: 1701000000, 3600: 855000000, 2600: 612000000 }; // the full price of an island (the finish line of the equity)
const DEFAULT_RENT = { 4100: 27000000, 3600: 15000000, 2600: 12000000 }; // rent a month = the owner's profit
const DEFAULT_EQUITY = { 4100: 81000000, 3600: 45000000, 2600: 36000000 }; // equity a month, paid towards the full price
const DEFAULT_COST = { 4100: 1482500000, 3600: 757500000, 2600: 557500000 }; // what the owner pays for an island

const num = (v, d = 0) => { const n = Number(String(v ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) && String(v ?? '') !== '' ? n : d; };
const newId = () => `rto_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

async function load(redis) {
    try { const raw = await redis(['GET', KEY]); const d = raw ? JSON.parse(raw) : {}; return { rtoItems: Array.isArray(d.rtoItems) ? d.rtoItems : [], pis: Array.isArray(d.pis) ? d.pis : [], syncedAt: d.syncedAt || null, terms: d.terms && typeof d.terms === 'object' ? d.terms : {} }; }
    catch (e) { return { rtoItems: [], pis: [], syncedAt: null, terms: {} }; }
}
const save = (redis, d) => redis(['SET', KEY, JSON.stringify(d)]);

// ---- payments: every lease the tenant accepted and paid is recorded (by the "Paid" click in the script or on the page); equity paid = opening + the equity of the payments ----
//   item.payments: [{ id, date, rent, equity }], item.opening (equity paid before the first recorded payment), item.offeredOn (date of "I offered the lease", cleared by a payment)
const todayIso = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const calendarCycles = (it, on) => Math.max(1, Math.floor(Math.max(0, daysBetween(it.startDate, on)) / 30) + 1); // one 30-day cycle is paid at the start, a new one every 30 days
const hasRecord = it => (it.payments && it.payments.length) || Number(it.opening) > 0;
const equityPaid = it => (Number(it.opening) || 0) + (it.payments || []).reduce((s, p) => s + (Number(p.equity) || 0), 0);
function paidSoFar(it) {
    if (hasRecord(it)) return equityPaid(it);
    if (it.manualEquityPaid !== null && it.manualEquityPaid !== undefined) return Number(it.manualEquityPaid);
    return calendarCycles(it, todayIso()) * (Number(it.cycleEquity) || 0);
}
function nextDue(it) {
    const pays = it.payments || [];
    if (pays.length) return addDays(pays.map(p => p.date).sort().pop(), 30);
    return addDays(it.startDate, 30 * calendarCycles(it, todayIso()));
}
// The islands as Torn has them right now (the lease days left are Torn's own, not worked out from the contract dates: a tenant who goes inactive can delay a renewal).
// Read with the owner's own key; remembered for 5 minutes so the script's To do refreshes do not each call Torn.
let piCache = { at: 0, key: '', pis: null };
async function livePIs(key) {
    if (piCache.pis && piCache.key === key && Date.now() - piCache.at < 5 * 60000) return piCache.pis;
    try { const pis = await fetchPIs(key); piCache = { at: Date.now(), key, pis }; return pis; } catch (e) { return piCache.key === key ? piCache.pis : null; }
}
// The island of a contract: by property id, else by the tenant.
const piOf = (it, pis) => (pis || []).find(p => (it.propertyId && String(p.id) === String(it.propertyId)) || (it.tenantId && p.tenantID && String(p.tenantID) === String(it.tenantId)));
// The owner's To do lines in the script: a lease with 5 days or less left on Torn (or ended). status 'offered' = she offered it and waits for the tenant; it stays until she presses Paid, so the payment is recorded.
async function leaseTodos(redis, key) {
    const d = await load(redis), pis = await livePIs(key), out = [];
    for (const it of d.rtoItems) {
        if (!it.tenantId && !it.propertyId) continue;
        if (it.totalEquityNeeded && paidSoFar(it) >= it.totalEquityNeeded) continue; // fully paid: the tenant owns it
        const pi = piOf(it, pis), offered = !!it.offeredOn;
        // Torn's own days left; an island without a tenant means the lease ended; without any Torn data the contract dates are the fallback
        const ended = !!pi && !pi.isRented, left = pi ? (pi.isRented ? Number(pi.daysLeft) : -1) : daysBetween(todayIso(), nextDue(it));
        if (!ended && left > 5 && !offered) continue;
        const amount = (Number(it.monthlyRent) || 0) + (Number(it.cycleEquity) || 0), money = `$${amount.toLocaleString('en-US')}`;
        const when = ended ? 'has ended' : left <= 0 ? 'ends today' : `ends in ${left} day${left === 1 ? '' : 's'}`;
        const text = offered ? (!ended && left > 5 ? `${it.clientName}: the lease now has ${left} days left. Press Paid to record the payment` : `${it.clientName}: lease offered, waiting for them to accept and pay ${money}`)
            : `${it.clientName}: lease ${when}${pi ? '' : ' (by the contract dates)'}. Offer ${money}`;
        out.push({ id: `lease-${it.id}`, svc: true, waiting: offered, page: 'labstracking', cta: 'Open Rent-to-own', text, lease: { id: it.id, amount, status: offered ? 'offered' : 'due', daysLeft: left } }); // waiting = the lease was offered and the tenant has to pay: nothing for the owner to do yet
    }
    return out;
}

// The owner's Private Islands, from Torn.
async function fetchPIs(key) {
    const r = await fetch(`https://api.torn.com/user/?selections=properties,profile&key=${encodeURIComponent(key)}`);
    const data = await r.json();
    if (data.error) throw new Error(data.error.error || `Torn error ${data.error.code}`);
    const myId = data.player_id, residenceId = data.property_id, properties = data.properties || {};
    const out = [];
    for (const [id, prop] of Object.entries(properties)) {
        const isPI = prop.property === 'Private Island' || prop.property_type === 13;
        if (!isPI || prop.owner_id != myId) continue;
        const up = prop.upgrades || prop.modifications || {};
        let superior = false, yacht = false;
        if (up && typeof up === 'object' && !Array.isArray(up)) { superior = Number(up.interior) === 2 || Number(up['9']) > 0; yacht = Number(up.yacht) > 0 || Number(up['10']) > 0; }
        else if (Array.isArray(up)) { superior = up.includes(9) || up.includes('9'); yacht = up.includes(10) || up.includes('10'); }
        const base = yacht ? 4100 : superior ? 3600 : 2600;
        const living = id == residenceId;
        out.push({
            id, propertyName: `PI #${id}`, originalHappy: base,
            tierName: yacht ? '4100 Base (Superior + Yacht)' : superior ? '3600 Base (Superior Interior)' : '2600 Base',
            currentHappyWithStaff: prop.happy || base, isLivingHere: living, isRented: !!prop.rented,
            tenantID: prop.rented ? prop.rented.user_id : null, daysLeft: prop.rented ? prop.rented.days_left : 0,
            status: living ? 'Personal Residence' : prop.rented ? 'Rented Out' : 'Available',
        });
    }
    return out;
}

function cleanItem(b, old) {
    const tier = [4100, 3600, 2600].includes(Number(b.originalHappy)) ? Number(b.originalHappy) : (old ? old.originalHappy : 4100);
    const manual = b.manualEquityPaid === null || b.manualEquityPaid === undefined || String(b.manualEquityPaid).trim() === '' ? null : num(b.manualEquityPaid);
    const item = {
        id: old ? old.id : newId(),
        clientName: String(b.clientName || (old && old.clientName) || 'Client').trim().slice(0, 60),
        tierName: `${tier} Happy PI`, originalHappy: tier,
        propertyId: b.propertyId ? String(b.propertyId).replace(/\D/g, '') || null : null,
        tenantId: b.tenantId ? String(b.tenantId).replace(/\D/g, '') || null : null,
        startDate: /^\d{4}-\d{2}-\d{2}$/.test(b.startDate || '') ? b.startDate : (old ? old.startDate : new Date().toISOString().slice(0, 10)),
        cycleEquity: Math.round(num(b.cycleEquity, DEFAULT_EQUITY[tier])), monthlyRent: Math.round(num(b.monthlyRent, DEFAULT_RENT[tier])),
        totalEquityNeeded: Math.round(num(b.totalEquityNeeded, DEFAULT_GOALS[tier])), manualEquityPaid: manual,
    };
    // the payment record stays with the contract; typing a "paid so far" on a contract that has one sets the opening amount so the total is what was typed
    item.payments = old && old.payments ? old.payments : []; item.opening = old && old.opening ? old.opening : 0; item.offeredOn = old ? old.offeredOn || null : null;
    if (hasRecord(item) && manual !== null) { item.opening = Math.max(0, Math.round(manual - item.payments.reduce((s, p) => s + (Number(p.equity) || 0), 0))); item.manualEquityPaid = null; }
    return item;
}

// ---- the tenants' own side: a tenant sees only their own contract (rent, equity paid, what is left, their payments, the lease on Torn) and accepts the terms; nothing of the owner's costs or profit ----
const TENANT_TERMS_V = '2026-10-09'; // the version of the rent-to-buy terms shown in terms.js
const mineT = (d, who) => d.rtoItems.filter(r => r.tenantId && String(r.tenantId) === String(who.playerId));
async function isTenant(redis, who) { try { return mineT(await load(redis), who).length > 0; } catch (e) { return false; } }
async function tenHandle(action, body, { redis, who }) {
    const d = await load(redis), rows = mineT(d, who), pid = String(who.playerId), today = todayIso();
    if (!rows.length) throw new Error('You have no rent-to-buy contract.');
    if (action === 'ten-terms-accept') { d.terms = d.terms || {}; d.terms[pid] = { on: today, v: TENANT_TERMS_V }; await save(redis, d); return { ok: true }; }
    if (action !== 'ten-my') throw new Error('Unknown action');
    const synced = d.syncedAt ? new Date(d.syncedAt).toISOString().slice(0, 10) : null;
    return {
        name: who.name, today, syncedAt: d.syncedAt, terms: d.terms[pid] || null,
        contracts: rows.map(it => {
            const pi = piOf(it, d.pis), goal = Number(it.totalEquityNeeded) || 0, eq = Number(it.cycleEquity) || 0;
            const due = pi && pi.isRented && synced ? addDays(synced, Number(pi.daysLeft) || 0) : nextDue(it); // the lease on Torn when the island is linked, else the contract dates
            return { id: it.id, tier: it.originalHappy, startDate: it.startDate, rent: Number(it.monthlyRent) || 0, equity: eq, goal, paid: paidSoFar(it), months: eq ? Math.ceil(goal / eq) : null, due, leaseDays: pi && pi.isRented ? Number(pi.daysLeft) : null,
                offered: !!it.offeredOn, payments: (it.payments || []).map(p => ({ date: p.date, rent: p.rent, equity: p.equity })) };
        }),
    };
}

async function ltHandle(action, body, { redis, key }) {
    if (action === 'lt-get') return { ...(await load(redis)), defaults: { goals: DEFAULT_GOALS, rent: DEFAULT_RENT, equity: DEFAULT_EQUITY, cost: DEFAULT_COST } };
    if (action === 'lt-sync') { // reads the owner's islands from Torn with the owner's own key
        const d = await load(redis);
        d.pis = await fetchPIs(key); d.syncedAt = Date.now();
        await save(redis, d);
        return { ...d, defaults: { goals: DEFAULT_GOALS, rent: DEFAULT_RENT, equity: DEFAULT_EQUITY, cost: DEFAULT_COST } };
    }
    if (action === 'lt-rto-save') { // add a contract, or change an existing one (by id)
        const d = await load(redis);
        const i = body.item && body.item.id ? d.rtoItems.findIndex(x => x.id === body.item.id) : -1;
        const item = cleanItem(body.item || {}, i >= 0 ? d.rtoItems[i] : null);
        if (i >= 0) d.rtoItems[i] = item; else d.rtoItems.push(item);
        await save(redis, d);
        return { ok: true, item };
    }
    if (action === 'lt-rto-delete') {
        const d = await load(redis);
        d.rtoItems = d.rtoItems.filter(x => x.id !== body.id);
        await save(redis, d);
        return { ok: true };
    }
    if (action === 'lt-import') { // the contracts of the old Labstracking page: paste what its browser storage holds (labstracking_db)
        let old; try { old = JSON.parse(String(body.json || '')); } catch (e) { throw new Error('That is not the copied text of the old page: copy it again.'); }
        const items = Array.isArray(old) ? old : (old && Array.isArray(old.rtoItems) ? old.rtoItems : []);
        if (!items.length) throw new Error('Found no RTO contracts in that text.');
        const d = await load(redis);
        let added = 0;
        for (const it of items) {
            const dup = d.rtoItems.some(x => String(x.propertyId || '') === String(it.propertyId || '') && x.clientName === it.clientName && x.startDate === (it.startDate || x.startDate));
            if (dup) continue;
            d.rtoItems.push(cleanItem({ ...it, monthlyRent: it.monthlyRent ?? DEFAULT_RENT[Number(it.originalHappy)] ?? 27000000 }, null));
            added++;
        }
        await save(redis, d);
        return { ok: true, added, skipped: items.length - added };
    }
    if (action === 'lt-offer' || action === 'lt-offer-clear') { // "I offered the lease" (the script / the page); clearing takes it back
        const d = await load(redis), it = d.rtoItems.find(x => x.id === body.id);
        if (!it) throw new Error('Contract not found');
        it.offeredOn = action === 'lt-offer' ? todayIso() : null;
        await save(redis, d);
        return { ok: true, item: it };
    }
    if (action === 'lt-pay') { // the tenant accepted and paid: one payment (today, or a past date typed on the page) at the contract's rent and equity unless amounts are given
        const d = await load(redis), it = d.rtoItems.find(x => x.id === body.id);
        if (!it) throw new Error('Contract not found');
        const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : todayIso();
        if (!hasRecord(it)) { // the first recorded payment: what the calendar says was paid before it becomes the opening amount, so nothing already counted is lost
            it.opening = it.manualEquityPaid !== null && it.manualEquityPaid !== undefined ? Number(it.manualEquityPaid) : Math.max(0, calendarCycles(it, date) - 1) * (Number(it.cycleEquity) || 0);
            it.manualEquityPaid = null;
        }
        it.payments = it.payments || [];
        it.payments.push({ id: `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`, date, rent: Math.round(num(body.rent, it.monthlyRent)), equity: Math.round(num(body.equity, it.cycleEquity)) });
        it.payments.sort((a, b) => (a.date < b.date ? -1 : 1));
        it.payments = it.payments.slice(-200);
        it.offeredOn = null;
        await save(redis, d);
        return { ok: true, item: it };
    }
    if (action === 'lt-pay-delete') {
        const d = await load(redis), it = d.rtoItems.find(x => x.id === body.id);
        if (!it) throw new Error('Contract not found');
        it.payments = (it.payments || []).filter(p => p.id !== body.paymentId);
        await save(redis, d);
        return { ok: true, item: it };
    }
    throw new Error('Unknown action');
}

module.exports = { ltHandle, leaseTodos, tenHandle, isTenant };
