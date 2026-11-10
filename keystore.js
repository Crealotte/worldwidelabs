// keystore.js — the optional "Store my Torn API key" panel (consent, store, delete). Shown on the Labs services page, My buddy plan and the Profile page, and only when the server has its
// secret (WWL_VAULT_SECRET): without it the panel stays hidden. The server side is lib/keyvault.js (actions mkey-status, mkey-save, mkey-delete). The key is sent only to be stored; it never comes back.
'use strict';

async function mkeyFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}
async function mkeyMount(page) {
    try {
        if (typeof apiKey === 'undefined' || !apiKey || /^test:/.test(apiKey)) return;
        const sec = document.getElementById('page-' + page), h = sec && sec.querySelector('h2');
        if (!h) return;
        let box = sec.querySelector('.mkey-box');
        if (!box) { box = document.createElement('div'); box.className = 'mkey-box'; h.insertAdjacentElement('afterend', box); }
        const s = await mkeyFetch({ action: 'mkey-status' });
        if (s.error || !s.available) { box.innerHTML = ''; return; }
        const day = t => (t ? new Date(t * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
        if (s.enabled) {
            box.innerHTML = `<div class="panel"><h3 style="margin-top:0;">🔑 Your Torn API key is stored</h3>
                <div style="font-size:13px;line-height:1.7;">Stored since <b>${esc(day(s.since))}</b> · preview <b style="font-family:var(--mono);">${esc(s.preview)}</b>${s.access ? ` · access level <b>${esc(s.access)}</b>` : ''}${s.lastUsed ? ` · last used ${esc(day(s.lastUsed))}${s.lastOk === false ? ' <span style="color:var(--danger);">(it did not work: the key may have been revoked)</span>' : ''}` : ''}</div>
                <div style="font-size:12px;color:var(--muted);margin:6px 0;">It is only decrypted on the server at the moment WWL asks Torn for your own data. It is never shown again and never sent back to your browser.</div>
                <button class="ghost small" id="mkey-del" type="button">Delete my key</button></div>`;
            box.querySelector('#mkey-del').addEventListener('click', async e => {
                if (!confirm('Delete your stored key? WWL can no longer read your data while you are away.')) return;
                e.target.disabled = true;
                const r = await mkeyFetch({ action: 'mkey-delete' });
                if (r.error) { toast(r.error); e.target.disabled = false; return; }
                toast('Your key is deleted'); mkeyMount(page);
            });
            return;
        }
        box.innerHTML = `<details class="panel"><summary class="av-sum"><b>🔑 Store my Torn API key (optional)</b> <span style="font-size:12px;color:var(--muted);">(so WWL can update your own data while you are away)</span></summary>
            <div style="font-size:13px;line-height:1.6;margin-top:8px;">If you turn this on, WWL keeps your Torn API key so it can update your own data (for example your City Bank, plan and energy) in the background, even when you are not on the site.
                <ul style="margin:6px 0 6px 18px;padding:0;">
                <li><b>What is stored:</b> only your API key, encrypted. WWL shows you a short preview and never the whole key: not to you, not to leaders, not to the owner.</li>
                <li><b>When it is used:</b> the server decrypts it only at the moment it asks Torn for your data. It is never sent back to your browser and never written to logs.</li>
                <li><b>What it can do:</b> read the data your key's access level allows. An API key cannot do anything in your Torn account.</li>
                <li><b>Access level:</b> please create the key with the lowest access level that WWL asks for. The key you are logged in with right now is the one that is stored.</li>
                <li><b>Control:</b> press <b>Delete my key</b> at any time and it is removed at once. You can also revoke the key in your Torn settings.</li></ul>
                <label style="display:flex;gap:8px;align-items:center;cursor:pointer;"><input type="checkbox" id="mkey-ok" style="width:auto;"> I have read this and I want WWL to store my key.</label>
                <button type="button" id="mkey-save" style="margin-top:8px;">Store my key</button></div></details>`;
        box.querySelector('#mkey-save').addEventListener('click', async e => {
            if (!box.querySelector('#mkey-ok').checked) { toast('Tick that you have read this first.'); return; }
            e.target.disabled = true;
            const r = await mkeyFetch({ action: 'mkey-save', accept: true });
            if (r.error) { toast(r.error); e.target.disabled = false; return; }
            toast('Your key is stored'); mkeyMount(page);
        });
    } catch (e) { /* the panel is optional: never break a page because of it */ }
}
