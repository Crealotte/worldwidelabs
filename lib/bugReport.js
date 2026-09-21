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
const MAX_VIDEO_BYTES = 3 * 1024 * 1024;
const MAX_STORED_SHOT = 500 * 1024; // a screenshot up to this size is kept with the known bug so everyone can view it

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
    // Optional screen recording: a short clip sent by the page as a data URL (the server accepts about 4 MB in total).
    let video = null;
    const vm = /^data:video\/(mp4|webm|quicktime);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.video || ''));
    if (vm) {
        const vbuf = Buffer.from(vm[2], 'base64');
        if (vbuf.length > MAX_VIDEO_BYTES) throw new Error('That recording is too big — keep it under about 3 MB (a short clip), or upload it somewhere and paste the link in your description.');
        video = { buf: vbuf, type: `video/${vm[1]}`, name: `recording.${vm[1] === 'quicktime' ? 'mov' : vm[1]}` };
    }

    const payload = { content, allowed_mentions: { parse: [] } };
    const url = WEBHOOK_RE.test(webhook) ? `${webhook}?wait=true` : `${DISCORD_API}/channels/${channel}/messages`;
    const headers = WEBHOOK_RE.test(webhook) ? {} : { Authorization: `Bot ${token}` };
    let res;
    const files = [file, video].filter(Boolean);
    if (files.length) {
        const form = new FormData();
        form.append('payload_json', JSON.stringify(payload));
        files.forEach((fl, i) => form.append(`files[${i}]`, new Blob([fl.buf], { type: fl.type }), fl.name));
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
            const hasShot = !!(file && file.buf.length <= MAX_STORED_SHOT);
            if (hasShot) await redis(['SET', shotKey(id), `data:${file.type};base64,${file.buf.toString('base64')}`, 'EX', 90 * 86400]);
            await redis(['HSET', KNOWN, id, JSON.stringify({ id, title, note: `Reported on: ${page}`, status: 'review', createdAt: Date.now(), reporters: [playerId], shot: hasShot, detail: description, byName: String(name || '') })]);
        }
    } catch (e) { /* the Discord message was sent — the list entry is a bonus */ }
    return { ok: true };
}

module.exports = { sendBugReport, bugsHandle };

// ---- Known bugs: a short list leaders keep of problems that are already known, so members can check it
// before reporting (and press "I have this too" instead of sending another report). One hash in Redis,
// one JSON entry per bug: { id, title, note, status: 'known'|'fixing'|'fixed', createdAt, reporters: [playerId] }.
const KNOWN = 'wwl:known-bugs';
const shotKey = id => `wwl:bug-shot:${id}`; // the screenshot of a known bug, as a data URL
const STATUSES = ['review', 'known', 'fixing', 'fixed']; // review = sent in through the site, not yet looked at by a leader

async function bugsHandle(action, body, { redis, playerId, leader = false }) {
    const flat = (await redis(['HGETALL', KNOWN])) || [];
    const all = {};
    for (let i = 0; i < flat.length; i += 2) { try { all[flat[i]] = JSON.parse(flat[i + 1]); } catch (e) { /* skip */ } }
    const save = (b) => redis(['HSET', KNOWN, b.id, JSON.stringify(b)]);

    if (action === 'bugs-list') {
        const order = { review: 0, fixing: 1, known: 2, fixed: 3 };
        const bugs = Object.values(all).map(b => ({ id: b.id, title: b.title, note: b.note, status: b.status, createdAt: b.createdAt, hasShot: !!b.shot, detail: leader ? b.detail || '' : undefined, by: leader ? b.byName || '' : undefined, count: (b.reporters || []).length, mine: (b.reporters || []).includes(playerId) }))
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

    if (action === 'bugs-shot') { // the screenshot of one known bug, for anyone to view
        const b = all[String(body.id)];
        if (!b || !b.shot) throw new Error('No screenshot for this bug.');
        return { shot: await redis(['GET', shotKey(b.id)]) };
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
        await redis(['DEL', shotKey(String(body.id))]);
        return { ok: true };
    }
    throw new Error('Unknown action');
}

// ---- Suggestions: members propose ideas, everyone can vote thumbs up / down; leaders set a status.
// One hash, one JSON entry per idea: { id, text, status: 'open'|'planned'|'done'|'declined', createdAt, by, name, votes: { playerId: 1|-1 } }.
const SUGG = 'wwl:suggestions';
const SUGG_STATUSES = ['open', 'planned', 'done', 'declined'];

async function suggestHandle(action, body, { redis, playerId, name, isLeader }) {
    const flat = (await redis(['HGETALL', SUGG])) || [];
    const all = {};
    for (let i = 0; i < flat.length; i += 2) { try { all[flat[i]] = JSON.parse(flat[i + 1]); } catch (e) { /* skip */ } }
    const save = (s) => redis(['HSET', SUGG, s.id, JSON.stringify(s)]);

    if (action === 'sug-list') {
        const order = { planned: 0, open: 1, done: 2, declined: 3 };
        const list = Object.values(all).map(s => {
            const v = Object.values(s.votes || {});
            return { id: s.id, text: s.text, status: s.status, createdAt: s.createdAt, up: v.filter(x => x === 1).length, down: v.filter(x => x === -1).length,
                mine: (s.votes || {})[playerId] || 0, own: s.by === playerId, by: isLeader ? s.name : undefined };
        }).sort((a, b) => order[a.status] - order[b.status] || (b.up - b.down) - (a.up - a.down) || b.createdAt - a.createdAt);
        return { suggestions: list };
    }
    if (action === 'sug-add') {
        const text = String(body.text || '').trim();
        if (text.length < 10) throw new Error('Please describe your idea in a bit more detail (at least a sentence).');
        if (text.length > 600) throw new Error('That is too long — please keep it under 600 characters.');
        if (Object.keys(all).length >= 100) throw new Error('The suggestion list is full — please try again later.');
        const rateKey = `wwl:sug-rate:${playerId}`;
        const count = await redis(['INCR', rateKey]);
        if (count === 1) await redis(['EXPIRE', rateKey, 3600]);
        if (count > 5) throw new Error('You have sent 5 suggestions in the last hour — please try again a bit later.');
        const s = { id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, text, status: 'open', createdAt: Date.now(), by: playerId, name: String(name || ''), votes: { [playerId]: 1 } };
        await save(s);
        return { ok: true };
    }
    if (action === 'sug-vote') { // vote 1 (up), -1 (down); pressing the same one again takes the vote back
        const s = all[String(body.id)];
        if (!s) throw new Error('That suggestion is no longer on the list.');
        const v = Number(body.vote) === -1 ? -1 : 1;
        s.votes = s.votes || {};
        if (s.votes[playerId] === v) delete s.votes[playerId]; else s.votes[playerId] = v;
        await save(s);
        return { ok: true };
    }
    // below: leaders only (checked by the caller)
    if (action === 'sug-status') {
        const s = all[String(body.id)];
        if (!s || !SUGG_STATUSES.includes(body.status)) throw new Error('Unknown suggestion or status.');
        s.status = body.status; await save(s);
        return { ok: true };
    }
    if (action === 'sug-delete') {
        await redis(['HDEL', SUGG, String(body.id)]);
        return { ok: true };
    }
    throw new Error('Unknown action');
}
module.exports.suggestHandle = suggestHandle;
