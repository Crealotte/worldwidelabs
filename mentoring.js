// mentoring.js — the Mentoring Platform: the member-facing "🎓 Mentoring" page (your pairing, shared checklist,
// private chat) and the leader-only "Mentoring admin" page (note mentors/pupils, pair them up, edit the shared
// checklist). Backend: lib/mentoring.js, routed through api/war-payout.js as the 'mentor-*' actions. The chat
// polls quietly while this page is the one on screen, and stops the moment you navigate away.
'use strict';

async function mtFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}
const mtWhen = ts => new Date(ts).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

// ============================================================================================
// ==============================  MEMBER-FACING "Mentoring"  =================================
// ============================================================================================

let mtData = null; // last 'mentor-my-status' response
let mtPollTimer = null;

async function loadMentoring() {
    if (mtPollTimer) { clearInterval(mtPollTimer); mtPollTimer = null; }
    const st = $('mt-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    try {
        const r = await mtFetch({ action: 'mentor-my-status' });
        if (r.error) throw new Error(r.error);
        mtData = r;
        st.textContent = ''; st.className = 'status';
        // showing up in the menu at all already means you're in a pair (or a leader) — kept as a safety net for a direct link
        $('nav-mentoring').style.display = (r.isMentor || r.isPupil || r.allPairs !== undefined) ? '' : 'none';
        $('mt-empty').style.display = (r.pairs.length || r.allPairs?.length) ? 'none' : 'block';
        renderMentoringPairs();
        $('mt-oversight-wrap').style.display = r.allPairs !== undefined ? 'block' : 'none';
        if (r.allPairs !== undefined) renderMentoringOversight();
        const allPairIds = [...r.pairs.map(p => p.pairId), ...(r.allPairs || []).map(p => p.pairId)];
        if (allPairIds.length) {
            mtPollTimer = setInterval(() => {
                const page = document.getElementById('page-mentoring');
                if (!page || !page.classList.contains('visible')) { clearInterval(mtPollTimer); mtPollTimer = null; return; }
                allPairIds.forEach(id => mtRefreshChat(id, false));
            }, 8000);
        }
    } catch (e) { st.className = 'status err'; st.textContent = e.message; }
}

// Leader oversight: every OTHER pairing (their own, if any, already shows above via renderMentoringPairs), read
// only — the checklist shows as plain done/not-done, and the chat has no box to type in.
function renderMentoringOversight() {
    $('mt-oversight').innerHTML = mtData.allPairs.map(p => `
        <div class="panel" style="margin-bottom:16px;" data-pair="${esc(p.pairId)}">
            <h3 style="margin-top:0;">${esc(p.mentorName)} ↔ ${esc(p.pupilName)}</h3>
            ${mtData.todos.length ? `<div style="margin-bottom:16px;">
                ${mtData.todos.map(t => `<div style="padding:3px 0;color:${p.done.includes(t.id) ? 'var(--reagent)' : 'var(--muted)'};">${p.done.includes(t.id) ? '✓' : '○'} ${esc(t.text)}</div>`).join('')}
            </div>` : ''}
            <div style="border-top:1px solid var(--line);padding-top:12px;">
                <div class="mt-chat" style="max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;"></div>
            </div>
        </div>`).join('');
    mtData.allPairs.forEach(p => mtRefreshChat(p.pairId, true));
}

function mtPairKey(p) { const [mentorId, pupilId] = p.pairId.split(':'); return { mentorId, pupilId }; }

