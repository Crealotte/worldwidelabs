// war-payout-tracker.js — WorldWideLabs War Payout Calculator (frontend).
'use strict';

let warPayoutLoaded = false;
let wpWars = [];
let wpSelectedWar = null; // optional — just for opponent name context on the receipt
let wpChains = []; // { id, totalHits }
let wpCalcResult = null; // { members: [...] }
let wpPenalties = {}; // memberId -> amount

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
    el.innerHTML = wpWars.map((w, i) => `
        <div class="ocfit-role-row" data-war-idx="${i}" style="cursor:pointer;">
            <span class="ocfit-role-name">${esc(w.them?.name || 'Unknown opponent')}</span>
            <span style="font-size:12px;color:var(--muted);">${esc(wpFmtDate(w.end))}</span>
            <span style="font-size:12px;color:${String(w.winner) === String(w.us?.id) ? 'var(--reagent)' : 'var(--danger)'};">${String(w.winner) === String(w.us?.id) ? 'Won' : 'Lost'}</span>
        </div>`).join('');
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

function wpGetConfig() {
    return {
        pool: Number(($('wp-pool').value || '0').replace(/[,\s]/g, '')),
        costs: Number(($('wp-costs').value || '0').replace(/[,\s]/g, '')),
        retainPct: Number($('wp-retain-pct').value || 20),
        isSubFaction: $('wp-sub-faction').checked,
        mode: document.querySelector('input[name="wp-mode"]:checked')?.value || 'equal',
        fixedOverflowRate: Number(($('wp-fixed-rate').value || '0').replace(/[,\s]/g, '')),
    };
}

function wpCompute() {
    const cfg = wpGetConfig();
    const netPool = Math.max(0, cfg.pool - cfg.costs);
    const retained = netPool * (cfg.retainPct / 100);
    const payoutPool = netPool - retained;

    const members = wpCalcResult.members;
    const totalWarHits = members.reduce((s, m) => s + m.warHits, 0);
    const totalAllHits = members.reduce((s, m) => s + m.totalHits, 0);

    const rows = members.map(m => {
        let gross;
        if (cfg.mode === 'equal') {
            gross = totalAllHits > 0 ? (payoutPool / totalAllHits) * m.totalHits : 0;
        } else {
            const warShare = totalWarHits > 0 ? (payoutPool / totalWarHits) * m.warHits : 0;
            const overflowShare = m.overflowHits * cfg.fixedOverflowRate;
            gross = warShare + overflowShare;
        }
        const penalty = wpPenalties[m.id] || 0;
        const net = Math.max(0, gross - penalty);
        return { ...m, gross, penalty, net };
    });

    const subSplit = cfg.isSubFaction ? {
        theirLeadership: netPool * 0.05,
        you: netPool * 0.05,
        mutualFund: netPool * 0.10,
    } : null;

    return { cfg, netPool, retained, payoutPool, rows, subSplit, totalWarHits, totalAllHits };
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

    el.innerHTML = `
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:14px;">
            <div><div style="color:var(--muted);font-size:11px;">Net pool (after costs)</div><div style="font-weight:700;">$${Math.round(computed.netPool).toLocaleString()}</div></div>
            <div><div style="color:var(--muted);font-size:11px;">Retained (${computed.cfg.retainPct}%)</div><div style="font-weight:700;">$${Math.round(computed.retained).toLocaleString()}</div></div>
            <div><div style="color:var(--muted);font-size:11px;">Payout pool</div><div style="font-weight:700;color:var(--reagent);">$${Math.round(computed.payoutPool).toLocaleString()}</div></div>
        </div>
        ${subSplitHtml}
        <table style="width:100%;font-size:13px;border-collapse:collapse;margin-top:14px;">
            <thead><tr style="color:var(--muted);text-align:left;">
                <th style="padding:4px 8px;">Member</th><th style="padding:4px 8px;">Hits</th>
                <th style="padding:4px 8px;">Gross</th><th style="padding:4px 8px;">Penalty</th>
                <th style="padding:4px 8px;">Net pay</th><th style="padding:4px 8px;"></th>
            </tr></thead>
            <tbody>${computed.rows.map(r => `
                <tr style="border-top:1px solid var(--line);">
                    <td style="padding:4px 8px;">${esc(r.name)}</td>
                    <td style="padding:4px 8px;font-family:var(--mono);color:var(--muted);">${r.totalHits}${r.overflowHits ? ` (+${r.overflowHits} overflow)` : ''}</td>
                    <td style="padding:4px 8px;font-family:var(--mono);">$${Math.round(r.gross).toLocaleString()}</td>
                    <td style="padding:4px 8px;"><input type="text" inputmode="decimal" class="wp-penalty-input" data-id="${esc(r.id)}" value="${r.penalty || ''}" placeholder="0" style="width:80px;font-size:12px;padding:4px 6px;"></td>
                    <td style="padding:4px 8px;font-family:var(--mono);font-weight:700;color:var(--reagent);">$${Math.round(r.net).toLocaleString()}</td>
                    <td style="padding:4px 8px;"><button class="ghost small wp-pay-btn" data-id="${esc(r.id)}" data-amount="${Math.round(r.net)}">Pay</button></td>
                </tr>`).join('')}
            </tbody>
        </table>`;

    el.querySelectorAll('.wp-penalty-input').forEach(inp => {
        inp.addEventListener('change', () => {
            const val = Number(inp.value.replace(/[,\s]/g, '')) || 0;
            wpPenalties[inp.dataset.id] = val;
            renderWpPayout();
        });
    });
    el.querySelectorAll('.wp-pay-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const url = `https://www.torn.com/factions.php?step=your#/tab=controls&addMoneyTo=${btn.dataset.id}&money=${btn.dataset.amount}`;
            window.open(url, '_blank');
        });
    });
}

