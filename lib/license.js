// lib/license.js — VIP for the trading ledger ("Ledger & profit"): 1 Xanax per 7 days. The pricelist, the receipts and the Overview / Purchases / Partners pages are free for everybody.
// A trader with an active Trading Funding and the owner have the ledger without paying. The data of somebody whose VIP ended is still kept: only looking at the ledger waits for the next payment.
//
// How a payment is found: the trader presses Subscribe and gets their own message (WWL-VIP-<their Torn ID>-<random>), and sends the Xanax with exactly that message. "Check now" reads the owner's recent events (what the owner
// received, with the message) with the owner's key from the server setting WWL_OWNER_KEY (a key with Limited access; it is never sent to anybody), and gives 7 days per Xanax for every
// event that came from that trader AND has their message in it: Xanax sent for something else (the owner has other services) never counts. Every event counts only once. Nothing is polled: it only happens when somebody presses "Check now" (at most every 15 seconds each,
// and the owner's events are kept for 30 seconds for everybody).
//
//   wwl:license:<tornId> -> JSON { until: ms, grants: [ { at, days, via: 'xanax' | 'owner', event? } ] }   (the last 20 grants)
//   wwl:license-index    -> hash tornId -> until (ms), so the owner can list the VIPs
//   wwl:lic-code:<tornId> -> the message of that trader (kept: the same message is used for every renewal)
//   wwl:lic-ev:<eventId> -> '1' (an event that was used, kept 200 days)

const { tornFetch } = require('./tornFetch');

