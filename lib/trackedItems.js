// lib/trackedItems.js — the curated list of items the Consumption Tracker actually counts.
//
// Deliberately a hand-picked allowlist, not "every item Torn types as Drug/Medical/etc." — the
// leader found the broad type-based version too noisy. Based on Jimidy's Faction Tools' own
// consumption tracker item list (confirmed from its real source), with the Candy section swapped
// out for the leader's own picks (Jimidy's was just Lollipop + Box of Sweet Hearts) and a
// Temporary-tab throwables group added (grenades, pepper spray — genuinely single-use, unlike the
// loanable weapons that share that same armoury tab but come back, so aren't tracked here at all).
// Kept in its own file, separate from the report logic in api/armory-tracker.js, since this is
// exactly the kind of thing a human will come back to tweak on its own later — add an item, drop
// one — without needing to touch anything else.
//
// Each entry maps a Torn item's exact name (case-insensitive match against the parsed armory
// news text) to the display category it's grouped under on the report.

const TRACKED_ITEMS = {
    // Drugs
    'xanax': 'Drug', 'vicodin': 'Drug', 'ketamine': 'Drug', 'speed': 'Drug', 'shrooms': 'Drug',
    'cannabis': 'Drug', 'pcp': 'Drug', 'opium': 'Drug', 'ecstasy': 'Drug', 'lsd': 'Drug', 'love juice': 'Drug',

    // Medical. Blood bags are grouped in here too (as a single merged "Blood Bag" line, not
    // per-type — see api/armory-tracker.js's consumption-report, which overrides these 8 entries'
    // category to 'Medical' regardless of what's set here when it merges them into one). A member
    // uses a plain "Empty Blood Bag" on themselves, which converts it into a type-specific
    // "Blood Bag : <type>" (one of the 8 blood types) — that's the item that actually gets used to
    // heal someone later, so that's what's tracked here. The empty bag itself isn't tracked as
    // consumption (using it doesn't heal anyone, it's the filling step) — it shows up instead as a
    // derived "buy this many empty bags back" line on the shopping list, totaled across every type.
    'first aid kit': 'Medical', 'small first aid kit': 'Medical', 'morphine': 'Medical', 'ipecac syrup': 'Medical',
    'blood bag : o-': 'Medical', 'blood bag : o+': 'Medical', 'blood bag : a-': 'Medical', 'blood bag : a+': 'Medical',
    'blood bag : b-': 'Medical', 'blood bag : b+': 'Medical', 'blood bag : ab-': 'Medical', 'blood bag : ab+': 'Medical',

    // Alcohol
    'bottle of beer': 'Alcohol',

    // Candy
    'bag of bon bons': 'Candy', 'bag of chocolate kisses': 'Candy', 'box of bon bons': 'Candy',
    'box of chocolate bars': 'Candy', 'box of extra strong mints': 'Candy', 'box of sweet hearts': 'Candy',
    'lollipop': 'Candy',

    // Boosters (energy drinks)
    'can of goose juice': 'Booster', 'can of damp valley': 'Booster', 'can of crocozade': 'Booster',
    'can of santa shooters': 'Booster', 'can of munster': 'Booster', 'can of red cow': 'Booster',
    'can of rockstar rudolph': 'Booster', 'can of taurine elite': 'Booster', 'can of x-mass': 'Booster',

    // Temporary tab, but genuinely single-use throwables (thrown/sprayed and gone) rather than a
    // loanable weapon that comes back — unlike the rest of that armoury tab, these count as real
    // consumption.
    'pepper spray': 'Temporary', 'grenade': 'Temporary', 'stick grenade': 'Temporary',
    'heg': 'Temporary', 'flash grenade': 'Temporary', 'smoke grenade': 'Temporary',
};

// Matches any of the 8 type-specific full blood bags (e.g. "Blood Bag : A+") — used to compute
// the derived "Empty Blood Bag" restock line on the shopping list.
const BLOOD_BAG_RE = /^blood bag\s*:/i;

module.exports = { TRACKED_ITEMS, BLOOD_BAG_RE };
