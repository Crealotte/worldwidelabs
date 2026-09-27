// labs-funds.js — the "Labs Funds" page. Any faction leader can view it (read-only); only Labs owners
// can change it (the backend enforces that, the page just hides the controls).
// Shows every faction's war-pay history, the retained cut (the 20%) each keeps, and running
// totals per faction and overall. New war payouts land here automatically when a faction saves a
// payout receipt; the past is filled in with "Import existing receipts" and manual entries.
'use strict';

let lfEntries = [];
let lfExcluded = new Set();
let lfFilter = '';
let lfOwner = false; // owners can change things; other leaders get a read-only view
let lfClaimable = false; // nobody owns Labs yet — a leader can claim it
let lfOwners = {};

async function lfFetch(body) {
    const res = await fetch('/api/war-payout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: apiKey, ...body }),
    });
    return res.json();
}

// Reveals the nav item for leaders. Called once after login; silent for everyone else.
async function checkLabsOwner() {
    try {
        const r = await lfFetch({ action: 'labs-status' });
        lfOwner = !!r.owner; lfClaimable = !!r.claimable;
        const nav = document.querySelector('.nav-item[data-page="labs-funds"]');
        // r.leader is real (Leader/Co-leader, enforced server-side); also respect the "View as" preview
        // so simulating Member/Council hides this like the rest of the Leader-only pages (see AUDIT.md).
        const previewOk = typeof viewAtLeast === 'undefined' || viewAtLeast('leader');
        if (nav) nav.style.display = (r.leader && previewOk) ? '' : 'none';
    } catch (e) { /* not an owner, or offline — the nav item just stays hidden */ }
}

