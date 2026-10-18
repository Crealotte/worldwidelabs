// ledger.js — "Trading ledger": a trader pastes the log of their Torn trades; the page reads the finished trades (what really changed hands), keeps them (lib/ledger.js) and works out what was bought, what was sold and
// the profit on every sale, the stock that is left, and the totals. The owner can open the ledger of every trader with a Trading Funding. Costs are worked out in the browser from the saved trades:
// a buy's money is split over its items by their market value (Torn's value of each item; equal shares for an item without one), a sale takes the cost of its items from the oldest purchases first (first in, first out).
'use strict';

const ledMoney = n => `${n < 0 ? '-' : ''}$${Math.round(Math.abs(n || 0)).toLocaleString('en-US')}`;
const ledItemsText = items => Object.entries(items || {}).map(([n, q]) => `${q}x ${n}`).join(', ');

// ---- reading the pasted log ----
// Lines look like "06:16:51 - 15/10/26 Scheiren traded 17x Cherry Blossom, 23x Crocus to you [view]". Only the lines of a trade that completed count: the ones that say what was traded and the "completed successfully" line.
function ledItemList(s) {
    const o = {};
    // "17x Crocus", or "a 9mm Uzi (Wither)" for a single weapon
    String(s).split(/,\s*/).forEach(p => { const t = p.trim(), m = t.match(/^(\d+)x\s+(.+)$/) || t.match(/^(a|an)\s+(.+)$/); if (m) o[m[2].trim()] = (o[m[2].trim()] || 0) + (Number(m[1]) || 1); });
    return o;
}
function ledParse(text) {
    const trades = [], skipped = [];
    let cur = null;
    const flush = () => { if (!cur) return; if (cur.done && (Object.keys(cur.items).length || cur.money)) trades.push(cur); else if (cur.title !== undefined || cur.partner) skipped.push(cur.partner || 'a trade'); cur = null; };
    const fresh = partner => ({ partner: partner || '', title: '', items: {}, itemsDir: '', money: 0, moneyDir: '', done: false, at: '' });
    for (const raw of String(text || '').split(/\r?\n/)) {
        const m = raw.trim().match(/^(\d\d:\d\d:\d\d) - (\d\d)\/(\d\d)\/(\d\d) (.*?)(?: \[view\])?$/); if (!m) continue;
        const [, time, dd, mm, yy, line] = m; let x;
        const at = `20${yy}-${mm}-${dd} ${time}`;
        // sales and purchases that are not a trade: item market, bazaar, points market (one line each, nothing to wait for)
        const sum = v => Number(String(v).replace(/,/g, '')), nm = v => (v.toLowerCase() === 'points' ? 'Points' : v);
        if ((x = line.match(/^You sold (\d+)x (.+?) on the Item Market to (.+?) for \$([\d,]+)(?: after \$[\d,]+ in fees)?\.?$/))) { trades.push({ at, partner: x[3], title: 'Item Market', items: { [nm(x[2])]: Number(x[1]) }, itemsDir: 'out', money: sum(x[4]), moneyDir: 'in' }); continue; }
        if ((x = line.match(/^You sold (\d+)x (.+?) on your bazaar to (.+?) at \$[\d,]+ each for a total of \$([\d,]+)\.?$/))) { trades.push({ at, partner: x[3], title: 'Bazaar', items: { [nm(x[2])]: Number(x[1]) }, itemsDir: 'out', money: sum(x[4]), moneyDir: 'in' }); continue; }
        if ((x = line.match(/^You sold (\d+)x (.+?) to (.+?) on the points market at \$[\d,]+ each for a total of \$([\d,]+)\.?$/))) { trades.push({ at, partner: x[3], title: 'Points market', items: { [nm(x[2])]: Number(x[1]) }, itemsDir: 'out', money: sum(x[4]), moneyDir: 'in' }); continue; }
        // purchases: the wording is a guess (not seen yet), so only lines that name the quantity, the item and a total are taken
        if ((x = line.match(/^You bought (\d+)x (.+?) (?:on|from|in) .*?(?:for a total of|for) \$([\d,]+)\.?$/))) { trades.push({ at, partner: 'market', title: 'bought', items: { [nm(x[2])]: Number(x[1]) }, itemsDir: 'in', money: sum(x[3]), moneyDir: 'out' }); continue; }
        // a trade that was cancelled or declined: forget it
        if ((x = line.match(/^(.+?) has (?:canceled|cancelled|declined) the trade\.?$/)) || (x = line.match(/^You (?:canceled|cancelled|declined) the trade with (.+?)\.?$/))) { if (cur && cur.partner === x[1]) flush(); continue; }
        if ((x = line.match(/^(?:You initiated a trade with (.+?)|(.+?) initiated a trade with you) titled "(.*)"$/))) { flush(); cur = fresh(x[1] || x[2]); cur.title = x[3]; continue; }
        if ((x = line.match(/^(.+?) traded (.+) to you$/)) && !/^\$/.test(x[2])) { cur = cur || fresh(x[1]); cur.partner = cur.partner || x[1]; Object.assign(cur.items, ledItemList(x[2])); cur.itemsDir = 'in'; cur.at = at; continue; }
        if ((x = line.match(/^(.+?) traded \$([\d,]+) to you$/))) { cur = cur || fresh(x[1]); cur.partner = cur.partner || x[1]; cur.money = Number(x[2].replace(/,/g, '')); cur.moneyDir = 'in'; cur.at = at; continue; }
        if ((x = line.match(/^You traded (.+) to (.+)$/)) && !/^\$/.test(x[1])) { cur = cur || fresh(x[2]); cur.partner = cur.partner || x[2]; Object.assign(cur.items, ledItemList(x[1])); cur.itemsDir = 'out'; cur.at = at; continue; }
        if ((x = line.match(/^You traded \$([\d,]+) to (.+)$/))) { cur = cur || fresh(x[2]); cur.partner = cur.partner || x[2]; cur.money = Number(x[1].replace(/,/g, '')); cur.moneyDir = 'out'; cur.at = at; continue; }
        if ((x = line.match(/^The trade between you and (.+?) completed successfully$/))) { cur = cur || fresh(x[1]); cur.partner = cur.partner || x[1]; cur.done = true; cur.at = at; flush(); continue; }
    }
    flush();
    return { trades: trades.map(t => ({ at: t.at, partner: t.partner, title: t.title, items: t.items, itemsDir: t.itemsDir, money: t.money, moneyDir: t.moneyDir })), skipped };
}
// what kind of trade: items for money (a buy or a sale), items for items, or only money
const ledKind = t => (t.itemsDir === 'in' && t.moneyDir === 'out' ? 'buy' : t.itemsDir === 'out' && t.moneyDir === 'in' ? 'sell' : t.itemsDir && t.moneyDir ? 'other' : t.itemsDir ? 'swap' : 'money');

