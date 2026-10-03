// respect-tracker.js — WorldWideLabs Respect Tracker (Dashboard goal panel + leadership editor).
'use strict';

let respectAutoSyncDone = false; // only fire the auto-sync once per session

async function respectFetch(body) {
    const res = await fetch('/api/respect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: apiKey, ...body }),
    });
    return res.json();
}

// Builds a sorted list of { date, totalGain, oc, chains, hits, war } covering every day with any
// known category data (OC, chains, hits, war). Previously this used daily snapshot diffs for the
// "real" total when available, falling back to the summed categories otherwise — reported as
// unreliable day to day, so this now always uses the summed categories as the sole total. That
// means genuinely untracked respect sources (territory, raids, etc.) that used to surface via an
// "Other" column are no longer visible — a real tradeoff, but a wrong number is worse than a
// missing one.
function respectComputeDaily(ocDaily, chainDaily, hitsDaily, warBonusDaily, warEntries, lossDaily) {
    lossDaily = lossDaily || {};
    const warByDate = {};
    for (const w of warEntries) warByDate[w.date] = (warByDate[w.date] || 0) + w.amount;
    // Auto-tracked war bonuses and manually-logged entries both feed the same "War" total — the
    // manual log stays useful as a supplement/fallback for anything the auto-tracking doesn't reach
    // (e.g. wars from before this existed). The auto-tracked figure itself comes from the faction
    // news line Torn posts when the war's rank change resolves ("X ranked up/down from A to B and
    // received N bonus respect") — confirmed against real examples to be the actual, reliable source,
    // not the war report's own rewards.respect field (see api/respect.js's syncWarBonus).
    for (const [date, amount] of Object.entries(warBonusDaily)) {
        warByDate[date] = (warByDate[date] || 0) + amount;
    }

    // Union of every date we know ANYTHING about, from any source.
    const allDates = new Set([
        ...Object.keys(ocDaily), ...Object.keys(chainDaily), ...Object.keys(hitsDaily), ...Object.keys(lossDaily), ...Object.keys(warByDate),
    ]);

    const rows = [];
    for (const date of allDates) {
        const oc = ocDaily[date] || 0;
        // hitsDaily is the respect of every outgoing hit, chainDaily the part of it that came from hits that
        // were part of a chain (both bucketed by the day of the hit itself), lossDaily what hits against us
        // took off (negative). So Chains is a breakdown WITHIN the hit total and can't exceed it.
        const hitsRaw = hitsDaily[date] || 0;
        const chains = Math.min(chainDaily[date] || 0, hitsRaw);
        const hits = hitsRaw - chains;
        const losses = lossDaily[date] || 0;
        const war = warByDate[date] || 0;
        const totalGain = oc + hitsRaw + losses + war; // chains NOT added again — already inside hitsRaw
        rows.push({ date, totalGain, oc, chains, hits, losses, war });
    }
    return rows.sort((a, b) => b.date.localeCompare(a.date)); // newest first
}

const RESPECT_WINDOWS = [14, 21, 28, 90];
const RESPECT_WINDOW_LABEL = { 14: '14d', 21: '21d', 28: '28d', 90: '3mo' }; // compact, for the goal list and the "at other paces" comparison
const RESPECT_WINDOW_LONG = { 14: '14 days', 21: '21 days', 28: '28 days', 90: '3 months' }; // spelled out, for the main ETA sentence

// Average weekly gain from the log-based daily totals — the trailing N days (14/21/28/90,
// leader's choice — a longer window smooths out a quiet week or two, useful when weekly gain is
// spiky rather than steady), needs at least a couple of days of data to mean anything.
function respectWeeklyRate(dailyRows, windowDays) {
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - (windowDays || 14));
    const startStr = windowStart.toISOString().slice(0, 10);
    const recent = dailyRows.filter(r => r.date >= startStr);
    if (recent.length < 2) return null;
    const sorted = [...recent].sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0].date, last = sorted[sorted.length - 1].date;
    const days = (new Date(last) - new Date(first)) / 86400000;
    if (days < 1) return null;
    const totalGain = sorted.reduce((s, r) => s + r.totalGain, 0);
    return (totalGain / days) * 7;
}

