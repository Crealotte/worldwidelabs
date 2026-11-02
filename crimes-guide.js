// crimes-guide.js — WorldWideLabs Crimes 2.0 Guide (individual/solo crimes, not OC).
// Phase 1: static reference built from real in-game screenshots + community guides, fed in one
// crime at a time. Phase 2 (later): live per-crime CS% + nerve-based ETA once the user->crimes
// API selection has been verified against a real sample.
'use strict';

let crimesGuideLoaded = false;
let cgActiveCrime = null;
let cgActiveTab = 'overview';
let cgUniquesSort = { key: null, dir: 'asc' };
const cgUniquesAccessors = { location: u => u.location.toLowerCase(), name: u => u.name.toLowerCase(), skill: u => u.skill.toLowerCase() };
let cgMeritCache = null; // avoid refetching honors every tab switch

// Order and names match the in-game hub exactly (confirmed via screenshot). Category is only
// filled in where a source has actually confirmed it — left blank rather than guessed otherwise.
// guideStatus: 'ready' once a real guide has been turned into structured content below.
const CRIMES_DATA = [
    { id: 'searchforcash', name: 'Search For Cash', icon: '💵', category: 'Theft', nerveCost: 2, guideStatus: 'ready' },
    { id: 'bootlegging', name: 'Bootlegging', icon: '📀', category: 'Counterfeiting', nerveCost: null, guideStatus: 'ready' },
    { id: 'graffiti', name: 'Graffiti', icon: '🎨', category: 'Vandalism', nerveCost: 3, guideStatus: 'ready' },
    { id: 'shoplifting', name: 'Shoplifting', icon: '🛍️', category: 'Theft', nerveCost: 4, guideStatus: 'ready' },
    { id: 'pickpocketing', name: 'Pickpocketing', icon: '🤏', category: 'Theft', nerveCost: null, guideStatus: 'pending' },
    { id: 'cardskimming', name: 'Card Skimming', icon: '💳', category: null, nerveCost: null, guideStatus: 'pending' },
    { id: 'burglary', name: 'Burglary', icon: '🏚️', category: 'Theft', nerveCost: null, guideStatus: 'pending' },
    { id: 'hustling', name: 'Hustling', icon: '🎭', category: null, nerveCost: null, guideStatus: 'pending' },
    { id: 'disposal', name: 'Disposal', icon: '🗑️', category: 'Illicit Services', nerveCost: null, guideStatus: 'pending' },
    { id: 'cracking', name: 'Cracking', icon: '💻', category: null, nerveCost: null, guideStatus: 'pending' },
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

// ---- Bootlegging: from the community in-depth guide on the Torn forum (Emforus, based on about 17,500 logged attempts, last updated 2025), written up in our own words ----
const BOOTLEGGING = {
    summary: 'The second crime of Crimes 2.0. You copy blank DVDs, sell the copies, and from CS50 can open an online store that sells them for you. Selling gives the most crime skill, the store is slow passive money and the way to two honor bars. Not a big earner, but every attempt counts towards Counterfeiting medals.',
    estimatedNerveToCS100: null, // the guide gives no total
    locationsLabel: 'Actions',
    cycleLabel: '⚙️ How it works',
    highlightLabel: '📈 Crime skill and risks',
    uniqueLocationLabel: 'Where',
    keyItems: [
        { name: 'Personal Computer or Laptop', effect: 'Needed to copy DVDs. Can be lost on a critical failure while copying.', source: 'Super Store' },
        { name: 'Blank DVDs', effect: 'The material you copy. You can load several packs at once. Can be lost on a critical failure.', source: 'Super Store (also found when searching the Junkyard)' },
        { name: 'High-Speed Drive', effect: 'Enhancer: +5% crime skill gains and copying takes half the time. Not needed. Can be lost on a critical failure while copying.', source: 'Searching the Junkyard (crushing rate under 25%), spraying graffiti in the city centre, shoplifting the Super Store, burglarizing an apartment. It was once very expensive, now it is common.' },
        { name: 'Courses CMT1520 (Introduction to Computing) and CMT2230 (Web Design and Development)', effect: 'Both in the Computer Science bachelor. Needed to build the online store and for its honor bar. Not needed if you only want crime skill.', source: 'Education' },
    ],
    locations: [
        {
            name: 'Copying DVDs', unlock: null,
            cycle: [
                'Load blank DVDs (several packs at once is fine), then copy',
                'Every category of DVD gives the same crime skill and has the same success rate',
                'Early on you copy about 3 to 5 DVDs per attempt; later more',
                'Copying speed: every 5 levels of crime skill make a copy 2 seconds faster; the High-Speed Drive halves the time',
            ],
            highlights: [
                'Critical failures: jail, losing blank DVDs, losing your computer or laptop, losing some money, losing a High-Speed Drive',
                'Roughly 0.22 more DVDs per attempt for every level of crime skill, about 1.1 per 5 levels, up to CS100',
                'The gap between the lowest and highest result grows with skill, from about 3 to almost 20',
                'Copying gives the least crime skill per nerve of the three, but you need the stock to sell',
            ],
            tip: 'Copy a mix of all categories (see the genre ratio), because selling works best with variety.',
        },
        {
            name: 'Selling DVDs', unlock: null,
            cycle: [
                'You sell from your stock; having a few of every category sells more per attempt',
                'Categories sell at different rates, so a balanced stock runs out unevenly (see the genre ratio)',
                'Your crime skill only decides how many DVDs are sold at a time',
            ],
            highlights: [
                'All four unique finds come from selling',
                'One sale gives about the crime skill of 4 copies, about 60% more per nerve than copying',
                'Critical failures: jail, losing some life, losing some DVDs',
                'A critical failure while selling can cost a lot of crime skill: players at CS13 dropped to CS8 and one at CS7 dropped to CS1',
                'About $2,000 per sale on average over the guide\'s sample of 1,500 sales; it varies a lot with the number of DVDs sold',
            ],
            tip: 'This is the best way to raise crime skill: copy a varied stock, sell it in bulk, and stock up before a unique find becomes possible.',
        },
        {
            name: 'The Online Store', unlock: 'CS50 and the two Computer Science courses',
            cycle: [
                'Setting it up: every attempt costs 10 nerve and adds 1% to 9% progress; about 80% of attempts succeed, and players needed 20 to 40 attempts to launch it',
                'Once launched it sells the DVDs you have in stock, slowly, at about $20 each. You only collect the money (1 nerve)',
                'More customers come over time, faster the more you already have, as long as you never run out of any category',
                'You can switch the store off with the dial next to the collect button, handy when you want to keep DVDs to sell yourself',
            ],
            highlights: [
                '10,000 customers (honor bar) takes about 15 to 16 days of keeping it stocked, and roughly 20,000 DVDs sold through the store',
                'Critical failures: losing all the money waiting to be collected (confirmed); losing the whole store (only suspected, never proven)',
                'Setting up gives about 6 copies of crime skill per successful attempt; collecting gives less than one copy, often 0 to 1%',
                'Crime skill also grows slowly by itself while the store runs (a CS93 player reported about 3% in 24 hours)',
                'Money is small: the guide estimates about $50,000 a day from natural nerve regeneration alone',
            ],
            tip: 'Skip the store while you grind skill, because it sells the DVDs you would sell yourself. Open it when you are happy with your skill or want the honor bar.',
        },
    ],
    // no per-attempt drop tables in the guide
    dropTables: null,
    // an extra tab, rendered generically: [{ id, label, blocks: [{ title, items }] }]
    sections: [
        { id: 'ratio', label: 'Genre ratio', blocks: [
            { title: 'How many of each category to copy (rough ratio)', items: ['Action 10', 'Fantasy 7 and Comedy 7', 'Drama 5.5', 'Thriller 4', 'Horror 3 and Romance 3', 'Sci-Fi 2'] },
            { title: 'Notes', items: ['When selling directly you need slightly less Comedy than this.', 'The online store sells more Comedy than you would expect.', 'Keep at least a couple of every category in stock at all times.'] },
        ] },
    ],
    tips: [
        'Fastest crime skill: copy a varied stock, sell it in bulk, and leave the online store closed until you are happy with your skill.',
        'Counterfeiting medals need 10,000 crimes of this kind and ANY attempt counts, including collecting from the online store for 1 nerve. Let a few DVDs copy and collect as soon as they are done.',
        'The Cinephile honor bar is long term (10,000 DVDs of every genre, direct and store sales both count): start on it early, with the categories that sell worst.',
    ],
    uniques: [
        { location: 'Selling', name: 'Special ammunition', skill: 'Level 55', other: 'None' },
        { location: 'Selling', name: 'Lottery voucher', skill: 'Level 70', other: 'None' },
        { location: 'Selling', name: 'Prayer beads', skill: 'Level 85', other: 'None' },
        { location: 'Selling', name: 'Erotic DVD', skill: 'Level 100', other: 'None' },
    ],
    merits: [
        { name: 'Box Office', rarity: 'Common', how: 'Reach crime skill 100 in Bootlegging.' },
        { name: 'Online Entrepreneur', rarity: 'Common', how: 'Get 10,000 customers on your online counterfeit DVD store (about 15 to 16 days of a stocked store, roughly 20,000 DVDs sold there).' },
        { name: 'Cinephile', rarity: null, how: 'Sell 10,000 DVDs of each movie genre. Direct sales and store sales both count; the Bootlegging page banner shows your progress.' },
    ],
    uniqueCount: 4,
    notes: 'All attempts here count as Counterfeiting crimes, the best crime for Counterfeiting medals in Crimes 2.0. Source: community in-depth guide on the Torn forum by Emforus, based on about 17,500 logged attempts. The nerve cost per copy or sell attempt is not stated there (collecting is 1 nerve, setting up the store 10).',
};

// ---- Graffiti: from the community in-depth guide on the Torn forum (Emforus, based on about 32,000 logs, last updated 2025) and the Torn wiki (the unique finds, edited Nov 2026), written up in our own words ----
const GRAFFITI = {
    summary: 'The third crime of Crimes 2.0, 3 nerve per attempt, and the only crime in the Vandalism category. You spray your name in seven areas. Each area has its own reputation (0 to 5 stars) that grows with the graffiti you place there and unlocks better finds and more cash. Mostly repeated clicking, with a few things to know: the Paint Mask, joining a crew, and reputation slowly decaying.',
    estimatedNerveToCS100: null, // the guide gives no total
    cycleLabel: '📍 Good to know',
    highlightLabel: '🎯 Unique finds by reputation',
    uniqueLocationLabel: 'Area',
    keyItems: [
        { name: 'Spray cans', effect: 'Needed for every attempt, any colour. A success uses 0 to 15% of a can. You need fewer than 100 cans to get to CS100; keep a variety of colours.', source: 'Item market, Bits \'n\' Bobs ($5 each), the Print Store' },
        { name: 'The Ladder', effect: 'Seems to prevent bad outcomes about heights and falling, and unlocks some extra outcomes.', source: 'West Side, from CS15' },
        { name: 'Wire Cutters', effect: 'Seems to prevent simple failures by letting you reach locked places, and unlocks extra outcomes.', source: 'North Side, from CS25' },
        { name: 'Paint Mask', effect: 'Enhancer: +5% crime skill and crime experience gains. Also unlocks some very high paying outcomes; having it is the biggest factor in the money you make.', source: 'East Side, from CS35' },
    ],
    locations: [
        {
            name: 'East Side', unlock: null,
            cycle: [
                'Open from the start and relatively safe',
                'Best colours (forum guide, small samples): purple for cash, red for reputation',
                'Below reputation 2 a success only adds reputation',
                'A critical failure can jail you for about 34 minutes to 1 hour 8 minutes, or take a share of your life',
            ],
            highlights: [
                'Rep 1 (25 tags): 12 Bottles of Beer',
                'Rep 2 (50): 4 Grenades, 2 HEG, 6 Pepper Spray',
                'Rep 3 (100): 6 Morphine',
                'Rep 4 (250): Ecstasy, Ketamine, 2 Shrooms, 6 Vicodin',
                'Rep 5 (500) and CS70: the unique that lets you join a crew',
                'Rep 5 and CS100: $126,000 to $160,000 (may depend on the crew you joined)',
                'CS35: Paint Mask. CS50: unlocks the Residential District',
            ],
            tip: 'The best place to start: safe, and it gives you the Paint Mask at CS35.',
        },
        {
            name: 'West Side', unlock: null,
            cycle: [
                'Open from the start',
                'Best colours (forum guide): green for cash, blue for reputation',
                'Below reputation 2 a success only adds reputation',
                'A critical failure can jail you for about 3 hours 11 minutes, or take a share of your life',
            ],
            highlights: [
                'Rep 1: 2 First Aid Kits, 6 Small First Aid Kits',
                'Rep 2: 12 Cannabis',
                'Rep 3: 6 HEG',
                'Rep 4: $100,000 (needs CS77 or more and a crew)',
                'Rep 5: $120,000 to $160,000',
                'CS15: the Ladder. CS50: unlocks the Red-Light District',
            ],
            tip: 'Go here early for the Ladder at CS15.',
        },
        {
            name: 'North Side', unlock: null,
            cycle: [
                'Open from the start, riskier than East and West Side',
                'Best colours (forum guide): green for cash, orange for reputation',
                'Below reputation 2 a success only adds reputation',
            ],
            highlights: [
                'Rep 1: Cricket Bat',
                'Rep 2: 12 Bottles of Beer, 5 Fireworks',
                'Rep 3: $76,000 to $85,000',
                'Rep 4: Police Vest, Taser, Smoke Grenade',
                'Rep 5 and CS70: a unique that lets you join a crew',
                'CS25: Wire Cutters. CS95: 2 to 5 points',
            ],
            tip: 'The place for the Wire Cutters at CS25.',
        },
        {
            name: 'Residential District', unlock: 'A unique from East Side at CS50',
            cycle: [
                'The area with the lowest chance of failing',
                'Best colours (forum guide): white for cash, blue for reputation',
            ],
            highlights: [
                'Rep 1: $30,000 to $49,000',
                'Rep 2: $52,000 to $64,000',
                'Rep 3: $65,000 to $80,000',
                'Rep 4: $90,000 to $120,000',
                'Rep 5: $120,000 to $145,000',
                'CS100: $150,000',
            ],
            tip: 'Safe and mostly cash finds: a good place to earn once you have it unlocked.',
        },
        {
            name: 'Red-Light District', unlock: 'A unique from West Side at CS50',
            cycle: [
                'The area with the highest chance of failing',
                'Best colours (forum guide): green for cash, pink for reputation',
                'A success gives respect or money between $300 and $40,000',
                'A critical failure can cost a lot of life (reported 500 to 750)',
            ],
            highlights: [
                'Rep 1: 4 Morphine',
                'Rep 2: 800 Special Ammo',
                'Rep 3: PCP',
                'Rep 4: 2 Opium, 2 Empty Blood Bags',
                'Rep 5: Box of Medical Supplies',
                'Rep 5 and CS70: a unique that unlocks the City Center and the Financial District and lets you join a crew',
            ],
            tip: 'Risky, so work on it with good life and the key items.',
        },
        {
            name: 'Financial District', unlock: 'Joining a crew',
            cycle: [
                'Needs a crew',
                'Best colours (forum guide): black for cash, red for reputation',
                'A critical failure can jail you for up to about 5 hours 23 minutes',
            ],
            highlights: [
                'Rep 1: 400 Special Ammo',
                'Rep 2: 25 Card Skimmers',
                'Rep 3: 2 Speed',
                'Rep 4: Can of Goose Juice',
                'Rep 5: Neumune Tablet',
            ],
            tip: 'The place for Card Skimmers (25 at rep 2), which later crimes need.',
        },
        {
            name: 'City Center', unlock: 'Joining a crew',
            cycle: [
                'Needs a crew',
                'Best colours (forum guide): green for cash, blue for reputation',
                'A critical failure can jail you for about 1 hour 31 minutes, or put you in hospital for 3 hours 50 minutes if the life lost is more than you have',
                'The most graffiti gets removed here per day (up to 100 in one day reported)',
            ],
            highlights: [
                'Rep 1: High-Speed Drive and 20 Blank DVDs',
                'Rep 2: Box of Medical Supplies',
                'Rep 3: 4 Molotov Cocktails',
                'Rep 4: 4 Bottles of Sake, 4 of Tequila, 2 of Pumpkin Brew, 2 of Kandy Kane',
                'Rep 5: $500,000',
            ],
            tip: 'The biggest cash find ($500,000 at rep 5) and the High-Speed Drive for Bootlegging.',
        },
    ],
    // no per-attempt drop tables: the forum guide gives them as pictures (risk by area, money by area, colours)
    dropTables: null,
    sections: [
        { id: 'rep', label: 'Reputation & crew', blocks: [
            { title: 'Reputation levels (each area has its own)', items: ['Rep 1: 25 graffiti in the area', 'Rep 2: 50', 'Rep 3: 100', 'Rep 4: 250', 'Rep 5: 500', 'About 80% of attempts add reputation. Money outcomes replace that chance, so it gets harder to gain reputation the higher it is.', 'Each rep level unlocks a unique find in that area, and higher reputation means more and bigger cash finds.'] },
            { title: 'Reputation decay', items: ['The city slowly cleans up your graffiti, which lowers reputation in all areas (it can drop you a level).', 'The more graffiti you have in an area, the faster it is removed, and areas further down the list lose it faster.', 'The loss is random, from a few to over a dozen a day. The most reported was 100 in the City Center in one day.'] },
            { title: 'Joining a crew', items: ['You need rep 5 in one of the first five areas and CS70.', 'When you have both, a new unique appears in that area. You have to FIND that unique to join a crew; reaching CS70 and rep 5 alone is not enough.', 'Joining a crew unlocks the Financial District and the City Center, extra outcomes in the other areas, and the Fresh Blud honor bar.'] },
        ] },
        { id: 'colours', label: 'Colours', blocks: [
            { title: 'Best spray colour per area (forum guide, small samples: a hint, not a rule)', items: ['East Side: purple for cash, red for reputation', 'West Side: green for cash, blue for reputation', 'North Side: green for cash, orange for reputation', 'Residential District: white for cash, blue for reputation', 'Red-Light District: green for cash, pink for reputation', 'Financial District: black for cash, red for reputation', 'City Center: green for cash, blue for reputation'] },
            { title: 'What colour changes', items: ['Colour decides which outcomes can appear. Most areas have common outcomes for every colour, and the unique finds ignore colour completely.', 'Colour does not seem to change the chance of failing or of a critical failure.', 'Money depends most on whether you have the Paint Mask: most of the high paying common outcomes need it.'] },
        ] },
    ],
    tips: [
        'Start at East Side, then West Side and North Side for the key items (Paint Mask at CS35, Ladder at CS15, Wire Cutters at CS25). Having them makes failures and crits less likely.',
        'Crits are mostly minor: you lose the spray can and some life, sometimes jail for 1 to 5 hours. In bad cases the Paint Mask or Wire Cutters can be lost (not proven).',
        'About one in ten failures is a critical failure.',
        'Keep an eye on reputation decay: it can drop you a level, so do not stop for long when you are close to the next level.',
        'This is the only Vandalism crime and a new category, so all fifteen Vandalism medals are open to old and new players alike: the best crime to collect medals.',
    ],
    uniques: [
        { location: 'East Side', name: '12 Bottles of Beer', skill: 'None', other: 'Reputation 1' },
        { location: 'East Side', name: '4 Grenades, 2 HEG, 6 Pepper Spray', skill: 'None', other: 'Reputation 2' },
        { location: 'East Side', name: '6 Morphine', skill: 'None', other: 'Reputation 3' },
        { location: 'East Side', name: 'Ecstasy, Ketamine, 2 Shrooms, 6 Vicodin', skill: 'None', other: 'Reputation 4' },
        { location: 'East Side', name: 'Join a crew (unlocks the City Center)', skill: 'Level 70', other: 'Reputation 5' },
        { location: 'East Side', name: 'Money ($126,000 to $160,000)', skill: 'Level 100', other: 'Reputation 5 (may depend on the crew)' },
        { location: 'East Side', name: 'Paint Mask', skill: 'Level 35', other: 'None' },
        { location: 'East Side', name: 'Unlocks the Residential District', skill: 'Level 50', other: 'None' },
        { location: 'West Side', name: '2 First Aid Kits, 6 Small First Aid Kits', skill: 'None', other: 'Reputation 1' },
        { location: 'West Side', name: '12 Cannabis', skill: 'None', other: 'Reputation 2' },
        { location: 'West Side', name: '6 HEG', skill: 'None', other: 'Reputation 3' },
        { location: 'West Side', name: 'Money ($100,000)', skill: 'Level 77', other: 'Reputation 4 and a crew' },
        { location: 'West Side', name: 'Money ($120,000 to $160,000)', skill: 'None', other: 'Reputation 5' },
        { location: 'West Side', name: 'Ladder', skill: 'Level 15', other: 'None' },
        { location: 'West Side', name: 'Unlocks the Red-Light District', skill: 'Level 50', other: 'None' },
        { location: 'North Side', name: 'Cricket Bat', skill: 'None', other: 'Reputation 1' },
        { location: 'North Side', name: '12 Bottles of Beer, 5 Fireworks', skill: 'None', other: 'Reputation 2' },
        { location: 'North Side', name: 'Money ($76,000 to $85,000)', skill: 'None', other: 'Reputation 3' },
        { location: 'North Side', name: 'Police Vest, Taser, Smoke Grenade', skill: 'None', other: 'Reputation 4' },
        { location: 'North Side', name: 'Join a crew', skill: 'Level 70', other: 'Reputation 5' },
        { location: 'North Side', name: 'Wire Cutters', skill: 'Level 25', other: 'None' },
        { location: 'North Side', name: '2 to 5 points', skill: 'Level 95', other: 'None' },
        { location: 'Residential District', name: 'Money ($30,000 to $49,000)', skill: 'None', other: 'Reputation 1' },
        { location: 'Residential District', name: 'Money ($52,000 to $64,000)', skill: 'None', other: 'Reputation 2' },
        { location: 'Residential District', name: 'Money ($65,000 to $80,000)', skill: 'None', other: 'Reputation 3' },
        { location: 'Residential District', name: 'Money ($90,000 to $120,000)', skill: 'None', other: 'Reputation 4' },
        { location: 'Residential District', name: 'Money ($120,000 to $145,000)', skill: 'None', other: 'Reputation 5' },
        { location: 'Residential District', name: 'Money ($150,000)', skill: 'Level 100', other: 'None' },
        { location: 'Red-Light District', name: '4 Morphine', skill: 'None', other: 'Reputation 1' },
        { location: 'Red-Light District', name: '800 Special Ammo', skill: 'None', other: 'Reputation 2' },
        { location: 'Red-Light District', name: 'PCP', skill: 'None', other: 'Reputation 3' },
        { location: 'Red-Light District', name: '2 Opium, 2 Empty Blood Bags', skill: 'None', other: 'Reputation 4' },
        { location: 'Red-Light District', name: 'Box of Medical Supplies', skill: 'None', other: 'Reputation 5' },
        { location: 'Red-Light District', name: 'Join a crew (unlocks the City Center and Financial District)', skill: 'Level 70', other: 'Reputation 5' },
        { location: 'Financial District', name: '400 Special Ammo', skill: 'None', other: 'Reputation 1' },
        { location: 'Financial District', name: '25 Card Skimmers', skill: 'None', other: 'Reputation 2' },
        { location: 'Financial District', name: '2 Speed', skill: 'None', other: 'Reputation 3' },
        { location: 'Financial District', name: 'Can of Goose Juice', skill: 'None', other: 'Reputation 4' },
        { location: 'Financial District', name: 'Neumune Tablet', skill: 'None', other: 'Reputation 5' },
        { location: 'City Center', name: 'High-Speed Drive, 20 Blank DVDs', skill: 'None', other: 'Reputation 1' },
        { location: 'City Center', name: 'Box of Medical Supplies', skill: 'None', other: 'Reputation 2' },
        { location: 'City Center', name: '4 Molotov Cocktails', skill: 'None', other: 'Reputation 3' },
        { location: 'City Center', name: '4 Bottles of Sake, 4 of Tequila, 2 of Pumpkin Brew, 2 of Kandy Kane', skill: 'None', other: 'Reputation 4' },
        { location: 'City Center', name: 'Money ($500,000)', skill: 'None', other: 'Reputation 5' },
    ],
    merits: [
        { name: 'Let Us Spray', rarity: null, how: 'Reach crime skill 100 in Graffiti.' },
        { name: 'Fresh Blud', rarity: null, how: 'Join a crew: reach rep 5 in a first-five area and CS70, then find the crew unique that appears there.' },
        { name: 'Urban Legend', rarity: null, how: 'Reach 5 stars of reputation in all seven areas (a newer honor bar, listed on the Torn wiki but not in the older forum guide).' },
    ],
    uniqueCount: 44,
    notes: 'All attempts count as Vandalism crimes, giving medals by the number of crimes done. Sources: the community in-depth guide on the Torn forum by Emforus (about 32,000 logged attempts; the author says a rewrite is due) and the Torn wiki (unique finds, edited November 2026). The forum guide counts 41 uniques, the wiki list below has 44 rows (it also lists the crew and unlock steps), and the cash amounts follow the wiki. The risk by area, money by area and colour tables of the forum guide are pictures and are not included.',
};

// ---- Shoplifting: from the community in-depth guide on the Torn forum (Emforus, updated 2025) and the Torn wiki (unique finds), written up in our own words ----
const SHOPLIFTING = {
    summary: 'The fourth crime of Crimes 2.0, 4 nerve per attempt, eight shops. No items are needed. The skill of the crime is timing: every attempt raises your notoriety in that shop, and each shop has security (cameras, checkpoints, guards) that switches off now and then. Shop when security is down and notoriety is low.',
    estimatedNerveToCS100: null, // the guide gives no total
    cycleLabel: '🛡️ Security and risk',
    highlightLabel: '🎯 What you find',
    uniqueLocationLabel: 'Shop',
    keyItems: [
        { name: 'Mountain Bike', effect: 'Enhancer: more crime experience and crime skill gains, and it unlocks some valuable outcomes. Can be lost on a critical failure.', source: 'Searching the Junkyard, pickpocketing a cyclist, or the Bits \'n\' Bobs unique at CS90' },
        { name: 'Torn City Times', effect: 'Unlocks extra outcomes in every shop and seems to help the success rate and lower notoriety gain (not confirmed). Can be lost on a critical failure.', source: 'A unique find at the Subway in Search For Cash' },
        { name: 'Jacket and underwear', effect: 'Only a theory: wearing them may prevent some critical failures or add outcomes. Not proven.', source: 'Your own wardrobe' },
    ],
    locations: [
        {
            name: 'Sally\'s Sweet Shop', unlock: null,
            cycle: [
                'Security: one camera. Minimal risk and the lowest notoriety gain',
                'Cameras go off about 4 times a day (3 to 10 hours between breakdowns), for 30 to 60 minutes',
                'Critical failure: life loss (51 to 1,027) or jail from 37 minutes up to about 15 hours',
            ],
            highlights: [
                'Mostly candy: the common find is a 25H candy; anything 50H and up is rare and needs items or a combination',
                'A bike, the newspaper and cameras off all help with extra candy',
                'Nothing else comes from here, so it is for crime skill',
            ],
            tip: 'The safest shop. If you only want skill, spam it until notoriety hits 60%, then let it cool down.',
        },
        {
            name: 'Bits \'n\' Bobs', unlock: null,
            cycle: [
                'Security: two cameras. Minor risk',
                'Cameras go off about 3 times a day (4.5 to 14 hours). Try around noon and midnight',
                'Critical failure: life loss (111 to 838) or jail for about 33 minutes',
            ],
            highlights: [
                'Money ($5 to $4,981) or items; mostly junk, sometimes crime tools such as gasoline, glow sticks, jemmy bars and spray cans',
                'The uniques are mainly enhancers for crimes released and still to come',
            ],
            tip: 'Good for skill, and the useful goods are gasoline and spray paint.',
        },
        {
            name: 'TC Clothing', unlock: null,
            cycle: [
                'Security: one camera and checkpoints. Low risk',
                'Checkpoints break down about twice a week (3 to 4 day cycles) for 8 to 12 hours',
                'Critical failure: hospital for about 2 hours if the life lost is more than you have',
            ],
            highlights: [
                'Clothing of every kind, little market value',
                'Several uniques that only appear under certain security conditions',
            ],
            tip: 'One of the least profitable shops. Fine for skill, and for apparel.',
        },
        {
            name: 'Super Store', unlock: null,
            cycle: [
                'Security: two cameras and checkpoints. Moderate risk, and security is harder to catch disabled than elsewhere',
                'Critical failure: life loss (149 reported)',
            ],
            highlights: [
                'Electronics and crime materials: blank DVDs, spy cameras, personal computers, hard drives, toner',
                'Uniques include four crime enhancers and an Erotic DVD',
            ],
            tip: 'Mainly worth it for the uniques: the loot is cheap and the danger fairly high.',
        },
        {
            name: 'Pharmacy', unlock: null,
            cycle: [
                'Security: three cameras and checkpoints. Moderate risk. Added January 2024',
                'Triple cameras go off about twice a day (4.5 to 17 hours)',
                'Critical failure: you may lose the Torn City Times',
            ],
            highlights: [
                'Medical items and junk, plus Ipecac Syrup, which lets you hospitalise yourself without the education course, for any blood type',
                'Some outcomes (clipboard, lab coat, stethoscope) need cameras disabled',
            ],
            tip: 'Mediocre with all security on, decently profitable when it is down: wait for that.',
        },
        {
            name: 'Cyber Force', unlock: null,
            cycle: [
                'Security: two cameras and a guard. Moderate risk. Added December 2023, one day before Cracking',
                'The guard (Marcie) takes a 10 to 15 minute break every 3.5 to 4.5 hours',
                'Critical failure: life loss (up to 880) or losing the Torn City Times',
            ],
            highlights: [
                'Only computer parts for Cracking: fans, CPUs, eCPUs, heat sinks, HPCPUs, PSUs and water blocks',
                'Rarer parts (water blocks, HPCPUs, heat sinks) are more common when the guard is away or cameras are off',
            ],
            tip: 'Often the best shop to do when security is down: the efficient mining rigs need 30 to 50 HPCPUs.',
        },
        {
            name: 'Jewelry Store', unlock: null,
            cycle: [
                'Security: three cameras and a guard (Henry). High risk and a lower success rate',
                'Guard breaks every 3.5 to 4.5 hours',
                'Critical failure: jail from 58 minutes up to about 16 hours',
            ],
            highlights: [
                'Jewellery of little value ($500 to $3,890 or items)',
                'The uniques are the point: two enhancers and several tools, and the Cluster Ring for the Crown Jewel honor',
            ],
            tip: 'Only worth it for the uniques, or when both security measures are off.',
        },
        {
            name: 'Big Al\'s Gun Shop', unlock: null,
            cycle: [
                'Security: four cameras and two guards (Karl and Lars). Very high risk, lower success rate',
                'The guards break about 3 times a day (7.5 to 8.5 hours), only 10 to 15 minutes each time',
                'Critical failure: jail for about 53 minutes to 1 hour 41, or life loss (50 to 112)',
            ],
            highlights: [
                'Weapons, armour, temporaries and ammo. The best place for special ammo, and the most dangerous',
                'Most weapon and armour finds need one security measure off',
            ],
            tip: 'Avoid it while the guards are active unless you chase uniques. With cameras down and a guard break coming, keep notoriety low and carry only your best weapon, so the ammo goes to it.',
        },
    ],
    // the full drop tables are a spreadsheet on the forum, not in the guide
    dropTables: null,
    sections: [
        { id: 'security', label: 'Security', blocks: [
            { title: 'Cameras (least effective)', items: ['Raise notoriety gain; the more cameras, the more they raise it.', 'They go off for 30 to 60 minutes. The more cameras a shop has, the longer between breakdowns.', 'One camera (Sweet Shop, TC Clothing): about 4 times a day. Two (Bits \'n\' Bobs, Super Store, Cyber Force): about 3 times. Three (Pharmacy, Jewelry Store): about twice. Four (Big Al\'s): once or twice a day.', 'With four cameras, only go in when a security measure is down.'] },
            { title: 'Checkpoints', items: ['Stop you leaving with goods without an alarm, which can lead to failure, and raise notoriety significantly.', 'In TC Clothing and the Pharmacy. They break about twice a week for 8 to 12 hours.'] },
            { title: 'Guards (most effective)', items: ['Only in the better shops. Failures often happen while they patrol, and they raise notoriety significantly.', 'They take a break every 3.5 to 8.5 hours, always only 10 to 15 minutes, so the window is small, but predictable if you know when the last break was.'] },
            { title: 'Good to know', items: ['More active security means notoriety rises faster after a success and failure is more likely.', 'During a State of Emergency all shops are closed. Notoriety still decays and security still breaks as usual.'] },
        ] },
        { id: 'notoriety', label: 'Notoriety', blocks: [
            { title: 'How it works', items: ['Every attempt raises notoriety in that shop: a little for a success, more for a failure, and a critical failure maxes it at once.', 'Notoriety decays 1% every 5 minutes after your last attempt there, so 100% takes about 8 hours 20 minutes to clear.', 'Higher notoriety makes you more likely to be stopped, and a critical failure can put you in jail for up to 17 hours. Higher crime skill lowers the notoriety gain.', 'Brackets: low (under 10%), moderate (over 10%), high (over 30%), very high (over 60%). They change the failure chance, the flavour text and the jail times. Stay under 60%, or under 30% to be safe.', 'Crits can still happen at 0% notoriety. One unique find needs maximum notoriety.'] },
            { title: 'Critical failures', items: ['Lose some life, be hospitalised, go to jail, lose a Torn City Times, or lose your Mountain Bike.', 'Jail time grows with notoriety: about an hour at low notoriety, 5 to 7 hours above 30%, 10 to 17 hours above 60%.'] },
            { title: 'The Notorious honor bar (100% notoriety in all shops at once)', items: ['It gets harder the higher your crime skill is, so go for it right when you start: about 250 to 300 nerve, up to 400 with bad luck. One player needed 600 nerve at max skill, plus days of preparation.', 'Stack nerve (drink alcohol when full), or roll nerve refills around the day change.', 'Job points in a pub (best), meat warehouse or candle store help; so does a CBD stock increment.', 'Taking the bike and the newspaper out of your inventory lowers your success chance, which helps here.'] },
        ] },
    ],
    tips: [
        'Every shop gives the same crime skill, whatever your notoriety or the security. So for skill, use the shops with the least notoriety gain and risk: Sweet Shop and Bits \'n\' Bobs, when their cameras are down.',
        'Rob a shop when security is down: the loot is better and the notoriety gain lower. Cyber Force (HPCPUs) and the Pharmacy (Ipecac) pay best then.',
        'Keep notoriety under 60% (30% to be safe) to avoid very long jail times. Have friends ready to bust you, or lawyer business cards.',
        'Do the Notorious honor bar early: it takes more nerve the higher your skill.',
        'Crown Jewel needs the Cluster Ring from the Jewelry Store: CS100, zero notoriety, cameras off and the guard off duty.',
    ],
    uniques: [
        { location: 'Sally\'s Sweet Shop', name: 'Jawbreaker', skill: 'Level 20', other: 'Camera disabled' },
        { location: 'Sally\'s Sweet Shop', name: 'Empty Box, 2 Bags of Chocolate Truffles, 2 Jawbreakers', skill: 'Level 40', other: 'Camera enabled' },
        { location: 'Sally\'s Sweet Shop', name: '2 Pixie Sticks', skill: 'Level 60', other: 'Camera disabled' },
        { location: 'Sally\'s Sweet Shop', name: '4 Bags of Sherbet', skill: 'Level 70', other: 'Camera enabled' },
        { location: 'Sally\'s Sweet Shop', name: 'Tin of Treats', skill: 'Level 80', other: 'Camera disabled' },
        { location: 'Bits \'n\' Bobs', name: '8 Bottles of Champagne', skill: 'Level 1', other: 'Camera disabled' },
        { location: 'Bits \'n\' Bobs', name: 'Cut-Throat Razor, Shaving Foam', skill: 'Level 1', other: 'None' },
        { location: 'Bits \'n\' Bobs', name: 'Flashlight', skill: 'Level 20', other: 'None' },
        { location: 'Bits \'n\' Bobs', name: 'Duct Tape', skill: 'Level 30', other: 'Camera disabled' },
        { location: 'Bits \'n\' Bobs', name: '24 Bottles of Beer', skill: 'Level 60', other: 'None' },
        { location: 'Bits \'n\' Bobs', name: 'Money ($12,890 to $57,340)', skill: 'Level 80', other: 'Camera disabled' },
        { location: 'Bits \'n\' Bobs', name: 'Mountain Bike', skill: 'Level 90', other: 'None' },
        { location: 'TC Clothing', name: 'Raincoat', skill: 'Level 20', other: 'Checkpoint disabled' },
        { location: 'TC Clothing', name: 'Fisherman Hat, Fishing Rod', skill: 'Level 30', other: 'None' },
        { location: 'TC Clothing', name: 'Tailor\'s Dummy, Scissors', skill: 'Level 40', other: 'Camera disabled' },
        { location: 'TC Clothing', name: 'Trench Coat', skill: 'Level 50', other: 'None' },
        { location: 'TC Clothing', name: 'Mackintosh', skill: 'Level 60', other: 'None' },
        { location: 'TC Clothing', name: 'Coat Hanger', skill: 'Level 70', other: 'Maximum notoriety only' },
        { location: 'TC Clothing', name: 'Bush Hat', skill: 'Level 80', other: 'Camera disabled and checkpoint enabled' },
        { location: 'TC Clothing', name: 'Crop Top, Coin Purse, Lipstick', skill: 'Level 90', other: 'None' },
        { location: 'TC Clothing', name: 'Poncho', skill: 'Level 100', other: 'Checkpoint disabled' },
        { location: 'Super Store', name: 'DSLR Camera', skill: 'Level 1', other: 'Checkpoint disabled' },
        { location: 'Super Store', name: 'DVD Player, Erotic DVD', skill: 'Level 1', other: 'Cameras and checkpoint disabled' },
        { location: 'Super Store', name: 'Tracking Device', skill: 'Level 20', other: 'None' },
        { location: 'Super Store', name: 'Wireless Dongle', skill: 'Level 40', other: 'Cameras disabled' },
        { location: 'Super Store', name: 'Ergonomic Keyboard', skill: 'Level 60', other: 'Checkpoint disabled' },
        { location: 'Super Store', name: 'High-Speed Drive', skill: 'Level 80', other: 'None' },
        { location: 'Super Store', name: 'Laptop', skill: 'Level 100', other: 'None' },
        { location: 'Super Store', name: 'Voice Recorder', skill: 'Unknown', other: 'Unknown' },
        { location: 'Pharmacy', name: 'Melatonin', skill: 'Level 5', other: 'Cameras enabled' },
        { location: 'Pharmacy', name: 'Tyrosine', skill: 'Level 10', other: 'Cameras disabled and checkpoint enabled' },
        { location: 'Pharmacy', name: '4 Serotonin, 4 Syringes', skill: 'Level 1', other: 'Cameras and checkpoint disabled' },
        { location: 'Pharmacy', name: 'Box of Medical Supplies', skill: 'Level 100', other: 'Checkpoint enabled' },
        { location: 'Pharmacy', name: 'Epinephrine', skill: 'Level 100', other: 'Checkpoint disabled and cameras enabled' },
        { location: 'Cyber Force', name: '3 to 9 points', skill: 'Level 1', other: 'Guard off duty' },
        { location: 'Cyber Force', name: 'Money ($220,000 to $299,000)', skill: 'Level 1', other: 'Cameras enabled and guard on duty' },
        { location: 'Cyber Force', name: 'RF Detector', skill: 'Level 1', other: 'Cameras disabled' },
        { location: 'Cyber Force', name: '3 HPCPUs', skill: 'Level 5', other: 'Cameras disabled' },
        { location: 'Cyber Force', name: '5 CPUs, HPCPU, 2 Computer Fans, Water Block', skill: 'Level 15', other: 'Cameras disabled and guard off duty' },
        { location: 'Cyber Force', name: 'Office Chair', skill: 'Level 60', other: 'Guard off duty' },
        { location: 'Jewelry Store', name: '12 Gold Teeth', skill: 'Level 20', other: 'Guard on duty' },
        { location: 'Jewelry Store', name: 'Diamond Ring, Latex Gloves', skill: 'Level 40', other: 'Guard on duty' },
        { location: 'Jewelry Store', name: 'Raw Ivory', skill: 'Level 40', other: 'Cameras enabled and guard on duty' },
        { location: 'Jewelry Store', name: 'Diamond Bladed Knife', skill: 'Level 60', other: 'Guard on break' },
        { location: 'Jewelry Store', name: 'Vanity Hand Mirror', skill: 'Level 10', other: 'Cameras disabled and guard off duty' },
        { location: 'Jewelry Store', name: 'Magnifying Glass', skill: 'Level 1', other: 'None' },
        { location: 'Jewelry Store', name: 'Gold Ring, Graver', skill: 'Level 1', other: 'None' },
        { location: 'Jewelry Store', name: 'Diamond Ring, Grinding Stone', skill: 'Level 1', other: 'Cameras disabled' },
        { location: 'Jewelry Store', name: '2 Gold Rings, Drill, Polishing Pad', skill: 'Level 1', other: 'Cameras disabled' },
        { location: 'Jewelry Store', name: 'Cluster Ring', skill: 'Level 100', other: 'Zero notoriety, cameras disabled and guard off duty' },
        { location: 'Big Al\'s Gun Shop', name: '2,500 special ammo', skill: 'Level 1', other: 'Cameras disabled and guards on break' },
        { location: 'Big Al\'s Gun Shop', name: 'Full Body Armor', skill: 'Level 1', other: 'Cameras disabled and guards on break' },
        { location: 'Big Al\'s Gun Shop', name: '9 Ninja Stars', skill: 'Level 30', other: 'Cameras disabled' },
        { location: 'Big Al\'s Gun Shop', name: 'Desert Eagle', skill: 'Level 40', other: 'Cameras enabled and guards on duty' },
        { location: 'Big Al\'s Gun Shop', name: '6 Stick Grenades', skill: 'Level 50', other: 'Guards on break' },
        { location: 'Big Al\'s Gun Shop', name: 'Steyr AUG', skill: 'Level 60', other: 'Guards on break' },
        { location: 'Big Al\'s Gun Shop', name: '4 Throwing Knives', skill: 'Level 70', other: 'Cameras disabled' },
        { location: 'Big Al\'s Gun Shop', name: '8 HEG', skill: 'Level 80', other: 'Cameras enabled and guards on duty' },
        { location: 'Big Al\'s Gun Shop', name: 'Box of Grenades', skill: 'Level 100', other: 'None' },
    ],
    merits: [
        { name: 'Retail Therapy', rarity: null, how: 'Reach crime skill 100 in Shoplifting.' },
        { name: 'Notorious', rarity: null, how: 'Reach 100% notoriety in all shops at the same time. Easier the lower your crime skill is (see the Notoriety tab).' },
        { name: 'Crown Jewel', rarity: null, how: 'Steal a Cluster Ring from the Jewelry Store: CS100, zero notoriety, cameras disabled and the guard off duty.' },
    ],
    uniqueCount: 65,
    notes: 'All attempts count as Theft crimes. Sources: the community in-depth guide on the Torn forum by Emforus (updated 2025) and the Torn wiki (unique finds and crits). The full drop tables are a spreadsheet linked from the forum guide and are not included.',
};

function cgAttachData(crime) {
    if (crime.id === 'searchforcash') return { ...crime, data: SEARCH_FOR_CASH };
    if (crime.id === 'bootlegging') return { ...crime, data: BOOTLEGGING };
    if (crime.id === 'graffiti') return { ...crime, data: GRAFFITI };
    if (crime.id === 'shoplifting') return { ...crime, data: SHOPLIFTING };
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
        { id: 'locations', label: `${d.locationsLabel || 'Locations'} (${d.locations.length})` },
        ...(d.dropTables === null ? [] : [{ id: 'droprates', label: 'Drop Rates' }]),
        ...(d.sections || []).map(sec => ({ id: 'sec-' + sec.id, label: sec.label })),
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
                    <div><div style="font-size:11px;color:var(--muted);">Unique finds</div><div style="font-weight:700;">${d.uniques ? d.uniques.length : d.uniqueCount}</div></div>
                    <div><div style="font-size:11px;color:var(--muted);">Honor bars</div><div style="font-weight:700;">${d.merits.length}</div></div>
                    <div><div style="font-size:11px;color:var(--muted);">Est. to CS100</div><div style="font-weight:700;">
                        ${d.estimatedNerveToCS100
                            ? `${d.estimatedNerveToCS100.min.toLocaleString()}–${d.estimatedNerveToCS100.max.toLocaleString()} nerve${crimesEst ? ` (~${crimesEst.min.toLocaleString()}–${crimesEst.max.toLocaleString()} crimes)` : ''}`
                            : '<span style="color:var(--muted);font-weight:400;">not specified in guide yet</span>'}
                    </div></div>
                </div>
                ${d.tips ? `<div class="crimes-subhead" style="margin-top:12px;">💡 Tips</div><ul class="crimes-bullets">${d.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
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
                    <div class="crimes-subhead">${esc(d.cycleLabel || '⏱ Success cycle')}</div>
                    <ul class="crimes-bullets">${loc.cycle.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
                    <div class="crimes-subhead">${esc(d.highlightLabel || "💰 What you'll find")}</div>
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

    if (cgActiveTab.startsWith('sec-')) {
        const sec = (d.sections || []).find(x => 'sec-' + x.id === cgActiveTab);
        body.innerHTML = sec ? sec.blocks.map(b => `
            <div class="panel" style="margin-bottom:10px;">
                <div class="crimes-subhead">${esc(b.title)}</div>
                <ul class="crimes-bullets">${b.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
            </div>`).join('') : '';
        return;
    }

    if (cgActiveTab === 'uniques') {
        if (!d.uniques) {
            body.innerHTML = '<div class="panel"><p style="color:var(--muted);">No uniques data added yet.</p></div>';
            return;
        }
        const uniquesSorted = sortRows(d.uniques, cgUniquesSort, cgUniquesAccessors);
        body.innerHTML = `
            <table style="width:100%;font-size:13px;border-collapse:collapse;">
                <thead><tr style="color:var(--muted);text-align:left;">
                    <th data-sort="location" style="padding:6px 8px;">${esc(d.uniqueLocationLabel || 'Location')}</th><th data-sort="name" style="padding:6px 8px;">Find</th>
                    <th data-sort="skill" style="padding:6px 8px;">Skill req.</th><th style="padding:6px 8px;">Other req.</th>
                </tr></thead>
                <tbody>${uniquesSorted.map(u => `
                    <tr style="border-top:1px solid var(--line);">
                        <td style="padding:6px 8px;white-space:nowrap;color:var(--muted);">${esc(u.location)}</td>
                        <td style="padding:6px 8px;">${esc(u.name)}</td>
                        <td style="padding:6px 8px;white-space:nowrap;">${esc(u.skill)}</td>
                        <td style="padding:6px 8px;">${esc(u.other)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
        wireSort(body, cgUniquesSort, d.uniques, cgUniquesAccessors, () => renderCrimeTabBody(crime));
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
