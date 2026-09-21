// level-targets.js — Baldr's Levelling List target checker, with live status countdowns.
'use strict';

    // ================= LEVELLING TARGETS (Baldr's list) =================
    // Data: the openly licensed list maintained at github.com/OranWeb/tc-baldrs-levelling-list
    const BALDR_URL = 'https://raw.githubusercontent.com/OranWeb/tc-baldrs-levelling-list/master/data.json';
    let baldrData = null;
    let btTargets = [];
    let btChecking = false;
    let btStopFlag = false;
    let btTickHandle = null;

    function btStatus(msg, isErr) {
        const el = $('bt-status');
        el.className = 'status ' + (msg ? (isErr ? 'err' : 'ok') : '');
        el.textContent = msg || '';
    }

    async function loadBaldrLists() {
        if (baldrData) return;
        try {
            btStatus('Fetching the latest list from GitHub…');
            const res = await fetch(BALDR_URL);
            baldrData = await res.json();
            const sel = $('bt-list');
            sel.innerHTML = Object.keys(baldrData)
                .map(k => `<option value="${esc(k)}">${esc(k)} (${baldrData[k].length} targets)</option>`).join('');
            btStatus('');
            renderBaldrTable();
        } catch (e) {
            btStatus('Could not load the target list from GitHub right now — this can happen if GitHub is rate-limiting raw file access. Try again shortly, or use the original tool directly at oran.pw/baldrstargets.', true);
        }
    }

    function normalizeTarget(t) {
        const pick = (...keys) => { for (const k of keys) if (t[k] !== undefined) return t[k]; return undefined; };
        return {
            id: pick('id', 'ID', 'playerId', 'player_id', 'XID', 'xid'),
            name: pick('name', 'Name', 'username') || 'Unknown',
            lvl: pick('lvl', 'level', 'Level') ?? '—',
            total: pick('total', 'Total', 'total_stats') ?? '—',
            str: pick('str', 'strength', 'Strength') ?? '—',
            def: pick('def', 'defense', 'Defense', 'defence') ?? '—',
            spd: pick('spd', 'speed', 'Speed') ?? '—',
            dex: pick('dex', 'dexterity', 'Dexterity') ?? '—',
        };
    }

    function renderBaldrTable() {
        const listName = $('bt-list').value;
        const raw = baldrData?.[listName];
        const items = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : []);
        btTargets = items.map(t => ({ ...normalizeTarget(t), state: null, until: null })).filter(t => t.id);
        if (btTickHandle) { clearInterval(btTickHandle); btTickHandle = null; }
        drawBaldrRows();
        $('bt-table-panel').style.display = btTargets.length ? 'block' : 'none';
        if (btTargets.length && typeof btAutoStatus === 'function') btAutoStatus();
        if (!btTargets.length) btStatus('This list loaded but looks empty or in an unexpected format — tell WWLabs support so the parser can be adjusted.', true);
    }

    function formatCountdown(ms) {
        const total = Math.max(0, Math.round(ms / 1000));
        const m = Math.floor(total / 60);
        const s = total % 60;
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    function btStatusLabel(t) {
        if (t.state === 'Hospital' && t.until) {
            const remaining = t.until * 1000 - Date.now();
            if (remaining <= 0) { t.state = 'Okay'; t.until = null; return 'Okay'; }
            return `Hospital · ${formatCountdown(remaining)}`;
        }
        if (t.state === 'Okay') return 'Okay';
        if (!t.state) return '—';
        return t.state; // Traveling / Jail / Federal / Unknown — shown as-is, no countdown data for these
    }

    function startBtTicker() {
        if (btTickHandle) return;
        btTickHandle = setInterval(() => {
            let changed = false;
            for (const t of btTargets) {
                if (t.state !== 'Hospital') continue;
                const cell = $(`bt-st-${t.id}`);
                const label = btStatusLabel(t);
                if (cell) {
                    cell.textContent = label;
                    cell.style.color = baldrStateColor(t.state);
                }
                if (t.state === 'Okay') changed = true; // just flipped — pounce!
            }
            if (changed && $('bt-okonly').checked) drawBaldrRows();
        }, 1000);
    }
    function baldrStateColor(state) {
        if (state === 'Okay') return 'var(--reagent)';
        if (state === 'Hospital') return 'var(--nerve)';
        if (state === 'Traveling' || state === 'Abroad') return 'var(--life)';
        if (state === 'Jail') return 'var(--happy)';
        return 'var(--muted)';
    }

    function drawBaldrRows() {
        const okOnly = $('bt-okonly').checked;
        const rows = btTargets
            .filter(t => !okOnly || t.state === 'Okay')
            .map(t => `
            <tr>
                <td><a href="https://www.torn.com/profiles.php?XID=${t.id}" target="_blank" rel="noopener">${esc(t.name)} [${t.id}]</a></td>
                <td class="num">${t.lvl}</td>
                <td class="num">${t.total}</td>
                <td class="num">${t.str}</td><td class="num">${t.def}</td>
                <td class="num">${t.spd}</td><td class="num">${t.dex}</td>
                <td id="bt-st-${t.id}" style="color:${baldrStateColor(t.state)};font-family:var(--mono);font-size:12px;font-weight:${t.state === 'Okay' ? '700' : '400'};">${btStatusLabel(t)}</td>
                <td><a href="https://www.torn.com/page.php?sid=attack&user2ID=${t.id}" target="_blank" rel="noopener"
                       style="background:var(--reagent);color:#06130d;padding:4px 10px;border-radius:4px;text-decoration:none;font-weight:600;font-size:12px;">Attack</a></td>
            </tr>`).join('');
        $('bt-body').innerHTML = rows || `<tr><td colspan="9" style="color:var(--muted)">No targets to show${okOnly ? ' — none are Okay (yet). Run a check or untick the filter.' : '.'}</td></tr>`;
    }

    $('bt-list').addEventListener('change', renderBaldrTable);
    $('bt-okonly').addEventListener('change', drawBaldrRows);
    $('bt-stop').addEventListener('click', () => { btStopFlag = true; });

    $('bt-check').addEventListener('click', async () => {
        if (btChecking || !btTargets.length) return;
        btChecking = true;
        btStopFlag = false;
        $('bt-check').disabled = true;
        $('bt-stop').style.display = 'inline-block';
        startBtTicker(); // tick already-known hospital times live while the rest of the list is still being checked

        let backoffMs = 15000;
        // One API call per target, spaced out to stay well inside Torn's request limit.
        for (let i = 0; i < btTargets.length; i++) {
            if (btStopFlag) break;
            const t = btTargets[i];
            btStatus(`Checking targets… ${i + 1} / ${btTargets.length}`);
            try {
                const res = await fetch(`https://api.torn.com/user/${t.id}?selections=profile&key=${encodeURIComponent(apiKey)}`);
                const data = await res.json();
                if (data.error) {
                    if (data.error.code === 5) { // rate limited — back off, a little longer each time it recurs
                        btStatus(`Torn API asked us to slow down — pausing ${Math.round(backoffMs / 1000)}s…`);
                        await new Promise(r => setTimeout(r, backoffMs));
                        backoffMs = Math.min(backoffMs * 1.5, 60000);
                        i--; continue;
                    }
                    t.state = 'Unknown';
                } else {
                    backoffMs = 15000; // reset after a clean response
                    t.state = data.status?.state || 'Unknown';
                    t.until = data.status?.until || null;
                }
            } catch (e) {
                t.state = 'Unknown';
            }
            const cell = $(`bt-st-${t.id}`);
            if (cell) {
                cell.textContent = btStatusLabel(t);
                cell.style.color = baldrStateColor(t.state);
                cell.style.fontWeight = t.state === 'Okay' ? '700' : '400';
            }
            await new Promise(r => setTimeout(r, 1100));
        }

        const okCount = btTargets.filter(t => t.state === 'Okay').length;
        btStatus(btStopFlag ? `Stopped. ${okCount} targets Okay so far.` : `Done — ${okCount} of ${btTargets.length} targets are Okay.`);
        if ($('bt-okonly').checked) drawBaldrRows();
        btChecking = false;
        $('bt-check').disabled = false;
        $('bt-stop').style.display = 'none';
    });