async function loadRespectGoalPanel() {
    if (!isLeaderCached) { $('respect-goal-panel').style.display = 'none'; return; }
    try {
        let totalRespect = null;
        if (!respectAutoSyncDone) {
            respectAutoSyncDone = true;
            // Needs to be awaited now (not fire-and-forget) since the live current-respect figure
            // used for the progress bar below comes from this call's response.
            const syncResult = await respectFetch({ action: 'snapshot' }).catch(() => null);
            totalRespect = syncResult?.totalRespect ?? null;
        }
        const data = await respectFetch({ action: 'read' });
        if (data.error || !data.goals || !data.goals.length) { $('respect-goal-panel').style.display = 'none'; return; }
        if (totalRespect == null) {
            // Already auto-synced earlier this session — get a fresh current total without
            // re-triggering the full sync again.
            const liveResult = await respectFetch({ action: 'current-respect' }).catch(() => null);
            totalRespect = liveResult?.totalRespect ?? null;
        }
        // Torn can be busy right after login (many requests at once) — try again a few times before giving up, so the panel doesn't just vanish.
        for (let i = 0; i < 3 && totalRespect == null; i++) {
            await new Promise(res => setTimeout(res, 3000));
            const again = await respectFetch({ action: 'current-respect' }).catch(() => null);
            totalRespect = again?.totalRespect ?? null;
        }
        if (totalRespect == null) { $('respect-goal-panel').style.display = 'none'; return; }

        const current = totalRespect;
        const dailyRows = respectComputeDaily(data.ocDaily, data.chainDaily, data.hitsDaily, data.warBonusDaily, data.warEntries, data.lossDaily);

        // Projected date (and whether that's on track for a deadline) from a given weekly rate — shared
        // by the main line below and the comparison row, so both use the exact same math.
        const projectFrom = (rate, target, deadline) => {
            const weeksNeeded = (target - current) / rate;
            const projected = new Date(Date.now() + weeksNeeded * 7 * 86400000);
            return { projected, str: projected.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }), onTrack: deadline ? projected <= new Date(deadline) : null };
        };

        const cards = data.goals.map(({ target, deadline, label, windowDays }) => {
            // Each goal has its OWN pace window (set when it was added) — was a single setting shared by
            // every goal, so a 28-day estimate and a separate 3-month one for another goal used to end up
            // both showing whichever window was picked last.
            const win = windowDays || 28;
            const weeklyRate = respectWeeklyRate(dailyRows, win);
            const pct = Math.max(0, Math.min(100, Math.round((current / target) * 100)));
            let etaLine, compareLine = '', requiredLine = '';
            if (current >= target) {
                etaLine = `<span style="color:var(--reagent);">Goal reached! 🎉</span>`;
            } else if (weeklyRate == null) {
                etaLine = `<span style="color:var(--muted);">Not enough data yet for a pace estimate — check back in a few days.</span>`;
            } else if (weeklyRate <= 0) {
                etaLine = `<span style="color:var(--danger);">Respect isn't trending upward right now — no ETA available.</span>`;
            } else {
                const { str: projectedStr, onTrack } = projectFrom(weeklyRate, target, deadline);
                let deadlineNote = '';
                if (deadline) {
                    deadlineNote = onTrack
                        ? ` — <span style="color:var(--reagent);">on track for your ${esc(new Date(deadline).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }))} deadline</span>`
                        : ` — <span style="color:var(--danger);">behind your ${esc(new Date(deadline).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }))} deadline at this pace</span>`;
                }
                etaLine = `At ~${Math.round(weeklyRate).toLocaleString()} respect/week <span style="color:var(--muted);font-size:11px;">(based on the past ${RESPECT_WINDOW_LONG[win]})</span>, projected: <b>${projectedStr}</b>${deadlineNote}`;

                // Every OTHER window's own pace and ETA — purely informational (this goal keeps the window
                // it was set up with), so you can see how a spikier or steadier read would change things
                // without it ever overwriting what this goal actually uses.
                const others = RESPECT_WINDOWS.filter(w => w !== win).map(w => {
                    const r = respectWeeklyRate(dailyRows, w);
                    const wLabel = RESPECT_WINDOW_LABEL[w];
                    if (r == null) return `${wLabel}: <span style="color:var(--muted);">not enough data</span>`;
                    if (r <= 0) return `${wLabel}: <span style="color:var(--danger);">no growth</span>`;
                    return `${wLabel}: ~${Math.round(r).toLocaleString()}/wk → ${projectFrom(r, target, deadline).str}`;
                });
                compareLine = `<div style="font-size:11px;color:var(--muted);margin-top:4px;">At other paces: ${others.join(' · ')}</div>`;
            }
            // The REQUIRED weekly rate to actually hit the deadline — working backward from the target and
            // date, not from recent pace at all. This is the number to plan around: compare it against the
            // "At ~X respect/week" line above to see whether the faction needs to speed up or is coasting.
            if (current < target && deadline) {
                const weeksLeft = (new Date(`${deadline}T00:00:00Z`) - Date.now()) / (7 * 86400000);
                if (weeksLeft <= 0) {
                    requiredLine = `<p style="font-size:12px;color:var(--danger);margin:4px 0 0;">The ${esc(new Date(deadline).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }))} deadline has already passed.</p>`;
                } else {
                    const required = (target - current) / weeksLeft;
                    requiredLine = `<p style="font-size:12px;margin:4px 0 0;">Needs <b>~${Math.round(required).toLocaleString()} respect/week</b> from now to hit it by ${esc(new Date(deadline).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }))} (${weeksLeft.toFixed(1)} week${weeksLeft >= 1.05 ? 's' : ''} left).</p>`;
                }
            }
            return `
                <div style="margin-bottom:14px;">
                    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
                        <b>${esc(label)}</b>
                        <span style="font-family:var(--mono);">${current.toLocaleString()} / ${target.toLocaleString()}</span>
                    </div>
                    <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:var(--reagent);"></div></div>
                    <p style="font-size:12px;color:var(--muted);margin:8px 0 0;">${pct}% there · ${etaLine}</p>
                    ${requiredLine}
                    ${compareLine}
                </div>`;
        });

        $('respect-goal-panel').style.display = 'block';
        $('respect-goal-body').innerHTML = cards.join('<hr style="border:none;border-top:1px solid var(--line);margin:0 0 14px;">');
    } catch (e) {
        $('respect-goal-panel').style.display = 'none';
    }
}

