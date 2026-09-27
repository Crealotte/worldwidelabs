// war-badges-tracker.js — WorldWideLabs War Badges (frontend).
// Per-war "awards ceremony": 8 categories, 1st and 2nd place, for your own faction's own war.
// Open to every member, not leader-gated — badges are read from whichever saved War Payout
// receipt a war maps to (see api/war-payout.js's 'list-receipts'/'get-receipt' actions), never
// recomputed live here. That's deliberate, not just a permissions workaround: a live recompute
// needs a leader-tier API key (Torn restricts /v2/faction/attacks that way), so reading from the
// already-saved receipt is the only way this page can work for a regular member at all — and it
// also means everyone always sees the exact same numbers the leader already finalized, not a
// second, possibly-different live calculation.
'use strict';

let wbReceipts = []; // index entries: { id, opponent, warEnd, hasBadges, createdAt }
let wbSelectedReceipt = null; // full receipt object once picked (see selectWbReceipt)

const WB_BADGES = [
    { key: 'alchemist', icon: '⚗️', name: 'The Alchemist', tagline: 'Most respect gained via war hits',
        desc: 'Turned hits into the most respect through sharp target selection — quality over quantity.',
        stat: m => m.warRespect, unit: 'respect', round: true },
    { key: 'reactor', icon: '⚛️', name: 'The Reactor', tagline: 'Most hits on the enemy faction',
        desc: "The core power output of the war effort — the most direct hits landed on the enemy.",
        stat: m => m.warHits, unit: 'war hits' },
    { key: 'rogue', icon: '🧭', name: 'The Rogue Element', tagline: 'Most hits landed abroad',
        desc: 'Took the fight overseas — the most attacks landed while travelling in another country.',
        stat: m => m.abroadHits, unit: 'hits abroad' },
    { key: 'catalyst', icon: '🔗', name: 'The Catalyst', tagline: 'Most assists',
        desc: "Made other people's hits land — the most assists provided to teammates in battle.",
        stat: m => m.assists, unit: 'assists' },
    { key: 'detonator', icon: '🧨', name: 'The Detonator', tagline: 'Most enemies hospitalized',
        desc: 'Blew the most enemies straight to the hospital.',
        stat: m => m.hospitalized, unit: 'enemies hospitalized' },
    { key: 'volatile', icon: '💥', name: 'The Volatile Compound', tagline: 'Big damage dealt, big damage taken',
        desc: 'High-risk, high-reward: landed a lot of war hits while also getting hospitalized a lot themselves.',
        stat: m => m.warHits * m.timesDowned, needsBoth: ['warHits', 'timesDowned'],
        display: m => `${m.warHits} war hits, ${m.timesDowned}× hospitalized` },
    { key: 'buffer', icon: '🛡️', name: 'The Buffer', tagline: 'Most incoming hits survived',
        desc: 'Absorbed the hits and held the line — took the most incoming attacks without going down.',
        stat: m => m.survivedHits, unit: 'hits survived' },
    { key: 'reagent', icon: '💎', name: 'The Reagent', tagline: 'Highest war payout',
        desc: "The most valuable contributor, dollar for dollar — this war's biggest payout.", special: 'payout' },
];

// Posts to /api/war-payout, not a dedicated /api/war-badges — merged in to stay under Vercel
// Hobby's 12-Serverless-Function-per-deployment limit.
async function wbFetch(body) {
    const res = await fetch('/api/war-payout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: apiKey, ...body }),
    });
    return res.json();
}

