// armory-tracker.js — WorldWideLabs Consumption Tracker (frontend).
'use strict';

let atLoaded = false;
let atEvents = [];
let atWars = [];
let atSelectedWar = null;

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
function atFmtDateTime(ts) {
    return new Date(ts * 1000).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

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
            + (result.unparsedCount ? ` ${result.unparsedCount} entr${result.unparsedCount === 1 ? 'y' : 'ies'} didn't match a known pattern — tell WWL if the log looks incomplete.` : '');
        await atLoadLog();
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
        await atLoadLog();
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    } finally {
        btn.disabled = false; btn.textContent = 'Dig deeper';
    }
}

async function atLoadLog() {
    const result = await atFetch({ action: 'get-log' });
    if (result.error) return;
    atEvents = result.events || [];
    renderAtLog();
}

function renderAtLog() {
    const q = ($('at-log-search').value || '').toLowerCase();
    const rows = atEvents.filter(e => !q || e.actor.toLowerCase().includes(q) || e.item.toLowerCase().includes(q));
    $('at-log-body').innerHTML = rows.slice(0, 500).map(e => `
        <tr>
            <td style="white-space:nowrap;">${esc(atFmtDateTime(e.timestamp))}</td>
            <td>${esc(e.actor)}</td>
            <td style="text-transform:capitalize;">${esc(e.action)}</td>
            <td>${esc(e.item)}</td>
            <td class="num">${e.quantity}</td>
            <td>${e.otherParty ? esc(e.otherParty) : '—'}</td>
        </tr>`).join('') || '<tr><td colspan="6" style="color:var(--muted);">No events yet — hit Sync, then Dig deeper for older history.</td></tr>';
}
$('at-log-search').addEventListener('input', renderAtLog);
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

$('at-shop-calc').addEventListener('click', async () => {
    const st = $('at-shop-status');
    const fromVal = $('at-shop-from').value, toVal = $('at-shop-to').value;
    if (!fromVal || !toVal) { st.className = 'status err'; st.textContent = 'Pick both dates.'; return; }
    const from = Math.floor(new Date(fromVal).getTime() / 1000);
    const to = Math.floor(new Date(toVal).getTime() / 1000) + 86399; // include the whole "to" day
    st.className = 'status ok'; st.textContent = 'Calculating…';
    try {
        const result = await atFetch({ action: 'shopping-list', from, to });
        if (result.error) throw new Error(result.error);
        st.className = 'status'; st.textContent = '';
        renderAtShoppingList(result.items || []);
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    }
});

function renderAtShoppingList(items) {
    const el = $('at-shop-body');
    if (!items.length) {
        el.innerHTML = '<p style="color:var(--muted);font-size:13px;">Nothing used in this range.</p>';
        return;
    }
    el.innerHTML = `
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <thead><tr style="color:var(--muted);text-align:left;"><th style="padding:4px 8px;">Item</th><th style="padding:4px 8px;">Buy back</th></tr></thead>
            <tbody>${items.map(i => `
                <tr style="border-top:1px solid var(--line);">
                    <td style="padding:4px 8px;">${esc(i.item)}</td>
                    <td style="padding:4px 8px;font-family:var(--mono);font-weight:700;">${i.quantity}x</td>
                </tr>`).join('')}
            </tbody>
        </table>
        <button class="ghost small" id="at-shop-copy" style="margin-top:10px;">Copy as text</button>`;
    $('at-shop-copy').addEventListener('click', () => {
        const text = 'Restock shopping list:\n' + items.map(i => `${i.quantity}x ${i.item}`).join('\n');
        navigator.clipboard.writeText(text).then(() => toast('Shopping list copied'));
    });
}
