// war-badges-tracker.js — WorldWideLabs War Badges (frontend).
// Per-war "awards ceremony": 8 categories, 1st and 2nd place, for your own faction's own war.
// The backend (api/war-badges.js) hands over raw per-member counts; ranking/labeling for each
// badge happens here — same split of responsibility as war-payout-tracker.js's wpCompute.
'use strict';

let wbWars = [];
let wbSelectedWar = null;
let wbMembers = null; // raw per-member stats from the backend, or null before calculating
let wbMeta = null;

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

async function wbFetch(body) {
    const res = await fetch('/api/war-badges', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: apiKey, ...body }),
    });
    return res.json();
}

function wbFmtDate(ts) {
    return new Date(ts * 1000).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

async function loadWarBadges() {
    $('wb-locked').style.display = isLeaderCached ? 'none' : 'block';
    $('wb-editor').style.display = isLeaderCached ? 'block' : 'none';
    if (!isLeaderCached) return;
    if (wbWars.length) return; // already loaded this session

    const st = $('wb-war-status');
    st.className = 'status ok'; st.textContent = 'Loading past wars…';
    try {
        const result = await wbFetch({ action: 'list-wars' });
        if (result.error) throw new Error(result.error);
        wbWars = result.wars || [];
        renderWbWarList();
        st.textContent = ''; st.className = 'status';
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    }
}

function renderWbWarList() {
    const el = $('wb-war-list');
    if (!wbWars.length) {
        el.innerHTML = '<p style="color:var(--muted);font-size:13px;">No past wars found on this key.</p>';
        return;
    }
    el.innerHTML = `
        <div class="ocfit-scenario collapsed" data-collapse="wb-wars">
            <div class="ocfit-scenario-header">
                <span>Past wars (${wbWars.length})</span>
                <span class="chev">▾</span>
            </div>
            <div class="ocfit-scenario-body">${wbWars.map((w, i) => `
                <div class="ocfit-role-row" data-war-idx="${i}" style="cursor:pointer;">
                    <span class="ocfit-role-name">${esc(w.them?.name || 'Unknown opponent')}</span>
                    <span style="font-size:12px;color:var(--muted);">${esc(wbFmtDate(w.end))}</span>
                    <span style="font-size:12px;color:${String(w.winner) === String(w.us?.id) ? 'var(--reagent)' : 'var(--danger)'};">${String(w.winner) === String(w.us?.id) ? 'Won' : 'Lost'}</span>
                </div>`).join('')}
            </div>
        </div>`;
    el.querySelector('.ocfit-scenario-header').addEventListener('click', () => {
        el.querySelector('.ocfit-scenario').classList.toggle('collapsed');
    });
    el.querySelectorAll('[data-war-idx]').forEach(row => {
        row.addEventListener('click', () => selectWbWar(Number(row.dataset.warIdx)));
    });
}

async function selectWbWar(idx) {
    wbSelectedWar = wbWars[idx];
    $('wb-war-list').querySelectorAll('[data-war-idx]').forEach((row, i) => {
        row.style.background = i === idx ? 'var(--bench-2)' : '';
    });
    $('wb-grid-panel').style.display = 'block';
    $('wb-detail-panel').style.display = 'none';
    wbMembers = null;
    renderWbGrid(); // clear out any previous war's results immediately, don't leave stale badges showing

    if (!wbSelectedWar.them?.id) {
        $('wb-status').className = 'status err';
        $('wb-status').textContent = "Couldn't identify the enemy faction for this war.";
        return;
    }

    const st = $('wb-status');
    st.className = 'status ok'; st.textContent = `Fetching war data vs ${wbSelectedWar.them?.name || 'unknown'}…`;
    try {
        const result = await wbFetch({
            action: 'calculate', warStart: wbSelectedWar.start, warEnd: wbSelectedWar.end,
            enemyFactionId: wbSelectedWar.them.id,
        });
        if (result.error) throw new Error(result.error);
        wbMembers = result.members;
        wbMeta = result.meta;
        if (wbMeta?.scanned > 0 && wbMeta?.matched === 0) {
            st.className = 'status err';
            st.textContent = `Scanned ${wbMeta.scanned} attack(s) but none matched as war hits — The Reactor, The Alchemist and The Volatile Compound may show nothing for this war.`;
        } else {
            st.className = 'status ok';
            st.textContent = `${wbMembers.length} hitter(s) found.`;
        }
        renderWbGrid();
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    }
}

// Pure ranking, reused by both the live War Badges page (below) and the shared payout receipt
// viewer (war-payout-tracker.js's loadPayoutReceipt), which has its own static badgeStats array
// baked into the receipt at save time rather than wbMembers from a live fetch.
function wbRankByStat(members, badge) {
    const withValue = members
        .map(m => ({ m, value: badge.stat(m) }))
        .filter(({ m, value }) => value > 0 && (!badge.needsBoth || badge.needsBoth.every(f => m[f] > 0)));
    withValue.sort((a, b) => b.value - a.value);
    return withValue.slice(0, 2);
}

function wbTopTwo(badge) {
    if (badge.special === 'payout') return wbPayoutTopTwo();
    return wbRankByStat(wbMembers, badge);
}

// Cross-tool integration: if the leader has already calculated a payout for this exact war in
// the War Payout Calculator this session (wpSelectedWar / wpCompute — both globals from
// war-payout-tracker.js), use those real $ numbers. Otherwise this badge stays locked rather
// than showing a made-up proxy number — a fake "highest payout" would be misleading.
function wbPayoutTopTwo() {
    if (typeof wpCompute !== 'function' || !wpSelectedWar || !wpCalcResult) return null;
    if (String(wpSelectedWar.id) !== String(wbSelectedWar.id)) return null;
    const rows = wpCompute().rows.filter(r => r.net > 0);
    return rows.slice(0, 2).map(r => ({ m: { id: r.id, name: r.name }, value: r.net }));
}

// Badges on a saved/shared payout receipt: same 8 categories, but off the static badgeStats
// array baked into the receipt at save time (see war-payout-tracker.js's wp-save-receipt
// handler) instead of a live fetch — the receipt page has no API key and isn't leader-gated.
function wbTopTwoForReceipt(receipt, badge) {
    if (badge.special === 'payout') {
        const rows = (receipt.rows || []).filter(r => r.net > 0);
        return rows.slice(0, 2).map(r => ({ m: { id: r.id, name: r.name }, value: r.net }));
    }
    if (!receipt.badgeStats) return undefined; // older receipt, saved before badges existed
    return wbRankByStat(receipt.badgeStats, badge);
}

function wbFormatValue(badge, value, m) {
    if (badge.display) return badge.display(m);
    if (badge.special === 'payout') return `$${Math.round(value).toLocaleString()}`;
    if (badge.round) return `${Math.round(value).toLocaleString()} ${badge.unit}`;
    return `${value.toLocaleString()} ${badge.unit}`;
}

// Dashboard widget, visible to every logged-in member (not leader-gated) — shows the latest
// saved war's badge winners. Backed by api/war-payout.js's get-latest-badges action (receipts —
// and the "latest one" pointer — live in that file's Redis storage, not here), which reads
// whatever the most recently saved payout receipt for this faction baked in; nothing to compute
// here, no API key privilege needed beyond being a faction member. Note: wpFetch, not wbFetch —
// this hits /api/war-payout, where the receipt storage actually lives.
async function loadDashboardWarBadges() {
    try {
        const result = await wpFetch({ action: 'get-latest-badges' });
        if (result.error || !result.receipt) { $('dash-war-badges-panel').style.display = 'none'; return; }
        const html = renderReceiptBadgesHtml(result.receipt);
        if (!html) { $('dash-war-badges-panel').style.display = 'none'; return; }
        $('dash-war-badges-title').textContent = `🏆 War Badges — vs ${result.receipt.opponent || 'last war'}`;
        $('dash-war-badges-body').innerHTML = html;
        $('dash-war-badges-panel').style.display = 'block';
    } catch (e) { $('dash-war-badges-panel').style.display = 'none'; }
}

// Compact, read-only badges grid — reused by the shared payout receipt (war-payout-tracker.js's
// loadPayoutReceipt) and the dashboard widget below. No click-to-drill-down needed on a static
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
        if (!wbMembers) {
            return `
                <div class="crimes-tile crimes-tile-pending" data-badge="${badge.key}">
                    <div class="crimes-tile-icon">${badge.icon}</div>
                    <div class="crimes-tile-name">${badge.name}</div>
                    <div class="crimes-tile-status">…</div>
                </div>`;
        }
        const top = wbTopTwo(badge);
        const leader = top === null ? '🔒 Run War Payout for this war' : (top.length ? `🥇 ${esc(top[0].m.name)}` : 'No qualifying hits');
        return `
            <div class="crimes-tile${top?.length ? '' : ' crimes-tile-pending'}" data-badge="${badge.key}">
                <div class="crimes-tile-icon">${badge.icon}</div>
                <div class="crimes-tile-name">${badge.name}</div>
                <div class="crimes-tile-status">${leader}</div>
            </div>`;
    }).join('');
    if (!wbMembers) return; // nothing to drill into yet
    el.querySelectorAll('[data-badge]').forEach(tile => {
        tile.addEventListener('click', () => renderWbDetail(tile.dataset.badge));
    });
}

function renderWbDetail(key) {
    const badge = WB_BADGES.find(b => b.key === key);
    if (!wbMembers) return;
    const top = wbTopTwo(badge);
    $('wb-detail-panel').style.display = 'block';
    $('wb-detail-title').textContent = `${badge.icon} ${badge.name}`;
    $('wb-detail-desc').textContent = badge.desc;

    const body = $('wb-detail-body');
    if (top === null) {
        body.innerHTML = `<p style="color:var(--muted);font-size:13px;">Calculate this war in the <b>War Payout</b> tool first — this badge shows the real $ leaders once that's done.</p>`;
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