async function loadRespectEditor() {
    // Council gets into this page; Goals, manual war-respect logging, and the daily-breakdown sync/dig-deeper/
    // reset buttons stay Leader-only (see AUDIT.md) — "Check a specific period" and the breakdown table itself are Council.
    $('respect-locked').style.display = isLeaderCached ? 'none' : 'block';
    $('respect-editor').style.display = isLeaderCached ? 'block' : 'none';
    if (!isLeaderCached) return;
    $('rg-goals-panel').style.display = canEditLeaderOnly ? '' : 'none';
    $('rg-warlog-panel').style.display = canEditLeaderOnly ? '' : 'none';
    $('rg-daily-buttons').style.display = canEditLeaderOnly ? 'flex' : 'none';

    try {
        const data = await respectFetch({ action: 'read' });
        if (data.error) throw new Error(data.error);

        const goalList = $('rg-goal-list');
        if (!data.goals || !data.goals.length) {
            goalList.innerHTML = '<p style="color:var(--muted);font-size:13px;">No goals set yet.</p>';
        } else {
            goalList.innerHTML = [...data.goals].reverse().map(g => `
                <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-top:1px solid var(--line);">
                    <span style="flex:1;">${esc(g.label)} <span style="color:var(--muted);font-size:12px;">target ${Number(g.target).toLocaleString()}${g.deadline ? ` · by ${esc(g.deadline)}` : ''} · pace: ${esc(RESPECT_WINDOW_LABEL[g.windowDays] || '28d')}</span></span>
                    <button class="ghost small rg-goal-remove" data-id="${esc(g.id)}">Remove</button>
                </div>`).join('');
            goalList.querySelectorAll('.rg-goal-remove').forEach(btn => {
                btn.addEventListener('click', async () => {
                    await respectFetch({ action: 'remove-goal', id: btn.dataset.id });
                    loadRespectEditor();
                });
            });
        }

        const warList = $('rg-war-list');
        if (!data.warEntries.length) {
            warList.innerHTML = '<p style="color:var(--muted);font-size:13px;">No war entries logged yet.</p>';
        } else {
            warList.innerHTML = `
                <div class="ocfit-scenario collapsed" data-collapse="rg-wars">
                    <div class="ocfit-scenario-header">
                        <span>Logged war entries (${data.warEntries.length})</span>
                        <span class="chev">▾</span>
                    </div>
                    <div class="ocfit-scenario-body">${[...data.warEntries].reverse().map(w => `
                        <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-top:1px solid var(--line);">
                            <span style="flex:1;">${esc(w.label)} <span style="color:var(--muted);font-size:12px;">${esc(w.date)}</span></span>
                            <span style="font-family:var(--mono);color:var(--reagent);">+${Number(w.amount).toLocaleString()}</span>
                            <button class="ghost small rg-war-remove" data-id="${esc(w.id)}">Remove</button>
                        </div>`).join('')}
                    </div>
                </div>`;
            warList.querySelector('.ocfit-scenario-header').addEventListener('click', () => {
                warList.querySelector('.ocfit-scenario').classList.toggle('collapsed');
            });
            warList.querySelectorAll('.rg-war-remove').forEach(btn => {
                btn.addEventListener('click', async () => {
                    await respectFetch({ action: 'remove-war-entry', id: btn.dataset.id });
                    loadRespectEditor();
                });
            });
        }

        rgLastData = data; // stashed for the date-range filter below, no need to refetch
        const daily = respectComputeDaily(data.ocDaily, data.chainDaily, data.hitsDaily, data.warBonusDaily, data.warEntries, data.lossDaily);
        rgLastDaily = daily;
        renderRgDailyTable(daily);
    } catch (e) {
        $('rg-status').className = 'status err'; $('rg-status').textContent = e.message;
    }
}

