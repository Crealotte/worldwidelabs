// welcome.js — the welcome chapters (missions) for pupils in the mentoring program: the pupil's chapter pages (Mentoring page), the mentor's view
// of how far their pupil is, and the leaders' editor + overview (Welcome steps page). Backend: lib/welcome.js.
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
const weAgo = ts => { if (!ts) return 'no progress yet'; const d = (Date.now() / 1000 - ts) / 86400; return d < 1 ? 'today' : `${Math.floor(d)} day${Math.floor(d) === 1 ? '' : 's'} ago`; };

// ---- the pupil's own chapters (top of the Mentoring page) ----
let weMine = null, weTab = null;
async function loadWelcomeMine() {
    const panel = $('mt-welcome-panel');
    if (!panel) return;
    const r = await weFetch({ action: 'wel-my' });
    if (r.error || !r.pupil) { panel.style.display = 'none'; return; }
    weMine = r;
    if (weTab == null || weTab >= r.chapters.length || r.chapters[weTab].locked) weTab = r.current;
    renderWelcomeMine();
}
function renderWelcomeMine() {
    const r = weMine, panel = $('mt-welcome-panel');
    panel.style.display = 'block';
    const total = r.chapters.reduce((s, c) => s + c.total, 0), done = r.chapters.reduce((s, c) => s + c.doneCount, 0);
    $('we-bar').style.width = `${total ? Math.round(done / total * 100) : 0}%`;
    $('we-count').textContent = r.allDone ? 'All done! 🎉' : `${done} of ${total} steps done`;
    $('we-tabs').innerHTML = r.chapters.map((c, i) => `<button type="button" class="we-tab" data-i="${i}" ${c.locked ? 'disabled' : ''} style="padding:6px 12px;border-radius:8px;border:1px solid ${i === weTab ? 'var(--reagent)' : 'var(--line)'};background:${i === weTab ? 'rgba(53,217,155,.15)' : 'transparent'};color:${c.locked ? 'var(--muted)' : 'var(--text)'};cursor:${c.locked ? 'not-allowed' : 'pointer'};font-size:13px;">${c.locked ? '🔒' : c.complete ? '✓' : ''} ${i + 1}${c.locked ? '' : `. ${esc(c.title)}`}</button>`).join('');
    const c = r.chapters[weTab];
    const next = r.chapters[weTab + 1];
    $('we-body').innerHTML = `<h4 style="margin:12px 0 4px;">${weTab + 1}. ${esc(c.title)}</h4>
        <div style="font-size:13px;color:var(--muted);white-space:pre-wrap;margin-bottom:8px;">${weRich(c.intro)}</div>
        ${c.tasks.map(t => `<div style="display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-top:1px solid var(--line);${t.waiting ? 'opacity:.6;' : ''}">
            <input type="checkbox" class="we-check" data-id="${esc(t.id)}" ${t.done ? 'checked' : ''} ${t.auto || t.waiting ? 'disabled' : ''} style="width:auto;margin-top:3px;">
            <div style="flex:1;font-size:13px;white-space:pre-wrap;">${weRich(t.text)}${t.auto ? ' <span style="color:var(--muted);font-size:11px;">· ticks itself</span>' : ''}${t.waiting ? ` <span style="color:#f0b432;font-size:11px;">· available from day ${t.fromDay + 1} in the faction (you are on day ${(r.days || 0) + 1})</span>` : ''}</div>
            ${weLinkBtn(t)}</div>`).join('')}
        <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            ${next ? (next.locked ? `<span style="font-size:12px;color:var(--muted);">🔒 Tick every step above to open chapter ${weTab + 2}.</span>` : `<button type="button" class="small" id="we-next">Next chapter →</button>`) : (r.allDone ? '<span style="font-size:13px;color:var(--reagent);">You finished everything. Well done! 🎉</span>' : '')}
        </div>`;
    $('we-tabs').querySelectorAll('.we-tab').forEach(b => b.addEventListener('click', () => { weTab = Number(b.dataset.i); renderWelcomeMine(); }));
    const nb = $('we-next'); if (nb) nb.addEventListener('click', () => { weTab += 1; renderWelcomeMine(); });
    $('we-body').querySelectorAll('.we-check').forEach(cb => cb.addEventListener('change', async () => {
        const d = await weFetch({ action: 'wel-done', id: cb.dataset.id, done: cb.checked });
        if (d.error) { toast(d.error); cb.checked = !cb.checked; return; }
        loadWelcomeMine();
    }));
}

