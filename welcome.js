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

// ---- the role path: where a member is on the ladder and what the next role still needs ----
function weRoleHtml(role) {
    if (!role) return '';
    if (role.current < 0) return `<div style="font-size:13px;color:var(--muted);">Your role: <b style="color:var(--text);">${esc(role.position || 'none')}</b></div>`;
    const mark = ok => ok === true ? '<span style="color:var(--reagent);">✓</span>' : ok === false ? '<span style="color:var(--muted);">○</span>' : '<span style="color:var(--muted);" title="not known yet">?</span>';
    const chips = role.steps.map((s, i) => `<span style="font-size:12px;border:1px solid ${i === role.current ? 'var(--reagent)' : 'var(--line)'};background:${i === role.current ? 'rgba(53,217,155,.15)' : 'transparent'};border-radius:10px;padding:2px 9px;color:${i <= role.current ? 'var(--text)' : 'var(--muted)'};">${i < role.current ? '✓ ' : ''}${esc(s.name)}</span>`).join('<span style="color:var(--muted);"> → </span>');
    const next = role.next != null ? role.steps[role.next] : null;
    return `<div style="margin:6px 0 10px;"><div style="font-size:12px;color:var(--muted);margin-bottom:4px;">Role path</div><div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">${chips}</div>
        ${next ? `<div style="font-size:13px;margin-top:6px;">Next: <b>${esc(next.name)}</b>${next.gives ? ` <span style="color:var(--muted);">(${esc(next.gives)})</span>` : ''}${next.reqs.map(r => ` <span style="margin-left:8px;">${r.appointed ? '•' : mark(r.ok)} ${esc(r.text)}${r.detail ? ` <span style="color:var(--muted);font-size:11px;">(${esc(r.detail)})</span>` : ''}</span>`).join('')}</div>` : `<div style="font-size:13px;margin-top:6px;color:var(--reagent);">You are at the top of the ladder 🎉</div>${role.keep ? `<div style="font-size:13px;margin-top:4px;">${role.keep.ok === false ? '<span style="color:var(--danger);">⚠</span>' : mark(role.keep.ok)} ${esc(role.keep.text)}${role.keep.detail ? ` <span style="color:var(--muted);font-size:11px;">(${esc(role.keep.detail)})</span>` : ''}</div>` : ''}`}</div>`;
}