let rgDailySort = { key: 'date', dir: 'desc' };
const rgDailyAccessors = { date: d => d.date, total: d => d.totalGain, oc: d => d.oc, chains: d => d.chains, hits: d => d.hits, losses: d => d.losses, war: d => d.war };
function renderRgDailyTable(daily) {
    const tableEl = $('rg-daily-table');
    if (!daily.length) {
        tableEl.innerHTML = '<p style="color:var(--muted);font-size:13px;">No data for this period yet.</p>';
        return;
    }
    const sorted = sortRows(daily, rgDailySort, rgDailyAccessors);
    tableEl.innerHTML = `
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <thead><tr style="color:var(--muted);text-align:left;">
                <th data-sort="date" style="padding:4px 8px;">Date</th><th data-sort="total" style="padding:4px 8px;">Total gain</th>
                <th data-sort="oc" style="padding:4px 8px;">OC</th><th data-sort="chains" style="padding:4px 8px;">Chains</th>
                <th data-sort="hits" style="padding:4px 8px;">Hits</th><th data-sort="losses" style="padding:4px 8px;">Losses</th><th data-sort="war" style="padding:4px 8px;">War</th>
            </tr></thead>
            <tbody>${sorted.map(d => `
                <tr style="border-top:1px solid var(--line);">
                    <td style="padding:4px 8px;">${esc(d.date)}</td>
                    <td style="padding:4px 8px;font-family:var(--mono);font-weight:700;">${d.totalGain.toLocaleString()}</td>
                    <td style="padding:4px 8px;font-family:var(--mono);color:var(--muted);">${d.oc.toLocaleString()}</td>
                    <td style="padding:4px 8px;font-family:var(--mono);color:var(--muted);">${d.chains.toLocaleString()}</td>
                    <td style="padding:4px 8px;font-family:var(--mono);color:var(--muted);">${d.hits.toLocaleString()}</td>
                    <td style="padding:4px 8px;font-family:var(--mono);color:var(--muted);">${d.losses.toLocaleString()}</td>
                    <td style="padding:4px 8px;font-family:var(--mono);color:var(--muted);">${d.war.toLocaleString()}</td>
                </tr>`).join('')}
            </tbody>
        </table>`;
    wireSort(tableEl, rgDailySort, daily, rgDailyAccessors, () => renderRgDailyTable(daily));
}

let rgLastData = null;
let rgLastDaily = [];

