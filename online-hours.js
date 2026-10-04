// online-hours.js — "When are you usually online?" at the top of the Mentoring page: tick the hours of a normal day you are usually around. Saved as TCT
// (like the availability tracker); the toggle only changes how the hours are shown and ticked, in your own time zone instead.
// Leaders see everyone's hours on the Mentoring admin page (ohStrip / ohOverlap below) to pair people who are online at the same time.
// Backend: lib/onlineHours.js.
'use strict';

const OH_TZ_KEY = 'wwl_oh_local_tz';
let ohLocal = false;
try { const v = localStorage.getItem(OH_TZ_KEY); ohLocal = v != null ? v === '1' : localStorage.getItem('wwl_av_local_tz') === '1'; } catch (e) { /* default TCT */ }
let ohMine = new Set(); // my hours, TCT
let ohSaved = null;     // what is saved (sorted array) — to know when there is something to save

async function ohFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}
const ohLocalOffset = () => -new Date().getTimezoneOffset() / 60;
const ohOffsetOk = () => Number.isInteger(ohLocalOffset());
const ohOffset = () => (ohLocal && ohOffsetOk()) ? ohLocalOffset() : 0;
const ohZone = () => { const o = ohOffset(); return o === 0 && !ohLocal ? 'TCT' : `UTC${o >= 0 ? '+' : ''}${o}`; };
const ohTct = displayed => ((displayed - ohOffset()) % 24 + 24) % 24; // an hour as shown -> its TCT hour
const ohShown = tct => ((tct + ohOffset()) % 24 + 24) % 24;
const ohHourLabel = h => String(h).padStart(2, '0');

// ---- the member's own grid (dashboard) ----
function renderOnlineHours() {
    const grid = $('oh-grid');
    if (!grid) return;
    $('oh-tz').checked = ohLocal && ohOffsetOk();
    $('oh-tz').disabled = !ohOffsetOk();
    $('oh-zone').textContent = ohZone();
    $('oh-tz-note').textContent = ohOffsetOk() ? '' : 'Your time zone is not a whole number of hours, so only TCT can be used here.';
    let cells = '';
    for (let d = 0; d < 24; d++) {
        const on = ohMine.has(ohTct(d));
        cells += `<button type="button" class="oh-cell" data-d="${d}" style="padding:6px 0;border-radius:6px;border:1px solid ${on ? 'var(--reagent)' : 'var(--line)'};background:${on ? 'rgba(53,217,155,.18)' : 'transparent'};color:${on ? 'var(--reagent)' : 'var(--muted)'};font-family:var(--mono);font-size:12px;cursor:pointer;">${ohHourLabel(d)}</button>`;
    }
    grid.innerHTML = cells;
    grid.querySelectorAll('.oh-cell').forEach(b => b.addEventListener('click', () => {
        const t = ohTct(Number(b.dataset.d));
        if (ohMine.has(t)) ohMine.delete(t); else ohMine.add(t);
        renderOnlineHours();
    }));
    const now = [...ohMine].sort((a, b) => a - b).join(',');
    const was = (ohSaved || []).join(',');
    $('oh-save').disabled = now === was;
    $('oh-count').textContent = ohMine.size ? `${ohMine.size} hour${ohMine.size === 1 ? '' : 's'} ticked` : 'Nothing ticked yet';
}
async function loadOnlineHours() {
    if (!$('oh-grid')) return;
    const r = await ohFetch({ action: 'oh-get' });
    if (r.error) { $('dash-oh-panel').style.display = 'none'; return; }
    $('dash-oh-panel').style.display = 'block';
    ohSaved = r.hours || [];
    ohMine = new Set(ohSaved);
    renderOnlineHours();
}
$('oh-tz').addEventListener('change', () => {
    ohLocal = $('oh-tz').checked;
    try { localStorage.setItem(OH_TZ_KEY, ohLocal ? '1' : '0'); } catch (e) { /* not critical */ }
    renderOnlineHours();
});
$('oh-clear').addEventListener('click', () => { ohMine = new Set(); renderOnlineHours(); });
$('oh-save').addEventListener('click', async () => {
    const st = $('oh-status'), btn = $('oh-save');
    btn.disabled = true; st.className = 'status ok'; st.textContent = 'Saving…';
    const r = await ohFetch({ action: 'oh-set', hours: [...ohMine] });
    if (r.error) { st.className = 'status err'; st.textContent = r.error; btn.disabled = false; return; }
    ohSaved = r.hours || [];
    st.className = 'status ok'; st.textContent = '✓ Saved — thank you!';
    renderOnlineHours();
});

// ---- for leaders (Mentoring admin) ----
// A row of 24 small blocks in the shown time zone (TCT unless the toggle is on); filled = usually online.
function ohStrip(hours) {
    if (!hours || !hours.length) return '<span style="color:var(--muted);font-size:11px;">not set</span>';
    const set = new Set(hours);
    let out = '';
    for (let d = 0; d < 24; d++) out += `<span title="${ohHourLabel(d)}:00 ${ohZone()}" style="display:inline-block;width:6px;height:14px;margin-right:${d % 6 === 5 ? 3 : 1}px;border-radius:1px;background:${set.has(ohTct(d)) ? 'var(--reagent)' : 'var(--line)'};"></span>`;
    return `<span style="white-space:nowrap;">${out}</span>`;
}
// how many hours two people are both usually online (TCT hours); null when either has not said
function ohOverlap(a, b) {
    if (!a || !a.length || !b || !b.length) return null;
    const s = new Set(a);
    return b.filter(h => s.has(h)).length;
}
