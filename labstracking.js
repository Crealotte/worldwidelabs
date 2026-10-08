// labstracking.js — Labstracking inside WWL (owner only, in the CreaLotte menu): the owner's Private Islands read from Torn and the rent-to-own (RTO)
// contracts on them: who rents which island, how many days the lease has left, how far each tenant is towards owning it, and the 30-day amount to offer for an
// extension. It used to be its own page that kept everything in one browser; here the data is on the server. Backend: lt-* in api/war-payout.js, lib/labstracking.js.
'use strict';

let ltData = null, ltEdit = null, ltHide = false;
async function ltFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}
const ltMoney = n => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
const ltMoneyShort = n => { const a = Math.abs(Number(n) || 0); return a >= 1e9 ? `$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M` : ltMoney(n); };

// the same maths as the old page: one 30-day cycle is paid upfront at the start, a new one every 30 days; a typed-in "paid so far" overrides the calculation
function ltMetrics(rto, defaults) {
    const tier = Number(rto.originalHappy) || 4100;
    const rent = Number(rto.monthlyRent) || (defaults.rent[tier] || 27000000), cycleEquity = Number(rto.cycleEquity) || (defaults.equity[tier] || 81000000);
    const start = new Date(rto.startDate || new Date().toISOString().slice(0, 10));
    const days = Math.max(0, Math.floor((Date.now() - start) / 86400000));
    const cycles = Math.max(1, Math.floor(days / 30) + 1);
    const override = rto.manualEquityPaid !== null && rto.manualEquityPaid !== undefined && rto.manualEquityPaid !== '';
    const paid = override ? Number(rto.manualEquityPaid) : cycles * cycleEquity;
    const goal = Number(rto.totalEquityNeeded) || (defaults.goals[tier] || 1800000000);
    return { cycles, rent, cycleEquity, paid, override, goal, total30: rent + cycleEquity, percent: Math.min(100, Math.round(paid / goal * 100)), remaining: Math.max(0, goal - paid), startDate: rto.startDate };
}

