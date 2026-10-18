// ==UserScript==
// @name         CoreLabs Elite Recruiter v22.0
// @version      22.1.0
// @updateURL    https://worldwidelabs.vercel.app/crm.user.js
// @downloadURL  https://worldwidelabs.vercel.app/crm.user.js
// @description  Test version Corelabs
// @match        *://www.torn.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @license      MIT
// @grant        GM_xmlhttpRequest
// @connect      supabase.co
// @connect      yweufoxazgfmnqndcgmk.supabase.co
// @connect      api.torn.com
// @connect      discord.com
// @run-at       document-end
// ==/UserScript==
(function () {
	'use strict';

	function injectStyles() {
		if (document.getElementById('cl-styles')) return;
		document.head.insertAdjacentHTML('beforeend', `<style id="cl-styles">
		/* --- align icon tray vertically with pill --- */
		.icons-wrap.icons { display:inline-flex !important; align-items:center !important; flex-wrap:nowrap !important; vertical-align:middle !important; }
		.icons-wrap.icons > ul { vertical-align:middle !important; }
		.icons-wrap.icons .user-icons { display:inline-flex !important; align-items:center !important; vertical-align:middle !important; }
		/* --- shrink Level column --- */
		.users-list-title .level { width:30px !important; min-width:0 !important; max-width:30px !important; }
		.level-icons-wrap .level { width:30px !important; min-width:0 !important; max-width:30px !important; }
		/* --- pill container: anchored to right edge of li row --- */
		li[class*="user"] { position:relative !important; }
		.cl-pill-cont { position:absolute !important; right:8px !important; top:50% !important; transform:translateY(-50%) !important; display:inline-flex; align-items:center; }
		/* --- pill (no background box — blends with torn row) --- */
		.cl-pill {
			display:inline-flex !important; align-items:center !important;
			font-size:11px; white-space:nowrap !important;
			color:#bbb; gap:4px;
		}
		.cl-pill-sep { width:1px; height:10px; background:#484848; flex-shrink:0; align-self:center; }
		.cl-xan    { color:#51cf66; font-weight:600; font-size:11px; display:inline-flex; align-items:center; }
		.cl-act    { color:#ff8787; font-weight:600; font-size:11px; display:inline-flex; align-items:center; }
		.cl-streak { color:#fcc419; font-size:11px;                  display:inline-flex; align-items:center; }
		.cl-ws     { color:#74c0fc; font-weight:600; font-size:11px; display:inline-flex; align-items:center; }
		.cl-pill-ico { display:inline-block; width:16px; text-align:center; flex-shrink:0; }
		.cl-pill-val { display:inline-block; font-variant-numeric:tabular-nums; }
		[data-cl="xan"]    .cl-pill-val { min-width:34px; }
		[data-cl="act"]    .cl-pill-val { min-width:40px; }
		[data-cl="streak"] .cl-pill-val { min-width:22px; }
		[data-cl="ws"]     .cl-pill-val { min-width:34px; }
		/* --- crm buttons (torn-native style: small, subtle gradient) --- */
		.cl-crm-group { display:inline-flex; gap:2px; align-items:center; }
		.cl-crm-btn  { width:16px; height:16px; line-height:16px; text-align:center;
		               cursor:pointer; border-radius:2px; font-size:9px; font-weight:900;
		               color:#ddd; user-select:none; flex-shrink:0;
		               border:1px solid #111; }
		.cl-btn-disabled { opacity:.4; cursor:not-allowed !important; filter:grayscale(.7); }
		.cl-locked .cl-act-icon { opacity:.4; pointer-events:none; }
		.cl-grey   { background:linear-gradient(#555,#444) !important; color:#bbb !important; }
		.cl-yellow { background:linear-gradient(#e8b800,#c49a00) !important; color:#111 !important; }
		.cl-green  { background:linear-gradient(#2f9e44,#236b30) !important; color:#dfd !important; }
		.cl-red    { background:linear-gradient(#c92a2a,#8c1c1c) !important; color:#fdd !important; }
		.cl-blue   { background:linear-gradient(#1971c2,#114f8a) !important; color:#ddf !important; }
		/* --- action icons --- */
		.cl-act-group { display:inline-flex; gap:4px; align-items:center; flex-wrap:wrap; }
		.cl-act-icon  { font-size:11px; cursor:pointer; opacity:1; transition:.15s; line-height:1; }
		.cl-act-icon:hover { opacity:1; }
		/* --- chat footer template bar --- */
		.cl-tpl-bar {
			display:flex; flex-wrap:wrap; gap:3px;
			padding:4px 6px; border-top:1px solid #333;
			background:#1a1a1a;
		}
		.cl-tpl-bar-btn {
			font-size:11px; font-weight:700; padding:4px 14px;
			background:#1e3a4a; border:1px solid #1971c2; border-radius:3px;
			color:#74c0fc; white-space:nowrap; cursor:pointer;
			transition:background .15s, color .15s;
		}
		.cl-tpl-bar-btn:hover  { background:#1971c2; color:#fff; }
		.cl-tpl-bar-btn.active { background:#2f9e44; border-color:#51cf66; color:#dfd; }
		/* --- overlays & modals --- */
		.cl-overlay {
			position:fixed; inset:0; background:rgba(0,0,0,.65);
			z-index:999998; display:flex; align-items:center; justify-content:center;
		}
		.cl-modal {
			background:#222; color:#fff; padding:22px; border-radius:10px;
			border:1px solid #555; width:320px; box-sizing:border-box; position:relative;
		}
		.cl-modal h3   { margin:0 0 12px; font-size:14px; color:#37b3f9; }
		.cl-modal label { font-size:10px; color:#888; display:block; margin-top:10px; text-transform:uppercase; }
		.cl-modal input, .cl-modal select, .cl-modal textarea {
			width:100%; margin-top:4px; background:#333; color:#fff;
			border:1px solid #444; border-radius:4px; padding:6px;
			box-sizing:border-box; font-size:12px;
		}
		.cl-btn-ok  { margin-top:14px; width:100%; background:#40c057; color:#fff; border:none; padding:10px; cursor:pointer; font-weight:bold; border-radius:4px; }
		.cl-btn-no  { margin-top:6px;  width:100%; background:#555; color:#ccc; border:none; padding:8px; cursor:pointer; border-radius:4px; }
		/* --- chat tab --- */
		.cl-chat-tab {
			position:absolute; right:5px; top:-34px; height:34px;
			background:#222; border:1px solid #444; border-bottom:none;
			border-radius:4px 4px 0 0; display:flex; align-items:center;
			padding:0 10px; z-index:9999; pointer-events:auto;
		}
		/* --- sidebar --- */
		.cl-sidebar-wrap { width:100%; padding:10px; box-sizing:border-box; border-bottom:1px solid rgba(255,255,255,.1); }
		.cl-sidebar-btn  { width:100%; background:#333; color:#fff; border:1px solid #444; padding:8px; font-size:11px; font-weight:bold; cursor:pointer; border-radius:4px; }
		.cl-sidebar-btn.has-due { border-color:#00aaff; box-shadow:0 0 6px rgba(0,170,255,.5); color:#74c0fc; }
		/* --- dashboard --- */
		.cl-dash-overlay { position:fixed; inset:0; background:rgba(0,0,0,.8); z-index:10000; display:flex; align-items:center; justify-content:center; }
		.cl-dash-modal   { background:#222; color:#fff; width:95%; max-width:1200px; max-height:85vh; overflow-y:auto; border-radius:12px; border:1px solid #444; padding:25px; box-sizing:border-box; position:relative; box-shadow:0 10px 30px rgba(0,0,0,.5); }
		.cl-dash-close   { position:absolute; right:20px; top:20px; background:none; border:none; color:#888; cursor:pointer; font-size:24px; }
		.cl-dash-table   { width:100%; border-collapse:collapse; font-size:13px; }
		.cl-dash-table th { padding:12px; background:#111; text-align:left; border-bottom:2px solid #444; }
		.cl-dash-table td { padding:12px; border-bottom:1px solid #333; }
		.cl-note-input   { background:#111; border:1px solid #444; color:#ccc; width:100%; padding:6px; border-radius:4px; box-sizing:border-box; }
		.cl-done-btn     { background:#2b5e2d; color:#fff; border:none; padding:6px 12px; cursor:pointer; border-radius:4px; font-weight:bold; }
		.cl-player-link  { color:#37b3f9; text-decoration:none; font-weight:bold; }
		/* --- useless dim --- */
		li.cl-useless { opacity:0.35; transition:opacity .2s; }
		li.cl-useless:hover { opacity:0.7; }
		/* --- FCU help badge --- */
		.cl-fcu-help {
			display:inline-flex; align-items:center; justify-content:center;
			width:14px; height:14px; border-radius:50%;
			background:#2a2a2a; border:1px solid #484848;
			color:#777; font-size:9px; font-weight:bold;
			cursor:default; margin-left:4px; flex-shrink:0;
			vertical-align:middle; position:relative;
			user-select:none;
		}
		.cl-fcu-help:hover { border-color:#888; color:#bbb; }
		.cl-fcu-tooltip-portal {
			display:none; position:fixed; transform:translateY(-50%);
			background:#1a1a1a; border:1px solid #444; border-radius:6px;
			padding:10px 12px; z-index:999999; width:220px;
			box-shadow:0 4px 16px rgba(0,0,0,.6); pointer-events:none;
		}
		.cl-fcu-tooltip-title { font-size:10px; color:#666; text-transform:uppercase; letter-spacing:.5px; margin-bottom:6px; }
		.cl-fcu-row { display:flex; align-items:center; gap:6px; margin:3px 0; font-size:11px; color:#ccc; }
		.cl-fcu-dot {
			width:8px; height:8px; border-radius:2px; flex-shrink:0;
		}
		.cl-fcu-dot.grey   { background:#555; }
		.cl-fcu-dot.yellow { background:#e8b800; }
		.cl-fcu-dot.green  { background:#2f9e44; }
		.cl-fcu-dot.red    { background:#c92a2a; }
		.cl-fcu-dot.blue   { background:#1971c2; }
		.cl-fcu-sep { border:none; border-top:1px solid #2c2c2c; margin:6px 0; }
		/* --- button filter toggles --- */
		.cl-filter-toggle {
			display:inline-flex; align-items:center; justify-content:center;
			width:14px; height:14px; border-radius:2px;
			background:#2a2a2a; border:1px solid #383838;
			color:#555; font-size:9px; font-weight:900;
			cursor:pointer; user-select:none; flex-shrink:0;
			transition:.15s;
		}
		.cl-filter-toggle.active { background:#1a3a1a; border-color:#2f9e44; color:#51cf66; }
		.cl-filter-toggle:hover  { border-color:#666; color:#aaa; }
		.cl-filter-toggle.active:hover { border-color:#51cf66; }
		/* --- min-stat row filters --- */
		.cl-minf-wrap { display:inline-flex; align-items:center; gap:5px; margin-left:8px; vertical-align:middle;
		                padding-left:8px; border-left:1px solid #383838; }
		.cl-minf-lbl  { font-size:9px; color:#555; text-transform:uppercase; margin-right:1px; }
		.cl-minf-item { display:inline-flex; align-items:center; gap:2px; }
		.cl-minf-ico  { font-size:10px; line-height:1; }
		.cl-minf-in   { width:42px; background:#2a2a2a; border:1px solid #383838; border-radius:2px;
		                color:#bbb; font-size:10px; padding:1px 3px; text-align:right;
		                font-variant-numeric:tabular-nums; -moz-appearance:textfield; }
		.cl-minf-in::-webkit-outer-spin-button, .cl-minf-in::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }
		.cl-minf-in:focus { outline:none; border-color:#1971c2; color:#fff; }
		.cl-minf-in.active { border-color:#2f9e44; color:#51cf66; }
		.cl-minf-clear { font-size:9px; color:#555; cursor:pointer; user-select:none; padding:0 2px; }
		.cl-minf-clear:hover { color:#ff8787; }
	</style>`);
	}

	const CFG = {
		DISCORD_WEBHOOK: 'https://discord.com/api/webhooks/1490385921248596049/S9bRATb51O4DTVbSAVewImV3QPF5mvZ72FM54vrVIiML4md3OsRDqu2euEsGJGS7hpka',
		// All DB access goes through the gateway Edge Function. The anon key is GONE
		// from the client on purpose — the function holds the service_role key
		// server-side and enforces the paywall. RLS denies the anon key everything.
		GATEWAY_URL:     'https://yweufoxazgfmnqndcgmk.supabase.co/functions/v1/gateway',
		API_KEY:         '', // loaded from GM at boot via loadApiKey()
		MY_ID:           null, // resolved at boot via API
		PAID:            false, // set at boot from licenses self-read; gates write UI
		IS_ADMIN:        false, // set at boot; unlocks owner panel
		CACHE_TTL:       72 * 60 * 60 * 1000,
		HUNT_DELAY:      2000,
		SCAN_DEBOUNCE:   700,
	};

	const COMPANIES = ['Oil Rig', 'Sweet Shop', 'TV Station', 'Furniture Store', 'Mining Corp', 'Adult Novelties'];

	function gmFetch(url, opts = {}) {
		return new Promise((resolve, reject) => {
			GM_xmlhttpRequest({
				method:  opts.method || 'GET',
				url,
				headers: opts.headers || {},
				data:    opts.body   || null,
				onload:  r => resolve({ ok: r.status >= 200 && r.status < 300, text: () => Promise.resolve(r.responseText) }),
				onerror: e => reject(new Error(`GM_xmlhttpRequest error: ${e.statusText || e}`)),
			});
		});
	}

	const STORE = {
		CRM:       'RecruiterCRM_States',
		CACHE:     'RecruiterCache_v3',
		TASKS:     'RecruiterTasks',
		TEMPLATES: 'RecruiterTemplates',
		BTN_PREFS: 'RecruiterBtnPrefs',
		FILTERS:   'RecruiterFilters',
		API_KEY:   'RecruiterApiKey',
		MY_ID:     'RecruiterMyId',
		LICENSE:   'RecruiterLicenseCache',
	};

	function loadApiKey() { return GM_getValue(STORE.API_KEY, '') || ''; }
	function saveApiKey(key) { GM_setValue(STORE.API_KEY, key); }
	function loadMyId() { return GM_getValue(STORE.MY_ID, '') || ''; }
	function saveMyId(id) { GM_setValue(STORE.MY_ID, String(id)); }

	// Which recruitment buttons are visible (F/C always default on, S default off)
	const DEFAULT_BTN_PREFS = { F: true, C: true, S: false };
	function loadBtnPrefs() { return { ...DEFAULT_BTN_PREFS, ...load(STORE.BTN_PREFS, {}) }; }
	function saveBtnPrefs(prefs) { save(STORE.BTN_PREFS, prefs); }

	// Userlist row filters — minimum thresholds. 0 = off (show everyone).
	// ws = work stats, xan = xanax taken, act = ranked war hits.
	const DEFAULT_FILTERS = { ws: 0, xan: 0, act: 0 };
	function loadFilters() { return { ...DEFAULT_FILTERS, ...load(STORE.FILTERS, {}) }; }
	function saveFilters(f) { save(STORE.FILTERS, f); }

	const DEFAULT_TEMPLATES = [
		{ label: 'FC', fullName: 'First Contact',     text: `Hey {name}! I noticed your work stats and think you'd be a great fit for one of our top companies. We help players maximize their earning potential. Would you be open to hearing more? 😊` },
		{ label: 'FU', fullName: 'Follow-Up',          text: `Hi {name}, just following up on my earlier message! We still have a spot open at {company} and your profile looks like a perfect match. Let me know if you have any questions!` },
		{ label: 'CO', fullName: 'Company Offer',      text: `Hi {name}! I have a position available at {company} that could really boost your income. The perks are great and the team is active. Interested in learning more?` },
		{ label: 'NR', fullName: 'No Response Nudge',  text: `Hey {name}! Still here if you want to chat about career opportunities 😄 No pressure, just want to make sure you don't miss out!` },
	];

	function load(key, fallback) {
		try { return JSON.parse(GM_getValue(key, null)) ?? fallback; } catch { return fallback; }
	}
	function save(key, value) { GM_setValue(key, JSON.stringify(value)); }

	// One-time migration: rename old verbose labels + backfill fullName field
	const LABEL_MAP = {
		'First Contact':     'FC',
		'Follow-Up':         'FU',
		'Company Offer':     'CO',
		'No Response Nudge': 'NR',
	};
	const FULL_NAME_MAP = {
		'FC': 'First Contact',
		'FU': 'Follow-Up',
		'CO': 'Company Offer',
		'NR': 'No Response Nudge',
	};
	function migrateTemplates() {
		const stored = load(STORE.TEMPLATES, null);
		if (!stored) return;
		let dirty = false;
		stored.forEach(t => {
			if (LABEL_MAP[t.label]) { t.label = LABEL_MAP[t.label]; dirty = true; }
			if (!t.fullName) { t.fullName = FULL_NAME_MAP[t.label] || t.label; dirty = true; }
		});
		if (dirty) save(STORE.TEMPLATES, stored);
	}

	// CRM is the in-memory state — populated from Supabase at boot, no longer persisted to GM
	const CRM   = {};
	let   CACHE = load(STORE.CACHE, {});

	// One-time cleanup: older builds cached "0/0/0" stat rows when a profile fetch
	// was rate-limited, freezing them for 72h. Drop any cached entry where xan, act
	// AND streak are all zero so they re-fetch fresh. Runs once at boot; cheap.
	(function purgePoisonedCache() {
		let removed = 0;
		for (const uid of Object.keys(CACHE)) {
			const d = CACHE[uid]?.data;
			if (d && !d.xan && !d.act && !d.streak) { delete CACHE[uid]; removed++; }
		}
		if (removed) { save(STORE.CACHE, CACHE); console.log(`[CoreLabs] Purged ${removed} stale 0-stat cache entries`); }
	})();

	// TASKS is reassigned (filtered), so expose it via accessor + mutators
	let _tasks = load(STORE.TASKS, []);
	function getTasks()        { return _tasks; }
	function filterTasks(pred) { _tasks = _tasks.filter(pred); }
	function pushTask(task)    { _tasks.push(task); }

	// saveCRM is kept for legacy callers (notes, company, name patches) — writes to GM only
	function saveCRM()   { save(STORE.CRM,   CRM);    }
	function saveCache() { save(STORE.CACHE, CACHE);  }
	function saveTasks() { save(STORE.TASKS, _tasks); }

	function fmt(n) {
		if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
		if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
		if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
		return String(n);
	}

	// Parse a human threshold like "150k", "1.2m", "5b", "80000" -> integer.
	// k = thousand, m = million, b = billion. Bad input -> 0.
	function parseThreshold(str) {
		const s = String(str).trim().toLowerCase().replace(/,/g, '');
		if (!s) return 0;
		const m = s.match(/^([\d.]+)\s*([kmb])?$/);
		if (!m) return 0;
		let n = parseFloat(m[1]);
		if (!isFinite(n)) return 0;
		if (m[2] === 'k') n *= 1e3;
		if (m[2] === 'm') n *= 1e6;
		if (m[2] === 'b') n *= 1e9;
		return Math.round(n);
	}

	// Does a row's stats clear all active thresholds?
	function passesFilter(data) {
		if (!data) return true; // no data yet — never hide a still-loading row
		const f = loadFilters();
		if (f.ws  > 0 && (data.ws  || 0) < f.ws)  return false;
		if (f.xan > 0 && (data.xan || 0) < f.xan) return false;
		if (f.act > 0 && (data.act || 0) < f.act) return false;
		return true;
	}

	// Hide/show the userlist <li> that owns this pill, based on current filters.
	function applyFilterToPill(pill, data) {
		const li = pill.closest('li[class*="user"]');
		if (!li) return;
		li.style.display = passesFilter(data) ? '' : 'none';
	}

	// Re-sweep every rendered userlist pill against the current thresholds.
	// Uses cached stats — rows still loading (no cache) stay visible.
	function reapplyAllFilters() {
		document.querySelectorAll('.cl-pill[data-cl-uid]').forEach(pill => {
			const uid = pill.dataset.clUid;
			applyFilterToPill(pill, CACHE[uid]?.data || null);
		});
	}

	function todayStr() { return new Date().toISOString().split('T')[0]; }

	// Torn ships React CSS-module class names like `sidebar-block___CVVYK` where the
	// `___XXXXX` hash is regenerated on every deploy. Matching the exact hash breaks
	// the script whenever Torn rebuilds. Match the stable human-readable prefix
	// instead so selectors survive future hash changes.
	// q('sidebar-block')                  -> '[class*="sidebar-block___"]'
	// q('sidebar-block', 'content')       -> '[class*="sidebar-block___"] [class*="content___"]'
	function q(...prefixes) {
		return prefixes.map(p => `[class*="${p}___"]`).join(' ');
	}

	// First element matching any of the given module prefixes (in order), scoped to
	// `root` (defaults to document). Returns null if none match.
	function findByPrefix(root, ...prefixes) {
		const scope = root || document;
		for (const p of prefixes) {
			const el = scope.querySelector(`[class*="${p}___"]`);
			if (el) return el;
		}
		return null;
	}

	function activeTask(uid) { return getTasks().find(t => t.uid === uid && !t.done) ?? null; }

	function stripFaction(name) { return (name || '').replace(/\[.*?\]/g, '').trim(); }

	function sep() {
		const s = document.createElement('span');
		s.className = 'cl-pill-sep';
		return s;
	}

	// Inject text into a Torn React chatbox input
	function injectIntoChatbox(inputEl, text) {
		const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
			|| Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
		if (nativeSetter) nativeSetter.call(inputEl, text);
		else inputEl.value = text;
		inputEl.dispatchEvent(new Event('input',  { bubbles: true }));
		inputEl.dispatchEvent(new Event('change', { bubbles: true }));
		inputEl.focus();
	}

	function buildCompanySelect(id, selectedVal = '') {
		const sel = document.createElement('select');
		sel.id = id;
		const blank = document.createElement('option');
		blank.value = ''; blank.textContent = '-- None selected --';
		sel.appendChild(blank);
		COMPANIES.forEach(c => {
			const opt = document.createElement('option');
			opt.value = opt.textContent = c;
			if (c === selectedVal) opt.selected = true;
			sel.appendChild(opt);
		});
		return sel;
	}

	/**
	 * Upsert a single player's CRM state into Supabase.
	 * Called on every F/C/U button click.
	 * Fields: recruiter_id, target_id, f, c, u, name, notes, company, updated_at
	 */
	async function upsertCRMState(uid) {
		const s = CRM[uid] || {};
		await sbRequest('POST', 'crm_states', {
			recruiter_id: parseInt(CFG.MY_ID),
			target_id:    parseInt(uid),
			f:            s.F || 0,
			c:            s.C || 0,
			s:            s.S || 0,
			u:            s.U || 0,
			name:         s.name    || null,
			notes:        s.notes   || null,
			company:      s.company || null,
			manual_stats: s.manualStats || null,
			updated_at:   new Date().toISOString(),
		});
	}

	/**
	 * Load all CRM states for MY_ID from Supabase, merge into CRM object.
	 * Called once at boot. Returns when done.
	 */
	async function loadAllCRMStates() {
		// PostgREST caps a response at 1000 rows by default. A recruiter with >1000
		// CRM entries (Crealotte has ~1240) would only get the first 1000 — the rest
		// render as un-flagged ("state lost after refresh"). Page through in 1000-row
		// chunks via offset until a short page signals the end.
		const PAGE = 1000;
		// Only what changed since the last sync is downloaded (a full download once a day, or when there is nothing saved on this computer yet).
		if (!Object.keys(CRM).length) Object.assign(CRM, load(STORE.CRM, {}));
		const lastFull = load('RecruiterCrmFull', 0), since = load('RecruiterCrmSince', '');
		const fullSync = !since || !Object.keys(CRM).length || Date.now() - lastFull > 24 * 60 * 60 * 1000;
		let maxUpdated = since;
		let rows = [];
		for (let offset = 0; ; offset += PAGE) {
			const page = await sbRequest('GET', 'crm_states', {
				query: `recruiter_id=eq.${CFG.MY_ID}&select=target_id,f,c,s,u,name,notes,company,created_at,manual_stats,updated_at${fullSync ? '' : '&updated_at=gt.' + encodeURIComponent(since)}&order=target_id.asc&offset=${offset}&limit=${PAGE}`,
			});
			if (!Array.isArray(page)) break;       // error mid-paging — keep what we have
			rows = rows.concat(page);
			if (page.length < PAGE) break;          // last page reached
		}
		if (fullSync) save('RecruiterCrmFull', Date.now());
		if (!rows.length) return;
		rows.forEach(r => { if (r.updated_at && r.updated_at > maxUpdated) maxUpdated = r.updated_at; });
		if (maxUpdated) save('RecruiterCrmSince', maxUpdated);
		const isBadName = (n) => n && /torn|rpg/i.test(n);
		rows.forEach(row => {
			const uid = String(row.target_id);
			const cleanName = isBadName(row.name) ? null : row.name;
			CRM[uid] = {
				F:           row.f       ?? 0,
				C:           row.c       ?? 0,
				S:           row.s       ?? 0,
				U:           row.u       ?? 0,
				name:        cleanName    || CRM[uid]?.name    || null,
				notes:       row.notes    || CRM[uid]?.notes   || null,
				company:     row.company  || CRM[uid]?.company || null,
				createdAt:   row.created_at  || CRM[uid]?.createdAt   || null,
				manualStats: row.manual_stats || CRM[uid]?.manualStats || null,
			};
			// Wipe bad names from DB on next save
			if (isBadName(row.name)) upsertCRMState(uid);
		});
		console.log(`[CoreLabs] Loaded ${rows.length} CRM states from Supabase`);
		saveCRM(); // keep a copy on this computer: the next start only asks for what changed
	}

	/**
	 * Backfill names for CRM rows that were saved as name:null.
	 * Root cause: a row gets upserted on the first F/C/S click, before the player's
	 * name has loaded, so name:null is written and never updated — the row then
	 * shows as "ID: 123". The names already exist server-side in the `targets`
	 * table (written by autoHunt), so we copy them across in bulk — no Torn API
	 * calls, one read + one upsert per missing name. Runs at boot, after
	 * loadAllCRMStates has populated CRM.
	 */
	async function backfillMissingNames() {
		if (!CFG.MY_ID) return;

		const isBadName = (n) => !n || /torn|rpg/i.test(n);
		const missing = Object.keys(CRM).filter(uid => isBadName(CRM[uid]?.name));
		if (!missing.length) return;

		// Pull known names from `targets` in one request (dedupe ids first).
		const rows = await sbRequest('GET', 'targets', {
			query: `id=in.(${missing.join(',')})&select=id,name`,
		});
		if (!Array.isArray(rows)) return;

		const nameById = new Map();
		rows.forEach(r => {
			if (!isBadName(r.name) && !nameById.has(String(r.id))) nameById.set(String(r.id), stripFaction(r.name));
		});

		let fixed = 0;
		const stillMissing = [];
		for (const uid of missing) {
			const name = nameById.get(uid);
			if (!name) { stillMissing.push(uid); continue; }
			CRM[uid].name = name;
			await upsertCRMState(uid); // write the name back to crm_states
			fixed++;
		}
		if (fixed) { saveCRM(); console.log(`[CoreLabs] Backfilled ${fixed} name(s) from targets`); }

		// Fallback for rows whose name isn't in `targets` either: resolve via the Torn
		// API. The user/{id} endpoint takes ONE id per call (it ignores comma-lists),
		// so this is necessarily one request per player, throttled at HUNT_DELAY (2s →
		// ~30/min, well under Torn's 100/min cap). No per-boot limit — the whole backlog
		// is cleared in a single run (~2s × N in the background). It only runs while
		// "ID:" rows remain, so it stops itself once everything is named. Needs a key.
		if (stillMissing.length && CFG.API_KEY) {
			let apiFixed = 0, errors = 0;
			for (const uid of stillMissing) {
				await new Promise(r => setTimeout(r, CFG.HUNT_DELAY));
				try {
					const res  = await gmFetch(`https://api.torn.com/user/${uid}?selections=profile&key=${CFG.API_KEY}`);
					const data = JSON.parse(await res.text());
					// Abort the whole run on a key error (paused/invalid) — every call would
					// fail, so don't burn 2s per remaining id for nothing.
					if (data?.error) { if (++errors >= 2) break; else continue; }
					if (!data || isBadName(data.name)) continue;
					CRM[uid].name = stripFaction(data.name);
					await upsertCRMState(uid);
					apiFixed++;
				} catch { /* ignore — network blip, retried on next boot */ }
			}
			if (apiFixed) { saveCRM(); console.log(`[CoreLabs] Backfilled ${apiFixed} name(s) from Torn API`); }
		}
	}

	// ── Gateway transport ───────────────────────────────────────────────────────
	// Single door to the DB. Sends the caller's Torn API key so the function can
	// prove identity + check the license. The anon/service key is NOT here.
	async function gateway(op, table, { query, body } = {}) {
		if (!CFG.API_KEY) return null; // no key = no identity = no access
		try {
			const res  = await gmFetch(CFG.GATEWAY_URL, {
				method:  'POST',
				headers: { 'Content-Type': 'application/json' },
				body:    JSON.stringify({ apiKey: CFG.API_KEY, op, table, query, body, tornName: undefined }),
			});
			const text = await res.text();
			const data = text ? JSON.parse(text) : { ok: true };
			// The gateway returns { error } on 401/402/403 — surface it for callers
			// that care (writes) but don't crash reads.
			if (data && data.error) {
				console.warn(`[CoreLabs] gateway ${op} ${table}:`, data.error);
				return { error: data.error };
			}
			return data;
		} catch (e) {
			console.error('[CoreLabs] gateway:', e);
			return null;
		}
	}

	// Back-compat shim: the rest of the codebase calls sbRequest(method, table, {query|body}).
	// Map the old HTTP-verb signature onto the gateway op vocabulary so callers
	// don't all need touching.
	async function sbRequest(method, table, body = null) {
		const op =
			method === 'GET'    ? 'select'
			: method === 'POST'   ? 'insert'
			: method === 'PATCH'  ? 'update'
			: method === 'DELETE' ? 'delete'
			: 'select';
		if (method === 'GET') return gateway('select', table, { query: body?.query });
		return gateway(op, table, { body });
	}

	async function deleteCRMState(uid) {
		// recruiter_id scoping is enforced server-side by the gateway; we only pass
		// the target filter. The function appends recruiter_id=eq.<caller>.
		await gateway('delete', 'crm_states', { query: `target_id=eq.${uid}` });
	}

	async function autoHunt(playerIds, cloudIds) {
		const newIds = playerIds.filter(id => !cloudIds.includes(parseInt(id)));
		if (!newIds.length) return;

		// Torn API is still queried one player at a time (rate limit), but the DB
		// writes are BATCHED: we buffer scouted rows and flush them to the gateway in
		// one multi-row insert every BATCH_SIZE players (and once at the end). This
		// turns N gateway invocations into ceil(N / BATCH_SIZE) — e.g. a 50-name
		// UserList page = 50 calls -> ~3. PostgREST accepts a JSON array as a bulk
		// upsert (PK = id, merge-duplicates), so it's one round-trip per batch.
		const BATCH_SIZE = 20;
		let buffer = [];

		const flush = async () => {
			if (!buffer.length) return;
			const rows = buffer; buffer = [];
			const result = await sbRequest('POST', 'targets', rows);
			if (result?.error) console.error('[CoreLabs] Hunt batch rejected:', result);
		};

		let dirty = false;
		for (const uid of newIds) {
			await new Promise(r => setTimeout(r, CFG.HUNT_DELAY));
			try {
				const res  = await gmFetch(`https://api.torn.com/v2/user/${uid}?selections=profile,hof&key=${CFG.API_KEY}`);
				const data = JSON.parse(await res.text());
				if (!data || data.error) continue;

				const name = stripFaction(data.name || data.profile?.name || 'Unknown');
				const ws   = data.hof?.working_stats?.value || 0;

				buffer.push({
					id: parseInt(uid), name,
					work_stats: ws, work_total: ws,
					scouted_by: parseInt(CFG.MY_ID),
					last_updated: new Date().toISOString(),
				});

				if (!CRM[uid]) CRM[uid] = {};
				if (!CRM[uid].name) { CRM[uid].name = name; dirty = true; }

				if (buffer.length >= BATCH_SIZE) await flush();
			} catch (e) {
				console.error('[CoreLabs] Hunt error:', e);
			}
		}
		await flush();           // flush the tail
		if (dirty) saveCRM();    // persist names once, not per player
	}

	// ── License (paid status) ───────────────────────────────────────────────────
	// Self-read so the UI knows whether to enable write buttons. The gateway only
	// returns the caller's own row for non-admins, so this can't leak other users.
	// The REAL enforcement is server-side in the gateway — this is just UX.
	//
	// Cached to cut gateway invocations: instead of 1 license read on every page
	// load (~30/user/day), we read once and reuse for up to LICENSE_TTL. The cache
	// is SELF-LIMITING for correctness, not just freshness:
	//   - if paid_until is in the past -> ignore cache, re-check (catches expiry)
	//   - if the cache says unpaid -> shorter recheck window (catches a fresh payment
	//     faster, so a user who just sent xanax unlocks within minutes, not hours)
	// Result: paid users skip almost all license reads; unpaid users re-check often
	// enough that paying feels responsive.
	const LICENSE_TTL_PAID   = 6 * 60 * 60 * 1000; // paid: trust cache 6h
	const LICENSE_TTL_UNPAID = 3 * 60 * 1000;      // unpaid: re-check every 3 min

	function applyLicense(lic) {
		if (lic) {
			const paid =
				lic.status === 'banned' ? false
				: lic.paid_until === 'infinity' ? true
				: lic.paid_until ? new Date(lic.paid_until).getTime() > Date.now()
				: lic.status === 'paid';
			CFG.PAID     = !!paid;
			CFG.IS_ADMIN = !!lic.is_admin;
		} else {
			CFG.PAID = false; CFG.IS_ADMIN = false;
		}
		return lic;
	}

	async function loadMyLicense({ force = false } = {}) {
		// 1. Try the cache first.
		const cached = load(STORE.LICENSE, null);
		if (!force && cached && cached.ts) {
			const age = Date.now() - cached.ts;
			const lic = cached.lic;
			const ttl = CFG.PAID || (lic && lic.status === 'paid') ? LICENSE_TTL_PAID : LICENSE_TTL_UNPAID;
			// paid_until in the past invalidates a "paid" cache immediately.
			const expired = lic?.paid_until && lic.paid_until !== 'infinity'
				&& new Date(lic.paid_until).getTime() <= Date.now();
			if (age < ttl && !expired) {
				applyLicense(lic);
				console.log(`[CoreLabs] License (cache ${Math.round(age/1000)}s) — paid:${CFG.PAID} admin:${CFG.IS_ADMIN}`);
				return lic;
			}
		}

		// 2. Cache miss/stale/forced -> hit the gateway, then store.
		// A forced refresh (the dashboard's "Refresh status" button) also asks the gateway to look at the xanax the owner received, once: the payment poller no longer runs by itself.
		let lic = null;
		if (force) { const chk = await gateway('check-payment', null, {}); if (chk && chk.license) lic = chk.license; }
		if (!lic) { const rows = await gateway('select', 'licenses', {}); lic = Array.isArray(rows) ? rows[0] : null; }
		applyLicense(lic);
		save(STORE.LICENSE, { ts: Date.now(), lic: lic || null });
		console.log(`[CoreLabs] License (fresh) — paid:${CFG.PAID} admin:${CFG.IS_ADMIN}`);
		return lic;
	}

	// ── Pricing / settings (read-only in the script) ────────────────────────────
	// Any verified user can read the price (gateway strips poller fields for them),
	// so the Settings tab can show "send N xanax to unlock". All ADMIN management
	// (set price, grant/ban users, payments) lives on the separate Vercel admin
	// site, NOT in this public script.
	async function loadSettings() {
		const rows = await gateway('select', 'app_settings', { query: 'id=eq.1&select=*' });
		return Array.isArray(rows) ? rows[0] : null;
	}

	async function loadTickets() {
		return sbRequest('GET', 'tickets', {
			query: 'select=id,title,description,created_by,status,created_at&order=created_at.desc',
		});
	}

	async function createTicket(title, description) {
		return sbRequest('POST', 'tickets', {
			title,
			description,
			created_by: String(CFG.MY_ID),
			status:     'todo',
			created_at: new Date().toISOString(),
		});
	}

	async function updateTicketStatus(id, status) {
		const res = await gateway('update', 'tickets', { query: `id=eq.${id}`, body: { status } });
		return res && !res.error ? { ok: true } : null;
	}

	async function deleteTicket(id) {
		await gateway('delete', 'tickets', { query: `id=eq.${id}` });
	}

	async function pageScan(isRetry = false) {
		// Only the UserList page is scanned, and only the rows that are shown (not hidden by a filter). Players on other pages are no longer collected.
		if (!window.location.href.includes('sid=UserList')) return;
		const root  = document.querySelector('#mainContainer') || document;
		const links = root.querySelectorAll('.userlist-wrapper li[class*="user"] a[href*="XID="]');

		if (!links.length && !isRetry) { setTimeout(() => pageScan(true), 3000); return; }

		const ids = [];
		links.forEach(link => {
			if (link.closest('#chat-container') || link.closest('.sidebar')) return;
			const rowLi = link.closest('li');
			if (!rowLi || rowLi.classList.contains('tt-hidden') || rowLi.style.display === 'none' || rowLi.offsetParent === null) return;
			const m = link.href.match(/XID=(\d+)/);
			if (m && !ids.includes(m[1])) ids.push(m[1]);
		});
		if (!ids.length) return;

		// Try the extended select (with the shared pill-stat columns). If migration
		// 0006 hasn't been applied yet, those columns don't exist and PostgREST 400s
		// — fall back to the base columns so pageScan never breaks during rollout.
		let cloud = await sbRequest('GET', 'targets', {
			query: `id=in.(${ids.join(',')})&select=id,name,work_stats,work_total,xanax,war_hits,streak,last_updated`,
		});
		if (cloud && cloud.error) {
			cloud = await sbRequest('GET', 'targets', {
				query: `id=in.(${ids.join(',')})&select=id,name,work_stats,work_total,last_updated`,
			});
		}

		const cloudIds = [];
		let dirty = false;
		if (Array.isArray(cloud)) {
			cloud.forEach(p => {
				cloudIds.push(p.id);
				const sid = String(p.id);
				if (p.name && !CRM[sid]?.name) {
					if (!CRM[sid]) CRM[sid] = {};
					CRM[sid].name = stripFaction(p.name);
					dirty = true;
				}
				// Seed the SHARED stats cache from the DB. If this row was refreshed by
				// ANY user within the cache window, the pill uses it directly — no Torn
				// call. This is what pools everyone's API budget (cache 7 days).
				seedSharedStat(p);
			});
			if (dirty) saveCRM();
			// Now that SHARED_STATS is seeded, re-resolve any pill still on "…" so it
			// uses the shared cache instead of waiting on a Torn call. Dispatched as an
			// event to avoid a static import cycle (supabase.js ↔ pill.js).
			document.dispatchEvent(new CustomEvent('cl-shared-seeded'));
		}
		autoHunt(ids, cloudIds);
	}

	// ── Shared pill-stats cache (DB-backed, mutualised across all users) ──────────
	// SHARED_STATS[uid] = { data:{xan,act,ws,streak,name}, ts } from the `targets`
	// table. Freshness window = 7 days. The pill checks this before calling Torn.
	const SHARED_STATS = {};
	const SHARED_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

	// A targets row counts as a usable shared stat only if it has real pill data
	// (not just a name placeholder). We require at least one of the numeric stats
	// to be non-null so a name-only row doesn't mask a needed Torn fetch.
	function seedSharedStat(p) {
		if (!p || p.id == null) return;
		const hasStats = p.xanax != null || p.war_hits != null || p.work_stats != null || p.streak != null;
		if (!hasStats) return;
		const ts = p.last_updated ? new Date(p.last_updated).getTime() : 0;
		SHARED_STATS[String(p.id)] = {
			ts,
			data: {
				xan:    Number(p.xanax)     || 0,
				act:    Number(p.war_hits)  || 0,
				ws:     Number(p.work_stats) || 0,
				streak: Number(p.streak)    || 0,
				name:   p.name || null,
			},
		};
	}

	// Write the 4 pill stats back to the shared targets table after a Torn fetch,
	// so the next user (any account) reads them from the DB instead of Torn.
	async function writeSharedStat(uid, data) {
		if (!CFG.MY_ID) return;
		await sbRequest('POST', 'targets', {
			id:           parseInt(uid),
			name:         data.name || null,
			work_stats:   data.ws || 0,
			work_total:   data.ws || 0,
			xanax:        data.xan || 0,
			war_hits:     data.act || 0,
			streak:       data.streak || 0,
			scouted_by:   parseInt(CFG.MY_ID),
			last_updated: new Date().toISOString(),
		});
	}

	function openFollowUp(uid) {
		document.getElementById('cl-fu')?.remove();

		const state = CRM[uid] || {};
		const task  = activeTask(uid);

		const overlay = document.createElement('div');
		overlay.id = 'cl-fu'; overlay.className = 'cl-overlay';

		const modal = document.createElement('div');
		modal.style.cssText = 'background:#1e1e1e;color:#fff;padding:0;border-radius:10px;border:1px solid #383838;width:380px;box-sizing:border-box;overflow:hidden;';

		const header = document.createElement('div');
		header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #2c2c2c;background:#252525;';
		const hTitle = document.createElement('div');
		hTitle.style.cssText = 'font-size:13px;font-weight:bold;color:#fff;';
		const isBadName = (n) => !n || /torn|rpg/i.test(n);
		const displayName = !isBadName(state.name) ? state.name
			: !isBadName(CACHE[uid]?.data?.name) ? CACHE[uid].data.name
			: `ID: ${uid}`;
		hTitle.textContent = `Follow-Up — ${displayName}`;
		const hClose = document.createElement('span');
		hClose.textContent = '✕';
		hClose.style.cssText = 'cursor:pointer;color:#666;font-size:16px;line-height:1;';
		hClose.onclick = () => overlay.remove();
		header.append(hTitle, hClose);

		const body = document.createElement('div');
		body.style.cssText = 'padding:16px 18px;display:flex;flex-direction:column;gap:12px;';

		function field(labelText, el) {
			const wrap = document.createElement('div');
			wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
			const lbl = document.createElement('label');
			lbl.textContent = labelText;
			lbl.style.cssText = 'font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;';
			wrap.append(lbl, el);
			return wrap;
		}

		const inputStyle = 'background:#2a2a2a;border:1px solid #383838;border-radius:6px;color:#fff;padding:8px 10px;font-size:13px;width:100%;box-sizing:border-box;outline:none;';

		const inDate = document.createElement('input');
		inDate.type = 'date'; inDate.value = task?.date || '';
		inDate.style.cssText = inputStyle + 'cursor:pointer;';
		inDate.onclick = () => { try { inDate.showPicker(); } catch {} };

		const selComp = buildCompanySelect('cl-fu-comp', state.company || '');
		selComp.style.cssText = inputStyle + 'appearance:auto;';

		const txtNote = document.createElement('textarea');
		txtNote.rows = 3; txtNote.placeholder = 'Add notes...'; txtNote.value = state.notes || '';
		txtNote.style.cssText = inputStyle + 'resize:vertical;font-family:inherit;';

		const ms = state.manualStats || {};
		const wsRow = document.createElement('div');
		wsRow.style.cssText = 'display:flex;gap:6px;';
		const numStyle = inputStyle + 'text-align:right;';
		const inManual = document.createElement('input');
		inManual.type = 'number'; inManual.placeholder = 'Manual'; inManual.min = '0';
		inManual.value = ms.manual ?? ''; inManual.style.cssText = numStyle;
		const inIntel = document.createElement('input');
		inIntel.type = 'number'; inIntel.placeholder = 'Intelligence'; inIntel.min = '0';
		inIntel.value = ms.intelligence ?? ''; inIntel.style.cssText = numStyle;
		const inEnd = document.createElement('input');
		inEnd.type = 'number'; inEnd.placeholder = 'Endurance'; inEnd.min = '0';
		inEnd.value = ms.endurance ?? ''; inEnd.style.cssText = numStyle;
		wsRow.append(inManual, inIntel, inEnd);

		body.append(
			field('Follow-Up Date', inDate),
			field('Company They Want', selComp),
			field('Work Stats (Manual / Intel / Endurance)', wsRow),
			field('Notes', txtNote),
		);

		const footer = document.createElement('div');
		footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid #2c2c2c;background:#252525;';

		const btnCancel = document.createElement('button');
		btnCancel.textContent = 'Cancel';
		btnCancel.style.cssText = 'background:transparent;border:1px solid #444;color:#aaa;padding:7px 16px;border-radius:6px;font-size:12px;cursor:pointer;';
		btnCancel.onclick = () => overlay.remove();

		const btnSave = document.createElement('button');
		btnSave.textContent = 'Save Follow-Up';
		btnSave.style.cssText = 'background:#c96000;border:none;color:#fff;padding:7px 16px;border-radius:6px;font-size:12px;font-weight:bold;cursor:pointer;';
		btnSave.onclick = () => {
			if (!CRM[uid]) CRM[uid] = {};
			CRM[uid].notes   = txtNote.value;
			CRM[uid].company = selComp.value;
			const m = inManual.value === '' ? null : Number(inManual.value);
			const i = inIntel.value  === '' ? null : Number(inIntel.value);
			const e = inEnd.value    === '' ? null : Number(inEnd.value);
			CRM[uid].manualStats = (m !== null || i !== null || e !== null)
				? { manual: m, intelligence: i, endurance: e }
				: null;
			filterTasks(t => t.uid !== uid);
			if (inDate.value) pushTask({ uid, date: inDate.value, done: false });
			upsertCRMState(uid); saveTasks();
			overlay.remove();
		};

		footer.append(btnCancel, btnSave);
		modal.append(header, body, footer);
		overlay.appendChild(modal);
		document.body.appendChild(overlay);
		overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
	}

	async function postToDiscord(ws, comp, notes) {
		const r = await gmFetch(CFG.DISCORD_WEBHOOK, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ embeds: [{ title: '💰 NEW BLIND LEAD GENERATED', color: 3447003, fields: [
				{ name: '📊 Work Stats',     value: `**${ws}**`,          inline: true },
				{ name: '🏢 Target Job',      value: `**${comp}**`,        inline: true },
				{ name: '📝 Recruiter Notes', value: notes || 'No notes.' },
				{ name: '🔒 Identity',         value: 'REDACTED' },
			], footer: { text: 'Elite Brokerage System' }, timestamp: new Date() }] }),
		});
		if (r.ok) alert('Lead Posted!');
	}

	function openBroker(currentWS = '0') {
		document.getElementById('cl-broker-overlay')?.remove();

		const overlay = document.createElement('div');
		overlay.id = 'cl-broker-overlay'; overlay.className = 'cl-overlay';

		const modal = document.createElement('div');
		modal.style.cssText = 'background:#1e1e1e;color:#fff;padding:0;border-radius:10px;border:1px solid #383838;width:380px;box-sizing:border-box;overflow:hidden;';

		const header = document.createElement('div');
		header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #2c2c2c;background:#252525;';
		const hTitle = document.createElement('div');
		hTitle.style.cssText = 'font-size:13px;font-weight:bold;color:#fff;';
		hTitle.textContent = 'Create Blind Lead';
		const hClose = document.createElement('span');
		hClose.textContent = '✕';
		hClose.style.cssText = 'cursor:pointer;color:#666;font-size:16px;line-height:1;';
		hClose.onclick = () => overlay.remove();
		header.append(hTitle, hClose);

		const body = document.createElement('div');
		body.style.cssText = 'padding:16px 18px;';

		const lblComp = document.createElement('div');
		lblComp.style.cssText = 'font-size:10px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;';
		lblComp.textContent = 'Target Company';

		const sel = buildCompanySelect('cl-b-comp');
		sel.style.cssText = 'width:100%;background:#111;color:#ddd;border:1px solid #333;border-radius:6px;padding:8px;font-size:12px;box-sizing:border-box;margin-bottom:12px;';

		const lblWS = document.createElement('div');
		lblWS.style.cssText = 'font-size:10px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;';
		lblWS.textContent = `Work Stats: ${currentWS}`;

		const lblNote = document.createElement('div');
		lblNote.style.cssText = 'font-size:10px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;margin-top:4px;';
		lblNote.textContent = 'Notes';

		const txt = document.createElement('textarea');
		txt.rows = 3; txt.placeholder = 'Additional notes...';
		txt.style.cssText = 'width:100%;background:#111;color:#ddd;border:1px solid #333;border-radius:6px;padding:10px;font-size:12px;resize:vertical;box-sizing:border-box;font-family:inherit;';

		body.append(lblComp, sel, lblWS, lblNote, txt);

		const footer = document.createElement('div');
		footer.style.cssText = 'display:flex;gap:8px;padding:12px 18px;border-top:1px solid #2c2c2c;background:#252525;';

		const btnNo = document.createElement('button');
		btnNo.style.cssText = 'flex:1;background:none;border:1px solid #383838;color:#666;padding:8px;border-radius:4px;font-size:12px;cursor:pointer;';
		btnNo.textContent = 'Cancel';

		const btnOk = document.createElement('button');
		btnOk.style.cssText = 'flex:2;background:#c96000;border:none;color:#fff;padding:8px;border-radius:4px;font-size:12px;font-weight:bold;cursor:pointer;';
		btnOk.textContent = 'Post Blind Lead';

		footer.append(btnNo, btnOk);
		modal.append(header, body, footer);
		overlay.appendChild(modal);
		document.body.appendChild(overlay);

		const close = () => overlay.remove();
		btnOk.onclick = () => { postToDiscord(currentWS, sel.value, txt.value); close(); };
		btnNo.onclick = close;
		overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
	}

	// All buttons: label stays fixed, only color changes
	const BTN_DEFS = [
		{ id: 'F', labels: ['F','F','F','F'], colors: ['cl-grey','cl-yellow','cl-green','cl-red'] },
		{ id: 'C', labels: ['C','C','C','C'], colors: ['cl-grey','cl-yellow','cl-green','cl-red'] },
		{ id: 'S', labels: ['S','S','S','S'], colors: ['cl-grey','cl-yellow','cl-green','cl-red'] },
	];
	const U_DEF = { id: 'U', labels: ['U','U'], colors: ['cl-grey','cl-blue'] }; // U = Useless

	function setUselessRow(btn, uid, isUseless) {
		const li = btn.closest('li[class*="user"]');
		if (li) li.classList.toggle('cl-useless', isUseless);
	}

	function makeCRMButtons(uid, { withU = true, withActions = false } = {}) {
		const wrap  = document.createElement('div'); wrap.style.cssText = 'display:flex;align-items:center;gap:4px;';
		wrap.dataset.clUid      = uid;
		wrap.dataset.clWithU    = withU ? '1' : '';
		wrap.dataset.clWithAct  = withActions ? '1' : '';
		const group = document.createElement('div'); group.className = 'cl-crm-group';

		// Unpaid users see the buttons but can't toggle them (reflects their license).
		// The gateway also rejects the write server-side — this is the visible half.
		const locked = !CFG.PAID;
		if (locked) wrap.classList.add('cl-locked');

		const prefs = loadBtnPrefs();
		const visibleDefs = BTN_DEFS.filter(d => prefs[d.id] !== false);
		const defs = withU ? [...visibleDefs, U_DEF] : [...visibleDefs];
		defs.forEach(def => {
			const state = CRM[uid] || {};
			let idx = state[def.id] || 0;
			const btn = document.createElement('div');
			btn.className = `cl-crm-btn ${def.colors[idx]}${locked ? ' cl-btn-disabled' : ''}`;
			btn.textContent = def.labels[idx];
			if (locked) btn.title = 'Subscription required — send xanax to unlock (see CRM Dashboard)';

			// Apply useless dim on mount if U already set
			if (def.id === 'U' && idx === 1) {
				requestAnimationFrame(() => setUselessRow(btn, uid, true));
			}

			btn.onclick = e => {
				e.preventDefault(); e.stopPropagation();
				// Bounce unpaid users to the dashboard config tab. Dispatched as an event
				// so crmButtons doesn't import dashboard (avoids a circular dependency);
				// main.js wires the listener.
				if (locked) { document.dispatchEvent(new CustomEvent('cl-open-dashboard', { detail: 'config' })); return; }
				idx = (idx + 1) % def.labels.length;
				btn.className   = `cl-crm-btn ${def.colors[idx]}`;
				btn.textContent = def.labels[idx];
				if (!CRM[uid]) CRM[uid] = {};
				CRM[uid][def.id] = idx;
				if (CRM[uid].name) CRM[uid].name = stripFaction(CRM[uid].name);
				if (def.id === 'U') setUselessRow(btn, uid, idx === 1);
				upsertCRMState(uid);
			};
			group.appendChild(btn);
		});
		wrap.appendChild(group);

		if (withActions) {
			const acts = document.createElement('div'); acts.className = 'cl-act-group';

			const cal = document.createElement('span'); cal.className = 'cl-act-icon'; cal.textContent = '📅';
			cal.onclick = e => {
				e.preventDefault(); e.stopPropagation();
				// If clicked inside a chat window, capture the chat title as the player name
				if (!CRM[uid]?.name) {
					const chatBox = cal.closest('[id^="private-"], #chatRoot div[id]');
					const chatTitle = chatBox?.querySelector('[class*="title___"]')?.textContent?.trim();
					if (chatTitle) {
						if (!CRM[uid]) CRM[uid] = {};
						CRM[uid].name = chatTitle;
					}
				}
				openFollowUp(uid);
			};

			const brk = document.createElement('span'); brk.className = 'cl-act-icon'; brk.textContent = '💼';
			brk.onclick = () => openBroker(fmt(CACHE[uid]?.data?.ws || 0));

			acts.append(cal, brk);
			wrap.appendChild(sep());
			wrap.appendChild(acts);
		}
		return wrap;
	}

	// A CRM row exists for this uid only once the recruiter has flagged it (F/C/S/U)
	// or set a name/notes. We must not create empty rows for every passer-by.
	function hasCRMRow(uid) {
		const s = CRM[uid];
		return !!s && ((s.F || 0) > 0 || (s.C || 0) > 0 || (s.S || 0) > 0 || (s.U || 0) > 0 || s.notes || s.company);
	}

	// ── Torn API concurrency limiter ──────────────────────────────────────────────
	// A UserList page renders ~50 pills at once, each firing 2 Torn calls = ~100
	// requests in one burst → Torn's 100/min limit trips → errors → zero/blank rows.
	// We funnel every pill fetch through a queue that runs at most MAX_CONCURRENT at
	// a time, with a small gap between starts. Rows show "…" until their turn — no
	// more rate-limit wipeouts.
	const MAX_CONCURRENT = 3;
	const GAP_MS = 120;
	const MAX_RETRIES = 8;        // give up after this many failed attempts per pill
	const RETRY_BASE_MS = 4000;   // backoff base; grows with attempt count
	let _active = 0;
	const _queue = [];

	function _pump() {
		if (_active >= MAX_CONCURRENT || !_queue.length) return;
		const job = _queue.shift();
		_active++;
		Promise.resolve(job()).finally(() => {
			_active--;
			setTimeout(_pump, GAP_MS);
		});
		// Start another if we still have headroom.
		if (_active < MAX_CONCURRENT) setTimeout(_pump, GAP_MS);
	}

	// Enqueue a pill fetch. `attempt` tracks retries: a fetch that fails (Torn rate
	// limit / network) RE-QUEUES itself with backoff instead of leaving the pill
	// stuck on "…" forever (the bug where only F5 fixed it). fetchAndRender returns
	// true on success, false if it should be retried.
	function enqueueFetch(uid, pill, attempt = 0) {
		_queue.push(async () => {
			if (!pill.isConnected) return;            // pill gone (navigated away) — drop
			const ok = await fetchAndRender(uid, pill);
			if (!ok && attempt < MAX_RETRIES && pill.isConnected) {
				const delay = RETRY_BASE_MS * (attempt + 1); // 4s, 8s, 12s, …
				setTimeout(() => enqueueFetch(uid, pill, attempt + 1), delay);
			}
		});
		_pump();
	}

	function createPill(uid) {
		const pill = document.createElement('div'); pill.className = 'cl-pill';
		pill.dataset.clUid = uid;

		const xan    = document.createElement('span'); xan.className    = 'cl-xan';    xan.dataset.cl    = 'xan';
		xan.innerHTML    = '<span class="cl-pill-ico">💊</span><span class="cl-pill-val">…</span>';
		const act    = document.createElement('span'); act.className    = 'cl-act';    act.dataset.cl    = 'act';
		act.innerHTML    = '<span class="cl-pill-ico">⚔️</span><span class="cl-pill-val">…</span>';
		const streak = document.createElement('span'); streak.className = 'cl-streak'; streak.dataset.cl = 'streak';
		streak.innerHTML = '<span class="cl-pill-ico">🔥</span><span class="cl-pill-val">…</span>';
		const ws     = document.createElement('span'); ws.className     = 'cl-ws';     ws.dataset.cl     = 'ws';
		ws.innerHTML     = '<span class="cl-pill-ico">💼</span><span class="cl-pill-val">…</span>';

		pill.append(xan, act, streak, ws, sep());
		pill.appendChild(makeCRMButtons(uid, { withU: true, withActions: true }));
		return pill;
	}

	function updatePill(pill, data) {
		pill.querySelector('[data-cl="xan"] .cl-pill-val').textContent    = fmt(data.xan);
		pill.querySelector('[data-cl="act"] .cl-pill-val').textContent    = fmt(data.act);
		pill.querySelector('[data-cl="streak"] .cl-pill-val').textContent = String(data.streak);
		pill.querySelector('[data-cl="ws"] .cl-pill-val').textContent     = fmt(data.ws);
		applyFilterToPill(pill, data);
	}

	// Re-resolve any pill still showing "…" — called after pageScan() has seeded
	// SHARED_STATS from the DB, so pills that were about to hit Torn can instead be
	// served from the shared cache. Without this, the boot order (pills render
	// before pageScan finishes loading the shared stats) meant the shared cache was
	// never consulted and every player hit Torn.
	function refreshPendingPills() {
		document.querySelectorAll('.cl-pill[data-cl-uid]').forEach(pill => {
			const uid = pill.dataset.clUid;
			const valEl = pill.querySelector('[data-cl="ws"] .cl-pill-val');
			// Only touch pills that haven't resolved yet (still "…") and that now have
			// a fresh shared entry available.
			const stillLoading = valEl && valEl.textContent === '…';
			const shared = SHARED_STATS[uid];
			const sharedFresh = shared && shared.ts && (Date.now() - shared.ts < SHARED_TTL)
				&& (shared.data.xan || shared.data.act || shared.data.streak || shared.data.ws);
			if (stillLoading && sharedFresh) {
				console.log(`%c[CoreLabs] ${uid} ${shared.data.name || ''} → SUPABASE shared cache (seeded, no Torn call)`, 'color:#74c0fc');
				CACHE[uid] = { ts: shared.ts, data: shared.data };
				saveCache();
				updatePill(pill, shared.data);
			}
		});
	}

	// Only the players that are really shown get their stats fetched. Torn's own filters hide rows a moment after they are drawn, so the check waits a little;
	// a row that is hidden is watched and fetched when it comes back. (Other places, like a chat or a profile, fetch straight away.)
	const rowHidden = li => !li || li.classList.contains('tt-hidden') || li.style.display === 'none' || li.offsetParent === null;
	function fetchWhenVisible(uid, pill) {
		if (!pill.closest('li[class*="user"]')) { enqueueFetch(uid, pill); return; }
		setTimeout(() => {
			if (!pill.isConnected) return;
			const li = pill.closest('li[class*="user"]');
			if (!rowHidden(li)) { enqueueFetch(uid, pill); return; }
			const mo = new MutationObserver(() => {
				if (!pill.isConnected) { mo.disconnect(); return; }
				if (!rowHidden(li)) { mo.disconnect(); enqueueFetch(uid, pill); }
			});
			mo.observe(li, { attributes: true, attributeFilter: ['class', 'style'] });
		}, 1500);
	}

	function ensurePill(uid, container) {
		let pill = container.querySelector('.cl-pill');
		if (!pill) {
			pill = createPill(uid);
			container.appendChild(pill);
		}

		const entry = CACHE[uid];
		// A cached entry where xan AND act AND streak are all 0 is almost always a
		// stale rate-limit artifact: those three come from the profile+personalstats
		// call, and when THAT call failed the old code cached three zeros (while ws,
		// from the separate hof call, may have succeeded — hence rows like
		// "0/0/0/124K"). A real active player having literally 0 xanax, 0 war hits
		// AND 0 streak is vanishingly rare. Treat such entries as stale → re-fetch,
		// so frozen-zero rows self-heal instead of sticking for 72h. ws is ignored in
		// this test on purpose (it loads independently).
		const looksStale = entry && !entry.data.xan && !entry.data.act && !entry.data.streak;
		if (entry && Date.now() - entry.ts < CFG.CACHE_TTL && !looksStale) {
			const ageH = Math.round((Date.now() - entry.ts) / 3600000);
			console.log(`%c[CoreLabs] ${uid} ${entry.data.name || ''} → LOCAL cache (${ageH}h old)`, 'color:#51cf66');
			updatePill(pill, entry.data);
			return;
		}

		// SHARED cache (DB-backed, mutualised across all users). If any recruiter
		// refreshed this player within the 7-day window, use it — NO Torn call, no
		// "…". This is what pools everyone's API budget. Also mirror it into the
		// local cache so subsequent renders this session are instant.
		const shared = SHARED_STATS[uid];
		const sharedFresh = shared && shared.ts && (Date.now() - shared.ts < SHARED_TTL)
			&& (shared.data.xan || shared.data.act || shared.data.streak || shared.data.ws);
		if (sharedFresh) {
			const ageH = Math.round((Date.now() - shared.ts) / 3600000);
			console.log(`%c[CoreLabs] ${uid} ${shared.data.name || ''} → SUPABASE shared cache (${ageH}h old, no Torn call)`, 'color:#74c0fc');
			CACHE[uid] = { ts: shared.ts, data: shared.data };
			saveCache();
			updatePill(pill, shared.data);
			return;
		}

		if (entry) updatePill(pill, entry.data); // show stale values while refetching

		console.log(`%c[CoreLabs] ${uid} → calling Torn API (not in cache / stale)`, 'color:#ffd43b');

		// Throttled — queued so a 50-row UserList doesn't burst 100 Torn calls.
		fetchWhenVisible(uid, pill);
	}

	// Returns true on success, false if the caller should retry (Torn busy / bad
	// response / network). The retry keeps "…" pills from sticking until F5.
	async function fetchAndRender(uid, pill) {
		try {
			const [uRes, hRes] = await Promise.all([
				gmFetch(`https://api.torn.com/user/${uid}?selections=profile,personalstats&key=${CFG.API_KEY}`),
				gmFetch(`https://api.torn.com/v2/user/${uid}/hof?key=${CFG.API_KEY}`),
			]);
			const d = JSON.parse(await uRes.text());
			const h = JSON.parse(await hRes.text());

			if (!pill.isConnected) return true; // pill gone — nothing to retry

			// CRITICAL: a Torn error (rate limit code 5, bad key, etc.) is NOT a profile.
			// d.personalstats is then undefined and every stat would fall back to 0 —
			// which used to get cached for 72h, freezing the row at "0 / 0 / 0 / 0" even
			// after Torn recovered (the "sooo many 0s" bug). Detect the error, DON'T
			// write a zero cache; return false so the queue retries with backoff.
			if (d?.error || h?.error) {
				console.warn(`[CoreLabs] Torn API busy for ${uid} (${d?.error?.error || h?.error?.error}) — will retry`);
				return false;
			}
			// Defensive: if the profile block is missing entirely, it's not a usable
			// response either — retry rather than cache zeros.
			if (!d.personalstats) return false;

			if (d.name) {
				if (!CRM[uid]) CRM[uid] = {};
				const resolved = stripFaction(d.name);
				const nameChanged = CRM[uid].name !== resolved;
				CRM[uid].name = resolved;
				saveCRM();
				// Persist the name to Supabase too — otherwise a row flagged before the
				// name loaded stays name:null forever and shows as "ID: 123" on reload /
				// other devices. Only push when a CRM row already exists for this uid.
				if (nameChanged && hasCRMRow(uid)) upsertCRMState(uid);
			}

			const data = {
				xan:    d.personalstats?.xantaken || 0,
				act:    d.personalstats?.rankedwarhits || 0,
				ws:     h?.hof?.working_stats?.value || 0,
				streak: d.personalstats?.activestreak || 0,
				name:   CRM[uid]?.name || stripFaction(d.name || '') || null,
			};
			CACHE[uid] = { ts: Date.now(), data };
			saveCache();
			updatePill(pill, data);

			// Push the fresh stats to the SHARED targets table so every other user
			// reads them from the DB for the next 7 days instead of calling Torn.
			// Fire-and-forget — the pill is already rendered.
			console.log(`%c[CoreLabs] ${uid} ${data.name || ''} → fetched from Torn, writing to Supabase shared cache`, 'color:#ffa94d');
			writeSharedStat(uid, data).catch(() => {});
			return true;
		} catch (e) {
			console.error('[CoreLabs] API error:', e);
			return false; // network blip — let the queue retry
		}
	}

	function openDashboard(initialTab) {
		document.getElementById('cl-dash')?.remove();

		const overlay = document.createElement('div');
		overlay.id = 'cl-dash'; overlay.className = 'cl-dash-overlay';

		const modal = document.createElement('div'); modal.className = 'cl-dash-modal';

		const closeBtn = document.createElement('button'); closeBtn.className = 'cl-dash-close'; closeBtn.textContent = '✕';
		closeBtn.onclick = () => overlay.remove();

		// ── Tab bar ───────────────────────────────────────────────────────────────
		const tabBar = document.createElement('div');
		tabBar.style.cssText = 'display:flex;gap:0;border-bottom:1px solid #333;margin-bottom:20px;';

		const hasApiKey  = !!CFG.API_KEY;
		const isOwner    = !!CFG.IS_ADMIN; // set at boot from the licenses self-read
		const hasTodo    = ['2353554', '2645743'].includes(String(CFG.MY_ID));
		console.log('[CoreLabs] Dashboard opened — MY_ID:', CFG.MY_ID, 'admin:', isOwner, 'paid:', CFG.PAID);

		const tabCRM      = makeTab('CRM',          () => showTab('crm'));
		const tabTemplates = makeTab('⚙ Templates', () => showTab('settings'));
		const tabConfig    = makeTab('⚙ Settings',  () => showTab('config'));
		const tabTodo      = makeTab('📋 TODO',      () => showTab('todo'));

		if (hasApiKey) {
			tabBar.append(tabCRM, tabTemplates, tabConfig);
			if (hasTodo) tabBar.append(tabTodo);
		} else {
			tabBar.append(tabConfig);
		}

		function makeTab(label, onClick) {
			const t = document.createElement('div');
			t.style.cssText = 'padding:8px 18px;font-size:12px;cursor:pointer;border-bottom:2px solid transparent;color:#888;transition:.1s;';
			t.textContent = label;
			t.onclick = onClick;
			return t;
		}

		function setActiveTab(tab) {
			[tabCRM, tabTemplates, tabConfig, tabTodo].forEach(t => {
				t.style.borderBottomColor = 'transparent';
				t.style.color = '#888';
			});
			tab.style.borderBottomColor = '#37b3f9';
			tab.style.color = '#37b3f9';
		}

		// ── CRM content ───────────────────────────────────────────────────────────
		const crmContent = document.createElement('div');

		const table = document.createElement('table'); table.className = 'cl-dash-table';
		const thead = table.createTHead();
		thead.innerHTML = `<tr>
		<th style="width:180px;">Player</th><th style="width:80px;">ID</th>
		<th style="width:90px;">Added</th>
		<th style="width:90px;">Status</th><th style="width:120px;">Follow-Up</th>
		<th style="width:130px;">Company Want</th>
		<th style="width:90px;">Work Stats</th>
		<th>Notes</th><th style="text-align:center;width:70px;">Done</th>
	</tr>`;

		const tbody = table.createTBody();
		const today = todayStr();

		const allUids = new Set([
			...Object.keys(CRM),
			...getTasks().filter(t => !t.done).map(t => t.uid),
		]);

		const entries = [...allUids]
			.filter(uid => { const p = CRM[uid] || {}; return (p.F || 0) > 0 || (p.C || 0) > 0 || (p.S || 0) > 0 || activeTask(uid); })
			.sort((a, b) => {
				const tA = activeTask(a), tB = activeTask(b);
				if (tA && tB) return tA.date < tB.date ? -1 : 1;
				if (tA) return -1;
				if (tB) return 1;
				const nA = (CRM[a]?.name || CACHE[a]?.data?.name || '').toLowerCase();
				const nB = (CRM[b]?.name || CACHE[b]?.data?.name || '').toLowerCase();
				return nA < nB ? -1 : nA > nB ? 1 : 0;
			});

		if (!entries.length) {
			const empty = tbody.insertRow();
			empty.insertCell().colSpan = 9;
			empty.cells[0].style.cssText = 'padding:30px;text-align:center;color:#666;';
			empty.cells[0].textContent = 'No CRM entries yet. Toggle F/C on players you visit.';
		} else {
			entries.forEach(uid => {
				const p    = CRM[uid] || {};
				const task = activeTask(uid);
				const due  = task?.date && task.date <= today;

				const row = tbody.insertRow();
				if (due) row.style.boxShadow = 'inset 0 0 0 1px rgba(0,170,255,.3)';

				const tdName = row.insertCell();
				const a = document.createElement('a'); a.className = 'cl-player-link';
				a.href = `/profiles.php?XID=${uid}`; a.textContent = p.name || CACHE[uid]?.data?.name || `ID: ${uid}`;
				tdName.appendChild(a);

				const tdId = row.insertCell(); tdId.style.cssText = 'color:#888;font-family:monospace;';
				tdId.textContent = uid;

				const tdAdded = row.insertCell();
				tdAdded.style.cssText = 'color:#888;font-size:11px;';
				tdAdded.textContent = p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '--';

				const tdStatus = row.insertCell();
				tdStatus.appendChild(makeCRMButtons(uid, { withU: false, withActions: true }));

				const tdDate = row.insertCell();
				tdDate.style.cssText = `color:${due ? '#37b3f9' : '#fcc419'};font-weight:bold;`;
				tdDate.textContent = task ? task.date : '--';

				const tdComp = row.insertCell(); tdComp.style.color = '#ccc';
				tdComp.textContent = p.company || '--';

				const tdWS = row.insertCell();
				const ms = p.manualStats;
				if (ms && (ms.manual != null || ms.intelligence != null || ms.endurance != null)) {
					const total = (ms.manual || 0) + (ms.intelligence || 0) + (ms.endurance || 0);
					tdWS.textContent = total.toLocaleString();
					tdWS.style.cssText = 'color:#74c0fc;font-weight:bold;cursor:help;';
					tdWS.title = `Manual: ${(ms.manual ?? 0).toLocaleString()}\nIntelligence: ${(ms.intelligence ?? 0).toLocaleString()}\nEndurance: ${(ms.endurance ?? 0).toLocaleString()}`;
				} else {
					tdWS.textContent = '--';
					tdWS.style.color = '#555';
				}

				const tdNote = row.insertCell();
				const note = document.createElement('input'); note.type = 'text';
				note.className = 'cl-note-input'; note.placeholder = 'Add notes...';
				note.value = p.notes || '';
				note.onchange = e => { if (!CRM[uid]) CRM[uid] = {}; CRM[uid].notes = e.target.value; upsertCRMState(uid); };
				tdNote.appendChild(note);

				const tdDone = row.insertCell(); tdDone.style.textAlign = 'center';
				const doneBtn = document.createElement('button'); doneBtn.className = 'cl-done-btn';
				doneBtn.textContent = 'DONE';
				doneBtn.onclick = () => {
					if (!confirm(`Remove ${p.name || uid} from CRM?`)) return;
					delete CRM[uid]; deleteCRMState(uid);
					filterTasks(t => t.uid !== uid); saveTasks();
					row.remove();
				};
				tdDone.appendChild(doneBtn);
			});
		}

		crmContent.appendChild(table);

		// ── Settings content ──────────────────────────────────────────────────────
		const settingsContent = document.createElement('div');
		settingsContent.style.display = 'none';

		function buildSettings() {
			settingsContent.innerHTML = '';
			const templates = load(STORE.TEMPLATES, DEFAULT_TEMPLATES);

			const desc = document.createElement('p');
			desc.style.cssText = 'font-size:11px;color:#666;margin:0 0 16px;';
			desc.textContent = 'Use {name} for player name and {company} for company name in templates.';
			settingsContent.appendChild(desc);

			templates.forEach((t, i) => {
				const block = document.createElement('div');
				block.style.cssText = 'margin-bottom:18px;';

				const labelRow = document.createElement('div');
				labelRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:4px;';

				const lblInput = document.createElement('input');
				lblInput.type = 'text'; lblInput.value = t.label;
				lblInput.placeholder = 'Short';
				lblInput.style.cssText = 'background:#1a1a1a;border:1px solid #333;color:#74c0fc;border-radius:4px;padding:4px 8px;font-size:12px;font-weight:bold;width:60px;';
				lblInput.title = 'Short label shown on chat button';

				const fullInput = document.createElement('input');
				fullInput.type = 'text'; fullInput.value = t.fullName || '';
				fullInput.placeholder = 'Full name (tooltip)';
				fullInput.style.cssText = 'background:#1a1a1a;border:1px solid #333;color:#ccc;border-radius:4px;padding:4px 8px;font-size:11px;width:160px;';
				fullInput.title = 'Full name shown on hover';

				const lblDesc = document.createElement('span');
				lblDesc.style.cssText = 'font-size:10px;color:#555;text-transform:uppercase;white-space:nowrap;';
				lblDesc.textContent = `Template ${i + 1}`;

				labelRow.append(lblInput, fullInput, lblDesc);

				const txtArea = document.createElement('textarea');
				txtArea.value = t.text;
				txtArea.style.cssText = 'width:100%;background:#111;color:#ccc;border:1px solid #2c2c2c;border-radius:4px;padding:8px;font-size:12px;line-height:1.5;resize:vertical;box-sizing:border-box;min-height:70px;font-family:inherit;';

				const saveBtn = document.createElement('button');
				saveBtn.textContent = 'Save';
				saveBtn.style.cssText = 'margin-top:5px;background:#1a3a1a;border:1px solid #2f9e44;color:#51cf66;padding:5px 14px;border-radius:4px;font-size:11px;cursor:pointer;';
				saveBtn.onclick = () => {
					const all = load(STORE.TEMPLATES, DEFAULT_TEMPLATES);
					all[i].label    = lblInput.value.trim() || t.label;
					all[i].fullName = fullInput.value.trim() || all[i].label;
					all[i].text     = txtArea.value;
					save(STORE.TEMPLATES, all);
					saveBtn.textContent = '✓ Saved';
					setTimeout(() => { saveBtn.textContent = 'Save'; }, 1500);
				};

				block.append(labelRow, txtArea, saveBtn);
				settingsContent.appendChild(block);
			});
		}

		// ── Config (API key) content ──────────────────────────────────────────────
		const configContent = document.createElement('div');
		configContent.style.display = 'none';

		function buildConfig() {
			configContent.innerHTML = '';

			const statusEl = document.createElement('div');
			statusEl.style.cssText = 'font-size:11px;margin-bottom:16px;padding:8px 12px;border-radius:4px;';
			if (CFG.API_KEY) {
				statusEl.style.cssText += 'background:#1a3a1a;border:1px solid #2f9e44;color:#51cf66;';
				statusEl.textContent = `API key active — logged in as ${CFG.MY_ID || '…'}`;
			} else {
				statusEl.style.cssText += 'background:#3a1a1a;border:1px solid #c92a2a;color:#ff8080;';
				statusEl.textContent = 'No API key set — CRM features disabled.';
			}
			configContent.appendChild(statusEl);

			const lbl = document.createElement('div');
			lbl.style.cssText = 'font-size:10px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;';
			lbl.textContent = 'Torn Public API Key';
			configContent.appendChild(lbl);

			const row = document.createElement('div');
			row.style.cssText = 'display:flex;gap:8px;align-items:center;';

			const keyInput = document.createElement('input');
			keyInput.type = 'text';
			keyInput.value = loadApiKey();
			keyInput.placeholder = 'e.g. rrVxhGpYEOPibRhU';
			keyInput.style.cssText = 'flex:1;background:#111;border:1px solid #333;color:#ccc;border-radius:4px;padding:7px 10px;font-size:13px;font-family:monospace;';

			const validateBtn = document.createElement('button');
			validateBtn.textContent = 'Validate & Save';
			validateBtn.style.cssText = 'background:#1a3a1a;border:1px solid #2f9e44;color:#51cf66;padding:7px 14px;border-radius:4px;font-size:11px;font-weight:bold;cursor:pointer;white-space:nowrap;';

			validateBtn.onclick = async () => {
				const key = keyInput.value.trim();
				if (!key) return;
				validateBtn.textContent = 'Checking…';
				validateBtn.disabled = true;
				try {
					const res  = await gmFetch(`https://api.torn.com/user/?selections=basic&key=${key}`);
					const data = JSON.parse(await res.text());
					if (data?.player_id) {
						saveApiKey(key);
						saveMyId(data.player_id);
						CFG.API_KEY = key;
						CFG.MY_ID   = String(data.player_id);
						statusEl.style.cssText = statusEl.style.cssText.replace('3a1a1a','1a3a1a').replace('c92a2a','2f9e44').replace('ff8080','51cf66');
						statusEl.textContent = `API key valid — logged in as ${data.name} (ID: ${data.player_id})`;
						validateBtn.textContent = '✓ Saved';
						setTimeout(() => { validateBtn.textContent = 'Validate & Save'; validateBtn.disabled = false; }, 2000);
					} else {
						statusEl.style.cssText = statusEl.style.cssText.replace('1a3a1a','3a1a1a').replace('2f9e44','c92a2a').replace('51cf66','ff8080');
						statusEl.textContent = `Invalid key — ${data?.error?.error || 'Unknown error'}`;
						validateBtn.textContent = '✗ Invalid';
						setTimeout(() => { validateBtn.textContent = 'Validate & Save'; validateBtn.disabled = false; }, 2000);
					}
				} catch (e) {
					statusEl.textContent = 'Request failed — check your connection.';
					validateBtn.textContent = 'Validate & Save';
					validateBtn.disabled = false;
				}
			};

			const hint = document.createElement('p');
			hint.style.cssText = 'font-size:10px;color:#555;margin:10px 0 0;';
			hint.textContent = 'A public API key is sufficient. Find yours at torn.com → Settings → API.';

			row.append(keyInput, validateBtn);
			configContent.append(row, hint);

			// ── Subscription status (shown to everyone with a key) ───────────────────
			if (CFG.API_KEY) {
				const subBox = document.createElement('div');
				subBox.style.cssText = 'margin-top:22px;padding:14px;border-radius:6px;border:1px solid #2c2c2c;background:#111;';
				subBox.innerHTML = '<div style="font-size:10px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Subscription</div>';
				const line = document.createElement('div');
				line.style.cssText = `font-size:13px;font-weight:bold;margin-bottom:6px;color:${CFG.PAID ? '#51cf66' : '#ff8080'};`;
				line.textContent = CFG.PAID ? '✓ Active — all features unlocked' : '✗ Inactive — buttons disabled';
				subBox.appendChild(line);

				const how = document.createElement('div');
				how.style.cssText = 'font-size:11px;color:#999;line-height:1.6;';
				subBox.appendChild(how);
				loadSettings().then(s => {
					const xp = s?.xanax_per_period ?? 1, dp = s?.days_per_period ?? 7, tag = s?.payment_tag ?? 'CRM';
					// Owner = Crealotte (2645743). Link her name to her Torn profile so users
					// can click straight through to send the xanax.
					const ownerId = 2645743;
					const ownerLink = `<a href="https://www.torn.com/profiles.php?XID=${ownerId}" target="_blank" rel="noopener" style="color:#37b3f9;font-weight:bold;text-decoration:none;">Crealotte [${ownerId}]</a>`;
					how.innerHTML =
						`Price: <b style="color:#74c0fc;">${xp} xanax = ${dp} days</b>.<br>` +
						`To activate: send <b>${xp} xanax</b> to ${ownerLink} with the message ` +
						`<code style="background:#000;padding:1px 5px;border-radius:3px;color:#ffd43b;">${CFG.MY_ID} ${tag}</code><br>` +
						`<span style="color:#666;">Your ID + the tag must both be in the message or it won't be counted. After sending, press ↻ Refresh status below: it checks your payment right away (if it still says inactive, wait half a minute and press it again).</span>`;
				});

				// Force a fresh license check (skips the cache) — lets a user who just
				// paid unlock immediately instead of waiting for the cache to expire.
				const refreshBtn = document.createElement('button');
				refreshBtn.textContent = '↻ Refresh status';
				refreshBtn.style.cssText = 'margin-top:10px;background:#1a1a1a;border:1px solid #333;color:#aaa;padding:5px 12px;border-radius:4px;font-size:11px;cursor:pointer;';
				refreshBtn.onclick = async () => {
					refreshBtn.textContent = 'Checking…'; refreshBtn.disabled = true;
					const was = CFG.PAID;
					await loadMyLicense({ force: true });
					if (CFG.PAID !== was || CFG.PAID) {
						line.style.color = CFG.PAID ? '#51cf66' : '#ff8080';
						line.textContent = CFG.PAID ? '✓ Active — all features unlocked' : '✗ Inactive — buttons disabled';
					}
					refreshBtn.textContent = CFG.PAID ? '✓ Active!' : 'Still inactive';
					setTimeout(() => { refreshBtn.textContent = '↻ Refresh status'; refreshBtn.disabled = false; }, 2000);
					// Re-render buttons across the page so they unlock without a reload.
					// Dispatched as an event to avoid importing injectors (circular dep).
					if (CFG.PAID && !was) document.dispatchEvent(new CustomEvent('cl-refresh-crm'));
				};
				subBox.appendChild(refreshBtn);
				configContent.append(subBox);
			}
		}

		// ── TODO content ──────────────────────────────────────────────────────────
		const todoContent = document.createElement('div');
		todoContent.style.display = 'none';

		const isAdmin = String(CFG.MY_ID) === '2353554';

		// Workflow states — order matters (left→right progression)
		const STATUSES = [
			{ key: 'todo',      label: 'To Do',     color: '#555',   border: '#444',   text: '#aaa'    },
			{ key: 'ongoing',   label: 'On Going',  color: '#1a2a3a',border: '#1971c2',text: '#74c0fc' },
			{ key: 'to_test',   label: 'To Test',   color: '#2a1a3a',border: '#7048e8',text: '#b197fc' },
			{ key: 'test_ok',   label: 'Test OK',   color: '#1a3a1a',border: '#2f9e44',text: '#51cf66' },
			{ key: 'test_ko',   label: 'Test KO',   color: '#3a1a1a',border: '#c92a2a',text: '#ff8080' },
			{ key: 'done',      label: 'Done',      color: '#1a1a1a',border: '#2a2a2a',text: '#555'    },
		];

		function getStatus(key) { return STATUSES.find(s => s.key === key) || STATUSES[0]; }
		function nextStatus(key) {
			const idx = STATUSES.findIndex(s => s.key === key);
			return STATUSES[Math.min(idx + 1, STATUSES.length - 1)].key;
		}

		async function buildTodo() {
			todoContent.innerHTML = '';

			// ── Add ticket form ──
			const form = document.createElement('div');
			form.style.cssText = 'background:#111;border:1px solid #2c2c2c;border-radius:6px;padding:14px;margin-bottom:20px;';

			const formTitle = document.createElement('div');
			formTitle.style.cssText = 'font-size:11px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;';
			formTitle.textContent = 'New Ticket';
			form.appendChild(formTitle);

			const nameInput = document.createElement('input');
			nameInput.type = 'text'; nameInput.placeholder = 'Ticket title…';
			nameInput.style.cssText = 'width:100%;box-sizing:border-box;background:#1a1a1a;border:1px solid #333;color:#ccc;border-radius:4px;padding:7px 10px;font-size:12px;margin-bottom:8px;';
			form.appendChild(nameInput);

			const descInput = document.createElement('textarea');
			descInput.placeholder = 'Description / steps to reproduce…';
			descInput.style.cssText = 'width:100%;box-sizing:border-box;background:#1a1a1a;border:1px solid #333;color:#ccc;border-radius:4px;padding:7px 10px;font-size:12px;line-height:1.5;resize:vertical;min-height:60px;font-family:inherit;margin-bottom:8px;';
			form.appendChild(descInput);

			const submitBtn = document.createElement('button');
			submitBtn.textContent = 'Add Ticket';
			submitBtn.style.cssText = 'background:#1a3a1a;border:1px solid #2f9e44;color:#51cf66;padding:6px 16px;border-radius:4px;font-size:11px;font-weight:bold;cursor:pointer;';
			submitBtn.onclick = async () => {
				const title = nameInput.value.trim();
				const desc  = descInput.value.trim();
				if (!title) { nameInput.focus(); return; }
				submitBtn.textContent = 'Saving…'; submitBtn.disabled = true;
				await createTicket(title, desc);
				await buildTodo();
			};
			form.appendChild(submitBtn);
			todoContent.appendChild(form);

			// ── Ticket list ──
			const listEl = document.createElement('div');
			todoContent.appendChild(listEl);

			const loadingEl = document.createElement('div');
			loadingEl.style.cssText = 'color:#555;font-size:12px;padding:10px 0;';
			loadingEl.textContent = 'Loading…';
			listEl.appendChild(loadingEl);

			const tickets = await loadTickets();
			listEl.innerHTML = '';

			if (!Array.isArray(tickets) || !tickets.length) {
				const empty = document.createElement('div');
				empty.style.cssText = 'color:#555;font-size:12px;padding:20px 0;text-align:center;';
				empty.textContent = 'No tickets yet.';
				listEl.appendChild(empty);
				return;
			}

			tickets.forEach(ticket => {
				const st = getStatus(ticket.status || 'todo');
				const isDone = ticket.status === 'done';

				const card = document.createElement('div');
				card.style.cssText = `background:#111;border:1px solid ${st.border};border-radius:6px;padding:12px 14px;margin-bottom:10px;opacity:${isDone ? '.45' : '1'};`;

				const cardHead = document.createElement('div');
				cardHead.style.cssText = 'display:flex;align-items:flex-start;gap:10px;';

				const cardInfo = document.createElement('div');
				cardInfo.style.flex = '1';

				const cardTitle = document.createElement('div');
				cardTitle.style.cssText = `font-size:13px;font-weight:bold;color:${isDone ? '#555' : '#ccc'};text-decoration:${isDone ? 'line-through' : 'none'};margin-bottom:4px;`;
				cardTitle.textContent = ticket.title;
				cardInfo.appendChild(cardTitle);

				if (ticket.description) {
					const cardDesc = document.createElement('div');
					cardDesc.style.cssText = 'font-size:11px;color:#666;white-space:pre-wrap;line-height:1.5;margin-bottom:6px;';
					cardDesc.textContent = ticket.description;
					cardInfo.appendChild(cardDesc);
				}

				const cardMeta = document.createElement('div');
				cardMeta.style.cssText = 'font-size:10px;color:#444;';
				const byLabel = ticket.created_by === '2353554' ? 'Admin' : `ID: ${ticket.created_by}`;
				const date    = ticket.created_at ? new Date(ticket.created_at).toLocaleDateString() : '';
				cardMeta.textContent = `${byLabel}${date ? ' · ' + date : ''}`;
				cardInfo.appendChild(cardMeta);

				const cardActions = document.createElement('div');
				cardActions.style.cssText = 'display:flex;gap:6px;flex-shrink:0;align-items:center;';

				// Status badge (clickable for admin to advance, readonly for others)
				const badge = document.createElement('span');
				badge.style.cssText = `font-size:10px;padding:3px 9px;border-radius:10px;font-weight:bold;background:${st.color};border:1px solid ${st.border};color:${st.text};white-space:nowrap;${isAdmin && !isDone ? 'cursor:pointer;' : ''}`;
				badge.textContent = st.label;
				cardActions.appendChild(badge);

				if (isAdmin) {
					// Advance button (→ next step), hidden on 'done'
					if (!isDone) {
						const nextSt = getStatus(nextStatus(st.key));
						const advBtn = document.createElement('button');
						advBtn.textContent = `→ ${nextSt.label}`;
						advBtn.title = `Move to ${nextSt.label}`;
						advBtn.style.cssText = `background:${nextSt.color};border:1px solid ${nextSt.border};color:${nextSt.text};padding:3px 9px;border-radius:4px;font-size:10px;cursor:pointer;white-space:nowrap;`;
						advBtn.onclick = async () => {
							advBtn.disabled = true;
							await updateTicketStatus(ticket.id, nextSt.key);
							await buildTodo();
						};
						cardActions.appendChild(advBtn);
					}

					// Back button (← reopen to todo), only when not already todo
					if (st.key !== 'todo') {
						const backBtn = document.createElement('button');
						backBtn.textContent = '↩';
						backBtn.title = 'Reset to To Do';
						backBtn.style.cssText = 'background:#1a1a1a;border:1px solid #333;color:#666;padding:3px 7px;border-radius:4px;font-size:10px;cursor:pointer;';
						backBtn.onclick = async () => {
							backBtn.disabled = true;
							await updateTicketStatus(ticket.id, 'todo');
							await buildTodo();
						};
						cardActions.appendChild(backBtn);
					}

					const delBtn = document.createElement('button');
					delBtn.textContent = '✕';
					delBtn.title = 'Delete ticket';
					delBtn.style.cssText = 'background:#3a1a1a;border:1px solid #c92a2a;color:#ff8080;padding:3px 7px;border-radius:4px;font-size:10px;cursor:pointer;';
					delBtn.onclick = async () => {
						if (!confirm(`Delete ticket "${ticket.title}"?`)) return;
						delBtn.disabled = true;
						await deleteTicket(ticket.id);
						await buildTodo();
					};
					cardActions.appendChild(delBtn);
				}

				cardHead.append(cardInfo, cardActions);
				card.appendChild(cardHead);
				listEl.appendChild(card);
			});
		}


		// ── Tab switching ─────────────────────────────────────────────────────────
		function showTab(tab) {
			[crmContent, settingsContent, configContent, todoContent].forEach(el => { el.style.display = 'none'; });
			if (tab === 'crm') {
				if (!hasApiKey) { showTab('config'); return; }
				setActiveTab(tabCRM);
				crmContent.style.display = '';
			} else if (tab === 'settings') {
				setActiveTab(tabTemplates);
				buildSettings();
				settingsContent.style.display = '';
			} else if (tab === 'todo') {
				setActiveTab(tabTodo);
				todoContent.style.display = '';
				buildTodo();
			} else {
				setActiveTab(tabConfig);
				buildConfig();
				configContent.style.display = '';
			}
		}

		// Pick the opening tab: explicit arg wins, else CRM (paid) or config (no key).
		const validInitial = ['crm','settings','config','todo'].includes(initialTab);
		showTab(validInitial ? initialTab : (hasApiKey ? 'crm' : 'config'));

		const title = document.createElement('h2');
		title.style.cssText = 'margin:0 0 16px;font-size:16px;color:#37b3f9;';
		title.textContent = 'CoreLabs CRM Dashboard';

		modal.append(closeBtn, title, tabBar, crmContent, settingsContent, configContent, todoContent);
		overlay.appendChild(modal);
		document.body.appendChild(overlay);
		overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
	}

	// Rebuild only the .cl-crm-group inside each existing wrap — no DOM parent changes
	function refreshAllCRMGroups() {
		document.querySelectorAll('[data-cl-uid]').forEach(wrap => {
			const uid   = wrap.dataset.clUid;
			const withU = !!wrap.dataset.clWithU;
			if (!uid) return;

			const oldGroup = wrap.querySelector('.cl-crm-group');
			if (!oldGroup) return;

			const fresh    = makeCRMButtons(uid, { withU, withActions: false });
			const newGroup = fresh.querySelector('.cl-crm-group');
			if (newGroup) oldGroup.replaceWith(newGroup);
		});
	}

	const injected = new Map();

	function isAlive(key) {
		const ref = injected.get(key);
		if (!ref) return false;
		const el = ref.deref();
		if (!el || !el.isConnected) { injected.delete(key); return false; }
		return true;
	}

	function mark(key, el) { injected.set(key, new WeakRef(el)); }

	function injectHeader(div) {
		// `header___` is a generic Torn module name shared by the sidebar panels
		// ("Information", "Areas", …), chat windows, and other chrome. Those are NOT
		// profile/userlist headers — injecting CRM buttons there drops F/C/S into the
		// sidebar (the UID then leaks from the page URL on profile pages). Only inject
		// into real content headers, never into the sidebar or a chat window.
		if (div.closest('#sidebar, #sidebarroot, [id^="private-"], #chat-app, #chatRoot')) return;

		const uid = window.location.href.match(/XID=(\d+)/)?.[1]
			|| div.querySelector('a[href*="XID="]')?.href.match(/XID=(\d+)/)?.[1];
		if (!uid) return;
		const key = `${uid}:header:${uid}`;
		if (isAlive(key)) return;

		// Capture player name from page title if not already in CRM (profile pages only)
		if (!CRM[uid]?.name && /\/profiles\.php/.test(window.location.pathname)) {
			const titleEl = document.querySelector('h4.profile-name, span.profile-name, [class*="profileName"]')
				|| div.querySelector('[class*="name"], h4, h3');
			const pageName = titleEl?.textContent?.trim();
			const looksLikeUsername = pageName
				&& pageName.length > 1 && pageName.length < 40
				&& !/^\d+$/.test(pageName)
				&& !/torn|rpg|profile/i.test(pageName);
			if (looksLikeUsername) {
				if (!CRM[uid]) CRM[uid] = {};
				CRM[uid].name = pageName;
				upsertCRMState(uid);
			}
		}

		const btns = makeCRMButtons(uid, { withU: false, withActions: false });
		div.appendChild(btns);
		mark(key, btns);
	}

	function injectUserIconsHelp() {
		const header = document.querySelector('.user-icons.t-hide.left.title-divider.divider-spiky');
		if (!header || header.dataset.clHelp) return;
		header.dataset.clHelp = '1';

		const badge = document.createElement('span');
		badge.className = 'cl-fcu-help';
		badge.textContent = '?';

		// Portal tooltip — appended to body, positioned via getBoundingClientRect
		const tooltip = document.createElement('div');
		tooltip.className = 'cl-fcu-tooltip-portal';
		tooltip.innerHTML = `
		<div class="cl-fcu-tooltip-title">F — First Contact</div>
		<div class="cl-fcu-row"><span class="cl-fcu-dot grey"></span>Not contacted</div>
		<div class="cl-fcu-row"><span class="cl-fcu-dot yellow"></span>Contacted — awaiting reply</div>
		<div class="cl-fcu-row"><span class="cl-fcu-dot green"></span>Responded positively</div>
		<div class="cl-fcu-row"><span class="cl-fcu-dot red"></span>Declined / not interested</div>
		<hr class="cl-fcu-sep">
		<div class="cl-fcu-tooltip-title">C — Closing</div>
		<div class="cl-fcu-row"><span class="cl-fcu-dot grey"></span>Not in progress</div>
		<div class="cl-fcu-row"><span class="cl-fcu-dot yellow"></span>In discussion</div>
		<div class="cl-fcu-row"><span class="cl-fcu-dot green"></span>Deal closed / recruited</div>
		<div class="cl-fcu-row"><span class="cl-fcu-dot red"></span>Lost</div>
		<hr class="cl-fcu-sep">
		<div class="cl-fcu-tooltip-title">S — Services</div>
		<div class="cl-fcu-row"><span class="cl-fcu-dot grey"></span>Not pitched</div>
		<div class="cl-fcu-row"><span class="cl-fcu-dot yellow"></span>Pitched — awaiting reply</div>
		<div class="cl-fcu-row"><span class="cl-fcu-dot green"></span>Interested / subscribed</div>
		<div class="cl-fcu-row"><span class="cl-fcu-dot red"></span>Declined</div>
		<hr class="cl-fcu-sep">
		<div class="cl-fcu-tooltip-title">U — Useless</div>
		<div class="cl-fcu-row"><span class="cl-fcu-dot grey"></span>Not flagged</div>
		<div class="cl-fcu-row"><span class="cl-fcu-dot blue"></span>Useless — low stats, chat off, or faction/company member</div>
	`;
		document.body.appendChild(tooltip);

		badge.addEventListener('mouseenter', () => {
			const r = badge.getBoundingClientRect();
			tooltip.style.top  = `${r.top + r.height / 2}px`;
			tooltip.style.left = `${r.right + 8}px`;
			tooltip.style.display = 'block';
		});
		badge.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });

		// ── Button filter toggles (F / C / S) ────────────────────────────────────
		const filterWrap = document.createElement('span');
		filterWrap.style.cssText = 'display:inline-flex;align-items:center;gap:3px;margin-left:5px;vertical-align:middle;';

		const filterLabel = document.createElement('span');
		filterLabel.style.cssText = 'font-size:9px;color:#555;text-transform:uppercase;margin-right:1px;';
		filterLabel.textContent = 'show:';
		filterWrap.appendChild(filterLabel);

		['F','C','S'].forEach(id => {
			const prefs = loadBtnPrefs();
			const toggle = document.createElement('span');
			toggle.className = 'cl-filter-toggle';
			toggle.textContent = id;
			toggle.dataset.btn = id;
			toggle.classList.toggle('active', !!prefs[id]);
			toggle.title = `Toggle ${id} button`;
			toggle.onclick = () => {
				const p = loadBtnPrefs();
				p[id] = !p[id];
				saveBtnPrefs(p);
				toggle.classList.toggle('active', p[id]);
				refreshAllCRMGroups();
			};
			filterWrap.appendChild(toggle);
		});

		// ── Min-stat row filters (work stats / xanax / war hits) ──────────────────
		const minfWrap = document.createElement('span');
		minfWrap.className = 'cl-minf-wrap';

		const minfLbl = document.createElement('span');
		minfLbl.className = 'cl-minf-lbl';
		minfLbl.textContent = 'min:';
		minfWrap.appendChild(minfLbl);

		const FIELDS = [
			{ key: 'xan', ico: '💊', title: 'Min xanax taken — hide rows below this', ph: 'Xan' },
			{ key: 'act', ico: '⚔️', title: 'Min war hits — hide rows below this',    ph: 'War' },
			{ key: 'ws',  ico: '💼', title: 'Min work stats — hide rows below this',  ph: 'WS'  },
		];

		FIELDS.forEach(f => {
			const filters = loadFilters();
			const item = document.createElement('span'); item.className = 'cl-minf-item';

			const ico = document.createElement('span'); ico.className = 'cl-minf-ico';
			ico.textContent = f.ico; ico.title = f.title;

			const input = document.createElement('input');
			input.className = 'cl-minf-in';
			input.type = 'text';
			input.placeholder = f.ph;
			input.title = f.title + ' (accepts 150k, 1.2m, 5b, 80000 — blank = off)';
			input.value = filters[f.key] > 0 ? fmt(filters[f.key]) : '';
			input.classList.toggle('active', filters[f.key] > 0);

			// Live filter — applies as you type, no Enter needed. We don't reformat the
			// value on every keystroke (would jump the cursor); only persist + re-sweep.
			const commit = () => {
				const val = parseThreshold(input.value);
				const cur = loadFilters();
				cur[f.key] = val;
				saveFilters(cur);
				input.classList.toggle('active', val > 0);
				reapplyAllFilters();
			};
			input.addEventListener('input', commit);
			// On blur, tidy the display into "150K" form (or clear if zero/garbage).
			input.addEventListener('blur', () => {
				const val = parseThreshold(input.value);
				input.value = val > 0 ? fmt(val) : '';
			});

			item.append(ico, input);
			minfWrap.appendChild(item);
		});

		const clearBtn = document.createElement('span');
		clearBtn.className = 'cl-minf-clear';
		clearBtn.textContent = '✕';
		clearBtn.title = 'Clear all min-stat filters';
		clearBtn.onclick = () => {
			saveFilters({ ...DEFAULT_FILTERS });
			minfWrap.querySelectorAll('.cl-minf-in').forEach(i => { i.value = ''; i.classList.remove('active'); });
			reapplyAllFilters();
		};
		minfWrap.appendChild(clearBtn);

		header.appendChild(badge);
		header.appendChild(filterWrap);
		header.appendChild(minfWrap);
	}

	function injectUserlistPill(link) {
		if (link.dataset.clDone) return;
		const uid = link.href.match(/XID=(\d+)/)?.[1];
		if (!uid || link.textContent.trim().length < 2) return;
		link.dataset.clDone = '1';

		const li = link.closest('li[class*="user"]');
		if (!li || li.dataset.clDone) return;
		li.dataset.clDone = '1';

		const iconsWrap = li.querySelector('.icons-wrap');
		if (iconsWrap) {
			const cont = document.createElement('span'); cont.className = 'cl-pill-cont';
			iconsWrap.appendChild(cont);
			ensurePill(uid, cont);
			return;
		}

		const cont = document.createElement('span'); cont.className = 'cl-pill-cont';
		link.after(cont);
		ensurePill(uid, cont);
	}

	function injectChatTab(chatBox) {
		// chatBox id format: "private-A-B" where one of A/B is MY_ID — pick the other one
		const idMatch = chatBox.id?.match(/private-(\d+)-(\d+)/);
		let uid;
	if (/^\d+$/.test(chatBox.id)) uid = chatBox.id; // the chat window's id is the other player's id
		if (idMatch) {
			const [, a, b] = idMatch;
			uid = b === String(CFG.MY_ID) ? a : b;
		}
		uid = uid || chatBox.querySelector('a[href*="XID="]')?.href.match(/XID=(\d+)/)?.[1];
		if (!uid) return;

		_injectChatTabForUid(uid, chatBox);
	}

	function _injectChatTabForUid(uid, chatBox, attempt = 0) {
		// The floating header is the inner "root" div. Match the module prefix only —
		// the `___hash` suffix changes on every Torn deploy.
		const chatHeader = chatBox.querySelector('button[class*="header___"]')?.parentElement
			|| chatBox.querySelector('[class*="root___"]')
			|| chatBox.firstElementChild;

		const tabKey    = `${uid}:chat`;
		const footerKey = `${uid}:chat-tpl`;

		const tabDone    = isAlive(tabKey);
		const footerDone = isAlive(footerKey);
		if (tabDone && footerDone) return;

		// ── CRM tab (top, floating) ───────────────────────────────────────────────
		if (!tabDone && chatHeader) {
			const tab = document.createElement('div'); tab.className = 'cl-chat-tab';
			tab.onclick = e => e.stopPropagation();
			tab.appendChild(makeCRMButtons(uid, { withU: false, withActions: true }));
			chatHeader.appendChild(tab);
			mark(tabKey, tab);
		}

		// ── Template buttons (above textarea, so late-load doesn't shift typing area) ─
		if (!footerDone) {
			const textarea = chatBox.querySelector('textarea');
			if (textarea) {
				const inputWrap = textarea.parentElement;
				const tplBar = buildChatTemplateBar(uid, chatBox);
				inputWrap.before(tplBar);
				mark(footerKey, tplBar);
			}
		}

		// Retry if either part still missing and chatBox is still in DOM
		const stillMissing = !isAlive(tabKey) || !isAlive(footerKey);
		if (stillMissing && attempt < 12 && chatBox.isConnected) {
			setTimeout(() => _injectChatTabForUid(uid, chatBox, attempt + 1), 300);
		}
	}

	function buildChatTemplateBar(uid, chatBox) {
		const bar = document.createElement('div');
		bar.className = 'cl-tpl-bar';
		bar.onclick = e => e.stopPropagation();

		const templates  = load(STORE.TEMPLATES, DEFAULT_TEMPLATES);

		function resolveName() {
			// Chat title is always the other person's name — most reliable source
			const chatTitle = chatBox.querySelector('[class*="title___"]')?.textContent?.trim();
			return chatTitle
				|| CRM[uid]?.name
				|| CACHE[uid]?.data?.name
				|| `ID: ${uid}`;
		}
		function resolveCompany() { return CRM[uid]?.company || '[company]'; }

		templates.forEach(t => {
			const btn = document.createElement('button');
			btn.className = 'cl-tpl-bar-btn';
			btn.textContent = t.label;
			btn.title = (t.fullName || t.label) + ' — ' + t.text.replace(/\{name\}/g, resolveName()).replace(/\{company\}/g, resolveCompany()).slice(0, 60) + '…';
			btn.onclick = e => {
				e.preventDefault(); e.stopPropagation();
				const input = chatBox.querySelector('textarea')
					|| chatBox.querySelector('input[type="text"]');
				if (!input) return;
				const playerName = resolveName();
				const company    = resolveCompany();
				const text = t.text.replace(/\{name\}/g, playerName).replace(/\{company\}/g, company);
				injectIntoChatbox(input, text);
				bar.querySelectorAll('.cl-tpl-bar-btn').forEach(b => b.classList.remove('active'));
				btn.classList.add('active');
				setTimeout(() => btn.classList.remove('active'), 1500);
			};
			bar.appendChild(btn);
		});

		return bar;
	}

	function injectSidebar() {
		// Anchor strictly to the real sidebar via its STABLE id (`#sidebar`), never a
		// bare `content___` match. `content___` is a generic Torn module name used by
		// chat windows and other panels too — on first load the sidebar React tree may
		// not be mounted yet while a chat already is, so a global match dropped the
		// button into the chat (only on first load with a chat open). Scoping to
		// #sidebar makes placement deterministic; class prefixes stay hash-agnostic.
		const sidebar = document.getElementById('sidebar') || document.getElementById('sidebarroot');
		if (!sidebar) return; // sidebar not mounted yet — a later MutationObserver pass retries

		// The content panel that holds the user-information block, scoped to #sidebar.
		const content =
			sidebar.querySelector(q('sidebar-block', 'content'))
			|| findByPrefix(sidebar, 'user-information')?.closest('[class*="content___"]')
			|| sidebar.querySelector('[class*="content___"]');
		if (!content) return;
		const key = 'sidebar';
		if (isAlive(key)) return;

		const wrap = document.createElement('div'); wrap.className = 'cl-sidebar-wrap';
		const btn  = document.createElement('button'); btn.className = 'cl-sidebar-btn';
		btn.textContent = 'CRM DASHBOARD';
		btn.onclick     = openDashboard;
		const hasDue = getTasks().some(t => !t.done && t.date && t.date <= todayStr());
		if (hasDue) btn.classList.add('has-due');
		wrap.appendChild(btn);

		const anchor = findByPrefix(content, 'user-information');
		if (anchor) content.insertBefore(wrap, anchor);
		else content.prepend(wrap);

		mark(key, wrap);
	}

	// pageScan() seeds the shared stats cache, then fires this so any pill still on
	// "…" is served from the shared cache instead of calling Torn.
	document.addEventListener('cl-shared-seeded', () => refreshPendingPills());

	// Unpaid CRM buttons dispatch this to nudge the user to the dashboard.
	document.addEventListener('cl-open-dashboard', e => openDashboard(e.detail));
	// Dashboard "refresh status" dispatches this after a user unlocks, so buttons
	// re-render across the page without a reload.
	document.addEventListener('cl-refresh-crm', () => { refreshAllCRMGroups(); runPass(); });

	injectStyles();
	migrateTemplates();
	CFG.API_KEY = loadApiKey();
	CFG.MY_ID   = loadMyId() || '';

	async function resolveMyId() {
		try {
			const res  = await gmFetch(`https://api.torn.com/user/?selections=basic&key=${CFG.API_KEY}`);
			const data = JSON.parse(await res.text());
			if (data?.player_id) { CFG.MY_ID = String(data.player_id); saveMyId(data.player_id); return true; }
			console.error('[CoreLabs] Could not resolve MY_ID:', data?.error);
		} catch (e) {
			console.error('[CoreLabs] resolveMyId failed:', e);
		}
		return false;
	}

	// ── Pending message auto-fill (messages.php compose) ─────────────────────────
	function injectPendingMessage() {
		if (!window.location.href.includes('messages.php')) return;

		let pending;
		try { pending = JSON.parse(GM_getValue('cl_pending_msg', null)); } catch { return; }
		if (!pending || Date.now() - pending.ts > 30000) { GM_setValue('cl_pending_msg', null); return; }

		function reactSet(el, val) {
			const nativeSetter = Object.getOwnPropertyDescriptor(
				el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
				'value'
			)?.set;
			if (nativeSetter) nativeSetter.call(el, val);
			else el.value = val;
			el.dispatchEvent(new Event('input',  { bubbles: true }));
			el.dispatchEvent(new Event('change', { bubbles: true }));
		}

		let subjectDone = false;
		const tryInject = () => {
			if (!subjectDone) {
				const subjectInput = document.querySelector(
					'input[name="subject"], input[placeholder*="ubject"], input[placeholder*="Subject"]'
				);
				if (subjectInput && pending.subject) { reactSet(subjectInput, pending.subject); subjectDone = true; }
			}
			const allTextareas = [...document.querySelectorAll('textarea')];
			const bodyField =
				document.querySelector('textarea[name="body"]') ||
				allTextareas.find(t => (t.placeholder || '').toLowerCase().includes('message')) ||
				allTextareas.find(t => (t.placeholder || '').toLowerCase().includes('write')) ||
				allTextareas.find(t => t.rows > 2) ||
				document.querySelector('div[contenteditable="true"]');
			if (!bodyField) return false;
			if (bodyField.tagName === 'TEXTAREA' || bodyField.tagName === 'INPUT') reactSet(bodyField, pending.body);
			else { bodyField.focus(); document.execCommand('selectAll', false, null); document.execCommand('insertText', false, pending.body); }
			GM_setValue('cl_pending_msg', null);
			return true;
		};
		if (!tryInject()) {
			let tries = 0;
			const iv = setInterval(() => { if (tryInject() || ++tries > 10) clearInterval(iv); }, 400);
		}
	}

	// ── DOM pass ──────────────────────────────────────────────────────────────────
	function runPass() {
		injectPendingMessage();
		// Exclude sidebar headers up front (injectHeader also guards defensively):
		// `header___` is shared by sidebar panels, so an unscoped match leaked F/C/S
		// into the sidebar "Information" panel.
		document.querySelectorAll('div[class*="header___"]:not(#sidebar div):not(#sidebarroot div)').forEach(injectHeader);
		if (window.location.href.includes('sid=UserList')) {
			injectUserIconsHelp();
			document.querySelectorAll('.userlist-wrapper a[href*="XID="]').forEach(injectUserlistPill);
			reapplyAllFilters();
		}
		// Chat windows: Torn's chat lives in #chatRoot. A private chat window is a div whose id is the OTHER player's id (digits only; it used to be "private-A-B")
		// and that holds a textarea once it is open. Group chats (faction, global) have other ids and are skipped.
		document.querySelectorAll('#chatRoot div[id], div[id^="private-"]').forEach(w => {
			if ((/^\d+$/.test(w.id) || w.id.startsWith('private-')) && w.querySelector('textarea')) injectChatTab(w);
		});
		injectSidebar();
	}

	// ── Observer ──────────────────────────────────────────────────────────────────
	let debounceTimer = null;
	function schedulePass() {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(runPass, CFG.SCAN_DEBOUNCE);
	}

	// Torn's page changes all the time (chat messages, timers). Only look at the page again when the change is not ours and not a chat message arriving.
	const isOurs = el => !!(el && el.closest && el.closest('[class^="cl-"], [class*=" cl-"], [id^="cl-"]'));
	const isChatFeed = el => !!(el && el.closest && el.closest('#chatRoot [class*="scrollWrapper___"]'));
	new MutationObserver(muts => {
		for (const m of muts) {
			const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
			if (isOurs(el) || isChatFeed(el)) continue;
			schedulePass();
			return;
		}
	}).observe(document.body, { childList: true, subtree: true });


	// ── Boot ──────────────────────────────────────────────────────────────────────
	console.log('[CoreLabs] Ready!');
	if (!CFG.API_KEY) {
		// No API key — inject sidebar only so user can open dashboard and enter key
		console.warn('[CoreLabs] No API key — open CRM Dashboard > Settings to configure.');
		new MutationObserver(() => injectSidebar()).observe(document.body, { childList: true, subtree: true });
		injectSidebar();
	} else {
		// Render pills immediately from cached stats — don't wait for HTTP boot
		runPass();
		resolveMyId().then(ok => {
			if (!ok) { console.error('[CoreLabs] Boot aborted — could not resolve player ID.'); return; }
			console.log(`[CoreLabs] MY_ID = ${CFG.MY_ID}`);
			// AWAIT the license before rendering CRM buttons. Otherwise buttons render
			// while CFG.PAID is still false (the default) → they show locked/grey and
			// look "reset" even for a paid user. Resolving paid status first means the
			// first render is correct. (loadMyLicense is cached, so this is cheap and
			// usually instant.)
			loadMyLicense().finally(() => {
				loadAllCRMStates().then(() => {
					refreshAllCRMGroups();
					runPass();
					// Seed the shared stats cache ASAP (not on a 2s delay) so pills get
					// served from Supabase instead of all hitting Torn. pageScan fires
					// 'cl-shared-seeded' when done → refreshPendingPills resolves the "…".
					pageScan();
					setTimeout(() => { refreshAllCRMGroups(); runPass(); }, 500);
					setTimeout(() => { refreshAllCRMGroups(); runPass(); }, 1500);
					setTimeout(pageScan, 2500); // second pass for late-rendered rows
					// Repair rows saved as name:null ("ID: 123") by copying names from
					// the targets table. Re-render once done so the dashboard shows names.
					backfillMissingNames().then(() => { refreshAllCRMGroups(); runPass(); });
				});
			});
		});
	}

})();
