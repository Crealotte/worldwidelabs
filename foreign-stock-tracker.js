// foreign-stock-tracker.js — WorldWideLabs Overseas Stock page.
'use strict';

let foreignStockLoaded = false;
const FS_COLLAPSE_KEY = 'wwl_fs_collapsed';

function fsGetCollapsed() {
    try { return JSON.parse(localStorage.getItem(FS_COLLAPSE_KEY)) || []; } catch { return []; }
}
function fsToggleCollapsed(id) {
    const set = new Set(fsGetCollapsed());
    if (set.has(id)) set.delete(id); else set.add(id);
    localStorage.setItem(FS_COLLAPSE_KEY, JSON.stringify([...set]));
    return set.has(id);
}

function fsAgo(minutes) {
    if (minutes == null) return 'unknown';
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hrs = Math.floor(minutes / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

function fsFreshnessColor(minutes) {
    if (minutes == null) return 'var(--muted)';
    if (minutes < 20) return 'var(--reagent)';
    if (minutes < 90) return 'var(--happy)';
    return 'var(--danger)';
}

async function loadForeignStock() {
    const st = $('fs-status');
    st.className = 'status ok'; st.textContent = 'Fetching live stock…';
    try {
        const res = await fetch('/api/foreign-stock', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: apiKey, action: 'read' }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        renderForeignStock(data.countries || []);
        st.textContent = ''; st.className = 'status';
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
        $('fs-body').innerHTML = '<p style="color:var(--muted);">Could not load overseas stock right now.</p>';
    }
}

$('fs-refresh').addEventListener('click', () => { foreignStockLoaded = false; loadForeignStock(); });

function renderForeignStock(countries) {
    const body = $('fs-body');
    if (!countries.length) {
        body.innerHTML = '<p style="color:var(--muted);">No stock data available right now — try again shortly.</p>';
        return;
    }
    const collapsed = fsGetCollapsed();

    body.innerHTML = countries.map(c => {
        const cId = `fs-country-${c.code}`;
        const cCollapsed = collapsed.includes(cId);
        const inStock = c.items.filter(i => i.quantity > 0);
        const freshBadge = `<span class="ocfit-live-badge" style="background:var(--bench-2);color:${fsFreshnessColor(c.ageMinutes)};">updated ${esc(fsAgo(c.ageMinutes))}</span>`;

        const itemsHtml = inStock.length
            ? inStock.map(i => {
                const profitColor = i.profit == null ? 'var(--muted)' : i.profit > 0 ? 'var(--reagent)' : 'var(--danger)';
                const profitText = i.profit != null
                    ? `${i.profit >= 0 ? '+' : ''}$${i.profit.toLocaleString()}${i.profitPct != null ? ` (${i.profitPct}%)` : ''}`
                    : 'profit unknown';
                return `
                    <div class="fs-item-row">
                        <span class="fs-item-name">${esc(i.name)}</span>
                        <span class="fs-item-meta">qty ${i.quantity} · cost $${i.cost.toLocaleString()}</span>
                        <span class="fs-item-profit" style="color:${profitColor};">${esc(profitText)}</span>
                    </div>`;
            }).join('')
            : '<p style="color:var(--muted);font-size:13px;margin:4px 0;">Nothing in stock right now.</p>';

        return `
            <div class="ocfit-scenario ${cCollapsed ? 'collapsed' : ''}" data-collapse="${cId}" style="margin-bottom:8px;">
                <div class="ocfit-scenario-header">
                    <span>${esc(c.name)}</span>
                    <span style="font-size:11px;color:var(--muted);">${inStock.length} item${inStock.length === 1 ? '' : 's'} in stock</span>
                    ${freshBadge}
                    <span class="chev">▾</span>
                </div>
                <div class="ocfit-scenario-body">${itemsHtml}</div>
            </div>`;
    }).join('');

    body.querySelectorAll('.ocfit-scenario-header').forEach(header => {
        header.addEventListener('click', () => {
            const scen = header.closest('.ocfit-scenario');
            const isCollapsed = fsToggleCollapsed(scen.dataset.collapse);
            scen.classList.toggle('collapsed', isCollapsed);
        });
    });
}
