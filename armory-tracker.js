// armory-tracker.js — WorldWideLabs Consumption Tracker (frontend).
'use strict';

let atLoaded = false;
let atWars = [];
let atSelectedWar = null;
let atReport = null; // last consumption-report result, shared by the detail view + shopping list

async function atFetch(body) {
    const res = await fetch('/api/armory-tracker', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: apiKey, ...body }),
    });
    return res.json();
}

function atFmtDate(ts) {
    return new Date(ts * 1000).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}
// A category's icon, purely cosmetic — falls back to a generic box for anything not listed
// (Torn's own item `type` field drives the actual grouping, so a new category still works fine,
// just without a matching icon).
const AT_CATEGORY_ICONS = {
    Drug: '💊', Medical: '🩹', Alcohol: '🍺', Candy: '🍬', Temporary: '🔫', Booster: '⚡', Other: '📦',
};

async function loadArmoryTracker() {
    $('at-locked').style.display = isLeaderCached ? 'none' : 'block';
    $('at-editor').style.display = isLeaderCached ? 'block' : 'none';
    if (!isLeaderCached) return;
    if (atLoaded) return; // only auto-run once per session — use the buttons to refresh
    atLoaded = true;
    await atSync();
    loadAtLoans();
    loadAtXanaxWars();
}

async function atSync() {
    const st = $('at-sync-status');
    st.className = 'status ok'; st.textContent = 'Syncing…';
    try {
        const result = await atFetch({ action: 'sync' });
        if (result.error) throw new Error(result.error);
        st.className = 'status ok';
        st.textContent = `Synced ${result.synced} new event(s) from ${result.totalAvailable} in range.`
            + (result.unparsedCount ? ` ${result.unparsedCount} entr${result.unparsedCount === 1 ? 'y' : 'ies'} didn't match a known pattern — tell WWL if a report looks incomplete.` : '');
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    }
}

async function atDeepSync() {
    const btn = $('at-deep-sync');
    const st = $('at-sync-status');
    btn.disabled = true; btn.textContent = 'Digging…';
    try {
        const result = await atFetch({ action: 'deep-sync' });
        if (result.error) throw new Error(result.error);
        st.className = 'status ok';
        st.textContent = `Dug through ${result.pagesFetched} page(s), found ${result.synced} more event(s). ${result.rateLimited ? 'Torn rate-limited this — try again in a minute for more.' : 'Click again to keep going further back.'}`;
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    } finally {
        btn.disabled = false; btn.textContent = 'Dig deeper';
    }
}

$('at-sync').addEventListener('click', atSync);
$('at-deep-sync').addEventListener('click', atDeepSync);

async function loadAtLoans() {
    const st = $('at-loans-status');
    st.className = 'status ok'; st.textContent = 'Loading current loans…';
    try {
        const result = await atFetch({ action: 'current-loans' });
        if (result.error) throw new Error(result.error);
        st.className = 'status'; st.textContent = '';
        renderAtLoans(result.loans || []);
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    }
}

