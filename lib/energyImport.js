// lib/energyImport.js — fills in the PAST energy trained per member from Torn Intel's leaderboard, which has
// been saving the faction's gym counters every day for much longer than we have. A leader opens the members
// in Intel's "energy" table (each member expands into one row per day), copies the table and pastes it into
// Member Overview. Each pasted member block looks like:
//
//   1JoeKerr   Hide   1.1k   30.3k   50.2k   —   15.5k   96.1k+37.0%      <- the member: avg/day, STR, SPD, DEF, DEX, total
//   09-19             —      —       —       —   1.4k    1.4k             <- one day: ..., STR, SPD, DEF, DEX, total
//
// Days are stored per member (wwl:energy-daily:<faction>); lib/steadfast.js uses them for every day before
// our own daily snapshots begin. Intel rounds to about 0.1k, so imported numbers are close, not exact.

const { importKey } = require('./steadfast');

function num(s) {
    const t = String(s).trim().replace(/,/g, '');
    if (!t || /^[—–-]+$/.test(t)) return 0;
    const m = /^(\d+(?:\.\d+)?)\s*([km])?/i.exec(t);
    if (!m) return NaN;
    return Math.round(Number(m[1]) * ({ k: 1e3, m: 1e6 }[(m[2] || '').toLowerCase()] || 1));
}
const cellsOf = line => (line.includes('\t') ? line.split('\t') : line.split(/\s{2,}/)).map(c => c.trim());

// Which of Intel's rows are members and which are days, and the four stat numbers of each (in our order: STR, DEF, SPD, DEX).
function parseIntel(text, now = new Date()) {
    const members = [];
    let cur = null;
    for (const raw of String(text).split(/\r?\n/)) {
        if (!raw.trim()) continue;
        const cells = cellsOf(raw);
        if (cells.length < 7) continue;
        const tail = cells.slice(-6); // avg, STR, SPD, DEF, DEX, total
        const first = cells[0];
        const dm = /^(\d{2})-(\d{2})$/.exec(first);
        if (dm) { // one day of the current member
            if (!cur) continue;
            const stats = tail.slice(1, 5).map(num);
            if (stats.some(n => Number.isNaN(n))) continue;
            let year = now.getUTCFullYear();
            if (Date.UTC(year, Number(dm[1]) - 1, Number(dm[2])) > now.getTime() + 86400e3) year -= 1; // a date "in the future" is last year's
            cur.days[`${year}-${dm[1]}-${dm[2]}`] = [stats[0], stats[3], stats[1], stats[2]]; // STR, SPD, DEF, DEX -> STR, DEF, SPD, DEX
        } else if (/^today$/i.test(first)) {
            continue; // today is not finished yet
        } else if (/^(hide|show)$/i.test(cells[1] || '') || (cells.length >= 8 && !/^\d/.test(cells[1] || ''))) { // a member row
            cur = { raw: first, days: {} };
            members.push(cur);
        }
    }
    return members;
}

// "1JoeKerr" -> the roster member "JoeKerr" (the rank is glued to the name; try 1-3 digits of rank).
function matchMember(raw, roster) {
    const byName = new Map(roster.map(m => [String(m.name).toLowerCase(), m]));
    for (let k = 1; k <= 3; k++) {
        if (!new RegExp(`^\\d{${k}}`).test(raw)) break;
        const hit = byName.get(raw.slice(k).toLowerCase());
        if (hit) return hit;
    }
    return byName.get(raw.toLowerCase()) || null;
}

// Stores the pasted days per member (merged with what was imported before; the same day is overwritten).
async function importIntelText(redis, factionId, roster, text) {
    const parsed = parseIntel(text);
    const unmatched = [];
    let matched = 0, days = 0;
    for (const m of parsed) {
        const found = matchMember(m.raw, roster);
        if (!found) { unmatched.push(m.raw); continue; }
        if (!Object.keys(m.days).length) continue; // a collapsed row with no daily lines — nothing to store
        const oldRaw = await redis(['HGET', importKey(factionId), found.id]);
        const merged = { ...(oldRaw ? JSON.parse(oldRaw) : {}), ...m.days };
        await redis(['HSET', importKey(factionId), found.id, JSON.stringify(merged)]);
        matched++; days += Object.keys(m.days).length;
    }
    return { found: parsed.length, matched, days, unmatched };
}

module.exports = { parseIntel, matchMember, importIntelText, num };
