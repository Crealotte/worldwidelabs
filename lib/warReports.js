// lib/warReports.js — the War reports page: every saved war payout report of the caller's faction, with
// the opponent, whether it was a win or a loss, the score, and the pay details. Open to every member;
// a leader sees everyone's pay, a normal member only their own line (the report links themselves are
// already shareable inside the faction).
//
// Old receipts saved before the result was stored don't know if the war was won. When a leader opens
// the page, those are filled in from Torn's ranked war list (matched on the enemy faction and the war's
// end time) and written back, so it happens once.

const { tornFetch } = require('./tornFetch');
const DAY = 86400;

async function loadWars(key) {
    const r = await tornFetch(`https://api.torn.com/v2/faction?selections=rankedwars&key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } });
    const d = await r.json();
    return d.error ? [] : Object.values(d.rankedwars || {}).filter(w => w.end);
}

async function warReports({ redis, key, factionId, playerId, leader }) {
    const rawIndex = await redis(['GET', `wwl:receipts-index:${factionId}`]);
    const ids = (rawIndex ? JSON.parse(rawIndex) : []).map(e => e.id).slice(0, 80);
    if (!ids.length) return { reports: [], leader };
    const raws = await redis(['MGET', ...ids.map(id => `wwl:payout-receipt:${id}`)]);

    let wars = null;
    const reports = [];
    for (let i = 0; i < ids.length; i++) {
        if (!raws[i]) continue;
        const rc = JSON.parse(raws[i]);
        if ((rc.won === undefined || rc.won === null) && leader && rc.enemyFactionId) {
            if (wars === null) wars = await loadWars(key);
            const w = wars.find(x => (x.factions || []).some(f => String(f.id) === String(rc.enemyFactionId)) && Math.abs(x.end - rc.warEnd) < DAY);
            if (w) {
                const us = (w.factions || []).find(f => String(f.id) === factionId);
                const them = (w.factions || []).find(f => String(f.id) !== factionId);
                rc.won = w.winner != null ? String(w.winner) === factionId : null;
                rc.scoreUs = us?.score ?? null; rc.scoreThem = them?.score ?? null;
                await redis(['SET', `wwl:payout-receipt:${ids[i]}`, JSON.stringify(rc)]);
            }
        }
        const rows = Array.isArray(rc.rows) ? rc.rows : [];
        reports.push({
            id: ids[i], opponent: rc.opponent || 'Unknown', warEnd: rc.warEnd || rc.createdAt / 1000 || 0,
            won: rc.won ?? null, scoreUs: rc.scoreUs ?? null, scoreThem: rc.scoreThem ?? null,
            rows: (leader ? rows : rows.filter(r => String(r.id) === playerId)).map(r => ({ id: r.id, name: r.name, warHits: r.warHits, overflowHits: r.overflowHits, gross: r.gross, penalty: r.penalty, net: r.net })),
            totalPaid: leader ? rows.reduce((s, r) => s + (Number(r.net) || 0), 0) : null,
        });
    }
    reports.sort((a, b) => b.warEnd - a.warEnd);
    return { reports, leader };
}

module.exports = { warReports };
