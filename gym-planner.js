// gym-planner.js — the "Tailored training plan" on the Energy planner page.
// A member picks the stat to train and how they train (natural energy — soft or hard —, or one of the
// happy jump methods), and gets: a week plan on top of our ideal week (4 training days, 2 war prep
// days, 1 war day — only realistic when we have a termed war), tick boxes to track it, and an ESTIMATE
// of the stat growth and item cost of every method side by side.
//
// Everything about the member is PULLED from their own data — their stat, max happy, energy bar
// (donator or not), gym, gym bonuses (faction Steadfast, candy bonus, ...) and total battle stats
// (which only set the weekly minimum: 4,400 E at 1.5m+, 2,200 E under). The only choices left to them
// are the stat, the method, and for natural energy: the daily refill, energy cans, and (experienced
// players) their own bars and Xanax per day.
//
// The gain maths is the widely used community gym formula (Vladar's). It is an ESTIMATE: Torn adds a
// random amount to every train, so treat the result as a range. The "training" chart of stats over
// time is separate and is NOT built from which items someone used.
'use strict';

const GP_METHOD_KEY = 'wwl_gym_method';
const GP_STAT_KEY = 'wwl_gym_stat';
const GP_NAT_KEY = 'wwl_gym_natural'; // { refill, cans: { name, count }, over: { soft: {bars, xan}, hard: {bars, xan} } }
const GP_JUMP_BARS = 3; // natural bars per day trained on top of a jump (the soft day)
const GP_TRAINING_DAYS = 4; // the ideal week's training days — Xanax stacking has to fit inside these
// Xanax's real drug cooldown is 6–8h; every calculation here always uses the conservative 8h, never the
// optimistic 6h, so a plan never promises something that turns out to still be impossible.
const GP_COOLDOWN_H = 8;
// Ecstasy is ALSO a drug, sharing the SAME drug-cooldown pool as Xanax — it can only be taken once the
// previous drug's cooldown has cleared (never right after popping a Xanax), and its own cooldown (max
// 4h) then applies before the next drug. See gpDrugActions().
const GP_ECSTASY_COOLDOWN_H = 4;
const GP_XAN_PER_DAY_KEY = 'wwl_gym_xan_per_day'; // how many Xanax the member says they'll actually take in a day, for jump stacking
function gpXanPerDay() {
    let v = 1;
    try { v = Number(localStorage.getItem(GP_XAN_PER_DAY_KEY)); } catch (e) { /* default */ }
    return Math.min(3, Math.max(1, Number.isFinite(v) && v > 0 ? Math.round(v) : 1)); // 4/day would need doses exactly 8h apart with none of them able to land on the next day — not realistic to ask for
}
const GP_JUMP_REFILL_KEY = 'wwl_gym_jump_refill'; // whether the optional 25-point refill + extra train is included in a jump session
function gpJumpRefillOn() {
    try { const v = localStorage.getItem(GP_JUMP_REFILL_KEY); return v === null ? true : v === '1'; } catch (e) { return true; }
}
// A full natural energy bar takes about 5h to regenerate either way (donator: +5/10min for a 150 bar;
// non-donator: +5/15min for a 100 bar — both ≈5h), same fact already shown under natural energy's own
// settings. Candy jump (2x+ daily) spends a full bar's worth each time, so THIS — not Ecstasy's own
// (shorter) cooldown — is the real limit on how many times a day it can be repeated.
const GP_ENERGY_REGEN_H = 5;
const GP_CANDY_PER_DAY_MIN = 2; // the member's own tested baseline
const GP_CANDY_PER_DAY_MAX = Math.floor(24 / Math.max(GP_ENERGY_REGEN_H, GP_ECSTASY_COOLDOWN_H)); // = 4
const GP_CANDY_PER_DAY_KEY = 'wwl_gym_candy_per_day';
function gpCandyPerDay() {
    let v = GP_CANDY_PER_DAY_MIN;
    try { v = Number(localStorage.getItem(GP_CANDY_PER_DAY_KEY)); } catch (e) { /* default */ }
    return Math.min(GP_CANDY_PER_DAY_MAX, Math.max(GP_CANDY_PER_DAY_MIN, Number.isFinite(v) && v > 0 ? Math.round(v) : GP_CANDY_PER_DAY_MIN));
}
// Days needed to stack `n` Xanax at `perDay` a day (n=1 doesn't stack at all — handled separately).
function gpXanaxDays(n, perDay) { return n > 1 ? Math.max(1, Math.ceil(n / perDay)) : 1; }
// How many of the week's training days a method's Xanax-stacking dose queue actually eats up — every
// dose (each Xanax plus the session's Ecstasy) ties up the day with cooldown waiting, so NO natural bar
// training fits alongside one, and every day before the last is always packed to a full `xanPerDay`
// doses (the queue only ever runs dry partway through the LAST day, never an earlier one — see the
// week-plan builder, which fills each day to `xanPerDay` before moving on). That last day can still have
// spare slots left over once its doses are placed, and that spare time is real — worth a natural top-up,
// not thrown away. `leftoverDayEquiv` is the fully-free days after the stacking ends PLUS that last day's
// spare fraction, e.g. 1.33 = one full free day plus a third of a day's worth of spare slots.
function gpXanaxDayInfo(m, xanPerDay) {
    const totalDoses = (m.sessions || 0) * gpDrugActions(m);
    if (totalDoses <= 0) return { dayNum: 0, spareSlotsLastDay: 0, leftoverDayEquiv: GP_TRAINING_DAYS };
    const perDay = Math.max(1, xanPerDay);
    const fullDays = Math.floor(totalDoses / perDay);
    const remainder = totalDoses % perDay;
    const dayNum = Math.min(GP_TRAINING_DAYS, fullDays + (remainder > 0 ? 1 : 0));
    const spareSlotsLastDay = remainder > 0 ? perDay - remainder : 0;
    const leftoverDayEquiv = Math.max(0, GP_TRAINING_DAYS - dayNum) + spareSlotsLastDay / perDay;
    return { dayNum, spareSlotsLastDay, leftoverDayEquiv };
}
// How many full jump cycles actually fit in the week's training days — never a partial one. A method
// with no multi-day stacking (0 or 1 Xanax, or a perDay:2 method like Candy jump (2x daily)) keeps its
// own simpler per-day cap instead.
// Ecstasy is ALSO a drug — it shares the exact same drug-cooldown pool as Xanax (can only be taken once
// the previous drug's cooldown clears), so a jump's real drug-action count is its Xanax doses PLUS one
// more for the Ecstasy at the end, not just the Xanax count on its own.
function gpDrugActions(m) {
    const xanaxCount = m.items?.xanax || 0;
    return xanaxCount > 1 ? xanaxCount + (m.ecstasy ? 1 : 0) : xanaxCount;
}
function gpMaxSessions(m, xanPerDay) {
    if ((m.items?.xanax || 0) > 1) return Math.max(1, Math.floor(GP_TRAINING_DAYS / gpXanaxDays(gpDrugActions(m), xanPerDay)));
    return GP_TRAINING_DAYS * (m.perDay || 1);
}
// Per-stat constants of the formula: [A, B]
const GP_STAT_AB = { strength: [1600, 1700], defense: [2100, -600], speed: [1600, 2000], dexterity: [1800, 1500] };
const GP_STAT_LABEL = { strength: 'Strength', defense: 'Defense', speed: 'Speed', dexterity: 'Dexterity' };
const GP_ITEMS = { candy: 'Candy (25 happy)', choco: 'Big Box of Chocolate Bars', edvd: 'Erotic DVD', ecstasy: 'Ecstasy', xanax: 'Xanax' };

