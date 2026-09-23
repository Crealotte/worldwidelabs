// lib/factionPerkCosts.js — the respect cost to reach each level of every faction perk, for every
// branch (core + all 9 peace/war branches). Values are CUMULATIVE (total respect spent to reach that
// level from zero), index 0 = level 0 (always 0). Pulled from tornstats.com's Respect Simulator
// (its <option data-cost> values), then verified level-by-level against a real faction's live
// /faction/upgrades response: the branch's own `multiplier`/`order` field does NOT scale these costs —
// cost only depends on the perk line and level, the same for every faction. Torn's own API reports each
// upgrade's `cost` as the MARGINAL cost of just that one level (cumulative[level] - cumulative[level-1]),
// confirmed against a dozen real entries (Addiction XXII, Overdosing VI, Side effects X, Travel capacity
// IV, Hospital time V, Medical cooldown XII, Booster cooldown XVIII, and more, all exact matches).
'use strict';

// A live upgrade's `name` (e.g. "Strength training III", "Temporary weapon armory") maps to one of
// these keys by stripping the trailing roman numeral, lowercasing and underscoring — except the couple
// of core one-offs listed in NAME_OVERRIDES below, whose display name doesn't match the key 1:1.
const NAME_OVERRIDES = {
    'temporary weapon armory': 'temporary_armory',
};

const FP_COST_TABLE = {
    // ---- core (one-time faction unlocks + Chaining/Territory/Capacity/Organized Crimes ladders) ----
    weapon_armory: [0, 1000],
    armor_armory: [0, 1412],
    temporary_armory: [0, 2173],
    medical_armory: [0, 3067],
    booster_armory: [0, 10251],
    drug_armory: [0, 6662],
    point_storage: [0, 22265],
    laboratory: [0, 105027],
    consumable_armory: [0, 4719],
    utility_armory: [0, 15773],
    chaining: [0, 1412, 3585, 6652, 11371, 18033, 28284, 44057, 66322, 100580, 148938, 223342, 328369, 489965],
    capacity: [0, 1000, 2412, 4585, 7652, 12371, 19033, 29284, 45057, 67322, 101580],
    territory: [0, 1295, 2973, 5146, 8213, 12185, 17329, 23991, 32619, 44799, 60572, 80999, 107452, 144793, 193151, 255776, 336876, 441903, 590156, 782149, 1030785, 1352775, 1807290, 2395900, 3158168, 4145327, 5423726, 7228291, 9565255, 12591691, 16511013],
    organized_crimes: [0, 1412, 6131, 21904, 70262, 231858],

    // ---- Aggression ----
    speed: [0, 1142, 2491, 4032, 5851, 7928, 10379, 13272, 16576, 20476, 24930, 30188, 36192, 43280, 51647, 61202, 72481, 85363, 100570, 117936, 138436],
    strength: [0, 1142, 2491, 4032, 5851, 7928, 10379, 13272, 16576, 20476, 24930, 30188, 36192, 43280, 51647, 61202, 72481, 85363, 100570, 117936, 138436],
    hospitalization: [0, 1541, 3301, 5244, 7391, 9762, 12382, 15373, 18677, 22327, 26359],
    accuracy: [0, 4454, 9712, 15716, 22804, 31171, 40726, 52005, 64887, 80094, 97460],
    damage: [0, 9555, 20110, 32164, 45481, 60192, 76443, 94395, 114895, 137541, 162558],

    // ---- Criminality ----
    crimes: [0, 1000, 2105, 3326, 4675, 6216, 7919, 9799, 11876, 14170, 16790, 19683, 22879, 26410, 30442, 34896, 39816, 45251, 51255, 58112, 65686, 74053, 83296, 93851, 105511, 118393],
    jail_time: [0, 1105, 2367, 3858, 5618, 7627, 9998, 12706, 15902, 19552, 23861, 28781, 34589, 41446, 49276, 58519],
    nerve: [0, 1105, 2210, 3472, 4734, 6225, 7716, 9476, 11236, 13245, 15254, 17625, 19996, 22704, 25412, 28608, 31804, 35454, 39104, 43413, 47722, 52642, 57562, 63370, 69178, 76035, 82892, 90722, 98552, 107795, 117038, 127593, 138148, 150609, 163070, 177301, 191532, 208331, 225130, 244961, 264792],
    bust_skill: [0, 4309, 9229, 15037, 21894, 29724, 38967, 49522, 61983, 76214, 93013],
    bust_nerve: [0, 16799, 36630, 59276],

    // ---- Excursion ----
    travel_capacity: [0, 1000, 2349, 4168, 6619, 9923, 14377, 20381, 28748, 40027, 55234],
    travel_cost: [0, 1349, 2890, 4709, 6786, 9237],
    hunting: [0, 1819, 3896, 6347, 9240, 12544, 16444, 20898, 26156, 32160, 39248],
    rehab_cost: [0, 8367, 17610, 27820, 39099, 51560, 65791, 81511, 98877, 118061, 139968],
    overseas_banking: [0, 11279, 24161, 39368, 56734, 77234],

    // ---- Fortitude ----
    hospital_time: [0, 1000, 2105, 3326, 4675, 6216, 7919, 9799, 11876, 14170, 16790, 19683, 22879, 26410, 30442, 34896, 39816, 45251, 51255, 58112, 65686, 74053, 83296, 93851, 105511, 118393],
    medical_cooldown: [0, 1105, 2367, 3858, 5618, 7627, 9998, 12706, 15902, 19552, 23861, 28781, 34589],
    life_regeneration: [0, 1349, 2942, 4761, 6908, 9442, 12335, 15751, 19651, 24255, 29513, 35720, 42808, 51175, 61052, 72331, 85648, 100855, 118807, 139307, 163507],
    medical_effectiveness: [0, 2534, 5427, 8843, 12743, 17347, 22605, 28812, 35900, 44267, 54144, 65423, 78740, 93947, 111899, 132399],
    reviving: [0, 3531, 7699, 12458, 18076, 24709, 32283, 41224, 51434, 63488, 77254],

    // ---- Steadfast ----
    strength_training: [0, 1142, 2491, 4032, 5851, 7928, 10379, 13272, 16576, 20476, 24930, 30188, 36192, 43280, 51647, 61202, 72481, 85363, 100570, 117936, 138436],
    speed_training: [0, 1142, 2491, 4032, 5851, 7928, 10379, 13272, 16576, 20476, 24930, 30188, 36192, 43280, 51647, 61202, 72481, 85363, 100570, 117936, 138436],
    defense_training: [0, 1142, 2491, 4032, 5851, 7928, 10379, 13272, 16576, 20476, 24930, 30188, 36192, 43280, 51647, 61202, 72481, 85363, 100570, 117936, 138436],
    dexterity_training: [0, 1142, 2491, 4032, 5851, 7928, 10379, 13272, 16576, 20476, 24930, 30188, 36192, 43280, 51647, 61202, 72481, 85363, 100570, 117936, 138436],

    // ---- Suppression ----
    dexterity: [0, 1142, 2491, 4032, 5851, 7928, 10379, 13272, 16576, 20476, 24930, 30188, 36192, 43280, 51647, 61202, 72481, 85363, 100570, 117936, 138436],
    defense: [0, 1142, 2491, 4032, 5851, 7928, 10379, 13272, 16576, 20476, 24930, 30188, 36192, 43280, 51647, 61202, 72481, 85363, 100570, 117936, 138436],
    escape: [0, 1541, 3360, 5437, 7888, 10781, 14085, 17985, 22439, 27697, 33701],
    maximum_life: [0, 2893, 6089, 9620, 13520, 17829, 22749, 28184, 34188, 40821, 48395, 56762, 66005, 76215, 87494, 100376, 114607, 130327, 147693, 167524, 189431],

    // ---- Toleration (dual-tracked: separate peace and war progress can both be non-zero) ----
    addiction: [0, 1142, 2447, 3889, 5482, 7242, 9251, 11470, 13921, 16629, 19620, 23036, 26809, 30977, 35581, 40839, 46647, 53063, 60151, 67981, 76922, 86799, 97710, 109764, 123530, 138737],
    side_effects: [0, 1142, 2491, 4084, 5903, 8050, 10501, 13394, 16698, 20598, 25202],
    overdosing: [0, 4168, 9088, 14706, 21339, 28913, 37854, 48409, 60463, 74694, 90945],

    // ---- Voracity (dual-tracked: separate peace and war progress can both be non-zero) ----
    booster_cooldown: [0, 1000, 2105, 3326, 4675, 6216, 7919, 9799, 11876, 14170, 16790, 19683, 22879, 26410, 30442, 34896, 39816, 45251, 51255, 58112, 65686, 74053, 83296, 93851, 105511],
    candy_effect: [0, 1105, 2367, 3858, 5618, 7627, 9998, 12706, 15902, 19552, 23861],
    alcohol_effect: [0, 2294, 5002, 8198, 11848, 16157, 21077, 26885, 33518, 41348, 50289],
    energy_drink_effect: [0, 4454, 9540, 15544, 22401, 30495, 40050, 50961, 63843, 78554, 95920],
};

