// ==UserScript==
// @name         WWL Energy plan
// @namespace    https://worldwidelabs.vercel.app
// @version      1.6
// @updateURL    __WWL_BASE__/wwl-energy-planner.user.js
// @downloadURL  __WWL_BASE__/wwl-energy-planner.user.js
// @description  Shows your WorldWideLabs weekly energy plan (the checklist from the Energy planner) inside Torn, and — if you are in the Mentoring Platform — your mentoring checklist too. On a computer it is a small window you can drag around and close; in TornPDA it is a menu. Ticks are shared with the WWL site.
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
    let plan = null, mtPairs = null, mtTodos = [], tab = 'energy'; // tab: 'energy' | 'mentoring' — the mentoring tab only appears once we know there's something to show there

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
        if (!plan) return;
        const p = progress();
        prog.textContent = prog2.textContent = `${num(p.done)} / ${num(p.total)} E`;
    }
    function tabBar() {
        if (!mtPairs || !mtPairs.length) return '';
        return `<div style="display:flex;gap:6px;margin-bottom:10px;">
            <button type="button" class="wwl-tab" data-tab="energy" style="flex:1;padding:6px;border-radius:6px;border:1px solid #3a4352;cursor:pointer;background:${tab === 'energy' ? '#2a2f3a' : 'transparent'};color:#e6e9ef;">⚡ Energy</button>
            <button type="button" class="wwl-tab" data-tab="mentoring" style="flex:1;padding:6px;border-radius:6px;border:1px solid #3a4352;cursor:pointer;background:${tab === 'mentoring' ? '#2a2f3a' : 'transparent'};color:#e6e9ef;">🎓 Mentoring</button>
        </div>`;
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
    function render() {
        body.innerHTML = tabBar() + (tab === 'mentoring' ? renderMentoringTab() : renderEnergyTab());
        showProgress();
        wireTabs();
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
            const [planR, mtR] = await Promise.all([
                api({ action: 'plan-get' }),
                api({ action: 'mentor-my-status' }).catch(() => null), // fine if this member isn't in the program at all
            ]);
            plan = planR.plan; store.set('wwl_plan_cache', JSON.stringify({ at: Date.now(), plan }));
            mtPairs = mtR?.pairs || []; mtTodos = mtR?.todos || [];
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
    if (last !== 'open' && getKey(false) && !(cached && Date.now() - cached.at < 600000)) api({ action: 'plan-get' }).then(r => { plan = r.plan; showProgress(); store.set('wwl_plan_cache', JSON.stringify({ at: Date.now(), plan })); }).catch(() => {});
})();