function wbFmtDate(ts) {
    return new Date(ts * 1000).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function wbReceiptLink(id) {
    return `${window.location.origin}${window.location.pathname}?receipt=${id}`;
}

async function loadWarBadges() {
    if (wbReceipts.length) return; // already loaded this session
    const st = $('wb-war-status');
    st.className = 'status ok'; st.textContent = 'Loading past war receipts…';
    try {
        const result = await wbFetch({ action: 'list-receipts' });
        if (result.error) throw new Error(result.error);
        wbReceipts = result.receipts || [];
        renderWbWarList();
        st.textContent = ''; st.className = 'status';
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    }
}

function renderWbWarList() {
    const el = $('wb-war-list');
    if (!wbReceipts.length) {
        el.innerHTML = '<p style="color:var(--muted);font-size:13px;">No saved War Payout receipts yet — badges show up here as soon as a leader saves one (War Payout → "Save & get shareable receipt link").</p>';
        return;
    }
    el.innerHTML = `
        <div class="ocfit-scenario" data-collapse="wb-wars">
            <div class="ocfit-scenario-header">
                <span>Past wars (${wbReceipts.length})</span>
                <span class="chev">▾</span>
            </div>
            <div class="ocfit-scenario-body">${wbReceipts.map((r, i) => `
                <div class="ocfit-role-row" data-war-idx="${i}" style="cursor:pointer;">
                    <span class="ocfit-role-name">${esc(r.opponent || 'Unknown opponent')}</span>
                    <span style="font-size:12px;color:var(--muted);">${esc(wbFmtDate(r.warEnd))}</span>
                    <a href="${esc(wbReceiptLink(r.id))}" target="_blank" rel="noopener" style="font-size:12px;" onclick="event.stopPropagation();">Full receipt →</a>
                </div>`).join('')}
            </div>
        </div>`;
    el.querySelector('.ocfit-scenario-header').addEventListener('click', () => {
        el.querySelector('.ocfit-scenario').classList.toggle('collapsed');
    });
    el.querySelectorAll('[data-war-idx]').forEach(row => {
        row.addEventListener('click', () => selectWbReceipt(Number(row.dataset.warIdx)));
    });
}

async function selectWbReceipt(idx) {
    const entry = wbReceipts[idx];
    $('wb-war-list').querySelectorAll('[data-war-idx]').forEach((row, i) => {
        row.style.background = i === idx ? 'var(--bench-2)' : '';
    });
    $('wb-grid-panel').style.display = 'block';
    $('wb-detail-panel').style.display = 'none';
    wbSelectedReceipt = null;
    renderWbGrid(); // clear out any previous war's results immediately, don't leave stale badges showing

    const st = $('wb-status');
    st.className = 'status ok'; st.textContent = `Loading receipt vs ${entry.opponent || 'unknown'}…`;
    try {
        const result = await wbFetch({ action: 'get-receipt', id: entry.id });
        if (result.error) throw new Error(result.error);
        wbSelectedReceipt = result.receipt;
        st.className = wbSelectedReceipt.badgeStats ? 'status ok' : 'status err';
        st.textContent = wbSelectedReceipt.badgeStats
            ? '' : "This receipt was saved before War Badges existed, so most categories won't have data — The Reagent (payout) still will.";
        renderWbGrid();
        const probePanel = $('wb-probe-panel');
        if (probePanel) {
            probePanel.style.display = (typeof isLeaderCached !== 'undefined' && isLeaderCached && wbSelectedReceipt.warStart && wbSelectedReceipt.warEnd) ? 'block' : 'none';
            probePanel.open = false;
            $('wb-probe-out').style.display = 'none';
        }
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    }
}

$('wb-probe-btn')?.addEventListener('click', async () => {
    if (!wbSelectedReceipt?.warStart || !wbSelectedReceipt?.warEnd) return;
    const btn = $('wb-probe-btn'); btn.disabled = true; btn.textContent = 'Checking…';
    try {
        const r = await wbFetch({ action: 'badge-probe', warStart: wbSelectedReceipt.warStart, warEnd: wbSelectedReceipt.warEnd });
        if (r.error) throw new Error(r.error);
        const out = $('wb-probe-out');
        out.textContent = `Scanned ${r.scanned} attack(s) over ${r.pages} page(s) of the war.\n\n`
            + `Result values on OUR outgoing hits: ${JSON.stringify(r.resultCounts.outgoing, null, 2)}\n\n`
            + `Result values on hits WE took: ${JSON.stringify(r.resultCounts.incoming, null, 2)}\n\n`
            + `"overseas" modifier values seen: ${JSON.stringify(r.overseasValues, null, 2)}\n\n`
            + `A plain outgoing hit: ${JSON.stringify(r.outgoingExample, null, 2)}\n\n`
            + (r.hospitalLikeExample ? `A hospital/mug/assist-looking one: ${JSON.stringify(r.hospitalLikeExample, null, 2)}` : 'No result value containing "hospital", "mug" or "assist" was found anywhere in this war.');
        out.style.display = 'block';
    } catch (e) { toast(e.message); } finally { btn.disabled = false; btn.textContent = 'Check what Torn sends for this war'; }
});

// Pure ranking function, given a plain array of per-member stat objects.
function wbRankByStat(members, badge) {
    const withValue = members
        .map(m => ({ m, value: badge.stat(m) }))
        .filter(({ m, value }) => value > 0 && (!badge.needsBoth || badge.needsBoth.every(f => m[f] > 0)));
    withValue.sort((a, b) => b.value - a.value);
    return withValue.slice(0, 2);
}

// Badges off a saved receipt's data — used both by this page (wbSelectedReceipt) and the compact
// read-only display on the shared receipt page / dashboard widget (see renderReceiptBadgesHtml).
// Returns undefined (not an empty array) specifically when there's no badgeStats to rank at all
// (an older receipt saved before this feature existed), so callers can tell "nothing qualified"
// apart from "no data to even check".
function wbTopTwoForReceipt(receipt, badge) {
    if (!receipt) return undefined;
    if (badge.special === 'payout') {
        const rows = (receipt.rows || []).filter(r => r.net > 0);
        return rows.slice(0, 2).map(r => ({ m: { id: r.id, name: r.name }, value: r.net }));
    }
    if (!receipt.badgeStats) return undefined;
    return wbRankByStat(receipt.badgeStats, badge);
}

function wbTopTwo(badge) {
    return wbTopTwoForReceipt(wbSelectedReceipt, badge);
}

function wbFormatValue(badge, value, m) {
    if (badge.display) return badge.display(m);
    if (badge.special === 'payout') return `$${Math.round(value).toLocaleString()}`;
    if (badge.round) return `${Math.round(value).toLocaleString()} ${badge.unit}`;
    return `${value.toLocaleString()} ${badge.unit}`;
}

// Dashboard widget, visible to every logged-in member — shows the latest saved war's badge
// winners. Backed by 'get-latest-badges', which reads whatever the most recently saved payout
// receipt for this faction baked in; nothing to compute here.
async function loadDashboardWarBadges() {
    try {
        const result = await wbFetch({ action: 'get-latest-badges' });
        if (result.error || !result.receipt) { $('dash-war-badges-panel').style.display = 'none'; return; }
        const html = renderReceiptBadgesHtml(result.receipt);
        if (!html) { $('dash-war-badges-panel').style.display = 'none'; return; }
        $('dash-war-badges-title').textContent = `🏆 War Badges — vs ${result.receipt.opponent || 'last war'}`;
        $('dash-war-badges-body').innerHTML = html;
        $('dash-war-badges-panel').style.display = 'block';
    } catch (e) { $('dash-war-badges-panel').style.display = 'none'; }
}

// Compact, read-only badges grid — reused by the shared payout receipt (war-payout-tracker.js's
// loadPayoutReceipt) and the dashboard widget above. No click-to-drill-down needed on a static
// display, just the 🥇 per category. Returns '' (no wrapper markup) if nothing qualified, so
// callers can hide their own panel/heading entirely rather than show an empty box.
function renderReceiptBadgesHtml(receipt) {
    const cards = WB_BADGES.map(badge => {
        const top = wbTopTwoForReceipt(receipt, badge);
        if (!top || !top.length) return null;
        const winner = top[0];
        return `
            <div class="crimes-tile" style="cursor:default;">
                <div class="crimes-tile-icon">${badge.icon}</div>
                <div class="crimes-tile-name">${badge.name}</div>
                <div class="crimes-tile-status">🥇 ${esc(winner.m.name)} — ${esc(wbFormatValue(badge, winner.value, winner.m))}</div>
            </div>`;
    }).filter(Boolean);
    if (!cards.length) return '';
    return `<div class="crimes-grid">${cards.join('')}</div>`;
}

function renderWbGrid() {
    const el = $('wb-badge-grid');
    el.innerHTML = WB_BADGES.map(badge => {
        if (!wbSelectedReceipt) {
            return `
                <div class="crimes-tile crimes-tile-pending" data-badge="${badge.key}">
                    <div class="crimes-tile-icon">${badge.icon}</div>
                    <div class="crimes-tile-name">${badge.name}</div>
                    <div class="crimes-tile-status">…</div>
                </div>`;
        }
        const top = wbTopTwo(badge);
        const leader = top === undefined ? 'No data on this receipt' : (top.length ? `🥇 ${esc(top[0].m.name)}` : 'No qualifying hits');
        return `
            <div class="crimes-tile${top?.length ? '' : ' crimes-tile-pending'}" data-badge="${badge.key}">
                <div class="crimes-tile-icon">${badge.icon}</div>
                <div class="crimes-tile-name">${badge.name}</div>
                <div class="crimes-tile-status">${leader}</div>
            </div>`;
    }).join('');
    if (!wbSelectedReceipt) return; // nothing to drill into yet
    el.querySelectorAll('[data-badge]').forEach(tile => {
        tile.addEventListener('click', () => renderWbDetail(tile.dataset.badge));
    });
}

function renderWbDetail(key) {
    const badge = WB_BADGES.find(b => b.key === key);
    if (!wbSelectedReceipt) return;
    const top = wbTopTwo(badge);
    $('wb-detail-panel').style.display = 'block';
    $('wb-detail-title').textContent = `${badge.icon} ${badge.name}`;
    $('wb-detail-desc').textContent = badge.desc;

    const body = $('wb-detail-body');
    if (top === undefined) {
        body.innerHTML = `<p style="color:var(--muted);font-size:13px;">This receipt doesn't have the data for this badge (saved before War Badges existed).</p>`;
        return;
    }
    if (!top.length) {
        body.innerHTML = `<p style="color:var(--muted);font-size:13px;">No one qualified for this badge in this war.</p>`;
        return;
    }
    const medals = ['🥇', '🥈'];
    body.innerHTML = top.map(({ m, value }, i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;${i ? 'border-top:1px solid var(--line);' : ''}">
            <span style="font-size:20px;">${medals[i]}</span>
            <span style="flex:1;font-weight:${i === 0 ? '700' : '500'};">${esc(m.name)}</span>
            <span style="font-family:var(--mono);color:${i === 0 ? 'var(--reagent)' : 'var(--muted)'};">${wbFormatValue(badge, value, m)}</span>
        </div>`).join('');
}
