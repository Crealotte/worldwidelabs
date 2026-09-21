// extended-search.js — WorldWideLabs Extended Search (leadership only).
// Same FFScouter search foundation as Target Finder, but with an extra refinement pass for
// filters FFScouter's own API doesn't support (account age, "in a faction only") — each
// candidate gets a real Torn profile lookup, paced to stay clear of the rate limit. That extra
// cost per search is exactly why this stays a separate, leader-gated tool rather than living
// in the member-facing Target Finder.
'use strict';

let esResults = [];

function esStatus(msg, isErr) {
    const el = $('es-status');
    el.className = 'status ' + (msg ? (isErr ? 'err' : 'ok') : '');
    el.textContent = msg || '';
}

function updateEsRefineNote() {
    const active = $('es-minage').value || $('es-maxage').value || $('es-faction-status').value === 'in';
    $('es-refine-note').style.display = active ? 'block' : 'none';
}
$('es-minage').addEventListener('input', updateEsRefineNote);
$('es-maxage').addEventListener('input', updateEsRefineNote);
$('es-faction-status').addEventListener('change', updateEsRefineNote);

$('es-search-btn').addEventListener('click', async () => {
    const btn = $('es-search-btn');
    btn.disabled = true; btn.textContent = 'Searching…';
    esStatus('');
    try {
        const params = new URLSearchParams({
            key: apiKey,
            minlevel: $('es-minlevel').value || 1,
            maxlevel: $('es-maxlevel').value || 100,
            minff: parseFloat($('es-minff').value || 1).toFixed(2),
            maxff: parseFloat($('es-maxff').value || 3).toFixed(2),
            limit: Math.min(50, Math.max(1, parseInt($('es-limit').value, 10) || 20)),
            inactiveonly: $('es-inactive').checked ? 1 : 0,
            factionless: $('es-factionless').checked ? 1 : 0,
        });
        const res = await fetch(`https://ffscouter.com/api/v1/get-targets?${params.toString()}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        let rows = (data.targets || []).map(t => ({
            id: t.player_id, name: t.name || `User #${t.player_id}`, level: t.level,
            ff: t.fair_fight, estHuman: t.bs_estimate_human, lastAction: t.last_action,
        }));

        const minAge = $('es-minage').value ? Number($('es-minage').value) : null;
        const maxAge = $('es-maxage').value ? Number($('es-maxage').value) : null;
        const requireInFaction = $('es-faction-status').value === 'in';
        if (minAge != null || maxAge != null || requireInFaction) {
            esStatus(`Found ${rows.length} candidates — checking real profiles for age/faction status…`, false);
            const refined = [];
            for (const r of rows) {
                try {
                    const profRes = await fetch(`https://api.torn.com/user/${r.id}?selections=profile&key=${encodeURIComponent(apiKey)}`);
                    const profile = await profRes.json();
                    if (profile.error) throw new Error(profile.error.error);
                    const age = profile.age;
                    const inFaction = !!profile.faction?.faction_id;
                    if (minAge != null && (age == null || age < minAge)) continue;
                    if (maxAge != null && (age == null || age > maxAge)) continue;
                    if (requireInFaction && !inFaction) continue;
                    refined.push({ ...r, age, factionName: profile.faction?.faction_name || null });
                } catch (e) { /* skip this candidate on lookup failure, keep going */ }
                await new Promise(res2 => setTimeout(res2, 1100));
            }
            rows = refined;
        }

        esResults = rows;
        renderEsResults();
        esStatus(`${rows.length} target(s) found.`, false);
    } catch (e) {
        esStatus(e.message, true);
    } finally {
        btn.disabled = false; btn.textContent = 'Search';
    }
});

function renderEsResults() {
    $('es-results-panel').style.display = 'block';
    $('es-results-body').innerHTML = esResults.length ? esResults.map(r => `
        <tr>
            <td><a href="https://www.torn.com/profiles.php?XID=${r.id}" target="_blank" rel="noopener">${esc(r.name)} [${r.id}]</a>${r.age != null || r.factionName ? `<div style="font-size:11px;color:var(--muted);">${r.age != null ? `${r.age}d old` : ''}${r.age != null && r.factionName ? ' · ' : ''}${r.factionName ? esc(r.factionName) : ''}</div>` : ''}</td>
            <td class="num">${r.level ?? '—'}</td>
            <td class="num" style="font-family:var(--mono);">${r.ff != null ? r.ff.toFixed(2) : '—'}</td>
            <td class="num" style="font-family:var(--mono);">${esc(r.estHuman || '—')}</td>
            <td id="es-st-${r.id}" style="font-size:12px;color:var(--muted);">${relativeTime(r.lastAction)}</td>
            <td><a href="https://www.torn.com/page.php?sid=attack&user2ID=${r.id}" target="_blank" rel="noopener"
                   style="background:var(--reagent);color:#06130d;padding:4px 10px;border-radius:4px;text-decoration:none;font-weight:600;font-size:12px;">Attack</a></td>
        </tr>`).join('') : `<tr><td colspan="6" style="color:var(--muted)">No results.</td></tr>`;
    if (typeof esAutoStatus === 'function') esAutoStatus();
}
