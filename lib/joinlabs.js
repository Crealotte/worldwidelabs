// lib/joinlabs.js — "Labs services": people who have nothing with Labs yet (they only need a Torn key, even a profile-only one) see the three programs (investment fund, rent-to-own, buddy banking) and can ask to join
// one. A request carries what they picked and the date they accepted that program's terms. The owner sees the open requests (Join requests page, To do, menu badge) and approves or declines; for the fund,
// "Money received" turns the request into a deposit (lib/finances.js addInvestorLine).
//
//   wwl:joinreqs -> JSON { reqs: [{ id, tornId, name, program: 'invest' | 'rent' | 'buddy', details, termsOn, termsV, createdOn, status: 'open' | 'approved' | 'declined', resolvedOn, note }] }
//
// Limits against spam: one open request per program per person, at most 4 open per person, the list keeps the last 300.

const { loadFinances, addInvestorLine, addBuddyLine } = require('./finances');

const KEY = 'wwl:joinreqs';
const TERMS_V = { invest: '2026-10-14', rent: '2026-10-09', buddy: '2026-10-14', trading: '2026-10-20' }; // the versions shown in terms.js
const RENT = { 2600: { price: 612000000, rent: 12000000, equity: 36000000 }, 3600: { price: 855000000, rent: 15000000, equity: 45000000 }, 4100: { price: 1701000000, rent: 27000000, equity: 81000000 } };
const BUDDY = { amount: 500000000, days: 30 };

const todayIso = () => new Date().toISOString().slice(0, 10);
const id6 = () => Math.random().toString(36).slice(2, 8);
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const money = n => `$${Math.round(n).toLocaleString('en-US')}`;
// the steps money is added in (the terms): by the tier the amount is in
const stepOf = a => (a < 250000000 ? 25000000 : a < 500000000 ? 50000000 : a < 1000000000 ? 100000000 : 250000000);

async function load(redis) {
    try { const raw = await redis(['GET', KEY]); const d = raw ? JSON.parse(raw) : {}; return { reqs: Array.isArray(d.reqs) ? d.reqs : [] }; } catch (e) { return { reqs: [] }; }
}
const save = (redis, d) => redis(['SET', KEY, JSON.stringify({ reqs: d.reqs.slice(-300) })]);

// the owner's pay table (what the fund pays per tier), for the preview on the page
async function roiTable(redis) {
    try { return (await loadFinances(redis)).roi; } catch (e) { return []; }
}

