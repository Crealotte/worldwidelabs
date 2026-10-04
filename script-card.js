// Dashboard card with a one-click install / update button for the Torn userscript. It is always shown, so there is always a
// button to find: a big Install / Update button while something is needed, and a calm "installed and up to date" line with a
// small Reinstall link once it is current. Backend: 'script-status' in api/war-payout.js (the caller's own last check-in and
// version).
'use strict';

const SC_FILE = '/worldwidelabs.user.js';
const scLess = (a, b) => { const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number); for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return x < y; } return false; };

async function loadScriptCard() {
    const panel = $('dash-script-panel');
    if (!panel) return;
    const btn = (label, ghost) => `<a href="${SC_FILE}" target="_blank" rel="noopener" style="text-decoration:none;"><button type="button"${ghost ? ' class="ghost small"' : ''}>${label}</button></a>`;
    const howTo = '<p style="color:var(--muted);font-size:12px;margin:10px 0 0;">On a computer you need <b>Tampermonkey</b> (or a similar script manager) in your browser first. On TornPDA, add it as a script in the app. Not sure? Ask a leader.</p>';
    panel.style.display = 'block';
    let r = null;
    try {
        const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, action: 'script-status' }) });
        r = await res.json();
        if (r.error) r = null;
    } catch (e) { r = null; }
    if (!r) { // could not tell — still offer the button
        $('dash-script-body').innerHTML = `<p style="margin:0 0 10px;">Get your weekly plan, to-dos and targets right inside Torn.</p>${btn('Install or update the script')}${howTo}`;
        return;
    }
    const ageDays = r.seen ? (Date.now() - r.seen) / 86400000 : null;
    const recent = r.seen && ageDays < 30;
    // a script too old to report its version counts as outdated, same as Who's on board
    const outdated = recent && r.latest && (!r.version || scLess(r.version, r.latest));
    if (recent && !outdated) {
        $('dash-script-body').innerHTML = `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;"><span style="color:var(--reagent);">✓ Your WWL script is installed and up to date${r.version ? ` (v${esc(r.version)})` : ''}.</span>${btn('Reinstall', true)}</div>`;
        return;
    }
    $('dash-script-body').innerHTML = outdated
        ? `<p style="margin:0 0 10px;">A newer version of the WWL script is available${r.latest ? ` (v${esc(r.latest)})` : ''}${r.version ? ` — you have v${esc(r.version)}` : ''}. Press the button; your script manager asks you to confirm, and your key and settings stay as they are.</p>${btn('Update the script')}`
        : `<p style="margin:0 0 10px;">${r.seen ? 'Your WWL script has not been seen for a while.' : 'Get your weekly plan, to-dos and targets right inside Torn.'} Press the button and your script manager asks you to confirm the install. Then open the small <b>WWL</b> button in Torn, press ⚙ and paste your API key.</p>${btn('Install the script')}${howTo}`;
}
