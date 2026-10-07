// company-staffing.js — the Staffing tab of a company: the owner's own staffing rules for a mine (targets per position, a 14- or 16-person setup, wage
// guidelines) applied to the live employees. Everything here is a GUIDELINE, not a rule: a stronger person can make up for a low stat, a friend may work
// for less, a very good player may be worth matching a higher wage — so it advises and flags, it never blocks. Torn's own efficiency formula is not used.
// The targets and guidelines are stored per company (owner edits; the director can only record EE merits for their people). Backend: co-planner-save.
'use strict';

const STF_STATS = [['manual', 'Manual'], ['intelligence', 'Intelligence'], ['endurance', 'Endurance']];
const STF_DEFAULT = {
    size: 14, mult: 20, multLow: 25, millerCap: 2500000, generalCap: 3000000, bigCap: 4000000, bigCount: 1, meritCost: 40000, merits: {},
    seats: [
        { pos: 'Site Manager', a: 'intelligence', ta: 80000, b: 'endurance', tb: 55000, n: 1, from: 14 },
        { pos: 'Sales Executive', a: 'intelligence', ta: 60000, b: 'endurance', tb: 30000, n: 2, from: 14 },
        { pos: 'Sales Executive', a: 'intelligence', ta: 40000, b: 'endurance', tb: 20000, n: 1, from: 14 },
        { pos: 'Secretary', a: 'intelligence', ta: 35000, b: 'endurance', tb: 50000, n: 1, from: 14 },
        { pos: 'Safety Inspector', a: 'manual', ta: 30000, b: 'intelligence', tb: 50000, n: 1, from: 14 },
        { pos: 'Production Foreman', a: 'manual', ta: 30000, b: 'endurance', tb: 40000, n: 1, from: 14 },
        { pos: 'Mill Operator', a: 'manual', ta: 40000, b: 'endurance', tb: 20000, n: 7, from: 14 },
        { pos: 'Electrician', a: 'manual', ta: 30000, b: 'endurance', tb: 40000, n: 1, from: 16 },
        { pos: 'Mine Engineer', a: 'intelligence', ta: 40000, b: 'endurance', tb: 30000, n: 1, from: 16 },
    ],
};
const stfK = n => n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
const stfM = n => n == null ? '—' : `$${(n / 1e6).toFixed(2)}M`;

function stfPlanner(r) {
    const p = r.company.planner || {};
    return { ...STF_DEFAULT, ...p, seats: (p.seats && p.seats.length) ? p.seats : STF_DEFAULT.seats, merits: p.merits || {} };
}
// the seats of the chosen setup, one entry per chair
function stfSeats(p) { return p.seats.filter(s => s.from <= p.size).flatMap(s => Array.from({ length: s.n }, () => s)); }
// how well a person matches a seat's two target stats: both met = ok; one low but the other high enough to make up for it (average >= 100%) = comp; else short
function stfFit(e, s) {
    const r1 = s.ta ? (e[s.a] || 0) / s.ta : 1, r2 = s.tb ? (e[s.b] || 0) / s.tb : 1;
    const score = (r1 + r2) / 2;
    return { score, state: r1 >= 1 && r2 >= 1 ? 'ok' : score >= 1 ? 'comp' : 'short' };
}
const stfColor = state => state === 'ok' ? 'rgba(53,217,155,.22)' : state === 'comp' ? 'rgba(240,180,50,.22)' : 'rgba(224,85,85,.18)';
// the cheapest way to fill the seats: Hungarian assignment, cost = how far short a person is (heavy), a small cost for big surplus (wasted pay), a small bonus for staying put
function stfAssign(emps, seats) {
    const n = Math.max(emps.length, seats.length);
    if (!n) return [];
    const cost = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= n; i++) for (let j = 1; j <= n; j++) {
        const e = emps[i - 1], s = seats[j - 1];
        if (!e || !s) { cost[i][j] = 0; continue; }
        const { score } = stfFit(e, s);
        cost[i][j] = 100 * Math.max(0, 1 - score) + 2 * Math.max(0, score - 1.4) - (e.position === s.pos ? 0.5 : 0);
    }
    const u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0), p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0);
    for (let i = 1; i <= n; i++) {
        p[0] = i; let j0 = 0; const minv = new Array(n + 1).fill(Infinity), used = new Array(n + 1).fill(false);
        do {
            used[j0] = true; const i0 = p[j0]; let delta = Infinity, j1 = 0;
            for (let j = 1; j <= n; j++) if (!used[j]) { const cur = cost[i0][j] - u[i0] - v[j]; if (cur < minv[j]) { minv[j] = cur; way[j] = j0; } if (minv[j] < delta) { delta = minv[j]; j1 = j; } }
            for (let j = 0; j <= n; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
            j0 = j1;
        } while (p[j0] !== 0);
        do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
    }
    const out = new Array(emps.length).fill(null);
    for (let j = 1; j <= n; j++) { const i = p[j]; if (i >= 1 && i <= emps.length && j <= seats.length) out[i - 1] = seats[j - 1]; }
    return out;
}
// EE merits: read from Torn when it gives them, otherwise what was typed in by hand
const stfMerits = (e, p) => (e.effMerits != null ? e.effMerits : (p.merits[e.id] || 0));
const stfHighest = e => Math.max(e.manual || 0, e.intelligence || 0, e.endurance || 0);
function stfGuideline(e, p, rating, merits) { return (rating != null && rating < 5 ? p.multLow : p.mult) * stfHighest(e) + (merits || 0) * p.meritCost; }

