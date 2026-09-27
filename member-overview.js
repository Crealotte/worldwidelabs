// member-overview.js — the Member Overview page (leader/council only): who follows the rules and
// who needs an extra push, plus a winners list (one winner per category) for competitions.
// Backend: lib/memberOverview.js via /api/war-payout ('mo-*' actions, refused for anyone without
// faction API access).
//
// Everything is shown for a chosen PERIOD. Finished periods run Sunday to Sunday (TCT) — the newsletter
// comes out on the first Sunday of each month, so a "newsletter period" runs from the previous first
// Sunday to this one, 4 or 5 weeks depending on the month. The RUNNING period ("now") counts every day up
// to and including today instead, so it never hides what happened since the last Sunday. A custom "last N
// full weeks" is there too, for week-to-week comparisons.
// Shows: hits per member for the wars that ended in the period (war + chain), a traffic light from
// the hits rule, blood bags filled / candy / alcohol used (total or per week), energy tier, and a
// winners list. Energy trained needs Torn data that isn't connected yet.
'use strict';

let moData = null; // { members, wars, hits, tiers, energyTarget, settings }
let moEnergy = null; // { perMember: { id: energy }, partial, sinceDay } — energy trained in the gym over the period, from the daily contributor snapshots
let moStats = {}; // "<id>:<timestamp>" -> { candyused, alcoholused, bloodwithdrawn }
let moPeriodId = null; // which option of the period dropdown is picked
let moCustomWeeks = 4;
let moDates = null; // { from, to } as YYYY-MM-DD, to = last whole day included — for matching another tool's dates
let moPerWeek = false; // false = totals over the period, true = average per week
let moSort = 'war';
let moBusy = false;
const MO_KEYS = [['energytrained', 'Energy trained'], ['bloodwithdrawn', 'Blood bags filled'], ['candyused', 'Candy'], ['alcoholused', 'Alcohol']]; // Energy drinks dropped per the leader's request — removing it from here also drops it from the table columns, sorting and the competitions list below, all driven off this one array
const MO_DAY = 86400;

