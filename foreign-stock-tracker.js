// foreign-stock-tracker.js — WorldWideLabs Overseas Stock page.
'use strict';

let foreignStockLoaded = false;
let fsCountries = []; // last fetched data, cached so filtering/sorting doesn't need a refetch

const FS_COUNTRIES_KEY = 'wwl_fs_countries';   // which country checkboxes are selected
const FS_HIDE_LOSS_KEY = 'wwl_fs_hide_loss';
const FS_SORT_KEY = 'wwl_fs_sort';             // "field:dir", e.g. "profit:desc"

const FS_FLAGS = {
    mex: '🇲🇽', cay: '🇰🇾', can: '🇨🇦', haw: '🇺🇸', uni: '🇬🇧',
    arg: '🇦🇷', swi: '🇨🇭', jap: '🇯🇵', chi: '🇨🇳', uae: '🇦🇪', sou: '🇿🇦',
};

function fsGetSelectedCountries(allCodes) {
    try {
        const raw = localStorage.getItem(FS_COUNTRIES_KEY);
        if (raw === null) return new Set(allCodes); // default: everything selected
        return new Set(JSON.parse(raw));
    } catch { return new Set(allCodes); }
}
function fsSaveSelectedCountries(set) {
    localStorage.setItem(FS_COUNTRIES_KEY, JSON.stringify([...set]));
}
function fsGetHideLoss() { return localStorage.getItem(FS_HIDE_LOSS_KEY) === '1'; }
function fsGetSort() {
    const raw = localStorage.getItem(FS_SORT_KEY) || 'profit:desc';
    const [field, dir] = raw.split(':');
    return { field: field || 'profit', dir: dir || 'desc' };
}
function fsSaveSort(field, dir) { localStorage.setItem(FS_SORT_KEY, `${field}:${dir}`); }

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
        fsCountries = data.countries || [];
        renderFsControls();
        renderForeignStock();
        st.textContent = ''; st.className = 'status';
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
        $('fs-body').innerHTML = '<p style="color:var(--muted);">Could not load overseas stock right now.</p>';
    }
}

$('fs-refresh').addEventListener('click', () => { foreignStockLoaded = false; loadForeignStock(); });

function renderFsControls() {
    const allCodes = fsCountries.map(c => c.code);
    const selected = fsGetSelectedCountries(allCodes);
    const hideLoss = fsGetHideLoss();
    const sort = fsGetSort();

    const controlsEl = $('fs-controls');
    controlsEl.innerHTML = `
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px;">
            <div style="position:relative;">
                <button class="ghost small" id="fs-country-toggle">Countries (${selected.size}/${allCodes.length}) ▾</button>
                <div id="fs-country-dropdown" style="display:none;position:absolute;top:100%;left:0;margin-top:4px;background:var(--bench);border:1px solid var(--line);border-radius:var(--radius);padding:10px;z-index:20;min-width:200px;box-shadow:0 8px 24px rgba(0,0,0,.6);">
                    <div style="display:flex;gap:8px;margin-bottom:8px;">
                        <button class="ghost small" id="fs-country-all">All</button>
                        <button class="ghost small" id="fs-country-none">None</button>
                    </div>
                    ${fsCountries.map(c => `
                        <label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;font-size:13px;">
                            <input type="checkbox" class="fs-country-cb" value="${esc(c.code)}" style="width:auto;" ${selected.has(c.code) ? 'checked' : ''}>
                            ${FS_FLAGS[c.code] || ''} ${esc(c.name)}
                        </label>`).join('')}
                </div>
            </div>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;">
                <input type="checkbox" id="fs-hide-loss" style="width:auto;" ${hideLoss ? 'checked' : ''}>
                Hide items with loss
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted);">
                Sort by
                <select id="fs-sort-field" style="font-size:13px;">
                    <option value="profit" ${sort.field === 'profit' ? 'selected' : ''}>Profit</option>
                    <option value="cost" ${sort.field === 'cost' ? 'selected' : ''}>Price</option>
                    <option value="quantity" ${sort.field === 'quantity' ? 'selected' : ''}>Stock</option>
                </select>
                <select id="fs-sort-dir" style="font-size:13px;">
                    <option value="desc" ${sort.dir === 'desc' ? 'selected' : ''}>High → Low</option>
                    <option value="asc" ${sort.dir === 'asc' ? 'selected' : ''}>Low → High</option>
                </select>
            </label>
        </div>`;

    $('fs-country-toggle').addEventListener('click', (e) => {
        e.stopPropagation();
        const dd = $('fs-country-dropdown');
        dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', (e) => {
        const dd = $('fs-country-dropdown');
        if (dd && dd.style.display !== 'none' && !dd.contains(e.target) && e.target.id !== 'fs-country-toggle') {
            dd.style.display = 'none';
        }
    });
    $('fs-country-all').addEventListener('click', () => {
        fsSaveSelectedCountries(new Set(allCodes));
        renderFsControls(); renderForeignStock();
    });
    $('fs-country-none').addEventListener('click', () => {
        fsSaveSelectedCountries(new Set());
        renderFsControls(); renderForeignStock();
    });
    controlsEl.querySelectorAll('.fs-country-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            const set = fsGetSelectedCountries(allCodes);
            if (cb.checked) set.add(cb.value); else set.delete(cb.value);
            fsSaveSelectedCountries(set);
            $('fs-country-toggle').textContent = `Countries (${set.size}/${allCodes.length}) ▾`;
            renderForeignStock();
        });
    });
    $('fs-hide-loss').addEventListener('change', () => {
        localStorage.setItem(FS_HIDE_LOSS_KEY, $('fs-hide-loss').checked ? '1' : '0');
        renderForeignStock();
    });
    $('fs-sort-field').addEventListener('change', () => {
        fsSaveSort($('fs-sort-field').value, $('fs-sort-dir').value);
        renderForeignStock();
    });
    $('fs-sort-dir').addEventListener('change', () => {
        fsSaveSort($('fs-sort-field').value, $('fs-sort-dir').value);
        renderForeignStock();
    });
}