// Each method: what property it needs (shown so a member isn't offered one they can't actually do yet),
// what it costs per jump session, how much happy the items add, how much energy the session spends
// (the optional 25-point refill's energy is only added on top when that toggle is on), and how many
// sessions fit in a normal week by default — for a 4-Xanax method that default is now DERIVED from the
// member's own "Xanax per day" setting (see gpMaxSessions), not a fixed guess.
function gpMethods(fill, job, candy = 1, xanPerDay = 1, jumpRefillOn = true, candyPerDay = GP_CANDY_PER_DAY_MIN) {
    const list = [
        { id: 'nat-soft', kind: 'natural', mode: 'soft', name: 'Natural energy — Soft', sub: '3 bars + 2 Xanax a day · 3 log-ins', sessions: 0, items: {}, addHappy: 0, energy: 0, ecstasy: false },
        { id: 'nat-hard', kind: 'natural', mode: 'hard', name: 'Natural energy — Hard', sub: '4 bars + 3 Xanax a day · 4 log-ins', sessions: 0, items: {}, addHappy: 0, energy: 0, ecstasy: false },
        { id: 'candy', name: 'Candy jump', property: 'Shack (no requirement)', sub: 'Starter jump — 49 candies worth 25 happy + Ecstasy', items: { candy: 49, ecstasy: 1 }, addHappy: 1225 * candy, energy: fill, ecstasy: true },
        // Two smaller doses a day beat one big one: the dominant 8*H^1.05 term in gpTrain() below is nearly
        // linear in happy, so hitting elevated happy TWICE (even at a lower peak each time) adds it up twice,
        // while the one-big-jump method only gets that boost once. Timed ~12h apart (e.g. 6am/6pm) because
        // that's Ecstasy's own booster cooldown — the same one energy cans already share, see gpNatFor's note.
        { id: 'candy2x', name: `Candy jump (${candyPerDay}x daily)`, property: 'Shack (no requirement) — needs your Energy bar full each time', sub: `24 candies + Ecstasy, ${candyPerDay}× a day (~${Math.floor(24 / candyPerDay)}h apart)`, perDay: candyPerDay, items: { candy: 24, ecstasy: 1 }, addHappy: 600 * candy, energy: fill, ecstasy: true },
        { id: 'candy1', name: 'Candy jump (1 Xanax)', property: 'Shack (no requirement)', sub: '49 candies worth 25 happy + Ecstasy + 1 Xanax', items: { candy: 49, ecstasy: 1, xanax: 1 }, addHappy: 1225 * candy, energy: fill + 250, ecstasy: true },
        { id: 'candy4', name: 'Candy jump (4 Xanax)', property: 'Shack (no requirement)', sub: `49 candies worth 25 happy + Ecstasy + 4 Xanax${jumpRefillOn ? ' + refill' : ''}`, items: { candy: 49, ecstasy: 1, xanax: 4 }, addHappy: 1225 * candy, energy: 1000 + (jumpRefillOn ? fill : 0), ecstasy: true, refill: jumpRefillOn },
        { id: 'choco1', name: 'Big Choco jump (1 Xanax)', property: 'Mansion, max upgrades, no staff', sub: '49 Big Boxes + Ecstasy + 1 Xanax', items: { choco: 49, ecstasy: 1, xanax: 1 }, addHappy: 1715 * candy, energy: fill + 250, ecstasy: true },
        { id: 'choco4', name: 'Big Choco jump (4 Xanax)', property: 'Mansion, max upgrades, no staff', sub: `49 Big Boxes + Ecstasy + 4 Xanax${jumpRefillOn ? ' + refill' : ''}`, items: { choco: 49, ecstasy: 1, xanax: 4 }, addHappy: 1715 * candy, energy: 1000 + (jumpRefillOn ? fill : 0), ecstasy: true, refill: jumpRefillOn },
        { id: 'edvd5', name: 'Happy Jump (5 EDVD)', property: 'Private Island, max upgrades, no staff', sub: `The regular happy jump — 5 EDVD + Ecstasy + 4 Xanax${jumpRefillOn ? ' + refill' : ''}`, items: { edvd: 5, ecstasy: 1, xanax: 4 }, addHappy: job ? 25000 : 12500, energy: 1000 + (jumpRefillOn ? fill : 0), ecstasy: true, refill: jumpRefillOn },
        { id: 'edvd9', name: 'Big Happy Jump (9 EDVD)', property: 'Private Island, max upgrades, max staff', sub: `Advanced — 9 EDVD + Ecstasy + 4 Xanax, needs the Book${jumpRefillOn ? ' + refill' : ''}`, items: { edvd: 9, ecstasy: 1, xanax: 4 }, addHappy: job ? 45000 : 22500, energy: 1000 + (jumpRefillOn ? fill : 0), ecstasy: true, refill: jumpRefillOn },
    ];
    list.forEach(m => { if (m.sessions === undefined) m.sessions = gpMaxSessions(m, xanPerDay); });
    return list;
}

const gpR4 = x => Math.round(x * 1e4) / 1e4;
// Gain of ONE train. S = the stat now, H = happy now, E = energy per train, G = gym multiplier.
function gpTrain(S, H, E, G, stat, perk) {
    const [A, B] = GP_STAT_AB[stat];
    const happyPart = gpR4(1 + 0.07 * gpR4(Math.log(1 + H / 250)));
    return (S * happyPart + 8 * Math.pow(H, 1.05) + (1 - Math.pow(H / 99999, 2)) * A + B) / 200000 * G * E * perk;
}
// Spend `energy` in trains starting at happy H0; happy drops by about half of each train's energy.
function gpSession(S, H0, energy, inp) {
    const trains = Math.floor(energy / inp.E);
    let H = H0, gain = 0;
    for (let i = 0; i < trains; i++) {
        gain += gpTrain(S + gain, Math.max(0, H), inp.E, inp.G, inp.stat, inp.perk);
        H -= inp.E * 0.5;
    }
    return { gain, trains };
}

// One method's week: its jump sessions at peak happy, then the rest of the energy at normal happy.
function gpWeek(m, inp, prices, xanPerDay) {
    let S = inp.S, gain = 0, energyUsed = 0;
    const perSession = [];
    for (let i = 0; i < m.sessions; i++) {
        const peak = Math.min(99999, (inp.base + m.addHappy) * (m.ecstasy ? 2 : 1));
        const r = gpSession(S, peak, m.energy, inp);
        S += r.gain; gain += r.gain; energyUsed += r.trains * inp.E;
        perSession.push({ peak, gain: r.gain, energy: r.trains * inp.E });
    }
    // natural method: the member's own day (bars + Xanax + refill + energy cans) times 4 training days; with a
    // lighter jump (0 or 1 Xanax), the soft day's natural bars fit on top of it every day. A method that already
    // repeats several times a day on its own (Candy jump, Nx daily) has no slack left for extra bars — its own
    // sessions already use a full bar back to back. A 4-Xanax stacking method ties up whole days with cooldown
    // waiting (see gpXanaxDaysUsed) — natural bars only fit on the days genuinely left AFTER the full cycle is
    // done, never mixed into an active stacking day. The weekly number is only a minimum to reach — never a cap.
    let rest, canCost = 0, canPriced = true;
    if (m.kind === 'natural') {
        const nat = gpNatFor(m.mode);
        const canE = inp.can ? inp.can.energy * nat.canCount : 0;
        rest = 4 * (nat.bars * inp.fill + nat.xan * 250 + nat.refill * inp.fill + canE);
        if (inp.can && nat.canCount) { if (inp.can.price == null) canPriced = false; else canCost = 4 * nat.canCount * inp.can.price; }
        if (nat.xan) { const xp = prices[GP_ITEMS.xanax]; if (xp == null) canPriced = false; else canCost += 4 * nat.xan * xp; } // the day's Xanax at market value, 4 training days
    } else if ((m.perDay || 1) > 1) {
        rest = 0;
    } else if ((m.items?.xanax || 0) > 1) {
        rest = gpXanaxDayInfo(m, xanPerDay).leftoverDayEquiv * GP_JUMP_BARS * inp.fill;
    } else {
        rest = 4 * GP_JUMP_BARS * inp.fill;
    }
    const r = gpSession(S, inp.base, rest, inp);
    gain += r.gain; energyUsed += r.trains * inp.E;
    let cost = canCost, priced = canPriced, perJump = 0;
    for (const [k, qty] of Object.entries(m.items)) {
        const p = prices[GP_ITEMS[k]];
        if (p == null) priced = false; else { cost += p * qty * m.sessions; perJump += p * qty; }
    }
    return { gain, cost, priced, perJump, jumps: m.kind === 'natural' ? 0 : m.sessions, energyUsed, perSession, restEnergy: r.trains * inp.E };
}

