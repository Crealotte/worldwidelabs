// effort-calculator.js — the "Effort Calculator" page (Leadership → Leaders): how much chain effort
// is actually needed to hit a weekly respect target once OC (and, if warring, the war bonus) are
// accounted for. Built for a termed loss — the point of taking one on purpose is usually to give
// members room to also train, but that can't come out of the respect the faction still needs, so
// this works out the real minimum to aim for instead of just "push the chain as far as it'll go".
// Real numbers (OC/week average, war bonus by win/loss, a real chain-respect curve, roster/donator
// mix) come from this faction's own history (api/respect.js's calc-data action); every field stays
// editable.
'use strict';

async function ecFetch(body) {
    const res = await fetch('/api/respect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}

const EC_KEY = 'wwl_effort_calc';
function ecState() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(EC_KEY) || '{}'); } catch (e) { /* defaults */ }
    return {
        goal: s.goal ?? '', scenario: s.scenario || 'loss',
        oc: s.oc ?? null, warBonus: s.warBonus ?? null, k: s.k ?? null, roster: s.roster ?? null,
        unavailPct: s.unavailPct ?? 10, baseHits: s.baseHits ?? null, xanaxHits: s.xanaxHits ?? 10,
    };
}
function ecSave(patch) { try { localStorage.setItem(EC_KEY, JSON.stringify({ ...ecState(), ...patch })); } catch (e) { /* not critical */ } }
const ecN = n => Math.round(n).toLocaleString();

// ---- Torn's real chain-bonus formula (same math as api/respect.js's calc-data, kept in sync — see
// there for the full explanation): respect per hit = K * chainScale(hit position), plus flat one-off
// milestone bonuses. chainScale climbs on a log curve past hit 10, which is why a longer chain earns
// more respect per hit on average, not a flat rate. ----
const CHAIN_MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
const ecNextMilestone = n => CHAIN_MILESTONES.find(m => m >= n) ?? null;
const ecChainScale = hit => (hit <= 10 ? 1 : 0.25 * Math.log10(hit) + 0.75);
function ecChainScaleSum(length) {
    const L = Math.max(0, Math.floor(length));
    if (!L) return 0;
    let sum = Math.min(L, 10);
    for (let h = 11; h <= L; h++) sum += ecChainScale(h);
    return sum;
}
function ecMilestoneBonusSum(length) {
    let sum = 0;
    CHAIN_MILESTONES.forEach((m, i) => { if (length >= m) sum += 10 * Math.pow(2, i); });
    return sum;
}
// The smallest chain length whose curve-plus-milestones respect reaches `need`, at calibration factor
// `k`. The curve only ever grows, so doubling outward then narrowing down finds it in a few steps.
function ecChainLengthForRespect(need, k) {
    if (!(need > 0) || !(k > 0)) return 0;
    const respectAt = L => k * ecChainScaleSum(L) + ecMilestoneBonusSum(L);
    let hi = 100;
    while (respectAt(hi) < need && hi < 500000) hi *= 2;
    let lo = Math.floor(hi / 2);
    while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (respectAt(mid) < need) lo = mid; else hi = mid; }
    return hi;
}

let ecData = null; // this faction's own real averages, fetched once per page visit — see api/respect.js's calc-data
async function loadEffortCalc() {
    const locked = !canEditLeaderOnly; // Leader/Co-leader only, same tier as Respect Tracker's Goals panel
    $('ec-locked').style.display = locked ? 'block' : 'none';
    $('ec-editor').style.display = locked ? 'none' : 'block';
    if (locked) return;
    $('ec-status').textContent = ecData ? '' : 'Loading your faction\'s own numbers…';
    if (!ecData) {
        const r = await ecFetch({ action: 'calc-data' });
        if (r.error) { $('ec-status').textContent = `Couldn't load your history: ${r.error} — every field below can still be filled in by hand.`; ecData = {}; }
        else { ecData = r; $('ec-status').textContent = ''; }
    }
    renderEffortCalc();
}

// The historical average war bonus for whichever scenario is picked — 0 for "no war".
function ecWarBonusAuto(scenario) {
    if (scenario === 'none') return { avg: 0, count: null };
    const w = ecData?.warBonus?.[scenario];
    return w ? { avg: w.avg, count: w.count } : { avg: null, count: null };
}

