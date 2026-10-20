// api/feedback-form.js — WorldWideLabs feedback form.
// Two ways for a leader to run one: a form built right into WWL (own styling, own charts — no Google
// account needed at all), or a Google Form link (the older way, still supported so nothing already set
// up on it breaks). The key is ALWAYS sent in the POST body, never a URL query string — a GET with
// ?key=... would put the key straight into Vercel's own request-path logs in plaintext.
// Multi-faction: resolves the caller's own faction ID (and identity) from their key (never from the
// client), so each faction gets its own form/answers and one faction's leader can never touch another's.
//
// POST { key, action:'read' }              -> the caller's faction's current form, my own answers (native)
//                                              and the public results (native, questions marked so)
// POST { key, action:'submit', answers }   -> any member: save/replace MY OWN answers to a native form
// POST { key, mode:'native'|'google', ... }-> leaders only: replace THEIR faction's form (clears old answers)
// POST { key, action:'clear' }             -> leaders only: remove THEIR faction's form and its answers
// POST { key, action:'close' | 'reopen' }  -> leaders only: stop (or allow again) new answers; the form and every answer stay
// POST { key, action:'responses' }         -> leaders only: every answer, named, plus full counts

const { tornFetch } = require('../lib/tornFetch');
const { factionAllowed, DENIED: ACCESS_DENIED } = require('../lib/access');
const REDIS_URL = require('../lib/env').redisUrl();
const REDIS_TOKEN = require('../lib/env').redisToken();

