// lib/mentoring.js — the Mentoring Platform: a leader manually notes who wants to mentor (and how many pupils
// they can take), who wants a mentor, and pairs them up (there's no way to ask "who wants to mentor" from Torn
// itself, so this is entirely hand-run by a leader, like Known bugs or the perk roadmap). Once paired, a mentor
// and pupil share: a shared to-do checklist (the leader writes the list once; each pair ticks its own progress
// against it) and a private one-to-one chat. Both also show up in the Torn userscript (see wwl-energy-plan).
//
// One JSON document per faction holds the whole program (small scale — a faction's mentors and pupils, not a
// growing log), plus one hash for chat and one for per-pair checklist progress.

const programKey = f => `wwl:mentor-program:${f}`; // { mentors: {id:{name,capacity,note,addedAt}}, pupils: {id:{name,note,mentorId,addedAt}} }
const todosKey = f => `wwl:mentor-todos:${f}`; // [{ id, text, role: 'mentor'|'pupil'|'both' }] — the shared checklist template
const progressKey = f => `wwl:mentor-progress:${f}`; // hash: pairId -> [todoId, ...] done
const chatKey = (f, pairId) => `wwl:mentor-chat:${f}:${pairId}`; // list, newest last, capped
const CHAT_MAX = 200;
const pairId = (mentorId, pupilId) => `${mentorId}:${pupilId}`;

async function loadProgram(redis, factionId) {
    const raw = await redis(['GET', programKey(factionId)]);
    const program = raw ? JSON.parse(raw) : { mentors: {}, pupils: {} };
    if (!program.requests || typeof program.requests !== 'object') program.requests = {}; // open asks: key "mentorId:pupilId" -> { mentorId, pupilId, by: 'mentor' or 'pupil', byName, at }
    return program;
}
async function saveProgram(redis, factionId, program) {
    await redis(['SET', programKey(factionId), JSON.stringify(program)]);
}
async function loadTodos(redis, factionId) {
    const raw = await redis(['GET', todosKey(factionId)]);
    try { const list = raw ? JSON.parse(raw) : []; return Array.isArray(list) ? list : []; } catch (e) { return []; }
}

// Every pair a member is in — as a mentor (one entry per pupil) and/or as a pupil (at most one, their own mentor).
function pairsFor(program, playerId) {
    const id = String(playerId);
    const mentorOf = Object.entries(program.pupils || {})
        .filter(([, p]) => String(p.mentorId) === id)
        .map(([pupilId, p]) => ({ pairId: pairId(id, pupilId), role: 'mentor', otherId: pupilId, otherName: p.name }));
    const p = program.pupils?.[id];
    const pupilOf = p?.mentorId ? [{ pairId: pairId(String(p.mentorId), id), role: 'pupil', otherId: String(p.mentorId), otherName: program.mentors?.[p.mentorId]?.name || `#${p.mentorId}` }] : [];
    return [...mentorOf, ...pupilOf];
}

// A pair only exists if it is a REAL, currently-assigned pairing — checked fresh against the program every time,
// so someone removed or reassigned instantly loses access to that pair's chat and checklist.
function isRealPair(program, mentorId, pupilId) {
    return String(program.pupils?.[pupilId]?.mentorId) === String(mentorId);
}
function myRoleInPair(program, playerId, mentorId, pupilId) {
    const id = String(playerId);
    if (!isRealPair(program, mentorId, pupilId)) return null;
    if (id === String(mentorId)) return 'mentor';
    if (id === String(pupilId)) return 'pupil';
    return null;
}

