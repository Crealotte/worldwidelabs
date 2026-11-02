// lib/ocrules.js — which success chance a member may have to join an organized crime of each level. The Labs Assistant reads these rules and greys out the Join button of a slot outside
// the range, with the reason. Leaders set them (Leader settings); everybody's script reads them.
//
//   wwl:oc-rules:<factionId>   JSON { members: bool, leaders: bool, levels: { '1': { min, max }, ... } }
//     members / leaders   whether the rules apply to members / to leaders (a leader can switch either off)
//     levels              per OC level the lowest and highest chance allowed, both included; a level that is not in the list has no rule
//
// The first setup of CoreLabs: levels 1 and 2 are the entry levels (below 85%), 3 to 5 want 70 to 85%, level 6 wants at least 70%.

const KEY = f => `wwl:oc-rules:${f}`;
const MAX_LEVEL = 10;
const DEFAULT = { members: true, leaders: true, levels: { 1: { min: 0, max: 85 }, 2: { min: 0, max: 85 }, 3: { min: 70, max: 85 }, 4: { min: 70, max: 85 }, 5: { min: 70, max: 85 }, 6: { min: 70, max: 100 } }, crimes: { 'bidding war': { min: 50, max: 100 } } };

async function loadRules(redis, factionId) {
    let r = null;
    try { const raw = await redis(['GET', KEY(factionId)]); r = raw ? JSON.parse(raw) : null; } catch (e) { r = null; }
    if (!r || typeof r !== 'object') return JSON.parse(JSON.stringify(DEFAULT));
    return { members: r.members !== false, leaders: r.leaders !== false, levels: r.levels && typeof r.levels === 'object' ? r.levels : {}, crimes: r.crimes && typeof r.crimes === 'object' ? r.crimes : JSON.parse(JSON.stringify(DEFAULT.crimes)) };
}
const pct = v => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null; };

async function ocRulesHandle(action, body, { redis, factionId, leader }) {
    if (action === 'ocrules-get') { // everybody's script: the rules, and whether this member is a leader (which decides which of the two switches counts)
        const r = await loadRules(redis, factionId);
        return { ...r, leader: await leader() };
    }
    if (action === 'ocrules-set') {
        if (!(await leader())) throw new Error('Leaders only.');
        const levels = {};
        for (let l = 1; l <= MAX_LEVEL; l++) {
            const x = body.levels && body.levels[l];
            if (!x) continue;
            const min = x.min === '' || x.min == null ? 0 : pct(x.min), max = x.max === '' || x.max == null ? 100 : pct(x.max);
            if (min == null || max == null) throw new Error(`Level ${l}: the chances must be numbers from 0 to 100.`);
            if (min > max) throw new Error(`Level ${l}: the lowest chance (${min}%) is higher than the highest (${max}%).`);
            if (min === 0 && max === 100) continue; // no limit at all: no rule
            levels[l] = { min, max };
        }
        const crimes = {}; // exceptions for one crime by name (lower case), they win over the level rule
        for (const x of Array.isArray(body.crimes) ? body.crimes.slice(0, 30) : []) {
            const name = String(x && x.name || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60);
            if (!name) continue;
            const min = x.min === '' || x.min == null ? 0 : pct(x.min), max = x.max === '' || x.max == null ? 100 : pct(x.max);
            if (min == null || max == null) throw new Error(`"${name}": the chances must be numbers from 0 to 100.`);
            if (min > max) throw new Error(`"${name}": the lowest chance (${min}%) is higher than the highest (${max}%).`);
            crimes[name] = { min, max };
        }
        const r = { members: body.members !== false, leaders: body.leaders !== false, levels, crimes };
        await redis(['SET', KEY(factionId), JSON.stringify(r)]);
        return { ...r, leader: true };
    }
    throw new Error('Unknown action');
}

module.exports = { ocRulesHandle, loadRules, MAX_LEVEL };
