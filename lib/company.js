// lib/company.js — the company side of WWL for the owner's companies: the owner registers a company (by its Torn ID; the director is whoever Torn says
// runs it), and that director can log in to WWL and sees ONLY their company: income, customers, employees (position, wage, stats, last seen), stock,
// history and payslip, and the standing Investment amount the owner keeps for them. Nothing else of WWL is open to a director (see lib/access.js and the
// director gate in api/war-payout.js). Live data comes from the director's own API key; the history and the Discord reports (lib/companyReports.js) need a
// key kept for the daily job: the director can switch that on, or the owner saves the director's key on the Companies page.
//
// Investment amount: money the owner owes this director (for an investment the director made through the owner's fund). Instead of two transfers, the
// director sends the owner the weekly amount MINUS this figure. It is a standing field: it stays until the owner changes it or sets it to 0.
//
//   wwl:companies  -> hash: companyId -> JSON { id, name, type, directorId, directorName, ownerName, cutPct, investment, invNote, invLog, at }
//   wwl:directors  -> hash: directorPlayerId -> JSON [companyId, ...]
//   wwl:discord-settings:c{companyId} -> the company's own Discord destination, in the same shape as a faction's

const R = require('./companyReports');

const COMPANIES = 'wwl:companies';
const DIRECTORS = 'wwl:directors';
const WEBHOOK_RE = /^https:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;
const discordKey = id => `wwl:discord-settings:c${id}`;
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

async function getAll(redis) {
    const flat = (await redis(['HGETALL', COMPANIES])) || [];
    const out = [];
    for (let i = 0; i < flat.length; i += 2) { try { out.push(JSON.parse(flat[i + 1])); } catch (e) { /* skip */ } }
    return out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}
