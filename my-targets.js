// my-targets.js — helpers shared by the target pages (Level targets, Target finder, Extended search) and the "My targets" page:
//  - the hospital / status of the targets is filled in by itself (statuses come from the server, which keeps each one for ~90 s for everybody);
//  - a row you pressed "Attack" on turns faded green (kept 24 h in this browser), so you can see where you left off;
//  - every row gets a ★ button that saves the player to your own list (easy to beat, decent respect) — the list is kept per player on the server.
// Backend: lib/targets.js. The row tables are found through their <tbody> ids below, so nothing in the three pages' own code had to change much.
'use strict';

const TG_TBODIES = ['bt-body', 'tf-results-body', 'es-results-body', 'mt-body'];
const TG_MARK_KEY = 'wwl_attacked'; // { playerId: unix seconds you pressed Attack }
const TG_MARK_HOURS = 24;

async function tgFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}

// ---- statuses ----
// Asks for the statuses of these ids (a few rounds if some still have to be looked up) and calls onEach(id, {state, until}) as they arrive.
async function tgStatuses(ids, onEach) {
    let todo = [...new Set(ids.map(String))];
    for (let round = 0; round < 6 && todo.length; round++) {
        const r = await tgFetch({ action: 'target-status', ids: todo });
        if (r.error) return;
        const got = Object.entries(r.status || {});
        got.forEach(([id, s]) => onEach(id, s));
        if (!r.pending || r.rateLimited) return;
        todo = todo.filter(id => !(id in (r.status || {})));
        await new Promise(res => setTimeout(res, 800));
    }
}
function tgSetCell(cell, t) {
    if (!cell) return;
    cell.textContent = btStatusLabel(t);
    cell.style.color = baldrStateColor(t.state);
    cell.style.fontWeight = t.state === 'Okay' ? '700' : '400';
}

// Level targets: the first 30 of the list get their status by themselves (the "Check targets" button still does the whole list).
async function btAutoStatus() {
    const first = btTargets.slice(0, 30);
    await tgStatuses(first.map(t => t.id), (id, s) => {
        const t = btTargets.find(x => String(x.id) === String(id));
        if (!t || t.state) return;
        t.state = s.state; t.until = s.until;
        tgSetCell($(`bt-st-${t.id}`), t);
    });
    if (typeof startBtTicker === 'function') startBtTicker();
}
// Target finder: rows that came without a live status.
async function tfAutoStatus() {
    const rows = tfResults.filter(r => !r.state).slice(0, 40);
    await tgStatuses(rows.map(r => r.id), (id, s) => {
        const r = tfResults.find(x => String(x.id) === String(id));
        if (!r) return;
        r.state = s.state; r.until = s.until;
        tgSetCell($(`tf-st-${r.id}`), r);
    });
}
// Extended search: its "last seen" column becomes the status (last seen stays as the hover text).
async function esAutoStatus() {
    const rows = esResults.slice(0, 40);
    await tgStatuses(rows.map(r => r.id), (id, s) => {
        const r = rows.find(x => String(x.id) === String(id));
        if (!r) return;
        r.state = s.state; r.until = s.until;
        const cell = $(`es-st-${r.id}`);
        if (cell) { cell.title = `last seen ${relativeTime(r.lastAction)}`; tgSetCell(cell, r); }
    });
}

// ---- green rows: where you left off ----
const tgMarks = () => { try { return JSON.parse(localStorage.getItem(TG_MARK_KEY) || '{}'); } catch (e) { return {}; } };
function tgSaveMarks(m) { try { localStorage.setItem(TG_MARK_KEY, JSON.stringify(m)); } catch (e) { /* not saved */ } }
const tgRowId = tr => { const a = tr.querySelector('a[href*="sid=attack"]'); const m = a && /user2ID=(\d+)/.exec(a.getAttribute('href')); return m ? m[1] : null; };

function tgApplyRows(tbody) {
    const marks = tgMarks(), now = Math.floor(Date.now() / 1000);
    tbody.querySelectorAll('tr').forEach(tr => {
        const id = tgRowId(tr);
        if (!id) return;
        const at = marks[id];
        tr.classList.toggle('atk-done', !!at && now - at < TG_MARK_HOURS * 3600);
        if (!tr.querySelector('.mt-star')) { // the ★ next to the Attack button
            const cell = tr.querySelector('a[href*="sid=attack"]').closest('td');
            cell.insertAdjacentHTML('beforeend', ` <button class="ghost small mt-star" data-id="${id}" title="Add to My targets" style="padding:2px 8px;">★</button>`);
        }
    });
}

document.addEventListener('click', e => {
    const a = e.target.closest('a[href*="sid=attack&user2ID="]');
    if (a && TG_TBODIES.some(id => $(id)?.contains(a))) {
        const id = /user2ID=(\d+)/.exec(a.getAttribute('href'))[1];
        const m = tgMarks(); m[id] = Math.floor(Date.now() / 1000); tgSaveMarks(m);
        setTimeout(() => TG_TBODIES.forEach(t => $(t) && tgApplyRows($(t))), 0);
        return;
    }
    const star = e.target.closest('.mt-star');
    if (star) tgStarClick(star);
});