function renderMentoringPairs() {
    $('mt-pairs').innerHTML = mtData.pairs.map(p => {
        const items = mtData.todos.filter(t => t.role === 'both' || t.role === p.role);
        return `
        <div class="panel" style="margin-bottom:16px;" data-pair="${esc(p.pairId)}">
            <h3 style="margin-top:0;">${p.role === 'mentor' ? `You are mentoring ${esc(p.otherName)}` : `Your mentor is ${esc(p.otherName)}`}</h3>
            ${items.length ? `<div class="mt-todos" style="margin-bottom:16px;">
                ${items.map(t => `<label style="display:flex;gap:8px;align-items:center;padding:4px 0;cursor:pointer;">
                    <input type="checkbox" style="width:auto;" class="mt-todo" data-id="${esc(t.id)}" ${p.done.includes(t.id) ? 'checked' : ''}> ${esc(t.text)}</label>`).join('')}
            </div>` : '<p style="color:var(--muted);font-size:13px;margin:0 0 16px;">No checklist yet — a leader can add one in Mentoring admin.</p>'}
            <div style="border-top:1px solid var(--line);padding-top:12px;">
                <div class="mt-chat" style="max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;margin-bottom:8px;"></div>
                <div style="display:flex;gap:8px;">
                    <input type="text" class="mt-chat-input" maxlength="500" placeholder="Message…" style="flex:1;">
                    <button class="ghost small mt-chat-send">Send</button>
                </div>
            </div>
        </div>`;
    }).join('');

    document.querySelectorAll('#mt-pairs .panel').forEach(card => {
        const pairId = card.dataset.pair;
        card.querySelectorAll('.mt-todo').forEach(cb => cb.addEventListener('change', async () => {
            const { mentorId, pupilId } = mtPairKey({ pairId });
            const r = await mtFetch({ action: 'mentor-todo-toggle', mentorId, pupilId, todoId: cb.dataset.id, checked: cb.checked });
            if (r.error) { toast(r.error); cb.checked = !cb.checked; }
            else { const p = mtData.pairs.find(x => x.pairId === pairId); if (cb.checked) p.done = [...new Set([...p.done, cb.dataset.id])]; else p.done = p.done.filter(id => id !== cb.dataset.id); }
        }));
        const send = async () => {
            const input = card.querySelector('.mt-chat-input');
            const text = input.value.trim();
            if (!text) return;
            const { mentorId, pupilId } = mtPairKey({ pairId });
            input.disabled = true;
            const r = await mtFetch({ action: 'mentor-chat-send', mentorId, pupilId, text });
            input.disabled = false;
            if (r.error) { toast(r.error); return; }
            input.value = '';
            mtRefreshChat(pairId, true);
        };
        card.querySelector('.mt-chat-send').addEventListener('click', send);
        card.querySelector('.mt-chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
        mtRefreshChat(pairId, true);
    });
}

async function mtRefreshChat(pairId, scrollToEnd) {
    const card = document.querySelector(`.panel[data-pair="${CSS.escape(pairId)}"]`); // lives in #mt-pairs (mine) or #mt-oversight (a leader looking in)
    if (!card) return;
    const { mentorId, pupilId } = mtPairKey({ pairId });
    const r = await mtFetch({ action: 'mentor-chat-read', mentorId, pupilId });
    if (r.error) return;
    const box = card.querySelector('.mt-chat');
    const wasAtBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
    box.innerHTML = r.messages.length ? r.messages.map(m => `
        <div style="align-self:${m.from === String(mtMyId()) ? 'flex-end' : 'flex-start'};max-width:80%;">
            <div style="background:${m.from === String(mtMyId()) ? 'var(--reagent-dim)' : 'var(--bench-2)'};border-radius:10px;padding:6px 10px;font-size:13px;">${esc(m.text)}</div>
            <div style="color:var(--muted);font-size:10px;margin-top:2px;">${esc(m.name || m.role)} · ${esc(mtWhen(m.at))}</div>
        </div>`).join('') : '<p style="color:var(--muted);font-size:12px;margin:0;">No messages yet — say hello!</p>';
    if (wasAtBottom || scrollToEnd) box.scrollTop = box.scrollHeight;
}
// A message's own `from` id is the sender's Torn id, so bubbles line up left/right by comparing to mine —
// `profile` is the same object the dashboard greeting already reads `profile.player_id` from.
const mtMyId = () => String((typeof profile !== 'undefined' && profile?.player_id) || '');

// ============================================================================================
// ==================================  LEADER: Mentoring admin  ===============================
// ============================================================================================

let mtaProgram = null, mtaTodos = [], mtaRoster = [], mtaHours = {}; // mtaHours: playerId -> usual online hours (TCT), see online-hours.js

async function loadMentoringAdmin() {
    // Leader/Co-leader only end to end (see AUDIT.md).
    const locked = typeof canEditLeaderOnly === 'undefined' || !canEditLeaderOnly;
    $('mta-locked').style.display = locked ? 'block' : 'none';
    $('mta-body').style.display = locked ? 'none' : 'block';
    if (locked) return;
    const st = $('mta-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    try {
        const [r, rosterData, oh] = await Promise.all([mtFetch({ action: 'mentor-program-get' }), tornV2('/faction/members?striptags=true'), mtFetch({ action: 'oh-all' })]);
        mtaHours = (oh && oh.all) || {};
        if (r.error) throw new Error(r.error);
        mtaProgram = r.program; mtaTodos = r.todos.map(t => ({ ...t }));
        mtaRoster = (rosterData?.members || []).slice().sort((a, b) => a.name.localeCompare(b.name));
        st.textContent = ''; st.className = 'status';
        renderMta();
    } catch (e) { st.className = 'status err'; st.textContent = e.message; }
}

// Everyone on the roster who isn't already a mentor/pupil — so the dropdown only ever offers someone new to add.
function renderMtaSelects() {
    const opt = m => `<option value="${m.id}">${esc(m.name)}</option>`;
    $('mta-m-select').innerHTML = mtaRoster.filter(m => !mtaProgram.mentors[String(m.id)]).map(opt).join('') || '<option value="">— everyone is already a mentor —</option>';
    $('mta-p-select').innerHTML = mtaRoster.filter(m => !mtaProgram.pupils[String(m.id)]).map(opt).join('') || '<option value="">— everyone is already a pupil —</option>';
}

function mtaPupilCount(mentorId) { return Object.values(mtaProgram.pupils).filter(p => String(p.mentorId) === String(mentorId)).length; }

let mtaMentorSort = { key: null, dir: 'asc' };
const mtaMentorAccessors = { name: ([id, m]) => (m.name || `#${id}`).toLowerCase(), pupils: ([id]) => mtaPupilCount(id) };
let mtaPupilSort = { key: null, dir: 'asc' };
const mtaPupilAccessors = { name: ([id, p]) => (p.name || `#${id}`).toLowerCase(), mentor: ([, p]) => (mtaProgram.mentors[p.mentorId]?.name || '').toLowerCase() };
function renderMta() {
    $('mta-oh-bar').innerHTML = `<label style="display:inline-flex;gap:6px;align-items:center;cursor:pointer;"><input type="checkbox" id="mta-oh-tz" style="width:auto;" ${ohLocal && ohOffsetOk() ? 'checked' : ''} ${ohOffsetOk() ? '' : 'disabled'}> Show online hours in my own time zone</label> <span>— hours are members\x27 own, set on their dashboard (${Object.keys(mtaHours).length} of ${mtaRoster.length} have set them). Shown in ${ohZone()}.</span>`;
    $('mta-oh-tz').addEventListener('change', () => { ohLocal = $('mta-oh-tz').checked; try { localStorage.setItem(OH_TZ_KEY, ohLocal ? '1' : '0'); } catch (e) { /* not critical */ } renderMta(); });
    const mentors = sortRows(Object.entries(mtaProgram.mentors), mtaMentorSort, mtaMentorAccessors);
    $('mta-mentors').innerHTML = mentors.length ? `
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <thead><tr style="color:var(--muted);text-align:left;"><th data-sort="name" style="padding:4px 8px;">Name</th><th data-sort="pupils" style="padding:4px 8px;">Pupils</th><th style="padding:4px 8px;">Usually online <span style="font-weight:400;">(${ohZone()})</span></th><th style="padding:4px 8px;">Note</th><th style="padding:4px 8px;"></th></tr></thead>
            <tbody>${mentors.map(([id, m]) => `<tr style="border-top:1px solid var(--line);">
                <td style="padding:5px 8px;">${esc(m.name || `#${id}`)} <span style="color:var(--muted);font-size:11px;">[${id}]</span></td>
                <td style="padding:5px 8px;">${mtaPupilCount(id)} / <select class="mta-cap" data-id="${id}" style="width:auto;display:inline-block;padding:2px 6px;"><option value="0" ${m.capacity === 0 ? 'selected' : ''}>0</option><option value="1" ${m.capacity === 1 ? 'selected' : ''}>1</option><option value="2" ${m.capacity === 2 ? 'selected' : ''}>2</option><option value="3" ${m.capacity === 3 ? 'selected' : ''}>3</option></select></td>
                <td style="padding:5px 8px;">${ohStrip(mtaHours[id])}</td>
                <td style="padding:5px 8px;color:var(--muted);">${esc(m.note || '')}</td>
                <td style="padding:5px 8px;"><button class="ghost small mta-m-del" data-id="${id}" style="color:var(--danger);">Remove</button></td>
            </tr>`).join('')}</tbody>
        </table>` : '<p style="color:var(--muted);font-size:13px;margin:0;">No mentors added yet.</p>';

    const roomyMentors = mentors.filter(([id, m]) => mtaPupilCount(id) < m.capacity);
    const pupils = sortRows(Object.entries(mtaProgram.pupils), mtaPupilSort, mtaPupilAccessors);
    $('mta-pupils').innerHTML = pupils.length ? `
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <thead><tr style="color:var(--muted);text-align:left;"><th data-sort="name" style="padding:4px 8px;">Name</th><th data-sort="mentor" style="padding:4px 8px;">Mentor</th><th style="padding:4px 8px;">Usually online <span style="font-weight:400;">(${ohZone()})</span></th><th style="padding:4px 8px;">Note</th><th style="padding:4px 8px;"></th></tr></thead>
            <tbody>${pupils.map(([id, p]) => {
                // the mentors with room, the ones online at the same hours as this pupil first
                const together = mid => ohOverlap(mtaHours[id], mtaHours[mid]);
                const ranked = roomyMentors.slice().sort((a, b) => (together(b[0]) ?? -1) - (together(a[0]) ?? -1));
                const options = ['<option value="">— unassigned —</option>']
                    .concat(ranked.map(([mid, m]) => `<option value="${mid}" ${String(p.mentorId) === mid ? 'selected' : ''}>${esc(m.name || `#${mid}`)} (${mtaPupilCount(mid)}/${m.capacity})${together(mid) != null ? ` · ${together(mid)}h online together` : ''}</option>`));
                if (p.mentorId && !roomyMentors.some(([mid]) => mid === String(p.mentorId))) { // keep their current (full) mentor selectable, so re-saving doesn't silently unassign them
                    const cur = mtaProgram.mentors[p.mentorId];
                    options.push(`<option value="${p.mentorId}" selected>${esc(cur?.name || `#${p.mentorId}`)} (full)</option>`);
                }
                return `<tr style="border-top:1px solid var(--line);">
                    <td style="padding:5px 8px;">${esc(p.name || `#${id}`)} <span style="color:var(--muted);font-size:11px;">[${id}]</span></td>
                    <td style="padding:5px 8px;"><select class="mta-assign" data-id="${id}" style="width:auto;">${options.join('')}</select></td>
                    <td style="padding:5px 8px;">${ohStrip(mtaHours[id])}</td>
                    <td style="padding:5px 8px;color:var(--muted);">${esc(p.note || '')}</td>
                    <td style="padding:5px 8px;"><button class="ghost small mta-p-del" data-id="${id}" style="color:var(--danger);">Remove</button></td>
                </tr>`;
            }).join('')}</tbody>
        </table>` : '<p style="color:var(--muted);font-size:13px;margin:0;">No pupils added yet.</p>';
    wireSort($('mta-mentors'), mtaMentorSort, mentors, mtaMentorAccessors, renderMta);
    wireSort($('mta-pupils'), mtaPupilSort, pupils, mtaPupilAccessors, renderMta);

    document.querySelectorAll('.mta-cap').forEach(sel => sel.addEventListener('change', async () => {
        const r = await mtFetch({ action: 'mentor-set-capacity', id: sel.dataset.id, capacity: sel.value });
        if (r.error) { toast(r.error); return; }
        mtaProgram = r.program; renderMta();
    }));
    document.querySelectorAll('.mta-m-del').forEach(btn => btn.addEventListener('click', async () => {
        if (!confirm('Remove this mentor? Their pupils go back to unassigned, not deleted.')) return;
        const r = await mtFetch({ action: 'mentor-remove', id: btn.dataset.id });
        if (r.error) { toast(r.error); return; }
        mtaProgram = r.program; renderMta();
    }));
    document.querySelectorAll('.mta-p-del').forEach(btn => btn.addEventListener('click', async () => {
        if (!confirm('Remove this pupil from the program?')) return;
        const r = await mtFetch({ action: 'pupil-remove', id: btn.dataset.id });
        if (r.error) { toast(r.error); return; }
        mtaProgram = r.program; renderMta();
    }));
    document.querySelectorAll('.mta-assign').forEach(sel => sel.addEventListener('change', async () => {
        const pupilId = sel.dataset.id, mentorId = sel.value;
        const r = await mtFetch(mentorId ? { action: 'mentor-assign', pupilId, mentorId } : { action: 'mentor-unassign', pupilId });
        if (r.error) { toast(r.error); renderMta(); return; }
        mtaProgram = r.program; renderMta();
    }));

    renderMtaTodos();
    renderMtaSelects();
}

function renderMtaTodos() {
    $('mta-todos').innerHTML = mtaTodos.length ? mtaTodos.map((t, i) => `
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
            <input class="mta-todo-text" data-i="${i}" value="${esc(t.text)}" placeholder="Checklist item" style="flex:1;max-width:420px;" maxlength="200">
            <select class="mta-todo-role" data-i="${i}" style="width:auto;">
                <option value="both" ${t.role === 'both' ? 'selected' : ''}>Both</option>
                <option value="mentor" ${t.role === 'mentor' ? 'selected' : ''}>Mentor only</option>
                <option value="pupil" ${t.role === 'pupil' ? 'selected' : ''}>Pupil only</option>
            </select>
            <button class="ghost small mta-todo-del" data-i="${i}">✕</button>
        </div>`).join('') : '<p style="color:var(--muted);font-size:13px;margin:0 0 8px;">No checklist items yet.</p>';
    document.querySelectorAll('.mta-todo-text').forEach(inp => inp.addEventListener('input', e => { mtaTodos[Number(e.target.dataset.i)].text = e.target.value; }));
    document.querySelectorAll('.mta-todo-role').forEach(sel => sel.addEventListener('change', e => { mtaTodos[Number(e.target.dataset.i)].role = e.target.value; }));
    document.querySelectorAll('.mta-todo-del').forEach(btn => btn.addEventListener('click', () => { mtaTodos.splice(Number(btn.dataset.i), 1); renderMtaTodos(); }));
}
$('mta-todo-add').addEventListener('click', () => { mtaTodos.push({ id: '', text: '', role: 'both' }); renderMtaTodos(); });
$('mta-todo-save').addEventListener('click', async () => {
    const r = await mtFetch({ action: 'mentor-todos-save', items: mtaTodos });
    if (r.error) { toast(r.error); return; }
    mtaTodos = r.todos.map(t => ({ ...t }));
    toast('Checklist saved');
    renderMtaTodos();
});

$('mta-m-add').addEventListener('click', async () => {
    const sel = $('mta-m-select');
    const id = sel.value;
    if (!id) { toast('Pick someone from the list.'); return; }
    const name = sel.options[sel.selectedIndex].textContent;
    const r = await mtFetch({ action: 'mentor-add', id, name, capacity: $('mta-m-cap').value, note: $('mta-m-note').value });
    if (r.error) { toast(r.error); return; }
    mtaProgram = r.program; renderMta();
    $('mta-m-note').value = '';
    toast('Mentor added');
});
$('mta-p-add').addEventListener('click', async () => {
    const sel = $('mta-p-select');
    const id = sel.value;
    if (!id) { toast('Pick someone from the list.'); return; }
    const name = sel.options[sel.selectedIndex].textContent;
    const r = await mtFetch({ action: 'pupil-add', id, name, note: $('mta-p-note').value });
    if (r.error) { toast(r.error); return; }
    mtaProgram = r.program; renderMta();
    $('mta-p-note').value = '';
    toast('Pupil added');
});

// A member who is a mentor or pupil gets the 🎓 Mentoring nav item revealed, the same way Labs Funds reveals
// itself to an owner — checked once at login (see core.js), cheap (one request, answered from our own database).
async function checkMentoringAccess() {
    try {
        const r = await mtFetch({ action: 'mentor-my-status' });
        const nav = document.getElementById('nav-mentoring');
        // `allPairs` only ever comes back for a leader (see lib/mentoring.js) — so a leader gets the menu item
        // too, purely to look in on the program, even with no pairing of their own.
        if (nav) nav.style.display = (!r.error && (r.isMentor || r.isPupil || r.allPairs !== undefined)) ? '' : 'none';
    } catch (e) { /* nav item just stays hidden */ }
}
