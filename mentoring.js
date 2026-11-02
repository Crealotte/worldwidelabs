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
    if (typeof loadOnlineHours === 'function') loadOnlineHours(); // the usual-online-hours panel at the top of this page
    if (mtPollTimer) { clearInterval(mtPollTimer); mtPollTimer = null; }
    const st = $('mt-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    try {
        const r = await mtFetch({ action: 'mentor-my-status' });
        if (r.error) throw new Error(r.error);
        mtData = r;
        st.textContent = ''; st.className = 'status';
        // showing up in the menu at all already means you're in a pair (or a leader) — kept as a safety net for a direct link
        $('mt-empty').style.display = (r.pairs.length || r.allPairs?.length) ? 'none' : 'block';
        renderMentoringPairs();
        renderMtJoin(); renderMtRequests(); loadMtCandidates();
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
// only — the chat has no box to type in.
function renderMentoringOversight() {
    $('mt-oversight').innerHTML = mtData.allPairs.map(p => `
        <div class="panel" style="margin-bottom:16px;" data-pair="${esc(p.pairId)}">
            <h3 style="margin-top:0;">${esc(p.mentorName)} ↔ ${esc(p.pupilName)}</h3>
            <div style="border-top:1px solid var(--line);padding-top:12px;">
                <div class="mt-chat" style="max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;"></div>
            </div>
        </div>`).join('');
    mtData.allPairs.forEach(p => mtRefreshChat(p.pairId, true));
}

function mtPairKey(p) { const [mentorId, pupilId] = p.pairId.split(':'); return { mentorId, pupilId }; }

function renderMentoringPairs() {
    $('mt-pairs').innerHTML = mtData.pairs.map(p => {
        return `
        <div class="panel" style="margin-bottom:16px;" data-pair="${esc(p.pairId)}">
            <h3 style="margin-top:0;">${p.role === 'mentor' ? `You are mentoring ${esc(p.otherName)}` : `Your mentor is ${esc(p.otherName)}`}</h3>
            ${p.role === 'mentor' ? `<div class="mt-welcome" data-pupil="${esc(p.otherId)}"></div>` : ''}
            ${p.role === 'mentor' ? `<div class="mt-insight" data-pupil="${esc(p.otherId)}"></div>` : ''}
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
        const wel = card.querySelector('.mt-welcome'); // a mentor sees the welcome steps their pupil is getting (while the pupil is a recruit)
        if (wel && typeof weLoadPupil === 'function') weLoadPupil(wel.dataset.pupil, wel);
        const ins = card.querySelector('.mt-insight'); // their training and energy plan, for the mentor only
        if (ins && typeof weLoadInsight === 'function') weLoadInsight(ins.dataset.pupil, ins);
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
    { const bar = $('mta-open-bar'); if (bar) { const open = mtaProgram.open === true;
        bar.innerHTML = `<b>Self sign-up for members is ` + (open ? '<span style="color:var(--reagent);">OPEN</span>' : '<span style="color:var(--danger);">CLOSED</span>') + `.</b> <span style="color:var(--muted);">` + (open ? 'Members can sign up, tick their online hours and ask each other.' : 'Only leaders can use it, to test it. Open it when the newsletter goes out.') + `</span> <button class="small" id="mta-open-toggle">` + (open ? 'Close it' : 'Open it for members') + `</button>`;
        $('mta-open-toggle').onclick = async () => { const r = await mtFetch({ action: 'mentor-open-set', open: !open }); if (r.error) { toast(r.error); return; } mtaProgram.open = r.open; toast(r.open ? 'Sign-up is open for members' : 'Sign-up is closed'); renderMta(); }; } }
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

    renderMtaSelects();
}


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

// The 🎓 Mentoring menu item is there for everybody now: anyone can sign up (as a pupil, or as a mentor from Lab Rat up), so no request is needed at login any more.
function checkMentoringAccess() {
    const nav = document.getElementById('nav-mentoring');
    if (nav) nav.style.display = '';
}

// ============================================================================================
// ==========  Self service: sign up, see who fits by online hours, ask, accept or decline  ===========
// ============================================================================================
async function mtDo(body, okText) {
    const r = await mtFetch(body);
    if (r.error) { toast(r.error); return false; }
    if (okText) toast(okText);
    await loadMentoring();
    return true;
}

function renderMtJoin() {
    const el = $('mt-join'), d = mtData;
    const isLeaderView = d.allPairs !== undefined;
    if (!d.signupOpen && !isLeaderView) { // the leaders open the sign-up with the newsletter: until then members only see this
        el.innerHTML = '<h3 style="margin-top:0;">🎓 Mentoring sign-up opens soon</h3><p style="margin:0;font-size:13px;color:var(--muted);">You will be able to sign up as a pupil or as a mentor here, tick your online hours and ask someone who fits. Watch the next newsletter.</p>';
        return;
    }
    if (!d.signupOpen) el.dataset.test = '1';
    const waiting = d.myMentor && !d.myMentor.mentorId;
    if (d.isMentor) {
        const p = d.myMentorProfile || { capacity: d.capacity || 1, free: 0, note: '' };
        el.innerHTML = `<h3 style="margin-top:0;">🎓 You are signed up as a mentor</h3>
            <p style="margin:0 0 8px;font-size:13px;">Room for <b>${p.capacity}</b> pupil${p.capacity === 1 ? '' : 's'} (<b>${p.free}</b> free).${p.note ? ` <span style="color:var(--muted);">“${esc(p.note)}”</span>` : ''}</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                <label style="font-size:13px;">Pupils I can take <select id="mt-cap" style="width:auto;">${[1, 2, 3].map(n => `<option value="${n}" ${n === p.capacity ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
                <input type="text" id="mt-note" maxlength="200" placeholder="A line about yourself (optional)" value="${esc(p.note)}" style="flex:1;min-width:200px;">
                <button class="small" id="mt-save-mentor">Save</button>
                <button class="ghost small" id="mt-step-out">Step out</button>
            </div>`;
        $('mt-save-mentor').onclick = () => mtDo({ action: 'mentor-apply', as: 'mentor', capacity: $('mt-cap').value, note: $('mt-note').value }, 'Saved');
        $('mt-step-out').onclick = () => { if (confirm('Step out as a mentor? Your pupils go back to waiting for a mentor.')) mtDo({ action: 'mentor-withdraw', as: 'mentor' }, 'You are no longer a mentor'); };
    } else if (d.myMentor) {
        el.innerHTML = `<h3 style="margin-top:0;">🎓 You are signed up for a mentor</h3>
            <p style="margin:0 0 8px;font-size:13px;">${waiting ? 'You are waiting for a mentor: pick one below and ask them. They have to accept first.' : 'You have a mentor, see your pairing below.'}</p>
            <input type="text" id="mt-note" maxlength="200" placeholder="What do you want help with? (optional)" value="${esc(d.myMentor.note)}" style="max-width:420px;">
            <div style="display:flex;gap:8px;margin-top:8px;"><button class="small" id="mt-save-pupil">Save</button><button class="ghost small" id="mt-step-out">Step out</button></div>`;
        $('mt-save-pupil').onclick = () => mtDo({ action: 'mentor-apply', as: 'pupil', note: $('mt-note').value }, 'Saved');
        $('mt-step-out').onclick = () => { if (confirm('Step out? You would lose your pairing.')) mtDo({ action: 'mentor-withdraw', as: 'pupil' }, 'You stepped out'); };
    } else {
        const can = d.canMentor || { ok: false, reasons: [] };
        el.innerHTML = `<h3 style="margin-top:0;">🎓 Join the mentoring</h3>
            <p style="color:var(--muted);font-size:12px;margin:0 0 10px;">Tick your usual online hours above first: they decide who is suggested to you.</p>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;">
                <div class="stat"><div class="k">I want a mentor</div>
                    <input type="text" id="mt-note-pupil" maxlength="200" placeholder="What do you want help with? (optional)" style="margin:6px 0;">
                    <button class="small" id="mt-join-pupil">Sign up for a mentor</button></div>
                <div class="stat"><div class="k">I want to be a mentor</div>
                    ${can.ok ? `<label style="font-size:13px;display:block;margin:6px 0;">Pupils I can take <select id="mt-cap" style="width:auto;">${[1, 2, 3].map(n => `<option value="${n}">${n}</option>`).join('')}</select></label>
                    <input type="text" id="mt-note-mentor" maxlength="200" placeholder="A line about yourself (optional)" style="margin-bottom:6px;">
                    <button class="small" id="mt-join-mentor">Sign up as a mentor</button>`
                    : `<p style="font-size:12px;color:var(--muted);margin:6px 0 0;">${can.reasons.map(esc).join('<br>') || 'Not available yet.'}</p>`}</div>
            </div>`;
        $('mt-join-pupil').onclick = () => mtDo({ action: 'mentor-apply', as: 'pupil', note: $('mt-note-pupil').value }, 'You are signed up. Pick a mentor below.');
        if (can.ok) $('mt-join-mentor').onclick = () => mtDo({ action: 'mentor-apply', as: 'mentor', capacity: $('mt-cap').value, note: $('mt-note-mentor').value }, 'You are signed up as a mentor.');
    }
    if (!d.signupOpen && isLeaderView) el.insertAdjacentHTML('afterbegin', '<div style="font-size:12px;color:var(--reagent);margin-bottom:6px;">Sign-up is closed for members. You can test it as a leader. Open it on the Mentoring admin page.</div>');
}

function renderMtRequests() {
    const el = $('mt-requests'), rq = mtData.requests || { incoming: [], outgoing: [] };
    if (!rq.incoming.length && !rq.outgoing.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'block';
    const roleWord = role => role === 'pupil' ? 'to be their mentor' : 'to be their pupil'; // what the asker wants from the one who is asked
    el.innerHTML = `${rq.incoming.length ? `<h3 style="margin-top:0;color:var(--reagent);">🔔 ${rq.incoming.length} ask${rq.incoming.length === 1 ? '' : 's'} waiting for your answer</h3>
        ${rq.incoming.map(q => `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 10px;margin-bottom:6px;border:1px solid var(--reagent);border-radius:var(--radius);">
            <span style="flex:1;min-width:200px;"><b>${esc(q.from.name)}</b> asks you ${roleWord(q.from.role)}.</span>
            <button class="small mt-accept" data-m="${esc(q.mentorId)}" data-p="${esc(q.pupilId)}">Accept</button>
            <button class="ghost small mt-decline" data-m="${esc(q.mentorId)}" data-p="${esc(q.pupilId)}">Decline</button></div>`).join('')}` : ''}
        ${rq.outgoing.length ? `<h3 style="${rq.incoming.length ? '' : 'margin-top:0;'}">Your open asks</h3>
        ${rq.outgoing.map(q => `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--line);">
            <span style="flex:1;font-size:13px;">You asked <b>${esc(q.to.name)}</b> ${q.to.role === 'mentor' ? 'to be your mentor' : 'to be your pupil'}. Waiting for an answer.</span>
            <button class="ghost small mt-cancel" data-m="${esc(q.mentorId)}" data-p="${esc(q.pupilId)}">Take back</button></div>`).join('')}` : ''}`;
    el.querySelectorAll('.mt-accept').forEach(b => b.onclick = () => mtDo({ action: 'mentor-respond', mentorId: b.dataset.m, pupilId: b.dataset.p, accept: true }, 'Accepted. You are paired!'));
    el.querySelectorAll('.mt-decline').forEach(b => b.onclick = () => mtDo({ action: 'mentor-respond', mentorId: b.dataset.m, pupilId: b.dataset.p, accept: false }, 'Declined'));
    el.querySelectorAll('.mt-cancel').forEach(b => b.onclick = () => mtDo({ action: 'mentor-cancel', mentorId: b.dataset.m, pupilId: b.dataset.p }, 'Taken back'));
    if (rq.incoming.length && !window.__mtToasted) { window.__mtToasted = true; toast(`🔔 You have ${rq.incoming.length} mentoring ask${rq.incoming.length === 1 ? '' : 's'} waiting for your answer`); }
}

async function loadMtCandidates() {
    const el = $('mt-cands'), d = mtData;
    if (!d.signupOpen && d.allPairs === undefined) { el.style.display = 'none'; return; }
    const open = (d.myMentor && !d.myMentor.mentorId) || (d.isMentor && d.myMentorProfile && d.myMentorProfile.free > 0);
    if (!open) { el.style.display = 'none'; el.innerHTML = ''; return; }
    const r = await mtFetch({ action: 'mentor-candidates' });
    if (r.error || !r.as) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    const strip = c => `<span title="Green: you are both usually online. Dim: only ${esc(c.name)}." style="display:inline-flex;gap:1px;">${Array.from({ length: 24 }, (_, h) => { const mine = (r.myHours || []).includes(h), theirs = (c.hours || []).includes(h); return `<i style="width:7px;height:12px;border-radius:2px;background:${mine && theirs ? 'var(--reagent)' : theirs ? 'rgba(160,170,190,.45)' : 'var(--bench-2)'};"></i>`; }).join('')}</span>`;
    el.innerHTML = `<h3 style="margin-top:0;">${r.as === 'pupil' ? 'Mentors you can ask' : 'Pupils waiting for a mentor'}</h3>
        <p style="color:var(--muted);font-size:12px;margin:0 0 8px;">${r.myHours ? 'Sorted by the hours you are both usually online (TCT).' : 'Set your usual online hours above to see who is online at the same time as you.'}</p>
        ${r.candidates.length ? r.candidates.map(c => `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--line);">
            <span style="flex:1;min-width:180px;"><b>${esc(c.name)}</b>${c.free ? ` <span style="color:var(--muted);font-size:12px;">· ${c.free} place${c.free === 1 ? '' : 's'} free</span>` : ''}${c.note ? `<div style="color:var(--muted);font-size:12px;">“${esc(c.note)}”</div>` : ''}</span>
            <span style="font-size:12px;color:var(--muted);">${c.overlap == null ? (c.hours ? 'set your hours' : 'no hours set') : `${c.overlap} shared hour${c.overlap === 1 ? '' : 's'}`}</span>
            ${strip(c)}
            ${c.askedMe ? '<span style="font-size:12px;color:var(--reagent);">asked you: see above</span>' : c.asked ? '<span style="font-size:12px;color:var(--muted);">asked ✓</span>' : `<button class="small mt-ask" data-id="${esc(c.id)}">Ask</button>`}</div>`).join('')
        : '<p style="color:var(--muted);font-size:13px;margin:0;">Nobody is available right now. Check back later.</p>'}`;
    el.querySelectorAll('.mt-ask').forEach(b => b.onclick = () => mtDo({ action: 'mentor-request', targetId: b.dataset.id }, 'Asked. They have to accept.'));
}
