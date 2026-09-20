// perk-countdown.js — the "Steadfast countdown" card on the dashboard: per stat, how much of the faction's
// challenge ("spend N energy on <stat> training") is done before the next Steadfast level can be bought, and
// the rule "upgrade only when all are done". Everyone sees it; leaders also get the link of the picture for
// the faction announcement and can set a goal by hand for a level whose goal isn't known yet.
// Backend: lib/steadfast.js. The numbers come from Torn by themselves, whenever a leader opens WWL.
'use strict';

const PC_LABEL = { strength: 'Strength', defense: 'Defense', speed: 'Speed', dexterity: 'Dexterity' };
const PC_COLOR = { strength: '#3b6fd4', defense: '#e5531d', speed: '#f5a30b', dexterity: '#1f9d3a' };
let pcCountdown = null;

async function pcFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}

// Leaders refresh from Torn (the server does it at most every 20 minutes); everyone else reads the stored copy.
async function loadSteadfastCard() {
    const panel = $('dash-steadfast-panel');
    const leader = typeof isLeaderCached !== 'undefined' && isLeaderCached;
    let r = leader ? await pcFetch({ action: 'steadfast-refresh' }) : await pcFetch({ action: 'steadfast-get' });
    if (r.error && leader) r = await pcFetch({ action: 'steadfast-get' }); // a refresh problem must not hide the stored numbers
    if (r.error || !r.countdown) { panel.style.display = 'none'; return; }
    pcCountdown = r.countdown;
    renderSteadfastCard(leader);
    panel.style.display = 'block';
}

function renderSteadfastCard(leader) {
    const cd = pcCountdown;
    const n = v => Math.round(v).toLocaleString();
    $('pc-rows').innerHTML = cd.rows.map(r => {
        const pct = r.goal ? Math.min(100, r.total / r.goal * 100) : 0;
        return `<div style="margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;gap:10px;font-size:14px;"><b style="color:${PC_COLOR[r.stat]};">${PC_LABEL[r.stat]}</b>
                <span style="font-family:var(--mono);">${r.goal ? `${n(r.total)} / ${n(r.goal)}` : `${n(r.total)} energy`}</span></div>
            ${r.goal ? `<div style="background:var(--bench-2);border-radius:4px;height:8px;margin:5px 0;"><div style="width:${pct.toFixed(1)}%;background:${r.done ? 'var(--reagent)' : 'rgba(240,180,50,.45)'};height:8px;border-radius:4px;"></div></div>` : ''}
            <div style="font-size:12px;color:var(--muted);">${r.goal
                ? (r.done ? '<span style="color:var(--reagent);">Challenge done ✓</span>' : `<b style="color:var(--text);">${n(r.remaining)} energy to go</b>${r.etaDays ? ` — about ${r.etaDays} day${r.etaDays === 1 ? '' : 's'} at the recent pace` : ''}`)
                : 'Goal not known yet.'}</div></div>`;
    }).join('');
    $('pc-summary').innerHTML = cd.allDone
        ? '<b style="color:var(--reagent);">All challenges are done — time to upgrade! 🎉</b>'
        : cd.waiting.length ? `We upgrade when <b>all</b> are done. Still waiting for: <b style="color:#f0b432;">${cd.waiting.map(s => PC_LABEL[s]).join(', ')}</b>.` : '';
    $('pc-updated').textContent = `Numbers from ${new Date(cd.at * 1000).toLocaleString()}`;
    $('pc-leader').style.display = leader ? 'block' : 'none';
    if (leader) {
        pcLoadNightly();
        cd.rows.forEach(r => { const el = $(`pc-goal-${r.stat}`); if (document.activeElement !== el) el.value = ''; el.placeholder = r.goal ? n(r.goal) : 'goal'; });
    }
}

$('pc-share').addEventListener('click', async () => {
    const r = await pcFetch({ action: 'steadfast-share' });
    if (r.error) { toast(r.error); return; }
    const url = `${window.location.origin}/steadfast/${r.token}.png`; // ends in .png, like YATA posters, so Torn accepts it as a picture
    $('pc-share-url').value = url;
    $('pc-share-img').src = url;
    $('pc-share-out').style.display = 'block';
});
$('pc-copy').addEventListener('click', () => navigator.clipboard.writeText($('pc-share-url').value).then(() => toast('Image link copied')));
$('pc-goals-save').addEventListener('click', async () => {
    const goals = {};
    ['strength', 'defense', 'speed', 'dexterity'].forEach(s => { const v = Number($(`pc-goal-${s}`).value.replace(/[^\d]/g, '')); if (v > 0) goals[s] = v; });
    const r = await pcFetch({ action: 'steadfast-goals-save', goals });
    if (r.error) { toast(r.error); return; }
    pcCountdown = r.countdown; renderSteadfastCard(true);
    toast('Goals saved');
});

// ---- nightly saving (leaders): switched on from here, with the leader's own key, kept encrypted on the server ----
async function pcLoadNightly() {
    const r = await pcFetch({ action: 'nightly-status' });
    if (r.error) { $('pc-nightly-status').textContent = ''; return; }
    const when = ts => new Date(ts * 1000).toLocaleString();
    $('pc-nightly-status').innerHTML = r.enabled
        ? `<span style="color:var(--reagent);font-weight:700;">ON</span> — switched on by ${esc(r.by || 'a leader')} (${when(r.since)}). Last run: ${r.lastRun ? when(r.lastRun) : 'not yet'} ${r.lastOk === false ? `<span style="color:var(--danger);">✗ ${esc(r.lastError || 'failed')} — turn it on again with a working key</span>` : r.lastOk ? '✓' : ''}`
        : '<span style="color:var(--muted);">OFF — the counters are only saved when a leader opens WWL.</span>';
    $('pc-nightly-on').style.display = r.enabled ? 'none' : 'inline-block';
    $('pc-nightly-off').style.display = r.enabled ? 'inline-block' : 'none';
}
$('pc-nightly-on').addEventListener('click', async () => {
    if (!confirm('Turn on nightly saving?\n\nYour API key is kept ENCRYPTED on the WorldWideLabs server and used once a night only to read the faction\'s gym counters and upgrade levels (the same things the app reads when you open it). It is never shown to anyone. You can turn it off here at any time, or delete the key in Torn to stop it.')) return;
    const btn = $('pc-nightly-on'); btn.disabled = true;
    const r = await pcFetch({ action: 'nightly-enable' });
    btn.disabled = false;
    if (r.error) { toast(`Couldn't turn it on: ${r.error}`); return; }
    toast('Nightly saving is on'); pcLoadNightly();
});
$('pc-nightly-off').addEventListener('click', async () => {
    if (!confirm('Turn nightly saving off? The counters are then only saved when a leader opens WWL.')) return;
    const r = await pcFetch({ action: 'nightly-disable' });
    if (r.error) { toast(r.error); return; }
    toast('Nightly saving is off'); pcLoadNightly();
});
