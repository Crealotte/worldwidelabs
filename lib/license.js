// lib/license.js — VIP for the trading ledger ("Ledger & profit"): 1 Xanax per 7 days. The pricelist, the receipts and the Overview / Purchases / Partners pages are free for everybody.
// A trader with an active Trading Funding and the owner have the ledger without paying. The data of somebody whose VIP ended is still kept: only looking at the ledger waits for the next payment.
//
// How a payment is found: the trader sends Xanax to the owner and writes their code (WWL-VIP-<their Torn ID>) in the message. "Check now" reads the owner's recent events (what the owner
// received, with the message) with the owner's key from the server setting WWL_OWNER_KEY (a key with Limited access; it is never sent to anybody), and gives 7 days per Xanax for every
// event that came from that trader and has their code. Every event counts only once. Nothing is polled: it only happens when somebody presses "Check now" (at most every 15 seconds each,
// and the owner's events are kept for 30 seconds for everybody).
//
//   wwl:license:<tornId> -> JSON { until: ms, grants: [ { at, days, via: 'xanax' | 'owner', event? } ] }   (the last 20 grants)
//   wwl:license-index    -> hash tornId -> until (ms), so the owner can list the VIPs
//   wwl:lic-ev:<eventId> -> '1' (an event that was used, kept 200 days)

const { tornFetch } = require('./tornFetch');

const LIC = id => `wwl:license:${id}`, LIC_INDEX = 'wwl:license-index', LIC_EV = id => `wwl:lic-ev:${id}`, DAY = 86400000;
const ownerId = () => String(process.env.WWL_OWNER_ID || '2645743');
const codeOf = id => `WWL-VIP-${id}`;

async function licenseOf(redis, id) {
    try { const raw = await redis(['GET', LIC(id)]); const d = raw ? JSON.parse(raw) : {}; return { until: Number(d.until) || 0, grants: Array.isArray(d.grants) ? d.grants : [] }; } catch (e) { return { until: 0, grants: [] }; }
}
// gives days of VIP (from now, or from the end of the VIP that is running)
async function grant(redis, id, days, via, event) {
    const lic = await licenseOf(redis, id), now = Date.now(), until = Math.max(now, lic.until) + days * DAY;
    lic.grants.push({ at: now, days, via, ...(event ? { event } : {}) });
    await redis(['SET', LIC(id), JSON.stringify({ until, grants: lic.grants.slice(-20) })]);
    await redis(['HSET', LIC_INDEX, String(id), String(until)]);
    return until;
}
// the events of the owner that are Xanax sent to the owner: who, how many, the message
function parseGifts(events) {
    const out = [];
    for (const [id, e] of Object.entries(events || {})) {
        const html = String((e && e.event) || ''), text = html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
        const sender = (html.match(/XID=(\d+)/) || [])[1], m = text.match(/sent you (?:(\d+)\s*x\s*|an? )?(.+?)(?:\s+with the message:?\s*(.*))?$/i);
        if (!sender || !m) continue;
        out.push({ id: String(id), ts: Number(e.timestamp) || 0, sender: String(sender), qty: Number(m[1]) || 1, item: m[2].trim(), message: (m[3] || '').trim() });
    }
    return out;
}
async function ownerEvents(redis) {
    const k = process.env.WWL_OWNER_KEY;
    if (!k) return null;
    const cached = await redis(['GET', 'wwl:owner-events']);
    if (cached) return JSON.parse(cached);
    const r = await tornFetch(`https://api.torn.com/user/?selections=events&key=${encodeURIComponent(k)}`), j = await r.json();
    if (j.error) throw new Error(`Torn would not give the owner's events (${j.error.error || 'error'}). The owner's key needs Limited access.`);
    const events = j.events || {};
    await redis(['SET', 'wwl:owner-events', JSON.stringify(events), 'EX', 30]);
    return events;
}

// who has the ledger: the owner, a trader with an active Trading Funding (finActive), or somebody with VIP
async function vipOf(redis, who, owner, finActive) {
    if (owner) return { active: true, reason: 'owner', until: 0 };
    const lic = await licenseOf(redis, who.playerId);
    if (lic.until > Date.now()) return { active: true, reason: 'license', until: lic.until };
    if (await finActive()) return { active: true, reason: 'funding', until: 0 };
    return { active: false, reason: 'none', until: lic.until };
}
const info = who => ({ code: codeOf(who.playerId), ownerId: ownerId(), price: '1 Xanax per 7 days', auto: !!process.env.WWL_OWNER_KEY });

async function licHandle(action, body, { redis, who, owner, vip }) {
    const id = String(who.playerId);
    if (action === 'lic-status') return { vip, ...info(who) };
    if (action === 'lic-check') {
        if (!process.env.WWL_OWNER_KEY) return { ok: false, manual: true, message: 'Automatic checking is not switched on yet. The owner can give you VIP by hand once the Xanax arrived.' };
        const first = await redis(['SET', `wwl:lic-check:${id}`, '1', 'EX', 15, 'NX']);
        if (!first) return { ok: false, wait: true, message: 'Checked a moment ago. Wait a few seconds and press the button again.' };
        const gifts = parseGifts(await ownerEvents(redis)).filter(g => g.sender === id && /xanax/i.test(g.item));
        let days = 0, used = 0, withoutCode = 0;
        for (const g of gifts) {
            if (!g.message.toUpperCase().includes(codeOf(id))) { withoutCode++; continue; }
            if (await redis(['GET', LIC_EV(g.id)])) { used++; continue; }
            await redis(['SET', LIC_EV(g.id), '1', 'EX', 200 * DAY / 1000]);
            const d = Math.min(52, g.qty) * 7; days += d;
            await grant(redis, id, d, 'xanax', g.id);
        }
        const lic = await licenseOf(redis, id);
        return { ok: true, granted: days, until: lic.until, seen: gifts.length, used, withoutCode, active: lic.until > Date.now() };
    }
    // the owner's tools
    if (!owner) throw new Error('Owner only.');
    if (action === 'lic-list') {
        const raw = await redis(['HGETALL', LIC_INDEX]), list = [];
        const flat = Array.isArray(raw) ? raw : Object.entries(raw || {}).flat();
        for (let i = 0; i < flat.length; i += 2) list.push({ tornId: String(flat[i]), until: Number(flat[i + 1]) || 0 });
        return { licenses: list.sort((a, b) => b.until - a.until) };
    }
    if (action === 'lic-grant') {
        const target = String(body.tornId || '').replace(/\D/g, '').slice(0, 10), days = Math.round(Number(body.days));
        if (!target || !days || days < -365 || days > 365) throw new Error('Write a Torn ID and a number of days.');
        const until = days > 0 ? await grant(redis, target, days, 'owner') : (await (async () => { const lic = await licenseOf(redis, target), u = Date.now() + days * DAY; await redis(['SET', LIC(target), JSON.stringify({ until: u, grants: lic.grants })]); await redis(['HSET', LIC_INDEX, target, String(u)]); return u; })());
        return { ok: true, tornId: target, until };
    }
    if (action === 'lic-peek') { // what the owner's recent events look like to WWL (to see that the check can read them)
        const ev = await ownerEvents(redis);
        if (!ev) throw new Error('WWL_OWNER_KEY is not set on the server.');
        return { gifts: parseGifts(ev).slice(0, 30), events: Object.keys(ev).length };
    }
    throw new Error('Unknown action');
}

module.exports = { licHandle, vipOf, licenseOf, grant, parseGifts, codeOf, info };
