// availability-tracker.js — WorldWideLabs War Availability Tracker (frontend).
// Open to every member, not leader-gated — everyone marks their own day/hour slots for the window
// after being matched, before the war starts. Leaders/council additionally see the whole faction
// added up per slot (backend only includes that `summary` for a leader-tier key, see
// api/war-payout.js's 'availability-get' action), so this page shows more to a leader than to a
// regular member from the exact same load, no separate leader page needed.
//
// Everything is STORED in TCT (Torn City Time = UTC) as "day-hour" slots, relative to the tracker's
// start date — that never changes, so leaders always see one consistent picture. The "show in my
// timezone" toggle is purely a display/click mapping on top of that: a local-time cell is just
// translated to whichever TCT slot it falls on before being read or saved.
'use strict';

let avConfig = null; // { startDate, days } from the backend, or null if no tracker is active
let avMine = {}; // my own slots: "day-hour" (TCT) -> true
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

// Posts to /api/war-payout, not its own endpoint — merged in to stay under Vercel Hobby's
// 12-Serverless-Function-per-deployment limit, same reason War Badges lives there too.
async function avFetch(body) {
    const res = await fetch('/api/war-payout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: apiKey, ...body }),
    });
    return res.json();
}

async function loadAvailability() {
    const st = $('av-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    try {
        const result = await avFetch({ action: 'availability-get' });
        if (result.error) throw new Error(result.error);
        avConfig = result.config;
        avMine = result.mine || {};
        avSummary = result.summary || null; // only ever present for a leader-tier key
        avMyUnavailable = result.myUnavailable || null;
        avUnavailList = result.unavailable || null;
        avResponded = result.responded || null;
        avNotResponded = result.notResponded === undefined ? null : result.notResponded;
        avRosterError = result.rosterError || null;
        st.textContent = ''; st.className = 'status';
        renderAvailabilityPage();
        if (avSummary !== null && avWars === null) loadAvWars(); // leaders only, once — feeds the "link to war" picker
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

function renderAvWarLine() {
    const el = $('av-war-line');
    const war = avConfig?.war;
    if (!war?.start) { el.style.display = 'none'; return; }
    const at = new Date(war.start * 1000);
    const tct = at.toLocaleString(undefined, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' TCT';
    const local = (avLocal && avOffsetSupported())
        ? ` (${at.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })} your time)` : '';
    el.style.display = 'block';
    el.innerHTML = `🎯 ${war.opponent ? `War vs <b>${esc(war.opponent)}</b> — s` : 'S'}tarts <b>${esc(tct)}</b>${esc(local)}.${avWarStartSlot() ? ' The gold-outlined box in the grid is the start hour.' : ''}`;
}

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
}
function avOnWarSelect() {
    const war = (avWars || []).find(w => w.id === $('av-war-select').value);
    $('av-war-manual').style.display = war ? 'none' : 'flex';
    // Weekend wars run from the day before the start — prefill that (still editable).
    if (war) $('av-start-date').value = new Date((war.start - 86400) * 1000).toISOString().slice(0, 10);
}
$('av-war-select').addEventListener('change', avOnWarSelect);

function renderAvailabilityPage() {
    $('av-start-panel').style.display = avSummary !== null ? 'block' : 'none'; // leader-only, inferred from whether summary came back at all
    if (!avConfig) {
        $('av-none-msg').style.display = 'block';
        $('av-grid-panel').style.display = 'none';
        $('av-tz-bar').style.display = 'none';
        $('av-unavail-bar').style.display = 'none';
        $('av-war-line').style.display = 'none';
        return;
    }
    $('av-none-msg').style.display = 'none';
    $('av-grid-panel').style.display = 'block';
    renderAvWarLine();
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
            toast(`${result.configured ? '' : 'Discord pinging isn\'t connected yet — '}message copied instead, paste it into Discord.${skipped}`);
        }
        if (result.mapError) toast(`Discord lookup problem: ${result.mapError}`);
    } catch (e) {
        toast(`Couldn't send that: ${e.message}`);
    }
}

