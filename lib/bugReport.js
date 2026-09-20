// lib/bugReport.js — the Bug reports page: a member describes a problem (and can add a screenshot) and it
// is posted to a Discord channel for the owner. Open to every member; routed from api/war-payout.js
// (action 'bug-report'). Where it goes is set in Vercel: DISCORD_BUG_WEBHOOK (a webhook URL of the bug
// channel — simplest), or DISCORD_BUG_CHANNEL_ID (a channel the WorldWideLabs bot can post in).
// A member can send a handful per hour, so it can't be used to spam the channel; mentions are switched
// off so nobody can ping people through it.

const DISCORD_API = 'https://discord.com/api/v10';
const WEBHOOK_RE = /^https:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;
const MAX_PER_HOUR = 5;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

async function sendBugReport({ redis, playerId, name, factionName, body }) {
    const webhook = (process.env.DISCORD_BUG_WEBHOOK || '').trim();
    const channel = (process.env.DISCORD_BUG_CHANNEL_ID || '').trim();
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!(WEBHOOK_RE.test(webhook) || (channel && token))) {
        throw new Error('Bug reports are not connected to Discord yet — please tell the owner (it needs a channel set up in Vercel).');
    }

    const description = String(body.description || '').trim();
    if (description.length < 10) throw new Error('Please describe the problem in a bit more detail (at least a sentence).');
    if (description.length > 1500) throw new Error('That description is too long — please keep it under 1,500 characters.');

    const rateKey = `wwl:bug-rate:${playerId}`;
    const count = await redis(['INCR', rateKey]);
    if (count === 1) await redis(['EXPIRE', rateKey, 3600]);
    if (count > MAX_PER_HOUR) throw new Error(`You've sent ${MAX_PER_HOUR} reports in the last hour — please try again a bit later.`);

    const page = String(body.page || 'unknown').replace(/[^\w\- /]/g, '').slice(0, 40);
    const quoted = description.split('\n').map(l => `> ${l}`).join('\n');
    const content = [
        `🐞 **Bug report** from **${String(name).replace(/[*_`~|>]/g, '')} [${playerId}]** (${String(factionName || 'no faction').replace(/[*_`~|>]/g, '')})`,
        `📍 Page: \`${page}\``,
        quoted,
    ].filter(Boolean).join('\n').slice(0, 1990);

    // Optional screenshot: a resized JPEG/PNG sent by the page as a data URL.
    let file = null;
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.screenshot || ''));
    if (m) {
        const buf = Buffer.from(m[2], 'base64');
        if (buf.length > MAX_IMAGE_BYTES) throw new Error('That screenshot is too big — try a smaller one.');
        file = { buf, type: `image/${m[1]}`, name: `screenshot.${m[1] === 'jpeg' ? 'jpg' : m[1]}` };
    }

    const payload = { content, allowed_mentions: { parse: [] } };
    const url = WEBHOOK_RE.test(webhook) ? `${webhook}?wait=true` : `${DISCORD_API}/channels/${channel}/messages`;
    const headers = WEBHOOK_RE.test(webhook) ? {} : { Authorization: `Bot ${token}` };
    let res;
    if (file) {
        const form = new FormData();
        form.append('payload_json', JSON.stringify(payload));
        form.append('files[0]', new Blob([file.buf], { type: file.type }), file.name);
        res = await fetch(url, { method: 'POST', headers, body: form });
    } else {
        res = await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    }
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Discord did not accept the report (${res.status}${err.message ? `: ${err.message}` : ''}) — please tell the owner.`);
    }
    // Also put it on the Known bugs list as "To review" (without the name), so other members can press
    // "I have this too" while the owner is away, instead of sending the same report again.
    try {
        if ((await redis(['HLEN', KNOWN])) < 60) {
            const title = (description.split(/[.!?\n]/)[0].trim() || description).slice(0, 80);
            const id = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
            await redis(['HSET', KNOWN, id, JSON.stringify({ id, title, note: `Reported on: ${page}`, status: 'review', createdAt: Date.now(), reporters: [playerId] })]);
        }
    } catch (e) { /* the Discord message was sent — the list entry is a bonus */ }
    return { ok: true };
}

module.exports = { sendBugReport, bugsHandle };

// ---- Known bugs: a short list leaders keep of problems that are already known, so members can check it
// before reporting (and press "I have this too" instead of sending another report). One hash in Redis,
// one JSON entry per bug: { id, title, note, status: 'known'|'fixing'|'fixed', createdAt, reporters: [playerId] }.
const KNOWN = 'wwl:known-bugs';
const STATUSES = ['review', 'known', 'fixing', 'fixed']; // review = sent in through the site, not yet looked at by a leader

async function bugsHandle(action, body, { redis, playerId }) {
    const flat = (await redis(['HGETALL', KNOWN])) || [];
    const all = {};
    for (let i = 0; i < flat.length; i += 2) { try { all[flat[i]] = JSON.parse(flat[i + 1]); } catch (e) { /* skip */ } }
    const save = (b) => redis(['HSET', KNOWN, b.id, JSON.stringify(b)]);

    if (action === 'bugs-list') {
        const order = { review: 0, fixing: 1, known: 2, fixed: 3 };
        const bugs = Object.values(all).map(b => ({ id: b.id, title: b.title, note: b.note, status: b.status, createdAt: b.createdAt, count: (b.reporters || []).length, mine: (b.reporters || []).includes(playerId) }))
            .sort((a, b) => order[a.status] - order[b.status] || b.createdAt - a.createdAt);
        return { bugs };
    }

    if (action === 'bugs-metoo') { // toggles "I have this too" for the caller — no Discord message
        const b = all[String(body.id)];
        if (!b) throw new Error('That bug is no longer on the list.');
        b.reporters = b.reporters || [];
        const at = b.reporters.indexOf(playerId);
        if (at >= 0) b.reporters.splice(at, 1); else b.reporters.push(playerId);
        await save(b);
        return { ok: true };
    }

    // below: leaders only (checked by the caller)
    if (action === 'bugs-add') {
        const title = String(body.title || '').trim().slice(0, 80);
        if (title.length < 3) throw new Error('Give the bug a short title.');
        if (Object.keys(all).length >= 60) throw new Error('The list is full — delete some old bugs first.');
        const b = { id: `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, title, note: String(body.note || '').trim().slice(0, 400),
            status: STATUSES.includes(body.status) ? body.status : 'known', createdAt: Date.now(), reporters: [] };
        await save(b);
        return { ok: true };
    }
    if (action === 'bugs-status') {
        const b = all[String(body.id)];
        if (!b || !STATUSES.includes(body.status)) throw new Error('Unknown bug or status.');
        b.status = body.status; await save(b);
        return { ok: true };
    }
    if (action === 'bugs-delete') {
        await redis(['HDEL', KNOWN, String(body.id)]);
        return { ok: true };
    }
    throw new Error('Unknown action');
}