// Total for a range is always the sum of the log-based daily categories now — snapshot diffing
// was reported as unreliable day to day, so it's no longer used anywhere in this tracker.
function respectRangeSummary(daily, fromDate, toDate) {
    const inRange = daily.filter(d => d.date >= fromDate && d.date <= toDate);
    const oc = inRange.reduce((s, d) => s + d.oc, 0);
    const chains = inRange.reduce((s, d) => s + d.chains, 0);
    const hits = inRange.reduce((s, d) => s + d.hits, 0);
    const losses = inRange.reduce((s, d) => s + d.losses, 0);
    const war = inRange.reduce((s, d) => s + d.war, 0);
    const totalGain = oc + chains + hits + losses + war;

    return { totalGain, oc, chains, hits, losses, war, days: inRange.length };
}

$('rg-save').addEventListener('click', async () => {
    const btn = $('rg-save');
    const st = $('rg-status');
    const target = $('rg-target').value.trim();
    if (!target) { st.className = 'status err'; st.textContent = 'A target respect value is required.'; return; }
    btn.disabled = true; btn.textContent = 'Adding…';
    try {
        const result = await respectFetch({
            action: 'set-goal', target, deadline: $('rg-deadline').value || null, label: $('rg-label').value.trim() || 'Respect goal',
            windowDays: Number($('rg-window').value), // this goal's OWN pace window from now on — see api/respect.js's set-goal
        });
        if (result.error) throw new Error(result.error);
        $('rg-label').value = ''; $('rg-target').value = ''; $('rg-deadline').value = '';
        st.className = 'status ok'; st.textContent = 'Added — live on everyone\'s dashboard now.';
        loadRespectEditor();
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    } finally {
        btn.disabled = false; btn.textContent = 'Add goal';
    }
});

$('rg-war-add').addEventListener('click', async () => {
    const btn = $('rg-war-add');
    const st = $('rg-war-status');
    const date = $('rg-war-date').value;
    const amount = $('rg-war-amount').value.trim().replace(/[,\s]/g, ''); // strip thousands separators like "7,027"
    const label = $('rg-war-label').value.trim();
    if (!date || !amount) { st.className = 'status err'; st.textContent = 'Date and respect amount are required.'; return; }
    if (!/^-?\d+(\.\d+)?$/.test(amount)) { st.className = 'status err'; st.textContent = 'Respect amount must be a plain number, e.g. 25000.'; return; }
    btn.disabled = true;
    try {
        const result = await respectFetch({ action: 'add-war-entry', date, amount, label });
        if (result.error) throw new Error(result.error);
        $('rg-war-label').value = ''; $('rg-war-date').value = ''; $('rg-war-amount').value = '';
        st.className = 'status ok'; st.textContent = 'Added.';
        loadRespectEditor();
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    } finally {
        btn.disabled = false;
    }
});

$('rg-range-show').addEventListener('click', () => {
    const from = $('rg-range-from').value;
    const to = $('rg-range-to').value;
    const resultEl = $('rg-range-result');
    if (!from || !to) { resultEl.innerHTML = '<p style="color:var(--danger);font-size:13px;">Pick both a start and end date.</p>'; return; }
    if (!rgLastData) { resultEl.innerHTML = '<p style="color:var(--muted);font-size:13px;">Data still loading — try again in a moment.</p>'; return; }

    const s = respectRangeSummary(rgLastDaily, from, to);
    resultEl.innerHTML = `
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;padding:10px 12px;background:var(--bench-2);border-radius:var(--radius);">
            <div><div style="font-size:11px;color:var(--muted);">Total gain</div><div style="font-family:var(--mono);font-size:16px;font-weight:700;">${s.totalGain.toLocaleString()}</div></div>
            <div><div style="font-size:11px;color:var(--muted);">OC</div><div style="font-family:var(--mono);">${s.oc.toLocaleString()}</div></div>
            <div><div style="font-size:11px;color:var(--muted);">Chains</div><div style="font-family:var(--mono);">${s.chains.toLocaleString()}</div></div>
            <div><div style="font-size:11px;color:var(--muted);">Hits</div><div style="font-family:var(--mono);">${s.hits.toLocaleString()}</div></div>
            <div><div style="font-size:11px;color:var(--muted);">Losses</div><div style="font-family:var(--mono);">${s.losses.toLocaleString()}</div></div>
            <div><div style="font-size:11px;color:var(--muted);">War</div><div style="font-family:var(--mono);">${s.war.toLocaleString()}</div></div>
        </div>
        <p style="font-size:11px;color:var(--muted);margin-top:6px;">${esc(from)} to ${esc(to)} · ${s.days} day${s.days === 1 ? '' : 's'} with data</p>`;
});

