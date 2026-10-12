// bug-report.js — the "Bug reports" page: describe a problem, optionally add a screenshot (pick a file or
// paste one with Ctrl+V), and it is sent to a Discord channel for the owner. Backend: lib/bugReport.js.
// The screenshot is shrunk in the browser first (max 1600 px wide, JPEG) so it stays small and quick.
'use strict';

const brSvc = () => (typeof invMode !== 'undefined' && invMode) || (typeof directorMode !== 'undefined' && directorMode); // a service user (investor, tenant, director): the server then only shows them what belongs to their pages
let brShot = null; // data URL of the resized screenshot, or null
let brVideo = null; // data URL of a short screen recording (max about 3 MB), or null
const BR_MAX_VIDEO = 3 * 1024 * 1024;

function brResize(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            const scale = Math.min(1, 1400 / img.width);
            const c = document.createElement('canvas');
            c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            URL.revokeObjectURL(url);
            resolve(c.toDataURL('image/jpeg', 0.7));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image.')); };
        img.src = url;
    });
}
function brReadVideo(file) {
    return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('That file could not be read.')); r.readAsDataURL(file); });
}
async function brSetVideo(file) {
    if (file.size > BR_MAX_VIDEO) { toast('That recording is over 3 MB — record a shorter clip, or upload it somewhere and paste the link in your description.'); return; }
    if (!/^video\/(mp4|webm|quicktime)$/.test(file.type)) { toast('Please use an mp4, webm or mov recording.'); return; }
    try { brVideo = await brReadVideo(file); } catch (e) { toast(e.message); return; }
    $('br-video-preview').src = brVideo;
    $('br-video-wrap').style.display = 'block';
}
function brClearVideo() { brVideo = null; $('br-video-preview').removeAttribute('src'); $('br-video-wrap').style.display = 'none'; }
async function brSetShot(file) {
    if (file && file.type.startsWith('video/')) { await brSetVideo(file); return; }
    if (!file || !(file.type.startsWith('image/') || file.type.startsWith('video/'))) { toast('Please choose an image or a short recording.'); return; }
    try { brShot = await brResize(file); } catch (e) { toast(e.message); return; }
    $('br-preview').src = brShot;
    $('br-preview-wrap').style.display = 'block';
}
function brClearShot() { brShot = null; brClearVideo(); $('br-file').value = ''; $('br-preview-wrap').style.display = 'none'; }

function loadBugReport() {
    loadKnownBugs();
    loadSuggestions();
    // the page list comes from the sidebar; the page they came from is pre-selected
    if (!$('br-page').options.length) {
        $('br-page').innerHTML = [...document.querySelectorAll('.nav-item')].filter(n => n.style.display !== 'none').map(n => `<option value="${esc(n.dataset.page)}">${esc(n.textContent.trim())}</option>`).join('') + '<option value="other">Something else / the whole app</option>';
    }
    let from = 'dashboard';
    try { from = sessionStorage.getItem('wwl_prev_page') || 'dashboard'; } catch (e) { /* default */ }
    if ([...$('br-page').options].some(o => o.value === from)) $('br-page').value = from;
}

$('br-file').addEventListener('change', () => brSetShot($('br-file').files[0]));
$('br-clear').addEventListener('click', brClearShot);
document.addEventListener('paste', e => { // Ctrl+V of a screenshot anywhere on the page while the bug page is open
    if (!$('page-bug-report').classList.contains('visible')) return;
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); brSetShot(item.getAsFile()); }
});

$('br-send').addEventListener('click', async () => {
    const st = $('br-status');
    const description = $('br-text').value.trim();
    if (description.length < 10) { st.className = 'status err'; st.textContent = 'Please describe the problem in a bit more detail.'; return; }
    const btn = $('br-send'); btn.disabled = true; btn.textContent = 'Sending…';
    st.className = 'status ok'; st.textContent = 'Sending your report…';
    try {
        const res = await fetch('/api/war-payout', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: apiKey, action: 'bug-report', description, page: $('br-page').value, screenshot: brShot, video: brVideo, svc: brSvc() }),
        });
        const text = await res.text();
        let r; try { r = JSON.parse(text); } catch (e) { throw new Error(`Server problem (${res.status}) — try a smaller screenshot.`); }
        if (r.error) throw new Error(r.error);
        st.className = 'status ok'; st.textContent = '✓ Thank you! Your report was sent.';
        $('br-text').value = ''; brClearShot();
    } catch (e) { st.className = 'status err'; st.textContent = e.message; }
    finally { btn.disabled = false; btn.textContent = 'Send report'; }
});

