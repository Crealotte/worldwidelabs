// armory-tracker.js — WorldWideLabs Consumption Tracker (frontend).
'use strict';

let atReport = null; // last consumption-report result, shared by the detail view + shopping list

async function atFetch(body) {
    const res = await fetch('/api/armory-tracker', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: apiKey, ...body }),
    });
    return res.json();
}

// A category's icon, purely cosmetic — falls back to a generic box for anything not listed. The
// category names themselves come from lib/trackedItems.js's curated list (server-side), not from
// Torn's own item type field directly, so adding a new category there needs a matching entry here
// too for it to get a proper icon (harmless without one, just shows the generic box).
const AT_CATEGORY_ICONS = {
    Drug: '💊', Medical: '🩹', Alcohol: '🍺', Candy: '🍬', Temporary: '🔫', Booster: '⚡', Other: '📦',
};

function loadArmoryTracker() {
    $('at-locked').style.display = isLeaderCached ? 'none' : 'block';
    $('at-editor').style.display = isLeaderCached ? 'block' : 'none';
}

// Cross-tool integration: push a cost line straight into the War Payout Calculator (its wpCosts
// array / renderWpCosts, both globals from war-payout-tracker.js) rather than leaving the leader
// to copy numbers by hand between tools.
function atAddCostToPayout(label, amount) {
    if (typeof wpCosts === 'undefined' || typeof renderWpCosts !== 'function') {
        toast('Open War Payout at least once this session first.');
        return;
    }
    wpCosts.push({ label, amount: Math.round(amount) });
    renderWpCosts();
    if (typeof wpCalcResult !== 'undefined' && wpCalcResult) renderWpPayout();
    toast(`Added "${label}" ($${Math.round(amount).toLocaleString()}) to War Payout costs`);
}

// ---- Consumption report: the main event. One date range, grouped category -> item -> player,
// fetched live for that exact range every time (no pre-synced cache — see api/armory-tracker.js
// for why). Shared between the detailed report view and the derived (cleaner, no-players)
// shopping list. Xanax's players additionally carry hits/required/shortfall inline. ----

function atDateInputToTs(val, endOfDay) {
    if (!val) return null;
    const ts = Math.floor(new Date(val).getTime() / 1000);
    return endOfDay ? ts + 86399 : ts; // include the whole "to" day
}

// The backend caps how far back a single request pages through Torn's armory news (a real time
// budget inside a serverless function, not the unlimited runtime a browser tab gets — which is
// exactly why Jimidy's tool, running entirely client-side, never has this problem). A long or
// busy date range could silently truncate in one shot. Fixed by chunking the range into smaller
// windows from here in the browser (no server time limit on how many sequential calls we make)
// and merging the results correctly — including recomputing Xanax's required/shortfall on the
// MERGED totals afterward, since summing per-chunk shortfalls isn't the same as computing it once
// on the full total (shortfall = max(0, required - hits) isn't linear).
const AT_CHUNK_DAYS = 3;