const lfMoney = n => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`;
const lfDate = ts => new Date(ts * 1000).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const lfName = e => e.factionName || (e.factionId ? `Faction ${e.factionId}` : 'Unknown');
const lfKind = { war: 'War cut', spend: 'Spent', adjust: 'Adjustment' };

async function loadLabsFunds() {
    const st = $('lf-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    try {
        const r = await lfFetch({ action: 'labs-get' });
        if (r.error) throw new Error(r.error);
        lfEntries = r.entries || [];
        lfExcluded = new Set(r.excluded || []);
        lfOwners = r.owners || {};
        st.textContent = ''; st.className = 'status';
        renderLabsFunds();
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    }
}

// One row per faction: how many wars, cut received, money spent/adjusted, and what's left.
function lfFactions() {
    const map = {};
    for (const e of lfEntries) {
        const f = map[e.factionKey] || (map[e.factionKey] = { key: e.factionKey, id: e.factionId, name: lfName(e), wars: 0, income: 0, out: 0 });
        if (e.factionName && f.name.startsWith('Faction ')) f.name = e.factionName;
        if (e.kind === 'war') { f.wars++; f.income += e.amount; } else f.out += e.amount;
    }
    return Object.values(map).sort((a, b) => (b.income + b.out) - (a.income + a.out));
}

function renderLabsFunds() {
    // lfOwner is REAL (server-checked); also respect the "View as" preview, so a real owner previewing
    // as Leader sees the same read-only view a genuine non-owner leader would (see AUDIT.md).
    const lfCanEdit = lfOwner && (typeof viewAtLeast === 'undefined' || viewAtLeast('owner'));
    $('lf-claim-panel').style.display = lfClaimable && !lfOwner ? 'block' : 'none';
    $('lf-edit-panel').style.display = lfCanEdit ? 'block' : 'none';
    $('lf-owners-line').innerHTML = lfCanEdit ? `Owners: ${Object.entries(lfOwners).map(([id, n]) => esc(n ? `${n} [${id}]` : id)).join(', ') || '—'} · <a href="#" id="lf-add-owner" style="color:var(--reagent);">add an owner</a>` : 'View only — only Labs owners can change this.';
    const factions = lfFactions();
    const counted = factions.filter(f => !lfExcluded.has(f.key));
    const total = counted.reduce((s, f) => s + f.income + f.out, 0);
    const income = counted.reduce((s, f) => s + f.income, 0);
    const out = counted.reduce((s, f) => s + f.out, 0);

    $('lf-totals').innerHTML = `
        <div><div style="color:var(--muted);font-size:11px;">All Labs funds</div><div style="font-weight:700;font-size:22px;color:var(--reagent);">${lfMoney(total)}</div></div>
        <div><div style="color:var(--muted);font-size:11px;">War cuts received</div><div style="font-weight:700;">${lfMoney(income)}</div></div>
        <div><div style="color:var(--muted);font-size:11px;">Spent / adjusted</div><div style="font-weight:700;">${lfMoney(out)}</div></div>
        <div><div style="color:var(--muted);font-size:11px;">Factions</div><div style="font-weight:700;">${counted.length}</div></div>`;

    $('lf-factions').innerHTML = factions.length ? `
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <thead><tr style="color:var(--muted);text-align:left;">
                <th style="padding:4px 8px;">Faction</th><th style="padding:4px 8px;">Wars</th><th style="padding:4px 8px;">Cut received</th>
                <th style="padding:4px 8px;">Spent / adj.</th><th style="padding:4px 8px;">Funds</th><th style="padding:4px 8px;">Count it</th>
            </tr></thead>
            <tbody>${factions.map(f => `
                <tr style="border-top:1px solid var(--line);${lfExcluded.has(f.key) ? 'opacity:.45;' : ''}">
                    <td style="padding:4px 8px;"><a href="#" class="lf-filter" data-key="${esc(f.key)}" style="color:var(--text);">${esc(f.name)}</a></td>
                    <td style="padding:4px 8px;">${f.wars}</td>
                    <td style="padding:4px 8px;font-family:var(--mono);">${lfMoney(f.income)}</td>
                    <td style="padding:4px 8px;font-family:var(--mono);">${lfMoney(f.out)}</td>
                    <td style="padding:4px 8px;font-family:var(--mono);font-weight:700;color:var(--reagent);">${lfMoney(f.income + f.out)}</td>
                    <td style="padding:4px 8px;"><input type="checkbox" class="lf-count" data-key="${esc(f.key)}" ${lfExcluded.has(f.key) ? '' : 'checked'} ${lfCanEdit ? '' : 'disabled'} style="width:auto;"></td>
                </tr>`).join('')}
            </tbody>
        </table>
        <p style="color:var(--muted);font-size:12px;margin:8px 0 0;">Untick "Count it" for a faction that just uses the app but isn't one of your Labs — it's left out of the totals. Click a faction name to see only its history.</p>`
        : '<p style="color:var(--muted);margin:0;">Nothing recorded yet — use "Import existing receipts" below, or add entries by hand.</p>';

    // add-entry form: known factions to pick from, or type a new one
    const known = factions.map(f => `<option value="${esc(f.key)}">${esc(f.name)}</option>`).join('');
    const picked = $('lf-add-faction').value;
    $('lf-add-faction').innerHTML = `<option value="">— pick a faction —</option>${known}<option value="__new">+ Another faction…</option>`;
    $('lf-add-faction').value = picked;

    const shown = lfFilter ? lfEntries.filter(e => e.factionKey === lfFilter) : lfEntries;
    $('lf-history-title').innerHTML = lfFilter
        ? `History — ${esc(lfName(shown[0] || {}))} <a href="#" id="lf-clear-filter" style="font-size:12px;color:var(--reagent);">show all</a>` : 'History';
    $('lf-history').innerHTML = shown.length ? `
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <thead><tr style="color:var(--muted);text-align:left;">
                <th style="padding:4px 8px;">Date</th><th style="padding:4px 8px;">Faction</th><th style="padding:4px 8px;">Type</th>
                <th style="padding:4px 8px;">Opponent / note</th><th style="padding:4px 8px;text-align:right;">Amount</th><th></th>
            </tr></thead>
            <tbody>${shown.map(e => `
                <tr style="border-top:1px solid var(--line);">
                    <td style="padding:4px 8px;white-space:nowrap;">${lfDate(e.date)}</td>
                    <td style="padding:4px 8px;">${esc(lfName(e))}</td>
                    <td style="padding:4px 8px;">${lfKind[e.kind]}${e.source === 'manual' ? '' : ` <span style="color:var(--muted);font-size:11px;">(${e.source})</span>`}</td>
                    <td style="padding:4px 8px;color:var(--muted);">${esc([e.opponent && `vs ${e.opponent}`, e.note].filter(Boolean).join(' — '))}${e.receiptId ? ` <a href="/?receipt=${esc(e.receiptId)}" target="_blank" style="color:var(--reagent);">receipt</a>` : ''}</td>
                    <td style="padding:4px 8px;text-align:right;font-family:var(--mono);${e.amount < 0 ? 'color:var(--danger);' : ''}">${lfMoney(e.amount)}</td>
                    <td style="padding:4px 8px;">${lfCanEdit ? `<button class="ghost small lf-del" data-id="${esc(e.id)}" title="Delete this entry">✕</button>` : ''}</td>
                </tr>`).join('')}
            </tbody>
        </table>` : '<p style="color:var(--muted);margin:0;">No entries.</p>';

    document.querySelectorAll('.lf-filter').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); lfFilter = a.dataset.key; renderLabsFunds(); }));
    $('lf-clear-filter')?.addEventListener('click', ev => { ev.preventDefault(); lfFilter = ''; renderLabsFunds(); });
    document.querySelectorAll('.lf-count').forEach(cb => cb.addEventListener('change', async () => {
        if (cb.checked) lfExcluded.delete(cb.dataset.key); else lfExcluded.add(cb.dataset.key);
        renderLabsFunds();
        try { await lfFetch({ action: 'labs-exclude', factionKey: cb.dataset.key, excluded: !cb.checked }); } catch (e) { toast('Could not save that'); }
    }));
    document.querySelectorAll('.lf-del').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Delete this entry from the ledger?')) return;
        const r = await lfFetch({ action: 'labs-delete', id: b.dataset.id });
        if (r.error) { toast(r.error); return; }
        lfEntries = lfEntries.filter(e => e.id !== b.dataset.id);
        renderLabsFunds();
    }));
}

$('lf-add-faction').addEventListener('change', () => {
    $('lf-new-faction').style.display = $('lf-add-faction').value === '__new' ? 'block' : 'none';
});

$('lf-add-btn').addEventListener('click', async () => {
    const sel = $('lf-add-faction').value;
    const body = { action: 'labs-add', kind: $('lf-add-kind').value, amount: $('lf-add-amount').value.replace(/[^\d.-]/g, ''),
        opponent: $('lf-add-opponent').value.trim(), note: $('lf-add-note').value.trim() };
    if ($('lf-add-date').value) body.date = Math.floor(Date.parse(`${$('lf-add-date').value}T12:00:00Z`) / 1000);
    if (sel === '__new') body.factionName = $('lf-add-newname').value.trim();
    else if (sel) { const f = lfFactions().find(x => x.key === sel); body.factionId = f?.id || ''; body.factionName = f?.name || ''; }
    const btn = $('lf-add-btn'); btn.disabled = true;
    try {
        const r = await lfFetch(body);
        if (r.error) throw new Error(r.error);
        toast('Added');
        ['lf-add-amount', 'lf-add-opponent', 'lf-add-note'].forEach(id => { $(id).value = ''; });
        await loadLabsFunds();
    } catch (e) { toast(`Couldn't add: ${e.message}`); } finally { btn.disabled = false; }
});

