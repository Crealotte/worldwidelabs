// Bank requests (Faction menu) and the page the Discord Claim / Cancel buttons open. A member asks for money out of their OWN
// faction balance (never more than it); a banker claims the request and lands in Torn's vault screen with the member and the
// amount filled in — WWL pays nothing itself. Backend: bank-* in api/war-payout.js.
'use strict';

const bankParams = new URLSearchParams(window.location.search); // read now: the claim link carries ?id=...&cancel=1
async function bankFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    return res.json();
}
const bankMoney = n => `$${Math.round(n).toLocaleString('en-US')}`;
const bankAgo = ts => { const m = Math.max(0, Math.round((Date.now() - ts) / 60000)); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
let bankBalance = null;

async function loadBank() {
    const st = $('bank-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    try {
        const r = await bankFetch({ action: 'bank-info' });
        if (r.error) throw new Error(r.error);
        bankBalance = r.balance; bankLoadedAt = Date.now();
        $('bank-balance').innerHTML = r.balance !== null
            ? `Your faction balance: <b style="font-family:var(--mono);">${bankMoney(r.balance)}</b>`
            : `<span style="color:var(--danger);">${esc(r.balanceError || 'Your balance could not be read.')}</span>`;
        $('bank-amount').max = r.balance ?? '';
        $('bank-send').disabled = r.balance === null;
        $('bank-all').disabled = r.balance === null;
        renderBankMine(r.request);
        const leader = typeof isLeaderCached !== 'undefined' && isLeaderCached && !(typeof memberView !== 'undefined' && memberView);
        $('bank-leader-panel').style.display = leader ? 'block' : 'none';
        if (leader) {
            bankEnsureCookie();
            const l = await bankFetch({ action: 'bank-list' });
            if (l.error) throw new Error(l.error);
            renderBankList(l.requests);
        }
        st.textContent = ''; st.className = 'status';
    } catch (e) { st.className = 'status err'; st.textContent = e.message; }
}

function renderBankMine(req) {
    $('bank-mine').innerHTML = req
        ? `<p style="margin:0 0 8px;">✅ Open request: <b style="font-family:var(--mono);">${bankMoney(req.amount)}</b> <span style="color:var(--muted);font-size:12px;">(asked ${bankAgo(req.at)}${req.posted ? ', posted to Discord' : ''})</span></p><button class="ghost small" id="bank-cancel">Cancel my request</button>`
        : '<p style="color:var(--muted);margin:0;">You have no open request.</p>';
    $('bank-cancel')?.addEventListener('click', async () => {
        const r = await bankFetch({ action: 'bank-cancel', id: req.id });
        if (r.error) { toast(r.error); return; }
        loadBank();
    });
}

function renderBankList(list) {
    $('bank-list').innerHTML = list.length
        ? `<table style="width:100%;font-size:13px;border-collapse:collapse;"><thead><tr style="color:var(--muted);text-align:left;"><th style="padding:4px 8px;">Member</th><th style="padding:4px 8px;">Amount</th><th style="padding:4px 8px;">Balance</th><th style="padding:4px 8px;">Asked</th><th style="padding:4px 8px;">Status</th><th></th></tr></thead>
           <tbody>${list.map(r => `<tr style="border-top:1px solid var(--line);">
               <td style="padding:4px 8px;"><a href="https://www.torn.com/profiles.php?XID=${esc(r.playerId)}" target="_blank" rel="noopener" style="color:var(--text);">${esc(r.name)}</a></td>
               <td style="padding:4px 8px;font-family:var(--mono);font-weight:700;">${bankMoney(r.amount)}</td>
               <td style="padding:4px 8px;font-family:var(--mono);color:var(--muted);">${bankMoney(r.balance)}</td>
               <td style="padding:4px 8px;color:var(--muted);">${bankAgo(r.at)}</td>
               <td style="padding:4px 8px;">${r.status === 'completed' ? `<span style="color:var(--reagent);">✅ paid out by ${esc(r.completedBy || '?')}</span>` : r.status === 'claimed' ? `<span style="color:var(--happy);">⏳ claimed by ${esc(r.claimedBy || '?')}</span>` : 'open'}</td>
               <td style="padding:4px 8px;text-align:right;white-space:nowrap;">${r.status === 'open' ? `<a href="/bank-claim?id=${esc(r.id)}" target="_blank" rel="noopener"><button class="small" type="button">Claim</button></a> <button class="ghost small bank-cancel-row" data-id="${esc(r.id)}">Cancel</button>` : r.status === 'claimed' ? `<button class="small bank-done-row" data-id="${esc(r.id)}" type="button">Mark paid</button>` : ''}</td></tr>`).join('')}</tbody></table>`
        : '<p style="color:var(--muted);margin:0;">No open requests.</p>';
    $('bank-list').querySelectorAll('.bank-done-row').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true;
        const r = await bankFetch({ action: 'bank-done', id: b.dataset.id });
        if (r.error) { toast(r.error); b.disabled = false; return; }
        loadBank();
    }));
    $('bank-list').querySelectorAll('.bank-cancel-row').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Cancel this request?')) return;
        const r = await bankFetch({ action: 'bank-cancel', id: b.dataset.id });
        if (r.error) { toast(r.error); return; }
        loadBank();
    }));
}