async function atCalculateReport(from, to, onProgress) {
    const chunkSeconds = AT_CHUNK_DAYS * 86400;
    const chunks = [];
    for (let start = from; start <= to; start += chunkSeconds) {
        chunks.push([start, Math.min(start + chunkSeconds - 1, to)]);
    }

    const byItem = {}; // item -> { item, category, quantity, value, hasPrice, players: { name -> {quantity, value, hits} } }
    const shoppingExtrasByKey = {};
    const meta = { entriesScanned: 0, pagesFetched: 0, unparsedCount: 0, unparsedSample: [], rateLimited: false, hitPageCap: false };

    for (let i = 0; i < chunks.length; i++) {
        if (onProgress) onProgress(i + 1, chunks.length);
        const [cFrom, cTo] = chunks[i];
        const result = await atFetch({ action: 'consumption-report', from: cFrom, to: cTo });
        if (result.error) throw new Error(result.error);

        for (const cat of result.categories) {
            for (const it of cat.items) {
                const m = byItem[it.item] || (byItem[it.item] = { item: it.item, category: it.category, quantity: 0, value: 0, hasPrice: false, deposited: 0, players: {} });
                m.quantity += it.quantity;
                m.value += it.value;
                m.deposited += it.deposited || 0;
                if (it.hasPrice) m.hasPrice = true;
                for (const p of it.players) {
                    const mp = m.players[p.name] || (m.players[p.name] = { name: p.name, quantity: 0, value: 0, hits: 0 });
                    mp.quantity += p.quantity;
                    mp.value += p.value;
                    if (p.hits != null) mp.hits += p.hits;
                }
            }
        }
        for (const extra of (result.shoppingExtras || [])) {
            const key = extra.category + '|' + extra.item;
            const m = shoppingExtrasByKey[key] || (shoppingExtrasByKey[key] = { category: extra.category, item: extra.item, quantity: 0, value: 0, hasPrice: false, deposited: 0 });
            m.quantity += extra.quantity;
            m.value += extra.value;
            m.deposited += extra.deposited || 0;
            if (extra.hasPrice) m.hasPrice = true;
        }
        meta.entriesScanned += result.meta.entriesScanned;
        meta.pagesFetched += result.meta.pagesFetched;
        meta.unparsedCount += result.meta.unparsedCount;
        if (meta.unparsedSample.length < 10) meta.unparsedSample.push(...(result.meta.unparsedSample || []).slice(0, 10 - meta.unparsedSample.length));
        meta.rateLimited = meta.rateLimited || result.meta.rateLimited;
        meta.hitPageCap = meta.hitPageCap || result.meta.hitPageCap;
    }

    // Recompute Xanax's required/shortfall once on the merged (whole-range) totals, not summed
    // per-chunk — see the note above on why that's not the same thing.
    for (const it of Object.values(byItem)) {
        if (!/^xanax$/i.test(it.item)) continue;
        for (const p of Object.values(it.players)) {
            p.required = p.quantity * 10;
            p.shortfall = Math.max(0, p.required - p.hits);
        }
    }

    const categoriesMap = {};
    for (const it of Object.values(byItem)) {
        const cat = categoriesMap[it.category] || (categoriesMap[it.category] = { category: it.category, quantity: 0, value: 0, items: [] });
        cat.quantity += it.quantity;
        cat.value += it.value;
        cat.items.push({ ...it, players: Object.values(it.players).sort((a, b) => b.quantity - a.quantity) });
    }
    const categories = Object.values(categoriesMap);
    for (const c of categories) c.items.sort((a, b) => b.value - a.value);
    categories.sort((a, b) => b.value - a.value);
    const grandTotal = categories.reduce((s, c) => s + c.value, 0);
    const shoppingExtras = Object.values(shoppingExtrasByKey);

    const result = { categories, grandTotal, shoppingExtras, meta };
    atReport = result;
    return result;
}

$('at-report-calc').addEventListener('click', async () => {
    const st = $('at-report-status');
    const from = atDateInputToTs($('at-report-from').value, false);
    const to = atDateInputToTs($('at-report-to').value, true);
    if (!from || !to) { st.className = 'status err'; st.textContent = 'Pick both dates.'; return; }
    $('at-unparsed-body').innerHTML = '';
    try {
        const result = await atCalculateReport(from, to, (done, total) => {
            st.className = 'status ok'; st.textContent = `Fetching… (${done}/${total})`;
        });
        const m = result.meta;
        if (!result.categories.length && m.entriesScanned === 0) {
            st.className = 'status err';
            st.textContent = 'No armory activity found for this range on this key — double check the dates, or that this faction actually used the armory then.';
        } else {
            st.className = m.hitPageCap ? 'status err' : 'status ok';
            st.textContent = `Scanned ${m.entriesScanned} armory event(s) over ${m.pagesFetched} page(s).`
                + (m.unparsedCount ? ` ${m.unparsedCount} didn't match a known pattern.` : '')
                + (m.rateLimited ? ' Torn rate-limited this partway through — numbers may be incomplete, try again shortly.' : '')
                + (m.hitPageCap ? ' ⚠ Even a 3-day slice of this range hit the page limit — this faction is unusually active, numbers may still be incomplete.' : '');
        }
        renderAtUnparsed(m.unparsedSample || []);
        renderAtReportDetail(result);
        renderAtShoppingList(result);
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    }
});