// ---- Known bugs: read the list, "I have this too", and (leaders) keep the list up to date ----
let kbBugs = [];
const KB_STATUS = { review: ['To review', '#7aa2ff'], known: ['Known', 'var(--muted)'], fixing: ['Being fixed', '#f0b432'], fixed: ['Fixed', 'var(--reagent)'] };
async function kbFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...(brSvc() ? { svc: true } : {}), ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}
async function loadKnownBugs() {
    const r = await kbFetch({ action: 'bugs-list' });
    if (r.error) { $('kb-list').innerHTML = `<p style="color:var(--danger);font-size:13px;">${esc(r.error)}</p>`; return; }
    kbBugs = r.bugs || [];
    renderKnownBugs();
}
function kbRow(b, leader) {
    const [label, color] = KB_STATUS[b.status] || KB_STATUS.known;
    return `<div style="border-top:1px solid var(--line);padding:8px 0;">
        <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;">
            <span style="font-size:11px;font-weight:700;color:${color};border:1px solid ${color};border-radius:10px;padding:1px 8px;">${label}</span>
            <b style="font-size:14px;">${esc(b.title)}</b>
            ${b.status !== 'fixed' ? `<button class="ghost small kb-metoo" data-id="${esc(b.id)}" style="margin-left:auto;${b.mine ? 'border-color:var(--reagent);color:var(--reagent);' : ''}">${b.mine ? '✓ You have this too' : 'I have this too'} · ${b.count}</button>` : ''}
        </div>
        ${b.note ? `<div style="color:var(--muted);font-size:13px;margin-top:3px;">${esc(b.note)}</div>` : ''}
        ${b.detail ? (b.detail.length <= 300
            ? `<div style="white-space:pre-wrap;font-size:13px;margin-top:4px;">${esc(b.detail)}${b.by ? ` <span style="color:var(--muted);">— ${esc(b.by)}</span>` : ''}</div>`
            : `<div style="white-space:pre-wrap;font-size:13px;margin-top:4px;">${esc(b.detail.slice(0, 300).replace(/\s+\S*$/, ''))}…</div><details style="margin-top:4px;"><summary class="av-sum"><span style="font-size:12px;color:var(--reagent);">Read the rest${b.by ? ` (sent by ${esc(b.by)})` : ''}</span></summary><div style="white-space:pre-wrap;font-size:13px;margin-top:4px;">${esc(b.detail)}</div></details>`) : ''}
        ${b.hasShot ? `<div style="margin-top:6px;"><button class="ghost small kb-shot" data-id="${esc(b.id)}">📷 View screenshot</button><div class="kb-shot-box" data-id="${esc(b.id)}" style="display:none;margin-top:6px;"></div></div>` : ''}
        ${leader ? `<div style="margin-top:4px;font-size:12px;color:var(--muted);">${b.by ? `Reported by <b style="color:var(--text);">${esc(b.by)}</b> · ` : ''}${b.who && b.who.length ? `Have this too (${b.who.length}): ${esc(b.who.join(', '))}` : 'Nobody has pressed "I have this too" yet'}</div>` : ''}
        ${leader ? `<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--muted);">${b.count} reported ·
            ${['review', 'known', 'fixing', 'fixed'].filter(s => s !== b.status).map(s => `<button class="ghost small kb-status" data-id="${esc(b.id)}" data-status="${s}">Mark ${KB_STATUS[s][0].toLowerCase()}</button>`).join('')}
            <button class="ghost small kb-del" data-id="${esc(b.id)}">Delete</button></div>` : ''}
    </div>`;
}
function renderKnownBugs() {
    const leader = typeof isLeaderCached !== 'undefined' && isLeaderCached;
    $('kb-leader').style.display = leader ? 'block' : 'none';
    $('bs-export').style.display = leader ? 'block' : 'none';
    const open = kbBugs.filter(b => b.status !== 'fixed'), fixed = kbBugs.filter(b => b.status === 'fixed');
    $('kb-list').innerHTML = (open.length ? open.map(b => kbRow(b, leader)).join('') : '<p style="color:var(--muted);font-size:13px;margin:0;">No known bugs right now.</p>')
        + (fixed.length ? `<details style="margin-top:8px;"><summary class="av-sum"><span style="font-size:13px;">Fixed (${fixed.length})</span></summary>${fixed.map(b => kbRow(b, leader)).join('')}</details>` : '');
    document.querySelectorAll('.kb-metoo').forEach(btn => btn.addEventListener('click', async () => {
        btn.disabled = true;
        const r = await kbFetch({ action: 'bugs-metoo', id: btn.dataset.id });
        if (r.error) toast(r.error); else toast('Thanks — noted, no need to send a report');
        loadKnownBugs();
    }));
    document.querySelectorAll('.kb-shot').forEach(btn => btn.addEventListener('click', async () => {
        const box = document.querySelector(`.kb-shot-box[data-id="${btn.dataset.id}"]`);
        if (box.style.display === 'block') { box.style.display = 'none'; btn.textContent = '📷 View screenshot'; return; }
        if (!box.innerHTML) {
            btn.disabled = true;
            const r = await kbFetch({ action: 'bugs-shot', id: btn.dataset.id });
            btn.disabled = false;
            if (r.error || !r.shot) { toast(r.error || 'The screenshot is no longer available.'); return; }
            box.innerHTML = `<img alt="Screenshot of the bug" src="${r.shot}" style="max-width:100%;max-height:420px;border:1px solid var(--line);border-radius:var(--radius);display:block;">`;
        }
        box.style.display = 'block'; btn.textContent = '📷 Hide screenshot';
    }));
    document.querySelectorAll('.kb-status').forEach(btn => btn.addEventListener('click', async () => { await kbFetch({ action: 'bugs-status', id: btn.dataset.id, status: btn.dataset.status }); loadKnownBugs(); }));
    document.querySelectorAll('.kb-del').forEach(btn => btn.addEventListener('click', async () => { if (!confirm('Delete this known bug?')) return; await kbFetch({ action: 'bugs-delete', id: btn.dataset.id }); loadKnownBugs(); }));
    kbSuggest();
}
$('kb-add').addEventListener('click', async () => {
    const r = await kbFetch({ action: 'bugs-add', title: $('kb-title').value, note: $('kb-note').value, status: $('kb-status').value });
    if (r.error) { toast(r.error); return; }
    $('kb-title').value = ''; $('kb-note').value = '';
    toast('Added to the known bugs');
    loadKnownBugs();
    loadSuggestions();
});