async function moFetch(body) {
    const res = await fetch('/api/war-payout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: apiKey, ...body }),
    });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status}) — ${text.slice(0, 120)}` }; }
}

// ---- Periods. Weeks are Sunday 00:00 TCT (UTC) to Sunday 00:00. ----
function moLatestSunday() {
    const d = new Date();
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - d.getUTCDay()) / 1000);
}
function moFirstSunday(y, m) { // first Sunday of month m (0-11), as unix seconds
    const first = new Date(Date.UTC(y, m, 1));
    return Math.floor(Date.UTC(y, m, 1 + (7 - first.getUTCDay()) % 7) / 1000);
}
const moFmt = ts => new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// The choices in the dropdown: the period still running (up to the latest full week), the last few
// newsletter periods, and a custom number of weeks.
function moPeriods() {
    const now = Math.floor(Date.now() / 1000);
    const latest = moLatestSunday();
    const today = new Date();
    // The running period counts every day up to and including today (not just full weeks), so it matches
    // lib/memberOverview.js's currentPeriod() — what members' own dashboards and the newsletter draft use.
    const todayStart = Math.floor(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) / 1000);
    const dates = []; // newsletter dates (first Sundays) up to now, newest first
    for (let i = 0; dates.length < 8 && i < 24; i++) {
        const dt = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
        const t = moFirstSunday(dt.getUTCFullYear(), dt.getUTCMonth());
        if (t <= now) dates.push(t);
    }
    const out = [];
    if (todayStart > dates[0]) out.push({ id: 'now', start: dates[0], end: todayStart, label: `Running now — ${moFmt(dates[0])} → ${moFmt(todayStart)} (up to today)` });
    for (let i = 0; i < dates.length - 1; i++) {
        const weeks = Math.round((dates[i] - dates[i + 1]) / (7 * MO_DAY));
        out.push({ id: `p${dates[i]}`, start: dates[i + 1], end: dates[i], label: `Newsletter ${moFmt(dates[i])} — ${moFmt(dates[i + 1])} → ${moFmt(dates[i])} (${weeks} weeks)` });
    }
    if (!moDates) { // default: the 30 whole days up to yesterday
        const y = new Date((latest > 0 ? Math.floor(now / MO_DAY) * MO_DAY - MO_DAY : 0) * 1000);
        const f = new Date(y.getTime() - 29 * MO_DAY * 1000);
        moDates = { from: f.toISOString().slice(0, 10), to: y.toISOString().slice(0, 10) };
    }
    const dStart = Math.floor(Date.parse(`${moDates.from}T00:00:00Z`) / 1000);
    const dEnd = Math.min(Math.floor(Date.parse(`${moDates.to}T00:00:00Z`) / 1000) + MO_DAY, Math.floor(now / MO_DAY) * MO_DAY); // whole days only, never today
    if (dEnd > dStart) out.push({ id: 'dates', start: dStart, end: dEnd, label: `Exact dates — ${moFmt(dStart)} → ${moFmt(dEnd - MO_DAY)} (whole days)` });
    out.push({ id: 'custom', start: latest - moCustomWeeks * 7 * MO_DAY, end: latest, label: `Last ${moCustomWeeks} full weeks (custom)` });
    return out;
}
function moPeriod() {
    const list = moPeriods();
    return list.find(p => p.id === moPeriodId) || list.find(p => p.id !== 'now' && p.id !== 'custom') || list[0];
}
const moWeeksIn = p => Math.max(1 / 7, (p.end - p.start) / (7 * MO_DAY)); // exact, so odd date ranges average correctly
const moDaysIn = p => Math.round((p.end - p.start) / MO_DAY);

function renderPeriodBar() {
    const list = moPeriods();
    const cur = moPeriod();
    moPeriodId = cur.id;
    $('mo-period').innerHTML = list.map(p => `<option value="${p.id}" ${p.id === cur.id ? 'selected' : ''}>${esc(p.label)}</option>`).join('');
    $('mo-custom-weeks').value = moCustomWeeks;
    $('mo-custom-wrap').style.display = cur.id === 'custom' ? 'inline-flex' : 'none';
    $('mo-dates-wrap').style.display = cur.id === 'dates' ? 'inline-flex' : 'none';
    $('mo-date-from').value = moDates.from; $('mo-date-to').value = moDates.to;
    $('mo-view-total').classList.toggle('active-toggle', !moPerWeek);
    $('mo-view-week').classList.toggle('active-toggle', moPerWeek);
    $('mo-period-note').textContent = (moEnergy?.partial && moEnergy.sinceDay ? `Energy trained is counted since ${moFmt(moEnergy.sinceDay * 86400)} — that is when the counting started. ` : '') + `${moDaysIn(cur)} days (${Math.round(moWeeksIn(cur) * 10) / 10} weeks) · ${moFmt(cur.start)} 00:00 → ${moFmt(cur.end)} 00:00 TCT${cur.id === 'dates' || cur.id === 'now' ? '' : ' (Sunday to Sunday)'}`;
}

async function loadMemberOverview() {
    if (moBusy) return;
    if (!isLeaderCached) { $('mo-locked').style.display = 'block'; $('mo-body').style.display = 'none'; return; }
    $('mo-locked').style.display = 'none'; $('mo-body').style.display = 'block';
    if (typeof loadAdoption === 'function') loadAdoption('-mo');
    moBusy = true;
    const st = $('mo-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    try {
        if (!moData) {
            const r = await moFetch({ action: 'mo-get' });
            if (r.error) throw new Error(r.error);
            moData = r;
        }
        renderMemberOverview();
        // finish any of the last 5 wars not counted yet — one at a time, each is saved for good. A big
        // war is read in pieces (the server remembers where it stopped), so keep asking until done.
        // A war that fails must never stop the rest (the stats below), so problems are collected.
        const problems = [];
        const todo = moWarsInPeriod().filter(w => !w.event && !moData.hits[w.id]); // a chain event has nothing to scan — only its linked chains
        for (let i = 0; i < todo.length; i++) {
            for (let round = 1; round <= 10; round++) {
                st.className = 'status ok'; st.textContent = `Counting hits for the war vs ${todo[i].opponent} (${i + 1} of ${todo.length}${round > 1 ? `, part ${round}` : ''})…`;
                const w = await moFetch({ action: 'mo-war', warId: todo[i].id });
                if (w.error) { problems.push(`War vs ${todo[i].opponent}: ${w.error}`); break; }
                if (!w.partial) { moData.hits[w.warId] = w.hits; renderMemberOverview(); break; }
                if (round === 10) problems.push(`War vs ${todo[i].opponent} is still being counted — press Refresh to continue.`);
            }
        }
        // consumption snapshots at the period's start and end, in rounds until everything is in
        const ids = moData.members.map(m => m.id);
        const p = moPeriod();
        try { const e = await moFetch({ action: 'mo-energy', from: p.start, to: p.end }); moEnergy = e.error ? null : e; renderMemberOverview(); } catch (e) { moEnergy = null; }
        // Members' own dashboard (my-standing.js) always reads the CURRENT running period, whatever a leader
        // happens to be viewing here (the dropdown defaults to the last FINISHED period, not "now"). So the
        // current period's snapshot is requested every time too, or a member's candy/alcohol/blood numbers
        // would only ever update on the rare visit where a leader had "Running now" selected.
        const nowPeriod = moPeriods().find(x => x.id === 'now');
        const timestamps = [...new Set(nowPeriod ? [p.start, p.end, nowPeriod.start, nowPeriod.end] : [p.start, p.end])];
        let lastPending = Infinity;
        for (let round = 0; round < 40; round++) {
            const s = await moFetch({ action: 'mo-stats', ids, timestamps });
            if (s.error) { problems.push(`Stats: ${s.error}`); break; }
            Object.assign(moStats, s.values);
            renderMemberOverview();
            if (!s.pending) break;
            if (s.pending >= lastPending && s.failed) { problems.push(`Couldn't read Torn stats for ${s.pending} lookups. Torn said: ${s.firstError || 'nothing'}`); break; }
            lastPending = s.pending;
            st.className = 'status ok'; st.textContent = `Reading stats… ${s.pending} lookups left (first time for this period only)`;
        }
        if (problems.length) { st.className = 'status err'; st.textContent = problems.join(' • '); } else { st.textContent = ''; st.className = 'status'; }
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    } finally { moBusy = false; }
}

