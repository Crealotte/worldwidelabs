// core.js — WorldWideLabs shared foundation: config, helpers, login/logout, faction-access
// checks, and page navigation. Every other file depends on this one loading first.
'use strict';

    // ================= CONFIG =================
    const KEY_STORAGE = 'wwl_api_key';
    const LINKS_STORAGE = 'wwl_custom_links';
    const RATE_STORAGE = 'wwl_payout_rate';
    const XANAX_ENERGY = 250;

    const DEFAULT_LINKS = [
        { title: 'YATA', url: 'https://yata.yt', desc: 'Faction stats, chain reports, targets, loot timers.', builtin: true },
        { title: 'TornStats', url: 'https://tornstats.com', desc: 'Battle stat spies, faction tracking, chain watching.', builtin: true },
        { title: 'Torn Wiki', url: 'https://wiki.torn.com', desc: 'The official wiki — mechanics, gyms, drugs, crimes.', builtin: true },
        { title: 'Item Market', url: 'https://www.torn.com/page.php?sid=ItemMarket', desc: 'Buy Xanax, energy cans and gear.', builtin: true },
        { title: 'Your Faction', url: 'https://www.torn.com/factions.php?step=your', desc: 'Faction page — armoury, wars, announcements.', builtin: true },
        { title: 'Gym', url: 'https://www.torn.com/gym.php', desc: 'Spend that energy.', builtin: true },
    ];

    const REQUIRED_LINKS = [
        { title: 'Discord', url: 'https://discord.gg/HFmPUd2zyh', desc: 'Faction communication and coordination.', checkId: 'discord' },
        { title: 'Torn Intel', url: 'https://torn-intel.com/', desc: 'Shared faction intelligence — activity, war analytics, enemy monitoring.' },
        { title: 'CAT', url: 'https://cat-script.com/', desc: 'Required faction tool.' },
    ];

    // ================= HELPERS =================
    const $ = id => document.getElementById(id);
    const fmt$ = n => '$' + Math.round(n).toLocaleString('en-US');
    const fmtN = n => Math.round(n).toLocaleString('en-US');
    const toNumber = s => parseFloat(String(s).replace(/[^0-9.]/g, '')) || 0;
    const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

    function toast(msg) {
        const t = $('toast');
        t.textContent = msg;
        t.style.display = 'block';
        setTimeout(() => (t.style.display = 'none'), 1600);
    }

    let apiKey = localStorage.getItem(KEY_STORAGE) || '';
    let profile = null;

    function friendlyApiError(err) {
        const map = {
            1: 'The key is empty — paste your API key.',
            2: 'Incorrect key — check for typos or extra spaces, and that the key wasn\'t deleted in Torn.',
            5: 'Too many requests — wait a minute and try again.',
            8: 'Your IP was temporarily banned by the Torn API for too many requests — wait a bit.',
            10: 'The key owner is in federal jail — this key can\'t be used right now.',
            13: 'The key owner has been inactive for 7+ days, so the key is paused. Log into Torn once and try again.',
            16: 'This key\'s access level is too low. Create a key with at least Limited Access (Torn → Settings → API Keys).',
            18: 'This key is paused. Re-enable it in Torn → Settings → API Keys.',
        };
        return map[err.code] || `${err.error} (code ${err.code})`;
    }

    async function tornV1(selections) {
        let res;
        try {
            res = await fetch(`https://api.torn.com/user/?selections=${selections}&key=${encodeURIComponent(apiKey)}`);
        } catch (e) {
            throw new Error('Could not reach api.torn.com at all. If you are viewing this page inside a preview or sandbox, download the file and open it directly in your browser (or host it) — previews block outside connections. Otherwise check your internet connection or ad-blocker.');
        }
        const data = await res.json();
        if (data.error) {
            const err = new Error(friendlyApiError(data.error));
            err.tornCode = data.error.code;
            throw err;
        }
        return data;
    }
    async function tornV2(path) {
        let res;
        try {
            res = await fetch(`https://api.torn.com/v2${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(apiKey)}`,
                { headers: { accept: 'application/json' } });
        } catch (e) {
            throw new Error('Could not reach api.torn.com — if you are in a preview/sandbox, download the file and open it directly in your browser.');
        }
        const data = await res.json();
        if (data.error) throw new Error(friendlyApiError(data.error));
        return data;
    }

    async function tornSection(section, selections) {
        let res;
        try {
            res = await fetch(`https://api.torn.com/${section}/?selections=${selections}&key=${encodeURIComponent(apiKey)}`);
        } catch (e) {
            throw new Error('Could not reach api.torn.com — if you are in a preview/sandbox, download the file and open it directly in your browser.');
        }
        const data = await res.json();
        if (data.error) throw new Error(friendlyApiError(data.error));
        return data;
    }

    // ================= LOGIN =================
    async function login(key) {
        apiKey = key;
        const data = await tornV1('profile,bars,cooldowns,notifications,gym,personalstats');
        profile = data;
        localStorage.setItem(KEY_STORAGE, key);
        $('login-view').style.display = 'none';
        $('app-view').style.display = 'block';
        renderDashboard();
        renderLinks();
        $('cp-rate').value = localStorage.getItem(RATE_STORAGE) || '100,000';
        await pingTracker();
        checkFactionAccess();

        const lastPage = sessionStorage.getItem(CURRENT_PAGE_KEY) || 'dashboard';
        const navItem = document.querySelector(`.nav-item[data-page="${lastPage}"]`);
        const parentGroup = navItem?.closest('.nav-group');
        if (parentGroup) parentGroup.classList.remove('collapsed'); // reveal it even if its group was left collapsed
        goToPage(lastPage);
        loadAnnouncement();
        loadPolls();
    }

    // Tell the server this member logged in. Silently does nothing when the app is
    // opened as a local file (no server there). Logs (but doesn't alert) other failures,
    // e.g. an ad-blocker or privacy extension blocking the request.
    function pingTracker() {
        return fetch('/api/presence', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: apiKey }),
        }).catch(e => console.warn('WWLabs presence ping failed (ad-blocker or offline?):', e));
    }

    // Leaders with the "API Access" faction permission can read faction data; others get the payout tab locked.
    let isLeaderCached = false;

    function setNavLock(page, locked) {
        const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
        if (!navItem) return;
        if (locked) {
            if (!navItem.querySelector('.lock')) {
                const lock = document.createElement('span');
                lock.className = 'lock';
                lock.textContent = ' 🔒';
                navItem.appendChild(lock);
            }
        } else {
            navItem.querySelector('.lock')?.remove();
        }
    }

    async function checkFactionAccess() {
        try {
            await tornV2('/faction/balance');
            isLeaderCached = true;
            setNavLock('payout', false);
            setNavLock('announce-edit', false);
            setNavLock('feedback-edit', false);
            setNavLock('ocfit-team', false);
            setNavLock('respect-edit', false);
            $('cp-locked').style.display = 'none';
            $('cp-tools').style.display = 'block';
            loadAdoption();
            loadFactionSharing();
            loadRespectGoalPanel();
        } catch (e) {
            isLeaderCached = false;
            setNavLock('payout', true);
            setNavLock('announce-edit', true);
            setNavLock('feedback-edit', true);
            setNavLock('ocfit-team', true);
            setNavLock('respect-edit', true);
            $('cp-locked').style.display = 'block';
            $('cp-tools').style.display = 'none';
        }
        if (document.querySelector('.nav-item[data-page="announce-edit"]').classList.contains('active')) {
            $('announce-locked').style.display = isLeaderCached ? 'none' : 'block';
            $('announce-editor').style.display = isLeaderCached ? 'block' : 'none';
            if (isLeaderCached) { loadAnnouncementEditor(); loadPollEditor(); }
        }
        if (document.querySelector('.nav-item[data-page="feedback-edit"]').classList.contains('active')) {
            $('feedback-locked').style.display = isLeaderCached ? 'none' : 'block';
            $('feedback-editor').style.display = isLeaderCached ? 'block' : 'none';
            if (isLeaderCached) loadFeedbackEditor();
        }
        if (document.querySelector('.nav-item[data-page="ocfit-team"]').classList.contains('active')) {
            loadOcFitTeamBuilder();
        }
        if (document.querySelector('.nav-item[data-page="respect-edit"]').classList.contains('active')) {
            loadRespectEditor();
        }
    }

    $('login-btn').addEventListener('click', async () => {
        const key = $('login-key').value.trim();
        const err = $('login-error');
        err.style.display = 'none';
        if (!key) { err.textContent = 'Paste your API key first.'; err.style.display = 'block'; return; }
        $('login-btn').disabled = true;
        $('login-btn').textContent = 'Checking key…';
        try {
            await login(key);
        } catch (e) {
            err.textContent = e.message;
            err.style.display = 'block';
        } finally {
            $('login-btn').disabled = false;
            $('login-btn').textContent = 'Enter the lab';
        }
    });
    $('login-key').addEventListener('keydown', e => { if (e.key === 'Enter') $('login-btn').click(); });

    $('logout-btn').addEventListener('click', () => {
        localStorage.removeItem(KEY_STORAGE);
        sessionStorage.removeItem(CURRENT_PAGE_KEY);
        apiKey = ''; profile = null;
        $('app-view').style.display = 'none';
        $('login-view').style.display = 'flex';
        $('login-key').value = '';
    });

    const NAV_GROUP_KEY = 'wwl_nav_collapsed'; // stores an array of collapsed group names

    function getCollapsedGroups() {
        try { return JSON.parse(localStorage.getItem(NAV_GROUP_KEY)) || []; } catch { return []; }
    }

    document.querySelectorAll('.nav-group').forEach(group => {
        const name = group.querySelector('.nav-group-header').dataset.group;
        if (getCollapsedGroups().includes(name)) group.classList.add('collapsed');
    });

    document.querySelectorAll('.nav-group-header').forEach(header => {
        header.addEventListener('click', () => {
            const group = header.closest('.nav-group');
            const name = header.dataset.group;
            group.classList.toggle('collapsed');
            let collapsed = getCollapsedGroups();
            if (group.classList.contains('collapsed')) {
                if (!collapsed.includes(name)) collapsed.push(name);
            } else {
                collapsed = collapsed.filter(g => g !== name);
            }
            localStorage.setItem(NAV_GROUP_KEY, JSON.stringify(collapsed));
        });
    });

    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => goToPage(item.dataset.page));
    });

    const CURRENT_PAGE_KEY = 'wwl_current_page';

    function goToPage(page) {
        const target = $('page-' + page);
        if (!target) return; // unknown/removed page — ignore rather than break navigation
        document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === page));
        document.querySelectorAll('section.page').forEach(p => p.classList.remove('visible'));
        target.classList.add('visible');
        sessionStorage.setItem(CURRENT_PAGE_KEY, page);
        if (page === 'targets') loadBaldrLists();
        if (page === 'targetfinder') initTargetFinder();
        else if (typeof stopTfLive === 'function') stopTfLive();
        if (page === 'profile') loadPlayerProfile();
        if (page === 'links') loadRequiredToolStatus();
        if (page === 'feedback') loadFeedback();
        if (page === 'ocfit' && !ocfitLoaded) { ocfitLoaded = true; loadOcFit(); }
        if (page === 'ocfit-team') loadOcFitTeamBuilder();
        if (page === 'respect-edit') loadRespectEditor();
        if (page === 'foreign-stock' && !foreignStockLoaded) { foreignStockLoaded = true; loadForeignStock(); }
        if (page === 'crimes-guide' && !crimesGuideLoaded) { crimesGuideLoaded = true; loadCrimesGuide(); }
        if (page === 'feedback-edit') {
            $('feedback-locked').style.display = isLeaderCached ? 'none' : 'block';
            $('feedback-editor').style.display = isLeaderCached ? 'block' : 'none';
            if (isLeaderCached) loadFeedbackEditor();
        }
        if (page === 'dashboard') { startCooldownTicker(); loadAnnouncement(); loadPolls(); } else { stopCooldownTicker(); }
        if (page === 'announce-edit') {
            $('announce-locked').style.display = isLeaderCached ? 'none' : 'block';
            $('announce-editor').style.display = isLeaderCached ? 'block' : 'none';
            if (isLeaderCached) { loadAnnouncementEditor(); loadPollEditor(); }
        }
    }

