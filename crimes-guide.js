// crimes-guide.js — WorldWideLabs Crimes 2.0 Guide (individual/solo crimes, not OC).
// Phase 1: static reference built from real in-game screenshots + community guides, fed in one
// crime at a time. Phase 2 (later): live per-crime CS% + nerve-based ETA once the user->crimes
// API selection has been verified against a real sample.
'use strict';

let crimesGuideLoaded = false;
let cgActiveCrime = null;
let cgActiveTab = 'overview';
let cgMeritCache = null; // avoid refetching honors every tab switch

// Order and names match the in-game hub exactly (confirmed via screenshot). Category is only
// filled in where a source has actually confirmed it — left blank rather than guessed otherwise.
// guideStatus: 'ready' once a real guide has been turned into structured content below.
const CRIMES_DATA = [
    { id: 'searchforcash', name: 'Search For Cash', icon: '💵', category: 'Theft', nerveCost: 2, guideStatus: 'ready' },
    { id: 'bootlegging', name: 'Bootlegging', icon: '🍾', category: null, nerveCost: null, guideStatus: 'pending' },
    { id: 'graffiti', name: 'Graffiti', icon: '🎨', category: null, nerveCost: null, guideStatus: 'pending' },
    { id: 'shoplifting', name: 'Shoplifting', icon: '🛍️', category: 'Theft', nerveCost: null, guideStatus: 'pending' },
    { id: 'pickpocketing', name: 'Pickpocketing', icon: '🤏', category: 'Theft', nerveCost: null, guideStatus: 'pending' },
    { id: 'cardskimming', name: 'Card Skimming', icon: '💳', category: null, nerveCost: null, guideStatus: 'pending' },
    { id: 'burglary', name: 'Burglary', icon: '🏚️', category: 'Theft', nerveCost: null, guideStatus: 'pending' },
    { id: 'hustling', name: 'Hustling', icon: '🎭', category: null, nerveCost: null, guideStatus: 'pending' },
    { id: 'disposal', name: 'Disposal', icon: '🧟', category: 'Illicit Services', nerveCost: null, guideStatus: 'pending' },
    { id: 'cracking', name: 'Cracking', icon: '💣', category: null, nerveCost: null, guideStatus: 'pending' },
    { id: 'forgery', name: 'Forgery', icon: '📄', category: null, nerveCost: null, guideStatus: 'pending' },
    { id: 'scamming', name: 'Scamming', icon: '☎️', category: null, nerveCost: null, guideStatus: 'pending' },
    { id: 'arson', name: 'Arson', icon: '🔥', category: null, nerveCost: null, guideStatus: 'pending' },
];

