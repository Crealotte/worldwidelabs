// pricelist.js — the "Pricelist" page of a trader: every Torn item, by category, to price what you are willing to PAY for it. An item gets a price when you give it a percentage of its market value
// (or a fixed price); only those items are on the list. Tick items (any category, also from a search) to set a percentage for all of them at once. The two museum sets show what is in them.
// The userscript prices trades with the list, and the list can be shared as a public page (/pricelist/<tornId>, see public-pricelist.js). Needs ledger.js (ledFetch, ledMoney).
// The list is saved with the trader's ledger record (lib/ledger.js).
'use strict';

let plSets = { pct: 100, round: 0, shared: false }, plRows = {}, plValues = {}, plMeta = {}, plPricesAt = 0, plName = '', plId = '', plOpen = new Set(), plFilter = '', plDirty = false, plSel = new Set();

// The sets that can be exchanged at the museum for 10 points: one of each of these items makes a set.
const PL_SETS = {
    'Plushie Set': ['Camel Plushie', 'Chamois Plushie', 'Jaguar Plushie', 'Kitten Plushie', 'Lion Plushie', 'Monkey Plushie', 'Nessie Plushie', 'Panda Plushie', 'Red Fox Plushie', 'Sheep Plushie', 'Stingray Plushie', 'Teddy Bear Plushie', 'Wolverine Plushie'],
    'Flower Set': ['African Violet', 'Banana Orchid', 'Ceibo Flower', 'Cherry Blossom', 'Crocus', 'Dahlia', 'Edelweiss', 'Heather', 'Orchid', 'Peony', 'Tribulus Omanense'],
};

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
const plShownOf = type => { const q = plFilter.toLowerCase(), names = plItemsOf(type); return q ? names.filter(n => n.toLowerCase().includes(q)) : names; };

