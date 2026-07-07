// respect-tracker.js — WorldWideLabs Respect Tracker (Dashboard goal panel + leadership editor).
'use strict';

let respectSnapshotTaken = false; // only fire the daily snapshot once per session

async function respectFetch(body) {
    const res = await fetch('/api/respect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: apiKey, ...body }),
    });
    return res.json();
}

// Builds a sorted, gap-tolerant list of { date, totalGain, oc, chains, hits, war, other } — only
// for days that have both their own snapshot and the previous day's, since a gain needs two
// points. "other" is whatever's left after all four real/logged categories — territory, raids,
// dirty bombs, or data-quality gaps — kept visible rather than folded silently into "hits".
function respectComputeDaily(snapshots, ocDaily, chainDaily, hitsDaily, warEntries) {
    const dates = Object.keys(snapshots).sort();
    const warByDate = {};
    for (const w of warEntries) warByDate[w.date] = (warByDate[w.date] || 0) + w.amount;

    const rows = [];
    for (let i = 1; i < dates.length; i++) {
        const date = dates[i];
        const prevDate = dates[i - 1];
        // Only treat as a real day-over-day gain if the previous entry is literally the day before —
        // otherwise it's a multi-day gap and the "gain" would be misleadingly lumped into one row.
        const prev = new Date(prevDate); prev.setDate(prev.getDate() + 1);
        if (prev.toISOString().slice(0, 10) !== date) continue;
        const totalGain = snapshots[date] - snapshots[prevDate];
        const oc = ocDaily[date] || 0;
        const chains = chainDaily[date] || 0;
        const hits = hitsDaily[date] || 0;
        const war = warByDate[date] || 0;
        rows.push({ date, totalGain, oc, chains, hits, war, other: totalGain - oc - chains - hits - war });
    }
    return rows.reverse(); // newest first
}

// Average weekly gain from the earliest to latest available snapshot (gap-tolerant) — needs at
// least two snapshots spanning some real time, otherwise there's genuinely not enough data yet.
function respectWeeklyRate(snapshots) {
    const dates = Object.keys(snapshots).sort();
    if (dates.length < 2) return null;
    const first = dates[0], last = dates[dates.length - 1];
    const days = (new Date(last) - new Date(first)) / 86400000;
    if (days < 1) return null;
    const totalGain = snapshots[last] - snapshots[first];
    return (totalGain / days) * 7;
}

