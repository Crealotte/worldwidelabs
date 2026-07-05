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
        if (data.weightsSource === 'unavailable') {
            st.className = 'status err';
            st.textContent = 'Role importance data is temporarily unavailable (tornprobability.com unreachable) — CPR numbers are still accurate.';
        } else if (data.weightsSource === 'stale-cache') {
            st.className = 'status ok';
            st.textContent = 'Role importance data is using an older cached copy — tornprobability.com didn\'t respond just now.';
        } else {
            st.textContent = ''; st.className = 'status';
        }
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
        $('ocfit-body').innerHTML = '<p style="color:var(--muted)">Could not load your OC fit data yet.</p>';
    }
}

$('ocfit-refresh').addEventListener('click', () => { ocfitLoaded = false; loadOcFit(); });

async function loadOcFitTeamBuilder() {
    $('ocfit-team-locked').style.display = isLeaderCached ? 'none' : 'block';
    $('ocfit-team-panel').style.display = isLeaderCached ? 'block' : 'none';
    if (!isLeaderCached) return;
    $('ocfit-team-body').innerHTML = '<p style="color:var(--muted);">Loading…</p>';
    try {
        const res = await fetch('/api/oc-fit', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: apiKey, action: 'team-catalog' }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        renderOcFitTeamCatalog(data.scenarios || []);
    } catch (e) {
        $('ocfit-team-body').innerHTML = `<p style="color:var(--muted);">${esc(e.message)}</p>`;
    }
}

// A safe, unique DOM-id-friendly slug for a scenario key (which contains "::").
function ocfitSlug(s) {
    return (s || '').replace(/[^a-zA-Z0-9]/g, '-');
}

