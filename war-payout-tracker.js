// war-payout-tracker.js — WorldWideLabs War Payout Calculator (frontend).
'use strict';

let warPayoutLoaded = false;
let wpWars = [];
let wpSelectedWar = null; // optional — just for opponent name context on the receipt
let wpChains = []; // { id, totalHits } — the chains the register assigns to the picked war / chain event
const WP_LIST_LIMIT = 10; // the dropdown shows the latest 10 wars (and 10 chain events); "Show older" lists the rest
let wpShowAll = false, wpListOpen = false;
let wpEvents = []; // chain events from the register: { id, name, start, end }
let wpLinks = {}; // register: war or event id -> [chain ids]
let wpCalcResult = null; // { members: [...] }
let wpPenalties = {}; // memberId -> amount
let wpPaidIds = new Set(); // memberId -> marked as paid this session
let receiptSort = { key: null, dir: 'desc' }; // the shareable receipt viewer's own member-breakdown table
let wpCosts = []; // { label, amount }

async function wpFetch(body) {
    const res = await fetch('/api/war-payout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: apiKey, ...body }),
    });
    return res.json();
}

function wpFmtDate(ts) {
    return new Date(ts * 1000).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

// Same parsing the existing Chain Payout tool uses — accepts a raw chain ID or a pasted
// chain report URL (…&chainID=12345…) and pulls the number out either way.
function wpParseChainID(input) {
    input = input.trim();
    const m = input.match(/chainID=(\d+)/i);
    if (m) return m[1];
    if (/^\d+$/.test(input)) return input;
    return null;
}

async function loadWarPayout() {
    // Leader/Co-leader only end to end — real money moves through the "Pay" button (see AUDIT.md).
    $('wp-locked').style.display = canEditLeaderOnly ? 'none' : 'block';
    $('wp-editor').style.display = canEditLeaderOnly ? 'block' : 'none';
    if (!canEditLeaderOnly) return;

    const st = $('wp-war-status');
    st.className = 'status ok'; st.textContent = 'Loading past wars…';
    try {
        const result = await wpFetch({ action: 'list-wars' });
        if (result.error) throw new Error(result.error);
        wpWars = result.wars || [];
        wpEvents = result.events || [];
        wpLinks = result.links || {};
        renderWarList();
        st.textContent = ''; st.className = 'status';
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    }
}

function renderWarList() {
    const el = $('wp-war-list');
    if (!wpWars.length && !wpEvents.length) {
        el.innerHTML = '<p style="color:var(--muted);font-size:13px;">No past wars found on this key.</p>';
        return;
    }
    const lim = wpShowAll ? Infinity : WP_LIST_LIMIT;
    const hidden = Math.max(0, wpWars.length - lim) + Math.max(0, wpEvents.length - lim);
    el.innerHTML = `
        <div class="ocfit-scenario${wpListOpen ? "" : " collapsed"}" data-collapse="wp-wars">
            <div class="ocfit-scenario-header">
                <span>Past wars (${wpWars.length})${wpEvents.length ? ` and chain events (${wpEvents.length})` : ''}</span>
                <span class="chev">▾</span>
            </div>
            <div class="ocfit-scenario-body">${wpWars.map((w, i) => i >= lim ? '' : `
                <div class="ocfit-role-row" data-war-idx="${i}" style="cursor:pointer;">
                    <span class="ocfit-role-name">${esc(w.them?.name || 'Unknown opponent')}</span>
                    <span style="font-size:12px;color:var(--muted);">${esc(wpFmtDate(w.end))}</span>
                    <span style="font-size:12px;color:${String(w.winner) === String(w.us?.id) ? 'var(--reagent)' : 'var(--danger)'};">${String(w.winner) === String(w.us?.id) ? 'Won' : 'Lost'}</span>
                    <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--muted);cursor:pointer;" title="Have you restocked the armory for this war yet?">
                        <input type="checkbox" data-restock-idx="${i}" ${w.restocked ? 'checked' : ''} style="width:auto;"> Restocked
                    </label>
                </div>`).join('')}
                ${wpEvents.slice().sort((a, b) => b.end - a.end).slice(0, lim).map(e => `
                <div class="ocfit-role-row" data-event-id="${esc(e.id)}" style="cursor:pointer;">
                    <span class="ocfit-role-name">⛓ ${esc(e.name)}</span>
                    <span style="font-size:12px;color:var(--muted);">${esc(wpFmtDate(e.end))}</span>
                    <span style="font-size:12px;color:var(--muted);">chain event · ${(wpLinks[e.id] || []).length} chain${(wpLinks[e.id] || []).length === 1 ? '' : 's'}</span>
                </div>`).join('')}
                ${hidden ? `<div style="padding:8px 0;"><button class="ghost small" id="wp-show-all">Show older (${hidden} more)</button></div>` : ''}
            </div>
        </div>`;
    el.querySelector('.ocfit-scenario-header').addEventListener('click', () => {
        wpListOpen = !el.querySelector('.ocfit-scenario').classList.toggle('collapsed');
    });
    $('wp-show-all')?.addEventListener('click', () => { wpShowAll = true; renderWarList(); });
    el.querySelectorAll('[data-war-idx]').forEach(row => {
        row.addEventListener('click', () => selectWar(Number(row.dataset.warIdx)));
    });
    el.querySelectorAll('[data-event-id]').forEach(row => {
        row.addEventListener('click', () => selectEvent(row.dataset.eventId));
    });
    el.querySelectorAll('[data-restock-idx]').forEach(cb => {
        cb.addEventListener('click', e => e.stopPropagation()); // don't also trigger selectWar on the row
        cb.addEventListener('change', () => toggleWarRestocked(Number(cb.dataset.restockIdx), cb.checked));
    });
}