// One button runs every tracked source's regular sync (single page each) in one go.
function rgSleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

$('rg-sync-all').addEventListener('click', async () => {
    const btn = $('rg-sync-all');
    const st = $('rg-sync-status');
    btn.disabled = true; btn.textContent = 'Refreshing…';
    try {
        // Run one at a time with small gaps rather than all at once — four simultaneous
        // requests is exactly the kind of burst that trips Torn's rate limit.
        const oc = await respectFetch({ action: 'sync-oc' });
        await rgSleep(700);
        const chains = await respectFetch({ action: 'sync-chains' });
        await rgSleep(700);
        const hits = await respectFetch({ action: 'sync-hits' });
        await rgSleep(700);
        const losses = await respectFetch({ action: 'sync-losses' });
        await rgSleep(700);
        const warBonus = await respectFetch({ action: 'sync-war-bonus' });

        const parts = [];
        if (oc.error) parts.push(`OC: ${oc.error}`); else parts.push(`OC +${oc.synced}`);
        if (chains.error) parts.push(`Chains: ${chains.error}`); else parts.push(`Chains +${chains.synced}`);
        if (hits.error) parts.push(`Hits: ${hits.error}`); else parts.push(`Hits +${hits.synced}`);
        if (losses.error) parts.push(`Losses: ${losses.error}`); else parts.push(`Losses +${losses.synced}`);
        if (warBonus.error) parts.push(`War: ${warBonus.error}`); else parts.push(`War +${warBonus.synced}`);
        st.className = 'status ok';
        st.textContent = parts.join(' · ');
        loadRespectEditor();
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    } finally {
        btn.disabled = false; btn.textContent = 'Refresh tracking now';
    }
});

$('rg-deep-sync-oc').addEventListener('click', async () => {
    const btn = $('rg-deep-sync-oc');
    const st = $('rg-sync-status');
    btn.disabled = true; btn.textContent = 'Digging further back… (may take a moment)';
    try {
        const result = await respectFetch({ action: 'deep-sync-oc' });
        if (result.error) throw new Error(result.error);
        st.className = result.rateLimited ? 'status err' : 'status ok';
        st.textContent = result.rateLimited
            ? `OC: got rate-limited by Torn after ${result.pagesFetched} page${result.pagesFetched === 1 ? '' : 's'} (pulled in ${result.synced} so far) — wait a minute or two, then click this again to continue further back.`
            : `OC: checked ${result.pagesFetched} page${result.pagesFetched === 1 ? '' : 's'} of history, pulled in ${result.synced} completed crime${result.synced === 1 ? '' : 's'}. Stopped because: ${result.stopReason}.`;
        loadRespectEditor();
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    } finally {
        btn.disabled = false; btn.textContent = 'Dig deeper — OC';
    }
});

$('rg-deep-sync-hits').addEventListener('click', async () => {
    const btn = $('rg-deep-sync-hits');
    const st = $('rg-sync-status');
    btn.disabled = true; btn.textContent = 'Digging further back… (may take a moment)';
    try {
        const result = await respectFetch({ action: 'deep-sync-hits' });
        if (result.error) throw new Error(result.error);
        st.className = result.rateLimited ? 'status err' : 'status ok';
        st.textContent = result.rateLimited
            ? `Hits: got rate-limited by Torn after ${result.pagesFetched} page${result.pagesFetched === 1 ? '' : 's'} (pulled in ${result.synced} so far) — wait a minute or two, then click this again to continue further back.`
            : `Hits: checked ${result.pagesFetched} page${result.pagesFetched === 1 ? '' : 's'} of history, pulled in ${result.synced} attack${result.synced === 1 ? '' : 's'}. Stopped because: ${result.stopReason}.`;
        loadRespectEditor();
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    } finally {
        btn.disabled = false; btn.textContent = 'Dig deeper — Hits';
    }
});

