// lib/steadfast.js — the Steadfast countdown: how far the faction is with the "spend N energy on <stat>
// training" challenge that has to be completed before the next Steadfast level can be bought, per stat, with
// the levels the faction has now. Everything comes from Torn by itself:
//   - the faction's totals per stat ("gymspeed" ...) = the challenge counters (v2 /faction/stats),
//   - the levels/percentages of the upgrades (v2 /faction/upgrades),
//   - who contributed how much per stat (v2 /faction/contributors) — kept as daily snapshots, which also
//     gives the energy each member trains per week (used for Member Overview and "Your standing").
// A leader's key is needed to read it, so the numbers are stored (wwl:steadfast:<faction>) whenever a leader
// opens WWL, and everyone else — and the announcement picture — reads the stored copy.
//
// The challenge goal for the NEXT level is known so far only for level IX (3,000,000 energy); other goals
// can be filled in per stat by a leader (they are shown in the game on the upgrade's panel).

const { Canvas } = require('./pngCard');

const STATS = ['strength', 'defense', 'speed', 'dexterity'];
const KNOWN_GOALS = { 9: 3000000 }; // next level -> challenge energy
const DEFAULT_GOAL = 3000000; // the challenge is 3,000,000 energy for every stat (confirmed by the owner), unless a leader sets another
const snapKey = f => `wwl:steadfast:${f}`;
const histKey = f => `wwl:steadfast-hist:${f}`; // hash: day number -> { strength, ... } totals
const contribKey = f => `wwl:gym-contrib:${f}`; // hash: day number -> { playerId: [str, def, spd, dex] }
const goalsKey = f => `wwl:steadfast-goals:${f}`; // { strength: n, ... } leader-set goals for the next level
const importKey = f => `wwl:energy-daily:${f}`; // hash: memberId -> { 'YYYY-MM-DD': [str, def, spd, dex] } imported from Torn Intel (lib/energyImport.js)
const tokenKey = t => `wwl:steadfast-token:${t}`;
const tokenOfKey = f => `wwl:steadfast-token-of:${f}`;
const DAY = 86400;