// ---- the numbers ----
// values: item name -> market value. Splits a sum over items by value (equal shares when no item has a value).
function ledShares(items, total, values) {
    const names = Object.keys(items), w = names.map(n => (values[n] || 0) * items[n]), sum = w.reduce((a, b) => a + b, 0);
    return Object.fromEntries(names.map((n, i) => [n, sum > 0 ? total * w[i] / sum : total * items[n] / names.reduce((a, b) => a + items[b], 0)]));
}
function ledCompute(trades, values) {
    const lots = {}, rows = [], sorted = trades.slice().sort((a, b) => (a.at < b.at ? -1 : 1));
    let bought = 0, sold = 0, profit = 0, soldCost = 0;
    for (const t of sorted) {
        const kind = ledKind(t), row = { ...t, kind, profit: null, cost: null, note: '' };
        if (kind === 'buy') {
            const sh = t.prices ? Object.fromEntries(Object.entries(t.items).map(([n, q]) => [n, (t.prices[n] || 0) * q])) : ledShares(t.items, t.money, values); bought += t.money; // a trade can carry a price per item (then no lump sum is split)
            for (const [n, q] of Object.entries(t.items)) (lots[n] = lots[n] || []).push({ qty: q, unit: sh[n] / q, at: t.at });
        } else if (kind === 'sell') {
            const sh = t.prices && Object.keys(t.prices).length === Object.keys(t.items).length ? Object.fromEntries(Object.entries(t.items).map(([n, q]) => [n, (t.prices[n] || 0) * q])) : ledShares(t.items, t.money, values); sold += t.money;
            let cost = 0, matchedProceeds = 0, lacking = [];
            for (const [n, q] of Object.entries(t.items)) {
                let need = q, took = 0, c = 0;
                for (const lot of (lots[n] || [])) { if (!need) break; const use = Math.min(lot.qty, need); lot.qty -= use; need -= use; took += use; c += use * lot.unit; }
                lots[n] = (lots[n] || []).filter(l => l.qty > 0);
                cost += c; matchedProceeds += sh[n] * took / q;
                if (need) lacking.push(`${need}x ${n}`);
            }
            row.cost = cost; row.profit = matchedProceeds - cost; row.note = lacking.length ? `no purchase in the ledger for ${lacking.join(', ')}: add it by hand` : '';
            profit += row.profit; soldCost += cost;
        }
        rows.push(row);
    }
    const stock = [];
    for (const [n, ls] of Object.entries(lots)) { const q = ls.reduce((s, l) => s + l.qty, 0); if (q) stock.push({ name: n, qty: q, cost: ls.reduce((s, l) => s + l.qty * l.unit, 0), since: ls[0].at }); }
    stock.sort((a, b) => b.cost - a.cost);
    return { rows, stock, bought, sold, profit, soldCost, stockCost: stock.reduce((s, x) => s + x.cost, 0) };
}

