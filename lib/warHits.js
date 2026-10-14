// lib/warHits.js — pulls the authoritative count of real ranked-war hits per attacker straight
// from Torn's own attack log, independent of chains entirely.
//
// This exists because chain reports (used elsewhere for chain-only/overflow hits — see
// api/war-payout.js) can only ever describe hits that happened inside a specific chain. A member
// can land real war hits with no chain running at all (a solo hit before the chain builds up,
// retaliating individually, hitting in the gap when one chain breaks and another hasn't started
// yet) — those hits never belong to any chain ID, so no chain report, of any chain, will ever
// list them. Pulling directly from /v2/faction/attacks and checking each attack's own ranked-war
// flag is the only way to catch those too.
//
// Lives in its own file (outside /api, so Vercel doesn't treat it as a route) because it's a
// separate concern from the payout math and the chain-report handling in api/war-payout.js — a
// human reading this codebase should be able to find "how do we know a hit was a war hit" in one
// place without wading through the rest of the calculator.

const { tornFetch } = require('./tornFetch');
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function isRateLimited(data) {
    return data?.error?.code === 5 || /too many requests/i.test(data?.error?.error || '');
}

// Walks /v2/faction/attacks forward from the war's start to its end using a timestamp cursor
// (same paging style api/respect.js already uses for attacksfull, just forward instead of
// backward) and tallies, per attacker, how many of THEIR OWN outgoing attacks in that window
// Torn itself flagged as counting toward the ranked war. Bounded to the war's own window, so even
// a long war stays a handful of pages — capped generously as a safety net, not because it's
// expected to be hit.
// Only a SUCCESSFUL attack is a hit: Torn flags every attack of the war as a war attack, also the ones that were lost, ended in a stalemate, were escaped from, timed out, were interrupted or only assisted.
// Those are tallied apart (`failed`) and never counted for the war rule or a payout. (Torn's attack results: Attacked, Mugged, Hospitalized, Arrested, Special and the like are successes.)
const NOT_A_HIT = /lost|stalemate|escape|timeout|interrupt|assist|none/i;
// the three kinds of war attack: a win (a hit, counted by default), an assist (counted apart: a faction can choose to pay for those) and a failed attempt (lost, stalemate, escape, timeout, interrupted)
const attackKind = att => { const r = String(att.result ?? ''); return /assist/i.test(r) ? 'assist' : NOT_A_HIT.test(r) ? 'failed' : 'win'; };
const isSuccessfulAttack = att => attackKind(att) === 'win';

async function fetchWarHits(key, factionId, warStart, warEnd) {
    const perAttacker = {}; // attackerId -> { count, name }
    let from = warStart;
    let page = 0, scanned = 0, ownAttacks = 0, failed = 0, assists = 0, rateLimited = false;
    const MAX_PAGES = 30;
    while (from <= warEnd && page < MAX_PAGES) {
        if (page > 0) await sleep(1100); // stay well clear of Torn's rate limit across a multi-page war
        const r = await tornFetch(`https://api.torn.com/v2/faction/attacks?from=${from}&to=${warEnd}&sort=ASC&key=${encodeURIComponent(key)}`,
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
            const attackerFaction = String(att.attacker?.faction?.id ?? att.attacker_faction ?? '');
            if (attackerFaction !== factionId) continue; // not one of our own outgoing attacks
            const isWarHit = att.is_ranked_war ?? att.ranked_war ?? false;
            if (!isWarHit) continue;
            ownAttacks++;
            const id = String(att.attacker?.id ?? att.attacker_id ?? '');
            if (!id) continue;
            // Carry the name straight off the attack record rather than relying solely on a
            // separate faction/members lookup by ID — a mismatch between how the two endpoints
            // identify a member would otherwise mislabel real, current members as ex-members.
            const name = att.attacker?.name ?? att.attacker_name ?? null;
            if (!perAttacker[id]) perAttacker[id] = { count: 0, assists: 0, failed: 0, name };
            const kind = attackKind(att);
            if (kind === 'win') perAttacker[id].count++; else if (kind === 'assist') { perAttacker[id].assists++; assists++; } else { perAttacker[id].failed++; failed++; }
            if (name && !perAttacker[id].name) perAttacker[id].name = name;
        }
        if (newestTs <= from) break; // no progress — avoid looping forever on a stuck cursor
        from = newestTs + 1;
    }
    return { perAttacker, scanned, ownAttacks, failed, assists, rateLimited, pagesFetched: page };
}

module.exports = { fetchWarHits, sleep, isRateLimited, isSuccessfulAttack };

// Hits that went into a chain that is still running (a chain report only exists once the chain has ended): our own outgoing
// attacks between `from` and `to` that Torn counted towards a chain (they carry a chain number). Reads at most `maxPages` pages
// and says where to carry on (`next`, or null when everything up to `to` has been read), so the caller can ask again.
async function fetchLiveChainHits(key, factionId, from, to, maxPages = 12) {
    const perAttacker = {};
    let cursor = from, page = 0;
    while (cursor <= to && page < maxPages) {
        if (page > 0) await sleep(1100);
        const r = await tornFetch(`https://api.torn.com/v2/faction/attacks?from=${cursor}&to=${to}&sort=ASC&key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } });
        const data = await r.json();
        if (data.error) throw new Error(isRateLimited(data) ? 'Torn is busy — try again in a minute.' : `Attacks: ${data.error.error}`);
        const list = Array.isArray(data.attacks) ? data.attacks : Object.values(data.attacks || {});
        if (!list.length) return { perAttacker, next: null };
        page++;
        let newest = cursor;
        for (const att of list) {
            const ts = att.ended ?? att.timestamp_ended ?? att.started ?? att.timestamp_started ?? cursor;
            if (ts > newest) newest = ts;
            if (String(att.attacker?.faction?.id ?? att.attacker_faction ?? '') !== factionId) continue;
            if (!(Number(att.chain) > 0)) continue; // not a chain hit
            const id = String(att.attacker?.id ?? att.attacker_id ?? '');
            if (id) perAttacker[id] = (perAttacker[id] || 0) + 1;
        }
        if (newest <= cursor) return { perAttacker, next: null };
        cursor = newest + 1;
    }
    return { perAttacker, next: cursor <= to ? cursor : null };
}
module.exports.fetchLiveChainHits = fetchLiveChainHits;