async function tornV2(path, key) {
    const r = await fetch(`https://api.torn.com/v2${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } });
    const d = await r.json();
    if (d.error) throw new Error(d.error.error);
    return d;
}

// Reads Torn and stores the newest numbers. Skipped (returns the stored copy) if it was done in the last 20 minutes.
async function steadfastRefresh({ redis, key, factionId, force }) {
    const now = Math.floor(Date.now() / 1000);
    const old = await redis(['GET', snapKey(factionId)]);
    if (old && !force && now - JSON.parse(old).at < 1200 && JSON.parse(old).allLevels) return JSON.parse(old);

    const [stats, upgrades] = await Promise.all([tornV2('/faction/stats', key), tornV2('/faction/upgrades', key)]);
    const list = Array.isArray(stats.stats) ? stats.stats : Object.entries(stats.stats || {}).map(([name, value]) => ({ name, value }));
    const totals = {};
    for (const s of STATS) totals[s] = Number(list.find(x => x.name === `gym${s}`)?.value) || 0;

    // levels: "Speed training VIII" / "Increases speed gym gains by 8%" in the Steadfast branch
    const levels = {};
    const branches = [...(upgrades.upgrades?.peace || []), ...(upgrades.upgrades?.war || [])];
    for (const b of branches.filter(x => x.name === 'Steadfast')) {
        for (const u of b.upgrades || []) {
            const stat = STATS.find(s => String(u.name).toLowerCase().startsWith(s));
            const pct = Number(/(\d+(?:\.\d+)?)\s*%/.exec(u.ability || '')?.[1]);
            if (stat) levels[stat] = { level: u.level, pct: Number.isFinite(pct) ? pct : u.level, name: u.name };
        }
    }
    // every other perk level the faction has (peace branches): "Candy effect VII" -> { 'candy effect': 7 } — for the roadmap
    const allLevels = {};
    for (const b of (upgrades.upgrades?.peace || []).filter(x => x.name !== 'Steadfast')) {
        for (const u of b.upgrades || []) {
            const prefix = String(u.name).replace(/\s+[IVXLC]+$/i, '').trim().toLowerCase();
            allLevels[prefix] = Math.max(allLevels[prefix] || 0, Number(u.level) || 0);
        }
    }
    // the faction's respect (best effort)
    let respect = null;
    try { const d = await (await fetch(`https://api.torn.com/faction/?selections=basic&key=${encodeURIComponent(key)}`)).json(); respect = d.error ? null : (d.respect ?? d.faction?.respect ?? null); } catch (e) { /* not critical */ }
    const snap = { at: now, totals, levels, allLevels, respect };
    await redis(['SET', snapKey(factionId), JSON.stringify(snap)]);
    const day = String(Math.floor(now / DAY));
    await redis(['HSET', histKey(factionId), day, JSON.stringify(totals)]);

    // per-member contributions (once a day is enough) — the energy each member has trained
    try {
        const have = await redis(['HEXISTS', contribKey(factionId), day]);
        if (!have) {
            const per = {};
            for (let i = 0; i < STATS.length; i++) {
                const d = await tornV2(`/faction/contributors?stat=gym${STATS[i]}`, key);
                for (const c of d.contributors || []) if (c.in_faction) (per[c.id] || (per[c.id] = [0, 0, 0, 0]))[i] = Number(c.value) || 0;
            }
            await redis(['HSET', contribKey(factionId), day, JSON.stringify(per)]);
        }
    } catch (e) { /* the countdown itself does not depend on it */ }
    return snap;
}

// The countdown per stat, from the stored copy. pace = energy per day over the last ~7 days of snapshots.
async function buildCountdown(redis, factionId) {
    const raw = await redis(['GET', snapKey(factionId)]);
    if (!raw) return null;
    const snap = JSON.parse(raw);
    const rawGoals = await redis(['GET', goalsKey(factionId)]);
    const goals = rawGoals ? JSON.parse(rawGoals) : {};
    const today = Math.floor(snap.at / DAY);
    const hist = (await redis(['HMGET', histKey(factionId), ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => String(today - n))])) || [];
    const older = hist.map(h => (h ? JSON.parse(h) : null)).map((h, i) => (h ? { days: i + 1, h } : null)).filter(Boolean).pop(); // the oldest one within 10 days
    const rows = STATS.map(stat => {
        const lv = snap.levels[stat] || { level: 0, pct: 0 };
        const next = lv.level + 1;
        const goal = Number(goals[stat]) > 0 ? Number(goals[stat]) : (KNOWN_GOALS[next] || DEFAULT_GOAL);
        const total = snap.totals[stat];
        const pace = older ? Math.max(0, (total - (older.h[stat] || 0)) / older.days) : null;
        const remaining = goal ? Math.max(0, goal - total) : null;
        return { stat, level: lv.level, pct: lv.pct, nextLevel: next, total, goal, remaining, done: goal ? total >= goal : null,
            etaDays: remaining && pace ? Math.ceil(remaining / pace) : (remaining === 0 ? 0 : null), pace };
    });
    const withGoal = rows.filter(r => r.goal);
    const waiting = withGoal.filter(r => !r.done).map(r => r.stat);
    return { at: snap.at, rows, waiting, allDone: withGoal.length > 0 && waiting.length === 0, allLevels: snap.allLevels || {}, respect: snap.respect ?? null };
}