// ---- a mentor looks at how far their pupil is (inside the pupil's card on the Mentoring page) ----
async function weLoadPupil(pupilId, box) {
    const r = await weFetch({ action: 'wel-pupil', pupilId });
    if (r.error) { box.innerHTML = ''; return; }
    const render = r2 => {
        const was = {}; box.querySelectorAll('details[data-ch]').forEach(d => { was[d.dataset.ch] = d.open; }); // keep the chapters open or closed the way they were after a tick
        const total = r2.chapters.reduce((s, c) => s + c.total, 0), done = r2.chapters.reduce((s, c) => s + c.doneCount, 0);
        const head = r2.allDone ? `👋 Finished all ${r2.chapters.length} welcome chapters 🎉` : `👋 Their welcome chapters: chapter ${r2.current + 1} of ${r2.chapters.length}, ${done} of ${total} steps (last progress: ${weAgo(r2.lastTick)})`;
        // the mentor sees every chapter in full with what is ticked (the pupil only sees the chapter they are on)
        box.innerHTML = `<details open style="margin-bottom:14px;"><summary class="av-sum"><span style="font-size:13px;font-weight:700;">${head}</span></summary>
            <div style="font-size:12px;color:var(--muted);margin:4px 0 6px;">Tick a step for them if they showed you it is done. Steps that say "ticks itself" are checked by WWL.</div>
            ${r2.chapters.map((x, i) => `<details data-ch="${i}" ${(was[i] ?? (i === r2.current && !r2.allDone)) ? 'open' : ''} style="margin:4px 0;border:1px solid var(--line);border-radius:8px;padding:4px 10px;"><summary class="av-sum"><span style="font-size:13px;color:${x.complete ? 'var(--reagent)' : 'var(--text)'};">${x.complete ? '✓' : x.locked ? '🔒' : '○'} ${i + 1}. ${esc(x.title)} <span style="color:var(--muted);font-size:12px;">${x.doneCount}/${x.total}${x.locked ? ' · not open for them yet' : ''}</span></span></summary>
                ${x.tasks.map(t => `<label style="display:flex;gap:8px;align-items:flex-start;padding:3px 0;font-size:13px;${t.waiting ? 'opacity:.6;' : ''}"><input type="checkbox" class="we-mtick" data-id="${esc(t.id)}" ${t.done ? 'checked' : ''} ${t.auto || t.waiting ? 'disabled' : ''} style="width:auto;margin-top:3px;"><span style="flex:1;white-space:pre-wrap;">${esc(t.text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'))}${t.auto ? ' <span style="color:var(--muted);font-size:11px;">· ticks itself</span>' : ''}${t.waiting ? ` <span style="color:#f0b432;font-size:11px;">· from day ${t.fromDay + 1}</span>` : ''}</span></label>`).join('')}</details>`).join('')}</details>`;
        box.querySelectorAll('.we-mtick').forEach(cb => cb.addEventListener('change', async () => {
            const d = await weFetch({ action: 'wel-mentor-tick', pupilId, id: cb.dataset.id, done: cb.checked });
            if (d.error) { toast(d.error); cb.checked = !cb.checked; return; }
            render(d);
        }));
    };
    render(r);
}

