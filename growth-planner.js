// growth-planner.js — the "Growth planner" page under Training: how long a person takes to reach total-stat targets, phase by phase
// ("up to 100k, then up to 250k"), for any member and for leaders making templates. It follows the real gym progression (the gym you are
// in depends on the energy you have spent, with that gym's dots per stat), the monthly Steadfast perk rotation, and a split of the energy
// over the four stats. The gain formula is ArcaneReaper's Compounding Gains Simulator (default) or the Torn wiki's gym formula.
// Backend: gym-growth-* actions in lib/gymStats.js (a member's own plan, the faction's templates).
'use strict';

const GP_STATS = ['strength', 'defense', 'speed', 'dexterity']; // the order of every four-number list below
const GP_LABEL = { strength: 'Strength', defense: 'Defense', speed: 'Speed', dexterity: 'Dexterity' };
const GP_COLOR = '#a01fa8';
// the standard gyms from the Torn wiki: dots per stat (strength, defense, speed, dexterity; null = that stat cannot be trained there) and the
// total energy you need to have spent to unlock the next gym. Specialist gyms are left out.
const GP_GYMS = [
    ['Premier Fitness', 2, 2, 2, 2, 200], ['Average Joes', 2.4, 2.8, 2.4, 2.4, 500], ["Woody's Workout", 2.8, 3, 3.2, 2.8, 1000], ['Beach Bods', 3.2, 3.2, 3.2, null, 2000],
    ['Silver Gym', 3.4, 3.4, 3.6, 3.2, 2750], ['Pour Femme', 3.4, 3.6, 3.6, 3.8, 3000], ['Davies Den', 3.7, 3.7, null, 3.7, 3500], ['Global Gym', 4, 4, 4, 4, 4000],
    ['Knuckle Heads', 4.8, 4, 4.4, 4.2, 6000], ['Pioneer Fitness', 4.4, 4.8, 4.5, 4.4, 7000], ['Anabolic Anomalies', 5, 5.2, 4.5, 4.5, 8000], ['Core', 5, 5, 5.2, 5, 11000],
    ['Racing Fitness', 5, 4.8, 5.4, 5.2, 12420], ['Complete Cardio', 5.5, 5.5, 5.8, 5.2, 18000], ['Legs, Bums and Tums', null, 5.6, 5.6, 5.8, 18100], ['Deep Burn', 6, 6, 6, 6, 24140],
    ['Apollo Gym', 6, 6.4, 6.2, 6.2, 31260], ['Gun Shop', 6.6, 6.2, 6.4, 6.2, 36610], ['Force Training', 6.4, 6.4, 6.6, 6.8, 46640], ["Cha Cha's", 6.4, 6.8, 6.4, 7, 56520],
    ['Atlas', 7, 6.4, 6.4, 6.6, 67775], ['Last Round', 6.8, 7, 6.6, 6.6, 84535], ['The Edge', 6.8, 7, 7, 6.8, 106305], ["George's", 7.3, 7.3, 7.3, 7.3, Infinity],
].map(g => ({ name: g[0], dots: [g[1], g[2], g[3], g[4]], next: g[5] }));
// Steadfast: per calendar month the two stats on the top perk (8%) first, then the two on the lower one (3%); order strength, defense, speed, dexterity
const GP_STEADFAST = [['speed', 'dexterity', 'strength', 'defense'], ['dexterity', 'strength', 'defense', 'speed'], ['strength', 'defense', 'speed', 'dexterity'], ['defense', 'speed', 'dexterity', 'strength']];
const gpSteadfast = (stat, month) => { const order = GP_STEADFAST[month % 4], i = order.indexOf(stat); return i < 0 ? 0 : i < 2 ? 8 : 3; };

// gain per energy, per gym dot: ArcaneReaper's formula or the Torn wiki's (Vladar's) formula
function gpPerEnergy(model, stat, happy) {
    if (model === 'wiki') return (3.480061091e-7 * Math.log(happy + 250) + 3.091619094e-6) * stat + 6.82775184551527e-5 * (happy + 250) - 0.0301431777;
    return 4 * ((0.00019106 * stat) + (0.00226263 * happy) + 0.55) / 150;
}
// the dots of stat i in the gym you are in after cumE energy spent (a stat the gym cannot train takes the dots of the gym before it)
function gpDots(i, cumE) {
    let g = 0; while (g < GP_GYMS.length - 1 && cumE >= GP_GYMS[g].next) g++;
    for (let k = g; k >= 0; k--) if (GP_GYMS[k].dots[i] != null) return GP_GYMS[k].dots[i];
    return 2;
}

