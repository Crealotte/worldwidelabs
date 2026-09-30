// effort-calculator.js — the "Effort Calculator" page (Leadership → Leaders): how much chain effort
// is actually needed to hit a weekly respect target once OC (and, if warring, the war bonus) are
// accounted for. Built for a termed loss — the point of taking one on purpose is usually to give
// members room to also train, but that can't come out of the respect the faction still needs, so
// this works out the real minimum to aim for instead of just "push the chain as far as it'll go".
// Real numbers (OC/week average, war bonus by win/loss, respect per chain hit, roster size) come
// from this faction's own history (api/respect.js's calc-data action); every field stays editable.
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
        oc: s.oc ?? null, warBonus: s.warBonus ?? null, perHit: s.perHit ?? null, roster: s.roster ?? null,
        unavailPct: s.unavailPct ?? 10, baseHits: s.baseHits ?? 4, xanaxHits: s.xanaxHits ?? 10,
    };
}
function ecSave(patch) { try { localStorage.setItem(EC_KEY, JSON.stringify({ ...ecState(), ...patch })); } catch (e) { /* not critical */ } }
const ecN = n => Math.round(n).toLocaleString();

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

// The historical average for whichever scenario is picked — 0 (no auto-fill needed) for "no war".
function ecWarBonusAuto(scenario) {
    if (scenario === 'none') return { avg: 0, count: null };
    const w = ecData?.warBonus?.[scenario];
    return w ? { avg: w.avg, count: w.count } : { avg: null, count: null };
}

