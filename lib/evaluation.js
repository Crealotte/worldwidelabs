// lib/evaluation.js — the monthly member evaluation's memory: who was told what, and when (a warning, a final
// chance, an excuse, ...), so each month's check-in can see the history. Routed from api/war-payout.js ('ev-*'
// actions, behind the same leader gate as the 'mo-*' ones). The numbers themselves (war rule, energy trained) are
// not stored here — the page works them out live from Member Overview's own data.
//
// One hash per faction: member name (lower case) -> JSON array of log entries
//   { id, date: 'YYYY-MM-DD', kind, verdict, note, source: 'import' | 'manual' }
// It is keyed by NAME rather than player id because an imported earlier report only has names; a member who is
// gone (kicked) keeps their history, so a returning member's past warning is still visible.

const logKey = (f) => `wwl:eval-log:${f}`;
const sentKey = (f) => `wwl:eval-sent:${f}`;
const repliedKey = (f) => `wwl:eval-replied:${f}`; // field "<period start>:<member id>" -> { at, by, stacking }: they answered the evaluation message, and/or told they are stacking
const KINDS = ['keep', 'probation', 'warning', 'remove', 'excused', 'told', 'note', 'other'];

const nameKey = (n) => String(n || '').trim().toLowerCase();
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function kindOfVerdict(verdict) {
    const v = String(verdict || '').toUpperCase();
    if (v.startsWith('REMOVE')) return 'remove';
    if (v.startsWith('WARNING')) return 'warning';
    if (v.includes('PROBATION')) return 'probation';
    if (v.includes('EXCUSED') || v.includes('SPARED')) return 'excused';
    if (v.startsWith('KEEP')) return 'keep';
    return 'other';
}

