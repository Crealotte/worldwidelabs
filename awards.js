// awards.js — the Awards tracker page: every honor and medal of Torn, which ones you have, how far you are with the others and how long it takes, and the ones you follow
// (they show in the script's To do). Backend: aw-* actions (lib/awards.js); the rule that says what counts for an award is in lib/awardRules.js.
'use strict';

const awState = { items: null, mine: null, stats: null, follow: new Set(), shown: 200, cat: '', sortKey: 'cat', sortDir: 1 };
const AW_SORT_DESC_FIRST = new Set(['circ', 'state', 'goal', 'pct', 'merits']); // a first click on these puts the biggest on top
const AW_INCOME = { nat: ['Natural energy only (720 a day)', 720], refill: ['Natural + the daily refill (870)', 870], xan: ['Natural + 3 Xanax a day (1,470)', 1470], both: ['Natural + refill + 3 Xanax (1,620)', 1620] };
async function awFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}
const awTypeName = { honor: 'Honor', medal: 'Medal', merit: 'Merit' };
const awCatLabel = c => c.charAt(0).toUpperCase() + c.slice(1);
const awCat = i => i.cc || 'Other';
const AW_GROUPS = ['Crimes', 'Drugs', 'Attacks', 'Hospital', 'Faction', 'Items', 'Travel', 'Work', 'Gym', 'Money', 'Competitions', 'Commitment', 'Miscellaneous', 'Hall of Fame'];
const AW_ICON = { Crimes: '🕵️', Drugs: '💊', Attacks: '🎯', Hospital: '🏥', Faction: '✊', Items: '🎒', Travel: '✈️', Work: '🎓', Gym: '🏋️', Money: '💰', Competitions: '🏆', Commitment: '⌛', Miscellaneous: '🏁', 'Hall of Fame': '👑' };
const awVisible = i => i.t !== 'merit' && (!i.old || awHave(i)); // the awards of the old crimes system only show for those who have them
const awIncome = () => { try { return localStorage.getItem('wwl-aw-income') || 'refill'; } catch (e) { return 'refill'; } };

