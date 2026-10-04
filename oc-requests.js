// OC requests (Crimes menu). A member who sees no Organized Crime that suits them asks for one at a level instead of
// everyone spawning crimes; leaders and council see the open requests here (and in their To do list, and in a Discord
// channel if one is set for it) and close each once it is spawned. Backend: ocreq-* in api/war-payout.js.
'use strict';

async function ocFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    return res.json();
}
const ocAgo = ts => { const m = Math.max(0, Math.round((Date.now() - ts) / 60000)); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

async function loadOcRequests() {
    const st = $('ocr-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    try {
        const mine = await ocFetch({ action: 'ocreq-my' });
        if (mine.error) throw new Error(mine.error);
        renderOcMine(mine.request);
        const leader = typeof isLeaderCached !== 'undefined' && isLeaderCached && !(typeof memberView !== 'undefined' && memberView);
        $('ocr-leader-panel').style.display = leader ? 'block' : 'none';
        if (leader) {
            const l = await ocFetch({ action: 'ocreq-list' });
            if (l.error) throw new Error(l.error);
            renderOcList(l.requests);
        }
        st.textContent = ''; st.className = 'status';
    } catch (e) { st.className = 'status err'; st.textContent = e.message; }
}

function renderOcMine(req) {
    $('ocr-mine').innerHTML = req
        ? `<p style="margin:0 0 8px;">✅ Your request is open: a <b>level ${req.level}</b> OC${req.note ? ` — “${esc(req.note)}”` : ''} <span style="color:var(--muted);font-size:12px;">(asked ${ocAgo(req.at)})</span></p>
           <button class="ghost small" id="ocr-cancel">Cancel my request</button>`
        : '<p style="color:var(--muted);margin:0;">You have no open request.</p>';
    $('ocr-cancel')?.addEventListener('click', async () => {
        const r = await ocFetch({ action: 'ocreq-cancel' });
        if (r.error) { toast(r.error); return; }
        renderOcMine(null);
    });
}

function renderOcList(list) {
    $('ocr-list').innerHTML = list.length
        ? `<table style="width:100%;font-size:13px;border-collapse:collapse;"><thead><tr style="color:var(--muted);text-align:left;"><th style="padding:4px 8px;">Member</th><th style="padding:4px 8px;">Level</th><th style="padding:4px 8px;">Note</th><th style="padding:4px 8px;">Asked</th><th></th></tr></thead>
           <tbody>${list.map(r => `<tr style="border-top:1px solid var(--line);">
               <td style="padding:4px 8px;"><a href="https://www.torn.com/profiles.php?XID=${esc(r.id)}" target="_blank" rel="noopener" style="color:var(--text);">${esc(r.name)}</a></td>
               <td style="padding:4px 8px;font-family:var(--mono);font-weight:700;">${r.level}</td>
               <td style="padding:4px 8px;color:var(--muted);">${esc(r.note || '')}</td>
               <td style="padding:4px 8px;color:var(--muted);">${ocAgo(r.at)}</td>
               <td style="padding:4px 8px;text-align:right;"><button class="small ocr-done" data-id="${esc(r.id)}">Done</button></td></tr>`).join('')}</tbody></table>`
        : '<p style="color:var(--muted);margin:0;">No open requests.</p>';
    $('ocr-list').querySelectorAll('.ocr-done').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true;
        const r = await ocFetch({ action: 'ocreq-done', id: b.dataset.id });
        if (r.error) { toast(r.error); b.disabled = false; return; }
        loadOcRequests();
    }));
}

$('ocr-send').addEventListener('click', async () => {
    const btn = $('ocr-send');
    btn.disabled = true;
    try {
        const r = await ocFetch({ action: 'ocreq-submit', level: $('ocr-level').value, note: $('ocr-note').value });
        if (r.error) throw new Error(r.error);
        $('ocr-note').value = '';
        toast('Request sent — leadership has been told');
        renderOcMine(r.request);
        if (!$('ocr-leader-panel').style.display || $('ocr-leader-panel').style.display !== 'none') loadOcRequests();
    } catch (e) { toast(e.message); } finally { btn.disabled = false; }
});
