// war-payout-tracker.js — WorldWideLabs War Payout Calculator (frontend).
'use strict';

let warPayoutLoaded = false;
let wpWars = [];
let wpSelectedWar = null; // optional — just for opponent name context on the receipt
let wpChains = []; // { id, totalHits }
let wpCalcResult = null; // { members: [...] }
let wpPenalties = {}; // memberId -> amount
let wpPaidIds = new Set(); // memberId -> marked as paid this session
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
    $('wp-locked').style.display = isLeaderCached ? 'none' : 'block';
    $('wp-editor').style.display = isLeaderCached ? 'block' : 'none';
    if (!isLeaderCached) return;

    const st = $('wp-war-status');
    st.className = 'status ok'; st.textContent = 'Loading past wars…';
    try {
        const result = await wpFetch({ action: 'list-wars' });
        if (result.error) throw new Error(result.error);
        wpWars = result.wars || [];
        renderWarList();
        st.textContent = ''; st.className = 'status';
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    }
}

function renderWarList() {
    const el = $('wp-war-list');
    if (!wpWars.length) {
        el.innerHTML = '<p style="color:var(--muted);font-size:13px;">No past wars found on this key.</p>';
        return;
    }
    el.innerHTML = `
        <div class="ocfit-scenario collapsed" data-collapse="wp-wars">
            <div class="ocfit-scenario-header">
                <span>Past wars (${wpWars.length})</span>
                <span class="chev">▾</span>
            </div>
            <div class="ocfit-scenario-body">${wpWars.map((w, i) => `
                <div class="ocfit-role-row" data-war-idx="${i}" style="cursor:pointer;">
                    <span class="ocfit-role-name">${esc(w.them?.name || 'Unknown opponent')}</span>
                    <span style="font-size:12px;color:var(--muted);">${esc(wpFmtDate(w.end))}</span>
                    <span style="font-size:12px;color:${String(w.winner) === String(w.us?.id) ? 'var(--reagent)' : 'var(--danger)'};">${String(w.winner) === String(w.us?.id) ? 'Won' : 'Lost'}</span>
                </div>`).join('')}
            </div>
        </div>`;
    el.querySelector('.ocfit-scenario-header').addEventListener('click', () => {
        el.querySelector('.ocfit-scenario').classList.toggle('collapsed');
    });
    el.querySelectorAll('[data-war-idx]').forEach(row => {
        row.addEventListener('click', () => selectWar(Number(row.dataset.warIdx)));
    });
}

function selectWar(idx) {
    wpSelectedWar = wpWars[idx];
    $('wp-war-list').querySelectorAll('[data-war-idx]').forEach((row, i) => {
        row.style.background = i === idx ? 'var(--bench-2)' : '';
    });
    $('wp-chains-panel').style.display = 'block';
    $('wp-chains-note').textContent = `vs ${wpSelectedWar.them?.name || 'unknown'} — add every chain ID that ran during (or spilled outside) this war below.`;
}

function renderChainChips() {
    const el = $('wp-chain-list');
    el.innerHTML = wpChains.map((c, i) => `
        <div class="chip">
            <span class="cid">#${esc(c.id)}</span>
            <span class="meta">${c.totalHits != null ? `${c.totalHits} hits` : 'not loaded yet'}</span>
            <button data-idx="${i}" class="wp-remove-chain">✕</button>
        </div>`).join('');
    el.querySelectorAll('.wp-remove-chain').forEach(btn => {
        btn.addEventListener('click', () => { wpChains.splice(Number(btn.dataset.idx), 1); renderChainChips(); });
    });
}

