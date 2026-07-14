// app-init.js — MUST be the LAST script tag on the page. Kicks off auto-login using a
// saved key, which can cascade into calling functions from every other file (e.g. via
// goToPage restoring whatever page was last open) — so everything else has to exist first.
'use strict';

    // A war payout receipt is meant to be genuinely public — shareable with anyone, including
    // people with no Torn account at all, not just logged-in faction members. So this skips the
    // entire login flow when a receipt link is opened: no key needed, no session, nothing.
    const receiptId = new URLSearchParams(window.location.search).get('receipt');
    if (receiptId) {
        $('login-view').style.display = 'none';
        $('app-view').style.display = 'block';
        document.querySelector('nav.side').style.display = 'none'; // irrelevant without a real login
        goToPage('payout-receipt');
        loadPayoutReceipt(receiptId);
    } else if (apiKey) {
        login(apiKey).catch(async e => {
            if (e.tornCode === 2) {
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