// ---- the pupil's own chapters (top of the Mentoring page) ----
let weMine = null; const weOpen = {}; // weOpen: which chapter windows are open (all closed to begin with)
// the Lab Notes page (open to everyone): role path, the welcome chapters and the other cards, from one request
async function loadWelcomeMine() {
    const panel = $('mt-welcome-panel'), st = $('ln-status');
    if (!panel) return;
    const r = await weFetch({ action: 'lab-get' });
    if (r.error) { if (st) { st.className = 'status err'; st.textContent = r.error; } return; }
    if (st) { st.textContent = ''; st.className = 'status'; }
    weMine = { ...r.welcome, role: r.role, days: r.days, pupil: r.pupil };
    renderWelcomeMine();
    renderLabCards(r.cards || [], r.days);
}
// the other cards: each its own window, closed to begin with, no lock between them; after finishing one a member can put its daily habits on their own to-do
const lnOpen = {};
function renderLabCards(cards, days) {
    const panel = $('ln-cards-panel');
    if (!panel) return;
    panel.style.display = cards.length ? 'block' : 'none';
    $('ln-cards').innerHTML = cards.map(c => `<details class="ln-card" data-id="${esc(c.id)}" ${lnOpen[c.id] ? 'open' : ''} style="margin:6px 0;border:1px solid var(--line);border-radius:8px;padding:6px 12px;">
        <summary class="av-sum"><span style="font-size:14px;font-weight:700;color:${c.complete ? 'var(--reagent)' : 'var(--text)'};">${c.complete ? '✓' : '○'} ${esc(c.title)}</span> <span style="color:var(--muted);font-size:12px;">${c.doneCount}/${c.total}</span></summary>
        <div style="font-size:13px;color:var(--muted);white-space:pre-wrap;margin:8px 0;">${weRich(c.intro)}</div>
        ${c.tasks.map(t => `<div style="display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-top:1px solid var(--line);${t.waiting ? 'opacity:.6;' : ''}">
            <input type="checkbox" class="ln-check" data-id="${esc(t.id)}" ${t.done ? 'checked' : ''} ${t.auto || t.waiting ? 'disabled' : ''} style="width:auto;margin-top:3px;">
            <div style="flex:1;font-size:13px;white-space:pre-wrap;">${weRich(t.text)}${t.auto ? ' <span style="color:var(--muted);font-size:11px;">· ticks itself</span>' : ''}${t.remind ? ' <span style="color:var(--muted);font-size:11px;">· daily habit</span>' : ''}${t.waiting ? ` <span style="color:#f0b432;font-size:11px;">· available from day ${t.fromDay + 1} in the faction (you are on day ${(days || 0) + 1})</span>` : ''}</div>
            ${weLinkBtn(t)}</div>`).join('')}
        ${c.canRemind ? `<label style="display:flex;gap:8px;align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid var(--line);font-size:13px;${c.complete ? 'cursor:pointer;' : 'opacity:.55;'}"><input type="checkbox" class="ln-remind" data-id="${esc(c.id)}" ${c.remindersOn ? 'checked' : ''} ${c.complete ? '' : 'disabled'} style="width:auto;"> 🔔 Put the daily habits of this Lab Note on my daily to-do${c.complete ? '' : ' <span style="color:var(--muted);font-size:11px;">(finish every step first)</span>'}</label>` : ''}
    </details>`).join('');
    $('ln-cards').querySelectorAll('.ln-card').forEach(d => d.addEventListener('toggle', () => { lnOpen[d.dataset.id] = d.open; }));
    $('ln-cards').querySelectorAll('.ln-check').forEach(cb => cb.addEventListener('change', async () => {
        const d = await weFetch({ action: 'wel-done', id: cb.dataset.id, done: cb.checked });
        if (d.error) { toast(d.error); cb.checked = !cb.checked; return; }
        loadWelcomeMine();
    }));
    $('ln-cards').querySelectorAll('.ln-remind').forEach(cb => cb.addEventListener('change', async () => {
        const d = await weFetch({ action: 'lab-reminders', cardId: cb.dataset.id, on: cb.checked });
        if (d.error) { toast(d.error); cb.checked = !cb.checked; return; }
        toast(cb.checked ? 'Added to your daily to-do' : 'Taken off your daily to-do');
        if (typeof loadMyTodos === 'function') loadMyTodos();
    }));
}
function renderWelcomeMine() {
    const r = weMine, panel = $('mt-welcome-panel');
    panel.style.display = 'block';
    const total = r.chapters.reduce((s, c) => s + c.total, 0), done = r.chapters.reduce((s, c) => s + c.doneCount, 0);
    $('we-bar').style.width = `${total ? Math.round(done / total * 100) : 0}%`;
    $('we-role').innerHTML = weRoleHtml(r.role);
    $('we-count').textContent = r.allDone ? 'All done! 🎉' : `${done} of ${total} steps done`;
    $('we-tabs').innerHTML = '';
    // every chapter is its own window: closed until you open it, and a locked one cannot be opened until the one before it is finished
    $('we-body').innerHTML = r.chapters.map((c, i) => {
        const next = r.chapters[i + 1];
        if (c.locked) return `<div style="margin:6px 0;border:1px solid var(--line);border-radius:8px;padding:8px 12px;color:var(--muted);font-size:14px;">🔒 ${i + 1}. Finish chapter ${i} to open this one</div>`;
        return `<details class="we-ch" data-i="${i}" ${weOpen[i] ? 'open' : ''} style="margin:6px 0;border:1px solid ${i === r.current && !r.allDone ? 'var(--reagent)' : 'var(--line)'};border-radius:8px;padding:6px 12px;">
            <summary class="av-sum"><span style="font-size:14px;font-weight:700;color:${c.complete ? 'var(--reagent)' : 'var(--text)'};">${c.complete ? '✓' : '○'} ${i + 1}. ${esc(c.title)}</span> <span style="color:var(--muted);font-size:12px;">${c.doneCount}/${c.total}${i === r.current && !r.allDone ? ' · you are here' : ''}</span></summary>
            <div style="font-size:13px;color:var(--muted);white-space:pre-wrap;margin:8px 0;">${weRich(c.intro)}</div>
            ${c.tasks.map(t => `<div style="display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-top:1px solid var(--line);${t.waiting ? 'opacity:.6;' : ''}">
                <input type="checkbox" class="we-check" data-id="${esc(t.id)}" ${t.done ? 'checked' : ''} ${t.auto || t.waiting ? 'disabled' : ''} style="width:auto;margin-top:3px;">
                <div style="flex:1;font-size:13px;white-space:pre-wrap;">${weRich(t.text)}${t.auto ? ' <span style="color:var(--muted);font-size:11px;">· ticks itself</span>' : ''}${t.waiting ? ` <span style="color:#f0b432;font-size:11px;">· available from day ${t.fromDay + 1} in the faction (you are on day ${(r.days || 0) + 1})</span>` : ''}</div>
                ${weLinkBtn(t)}</div>`).join('')}
            <div style="margin-top:8px;font-size:12px;color:var(--muted);">${next ? (next.locked ? `Tick every step above to open chapter ${i + 2}.` : `Chapter ${i + 2} is open.`) : (r.allDone ? '<span style="color:var(--reagent);">You finished everything. Well done! 🎉</span>' : '')}</div>
        </details>`;
    }).join('');
    $('we-body').querySelectorAll('.we-ch').forEach(d => d.addEventListener('toggle', () => { weOpen[Number(d.dataset.i)] = d.open; }));
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
            ${weRoleHtml(r2.role)}
            <div style="font-size:12px;color:var(--muted);margin:4px 0 6px;">Tick a step for them if they showed you it is done. Steps that say "ticks itself" are checked by WWL.</div>
            ${r2.chapters.map((x, i) => `<details data-ch="${i}" ${(was[i] ?? false) ? 'open' : ''} style="margin:4px 0;border:1px solid var(--line);border-radius:8px;padding:4px 10px;"><summary class="av-sum"><span style="font-size:13px;color:${x.complete ? 'var(--reagent)' : 'var(--text)'};">${x.complete ? '✓' : x.locked ? '🔒' : '○'} ${i + 1}. ${esc(x.title)} <span style="color:var(--muted);font-size:12px;">${x.doneCount}/${x.total}${x.locked ? ' · not open for them yet' : ''}</span></span></summary>
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
let weCfg = null, wePupils = [], weAutoKinds = {}; const weAdminOpen = {}; // weAdminOpen: which chapter cards are open in the editor (closed to begin with)
let weSyncChapters = () => {}, weSyncCards = () => {};
let weSync = () => { weSyncChapters(); weSyncCards(); }; // saves what is typed in both editors into weCfg before anything re-renders
async function loadWelcomeAdmin() {
    const st = $('wa-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    const r = await weFetch({ action: 'wel-config-get' });
    if (r.error) { st.className = 'status err'; st.textContent = r.error; return; }
    st.textContent = ''; st.className = 'status';
    weCfg = { chapters: r.config.chapters.map(c => ({ ...c, tasks: (c.tasks || []).map(t => ({ ...t })) })), cards: (r.config.cards || []).map(c => ({ ...c, tasks: (c.tasks || []).map(t => ({ ...t })) })), custom: r.config.custom };
    wePupils = r.pupils; weAutoKinds = r.autoKinds || {};
    renderPromotions(r.promotions);
    renderWelcomeAdmin();
}
function renderWelcomeAdmin() {
    $('wa-note').textContent = weCfg.custom ? '' : 'These are starting texts, not saved yet. Rewrite them and press Save.';
    const autoOpts = sel => `<option value="">no (tick by hand)</option>${Object.entries(weAutoKinds).map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>ticks itself when ${esc(v)}</option>`).join('')}`;
    $('wa-steps').innerHTML = weCfg.chapters.map((c, i) => `<details class="panel wa-ch" style="margin-bottom:12px;" data-c="${i}" ${weAdminOpen[i] ? "open" : ""}><summary class="av-sum"><b style="font-size:15px;">${i + 1}. ${esc(c.title || "New chapter")}</b> <span style="color:var(--muted);font-size:12px;">${c.tasks.length} step${c.tasks.length === 1 ? "" : "s"}</span></summary>
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
        <button class="ghost small wa-tadd">+ Add step</button></details>`).join('');
    document.querySelectorAll('#wa-steps .wa-ch').forEach(d => d.addEventListener('toggle', () => { weAdminOpen[Number(d.dataset.c)] = d.open; }));
    weSyncChapters = () => {
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
    $('wa-recruits').innerHTML = wePupils.length ? `<table style="width:100%;font-size:13px;border-collapse:collapse;"><thead><tr style="color:var(--muted);text-align:left;"><th style="padding:4px 8px;">Pupil</th><th style="padding:4px 8px;">Mentor</th><th style="padding:4px 8px;">Role</th><th style="padding:4px 8px;">Day</th><th style="padding:4px 8px;">Script</th><th style="padding:4px 8px;">Chapter</th><th style="padding:4px 8px;">Steps</th><th style="padding:4px 8px;">Last progress</th></tr></thead><tbody>${wePupils.map(m => `<tr style="border-top:1px solid var(--line);"><td style="padding:4px 8px;">${esc(m.name)}</td><td style="padding:4px 8px;color:${m.mentor ? 'var(--text)' : 'var(--danger)'};">${esc(m.mentor || 'none yet')}</td><td style="padding:4px 8px;color:var(--muted);">${esc(m.role || '')}</td><td style="padding:4px 8px;font-family:var(--mono);">${m.days == null ? '?' : m.days + 1}</td><td style="padding:4px 8px;">${m.script ? '✓' : '—'}</td><td style="padding:4px 8px;">${m.allDone ? 'done 🎉' : `${m.chapter}/${m.chapters} ${esc(m.chapterTitle)}`}</td><td style="padding:4px 8px;font-family:var(--mono);">${m.done}/${m.total}</td><td style="padding:4px 8px;color:var(--muted);">${weAgo(m.lastTick)}</td></tr>`).join('')}</tbody></table>` : '<p style="color:var(--muted);font-size:13px;margin:0;">No pupils in the mentoring program yet.</p>';
    renderLabAdmin(); // the extra cards below the chapters
}
$('wa-add').addEventListener('click', () => { weSync(); weCfg.chapters.push({ id: '', title: '', intro: '', tasks: [] }); weAdminOpen[weCfg.chapters.length - 1] = true; renderWelcomeAdmin(); });
async function weSaveAll(btn) {
    weSync();
    const st = $('wa-status');
    btn.disabled = true; st.className = 'status ok'; st.textContent = 'Saving…';
    const r = await weFetch({ action: 'wel-config-save', chapters: weCfg.chapters, cards: weCfg.cards });
    btn.disabled = false;
    if (r.error) { st.className = 'status err'; st.textContent = r.error; return; }
    loadWelcomeAdmin().then(() => { st.className = 'status ok'; st.textContent = '✓ Saved'; });
}
$('wa-save').addEventListener('click', () => weSaveAll($('wa-save')));
$('wa-save2').addEventListener('click', () => weSaveAll($('wa-save2')));

// ---- leaders: the extra cards (Lab Notes without a lock between them) ----
const weCardOpen = {};
function renderLabAdmin() {
    const autoOpts = sel => `<option value="">no (tick by hand)</option>${Object.entries(weAutoKinds).map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>ticks itself when ${esc(v)}</option>`).join('')}`;
    $('wa-cards').innerHTML = weCfg.cards.length ? weCfg.cards.map((c, i) => `<details class="panel wc-card" data-k="${i}" ${weCardOpen[i] ? 'open' : ''} style="margin-bottom:12px;">
        <summary class="av-sum"><b style="font-size:15px;">${esc(c.title || 'New Lab Note')}</b> <span style="color:var(--muted);font-size:12px;">${c.tasks.length} step${c.tasks.length === 1 ? '' : 's'}${c.tasks.some(t => t.remind) ? ` · ${c.tasks.filter(t => t.remind).length} daily habit${c.tasks.filter(t => t.remind).length === 1 ? '' : 's'}` : ''}</span></summary>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-top:8px;">
            <div class="field" style="margin:0;flex:1;min-width:220px;"><label>Title</label><input class="wc-title" maxlength="80" value="${esc(c.title)}"></div>
            <button class="ghost small wc-del" style="color:var(--danger);">Remove this Lab Note</button>
        </div>
        <div class="field" style="margin:8px 0;"><label>Intro (put links as [text](https://...))</label><textarea class="wc-intro" rows="3" maxlength="1200">${esc(c.intro)}</textarea></div>
        ${c.tasks.map((t, j) => `<div style="border-top:1px solid var(--line);padding:8px 0;" data-t="${j}">
            <div style="display:flex;gap:8px;align-items:flex-start;"><div class="field" style="margin:0;flex:1;"><label>Step</label><textarea class="wc-ttext" rows="2" maxlength="600">${esc(t.text)}</textarea></div><button class="ghost small wc-tdel" style="color:var(--danger);margin-top:20px;">✕</button></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
                <div class="field" style="margin:0;flex:1;min-width:200px;"><label>Link (WWL page or full link, optional)</label><input class="wc-tlink" maxlength="300" value="${esc(t.link)}"></div>
                <div class="field" style="margin:0;width:150px;"><label>Button text</label><input class="wc-tlabel" maxlength="40" value="${esc(t.label)}"></div>
                <div class="field" style="margin:0;min-width:230px;"><label>Checked</label><select class="wc-tauto">${autoOpts(t.auto)}</select></div>
                <div class="field" style="margin:0;width:150px;"><label>Role name(s)</label><input class="wc-targ" maxlength="80" placeholder="Guinea Pig|Lab Rat" value="${esc(t.autoArg)}"></div>
                <div class="field" style="margin:0;width:120px;"><label>From faction day</label><input type="number" class="wc-tday" min="0" max="60" value="${esc(t.fromDay || 0)}"></div>
            </div>
            <div class="field" style="margin:6px 0 0;"><label>Daily reminder (only if this step is a habit worth repeating; leave empty if not)</label><input class="wc-tremind" maxlength="100" placeholder="e.g. Buy your plushies from Bits and Bobs" value="${esc(t.remind || '')}"></div></div>`).join('')}
        <button class="ghost small wc-tadd">+ Add step</button></details>`).join('') : '<p style="color:var(--muted);font-size:13px;margin:0 0 8px;">No extra Lab Notes yet.</p>';
    weSyncCards = () => {
        document.querySelectorAll('#wa-cards .wc-card').forEach(card => {
            const c = weCfg.cards[Number(card.dataset.k)];
            c.title = card.querySelector('.wc-title').value; c.intro = card.querySelector('.wc-intro').value;
            card.querySelectorAll('[data-t]').forEach(row => {
                const t = c.tasks[Number(row.dataset.t)];
                t.text = row.querySelector('.wc-ttext').value; t.link = row.querySelector('.wc-tlink').value; t.label = row.querySelector('.wc-tlabel').value;
                t.auto = row.querySelector('.wc-tauto').value; t.autoArg = row.querySelector('.wc-targ').value; t.fromDay = Number(row.querySelector('.wc-tday').value) || 0; t.remind = row.querySelector('.wc-tremind').value;
            });
        });
    };
    const idx = el => Number(el.closest('.wc-card').dataset.k);
    const redo = fn => () => { weSync(); fn(); renderLabAdmin(); };
    document.querySelectorAll('#wa-cards .wc-card').forEach(d => d.addEventListener('toggle', () => { weCardOpen[Number(d.dataset.k)] = d.open; }));
    document.querySelectorAll('#wa-cards .wc-del').forEach(b => b.addEventListener('click', redo(() => { if (confirm('Remove this whole Lab Note?')) weCfg.cards.splice(idx(b), 1); })));
    document.querySelectorAll('#wa-cards .wc-tadd').forEach(b => b.addEventListener('click', redo(() => weCfg.cards[idx(b)].tasks.push({ id: '', text: '', link: '', label: '', auto: '', autoArg: '', fromDay: 0, remind: '' }))));
    document.querySelectorAll('#wa-cards .wc-tdel').forEach(b => b.addEventListener('click', redo(() => weCfg.cards[idx(b)].tasks.splice(Number(b.closest('[data-t]').dataset.t), 1))));
}
$('wa-card-add').addEventListener('click', () => { weSync(); weCfg.cards.push({ id: '', title: '', intro: '', tasks: [] }); weCardOpen[weCfg.cards.length - 1] = true; renderLabAdmin(); });

// ---- leaders: who is ready for promotion ----
function renderPromotions(list) {
    $('wa-promo-list').innerHTML = list && list.length
        ? `<table style="width:100%;font-size:13px;border-collapse:collapse;"><thead><tr style="color:var(--muted);text-align:left;"><th style="padding:4px 8px;">Member</th><th style="padding:4px 8px;">Now</th><th style="padding:4px 8px;">Move to</th><th style="padding:4px 8px;">Why</th></tr></thead><tbody>${list.map(m => `<tr style="border-top:1px solid var(--line);${m.waiting ? 'opacity:.55;' : ''}"><td style="padding:4px 8px;font-weight:700;">${esc(m.name)}${m.waiting ? ' <span style="font-weight:400;font-size:11px;color:var(--muted);" title="War related: it opens after the newsletter with the check-in messages is marked as sent (Newsletter page)">⏳ after the newsletter</span>' : ''}</td><td style="padding:4px 8px;color:var(--muted);">${esc(m.from)}</td><td style="padding:4px 8px;color:${m.kind === 'demote' || m.kind === 'check' ? 'var(--danger)' : 'var(--reagent)'};white-space:nowrap;">${m.kind === 'demote' ? '⬇ move down to' : m.kind === 'check' ? '⚠ should be' : '⬆'} ${esc(m.to)}</td><td style="padding:4px 8px;color:var(--muted);">${esc(m.why)}</td></tr>`).join('')}</tbody></table>`
        : '<p style="color:var(--muted);font-size:13px;margin:0;">Nobody is due for a promotion or a move down right now, and everyone holds a role they meet the requirements of.</p>';
}
$('wa-promo-refresh').addEventListener('click', async () => {
    const b = $('wa-promo-refresh');
    b.disabled = true; b.textContent = 'Checking…';
    const r = await weFetch({ action: 'wel-config-get', refreshPromotions: true });
    b.disabled = false; b.textContent = 'Check again now';
    if (r.error) { toast(r.error); return; }
    renderPromotions(r.promotions);
});

// ---- a mentor sees their pupil's training and energy plan (inside the pupil's card), closed until opened ----
async function weLoadInsight(pupilId, box) {
    const r = await weFetch({ action: 'wel-pupil-insight', pupilId });
    if (r.error) { box.innerHTML = ''; return; }
    const n = v => Math.round(v).toLocaleString();
    const max = Math.max(1, r.weekly || 0, ...r.weeks.map(w => w.total));
    const day = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const planHtml = r.plan
        ? `<div style="font-size:13px;margin:6px 0;"><b>⚡ Energy plan:</b> ${esc(r.plan.method || 'a plan')}${r.plan.stat ? ` <span style="color:var(--muted);">(${esc(r.plan.stat)})</span>` : ''}${r.plan.summary ? `<div style="color:var(--muted);font-size:12px;margin-top:2px;">${esc(r.plan.summary)}</div>` : ''}<div style="color:var(--muted);font-size:12px;margin-top:2px;">This week: ${r.plan.done} of ${r.plan.total} steps ticked${r.plan.weekly ? ` · weekly minimum ${n(r.plan.weekly)} E` : ''}</div></div>`
        : '<div style="font-size:13px;margin:6px 0;color:#f0b432;">⚠ No energy plan set yet. They pick one on the Energy planner page: a good moment to help them choose a method that fits their level.</div>';
    const rows = r.tracked ? r.weeks.map(w => {
        const low = r.weekly && w.total < r.weekly;
        return `<div style="display:flex;align-items:center;gap:8px;font-size:12px;margin:2px 0;"><div style="width:96px;color:var(--muted);">${day(w.from)} – ${day(w.to)}</div><div style="flex:1;background:var(--bench-2);border-radius:4px;height:12px;"><div style="width:${(w.total / max * 100).toFixed(1)}%;background:${low ? '#f0b432' : 'var(--reagent)'};height:12px;border-radius:4px;"></div></div><div style="width:70px;text-align:right;font-family:var(--mono);">${n(w.total)} E</div></div>`;
    }).join('') : '<div style="font-size:12px;color:var(--muted);">No energy has been recorded for them yet.</div>';
    box.innerHTML = `<details style="margin-bottom:14px;"><summary class="av-sum"><span style="font-size:13px;font-weight:700;">📈 Their training and energy plan</span></summary>${planHtml}<div style="font-size:12px;color:var(--muted);margin:6px 0 2px;">Energy trained per week${r.weekly ? ` (weekly minimum ${n(r.weekly)} E, below it shows amber)` : ''}</div>${rows}</details>`;
}
