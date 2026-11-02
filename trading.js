// trading.js — the tabs of the Trading page next to the ledger (ledger.js): Overview (the last 24 hours, a quick receipt generator, the message that goes with a receipt), Purchases (every receipt, with
// a link to open it) and Partners (per seller). A receipt is the page of a trade at your pricelist prices: made by the userscript while you trade, or by hand from the lines of a trade log.
// Needs ledger.js (ledFetch, ledMoney, ledItemList). The data comes from lib/ledger.js (led-rcpt-list, led-receipt-make, ...).
'use strict';

let trdData = null, trdTab = 'overview', trdResult = '';
const TRD_TABS = [['overview', 'Overview'], ['purchases', 'Purchases'], ['partners', 'Partners'], ['ledger', 'Ledger & profit']];
const trdUrl = token => `${location.origin}/?tradereceipt=${token}`;
const trdWhen = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const trdNum = r => r.units || 0;
const trdSaving = r => (r.market || 0) - (r.total || 0);
const trdSavingHtml = (s, market) => `<span style="color:${s >= 0 ? 'var(--success,#35d99b)' : 'var(--danger)'};font-family:var(--mono);">${s >= 0 ? '+' : '-'}${ledMoney(Math.abs(s))}</span> <span style="font-size:11px;color:var(--muted);">(${market ? `${s >= 0 ? '+' : '-'}${Math.abs(s / market * 100).toFixed(2)}%` : '0.00%'})</span>`;

