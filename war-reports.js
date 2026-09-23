// war-reports.js — the "War reports" page under War: all past war payout reports of the faction, newest
// first, with the opponent, win / loss, the score, the link to the full report, and the pay details
// (leaders see every member's pay, everyone else only their own line). Backend: lib/warReports.js.
// Leaders can also add a report saved elsewhere before receipts were auto-saved on the site, and mark
// a war restocked right from its report card (same shared marker as the War payout page's past-wars list).
'use strict';

const wrMoney = n => `$${Math.round(Number(n) || 0).toLocaleString()}`;
const wrDate = ts => new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

async function wrFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}

let wrLastResult = null; // kept so the add-report panel can re-render the list after saving without a full reload

async function loadWarReports() {
    const st = $('wr-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    try {
        const r = await wrFetch({ action: 'receipts-report' });
        if (r.error) throw new Error(r.error);
        wrLastResult = r;
        st.textContent = ''; st.className = 'status';
        renderWarReports(r);
    } catch (e) { st.className = 'status err'; st.textContent = e.message; }
}

function renderWarReports(r) {
    const addPanel = r.leader ? wrAddPanelHtml() : '';
    if (!r.reports.length) { $('wr-list').innerHTML = addPanel + '<div class="panel"><p style="color:var(--muted);margin:0;">No payout reports have been saved yet.</p></div>'; if (r.leader) wrWireAddPanel(); return; }
    const wins = r.reports.filter(x => x.won === true).length, losses = r.reports.filter(x => x.won === false).length;
    const head = `<div style="color:var(--muted);font-size:13px;margin-bottom:10px;">${r.reports.length} reports · <span style="color:var(--reagent);">${wins} won</span> · <span style="color:var(--danger);">${losses} lost</span></div>`;
    $('wr-list').innerHTML = addPanel + head + r.reports.map(x => {
        const result = x.won === true ? '<span style="color:var(--reagent);font-weight:700;">Win</span>' : x.won === false ? '<span style="color:var(--danger);font-weight:700;">Loss</span>' : '<span style="color:var(--muted);">Result unknown</span>';
        const score = x.scoreUs != null && x.scoreThem != null ? `<span style="color:var(--muted);font-family:var(--mono);font-size:12px;">${Math.round(x.scoreUs).toLocaleString()} – ${Math.round(x.scoreThem).toLocaleString()}</span>` : '';
        const rows = x.rows || [];
        const restockRow = (r.leader && x.warId) ? `<label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--muted);cursor:pointer;margin-left:auto;" title="Have you restocked the armory for this war yet?">
                <input type="checkbox" class="wr-restock" data-warid="${esc(x.warId)}" ${x.restocked ? 'checked' : ''} style="width:auto;"> Restocked</label>` : '';
        const details = rows.length ? `
            <details style="margin-top:8px;">
                <summary class="av-sum"><span style="font-size:13px;">Pay details${r.leader ? ` (${rows.length} members · ${wrMoney(x.totalPaid)} paid)` : ''}</span></summary>
                <div class="table-scroll" style="max-height:340px;overflow:auto;margin-top:6px;"><table style="width:100%;font-size:13px;border-collapse:collapse;">
                    <thead><tr style="color:var(--muted);text-align:left;"><th style="padding:4px 8px;">Member</th><th style="padding:4px 8px;">War hits</th><th style="padding:4px 8px;">Chain hits</th><th style="padding:4px 8px;">Penalty</th><th style="padding:4px 8px;text-align:right;">Paid</th></tr></thead>
                    <tbody>${rows.slice().sort((a, b) => (b.net || 0) - (a.net || 0)).map(m => `<tr style="border-top:1px solid var(--line);">
                        <td style="padding:4px 8px;">${esc(m.name)}</td><td style="padding:4px 8px;font-family:var(--mono);">${m.warHits ?? 0}</td><td style="padding:4px 8px;font-family:var(--mono);">${m.overflowHits ?? 0}</td>
                        <td style="padding:4px 8px;font-family:var(--mono);">${m.penalty ? wrMoney(m.penalty) : '—'}</td><td style="padding:4px 8px;font-family:var(--mono);text-align:right;font-weight:700;color:var(--reagent);">${wrMoney(m.net)}</td></tr>`).join('')}</tbody>
                </table></div>
            </details>`
            : (r.leader ? '' : '<div style="color:var(--muted);font-size:12px;margin-top:8px;">You weren\'t paid in this war.</div>');
        return `
        <div class="panel">
            <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;">
                <h3 style="margin:0;">vs ${esc(x.opponent)}</h3>
                ${result} ${score}
                <span style="color:var(--muted);font-size:12px;">${wrDate(x.warEnd)}</span>
                ${restockRow}
                <a href="/?receipt=${esc(x.id)}" target="_blank" rel="noopener" class="ghost small" style="${restockRow ? '' : 'margin-left:auto;'}text-decoration:none;padding:4px 10px;">Open report ↗</a>
            </div>
            ${details}
        </div>`;
    }).join('');
    if (r.leader) {
        wrWireAddPanel();
        $('wr-list').querySelectorAll('.wr-restock').forEach(cb => cb.addEventListener('change', () => wrToggleRestocked(cb)));
    }
}