// Leader view: who has filled the tracker in, who hasn't yet, and who said they can't make it.
function renderAvOut() {
    const chip = (name, extra = '') => `<span class="chip" style="cursor:default;">${esc(name)}${extra}</span>`;
    const responded = avResponded || [];
    const notResponded = avNotResponded;
    const un = avUnavailList || [];

    let html = `<div style="font-weight:700;margin-bottom:6px;">✅ Filled in (${responded.length})</div>`;
    html += responded.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">${responded.map(r => chip(r.name, r.out ? ' 🚫' : ` <span style="color:var(--muted);font-size:11px;">${r.slotCount}h</span>`)).join('')}</div>`
        : '<p style="color:var(--muted);font-size:13px;margin:0 0 16px;">Nobody has filled it in yet.</p>';

    html += `<div style="font-weight:700;margin-bottom:6px;">⏳ Not filled in yet${notResponded ? ` (${notResponded.length})` : ''}</div>`;
    if (notResponded === null) {
        html += `<p style="color:var(--danger);font-size:13px;margin:0 0 16px;">Couldn't read the member list: ${esc(avRosterError || 'unknown error')}</p>`;
    } else if (!notResponded.length) {
        html += '<p style="color:var(--muted);font-size:13px;margin:0 0 16px;">Everyone has responded 🎉</p>';
    } else {
        html += `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">${notResponded.map(m => chip(m.name)).join('')}</div>
            <div style="margin-bottom:16px;">
                <button class="ghost small" id="av-copy-missing">Copy names</button>
                <button class="ghost small" id="av-ping-missing">📣 Ping them on Discord</button>
            </div>`;
    }

    html += `<div style="font-weight:700;margin-bottom:6px;">🚫 Can't make it (${un.length})</div>`;
    html += un.length
        ? `<div style="display:flex;flex-direction:column;gap:6px;">${un.map(u => `
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">${chip(u.name)}
                <span style="color:var(--muted);font-size:12px;">${u.note ? esc(u.note) : 'no reason given'}</span></div>`).join('')}</div>`
        : '<p style="color:var(--muted);font-size:13px;margin:0;">Nobody has said they can\'t make it.</p>';
    $('av-out-body').innerHTML = html;

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
    const offset = avLocalOffset();
    $('av-tz-note').textContent = !supported
        ? `(your timezone, UTC${offset >= 0 ? '+' : ''}${offset}, has a half-hour offset that can't line up with hourly slots — showing TCT)`
        : avLocal
            ? `— showing your local time (${avZoneName(offset)}). Everything is still saved in TCT, so leaders see it in TCT; hover a box for its TCT time.`
            : '— currently showing TCT (Torn City Time, UTC).';
}

// Builds a table for either grid. In TCT mode that's plainly `days` columns x 24 rows; in local
// mode the same absolute hours get re-bucketed into LOCAL days, which can spill into one extra
// column at the edge (e.g. UTC+2: the last two TCT hours of the final day land on the next local
// day) — so column range is derived from the offset rather than assumed. A cell that falls outside
// the tracker's window entirely is rendered disabled instead of clickable.
function avBuildTable(cellHtml) {
    const offset = avOffset();
    const total = avConfig.days * 24;
    const minCol = Math.floor(offset / 24);
    const maxCol = Math.floor((total - 1 + offset) / 24);
    let html = '<table class="av-table"><thead><tr><th></th>';
    for (let c = minCol; c <= maxCol; c++) html += `<th>${esc(avColLabel(c, offset))}</th>`;
    html += '</tr></thead><tbody>';
    for (let row = 0; row < 24; row++) {
        html += `<tr><td class="av-hour-label">${avHourLabel(row)}</td>`;
        for (let c = minCol; c <= maxCol; c++) {
            const idx = c * 24 + row - offset; // absolute TCT hour index from the tracker's start
            html += (idx < 0 || idx >= total) ? '<td class="av-cell av-cell-off"></td>' : cellHtml(Math.floor(idx / 24), idx % 24);
        }
        html += '</tr>';
    }
    return html + '</tbody></table>';
}

