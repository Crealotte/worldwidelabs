// tz-map.js — the "Timezone map" page under Faction: a world map with the countries, one vertical stripe per UTC
// hour (the timezone lines), coloured by how many members live in that timezone — a heatmap of where the faction
// plays from, just for fun. Each member's browser reports its timezone (tzReport, once a day at most); the page only
// shows anonymous counts. Backend: lib/tzMap.js. The map data is in /vendor (world-atlas countries + topojson-client).
'use strict';

let tzWorld = null; // the countries as GeoJSON features

async function tzReport() {
    try {
        const today = new Date().toISOString().slice(0, 10);
        if (localStorage.getItem('wwl_tz_reported') === today) return;
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (!zone) return;
        const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, action: 'tz-report', zone, offset: -new Date().getTimezoneOffset() }) });
        const r = await res.json();
        if (!r.error) localStorage.setItem('wwl_tz_reported', today);
    } catch (e) { /* not important */ }
}

async function tzLoadWorld() {
    if (tzWorld) return tzWorld;
    if (typeof topojson === 'undefined') {
        await new Promise((ok, no) => { const s = document.createElement('script'); s.src = '/vendor/topojson-client.min.js'; s.onload = ok; s.onerror = () => no(new Error('Map library did not load')); document.head.appendChild(s); });
    }
    const topo = await (await fetch('/vendor/countries-110m.json')).json();
    tzWorld = topojson.feature(topo, topo.objects.countries).features;
    return tzWorld;
}

async function loadTzMap() {
    const st = $('tz-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    try {
        await tzReport(); // so you are counted even if you open this page first
        const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, action: 'tz-get' }) });
        const text = await res.text();
        let r; try { r = JSON.parse(text); } catch (e) { throw new Error(`Server problem (${res.status})`); }
        if (r.error) throw new Error(r.error);
        const world = await tzLoadWorld();
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
    const bands = Object.entries(r.bands).map(([h, n]) => ({ h: Number(h), n }));
    const max = Math.max(1, ...bands.map(b => b.n));
    const stripes = bands.map(b => {
        const x0 = Math.max(0, X(b.h * 15 - 7.5)), x1 = Math.min(W, X(b.h * 15 + 7.5));
        const a = (0.18 + 0.62 * b.n / max).toFixed(2);
        const mine = r.me === b.h;
        return `<rect x="${x0}" y="0" width="${x1 - x0}" height="${H}" fill="rgba(53,217,155,${a})"${mine ? ' stroke="#fff" stroke-width="2" stroke-dasharray="6 4"' : ''}><title>UTC${b.h >= 0 ? '+' : ''}${b.h}: ${b.n} member${b.n === 1 ? '' : 's'}${mine ? ' (you)' : ''}</title></rect>`;
    }).join('');
    const edges = Array.from({ length: 24 }, (_, i) => X(-172.5 + i * 15)).map(x => `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#8a93a3" stroke-opacity=".45" stroke-width="1"/>`).join('');
    const labels = Array.from({ length: 25 }, (_, i) => {
        const h = i - 12, n = r.bands[h] || 0;
        return `<text x="${X(h * 15)}" y="${H - 6}" text-anchor="middle" font-size="13" fill="#c9d1dc" font-family="monospace">${h >= 0 ? '+' : ''}${h}</text>${n ? `<text x="${X(h * 15)}" y="22" text-anchor="middle" font-size="18" font-weight="700" fill="#fff">${n}</text>` : ''}`;
    }).join('');
    $('tz-map').innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;min-width:640px;height:auto;display:block;border:1px solid var(--line);border-radius:var(--radius);background:#1b2029;">
        <g fill="#39414f" stroke="#1b2029" stroke-width=".6">${world.map(f => `<path d="${path(f)}"/>`).join('')}</g>
        ${stripes}${edges}${labels}</svg>`;

    const list = Object.entries(r.zones).sort((a, b) => b[1].count - a[1].count);
    const utc = m => `UTC${m >= 0 ? '+' : '−'}${Math.floor(Math.abs(m) / 60)}${Math.abs(m) % 60 ? `:${String(Math.abs(m) % 60).padStart(2, '0')}` : ''}`;
    $('tz-summary').textContent = r.total
        ? `${r.total} member${r.total === 1 ? '' : 's'} counted so far, in ${list.length} timezone${list.length === 1 ? '' : 's'}. Your own stripe has a dashed outline. Members are counted when they open WWL, so the map fills up over the next days.`
        : 'Nobody is counted yet — the map fills up as members open WWL.';
    $('tz-list').innerHTML = list.length
        ? list.map(([z, v]) => `<div style="display:flex;gap:10px;border-top:1px solid var(--line);padding:5px 0;font-size:13px;"><span style="flex:1;">${esc(z)}</span><span style="color:var(--muted);font-family:var(--mono);">${utc(v.offset)}</span><b style="min-width:28px;text-align:right;">${v.count}</b></div>`).join('')
        : '<p style="color:var(--muted);margin:0;">Nothing yet.</p>';
}
