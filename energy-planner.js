// energy-planner.js — the Weekly Energy Goals checklist.
'use strict';

    // ================= WEEKLY ENERGY GOALS =================
    const EG_STORAGE = 'wwl_energy_group'; // remembers which group this browser picked

    const EG_PLANS = {
        a: {
            title: '1,500,000+ total battle stats — 4,400 E this week',
            sub: 'Each of your 4 training days: 3 full natural energy bars, 2 Xanax, and 1 energy refill.',
            target: 4400,
            blocks: [
                { title: 'Training day 1', items: [
                    { key: 'd1nat1', label: 'Natural energy fill #1 (150 E)', value: 150 },
                    { key: 'd1nat2', label: 'Natural energy fill #2 (150 E)', value: 150 },
                    { key: 'd1nat3', label: 'Natural energy fill #3 (150 E)', value: 150 },
                    { key: 'd1xan1', label: 'Xanax #1 (250 E)', value: 250 },
                    { key: 'd1xan2', label: 'Xanax #2 (250 E)', value: 250 },
                    { key: 'd1ref', label: 'Energy refill ×1 (150 E)', value: 150 },
                ]},
                { title: 'Training day 2', items: [
                    { key: 'd2nat1', label: 'Natural energy fill #1 (150 E)', value: 150 },
                    { key: 'd2nat2', label: 'Natural energy fill #2 (150 E)', value: 150 },
                    { key: 'd2nat3', label: 'Natural energy fill #3 (150 E)', value: 150 },
                    { key: 'd2xan1', label: 'Xanax #1 (250 E)', value: 250 },
                    { key: 'd2xan2', label: 'Xanax #2 (250 E)', value: 250 },
                    { key: 'd2ref', label: 'Energy refill ×1 (150 E)', value: 150 },
                ]},
                { title: 'Training day 3', items: [
                    { key: 'd3nat1', label: 'Natural energy fill #1 (150 E)', value: 150 },
                    { key: 'd3nat2', label: 'Natural energy fill #2 (150 E)', value: 150 },
                    { key: 'd3nat3', label: 'Natural energy fill #3 (150 E)', value: 150 },
                    { key: 'd3xan1', label: 'Xanax #1 (250 E)', value: 250 },
                    { key: 'd3xan2', label: 'Xanax #2 (250 E)', value: 250 },
                    { key: 'd3ref', label: 'Energy refill ×1 (150 E)', value: 150 },
                ]},
                { title: 'Training day 4', items: [
                    { key: 'd4nat1', label: 'Natural energy fill #1 (150 E)', value: 150 },
                    { key: 'd4nat2', label: 'Natural energy fill #2 (150 E)', value: 150 },
                    { key: 'd4nat3', label: 'Natural energy fill #3 (150 E)', value: 150 },
                    { key: 'd4xan1', label: 'Xanax #1 (250 E)', value: 250 },
                    { key: 'd4xan2', label: 'Xanax #2 (250 E)', value: 250 },
                    { key: 'd4ref', label: 'Energy refill ×1 (150 E)', value: 150 },
                ]},
            ],
        },
    };

    const EG_DONATOR_KEY = 'wwl_energy_donator';

    function planForGroupB(isDonator) {
        const fillSize = isDonator ? 150 : 100;
        const dayTotal = fillSize * 3 + 250; // 3 natural fills + 1 Xanax
        const weeklyTotal = 1000 + dayTotal * 2; // stacking phase + days 3 & 4
        return {
            title: `Under 1,500,000 total battle stats — ${fmtN(weeklyTotal)} E this week`,
            sub: `First bank up energy with Xanax, then spend it all in one big jump. Days 3 & 4 are lighter, since you're newer. Natural energy bar: ${fillSize} E ${isDonator ? '(donator)' : '(no donator status yet)'}.`,
            target: weeklyTotal,
            blocks: [
                { title: 'Stacking phase — days 1 & 2', note: 'Take a Xanax roughly every 8 hours without spending the energy, until you\'re holding around 1,000 E — then spend it all in one big training session.', items: [
                    { key: 'stack1', label: 'Xanax #1 (250 E)', value: 250 },
                    { key: 'stack2', label: 'Xanax #2, ~8h later (250 E)', value: 250 },
                    { key: 'stack3', label: 'Xanax #3, ~8h later (250 E)', value: 250 },
                    { key: 'stack4', label: 'Xanax #4, ~8h later (250 E) — then do the big jump', value: 250 },
                ]},
                { title: 'Training day 3', items: [
                    { key: 'd3nat1', label: `Natural energy fill #1 (${fillSize} E)`, value: fillSize },
                    { key: 'd3nat2', label: `Natural energy fill #2 (${fillSize} E)`, value: fillSize },
                    { key: 'd3nat3', label: `Natural energy fill #3 (${fillSize} E)`, value: fillSize },
                    { key: 'd3xan', label: 'Xanax ×1 (250 E)', value: 250 },
                ]},
                { title: 'Training day 4', items: [
                    { key: 'd4nat1', label: `Natural energy fill #1 (${fillSize} E)`, value: fillSize },
                    { key: 'd4nat2', label: `Natural energy fill #2 (${fillSize} E)`, value: fillSize },
                    { key: 'd4nat3', label: `Natural energy fill #3 (${fillSize} E)`, value: fillSize },
                    { key: 'd4xan', label: 'Xanax ×1 (250 E)', value: 250 },
                ]},
            ],
        };
    }

    function getEgPlan(group) {
        if (group === 'b') {
            const isDonator = localStorage.getItem(EG_DONATOR_KEY) === '1';
            return planForGroupB(isDonator);
        }
        return EG_PLANS[group];
    }

    function isoWeekKey(d = new Date()) {
        const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        const dayNum = date.getUTCDay() || 7;
        date.setUTCDate(date.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
        const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
        return `${date.getUTCFullYear()}-W${week}`;
    }

    function egStorageKey(group) { return `wwl_energy_check_${group}_${isoWeekKey()}`; }

    function egLoadChecks(group) {
        try { return JSON.parse(localStorage.getItem(egStorageKey(group))) || {}; } catch { return {}; }
    }
    function egSaveChecks(group, checks) {
        localStorage.setItem(egStorageKey(group), JSON.stringify(checks));
    }

    let egGroup = localStorage.getItem(EG_STORAGE) || null;

    function selectEgGroup(group) {
        egGroup = group;
        localStorage.setItem(EG_STORAGE, group);
        $('eg-group-a').style.borderColor = group === 'a' ? 'var(--reagent)' : 'var(--line)';
        $('eg-group-a').style.color = group === 'a' ? 'var(--reagent)' : 'var(--text)';
        $('eg-group-b').style.borderColor = group === 'b' ? 'var(--reagent)' : 'var(--line)';
        $('eg-group-b').style.color = group === 'b' ? 'var(--reagent)' : 'var(--text)';
        renderEgPlan();
    }

    function renderEgPlan() {
        const plan = getEgPlan(egGroup);
        if (!plan) return;
        $('eg-panel').style.display = 'block';
        $('eg-title').textContent = plan.title;
        $('eg-sub').textContent = plan.sub;

        const checks = egLoadChecks(egGroup);
        const isDonator = localStorage.getItem(EG_DONATOR_KEY) === '1';

        // Donator toggle only matters (and only shows) for the under-1.5M group,
        // since their natural energy bar size depends on it (100 E vs 150 E).
        if (egGroup === 'b') {
            $('eg-donator-wrap').style.display = 'block';
            $('eg-donator').checked = isDonator;
        } else {
            $('eg-donator-wrap').style.display = 'none';
        }

        let blocksHtml = '';
        plan.blocks.forEach(block => {
            const itemsHtml = block.items.map(it => {
                const checked = checks[it.key] ? 'checked' : '';
                return `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;">
                    <input type="checkbox" class="eg-check" id="${it.key}" data-value="${it.value}" style="width:auto;" ${checked}>
                    ${esc(it.label)}
                </label>`;
            }).join('');
            blocksHtml += `
                <div class="stat" style="margin-bottom:10px;">
                    <div class="k">${esc(block.title)}</div>
                    ${block.note ? `<div class="s" style="margin:4px 0 8px;line-height:1.5;">${esc(block.note)}</div>` : ''}
                    ${itemsHtml}
                </div>`;
        });
        $('eg-days').innerHTML = blocksHtml;
        $('eg-extra').innerHTML = '';

        document.querySelectorAll('.eg-check').forEach(cb => {
            cb.addEventListener('change', () => {
                const c = egLoadChecks(egGroup);
                c[cb.id] = cb.checked;
                egSaveChecks(egGroup, c);
                updateEgProgress();
            });
        });

        updateEgProgress();
    }

    function updateEgProgress() {
        const plan = getEgPlan(egGroup);
        let done = 0;
        document.querySelectorAll('.eg-check').forEach(cb => { if (cb.checked) done += parseInt(cb.dataset.value, 10); });
        const pct = Math.min(100, (done / plan.target) * 100);
        $('eg-progress-fill').style.width = pct + '%';
        $('eg-progress-text').textContent = `${fmtN(done)} / ${fmtN(plan.target)} E`;
    }

    $('eg-group-a').addEventListener('click', () => selectEgGroup('a'));
    $('eg-group-b').addEventListener('click', () => selectEgGroup('b'));
    $('eg-donator').addEventListener('change', () => {
        localStorage.setItem(EG_DONATOR_KEY, $('eg-donator').checked ? '1' : '0');
        renderEgPlan(); // natural fill size (and the weekly target) changes with donator status
    });
    $('eg-reset').addEventListener('click', () => {
        if (!confirm("Reset this week's checklist?")) return;
        egSaveChecks(egGroup, {});
        renderEgPlan();
    });

    if (egGroup) selectEgGroup(egGroup);