// ---- self service: members apply, see who fits by online hours, and ask each other; the other person has to accept ----
const hoursKey = f => `wwl:online-hours:${f}`; // lib/onlineHours.js
const MAX_OPEN_ASKS = 3;                        // how many open asks one person can have out at the same time
const reqKey = (mentorId, pupilId) => `${mentorId}:${pupilId}`;
const pupilsOfMentor = (program, mentorId) => Object.values(program.pupils || {}).filter(p => String(p.mentorId) === String(mentorId)).length;
const freeSlots = (program, mentorId) => Math.max(0, (program.mentors?.[mentorId]?.capacity || 0) - pupilsOfMentor(program, mentorId));
// Lab Rat and up: Lab Rat, Chemist, Junior / Senior Researcher, and anything not on the role ladder that a leader holds (checked by the caller). Guinea Pig, Experiments and Recruits cannot mentor yet.
function mentorRoleOk(position) {
    const p = String(position || '').toLowerCase();
    if (p.includes('senior researcher') || p.includes('junior researcher') || p.includes('chemist') || p.includes('lab rat')) return true;
    if (p.includes('guinea') || p.includes('experiment') || p.includes('recruit')) return false;
    return null; // not on the ladder: a leader or council position decides
}
// Who may mentor: Lab Rat or higher, and in the faction for at least one full newsletter cycle (the length of the last finished one), so they know the ropes.
async function mentorEligibility(me, cycleDays, leaderLazy) {
    const reasons = [];
    let roleOk = mentorRoleOk(me && me.position);
    if (roleOk === null) roleOk = await leaderLazy();
    if (!roleOk) reasons.push(`You need to be a Lab Rat or higher to mentor (your role: ${(me && me.position) || 'unknown'}).`);
    const days = me ? me.days : null;
    if (days == null) reasons.push('Torn did not say how long you are in the faction.');
    else if (days < cycleDays) reasons.push(`You need to be in the faction for one full newsletter cycle (${cycleDays} days) to mentor, you are at ${days}.`);
    return { ok: reasons.length === 0, reasons, cycleDays };
}
// the asks that involve a person are dropped when they get paired, leave, or are removed
function dropRequests(program, { mentorId, pupilId }) {
    for (const [k, r] of Object.entries(program.requests || {})) {
        if ((pupilId != null && String(r.pupilId) === String(pupilId)) || (mentorId != null && String(r.mentorId) === String(mentorId))) delete program.requests[k];
    }
}
const hoursOverlap = (a, b) => (a && b) ? a.filter(h => b.includes(h)).length : null;
// Self sign-up is open by default; a leader can close it (Mentoring admin), then only leaders can use it, to test it. Members can always answer asks they already have.
async function needOpen(program, leaderLazy) {
    if (program.open !== false) return;   // open unless a leader closed it
    if (await leaderLazy()) return;
    throw new Error('Mentor sign-up is closed at the moment.');
}

