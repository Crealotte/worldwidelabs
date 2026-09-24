// ==UserScript==
// @name         World Wide Labs
// @namespace    https://worldwidelabs.vercel.app
// @author       CreaLotte
// @version      1.12
// @updateURL    __WWL_BASE__/worldwidelabs.user.js
// @downloadURL  __WWL_BASE__/worldwidelabs.user.js
// @description  Shows your WorldWideLabs weekly energy plan (the checklist from the Energy planner) inside Torn, a To do tab with small personal reminders (revive setting, feedback, timezone map), and — if you are in the Mentoring Platform — your mentoring checklist too. Also shows faction banners at the top of every Torn page. On a computer it is a small window you can drag around and close; in TornPDA it is a menu. Ticks are shared with the WWL site.
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @connect      __WWL_HOST__
// ==/UserScript==

(function () {
    'use strict';
    if (window.top !== window.self || document.getElementById('wwl-energy-plan')) return; // not inside frames, and only once

    // The address of the WWL site (filled in when the script is installed from the WWL site).
    const WWL = ('__WWL_BASE__'.startsWith('http') ? '__WWL_BASE__' : 'https://worldwidelabs.vercel.app').replace(/\/$/, '');
    // TornPDA fills this in with your own API key; on a computer the script asks for it once and remembers it.
    const PDA_KEY = '###PDA-APIKEY###';
    const IS_PDA = !!PDA_KEY && !PDA_KEY.startsWith('#');
    const KEY_NAME = 'wwl_api_key', POS_NAME = 'wwl_plan_pos', STATE_NAME = 'wwl_plan_state';

    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const num = n => Math.round(n).toLocaleString();
    const store = {
        get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* not saved */ } },
    };

    function getKey(ask = true) {
        if (IS_PDA) return PDA_KEY;
        let k = store.get(KEY_NAME) || '';
        if (!k && ask) {
            k = (prompt('WWL Energy plan: paste your Torn API key (the same one you use on WWL). It is only sent to WWL.') || '').trim();
            if (k) store.set(KEY_NAME, k);
        }
        return k;
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
        if (!key) throw new Error('No API key');
        const r = await post(`${WWL}/api/war-payout`, { key, ...body });
        if (r.error) throw new Error(r.error);
        return r;
    }

    // ---- the pieces: a small button (always there), and the window (PC) / menu (TornPDA) it opens ----
    const root = document.createElement('div');
    root.id = 'wwl-energy-plan';
    root.style.cssText = 'font:13px/1.4 Arial,sans-serif;color:#e6e9ef;';
    document.body.appendChild(root);

    const pill = document.createElement('div'); // the closed state: a small "WWL" button with the progress
    pill.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99998;display:flex;gap:6px;align-items:center;padding:8px 12px;background:#1b2029;border:1px solid #35d99b;border-radius:20px;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,.5);user-select:none;';
    pill.innerHTML = '<b>WWL</b><span id="wwl-prog" style="color:#35d99b;font-family:monospace;"></span>';
    root.appendChild(pill);
    const prog = pill.querySelector('#wwl-prog');

    const win = document.createElement('div');
    if (IS_PDA) { // TornPDA: a menu that slides up from the bottom, big enough to tap
        win.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;max-height:75vh;display:none;flex-direction:column;background:#1b2029;border-top:2px solid #35d99b;border-radius:14px 14px 0 0;box-shadow:0 -4px 24px rgba(0,0,0,.6);font-size:15px;';
    } else { // computer: a floating window you can drag around and close
        win.style.cssText = 'position:fixed;z-index:99999;width:330px;max-width:94vw;max-height:75vh;display:none;flex-direction:column;background:#1b2029;border:1px solid #3a4352;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.55);';
    }
    win.innerHTML = `<div id="wwl-head" style="display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid #3a4352;${IS_PDA ? '' : 'cursor:move;'}user-select:none;touch-action:none;">
            <b style="flex:1;">WWL energy plan${IS_PDA ? '' : ' <span style="color:#9aa4b5;font-weight:400;font-size:11px;">— drag to move</span>'}</b>
            <span id="wwl-prog2" style="color:#35d99b;font-family:monospace;"></span>
            <span id="wwl-close" title="Close" style="cursor:pointer;font-size:20px;line-height:1;padding:0 4px;">×</span></div>
        <div id="wwl-body" style="overflow:auto;padding:8px 12px 12px;"></div>`;
    root.appendChild(win);
    const body = win.querySelector('#wwl-body'), prog2 = win.querySelector('#wwl-prog2'), head = win.querySelector('#wwl-head');
    let plan = null, mtPairs = null, mtTodos = [], todoItems = null, tab = 'todo'; // tab: 'energy' | 'mentoring' | 'todo' — the mentoring tab only appears once we know there's something to show there

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

    function setOpen(on, save = true) {
        win.style.display = on ? 'flex' : 'none';
        pill.style.display = on ? 'none' : 'flex';
        if (save) store.set(STATE_NAME, on ? 'open' : 'closed');
        if (on) { if (!IS_PDA) restorePos(); load(); }
    }
    pill.addEventListener('click', () => setOpen(true));
    win.querySelector('#wwl-close').addEventListener('click', () => setOpen(false));

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
        const html = [energyText, todoBadge].filter(Boolean).join(' ');
        prog.innerHTML = prog2.innerHTML = html;
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
        body.parentElement.querySelectorAll('.wwl-tab').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
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
    function render() {
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
        } catch (e) { body.innerHTML = `<div style="padding:6px 0;color:#e05555;">${esc(e.message)}</div>`; }
    }

    // start: closed as a small button (or open again if it was left open, and on the gym page the first time)
    const onGym = /\/gym\.php/.test(location.pathname);
    const last = store.get(STATE_NAME);
    setOpen(last ? last === 'open' : onGym && !IS_PDA, false);
    // the small button only needs a peek: use what was saved in the last 10 minutes, so ordinary page loads cost no calls
    let cached = null; try { cached = JSON.parse(store.get('wwl_plan_cache') || 'null'); } catch (e) { /* none */ }
    if (cached?.plan) { plan = cached.plan; showProgress(); }
    if (last !== 'open' && getKey(false) && !(cached && Date.now() - cached.at < 600000)) {
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
    if (getKey(false) && Date.now() - lastCheckin > 3600000) {
        store.set(CHECKIN_NAME, String(Date.now()));
        api({ action: 'script-checkin' }).catch(() => {});
    }

    // ---- Torn-wide banners: the same ones a leader sets in Leader settings → Banners on the WWL
    // site, shown here too since faction messages posted in Torn's own event feed get lost. Inserted
    // in normal document flow (not a fixed overlay) at the very top of the page, so it pushes Torn's
    // own content down rather than risking covering anything. Re-checked every ~10 minutes.
    const BAN_DISMISS_NAME = 'wwl_tornban_dismissed'; // { bannerId: hash of its text }
    const banHash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); };
    const banDismissed = () => { try { return JSON.parse(store.get(BAN_DISMISS_NAME) || '{}'); } catch (e) { return {}; } };
    const BAN_TONE_COLORS = { info: '#4da3ff', event: '#35d99b', warn: '#f0b432' };
    const banBar = document.createElement('div');
    banBar.id = 'wwl-torn-banner';
    banBar.style.cssText = 'display:none;position:relative;z-index:99990;font:13px/1.4 Arial,sans-serif;';
    document.body.insertBefore(banBar, document.body.firstChild);
    let banList = [], banIdx = 0, banTimer = null;
    function renderTornBanner() {
        const gone = banDismissed();
        const shown = banList.filter(b => gone[b.id] !== banHash(b.text));
        clearInterval(banTimer);
        if (!shown.length) { banBar.style.display = 'none'; banBar.innerHTML = ''; return; }
        banIdx = Math.min(banIdx, shown.length - 1);
        const b = shown[banIdx];
        const color = BAN_TONE_COLORS[b.tone] || BAN_TONE_COLORS.info;
        banBar.style.display = 'block';
        banBar.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;text-align:center;gap:10px;padding:8px 14px;background:${color}22;border-bottom:2px solid ${color};color:#e6e9ef;flex-wrap:wrap;">
            ${b.icon ? `<span style="font-size:16px;">${esc(b.icon)}</span>` : ''}
            <span style="flex:1;min-width:200px;">${esc(b.text)}</span>
            ${shown.length > 1 ? `<span style="font-size:11px;color:#9aa4b5;">${banIdx + 1}/${shown.length}</span>` : ''}
            ${b.page ? `<a href="${WWL}/${esc(b.page)}" target="_blank" rel="noopener" style="color:${color};text-decoration:none;border:1px solid ${color};border-radius:6px;padding:3px 10px;font-size:12px;white-space:nowrap;">${esc(b.linkLabel || 'Open')} ↗</a>` : ''}
            <span class="wwl-ban-x" title="Close" style="cursor:pointer;font-size:16px;line-height:1;color:#9aa4b5;padding:0 2px;">×</span>
        </div>`;
        banBar.querySelector('.wwl-ban-x').addEventListener('click', () => {
            const d = banDismissed(); d[b.id] = banHash(b.text);
            store.set(BAN_DISMISS_NAME, JSON.stringify(d));
            renderTornBanner();
        });
        if (shown.length > 1) banTimer = setInterval(() => { banIdx = (banIdx + 1) % shown.length; renderTornBanner(); }, 7000);
    }
    const BAN_CACHE_NAME = 'wwl_torn_banners_cache';
    let banCached = null; try { banCached = JSON.parse(store.get(BAN_CACHE_NAME) || 'null'); } catch (e) { /* none */ }
    if (banCached?.banners) { banList = banCached.banners; renderTornBanner(); }
    if (getKey(false) && !(banCached && Date.now() - banCached.at < 600000)) {
        api({ action: 'banners-get' }).then(r => {
            banList = r.banners || [];
            store.set(BAN_CACHE_NAME, JSON.stringify({ at: Date.now(), banners: banList }));
            renderTornBanner();
        }).catch(() => {});
    }
})();