// Energy each member spent in the gym between two moments, from the daily snapshots of the contributors
// (the counters only ever go up, so the difference between two days is what was trained in between).
// The start uses the newest snapshot on or before `from`; if the snapshots only begin after that, the
// earliest one is used and the answer is marked `partial` (it then counts from `sinceDay` on).
async function energyBetween(redis, factionId, from, to) {
    const flat = (await redis(['HGETALL', contribKey(factionId)])) || [];
    const snaps = [];
    for (let i = 0; i < flat.length; i += 2) { try { snaps.push({ day: Number(flat[i]), per: JSON.parse(flat[i + 1]) }); } catch (e) { /* skip */ } }
    snaps.sort((a, b) => a.day - b.day);
    const startDay = Math.floor(from / DAY), endDay = Math.floor(to / DAY);
    const end = [...snaps].reverse().find(s => s.day <= endDay);
    const start = [...snaps].reverse().find(s => s.day <= startDay) || snaps[0];

    // the part our own snapshots cover
    const perMember = {};
    let snapFrom = null;
    if (end && start && end.day > start.day) {
        snapFrom = start.day;
        for (const [id, arr] of Object.entries(end.per)) {
            const before = start.per[id] || [0, 0, 0, 0];
            const per = arr.map((v, i) => Math.max(0, v - (before[i] || 0)));
            perMember[id] = { stats: per, total: per.reduce((s, v) => s + v, 0) };
        }
    }

    // the days before that (or all of them, if there are no snapshots yet) come from what was imported from Intel
    const impFlat = (await redis(['HGETALL', importKey(factionId)])) || [];
    let importedAny = false, importedFromDay = null;
    const impTo = snapFrom !== null ? Math.min(snapFrom, endDay) : endDay; // the first snapshot's own day holds Today's partial row from the import (stored only when it was anchored)
    for (let i = 0; i < impFlat.length; i += 2) {
        let days; try { days = JSON.parse(impFlat[i + 1]); } catch (e) { continue; }
        importedAny = true;
        const stats = [0, 0, 0, 0];
        for (const [date, arr] of Object.entries(days)) {
            const d = Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000 / DAY);
            if (importedFromDay === null || d < importedFromDay) importedFromDay = d;
            if (d >= startDay && d <= impTo) arr.forEach((v, k) => { stats[k] += v || 0; });
        }
        const total = stats.reduce((s, v) => s + v, 0);
        if (total > 0) {
            const cur = perMember[impFlat[i]] || { stats: [0, 0, 0, 0], total: 0 };
            perMember[impFlat[i]] = { stats: cur.stats.map((v, k) => v + stats[k]), total: cur.total + total };
        }
    }
    const firstCovered = importedFromDay !== null && (snapFrom === null || importedFromDay <= startDay + 1) ? Math.min(importedFromDay, snapFrom ?? Infinity) : snapFrom;
    return {
        perMember, snapshots: snaps.length + (importedAny ? 1 : 0),
        sinceDay: firstCovered ?? (start ? start.day : null),
        partial: firstCovered === null || firstCovered === undefined ? true : firstCovered > startDay + 1,
    };
}

// ---- today's partial day, for the import from Torn Intel -------------------------------------------------------
// Intel's "Today" row is the energy trained from midnight until the moment it was copied. To add it without ever
// counting anything twice, that member's counters are noted at that same moment as the start of OUR counting (a
// snapshot for today, taken now): Intel's row covers before it, our nightly difference covers after it.
async function contribNow(key) {
    const per = {};
    for (let i = 0; i < STATS.length; i++) {
        const d = await tornV2(`/faction/contributors?stat=gym${STATS[i]}`, key);
        for (const c of d.contributors || []) if (c.in_faction) (per[c.id] || (per[c.id] = [0, 0, 0, 0]))[i] = Number(c.value) || 0;
    }
    return per;
}
async function firstSnapshotDay(redis, factionId) {
    const days = ((await redis(['HKEYS', contribKey(factionId)])) || []).map(Number).filter(Number.isFinite);
    return days.length ? Math.min(...days) : null;
}
// Notes the counters of `ids` as of now IF today's snapshot is (or becomes) the very first one. Returns whether it did —
// only then may Intel's "Today" row be used; otherwise our own snapshots already cover today.
async function rebaseToday(redis, key, factionId, ids) {
    const day = String(Math.floor(Date.now() / 1000 / DAY));
    const first = await firstSnapshotDay(redis, factionId);
    if (first !== null && first < Number(day)) return { anchored: false, first };
    const per = await contribNow(key);
    const existing = await redis(['HGET', contribKey(factionId), day]);
    if (!existing) { await redis(['HSET', contribKey(factionId), day, JSON.stringify(per)]); return { anchored: true, first: Number(day) }; }
    const cur = JSON.parse(existing);
    for (const id of ids) cur[id] = per[id] || [0, 0, 0, 0];
    await redis(['HSET', contribKey(factionId), day, JSON.stringify(cur)]);
    return { anchored: true, first: Number(day) };
}

async function shareToken(redis, factionId) {
    let t = await redis(['GET', tokenOfKey(factionId)]);
    if (!t) {
        t = require('crypto').randomBytes(9).toString('hex');
        await redis(['SET', tokenKey(t), String(factionId)]);
        await redis(['SET', tokenOfKey(factionId), t]);
    }
    return t;
}