async function wrToggleRestocked(cb) {
    const warId = cb.dataset.warid, value = cb.checked;
    cb.disabled = true;
    try {
        const result = await wrFetch({ action: 'set-restocked', warId, restocked: value });
        if (result.error) throw new Error(result.error);
    } catch (e) {
        cb.checked = !value;
        toast(`Couldn't save that: ${e.message}`);
    } finally { cb.disabled = false; }
}

// ============================================================================================
// ==================  LEADER: add a report saved elsewhere before this was auto-saved  =======
// ============================================================================================
// Older payout reports (made with WWL back before it stored them on the site) can be typed back
// in here: pick the matching war for its opponent/date/result/score (or leave it unmatched and
// type those in by hand), list who got paid what, and it's saved the same way as any other report
// — same shareable link, same place on this page, same restocked checkbox once a war is matched.

let wrAddOpen = false;
let wrWars = null; // fetched lazily the first time the panel opens
let wrPickedWar = null; // the matched war object from wrWars, or null for a freeform entry
let wrAddRows = [{ name: '', warHits: '', overflowHits: '', gross: '', penalty: '', net: '' }];

function wrAddPanelHtml() {
    if (!wrAddOpen) return `<div style="margin-bottom:14px;"><button class="ghost small" id="wr-add-toggle">＋ Add a report saved elsewhere</button></div>`;
    const warPicker = wrWars === null ? '<p style="color:var(--muted);font-size:13px;">Loading past wars…</p>'
        : !wrWars.length ? '<p style="color:var(--muted);font-size:13px;">No past wars found on this key — fill in the details by hand below.</p>'
        : `<div class="table-scroll" style="max-height:180px;overflow:auto;border:1px solid var(--line);border-radius:6px;">${wrWars.map((w, i) => `
            <div class="wr-warpick" data-i="${i}" style="display:flex;gap:10px;align-items:center;padding:6px 10px;cursor:pointer;${wrPickedWar === w ? 'background:var(--bench-2);' : ''}border-bottom:1px solid var(--line);">
                <span style="flex:1;">${esc(w.them?.name || 'Unknown opponent')}</span>
                <span style="font-size:12px;color:var(--muted);">${wrDate(w.end)}</span>
                <span style="font-size:12px;color:${String(w.winner) === String(w.us?.id) ? 'var(--reagent)' : 'var(--danger)'};">${String(w.winner) === String(w.us?.id) ? 'Won' : 'Lost'}</span>
            </div>`).join('')}</div>`;
    const matchedNote = wrPickedWar ? `<p style="color:var(--muted);font-size:12px;margin:6px 0 0;">Matched — opponent, date, result and score are filled in from this war. Click it again, or pick another, to change.</p>` : '';
    return `
    <div class="panel" id="wr-add-panel" style="margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <h3 style="margin:0;">Add a report saved elsewhere</h3>
            <button class="ghost small" id="wr-add-cancel">Cancel</button>
        </div>
        <div class="field"><label>Match it to a past war (optional, but needed for the restocked checkbox)</label>${warPicker}${matchedNote}</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px;">
            <div class="field" style="flex:1;min-width:180px;"><label>Opponent</label><input id="wr-add-opponent" type="text" value="${esc(wrPickedWar?.them?.name || '')}" ${wrPickedWar ? 'disabled' : ''}></div>
            <div class="field"><label>War end date</label><input id="wr-add-date" type="date" value="${wrPickedWar ? new Date(wrPickedWar.end * 1000).toISOString().slice(0, 10) : ''}" ${wrPickedWar ? 'disabled' : ''}></div>
            <div class="field"><label>Result</label><select id="wr-add-won" ${wrPickedWar ? 'disabled' : ''}>
                <option value="" ${wrPickedWar == null ? 'selected' : ''}>Unknown</option>
                <option value="win" ${wrPickedWar && String(wrPickedWar.winner) === String(wrPickedWar.us?.id) ? 'selected' : ''}>Won</option>
                <option value="loss" ${wrPickedWar && String(wrPickedWar.winner) !== String(wrPickedWar.us?.id) ? 'selected' : ''}>Lost</option>
            </select></div>
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;margin-top:10px;cursor:pointer;${wrPickedWar ? '' : 'color:var(--muted);'}">
            <input type="checkbox" id="wr-add-restocked" style="width:auto;" ${wrPickedWar?.restocked ? 'checked' : ''} ${wrPickedWar ? '' : 'disabled'}> Restocked for this war${wrPickedWar ? '' : ' (pick a matching war above first)'}
        </label>
        <div style="margin-top:14px;">
            <label style="display:block;margin-bottom:6px;">Who got paid</label>
            <div id="wr-add-rows">${wrAddRowsHtml()}</div>
            <button class="ghost small" id="wr-add-row-btn" style="margin-top:6px;">+ Add member</button>
        </div>
        <div style="margin-top:14px;display:flex;gap:10px;align-items:center;">
            <button id="wr-add-save">Save report</button>
            <div class="status" id="wr-add-status"></div>
        </div>
    </div>`;
}