// ---- leaders: write the chapters, see where the pupils are ----
let weCfg = null, wePupils = [], weAutoKinds = {};
let weSync = () => {};
async function loadWelcomeAdmin() {
    const st = $('wa-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    const r = await weFetch({ action: 'wel-config-get' });
    if (r.error) { st.className = 'status err'; st.textContent = r.error; return; }
    st.textContent = ''; st.className = 'status';
    weCfg = { chapters: r.config.chapters.map(c => ({ ...c, tasks: (c.tasks || []).map(t => ({ ...t })) })), custom: r.config.custom };
    wePupils = r.pupils; weAutoKinds = r.autoKinds || {};
    renderWelcomeAdmin();
}
function renderWelcomeAdmin() {
    $('wa-note').textContent = weCfg.custom ? '' : 'These are starting texts, not saved yet. Rewrite them and press Save.';
    const autoOpts = sel => `<option value="">no (tick by hand)</option>${Object.entries(weAutoKinds).map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>ticks itself when ${esc(v)}</option>`).join('')}`;
    $('wa-steps').innerHTML = weCfg.chapters.map((c, i) => `<div class="panel" style="margin-bottom:12px;" data-c="${i}">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
            <div style="font-weight:700;font-size:18px;width:28px;">${i + 1}</div>
            <div class="field" style="margin:0;flex:1;min-width:220px;"><label>Chapter title</label><input class="wa-ctitle" maxlength="80" value="${esc(c.title)}"></div>
            <button class="ghost small wa-cup" ${i === 0 ? 'disabled' : ''}>↑</button><button class="ghost small wa-cdown" ${i === weCfg.chapters.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="ghost small wa-cdel" style="color:var(--danger);">Remove chapter</button>
        </div>
        <div class="field" style="margin:8px 0;"><label>Intro (put links as [text](https://...))</label><textarea class="wa-cintro" rows="3" maxlength="1200">${esc(c.intro)}</textarea></div>
        ${c.tasks.map((t, j) => `<div style="border-top:1px solid var(--line);padding:8px 0;" data-t="${j}">
            <div style="display:flex;gap:8px;align-items:flex-start;"><div class="field" style="margin:0;flex:1;"><label>Step</label><textarea class="wa-ttext" rows="2" maxlength="600">${esc(t.text)}</textarea></div><button class="ghost small wa-tdel" style="color:var(--danger);margin-top:20px;">✕</button></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
                <div class="field" style="margin:0;flex:1;min-width:200px;"><label>Link (WWL page or full link, optional)</label><input class="wa-tlink" maxlength="300" value="${esc(t.link)}"></div>
                <div class="field" style="margin:0;width:150px;"><label>Button text</label><input class="wa-tlabel" maxlength="40" value="${esc(t.label)}"></div>
                <div class="field" style="margin:0;min-width:230px;"><label>Checked</label><select class="wa-tauto">${autoOpts(t.auto)}</select></div>
                <div class="field" style="margin:0;width:150px;"><label>Role name(s)</label><input class="wa-targ" maxlength="80" placeholder="Guinea Pig|Lab Rat" value="${esc(t.autoArg)}"></div>
                <div class="field" style="margin:0;width:120px;"><label>From faction day</label><input type="number" class="wa-tday" min="0" max="60" value="${esc(t.fromDay || 0)}"></div>
            </div></div>`).join('')}
        <button class="ghost small wa-tadd">+ Add step</button></div>`).join('');
    weSync = () => {
        document.querySelectorAll('#wa-steps [data-c]').forEach(card => {
            const c = weCfg.chapters[Number(card.dataset.c)];
            c.title = card.querySelector('.wa-ctitle').value; c.intro = card.querySelector('.wa-cintro').value;
            card.querySelectorAll('[data-t]').forEach(row => {
                const t = c.tasks[Number(row.dataset.t)];
                t.text = row.querySelector('.wa-ttext').value; t.link = row.querySelector('.wa-tlink').value; t.label = row.querySelector('.wa-tlabel').value;
                t.auto = row.querySelector('.wa-tauto').value; t.autoArg = row.querySelector('.wa-targ').value; t.fromDay = Number(row.querySelector('.wa-tday').value) || 0;
            });
        });
    };
    const idx = el => Number(el.closest('[data-c]').dataset.c);
    const redo = fn => () => { weSync(); fn(); renderWelcomeAdmin(); };
    document.querySelectorAll('#wa-steps .wa-cdel').forEach(b => b.addEventListener('click', redo(() => { if (confirm('Remove this whole chapter?')) weCfg.chapters.splice(idx(b), 1); })));
    document.querySelectorAll('#wa-steps .wa-cup').forEach(b => b.addEventListener('click', redo(() => { const i = idx(b); [weCfg.chapters[i - 1], weCfg.chapters[i]] = [weCfg.chapters[i], weCfg.chapters[i - 1]]; })));
    document.querySelectorAll('#wa-steps .wa-cdown').forEach(b => b.addEventListener('click', redo(() => { const i = idx(b); [weCfg.chapters[i + 1], weCfg.chapters[i]] = [weCfg.chapters[i], weCfg.chapters[i + 1]]; })));
    document.querySelectorAll('#wa-steps .wa-tadd').forEach(b => b.addEventListener('click', redo(() => weCfg.chapters[idx(b)].tasks.push({ id: '', text: '', link: '', label: '', auto: '', autoArg: '', fromDay: 0 }))));
    document.querySelectorAll('#wa-steps .wa-tdel').forEach(b => b.addEventListener('click', redo(() => weCfg.chapters[idx(b)].tasks.splice(Number(b.closest('[data-t]').dataset.t), 1))));
    $('wa-recruits').innerHTML = wePupils.length ? `<table style="width:100%;font-size:13px;border-collapse:collapse;"><thead><tr style="color:var(--muted);text-align:left;"><th style="padding:4px 8px;">Pupil</th><th style="padding:4px 8px;">Mentor</th><th style="padding:4px 8px;">Day</th><th style="padding:4px 8px;">Script</th><th style="padding:4px 8px;">Chapter</th><th style="padding:4px 8px;">Steps</th><th style="padding:4px 8px;">Last progress</th></tr></thead><tbody>${wePupils.map(m => `<tr style="border-top:1px solid var(--line);"><td style="padding:4px 8px;">${esc(m.name)}</td><td style="padding:4px 8px;color:${m.mentor ? 'var(--text)' : 'var(--danger)'};">${esc(m.mentor || 'none yet')}</td><td style="padding:4px 8px;font-family:var(--mono);">${m.days == null ? '?' : m.days + 1}</td><td style="padding:4px 8px;">${m.script ? '✓' : '—'}</td><td style="padding:4px 8px;">${m.allDone ? 'done 🎉' : `${m.chapter}/${m.chapters} ${esc(m.chapterTitle)}`}</td><td style="padding:4px 8px;font-family:var(--mono);">${m.done}/${m.total}</td><td style="padding:4px 8px;color:var(--muted);">${weAgo(m.lastTick)}</td></tr>`).join('')}</tbody></table>` : '<p style="color:var(--muted);font-size:13px;margin:0;">No pupils in the mentoring program yet.</p>';
}
$('wa-add').addEventListener('click', () => { weSync(); weCfg.chapters.push({ id: '', title: '', intro: '', tasks: [] }); renderWelcomeAdmin(); });
$('wa-save').addEventListener('click', async () => {
    weSync();
    const st = $('wa-status'), btn = $('wa-save');
    btn.disabled = true; st.className = 'status ok'; st.textContent = 'Saving…';
    const r = await weFetch({ action: 'wel-config-save', chapters: weCfg.chapters });
    btn.disabled = false;
    if (r.error) { st.className = 'status err'; st.textContent = r.error; return; }
    loadWelcomeAdmin().then(() => { st.className = 'status ok'; st.textContent = '✓ Saved'; });
});