// ---- energy group: worked out from the member's own total battle stats. It changes ONE thing: the
// weekly minimum (1.5m+ = 4,400 E, under = 2,200 E). Nothing else in the planner depends on it.
const GP_TIER_LIMIT = 1500000;
function gpTotalStats() {
    try {
        const ps = profile?.personalstats;
        const t = Number(ps?.totalstats) || ['strength', 'defense', 'speed', 'dexterity'].reduce((s, k) => s + (Number(ps?.[k]) || 0), 0);
        return t > 0 ? t : null;
    } catch (e) { return null; }
}
function gpGroup() {
    const total = gpTotalStats();
    if (total === null) return { group: 'b', total, source: 'unknown' };
    return { group: total >= GP_TIER_LIMIT ? 'a' : 'b', total, source: 'auto' };
}

// ---- the member's own data ----
let gpPrices = {};
let gpCans = []; // energy drinks: [{ name, energy, price }] — every can gives its own amount of energy
let gpGyms = null;
let gpCandy25 = []; // every candy worth 25 happy: [{ name, price }] — the candy jump can use any of them
async function gpLoadPrices() {
    try { const c = JSON.parse(sessionStorage.getItem('wwl_gym_prices3') || 'null'); if (c && Date.now() - c.at < 6 * 3600e3) { gpPrices = c.p; gpCans = c.cans; gpCandy25 = c.candy; return; } } catch (e) { /* fetch fresh */ }
    try {
        const res = await fetch(`https://api.torn.com/torn/?selections=items&key=${encodeURIComponent(apiKey)}`);
        const d = await res.json();
        if (d.error) return;
        const want = new Set(Object.values(GP_ITEMS));
        const p = {}, cans = [], candy = [];
        for (const it of Object.values(d.items || {})) {
            if (want.has(it.name)) p[it.name] = it.market_value || null;
            if (it.type === 'Energy Drink') { // "Increases energy by 25" or similar — the first number that goes with "energy"
                const m = /energy[^0-9]*(\d+)/i.exec(it.effect || '') || /(\d+)[^.]*energy/i.exec(it.effect || '');
                if (m) cans.push({ name: it.name, energy: Number(m[1]), price: it.market_value || null });
            }
            if (it.type === 'Candy') { // "Increases happiness by 25" — keep the ones worth exactly 25 happy
                const h = /happ[^0-9]*(\d+)/i.exec(it.effect || '');
                if (h && Number(h[1]) === 25) candy.push({ name: it.name, price: it.market_value || null });
            }
        }
        cans.sort((a, b) => b.energy - a.energy);
        candy.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
        // the candy jump is priced with the cheapest of the 25-happy candies (the Lollipop if none could be found)
        const cheapest = candy.find(c => c.price != null);
        if (cheapest) p[GP_ITEMS.candy] = cheapest.price;
        else { const lol = Object.values(d.items || {}).find(it => it.name === 'Lollipop'); p[GP_ITEMS.candy] = lol?.market_value || null; }
        gpPrices = p; gpCans = cans; gpCandy25 = candy;
        try { sessionStorage.setItem('wwl_gym_prices3', JSON.stringify({ at: Date.now(), p, cans, candy })); } catch (e) { /* not critical */ }
    } catch (e) { /* prices stay unknown — costs shown as "?" */ }
}

// ---- which candy the member uses for the candy jump (any candy worth 25 happy) — the cost follows their choice ----
const GP_CANDY_KEY = 'wwl_gym_candy';
function gpCandyChoice() { // the chosen candy, else the cheapest one with a price, else null
    let name = '';
    try { name = localStorage.getItem(GP_CANDY_KEY) || ''; } catch (e) { /* cheapest */ }
    return gpCandy25.find(c => c.name === name) || gpCandy25.find(c => c.price != null) || null;
}
// Every gym with its dots per stat (stored ×10) and the energy one train costs there.
async function gpLoadGyms() {
    if (gpGyms) return;
    try { const c = JSON.parse(sessionStorage.getItem('wwl_gym_gyms') || 'null'); if (c) { gpGyms = c; return; } } catch (e) { /* fetch fresh */ }
    try {
        const res = await fetch(`https://api.torn.com/torn/?selections=gyms&key=${encodeURIComponent(apiKey)}`);
        const d = await res.json();
        if (d.error || !d.gyms) return;
        gpGyms = d.gyms;
        try { sessionStorage.setItem('wwl_gym_gyms', JSON.stringify(gpGyms)); } catch (e) { /* not critical */ }
    } catch (e) { /* the gym stays unknown — a typical value is used and said so */ }
}

// ---- bonuses from the member's own perks (faction Steadfast, candy bonus, cooldown, energy cans, ...) ----
// Torn lists a member's perks as sentences per source (faction, job, property, education, ...). Anything
// that is a percentage and about gym gains, candy happiness, energy drinks or a cooldown is picked out and
// used; the list of what was found is shown on the page so it can be checked against Torn's own perks page.
let gpPerks = null; // [{ source, text, kind: 'gym'|'candy'|'cans'|'cooldown', stat, what, pct }]
function gpParsePerk(source, text) {
    const t = String(text).toLowerCase();
    const m = /([+-])?\s*(\d+(?:\.\d+)?)\s*%/.exec(t);
    if (!m) return null;
    const pct = (m[1] === '-' ? -1 : 1) * Number(m[2]);
    const stat = ['strength', 'defense', 'speed', 'dexterity'].find(s => t.includes(s)) || null;
    if (/cooldown/.test(t)) return { source, text, kind: 'cooldown', what: (/(booster|drug|medical|candy|alcohol)/.exec(t) || [])[1] || 'all', pct };
    if (/energy drink|energy can|\bcans?\b/.test(t)) return { source, text, kind: 'cans', pct };
    if (/candy|sweet|chocolate|lollipop/.test(t) && /happ|effect|boost/.test(t)) return { source, text, kind: 'candy', pct };
    if (/gym|train/.test(t) || (/gain/.test(t) && stat)) return { source, text, kind: 'gym', stat, pct };
    return null;
}
async function gpLoadPerks() {
    if (gpPerks) return;
    try {
        const res = await fetch(`https://api.torn.com/user/?selections=perks&key=${encodeURIComponent(apiKey)}`);
        const d = await res.json();
        if (d.error) { gpPerks = { error: d.error.error }; return; }
        const out = [];
        for (const [key, list] of Object.entries(d)) {
            if (!Array.isArray(list)) continue;
            const source = key.replace(/_perks$/, '');
            for (const text of list) { const p = gpParsePerk(source, text); if (p) out.push(p); }
        }
        gpPerks = out;
    } catch (e) { gpPerks = { error: e.message }; }
}
const gpPerkList = () => (Array.isArray(gpPerks) ? gpPerks : []);
function gpGymMult(stat) {
    // Bonuses from the same source add up (education: +1% strength and +1% all gym gains = +2%); the different
    // sources (faction, property, education, ...) then multiply each other.
    const bySource = {};
    gpPerkList().filter(p => p.kind === 'gym' && (!p.stat || p.stat === stat)).forEach(p => { bySource[p.source] = (bySource[p.source] || 0) + p.pct; });
    return Object.values(bySource).reduce((m, pct) => m * (1 + pct / 100), 1);
}
const gpMultOf = kind => gpPerkList().filter(p => p.kind === kind).reduce((m, p) => m * (1 + p.pct / 100), 1);
// Faction Steadfast per stat, for the stat buttons and the line that shows it.
function gpSteadfast() {
    const out = { strength: 0, defense: 0, speed: 0, dexterity: 0 };
    gpPerkList().filter(p => p.kind === 'gym' && p.source === 'faction').forEach(p => {
        (p.stat ? [p.stat] : Object.keys(out)).forEach(s => { out[s] += p.pct; });
    });
    return out;
}