['wp-pool', 'wp-costs', 'wp-retain-pct', 'wp-fixed-rate'].forEach(id => {
    $(id).addEventListener('input', () => { if (wpCalcResult) renderWpPayout(); });
});
$('wp-sub-faction').addEventListener('change', () => { if (wpCalcResult) renderWpPayout(); });
document.querySelectorAll('input[name="wp-mode"]').forEach(radio => {
    radio.addEventListener('change', () => {
        $('wp-fixed-rate-field').style.display = radio.value === 'split' && radio.checked ? 'block' : $('wp-fixed-rate-field').style.display;
        if (wpCalcResult) renderWpPayout();
    });
});
$('wp-mode-equal').addEventListener('change', () => { $('wp-fixed-rate-field').style.display = 'none'; });
$('wp-mode-split').addEventListener('change', () => { $('wp-fixed-rate-field').style.display = 'block'; });

$('wp-copy').addEventListener('click', () => {
    if (!wpCalcResult) return;
    const computed = wpCompute();
    const chainLabel = wpChains.map(c => '#' + c.id).join(' + ');
    const text = `War payout${wpSelectedWar ? ` vs ${wpSelectedWar.them?.name || 'unknown'}` : ''} (chains ${chainLabel})\n`
        + `Payout pool: $${Math.round(computed.payoutPool).toLocaleString()} (${computed.cfg.mode} mode)\n\n`
        + computed.rows.filter(r => r.totalHits > 0).map(r => `${r.name} [${r.id}] — ${r.totalHits} hits — $${Math.round(r.net).toLocaleString()}`).join('\n')
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
            opponent: wpSelectedWar.them?.name || 'Unknown', warEnd: wpSelectedWar.end,
            netPool: computed.netPool, retained: computed.retained, payoutPool: computed.payoutPool,
            retainPct: computed.cfg.retainPct, mode: computed.cfg.mode, subSplit: computed.subSplit,
            rows: computed.rows.map(r => ({ name: r.name, totalHits: r.totalHits, overflowHits: r.overflowHits, gross: r.gross, penalty: r.penalty, net: r.net })),
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
        el.innerHTML = `
            <h3 style="margin-top:0;">War vs ${esc(r.opponent)} — ${esc(new Date(r.warEnd * 1000).toLocaleDateString())}</h3>
            <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:14px;">
                <div><div style="color:var(--muted);font-size:11px;">Net pool</div><div style="font-weight:700;">$${Math.round(r.netPool).toLocaleString()}</div></div>
                <div><div style="color:var(--muted);font-size:11px;">Retained (${r.retainPct}%)</div><div style="font-weight:700;">$${Math.round(r.retained).toLocaleString()}</div></div>
                <div><div style="color:var(--muted);font-size:11px;">Payout pool</div><div style="font-weight:700;color:var(--reagent);">$${Math.round(r.payoutPool).toLocaleString()}</div></div>
            </div>
            <table style="width:100%;font-size:13px;border-collapse:collapse;">
                <thead><tr style="color:var(--muted);text-align:left;">
                    <th style="padding:4px 8px;">Member</th><th style="padding:4px 8px;">Hits</th>
                    <th style="padding:4px 8px;">Gross</th><th style="padding:4px 8px;">Penalty</th><th style="padding:4px 8px;">Net pay</th>
                </tr></thead>
                <tbody>${r.rows.map(row => `
                    <tr style="border-top:1px solid var(--line);">
                        <td style="padding:4px 8px;">${esc(row.name)}</td>
                        <td style="padding:4px 8px;font-family:var(--mono);color:var(--muted);">${row.totalHits}${row.overflowHits ? ` (+${row.overflowHits} overflow)` : ''}</td>
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
