// tz-map.js — the "Timezone map" page under Faction: a world map with the countries and the timezone lines, where
// the countries members say they live in light up (the more members, the greener). The United States is drawn as
// its states. A member picks their own country (and state) in the dropdowns; everyone only sees anonymous counts.
// A magnifier button gives a lens that enlarges whatever the mouse (or finger) is over.
// Backend: lib/tzMap.js. Map data is in /vendor (world-atlas countries, us-atlas states, topojson-client).
'use strict';

let tzWorld = null;  // countries as GeoJSON features (id = ISO numeric code, properties.name), without the US
let tzStates = null; // the US states as GeoJSON features (id = FIPS code)
let tzLensOn = false;
let tzLensZoom = 5;
let tzLast = null;   // the last data shown, so the magnifier can redraw

async function tzFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}

async function tzLoadWorld() {
    if (tzWorld) return;
    if (typeof topojson === 'undefined') {
        await new Promise((ok, no) => { const s = document.createElement('script'); s.src = '/vendor/topojson-client.min.js'; s.onload = ok; s.onerror = () => no(new Error('Map library did not load')); document.head.appendChild(s); });
    }
    const [topo, us] = await Promise.all([fetch('/vendor/countries-110m.json').then(r => r.json()), fetch('/vendor/us-states-10m.json').then(r => r.json())]);
    tzWorld = topojson.feature(topo, topo.objects.countries).features.filter(f => f.id !== undefined);
    tzStates = topojson.feature(us, us.objects.states).features.filter(f => f.id !== undefined && Number(f.id) <= 56); // the 50 states + DC, no territories
}

async function loadTzMap() {
    const st = $('tz-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    try {
        const [r] = await Promise.all([tzFetch({ action: 'tz-get' }), tzLoadWorld()]);
        if (r.error) throw new Error(r.error);
        st.textContent = ''; st.className = 'status';
        tzLast = r;
        renderTzMap(r);
    } catch (e) { st.className = 'status err'; st.textContent = e.message; }
}

const tzId3 = f => String(Number(f.id)).padStart(3, '0');
const tzName = f => f.properties?.name || `#${f.id}`;

function renderTzMap(r) {
    const S = 3, W = 360 * S, H = 180 * S; // equirectangular: 3 pixels per degree
    const X = lon => (lon + 180) * S, Y = lat => (90 - lat) * S;
    const ring = pts => pts.map(([lo, la], i) => `${i ? 'L' : 'M'}${X(lo).toFixed(1)},${Y(la).toFixed(1)}`).join('') + 'Z';
    const path = f => {
        const g = f.geometry; if (!g) return '';
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
        return polys.map(p => p.map(ring).join('')).join('');
    };
    const cCount = f => r.countries[tzId3(f)] || 0;
    const sCount = f => r.states[String(f.id).padStart(2, '0')] || 0;
    const max = Math.max(1, ...Object.entries(r.countries).filter(([id]) => id !== '840').map(e => e[1]), ...Object.values(r.states));
    const meC = r.me?.country, meS = r.me?.state;
    const fillFor = n => n ? `rgba(53,217,155,${(0.35 + 0.65 * n / max).toFixed(2)})` : '#39414f';
    const shape = (f, n, mine, label) => `<path d="${path(f)}" fill="${fillFor(n)}"${mine ? ' stroke="#fff" stroke-width="1.4"' : ''}><title>${esc(label)}${n ? `: ${n} member${n === 1 ? '' : 's'}` : ''}${mine ? ' (you)' : ''}</title></path>`;
    const edges = Array.from({ length: 25 }, (_, i) => X(-180 + i * 15)).map(x => `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#8a93a3" stroke-opacity=".35" stroke-width="1"/>`).join('');
    const labels = Array.from({ length: 25 }, (_, i) => `<text x="${X((i - 12) * 15)}" y="${H - 6}" text-anchor="middle" font-size="12" fill="#8a93a3" font-family="monospace">${i - 12 >= 0 ? '+' : ''}${i - 12}</text>`).join('');
    const countries = tzWorld.filter(f => tzId3(f) !== '840').map(f => shape(f, cCount(f), meC === tzId3(f), tzName(f))).join('');
    const states = tzStates.map(f => shape(f, sCount(f), meS === String(f.id).padStart(2, '0'), `${tzName(f)}, USA`)).join('');
    const inner = `<g stroke="#1b2029" stroke-width=".6">${countries}</g><g stroke="#1b2029" stroke-width=".4">${states}</g>${edges}${labels}`;
    const svgStyle = 'width:100%;min-width:640px;height:auto;display:block;border:1px solid var(--line);border-radius:var(--radius);background:#1b2029;';
    $('tz-map').innerHTML = `<div id="tz-stage" style="position:relative;"><svg id="tz-svg" viewBox="0 0 ${W} ${H}" style="${svgStyle}${tzLensOn ? 'cursor:crosshair;' : ''}">${inner}</svg>
        <div id="tz-lens" style="display:none;position:absolute;width:200px;height:200px;border-radius:50%;border:3px solid #fff;overflow:hidden;pointer-events:none;box-shadow:0 4px 18px rgba(0,0,0,.6);background:#1b2029;">
            <svg id="tz-lens-svg" viewBox="0 0 ${W} ${H}" style="width:100%;height:100%;display:block;">${inner}</svg></div></div>`;
    tzWireLens(W, H);
    $('tz-lens-btn').classList.toggle('active-toggle', tzLensOn);

    // the pickers: every country of the map (the US first among equals), then the states
    const sel = $('tz-country'), sSel = $('tz-state');
    if (sel.dataset.filled !== '1') {
        const all = [...tzWorld];
        sel.innerHTML = '<option value="">— choose your country —</option>' + all.sort((a, b) => tzName(a).localeCompare(tzName(b))).map(f => `<option value="${tzId3(f)}">${esc(tzName(f))}</option>`).join('');
        sSel.innerHTML = '<option value="">— choose your state —</option>' + [...tzStates].sort((a, b) => tzName(a).localeCompare(tzName(b))).map(f => `<option value="${String(f.id).padStart(2, '0')}">${esc(tzName(f))}</option>`).join('');
        sel.dataset.filled = '1';
    }
    sel.value = meC || ''; sSel.value = meS || '';
    sSel.style.display = sel.value === '840' ? '' : 'none';
    $('tz-clear').style.display = r.me ? '' : 'none';

    const rows = [];
    for (const f of tzWorld) if (tzId3(f) !== '840' && cCount(f)) rows.push([tzName(f), cCount(f), false]);
    if (r.countries['840']) rows.push(['United States', r.countries['840'], false]);
    rows.sort((a, b) => b[1] - a[1]);
    const stateRows = tzStates.filter(sCount).sort((a, b) => sCount(b) - sCount(a));
    $('tz-summary').textContent = r.total
        ? `${r.total} member${r.total === 1 ? '' : 's'} on the map, in ${rows.length} countr${rows.length === 1 ? 'y' : 'ies'}. Your own place has a white outline. The grey numbers at the bottom are the timezone lines (hours from UTC). Tip: press the magnifier to enlarge a spot.`
        : 'Nobody is on the map yet — choose your country below to light up the first one!';
    const line = (n, c, ind) => `<div style="display:flex;gap:10px;border-top:1px solid var(--line);padding:5px 0 5px ${ind ? 18 : 0}px;font-size:13px;${ind ? 'color:var(--muted);' : ''}"><span style="flex:1;">${esc(n)}</span><b style="min-width:28px;text-align:right;">${c}</b></div>`;
    $('tz-list').innerHTML = rows.length
        ? rows.map(([n, c]) => line(n, c, false) + (n === 'United States' ? stateRows.map(f => line(tzName(f), sCount(f), true)).join('') : '')).join('')
        : '<p style="color:var(--muted);margin:0;">Nothing yet.</p>';
}

