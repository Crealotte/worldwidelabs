// ==UserScript==
// @name         WWL Energy plan
// @namespace    https://worldwidelabs.vercel.app
// @version      1.1
// @updateURL    __WWL_BASE__/wwl-energy-planner.user.js
// @downloadURL  __WWL_BASE__/wwl-energy-planner.user.js
// @description  Shows your WorldWideLabs weekly energy plan (the checklist from the Energy planner) inside Torn's gym page, and lets you tick the steps off. Ticks are shared with the WWL site.
// @match        https://www.torn.com/gym.php*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // The address of the WWL site. (When you copy this script from the WWL Energy planner page it is filled in for you.)
    const WWL = ('__WWL_BASE__'.startsWith('http') ? '__WWL_BASE__' : 'https://worldwidelabs.vercel.app').replace(/\/$/, '');
    // TornPDA fills this in with your own API key; on a computer the script asks for it once and remembers it.
    const PDA_KEY = '###PDA-APIKEY###';
    const KEY_NAME = 'wwl_api_key';

    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const num = n => Math.round(n).toLocaleString();

    function getKey(ask = true) {
        if (PDA_KEY && !PDA_KEY.startsWith('#')) return PDA_KEY;
        let k = '';
        try { k = localStorage.getItem(KEY_NAME) || ''; } catch (e) { /* none */ }
        if (!k && ask) {
            k = (prompt('WWL Energy plan: paste your Torn API key (the same one you use on WWL). It is only sent to WWL.') || '').trim();
            if (k) { try { localStorage.setItem(KEY_NAME, k); } catch (e) { /* not saved */ } }
        }
        return k;
    }
    async function api(body) {
        const key = getKey();
        if (!key) throw new Error('No API key');
        const res = await fetch(`${WWL}/api/war-payout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, ...body }) });
        const r = await res.json();
        if (r.error) throw new Error(r.error);
        return r;
    }

    // ---- the panel ----
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;right:8px;bottom:64px;z-index:99999;width:310px;max-width:92vw;max-height:70vh;display:flex;flex-direction:column;background:#1b2029;color:#e6e9ef;border:1px solid #3a4352;border-radius:8px;font:13px/1.4 Arial,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.5);';
    box.innerHTML = `<div id="wwl-head" style="display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;">
            <b style="flex:1;">WWL energy plan</b><span id="wwl-prog" style="color:#35d99b;font-family:monospace;"></span><span id="wwl-arrow">▲</span></div>
        <div id="wwl-body" style="display:none;overflow:auto;padding:0 10px 10px;"></div>`;
    document.body.appendChild(box);
    const body = box.querySelector('#wwl-body'), prog = box.querySelector('#wwl-prog'), arrow = box.querySelector('#wwl-arrow');
    let open = false, plan = null;
    box.querySelector('#wwl-head').addEventListener('click', () => {
        open = !open; body.style.display = open ? 'block' : 'none'; arrow.textContent = open ? '▼' : '▲';
        if (open) load();
    });

    function progress() {
        let done = 0, total = 0;
        for (const b of plan.blocks) for (const it of b.items) { total += it.value; if (plan.checks[it.key]) done += it.value; }
        return { done, total };
    }
    function render() {
        const p = progress();
        prog.textContent = `${num(p.done)} / ${num(p.total)} E`;
        const footer = `<div style="margin-top:10px;padding-top:8px;border-top:1px solid #3a4352;color:#9aa4b5;">To change your settings (stat, method, candy, cans, refill), use the planner on the tool itself: <a href="${WWL}/energy" target="_blank" rel="noopener" style="color:#35d99b;">${esc(WWL)}/energy</a></div>`;
        if (!plan) { body.innerHTML = `<div style="padding:6px 0;color:#9aa4b5;">You have no plan yet. Open the Energy planner on WWL once, pick your method, and it will show up here.</div>${footer}`; return; }
        const old = plan.week !== Math.floor(Date.now() / (7 * 86400e3)) ? '<div style="color:#f0b432;margin-bottom:6px;">This plan is from a previous week — open the planner on WWL to make a plan for this week.</div>' : '';
        const nextIdx = plan.blocks.findIndex(b => b.items.some(it => !plan.checks[it.key]));
        body.innerHTML = `${old}<div style="color:#9aa4b5;margin-bottom:6px;">${esc(plan.summary)}</div>
            <div style="height:6px;background:#39414f;border-radius:3px;overflow:hidden;margin-bottom:8px;"><div style="height:100%;width:${p.total ? Math.min(100, p.done / p.total * 100) : 0}%;background:#35d99b;"></div></div>
            ${plan.blocks.map((b, i) => {
                const all = b.items.length && b.items.every(it => plan.checks[it.key]);
                return `<details ${i === nextIdx ? 'open' : ''} style="margin-bottom:4px;"><summary style="cursor:pointer;font-weight:700;">${all ? '✅ ' : ''}${esc(b.title)}${i === nextIdx ? ' <span style="color:#35d99b;font-weight:400;">← next</span>' : ''}</summary>
                    ${b.note ? `<div style="color:#9aa4b5;margin:3px 0;">${esc(b.note)}</div>` : ''}
                    ${b.items.map(it => `<label style="display:flex;gap:8px;align-items:flex-start;padding:4px 0;cursor:pointer;"><input type="checkbox" data-k="${esc(it.key)}" ${plan.checks[it.key] ? 'checked' : ''} style="margin-top:2px;"><span>${esc(it.label)}</span></label>`).join('')}</details>`;
            }).join('')}${footer}`;
        body.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', async () => {
            if (cb.checked) plan.checks[cb.dataset.k] = true; else delete plan.checks[cb.dataset.k];
            const p2 = progress(); prog.textContent = `${num(p2.done)} / ${num(p2.total)} E`;
            try { await api({ action: 'plan-check', step: cb.dataset.k, checked: cb.checked }); } catch (e) { /* shown on next load */ }
        }));
    }
    async function load() {
        body.innerHTML = '<div style="padding:6px 0;color:#9aa4b5;">Loading…</div>';
        try { plan = (await api({ action: 'plan-get' })).plan; render(); }
        catch (e) { body.innerHTML = `<div style="padding:6px 0;color:#e05555;">${esc(e.message)}</div>`; }
    }
    // on page load only a quiet peek (no key prompt) so the header shows your progress
    if (getKey(false)) api({ action: 'plan-get' }).then(r => { plan = r.plan; if (plan) { const p = progress(); prog.textContent = `${num(p.done)} / ${num(p.total)} E`; } }).catch(() => {});
})();
