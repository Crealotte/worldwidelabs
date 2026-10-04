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
    return raw ? JSON.parse(raw) : { mentors: {}, pupils: {} };
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

// `leaderLazy` is a function, not a plain boolean — it only actually calls Torn (isLeader) the moment something
// calls it, and only once (memoized by the caller). That way an ordinary mentor/pupil polling their own chat
// every few seconds never costs an extra Torn call: they're already found to belong to the pair, so the lazy
// check is never even reached.
async function mentoringHandle(action, body, { redis, playerId, name, leaderLazy, factionId }) {
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

    // ---- leaders only: run the program ----
    if (!(await leaderLazy())) throw new Error('Leaders only');

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