function renderAtLoans(loans) {
    const el = $('at-loans-body');
    if (!loans.length) {
        el.innerHTML = '<p style="color:var(--muted);font-size:13px;">Nothing currently on loan.</p>';
        return;
    }
    const total = loans.reduce((s, l) => s + (l.totalValue || 0), 0);
    el.innerHTML = `
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <thead><tr style="color:var(--muted);text-align:left;">
                <th style="padding:4px 8px;">Item</th><th style="padding:4px 8px;">Qty out</th>
                <th style="padding:4px 8px;">Held by</th><th style="padding:4px 8px;">Value</th><th style="padding:4px 8px;"></th>
            </tr></thead>
            <tbody>${loans.map((l, i) => `
                <tr style="border-top:1px solid var(--line);">
                    <td style="padding:4px 8px;">${esc(l.name)}</td>
                    <td style="padding:4px 8px;font-family:var(--mono);">${l.loaned}</td>
                    <td style="padding:4px 8px;">${esc(l.holders.join(', '))}</td>
                    <td style="padding:4px 8px;font-family:var(--mono);">${l.totalValue != null ? `$${Math.round(l.totalValue).toLocaleString()}` : '—'}</td>
                    <td style="padding:4px 8px;">${l.totalValue ? `<button class="ghost small" data-loan-idx="${i}">+ War cost</button>` : ''}</td>
                </tr>`).join('')}
            </tbody>
            <tfoot><tr><td colspan="3" style="padding:4px 8px;font-weight:700;">Total outstanding</td><td style="padding:4px 8px;font-weight:700;font-family:var(--mono);">$${Math.round(total).toLocaleString()}</td>
                <td style="padding:4px 8px;">${total ? '<button class="ghost small" id="at-loans-add-total">+ War cost (all)</button>' : ''}</td></tr></tfoot>
        </table>`;
    el.querySelectorAll('[data-loan-idx]').forEach(btn => {
        btn.addEventListener('click', () => {
            const l = loans[Number(btn.dataset.loanIdx)];
            atAddCostToPayout(`${l.name} (on loan, not yet returned)`, l.totalValue);
        });
    });
    $('at-loans-add-total')?.addEventListener('click', () => atAddCostToPayout('Outstanding temp-weapon loans', total));
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

async function loadAtXanaxWars() {
    const st = $('at-xanax-war-status');
    st.className = 'status ok'; st.textContent = 'Loading past wars…';
    try {
        const result = await atFetch({ action: 'list-wars' });
        if (result.error) throw new Error(result.error);
        atWars = result.wars || [];
        renderAtWarList();
        st.textContent = ''; st.className = 'status';
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    }
}

function renderAtWarList() {
    const el = $('at-xanax-war-list');
    if (!atWars.length) {
        el.innerHTML = '<p style="color:var(--muted);font-size:13px;">No past wars found on this key.</p>';
        return;
    }
    el.innerHTML = `
        <div class="ocfit-scenario collapsed" data-collapse="at-wars">
            <div class="ocfit-scenario-header">
                <span>Past wars (${atWars.length})</span>
                <span class="chev">▾</span>
            </div>
            <div class="ocfit-scenario-body">${atWars.map((w, i) => `
                <div class="ocfit-role-row" data-war-idx="${i}" style="cursor:pointer;">
                    <span class="ocfit-role-name">${esc(w.them?.name || 'Unknown opponent')}</span>
                    <span style="font-size:12px;color:var(--muted);">${esc(atFmtDate(w.end))}</span>
                </div>`).join('')}
            </div>
        </div>`;
    el.querySelector('.ocfit-scenario-header').addEventListener('click', () => {
        el.querySelector('.ocfit-scenario').classList.toggle('collapsed');
    });
    el.querySelectorAll('[data-war-idx]').forEach(row => {
        row.addEventListener('click', () => selectAtWar(Number(row.dataset.warIdx)));
    });
}

async function selectAtWar(idx) {
    atSelectedWar = atWars[idx];
    $('at-xanax-war-list').querySelectorAll('[data-war-idx]').forEach((row, i) => {
        row.style.background = i === idx ? 'var(--bench-2)' : '';
    });
    const el = $('at-xanax-body');
    el.innerHTML = '<p style="color:var(--muted);">Checking…</p>';
    try {
        const result = await atFetch({ action: 'xanax-check', warStart: atSelectedWar.start, warEnd: atSelectedWar.end });
        if (result.error) throw new Error(result.error);
        renderAtXanax(result.rows || []);
    } catch (e) {
        el.innerHTML = `<p style="color:var(--danger);">${esc(e.message)}</p>`;
    }
}

function renderAtXanax(rows) {
    const el = $('at-xanax-body');
    if (!rows.length) {
        el.innerHTML = '<p style="color:var(--muted);font-size:13px;">No xanax use or war hits found for this war.</p>';
        return;
    }
    el.innerHTML = `
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <thead><tr style="color:var(--muted);text-align:left;">
                <th style="padding:4px 8px;">Member</th><th style="padding:4px 8px;">Xanax taken</th>
                <th style="padding:4px 8px;">Hits landed</th><th style="padding:4px 8px;">Required (×10)</th><th style="padding:4px 8px;">Short by</th>
            </tr></thead>
            <tbody>${rows.map(r => `
                <tr style="border-top:1px solid var(--line);${r.shortfall > 0 ? 'background:rgba(220,80,80,.12);' : ''}">
                    <td style="padding:4px 8px;${r.shortfall > 0 ? 'color:var(--danger);font-weight:700;' : ''}">${esc(r.name)}</td>
                    <td style="padding:4px 8px;font-family:var(--mono);">${r.xanaxTaken}</td>
                    <td style="padding:4px 8px;font-family:var(--mono);">${r.hits}</td>
                    <td style="padding:4px 8px;font-family:var(--mono);color:var(--muted);">${r.required}</td>
                    <td style="padding:4px 8px;font-family:var(--mono);${r.shortfall > 0 ? 'color:var(--danger);font-weight:700;' : 'color:var(--muted);'}">${r.shortfall > 0 ? r.shortfall : '—'}</td>
                </tr>`).join('')}
            </tbody>
        </table>`;
}

// ---- Consumption report: the main event. One date range, grouped category -> item -> player,
// shared between the detailed report view and the derived (cleaner, no-players) shopping list. ----

function atDateInputToTs(val, endOfDay) {
    if (!val) return null;
    const ts = Math.floor(new Date(val).getTime() / 1000);
    return endOfDay ? ts + 86399 : ts; // include the whole "to" day
}

$('at-report-calc').addEventListener('click', async () => {
    const st = $('at-report-status');
    const from = atDateInputToTs($('at-report-from').value, false);
    const to = atDateInputToTs($('at-report-to').value, true);
    if (!from || !to) { st.className = 'status err'; st.textContent = 'Pick both dates.'; return; }
    st.className = 'status ok'; st.textContent = 'Calculating…';
    try {
        const result = await atFetch({ action: 'consumption-report', from, to });
        if (result.error) throw new Error(result.error);
        st.className = 'status'; st.textContent = '';
        atReport = result;
        renderAtReportDetail(result);
        renderAtShoppingList(result);
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    }
});

function renderAtReportDetail(report) {
    const el = $('at-report-body');
    if (!report.categories.length) {
        el.innerHTML = '<p style="color:var(--muted);font-size:13px;">Nothing consumed in this range — try a wider date range, or hit Sync above first.</p>';
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
                        ${it.players.map(p => `<div>${esc(p.name)} — ${p.quantity}x${it.hasPrice ? ` — $${Math.round(p.value).toLocaleString()}` : ''}</div>`).join('')}
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

function renderAtShoppingList(report) {
    const el = $('at-shop-body');
    if (!report.categories.length) {
        el.innerHTML = '<p style="color:var(--muted);font-size:13px;">Nothing to restock for this range.</p>';
        return;
    }
    el.innerHTML = `
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <thead><tr style="color:var(--muted);text-align:left;"><th style="padding:4px 8px;">Item</th><th style="padding:4px 8px;">Buy back</th><th style="padding:4px 8px;">Cost</th></tr></thead>
            ${report.categories.map(cat => `
            <tbody>
                <tr><td colspan="3" style="padding:8px 8px 2px;font-weight:700;">${AT_CATEGORY_ICONS[cat.category] || '📦'} ${esc(cat.category)}</td></tr>
                ${cat.items.map(it => `
                <tr style="border-top:1px solid var(--line);">
                    <td style="padding:4px 8px;">${esc(it.item)}</td>
                    <td style="padding:4px 8px;font-family:var(--mono);">${it.quantity}x</td>
                    <td style="padding:4px 8px;font-family:var(--mono);${it.hasPrice ? '' : 'color:var(--muted);'}">${it.hasPrice ? `$${Math.round(it.value).toLocaleString()}` : '—'}</td>
                </tr>`).join('')}
                <tr><td colspan="2" style="padding:2px 8px;text-align:right;color:var(--muted);">Subtotal</td><td style="padding:2px 8px;font-family:var(--mono);font-weight:700;">$${Math.round(cat.value).toLocaleString()}</td></tr>
            </tbody>`).join('')}
            <tfoot><tr><td colspan="2" style="padding:8px;font-weight:700;">Grand total</td><td style="padding:8px;font-weight:700;font-family:var(--mono);color:var(--reagent);">$${Math.round(report.grandTotal).toLocaleString()}</td></tr></tfoot>
        </table>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
            <button class="ghost small" id="at-shop-copy">Copy as text</button>
            <button class="ghost small" id="at-shop-add-total">+ War cost (grand total)</button>
        </div>`;
    $('at-shop-copy').addEventListener('click', () => {
        const text = 'Restock shopping list:\n' + report.categories.map(cat =>
            `\n${cat.category}:\n` + cat.items.map(it => `  ${it.quantity}x ${it.item}${it.hasPrice ? ` — $${Math.round(it.value).toLocaleString()}` : ''}`).join('\n')
        ).join('') + `\n\nGrand total: $${Math.round(report.grandTotal).toLocaleString()}`;
        navigator.clipboard.writeText(text).then(() => toast('Shopping list copied'));
    });
    $('at-shop-add-total').addEventListener('click', () => atAddCostToPayout('Armory restock', report.grandTotal));
}

// ---- War Payout page integration: pull the same consumption report for the selected war's own
// dates, right there on that page, so armory costs can be added to the payout without switching
// tabs (wpSelectedWar is a global from war-payout-tracker.js). ----
$('wp-armory-calc').addEventListener('click', async () => {
    const st = $('wp-armory-status');
    if (typeof wpSelectedWar === 'undefined' || !wpSelectedWar) {
        st.className = 'status err'; st.textContent = 'Pick a war above first.';
        return;
    }
    st.className = 'status ok'; st.textContent = 'Pulling consumption for this war…';
    try {
        const result = await atFetch({ action: 'consumption-report', from: wpSelectedWar.start, to: wpSelectedWar.end });
        if (result.error) throw new Error(result.error);
        st.className = 'status'; st.textContent = '';
        renderWpArmoryBody(result);
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    }
});

function renderWpArmoryBody(report) {
    const el = $('wp-armory-body');
    if (!report.categories.length) {
        el.innerHTML = '<p style="color:var(--muted);font-size:12px;">Nothing consumed during this war\'s dates.</p>';
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
    $('wp-armory-add-total').addEventListener('click', () => atAddCostToPayout('Armory (this war)', report.grandTotal));
}
