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
        const trainsNow = e ? Math.floor(e.current / 10) : 0;
        const notif = profile.notifications || {};
        const unread = (notif.messages || 0) + (notif.events || 0) + (notif.awards || 0);
        $('glance').innerHTML = `
            <div class="stat"><div class="k">Level</div><div class="v">${profile.level ?? '—'}</div></div>
            <div class="stat"><div class="k">Energy now</div><div class="v good">${e ? e.current : '—'}</div>
                <div class="s">≈ ${trainsNow} trains @10E</div></div>
            <div class="stat"><div class="k">Natural E / day</div><div class="v">${NATURAL_REGEN_PER_DAY}</div>
                <div class="s">+5 every 15 min</div></div>
            <div class="stat"><div class="k">Notifications</div><div class="v ${unread ? '' : 'good'}">${unread || '0'}</div>
                <div class="s">${notif.messages || 0} msg · ${notif.events || 0} events · ${notif.awards || 0} awards</div></div>`;

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
            profile = await tornV1('profile,bars,cooldowns,notifications');
            renderDashboard();
            toast('Bars refreshed');
        } catch (e) { toast('Refresh failed'); }
    });