// The last 5 finished wars (rolling) — what the war rule is judged on, whatever period is picked.
function moWarsInPeriod() {
    return (moData?.wars || []).slice().sort((a, b) => b.end - a.end).slice(0, 5).sort((a, b) => a.end - b.end);
}

// Used over the period (or per week), from two snapshots. Null when either snapshot is missing.
function moUsed(id, stat) {
    if (stat === 'energytrained') { // not a snapshot of personal stats: the faction's contributor counters
        if (!moEnergy || !moEnergy.snapshots) return null;
        return (moEnergy.perMember[id] ?? 0) / (moPerWeek ? moWeeksIn(moPeriod()) : 1);
    }
    const p = moPeriod();
    const end = moStats[`${id}:${p.end}`];
    const start = moStats[`${id}:${p.start}`];
    if (!end || !start) return null;
    const v = (end[stat] - start[stat]) / (moPerWeek ? moWeeksIn(p) : 1);
    return v < 0 ? null : v;
}

// The war rule: a war counts for a member if they did at least `minWarHits` war hits — or, having
// done fewer than that, at least `minChainHits` chain hits instead.
function moWarOk(p, s) { return !!p && (p.war >= s.minWarHits || (p.war < s.minWarHits && p.chain >= s.minChainHits)); }

function moRows() {
    const { hits, settings, tiers } = moData;
    const wars = moWarsInPeriod();
    const now = Math.floor(Date.now() / 1000);
    return moData.members.map(m => {
        // Torn only gives "days in faction", so the join moment is "at least that many days ago". A war
        // is only held against a member if they were definitely already in the faction when it started
        // — anyone who might have joined after it began is left out of that war rather than penalised.
        const joinedBy = m.daysInFaction === null ? 0 : now - m.daysInFaction * MO_DAY;
        let war = 0, chain = 0, okWars = 0, eligible = 0;
        const perWar = wars.map(w => {
            if (!hits[w.id]) return null;
            const h = hits[w.id]?.[m.id];
            const p = { war: h?.war || 0, chain: h?.chain || 0 };
            war += p.war; chain += p.chain;
            if (joinedBy > w.start) { p.notIn = true; return p; } // not in the faction yet
            eligible++;
            p.ok = moWarOk(p, settings);
            if (p.ok) okWars++;
            return p;
        });
        // Needs to meet the rule in `needWars` of the wars they were around for (fewer if they joined recently).
        const need = Math.min(settings.needWars, eligible);
        let light = 'grey';
        if (eligible) light = okWars >= need ? 'green' : 'red';
        return {
            ...m, perWar, war, chain, okWars, need, counted: eligible, light, isNew: eligible < settings.needWars, tier: tiers[m.id] || '',
            used: Object.fromEntries(MO_KEYS.map(([k]) => [k, moUsed(m.id, k)])),
        };
    });
}

