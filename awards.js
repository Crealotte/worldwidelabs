// awards.js — the Awards tracker page: every honor and medal of Torn, which ones you have, how far you are with the others and how long it takes, and the ones you follow
// (they show in the script's To do). Backend: aw-* actions (lib/awards.js); the rule that says what counts for an award is in lib/awardRules.js.
'use strict';

const awState = { items: null, mine: null, stats: null, follow: new Set(), shown: 200, cat: '' };
const AW_INCOME = { nat: ['Natural energy only (720 a day)', 720], refill: ['Natural + the daily refill (870)', 870], xan: ['Natural + 3 Xanax a day (1,470)', 1470], both: ['Natural + refill + 3 Xanax (1,620)', 1620] };
async function awFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}
const awTypeName = { honor: 'Honor', medal: 'Medal', merit: 'Merit' };
// the medals' categories get the honors' names, so the cards group them together
const awCatMap = { combat: 'attacking', crime: 'crimes', miscellaneous: 'misc', networth: 'money' };
const awCat = i => { const c = i.cc || String(i.c || 'other').toLowerCase(); return awCatMap[c] || c; };
const awCatLabel = c => c.charAt(0).toUpperCase() + c.slice(1);
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
        // a medal sits in the category of the honor with the same goal (Bar Breaker and Advanced Buster are both Jail)
        const honorCat = new Map();
        for (const i of cat.items) if (i.t === 'honor') honorCat.set(i.d.trim().toLowerCase(), String(i.c).toLowerCase());
        for (const i of cat.items) if (i.t === 'medal') i.cc = honorCat.get(i.d.trim().toLowerCase());
        awState.mine = mine.error ? null : { honors: new Set((mine.honors || []).map(i => 'h' + i)), medals: new Set((mine.medals || []).map(i => 'm' + i)) };
        awState.stats = prog.error ? null : prog.stats;
        awState.follow = new Set(fol.follow || []);
        const problems = [mine.error ? `yours could not be read: ${mine.error}` : '', prog.error ? `your progress could not be read: ${prog.error}` : '', ...(prog.warn || [])].filter(Boolean);
        st.textContent = problems.join(' · '); st.className = problems.length ? 'status err' : 'status';
        $('aw-income').value = awIncome();
        $('aw-dl').style.display = typeof isLeaderCached !== 'undefined' && isLeaderCached ? '' : 'none';
        renderAwards();
    } catch (e) { st.className = 'status err'; st.textContent = e.message; }
}
const awHave = i => !!(awState.mine && (i.t === 'honor' ? awState.mine.honors.has(i.k) : i.t === 'medal' ? awState.mine.medals.has(i.k) : false));
const awFmt = n => Number.isFinite(n) ? (Math.abs(n) >= 100 || Number.isInteger(n) ? Math.round(n) : Math.round(n * 10) / 10).toLocaleString('en-US') : '';

// how far an award is: { cur, goal, pct (0..1), left (days or null), how (explanation of the time) }, or null when it cannot be measured
function awCalc(i) {
    const rl = i.rl, stats = awState.stats;
    if (!rl || !stats) return null;
    const parts = rl.p || [[rl.s, rl.g]], d = rl.d || 1;
    let pct = 1, remaining = 0, cur = 0, goal = 0;
    for (const [s, g] of parts) {
        const raw = stats[s];
        if (typeof raw !== 'number') return null;
        const v = raw / d;
        pct = Math.min(pct, Math.min(1, v / g));
        remaining += Math.max(0, g - v);
        cur = v; goal = g;
    }
    if (parts.length > 1) { cur = null; goal = null; }
    if (remaining <= 0) return { cur, goal, pct: 1, left: 0, how: '' };
    let left = null, how = '';
    const e = rl.e;
    if (e && e.m === 'energy') {
        const inc = AW_INCOME[awIncome()][1];
        left = remaining * e.per / inc;
        how = `${awFmt(remaining)} to go, about ${e.per} energy each = ${awFmt(remaining * e.per)} energy. At ${awFmt(inc)} energy a day that is ${awFmt(left)} days (every action counted as a win).`;
    } else if (e && e.m === 'cooldown') {
        left = remaining * e.min / 1440;
        how = `${awFmt(remaining)} to go, one every ${e.min} minutes (the drug cooldown) = ${awFmt(left)} days.`;
    } else if (e && e.m === 'calendar') {
        left = remaining;
        how = `${awFmt(remaining)} days have to pass.`;
    }
    return { cur, goal, pct, left, how };
}
const awLeftText = c => c.left == null ? '' : c.left <= 0 ? '' : c.left < 1 ? '<1' : c.left < 100 ? (Math.round(c.left * 10) / 10).toString() : Math.round(c.left).toLocaleString('en-US');