// run a plan: day by day, each stat gets its share of the day's energy; a phase ends the day the total reaches its target
function gpRun(plan, startMs) {
    const stats = plan.start.slice(), sum = plan.split.reduce((a, b) => a + b, 0) || 4, split = plan.split.map(s => (plan.split.reduce((a, b) => a + b, 0) ? s : 1) / sum);
    let cumE = plan.gym > 0 ? GP_GYMS[Math.min(plan.gym, GP_GYMS.length - 1) - 1].next : 0;
    const out = { phases: [], series: [[0, stats.reduce((a, b) => a + b, 0)]], capped: false };
    let p = 0, day = 0;
    const MAX = 20000, mark = () => stats.reduce((a, b) => a + b, 0);
    while (p < plan.phases.length && out.phases.length < plan.phases.length) {
        while (p < plan.phases.length && mark() >= plan.phases[p].target) { out.phases.push({ target: plan.phases[p].target, day, start: out.phases.length ? out.phases[out.phases.length - 1].day : 0 }); p++; }
        if (p >= plan.phases.length) break;
        if (day >= MAX) { out.capped = true; break; }
        const f = plan.phases[p], month = new Date(startMs + day * 86400e3).getUTCMonth();
        const gains = stats.map((s, i) => {
            const e = f.energy * split[i], dots = f.dots || gpDots(i, cumE), perk = 1 + ((plan.rotation ? gpSteadfast(GP_STATS[i], month) : 0) + plan.extra) / 100;
            return Math.max(0, gpPerEnergy(plan.model, s, f.happy)) * dots * e * perk;
        });
        gains.forEach((g, i) => { stats[i] += g; });
        cumE += f.energy; day++;
        out.series.push([day, mark()]);
    }
    for (const ph of out.phases) { ph.days = ph.day - ph.start; ph.date = startMs + ph.day * 86400e3; }
    return out;
}

// ---- the page ----
const gpN = n => Math.round(n).toLocaleString();
const gpShort = n => { const a = Math.abs(n); return a >= 1e9 ? (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'b' : a >= 1e6 ? (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'm' : a >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.?0+$/, '') + 'k' : String(Math.round(n)); };
const gpParse = s => { const m = String(s).trim().replace(/,/g, '').toLowerCase().match(/^([\d.]+)\s*([kmb]?)$/); return m ? parseFloat(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[m[2]] || 1) : NaN; };
const gpDate = ms => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const gpClone = o => JSON.parse(JSON.stringify(o));
async function gpFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}

// ready-made examples, so a standard new member can be simulated at once (a leader can save their own as faction templates)
const GP_BUILTIN = [
    { name: 'Standard new member: to 100k total, about 2,200 energy a week', desc: 'A new member who trains about 315 energy a day.', start: [250, 250, 250, 250], split: [25, 25, 25, 25], gym: 0, rotation: true, extra: 0, model: 'arcane', phases: [{ target: 100000, energy: 315, happy: 5025, dots: null }] },
    { name: 'Standard new member: to 100k, then 250k, about 4,400 energy a week', desc: 'A new member who trains about 630 energy a day.', start: [250, 250, 250, 250], split: [25, 25, 25, 25], gym: 0, rotation: true, extra: 0, model: 'arcane', phases: [{ target: 100000, energy: 630, happy: 5025, dots: null }, { target: 250000, energy: 630, happy: 5025, dots: null }] },
];
let gp = { plan: gpClone(GP_BUILTIN[1]), templates: [], mine: null, leader: false, loaded: false, picked: 'b1' };

async function loadGrowthPlanner() {
    const st = $('gp-status');
    if (st) { st.className = 'status ok'; st.textContent = 'Loading…'; }
    const r = await gpFetch({ action: 'gym-growth-get' });
    if (r.error) { if (st) { st.className = 'status err'; st.textContent = r.error; } }
    else { gp.templates = r.templates || []; gp.mine = r.mine || null; gp.leader = !!r.leader; if (st) { st.textContent = ''; st.className = 'status'; } }
    if (!gp.loaded) { gp.loaded = true; if (gp.mine && gp.mine.phases && gp.mine.phases.length) { gp.plan = gpClone(gp.mine); gp.picked = 'me'; } }
    renderGpShell(); renderGpOut();
}

