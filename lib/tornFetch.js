// lib/tornFetch.js — every call to Torn's API from the server goes through here. It does three things:
//   1. REMEMBERS answers that hardly ever change (who a key belongs to, whether it has faction access, the member list, ...)
//      in the database for a few minutes, so opening a page doesn't ask Torn the same question again and again;
//   2. tries ONCE more, after a short pause, when Torn says "too many requests" (error code 5), instead of failing right away;
//   3. COUNTS every call per key (a scrambled fingerprint of it, never the key) per minute and per kind of call, so we can
//      see where the calls go — the leader-only "Torn API usage" panel reads these counters (action 'torn-usage').
// It returns a normal Response, so the callers keep doing `await (await tornFetch(url)).json()` like with fetch.

const crypto = require('crypto');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

// What is remembered, and for how many seconds: [pattern of the URL, label, seconds]
const RULES = [
    [/\/user\/\?selections=profile&/, 'user:profile', 600],
    [/\/v2\/faction\/balance\?/, 'v2:faction/balance', 600],
    [/\/v2\/faction\/members\?/, 'v2:faction/members', 600],
    [/\/faction\/\?selections=basic&/, 'faction:basic', 600],
    [/\/v2\/faction\?selections=rankedwars&/, 'v2:faction/rankedwars', 300],
];
const NO_ACCESS_SECONDS = 180; // "your key can't do this" is remembered shorter, so a promoted leader isn't kept waiting

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function pipeline(commands) { // best effort: a problem with the database must never break a Torn call
    if (!REDIS_URL || !REDIS_TOKEN || !commands.length) return null;
    try {
        const res = await fetch(`${REDIS_URL}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(commands) });
        return await res.json();
    } catch (e) { return null; }
}

function labelOf(url) {
    try {
        const u = new URL(url);
        const path = u.pathname.replace(/^\/+|\/+$/g, '').replace(/\/\d+(?=\/|$)/g, '/#');
        const sel = u.searchParams.get('selections');
        return sel ? `${path}?${sel.slice(0, 40)}` : path;
    } catch (e) { return 'unknown'; }
}
const keyOf = url => { try { return new URL(url).searchParams.get('key') || ''; } catch (e) { return ''; } };
const stamp = (d = new Date()) => d.toISOString().replace(/[-:T]/g, '').slice(0, 12); // YYYYMMDDHHMM (UTC)

function count(kh, label, cached) {
    const now = new Date(), minute = stamp(now), day = minute.slice(0, 8);
    const cmds = [['HINCRBY', `wwl:tc:d:${kh}:${day}`, cached ? `${label} (saved)` : label, 1], ['EXPIRE', `wwl:tc:d:${kh}:${day}`, 3 * 86400]];
    if (!cached) cmds.push(['INCR', `wwl:tc:m:${kh}:${minute}`], ['EXPIRE', `wwl:tc:m:${kh}:${minute}`, 6 * 3600]);
    return pipeline(cmds);
}

const isRateLimit = text => /"code"\s*:\s*5\b/.test(text) || /too many requests/i.test(text);
const asResponse = (text, status) => new Response(text, { status, headers: { 'content-type': 'application/json' } });

async function tornFetch(url, opts) {
    const key = keyOf(url), kh = sha(key).slice(0, 8), label = labelOf(url);
    const rule = RULES.find(r => r[0].test(url));
    const cacheKey = rule ? `wwl:tc:c:${sha(url)}` : null;

    if (cacheKey) {
        const hit = (await pipeline([['GET', cacheKey]]))?.[0]?.result;
        if (hit) { await count(kh, rule[1], true); return asResponse(hit, 200); }
    }
    await count(kh, label, false);
    let res = await fetch(url, opts);
    let text = await res.text();
    if (isRateLimit(text)) { // one more try after a pause
        await sleep(1500);
        await count(kh, `${label} (retry)`, false);
        res = await fetch(url, opts);
        text = await res.text();
    }
    if (cacheKey && res.ok) {
        let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ }
        if (json && !json.error) await pipeline([['SET', cacheKey, text, 'EX', rule[2]]]);
        else if (json?.error && Number(json.error.code) === 16) await pipeline([['SET', cacheKey, text, 'EX', NO_ACCESS_SECONDS]]);
    }
    return asResponse(text, res.status);
}

// For the usage panel: the last `minutes` minutes of calls for one key, and today's calls per kind.
async function usageFor(key, minutes = 120) {
    const kh = sha(key).slice(0, 8), now = Date.now();
    const stamps = Array.from({ length: minutes }, (_, i) => stamp(new Date(now - i * 60000)));
    const day = stamp().slice(0, 8), yesterday = stamp(new Date(now - 86400000)).slice(0, 8);
    const r = await pipeline([['MGET', ...stamps.map(s => `wwl:tc:m:${kh}:${s}`)], ['HGETALL', `wwl:tc:d:${kh}:${day}`], ['HGETALL', `wwl:tc:d:${kh}:${yesterday}`]]);
    const perMinute = (r?.[0]?.result || []).map((v, i) => ({ minute: stamps[i], n: Number(v) || 0 }));
    const kinds = list => { const o = {}; for (let i = 0; i < (list || []).length; i += 2) o[list[i]] = Number(list[i + 1]); return o; };
    return { perMinute, today: kinds(r?.[1]?.result), yesterday: kinds(r?.[2]?.result) };
}

module.exports = { tornFetch, usageFor };
