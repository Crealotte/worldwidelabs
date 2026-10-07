// owner-view.js — the owner's read-only look at another faction's Member Overview and Who's on board. A picker on the Member Overview page lists the
// factions that have a stored key (nightly saving on); picking one makes every request of those two pages carry `asFaction`, and the server answers
// them with that faction's own data (see OWNER_VIEW_ACTIONS in api/war-payout.js). Only an owner ever sees the picker; everyone else's requests never
// carry it. Picking "my faction" goes back to normal.
'use strict';

let ownerAs = '';
try { ownerAs = sessionStorage.getItem('wwl_owner_as') || ''; } catch (e) { /* default: my own faction */ }
let ownerFactions = null; // null = not loaded, false = not an owner

function ownerBody() { return ownerAs ? { asFaction: ownerAs } : {}; }

async function renderOwnerBar() {
    const box = $('mo-owner-bar');
    if (!box) return;
    if (ownerFactions === null) {
        const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, action: 'owner-factions' }) }).then(r => r.json()).catch(() => null);
        ownerFactions = (res && !res.error) ? res.factions.filter(f => f.mine || f.nightly) : false;
    }
    if (!ownerFactions || ownerFactions.length < 2) { box.style.display = 'none'; ownerAs = ''; return; }
    if (ownerAs && !ownerFactions.some(f => f.id === ownerAs)) ownerAs = '';
    const cur = ownerFactions.find(f => f.id === ownerAs);
    box.style.display = 'block';
    box.innerHTML = `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 12px;margin-bottom:12px;border:1px solid ${ownerAs ? '#f0b432' : 'var(--line)'};border-radius:var(--radius);">
        <label for="mo-owner-faction" style="font-size:13px;">Owner: look at</label>
        <select id="mo-owner-faction" style="width:auto;max-width:100%;">${ownerFactions.map(f => `<option value="${f.mine ? '' : esc(f.id)}" ${(f.mine ? '' : f.id) === ownerAs ? 'selected' : ''}>${esc(f.name || `Faction ${f.id}`)}${f.mine ? ' (your faction)' : ''}</option>`).join('')}</select>
        ${ownerAs ? `<span style="font-size:12px;color:#f0b432;">Read-only view of ${esc((cur && cur.name) || ownerAs)}: you can look, not change anything.</span>` : ''}</div>`;
    $('mo-owner-faction').addEventListener('change', () => {
        ownerAs = $('mo-owner-faction').value;
        try { sessionStorage.setItem('wwl_owner_as', ownerAs); } catch (e) { /* not critical */ }
        if (typeof adoptionCache !== 'undefined') adoptionCache = null; // Who's on board must not show the previous faction's list
        if (typeof loadMemberOverview === 'function') loadMemberOverview();
    });
}
