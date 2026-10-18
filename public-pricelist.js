// public-pricelist.js — the public page of a trader's pricelist (/pricelist/<tornId>): what that trader pays for each item, by category, with buttons to open their Torn profile and to start a trade.
// Anyone can open it, no login (see app-init.js); the trader chooses to share it on the Pricelist page. The server only reads what is already stored (lib/ledger.js pricelistPublic).
'use strict';

function ppAgo(ms) {
    if (!ms) return '';
    const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
    return m < 60 ? `${Math.max(1, m)} min ago` : m < 2880 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`;
}
async function loadPublicPricelist(id) {
    const box = $('pub-pl-body');
    let r;
    try {
        const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pricelist-public', id }) });
        r = JSON.parse(await res.text());
    } catch (e) { r = { error: 'The pricelist could not be loaded. Try again in a moment.' }; }
    if (r.error) { box.innerHTML = `<div class="panel"><h3 style="margin-top:0;">Pricelist</h3><p style="color:var(--muted);">${esc(r.error)}</p></div>`; return; }
    document.title = `${r.name}'s Pricelist`;
    const lastTrade = r.lastTrade ? ppAgo(Date.parse(r.lastTrade.replace(' ', 'T') + 'Z')) : '';
    const types = [...new Set(r.items.map(i => i.type))].sort();
    const draw = q => {
        const shown = r.items.filter(i => !q || i.name.toLowerCase().includes(q.toLowerCase()));
        $('pp-cats').innerHTML = types.map(t => {
            const rows = shown.filter(i => i.type === t).sort((a, b) => b.price - a.price);
            return rows.length ? `<div class="panel" style="margin:0;padding:0;overflow:hidden;"><div style="display:flex;justify-content:space-between;padding:10px 14px;background:rgba(255,255,255,.05);"><b>${esc(t)}</b><span style="color:var(--muted);">${rows.length}</span></div>${rows.map(i => `<div style="display:flex;align-items:center;gap:10px;padding:7px 14px;border-top:1px solid var(--line);">${i.id ? `<img src="https://www.torn.com/images/items/${i.id}/small.png" width="30" height="30" loading="lazy" alt="" style="flex:none;" onerror="this.style.visibility='hidden'">` : '<span style="width:30px;flex:none;"></span>'}<span style="flex:1;font-weight:600;">${esc(i.name)}</span><b style="font-family:var(--mono);">${ledMoney(i.price)}</b></div>`).join('')}</div>` : '';
        }).join('') || '<p style="color:var(--muted);">No items match.</p>';
    };
    box.innerHTML = `<div class="panel" style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;justify-content:space-between;">
            <div><h2 style="margin:0;">${esc(r.name)}'s Pricelist</h2><div style="color:var(--muted);font-size:13px;">${r.items.length} items priced — what ${esc(r.name)} pays</div></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                <a class="btn ghost" href="https://www.torn.com/profiles.php?XID=${esc(r.tornId)}" target="_blank" rel="noopener" style="padding:6px 12px;border:1px solid var(--line);border-radius:6px;">View Profile</a>
                <a class="btn" href="https://www.torn.com/trade.php#step=start&userID=${esc(r.tornId)}" target="_blank" rel="noopener" style="padding:6px 12px;border:1px solid var(--accent,#35d99b);border-radius:6px;">Set Trade</a></div>
            <div style="flex-basis:100%;font-size:12px;color:var(--muted);">${r.pricesAt ? `<b>${esc(ppAgo(r.pricesAt))}</b> prices updated` : ''}${lastTrade ? ` · <b>${esc(lastTrade)}</b> last trade` : ''} · The prices follow Torn's market value, so they change a little during the day.</div></div>
        <div class="panel"><input id="pp-search" type="text" placeholder="Search items…" style="width:100%;max-width:420px;"></div>
        <div id="pp-cats" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;align-items:start;"></div>`;
    draw('');
    $('pp-search').addEventListener('input', e => draw(e.target.value.trim()));
}
