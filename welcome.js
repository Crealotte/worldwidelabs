// welcome.js — welcome steps for new recruits: the dashboard card a recruit ticks off, the list a mentor sees for their pupil (Mentoring page),
// and the leaders' editor + overview (Welcome steps page). Backend: lib/welcome.js.
'use strict';

async function weFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}
const weHref = link => { link = String(link || '').trim(); return !link ? null : /^https?:\/\//i.test(link) ? link : '/' + link.replace(/^\/+/, ''); };
const weLinkBtn = s => { const h = weHref(s.link); return h ? `<a class="ghost small" href="${esc(h)}" ${/^https?:/i.test(h) ? 'target="_blank" rel="noopener"' : ''} style="text-decoration:none;padding:4px 10px;white-space:nowrap;">${esc(s.label || 'Open')}</a>` : ''; };
// message text: line breaks kept, and [label](https://...) becomes a link (the only markup supported)
const weRich = t => esc(String(t || '')).replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, label, url) => `<a href="${url}" target="_blank" rel="noopener" style="color:var(--reagent);">${label}</a>`);

// ---- the recruit's dashboard card ----
async function loadWelcomeCard() {
    const panel = $('dash-welcome-panel');
    if (!panel) return;
    const r = await weFetch({ action: 'wel-my' });
    if (r.error || !r.recruit || !r.steps.length) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    $('we-list').innerHTML = r.steps.map(s => `<div class="we-row" style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid var(--line);${s.done ? 'opacity:.55;' : ''}">
            <input type="checkbox" class="we-check" data-id="${esc(s.id)}" ${s.done ? 'checked' : ''} style="width:auto;margin-top:3px;" title="Got it">
            <div style="flex:1;"><div style="font-weight:700;font-size:14px;">${esc(s.title)}</div><div style="font-size:13px;color:var(--muted);white-space:pre-wrap;">${weRich(s.text)}</div></div>
            ${weLinkBtn(s)}</div>`).join('');
    $('we-list').querySelectorAll('.we-check').forEach(c => c.addEventListener('change', async () => {
        const d = await weFetch({ action: 'wel-done', id: c.dataset.id, done: c.checked });
        if (d.error) { toast(d.error); c.checked = !c.checked; return; }
        c.closest('.we-row').style.opacity = c.checked ? '.55' : '1';
    }));
}

// ---- a mentor looks at what their pupil gets ----
async function weLoadPupil(pupilId, box) {
    const r = await weFetch({ action: 'wel-pupil', pupilId });
    if (r.error || !r.recruit) { box.innerHTML = ''; return; } // past the welcome days: nothing more to follow
    const more = r.total - r.steps.length;
    box.innerHTML = `<details open style="margin-bottom:14px;"><summary class="av-sum"><span style="font-size:13px;font-weight:700;">👋 Their welcome steps (day ${(r.days || 0) + 1} of ${r.windowDays})</span></summary>
        <div style="font-size:12px;color:var(--muted);margin:4px 0 6px;">What your pupil is being guided through right now, so you can help where they get stuck.</div>
        ${r.steps.map(s => `<div style="display:flex;gap:8px;align-items:flex-start;padding:4px 0;font-size:13px;"><span style="color:${s.done ? 'var(--reagent)' : 'var(--muted)'};">${s.done ? '✓' : '○'}</span><div style="flex:1;"><b>${esc(s.title)}</b> <span style="color:var(--muted);white-space:pre-wrap;">${esc(s.summary || s.text)}</span></div>${weLinkBtn(s)}</div>`).join('')}
        ${more > 0 ? `<div style="font-size:12px;color:var(--muted);">${more} more step${more === 1 ? '' : 's'} to come on the next days.</div>` : ''}</details>`;
}

