// member-overview.js — the Member Overview page (leader/council only): who follows the rules and
// who needs an extra push, plus a points leaderboard for competitions. Backend: lib/memberOverview.js
// via /api/war-payout ('mo-*' actions, refused for anyone without faction API access).
//
// Shows: hits per member over the last 5 wars (war + chain), a traffic light from the hits rule,
// candy / alcohol / energy drinks used per week (1 week or 4-week average), the member's energy
// tier, and points. Energy trained and blood bags need Torn data that isn't identified yet — the
// "Check what Torn offers" button finds it out.
'use strict';

let moData = null; // { members, wars, hits, tiers, energyTarget, settings }
let moStats = {}; // "<id>:<timestamp>" -> { candyused, alcoholused, energydrinkused }
let moWeeks = 1; // 1 = last full week, 4 = average per week over the last 4 weeks
let moSort = 'points';
let moBusy = false;
const MO_KEYS = [['bloodwithdrawn', 'Blood bags filled'], ['candyused', 'Candy'], ['alcoholused', 'Alcohol'], ['energydrinkused', 'Energy drinks']];

async function moFetch(body) {
    const res = await fetch('/api/war-payout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: apiKey, ...body }),
    });
    return res.json();
}

// Monday 00:00 TCT (UTC) of the current week, in unix seconds — weekly figures run Monday to Monday.
function moWeekStart() {
    const d = new Date();
    const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow) / 1000);
}
const moStamps = () => { const b0 = moWeekStart(); return { b0, b1: b0 - 7 * 86400, b4: b0 - 28 * 86400 }; };

async function loadMemberOverview() {
    if (moBusy) return;
    if (!isLeaderCached) { $('mo-locked').style.display = 'block'; $('mo-body').style.display = 'none'; return; }
    $('mo-locked').style.display = 'none'; $('mo-body').style.display = 'block';
    moBusy = true;
    const st = $('mo-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    try {
        const r = await moFetch({ action: 'mo-get' });
        if (r.error) throw new Error(r.error);
        moData = r;
        renderMemberOverview();
        // finish any of the last 5 wars not calculated yet — one at a time, each is saved for good
        const todo = moData.wars.filter(w => !moData.hits[w.id]);
        for (let i = 0; i < todo.length; i++) {
            st.className = 'status ok'; st.textContent = `Counting hits for a war you haven't opened here before (${i + 1} of ${todo.length})…`;
            const w = await moFetch({ action: 'mo-war', warId: todo[i].id });
            if (w.error) throw new Error(w.error);
            if (w.partial) { st.className = 'status err'; st.textContent = `The war vs ${todo[i].opponent} was too big to count in one go — press Refresh to continue.`; }
            else moData.hits[w.warId] = w.hits;
            renderMemberOverview();
        }
        // weekly consumption snapshots, in rounds until everything is in
        const ids = moData.members.map(m => m.id);
        const { b0, b1, b4 } = moStamps();
        let lastPending = Infinity;
        for (let round = 0; round < 40; round++) {
            const s = await moFetch({ action: 'mo-stats', ids, timestamps: [b4, b1, b0] });
            if (s.error) throw new Error(s.error);
            Object.assign(moStats, s.values);
            renderMemberOverview();
            if (!s.pending) break;
            if (s.pending >= lastPending && s.failed) { st.className = 'status err'; st.textContent = `Couldn't read Torn stats for ${s.pending} lookups — some members' stats may be hidden.`; return; }
            lastPending = s.pending;
            st.className = 'status ok'; st.textContent = `Reading weekly stats… ${s.pending} lookups left (first time only)`;
        }
        if (st.className !== 'status err') { st.textContent = ''; st.className = 'status'; }
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    } finally { moBusy = false; }
}

// Used per week, from two snapshots. Null when either snapshot is missing.
function moUsed(id, stat) {
    const { b0, b1, b4 } = moStamps();
    const end = moStats[`${id}:${b0}`];
    const start = moStats[`${id}:${moWeeks === 1 ? b1 : b4}`];
    if (!end || !start) return null;
    const v = (end[stat] - start[stat]) / moWeeks;
    return v < 0 ? null : v;
}

