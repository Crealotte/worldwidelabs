// tz-map.js — the "Timezone map" page under Faction: a world map with the countries and the timezone lines, where
// the countries members say they live in light up (the more members, the greener). A member picks their own country
// in the dropdown; everyone only sees anonymous counts. Backend: lib/tzMap.js. The map data is in /vendor
// (world-atlas countries + topojson-client).
'use strict';

let tzWorld = null; // the countries as GeoJSON features (id = ISO numeric code, properties.name)

async function tzFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}

async function tzLoadWorld() {
    if (tzWorld) return tzWorld;
    if (typeof topojson === 'undefined') {
        await new Promise((ok, no) => { const s = document.createElement('script'); s.src = '/vendor/topojson-client.min.js'; s.onload = ok; s.onerror = () => no(new Error('Map library did not load')); document.head.appendChild(s); });
    }
    const topo = await (await fetch('/vendor/countries-110m.json')).json();
    tzWorld = topojson.feature(topo, topo.objects.countries).features.filter(f => f.id !== undefined);
    return tzWorld;
}

async function loadTzMap() {
    const st = $('tz-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    try {
        const [r, world] = await Promise.all([tzFetch({ action: 'tz-get' }), tzLoadWorld()]);
        if (r.error) throw new Error(r.error);
        st.textContent = ''; st.className = 'status';
        renderTzMap(r, world);
    } catch (e) { st.className = 'status err'; st.textContent = e.message; }
}

function renderTzMap(r, world) {
    const S = 3, W = 360 * S, H = 180 * S; // equirectangular: 3 pixels per degree
    const X = lon => (lon + 180) * S, Y = lat => (90 - lat) * S;
    const ring = pts => pts.map(([lo, la], i) => `${i ? 'L' : 'M'}${X(lo).toFixed(1)},${Y(la).toFixed(1)}`).join('') + 'Z';
    const path = f => {
        const g = f.geometry; if (!g) return '';
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
        return polys.map(p => p.map(ring).join('')).join('');
    };
    const idOf = f => String(Number(f.id)).padStart(3, '0');
    const nameOf = f => f.properties?.name || `#${f.id}`;
    const count = f => r.countries[idOf(f)] || 0;
    const max = Math.max(1, ...Object.values(r.countries));
    const edges = Array.from({ length: 25 }, (_, i) => X(-180 + i * 15)).map(x => `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#8a93a3" stroke-opacity=".35" stroke-width="1"/>`).join('');
    const labels = Array.from({ length: 25 }, (_, i) => `<text x="${X((i - 12) * 15)}" y="${H - 6}" text-anchor="middle" font-size="12" fill="#8a93a3" font-family="monospace">${i - 12 >= 0 ? '+' : ''}${i - 12}</text>`).join('');
    const paths = world.map(f => {
        const n = count(f), mine = r.me === idOf(f);
        const fill = n ? `rgba(53,217,155,${(0.35 + 0.65 * n / max).toFixed(2)})` : '#39414f';
        return `<path d="${path(f)}" fill="${fill}"${mine ? ' stroke="#fff" stroke-width="1.6"' : ''}><title>${esc(nameOf(f))}${n ? `: ${n} member${n === 1 ? '' : 's'}` : ''}${mine ? ' (you)' : ''}</title></path>`;
    }).join('');
    $('tz-map').innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;min-width:640px;height:auto;display:block;border:1px solid var(--line);border-radius:var(--radius);background:#1b2029;">
        <g stroke="#1b2029" stroke-width=".6">${paths}</g>${edges}${labels}</svg>`;

    // the picker: every country of the map, alphabetical
    const sel = $('tz-country');
    if (!sel.options.length || sel.dataset.filled !== '1') {
        sel.innerHTML = '<option value="">— choose your country —</option>' + [...world].sort((a, b) => nameOf(a).localeCompare(nameOf(b))).map(f => `<option value="${idOf(f)}">${esc(nameOf(f))}</option>`).join('');
        sel.dataset.filled = '1';
    }
    sel.value = r.me || '';
    $('tz-clear').style.display = r.me ? '' : 'none';

    const list = world.filter(f => count(f)).sort((a, b) => count(b) - count(a));
    $('tz-summary').textContent = r.total
        ? `${r.total} member${r.total === 1 ? '' : 's'} on the map, in ${list.length} countr${list.length === 1 ? 'y' : 'ies'}. Your own country has a white outline. The grey numbers at the bottom are the timezone lines (hours from UTC).`
        : 'Nobody is on the map yet — choose your country below to light up the first one!';
    $('tz-list').innerHTML = list.length
        ? list.map(f => `<div style="display:flex;gap:10px;border-top:1px solid var(--line);padding:5px 0;font-size:13px;"><span style="flex:1;">${esc(nameOf(f))}</span><b style="min-width:28px;text-align:right;">${count(f)}</b></div>`).join('')
        : '<p style="color:var(--muted);margin:0;">Nothing yet.</p>';
}

$('tz-save').addEventListener('click', async () => {
    const v = $('tz-country').value;
    if (!v) { toast('Choose your country first.'); return; }
    const r = await tzFetch({ action: 'tz-set', country: v });
    if (r.error) { toast(r.error); return; }
    toast('Saved — your country is on the map');
    loadTzMap();
});
$('tz-clear').addEventListener('click', async () => {
    const r = await tzFetch({ action: 'tz-clear' });
    if (r.error) { toast(r.error); return; }
    toast('Removed from the map');
    loadTzMap();
});