$('rg-deep-sync-losses').addEventListener('click', async () => {
    const btn = $('rg-deep-sync-losses');
    const st = $('rg-sync-status');
    btn.disabled = true; btn.textContent = 'Digging further back… (may take a moment)';
    try {
        const result = await respectFetch({ action: 'deep-sync-losses' });
        if (result.error) throw new Error(result.error);
        st.className = result.rateLimited ? 'status err' : 'status ok';
        st.textContent = result.rateLimited
            ? `Losses: got rate-limited by Torn after ${result.pagesFetched} chunk${result.pagesFetched === 1 ? '' : 's'} (pulled in ${result.synced} so far) — wait a minute or two, then click this again to continue further back.`
            : `Losses: checked ${result.pagesFetched} chunk${result.pagesFetched === 1 ? '' : 's'} of history, pulled in ${result.synced} loss${result.synced === 1 ? '' : 'es'}. Stopped because: ${result.stopReason}.`;
        loadRespectEditor();
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    } finally {
        btn.disabled = false; btn.textContent = 'Dig deeper — Losses';
    }
});

// Read-only comparison of Torn's attack log and news feed for hits against us (see loss-probe in
// api/respect.js) — shown as plain text so it can be copied back as-is.
$('rg-loss-probe').addEventListener('click', async () => {
    const btn = $('rg-loss-probe');
    const st = $('rg-sync-status');
    btn.disabled = true; btn.textContent = 'Checking…';
    try {
        const result = await respectFetch({ action: 'loss-probe', days: 2 });
        if (result.error) throw new Error(result.error);
        st.className = 'status ok';
        st.style.whiteSpace = 'pre-wrap';
        st.textContent = JSON.stringify(result, null, 1);
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    } finally {
        btn.disabled = false; btn.textContent = 'Check hits against us';
    }
});

$('rg-reset-hits').addEventListener('click', async () => {
    if (!confirm('Reset Hits tracking? This clears everything counted before the chain-overlap fix (which may have been double-counted with Chains) and rebuilds from scratch. Already-saved OC, Chains, and War numbers are untouched.')) return;
    const btn = $('rg-reset-hits');
    const st = $('rg-sync-status');
    btn.disabled = true; btn.textContent = 'Resetting…';
    try {
        await respectFetch({ action: 'reset-hits-tracking' });
        const result = await respectFetch({ action: 'sync-hits' });
        if (result.error) throw new Error(result.error);
        st.className = 'status ok';
        st.textContent = `Hits reset and rebuilt: +${result.synced} of ${result.totalAvailable ?? 0} attacks currently visible. Use "Dig deeper — Hits" to pull in more history.`;
        loadRespectEditor();
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    } finally {
        btn.disabled = false; btn.textContent = 'Reset hits tracking';
    }
});

$('rg-reset-war-bonus').addEventListener('click', async () => {
    if (!confirm('Reset war bonus tracking? This lets it re-check every past war from scratch (needed once, since an earlier version of this feature could get wars stuck as "already checked" without actually finding their bonus). Already-saved daily totals are kept.')) return;
    const btn = $('rg-reset-war-bonus');
    const st = $('rg-sync-status');
    btn.disabled = true; btn.textContent = 'Resetting…';
    try {
        await respectFetch({ action: 'reset-war-bonus-tracking' });
        const result = await respectFetch({ action: 'sync-war-bonus' });
        if (result.error) throw new Error(result.error);
        st.className = result.rateLimited ? 'status err' : 'status ok';
        st.textContent = result.rateLimited
            ? `War bonus: got rate-limited by Torn partway through (pulled in ${result.synced} so far) — wait a minute or two, then click "Refresh tracking now" to continue checking the rest.`
            : `War bonus reset and re-checked: +${result.synced} of ${result.totalAvailable ?? 0} wars${result.skippedUnresolved ? ` (${result.skippedUnresolved} still couldn't be resolved — let me know if this keeps happening)` : ''}.`;
        loadRespectEditor();
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    } finally {
        btn.disabled = false; btn.textContent = 'Reset war bonus tracking';
    }
});

document.querySelector('.rg-effort-link')?.addEventListener('click', e => { e.preventDefault(); goToPage('effort-calc'); });