const MO_LIGHT = { green: '#35d99b', yellow: '#f0b432', red: '#e05555', grey: '#666' };
const moAgo = ts => { if (!ts) return '—'; const d = Math.floor((Date.now() / 1000 - ts) / MO_DAY); return d < 1 ? 'today' : `${d}d ago`; };
const moNum = v => v === null ? '…' : (moPerWeek ? (Math.round(v * 10) / 10).toLocaleString() : Math.round(v).toLocaleString());

// Top 3 per competition for the newsletter. Ties share a value but are listed in order.
function moWinners(rows) {
    const cats = [
        ['War hits (last 5 wars)', r => r.war],
        ['Chain hits (last 5 wars)', r => r.chain],
        ...MO_KEYS.map(([k, l]) => [l, r => r.used[k], 'stat']),
    ];
    return cats.map(([label, get]) => ({
        label,
        top: rows.filter(r => (get(r) ?? 0) > 0).sort((a, b) => get(b) - get(a)).slice(0, 3).map(r => ({ name: r.name, value: get(r) })),
    }));
}

function renderMemberOverview() {
    if (!moData) return;
    renderPeriodBar();
    const rows = moRows();
    const sortVal = { war: r => -r.war, chain: r => -r.chain, name: r => r.name.toLowerCase(), light: r => ({ red: 0, yellow: 1, green: 2, grey: 3 })[r.light], active: r => -(r.lastAction || 0) };
    MO_KEYS.forEach(([k]) => { sortVal[k] = r => -(r.used[k] ?? -1); });
    const sorted = rows.slice().sort((a, b) => { const x = sortVal[moSort](a), y = sortVal[moSort](b); return x < y ? -1 : x > y ? 1 : 0; });

    const red = rows.filter(r => r.light === 'red');
    $('mo-summary').innerHTML = `
        <div><div style="color:var(--muted);font-size:11px;">Members</div><div style="font-weight:700;">${rows.length}</div></div>
        <div><div style="color:var(--muted);font-size:11px;">On track</div><div style="font-weight:700;color:${MO_LIGHT.green};">${rows.filter(r => r.light === 'green').length}</div></div>
        
        <div><div style="color:var(--muted);font-size:11px;">Needs a push</div><div style="font-weight:700;color:${MO_LIGHT.red};">${red.length}</div></div>
        <div><div style="color:var(--muted);font-size:11px;">Wars judged</div><div style="font-weight:700;">${moWarsInPeriod().length}</div></div>`;
    $('mo-push').innerHTML = red.length ? `<span style="color:var(--muted);font-size:12px;">Needs a push on warring (met the war rule in fewer than ${moData.settings.needWars} of the last 5 wars): </span>${red.map(r => `<span class="chip" style="cursor:default;border-color:${MO_LIGHT.red};">${esc(r.name)}</span>`).join(' ')}` : '';

    const winners = moWinners(rows);
    const medal = ['🥇', '🥈', '🥉'];
    const fmt = v => (moPerWeek ? Math.round(v * 10) / 10 : Math.round(v)).toLocaleString();
    $('mo-winners').innerHTML = winners.map(w => `
        <div style="min-width:170px;">
            <div style="color:var(--muted);font-size:11px;margin-bottom:4px;">${esc(w.label)}</div>
            ${w.top.length ? w.top.map((t, i) => `<div style="font-size:13px;">${medal[i]} ${esc(t.name)} <span style="color:var(--muted);font-family:var(--mono);">${fmt(t.value)}</span></div>`).join('') : '<div style="color:var(--muted);font-size:12px;">no data yet</div>'}
        </div>`).join('');
    $('mo-copy-winners').onclick = () => {
        const p = moPeriod();
        const text = `Competition winners — ${moFmt(p.start)} → ${moFmt(p.end)}\n\n` + winners.map(w =>
            `${w.label}\n${w.top.length ? w.top.map((t, i) => `${medal[i]} ${t.name} — ${fmt(t.value)}`).join('\n') : '(no data)'}`).join('\n\n');
        navigator.clipboard.writeText(text).then(() => toast('Winners copied'));
    };

    $('mo-min').value = moData.settings.minWarHits;
    $('mo-minchain').value = moData.settings.minChainHits;
    $('mo-need').value = moData.settings.needWars;

    const th = (key, label) => `<th style="padding:4px 8px;cursor:pointer;white-space:nowrap;${moSort === key ? 'color:var(--reagent);' : ''}" data-sort="${key}">${label}${moSort === key ? ' ▾' : ''}</th>`;
    const warHead = moWarsInPeriod().map(w => `<th style="padding:4px 8px;font-size:11px;white-space:nowrap;" title="${esc(w.event ? `Chain event: ${w.opponent}` : `vs ${w.opponent}`)}">${w.event ? '⛓ ' : ''}${esc(w.opponent.slice(0, 10))}<br><span style="color:var(--muted);">${new Date(w.end * 1000).toLocaleDateString(undefined, { day: '2-digit', month: 'short', timeZone: 'UTC' })}</span></th>`).join('');
    const unitLabel = moPerWeek ? 'per week' : 'in period';
    $('mo-table').innerHTML = `
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <thead><tr style="color:var(--muted);text-align:left;">
                ${th('light', '●')}${th('name', 'Member')}${th('active', 'Active')}
                ${warHead}
                <th style="padding:4px 8px;" title="Wars (of the last 5) where the war rule was met">Wars OK</th>
                <th style="padding:4px 8px;" title="1.5m+ battle stats = ${moData.energyTarget.high} E/week, under = ${moData.energyTarget.low} E/week. Picked automatically from each member's own battle stats once they have opened the app; you can override it.">Energy tier</th>
                ${MO_KEYS.map(([k, l]) => th(k, `${l}<br><span style="font-size:10px;font-weight:400;">${unitLabel}</span>`)).join('')}
                ${th('war', 'War hits')}${th('chain', 'Chain hits')}
            </tr></thead>
            <tbody>${sorted.map(r => `
                <tr style="border-top:1px solid var(--line);">
                    <td style="padding:4px 8px;"><span title="${r.isNew && r.light === 'grey' ? 'Fewer than ' + moData.settings.needWars + ' wars since joining — judged on the wars they were here for' : r.light}" style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${MO_LIGHT[r.light]};"></span></td>
                    <td style="padding:4px 8px;white-space:nowrap;"><a href="https://www.torn.com/profiles.php?XID=${esc(r.id)}" target="_blank" rel="noopener" style="color:var(--text);">${esc(r.name)}</a></td>
                    <td style="padding:4px 8px;color:var(--muted);white-space:nowrap;">${moAgo(r.lastAction)}</td>
                    ${r.perWar.map(p => `<td style="padding:4px 8px;font-family:var(--mono);white-space:nowrap;${p ? `color:${p.notIn ? MO_LIGHT.grey : p.ok ? MO_LIGHT.green : MO_LIGHT.red};` : ''}" ${p?.notIn ? 'title="Not in the faction yet when this war started"' : ''}>${p ? (p.notIn ? '—' : `${p.war}${p.chain ? `<span style="color:var(--muted);">+${p.chain}</span>` : ''}`) : '…'}</td>`).join('')}
                    <td style="padding:4px 8px;font-family:var(--mono);font-weight:700;color:${MO_LIGHT[r.light]};">${r.counted ? `${r.okWars}/${r.counted}` : '…'}</td>
                    <td style="padding:4px 8px;white-space:nowrap;">${(() => {
                        const auto = moData.autoTier?.[r.id];
                        const eff = r.tier || auto?.tier || '';
                        const weeks = moWeeksIn(moPeriod());
                        const need = eff ? Math.round(moData.energyTarget[eff] * weeks) : null;
                        return `<select class="mo-tier" data-id="${esc(r.id)}" style="font-size:12px;padding:2px 4px;width:auto;">
                        <option value="">${auto ? `Auto: ${auto.tier === 'high' ? '1.5m+' : '&lt;1.5m'}` : 'Auto (not seen yet)'}</option><option value="high" ${r.tier === 'high' ? 'selected' : ''}>Set: 1.5m+</option><option value="low" ${r.tier === 'low' ? 'selected' : ''}>Set: &lt;1.5m</option></select>
                        <div style="color:var(--muted);font-size:10px;">${need ? `${need.toLocaleString()} E needed` : ''}${auto ? ` · ${(auto.total / 1e6).toFixed(2)}m stats` : ''}</div>`;
                    })()}</td>
                    ${MO_KEYS.map(([k]) => `<td style="padding:4px 8px;font-family:var(--mono);">${moNum(r.used[k])}</td>`).join('')}
                    <td style="padding:4px 8px;font-family:var(--mono);">${r.war}</td><td style="padding:4px 8px;font-family:var(--mono);">${r.chain}</td>
                </tr>`).join('')}
            </tbody>
        </table>`;

    $('mo-table').querySelectorAll('[data-sort]').forEach(h => h.addEventListener('click', () => { moSort = h.dataset.sort; renderMemberOverview(); }));
    $('mo-table').querySelectorAll('.mo-tier').forEach(s => s.addEventListener('change', async () => {
        if (s.value) moData.tiers[s.dataset.id] = s.value; else delete moData.tiers[s.dataset.id];
        const r = await moFetch({ action: 'mo-tier', id: s.dataset.id, tier: s.value });
        if (r.error) toast(r.error);
    }));
    renderMoExtra();
}

