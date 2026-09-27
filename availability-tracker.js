// availability-tracker.js — WorldWideLabs War Availability Tracker (frontend).
// Open to every member, not leader-gated — everyone marks their own day/hour slots for the window
// after being matched, before the war starts. Leaders/council additionally see the whole faction
// added up per slot (backend only includes that `summary` for a leader-tier key, see
// api/war-payout.js's 'availability-get' action), so this page shows more to a leader than to a
// regular member from the exact same load. The leaders' half (heatmap, responses, overdoses, plans, Discord)
// lives on its own page, Availability overview under Leadership; both pages share this file and one load.
//
// Everything is STORED in TCT (Torn City Time = UTC) as "day-hour" slots, relative to the tracker's
// start date — that never changes, so leaders always see one consistent picture. The "show in my
// timezone" toggle is purely a display/click mapping on top of that: a local-time cell is just
// translated to whichever TCT slot it falls on before being read or saved.
'use strict';

let avConfig = null; // { startDate, days } from the backend, or null if no tracker is active
let avMine = {}; // my own slots: "day-hour" (TCT) -> true
let avMineWatch = {}; // my hours marked with the blue ring (Chain saver / War guard)
let avWatchMode = false; // the switch: clicking a box adds or removes the ring instead of cycling the colour
let avWatchTaken = {}; // hour -> how many of the two places (primary + backup) are taken
let avMineRole = {}; // hour -> 'primary' or 'backup' for the hours I hold
let avSummary = null; // "day-hour" (TCT) -> { count, names } — present only when the caller is a leader
let avMyUnavailable = null; // { name, note, at } if I marked myself as unable to make this war
let avUnavailList = null; // leader-only: everyone who did — [{ id, name, note, at }]
let avResponded = null; // leader-only: everyone who ticked a slot or said they can't make it
let avNotResponded = null; // leader-only: roster minus responded (null = roster couldn't be read)
let avRosterError = null;
let avWars = null; // leader-only: matched/upcoming ranked wars, for the "link to war" picker
const AV_TZ_KEY = 'wwl_av_local_tz';
let avLocal = false; // show/click in my own timezone instead of TCT
try { avLocal = localStorage.getItem(AV_TZ_KEY) === '1'; } catch (e) { /* storage blocked — just default to TCT */ }

// Several plans (trackers) can exist at once — e.g. this weekend AND next weekend — chosen from a
// dropdown. The picked plan is remembered per browser, and attached to every request that reads
// or writes a plan's data (the backend falls back to the sensible default if it no longer exists).
const AV_PLAN_KEY = 'wwl_av_plan';
let avPlans = []; // light metadata for the dropdown: [{ id, name, startDate, days, war }] — never includes archived plans
let avArchivedPlans = []; // leader-only: archived plans, for the separate "pick one to view" list
let avViewingArchived = false; // true when avPlanId currently points at an archived plan
let avPlanId = null;
try { avPlanId = localStorage.getItem(AV_PLAN_KEY) || null; } catch (e) { /* storage blocked */ }
const AV_PLAN_ACTIONS = new Set(['availability-get', 'availability-set', 'availability-watch', 'availability-link-war', 'availability-unavailable', 'availability-ping', 'availability-archive', 'availability-resize']);
let avOd = null; // leader-only: last overdose view from the backend
let avOdIds = new Set(); // ids of members who've overdosed in the window (marked in the slot list)
let avOdScanning = false;
let avVsChains = ''; // chain IDs / links typed in the hits comparison
let avVsLive = ''; // start (UTC, datetime-local) of a chain that is still running

// ---- "not filled in yet" marker on the sidebar item -----------------------------------------------
// Mirrors the Feedback page's badge: stays lit for as long as this member hasn't ticked a slot (or
// said they can't make it) on the FIRST plan that hasn't finished yet — not whichever plan they last
// happened to be looking at — and, unlike What's new, isn't cleared just by opening the page.
let avBadgeTargetPlanId = null; // the "first coming up" plan's id, recomputed whenever the plan list is refreshed
function avComputeFirstUpcoming(plans) {
    if (!plans || !plans.length) return null;
    const today = new Date().toISOString().slice(0, 10);
    const endOf = p => { const d = new Date(`${p.startDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + p.days); return d.toISOString().slice(0, 10); };
    const live = plans.filter(p => endOf(p) >= today).sort((a, b) => a.startDate.localeCompare(b.startDate));
    return live[0]?.id ?? null;
}
function setAvailabilityBadge(responded) {
    const nav = $('nav-availability');
    if (nav) nav.classList.toggle('has-new', !responded);
}
// Called at login, before the Availability page has ever been opened — a standalone request (not
// avFetch) so it is never redirected to whichever plan this browser last remembered viewing.
async function updateAvailabilityBadge() {
    try {
        const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, action: 'availability-get' }) });
        const result = await res.json();
        if (result.error) return;
        avBadgeTargetPlanId = avComputeFirstUpcoming(result.plans || []);
        setAvailabilityBadge(avBadgeTargetPlanId === null || Object.keys(result.mine || {}).length > 0 || !!result.myUnavailable);
    } catch (e) { /* not critical */ }
}

// Posts to /api/war-payout, not its own endpoint — merged in to stay under Vercel Hobby's
// 12-Serverless-Function-per-deployment limit, same reason War Badges lives there too.
async function avFetch(body) {
    if (AV_PLAN_ACTIONS.has(body.action) && avPlanId && !body.planId) body = { ...body, planId: avPlanId };
    const res = await fetch('/api/war-payout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: apiKey, ...body }),
    });
    return res.json();
}

async function loadAvailability() {
    const st = { set className(v) { $('av-status').className = v; $('av-status-l').className = v; }, set textContent(v) { $('av-status').textContent = v; $('av-status-l').textContent = v; } }; // both pages show the same status
    st.className = 'status ok'; st.textContent = 'Loading…';
    try {
        const result = await avFetch({ action: 'availability-get' });
        if (result.error) throw new Error(result.error);
        avPlans = result.plans || [];
        avArchivedPlans = result.archivedPlans || [];
        avViewingArchived = !!result.viewingArchived;
        avPlanId = result.planId || null;
        try { if (avPlanId) localStorage.setItem(AV_PLAN_KEY, avPlanId); } catch (e) { /* not critical */ }
        avConfig = result.config;
        avMine = result.mine || {};
        avMineWatch = result.mineWatch || {};
        avWatchTaken = result.watchTaken || {}; avMineRole = result.mineRole || {};
        avSummary = (typeof memberView !== "undefined" && memberView) ? null : result.summary || null; // only ever present for a leader-tier key
        avMyUnavailable = result.myUnavailable || null;
        avUnavailList = (typeof memberView !== "undefined" && memberView) ? null : result.unavailable || null;
        avResponded = (typeof memberView !== "undefined" && memberView) ? null : result.responded || null;
        avNotResponded = (typeof memberView !== "undefined" && memberView) ? null : result.notResponded === undefined ? null : result.notResponded;
        avRosterError = (typeof memberView !== "undefined" && memberView) ? null : result.rosterError || null;
        st.textContent = ''; st.className = 'status';
        renderAvailabilityPage();
        // Refresh the sidebar badge from this same load — but only trust it for whichever plan is
        // ACTUALLY the first coming-up one; if this browser is viewing some other plan, its `mine`
        // says nothing about that one, so the badge is left as whatever the last real check found.
        avBadgeTargetPlanId = avComputeFirstUpcoming(avPlans);
        if (avBadgeTargetPlanId === null) setAvailabilityBadge(true);
        else if (avPlanId === avBadgeTargetPlanId) setAvailabilityBadge(Object.keys(avMine).length > 0 || !!avMyUnavailable);
        if (avSummary !== null && avWars === null) loadAvWars(); // leaders only, once — feeds the "link to war" picker
        if (avSummary !== null) loadAvDiscord(); // leaders only — this faction's Discord destination
        if (avSummary !== null) loadAvOd(); // leaders only — who's overdosed in the window
        if (avSummary !== null) avRefreshDiscordView(false); // leaders only — who can be pinged on Discord (remembered answers only, no Torn calls)
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    }
}

const avPad = n => String(n).padStart(2, '0');
function avStartParts() { return avConfig.startDate.split('-').map(Number); } // [y, m, d]

// My timezone's offset from UTC in hours, evaluated in the middle of the tracker's window (a
// couple of days is far too short for a DST change to matter in practice). Fractional offsets
// (e.g. India's +5:30) can't line up with whole-hour slots, so those report as unsupported.
function avLocalOffset() {
    const [y, m, d] = avStartParts();
    const mid = new Date(Date.UTC(y, m - 1, d + Math.floor(avConfig.days / 2), 12));
    return -mid.getTimezoneOffset() / 60;
}
function avOffsetSupported() { return Number.isInteger(avLocalOffset()); }
function avOffset() { return (avLocal && avOffsetSupported()) ? avLocalOffset() : 0; }
function avZoneName(offset) { return offset === 0 && !avLocal ? 'TCT' : `UTC${offset >= 0 ? '+' : ''}${offset}`; }

// A column's date label. In TCT mode that's the UTC calendar date; in local mode it's the local one.
function avColLabel(col, offset) {
    const [y, m, d] = avStartParts();
    const fmt = { weekday: 'short', day: '2-digit', month: 'short' };
    if (!avLocal || offset === 0) return new Date(Date.UTC(y, m - 1, d + col)).toLocaleDateString(undefined, { ...fmt, timeZone: 'UTC' });
    return new Date(y, m - 1, d + col).toLocaleDateString(undefined, fmt);
}

// "00:00 - 01:00" rather than a bare hour — wraps midnight -> "23:00 - 00:00" correctly.
function avHourLabel(h) { return `${avPad(h)}:00 - ${avPad((h + 1) % 24)}:00`; }

// What a slot is in TCT, for tooltips — so someone viewing in local time can still see the TCT
// equivalent (what leaders/the war itself run on).
function avTctLabel(day, hour) {
    const [y, m, d] = avStartParts();
    const date = new Date(Date.UTC(y, m - 1, d + day)).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
    return `${date} ${avPad(hour)}:00 TCT`;
}

// The war this tracker is linked to (if any): a line saying when it starts, plus the start hour
// gets highlighted in both grids so everyone can see how the availability lines up with it.
function avWarStartSlot() {
    const war = avConfig?.war;
    if (!war?.start) return null;
    const [y, m, d] = avStartParts();
    const rel = war.start - Date.UTC(y, m - 1, d) / 1000;
    if (rel < 0 || rel >= avConfig.days * 86400) return null;
    return { day: Math.floor(rel / 86400), hour: Math.floor((rel % 86400) / 3600) };
}
function avIsWarSlot(day, hour) {
    const s = avWarStartSlot();
    return !!s && s.day === day && s.hour === hour;
}
// Whole days the leader expects the (often termed) war to run — a soft highlight across every hour of those
// days, distinct from the single gold-bordered start hour above. Never affects which hours can be ticked.
function avIsWarLenDay(day) {
    const s = avWarStartSlot(), n = avConfig?.war?.expectDays;
    return !!s && n > 0 && day >= s.day && day < s.day + n;
}

function renderAvWarLine() {
    const el = $('av-war-line');
    const war = avConfig?.war;
    if (!war?.start) { el.style.display = 'none'; return; }
    const at = new Date(war.start * 1000);
    const tct = at.toLocaleString(undefined, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' TCT';
    const local = (avLocal && avOffsetSupported())
        ? ` (${at.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })} your time)` : '';
    el.style.display = 'block';
    const expectNote = war.expectDays > 0 ? ` Expected to last about <b>${war.expectDays} day${war.expectDays === 1 ? '' : 's'}</b> — the soft gold-ringed days in the grid.` : '';
    el.innerHTML = `🎯 ${war.opponent ? `War vs <b>${esc(war.opponent)}</b> — s` : 'S'}tarts <b>${esc(tct)}</b>${esc(local)}.${avWarStartSlot() ? ' The gold-outlined box in the grid is the start hour.' : ''}${expectNote}${avWarKind(war)}`;
}

// ---- Overdoses (leader-only). The backend counts each member's "times overdosed" against the
// start of the window; scanning a whole faction is paced under Torn's rate limit, so it happens
// here in slices — the browser calls the scan repeatedly until it reports done.
async function loadAvOd(autoScan = true) {
    try {
        const r = await avFetch({ action: 'od-get' });
        if (r.error) throw new Error(r.error);
        avOd = r;
        avOdIds = new Set((r.members || []).map(m => String(m.id)));
        renderAvOd();
        if (avConfig && $('av-summary-panel').style.display !== 'none' && avSelected) renderAvDetail(); // refresh the 💊 markers
        if (autoScan && r.needsScan && !avOdScanning) scanAvOd(); // never scanned for this window yet — do it now
        else if (!avOdScanning) avOdFindWhen(); // the times of the overdoses that are already known
    } catch (e) {
        $('av-od-body').innerHTML = `<p style="color:var(--danger);font-size:13px;">Couldn't load overdoses: ${esc(e.message)}</p>`;
    }
}