async function loadLabstracking() {
    const st = $('lt-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    const r = await ltFetch({ action: 'lt-get' });
    if (r.error) { st.className = 'status err'; st.textContent = r.error; return; }
    st.textContent = ''; st.className = 'status';
    ltData = r;
    renderLabstracking();
}
function ltEditor() {
    if (!ltEdit) return '';
    const e = ltEdit, d = ltData.defaults, f = (id, label, val, w, type = 'text', ph = '') => `<div class="field" style="margin:0;width:${w}px;"><label>${label}</label><input id="lt-f-${id}" type="${type}" value="${esc(val ?? '')}" placeholder="${esc(ph)}"></div>`;
    return `<div class="panel" style="border-color:var(--accent,#35d99b);"><h3 style="margin-top:0;">${e.id ? 'Edit the contract' : 'New RTO contract'}</h3>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
            ${f('client', 'Client / tenant name', e.clientName, 200)}
            <div class="field" style="margin:0;width:140px;"><label>Island tier</label><select id="lt-f-tier">${[4100, 3600, 2600].map(t => `<option value="${t}" ${Number(e.originalHappy) === t ? 'selected' : ''}>${t} happy</option>`).join('')}</select></div>
            ${f('prop', 'Property ID', e.propertyId, 120, 'text', 'optional')}${f('tenant', 'Tenant ID', e.tenantId, 120, 'text', 'optional')}
            ${f('start', 'Contract start', e.startDate, 150, 'date')}
            ${f('cycle', 'Equity per 30 days ($)', e.cycleEquity, 170, 'number')}${f('rent', 'Rent per 30 days ($)', e.monthlyRent, 170, 'number')}
            ${f('goal', 'Total equity goal ($)', e.totalEquityNeeded, 190, 'number')}${f('paid', 'Paid equity so far ($)', e.manualEquityPaid ?? '', 190, 'number', 'blank = calculated')}
        </div>
        <div style="margin-top:10px;display:flex;gap:8px;"><button id="lt-save" type="button">Save contract</button><button class="ghost" id="lt-cancel" type="button">Cancel</button></div>
        <div style="font-size:11px;color:var(--muted);margin-top:6px;">Defaults per tier: goal ${[4100, 3600, 2600].map(t => `${t}: ${ltMoneyShort(d.goals[t])}`).join(' · ')} · rent ${[4100, 3600, 2600].map(t => `${t}: ${ltMoneyShort(d.rent[t])}`).join(' · ')} · equity ${[4100, 3600, 2600].map(t => `${t}: ${ltMoneyShort(d.equity[t])}`).join(' · ')} per 30 days. Leave "paid so far" empty and WWL counts one cycle at the start plus one every 30 days.</div></div>`;
}
function ltRtoBlock(rto, open) {
    const m = ltMetrics(rto, ltData.defaults);
    const ext = rto.propertyId ? `https://www.torn.com/properties.php#/p=options&ID=${rto.propertyId}&tab=offerExtension` : null;
    return `<details ${open ? 'open' : ''} style="margin-top:8px;border:1px solid var(--line);border-radius:8px;padding:6px 10px;">
        <summary class="av-sum"><span>🤝 ${esc(rto.clientName)}</span> <span style="color:var(--reagent);font-size:12px;margin-left:8px;">${m.percent}%</span></summary>
        <div style="margin:8px 0;padding:8px;background:var(--bench-2);border-radius:6px;"><div style="font-size:11px;color:var(--muted);">Torn 30-day total rent price</div>
            <div style="font-size:18px;font-weight:700;font-family:var(--mono);color:var(--reagent);">${ext ? `<a href="${ext}" target="_blank" rel="noopener" style="color:inherit;">${ltMoney(m.total30)} ↗</a>` : ltMoney(m.total30)}</div>
            <div style="font-size:12px;color:var(--muted);">${ltMoney(m.rent)} rent + ${ltMoney(m.cycleEquity)} equity</div>
            ${ext ? `<a href="${ext}" target="_blank" rel="noopener" style="font-size:12px;color:var(--reagent);">🔗 Offer extension in Torn ↗</a> <button class="ghost small lt-copy" data-amount="${m.total30}" type="button" style="margin-left:6px;">📋 Copy amount</button>` : `<button class="ghost small lt-copy" data-amount="${m.total30}" type="button">📋 Copy amount</button>`}</div>
        <div style="font-size:13px;line-height:1.7;">Start: <b>${esc(m.startDate || '—')}</b> (${m.cycles} cycle${m.cycles > 1 ? 's' : ''} paid upfront)<br>Goal: <b>${ltMoney(m.goal)}</b><br>Paid equity: <b style="color:var(--reagent);">${ltMoney(m.paid)}</b>${m.override ? ' <span style="font-size:11px;color:var(--muted);">(typed in)</span>' : ''}<br>Remaining: <b>${ltMoney(m.remaining)}</b></div>
        <div style="height:8px;background:var(--bench-2);border-radius:4px;overflow:hidden;margin:8px 0;"><div style="height:100%;width:${m.percent}%;background:var(--reagent);"></div></div>
        <button class="ghost small lt-edit" data-id="${esc(rto.id)}" type="button">Edit contract</button> <button class="ghost small lt-del" data-id="${esc(rto.id)}" type="button" style="color:var(--danger);">Delete</button></details>`;
}
function renderLabstracking() {
    const { pis, rtoItems, syncedAt } = ltData;
    const shown = pis.filter(p => !(ltHide && p.isLivingHere));
    const rented = pis.filter(p => p.isRented), urgent = rented.filter(p => Number(p.daysLeft) <= 5);
    const totals = rtoItems.reduce((s, r) => { const m = ltMetrics(r, ltData.defaults); s.paid += m.paid; s.left += m.remaining; return s; }, { paid: 0, left: 0 });
    const tierBlocks = [4100, 3600, 2600].map(tier => {
        const list = shown.filter(p => Number(p.originalHappy) === tier).sort((a, b) => ((b.isRented || b.isLivingHere) ? 1 : 0) - ((a.isRented || a.isLivingHere) ? 1 : 0));
        if (!list.length) return '';
        return `<h3 style="margin:18px 0 8px;color:var(--reagent);border-left:4px solid var(--reagent);padding-left:10px;">${tier} base happy <span style="color:var(--muted);font-size:13px;">(${list.length})</span></h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:12px;">${list.map(p => {
            const rtoItem = rtoItems.find(r => String(r.propertyId) === String(p.id));
            const edge = p.isLivingHere ? '#9b59b6' : p.isRented ? '#3498db' : '#2ecc71';
            return `<div class="panel" style="margin:0;border-left:4px solid ${edge};"><h3 style="margin:0 0 4px;"><a href="https://www.torn.com/properties.php#/p=propertyinfo&profile=1&ID=${esc(p.id)}" target="_blank" rel="noopener" style="color:var(--text);">${esc(p.propertyName)} ↗</a></h3>
                <div style="font-size:12px;color:var(--muted);">${esc(p.tierName)} (active ${esc(p.currentHappyWithStaff)})</div>
                <div style="margin:6px 0;">Status: <b>${esc(p.status)}</b></div>
                ${p.isLivingHere ? '<div style="color:#b07fd0;font-weight:700;">★ Currently living here</div>' : ''}
                ${p.isRented ? `<div style="font-size:13px;">Tenant: <a href="https://www.torn.com/profiles.php?XID=${esc(p.tenantID)}" target="_blank" rel="noopener" style="color:var(--reagent);">#${esc(p.tenantID)} ↗</a><br>Remaining lease: <b style="color:${Number(p.daysLeft) <= 5 ? 'var(--danger)' : 'var(--reagent)'};">${esc(p.daysLeft)} days</b></div>
                    ${rtoItem ? ltRtoBlock(rtoItem, false) : `<button class="ghost small lt-new" data-prop="${esc(p.id)}" data-tier="${esc(p.originalHappy)}" data-tenant="${esc(p.tenantID)}" type="button" style="margin-top:8px;">+ Start RTO contract</button>`}` : ''}
                ${!p.isRented && !p.isLivingHere ? `<div style="color:var(--muted);font-size:13px;">Vacant, available for rent</div>${rtoItem ? ltRtoBlock(rtoItem, false) : ''}` : ''}</div>`;
        }).join('')}</div>`;
    }).join('');
    const loose = rtoItems.filter(r => !r.propertyId || !pis.some(p => String(p.id) === String(r.propertyId)));
    const looseBlock = loose.length ? `<h3 style="margin:18px 0 8px;color:var(--reagent);border-left:4px solid var(--reagent);padding-left:10px;">Unlinked / manual RTO deals</h3><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:12px;">${loose.map(r => `<div class="panel" style="margin:0;"><h3 style="margin:0 0 4px;">${esc(r.clientName)}</h3><div style="font-size:12px;color:var(--muted);">${esc(r.tierName || 'PI')}</div>${ltRtoBlock(r, true)}</div>`).join('')}</div>` : '';
    $('lt-body').innerHTML = `
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">
            <button id="lt-sync" type="button">Sync islands from Torn</button><button class="ghost" id="lt-add" type="button">+ Add RTO deal</button>
            <label style="display:flex;gap:6px;align-items:center;font-size:13px;cursor:pointer;"><input type="checkbox" id="lt-hide" ${ltHide ? 'checked' : ''} style="width:auto;"> Hide personal residence</label>
            <span style="font-size:12px;color:var(--muted);">${syncedAt ? `Last synced ${new Date(syncedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Not synced yet'}</span></div>
        ${pis.length ? `<div class="panel" style="display:flex;gap:26px;flex-wrap:wrap;font-size:13px;"><div><div style="color:var(--muted);font-size:11px;">Islands</div><b>${pis.length}</b> <span style="color:var(--muted);">(${rented.length} rented, ${pis.filter(p => !p.isRented && !p.isLivingHere).length} vacant)</span></div>
            <div><div style="color:var(--muted);font-size:11px;">Contracts</div><b>${rtoItems.length}</b></div>
            <div><div style="color:var(--muted);font-size:11px;">Equity paid in total</div><b style="font-family:var(--mono);">${ltMoneyShort(totals.paid)}</b></div>
            <div><div style="color:var(--muted);font-size:11px;">Still to be paid</div><b style="font-family:var(--mono);">${ltMoneyShort(totals.left)}</b></div>
            <div><div style="color:var(--muted);font-size:11px;">Leases ending within 5 days</div><b style="color:${urgent.length ? 'var(--danger)' : 'var(--muted)'};">${urgent.length ? urgent.map(p => `#${esc(p.tenantID)} (${esc(p.propertyName)}, ${esc(p.daysLeft)}d)`).join(', ') : 'none'}</b></div></div>` : ''}
        ${ltEditor()}
        ${pis.length ? tierBlocks : '<div class="panel" style="color:var(--muted);">No islands yet. Press "Sync islands from Torn": it reads your Private Islands with your own key.</div>'}
        ${looseBlock}
        <details class="panel" style="margin-top:18px;"><summary class="av-sum"><h3 style="display:inline;margin:0;">Bring over the contracts of the old Labstracking page</h3></summary>
            <p style="font-size:12px;color:var(--muted);margin:8px 0;">1) Open the old page (labstracking.vercel.app) in this browser. 2) Press F12, open the Console tab, paste <code>copy(localStorage.getItem('labstracking_db'))</code> and press Enter. 3) Paste what was copied into the box below and press Import. Contracts that are already here are skipped.</p>
            <textarea id="lt-import" rows="4" style="width:100%;font-family:var(--mono);font-size:11px;"></textarea><button class="ghost small" id="lt-import-btn" type="button" style="margin-top:6px;">Import</button></details>`;
    wireLabstracking();
}
function wireLabstracking() {
    const fresh = (over = {}) => ({ id: null, clientName: '', originalHappy: 4100, propertyId: '', tenantId: '', startDate: new Date().toISOString().slice(0, 10), cycleEquity: ltData.defaults.equity[4100], monthlyRent: ltData.defaults.rent[4100], totalEquityNeeded: ltData.defaults.goals[4100], manualEquityPaid: null, ...over });
    $('lt-sync').addEventListener('click', async () => { const b = $('lt-sync'); b.disabled = true; b.textContent = 'Syncing…'; const r = await ltFetch({ action: 'lt-sync' }); if (r.error) { toast(r.error); b.disabled = false; b.textContent = 'Sync islands from Torn'; return; } ltData = r; toast(`Synced ${r.pis.length} island${r.pis.length === 1 ? '' : 's'}`); renderLabstracking(); });
    $('lt-add').addEventListener('click', () => { ltEdit = fresh(); renderLabstracking(); $('lt-f-client')?.focus(); });
    $('lt-hide').addEventListener('change', () => { ltHide = $('lt-hide').checked; renderLabstracking(); });
    document.querySelectorAll('.lt-new').forEach(b => b.addEventListener('click', () => { const tier = Number(b.dataset.tier); ltEdit = fresh({ propertyId: b.dataset.prop, tenantId: b.dataset.tenant && b.dataset.tenant !== 'null' ? b.dataset.tenant : '', clientName: b.dataset.tenant && b.dataset.tenant !== 'null' ? `Tenant #${b.dataset.tenant}` : '', originalHappy: tier, cycleEquity: ltData.defaults.equity[tier], monthlyRent: ltData.defaults.rent[tier], totalEquityNeeded: ltData.defaults.goals[tier] }); renderLabstracking(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
    document.querySelectorAll('.lt-edit').forEach(b => b.addEventListener('click', () => { ltEdit = { ...ltData.rtoItems.find(r => r.id === b.dataset.id) }; renderLabstracking(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
    document.querySelectorAll('.lt-del').forEach(b => b.addEventListener('click', async () => { if (!confirm('Remove this RTO contract?')) return; const r = await ltFetch({ action: 'lt-rto-delete', id: b.dataset.id }); if (r.error) { toast(r.error); return; } loadLabstracking(); }));
    document.querySelectorAll('.lt-copy').forEach(b => b.addEventListener('click', () => { navigator.clipboard.writeText(b.dataset.amount).then(() => toast('Amount copied')); }));
    $('lt-cancel')?.addEventListener('click', () => { ltEdit = null; renderLabstracking(); });
    $('lt-f-tier')?.addEventListener('change', () => { const t = Number($('lt-f-tier').value); if (!ltEdit.id) { $('lt-f-rent').value = ltData.defaults.rent[t]; $('lt-f-cycle').value = ltData.defaults.equity[t]; $('lt-f-goal').value = ltData.defaults.goals[t]; } });
    $('lt-save')?.addEventListener('click', async () => {
        const v = id => $(`lt-f-${id}`).value;
        const item = { id: ltEdit.id, clientName: v('client'), originalHappy: Number(v('tier')), propertyId: v('prop'), tenantId: v('tenant'), startDate: v('start'), cycleEquity: v('cycle'), monthlyRent: v('rent'), totalEquityNeeded: v('goal'), manualEquityPaid: v('paid') };
        const r = await ltFetch({ action: 'lt-rto-save', item });
        if (r.error) { toast(r.error); return; }
        ltEdit = null; toast('Contract saved'); loadLabstracking();
    });
    $('lt-import-btn').addEventListener('click', async () => { const r = await ltFetch({ action: 'lt-import', json: $('lt-import').value }); if (r.error) { toast(r.error); return; } toast(`${r.added} contract${r.added === 1 ? '' : 's'} imported${r.skipped ? `, ${r.skipped} already here` : ''}`); loadLabstracking(); });
}