// Reads a pasted evaluation report in the format used for the September 6th one:
//   Name
//   * Current War: ...
//   * Status & Behavior: <sentence>
//   * Past Performance: ...
//   Verdict: KEEP — Core asset.
// Each "Verdict:" line closes one member; the name is the line right above that member's "Current War:" line.
// A member listed twice (a correction further down) keeps the LAST verdict.
function parseReport(text) {
    const lines = String(text || '').split(/\r?\n/).map(l => l.trim());
    const out = new Map();
    let name = null, note = '';
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (/^[*\-•]?\s*Current War\s*:/i.test(l)) {
            let j = i - 1;
            while (j >= 0 && !lines[j]) j--;
            name = j >= 0 ? lines[j].replace(/^[#*\-•\s]+/, '').replace(/[*\s]+$/, '') : null;
            note = '';
            continue;
        }
        const st = /^[*\-•]?\s*Status\s*&\s*Behaviou?r\s*:\s*(.*)$/i.exec(l);
        if (st) { note = st[1].trim(); continue; }
        const vd = /^Verdict\s*:\s*(.+)$/i.exec(l);
        if (vd && name) {
            const verdict = vd[1].trim();
            out.set(nameKey(name), { name, verdict, kind: kindOfVerdict(verdict), note: note.slice(0, 400) });
            name = null; note = '';
        }
    }
    return [...out.values()];
}

async function hgetall(redis, key) {
    const flat = (await redis(['HGETALL', key])) || [];
    const o = {};
    for (let i = 0; i < flat.length; i += 2) { try { o[flat[i]] = JSON.parse(flat[i + 1]); } catch (e) { /* skip a broken entry */ } }
    return o;
}

async function evHandle(action, body, { redis, factionId, name }) {
    if (action === 'ev-log-get') return { log: await hgetall(redis, logKey(factionId)) };

    if (action === 'ev-import') {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : null;
        if (!date) throw new Error('Pick the date of that report first.');
        const text = String(body.text || '');
        if (text.length < 20) throw new Error('Paste the report first.');
        if (text.length > 400000) throw new Error('That is a lot of text — paste fewer members at a time.');
        const entries = parseReport(text);
        if (!entries.length) throw new Error('Found no members with a "Verdict:" line in that text.');
        const log = await hgetall(redis, logKey(factionId));
        for (const e of entries) {
            const k = nameKey(e.name);
            // importing the same report again replaces its own entries instead of stacking duplicates
            const list = (log[k] || []).filter(x => !(x.source === 'import' && x.date === date));
            list.push({ id: newId(), date, kind: e.kind, verdict: e.verdict, note: e.note, source: 'import' });
            await redis(['HSET', logKey(factionId), k, JSON.stringify(list)]);
        }
        const counts = {};
        for (const e of entries) counts[e.kind] = (counts[e.kind] || 0) + 1;
        return { ok: true, imported: entries.length, counts };
    }

    if (action === 'ev-log-add') {
        const k = nameKey(body.name);
        if (!k) throw new Error('Missing member');
        const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : new Date().toISOString().slice(0, 10);
        const kind = KINDS.includes(body.kind) ? body.kind : 'note';
        const note = String(body.note || '').trim().slice(0, 1000);
        const verdict = String(body.verdict || '').trim().slice(0, 120);
        if (!note && !verdict && kind === 'note') throw new Error('Write something to log.');
        const raw = await redis(['HGET', logKey(factionId), k]);
        const list = raw ? JSON.parse(raw) : [];
        list.push({ id: newId(), date, kind, verdict, note, source: 'manual' });
        await redis(['HSET', logKey(factionId), k, JSON.stringify(list)]);
        return { ok: true, entries: list };
    }

    if (action === 'ev-log-delete') {
        const k = nameKey(body.name);
        const raw = await redis(['HGET', logKey(factionId), k]);
        if (!raw) return { ok: true, entries: [] };
        const list = JSON.parse(raw).filter(x => x.id !== body.id);
        if (list.length) await redis(['HSET', logKey(factionId), k, JSON.stringify(list)]);
        else await redis(['HDEL', logKey(factionId), k]);
        return { ok: true, entries: list };
    }

    // Who has been sent this period's evaluation message: one hash per faction, field "<period start>:<member id>" -> { at, by }.
    // Shared by every leader, so two people do not message the same member twice.
    if (action === 'ev-sent-get') {
        const p = String(body.period || '').replace(/\D/g, '');
        if (!p) throw new Error('Missing period');
        const flat = (await redis(['HGETALL', sentKey(factionId)])) || [];
        const out = {};
        for (let i = 0; i < flat.length; i += 2) {
            if (!flat[i].startsWith(`${p}:`)) continue;
            try { out[flat[i].slice(p.length + 1)] = JSON.parse(flat[i + 1]); } catch (e) { /* skip */ }
        }
        // who answered the message of this period, and who said they are stacking (their reply is noted by hand)
        const rflat = (await redis(['HGETALL', repliedKey(factionId)])) || [], replied = {};
        for (let i = 0; i < rflat.length; i += 2) {
            if (!rflat[i].startsWith(`${p}:`)) continue;
            try { replied[rflat[i].slice(p.length + 1)] = JSON.parse(rflat[i + 1]); } catch (e) { /* skip */ }
        }
        return { sent: out, replied };
    }
    if (action === 'ev-sent-set') {
        const p = String(body.period || '').replace(/\D/g, ''), id = String(body.id || '').replace(/\D/g, '');
        if (!p || !id) throw new Error('Missing period or member');
        if (body.sent) await redis(['HSET', sentKey(factionId), `${p}:${id}`, JSON.stringify({ at: Date.now(), by: String(name || '') })]);
        else await redis(['HDEL', sentKey(factionId), `${p}:${id}`]);
        return { ok: true };
    }

    if (action === 'ev-reply-set') { // they replied and/or are stacking (both off = nothing kept)
        const p = String(body.period || '').replace(/\D/g, ''), id = String(body.id || '').replace(/\D/g, '');
        if (!p || !id) throw new Error('Missing period or member');
        const replied = !!body.replied, stacking = !!body.stacking;
        if (replied || stacking) await redis(['HSET', repliedKey(factionId), `${p}:${id}`, JSON.stringify({ replied, stacking, at: Date.now(), by: String(name || '') })]);
        else await redis(['HDEL', repliedKey(factionId), `${p}:${id}`]);
        return { ok: true };
    }
    throw new Error('Unknown action');
}

module.exports = { evHandle, parseReport };