async function loadRespectGoalPanel() {
    if (!isLeaderCached) { $('respect-goal-panel').style.display = 'none'; return; }
    try {
        if (!respectSnapshotTaken) {
            respectSnapshotTaken = true;
            respectFetch({ action: 'snapshot' }).catch(() => {}); // fire-and-forget, don't block the dashboard
        }
        const data = await respectFetch({ action: 'read' });
        if (data.error || !data.goal) { $('respect-goal-panel').style.display = 'none'; return; }

        const dates = Object.keys(data.snapshots).sort();
        if (!dates.length) { $('respect-goal-panel').style.display = 'none'; return; }
        const current = data.snapshots[dates[dates.length - 1]];
        const { target, deadline, label } = data.goal;
        const pct = Math.max(0, Math.min(100, Math.round((current / target) * 100)));
        const weeklyRate = respectWeeklyRate(data.snapshots);

        let etaLine;
        if (current >= target) {
            etaLine = `<span style="color:var(--reagent);">Goal reached! 🎉</span>`;
        } else if (weeklyRate == null) {
            etaLine = `<span style="color:var(--muted);">Not enough data yet for a pace estimate — check back in a few days.</span>`;
        } else if (weeklyRate <= 0) {
            etaLine = `<span style="color:var(--danger);">Respect isn't trending upward right now — no ETA available.</span>`;
        } else {
            const weeksNeeded = (target - current) / weeklyRate;
            const projected = new Date(Date.now() + weeksNeeded * 7 * 86400000);
            const projectedStr = projected.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
            let deadlineNote = '';
            if (deadline) {
                const onTrack = projected <= new Date(deadline);
                deadlineNote = onTrack
                    ? ` — <span style="color:var(--reagent);">on track for your ${esc(new Date(deadline).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }))} deadline</span>`
                    : ` — <span style="color:var(--danger);">behind your ${esc(new Date(deadline).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }))} deadline at this pace</span>`;
            }
            etaLine = `At ~${Math.round(weeklyRate).toLocaleString()} respect/week, projected: <b>${projectedStr}</b>${deadlineNote}`;
        }

        $('respect-goal-panel').style.display = 'block';
        $('respect-goal-body').innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
                <b>${esc(label)}</b>
                <span style="font-family:var(--mono);">${current.toLocaleString()} / ${target.toLocaleString()}</span>
            </div>
            <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:var(--reagent);"></div></div>
            <p style="font-size:12px;color:var(--muted);margin:8px 0 0;">${pct}% there · ${etaLine}</p>`;
    } catch (e) {
        $('respect-goal-panel').style.display = 'none';
    }
}

async function loadRespectEditor() {
    $('respect-locked').style.display = isLeaderCached ? 'none' : 'block';
    $('respect-editor').style.display = isLeaderCached ? 'block' : 'none';
    if (!isLeaderCached) return;

    try {
        const data = await respectFetch({ action: 'read' });
        if (data.error) throw new Error(data.error);

        if (data.goal) {
            $('rg-label').value = data.goal.label || '';
            $('rg-target').value = data.goal.target || '';
            $('rg-deadline').value = data.goal.deadline || '';
        }

        const warList = $('rg-war-list');
        if (!data.warEntries.length) {
            warList.innerHTML = '<p style="color:var(--muted);font-size:13px;">No war entries logged yet.</p>';
        } else {
            warList.innerHTML = [...data.warEntries].reverse().map(w => `
                <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-top:1px solid var(--line);">
                    <span style="flex:1;">${esc(w.label)} <span style="color:var(--muted);font-size:12px;">${esc(w.date)}</span></span>
                    <span style="font-family:var(--mono);color:var(--reagent);">+${Number(w.amount).toLocaleString()}</span>
                    <button class="ghost small rg-war-remove" data-id="${esc(w.id)}">Remove</button>
                </div>`).join('');
            warList.querySelectorAll('.rg-war-remove').forEach(btn => {
                btn.addEventListener('click', async () => {
                    await respectFetch({ action: 'remove-war-entry', id: btn.dataset.id });
                    loadRespectEditor();
                });
            });
        }

        const daily = respectComputeDaily(data.snapshots, data.ocDaily, data.chainDaily, data.hitsDaily, data.warEntries).slice(0, 30);
        const tableEl = $('rg-daily-table');
        if (!daily.length) {
            tableEl.innerHTML = '<p style="color:var(--muted);font-size:13px;">Not enough consecutive daily snapshots yet.</p>';
        } else {
            tableEl.innerHTML = `
                <table style="width:100%;font-size:13px;border-collapse:collapse;">
                    <thead><tr style="color:var(--muted);text-align:left;">
                        <th style="padding:4px 8px;">Date</th><th style="padding:4px 8px;">Total gain</th>
                        <th style="padding:4px 8px;">OC</th><th style="padding:4px 8px;">Chains</th>
                        <th style="padding:4px 8px;">Hits</th><th style="padding:4px 8px;">War</th>
                        <th style="padding:4px 8px;">Other</th>
                    </tr></thead>
                    <tbody>${daily.map(d => `
                        <tr style="border-top:1px solid var(--line);">
                            <td style="padding:4px 8px;">${esc(d.date)}</td>
                            <td style="padding:4px 8px;font-family:var(--mono);">${d.totalGain.toLocaleString()}</td>
                            <td style="padding:4px 8px;font-family:var(--mono);color:var(--muted);">${d.oc.toLocaleString()}</td>
                            <td style="padding:4px 8px;font-family:var(--mono);color:var(--muted);">${d.chains.toLocaleString()}</td>
                            <td style="padding:4px 8px;font-family:var(--mono);color:var(--muted);">${d.hits.toLocaleString()}</td>
                            <td style="padding:4px 8px;font-family:var(--mono);color:var(--muted);">${d.war.toLocaleString()}</td>
                            <td style="padding:4px 8px;font-family:var(--mono);">${d.other.toLocaleString()}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>`;
        }
    } catch (e) {
        $('rg-status').className = 'status err'; $('rg-status').textContent = e.message;
    }
}

$('rg-save').addEventListener('click', async () => {
    const btn = $('rg-save');
    const st = $('rg-status');
    const target = $('rg-target').value.trim();
    if (!target) { st.className = 'status err'; st.textContent = 'A target respect value is required.'; return; }
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        const result = await respectFetch({
            action: 'set-goal', target, deadline: $('rg-deadline').value || null, label: $('rg-label').value.trim() || 'Respect goal',
        });
        if (result.error) throw new Error(result.error);
        st.className = 'status ok'; st.textContent = 'Saved — live on everyone\'s dashboard now.';
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    } finally {
        btn.disabled = false; btn.textContent = 'Save goal';
    }
});