// The picture for the announcement: one bar per stat with the numbers, and the "upgrade when all are done" line.
function renderPng(cd, factionLabel) {
    const W = 640, H = 330;
    const c = new Canvas(W, H, [18, 22, 28]);
    const TEXT = [225, 230, 236], MUTED = [130, 140, 152], GREEN = [53, 217, 155], AMBER = [176, 140, 72], TRACK = [38, 46, 56];
    const NAME = { strength: 'STRENGTH', defense: 'DEFENSE', speed: 'SPEED', dexterity: 'DEXTERITY' };
    c.rect(0, 0, W, 4, GREEN);
    c.text(16, 16, 'TO UPGRADE TO 9%', 3, GREEN);
    if (factionLabel) c.text(W - 16 - c.textWidth(factionLabel.toUpperCase(), 2), 20, factionLabel, 2, MUTED);
    let y = 56;
    for (const r of cd.rows) {
        c.text(16, y, NAME[r.stat], 2, TEXT);
        const num = r.goal ? `${r.total.toLocaleString('en-US')} / ${r.goal.toLocaleString('en-US')}` : `${r.total.toLocaleString('en-US')} ENERGY`;
        c.text(W - 16 - c.textWidth(num, 2), y, num, 2, r.done ? GREEN : TEXT);
        const barY = y + 20, barW = W - 32;
        c.rect(16, barY, barW, 9, TRACK);
        const frac = r.goal ? Math.min(1, r.total / r.goal) : 0;
        if (frac > 0) c.rect(16, barY, Math.max(2, Math.round(barW * frac)), 9, r.done ? GREEN : AMBER);
        const sub = r.goal
            ? (r.done ? 'DONE' : `${r.remaining.toLocaleString('en-US')} ENERGY TO GO${r.etaDays ? ` - ABOUT ${r.etaDays} DAYS` : ''}`)
            : 'GOAL NOT SET';
        c.text(16, barY + 15, sub, 1, MUTED);
        y += 58;
    }
    const footer = cd.allDone ? 'ALL DONE - TIME TO UPGRADE!' : cd.waiting.length ? `UPGRADE WHEN ALL ARE DONE. WAITING FOR: ${cd.waiting.map(s => NAME[s]).join(', ')}` : '';
    if (footer) c.text(16, H - 34, footer, 1, cd.allDone ? GREEN : AMBER);
    c.text(16, H - 18, `UPDATED ${new Date(cd.at * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`, 1, MUTED);
    return c.png();
}

async function steadfastHandle(action, body, { redis, key, factionId, leader }) {
    if (action === 'steadfast-get') return { countdown: await buildCountdown(redis, factionId) };
    if (!leader) throw new Error('Leaders only');
    if (action === 'steadfast-refresh') { await steadfastRefresh({ redis, key, factionId, force: !!body.force }); return { countdown: await buildCountdown(redis, factionId) }; }
    if (action === 'steadfast-share') return { token: await shareToken(redis, factionId) };
    if (action === 'steadfast-goals-save') {
        const rawOld = await redis(['GET', goalsKey(factionId)]);
        const goals = rawOld ? JSON.parse(rawOld) : {}; // goals set before stay unless a new number is typed
        for (const s of STATS) { const n = Math.round(Number(body.goals?.[s])); if (n > 0) goals[s] = n; }
        await redis(['SET', goalsKey(factionId), JSON.stringify(goals)]);
        return { ok: true, countdown: await buildCountdown(redis, factionId) };
    }
    throw new Error('Unknown action');
}

// The announcement picture: GET /api/war-payout?steadfast=<token>
async function steadfastImage(redis, token) {
    if (!/^[0-9a-f]{18}$/.test(String(token))) return null;
    const factionId = await redis(['GET', tokenKey(token)]);
    if (!factionId) return null;
    const cd = await buildCountdown(redis, factionId);
    return cd ? renderPng(cd, '') : null;
}

module.exports = { steadfastHandle, steadfastRefresh, steadfastImage, contribKey, energyBetween, importKey, rebaseToday, firstSnapshotDay };