function stfRender(r) {
    const p = stfPlanner(r), d = r.data, emps = d.employees, seats = stfSeats(p), canEdit = coOwner;
    const groups = p.seats.filter(s => s.from <= p.size);
    const assign = stfAssign(emps, seats);
    // wage flags: millers have their own cap, everyone else the general guideline, and only a few people per company may go up to the big cap
    const nonMill = emps.filter(e => e.position !== 'Mill Operator' && (e.wage || 0) > p.generalCap).sort((a, b) => (b.wage || 0) - (a.wage || 0));
    const bigOk = new Set(nonMill.slice(0, p.bigCount).filter(e => e.wage <= p.bigCap).map(e => e.id));
    const flagOf = e => {
        const w = e.wage || 0;
        if (e.position === 'Mill Operator') return w > p.millerCap ? `above the miller cap (${stfM(p.millerCap)})` : '';
        if (w > p.bigCap) return `above ${stfM(p.bigCap)}`;
        if (w > p.generalCap && !bigOk.has(e.id)) return `above ${stfM(p.generalCap)} (only ${p.bigCount} person may go up to ${stfM(p.bigCap)})`;
        return '';
    };
    const totalWages = emps.reduce((s, e) => s + (e.wage || 0), 0), totalGuide = emps.reduce((s, e) => s + stfGuideline(e, p, d.rating, stfMerits(e, p)), 0);
    const income = d.dailyIncome;
    const low = d.rating != null && d.rating < 5;
    const head = `<tr style="color:var(--muted);text-align:left;"><th style="padding:4px 8px;">Employee</th><th style="padding:4px 8px;">Now</th>${groups.map(g => `<th style="padding:4px 8px;text-align:center;font-size:11px;">${esc(g.pos)}<br>${stfK(g.ta)} ${esc(g.a.slice(0, 3))} / ${stfK(g.tb)} ${esc(g.b.slice(0, 3))}</th>`).join('')}</tr>`;
    const grid = emps.map(e => `<tr style="border-top:1px solid var(--line);"><td style="padding:3px 8px;font-weight:700;white-space:nowrap;">${esc(e.name)}</td><td style="padding:3px 8px;font-size:12px;white-space:nowrap;">${esc(e.position)}</td>${groups.map(g => { const f = stfFit(e, g); return `<td style="padding:3px 8px;text-align:center;font-family:var(--mono);background:${stfColor(f.state)};${e.position === g.pos ? 'outline:2px solid var(--reagent);outline-offset:-2px;' : ''}" title="${esc(e.name)}: ${stfK(e[g.a] || 0)} ${g.a}, ${stfK(e[g.b] || 0)} ${g.b}">${Math.round(f.score * 100)}%</td>`; }).join('')}</tr>`).join('');
    const seating = emps.map((e, i) => {
        const s = assign[i], f = s ? stfFit(e, s) : null, move = s && s.pos !== e.position;
        const gl = stfGuideline(e, p, d.rating, stfMerits(e, p)), fl = flagOf(e);
        return `<tr style="border-top:1px solid var(--line);"><td style="padding:4px 8px;font-weight:700;">${esc(e.name)}</td><td style="padding:4px 8px;">${esc(e.position)}</td><td style="padding:4px 8px;${move ? 'color:var(--reagent);font-weight:700;' : 'color:var(--muted);'}">${s ? `${move ? '→ ' : '✓ '}${esc(s.pos)} <span style="font-weight:400;font-size:11px;">(${stfK(s.ta)}/${stfK(s.tb)})</span>` : 'no seat'}</td><td style="padding:4px 8px;font-family:var(--mono);background:${f ? stfColor(f.state) : 'transparent'};text-align:center;">${f ? Math.round(f.score * 100) + '%' : '—'}</td><td style="padding:4px 8px;font-family:var(--mono);text-align:right;">${coMoney(e.wage)}</td><td style="padding:4px 8px;font-family:var(--mono);text-align:right;color:var(--muted);">${coMoney(gl)}</td><td style="padding:4px 8px;text-align:center;">${e.effMerits != null ? `<span title="read from Torn" style="font-family:var(--mono);">${e.effMerits}</span>` : `<input class="stf-merit" data-id="${esc(e.id)}" type="number" min="0" max="10" value="${p.merits[e.id] || 0}" style="width:54px;">`}</td><td style="padding:4px 8px;font-size:12px;color:#f0b432;">${esc(fl)}</td></tr>`;
    }).join('');
    const emptySeats = Math.max(0, seats.length - emps.length), extra = Math.max(0, emps.length - seats.length);
    const seatRows = p.seats.map((s, i) => `<tr data-i="${i}" style="border-top:1px solid var(--line);"><td style="padding:3px 6px;"><input class="se-pos" value="${esc(s.pos)}" style="width:150px;"></td><td style="padding:3px 6px;"><select class="se-a">${STF_STATS.map(([k, l]) => `<option value="${k}" ${s.a === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td><td style="padding:3px 6px;"><input class="se-ta" type="number" value="${s.ta}" style="width:90px;"></td><td style="padding:3px 6px;"><select class="se-b">${STF_STATS.map(([k, l]) => `<option value="${k}" ${s.b === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td><td style="padding:3px 6px;"><input class="se-tb" type="number" value="${s.tb}" style="width:90px;"></td><td style="padding:3px 6px;"><input class="se-n" type="number" min="1" max="20" value="${s.n}" style="width:56px;"></td><td style="padding:3px 6px;"><select class="se-from"><option value="14" ${s.from === 14 ? 'selected' : ''}>always</option><option value="16" ${s.from === 16 ? 'selected' : ''}>16 people only</option></select></td><td style="padding:3px 6px;"><button class="ghost small se-del" type="button">✕</button></td></tr>`).join('');
    return `
        <div class="panel"><h3 style="margin-top:0;">Staffing planner <span style="font-weight:400;font-size:12px;color:var(--muted);">— your own targets for this mine. They are guidelines: a stronger person can make up for a low stat.</span></h3>
            <div style="display:flex;gap:26px;flex-wrap:wrap;font-size:13px;">
                <div><div style="color:var(--muted);font-size:11px;">Setup</div><b>${p.size} people</b> <span style="color:var(--muted);">(${seats.length} seats, ${emps.length} employed${emptySeats ? `, ${emptySeats} open` : ''}${extra ? `, ${extra} more than seats` : ''})</span></div>
                <div><div style="color:var(--muted);font-size:11px;">Wages a day</div><b style="font-family:var(--mono);">${coMoney(totalWages)}</b>${income ? ` <span style="color:var(--muted);">(${Math.round(totalWages / income * 100)}% of the daily income)</span>` : ''}</div>
                <div><div style="color:var(--muted);font-size:11px;">By your wage guideline</div><b style="font-family:var(--mono);">${coMoney(totalGuide)}</b> <span style="color:var(--muted);">(${low ? p.multLow : p.mult}× the highest stat${low ? ', under 5 stars' : ''})</span></div>
                <div><div style="color:var(--muted);font-size:11px;">Average wage</div><b style="font-family:var(--mono);">${coMoney(emps.length ? totalWages / emps.length : 0)}</b></div>
            </div>
            <div style="font-size:12px;color:var(--muted);margin-top:8px;"><span style="display:inline-block;width:12px;height:12px;background:${stfColor('ok')};vertical-align:middle;"></span> both targets met &nbsp; <span style="display:inline-block;width:12px;height:12px;background:${stfColor('comp')};vertical-align:middle;"></span> one stat low but the other makes up for it &nbsp; <span style="display:inline-block;width:12px;height:12px;background:${stfColor('short')};vertical-align:middle;"></span> below the targets. The percentage is the average of the two stats against their targets.</div></div>
        <div class="panel"><h3 style="margin-top:0;">Suggested seating</h3>
            <div style="overflow-x:auto;"><table style="width:100%;font-size:13px;border-collapse:collapse;"><thead><tr style="color:var(--muted);text-align:left;"><th style="padding:4px 8px;">Employee</th><th style="padding:4px 8px;">Now</th><th style="padding:4px 8px;">Suggested seat</th><th style="padding:4px 8px;text-align:center;">Fit</th><th style="padding:4px 8px;text-align:right;">Wage</th><th style="padding:4px 8px;text-align:right;">Guideline</th><th style="padding:4px 8px;text-align:center;">EE merits</th><th style="padding:4px 8px;">Wage note</th></tr></thead><tbody>${seating}</tbody></table></div>
            <div style="font-size:12px;color:var(--muted);margin-top:6px;">The suggestion fills the seats so as few people as possible fall short, and prefers leaving people where they are. The wage guideline is ${p.mult}× the highest work stat (${p.multLow}× under 5 stars) plus ${coMoney(p.meritCost)} per EE merit; millers up to ${stfM(p.millerCap)}, others around ${stfM(p.generalCap)}, and ${p.bigCount} person per company up to ${stfM(p.bigCap)}. A friend who does not mind the pay, or a very good player whose current pay you match, can be worth going outside these.</div></div>
        <div class="panel"><h3 style="margin-top:0;">Everyone against every seat</h3>
            <div style="overflow-x:auto;"><table style="width:100%;font-size:13px;border-collapse:collapse;"><thead>${head}</thead><tbody>${grid}</tbody></table></div>
            <div style="font-size:12px;color:var(--muted);margin-top:6px;">The outlined cell is where the person sits now. Hover a cell for their stats.</div></div>
        <div class="panel"><h3 style="margin-top:0;">Try a new person</h3>
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">${STF_STATS.map(([k, l]) => `<div class="field" style="margin:0;width:130px;"><label>${l}</label><input class="stf-trial" data-k="${k}" type="number" min="0" placeholder="e.g. 45000"></div>`).join('')}<button class="ghost small" id="stf-try" type="button">Check</button></div>
            <div id="stf-trial-out" style="margin-top:8px;"></div></div>
        <details class="panel"><summary class="av-sum"><h3 style="display:inline;margin:0;">Targets and guidelines ${canEdit ? '' : '<span style="font-weight:400;font-size:12px;color:var(--muted);">(the owner can change these)</span>'}</h3></summary>
            <fieldset ${canEdit ? '' : 'disabled'} style="border:0;padding:0;margin:8px 0 0;">
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px;">
                <div class="field" style="margin:0;width:110px;"><label>Setup</label><select id="stf-size"><option value="14" ${p.size === 14 ? 'selected' : ''}>14 people</option><option value="16" ${p.size === 16 ? 'selected' : ''}>16 people</option></select></div>
                <div class="field" style="margin:0;width:120px;"><label>Wage × highest stat</label><input id="stf-mult" type="number" value="${p.mult}"></div>
                <div class="field" style="margin:0;width:140px;"><label>Under 5 stars ×</label><input id="stf-multlow" type="number" value="${p.multLow}"></div>
                <div class="field" style="margin:0;width:140px;"><label>Miller cap $</label><input id="stf-millercap" type="number" value="${p.millerCap}"></div>
                <div class="field" style="margin:0;width:140px;"><label>Others around $</label><input id="stf-generalcap" type="number" value="${p.generalCap}"></div>
                <div class="field" style="margin:0;width:140px;"><label>Top cap $</label><input id="stf-bigcap" type="number" value="${p.bigCap}"></div>
                <div class="field" style="margin:0;width:110px;"><label>People at top cap</label><input id="stf-bigcount" type="number" value="${p.bigCount}"></div>
                <div class="field" style="margin:0;width:130px;"><label>$ per EE merit</label><input id="stf-meritcost" type="number" value="${p.meritCost}"></div>
            </div>
            <div style="overflow-x:auto;"><table style="font-size:13px;border-collapse:collapse;"><thead><tr style="color:var(--muted);text-align:left;"><th style="padding:3px 6px;">Position</th><th style="padding:3px 6px;">Stat A</th><th style="padding:3px 6px;">Target</th><th style="padding:3px 6px;">Stat B</th><th style="padding:3px 6px;">Target</th><th style="padding:3px 6px;">Seats</th><th style="padding:3px 6px;">Used in</th><th></th></tr></thead><tbody id="stf-seats">${seatRows}</tbody></table></div>
            <div style="margin-top:8px;display:flex;gap:8px;"><button class="ghost small" id="stf-addseat" type="button">+ Add a seat group</button><button id="stf-save" type="button">Save targets</button></div>
            </fieldset>
            <div style="font-size:11px;color:var(--muted);margin-top:6px;">Torn's own default requirements for a Mining Corporation (for comparison): Electrician M39k/E78k · Mill Operator M75k/E37.5k · Mine Engineer I81k/E40.5k · Production Foreman M39.5k/E79k · Safety Inspector M47.5k/I95k · Sales Executive I83k/E41.5k · Secretary I39k/E78k · Site Manager I97.5k/E48.75k.</div></details>`;
}

function stfWire(r, reload) {
    const p = stfPlanner(r);
    const readSeats = () => [...document.querySelectorAll('#stf-seats tr')].map(tr => ({ pos: tr.querySelector('.se-pos').value, a: tr.querySelector('.se-a').value, ta: Number(tr.querySelector('.se-ta').value) || 0, b: tr.querySelector('.se-b').value, tb: Number(tr.querySelector('.se-tb').value) || 0, n: Number(tr.querySelector('.se-n').value) || 1, from: Number(tr.querySelector('.se-from').value) }));
    const readAll = () => ({ size: Number($('stf-size').value), mult: Number($('stf-mult').value), multLow: Number($('stf-multlow').value), millerCap: Number($('stf-millercap').value), generalCap: Number($('stf-generalcap').value), bigCap: Number($('stf-bigcap').value), bigCount: Number($('stf-bigcount').value), meritCost: Number($('stf-meritcost').value), seats: readSeats(), merits: p.merits });
    $('stf-save')?.addEventListener('click', async () => { const x = await coFetch({ action: 'co-planner-save', companyId: coMyId, planner: readAll() }); if (x.error) { toast(x.error); return; } toast('Saved'); reload(); });
    $('stf-addseat')?.addEventListener('click', async () => { const pl = readAll(); pl.seats.push({ pos: 'New position', a: 'manual', ta: 30000, b: 'endurance', tb: 30000, n: 1, from: 14 }); r.company.planner = pl; renderCompany(); });
    document.querySelectorAll('#stf-seats .se-del').forEach(b => b.addEventListener('click', () => { const pl = readAll(); pl.seats.splice(Number(b.closest('tr').dataset.i), 1); r.company.planner = pl; renderCompany(); }));
    document.querySelectorAll('.stf-merit').forEach(inp => inp.addEventListener('change', async () => { // the EE merits of a person: the owner or the director records them
        const merits = { ...p.merits }; const v = Math.max(0, Math.min(10, Math.round(Number(inp.value) || 0))); if (v) merits[inp.dataset.id] = v; else delete merits[inp.dataset.id];
        const body = coOwner ? { ...readAll(), merits } : { merits };
        const x = await coFetch({ action: 'co-planner-save', companyId: coMyId, planner: body }); if (x.error) { toast(x.error); return; } r.company.planner = x.planner; renderCompany();
    }));
    $('stf-try')?.addEventListener('click', () => {
        const e = {}; document.querySelectorAll('.stf-trial').forEach(i => { e[i.dataset.k] = Number(i.value) || 0; });
        const groups = p.seats.filter(s => s.from <= p.size);
        const wage = stfGuideline(e, p, r.data.rating, 0);
        $('stf-trial-out').innerHTML = `<div style="font-size:13px;margin-bottom:6px;">Wage by your guideline: <b style="font-family:var(--mono);">${coMoney(wage)}</b> <span style="color:var(--muted);">(${r.data.rating != null && r.data.rating < 5 ? p.multLow : p.mult}× the highest stat)</span></div><div style="display:flex;gap:8px;flex-wrap:wrap;">${groups.map(g => { const f = stfFit(e, g); return `<div style="padding:6px 10px;border-radius:6px;background:${stfColor(f.state)};font-size:13px;"><b>${esc(g.pos)}</b> <span style="color:var(--muted);font-size:11px;">${stfK(g.ta)}/${stfK(g.tb)}</span><div style="font-family:var(--mono);">${Math.round(f.score * 100)}%</div></div>`; }).join('')}</div>`;
    });
}