// ---- War & chain register (the panel above Rules) ----
// Lists every war and every chain Torn has for us, and each chain goes in exactly one place: a war, a chain
// event, "ignore", or nothing yet. Because a chain lives in one place it can't be counted twice. Every change
// goes to the server (which reads the chain's report with the leader's key and checks it is real); the register
// is then reloaded, and the Member Overview table behind it is reloaded so "Wars OK" and members' own dashboard
// cards show the same numbers. See lib/memberOverview.js (assignChain, mergeLinked) for the counting rules.
let moReg = null;

async function moReload() {
    if (moBusy) { toast('Saved — the page is still loading, press Refresh in a moment to see it.'); return; }
    moData = null;
    await loadMemberOverview();
}

async function moRegLoad() {
    const btn = $('mo-reg-load');
    btn.disabled = true; btn.textContent = 'Loading…';
    try {
        const r = await moFetch({ action: 'mo-reg-get' });
        if (r.error) throw new Error(r.error);
        moReg = r;
        renderMoReg();
    } catch (e) { toast(e.message); } finally { btn.disabled = false; btn.textContent = 'Reload the register'; }
}

// The small note next to the panel title: chains nobody has placed yet (from the last Member Overview load).
function renderMoExtra() {
    const n = moData?.extra?.unassigned;
    const el = $('mo-reg-warn');
    if (el) el.textContent = n ? `⚠ ${n} chain${n === 1 ? '' : 's'} not placed yet` : '';
}

