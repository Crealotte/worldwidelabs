// foreign-stock-tracker.js — WorldWideLabs Overseas Stock page.
'use strict';

let foreignStockLoaded = false;
let fsCountries = []; // last fetched data, cached so filtering/sorting doesn't need a refetch

const FS_COUNTRIES_KEY = 'wwl_fs_countries';   // which country checkboxes are selected
const FS_HIDE_LOSS_KEY = 'wwl_fs_hide_loss';
const FS_SORT_KEY = 'wwl_fs_sort';             // "field:dir", e.g. "profitPct:desc"

const FS_FLAGS = {
    mex: '🇲🇽', cay: '🇰🇾', can: '🇨🇦', haw: '🇺🇸', uni: '🇬🇧',
    arg: '🇦🇷', swi: '🇨🇭', jap: '🇯🇵', chi: '🇨🇳', uae: '🇦🇪', sou: '🇿🇦',
};

// ---- Trip planner: what one trip pays for THIS member's own setup (rules from the Torn wiki Travel page, checked Nov 2026) ----
const FS_SETUP_KEY = 'wwl_fs_setup';
const FS_EXCURSION = 4; // our faction's Excursion perk level: +1 carried item per level (V to VIII are planned in the perk roadmap)
// minutes each way: standard / property airstrip / WLT stock block / business class, and the standard ticket price
const FS_FLIGHTS = {
    mex: { std: 24, air: 17, wlt: 12, bc: 7, cost: 6500 },    cay: { std: 33, air: 23, wlt: 17, bc: 10, cost: 10000 },
    can: { std: 39, air: 27, wlt: 19, bc: 12, cost: 9000 },   haw: { std: 127, air: 89, wlt: 63, bc: 38, cost: 11000 },
    uni: { std: 151, air: 106, wlt: 75, bc: 45, cost: 18000 }, arg: { std: 158, air: 111, wlt: 79, bc: 47, cost: 21000 },
    swi: { std: 166, air: 116, wlt: 83, bc: 50, cost: 27000 }, jap: { std: 213, air: 149, wlt: 107, bc: 64, cost: 32000 },
    chi: { std: 229, air: 160, wlt: 114, bc: 69, cost: 35000 }, uae: { std: 257, air: 180, wlt: 128, bc: 77, cost: 32000 },
    sou: { std: 282, air: 197, wlt: 141, bc: 85, cost: 40000 },
};
const FS_SUITCASES = { none: ['No suitcase', 0], small: ['Small suitcase (+1)', 1], medium: ['Medium suitcase (+2)', 2], large: ['Large suitcase (+3)', 3] };
const FS_COMPANIES = {
    none: ['None of these', {}],
    lingerie: ['Lingerie Store 3★ to 9★ (+2 items)', { general: 2 }],
    lingerie10: ['Lingerie Store 10★ (+2 items, free business class)', { general: 2, freeBc: true }],
    cruise3: ['Cruise Line 3★ to 9★ (+2 items)', { general: 2 }],
    cruise10: ['Cruise Line 10★ (+5 items)', { general: 5 }],
    toy: ['Toy Shop 7★+ (+5 plushies)', { plush: 5 }],
    flower: ['Flower Shop 7★+ (+5 flowers)', { flower: 5 }],
};
const FS_SETUP_DEFAULT = { airstrip: false, wlt: false, bct: false, suitcase: 'none', company: 'none', smuggling: false, mailing: false, tourism: false };
let fsBctValue = 0;

function fsGetSetup() {
    try { return { ...FS_SETUP_DEFAULT, ...JSON.parse(localStorage.getItem(FS_SETUP_KEY) || '{}') }; } catch (e) { return { ...FS_SETUP_DEFAULT }; }
}
function fsSaveSetup(s) { try { localStorage.setItem(FS_SETUP_KEY, JSON.stringify(s)); } catch (e) { /* the planner still works without saving */ } }

function fsCapacity(s) {
    const co = (FS_COMPANIES[s.company] || FS_COMPANIES.none)[1];
    const base = (s.airstrip || s.wlt || s.bct || co.freeBc) ? 15 : 10;
    const general = (base + (FS_SUITCASES[s.suitcase] || FS_SUITCASES.none)[1] + (co.general || 0) + FS_EXCURSION + (s.smuggling ? 10 : 0)) * (s.tourism ? 2 : 1);
    return { general, plush: co.plush || 0, flower: co.flower || 0 }; // the Toy Shop and Flower Shop extras are not doubled on Tourism Day
}

