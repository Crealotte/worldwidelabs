// player-profile.js — the Player Profile page (net worth, criminal record, job points,
// weapon exp, skills), rendered dynamically from whatever Torn's API returns.
'use strict';

    // ================= PLAYER PROFILE =================
    // Renders whatever Torn actually returns for each selection, rather than assuming an exact
    // shape — field names/structure can shift slightly, and this way the page adapts instead of breaking.
    let profileLoaded = false;

    function humanizeKey(key) {
        return String(key)
            .replace(/_/g, ' ')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/\b\w/g, c => c.toUpperCase());
    }

    function formatTimestamp(val) {
        if (!val) return '—';
        const d = new Date(val * 1000);
        return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    function formatCell(key, val, currency) {
        if (val === null || val === undefined) return '—';
        if (key === 'timestamp') return formatTimestamp(val);
        if (typeof val === 'number') return currency ? fmt$(val) : fmtN(val);
        if (typeof val === 'boolean') return val ? 'Yes' : 'No';
        if (typeof val === 'object') return '';
        return esc(String(val));
    }

    // Renders a flat or nested object as key/value rows. Only pass currency:true for genuinely
    // money-denominated sections (net worth, item worth) — most sections are plain counts.
    function renderDynamicObject(container, obj, opts = {}) {
        const currency = !!opts.currency;
        const exclude = new Set(['parsetime', ...(opts.exclude || [])]); // implementation-detail fields, never useful to show

        if (!obj || typeof obj !== 'object') { container.innerHTML = '<p style="color:var(--muted)">No data returned.</p>'; return; }
        let entries = Object.entries(obj).filter(([k]) => !exclude.has(k));
        if (!entries.length) { container.innerHTML = '<p style="color:var(--muted)">No data returned.</p>'; return; }

        // Pull "total" out to a highlighted summary at the top rather than burying it in the list.
        const totalEntry = entries.find(([k]) => k.toLowerCase() === 'total');
        entries = entries.filter(([k]) => k.toLowerCase() !== 'total');

        const simple = entries.filter(([, v]) => typeof v !== 'object' || v === null);
        const nested = entries.filter(([, v]) => typeof v === 'object' && v !== null);

        let html = '';
        if (totalEntry) {
            html += `<div class="stat" style="margin-bottom:12px;"><div class="k">Total</div><div class="v good">${formatCell('total', totalEntry[1], currency)}</div></div>`;
        }
        if (simple.length) {
            html += simple.map(([k, v]) => `
                <div class="result-line"><span class="rk">${esc(humanizeKey(k))}</span><span class="rv">${formatCell(k, v, currency)}</span></div>`).join('');
        }
        nested.forEach(([k, v]) => {
            html += `<div class="lab-label" style="margin-top:14px;">${esc(humanizeKey(k))}</div>`;
            if (Array.isArray(v)) {
                if (!v.length) { html += `<p style="color:var(--muted);font-size:13px;">None.</p>`; return; }
                const cols = [...new Set(v.flatMap(item => (item && typeof item === 'object') ? Object.keys(item) : ['value']))];
                html += `<div class="table-scroll"><table><thead><tr>${cols.map(c => `<th>${esc(humanizeKey(c))}</th>`).join('')}</tr></thead><tbody>`;
                v.forEach(item => {
                    html += '<tr>' + cols.map(c => `<td>${formatCell(c, (item && typeof item === 'object') ? item[c] : item, currency)}</td>`).join('') + '</tr>';
                });
                html += '</tbody></table></div>';
            } else {
                const subVals = Object.values(v);
                const isDictOfDicts = subVals.length > 0 && subVals.every(x => x && typeof x === 'object');
                if (isDictOfDicts) {
                    // e.g. jobpoints.companies — a dict keyed by company ID, each value its own object.
                    const cols = [...new Set(subVals.flatMap(o => Object.keys(o)))].filter(c => c !== 'name');
                    html += `<div class="table-scroll"><table><thead><tr><th>Name</th>${cols.map(c => `<th>${esc(humanizeKey(c))}</th>`).join('')}</tr></thead><tbody>`;
                    Object.entries(v).forEach(([subKey, subVal]) => {
                        const label = subVal.name || humanizeKey(subKey);
                        html += `<tr><td>${esc(label)}</td>${cols.map(c => `<td>${formatCell(c, subVal[c], currency)}</td>`).join('')}</tr>`;
                    });
                    html += '</tbody></table></div>';
                } else {
                    html += Object.entries(v).map(([k2, v2]) => `
                        <div class="result-line"><span class="rk">${esc(humanizeKey(k2))}</span><span class="rv">${formatCell(k2, v2, currency)}</span></div>`).join('');
                }
            }
        });
        container.innerHTML = html || '<p style="color:var(--muted)">No data returned.</p>';
    }

    // Debug helper — appends a collapsible "show raw data" toggle so we can see exactly what
    // Torn actually returned when a section looks wrong, instead of guessing at field names again.
    function appendRawDataToggle(container, data) {
        const id = 'raw-' + Math.random().toString(36).slice(2);
        container.insertAdjacentHTML('beforeend', `
            <details style="margin-top:10px;">
                <summary style="cursor:pointer;color:var(--muted);font-size:11px;">Show raw data (for debugging)</summary>
                <pre id="${id}" style="background:var(--bench-2);border:1px solid var(--line);border-radius:6px;padding:10px;margin-top:6px;font-size:11px;overflow:auto;max-height:260px;white-space:pre-wrap;"></pre>
            </details>`);
        $(id).textContent = JSON.stringify(data, null, 2) ?? 'null / undefined — Torn returned nothing for this selection.';
    }

    $('profile-refresh').addEventListener('click', () => { profileLoaded = false; loadPlayerProfile(); });

    async function loadPlayerProfile() {
        if (profileLoaded) return;
        profileLoaded = true;
        const st = $('profile-status');
        st.className = 'status ok'; st.textContent = 'Loading…';
        try {
            const profileData = await tornV1('networth,criminalrecord,jobpoints,weaponexp');

            renderDynamicObject($('pf-networth'), profileData.networth, { currency: true, exclude: ['timestamp'] });
            renderDynamicObject($('pf-criminal'), profileData.criminalrecord);
            renderDynamicObject($('pf-jobpoints'), profileData.jobpoints);
            renderDynamicObject($('pf-weaponexp'), Array.isArray(profileData.weaponexp)
                ? { weapons: profileData.weaponexp } : profileData.weaponexp);

            st.textContent = ''; st.className = 'status';
        } catch (e) {
            profileLoaded = false; // allow retry
            st.className = 'status err';
            st.textContent = e.message;
        }
    }

