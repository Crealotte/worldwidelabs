// ==UserScript==
// @name         World Wide Labs
// @namespace    https://worldwidelabs.vercel.app
// @author       CreaLotte
// @version      1.48
// @updateURL    __WWL_BASE__/worldwidelabs.user.js
// @downloadURL  __WWL_BASE__/worldwidelabs.user.js
// @description  Shows your WorldWideLabs weekly energy plan (the checklist from the Energy planner) inside Torn, a To do tab with small personal reminders (revive setting, feedback, timezone map, availability, Discord/Intel/CAT), your My Targets list, a simplified energy/war standing strip, and — if you are in the Mentoring Platform — your mentoring checklist too. Also shows faction banners at the top of every Torn page. A small ⚙ in the header shows the installed version, flags when a newer one is out, lets you set/replace your API key, and — for a leader — add or remove your faction's banners right from Torn. On a computer it is a small window you can drag around and close; in TornPDA it is a menu. Ticks are shared with the WWL site.
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
    const SCRIPT_VERSION = (typeof GM_info !== 'undefined' && GM_info.script?.version) || '1.48';
    const versionGreater = (a, b) => {
        const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const x = pa[i] || 0, y = pb[i] || 0;
            if (x !== y) return x > y;
        }
        return false;
    };

    // The WWL "brand" icon (a flask), used everywhere the launcher shows itself, instead of a generic emoji.
    // Takes a size since it's used both small (badges) and at Torn's own header-icon size.
    const vialSvg = (size = 16) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="#35d99b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;flex:none;"><line x1="9" y1="2" x2="15" y2="2"/><polyline points="9,2 9,8 4,20 20,20 15,8 15,2"/><line x1="6.3" y1="15" x2="17.7" y2="15"/></svg>`;
    const VIAL_SVG = vialSvg();
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

    const PILL_TOP = 60; // clears Torn's own logo in the top-left corner on a computer (see note below)
    const pill = document.createElement('div'); // the closed state: a small button with the progress
    if (IS_PDA) {
        // A full text pill was too big and, parked bottom-right, sat behind Torn's own bottom button row
        // where it couldn't be tapped at all. A small round icon top-right instead — the to-do count
        // becomes a corner badge since there's no room left for the energy-fraction text.
        pill.style.cssText = 'position:fixed;top:8px;right:8px;z-index:99998;display:flex;align-items:center;justify-content:center;width:34px;height:34px;background:#1b2029;border:1px solid #35d99b;border-radius:50%;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.5);user-select:none;';
        pill.innerHTML = `${VIAL_SVG}<span id="wwl-prog" style="display:none;position:absolute;top:-4px;right:-4px;min-width:14px;height:14px;padding:0 2px;border-radius:8px;background:#f0b432;color:#1b2029;font:700 10px/14px Arial,sans-serif;text-align:center;align-items:center;justify-content:center;"></span>`;
    } else {
        // top:8px used to sit right on top of Torn's own logo in the corner — nudged down to clear it.
        // A visual estimate from a screenshot, not a measured value, so it may still need adjusting.
        pill.style.cssText = `position:fixed;left:8px;top:${PILL_TOP}px;z-index:99998;display:flex;gap:6px;align-items:center;padding:8px 12px;background:#1b2029;border:1px solid #35d99b;border-radius:20px;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,.5);user-select:none;`;
        pill.innerHTML = `${VIAL_SVG}<b>WWL</b><span id="wwl-prog" style="color:#35d99b;font-family:monospace;"></span>`;
    }
    root.appendChild(pill);
    const prog = pill.querySelector('#wwl-prog');
    // a small amber dot on the closed button while an update is waiting, so it is visible without opening anything
    const pillDot = document.createElement('span');
    pillDot.title = 'Update available';
    pillDot.style.cssText = 'display:none;position:absolute;top:-4px;right:-4px;width:11px;height:11px;border-radius:50%;background:#f0b432;border:2px solid #1b2029;';
    pill.appendChild(pillDot);
    // The closed button can be dragged anywhere (computer and TornPDA) and the spot is remembered — for people it sits on top of
    // something in the game. A press that barely moves still counts as a click and opens the window.
    const PILL_POS_NAME = 'wwl_pill_pos';
    let pillDragged = false;
    const placePill = (x, y) => {
        const w = pill.offsetWidth || 40, h = pill.offsetHeight || 34;
        pill.style.left = `${Math.max(0, Math.min(window.innerWidth - w, x))}px`;
        pill.style.top = `${Math.max(0, Math.min(window.innerHeight - h, y))}px`;
        pill.style.right = 'auto'; pill.style.bottom = 'auto';
    };
    pill.style.touchAction = 'none'; // so a finger drag moves the button instead of scrolling the page
    try { const p = JSON.parse(store.get(PILL_POS_NAME) || 'null'); if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) placePill(p.x, p.y); } catch (e) { /* default spot */ }
    {
        let drag = null;
        pill.addEventListener('pointerdown', e => {
            const r = pill.getBoundingClientRect();
            drag = { sx: e.clientX, sy: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
            try { pill.setPointerCapture(e.pointerId); } catch (err) { /* fine without capture */ }
        });
        pill.addEventListener('pointermove', e => {
            if (!drag) return;
            if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return; // still a click
            drag.moved = true;
            placePill(e.clientX - drag.dx, e.clientY - drag.dy);
        });
        pill.addEventListener('pointerup', () => {
            if (drag && drag.moved) { pillDragged = true; setTimeout(() => { pillDragged = false; }, 60); store.set(PILL_POS_NAME, JSON.stringify({ x: pill.offsetLeft, y: pill.offsetTop })); }
            drag = null;
        });
        pill.addEventListener('pointercancel', () => { drag = null; });
        window.addEventListener('resize', () => { if (pill.style.left) placePill(pill.offsetLeft, pill.offsetTop); });
    }

    const win = document.createElement('div');
    if (IS_PDA) { // TornPDA: a menu that slides up from the bottom, big enough to tap
        win.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;max-height:75vh;display:none;flex-direction:column;background:#1b2029;border-top:2px solid #35d99b;border-radius:14px 14px 0 0;box-shadow:0 -4px 24px rgba(0,0,0,.6);font-size:15px;';
    } else { // computer: a floating window you can drag around and close
        win.style.cssText = 'position:fixed;z-index:99999;width:330px;max-width:94vw;max-height:75vh;display:none;flex-direction:column;background:#1b2029;border:1px solid #3a4352;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.55);';
    }
    win.innerHTML = `<div id="wwl-head" style="display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid #3a4352;${IS_PDA ? '' : 'cursor:move;touch-action:none;'}user-select:none;">
            <b style="flex:1;">World Wide Labs${IS_PDA ? '' : ' <span style="color:#9aa4b5;font-weight:400;font-size:11px;">— drag to move</span>'}</b>
            <span id="wwl-prog2" style="color:#35d99b;font-family:monospace;"></span>
            <span id="wwl-settings" title="Settings" style="cursor:pointer;font-size:16px;line-height:1;padding:0 4px;color:#9aa4b5;position:relative;">⚙<span id="wwl-settings-dot" style="display:none;position:absolute;top:-2px;right:-1px;width:7px;height:7px;border-radius:50%;background:#f0b432;"></span></span>
            <span id="wwl-close" title="Close" style="cursor:pointer;font-size:20px;line-height:1;padding:0 4px;">×</span></div>
        <div id="wwl-body" style="overflow:auto;padding:8px 12px 12px;"></div>`;
    root.appendChild(win);
    const body = win.querySelector('#wwl-body'), prog2 = win.querySelector('#wwl-prog2'), head = win.querySelector('#wwl-head');
    let plan = null, mtPairs = null, mtTodos = [], mtIsPupil = false, welMine = null, welPupils = {}, welInsights = {}, welOpen = {}, todoItems = null, tab = 'todo', lastTab = 'todo'; // tab: 'energy' | 'mentoring' | 'todo' | 'settings' | 'targets' — the mentoring tab only appears once we know there's something to show there
    let settingsData = null, updateAvailable = null; // settingsData: { banners, leader, owner } once the Settings tab has been opened
    let standing = null; // from 'mo-me' — the same numbers the site's "Your standing" dashboard card shows
    let myTargets = null, targetStatus = {}; // My Targets list + live status, fetched separately (status can lag behind the list)

    // A daily ritual checkbox, always first on the To do tab, unlike the automated checks below it:
    // purely local (no server round trip needed for something this simple), and resets itself every
    // day rather than staying done forever once ticked.
    const DAILY_CHECK_NAME = 'wwl_daily_energy_check'; // { date: 'YYYY-MM-DD', checked }
    const todayStr = () => new Date().toISOString().slice(0, 10); // UTC = TCT, same convention as everywhere else in WWL
    // while the faction stacks for a war or is in a war / chain plan nobody trains: the server says so (until when, and why) and the daily check of the energy plan is done by itself
    let energyPause = null;
    const energyPaused = () => !!(energyPause && energyPause.until * 1000 > Date.now());
    function getDailyChecked() {
        if (energyPaused()) return true;
        try { const d = JSON.parse(store.get(DAILY_CHECK_NAME) || 'null'); return !!(d && d.date === todayStr() && d.checked); } catch (e) { return false; }
    }
    function setDailyChecked(v) { store.set(DAILY_CHECK_NAME, JSON.stringify({ date: todayStr(), checked: v })); }
    // how many OC and bank requests wait (each item says how many): the red number next to the To do count
    function urgentCount() { return todoItems ? todoItems.filter(t => t.priority && !t.done).reduce((s, t) => s + (Number(t.n) || 1), 0) : 0; }
    function todoCount() { return (todoItems ? todoItems.filter(t => !t.notice && !t.done).length : 0) + (getDailyChecked() ? 0 : 1); } // a notice (like the Xanax stacking reminder) is not something to do, so it is not counted

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
            // Only the close button was excluded from starting a drag — the settings gear (and its
            // update-dot child) was not, so pressing it captured the pointer for dragging before its
            // own click could ever fire. That's why ⚙ did nothing at all on a computer specifically.
            if (e.target.closest('#wwl-close, #wwl-settings')) return;
            drag = { dx: e.clientX - win.offsetLeft, dy: e.clientY - win.offsetTop };
            head.setPointerCapture(e.pointerId);
        });
        head.addEventListener('pointermove', e => { if (drag) place(e.clientX - drag.dx, e.clientY - drag.dy); });
        head.addEventListener('pointerup', () => { if (drag) { drag = null; store.set(POS_NAME, JSON.stringify({ x: win.offsetLeft, y: win.offsetTop })); } });
        window.addEventListener('resize', () => { if (win.style.display !== 'none') place(win.offsetLeft, win.offsetTop); });
    }

    // A member can change a setting (e.g. revive) in another tab and come back to a stale to-do list. This
    // used to poll every 15s while the window was open — but the window stays open across every Torn page,
    // so each member made ~4 server calls a minute all day, and together that burned through the whole
    // database's monthly request quota. Now it only re-checks when there's a reason to: you come back to
    // this tab, or click into the To do tab — and never more than once every 30s.
    let lastTodoFetch = Date.now();
    // how long the To do list may be kept: the server says (a minute for a leader with things waiting, five minutes for everybody else)
    const todoCacheTtl = () => { try { const c = JSON.parse(store.get('wwl_c_todo') || 'null'); return c && c.data && c.data.ttl ? Math.max(30, c.data.ttl) * 1000 : 300000; } catch (e) { return 300000; } };
    async function refreshTodoItems(force = false) {
        if (win.style.display === 'none' || (!force && Date.now() - lastTodoFetch < Math.min(180000, todoCacheTtl()))) return;
        lastTodoFetch = Date.now();
        try { const r = await api({ action: 'member-todo', close: 1 }); try { store.set('wwl_c_todo', JSON.stringify({ at: Date.now(), data: r })); } catch (e) { /* no cache */ } todoItems = r.items || []; energyPause = r.energyPause || null; if (tab === 'todo' || tab === 'settings') render(); }
        catch (e) { /* keep showing what we already had */ }
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshTodoItems(); });
    // a leader with things waiting (the crimes, the money, the reminders) while the window is open on the To do tab: a fresh list every 90 seconds, only for them
    setInterval(() => { if (!document.hidden && tab === 'todo' && todoItems && todoItems.some(i => i.priority || /^lt-/.test(i.id))) refreshTodoItems(true); }, 90000);
    function setOpen(on, save = true) {
        win.style.display = on ? 'flex' : 'none';
        pill.style.display = on ? 'none' : 'flex';
        if (save) store.set(STATE_NAME, on ? 'open' : 'closed');
        if (on) {
            if (!IS_PDA) restorePos(); lastTodoFetch = Date.now(); load(save);
            // opening the window asks (cheaply, at most every 5 minutes) whether a newer version exists, so the update banner at the top shows without anyone going to Settings
            try { checkForUpdate(true); } catch (e) { /* still starting up - the passive check covers it */ }
        }
    }
    pill.addEventListener('click', () => { if (pillDragged) { pillDragged = false; return; } setOpen(true); }); // a drag is not a click
    win.querySelector('#wwl-close').addEventListener('click', () => setOpen(false));
    win.querySelector('#wwl-settings').addEventListener('click', () => {
        tab = 'settings';
        render();
        if (settingsData === null) loadSettings();
    });

    // Every attempt to live inside one of Torn's own page elements (the chat bar, then the header
    // toolbar) broke something real there — drag-and-drop interference in the chat bar, and the header
    // toolbar turned out to be a tight flex row with no slack, so adding one more icon visibly squeezed
    // Torn's own avatar into an oval. Settled on staying a fully standalone floating icon instead: never
    // competes for space with anything Torn renders, so it can't distort Torn's own layout again.
    // TornPDA only: Torn's own chat-icon row renders as a bar pinned to the very bottom of the screen
    // there — read-only, so this can't repeat the dnd-kit issue above (nothing is inserted into it),
    // just measured so the slide-up menu stops above it instead of sliding in underneath.
    function adjustPdaWindowBottom() {
        if (!IS_PDA) return;
        const bar = document.getElementById('notes_panel_button')?.parentElement;
        if (bar) win.style.bottom = `${bar.getBoundingClientRect().height}px`;
    }
    adjustPdaWindowBottom();
    if (IS_PDA) setInterval(adjustPdaWindowBottom, 3000);

    function progress() {
        let done = 0, total = 0;
        for (const b of plan.blocks) for (const it of b.items) { total += it.value; if (plan.checks[it.key]) done += it.value; }
        if (plan.track === 'counter') done = plan.counter && plan.counter.known ? plan.counter.trained : 0; // the bar counts the energy really trained this week
        return { done, total };
    }
    function showProgress() {
        const p = plan ? progress() : null;
        const energyText = p ? `${num(p.done)} / ${num(p.total)} E` : '';
        const n = todoCount();
        const u = urgentCount();
        const todoBadge = (n ? `<span style="color:#f0b432;" title="${n} to do">●${n}</span>` : '') + (u ? ` <span style="color:#e05555;font-weight:700;" title="${u} urgent: crimes and money">●${u}</span>` : '');
        prog2.innerHTML = [energyText, todoBadge].filter(Boolean).join(' ');
        if (IS_PDA) { prog.textContent = u ? `${n} · ${u}` : n; prog.style.display = n ? 'flex' : 'none'; prog.style.boxShadow = u ? '0 0 0 2px #e05555' : ''; }
        else prog.innerHTML = [energyText, todoBadge].filter(Boolean).join(' ');
    }
    function tabBar() {
        const n = todoCount();
        const tabs = [['energy', '⚡ Energy'], ['targets', '🎯 Targets']]; // the To do button sits in the top row next to the energy and the war numbers
        tabs.push(['labnotes', '🧪 Notes']);
        tabs.push(['avail', '📅 Avail']);
        tabs.push(['bank', '💰 Bank']);
        if (tabs.length < 2) return '';
        return `<div style="display:flex;gap:6px;margin-bottom:10px;">${tabs.map(([id, label]) =>
            `<button type="button" class="wwl-tab" data-tab="${id}" style="flex:1;padding:6px;border-radius:6px;border:1px solid #3a4352;cursor:pointer;background:${tab === id ? '#2a2f3a' : 'transparent'};color:#e6e9ef;">${label}</button>`
        ).join('')}</div>`;
    }
    function wireTabs() {
        body.parentElement.querySelectorAll('.wwl-tab').forEach(b => b.addEventListener('click', () => {
            tab = lastTab = b.dataset.tab; render();
            if (tab === 'todo') refreshTodoItems();
            if (tab === 'targets') loadTargets();
            if (tab === 'bank') loadBankInfo();
            if (tab === 'avail') loadAvail();
            if (tab === 'labnotes') loadLab();
        }));
    }
    function renderEnergyTab() {
        const footer = `<div style="margin-top:10px;padding-top:8px;border-top:1px solid #3a4352;color:#9aa4b5;">To change your settings (stat, method, candy, cans, refill), use the planner on the tool itself: <a href="${WWL}/energy" target="_blank" rel="noopener" style="color:#35d99b;">${esc(WWL)}/energy</a></div>`;
        if (!plan) return `<div style="padding:6px 0;color:#9aa4b5;">You have no plan yet. Open the Energy planner on WWL once, pick your method, and it will show up here.</div>${footer}`;
        const p = progress();
        const old = plan.week !== (plan.currentWeek ?? Math.floor(Date.now() / (7 * 86400e3))) ? '<div style="color:#f0b432;margin-bottom:6px;">This plan is from a previous week — open the planner on WWL to make a plan for this week.</div>' : '';
        // the day to open: the one you are working on (the last day with a tick, while it still has open boxes), else the first day after it that is not done,
        // else the first day not done. It used to be the first day with an open box, so ticking day 3 still opened day 1.
        const open = b => b.items.some(it => !plan.checks[it.key]);
        let lastTick = -1; plan.blocks.forEach((b, i) => { if (b.items.some(it => plan.checks[it.key])) lastTick = i; });
        let nextIdx = lastTick >= 0 && open(plan.blocks[lastTick]) ? lastTick : -1;
        if (nextIdx < 0) nextIdx = plan.blocks.findIndex((b, i) => i > lastTick && open(b));
        if (nextIdx < 0) nextIdx = plan.blocks.findIndex(open);
        return `${old}<div style="color:#9aa4b5;margin-bottom:6px;">${esc(plan.summary)}</div>
            <div style="height:6px;background:#39414f;border-radius:3px;overflow:hidden;margin-bottom:6px;"><div style="height:100%;width:${p.total ? Math.min(100, p.done / p.total * 100) : 0}%;background:#35d99b;"></div></div>
            <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;font-size:12px;color:#9aa4b5;flex-wrap:wrap;">The bar counts:
                <button type="button" class="wwl-track" data-mode="boxes" style="padding:2px 8px;border-radius:6px;border:1px solid #3a4352;cursor:pointer;background:${plan.track === 'counter' ? 'transparent' : '#2a2f3a'};color:#e6e9ef;">my ticks</button>
                <button type="button" class="wwl-track" data-mode="counter" style="padding:2px 8px;border-radius:6px;border:1px solid #3a4352;cursor:pointer;background:${plan.track === 'counter' ? '#2a2f3a' : 'transparent'};color:#e6e9ef;">energy trained</button>
                ${plan.track === 'counter' ? `<span>${plan.counter && plan.counter.known ? 'from the energy tracker' : 'no numbers for you yet'}</span>` : ''}</div>
            <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;font-size:12px;color:#9aa4b5;flex-wrap:wrap;">My week starts:
                <input type="date" id="wwl-start" value="${esc(plan.startDay || '')}" style="background:#12161c;color:#e6e9ef;border:1px solid #3a4352;border-radius:6px;padding:2px 6px;">
                <button type="button" id="wwl-start-auto" style="padding:2px 8px;border-radius:6px;border:1px solid #3a4352;cursor:pointer;background:transparent;color:#e6e9ef;" title="The week starts after the last war ended">After a war</button>
                <select id="wwl-afterday" style="background:#12161c;color:#e6e9ef;border:1px solid #3a4352;border-radius:6px;padding:2px 4px;"><option value="same" ${plan.afterDay ? '' : 'selected'}>the day it ended</option><option value="next" ${plan.afterDay ? 'selected' : ''}>the day after</option></select>
                ${plan.weekStart ? `<span>${esc(new Date(plan.weekStart * 1000).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }))} to ${esc(new Date((plan.weekStart + 6 * 86400) * 1000).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }))}</span>` : ''}</div>
            ${plan.blocks.map((b, i) => {
                const all = b.items.length && b.items.every(it => plan.checks[it.key]);
                return `<details ${i === nextIdx ? 'open' : ''} style="margin-bottom:4px;"><summary style="cursor:pointer;font-weight:700;padding:${IS_PDA ? 6 : 2}px 0;">${all ? '✅ ' : ''}${esc(b.title)}${i === nextIdx ? ' <span style="color:#35d99b;font-weight:400;">← next</span>' : ''}</summary>
                    ${b.note ? `<div style="color:#9aa4b5;margin:3px 0;">${esc(b.note)}</div>` : ''}
                    ${b.items.map(it => `<label style="display:flex;gap:8px;align-items:flex-start;padding:${IS_PDA ? 8 : 4}px 0;cursor:pointer;"><input type="checkbox" class="wwl-e-check" data-k="${esc(it.key)}" ${plan.checks[it.key] ? 'checked' : ''} style="margin-top:2px;"><span>${esc(it.label)}</span></label>`).join('')}</details>`;
            }).join('')}${footer}`;
    }
    // A simplified strip of the same numbers the site's "Your standing" dashboard card shows — energy
    // trained this month (a real, automatically-tracked stat) and war participation. Shown above every
    // tab, not just Energy, since it's a different thing from the weekly plan checklist above: that one
    // tracks a planned checklist of actions, this tracks what actually happened. Blank once 'mo-me'
    // hasn't answered yet (e.g. no key, or a hiccup) rather than showing stale/wrong numbers.
    function renderStandingStrip() {
        // the top row of the window: this month's energy and the war rule (when known) and, at the right, the To do button (it used to be one of the tabs, which made the tab row too crowded)
        const s = standing && !standing.error ? standing : null;
        const n = todoCount();
        const todoBtn = `<button type="button" class="wwl-tab" data-tab="todo" style="margin-left:auto;padding:${IS_PDA ? 6 : 3}px 10px;border-radius:6px;border:1px solid #3a4352;cursor:pointer;background:${tab === 'todo' ? '#2a2f3a' : 'transparent'};color:#e6e9ef;font-size:12px;white-space:nowrap;">✅ To do${n ? ` (${n})` : ''}${urgentCount() ? ` <span style="background:#e05555;color:#fff;border-radius:8px;padding:0 6px;font-weight:700;" title="urgent: crimes and money">${urgentCount()}</span>` : ''}</button>`;
        let strip = '';
        if (s) {
            const energyText = s.energy ? `${num(s.energy.month.trained)}${s.tier ? ` / ${num(s.energyNeeded)}` : ''}` : '—';
            const warText = s.wars?.length && s.eligible ? `${s.okWars}/${s.eligible}` : '—';
            strip = `<span title="Energy trained this month, vs. your group's target">⚡ <span style="color:#e6e9ef;font-family:monospace;">${energyText}</span></span>
            <span title="War participation, last 5 wars">⚔ <span style="color:#e6e9ef;font-family:monospace;">${warText}</span></span>`;
        }
        return `<div style="display:flex;gap:16px;align-items:center;padding:6px 10px;margin-bottom:8px;background:#1b2029;border:1px solid #3a4352;border-radius:6px;font-size:12px;color:#9aa4b5;">${strip}${todoBtn}</div>`;
    }
    // My Targets: the same personal list a member builds on the site (star a target on Level targets /
    // Target finder / My targets and it shows up here) — deliberately not the full target finder (search
    // presets, fair-fight filters, FFScouter key setup), which would be a lot to cram into this window.
    function renderTargetsTab() {
        if (myTargets === null) return '<div style="padding:6px 0;color:#9aa4b5;">Loading…</div>';
        if (!myTargets.length) return '<div style="padding:6px 0;color:#9aa4b5;">No targets yet — star one on the site\'s Level targets, Target finder, or My targets page and it shows up here.</div>';
        const STATE_COLOR = { Okay: '#35d99b', Hospital: '#e05555', Jail: '#f0b432', Traveling: '#4da3ff', Abroad: '#4da3ff', Federal: '#e05555' };
        const rows = myTargets.map(t => {
            const st = targetStatus[t.id];
            const color = st ? (STATE_COLOR[st.state] || '#9aa4b5') : '#9aa4b5';
            const stateText = !st ? '…' : (st.state === 'Hospital' && st.until ? `Hospital, out ${new Date(st.until * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : st.state);
            return `<div style="display:flex;gap:8px;align-items:center;padding:${IS_PDA ? 10 : 7}px 0;border-bottom:1px solid #3a4352;">
                <span style="flex:1;">${esc(t.name || `#${t.id}`)}${t.level ? ` <span style="color:#9aa4b5;">(lvl ${t.level})</span>` : ''}</span>
                <span style="color:${color};font-size:12px;white-space:nowrap;">${esc(stateText)}</span>
                <a href="https://www.torn.com/page.php?sid=attack&user2ID=${encodeURIComponent(t.id)}" target="_blank" rel="noopener" style="color:#35d99b;white-space:nowrap;text-decoration:none;border:1px solid #35d99b;border-radius:6px;padding:4px 8px;font-size:12px;">Attack</a>
            </div>`;
        }).join('');
        return `<div style="display:flex;justify-content:flex-end;margin-bottom:6px;"><button type="button" id="wwl-targets-refresh" style="padding:3px 8px;border-radius:6px;border:1px solid #3a4352;background:transparent;color:#9aa4b5;cursor:pointer;font-size:11px;">🔄 Refresh status</button></div>${rows}`;
    }
    // Targets cost real database + Torn calls (one Torn lookup per target whose status isn't fresh), so
    // nothing here runs until the Targets tab is actually opened — it used to load on every single
    // window open, which added up fast across a whole faction.
    let targetsFetchedAt = 0;
    async function refreshTargetStatus() {
        if (!myTargets?.length) return;
        targetsFetchedAt = Date.now();
        try { const r = await api({ action: 'target-status', ids: myTargets.map(t => t.id) }); targetStatus = r.status || {}; } catch (e) { /* keep showing what we had */ }
        if (tab === 'targets') render();
    }
    async function loadTargets() {
        if (myTargets === null) {
            try { myTargets = (await api({ action: 'mytargets-get' })).targets || []; } catch (e) { myTargets = []; }
            if (tab === 'targets') render();
            return refreshTargetStatus();
        }
        if (Date.now() - targetsFetchedAt > 60000) return refreshTargetStatus(); // statuses go stale fast, but not that fast
    }
    // ---- welcome chapters (the pupil's missions, and what the mentor sees of their pupil) — from lib/welcome.js ----
    const weRich = t => esc(String(t || '')).replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, label, url) => `<a href="${url}" target="_blank" rel="noopener" style="color:#35d99b;">${label}</a>`);
    const weLink = t => { const l = String(t.link || '').trim(); if (!l) return ''; const h = /^https?:\/\//i.test(l) ? l : `${WWL}/${l.replace(/^\/+/, '')}`; return ` <a href="${esc(h)}" target="_blank" rel="noopener" style="color:#35d99b;white-space:nowrap;">${esc(t.label || 'Open')}</a>`; };
    const weTask = (t, cls, extra) => `<label style="display:flex;gap:8px;align-items:flex-start;padding:${IS_PDA ? 8 : 4}px 0;${t.waiting ? 'opacity:.6;' : ''}"><input type="checkbox" class="${cls}" ${extra} data-id="${esc(t.id)}" ${t.done ? 'checked' : ''} ${t.auto || t.waiting ? 'disabled' : ''}><span style="flex:1;">${weRich(t.text)}${t.auto ? ' <span style="color:#9aa4b5;font-size:11px;">· ticks itself</span>' : ''}${t.waiting ? ` <span style="color:#f0b432;font-size:11px;">· from day ${t.fromDay + 1}</span>` : ''}${weLink(t)}</span></label>`;
    // the role path: where they are on the faction ladder and what the next role still needs
    function weRole(role) {
        if (!role) return '';
        if (role.current < 0) return `<div style="color:#9aa4b5;margin-bottom:6px;">Role: <b style="color:#e8ecf3;">${esc(role.position || 'none')}</b></div>`;
        const mark = ok => ok === true ? '<span style="color:#35d99b;">✓</span>' : ok === false ? '<span style="color:#9aa4b5;">○</span>' : '<span style="color:#9aa4b5;">?</span>';
        const chips = role.steps.map((s, i) => `<span style="font-size:11px;border:1px solid ${i === role.current ? '#35d99b' : '#3a4352'};border-radius:10px;padding:1px 7px;color:${i <= role.current ? '#e8ecf3' : '#9aa4b5'};">${i < role.current ? '✓ ' : ''}${esc(s.name)}</span>`).join(' → ');
        const next = role.next != null ? role.steps[role.next] : null;
        return `<div style="margin:4px 0 8px;"><div style="font-size:11px;color:#9aa4b5;">Role path</div><div style="display:flex;gap:3px;flex-wrap:wrap;align-items:center;">${chips}</div>${next ? `<div style="margin-top:4px;">Next: <b>${esc(next.name)}</b>${next.gives ? ` <span style="color:#9aa4b5;">(${esc(next.gives)})</span>` : ''}${next.reqs.map(r => `<div style="padding-left:8px;">${r.appointed ? '•' : mark(r.ok)} ${esc(r.text)}${r.detail ? ` <span style="color:#9aa4b5;font-size:11px;">(${esc(r.detail)})</span>` : ''}</div>`).join('')}</div>` : `<div style="color:#35d99b;margin-top:4px;">You are at the top of the ladder 🎉</div>${role.keep ? `<div style="margin-top:3px;">${role.keep.ok === false ? '<span style="color:#e05555;">⚠</span>' : mark(role.keep.ok)} ${esc(role.keep.text)}${role.keep.detail ? ` <span style="color:#9aa4b5;font-size:11px;">(${esc(role.keep.detail)})</span>` : ''}</div>` : ''}`}</div>`;
    }
    function renderWelcomeMine() {
        const r = welMine;
        if (!r || !r.pupil) return '';
        const c = r.chapters[r.current];
        const total = r.chapters.reduce((s, x) => s + x.total, 0), done = r.chapters.reduce((s, x) => s + x.doneCount, 0);
        return `<div style="margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid #3a4352;">
            <div style="font-weight:700;margin-bottom:4px;">👋 Your welcome missions <span style="font-weight:400;color:#9aa4b5;font-size:12px;">${r.allDone ? 'all done 🎉' : `${done} of ${total} steps`}</span></div>
            ${weRole(r.role)}
            <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px;">${r.chapters.map((x, i) => `<span style="font-size:11px;border:1px solid ${i === r.current && !r.allDone ? '#35d99b' : '#3a4352'};border-radius:10px;padding:1px 7px;color:${x.complete ? '#35d99b' : x.locked ? '#9aa4b5' : '#e8ecf3'};">${x.complete ? '✓' : x.locked ? '🔒' : ''} ${i + 1}${x.locked ? '' : ` ${esc(x.title)}`}</span>`).join('')}</div>
            ${r.allDone ? '<div style="color:#35d99b;">You finished everything. Well done! 🎉</div>' : `<details class="wwl-w-det" data-k="me:${r.current}" ${welOpen[`me:${r.current}`] ? 'open' : ''} style="margin:3px 0;border:1px solid #3a4352;border-radius:6px;padding:3px 8px;"><summary style="cursor:pointer;font-weight:700;">${r.current + 1}. ${esc(c.title)} <span style="font-weight:400;color:#9aa4b5;font-size:11px;">${c.doneCount}/${c.total} · you are here</span></summary><div style="color:#9aa4b5;font-size:12px;white-space:pre-wrap;margin:4px 0;">${weRich(c.intro)}</div>${c.tasks.map(t => weTask(t, 'wwl-w-check', '')).join('')}</details>`}
        </div>`;
    }
    // a mentor's closed-by-default look at their pupil's training per week and the energy plan they picked (from the site's own numbers)
    function renderInsight(pupilId) {
        const r = welInsights[pupilId];
        if (!r || r.error) return '';
        const n = v => Math.round(v).toLocaleString();
        const max = Math.max(1, r.weekly || 0, ...r.weeks.map(w => w.total));
        const day = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
        const plan = r.plan ? `<div><b>⚡ Plan:</b> ${esc(r.plan.method || 'a plan')}${r.plan.stat ? ` (${esc(r.plan.stat)})` : ''}<div style="color:#9aa4b5;font-size:12px;">${esc(r.plan.summary || '')}</div><div style="color:#9aa4b5;font-size:12px;">This week: ${r.plan.done} of ${r.plan.total} steps${r.plan.weekly ? ` · minimum ${n(r.plan.weekly)} E` : ''}</div></div>`
            : '<div style="color:#f0b432;">⚠ No energy plan set yet: a good moment to help them choose one on the Energy planner.</div>';
        const rows = r.tracked ? r.weeks.map(w => `<div style="display:flex;align-items:center;gap:6px;font-size:11px;margin:2px 0;"><span style="width:84px;color:#9aa4b5;">${day(w.from)}–${day(w.to)}</span><span style="flex:1;background:#39414f;border-radius:3px;height:9px;display:block;"><span style="display:block;height:9px;border-radius:3px;width:${(w.total / max * 100).toFixed(1)}%;background:${r.weekly && w.total < r.weekly ? '#f0b432' : '#35d99b'};"></span></span><span style="width:62px;text-align:right;">${n(w.total)} E</span></div>`).join('') : '<div style="color:#9aa4b5;font-size:12px;">No energy recorded for them yet.</div>';
        return `<details class="wwl-w-det" data-k="${esc(pupilId)}:ins" ${welOpen[`${pupilId}:ins`] ? 'open' : ''} style="margin:3px 0;border:1px solid #3a4352;border-radius:6px;padding:3px 8px;"><summary style="cursor:pointer;font-weight:700;">📈 Their training and energy plan</summary>${plan}<div style="color:#9aa4b5;font-size:11px;margin:4px 0 2px;">Energy trained per week${r.weekly ? ' (amber = under the weekly minimum)' : ''}</div>${rows}</details>`;
    }
    // the mentor sees every chapter in full with what is ticked (the pupil only gets the chapter they are on)
    function renderWelcomePupil(pupilId) {
        const r = welPupils[pupilId];
        if (!r || r.error) return '';
        const total = r.chapters.reduce((s, x) => s + x.total, 0), done = r.chapters.reduce((s, x) => s + x.doneCount, 0);
        return `<div style="margin:6px 0 10px;"><div style="font-size:12px;font-weight:700;">${r.allDone ? '👋 Finished all welcome chapters 🎉' : `👋 Their welcome chapters: ${r.current + 1} of ${r.chapters.length}, ${done} of ${total} steps`}</div>
            ${weRole(r.role)}
            ${renderInsight(pupilId)}
            <div style="color:#9aa4b5;font-size:12px;margin-bottom:4px;">Tick a step for them if they showed you it is done.</div>
            ${r.chapters.map((x, i) => { const k = `${pupilId}:${i}`; return `<details class="wwl-w-det" data-k="${esc(k)}" ${(welOpen[k] ?? false) ? 'open' : ''} style="margin:3px 0;border:1px solid #3a4352;border-radius:6px;padding:3px 8px;"><summary style="cursor:pointer;color:${x.complete ? '#35d99b' : '#e8ecf3'};">${x.complete ? '✓' : x.locked ? '🔒' : '○'} ${i + 1}. ${esc(x.title)} <span style="color:#9aa4b5;font-size:11px;">${x.doneCount}/${x.total}${x.locked ? ' · not open for them yet' : ''}</span></summary>${x.tasks.map(t => weTask(t, 'wwl-w-mtick', `data-pupil="${esc(pupilId)}"`)).join('')}</details>`; }).join('')}</div>`;
    }
    // ---- Lab Notes (every member): the role path, the welcome chapters and the extra cards from the site's Lab Notes page; a card's daily steps can be put on the own To do ----
    let labData = null;
    async function loadLab() {
        try { labData = await api({ action: 'lab-get' }); } catch (e) { labData = { error: e.message === 'NO_KEY' ? 'No API key set yet.' : e.message }; }
        if (tab === 'labnotes') render();
    }
    function renderLabTab() {
        const r = labData;
        if (!r) return '<div style="padding:6px 0;color:#9aa4b5;">Loading…</div>';
        if (r.error) return `<div style="padding:6px 0;color:#e05555;">${esc(r.error)}</div>`;
        const w = r.welcome;
        let html = weRole(r.role);
        if (w && w.chapters && w.chapters.length) {
            const c = w.chapters[w.current];
            const total = w.chapters.reduce((s, x) => s + x.total, 0), done = w.chapters.reduce((s, x) => s + x.doneCount, 0);
            html += `<div style="margin:8px 0 12px;padding-bottom:10px;border-bottom:1px solid #3a4352;"><div style="font-weight:700;margin-bottom:4px;">👋 Welcome chapters <span style="font-weight:400;color:#9aa4b5;font-size:12px;">${w.allDone ? 'all done 🎉' : `${done} of ${total} steps`}</span></div>
                <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px;">${w.chapters.map((x, i) => `<span style="font-size:11px;border:1px solid ${i === w.current && !w.allDone ? '#35d99b' : '#3a4352'};border-radius:10px;padding:1px 7px;color:${x.complete ? '#35d99b' : x.locked ? '#9aa4b5' : '#e8ecf3'};">${x.complete ? '✓' : x.locked ? '🔒' : ''} ${i + 1}${x.locked ? '' : ` ${esc(x.title)}`}</span>`).join('')}</div>
                ${w.allDone ? '<div style="color:#35d99b;">You finished all the chapters. Well done! 🎉</div>' : `<details class="wwl-w-det" data-k="lab:${w.current}" ${welOpen[`lab:${w.current}`] ? 'open' : ''} style="margin:3px 0;border:1px solid #3a4352;border-radius:6px;padding:3px 8px;"><summary style="cursor:pointer;font-weight:700;">${w.current + 1}. ${esc(c.title)} <span style="font-weight:400;color:#9aa4b5;font-size:11px;">${c.doneCount}/${c.total} · you are here</span></summary><div style="color:#9aa4b5;font-size:12px;white-space:pre-wrap;margin:4px 0;">${weRich(c.intro)}</div>${c.tasks.map(t => weTask(t, 'wwl-lab-check', '')).join('')}</details>`}
            </div>`;
        }
        const cards = r.cards || [];
        html += cards.length ? cards.map(c => `<details class="wwl-w-det" data-k="labcard:${esc(c.id)}" ${welOpen[`labcard:${c.id}`] ? 'open' : ''} style="margin:5px 0;border:1px solid #3a4352;border-radius:6px;padding:3px 8px;"><summary style="cursor:pointer;font-weight:700;">${esc(c.title)} <span style="font-weight:400;color:#9aa4b5;font-size:11px;">${c.doneCount}/${c.total}${c.complete ? ' · done ✓' : ''}</span></summary>
            ${c.intro ? `<div style="color:#9aa4b5;font-size:12px;white-space:pre-wrap;margin:4px 0;">${weRich(c.intro)}</div>` : ''}${c.tasks.map(t => weTask(t, 'wwl-lab-check', '')).join('')}
            ${c.canRemind ? `<label style="display:flex;gap:8px;align-items:center;margin-top:6px;padding-top:6px;border-top:1px solid #3a4352;font-size:12px;"><input type="checkbox" class="wwl-lab-remind" data-id="${esc(c.id)}" ${c.remindersOn ? 'checked' : ''}> Put the daily steps of this note on my To do</label>` : ''}</details>`).join('')
            : `<div style="color:#9aa4b5;font-size:12px;padding:4px 0;">More notes will show up here when they are written.</div>`;
        return html + `<div style="margin-top:10px;color:#9aa4b5;font-size:12px;">The same notes are on the site: <a href="${WWL}/lab-notes" target="_blank" rel="noopener" style="color:#35d99b;">${esc(WWL)}/lab-notes</a>. Your mentor and the chat with them are on the site too: <a href="${WWL}/mentoring" target="_blank" rel="noopener" style="color:#35d99b;">${esc(WWL)}/mentoring</a></div>`;
    }
    // The mentoring to-dos: one section per pairing (a mentor with several pupils gets one each), each ticked
    // separately — same shared checklist the WWL page itself shows, just without the chat (open the site for that).
    function renderMentoringTab() {
        const mine = renderWelcomeMine();
        if (!mtPairs.length) return mine + '<div style="padding:6px 0;color:#9aa4b5;">No mentor yet: a leader matches you with someone who is online at the same time as you. Make sure your usual online hours are set on the site.</div>';
        return mine + mtPairs.map(p => {
            return `<div style="margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid #3a4352;">
                <div style="font-weight:700;margin-bottom:6px;">${p.role === 'mentor' ? `Mentoring ${esc(p.otherName)}` : `Your mentor: ${esc(p.otherName)}`}</div>
                ${p.role === 'mentor' ? renderWelcomePupil(p.otherId) : ''}
            </div>`;
        }).join('') + `<div style="color:#9aa4b5;">Chat with them on the site: <a href="${WWL}/mentoring" target="_blank" rel="noopener" style="color:#35d99b;">${esc(WWL)}/mentoring</a></div>`;
    }
    // Small personal reminders — revive setting, feedback, timezone map — from api/war-payout.js's
    // 'member-todo' action. Each has an optional link (some open WWL in a new tab, the revive one
    // opens Torn's own Preferences page directly).
    // "Request an OC": shown under the "not in an Organized Crime" reminder, so a member who cannot find a crime that suits them
    // can ask leadership for one at a level (the server keeps one open request per member and tells leadership).
    function ocRequestHtml(t) {
        const box = 'padding:6px 0 10px;border-bottom:1px solid #3a4352;font-size:12px;color:#9aa4b5;';
        if (t.request) return `<div style="${box}">✅ You asked for a level ${esc(t.request.level)} OC — leadership has been told. <span id="wwl-oc-cancel" style="color:#e05555;cursor:pointer;text-decoration:underline;">cancel</span></div>`;
        return `<div style="${box}">Nothing that suits you? Ask for one:
            <div style="display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap;">
                <select id="wwl-oc-level" style="background:#12161c;color:#e6e9ef;border:1px solid #3a4352;border-radius:6px;padding:4px;">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<option value="${n}">Level ${n}</option>`).join('')}</select>
                <input id="wwl-oc-note" maxlength="140" placeholder="note (optional)" style="flex:1;min-width:90px;background:#12161c;color:#e6e9ef;border:1px solid #3a4352;border-radius:6px;padding:5px;">
                <button type="button" id="wwl-oc-send" style="padding:5px 10px;border-radius:6px;border:1px solid #35d99b;background:transparent;color:#35d99b;cursor:pointer;">Request</button>
            </div></div>`;
    }
    // The member's own reminders: add one (Enter or the button) or delete one; the list is re-read from the server afterwards.
    function wireMyTodo() {
        const input = body.querySelector('#wwl-mt-input'), add = body.querySelector('#wwl-mt-add');
        const submit = async () => {
            if (!input || !input.value.trim()) return;
            add.disabled = true;
            try { await api({ action: 'mytodo-add', text: input.value, repeat: body.querySelector('#wwl-mt-repeat').value }); await refreshTodoItems(true); } catch (e) { add.disabled = false; add.textContent = 'Failed'; }
        };
        add?.addEventListener('click', submit);
        input?.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
        body.querySelectorAll('.wwl-mt-check').forEach(c => c.addEventListener('change', async () => {
            try { await api({ action: 'mytodo-check', id: c.dataset.id, done: c.checked }); await refreshTodoItems(true); } catch (e) { c.checked = !c.checked; }
        }));
        body.querySelectorAll('.wwl-mt-del').forEach(x => x.addEventListener('click', async () => {
            try { await api({ action: 'mytodo-delete', id: x.dataset.id }); await refreshTodoItems(true); } catch (e) { /* stays */ }
        }));
    }
    function wireOcRequest() {
        const send = body.querySelector('#wwl-oc-send'), cancel = body.querySelector('#wwl-oc-cancel');
        const item = () => todoItems && todoItems.find(t => t.id === 'oc');
        send?.addEventListener('click', async () => {
            send.disabled = true;
            try {
                const r = await api({ action: 'ocreq-submit', level: body.querySelector('#wwl-oc-level').value, note: body.querySelector('#wwl-oc-note').value });
                if (item()) item().request = r.request;
                render();
            } catch (e) { send.disabled = false; send.textContent = 'Failed — try again'; }
        });
        cancel?.addEventListener('click', async () => {
            try { await api({ action: 'ocreq-cancel' }); if (item()) item().request = null; render(); } catch (e) { /* stays as it was */ }
        });
    }
    // ---- Bank tab: ask for money out of your OWN faction balance (never more than it); a banker claims it from Discord ----
    let bankInfo = null, bankMsg = '';
    async function loadBankInfo() {
        try { bankInfo = await api({ action: 'bank-info' }); bankMsg = ''; } catch (e) { bankInfo = { balance: null, balanceError: e.message }; }
        if (tab === 'bank') render();
    }
    const bankMoney = n => `$${Math.round(n).toLocaleString('en-US')}`;
    function renderBankTab() {
        if (bankInfo === null) return '<div style="padding:6px 0;color:#9aa4b5;">Loading your balance…</div>';
        const bal = bankInfo.balance === null || bankInfo.balance === undefined
            ? `<div style="color:#e05555;padding:4px 0;">${esc(bankInfo.balanceError || 'Your balance could not be read.')}</div>`
            : `<div style="padding:4px 0;">Your faction balance: <b style="font-family:monospace;">${bankMoney(bankInfo.balance)}</b></div>`;
        const req = bankInfo.request
            ? `<div style="padding:8px 0;border-top:1px solid #3a4352;margin-top:8px;">✅ Open request: <b style="font-family:monospace;">${bankMoney(bankInfo.request.amount)}</b> — a banker has been told. <span id="wwl-bank-cancel" style="color:#e05555;cursor:pointer;text-decoration:underline;">cancel</span></div>` : '';
        const can = bankInfo.balance !== null && bankInfo.balance !== undefined;
        return `${bal}
            <div style="display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap;">
                <input id="wwl-bank-amount" type="number" min="1" step="1" placeholder="Amount" ${can ? '' : 'disabled'} style="flex:1;min-width:110px;background:#12161c;color:#e6e9ef;border:1px solid #3a4352;border-radius:6px;padding:6px;">
                <button type="button" id="wwl-bank-all" ${can ? '' : 'disabled'} style="padding:6px 8px;border-radius:6px;border:1px solid #3a4352;background:transparent;color:#e6e9ef;cursor:pointer;">All</button>
                <button type="button" id="wwl-bank-send" ${can ? '' : 'disabled'} style="padding:6px 10px;border-radius:6px;border:1px solid #35d99b;background:transparent;color:#35d99b;cursor:pointer;">Request</button>
            </div>
            ${bankMsg ? `<div style="color:#e05555;font-size:12px;margin-top:6px;">${esc(bankMsg)}</div>` : ''}
            ${req}
            <div style="margin-top:8px;color:#9aa4b5;font-size:12px;">You can only ask for up to your own balance. A banker confirms the payout in Torn.</div>`;
    }
    function wireBankTab() {
        const send = body.querySelector('#wwl-bank-send'), all = body.querySelector('#wwl-bank-all'), cancel = body.querySelector('#wwl-bank-cancel');
        all?.addEventListener('click', () => { if (bankInfo && bankInfo.balance != null) body.querySelector('#wwl-bank-amount').value = bankInfo.balance; });
        send?.addEventListener('click', async () => {
            send.disabled = true;
            try { const r = await api({ action: 'bank-submit', amount: body.querySelector('#wwl-bank-amount').value }); bankInfo.request = r.request; bankMsg = ''; }
            catch (e) { bankMsg = e.message; }
            render();
        });
        cancel?.addEventListener('click', async () => {
            try { await api({ action: 'bank-cancel', id: bankInfo.request.id }); bankInfo.request = null; } catch (e) { bankMsg = e.message; }
            render();
        });
    }
    // ---- Availability tab: the whole faction at a glance (with names), my own hours and the chain / war watch, for the running plan ----
    let avData = null, avMode = 'all', avPick = null, avMsg = '', avLocal = store.get('wwl_av_local') === '1';
    async function loadAvail() {
        try { avData = await api({ action: 'availability-get' }); avMsg = ''; } catch (e) { avData = { error: e.message }; }
        if (tab === 'avail') render();
    }
    // is this hour outside the plan (before its start, after its end)? Same rule as the site and the server (TCT = UTC)
    function avClosed(c, day, hour) {
        const [y, m, d] = String(c.startDate).split('-').map(Number), at = Date.UTC(y, m - 1, d) / 1000 + (day * 24 + hour) * 3600;
        if (c.endAt && at >= c.endAt) return true;
        if (c.startHour !== undefined && c.startHour !== null) return at < Date.UTC(y, m - 1, d) / 1000 + Number(c.startHour) * 3600;
        return !!(c.war && c.war.start) && at < Math.floor(c.war.start / 3600) * 3600;
    }
    // my timezone's offset from UTC in hours, now; a half-hour zone cannot line up with whole-hour slots, so those stay on TCT
    const avZone = () => -new Date().getTimezoneOffset() / 60;
    const avZoneOk = () => Number.isInteger(avZone());
    function renderAvailTab() {
        if (avData === null) return '<div style="padding:6px 0;color:#9aa4b5;">Loading the plan…</div>';
        if (avData.error) return `<div style="color:#e05555;padding:4px 0;">${esc(avData.error)}</div>`;
        const c = avData.config;
        if (!c) return '<div style="padding:6px 0;color:#9aa4b5;">There is no availability plan right now. A leader makes one for a war or a chain.</div>';
        const crowd = avData.crowd || {}, mine = avData.mine || {}, mineWatch = avData.mineWatch || {}, watchTaken = avData.watchTaken || {}, mineRole = avData.mineRole || {};
        const [y, m, d] = String(c.startDate).split('-').map(Number), isWar = !!(c.war && c.war.id), roleName = isWar ? 'War guard' : 'Chain saver';
        const local = avLocal && avZoneOk(), offset = local ? avZone() : 0;
        const total = c.endAt ? Math.min(c.days * 24, Math.ceil((c.endAt - Date.UTC(y, m - 1, d) / 1000) / 3600)) : c.days * 24;
        const nowIdx = Math.floor((Date.now() / 1000 - Date.UTC(y, m - 1, d) / 1000) / 3600);
        const max = Math.max(1, ...Object.values(crowd).map(v => v[0]));
        const tctDay = day => new Date(Date.UTC(y, m - 1, d + day)).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
        const colLabel = col => local && offset !== 0 ? new Date(y, m - 1, d + col).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }) : tctDay(col);
        const base = 'min-width:26px;height:16px;border:1px solid #333b49;';
        const cell = (idx, rowSoft) => {
            const day = Math.floor(idx / 24), hour = idx % 24, k = `${day}-${hour}`;
            if (idx < 0 || idx >= total || avClosed(c, day, hour)) return `<td style="${base}background:#12161c;${rowSoft}"></td>`;
            const cr = crowd[k] || [0, 0, 0], v = mine[k], watching = !!mineWatch[k], full = (watchTaken[k] || 0) >= 2 && !watching;
            const bg = avMode === 'all' ? (cr[0] ? `rgba(53,217,155,${(0.2 + cr[0] / max * 0.7).toFixed(2)})` : cr[1] ? 'rgba(240,180,50,.3)' : '#1b2029')
                : (v === 'maybe' ? '#f0b432' : v ? '#35d99b' : '#1b2029');
            let ring = '';
            if (avPick === k) ring = 'outline:2px solid #4da3ff;outline-offset:-2px;';
            else if (idx === nowIdx) ring = 'outline:2px solid #fff;outline-offset:-2px;';
            else if (avMode !== 'all' && watching) ring = `outline:2px solid #4da3ff;outline-offset:-2px;${mineRole[k] === 'backup' ? 'outline-style:dashed;' : ''}`;
            else if (avMode === 'all' && v) ring = 'box-shadow:inset 0 0 0 2px #fff6;';
            const txt = avMode === 'all' && cr[0] ? `<span style="font-size:9px;color:#06120d;">${cr[0]}</span>` : '';
            const dot = avMode === 'all' && cr[2] ? '<span style="font-size:7px;color:#4da3ff;">●</span>' : avMode === 'watch' && full ? '<span style="font-size:9px;color:#9aa4b5;">✕</span>' : '';
            return `<td class="wwl-av" data-k="${k}" style="${base}text-align:center;cursor:pointer;background:${bg};${ring}${rowSoft}">${txt}${dot}</td>`;
        };
        // like the site: a column per day, a row per hour; in your own timezone the hours are shifted and the days run midnight to midnight
        const minCol = Math.floor(offset / 24), maxCol = Math.floor((total - 1 + offset) / 24);
        let rows = '';
        for (let row = 0; row < 24; row++) {
            const rowSoft = (row + 1) % 6 === 0 && row < 23 ? 'border-bottom:1px solid #66748f;' : ''; // a stronger line every 6 hours
            let tds = '';
            for (let col = minCol; col <= maxCol; col++) tds += cell(col * 24 + row - offset, rowSoft);
            rows += `<tr><td style="font-size:9px;color:#9aa4b5;padding-right:3px;text-align:right;${rowSoft}">${String(row).padStart(2, '0')}</td>${tds}</tr>`;
        }
        let head = '<tr><td></td>';
        for (let col = minCol; col <= maxCol; col++) head += `<td style="font-size:9px;color:#9aa4b5;text-align:center;white-space:nowrap;">${esc(colLabel(col))}</td>`;
        head += '</tr>';
        const nowSlot = nowIdx >= 0 && nowIdx < total ? `${Math.floor(nowIdx / 24)}-${nowIdx % 24}` : null, nc = nowSlot ? crowd[nowSlot] || [0, 0, 0] : null;
        let info = '';
        if (avPick && avMode === 'all') {
            const [dd, hh] = avPick.split('-').map(Number), cr = crowd[avPick] || [0, 0, 0], v = mine[avPick];
            const ppl = avData.people || {}, nm = ids => (ids || []).map(i => esc(ppl[i] || ('#' + i))).join(', ');
            info = `<div style="margin-top:6px;font-size:12px;"><b>${esc(tctDay(dd))} ${String(hh).padStart(2, '0')}:00 TCT</b>: ${cr[0]} available${cr[1] ? `, ${cr[1]} maybe` : ''}${cr[2] ? `, ${cr[2]} watching` : ''}${v ? ` · you: ${v === 'maybe' ? 'maybe' : 'available'}` : ''}
                ${cr[3] && cr[3].length ? `<div style="margin-top:3px;">Available: ${nm(cr[3])}</div>` : ''}
                ${cr[4] && cr[4].length ? `<div style="margin-top:3px;color:#f0b432;">Maybe: ${nm(cr[4])}</div>` : ''}
                ${cr[5] && cr[5].length ? `<div style="margin-top:3px;color:#4da3ff;">Watching: ${nm(cr[5])}</div>` : ''}</div>`;
        }
        const btn = (id, label) => `<button type="button" class="wwl-av-mode" data-mode="${id}" style="padding:4px 8px;border-radius:6px;border:1px solid #3a4352;cursor:pointer;background:${avMode === id ? '#2a2f3a' : 'transparent'};color:#e6e9ef;">${label}</button>`;
        const zoneName = local ? `UTC${offset >= 0 ? '+' : ''}${offset}` : 'TCT';
        const tz = avZoneOk()
            ? `<label style="display:flex;gap:6px;align-items:center;margin:4px 0;font-size:12px;cursor:pointer;"><input type="checkbox" id="wwl-av-local" ${local ? 'checked' : ''}> Show times in my own timezone <span style="color:#9aa4b5;">(${zoneName})</span></label>`
            : '<div style="margin:4px 0;font-size:12px;color:#9aa4b5;">Your timezone has a half-hour offset, so the times stay in TCT.</div>';
        const hints = {
            all: 'Green = more members available (the number), ● = somebody watches the chain or war. White frame = now. Tap an hour to see who.',
            mine: 'Tap an hour: green = available, yellow = maybe, a third tap clears it. A blue frame is an hour where you watch. The same hours show on the WWL site.',
            watch: `Tap one of your hours to add or remove yourself as ${roleName} (blue frame; dashed = you are the backup). Each hour has room for one ${roleName} and one backup, ✕ = full. It also marks you as available.`,
        };
        return `<div style="font-weight:700;">${esc(c.name || 'Availability')}${c.war && c.war.opponent ? ` <span style="font-weight:400;color:#9aa4b5;">vs ${esc(c.war.opponent)}</span>` : ''}</div>
            <div style="font-size:12px;margin:4px 0;">${nc ? `Right now: <b>${nc[0]}</b> available${nc[1] ? `, ${nc[1]} maybe` : ''}, <b>${nc[2]}</b> watching.` : '<span style="color:#9aa4b5;">The plan is not running right now.</span>'}</div>
            <div style="display:flex;gap:6px;margin:6px 0;flex-wrap:wrap;">${btn('all', 'Everybody')}${btn('mine', 'My hours')}${btn('watch', `🔵 ${roleName}`)}</div>
            ${tz}
            <div style="overflow-x:auto;"><table style="border-collapse:collapse;">${head}${rows}</table></div>
            ${info}
            ${avMsg ? `<div style="color:#e05555;font-size:12px;margin-top:6px;">${esc(avMsg)}</div>` : ''}
            <div style="margin-top:6px;color:#9aa4b5;font-size:11px;">${hints[avMode]}${local ? ' Everything is saved in TCT, so the leaders see it in TCT.' : ''}</div>`;
    }
    function wireAvailTab() {
        body.querySelectorAll('.wwl-av-mode').forEach(b => b.addEventListener('click', () => { avMode = b.dataset.mode; avPick = null; avMsg = ''; render(); }));
        body.querySelector('#wwl-av-local')?.addEventListener('change', e => { avLocal = e.target.checked; store.set('wwl_av_local', avLocal ? '1' : '0'); render(); });
        body.querySelectorAll('.wwl-av').forEach(td => td.addEventListener('click', async () => {
            const k = td.dataset.k;
            if (avMode === 'all') { avPick = avPick === k ? null : k; render(); return; }
            const [day, hour] = k.split('-').map(Number), mine = avData.mine || (avData.mine = {}), mineWatch = avData.mineWatch || (avData.mineWatch = {});
            if (avMode === 'watch') {
                const was = !!mineWatch[k], wasMine = mine[k], isWar = !!(avData.config && avData.config.war && avData.config.war.id);
                if (!was && ((avData.watchTaken || {})[k] || 0) >= 2) { avMsg = `That hour already has a ${isWar ? 'War guard' : 'Chain saver'} and a backup: pick another hour.`; render(); return; }
                if (was) delete mineWatch[k]; else { mineWatch[k] = true; if (!mine[k]) mine[k] = true; }
                avMsg = ''; render();
                try { const r = await api({ action: 'availability-watch', day, hour, watch: !was, planId: avData.planId }); if (r && r.error) throw new Error(r.error); loadAvail(); } // read it again: who holds what (a backup moves up)
                catch (e) { if (was) mineWatch[k] = true; else delete mineWatch[k]; if (wasMine) mine[k] = wasMine; else delete mine[k]; avMsg = `Could not save that: ${e.message}`; render(); }
                return;
            }
            const prev = mine[k], next = !prev ? true : prev === true ? 'maybe' : undefined;
            if (next) mine[k] = next; else { delete mine[k]; delete mineWatch[k]; }
            try { const r = await api({ action: 'availability-set', day, hour, state: next === true ? 'yes' : next === 'maybe' ? 'maybe' : '', planId: avData.planId }); if (r && r.error) throw new Error(r.error); avMsg = ''; }
            catch (e) { if (prev) mine[k] = prev; else delete mine[k]; avMsg = `Could not save that: ${e.message}`; render(); }
        }));
    }
    // ---- To do: priority items (the crimes and the money come first, with a red mark), Claim and open, and the friendly reminders with a Send button per member ----
    let claimMsg = '';
    const grpOpen = {}; // which drop-downs of the To do are open (kept while the window redraws)
    function rowsHtml(t) {
        const icon = r => r.kind === 'demote' ? '⬇' : r.kind === 'check' ? '⚠' : r.kind === 'kick' ? '🚪' : r.kind === 'recruit' ? '⏳' : '⬆';
        return `<div style="margin:0 0 8px 10px;max-height:260px;overflow:auto;">${(t.rows || []).map(r => `<div style="display:flex;gap:6px;align-items:baseline;padding:4px 0;border-top:1px solid #2c3442;"><span>${icon(r)}</span><span style="flex:1;"><a href="https://www.torn.com/profiles.php?XID=${esc(r.id)}" target="_blank" rel="noopener" style="color:#e6e9ef;text-decoration:none;font-weight:600;">${esc(r.name)}</a> <span style="color:#9aa4b5;">${r.kind === 'kick' ? esc(r.from) + ': can be removed' : esc(r.from) + ' → ' + esc(r.to)}</span><div style="color:#9aa4b5;font-size:11px;">${esc(r.why || '')}</div></span></div>`).join('')}</div>`;
    }
    const INV_MSG_KEY = k => 'wwl_invite_msg_' + k, INV_AT_KEY = (k, id) => `wwl_invited_${k}_${id}`;
    const invDefault = k => k === 'script'
        ? `Hey, I have noticed you have not installed the WWL script yet (${WWL}/worldwidelabs.user.js). Please install it: it shows your to do list and energy plan right inside Torn. You need Tampermonkey on a computer, or add it as a script in TornPDA. Shout if you get stuck!`
        : `Hey, I have noticed you have not logged into WWL yet (${WWL}), please join with a limited API key. It takes a minute and gives you your energy plan, welcome chapters and more. Shout if you need help!`;
    const invMsg = k => store.get(INV_MSG_KEY(k)) || invDefault(k);
    function inviteHtml(t) {
        const kind = t.kind === 'script' ? 'script' : 'wwl', btn = 'background:transparent;border-radius:6px;padding:3px 8px;font-size:12px;cursor:pointer;';
        const rows = (t.members || []).map(m => {
            const at = Number(store.get(INV_AT_KEY(kind, m.id))) || 0;
            return `<div style="display:flex;gap:8px;align-items:center;padding:4px 0;border-top:1px solid #2c3442;${at ? 'opacity:.6;' : ''}"><a href="https://www.torn.com/profiles.php?XID=${esc(m.id)}" target="_blank" rel="noopener" style="flex:1;color:#e6e9ef;text-decoration:none;">${esc(m.name)}${at ? ' <span style="color:#9aa4b5;font-size:11px;">· reminded</span>' : ''}</a><button type="button" class="wwl-inv-send" data-kind="${kind}" data-id="${esc(m.id)}" data-name="${esc(m.name)}" style="${btn}border:1px solid #35d99b;color:#35d99b;">Send</button></div>`;
        }).join('');
        return `<div class="wwl-inv" data-kind="${kind}" style="margin:2px 0 8px 10px;padding:6px 8px;border:1px solid #3a4352;border-radius:6px;">
            <div style="font-size:11px;color:#9aa4b5;margin-bottom:3px;">Your message ({name} becomes their name):</div>
            <textarea class="wwl-inv-msg" rows="3" style="width:100%;box-sizing:border-box;background:#12161c;color:#e6e9ef;border:1px solid #3a4352;border-radius:6px;padding:4px;font-size:12px;">${esc(invMsg(kind))}</textarea>
            <div style="margin:3px 0 6px;"><button type="button" class="wwl-inv-save" style="${btn}border:1px solid #3a4352;color:#e6e9ef;">Save message</button> <button type="button" class="wwl-inv-reset" style="${btn}border:1px solid #3a4352;color:#e6e9ef;">Standard message</button> <span class="wwl-inv-note" style="font-size:11px;color:#9aa4b5;"></span></div>
            <div style="max-height:240px;overflow:auto;">${rows}</div>
            <div style="font-size:11px;color:#9aa4b5;margin-top:4px;">Send opens Torn's mail to that member with your message filled in (and copied). Check it and press Torn's own Send.</div></div>`;
    }
    function wireTodoExtras() {
        body.querySelectorAll('.wwl-close').forEach(b => b.addEventListener('click', async () => { // closes the request here and on the site (the same actions as the buttons there; Discord and the history follow)
            b.disabled = true; b.textContent = '…';
            try {
                await api({ action: b.dataset.close === 'bank' ? 'bank-done' : 'ocreq-done', id: b.dataset.id });
                claimMsg = b.dataset.close === 'bank' ? 'Marked as paid out: it is closed on the site too.' : 'Marked as spawned: it is closed on the site too.';
                todoItems = (todoItems || []).filter(i => i.rid !== b.dataset.id || i.close !== b.dataset.close);
                refreshTodoItems(true); render();
            } catch (e) { claimMsg = e.message; render(); }
        }));
        body.querySelectorAll('.wwl-grp').forEach(d => d.addEventListener('toggle', () => { grpOpen[d.dataset.id] = d.open; }));
        body.querySelectorAll('.wwl-claim').forEach(b => b.addEventListener('click', async () => {
            const label = b.textContent; b.disabled = true; b.textContent = 'Claiming…';
            const w = IS_PDA ? null : window.open('', '_blank'); // opened at once, on the tap, so the pop-up blocker lets it through; it goes to the right page when the claim is done
            try {
                const r = await api({ action: 'todo-claim', kind: b.dataset.claim });
                claimMsg = `${b.dataset.claim === 'bank' ? 'Bank request' : 'OC request'} of ${r.request.name} is yours${r.lowered ? ' (the amount was lowered to their balance)' : ''}.`;
                if (w) w.location.href = r.link; else window.location.href = r.link;
                refreshTodoItems(true);
                render();
            } catch (e) { if (w) w.close(); claimMsg = e.message; render(); }
        }));
        body.querySelectorAll('.wwl-inv-save').forEach(b => b.addEventListener('click', () => {
            const box = b.closest('.wwl-inv'); store.set(INV_MSG_KEY(box.dataset.kind), box.querySelector('.wwl-inv-msg').value); box.querySelector('.wwl-inv-note').textContent = 'Saved.';
        }));
        body.querySelectorAll('.wwl-inv-reset').forEach(b => b.addEventListener('click', () => {
            const box = b.closest('.wwl-inv'); store.set(INV_MSG_KEY(box.dataset.kind), ''); box.querySelector('.wwl-inv-msg').value = invDefault(box.dataset.kind); box.querySelector('.wwl-inv-note').textContent = 'Standard message back.';
        }));
        body.querySelectorAll('.wwl-inv-send').forEach(b => b.addEventListener('click', () => {
            const kind = b.dataset.kind, id = b.dataset.id, text = b.closest('.wwl-inv').querySelector('.wwl-inv-msg').value.replace(/\{name\}/g, b.dataset.name);
            store.set('wwl_pending_mail_' + id, JSON.stringify({ text, ts: Date.now() })); // the mail page fills it in (see pendingMail)
            store.set(INV_AT_KEY(kind, id), String(Date.now()));
            try { navigator.clipboard.writeText(text); } catch (e) { /* the page fills it in anyway */ }
            const url = `https://www.torn.com/messages.php#/p=compose&XID=${encodeURIComponent(id)}`;
            if (IS_PDA) window.location.href = url; else window.open(url, '_blank');
            b.textContent = 'Opened ✓'; b.parentElement.style.opacity = '.6';
        }));
    }
    function renderTodoTab() {
        const daily = `<label style="display:flex;gap:8px;align-items:center;padding:${IS_PDA ? 10 : 7}px 0;border-bottom:1px solid #3a4352;cursor:pointer;">
            <input type="checkbox" id="wwl-daily-check" ${getDailyChecked() ? 'checked' : ''} ${energyPaused() ? 'disabled' : ''} style="width:auto;">
            <span style="flex:1;">Check your energy plan${energyPaused() ? ` <span style="color:#9aa4b5;font-size:11px;">· not needed now: ${esc(energyPause.why)}</span>` : ''}</span>
        </label>`;
        const rest = todoItems === null ? '<div style="padding:6px 0;color:#9aa4b5;">Loading…</div>'
            : !todoItems.length ? ''
            : [...todoItems].sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0)).map(t => (t.members || t.rows) ? `<details class="wwl-grp" data-id="${esc(t.id)}" ${grpOpen[t.id] ? 'open' : ''} style="border-bottom:1px solid #3a4352;"><summary style="cursor:pointer;padding:${IS_PDA ? 10 : 7}px 0;list-style:none;display:flex;gap:8px;align-items:center;"><span style="color:#9aa4b5;">▾</span><span style="flex:1;">${esc(String(t.text).split(':')[0].replace(/[. ]+$/, ''))}</span></summary>${t.members ? inviteHtml(t) : rowsHtml(t)}</details>` : t.notice
                // a notice is just a reminder: a full-width amber box with the text, no button, not part of the count
                ? `<div style="padding:8px 10px;margin:6px 0;border:1px solid #f0b432;border-radius:6px;background:#f0b43218;color:#f0b432;font-weight:600;line-height:1.4;">${esc(t.text)}</div>`
                : `<div style="display:flex;gap:8px;align-items:center;padding:${IS_PDA ? 10 : 7}px 0;border-bottom:1px solid #3a4352;${t.priority ? 'border-left:3px solid #e05555;padding-left:8px;' : ''}">
                ${t.mine ? `<input type="checkbox" class="wwl-mt-check" data-id="${esc(t.myId)}" ${t.done ? 'checked' : ''} style="width:auto;">` : ''}
                <span style="flex:1;${t.mine && t.done ? 'text-decoration:line-through;color:#9aa4b5;' : ''}">${esc(t.text)}</span>
                ${t.mine ? `<span style="font-size:10px;color:#9aa4b5;border:1px solid #3a4352;border-radius:8px;padding:0 6px;">${t.repeat === 'daily' ? 'daily' : 'once'}</span>` : ''}
                ${t.close ? `${t.link ? `<a href="${esc(t.link)}" target="_blank" rel="noopener" style="color:#9aa4b5;white-space:nowrap;text-decoration:none;border:1px solid #3a4352;border-radius:6px;padding:4px 8px;font-size:12px;">Open</a>` : ''}<button type="button" class="wwl-close" data-close="${esc(t.close)}" data-id="${esc(t.rid)}" style="color:#35d99b;white-space:nowrap;background:transparent;border:1px solid #35d99b;border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;">${esc(t.cta)}</button>` : t.claim ? `<button type="button" class="wwl-claim" data-claim="${esc(t.claim)}" style="color:#e05555;white-space:nowrap;background:transparent;border:1px solid #e05555;border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;">${esc(t.cta)}</button>` : t.scriptTab ? `<button type="button" class="wwl-t-go" data-tab="${esc(t.scriptTab)}" style="color:#35d99b;white-space:nowrap;background:transparent;border:1px solid #35d99b;border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;">${esc(t.cta)}</button>` : t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener" style="color:#35d99b;white-space:nowrap;text-decoration:none;border:1px solid #35d99b;border-radius:6px;padding:4px 8px;font-size:12px;">${esc(t.cta)}</a>` : ''}
                ${t.lease ? `<span style="display:flex;gap:6px;flex-wrap:wrap;">
                    <button type="button" class="wwl-lease-copy" data-amount="${esc(String(t.lease.amount))}" style="background:transparent;border:1px solid #3a4352;border-radius:6px;padding:4px 8px;font-size:12px;color:#e6e9ef;cursor:pointer;">Copy amount</button>
                    ${t.lease.status === 'due' ? `<button type="button" class="wwl-lease" data-act="offer" data-id="${esc(t.lease.id)}" style="background:transparent;border:1px solid #f0b432;border-radius:6px;padding:4px 8px;font-size:12px;color:#f0b432;cursor:pointer;">Offered ✓</button>` : ''}
                    <button type="button" class="wwl-lease" data-act="pay" data-id="${esc(t.lease.id)}" style="background:transparent;border:1px solid #35d99b;border-radius:6px;padding:4px 8px;font-size:12px;color:#35d99b;cursor:pointer;">Paid ✓</button></span>` : ''}
            </div>${t.id === 'oc' ? ocRequestHtml(t) : ''}`).join('');
        const claimNote = claimMsg ? `<div style="padding:6px 10px;margin:6px 0;border:1px solid #35d99b;border-radius:6px;background:#35d99b18;color:#e6e9ef;">${esc(claimMsg)}</div>` : '';
        return claimNote + daily + rest;
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
    // "My own reminders" lives in ⚙ Settings (to keep the To do tab short): the list with a delete mark each, and the add row. The reminders
    // themselves show in the To do tab with a checkbox.
    function myRemindersBlock() {
        const mine = (todoItems || []).filter(t => t.mine);
        const addRow = `<div style="display:flex;gap:6px;margin-top:8px;"><input id="wwl-mt-input" maxlength="100" placeholder="Add a reminder of your own…" style="flex:1;min-width:0;background:#12161c;color:#e6e9ef;border:1px solid #3a4352;border-radius:6px;padding:6px;"><select id="wwl-mt-repeat" style="background:#12161c;color:#e6e9ef;border:1px solid #3a4352;border-radius:6px;padding:4px;"><option value="once">Once</option><option value="daily">Daily</option></select><button type="button" id="wwl-mt-add" style="padding:6px 10px;border-radius:6px;border:1px solid #35d99b;background:transparent;color:#35d99b;cursor:pointer;">Add</button></div><div style="color:#9aa4b5;font-size:11px;margin-top:4px;">Leaders can see what people add, to find reminders worth building for everyone.</div>`;
        return `<div style="margin-top:14px;padding-top:10px;border-top:1px solid #3a4352;"><div style="font-weight:700;margin-bottom:4px;">My own reminders</div>
            ${mine.length ? mine.map(t => `<div style="display:flex;gap:8px;align-items:center;padding:4px 0;font-size:12px;"><span style="flex:1;">${esc(t.text)}</span><span style="font-size:10px;color:#9aa4b5;border:1px solid #3a4352;border-radius:8px;padding:0 6px;">${t.repeat === 'daily' ? 'daily' : 'once'}</span><span class="wwl-mt-del" data-id="${esc(t.myId)}" title="Delete this reminder" style="cursor:pointer;color:#e05555;">✕</span></div>`).join('') : '<div style="color:#9aa4b5;font-size:12px;">None yet. They show in the To do tab with a checkbox.</div>'}
            ${addRow}</div>`;
    }
    function renderSettingsTab() {
        const updateHtml = updateAvailable ? `<div style="color:#f0b432;margin:6px 0;">⬆ Update available: v${esc(updateAvailable)} — <a href="${WWL}/worldwidelabs.user.js" target="_blank" rel="noopener" style="color:#f0b432;">open the install link</a> and Tampermonkey will offer to update.</div>` : '';
        // Closing a banner's × dismisses it in this browser forever (see renderTornBanner) — a leader
        // adding a new one has no way to tell that's why an old one they still have live isn't showing,
        // so surface a way back rather than leaving it a silent, permanent mystery.
        const dismissedCount = Object.keys(banDismissed()).length;
        const undismissHtml = dismissedCount ? `<button type="button" id="wwl-ban-undismiss" style="margin-top:8px;padding:6px 12px;border-radius:6px;border:1px solid #3a4352;background:transparent;color:#e6e9ef;cursor:pointer;">Show ${dismissedCount} dismissed banner${dismissedCount === 1 ? '' : 's'} again</button>` : '';
        let html = `<button type="button" id="wwl-back" style="margin-bottom:10px;padding:4px 10px;border-radius:6px;border:1px solid #3a4352;background:transparent;color:#e6e9ef;cursor:pointer;">← Back</button>
            <div style="font-weight:700;margin-bottom:4px;">World Wide Labs v${esc(SCRIPT_VERSION)}</div>
            ${updateHtml}
            <button type="button" id="wwl-change-key" style="margin-top:4px;padding:6px 12px;border-radius:6px;border:1px solid #3a4352;background:transparent;color:#e6e9ef;cursor:pointer;">Change API key</button>
            ${undismissHtml}`;
        html += `<label style="display:flex;gap:8px;align-items:center;margin-top:10px;font-size:13px;cursor:pointer;"><input type="checkbox" id="wwl-radar-on" ${radarOn() ? 'checked' : ''}> Show the faction radar (who is online and idle) at the top of Torn pages</label>`;
        html += myRemindersBlock();
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
        body.querySelector('#wwl-radar-on')?.addEventListener('change', e => { store.set(RADAR_ON, e.target.checked ? '1' : '0'); if (e.target.checked) { radarLast = 0; refreshRadar(true); } else renderRadar(); });
        body.querySelector('#wwl-change-key')?.addEventListener('click', () => {
            const current = store.get(KEY_NAME) || '';
            const masked = current ? `${current.slice(0, 4)}…${current.slice(-4)}` : 'not set';
            const input = prompt(`World Wide Labs v${SCRIPT_VERSION}\n\nCurrent API key: ${masked}\n\nPaste a new key to replace it, or leave blank to keep the current one.`, '');
            if (input === null) return;
            const trimmed = input.trim();
            if (!trimmed) return;
            store.set(KEY_NAME, trimmed);
            store.set(CHECKIN_NAME, '0'); // a new key may be a different member — check in straight away, not after the hour is up
            checkIn();
            refreshTornBanners();
            load();
        });
        body.querySelector('#wwl-ban-undismiss')?.addEventListener('click', () => {
            store.set(BAN_DISMISS_NAME, '{}');
            renderTornBanner();
            render();
        });
        body.querySelectorAll('.wwl-ban-del').forEach(x => x.addEventListener('click', async () => {
            if (!confirm('Delete this banner?')) return;
            try { await api({ action: 'banners-delete', id: x.dataset.id }); loadSettings(); refreshTornBanners(); }
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
                refreshTornBanners();
            } catch (e) { st.style.color = '#e05555'; st.textContent = e.message; btn.disabled = false; }
        });
    }
    // A small banner right in the window, not just a dot buried in ⚙ Settings, so an update is hard to miss
    // wherever you're looking. Not shown on the Settings tab itself — it already has its own, fuller version line.
    function updateBanner() {
        if (!updateAvailable) return '';
        return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;margin-bottom:8px;background:#f0b43222;border:1px solid #f0b432;border-radius:6px;font-size:12px;color:#f0b432;">
            <span style="flex:1;">⬆ Update available: v${esc(updateAvailable)}</span>
            <a href="${WWL}/worldwidelabs.user.js" target="_blank" rel="noopener" style="color:#f0b432;text-decoration:underline;white-space:nowrap;">Update now</a>
        </div>`;
    }
    function render() {
        if (tab === 'mentoring') tab = lastTab = 'labnotes'; // the Mentoring tab is gone from the script: the Notes tab has the same chapters (the chat is on the site)
        if (tab === 'settings') { body.innerHTML = renderSettingsTab(); wireSettingsTab(); wireMyTodo(); try { checkForUpdate(true); } catch (e) { /* the script is still starting up - the passive check will run */ } return; }
        const tabContent = tab === 'labnotes' ? renderLabTab() : tab === 'bank' ? renderBankTab() : tab === 'avail' ? renderAvailTab() : tab === 'targets' ? renderTargetsTab() : tab === 'todo' ? renderTodoTab() : renderEnergyTab();
        body.innerHTML = updateBanner() + renderStandingStrip() + tabBar() + tabContent;
        showProgress();
        wireTabs();
        wireOcRequest();
        wireMyTodo();
        wireBankTab();
        wireAvailTab();
        wireTodoExtras();
        body.querySelector('#wwl-targets-refresh')?.addEventListener('click', refreshTargetStatus);
        body.querySelector('#wwl-daily-check')?.addEventListener('change', e => { setDailyChecked(e.target.checked); render(); });
        const setStart = async v => {
            try { const r = await api({ action: 'plan-start', startDay: v }); if (r.plan) { plan = r.plan; try { store.set('wwl_plan_cache', JSON.stringify({ at: Date.now(), plan })); } catch (e) { /* not critical */ } } } catch (e) { alert(e.message); }
            render();
        };
        body.querySelector('#wwl-start')?.addEventListener('change', e => setStart(e.target.value));
        body.querySelector('#wwl-start-auto')?.addEventListener('click', () => setStart(''));
        body.querySelector('#wwl-afterday')?.addEventListener('change', async e => {
            try { const r = await api({ action: 'plan-afterday', next: e.target.value === 'next' }); if (r.plan) { plan = r.plan; try { store.set('wwl_plan_cache', JSON.stringify({ at: Date.now(), plan })); } catch (err) { /* not critical */ } } } catch (err) { alert(err.message); }
            render();
        });
        body.querySelectorAll('.wwl-track').forEach(b => b.addEventListener('click', async () => {
            try { const r = await api({ action: 'plan-track', mode: b.dataset.mode }); if (r.plan) { plan = r.plan; try { store.set('wwl_plan_cache', JSON.stringify({ at: Date.now(), plan })); } catch (e) { /* not critical */ } } } catch (e) { /* the bar stays as it was */ }
            render();
        }));
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
        body.querySelectorAll('.wwl-w-det').forEach(d => d.addEventListener('toggle', () => { welOpen[d.dataset.k] = d.open; }));
        body.querySelectorAll('.wwl-t-go').forEach(b => b.addEventListener('click', () => { tab = lastTab = b.dataset.tab; render(); }));
        // the owner's lease lines: copy the amount, mark "I offered the lease" or "the tenant paid" (each click is one request; the To do list is re-read afterwards)
        body.querySelectorAll('.wwl-lease-copy').forEach(b => b.addEventListener('click', () => { const v = b.dataset.amount; (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).catch(() => { const ta = document.createElement('textarea'); ta.value = v; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) { /* manual copy */ } ta.remove(); }); b.textContent = 'Copied'; }));
        body.querySelectorAll('.wwl-lease').forEach(b => b.addEventListener('click', async () => {
            b.disabled = true;
            try { await api({ action: b.dataset.act === 'pay' ? 'lt-pay' : 'lt-offer', id: b.dataset.id }); await refreshTodoItems(true); } catch (e) { b.disabled = false; b.textContent = 'Failed'; }
        }));
        body.querySelectorAll('.wwl-w-check').forEach(cb => cb.addEventListener('change', async () => {
            try { await api({ action: 'wel-done', id: cb.dataset.id, done: cb.checked }); welMine = await api({ action: 'wel-my' }); } catch (e) { /* shown on next load */ }
            render();
        }));
        body.querySelectorAll('.wwl-lab-check').forEach(cb => cb.addEventListener('change', async () => {
            try { await api({ action: 'wel-done', id: cb.dataset.id, done: cb.checked }); labData = await api({ action: 'lab-get' }); } catch (e) { /* shown on next load */ }
            render();
        }));
        body.querySelectorAll('.wwl-lab-remind').forEach(cb => cb.addEventListener('change', async () => {
            try { await api({ action: 'lab-reminders', cardId: cb.dataset.id, on: cb.checked }); labData = await api({ action: 'lab-get' }); await refreshTodoItems(true); } catch (e) { cb.checked = !cb.checked; }
            render();
        }));
        body.querySelectorAll('.wwl-w-mtick').forEach(cb => cb.addEventListener('change', async () => {
            try { welPupils[cb.dataset.pupil] = await api({ action: 'wel-mentor-tick', pupilId: cb.dataset.pupil, id: cb.dataset.id, done: cb.checked }); } catch (e) { /* shown on next load */ }
            render();
        }));
    }
    // Calls kept on this device for a few minutes: with the window left open, every Torn page load used to ask the server for the plan, the mentoring status and the To do again (3 calls a page).
    // Now a page load uses what was fetched in the last minutes; opening the window by hand, a new key or a click on the To do tab still asks fresh.
    const cacheGet = (name, ttl) => { try { const c = JSON.parse(store.get('wwl_c_' + name) || 'null'); return c && Date.now() - c.at < ttl ? c.data : null; } catch (e) { return null; } };
    const cachedApi = (name, ttl, body, force) => { const hit = force ? null : cacheGet(name, ttl); return hit ? Promise.resolve(hit) : api(body).then(r => { try { store.set('wwl_c_' + name, JSON.stringify({ at: Date.now(), data: r })); } catch (e) { /* storage full: just no cache */ } return r; }); };
    async function load(force = false) {
        body.innerHTML = '<div style="padding:6px 0;color:#9aa4b5;">Loading…</div>';
        try {
            // The standing numbers (energy trained this month, wars) only move about once a day, so they're
            // kept locally for 30 minutes rather than fetched on every window open / page load.
            let standingCached = null; try { standingCached = JSON.parse(store.get('wwl_standing_cache') || 'null'); } catch (e) { /* none */ }
            const standingFresh = standingCached && Date.now() - standingCached.at < 30 * 60000;
            const [planR, mtR, todoR, standingR] = await Promise.all([
                cachedApi('plan', 300000, { action: 'plan-get' }, force),
                cachedApi('mentor', 600000, { action: 'mentor-my-status' }, force).catch(() => null), // fine if this member isn't in the program at all
                cachedApi('todo', todoCacheTtl(), { action: 'member-todo', close: 1 }, force).catch(() => null),
                standingFresh ? Promise.resolve(standingCached.data) : api({ action: 'mo-me' }).catch(() => null), // the standing strip — fine if it fails, the strip just stays blank
            ]);
            plan = planR.plan; store.set('wwl_plan_cache', JSON.stringify({ at: Date.now(), plan }));
            mtPairs = mtR?.pairs || []; mtTodos = mtR?.todos || [];
            mtIsPupil = !!mtR?.isPupil;
            welMine = null; welPupils = {}; welInsights = {};
            const welJobs = []; // the welcome chapters: a pupil's own, and each pupil a mentor looks after (only for people in the program)
            if (mtIsPupil) welJobs.push(api({ action: 'wel-my' }).then(r => { welMine = r; }).catch(() => { /* shows nothing */ }));
            for (const p of mtPairs) if (p.role === 'mentor') welJobs.push(api({ action: 'wel-pupil', pupilId: p.otherId }).then(r => { welPupils[p.otherId] = r; }).catch(() => { /* shows nothing */ }));
            for (const p of mtPairs) if (p.role === 'mentor') welJobs.push(api({ action: 'wel-pupil-insight', pupilId: p.otherId }).then(r => { welInsights[p.otherId] = r; }).catch(() => { /* shows nothing */ }));
            await Promise.all(welJobs);
            todoItems = todoR?.items || []; energyPause = todoR?.energyPause || null;
            standing = standingR;
            if (standingR && !standingFresh) store.set('wwl_standing_cache', JSON.stringify({ at: Date.now(), data: standingR }));
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
        Promise.all([api({ action: 'plan-get' }), api({ action: 'member-todo', close: 1 }).catch(() => null)])
            .then(([r, todoR]) => {
                plan = r.plan; if (todoR) { todoItems = todoR.items || []; energyPause = todoR.energyPause || null; }
                showProgress();
                store.set('wwl_plan_cache', JSON.stringify({ at: Date.now(), plan }));
            }).catch(() => {});
    }

    // "I'm here" check-in for Who's on board's Userscript column — a real signal, throttled to about
    // once an hour per browser so it reflects actual use, not just having installed it once.
    // The "done for an hour" stamp is only written once the server actually accepted it (it used to be
    // written first, so a failed call — e.g. the old server-side leaders-only rejection — silently blocked
    // any retry for an hour), and Settings calls this right after a key is saved, so a brand-new member
    // shows up straight away instead of only on their next page load.
    const CHECKIN_NAME = 'wwl_script_checkin_at', CHECKIN_VER = 'wwl_script_checkin_v';
    function checkIn() {
        // once an hour — or right away after the script was updated, so the new version shows up in Who's on board
        const justUpdated = store.get(CHECKIN_VER) !== SCRIPT_VERSION;
        if (!getKey() || (!justUpdated && Date.now() - Number(store.get(CHECKIN_NAME) || 0) < 3600000)) return;
        api({ action: 'script-checkin', v: SCRIPT_VERSION, pda: IS_PDA }).then(() => { store.set(CHECKIN_NAME, String(Date.now())); store.set(CHECKIN_VER, SCRIPT_VERSION); }).catch(() => {});
    }
    checkIn();

    // Tampermonkey's own @updateURL check only runs on its own schedule in the background and never
    // surfaces anything inside the script itself. This flags a newer version proactively (checked every
    // ~6 hours) via the 'script-version' action, which reads the live file's own @version line
    // server-side — actually applying the update still needs Tampermonkey (or the install link), this
    // just makes it visible sooner. Goes through the same api()/post() every other call already uses
    // (GM_xmlhttpRequest on a computer, PDA_httpPost on TornPDA), unlike the raw GET-and-regex fetch this
    // used to do, which only worked on a computer — TornPDA's script manager has no GET-capable bridge,
    // only a POST one, so version-flagging silently never happened there at all.
    const UPDATE_CHECK_NAME = 'wwl_update_check';
    function markUpdateAvailable(v) {
        updateAvailable = v;
        const dot = win.querySelector('#wwl-settings-dot');
        if (dot) dot.style.display = v ? 'block' : 'none';
        pillDot.style.display = v ? 'block' : 'none';
        render(); // refresh whichever tab is showing right now, so the banner appears immediately
    }
    let updateCached = null; try { updateCached = JSON.parse(store.get(UPDATE_CHECK_NAME) || 'null'); } catch (e) { /* none */ }
    if (updateCached?.remote && versionGreater(updateCached.remote, SCRIPT_VERSION)) markUpdateAvailable(updateCached.remote);
    // The version question needs no key and costs the server no database command (the number is public), so it is
    // asked without api(): passively about every 6 hours, and again whenever ⚙ Settings is opened (at most every
    // 5 minutes), so a new version shows up as soon as someone looks instead of hours later.
    function checkForUpdate(force) {
        const age = updateCached ? Date.now() - updateCached.at : Infinity;
        if (age < (force ? 300000 : 6 * 3600000)) return;
        post(`${WWL}/api/war-payout`, { action: 'script-version' }).then(r => {
            updateCached = { at: Date.now(), remote: r.version };
            store.set(UPDATE_CHECK_NAME, JSON.stringify(updateCached));
            if (r.version && versionGreater(r.version, SCRIPT_VERSION)) markUpdateAvailable(r.version);
        }).catch(() => {});
    }
    checkForUpdate(false);

    // ---- Torn-wide banners: the same ones a leader sets in Leader settings → Banners on the WWL
    // site, shown here too since faction messages posted in Torn's own event feed get lost. Inserted
    // in normal document flow (not a fixed overlay) at the very top of the page, so it pushes Torn's
    // own content down rather than risking covering anything. Re-checked every ~10 minutes, or right
    // away if it was ⚙ Settings that just changed one (see refreshTornBanners below).
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
    const radarBar = document.createElement('div'); // the faction radar strip, right under the banner (see further down)
    radarBar.id = 'wwl-radar';
    radarBar.style.cssText = 'display:none;position:relative;z-index:99989;font:12px/1.5 Arial,sans-serif;background:#12161c;color:#e6e9ef;border-bottom:1px solid #3a4352;padding:4px 10px;';
    banBar.parentNode.insertBefore(radarBar, banBar.nextSibling);
    let banList = [], banIdx = 0, banTimer = null;
    // The pill uses a fixed "top" — it doesn't know the banner is there, so once one renders it would
    // otherwise sit half-covered by it. Repositioned to sit just below the banner's actual height
    // every time it changes (left for a computer, right on TornPDA — either way, just needs pushing down).
    function repositionForBanner() {
        const h = (banBar.style.display === 'none' ? 0 : banBar.offsetHeight) + (radarBar.style.display === 'none' ? 0 : radarBar.offsetHeight);
        pill.style.top = `${h + (IS_PDA ? 8 : PILL_TOP)}px`;
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
    // A leader adding or deleting their own banner via ⚙ Settings only ever refreshed the management
    // list there — the actual rotating banner kept showing whatever was cached (up to 10 minutes old),
    // which is exactly what made a just-added banner look like it hadn't shown up, or a deleted one look
    // like it was still stuck. Settings now calls this right after a successful add/delete too.
    function refreshTornBanners() {
        if (!getKey()) return;
        return api({ action: 'banners-get' }).then(r => {
            banList = r.banners || [];
            store.set(BAN_CACHE_NAME, JSON.stringify({ at: Date.now(), banners: banList }));
            renderTornBanner();
        }).catch(() => {});
    }
    let banCached = null; try { banCached = JSON.parse(store.get(BAN_CACHE_NAME) || 'null'); } catch (e) { /* none */ }
    if (banCached?.banners) { banList = banCached.banners; renderTornBanner(); }
    // 10 minutes: every Torn page load of every member goes through here, so shortening it multiplies
    // database calls across the whole faction. ⚙ Settings refreshes it immediately when a leader changes one.
    if (!(banCached && Date.now() - banCached.at < 600000)) refreshTornBanners();

    // ---- Faction radar: who of the faction is online or idle right now, in a strip under the banner on every Torn page (switch in ⚙ Settings) ----
    // One call at most once a minute per page load (the server keeps its answer for a minute for the whole faction), and only the Refresh link asks again sooner (not before 15 seconds).
    const RADAR_ON = 'wwl_radar_on', RADAR_CACHE = 'wwl_radar_cache';
    const radarOn = () => store.get(RADAR_ON) !== '0';
    let radarData = null, radarBusy = false, radarLast = 0;
    function renderRadar() {
        if (!radarOn() || !radarData) { radarBar.style.display = 'none'; repositionForBanner(); return; }
        // the dot is the status (green online, orange idle); the name is coloured by what that member said about this hour in the availability plan
        const NAME_COLOR = { yes: '#35d99b', maybe: '#ff922b', watch: '#4da3ff' }, anyPlan = [...radarData.online, ...radarData.idle].some(p => p.a);
        const one = (p, c) => `<a href="https://www.torn.com/profiles.php?XID=${esc(p.id)}" style="color:${NAME_COLOR[p.a] || '#e6e9ef'};${p.a === 'watch' ? 'font-weight:700;' : ''}text-decoration:none;white-space:nowrap;"><span style="color:${c};">●</span> ${esc(p.name)}</a>`;
        const names = [...radarData.online.map(p => one(p, '#35d99b')), ...radarData.idle.map(p => one(p, '#f0a030'))];
        radarBar.style.display = 'block';
        radarBar.innerHTML = `<div style="display:flex;justify-content:space-between;gap:8px;"><b style="color:#4da3ff;">FACTION RADAR (Online: ${radarData.online.length} | Idle: ${radarData.idle.length})</b><a href="#" id="wwl-radar-refresh" style="color:#9aa4b5;">Refresh</a></div>
            <div style="display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:2px;">${names.join('') || '<span style="color:#9aa4b5;">Nobody is online right now.</span>'}</div>
            ${radarData.planName !== undefined && (anyPlan || radarData.planName) ? `<div style="margin-top:3px;color:#9aa4b5;font-size:11px;">Name colour, this hour in the plan${radarData.planName ? ` (${esc(radarData.planName)})` : ''}: <span style="color:#35d99b;">available</span> · <span style="color:#ff922b;">maybe</span> · <b style="color:#4da3ff;">watching</b></div>` : ''}`;
        radarBar.querySelector('#wwl-radar-refresh').addEventListener('click', e => { e.preventDefault(); refreshRadar(true); });
        repositionForBanner();
    }
    function refreshRadar(force) {
        if (!getKey() || radarBusy) return;
        if (!radarOn()) { renderRadar(); return; }
        if (Date.now() - radarLast < (force ? 15000 : 60000)) return;
        radarBusy = true;
        api({ action: 'faction-radar' }).then(r => {
            if (!r || !Array.isArray(r.online)) return;
            radarData = r; radarLast = Date.now();
            store.set(RADAR_CACHE, JSON.stringify({ at: radarLast, data: r }));
            renderRadar();
        }).catch(() => { /* the strip just keeps what it had */ }).finally(() => { radarBusy = false; });
    }
    try { const c = JSON.parse(store.get(RADAR_CACHE) || 'null'); if (c && c.data && Array.isArray(c.data.online)) { radarData = c.data; radarLast = c.at || 0; renderRadar(); } } catch (e) { /* nothing cached */ }
    refreshRadar(false);

    // ---- Mail fill: the Send button of a friendly reminder (To do) opens Torn's mail page for that member; this fills in the message the leader wrote ----
    // Only on Torn's mail page, only for a message that was prepared in the last 15 minutes for the member whose page it is, and only into the real mail editor (never the chat box).
    (function pendingMail() {
        if (location.pathname !== '/messages.php') return;
        let busy = false;
        const setNative = (el, val) => {
            const setter = Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value');
            if (setter && setter.set) setter.set.call(el, val); else el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const run = () => {
            const xid = (location.hash.match(/XID=(\d+)/) || [])[1];
            if (!xid || busy || !/p=compose/.test(location.hash)) return;
            const KEY = 'wwl_pending_mail_' + xid;
            let p = null; try { p = JSON.parse(store.get(KEY) || 'null'); } catch (e) { p = null; }
            if (!p || Date.now() - p.ts > 15 * 60000) { if (p) store.set(KEY, ''); return; }
            busy = true;
            const stop = () => { clearInterval(iv); busy = false; };
            const iv = setInterval(() => {
                if (document.hidden) return; // a tab opened in the background is filled when it is shown
                if (Date.now() - p.ts > 15 * 60000) { store.set(KEY, ''); stop(); return; }
                const subject = document.querySelector('input[name="subject"], input[placeholder*="ubject"]');
                if (subject && !subject.value) setNative(subject, 'World Wide Labs');
                const field = document.querySelector('.mce-content-body[contenteditable="true"], .editor-content[contenteditable="true"]') || document.querySelector('textarea[name="body"]');
                if (!field) return;
                if (field.tagName === 'TEXTAREA') { setNative(field, p.text); store.set(KEY, ''); stop(); return; }
                field.focus(); document.execCommand('selectAll', false, null); document.execCommand('insertText', false, p.text);
                const probe = p.text.replace(/\s+/g, ' ').slice(0, 25), has = () => (field.innerText || '').replace(/\s+/g, ' ').includes(probe);
                if (!has()) { field.innerHTML = p.text.split('\n').map(l => '<p>' + (l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') || '<br>') + '</p>').join(''); field.dispatchEvent(new Event('input', { bubbles: true })); }
                if (has()) { store.set(KEY, ''); stop(); }
            }, 1000);
        };
        run();
        window.addEventListener('hashchange', run);
    })();

    // ---- Trade helper: for the traders of Trading Funding (on Torn's trade pages only) ----
    // Reads the trade page itself (no Torn API key, nothing polled): the total of the other person's items at your WWL pricelist, the money filled in for you,
    // a check that blocks Accept when the money does not match, and a finished trade saved to your WWL trading ledger. Anyone who is not a trader gets one
    // "not a trader" answer from WWL, which is remembered for an hour, and then the helper stays silent.
    (function tradeHelper() {
        if (location.pathname !== '/trade.php' || !getKey()) return;
        const NOT_TRADER = 'wwl_trade_not_trader', REC = id => `wwl_trade_${id}`, SAVED = id => `wwl_trade_saved_${id}`;
        if (Date.now() - Number(store.get(NOT_TRADER) || 0) < 3600000) return;
        const hashParam = n => new URLSearchParams(location.hash.replace(/^#\/?/, '')).get(n);
        const moneyOf = s => { const m = String(s || '').match(/\$([\d,]+)/); return m ? parseInt(m[1].replace(/,/g, ''), 10) : 0; };
        const fmt = n => '$' + Math.round(n).toLocaleString('en-US');
        const q1 = (s, r = document) => r.querySelector(s);
        // a player's name from a trade page header: the header also holds a "Hide item values" button, so only the name's own text counts
        const headName = h => {
            if (!h) return '';
            let t = ''; for (const c of h.childNodes) if (c.nodeType === 3 && c.nodeValue.trim()) { t = c.nodeValue; break; }
            return (t || h.textContent || '').replace(/(hide|show) item values/ig, '').replace(/'s items.*$/i, '').replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
        };
        const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const readJson = k => { try { return JSON.parse(store.get(k) || 'null'); } catch (e) { return null; } };
        // records of trades older than a week are cleared once per page load
        try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith('wwl_trade_') && k !== NOT_TRADER) { const r = readJson(k); if (!r || Date.now() - (r.at || 0) > 7 * 86400000) localStorage.removeItem(k); } } } catch (e) { /* not cleared */ }

        let stopped = false;
        const call = body => api(body);
        const bar = () => {
            let b = document.getElementById('wwl-trade-bar');
            const anchor = q1('.trade-cont.m-top10') || q1('.init-trade');
            if (!anchor) return null;
            if (!b || !b.isConnected) {
                b = document.createElement('div'); b.id = 'wwl-trade-bar';
                b.style.cssText = 'margin:8px 0;padding:10px 12px;background:#1b2029;border:1px solid #35d99b;border-radius:6px;color:#e6e9ef;font:13px/1.45 Arial,sans-serif;';
                anchor.parentNode.insertBefore(b, anchor);
            }
            return b;
        };
        const setBar = (html, wire) => { const b = bar(); if (!b) return; if (b.dataset.sig !== html) { b.dataset.sig = html; b.innerHTML = html; if (wire) wire(b); } };
        const dropBar = () => { const b = document.getElementById('wwl-trade-bar'); if (b) b.remove(); };
        const btn = (id, text) => `<button id="${id}" type="button" style="margin-left:8px;padding:3px 10px;background:#2a3140;color:#e6e9ef;border:1px solid #44506a;border-radius:4px;cursor:pointer;font:12px Arial,sans-serif;">${text}</button>`;
        const parseItem = n => {
            const text = ((n.childNodes[0] && n.childNodes[0].nodeValue) || n.textContent || '').trim();
            if (!text || /no items in trade/i.test(text)) return null;
            const m = text.match(/^(.+?)(?:\s+x(\d+))?$/); return m ? { name: m[1].trim(), qty: parseInt(m[2] || '1', 10) } : null;
        };
        const readItems = (root, sel) => { const out = {}; root.querySelectorAll(sel).forEach(n => { const it = parseItem(n); if (it) out[it.name] = (out[it.name] || 0) + it.qty; }); return out; };

        // ---- an open trade: the total at your pricelist, a receipt to share, and the check on Accept ----
        const prices = {}; let pricing = false, priceError = '', setDefs = {}; // setDefs: the sets on your list that this trade has a full set of (name -> parts)
        const needPrices = names => {
            const now = Date.now(), missing = names.filter(n => !prices[n] || now - prices[n].at > 300000);
            if (!missing.length || pricing) return;
            pricing = true;
            call({ action: 'led-prices', names })
                .then(r => { if (r.listed === 0) { store.set(NOT_TRADER, String(Date.now())); stopped = true; dropBar(); setAcceptBlock(realAccept(), false, ''); return; } Object.keys(r.prices || {}).forEach(n => { prices[n] = { price: r.prices[n] || 0, at: Date.now() }; }); setDefs = r.sets || {}; priceError = ''; })
                .catch(e => { priceError = e.message; missing.forEach(n => { prices[n] = { price: 0, at: Date.now() - 270000 }; }); })
                .finally(() => { pricing = false; });
        };
        const realAccept = () => q1('.btn.accept.torn-btn.green');
        const setAcceptBlock = (acc, block, why) => { if (acc) { acc.style.pointerEvents = block ? 'none' : ''; acc.style.opacity = block ? '.35' : ''; acc.title = block ? why : ''; } };
        const acceptAnyway = {}; // trades where "Accept anyway" was chosen
        // The receipt: a page anybody can open with the items and prices of this trade. It is saved (again) whenever the items or prices change, and the link is kept with the trade.
        const receipts = {}; // trade id -> { sig, url, busy }
        const partnerOf = cont => {
            const name = headName(q1('.user.right .title-black', cont));
            let me = ''; try { me = String(JSON.parse(q1('#torn-user').value).id); } catch (e) { me = ''; }
            const ids = [...document.querySelectorAll('#trade-container a[href*="XID="]')].map(a => (a.href.match(/XID=(\d+)/) || [])[1]).filter(x => x && x !== me);
            return { name, id: ids[0] || '' };
        };
        function saveReceipt(id, lines, partner) {
            const sig = JSON.stringify([lines, partner]), r = receipts[id] || (receipts[id] = { sig: '', url: '', busy: false });
            if (r.busy || r.sig === sig) return;
            r.busy = true; r.sig = sig;
            call({ action: 'led-receipt-save', tradeId: id, partner, lines, base: WWL }).then(res => { if (!res.token) throw new Error('no receipt'); r.message = res.message || ''; r.url = `${WWL}/?tradereceipt=${res.token}`; const rec = readJson(REC(id)); if (rec) { rec.receipt = r.url; store.set(REC(id), JSON.stringify(rec)); } })
                .catch(() => { r.sig = ''; }).finally(() => { r.busy = false; });
        }
        function viewTick(id) {
            const cont = q1('.trade-cont.m-top10'); if (!cont) return;
            const acc = realAccept();
            const items = readItems(cont, '.user.right .cont li.color2 ul.desc li .name.left'), names = Object.keys(items);
            if (!names.length) { setAcceptBlock(acc, false); dropBar(); return; }
            needPrices(names);
            const inTrade = moneyOf((q1('.user.left .cont li.color1 ul.desc li .name.left', cont) || {}).textContent);
            let total = 0, unpriced = 0; const rows = [], left = { ...items }, setLines = [], lines = [];
            // a set is not an item: one of each part is priced as the set on your list (as often as there are full sets), and the parts that are left one by one
            for (const [setName, parts] of Object.entries(setDefs)) {
                const sp = prices[setName] ? prices[setName].price : 0, count = sp ? Math.min(...parts.map(p => left[p] || 0)) : 0;
                if (!count) continue;
                parts.forEach(p => { left[p] -= count; });
                total += count * sp; setLines.push({ name: setName, count, price: sp }); lines.push({ name: setName, qty: count, price: sp });
                rows.push(`<div style="color:#aab2c3;">${count}x ${esc(setName)} (one of each of its ${parts.length} items) — ${fmt(sp)} each, ${fmt(count * sp)}</div>`);
            }
            for (const n of names) {
                if (!left[n]) continue;
                const p = prices[n] ? prices[n].price : 0, line = p * left[n]; total += line; if (!p) unpriced++; else lines.push({ name: n, qty: left[n], price: p });
                rows.push(`<div style="color:${p ? '#aab2c3' : '#f0b432'};">${left[n]}x ${esc(n)} — ${p ? `${fmt(p)} each, ${fmt(line)}` : 'no price on your list'}</div>`);
            }
            const waiting = pricing || (!priceError && names.some(n => !prices[n])), ready = !waiting && !priceError && total > 0 && !unpriced;
            const diff = inTrade - total, mismatch = ready && inTrade > 0 && inTrade !== total && !acceptAnyway[id];
            if (ready) {
                const old = readJson(REC(id)) || {};
                store.set(REC(id), JSON.stringify({ total, at: Date.now(), sets: setLines, receipt: (receipts[id] && receipts[id].url) || old.receipt || '', items: Object.fromEntries(names.map(n => [n, { qty: items[n], price: prices[n] ? prices[n].price : 0 }])) }));
                saveReceipt(id, lines, partnerOf(cont));
            }
            // the real Accept button stays blocked only while there is money in the trade that is not the total ("Accept anyway" lifts it)
            setAcceptBlock(acc, mismatch, `WWL: the money in the trade is not ${fmt(total)}`);
            const accepted = !acc && inTrade > 0;
            const status = !ready ? '' : inTrade === total ? '<span style="color:#35d99b;">The money matches.</span>' : !inTrade ? 'No money added yet.' : diff < 0 ? `<span style="color:#ff6b6b;">Too low by ${fmt(-diff)}.</span>` : `<span style="color:#ff6b6b;">Too high by ${fmt(diff)}.</span>`;
            const rurl = receipts[id] && receipts[id].url;
            const b = (bid, text, css = '') => `<button id="${bid}" type="button" style="padding:6px 12px;border:1px solid #44506a;border-radius:5px;cursor:pointer;font:600 13px Arial,sans-serif;color:#e6e9ef;background:#2a3140;${css}">${text}</button>`;
            let accept = '';
            if (accepted) accept = b('wwl-tb-acc', 'Accepted', 'background:#6d4fc4;border-color:#6d4fc4;opacity:.8;cursor:default;');
            else if (acc && ready) accept = inTrade === total ? b('wwl-tb-acc', 'Accept Trade', 'background:#1f9d63;border-color:#1f9d63;') : !inTrade ? b('wwl-tb-acc', 'Add Money', 'background:#c98a14;border-color:#c98a14;') : b('wwl-tb-acc', diff < 0 ? 'Too Low — add money' : 'Too High — fix money', 'background:#b03a3a;border-color:#b03a3a;');
            else if (acc && !waiting) accept = b('wwl-tb-acc', 'Accept (not checked)', '');
            const head = waiting ? 'Looking up your prices…' : priceError ? `<span style="color:#ff6b6b;">${esc(priceError)}</span>` : '';
            setBar(`<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;"><b style="color:#35d99b;">WWL</b>${head}${!head && total ? b('wwl-tb-copy', `Total: ${fmt(total)}`) : ''}${ready ? (rurl ? b('wwl-tb-rcpt', 'Receipt — copy link') + ` <a href="${esc(rurl)}" target="_blank" rel="noopener" style="color:#7fb0ff;font-size:12px;">open</a>` + (receipts[id].message ? b('wwl-tb-msg', 'Copy message') : '') : '<span style="color:#8a93a6;font-size:12px;">receipt…</span>') : ''}${accept}</div>${unpriced && !waiting ? `<div style="color:#f0b432;">${unpriced} item${unpriced === 1 ? '' : 's'} without a price on your list.</div>` : ''}${status ? `<div>${status} <span style="color:#8a93a6;">In the trade: ${fmt(inTrade)}</span>${mismatch ? ' <a href="#" id="wwl-tb-any" style="color:#7fb0ff;">Accept anyway</a>' : ''}</div>` : ''}<details style="margin-top:4px;"><summary style="cursor:pointer;color:#8a93a6;">Items</summary>${rows.join('')}</details>`, el => {
                const c = el.querySelector('#wwl-tb-copy');
                if (c) c.addEventListener('click', () => { const t = String(total); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => { c.textContent = 'Copied'; }, () => { c.textContent = t; }); });
                const mg = el.querySelector('#wwl-tb-msg');
                if (mg) mg.addEventListener('click', () => { const t = receipts[id].message; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => { mg.textContent = 'Message copied'; }, () => { mg.textContent = 'Copy failed'; }); });
                const r = el.querySelector('#wwl-tb-rcpt');
                if (r) r.addEventListener('click', () => { (navigator.clipboard ? navigator.clipboard.writeText(rurl) : Promise.reject()).then(() => { r.textContent = 'Link copied'; }, () => { r.textContent = rurl; }); });
                const a = el.querySelector('#wwl-tb-acc');
                if (a) a.addEventListener('click', () => {
                    const real = realAccept(), state = a.textContent;
                    if (state === 'Accept Trade' || state === 'Accept (not checked)') { if (real) real.click(); } else if (state !== 'Accepted') location.hash = `#step=addmoney&ID=${id}`;
                });
                const any = el.querySelector('#wwl-tb-any');
                if (any) any.addEventListener('click', e => { e.preventDefault(); if (confirm(`The money in the trade is ${fmt(inTrade)}, not ${fmt(total)}. Accept anyway?`)) { acceptAnyway[id] = true; setAcceptBlock(realAccept(), false, ''); const real = realAccept(); if (real) real.click(); } });
            });
        }

        // ---- the page where the money is typed: filled in with the total ----
        const filled = {};
        function addMoneyTick(id) {
            const rec = readJson(REC(id)), inputs = document.querySelectorAll('input.input-money');
            if (!rec || !rec.total || !inputs.length || filled[id]) return;
            filled[id] = true;
            inputs.forEach(i => { i.value = String(rec.total); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
            setBar(`<b style="color:#35d99b;">WWL</b> Filled in <b>${fmt(rec.total)}</b>, the total at your pricelist.`);
        }

        // ---- a finished trade: saved to your ledger ----
        const savedTried = {}; let logBusy = false;
        const sideOf = u => {
            const head = q1('.title-black', u);
            return { name: headName(head), money: moneyOf((q1('.cont li.color1 .name.left', u) || {}).textContent), items: readItems(u, '.cont li.color2 ul.desc li .name.left') };
        };
        const logLines = () => [...document.querySelectorAll('#trade-container .log li, ul.log li')].map(li => li.textContent.trim()).join('\n');
        const logTime = text => {
            const lines = text.split('\n'), done = lines.filter(l => /completed/i.test(l)), re = /(\d\d:\d\d:\d\d) - (\d\d)\/(\d\d)\/(\d\d)/;
            for (const l of done.concat(lines.slice().reverse())) { const m = l.match(re); if (m) return `20${m[4]}-${m[3]}-${m[2]} ${m[1]}`; }
            return new Date().toISOString().slice(0, 19).replace('T', ' '); // TCT = UTC
        };
        async function saveTrade(id, cont) {
            logBusy = true;
            try {
                const sides = ['.user.left', '.user.right'].map(s => { const u = q1(s, cont); return u ? sideOf(u) : null; });
                if (sides.some(s => !s)) { setBar('<b style="color:#35d99b;">WWL</b> <span style="color:#ff6b6b;">This trade page could not be read.</span>'); return; }
                const rec = readJson(REC(id)), pr = {};
                const itemSides = sides.filter(s => Object.keys(s.items).length), other = sides.find(s => !Object.keys(s.items).length);
                // the price per item is only kept when it adds up to exactly the money in the trade
                if (rec && !(rec.sets && rec.sets.length) && itemSides.length === 1 && other) {
                    const names = Object.keys(itemSides[0].items), sum = names.reduce((t, n) => t + ((rec.items[n] ? rec.items[n].price : 0) * itemSides[0].items[n]), 0);
                    if (names.every(n => rec.items[n] && rec.items[n].price) && sum === other.money) names.forEach(n => { pr[n] = rec.items[n].price; });
                }
                const r = await call({ action: 'led-script-add', tradeId: id, at: logTime(logLines()), sides: sides.map(s => ({ name: s.name.replace(/'s items.*$/i, '').trim(), money: s.money, items: s.items })), prices: pr });
                if (r.off) { dropBar(); return; } // no pricelist and no ledger yet: nothing is saved
                store.set(SAVED(id), JSON.stringify({ at: Date.now() }));
                const undo = r.ids && r.ids[0];
                setBar(`<b style="color:#35d99b;">WWL</b> ${r.added ? `Saved in your trading ledger (${r.kind === 'buy' ? 'bought' : 'sold'}).` : 'This trade is in your trading ledger already.'}${undo ? btn('wwl-tb-undo', 'Undo') : ''}`, b => {
                    const u = b.querySelector('#wwl-tb-undo');
                    if (u) u.addEventListener('click', () => { api({ action: 'led-del', id: undo }).then(() => { store.set(SAVED(id), ''); setBar('<b style="color:#35d99b;">WWL</b> Removed from your ledger again.'); }).catch(e => { u.textContent = e.message; }); });
                });
            } catch (e) {
                if (stopped) { dropBar(); return; }
                setBar(`<b style="color:#35d99b;">WWL</b> <span style="color:#ff6b6b;">${esc(e.message)}</span>${btn('wwl-tb-retry', 'Try again')}`, b => {
                    const t = b.querySelector('#wwl-tb-retry');
                    if (t) t.addEventListener('click', () => { savedTried[id] = false; setBar(''); });
                });
            } finally { logBusy = false; }
        }
        function logTick(id) {
            const cont = q1('.trade-cont.m-top10'); if (!cont || logBusy || savedTried[id]) return;
            savedTried[id] = true;
            if ((readJson(SAVED(id)) || {}).at) { setBar('<b style="color:#35d99b;">WWL</b> This trade was saved in your trading ledger earlier.'); return; }
            const logText = logLines();
            if (logText && !/completed/i.test(logText)) { setBar('<b style="color:#35d99b;">WWL</b> This trade was not completed, so it is not saved.'); return; }
            if (!logText) { // the page shows no log lines, so there is no proof that it finished: ask first
                setBar(`<b style="color:#35d99b;">WWL</b> Add this trade to your trading ledger?${btn('wwl-tb-save', 'Add it')}`, b => { const s = b.querySelector('#wwl-tb-save'); if (s) s.addEventListener('click', () => saveTrade(id, cont)); });
                return;
            }
            saveTrade(id, cont);
        }

        // one light look every second while on a trade page: it only reads the page, and WWL is called only when something is new
        let lastKey = '';
        setInterval(() => {
            if (stopped || document.hidden || location.pathname !== '/trade.php') return;
            const step = hashParam('step'), id = (hashParam('ID') || '').replace(/\D/g, ''), key = `${step}|${id}`;
            if (key !== lastKey) { lastKey = key; dropBar(); Object.keys(savedTried).forEach(k => delete savedTried[k]); }
            if (!id) return;
            if (step === 'view') viewTick(id); else if (step === 'addmoney') addMoneyTick(id); else if (step === 'logview') logTick(id);
        }, 1000);
    })();
})();