async function redis(command) {
    const res = await fetch(REDIS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.result;
}

async function getProfile(key) {
    const r = await tornFetch(`https://api.torn.com/user/?selections=profile&key=${encodeURIComponent(key)}`);
    const profile = await r.json();
    if (profile.error || !profile.faction?.faction_id) return null;
    return { factionId: String(profile.faction.faction_id), playerId: String(profile.player_id), name: profile.name || '' };
}

async function isLeader(key) {
    const r = await tornFetch(`https://api.torn.com/v2/faction/balance?key=${encodeURIComponent(key)}`,
        { headers: { accept: 'application/json' } });
    const d = await r.json();
    return !d.error;
}

const formKey = (factionId) => `wwl:feedback-form:${factionId}`;
const responsesKey = (factionId) => `wwl:feedback-responses:${factionId}`;
const QTYPES = ['text', 'paragraph', 'choice', 'checkbox', 'list'];
const OTHER_KEY = '__other__'; // the bucket an "Other: ___" answer is counted under — never a real option's own text

// A member's "Other" answer is stored as { other: 'their typed text' } instead of a plain string, so it can
// never be confused with a real, defined option (even one a leader happens to have literally called "Other").
const isOther = v => v !== null && typeof v === 'object' && typeof v.other === 'string';

// A leader's raw question list, turned into something safe to store and safe to trust later: every field is
// re-typed and length-capped here — nothing from the request body is stored as-is.
function sanitizeQuestions(input) {
    const list = (Array.isArray(input) ? input : []).slice(0, 12).map((q, i) => {
        const type = QTYPES.includes(q?.type) ? q.type : 'text';
        const text = String(q?.text || '').trim().slice(0, 200);
        const needsOptions = type === 'choice' || type === 'checkbox';
        const options = needsOptions
            ? [...new Set((Array.isArray(q.options) ? q.options : []).map(o => String(o || '').trim().slice(0, 120)).filter(Boolean))].slice(0, 8)
            : [];
        return {
            id: /^q[a-z0-9]{6,20}$/.test(q?.id) ? q.id : `q${Date.now().toString(36)}${i}${Math.random().toString(36).slice(2, 4)}`,
            type, text, options,
            required: !!q?.required,
            publicResults: needsOptions ? !!q?.publicResults : false, // only a choice/checkbox question can have a public chart
            allowOther: needsOptions ? !!q?.allowOther : false, // an extra "Other: ___" choice, with a line to fill in
        };
    }).filter(q => q.text && (!(q.type === 'choice' || q.type === 'checkbox') || q.options.length >= 2));
    return list;
}

// A member's submitted answers, checked against the REAL question list (never trusting the shape the client sent) —
// a text answer that isn't one of the options (and isn't a valid "Other"), or an answer to a question that
// doesn't exist, is simply dropped.
function sanitizeAnswers(questions, input) {
    const answers = {};
    const missing = [];
    const other = raw => { const t = raw?.other; return typeof t === 'string' ? t.trim().slice(0, 100) : ''; };
    for (const q of questions) {
        const raw = input?.[q.id];
        if (q.type === 'text' || q.type === 'paragraph') {
            const v = String(raw ?? '').trim().slice(0, q.type === 'paragraph' ? 1500 : 200);
            if (v) answers[q.id] = v; else if (q.required) missing.push(q.text);
        } else if (q.type === 'list') { // several short items, freely typed — e.g. "a few things you'd change"
            const v = (Array.isArray(raw) ? raw : []).map(s => String(s || '').trim().slice(0, 100)).filter(Boolean).slice(0, 10);
            if (v.length) answers[q.id] = v; else if (q.required) missing.push(q.text);
        } else if (q.type === 'choice') {
            let v = null;
            if (q.options.includes(raw)) v = raw;
            else if (q.allowOther) { const t = other(raw); if (t) v = { other: t }; }
            if (v) answers[q.id] = v; else if (q.required) missing.push(q.text);
        } else if (q.type === 'checkbox') {
            const arr = Array.isArray(raw) ? raw : [];
            const picked = [...new Set(arr.filter(o => typeof o === 'string' && q.options.includes(o)))];
            if (q.allowOther) { const item = arr.find(isOther); const t = other(item); if (t) picked.push({ other: t }); }
            if (picked.length) answers[q.id] = picked; else if (q.required) missing.push(q.text);
        }
    }
    if (missing.length) throw new Error(`Please answer: ${missing.join(', ')}`);
    return answers;
}

// Counts for every choice/checkbox question, from every stored answer — used for the public results (public
// questions only) and the leader's full results view (every question). Every "Other" answer counts as one
// shared slice/bar (never each different typed text of its own — that could be almost anything and would
// never fold into a readable chart); the raw text people actually typed still shows in the leader's Responses.
function tally(questions, entries) {
    const counts = {};
    for (const q of questions) if (q.type === 'choice' || q.type === 'checkbox') {
        counts[q.id] = Object.fromEntries(q.options.map(o => [o, 0]));
        if (q.allowOther) counts[q.id][OTHER_KEY] = 0;
    }
    let total = 0;
    for (const e of Object.values(entries)) {
        if (!e.answers || !Object.keys(e.answers).length) continue;
        total++;
        for (const q of questions) {
            const v = e.answers[q.id];
            if (q.type === 'choice' && counts[q.id]) {
                if (typeof v === 'string') counts[q.id][v] = (counts[q.id][v] || 0) + 1;
                else if (isOther(v)) counts[q.id][OTHER_KEY]++;
            }
            if (q.type === 'checkbox' && Array.isArray(v) && counts[q.id]) v.forEach(o => {
                if (typeof o === 'string' && o in counts[q.id]) counts[q.id][o]++;
                else if (isOther(o)) counts[q.id][OTHER_KEY]++;
            });
        }
    }
    return { counts, total };
}

// Leader-only, for 'list' questions: how often each distinct item comes up (case/space-insensitive), so a
// pile of short free-typed answers is still skimmable instead of just a wall of rows. Not shown to members —
// open text never feeds a public chart, same rule as the paragraph/short-answer types.
function listFrequency(questions, rows) {
    const out = {};
    for (const q of questions) {
        if (q.type !== 'list') continue;
        const seen = new Map(); // lowercased -> { label: first-seen casing, n }
        for (const row of rows) for (const item of (Array.isArray(row.answers[q.id]) ? row.answers[q.id] : [])) {
            const k = String(item).trim().toLowerCase();
            if (!k) continue;
            const e = seen.get(k) || { label: item, n: 0 };
            e.n++; seen.set(k, e);
        }
        out[q.id] = [...seen.values()].filter(e => e.n > 1).sort((a, b) => b.n - a.n).slice(0, 15);
    }
    return out;
}

module.exports = async function handler(req, res) {
    try {
        if (require('../lib/env').blockUntilTestDb(req, res)) return; // a test site without its own test database stays closed (lib/env.js)
        if (!REDIS_URL || !REDIS_TOKEN) {
            return res.status(500).json({ error: 'Database not connected. In Vercel: Storage -> Create Database -> Upstash Redis, and connect it to this project.' });
        }

        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

        const { key, action } = req.body || {};
        if (!key) return res.status(400).json({ error: 'Missing key' });

        const profile = await getProfile(key);
        if (!profile) return res.status(403).json({ error: 'Could not determine your faction from this key' });
        const { factionId, playerId, name } = profile;
        if (!(await factionAllowed(factionId, playerId))) return res.status(403).json(ACCESS_DENIED); // only factions on the owner's list may use WWL

        if (action === 'read') {
            const raw = await redis(['GET', formKey(factionId)]);
            const form = raw ? JSON.parse(raw) : null;
            const result = { form };
            if (form?.mode === 'native') {
                const flat = (await redis(['HGETALL', responsesKey(factionId)])) || [];
                const entries = {};
                for (let i = 0; i < flat.length; i += 2) { try { entries[flat[i]] = JSON.parse(flat[i + 1]); } catch (e) { /* skip */ } }
                result.mine = entries[playerId]?.answers || null;
                const { counts, total } = tally(form.questions, entries);
                result.results = { total, counts: Object.fromEntries(form.questions.filter(q => q.publicResults).map(q => [q.id, counts[q.id]])) };
            }
            return res.status(200).json(result);
        }

        if (action === 'submit') {
            const raw = await redis(['GET', formKey(factionId)]);
            const form = raw ? JSON.parse(raw) : null;
            if (!form || form.mode !== 'native') return res.status(400).json({ error: 'There is no form open right now.' });
            if (form.closed) return res.status(400).json({ error: 'This form is closed, thank you for your feedback.' });
            const answers = sanitizeAnswers(form.questions, req.body.answers);
            await redis(['HSET', responsesKey(factionId), playerId, JSON.stringify({ name, answers, submittedAt: Date.now() })]);
            return res.status(200).json({ ok: true });
        }

        if (!(await isLeader(key))) return res.status(403).json({ error: 'Leaders only' });

        if (action === 'clear') {
            await redis(['DEL', formKey(factionId)]);
            await redis(['DEL', responsesKey(factionId)]);
            return res.status(200).json({ ok: true });
        }

        // Closing a form keeps the form and every answer but nobody can fill it in any more (and it stops asking people in the to do lists); reopening puts it back as it was.
        if (action === 'close' || action === 'reopen') {
            const raw = await redis(['GET', formKey(factionId)]);
            const form = raw ? JSON.parse(raw) : null;
            if (!form) return res.status(400).json({ error: 'There is no form to close.' });
            if (action === 'close') { form.closed = true; form.closedAt = Date.now(); } else { delete form.closed; delete form.closedAt; }
            await redis(['SET', formKey(factionId), JSON.stringify(form)]);
            return res.status(200).json({ ok: true, closed: !!form.closed });
        }

        if (action === 'responses') {
            const raw = await redis(['GET', formKey(factionId)]);
            const form = raw ? JSON.parse(raw) : null;
            if (!form || form.mode !== 'native') return res.status(400).json({ error: 'There is no native form to show responses for.' });
            const flat = (await redis(['HGETALL', responsesKey(factionId)])) || [];
            const rows = [];
            for (let i = 0; i < flat.length; i += 2) { try { const e = JSON.parse(flat[i + 1]); rows.push({ id: flat[i], name: e.name, answers: e.answers || {}, submittedAt: e.submittedAt || 0 }); } catch (e2) { /* skip */ } }
            rows.sort((a, b) => b.submittedAt - a.submittedAt);
            const entries = Object.fromEntries(rows.map(r => [r.id, { answers: r.answers }]));
            const { counts, total } = tally(form.questions, entries);
            return res.status(200).json({ form, rows, counts, total, listFreq: listFrequency(form.questions, rows) });
        }

        // Saving a form (either kind) replaces whatever was there and starts its answers fresh — an old
        // form's responses would no longer line up with a different set of questions anyway.
        const { mode } = req.body;
        if (mode === 'google') {
            const { title, formUrl, chartUrl } = req.body;
            const extractEmbedUrl = input => { const m = String(input || '').match(/src=["']([^"']+)["']/i); const u = m ? m[1] : String(input || '').trim(); return /^https:\/\//i.test(u) ? u : null; };
            const cleanForm = extractEmbedUrl(formUrl);
            if (!cleanForm) return res.status(400).json({ error: 'That doesn\'t look like a valid embed URL — paste the link Google gives you (or the whole <iframe> snippet), starting with https://' });
            const form = { mode: 'google', title: String(title || 'Faction feedback').trim().slice(0, 80) || 'Faction feedback', formUrl: cleanForm, chartUrl: chartUrl ? extractEmbedUrl(chartUrl) : null, updatedAt: Date.now() };
            await redis(['SET', formKey(factionId), JSON.stringify(form)]);
            await redis(['DEL', responsesKey(factionId)]);
            return res.status(200).json({ ok: true, form });
        }
        if (mode === 'native') {
            const questions = sanitizeQuestions(req.body.questions);
            if (!questions.length) return res.status(400).json({ error: 'Add at least one question first.' });
            const form = { mode: 'native', title: String(req.body.title || 'Faction feedback').trim().slice(0, 80) || 'Faction feedback',
                description: String(req.body.description || '').trim().slice(0, 400), questions, updatedAt: Date.now() };
            await redis(['SET', formKey(factionId), JSON.stringify(form)]);
            await redis(['DEL', responsesKey(factionId)]);
            return res.status(200).json({ ok: true, form });
        }
        return res.status(400).json({ error: 'Unknown action' });
    } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
    }
};