// every way this member can fly, each with its time each way and what one flight costs
function fsFlightModes(code, s) {
    const f = FS_FLIGHTS[code]; if (!f) return [];
    const co = (FS_COMPANIES[s.company] || FS_COMPANIES.none)[1], k = s.mailing ? 0.75 : 1; // the Mailing Yourself Abroad book: 25% off for 31 days
    const modes = [];
    if (s.wlt) modes.push({ label: 'WLT flight', mins: f.wlt * k, cost: 0 });
    if (s.bct || co.freeBc) modes.push({ label: co.freeBc ? 'free business class' : 'business class', mins: f.bc * k, cost: co.freeBc ? 0 : fsBctValue });
    if (s.airstrip) modes.push({ label: 'own airstrip', mins: f.air * k, cost: f.cost });
    modes.push({ label: 'standard flight', mins: f.std * k, cost: f.cost });
    return modes;
}

// fill the slots with the most profitable items: the Toy Shop / Flower Shop extras take plushies / flowers only, the rest takes anything
function fsFillTrip(items, cap) {
    const left = new Map(items.map(i => [i, i.quantity]));
    const picked = new Map();
    const take = (list, slots) => {
        for (const i of list) {
            if (slots <= 0) break;
            const n = Math.min(left.get(i), slots);
            if (n <= 0) continue;
            left.set(i, left.get(i) - n); picked.set(i, (picked.get(i) || 0) + n); slots -= n;
        }
    };
    take(items.filter(i => i.type === 'Plushie'), cap.plush);
    take(items.filter(i => i.type === 'Flower'), cap.flower);
    take(items, cap.general);
    const lines = [...picked].map(([i, n]) => ({ name: i.name, qty: n, profit: i.profit * n })).sort((a, b) => b.profit - a.profit);
    return { lines, units: lines.reduce((t, l) => t + l.qty, 0), profit: lines.reduce((t, l) => t + l.profit, 0) };
}

function fsPlanCountry(c, s) {
    const items = c.items.filter(i => i.quantity > 0 && i.profit != null && i.profit > 0).sort((a, b) => b.profit - a.profit);
    const trip = fsFillTrip(items, fsCapacity(s));
    let best = null;
    for (const m of fsFlightModes(c.code, s)) {
        const net = trip.profit - 2 * m.cost, hours = (2 * m.mins) / 60;
        const row = { ...m, net, hours, perHour: hours > 0 ? net / hours : 0 };
        if (!best || row.perHour > best.perHour) best = row;
    }
    return best ? { ...trip, ...best } : null;
}

