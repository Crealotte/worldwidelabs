// faction-perks.js — the two pages of the Faction menu: "Steadfast" (which stats get the top perk this
// month and next month, the yearly rotation, and the countdown per stat) and "Perk roadmap" (the order in
// which the faction unlocks its perks, with what is done, what is next, and what is behind schedule).
// The levels, respect and challenge numbers come from Torn by themselves (lib/steadfast.js, stored whenever a
// leader opens WWL); the rotation and the roadmap themselves are the faction's own plans, written down below.
'use strict';

// ---- the faction's own plans ----------------------------------------------------------------------
// Steadfast rotation: per month [top perk, top perk, lower perk, lower perk]. The perks are swapped on the
// FIRST SUNDAY of the new month.
const FP_ROTATION = {
    1: ['speed', 'dexterity', 'strength', 'defense'], 2: ['dexterity', 'strength', 'defense', 'speed'],
    3: ['strength', 'defense', 'speed', 'dexterity'], 4: ['defense', 'speed', 'dexterity', 'strength'],
    5: ['speed', 'dexterity', 'strength', 'defense'], 6: ['dexterity', 'strength', 'defense', 'speed'],
    7: ['strength', 'defense', 'speed', 'dexterity'], 8: ['defense', 'speed', 'dexterity', 'strength'],
    9: ['speed', 'dexterity', 'strength', 'defense'], 10: ['dexterity', 'strength', 'defense', 'speed'],
    11: ['strength', 'defense', 'speed', 'dexterity'], 12: ['defense', 'speed', 'dexterity', 'strength'],
};
const FP_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Perk roadmap. FP_UNLOCKED is what the faction has accomplished (the earlier plans, kept so members see what we did), in date order:
// [perk (as Torn names it, without the level), level, required respect, day it was unlocked]. The perk tree was reset on 2026-11-01 (Toleration: Addiction XIII, Side effects X, Overdosing VIII;
// Voracity: Booster cooldown XV, Candy effect X, Energy drink effect V; Excursion: Travel capacity IV), so every perk that was still planned got that day as its unlock day.
const FP_UNLOCKED = [
    ['Overdosing', 1, 4168, '2026-06-07'],
    ['Overdosing', 2, 4920, '2026-06-14'], ['Overdosing', 3, 5618, '2026-06-14'],
    ['Overdosing', 4, 6633, '2026-06-28'], ['Overdosing', 5, 7574, '2026-06-28'], ['Travel capacity', 1, 8000, '2026-06-28'],
    ['Overdosing', 6, 8941, '2026-07-05'],
    ['Travel capacity', 2, 10792, '2026-07-26'], ['Travel capacity', 3, 14552, '2026-07-26'],
    ['Travel capacity', 4, 19608, '2026-08-02'],
    ['Candy effect', 1, 4420, '2026-08-09'], ['Candy effect', 2, 5048, '2026-08-09'], ['Candy effect', 3, 5964, '2026-08-09'],
    ['Candy effect', 4, 7040, '2026-08-16'], ['Candy effect', 5, 8036, '2026-08-16'],
    ['Candy effect', 6, 9484, '2026-08-23'],
    ['Candy effect', 7, 10832, '2026-08-30'],
    ['Candy effect', 8, 12784, '2026-09-06'],
    ['Candy effect', 9, 14600, '2026-09-13'],
    ['Candy effect', 10, 17236, '2026-09-20'],
    ['Overdosing', 7, 10555, '2026-10-11'],
    ['Overdosing', 8, 12054, '2026-10-18'],
    ['Booster cooldown', 11, 11572, '2026-11-01'], ['Booster cooldown', 12, 12784, '2026-11-01'], ['Booster cooldown', 13, 14124, '2026-11-01'],
    ['Booster cooldown', 14, 16128, '2026-11-01'], ['Booster cooldown', 15, 17816, '2026-11-01'],
    ['Energy drink effect', 1, 17816, '2026-11-01'],
];
// The perks still to come, in the order the faction unlocks them: [perk, level, required respect, planned date]. Steadfast is not in it - it is upgraded as soon as it can be.
// The order stays the same when the faction is behind schedule. A level of 0 is a one-off upgrade without levels (the chain upgrade): it counts as done once a later perk of the list is.
// Plan of 2026-11-01. A Steadfast upgrade can still come in between, whenever it is ready.
const FP_ROADMAP = [
    ['Addiction', 14, 4604, '2026-11-01'], ['Addiction', 15, 5258, '2026-11-08'], ['Addiction', 16, 5808, '2026-11-08'], ['Addiction', 17, 6414, '2026-11-08'],
    ['Addiction', 18, 7088, '2026-11-15'], ['Addiction', 19, 7830, '2026-11-15'], ['Addiction', 20, 8941, '2026-11-22'],
    ['Booster cooldown', 16, 9840, '2026-11-29'], ['Addiction', 21, 9877, '2026-11-29'],
    ['Booster cooldown', 17, 10870, '2026-12-06'],
    ['Addiction', 22, 10911, '2026-12-13'], ['Booster cooldown', 18, 12008, '2026-12-13'],
    ['Chain upgrade', 0, 34258, '2027-01-03'],
    ['Addiction', 23, 12054, '2027-01-10'], ['Booster cooldown', 19, 13714, '2027-01-10'],
    ['Addiction', 24, 13766, '2027-01-17'], ['Booster cooldown', 20, 15148, '2027-01-24'],
    ['Addiction', 25, 15207, '2027-01-31'],
    ['Travel capacity', 5, 26432, '2027-02-14'], ['Booster cooldown', 21, 16734, '2027-02-21'],
    ['Booster cooldown', 22, 18486, '2027-03-07'], ['Booster cooldown', 23, 21110, '2027-03-14'], ['Booster cooldown', 24, 23320, '2027-03-28'],
    ['Travel capacity', 6, 36632, '2027-04-25'], ['Travel capacity', 7, 48032, '2027-05-16'], ['Travel capacity', 8, 66936, '2027-06-13'],
    ['Rehab cost', 1, 66936, '2027-07-18'], ['Rehab cost', 2, 73944, '2027-08-22'], ['Rehab cost', 3, 81680, '2027-09-26'],
];
const fpRoman = n => { let s = ''; for (const [v, r] of [[50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]) while (n >= v) { s += r; n -= v; } return s; };
const fpPerk = (perk, level) => level ? `${perk} ${fpRoman(level)}` : perk;
const fpNum = n => Math.round(n).toLocaleString();
const FP_LABEL = { strength: 'Strength', defense: 'Defense', speed: 'Speed', dexterity: 'Dexterity' };
const FP_COLOR = { strength: '#3b6fd4', defense: '#e5531d', speed: '#f5a30b', dexterity: '#1f9d3a' };
let fpData = null; // the stored countdown from the server: levels, respect, per-stat challenge numbers

async function fpFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}
async function fpLoad() {
    const leader = typeof isLeaderCached !== 'undefined' && isLeaderCached;
    let r = leader ? await fpFetch({ action: 'steadfast-refresh' }) : await fpFetch({ action: 'steadfast-get' });
    if (r.error && leader) r = await fpFetch({ action: 'steadfast-get' });
    fpData = r.error ? null : r.countdown;
    return !!fpData;
}

