// bug-report.js — the "Bug reports" page: describe a problem, optionally add a screenshot (pick a file or
// paste one with Ctrl+V), and it is sent to a Discord channel for the owner. Backend: lib/bugReport.js.
// The screenshot is shrunk in the browser first (max 1600 px wide, JPEG) so it stays small and quick.
'use strict';

let brShot = null; // data URL of the resized screenshot, or null

function brResize(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            const scale = Math.min(1, 1600 / img.width);
            const c = document.createElement('canvas');
            c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            URL.revokeObjectURL(url);
            resolve(c.toDataURL('image/jpeg', 0.75));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image.')); };
        img.src = url;
    });
}
async function brSetShot(file) {
    if (!file || !file.type.startsWith('image/')) { toast('Please choose an image.'); return; }
    try { brShot = await brResize(file); } catch (e) { toast(e.message); return; }
    $('br-preview').src = brShot;
    $('br-preview-wrap').style.display = 'block';
}
function brClearShot() { brShot = null; $('br-file').value = ''; $('br-preview-wrap').style.display = 'none'; }

function loadBugReport() {
    loadKnownBugs();
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
            body: JSON.stringify({ key: apiKey, action: 'bug-report', description, page: $('br-page').value, screenshot: brShot }),
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
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
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
        ${leader ? `<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--muted);">${b.count} reported ·
            ${['review', 'known', 'fixing', 'fixed'].filter(s => s !== b.status).map(s => `<button class="ghost small kb-status" data-id="${esc(b.id)}" data-status="${s}">Mark ${KB_STATUS[s][0].toLowerCase()}</button>`).join('')}
            <button class="ghost small kb-del" data-id="${esc(b.id)}">Delete</button></div>` : ''}
    </div>`;
}
function renderKnownBugs() {
    const leader = typeof isLeaderCached !== 'undefined' && isLeaderCached;
    $('kb-leader').style.display = leader ? 'block' : 'none';
    const open = kbBugs.filter(b => b.status !== 'fixed'), fixed = kbBugs.filter(b => b.status === 'fixed');
    $('kb-list').innerHTML = (open.length ? open.map(b => kbRow(b, leader)).join('') : '<p style="color:var(--muted);font-size:13px;margin:0;">No known bugs right now.</p>')
        + (fixed.length ? `<details style="margin-top:8px;"><summary class="av-sum"><span style="font-size:13px;">Fixed (${fixed.length})</span></summary>${fixed.map(b => kbRow(b, leader)).join('')}</details>` : '');
    document.querySelectorAll('.kb-metoo').forEach(btn => btn.addEventListener('click', async () => {
        btn.disabled = true;
        const r = await kbFetch({ action: 'bugs-metoo', id: btn.dataset.id });
        if (r.error) toast(r.error); else toast('Thanks — noted, no need to send a report');
        loadKnownBugs();
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