// Plain manual marker, not tied to the Consumption Tracker's own consumption/shopping numbers at
// all — just a checkbox so a leader who sometimes skips restocking for a war or two can see at a
// glance which past wars still need it, instead of having to remember or dig through history.
async function toggleWarRestocked(idx, restocked) {
    const w = wpWars[idx];
    w.restocked = restocked; // optimistic — reflect it immediately, no need to wait on the round-trip
    try {
        const result = await wpFetch({ action: 'set-restocked', warId: w.id, restocked });
        if (result.error) throw new Error(result.error);
    } catch (e) {
        w.restocked = !restocked; // failed — revert and let the leader know
        renderWarList();
        toast(`Couldn't save that: ${e.message}`);
    }
}

function highlightPicked(key) {
    $('wp-war-list').querySelectorAll('[data-war-idx], [data-event-id]').forEach(row => {
        row.style.background = (row.dataset.warIdx !== undefined ? 'w' + row.dataset.warIdx : 'e' + row.dataset.eventId) === key ? 'var(--bench-2)' : '';
    });
}

// The chains come from the War & chain register (Member Overview), where each chain is assigned to exactly one
// war or chain event — so picking one here can never pay a chain twice, and there is nothing to type in.
function showPickedChains(label) {
    wpChains = (wpLinks[wpSelectedWar.id] || []).map(id => ({ id: String(id), totalHits: null }));
    $('wp-chains-panel').style.display = 'block';
    $('wp-chains-note').textContent = wpChains.length
        ? `${label} — these chains are assigned to it in the War & chain register (Member Overview), so each chain is only counted once.`
        : `${label} — no chains are assigned to it yet. War hits are still counted. If hitters chained too, assign the chain(s) to it in Member Overview → War & chain register, then reload this page.`;
    renderChainChips();
    $('wp-calc-status').textContent = ''; $('wp-calc-status').className = 'status';
}

function selectWar(idx) {
    wpSelectedWar = wpWars[idx];
    highlightPicked('w' + idx);
    showPickedChains(`vs ${wpSelectedWar.them?.name || 'unknown'}`);
    if (typeof wpArmoryDefaultDates === 'function') wpArmoryDefaultDates(); // armory-tracker.js — prefill the armory-costs date range for this war
}

// A chain event (a chain done instead of a war) has no war hits, only its assigned chains.
function selectEvent(id) {
    const e = wpEvents.find(x => x.id === id);
    if (!e) return;
    wpSelectedWar = { id: e.id, start: e.start, end: e.end, event: true, us: null, them: { name: e.name, id: null }, winner: null };
    highlightPicked('e' + id);
    showPickedChains(`Chain event: ${e.name}`);
    // No war, usually no pool either: chain hits at the flat rate is what fits (the total to pay is shown under "4.")
    if (!$('wp-mode-split').checked) { $('wp-mode-split').checked = true; $('wp-mode-split').dispatchEvent(new Event('change')); }
}

function renderChainChips() {
    const el = $('wp-chain-list');
    el.innerHTML = wpChains.map(c => `
        <div class="chip">
            <span class="cid">#${esc(c.id)}</span>
            <span class="meta">${c.totalHits != null ? `${c.totalHits} hits` : 'not loaded yet'}</span>
        </div>`).join('');
}