// While someone types a report, matching known bugs are shown above the form — a hint, never a block.
const kbWords = s => new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4));
function kbSuggest() {
    const typed = kbWords($('br-text').value);
    const hits = typed.size < 2 ? [] : kbBugs.filter(b => b.status !== 'fixed').filter(b => { const w = kbWords(`${b.title} ${b.note}`); let n = 0; typed.forEach(t => { if (w.has(t)) n++; }); return n >= 2; }).slice(0, 3);
    $('kb-suggest').style.display = hits.length ? 'block' : 'none';
    $('kb-suggest').innerHTML = hits.length ? `<div style="border:1px solid #f0b432;border-radius:var(--radius);padding:8px 12px;font-size:13px;"><b>This looks like a known bug:</b> ${hits.map(b => esc(b.title)).join(' · ')} — press "I have this too" in the list above instead of sending a report.</div>` : '';
}
$('br-text').addEventListener('input', kbSuggest);

// ---- Suggestions: add an idea, vote thumbs up / down, (leaders) set a status. Backend: suggestHandle in lib/bugReport.js ----
let sgList = [];
const SG_STATUS = { open: ['Open', 'var(--muted)'], planned: ['Planned', '#f0b432'], done: ['Done', 'var(--reagent)'], declined: ['Not planned', '#7aa2ff'] };
async function loadSuggestions() {
    const r = await kbFetch({ action: 'sug-list' });
    if (r.error) { $('sg-list').innerHTML = `<p style="color:var(--danger);font-size:13px;">${esc(r.error)}</p>`; return; }
    sgList = r.suggestions || [];
    renderSuggestions();
}
function sgRow(s, leader) {
    const [label, color] = SG_STATUS[s.status] || SG_STATUS.open;
    const on = 'border-color:var(--reagent);color:var(--reagent);';
    return `<div style="border-top:1px solid var(--line);padding:8px 0;">
        <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;">
            ${s.status !== 'open' ? `<span style="font-size:11px;font-weight:700;color:${color};border:1px solid ${color};border-radius:10px;padding:1px 8px;">${label}</span>` : ''}
            <span style="font-size:14px;flex:1;min-width:200px;white-space:pre-wrap;">${esc(s.text)}</span>
            <span style="display:flex;gap:6px;">
                <button class="ghost small sg-vote" data-id="${esc(s.id)}" data-vote="1" style="${s.mine === 1 ? on : ''}">👍 ${s.up}</button>
                <button class="ghost small sg-vote" data-id="${esc(s.id)}" data-vote="-1" style="${s.mine === -1 ? 'border-color:var(--danger);color:var(--danger);' : ''}">👎 ${s.down}</button>
            </span>
        </div>
        ${leader ? `<div style="margin-top:4px;font-size:12px;color:var(--muted);">${s.by ? `Suggested by <b style="color:var(--text);">${esc(s.by)}</b>` : ''}${s.upBy && s.upBy.length ? ` · 👍 ${esc(s.upBy.join(', '))}` : ''}${s.downBy && s.downBy.length ? ` · 👎 ${esc(s.downBy.join(', '))}` : ''}</div>` : ''}
        ${leader ? `<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--muted);">
            ${Object.keys(SG_STATUS).filter(k => k !== s.status).map(k => `<button class="ghost small sg-status" data-id="${esc(s.id)}" data-status="${k}">Mark ${SG_STATUS[k][0].toLowerCase()}</button>`).join('')}
            <button class="ghost small sg-del" data-id="${esc(s.id)}">Delete</button></div>` : ''}
    </div>`;
}
function renderSuggestions() {
    const leader = typeof isLeaderCached !== 'undefined' && isLeaderCached;
    const open = sgList.filter(s => s.status === 'open' || s.status === 'planned'), rest = sgList.filter(s => s.status === 'done' || s.status === 'declined');
    $('sg-list').innerHTML = (open.length ? open.map(s => sgRow(s, leader)).join('') : '<p style="color:var(--muted);font-size:13px;margin:0;">No suggestions yet — be the first!</p>')
        + (rest.length ? `<details style="margin-top:8px;"><summary class="av-sum"><span style="font-size:13px;">Done / not planned (${rest.length})</span></summary>${rest.map(s => sgRow(s, leader)).join('')}</details>` : '');
    document.querySelectorAll('.sg-vote').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true;
        const r = await kbFetch({ action: 'sug-vote', id: b.dataset.id, vote: Number(b.dataset.vote) });
        if (r.error) toast(r.error);
        loadSuggestions();
    }));
    document.querySelectorAll('.sg-status').forEach(b => b.addEventListener('click', async () => { await kbFetch({ action: 'sug-status', id: b.dataset.id, status: b.dataset.status }); loadSuggestions(); }));
    document.querySelectorAll('.sg-del').forEach(b => b.addEventListener('click', async () => { if (!confirm('Delete this suggestion?')) return; await kbFetch({ action: 'sug-delete', id: b.dataset.id }); loadSuggestions(); }));
}
$('sg-send').addEventListener('click', async () => {
    const st = $('sg-status'), btn = $('sg-send');
    btn.disabled = true;
    const r = await kbFetch({ action: 'sug-add', text: $('sg-text').value, area: $('br-page').value });
    btn.disabled = false;
    if (r.error) { st.className = 'status err'; st.textContent = r.error; return; }
    st.className = 'status ok'; st.textContent = '✓ Thanks — your idea is on the list.';
    $('sg-text').value = '';
    loadSuggestions();
});
$('br-clear-video').addEventListener('click', brClearVideo);

