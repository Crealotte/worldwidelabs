// lib/recruit.js — the server side of the CoreLabs Recruiter script (it used to live in Supabase). Answers the script's `rec-*` actions.
//
// Everything costs very few Redis commands on purpose (the free plan is limited): a recruiter's whole list is ONE hash, loaded with one command and saved in batches,
// the shared player stats are ONE hash that is read and written for a whole page of players at once, and the key -> player lookup and the license are remembered in memory for a while.
//
//   wwl:rec:st:<tornId>   hash targetId -> JSON { f, c, s, u, n, no, co, m, at }   a recruiter's own F/C/S/U buttons, name, notes, company, manual stats, time of last change (ms)
//   wwl:rec:tg            hash playerId -> JSON { n, ws, x, a, s, ts }               shared stats of players (name, work stats, xanax, war hits, streak, time), any subscriber reads and adds
//   wwl:rec:tickets       JSON list: the owner's to-do list of the script
//   licenses: lib/license.js, product REC (own message WWL-REC-<id>-<random>, own license, separate from the Ledger VIP)
//
// The subscription (1 Xanax per 7 days) is checked only when somebody presses "Check my payment"; the owner never pays. Without a subscription a recruiter can still read their own list.

const crypto = require('crypto');
const { tornFetch } = require('./tornFetch');
const lic = require('./license');
const access = require('./access');
const company = require('./company');

const ST = id => `wwl:rec:st:${id}`, TG = 'wwl:rec:tg', TICKETS = 'wwl:rec:tickets', DAY = 86400000;
const OWNER_ID = () => String(process.env.WWL_OWNER_ID || '2645743');
const TICKET_IDS = ['2353554', '2645743']; // the people who see the to-do list of the script

// key -> player, remembered 10 minutes in this server instance (a warm instance answers many requests): saves a Torn call per request
const whoMem = new Map();
async function whoOf(key) {
    const k = String(key || '').trim();
    if (!/^[A-Za-z0-9]{16}$/.test(k)) return null;
    const h = crypto.createHash('sha256').update(k).digest('hex'), hit = whoMem.get(h);
    if (hit && Date.now() - hit.at < 600000) return hit.who;
    const r = await tornFetch(`https://api.torn.com/user/?selections=profile&key=${encodeURIComponent(k)}`), p = await r.json();
    if (p.error || !p.player_id) return null;
    const who = { playerId: String(p.player_id), name: p.name || '', factionId: p.faction && p.faction.faction_id ? String(p.faction.faction_id) : '', position: (p.faction && p.faction.position) || '' };
    if (whoMem.size > 2000) whoMem.clear();
    whoMem.set(h, { who, at: Date.now() });
    return who;
}

// Free for: the leaders and co-leaders of the factions on WWL's list of allowed factions, and the directors of the registered companies (not the company CreaLabs3).
// A faction leader is read from the Torn profile of the key; the list of factions and the companies are WWL's own (lib/access.js, lib/company.js).
const NO_PERK_COMPANY = /crea\s*labs\s*3/i;
async function freeReason(redis, who) {
    if (who.factionId && /^(co-?)?leader$/i.test(who.position || '')) {
        const list = await access.allowedList(false); // the list is empty until WWL is switched on for factions: then nobody gets this
        if (list && list[who.factionId]) return 'faction leader';
    }
    const companies = await company.companiesOf(redis, who.playerId);
    if (companies.some(c => !NO_PERK_COMPANY.test(String(c.name || '')))) return 'company director';
    return '';
}

// leaders and directors with free access are noted (at most once in 6 hours per player and server instance) so the owner can see who has it
const FREE_SEEN = 'wwl:rec:free', freeNoted = new Map();
function noteFree(redis, who, reason) {
    const last = freeNoted.get(who.playerId);
    if (last && Date.now() - last < 6 * 3600 * 1000) return;
    if (freeNoted.size > 2000) freeNoted.clear();
    freeNoted.set(who.playerId, Date.now());
    redis(['HSET', FREE_SEEN, who.playerId, JSON.stringify({ r: reason, n: who.name || '', f: who.factionId || '', at: Date.now() })]).catch(() => {});
}

