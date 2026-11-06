// join.js — "Labs services": the page for people who have nothing with Labs yet (and for everybody else who is curious): the three programs, how each one works, its terms, and a request form per program.
// A person who is not in an allowed faction and has no Labs role lands here and nowhere else (login() in core.js calls enterJoinMode). The requests go to the owner's "Join requests" page (and To do);
// the server side is lib/joinlabs.js. Nothing here pays or changes money: a request is only a request.
'use strict';

let joinData = null, joinReqs = null;
async function joinFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}
// somebody with nothing to do with Labs yet: WWL is just this page
function enterJoinMode() {
    document.querySelectorAll('nav.side .nav-item, nav.side .nav-group').forEach(el => { el.style.display = 'none'; });
    const el = document.querySelector('.nav-item[data-page="join"]'); if (el) el.style.display = '';
    if (typeof showTradingNav === 'function') showTradingNav(); // Pricelist and Receipts & ledger are free for everybody
    goToPage('join');
}

const JOIN_PROGRAM_NAME = { invest: 'Investment fund', rent: 'Rent-to-own', buddy: 'Buddy banking', trading: 'Trading funding' };
async function loadJoin() {
    const st = $('join-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    try {
        // the page uses helpers from finances.js and terms.js: if one of those files did not load (an old copy kept by the browser), say so instead of staying blank
        if (typeof finRoi !== 'function' || typeof FIN_TIER_NAMES === 'undefined' || typeof termsHtml !== 'function') throw new Error('part of WWL did not load');
        const r = await joinFetch({ action: 'join-info' });
        if (r.error) { st.className = 'status err'; st.textContent = r.error; return; }
        st.textContent = ''; st.className = 'status';
        joinData = r;
        joinRender();
    } catch (e) { st.className = 'status err'; st.textContent = `This page could not load (${e.message}). Reload the page; if you use TornPDA or a phone browser, clear the site data or close and reopen it. If it still fails, send a bug report from the Bugs and suggestions page.`; }
}
function joinRender() {
    const r = joinData, m = n => finMoney(n);
    const mine = r.mine.slice().reverse();
    const reqText = q => q.program === 'invest' ? `an investment of ${m(q.details.amount)} (${q.details.mode === 'weekly' ? 'weekly' : 'monthly'} payouts)` : q.program === 'rent' ? `a ${q.details.happy} happy private island` : q.program === 'trading' ? `a trading funding of ${m(q.details.amount)}` : 'Buddy banking (Bronze)';
    const statusText = q => q.status === 'open' ? '<span style="color:#e0a030;">waiting for the owner</span>' : q.status === 'approved' ? '<span style="color:var(--success,#35d99b);">approved: the owner will contact you on Torn</span>' : '<span style="color:var(--muted);">not now</span>';
    const tierRows = FIN_TIER_NAMES.map(t => { const wk = finRoi(t[0], r.roi); return `<tr><td style="padding:2px 12px 2px 0;">${t[2]} <b>${t[1]}</b></td><td style="padding:2px 12px 2px 0;font-family:var(--mono);">from ${m(t[0])}</td><td style="padding:2px 12px 2px 0;font-family:var(--mono);">${m(wk)} a week</td><td style="padding:2px 0;color:var(--muted);font-size:12px;">${(wk * 52 / t[0] * 100).toFixed(1)}% a year</td></tr>`; }).join('');
    const rentRows = [2600, 3600, 4100].map((h, i) => { const x = r.rent[h]; return `<label style="display:flex;gap:10px;align-items:flex-start;padding:6px 0;border-top:1px solid var(--line);cursor:pointer;"><input type="radio" name="join-happy" value="${h}" style="width:auto;margin-top:3px;" ${i === 0 ? 'checked' : ''}><span><b>${h} happy private island</b><br><span style="font-size:12px;color:var(--muted);">price ${m(x.price)} · every 30 days ${m(x.rent)} rent + ${m(x.equity)} equity towards the price · about ${Math.ceil(x.price / x.equity)} months until it is yours</span></span></label>`; }).join('');
    const has = p => mine.some(q => q.program === p && q.status === 'open');
    const terms = (id, title) => `<details style="margin-top:8px;"><summary class="av-sum"><b>📜 ${esc(title)}</b> <span style="font-size:12px;color:var(--muted);">(read the terms)</span></summary><div style="margin-top:6px;">${termsHtml(id)}</div></details>`;
    const accept = id => `<label style="display:flex;gap:8px;align-items:center;margin-top:10px;font-size:13px;cursor:pointer;"><input type="checkbox" id="join-${id}-ok" style="width:auto;"> I have read the terms of this program and I accept them</label>`;
    const send = (id, label) => `<button type="button" id="join-${id}-send" style="margin-top:10px;" ${has(id) ? 'disabled' : ''}>${has(id) ? 'You already asked: waiting for the owner' : label}</button>`;
    $('join-body').innerHTML = `
        <div class="panel" style="font-size:13px;line-height:1.6;">Welcome${r.name ? `, <b>${esc(r.name)}</b>` : ''}! Labs runs four programs. Pick the one that suits you, read how it works, accept its terms and send a request. The owner answers you on Torn: nothing is paid or promised until then, and never send money before you are told how.</div>
        <div class="panel"><h3 style="margin-top:0;">📈 Investment fund</h3>
            <p style="font-size:13px;margin:0 0 8px;">You invest an amount of money for a term of 180 days and are paid every week (every Sunday) or every month (the last Sunday of the month, the weeks added up). What you are paid depends on your total: a bigger total is a higher tier with a higher rate. You can add money later in small steps, and a deposit renews by itself for another 180 days unless you give 30 days notice.</p>
            <table style="border-collapse:collapse;font-size:13px;margin-bottom:8px;">${tierRows}</table>
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;"><input id="join-inv-amt" type="text" inputmode="decimal" placeholder="Amount (100m, 250m, 1b)" style="width:190px;"><select id="join-inv-mode"><option value="monthly">Paid monthly (last Sunday of the month)</option><option value="weekly">Paid weekly (every Sunday)</option></select></div>
            <div id="join-inv-prev" style="font-size:13px;margin-top:6px;color:var(--muted);">Type an amount: from 100m, in steps of 25m up to 250m, 50m up to 500m, 100m up to 1b and 250m after that.</div>
            ${terms('invest', TERMS.invest.title)}${accept('inv')}${send('inv', 'Send my investment request')}</div>
        <div class="panel"><h3 style="margin-top:0;">🏝️ Rent-to-own (private islands)</h3>
            <p style="font-size:13px;margin:0 0 6px;">You rent a private island in 30-day cycles. Part of every payment is equity that counts towards the price: when the equity reaches the price, the island is yours. Pick the island you would like:</p>
            ${rentRows}
            ${terms('property', TERMS.property.title)}${accept('rent')}${send('rent', 'Send my rent-to-own request')}</div>
        <div class="panel"><h3 style="margin-top:0;">🤝 Buddy banking</h3>
            <p style="font-size:13px;margin:0 0 6px;">The owner puts up the cash, you invest it in your own City Bank and earn the interest. When the term ends you keep 30% of the profit and send back the amount plus 70% of the profit. Everyone starts at Bronze: ${m(r.buddy.amount)} for ${r.buddy.days} days.</p>
            ${terms('buddy', TERMS.buddy.title)}${accept('buddy')}${send('buddy', 'Send my buddy banking request')}</div>
        <div class="panel"><h3 style="margin-top:0;">📊 Trading funding</h3>
            <p style="font-size:13px;margin:0 0 6px;">For traders: the owner puts up capital for you to trade with, and you pay a fee for it. Sending a request does <b>not</b> mean you get a funding. The owner only grants a Trading funding to people she trusts, or to people somebody she trusts can vouch for. Tell her what you want to trade and who knows you.</p>
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;"><input id="join-trd-amt" type="text" inputmode="decimal" placeholder="Amount (100m, 500m, 1b)" style="width:190px;"></div>
            <div class="field" style="margin:8px 0 0;"><label for="join-trd-plan">What will you trade? (items, markets, where your profit comes from)</label><textarea id="join-trd-plan" rows="2" maxlength="300" style="width:100%;box-sizing:border-box;"></textarea></div>
            <div class="field" style="margin:8px 0 0;"><label for="join-trd-vouch">Who can vouch for you? (a name or Torn ID of somebody the owner knows)</label><input id="join-trd-vouch" type="text" maxlength="80"></div>
            <div class="field" style="margin:8px 0 0;"><label for="join-trd-exp">Your trading experience (optional)</label><textarea id="join-trd-exp" rows="2" maxlength="300" style="width:100%;box-sizing:border-box;"></textarea></div>
            <label style="display:flex;gap:8px;align-items:center;margin-top:10px;font-size:13px;cursor:pointer;"><input type="checkbox" id="join-trd-ok" style="width:auto;"> I understand that this is only a request: the owner decides, and the terms are agreed with me personally if she grants it</label>
            <button type="button" id="join-trd-send" style="margin-top:10px;" ${has('trading') ? 'disabled' : ''}>${has('trading') ? 'You already asked: waiting for the owner' : 'Send my trading funding request'}</button></div>
        ${mine.length ? `<div class="panel"><h3 style="margin-top:0;">Your requests</h3>${mine.map(q => `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:5px 0;border-top:1px solid var(--line);font-size:13px;"><span style="flex:1;min-width:220px;"><b>${JOIN_PROGRAM_NAME[q.program]}</b>: ${reqText(q)}, asked ${esc(finDate(q.createdOn))}</span>${statusText(q)}${q.status === 'open' ? `<a href="#" class="join-cancel" data-id="${esc(q.id)}" style="color:var(--danger);font-size:12px;">cancel</a>` : ''}</div>`).join('')}</div>` : ''}`;
    // the payout of the typed amount, and the usual plan (monthly below 500m, weekly from there) until the person chooses one
    let modeTouched = false;
    const amtEl = $('join-inv-amt'), modeEl = $('join-inv-mode'), prev = $('join-inv-prev');
    modeEl.addEventListener('change', () => { modeTouched = true; amtEl.dispatchEvent(new Event('input')); });
    amtEl.addEventListener('input', () => {
        const v = finParse(amtEl.value);
        if (!v || v < 100000000) { prev.style.color = 'var(--muted)'; prev.textContent = 'Type an amount: from 100m, in steps of 25m up to 250m, 50m up to 500m, 100m up to 1b and 250m after that.'; return; }
        const step = v < 250000000 ? 25000000 : v < 500000000 ? 50000000 : v < 1000000000 ? 100000000 : 250000000, tier = finTierOf(v), wk = finRoi(v, r.roi);
        if (!modeTouched) modeEl.value = v < 500000000 ? 'monthly' : 'weekly';
        if (v % step) { prev.style.color = 'var(--danger)'; prev.textContent = `At this level the amount goes in steps of ${step / 1000000}m.`; return; }
        prev.style.color = 'var(--text)';
        prev.innerHTML = `${m(v)} is <b>${tier[2]} ${tier[1]}</b>: about <b>${m(wk)}</b> a week${modeEl.value === 'monthly' ? ` (paid together on the last Sunday of the month)` : ''}.`;
    });
    const go = async (program, extra, okId, btn) => {
        if (!$(okId).checked) { toast('Read the terms and tick that you accept them first'); return; }
        btn.disabled = true;
        const res = await joinFetch({ action: 'join-request', program, accept: true, ...extra });
        if (res.error) { toast(res.error); btn.disabled = false; return; }
        toast('Request sent: the owner will contact you on Torn'); loadJoin();
    };
    $('join-inv-send').addEventListener('click', e => { const v = finParse(amtEl.value); if (!v) { toast('Type the amount, for example 250m'); return; } go('invest', { amount: v, mode: modeEl.value }, 'join-inv-ok', e.target); });
    $('join-rent-send').addEventListener('click', e => go('rent', { happy: Number(document.querySelector('input[name="join-happy"]:checked').value) }, 'join-rent-ok', e.target));
    $('join-buddy-send').addEventListener('click', e => go('buddy', {}, 'join-buddy-ok', e.target));
    $('join-trd-send').addEventListener('click', e => {
        const v = finParse($('join-trd-amt').value);
        if (!v) { toast('Type the amount you would like, for example 500m'); return; }
        if (!$('join-trd-plan').value.trim()) { toast('Tell what you would trade first'); return; }
        go('trading', { amount: v, plan: $('join-trd-plan').value.trim(), voucher: $('join-trd-vouch').value.trim(), experience: $('join-trd-exp').value.trim() }, 'join-trd-ok', e.target);
    });
    document.querySelectorAll('.join-cancel').forEach(a => a.addEventListener('click', async ev => {
        ev.preventDefault();
        const res = await joinFetch({ action: 'join-cancel', id: a.dataset.id });
        if (res.error) { toast(res.error); return; }
        loadJoin();
    }));
}