async function scanAvOd() {
    if (avOdScanning) return;
    avOdScanning = true;
    const status = msg => { const el = $('av-od-status'); if (el) el.textContent = msg; };
    renderAvOd();
    try {
        let cursor = 0;
        for (let guard = 0; guard < 60; guard++) {
            const r = await avFetch({ action: 'od-scan', cursor });
            if (r.error) throw new Error(r.error);
            status(`Scanning members… ${Math.min(r.nextCursor, r.total)}/${r.total}${r.errors ? ` (${r.errors} couldn't be read)` : ''}`);
            if (r.rateLimited) { status('Torn asked us to slow down — waiting a moment…'); await new Promise(res => setTimeout(res, 15000)); continue; }
            if (r.done) break;
            cursor = r.nextCursor;
        }
    } catch (e) { toast(`Overdose scan failed: ${e.message}`); }
    avOdScanning = false;
    await loadAvOd(false);
}

function renderAvOd() {
    const el = $('av-od-body');
    const d = avOd;
    if (!d) return;
    const fmt = ts => new Date(ts * 1000).toLocaleString(undefined, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' TCT';
    let html = `<div style="font-size:12px;color:var(--muted);margin-bottom:8px;">Tracking from <b>${esc(fmt(d.window.start))}</b>${d.window.fallback ? ' — no war linked, so this is just the last ~3 days' : ' (48h before the war starts, rounded back to midnight)'}.</div>`;
    if (d.suspect) {
        html += '<div style="font-size:12px;color:var(--danger);margin-bottom:8px;">⚠ Torn\'s historical lookup looks like it returned zeros for most members, so these counts may be inflated. Tell WWL if the list looks wrong.</div>';
    }
    if (d.scannedAt) {
        html += d.members.length
            ? avOdTable(d, fmt)
            : `<p style="color:var(--muted);font-size:13px;margin:0 0 8px;">Nobody has overdosed in this window (${d.scannedCount} members checked).</p>`;
    } else if (!avOdScanning) {
        html += '<p style="color:var(--muted);font-size:13px;margin:0 0 8px;">Not scanned yet for this window.</p>';
    }
    html += `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <button class="ghost small" id="av-od-refresh" ${avOdScanning ? 'disabled' : ''}>${avOdScanning ? 'Scanning…' : '🔄 Refresh'}</button>
        <span id="av-od-status" style="font-size:12px;color:var(--muted);">${d.scannedAt && !avOdScanning ? `last updated ${new Date(d.scannedAt * 1000).toLocaleString()}` : ''}</span>
    </div>`;
    el.innerHTML = html;
    $('av-od-refresh')?.addEventListener('click', () => scanAvOd());
}

// Leader-only: this faction's own Discord destination(s). A faction on the shared server saves a
// channel ID (the bot posts there); any faction can instead save a webhook URL. Three named kinds
// share this one panel (buttons in index.html toggle avDiscordKind) — 'feedback' and 'whatsnew' fall
// back to 'default' until a leader gives them their own destination (discord-settings-get says so via
// `usingDefault`).
let avDiscordKind = 'default';
const AV_DC_LABELS = { default: 'Availability pings', feedback: 'Feedback reminders', whatsnew: "What's new posts" };
async function loadAvDiscord(kind = avDiscordKind) {
    avDiscordKind = kind;
    document.querySelectorAll('.dc-kind-btn').forEach(b => b.style.background = b.dataset.kind === kind ? 'var(--bench-2)' : '');
    const el = $('av-discord-body');
    try {
        const s = await avFetch({ action: 'discord-settings-get', kind });
        if (s.error) throw new Error(s.error);
        el.innerHTML = `
            <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Your faction ID: <b>${esc(s.factionId)}</b>${s.usingDefault ? ` · <span style="color:var(--muted);">no destination of its own yet — falling back to Availability pings' channel</span>` : ''}</div>
            ${s.shared ? `
            <div class="field" style="max-width:420px;">
                <label for="av-dc-channel">Discord channel ID (the WorldWideLabs bot posts here)</label>
                <input id="av-dc-channel" type="text" inputmode="numeric" value="${esc(s.channelId)}" placeholder="e.g. 123456789012345678">
                <div style="font-size:11px;color:var(--muted);margin-top:4px;">Discord → Settings → Advanced → Developer Mode on, then right-click the channel → Copy Channel ID. The bot needs View Channel + Send Messages there.</div>
            </div>` : `
            <p style="font-size:12px;color:var(--muted);margin:0 0 10px;">Your faction isn't on the shared Discord server the bot lives in, so use a webhook below (works on any server).</p>`}
            <div class="field" style="max-width:420px;">
                <label for="av-dc-webhook">${s.shared ? 'Or a webhook URL' : 'Webhook URL'} ${s.webhookSet ? `<span style="color:var(--reagent);">(saved: ${esc(s.webhookHint)})</span>` : ''}</label>
                <input id="av-dc-webhook" type="password" placeholder="${s.webhookSet ? 'Saved — paste a new one to replace it' : 'https://discord.com/api/webhooks/…'}" autocomplete="off">
                <div style="font-size:11px;color:var(--muted);margin-top:4px;">Channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
                <button class="ghost small" id="av-dc-save">Save</button>
                <button class="ghost small" id="av-dc-test">Send a test message</button>
                ${s.webhookSet ? '<button class="ghost small" id="av-dc-clear">Remove saved webhook</button>' : ''}
            </div>
            <p style="font-size:11px;color:var(--muted);margin:10px 0 0;">@mentions work for members who've linked their Discord on Torn (the same link verification bots use). Anyone without one is skipped, and you're told who.</p>`;

        const save = async (extra = {}) => {
            const body = { action: 'discord-settings-set', kind, ...extra };
            if ($('av-dc-channel')) body.channelId = $('av-dc-channel').value;
            const wh = $('av-dc-webhook').value.trim();
            if (wh) body.webhookUrl = wh;
            const r = await avFetch(body);
            if (r.error) throw new Error(r.error);
        };
        $('av-dc-save').addEventListener('click', async () => {
            try { await save(); toast(`${AV_DC_LABELS[kind]}: Discord settings saved`); loadAvDiscord(kind); } catch (e) { toast(e.message); }
        });
        $('av-dc-test').addEventListener('click', async () => {
            try {
                await save(); // save whatever's typed first, so "test" tests what you see
                const r = await avFetch({ action: 'discord-settings-test', kind });
                if (r.error) throw new Error(r.error);
                toast('Test message sent — check the channel');
                loadAvDiscord(kind);
            } catch (e) { toast(e.message); }
        });
        $('av-dc-clear')?.addEventListener('click', async () => {
            try { await save({ clearWebhook: true }); toast('Webhook removed'); loadAvDiscord(kind); } catch (e) { toast(e.message); }
        });
    } catch (e) {
        el.innerHTML = `<p style="color:var(--danger);font-size:13px;">Couldn't load Discord settings: ${esc(e.message)}</p>`;
    }
}
document.querySelectorAll('.dc-kind-btn').forEach(b => b.addEventListener('click', () => loadAvDiscord(b.dataset.kind)));

// Matched/upcoming ranked wars for the "link to war" picker in the start form (leaders only).
async function loadAvWars() {
    const sel = $('av-war-select');
    try {
        const r = await avFetch({ action: 'availability-wars' });
        if (r.error) throw new Error(r.error);
        avWars = r.wars || [];
    } catch (e) { avWars = []; }
    const fmt = ts => new Date(ts * 1000).toLocaleString(undefined, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' TCT';
    sel.innerHTML = avWars.map(w => `<option value="${esc(w.id)}">vs ${esc(w.opponent)} — starts ${esc(fmt(w.start))}</option>`).join('')
        + `<option value="">${avWars.length ? 'No war / enter the start time manually' : 'No matched war found — enter the start time manually (optional)'}</option>`;
    avOnWarSelect();
    renderAvLinkPanel();
}
function avOnWarSelect() {
    const war = (avWars || []).find(w => w.id === $('av-war-select').value);
    $('av-war-manual').style.display = war ? 'none' : 'flex';
    // Weekend wars run from the day before the start — prefill that (still editable).
    if (war) $('av-start-date').value = new Date((war.start - 86400) * 1000).toISOString().slice(0, 10);
}
$('av-war-select').addEventListener('change', avOnWarSelect);

// "Chain Monday — Fri 19 Sep → Tue 23 Sep (vs Somebody)" — the name if it has one, always the dates.
function avPlanLabel(p) {
    const f = d => d.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
    const start = new Date(`${p.startDate}T00:00:00Z`);
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + p.days - 1);
    return `${p.name ? `${p.name} — ` : ''}${f(start)} → ${f(end)}${p.war?.opponent ? ` (vs ${p.war.opponent})` : ''}`;
}

function renderAvPlanBar() {
    // the plan picker exists on the member page and (with the delete/archive buttons) on the leaders' overview.
    // While viewing an archived plan it is hidden — that plan isn't in `avPlans` any more, so it couldn't be
    // shown as "selected" there anyway — and a note bar with a way back takes its place instead.
    const options = avPlans.map(p => `<option value="${esc(p.id)}"${p.id === avPlanId ? ' selected' : ''}>${esc(avPlanLabel(p))}</option>`).join('');
    for (const sfx of ['', '-l']) {
        const bar = $('av-plan-bar' + sfx);
        if (!avPlans.length || avViewingArchived) { bar.style.display = 'none'; continue; }
        bar.style.display = 'flex';
        $('av-plan-select' + sfx).innerHTML = options;
    }
    // Council can view/pick a plan (av-plan-select-l above); resizing, archiving, deleting, and the
    // archived-plans picker are structural and stay Leader-only (see AUDIT.md).
    const canEditPlan = typeof canEditLeaderOnly === 'undefined' ? avSummary !== null : canEditLeaderOnly;
    $('av-plan-resize-l').style.display = canEditPlan && !avViewingArchived && avPlanId ? 'inline-block' : 'none';
    $('av-plan-archive-l').style.display = canEditPlan && !avViewingArchived && avPlanId ? 'inline-block' : 'none';
    $('av-plan-delete-l').style.display = canEditPlan && !avViewingArchived ? 'inline-block' : 'none';

    const arSel = $('av-archived-select-l');
    $('av-archived-bar-l').style.display = canEditPlan && avArchivedPlans.length ? 'flex' : 'none';
    if (canEditPlan) {
        arSel.innerHTML = '<option value="">— pick one to view —</option>'
            + avArchivedPlans.map(p => `<option value="${esc(p.id)}"${p.id === avPlanId && avViewingArchived ? ' selected' : ''}>${esc(avPlanLabel(p))}</option>`).join('');
    }
    $('av-archived-note-l').style.display = canEditPlan && avViewingArchived ? 'flex' : 'none';
}

['av-plan-select', 'av-plan-select-l'].forEach(id => $(id).addEventListener('change', () => {
    avPlanId = $(id).value;
    try { localStorage.setItem(AV_PLAN_KEY, avPlanId); } catch (e) { /* not critical */ }
    avSelected = null;
    loadAvailability();
}));

$('av-archived-select-l').addEventListener('change', () => {
    const id = $('av-archived-select-l').value;
    if (!id) return;
    avPlanId = id;
    try { localStorage.setItem(AV_PLAN_KEY, avPlanId); } catch (e) { /* not critical */ }
    avSelected = null;
    loadAvailability();
});

$('av-archived-back').addEventListener('click', () => {
    avPlanId = null; // let the server pick the usual (never archived) default
    try { localStorage.removeItem(AV_PLAN_KEY); } catch (e) { /* not critical */ }
    avSelected = null;
    loadAvailability();
});

$('av-plan-resize-l').addEventListener('click', async () => {
    const p = avPlans.find(x => x.id === avPlanId);
    if (!p) return;
    const v = prompt(`How many days should "${avPlanLabel(p)}" show? (1-14)\n\nMembers already on later days keep their ticks even if you shrink it — they just stop showing until you grow it again.`, String(p.days || avConfig?.days || 5));
    if (v === null) return;
    const days = Math.min(14, Math.max(1, Math.round(Number(v)) || 0));
    if (!days) { toast('Enter a number between 1 and 14.'); return; }
    try {
        const r = await avFetch({ action: 'availability-resize', days });
        if (r.error) throw new Error(r.error);
        toast('Updated');
        await loadAvailability();
    } catch (e) { toast(`Couldn't change it: ${e.message}`); }
});

$('av-plan-archive-l').addEventListener('click', async () => {
    const p = avPlans.find(x => x.id === avPlanId);
    if (!p) return;
    if (!confirm(`Archive "${avPlanLabel(p)}"? Members will no longer see it or be able to fill it in, but nothing on it is deleted — you can still open it later from "Archived plans".`)) return;
    try {
        const r = await avFetch({ action: 'availability-archive', planId: avPlanId, archived: true });
        if (r.error) throw new Error(r.error);
        toast('Plan archived');
        await loadAvailability();
    } catch (e) { toast(`Couldn't archive it: ${e.message}`); }
});

$('av-plan-unarchive-l').addEventListener('click', async () => {
    try {
        const r = await avFetch({ action: 'availability-archive', planId: avPlanId, archived: false });
        if (r.error) throw new Error(r.error);
        toast('Plan restored');
        await loadAvailability();
    } catch (e) { toast(`Couldn't restore it: ${e.message}`); }
});

$('av-plan-delete-l').addEventListener('click', async () => {
    const p = avPlans.find(x => x.id === avPlanId);
    if (!p) return;
    if (!confirm(`Delete "${avPlanLabel(p)}" and everyone's entries for it? This can't be undone.`)) return;
    try {
        const r = await avFetch({ action: 'availability-delete', planId: avPlanId });
        if (r.error) throw new Error(r.error);
        avPlanId = null;
        toast('Plan deleted');
        await loadAvailability();
    } catch (e) { toast(`Couldn't delete it: ${e.message}`); }
});

function renderAvailabilityPage() {
    $('av-leaders-locked').style.display = avSummary === null ? 'block' : 'none'; // Council gets in too, so this only locks out plain Members
    renderAvPlanBar();
    // Creating a plan is structural — Leader-only (see AUDIT.md), even though Council is past av-leaders-locked above.
    $('av-start-panel').style.display = (typeof canEditLeaderOnly === 'undefined' ? avSummary !== null : canEditLeaderOnly) ? 'block' : 'none';
    $('av-discord-panel').style.display = avSummary !== null ? 'block' : 'none';
    renderAvLinkPanel();
    $('av-od-panel').style.display = avSummary !== null ? 'block' : 'none';
    if (!avConfig) {
        $('av-none-msg').style.display = 'block';
        $('av-none-msg-l').style.display = 'block';
        $('av-tz-bar-l').style.display = 'none';
        $('av-grid-panel').style.display = 'none';
        $('av-tz-bar').style.display = 'none';
        $('av-unavail-bar').style.display = 'none';
        $('av-war-line').style.display = 'none';
        return;
    }
    $('av-none-msg').style.display = 'none';
    $('av-none-msg-l').style.display = 'none';
    $('av-grid-panel').style.display = 'block';
    renderAvWarLine();
    renderAvWatchBar();
    renderAvTzBar();
    renderAvUnavailBar();
    renderAvGrid();
    $('av-summary-panel').style.display = avSummary ? 'block' : 'none';
    if (avSummary) renderAvSummaryGrid();
    $('av-out-panel').style.display = avSummary ? 'block' : 'none'; // leaders only, same signal as the heatmap
    if (avSummary) renderAvOut();
}

// Every member's own "I can't make this war" control. While it's on, their grid is dimmed and
// locked (their ticked slots are ignored by the leader view anyway) with a clear way to undo it.
function renderAvUnavailBar() {
    const bar = $('av-unavail-bar');
    bar.style.display = 'block';
    if (avMyUnavailable) {
        bar.innerHTML = `
            <div class="av-banner" style="background:rgba(220,80,80,.14);border-color:var(--danger);color:var(--danger);">
                🚫 You've marked yourself as NOT available for this war${avMyUnavailable.note ? ` — “${esc(avMyUnavailable.note)}”` : ''}.
                <button class="ghost small" id="av-unavail-btn" style="margin-left:10px;">I can make it after all</button>
            </div>`;
    } else {
        bar.innerHTML = `<button class="ghost small" id="av-unavail-btn">🚫 I can't make this war</button>
            <span style="color:var(--muted);font-size:12px;margin-left:8px;">Real life happens — tell leadership here (same as the forum post).</span>`;
    }
    $('av-unavail-btn').addEventListener('click', toggleMyUnavailable);
    $('av-grid-body').style.opacity = avMyUnavailable ? '.4' : '';
    $('av-grid-body').style.pointerEvents = avMyUnavailable ? 'none' : '';
}

async function toggleMyUnavailable() {
    let note = '';
    if (!avMyUnavailable) {
        const answer = prompt('Optional: a short reason (leave blank to skip). Cancel to go back.');
        if (answer === null) return;
        note = answer.trim();
    }
    const btn = $('av-unavail-btn');
    btn.disabled = true;
    try {
        const result = await avFetch({ action: 'availability-unavailable', unavailable: !avMyUnavailable, note });
        if (result.error) throw new Error(result.error);
        await loadAvailability(); // reload so the bar, grid dimming and (for leaders) lists all agree
    } catch (e) {
        btn.disabled = false;
        toast(`Couldn't save that: ${e.message}`);
    }
}

// Asks Discord (via the backend) to @mention a group — everyone signed up for a slot, or everyone
// who hasn't filled the tracker in. The backend builds the mention list itself from stored data.
// If Discord pinging isn't connected yet (no webhook), the ready-made message is copied to the
// clipboard instead, so it can just be pasted into Discord.
const AV_PING_PRESETS = {
    slot: [
        'War push! Be online and ready.',
        'Prep now: energy, drugs and meds ready — we push at this time.',
        'Reminder: you signed up for this hour — please be online.',
    ],
    missing: [
        'Please fill in the war availability tracker so we know when you can fight.',
        `Last call — fill in the availability tracker, or hit "I can't make this war".`,
    ],
};
const AV_CUSTOM = 'Custom message…';

// A small popup for composing the Discord ping: pick a standard message (or write your own) and
// optionally set the push time, so the post always says clearly WHAT and WHEN. Resolves to
// { message, pushAt } (pushAt = unix seconds, 0 if left blank), or null if cancelled. The time is
// entered as TCT; the backend renders it as both TCT text and a Discord timestamp that shows in
// each reader's own timezone.
function avComposePing(kind, defaultPushAt) {
    return new Promise(resolve => {
        const presets = AV_PING_PRESETS[kind] || [];
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px;';
        const iso = defaultPushAt ? new Date(defaultPushAt * 1000).toISOString().slice(0, 16) : '';
        overlay.innerHTML = `
            <div class="panel" style="max-width:520px;width:100%;margin:0;">
                <h3>📣 Ping on Discord</h3>
                <div class="field"><label for="av-m-preset">Standard message</label>
                    <select id="av-m-preset">${presets.map((p, i) => `<option value="${i}">${esc(p)}</option>`).join('')}<option value="custom">${AV_CUSTOM}</option></select></div>
                <div class="field"><label for="av-m-text">Message</label>
                    <textarea id="av-m-text" rows="3" maxlength="300" style="width:100%;background:var(--ink);color:var(--text);border:1px solid var(--line);border-radius:var(--radius);padding:8px 10px;font:inherit;resize:vertical;">${esc(presets[0] || '')}</textarea></div>
                <div class="field"><label for="av-m-time">Push time (TCT) — optional</label>
                    <input id="av-m-time" type="datetime-local" value="${esc(iso)}"></div>
                <div id="av-m-preview" style="background:var(--bench-2);border-radius:var(--radius);padding:10px 12px;font-size:12px;color:var(--muted);margin:10px 0;white-space:pre-wrap;"></div>
                <div style="display:flex;gap:8px;justify-content:flex-end;">
                    <button class="ghost small" id="av-m-cancel">Cancel</button>
                    <button id="av-m-send">Send to Discord</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const $$ = id => overlay.querySelector('#' + id);
        const pushAt = () => { const v = $$('av-m-time').value; return v ? Math.floor(Date.parse(`${v}:00Z`) / 1000) : 0; };
        const refresh = () => {
            const t = pushAt();
            const when = t ? `\n⏰ Push: ${new Date(t * 1000).toLocaleString(undefined, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} TCT (shown in everyone's own timezone on Discord too)` : '';
            $$('av-m-preview').textContent = `${$$('av-m-text').value.trim() || '(no message)'}${when}\n@ everyone in the group`;
        };
        const close = result => { overlay.remove(); resolve(result); };
        $$('av-m-preset').addEventListener('change', () => {
            const v = $$('av-m-preset').value;
            if (v !== 'custom') $$('av-m-text').value = presets[Number(v)];
            else { $$('av-m-text').value = ''; $$('av-m-text').focus(); }
            refresh();
        });
        $$('av-m-text').addEventListener('input', () => { $$('av-m-preset').value = 'custom'; refresh(); });
        $$('av-m-time').addEventListener('input', refresh);
        $$('av-m-cancel').addEventListener('click', () => close(null));
        overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
        $$('av-m-send').addEventListener('click', () => {
            const message = $$('av-m-text').value.trim();
            if (!message && !pushAt()) { toast('Add a message or a push time first.'); return; }
            close({ message, pushAt: pushAt() });
        });
        refresh();
    });
}

async function avPingDiscord(kind, defaultPushAt, extra = {}) {
    const composed = await avComposePing(kind, defaultPushAt);
    if (!composed) return;
    try {
        const result = await avFetch({ action: 'availability-ping', kind, message: composed.message, pushAt: composed.pushAt, ...extra });
        if (result.error) throw new Error(result.error);
        const skipped = result.noDiscord?.length ? ` Couldn't @ ${result.noDiscord.length} with no verified Discord: ${result.noDiscord.join(', ')}.` : '';
        if (result.sent) {
            toast(`Posted to Discord — ${result.mentioned} @mentioned.${skipped}`);
        } else if (result.text) {
            await navigator.clipboard.writeText(result.text).catch(() => {});
            toast(`${result.configured ? '' : 'Your faction\'s Discord isn\'t connected yet (see Discord settings under Leader settings) — '}message copied instead, paste it into Discord.${skipped}`);
        }
        if (result.mapError) toast(`Discord lookup problem: ${result.mapError}`);
    } catch (e) {
        toast(`Couldn't send that: ${e.message}`);
    }
}

// Leader view: who has filled the tracker in, who hasn't yet, and who said they can't make it.
function renderAvOut() {
    const chip = (name, extra = '', id = null) => `<span class="chip${id ? avDcClass(id) : ''}" style="cursor:default;"${id ? ` title="${esc(avDcTitle(id))}"` : ''}>${esc(name)}${extra}</span>`;
    const responded = avResponded || [];
    const notResponded = avNotResponded;
    const un = avUnavailList || [];

    let html = `<div style="font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.7;"><span class="chip chip-discord" style="cursor:default;padding:1px 8px;">faded green</span> = ${avDcSource === 'bot' ? 'on our Discord server (the bot checks this)' : 'has a Discord account linked on Torn'}, gets pinged. Everyone else is skipped by the ping.
        ${avDcSource === 'bot' ? '' : '<button class="ghost small" id="av-dc-check" style="margin-left:6px;">Check who is on Discord</button> <span id="av-dc-note"></span>'}</div>`;
    html += `<div style="font-weight:700;margin-bottom:6px;">✅ Filled in (${responded.length})</div>`;
    html += responded.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">${responded.map(r => chip(r.name, r.out ? ' 🚫' : ` <span style="font-size:11px;"><b style="color:#35d99b;">${r.green ?? r.slotCount}</b>${r.maybe ? ` <b style="color:#f0b432;">+${r.maybe}</b>` : ''} <span style="color:var(--muted);">h</span>${r.watch ? ` <span class="av-watch-badge">🔵${r.watch}</span>` : ''}</span>`, r.id)).join('')}</div>`
        : '<p style="color:var(--muted);font-size:13px;margin:0 0 16px;">Nobody has filled it in yet.</p>';

    html += `<div style="font-weight:700;margin-bottom:6px;">⏳ Not filled in yet${notResponded ? ` (${notResponded.length})` : ''}</div>`;
    if (notResponded === null) {
        html += `<p style="color:var(--danger);font-size:13px;margin:0 0 16px;">Couldn't read the member list: ${esc(avRosterError || 'unknown error')}</p>`;
    } else if (!notResponded.length) {
        html += '<p style="color:var(--muted);font-size:13px;margin:0 0 16px;">Everyone has responded 🎉</p>';
    } else {
        html += `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">${notResponded.map(m => chip(m.name, '', m.id)).join('')}</div>
            <div style="margin-bottom:16px;">
                <button class="ghost small" id="av-copy-missing">Copy names</button>
                <button class="ghost small" id="av-ping-missing">📣 ${avPingLabel((notResponded || []).map(m => m.id), "Ping them on Discord")}</button>
            </div>`;
    }

    html += `<div style="font-weight:700;margin-bottom:6px;">🚫 Can't make it (${un.length})</div>`;
    html += un.length
        ? `<div style="display:flex;flex-direction:column;gap:6px;">${un.map(u => `
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">${chip(u.name)}
                <span style="color:var(--muted);font-size:12px;">${u.note ? esc(u.note) : 'no reason given'}</span></div>`).join('')}</div>`
        : '<p style="color:var(--muted);font-size:13px;margin:0;">Nobody has said they can\'t make it.</p>';
    // Leaders: check the hours people ticked against the hits they really made — in the war this plan is linked to, or in chains.
    html += `<div style="margin-top:18px;padding-top:12px;border-top:1px solid var(--line);"><div style="font-weight:700;margin-bottom:6px;">📊 Hours ticked vs hits made</div>
        <p style="color:var(--muted);font-size:13px;margin:0 0 8px;">Compares the hours each member ticked (green + yellow) with the hits they really made. Someone who ticked 40 hours and hit once is flagged. Hours with a blue ring (Chain saver / War guard) are not counted against them.
        ${avConfig?.war?.id ? `By default it uses the war hits against ${esc(avConfig.war.opponent || 'the linked war')}.` : 'This plan is not linked to a ranked war, so add chain reports below.'}</p>
        <div class="field" style="margin:0 0 8px;max-width:560px;"><label for="av-vs-chains">Chain reports instead (optional) — chain IDs or report links, separated by spaces or commas. Use this when we are only chaining and not warring.</label>
            <input autocomplete="off" id="av-vs-chains" type="text" value="${esc(avVsChains)}" placeholder="e.g. 1234567, https://www.torn.com/war.php?step=chainreport&chainID=1234568"></div>
        <div class="field" style="margin:0 0 8px;max-width:560px;"><label for="av-vs-live">Chain still running? Its start (TCT, i.e. UTC) — counts the chain hits from then until now</label>
            <input autocomplete="off" id="av-vs-live" type="datetime-local" value="${esc(avVsLive)}"></div>
        <button class="ghost small" id="av-vs-btn">Compare with the hits</button><div id="av-vs-out" style="margin-top:10px;"></div></div>`;
    $('av-out-body').innerHTML = html;
    $('av-vs-btn')?.addEventListener('click', avCompareHits);
    $('av-dc-check')?.addEventListener('click', avCheckDiscord);
    $('av-vs-chains')?.addEventListener('input', () => { avVsChains = $('av-vs-chains').value; });
    $('av-vs-live')?.addEventListener('input', () => { avVsLive = $('av-vs-live').value; });

    $('av-copy-missing')?.addEventListener('click', () => {
        navigator.clipboard.writeText(notResponded.map(m => m.name).join(', ')).then(() => toast('Names copied'));
    });
    $('av-ping-missing')?.addEventListener('click', () => {
        avPingDiscord('missing', avConfig?.war?.start || 0, {}); // time defaults to the war's start if linked
    });
}

function renderAvTzBar() {
    const bar = $('av-tz-bar');
    const supported = avOffsetSupported();
    // Big, hard-to-miss banner above each grid while viewing in local time, so nobody mistakes
    // their own hours for TCT (or vice versa) when ticking boxes or reading the heatmap.
    const showBanner = avLocal && supported;
    const bannerText = showBanner
        ? `🌍 You're viewing YOUR LOCAL TIME (${avZoneName(avLocalOffset())}) — not TCT. Boxes you tick are saved as the matching TCT hour.`
        : '';
    for (const id of ['av-tz-banner', 'av-tz-banner-2']) {
        $(id).style.display = showBanner ? 'block' : 'none';
        $(id).textContent = bannerText;
    }
    bar.style.display = 'block';
    $('av-tz-toggle').checked = avLocal && supported;
    $('av-tz-toggle').disabled = !supported;
    $('av-tz-toggle-l').checked = avLocal && supported;
    $('av-tz-toggle-l').disabled = !supported;
    $('av-tz-bar-l').style.display = avSummary !== null ? 'block' : 'none';
    const offset = avLocalOffset();
    const tzNote = !supported
        ? `(your timezone, UTC${offset >= 0 ? '+' : ''}${offset}, has a half-hour offset that can't line up with hourly slots — showing TCT)`
        : avLocal
            ? `— showing your local time (${avZoneName(offset)}). Everything is still saved in TCT, so leaders see it in TCT; hover a box for its TCT time.`
            : '— currently showing TCT (Torn City Time, UTC).';
    $('av-tz-note').textContent = tzNote;
    $('av-tz-note-l').textContent = tzNote;
}

// Builds a table for either grid. In TCT mode that's plainly `days` columns x 24 rows; in local
// mode the same absolute hours get re-bucketed into LOCAL days, which can spill into one extra
// column at the edge (e.g. UTC+2: the last two TCT hours of the final day land on the next local
// day) — so column range is derived from the offset rather than assumed. A cell that falls outside
// the tracker's window entirely is rendered disabled instead of clickable.
function avBuildTable(cellHtml) {
    const offset = avOffset();
    const total = avConfig.days * 24;
    // a plan with a start time (linked war, or one typed in) is only open from that hour on
    const [sy, sm, sd] = avStartParts();
    const startIdx = avConfig.war?.start ? Math.max(0, Math.floor((Math.floor(avConfig.war.start / 3600) * 3600 - Date.UTC(sy, sm - 1, sd) / 1000) / 3600)) : 0;
    const minCol = Math.floor(offset / 24);
    const maxCol = Math.floor((total - 1 + offset) / 24);
    let html = '<table class="av-table"><thead><tr><th></th>';
    for (let c = minCol; c <= maxCol; c++) html += `<th>${esc(avColLabel(c, offset))}</th>`;
    html += '</tr></thead><tbody>';
    for (let row = 0; row < 24; row++) {
        html += `<tr><td class="av-hour-label">${avHourLabel(row)}</td>`;
        for (let c = minCol; c <= maxCol; c++) {
            const idx = c * 24 + row - offset; // absolute TCT hour index from the tracker's start
            html += (idx < 0 || idx >= total || idx < startIdx) ? '<td class="av-cell av-cell-off"></td>' : cellHtml(Math.floor(idx / 24), idx % 24);
        }
        html += '</tr>';
    }
    return html + '</tbody></table>';
}

function renderAvGrid() {
    $('av-grid-body').innerHTML = avBuildTable((day, hour) => {
        const v = avMine[`${day}-${hour}`];
        const mine = v === 'maybe' ? ' av-cell-maybe' : v ? ' av-cell-mine' : '';
        const k = `${day}-${hour}`;
        const ring = avMineWatch[k] ? (avMineRole[k] === 'backup' ? ' av-cell-watch av-cell-backup' : ' av-cell-watch') : (avWatchMode && (avWatchTaken[k] || 0) >= 2 ? ' av-cell-full' : '');
        const war = avIsWarSlot(day, hour), warLen = avIsWarLenDay(day);
        return `<td class="av-cell${mine}${ring}${war ? ' av-cell-war' : ''}${warLen ? ' av-cell-warlen' : ''}" data-day="${day}" data-hour="${hour}" title="${esc(avTctLabel(day, hour))}${war ? ' — WAR STARTS' : ''}${warLen && !war ? ' — expected war day' : ''}"></td>`;
    });
    $('av-grid-body').querySelectorAll('.av-cell:not(.av-cell-off)').forEach(cell => {
        cell.addEventListener('click', () => (avWatchMode ? toggleAvWatch : toggleAvCell)(Number(cell.dataset.day), Number(cell.dataset.hour), cell));
    });
}

// Instant-save, optimistic — flips the box immediately, reverts with a toast if the save fails,
// rather than making the leader/member wait on a round-trip for every single click.
// Each click cycles: off -> green (available) -> yellow (maybe: likely, but busy with something
// else too) -> off again.
function avApplyCell(cellEl, v) {
    cellEl.classList.toggle('av-cell-mine', v === true);
    cellEl.classList.toggle('av-cell-maybe', v === 'maybe');
}
async function toggleAvCell(day, hour, cellEl) {
    const key = `${day}-${hour}`;
    const prev = avMine[key];
    const next = !prev ? true : prev === true ? 'maybe' : undefined;
    if (next) avMine[key] = next; else { delete avMine[key]; delete avMineWatch[key]; cellEl.classList.remove('av-cell-watch'); }
    avApplyCell(cellEl, next);
    try {
        const result = await avFetch({ action: 'availability-set', day, hour, state: next === true ? 'yes' : next === 'maybe' ? 'maybe' : '' });
        if (result.error) throw new Error(result.error);
        if (avPlanId === avBadgeTargetPlanId) setAvailabilityBadge(Object.keys(avMine).length > 0 || !!avMyUnavailable);
    } catch (e) {
        if (prev) avMine[key] = prev; else delete avMine[key];
        avApplyCell(cellEl, prev);
        toast(`Couldn't save that: ${e.message}`);
    }
}

let avSelected = null; // { day, hour } — the summary slot whose signups are currently shown

function renderAvSummaryGrid() {
    const maxCount = Math.max(1, ...Object.values(avSummary).map(s => s.count));
    const el = $('av-summary-body');
    el.innerHTML = avBuildTable((day, hour) => {
        const s = avSummary[`${day}-${hour}`];
        const count = s ? s.count : 0;
        const maybe = s ? s.maybe : 0;
        const bg = count ? `rgba(53,217,155,${(0.15 + (count / maxCount) * 0.65).toFixed(2)})` : maybe ? 'rgba(240,180,50,.25)' : 'transparent';
        const title = `${avTctLabel(day, hour)} — ${s ? s.names.join(', ') || 'nobody sure yet' : 'nobody yet'}${maybe ? ` (maybe: ${s.maybeNames.join(', ')})` : ''}`;
        const watchN = s ? s.watch || 0 : 0;
        const watchTag = watchN ? `<span class="av-watch-badge">🔵${watchN}</span>` : '';
        const label = count || maybe ? `${count || ''}${maybe ? `<span style="color:#f0b432;font-size:11px;">${count ? ' +' : ''}${maybe}?</span>` : ''}${watchTag}` : '';
        const sel = avSelected && avSelected.day === day && avSelected.hour === hour ? ' av-cell-selected' : '';
        const war = avIsWarSlot(day, hour) ? ' av-cell-war' : '';
        const warLen = avIsWarLenDay(day) ? ' av-cell-warlen' : '';
        return `<td class="av-cell av-summary-cell${count || maybe ? ' av-clickable' : ''}${sel}${war}${warLen}" style="background:${bg};" data-day="${day}" data-hour="${hour}" title="${esc(title)}">${label}</td>`;
    });
    el.querySelectorAll('.av-clickable').forEach(cell => {
        cell.addEventListener('click', () => {
            avSelected = { day: Number(cell.dataset.day), hour: Number(cell.dataset.hour) };
            renderAvSummaryGrid(); // re-render so the selection highlight moves
            renderAvDetail();
        });
    });
    renderAvDetail();
}

// Who signed up for the picked slot — so a leader can
// ping exactly the right people on Discord when it's time (or copy the names).
function renderAvDetail() {
    const el = $('av-detail');
    const s = avSelected && avSummary?.[`${avSelected.day}-${avSelected.hour}`];
    if (!s) { el.style.display = 'none'; el.innerHTML = ''; return; }
    const offset = avOffset();
    const idx = avSelected.day * 24 + avSelected.hour + offset;
    const localNote = offset !== 0
        ? ` <span style="color:var(--muted);font-weight:400;">(${esc(avColLabel(Math.floor(idx / 24), offset))} ${avPad(((idx % 24) + 24) % 24)}:00 your time)</span>`
        : '';
    el.style.display = 'block';
    el.innerHTML = `
        <div class="av-detail-box">
            <div style="font-weight:700;margin-bottom:8px;">${esc(avTctLabel(avSelected.day, avSelected.hour))}${localNote} — ${s.count} available${s.maybe ? `, ${s.maybe} maybe` : ""}</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
                ${s.names.map((n, i) => `<span class="chip${avDcClass(s.ids?.[i])}" style="cursor:default;">${esc(n)}${avOdIds.has(String(s.ids?.[i])) ? ' 💊' : ''}</span>`).join('')}
            </div>
            ${s.maybe ? `<div style="color:var(--muted);font-size:12px;margin:0 0 6px;">Maybe (${s.maybe}) — likely available, but might be busy:</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
                ${s.maybeNames.map((n, i) => `<span class="chip${avDcClass(s.maybeIds?.[i])}" style="cursor:default;border-color:#f0b432;">${esc(n)}${avOdIds.has(String(s.maybeIds?.[i])) ? ' 💊' : ''}</span>`).join('')}
            </div>` : ''}
            ${s.watch ? `<div style="color:#4da3ff;font-size:12px;margin:0 0 6px;">🔵 ${avIsWarPlan() ? 'War guards' : 'Chain savers'} (${s.watch}):</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
                ${s.watchNames.map((n, i) => `<span class="chip${avDcClass(s.watchIds?.[i])}" style="cursor:default;border-color:#4da3ff;">${esc(n)} <span style="color:var(--muted);font-size:11px;">${i === 0 ? 'first' : 'backup'}</span></span>`).join('')}
            </div>` : ''}
            ${s.names.some((n, i) => avOdIds.has(String(s.ids?.[i]))) ? '<div style="color:var(--muted);font-size:12px;margin-bottom:10px;">💊 = overdosed in the tracking window, so may take part less.</div>' : ''}
            <button class="ghost small" id="av-ping-slot">📣 ${avPingLabel(s.ids, "Ping everyone here on Discord")}</button>
            <button class="ghost small" id="av-copy-names">Copy names</button>
            <button class="ghost small" id="av-close-detail">Close</button>
        </div>`;
    $('av-ping-slot').addEventListener('click', () => {
        const day = avSelected.day, hour = avSelected.hour;
        const [y, m, d] = avStartParts();
        avPingDiscord('slot', Date.UTC(y, m - 1, d) / 1000 + (day * 24 + hour) * 3600, { day, hour }); // push time defaults to the slot's start
    });
    $('av-copy-names').addEventListener('click', () => {
        navigator.clipboard.writeText(s.names.join(', ')).then(() => toast('Names copied'));
    });
    $('av-close-detail').addEventListener('click', () => {
        avSelected = null;
        renderAvSummaryGrid();
    });
}

['av-tz-toggle', 'av-tz-toggle-l'].forEach(id => $(id).addEventListener('change', () => {
    avLocal = $(id).checked;
    try { localStorage.setItem(AV_TZ_KEY, avLocal ? '1' : '0'); } catch (e) { /* not critical */ }
    if (avConfig) renderAvailabilityPage();
}));

$('av-start-btn').addEventListener('click', async () => {
    const startDate = $('av-start-date').value;
    const days = Number($('av-days').value) || 5;
    if (!startDate) { toast('Pick a start date first.'); return; }
    // Linked to a matched war (start time taken from Torn itself), or — if none picked — an
    // optional manually entered war start (TCT). Both are optional; the tracker works unlinked.
    const warId = $('av-war-select').value;
    let warStart = 0;
    if (!warId && $('av-war-date').value) warStart = Math.floor(Date.parse(`${$('av-war-date').value}T${avPad(Number($('av-war-hour').value) || 0)}:00:00Z`) / 1000);
    const btn = $('av-start-btn');
    btn.disabled = true;
    try {
        const result = await avFetch({ action: 'availability-create', name: $('av-plan-name').value.trim(), startDate, days, warId, warStart });
        if (result.error) throw new Error(result.error);
        avPlanId = result.planId; try { localStorage.setItem(AV_PLAN_KEY, avPlanId); } catch (e) { /* not critical */ }
        $('av-plan-name').value = '';
        toast('Plan created');
        await loadAvailability();
    } catch (e) {
        toast(`Couldn't create it: ${e.message}`);
    } finally {
        btn.disabled = false;
    }
});

// ---- Hours ticked vs hits made (leaders): reads the war's hits per member (the same numbers as Member Overview) ----
async function avCompareHits() {
    const btn = $('av-vs-btn'), out = $('av-vs-out');
    btn.disabled = true;
    try {
        // where the hits come from: chain reports typed in (when we are only chaining), else the war this plan is linked to
        const chainIds = [...new Set(String($('av-vs-chains').value).split(/[\s,;]+/).map(t => (/chainID=(\d+)/i.exec(t) || /^(\d+)$/.exec(t) || [])[1]).filter(Boolean))];
        const hits = {}; // member id -> number of hits
        let source;
        const liveVal = $('av-vs-live').value;
        if (chainIds.length || liveVal) {
            for (let i = 0; i < chainIds.length; i++) {
                out.innerHTML = `<span style="color:var(--muted);font-size:13px;">Reading chain report ${i + 1} of ${chainIds.length}…</span>`;
                const data = await tornV2(`/faction/${chainIds[i]}/chainreport`);
                for (const att of (data.chainreport?.attackers || [])) hits[String(att.id)] = (hits[String(att.id)] || 0) + (att.attacks?.total ?? 0);
            }
            if (liveVal) { // a chain that is still running: read the attack log from its start until now
                const from = Math.floor(Date.parse(`${liveVal}:00Z`) / 1000);
                if (!(from > 0)) throw new Error('That start time is not valid.');
                let cursor = from;
                for (let round = 1; cursor && round <= 40; round++) {
                    out.innerHTML = `<span style="color:var(--muted);font-size:13px;">Reading the running chain${round > 1 ? ` (part ${round})` : ''}…</span>`;
                    const r = await avFetch({ action: 'av-live-hits', from: cursor });
                    if (r.error) throw new Error(r.error);
                    for (const [id, n] of Object.entries(r.perAttacker || {})) hits[id] = (hits[id] || 0) + n;
                    cursor = r.next;
                }
                if (cursor) throw new Error('That chain is very long — it was only read partly. Try a later start time.');
            }
            source = [chainIds.length ? `${chainIds.length} chain report${chainIds.length === 1 ? '' : 's'}` : '', liveVal ? 'the running chain' : ''].filter(Boolean).join(' + ');
        } else {
            if (!avConfig?.war?.id) throw new Error('Add a chain report or a running chain above, or link this plan to a ranked war.');
            let got = null;
            for (let round = 1; round <= 10 && !got; round++) {
                out.innerHTML = `<span style="color:var(--muted);font-size:13px;">Counting the hits of the war${round > 1 ? ` (part ${round})` : ''}…</span>`;
                const r = await avFetch({ action: 'mo-war', warId: avConfig.war.id });
                if (r.error) throw new Error(r.error);
                if (!r.partial) got = r.hits || {};
            }
            if (!got) throw new Error('The war is still being counted — press the button again to carry on.');
            for (const [id, h] of Object.entries(got)) hits[id] = h?.war || 0;
            source = 'the war hits';
        }
        const rows = (avResponded || []).filter(r => !r.out).map(r => ({ name: r.name, green: r.green ?? r.slotCount, maybe: r.maybe || 0, watch: r.watch || 0, hits: hits[r.id] || 0 }))
            .map(r => ({ ...r, hours: r.green + r.maybe, own: Math.max(0, r.green + r.maybe - r.watch) })); // own = hours not spent watching / coordinating
        const totalHours = rows.reduce((s, r) => s + r.own, 0), totalHits = rows.reduce((s, r) => s + r.hits, 0);
        const rate = totalHours ? totalHits / totalHours : 0; // the faction's hits per ticked hour
        rows.forEach(r => { r.expected = r.own * rate; r.ratio = r.expected ? r.hits / r.expected : 1; r.flag = r.own >= 10 && r.ratio < 0.25; });
        rows.sort((a, b) => a.ratio - b.ratio || b.hours - a.hours);
        const flagged = rows.filter(r => r.flag);
        out.innerHTML = `<div style="font-size:12px;color:var(--muted);margin-bottom:6px;">Using ${source}: the faction made about ${rate.toFixed(2)} hits per ticked hour. ⚠️ = ticked at least 10 hours but made under a quarter of what that would give — ${flagged.length} member${flagged.length === 1 ? '' : 's'} flagged.</div>
            <div class="table-scroll" style="overflow:auto;"><table style="width:100%;font-size:13px;border-collapse:collapse;">
                <thead><tr style="color:var(--muted);text-align:right;"><th style="padding:4px 8px;text-align:left;">Member</th><th style="padding:4px 8px;">Hours ticked</th><th style="padding:4px 8px;">Hits</th><th style="padding:4px 8px;">Hits per 10 h</th><th style="padding:4px 8px;"></th></tr></thead>
                <tbody>${rows.map(r => `<tr style="border-top:1px solid var(--line);${r.flag ? 'background:rgba(224,85,85,.10);' : ''}">
                    <td style="padding:4px 8px;text-align:left;">${esc(r.name)}</td>
                    <td style="padding:4px 8px;text-align:right;font-family:var(--mono);"><b style="color:#35d99b;">${r.green}</b>${r.maybe ? ` <b style="color:#f0b432;">+${r.maybe}</b>` : ''}</td>
                    <td style="padding:4px 8px;text-align:right;font-family:var(--mono);">${r.hits}</td>
                    <td style="padding:4px 8px;text-align:right;font-family:var(--mono);color:var(--muted);">${r.hours ? (r.hits / r.hours * 10).toFixed(1) : '—'}</td>
                    <td style="padding:4px 8px;text-align:left;">${r.flag ? '⚠️' : ''}</td></tr>`).join('')}</tbody></table></div>
            <button class="ghost small" id="av-vs-copy" style="margin-top:8px;">Copy the flagged names</button>`;
        $('av-vs-copy').addEventListener('click', () => navigator.clipboard.writeText(flagged.map(r => `${r.name} (${r.hours}h ticked, ${r.hits} hits)`).join('\n')).then(() => toast('Copied')));
    } catch (e) { out.innerHTML = `<span style="color:var(--danger);font-size:13px;">${esc(e.message)}</span>`; }
    finally { btn.disabled = false; }
}

// ---- The blue ring: hours I can watch the chain (a plan without a war) or coordinate the war (a plan linked to a ranked war) ----
// Coordinating = making the calls, changing plans, keeping the chat clear and motivating people. Same effort, different job.
const avIsWarPlan = () => !!avConfig?.war?.id;
const avRoleName = () => (avIsWarPlan() ? 'be a War guard' : 'be a Chain saver');
const avRoleShort = () => (avIsWarPlan() ? 'War guard' : 'Chain saver');

function renderAvWatchBar() {
    $('av-watch-label').textContent = `🔵 Mark the hours I can ${avRoleName()}`;
    $('av-watch-toggle').checked = avWatchMode;
    $('av-watch-hint').textContent = avIsWarPlan()
        ? 'This is a war plan. A War guard is online and active, keeping an eye out for when things go wrong: making the calls, changing plans, keeping the chat clear and motivating people. Each hour has room for one, plus one backup. With the switch on, click an hour to add or remove your blue ring (a solid ring is the first place, a dashed ring the backup). An hour you had not ticked becomes green.'
        : 'This is a chain plan. A Chain saver is online and active, keeping an eye on the chain and stepping in when it is about to drop. Each hour has room for one, plus one backup. With the switch on, click an hour to add or remove your blue ring (a solid ring is the first place, a dashed ring the backup). An hour you had not ticked becomes green.';
}
$('av-watch-toggle').addEventListener('change', () => { avWatchMode = $('av-watch-toggle').checked; renderAvWatchBar(); });

async function toggleAvWatch(day, hour, cellEl) {
    const key = `${day}-${hour}`;
    const wasWatch = !!avMineWatch[key], wasColour = avMine[key];
    const on = !wasWatch;
    if (on && (avWatchTaken[key] || 0) >= 2) { toast(`That hour already has ${avIsWarPlan() ? 'a War guard' : 'a Chain saver'} and a backup — pick another hour.`); return; }
    if (on) { avMineWatch[key] = true; if (!avMine[key]) avMine[key] = true; } else delete avMineWatch[key];
    cellEl.classList.toggle('av-cell-watch', on);
    avApplyCell(cellEl, avMine[key]);
    try {
        const r = await avFetch({ action: 'availability-watch', day, hour, watch: on });
        if (!r.error) loadAvailability(); // refresh who holds what (a backup moves up when the first one leaves)
        if (r.error) throw new Error(r.error);
    } catch (e) {
        if (wasWatch) avMineWatch[key] = true; else delete avMineWatch[key];
        if (wasColour) avMine[key] = wasColour; else delete avMine[key];
        cellEl.classList.toggle('av-cell-watch', wasWatch);
        avApplyCell(cellEl, avMine[key]);
        toast(`Couldn't save that: ${e.message}`);
        loadAvailability();
    }
}

// ---- Leader: link a war to the plan picked above, and note if it is termed / how it ended ----
// Leader-only (see AUDIT.md) even though Council can otherwise view this page.
function renderAvLinkPanel() {
    const canEdit = typeof canEditLeaderOnly === 'undefined' ? avSummary !== null : canEditLeaderOnly;
    if (!canEdit || !avConfig) { $('av-link-panel').style.display = 'none'; return; }
    $('av-link-panel').style.display = 'block';
    const war = avConfig.war || null;
    const cur = avPlans.find(p => p.id === avPlanId);
    $('av-link-plan').innerHTML = `Plan: <b>${esc(cur ? avPlanLabel(cur) : 'this plan')}</b>${war ? ` — linked to ${war.opponent ? `<b>${esc(war.opponent)}</b>` : 'a war start time'}` : ' — no war linked yet'}`;
    const fmt = ts => new Date(ts * 1000).toLocaleString(undefined, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' TCT';
    const list = (avWars || []).slice();
    if (war?.id && !list.some(w => w.id === String(war.id))) list.unshift({ id: String(war.id), opponent: war.opponent || 'linked war', start: war.start }); // a linked war that already ended
    $('av-link-war').innerHTML = list.map(w => `<option value="${esc(w.id)}">vs ${esc(w.opponent)} — starts ${esc(fmt(w.start))}</option>`).join('')
        + `<option value="">${list.length ? 'No ranked war / enter the start time by hand' : 'No matched war found — enter the start time by hand'}</option>`;
    $('av-link-war').value = war?.id && list.some(w => w.id === String(war.id)) ? String(war.id) : (war?.start ? '' : (list[0]?.id || ''));
    $('av-link-manual').style.display = $('av-link-war').value ? 'none' : 'flex';
    if (!$('av-link-war').value && war?.start) { const d = new Date(war.start * 1000); $('av-link-date').value = d.toISOString().slice(0, 10); $('av-link-hour').value = d.getUTCHours(); }
    $('av-link-termed').checked = !!war?.termed;
    $('av-link-result').style.display = war?.termed ? 'block' : 'none';
    $('av-link-agreed').value = war?.agreed || ''; $('av-link-lead').value = war?.lead ?? ''; $('av-link-pct').value = war?.loserPct ?? 40;
    $('av-link-our').value = war?.ourScore ?? '';
    $('av-link-their').value = war?.theirScore ?? '';
    $('av-link-expect').value = war?.expectDays ?? '';
    avLinkCompute(false);
}
$('av-link-war').addEventListener('change', () => { $('av-link-manual').style.display = $('av-link-war').value ? 'none' : 'flex'; });
$('av-link-termed').addEventListener('change', () => { $('av-link-result').style.display = $('av-link-termed').checked ? 'block' : 'none'; });
$('av-link-save').addEventListener('click', async () => {
    const warId = $('av-link-war').value;
    let warStart = 0;
    if (!warId && $('av-link-date').value) warStart = Math.floor(Date.parse(`${$('av-link-date').value}T${avPad(Number($('av-link-hour').value) || 0)}:00:00Z`) / 1000);
    const btn = $('av-link-save'); btn.disabled = true;
    try {
        const r = await avFetch({ action: 'availability-link-war', warId, warStart, termed: $('av-link-termed').checked, agreed: $('av-link-agreed').value, lead: $('av-link-lead').value, loserPct: $('av-link-pct').value, ourScore: $('av-link-our').value, theirScore: $('av-link-their').value, expectDays: $('av-link-expect').value });
        if (r.error) throw new Error(r.error);
        toast('War saved for this plan');
        await loadAvailability();
    } catch (e) { toast(`Couldn't save it: ${e.message}`); }
    finally { btn.disabled = false; }
});

// " Termed war — we won 250,000 – 231,000." for the war line

// Termed war: from who wins, the lead needed and the loser's share, work out both scores (they stay editable) and say it in one line.
// Example: lead 10,000, loser's share 40% -> the loser gets 4,000 and the winner needs 14,000.
function avLinkCompute(fill) {
    const agreed = $('av-link-agreed').value, lead = Number($('av-link-lead').value), pct = Number($('av-link-pct').value);
    const n = v => Number(v).toLocaleString();
    if (fill && agreed && lead > 0 && pct >= 0) {
        const loser = Math.round(lead * pct / 100), winner = lead + loser;
        $('av-link-our').value = agreed === 'win' ? winner : loser;
        $('av-link-their').value = agreed === 'win' ? loser : winner;
    }
    const our = $('av-link-our').value, their = $('av-link-their').value;
    $('av-link-sum').textContent = our !== '' && their !== '' ? `${agreed === 'win' ? 'We win' : agreed === 'lose' ? 'They win' : 'Scores'}: we need ${n(our)}, they get ${n(their)}${lead > 0 ? ` (a lead of ${n(lead)})` : ''}.` : '';
}
['av-link-agreed', 'av-link-lead', 'av-link-pct'].forEach(id => $(id).addEventListener('input', () => avLinkCompute(true)));
['av-link-our', 'av-link-their'].forEach(id => $(id).addEventListener('input', () => avLinkCompute(false)));

// " Termed war — agreed: we win. Lead 10,000: we need 14,000, they get 4,000." for the war line
function avWarKind(war) {
    if (!war || (!war.termed && war.termed !== false)) return '';
    if (!war.termed) return ' <b>Not a termed war.</b>';
    const n = v => Number(v).toLocaleString();
    const agreed = war.agreed === 'win' ? ' Agreed: <b>we win</b>.' : war.agreed === 'lose' ? ' Agreed: <b>they win</b>.' : '';
    const scores = war.ourScore != null && war.theirScore != null ? ` ${war.lead ? `Lead ${n(war.lead)}: ` : ''}we need <b>${n(war.ourScore)}</b>, they get <b>${n(war.theirScore)}</b>.` : '';
    return ` <b>Termed war.</b>${agreed}${scores}`;
}

// ---- Who is on Discord: name pills are tinted faded green for members who can be pinged (a Discord account is known); the ping only @mentions those ----
let avDiscord = {}; // member id -> 'yes' | 'no' | 'unknown'
let avDcSource = ''; // 'bot' = the Discord bot saw them on the server; 'torn' = the account linked on Torn
const avDcClass = id => (avDiscord[String(id)] === 'yes' ? ' chip-discord' : avDiscord[String(id)] === 'no' ? ' chip-nodiscord' : '');
const avDcTitle = id => (avDiscord[String(id)] === 'yes' ? 'On Discord — gets pinged' : avDiscord[String(id)] === 'no' ? 'No Discord linked — is not pinged' : 'Not checked yet');
function avAllMemberIds() {
    const ids = new Set();
    (avResponded || []).forEach(r => ids.add(String(r.id)));
    (avNotResponded || []).forEach(m => ids.add(String(m.id)));
    Object.values(avSummary || {}).forEach(s => [...(s.ids || []), ...(s.maybeIds || []), ...(s.watchIds || [])].forEach(i => ids.add(String(i))));
    return [...ids];
}
async function loadAvDiscordStatus(resolve = false) {
    const ids = avAllMemberIds();
    if (!ids.length) return { remaining: 0 };
    const r = await avFetch({ action: 'discord-status', ids, resolve });
    if (r.error) return { error: r.error };
    avDiscord = { ...avDiscord, ...(r.status || {}) };
    avDcSource = r.source || '';
    return { remaining: r.remaining || 0 };
}
async function avRefreshDiscordView(resolve = false) {
    const r = await loadAvDiscordStatus(resolve);
    if (avSummary) { renderAvOut(); renderAvDetail(); }
    return r;
}

// Looks up everyone not checked yet (a few per round, one Torn call each; answers are remembered), so the pills are right and the ping knows who it can reach.
async function avCheckDiscord() {
    const btn = $('av-dc-check'), note = $('av-dc-note');
    btn.disabled = true;
    try {
        for (let round = 1; round <= 8; round++) {
            note.textContent = round === 1 ? 'Checking…' : `Checking… (round ${round})`;
            const r = await avRefreshDiscordView(true);
            const again = $('av-dc-note'); // the view was redrawn, so pick the new elements up
            if (r.error) { if (again) again.textContent = r.error; return; }
            if (!r.remaining) { if (again) again.textContent = 'Done — everyone is checked.'; return; }
            if (again) again.textContent = `${r.remaining} still to check…`;
        }
    } finally { $('av-dc-check') && ($('av-dc-check').disabled = false); }
}

// "Ping the 12 on Discord (3 skipped)" once we know who can be reached; otherwise the plain label.
function avPingLabel(ids, plain) {
    const list = (ids || []).map(String);
    const known = list.filter(id => avDiscord[id] === 'yes' || avDiscord[id] === 'no');
    if (!list.length || !known.length) return plain;
    const yes = list.filter(id => avDiscord[id] === 'yes').length, no = list.filter(id => avDiscord[id] === 'no').length;
    return `Ping the ${yes} on Discord${no ? ` (${no} without Discord skipped)` : ''}`;
}

// The overdose list: every member who overdosed, with when it showed up in Torn's history and how long before the war start that was.
// Torn only keeps stat history as snapshots, so the time is "by then", not the exact minute.
function avOdTable(d, fmt) {
    const warStart = d.window.warStart;
    const at = m => m.when?.first?.to ?? null; // the first overdose was in Torn's record by this moment
    const rows = d.members.slice().sort((a, b) => (at(b) ?? 0) - (at(a) ?? 0) || b.delta - a.delta);
    const hoursBefore = ts => (warStart && ts ? Math.round((warStart - ts) / 3600) : null);
    const tone = h => (h === null ? 'var(--muted)' : h < 24 ? '#e05555' : h < 48 ? '#f0b432' : 'var(--muted)');
    const missing = rows.filter(m => !m.when).length;
    return `<div class="table-scroll" style="overflow:auto;"><table style="width:100%;font-size:13px;border-collapse:collapse;">
        <thead><tr style="color:var(--muted);text-align:left;"><th style="padding:4px 8px;">Member</th><th style="padding:4px 8px;text-align:right;">Overdoses</th><th style="padding:4px 8px;">In Torn's history by</th><th style="padding:4px 8px;text-align:right;">${warStart ? 'Before the start' : ''}</th></tr></thead>
        <tbody>${rows.map(m => {
            const t = at(m), h = hoursBefore(t), last = m.when?.last?.to;
            const rel = h === null ? '' : h >= 0 ? `${h} h before` : `${-h} h after`;
            return `<tr style="border-top:1px solid var(--line);${h !== null && h < 24 ? 'background:rgba(224,85,85,.08);' : ''}">
                <td style="padding:5px 8px;"><span class="chip${avDcClass(m.id)}" style="cursor:default;">${esc(m.name)} 💊</span></td>
                <td style="padding:5px 8px;text-align:right;font-family:var(--mono);">${m.delta}×</td>
                <td style="padding:5px 8px;">${t ? esc(fmt(t)) : `<span style="color:var(--muted);">${m.detectedAt ? `noticed ${esc(fmt(m.detectedAt))}` : 'looking it up…'}</span>`}${m.delta > 1 && last && last !== t ? `<div style="font-size:11px;color:var(--muted);">latest by ${esc(fmt(last))}</div>` : ''}</td>
                <td style="padding:5px 8px;text-align:right;font-family:var(--mono);color:${tone(h)};font-weight:700;">${rel}</td></tr>`;
        }).join('')}</tbody></table></div>
        <div style="font-size:11px;color:var(--muted);margin:6px 0 8px;">Red = within 24 h of the start, yellow = 24–48 h before. Torn saves a member's stats as snapshots, so the time is "it was in Torn's history by then" — the overdose itself was at or a little before that.${missing ? ` Looking up the time for ${missing} member${missing === 1 ? '' : 's'}…` : ''}</div>`;
}

// Finds the times for members that don't have one yet (a few per round, until none are left).
let avOdWhenBusy = false;
async function avOdFindWhen() {
    if (avOdWhenBusy || !avOd?.members?.some(m => !m.when)) return;
    avOdWhenBusy = true;
    try {
        for (let round = 0; round < 12; round++) {
            const r = await avFetch({ action: 'od-when' });
            if (r.error || r.rateLimited) break;
            if (!r.remaining) break;
        }
    } catch (e) { /* the list still shows what is known */ }
    avOdWhenBusy = false;
    try { const r = await avFetch({ action: 'od-get' }); if (!r.error) { avOd = r; renderAvOd(); } } catch (e) { /* keep what is shown */ }
}