function moRows() {
    const { wars, hits, settings, tiers } = moData;
    const counted = wars.filter(w => hits[w.id]);
    return moData.members.map(m => {
        let war = 0, chain = 0;
        const perWar = wars.map(w => {
            const h = hits[w.id]?.[m.id];
            if (!hits[w.id]) return null;
            war += h?.war || 0; chain += h?.chain || 0;
            return { war: h?.war || 0, chain: h?.chain || 0 };
        });
        const n = counted.length;
        const avg = n ? (war + chain) / n : null;
        const isNew = m.daysInFaction !== null && m.daysInFaction < 14;
        let light = 'grey';
        if (avg !== null && !isNew) light = avg >= settings.minHitsPerWar ? 'green' : avg >= settings.minHitsPerWar / 2 ? 'yellow' : 'red';
        return {
            ...m, perWar, war, chain, avg, light, isNew, tier: tiers[m.id] || '',
            points: war * settings.warPoints + chain * settings.chainPoints,
            used: Object.fromEntries(MO_KEYS.map(([k]) => [k, moUsed(m.id, k)])),
        };
    });
}

const MO_LIGHT = { green: '#35d99b', yellow: '#f0b432', red: '#e05555', grey: '#666' };
const moAgo = ts => { if (!ts) return '—'; const d = Math.floor((Date.now() / 1000 - ts) / 86400); return d < 1 ? 'today' : `${d}d ago`; };
const moNum = v => v === null ? '…' : (moWeeks === 1 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toLocaleString());

function renderMemberOverview() {
    if (!moData) return;
    const rows = moRows();
    const sortVal = { points: r => -r.points, name: r => r.name.toLowerCase(), light: r => ({ red: 0, yellow: 1, green: 2, grey: 3 })[r.light], active: r => -(r.lastAction || 0) };
    MO_KEYS.forEach(([k]) => { sortVal[k] = r => -(r.used[k] ?? -1); });
    rows.sort((a, b) => { const x = sortVal[moSort](a), y = sortVal[moSort](b); return x < y ? -1 : x > y ? 1 : 0; });

    const red = rows.filter(r => r.light === 'red');
    const yellow = rows.filter(r => r.light === 'yellow');
    $('mo-summary').innerHTML = `
        <div><div style="color:var(--muted);font-size:11px;">Members</div><div style="font-weight:700;">${rows.length}</div></div>
        <div><div style="color:var(--muted);font-size:11px;">On track</div><div style="font-weight:700;color:${MO_LIGHT.green};">${rows.filter(r => r.light === 'green').length}</div></div>
        <div><div style="color:var(--muted);font-size:11px;">Slipping</div><div style="font-weight:700;color:${MO_LIGHT.yellow};">${yellow.length}</div></div>
        <div><div style="color:var(--muted);font-size:11px;">Needs a push</div><div style="font-weight:700;color:${MO_LIGHT.red};">${red.length}</div></div>`;
    $('mo-push').innerHTML = red.length ? `<span style="color:var(--muted);font-size:12px;">Needs a push (hits): </span>${red.map(r => `<span class="chip" style="cursor:default;border-color:${MO_LIGHT.red};">${esc(r.name)}</span>`).join(' ')}` : '';

    $('mo-min').value = moData.settings.minHitsPerWar;
    $('mo-wp').value = moData.settings.warPoints;
    $('mo-cp').value = moData.settings.chainPoints;
    $('mo-weeks-1').classList.toggle('active-toggle', moWeeks === 1);
    $('mo-weeks-4').classList.toggle('active-toggle', moWeeks === 4);

    const th = (key, label) => `<th style="padding:4px 8px;cursor:pointer;white-space:nowrap;${moSort === key ? 'color:var(--reagent);' : ''}" data-sort="${key}">${label}${moSort === key ? ' ▾' : ''}</th>`;
    const warHead = moData.wars.map(w => `<th style="padding:4px 8px;font-size:11px;white-space:nowrap;" title="${esc(`vs ${w.opponent}`)}">${esc(w.opponent.slice(0, 10))}<br><span style="color:var(--muted);">${new Date(w.end * 1000).toLocaleDateString(undefined, { day: '2-digit', month: 'short', timeZone: 'UTC' })}</span></th>`).join('');
    const weekLabel = moWeeks === 1 ? 'last week' : 'avg / week, 4 wks';
    $('mo-table').innerHTML = `
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <thead><tr style="color:var(--muted);text-align:left;">
                ${th('light', '●')}${th('name', 'Member')}${th('active', 'Active')}
                ${warHead}
                <th style="padding:4px 8px;">Avg hits</th>
                <th style="padding:4px 8px;" title="1.5m+ battle stats = ${moData.energyTarget.high} E/week, under = ${moData.energyTarget.low} E/week. Torn hides battle stats, so set it by hand.">Energy tier</th>
                ${MO_KEYS.map(([k, l]) => th(k, `${l}<br><span style="font-size:10px;font-weight:400;">${weekLabel}</span>`)).join('')}
                ${th('points', 'Points')}
            </tr></thead>
            <tbody>${rows.map(r => `
                <tr style="border-top:1px solid var(--line);">
                    <td style="padding:4px 8px;"><span title="${r.isNew ? 'New member (under 14 days) — not judged yet' : r.light}" style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${MO_LIGHT[r.light]};"></span></td>
                    <td style="padding:4px 8px;white-space:nowrap;"><a href="https://www.torn.com/profiles.php?XID=${esc(r.id)}" target="_blank" rel="noopener" style="color:var(--text);">${esc(r.name)}</a></td>
                    <td style="padding:4px 8px;color:var(--muted);white-space:nowrap;">${moAgo(r.lastAction)}</td>
                    ${r.perWar.map(p => `<td style="padding:4px 8px;font-family:var(--mono);white-space:nowrap;">${p ? `${p.war}${p.chain ? `<span style="color:var(--muted);">+${p.chain}</span>` : ''}` : '…'}</td>`).join('')}
                    <td style="padding:4px 8px;font-family:var(--mono);">${r.avg === null ? '…' : (Math.round(r.avg * 10) / 10)}</td>
                    <td style="padding:4px 8px;"><select class="mo-tier" data-id="${esc(r.id)}" style="font-size:12px;padding:2px 4px;width:auto;">
                        <option value="">—</option><option value="high" ${r.tier === 'high' ? 'selected' : ''}>1.5m+ · ${moData.energyTarget.high}</option><option value="low" ${r.tier === 'low' ? 'selected' : ''}>&lt;1.5m · ${moData.energyTarget.low}</option></select></td>
                    ${MO_KEYS.map(([k]) => `<td style="padding:4px 8px;font-family:var(--mono);">${moNum(r.used[k])}</td>`).join('')}
                    <td style="padding:4px 8px;font-family:var(--mono);font-weight:700;color:var(--reagent);">${r.points}</td>
                </tr>`).join('')}
            </tbody>
        </table>`;

    $('mo-table').querySelectorAll('[data-sort]').forEach(h => h.addEventListener('click', () => { moSort = h.dataset.sort; renderMemberOverview(); }));
    $('mo-table').querySelectorAll('.mo-tier').forEach(s => s.addEventListener('change', async () => {
        if (s.value) moData.tiers[s.dataset.id] = s.value; else delete moData.tiers[s.dataset.id];
        const r = await moFetch({ action: 'mo-tier', id: s.dataset.id, tier: s.value });
        if (r.error) toast(r.error);
    }));
}