// The calibration factor to use for the picked scenario — real war-chain history if there's enough of
// it, else the real peacetime figure doubled (war hits are confirmed 2x, "inside" attacks on the
// enemy), clearly labelled as an estimate either way.
function ecKAuto(scenario) {
    const d = ecData || {};
    if (scenario === 'none') return d.kPeace != null ? { k: d.kPeace, label: `your own avg of ${d.peaceSample?.chains ?? '?'} peacetime chains, ${ecN(d.peaceSample?.hits || 0)} hits total` } : { k: null, label: 'no chain history yet — enter by hand' };
    if (d.kWar != null) return { k: d.kWar, label: `your own avg of ${d.warSample?.chains ?? '?'} real war chains, ${ecN(d.warSample?.hits || 0)} hits total` };
    if (d.kPeace != null) return { k: d.kPeace * 2, label: `estimated: your peacetime avg (${d.peaceSample?.chains ?? '?'} chains) x2, since war hits on the enemy are worth double — no real war-chain history yet to calibrate from directly` };
    return { k: null, label: 'no chain history yet — enter by hand' };
}

function renderEffortCalc() {
    const el = $('ec-body');
    if (!el) return;
    const s = ecState();
    const d = ecData || {};
    const warAuto = ecWarBonusAuto(s.scenario);
    const kAuto = ecKAuto(s.scenario);

    const oc = s.oc != null ? s.oc : (d.ocWeeklyAvg != null ? Math.round(d.ocWeeklyAvg) : 0);
    const warBonus = s.warBonus != null ? s.warBonus : (warAuto.avg != null ? Math.round(warAuto.avg) : 0);
    const k = s.k != null ? s.k : (kAuto.k != null ? Math.round(kAuto.k * 100) / 100 : 0);
    const roster = s.roster != null ? s.roster : (d.rosterCount ?? 0);
    const baseHits = s.baseHits != null ? s.baseHits : (d.hitsPerBarAuto != null ? Math.round(d.hitsPerBarAuto * 10) / 10 : 4);
    const goal = Number(s.goal) || 0;

    const fromChain = Math.max(0, goal - oc - warBonus);
    const targetHits = ecChainLengthForRespect(fromChain, k);
    const effectivePerHit = targetHits > 0 ? fromChain / targetHits : 0;
    const activeMembers = Math.max(0, Math.round(roster * (1 - (Number(s.unavailPct) || 0) / 100)));
    const hitsPerMember = activeMembers > 0 ? Math.ceil(targetHits / activeMembers) : 0;
    const xanaxHits = Math.max(1, Number(s.xanaxHits) || 1);
    const xanaxNeeded = Math.max(0, Math.ceil((hitsPerMember - Math.max(0, Number(baseHits) || 0)) / xanaxHits));

    // Rounding the target UP to Torn's next real chain milestone — usually only a little more effort
    // for a noticeably bigger bonus, so worth calling out rather than stopping the moment the bare
    // minimum is crossed.
    const milestone = targetHits > 0 ? ecNextMilestone(targetHits) : null;
    let milestoneLine = '';
    if (milestone && milestone !== targetHits && activeMembers > 0) {
        const hitsPerMemberAtM = Math.ceil(milestone / activeMembers);
        const xanaxAtM = Math.max(0, Math.ceil((hitsPerMemberAtM - Math.max(0, Number(baseHits) || 0)) / xanaxHits));
        milestoneLine = xanaxAtM <= xanaxNeeded
            ? `<div style="margin-top:6px;">The Xanax you already need comfortably covers a full <b style="color:var(--reagent);">${ecN(milestone)}</b>-hit milestone too — aim for ${ecN(milestone)} instead of ${ecN(targetHits)} for a bigger bonus at no extra cost.</div>`
            : `<div style="margin-top:6px;">One more Xanax each (<b>${xanaxAtM}</b> instead of ${xanaxNeeded}) reaches the next milestone at <b style="color:var(--reagent);">${ecN(milestone)}</b> hits instead of just ${ecN(targetHits)} — worth it for a noticeably bigger bonus.</div>`;
    }

    // The reverse check: "if everyone does N Xanax, what chain do we actually land on, and does that
    // hit a milestone?" — shown for a small spread of round Xanax counts around what's actually needed.
    const xanaxRows = [];
    const rowsFrom = Math.max(0, xanaxNeeded - 1), rowsTo = xanaxNeeded + 2;
    for (let x = rowsFrom; x <= rowsTo; x++) {
        const hitsEach = Math.max(0, Number(baseHits) || 0) + x * xanaxHits;
        const totalReached = hitsEach * activeMembers;
        const meetsGoal = totalReached >= targetHits;
        const atOrPastMilestone = milestone && totalReached >= milestone;
        xanaxRows.push({ x, hitsEach, totalReached, meetsGoal, atOrPastMilestone });
    }

    const ocNote = s.oc != null ? 'set by hand' : d.ocWeeklyAvg != null ? `your own avg over the last ${d.ocDays} day${d.ocDays === 1 ? '' : 's'}` : 'no OC history yet — enter by hand';
    const warNote = s.scenario === 'none' ? 'no war this week' : s.warBonus != null ? 'set by hand'
        : warAuto.avg != null ? `avg of your last ${warAuto.count} ${s.scenario}${warAuto.count === 1 ? '' : 'es'}` : `no ${s.scenario} history yet — enter by hand`;
    const kNote = s.k != null ? 'set by hand' : kAuto.label;
    const rosterNote = s.roster != null ? 'set by hand' : d.rosterCount != null ? 'your current roster size' : 'enter by hand';
    const baseHitsNote = s.baseHits != null ? 'set by hand' : d.hitsPerBarAuto != null ? 'weighted by your real donator/non-donator mix' : 'no donator data from this key — enter by hand (100E=4, 150E=6)';

    const warScoresHtml = (d.warScores || []).length ? `
        <div style="margin-top:18px;">
            <div style="font-size:12px;color:var(--muted);margin-bottom:6px;" title="Torn doesn't publish the exact formula for the target score (the lead needed to win) — this shows what your own recent wars actually scored instead of guessing one.">Recent war scores (for reference — no published formula to calculate a target from)</div>
            <table style="width:100%;font-size:13px;border-collapse:collapse;">
                <thead><tr style="color:var(--muted);text-align:left;"><th style="padding:4px 8px;">Ended</th><th style="padding:4px 8px;">Us</th><th style="padding:4px 8px;">Them</th><th style="padding:4px 8px;">Result</th></tr></thead>
                <tbody>${d.warScores.map(w => `<tr style="border-top:1px solid var(--line);">
                    <td style="padding:4px 8px;color:var(--muted);">${new Date(w.end * 1000).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    <td style="padding:4px 8px;font-family:var(--mono);">${ecN(w.scoreUs)}</td>
                    <td style="padding:4px 8px;font-family:var(--mono);">${ecN(w.scoreThem)}</td>
                    <td style="padding:4px 8px;">${w.won === true ? '<span style="color:var(--reagent);">Won</span>' : w.won === false ? '<span style="color:var(--danger);">Lost</span>' : '<span style="color:var(--muted);">?</span>'}</td>
                </tr>`).join('')}</tbody>
            </table>
        </div>` : '';

    el.innerHTML = `
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px;">
            <div class="field" style="margin:0;max-width:160px;"><label for="ec-goal">Weekly respect goal</label><input autocomplete="off" id="ec-goal" type="number" value="${esc(s.goal)}" placeholder="e.g. 12000"></div>
            <div class="field" style="margin:0;max-width:190px;"><label for="ec-scenario">This week we're</label>
                <select id="ec-scenario">
                    <option value="loss" ${s.scenario === 'loss' ? 'selected' : ''}>Term losing a war</option>
                    <option value="win" ${s.scenario === 'win' ? 'selected' : ''}>Term winning a war</option>
                    <option value="none" ${s.scenario === 'none' ? 'selected' : ''}>Not warring (chain only)</option>
                </select>
            </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:6px;">
            <div class="field" style="margin:0;max-width:150px;"><label for="ec-oc">OC respect / week</label><input autocomplete="off" id="ec-oc" type="number" value="${oc}"></div>
            <div class="field" style="margin:0;max-width:150px;"><label for="ec-warbonus">War bonus</label><input autocomplete="off" id="ec-warbonus" type="number" value="${warBonus}" ${s.scenario === 'none' ? 'disabled title="No war this week — pick a scenario above to use this."' : ''}></div>
            <div class="field" style="margin:0;max-width:170px;"><label for="ec-k" title="Your own average target-level x Fair Fight, backed out from real chains. Multiplied by Torn's real chain-bonus curve, not a flat respect/hit rate — a 1500-hit chain earns more per hit than a 1000-hit one, and this accounts for that.">Chain respect factor (K)</label><input autocomplete="off" id="ec-k" type="number" step="0.01" value="${k}"></div>
            <div class="field" style="margin:0;max-width:120px;"><label for="ec-roster">Roster size</label><input autocomplete="off" id="ec-roster" type="number" value="${roster}"></div>
            <div class="field" style="margin:0;max-width:140px;"><label for="ec-unavail">% OD / absent</label><input autocomplete="off" id="ec-unavail" type="number" value="${esc(s.unavailPct)}"></div>
        </div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:14px;line-height:1.6;">
            OC: ${esc(ocNote)} · War bonus: ${esc(warNote)} · K: ${esc(kNote)} · Roster: ${esc(rosterNote)}
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px;">
            <div class="field" style="margin:0;max-width:210px;"><label for="ec-basehits">Hits from one natural energy bar</label><input autocomplete="off" id="ec-basehits" type="number" step="0.1" value="${baseHits}"></div>
            <div class="field" style="margin:0;max-width:160px;"><label for="ec-xanhits">Extra hits per Xanax</label><input autocomplete="off" id="ec-xanhits" type="number" value="${esc(s.xanaxHits)}"></div>
        </div>
        <div style="font-size:11px;color:var(--muted);margin:-8px 0 14px;">Energy bar: ${esc(baseHitsNote)}</div>
        <div style="background:var(--bench-2);border-radius:var(--radius);padding:14px 16px;font-size:13px;line-height:2;">
            <div>Weekly goal: <b>${ecN(goal)}</b> respect</div>
            <div>− OC: <b>${ecN(oc)}</b> &nbsp;·&nbsp; − War bonus: <b>${ecN(warBonus)}</b></div>
            <div>= Needed from chain hits: <b style="color:var(--reagent);">${ecN(fromChain)}</b> respect</div>
            ${k > 0 ? `<div>Using Torn's real chain curve (K=${esc(k)}) → aim for a chain of about <b style="color:var(--reagent);">${ecN(targetHits)}</b> hits <span style="color:var(--muted);font-size:11px;">(≈${effectivePerHit.toFixed(1)} respect/hit at that length)</span></div>`
                : `<div style="color:var(--danger);">Enter a real "Chain respect factor (K)" above to get a target chain length.</div>`}
            <div>${ecN(activeMembers)} of ${ecN(roster)} members active (${esc(s.unavailPct)}% OD/absent) → about <b style="color:var(--reagent);">${ecN(hitsPerMember)}</b> hits needed per member</div>
            <div>A natural bar alone gets ${ecN(baseHits)} hits → each member needs about <b style="color:var(--reagent);">${xanaxNeeded} Xanax</b>${xanaxNeeded ? ` (+${ecN(xanaxNeeded * xanaxHits)} hits)` : ''} to reach ${ecN(hitsPerMember)}</div>
            ${milestoneLine}
        </div>
        ${xanaxRows.length ? `
        <div style="margin-top:14px;">
            <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">If everyone does a round number of Xanax instead:</div>
            <table style="width:100%;font-size:13px;border-collapse:collapse;">
                <thead><tr style="color:var(--muted);text-align:left;"><th style="padding:4px 8px;">Xanax each</th><th style="padding:4px 8px;">Hits each</th><th style="padding:4px 8px;">Chain reached</th><th style="padding:4px 8px;"></th></tr></thead>
                <tbody>${xanaxRows.map(r => `
                    <tr style="border-top:1px solid var(--line);${r.x === xanaxNeeded ? 'background:rgba(53,217,155,.08);' : ''}">
                        <td style="padding:4px 8px;font-weight:${r.x === xanaxNeeded ? '700' : '400'};">${r.x}</td>
                        <td style="padding:4px 8px;font-family:var(--mono);">${ecN(r.hitsEach)}</td>
                        <td style="padding:4px 8px;font-family:var(--mono);">~${ecN(r.totalReached)}</td>
                        <td style="padding:4px 8px;font-size:12px;">${r.atOrPastMilestone ? `<span style="color:var(--reagent);">✓ reaches the ${ecN(milestone)} milestone</span>` : r.meetsGoal ? '<span style="color:var(--reagent);">✓ meets the goal</span>' : '<span style="color:var(--danger);">short of the goal</span>'}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>` : ''}
        ${warScoresHtml}
        <p style="font-size:11px;color:var(--muted);margin:10px 0 0;">This is the MINIMUM to hit your goal — anyone who wants to do more still can, but nobody needs to stack further than this just to be able to train too. Every number above is your own faction's real history; overwrite any of them by hand if you want to plan for something different.</p>`;

    const fieldMap = { 'ec-goal': 'goal', 'ec-oc': 'oc', 'ec-warbonus': 'warBonus', 'ec-k': 'k', 'ec-roster': 'roster', 'ec-unavail': 'unavailPct', 'ec-basehits': 'baseHits', 'ec-xanhits': 'xanaxHits' };
    Object.keys(fieldMap).forEach(id => {
        $(id).addEventListener('change', () => {
            const key = fieldMap[id];
            const val = id === 'ec-goal' ? $(id).value.trim() : Number($(id).value);
            ecSave({ [key]: id === 'ec-goal' ? val : (Number.isFinite(val) ? val : null) });
            renderEffortCalc();
        });
    });
    $('ec-scenario').addEventListener('change', () => {
        // A fresh scenario gets its own fresh auto-fill for the war bonus and K, rather than keeping
        // whichever numbers were typed in for the last scenario.
        ecSave({ scenario: $('ec-scenario').value, warBonus: null, k: null });
        renderEffortCalc();
    });
}