function renderMoReg() {
    const el = $('mo-extra');
    if (!el || !moReg) return;
    const day = ts => new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
    const wars = moReg.wars, events = moReg.events || [];
    const label = id => { const w = wars.find(x => x.id === id); if (w) return `War vs ${w.opponent} (${day(w.end)})`; const e = events.find(x => x.id === id); return e ? `⛓ ${e.name} (${day(e.end)})` : id; };
    const options = sel => `<option value=""${sel === '' ? ' selected' : ''}>— not placed yet —</option>`
        + `<optgroup label="Wars">${wars.map(w => `<option value="${esc(w.id)}"${sel === w.id ? ' selected' : ''}>${esc(label(w.id))}</option>`).join('')}</optgroup>`
        + (events.length ? `<optgroup label="Chain events">${events.map(e => `<option value="${esc(e.id)}"${sel === e.id ? ' selected' : ''}>${esc(label(e.id))}</option>`).join('')}</optgroup>` : '')
        + `<option value="ignore"${sel === 'ignore' ? ' selected' : ''}>Ignore (don't count)</option>`;
    const pending = moReg.chains.filter(c => !c.target && c.suggest);
    $('mo-reg-accept').style.display = pending.length ? '' : 'none';
    $('mo-reg-accept').textContent = `Accept all suggestions (${pending.length})`;
    el.innerHTML = `<div style="overflow-x:auto;"><table style="width:100%;font-size:13px;border-collapse:collapse;">
        <thead><tr style="color:var(--muted);text-align:left;"><th style="padding:4px 8px;">Chain</th><th style="padding:4px 8px;">Date</th><th style="padding:4px 8px;">Hits</th><th style="padding:4px 8px;">Belongs to</th></tr></thead>
        <tbody>${moReg.chains.map(c => `<tr style="border-top:1px solid var(--line);${c.target ? '' : 'background:var(--bench-2);'}">
            <td style="padding:4px 8px;font-family:var(--mono);"><a href="https://www.torn.com/war.php?step=chainreport&chainID=${esc(c.id)}" target="_blank" rel="noopener" style="color:var(--text);">#${esc(c.id)}</a></td>
            <td style="padding:4px 8px;color:var(--muted);white-space:nowrap;">${day(c.start)} → ${day(c.end)}</td>
            <td style="padding:4px 8px;font-family:var(--mono);">${c.length ?? '?'}</td>
            <td style="padding:4px 8px;"><select class="mo-reg-sel" data-chain="${esc(c.id)}" style="font-size:12px;padding:2px 4px;width:auto;max-width:260px;">${options(c.target)}</select>
                ${c.suggest ? `<span style="color:var(--muted);font-size:11px;">suggested: ${esc(label(c.suggest))}</span> <button class="ghost small mo-reg-accept1" data-chain="${esc(c.id)}" data-target="${esc(c.suggest)}">Accept</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="4" style="color:var(--muted);padding:8px;">Torn returned no completed chains.</td></tr>'}</tbody>
    </table></div>
    <div style="color:var(--muted);font-size:11px;margin-top:6px;">Shows the latest 100 chains.</div>`;

    const assign = async (chainId, target) => {
        const r = await moFetch({ action: 'mo-reg-assign', chainId, target });
        if (r.error) { toast(r.error); return false; }
        const row = moReg.chains.find(c => c.id === chainId);
        if (row) { row.target = target; row.suggest = null; }
        return true;
    };
    el.onchange = async ev => {
        const t = ev.target;
        if (!t.classList.contains('mo-reg-sel')) return;
        t.disabled = true;
        const ok = await assign(t.dataset.chain, t.value);
        renderMoReg();
        if (ok) moReload();
    };
    el.onclick = async ev => {
        const t = ev.target;
        if (!t.classList.contains('mo-reg-accept1')) return;
        t.disabled = true;
        const ok = await assign(t.dataset.chain, t.dataset.target);
        renderMoReg();
        if (ok) moReload();
    };
    $('mo-reg-accept').onclick = async () => {
        const btn = $('mo-reg-accept'); btn.disabled = true;
        for (const c of pending) { if (!(await assign(c.id, c.suggest))) break; }
        btn.disabled = false;
        renderMoReg();
        moReload();
    };
}

$('mo-reg-load').addEventListener('click', moRegLoad);

$('mo-ev-add').addEventListener('click', async () => {
    const r = await moFetch({ action: 'mo-event-save', name: $('mo-ev-name').value, date: $('mo-ev-date').value });
    if (r.error) { toast(r.error); return; }
    $('mo-ev-name').value = '';
    toast('Chain event added — you can now pick it in the register\'s dropdowns.');
    await moRegLoad();
});

$('mo-period').addEventListener('change', () => { moPeriodId = $('mo-period').value; renderMemberOverview(); loadMemberOverview(); });
$('mo-custom-weeks').addEventListener('change', () => {
    moCustomWeeks = Math.min(26, Math.max(1, Number($('mo-custom-weeks').value) || 4));
    renderMemberOverview(); loadMemberOverview();
});
$('mo-view-total').addEventListener('click', () => { moPerWeek = false; renderMemberOverview(); });
$('mo-view-week').addEventListener('click', () => { moPerWeek = true; renderMemberOverview(); });
$('mo-refresh').addEventListener('click', () => { moData = null; loadMemberOverview(); });

$('mo-save-settings').addEventListener('click', async () => {
    const r = await moFetch({ action: 'mo-settings', minWarHits: $('mo-min').value, minChainHits: $('mo-minchain').value, needWars: $('mo-need').value });
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
        $('mo-probe-out').textContent = `Torn stats about gym/energy/drinks/xanax on your account (${r.statKeys} stats in total):\n${stats}\n\nGym log types: ${JSON.stringify(r.gymTypes || {})}\nKey access level: ${r.keyInfo}
Newer stats endpoint: ${r.v2Error ? `error: ${r.v2Error}` : `extra names: ${(r.v2Extra || []).join(", ") || "(none)"}
Gym/energy-like values: ${JSON.stringify(r.v2Gym || {})}`}
Gym log sample (v2): ${r.gymSampleV2}
Gym log sample: ${r.gymError ? `(error: ${r.gymError})` : (r.gymSample || '(none)')}\n\nAll stat names: ${(r.allKeys || []).join(', ')}\n\nArmory lines mentioning blood bags (last 3 days):\n${r.bloodLines.join('\n') || '(none)'}`;
        $('mo-probe-out').style.display = 'block';
    } catch (e) { toast(e.message); } finally { btn.disabled = false; btn.textContent = 'Check what Torn offers'; }
});