function trdTabs() {
    const v = trdData && trdData.vip, vipLine = !trdData ? '' : v && v.active ? (v.reason === 'license' ? `<span style="font-size:12px;color:var(--success,#35d99b);margin-left:8px;">★ VIP until ${esc(trdWhen(v.until).slice(0, 10))} (${Math.max(1, Math.ceil((v.until - Date.now()) / 86400000))} days left) <a href="#" id="trd-renew">Renew</a></span>` : `<span style="font-size:12px;color:var(--success,#35d99b);margin-left:8px;">★ ${v.reason === 'owner' ? 'Owner' : 'Trading Funding'}: the ledger is yours</span>`) : '<span style="font-size:12px;color:var(--muted);margin-left:8px;">Ledger &amp; profit is VIP</span>';
    $('trd-tabs').innerHTML = TRD_TABS.map(([k, label]) => `<button class="${trdTab === k ? '' : 'ghost'} small trd-tab" data-tab="${k}" type="button">${label}${k === 'ledger' && trdData && !(trdData.vip && trdData.vip.active) ? ' 🔒' : ''}</button>`).join(' ') + vipLine;
    $('trd-tabs').querySelectorAll('.trd-tab').forEach(b => b.addEventListener('click', () => { trdTab = b.dataset.tab; trdRender(); }));
    const rn = $('trd-renew'); if (rn) rn.addEventListener('click', e => { e.preventDefault(); trdTab = 'vip'; trdRender(); });
}
function trdTable(rows) {
    if (!rows.length) return '<div style="color:var(--muted);font-size:13px;">No receipts yet.</div>';
    const th = (t, right) => `<th style="padding:6px 8px;text-align:${right ? 'right' : 'left'};color:var(--muted);font-size:11px;">${t}</th>`;
    const ids = new Set(trdData.ledgerIds || []);
    return `<div style="overflow-x:auto;"><table style="border-collapse:collapse;width:100%;font-size:13px;"><thead><tr>${th('DATE')}${th('SELLER')}${th('SOURCE')}${th('PAID', 1)}${th('VS MARKET', 1)}${th('ITEMS', 1)}${th('RECEIPT')}${th('')}</tr></thead><tbody>${rows.map(r => {
        const inLedger = /^\d+$/.test(r.tradeId) && ids.has(r.tradeId);
        return `<tr style="border-top:1px solid var(--line);"><td style="padding:5px 8px;white-space:nowrap;color:var(--muted);">${esc(trdWhen(r.created))}</td><td style="padding:5px 8px;">${esc(r.partner && r.partner.name || '—')}</td>
            <td style="padding:5px 8px;"><span style="font-size:11px;padding:1px 6px;border-radius:4px;background:rgba(80,130,255,.18);">${r.source === 'manual' ? 'Manual' : 'Trade'}</span></td>
            <td style="padding:5px 8px;text-align:right;font-family:var(--mono);">${ledMoney(r.total)}</td><td style="padding:5px 8px;text-align:right;">${trdSavingHtml(trdSaving(r), r.market)}</td><td style="padding:5px 8px;text-align:right;">${trdNum(r)}</td>
            <td style="padding:5px 8px;white-space:nowrap;"><a href="${esc(trdUrl(r.token))}" target="_blank" rel="noopener">Open</a> <button class="ghost small trd-copy" data-token="${esc(r.token)}" type="button" title="Copy the link">Copy link</button></td>
            <td style="padding:5px 8px;white-space:nowrap;">${inLedger ? '<span style="color:var(--success,#35d99b);font-size:12px;">✓ in ledger</span>' : `<button class="ghost small trd-ledger" data-token="${esc(r.token)}" type="button" title="Add this purchase to the trading ledger">Add to ledger</button>`} <button class="ghost small trd-del" data-token="${esc(r.token)}" type="button" style="color:var(--danger);">Delete</button></td></tr>`;
    }).join('')}</tbody></table></div>`;
}
function trdOverview() {
    const day = (trdData.receipts || []).filter(r => Date.now() - r.created < 86400000), paid = day.reduce((s, r) => s + r.total, 0), market = day.reduce((s, r) => s + (r.market || 0), 0);
    const box = (l, v) => `<div class="panel" style="margin:0;flex:1;min-width:200px;"><div style="color:var(--muted);font-size:12px;">${l}</div><div style="font-size:22px;font-weight:700;">${v}</div></div>`;
    return `${trdScriptHtml(ledIsOwner)}<div style="display:flex;gap:12px;flex-wrap:wrap;">${box('Trades in the past 24h', day.length)}${box('Bought total (past 24h)', ledMoney(paid))}${box('Estimated savings vs market (past 24h)', trdSavingHtml(market - paid, market))}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;margin-top:12px;">
        <div class="panel" style="margin:0;"><h3 style="margin-top:0;">Quick Receipt Generator</h3>
            <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">Paste the lines of a trade (like <i>shukolza added 10x Sheep Plushie to the trade.</i>) or just the items (<i>10x Sheep Plushie, 1x Xanax</i>). Only the items the other player added are used; money, accepts and cancels are ignored. The prices come from your pricelist.</div>
            <textarea id="trd-log" rows="4" placeholder="09:21:21 - 18/10/26&#10;shukolza added 10x Sheep Plushie to the trade." style="width:100%;font-family:var(--mono);font-size:12px;"></textarea>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;"><input id="trd-seller" type="text" placeholder="Seller name (filled in from the lines)" style="flex:1;min-width:160px;"><input id="trd-sellerid" type="text" inputmode="numeric" placeholder="Seller player ID (optional)" style="width:190px;"><input id="trd-tid" type="text" inputmode="numeric" placeholder="Trade ID (optional)" style="width:160px;"></div>
            <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-top:8px;font-size:13px;"><label style="display:inline-flex;gap:6px;align-items:center;"><input id="trd-inclmsg" type="checkbox" style="width:auto;"> Include my custom message</label><label style="display:inline-flex;gap:6px;align-items:center;"><input id="trd-toledger" type="checkbox" checked style="width:auto;"> Also add it to my ledger</label><button id="trd-make" type="button">Generate</button></div>
            <div id="trd-result" style="margin-top:8px;font-size:13px;">${trdResult}</div>
            <div style="margin-top:10px;font-size:12px;color:var(--muted);">A receipt you made earlier, before this list existed? Paste its link: <input id="trd-addlink" type="text" placeholder="https://…/?tradereceipt=…" style="width:260px;max-width:100%;"> <button id="trd-addbtn" class="ghost small" type="button">Add it</button></div></div>
        <div class="panel" style="margin:0;"><h3 style="margin-top:0;">Custom Receipt Message</h3>
            <textarea id="trd-msg" rows="5" placeholder="Thank you {seller}! Trades: {trades_total} total, {trades_weekly} this week. Total: {buy_price}. See your {receipt}." style="width:100%;font-size:13px;">${esc(trdData.message || '')}</textarea>
            <div style="font-size:12px;color:var(--muted);margin:6px 0;">Variables: {seller}, {trades_total}, {trades_weekly}, {buy_price}, {market_total}, {pricelist}, {receipt}. The userscript offers it as a "Copy message" button next to the receipt.</div>
            <button id="trd-msgsave" type="button">Save</button></div></div>
        <div class="panel" style="margin-top:12px;"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;"><h3 style="margin:0;">Recent purchases</h3><button id="trd-more" class="ghost small" type="button">View purchases</button></div><div style="font-size:12px;color:var(--muted);margin:4px 0 8px;">Receipts from sellers at your list.</div>${trdTable((trdData.receipts || []).slice(0, 10))}</div>`;
}
function trdPartners() {
    const by = {};
    for (const r of trdData.receipts || []) { const k = (r.partner && r.partner.name) || '—', p = by[k] || (by[k] = { name: k, id: r.partner && r.partner.id, n: 0, paid: 0, market: 0, last: 0 }); p.n++; p.paid += r.total; p.market += r.market || 0; p.last = Math.max(p.last, r.created); }
    const rows = Object.values(by).sort((a, b) => b.paid - a.paid), th = (t, right) => `<th style="padding:6px 8px;text-align:${right ? 'right' : 'left'};color:var(--muted);font-size:11px;">${t}</th>`;
    if (!rows.length) return '<div class="panel" style="color:var(--muted);font-size:13px;">No sellers yet.</div>';
    return `<div class="panel" style="overflow-x:auto;"><table style="border-collapse:collapse;width:100%;font-size:13px;"><thead><tr>${th('SELLER')}${th('TRADES', 1)}${th('PAID', 1)}${th('VS MARKET', 1)}${th('LAST')}</tr></thead><tbody>${rows.map(p => `<tr style="border-top:1px solid var(--line);"><td style="padding:5px 8px;">${p.id ? `<a href="https://www.torn.com/profiles.php?XID=${esc(p.id)}" target="_blank" rel="noopener">${esc(p.name)}</a>` : esc(p.name)}</td><td style="padding:5px 8px;text-align:right;">${p.n}</td><td style="padding:5px 8px;text-align:right;font-family:var(--mono);">${ledMoney(p.paid)}</td><td style="padding:5px 8px;text-align:right;">${trdSavingHtml(p.market - p.paid, p.market)}</td><td style="padding:5px 8px;color:var(--muted);">${esc(trdWhen(p.last))}</td></tr>`).join('')}</tbody></table></div>`;
}
// what a pasted trade log or item list holds: the items the other player added (minus what they took out again), and who they are
function trdParse(text) {
    const items = {}; let seller = '', found = false;
    const add = (list, sign) => { for (const [n, q] of Object.entries(ledItemList(list))) { items[n] = (items[n] || 0) + sign * q; if (items[n] <= 0) delete items[n]; } };
    for (const raw of String(text || '').split(/\r?\n/)) {
        const line = raw.trim().replace(/^\d\d:\d\d:\d\d - \d\d\/\d\d\/\d\d\s*/, '').replace(/\s*\[view\]$/, ''); let m;
        if ((m = line.match(/^(.+?) added (.+?) to (?:the|a) trade(?: with .+?)?\.?$/i)) && m[1].toLowerCase() !== 'you' && !/^\$/.test(m[2])) { found = true; seller = seller || m[1]; add(m[2], 1); }
        else if ((m = line.match(/^(.+?) removed (.+?) from (?:the|a) trade(?: with .+?)?\.?$/i)) && m[1].toLowerCase() !== 'you' && !/^\$/.test(m[2])) { found = true; add(m[2], -1); }
    }
    if (!found) add(String(text || '').replace(/[\r\n]+/g, ', '), 1);
    return { items, seller };
}
async function trdMake() {
    const out = $('trd-result'), text = $('trd-log').value;
    if (!text.trim()) { out.innerHTML = '<span style="color:var(--muted);">Paste the lines or the items first.</span>'; return; }
    const p = trdParse(text);
    if (!Object.keys(p.items).length) { out.innerHTML = '<span style="color:var(--danger);">I could not find any items in that. Write them like 10x Sheep Plushie.</span>'; return; }
    const seller = $('trd-seller').value.trim() || p.seller; if (!$('trd-seller').value.trim() && p.seller) $('trd-seller').value = p.seller;
    out.textContent = 'Making the receipt…';
    const res = await ledFetch({ action: 'led-receipt-make', partner: { name: seller, id: $('trd-sellerid').value.trim() }, items: p.items, tradeId: $('trd-tid').value.trim(), base: location.origin });
    if (res.error) { out.innerHTML = `<span style="color:var(--danger);">${esc(res.error)}</span>`; return; }
    let ledgerNote = '';
    if ($('trd-toledger').checked) { const l = await ledFetch({ action: 'led-receipt-ledger', token: res.token }); ledgerNote = l.error ? ` (not added to the ledger: ${esc(l.error)})` : l.added ? ' Added to your ledger.' : ' It was in your ledger already.'; }
    const url = trdUrl(res.token), msg = $('trd-inclmsg').checked ? res.message : '';
    trdResult = `<div style="color:var(--success,#35d99b);">Receipt made: <b>${ledMoney(res.total)}</b>.${ledgerNote}</div><div style="margin-top:4px;"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a> <button id="trd-rcopy" class="ghost small" type="button">Copy link</button>${msg ? ' <button id="trd-rmsg" class="ghost small" type="button">Copy message</button>' : ''}</div>${(res.unpriced || []).length ? `<div style="color:#e0a030;margin-top:4px;">Not on your pricelist, so left out: ${esc(res.unpriced.join(', '))}.</div>` : ''}`;
    await loadTrading();
    const rc = $('trd-rcopy'); if (rc) rc.addEventListener('click', () => navigator.clipboard.writeText(url).then(() => toast('Link copied'), () => toast('Copying was not allowed here')));
    const rm = $('trd-rmsg'); if (rm) rm.addEventListener('click', () => navigator.clipboard.writeText(msg).then(() => toast('Message copied'), () => toast('Copying was not allowed here')));
}
function trdWire() {
    const body = $('trd-body');
    trdWireScript();
    // VIP: the code and the check
    const sb = $('trd-subscribe');
    if (sb) sb.addEventListener('click', async () => { const r = await ledFetch({ action: 'lic-subscribe' }); if (r.error) { toast(r.error); return; } trdData.code = r.code; trdRender(); });
    const nc = $('trd-newcode');
    if (nc) nc.addEventListener('click', async e => { e.preventDefault(); if (!confirm('Get a new message? The old one stops working, so a Xanax that was sent with it and not yet checked will not count.')) return; const r = await ledFetch({ action: 'lic-subscribe', fresh: true }); if (r.error) { toast(r.error); return; } trdData.code = r.code; trdRender(); toast('New message ready'); });
    const cc = $('trd-codecopy'); if (cc) cc.addEventListener('click', () => navigator.clipboard.writeText(trdData.code).then(() => toast('Code copied'), () => toast('Copying was not allowed here')));
    const lc = $('trd-liccheck');
    if (lc) {
        let tries = 0;
        const run = async () => {
            const msg = $('trd-licmsg'); if (!msg) return; // the page was left
            msg.textContent = 'Checking…'; lc.disabled = true;
            const r = await ledFetch({ action: 'lic-check' }); lc.disabled = false;
            if (r.error) { msg.innerHTML = `<span style="color:var(--danger);">${esc(r.error)}</span>`; return; }
            if (r.manual || r.wait || r.noCode) { msg.textContent = r.message; return; }
            if (r.granted || r.active) { msg.innerHTML = `<span style="color:var(--success,#35d99b);">VIP is on until ${esc(trdWhen(r.until).slice(0, 10))}.</span>`; await loadTrading(); if (typeof loadLedger === 'function') loadLedger(); return; }
            if (r.withoutCode) { msg.textContent = 'I see a Xanax from you, but without your message in it. Send it again with the message above, or ask the owner to give you VIP by hand.'; return; }
            if (r.used) { msg.textContent = 'That Xanax was counted already.'; return; }
            if (++tries <= 6) { msg.textContent = `I do not see your Xanax yet. It can take a minute to show up: checking again in 20 seconds (${tries}/6)…`; setTimeout(run, 20000); } else msg.textContent = 'Still nothing. Press the button again in a while, or ask the owner to check.';
        };
        lc.addEventListener('click', () => { tries = 0; run(); });
    }
    // the owner's tools
    const ls = $('trd-lic-show');
    if (ls) ls.addEventListener('click', async () => { const r = await ledFetch({ action: 'lic-list' }); if (r.error) { toast(r.error); return; } trdLicHtml = r.licenses.length ? r.licenses.map(l => `<div>${esc(l.name || '?')} [${esc(l.tornId)}] — ${l.until > Date.now() ? 'VIP until' : 'ended'} ${esc(trdWhen(l.until).slice(0, 10))}</div>`).join('') : 'No VIPs yet.'; $('trd-lic').innerHTML = trdLicHtml; });
    const lg = $('trd-lic-give');
    if (lg) lg.addEventListener('click', async () => { const r = await ledFetch({ action: 'lic-grant', tornId: $('trd-lic-id').value, days: $('trd-lic-days').value }); if (r.error) { toast(r.error); return; } toast(`VIP of ${r.name ? r.name + ' ' : ''}[${r.tornId}] runs until ${trdWhen(r.until).slice(0, 10)}`); });
    const lscan = $('trd-lic-scan');
    if (lscan) lscan.addEventListener('click', async () => { const r = await ledFetch({ action: 'lic-scan' }); if (r.error) { toast(r.error); return; } trdLicHtml = r.done.length ? r.done.map(d => `<div>VIP for ${esc(d.name || '?')} [${esc(d.tornId)}]: ${d.days} days${d.qtyKnown ? '' : ' (quantity not shown by Torn, counted as 1 Xanax)'}</div>`).join('') : `Nothing new to give (${r.gifts} Xanax gifts looked at).`; $('trd-lic').innerHTML = trdLicHtml; });
    const lp = $('trd-lic-peek');
    if (lp) lp.addEventListener('click', async () => { const r = await ledFetch({ action: 'lic-peek' }); if (r.error) { toast(r.error); return; } trdLicHtml = `${r.events} events; Xanax-style gifts: ${r.gifts.length ? '' : 'none'}${r.gifts.map(g => `<div>${esc(trdWhen(g.ts * 1000))} from ${esc(g.senderName || g.sender)}${g.sender ? ` [${esc(g.sender)}]` : ''}: ${g.qtyKnown ? g.qty + 'x' : 'some'} ${esc(g.item)} — "${esc(g.message)}" → <b>${esc(g.state)}</b></div>`).join('')}`; $('trd-lic').innerHTML = trdLicHtml; });
    const mk = $('trd-make'); if (mk) mk.addEventListener('click', trdMake);
    const more = $('trd-more'); if (more) more.addEventListener('click', () => { trdTab = 'purchases'; trdRender(); });
    const ms = $('trd-msgsave'); if (ms) ms.addEventListener('click', async () => { const r = await ledFetch({ action: 'led-msg-save', message: $('trd-msg').value }); if (r.error) { toast(r.error); return; } trdData.message = r.message; toast('Message saved'); });
    const ab = $('trd-addbtn'); if (ab) ab.addEventListener('click', async () => { const r = await ledFetch({ action: 'led-receipt-add', token: $('trd-addlink').value }); if (r.error) { toast(r.error); return; } toast('Receipt added'); trdResult = ''; await loadTrading(); });
    body.querySelectorAll('.trd-copy').forEach(b => b.addEventListener('click', () => navigator.clipboard.writeText(trdUrl(b.dataset.token)).then(() => toast('Link copied'), () => toast('Copying was not allowed here'))));
    body.querySelectorAll('.trd-ledger').forEach(b => b.addEventListener('click', async () => { const r = await ledFetch({ action: 'led-receipt-ledger', token: b.dataset.token }); if (r.error) { toast(r.error); return; } toast(r.added ? 'Added to your ledger' : 'It was in your ledger already'); await loadTrading(); if (typeof loadLedger === 'function') loadLedger(); }));
    body.querySelectorAll('.trd-del').forEach(b => b.addEventListener('click', async () => { if (!confirm('Delete this receipt? Its link stops working.')) return; const r = await ledFetch({ action: 'led-receipt-del', token: b.dataset.token }); if (r.error) { toast(r.error); return; } toast('Receipt deleted'); await loadTrading(); }));
}
// What a trader without VIP sees on the ledger tab (and what somebody with VIP sees under Renew): subscribe, get a message of their own, send a Xanax with it
function trdLock(renew) {
    const v = trdData, vp = v.vip || {}, owner = `<a href="https://www.torn.com/profiles.php?XID=${esc(v.ownerId)}" target="_blank" rel="noopener">CreaLotte [${esc(v.ownerId)}]</a>`;
    const intro = renew ? '' : `<p style="font-size:13px;">Keep track of what you bought, what you sold, the profit on every sale, your stock and what you made per month. VIP costs <b>${esc(v.price || '1 Xanax per 7 days')}</b>. Everything else on this page (the pricelist, the receipts, Overview, Purchases and Partners) stays free. A trader with a Trading Funding has the ledger without paying.</p>
        <p style="font-size:13px;color:var(--muted);">Your trades keep being saved while you have no VIP, nothing is lost: you see them again as soon as VIP is on.${vp.until ? ` Your last VIP ended on ${esc(trdWhen(vp.until).slice(0, 10))}.` : ''}</p>`;
    const body = !v.code
        ? `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;"><button id="trd-subscribe" type="button">Subscribe to VIP</button><span style="font-size:13px;color:var(--muted);">You get a message of your own to send with the Xanax. Only a Xanax with that message counts, so other Xanax you send are never taken for a payment.</span></div>`
        : `<ol style="font-size:13px;line-height:1.7;padding-left:20px;">
            <li>Send <b>1 Xanax</b> to ${owner} (one Xanax per 7 days, send 2 for 14 days).</li>
            <li>Write exactly this in the message of the Xanax: <code id="trd-code" style="padding:2px 8px;border:1px solid var(--line);border-radius:4px;font-family:var(--mono);">${esc(v.code)}</code> <button id="trd-codecopy" class="ghost small" type="button">Copy the message</button></li>
            <li>Press <b>I sent it</b>. WWL looks at the Xanax CreaLotte received, and switches VIP on by itself.</li></ol>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;"><button id="trd-liccheck" type="button">I sent it — check now</button><span id="trd-licmsg" style="font-size:13px;"></span></div>
        <div style="font-size:12px;color:var(--muted);margin-top:8px;">Use the same message for every renewal. <a href="#" id="trd-newcode">Get a new message</a> (the old one then stops working).</div>`;
    return `<div class="panel"><h3 style="margin-top:0;">${renew ? '★ Renew VIP' : '🔒 Ledger &amp; profit is VIP'}</h3>${intro}${body}</div>`;
}
// the owner's own tools: who has VIP, giving or taking days by hand, and a look at the Xanax gifts WWL can see
function trdOwnerTools() {
    return `<div class="panel"><h3 style="margin-top:0;">VIP licenses (owner)</h3><div id="trd-lic" style="font-size:13px;">${trdLicHtml}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px;"><input id="trd-lic-id" type="text" inputmode="numeric" placeholder="Torn ID" style="width:120px;"><input id="trd-lic-days" type="text" inputmode="numeric" placeholder="days (7, or -7 to take away)" style="width:200px;"><button id="trd-lic-give" class="ghost small" type="button">Give VIP days</button><button id="trd-lic-show" class="ghost small" type="button">Show the VIPs</button><button id="trd-lic-scan" class="ghost small" type="button">Apply payments now</button><button id="trd-lic-peek" class="ghost small" type="button">What Xanax can WWL see?</button></div>
        <div style="font-size:12px;color:var(--muted);margin-top:6px;">Automatic checking needs the server setting WWL_OWNER_KEY (your key with Limited access) in Vercel. ${trdData.auto ? 'It is set.' : '<b style="color:#e0a030;">It is not set yet.</b>'}</div></div>`;
}
let trdLicHtml = '';
function trdRender() {
    trdTabs();
    const locked = trdTab === 'ledger' && trdData && !(trdData.vip && trdData.vip.active), showLedger = trdTab === 'ledger' && !locked;
    $('trd-body').style.display = showLedger ? 'none' : ''; $('led-body').style.display = showLedger ? '' : 'none'; $('led-status').style.display = showLedger ? '' : 'none';
    if (showLedger || !trdData) return;
    const isOwner = trdData.vip && trdData.vip.reason === 'owner';
    $('trd-body').innerHTML = locked ? trdLock(false) : trdTab === 'vip' ? trdLock(true) : trdTab === 'purchases' ? `<div class="panel"><h3 style="margin-top:0;">Purchases</h3>${trdTable(trdData.receipts || [])}</div>` : trdTab === 'partners' ? trdPartners() : trdOverview() + (isOwner ? trdOwnerTools() : '');
    trdWire();
}
async function loadTrading() {
    await trdLoadScriptInfo();
    if (!trdData) { trdTabs(); if (trdTab !== 'ledger') $('trd-body').innerHTML = '<div class="panel" style="color:var(--muted);">Loading…</div>'; trdRender(); }
    const r = await ledFetch({ action: 'led-rcpt-list' });
    if (r.error) { $('trd-body').innerHTML = `<div class="panel" style="color:var(--danger);">${esc(r.error)}</div>`; return; }
    trdData = r; trdRender();
}

