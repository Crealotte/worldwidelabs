// lib/ledger.js — the trader ledger ("Trading ledger" page): a trader (somebody with a Trading Funding, or the owner) pastes their Torn trade logs; the page reads them (ledger.js, in the browser) and sends the finished trades here
// to be kept, one record per player. The owner can look at the ledger of every trader who has a funding. Nothing here talks to Torn except the item values (market value of each item, kept 12 hours for everybody).
//
//   wwl:ledger:<tornId> -> JSON { trades: [ { id, at: 'YYYY-MM-DD HH:MM:SS', partner, title, items: { name: qty }, itemsDir: 'in' | 'out' | '', money: n, moneyDir: 'in' | 'out' | '', manual?: true } ] }
//        'in' = came to the trader, 'out' = the trader gave it away. A buy = items in + money out; a sale = items out + money in.
//        pricelist: { pct, round, shared, name, updated, rows: [ { name, pct, fixed } ] }  (the price WE PAY for an item; shared = a public page at /pricelist/<tornId>)
//   wwl:item-data -> JSON { at: ms, values: { itemName: marketValue }, meta: { itemName: [id, type] } } (refreshed after 12 hours by whoever opens the ledger; never expires, so the public pricelist always has prices)

const { loadFinances } = require('./finances');
const { tornFetch } = require('./tornFetch');
const { licHandle, scanIfDue, vipOf, info: licInfo } = require('./license');
const LEDGER_ACTIONS = new Set(['led-get', 'led-add', 'led-del']); // the paid part: looking at the ledger and changing it by hand

const KEY = id => `wwl:ledger:${id}`, ITEM_DATA = 'wwl:item-data', MAX_TRADES = 800;
const todayIso = () => new Date().toISOString().slice(0, 10);
const str = (v, n) => String(v ?? '').trim().slice(0, n);
// a player name from Torn's trade page: the header also holds the "Hide item values" / "Show item values" button text
const cleanName = s => String(s || '').replace(/(hide|show) item values/ig, '').replace(/\s+/g, ' ').trim().slice(0, 40);

async function load(redis, id) {
    try { const raw = await redis(['GET', KEY(id)]); const d = raw ? JSON.parse(raw) : {}; return { trades: Array.isArray(d.trades) ? d.trades : [], pricelist: cleanPricelist(d.pricelist), message: str(d.message, 600) }; } catch (e) { return { trades: [], pricelist: cleanPricelist(null), message: '' }; }
}
const save = (redis, id, d) => redis(['SET', KEY(id), JSON.stringify({ trades: d.trades.slice(-MAX_TRADES), pricelist: d.pricelist, message: d.message || '' })]);

// the trader's pricelist: a default percentage of the market value, per item an own percentage or a fixed price, a rounding step, and whether it is shared as a public page
function cleanPricelist(p) {
    const pct = v => { const n = Number(v); return isFinite(n) && n > 0 && n <= 500 ? Math.round(n * 100) / 100 : 0; };
    const rows = [];
    for (const r of Array.isArray(p && p.rows) ? p.rows.slice(0, 1500) : []) {
        const name = str(r && r.name, 60); if (!name || rows.some(x => x.name === name)) continue;
        rows.push({ name, pct: pct(r.pct), fixed: Math.max(0, Math.min(1e13, Math.round(Number(r.fixed) || 0))) });
    }
    const round = [100, 1000, 10000].includes(Number(p && p.round)) ? Number(p.round) : 0;
    return { pct: pct(p && p.pct) || 100, round, shared: !!(p && p.shared), name: str(p && p.name, 40), updated: Number(p && p.updated) || 0, rows };
}
// the price of one item on a pricelist: a fixed price, or the market value times the percentage, rounded to the step
const priceOf = (row, pl, value) => { const r = row || {}; if (r.fixed) return r.fixed; const n = (value || 0) * (r.pct || pl.pct) / 100; return pl.round ? Math.round(n / pl.round) * pl.round : Math.round(n); };

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
    return { id: str(t.id, 24) || Math.random().toString(36).slice(2, 10), at, partner: str(t.partner, 40), title: str(t.title, 60), items, itemsDir: Object.keys(items).length ? dir(t.itemsDir) : '', money, moneyDir: money ? dir(t.moneyDir) : '', manual: !!t.manual, tradeId: String(t && t.tradeId || '').replace(/\D/g, '').slice(0, 12), prices, market, source: ['log', 'hand', 'script', 'receipt'].includes(t && t.source) ? t.source : '', pointsIn: Math.max(0, Math.min(1e9, Math.round(Number(t && t.pointsIn) || 0))) };
}
// two trades are the same when the time, the partner, the money and the items are the same (pasting a log twice adds nothing)
const sigOf = t => `${t.at}|${t.partner}|${t.money}|${t.moneyDir}|${t.pointsIn || 0}|${Object.keys(t.items).sort().map(k => `${k}:${t.items[k]}`).join(',')}`;
const itemsKey = t => Object.keys(t.items).sort().map(k => `${k}:${t.items[k]}`).join(',');
// a trade that is in the ledger already: the same trade ID, or the same partner, items and money within half an hour
const isSame = (a, b) => (a.tradeId && b.tradeId ? a.tradeId === b.tradeId : sigOf(a) === sigOf(b) || (a.money === b.money && a.moneyDir === b.moneyDir && itemsKey(a) === itemsKey(b) && String(a.partner).toLowerCase() === String(b.partner).toLowerCase() && Math.abs(Date.parse(a.at.replace(' ', 'T') + 'Z') - Date.parse(b.at.replace(' ', 'T') + 'Z')) <= 30 * 60000));