$('mo-date-from').addEventListener('change', () => { if ($('mo-date-from').value) { moDates.from = $('mo-date-from').value; renderMemberOverview(); loadMemberOverview(); } });
$('mo-date-to').addEventListener('change', () => { if ($('mo-date-to').value) { moDates.to = $('mo-date-to').value; renderMemberOverview(); loadMemberOverview(); } });

$('mo-probe-upg-btn').addEventListener('click', async () => {
    const btn = $('mo-probe-upg-btn'); btn.disabled = true; btn.textContent = 'Checking…';
    try {
        const r = await moFetch({ action: 'mo-probe-upgrades' });
        if (r.error) throw new Error(r.error);
        $('mo-probe-upg-out').textContent = `Faction gym totals (v2 faction stats):\n${r.fstats}\n\nNew endpoint (v2 faction upgrades):\n${r.v2}\n\nChallenge contributors (which stat names Torn accepts):\n${Object.entries(r.contrib || {}).map(([k, v]) => `${k}: ${v}`).join('\n')}`;
        $('mo-probe-upg-out').style.display = 'block';
    } catch (e) { toast(e.message); } finally { btn.disabled = false; btn.textContent = 'Check faction upgrades'; }
});

$('mo-import-btn').addEventListener('click', async () => {
    const out = $('mo-import-out'), btn = $('mo-import-btn');
    btn.disabled = true; btn.textContent = 'Importing…'; out.textContent = '';
    try {
        const r = await moFetch({ action: 'mo-energy-import', text: $('mo-import-text').value });
        if (r.error) throw new Error(r.error);
        out.style.color = r.matched ? 'var(--reagent)' : 'var(--danger)';
        out.textContent = r.matched
            ? `✓ Imported ${r.matched} member${r.matched === 1 ? '' : 's'}, ${r.days} days${r.todayIncluded ? ', including today so far' : ''}.${r.skipped ? ` (${r.skipped} day rows left out: we count those days ourselves.)` : ''}${r.unmatched.length ? ` Not recognised: ${r.unmatched.join(', ')}.` : ''} Paste the next member whenever you like.`
            : `Nothing imported — no member with day-by-day rows was recognised${r.unmatched.length ? ` (${r.unmatched.join(', ')})` : ''}. Make sure the member is opened in Intel so the day rows are included.`;
        if (r.matched) { $('mo-import-text').value = ''; moEnergy = null; loadMemberOverview(); }
    } catch (e) { out.style.color = 'var(--danger)'; out.textContent = e.message; }
    finally { btn.disabled = false; btn.textContent = 'Import this member'; }
});

