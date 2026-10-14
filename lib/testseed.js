// lib/testseed.js — sample data for the TEST site only (a Vercel preview with its own test database). The owner presses "Fill test data" in the orange bar and the database gets a test investor
// and a test tenant, so the "Use as" switcher has someone to log in as and the investor's / tenant's own pages have something to show. It refuses to run anywhere but a preview, and it only ever
// adds or replaces the rows of these test people (by their test player id), never anything else.
//   9000001 Test Investor: two lines in the fund (a weekly one with payments and a monthly one that is newer)
//   9000002 Test Tenant:   one 2600 Happy rent-to-own contract, two lease payments in
//   9000004 Test Buddy:    one buddy banking plan (Bronze, 500m, 30 days, given 12 days ago)

const { isPreview } = require('./env');

const PERSONAS = [{ key: 'investor', id: '9000001', name: 'Test Investor' }, { key: 'tenant', id: '9000002', name: 'Test Tenant' }, { key: 'buddy', id: '9000004', name: 'Test Buddy' }];
const FIN = 'wwl:finances', LT = 'wwl:labstracking';

const todayIso = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const lastSunday = iso => { const d = new Date(`${iso}T00:00:00Z`); return addDays(iso, -d.getUTCDay()); };

async function seed(redis) {
    if (!isPreview()) throw new Error('Test data can only be added on the test site.');
    const today = todayIso(), sun = lastSunday(today);

    const fin = JSON.parse((await redis(['GET', FIN])) || '{}');
    const start1 = addDays(sun, -7 * 10), start2 = addDays(sun, -7 * 3);
    const pay = (start, n, amount) => Array.from({ length: n }, (_, k) => ({ date: addDays(start, 7 * (k + 1)), amount, through: addDays(start, 7 * (k + 1)) }));
    const lines = [
        { id: 'tstinv1', name: 'Test Investor', tornId: '9000001', amount: 500000000, payout: null, mode: 'weekly', start: start1, active: true, fundId: '', note: 'test data', payments: pay(start1, 10, 3125000), termEnd: addDays(start1, 180) },
        { id: 'tstinv2', name: 'Test Investor', tornId: '9000001', amount: 250000000, payout: null, mode: 'weekly', start: start2, active: true, fundId: '', note: 'test data', payments: [], termEnd: addDays(start2, 180) },
    ];
    fin.investors = (Array.isArray(fin.investors) ? fin.investors : []).filter(i => String(i.tornId) !== '9000001').concat(lines);
    fin.buddies = (Array.isArray(fin.buddies) ? fin.buddies : []).filter(b => String(b.tornId) !== '9000004').concat([{ id: 'tstbud1', name: 'Test Buddy', tornId: '9000004', tier: 'bronze', amount: 500000000, term: 30, given: addDays(today, -12), profit: 0, share: 70, status: 'active', note: 'test data', returnedOn: '' }]);
    await redis(['SET', FIN, JSON.stringify(fin)]);

    const lt = JSON.parse((await redis(['GET', LT])) || '{}');
    const tStart = addDays(today, -45);
    const item = {
        id: 'rto_test1', clientName: 'Test Tenant', tierName: '2600 Happy PI', originalHappy: 2600, propertyId: null, tenantId: '9000002', startDate: tStart,
        cycleEquity: 36000000, monthlyRent: 12000000, totalEquityNeeded: 612000000, manualEquityPaid: null, opening: 0, offeredOn: null,
        payments: [{ id: 'ptest1', date: tStart, rent: 12000000, equity: 36000000 }, { id: 'ptest2', date: addDays(tStart, 30), rent: 12000000, equity: 36000000 }],
    };
    lt.rtoItems = (Array.isArray(lt.rtoItems) ? lt.rtoItems : []).filter(r => String(r.tenantId) !== '9000002').concat([item]);
    await redis(['SET', LT, JSON.stringify(lt)]);
    return { ok: true, personas: PERSONAS };
}

module.exports = { seed, PERSONAS };