// What the planner uses, all taken from the member's own account; `notes` lists anything that had to be assumed.
function gpData(stat) {
    const notes = [];
    let S = Number(profile?.personalstats?.[stat]);
    if (!(S > 0)) { S = 100000; notes.push(`your ${stat} couldn't be read`); }
    let base = Number(profile?.happy?.maximum);
    if (!(base > 0)) { base = 5000; notes.push('your max happy couldn\'t be read'); }
    const bar = Number(profile?.energy?.maximum);
    const fill = (bar >= 100 && bar <= 150) ? bar : (profile?.donator ? 150 : 100);
    const gym = gpGyms?.[profile?.active_gym];
    const E = Number(gym?.energy) > 0 ? Number(gym.energy) : 10;
    let G = Number(gym?.[stat]) / 10;
    if (!(G > 0)) { G = 7.3; notes.push(gym ? `your gym doesn't train ${stat}, so a typical gym is assumed` : 'your gym couldn\'t be read, so a typical gym is assumed'); }
    return { S, base, fill, E, G, gymName: gym?.name || null, notes };
}

// ---- natural energy choices: refill, energy cans, and (experienced players) own bars / Xanax ----
function gpNatState() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(GP_NAT_KEY) || '{}'); } catch (e) { /* defaults */ }
    return { refill: s.refill !== false, cans: s.cans || { name: '', count: 0 }, over: s.over || {} };
}
function gpSaveNatState(s) { try { localStorage.setItem(GP_NAT_KEY, JSON.stringify(s)); } catch (e) { /* not critical */ } }
function gpNatFor(mode) {
    const s = gpNatState();
    const preset = mode === 'hard' ? { bars: 4, xan: 3 } : { bars: 3, xan: 2 }; // soft: 3 log-ins a day; hard: 4 bars and 3 Xanax
    const clamp = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Math.round(Number(v)) : d));
    const o = s.over[mode] || {};
    return {
        bars: clamp(o.bars, 1, 4, preset.bars), xan: clamp(o.xan, 0, 4, preset.xan),
        refill: s.refill ? 1 : 0, // the energy refill is on unless switched off
        canCount: gpCans.find(c => c.name === s.cans.name) ? clamp(s.cans.count, 0, 6, 0) : 0,
    };
}
function gpStat() {
    let s = null;
    try { s = localStorage.getItem(GP_STAT_KEY); } catch (e) { /* default */ }
    if (GP_STAT_AB[s]) return s;
    const best = Object.entries(gpSteadfast()).sort((a, b) => b[1] - a[1])[0];
    return best && best[1] > 0 ? best[0] : 'strength'; // nothing chosen yet: the stat with the best faction bonus
}

function gpInputs() {
    const stat = gpStat(), d = gpData(stat), g = gpGroup();
    const st = gpNatState();
    const canItem = gpCans.find(c => c.name === st.cans.name) || null;
    const canMult = gpMultOf('cans');
    return { stat, S: d.S, base: d.base, E: d.E, G: d.G, perk: gpGymMult(stat), candy: gpMultOf('candy'), weekly: g.group === 'a' ? 4400 : 2200,
        fill: d.fill, job: false, data: d, can: canItem ? { ...canItem, energy: canItem.energy * canMult } : null };
}

// ---- plan + chart ----
const gpWeekKey = () => `wwl_gym_plan_${new Date().toISOString().slice(0, 4)}_${Math.floor(Date.now() / (7 * 86400e3))}`;
const gpN = n => Math.round(n).toLocaleString();
const gpMoney = n => `$${Math.round(n).toLocaleString()}`;