// ---- the owner's list ----
async function loadJoinRequests() {
    const st = $('jr-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    const r = await joinFetch({ action: 'join-list' });
    if (r.error) { st.className = 'status err'; st.textContent = r.error; return; }
    st.textContent = ''; st.className = 'status';
    joinReqs = r;
    joinRequestsRender();
}
function joinRequestsRender() {
    const r = joinReqs, m = n => finMoney(n), open = r.reqs.filter(q => q.status === 'open'), done = r.reqs.filter(q => q.status !== 'open').slice(0, 25);
    const line = q => {
        const who = `<b>${esc(q.name)}</b> <span style="color:var(--muted);font-size:12px;">[${esc(q.tornId)}]</span>`;
        if (q.program === 'invest') { const t = finTierOf(q.details.amount); return `${who} wants to invest <b>${m(q.details.amount)}</b>${t ? ` (${t[2]} ${t[1]})` : ''}, ${q.details.mode === 'weekly' ? 'weekly' : 'monthly'} payouts`; }
        if (q.program === 'rent') { const x = r.rent[q.details.happy] || {}; return `${who} wants a <b>${q.details.happy} happy island</b> (price ${m(x.price || 0)}, rent ${m(x.rent || 0)} + equity ${m(x.equity || 0)} every 30 days)`; }
        if (q.program === 'trading') return `${who} asks for a <b>Trading funding of ${m(q.details.amount)}</b><br><span style="font-size:12px;color:var(--muted);">Trades: ${esc(q.details.plan)} · Vouched by: ${esc(q.details.voucher || 'nobody named')}${q.details.experience ? ` · Experience: ${esc(q.details.experience)}` : ''}</span>`;
        return `${who} wants <b>Buddy banking</b> (Bronze ${m(q.details.amount)}, ${q.details.days} days)`;
    };
    const buttons = q => q.program === 'invest'
        ? `<button class="small" data-jr="${esc(q.id)}" data-dec="received" type="button" title="Their money has arrived: the deposit is created with their plan and a 180-day term">Money received</button><button class="ghost small" data-jr="${esc(q.id)}" data-dec="approve" type="button" title="Mark as handled without creating a deposit">Handled</button>`
        : q.program === 'buddy' ? `<button class="small" data-jr="${esc(q.id)}" data-dec="approve" type="button" title="Approves the request and adds the buddy to the Buddy banking page (a Bronze line of today)">Approve and add the buddy</button>`
        : `<button class="small" data-jr="${esc(q.id)}" data-dec="approve" type="button">Approve</button>`;
    $('jr-body').innerHTML = `<div class="panel"><h3 style="margin-top:0;">Open requests ${open.length ? `<span style="font-size:13px;color:#e0a030;">(${open.length})</span>` : ''}</h3>
        ${open.length ? open.map(q => `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--line);font-size:13px;"><span style="flex:1;min-width:240px;">${line(q)}<br><span style="font-size:11px;color:var(--muted);">${esc(JOIN_PROGRAM_NAME[q.program])} · asked ${esc(finDate(q.createdOn))} · accepted the terms ${esc(finDate(q.termsOn))}</span></span>${buttons(q)}<button class="ghost small" data-jr="${esc(q.id)}" data-dec="decline" type="button">Decline</button></div>`).join('') : '<div style="color:var(--muted);font-size:13px;">No requests waiting.</div>'}</div>
        ${done.length ? `<details class="panel"><summary class="av-sum"><b>Handled (${done.length})</b></summary>${done.map(q => `<div style="font-size:12px;padding:3px 0;color:var(--muted);">${line(q)} · ${q.status} ${esc(finDate(q.resolvedOn || q.createdOn))}</div>`).join('')}</details>` : ''}`;
    document.querySelectorAll('[data-jr]').forEach(b => b.addEventListener('click', async () => {
        if (b.dataset.dec === 'decline' && !confirm('Decline this request?')) return;
        b.disabled = true;
        const res = await joinFetch({ action: 'join-resolve', id: b.dataset.jr, decision: b.dataset.dec });
        if (res.error) { toast(res.error); b.disabled = false; return; }
        toast('Done'); loadJoinRequests(); if (typeof loadLeaderTodos === 'function') loadLeaderTodos();
    }));
}
