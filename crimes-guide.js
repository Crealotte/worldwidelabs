// crimes-guide.js — WorldWideLabs Crimes 2.0 Guide (individual/solo crimes, not OC).
// Phase 1: static reference built from real in-game screenshots + community guides, fed in one
// crime at a time. Phase 2 (later): live per-crime CS% + nerve-based ETA once the user->crimes
// API selection has been verified against a real sample.
'use strict';

let crimesGuideLoaded = false;
let cgActiveCrime = null;

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
    keyItems: [
        { name: 'Glasses', effect: 'Enhancer — +5% CE & CS gains', source: 'Search the Subway, or pickpocketing a businesswoman' },
        { name: 'Metal Detector', effect: 'Unlocks Search the Beach', source: 'Search the Junkyard, from CS30' },
        { name: 'Cemetery Key', effect: 'Unlocks Search the Cemetery', source: 'Search the Beach, from CS50' },
        { name: 'Lost and Found Office Key', effect: 'Unlocks extra outcomes at the Subway (not a new location)', source: 'Search the Subway, from CS85' },
    ],
    locations: [
        {
            name: 'Search the Trash', unlock: null,
            cycle: 'Weekly — resets to 0% Monday 18:00 TCT, rises steadily through the week, peaks in the early hours of Monday (just before 08:00 TCT), then drops sharply back to 0%.',
            notes: '86% of searches give a small cash payout, the other 14% an item. Mostly low value, but the only source of the 7 "rotten" items needed for the Spoiled Rotten honor bar — also gives Card Skimmers and Spray Cans (materials for later crimes).',
            tip: 'Best location specifically for grinding toward the Spoiled Rotten honor bar; otherwise the weakest location for value.',
        },
        {
            name: 'Search the Subway', unlock: null,
            cycle: 'Daily — success rate tracks how many players are currently active, rather than a fixed day/week pattern.',
            notes: 'Higher chance of cash than items, similar to Trash. Billfolds (~9% chance) are the standout item here. The Office Key (found here at CS85) unlocks extra outcomes at this same location, and the Glasses enhancer can also turn up here.',
            tip: 'The most time-consistent location since it tracks player activity rather than a day/week cycle.',
        },
        {
            name: 'Search the Junkyard', unlock: null,
            cycle: 'Weekly — best Sunday and Monday morning, noticeably less consistent the rest of the week.',
            notes: 'Highest item-drop rate of any location, and the source of the Metal Detector (unlocks the Beach). Frequently the first place new crime materials/enhancers get added — also gives Spray Cans, Card Skimmers, Spy Cameras, Rope, Blank DVDs, and Computer Parts.',
            tip: 'Probably the single best all-round location given item variety and priority placement of new materials.',
        },
        {
            name: 'Search the Beach', unlock: 'Metal Detector (from Junkyard, CS30+)',
            cycle: 'Tidal — cycles between high and low tide, both within a single day and again across the month.',
            notes: 'Mostly junk loot, and the location most likely to hospitalize you. Source of the Cemetery Key. Sand (needed for Forgery, likely also Arson) only appears during low tide (70%+) — a Bucket improves the odds — and finding it grants the Shore Thing honor bar (not a unique find; can take up to ~600 nerve).',
            tip: 'Time your visits to low tide specifically when hunting Sand.',
        },
        {
            name: 'Search the Cemetery', unlock: 'Cemetery Key (from Beach, CS50+)',
            cycle: 'The most consistent location — a flat 75% success rate normally, dropping to 25% on weekdays 09:00–17:00 TCT while groundskeeping is active (though those hours unlock some extra outcomes).',
            notes: 'Loot is mostly unremarkable, but includes Hit Contracts (theorized component for a future Assassination-style crime) and Car Keys (theorized component for a future Grand Theft Auto-style crime), plus Fertilizer and Candles (purpose still undetermined).',
            tip: 'A reliable fallback location when every other location\'s cycle is in a low period.',
        },
        {
            name: 'Search the Fountain', unlock: 'CS75 (no item needed)',
            cycle: 'Monthly — resets to 0% on the 1st, peaks around the 30th/31st.',
            notes: 'The weakest loot table of all six locations — mostly loot containers, spray cans, and minor consumables.',
            tip: 'Mainly useful once unlocked just for extra skill grinding and green Spray Cans.',
        },
    ],
    merits: [
        { name: 'Pay Dirt', how: 'Reach Crime Skill 100 in Search For Cash.' },
        { name: 'Spoiled Rotten', how: 'Find all seven "rotten" items — Search the Trash only, must be found (not bought/traded).' },
        { name: 'Shore Thing', how: 'Find Sand while searching the Beach during low tide (70%+).' },
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

function renderCrimeDetail(id) {
    const crime = cgAttachData(CRIMES_DATA.find(c => c.id === id));
    if (!crime) return;
    cgActiveCrime = id;
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

    const d = crime.data;
    $('crimes-detail').innerHTML = `
        <button class="ghost small" id="crimes-back">← Back to all crimes</button>
        <h2 style="margin-top:14px;">${crime.icon} ${esc(crime.name)}</h2>
        <p style="color:var(--muted);font-size:12px;">${crime.category ? esc(crime.category) + ' · ' : ''}${crime.nerveCost != null ? crime.nerveCost + ' nerve per attempt' : ''}</p>
        <p style="margin:10px 0;">${esc(d.summary)}</p>

        <div class="panel">
            <h3>Key items</h3>
            ${d.keyItems.map(k => `
                <div style="padding:8px 0;border-top:1px solid var(--line);">
                    <b>${esc(k.name)}</b> — ${esc(k.effect)}
                    <div style="font-size:12px;color:var(--muted);">Source: ${esc(k.source)}</div>
                </div>`).join('')}
        </div>

        <div class="panel">
            <h3>Locations</h3>
            ${d.locations.map((loc, i) => `
                <div class="ocfit-scenario" data-collapse="crimes-loc-${i}" style="margin-bottom:8px;">
                    <div class="ocfit-scenario-header">
                        <span>${esc(loc.name)}</span>
                        ${loc.unlock ? `<span style="font-size:11px;color:var(--muted);">🔒 ${esc(loc.unlock)}</span>` : ''}
                        <span class="chev">▾</span>
                    </div>
                    <div class="ocfit-scenario-body">
                        <div style="margin-bottom:6px;"><b>Success cycle:</b> ${esc(loc.cycle)}</div>
                        <div style="margin-bottom:6px;">${esc(loc.notes)}</div>
                        <div style="font-size:12px;color:var(--reagent);">💡 ${esc(loc.tip)}</div>
                    </div>
                </div>`).join('')}
        </div>

        <div class="panel">
            <h3>Honor bars</h3>
            ${d.merits.map(m => `<div style="padding:6px 0;border-top:1px solid var(--line);"><b>${esc(m.name)}</b> — ${esc(m.how)}</div>`).join('')}
        </div>

        <div class="panel">
            <p style="color:var(--muted);font-size:12px;margin:0;">${d.uniqueCount} unique finds across all locations. ${esc(d.notes)}</p>
        </div>`;

    $('crimes-back').addEventListener('click', renderCrimesHub);
    $('crimes-detail').querySelectorAll('.ocfit-scenario-header').forEach(header => {
        header.addEventListener('click', () => header.closest('.ocfit-scenario').classList.toggle('collapsed'));
    });
}
