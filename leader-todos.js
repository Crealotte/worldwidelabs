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
// a link in a message must stand alone: Torn makes a ")", "." or "," stuck to it part of the link, and then it does not work (also cleans a message saved earlier)
const ltCleanLinks = text => String(text).replace(/(\(?)(https?:\/\/\S+)/g, (m, open, url, off, all) => { const core = url.replace(/[).,;:!?\]]+$/, ''), next = all.charAt(off + m.length); return core + (core !== url && next && !/\s/.test(next) ? ' ' : ''); });
const LT_OB_DEFAULTS = {
    discord: 'Hey, I have noticed you have not joined our Discord yet. It is one of the steps for becoming a Guinea Pig or Lab Rat, and it is where we plan wars and chat. Shout if you need the invite or any help!',
    intel: 'Hey, I have noticed your Intel is not set up yet. It is one of the steps for becoming a Guinea Pig or Lab Rat. Shout if you need help with it!',
    ocout: 'Hey, I have noticed you are not in an organized crime at the moment. Please join one that fits you: the OC page in Torn shows which slots are open, and on WWL you can ask for a spot. Shout if you need help!',
    ocnever: 'Hey, I have noticed you have not been in an organized crime yet. They give good rewards and respect, and we would love to have you in one. The OC page in Torn shows which slots are open, and on WWL you can ask for a spot. Shout if you need help!',
    cat: 'Hey, I have noticed CAT is not installed yet. It is our war tool and one of the steps for becoming a Guinea Pig or Lab Rat. Shout if you need help with it!',
};
const ltInviteDefault = kind => LT_OB_DEFAULTS[kind] ? LT_OB_DEFAULTS[kind] : kind === 'script'
    ? `Hey, I have noticed you have not installed the WWL script yet. You can install it from ${location.origin}/worldwidelabs.user.js and then it shows your to do list and energy plan right inside Torn. Note that the script is not this website: it is a separate add-on. You need Tampermonkey on a computer, or add it as a script in TornPDA. Shout if you get stuck!`
    : `Hey, I have noticed you have not logged into WWL yet. Please join at ${location.origin} with a limited API key. It takes a minute and gives you your energy plan, welcome chapters and more. Shout if you need help!`;
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
        const kind = b.dataset.kind, ta = b.closest('.lt-inv').querySelector('.lt-inv-msg'), text = ltCleanLinks(ta.value.replace(/\{name\}/g, b.dataset.name));
        try { await navigator.clipboard.writeText(text); } catch (e) { toast('Copy this message: ' + text); return; }
        try { localStorage.setItem(`wwl_invited_${kind}_${b.dataset.id}`, String(Date.now())); } catch (e) { /* not remembered */ }
        b.textContent = 'Copied ✓';
        const row = b.parentElement; row.style.opacity = '.6';
        if (!row.querySelector('.lt-inv-done')) { const s = document.createElement('span'); s.className = 'lt-inv-done'; s.style.cssText = 'color:var(--muted);font-size:11px;'; s.textContent = 'reminded today'; row.children[0].appendChild(document.createTextNode(' ')); row.children[0].appendChild(s); }
    }));
}

