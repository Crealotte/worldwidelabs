// tools-links.js — the Tools & Links page: required-tool cards (with live status checks)
// plus the member-editable general link directory.
'use strict';

    // ================= LINKS =================
    function getCustomLinks() {
        try { return JSON.parse(localStorage.getItem(LINKS_STORAGE)) || []; } catch { return []; }
    }

    // Per-tool "have they joined?" status, keyed by checkId. Only tools with a real check
    // (currently just Discord) get an entry here — add more by writing a check function
    // below and giving that tool a matching checkId in REQUIRED_LINKS.
    let requiredStatus = {};

    function renderRequiredLinks() {
        $('required-link-grid').innerHTML = REQUIRED_LINKS.map(l => {
            const status = l.checkId ? requiredStatus[l.checkId] : null;
            let extraClass = '', badge = 'Required';
            if (status?.verified) { extraClass = 'joined-verified'; badge = '✓ Verified'; }
            else if (status?.joined) { extraClass = 'joined'; badge = '✓ Joined'; }
            return `
                <a class="link-card required ${extraClass}" href="${esc(l.url)}" target="_blank" rel="noopener">
                    <span class="badge">${badge}</span>
                    <div class="lt">${esc(l.title)}</div>
                    <div class="ld">${esc(l.desc || '')}</div>
                    <div class="lu">${esc(l.url)}</div>
                </a>`;
        }).join('');
    }

    async function checkDiscordStatus() {
        try {
            const res = await fetch('/api/discord-members', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: apiKey }),
            });
            const data = await res.json();
            requiredStatus.discord = data.error
                ? null // couldn't check (bot not set up, etc.) — falls back to the plain "Required" look
                : { joined: !!data.mine?.discordName, verified: !!data.mine?.verified };
        } catch (e) {
            requiredStatus.discord = null;
        }
        renderRequiredLinks();
    }

    // Torn Intel and CAT have no API of their own for WWL to ask "has this member joined/verified" — unlike Discord,
    // so a leader ticks it by hand on the "Who's on board" list (dashboard / Member Overview). This just reads
    // what was ticked for the caller, so their own card can show the same ✓ badge Discord gets.
    async function checkManualVerifyStatus() {
        try {
            const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, action: 'verify-mine' }) });
            const data = await res.json();
            if (!data.error) { requiredStatus.torn_intel = { verified: !!data.intel }; requiredStatus.cat = { verified: !!data.cat }; }
        } catch (e) { /* leave the plain "Required" look */ }
        renderRequiredLinks();
    }

    async function loadRequiredToolStatus() {
        checkDiscordStatus();
        checkManualVerifyStatus();
    }

    function renderLinks() {
        renderRequiredLinks();
        const custom = getCustomLinks();
        const all = [...DEFAULT_LINKS, ...custom];
        $('link-grid').innerHTML = '';
        all.forEach((l, i) => {
            const a = document.createElement('a');
            a.className = 'link-card';
            a.href = l.url;
            a.target = '_blank';
            a.rel = 'noopener';
            a.innerHTML = `<div class="lt">${esc(l.title)}</div><div class="ld">${esc(l.desc || '')}</div><div class="lu">${esc(l.url)}</div>`;
            if (!l.builtin) {
                const rm = document.createElement('button');
                rm.className = 'rm'; rm.textContent = '✕'; rm.title = 'Remove link';
                rm.addEventListener('click', e => {
                    e.preventDefault(); e.stopPropagation();
                    const customIdx = i - DEFAULT_LINKS.length;
                    const links = getCustomLinks();
                    links.splice(customIdx, 1);
                    localStorage.setItem(LINKS_STORAGE, JSON.stringify(links));
                    renderLinks();
                });
                a.appendChild(rm);
            }
            $('link-grid').appendChild(a);
        });
    }
    $('nl-add').addEventListener('click', () => {
        const title = $('nl-title').value.trim();
        let url = $('nl-url').value.trim();
        const desc = $('nl-desc').value.trim();
        if (!title || !url) { toast('Title and URL are required'); return; }
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        const links = getCustomLinks();
        links.push({ title, url, desc });
        localStorage.setItem(LINKS_STORAGE, JSON.stringify(links));
        $('nl-title').value = ''; $('nl-url').value = ''; $('nl-desc').value = '';
        renderLinks();
        toast('Link added');
    });

