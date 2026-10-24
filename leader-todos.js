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

// ---- Friendly reminders for members who are not on WWL yet or did not install the script: the same layout as the other to dos, a message to copy for each member ----
// The message is the leader's own (kept in this browser); The default text has no name in it, so it can be pasted as it is (a {name} in your own text still becomes the member's name). A member whose message was copied shows "reminded <date>" so nobody is nagged twice.
const LT_INVITE_OPEN = {};
const ltInviteDefault = kind => kind === 'script'
    ? `Hey, I have noticed you have not installed the WWL script yet (${location.origin}/worldwidelabs.user.js). Please install it: it shows your to do list and energy plan right inside Torn. Note that the script is not this website: it is a separate add-on. You need Tampermonkey on a computer, or add it as a script in TornPDA. Shout if you get stuck!`
    : `Hey, I have noticed you have not logged into WWL yet (${location.origin}), please join with a limited API key. It takes a minute and gives you your energy plan, welcome chapters and more. Shout if you need help!`;
const ltInviteMsg = kind => { try { return localStorage.getItem(`wwl_invite_msg_${kind}`) || ltInviteDefault(kind); } catch (e) { return ltInviteDefault(kind); } };
const ltRemindedAt = (kind, id) => { try { return Number(localStorage.getItem(`wwl_invited_${kind}_${id}`)) || 0; } catch (e) { return 0; } };
function ltInviteHtml(t) {
    const kind = t.kind === 'script' ? 'script' : 'wwl', title = kind === 'script' ? 'on WWL but did not install the script yet' : 'have not logged into WWL yet';
    const rows = t.members.map(m => { const at = ltRemindedAt(kind, m.id); return `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:6px 0 6px 12px;border-top:1px solid var(--line);${at ? 'opacity:.6;' : ''}"><span style="flex:1;min-width:180px;font-size:13px;">${esc(m.name)} <span style="color:var(--muted);font-size:11px;">[${esc(m.id)}]</span>${at ? ` <span style="color:var(--muted);font-size:11px;">reminded ${esc(new Date(at).toLocaleDateString())}</span>` : ''}</span>
        <button type="button" class="ghost small lt-inv-copy" data-kind="${kind}" data-id="${esc(m.id)}" data-name="${esc(m.name)}" style="padding:4px 10px;">Copy message</button>
        <a href="https://www.torn.com/profiles.php?XID=${esc(m.id)}" target="_blank" rel="noopener" class="ghost small" style="padding:4px 10px;border:1px solid var(--line);border-radius:var(--radius);text-decoration:none;color:var(--muted);">Profile</a></div>`; }).join('');
    return `<details class="lt-inv" data-kind="${kind}" ${LT_INVITE_OPEN[kind] ? 'open' : ''} style="padding:8px 0;"><summary class="av-sum" style="cursor:pointer;font-size:14px;list-style:none;"><b>👋 ${t.members.length} member${t.members.length === 1 ? '' : 's'} ${title}</b> <span style="color:var(--muted);font-size:12px;">(click to see who, with a friendly message to copy)</span></summary>
        <div style="padding:8px 0 4px 12px;"><div style="font-size:11px;color:var(--muted);margin-bottom:4px;">Your message (this exact text is copied):</div>
            <textarea class="lt-inv-msg" data-kind="${kind}" rows="3" style="width:100%;box-sizing:border-box;font-size:12px;">${esc(ltInviteMsg(kind))}</textarea>
            <div style="margin:4px 0 6px;"><button type="button" class="ghost small lt-inv-save" data-kind="${kind}" style="padding:3px 10px;">Save message</button> <button type="button" class="ghost small lt-inv-reset" data-kind="${kind}" style="padding:3px 10px;">Use the standard message</button> <span class="lt-inv-note" style="font-size:11px;color:var(--muted);"></span></div></div>
        ${rows}</details>`;
}
function ltWireInvites(panel) {
    panel.querySelectorAll('.lt-inv').forEach(d => d.addEventListener('toggle', () => { LT_INVITE_OPEN[d.dataset.kind] = d.open; }));
    panel.querySelectorAll('.lt-inv-save').forEach(b => b.addEventListener('click', () => {
        const box = b.closest('.lt-inv'), ta = box.querySelector('.lt-inv-msg');
        try { localStorage.setItem(`wwl_invite_msg_${b.dataset.kind}`, ta.value); box.querySelector('.lt-inv-note').textContent = 'Saved.'; } catch (e) { box.querySelector('.lt-inv-note').textContent = 'Could not save in this browser.'; }
    }));
    panel.querySelectorAll('.lt-inv-reset').forEach(b => b.addEventListener('click', () => {
        const box = b.closest('.lt-inv'); try { localStorage.removeItem(`wwl_invite_msg_${b.dataset.kind}`); } catch (e) { /* nothing saved */ }
        box.querySelector('.lt-inv-msg').value = ltInviteDefault(b.dataset.kind); box.querySelector('.lt-inv-note').textContent = 'Standard message back.';
    }));
    panel.querySelectorAll('.lt-inv-copy').forEach(b => b.addEventListener('click', async () => {
        const kind = b.dataset.kind, ta = b.closest('.lt-inv').querySelector('.lt-inv-msg'), text = ta.value.replace(/\{name\}/g, b.dataset.name);
        try { await navigator.clipboard.writeText(text); } catch (e) { toast('Copy this message: ' + text); return; }
        try { localStorage.setItem(`wwl_invited_${kind}_${b.dataset.id}`, String(Date.now())); } catch (e) { /* not remembered */ }
        b.textContent = 'Copied ✓';
        const row = b.parentElement; row.style.opacity = '.6';
        if (!row.querySelector('.lt-inv-done')) { const s = document.createElement('span'); s.className = 'lt-inv-done'; s.style.cssText = 'color:var(--muted);font-size:11px;'; s.textContent = 'reminded today'; row.children[0].appendChild(document.createTextNode(' ')); row.children[0].appendChild(s); }
    }));
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
    $('leader-todos-list').innerHTML = todos.map((t, i) => t.members ? `<div style="${i ? 'border-top:1px solid var(--line);' : ''}">${ltInviteHtml(t)}</div>` : t.group ?`<div style="${i ? 'border-top:1px solid var(--line);' : ''}">${group(t)}</div>` : `
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
    ltWireInvites(panel);
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