function plSetPartsHtml(name) {
    const parts = PL_SETS[name]; if (!parts) return '';
    const market = parts.reduce((s, n) => s + (plValues[n] || 0), 0), mine = parts.reduce((s, n) => s + plPrice(n), 0), all = parts.every(n => plPrice(n) > 0);
    return `<div style="margin-bottom:4px;color:var(--muted);">One of each, ${parts.length} items — together ${ledMoney(market)} at market${all ? `, ${ledMoney(mine)} at your prices` : ' (not every part is on your list)'}.</div>${parts.map(n => `<div style="display:flex;justify-content:space-between;gap:12px;max-width:380px;"><span>1 × ${esc(n)}</span><span style="font-family:var(--mono);color:var(--muted);">${ledMoney(plValues[n] || 0)}${plPrice(n) ? ` · you pay ${ledMoney(plPrice(n))}` : ''}</span></div>`).join('')}`;
}
function plRowHtml(name) {
    const r = plRows[name] || {}, id = (plMeta[name] || [])[0], isSet = !!PL_SETS[name];
    return `<div class="pl-row" data-name="${esc(name)}" style="display:flex;align-items:center;gap:10px;padding:6px 0;border-top:1px solid var(--line);flex-wrap:wrap;">
        <input class="pl-s" type="checkbox" ${plSel.has(name) ? 'checked' : ''} title="Select this item" style="flex:none;">
        ${id ? `<img src="https://www.torn.com/images/items/${id}/small.png" width="30" height="30" loading="lazy" alt="" style="flex:none;" onerror="this.style.visibility='hidden'">` : '<span style="width:30px;flex:none;"></span>'}
        <div style="flex:1;min-width:150px;"><div style="font-weight:600;">${esc(name)}</div><div class="pl-sub" style="font-size:12px;color:var(--muted);"></div>
            ${isSet ? `<details class="pl-set" style="font-size:12px;margin-top:2px;"><summary style="cursor:pointer;color:var(--accent,#35d99b);">What is in it?</summary><div class="pl-parts" style="padding:4px 0;"></div></details>` : ''}</div>
        <span style="display:flex;align-items:center;gap:6px;"><input class="pl-p" type="text" inputmode="decimal" value="${r.pct ? esc(r.pct) : ''}" placeholder="0" style="width:62px;text-align:right;font-family:var(--mono);"><span style="color:var(--muted);">%</span>
        <input class="pl-f" type="text" inputmode="decimal" value="${r.fixed ? esc(r.fixed) : ''}" placeholder="fixed" title="A fixed price instead of a percentage" style="width:96px;text-align:right;font-family:var(--mono);">
        <button class="ghost small pl-x" type="button" title="Take this item off the list">✕</button></span></div>`;
}
// the "Mkt: … Buy: …" line of a row, and the counts of its category
function plPaintRow(row) {
    const name = row.dataset.name, p = plPrice(name), mv = plValues[name] || 0;
    row.querySelector('.pl-sub').innerHTML = `Mkt: ${mv ? ledMoney(mv) : '$0'} · Buy: <b style="color:${p ? 'var(--success,#35d99b)' : 'var(--muted)'};">${ledMoney(p)}</b>`;
    const parts = row.querySelector('.pl-set'); if (parts && parts.open) row.querySelector('.pl-parts').innerHTML = plSetPartsHtml(name);
}
function plPaintCount(det) {
    const names = plItemsOf(det.dataset.type);
    det.querySelector('.pl-count').textContent = `${plPriced(names)} priced · ${names.length} items`;
}
function plPaintHead() {
    const priced = Object.keys(plRows).filter(n => plPrice(n) > 0).length, el = $('pl-head-count');
    if (el) el.textContent = `${priced} items priced`;
    const s = $('pl-save'); if (s) s.textContent = plDirty ? 'Save the list *' : 'Save the list';
    const c = $('pl-selcount'); if (c) c.textContent = plSel.size;
    document.querySelectorAll('.pl-selbtn').forEach(b => { b.disabled = !plSel.size; });
}
// after the rows changed in the data (Apply, off the list): show it in every row that is on the page
function plSyncRows() {
    document.querySelectorAll('.pl-row').forEach(row => {
        const r = plRows[row.dataset.name] || {};
        row.querySelector('.pl-p').value = r.pct || ''; row.querySelector('.pl-f').value = r.fixed || '';
        row.querySelector('.pl-s').checked = plSel.has(row.dataset.name);
        plPaintRow(row);
    });
    document.querySelectorAll('.pl-cat').forEach(plPaintCount);
    plPaintHead();
}
function plCategoryHtml(type) {
    const names = plItemsOf(type), shown = plShownOf(type);
    if (!names.length || (plFilter && !shown.length)) return '';
    const open = plOpen.has(type) || !!plFilter;
    return `<details class="pl-cat" data-type="${esc(type)}" ${open ? 'open' : ''} style="border:1px solid var(--line);border-radius:8px;margin-top:8px;padding:0 12px;">
        <summary style="cursor:pointer;padding:10px 0;display:flex;justify-content:space-between;gap:10px;"><b>${esc(type)}</b><span class="pl-count" style="color:var(--muted);font-size:12px;"></span></summary>
        <div class="pl-body">${open ? plBodyHtml(shown) : ''}</div></details>`;
}
function plBodyHtml(shown) {
    return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 10px;margin-bottom:4px;background:rgba(255,255,255,.04);border-radius:6px;font-size:13px;">Set the whole category to
        <input class="pl-cp" type="text" inputmode="decimal" placeholder="95" style="width:62px;text-align:right;font-family:var(--mono);"> %
        <button class="small pl-ca" type="button">Apply</button><button class="ghost small pl-cx" type="button" title="Take every item of this category off the list">✕ Clear</button>
        <button class="ghost small pl-cs" type="button" title="Tick every item shown here">Select all</button></div>${shown.map(plRowHtml).join('')}`;
}
function plFillCategory(det) {
    const body = det.querySelector('.pl-body');
    if (!body.firstChild) { body.innerHTML = plBodyHtml(plShownOf(det.dataset.type)); body.querySelectorAll('.pl-row').forEach(plPaintRow); }
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
        plDirty = false; plFilter = ''; plSel = new Set();
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
        <div class="panel" style="position:sticky;top:0;z-index:5;display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:13px;">
            <b>Selected: <span id="pl-selcount">0</span></b>
            <span>set them to <input id="pl-selpct" type="text" inputmode="decimal" placeholder="95" style="width:62px;text-align:right;font-family:var(--mono);"> %</span>
            <button id="pl-selapply" class="small pl-selbtn" type="button">Apply to selected</button>
            <button id="pl-seloff" class="ghost small pl-selbtn" type="button">Take selected off the list</button>
            <button id="pl-selclear" class="ghost small pl-selbtn" type="button">Clear selection</button>
            <span style="color:var(--muted);font-size:12px;">Tick the boxes in front of the items (they stay ticked between categories and searches).</span></div>
        <div class="panel"><input id="pl-search" type="text" placeholder="Search items…" style="width:100%;max-width:420px;"><div id="pl-cats"></div></div>`;
    plPublicLink(); plRenderList();
    $('pl-search').addEventListener('input', e => { plFilter = e.target.value.trim(); plRenderList(); });
    $('pl-round').addEventListener('change', e => { plSets.round = Number(e.target.value) || 0; plDirty = true; plSyncRows(); });
    $('pl-shared').addEventListener('change', e => { plSets.shared = e.target.checked; plDirty = true; plPaintHead(); });
    const setPct = (names, v) => { names.forEach(n => { plRows[n] = { pct: v, fixed: 0 }; }); plDirty = true; plSyncRows(); };
    $('pl-selapply').addEventListener('click', () => {
        const v = plNum($('pl-selpct').value);
        if (!plSel.size) { toast('Tick some items first'); return; }
        if (!v) { toast('Write a percentage first, for example 95'); return; }
        setPct([...plSel], v);
    });
    $('pl-seloff').addEventListener('click', () => { [...plSel].forEach(n => { delete plRows[n]; }); plDirty = true; plSyncRows(); });
    $('pl-selclear').addEventListener('click', () => { plSel = new Set(); plSyncRows(); });
    const cats = $('pl-cats');
    // a category's rows are only built when it is opened (there are a thousand items); the contents of a set only when it is opened
    cats.addEventListener('toggle', e => {
        const det = e.target; if (!det.classList) return;
        if (det.classList.contains('pl-cat')) {
            if (det.open) { if (!plFilter) plOpen.add(det.dataset.type); plFillCategory(det); } else if (!plFilter) plOpen.delete(det.dataset.type);
        } else if (det.classList.contains('pl-set') && det.open) det.querySelector('.pl-parts').innerHTML = plSetPartsHtml(det.closest('.pl-row').dataset.name);
    }, true);
    cats.addEventListener('change', e => {
        if (!e.target.classList.contains('pl-s')) return;
        const name = e.target.closest('.pl-row').dataset.name;
        if (e.target.checked) plSel.add(name); else plSel.delete(name);
        plPaintHead();
    });
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
        if (t.classList.contains('pl-x')) { delete plRows[t.closest('.pl-row').dataset.name]; plDirty = true; plSyncRows(); }
        if (t.classList.contains('pl-ca')) {
            const v = plNum(det.querySelector('.pl-cp').value);
            if (!v) { toast('Write a percentage first, for example 95'); return; }
            setPct(plItemsOf(det.dataset.type), v);
        }
        if (t.classList.contains('pl-cx')) {
            if (!confirm(`Take every ${det.dataset.type} item off your list?`)) return;
            plItemsOf(det.dataset.type).forEach(n => { delete plRows[n]; }); plDirty = true; plSyncRows();
        }
        if (t.classList.contains('pl-cs')) { plShownOf(det.dataset.type).forEach(n => plSel.add(n)); plSyncRows(); }
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
    plPaintHead();
}
