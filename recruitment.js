// ---- Recruiting: the CoreLabs Recruiter script, installed from WWL, with its own subscription (separate from the Ledger VIP) ----
// The subscription is checked only when the member presses the button, never on a schedule (lib/recruit.js and lib/license.js, product REC).
let recBusy = false;
const recEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function recFetch(action, extra) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, action, ...(extra || {}) }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}
function recStatusHtml(s) {
    if (s.error) return `<div class="status err">${recEsc(s.error)}</div>`;
    const until = s.until ? new Date(s.until).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    const state = s.paid
        ? `<div style="color:var(--green,#51cf66);font-weight:700;">Active${s.owner ? ' (owner)' : s.free ? ` (free for a ${recEsc(s.free)})` : until ? ` until ${until}` : ''}: all recruiting features are unlocked.</div>`
        : `<div style="color:#ff8080;font-weight:700;">Not active yet: the F / C / S buttons are locked.</div>`;
    const how = s.owner || s.free ? '' : `<div style="font-size:13px;color:var(--muted);margin-top:8px;line-height:1.6;">Price: <b>${recEsc(s.xanax)} Xanax = ${recEsc(s.days)} days</b>. Send <b>${recEsc(s.xanax)} Xanax</b> to <a href="https://www.torn.com/profiles.php?XID=${recEsc(s.ownerId)}" target="_blank" rel="noopener">CreaLotte [${recEsc(s.ownerId)}]</a> with exactly this message (your own, nothing added):
        <div style="margin:6px 0;"><code id="rec-msg" style="background:var(--bg,#000);padding:3px 8px;border-radius:4px;">${recEsc(s.code)}</code> <a href="#" id="rec-copy" style="font-size:12px;">copy</a></div>
        Then press <b>Check my payment</b>: it looks at the Xanax received right away (if it still says not active, wait half a minute and press it again).</div>`;
    if (s.owner || s.free) return `${state}`;
    return `${state}${how}<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;"><button type="button" id="rec-check">Check my payment</button><span id="rec-check-msg" style="font-size:12px;color:var(--muted);"></span></div>`;
}
function recWire(s) {
    const copy = $('rec-copy');
    if (copy) copy.addEventListener('click', e => { e.preventDefault(); const t = $('rec-msg').textContent; navigator.clipboard.writeText(t).then(() => toast('Message copied'), () => toast(`Copy this message: ${t}`)); });
    const check = $('rec-check');
    if (check) check.addEventListener('click', async () => {
        if (recBusy) return;
        recBusy = true; check.disabled = true; $('rec-check-msg').textContent = 'Checking…';
        const r = await recFetch('rec-check');
        recBusy = false;
        if (r.error) { check.disabled = false; $('rec-check-msg').textContent = r.error; return; }
        const next = await recFetch('rec-license');
        $('rec-sub').innerHTML = recStatusHtml(next); recWire(next);
        const msg = $('rec-check-msg');
        if (next.paid && r.granted) msg.textContent = `${r.granted} days added.`;
        else if (!next.paid) msg.textContent = r.message || (r.wait ? 'Checked a moment ago: wait half a minute and press again.' : 'Not found yet: check the message and try again in a moment.');
    });
}
async function loadRecruitment() {
    const body = $('rec-body');
    if (!body) return;
    if (!apiKey) { body.innerHTML = '<div class="status err">Log in first.</div>'; return; }
    body.innerHTML = `<div class="panel" style="margin:0 0 12px;"><div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between;"><div style="flex:1;min-width:240px;"><b>The CoreLabs Recruiter script for Torn</b>
        <div style="font-size:13px;color:var(--muted);margin-top:2px;">Shows each player's xanax, war hits, activity streak and work stats on Torn's user list, with F / C / S / U buttons to track who you contacted, notes, follow-ups and filters. It updates by itself.</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;"><a href="/crm.user.js" target="_blank" rel="noopener" style="text-decoration:none;"><button type="button">Install the Recruiter script</button></a><a href="#" id="rec-script-copy" style="font-size:12px;">copy the link</a></div></div>
        <div style="font-size:12px;color:var(--muted);margin-top:6px;">On a computer you need <b>Tampermonkey</b> (or a similar script manager) first. The script asks for your Torn API key once; it only reads public player information.</div></div>
        <div class="panel" style="margin:0 0 12px;"><b>Subscription</b> <span style="font-size:12px;color:var(--muted);">(separate from the Ledger VIP)</span><div id="rec-sub" style="margin-top:8px;">Loading…</div></div>`;
    const sc = $('rec-script-copy');
    if (sc) sc.addEventListener('click', e => { e.preventDefault(); navigator.clipboard.writeText(`${location.origin}/crm.user.js`).then(() => toast('Script link copied'), () => toast(`Copy this link: ${location.origin}/crm.user.js`)); });
    let s = await recFetch('rec-license');
    if (!s.error && !s.paid && !s.owner && !s.code) { const sub = await recFetch('rec-subscribe'); if (sub.code) s = { ...s, code: sub.code }; } // the personal message is made the first time
    $('rec-sub').innerHTML = recStatusHtml(s);
    recWire(s);
    if (s.owner) recOwnerPanel(body);
}
// the owner sees who has a paid subscription (people with free access as a director or leader are not in this list: they are worked out when they open the script)
async function recOwnerPanel(body) {
    const box = document.createElement('div');
    box.className = 'panel'; box.style.margin = '0 0 12px';
    box.innerHTML = '<b>Subscribers</b> <span style="font-size:12px;color:var(--muted);">(owner only: players who paid Xanax, and below them everybody with free access)</span><div id="rec-subs-list" style="margin-top:8px;font-size:13px;color:var(--muted);">Loading…</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px;font-size:13px;">Give days: <input id="rec-grant-id" placeholder="Torn ID" style="width:110px;"> <input id="rec-grant-days" type="number" min="1" max="365" value="7" style="width:80px;"> <button type="button" class="ghost small" id="rec-grant-go">Give</button> <span id="rec-grant-msg" style="color:var(--muted);"></span></div>';
    body.appendChild(box);
    const load = async () => {
        const r = await recFetch('rec-owner-list');
        const el = $('rec-subs-list');
        if (r.error) { el.textContent = r.error; return; }
        const now = Date.now(), act = r.licenses.filter(l => l.until > now);
        const day = ms => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
        const fr = r.free || [];
        const freeHtml = `<div style="margin:14px 0 6px;"><b style="color:var(--text);">${fr.length}</b> with free access <span style="font-size:12px;">(company directors, and faction leaders and co-leaders once they have opened the script or this page)</span></div>` + (fr.length ? `<div class="table-scroll resizable" style="height:260px;overflow:auto;"><table><thead><tr><th>Player</th><th>Torn ID</th><th>Why</th><th>Company</th><th>Last seen</th></tr></thead><tbody>${fr.map(l => `<tr><td>${l.name ? recEsc(l.name) : '<span style="color:var(--muted);">unknown</span>'}</td><td><a href="https://www.torn.com/profiles.php?XID=${recEsc(l.tornId)}" target="_blank" rel="noopener">${recEsc(l.tornId)}</a></td><td>${recEsc(l.reason)}</td><td>${recEsc((l.companies || []).join(', '))}</td><td>${l.seenAt ? day(l.seenAt) : ''}</td></tr>`).join('')}</tbody></table></div>` : '');
        el.innerHTML = `<div style="margin-bottom:6px;"><b style="color:var(--text);">${act.length}</b> active, ${r.licenses.length - act.length} ended</div>` + (r.licenses.length ? `<div class="table-scroll resizable" style="height:260px;overflow:auto;"><table><thead><tr><th>Player</th><th>Torn ID</th><th>Status</th><th>Until</th></tr></thead><tbody>${r.licenses.map(l => `<tr><td>${l.name ? recEsc(l.name) : '<span style="color:var(--muted);">unknown</span>'}</td><td><a href="https://www.torn.com/profiles.php?XID=${recEsc(l.tornId)}" target="_blank" rel="noopener">${recEsc(l.tornId)}</a></td><td style="color:${l.until > now ? 'var(--reagent)' : 'var(--muted)'};">${l.until > now ? 'active' : 'ended'}</td><td>${l.until ? day(l.until) : ''}</td></tr>`).join('')}</tbody></table></div>` : 'Nobody has paid yet.') + freeHtml;
    };
    load();
    $('rec-grant-go').addEventListener('click', async () => {
        const id = $('rec-grant-id').value.trim(), days = Number($('rec-grant-days').value), msg = $('rec-grant-msg');
        if (!/^[0-9]+$/.test(id)) { msg.textContent = 'Write a Torn ID (numbers only).'; return; }
        if (!confirm(`Give ${days} day${days === 1 ? '' : 's'} of the Recruiter script to Torn ID ${id}?`)) return;
        msg.textContent = 'Saving…';
        const r = await recFetch('rec-owner-grant', { tornId: id, days });
        msg.textContent = r.error ? r.error : 'Done.';
        if (!r.error) { $('rec-grant-id').value = ''; load(); }
    });
}