function fpCostKey(name) {
    const clean = String(name || '').replace(/\s+[IVXLC]+$/i, '').trim().replace(/\s+/g, ' ').toLowerCase();
    return NAME_OVERRIDES[clean] || clean.replace(/\s+/g, '_');
}

// Total respect spent so far on one upgrade entry (as returned by /faction/upgrades): the cumulative
// cost of the level it's currently at. Unknown perk names (a branch this table doesn't cover yet, e.g.
// one the faction hasn't touched) are skipped rather than guessed.
function fpSpentOn(upgrade) {
    const table = FP_COST_TABLE[fpCostKey(upgrade?.name)];
    const level = Number(upgrade?.level) || 0;
    if (!table) return 0;
    return table[Math.min(level, table.length - 1)] || 0;
}

// Total respect spent across every branch the faction has touched — core, every peace branch and
// every war branch (Toleration/Voracity can appear in both, tracked independently, and both count).
function fpTotalSpent(upgradesResponse) {
    const branches = [
        ...(upgradesResponse?.core?.upgrades ? [{ upgrades: upgradesResponse.core.upgrades }] : []),
        ...(upgradesResponse?.peace || []),
        ...(upgradesResponse?.war || []),
    ];
    let total = 0;
    for (const b of branches) for (const u of b.upgrades || []) total += fpSpentOn(u);
    return total;
}

module.exports = { FP_COST_TABLE, fpCostKey, fpSpentOn, fpTotalSpent };