function fsDur(mins) { const m = Math.round(mins); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`; }
function fsMoney(n) { const a = Math.abs(Math.round(n)); const t = a >= 1e6 ? `${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}m` : a >= 1e3 ? `${Math.round(a / 1e3)}k` : String(a); return `${n < 0 ? '-' : ''}$${t}`; }

function renderFsPlanner() {
    const el = $('fs-plan'); if (!el) return;
    if (!fsCountries.length) { el.innerHTML = ''; return; }
    const s = fsGetSetup(), cap = fsCapacity(s), allCodes = fsCountries.map(c => c.code), selected = fsGetSelectedCountries(allCodes);
    const tick = (id, label, hint) => `<label style="display:flex;align-items:flex-start;gap:6px;cursor:pointer;font-size:13px;"><input type="checkbox" class="fs-set" data-k="${id}" style="width:auto;margin-top:3px;" ${s[id] ? 'checked' : ''}><span>${label}${hint ? `<br><span style="color:var(--muted);font-size:11px;">${hint}</span>` : ''}</span></label>`;
    const radio = (name, opts, cur) => Object.entries(opts).map(([k, v]) => `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;"><input type="radio" name="fs-${name}" class="fs-set-radio" data-k="${name}" value="${k}" style="width:auto;" ${cur === k ? 'checked' : ''}>${v[0]}</label>`).join('');
    const plans = fsCountries.filter(c => selected.has(c.code)).map(c => ({ c, p: fsPlanCountry(c, s) })).filter(x => x.p && x.p.units > 0).sort((a, b) => b.p.perHour - a.p.perHour);
    const extra = (cap.plush ? ` plus ${cap.plush} plushies` : '') + (cap.flower ? ` plus ${cap.flower} flowers` : '');
    el.innerHTML = `
        <div class="panel">
            <h3 style="margin:0 0 4px;">My setup</h3>
            <p style="color:var(--muted);font-size:12px;margin:0 0 10px;">Tick what applies to you, once: it decides how much you can carry and how fast you fly, and it is remembered on this device. Our faction's Excursion perk (level ${FS_EXCURSION}) is already counted: +${FS_EXCURSION} items for everybody.</p>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;">
                <div style="display:flex;flex-direction:column;gap:6px;">
                    <strong style="font-size:12px;color:var(--muted);">Flying</strong>
                    ${tick('airstrip', 'Airstrip and pilot on my property', 'Faster flights and carry 15 items instead of 10')}
                    ${tick('wlt', 'WLT stock block', 'Free flights, faster still, carry 15')}
                    ${tick('bct', 'I use business class tickets', 'Fastest flights, one ticket each way, carry 15')}
                    ${tick('mailing', 'Book: Mailing Yourself Abroad', '25% shorter flights for 31 days')}
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;">
                    <strong style="font-size:12px;color:var(--muted);">Suitcase</strong>${radio('suitcase', FS_SUITCASES, s.suitcase)}
                    <strong style="font-size:12px;color:var(--muted);margin-top:6px;">Carrying books and days</strong>
                    ${tick('smuggling', 'Book: Smuggling For Beginners', '+10 items for 31 days')}
                    ${tick('tourism', 'Tourism Day (27 September)', 'Doubles what you can carry')}
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;"><strong style="font-size:12px;color:var(--muted);">My company</strong>${radio('company', FS_COMPANIES, s.company)}</div>
            </div>
            <p style="margin:12px 0 0;font-size:13px;">You can carry <strong>${cap.general} items</strong>${extra}.</p>
        </div>
        <div class="panel" style="margin-top:12px;">
            <h3 style="margin:0 0 4px;">Best trips for you right now</h3>
            <p style="color:var(--muted);font-size:12px;margin:0 0 10px;">A full trip of the most profitable items in stock, there and back. Profit is Torn's market value minus the shop price (like the list below), minus flight tickets. It does not count the time you spend selling or waiting, so real hours are a bit longer. Countries you un-tick under Countries are left out.</p>
            ${plans.length ? `<div style="overflow-x:auto;"><table style="width:100%;font-size:13px;border-collapse:collapse;">
                <thead><tr style="color:var(--muted);text-align:left;"><th style="padding:6px 8px;">Country</th><th style="padding:6px 8px;">Flight</th><th style="padding:6px 8px;">There and back</th><th style="padding:6px 8px;">Items</th><th style="padding:6px 8px;">Profit per trip</th><th style="padding:6px 8px;">Per hour</th><th style="padding:6px 8px;">What to buy</th><th style="padding:6px 8px;">Stock data</th></tr></thead>
                <tbody>${plans.map(({ c, p }) => `<tr style="border-top:1px solid var(--line);">
                    <td style="padding:6px 8px;white-space:nowrap;">${FS_FLAGS[c.code] || ''} ${esc(c.name)}</td>
                    <td style="padding:6px 8px;white-space:nowrap;">${esc(fsDur(p.mins))}<br><span style="color:var(--muted);font-size:11px;">${esc(p.label)}</span></td>
                    <td style="padding:6px 8px;white-space:nowrap;">${esc(fsDur(p.hours * 60))}</td>
                    <td style="padding:6px 8px;font-family:var(--mono);">${p.units}</td>
                    <td style="padding:6px 8px;font-family:var(--mono);color:${p.net > 0 ? 'var(--reagent)' : 'var(--danger)'};">${esc(fsMoney(p.net))}</td>
                    <td style="padding:6px 8px;font-family:var(--mono);font-weight:700;">${esc(fsMoney(p.perHour))}/h</td>
                    <td style="padding:6px 8px;font-size:12px;">${p.lines.slice(0, 3).map(l => `${l.qty}× ${esc(l.name)}`).join(', ')}${p.lines.length > 3 ? ', …' : ''}</td>
                    <td style="padding:6px 8px;font-size:11px;color:${fsFreshnessColor(c.ageMinutes)};">${esc(fsAgo(c.ageMinutes))}</td></tr>`).join('')}</tbody></table></div>`
                : '<p style="color:var(--muted);margin:0;">No profitable items in the selected countries right now.</p>'}
        </div>`;
    el.querySelectorAll('.fs-set').forEach(cb => cb.addEventListener('change', () => { const n = fsGetSetup(); n[cb.dataset.k] = cb.checked; fsSaveSetup(n); renderFsPlanner(); }));
    el.querySelectorAll('.fs-set-radio').forEach(r => r.addEventListener('change', () => { if (!r.checked) return; const n = fsGetSetup(); n[r.dataset.k] = r.value; fsSaveSetup(n); renderFsPlanner(); }));
}

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
    const raw = localStorage.getItem(FS_SORT_KEY) || 'profitPct:desc';
    const [field, dir] = raw.split(':');
    return { field: field || 'profitPct', dir: dir || 'desc' };
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
        fsBctValue = data.bctValue || 0;
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
                    <option value="profitPct" ${sort.field === 'profitPct' ? 'selected' : ''}>Profit %</option>
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
    renderFsPlanner(); // the trip planner follows the same country selection
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
        else if (field === 'profitPct') { av = a.profitPct ?? -Infinity; bv = b.profitPct ?? -Infinity; }
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
