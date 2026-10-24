// award-calc.js — how far an award is and how long it takes, from a member's own stats. One piece of code for the Awards page (awards.js, in the browser) and for the server
// (lib/awards.js: the awards a member follows in the script's To do), so both always say the same.
//
//   awardCalc(item, stats, { income, air })
//     item    an award of the catalog with its rule (item.rl, see lib/awardRules.js)
//     stats   the member's numbers ({ 'attacking.attacks.won': 5672, age: 2113, ... }, from the aw-progress action)
//     income  energy gained per day (720 natural, 870 with the daily refill, ...)
//     air     true when the member owns an airstrip (flights are 30% shorter)
//   gives { cur, goal, pct (0..1), left (days; Infinity when nothing has happened yet; null when there is no estimate), how (the explanation of the time) }, or null when it cannot be measured
(function (root) {
    'use strict';
    const fmt = n => Number.isFinite(n) ? (Math.abs(n) >= 100 || Number.isInteger(n) ? Math.round(n) : Math.round(n * 10) / 10).toLocaleString('en-US') : '';
    function awardCalc(i, stats, opt) {
        const rl = i && i.rl;
        if (!rl || !stats) return null;
        const parts = rl.p || [[rl.s, rl.g]], d = rl.d || 1, inc = (opt && opt.income) || 870, air = !!(opt && opt.air);
        let remaining = 0, cur = 0, goal = 0;
        for (const [s, g] of parts) {
            const raw = stats[s];
            if (typeof raw !== 'number') return null;
            const v = Math.min(raw / d, parts.length > 1 ? g : Infinity); // with several goals, what is beyond a goal does not count for the others
            cur += v; goal += g; remaining += Math.max(0, g - v);
        }
        const pct = Math.min(1, cur / goal);
        if (remaining <= 0) return { cur, goal, pct: 1, left: 0, how: '' };
        let left = null, how = '';
        const e = rl.e, f = fmt;
        const days = (perDay, text) => { left = perDay > 0 ? remaining / perDay : Infinity; how = perDay > 0 ? `${f(remaining)} to go. ${text}` : `${f(remaining)} to go, but this has not happened at all yet, so there is nothing to base a time on.`; };
        if (e && e.m === 'energy') days(inc / e.per, `${e.per} energy each, ${f(inc)} energy a day = ${f(inc / e.per)} a day (every action counted as a success).`);
        else if (e && e.m === 'nerve') days(288 / e.per, `${e.per} nerve each, 288 nerve a day (1 per 5 minutes) = ${f(288 / e.per)} a day.`);
        else if (e && e.m === 'fixed') days(e.perDay, `About ${f(e.perDay)} a day.`);
        else if (e && e.m === 'flight') { const trip = 2 * e.min * (air ? 0.7 : 1); days(1440 / trip, `A round trip takes ${f(trip)} minutes${air ? ' (30% shorter, because you own an airstrip)' : ''}, back to back = ${f(1440 / trip)} a day.`); }
        else if (e && e.m === 'cooldown') days(1440 / e.min, `One every ${e.min} minutes (the cooldown) = ${f(1440 / e.min)} a day.`);
        else if (e && e.m === 'calendar') { left = remaining; how = `${f(remaining)} days have to pass.`; }
        else if (e && e.m === 'rate') { const age = stats.age; if (age > 0) days(cur / age, `At your pace over the ${f(age)} days since you joined (${Math.round(cur / age * 100) / 100} a day).`); }
        else if (e && e.m === 'share') {
            const base = stats[e.base];
            if (base > 0) days(cur / base * (inc / e.per) * e.mult, `Of what you did so far this grows in step with ${e.base.endsWith('won') ? 'the attacks you win' : 'the rounds you fire'}, and you can do ${f(inc / e.per)} of those a day.`);
        }
        return { cur, goal, pct, left, how };
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = { awardCalc };
    else root.awardCalc = awardCalc;
})(typeof self !== 'undefined' ? self : this);