// Two separate subscriptions share this module: VIP (the ledger) and REC (the Recruiter script). Each has its own license, index and message; the owner's events are read once for both.
const LIC = id => `wwl:license:${id}`, LIC_INDEX = 'wwl:license-index', LIC_EV = id => `wwl:lic-ev:${id}`, DAY = 86400000;
const PROD = {
    VIP: { lic: LIC, index: LIC_INDEX, code: id => `wwl:lic-code:${id}` },
    REC: { lic: id => `wwl:rec-license:${id}`, index: 'wwl:rec-license-index', code: id => `wwl:rec-code:${id}` },
};
const LIC_NAMES = 'wwl:license-names';
// the name of a trader is kept next to their Torn ID, so the owner sees who it is
const rememberName = async (redis, id, name, force) => { const nm = String(name || '').replace(/(hide|show) item values/ig, '').trim().slice(0, 40); if (!nm) return; if (force || !(await redis(['HGET', LIC_NAMES, String(id)]))) await redis(['HSET', LIC_NAMES, String(id), nm]); };
const lookupName = async (redis, id, key) => { try { const r = await tornFetch(`https://api.torn.com/user/${encodeURIComponent(id)}?selections=profile&key=${encodeURIComponent(key)}`), j = await r.json(); if (j && j.name) { await rememberName(redis, id, j.name, true); return j.name; } } catch (e) { /* no name */ } return ''; };
const ownerId = () => String(process.env.WWL_OWNER_ID || '2645743');
// the owner's key from the server setting (spaces or quote marks around it by accident are ignored)
const ownerKey = () => String(process.env.WWL_OWNER_KEY || '').trim().replace(/^["']|["']$/g, '').trim();
const getCode = async (redis, id, prod = 'VIP') => String(await redis(['GET', PROD[prod].code(id)]) || '');
// a message of their own: starts with WWL-VIP so it is easy to see in the events, with their Torn ID and a random part so it is not guessable
const newCode = async (redis, id, prod = 'VIP') => { const code = `WWL-${prod}-${id}-${require('crypto').randomBytes(3).toString('hex').toUpperCase()}`; await redis(['SET', PROD[prod].code(id), code]); return code; };

async function licenseOf(redis, id, prod = 'VIP') {
    try { const raw = await redis(['GET', PROD[prod].lic(id)]); const d = raw ? JSON.parse(raw) : {}; return { until: Number(d.until) || 0, grants: Array.isArray(d.grants) ? d.grants : [] }; } catch (e) { return { until: 0, grants: [] }; }
}
// gives days of VIP (from now, or from the end of the VIP that is running)
async function grant(redis, id, days, via, event, prod = 'VIP') {
    const lic = await licenseOf(redis, id, prod), now = Date.now(), until = Math.max(now, lic.until) + days * DAY;
    lic.grants.push({ at: now, days, via, ...(event ? { event } : {}) });
    await redis(['SET', PROD[prod].lic(id), JSON.stringify({ until, grants: lic.grants.slice(-20) })]);
    await redis(['HSET', PROD[prod].index, String(id), String(until)]);
    return until;
}
// the events of the owner that are Xanax sent to the owner: who, how many, the message
function parseGifts(events) {
    const out = [], list = Array.isArray(events) ? events.map(e => [e && e.id, e]) : Object.entries(events || {});
    for (const [id, e] of list) {
        const html = String((e && e.event) || ''), text = html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
        // two wordings: "You were sent some Xanax from NAME with the message: ..." (the quantity may be left out) and "NAME sent you 2x Xanax with the message: ..."
        let item = '', qty = 0, name = '', message = '', m;
        if ((m = text.match(/you were sent (?:(\d+)\s*x\s+|some\s+|an?\s+)?(.+?) from (.+?)(?:\s+with the message:?\s*(.*))?$/i))) { qty = Number(m[1]) || 0; item = m[2]; name = m[3]; message = m[4] || ''; }
        else if ((m = text.match(/^(.+?) sent you (?:(\d+)\s*x\s*|some\s+|an?\s+)?(.+?)(?:\s+with the message:?\s*(.*))?$/i))) { name = m[1]; qty = Number(m[2]) || 0; item = m[3]; message = m[4] || ''; }
        if (!m) continue;
        const xid = (html.match(/XID=(\d+)/) || [])[1];
        out.push({ id: String(id), ts: Number(e.timestamp) || 0, sender: xid ? String(xid) : '', senderName: name.trim(), qty: qty || 1, qtyKnown: !!qty, item: item.trim(), message: message.replace(/^["'\s]+|["'\s]+$/g, '') });
    }
    return out;
}
async function ownerEvents(redis) {
    const k = ownerKey();
    if (!k) return null;
    const cached = await redis(['GET', 'wwl:owner-events']);
    if (cached) return JSON.parse(cached);
    const r = await tornFetch(`https://api.torn.com/user/?selections=events&limit=100&key=${encodeURIComponent(k)}`), j = await r.json();
    if (j.error) throw new Error(`Torn would not give the owner's events (${j.error.error || 'error'}). The owner's key needs Limited access.`);
    const events = j.events || {};
    await redis(['SET', 'wwl:owner-events', JSON.stringify(events), 'EX', 30]);
    return events;
}

// Goes through the Xanax the owner received and gives VIP for every one that came with a trader's own message (and has not been counted before). The trader is read from the message itself
// (WWL-VIP-<Torn ID>-<random>), which has to be the message that trader was given; when Torn shows who sent it, that must be the same person. dry = only look, do not give anything.
const CODE_RE = /WWL-(VIP|REC)-(\d+)-([A-F0-9]{6})/i;
async function scanPayments(redis, dry) {
    const events = await ownerEvents(redis);
    if (!events) return null;
    const gifts = [], done = [];
    for (const g of parseGifts(events)) {
        if (!/xanax/i.test(g.item)) continue;
        const m = CODE_RE.exec(g.message), row = { ...g, tornId: m ? m[2] : '', product: m ? m[1].toUpperCase() : '', state: '' };
        gifts.push(row);
        if (!m) { row.state = 'no message code'; continue; }
        if (g.sender && g.sender !== m[2]) { row.state = 'sent by somebody else'; continue; }
        const stored = await getCode(redis, m[2], row.product);
        if (!stored || stored.toUpperCase() !== m[0].toUpperCase()) { row.state = 'not that trader\'s message'; continue; }
        if (dry) { row.state = (await redis(['GET', LIC_EV(g.id)])) ? 'counted already' : 'will be counted'; continue; }
        if (!(await redis(['SET', LIC_EV(g.id), '1', 'EX', 200 * DAY / 1000, 'NX']))) { row.state = 'counted already'; continue; }
        const days = Math.min(52, g.qty) * 7;
        await grant(redis, m[2], days, 'xanax', g.id, row.product);
        await rememberName(redis, m[2], g.senderName, false);
        row.state = 'counted now'; done.push({ tornId: m[2], product: row.product, name: (await redis(['HGET', LIC_NAMES, m[2]])) || g.senderName || '', days, event: g.id, qtyKnown: g.qtyKnown });
    }
    return { done, gifts };
}
// Called when somebody opens the Trading page: payments that arrived are given at most once a minute, so nobody has to press anything
async function scanIfDue(redis) {
    if (!ownerKey()) return;
    try { if (await redis(['SET', 'wwl:lic-scan', '1', 'EX', 60, 'NX'])) await scanPayments(redis, false); } catch (e) { /* the page still opens; the next visit tries again */ }
}

// who has the ledger: the owner, a trader with an active Trading Funding (finActive), or somebody with VIP
async function vipOf(redis, who, owner, finActive) {
    if (owner) return { active: true, reason: 'owner', until: 0 };
    const lic = await licenseOf(redis, who.playerId);
    if (lic.until > Date.now()) return { active: true, reason: 'license', until: lic.until };
    if (await finActive()) return { active: true, reason: 'funding', until: 0 };
    return { active: false, reason: 'none', until: lic.until };
}
const info = async (redis, who) => ({ code: await getCode(redis, who.playerId), ownerId: ownerId(), price: '1 Xanax per 7 days', auto: !!ownerKey() });

async function licHandle(action, body, { redis, who, owner, vip, key }) {
    const id = String(who.playerId);
    if (action === 'lic-status') return { vip, ...(await info(redis, who)) };
    if (action === 'lic-subscribe') { // the message to send with the Xanax (the same one stays for every renewal; fresh: true gives a new one and the old one stops working)
        await rememberName(redis, id, who.name, true);
        const have = await getCode(redis, id);
        return { ok: true, code: have && !body.fresh ? have : await newCode(redis, id) };
    }
    if (action === 'lic-check') {
        await rememberName(redis, id, who.name, true);
        if (!ownerKey()) return { ok: false, manual: true, message: 'Automatic checking is not switched on yet. The owner can give you VIP by hand once the Xanax arrived.' };
        const code = await getCode(redis, id);
        if (!code) return { ok: false, noCode: true, message: 'Press Subscribe first: you get a message to send with the Xanax.' };
        const first = await redis(['SET', `wwl:lic-check:${id}`, '1', 'EX', 15, 'NX']);
        if (!first) return { ok: false, wait: true, message: 'Checked a moment ago. Wait a few seconds and press the button again.' };
        const scan = await scanPayments(redis, false);
        const mine = scan.gifts.filter(g => g.tornId === id || g.sender === id), days = scan.done.filter(d => d.tornId === id && d.product === 'VIP').reduce((t, d) => t + d.days, 0), lic = await licenseOf(redis, id);
        return { ok: true, granted: days, until: lic.until, seen: mine.length, used: mine.filter(g => g.state === 'counted already').length, withoutCode: mine.filter(g => g.sender === id && !g.tornId).length, active: lic.until > Date.now() };
    }
    // the owner's tools
    if (!owner) throw new Error('Owner only.');
    if (action === 'lic-list') {
        const raw = await redis(['HGETALL', LIC_INDEX]), list = [];
        const flat = Array.isArray(raw) ? raw : Object.entries(raw || {}).flat();
        for (let i = 0; i < flat.length; i += 2) list.push({ tornId: String(flat[i]), until: Number(flat[i + 1]) || 0, name: '' });
        const names = await redis(['HGETALL', LIC_NAMES]), nflat = Array.isArray(names) ? names : Object.entries(names || {}).flat(), byId = {};
        for (let i = 0; i < nflat.length; i += 2) byId[String(nflat[i])] = String(nflat[i + 1]);
        let looked = 0;
        for (const l of list) { l.name = byId[l.tornId] || ''; if (!l.name && looked++ < 8) l.name = await lookupName(redis, l.tornId, key); } // a few missing names are looked up (and kept) each time
        return { licenses: list.sort((a, b) => b.until - a.until) };
    }
    if (action === 'lic-grant') {
        const target = String(body.tornId || '').replace(/\D/g, '').slice(0, 10), days = Math.round(Number(body.days));
        if (!target || !days || days < -365 || days > 365) throw new Error('Write a Torn ID and a number of days.');
        const until = days > 0 ? await grant(redis, target, days, 'owner') : (await (async () => { const lic = await licenseOf(redis, target), u = Date.now() + days * DAY; await redis(['SET', LIC(target), JSON.stringify({ until: u, grants: lic.grants })]); await redis(['HSET', LIC_INDEX, target, String(u)]); return u; })());
        return { ok: true, tornId: target, until, name: (await redis(['HGET', LIC_NAMES, target])) || await lookupName(redis, target, key) };
    }
    if (action === 'lic-scan') { // the owner: give VIP now for every Xanax that came with a trader's message
        const scan = await scanPayments(redis, false);
        if (!scan) throw new Error('WWL_OWNER_KEY is not set on this server.');
        return { done: scan.done, gifts: scan.gifts.length };
    }
    if (action === 'lic-peek') { // what the owner's recent events look like to WWL (to see that the check can read them)
        const scan = await scanPayments(redis, true);
        if (!scan) throw new Error(`WWL_OWNER_KEY is not set on this server (environment: ${process.env.VERCEL_ENV || 'local'}; the other settings here with a related name: ${Object.keys(process.env).filter(k => /owner|wwl/i.test(k)).join(', ') || 'none'}). Check the name, that Production is ticked, and redeploy.`);
        return { gifts: scan.gifts.slice(0, 30), events: scan.gifts.length };
    }
    throw new Error('Unknown action');
}

module.exports = { licHandle, scanIfDue, vipOf, licenseOf, grant, parseGifts, info, getCode, newCode, scanPayments, ownerKey, ownerId, rememberName, lookupName, PROD };