function wrAddRowsHtml() {
    return `<div class="table-scroll" style="overflow:auto;"><table style="width:100%;font-size:13px;border-collapse:collapse;min-width:560px;">
        <thead><tr style="color:var(--muted);text-align:left;"><th style="padding:4px 6px;">Member</th><th style="padding:4px 6px;">War hits</th><th style="padding:4px 6px;">Chain hits</th><th style="padding:4px 6px;">Gross</th><th style="padding:4px 6px;">Penalty</th><th style="padding:4px 6px;">Paid (net)</th><th></th></tr></thead>
        <tbody>${wrAddRows.map((row, i) => `<tr>
            <td style="padding:3px 6px;"><input data-i="${i}" data-f="name" value="${esc(row.name)}" style="width:100%;min-width:110px;"></td>
            <td style="padding:3px 6px;"><input data-i="${i}" data-f="warHits" type="number" value="${esc(row.warHits)}" style="width:70px;"></td>
            <td style="padding:3px 6px;"><input data-i="${i}" data-f="overflowHits" type="number" value="${esc(row.overflowHits)}" style="width:70px;"></td>
            <td style="padding:3px 6px;"><input data-i="${i}" data-f="gross" type="text" inputmode="decimal" value="${esc(row.gross)}" style="width:90px;"></td>
            <td style="padding:3px 6px;"><input data-i="${i}" data-f="penalty" type="text" inputmode="decimal" value="${esc(row.penalty)}" style="width:90px;"></td>
            <td style="padding:3px 6px;"><input data-i="${i}" data-f="net" type="text" inputmode="decimal" value="${esc(row.net)}" style="width:90px;"></td>
            <td style="padding:3px 6px;"><button class="ghost small wr-add-row-del" data-i="${i}" ${wrAddRows.length <= 1 ? 'disabled' : ''}>✕</button></td>
        </tr>`).join('')}</tbody>
    </table></div>`;
}

