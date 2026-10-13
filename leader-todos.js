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

function renderLeaderTodos(todos) {
    const panel = $('leader-todos');
    panel.style.display = todos.length ? 'block' : 'none';
    $('leader-todos-list').innerHTML = todos.map((t, i) => `
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 0;${i ? 'border-top:1px solid var(--line);' : ''}">
            <span style="flex:1;min-width:220px;font-size:14px;">${esc(t.text)}</span>
            <a href="/${esc(t.page)}" class="ghost small lt-go" data-page="${esc(t.page)}" data-anchor="${esc(t.anchor || '')}" style="padding:6px 12px;border:1px solid var(--reagent);border-radius:var(--radius);color:var(--reagent);text-decoration:none;white-space:nowrap;">${esc(t.cta)} →</a>
        </div>`).join('');
    panel.querySelectorAll('.lt-go').forEach(a => a.addEventListener('click', e => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        goToPage(a.dataset.page);
        if (a.dataset.anchor) setTimeout(() => { const el = document.getElementById(a.dataset.anchor); if (el) { if (el.tagName === 'DETAILS') el.open = true; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, 400);
    }));
    // the red count in the menu
    const nav = document.querySelector('.nav-item[data-page="dashboard"]');
    if (nav) {
        nav.querySelector('.todo-dot')?.remove();
        if (todos.length) { const s = document.createElement('span'); s.className = 'todo-dot'; s.textContent = todos.length; s.title = 'Things for leaders to do'; nav.appendChild(s); }
    }
    // and the number of investor requests on the Investment fund item (the owner only gets that to do)
    const fundNav = document.querySelector('.nav-item[data-page="fund"]'), fr = todos.find(t => t.id === 'fund-requests');
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