// `leaderLazy` is a function, not a plain boolean — it only actually calls Torn (isLeader) the moment something
// calls it, and only once (memoized by the caller). That way an ordinary mentor/pupil polling their own chat
// every few seconds never costs an extra Torn call: they're already found to belong to the pair, so the lazy
// check is never even reached.
async function mentoringHandle(action, body, { redis, playerId, name, leaderLazy, factionId, me, cycleDays }) {
    // ---- everyone: my own status, the shared checklist, and (per pair) my progress ----
    if (action === 'mentor-my-status') {
        const [program, todos] = await Promise.all([loadProgram(redis, factionId), loadTodos(redis, factionId)]);
        const withDone = async list => {
            const flat = list.length ? await redis(['HMGET', progressKey(factionId), ...list.map(m => m.pairId)]) : [];
            return list.map((m, i) => { let done = []; try { done = JSON.parse(flat[i] || '[]'); } catch (e) { /* none yet */ } return { ...m, done }; });
        };
        const pairs = await withDone(pairsFor(program, playerId));
        const asMentor = program.mentors?.[String(playerId)] || null;
        const result = { isMentor: !!asMentor, isPupil: !!program.pupils?.[String(playerId)], capacity: asMentor?.capacity ?? null, pairs, todos };
        {   // the self service part: my application, whether I may mentor, and the asks waiting for me or sent by me
            const myId = String(playerId), nameOf = id => (program.mentors && program.mentors[id] && program.mentors[id].name) || (program.pupils && program.pupils[id] && program.pupils[id].name) || `#${id}`;
            result.myMentor = program.pupils && program.pupils[myId] ? { applied: true, mentorId: program.pupils[myId].mentorId || null, note: program.pupils[myId].note || '' } : null;
            result.myMentorProfile = asMentor ? { capacity: asMentor.capacity, free: freeSlots(program, myId), note: asMentor.note || '' } : null;
            result.canMentor = await mentorEligibility(me, cycleDays || 28, leaderLazy);
            result.signupOpen = program.open !== false;
            const asks = Object.values(program.requests || {});
            const recipient = r => r.by === 'pupil' ? String(r.mentorId) : String(r.pupilId);
            const asker = r => r.by === 'pupil' ? String(r.pupilId) : String(r.mentorId);
            const who = (id, role) => ({ id, name: nameOf(id), role });
            result.requests = {
                incoming: asks.filter(r => recipient(r) === myId).map(r => ({ mentorId: String(r.mentorId), pupilId: String(r.pupilId), at: r.at, from: who(asker(r), r.by) })),
                outgoing: asks.filter(r => asker(r) === myId).map(r => ({ mentorId: String(r.mentorId), pupilId: String(r.pupilId), at: r.at, to: who(recipient(r), r.by === 'pupil' ? 'mentor' : 'pupil') })),
            };
        }
        // A leader can look in on every pairing even if they are not signed up themselves — read-only: they see
        // the same checklist state and chat everyone else does, but ticking a box or sending a message stays
        // restricted to the two people actually in that pair (checked again below, not just hidden in the UI).
        if (await leaderLazy()) {
            const mine = new Set(pairs.map(p => p.pairId));
            const all = Object.entries(program.pupils || {})
                .filter(([, p]) => p.mentorId)
                .map(([pupilId, p]) => ({ pairId: pairId(String(p.mentorId), pupilId), mentorName: program.mentors?.[p.mentorId]?.name || `#${p.mentorId}`, pupilName: p.name || `#${pupilId}` }))
                .filter(p => !mine.has(p.pairId));
            result.allPairs = await withDone(all);
        }
        return result;
    }
    if (action === 'mentor-todo-toggle') {
        const { mentorId, pupilId, todoId, checked } = body;
        const program = await loadProgram(redis, factionId);
        if (!myRoleInPair(program, playerId, mentorId, pupilId)) throw new Error('You are not part of that pair.');
        const pid = pairId(String(mentorId), String(pupilId));
        const raw = await redis(['HGET', progressKey(factionId), pid]);
        let done = []; try { done = JSON.parse(raw || '[]'); } catch (e) { /* fresh */ }
        done = checked ? [...new Set([...done, String(todoId)])] : done.filter(t => t !== String(todoId));
        await redis(['HSET', progressKey(factionId), pid, JSON.stringify(done)]);
        return { ok: true };
    }
    if (action === 'mentor-chat-read') {
        const { mentorId, pupilId } = body;
        const program = await loadProgram(redis, factionId);
        // a leader can read any pair's chat for oversight, even one they are not part of — never write to it, though
        if (!myRoleInPair(program, playerId, mentorId, pupilId) && !(isRealPair(program, mentorId, pupilId) && await leaderLazy())) throw new Error('You are not part of that pair.');
        const flat = (await redis(['LRANGE', chatKey(factionId, pairId(String(mentorId), String(pupilId))), 0, -1])) || [];
        const messages = flat.map(s => { try { return JSON.parse(s); } catch (e) { return null; } }).filter(Boolean);
        return { messages };
    }
    if (action === 'mentor-chat-send') {
        const { mentorId, pupilId, text } = body;
        const clean = String(text || '').trim().slice(0, 500);
        if (!clean) throw new Error('Type a message first.');
        const program = await loadProgram(redis, factionId);
        const role = myRoleInPair(program, playerId, mentorId, pupilId);
        if (!role) throw new Error('You are not part of that pair.');
        const key = chatKey(factionId, pairId(String(mentorId), String(pupilId)));
        await redis(['RPUSH', key, JSON.stringify({ from: String(playerId), name, role, text: clean, at: Date.now() })]);
        await redis(['LTRIM', key, -CHAT_MAX, -1]);
        return { ok: true };
    }

    // ---- everyone: apply, withdraw, see who fits, ask, accept ----
    if (action === 'mentor-apply') {
        const program = await loadProgram(redis, factionId);
        await needOpen(program, leaderLazy);
        const myId = String(playerId), as = body.as;
        if (as === 'mentor') {
            if (program.pupils[myId]) throw new Error('You are signed up as a pupil. Step out of that first if you would rather mentor.');
            const el = await mentorEligibility(me, cycleDays || 28, leaderLazy);
            if (!el.ok) throw new Error(el.reasons.join(' '));
            const cap = Math.min(3, Math.max(1, Math.round(Number(body.capacity)) || 1));
            program.mentors[myId] = { name: name || (program.mentors[myId] && program.mentors[myId].name) || '', capacity: cap, note: String(body.note || '').slice(0, 200), addedAt: (program.mentors[myId] && program.mentors[myId].addedAt) || Date.now(), self: true };
        } else if (as === 'pupil') {
            if (program.mentors[myId]) throw new Error('You are signed up as a mentor. Step out of that first if you would rather have a mentor.');
            const old = program.pupils[myId] || {};
            program.pupils[myId] = { name: name || old.name || '', note: String(body.note || '').slice(0, 200), mentorId: old.mentorId || null, addedAt: old.addedAt || Date.now(), self: true };
        } else throw new Error('Choose: I want a mentor, or I want to be a mentor.');
        await saveProgram(redis, factionId, program);
        return { ok: true };
    }
    if (action === 'mentor-withdraw') {
        const program = await loadProgram(redis, factionId);
        const myId = String(playerId);
        if (body.as === 'mentor') {
            delete program.mentors[myId];
            for (const p of Object.values(program.pupils)) if (String(p.mentorId) === myId) p.mentorId = null; // their pupils go back to waiting for a mentor
            dropRequests(program, { mentorId: myId });
        } else if (body.as === 'pupil') {
            delete program.pupils[myId];
            dropRequests(program, { pupilId: myId });
        } else throw new Error('Unknown choice.');
        await saveProgram(redis, factionId, program);
        return { ok: true };
    }
    if (action === 'mentor-candidates') { // who I could ask: a pupil without a mentor sees the mentors with room, a mentor with room sees the pupils waiting, both sorted by shared online hours
        const program = await loadProgram(redis, factionId);
        await needOpen(program, leaderLazy);
        const myId = String(playerId);
        const asPupil = program.pupils[myId] && !program.pupils[myId].mentorId, asMentor = program.mentors[myId] && freeSlots(program, myId) > 0;
        let pool = [];
        if (asPupil) pool = Object.entries(program.mentors).filter(([id]) => id !== myId && freeSlots(program, id) > 0).map(([id, m]) => ({ id, name: m.name, note: m.note || '', free: freeSlots(program, id), role: 'mentor' }));
        else if (asMentor) pool = Object.entries(program.pupils).filter(([id, p]) => id !== myId && !p.mentorId).map(([id, p]) => ({ id, name: p.name, note: p.note || '', role: 'pupil' }));
        const ids = [myId, ...pool.map(c => c.id)];
        const flat = ids.length ? await redis(['HMGET', hoursKey(factionId), ...ids]) : [];
        const hoursOf = i => { try { return flat[i] ? JSON.parse(flat[i]).hours : null; } catch (e) { return null; } };
        const mine = hoursOf(0);
        pool.forEach((c, i) => {
            c.hours = hoursOf(i + 1);
            c.overlap = hoursOverlap(mine, c.hours);
            const r = program.requests[c.role === 'mentor' ? reqKey(c.id, myId) : reqKey(myId, c.id)];
            c.asked = !!r && r.by === (c.role === 'mentor' ? 'pupil' : 'mentor'); // I asked them already
            c.askedMe = !!r && !c.asked;                                          // they asked me (it waits under my requests)
        });
        pool.sort((a, b) => (b.overlap == null ? -1 : b.overlap) - (a.overlap == null ? -1 : a.overlap) || String(a.name).localeCompare(String(b.name)));
        return { as: asPupil ? 'pupil' : asMentor ? 'mentor' : null, myHours: mine, candidates: pool };
    }
    if (action === 'mentor-request') {
        const program = await loadProgram(redis, factionId);
        await needOpen(program, leaderLazy);
        const myId = String(playerId), target = String(body.targetId || '');
        const iAmPupil = program.pupils[myId] && !program.pupils[myId].mentorId && program.mentors[target];
        const iAmMentor = program.mentors[myId] && program.pupils[target] && !program.pupils[target].mentorId;
        if (!iAmPupil && !iAmMentor) throw new Error('That is not possible now: sign up first, and ask a mentor (as a pupil) or a pupil (as a mentor) who is still free.');
        const mentorId = iAmPupil ? target : myId, pupilId = iAmPupil ? myId : target;
        if (freeSlots(program, mentorId) < 1) throw new Error(`${program.mentors[mentorId].name || 'That mentor'} has no room for another pupil.`);
        const key = reqKey(mentorId, pupilId);
        if (program.requests[key]) throw new Error('There is already an open ask between the two of you.');
        const mine = Object.values(program.requests).filter(r => (r.by === 'pupil' ? String(r.pupilId) : String(r.mentorId)) === myId).length;
        if (mine >= MAX_OPEN_ASKS) throw new Error(`You have ${MAX_OPEN_ASKS} open asks already. Wait for an answer or take one back.`);
        program.requests[key] = { mentorId, pupilId, by: iAmPupil ? 'pupil' : 'mentor', byName: name || '', at: Date.now() };
        await saveProgram(redis, factionId, program);
        return { ok: true };
    }
    if (action === 'mentor-respond' || action === 'mentor-cancel') {
        const program = await loadProgram(redis, factionId);
        const myId = String(playerId), mentorId = String(body.mentorId), pupilId = String(body.pupilId);
        const key = reqKey(mentorId, pupilId), r = program.requests[key];
        if (!r) throw new Error('That ask is gone already.');
        const askerId = r.by === 'pupil' ? pupilId : mentorId, receiverId = r.by === 'pupil' ? mentorId : pupilId;
        if (action === 'mentor-cancel') {
            if (myId !== askerId) throw new Error('Only the person who asked can take it back.');
            delete program.requests[key];
        } else {
            if (myId !== receiverId) throw new Error('This ask is not for you.');
            if (body.accept) {
                const pupil = program.pupils[pupilId], mentor = program.mentors[mentorId];
                const gone = async msg => { delete program.requests[key]; await saveProgram(redis, factionId, program); throw new Error(msg); };
                if (!pupil || !mentor) await gone('One of you is not signed up any more.');
                if (pupil.mentorId) await gone('That pupil has a mentor already.');
                if (freeSlots(program, mentorId) < 1) await gone('That mentor has no room any more.');
                pupil.mentorId = mentorId;
                dropRequests(program, { pupilId });                                         // the pupil is taken: their other asks end
                if (freeSlots(program, mentorId) < 1) dropRequests(program, { mentorId });  // the mentor is full: asks to them end
            } else delete program.requests[key];
        }
        await saveProgram(redis, factionId, program);
        return { ok: true };
    }

    // ---- leaders only: run the program ----
    if (!(await leaderLazy())) throw new Error('Leaders only');

    if (action === 'mentor-open-set') { // leaders: open or close the self sign-up for members
        const program = await loadProgram(redis, factionId);
        program.open = !!body.open;
        await saveProgram(redis, factionId, program);
        return { ok: true, open: program.open };
    }
    if (action === 'mentor-program-get') {
        const [program, todos] = await Promise.all([loadProgram(redis, factionId), loadTodos(redis, factionId)]);
        return { program, todos };
    }
    if (action === 'mentor-add') {
        const id = String(body.id || '');
        if (!/^\d{1,10}$/.test(id)) throw new Error('That is not a player ID.');
        const program = await loadProgram(redis, factionId);
        const cap = Math.min(3, Math.max(1, Math.round(Number(body.capacity)) || 1));
        program.mentors[id] = { name: String(body.name || program.mentors[id]?.name || '').slice(0, 40), capacity: cap, note: String(body.note || '').slice(0, 200), addedAt: program.mentors[id]?.addedAt || Date.now() };
        await saveProgram(redis, factionId, program);
        return { ok: true, program };
    }
    if (action === 'mentor-set-capacity') {
        const program = await loadProgram(redis, factionId);
        const m = program.mentors[String(body.id)];
        if (!m) throw new Error('That mentor is not on the list.');
        m.capacity = Math.min(3, Math.max(0, Math.round(Number(body.capacity)) || 0)); // 0 = "not taking anyone right now" without removing them
        await saveProgram(redis, factionId, program);
        return { ok: true, program };
    }
    if (action === 'mentor-remove') {
        const id = String(body.id);
        const program = await loadProgram(redis, factionId);
        delete program.mentors[id];
        for (const p of Object.values(program.pupils)) if (String(p.mentorId) === id) p.mentorId = null; // their pupils go back to unassigned, not deleted
        dropRequests(program, { mentorId: id });
        await saveProgram(redis, factionId, program);
        return { ok: true, program };
    }
    if (action === 'pupil-add') {
        const id = String(body.id || '');
        if (!/^\d{1,10}$/.test(id)) throw new Error('That is not a player ID.');
        const program = await loadProgram(redis, factionId);
        program.pupils[id] = { name: String(body.name || program.pupils[id]?.name || '').slice(0, 40), note: String(body.note || '').slice(0, 200), mentorId: program.pupils[id]?.mentorId || null, addedAt: program.pupils[id]?.addedAt || Date.now() };
        await saveProgram(redis, factionId, program);
        return { ok: true, program };
    }
    if (action === 'pupil-remove') {
        const program = await loadProgram(redis, factionId);
        delete program.pupils[String(body.id)];
        dropRequests(program, { pupilId: String(body.id) });
        await saveProgram(redis, factionId, program);
        return { ok: true, program };
    }
    if (action === 'mentor-assign' || action === 'mentor-unassign') {
        const program = await loadProgram(redis, factionId);
        const pupilIdStr = String(body.pupilId);
        const pupil = program.pupils[pupilIdStr];
        if (!pupil) throw new Error('That pupil is not on the list.');
        if (action === 'mentor-unassign') { pupil.mentorId = null; }
        else {
            const mentorIdStr = String(body.mentorId);
            const mentor = program.mentors[mentorIdStr];
            if (!mentor) throw new Error('That mentor is not on the list.');
            const taken = Object.values(program.pupils).filter(p => String(p.mentorId) === mentorIdStr).length;
            if (taken >= mentor.capacity) throw new Error(`${mentor.name || 'That mentor'} already has as many pupils as they said they can take.`);
            pupil.mentorId = mentorIdStr;
            dropRequests(program, { pupilId: pupilIdStr });
        }
        await saveProgram(redis, factionId, program);
        return { ok: true, program };
    }
    if (action === 'mentor-todos-save') {
        const items = (Array.isArray(body.items) ? body.items : []).slice(0, 30).map((t, i) => ({
            id: /^t[a-z0-9]{4,20}$/.test(t?.id) ? t.id : `t${Date.now().toString(36)}${i}`,
            text: String(t?.text || '').trim().slice(0, 200),
            role: ['mentor', 'pupil', 'both'].includes(t?.role) ? t.role : 'both',
        })).filter(t => t.text);
        await redis(['SET', todosKey(factionId), JSON.stringify(items)]);
        return { ok: true, todos: items };
    }
    throw new Error('Unknown action');
}

module.exports = { mentoringHandle, loadProgram };