// The two museum sets are not items in Torn: a set is one of each of its parts. They get a "market value" of the parts together (and the type of their parts), so they can be priced on a pricelist.
const ITEM_SETS = {
    'Plushie Set': { type: 'Plushie', parts: ['Camel Plushie', 'Chamois Plushie', 'Jaguar Plushie', 'Kitten Plushie', 'Lion Plushie', 'Monkey Plushie', 'Nessie Plushie', 'Panda Plushie', 'Red Fox Plushie', 'Sheep Plushie', 'Stingray Plushie', 'Teddy Bear Plushie', 'Wolverine Plushie'] },
    'Flower Set': { type: 'Flower', parts: ['African Violet', 'Banana Orchid', 'Ceibo Flower', 'Cherry Blossom', 'Crocus', 'Dahlia', 'Edelweiss', 'Heather', 'Orchid', 'Peony', 'Tribulus Omanense'] },
};
function withSets(values, meta) {
    const v = { ...values }, m = { ...meta };
    for (const [name, s] of Object.entries(ITEM_SETS)) { v[name] = s.parts.reduce((t, n) => t + (v[n] || 0), 0); m[name] = [0, s.type]; }
    return { values: v, meta: m };
}
// the market value (and id and type) of every item, for everybody: refreshed from Torn when it is older than 12 hours, by whoever asks first
async function itemValues(redis, key) {
    const v = await itemValuesRaw(redis, key);
    return v.error ? v : { ...v, ...withSets(v.values, v.meta) };
}
async function itemValuesRaw(redis, key) {
    let data = null;
    try { const raw = await redis(['GET', ITEM_DATA]); data = raw ? JSON.parse(raw) : null; } catch (e) { data = null; }
    if (!data || !data.values || Date.now() - (data.at || 0) > 43200000) {
        try {
            const r = await tornFetch(`https://api.torn.com/torn/?selections=items&key=${encodeURIComponent(key)}`), j = await r.json();
            if (j.error) { if (data && data.values) return data; return { values: {}, meta: {}, error: j.error.error || 'Torn would not give the item values' }; }
            const values = {}, meta = {};
            for (const [id, it] of Object.entries(j.items || {})) if (it && it.name) { values[it.name] = Math.round(Number(it.market_value) || 0); meta[it.name] = [Number(id), str(it.type, 30)]; }
            if (Object.keys(values).length) { data = { at: Date.now(), values, meta }; await redis(['SET', ITEM_DATA, JSON.stringify(data)]); }
        } catch (e) { if (!(data && data.values)) return { values: {}, meta: {}, error: 'Could not reach Torn for the item values' }; }
    }
    return { values: data.values, meta: data.meta || {}, at: data.at || 0 };
}

