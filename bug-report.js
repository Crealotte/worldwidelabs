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
            body: JSON.stringify({ key: apiKey, action: 'bug-report', description, page: $('br-page').value, screenshot: brShot, agent: navigator.userAgent }),
        });
        const text = await res.text();
        let r; try { r = JSON.parse(text); } catch (e) { throw new Error(`Server problem (${res.status}) — try a smaller screenshot.`); }
        if (r.error) throw new Error(r.error);
        st.className = 'status ok'; st.textContent = '✓ Thank you! Your report was sent.';
        $('br-text').value = ''; brClearShot();
    } catch (e) { st.className = 'status err'; st.textContent = e.message; }
    finally { btn.disabled = false; btn.textContent = 'Send report'; }
});
