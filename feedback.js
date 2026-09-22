// feedback.js — the public Feedback page and its leader-only editor.
// A leader can either build a form right into WWL (its own dark styling, its own results charts — no
// Google account needed), or link an outside Google Form as before (kept working for whoever already
// uses that). Backend: api/feedback-form.js.
'use strict';

const FB_TYPES = { text: 'Short answer', paragraph: 'Paragraph', choice: 'Multiple choice (pick one)', checkbox: 'Checkboxes (pick several)', list: 'Open answer — several short items' };
const FB_OTHER_KEY = '__other__'; // matches OTHER_KEY in api/feedback-form.js — the bucket an "Other: ___" answer is counted under
const isFbOther = v => v !== null && typeof v === 'object' && typeof v.other === 'string';
// The skill-validated categorical palette (dark-mode steps), assigned in this fixed order — never cycled or
// re-picked per chart, so the same option always reads as the same colour and adjacent slices stay tellable
// apart under colour-blindness. Past 7 real options the rest fold into one "Other" slice (shown in grey).
const FB_PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9', '#e66767'];
const FB_OTHER = '#5b6472';

async function fbFetch(body) {
    const res = await fetch('/api/feedback-form', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}

// ============================================================================================
// ===================================  PUBLIC PAGE  =========================================
// ============================================================================================

let fbData = null; // { form, mine, results } from the last load — kept so a submit can re-render without a full reload

async function loadFeedback() {
    try {
        const data = await fbFetch({ action: 'read' });
        fbData = data;
        const form = data?.form;
        $('fb-empty').style.display = form ? 'none' : 'block';
        $('fb-native').style.display = form?.mode === 'native' ? 'block' : 'none';
        $('fb-content').style.display = form?.mode === 'google' ? 'block' : 'none';
        if (!form) return;

        $('fb-title').textContent = form.title || 'Feedback';
        if (form.mode === 'google') {
            $('fb-form-frame').src = form.formUrl;
            if (form.chartUrl) { $('fb-chart-panel').style.display = 'block'; $('fb-chart-frame').src = form.chartUrl; }
            else $('fb-chart-panel').style.display = 'none';
        } else {
            renderFbNative(form, data.mine, data.results);
        }
    } catch (e) {
        $('fb-empty').style.display = 'block'; $('fb-native').style.display = 'none'; $('fb-content').style.display = 'none';
    }
}

// "Other" is a normal radio/checkbox (a fb-ans-other, sharing the same group) paired with a text box — checking
// the box is what makes it count, same as Google's; typing in the box checks it for you so nobody has to click both.
function fbOtherRow(q, kind, checked, text) {
    return `<label style="display:flex;gap:8px;align-items:center;padding:4px 0;cursor:pointer;">
        <input type="${kind}" style="width:auto;" ${kind === 'radio' ? `name="fbq_${esc(q.id)}"` : ''} class="fb-ans fb-ans-other" data-id="${esc(q.id)}" data-type="${q.type}" ${checked ? 'checked' : ''}>
        Other: <input type="text" class="fb-ans-other-text" data-id="${esc(q.id)}" value="${esc(text || '')}" maxlength="100" placeholder="type your own" style="flex:1;max-width:260px;">
    </label>`;
}
function fbAnswerInput(q, mine) {
    const v = mine?.[q.id];
    if (q.type === 'text') return `<input class="fb-ans" data-id="${esc(q.id)}" data-type="text" value="${esc(v || '')}" maxlength="200" style="width:100%;">`;
    if (q.type === 'paragraph') return `<textarea class="fb-ans" data-id="${esc(q.id)}" data-type="paragraph" rows="3" maxlength="1500" style="width:100%;">${esc(v || '')}</textarea>`;
    if (q.type === 'list') return fbListRows(q, v);
    if (q.type === 'choice') {
        const otherChosen = isFbOther(v);
        return q.options.map(o => `<label style="display:flex;gap:8px;align-items:center;padding:4px 0;cursor:pointer;">
            <input type="radio" style="width:auto;" name="fbq_${esc(q.id)}" class="fb-ans" data-id="${esc(q.id)}" data-type="choice" value="${esc(o)}" ${v === o ? 'checked' : ''}> ${esc(o)}</label>`).join('')
            + (q.allowOther ? fbOtherRow(q, 'radio', otherChosen, otherChosen ? v.other : '') : '');
    }
    const others = Array.isArray(v) ? v.filter(isFbOther) : [];
    return q.options.map(o => `<label style="display:flex;gap:8px;align-items:center;padding:4px 0;cursor:pointer;">
        <input type="checkbox" style="width:auto;" class="fb-ans" data-id="${esc(q.id)}" data-type="checkbox" value="${esc(o)}" ${Array.isArray(v) && v.includes(o) ? 'checked' : ''}> ${esc(o)}</label>`).join('')
        + (q.allowOther ? fbOtherRow(q, 'checkbox', others.length > 0, others[0]?.other) : '');
}

// ---- "Open answer — several short items": a member types a few short things, adding/removing rows as needed ----
let fbListState = {}; // question id -> array of strings, kept while the page is open
function fbListRows(q, mine) {
    if (!fbListState[q.id]) fbListState[q.id] = (Array.isArray(mine) && mine.length ? [...mine] : ['']);
    const rows = fbListState[q.id];
    return `<div class="fb-list" data-id="${esc(q.id)}">
        ${rows.map((v, i) => `<div style="display:flex;gap:8px;margin-bottom:6px;">
            <input class="fb-list-item" data-id="${esc(q.id)}" data-i="${i}" value="${esc(v)}" maxlength="100" style="flex:1;max-width:360px;">
            <button type="button" class="ghost small fb-list-del" data-id="${esc(q.id)}" data-i="${i}" ${rows.length <= 1 ? 'disabled' : ''}>✕</button>
        </div>`).join('')}
        <button type="button" class="ghost small fb-list-add" data-id="${esc(q.id)}" ${rows.length >= 10 ? 'disabled' : ''}>+ Add another</button>
    </div>`;
}
function fbRerenderList(qId) {
    const q = fbData?.form?.questions.find(x => x.id === qId);
    if (!q) return;
    const el = document.querySelector(`.fb-list[data-id="${CSS.escape(qId)}"]`);
    if (el) el.outerHTML = fbListRows(q, null); // fbListState already holds the current values, so `mine` isn't needed here
    fbWireListEvents();
}
function fbWireListEvents() {
    document.querySelectorAll('.fb-list-item').forEach(inp => inp.addEventListener('input', e => { fbListState[e.target.dataset.id][Number(e.target.dataset.i)] = e.target.value; }));
    document.querySelectorAll('.fb-list-add').forEach(btn => btn.addEventListener('click', () => { fbListState[btn.dataset.id].push(''); fbRerenderList(btn.dataset.id); }));
    document.querySelectorAll('.fb-list-del').forEach(btn => btn.addEventListener('click', () => { fbListState[btn.dataset.id].splice(Number(btn.dataset.i), 1); fbRerenderList(btn.dataset.id); }));
}
// Typing in an "Other" box checks its radio/checkbox for you; unchecking it (or the group's own boxes taking
// over) doesn't clear what was typed, so nobody loses their text by clicking around.
function fbWireOtherEvents() {
    document.querySelectorAll('.fb-ans-other-text').forEach(inp => inp.addEventListener('input', () => {
        const box = document.querySelector(`.fb-ans-other[data-id="${CSS.escape(inp.dataset.id)}"]`);
        if (box && inp.value.trim()) box.checked = true;
    }));
}

function renderFbNative(form, mine, results) {
    // drop any "list" drafts left over from a form that isn't live any more
    const liveIds = new Set(form.questions.map(q => q.id));
    for (const id of Object.keys(fbListState)) if (!liveIds.has(id)) delete fbListState[id];

    $('fb-native-desc-panel').style.display = form.description ? 'block' : 'none';
    $('fb-native-desc').textContent = form.description || '';
    $('fb-native-questions').innerHTML = form.questions.map((q, i) => `
        <div class="panel" style="margin-bottom:14px;">
            <div style="font-weight:700;margin-bottom:10px;">${i + 1}. ${esc(q.text)}${q.required ? ' <span style="color:var(--danger);">*</span>' : ''}</div>
            ${fbAnswerInput(q, mine)}
        </div>`).join('');
    fbWireOtherEvents(); fbWireListEvents();
    $('fb-native-submit').textContent = mine ? 'Update my answer' : 'Submit';
    $('fb-native-savednote').style.display = mine ? 'inline' : 'none';

    const publicQs = form.questions.filter(q => q.publicResults);
    $('fb-native-results-panel').style.display = publicQs.length ? 'block' : 'none';
    if (publicQs.length) {
        $('fb-native-results').innerHTML = publicQs.map(q => `
            <div class="panel" style="margin-bottom:12px;">
                <div style="font-weight:700;margin-bottom:8px;">${esc(q.text)}</div>
                ${(results?.total || 0) === 0 ? '<p style="color:var(--muted);font-size:13px;margin:0;">No answers yet.</p>'
                    : q.type === 'choice' ? fbPieChart(q, results.counts[q.id], results.total) : fbBarChart(q, results.counts[q.id], results.total)}
            </div>`).join('');
    }
}

function fbGatherAnswers() {
    const answers = {};
    document.querySelectorAll('#fb-native-questions .fb-ans').forEach(el => {
        const id = el.dataset.id;
        if (el.classList.contains('fb-ans-other')) {
            if (!el.checked) return;
            const text = document.querySelector(`.fb-ans-other-text[data-id="${CSS.escape(id)}"]`)?.value.trim();
            if (!text) return;
            if (el.dataset.type === 'checkbox') (answers[id] = answers[id] || []).push({ other: text });
            else answers[id] = { other: text };
        } else if (el.dataset.type === 'checkbox') { if (el.checked) (answers[id] = answers[id] || []).push(el.value); }
        else if (el.dataset.type === 'choice') { if (el.checked) answers[id] = el.value; }
        else answers[id] = el.value;
    });
    // "Open answer — several short items" isn't built from .fb-ans elements — read it straight from its own state
    for (const q of fbData?.form?.questions || []) {
        if (q.type !== 'list' || !fbListState[q.id]) continue;
        const vals = fbListState[q.id].map(s => s.trim()).filter(Boolean);
        if (vals.length) answers[q.id] = vals;
    }
    return answers;
}

$('fb-native-submit').addEventListener('click', async () => {
    const st = $('fb-native-status'), btn = $('fb-native-submit');
    btn.disabled = true;
    try {
        const r = await fbFetch({ action: 'submit', answers: fbGatherAnswers() });
        if (r.error) throw new Error(r.error);
        st.className = 'status ok'; st.textContent = '✓ Thanks — your answer was saved.';
        loadFeedback();
    } catch (e) { st.className = 'status err'; st.textContent = e.message; }
    finally { btn.disabled = false; }
});

// ---- charts: a donut for "pick one" (part of a whole — like Google's own pie charts), bars for "pick several" ----
// (percentages of several picks don't sum to a whole, so a pie would be misleading there).
function fbSlices(q, counts) {
    const rows = q.options.map((o, i) => ({ label: o, n: counts?.[o] || 0, color: FB_PALETTE[i] || null })).filter(r => r.n > 0);
    const otherN = q.allowOther ? (counts?.[FB_OTHER_KEY] || 0) : 0; // everyone who picked "Other: ___", whatever they each typed
    if (rows.length <= 7) { if (otherN > 0) rows.push({ label: 'Other', n: otherN, color: FB_OTHER }); return rows; }
    rows.sort((a, b) => b.n - a.n);
    const top = rows.slice(0, 6), rest = rows.slice(6);
    top.forEach((r, i) => r.color = FB_PALETTE[i]);
    const restN = rest.reduce((s, r) => s + r.n, 0) + otherN;
    if (restN > 0) top.push({ label: 'Other', n: restN, color: FB_OTHER });
    return top;
}
function fbPieChart(q, counts, total) {
    const slices = fbSlices(q, counts);
    const R = 60, CX = 70, CY = 70, TAU = Math.PI * 2;
    let a0 = -Math.PI / 2;
    const arcs = slices.map(s => {
        const a1 = a0 + (s.n / total) * TAU;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const x0 = CX + R * Math.cos(a0), y0 = CY + R * Math.sin(a0);
        const x1 = CX + R * Math.cos(a1), y1 = CY + R * Math.sin(a1);
        const d = slices.length === 1 ? `M${CX},${CY - R}A${R},${R} 0 1 1 ${CX - 0.01},${CY - R} Z` : `M${CX},${CY}L${x0.toFixed(2)},${y0.toFixed(2)}A${R},${R} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}Z`;
        a0 = a1;
        return `<path d="${d}" fill="${s.color}" stroke="var(--bench)" stroke-width="2"><title>${esc(s.label)}: ${s.n} (${Math.round(s.n / total * 100)}%)</title></path>`;
    }).join('');
    const legend = slices.map(s => `<div style="display:flex;gap:8px;align-items:center;font-size:13px;padding:2px 0;">
        <span style="width:11px;height:11px;border-radius:3px;background:${s.color};flex:none;"></span>
        <span style="flex:1;color:var(--text);">${esc(s.label)}</span>
        <span style="color:var(--muted);font-family:var(--mono);">${s.n} · ${Math.round(s.n / total * 100)}%</span></div>`).join('');
    return `<div style="display:flex;gap:20px;flex-wrap:wrap;align-items:center;">
        <svg width="140" height="140" viewBox="0 0 140 140" style="flex:none;">${arcs}<circle cx="${CX}" cy="${CY}" r="30" fill="var(--bench)"/>
            <text x="${CX}" y="${CY + 5}" text-anchor="middle" font-size="16" font-weight="700" fill="var(--text)">${total}</text></svg>
        <div style="flex:1;min-width:180px;">${legend}</div>
    </div>`;
}
function fbBarChart(q, counts, total) {
    const rows = q.options.map(o => ({ label: o, n: counts?.[o] || 0 }));
    if (q.allowOther) { const n = counts?.[FB_OTHER_KEY] || 0; if (n > 0) rows.push({ label: 'Other', n }); }
    rows.sort((a, b) => b.n - a.n);
    const max = Math.max(1, ...rows.map(r => r.n));
    return rows.map(r => `<div class="bar-block">
        <div class="bar-head"><span>${esc(r.label)}</span><span>${r.n} · ${Math.round(r.n / total * 100)}%</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${(r.n / max * 100).toFixed(1)}%;background:var(--reagent);"></div></div>
    </div>`).join('');
}

// ============================================================================================
// ===================================  LEADER EDITOR  ========================================
// ============================================================================================

let fbMode = 'native';
let fbQuestions = []; // working copy while building a native form: [{ id, type, text, options, required, publicResults }]
const fbNewQ = () => ({ id: `local${Math.random().toString(36).slice(2, 9)}`, type: 'text', text: '', options: [], required: false, publicResults: false, allowOther: false });

function setFbMode(mode) {
    fbMode = mode;
    $('fb-editor-native').style.display = mode === 'native' ? 'block' : 'none';
    $('fb-editor-google').style.display = mode === 'google' ? 'block' : 'none';
    $('fb-mode-native').classList.toggle('active-toggle', mode === 'native');
    $('fb-mode-google').classList.toggle('active-toggle', mode === 'google');
}
$('fb-mode-native').addEventListener('click', () => setFbMode('native'));
$('fb-mode-google').addEventListener('click', () => setFbMode('google'));

async function loadFeedbackEditor() {
    try {
        const data = await fbFetch({ action: 'read' });
        const form = data?.form;
        if (form?.mode === 'google') {
            setFbMode('google');
            $('fb-title-input-g').value = form.title || '';
            $('fb-form-url').value = form.formUrl || '';
            $('fb-chart-url').value = form.chartUrl || '';
        } else {
            setFbMode('native');
            $('fb-title-input').value = form?.title || '';
            $('fb-desc-input').value = form?.description || '';
            fbQuestions = form?.questions?.length ? form.questions.map(q => ({ ...q, options: [...q.options] })) : [];
        }
        renderFbQuestions();
        loadFbResponses(form?.mode === 'native');
    } catch (e) { fbQuestions = []; renderFbQuestions(); }
}

function renderFbQuestions() {
    $('fb-questions').innerHTML = fbQuestions.length ? fbQuestions.map((q, i) => `
        <div class="panel fb-qcard" data-i="${i}" style="margin-bottom:10px;">
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap;">
                <input class="fb-q-text" value="${esc(q.text)}" placeholder="Question text" style="flex:1;min-width:180px;" maxlength="200">
                <select class="fb-q-type" style="width:auto;">${Object.entries(FB_TYPES).map(([v, l]) => `<option value="${v}" ${q.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
                <button class="ghost small fb-q-up" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button>
                <button class="ghost small fb-q-down" ${i === fbQuestions.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
                <button class="ghost small fb-q-del" style="color:var(--danger);">Delete</button>
            </div>
            ${q.type === 'choice' || q.type === 'checkbox' ? `
            <div class="fb-q-opts" style="margin:0 0 10px 4px;">
                ${q.options.map((o, j) => `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
                    <span style="color:var(--muted);font-size:12px;width:16px;">${j + 1}.</span>
                    <input class="fb-opt-text" data-j="${j}" value="${esc(o)}" placeholder="Option" style="flex:1;max-width:420px;" maxlength="120">
                    <button class="ghost small fb-opt-del" data-j="${j}" ${q.options.length <= 2 ? 'disabled title="At least 2 options"' : ''}>✕</button>
                </div>`).join('')}
                <button class="ghost small fb-opt-add" ${q.options.length >= 8 ? 'disabled' : ''}>+ Add option</button>
            </div>` : ''}
            <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px;">
                <label style="display:flex;gap:6px;align-items:center;cursor:pointer;"><input type="checkbox" style="width:auto;" class="fb-q-required" ${q.required ? 'checked' : ''}> Required</label>
                ${q.type === 'choice' || q.type === 'checkbox' ? `<label style="display:flex;gap:6px;align-items:center;cursor:pointer;"><input type="checkbox" style="width:auto;" class="fb-q-other" ${q.allowOther ? 'checked' : ''}> Add an "Other: ___" choice</label>
                <label style="display:flex;gap:6px;align-items:center;cursor:pointer;"><input type="checkbox" style="width:auto;" class="fb-q-public" ${q.publicResults ? 'checked' : ''}> Show results to everyone (a chart on the Feedback page)</label>` : ''}
            </div>
            ${q.type === 'list' ? '<p style="color:var(--muted);font-size:12px;margin:6px 0 0;">Members get a "+ Add another" button, so they can list a few short things instead of one paragraph. Kept private like a normal short answer — no public chart.</p>' : ''}
        </div>`).join('') : '<p style="color:var(--muted);font-size:13px;margin:0 0 12px;">No questions yet — press "+ Add a question" below.</p>';

    document.querySelectorAll('.fb-qcard').forEach(card => {
        const i = Number(card.dataset.i), q = fbQuestions[i];
        card.querySelector('.fb-q-text').addEventListener('input', e => { q.text = e.target.value; });
        card.querySelector('.fb-q-type').addEventListener('change', e => {
            q.type = e.target.value;
            if ((q.type === 'choice' || q.type === 'checkbox') && q.options.length < 2) q.options = ['', ''];
            if (q.type !== 'choice' && q.type !== 'checkbox') { q.options = []; q.publicResults = false; q.allowOther = false; }
            renderFbQuestions();
        });
        card.querySelector('.fb-q-up').addEventListener('click', () => { if (i > 0) { [fbQuestions[i - 1], fbQuestions[i]] = [fbQuestions[i], fbQuestions[i - 1]]; renderFbQuestions(); } });
        card.querySelector('.fb-q-down').addEventListener('click', () => { if (i < fbQuestions.length - 1) { [fbQuestions[i + 1], fbQuestions[i]] = [fbQuestions[i], fbQuestions[i + 1]]; renderFbQuestions(); } });
        card.querySelector('.fb-q-del').addEventListener('click', () => { if (confirm('Delete this question?')) { fbQuestions.splice(i, 1); renderFbQuestions(); } });
        card.querySelector('.fb-q-required').addEventListener('change', e => { q.required = e.target.checked; });
        card.querySelector('.fb-q-public')?.addEventListener('change', e => { q.publicResults = e.target.checked; });
        card.querySelector('.fb-q-other')?.addEventListener('change', e => { q.allowOther = e.target.checked; });
        card.querySelectorAll('.fb-opt-text').forEach(inp => inp.addEventListener('input', e => { q.options[Number(e.target.dataset.j)] = e.target.value; }));
        card.querySelectorAll('.fb-opt-del').forEach(btn => btn.addEventListener('click', () => { q.options.splice(Number(btn.dataset.j), 1); renderFbQuestions(); }));
        card.querySelector('.fb-opt-add')?.addEventListener('click', () => { q.options.push(''); renderFbQuestions(); });
    });
}
$('fb-q-add').addEventListener('click', () => { fbQuestions.push(fbNewQ()); renderFbQuestions(); });

$('fb-save').addEventListener('click', async () => {
    const btn = $('fb-save'), st = $('fb-editor-status');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        let body;
        if (fbMode === 'native') {
            if (!fbQuestions.length) throw new Error('Add at least one question first.');
            const blank = fbQuestions.find(q => !q.text.trim());
            if (blank) throw new Error('One of the questions has no text yet — fill it in or delete it.');
            const tooFewOpts = fbQuestions.find(q => (q.type === 'choice' || q.type === 'checkbox') && q.options.filter(o => o.trim()).length < 2);
            if (tooFewOpts) throw new Error(`"${tooFewOpts.text}" needs at least 2 filled-in options.`);
            body = { mode: 'native', title: $('fb-title-input').value.trim(), description: $('fb-desc-input').value.trim(), questions: fbQuestions };
        } else {
            const extractEmbedUrl = input => { const m = String(input || '').match(/src=["']([^"']+)["']/i); const u = m ? m[1] : String(input || '').trim(); return /^https:\/\//i.test(u) ? u : null; };
            const formUrl = extractEmbedUrl($('fb-form-url').value);
            if (!formUrl) throw new Error('That doesn\'t look like a valid embed URL — paste the link Google gives you (or the whole <iframe> snippet), starting with https://');
            body = { mode: 'google', title: $('fb-title-input-g').value.trim(), formUrl, chartUrl: $('fb-chart-url').value.trim() ? extractEmbedUrl($('fb-chart-url').value) : null };
        }
        const data = await fbFetch({ key: apiKey, ...body });
        if (data.error) throw new Error(data.error);
        if (data.form?.mode === 'native') fbQuestions = data.form.questions.map(q => ({ ...q, options: [...q.options] })); // pick up server-assigned ids
        st.className = 'status ok'; st.textContent = 'Saved — live on the Feedback page now. Answers to the old form (if any) were cleared.';
        loadFbResponses(fbMode === 'native');
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    } finally {
        btn.disabled = false; btn.textContent = 'Save — replaces the live form';
    }
});

$('fb-clear').addEventListener('click', async () => {
    if (!confirm('Remove the current feedback form (and its answers) for everyone?')) return;
    try {
        await fbFetch({ action: 'clear' });
        fbQuestions = [];
        loadFeedbackEditor();
        toast('Feedback form cleared');
    } catch (e) { toast('Could not clear the form'); }
});

// ---- leader: raw responses table + copy-all (mirrors the pattern already used for bugs & suggestions) ----
let fbResponses = null;
// A single stored answer (string, array, or an "Other" object) turned into one readable line — used for both
// the on-page responses list and the copy-all export, so they always agree.
function fbFmtAnswer(v) {
    if (Array.isArray(v)) return v.map(x => isFbOther(x) ? `Other: ${x.other}` : x).join(', ');
    if (isFbOther(v)) return `Other: ${v.other}`;
    return v;
}

async function loadFbResponses(isNative) {
    if (!isNative) { $('fb-responses-panel').style.display = 'none'; return; }
    const r = await fbFetch({ action: 'responses' });
    if (r.error) { $('fb-responses-panel').style.display = 'none'; return; }
    fbResponses = r;
    $('fb-responses-panel').style.display = 'block';
    const when = ts => new Date(ts).toLocaleString();
    const mentioned = Object.entries(r.listFreq || {}).filter(([, list]) => list.length);
    $('fb-responses-body').innerHTML = (mentioned.length ? `<div style="margin-bottom:14px;">${mentioned.map(([qid, list]) => {
            const q = r.form.questions.find(x => x.id === qid);
            return `<div style="margin-bottom:8px;"><b style="font-size:13px;">Most mentioned — ${esc(q?.text || '')}</b><div style="font-size:13px;color:var(--muted);margin-top:2px;">${list.map(e => `${esc(e.label)} (${e.n}×)`).join(' · ')}</div></div>`;
        }).join('')}</div>` : '') +
        (r.rows.length ? `
        <p style="color:var(--muted);font-size:13px;margin:0 0 10px;">${r.rows.length} response${r.rows.length === 1 ? '' : 's'}.</p>
        ${r.rows.map(row => `<div style="border-top:1px solid var(--line);padding:8px 0;">
            <div style="font-weight:700;font-size:13px;margin-bottom:4px;">${esc(row.name)} <span style="color:var(--muted);font-weight:400;font-size:11px;">— ${esc(when(row.submittedAt))}</span></div>
            ${r.form.questions.map(q => row.answers[q.id] !== undefined ? `<div style="font-size:13px;margin:2px 0 2px 8px;"><span style="color:var(--muted);">${esc(q.text)}:</span> ${esc(fbFmtAnswer(row.answers[q.id]))}</div>` : '').join('')}
        </div>`).join('')}` : '<p style="color:var(--muted);font-size:13px;margin:0;">No responses yet.</p>');
}
$('fb-responses-copy').addEventListener('click', async () => {
    if (!fbResponses?.rows?.length) { toast('No responses to copy yet.'); return; }
    const when = ts => new Date(ts).toISOString().slice(0, 16).replace('T', ' ');
    const text = `${fbResponses.form.title} — ${fbResponses.rows.length} responses, exported ${when(Date.now())} UTC\n\n` +
        fbResponses.rows.map(row => `${row.name} (${when(row.submittedAt)})\n` +
            fbResponses.form.questions.map(q => row.answers[q.id] !== undefined ? `  ${q.text}: ${fbFmtAnswer(row.answers[q.id])}` : '').filter(Boolean).join('\n')
        ).join('\n\n');
    try { await navigator.clipboard.writeText(text); toast('Copied — paste it wherever you need it'); } catch (e) { toast('Could not copy — try again'); }
});