// ---- the Labs Assistant: where to install it (shown on the Pricelist and Receipts & ledger pages) ----
// The trade bar on Torn's trade pages (total at your pricelist, receipt link, Accept check, auto-save of finished trades) is part of the Labs Assistant.
let trdScriptInfo = null;
async function trdLoadScriptInfo() {
    if (trdScriptInfo) return trdScriptInfo;
    try { const r = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'script-version' }) }); trdScriptInfo = await r.json(); } catch (e) { trdScriptInfo = {}; }
    return trdScriptInfo;
}
function trdScriptHtml(isOwner) {
    const info = trdScriptInfo || {}, file = '/worldwidelabs.user.js';
    return `<div class="panel" id="trd-script" style="margin:0 0 12px;"><div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between;"><div style="flex:1;min-width:240px;"><b>📲 The Labs Assistant for Torn</b>
        <div style="font-size:13px;color:var(--muted);margin-top:2px;">${info.tradeHelper === false ? 'The trade bar comes with the next update of the script; install it now and it updates by itself. ' : ''}On Torn's trade pages it shows the total at your pricelist, a link to the receipt, an Accept check, and saves your finished trades.</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;"><a href="${file}" target="_blank" rel="noopener" style="text-decoration:none;"><button type="button">Install the Labs Assistant</button></a>${isOwner ? '<a href="/worldwidelabs-dev.user.js" target="_blank" rel="noopener" style="text-decoration:none;"><button type="button" class="ghost small">Install DEV (test)</button></a>' : ''}<a href="#" id="trd-script-copy" style="font-size:12px;">copy the link</a></div></div>
        <div style="font-size:12px;color:var(--muted);margin-top:6px;">On a computer you need <b>Tampermonkey</b> (or a similar script manager) first. On TornPDA, add it as a script in the app. If the button only opens a page, copy the link and paste it into your script manager.</div></div>`;
}
function trdWireScript() {
    const c = $('trd-script-copy');
    if (c) c.addEventListener('click', e => { e.preventDefault(); navigator.clipboard.writeText(`${location.origin}/worldwidelabs.user.js`).then(() => toast('Script link copied'), () => toast(`Copy this link: ${location.origin}/worldwidelabs.user.js`)); });
}
