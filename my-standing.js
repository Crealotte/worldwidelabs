// my-standing.js — the "Your standing" card on the dashboard, for every member: which energy group
// they are in (worked out from their own total battle stats), how much energy they need to train this
// month (4,400 a week at 1.5m+ stats, 2,200 below), how many of the last 5 wars they took part in, and
// their place this month in each competition. Backend: mo-me in lib/memberOverview.js.
// Places and war numbers appear once a leader has opened Member Overview (that's what fills them).
'use strict';

const msFmt = ts => new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

async function loadMyStanding() {
    const panel = $('dash-standing-panel');
    try {
        const res = await fetch('/api/war-payout', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: apiKey, action: 'mo-me' }),
        });
        const r = await res.json();
        if (r.error) { panel.style.display = 'none'; return; }

        const groupLabel = r.tier === 'high' ? '1.5m+ battle stats' : r.tier === 'low' ? 'under 1.5m battle stats' : null;
        const big = 'font-size:40px;line-height:1.1;';
        const num = n => Math.round(n).toLocaleString();

        // --- the two big tiles: energy and war participation ---
        const energyTile = `
            <div class="stat">
                <div class="k">⚡ Energy trained this month</div>
                <div class="v" style="${big}">— <span style="color:var(--muted);font-size:20px;">/ ${groupLabel ? num(r.energyNeeded) : '?'}</span></div>
                ${groupLabel ? `<div style="margin-top:8px;font-size:13px;"><b>Rolling last ${r.period.plannedWeeks} weeks</b> (${r.period.plannedWeeks * 7} days, up to now): <span style="font-family:var(--mono);font-weight:700;">—</span> <span style="color:var(--muted);">/ ${num(r.energyNeeded)}</span></div>` : ''}
                <div class="s">${groupLabel
                    ? `${num(r.weeklyEnergy)} a week × ${r.period.plannedWeeks} weeks · ${msFmt(r.period.start)} → ${msFmt(r.period.plannedEnd)}<br>Group: ${groupLabel}${r.tierSource === 'leader' ? ' (set by a leader)' : ' (from your own stats)'}`
                    : 'Your energy group is picked up from your battle stats the next time you open the app.'}
                    <br>The rolling count keeps the same target over the latest ${r.period.plannedWeeks} weeks, so you always see if you're keeping up. Energy trained isn't tracked yet.</div>
            </div>`;

        const warColor = !r.eligible ? 'var(--muted)' : r.okWars >= r.need ? 'var(--reagent)' : 'var(--danger)';
        const chips = r.wars.map(w => {
            const color = w.unknown || w.notIn ? 'var(--muted)' : w.ok ? 'var(--reagent)' : 'var(--danger)';
            const text = w.unknown ? '…' : w.notIn ? '—' : `${w.war}${w.chain ? `+${w.chain}` : ''}`;
            return `<span title="vs ${esc(w.opponent)}" style="font-family:var(--mono);font-size:12px;color:${color};margin-right:10px;">${text}</span>`;
        }).join('');
        const warTile = `
            <div class="stat">
                <div class="k">⚔ War participation (last 5 wars)</div>
                <div class="v" style="${big}color:${warColor};">${r.wars.length && r.eligible ? `${r.okWars}/${r.eligible}` : '—'}</div>
                <div class="s">${r.wars.length
                    ? `Needed: ${r.need} of ${r.eligible}${r.eligible < 5 ? ' (you joined recently)' : ''} — ${r.rule.minWarHits} war hits per war, or ${r.rule.minChainHits} chain hits if you did fewer war hits than that<br>${chips}`
                    : 'Not calculated yet — it appears after a leader has opened Member Overview.'}</div>
            </div>`;

        // --- the smaller tiles: each with the number big and the place under it ---
        const small = [['bloodwithdrawn', '🩸 Blood bags filled'], ['candyused', '🍬 Candy'], ['alcoholused', '🍺 Alcohol'],
            ['energydrinkused', '🥤 Energy drinks'], ['war', '⚔ War hits (last 5 wars)'], ['chain', '⛓ Chain hits (last 5 wars)']].map(([k, label]) => {
            const p = r.places[k];
            return `
            <div class="stat">
                <div class="k">${label}</div>
                <div class="v" style="font-size:26px;">${p ? num(p.value) : '…'}</div>
                <div class="s">${p ? `<b style="color:var(--reagent);">#${p.place}</b> of ${p.of}` : 'place not known yet'}</div>
            </div>`;
        }).join('');

        $('dash-standing-body').innerHTML = `
            <div class="grid2" style="margin-bottom:14px;">${energyTile}${warTile}</div>
            <div style="color:var(--muted);font-size:12px;margin-bottom:8px;">Your numbers and place this month (${msFmt(r.period.start)} → ${msFmt(r.period.end)}${r.period.running ? ', full weeks so far' : ''}); the war and chain hits count the last 5 wars instead.</div>
            <div class="grid3">${small}</div>`;
        panel.style.display = 'block';
    } catch (e) { panel.style.display = 'none'; }
}