async function joinHandle(action, body, { redis, who, owner }) {
    const today = todayIso();
    if (action === 'join-info') { // what a person sees: the programs and their own requests
        const d = await load(redis);
        return { name: who.name, today, roi: await roiTable(redis), rent: RENT, buddy: BUDDY, terms: TERMS_V, mine: d.reqs.filter(r => String(r.tornId) === String(who.playerId)).slice(-20) };
    }
    if (action === 'join-request') {
        const program = ['invest', 'rent', 'buddy', 'trading'].includes(body.program) ? body.program : '';
        if (!program) throw new Error('Pick one of the programs.');
        if (body.accept !== true) throw new Error('Read the terms of this program and tick that you accept them.');
        const d = await load(redis), mine = d.reqs.filter(r => String(r.tornId) === String(who.playerId) && r.status === 'open');
        if (mine.some(r => r.program === program)) throw new Error('You already have a request for this program waiting.');
        if (mine.length >= 4) throw new Error('You have several requests waiting already: wait for an answer first.');
        let details = {};
        if (program === 'invest') {
            const amount = Math.round(Number(body.amount) || 0), step = stepOf(amount);
            if (amount < 100000000) throw new Error('The smallest investment is $100,000,000 (the Copper tier).');
            if (amount > 50000000000) throw new Error('Talk to the fund owner about amounts this big.');
            if (amount % step) throw new Error(`At this level the amount goes in steps of ${step / 1000000}m (for example ${money(Math.ceil(amount / step) * step)}).`);
            details = { amount, mode: body.mode === 'weekly' ? 'weekly' : 'monthly' };
        } else if (program === 'rent') {
            const happy = Number(body.happy);
            if (!RENT[happy]) throw new Error('Pick one of the island types: 2600, 3600 or 4100.');
            details = { happy };
        } else if (program === 'trading') { // a request for a Trading Funding: the owner decides, and only grants it to people she trusts or who are vouched for
            const amount = Math.round(Number(body.amount) || 0);
            if (amount < 50000000) throw new Error('Type the amount you would like, from $50,000,000.');
            if (amount > 50000000000) throw new Error('Talk to the owner about amounts this big.');
            details = { amount, plan: str(body.plan, 300), voucher: str(body.voucher, 80), experience: str(body.experience, 300) };
            if (!details.plan) throw new Error('Tell what you would trade (items, markets, where your profit comes from).');
        } else details = { tier: 'bronze', amount: BUDDY.amount, days: BUDDY.days };
        d.reqs.push({ id: id6(), tornId: String(who.playerId), name: str(who.name, 60), program, details, termsOn: today, termsV: TERMS_V[program], createdOn: today, status: 'open', resolvedOn: '', note: '' });
        await save(redis, d);
        return { ok: true };
    }
    if (action === 'join-cancel') {
        const d = await load(redis), r = d.reqs.find(x => x.id === body.id && String(x.tornId) === String(who.playerId));
        if (!r || r.status !== 'open') throw new Error('That request can not be withdrawn.');
        d.reqs = d.reqs.filter(x => x.id !== r.id);
        await save(redis, d);
        return { ok: true };
    }
    if (!owner) throw new Error('Owner only.');
    if (action === 'join-list') return { reqs: (await load(redis)).reqs.slice().reverse(), today, rent: RENT };
    if (action === 'join-resolve') {
        const d = await load(redis), r = d.reqs.find(x => x.id === body.id);
        const decision = ['approve', 'decline', 'received', 'sent'].includes(body.decision) ? body.decision : '';
        if (!decision) throw new Error('Unknown decision.');
        // buddy banking has two steps, like the fund: Approve (they may be taken), then Money sent (you really gave them the cash): only then the buddy is a line on the Buddy banking page
        if (decision === 'sent') {
            if (!r || r.program !== 'buddy' || r.status !== 'approved') throw new Error('Money sent only fits an approved buddy banking request.');
            await addBuddyLine(redis, { tornId: r.tornId, name: r.name, tier: r.details && r.details.tier, amount: (r.details && r.details.amount) || BUDDY.amount, days: (r.details && r.details.days) || BUDDY.days });
            r.status = 'sent'; r.sentOn = today; await save(redis, d);
            return { ok: true };
        }
        if (!r || r.status !== 'open') throw new Error('That request is no longer open.');
        if (decision === 'received') {
            if (r.program !== 'invest') throw new Error('Money received only fits an investment request.');
            await addInvestorLine(redis, { tornId: r.tornId, name: r.name, amount: r.details.amount, mode: r.details.mode });
        }
        r.status = decision === 'decline' ? 'declined' : 'approved'; r.resolvedOn = today; r.note = str(body.note, 160);
        await save(redis, d);
        return { ok: true };
    }
    if (action === 'join-buddy-withdraw') { // an approved buddy request that will not go ahead (they still have a bank investment, they changed their mind): back to declined, no line
        const d = await load(redis), r = d.reqs.find(x => x.id === body.id);
        if (!r || r.program !== 'buddy' || r.status !== 'approved') throw new Error('That request is not waiting for money.');
        r.status = 'declined'; r.resolvedOn = today; r.note = str(body.note, 160) || 'not going ahead'; await save(redis, d);
        return { ok: true };
    }
    if (action === 'join-buddy-bank') { // the day a City Bank investment of a waiting buddy ends (typed in by the owner; WWL cannot see another player's bank). Empty = nothing running as far as she knows
        const d = await load(redis), r = d.reqs.find(x => x.id === body.id);
        if (!r || r.program !== 'buddy' || (r.status !== 'approved' && r.status !== 'open')) throw new Error('That request is not waiting.');
        const day = String(body.date || '').trim();
        if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Pick a date.');
        r.bankEnd = day; await save(redis, d);
        return { ok: true };
    }
    throw new Error('Unknown action');
}

// the owner's To do: one line for the requests that wait
async function joinTodos(redis) {
    const open = (await load(redis)).reqs.filter(r => r.status === 'open');
    if (!open.length) return [];
    const what = r => (r.program === 'invest' ? `investment ${money(r.details.amount)}` : r.program === 'rent' ? `rent-to-own ${r.details.happy}` : r.program === 'trading' ? `trading funding ${money(r.details.amount)}` : 'buddy banking');
    return [{ id: 'join-requests', svc: true, n: open.length, text: `${open.length} request${open.length === 1 ? '' : 's'} to join Labs: ${open.slice(0, 4).map(r => `${r.name} (${what(r)})`).join('; ')}${open.length > 4 ? ` and ${open.length - 4} more` : ''}`, cta: 'Open Join requests', page: 'join-requests', anchor: '' }];
}

module.exports = { joinHandle, joinTodos };