function renderOcFitTeamCatalog(scenarios) {
    const body = $('ocfit-team-body');
    if (!scenarios.length) {
        body.innerHTML = `<p style="color:var(--muted);">
            Nothing yet — this fills in once your faction has an active OC, or once members start
            opening their own OC Fit Tracker. Check back after your next OC spawns.
        </p>`;
        return;
    }

    // Group by difficulty, same structure as the personal tracker.
    const byDiff = {};
    for (const s of scenarios) (byDiff[s.difficulty ?? '?'] ||= []).push(s);
    const diffs = Object.keys(byDiff).sort((a, b) => Number(a) - Number(b));
    const collapsed = ocfitGetCollapsed();

    body.innerHTML = diffs.map(diff => {
        const tierId = `ocfitteam-tier-${diff}`;
        const tierScenarios = byDiff[diff];

        const scenarioHtml = tierScenarios.map(s => {
            const scenSlug = ocfitSlug(s.scenarioKey);
            const scenId = `${tierId}-${scenSlug}`;
            const scenCollapsed = collapsed.includes(scenId);

            const statusBadge = s.live
                ? `<span class="ocfit-live-badge" style="background:rgba(53,217,155,.15);color:var(--reagent);">🟢 live now · ${s.openSlotCount} open</span>`
                : `<span class="ocfit-live-badge" style="background:var(--bench-2);color:var(--muted);">📋 planning ahead</span>`;
            const payoutBadge = s.estimatedPayout
                ? `<span class="ocfit-live-badge" style="background:var(--bench-2);color:var(--reagent);">~$${s.estimatedPayout.money.toLocaleString()} + ${s.estimatedPayout.respect} resp</span>`
                : '';
            const simUrl = `https://crimeshub-2b4b0.firebaseapp.com/oc/${(s.scenario || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
            const simLink = `<a href="${esc(simUrl)}" target="_blank" rel="noopener" style="font-size:11px;color:var(--muted);text-decoration:underline;" title="Full checkpoint-by-checkpoint outcome simulator on CrimesHub (not our tool — community-run)" onclick="event.stopPropagation()">simulate outcomes ↗</a>`;

            const rolesHtml = s.roles.map(r => {
                const selId = `ocfitteam-sel-${scenSlug}-${ocfitSlug(r.roleKey)}`;
                const weightText = r.weight != null ? `${Math.round(r.weight)}% weight` : 'weight unknown';
                const openBadge = r.open
                    ? `<span class="ocfit-live-badge" style="background:rgba(53,217,155,.15);color:var(--reagent);">open now</span>`
                    : '';
                const impact = ocfitImpact(null, r.weight); // weight-only badge here — CPR varies per candidate
                const options = r.candidates.map(c => {
                    const live = c.live ? ' · live' : ` · ${ocfitAgo(c.lastSeenLive)}`;
                    return `<option value="${esc(c.id)}" data-name="${esc(c.name)}">${esc(c.name)} — ${Math.round(c.cpr)}%${live}</option>`;
                }).join('');
                const selectedId = r.assigned?.memberId || '';
                return `
                    <div class="ocfit-role-row" style="cursor:default;">
                        <span class="ocfit-role-name">${esc(r.role)}</span>
                        <span style="font-size:11px;color:var(--muted);white-space:nowrap;">${esc(weightText)}</span>
                        ${openBadge}
                        <select id="${selId}" data-role-key="${esc(r.roleKey)}" data-role-name="${esc(r.role)}" style="flex:1;min-width:160px;max-width:240px;">
                            <option value="">— unassigned —</option>
                            ${options}
                        </select>
                    </div>`;
            }).join('');

            return `
                <div class="ocfit-scenario ${scenCollapsed ? 'collapsed' : ''}" data-collapse="${scenId}" data-scenario-key="${esc(s.scenarioKey)}" data-scenario-name="${esc(s.scenario)}" data-difficulty="${esc(s.difficulty)}">
                    <div class="ocfit-scenario-header">
                        <span>${esc(s.scenario)}</span>
                        ${statusBadge}
                        ${payoutBadge}
                        ${simLink}
                        <span class="chev">▾</span>
                    </div>
                    <div class="ocfit-scenario-body">
                        ${rolesHtml}
                        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
                            <button class="ghost small ocfitteam-auto" data-scenario-key="${esc(s.scenarioKey)}">Auto-suggest team</button>
                            <button class="ghost small ocfitteam-save" data-scenario-key="${esc(s.scenarioKey)}" data-scenario-name="${esc(s.scenario)}" data-difficulty="${esc(s.difficulty)}">Save plan</button>
                            <button class="ghost small ocfitteam-clear" data-scenario-key="${esc(s.scenarioKey)}">Clear plan</button>
                            <span class="status" id="ocfitteam-status-${scenSlug}" style="align-self:center;"></span>
                        </div>
                    </div>
                </div>`;
        }).join('');

        const tierCollapsed = collapsed.includes(tierId);
        return `
            <div class="ocfit-tier ${tierCollapsed ? 'collapsed' : ''}" data-collapse="${tierId}">
                <div class="ocfit-tier-header">
                    <span>Difficulty ${esc(diff)}</span>
                    <span style="font-size:12px;color:var(--muted);font-weight:400;">${tierScenarios.length} scenario${tierScenarios.length === 1 ? '' : 's'}</span>
                    <span class="chev">▾</span>
                </div>
                <div class="ocfit-tier-body">${scenarioHtml}</div>
            </div>`;
    }).join('');

    // Wire collapse toggles (shared collapse-state key with the personal tracker's tiers — fine
    // since the ids are namespaced differently and won't collide).
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
    // Prevent the select dropdown click from also toggling the scenario collapse.
    body.querySelectorAll('.ocfit-scenario-body').forEach(el => {
        el.addEventListener('click', e => e.stopPropagation());
    });

    // Auto-suggest: a simple greedy pass — highest-weight roles get first pick of the best
    // available (not-yet-used) candidate. Only fills the dropdowns; nothing is saved until
    // "Save plan" is clicked.
    body.querySelectorAll('.ocfitteam-auto').forEach(btn => {
        btn.addEventListener('click', () => {
            const scenSlug = ocfitSlug(btn.dataset.scenarioKey);
            const selects = [...body.querySelectorAll(`select[id^="ocfitteam-sel-${scenSlug}-"]`)];
            const used = new Set();
            for (const sel of selects) {
                let bestValue = '', bestCpr = -1;
                for (const opt of sel.options) {
                    if (!opt.value || used.has(opt.value)) continue;
                    const cprMatch = opt.textContent.match(/—\s*(\d+)%/);
                    const cpr = cprMatch ? Number(cprMatch[1]) : -1;
                    if (cpr > bestCpr) { bestCpr = cpr; bestValue = opt.value; }
                }
                sel.value = bestValue;
                if (bestValue) used.add(bestValue);
            }
            toast('Auto-suggested — review and Save plan when happy');
        });
    });

    body.querySelectorAll('.ocfitteam-save').forEach(btn => {
        btn.addEventListener('click', async () => {
            const scenarioKey = btn.dataset.scenarioKey;
            const scenSlug = ocfitSlug(scenarioKey);
            const statusEl = document.getElementById(`ocfitteam-status-${scenSlug}`);
            const selects = [...body.querySelectorAll(`select[id^="ocfitteam-sel-${scenSlug}-"]`)];
            const roles = {};
            for (const sel of selects) {
                const roleKey = sel.dataset.roleKey;
                if (!sel.value) { roles[roleKey] = null; continue; }
                const opt = sel.options[sel.selectedIndex];
                roles[roleKey] = { memberId: sel.value, memberName: opt.dataset.name };
            }
            btn.disabled = true;
            statusEl.className = 'status ok'; statusEl.textContent = 'Saving…';
            try {
                await fetch('/api/oc-fit', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        key: apiKey, action: 'team-plan-save',
                        scenarioKey, scenario: btn.dataset.scenarioName, difficulty: btn.dataset.difficulty, roles,
                    }),
                });
                statusEl.textContent = 'Saved ✓';
                setTimeout(() => { statusEl.textContent = ''; }, 2000);
            } catch (e) {
                statusEl.className = 'status err'; statusEl.textContent = 'Could not save';
            } finally {
                btn.disabled = false;
            }
        });
    });

    body.querySelectorAll('.ocfitteam-clear').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Clear the saved plan for this crime?')) return;
            try {
                await fetch('/api/oc-fit', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: apiKey, action: 'team-plan-clear', scenarioKey: btn.dataset.scenarioKey }),
                });
                loadOcFitTeamBuilder();
            } catch (e) { toast('Could not clear plan'); }
        });
    });
}

function renderOcFit(catalog) {
    const body = $('ocfit-body');
    if (!catalog.length) {
        body.innerHTML = `<div class="panel"><p style="color:var(--muted);margin:0;">
            Nothing observed yet — this fills itself in automatically whenever your faction has a
            recruiting crime with at least one role still open. Check back after your next crime spawns.
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
                const cprText = r.cpr != null ? `${Math.round(r.cpr)}%` : (r.noPersonalData ? 'no data' : '—');
                const weightText = r.weight != null ? `${Math.round(r.weight)}% weight` : 'weight unknown';
                const badge = r.noPersonalData
                    ? `<span class="ocfit-live-badge" style="background:var(--bench-2);color:var(--muted);">filled by teammate</span>`
                    : r.live
                        ? `<span class="ocfit-live-badge" style="background:rgba(53,217,155,.15);color:var(--reagent);">live now</span>`
                        : `<span class="ocfit-live-badge" style="background:var(--bench-2);color:var(--muted);">cached · ${esc(ocfitAgo(r.lastSeenLive))}</span>`;
                const impact = r.noPersonalData ? null : ocfitImpact(r.cpr, r.weight);
                const impactBadge = impact
                    ? `<span class="ocfit-live-badge" style="background:${impact.bg};color:${impact.color};">${esc(impact.label)}</span>`
                    : '';
                const payoutLine = r.estimatedPayout
                    ? `<div style="font-size:12px;margin-top:4px;">Typical payout on success: <b style="color:var(--reagent);">$${r.estimatedPayout.money.toLocaleString()}</b> + <b style="color:var(--reagent);">${r.estimatedPayout.respect}</b> respect <span style="color:var(--muted);">(avg of ${r.estimatedPayout.sample} run${r.estimatedPayout.sample === 1 ? '' : 's'})</span></div>`
                    : '';
                const noDataNote = r.noPersonalData
                    ? `<div style="font-size:11px;margin-top:6px;color:var(--muted);">This role exists in a live crime right now, but it's currently filled by someone else — Torn only shows a personal CPR prediction for roles that are open or ones you occupy yourself.</div>`
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
                        ${noDataNote}
                        ${payoutLine}
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
