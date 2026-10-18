// ---- Recruitment: the CoreLabs recruiter script, installed from WWL, with its own subscription (separate from the Ledger VIP) ----
// The page talks straight to the recruiting gateway (Supabase) from the member's browser, so it costs WWL's server and Redis nothing.
// The subscription is checked only when the member presses the button, never on a schedule.
const REC_GATEWAY = 'https://yweufoxazgfmnqndcgmk.supabase.co/functions/v1/gateway';
let recBusy = false;
const recEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function recGateway(op, table, extra) {
    const res = await fetch(REC_GATEWAY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey, op, table: table || undefined, ...(extra || {}) }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}
function recStatusHtml(who, settings) {
    if (who.error) return `<div class="status err">The recruiting service says: ${recEsc(who.error)}</div>`;
    const xp = settings && settings.xanax_per_period != null ? settings.xanax_per_period : 1, dp = settings && settings.days_per_period != null ? settings.days_per_period : 7, tag = settings && settings.payment_tag ? settings.payment_tag : 'CRM';
    const until = who.paid_until && who.paid_until !== 'infinity' ? new Date(who.paid_until).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    const state = who.paid
        ? `<div style="color:var(--green,#51cf66);font-weight:700;">✓ Active${who.is_admin ? ' (owner)' : until ? ` until ${until}` : ''}: all recruiting features are unlocked.</div>`
        : `<div style="color:#ff8080;font-weight:700;">✗ Not active yet: the F / C / S buttons are locked.</div>`;
    const how = who.paid && who.is_admin ? '' : `<div style="font-size:13px;color:var(--muted);margin-top:8px;line-height:1.6;">Price: <b>${recEsc(xp)} Xanax = ${recEsc(dp)} days</b>. Send <b>${recEsc(xp)} Xanax</b> to <a href="https://www.torn.com/profiles.php?XID=2645743" target="_blank" rel="noopener">CreaLotte [2645743]</a> with exactly this message:
        <div style="margin:6px 0;"><code id="rec-msg" style="background:var(--bg,#000);padding:3px 8px;border-radius:4px;">${recEsc(who.torn_id)} ${recEsc(tag)}</code> <a href="#" id="rec-copy" style="font-size:12px;">copy</a></div>
        Your ID and the tag must both be in the message or it is not counted. Then press <b>Check my payment</b>: it looks at the Xanax received right away (if it still says not active, wait half a minute and press it again).</div>`;
    return `${state}${how}<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;"><button type="button" id="rec-check">↻ Check my payment</button><span id="rec-check-msg" style="font-size:12px;color:var(--muted);"></span></div>`;
}
function recWire(who, settings) {
    const copy = $('rec-copy');
    if (copy) copy.addEventListener('click', e => { e.preventDefault(); const t = $('rec-msg').textContent; navigator.clipboard.writeText(t).then(() => toast('Message copied'), () => toast(`Copy this message: ${t}`)); });
    const check = $('rec-check');
    if (check) check.addEventListener('click', async () => {
        if (recBusy) return;
        recBusy = true; check.disabled = true; $('rec-check-msg').textContent = 'Checking…';
        const r = await recGateway('check-payment');
        recBusy = false;
        if (r.error) { check.disabled = false; $('rec-check-msg').textContent = r.error; return; }
        const lic = r.license || {};
        const paidNow = lic.is_admin || lic.paid_until === 'infinity' || (lic.paid_until && new Date(lic.paid_until).getTime() > Date.now());
        who = { ...who, paid: !!paidNow, paid_until: lic.paid_until, is_admin: !!lic.is_admin, status: lic.status };
        $('rec-sub').innerHTML = recStatusHtml(who, settings); recWire(who, settings);
        if (!paidNow) $('rec-check-msg').textContent = r.wait ? 'Someone just checked: wait half a minute and press again.' : 'Not found yet: check the message and try again in a moment.';
    });
}
async function loadRecruitment() {
    const body = $('rec-body');
    if (!body) return;
    if (!apiKey) { body.innerHTML = '<div class="status err">Log in first.</div>'; return; }
    body.innerHTML = `<div class="panel" style="margin:0 0 12px;"><div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between;"><div style="flex:1;min-width:240px;"><b>📲 The CoreLabs Recruiter script for Torn</b>
        <div style="font-size:13px;color:var(--muted);margin-top:2px;">Shows each player's xanax, war hits, activity streak and work stats on Torn's user list, with F / C / S / U buttons to track who you contacted, notes, follow-ups and filters. It updates by itself.</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;"><a href="/crm.user.js" target="_blank" rel="noopener" style="text-decoration:none;"><button type="button">Install the Recruiter script</button></a><a href="#" id="rec-script-copy" style="font-size:12px;">copy the link</a></div></div>
        <div style="font-size:12px;color:var(--muted);margin-top:6px;">On a computer you need <b>Tampermonkey</b> (or a similar script manager) first. The script asks for your Torn API key once; it only reads public player information.</div></div>
        <div class="panel" style="margin:0 0 12px;"><b>Subscription</b> <span style="font-size:12px;color:var(--muted);">(separate from the Ledger VIP)</span><div id="rec-sub" style="margin-top:8px;">Loading…</div></div>`;
    const sc = $('rec-script-copy');
    if (sc) sc.addEventListener('click', e => { e.preventDefault(); navigator.clipboard.writeText(`${location.origin}/crm.user.js`).then(() => toast('Script link copied'), () => toast(`Copy this link: ${location.origin}/crm.user.js`)); });
    const [who, st] = await Promise.all([recGateway('whoami'), recGateway('select', 'app_settings', { query: 'id=eq.1&select=*' })]);
    const settings = Array.isArray(st) ? st[0] : null;
    $('rec-sub').innerHTML = recStatusHtml(who, settings);
    recWire(who, settings);
}