// subscription of a recruiter: owner = always; leaders and directors = free; otherwise the license (remembered 60 s; a payment check refreshes it)
const licMem = new Map();
async function paidOf(redis, who, fresh) {
    if (who.playerId === OWNER_ID()) return { paid: true, owner: true, until: 0 };
    const hit = licMem.get(who.playerId);
    if (!fresh && hit && Date.now() - hit.at < 60000) return hit.v;
    const free = await freeReason(redis, who);
    if (free) { noteFree(redis, who, free); const v = { paid: true, owner: false, until: 0, free }; licMem.set(who.playerId, { v, at: Date.now() }); return v; }
    const l = await lic.licenseOf(redis, who.playerId, 'REC'), v = { paid: l.until > Date.now(), owner: false, until: l.until };
    if (licMem.size > 2000) licMem.clear();
    licMem.set(who.playerId, { v, at: Date.now() });
    return v;
}

const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
const num = (v, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0; };
const idOf = v => { const s = String(v == null ? '' : v).replace(/\D/g, '').slice(0, 10); return s && Number(s) > 0 ? s : ''; };
const pairs = raw => { const flat = Array.isArray(raw) ? raw : Object.entries(raw || {}).flat(), out = []; for (let i = 0; i < flat.length; i += 2) out.push([String(flat[i]), flat[i + 1]]); return out; };

// a row of the script -> what is stored (short names keep the list small)
function cleanState(r, at) {
    const id = idOf(r && (r.id != null ? r.id : r.target_id));
    if (!id) return null;
    const st = { f: num(r.f, 3), c: num(r.c, 3), s: num(r.s, 3), u: num(r.u, 1), at: at || Date.now() };
    if (r.name) st.n = clip(r.name, 40);
    if (r.notes) st.no = clip(r.notes, 1000);
    if (r.company) st.co = clip(r.company, 40);
    if (r.manual && typeof r.manual === 'object') st.m = JSON.parse(JSON.stringify(r.manual, (k, v) => (typeof v === 'string' ? clip(v, 60) : v))); // a small object (the numbers the recruiter typed in)
    return { id, st };
}
const showState = (id, st) => ({ id, f: st.f || 0, c: st.c || 0, s: st.s || 0, u: st.u || 0, name: st.n || null, notes: st.no || null, company: st.co || null, manual: st.m || null, at: st.at || 0 });

const brokerLast = new Map();

