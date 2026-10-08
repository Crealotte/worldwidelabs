// lib/labstracking.js — Labstracking inside WWL (owner only): the owner's Private Islands (PIs) read from Torn, and the rent-to-own (RTO) contracts on them.
// It used to be a separate page (labstracking.vercel.app) that kept its data in one browser; here it lives on the server, so it works from anywhere and the
// script can read it. The Torn side is the same as before: user/properties with the owner's own key; an island's base happy is worked out from its upgrades
// (yacht = 4100, superior interior = 3600, otherwise 2600).
//
//   wwl:labstracking -> JSON { rtoItems: [{ id, clientName, tierName, originalHappy, propertyId, tenantId, startDate, cycleEquity, monthlyRent, totalEquityNeeded, manualEquityPaid }],
//                              pis: [{ id, propertyName, originalHappy, tierName, currentHappyWithStaff, isLivingHere, isRented, tenantID, daysLeft, status }], syncedAt }

const KEY = 'wwl:labstracking';
// the goal an island is bought off at, and the monthly rent per tier (from the owner's rental terms: 290k / 410k / 820k a day); both can be changed per contract
const DEFAULT_GOALS = { 4100: 2200000000, 3600: 1800000000, 2600: 1400000000 };
const DEFAULT_RENT = { 4100: 27000000, 3600: 12300000, 2600: 8700000 };
const DEFAULT_CYCLE_EQUITY = 81000000;

const num = (v, d = 0) => { const n = Number(String(v ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) && String(v ?? '') !== '' ? n : d; };
const newId = () => `rto_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

async function load(redis) {
    try { const raw = await redis(['GET', KEY]); const d = raw ? JSON.parse(raw) : {}; return { rtoItems: Array.isArray(d.rtoItems) ? d.rtoItems : [], pis: Array.isArray(d.pis) ? d.pis : [], syncedAt: d.syncedAt || null }; }
    catch (e) { return { rtoItems: [], pis: [], syncedAt: null }; }
}
const save = (redis, d) => redis(['SET', KEY, JSON.stringify(d)]);

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
    return {
        id: old ? old.id : newId(),
        clientName: String(b.clientName || (old && old.clientName) || 'Client').trim().slice(0, 60),
        tierName: `${tier} Happy PI`, originalHappy: tier,
        propertyId: b.propertyId ? String(b.propertyId).replace(/\D/g, '') || null : null,
        tenantId: b.tenantId ? String(b.tenantId).replace(/\D/g, '') || null : null,
        startDate: /^\d{4}-\d{2}-\d{2}$/.test(b.startDate || '') ? b.startDate : (old ? old.startDate : new Date().toISOString().slice(0, 10)),
        cycleEquity: Math.round(num(b.cycleEquity, DEFAULT_CYCLE_EQUITY)), monthlyRent: Math.round(num(b.monthlyRent, DEFAULT_RENT[tier])),
        totalEquityNeeded: Math.round(num(b.totalEquityNeeded, DEFAULT_GOALS[tier])), manualEquityPaid: manual,
    };
}

async function ltHandle(action, body, { redis, key }) {
    if (action === 'lt-get') return { ...(await load(redis)), defaults: { goals: DEFAULT_GOALS, rent: DEFAULT_RENT, cycleEquity: DEFAULT_CYCLE_EQUITY } };
    if (action === 'lt-sync') { // reads the owner's islands from Torn with the owner's own key
        const d = await load(redis);
        d.pis = await fetchPIs(key); d.syncedAt = Date.now();
        await save(redis, d);
        return { ...d, defaults: { goals: DEFAULT_GOALS, rent: DEFAULT_RENT, cycleEquity: DEFAULT_CYCLE_EQUITY } };
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
    throw new Error('Unknown action');
}

module.exports = { ltHandle };