// ---- leaders: write the steps, see who is on which ----
let weCfg = null, weRecruits = [];
let weSync = () => {};
async function loadWelcomeAdmin() {
    const st = $('wa-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    const r = await weFetch({ action: 'wel-config-get' });
    if (r.error) { st.className = 'status err'; st.textContent = r.error; return; }
    st.textContent = ''; st.className = 'status';
    weCfg = { windowDays: r.config.windowDays, steps: r.config.steps.map(s => ({ ...s })), custom: r.config.custom };
    weRecruits = r.recruits;
    renderWelcomeAdmin();
}
function renderWelcomeAdmin() {
    $('wa-window').value = weCfg.windowDays;
    $('wa-note').textContent = weCfg.custom ? '' : 'These are starting texts, not saved yet. Rewrite them and press Save.';
    $('wa-steps').innerHTML = weCfg.steps.map((s, i) => `<div class="panel" style="margin-bottom:8px;" data-i="${i}">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
            <div class="field" style="margin:0;width:90px;"><label>From day</label><input type="number" min="0" max="13" class="wa-day" value="${esc(s.day)}"></div>
            <div class="field" style="margin:0;flex:1;min-width:200px;"><label>Title</label><input class="wa-title" maxlength="80" value="${esc(s.title)}"></div>
            <button class="ghost small wa-del" style="color:var(--danger);">Remove</button>
        </div>
        <div class="field" style="margin:8px 0 0;"><label>Short version (shown in the script's To do and to the mentor)</label><input class="wa-summary" maxlength="200" value="${esc(s.summary || '')}"></div>
        <div class="field" style="margin:8px 0 0;"><label>Message (put links as [text](https://...))</label><textarea class="wa-text" rows="9" maxlength="2500">${esc(s.text)}</textarea></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;">
            <div class="field" style="margin:0;flex:1;min-width:220px;"><label>Link (a WWL page like <code>mentoring</code>, or a full forum link)</label><input class="wa-link" maxlength="300" value="${esc(s.link)}"></div>
            <div class="field" style="margin:0;width:180px;"><label>Button text</label><input class="wa-label" maxlength="40" value="${esc(s.label)}"></div>
        </div></div>`).join('');
    weSync = () => {
        document.querySelectorAll('#wa-steps [data-i]').forEach(card => {
            const s = weCfg.steps[Number(card.dataset.i)];
            s.day = Number(card.querySelector('.wa-day').value) || 0; s.title = card.querySelector('.wa-title').value; s.text = card.querySelector('.wa-text').value;
            s.link = card.querySelector('.wa-link').value; s.label = card.querySelector('.wa-label').value; s.summary = card.querySelector('.wa-summary').value;
        });
        weCfg.windowDays = Number($('wa-window').value) || 3;
    };
    document.querySelectorAll('#wa-steps .wa-del').forEach(b => b.addEventListener('click', () => { weSync(); weCfg.steps.splice(Number(b.closest('[data-i]').dataset.i), 1); renderWelcomeAdmin(); }));
    $('wa-recruits').innerHTML = weRecruits.length ? `<table style="width:100%;font-size:13px;border-collapse:collapse;"><thead><tr style="color:var(--muted);text-align:left;"><th style="padding:4px 8px;">Recruit</th><th style="padding:4px 8px;">Day</th><th style="padding:4px 8px;">Steps ticked</th></tr></thead><tbody>${weRecruits.map(m => {
        const n = m.steps.filter(s => s.done).length;
        return `<tr style="border-top:1px solid var(--line);"><td style="padding:4px 8px;">${esc(m.name)}</td><td style="padding:4px 8px;font-family:var(--mono);">${(m.days || 0) + 1}</td><td style="padding:4px 8px;" title="${esc(m.steps.map(s => `${s.done ? '✓' : '○'} ${s.title}`).join('\n'))}">${n} / ${m.steps.length}</td></tr>`;
    }).join('')}</tbody></table>` : '<p style="color:var(--muted);font-size:13px;margin:0;">Nobody is in their first days right now.</p>';
}
$('wa-add').addEventListener('click', () => { weSync(); weCfg.steps.push({ id: '', day: 0, title: '', summary: '', text: '', link: '', label: '' }); renderWelcomeAdmin(); });
$('wa-save').addEventListener('click', async () => {
    weSync();
    const st = $('wa-status'), btn = $('wa-save');
    btn.disabled = true; st.className = 'status ok'; st.textContent = 'Saving…';
    const r = await weFetch({ action: 'wel-config-save', windowDays: weCfg.windowDays, steps: weCfg.steps });
    btn.disabled = false;
    if (r.error) { st.className = 'status err'; st.textContent = r.error; return; }
    loadWelcomeAdmin().then(() => { st.className = 'status ok'; st.textContent = '✓ Saved'; });
});