function renderAvGrid() {
    $('av-grid-body').innerHTML = avBuildTable((day, hour) => {
        const mine = !!avMine[`${day}-${hour}`];
        const war = avIsWarSlot(day, hour);
        return `<td class="av-cell${mine ? ' av-cell-mine' : ''}${war ? ' av-cell-war' : ''}" data-day="${day}" data-hour="${hour}" title="${esc(avTctLabel(day, hour))}${war ? ' — WAR STARTS' : ''}"></td>`;
    });
    $('av-grid-body').querySelectorAll('.av-cell:not(.av-cell-off)').forEach(cell => {
        cell.addEventListener('click', () => toggleAvCell(Number(cell.dataset.day), Number(cell.dataset.hour), cell));
    });
}

// Instant-save, optimistic — flips the box immediately, reverts with a toast if the save fails,
// rather than making the leader/member wait on a round-trip for every single click.
async function toggleAvCell(day, hour, cellEl) {
    const key = `${day}-${hour}`;
    const newVal = !avMine[key];
    if (newVal) avMine[key] = true; else delete avMine[key];
    cellEl.classList.toggle('av-cell-mine', newVal);
    try {
        const result = await avFetch({ action: 'availability-set', day, hour, available: newVal });
        if (result.error) throw new Error(result.error);
    } catch (e) {
        if (newVal) delete avMine[key]; else avMine[key] = true;
        cellEl.classList.toggle('av-cell-mine', !!avMine[key]);
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
        const bg = count ? `rgba(53,217,155,${(0.15 + (count / maxCount) * 0.65).toFixed(2)})` : 'transparent';
        const title = `${avTctLabel(day, hour)} — ${s ? s.names.join(', ') : 'nobody yet'}`;
        const sel = avSelected && avSelected.day === day && avSelected.hour === hour ? ' av-cell-selected' : '';
        const war = avIsWarSlot(day, hour) ? ' av-cell-war' : '';
        return `<td class="av-cell av-summary-cell${count ? ' av-clickable' : ''}${sel}${war}" style="background:${bg};" data-day="${day}" data-hour="${hour}" title="${esc(title)}">${count || ''}</td>`;
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
            <div style="font-weight:700;margin-bottom:8px;">${esc(avTctLabel(avSelected.day, avSelected.hour))}${localNote} — ${s.count} available</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
                ${s.names.map(n => `<span class="chip" style="cursor:default;">${esc(n)}</span>`).join('')}
            </div>
            <button class="ghost small" id="av-ping-slot">📣 Ping everyone here on Discord</button>
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

$('av-tz-toggle').addEventListener('change', () => {
    avLocal = $('av-tz-toggle').checked;
    try { localStorage.setItem(AV_TZ_KEY, avLocal ? '1' : '0'); } catch (e) { /* not critical */ }
    if (avConfig) renderAvailabilityPage();
});

$('av-start-btn').addEventListener('click', async () => {
    const startDate = $('av-start-date').value;
    const days = Number($('av-days').value) || 5;
    if (!startDate) { toast('Pick a start date first.'); return; }
    // Linked to a matched war (start time taken from Torn itself), or — if none picked — an
    // optional manually entered war start (TCT). Both are optional; the tracker works unlinked.
    const warId = $('av-war-select').value;
    let warStart = 0;
    if (!warId && $('av-war-date').value) warStart = Math.floor(Date.parse(`${$('av-war-date').value}T${avPad(Number($('av-war-hour').value) || 0)}:00:00Z`) / 1000);
    if (!confirm('Start a new tracker? This wipes everyone\'s current entries.')) return;
    const btn = $('av-start-btn');
    btn.disabled = true;
    try {
        const result = await avFetch({ action: 'availability-start', startDate, days, warId, warStart });
        if (result.error) throw new Error(result.error);
        toast('Tracker started');
        await loadAvailability();
    } catch (e) {
        toast(`Couldn't start it: ${e.message}`);
    } finally {
        btn.disabled = false;
    }
});