$('rg-clear').addEventListener('click', async () => {
    if (!confirm('Clear the current respect goal for everyone?')) return;
    await respectFetch({ action: 'clear-goal' });
    $('rg-label').value = ''; $('rg-target').value = ''; $('rg-deadline').value = '';
    toast('Goal cleared');
});

$('rg-war-add').addEventListener('click', async () => {
    const btn = $('rg-war-add');
    const st = $('rg-war-status');
    const date = $('rg-war-date').value;
    const amount = $('rg-war-amount').value.trim();
    const label = $('rg-war-label').value.trim();
    if (!date || !amount) { st.className = 'status err'; st.textContent = 'Date and respect amount are required.'; return; }
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

$('rg-sync-oc').addEventListener('click', async () => {
    const btn = $('rg-sync-oc');
    const st = $('rg-oc-status');
    btn.disabled = true; btn.textContent = 'Syncing…';
    try {
        const result = await respectFetch({ action: 'sync-oc' });
        if (result.error) throw new Error(result.error);
        st.className = 'status ok';
        st.textContent = result.synced > 0 ? `Pulled in ${result.synced} completed crime${result.synced === 1 ? '' : 's'}.` : 'Already up to date — nothing new to pull in.';
        loadRespectEditor();
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    } finally {
        btn.disabled = false; btn.textContent = 'Backfill OC history now';
    }
});

$('rg-sync-chains').addEventListener('click', async () => {
    const btn = $('rg-sync-chains');
    const st = $('rg-chains-status');
    btn.disabled = true; btn.textContent = 'Syncing…';
    try {
        const result = await respectFetch({ action: 'sync-chains' });
        if (result.error) throw new Error(result.error);
        st.className = 'status ok';
        st.textContent = result.synced > 0 ? `Pulled in ${result.synced} chain${result.synced === 1 ? '' : 's'} of history.` : 'Already up to date — nothing new to pull in.';
        loadRespectEditor();
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    } finally {
        btn.disabled = false; btn.textContent = 'Backfill chain history now';
    }
});

$('rg-sync-hits').addEventListener('click', async () => {
    const btn = $('rg-sync-hits');
    const st = $('rg-hits-status');
    btn.disabled = true; btn.textContent = 'Syncing…';
    try {
        const result = await respectFetch({ action: 'sync-hits' });
        if (result.error) throw new Error(result.error);
        st.className = 'status ok';
        st.textContent = result.synced > 0 ? `Pulled in ${result.synced} attack${result.synced === 1 ? '' : 's'} of history.` : 'Already up to date — nothing new to pull in.';
        loadRespectEditor();
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    } finally {
        btn.disabled = false; btn.textContent = 'Backfill hit history now';
    }
});
