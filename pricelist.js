// pricelist.js — the "Pricelist" page of a trader: every Torn item, by category, to price what you are willing to PAY for it. An item gets a price when you give it a percentage of its market value
// (or a fixed price); only those items are on the list. The userscript prices trades with the list, and the list can be shared as a public page (/pricelist/<tornId>, see public-pricelist.js).
// Needs ledger.js (ledFetch, ledMoney). The list is saved with the trader's ledger record (lib/ledger.js).
'use strict';

let plSets = { pct: 100, round: 0, shared: false }, plRows = {}, plValues = {}, plMeta = {}, plPricesAt = 0, plName = '', plId = '', plOpen = new Set(), plFilter = '', plDirty = false;

const plRound = (n, step) => (step ? Math.round(n / step) * step : Math.round(n));
// what you pay for an item: the fixed price, or the market value times the item's percentage, rounded to the chosen step; 0 = not on the list
function plPrice(name) {
    const r = plRows[name]; if (!r || (!r.pct && !r.fixed)) return 0;
    return r.fixed || plRound((plValues[name] || 0) * r.pct / 100, plSets.round);
}
const plTypes = () => [...new Set(Object.values(plMeta).map(m => m[1]))].filter(Boolean).sort();
// the items of a category worth listing: the ones with a market value (untradable items have none), plus any that are priced already, the most valuable first
const plItemsOf = type => Object.keys(plMeta).filter(n => plMeta[n][1] === type && (plValues[n] > 0 || plRows[n])).sort((a, b) => (plValues[b] || 0) - (plValues[a] || 0));
const plNum = v => Number(String(v).replace(',', '.')) || 0;
const plPriced = names => names.filter(n => plPrice(n) > 0).length;

