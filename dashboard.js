// dashboard.js — the Dashboard page: bars, cooldowns, notifications.
'use strict';

    // ================= DASHBOARD =================
    function barBlock(name, bar, color, fullLabel) {
        if (!bar) return '';
        const pct = Math.min(100, (bar.current / bar.maximum) * 100);
        const full = bar.fulltime > 0
            ? `full in ${Math.floor(bar.fulltime / 3600)}h ${Math.floor((bar.fulltime % 3600) / 60)}m`
            : (fullLabel || 'full');
        return `
            <div class="bar-block">
                <div class="bar-head"><span>${name}</span><span>${bar.current} / ${bar.maximum}</span></div>
                <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color};"></div></div>
                <div class="bar-sub">+${bar.increment} every ${Math.round(bar.interval / 60)} min · ${full}</div>
            </div>`;
    }

    // ---- Cooldowns (live countdown, ticks locally between refreshes) ----
    let dashCooldownEnds = {};   // { drug: epochMs|null, medical: epochMs|null, booster: epochMs|null }
    let dashCooldownTick = null;

    const COOLDOWN_LABELS = { drug: 'Drug', medical: 'Medical', booster: 'Booster' };

    function formatDuration(ms) {
        const total = Math.max(0, Math.round(ms / 1000));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    }

    function drawCooldowns() {
        const el = $('cooldowns');
        if (!el) return;
        el.innerHTML = Object.entries(COOLDOWN_LABELS).map(([key, label]) => {
            const end = dashCooldownEnds[key];
            const remaining = end ? end - Date.now() : 0;
            const ready = !end || remaining <= 0;
            return `
                <div class="stat">
                    <div class="k">${label}</div>
                    <div class="v ${ready ? 'good' : ''}">${ready ? 'Ready' : formatDuration(remaining)}</div>
                </div>`;
        }).join('');
    }

    function startCooldownTicker() {
        if (dashCooldownTick) return;
        dashCooldownTick = setInterval(drawCooldowns, 1000);
    }
    function stopCooldownTicker() {
        if (dashCooldownTick) { clearInterval(dashCooldownTick); dashCooldownTick = null; }
    }

    // Torn's API does expose both of these — donator status is a straightforward field, and the
    // active_gym field (from the 'gym' selection) tells us which gym the player is in right now.
    // Manual overrides are kept as a fallback in case a key's access level doesn't return one of
    // these, or a lookup fails.
    const GYM_COST_KEY = 'wwl_gym_energy_cost';
    const DONATOR_KEY = 'wwl_energy_donator';
    const GYM_DIRECTORY_CACHE_KEY = 'wwl_gym_directory_cache';
    let dashGymAutoChecked = false;  // only attempt the gym-directory lookup once per session
    let dashGymAutoDetected = false; // becomes true once auto-detection actually succeeds
    function getGymCost() { return Number(localStorage.getItem(GYM_COST_KEY)) || 10; }
    function isDonatorStatus() { return localStorage.getItem(DONATOR_KEY) === '1'; }

    // Torn's own official gym directory — maps each gym's ID to its per-train energy cost, so we
    // don't have to maintain that list ourselves. Cached in localStorage for the session since it
    // never changes; refetched if missing.
    async function getGymEnergyCost(activeGymId) {
        if (activeGymId == null) return null;
        try {
            let directory = JSON.parse(sessionStorage.getItem(GYM_DIRECTORY_CACHE_KEY) || 'null');
            if (!directory) {
                const res = await fetch(`https://api.torn.com/torn/?selections=gyms&key=${encodeURIComponent(apiKey)}`);
                const data = await res.json();
                if (data.error) return null;
                directory = data.gyms || null;
                if (directory) sessionStorage.setItem(GYM_DIRECTORY_CACHE_KEY, JSON.stringify(directory));
            }
            const entry = directory?.[activeGymId];
            const cost = entry?.energy ?? entry?.energy_per_train ?? entry?.cost ?? null;
            return cost != null ? Number(cost) : null;
        } catch (e) { return null; }
    }

    function renderDashboard() {
        if (!profile) return;
        $('dash-greeting').textContent = `Welcome back, ${profile.name} [${profile.player_id}]`;
        $('dash-sub').textContent = profile.faction?.faction_name
            ? `${profile.faction.position} of ${profile.faction.faction_name}`
            : 'No faction on record';
        $('whoami').innerHTML = `<b>${esc(profile.name)}</b> [${profile.player_id}]`;

        $('bars').innerHTML =
            barBlock('Energy', profile.energy, 'var(--energy)') +
            barBlock('Nerve', profile.nerve, 'var(--nerve)', 'full — ready for a crime!') +
            barBlock('Happy', profile.happy, 'var(--happy)') +
            barBlock('Life', profile.life, 'var(--life)');

        const e = profile.energy;
        // Auto-detect donator status straight from the API — falls back to the manual toggle's
        // last value only if the field genuinely isn't present on this key.
        const donatorDetected = profile.donator != null ? !!profile.donator : null;
        const donator = donatorDetected != null ? donatorDetected : isDonatorStatus();
        if (donatorDetected != null) localStorage.setItem(DONATOR_KEY, donator ? '1' : '0');
        const naturalPerDay = donator ? 720 : 480; // 5E every 10min (donator) vs every 15min (non-donator)

        let gymCost = getGymCost();
        const trainsNow = e ? Math.floor(e.current / gymCost) : 0;
        const notif = profile.notifications || {};
        const unread = (notif.messages || 0) + (notif.events || 0) + (notif.awards || 0);
        $('glance').innerHTML = `
            <div class="stat"><div class="k">Level</div><div class="v">${profile.level ?? '—'}</div></div>
            <div class="stat"><div class="k">Energy now</div><div class="v good">${e ? e.current : '—'}</div>
                <div class="s">≈ ${trainsNow} trains @
                    <select id="dash-gym-cost" style="font-size:11px;background:transparent;color:inherit;border:1px solid var(--line);border-radius:4px;">
                        <option value="5">5E</option>
                        <option value="10">10E</option>
                        <option value="25">25E</option>
                        <option value="50">50E</option>
                    </select> gym ${dashGymAutoDetected ? '<span style="color:var(--muted);">(auto-detected)</span>' : ''}
                </div></div>
            <div class="stat"><div class="k">Natural E / day</div><div class="v">${naturalPerDay}</div>
                <div class="s">+5 every ${donator ? '10' : '15'} min ·
                    <label style="cursor:pointer;"><input type="checkbox" id="dash-donator-toggle" style="width:auto;vertical-align:middle;" ${donatorDetected != null ? 'disabled' : ''}> donator</label>
                    ${donatorDetected != null ? '<span style="color:var(--muted);">(auto-detected)</span>' : ''}
                </div></div>
            <div class="stat"><div class="k">Notifications</div><div class="v ${unread ? '' : 'good'}">${unread || '0'}</div>
                <div class="s">${notif.messages || 0} msg · ${notif.events || 0} events · ${notif.awards || 0} awards</div></div>`;

        const gymSel = $('dash-gym-cost');
        gymSel.value = String(gymCost);
        gymSel.addEventListener('change', () => {
            localStorage.setItem(GYM_COST_KEY, gymSel.value);
            renderDashboard();
        });
        const donatorCb = $('dash-donator-toggle');
        donatorCb.checked = donator;
        donatorCb.addEventListener('change', () => {
            localStorage.setItem(DONATOR_KEY, donatorCb.checked ? '1' : '0');
            renderDashboard();
        });

        // Try to auto-detect the current gym's energy cost. This part is less certain than
        // donator detection (Torn's official gym-directory field names weren't something I could
        // fully verify), so it only overrides the dropdown if it gets back a sane number —
        // otherwise your manual selection above just keeps working as before.
        if (profile.active_gym != null && !dashGymAutoChecked) {
            dashGymAutoChecked = true;
            getGymEnergyCost(profile.active_gym).then(cost => {
                if (cost && [5, 10, 25, 50].includes(cost) && cost !== gymCost) {
                    localStorage.setItem(GYM_COST_KEY, String(cost));
                    dashGymAutoDetected = true;
                    renderDashboard();
                }
            });
        }

        const cd = profile.cooldowns || {};
        const now = Date.now();
        dashCooldownEnds = {
            drug: cd.drug > 0 ? now + cd.drug * 1000 : null,
            medical: cd.medical > 0 ? now + cd.medical * 1000 : null,
            booster: cd.booster > 0 ? now + cd.booster * 1000 : null,
        };
        drawCooldowns();
        startCooldownTicker();
    }

    $('refresh-bars').addEventListener('click', async () => {
        try {
            profile = await tornV1('profile,bars,cooldowns,notifications,gym,personalstats');
            renderDashboard();
            toast('Bars refreshed');
        } catch (e) { toast('Refresh failed'); }
    });

