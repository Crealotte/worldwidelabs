// lib/ledger.js — the trader ledger ("Trading ledger" page): a trader (somebody with a Trading Funding, or the owner) pastes their Torn trade logs; the page reads them (ledger.js, in the browser) and sends the finished trades here
// to be kept, one record per player. The owner can look at the ledger of every trader who has a funding. Nothing here talks to Torn except the item values (market value of each item, kept 12 hours for everybody).
//
//   wwl:ledger:<tornId> -> JSON { trades: [ { id, at: 'YYYY-MM-DD HH:MM:SS', partner, title, items: { name: qty }, itemsDir: 'in' | 'out' | '', money: n, moneyDir: 'in' | 'out' | '', manual?: true } ] }
//        'in' = came to the trader, 'out' = the trader gave it away. A buy = items in + money out; a sale = items out + money in.
//   wwl:item-values -> JSON { itemName: marketValue } (12 hours)

const { loadFinances } = require('./finances');
const { tornFetch } = require('./tornFetch');

const KEY = id => `wwl:ledger:${id}`, VALUES = 'wwl:item-values', MAX_TRADES = 800;
const todayIso = () => new Date().toISOString().slice(0, 10);
const str = (v, n) => String(v ?? '').trim().slice(0, n);

async function load(redis, id) {
    try { const raw = await redis(['GET', KEY(id)]); const d = raw ? JSON.parse(raw) : {}; return { trades: Array.isArray(d.trades) ? d.trades : [], pricelist: cleanPricelist(d.pricelist) }; } catch (e) { return { trades: [], pricelist: cleanPricelist(null) }; }
}
const save = (redis, id, d) => redis(['SET', KEY(id), JSON.stringify({ trades: d.trades.slice(-MAX_TRADES), pricelist: d.pricelist })]);

// the trader's pricelist: a default percentage of the market value, and per item an own percentage or a fixed price
function cleanPricelist(p) {
    const pct = v => { const n = Number(v); return isFinite(n) && n > 0 && n <= 500 ? Math.round(n * 100) / 100 : 0; };
    const rows = [];
    for (const r of Array.isArray(p && p.rows) ? p.rows.slice(0, 300) : []) {
        const name = str(r && r.name, 60); if (!name || rows.some(x => x.name === name)) continue;
        rows.push({ name, pct: pct(r.pct), fixed: Math.max(0, Math.min(1e13, Math.round(Number(r.fixed) || 0))) });
    }
    return { pct: pct(p && p.pct) || 100, rows };
}

// item names and quantities: short names, whole quantities
function cleanItems(o) {
    const items = {};
    for (const [name, q] of Object.entries(o && typeof o === 'object' ? o : {}).slice(0, 80)) { const n = str(name, 60), qty = Math.round(Number(q)); if (n && qty > 0 && qty < 1e7) items[n] = qty; }
    return items;
}
// a trade from the page, made safe: names are short strings, quantities and money whole positive numbers
function cleanTrade(t) {
    const items = cleanItems(t && t.items);
    const at = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(String(t && t.at)) ? String(t.at) : '';
    const dir = v => (v === 'in' || v === 'out' ? v : '');
    const money = Math.max(0, Math.min(1e13, Math.round(Number(t && t.money) || 0)));
    const prices = {}, market = {};
    for (const name of Object.keys(items)) { const p = Math.round(Number(t && t.prices && t.prices[name])), m = Math.round(Number(t && t.market && t.market[name])); if (p > 0) prices[name] = p; if (m > 0) market[name] = m; }
    if (!at || (!Object.keys(items).length && !money)) return null;
    return { id: str(t.id, 24) || Math.random().toString(36).slice(2, 10), at, partner: str(t.partner, 40), title: str(t.title, 60), items, itemsDir: Object.keys(items).length ? dir(t.itemsDir) : '', money, moneyDir: money ? dir(t.moneyDir) : '', manual: !!t.manual, tradeId: String(t && t.tradeId || '').replace(/D/g, '').slice(0, 12), prices, market, source: ['log', 'hand', 'script'].includes(t && t.source) ? t.source : '' };
}
// two trades are the same when the time, the partner, the money and the items are the same (pasting a log twice adds nothing)
const sigOf = t => `${t.at}|${t.partner}|${t.money}|${t.moneyDir}|${Object.keys(t.items).sort().map(k => `${k}:${t.items[k]}`).join(',')}`;
const itemsKey = t => Object.keys(t.items).sort().map(k => `${k}:${t.items[k]}`).join(',');
// a trade that is in the ledger already: the same trade ID, or the same partner, items and money within half an hour
const isSame = (a, b) => (a.tradeId && b.tradeId ? a.tradeId === b.tradeId : sigOf(a) === sigOf(b) || (a.money === b.money && a.moneyDir === b.moneyDir && itemsKey(a) === itemsKey(b) && String(a.partner).toLowerCase() === String(b.partner).toLowerCase() && Math.abs(Date.parse(a.at.replace(' ', 'T') + 'Z') - Date.parse(b.at.replace(' ', 'T') + 'Z')) <= 30 * 60000));

// the market value of every item (name -> value), kept 12 hours for everybody
async function itemValues(redis, key) {
    let raw = await redis(['GET', VALUES]);
    if (!raw) {
        const r = await tornFetch(`https://api.torn.com/torn/?selections=items&key=${encodeURIComponent(key)}`), j = await r.json();
        if (j.error) return { values: {}, error: j.error.error || 'Torn would not give the item values' };
        const m = {};
        for (const it of Object.values(j.items || {})) if (it && it.name) m[it.name] = Math.round(Number(it.market_value) || 0);
        raw = JSON.stringify(m);
        if (Object.keys(m).length) await redis(['SET', VALUES, raw, 'EX', 43200]);
    }
    return { values: JSON.parse(raw) };
}

