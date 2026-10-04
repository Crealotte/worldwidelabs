// request-log.js — the history of bank and OC requests (leaders): every request that was ever made, with who claimed, paid or cancelled it and
// when, so mistakes can be traced. Filled by reqLog() in api/war-payout.js; read with the 'req-log' action. Used on the Bank request and OC requests pages.
'use strict';

const rlWhen = ts => new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const RL_LABEL = { open: 'Requested', claimed: 'Claimed', completed: 'Paid', cancelled: 'Cancelled', replaced: 'Replaced by a new request' };
const RL_DONE = { bank: 'Paid out', oc: 'Spawned' };
let rlData = { bank: [], oc: [] };

function rlStatus(e, kind) {
    const age = Date.now() - (e.events[e.events.length - 1]?.t || e.at);
    if (e.status === 'completed') return ['✓ ' + RL_DONE[kind], 'var(--reagent)'];
    if (e.status === 'cancelled') return ['cancelled', 'var(--muted)'];
    if (e.status === 'replaced') return ['replaced', 'var(--muted)'];
    if (e.status === 'claimed') return age > 3600000 ? ['⚠ claimed, never finished', 'var(--danger)'] : ['⏳ claimed', '#f0b432'];
    return age > 86400000 ? ['⚠ open for over a day', 'var(--danger)'] : ['open', '#f0b432'];
}
function renderRequestLog(kind, boxId) {
    const box = $(boxId);
    const f = ($(`${boxId}-filter`) || {}).value || 'all', q = String(($(`${boxId}-search`) || {}).value || '').toLowerCase();
    let list = rlData[kind];
    if (f === 'problem') list = list.filter(e => rlStatus(e, kind)[0].startsWith('⚠'));
    else if (f !== 'all') list = list.filter(e => e.status === f);
    if (q) list = list.filter(e => `${e.name} ${(e.events || []).map(x => x.by).join(' ')}`.toLowerCase().includes(q));
    $(`${boxId}-count`).textContent = `${list.length} of ${rlData[kind].length}`;
    box.innerHTML = list.length ? `<table style="width:100%;font-size:13px;border-collapse:collapse;"><thead><tr style="color:var(--muted);text-align:left;"><th style="padding:4px 8px;">Member</th><th style="padding:4px 8px;">${kind === 'bank' ? 'Amount' : 'Level'}</th><th style="padding:4px 8px;">Status</th><th style="padding:4px 8px;">What happened</th></tr></thead><tbody>${list.map(e => {
        const [label, color] = rlStatus(e, kind);
        return `<tr style="border-top:1px solid var(--line);vertical-align:top;"><td style="padding:5px 8px;"><a href="https://www.torn.com/profiles.php?XID=${esc(e.playerId)}" target="_blank" rel="noopener" style="color:var(--text);">${esc(e.name)}</a></td>
            <td style="padding:5px 8px;font-family:var(--mono);">${kind === 'bank' ? '$' + Math.round(e.amount || 0).toLocaleString('en-US') : esc(e.level) + (e.note ? ` <span style="color:var(--muted);font-family:var(--font);">“${esc(e.note)}”</span>` : '')}</td>
            <td style="padding:5px 8px;color:${color};white-space:nowrap;">${esc(label)}</td>
            <td style="padding:5px 8px;color:var(--muted);">${(e.events || []).map(x => `${esc(x.s === 'completed' ? RL_DONE[kind] : RL_LABEL[x.s] || x.s)}${x.s === 'open' ? '' : ` by ${esc(x.by || '?')}`}${x.how === 'detected' ? ' (seen in the balance)' : ''} <span style="font-size:11px;">${rlWhen(x.t)}</span>`).join(' → ')}</td></tr>`;
    }).join('')}</tbody></table>` : '<p style="color:var(--muted);font-size:13px;margin:0;">Nothing here.</p>';
}
async function loadRequestLog(kind, boxId) {
    const r = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, action: 'req-log', kind }) }).then(x => x.json()).catch(() => null);
    if (!r || r.error) { $(boxId).innerHTML = `<p style="color:var(--danger);font-size:13px;margin:0;">${esc((r && r.error) || 'Could not load the history.')}</p>`; return; }
    rlData[kind] = r.log || [];
    renderRequestLog(kind, boxId);
}
function wireRequestLog(kind, boxId) {
    $(`${boxId}-filter`).addEventListener('change', () => renderRequestLog(kind, boxId));
    $(`${boxId}-search`).addEventListener('input', () => renderRequestLog(kind, boxId));
}

wireRequestLog('oc', 'ocr-hist');
wireRequestLog('bank', 'bank-hist');
