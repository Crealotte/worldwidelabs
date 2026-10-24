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
    // On a phone (TornPDA especially) the link opens in the SAME page: the app offers to install a script when it is opened itself, which a new tab from a page does not always trigger
    const sameTab = /TornPDA|Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || typeof window.flutter_inappwebview !== 'undefined';
    const btn = (label, ghost) => `<a href="${SC_FILE}"${sameTab ? '' : ' target="_blank" rel="noopener"'} style="text-decoration:none;"><button type="button"${ghost ? ' class="ghost small"' : ''}>${label}</button></a>`;
    const howTo = '<p style="font-size:12px;margin:10px 0 0;"><b>This website is not the script.</b> The script is a separate little add-on that you install in your script manager; after that it shows up inside Torn itself.</p><p style="color:var(--muted);font-size:12px;margin:6px 0 0;">On a computer you need <b>Tampermonkey</b> (or a similar script manager) in your browser first. On TornPDA, add it as a script in the app. Not sure? Ask a leader.</p>';
    // For the case where tapping the button does not offer to install (opened inside the WWL app or an in-app browser, or no
    // script manager yet): the plain link, to paste into the script manager or open in a normal browser.
    const linkLine = '<p style="color:var(--muted);font-size:12px;margin:8px 0 0;">If the button just opens a page instead of offering to install: <a href="#" id="sc-copy">copy the script link</a>, then paste it into your script manager (Tampermonkey: Utilities, Install from URL) or open it in your normal browser instead of inside the WWL app.</p>' + '<p style="font-size:12px;margin:8px 0 0;"><b>On TornPDA</b> the link only shows the text of the script: the app has no install page. Add it inside the app instead: open the TornPDA settings, go to the Advanced Browser Settings and open the User Scripts, then add a new script and paste the code. <a href="#" id="sc-code">Copy the whole script code</a>, then paste it there (the menu names can differ a little per version of the app).</p>';
    const wireCode = () => $('sc-code')?.addEventListener('click', async e => { // for TornPDA: the whole script text on the clipboard, to paste into the app's script editor
        e.preventDefault();
        try { const code = await (await fetch(SC_FILE)).text(); await navigator.clipboard.writeText(code); toast('The script code is copied: paste it in TornPDA'); }
        catch (err) { toast('Could not copy it. Open the script link, select all the text and copy it by hand.'); }
    });
    const wireCopy = () => { wireCode(); $('sc-copy')?.addEventListener('click', e => { e.preventDefault(); navigator.clipboard.writeText(`${location.origin}${SC_FILE}`).then(() => toast('Script link copied')).catch(() => toast(`Copy this link: ${location.origin}${SC_FILE}`)); }); };
    panel.style.display = 'block';
    let r = null;
    try {
        const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, action: 'script-status' }) });
        r = await res.json();
        if (r.error) r = null;
    } catch (e) { r = null; }
    if (!r) { // could not tell — still offer the button
        $('dash-script-body').innerHTML = `<p style="margin:0 0 10px;">Get your weekly plan, to-dos and targets right inside Torn.</p>${btn('Install or update the script')}${howTo}${linkLine}`; wireCopy();
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
        ? `<p style="margin:0 0 10px;">A newer version of the WWL script is available${r.latest ? ` (v${esc(r.latest)})` : ''}${r.version ? ` — you have v${esc(r.version)}` : ''}. Press the button; your script manager asks you to confirm, and your key and settings stay as they are.</p>${btn('Update the script')}${linkLine}`
        : `<p style="margin:0 0 10px;">${r.seen ? 'Your WWL script has not been seen for a while.' : 'Get your weekly plan, to-dos and targets right inside Torn.'} Press the button and your script manager asks you to confirm the install. Then open the small <b>WWL</b> button in Torn, press ⚙ and paste your API key.</p>${btn('Install the script')}${howTo}${linkLine}`;
    wireCopy();
}