async function getOne(redis, id) {
    const raw = await redis(['HGET', COMPANIES, String(id)]);
    try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
const publicView = c => ({ id: c.id, name: c.name, type: c.type || '', directorId: c.directorId, directorName: c.directorName || '', cutPct: c.cutPct ?? 30, investment: c.investment || 0, invNote: c.invNote || '', invLog: (c.invLog || []).slice(-10).reverse() });

// The companies a player directs (empty for anyone who is not a registered director).
async function companiesOf(redis, playerId) {
    const raw = await redis(['HGET', DIRECTORS, String(playerId)]);
    let ids = []; try { ids = raw ? JSON.parse(raw) : []; } catch (e) { ids = []; }
    if (!ids.length) return [];
    const rows = await redis(['HMGET', COMPANIES, ...ids]);
    return rows.map(r => { try { return r ? JSON.parse(r) : null; } catch (e) { return null; } }).filter(Boolean);
}
async function isDirector(redis, playerId) { return (await companiesOf(redis, playerId)).length > 0; }

// Torn's company answer, read live with a director's key (never cached: the numbers must be current).
async function tornCompany(key, id) {
    const url = `https://api.torn.com/company/${id ? encodeURIComponent(id) : ''}?selections=profile,employees,stock,detailed&key=${encodeURIComponent(key)}`;
    const r = await fetch(url);
    const d = await r.json();
    if (d.error) throw new Error(d.error.error || `Torn error ${d.error.code}`);
    return d;
}

// One plain shape out of Torn's answer, tolerant of the field names (the exact names are confirmed against a real director's answer with "raw answer").
function normalize(raw) {
    const p = raw.company || {};
    const det = raw.company_detailed || raw.detailed || {};
    const empRaw = raw.company_employees || p.employees || {};
    const stockRaw = raw.company_stock || raw.stock || {};
    const employees = Object.entries(empRaw).map(([id, e]) => {
        const eff = e.effectiveness || {};
        return {
            id, name: e.name || `#${id}`, position: e.position || '', days: num(e.days_in_company), wage: num(e.wage),
            manual: num(e.manual_labor), intelligence: num(e.intelligence), endurance: num(e.endurance),
            effectiveness: num(eff.total ?? e.effectiveness_total ?? (typeof e.effectiveness === 'number' ? e.effectiveness : null)),
            addiction: num(eff.addiction), lastTs: num(e.last_action?.timestamp), lastRel: e.last_action?.relative || '', status: e.last_action?.status || '',
        };
    }).sort((a, b) => (a.position || '').localeCompare(b.position || '') || a.name.localeCompare(b.name));
    const stock = Object.entries(stockRaw).map(([name, s]) => ({ name, inStock: num(s.in_stock), onOrder: num(s.on_order), sold: num(s.sold_amount), soldWorth: num(s.sold_worth), price: num(s.price), cost: num(s.cost), rrp: num(s.rrp) }));
    const now = Math.floor(Date.now() / 1000);
    const idle = e => (e.lastTs ? now - e.lastTs : null);
    return {
        name: p.name || '', type: p.company_type ?? p.type ?? '', rating: num(p.rating), daysOld: num(p.days_old),
        dailyIncome: num(p.daily_income), weeklyIncome: num(p.weekly_income), dailyCustomers: num(p.daily_customers), weeklyCustomers: num(p.weekly_customers),
        hired: num(p.employees_hired), capacity: num(p.employees_capacity),
        funds: num(det.company_funds), bank: num(det.company_bank), popularity: num(det.popularity), efficiency: num(det.efficiency), environment: num(det.environment),
        advertising: num(det.advertising_budget), trains: num(det.trains),
        wagesPerDay: employees.reduce((s, e) => s + (e.wage || 0), 0),
        employees, stock,
        inactive: {
            day: employees.filter(e => idle(e) != null && idle(e) >= 86400 && idle(e) < 172800).map(e => ({ name: e.name, rel: e.lastRel })),
            long: employees.filter(e => idle(e) != null && idle(e) >= 172800).map(e => ({ name: e.name, rel: e.lastRel })),
        },
    };
}

// the key that reads a company's live data: the director's own when they ask, otherwise the one the owner/director saved for the daily job
async function keyFor(redis, co, playerId, requestKey) {
    if (String(co.directorId) === String(playerId)) return requestKey;
    const raw = await redis(['HGET', R.VAULT, String(co.id)]);
    if (!raw) return null;
    try { return R.decrypt(JSON.parse(raw).enc); } catch (e) { return null; }
}
const vaultInfo = async (redis, id) => { const raw = await redis(['HGET', R.VAULT, String(id)]); if (!raw) return { on: false }; const e = JSON.parse(raw); return { on: true, by: e.name, since: e.since, lastRun: e.lastRun || null, lastOk: e.lastOk ?? null, lastError: e.lastError || null, lastPosted: e.lastPosted || null }; };
const nextSunday = iso => { let d = iso; for (let i = 0; i < 7 && !R.isSunday(d); i++) d = R.addDays(d, 1); return d; };

async function companyHandle(action, body, { redis, key, playerId, playerName, owner, getPoster }) {
    // ---- the owner's side ----
    if (action === 'co-list') {
        if (!owner) throw new Error('Owners only');
        const list = await getAll(redis);
        const out = [];
        for (const c of list) {
            const raw = await redis(['GET', discordKey(c.id)]);
            let dc = {}; try { dc = raw ? JSON.parse(raw).channels?.default || {} : {}; } catch (e) { dc = {}; }
            out.push({ ...publicView(c), discord: { channelId: dc.channelId || '', webhookSet: !!dc.webhookUrl, webhookHint: dc.webhookUrl ? `webhook …${(dc.webhookUrl.match(/\/webhooks\/(\d+)\//) || [])[1]?.slice(-6) || ''}` : '' }, saving: await vaultInfo(redis, c.id) });
        }
        return { companies: out };
    }
    if (action === 'co-save') { // register a company by its Torn ID: Torn says what it is called and who directs it
        if (!owner) throw new Error('Owners only');
        const id = String(body.companyId || '').replace(/\D/g, '');
        if (!/^\d{1,9}$/.test(id)) throw new Error('Enter the company ID (a number).');
        const r = await fetch(`https://api.torn.com/company/${id}?selections=profile&key=${encodeURIComponent(key)}`);
        const d = await r.json();
        if (d.error) throw new Error(`Torn: ${d.error.error || d.error.code}`);
        const p = d.company || {};
        if (!p.name || !p.director) throw new Error('Torn did not give a name and director for that company ID.');
        const old = await getOne(redis, id);
        let directorName = old?.directorName || '';
        if (!directorName || String(old?.directorId) !== String(p.director)) { try { const u = await (await fetch(`https://api.torn.com/user/${p.director}?selections=basic&key=${encodeURIComponent(key)}`)).json(); directorName = u.name || ''; } catch (e) { /* no name */ } }
        const co = { ...(old || { investment: 0, invNote: '', invLog: [], at: Date.now() }), id, name: p.name, type: p.company_type ?? '', directorId: String(p.director), directorName, ownerName: playerName, cutPct: Math.max(0, Math.min(100, num(body.cutPct) ?? old?.cutPct ?? 30)) };
        if (old && String(old.directorId) !== co.directorId) await removeFromDirector(redis, old.directorId, id); // the company has a new director
        await redis(['HSET', COMPANIES, id, JSON.stringify(co)]);
        await addToDirector(redis, co.directorId, id);
        return { ok: true, company: publicView(co) };
    }
    if (action === 'co-remove') {
        if (!owner) throw new Error('Owners only');
        const id = String(body.companyId || '').replace(/\D/g, '');
        const co = await getOne(redis, id);
        if (co) await removeFromDirector(redis, co.directorId, id);
        await redis(['HDEL', COMPANIES, id]);
        await redis(['HDEL', R.VAULT, id]);
        return { ok: true };
    }
    if (action === 'co-invest') { // the standing Investment amount: set it, or add to / take from it; 0 = nothing to settle
        if (!owner) throw new Error('Owners only');
        const id = String(body.companyId || '').replace(/\D/g, '');
        const co = await getOne(redis, id);
        if (!co) throw new Error('Unknown company.');
        const amount = Math.round(num(String(body.amount ?? '').replace(/[,\s$]/g, '')) ?? NaN);
        if (!Number.isFinite(amount) || amount < 0) throw new Error('Enter an amount of 0 or more.');
        const before = co.investment || 0;
        const after = body.mode === 'add' ? before + amount : body.mode === 'take' ? Math.max(0, before - amount) : amount;
        co.investment = after;
        co.invNote = typeof body.note === 'string' ? body.note.trim().slice(0, 120) : (co.invNote || '');
        co.invLog = [...(co.invLog || []), { t: Date.now(), by: playerName, delta: after - before, after, note: co.invNote }].slice(-50);
        await redis(['HSET', COMPANIES, id, JSON.stringify(co)]);
        return { ok: true, company: publicView(co) };
    }
    // the company's own Discord channel: where its daily and weekly reports go
    if (action === 'co-discord-set') {
        if (!owner) throw new Error('Owners only');
        const id = String(body.companyId || '').replace(/\D/g, '');
        if (!(await getOne(redis, id))) throw new Error('Unknown company.');
        const raw = await redis(['GET', discordKey(id)]);
        const all = raw ? JSON.parse(raw) : {};
        all.channels = all.channels || {};
        const s = { ...(all.channels.default || {}) };
        if (body.clearWebhook) delete s.webhookUrl;
        if (typeof body.webhookUrl === 'string' && body.webhookUrl.trim()) {
            if (!WEBHOOK_RE.test(body.webhookUrl.trim())) throw new Error('That does not look like a Discord webhook URL (it should start with https://discord.com/api/webhooks/).');
            s.webhookUrl = body.webhookUrl.trim();
        }
        if (typeof body.channelId === 'string') {
            if (body.channelId.trim() && !/^\d{15,25}$/.test(body.channelId.trim())) throw new Error('A channel ID is just a long number: right-click the channel in Discord (Developer Mode on) and Copy Channel ID.');
            if (body.channelId.trim()) { s.channelId = body.channelId.trim(); s.ownerSet = true; } else { delete s.channelId; delete s.ownerSet; }
        }
        all.channels.default = s;
        await redis(['SET', discordKey(id), JSON.stringify(all)]);
        return { ok: true };
    }
    if (action === 'co-discord-test') {
        if (!owner) throw new Error('Owners only');
        const id = String(body.companyId || '').replace(/\D/g, '');
        const co = await getOne(redis, id);
        const poster = co && await getPoster(id);
        if (!poster) throw new Error('Nothing saved yet: add a channel ID or a webhook first.');
        if (poster.error) throw new Error(poster.error);
        const r = await poster.post(`✅ WWLabs is connected: the daily and weekly reports for ${co.name} will post here.`, []);
        if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`Discord rejected the test (${r.status})${t ? `: ${t.slice(0, 120)}` : ''}. Check the bot can see and post in that channel.`); }
        return { ok: true };
    }
    // the key for the daily job: the owner saves the director's key (checked to belong to that company), or the director switches it on themselves
    if (action === 'co-key-set') {
        if (!owner) throw new Error('Owners only');
        const id = String(body.companyId || '').replace(/\D/g, '');
        const co = await getOne(redis, id);
        if (!co) throw new Error('Unknown company.');
        const k = String(body.companyKey || '').trim();
        if (!/^[A-Za-z0-9]{16}$/.test(k)) throw new Error('A Torn API key is 16 letters and numbers.');
        const raw = await tornCompany(k); // throws with Torn's own message when the key cannot read a company
        const got = raw.company?.ID ?? raw.company?.id;
        if ((got != null && String(got) !== id) || (got == null && raw.company?.name && raw.company.name !== co.name)) throw new Error('That key belongs to a different company.');
        const now = Math.floor(Date.now() / 1000);
        await redis(['HSET', R.VAULT, id, JSON.stringify({ enc: R.encrypt(k), playerId: co.directorId, name: `saved by ${playerName}`, since: now })]);
        return { ok: true, saving: await vaultInfo(redis, id) };
    }
    if (action === 'co-key-remove') {
        if (!owner) throw new Error('Owners only');
        await redis(['HDEL', R.VAULT, String(body.companyId || '').replace(/\D/g, '')]);
        return { ok: true };
    }
    if (action === 'co-report-now') { // posts today's daily report (and the weekly one on a Sunday) right away, to test the channel
        if (!owner) throw new Error('Owners only');
        const id = String(body.companyId || '').replace(/\D/g, '');
        const res = await R.runCompanyReports({ redis, tornCompany, normalize, getAllCompanies: () => getAll(redis), getPoster, force: true, onlyId: id });
        if (!res.length) throw new Error('Save a key for this company first: the report needs it.');
        return { results: res };
    }

    // ---- the director's side (the owner too, through the saved key) ----
    const mine = await companiesOf(redis, playerId);
    const pick = async () => {
        if (owner && body.companyId) return await getOne(redis, String(body.companyId).replace(/\D/g, ''));
        return mine.find(c => String(c.id) === String(body.companyId)) || mine[0] || null;
    };
    if (action === 'co-daily') { // a director switches the daily saving (and with it the Discord reports) on or off for their own company
        const co = mine.find(c => String(c.id) === String(body.companyId)) || mine[0];
        if (!co) throw new Error('You are not registered as a director of a company.');
        if (body.on) {
            await tornCompany(key); // proves the key can read the company
            await redis(['HSET', R.VAULT, String(co.id), JSON.stringify({ enc: R.encrypt(key), playerId, name: playerName, since: Math.floor(Date.now() / 1000) })]);
        } else await redis(['HDEL', R.VAULT, String(co.id)]);
        return { ok: true, saving: await vaultInfo(redis, co.id) };
    }
    if (action === 'co-my' || action === 'co-raw') {
        const co = await pick();
        if (!co) throw new Error('You are not registered as a director of a company.');
        const k = await keyFor(redis, co, playerId, key);
        if (!k) throw new Error('There is no key saved for this company yet: save the director\'s key on the Companies page.');
        const raw = await tornCompany(k);
        if (action === 'co-raw') return { raw: JSON.stringify(raw).slice(0, 8000) };
        return { companies: (owner && body.companyId ? [co] : mine).map(c => ({ id: c.id, name: c.name })), company: publicView(co), data: normalize(raw), saving: await vaultInfo(redis, co.id), isDirector: String(co.directorId) === String(playerId) };
    }
    if (action === 'co-history') { // the saved days (a history like TornStats), and the payslip of the running week and the last weeks
        const co = await pick();
        if (!co) throw new Error('You are not registered as a director of a company.');
        const days = await R.loadDays(redis, co.id);
        const dates = Object.keys(days).sort();
        const today = R.tctDate(Math.floor(Date.now() / 1000));
        const thisEnd = nextSunday(today);
        const weeks = [0, 1, 2, 3].map(i => { const end = R.addDays(thisEnd, -7 * i); return { weekEnd: end, running: i === 0 && end > today, ...R.weekly(co, days, end) }; }).filter(w => w.daysCounted > 0);
        return { days: dates.slice(-28).map(d => ({ date: d, ...days[d], addiction: undefined, stock: undefined })), weeks, sendTo: co.ownerName || 'the owner' };
    }
    throw new Error('Unknown action');
}
async function addToDirector(redis, directorId, companyId) {
    const raw = await redis(['HGET', DIRECTORS, String(directorId)]);
    let ids = []; try { ids = raw ? JSON.parse(raw) : []; } catch (e) { ids = []; }
    if (!ids.includes(String(companyId))) ids.push(String(companyId));
    await redis(['HSET', DIRECTORS, String(directorId), JSON.stringify(ids)]);
}
async function removeFromDirector(redis, directorId, companyId) {
    const raw = await redis(['HGET', DIRECTORS, String(directorId)]);
    let ids = []; try { ids = raw ? JSON.parse(raw) : []; } catch (e) { ids = []; }
    ids = ids.filter(x => x !== String(companyId));
    if (ids.length) await redis(['HSET', DIRECTORS, String(directorId), JSON.stringify(ids)]); else await redis(['HDEL', DIRECTORS, String(directorId)]);
}

module.exports = { companyHandle, isDirector, companiesOf, tornCompany, normalize, getAll };