// ---- the page ----
let ledData = null, ledValues = {}, ledWho = '', ledTraders = null, ledIsOwner = false, ledLastMsg = null;
async function ledFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}
// Called by login() with the server's access check: the page is for the owner and for the traders of Trading Funding.
function checkLedgerAccess(acc) {
    ledIsOwner = !!(acc && acc.owner);
    const el = document.querySelector('.nav-item[data-page="ledger"]');
    if (el) el.style.display = acc && (acc.owner || acc.trader) ? '' : 'none';
}
async function loadLedger() {
    const st = $('led-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    try {
        const [r, v] = await Promise.all([ledFetch(ledWho ? { action: 'led-owner-get', tornId: ledWho } : { action: 'led-get' }), ledFetch({ action: 'led-values' })]);
        if (r.error) { st.className = 'status err'; st.textContent = r.error; return; }
        ledValues = v.values || {};
        ledData = r;
        if (!ledTraders && ledOwnerNow()) { const t = await ledFetch({ action: 'led-owner-list' }); ledTraders = t.error ? [] : t.traders; }
        st.textContent = v.error ? `Item values are not available (${v.error}): costs are split equally over the items.` : ''; st.className = v.error ? 'status err' : 'status';
        ledRender();
    } catch (e) { st.className = 'status err'; st.textContent = `This page could not load (${e.message}). Reload the page.`; }
}
const ledOwnerNow = () => ledIsOwner;
function ledRender() {
    const r = ledData, mine = !ledWho, c = ledCompute(r.trades, ledValues), box = (l, v, x = '') => `<div><div style="color:var(--muted);font-size:11px;">${l}</div><b style="font-family:var(--mono);${x}">${v}</b></div>`;
    const pct = c.soldCost ? c.profit / c.soldCost * 100 : 0;
    const chooser = ledTraders && ledTraders.length ? `<div class="panel" style="font-size:13px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">Ledger of <select id="led-who"><option value="">my own</option>${ledTraders.map(t => `<option value="${esc(t.tornId)}" ${ledWho === t.tornId ? 'selected' : ''}>${esc(t.name)}${t.active ? '' : ' (ended)'} · ${t.trades} trades</option>`).join('')}</select></div>` : '';
    const tradeRow = t => `<tr style="border-top:1px solid var(--line);"><td style="padding:3px 8px;white-space:nowrap;color:var(--muted);">${esc(t.at.slice(0, 16))}</td><td style="padding:3px 8px;">${t.kind === 'buy' ? 'Bought' : t.kind === 'sell' ? 'Sold' : t.kind === 'swap' ? 'Swapped' : t.kind === 'money' ? 'Money' : 'Traded'}</td><td style="padding:3px 8px;">${esc(t.partner)}</td>
        <td style="padding:3px 8px;max-width:340px;">${esc(ledItemsText(t.items)) || '—'}${t.note ? `<div style="font-size:11px;color:#e0a030;">${esc(t.note)}</div>` : ''}</td><td style="padding:3px 8px;text-align:right;font-family:var(--mono);">${t.money ? `${t.moneyDir === 'out' ? '-' : '+'}${ledMoney(t.money)}` : ''}</td>
        <td style="padding:3px 8px;text-align:right;font-family:var(--mono);color:${t.profit === null ? 'var(--muted)' : t.profit >= 0 ? 'var(--success,#35d99b)' : 'var(--danger)'};">${t.profit === null ? '' : `${t.profit >= 0 ? '+' : ''}${ledMoney(t.profit)}`}</td>${mine ? `<td style="padding:3px 8px;"><button class="ghost small led-del" data-id="${esc(t.id)}" type="button" title="Remove this trade">✕</button></td>` : '<td></td>'}</tr>`;
    $('led-body').innerHTML = `${chooser}
        ${mine ? `<div class="panel"><h3 style="margin-top:0;">Add trades</h3>
            <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">Paste the lines of your <b>Torn trade log</b>. They are read and added straight away, and you can undo it. A log has one sum for the whole trade, so the cost is split over the items by their market value. Several trades in one go are fine, and a trade that is in the ledger already is skipped.</div>
            <textarea id="led-paste" rows="4" placeholder="Paste your trade log here, lines like 05:34:50 - 15/10/26 Name initiated a trade with you titled ..." style="width:100%;font-family:var(--mono);font-size:12px;"></textarea>
            <div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;"><button id="led-read" type="button">Add what is pasted</button><span id="led-preview" style="font-size:13px;"></span></div></div>
        <details class="panel"><summary class="av-sum"><b>Add a purchase or a sale by hand</b> <span style="font-size:12px;color:var(--muted);">(bought in a bazaar, sold at the auction house, or anything else that has no line in the log)</span></summary>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px;"><select id="led-h-dir"><option value="in">I bought</option><option value="out">I sold</option></select><select id="led-h-where"><option>Bazaar</option><option>Item Market</option><option>Auction house</option><option>Points market</option><option>Other</option></select><input id="led-h-items" type="text" placeholder="5x Armor Cache, 2x Melee Cache, or a 9mm Uzi" style="width:280px;"><input id="led-h-money" type="text" inputmode="decimal" placeholder="Total money (580m)" style="width:150px;text-align:right;font-family:var(--mono);"><input id="led-h-date" type="date" value="${esc(r.today || '')}"><button id="led-h-add" class="ghost small" type="button">Add it</button></div></details>` : ''}
        <div class="panel" style="display:flex;gap:26px;flex-wrap:wrap;font-size:13px;">${box('Bought', ledMoney(c.bought))}${box('Sold', ledMoney(c.sold))}${box('Profit on what is sold', `${c.profit >= 0 ? '+' : ''}${ledMoney(c.profit)}`, `color:${c.profit >= 0 ? 'var(--success,#35d99b)' : 'var(--danger)'};`)}${box('Return on what is sold', c.soldCost ? `${pct.toFixed(1)}%` : '—')}${box('Stock now (at cost)', ledMoney(c.stockCost))}${box('Trades', r.trades.length)}</div>
        ${c.stock.length ? `<div class="panel"><h3 style="margin-top:0;">Stock</h3><table style="border-collapse:collapse;font-size:13px;"><thead><tr style="color:var(--muted);font-size:11px;text-align:left;"><th style="padding:2px 14px 2px 0;">Item</th><th style="padding:2px 14px 2px 0;">Left</th><th style="padding:2px 14px 2px 0;">At cost</th><th style="padding:2px 0;">Since</th></tr></thead><tbody>${c.stock.map(s => `<tr><td style="padding:2px 14px 2px 0;">${esc(s.name)}</td><td style="padding:2px 14px 2px 0;font-family:var(--mono);">${s.qty}</td><td style="padding:2px 14px 2px 0;font-family:var(--mono);">${ledMoney(s.cost)}</td><td style="padding:2px 0;color:var(--muted);">${esc(s.since.slice(0, 10))}</td></tr>`).join('')}</tbody></table></div>` : ''}
        <div class="panel" style="overflow-x:auto;"><h3 style="margin-top:0;">Trades</h3>${r.trades.length ? `<table style="border-collapse:collapse;font-size:13px;width:100%;"><thead><tr style="color:var(--muted);font-size:11px;text-align:left;"><th style="padding:2px 8px;">When</th><th style="padding:2px 8px;">What</th><th style="padding:2px 8px;">With</th><th style="padding:2px 8px;">Items</th><th style="padding:2px 8px;text-align:right;">Money</th><th style="padding:2px 8px;text-align:right;">Profit</th><th></th></tr></thead><tbody>${c.rows.slice().reverse().map(tradeRow).join('')}</tbody></table>` : '<div style="color:var(--muted);font-size:13px;">No trades yet.</div>'}</div>`;
    $('led-who')?.addEventListener('change', e => { ledWho = e.target.value; loadLedger(); });
    document.querySelectorAll('.led-del').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Remove this trade from the ledger?')) return;
        const res = await ledFetch({ action: 'led-del', id: b.dataset.id });
        if (res.error) { toast(res.error); return; }
        loadLedger();
    }));
    if (!mine) return;
    // paste -> read -> add, in one go: the result can be undone (the message stays after the page is drawn again)
    const wireUndo = ids => $('led-undo')?.addEventListener('click', async e => {
        e.preventDefault();
        for (const id of ids) await ledFetch({ action: 'led-del', id });
        ledLastMsg = null; toast('Removed again'); loadLedger();
    });
    if (ledLastMsg) { $('led-preview').innerHTML = ledLastMsg.html; wireUndo(ledLastMsg.ids); }
    const ingest = async () => {
        const text = $('led-paste').value, pv = $('led-preview');
        if (!text.trim()) { pv.innerHTML = '<span style="color:var(--muted);">Paste something first.</span>'; return; }
        const p = ledParse(text);
        if (!p.trades.length) { pv.innerHTML = `<span style="color:var(--danger);">I could not find a finished trade in that text.${(p.skipped || []).length ? ` ${esc(p.skipped.join('; '))}.` : ''}</span>`; return; }
        pv.textContent = 'Adding…';
        const res = await ledFetch({ action: 'led-add', trades: p.trades });
        if (res.error) { pv.innerHTML = `<span style="color:var(--danger);">${esc(res.error)}</span>`; return; }
        const k = { buy: 0, sell: 0, other: 0 }; p.trades.forEach(t => { const kind = ledKind(t); k[kind === 'buy' ? 'buy' : kind === 'sell' ? 'sell' : 'other']++; });
        const ids = res.ids || [];
        ledLastMsg = { ids, html: `<span style="color:var(--success,#35d99b);"><b>${res.added}</b> added${res.skipped ? `, ${res.skipped} were in the ledger already` : ''} (${k.buy} bought, ${k.sell} sold${k.other ? `, ${k.other} other` : ''}${(p.skipped || []).length ? `, ${p.skipped.length} skipped` : ''}).</span>${ids.length ? ' <a href="#" id="led-undo" style="margin-left:6px;">Undo</a>' : ''}` };
        await loadLedger();
    };
    $('led-read').addEventListener('click', ingest);
    $('led-paste').addEventListener('paste', () => setTimeout(ingest, 60));
    $('led-h-add').addEventListener('click', async () => {
        const items = ledItemList($('led-h-items').value), money = finParse($('led-h-money').value), date = $('led-h-date').value;
        if (!Object.keys(items).length) { toast('Write the items as 5x Armor Cache, 2x Melee Cache'); return; }
        if (!money) { toast('Write the total money, for example 580m'); return; }
        const sold = $('led-h-dir').value === 'out', where = $('led-h-where').value;
        const res = await ledFetch({ action: 'led-add', trades: [{ at: `${date || r.today} 12:00:00`, partner: where, title: 'by hand', items, itemsDir: sold ? 'out' : 'in', money, moneyDir: sold ? 'in' : 'out', manual: true }] });
        if (res.error) { toast(res.error); return; }
        toast(res.added ? (sold ? 'Sale added' : 'Purchase added') : 'That one was already there'); loadLedger();
    });
}