// How many calls WWL made to Torn with THIS key (kept by lib/tornFetch.js): the last two hours per minute, and today's calls per kind.
$('mo-usage-btn').addEventListener('click', async () => {
    const out = $('mo-usage-out');
    out.style.display = 'block'; out.textContent = 'Loading…';
    const r = await moFetch({ action: 'torn-usage' });
    if (r.error) { out.textContent = r.error; return; }
    const per = r.perMinute || [];
    const total = per.reduce((s, m) => s + m.n, 0);
    const peak = per.reduce((b, m) => (m.n > b.n ? m : b), { n: 0, minute: '' });
    const busy = per.filter(m => m.n >= 60).length;
    const at = m => (m ? `${m.slice(6, 8)}/${m.slice(4, 6)} ${m.slice(8, 10)}:${m.slice(10, 12)} UTC` : '—');
    const kinds = o => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, n]) => `  ${String(n).padStart(5)}  ${k}`).join('\n') || '  (nothing yet)';
    out.textContent = `Last 2 hours: ${total} calls with your key\nBusiest minute: ${peak.n} calls (${at(peak.minute)}) — Torn allows about 100 a minute for all your tools together\nMinutes with 60+ calls: ${busy}\n\nToday, per kind ("saved" = answered from memory, no call to Torn) — estimates, only 1 call in 10 is recorded to save database writes, so expect steps of 10:\n${kinds(r.today)}\n\nYesterday:\n${kinds(r.yesterday)}`;
});