function renderForeignStock() {
    const body = $('fs-body');
    if (!fsCountries.length) {
        body.innerHTML = '<p style="color:var(--muted);">No stock data available right now — try again shortly.</p>';
        return;
    }

    const allCodes = fsCountries.map(c => c.code);
    const selected = fsGetSelectedCountries(allCodes);
    const hideLoss = fsGetHideLoss();
    const { field, dir } = fsGetSort();

    // Flatten every country's items into one list, tagging each with its country context.
    let rows = [];
    for (const c of fsCountries) {
        if (!selected.has(c.code)) continue;
        for (const item of c.items) {
            if (item.quantity <= 0) continue;
            if (hideLoss && (item.profit == null || item.profit <= 0)) continue;
            rows.push({ ...item, countryCode: c.code, countryName: c.name, ageMinutes: c.ageMinutes });
        }
    }

    rows.sort((a, b) => {
        let av, bv;
        if (field === 'cost') { av = a.cost; bv = b.cost; }
        else if (field === 'quantity') { av = a.quantity; bv = b.quantity; }
        else { av = a.profit ?? -Infinity; bv = b.profit ?? -Infinity; }
        return dir === 'asc' ? av - bv : bv - av;
    });

    if (!rows.length) {
        body.innerHTML = '<p style="color:var(--muted);">Nothing matches the current filters.</p>';
        return;
    }

    body.innerHTML = `
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <thead><tr style="color:var(--muted);text-align:left;">
                <th style="padding:6px 8px;">Country</th><th style="padding:6px 8px;">Item</th>
                <th style="padding:6px 8px;">Stock</th><th style="padding:6px 8px;">Cost</th>
                <th style="padding:6px 8px;">Profit</th><th style="padding:6px 8px;">Updated</th>
            </tr></thead>
            <tbody>${rows.map(i => {
                const profitColor = i.profit == null ? 'var(--muted)' : i.profit > 0 ? 'var(--reagent)' : 'var(--danger)';
                const profitText = i.profit != null
                    ? `${i.profit >= 0 ? '+' : ''}$${i.profit.toLocaleString()}${i.profitPct != null ? ` (${i.profitPct}%)` : ''}`
                    : 'unknown';
                return `
                    <tr style="border-top:1px solid var(--line);">
                        <td style="padding:6px 8px;white-space:nowrap;">${FS_FLAGS[i.countryCode] || ''} ${esc(i.countryName)}</td>
                        <td style="padding:6px 8px;">${esc(i.name)}</td>
                        <td style="padding:6px 8px;font-family:var(--mono);">${i.quantity}</td>
                        <td style="padding:6px 8px;font-family:var(--mono);">$${i.cost.toLocaleString()}</td>
                        <td style="padding:6px 8px;font-family:var(--mono);color:${profitColor};">${esc(profitText)}</td>
                        <td style="padding:6px 8px;font-size:11px;color:${fsFreshnessColor(i.ageMinutes)};">${esc(fsAgo(i.ageMinutes))}</td>
                    </tr>`;
            }).join('')}
            </tbody>
        </table>`;
}