// ---- Leaders: copy every bug and suggestion (full text) as one block of text ----
function bsExportText() {
    const fmtDate = ms => (ms ? new Date(ms).toISOString().slice(0, 10) : '?');
    const bugs = kbBugs.map(b => [`[${(KB_STATUS[b.status] || KB_STATUS.known)[0]}] ${b.title}`,
        `  ${b.count} member${b.count === 1 ? '' : 's'} have this · reported ${fmtDate(b.createdAt)}${b.by ? ` by ${b.by}` : ''}${b.hasShot ? ' · has a screenshot' : ''}${b.who && b.who.length ? ` · have this too: ${b.who.join(', ')}` : ''}`,
        b.note ? `  Note: ${b.note}` : '', b.detail ? `  Full report: ${b.detail.replace(/\n/g, '\n    ')}` : ''].filter(Boolean).join('\n'));
    const sugs = sgList.map(s => [`[${(SG_STATUS[s.status] || SG_STATUS.open)[0]}] 👍${s.up} 👎${s.down} — ${fmtDate(s.createdAt)}${s.by ? ` — by ${s.by}` : ''}`, `  ${s.text.replace(/\n/g, '\n  ')}`].join('\n'));
    return `WWL bugs & suggestions — exported ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC\n\n=== KNOWN BUGS (${bugs.length}) ===\n${bugs.join('\n\n') || '(none)'}\n\n=== SUGGESTIONS (${sugs.length}) ===\n${sugs.join('\n\n') || '(none)'}\n`;
}
$('bs-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(bsExportText()); toast('Copied — paste it to Claude'); }
    catch (e) { toast('Could not copy — try again'); }
});