// The magnifier: a round lens that follows the mouse (or finger) and shows that spot enlarged.
function tzWireLens(W, H) {
    const svg = $('tz-svg'), lens = $('tz-lens'), lsvg = $('tz-lens-svg'), stage = $('tz-stage');
    const move = (cx, cy) => {
        const b = svg.getBoundingClientRect(), sb = stage.getBoundingClientRect();
        const x = (cx - b.left) / b.width * W, y = (cy - b.top) / b.height * H;
        const vw = W / tzLensZoom;
        lsvg.setAttribute('viewBox', `${x - vw / 2} ${y - vw / 2} ${vw} ${vw}`);
        lens.style.left = `${cx - sb.left - 100}px`; lens.style.top = `${cy - sb.top - 100}px`;
        lens.style.display = 'block';
    };
    svg.addEventListener('mousemove', e => { if (tzLensOn) move(e.clientX, e.clientY); });
    svg.addEventListener('mouseleave', () => { lens.style.display = 'none'; });
    svg.addEventListener('touchmove', e => { if (tzLensOn && e.touches[0]) { e.preventDefault(); move(e.touches[0].clientX, e.touches[0].clientY); } }, { passive: false });
    svg.addEventListener('touchend', () => { lens.style.display = 'none'; });
    svg.addEventListener('wheel', e => { // while the magnifier is on, the scroll wheel changes how strong it is
        if (!tzLensOn) return;
        e.preventDefault();
        tzLensZoom = Math.max(2, Math.min(14, tzLensZoom + (e.deltaY < 0 ? 1 : -1)));
        move(e.clientX, e.clientY);
    }, { passive: false });
}

$('tz-lens-btn').addEventListener('click', () => {
    tzLensOn = !tzLensOn;
    $('tz-lens-btn').classList.toggle('active-toggle', tzLensOn);
    const svg = $('tz-svg'); if (svg) svg.style.cursor = tzLensOn ? 'crosshair' : '';
    if (!tzLensOn) { const l = $('tz-lens'); if (l) l.style.display = 'none'; }
});
$('tz-country').addEventListener('change', () => { $('tz-state').style.display = $('tz-country').value === '840' ? '' : 'none'; });
$('tz-save').addEventListener('click', async () => {
    const country = $('tz-country').value, state = $('tz-state').value;
    if (!country) { toast('Choose your country first.'); return; }
    if (country === '840' && !state) { toast('Choose your state too.'); return; }
    const r = await tzFetch({ action: 'tz-set', country, state });
    if (r.error) { toast(r.error); return; }
    toast('Saved — you are on the map');
    loadTzMap();
});
$('tz-clear').addEventListener('click', async () => {
    const r = await tzFetch({ action: 'tz-clear' });
    if (r.error) { toast(r.error); return; }
    toast('Removed from the map');
    loadTzMap();
});