$('mo-weeks-1').addEventListener('click', () => { moWeeks = 1; renderMemberOverview(); });
$('mo-weeks-4').addEventListener('click', () => { moWeeks = 4; renderMemberOverview(); });
$('mo-refresh').addEventListener('click', () => loadMemberOverview());

$('mo-save-settings').addEventListener('click', async () => {
    const r = await moFetch({ action: 'mo-settings', minHitsPerWar: $('mo-min').value, warPoints: $('mo-wp').value, chainPoints: $('mo-cp').value });
    if (r.error) { toast(r.error); return; }
    moData.settings = r.settings;
    toast('Saved');
    renderMemberOverview();
});

$('mo-probe-btn').addEventListener('click', async () => {
    const btn = $('mo-probe-btn'); btn.disabled = true; btn.textContent = 'Checking…';
    try {
        const r = await moFetch({ action: 'mo-probe' });
        if (r.error) throw new Error(r.error);
        const stats = Object.entries(r.stats).map(([k, v]) => `${k} = ${v}`).join('\n') || '(none found)';
        $('mo-probe-out').textContent = `Torn stats about gym/energy/drinks/xanax on your account (${r.statKeys} stats in total):\n${stats}\n\nGym log types: ${JSON.stringify(r.gymTypes || {})}\nGym log sample: ${r.gymError ? `(error: ${r.gymError})` : (r.gymSample || '(none)')}\n\nAll stat names: ${(r.allKeys || []).join(', ')}\n\nArmory lines mentioning blood bags (last 3 days):\n${r.bloodLines.join('\n') || '(none)'}`;
        $('mo-probe-out').style.display = 'block';
    } catch (e) { toast(e.message); } finally { btn.disabled = false; btn.textContent = 'Check what Torn offers'; }
});
