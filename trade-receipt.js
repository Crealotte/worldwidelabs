// trade-receipt.js — the public receipt page of a trade (/?tradereceipt=<token>): who paid whom, when, and the price of every item. Anybody with the link can open it, no login (see app-init.js).
// The receipt is made by the trader's userscript (led-receipt-save) and read here without a key (lib/ledger.js tradeReceiptPublic).
'use strict';

async function loadTradeReceipt(token) {
    const box = $('trade-receipt-body');
    let r;
    try {
        const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'trade-receipt', token }) });
        r = JSON.parse(await res.text());
    } catch (e) { r = { error: 'The receipt could not be loaded. Try again in a moment.' }; }
    if (r.error) { box.innerHTML = `<p style="color:var(--muted);">${esc(r.error)}</p>`; return; }
    const money = n => `$${Math.round(n).toLocaleString('en-US')}`, when = r.created ? new Date(r.created).toISOString().slice(0, 16).replace('T', ' ') + ' TCT' : '';
    const who = (name, id) => (id ? `<a href="https://www.torn.com/profiles.php?XID=${esc(id)}" target="_blank" rel="noopener">${esc(name || 'Player')} [${esc(id)}]</a>` : esc(name || 'Player'));
    document.title = `Trade receipt · ${r.trader}`;
    box.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:6px 24px;font-size:13px;color:var(--muted);margin-bottom:10px;">
            ${/^\d+$/.test(r.tradeId) ? `<span>Trade ID <b style="color:var(--text);">${esc(r.tradeId)}</b></span>` : ''}<span>${esc(when)}</span>
            <span>Seller: <b style="color:var(--text);">${who(r.partner && r.partner.name, r.partner && r.partner.id)}</b></span>
            <span>Buyer: <b style="color:var(--text);">${who(r.trader, r.traderId)}</b></span></div>
        <div style="overflow-x:auto;"><table style="border-collapse:collapse;width:100%;font-size:14px;"><thead><tr style="color:var(--muted);font-size:11px;text-align:left;"><th></th><th style="padding:4px 8px;">Item</th><th style="padding:4px 8px;text-align:right;">Quantity</th><th style="padding:4px 8px;text-align:right;">Price</th><th style="padding:4px 8px;text-align:right;">Total</th></tr></thead><tbody>
        ${r.lines.map(l => `<tr style="border-top:1px solid var(--line);"><td style="padding:4px 8px;width:36px;">${l.id ? `<img src="https://www.torn.com/images/items/${l.id}/small.png" width="30" height="30" loading="lazy" alt="" onerror="this.style.visibility='hidden'">` : ''}</td>
            <td style="padding:4px 8px;"><b>${esc(l.name)}</b>${l.parts ? `<details style="font-size:12px;color:var(--muted);"><summary style="cursor:pointer;">What is in it?</summary>${l.parts.map(n => `<div>1 × ${esc(n)}</div>`).join('')}</details>` : ''}</td>
            <td style="padding:4px 8px;text-align:right;font-family:var(--mono);">${l.qty.toLocaleString('en-US')}</td><td style="padding:4px 8px;text-align:right;font-family:var(--mono);">${money(l.price)}</td><td style="padding:4px 8px;text-align:right;font-family:var(--mono);">${money(l.qty * l.price)}</td></tr>`).join('')}
        </tbody><tfoot><tr style="border-top:2px solid var(--line);"><td colspan="4" style="padding:8px;text-align:right;"><b>Total</b></td><td style="padding:8px;text-align:right;font-family:var(--mono);"><b>${money(r.total)}</b></td></tr></tfoot></table></div>
        <p style="font-size:12px;color:var(--muted);margin-top:10px;">The prices are the buyer's pricelist prices at the time of the trade. The trader can delete a receipt; until then it stays here.</p>`;
}