async function loadAwards() {
    const st = $('aw-status');
    st.className = 'status ok'; st.textContent = 'Loading Torn\'s awards… the first time it can take half a minute.';
    try {
        const [cat, mine, prog, fol] = await Promise.all([awFetch({ action: 'aw-catalog' }), awFetch({ action: 'aw-mine' }), awFetch({ action: 'aw-progress' }), awFetch({ action: 'aw-follow-get' })]);
        if (cat.error) throw new Error(cat.error);
        awState.items = cat.items.filter(i => !/^A default honor bar/.test(i.d)); // the bars everybody has are no awards to work for
        // every honor and medal gives 1 merit, but awards with the same goal unlock together: so a goal shared by 2 awards gives 2 merits
        const goalSize = new Map();
        for (const i of cat.items) if (i.t !== 'merit') { const g = i.d.trim().toLowerCase(); goalSize.set(g, (goalSize.get(g) || 0) + 1); }
        for (const i of cat.items) i.m = i.t === 'merit' ? 0 : goalSize.get(i.d.trim().toLowerCase());
        // a medal sits in the category of the honor with the same goal (Bar Breaker and Advanced Buster are both Jail) when the server has no category for it
        const honorCat = new Map();
        for (const i of cat.items) if (i.t === 'honor') honorCat.set(i.d.trim().toLowerCase(), i);
        for (const i of cat.items) { const h = i.t === 'medal' && honorCat.get(i.d.trim().toLowerCase()); if (h && h.cg !== i.cg && (i.cc === 'Other' || !i.cc || i.cg === 'Miscellaneous')) { i.cc = h.cc; i.cg = h.cg; } }
        awState.mine = mine.error ? null : { honors: new Set((mine.honors || []).map(i => 'h' + i)), medals: new Set((mine.medals || []).map(i => 'm' + i)), when: new Map([...(mine.honors || []).map((id, n) => ['h' + id, (mine.hts || [])[n]]), ...(mine.medals || []).map((id, n) => ['m' + id, (mine.mts || [])[n]])]) };
        awState.stats = prog.error ? null : prog.stats;
        awState.air = awState.items.some(i => i.d === 'Own an airstrip' && awHave(i)); // flights are 30% shorter with an airstrip
        awState.follow = new Set(fol.follow || []);
        const problems = [mine.error ? `yours could not be read: ${mine.error}` : '', prog.error ? `your progress could not be read: ${prog.error}` : '', ...(prog.warn || [])].filter(Boolean);
        st.textContent = problems.join(' · '); st.className = problems.length ? 'status err' : 'status';
        $('aw-income').value = awIncome();
        $('aw-dl').style.display = typeof isLeaderCached !== 'undefined' && isLeaderCached ? '' : 'none';
        renderAwards();
    } catch (e) { st.className = 'status err'; st.textContent = e.message; }
}
const awHave = i => !!(awState.mine && (i.t === 'honor' ? awState.mine.honors.has(i.k) : i.t === 'medal' ? awState.mine.medals.has(i.k) : false));
const awDate = i => { const ts = awState.mine && awState.mine.when.get(i.k); if (!ts) return ''; const d = new Date(ts * 1000); return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`; };
const awFmt = n => Number.isFinite(n) ? (Math.abs(n) >= 100 || Number.isInteger(n) ? Math.round(n) : Math.round(n * 10) / 10).toLocaleString('en-US') : '';

// how far an award is: { cur, goal, pct (0..1), left (days, Infinity when it never moves, null when there is no estimate), how (explanation of the time) }, or null when it cannot be measured
function awCalc(i) {
    const rl = i.rl, stats = awState.stats;
    if (!rl || !stats) return null;
    const parts = rl.p || [[rl.s, rl.g]], d = rl.d || 1;
    let remaining = 0, cur = 0, goal = 0;
    for (const [s, g] of parts) {
        const raw = stats[s];
        if (typeof raw !== 'number') return null;
        const v = Math.min(raw / d, parts.length > 1 ? g : Infinity); // with several goals, what is beyond a goal does not count for the others
        cur += v; goal += g; remaining += Math.max(0, g - v);
    }
    const pct = Math.min(1, cur / goal);
    if (remaining <= 0) return { cur, goal, pct: 1, left: 0, how: '' };
    let left = null, how = '';
    const e = rl.e, inc = AW_INCOME[awIncome()][1], f = awFmt;
    const days = (perDay, text) => { left = perDay > 0 ? remaining / perDay : Infinity; how = perDay > 0 ? `${f(remaining)} to go. ${text}` : `${f(remaining)} to go, but this has not happened at all yet, so there is nothing to base a time on.`; };
    if (e && e.m === 'energy') days(inc / e.per, `${e.per} energy each, ${f(inc)} energy a day = ${f(inc / e.per)} a day (every action counted as a success).`);
    else if (e && e.m === 'nerve') days(288 / e.per, `${e.per} nerve each, 288 nerve a day (1 per 5 minutes) = ${f(288 / e.per)} a day.`);
    else if (e && e.m === 'fixed') days(e.perDay, `About ${f(e.perDay)} a day.`);
    else if (e && e.m === 'flight') { const mult = awState.air ? 0.7 : 1, trip = 2 * e.min * mult; days(1440 / trip, `A round trip takes ${f(trip)} minutes${awState.air ? ' (30% shorter, because you own an airstrip)' : ''}, back to back = ${f(1440 / trip)} a day.`); }
    else if (e && e.m === 'cooldown') days(1440 / e.min, `One every ${e.min} minutes (the cooldown) = ${f(1440 / e.min)} a day.`);
    else if (e && e.m === 'calendar') { left = remaining; how = `${f(remaining)} days have to pass.`; }
    else if (e && e.m === 'rate') { const age = stats.age; if (age > 0) days(cur / age, `At your pace over the ${f(age)} days since you joined (${f(cur / age * 100) / 100} a day).`); }
    else if (e && e.m === 'share') {
        const base = stats[e.base];
        if (base > 0) days(cur / base * (inc / e.per) * e.mult, `Of what you did so far this grows in step with ${e.base.endsWith('won') ? 'the attacks you win' : 'the rounds you fire'}, and you can do ${f(inc / e.per)} of those a day.`);
    }
    return { cur, goal, pct, left, how };
}
const awLeftText = c => c.left == null ? '' : c.left <= 0 ? '' : !Number.isFinite(c.left) ? '∞' : c.left < 1 ? '<1' : c.left < 100 ? (Math.round(c.left * 10) / 10).toString() : Math.round(c.left).toLocaleString('en-US');

function awFiltered() {
    const q = $('aw-q').value.trim().toLowerCase(), type = $('aw-type').value, showDone = $('aw-done').checked, onlyFollow = $('aw-onlyfollow').checked, multi = $('aw-multi').checked;
    let list = awState.items.filter(i => (type ? i.t === type && (i.t === 'merit' || awVisible(i)) : awVisible(i)) && (!awState.cat || i.cg === awState.cat) && (!q || `${i.n} ${i.d}`.toLowerCase().includes(q)) && (showDone || !awHave(i)) && (!onlyFollow || awState.follow.has(i.k)) && (!multi || i.m > 1));
    for (const i of list) i.calc = awHave(i) ? { pct: 1, left: 0, how: '' } : awCalc(i);
    const key = awState.sortKey, dir = awState.sortDir, text = (a, b) => String(a).localeCompare(String(b));
    const val = { cat: i => awCat(i), name: i => i.n, desc: i => i.d, circ: i => i.r, merits: i => i.m, state: i => i.calc && i.calc.cur != null ? i.calc.cur : -1, goal: i => i.calc && i.calc.goal != null ? i.calc.goal : -1, pct: i => i.calc ? i.calc.pct : -1, left: i => i.calc && i.calc.left > 0 ? i.calc.left : Infinity }[key];
    const textual = key === 'cat' || key === 'name' || key === 'desc';
    list = list.slice().sort((a, b) => {
        const x = val(a), y = val(b);
        const c = textual ? text(x, y) : x === y ? 0 : x < y ? -1 : 1;
        return (c * dir) || text(awCat(a), awCat(b)) || text(a.n, b.n);
    });
    return list;
}
function renderCards() {
    const groups = new Map(AW_GROUPS.map(g => [g, { total: 0, done: 0 }])), all = { total: 0, done: 0 };
    for (const i of awState.items) {
        if (!awVisible(i)) continue;
        const x = groups.get(i.cg) || groups.get('Miscellaneous');
        x.total++; all.total++;
        if (awHave(i)) { x.done++; all.done++; }
    }
    const chip = (key, label, icon, x) => { const on = awState.cat === key; return `<button type="button" class="aw-card" data-cat="${esc(key)}" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;padding:6px 12px;border-radius:999px;border:1px solid ${on ? 'var(--reagent)' : 'transparent'};background:${on ? 'rgba(53,217,155,.12)' : 'transparent'};color:${on ? 'var(--reagent)' : 'inherit'};font-size:14px;"><span>${icon}</span><span>${esc(label)}${x ? ` (${x.done}/${x.total})` : ''}</span></button>`; };
    const order = AW_GROUPS.filter(g => g !== 'Hall of Fame' && groups.get(g).total);
    $('aw-cards').innerHTML = order.map(g => chip(g, g, AW_ICON[g], groups.get(g))).join('') + chip('', 'All Awards', '🏅', all) + (groups.get('Hall of Fame').total ? chip('Hall of Fame', 'Hall of Fame', AW_ICON['Hall of Fame'], groups.get('Hall of Fame')) : '');
}
function renderAwards() {
    if (!awState.items) return;
    renderCards();
    for (const th of $('aw-body').closest('table').querySelectorAll('.aw-th')) th.querySelector('.aw-arrow').textContent = th.dataset.sort === awState.sortKey ? (awState.sortDir > 0 ? ' ▲' : ' ▼') : '';
    const list = awFiltered(), shown = list.slice(0, awState.shown);
    $('aw-count').textContent = `${list.length} award${list.length === 1 ? '' : 's'}${awState.mine ? `, you have ${awState.items.filter(i => awVisible(i) && awHave(i)).length} of ${awState.items.filter(awVisible).length}` : ''}, you follow ${awState.follow.size}`;
    $('aw-body').innerHTML = shown.map(i => {
        const c = i.calc, have = awHave(i), pctNum = c ? Math.floor(c.pct * 100) : null;
        const prog = have ? '<span style="color:var(--reagent);">✓ Done</span>' : c ? `<div style="display:flex;align-items:center;gap:6px;justify-content:flex-end;"><div style="width:60px;height:6px;background:rgba(127,127,127,.25);border-radius:3px;"><div style="height:6px;width:${pctNum}%;background:var(--reagent);border-radius:3px;"></div></div><span>${pctNum}%</span></div>` : '';
        return `<tr style="${have ? 'opacity:.55;' : ''}"><td style="white-space:nowrap;">${esc(awCat(i))}</td><td style="font-weight:600;">${esc(i.n)}${i.t !== 'honor' ? ` <span style="color:var(--muted);font-size:11px;">${awTypeName[i.t]}</span>` : ''}</td><td class="num" title="${esc(i.y || '')}">${i.r ? i.r.toLocaleString('en-US') : ''}</td><td style="white-space:normal;min-width:240px;">${esc(i.d)}</td>
        <td class="num">${c && !have && c.cur != null ? awFmt(c.cur) : ''}</td><td class="num">${c && !have && c.goal != null ? awFmt(c.goal) : ''}</td><td class="num">${prog}</td><td class="num" title="${esc(c ? c.how : '')}">${have ? awDate(i) : c ? awLeftText(c) : ''}</td>
        <td class="num" style="${i.m > 1 ? 'font-weight:700;color:var(--reagent);' : ''}">${i.m || ''}</td>
        <td style="text-align:center;"><button type="button" class="ghost small aw-pin" data-k="${esc(i.k)}" title="${awState.follow.has(i.k) ? 'Stop following' : 'Follow: it shows in your script To do'}" style="padding:2px 8px;${awState.follow.has(i.k) ? 'color:var(--reagent);border-color:var(--reagent);' : ''}">${awState.follow.has(i.k) ? '📌' : '📍'}</button></td></tr>`;
    }).join('') || '<tr><td colspan="10" style="color:var(--muted);">Nothing matches.</td></tr>';
    $('aw-more').style.display = list.length > shown.length ? '' : 'none';
    $('aw-more').textContent = `Show more (${list.length - shown.length} left)`;
}
$('aw-body').addEventListener('click', async e => {
    const b = e.target.closest('.aw-pin');
    if (!b) return;
    const k = b.dataset.k, on = !awState.follow.has(k);
    b.disabled = true;
    const r = await awFetch({ action: 'aw-follow-set', id: k, on });
    b.disabled = false;
    if (r.error) { toast(r.error); return; }
    awState.follow = new Set(r.follow);
    renderAwards();
});
$('aw-body').closest('table').querySelector('thead').addEventListener('click', e => {
    const th = e.target.closest('.aw-th');
    if (!th) return;
    const k = th.dataset.sort;
    if (awState.sortKey === k) awState.sortDir = -awState.sortDir;
    else { awState.sortKey = k; awState.sortDir = AW_SORT_DESC_FIRST.has(k) ? -1 : 1; }
    awState.shown = 200;
    renderAwards();
});
$('aw-cards').addEventListener('click', e => {
    const b = e.target.closest('.aw-card');
    if (!b) return;
    awState.cat = b.dataset.cat === awState.cat ? '' : b.dataset.cat; awState.shown = 200;
    renderAwards();
});
['aw-q', 'aw-type', 'aw-done', 'aw-onlyfollow', 'aw-multi'].forEach(id => $(id).addEventListener(id === 'aw-q' ? 'input' : 'change', () => { awState.shown = 200; renderAwards(); }));
$('aw-income').innerHTML = Object.entries(AW_INCOME).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('');
$('aw-income').addEventListener('change', () => { try { localStorage.setItem('wwl-aw-income', $('aw-income').value); } catch (e) { /* only a convenience */ } renderAwards(); });
$('aw-more').addEventListener('click', () => { awState.shown += 200; renderAwards(); });
$('aw-dl').addEventListener('click', () => { // the catalog as a file (for leaders): the list of all awards as Torn gives it
    const blob = new Blob([JSON.stringify(awState.items, null, 1)], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'torn-awards.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
