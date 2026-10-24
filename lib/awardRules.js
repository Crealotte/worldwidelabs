// lib/awardRules.js — turns the description of an honor or medal ("Win 5,000 attacks") into something that can be measured: which of the member's own stats counts,
// what the goal is, and how long it takes (the way YATA does it).
//
// A rule is { s, g, e?, d?, p? }
//   s  where the member's current value is read: a path in Torn's personalstats ('attacking.attacks.won') or one of the specials
//      'lvl' (level), 'age' (days since signing up), 'mar' (days married), 'fac' (days in the faction), 'awd' (awards), 'edu' (courses completed), 'rank' (index in Torn's rank list)
//   g  the goal, in the same unit as s after dividing by d
//   d  divide the stat by this first (seconds -> days is 86400, seconds -> hours is 3600)
//   p  [[s, g], ...] when several stats must all be reached (the least advanced one counts)
//   e  how the time is worked out: { m: 'energy', per } energy per action, spent from the energy that is gained per day;
//      { m: 'cooldown', min } minutes the drug cooldown lasts; { m: 'calendar' } the days just have to pass; none = no estimate
// Awards that are not here (luck, events, "never", things Torn gives no number for) simply show no progress.

const num = s => Number(String(s).replace(/[$,]/g, ''));
const ENERGY = { m: 'energy', per: 25 }, CAL = { m: 'calendar' };
const RANKS = ['absolute beginner', 'beginner', 'inexperienced', 'rookie', 'novice', 'below average', 'average', 'reasonable', 'above average', 'competent', 'highly competent', 'veteran', 'distinguished', 'highly distinguished', 'professional', 'star', 'master', 'outstanding', 'celebrity', 'supreme', 'idolized', 'champion', 'heroic', 'legendary', 'elite', 'invincible'];
const ONES = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TEENS = { ten: 10, fifteen: 15 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
function words(s) { // 'Twenty Five' -> 25, 'One Hundred' -> 100, '75' -> 75
    if (/^\d+$/.test(s)) return Number(s);
    const w = String(s).toLowerCase().split(/\s+/);
    if (w.join(' ') === 'one hundred') return 100;
    if (w.length === 1) return ONES[w[0]] || TEENS[w[0]] || TENS[w[0]] || 0;
    if (w.length === 2 && TENS[w[0]] && ONES[w[1]]) return TENS[w[0]] + ONES[w[1]];
    return 0;
}
const YEARS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

const DRUG = { xanax: 'xanax', vicodin: 'vicodin', speed: 'speed', shrooms: 'shrooms', pcp: 'pcp', opium: 'opium', lsd: 'lsd', ketamine: 'ketamine', ecstasy: 'ecstasy', cannabis: 'cannabis' };
const DRUG_CD = { xanax: 420, cannabis: 75 }; // minutes of drug cooldown (Xanax 6-8 hours, Cannabis 60-90 minutes: the middle); the other drugs get no estimate
const FINISH = { 'slashing weapons': 'slashing', shotguns: 'shotguns', rifles: 'rifles', pistols: 'pistols', 'piercing weapons': 'piercing', 'mechanical weapons': 'mechanical', 'machine guns': 'machine_guns', 'heavy artillery': 'heavy_artillery', 'fists or kick': 'hand_to_hand', 'clubbing weapons': 'clubbing', SMGs: 'sub_machine_guns', 'temporary weapons': 'temporary' };
const OFFENSE = { vandalism: 'vandalism', theft: 'theft', 'illicit service': 'illicit_services', 'illegal production': 'illegal_production', fraud: 'fraud', extortion: 'extortion', cybercrime: 'cybercrime', counterfeiting: 'counterfeiting' };
const OLDCRIME = { 'grand theft auto': 'auto_theft', 'auto theft': 'auto_theft', fraud: 'fraud', computer: 'computer', theft: 'theft', murder: 'murder', 'drug dealing': 'drug_deals', bootlegging: 'sell_illegal_goods', other: 'other', 'arson/fraud': 'fraud' };
const SKILL = { shoplifting: 'shoplifting', 'search for cash': 'search_for_cash', scamming: 'scamming', pickpocketing: 'pickpocketing', hustling: 'hustling', graffiti: 'graffiti', forgery: 'forgery', disposal: 'disposal', cracking: 'cracking', 'card skimming': 'card_skimming', burglary: 'burglary', bootlegging: 'bootlegging', arson: 'arson' };
const COUNTRY = { 'united kingdom': 'united_kingdom', 'united arab emirates': 'united_arab_emirates', switzerland: 'switzerland', 'south africa': 'south_africa', mexico: 'mexico', japan: 'japan', hawaii: 'hawaii', china: 'china', 'cayman islands': 'cayman_islands', canada: 'canada', argentina: 'argentina' };
const AMMO = { 'special ammunition': 'special', 'hollow point rounds': 'hollow_point', 'tracer rounds': 'tracer', 'piercing rounds': 'piercing', 'incendiary rounds': 'incendiary' };

const rules = [];
const add = (re, f) => rules.push([re, f]);
const stat = (s, m, extra) => ({ s, g: num(m[1]), ...(extra || {}) });

// attacking
add(/^Win ([\d,]+) attacks$/, m => stat('attacking.attacks.won', m, { e: ENERGY }));
add(/^Successfully defend against ([\d,]+) attacks$/, m => stat('attacking.defends.won', m));
add(/^Win ([\d,]+) defends$/, m => stat('attacking.defends.won', m));
add(/^Achieve ([\d,]+) attacks and ([\d,]+) defends$/, m => ({ p: [['attacking.attacks.won', num(m[1])], ['attacking.defends.won', num(m[2])]], e: ENERGY }));
add(/^Achieve ([\d,]+) hits$/, m => stat('attacking.hits.success', m));
add(/^(?:Achieve|Deal) ([\d,]+) critical hits(?: to enemies during combat)?$/, m => stat('attacking.hits.critical', m));
add(/^Achieve ([\d,]+) one hit kills$/, m => stat('attacking.hits.one_hit_kills', m));
add(/^Deal over ([\d,]+) total damage$/, m => stat('attacking.damage.total', m));
add(/^Deal at least ([\d,]+) damage in a single hit$/, m => stat('attacking.damage.best', m));
add(/^Acquire a kill streak of ([\d,]+)$/, m => stat('attacking.killstreak.best', m));
add(/^Achieve a best kill streak of ([\d,]+)$/, m => stat('attacking.killstreak.best', m));
add(/^Win ([\d,]+) unarmored fights$/, m => stat('attacking.unarmored_wins', m, { e: ENERGY }));
add(/^Make ([\d,]+) stealthed attacks$/, m => stat('attacking.attacks.stealth', m, { e: ENERGY }));
add(/^Assist in ([\d,]+) attacks$/, m => stat('attacking.attacks.assist', m));
add(/^Assist in a single attack$/, () => ({ s: 'attacking.attacks.assist', g: 1 }));
add(/^Use a stat enhancer$/, () => ({ s: 'items.used.stat_enhancers', g: 1 }));
add(/^Stalemate ([\d,]+) times$/, m => stat('attacking.attacks.stalemate', m));
add(/^Fire ([\d,]+) rounds$/, m => stat('attacking.ammunition.total', m));
add(/^Use ([\d,]+) (special ammunition|hollow point rounds|tracer rounds|piercing rounds|incendiary rounds)$/i, m => stat('attacking.ammunition.' + AMMO[m[2].toLowerCase()], m));
add(/^Use ([\d,]+) rounds of (special ammunition)$/i, m => stat('attacking.ammunition.special', m));
add(/^Use ([\d,]+) (Hollow Point|Tracer|Piercing|Incendiary) rounds$/i, m => stat('attacking.ammunition.' + m[2].toLowerCase().replace(' ', '_'), m));
add(/^Earn ([\d,]+) respect for your faction$/, m => stat('attacking.faction.respect', m));
add(/^Make \$?([\d,]+) from a single mugging$/, m => stat('attacking.networth.largest_mug', m));
add(/^Make a single hit that earns your faction ([\d,]+) or more respect$/, null);
add(/^Collect ([\d,]+) bounties$/, m => stat('bounties.collected.amount', m, { e: ENERGY }));
add(/^Earn \$?([\d,]+) from bounty hunting$/, m => stat('bounties.collected.value', m));
add(/^Achieve ([\d,]+) finishing hits in every category$/, m => ({ p: Object.values(FINISH).map(k => ['finishing_hits.' + k, num(m[1])]), e: ENERGY }));
add(/^Achieve ([\d,]+) finishing hits with (.+)$/, m => FINISH[m[2]] ? stat('finishing_hits.' + FINISH[m[2]], m, { e: ENERGY }) : null);
// jail, hospital
add(/^Bust ([\d,]+) people from the Torn City jail$/, m => stat('jail.busts.success', m));
add(/^Make ([\d,]+) bails from jail$/, m => stat('jail.bails.amount', m));
add(/^Go to jail ([\d,]+) times$/, m => stat('jail.times_jailed', m));
add(/^Go to hospital ([\d,]+) times$/, m => stat('hospital.times_hospitalized', m));
add(/^Use ([\d,]+) medical items$/, m => stat('hospital.medical_items_used', m));
add(/^Revive ([\d,]+) people$/, m => stat('hospital.reviving.revives', m));
add(/^Fill ([\d,]+) empty blood bags$/, m => stat('hospital.blood_withdrawn', m));
// drugs
add(/^Use ([\d,]+) (Xanax|Vicodin|Speed|Shrooms|PCP|Opium|LSD|Ketamine|Ecstasy|Cannabis)$/, m => { const k = DRUG[m[2].toLowerCase()]; return stat('drugs.' + k, m, DRUG_CD[k] ? { e: { m: 'cooldown', min: DRUG_CD[k] } } : null); });
// training and working stats
add(/^Attain ([\d,]+) total stats$/, m => stat('battle_stats.total', m));
add(/^Gain ([\d,]+) (strength|speed|dexterity|defense)$/, m => stat('battle_stats.' + m[2], m));
add(/^Attain ([\d,]+) (endurance|intelligence|manual labor)$/, m => stat('jobs.stats.' + (m[2] === 'manual labor' ? 'manual' : m[2]), m));
add(/^Achieve ([\d,]+) in any working stat$/, m => ({ p: null, s: 'jobs.stats.max', g: num(m[1]) }));
add(/^Use ([\d,]+) job points$/, m => stat('jobs.job_points_used', m));
// crimes: the newer "offenses" and the older "crimes"
add(/^Commit (?:a total of )?([\d,]+) criminal offenses$/, m => stat('crimes.offenses.total', m));
add(/^Commit ([\d,]+) (Vandalism|Theft|Illicit Service|Illegal Production|Fraud|Extortion|Cybercrime|Counterfeiting) offenses$/, m => stat('crimes.offenses.' + OFFENSE[m[2].toLowerCase()], m));
add(/^Commit ([\d,]+) (Grand theft auto|Fraud|Computer|Theft|Murder|Drug dealing) crimes$/, m => stat('crimes.' + OLDCRIME[m[2].toLowerCase()], m));
add(/^Achieve ([\d,]+) (theft|computer|murder|drug dealing|bootlegging|auto theft|other|arson\/fraud) crimes$/, m => stat('crimes.' + OLDCRIME[m[2]], m));
add(/^Participate in ([\d,]+) organized crimes$/, m => stat('crimes.organized_crimes', m));
add(/^Achieve a skill level of ([\d,]+) in (.+)$/, m => SKILL[m[2].toLowerCase()] ? stat('crimes.skills.' + SKILL[m[2].toLowerCase()], m) : null);
add(/^Achieve ([\d,]+) skill in hunting$/, m => stat('travel.hunting.skill', m));
// travel
add(/^Travel(?: abroad)? ([\d,]+) times$/, m => stat('travel.total', m));
add(/^Travel to (?:the )?(.+) ([\d,]+) times$/, m => COUNTRY[m[1].toLowerCase()] ? { s: 'travel.' + COUNTRY[m[1].toLowerCase()], g: num(m[2]) } : null);
add(/^Spend ([\d,]+) days in the air$/, m => stat('travel.time_spent', m, { d: 86400, e: CAL }));
add(/^Import ([\d,]+) items from abroad$/, m => stat('travel.items_bought', m));
add(/^Defeat ([\d,]+) people while abroad$/, m => stat('travel.attacks_won', m));
// items
add(/^Find ([\d,]+) items in the city$/, m => stat('items.found.city', m));
add(/^Find ([\d,]+) items in the dump$/, m => stat('items.found.dump', m));
add(/^Find and collect ([\d,]+) Easter eggs$/, m => stat('items.found.easter_eggs', m));
add(/^Trash ([\d,]+) items$/, m => stat('items.trashed', m));
add(/^Read ([\d,]+) books$/, m => stat('items.used.books', m));
add(/^Eat ([\d,]+) bags of candy$/, m => stat('items.used.candy', m));
add(/^Drink ([\d,]+) cans of energy drink$/, m => stat('items.used.energy_drinks', m));
add(/^Drink ([\d,]+) bottles of alcohol$/, m => stat('items.used.alcohol', m));
add(/^Code ([\d,]+) viruses$/, m => stat('items.viruses_coded', m));
add(/^Refill your energy bar ([\d,]+) times$/, m => stat('other.refills.energy', m, { e: CAL }));
add(/^Refill your nerve bar ([\d,]+) times$/, m => stat('other.refills.nerve', m, { e: CAL }));
add(/^Refill your casino tokens ([\d,]+) times$/, m => stat('other.refills.token', m, { e: CAL }));
// money, trading
add(/^Win ([\d,]+) auctions$/, m => stat('trading.items.auctions.won', m));
add(/^Have ([\d,]+) customers buy from your bazaar$/, m => stat('trading.bazaar.customers', m));
add(/^Sell ([\d,]+) points on the market$/, m => stat('trading.points.sold', m));
add(/^Achieve \$?([\d,]+) in total profits in the stock market$/, m => stat('investments.stocks.profits', m));
add(/^Achieve \$?([\d,]+) in total losses in the stock market$/, m => stat('investments.stocks.losses', m));
add(/^Receive ([\d,]+) stock payouts\s*$/, m => stat('investments.stocks.payouts', m));
// racing, missions
add(/^Win ([\d,]+) races$/, m => stat('racing.races.won', m));
add(/^Earn ([\d,]+) racing points$/, m => stat('racing.points', m));
add(/^Reach a racing skill of ([\d,]+)$/, m => stat('racing.skill', m));
add(/^Complete ([\d,]+) contracts$/, m => stat('missions.contracts.total', m));
add(/^Earn ([\d,]+) mission credits$/, m => stat('missions.credits', m));
// level, age, time
add(/^Reach level (.+)$/, m => words(m[1]) ? { s: 'lvl', g: words(m[1]) } : null);
add(/^Live in Torn for (\w+) years?$/, m => YEARS[m[1].toLowerCase()] ? { s: 'age', g: YEARS[m[1].toLowerCase()] * 365, e: CAL } : null);
add(/^Stay married(?: to a single person)? for ([\d,]+) days(?: without divorce)?$/, m => stat('mar', m, { e: CAL }));
add(/^Serve ([\d,]+) days in a single faction$/, m => stat('fac', m, { e: CAL }));
add(/^Be a donator for ([\d,]+) days$/, m => stat('other.donator_days', m, { e: CAL }));
add(/^Be online every day for ([\d,]+) days$/, m => stat('other.activity.streak.best', m, { e: CAL }));
add(/^Achieve ([\d,]+) hours of activity on Torn$/, m => stat('other.activity.time', m, { d: 3600 }));
add(/^Achieve ([\d,]+) total awards$/, m => stat('awd', m));
add(/^Complete ([\d,]+) education courses$/, m => stat('edu', m));
add(/^Reach the rank of (.+)$/, m => RANKS.indexOf(m[1].toLowerCase()) > 0 ? { s: 'rank', g: RANKS.indexOf(m[1].toLowerCase()) } : null);

// the rule of one award, or null when it cannot be measured
function ruleFor(item) {
    if (!item || item.t === 'merit') return null;
    const d = String(item.d || '').trim();
    for (const [re, f] of rules) {
        const m = re.exec(d);
        if (!m) continue;
        const r = f ? f(m) : null;
        if (r && (r.s || r.p) && (r.g || r.p)) return r;
        return null;
    }
    return null;
}
module.exports = { ruleFor, RANKS };