$('wp-calculate').addEventListener('click', async () => {
    if (!wpSelectedWar) {
        $('wp-calc-status').className = 'status err';
        $('wp-calc-status').textContent = 'Pick a war or chain event above first.';
        return;
    }
    const btn = $('wp-calculate');
    const st = $('wp-calc-status');
    btn.disabled = true; btn.textContent = 'Fetching war + chain data…';
    try {
        const result = await wpFetch({
            action: 'calculate',
            warStart: wpSelectedWar.start, warEnd: wpSelectedWar.end,
            itemId: wpSelectedWar.id,
        });
        if (result.error) throw new Error(result.error);
        wpCalcResult = result;
        wpPenalties = {};
        wpPaidIds = new Set();
        if (result.chains) {
            for (const c of result.chains) {
                const match = wpChains.find(x => x.id === c.id);
                if (match) match.totalHits = c.totalHits;
            }
            renderChainChips();
        }
        const meta = result.warHitsMeta;
        if (meta?.brokenWithNoChains) {
            st.className = 'status err';
            st.textContent = `Scanned ${meta.scanned} attack(s) in the war window but none matched as war hits, and no chains are assigned to this war in the register to fall back on — assign the chain(s) that ran during this war in Member Overview → War & chain register, or flag this to WWL before paying out.`;
        } else if (meta?.usedFallback) {
            st.className = 'status err';
            st.textContent = `Couldn't confirm war hits directly from Torn, so war hits below are from the chain report(s) added instead — same as the old calculator, this only counts hits inside an added chain. Make sure every chain that ran during the war is assigned to it in the register, and flag this to WWL.`;
        } else {
            st.className = 'status ok';
            st.textContent = `${result.members.length} hitter(s) found`
                + (meta?.rateLimited ? ' (Torn rate-limited the war attack fetch partway through — counts may be incomplete, try again in a minute).' : '.');
        }
        $('wp-results-panel').style.display = 'block';
        $('wp-config-panel').style.display = 'block';
        renderWpResultsPreview();
        renderWpPayout();
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    } finally {
        btn.disabled = false; btn.textContent = 'Count hits for this range';
    }
});