function gpOptions() {
    return `<optgroup label="Examples">${GP_BUILTIN.map((t, i) => `<option value="b${i}" ${gp.picked === 'b' + i ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</optgroup>`
        + (gp.templates.length ? `<optgroup label="Faction templates">${gp.templates.map((t, i) => `<option value="t${i}" ${gp.picked === 't' + i ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</optgroup>` : '')
        + (gp.mine ? `<option value="me" ${gp.picked === 'me' ? 'selected' : ''}>My saved plan${gp.mine.name ? ': ' + esc(gp.mine.name) : ''}</option>` : '');
}

function renderGpShell() {
    const box = $('gp-shell'); if (!box) return;
    const p = gp.plan;
    const field = (id, label, v, cls, w) => `<div class="field" style="margin:0;min-width:${w || 120}px;flex:1;"><label for="${id}">${label}</label><input id="${id}" class="${cls || ''}" type="text" inputmode="decimal" autocomplete="off" value="${esc(v)}"></div>`;
    box.innerHTML = `
        <div class="panel">
            <h3 style="margin:0 0 8px;">Plans</h3>
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
                <div class="field" style="margin:0;min-width:260px;flex:2;"><label for="gp-pick">Start from</label><select id="gp-pick">${gpOptions()}</select></div>
                <div class="field" style="margin:0;min-width:200px;flex:1;"><label for="gp-name">Name (to save)</label><input id="gp-name" maxlength="60" value="${esc(p.name || '')}" placeholder="e.g. New member to 100k"></div>
                <button class="ghost small" id="gp-save-mine">Save as my plan</button>
                ${gp.leader ? '<button class="ghost small" id="gp-save-tpl">Save as faction template</button>' : ''}
                ${gp.leader && /^t\d+$/.test(gp.picked) ? '<button class="ghost small" id="gp-del-tpl" style="color:var(--danger);">Delete this template</button>' : ''}
            </div>
            ${p.desc ? `<p style="color:var(--muted);font-size:12px;margin:8px 0 0;">${esc(p.desc)}</p>` : ''}
        </div>
        <div class="panel">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;"><h3 style="margin:0;">Who and how</h3><button class="ghost small" id="gp-mine-stats" style="margin-left:auto;">Use my current stats</button></div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">${GP_STATS.map((s, i) => field(`gp-s${i}`, `${GP_LABEL[s]} now`, gpN(p.start[i]), 'gp-start', 110)).join('')}</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">${GP_STATS.map((s, i) => field(`gp-e${i}`, `Energy to ${GP_LABEL[s]} (%)`, p.split[i], 'gp-split', 110)).join('')}</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
                <div class="field" style="margin:0;min-width:200px;flex:1;"><label for="gp-gym">Gym they are in now</label><select id="gp-gym">${GP_GYMS.map((g, i) => `<option value="${i}" ${p.gym === i ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></div>
                ${field('gp-extra', 'Other faction gym bonus (%)', p.extra, '', 140)}
                <div class="field" style="margin:0;min-width:200px;flex:1;"><label for="gp-model">Gain formula</label><select id="gp-model"><option value="arcane" ${p.model === 'arcane' ? 'selected' : ''}>ArcaneReaper's simulator</option><option value="wiki" ${p.model === 'wiki' ? 'selected' : ''}>Torn wiki formula</option></select></div>
                <label style="display:flex;gap:6px;align-items:center;font-size:13px;cursor:pointer;margin-bottom:8px;"><input type="checkbox" id="gp-rot" style="width:auto;" ${p.rotation ? 'checked' : ''}> Follow the monthly Steadfast perk</label>
            </div>
        </div>
        <div class="panel">
            <h3 style="margin:0 0 4px;">Phases</h3>
            <p style="color:var(--muted);font-size:12px;margin:0 0 8px;">Each phase runs until the total reaches its target. Leave "Dots" empty to follow the gym progression, or type a number to use the same dots everywhere.</p>
            ${p.phases.map((f, i) => `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:8px;" data-i="${i}">
                <span style="min-width:62px;font-weight:700;padding-bottom:9px;">Phase ${i + 1}</span>
                ${field(`gp-t${i}`, 'Up to total stats', gpN(f.target), 'gp-ph', 130)}${field(`gp-en${i}`, 'Energy per day', f.energy, 'gp-ph', 110)}${field(`gp-h${i}`, 'Happy', f.happy, 'gp-ph', 90)}${field(`gp-d${i}`, 'Dots (optional)', f.dots || '', 'gp-ph', 90)}
                <button class="ghost small gp-ph-del" style="color:var(--danger);margin-bottom:2px;">✕</button></div>`).join('')}
            <button class="ghost small" id="gp-ph-add">+ Add a phase</button>
        </div>`;
    const sync = () => { gpRead(); renderGpOut(); };
    box.querySelectorAll('input.gp-start, input.gp-split, input.gp-ph, #gp-extra, #gp-name').forEach(el => el.addEventListener('input', sync));
    box.querySelectorAll('input.gp-start, input.gp-ph').forEach(el => el.addEventListener('blur', () => { const v = gpParse(el.value); if (!isNaN(v) && /^gp-(s|t|h)/.test(el.id)) el.value = gpN(v); }));
    ['gp-gym', 'gp-model', 'gp-rot'].forEach(id => $(id).addEventListener('change', sync));
    $('gp-pick').addEventListener('change', e => { const v = e.target.value; gp.picked = v; const src = v[0] === 'b' ? GP_BUILTIN[+v.slice(1)] : v[0] === 't' ? gp.templates[+v.slice(1)] : gp.mine; if (src) gp.plan = gpClone(src); renderGpShell(); renderGpOut(); });
    $('gp-ph-add').addEventListener('click', () => { gpRead(); const last = gp.plan.phases[gp.plan.phases.length - 1] || { target: 100000, energy: 630, happy: 5025 }; gp.plan.phases.push({ target: last.target * 2.5, energy: last.energy, happy: last.happy, dots: null }); renderGpShell(); renderGpOut(); });
    box.querySelectorAll('.gp-ph-del').forEach(b => b.addEventListener('click', () => { gpRead(); if (gp.plan.phases.length > 1) gp.plan.phases.splice(+b.closest('[data-i]').dataset.i, 1); renderGpShell(); renderGpOut(); }));
    $('gp-mine-stats').addEventListener('click', async () => {
        const r = await gpFetch({ action: 'gym-snapshot' }); const last = r.history && r.history[r.history.length - 1];
        if (!last) { toast('Your battle stats could not be read yet.'); return; }
        gpRead(); gp.plan.start = [last[1], last[2], last[3], last[4]]; renderGpShell(); renderGpOut();
    });
    $('gp-save-mine').addEventListener('click', async () => { gpRead(); const r = await gpFetch({ action: 'gym-growth-save', plan: gp.plan }); if (r.error) { toast(r.error); return; } gp.mine = r.plan; gp.picked = 'me'; toast('Saved as your plan'); renderGpShell(); renderGpOut(); });
    const saveTpl = $('gp-save-tpl');
    if (saveTpl) saveTpl.addEventListener('click', async () => {
        gpRead(); if (!gp.plan.name.trim()) { toast('Give the template a name first.'); return; }
        const list = gp.templates.filter(t => t.name !== gp.plan.name).concat([gpClone(gp.plan)]);
        const r = await gpFetch({ action: 'gym-growth-templates-save', templates: list }); if (r.error) { toast(r.error); return; }
        gp.templates = r.templates; gp.picked = 't' + gp.templates.findIndex(t => t.name === gp.plan.name); toast('Saved as a faction template'); renderGpShell(); renderGpOut();
    });
    const del = $('gp-del-tpl');
    if (del) del.addEventListener('click', async () => {
        if (!confirm('Delete this faction template?')) return;
        const list = gp.templates.filter((t, i) => 't' + i !== gp.picked);
        const r = await gpFetch({ action: 'gym-growth-templates-save', templates: list }); if (r.error) { toast(r.error); return; }
        gp.templates = r.templates; gp.picked = 'b1'; gp.plan = gpClone(GP_BUILTIN[1]); toast('Template deleted'); renderGpShell(); renderGpOut();
    });
}

// read the typed values back into the plan (numbers with k / m / b shorthand are understood)
function gpRead() {
    const p = gp.plan, num = (id, d) => { const v = gpParse($(id).value); return isNaN(v) ? d : v; };
    p.name = $('gp-name').value;
    p.start = GP_STATS.map((s, i) => num(`gp-s${i}`, p.start[i]));
    p.split = GP_STATS.map((s, i) => Math.max(0, num(`gp-e${i}`, p.split[i])));
    p.gym = +$('gp-gym').value; p.extra = Math.max(0, num('gp-extra', p.extra)); p.model = $('gp-model').value; p.rotation = $('gp-rot').checked;
    p.phases = p.phases.map((f, i) => ({ target: Math.max(1, num(`gp-t${i}`, f.target)), energy: Math.max(1, num(`gp-en${i}`, f.energy)), happy: Math.max(100, num(`gp-h${i}`, f.happy)), dots: $(`gp-d${i}`).value.trim() ? Math.max(1, num(`gp-d${i}`, f.dots || 5)) : null }));
}

function renderGpOut() {
    const out = $('gp-out'); if (!out) return;
    const p = gp.plan, startMs = Date.now(), run = gpRun(p, startMs), total0 = p.start.reduce((a, b) => a + b, 0);
    const last = run.series[run.series.length - 1], end = run.phases[run.phases.length - 1];
    const W = 900, H = 260, L = 62, R = 14, T = 12, B = 28, days = Math.max(1, last[0]), maxV = Math.max(1, last[1], ...p.phases.map(f => f.target)) * 1.05;
    const x = d => L + d / days * (W - L - R), y = v => T + (1 - v / maxV) * (H - T - B);
    let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;">`;
    for (let i = 0; i <= 4; i++) { const v = maxV * i / 4; svg += `<line x1="${L}" y1="${y(v)}" x2="${W - R}" y2="${y(v)}" stroke="currentColor" stroke-opacity=".12"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="currentColor" fill-opacity=".6">${gpShort(v)}</text>`; }
    for (let i = 0; i <= 5; i++) { const d = days * i / 5; svg += `<text x="${x(d)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="currentColor" fill-opacity=".6">day ${Math.round(d).toLocaleString()}</text>`; }
    for (const ph of run.phases) if (ph.day > 0) svg += `<line x1="${x(ph.day)}" y1="${T}" x2="${x(ph.day)}" y2="${H - B}" stroke="#6b7280" stroke-dasharray="5 4"/><text x="${x(ph.day) - 4}" y="${T + 12}" text-anchor="end" font-size="11" fill="currentColor" fill-opacity=".7">${gpShort(ph.target)}</text>`;
    const step = Math.max(1, Math.ceil(run.series.length / 320));
    svg += `<polyline points="${run.series.filter((s, i) => i % step === 0 || i === run.series.length - 1).map(s => `${x(s[0]).toFixed(1)},${y(s[1]).toFixed(1)}`).join(' ')}" fill="none" stroke="${GP_COLOR}" stroke-width="2"/></svg>`;
    out.innerHTML = `<div class="panel">
        <h3 style="margin:0 0 8px;">Result</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:10px;">
            <div style="background:var(--bench-2);border-radius:6px;padding:10px 12px;"><div style="color:var(--muted);font-size:12px;">Total time</div><div style="font-size:26px;font-weight:700;">${run.capped ? '20,000+ days' : `${gpN(end ? end.day : 0)} days`}</div><div style="color:var(--muted);font-size:11px;">${run.capped ? '' : end ? `${gpDate(end.date)}, about ${(end.day / 30.44).toFixed(1)} months` : ''}</div></div>
            <div style="background:var(--bench-2);border-radius:6px;padding:10px 12px;"><div style="color:var(--muted);font-size:12px;">From</div><div style="font-size:26px;font-weight:700;">${gpShort(total0)}</div><div style="color:var(--muted);font-size:11px;">total stats today</div></div>
            <div style="background:var(--bench-2);border-radius:6px;padding:10px 12px;"><div style="color:var(--muted);font-size:12px;">To</div><div style="font-size:26px;font-weight:700;">${gpShort(p.phases[p.phases.length - 1].target)}</div><div style="color:var(--muted);font-size:11px;">${p.phases.length} phase${p.phases.length === 1 ? '' : 's'}</div></div>
        </div>
        ${svg}
        <table style="width:100%;font-size:13px;border-collapse:collapse;margin-top:10px;"><tr style="color:var(--muted);font-size:12px;text-align:left;"><td>Phase</td><td>Up to</td><td style="text-align:right;">Days</td><td style="text-align:right;">Reached on</td></tr>
        ${p.phases.map((f, i) => { const ph = run.phases[i]; return `<tr style="border-top:1px solid var(--line);"><td style="padding:5px 4px;">${i + 1}</td><td style="padding:5px 4px;font-weight:600;">${gpShort(f.target)}</td><td style="padding:5px 4px;text-align:right;font-family:var(--mono);">${ph ? (ph.days === 0 && i === 0 && ph.day === 0 ? 'already' : gpN(ph.days)) : '—'}</td><td style="padding:5px 4px;text-align:right;color:var(--muted);">${ph ? gpDate(ph.date) : 'not within 20,000 days'}</td></tr>`; }).join('')}</table>
        <p style="color:var(--muted);font-size:12px;margin:10px 0 0;">An estimate. It follows the gym progression and splits the energy over the four stats as set above. It does not include happy jumps or energy lost to other things, so people who jump a lot will be faster. The gain formula is ArcaneReaper's Compounding Gains Simulator; you can switch to the Torn wiki's formula to compare.</p>
    </div>`;
}