function wrWireAddPanel() {
    $('wr-add-toggle')?.addEventListener('click', () => { wrAddOpen = true; renderWarReports(wrLastResult); });
    $('wr-add-cancel')?.addEventListener('click', () => { wrAddOpen = false; wrPickedWar = null; wrAddRows = [{ name: '', warHits: '', overflowHits: '', gross: '', penalty: '', net: '' }]; renderWarReports(wrLastResult); });
    if (!$('wr-add-panel')) return;
    if (wrWars === null) wrLoadWarsForAdd();
    document.querySelectorAll('.wr-warpick').forEach(row => row.addEventListener('click', () => {
        const w = wrWars[Number(row.dataset.i)];
        wrPickedWar = wrPickedWar === w ? null : w;
        renderWarReports(wrLastResult);
    }));
    wrWireAddRows();
    $('wr-add-row-btn').addEventListener('click', () => { wrAddRows.push({ name: '', warHits: '', overflowHits: '', gross: '', penalty: '', net: '' }); $('wr-add-rows').innerHTML = wrAddRowsHtml(); wrWireAddRows(); });
    $('wr-add-save').addEventListener('click', wrSaveAddedReport);
}

function wrWireAddRows() {
    document.querySelectorAll('#wr-add-rows input').forEach(inp => inp.addEventListener('input', e => {
        wrAddRows[Number(e.target.dataset.i)][e.target.dataset.f] = e.target.value;
    }));
    document.querySelectorAll('.wr-add-row-del').forEach(btn => btn.addEventListener('click', () => {
        wrAddRows.splice(Number(btn.dataset.i), 1);
        $('wr-add-rows').innerHTML = wrAddRowsHtml(); wrWireAddRows();
    }));
}

async function wrLoadWarsForAdd() {
    const result = await wrFetch({ action: 'list-wars' });
    wrWars = result.error ? [] : (result.wars || []);
    if (wrAddOpen) renderWarReports(wrLastResult);
}

async function wrSaveAddedReport() {
    const st = $('wr-add-status'), btn = $('wr-add-save');
    const opponent = wrPickedWar ? wrPickedWar.them?.name : $('wr-add-opponent').value.trim();
    const dateVal = wrPickedWar ? null : $('wr-add-date').value;
    if (!opponent) { st.className = 'status err'; st.textContent = 'Enter (or match) an opponent.'; return; }
    if (!wrPickedWar && !dateVal) { st.className = 'status err'; st.textContent = 'Enter the war end date.'; return; }
    const rows = wrAddRows.filter(r => r.name.trim()).map(r => ({
        id: `manual_${r.name.trim().toLowerCase().replace(/\s+/g, '_')}`, name: r.name.trim(),
        warHits: Number(r.warHits) || 0, overflowHits: Number(r.overflowHits) || 0,
        gross: Number(r.gross) || 0, penalty: Number(r.penalty) || 0, net: Number(r.net) || 0,
    }));
    if (!rows.length) { st.className = 'status err'; st.textContent = 'Add at least one member who got paid.'; return; }

    const wonSel = $('wr-add-won')?.value;
    const receipt = wrPickedWar ? {
        opponent, warEnd: wrPickedWar.end, warStart: wrPickedWar.start, enemyFactionId: wrPickedWar.them?.id, warId: wrPickedWar.id,
        won: wrPickedWar.winner != null ? String(wrPickedWar.winner) === String(wrPickedWar.us?.id) : null,
        scoreUs: wrPickedWar.us?.score ?? null, scoreThem: wrPickedWar.them?.score ?? null, rows,
    } : {
        opponent, warEnd: Math.floor(new Date(`${dateVal}T12:00:00Z`).getTime() / 1000),
        won: wonSel === 'win' ? true : wonSel === 'loss' ? false : null, rows,
    };

    btn.disabled = true; st.className = 'status ok'; st.textContent = 'Saving…';
    try {
        const result = await wrFetch({ action: 'save-receipt', receipt });
        if (result.error) throw new Error(result.error);
        if (wrPickedWar && $('wr-add-restocked').checked) {
            await wrFetch({ action: 'set-restocked', warId: wrPickedWar.id, restocked: true });
        }
        wrAddOpen = false; wrPickedWar = null; wrAddRows = [{ name: '', warHits: '', overflowHits: '', gross: '', penalty: '', net: '' }];
        toast('Report saved');
        loadWarReports();
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
        btn.disabled = false;
    }
}
