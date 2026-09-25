// ==UserScript==
// @name         World Wide Labs
// @namespace    https://worldwidelabs.vercel.app
// @author       CreaLotte
// @version      1.22
// @updateURL    __WWL_BASE__/worldwidelabs.user.js
// @downloadURL  __WWL_BASE__/worldwidelabs.user.js
// @description  Shows your WorldWideLabs weekly energy plan (the checklist from the Energy planner) inside Torn, a To do tab with small personal reminders (revive setting, feedback, timezone map), and — if you are in the Mentoring Platform — your mentoring checklist too. Also shows faction banners at the top of every Torn page. A small ⚙ in the header shows the installed version, flags when a newer one is out, lets you set/replace your API key, and — for a leader — add or remove your faction's banners right from Torn. On a computer it is a small window you can drag around and close; in TornPDA it is a menu. Ticks are shared with the WWL site.
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @connect      __WWL_HOST__
// ==/UserScript==

(function () {
    'use strict';
    if (window.top !== window.self || document.getElementById('wwl-energy-plan')) return; // not inside frames, and only once

    // The address of the WWL site (filled in when the script is installed from the WWL site).
    const WWL = ('__WWL_BASE__'.startsWith('http') ? '__WWL_BASE__' : 'https://worldwidelabs.vercel.app').replace(/\/$/, '');
    // Detected via TornPDA's own request bridge (which it injects regardless of any permission), not
    // an API-key placeholder — that placeholder made TornPDA ask to hand over the key the moment it
    // scans the script (effectively at install), before there's any normal page to explain why. The
    // key itself is now entered once via ⚙ Settings and remembered, same as on a computer.
    const IS_PDA = typeof PDA_httpPost === 'function';
    const KEY_NAME = 'wwl_api_key', POS_NAME = 'wwl_plan_pos', STATE_NAME = 'wwl_plan_state';
    // GM_info gives the version Tampermonkey actually has installed right now — falls back to a
    // hardcoded copy (kept in sync with @version above) for TornPDA, which doesn't grant GM_info.
    const SCRIPT_VERSION = (typeof GM_info !== 'undefined' && GM_info.script?.version) || '1.22';
    const versionGreater = (a, b) => {
        const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const x = pa[i] || 0, y = pb[i] || 0;
            if (x !== y) return x > y;
        }
        return false;
    };

    // The WWL "brand" icon (a flask), used everywhere the launcher shows itself, instead of a generic emoji.
    const VIAL_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#35d99b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;flex:none;"><line x1="9" y1="2" x2="15" y2="2"/><polyline points="9,2 9,8 4,20 20,20 15,8 15,2"/><line x1="6.3" y1="15" x2="17.7" y2="15"/></svg>';
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const num = n => Math.round(n).toLocaleString();
    const store = {
        get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* not saved */ } },
    };

    // Only ever a lookup — setting/changing the key is a deliberate action via ⚙ Settings → Change
    // API key (its own prompt() there), never automatic. A blocking prompt() firing the instant the
    // script loads used to catch people in screens where they have no way to get to their key at all
    // (e.g. right after adding the script in TornPDA).
    function getKey() {
        return store.get(KEY_NAME) || '';
    }
    // Sends the request through the userscript manager (Tampermonkey's GM_xmlhttpRequest, or TornPDA's own call), because Torn's page
    // is not always allowed to talk to another site directly. A plain fetch is only the last resort.
    function post(url, obj) {
        const data = JSON.stringify(obj), headers = { 'Content-Type': 'application/json' };
        if (typeof GM_xmlhttpRequest === 'function') {
            return new Promise((ok, no) => GM_xmlhttpRequest({
                method: 'POST', url, headers, data, timeout: 25000,
                onload: r => { try { ok(JSON.parse(r.responseText)); } catch (e) { no(new Error(`WWL answered with a problem (${r.status})`)); } },
                onerror: () => no(new Error('Could not reach WWL — check your connection, and that the script is allowed to connect to it')),
                ontimeout: () => no(new Error('WWL took too long to answer — try again')),
            }));
        }
        if (typeof PDA_httpPost === 'function') return PDA_httpPost(url, headers, data).then(r => JSON.parse(r.responseText));
        return fetch(url, { method: 'POST', headers, body: data }).then(r => r.json());
    }
    async function api(body) {
        const key = getKey();
        if (!key) throw new Error('NO_KEY');
        const r = await post(`${WWL}/api/war-payout`, { key, ...body });
        if (r.error) throw new Error(r.error);
        return r;
    }

    // ---- the pieces: a small button (always there), and the window (PC) / menu (TornPDA) it opens ----
    const root = document.createElement('div');
    root.id = 'wwl-energy-plan';
    root.style.cssText = 'font:13px/1.4 Arial,sans-serif;color:#e6e9ef;';
    document.body.appendChild(root);

    const pill = document.createElement('div'); // the closed state: a small button with the progress
    if (IS_PDA) {
        // A full text pill was too big and, parked bottom-right, sat behind Torn's own bottom button row
        // where it couldn't be tapped at all. A small round icon top-right instead — the to-do count
        // becomes a corner badge since there's no room left for the energy-fraction text.
        pill.style.cssText = 'position:fixed;top:8px;right:8px;z-index:99998;display:flex;align-items:center;justify-content:center;width:34px;height:34px;background:#1b2029;border:1px solid #35d99b;border-radius:50%;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.5);user-select:none;';
        pill.innerHTML = `${VIAL_SVG}<span id="wwl-prog" style="display:none;position:absolute;top:-4px;right:-4px;min-width:14px;height:14px;padding:0 2px;border-radius:8px;background:#f0b432;color:#1b2029;font:700 10px/14px Arial,sans-serif;text-align:center;align-items:center;justify-content:center;"></span>`;
    } else {
        pill.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99998;display:flex;gap:6px;align-items:center;padding:8px 12px;background:#1b2029;border:1px solid #35d99b;border-radius:20px;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,.5);user-select:none;';
        pill.innerHTML = `${VIAL_SVG}<b>WWL</b><span id="wwl-prog" style="color:#35d99b;font-family:monospace;"></span>`;
    }
    root.appendChild(pill);
    const prog = pill.querySelector('#wwl-prog');

    const win = document.createElement('div');
    if (IS_PDA) { // TornPDA: a menu that slides up from the bottom, big enough to tap
        win.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;max-height:75vh;display:none;flex-direction:column;background:#1b2029;border-top:2px solid #35d99b;border-radius:14px 14px 0 0;box-shadow:0 -4px 24px rgba(0,0,0,.6);font-size:15px;';
    } else { // computer: a floating window you can drag around and close
        win.style.cssText = 'position:fixed;z-index:99999;width:330px;max-width:94vw;max-height:75vh;display:none;flex-direction:column;background:#1b2029;border:1px solid #3a4352;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.55);';
    }
    win.innerHTML = `<div id="wwl-head" style="display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid #3a4352;${IS_PDA ? '' : 'cursor:move;touch-action:none;'}user-select:none;">
            <b style="flex:1;">WWL energy plan${IS_PDA ? '' : ' <span style="color:#9aa4b5;font-weight:400;font-size:11px;">— drag to move</span>'}</b>
            <span id="wwl-prog2" style="color:#35d99b;font-family:monospace;"></span>
            <span id="wwl-settings" title="Settings" style="cursor:pointer;font-size:16px;line-height:1;padding:0 4px;color:#9aa4b5;position:relative;">⚙<span id="wwl-settings-dot" style="display:none;position:absolute;top:-2px;right:-1px;width:7px;height:7px;border-radius:50%;background:#f0b432;"></span></span>
            <span id="wwl-close" title="Close" style="cursor:pointer;font-size:20px;line-height:1;padding:0 4px;">×</span></div>
        <div id="wwl-body" style="overflow:auto;padding:8px 12px 12px;"></div>`;
    root.appendChild(win);
    const body = win.querySelector('#wwl-body'), prog2 = win.querySelector('#wwl-prog2'), head = win.querySelector('#wwl-head');
    let plan = null, mtPairs = null, mtTodos = [], todoItems = null, tab = 'todo', lastTab = 'todo'; // tab: 'energy' | 'mentoring' | 'todo' | 'settings' — the mentoring tab only appears once we know there's something to show there
    let settingsData = null, updateAvailable = null; // settingsData: { banners, leader, owner } once the Settings tab has been opened

    // A daily ritual checkbox, always first on the To do tab, unlike the automated checks below it:
    // purely local (no server round trip needed for something this simple), and resets itself every
    // day rather than staying done forever once ticked.
    const DAILY_CHECK_NAME = 'wwl_daily_energy_check'; // { date: 'YYYY-MM-DD', checked }
    const todayStr = () => new Date().toISOString().slice(0, 10); // UTC = TCT, same convention as everywhere else in WWL
    function getDailyChecked() {
        try { const d = JSON.parse(store.get(DAILY_CHECK_NAME) || 'null'); return !!(d && d.date === todayStr() && d.checked); } catch (e) { return false; }
    }
    function setDailyChecked(v) { store.set(DAILY_CHECK_NAME, JSON.stringify({ date: todayStr(), checked: v })); }
    function todoCount() { return (todoItems ? todoItems.length : 0) + (getDailyChecked() ? 0 : 1); }

    // position (PC): remembered, and always kept inside the screen
    const place = (x, y) => {
        const w = win.offsetWidth || 330, h = Math.min(win.offsetHeight || 300, window.innerHeight);
        win.style.left = `${Math.max(0, Math.min(window.innerWidth - w, x))}px`;
        win.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, y))}px`;
    };
    function restorePos() {
        let p = null; try { p = JSON.parse(store.get(POS_NAME) || 'null'); } catch (e) { /* default */ }
        place(p ? p.x : 10, p ? p.y : 52);
    }
    if (!IS_PDA) {
        let drag = null;
        head.addEventListener('pointerdown', e => {
            if (e.target.id === 'wwl-close') return;
            drag = { dx: e.clientX - win.offsetLeft, dy: e.clientY - win.offsetTop };
            head.setPointerCapture(e.pointerId);
        });
        head.addEventListener('pointermove', e => { if (drag) place(e.clientX - drag.dx, e.clientY - drag.dy); });
        head.addEventListener('pointerup', () => { if (drag) { drag = null; store.set(POS_NAME, JSON.stringify({ x: win.offsetLeft, y: win.offsetTop })); } });
        window.addEventListener('resize', () => { if (win.style.display !== 'none') place(win.offsetLeft, win.offsetTop); });
    }

    // While the window sits open, nothing was re-checking Torn for these — a member could change their
    // revive setting and stare at a stale to-do list indefinitely with no idea a reload was needed.
    // Re-fetches just the to-do items (not the whole plan) every 15s while open, stops the moment it closes.
    let todoRefreshTimer = null;
    async function refreshTodoItems() {
        try { const r = await api({ action: 'member-todo' }); todoItems = r.items || []; if (tab === 'todo') render(); }
        catch (e) { /* keep showing what we already had */ }
    }
    let chatBarMounted = false; // once we're an icon in Torn's own chat bar (TornPDA only), the small pill stays hidden for good
    function setOpen(on, save = true) {
        win.style.display = on ? 'flex' : 'none';
        pill.style.display = (on || chatBarMounted) ? 'none' : 'flex';
        if (save) store.set(STATE_NAME, on ? 'open' : 'closed');
        clearInterval(todoRefreshTimer);
        if (on) { if (!IS_PDA) restorePos(); load(); todoRefreshTimer = setInterval(refreshTodoItems, 15000); }
    }
    pill.addEventListener('click', () => setOpen(true));
    win.querySelector('#wwl-close').addEventListener('click', () => setOpen(false));
    win.querySelector('#wwl-settings').addEventListener('click', () => {
        tab = 'settings';
        render();
        if (settingsData === null) loadSettings();
    });

    // ---- TornPDA only: also park an icon in Torn's own chat bar (Companies/Faction/Notes/People/
    // Settings, #chatRoot), next to the stable "Notes" button id (its wrapper `class` names are
    // build-hashed and change on any Torn deploy, so we never rely on those). Reports of this fighting
    // with the bar's drag-and-drop library (dnd-kit) turned out to only happen on a computer — on
    // TornPDA it's been solid, so it's re-added here scoped to IS_PDA only, keeping our own dark/green
    // look this time instead of copying Torn's own button style. Also nudges the slide-up window's
    // bottom edge above the bar's real height, since it was sliding in underneath/behind it.
    function mountChatBarIcon() {
        if (!IS_PDA || document.getElementById('wwl-chatbar-btn')) return true;
        const anchor = document.getElementById('notes_panel_button');
        const row = anchor?.parentElement;
        if (!anchor || !row) return false;
        const cs = getComputedStyle(anchor);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'wwl-chatbar-btn';
        btn.title = 'World Wide Labs';
        btn.style.cssText = `width:${cs.width};height:${cs.height};margin:${cs.margin};display:flex;align-items:center;justify-content:center;position:relative;box-sizing:border-box;background:#1b2029;border:2px solid #35d99b;border-radius:8px;cursor:pointer;padding:0;`;
        btn.innerHTML = VIAL_SVG +
            '<span id="wwl-chatbar-badge" style="display:none;position:absolute;top:-4px;right:-4px;min-width:14px;height:14px;padding:0 2px;border-radius:8px;background:#f0b432;color:#1b2029;font:700 10px/14px Arial,sans-serif;text-align:center;align-items:center;justify-content:center;"></span>';
        btn.addEventListener('click', e => { e.stopPropagation(); setOpen(true); });
        row.insertBefore(btn, anchor);
        chatBarMounted = true;
        pill.style.display = 'none';
        win.style.bottom = `${row.getBoundingClientRect().height}px`;
        showProgress();
        return true;
    }
    if (IS_PDA) { mountChatBarIcon(); setInterval(mountChatBarIcon, 3000); }

    function progress() {
        let done = 0, total = 0;
        for (const b of plan.blocks) for (const it of b.items) { total += it.value; if (plan.checks[it.key]) done += it.value; }
        return { done, total };
    }
    function showProgress() {
        const p = plan ? progress() : null;
        const energyText = p ? `${num(p.done)} / ${num(p.total)} E` : '';
        const n = todoCount();
        const todoBadge = n ? `<span style="color:#f0b432;" title="${n} to do">●${n}</span>` : '';
        prog2.innerHTML = [energyText, todoBadge].filter(Boolean).join(' ');
        if (IS_PDA) {
            prog.textContent = n; prog.style.display = n ? 'flex' : 'none';
            const cbBadge = document.getElementById('wwl-chatbar-badge');
            if (cbBadge) { cbBadge.textContent = n; cbBadge.style.display = n ? 'flex' : 'none'; }
        } else prog.innerHTML = [energyText, todoBadge].filter(Boolean).join(' ');
    }
    function tabBar() {
        const n = todoCount();
        const tabs = [['todo', `✅ To do${n ? ` (${n})` : ''}`], ['energy', '⚡ Energy']];
        if (mtPairs && mtPairs.length) tabs.push(['mentoring', '🎓 Mentoring']);
        if (tabs.length < 2) return '';
        return `<div style="display:flex;gap:6px;margin-bottom:10px;">${tabs.map(([id, label]) =>
            `<button type="button" class="wwl-tab" data-tab="${id}" style="flex:1;padding:6px;border-radius:6px;border:1px solid #3a4352;cursor:pointer;background:${tab === id ? '#2a2f3a' : 'transparent'};color:#e6e9ef;">${label}</button>`
        ).join('')}</div>`;
    }
    function wireTabs() {
        body.parentElement.querySelectorAll('.wwl-tab').forEach(b => b.addEventListener('click', () => { tab = lastTab = b.dataset.tab; render(); }));
    }
    function renderEnergyTab() {
        const footer = `<div style="margin-top:10px;padding-top:8px;border-top:1px solid #3a4352;color:#9aa4b5;">To change your settings (stat, method, candy, cans, refill), use the planner on the tool itself: <a href="${WWL}/energy" target="_blank" rel="noopener" style="color:#35d99b;">${esc(WWL)}/energy</a></div>`;
        if (!plan) return `<div style="padding:6px 0;color:#9aa4b5;">You have no plan yet. Open the Energy planner on WWL once, pick your method, and it will show up here.</div>${footer}`;
        const p = progress();
        const old = plan.week !== Math.floor(Date.now() / (7 * 86400e3)) ? '<div style="color:#f0b432;margin-bottom:6px;">This plan is from a previous week — open the planner on WWL to make a plan for this week.</div>' : '';
        const nextIdx = plan.blocks.findIndex(b => b.items.some(it => !plan.checks[it.key]));
        return `${old}<div style="color:#9aa4b5;margin-bottom:6px;">${esc(plan.summary)}</div>
            <div style="height:6px;background:#39414f;border-radius:3px;overflow:hidden;margin-bottom:8px;"><div style="height:100%;width:${p.total ? Math.min(100, p.done / p.total * 100) : 0}%;background:#35d99b;"></div></div>
            ${plan.blocks.map((b, i) => {
                const all = b.items.length && b.items.every(it => plan.checks[it.key]);
                return `<details ${i === nextIdx ? 'open' : ''} style="margin-bottom:4px;"><summary style="cursor:pointer;font-weight:700;padding:${IS_PDA ? 6 : 2}px 0;">${all ? '✅ ' : ''}${esc(b.title)}${i === nextIdx ? ' <span style="color:#35d99b;font-weight:400;">← next</span>' : ''}</summary>
                    ${b.note ? `<div style="color:#9aa4b5;margin:3px 0;">${esc(b.note)}</div>` : ''}
                    ${b.items.map(it => `<label style="display:flex;gap:8px;align-items:flex-start;padding:${IS_PDA ? 8 : 4}px 0;cursor:pointer;"><input type="checkbox" class="wwl-e-check" data-k="${esc(it.key)}" ${plan.checks[it.key] ? 'checked' : ''} style="margin-top:2px;"><span>${esc(it.label)}</span></label>`).join('')}</details>`;
            }).join('')}${footer}`;
    }
    // The mentoring to-dos: one section per pairing (a mentor with several pupils gets one each), each ticked
    // separately — same shared checklist the WWL page itself shows, just without the chat (open the site for that).
    function renderMentoringTab() {
        if (!mtPairs.length) return '<div style="padding:6px 0;color:#9aa4b5;">Not in a mentoring pair right now.</div>';
        return mtPairs.map(p => {
            const items = mtTodos.filter(t => t.role === 'both' || t.role === p.role);
            return `<div style="margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid #3a4352;">
                <div style="font-weight:700;margin-bottom:6px;">${p.role === 'mentor' ? `Mentoring ${esc(p.otherName)}` : `Your mentor: ${esc(p.otherName)}`}</div>
                ${items.length ? items.map(t => `<label style="display:flex;gap:8px;align-items:flex-start;padding:${IS_PDA ? 8 : 4}px 0;cursor:pointer;"><input type="checkbox" class="wwl-m-check" data-pair="${esc(p.pairId)}" data-id="${esc(t.id)}" ${p.done.includes(t.id) ? 'checked' : ''} style="margin-top:2px;"><span>${esc(t.text)}</span></label>`).join('')
                    : '<div style="color:#9aa4b5;">No checklist yet.</div>'}
            </div>`;
        }).join('') + `<div style="color:#9aa4b5;">Chat with them on the site: <a href="${WWL}/mentoring" target="_blank" rel="noopener" style="color:#35d99b;">${esc(WWL)}/mentoring</a></div>`;
    }
    // Small personal reminders — revive setting, feedback, timezone map — from api/war-payout.js's
    // 'member-todo' action. Each has an optional link (some open WWL in a new tab, the revive one
    // opens Torn's own Preferences page directly).
    function renderTodoTab() {
        const daily = `<label style="display:flex;gap:8px;align-items:center;padding:${IS_PDA ? 10 : 7}px 0;border-bottom:1px solid #3a4352;cursor:pointer;">
            <input type="checkbox" id="wwl-daily-check" ${getDailyChecked() ? 'checked' : ''} style="width:auto;">
            <span style="flex:1;">Check your energy plan</span>
        </label>`;
        const rest = todoItems === null ? '<div style="padding:6px 0;color:#9aa4b5;">Loading…</div>'
            : !todoItems.length ? ''
            : todoItems.map(t => `<div style="display:flex;gap:8px;align-items:center;padding:${IS_PDA ? 10 : 7}px 0;border-bottom:1px solid #3a4352;">
                <span style="flex:1;">${esc(t.text)}</span>
                ${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener" style="color:#35d99b;white-space:nowrap;text-decoration:none;border:1px solid #35d99b;border-radius:6px;padding:4px 8px;font-size:12px;">${esc(t.cta)}</a>` : ''}
            </div>`).join('');
        return daily + rest;
    }
    // The ⚙ view: version + update flag + API key, and — for a leader — the faction's own banners
    // (add/delete), reusing the exact same banners-get/save/delete actions Leader settings on the
    // site uses. Not in the main tab row (reached via the gear icon only); a "← Back" returns to
    // whichever real tab was open before.
    function renderBanEditList() {
        const list = settingsData?.banners || [];
        if (!list.length) return '<div style="color:#9aa4b5;font-size:12px;padding:4px 0;">No banners right now.</div>';
        return list.map(b => `<div style="display:flex;gap:8px;align-items:center;padding:5px 0;border-top:1px solid #3a4352;font-size:12px;">
            <span style="flex:1;">${esc(b.text)}</span>
            <span style="color:#9aa4b5;white-space:nowrap;">${b.scope === 'all' ? 'All factions' : 'My faction'} · ${b.audience === 'leaders' ? 'leaders' : 'everyone'}</span>
            <span class="wwl-ban-del" data-id="${esc(b.id)}" title="Delete" style="cursor:pointer;color:#e05555;">✕</span>
        </div>`).join('');
    }
    function renderSettingsTab() {
        const updateHtml = updateAvailable ? `<div style="color:#f0b432;margin:6px 0;">⬆ Update available: v${esc(updateAvailable)} — <a href="${WWL}/worldwidelabs.user.js" target="_blank" rel="noopener" style="color:#f0b432;">open the install link</a> and Tampermonkey will offer to update.</div>` : '';
        let html = `<button type="button" id="wwl-back" style="margin-bottom:10px;padding:4px 10px;border-radius:6px;border:1px solid #3a4352;background:transparent;color:#e6e9ef;cursor:pointer;">← Back</button>
            <div style="font-weight:700;margin-bottom:4px;">World Wide Labs v${esc(SCRIPT_VERSION)}</div>
            ${updateHtml}
            <button type="button" id="wwl-change-key" style="margin-top:4px;padding:6px 12px;border-radius:6px;border:1px solid #3a4352;background:transparent;color:#e6e9ef;cursor:pointer;">Change API key</button>`;
        if (settingsData === null) {
            html += '<div style="padding:10px 0;color:#9aa4b5;">Loading…</div>';
        } else if (settingsData.leader) {
            html += `<div style="border-top:1px solid #3a4352;margin-top:12px;padding-top:10px;">
                <div style="font-weight:700;margin-bottom:6px;">Banners</div>
                <div id="wwl-ban-list">${renderBanEditList()}</div>
                <div style="margin-top:10px;">
                    <textarea id="wwl-ban-text" placeholder="Banner text" rows="2" maxlength="280" style="width:100%;box-sizing:border-box;background:#11141a;color:#e6e9ef;border:1px solid #3a4352;border-radius:6px;padding:6px;margin-bottom:6px;resize:vertical;"></textarea>
                    <div style="display:flex;gap:6px;margin-bottom:6px;">
                        <select id="wwl-ban-tone" style="flex:1;background:#11141a;color:#e6e9ef;border:1px solid #3a4352;border-radius:6px;padding:4px;">
                            <option value="info">Info</option><option value="event">Event</option><option value="warn">Warning</option>
                        </select>
                        <select id="wwl-ban-audience" style="flex:1;background:#11141a;color:#e6e9ef;border:1px solid #3a4352;border-radius:6px;padding:4px;">
                            <option value="all">Everyone</option><option value="leaders">Leaders only</option>
                        </select>
                    </div>
                    <label style="display:block;font-size:11px;color:#9aa4b5;margin-bottom:2px;">Ends (optional)</label>
                    <input id="wwl-ban-expires" type="date" style="width:100%;box-sizing:border-box;background:#11141a;color:#e6e9ef;border:1px solid #3a4352;border-radius:6px;padding:4px;margin-bottom:8px;">
                    <button type="button" id="wwl-ban-add" style="width:100%;padding:6px;border-radius:6px;border:1px solid #35d99b;background:transparent;color:#35d99b;cursor:pointer;">+ Add banner</button>
                    <div id="wwl-ban-status" style="margin-top:6px;font-size:12px;"></div>
                </div>
            </div>`;
        }
        return html;
    }
    async function loadSettings() {
        try { settingsData = await api({ action: 'banners-get', manage: true }); }
        catch (e) { settingsData = { banners: [], leader: false, owner: false }; } // not a leader, or a hiccup — just hide the banner section
        if (tab === 'settings') render();
    }
    function wireSettingsTab() {
        body.querySelector('#wwl-back')?.addEventListener('click', () => { tab = lastTab; render(); });
        body.querySelector('#wwl-change-key')?.addEventListener('click', () => {
            const current = store.get(KEY_NAME) || '';
            const masked = current ? `${current.slice(0, 4)}…${current.slice(-4)}` : 'not set';
            const input = prompt(`World Wide Labs v${SCRIPT_VERSION}\n\nCurrent API key: ${masked}\n\nPaste a new key to replace it, or leave blank to keep the current one.`, '');
            if (input === null) return;
            const trimmed = input.trim();
            if (!trimmed) return;
            store.set(KEY_NAME, trimmed);
            load();
        });
        body.querySelectorAll('.wwl-ban-del').forEach(x => x.addEventListener('click', async () => {
            if (!confirm('Delete this banner?')) return;
            try { await api({ action: 'banners-delete', id: x.dataset.id }); loadSettings(); }
            catch (e) { alert(`Couldn't delete that: ${e.message}`); }
        }));
        body.querySelector('#wwl-ban-add')?.addEventListener('click', async () => {
            const st = body.querySelector('#wwl-ban-status'), btn = body.querySelector('#wwl-ban-add');
            const text = body.querySelector('#wwl-ban-text').value.trim();
            if (text.length < 3) { st.style.color = '#e05555'; st.textContent = 'Write the banner text first.'; return; }
            btn.disabled = true;
            try {
                await api({
                    action: 'banners-save', text, scope: 'faction',
                    tone: body.querySelector('#wwl-ban-tone').value, audience: body.querySelector('#wwl-ban-audience').value,
                    expires: body.querySelector('#wwl-ban-expires').value, page: '', linkLabel: '', icon: '', countdownAt: 0,
                });
                loadSettings();
            } catch (e) { st.style.color = '#e05555'; st.textContent = e.message; btn.disabled = false; }
        });
    }
    function render() {
        if (tab === 'settings') { body.innerHTML = renderSettingsTab(); wireSettingsTab(); return; }
        body.innerHTML = tabBar() + (tab === 'mentoring' ? renderMentoringTab() : tab === 'todo' ? renderTodoTab() : renderEnergyTab());
        showProgress();
        wireTabs();
        body.querySelector('#wwl-daily-check')?.addEventListener('change', e => { setDailyChecked(e.target.checked); render(); });
        body.querySelectorAll('.wwl-e-check').forEach(cb => cb.addEventListener('change', async () => {
            if (cb.checked) plan.checks[cb.dataset.k] = true; else delete plan.checks[cb.dataset.k];
            showProgress();
            try { await api({ action: 'plan-check', step: cb.dataset.k, checked: cb.checked }); } catch (e) { /* shown on next load */ }
        }));
        body.querySelectorAll('.wwl-m-check').forEach(cb => cb.addEventListener('change', async () => {
            const [mentorId, pupilId] = cb.dataset.pair.split(':');
            const p = mtPairs.find(x => x.pairId === cb.dataset.pair);
            if (cb.checked) p.done = [...new Set([...p.done, cb.dataset.id])]; else p.done = p.done.filter(id => id !== cb.dataset.id);
            try { await api({ action: 'mentor-todo-toggle', mentorId, pupilId, todoId: cb.dataset.id, checked: cb.checked }); } catch (e) { /* shown on next load */ }
        }));
    }
    async function load() {
        body.innerHTML = '<div style="padding:6px 0;color:#9aa4b5;">Loading…</div>';
        try {
            const [planR, mtR, todoR] = await Promise.all([
                api({ action: 'plan-get' }),
                api({ action: 'mentor-my-status' }).catch(() => null), // fine if this member isn't in the program at all
                api({ action: 'member-todo' }).catch(() => null),
            ]);
            plan = planR.plan; store.set('wwl_plan_cache', JSON.stringify({ at: Date.now(), plan }));
            mtPairs = mtR?.pairs || []; mtTodos = mtR?.todos || [];
            todoItems = todoR?.items || [];
            render();
        } catch (e) {
            if (e.message === 'NO_KEY') {
                body.innerHTML = `<div style="padding:6px 0;color:#9aa4b5;">No API key set yet.</div>
                    <button type="button" id="wwl-setup-key" style="padding:6px 12px;border-radius:6px;border:1px solid #35d99b;background:transparent;color:#35d99b;cursor:pointer;">⚙ Set up API key</button>`;
                body.querySelector('#wwl-setup-key').addEventListener('click', () => { tab = 'settings'; render(); if (settingsData === null) loadSettings(); });
                return;
            }
            body.innerHTML = `<div style="padding:6px 0;color:#e05555;">${esc(e.message)}</div>`;
        }
    }

    // start: closed as a small button (or open again if it was left open, and on the gym page the first time)
    const onGym = /\/gym\.php/.test(location.pathname);
    const last = store.get(STATE_NAME);
    setOpen(last ? last === 'open' : onGym && !IS_PDA, false);
    // the small button only needs a peek: use what was saved in the last 10 minutes, so ordinary page loads cost no calls
    let cached = null; try { cached = JSON.parse(store.get('wwl_plan_cache') || 'null'); } catch (e) { /* none */ }
    if (cached?.plan) { plan = cached.plan; showProgress(); }
    if (last !== 'open' && getKey() && !(cached && Date.now() - cached.at < 600000)) {
        Promise.all([api({ action: 'plan-get' }), api({ action: 'member-todo' }).catch(() => null)])
            .then(([r, todoR]) => {
                plan = r.plan; if (todoR) todoItems = todoR.items || [];
                showProgress();
                store.set('wwl_plan_cache', JSON.stringify({ at: Date.now(), plan }));
            }).catch(() => {});
    }

    // "I'm here" check-in for Who's on board's Userscript column — a real signal, throttled to about
    // once an hour per browser so it reflects actual use, not just having installed it once.
    const CHECKIN_NAME = 'wwl_script_checkin_at';
    const lastCheckin = Number(store.get(CHECKIN_NAME) || 0);
    if (getKey() && Date.now() - lastCheckin > 3600000) {
        store.set(CHECKIN_NAME, String(Date.now()));
        api({ action: 'script-checkin' }).catch(() => {});
    }

    // Tampermonkey's own @updateURL check only runs on its own schedule in the background and never
    // surfaces anything inside the script itself. This flags a newer version proactively (checked
    // every ~6 hours) by reading the live file's own @version line — actually applying the update
    // still needs Tampermonkey (or the install link), this just makes it visible sooner.
    const UPDATE_CHECK_NAME = 'wwl_update_check';
    function markUpdateAvailable(v) {
        updateAvailable = v;
        const dot = win.querySelector('#wwl-settings-dot');
        if (dot) dot.style.display = v ? 'block' : 'none';
        if (tab === 'settings') render();
    }
    let updateCached = null; try { updateCached = JSON.parse(store.get(UPDATE_CHECK_NAME) || 'null'); } catch (e) { /* none */ }
    if (updateCached?.remote && versionGreater(updateCached.remote, SCRIPT_VERSION)) markUpdateAvailable(updateCached.remote);
    if (!IS_PDA && typeof GM_xmlhttpRequest === 'function' && !(updateCached && Date.now() - updateCached.at < 6 * 3600000)) {
        GM_xmlhttpRequest({
            method: 'GET', url: `${WWL}/worldwidelabs.user.js`, timeout: 15000,
            onload: r => {
                const m = /@version\s+([\d.]+)/.exec(r.responseText);
                const remote = m ? m[1] : null;
                store.set(UPDATE_CHECK_NAME, JSON.stringify({ at: Date.now(), remote }));
                if (remote && versionGreater(remote, SCRIPT_VERSION)) markUpdateAvailable(remote);
            },
            onerror: () => {}, ontimeout: () => {},
        });
    }

    // ---- Torn-wide banners: the same ones a leader sets in Leader settings → Banners on the WWL
    // site, shown here too since faction messages posted in Torn's own event feed get lost. Inserted
    // in normal document flow (not a fixed overlay) at the very top of the page, so it pushes Torn's
    // own content down rather than risking covering anything. Re-checked every ~10 minutes.
    const BAN_DISMISS_NAME = 'wwl_tornban_dismissed'; // { bannerId: hash of its text }
    const banHash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); };
    const banDismissed = () => { try { return JSON.parse(store.get(BAN_DISMISS_NAME) || '{}'); } catch (e) { return {}; } };
    const BAN_TONE_COLORS = { info: '#4da3ff', event: '#35d99b', warn: '#f0b432' };
    const BAN_HEIGHT = 40; // fixed single-line height — the whole point is this never changes, so the page never shifts
    const marqueeStyle = document.createElement('style');
    marqueeStyle.textContent = '@keyframes wwl-marquee { from { transform: translateX(0); } to { transform: translateX(var(--wwl-dist)); } }';
    document.head.appendChild(marqueeStyle);
    const banBar = document.createElement('div');
    banBar.id = 'wwl-torn-banner';
    banBar.style.cssText = 'display:none;position:relative;z-index:99990;font:13px/1.4 Arial,sans-serif;';
    document.body.insertBefore(banBar, document.body.firstChild);
    let banList = [], banIdx = 0, banTimer = null;
    // The pill uses a fixed "top" — it doesn't know the banner is there, so once one renders it would
    // otherwise sit half-covered by it. Repositioned to sit just below the banner's actual height
    // every time it changes (left for a computer, right on TornPDA — either way, just needs pushing down).
    function repositionForBanner() {
        const h = banBar.style.display === 'none' ? 0 : banBar.offsetHeight;
        pill.style.top = `${h + 8}px`;
    }
    function renderTornBanner() {
        const gone = banDismissed();
        const shown = banList.filter(b => gone[b.id] !== banHash(b.text));
        clearInterval(banTimer);
        if (!shown.length) { banBar.style.display = 'none'; banBar.innerHTML = ''; repositionForBanner(); return; }
        banIdx = Math.min(banIdx, shown.length - 1);
        const b = shown[banIdx];
        const color = BAN_TONE_COLORS[b.tone] || BAN_TONE_COLORS.info;
        banBar.style.display = 'block';
        // Always exactly one line, height fixed — a banner that's too long to fit scrolls sideways
        // instead of wrapping, so rotating between a short and a long banner (or between different
        // TornPDA screen widths) never shifts the page. Overflow itself is measured and the scroll
        // distance/speed set below, once this is actually in the DOM.
        banBar.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:0 14px;height:${BAN_HEIGHT}px;box-sizing:border-box;overflow:hidden;background:${color}22;border-bottom:2px solid ${color};color:#e6e9ef;">
            ${b.icon ? `<span style="flex:none;font-size:16px;">${esc(b.icon)}</span>` : ''}
            <div class="wwl-ban-textwrap" style="flex:1;min-width:0;overflow:hidden;height:100%;display:flex;align-items:center;">
                <span class="wwl-ban-textinner" style="white-space:nowrap;">${esc(b.text)}</span>
            </div>
            ${shown.length > 1 ? `<span style="flex:none;font-size:11px;color:#9aa4b5;">${banIdx + 1}/${shown.length}</span>` : ''}
            ${b.page ? `<a href="${WWL}/${esc(b.page)}" target="_blank" rel="noopener" style="flex:none;color:${color};text-decoration:none;border:1px solid ${color};border-radius:6px;padding:3px 10px;font-size:12px;white-space:nowrap;">${esc(b.linkLabel || 'Open')} ↗</a>` : ''}
            <span class="wwl-ban-x" title="Close" style="flex:none;cursor:pointer;font-size:16px;line-height:1;color:#9aa4b5;padding:0 2px;">×</span>
        </div>`;
        const textWrap = banBar.querySelector('.wwl-ban-textwrap'), textInner = banBar.querySelector('.wwl-ban-textinner');
        if (textInner.scrollWidth > textWrap.clientWidth + 2) {
            const dist = -(textInner.scrollWidth - textWrap.clientWidth) - 16;
            const duration = Math.max(6, Math.abs(dist) / 40); // ~40px/s, at least 6s so short overflow isn't jarring
            textInner.style.setProperty('--wwl-dist', `${dist}px`);
            textInner.style.animation = `wwl-marquee ${duration}s ease-in-out 1s infinite alternate`;
        } else {
            textWrap.style.justifyContent = 'center';
            textInner.style.cssText += 'width:100%;text-align:center;';
        }
        banBar.querySelector('.wwl-ban-x').addEventListener('click', () => {
            const d = banDismissed(); d[b.id] = banHash(b.text);
            store.set(BAN_DISMISS_NAME, JSON.stringify(d));
            renderTornBanner();
        });
        if (shown.length > 1) banTimer = setInterval(() => { banIdx = (banIdx + 1) % shown.length; renderTornBanner(); }, 7000);
        repositionForBanner();
    }
    const BAN_CACHE_NAME = 'wwl_torn_banners_cache';
    let banCached = null; try { banCached = JSON.parse(store.get(BAN_CACHE_NAME) || 'null'); } catch (e) { /* none */ }
    if (banCached?.banners) { banList = banCached.banners; renderTornBanner(); }
    if (getKey() && !(banCached && Date.now() - banCached.at < 600000)) {
        api({ action: 'banners-get' }).then(r => {
            banList = r.banners || [];
            store.set(BAN_CACHE_NAME, JSON.stringify({ at: Date.now(), banners: banList }));
            renderTornBanner();
        }).catch(() => {});
    }
})();
