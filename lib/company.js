// lib/company.js — the company side of WWL for the owner's companies: the owner registers a company (by its Torn ID; the director is whoever Torn says
// runs it), and that director can log in to WWL and sees ONLY their company: income, customers, employees (position, wage, stats, last seen), stock,
// and the standing Investment amount the owner keeps for them. Nothing else of WWL is open to a director (see lib/access.js and the director gate in
// api/war-payout.js). Data comes from the director's own API key, read live when they open it.
//
// Investment amount: money the owner owes this director (for an investment the director made through the owner's fund). Instead of two transfers, the
// director sends the owner the weekly amount MINUS this figure. It is a standing field: it stays until the owner changes it or sets it to 0.
//
//   wwl:companies  -> hash: companyId -> JSON { id, name, type, directorId, directorName, cutPct, investment, invNote, invLog: [{ t, by, delta, after, note }], at }
//   wwl:directors  -> hash: directorPlayerId -> JSON [companyId, ...]

const COMPANIES = 'wwl:companies';
const DIRECTORS = 'wwl:directors';
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

async function getAll(redis) {
    const flat = (await redis(['HGETALL', COMPANIES])) || [];
    const out = [];
    for (let i = 0; i < flat.length; i += 2) { try { out.push(JSON.parse(flat[i + 1])); } catch (e) { /* skip */ } }
    return out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
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

// Torn's company answer, read live with the director's own key (never cached: the numbers must be current). `selections` is a single request.
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

async function companyHandle(action, body, { redis, key, playerId, playerName, owner }) {
    // ---- the owner's side ----
    if (action === 'co-list') {
        if (!owner) throw new Error('Owners only');
        return { companies: (await getAll(redis)).map(publicView) };
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
        const raw = await redis(['HGET', COMPANIES, id]);
        const old = raw ? JSON.parse(raw) : null;
        let directorName = old?.directorName || '';
        if (!directorName || String(old?.directorId) !== String(p.director)) { try { const u = await (await fetch(`https://api.torn.com/user/${p.director}?selections=basic&key=${encodeURIComponent(key)}`)).json(); directorName = u.name || ''; } catch (e) { /* no name */ } }
        const co = { ...(old || { investment: 0, invNote: '', invLog: [], at: Date.now() }), id, name: p.name, type: p.company_type ?? '', directorId: String(p.director), directorName, cutPct: Math.max(0, Math.min(100, num(body.cutPct) ?? old?.cutPct ?? 30)) };
        if (old && String(old.directorId) !== co.directorId) await removeFromDirector(redis, old.directorId, id); // the company has a new director
        await redis(['HSET', COMPANIES, id, JSON.stringify(co)]);
        await addToDirector(redis, co.directorId, id);
        return { ok: true, company: publicView(co) };
    }
    if (action === 'co-remove') {
        if (!owner) throw new Error('Owners only');
        const id = String(body.companyId || '').replace(/\D/g, '');
        const raw = await redis(['HGET', COMPANIES, id]);
        if (raw) { const co = JSON.parse(raw); await removeFromDirector(redis, co.directorId, id); }
        await redis(['HDEL', COMPANIES, id]);
        return { ok: true };
    }
    if (action === 'co-invest') { // the standing Investment amount: set it, or add to / take from it; 0 = nothing to settle
        if (!owner) throw new Error('Owners only');
        const id = String(body.companyId || '').replace(/\D/g, '');
        const raw = await redis(['HGET', COMPANIES, id]);
        if (!raw) throw new Error('Unknown company.');
        const co = JSON.parse(raw);
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

    // ---- the director's side (and the owner, for the companies they direct themselves) ----
    if (action === 'co-my' || action === 'co-raw') {
        const mine = await companiesOf(redis, playerId);
        if (!mine.length) throw new Error('You are not registered as a director of a company.');
        const co = mine.find(c => String(c.id) === String(body.companyId)) || mine[0];
        const raw = await tornCompany(key);
        if (action === 'co-raw') return { raw: JSON.stringify(raw).slice(0, 8000) };
        const data = normalize(raw);
        return { companies: mine.map(c => ({ id: c.id, name: c.name })), company: publicView(co), data };
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

module.exports = { companyHandle, isDirector, companiesOf };