function renderEffortCalc() {
    const el = $('ec-body');
    if (!el) return;
    const s = ecState();
    const d = ecData || {};
    const warAuto = ecWarBonusAuto(s.scenario);

    const oc = s.oc != null ? s.oc : (d.ocWeeklyAvg != null ? Math.round(d.ocWeeklyAvg) : 0);
    const warBonus = s.warBonus != null ? s.warBonus : (warAuto.avg != null ? Math.round(warAuto.avg) : 0);
    const perHit = s.perHit != null ? s.perHit : (d.chainRespectPerHit != null ? Math.round(d.chainRespectPerHit * 10) / 10 : 0);
    const roster = s.roster != null ? s.roster : (d.rosterCount ?? 0);
    const goal = Number(s.goal) || 0;

    const fromChain = Math.max(0, goal - oc - warBonus);
    const targetHits = perHit > 0 ? Math.ceil(fromChain / perHit) : 0;
    const activeMembers = Math.max(0, Math.round(roster * (1 - (Number(s.unavailPct) || 0) / 100)));
    const hitsPerMember = activeMembers > 0 ? Math.ceil(targetHits / activeMembers) : 0;
    const baseHits = Math.max(0, Number(s.baseHits) || 0);
    const xanaxHits = Math.max(1, Number(s.xanaxHits) || 1);
    const xanaxNeeded = Math.max(0, Math.ceil((hitsPerMember - baseHits) / xanaxHits));

    const ocNote = s.oc != null ? 'set by hand' : d.ocWeeklyAvg != null ? `your own avg over the last ${d.ocDays} day${d.ocDays === 1 ? '' : 's'}` : 'no OC history yet — enter by hand';
    const warNote = s.scenario === 'none' ? 'no war this week' : s.warBonus != null ? 'set by hand'
        : warAuto.avg != null ? `avg of your last ${warAuto.count} ${s.scenario}${warAuto.count === 1 ? '' : 'es'}` : `no ${s.scenario} history yet — enter by hand`;
    const perHitNote = s.perHit != null ? 'set by hand' : d.chainSample ? `avg of your last ${d.chainSample.chains} chains, ${ecN(d.chainSample.hits)} hits total` : 'no chain history yet — enter by hand';
    const rosterNote = s.roster != null ? 'set by hand' : d.rosterCount != null ? 'your current roster size' : 'enter by hand';

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
            <div class="field" style="margin:0;max-width:160px;"><label for="ec-perhit">Respect / chain hit</label><input autocomplete="off" id="ec-perhit" type="number" step="0.1" value="${perHit}"></div>
            <div class="field" style="margin:0;max-width:120px;"><label for="ec-roster">Roster size</label><input autocomplete="off" id="ec-roster" type="number" value="${roster}"></div>
            <div class="field" style="margin:0;max-width:140px;"><label for="ec-unavail">% OD / absent</label><input autocomplete="off" id="ec-unavail" type="number" value="${esc(s.unavailPct)}"></div>
        </div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:14px;line-height:1.6;">
            OC: ${esc(ocNote)} · War bonus: ${esc(warNote)} · Respect/hit: ${esc(perHitNote)} · Roster: ${esc(rosterNote)}
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px;">
            <div class="field" style="margin:0;max-width:190px;"><label for="ec-basehits">Hits from one natural energy bar</label><input autocomplete="off" id="ec-basehits" type="number" value="${esc(s.baseHits)}"></div>
            <div class="field" style="margin:0;max-width:160px;"><label for="ec-xanhits">Extra hits per Xanax</label><input autocomplete="off" id="ec-xanhits" type="number" value="${esc(s.xanaxHits)}"></div>
        </div>
        <div style="background:var(--bench-2);border-radius:var(--radius);padding:14px 16px;font-size:13px;line-height:2;">
            <div>Weekly goal: <b>${ecN(goal)}</b> respect</div>
            <div>− OC: <b>${ecN(oc)}</b> &nbsp;·&nbsp; − War bonus: <b>${ecN(warBonus)}</b></div>
            <div>= Needed from chain hits: <b style="color:var(--reagent);">${ecN(fromChain)}</b> respect</div>
            ${perHit > 0 ? `<div>At ~${esc(perHit)} respect/hit → aim for a chain of about <b style="color:var(--reagent);">${ecN(targetHits)}</b> hits</div>`
                : `<div style="color:var(--danger);">Enter a real "Respect / chain hit" above to get a target chain length.</div>`}
            <div>${ecN(activeMembers)} of ${ecN(roster)} members active (${esc(s.unavailPct)}% OD/absent) → about <b style="color:var(--reagent);">${ecN(hitsPerMember)}</b> hits needed per member</div>
            <div>A natural bar alone gets ${ecN(baseHits)} hits → each member needs about <b style="color:var(--reagent);">${xanaxNeeded} Xanax</b>${xanaxNeeded ? ` (+${ecN(xanaxNeeded * xanaxHits)} hits)` : ''} to reach ${ecN(hitsPerMember)}</div>
        </div>
        <p style="font-size:11px;color:var(--muted);margin:10px 0 0;">This is the MINIMUM to hit your goal — anyone who wants to do more still can, but nobody needs to stack further than this just to be able to train too. Every number above is your own faction's real history; overwrite any of them by hand if you want to plan for something different.</p>`;

    const fieldMap = { 'ec-goal': 'goal', 'ec-oc': 'oc', 'ec-warbonus': 'warBonus', 'ec-perhit': 'perHit', 'ec-roster': 'roster', 'ec-unavail': 'unavailPct', 'ec-basehits': 'baseHits', 'ec-xanhits': 'xanaxHits' };
    Object.keys(fieldMap).forEach(id => {
        $(id).addEventListener('change', () => {
            const key = fieldMap[id];
            const val = id === 'ec-goal' ? $(id).value.trim() : Number($(id).value);
            ecSave({ [key]: id === 'ec-goal' ? val : (Number.isFinite(val) ? val : null) });
            renderEffortCalc();
        });
    });
    $('ec-scenario').addEventListener('change', () => {
        // A fresh scenario gets its own fresh auto-fill for the war bonus, rather than keeping
        // whichever number was typed in for the last scenario.
        ecSave({ scenario: $('ec-scenario').value, warBonus: null });
        renderEffortCalc();
    });
}
