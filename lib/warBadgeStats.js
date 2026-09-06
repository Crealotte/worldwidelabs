// lib/warBadgeStats.js — per-member stats behind the War Badges feature (api/war-badges.js).
//
// Every badge except The Reagent (highest payout, which reuses the War Payout Calculator's own
// numbers) is derived from ONE pass over /v2/faction/attacks for the war's start/end window —
// the same raw attack log api/war-payout.js's war-hit fetch already reads, just tallied along
// more dimensions here. Kept in its own file, separate from lib/warHits.js, because it's a
// distinct feature (badges, not payout math) even though both talk to the same Torn endpoint —
// a human should be able to find "how are badges computed" without wading through payout code.
//
// What each field means, and where it comes from:
//   warHits      — outgoing attacks Torn flagged as counting toward the ranked war (is_ranked_war).
//   warRespect   — respect gained specifically from those same war-flagged outgoing attacks.
//   abroadHits   — outgoing attacks landed while travelling (Torn's own "overseas" modifier is
//                  attached to an attack when the fight happens in a foreign country), any target.
//   assists      — outgoing attacks Torn's own result field records as an assist.
//   hospitalized — outgoing attacks on the ENEMY faction specifically that ended in "Hospitalized".
//   hitsTaken    — incoming attacks against this member (any attacker), used for The Buffer.
//   survivedHits — incoming attacks against this member that did NOT end in them being
//                  hospitalized — i.e. they kept taking hits and stayed standing.
//   timesDowned  — incoming attacks against this member that DID end in "Hospitalized" — the
//                  "losses" half of The Volatile Compound (Glass Cannon).
//
// Field-name risk: is_ranked_war/ranked_war, the "overseas" modifier, and the "Assist" result
// string are all based on how other Torn tool developers describe the API, not a verified live
// response (no API key available here to test against). api/war-badges.js surfaces scanned vs.
// matched counts per category so a leader can tell if a category came back suspiciously empty,
// same safety net as the war payout fix.

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function isRateLimited(data) {
    return data?.error?.code === 5 || /too many requests/i.test(data?.error?.error || '');
}

function blankStats() {
    return { name: null, warHits: 0, warRespect: 0, abroadHits: 0, assists: 0, hospitalized: 0, hitsTaken: 0, survivedHits: 0, timesDowned: 0 };
}

async function fetchWarBadgeStats(key, factionId, enemyFactionId, warStart, warEnd) {
    const perAttacker = {}; // attackerId -> stats (see blankStats)
    let from = warStart;
    let page = 0, scanned = 0, ownOutgoing = 0, rateLimited = false;
    const MAX_PAGES = 30;
    while (from <= warEnd && page < MAX_PAGES) {
        if (page > 0) await sleep(1100); // stay well clear of Torn's rate limit across a multi-page war
        const r = await fetch(`https://api.torn.com/v2/faction/attacks?from=${from}&to=${warEnd}&sort=ASC&key=${encodeURIComponent(key)}`,
            { headers: { accept: 'application/json' } });
        const data = await r.json();
        if (data.error) {
            if (isRateLimited(data)) { rateLimited = true; break; }
            throw new Error(`War attacks: ${data.error.error}`);
        }
        const list = Array.isArray(data.attacks) ? data.attacks : Object.values(data.attacks || {});
        if (!list.length) break;
        page++;

        let newestTs = from;
        for (const att of list) {
            const ts = att.ended ?? att.timestamp_ended ?? att.started ?? att.timestamp_started ?? from;
            if (ts > newestTs) newestTs = ts;
            scanned++;

            const attackerId = String(att.attacker?.id ?? att.attacker_id ?? '');
            const defenderId = String(att.defender?.id ?? att.defender_id ?? '');
            // Torn's attack log carries each side's name directly on the record — used as the
            // primary name source (see api/war-badges.js) instead of cross-referencing the
            // separate faction/members list by ID, since a mismatch between how this endpoint
            // and that one identify a member would otherwise show real, current members as
            // "Ex-member #ID" even though they never left.
            const attackerName = att.attacker?.name ?? att.attacker_name ?? null;
            const defenderName = att.defender?.name ?? att.defender_name ?? null;
            const attackerFaction = String(att.attacker?.faction?.id ?? att.attacker_faction ?? '');
            const defenderFaction = String(att.defender?.faction?.id ?? att.defender_faction ?? '');
            const result = String(att.result ?? '').toLowerCase();
            const isWarHit = att.is_ranked_war ?? att.ranked_war ?? false;
            const wentAbroad = (att.modifiers?.overseas ?? 1) > 1 || att.modifiers?.overseas === true;
            const respect = Number(att.respect_gain ?? att.respect ?? 0);

            if (attackerFaction === factionId && attackerId) {
                ownOutgoing++;
                const s = perAttacker[attackerId] || (perAttacker[attackerId] = blankStats());
                if (attackerName && !s.name) s.name = attackerName;
                if (isWarHit) { s.warHits++; s.warRespect += respect; }
                if (wentAbroad) s.abroadHits++;
                if (result.includes('assist')) s.assists++;
                if (result.includes('hospital') && defenderFaction === enemyFactionId) s.hospitalized++;
            }
            if (defenderFaction === factionId && defenderId) {
                const s = perAttacker[defenderId] || (perAttacker[defenderId] = blankStats());
                if (defenderName && !s.name) s.name = defenderName;
                s.hitsTaken++;
                if (result.includes('hospital')) s.timesDowned++;
                else s.survivedHits++;
            }
        }
        if (newestTs <= from) break; // no progress — avoid looping forever on a stuck cursor
        from = newestTs + 1;
    }
    return { perAttacker, scanned, ownOutgoing, rateLimited, pagesFetched: page };
}

module.exports = { fetchWarBadgeStats };