async function recHandle(action, body, { redis, who, key }) {
    const id = who.playerId, owner = id === OWNER_ID();
    const need = async () => { const p = await paidOf(redis, who); if (!p.paid) { const e = new Error('Your Recruiter subscription is not active.'); e.code = 402; throw e; } return p; };

    // ---- the subscription ----
    if (action === 'rec-license') {
        const p = await paidOf(redis, who, true);
        return { paid: p.paid, owner: p.owner, free: p.free || '', until: p.until, name: who.name, tornId: id, code: p.owner || p.free ? '' : await lic.getCode(redis, id, 'REC'), ownerId: OWNER_ID(), xanax: 1, days: 7, auto: !!lic.ownerKey() };
    }
    if (action === 'rec-subscribe') { // the message to send with the Xanax (the same one stays for every renewal; fresh: true gives a new one and the old one stops working)
        await lic.rememberName(redis, id, who.name, true);
        const have = await lic.getCode(redis, id, 'REC');
        return { ok: true, code: have && !body.fresh ? have : await lic.newCode(redis, id, 'REC') };
    }
    if (action === 'rec-check') { // looks at the Xanax the owner received, once, when the recruiter presses the button (at most every 15 seconds each)
        await lic.rememberName(redis, id, who.name, true);
        if (!lic.ownerKey()) return { ok: false, manual: true, message: 'Automatic checking is not switched on yet. The owner can activate you by hand once the Xanax arrived.' };
        const code = await lic.getCode(redis, id, 'REC');
        if (!code) return { ok: false, noCode: true, message: 'Press Subscribe first: you get a message to send with the Xanax.' };
        if (!(await redis(['SET', `wwl:rec-check:${id}`, '1', 'EX', 15, 'NX']))) return { ok: false, wait: true, message: 'Checked a moment ago. Wait a few seconds and press the button again.' };
        const scan = await lic.scanPayments(redis, false);
        const mine = scan.gifts.filter(g => g.product === 'REC' && (g.tornId === id || g.sender === id)), days = scan.done.filter(d => d.tornId === id && d.product === 'REC').reduce((t, d) => t + d.days, 0);
        const p = await paidOf(redis, who, true);
        return { ok: true, granted: days, until: p.until, paid: p.paid, seen: mine.length, used: mine.filter(g => g.state === 'counted already').length };
    }

    // ---- a recruiter's own list ----
    if (action === 'rec-load') { // everything since `since` (ms); reading is allowed without a subscription so the list is still visible
        const since = Number(body.since) || 0, rows = [];
        for (const [tid, raw] of pairs(await redis(['HGETALL', ST(id)]))) { try { const st = JSON.parse(raw); if ((st.at || 0) > since) rows.push(showState(tid, st)); } catch (e) { /* skip a damaged row */ } }
        const p = await paidOf(redis, who);
        return { rows, now: Date.now(), paid: p.paid, owner: p.owner, until: p.until };
    }
    if (action === 'rec-save' || action === 'rec-import') { // writes need the subscription. import = the first copy of an old list (up to 1500 rows, their own time of change is kept)
        await need();
        const list = Array.isArray(body.rows) ? body.rows.slice(0, action === 'rec-import' ? 1500 : 100) : [], args = [];
        let have = {};
        if (action === 'rec-import') { // a copy of an old list never replaces something newer that is already here (another computer may have moved its copy before)
            const ids = list.map(r => idOf(r && (r.id != null ? r.id : r.target_id))).filter(Boolean);
            for (let i = 0; i < ids.length; i += 500) { const vals = await redis(['HMGET', ST(id), ...ids.slice(i, i + 500)]); (vals || []).forEach((raw, j) => { if (raw) { try { have[ids[i + j]] = JSON.parse(raw).at || 1; } catch (e) { have[ids[i + j]] = 1; } } }); }
        }
        for (const r of list) {
            const at = action === 'rec-import' && Number(r.at) > 0 ? Number(r.at) : 0, c = cleanState(r, at);
            if (!c) continue;
            if (action === 'rec-import' && have[c.id] && (!at || at <= have[c.id])) continue; // already here (and not older than this copy)
            args.push(c.id, JSON.stringify(c.st));
        }
        for (let i = 0; i < args.length; i += 1000) await redis(['HSET', ST(id), ...args.slice(i, i + 1000)]);
        return { ok: true, saved: args.length / 2 };
    }
    if (action === 'rec-del') {
        await need();
        const ids = (Array.isArray(body.ids) ? body.ids : [body.id]).map(idOf).filter(Boolean).slice(0, 100);
        if (ids.length) await redis(['HDEL', ST(id), ...ids]);
        return { ok: true };
    }

    // ---- the shared stats of players (any subscriber reads and adds) ----
    if (action === 'rec-stats-get') {
        await need();
        const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(idOf).filter(Boolean))].slice(0, 80), out = [];
        if (ids.length) { const vals = await redis(['HMGET', TG, ...ids]); (vals || []).forEach((raw, i) => { if (!raw) return; try { const t = JSON.parse(raw); out.push({ id: ids[i], name: t.n || null, ws: t.ws || 0, xan: t.x || 0, act: t.a || 0, streak: t.s || 0, ts: t.ts || 0 }); } catch (e) { /* skip */ } }); }
        return { rows: out };
    }
    if (action === 'rec-stats-put') {
        await need();
        const list = Array.isArray(body.rows) ? body.rows.slice(0, 80) : [], args = [];
        for (const r of list) { const pid = idOf(r && r.id); if (pid) args.push(pid, JSON.stringify({ n: clip(r.name, 40), ws: num(r.ws, 1e13), x: num(r.xan, 1e9), a: num(r.act, 1e7), s: num(r.streak, 1e5), ts: Date.now() })); }
        if (args.length) await redis(['HSET', TG, ...args]);
        return { ok: true, saved: args.length / 2 };
    }

    // ---- the Broker post to Discord: the link is a setting of this server (WWL_REC_DISCORD_WEBHOOK), never part of the script ----
    if (action === 'rec-broker') {
        await need();
        const hook = String(process.env.WWL_REC_DISCORD_WEBHOOK || '').trim();
        if (!hook) return { ok: false, error: 'The Discord link is not set up on the server yet.' };
        if (Date.now() - (brokerLast.get(id) || 0) < 10000) return { ok: false, error: 'Please wait a few seconds.' };
        brokerLast.set(id, Date.now());
        const r = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [{ title: 'NEW BLIND LEAD GENERATED', color: 3447003, fields: [
            { name: 'Work Stats', value: `**${clip(body.ws, 40)}**`, inline: true },
            { name: 'Target Job', value: `**${clip(body.comp, 60)}**`, inline: true },
            { name: 'Recruiter Notes', value: clip(body.notes, 900) || 'No notes.' },
            { name: 'Identity', value: 'REDACTED' },
        ], footer: { text: 'Elite Brokerage System' }, timestamp: new Date().toISOString() }] }) });
        return { ok: r.ok };
    }

    // ---- the to-do list of the script (only for the two people who run it) ----
    if (action.startsWith('rec-ticket')) {
        if (!TICKET_IDS.includes(id)) throw new Error('Owner only.');
        let list = []; try { list = JSON.parse((await redis(['GET', TICKETS])) || '[]'); } catch (e) { list = []; }
        if (action === 'rec-tickets') return { tickets: list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) };
        if (action === 'rec-ticket-add') { const t = { id: crypto.randomBytes(5).toString('hex'), title: clip(body.title, 200), description: clip(body.description, 2000), created_by: id, status: 'todo', created_at: new Date().toISOString() }; list.push(t); await redis(['SET', TICKETS, JSON.stringify(list.slice(-300))]); return { ok: true, ticket: t }; }
        if (action === 'rec-ticket-status') { const t = list.find(x => x.id === String(body.id)); if (!t) throw new Error('Not found.'); t.status = clip(body.status, 20); await redis(['SET', TICKETS, JSON.stringify(list)]); return { ok: true }; }
        if (action === 'rec-ticket-del') { await redis(['SET', TICKETS, JSON.stringify(list.filter(x => x.id !== String(body.id)))]); return { ok: true }; }
    }

    // ---- the owner's tools ----
    if (!owner) throw new Error('Owner only.');
    if (action === 'rec-owner-list') { // who has the Recruiter subscription
        const out = [];
        for (const [tid, until] of pairs(await redis(['HGETALL', lic.PROD.REC.index]))) out.push({ tornId: tid, until: Number(until) || 0, name: (await redis(['HGET', 'wwl:license-names', tid])) || '' });
        // free access: the directors of registered companies (all of them, known from WWL's company list) and the leaders and co-leaders noted when they opened the script or this page
        const free = {};
        for (const [tid, raw] of pairs(await redis(['HGETALL', FREE_SEEN]))) { try { const v = JSON.parse(raw); free[tid] = { tornId: tid, name: v.n || '', reason: v.r || '', faction: v.f || '', seenAt: v.at || 0, companies: [] }; } catch (e) { /* skip */ } }
        const dir = pairs(await redis(['HGETALL', 'wwl:directors'])), compIds = [...new Set(dir.flatMap(([, raw]) => { try { return JSON.parse(raw); } catch (e) { return []; } }))];
        const compName = {};
        if (compIds.length) { const rows = await redis(['HMGET', 'wwl:companies', ...compIds]); compIds.forEach((id, i) => { try { compName[id] = (JSON.parse(rows[i]) || {}).name || ''; } catch (e) { /* skip */ } }); }
        for (const [tid, raw] of dir) {
            let ids = []; try { ids = JSON.parse(raw); } catch (e) { ids = []; }
            const names = ids.map(id => compName[id]).filter(n => n !== undefined && !NO_PERK_COMPANY.test(String(n)));
            if (!names.length) continue; // only directs the company without the perk
            const e = free[tid] || (free[tid] = { tornId: tid, name: '', reason: 'company director', faction: '', seenAt: 0, companies: [] });
            e.companies = names;
            if (!e.name) e.name = (await redis(['HGET', 'wwl:license-names', tid])) || '';
        }
        return { licenses: out.sort((a, b) => b.until - a.until), free: Object.values(free).sort((a, b) => (a.reason + a.name).localeCompare(b.reason + b.name)) };
    }
    if (action === 'rec-owner-grant') {
        const target = idOf(body.tornId), days = Math.round(Number(body.days));
        if (!target || !days || days < 1 || days > 365) throw new Error('Write a Torn ID and a number of days (1 to 365).');
        licMem.delete(target);
        return { ok: true, tornId: target, until: await lic.grant(redis, target, days, 'owner', null, 'REC') };
    }
    throw new Error('Unknown action');
}

module.exports = { recHandle, whoOf };