// ---- The onboarding overview: two sections (Recruit to Experiment B, and to Guinea Pig / Lab Rat). The counts are always in sight, the members are in the drop-down, each with a message to copy and a Notified button ----
const LT_OB_OPEN = {};
const LT_OB = {
    1: { title: 'Recruit → Experiment B', reqs: [['wwl', 'not on WWL'], ['script', 'on WWL without the script']] },
    2: { title: 'To Guinea Pig / Lab Rat', reqs: [['discord', 'without Discord'], ['intel', 'without Intel'], ['cat', 'without CAT']] },
    3: { title: 'Organized crimes', reqs: [['ocout', 'not in an OC now'], ['ocnever', 'with no OC in the last 30 days']] },
};
const ltObDate = ts => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
function ltObHtml(t) {
    const o = t.ob, def = LT_OB[o.stage], n = a => (a || []).length, past = o.past || [];
    // what a member still misses (for the list of the ones past their days)
    const missing = id => def.reqs.filter(([k]) => (o[k] || []).some(m => m.id === id)).map(([, label]) => label);
    const person = (m, k, isPast) => `<div class="lt-ob-row" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:5px 0;border-top:1px solid var(--line);"><span style="flex:1;min-width:170px;font-size:13px;">${isPast ? '<b style="color:#e05555;">!</b> ' : ''}<a href="https://www.torn.com/profiles.php?XID=${esc(m.id)}" target="_blank" rel="noopener" style="color:inherit;">${esc(m.name)}</a> <span style="color:var(--muted);font-size:11px;">${m.info ? esc(m.info) : m.days == null ? '' : `day ${m.days + 1}`}</span></span>${k ? `
            <button type="button" class="ghost small lt-ob-copy" data-kind="${k}" data-name="${esc(m.name)}" style="padding:4px 10px;">Copy message</button>
            <button type="button" class="ghost small lt-ob-notified" data-kind="${k}" data-id="${esc(m.id)}" data-on="${m.notified ? 1 : 0}" style="padding:4px 10px;${m.notified ? 'color:var(--reagent);border-color:var(--reagent);' : ''}">${m.notified ? `Notified ${ltObDate(m.notified)}` : 'Notified'}</button>` : `<span style="color:var(--muted);font-size:12px;">${esc(o.stage === 3 ? '' : missing(m.id).join(', '))}</span>`}</div>`;
    const pastIds = new Set(past.map(p => p.id));
    // one toggle per requirement: only the group you open expands, so the list never gets very long
    const reqBlock = ([k, label]) => {
        const c = n(o[k]), head = `${c} member${c === 1 ? '' : 's'} ${esc(label)}`, id = `${t.id}:${k}`;
        if (!c) return `<div style="font-size:13px;color:var(--muted);padding:3px 0 3px 18px;">${head}</div>`;
        return `<details class="lt-ob" data-id="${esc(id)}" ${LT_OB_OPEN[id] ? 'open' : ''} style="padding:2px 0;"><summary style="cursor:pointer;font-size:13px;padding:2px 0;">${head}</summary>
            <div style="padding:6px 0 4px 18px;"><div style="font-size:11px;color:var(--muted);margin-bottom:4px;">Message to copy:</div>
            <textarea class="lt-ob-msg" data-kind="${k}" rows="2" style="width:100%;box-sizing:border-box;font-size:12px;">${esc(ltInviteMsg(k))}</textarea>
            <div style="margin:4px 0 6px;"><button type="button" class="ghost small lt-inv-save" data-kind="${k}" style="padding:3px 10px;">Save message</button> <button type="button" class="ghost small lt-inv-reset" data-kind="${k}" style="padding:3px 10px;">Use the standard message</button> <span class="lt-inv-note" style="font-size:11px;color:var(--muted);"></span></div>
            ${o[k].map(m => person(m, k, pastIds.has(m.id))).join('')}</div></details>`;
    };
    const pastId = `${t.id}:past`, pastBlock = !n(past) ? '' : `<details class="lt-ob" data-id="${esc(pastId)}" ${LT_OB_OPEN[pastId] ? 'open' : ''} style="padding:2px 0;"><summary style="cursor:pointer;font-size:13px;padding:2px 0;color:#e05555;font-weight:600;">! ${n(past)} member${n(past) === 1 ? ' has' : 's have'} ${o.stage === 3 ? `been out of an OC for ${o.days} days or more` : `passed their ${o.days} days`}</summary>
        <div style="padding:2px 0 4px 18px;">${past.map(m => person(m, '', true)).join('')}</div></details>`;
    return `<div style="padding:8px 0;"><div style="margin-bottom:2px;"><b style="font-size:14px;">${esc(def.title)}</b> <span style="color:var(--muted);font-size:12px;">(${o.stage === 3 ? `${o.window} days looked at` : `${o.days} days`})</span></div>${o.stage === 3 && o.building ? '<div style="font-size:11px;color:var(--muted);margin:2px 0 4px 2px;">WWL is still reading the older crimes: some members may show as having none for now.</div>' : ''}${def.reqs.map(reqBlock).join('')}${pastBlock}</div>`;
}

function ltWireOb(panel) {
    panel.querySelectorAll('.lt-ob').forEach(d => d.addEventListener('toggle', () => { LT_OB_OPEN[d.dataset.id] = d.open; }));
    panel.querySelectorAll('.lt-ob-copy').forEach(b => b.addEventListener('click', async () => { // only copies: the leader decides when the member counts as notified
        const text = ltCleanLinks(b.closest('details').querySelector(`.lt-ob-msg[data-kind="${b.dataset.kind}"]`).value.replace(/\{name\}/g, b.dataset.name));
        try { await navigator.clipboard.writeText(text); b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = 'Copy message'; }, 1800); } catch (e) { toast('Copy this message: ' + text); }
    }));
    panel.querySelectorAll('.lt-ob-notified').forEach(b => b.addEventListener('click', async () => {
        const on = b.dataset.on !== '1';
        b.disabled = true;
        try {
            const r = await (await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, action: 'ob-notify', kind: b.dataset.kind, id: b.dataset.id, on }) })).json();
            if (r.error) throw new Error(r.error);
            b.dataset.on = on ? '1' : '0'; b.textContent = on ? `Notified ${ltObDate(Date.now())}` : 'Notified';
            b.style.color = on ? 'var(--reagent)' : ''; b.style.borderColor = on ? 'var(--reagent)' : '';
        } catch (e) { toast(e.message || 'Could not save that'); }
        b.disabled = false;
    }));
    panel.querySelectorAll('.lt-ob .lt-inv-save').forEach(b => b.addEventListener('click', () => {
        const ta = b.closest('details').querySelector(`.lt-ob-msg[data-kind="${b.dataset.kind}"]`), note = b.parentElement.querySelector('.lt-inv-note');
        try { localStorage.setItem(`wwl_invite_msg_${b.dataset.kind}`, ta.value); note.textContent = 'Saved.'; } catch (e) { note.textContent = 'Could not save in this browser.'; }
    }));
    panel.querySelectorAll('.lt-ob .lt-inv-reset').forEach(b => b.addEventListener('click', () => {
        const ta = b.closest('details').querySelector(`.lt-ob-msg[data-kind="${b.dataset.kind}"]`);
        try { localStorage.removeItem(`wwl_invite_msg_${b.dataset.kind}`); } catch (e) { /* nothing saved */ }
        ta.value = ltInviteDefault(b.dataset.kind); b.parentElement.querySelector('.lt-inv-note').textContent = 'Standard message back.';
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
    $('leader-todos-list').innerHTML = todos.map((t, i) => t.ob ? `<div style="${i ? 'border-top:1px solid var(--line);' : ''}">${ltObHtml(t)}</div>` : t.members ? `<div style="${i ? 'border-top:1px solid var(--line);' : ''}">${ltInviteHtml(t)}</div>` : t.group ?`<div style="${i ? 'border-top:1px solid var(--line);' : ''}">${group(t)}</div>` : `
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
    ltWireOb(panel);
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