// ---- Search For Cash — fully populated from the guide + real screenshot ----
const SEARCH_FOR_CASH = {
    summary: 'The first crime in Crimes 2.0. Six searchable locations, each with its own success-rate cycle. Cheap at 2 nerve per attempt, making it a good early skill-grinding crime.',
    // null until we have a real figure from a guide — never fabricated. Set as {min, max} nerve.
    estimatedNerveToCS100: null,
    keyItems: [
        { name: 'Glasses', effect: 'Enhancer — +5% CE & CS gains', source: 'Search the Subway, or pickpocketing a businesswoman' },
        { name: 'Metal Detector', effect: 'Unlocks Search the Beach', source: 'Search the Junkyard, from CS30' },
        { name: 'Cemetery Key', effect: 'Unlocks Search the Cemetery', source: 'Search the Beach, from CS50' },
        { name: 'Lost and Found Office Key', effect: 'Unlocks extra outcomes at the Subway (not a new location)', source: 'Search the Subway, from CS85' },
    ],
    locations: [
        {
            name: 'Search the Trash', unlock: null,
            cycle: [
                'Weekly cycle',
                'Resets to 0% Monday 18:00 TCT',
                'Rises steadily through the week',
                'Peaks early Monday morning, just before 08:00 TCT',
                'Then drops sharply back to 0%',
            ],
            highlights: [
                '86% of searches → small cash payout',
                '14% → an item',
                'Only source of the 7 "rotten" items (needed for the Spoiled Rotten honor bar)',
                'Also gives Card Skimmers and Spray Cans (materials for later crimes)',
            ],
            tip: 'Best location specifically for grinding toward Spoiled Rotten — otherwise the weakest location for value.',
        },
        {
            name: 'Search the Subway', unlock: null,
            cycle: [
                'Daily cycle',
                'Tracks how many players are currently active, not a fixed day/week pattern',
            ],
            highlights: [
                'Higher chance of cash than items, similar to Trash',
                'Billfolds are the standout item (~9% chance)',
                'Office Key (found here at CS85) unlocks extra outcomes at this same location',
                'Glasses enhancer can also turn up here',
            ],
            tip: 'The most time-consistent location since it tracks player activity, not a day/week cycle.',
        },
        {
            name: 'Search the Junkyard', unlock: null,
            cycle: [
                'Weekly cycle',
                'Best on Sunday and Monday morning',
                'Noticeably less consistent the rest of the week',
            ],
            highlights: [
                'Highest item-drop rate of any location',
                'Source of the Metal Detector (unlocks the Beach)',
                'Usually the first place new crime materials/enhancers get added',
                'Also gives Spray Cans, Card Skimmers, Spy Cameras, Rope, Blank DVDs, and Computer Parts',
            ],
            tip: 'Probably the single best all-round location — item variety plus first dibs on new materials.',
        },
        {
            name: 'Search the Beach', unlock: 'Metal Detector (from Junkyard, CS30+)',
            cycle: [
                'Tidal cycle — high tide and low tide',
                'Varies both within a single day and again across the month',
            ],
            highlights: [
                'Mostly junk loot',
                'Highest hospitalization risk of any location',
                'Source of the Cemetery Key',
                'Sand only appears during low tide (70%+) — a Bucket improves the odds',
                'Sand is needed for Forgery (likely Arson too), and grants the Shore Thing honor bar (can take up to ~600 nerve)',
            ],
            tip: 'Time your visits to low tide specifically when hunting Sand.',
        },
        {
            name: 'Search the Cemetery', unlock: 'Cemetery Key (from Beach, CS50+)',
            cycle: [
                'The most consistent location of all six',
                'Flat 75% success rate normally',
                'Drops to 25% on weekdays 09:00–17:00 TCT while groundskeeping is active',
                'Those groundskeeping hours do unlock some extra outcomes',
            ],
            highlights: [
                'Loot is mostly unremarkable',
                'Hit Contracts — theorized component for a future Assassination-style crime',
                'Car Keys — theorized component for a future Grand Theft Auto-style crime',
                'Fertilizer and Candles also appear — purpose still undetermined',
            ],
            tip: 'A reliable fallback location when every other location\'s cycle is in a low period.',
        },
        {
            name: 'Search the Fountain', unlock: 'CS75 (no item needed)',
            cycle: [
                'Monthly cycle',
                'Resets to 0% on the 1st',
                'Peaks around the 30th/31st',
            ],
            highlights: [
                'Weakest loot table of all six locations',
                'Mostly loot containers, spray cans, and minor consumables',
            ],
            tip: 'Mainly useful once unlocked for extra skill grinding and green Spray Cans.',
        },
    ],
    // Full data from the community guide's actual drop-rate tables — general breakdown, money
    // range, and the most notable items per location (curated to the standout finds rather than
    // every single low-probability row, to keep this genuinely useful rather than a wall of
    // numbers — full exhaustive tables are in the original forum guide for completionists).
    dropTables: {
        'Search the Trash': {
            general: 'Money 76.14% · Items 12.12% · Ammo 0.69% · Fails 10.66% · Crits 0.39%',
            money: '$3 – $600 (avg $65)',
            notable: [
                'Tin Can — 18.72%', 'Insurance Policy — 9.90%', 'Moldy Pizza — 9.84%', 'Festering Chicken — 7.98%',
                'Smelly Cheese — 8.85%', 'Rotten Apple — 7.90%', 'Stale Bread — 7.06%', 'Spoiled Fish — 6.32%',
                'Morphine x10 — 1.61% (unique)', 'Spray Cans (Blue/Green/White/Orange) — 1.46% combined', 'Card Skimmer — 1.38%',
            ],
            sample: '32,261 attempts, Jun 20 – Dec 1, 60 players',
        },
        'Search the Subway': {
            general: 'Money 75.23% · Items 17.21% · Ammo 0% · Fails 7.21% · Crits 0.23% (approximate — worth double-checking against the original table)',
            money: '$1 – $4,990 (avg $102)',
            notable: [
                'Travel Mug — 8.58%', 'Box of Tissues — 7.28%', 'Billfold — 7.30%', 'Bag of Bon Bons — 7.15%',
                'Phone Card — 6.92%', 'Crazy Straw — 6.76%', 'Coin Purse — 6.62%', 'Magazine — 6.76%',
                'Torn City Times x1, Zip Wallet x1 — unique, Off Peak (<24% ridership)',
                'Empty Box + Card Skimmer x10 — unique, needs Lost and Found Office Key',
                'Laptop — unique, Level 50, On/Rush hour (≥50% ridership)',
            ],
            sample: '68,222 attempts, Jun 20 – Dec 1, 60 players',
        },
        'Search the Junkyard': {
            general: 'Money 31.45% · Items 53.24% · Ammo 0% · Fails 14.39% · Crits 0.93%',
            money: '$5 – $2,500 (avg $110.6)',
            notable: [
                'Scrap Metal — up to ~17% combined across quantities', 'Tire — 3.49%', 'Blank DVDs — 3.49%',
                'Spray Can: White — 2.86%', 'Car Battery — 2.15%', 'Golf Club — 2.02%', 'Axe — 1.95%',
                'Metal Detector — unique, Level 30 (needed to unlock the Beach)',
                'Mountain Bike — unique, Level 5 (newest unique, added Aug 8th)',
                'Stash Box — unique, Level 40, Crushing rating ≥50%',
            ],
            sample: '42,312 attempts, Jun 20 – Dec 1, 60 players',
        },
        'Search the Beach': {
            general: 'Money 30.83% · Items 46.20% · Ammo 0% · Fails 21.43% · Crits 1.55%',
            money: '$3 – $4,920 (avg $182)',
            notable: [
                'Bottle Cap — ~20.5% at x1, more at higher quantities combined', 'Speedo — 3.62%', 'Silver Coin — 3.31%',
                'Beach Ball — 2.51%', 'Gold Watch — 2.24%', 'Bottle of Beer — 2.02%',
                'Cemetery Key — unique, needed to unlock the Cemetery', 'Sand — not in this table but confirmed low-tide-only, gives the Shore Thing honor bar',
                'Coconut Bra — unique, Level 50, High Tide (≤40%)',
            ],
            sample: '28,995 attempts, Jun 20 – Dec 1, 60 players',
        },
        'Search the Cemetery': {
            general: 'Money 36.16% · Items 49.55% · Ammo 0% · Fails 14.26% · Crits 0.77%',
            money: '$10 – $1,000 (avg $239.3)',
            notable: [
                'Daffodil — 6.05%', 'Old Wallet — 6.00%', 'Car Keys — 4.28%', 'Single Red Rose — 3.52%',
                'Candle x5 — 3.34%', 'Luger — 3.27%', 'Hit Contract — 3.22%', 'Funeral Wreath — 2.91%',
                'Speed x3 — unique, Level 80, groundskeeping inactive',
                'Golden Wreath — unique, Level 80, groundskeeping active',
                'Money ($106,179–195,336) — unique, Level 100',
            ],
            sample: '37,010 attempts, Jun 20 – Dec 1, 60 players',
        },
        'Search the Fountain': {
            general: 'Money 70.50% · Items 21.63% · Ammo 7.40% · Fails 0.41% (approximate)',
            money: '$5 – $498 (avg $81.1)',
            notable: [
                'Coin Purse — 7.80%', 'Old Wallet — 7.72%', 'Syringe — 7.35%', 'Credit Card — 7.33%',
                'Cannabis x4 — unique, Level 75', 'Lucky Quarter — unique, Level 80',
                'PCP — unique, Level 85, needs Collections ≥25%', 'Ecstasy x2 — unique, Level 100, Collections ≥50%',
            ],
            sample: '29,332 attempts, Jun 20 – Dec 1, 60 players',
        },
    },
    // All 34 uniques from the guide's consolidated table, grouped by location.
    uniques: [
        { location: 'Trash', name: 'Bag of Candy Kisses x4', skill: 'None', other: 'None' },
        { location: 'Trash', name: 'Morphine x10', skill: 'Level 25', other: 'None' },
        { location: 'Subway', name: 'Glasses x1', skill: 'None', other: 'Rush hour (≥75% ridership)' },
        { location: 'Subway', name: 'Torn City Times x1, Zip Wallet x1', skill: 'None', other: 'Off Peak (<24% ridership)' },
        { location: 'Subway', name: 'Empty Box x1, Card Skimmer x10', skill: 'None', other: 'Lost and Found Office Key' },
        { location: 'Subway', name: 'Ecstasy x3, LSD x2', skill: 'Level 30', other: 'Rush hour (≥75% ridership)' },
        { location: 'Subway', name: 'Laptop x1', skill: 'Level 50', other: 'On Peak or Rush hour (≥50% ridership)' },
        { location: 'Subway', name: 'Vicodin x3, Xanax x1', skill: 'Level 60', other: 'Off Peak (<24% ridership)' },
        { location: 'Subway', name: 'Lost and Found Office Key x1', skill: 'Level 85', other: 'None' },
        { location: 'Junkyard', name: 'Mountain Bike x1', skill: 'Level 5', other: 'None' },
        { location: 'Junkyard', name: 'Metal Detector x1', skill: 'Level 30', other: 'None' },
        { location: 'Junkyard', name: 'Spray Can: Black x4, Red x3, White x3', skill: 'Level 30', other: 'Crushing rating < 50%' },
        { location: 'Junkyard', name: 'Kevlar Gloves x1', skill: 'Level 30', other: 'Crushing rating ≥ 75%' },
        { location: 'Junkyard', name: 'Stash Box x1', skill: 'Level 40', other: 'Crushing rating ≥ 50%' },
        { location: 'Junkyard', name: 'High-Speed Drive x1', skill: 'Level 60', other: 'Crushing rating ≥ 75%' },
        { location: 'Junkyard', name: 'Money ($50,620–79,820)', skill: 'Level 80', other: 'Crushing rating 50–75%' },
        { location: 'Beach', name: 'Bottle of Beer x6, Sports Shades x5, Proda Sunglasses x4, Blanket x1', skill: 'None', other: 'None' },
        { location: 'Beach', name: 'Trout x1, Fishing Rod x1', skill: 'Level 10', other: 'Low Tide (≥60%)' },
        { location: 'Beach', name: 'First Aid Kit x2', skill: 'Level 20', other: 'Low Tide (≥60%)' },
        { location: 'Beach', name: 'Cemetery Key x1', skill: 'Level 50', other: 'None' },
        { location: 'Beach', name: 'Cork Hat x1', skill: 'Level 50', other: 'None' },
        { location: 'Beach', name: 'Coconut Bra x1', skill: 'Level 50', other: 'High Tide (≤40%)' },
        { location: 'Beach', name: 'Snorkel x1, Flippers x1, Wetsuit x1, Diving Gloves x1', skill: 'Level 65', other: 'High Tide (≤40%)' },
        { location: 'Beach', name: 'Sextant x1', skill: 'Level 90', other: 'Mid or Low Tide (>40%)' },
        { location: 'Beach', name: 'Silver Bead x1', skill: 'Level 95', other: 'High Tide (≤40%)' },
        { location: 'Cemetery', name: 'Speed x3', skill: 'Level 80', other: 'Groundskeeping inactive' },
        { location: 'Cemetery', name: 'Golden Wreath x1', skill: 'Level 80', other: 'Groundskeeping active' },
        { location: 'Cemetery', name: 'WWII Helmet x1', skill: 'Level 90', other: 'Groundskeeping inactive' },
        { location: 'Cemetery', name: 'Money ($106,179–195,336)', skill: 'Level 100', other: 'None' },
        { location: 'Fountain', name: 'Cannabis x4', skill: 'Level 75', other: 'None' },
        { location: 'Fountain', name: 'Lucky Quarter x1', skill: 'Level 80', other: 'None' },
        { location: 'Fountain', name: 'PCP x1', skill: 'Level 85', other: 'Collections ≥ 25%' },
        { location: 'Fountain', name: 'Spray Can: Pink x4, Purple x3, Blue x3, Orange x3', skill: 'Level 90', other: 'None' },
        { location: 'Fountain', name: 'Ecstasy x2', skill: 'Level 100', other: 'Collections ≥ 50%' },
    ],
    merits: [
        { name: 'Pay Dirt', rarity: 'Uncommon', how: 'Achieve a skill level of 100 in Search For Cash.' },
        { name: 'Spoiled Rotten', rarity: 'Uncommon', how: 'Find all seven "rotten" items — Search the Trash only, must be found (not bought/traded).' },
        { name: 'Shore Thing', rarity: 'Rare', how: 'Find Sand while searching the Beach during low tide (70%+).' },
    ],
    uniqueCount: 34,
    notes: 'All attempts here count as Theft crimes — useful for Theft-category medals.',
};