async function tgStarClick(btn) {
    const tr = btn.closest('tr'), id = btn.dataset.id;
    const link = tr.querySelector('a[href*="profiles.php?XID="]');
    const name = link ? link.textContent.replace(/\s*\[\d+\]\s*$/, '').trim() : '';
    const level = Number((tr.querySelectorAll('td')[1]?.textContent || '').trim());
    const note = prompt(`Add ${name || id} to your targets.\n\nA note for yourself (optional), e.g. "easy, ~3 respect":`, '');
    if (note === null) return;
    const r = await tgFetch({ action: 'mytargets-add', id, name, level: Number.isFinite(level) ? level : null, note });
    if (r.error) { toast(r.error); return; }
    btn.textContent = '✓'; btn.title = 'In your targets';
    toast(`${name || id} added to My targets`);
}

// watch the four tables: whenever one is redrawn, put the green marks and stars back
function tgWatch() {
    TG_TBODIES.forEach(id => {
        const tb = $(id);
        if (!tb || tb.dataset.tgWatched) return;
        tb.dataset.tgWatched = '1';
        let busy = false;
        new MutationObserver(() => { if (busy) return; busy = true; tgApplyRows(tb); busy = false; }).observe(tb, { childList: true });
        const wrap = tb.closest('.table-scroll') || tb.closest('table');
        if (wrap && !wrap.previousElementSibling?.classList?.contains('tg-bar')) {
            wrap.insertAdjacentHTML('beforebegin', '<div class="tg-bar" style="font-size:12px;color:var(--muted);margin:0 0 6px;">Faded green = you already pressed Attack (kept for 24 hours). ★ adds a player to <b>My targets</b>. <a href="#" class="tg-clear" style="color:var(--reagent);">Clear the green marks</a></div>');
            wrap.previousElementSibling.querySelector('.tg-clear').addEventListener('click', ev => { ev.preventDefault(); tgSaveMarks({}); TG_TBODIES.forEach(t => $(t) && tgApplyRows($(t))); toast('Marks cleared'); });
        }
    });
}
tgWatch();

// ---- My targets page ----
let mtList = [];
async function loadMyTargets() {
    const r = await tgFetch({ action: 'mytargets-get' });
    if (r.error) { $('mt-status').className = 'status err'; $('mt-status').textContent = r.error; return; }
    $('mt-status').className = 'status'; $('mt-status').textContent = '';
    mtList = r.targets || [];
    renderMyTargets();
    tgStatuses(mtList.map(t => t.id), (id, s) => {
        const t = mtList.find(x => x.id === id); if (!t) return;
        t.state = s.state; t.until = s.until; if (!t.name && s.name) t.name = s.name;
        tgSetCell($(`mt-st-${id}`), t);
    }).then(() => { if (typeof startBtTicker === 'function') { startMtTicker(); } });
}
function renderMyTargets() {
    $('mt-body').innerHTML = mtList.length ? mtList.map(t => `
        <tr>
            <td><a href="https://www.torn.com/profiles.php?XID=${esc(t.id)}" target="_blank" rel="noopener">${esc(t.name || 'Player')} [${esc(t.id)}]</a></td>
            <td class="num">${t.level ?? '—'}</td>
            <td style="font-size:12px;">${esc(t.note || '')} <a href="#" class="mt-note" data-id="${esc(t.id)}" style="color:var(--muted);">edit</a></td>
            <td id="mt-st-${esc(t.id)}" style="font-size:12px;color:var(--muted);">${t.state ? esc(btStatusLabel(t)) : '…'}</td>
            <td><a href="https://www.torn.com/page.php?sid=attack&user2ID=${esc(t.id)}" target="_blank" rel="noopener"
                   style="background:var(--reagent);color:#06130d;padding:4px 10px;border-radius:4px;text-decoration:none;font-weight:600;font-size:12px;">Attack</a>
                <a href="#" class="mt-del" data-id="${esc(t.id)}" style="color:var(--danger);margin-left:8px;font-size:12px;">Remove</a></td>
        </tr>`).join('') : '<tr><td colspan="5" style="color:var(--muted)">Nothing here yet — press ★ on a target in Level targets, Target finder or Extended search, or add a player ID above.</td></tr>';
    $('mt-body').querySelectorAll('.mt-del').forEach(a => a.addEventListener('click', async e => {
        e.preventDefault();
        await tgFetch({ action: 'mytargets-remove', id: a.dataset.id }); loadMyTargets();
    }));
    $('mt-body').querySelectorAll('.mt-note').forEach(a => a.addEventListener('click', async e => {
        e.preventDefault();
        const t = mtList.find(x => x.id === a.dataset.id);
        const note = prompt('Note for this target:', t?.note || '');
        if (note === null) return;
        await tgFetch({ action: 'mytargets-add', id: t.id, name: t.name, level: t.level, note }); loadMyTargets();
    }));
}
let mtTick = null;
function startMtTicker() {
    if (mtTick) return;
    mtTick = setInterval(() => { mtList.forEach(t => { if (t.state === 'Hospital') tgSetCell($(`mt-st-${t.id}`), t); }); }, 1000);
}
$('mt-add').addEventListener('click', async () => {
    const id = $('mt-id').value.replace(/[^\d]/g, '');
    if (!id) { toast('Type a player ID (numbers).'); return; }
    const r = await tgFetch({ action: 'mytargets-add', id, note: $('mt-note').value });
    if (r.error) { toast(r.error); return; }
    $('mt-id').value = ''; $('mt-note').value = '';
    loadMyTargets();
});