// Shows the raw text of a few entries the parser couldn't match — so if something's missing
// (like the temporary throwables) or the numbers look wrong, the leader can read Torn's actual
// wording directly and paste it back, instead of us both guessing at patterns blind.
function renderAtUnparsed(sample) {
    const el = $('at-unparsed-body');
    if (!sample.length) { el.innerHTML = ''; return; }
    el.innerHTML = `
        <div class="ocfit-scenario collapsed">
            <div class="ocfit-scenario-header">
                <span>⚠ ${sample.length} unrecognized armory event${sample.length === 1 ? '' : 's'} — click to see the raw text</span>
                <span class="chev">▾</span>
            </div>
            <div class="ocfit-scenario-body" style="font-family:var(--mono);font-size:11px;color:var(--muted);word-break:break-word;">
                ${sample.map(t => `<div style="padding:4px 0;border-top:1px solid var(--line);">${esc(t)}</div>`).join('')}
            </div>
        </div>`;
    el.querySelector('.ocfit-scenario-header').addEventListener('click', () => {
        el.querySelector('.ocfit-scenario').classList.toggle('collapsed');
    });
}

function atPlayerLine(p, hasPrice) {
    let line = `${esc(p.name)} — ${p.quantity}x${hasPrice ? ` — $${Math.round(p.value).toLocaleString()}` : ''}`;
    if (p.hits == null) return `<div>${line}</div>`;
    const short = p.shortfall > 0;
    return `<div${short ? ' style="color:var(--danger);font-weight:700;"' : ''}>${line} — ${p.hits} hit(s) landed (needs ${p.required})${short ? ` ⚠ short by ${p.shortfall}` : ''}</div>`;
}

function renderAtReportDetail(report) {
    const el = $('at-report-body');
    if (!report.categories.length) {
        el.innerHTML = report.meta.entriesScanned > 0
            ? '<p style="color:var(--muted);font-size:13px;">Found armory activity in this range, but none of it was actual consumption — only deposits, loans, retrieves, returns, or weapon/armor activity (which don\'t count as "used up").</p>'
            : '';
        return;
    }
    el.innerHTML = `
        <div style="font-size:13px;margin-bottom:12px;">Grand total: <span style="font-weight:700;color:var(--reagent);font-family:var(--mono);">$${Math.round(report.grandTotal).toLocaleString()}</span></div>
        ${report.categories.map((cat, ci) => `
        <div class="ocfit-scenario collapsed" style="margin-bottom:8px;">
            <div class="ocfit-scenario-header">
                <span>${AT_CATEGORY_ICONS[cat.category] || '📦'} ${esc(cat.category)} — ${cat.quantity}x — $${Math.round(cat.value).toLocaleString()}</span>
                <span class="chev">▾</span>
            </div>
            <div class="ocfit-scenario-body">
                ${cat.items.map((it, ii) => `
                <div style="padding:6px 0;${ii ? 'border-top:1px solid var(--line);' : ''}">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="flex:1;">${esc(it.item)} — ${it.quantity}x</span>
                        <span style="font-family:var(--mono);${it.hasPrice ? '' : 'color:var(--muted);'}">${it.hasPrice ? `$${Math.round(it.value).toLocaleString()}` : 'no price data'}</span>
                        <button class="ghost small at-players-toggle" data-cat="${ci}" data-item="${ii}">Players ▾ (${it.players.length})</button>
                    </div>
                    <div class="at-players-list" data-cat="${ci}" data-item="${ii}" hidden style="margin-top:6px;padding-left:12px;font-size:12px;color:var(--muted);">
                        ${it.players.map(p => atPlayerLine(p, it.hasPrice)).join('')}
                    </div>
                </div>`).join('')}
            </div>
        </div>`).join('')}`;

    el.querySelectorAll('.ocfit-scenario-header').forEach(h => {
        h.addEventListener('click', () => h.closest('.ocfit-scenario').classList.toggle('collapsed'));
    });
    el.querySelectorAll('.at-players-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const list = el.querySelector(`.at-players-list[data-cat="${btn.dataset.cat}"][data-item="${btn.dataset.item}"]`);
            list.hidden = !list.hidden;
            btn.textContent = `Players ${list.hidden ? '▾' : '▴'} (${list.children.length})`;
        });
    });
}

