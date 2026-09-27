// core.js — WorldWideLabs shared foundation: config, helpers, login/logout, faction-access
// checks, and page navigation. Every other file depends on this one loading first.
'use strict';

    // ================= CONFIG =================
    const KEY_STORAGE = 'wwl_api_key';
    const LINKS_STORAGE = 'wwl_custom_links';
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
        { title: 'Torn Intel', url: 'https://torn-intel.com/', desc: 'Shared faction intelligence — activity, war analytics, enemy monitoring.', checkId: 'torn_intel' },
        { title: 'CAT', url: 'https://cat-script.com/', desc: 'Required faction tool.', checkId: 'cat' },
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
        await pingTracker();
        checkFactionAccess();
        if (typeof checkLabsOwner === 'function') checkLabsOwner();
        if (typeof checkMentoringAccess === 'function') checkMentoringAccess();
        if (typeof updateWhatsNewBadge === 'function') updateWhatsNewBadge();
        if (typeof loadFeedback === 'function') loadFeedback(); // also lights up the Feedback nav badge if unanswered
        if (typeof updateAvailabilityBadge === 'function') updateAvailabilityBadge();

        // A direct link like worldwidelabs.vercel.app/availability (for newsletters etc.) wins
        // over whatever page was last open in this session — that's the whole point of sharing
        // a specific link. Falls through to the remembered page, then dashboard, same as before.
        const pathPage = window.location.pathname.replace(/^\/+|\/+$/g, '');
        const lastPage = (pathPage && $('page-' + pathPage)) ? pathPage : (sessionStorage.getItem(CURRENT_PAGE_KEY) || 'dashboard');
        const navItem = document.querySelector(`.nav-item[data-page="${lastPage}"]`);
        const parentGroup = navItem?.closest('.nav-group');
        if (parentGroup) parentGroup.classList.remove('collapsed'); // reveal it even if its group was left collapsed
        goToPage(lastPage);
        if (typeof loadBanners === 'function') loadBanners();
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
    // A real leader-tier key can preview the app as any of the four tiers sees it: member, council,
    // leader/co-leader, owner. Only ever hides/shows things in THIS browser (the server still checks
    // the real key against one blanket "leaders only" gate today, see AUDIT.md) — a look-and-feel
    // check, not a security change, exactly like the old member-only toggle this replaced.
    const VIEW_AS_KEY = "wwl_view_as";
    const VIEW_RANK = { member: 0, council: 1, leader: 2, owner: 3 };
    let isRealLeader = false;
    let viewAs = "leader"; // default: see everything a real leader-tier key can
    try {
        const saved = localStorage.getItem(VIEW_AS_KEY);
        if (saved && VIEW_RANK[saved] !== undefined) viewAs = saved;
        else if (localStorage.getItem("wwl_member_view") === "1") viewAs = "member"; // migrate the old boolean toggle once
    } catch (e) { /* storage blocked */ }
    const viewAtLeast = (tier) => VIEW_RANK[viewAs] >= VIEW_RANK[tier]; // e.g. viewAtLeast('council') is also true for leader/owner
    const memberView = viewAs === 'member'; // kept for the couple of older call sites that only ever cared about this one boundary
    // Six Leadership pages are Leader/Co-leader only end to end (Announcements, Feedback form, War
    // Payout, Newsletter, Leader settings, Mentoring admin — see AUDIT.md). isLeaderCached alone isn't
    // strict enough for these any more, since it now also covers "at least Council" for the pages
    // Council DOES get into.
    let canEditLeaderOnly = false;

    // Locking happens at the GROUP level, not per page — a page with no access at all just sits inside
    // a locked, collapsed, unclickable group header (a single 🔒 there says enough; no per-item icons
    // or "leaders only" messages needed in the nav itself).
    function lockNavGroup(groupName, locked) {
        const header = document.querySelector(`.nav-group-header[data-group="${groupName}"]`);
        if (!header) return;
        const group = header.closest('.nav-group');
        header.classList.toggle('nav-locked', locked);
        if (locked) {
            group.classList.add('collapsed'); // nothing inside works, so don't leave it sitting open
            if (!header.querySelector('.lock')) {
                const lock = document.createElement('span');
                lock.className = 'lock';
                lock.textContent = ' 🔒';
                header.querySelector('span').appendChild(lock);
            }
        } else {
            header.querySelector('.lock')?.remove();
            // Unlocking doesn't force it open — leaves whatever the person's own expand/collapse choice was.
        }
    }

    async function checkFactionAccess() {
        try {
            await tornV2('/faction/balance');
            isRealLeader = true;
            // "At least Council" still fetches the full leader-tier data (there's no server-side Council
            // yet — see AUDIT.md), just with Leader-only edit controls hidden within the page. Only
            // "Member" hides the page entirely.
            isLeaderCached = viewAtLeast('council');
            canEditLeaderOnly = viewAtLeast('leader');
            $("view-as-wrap").style.display = "flex";
            $("view-as-select").value = viewAs;
            // Locking is by GROUP: "Leadership" itself locks when nothing inside works at all; its two
            // subgroups lock independently (Leaders needs canEditLeaderOnly, Council needs isLeaderCached).
            // Individual pages inside a group that's OPEN still hide their own Leader-only panels/edit
            // controls internally (respect-tracker.js etc.) — see AUDIT.md's access-tier spec.
            lockNavGroup('leadership', !isLeaderCached);
            lockNavGroup('leadership-leaders', !canEditLeaderOnly);
            lockNavGroup('leadership-council', !isLeaderCached);
            if (isLeaderCached) { setTimeout(() => { if (typeof loadSteadfastCard === 'function') loadSteadfastCard(); }, 8000); loadAdoption(); setTimeout(loadLeaderTodos, 2500);
            loadFactionSharing();
            loadRespectGoalPanel(); }
        } catch (e) {
            isLeaderCached = false;
            canEditLeaderOnly = false;
            lockNavGroup('leadership', true);
            lockNavGroup('leadership-leaders', true);
            lockNavGroup('leadership-council', true);
        }
        if (document.querySelector('.nav-item[data-page="announce-edit"]').classList.contains('active')) {
            $('announce-locked').style.display = canEditLeaderOnly ? 'none' : 'block';
            $('announce-editor').style.display = canEditLeaderOnly ? 'block' : 'none';
            if (canEditLeaderOnly) { loadAnnouncementEditor(); loadPollEditor(); }
        }
        if (document.querySelector('.nav-item[data-page="feedback-edit"]').classList.contains('active')) {
            $('feedback-locked').style.display = canEditLeaderOnly ? 'none' : 'block';
            $('feedback-editor').style.display = canEditLeaderOnly ? 'block' : 'none';
            if (canEditLeaderOnly) loadFeedbackEditor();
        }
        if (document.querySelector('.nav-item[data-page="members-overview"]').classList.contains('active')) loadMemberOverview();
        if (document.querySelector('.nav-item[data-page="availability-leaders"]').classList.contains('active')) loadAvailability();
        if (document.querySelector('.nav-item[data-page="whats-new"]').classList.contains('active')) renderWhatsNew();
        if (typeof updateWhatsNewBadge === 'function' && !document.querySelector('.nav-item[data-page="whats-new"]').classList.contains('active')) updateWhatsNewBadge();
        if (document.querySelector('.nav-item[data-page="ocfit-team"]').classList.contains('active')) {
            loadOcFitTeamBuilder();
        }
        if (document.querySelector('.nav-item[data-page="respect-edit"]').classList.contains('active')) {
            loadRespectEditor();
        }
        if (document.querySelector('.nav-item[data-page="war-payout"]').classList.contains('active')) {
            loadWarPayout();
        }
        if (document.querySelector('.nav-item[data-page="war-badges"]').classList.contains('active')) {
            loadWarBadges();
        }
        if (document.querySelector('.nav-item[data-page="armory-tracker"]').classList.contains('active')) {
            loadArmoryTracker();
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

    $('view-as-select').addEventListener('change', () => {
        try { localStorage.setItem(VIEW_AS_KEY, $('view-as-select').value); } catch (e) { /* storage blocked */ }
        location.reload(); // simplest way to re-draw every page consistently
    });

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
            if (header.classList.contains('nav-locked')) return; // nothing inside works — not worth opening
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
        item.addEventListener('click', e => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return; // let the browser open it in a new tab
            e.preventDefault();
            goToPage(item.dataset.page);
        });
    });

    const CURRENT_PAGE_KEY = 'wwl_current_page';

    function goToPage(page) {
        const target = $('page-' + page);
        if (!target) return; // unknown/removed page — ignore rather than break navigation
        document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === page));
        document.querySelectorAll('section.page').forEach(p => p.classList.remove('visible'));
        target.classList.add('visible');
        // Keeps the address bar matching wherever you actually are — worldwidelabs.vercel.app/<page>
        // — so copying the link from any page (not just ones with an explicit "share" button)
        // gives a direct link back to it, e.g. for a newsletter. replaceState (not pushState): one
        // tab navigating around shouldn't pile up back-button history for every click. Skips
        // 'payout-receipt', which carries its own ?receipt=ID query string that this would wipe.
        if (page !== 'payout-receipt' && window.location.pathname.replace(/^\/+|\/+$/g, '') !== page) {
            history.replaceState(null, '', '/' + page);
        }
        { const prev = sessionStorage.getItem(CURRENT_PAGE_KEY); if (page === 'bug-report' && prev && prev !== 'bug-report') sessionStorage.setItem('wwl_prev_page', prev); } // so a bug report knows where you came from
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
        if (page === 'war-payout') loadWarPayout();
        if (page === 'war-badges') loadWarBadges();
        if (page === 'availability' || page === 'availability-leaders') loadAvailability();
        if (page === 'energy') loadGymPlanner();
        if (page === 'gym-stats') loadGymStats();
        if (page === 'energy-tracker') loadEnergyTracker();
        if (page === 'war-reports') loadWarReports();
        if (page === 'steadfast') loadFactionSteadfast();
        if (page === 'perk-roadmap') loadFactionRoadmap();
        if (page === 'tz-map') loadTzMap();
        if (page === 'newsletter') loadNewsletter();
        if (page === 'my-targets') loadMyTargets();
        if (page === 'leader-settings') loadLeaderSettings();
        if (page === 'mentoring') loadMentoring();
        if (page === 'mentoring-admin') loadMentoringAdmin();
        if (page === 'bug-report') loadBugReport();
        if (page === 'labs-funds') loadLabsFunds();
        if (page === 'members-overview') loadMemberOverview();
        if (page === 'whats-new') renderWhatsNew();
        if (page === 'armory-tracker') loadArmoryTracker();
        if (page === 'foreign-stock' && !foreignStockLoaded) { foreignStockLoaded = true; loadForeignStock(); }
        if (page === 'crimes-guide' && !crimesGuideLoaded) { crimesGuideLoaded = true; loadCrimesGuide(); }
        if (page === 'feedback-edit') {
            $('feedback-locked').style.display = canEditLeaderOnly ? 'none' : 'block';
            $('feedback-editor').style.display = canEditLeaderOnly ? 'block' : 'none';
            if (canEditLeaderOnly) loadFeedbackEditor();
        }
        if (page === 'dashboard') { startCooldownTicker(); loadAnnouncement(); loadPolls(); loadRespectGoalPanel(); loadDashboardWarBadges(); loadMyStanding(); if (typeof loadLeaderTodos === 'function' && isLeaderCached) setTimeout(loadLeaderTodos, 1500); setTimeout(() => { if (typeof loadSteadfastCard === 'function') loadSteadfastCard(); }, 8000); } else { stopCooldownTicker(); }
        if (page === 'announce-edit') {
            $('announce-locked').style.display = canEditLeaderOnly ? 'none' : 'block';
            $('announce-editor').style.display = canEditLeaderOnly ? 'block' : 'none';
            if (canEditLeaderOnly) { loadAnnouncementEditor(); loadPollEditor(); }
        }
    }