// ---- Steadfast page --------------------------------------------------------------------------------
function fpFirstSunday(y, m) { const first = new Date(Date.UTC(y, m, 1)); return Date.UTC(y, m, 1 + (7 - first.getUTCDay()) % 7); }
// The rotation month that applies now: a new month starts on its first Sunday.
function fpActiveMonth(now = new Date()) {
    let y = now.getUTCFullYear(), m = now.getUTCMonth();
    if (now.getTime() < fpFirstSunday(y, m)) { m -= 1; if (m < 0) { m = 11; y -= 1; } }
    return { month: m + 1, year: y };
}

async function loadFactionSteadfast() {
    const ok = await fpLoad();
    const { month, year } = fpActiveMonth();
    const nextMonth = month % 12 + 1, nextYear = month === 12 ? year + 1 : year;
    const swap = new Date(fpFirstSunday(nextYear, nextMonth - 1));
    const live = {}; if (ok) fpData.rows.forEach(r => { live[r.stat] = r.pct; });
    const roleText = (arr, stats) => `<span style="color:var(--reagent);font-weight:700;">${arr.slice(0, 2).map(s => FP_LABEL[s]).join(' & ')}</span> get the top perk, <span style="color:var(--muted);">${arr.slice(2).map(s => FP_LABEL[s]).join(' & ')}</span> the lower one`;
    $('fs-months').innerHTML = `
        <div class="grid2">
            <div class="stat"><div class="k">This month — ${FP_MONTHS[month - 1]}</div>
                <div style="font-size:14px;margin:6px 0;">${roleText(FP_ROTATION[month])}</div>
                ${ok ? `<div style="font-size:12px;color:var(--muted);">Right now: ${['strength', 'defense', 'speed', 'dexterity'].map(s => `${FP_LABEL[s]} +${live[s] ?? '?'}%`).join(' · ')}</div>` : ''}</div>
            <div class="stat"><div class="k">Next month — ${FP_MONTHS[nextMonth - 1]}</div>
                <div style="font-size:14px;margin:6px 0;">${roleText(FP_ROTATION[nextMonth])}</div>
                <div style="font-size:12px;color:var(--muted);">Swapped on the first Sunday: ${swap.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}</div></div>
        </div>`;
    $('fs-rotation').innerHTML = `<table style="width:100%;font-size:13px;border-collapse:collapse;text-align:left;">
        <thead><tr style="color:var(--muted);"><th style="padding:4px 8px;">Month</th><th style="padding:4px 8px;">Top perk</th><th style="padding:4px 8px;"></th><th style="padding:4px 8px;">Lower perk</th><th style="padding:4px 8px;"></th></tr></thead>
        <tbody>${Object.entries(FP_ROTATION).map(([mo, arr]) => `<tr style="border-top:1px solid var(--line);${Number(mo) === month ? 'background:rgba(53,217,155,.10);font-weight:700;' : ''}">
            <td style="padding:4px 8px;">${FP_MONTHS[mo - 1]}${Number(mo) === month ? ' ◀ now' : ''}</td>
            ${arr.map((s, i) => `<td style="padding:4px 8px;color:${FP_COLOR[s]};">${FP_LABEL[s]}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

    // the countdown per stat
    $('fs-countdown').innerHTML = ok ? fpData.rows.map(r => {
        const pct = r.goal ? Math.min(100, r.total / r.goal * 100) : 0;
        return `<div style="margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;gap:10px;font-size:14px;"><b style="color:${FP_COLOR[r.stat]};">${FP_LABEL[r.stat]}</b><span style="font-family:var(--mono);">${r.goal ? `${fpNum(r.total)} / ${fpNum(r.goal)}` : `${fpNum(r.total)} energy`}</span></div>
            ${r.goal ? `<div style="background:var(--bench-2);border-radius:4px;height:8px;margin:5px 0;"><div style="width:${pct.toFixed(1)}%;background:${r.done ? 'var(--reagent)' : 'rgba(240,180,50,.45)'};height:8px;border-radius:4px;"></div></div>` : ''}
            <div style="font-size:12px;color:var(--muted);">${r.done ? '<span style="color:var(--reagent);">Done ✓</span>' : r.goal ? `<b style="color:var(--text);">${fpNum(r.remaining)} energy to go</b>${r.etaDays ? ` — about ${r.etaDays} day${r.etaDays === 1 ? '' : 's'} at the recent pace` : ''}` : 'Goal not known yet.'}</div></div>`;
    }).join('') + `<div style="font-size:14px;margin-top:4px;">${fpData.allDone ? '<b style="color:var(--reagent);">All done — time to upgrade to 9%! 🎉</b>' : fpData.waiting.length ? `We upgrade when <b>all</b> are done. Still waiting for: <b style="color:#f0b432;">${fpData.waiting.map(s => FP_LABEL[s]).join(', ')}</b>.` : ''}</div>`
        : '<p style="color:var(--muted);">The numbers appear as soon as a leader has opened WWL.</p>';
}

// ---- Perk roadmap page -----------------------------------------------------------------------------
async function loadFactionRoadmap() {
    const ok = await fpLoad();
    const levels = ok ? fpData.allLevels : {};
    const now = Date.now();
    let nextFound = false;
    const doneAt = FP_ROADMAP.map(([perk, level]) => ok && level > 0 && (levels[perk.toLowerCase()] || 0) >= level);
    const items = FP_ROADMAP.map(([perk, level, respect, date], idx) => {
        const done = doneAt[idx] || (ok && level === 0 && doneAt.slice(idx + 1).some(Boolean));
        const isNext = ok && !done && !nextFound; if (isNext) nextFound = true;
        const late = !done && Date.parse(`${date}T00:00:00Z`) + 86400e3 <= now; // a perk planned for today is not late yet
        const weeks = late ? Math.floor((now - Date.parse(`${date}T00:00:00Z`)) / (7 * 86400e3)) : 0;
        return { perk, level, respect, date, done, isNext, late, weeks };
    });
    const unlocked = FP_UNLOCKED.map(([perk, level, respect, date]) => ({ perk, level, respect, date, done: true, isNext: false, late: false, weeks: 0, fixed: true }));
    const all = [...unlocked, ...items];
    const doneCount = all.filter(i => i.done).length, next = items.find(i => i.isNext);
    // "Available" respect is the spendable balance left after everything already bought (any branch,
    // peace or war) — NOT the lifetime total, which never goes down. See buildCountdown in lib/steadfast.js.
    const available = fpData?.availableRespect;
    const respectLine = fpData?.respect == null ? '' : next && available != null
        ? `<div style="margin-top:8px;max-width:320px;">
            <div style="color:var(--muted);font-size:12px;">${fpNum(available)} / ${fpNum(next.respect)} respect available</div>
            <div style="background:var(--bench-2);border-radius:4px;height:6px;margin-top:4px;"><div style="width:${Math.min(100, available / next.respect * 100).toFixed(1)}%;background:var(--reagent);height:6px;border-radius:4px;"></div></div>
          </div>`
        : `<div style="color:var(--muted);font-size:12px;margin-top:8px;">Faction respect (total): ${fpNum(fpData.respect)}</div>`;
    $('fr-summary').innerHTML = ok ? `
        <div class="grid3">
            <div class="stat"><div class="k">Unlocked</div><div class="v good">${doneCount} / ${all.length}</div><div class="s">perks of the roadmap</div></div>
            <div class="stat"><div class="k">Next up</div><div class="v" style="font-size:18px;">${next ? `${esc(fpPerk(next.perk, next.level))}` : items.length ? 'All done' : 'New plan coming'}</div><div class="s">${next ? `needs ${fpNum(next.respect)} respect · planned ${fpDateLabel(next.date)}` : ''}</div></div>
            <div class="stat"><div class="k">Schedule</div><div class="v ${next && next.late ? 'bad' : 'good'}" style="font-size:18px;">${next ? (next.late ? `${next.weeks || '<1'} week${next.weeks === 1 ? '' : 's'} behind` : 'on schedule') : items.length ? 'done' : '-'}</div><div class="s">the order stays the same when behind</div></div>
        </div>${respectLine}`
        : '<p style="color:var(--muted);">The levels appear as soon as a leader has opened WWL.</p>';
    const head = `<thead><tr style="color:var(--muted);"><th style="padding:4px 8px;">Perk</th><th style="padding:4px 8px;">Required respect</th><th style="padding:4px 8px;">Date</th><th style="padding:4px 8px;">Status</th></tr></thead>`;
    const rowHtml = i => `<tr style="border-top:1px solid var(--line);${i.isNext ? 'background:rgba(53,217,155,.10);' : ''}${i.done && !i.fixed ? 'opacity:.6;' : ''}">
        <td style="padding:4px 8px;${i.isNext ? 'font-weight:700;' : ''}">${esc(fpPerk(i.perk, i.level))}</td>
        <td style="padding:4px 8px;font-family:var(--mono);">${fpNum(i.respect)}</td>
        <td style="padding:4px 8px;white-space:nowrap;">${fpDateLabel(i.date)}</td>
        <td style="padding:4px 8px;">${i.done ? '<span style="color:var(--reagent);">✓ Unlocked</span>' : i.isNext ? `<b>Next</b>${i.late ? ` <span style="color:var(--danger);">· ${i.weeks || '<1'} wk late</span>` : ''}` : i.late ? `<span style="color:var(--danger);">${i.weeks || '<1'} wk late</span>` : '<span style="color:var(--muted);">later</span>'}</td></tr>`;
    const table = list => `<table style="width:100%;font-size:13px;border-collapse:collapse;text-align:left;">${head}<tbody>${list.map(rowHtml).join('')}</tbody></table>`;
    // what is unlocked sits in a tab that is closed by default; the perks still to come stay in view
    $('fr-table').innerHTML = `<details style="margin-bottom:14px;"><summary style="cursor:pointer;font-weight:700;padding:4px 0;">Unlocked perks (${unlocked.length})</summary>${table(unlocked)}</details>`
        + (items.length ? table(items) : '<p style="color:var(--muted);">The next perks will be planned soon.</p>');
}
const fpDateLabel = d => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