$('wp-add-chain').addEventListener('click', () => {
    const id = wpParseChainID($('wp-chain-input').value);
    const st = $('wp-chain-status');
    if (!id) { st.className = 'status err'; st.textContent = 'Enter a chain ID or paste the full chain report URL.'; return; }
    if (wpChains.some(c => c.id === id)) { st.className = 'status err'; st.textContent = `Chain #${id} is already added.`; return; }
    wpChains.push({ id, totalHits: null });
    $('wp-chain-input').value = '';
    st.className = 'status'; st.textContent = '';
    renderChainChips();
});
$('wp-chain-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('wp-add-chain').click(); });

$('wp-calculate').addEventListener('click', async () => {
    if (!wpChains.length) {
        $('wp-calc-status').className = 'status err';
        $('wp-calc-status').textContent = 'Add at least one chain ID first.';
        return;
    }
    const btn = $('wp-calculate');
    const st = $('wp-calc-status');
    btn.disabled = true; btn.textContent = 'Fetching chain reports…';
    try {
        const result = await wpFetch({ action: 'calculate', chainIds: wpChains.map(c => c.id) });
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
        st.className = 'status ok';
        st.textContent = `Loaded ${wpChains.length} chain report(s), ${result.members.length} hitter(s).`;
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

function renderWpResultsPreview() {
    const el = $('wp-results-body');
    const hideZero = $('wp-hide-zero')?.checked;
    const visible = hideZero ? wpCalcResult.members.filter(m => m.totalHits > 0) : wpCalcResult.members;
    const multi = wpChains.length > 1;

    el.innerHTML = `
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--muted);margin-bottom:8px;">
            <input type="checkbox" id="wp-hide-zero" style="width:auto;" ${hideZero ? 'checked' : ''}> Hide members with 0 hits
        </label>
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <thead><tr style="color:var(--muted);text-align:left;">
                <th style="padding:4px 8px;">Member</th>
                ${multi ? wpChains.map(c => `<th style="padding:4px 8px;">#${esc(c.id)}</th>`).join('') : ''}
                <th style="padding:4px 8px;">War hits</th>
                <th style="padding:4px 8px;">Overflow hits</th><th style="padding:4px 8px;">Total</th>
            </tr></thead>
            <tbody>${visible.map(m => `
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
    });

    const subSplit = cfg.isSubFaction ? {
        theirLeadership: netPool * 0.05,
        you: netPool * 0.05,
        mutualFund: netPool * 0.10,
    } : null;

    return { cfg, netPool, retained, payoutPool, rows, subSplit, totalWarHits, totalOverflowHits, totalAllHits, warRate, overflowRate, poolExceeded };
}

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

    const exceededHtml = computed.poolExceeded ? `
        <div style="margin-top:10px;padding:8px 12px;background:rgba(220,80,80,.12);border:1px solid var(--danger);border-radius:var(--radius);font-size:12px;color:var(--danger);">
            ⚠ The fixed overflow rate alone (${computed.totalOverflowHits} hits × $${computed.overflowRate.toLocaleString()}) exceeds the payout pool — war hitters are getting $0/hit as a result. Lower the fixed rate or raise the pool.
        </div>` : '';

    el.innerHTML = `
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:14px;">
            <div><div style="color:var(--muted);font-size:11px;">Net pool (after costs)</div><div style="font-weight:700;">$${Math.round(computed.netPool).toLocaleString()}</div></div>
            <div><div style="color:var(--muted);font-size:11px;">Retained (${computed.cfg.retainPct}%)</div><div style="font-weight:700;">$${Math.round(computed.retained).toLocaleString()}</div></div>
            <div><div style="color:var(--muted);font-size:11px;">Payout pool</div><div style="font-weight:700;color:var(--reagent);">$${Math.round(computed.payoutPool).toLocaleString()}</div></div>
            <div><div style="color:var(--muted);font-size:11px;">$ / war hit</div><div style="font-weight:700;">$${Math.round(computed.warRate).toLocaleString()}</div></div>
            <div><div style="color:var(--muted);font-size:11px;">$ / overflow hit</div><div style="font-weight:700;">$${Math.round(computed.overflowRate).toLocaleString()}</div></div>
        </div>
        ${subSplitHtml}
        ${exceededHtml}
        <table style="width:100%;font-size:13px;border-collapse:collapse;margin-top:14px;">
            <thead><tr style="color:var(--muted);text-align:left;">
                <th style="padding:4px 8px;">Member</th><th style="padding:4px 8px;">Breakdown</th>
                <th style="padding:4px 8px;">Gross</th><th style="padding:4px 8px;">Penalty</th>
                <th style="padding:4px 8px;">Net pay</th><th style="padding:4px 8px;"></th>
            </tr></thead>
            <tbody>${computed.rows.map(r => {
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
            costs: wpCosts, netPool: computed.netPool, retained: computed.retained, payoutPool: computed.payoutPool,
            retainPct: computed.cfg.retainPct, mode: computed.cfg.mode, subSplit: computed.subSplit,
            warRate: computed.warRate, overflowRate: computed.overflowRate,
            rows: computed.rows.map(r => ({ name: r.name, warHits: r.warHits, overflowHits: r.overflowHits, warPay: r.warPay, overflowPay: r.overflowPay, gross: r.gross, penalty: r.penalty, net: r.net })),
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
        const costsHtml = (r.costs && r.costs.length) ? `
            <div style="margin-bottom:14px;">
                <div style="color:var(--muted);font-size:11px;margin-bottom:4px;">Costs deducted</div>
                ${r.costs.map(c => `<div style="font-size:13px;">${esc(c.label)} — $${Math.round(c.amount).toLocaleString()}</div>`).join('')}
            </div>` : '';
        el.innerHTML = `
            <h3 style="margin-top:0;">War vs ${esc(r.opponent)} — ${esc(new Date(r.warEnd * 1000).toLocaleDateString())}</h3>
            <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:14px;">
                <div><div style="color:var(--muted);font-size:11px;">Net pool</div><div style="font-weight:700;">$${Math.round(r.netPool).toLocaleString()}</div></div>
                <div><div style="color:var(--muted);font-size:11px;">Retained (${r.retainPct}%)</div><div style="font-weight:700;">$${Math.round(r.retained).toLocaleString()}</div></div>
                <div><div style="color:var(--muted);font-size:11px;">Payout pool</div><div style="font-weight:700;color:var(--reagent);">$${Math.round(r.payoutPool).toLocaleString()}</div></div>
                ${r.warRate != null ? `<div><div style="color:var(--muted);font-size:11px;">$ / war hit</div><div style="font-weight:700;">$${Math.round(r.warRate).toLocaleString()}</div></div>` : ''}
                ${r.overflowRate != null ? `<div><div style="color:var(--muted);font-size:11px;">$ / chain hit</div><div style="font-weight:700;">$${Math.round(r.overflowRate).toLocaleString()}</div></div>` : ''}
            </div>
            ${costsHtml}
            <table style="width:100%;font-size:13px;border-collapse:collapse;">
                <thead><tr style="color:var(--muted);text-align:left;">
                    <th style="padding:4px 8px;">Member</th><th style="padding:4px 8px;">Breakdown</th>
                    <th style="padding:4px 8px;">Gross</th><th style="padding:4px 8px;">Penalty</th><th style="padding:4px 8px;">Net pay</th>
                </tr></thead>
                <tbody>${r.rows.map(row => `
                    <tr style="border-top:1px solid var(--line);">
                        <td style="padding:4px 8px;">${esc(row.name)}</td>
                        <td style="padding:4px 8px;font-family:var(--mono);font-size:12px;color:var(--muted);">
                            ${row.warHits != null ? `${row.warHits} war = $${Math.round(row.warPay).toLocaleString()}${row.overflowHits ? `<br>${row.overflowHits} chain = $${Math.round(row.overflowPay).toLocaleString()}` : ''}` : `${row.totalHits} hits`}
                        </td>
                        <td style="padding:4px 8px;font-family:var(--mono);">$${Math.round(row.gross).toLocaleString()}</td>
                        <td style="padding:4px 8px;font-family:var(--mono);color:var(--muted);">${row.penalty ? `-$${Math.round(row.penalty).toLocaleString()}` : '—'}</td>
                        <td style="padding:4px 8px;font-family:var(--mono);font-weight:700;color:var(--reagent);">$${Math.round(row.net).toLocaleString()}</td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
    } catch (e) {
        el.innerHTML = `<p style="color:var(--danger);">${esc(e.message)}</p>`;
    }
}