// ---- receipts: the page of a trade at the trader's prices (made by the userscript, or by hand), listed on the Trading page ----
const cleanLines = lines => (Array.isArray(lines) ? lines : []).slice(0, 80).map(l => ({ name: str(l && l.name, 60), qty: Math.round(Number(l && l.qty)), price: Math.round(Number(l && l.price)) })).filter(l => l.name && l.qty > 0 && l.qty < 1e7 && l.price > 0 && l.price < 1e13);
const cleanPartner = p => ({ name: cleanName(p && p.name), id: String((p && p.id) || '').replace(/\D/g, '').slice(0, 10) });
const marketOf = (lines, values) => lines.reduce((t, l) => t + l.qty * (values[l.name] || 0), 0);
const money = n => `$${Math.round(n).toLocaleString('en-US')}`;
// The items of a trade at a pricelist: a full set (one of each part) is priced as the set when the set is on the list, the other items one by one; items that are not on the list have no price.
function priceTrade(pl, values, items) {
    const left = { ...items }, lines = [], unpriced = [];
    for (const [setName, s] of Object.entries(ITEM_SETS)) {
        const row = pl.rows.find(x => x.name === setName), sp = row ? priceOf(row, pl, values[setName]) : 0;
        if (!sp) continue;
        const count = Math.min(...s.parts.map(p => left[p] || 0));
        if (!count) continue;
        s.parts.forEach(p => { left[p] -= count; });
        lines.push({ name: setName, qty: count, price: sp });
    }
    for (const [name, qty] of Object.entries(left)) {
        if (!qty) continue;
        const row = pl.rows.find(x => x.name === name), p = row ? priceOf(row, pl, values[name]) : 0;
        if (p) lines.push({ name, qty, price: p }); else unpriced.push(name);
    }
    return { lines, unpriced, market: marketOf(lines, values), total: lines.reduce((t, l) => t + l.qty * l.price, 0) };
}
async function loadReceiptList(redis, pid) {
    try { const raw = await redis(['GET', RCPT_LIST(pid)]); const a = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
// the receipt is saved under a random token (the same trade keeps its token, so the link stays the same when the prices change), and put in the trader's list
async function saveReceipt(redis, pid, who, r) {
    const now = Date.now(), total = r.lines.reduce((t, l) => t + l.qty * l.price, 0), units = r.lines.reduce((t, l) => t + l.qty, 0);
    let token = await redis(['GET', RCPT_MAP(pid, r.tradeId)]), created = now;
    if (token) { try { created = JSON.parse(await redis(['GET', RCPT(token)])).created || now; } catch (e) { created = now; } } else token = require('crypto').randomBytes(9).toString('base64url');
    await redis(['SET', RCPT(token), JSON.stringify({ traderId: pid, trader: who.name, tradeId: r.tradeId, partner: r.partner, lines: r.lines, total, market: r.market, source: r.source, created, updated: now })]);
    await redis(['SET', RCPT_MAP(pid, r.tradeId), token]);
    const list = await loadReceiptList(redis, pid), entry = { token, tradeId: r.tradeId, partner: r.partner, total, market: r.market, units, source: r.source, created, updated: now }, i = list.findIndex(x => x.token === token);
    if (i >= 0) list[i] = entry; else list.unshift(entry);
    await redis(['SET', RCPT_LIST(pid), JSON.stringify(list.slice(0, 300))]);
    return { token, total, market: r.market, partner: r.partner };
}
// the trader's own message for a receipt, with its variables filled in
function renderMessage(d, out, who, base) {
    if (!d.message) return '';
    const b = /^https:\/\/[a-z0-9.-]+$/i.test(String(base || '')) ? String(base) : 'https://worldwidelabs.vercel.app';
    const real = d.trades.filter(t => !t.manual), weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const vars = { seller: out.partner.name || '', trades_total: String(real.length), trades_weekly: String(real.filter(t => t.at.slice(0, 10) >= weekAgo).length), buy_price: money(out.total), market_total: money(out.market), pricelist: d.pricelist.shared ? `${b}/?pricelist=${who.playerId}` : '', receipt: `${b}/?tradereceipt=${out.token}` };
    return d.message.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
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
    // The pricelist, the receipts and the prices for the userscript are free for everybody. Looking at the ledger (and putting trades in by hand) is for VIP (1 Xanax per 7 days, lib/license.js),
    // for a trader with an active Trading Funding, and for the owner. The trades themselves are always saved, also when VIP has ended.
    if (action === 'led-rcpt-list') await scanIfDue(redis); // payments that arrived are given when somebody opens the Trading page (at most once a minute)
    const finActive = async () => ((await loadFinances(redis)).fundings || []).some(f => f.active && String(f.tornId) === pid);
    const vip = action.startsWith('lic-') || action === 'led-rcpt-list' || LEDGER_ACTIONS.has(action) ? await vipOf(redis, who, owner, finActive) : null;
    if (LEDGER_ACTIONS.has(action) && !vip.active) throw new Error('VIP_REQUIRED');
    if (action.startsWith('lic-')) return licHandle(action, body, { redis, who, owner, vip, key });
    if (action === 'led-values') { // the market value of every item (a name to value list), kept 12 hours
        const v = await itemValues(redis, key);
        return v.error ? { values: {}, meta: {}, error: v.error } : { values: v.values, meta: v.meta, at: v.at };
    }
    if (action === 'led-prices') { // for the userscript: the price of the named items on the trader's own pricelist (an item that is not on the list has no price)
        const v = await itemValues(redis, key); if (v.error) return { prices: {}, error: v.error };
        const pl = (await load(redis, pid)).pricelist, prices = {}, names = (Array.isArray(body.names) ? body.names : []).slice(0, 80).map(n => str(n, 60)), sets = {};
        for (const name of names) {
            const r = pl.rows.find(x => x.name === name);
            prices[name] = r ? priceOf(r, pl, v.values[name]) : 0;
        }
        // a set is not an item: when the trade has one of each part, the set on the pricelist can be used instead of the single prices (the page counts how many full sets there are)
        for (const [setName, s] of Object.entries(ITEM_SETS)) {
            if (!s.parts.every(p => names.includes(p))) continue;
            const r = pl.rows.find(x => x.name === setName), price = r ? priceOf(r, pl, v.values[setName]) : 0;
            if (price > 0) { prices[setName] = price; sets[setName] = s.parts; }
        }
        return { prices, pct: pl.pct, sets, listed: pl.rows.length };
    }
    if (action === 'led-script-add') { // for the userscript: a finished trade read from the trade page, two sides: { name, money, items: { name: qty } }
        const sides = (Array.isArray(body.sides) ? body.sides : []).slice(0, 2).map(s => ({ name: cleanName(s && s.name), money: Math.max(0, Math.round(Number(s && s.money) || 0)), items: cleanItems(s && s.items) }));
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
        if (!d.pricelist.rows.length && !d.trades.length) return { ok: true, added: 0, skipped: 0, off: true }; // somebody who has not started with the pricelist or the ledger: nothing is saved by itself
        if (d.trades.some(x => isSame(x, t))) return { ok: true, added: 0, skipped: 1, kind: buy ? 'buy' : 'sell' };
        d.trades.push(t); d.trades.sort((x, y) => (x.at < y.at ? -1 : 1));
        await save(redis, pid, d);
        return { ok: true, added: 1, skipped: 0, ids: [t.id], kind: buy ? 'buy' : 'sell' };
    }
    if (action === 'led-receipt-save') { // for the userscript: the receipt of an open trade (a public page): the lines of the trade at the trader's prices
        const tradeId = String(body.tradeId || '').replace(/\D/g, '').slice(0, 12);
        if (!tradeId) throw new Error('The trade could not be read.');
        const lines = cleanLines(body.lines);
        if (!lines.length) throw new Error('There is nothing to put on a receipt.');
        const v = await itemValues(redis, key), d = await load(redis, pid);
        const out = await saveReceipt(redis, pid, who, { tradeId, partner: cleanPartner(body.partner), lines, market: marketOf(lines, v.values), source: 'trade' });
        return { ok: true, token: out.token, total: out.total, message: renderMessage(d, out, who, body.base) };
    }
    if (action === 'led-receipt-make') { // by hand: the items of a trade (read from lines like "Name added 10x Sheep Plushie to the trade."), priced with the pricelist
        const items = cleanItems(body.items);
        if (!Object.keys(items).length) throw new Error('There are no items in that.');
        const d = await load(redis, pid), v = await itemValues(redis, key), priced = priceTrade(d.pricelist, v.values, items);
        if (!priced.lines.length) throw new Error(`None of those items is on your pricelist${priced.unpriced.length ? ` (${priced.unpriced.join(', ')})` : ''}.`);
        const tradeId = String(body.tradeId || '').replace(/\D/g, '').slice(0, 12) || `m${Date.now()}`;
        const out = await saveReceipt(redis, pid, who, { tradeId, partner: cleanPartner(body.partner), lines: priced.lines, market: priced.market, source: 'manual' });
        return { ok: true, token: out.token, total: out.total, unpriced: priced.unpriced, message: renderMessage(d, out, who, body.base) };
    }
    if (action === 'led-rcpt-list') { // the receipts of this trader (newest first), and the message they use
        const d = await load(redis, pid);
        return { name: who.name, tornId: pid, receipts: (await loadReceiptList(redis, pid)).map(x => ({ ...x, partner: { ...x.partner, name: cleanName(x.partner && x.partner.name) } })), message: d.message, shared: !!d.pricelist.shared, vip, ...(await licInfo(redis, who)), ledgerIds: d.trades.map(t => t.tradeId).filter(Boolean) };
    }
    if (action === 'led-receipt-del') {
        const token = String(body.token || '');
        const list = await loadReceiptList(redis, pid), hit = list.find(r => r.token === token);
        if (!hit) throw new Error('That receipt is not in your list.');
        await redis(['DEL', RCPT(token)]); await redis(['DEL', RCPT_MAP(pid, hit.tradeId)]);
        await redis(['SET', RCPT_LIST(pid), JSON.stringify(list.filter(r => r.token !== token))]);
        return { ok: true };
    }
    if (action === 'led-msg-save') { // the message that goes with a receipt, with {seller}, {trades_total}, {trades_weekly}, {buy_price}, {market_total}, {pricelist}, {receipt}
        const d = await load(redis, pid);
        d.message = str(body.message, 600);
        await save(redis, pid, d);
        return { ok: true, message: d.message };
    }
    if (action === 'led-receipt-add') { // an older receipt (made before the list existed), found by its link and put in this trader's list
        const token = String(body.token || '').replace(/^.*tradereceipt=/, '').trim();
        if (!/^[A-Za-z0-9_-]{8,40}$/.test(token)) throw new Error('That is not a receipt link.');
        let r = null; try { r = JSON.parse(await redis(['GET', RCPT(token)])); } catch (e) { r = null; }
        if (!r) throw new Error('That receipt was not found.');
        if (String(r.traderId) !== pid) throw new Error('That receipt is not yours.');
        const list = await loadReceiptList(redis, pid);
        if (!list.some(x => x.token === token)) {
            const market = r.market || marketOf(r.lines, (await itemValues(redis, key)).values);
            list.push({ token, tradeId: r.tradeId, partner: r.partner, total: r.total, market, units: r.lines.reduce((t, l) => t + l.qty, 0), source: r.source || 'trade', created: r.created, updated: r.updated });
            list.sort((a, b) => b.created - a.created);
            await redis(['SET', RCPT_LIST(pid), JSON.stringify(list.slice(0, 300))]);
        }
        await redis(['SET', RCPT(token), JSON.stringify(r)]); // an older receipt could still expire: from now on it is kept
        await redis(['SET', RCPT_MAP(pid, r.tradeId), token]); // the same trade keeps this link
        return { ok: true };
    }
    if (action === 'led-receipt-ledger') { // a receipt as a purchase in the trading ledger (the exact prices of the receipt are kept; a set counts as its parts)
        const token = String(body.token || '');
        if (!(await loadReceiptList(redis, pid)).some(x => x.token === token)) throw new Error('That receipt is not in your list.');
        let r = null; try { r = JSON.parse(await redis(['GET', RCPT(token)])); } catch (e) { r = null; }
        if (!r || String(r.traderId) !== pid) throw new Error('That receipt was not found.');
        const items = {}, prices = {}, hasSet = r.lines.some(l => ITEM_SETS[l.name]);
        for (const l of r.lines) { const s = ITEM_SETS[l.name]; if (s) s.parts.forEach(p => { items[p] = (items[p] || 0) + l.qty; }); else { items[l.name] = (items[l.name] || 0) + l.qty; prices[l.name] = l.price; } }
        const t = cleanTrade({ at: new Date(r.created).toISOString().slice(0, 19).replace('T', ' '), partner: r.partner.name, title: 'Receipt', items, itemsDir: 'in', money: r.total, moneyDir: 'out', tradeId: /^\d+$/.test(r.tradeId) ? r.tradeId : '', prices: hasSet ? {} : prices, source: 'receipt' });
        if (!t) throw new Error('There is nothing to add from that receipt.');
        const d = await load(redis, pid);
        if (d.trades.some(x => isSame(x, t))) return { ok: true, added: 0, skipped: 1 };
        d.trades.push(t); d.trades.sort((x, y) => (x.at < y.at ? -1 : 1));
        await save(redis, pid, d);
        return { ok: true, added: 1, skipped: 0, ids: [t.id] };
    }
    if (action === 'led-get') { const d = await load(redis, pid); return { name: who.name, tornId: pid, today: todayIso(), trades: d.trades, pricelist: d.pricelist }; }
    if (action === 'led-pl-get') { const d = await load(redis, pid); return { name: who.name, tornId: pid, pricelist: d.pricelist }; }
    if (action === 'led-pl-save') {
        const d = await load(redis, pid);
        d.pricelist = cleanPricelist({ ...body.pricelist, name: who.name, updated: Date.now() });
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

// the public pricelist page (/pricelist/<tornId>): readable by anybody, only when the trader has chosen to share it. It only reads what is already stored: no Torn call.
const RCPT = t => `wwl:trade-rcpt:${t}`, RCPT_MAP = (p, id) => `wwl:trade-rcpt-map:${p}:${id}`, RCPT_LIST = p => `wwl:trade-rcpt-list:${p}`;
const SCORE = id => `wwl:pl-score:${id}`, VOTES = id => `wwl:pl-votes:${id}`;
async function pricelistPublic(redis, tornId) {
    const id = String(tornId || '').replace(/\D/g, '').slice(0, 10);
    if (!id) return { error: 'Missing trader.' };
    const d = await load(redis, id), pl = d.pricelist;
    if (!pl.shared || !pl.rows.length) return { error: 'This pricelist is not shared (or it is empty).' };
    let data = {}; try { const raw = await redis(['GET', ITEM_DATA]); data = raw ? JSON.parse(raw) : {}; } catch (e) { data = {}; }
    const { values, meta } = withSets(data.values || {}, data.meta || {});
    const items = pl.rows.map(r => ({ name: r.name, id: (meta[r.name] || [])[0] || 0, type: (meta[r.name] || [])[1] || 'Other', price: priceOf(r, pl, values[r.name]) })).filter(i => i.price > 0);
    const real = d.trades.filter(t => !t.manual), last = real.reduce((m, t) => (t.at > m ? t.at : m), ''), weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    let score = 0; try { score = Number(await redis(['GET', SCORE(id)])) || 0; } catch (e) { score = 0; }
    return { name: pl.name || 'Trader', tornId: id, items, pricesAt: data.at || 0, updated: pl.updated || 0, lastTrade: last, trades: real.length, tradesWeek: real.filter(t => t.at.slice(0, 10) >= weekAgo).length, score };
}
// A receipt page (/?tradereceipt=<token>): readable by anybody with the link. The link is a random token; nothing else about the trader is shown.
async function tradeReceiptPublic(redis, token) {
    const t = String(token || '');
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(t)) return { error: 'This receipt link is not right.' };
    let r = null; try { const raw = await redis(['GET', RCPT(t)]); r = raw ? JSON.parse(raw) : null; } catch (e) { r = null; }
    if (!r) return { error: 'This receipt was not found: the link may be wrong, or it is been deleted.' };
    let meta = {}; try { const raw = await redis(['GET', ITEM_DATA]); meta = (raw ? JSON.parse(raw).meta : {}) || {}; } catch (e) { meta = {}; }
    const lines = r.lines.map(l => ({ ...l, id: (meta[l.name] || [])[0] || 0, parts: ITEM_SETS[l.name] ? ITEM_SETS[l.name].parts : undefined }));
    return { trader: r.trader, traderId: r.traderId, tradeId: r.tradeId, partner: { ...r.partner, name: cleanName(r.partner && r.partner.name) }, lines, total: r.total, created: r.created, updated: r.updated };
}
// A vote for a trader on their public pricelist: dir 1 (up), -1 (down) or 0 (take the vote back). One vote per visitor: a visitor is told apart by a hash of their address (nothing readable is kept).
async function pricelistVote(redis, tornId, dir, ip) {
    const id = String(tornId || '').replace(/\D/g, '').slice(0, 10), d = Number(dir) > 0 ? 1 : Number(dir) < 0 ? -1 : 0;
    if (!id) return { error: 'Missing trader.' };
    if (!(await load(redis, id)).pricelist.shared) return { error: 'This pricelist is not shared.' };
    const voter = require('crypto').createHash('sha256').update(`wwl-pl-vote:${ip || 'unknown'}`).digest('hex').slice(0, 20);
    const old = Number(await redis(['HGET', VOTES(id), voter])) || 0;
    if (d !== old) {
        await redis(d ? ['HSET', VOTES(id), voter, String(d)] : ['HDEL', VOTES(id), voter]);
        await redis(['INCRBY', SCORE(id), String(d - old)]);
    }
    return { ok: true, score: Number(await redis(['GET', SCORE(id)])) || 0, mine: d };
}

module.exports = { ledHandle, pricelistPublic, pricelistVote, tradeReceiptPublic, ITEM_SETS };
