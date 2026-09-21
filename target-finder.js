// target-finder.js — FFScouter-powered target finder (custom search + manual list),
// with live status refresh. Reuses a couple of small helpers from level-targets.js.
'use strict';

    // ================= TARGET FINDER (FFScouter) =================
    // FFScouter (ffscouter.com) is a separate, independent service — not run by us.
    // It estimates opponents' battle stats from crowd-sourced Fair Fight data.
    // We only ever call its public API; the actual estimation model lives on their servers.
    const FF_API = 'https://ffscouter.com/api/v1';
    let ffChecked = false;   // have we run check-key this session?
    let ffRegistered = false;
    let tfMode = 'custom';

    async function ffCheckKey() {
        const res = await fetch(`${FF_API}/check-key?key=${encodeURIComponent(apiKey)}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        return data; // { is_registered, is_premium, ... }
    }

    async function ffRegisterKey() {
        const res = await fetch(`${FF_API}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: apiKey, agree_to_data_policy: true, signup_source: 'WorldWideLabs' }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Registration failed');
        return data;
    }

    async function initTargetFinder() {
        if (ffChecked) return; // only check once per session — check-key is rate-limited (10/min/IP)
        ffChecked = true;
        try {
            const info = await ffCheckKey();
            ffRegistered = !!info.is_registered;
        } catch (e) {
            $('tf-loading').innerHTML = `<p style="color:var(--danger);margin:0;">Could not reach FFScouter: ${esc(e.message)}. Try again shortly.</p>`;
            ffChecked = false; // allow retry on next visit to the tab
            return;
        }
        $('tf-loading').style.display = 'none';
        if (ffRegistered) {
            $('tf-tool').style.display = 'block';
            selectTfMode('custom');
        } else {
            $('tf-register-panel').style.display = 'block';
        }
    }

    $('tf-agree').addEventListener('change', () => {
        $('tf-register-btn').disabled = !$('tf-agree').checked;
    });

    $('tf-register-btn').addEventListener('click', async () => {
        const btn = $('tf-register-btn');
        btn.disabled = true;
        btn.textContent = 'Registering…';
        try {
            await ffRegisterKey();
            ffRegistered = true;
            $('tf-register-panel').style.display = 'none';
            $('tf-tool').style.display = 'block';
            selectTfMode('custom');
        } catch (e) {
            const st = $('tf-register-status');
            st.className = 'status err';
            st.textContent = esc(e.message);
            btn.disabled = false;
            btn.textContent = 'Register with FFScouter';
        }
    });

    function selectTfMode(mode) {
        tfMode = mode;
        const modes = ['respect', 'level', 'custom', 'manual'];
        modes.forEach(m => {
            const btn = $(`tf-mode-${m}`);
            btn.style.borderColor = mode === m ? 'var(--reagent)' : 'var(--line)';
            btn.style.color = mode === m ? 'var(--reagent)' : 'var(--text)';
            $(`tf-${m}-panel`).style.display = mode === m ? 'block' : 'none';
        });
        $('tf-results-panel').style.display = 'none';
        stopTfLive();
    }
    $('tf-mode-respect').addEventListener('click', () => selectTfMode('respect'));
    $('tf-mode-level').addEventListener('click', () => selectTfMode('level'));
    $('tf-mode-custom').addEventListener('click', () => selectTfMode('custom'));
    $('tf-mode-manual').addEventListener('click', () => selectTfMode('manual'));

    // ---- Preset searches: GET /get-targets?preset=respect|level ----
    // Presets only accept "key" and "limit" — Torn-side validation rejects any other parameter
    // when a preset is set, so these stay deliberately minimal.
    async function runTfPreset(preset, limitElId, statusElId, btnElId) {
        const btn = $(btnElId);
        btn.disabled = true; btn.textContent = 'Searching…';
        tfStatus(statusElId, '');
        try {
            const params = new URLSearchParams({
                key: apiKey,
                preset,
                limit: Math.min(50, Math.max(1, parseInt($(limitElId).value, 10) || 20)),
            });
            const res = await fetch(`${FF_API}/get-targets?${params.toString()}`);
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            const rows = (data.targets || []).map(t => ({
                id: t.player_id, name: t.name || `User #${t.player_id}`, level: t.level,
                ff: t.fair_fight, estHuman: t.bs_estimate_human,
                state: null, until: null, lastAction: t.last_action,
            }));
            renderTfResults(rows);
            tfStatus(statusElId, `${rows.length} target(s) found.`, false);
        } catch (e) {
            tfStatus(statusElId, e.message, true);
        } finally {
            btn.disabled = false; btn.textContent = 'Search';
        }
    }
    $('tf-respect-btn').addEventListener('click', () => runTfPreset('respect', 'tf-respect-limit', 'tf-respect-status', 'tf-respect-btn'));
    $('tf-level-btn').addEventListener('click', () => runTfPreset('level', 'tf-level-limit', 'tf-level-status', 'tf-level-btn'));

    function tfStatus(elId, msg, isErr) {
        const el = $(elId);
        el.className = 'status ' + (msg ? (isErr ? 'err' : 'ok') : '');
        el.textContent = msg || '';
    }

    function relativeTime(epochSeconds) {
        if (!epochSeconds) return '—';
        const diff = Math.max(0, Date.now() / 1000 - epochSeconds);
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return `${Math.floor(diff / 86400)}d ago`;
    }

    let tfResults = [];       // current result rows, shared by rendering, live refresh, and the ticker
    let tfLiveOn = false;
    let tfLiveRunning = false;
    let tfTickHandle = null;

    function renderTfResults(rows) {
        // rows: [{ id, name, level, ff, estHuman, state, until, lastAction }]
        tfResults = rows;
        stopTfLive();
        drawTfRows();
        if (typeof tfAutoStatus === 'function') tfAutoStatus();
        $('tf-results-panel').style.display = 'block';
        $('tf-results-panel').scrollIntoView({ behavior: 'smooth' });
    }

    function tfStatusCell(r) {
        // Reuses the same state/until model (and countdown formatting) as Level Targets.
        if (r.state) return btStatusLabel(r);
        return relativeTime(r.lastAction); // no live status fetched yet — fall back to "last seen"
    }

    function drawTfRows() {
        $('tf-results-body').innerHTML = tfResults.length ? tfResults.map(r => `
            <tr>
                <td><a href="https://www.torn.com/profiles.php?XID=${r.id}" target="_blank" rel="noopener">${esc(r.name)} [${r.id}]</a></td>
                <td class="num">${r.level ?? '—'}</td>
                <td class="num" style="font-family:var(--mono);">${r.ff != null ? r.ff.toFixed(2) : '—'}</td>
                <td class="num" style="font-family:var(--mono);">${esc(r.estHuman || '—')}</td>
                <td id="tf-st-${r.id}" style="color:${baldrStateColor(r.state)};font-size:12px;font-weight:${r.state === 'Okay' ? '700' : '400'};">${esc(tfStatusCell(r))}</td>
                <td><a href="https://www.torn.com/page.php?sid=attack&user2ID=${r.id}" target="_blank" rel="noopener"
                       style="background:var(--reagent);color:#06130d;padding:4px 10px;border-radius:4px;text-decoration:none;font-weight:600;font-size:12px;">Attack</a></td>
            </tr>`).join('') : `<tr><td colspan="6" style="color:var(--muted)">No results.</td></tr>`;
    }

    // ---- Live updates: continuously re-checks every listed target's live status ----
    $('tf-live').addEventListener('change', () => {
        tfLiveOn = $('tf-live').checked;
        if (tfLiveOn) startTfLive(); else $('tf-live-status').textContent = 'paused';
    });

    function stopTfLive() {
        tfLiveOn = false;
        $('tf-live').checked = false;
        $('tf-live-status').textContent = '';
        if (tfTickHandle) { clearInterval(tfTickHandle); tfTickHandle = null; }
    }

    function startTfTicker() {
        if (tfTickHandle) return;
        tfTickHandle = setInterval(() => {
            let flipped = false;
            for (const r of tfResults) {
                if (r.state !== 'Hospital') continue;
                const before = r.state;
                const label = btStatusLabel(r); // mutates r.state to 'Okay' once the timer hits zero
                const cell = $(`tf-st-${r.id}`);
                if (cell) {
                    cell.textContent = label;
                    cell.style.color = baldrStateColor(r.state);
                    cell.style.fontWeight = r.state === 'Okay' ? '700' : '400';
                }
                if (before !== r.state) flipped = true;
            }
            if (flipped) tfResults.sort((a, b) => (a.state === 'Okay' ? -1 : 0) - (b.state === 'Okay' ? -1 : 0));
        }, 1000);
    }

    async function startTfLive() {
        startTfTicker();
        if (tfLiveRunning) return; // a pass is already in flight — it'll pick up the new tfLiveOn state itself
        tfLiveRunning = true;
        let backoffMs = 15000;
        try {
            while (tfLiveOn) {
                for (let i = 0; i < tfResults.length && tfLiveOn; i++) {
                    const r = tfResults[i];
                    $('tf-live-status').textContent = `refreshing ${i + 1}/${tfResults.length}`;
                    try {
                        const res = await fetch(`https://api.torn.com/user/${r.id}?selections=profile&key=${encodeURIComponent(apiKey)}`);
                        const data = await res.json();
                        if (data.error) {
                            if (data.error.code === 5) {
                                $('tf-live-status').textContent = `rate limited — pausing ${Math.round(backoffMs / 1000)}s`;
                                await new Promise(res => setTimeout(res, backoffMs));
                                backoffMs = Math.min(backoffMs * 1.5, 60000);
                                i--; continue;
                            }
                        } else {
                            backoffMs = 15000;
                            r.state = data.status?.state || 'Unknown';
                            r.until = data.status?.until || null;
                            const cell = $(`tf-st-${r.id}`);
                            if (cell) {
                                cell.textContent = btStatusLabel(r);
                                cell.style.color = baldrStateColor(r.state);
                                cell.style.fontWeight = r.state === 'Okay' ? '700' : '400';
                            }
                        }
                    } catch (e) { /* skip this target this pass, try again next pass */ }
                    await new Promise(res => setTimeout(res, 1100));
                }
                tfResults.sort((a, b) => (a.state === 'Okay' ? -1 : 0) - (b.state === 'Okay' ? -1 : 0));
                if (tfLiveOn) drawTfRows();
                if (!tfLiveOn) break;
                $('tf-live-status').textContent = 'pass complete — refreshing again';
                await new Promise(res => setTimeout(res, 3000));
            }
        } finally {
            tfLiveRunning = false;
            $('tf-live-status').textContent = tfLiveOn ? '' : 'paused';
        }
    }

    // ---- Custom search: GET /get-targets ----
    $('tf-search-btn').addEventListener('click', async () => {
        const btn = $('tf-search-btn');
        btn.disabled = true; btn.textContent = 'Searching…';
        tfStatus('tf-custom-status', '');
        try {
            const params = new URLSearchParams({
                key: apiKey,
                minlevel: $('tf-minlevel').value || 1,
                maxlevel: $('tf-maxlevel').value || 100,
                minff: parseFloat($('tf-minff').value || 1).toFixed(2),
                maxff: parseFloat($('tf-maxff').value || 3).toFixed(2),
                limit: Math.min(50, Math.max(1, parseInt($('tf-limit').value, 10) || 20)),
                inactiveonly: $('tf-inactive').checked ? 1 : 0,
                factionless: $('tf-factionless').checked ? 1 : 0,
            });
            const res = await fetch(`${FF_API}/get-targets?${params.toString()}`);
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            const rows = (data.targets || []).map(t => ({
                id: t.player_id, name: t.name || `User #${t.player_id}`, level: t.level,
                ff: t.fair_fight, estHuman: t.bs_estimate_human,
                state: null, until: null, lastAction: t.last_action,
            }));
            renderTfResults(rows);
            tfStatus('tf-custom-status', `${rows.length} target(s) found.`, false);
        } catch (e) {
            tfStatus('tf-custom-status', e.message, true);
        } finally {
            btn.disabled = false; btn.textContent = 'Search';
        }
    });

    // ---- Manual list: GET /get-stats, enriched with live Torn name/level/status ----
    $('tf-lookup-btn').addEventListener('click', async () => {
        const btn = $('tf-lookup-btn');
        const raw = $('tf-manual-ids').value;
        const ids = [...new Set(raw.split(/[\s,]+/).map(s => s.trim()).filter(s => /^\d+$/.test(s)))];
        if (!ids.length) { tfStatus('tf-manual-status', 'Paste at least one numeric player ID.', true); return; }

        btn.disabled = true; btn.textContent = 'Looking up…';
        tfStatus('tf-manual-status', `Fetching Fair Fight estimates for ${ids.length} target(s)…`);
        try {
            // FFScouter accepts many IDs per call — batch generously to stay well under its rate limit.
            const ffMap = new Map();
            for (let i = 0; i < ids.length; i += 200) {
                const batch = ids.slice(i, i + 200);
                const res = await fetch(`${FF_API}/get-stats?key=${encodeURIComponent(apiKey)}&targets=${batch.join(',')}`);
                const data = await res.json();
                if (data.error) throw new Error(data.error);
                (Array.isArray(data) ? data : []).forEach(d => ffMap.set(String(d.player_id), d));
            }

            // Enrich with live name/level/status directly from Torn — one call per target, paced.
            const rows = [];
            for (let i = 0; i < ids.length; i++) {
                const id = ids[i];
                tfStatus('tf-manual-status', `Fetching player info… ${i + 1} / ${ids.length}`);
                let name = `User #${id}`, level = null, state = null, until = null;
                try {
                    const res = await fetch(`https://api.torn.com/user/${id}?selections=profile&key=${encodeURIComponent(apiKey)}`);
                    const data = await res.json();
                    if (!data.error) {
                        name = data.name || name;
                        level = data.level;
                        state = data.status?.state || 'Unknown';
                        until = data.status?.until || null;
                    }
                } catch (e) { /* keep the placeholder — FF/estimate below still shows */ }
                const ff = ffMap.get(id);
                rows.push({
                    id, name, level,
                    ff: ff?.fair_fight ?? null,
                    estHuman: ff?.bs_estimate_human ?? null,
                    state, until,
                });
                await new Promise(r => setTimeout(r, 1100));
            }

            rows.sort((a, b) => (a.ff ?? 999) - (b.ff ?? 999)); // easiest fights first
            renderTfResults(rows);
            tfStatus('tf-manual-status', `Done — ${rows.length} target(s).`, false);
        } catch (e) {
            tfStatus('tf-manual-status', e.message, true);
        } finally {
            btn.disabled = false; btn.textContent = 'Look up';
        }
    });
