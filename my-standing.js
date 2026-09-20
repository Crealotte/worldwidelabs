// my-standing.js — the "Your standing" card on the dashboard, for every member: which energy group
// they are in (worked out from their own total battle stats), how much energy they need to train this
// month (4,400 a week at 1.5m+ stats, 2,200 below), how many of the last 5 wars they took part in, and
// their place this month in each competition. Backend: mo-me in lib/memberOverview.js.
// Places and war numbers appear once a leader has opened Member Overview (that's what fills them).
'use strict';

const msFmt = ts => new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const MS_CATS = [['war', 'War hits (last 5 wars)'], ['chain', 'Chain hits (last 5 wars)'], ['bloodwithdrawn', 'Blood bags filled'], ['candyused', 'Candy'], ['alcoholused', 'Alcohol'], ['energydrinkused', 'Energy drinks']];

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
        const energy = groupLabel
            ? `<b>${r.energyNeeded.toLocaleString()} energy</b> to train this month <span style="color:var(--muted);">(${r.weeklyEnergy.toLocaleString()} a week × ${r.period.plannedWeeks} weeks, ${msFmt(r.period.start)} → ${msFmt(r.period.plannedEnd)})</span>
               <div style="color:var(--muted);font-size:12px;margin-top:2px;">Your group: ${groupLabel}${r.tierSource === 'leader' ? ' (set by a leader)' : ' (worked out from your own stats)'}. Energy trained so far isn't tracked yet.</div>`
            : '<span style="color:var(--muted);">Your energy group isn\'t known yet — it is picked up from your battle stats the next time you open the app.</span>';

        const warCells = r.wars.length ? r.wars.map(w => {
            const color = w.unknown ? 'var(--muted)' : w.notIn ? 'var(--muted)' : w.ok ? '#35d99b' : '#e05555';
            const text = w.unknown ? '…' : w.notIn ? '—' : `${w.war}${w.chain ? `+${w.chain}` : ''}`;
            return `<div style="text-align:center;min-width:64px;"><div style="font-family:var(--mono);font-weight:700;color:${color};">${text}</div><div style="color:var(--muted);font-size:10px;">${esc(w.opponent.slice(0, 10))}</div></div>`;
        }).join('') : '<span style="color:var(--muted);">Not calculated yet — it appears after a leader has opened Member Overview.</span>';
        const wars = r.wars.length
            ? `<b>${r.okWars} of the last ${r.eligible}</b> wars taken part in <span style="color:var(--muted);">(needed: ${r.need} — ${r.rule.minWarHits} war hits per war, or ${r.rule.minChainHits} chain hits if you did none)</span>`
            : '';

        const places = MS_CATS.filter(([k]) => r.places[k]).map(([k, label]) => {
            const p = r.places[k];
            return `<tr><td style="padding:3px 8px;">${esc(label)}</td><td style="padding:3px 8px;font-family:var(--mono);text-align:right;">${Math.round(p.value).toLocaleString()}</td><td style="padding:3px 8px;text-align:right;font-weight:700;color:var(--reagent);">#${p.place} <span style="color:var(--muted);font-weight:400;">of ${p.of}</span></td></tr>`;
        }).join('');

        $('dash-standing-body').innerHTML = `
            <div style="margin-bottom:12px;">${energy}</div>
            <div style="margin-bottom:12px;">${wars}<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">${warCells}</div></div>
            ${places ? `<div style="color:var(--muted);font-size:12px;margin-bottom:4px;">Your place this month (${msFmt(r.period.start)} → ${msFmt(r.period.end)}${r.period.running ? ', full weeks so far' : ''})</div>
            <table style="font-size:13px;border-collapse:collapse;">${places}</table>` : ''}`;
        panel.style.display = 'block';
    } catch (e) { panel.style.display = 'none'; }
}