function cgAttachData(crime) {
    if (crime.id === 'searchforcash') return { ...crime, data: SEARCH_FOR_CASH };
    return crime;
}

function loadCrimesGuide() {
    renderCrimesHub();
}

function renderCrimesHub() {
    $('crimes-hub').style.display = 'block';
    $('crimes-detail').style.display = 'none';
    cgActiveCrime = null;

    $('crimes-hub-grid').innerHTML = CRIMES_DATA.map(c => {
        const ready = c.guideStatus === 'ready';
        return `
            <div class="crimes-tile ${ready ? '' : 'crimes-tile-pending'}" data-crime="${esc(c.id)}">
                <div class="crimes-tile-icon">${c.icon}</div>
                <div class="crimes-tile-name">${esc(c.name)}</div>
                <div class="crimes-tile-status">${ready ? '✓ Guide ready' : 'Guide not added yet'}</div>
            </div>`;
    }).join('');

    $('crimes-hub-grid').querySelectorAll('.crimes-tile').forEach(tile => {
        tile.addEventListener('click', () => renderCrimeDetail(tile.dataset.crime));
    });
}

function cgNerveToCrimes(nerveEstimate, nerveCost) {
    if (!nerveEstimate || !nerveCost) return null;
    return { min: Math.round(nerveEstimate.min / nerveCost), max: Math.round(nerveEstimate.max / nerveCost) };
}