function renderGymPlanner() {
    const inp = gpInputs();
    const grp = gpGroup();
    const high = grp.group === 'a';
    const d = inp.data;
    $('gp-group-note').innerHTML = grp.total === null
        ? 'Your battle stats couldn\'t be read, so the lowest minimum is used: <b style="color:var(--text);">at least 2,200 energy a week</b>.'
        : `From your own battle stats: <b style="color:var(--text);">${high ? '1.5m+' : 'under 1.5m'}</b> (${(grp.total / 1e6).toFixed(2)}m total) — <b style="color:var(--text);">at least ${high ? '4,400' : '2,200'} energy a week</b>.`;
    $('gp-data-note').innerHTML = `Using your own data: ${esc(inp.stat)} ${gpN(d.S)} · max happy ${gpN(d.base)} · ${gpN(d.fill)} E energy bar · ${d.gymName ? `${esc(d.gymName)} gym (${d.G.toFixed(1)} dots, ${gpN(d.E)} E per train)` : 'gym unknown'}.`
        + (d.notes.length ? `<br><span style="color:var(--danger);">Assumed because ${esc(d.notes.join(' and '))}.</span>` : '');

    // the bonuses used: faction Steadfast per stat, plus candy / cans / cooldown / other gym perks from the member's own perks
    const pk = gpPerkList(), st = gpSteadfast();
    const steadfast = !Array.isArray(gpPerks) ? `Your gym bonuses couldn't be read${gpPerks?.error ? ` (${esc(gpPerks.error)})` : ''}, so none are included.`
        : pk.some(p => p.kind === 'gym' && p.source === 'faction')
            ? `Faction Steadfast: <b style="color:var(--text);">Strength +${st.strength}% · Defense +${st.defense}% · Speed +${st.speed}% · Dexterity +${st.dexterity}%</b>`
            : 'No faction gym bonus (Steadfast) found on your account.';
    const cool = pk.filter(p => p.kind === 'cooldown').map(p => `${p.what} cooldown ${p.pct > 0 ? '+' : ''}${p.pct}%`);
    const candy = pk.filter(p => p.kind === 'candy').reduce((s, p) => s + p.pct, 0);
    const cansPct = pk.filter(p => p.kind === 'cans').reduce((s, p) => s + p.pct, 0);
    $('gp-perks-note').innerHTML = `${steadfast}<br>All gym gains for ${esc(inp.stat)}: ×${inp.perk.toFixed(3)}${candy ? ` · candy happiness +${candy}%` : ''}${cansPct ? ` · energy cans +${cansPct}%` : ''}${cool.length ? ` · ${esc(cool.join(', '))}` : ''}`
        + (pk.length ? `<details style="margin-top:4px;"><summary style="cursor:pointer;">Bonuses found on your account (to check)</summary>${pk.map(p => `<div>${esc(p.source)}: ${esc(p.text)}</div>`).join('')}</details>` : '');

    // stat buttons — the two stats with the best faction bonus are highlighted
    const known = Array.isArray(gpPerks);
    const ranked = Object.entries(st).sort((a, b) => b[1] - a[1]);
    const top = known ? new Set(ranked.slice(0, 2).filter(([, v]) => v > 0).map(([k]) => k)) : new Set();
    $('gp-stats').innerHTML = Object.keys(GP_STAT_AB).map(k => `
        <button class="gp-stat${k === inp.stat ? ' sel' : ''}${top.has(k) ? ' best' : ''}" data-stat="${k}">
            <div class="t">${GP_STAT_LABEL[k]}${top.has(k) ? ' ★' : ''}</div>
            <div class="s">${known ? `Steadfast +${st[k]}%` : ''}</div>
        </button>`).join('');
    $('gp-stats').querySelectorAll('.gp-stat').forEach(b => b.addEventListener('click', () => {
        try { localStorage.setItem(GP_STAT_KEY, b.dataset.stat); } catch (e) { /* not critical */ }
        renderGymPlanner();
    }));
    $('gp-stat-hint').style.display = top.size ? '' : 'none';

    const xanPerDay = gpXanPerDay(), jumpRefillOn = gpJumpRefillOn(), candyPerDay = gpCandyPerDay();
    const methods = gpMethods(inp.fill, inp.job, inp.candy, xanPerDay, jumpRefillOn, candyPerDay); // every method is listed for everyone
    let sel = 'nat-soft';
    try { sel = localStorage.getItem(GP_METHOD_KEY) || 'nat-soft'; } catch (e) { /* default */ }
    if (sel === 'natural') sel = 'nat-soft'; // older saved choice
    if (sel === 'lollipop') sel = 'candy'; // the Lollipop jump is now the Candy jump
    if (!methods.find(m => m.id === sel)) sel = 'nat-soft';
    // jumps per week the member set for a method — capped by how many FULL cycles actually fit (never a
    // half-finished one; see gpMaxSessions). A 4-Xanax method's cap depends on the Xanax-per-day setting.
    let overrides = {};
    try { overrides = JSON.parse(localStorage.getItem('wwl_gym_sessions') || '{}'); } catch (e) { /* defaults */ }
    methods.forEach(m => { if (m.kind !== 'natural' && overrides[m.id] !== undefined) m.sessions = Math.min(gpMaxSessions(m, xanPerDay), Math.max(0, Number(overrides[m.id]) || 0)); });
    const chosen = methods.find(m => m.id === sel);
    const maxSessions = gpMaxSessions(chosen, xanPerDay);
    if ($('gp-sessions').dataset.method !== sel) { $('gp-sessions').value = chosen.sessions; $('gp-sessions').dataset.method = sel; }
    $('gp-sessions').max = maxSessions;
    $('gp-sessions-max').textContent = maxSessions;
    $('gp-sessions-wrap').style.display = chosen.kind === 'natural' ? 'none' : 'inline-flex';
    // Xanax-per-day: only relevant for methods that actually stack more than 1 (0/1-Xanax and candy2x don't need it)
    $('gp-xanperday-wrap').style.display = (chosen.items?.xanax || 0) > 1 ? 'flex' : 'none';
    $('gp-xanperday').value = xanPerDay;
    $('gp-jump-refill-wrap').style.display = (chosen.items?.xanax || 0) > 1 ? 'flex' : 'none';
    $('gp-jump-refill').checked = jumpRefillOn;
    // Candy jump (Nx daily): how many times a day, min 2 (the member's own tested baseline) up to the real
    // max a full Energy bar can regenerate that often (see GP_CANDY_PER_DAY_MAX) — same idea as natural
    // energy's own easy/hard choice.
    $('gp-candyperday-wrap').style.display = sel === 'candy2x' ? 'flex' : 'none';
    $('gp-candyperday').min = GP_CANDY_PER_DAY_MIN; $('gp-candyperday').max = GP_CANDY_PER_DAY_MAX;
    $('gp-candyperday').value = candyPerDay;
    $('gp-settings-label').textContent = `— ${GP_STAT_LABEL[inp.stat]} · ${chosen.name}`;

    // estimates for every method (jump methods with the member's own jumps/week)
    const candyPick = gpCandyChoice();
    const prices = candyPick && candyPick.price != null ? { ...gpPrices, [GP_ITEMS.candy]: candyPick.price } : gpPrices;
    const rows = methods.map(m => ({ m, w: gpWeek(m, inp, prices, xanPerDay) }));

    // method cards: name, what it is, and the estimated gain and cost for a week
    $('gp-methods').innerHTML = rows.map(({ m, w }) => `
        <button class="gp-method${m.id === sel ? ' sel' : ''}" data-id="${m.id}">
            <div class="t">${esc(m.name)}</div>
            <div class="s">${esc(m.sub)}</div>
            ${m.property ? `<div class="s" style="color:var(--muted);">🏠 Needs: ${esc(m.property)}</div>` : ''}
            <div class="n"><span style="color:var(--reagent);">+${gpN(w.gain)} ${esc(inp.stat)}</span> · ${w.priced ? gpMoney(w.cost) : '$?'} / week</div>
            ${w.jumps ? `<div class="s" style="color:var(--muted);">${w.priced ? gpMoney(w.perJump) : '$?'} per jump × ${w.jumps} jump${w.jumps === 1 ? '' : 's'} a week</div>` : ''}
        </button>`).join('');
    $('gp-methods').querySelectorAll('.gp-method').forEach(b => b.addEventListener('click', () => {
        try { localStorage.setItem(GP_METHOD_KEY, b.dataset.id); } catch (e) { /* not critical */ }
        $('gp-sessions').dataset.method = ''; renderGymPlanner();
    }));

    // candy jump: pick which 25-happy candy you use — the cost follows it
    $('gp-candy-wrap').style.display = sel.startsWith('candy') ? 'block' : 'none';
    $('gp-candy-pick').innerHTML = gpCandy25.map(c => `<option value="${esc(c.name)}" ${candyPick && c.name === candyPick.name ? 'selected' : ''}>${esc(c.name)}${c.price ? ` — ${gpMoney(c.price)} each` : ''}</option>`).join('');
    $('gp-candy-note').textContent = gpCandy25.length
        ? `Any candy worth 25 happy works (49 of them = 1,225 happy). Pick the one you use, so the cost is right for you. By default it is the cheapest.`
        : 'Any candy worth 25 happy works, for example the Lollipop. The list of candies could not be loaded right now.';
    // natural energy options: only when a natural method is the picked one
    const natState = gpNatState();
    const nat = chosen.kind === 'natural' ? gpNatFor(chosen.mode) : null;
    $('gp-nat-opts').style.display = nat ? 'block' : 'none';
    if (nat) {
        $('gp-refill').checked = !!nat.refill;
        $('gp-bars').value = nat.bars; $('gp-xan').value = nat.xan;
        $('gp-nat-desc').textContent = `${chosen.name}: ${nat.bars} natural bars and ${nat.xan} Xanax${nat.refill ? ' and the energy refill' : ''} a day${nat.canCount ? `, plus ${nat.canCount} energy can${nat.canCount === 1 ? '' : 's'}` : ''}.`;
        $('gp-can').innerHTML = `<option value="">No energy cans</option>` + gpCans.map(c => `<option value="${esc(c.name)}" ${c.name === natState.cans.name ? 'selected' : ''}>${esc(c.name)} — +${gpN(c.energy * gpMultOf('cans'))} E${c.price ? ` · ${gpMoney(c.price)}` : ''}</option>`).join('');
        $('gp-can-n').value = natState.cans.count || 0;
        $('gp-can-n').disabled = !natState.cans.name;
        $('gp-can-note').textContent = gpCans.length
            ? `Every can gives its own amount of energy${gpMultOf('cans') !== 1 ? ' (your energy can bonus is included)' : ''}. Cans share the booster cooldown${cool.some(c => c.startsWith('booster')) ? ' — your booster cooldown perk helps here' : ''}, so watch how many you take in a day.`
            : 'Energy cans could not be loaded right now.';
    }

    // comparison chart: every method side by side (both natural methods, then the jumps)
    const maxGain = Math.max(1, ...rows.map(r => r.w.gain));
    const maxCost = Math.max(1, ...rows.map(r => r.w.priced ? r.w.cost : 0));
    $('gp-chart').innerHTML = rows.map(({ m, w }) => `
        <div style="margin-bottom:12px;${m.id === sel ? 'outline:1px solid var(--reagent);outline-offset:4px;border-radius:6px;' : ''}">
            <div style="display:flex;justify-content:space-between;gap:10px;font-size:13px;"><b>${esc(m.name)}</b>
                <span style="color:var(--muted);">${m.sessions ? `${m.sessions} jump${m.sessions === 1 ? '' : 's'}/week · ` : ''}${gpN(w.energyUsed)} E</span></div>
            ${m.property ? `<div style="font-size:11px;color:var(--muted);">🏠 Needs: ${esc(m.property)}</div>` : ''}
            <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
                <div style="width:70px;font-size:11px;color:var(--muted);">Stat gain</div>
                <div style="flex:1;background:var(--bench-2);border-radius:4px;height:14px;"><div style="width:${(w.gain / maxGain * 100).toFixed(1)}%;background:var(--reagent);height:14px;border-radius:4px;"></div></div>
                <div style="width:110px;text-align:right;font-family:var(--mono);font-size:12px;">+${gpN(w.gain)}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:3px;">
                <div style="width:70px;font-size:11px;color:var(--muted);">Item cost</div>
                <div style="flex:1;background:var(--bench-2);border-radius:4px;height:14px;"><div style="width:${w.priced ? (w.cost / maxCost * 100).toFixed(1) : 0}%;background:#f0b432;height:14px;border-radius:4px;"></div></div>
                <div style="width:110px;text-align:right;font-family:var(--mono);font-size:12px;">${w.priced ? gpMoney(w.cost) : '?'}</div>
            </div>
            ${w.jumps ? `<div style="font-size:11px;color:var(--muted);margin:2px 0 0 78px;">${w.priced ? gpMoney(w.perJump) : "$?"} per jump × ${w.jumps} jump${w.jumps === 1 ? "" : "s"} a week${(m.items?.xanax || 0) > 1 ? " (stacking Xanax takes several days of cooldowns, so fewer jumps fit in a week)" : ""}</div>` : ""}
            ${m.kind !== 'natural' ? (w.gain - rows[0].w.gain > 0 ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;">+${gpN(w.gain - rows[0].w.gain)} stat points more than soft natural${w.priced && w.cost > 0 ? ` — about ${gpMoney(w.cost / (w.gain - rows[0].w.gain))} per extra point` : ''}</div>` : '<div style="font-size:11px;color:var(--muted);margin-top:2px;">No gain over soft natural with these numbers</div>') : ''}
        </div>`).join('');

    // Week plan for the chosen method, laid out like the standard planner: one block per day, each
    // step its own tick box, progress counted in energy. Ideal termed-war week: 4 training days,
    // 2 war prep days, 1 war day.
    const w = rows.find(r => r.m.id === sel).w;
    let checks = {};
    try { checks = JSON.parse(localStorage.getItem(gpWeekKey()) || '{}'); } catch (e) { /* none */ }
    const restPerDay = Math.round(w.restEnergy / 4);
    // Natural energy split into bars, like the standard planner — each bar takes about GP_ENERGY_REGEN_H to
    // regen, so a wait note is added between fills instead of listing them back to back as if instant.
    const fillsFor = (energy) => {
        const out = [];
        for (let left = Math.round(energy), i = 1; left > 0; i++) {
            const part = Math.min(inp.fill, left);
            out.push({ label: `Natural energy fill #${i} (${gpN(part)} E)${part >= inp.fill ? ` — full bar, ≈${GP_ENERGY_REGEN_H}h to regen` : ''} — at your normal happy`, value: part });
            left -= part;
            if (left > 0) out.push({ note: true, label: `Wait ≈${GP_ENERGY_REGEN_H}h for your bar to refill` });
        }
        return out;
    };
    // Turns a fillsFor() list into plan items — a "note" entry becomes a non-checkbox arrow line, everything
    // else a checkbox with its own unique key.
    const pushFills = (items, list, prefix) => {
        let n = 0;
        list.forEach(it => { if (it.note) items.push({ note: true, label: it.label }); else items.push({ key: `${prefix}${n++}`, label: it.label, value: it.value }); });
    };
    const xanaxCount = chosen.items?.xanax || 0;
    const blocks = [];
    if (xanaxCount > 1) {
        // ONE continuous drug-cooldown clock across every jump this week, not a separate isolated block
        // per jump — the moment one jump's LAST dose clears, the very next dose (for the NEXT jump) can
        // follow right after, so two jumps can genuinely share a day. Always the conservative 8h cooldown
        // (see GP_COOLDOWN_H), at up to `xanPerDay` doses a day (capped at 3 — 4 doses 8h apart already
        // spans a full 24h, landing the 4th on the next day no matter when you start).
        // Ecstasy shares the SAME drug-cooldown pool as Xanax — it can only be taken once the last Xanax's
        // cooldown clears (never right away), and then has its own cooldown (a shorter, real max of 4h)
        // before whatever drug comes next. So it's one more real "drug action" in the sequence, not a
        // free extra step — see gpDrugActions().
        const doses = []; // flat, in order: one entry per drug action (a Xanax dose, or the session's Ecstasy)
        for (let s = 0; s < chosen.sessions; s++) {
            for (let n = 1; n <= xanaxCount; n++) doses.push({ s, type: 'xanax', n });
            if (chosen.ecstasy) doses.push({ s, type: 'ecstasy' });
        }
        // "Jump N —" is the one shared way every method labels a same-day/same-week extra session, so a
        // member sees the exact same style whether it's this multi-day stack or the simpler jumps below.
        const jumpTag = s => chosen.sessions > 1 ? `Jump ${s + 1} — ` : '';
        const info = gpXanaxDayInfo(chosen, xanPerDay);
        let di = 0, dayNum = 0;
        while (di < doses.length && dayNum < GP_TRAINING_DAYS) {
            const items = [];
            const notes = [];
            for (let slot = 0; slot < xanPerDay && di < doses.length; slot++, di++) {
                const dose = doses[di];
                const tag = jumpTag(dose.s);
                const isLast = di === doses.length - 1;
                if (dose.type === 'xanax') {
                    const isLastXanax = dose.n === xanaxCount;
                    items.push({ key: `s${dose.s}xn${dose.n}`, label: `${tag}Take Xanax #${dose.n}${isLastXanax ? ' — you should now be holding around 1,000 E' : ''}`, value: 0 });
                    if (!isLast) items.push({ note: true, label: `Wait ${GP_COOLDOWN_H}h for the drug cooldown to clear` });
                } else { // ecstasy — comes right after its session's last Xanax cooldown, then the actual jump happens
                    const sd = w.perSession[dose.s];
                    notes.push(`${chosen.sessions > 1 ? `Jump ${dose.s + 1}` : chosen.name}: happy ≈ ${gpN(sd.peak)}, estimated +${gpN(sd.gain)} ${inp.stat}.`);
                    items.push({ note: true, label: 'Wait until just past a :00 / :15 / :30 / :45 reset' });
                    const main = chosen.items.candy ? `all ${chosen.items.candy} ${gpCandyChoice()?.name || 'candies worth 25 happy each'}`
                        : chosen.items.choco ? `all ${chosen.items.choco} Big Boxes of Chocolate Bars` : `all ${chosen.items.edvd} Erotic DVDs`;
                    items.push({ key: `s${dose.s}take`, label: `${tag}Take ${main}`, value: 0 });
                    items.push({ key: `s${dose.s}ecstasy`, label: `${tag}Use the Ecstasy — it doubles your Happy`, value: 0 });
                    const jumpTrain = chosen.refill ? sd.energy - inp.fill : sd.energy;
                    items.push({ key: `s${dose.s}train`, label: `${tag}Train: spend ${gpN(jumpTrain)} E`, value: jumpTrain });
                    if (chosen.refill) items.push({ key: `s${dose.s}refill`, label: `${tag}Spend 25 points on an energy refill and train again (${gpN(inp.fill)} E)`, value: inp.fill });
                    if (!isLast) items.push({ note: true, label: `Wait ${GP_ECSTASY_COOLDOWN_H}h for Ecstasy's own drug cooldown to clear` });
                }
            }
            dayNum++;
            // No natural energy is mixed into an active stacking day while a cooldown is genuinely running —
            // but the LAST day of the whole stack often finishes its jump using fewer than `xanPerDay` slots
            // (e.g. only the Ecstasy step, no next Xanax queued behind it), leaving real spare time that day.
            // That spare time gets its own top-up below, sized to exactly how much of the day is actually free.
            if (dayNum === info.dayNum && info.spareSlotsLastDay > 0 && info.leftoverDayEquiv > 0) {
                const share = (info.spareSlotsLastDay / xanPerDay) / info.leftoverDayEquiv;
                pushFills(items, fillsFor(Math.round(w.restEnergy * share)), `d${dayNum}rest`);
            }
            blocks.push({ title: `Day ${dayNum}`, note: notes.join(' '), items });
        }
        // Any training day left over once every full jump cycle is placed — never a half-finished one —
        // gets natural energy instead, its share of the week's rest energy spread only over those leftover
        // days (the last active day above already took its own smaller share for its spare slots).
        const leftoverDays = GP_TRAINING_DAYS - dayNum;
        const fullDayShare = info.leftoverDayEquiv > 0 ? 1 / info.leftoverDayEquiv : 0;
        const leftoverPerDay = leftoverDays > 0 ? Math.round(w.restEnergy * fullDayShare) : 0;
        for (let i = dayNum; i < GP_TRAINING_DAYS; i++) {
            const items = [];
            pushFills(items, fillsFor(leftoverPerDay), `rest${i}n`);
            blocks.push({ title: `Day ${i + 1} (natural energy)`, note: '', items });
        }
    } else {
        // 0/1-Xanax jumps, natural methods, and perDay methods like Candy jump (2x daily) — all fit within a
        // single calendar day each, same as before.
        const jumpsByDay = [[], [], [], []]; // training day index (0-3) -> [session numbers]
        for (let k = 0; k < chosen.sessions; k++) jumpsByDay[Math.floor(k * GP_TRAINING_DAYS / chosen.sessions)].push(k);
        for (let i = 0; i < GP_TRAINING_DAYS; i++) {
            const day = `d${i + 1}`;
            const items = [];
            const daySessions = jumpsByDay[i];
            const notes = [];
            daySessions.forEach((sessionNum, j) => {
                const s = w.perSession[sessionNum];
                if (!s) return;
                // Same "Jump N — " style as the multi-day Xanax stack above, whether it's Candy jump (Nx
                // daily)'s several same-day sessions or just this one day's single jump.
                const tag = daySessions.length > 1 ? `Jump ${j + 1} — ` : '';
                const noteName = daySessions.length > 1 ? `Jump ${j + 1}` : chosen.name;
                notes.push(`${noteName}: happy ≈ ${gpN(s.peak)}, estimated +${gpN(s.gain)} ${inp.stat}.`);
                const pfx = daySessions.length > 1 ? `${day}j${j}` : day;
                gpJumpFinishSteps(chosen, inp).forEach((st, n) => {
                    const text = st.do || st.buy;
                    if (st.wait) items.push({ note: true, label: `${tag}Wait ${st.wait}` });
                    else items.push({ key: `${pfx}s${n}`, label: `${tag}${text}`, value: 0 });
                });
                const jumpTrain = chosen.refill ? s.energy - inp.fill : s.energy;
                items.push({ key: `${pfx}train`, label: `${tag}Train: spend ${gpN(jumpTrain)} E`, value: jumpTrain });
                if (chosen.refill) items.push({ key: `${pfx}refill`, label: `${tag}Spend 25 points on an energy refill and train again (${gpN(inp.fill)} E)`, value: inp.fill });
            });
            const note = notes.join(' ');
            if (nat) {
                // The natural energy day: bars through the day (Xanax with the morning and evening bar first), a refill, and any cans.
                const names = ['Morning', 'Lunch', 'Evening', 'Night'];
                const xanAt = [0, 2, 1, 3];
                const withBar = new Set(xanAt.filter(b => b < nat.bars).slice(0, nat.xan));
                for (let b = 0; b < nat.bars; b++) {
                    items.push({ key: `${day}b${b}`, label: `${names[b]}: natural energy bar (${gpN(inp.fill)} E) — ≈${GP_ENERGY_REGEN_H}h to fill`, value: inp.fill });
                    if (withBar.has(b)) items.push({ key: `${day}x${b}`, label: `${names[b]}: Xanax (250 E) — ${GP_COOLDOWN_H}h cooldown before the next one`, value: 250 });
                }
                for (let x = withBar.size; x < nat.xan; x++) items.push({ key: `${day}xe${x}`, label: `Extra Xanax (250 E) — ${GP_COOLDOWN_H}h cooldown before the next one`, value: 250 });
                if (nat.refill) items.push({ key: `${day}ref`, label: `Energy refill (${gpN(inp.fill)} E)`, value: inp.fill });
                for (let c = 0; c < nat.canCount; c++) items.push({ key: `${day}c${c}`, label: `Energy can: ${inp.can.name} (${gpN(inp.can.energy)} E)`, value: inp.can.energy });
            } else {
                pushFills(items, fillsFor(restPerDay), `${day}n`);
            }
            blocks.push({ title: `Training day ${i + 1}`, note, items });
        }
    }
    blocks.push({ title: 'War prep day 1', note: 'No gym in this ideal week — get ready for the war.', items: [] });
    blocks.push({ title: 'War prep day 2', note: 'No gym in this ideal week — get ready for the war.', items: [] });
    blocks.push({ title: 'War day', note: 'Hit! (Only when we have a termed war — this is the ideal week.)', items: [] });

    $('gp-plan').innerHTML = blocks.map(b => `
        <div class="stat" style="margin-bottom:10px;">
            <div class="k">${esc(b.title)}</div>
            ${b.note ? `<div class="s" style="margin:4px 0 8px;line-height:1.5;">${esc(b.note)}</div>` : ''}
            ${b.items.map(it => it.note
                ? `<div style="padding:4px 0 4px 4px;color:var(--muted);font-size:13px;">→ ${esc(it.label)}</div>`
                : `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;">
                <input type="checkbox" class="gp-check" data-k="${it.key}" data-value="${it.value}" ${checks[it.key] ? 'checked' : ''} style="width:auto;">
                ${esc(it.label)}
            </label>`).join('')}
        </div>`).join('');
    $('gp-plan').querySelectorAll('.gp-check').forEach(cb => cb.addEventListener('change', () => {
        checks[cb.dataset.k] = cb.checked;
        try { localStorage.setItem(gpWeekKey(), JSON.stringify(checks)); } catch (e) { /* not critical */ }
        gpPlanFetch({ action: 'plan-check', step: cb.dataset.k, checked: cb.checked }); // so the userscript in Torn shows the same ticks
        renderGpProgress();
    }));
    renderGpProgress();
    // keep a copy of the plan on the server, so the WWL userscript in Torn shows the same checklist (ticks are shared both ways).
    // `weekly` (this member's own personal energy minimum) rides along too — it's the only way the Energy
    // Tracker leaderboard can know it, since battle stats (what it's based on) are private to this key alone.
    gpPlanFetch({ action: 'plan-save', week: Math.floor(Date.now() / (7 * 86400e3)), stat: inp.stat, method: chosen.name, checks,
        summary: `${chosen.name}: about +${gpN(w.gain)} ${inp.stat} from ${gpN(w.energyUsed)} energy a week`, blocks, weekly: inp.weekly }).then(r => {
        gpSetPlan(r?.plan); renderGpProgress();
        const server = r?.plan?.checks;
        if (!server) return;
        let changed = false;
        $('gp-plan').querySelectorAll('.gp-check').forEach(cb => { const on = !!server[cb.dataset.k]; if (cb.checked !== on) { cb.checked = on; checks[cb.dataset.k] = on; changed = true; } });
        if (changed) { try { localStorage.setItem(gpWeekKey(), JSON.stringify(checks)); } catch (e) { /* not critical */ } renderGpProgress(); }
    });
    const gap = inp.weekly - w.energyUsed;
    const reqNote = gap > 0 ? `<div style="color:var(--danger);font-size:13px;margin-top:4px;">That is ${gpN(gap)} E short of your minimum of ${gpN(inp.weekly)} E a week — add a bar, a Xanax, a refill or an energy can.</div>` : `<div style="color:var(--reagent);font-size:13px;margin-top:4px;">Meets your minimum of ${gpN(inp.weekly)} E a week.</div>`;
    $('gp-summary').innerHTML = `<b>${esc(chosen.name)}</b> for a week: about <b style="color:var(--reagent);">+${gpN(w.gain)} ${inp.stat}</b> from ${gpN(w.energyUsed)} energy${w.priced ? `, items ≈ <b>${gpMoney(w.cost)}</b>${w.jumps ? ` (${gpMoney(w.perJump)} per jump × ${w.jumps} jump${w.jumps === 1 ? "" : "s"})` : ""}` : ''}.${reqNote}`;
}