function plRowHtml(name) {
    const r = plRows[name] || {}, id = (plMeta[name] || [])[0];
    return `<div class="pl-row" data-name="${esc(name)}" style="display:flex;align-items:center;gap:10px;padding:6px 0;border-top:1px solid var(--line);flex-wrap:wrap;">
        ${id ? `<img src="https://www.torn.com/images/items/${id}/small.png" width="30" height="30" loading="lazy" alt="" style="flex:none;" onerror="this.style.visibility='hidden'">` : '<span style="width:30px;flex:none;"></span>'}
        <div style="flex:1;min-width:150px;"><div style="font-weight:600;">${esc(name)}</div><div class="pl-sub" style="font-size:12px;color:var(--muted);"></div></div>
        <span style="display:flex;align-items:center;gap:6px;"><input class="pl-p" type="text" inputmode="decimal" value="${r.pct ? esc(r.pct) : ''}" placeholder="0" style="width:62px;text-align:right;font-family:var(--mono);"><span style="color:var(--muted);">%</span>
        <input class="pl-f" type="text" inputmode="decimal" value="${r.fixed ? esc(r.fixed) : ''}" placeholder="fixed" title="A fixed price instead of a percentage" style="width:96px;text-align:right;font-family:var(--mono);">
        <button class="ghost small pl-x" type="button" title="Take this item off the list">✕</button></span></div>`;
}
// the "Mkt: … Buy: …" line of a row, and the counts of its category
function plPaintRow(row) {
    const name = row.dataset.name, p = plPrice(name), mv = plValues[name] || 0;
    row.querySelector('.pl-sub').innerHTML = `Mkt: ${mv ? ledMoney(mv) : '$0'} · Buy: <b style="color:${p ? 'var(--success,#35d99b)' : 'var(--muted)'};">${ledMoney(p)}</b>`;
}
function plPaintCount(det) {
    const names = plItemsOf(det.dataset.type);
    det.querySelector('.pl-count').textContent = `${plPriced(names)} priced · ${names.length} items`;
}
function plPaintHead() {
    const priced = Object.keys(plRows).filter(n => plPrice(n) > 0).length, el = $('pl-head-count');
    if (el) el.textContent = `${priced} items priced`;
    const s = $('pl-save'); if (s) { s.textContent = plDirty ? 'Save the list *' : 'Save the list'; }
}
function plCategoryHtml(type) {
    const names = plItemsOf(type), q = plFilter.toLowerCase(), shown = q ? names.filter(n => n.toLowerCase().includes(q)) : names;
    if (!names.length || (q && !shown.length)) return '';
    const open = plOpen.has(type) || !!q;
    return `<details class="pl-cat" data-type="${esc(type)}" ${open ? 'open' : ''} style="border:1px solid var(--line);border-radius:8px;margin-top:8px;padding:0 12px;">
        <summary style="cursor:pointer;padding:10px 0;display:flex;justify-content:space-between;gap:10px;"><b>${esc(type)}</b><span class="pl-count" style="color:var(--muted);font-size:12px;"></span></summary>
        <div class="pl-body">${open ? plBodyHtml(type, shown) : ''}</div></details>`;
}
function plBodyHtml(type, shown) {
    return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 10px;margin-bottom:4px;background:rgba(255,255,255,.04);border-radius:6px;font-size:13px;">Set the whole category to
        <input class="pl-cp" type="text" inputmode="decimal" placeholder="95" style="width:62px;text-align:right;font-family:var(--mono);"> %
        <button class="small pl-ca" type="button">Apply</button><button class="ghost small pl-cx" type="button" title="Take every item of this category off the list">✕ Clear</button></div>${shown.map(plRowHtml).join('')}`;
}
function plFillCategory(det) {
    const type = det.dataset.type, q = plFilter.toLowerCase(), names = plItemsOf(type), shown = q ? names.filter(n => n.toLowerCase().includes(q)) : names;
    const body = det.querySelector('.pl-body');
    if (!body.firstChild) { body.innerHTML = plBodyHtml(type, shown); body.querySelectorAll('.pl-row').forEach(plPaintRow); }
}
function plRenderList() {
    const box = $('pl-cats'); if (!box) return;
    box.innerHTML = plTypes().map(plCategoryHtml).join('') || '<div style="color:var(--muted);font-size:13px;margin-top:10px;">No items match.</div>';
    box.querySelectorAll('.pl-cat').forEach(det => { plPaintCount(det); det.querySelectorAll('.pl-row').forEach(plPaintRow); });
    plPaintHead();
}
function plPublicLink() {
    const el = $('pl-link'); if (!el) return;
    const url = `${location.origin}/pricelist/${plId}`;
    el.innerHTML = plSets.shared && Object.keys(plRows).length ? `Your public pricelist: <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a> <button id="pl-copylink" class="ghost small" type="button">Copy the link</button>` : '';
    const b = $('pl-copylink'); if (b) b.addEventListener('click', () => navigator.clipboard.writeText(url).then(() => toast('Link copied'), () => toast('Copying was not allowed here')));
}

async function loadPricelist() {
    const st = $('pl-status'); st.className = 'status ok'; st.textContent = 'Loading…';
    try {
        const [r, v] = await Promise.all([ledFetch({ action: 'led-pl-get' }), ledFetch({ action: 'led-values' })]);
        if (r.error) { st.className = 'status err'; st.textContent = r.error; return; }
        if (v.error) { st.className = 'status err'; st.textContent = `Item values are not available (${v.error}).`; return; }
        plValues = v.values || {}; plMeta = v.meta || {}; plPricesAt = v.at || 0; plName = r.name; plId = r.tornId;
        const pl = r.pricelist; plSets = { pct: pl.pct || 100, round: pl.round || 0, shared: !!pl.shared };
        plRows = {}; pl.rows.forEach(x => { if (x.pct || x.fixed) plRows[x.name] = { pct: x.pct || 0, fixed: x.fixed || 0 }; });
        plDirty = false; plFilter = '';
        st.textContent = ''; st.className = 'status';
        plRender();
    } catch (e) { st.className = 'status err'; st.textContent = `This page could not load (${e.message}). Reload the page.`; }
}
function plRender() {
    const ago = plPricesAt ? `${Math.max(1, Math.round((Date.now() - plPricesAt) / 3600000))} hours ago` : '';
    $('pl-body').innerHTML = `<div class="panel" style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;justify-content:space-between;">
            <div><h3 style="margin:0;">${esc(plName)}'s Pricelist</h3><div id="pl-head-count" style="color:var(--muted);font-size:13px;"></div></div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;font-size:13px;">
                <span>Round to <select id="pl-round"><option value="0">no rounding</option><option value="100" ${plSets.round === 100 ? 'selected' : ''}>100</option><option value="1000" ${plSets.round === 1000 ? 'selected' : ''}>1,000</option><option value="10000" ${plSets.round === 10000 ? 'selected' : ''}>10,000</option></select></span>
                <label><input id="pl-shared" type="checkbox" ${plSets.shared ? 'checked' : ''}> Share as a public page</label>
                <button id="pl-copy" class="ghost" type="button">Copy the list</button><button id="pl-save" type="button">Save the list</button></div>
            <div style="flex-basis:100%;font-size:12px;color:var(--muted);">${ago ? `Market values updated ${ago}. ` : ''}They are Torn's average market value, not the cheapest listing right now. Give an item a percentage to put it on your list; the price you pay is shown next to it.</div>
            <div id="pl-link" style="flex-basis:100%;font-size:13px;"></div></div>
        <div class="panel"><input id="pl-search" type="text" placeholder="Search items…" style="width:100%;max-width:420px;"><div id="pl-cats"></div></div>`;
    plPublicLink(); plRenderList();
    $('pl-search').addEventListener('input', e => { plFilter = e.target.value.trim(); plRenderList(); });
    $('pl-round').addEventListener('change', e => { plSets.round = Number(e.target.value) || 0; plDirty = true; plRenderList(); });
    $('pl-shared').addEventListener('change', e => { plSets.shared = e.target.checked; plDirty = true; plPaintHead(); });
    const cats = $('pl-cats');
    // a category's rows are only built when it is opened (there are a thousand items)
    cats.addEventListener('toggle', e => {
        const det = e.target; if (!det.classList || !det.classList.contains('pl-cat')) return;
        if (det.open) { if (!plFilter) plOpen.add(det.dataset.type); plFillCategory(det); } else if (!plFilter) plOpen.delete(det.dataset.type);
    }, true);
    cats.addEventListener('input', e => {
        const row = e.target.closest('.pl-row'); if (!row) return;
        const name = row.dataset.name, r = plRows[name] || { pct: 0, fixed: 0 };
        if (e.target.classList.contains('pl-p')) r.pct = plNum(e.target.value);
        else if (e.target.classList.contains('pl-f')) r.fixed = (typeof finParse === 'function' ? finParse(e.target.value) : plNum(e.target.value)) || 0;
        else return;
        if (!r.pct && !r.fixed) delete plRows[name]; else plRows[name] = r;
        plDirty = true; plPaintRow(row); plPaintCount(row.closest('.pl-cat')); plPaintHead();
    });
    cats.addEventListener('click', e => {
        const t = e.target, det = t.closest('.pl-cat'); if (!det) return;
        if (t.classList.contains('pl-x')) { const row = t.closest('.pl-row'); delete plRows[row.dataset.name]; row.querySelector('.pl-p').value = ''; row.querySelector('.pl-f').value = ''; plDirty = true; plPaintRow(row); plPaintCount(det); plPaintHead(); }
        if (t.classList.contains('pl-ca')) {
            const v = plNum(det.querySelector('.pl-cp').value);
            if (!v) { toast('Write a percentage first, for example 95'); return; }
            plItemsOf(det.dataset.type).forEach(n => { plRows[n] = { pct: v, fixed: 0 }; });
            plDirty = true; det.querySelectorAll('.pl-row').forEach(row => { row.querySelector('.pl-p').value = v; row.querySelector('.pl-f').value = ''; plPaintRow(row); }); plPaintCount(det); plPaintHead();
        }
        if (t.classList.contains('pl-cx')) {
            if (!confirm(`Take every ${det.dataset.type} item off your list?`)) return;
            plItemsOf(det.dataset.type).forEach(n => { delete plRows[n]; });
            plDirty = true; det.querySelectorAll('.pl-row').forEach(row => { row.querySelector('.pl-p').value = ''; row.querySelector('.pl-f').value = ''; plPaintRow(row); }); plPaintCount(det); plPaintHead();
        }
    });
    $('pl-save').addEventListener('click', async () => {
        const rows = Object.entries(plRows).filter(([n]) => plPrice(n) > 0).map(([name, r]) => ({ name, pct: r.pct, fixed: r.fixed }));
        const res = await ledFetch({ action: 'led-pl-save', pricelist: { pct: plSets.pct, round: plSets.round, shared: plSets.shared, rows } });
        if (res.error) { toast(res.error); return; }
        plDirty = false; plSets.shared = !!res.pricelist.shared; plPaintHead(); plPublicLink(); toast('Pricelist saved');
    });
    $('pl-copy').addEventListener('click', () => {
        const text = Object.keys(plRows).filter(n => plPrice(n) > 0).sort().map(n => `${n}: ${ledMoney(plPrice(n))}`).join('\n');
        if (!text) { toast('There are no prices to copy yet'); return; }
        navigator.clipboard.writeText(text).then(() => toast('Pricelist copied'), () => toast('Copying was not allowed here'));
    });
}