function awFiltered() {
    const q = $('aw-q').value.trim().toLowerCase(), type = $('aw-type').value, showDone = $('aw-done').checked, onlyFollow = $('aw-onlyfollow').checked, multi = $('aw-multi').checked;
    let list = awState.items.filter(i => (type ? i.t === type : i.t !== 'merit') && (!awState.cat || awCat(i) === awState.cat) && (!q || `${i.n} ${i.d}`.toLowerCase().includes(q)) && (showDone || !awHave(i)) && (!onlyFollow || awState.follow.has(i.k)) && (!multi || i.m > 1));
    for (const i of list) i.calc = awHave(i) ? { pct: 1, left: 0, how: '' } : awCalc(i);
    const sort = $('aw-sort').value, byCat = (a, b) => awCat(a).localeCompare(awCat(b)) || a.r - b.r;
    const pc = i => i.calc ? i.calc.pct : -1, lf = i => i.calc && i.calc.left > 0 ? i.calc.left : Infinity;
    list = list.slice().sort(sort === 'merits' ? (a, b) => b.m - a.m || byCat(a, b) : sort === 'closest' ? (a, b) => (pc(b) - pc(a)) || byCat(a, b) : sort === 'soonest' ? (a, b) => (lf(a) - lf(b)) || byCat(a, b) : sort === 'rarity' ? (a, b) => a.r - b.r || a.n.localeCompare(b.n) : sort === 'name' ? (a, b) => a.n.localeCompare(b.n) : byCat);
    return list;
}
function renderCards() {
    const cats = new Map();
    for (const i of awState.items) {
        if (i.t === 'merit') continue;
        const c = awCat(i), x = cats.get(c) || { total: 0, done: 0 };
        x.total++; if (awHave(i)) x.done++;
        cats.set(c, x);
    }
    const card = (key, label, x) => { const on = awState.cat === key, p = x.total ? Math.round(100 * x.done / x.total) : 0; return `<button type="button" class="aw-card" data-cat="${esc(key)}" style="text-align:left;cursor:pointer;min-width:120px;padding:8px 12px;border-radius:8px;border:1px solid ${on ? 'var(--reagent)' : 'var(--border, #2a3a35)'};background:${on ? 'rgba(53,217,155,.10)' : 'transparent'};color:inherit;"><div style="font-weight:600;">${esc(label)}</div><div style="font-size:12px;color:var(--muted);">${x.done} / ${x.total}</div><div style="height:4px;background:rgba(127,127,127,.25);border-radius:2px;margin-top:4px;"><div style="height:4px;width:${p}%;background:var(--reagent);border-radius:2px;"></div></div></button>`; };
    const all = { total: 0, done: 0 }; for (const x of cats.values()) { all.total += x.total; all.done += x.done; }
    $('aw-cards').innerHTML = card('', 'All', all) + [...cats.keys()].sort().map(c => card(c, awCatLabel(c), cats.get(c))).join('');
}
function renderAwards() {
    if (!awState.items) return;
    renderCards();
    const list = awFiltered(), shown = list.slice(0, awState.shown);
    $('aw-count').textContent = `${list.length} award${list.length === 1 ? '' : 's'}${awState.mine ? `, you have ${awState.items.filter(awHave).length} of ${awState.items.filter(i => i.t !== 'merit').length}` : ''}, you follow ${awState.follow.size}`;
    $('aw-body').innerHTML = shown.map(i => {
        const c = i.calc, have = awHave(i), pctNum = c ? Math.floor(c.pct * 100) : null;
        const prog = have ? '<span style="color:var(--reagent);">✓ Done</span>' : c ? `<div style="display:flex;align-items:center;gap:6px;justify-content:flex-end;"><div style="width:60px;height:6px;background:rgba(127,127,127,.25);border-radius:3px;"><div style="height:6px;width:${pctNum}%;background:var(--reagent);border-radius:3px;"></div></div><span>${pctNum}%</span></div>` : '';
        return `<tr style="${have ? 'opacity:.55;' : ''}"><td style="white-space:nowrap;">${esc(awCatLabel(awCat(i)))}</td><td style="font-weight:600;">${esc(i.n)}${i.t !== 'honor' ? ` <span style="color:var(--muted);font-size:11px;">${awTypeName[i.t]}</span>` : ''}</td><td class="num" title="${esc(i.y || '')}">${i.r ? i.r.toLocaleString('en-US') : ''}</td><td style="white-space:normal;min-width:240px;">${esc(i.d)}</td>
        <td class="num">${c && !have && c.cur != null ? awFmt(c.cur) : ''}</td><td class="num">${c && !have && c.goal != null ? awFmt(c.goal) : ''}</td><td class="num">${prog}</td><td class="num" title="${esc(c ? c.how : '')}">${c && !have ? awLeftText(c) : ''}</td>
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
$('aw-cards').addEventListener('click', e => {
    const b = e.target.closest('.aw-card');
    if (!b) return;
    awState.cat = b.dataset.cat === awState.cat ? '' : b.dataset.cat; awState.shown = 200;
    renderAwards();
});
['aw-q', 'aw-type', 'aw-done', 'aw-onlyfollow', 'aw-multi', 'aw-sort'].forEach(id => $(id).addEventListener(id === 'aw-q' ? 'input' : 'change', () => { awState.shown = 200; renderAwards(); }));
$('aw-income').innerHTML = Object.entries(AW_INCOME).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('');
$('aw-income').addEventListener('change', () => { try { localStorage.setItem('wwl-aw-income', $('aw-income').value); } catch (e) { /* only a convenience */ } renderAwards(); });
$('aw-more').addEventListener('click', () => { awState.shown += 200; renderAwards(); });
$('aw-dl').addEventListener('click', () => { // the catalog as a file (for leaders): the list of all awards as Torn gives it
    const blob = new Blob([JSON.stringify(awState.items, null, 1)], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'torn-awards.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
