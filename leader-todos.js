// leader-todos.js — the "For leaders: things to do" card on the dashboard (leaders only) and the red count next to Dashboard in the menu.
// The server (leaderTodos in api/war-payout.js) works out what needs a leader's attention; every item has a button that opens the right page
// and scrolls to the right spot. The card is hidden when there is nothing to do.
'use strict';

async function loadLeaderTodos() {
    if (typeof isLeaderCached === 'undefined' || !isLeaderCached || (typeof memberView !== 'undefined' && memberView)) { renderLeaderTodos([]); return; }
    try {
        const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, action: 'leader-todos' }) });
        const r = await res.json();
        renderLeaderTodos(r.error ? [] : r.todos || []);
        if (!r.error && typeof bankEnsureCookie === 'function') bankEnsureCookie(); // bankers: the cookie that makes the Discord Claim button go straight to Torn
    } catch (e) { renderLeaderTodos([]); }
}

let ltSvcOpen = false; // the Services to do stays open or closed the way it was left, also after a refresh
function renderLeaderTodos(todos) {
    const panel = $('leader-todos');
    panel.style.display = todos.length ? 'block' : 'none';
    const goLink = t => `<a href="/${esc(t.page)}" class="ghost small lt-go" data-page="${esc(t.page)}" data-anchor="${esc(t.anchor || '')}" style="padding:6px 12px;border:1px solid var(--reagent);border-radius:var(--radius);color:var(--reagent);white-space:nowrap;font-size:12px;">${esc(t.cta || 'Open')}</a>`;
    // everything from the Labs services is ONE to do that opens up to its items; an item can be marked Known: it stays in the list but does not count until it changes
    const group = t => {
        const open = t.items.filter(x => !x.known), done = t.items.filter(x => x.known);
        const row = (x, dim) => `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:6px 0 6px 12px;border-top:1px solid var(--line);${dim ? 'opacity:.55;' : ''}"><span style="flex:1;min-width:220px;font-size:13px;">${esc(x.text)}${x.waiting ? ' <span style="color:var(--muted);font-size:11px;">(waiting for them)</span>' : ''}</span>${goLink(x)}${x.waiting ? '' : `<button class="ghost small lt-known" data-id="${esc(x.id)}" data-sig="${esc(x.sig || '')}" data-on="${dim ? '0' : '1'}" type="button" title="${dim ? 'Count it again' : 'Keep it in the list but stop counting it until it changes'}" style="font-size:12px;">${dim ? 'Count again' : 'Known'}</button>`}</div>`;
        return `<details class="lt-svc" ${ltSvcOpen ? 'open' : ''} style="padding:8px 0;"><summary class="av-sum" style="cursor:pointer;font-size:14px;list-style:none;"><b>🧩 Services</b> <span style="color:${open.length ? '#e0a030' : 'var(--muted)'};">${open.length ? `${open.length} thing${open.length === 1 ? '' : 's'} to look at` : 'nothing needs you now'}</span>${done.length ? ` <span style="color:var(--muted);font-size:12px;">· ${done.length} known or waiting</span>` : ''}</summary>
            ${open.map(x => row(x, false)).join('')}${done.map(x => row(x, true)).join('')}</details>`;
    };
    $('leader-todos-list').innerHTML = todos.map((t, i) => t.group ? `<div style="${i ? 'border-top:1px solid var(--line);' : ''}">${group(t)}</div>` : `
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 0;${i ? 'border-top:1px solid var(--line);' : ''}">
            <span style="flex:1;min-width:220px;font-size:14px;">${esc(t.text)}</span>
            ${goLink(t)}
        </div>`).join('');
    panel.querySelectorAll('.lt-go').forEach(a => a.addEventListener('click', e => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        goToPage(a.dataset.page);
        if (a.dataset.anchor) setTimeout(() => { const el = document.getElementById(a.dataset.anchor); if (el) { if (el.tagName === 'DETAILS') el.open = true; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, 400);
    }));
    panel.querySelector('.lt-svc')?.addEventListener('toggle', e => { ltSvcOpen = e.target.open; });
    panel.querySelectorAll('.lt-known').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true;
        try { await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, action: 'todo-known', id: b.dataset.id, sig: b.dataset.sig, on: b.dataset.on === '1' }) }); } catch (e) { /* the list is read again below */ }
        loadLeaderTodos();
    }));
    // the red count in the menu: the Services group counts as ONE (and nothing when all of it is known)
    const counted = todos.filter(t => (t.group ? !t.known : true)).length;
    const nav = document.querySelector('.nav-item[data-page="dashboard"]');
    if (nav) {
        nav.querySelector('.todo-dot')?.remove();
        if (counted) { const s = document.createElement('span'); s.className = 'todo-dot'; s.textContent = counted; s.title = 'Things for leaders to do'; nav.appendChild(s); }
    }
    // and the numbers on the Join requests and Investment fund items (what is waiting there, not counting what is marked known)
    const flat = todos.flatMap(t => t.items || [t]).filter(t => !t.known);
    const joinNav = document.querySelector('.nav-item[data-page="join-requests"]'), jr = flat.find(t => t.id === 'join-requests'); // people who asked to join a program
    if (joinNav) {
        joinNav.querySelector('.todo-dot')?.remove();
        if (jr) { const s = document.createElement('span'); s.className = 'todo-dot'; s.textContent = jr.n || 1; s.title = 'Requests to join Labs waiting'; joinNav.appendChild(s); }
    }
    const fundNav = document.querySelector('.nav-item[data-page="fund"]'), fr = flat.find(t => t.id === 'fund-requests');
    if (fundNav) {
        fundNav.querySelector('.todo-dot')?.remove();
        if (fr) { const s = document.createElement('span'); s.className = 'todo-dot'; s.textContent = fr.n || 1; s.title = 'Investor requests waiting'; fundNav.appendChild(s); }
    }
}

// ---- Leader settings page: the Discord settings and the nightly saving live here (moved panels, same handlers) ----
async function loadLeaderSettings() {
    // Leader/Co-leader only end to end — Discord credentials, nightly saving, faction-share (see AUDIT.md).
    const locked = typeof canEditLeaderOnly === 'undefined' || !canEditLeaderOnly;
    $('ls-locked').style.display = locked ? 'block' : 'none';
    $('ls-body').style.display = locked ? 'none' : 'block';
    if (locked) return;
    $('av-discord-panel').style.display = 'block';
    loadAvDiscord();
    pcLoadNightly();
    loadBannerSettings();
}
document.querySelectorAll('.ls-link').forEach(a => a.addEventListener('click', e => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    goToPage(a.dataset.page);
    if (a.dataset.anchor) setTimeout(() => document.getElementById(a.dataset.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 400);
}));