$('bank-all').addEventListener('click', () => { if (bankBalance !== null) $('bank-amount').value = bankBalance; });
$('bank-send').addEventListener('click', async () => {
    const btn = $('bank-send');
    btn.disabled = true;
    try {
        const r = await bankFetch({ action: 'bank-submit', amount: $('bank-amount').value });
        if (r.error) throw new Error(r.error);
        $('bank-amount').value = '';
        toast('Request sent');
        loadBank();
    } catch (e) { toast(e.message); } finally { btn.disabled = false; }
});

// The page the Discord buttons open: /bank-claim?id=...  claims the request and sends the banker on to Torn's vault screen with
// the member and amount filled in; /bank-claim?id=...&cancel=1 cancels it. Needs the person's own WWL login (the banker's).
async function loadBankClaim() {
    const out = $('bc-body'), id = bankParams.get('id');
    await bankEnsureCookie(); // so the next Claim click goes straight to Torn
    if (!id) { out.innerHTML = '<p>This page needs a request link from the Discord message, or open it from <b>Faction, Bank request</b>.</p>'; return; }
    out.innerHTML = '<p style="color:var(--muted);">Working on it…</p>';
    try {
        if (bankParams.get('done')) { // the "Mark paid" button on the Discord message, for someone without the banker cookie yet
            const r = await bankFetch({ action: 'bank-done', id });
            if (r.error) throw new Error(r.error);
            out.innerHTML = `<p>✅ ${r.already ? 'This request was already marked as paid.' : 'Marked as paid.'} Thank you!</p>`;
            return;
        }
        if (bankParams.get('cancel')) {
            const r = await bankFetch({ action: 'bank-cancel', id });
            if (r.error) throw new Error(r.error);
            out.innerHTML = `<p>❌ The request${r.name ? ` from <b>${esc(r.name)}</b>` : ''} has been cancelled.</p>`;
            return;
        }
        const r = await bankFetch({ action: 'bank-claim', id });
        if (r.error) throw new Error(r.error);
        out.innerHTML = `<p>✅ <b>${esc(r.request.name)}</b> asked for <b style="font-family:var(--mono);">${bankMoney(r.request.amount)}</b>. It is yours now. Taking you to Torn…</p>${r.lowered ? `<p style="color:var(--happy);font-weight:700;">⚠ Their balance is now only ${bankMoney(r.liveBalance)}, so the amount in the vault link was lowered to ${bankMoney(r.pay)}.</p>` : ""}
            <p style="font-size:13px;color:var(--muted);">Check the member and the amount in the vault screen, then confirm the payout there. If nothing happens: <a href="${esc(r.link)}">open the vault screen</a>.</p>`;
        setTimeout(() => { window.location.href = r.link; }, r.lowered ? 4000 : 0); // straight on to Torn, unless the amount was lowered and needs reading
    } catch (e) { out.innerHTML = `<p style="color:var(--danger);">${esc(e.message)}</p>`; }
}

// The balance is read live from Torn each time (never from a cache). It is re-read when you press Refresh and whenever you come back
// to this tab (at most every 15 seconds) — not on a timer, which would cost the database a request for every open page.
let bankLoadedAt = 0;
$('bank-refresh').addEventListener('click', () => loadBank());
document.addEventListener('visibilitychange', () => {
    if (document.hidden || !$('page-bank').classList.contains('visible') || Date.now() - bankLoadedAt < 15000) return;
    loadBank();
});

// Bankers get a signed cookie (once per browser session is enough, it lasts 30 days) so the Discord Claim button can send them
// straight to Torn's vault screen with no WWL page in between. Only people with faction API access are given one.
async function bankEnsureCookie() {
    try {
        if (sessionStorage.getItem('wwl_bank_cookie')) return;
        const r = await bankFetch({ action: 'bank-token' });
        if (r.ok) sessionStorage.setItem('wwl_bank_cookie', '1');
    } catch (e) { /* not a banker, or offline: the Claim button just goes through the WWL page */ }
}