// Shopping-list items for one category: the real consumed items plus any derived "extras" for
// that category (e.g. Empty Blood Bag, restocked based on how many full ones got used — see
// api/armory-tracker.js's consumption-report). Extras aren't in the main report at all, only here.
function atShoppingItemsForCategory(report, cat) {
    const extras = (report.shoppingExtras || []).filter(e => e.category === cat.category);
    return [...cat.items, ...extras];
}

function renderAtShoppingList(report) {
    const el = $('at-shop-body');
    const extraTotal = (report.shoppingExtras || []).reduce((s, e) => s + e.value, 0);
    const grandTotal = report.grandTotal + extraTotal;
    if (!report.categories.length && !report.shoppingExtras?.length) {
        el.innerHTML = '<p style="color:var(--muted);font-size:13px;">Nothing to restock for this range.</p>';
        return;
    }
    // "Restocked" pulls from real armory deposits over this same range (see
    // api/armory-tracker.js's consumption-report) — not something typed in, and not always equal
    // to "Buy back": deposit more than was needed and it shows a spare surplus, deposit less (or
    // nothing yet) and it shows how much is still short.
    const atRestockedCell = it => {
        const deposited = it.deposited || 0;
        if (!deposited) return '<span style="color:var(--muted);">—</span>';
        const diff = deposited - it.quantity;
        return diff >= 0
            ? `<span style="color:var(--reagent);">${deposited.toLocaleString()}x ✓${diff > 0 ? ` (+${diff.toLocaleString()} spare)` : ''}</span>`
            : `<span style="color:var(--danger);">${deposited.toLocaleString()}x (${Math.abs(diff).toLocaleString()} short)</span>`;
    };
    el.innerHTML = `
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <thead><tr style="color:var(--muted);text-align:left;"><th style="padding:4px 8px;">Item</th><th style="padding:4px 8px;">Buy back</th><th style="padding:4px 8px;">Restocked</th><th style="padding:4px 8px;">Cost</th></tr></thead>
            ${report.categories.map(cat => {
                const items = atShoppingItemsForCategory(report, cat);
                const subtotal = items.reduce((s, it) => s + it.value, 0);
                return `
            <tbody>
                <tr><td colspan="4" style="padding:8px 8px 2px;font-weight:700;">${AT_CATEGORY_ICONS[cat.category] || '📦'} ${esc(cat.category)}</td></tr>
                ${items.map(it => `
                <tr style="border-top:1px solid var(--line);">
                    <td style="padding:4px 8px;">${esc(it.item)}</td>
                    <td style="padding:4px 8px;font-family:var(--mono);">${it.quantity}x</td>
                    <td style="padding:4px 8px;font-family:var(--mono);">${atRestockedCell(it)}</td>
                    <td style="padding:4px 8px;font-family:var(--mono);${it.hasPrice ? '' : 'color:var(--muted);'}">${it.hasPrice ? `$${Math.round(it.value).toLocaleString()}` : '—'}</td>
                </tr>`).join('')}
                <tr><td colspan="3" style="padding:2px 8px;text-align:right;color:var(--muted);">Subtotal</td><td style="padding:2px 8px;font-family:var(--mono);font-weight:700;">$${Math.round(subtotal).toLocaleString()}</td></tr>
            </tbody>`;
            }).join('')}
            <tfoot><tr><td colspan="3" style="padding:8px;font-weight:700;">Grand total</td><td style="padding:8px;font-weight:700;font-family:var(--mono);color:var(--reagent);">$${Math.round(grandTotal).toLocaleString()}</td></tr></tfoot>
        </table>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
            <button class="ghost small" id="at-shop-copy">Copy as text</button>
            <button class="ghost small" id="at-shop-add-total">+ War cost (grand total)</button>
        </div>`;
    $('at-shop-copy').addEventListener('click', () => {
        const restockedNote = it => {
            const deposited = it.deposited || 0;
            if (!deposited) return '';
            const diff = deposited - it.quantity;
            return ` [restocked ${deposited}x${diff >= 0 ? (diff > 0 ? `, +${diff} spare` : ', ✓') : `, ${Math.abs(diff)} short`}]`;
        };
        const text = 'Restock shopping list:\n' + report.categories.map(cat => {
            const items = atShoppingItemsForCategory(report, cat);
            return `\n${cat.category}:\n` + items.map(it => `  ${it.quantity}x ${it.item}${it.hasPrice ? ` — $${Math.round(it.value).toLocaleString()}` : ''}${restockedNote(it)}`).join('\n');
        }).join('') + `\n\nGrand total: $${Math.round(grandTotal).toLocaleString()}`;
        navigator.clipboard.writeText(text).then(() => toast('Shopping list copied'));
    });
    $('at-shop-add-total').addEventListener('click', () => atAddCostToPayout('Armory restock', grandTotal));
}