// Steps for a jump that fits in a single day — 0 or 1 Xanax only. A method with MORE than 1 Xanax builds
// its own stacking + finish steps inline in renderGymPlanner() instead, spread across the real number of
// days it actually takes (see GP_COOLDOWN_H, gpXanaxDays) — never crammed into one day.
function gpJumpFinishSteps(m, inp) {
    const items = Object.entries(m.items).map(([k, q]) => `${q}× ${GP_ITEMS[k]}`).join(' + ');
    const steps = [{ do: `Have everything ready: ${items}` }];
    if (m.items.xanax === 1) {
        steps.push({ do: 'Take the Xanax' });
        steps.push({ wait: `${GP_COOLDOWN_H}h for the drug cooldown to clear` });
    } else {
        steps.push({ wait: `until your energy bar is full (${gpN(inp.fill)} E)` });
    }
    steps.push({ wait: 'until just past a :00 / :15 / :30 / :45 reset' });
    const main = m.items.candy ? `all ${m.items.candy} ${gpCandyChoice()?.name || 'candies worth 25 happy each'} (25 happy each)` : m.items.choco ? `all ${m.items.choco} Big Boxes of Chocolate Bars` : `all ${m.items.edvd} Erotic DVDs`;
    steps.push({ do: `Take ${main}` });
    if (m.ecstasy) steps.push({ do: 'Use the Ecstasy — it doubles your Happy' });
    return steps;
}
// how the bar counts: the member's own ticks (default) or the energy they really trained this week (the energy tracker's counter). The boxes can be ticked either way.
let gpTrack = 'boxes', gpCounter = null;
function gpSetPlan(plan) {
    gpTrack = plan && plan.track === 'counter' ? 'counter' : 'boxes'; gpCounter = plan && plan.counter || null;
    if ($('gp-track')) $('gp-track').value = gpTrack;
    if ($('gp-start')) $('gp-start').value = plan && plan.startDay || '';
    if ($('gp-week-note') && plan && plan.weekStart) {
        const f = s => new Date(s * 1000).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
        $('gp-week-note').textContent = `This training week: ${f(plan.weekStart)} to ${f(plan.weekStart + 6 * 86400)} (TCT)${plan.startDay ? '' : plan.anchor ? ', starting the day the last war ended' : ', counted from the calendar week'}. Not right? Set the day your week really started.`;
    }
}
function renderGpProgress() {
    let done = 0, total = 0;
    document.querySelectorAll('#gp-plan .gp-check').forEach(cb => { const v = parseInt(cb.dataset.value, 10) || 0; total += v; if (cb.checked) done += v; });
    const note = $('gp-track-note');
    if (gpTrack === 'counter') {
        if (gpCounter && gpCounter.known) { done = gpCounter.trained; if (note) note.textContent = 'Counted from the energy tracker. You can still tick the boxes as a checklist.'; }
        else { done = 0; if (note) note.textContent = 'The energy tracker has no numbers for you yet.'; }
    } else if (note) note.textContent = '';
    $('gp-progress').textContent = `${gpN(done)} / ${gpN(total)} E${gpTrack === 'counter' ? ' trained' : ''}`;
    $('gp-progress-fill').style.width = `${total ? Math.min(100, done / total * 100) : 0}%`;
}

