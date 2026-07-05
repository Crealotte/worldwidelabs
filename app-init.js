// app-init.js — MUST be the LAST script tag on the page. Kicks off auto-login using a
// saved key, which can cascade into calling functions from every other file (e.g. via
// goToPage restoring whatever page was last open) — so everything else has to exist first.
'use strict';

    // Auto-login with a stored key.
    // Only a genuinely bad key (Torn error code 2 — incorrect key) should force a full re-login.
    // Anything else (rate limiting, a fed-jail/inactivity/paused key, or a plain network hiccup on
    // refresh) is temporary and the same stored key will work again shortly — so keep it and let
    // the person retry with one click instead of silently wiping their login.
    if (apiKey) {
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