function renderCrimeDetail(id) {
    const crime = cgAttachData(CRIMES_DATA.find(c => c.id === id));
    if (!crime) return;
    cgActiveCrime = id;
    cgActiveTab = 'overview';
    cgMeritCache = null;
    $('crimes-hub').style.display = 'none';
    $('crimes-detail').style.display = 'block';

    if (crime.guideStatus !== 'ready') {
        $('crimes-detail').innerHTML = `
            <button class="ghost small" id="crimes-back">← Back to all crimes</button>
            <h2 style="margin-top:14px;">${crime.icon} ${esc(crime.name)}</h2>
            <div class="panel" style="margin-top:14px;">
                <p style="color:var(--muted);">No guide added yet for this one — paste the in-game screenshots and any community guide you have for ${esc(crime.name)}, and it'll get built out the same way Search For Cash was.</p>
            </div>`;
        $('crimes-back').addEventListener('click', renderCrimesHub);
        return;
    }

    renderCrimeTabs(crime);
}

function renderCrimeTabs(crime) {
    const d = crime.data;
    const tabs = [
        { id: 'overview', label: 'Overview' },
        { id: 'locations', label: `Locations (${d.locations.length})` },
        { id: 'droprates', label: 'Drop Rates' },
        { id: 'uniques', label: `Uniques (${d.uniques ? d.uniques.length : 0})` },
        { id: 'items', label: 'Key Items' },
        { id: 'honors', label: 'Honor Bars' },
    ];

    $('crimes-detail').innerHTML = `
        <button class="ghost small" id="crimes-back">← Back to all crimes</button>
        <h2 style="margin-top:14px;">${crime.icon} ${esc(crime.name)}</h2>
        <p style="color:var(--muted);font-size:12px;">${crime.category ? esc(crime.category) + ' · ' : ''}${crime.nerveCost != null ? crime.nerveCost + ' nerve per attempt' : ''}</p>
        <div class="crimes-tabbar">
            ${tabs.map(t => `<button class="crimes-tab ${cgActiveTab === t.id ? 'active' : ''}" data-tab="${t.id}">${esc(t.label)}</button>`).join('')}
        </div>
        <div id="crimes-tab-body" style="margin-top:14px;"></div>`;

    $('crimes-back').addEventListener('click', renderCrimesHub);
    $('crimes-detail').querySelectorAll('.crimes-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            cgActiveTab = btn.dataset.tab;
            $('crimes-detail').querySelectorAll('.crimes-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === cgActiveTab));
            renderCrimeTabBody(crime);
        });
    });
    renderCrimeTabBody(crime);
}

