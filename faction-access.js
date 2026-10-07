// faction-access.js — the owner's "Allowed factions" page: the list of factions that may use WWL (see lib/access.js). While it is empty nothing is
// restricted; once a faction is on it, everyone else is turned away at the login. Backend: access-* in api/war-payout.js. Owners only.
'use strict';

async function acFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}
async function loadAccess() {
    const st = $('ac-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    const r = await acFetch({ action: 'access-list' });
    if (r.error) { st.className = 'status err'; st.textContent = r.error; return; }
    st.textContent = ''; st.className = 'status';
    $('ac-state').innerHTML = r.enabled
        ? `<b style="color:var(--reagent);">On</b>: only the ${r.factions.length} faction${r.factions.length === 1 ? '' : 's'} below can use WWL.`
        : '<b style="color:#f0b432;">Off</b>: the list is empty, so anyone can log in. Add a faction (or press the button below) to switch it on.';
    $('ac-list').innerHTML = r.factions.length ? `<table style="width:100%;font-size:13px;border-collapse:collapse;"><thead><tr style="color:var(--muted);text-align:left;"><th style="padding:4px 8px;">Faction</th><th style="padding:4px 8px;">ID</th><th style="padding:4px 8px;">Added</th><th></th></tr></thead><tbody>${r.factions.map(f => `<tr style="border-top:1px solid var(--line);"><td style="padding:5px 8px;font-weight:700;">${esc(f.name || `Faction ${f.id}`)}${f.id === r.mine ? ' <span style="color:var(--muted);font-weight:400;">(yours)</span>' : ''}</td><td style="padding:5px 8px;font-family:var(--mono);">${esc(f.id)}</td><td style="padding:5px 8px;color:var(--muted);">${f.at ? new Date(f.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''}${f.by ? ` by ${esc(f.by)}` : ''}</td><td style="padding:5px 8px;text-align:right;">${f.id === r.mine ? '' : `<button class="ghost small ac-del" data-id="${esc(f.id)}" data-name="${esc(f.name || f.id)}" style="color:var(--danger);">Remove</button>`}</td></tr>`).join('')}</tbody></table>` : '<p style="color:var(--muted);font-size:13px;margin:0;">No factions on the list yet.</p>';
    $('ac-list').querySelectorAll('.ac-del').forEach(b => b.addEventListener('click', async () => {
        if (!confirm(`Remove ${b.dataset.name}? Its members can no longer log in to WWL.`)) return;
        const d = await acFetch({ action: 'access-remove', factionId: b.dataset.id });
        if (d.error) { toast(d.error); return; }
        loadAccess();
    }));
}
$('ac-add').addEventListener('click', async () => {
    const id = $('ac-id').value.replace(/\D/g, '');
    if (!id) return;
    const b = $('ac-add'); b.disabled = true;
    const d = await acFetch({ action: 'access-add', factionId: id });
    b.disabled = false;
    if (d.error) { toast(d.error); return; }
    $('ac-id').value = ''; toast(`${d.name} added`); loadAccess();
});
$('ac-seed').addEventListener('click', async () => {
    const b = $('ac-seed'); b.disabled = true; b.textContent = 'Looking…';
    const d = await acFetch({ action: 'access-seed' });
    b.disabled = false; b.textContent = 'Add every faction that already uses WWL';
    if (d.error) { toast(d.error); return; }
    toast(`${d.added} faction${d.added === 1 ? '' : 's'} added`); loadAccess();
});