$('gp-track').addEventListener('change', async () => {
    const mode = $('gp-track').value, r = await gpPlanFetch({ action: 'plan-track', mode });
    if (!r) { toast('Could not change that - open the planner once so a plan is saved, then try again.'); $('gp-track').value = gpTrack; return; }
    gpSetPlan(r.plan); renderGpProgress();
});

async function gpChangeStart(startDay) {
    const r = await gpPlanFetch({ action: 'plan-start', startDay });
    if (!r) { toast('Could not change that - pick a day from the last 60 days up to today (and open the planner once so a plan is saved).'); return; }
    gpSetPlan(r.plan); renderGymPlanner(); // draws it again so the ticks and the bar follow the new week
}
$('gp-start').addEventListener('change', () => gpChangeStart($('gp-start').value));
$('gp-start-auto').addEventListener('click', () => gpChangeStart(''));

async function loadGymPlanner() {
    await Promise.all([gpLoadPrices(), gpLoadGyms(), gpLoadPerks()]);
    renderGymPlanner();
}

// ---- the only things a member can change ----
$('gp-sessions').addEventListener('change', () => {
    let o = {}; try { o = JSON.parse(localStorage.getItem('wwl_gym_sessions') || '{}'); } catch (e) { /* fresh */ }
    const max = Number($('gp-sessions').max) || 4;
    o[$('gp-sessions').dataset.method] = Math.min(max, Math.max(0, Number($('gp-sessions').value) || 0));
    try { localStorage.setItem('wwl_gym_sessions', JSON.stringify(o)); } catch (e) { /* not critical */ }
    renderGymPlanner();
});
$('gp-refill').addEventListener('change', () => { gpSaveNatState({ ...gpNatState(), refill: $('gp-refill').checked }); renderGymPlanner(); });
$('gp-xanperday').addEventListener('change', () => {
    const v = Math.min(3, Math.max(1, Math.round(Number($('gp-xanperday').value) || 1)));
    try { localStorage.setItem(GP_XAN_PER_DAY_KEY, String(v)); } catch (e) { /* not critical */ }
    renderGymPlanner();
});
$('gp-jump-refill').addEventListener('change', () => {
    try { localStorage.setItem(GP_JUMP_REFILL_KEY, $('gp-jump-refill').checked ? '1' : '0'); } catch (e) { /* not critical */ }
    renderGymPlanner();
});
$('gp-candyperday').addEventListener('change', () => {
    const v = Math.min(GP_CANDY_PER_DAY_MAX, Math.max(GP_CANDY_PER_DAY_MIN, Math.round(Number($('gp-candyperday').value) || GP_CANDY_PER_DAY_MIN)));
    try { localStorage.setItem(GP_CANDY_PER_DAY_KEY, String(v)); } catch (e) { /* not critical */ }
    renderGymPlanner();
});
$('gp-can').addEventListener('change', () => {
    const s = gpNatState();
    gpSaveNatState({ ...s, cans: { name: $('gp-can').value, count: $('gp-can').value ? Math.max(1, s.cans.count || 1) : 0 } });
    renderGymPlanner();
});
$('gp-can-n').addEventListener('change', () => {
    const s = gpNatState();
    gpSaveNatState({ ...s, cans: { name: s.cans.name, count: Math.min(6, Math.max(0, Number($('gp-can-n').value) || 0)) } });
    renderGymPlanner();
});
['gp-bars', 'gp-xan'].forEach(id => $(id).addEventListener('change', () => { // experienced players: their own bars and Xanax per day
    let sel = 'nat-soft';
    try { sel = localStorage.getItem(GP_METHOD_KEY) || 'nat-soft'; } catch (e) { /* default */ }
    const mode = sel === 'nat-hard' ? 'hard' : 'soft';
    const s = gpNatState();
    s.over = { ...s.over, [mode]: { bars: Number($('gp-bars').value), xan: Number($('gp-xan').value) } };
    gpSaveNatState(s);
    renderGymPlanner();
}));

// The settings fold away once someone has made their choices (open the first time, closed after that);
// opening or closing it by hand is remembered.
(function () {
    const el = $('gp-settings');
    let saved = null;
    try { saved = localStorage.getItem('wwl_gym_settings_open'); } catch (e) { /* default */ }
    let hasChoice = false;
    try { hasChoice = !!localStorage.getItem(GP_METHOD_KEY); } catch (e) { /* first time */ }
    el.open = saved !== null ? saved === '1' : !hasChoice;
    el.addEventListener('toggle', () => { try { localStorage.setItem('wwl_gym_settings_open', el.open ? '1' : '0'); } catch (e) { /* not critical */ } });
})();
$('gp-candy-pick').addEventListener('change', () => { try { localStorage.setItem(GP_CANDY_KEY, $('gp-candy-pick').value); } catch (e) { /* not critical */ } renderGymPlanner(); });

async function gpPlanFetch(body) {
    try {
        const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
        const r = await res.json();
        return r.error ? null : r;
    } catch (e) { return null; }
}