function renderCrimeTabBody(crime) {
    const d = crime.data;
    const body = $('crimes-tab-body');

    if (cgActiveTab === 'overview') {
        const crimesEst = cgNerveToCrimes(d.estimatedNerveToCS100, crime.nerveCost);
        body.innerHTML = `
            <div class="panel">
                <p style="margin:0 0 10px;">${esc(d.summary)}</p>
                <div style="display:flex;gap:16px;flex-wrap:wrap;">
                    <div><div style="font-size:11px;color:var(--muted);">Unique finds</div><div style="font-weight:700;">${d.uniqueCount}</div></div>
                    <div><div style="font-size:11px;color:var(--muted);">Honor bars</div><div style="font-weight:700;">${d.merits.length}</div></div>
                    <div><div style="font-size:11px;color:var(--muted);">Est. to CS100</div><div style="font-weight:700;">
                        ${d.estimatedNerveToCS100
                            ? `${d.estimatedNerveToCS100.min.toLocaleString()}–${d.estimatedNerveToCS100.max.toLocaleString()} nerve${crimesEst ? ` (~${crimesEst.min.toLocaleString()}–${crimesEst.max.toLocaleString()} crimes)` : ''}`
                            : '<span style="color:var(--muted);font-weight:400;">not specified in guide yet</span>'}
                    </div></div>
                </div>
                <p style="font-size:12px;color:var(--muted);margin-top:10px;">${esc(d.notes)}</p>
            </div>`;
        return;
    }

    if (cgActiveTab === 'locations') {
        body.innerHTML = d.locations.map((loc, i) => `
            <div class="ocfit-scenario" data-collapse="crimes-loc-${i}" style="margin-bottom:10px;">
                <div class="ocfit-scenario-header">
                    <span>${esc(loc.name)}</span>
                    ${loc.unlock ? `<span style="font-size:11px;color:var(--muted);">🔒 ${esc(loc.unlock)}</span>` : ''}
                    <span class="chev">▾</span>
                </div>
                <div class="ocfit-scenario-body">
                    <div class="crimes-subhead">⏱ Success cycle</div>
                    <ul class="crimes-bullets">${loc.cycle.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
                    <div class="crimes-subhead">💰 What you'll find</div>
                    <ul class="crimes-bullets">${loc.highlights.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
                    <div class="crimes-tip">💡 ${esc(loc.tip)}</div>
                </div>
            </div>`).join('');
        body.querySelectorAll('.ocfit-scenario-header').forEach(header => {
            header.addEventListener('click', () => header.closest('.ocfit-scenario').classList.toggle('collapsed'));
        });
        return;
    }

    if (cgActiveTab === 'droprates') {
        if (!d.dropTables) {
            body.innerHTML = '<div class="panel"><p style="color:var(--muted);">No drop-rate data added yet.</p></div>';
            return;
        }
        body.innerHTML = Object.entries(d.dropTables).map(([locName, t], i) => `
            <div class="ocfit-scenario" data-collapse="crimes-drop-${i}" style="margin-bottom:10px;">
                <div class="ocfit-scenario-header">
                    <span>${esc(locName)}</span>
                    <span class="chev">▾</span>
                </div>
                <div class="ocfit-scenario-body">
                    <div class="crimes-subhead">📊 General breakdown</div>
                    <p style="margin:0 0 10px;">${esc(t.general)}</p>
                    <div class="crimes-subhead">💵 Money range</div>
                    <p style="margin:0 0 10px;">${esc(t.money)}</p>
                    <div class="crimes-subhead">🎯 Notable finds</div>
                    <ul class="crimes-bullets">${t.notable.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
                    <p style="font-size:11px;color:var(--muted);margin-top:10px;">Sample: ${esc(t.sample)}</p>
                </div>
            </div>`).join('');
        body.querySelectorAll('.ocfit-scenario-header').forEach(header => {
            header.addEventListener('click', () => header.closest('.ocfit-scenario').classList.toggle('collapsed'));
        });
        return;
    }

    if (cgActiveTab === 'uniques') {
        if (!d.uniques) {
            body.innerHTML = '<div class="panel"><p style="color:var(--muted);">No uniques data added yet.</p></div>';
            return;
        }
        body.innerHTML = `
            <table style="width:100%;font-size:13px;border-collapse:collapse;">
                <thead><tr style="color:var(--muted);text-align:left;">
                    <th style="padding:6px 8px;">Location</th><th style="padding:6px 8px;">Find</th>
                    <th style="padding:6px 8px;">Skill req.</th><th style="padding:6px 8px;">Other req.</th>
                </tr></thead>
                <tbody>${d.uniques.map(u => `
                    <tr style="border-top:1px solid var(--line);">
                        <td style="padding:6px 8px;white-space:nowrap;color:var(--muted);">${esc(u.location)}</td>
                        <td style="padding:6px 8px;">${esc(u.name)}</td>
                        <td style="padding:6px 8px;white-space:nowrap;">${esc(u.skill)}</td>
                        <td style="padding:6px 8px;">${esc(u.other)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
        return;
    }

    if (cgActiveTab === 'items') {
        body.innerHTML = d.keyItems.map(k => `
            <div class="panel" style="margin-bottom:10px;">
                <div style="font-weight:700;margin-bottom:4px;">${esc(k.name)}</div>
                <div style="margin-bottom:8px;">${esc(k.effect)}</div>
                <div style="font-size:12px;color:var(--muted);">📍 ${esc(k.source)}</div>
            </div>`).join('');
        return;
    }

    if (cgActiveTab === 'honors') {
        body.innerHTML = d.merits.map(m => `
            <div class="panel crimes-honor-row" data-honor="${esc(m.name)}" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
                <div><div style="font-weight:700;margin-bottom:4px;">${esc(m.name)}${m.rarity ? ` <span style="font-weight:400;font-size:11px;color:var(--muted);">(${esc(m.rarity)})</span>` : ''}</div><div style="font-size:13px;color:var(--muted);">${esc(m.how)}</div></div>
                <span class="crimes-honor-status" style="font-size:12px;color:var(--muted);white-space:nowrap;">loading…</span>
            </div>`).join('') + `<div class="status" id="crimes-honor-status"></div>`;
        loadCrimeMerits(crime.id);
        return;
    }
}

async function loadCrimeMerits(crimeId) {
    const st = $('crimes-honor-status');
    try {
        if (!cgMeritCache) {
            const res = await fetch('/api/crimes-merits', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: apiKey, action: 'read' }),
            });
            cgMeritCache = await res.json();
        }
        if (cgMeritCache.error) throw new Error(cgMeritCache.error);
        const honors = (cgMeritCache.honors || []).filter(h => h.crime === crimeId);
        honors.forEach(h => {
            const row = document.querySelector(`.crimes-honor-row[data-honor="${CSS.escape(h.name)}"] .crimes-honor-status`);
            if (!row) return;
            if (!h.resolvable) { row.textContent = 'not matched yet'; row.style.color = 'var(--muted)'; return; }
            row.textContent = h.earned ? '✓ earned' : 'not yet';
            row.style.color = h.earned ? 'var(--reagent)' : 'var(--muted)';
        });
        st.className = 'status'; st.textContent = '';
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    }
}