let wpResultsSort = { key: null, dir: 'desc' };
function wpResultsAccessors() {
    const acc = { name: m => m.name.toLowerCase(), warHits: m => m.warHits, overflowHits: m => m.overflowHits, totalHits: m => m.totalHits };
    wpChains.forEach(c => { acc[`chain_${c.id}`] = m => m.perChain?.[c.id] ?? -1; });
    return acc;
}
function renderWpResultsPreview() {
    const el = $('wp-results-body');
    const hideZero = $('wp-hide-zero')?.checked;
    const visible = hideZero ? wpCalcResult.members.filter(m => m.totalHits > 0) : wpCalcResult.members;
    const multi = wpChains.length > 1;
    const accessors = wpResultsAccessors();
    const sorted = sortRows(visible, wpResultsSort, accessors);

    el.innerHTML = `
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--muted);margin-bottom:8px;">
            <input type="checkbox" id="wp-hide-zero" style="width:auto;" ${hideZero ? 'checked' : ''}> Hide members with 0 hits
        </label>
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <thead><tr style="color:var(--muted);text-align:left;">
                <th data-sort="name" style="padding:4px 8px;">Member</th>
                ${multi ? wpChains.map(c => `<th data-sort="chain_${esc(c.id)}" style="padding:4px 8px;">#${esc(c.id)}</th>`).join('') : ''}
                <th data-sort="warHits" style="padding:4px 8px;">War hits</th>
                <th data-sort="overflowHits" style="padding:4px 8px;">Chain-only hits</th><th data-sort="totalHits" style="padding:4px 8px;">Total</th>
            </tr></thead>
            <tbody>${sorted.map(m => `
                <tr style="border-top:1px solid var(--line);${m.totalHits === 0 ? 'opacity:.45;' : ''}">
                    <td style="padding:4px 8px;">${esc(m.name)}</td>
                    ${multi ? wpChains.map(c => `<td style="padding:4px 8px;font-family:var(--mono);color:var(--muted);">${m.perChain?.[c.id] ?? '—'}</td>`).join('') : ''}
                    <td style="padding:4px 8px;font-family:var(--mono);">${m.warHits}</td>
                    <td style="padding:4px 8px;font-family:var(--mono);color:${m.overflowHits ? 'var(--reagent)' : 'var(--muted)'};">${m.overflowHits}</td>
                    <td style="padding:4px 8px;font-family:var(--mono);font-weight:700;">${m.totalHits}</td>
                </tr>`).join('')}
            </tbody>
        </table>`;
    $('wp-hide-zero').addEventListener('change', renderWpResultsPreview);
    wireSort(el, wpResultsSort, visible, accessors, renderWpResultsPreview);
}

function wpCostTotal() {
    return wpCosts.reduce((s, c) => s + c.amount, 0);
}

function renderWpCosts() {
    $('wp-cost-items').innerHTML = wpCosts.map((c, i) => `
        <div style="display:flex;gap:8px;align-items:center;padding:4px 0;font-size:13px;">
            <span style="flex:1;">${esc(c.label)}</span>
            <span style="font-family:var(--mono);">$${c.amount.toLocaleString()}</span>
            <button class="wp-remove-cost" data-idx="${i}" style="background:none;color:var(--muted);padding:0 4px;">✕</button>
        </div>`).join('');
    $('wp-cost-total').textContent = `$${wpCostTotal().toLocaleString()}`;
    $('wp-cost-items').querySelectorAll('.wp-remove-cost').forEach(btn => {
        btn.addEventListener('click', () => {
            wpCosts.splice(Number(btn.dataset.idx), 1);
            renderWpCosts();
            if (wpCalcResult) renderWpPayout();
        });
    });
}

$('wp-add-cost').addEventListener('click', () => {
    const label = $('wp-cost-label').value.trim();
    const amount = Number(($('wp-cost-amount').value || '0').replace(/[,\s]/g, ''));
    if (!label || !amount) return;
    wpCosts.push({ label, amount });
    $('wp-cost-label').value = ''; $('wp-cost-amount').value = '';
    renderWpCosts();
    if (wpCalcResult) renderWpPayout();
});
$('wp-cost-amount').addEventListener('keydown', e => { if (e.key === 'Enter') $('wp-add-cost').click(); });

function wpGetConfig() {
    return {
        pool: Number(($('wp-pool').value || '0').replace(/[,\s]/g, '')),
        costs: wpCostTotal(),
        retainPct: Number($('wp-retain-pct').value || 20),
        isSubFaction: $('wp-sub-faction').checked,
        mode: document.querySelector('input[name="wp-mode"]:checked')?.value || 'equal',
        fixedOverflowRate: Number(($('wp-fixed-rate').value || '0').replace(/[,\s]/g, '')),
        overflowWeight: Number($('wp-weight').value || 50) / 100,
    };
}

function wpCompute() {
    const cfg = wpGetConfig();
    const netPool = Math.max(0, cfg.pool - cfg.costs);
    const retained = netPool * (cfg.retainPct / 100);
    const payoutPool = netPool - retained;

    const members = wpCalcResult.members;
    const totalWarHits = members.reduce((s, m) => s + m.warHits, 0);
    const totalOverflowHits = members.reduce((s, m) => s + m.overflowHits, 0);
    const totalAllHits = members.reduce((s, m) => s + m.totalHits, 0);

    // Every mode resolves to one rate per hit-type, so the math is fully visible per member —
    // no mode is a special case, they just arrive at warRate/overflowRate differently.
    let warRate = 0, overflowRate = 0, poolExceeded = false;
    if (cfg.mode === 'equal') {
        warRate = overflowRate = totalAllHits > 0 ? payoutPool / totalAllHits : 0;
    } else if (cfg.mode === 'weighted') {
        // Solve for a war-hit rate x such that x * totalWarHits + (x * weight) * totalOverflowHits
        // exactly exhausts the payout pool — i.e. overflow hits are worth a fixed fraction of a war hit.
        const denominator = totalWarHits + totalOverflowHits * cfg.overflowWeight;
        warRate = denominator > 0 ? payoutPool / denominator : 0;
        overflowRate = warRate * cfg.overflowWeight;
    } else {
        // Split mode: overflow hits are paid a fixed rate FIRST (deducted from the pool), and
        // whatever remains is what war hits split. Previously the fixed payments were added on
        // TOP of the war-hit pool share instead of coming out of it, which meant the total paid
        // out could exceed the configured pool whenever there were a lot of chain-only hits —
        // that's very likely what looked like "getting paid more than expected", not any actual
        // double-counting of hits.
        overflowRate = cfg.fixedOverflowRate;
        const overflowTotal = totalOverflowHits * overflowRate;
        poolExceeded = overflowTotal > payoutPool;
        const remainingForWar = Math.max(0, payoutPool - overflowTotal);
        warRate = totalWarHits > 0 ? remainingForWar / totalWarHits : 0;
    }

    const rows = members.map(m => {
        const warPay = m.warHits * warRate;
        const overflowPay = m.overflowHits * overflowRate;
        const gross = warPay + overflowPay;
        const penalty = wpPenalties[m.id] || 0;
        const net = Math.max(0, gross - penalty);
        return { ...m, warPay, overflowPay, gross, penalty, net };
    }).sort((a, b) => b.net - a.net);

    const subSplit = cfg.isSubFaction ? {
        theirLeadership: netPool * 0.05,
        you: netPool * 0.05,
        mutualFund: netPool * 0.10,
    } : null;

    return { cfg, netPool, retained, payoutPool, rows, subSplit, totalWarHits, totalOverflowHits, totalAllHits, warRate, overflowRate, poolExceeded };
}

let wpPayoutSort = { key: null, dir: 'desc' };
const wpPayoutAccessors = { name: r => r.name.toLowerCase(), gross: r => r.gross, penalty: r => r.penalty || 0, net: r => r.net };
function renderWpPayout() {
    const computed = wpCompute();
    const el = $('wp-payout-body');

    const subSplitHtml = computed.subSplit ? `
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;padding:10px 12px;background:var(--bench-2);border-radius:var(--radius);font-size:13px;">
            <div><div style="color:var(--muted);font-size:11px;">Their leadership (5%)</div>$${Math.round(computed.subSplit.theirLeadership).toLocaleString()}</div>
            <div><div style="color:var(--muted);font-size:11px;">You (5%)</div>$${Math.round(computed.subSplit.you).toLocaleString()}</div>
            <div><div style="color:var(--muted);font-size:11px;">Mutual fund (10%)</div>$${Math.round(computed.subSplit.mutualFund).toLocaleString()}</div>
            <div style="font-size:11px;color:var(--muted);align-self:center;">Sub-faction sends you 15% total (leadership share stays local)</div>
        </div>` : '';

    // What actually has to be paid out in total (after penalties) — so with no pool entered (a chain event) you
    // still see how much money to have ready.
    const totalPayout = computed.rows.reduce((s, r) => s + r.net, 0);
    const noPool = !computed.cfg.pool;
    const totalHtml = `
        <div style="margin-top:10px;padding:10px 12px;background:var(--bench-2);border-radius:var(--radius);font-size:13px;">
            <b>Total to pay out: <span style="color:var(--reagent);font-family:var(--mono);">$${Math.round(totalPayout).toLocaleString()}</span></b>
            <span style="color:var(--muted);"> — ${computed.rows.filter(r => r.net > 0).length} members${computed.rows.some(r => r.penalty) ? ', after penalties' : ''}</span>
            ${noPool && computed.cfg.mode === 'split' ? `<div style="color:var(--muted);font-size:12px;margin-top:4px;">No pool entered, so this is just the flat rate: ${computed.totalOverflowHits} chain hits × $${Math.round(computed.overflowRate).toLocaleString()}. Have at least this much ready. To also pay war hits, enter a pool in "Total pool" above.</div>` : ''}
            ${noPool && computed.cfg.mode !== 'split' ? '<div style="color:var(--muted);font-size:12px;margin-top:4px;">No pool entered — enter a "Total pool" above, or switch to the Split payout mode to pay chain hits a flat rate without a pool.</div>' : ''}
        </div>`;

    const exceededHtml = computed.poolExceeded && !noPool ? `
        <div style="margin-top:10px;padding:8px 12px;background:rgba(220,80,80,.12);border:1px solid var(--danger);border-radius:var(--radius);font-size:12px;color:var(--danger);">
            ⚠ The fixed overflow rate alone (${computed.totalOverflowHits} hits × $${computed.overflowRate.toLocaleString()}) exceeds the payout pool — war hitters are getting $0/hit as a result. Lower the fixed rate or raise the pool.
        </div>` : '';

    el.innerHTML = `
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:14px;">
            <div><div style="color:var(--muted);font-size:11px;">Net pool (after costs)</div><div style="font-weight:700;">$${Math.round(computed.netPool).toLocaleString()}</div></div>
            <div><div style="color:var(--muted);font-size:11px;">Retained (${computed.cfg.retainPct}%)</div><div style="font-weight:700;">$${Math.round(computed.retained).toLocaleString()}</div></div>
            <div><div style="color:var(--muted);font-size:11px;">Payout pool</div><div style="font-weight:700;color:var(--reagent);">$${Math.round(computed.payoutPool).toLocaleString()}</div></div>
            <div><div style="color:var(--muted);font-size:11px;">$ / war hit</div><div style="font-weight:700;">$${Math.round(computed.warRate).toLocaleString()}</div></div>
            <div><div style="color:var(--muted);font-size:11px;">$ / chain-only hit</div><div style="font-weight:700;">$${Math.round(computed.overflowRate).toLocaleString()}</div></div>
        </div>
        ${totalHtml}
        ${subSplitHtml}
        ${exceededHtml}
        <table style="width:100%;font-size:13px;border-collapse:collapse;margin-top:14px;">
            <thead><tr style="color:var(--muted);text-align:left;">
                <th data-sort="name" style="padding:4px 8px;">Member</th><th style="padding:4px 8px;">Breakdown</th>
                <th data-sort="gross" style="padding:4px 8px;">Gross</th><th data-sort="penalty" style="padding:4px 8px;">Penalty</th>
                <th data-sort="net" style="padding:4px 8px;">Net pay</th><th style="padding:4px 8px;"></th>
            </tr></thead>
            <tbody>${sortRows(computed.rows, wpPayoutSort, wpPayoutAccessors).map(r => {
                const isPaid = wpPaidIds.has(r.id);
                return `
                <tr class="wp-payout-row" data-id="${esc(r.id)}" style="border-top:1px solid var(--line);${isPaid ? 'background:rgba(90,200,140,.08);' : ''}">
                    <td style="padding:4px 8px;${isPaid ? 'color:var(--muted);' : ''}">${isPaid ? '✓ ' : ''}${esc(r.name)}</td>
                    <td style="padding:4px 8px;font-family:var(--mono);font-size:12px;color:var(--muted);">
                        ${r.warHits} war @ $${Math.round(computed.warRate).toLocaleString()} = $${Math.round(r.warPay).toLocaleString()}${r.overflowHits ? `<br>${r.overflowHits} chain @ $${Math.round(computed.overflowRate).toLocaleString()} = $${Math.round(r.overflowPay).toLocaleString()}` : ''}
                    </td>
                    <td style="padding:4px 8px;font-family:var(--mono);">$${Math.round(r.gross).toLocaleString()}</td>
                    <td style="padding:4px 8px;"><input type="text" inputmode="decimal" class="wp-penalty-input" data-id="${esc(r.id)}" value="${r.penalty || ''}" placeholder="0" style="width:80px;font-size:12px;padding:4px 6px;"></td>
                    <td style="padding:4px 8px;font-family:var(--mono);font-weight:700;color:var(--reagent);">$${Math.round(r.net).toLocaleString()}</td>
                    <td style="padding:4px 8px;"><a href="https://www.torn.com/factions.php?step=your#/tab=controls&addMoneyTo=${esc(r.id)}&money=${Math.round(r.net)}"
                            target="_blank" rel="noopener" class="ghost small wp-pay-btn" data-id="${esc(r.id)}"
                            style="display:inline-block;text-decoration:none;">${isPaid ? 'Paid ✓' : 'Pay'}</a></td>
                </tr>`;
            }).join('')}
            </tbody>
        </table>
        <p style="font-size:11px;color:var(--muted);margin-top:8px;">Tip: Ctrl/Cmd-click (or middle-click) "Pay" to open it in a background tab without leaving this page — handy for paying several people in a row.</p>`;
    wireSort(el, wpPayoutSort, computed.rows, wpPayoutAccessors, renderWpPayout);

    el.querySelectorAll('.wp-penalty-input').forEach(inp => {
        inp.addEventListener('change', () => {
            const val = Number(inp.value.replace(/[,\s]/g, '')) || 0;
            wpPenalties[inp.dataset.id] = val;
            renderWpPayout();
        });
    });
    el.querySelectorAll('.wp-pay-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            wpPaidIds.add(btn.dataset.id);
            const row = btn.closest('.wp-payout-row');
            const nameCell = row.querySelector('td');
            row.style.background = 'rgba(90,200,140,.08)';
            nameCell.textContent = '✓ ' + nameCell.textContent;
            nameCell.style.color = 'var(--muted)';
            btn.textContent = 'Paid ✓';
        });
    });
}

['wp-pool', 'wp-retain-pct', 'wp-fixed-rate'].forEach(id => {
    $(id).addEventListener('input', () => { if (wpCalcResult) renderWpPayout(); });
});
$('wp-sub-faction').addEventListener('change', () => { if (wpCalcResult) renderWpPayout(); });
$('wp-mode-equal').addEventListener('change', () => {
    $('wp-fixed-rate-field').style.display = 'none';
    $('wp-weight-field').style.display = 'none';
    if (wpCalcResult) renderWpPayout();
});
$('wp-mode-split').addEventListener('change', () => {
    $('wp-fixed-rate-field').style.display = 'block';
    $('wp-weight-field').style.display = 'none';
    if (wpCalcResult) renderWpPayout();
});
$('wp-mode-weighted').addEventListener('change', () => {
    $('wp-fixed-rate-field').style.display = 'none';
    $('wp-weight-field').style.display = 'block';
    if (wpCalcResult) renderWpPayout();
});
$('wp-weight').addEventListener('input', () => { if (wpCalcResult) renderWpPayout(); });

$('wp-copy').addEventListener('click', () => {
    if (!wpCalcResult) return;
    const computed = wpCompute();
    const chainLabel = wpChains.map(c => '#' + c.id).join(' + ');
    const text = `War payout${wpSelectedWar ? ` vs ${wpSelectedWar.them?.name || 'unknown'}` : ''} (chains ${chainLabel})\n`
        + `Payout pool: $${Math.round(computed.payoutPool).toLocaleString()} (${computed.cfg.mode} mode — $${Math.round(computed.warRate).toLocaleString()}/war hit, $${Math.round(computed.overflowRate).toLocaleString()}/chain hit)\n\n`
        + computed.rows.filter(r => r.totalHits > 0).map(r =>
            `${r.name} [${r.id}] — ${r.warHits} war + ${r.overflowHits} chain — $${Math.round(r.net).toLocaleString()}`).join('\n')
        + `\n\nTOTAL: ${computed.totalAllHits} hits — $${Math.round(computed.rows.reduce((s, r) => s + r.net, 0)).toLocaleString()}`;
    navigator.clipboard.writeText(text).then(() => toast('Payout list copied'));
});

$('wp-save-receipt').addEventListener('click', async () => {
    if (!wpCalcResult) return;
    const btn = $('wp-save-receipt');
    const st = $('wp-receipt-status');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        const computed = wpCompute();
        const receipt = {
            opponent: wpSelectedWar?.them?.name || 'Not specified', warEnd: wpSelectedWar?.end || Math.floor(Date.now() / 1000),
            warStart: wpSelectedWar?.start, enemyFactionId: wpSelectedWar?.them?.id, // used server-side to also bake War Badges into this receipt
            won: wpSelectedWar?.winner != null ? String(wpSelectedWar.winner) === String(wpSelectedWar.us?.id) : null, scoreUs: wpSelectedWar?.us?.score ?? null, scoreThem: wpSelectedWar?.them?.score ?? null, // shown on the War reports page
            isEvent: !!wpSelectedWar?.event, chainIds: wpChains.map(c => c.id), pool: computed.cfg.pool, // the full report shows the whole money flow, from the total pool down
            costs: wpCosts, netPool: computed.netPool, retained: computed.retained, payoutPool: computed.payoutPool,
            retainPct: computed.cfg.retainPct, mode: computed.cfg.mode, subSplit: computed.subSplit,
            warRate: computed.warRate, overflowRate: computed.overflowRate,
            rows: computed.rows.map(r => ({ id: r.id, name: r.name, warHits: r.warHits, overflowHits: r.overflowHits, warPay: r.warPay, overflowPay: r.overflowPay, gross: r.gross, penalty: r.penalty, net: r.net })),
        };
        const result = await wpFetch({ action: 'save-receipt', receipt });
        if (result.error) throw new Error(result.error);
        const link = `${window.location.origin}${window.location.pathname}?receipt=${result.id}`;
        st.className = 'status ok';
        st.innerHTML = `Saved! Share this link: <a href="${esc(link)}" target="_blank" style="color:var(--reagent);">${esc(link)}</a>`;
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    } finally {
        btn.disabled = false; btn.textContent = 'Save & get shareable receipt link';
    }
});

// ---- Receipt viewer — reachable by anyone logged into WWL with the link, not leader-gated ----
async function loadPayoutReceipt(id) {
    const el = $('receipt-body');
    el.innerHTML = '<p style="color:var(--muted);">Loading receipt…</p>';
    try {
        const result = await wpFetch({ action: 'get-receipt', id });
        if (result.error) throw new Error(result.error);
        const r = result.receipt;
        const money = n => `$${Math.round(Number(n) || 0).toLocaleString()}`;
        const rows = Array.isArray(r.rows) ? r.rows : [];
        const costs = Array.isArray(r.costs) ? r.costs : [];
        const costTotal = costs.reduce((s, c) => s + (Number(c.amount) || 0), 0);
        // Receipts saved before the total pool was stored: it is the net pool plus the costs taken off it.
        const pool = r.pool != null ? Number(r.pool) : (Number(r.netPool) || 0) + costTotal;
        const totalPaid = rows.reduce((s, x) => s + (Number(x.net) || 0), 0);
        const totalPenalties = rows.reduce((s, x) => s + (Number(x.penalty) || 0), 0);
        const warHits = rows.reduce((s, x) => s + (Number(x.warHits) || 0), 0);
        const chainHits = rows.reduce((s, x) => s + (Number(x.overflowHits) || 0), 0);
        const paidCount = rows.filter(x => Number(x.net) > 0).length;
        const modeName = { equal: 'Equal — one rate for every hit', split: 'Split — chain hits at a flat rate, war hits share the rest', weighted: 'Weighted — chain hits worth a fraction of a war hit' }[r.mode] || '';
        const stat = (label, value, color, sub) => `<div><div style="color:var(--muted);font-size:11px;">${label}</div><div style="font-weight:700;${color ? `color:${color};` : ''}">${value}</div>${sub ? `<div style="color:var(--muted);font-size:11px;">${sub}</div>` : ''}</div>`;
        const score = r.scoreUs != null && r.scoreThem != null ? ` · ${Number(r.scoreUs).toLocaleString()} – ${Number(r.scoreThem).toLocaleString()}` : '';
        const outcome = r.won === true ? ' · Won' : r.won === false ? ' · Lost' : '';
        const title = r.isEvent ? `Chain event: ${r.opponent}` : `War vs ${r.opponent}`;
        const costsHtml = costs.length ? `
            <div style="margin-bottom:14px;">
                <div style="color:var(--muted);font-size:11px;margin-bottom:4px;">Costs deducted, by category</div>
                <table style="font-size:13px;border-collapse:collapse;">
                    ${costs.map(c => `<tr><td style="padding:2px 16px 2px 0;">${esc(c.label)}</td><td style="padding:2px 0;font-family:var(--mono);text-align:right;">${money(c.amount)}</td></tr>`).join('')}
                    <tr style="border-top:1px solid var(--line);"><td style="padding:2px 16px 2px 0;font-weight:700;">Total costs</td><td style="padding:2px 0;font-family:var(--mono);text-align:right;font-weight:700;">${money(costTotal)}</td></tr>
                </table>
            </div>` : '';
        const receiptAccessors = { name: row => row.name.toLowerCase(), gross: row => Number(row.gross) || 0, penalty: row => Number(row.penalty) || 0, net: row => Number(row.net) || 0 };
        const paint = () => {
            const sortedRows = sortRows(rows, receiptSort, receiptAccessors);
            el.innerHTML = `
            <h3 style="margin-top:0;">${esc(title)} — ${esc(new Date(r.warEnd * 1000).toLocaleDateString())}${esc(outcome)}${esc(score)}</h3>
            <div style="color:var(--muted);font-size:11px;margin-bottom:4px;">Where the money went</div>
            <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:14px;">
                ${stat('Total pool', money(pool))}
                ${stat('Costs', `− ${money(costTotal)}`)}
                ${stat('Net pool', money(r.netPool))}
                ${stat(`Retained (${r.retainPct}%)`, `− ${money(r.retained)}`)}
                ${stat(`Divided among members (${100 - (Number(r.retainPct) || 0)}%)`, money(r.payoutPool), 'var(--reagent)')}
                ${stat('Total paid out', money(totalPaid), 'var(--reagent)', `${paidCount} member${paidCount === 1 ? '' : 's'}${totalPenalties ? `, after ${money(totalPenalties)} in penalties` : ''}`)}
            </div>
            ${costsHtml}
            <div style="color:var(--muted);font-size:11px;margin-bottom:4px;">How it was divided${modeName ? ` — ${esc(modeName)}` : ''}</div>
            <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:14px;">
                ${stat('War hits', warHits.toLocaleString())}
                ${stat('Chain hits', chainHits.toLocaleString())}
                ${r.warRate != null ? stat('$ / war hit', money(r.warRate)) : ''}
                ${r.overflowRate != null ? stat('$ / chain hit', money(r.overflowRate)) : ''}
                ${Array.isArray(r.chainIds) && r.chainIds.length ? stat('Chains', r.chainIds.map(c => '#' + esc(c)).join(', ')) : ''}
            </div>
            <table style="width:100%;font-size:13px;border-collapse:collapse;">
                <thead><tr style="color:var(--muted);text-align:left;">
                    <th data-sort="name" style="padding:4px 8px;">Member</th><th style="padding:4px 8px;">Breakdown</th>
                    <th data-sort="gross" style="padding:4px 8px;">Gross</th><th data-sort="penalty" style="padding:4px 8px;">Penalty</th><th data-sort="net" style="padding:4px 8px;">Net pay</th>
                </tr></thead>
                <tbody>${sortedRows.map(row => `
                    <tr style="border-top:1px solid var(--line);">
                        <td style="padding:4px 8px;">${esc(row.name)}</td>
                        <td style="padding:4px 8px;font-family:var(--mono);font-size:12px;color:var(--muted);">
                            ${row.warHits != null ? `${row.warHits} war = ${money(row.warPay)}${row.overflowHits ? `<br>${row.overflowHits} chain = ${money(row.overflowPay)}` : ''}` : `${row.totalHits} hits`}
                        </td>
                        <td style="padding:4px 8px;font-family:var(--mono);">${money(row.gross)}</td>
                        <td style="padding:4px 8px;font-family:var(--mono);color:var(--muted);">${row.penalty ? `-${money(row.penalty)}` : '—'}</td>
                        <td style="padding:4px 8px;font-family:var(--mono);font-weight:700;color:var(--reagent);">${money(row.net)}</td>
                    </tr>`).join('')}
                    <tr style="border-top:2px solid var(--line);font-weight:700;">
                        <td style="padding:6px 8px;" colspan="2">Total</td>
                        <td style="padding:6px 8px;font-family:var(--mono);">${money(rows.reduce((s, x) => s + (Number(x.gross) || 0), 0))}</td>
                        <td style="padding:6px 8px;font-family:var(--mono);color:var(--muted);">${totalPenalties ? `-${money(totalPenalties)}` : '—'}</td>
                        <td style="padding:6px 8px;font-family:var(--mono);color:var(--reagent);">${money(totalPaid)}</td>
                    </tr>
                </tbody>
            </table>
            ${(() => { const badgesHtml = renderReceiptBadgesHtml(r); return badgesHtml ? `<div style="margin-top:24px;"><h3 style="margin-bottom:10px;">🏆 War Badges</h3>${badgesHtml}</div>` : ''; })()}`;
            wireSort(el, receiptSort, rows, receiptAccessors, paint);
        };
        paint();
    } catch (e) {
        el.innerHTML = `<p style="color:var(--danger);">${esc(e.message)}</p>`;
    }
}
