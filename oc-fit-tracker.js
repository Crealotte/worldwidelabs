// oc-fit.js — WorldWideLabs OC Fit Tracker page.
'use strict';

let ocfitLoaded = false;
const OCFIT_COLLAPSE_KEY = 'wwl_ocfit_collapsed';

function ocfitGetCollapsed() {
    try { return JSON.parse(localStorage.getItem(OCFIT_COLLAPSE_KEY)) || []; } catch { return []; }
}
function ocfitToggleCollapsed(id) {
    const set = new Set(ocfitGetCollapsed());
    if (set.has(id)) set.delete(id); else set.add(id);
    localStorage.setItem(OCFIT_COLLAPSE_KEY, JSON.stringify([...set]));
    return set.has(id);
}

function ocfitCprColor(cpr) {
    if (cpr == null) return 'var(--muted)';
    if (cpr >= 75) return 'var(--reagent)';
    if (cpr >= 50) return 'var(--happy)';
    return 'var(--danger)';
}

// Same thresholds the original OC Manager script used as sensible defaults.
const OCFIT_WEIGHT_HIGH = 25;
const OCFIT_WEIGHT_LOW = 15;
const OCFIT_CPR_WARN = 70;

// Combines CPR with role weight into a single "does this matter, and am I good at it"
// read — a high CPR in a low-weight role barely helps the crime either way, and a
// mediocre CPR in a high-weight role is exactly where effort is best spent.
function ocfitImpact(cpr, weight) {
    if (weight == null) return null; // unknown importance — no badge, don't guess
    if (weight >= OCFIT_WEIGHT_HIGH) {
        return cpr != null && cpr >= OCFIT_CPR_WARN
            ? { label: '⭐ High-impact fit', color: 'var(--reagent)', bg: 'rgba(53,217,155,.15)' }
            : { label: '⚠ High-impact — needs work', color: 'var(--danger)', bg: 'rgba(230,90,60,.15)' };
    }
    if (weight <= OCFIT_WEIGHT_LOW) {
        return { label: 'Low-impact', color: 'var(--muted)', bg: 'var(--bench-2)' };
    }
    return null; // moderate weight — not worth a badge, avoids visual noise
}

// Sort key blending fit and importance — unknown weight treated as moderate so it
// doesn't unfairly sink to the bottom or jump to the top of the list.
function ocfitSortScore(entry) {
    const w = entry.weight ?? 20;
    const c = entry.cpr ?? 0;
    return c * w;
}