$('lf-import-btn').addEventListener('click', async () => {
    const btn = $('lf-import-btn'); btn.disabled = true; btn.textContent = 'Importing…';
    try {
        const r = await lfFetch({ action: 'labs-import' });
        if (r.error) throw new Error(r.error);
        toast(`Imported ${r.imported} receipt(s) (${r.seen} checked)`);
        await loadLabsFunds();
    } catch (e) { toast(`Import failed: ${e.message}`); } finally { btn.disabled = false; btn.textContent = 'Import existing receipts'; }
});

$('lf-claim-btn').addEventListener('click', async () => {
    if (!confirm('Become the Labs owner? Only owners can change the ledger, so make sure this is you.')) return;
    const r = await lfFetch({ action: 'labs-claim' });
    if (r.error) { toast(r.error); return; }
    lfOwner = true; lfClaimable = false;
    toast('You are now an owner');
    loadLabsFunds();
});

document.addEventListener('click', async ev => {
    if (ev.target.id !== 'lf-add-owner') return;
    ev.preventDefault();
    const id = prompt('Torn player ID of the new owner (numbers only):');
    if (!id) return;
    const r = await lfFetch({ action: 'labs-add-owner', playerId: id });
    if (r.error) { toast(r.error); return; }
    toast('Owner added');
    loadLabsFunds();
});