// ---- War Payout page integration: pull the same consumption report for a calendar date range,
// right there on that page, so armory costs can be added to the payout without switching tabs.
// Deliberately NOT locked to the war's own start/end — the leader's actual accounting period runs
// from the day after the previous war ended through this war's end (covers restocking between
// wars too, not just the war itself), so the dates default to that but stay fully editable. ----

// Called from war-payout-tracker.js's selectWar (via a typeof-guarded hook) when a war is picked.
// Only fills in blank fields — never overwrites dates the leader already edited.
function wpArmoryDefaultDates() {
    if (typeof wpSelectedWar === 'undefined' || !wpSelectedWar) return;
    let fromTs = wpSelectedWar.start; // fallback if no earlier war is found below
    if (typeof wpWars !== 'undefined' && Array.isArray(wpWars)) {
        const idx = wpWars.findIndex(w => String(w.id) === String(wpSelectedWar.id));
        const prevWar = idx >= 0 ? wpWars[idx + 1] : null; // wpWars is sorted newest-end-first
        if (prevWar) fromTs = prevWar.end + 86400; // the day after the previous war ended
    }
    if (!$('wp-armory-from').value) $('wp-armory-from').value = new Date(fromTs * 1000).toISOString().slice(0, 10);
    if (!$('wp-armory-to').value) $('wp-armory-to').value = new Date(wpSelectedWar.end * 1000).toISOString().slice(0, 10);
}

$('wp-armory-calc').addEventListener('click', async () => {
    const st = $('wp-armory-status');
    const from = atDateInputToTs($('wp-armory-from').value, false);
    const to = atDateInputToTs($('wp-armory-to').value, true);
    if (!from || !to) { st.className = 'status err'; st.textContent = 'Pick both dates.'; return; }
    try {
        const result = await atCalculateReport(from, to, (done, total) => {
            st.className = 'status ok'; st.textContent = `Fetching… (${done}/${total})`;
        });
        st.className = result.meta.hitPageCap ? 'status err' : 'status';
        st.textContent = result.meta.hitPageCap ? '⚠ Hit the page limit even per 3-day slice — numbers may be incomplete for an unusually active period.' : '';
        renderWpArmoryBody(result);
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    }
});

function renderWpArmoryBody(report) {
    const el = $('wp-armory-body');
    if (!report.categories.length) {
        el.innerHTML = '<p style="color:var(--muted);font-size:12px;">Nothing consumed in this date range.</p>';
        return;
    }
    el.innerHTML = report.categories.map(cat => `
        <div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:13px;">
            <span style="flex:1;">${AT_CATEGORY_ICONS[cat.category] || '📦'} ${esc(cat.category)} — ${cat.quantity}x</span>
            <span style="font-family:var(--mono);">$${Math.round(cat.value).toLocaleString()}</span>
            <button class="ghost small" data-wp-armory-cat="${esc(cat.category)}" data-wp-armory-value="${cat.value}">+ Add</button>
        </div>`).join('')
        + `<div style="display:flex;justify-content:flex-end;margin-top:8px;"><button class="ghost small" id="wp-armory-add-total">+ Add all ($${Math.round(report.grandTotal).toLocaleString()})</button></div>`;
    el.querySelectorAll('[data-wp-armory-cat]').forEach(btn => {
        btn.addEventListener('click', () => atAddCostToPayout(btn.dataset.wpArmoryCat, Number(btn.dataset.wpArmoryValue)));
    });
    $('wp-armory-add-total').addEventListener('click', () => atAddCostToPayout('Armory costs', report.grandTotal));
}
