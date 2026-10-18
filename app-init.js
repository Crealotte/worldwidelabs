// app-init.js — MUST be the LAST script tag on the page. Kicks off auto-login using a
// saved key, which can cascade into calling functions from every other file (e.g. via
// goToPage restoring whatever page was last open) — so everything else has to exist first.
'use strict';

    // A war payout receipt is meant to be genuinely public — shareable with anyone, including
    // people with no Torn account at all, not just logged-in faction members. So this skips the
    // entire login flow when a receipt link is opened: no key needed, no session, nothing.
    const receiptId = new URLSearchParams(window.location.search).get('receipt');
    // A trader's shared pricelist (/?pricelist=<tornId>) is public in the same way: no login, no session. (A path like /pricelist/123 would break the page: the
    // scripts load from relative addresses. vercel.json sends /pricelist/123 here instead.)
    const pubPricelist = /^\d{1,10}$/.test(new URLSearchParams(window.location.search).get('pricelist') || '') ? [null, new URLSearchParams(window.location.search).get('pricelist')] : null;
    const tradeReceipt = /^[A-Za-z0-9_-]{8,40}$/.test(new URLSearchParams(window.location.search).get('tradereceipt') || '') ? new URLSearchParams(window.location.search).get('tradereceipt') : null;
    if (tradeReceipt) { // the receipt page of a trade (made by a trader's userscript): public as well
        $('login-view').style.display = 'none';
        $('app-view').style.display = 'block';
        document.querySelector('nav.side').style.display = 'none';
        goToPage('trade-receipt');
        loadTradeReceipt(tradeReceipt);
    } else if (pubPricelist) {
        $('login-view').style.display = 'none';
        $('app-view').style.display = 'block';
        document.querySelector('nav.side').style.display = 'none';
        goToPage('public-pricelist');
        loadPublicPricelist(pubPricelist[1]);
    } else if (receiptId) {
        $('login-view').style.display = 'none';
        $('app-view').style.display = 'block';
        document.querySelector('nav.side').style.display = 'none'; // irrelevant without a real login
        goToPage('payout-receipt');
        loadPayoutReceipt(receiptId);
    } else if (apiKey) {
        login(apiKey).catch(async e => {
            if (e.tornCode === 2 || e.denied) { // a rejected key, or a faction that is not on the owner's list: forget the saved key and say why
                localStorage.removeItem(KEY_STORAGE);
                apiKey = '';
                $('login-error').textContent = e.message;
                $('login-error').style.display = 'block';
                return;
            }
            // Likely just a network hiccup right at page load — silently try once more before bothering anyone.
            await new Promise(r => setTimeout(r, 1500));
            try {
                await login(apiKey);
            } catch (e2) {
                $('login-key').value = apiKey; // key is still saved — just prefill so one click retries
                $('login-error').textContent = `${e2.message} — your saved key is still here, just try again.`;
                $('login-error').style.display = 'block';
            }
        });
    }

// The dev (test) site: an orange bar so nobody mistakes it for the real WWL, and a red one while it has no test database of its own. The real site shows nothing (one request, no key, no database).
fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'env-info' }) }).then(r => r.json()).then(e => {
    if (!e || !e.test) return;
    document.title = `[TEST] ${document.title}`;
    const bar = document.createElement('div');
    bar.style.cssText = `position:fixed;left:0;right:0;top:0;z-index:99999;text-align:center;font:700 12px/1.6 Arial,sans-serif;padding:2px 8px;color:#fff;background:${e.dbReady ? '#e0701a' : '#c0392b'};`;
    bar.textContent = e.dbReady ? `TEST SITE (${e.branch || 'dev'}): separate test data, nothing here changes the real WWL` : 'TEST SITE: not connected to a test database yet, so it is closed on purpose';
    if (e.dbReady) { // "Use as": log in as a test person (a key like test:ID:Name is never sent to Torn) and see the site the way they do; "Fill test data" adds the test investor and tenant
        const STORE = 'wwl_api_key', REAL = 'wwl_test_realkey', get = k => { try { return localStorage.getItem(k) || ''; } catch (x) { return ''; } }, put = (k, v) => { try { localStorage.setItem(k, v); } catch (x) { /* blocked */ } };
        const people = [['me', 'Me (my own key)'], ['test:9000001:Test Investor', 'An investor'], ['test:9000002:Test Tenant', 'A tenant'], ['test:9000003:New Person', 'Someone new (nothing with Labs yet)'], ['test:9000004:Test Buddy', 'A buddy (buddy banking)']];
        const cur = get(STORE), sel = document.createElement('select');
        sel.style.cssText = 'margin-left:12px;font:12px Arial,sans-serif;padding:1px 4px;border-radius:4px;';
        sel.innerHTML = people.map(([v, l]) => `<option value="${v}">Use as: ${l}</option>`).join('');
        sel.value = people.some(p => p[0] === cur) ? cur : 'me';
        sel.addEventListener('change', () => {
            if (!/^test:/.test(get(STORE))) put(REAL, get(STORE)); // remember my own key so "Me" can put it back
            put(STORE, sel.value === 'me' ? get(REAL) : sel.value);
            location.reload();
        });
        const fill = document.createElement('button');
        fill.type = 'button'; fill.textContent = 'Fill test data';
        fill.style.cssText = 'margin-left:8px;font:12px Arial,sans-serif;padding:1px 8px;border-radius:4px;cursor:pointer;';
        fill.addEventListener('click', async () => {
            const k = /^test:/.test(get(STORE)) ? get(REAL) : get(STORE);
            if (!k) { alert('Log in with your own key first, as the owner (use "Me"), then press this.'); return; }
            fill.disabled = true;
            try {
                const r = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: k, action: 'test-seed' }) }).then(x => x.json());
                alert(r.error ? r.error : 'Done: a test investor (2 lines in the fund) and a test tenant (a 2600 contract) were added. Use the "Use as" menu to see their pages.');
            } catch (x) { alert('That did not work: ' + x.message); }
            fill.disabled = false;
        });
        bar.append(sel, fill);
    }
    document.body.appendChild(bar);
    document.body.style.paddingTop = '24px';
}).catch(() => { /* the real site, or no network: nothing to show */ });
