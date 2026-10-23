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
    if (s.owner) { recOwnerPanel(body); recFindPanel(body); }
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

// ---- Find players: the recruiting database (owner only for now). The factions of the respect Hall of Fame between two respect numbers, their members, and the stats of the best few of each faction ----
const recFmt = n => n === null || n === undefined ? '-' : Number(n).toLocaleString('en-US');
const recAgo = ts => { const s = Math.max(0, Date.now() / 1000 - ts); return s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} d`; };
async function recFindPanel(body) {
    const box = document.createElement('div');
    box.className = 'panel'; box.style.margin = '0 0 12px';
    const num = (id, label, val, w = 90) => `<label style="display:inline-flex;flex-direction:column;font-size:11px;color:var(--muted);gap:2px;">${label}<input id="${id}" type="number" value="${val}" style="width:${w}px;font-size:13px;"></label>`;
    box.innerHTML = `<b>Find players</b> <span style="font-size:12px;color:var(--muted);">(owner only: the factions of Torn's respect Hall of Fame, their members and the stats of the best few of each)</span>
        <div id="rdb-info" style="font-size:13px;color:var(--muted);margin:8px 0;">Loading…</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:6px;">
            ${num('rdb-minr', 'Faction respect from', 20000, 110)}${num('rdb-maxr', 'up to', 500000, 110)}
            <button type="button" id="rdb-build">Build the database</button>
            ${num('rdb-per', 'Stats for the best', 3, 60)}<button type="button" class="ghost" id="rdb-enrich">Read their stats</button>
            <button type="button" class="ghost" id="rdb-stop" style="display:none;">Stop</button>
            <span id="rdb-msg" style="font-size:12px;color:var(--muted);"></span>
        </div>
        <p style="font-size:12px;color:var(--muted);margin:0 0 10px;">Building reads the faction list and then every member list: a call per faction, about 90 a minute, so a few hundred factions take a few minutes and thousands take half an hour. You can leave this page open and do something else. Reading the stats is one call per player, in the same slow way, for the most recently online players of each faction (leaders left out).</p>
        <div id="rdb-filters" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;padding-top:10px;border-top:1px solid var(--line);">
            ${num('rdb-q-minr', 'Faction respect from', 20000, 100)}${num('rdb-q-maxr', 'up to', 500000, 100)}${num('rdb-q-minm', 'Members from', 0, 70)}${num('rdb-q-maxm', 'up to', 100, 70)}
            <label style="display:inline-flex;flex-direction:column;font-size:11px;color:var(--muted);gap:2px;">Online within<select id="rdb-q-hours" style="font-size:13px;width:auto;"><option value="1">1 hour</option><option value="6">6 hours</option><option value="24" selected>24 hours</option><option value="72">3 days</option><option value="168">7 days</option></select></label>
            ${num('rdb-q-minl', 'Level from', 0, 60)}${num('rdb-q-maxl', 'up to', 100, 60)}${num('rdb-q-mind', 'Days in faction from', 0, 80)}
            ${num('rdb-q-streak', 'Streak at least', 0, 80)}${num('rdb-q-war', 'War hits at least', 0, 80)}${num('rdb-q-xan', 'Xanax at least', 0, 80)}${num('rdb-q-work', 'Work stats at least', 0, 100)}
            <label style="display:inline-flex;flex-direction:column;font-size:11px;color:var(--muted);gap:2px;">Sort by<select id="rdb-q-sort" style="font-size:13px;width:auto;"><option value="score">Score (streak, war hits, xanax)</option><option value="streak">Streak</option><option value="war">War hits</option><option value="xanax">Xanax</option><option value="work">Work stats</option><option value="online">Last online</option><option value="level">Level</option><option value="respect">Faction respect</option></select></label>
            <label style="font-size:12px;display:inline-flex;gap:4px;align-items:center;"><input id="rdb-q-leaders" type="checkbox" checked style="width:auto;"> hide leaders</label>
            <label style="font-size:12px;display:inline-flex;gap:4px;align-items:center;"><input id="rdb-q-contacted" type="checkbox" checked style="width:auto;"> hide those I marked</label>
            <label style="font-size:12px;display:inline-flex;gap:4px;align-items:center;"><input id="rdb-q-stats" type="checkbox" checked style="width:auto;"> only with stats</label>
            <label style="font-size:12px;display:inline-flex;gap:4px;align-items:center;"><input id="rdb-q-one" type="checkbox" style="width:auto;"> best one per faction</label>
            <button type="button" id="rdb-search">Search</button>
        </div>
        <div style="margin:10px 0 4px;font-size:12px;color:var(--muted);">Your message (use {name}; kept in this browser): </div>
        <textarea id="rdb-tpl" rows="3" style="width:100%;font-size:13px;"></textarea>
        <div id="rdb-result" style="margin-top:10px;font-size:13px;color:var(--muted);"></div>`;
    body.appendChild(box);
    const $$ = id => document.getElementById(id), post = (action, extra) => recFetch(action, extra);
    try { $$('rdb-tpl').value = localStorage.getItem('wwl_rdb_tpl') || 'Hi {name}! Looking for a faction that actually talks, loves a good war and feels like family? That is CoreLabs.\n\nLots of Love\nCreaLotte <3'; } catch (e) { /* not saved */ }
    $$('rdb-tpl').addEventListener('input', () => { try { localStorage.setItem('wwl_rdb_tpl', $$('rdb-tpl').value); } catch (e) { /* not saved */ } });
    let running = false, stopFlag = false;
    const info = async () => {
        const r = await post('rec-db-info');
        if (r.error) { $$('rdb-info').textContent = r.error; return; }
        const st = r.state;
        $$('rdb-info').textContent = !st ? 'The database is empty: press "Build the database".'
            : `${r.factions} factions (respect ${recFmt(st.minR)} to ${recFmt(st.maxR)}), members read for ${recFmt(st.membersDone || 0)}${st.phase === 'done' ? ' (done)' : st.phase === 'members' ? ' (still reading)' : ' (reading the list)'}, stats read for ${recFmt(st.enriched || 0)} players in this round, ${recFmt(r.knownStats)} players with stats in total (including those the script read).${st.updatedAt ? ` Last step ${recAgo(st.updatedAt / 1000)} ago.` : ''}`;
    };
    const loop = async (mode, extra, label) => {
        if (running) return;
        running = true; stopFlag = false; $$('rdb-stop').style.display = ''; $$('rdb-build').disabled = $$('rdb-enrich').disabled = true;
        let first = true;
        try {
            for (;;) {
                const r = await post('rec-db-step', { mode, ...extra, start: first && extra.start });
                first = false;
                if (r.error) { $$('rdb-msg').textContent = r.error; break; }
                const st = r.state;
                $$('rdb-msg').textContent = mode === 'build'
                    ? (st.phase === 'list' ? `${label}: reading the faction list… ${st.factions} so far` : `${label}: members of ${recFmt(st.mi)} of ${recFmt(st.factions)} factions`)
                    : `${label}: ${recFmt(st.ei || 0)} of ${recFmt(r.total || 0)} factions, ${recFmt(st.enriched || 0)} players read`;
                if (r.done) { $$('rdb-msg').textContent = `${label}: done.`; break; }
                if (stopFlag) { $$('rdb-msg').textContent = `${label}: stopped, it continues where it was when you press the button again.`; break; }
                if (r.paused) await new Promise(res => setTimeout(res, 15000)); // Torn asked to slow down
            }
        } finally { running = false; $$('rdb-stop').style.display = 'none'; $$('rdb-build').disabled = $$('rdb-enrich').disabled = false; info(); }
    };
    $$('rdb-stop').addEventListener('click', () => { stopFlag = true; });
    $$('rdb-build').addEventListener('click', () => { if (!confirm('Build the database again? The faction list and the member lists are read from Torn from the start.')) return; loop('build', { start: true, minR: Number($$('rdb-minr').value), maxR: Number($$('rdb-maxr').value) }, 'Building'); });
    $$('rdb-enrich').addEventListener('click', () => loop('enrich', { start: true, perFaction: Number($$('rdb-per').value) || 3, onlineHours: 72 }, 'Reading stats'));
    const render = (r) => {
        const el = $$('rdb-result');
        if (r.error) { el.textContent = r.error; return; }
        const tpl = () => $$('rdb-tpl').value;
        el.innerHTML = `<div style="margin-bottom:6px;"><b style="color:var(--text);">${recFmt(r.total)}</b> players match (${recFmt(r.baseCount)} are online in the factions chosen, ${recFmt(r.factions)} factions). ${r.total > r.rows.length ? `The first ${r.rows.length} are shown.` : ''}</div>` +
            (r.rows.length ? `<div class="table-scroll resizable" style="height:480px;overflow:auto;"><table><thead><tr><th>Player</th><th>Faction</th><th class="num">Respect</th><th class="num">Level</th><th>Online</th><th class="num">Days</th><th class="num">Streak</th><th class="num">War hits</th><th class="num">Xanax</th><th class="num">Work stats</th><th class="num">Score</th><th></th></tr></thead><tbody>${r.rows.map(p => `<tr data-id="${recEsc(p.id)}"><td><a href="https://www.torn.com/profiles.php?XID=${recEsc(p.id)}" target="_blank" rel="noopener">${recEsc(p.name)}</a> <span style="color:var(--muted);font-size:11px;">${recEsc(p.pos)}</span></td><td>${recEsc(p.faction)} <span style="color:var(--muted);font-size:11px;">(${p.fmem})</span></td><td class="num">${recFmt(p.fresp)}</td><td class="num">${p.level}</td><td>${recAgo(p.last)}</td><td class="num">${p.days}</td><td class="num">${recFmt(p.streak)}</td><td class="num">${recFmt(p.war)}</td><td class="num">${recFmt(p.xan)}</td><td class="num">${recFmt(p.work)}</td><td class="num"><b>${p.score === null ? '-' : p.score}</b></td><td style="white-space:nowrap;"><button type="button" class="ghost small rdb-mail" data-i="${recEsc(p.id)}">Write</button> <button type="button" class="ghost small rdb-mark" data-i="${recEsc(p.id)}">Marked</button></td></tr>`).join('')}</tbody></table></div>` : '');
        const byId = Object.fromEntries(r.rows.map(p => [p.id, p]));
        el.querySelectorAll('.rdb-mail').forEach(b => b.addEventListener('click', () => { // the message is copied and Torn's mail page for that player opens: paste and send
            const p = byId[b.dataset.i], text = tpl().replace(/\{name\}/g, p.name);
            navigator.clipboard.writeText(text).then(() => toast('Message copied: paste it in the mail'), () => toast('Copy the message from the box above'));
            window.open(`https://www.torn.com/messages.php#/p=compose&XID=${p.id}`, '_blank', 'noopener');
        }));
        el.querySelectorAll('.rdb-mark').forEach(b => b.addEventListener('click', async () => { // F = first contact: the same yellow F as in the script
            const p = byId[b.dataset.i], res = await post('rec-save', { rows: [{ id: p.id, f: 1, name: p.name }] });
            if (res.error) { toast(res.error); return; }
            b.closest('tr').style.opacity = '.35'; b.disabled = true; toast(`${p.name} marked as contacted (yellow F)`);
        }));
    };
    $$('rdb-search').addEventListener('click', async () => {
        $$('rdb-result').textContent = 'Searching…';
        const v = id => $$(id).value;
        const r = await post('rec-db-query', { q: { minR: v('rdb-q-minr'), maxR: v('rdb-q-maxr'), minMembers: v('rdb-q-minm'), maxMembers: v('rdb-q-maxm'), onlineHours: v('rdb-q-hours'), minLevel: v('rdb-q-minl'), maxLevel: v('rdb-q-maxl'), minDays: v('rdb-q-mind'), minStreak: v('rdb-q-streak'), minWar: v('rdb-q-war'), minXanax: v('rdb-q-xan'), minWork: v('rdb-q-work'), sort: v('rdb-q-sort'), hideLeaders: $$('rdb-q-leaders').checked, hideContacted: $$('rdb-q-contacted').checked, onlyWithStats: $$('rdb-q-stats').checked, onePerFaction: $$('rdb-q-one').checked, limit: 150 } });
        render(r);
    });
    info();
}