function ocfitAgo(ts) {
    if (!ts) return 'never';
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

async function loadOcFit() {
    const st = $('ocfit-status');
    st.className = 'status ok'; st.textContent = 'Checking your current OCs…';
    try {
        const res = await fetch('/api/oc-fit', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: apiKey, action: 'read' }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        renderOcFit(data.catalog || []);
        st.textContent = ''; st.className = 'status';
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
        $('ocfit-body').innerHTML = '<p style="color:var(--muted)">Could not load your OC fit data yet.</p>';
    }
}

$('ocfit-refresh').addEventListener('click', () => { ocfitLoaded = false; loadOcFit(); });

async function loadOcFitTeamBuilder() {
    if (!isLeaderCached) { $('ocfit-team-panel').style.display = 'none'; return; }
    $('ocfit-team-panel').style.display = 'block';
    $('ocfit-team-body').innerHTML = '<p style="color:var(--muted);">Loading…</p>';
    try {
        const res = await fetch('/api/oc-fit', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: apiKey, action: 'team-builder' }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        renderOcFitTeamBuilder(data.openSlots || []);
    } catch (e) {
        $('ocfit-team-body').innerHTML = `<p style="color:var(--muted);">${esc(e.message)}</p>`;
    }
}

function renderOcFitTeamBuilder(openSlots) {
    const body = $('ocfit-team-body');
    if (!openSlots.length) {
        body.innerHTML = '<p style="color:var(--muted);">No open slots right now.</p>';
        return;
    }
    body.innerHTML = openSlots.map(slot => {
        const candidatesHtml = slot.candidates.length
            ? slot.candidates.map(c => {
                const badge = c.live
                    ? `<span class="ocfit-live-badge" style="background:rgba(53,217,155,.15);color:var(--reagent);">live</span>`
                    : `<span class="ocfit-live-badge" style="background:var(--bench-2);color:var(--muted);">cached · ${esc(ocfitAgo(c.lastSeenLive))}</span>`;
                return `<div style="display:flex;align-items:center;gap:10px;padding:5px 0;">
                    <span style="flex:1;">${esc(c.name)}</span>
                    <span class="ocfit-cpr" style="color:${ocfitCprColor(c.cpr)};font-family:var(--mono);font-weight:700;">${Math.round(c.cpr)}%</span>
                    ${badge}
                </div>`;
            }).join('')
            : '<p style="color:var(--muted);font-size:12px;margin:4px 0;">No opted-in members have fit data for this role yet.</p>';

        const weightText = slot.weight != null ? `${Math.round(slot.weight)}% weight` : 'weight unknown';
        const riskyBadge = slot.risky
            ? `<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:rgba(230,90,60,.15);color:var(--danger);white-space:nowrap;">⚠ high-impact, weak coverage</span>`
            : '';

        return `
            <div style="border-top:1px solid var(--line);padding-top:12px;margin-top:12px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
                    <b>${esc(slot.role)}</b>
                    <span style="color:var(--muted);font-size:12px;">in ${esc(slot.scenario)} · Difficulty ${esc(slot.difficulty)} · ${esc(weightText)}</span>
                    ${riskyBadge}
                </div>
                ${candidatesHtml}
            </div>`;
    }).join('');
}

function renderOcFit(catalog) {
    const body = $('ocfit-body');
    if (!catalog.length) {
        body.innerHTML = `<div class="panel"><p style="color:var(--muted);margin:0;">
            Nothing observed yet — this fills itself in automatically once your faction has an active or
            recruiting OC with a role open (or you're in one yourself). Check back after your next OC spawns.
        </p></div>`;
        return;
    }

    // Group by difficulty -> scenario
    const byDiff = {};
    for (const entry of catalog) {
        const d = entry.difficulty ?? '?';
        (byDiff[d] ||= {})[entry.scenario] ||= [];
        byDiff[d][entry.scenario].push(entry);
    }
    const diffs = Object.keys(byDiff).sort((a, b) => Number(a) - Number(b));
    const collapsed = ocfitGetCollapsed();

    body.innerHTML = diffs.map(diff => {
        const tierId = `ocfit-tier-${diff}`;
        const scenarios = byDiff[diff];
        const scenarioNames = Object.keys(scenarios).sort();
        const roleCount = scenarioNames.reduce((n, s) => n + scenarios[s].length, 0);

        const scenarioHtml = scenarioNames.map(scenario => {
            const scenId = `${tierId}-${scenario.replace(/[^a-z0-9]/gi, '')}`;
            const roles = scenarios[scenario].sort((a, b) => ocfitSortScore(b) - ocfitSortScore(a));
            const anyLive = roles.some(r => r.live);

            const rolesHtml = roles.map((r, i) => {
                const rowId = `${scenId}-r${i}`;
                const cprText = r.cpr != null ? `${Math.round(r.cpr)}%` : '—';
                const weightText = r.weight != null ? `${Math.round(r.weight)}% weight` : 'weight unknown';
                const badge = r.live
                    ? `<span class="ocfit-live-badge" style="background:rgba(53,217,155,.15);color:var(--reagent);">live now</span>`
                    : `<span class="ocfit-live-badge" style="background:var(--bench-2);color:var(--muted);">cached · ${esc(ocfitAgo(r.lastSeenLive))}</span>`;
                const impact = ocfitImpact(r.cpr, r.weight);
                const impactBadge = impact
                    ? `<span class="ocfit-live-badge" style="background:${impact.bg};color:${impact.color};">${esc(impact.label)}</span>`
                    : '';
                return `
                    <div class="ocfit-role-row" data-row="${rowId}">
                        <span class="ocfit-role-name">${esc(r.role)}</span>
                        ${impactBadge}
                        <span class="ocfit-cpr" style="color:${ocfitCprColor(r.cpr)};">${cprText}</span>
                        ${badge}
                    </div>
                    <div class="ocfit-role-detail" id="${rowId}-detail">
                        <div style="margin-bottom:6px;"><b>${esc(r.category)}</b> — ${esc(r.categoryHint)}</div>
                        <div style="font-size:12px;">Role importance: ${esc(weightText)} · Last confirmed: ${esc(ocfitAgo(r.lastSeenLive))}${r.live ? ' (right now)' : ''}</div>
                        <div style="font-size:11px;margin-top:6px;color:var(--muted);">On top of the above: general Crime Experience (from doing any crimes at all, more advanced ones count for more) always helps every role a little, separately from any specific Crime Skill named above.</div>
                    </div>`;
            }).join('');

            const scenCollapsed = collapsed.includes(scenId);
            return `
                <div class="ocfit-scenario ${scenCollapsed ? 'collapsed' : ''}" data-collapse="${scenId}">
                    <div class="ocfit-scenario-header">
                        <span>${esc(scenario)}</span>
                        <span style="font-size:11px;color:var(--muted);">${roles.length} role${roles.length === 1 ? '' : 's'}${anyLive ? ' · live now' : ''}</span>
                        <span class="chev">▾</span>
                    </div>
                    <div class="ocfit-scenario-body">${rolesHtml}</div>
                </div>`;
        }).join('');

        const tierCollapsed = collapsed.includes(tierId);
        return `
            <div class="ocfit-tier ${tierCollapsed ? 'collapsed' : ''}" data-collapse="${tierId}">
                <div class="ocfit-tier-header">
                    <span>Difficulty ${esc(diff)}</span>
                    <span style="font-size:12px;color:var(--muted);font-weight:400;">${scenarioNames.length} scenario${scenarioNames.length === 1 ? '' : 's'} · ${roleCount} role${roleCount === 1 ? '' : 's'} tracked</span>
                    <span class="chev">▾</span>
                </div>
                <div class="ocfit-tier-body">${scenarioHtml}</div>
            </div>`;
    }).join('');

    // Wire collapse toggles
    body.querySelectorAll('.ocfit-tier-header').forEach(header => {
        header.addEventListener('click', () => {
            const tier = header.closest('.ocfit-tier');
            const isCollapsed = ocfitToggleCollapsed(tier.dataset.collapse);
            tier.classList.toggle('collapsed', isCollapsed);
        });
    });
    body.querySelectorAll('.ocfit-scenario-header').forEach(header => {
        header.addEventListener('click', () => {
            const scen = header.closest('.ocfit-scenario');
            const isCollapsed = ocfitToggleCollapsed(scen.dataset.collapse);
            scen.classList.toggle('collapsed', isCollapsed);
        });
    });
    body.querySelectorAll('.ocfit-role-row').forEach(row => {
        row.addEventListener('click', () => {
            const detail = document.getElementById(`${row.dataset.row}-detail`);
            if (detail) detail.classList.toggle('open');
        });
    });
}
