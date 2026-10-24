// awards.js — the Awards tracker page: every honor, medal and merit of Torn, which ones you have, and the ones you follow (they show in the script's To do).
// Backend: aw-* actions (lib/awards.js). Progress per award (state, goal, %, days left) is worked out from your own Torn stats: that comes next.
'use strict';

const awState = { items: null, mine: null, follow: new Set(), shown: 300 };
async function awFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}
const awTypeName = { honor: 'Honor', medal: 'Medal', merit: 'Merit' };
async function loadAwards() {
    const st = $('aw-status');
    st.className = 'status ok'; st.textContent = 'Loading Torn\'s awards… the first time it can take half a minute.';
    try {
        const [cat, mine, fol] = await Promise.all([awFetch({ action: 'aw-catalog' }), awFetch({ action: 'aw-mine' }), awFetch({ action: 'aw-follow-get' })]);
        if (cat.error) throw new Error(cat.error);
        awState.items = cat.items;
        awState.mine = mine.error ? null : { honors: new Set((mine.honors || []).map(i => 'h' + i)), medals: new Set((mine.medals || []).map(i => 'm' + i)) };
        awState.follow = new Set(fol.follow || []);
        const cats = [...new Set(cat.items.map(i => i.c))].sort();
        $('aw-cat').innerHTML = '<option value="">All categories</option>' + cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
        st.textContent = mine.error ? `You can look through the awards, but yours could not be read: ${mine.error}` : ''; st.className = mine.error ? 'status err' : 'status';
        $('aw-dl').style.display = typeof isLeaderCached !== 'undefined' && isLeaderCached ? '' : 'none';
        renderAwards();
    } catch (e) { st.className = 'status err'; st.textContent = e.message; }
}
const awHave = i => !!(awState.mine && (i.t === 'honor' ? awState.mine.honors.has(i.k) : i.t === 'medal' ? awState.mine.medals.has(i.k) : false));
function awFiltered() {
    const q = $('aw-q').value.trim().toLowerCase(), cat = $('aw-cat').value, type = $('aw-type').value, showDone = $('aw-done').checked, onlyFollow = $('aw-onlyfollow').checked;
    let list = awState.items.filter(i => (type ? i.t === type : i.t !== 'merit') && (!cat || i.c === cat) && (!q || `${i.n} ${i.d}`.toLowerCase().includes(q)) && (showDone || !awHave(i)) && (!onlyFollow || awState.follow.has(i.k)));
    const sort = $('aw-sort').value;
    list = list.slice().sort(sort === 'rarity' ? (a, b) => a.r - b.r || a.n.localeCompare(b.n) : sort === 'name' ? (a, b) => a.n.localeCompare(b.n) : (a, b) => a.c.localeCompare(b.c) || a.r - b.r);
    return list;
}
function renderAwards() {
    if (!awState.items) return;
    const list = awFiltered(), shown = list.slice(0, awState.shown);
    $('aw-count').textContent = `${list.length} award${list.length === 1 ? '' : 's'}${awState.mine ? `, you have ${awState.items.filter(awHave).length} of ${awState.items.length}` : ''}, you follow ${awState.follow.size}`;
    $('aw-body').innerHTML = shown.map(i => `<tr style="${awHave(i) ? 'opacity:.55;' : ''}"><td style="white-space:nowrap;">${esc(i.c)}</td><td style="font-weight:600;">${esc(i.n)}${i.t !== 'honor' ? ` <span style="color:var(--muted);font-size:11px;">${awTypeName[i.t]}</span>` : ''}</td><td class="num" title="${esc(i.y || '')}">${i.r ? i.r.toLocaleString('en-US') : ''}</td><td style="white-space:normal;min-width:260px;">${esc(i.d)}</td>
        <td style="text-align:center;"><button type="button" class="ghost small aw-pin" data-k="${esc(i.k)}" title="${awState.follow.has(i.k) ? 'Stop following' : 'Follow: it shows in your script To do'}" style="padding:2px 8px;${awState.follow.has(i.k) ? 'color:var(--reagent);border-color:var(--reagent);' : ''}">${awState.follow.has(i.k) ? '📌' : '📍'}</button></td></tr>`).join('') || '<tr><td colspan="5" style="color:var(--muted);">Nothing matches.</td></tr>';
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
['aw-q', 'aw-cat', 'aw-type', 'aw-done', 'aw-onlyfollow', 'aw-sort'].forEach(id => $(id).addEventListener(id === 'aw-q' ? 'input' : 'change', () => { awState.shown = 300; renderAwards(); }));
$('aw-more').addEventListener('click', () => { awState.shown += 300; renderAwards(); });
$('aw-dl').addEventListener('click', () => { // the catalog as a file (for leaders): the list of all awards as Torn gives it
    const blob = new Blob([JSON.stringify(awState.items, null, 1)], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'torn-awards.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