async function ledHandle(action, body, { redis, who, key, owner }) {
    const pid = String(who.playerId);
    if (action === 'led-owner-list') { // the traders with a funding (and their number of trades), for the owner
        if (!owner) throw new Error('Owner only.');
        const fin = await loadFinances(redis), seen = new Set(), out = [];
        for (const f of fin.fundings || []) { if (!f.tornId || seen.has(f.tornId)) continue; seen.add(f.tornId); out.push({ tornId: f.tornId, name: f.name, active: !!f.active }); }
        for (const t of out) t.trades = (await load(redis, t.tornId)).trades.length;
        return { traders: out };
    }
    if (action === 'led-owner-get') {
        if (!owner) throw new Error('Owner only.');
        const id = String(body.tornId || '').replace(/\D/g, '').slice(0, 10);
        if (!id) throw new Error('Pick a trader.');
        return { tornId: id, trades: (await load(redis, id)).trades };
    }
    // everything below is the trader's own ledger: for the owner and for somebody with an active funding
    if (!owner) {
        const fin = await loadFinances(redis);
        if (!(fin.fundings || []).some(f => f.active && String(f.tornId) === pid)) throw new Error('The trading ledger is for the traders of Trading Funding.');
    }
    if (action === 'led-values') { // the market value of every item (a name to value list), kept 12 hours
        const v = await itemValues(redis, key);
        return v.error ? { values: {}, error: v.error } : { values: v.values };
    }
    if (action === 'led-prices') { // for the userscript: the price of the named items on the trader's own pricelist
        const v = await itemValues(redis, key); if (v.error) return { prices: {}, error: v.error };
        const pl = (await load(redis, pid)).pricelist, prices = {};
        for (const name of (Array.isArray(body.names) ? body.names : []).slice(0, 80).map(n => str(n, 60))) {
            const r = pl.rows.find(x => x.name === name) || {};
            prices[name] = r.fixed || Math.round((v.values[name] || 0) * (r.pct || pl.pct) / 100);
        }
        return { prices, pct: pl.pct };
    }
    if (action === 'led-script-add') { // for the userscript: a finished trade read from the trade page, two sides: { name, money, items: { name: qty } }
        const sides = (Array.isArray(body.sides) ? body.sides : []).slice(0, 2).map(s => ({ name: str(s && s.name, 60), money: Math.max(0, Math.round(Number(s && s.money) || 0)), items: cleanItems(s && s.items) }));
        if (sides.length !== 2) throw new Error('The trade page could not be read.');
        const norm = n => String(n || '').toLowerCase().replace(/\[\d+\]/g, '').replace(/'s (items|money|property).*$/, '').replace(/\s+/g, ' ').trim(), mine = norm(who.name);
        const me = sides.findIndex(s => norm(s.name) === mine);
        if (me < 0) throw new Error(`I could not tell which side of the trade is you (the page says "${sides.map(s => s.name).join('" and "')}", you are ${who.name}).`);
        const a = sides[me], b = sides[1 - me], has = o => Object.keys(o).length > 0;
        const buy = a.money > 0 && !has(a.items) && has(b.items) && !b.money, sell = has(a.items) && !a.money && b.money > 0 && !has(b.items);
        if (!buy && !sell) throw new Error('This trade is not a plain purchase or sale (items for items, or money and items on both sides), so paste its log lines instead.');
        const t = cleanTrade({ at: body.at, partner: b.name.replace(/\s*\[\d+\]\s*$/, ''), title: 'Trade', items: buy ? b.items : a.items, itemsDir: buy ? 'in' : 'out', money: buy ? a.money : b.money, moneyDir: buy ? 'out' : 'in', tradeId: body.tradeId, prices: body.prices, source: 'script' });
        if (!t) throw new Error('There is nothing to save in that trade.');
        const d = await load(redis, pid);
        if (d.trades.some(x => isSame(x, t))) return { ok: true, added: 0, skipped: 1, kind: buy ? 'buy' : 'sell' };
        d.trades.push(t); d.trades.sort((x, y) => (x.at < y.at ? -1 : 1));
        await save(redis, pid, d);
        return { ok: true, added: 1, skipped: 0, ids: [t.id], kind: buy ? 'buy' : 'sell' };
    }
    if (action === 'led-get') { const d = await load(redis, pid); return { name: who.name, today: todayIso(), trades: d.trades, pricelist: d.pricelist }; }
    if (action === 'led-pl-save') {
        const d = await load(redis, pid);
        d.pricelist = cleanPricelist(body.pricelist);
        await save(redis, pid, d);
        return { ok: true, pricelist: d.pricelist };
    }
    if (action === 'led-add') {
        const d = await load(redis, pid), ids = [];
        let added = 0, skipped = 0;
        for (const raw of (Array.isArray(body.trades) ? body.trades : []).slice(0, 150)) {
            const t = cleanTrade(raw); if (!t) continue;
            if (d.trades.some(x => isSame(x, t))) { skipped++; continue; }
            d.trades.push(t); ids.push(t.id); added++;
        }
        d.trades.sort((a, b) => (a.at < b.at ? -1 : 1));
        await save(redis, pid, d);
        return { ok: true, added, skipped, ids };
    }
    if (action === 'led-del') {
        const d = await load(redis, pid), n = d.trades.length;
        d.trades = d.trades.filter(t => t.id !== body.id);
        if (d.trades.length === n) throw new Error('That trade is not in the ledger.');
        await save(redis, pid, d);
        return { ok: true };
    }
    throw new Error('Unknown action');
}

module.exports = { ledHandle };
