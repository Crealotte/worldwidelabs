// energy-planner.js — the Weekly Energy Goals checklist.
'use strict';

    // ================= WEEKLY ENERGY GOALS =================
    const EG_STORAGE = 'wwl_energy_group'; // remembers which group this browser picked
    const EG_DONATOR_KEY = 'wwl_energy_donator'; // shared with the Dashboard's auto-detection

    // Donator status is auto-detected straight from the API (same field the Dashboard reads) —
    // no more manual toggling. profile.donator is checked first since it's always fresh; the
    // stored value is just a fallback for the rare case a key's access level doesn't return it.
    function isDonatorStatus() {
        if (typeof profile !== 'undefined' && profile?.donator != null) return !!profile.donator;
        return localStorage.getItem(EG_DONATOR_KEY) === '1';
    }

    function planForGroupA(isDonator) {
        const fillSize = isDonator ? 150 : 100;
        const dayTotal = fillSize * 3 + 250 * 2 + fillSize; // 3 natural fills + 2 Xanax + 1 refill
        const weeklyTotal = dayTotal * 4;
        const days = [1, 2, 3, 4].map(n => ({
            title: `Training day ${n}`,
            items: [
                { key: `d${n}nat1`, label: `Natural energy fill #1 (${fillSize} E)`, value: fillSize },
                { key: `d${n}nat2`, label: `Natural energy fill #2 (${fillSize} E)`, value: fillSize },
                { key: `d${n}nat3`, label: `Natural energy fill #3 (${fillSize} E)`, value: fillSize },
                { key: `d${n}xan1`, label: 'Xanax #1 (250 E)', value: 250 },
                { key: `d${n}xan2`, label: 'Xanax #2 (250 E)', value: 250 },
                { key: `d${n}ref`, label: `Energy refill ×1 (${fillSize} E)`, value: fillSize },
            ],
        }));
        return {
            title: `1,500,000+ total battle stats — ${fmtN(weeklyTotal)} E this week`,
            sub: `Each of your 4 training days: 3 full natural energy bars, 2 Xanax, and 1 energy refill. Natural energy bar: ${fillSize} E ${isDonator ? '(donator)' : '(no donator status)'}.`,
            target: weeklyTotal,
            blocks: days,
        };
    }

    function planForGroupB(isDonator) {
        const fillSize = isDonator ? 150 : 100;
        const dayTotal = fillSize * 3 + 250; // 3 natural fills + 1 Xanax
        const weeklyTotal = 1000 + dayTotal * 2; // stacking phase + days 3 & 4
        return {
            title: `Under 1,500,000 total battle stats — ${fmtN(weeklyTotal)} E this week`,
            sub: `First bank up energy with Xanax, then spend it all in one big jump. Days 3 & 4 are lighter, since you're newer. Natural energy bar: ${fillSize} E ${isDonator ? '(donator)' : '(no donator status)'}.`,
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
        const isDonator = isDonatorStatus();
        if (group === 'a') return planForGroupA(isDonator);
        if (group === 'b') return planForGroupB(isDonator);
        return null;
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

    // ================= HAPPY JUMPING GUIDE =================
    const HAPPY_JUMP_INTRO = [
        'Your baseline max Happy comes from your property — better property, higher base Happy, bigger passive training gains even without jumping.',
        'Gains scale exponentially with Happy, not linearly — doubling your Happy gives you more than double the gym gains for the same Energy.',
        'Training costs you roughly 40–60% of the Energy spent back off your Happy bar, so never train when Happy is already low.',
        'Worth reconsidering Happy jumping once you\'re around 1.6M total stats (400k each) — this may shift now that the old 50M stat cap is gone.',
        'Happy resets to your property\'s max at :00, :15, :30, and :45 past the hour — always start taking boosting items right after one of these resets, or a premature reset wastes everything you just spent.',
    ];

    const HAPPY_JUMPS = [
        {
            name: 'Lollipop Jump', cost: '$89,000', property: 'Shack (no requirement)',
            items: ['49x Lollipop — 1,225 Happy', '1x Ecstasy — doubles current Happy'],
            steps: [
                'Buy all items',
                'Wait for Energy to reach your max (100, or 150 for donators)',
                'Wait until just past a 15-minute reset',
                'Consume all 49 Lollipops',
                'Use the Ecstasy to double your Happy',
                'Spend your Energy training in the gym',
            ],
            tip: 'Good for newbies under level 15 — often faction-funded since it also helps you hit harder in chains. Repeatable every 24h once the booster cooldown clears.',
        },
        {
            name: 'Big Choco Jump', cost: '$1,400,000 – $5,100,000', property: 'Mansion, max upgrades, no staff',
            items: ['1–4x Xanax (see variants below)', '49x Big Box of Chocolate Bars — 1,715 Happy', '1x Ecstasy', '25 Points — 4-Xanax variant only'],
            steps: [
                '1 Xanax variant: take 1 Xanax, wait out the 6–8h drug cooldown, then chocolate → Ecstasy → train',
                '4 Xanax variant: stack 4 Xanax back-to-back to reach 1000 Energy, wait out all cooldowns, then chocolate → Ecstasy → train, then spend 25 Points on an Energy refill and train again',
            ],
            tip: 'The 1-Xanax variant is the cheap daily option. The 4-Xanax variant pushes further without going all-in on EDVDs — good middle ground before you\'re ready to spend $21M+ per jump.',
        },
        {
            name: '5x EDVD Jump', cost: '$21,000,000', property: 'Private Island, max upgrades, no staff',
            items: ['4x Xanax', '5x Erotic DVD — 12,500 Happy (25,000 with a 10★ Adult Novelties job)', '1x Ecstasy', '25 Points'],
            steps: [
                'Stack 4 Xanax back-to-back to reach 1000 Energy',
                'Wait out all drug cooldowns',
                'Wait until just past a 15-minute reset',
                'Consume all 5 Erotic DVDs',
                'Use Ecstasy to double your Happy',
                'Train, then spend 25 Points on a refill and train again',
            ],
            tip: 'Working a 10★ Adult Novelties Shop job doubles your EDVD gains (12,500 → 25,000 Happy) — worth arranging before doing this method regularly.',
        },
        {
            name: '9x EDVD Jump', cost: '$32,000,000 + a "Book: Ignorance is Bliss"', property: 'Private Island, max upgrades, max staff',
            items: ['4x Xanax', '9x Erotic DVD — 45,000 Happy (with a 10★ AN job)', '1x Ecstasy', '25 Points', '1x Book: Ignorance is Bliss'],
            steps: [
                'Requires Donator/Subscriber status — the Book only comes from monthly donator/subscriber gifts (RNG, better odds if you missed the previous month), or rarely as a mission reward from Duke',
                'Work a 10★ Adult Novelties Shop job first',
                'Stack 4 Xanax to 1000 Energy, wait out cooldowns',
                'Consume all 9 Erotic DVDs, then Ecstasy, then train, then refill with 25 Points and train again',
                'For the rest of the Book\'s 31-day duration: repeat stacking Xanax + Ecstasy (without more EDVDs) to keep training at max Happy',
            ],
            tip: 'Can get very expensive in Xanax if you overdose — a faction with good overdose reduction matters a lot here. Only start this if you can genuinely fund a month of Xanax and Ecstasy.',
        },
        {
            name: 'Poison Mistletoe Jump', cost: '$40,000,000 – $60,000,000', property: 'Private Island, max upgrades, no staff',
            items: ['4x Xanax', '2x Poison Mistletoe', '1x Ecstasy', '25 Points', 'A partner with an active Book: Ignorance is Bliss'],
            steps: [
                'Find a partner (often a paid "Happy Jump Service") who has the Book active and has boosted to 99k Happy',
                'Stack your own 4 Xanax to 1000 Energy and wait out cooldowns',
                'Right after a 15-minute reset, use 2 Poison Mistletoe on your partner — this takes 25% of their Happy and gives it to you',
                'Use Ecstasy to double what you just took',
                'Train, then refill with 25 Points and train again',
                'Move fast — the next person in the chain needs their turn before the next 15-minute reset',
            ],
            tip: 'Usually a paid service (check the trade forums) — the "Service Provider" typically wants EDVDs as payment. Also lets you use Energy drinks afterward, since you\'re not relying on your own Boosters for the Happy.',
        },
    ];

    function renderHappyJumps() {
        $('eg-jump-intro').innerHTML = HAPPY_JUMP_INTRO.map(b => `<li>${esc(b)}</li>`).join('');
        $('eg-jumps').innerHTML = HAPPY_JUMPS.map((j, i) => `
            <div class="ocfit-scenario" data-collapse="eg-jump-${i}" style="margin-bottom:10px;">
                <div class="ocfit-scenario-header">
                    <span>${esc(j.name)}</span>
                    <span style="font-size:11px;color:var(--muted);">${esc(j.cost)}</span>
                    <span class="chev">▾</span>
                </div>
                <div class="ocfit-scenario-body">
                    <div class="crimes-subhead" style="margin-top:0;">🏠 Property needed</div>
                    <p style="margin:0 0 10px;">${esc(j.property)}</p>
                    <div class="crimes-subhead">🎒 Items needed</div>
                    <ul class="crimes-bullets">${j.items.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
                    <div class="crimes-subhead">📋 Steps</div>
                    <ul class="crimes-bullets">${j.steps.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
                    <div class="crimes-tip">💡 ${esc(j.tip)}</div>
                </div>
            </div>`).join('');
        $('eg-jumps').querySelectorAll('.ocfit-scenario-header').forEach(header => {
            header.addEventListener('click', () => header.closest('.ocfit-scenario').classList.toggle('collapsed'));
        });
    }
    renderHappyJumps();

    $('eg-group-a').addEventListener('click', () => selectEgGroup('a'));
    $('eg-group-b').addEventListener('click', () => selectEgGroup('b'));
    $('eg-reset').addEventListener('click', () => {
        if (!confirm("Reset this week's checklist?")) return;
        egSaveChecks(egGroup, {});
        renderEgPlan();
    });

    if (egGroup) selectEgGroup(egGroup);

