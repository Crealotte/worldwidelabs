// company.js — the company side of WWL: the director's "My company" page (live numbers, history, payslip, who has been away, employees, stock, the standing
// Investment amount) and the owner's "Companies" page (register a company by its Torn ID, the director's cut, the Investment amount, the company's own Discord
// channel and the key for the daily saving). A company director logs in with their own key and sees ONLY this (enterDirectorMode); everything else is closed
// to them on the server too. Backend: co-* in api/war-payout.js, lib/company.js, lib/companyReports.js.
'use strict';

let directorMode = false, coOwner = false, coMyId = null;
async function coFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}
const coMoney = n => n == null ? '—' : `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const coM = n => { if (n == null) return '—'; const a = Math.abs(n); const s = n < 0 ? '−' : ''; return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(2)}M` : `${s}$${Math.round(a).toLocaleString('en-US')}`; };
const coN = n => n == null ? '—' : Math.round(n).toLocaleString('en-US');
const coAgo = ts => { if (!ts) return '—'; const s = Date.now() / 1000 - ts; return s < 3600 ? `${Math.max(1, Math.round(s / 60))} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
const coDay = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

// Called by login() with the answer of the server's access check: shows the "My company" menu item to directors and the CreaLotte menu to the owner.
function checkCompanyAccess(acc) {
    coOwner = !!(acc && acc.owner);
    const mine = document.querySelector('.nav-item[data-page="company"]'), ownerGroup = $('nav-owner-group');
    if (mine) mine.style.display = acc && (acc.director) ? '' : 'none';
    if (ownerGroup) ownerGroup.style.display = coOwner ? '' : 'none'; // the CreaLotte menu: only for the owner
}
// A company director who is not in one of the allowed factions: WWL is just their company page.
function enterDirectorMode() {
    directorMode = true;
    document.querySelectorAll('nav.side .nav-item, nav.side .nav-group').forEach(el => { el.style.display = 'none'; });
    const mine = document.querySelector('.nav-item[data-page="company"]');
    if (mine) mine.style.display = '';
    const jn = document.querySelector('.nav-item[data-page="join"]'); if (jn) jn.style.display = ''; // the other Labs programs
    const bugs = document.querySelector('.nav-item[data-page="bug-report"]'); if (bugs) bugs.style.display = ''; // Bugs & suggestions: only what belongs to the company page (the server filters)
    if (typeof showTradingNav === 'function') showTradingNav(); // Pricelist and Receipts & ledger are free for everybody
    goToPage('company');
}

// ---- the director's page (tabs like TornStats: Management, Details, plus the payslip and the daily saving) ----
let coTab = 'details', coState = null; // tab keys are historic: 'details' (the chart and the day table) is shown as Management, 'management' (info, employees, stock, notes) as Details
let coDetailDate = null; const coDayCache = {}; // coDetailDate: the day shown on the Details tab (null = today, live); coDayCache: the saved days fetched so far
const coK = n => n == null ? '—' : Math.abs(n) >= 1000 ? `${Math.round(n / 1000).toLocaleString('en-US')}k` : String(Math.round(n));

async function loadCompany() {
    Object.keys(coDayCache).forEach(k => delete coDayCache[k]); // days are fetched again after anything that may have changed them
    const st = $('co-status');
    st.className = 'status ok'; st.textContent = 'Loading your company…';
    const r = await coFetch({ action: 'co-my', companyId: coMyId });
    if (r.error) { st.className = 'status err'; st.textContent = r.error; $('co-body').innerHTML = ''; return; }
    st.textContent = ''; st.className = 'status';
    coMyId = r.company.id;
    const h = await coFetch({ action: 'co-history', companyId: coMyId });
    coState = { r, h: h.error ? null : h };
    renderCompany();
}
function renderPayslip(h) {
    if (!h || !h.weeks.length) return '<p style="color:var(--muted);margin:0;">No days saved yet. Once the daily saving is on (or you press Fetch today\'s data on the Details tab), the first week fills in here.</p>';
    const line = (k, v, strong) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:2px 0;${strong ? 'font-weight:700;border-top:1px solid var(--line);margin-top:4px;padding-top:6px;' : ''}"><span style="color:${strong ? 'var(--text)' : 'var(--muted)'};">${k}</span><span style="font-family:var(--mono);">${v}</span></div>`;
    return h.weeks.map((w, i) => `<details ${i === 0 ? 'open' : ''} style="margin:6px 0;border:1px solid var(--line);border-radius:8px;padding:6px 12px;">
        <summary class="av-sum"><b style="font-size:14px;">Week ending ${coDay(w.weekEnd)}${w.running ? ' (so far)' : ''}</b> <span style="color:var(--muted);font-size:12px;">${w.daysCounted} day${w.daysCounted === 1 ? '' : 's'} counted · ${w.send >= 0 ? `send ${coM(w.send)}` : `you receive ${coM(-w.send)}`}</span></summary>
        <div style="max-width:420px;margin-top:6px;">
            ${line('Weekly profit', coM(w.profit))}${line('Director cut', coM(w.cut))}${line('Investment amount', coM(w.investment))}
            ${line('Bank', coM(w.bank))}${line(`Keep wages (${coM(w.wagesDay)} a day × 7)`, coM(w.keepWage))}${line(`Keep ads (${coM(w.adsDay)} a day × 7)`, coM(w.keepAds))}${line('Total to keep', coM(w.keep))}
            ${line(w.send >= 0 ? `Send to ${esc(h.sendTo)}` : `${esc(h.sendTo)} sends you`, coM(Math.abs(w.send)), true)}
        </div>
        <div style="margin-top:8px;overflow-x:auto;"><table style="width:100%;font-size:12px;border-collapse:collapse;"><thead><tr style="color:var(--muted);text-align:left;"><th style="padding:3px 8px;">Day</th><th style="padding:3px 8px;">Income</th><th style="padding:3px 8px;">Wages</th><th style="padding:3px 8px;">Ads</th><th style="padding:3px 8px;">Profit</th></tr></thead><tbody>${w.perDay.map(d => `<tr style="border-top:1px solid var(--line);"><td style="padding:3px 8px;">${coDay(d.date)}</td><td style="padding:3px 8px;font-family:var(--mono);">${coM(d.income)}</td><td style="padding:3px 8px;font-family:var(--mono);">${coM(d.wages)}</td><td style="padding:3px 8px;font-family:var(--mono);">${coM(d.ads)}</td><td style="padding:3px 8px;font-family:var(--mono);">${coM(d.profit)}</td></tr>`).join('')}</tbody></table></div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">Profit per day = income − wages − ads − stock cost. Send = bank − total to keep − director cut − investment amount.</div>
    </details>`).join('');
}

// ---- the chart (Income, Ad budget, Wages, Profit by date), drawn as plain SVG ----
function coChart(days) {
    if (days.length < 2) return '<p style="color:var(--muted);margin:0;">The chart appears once two days are saved.</p>';
    const W = 900, H = 260, L = 70, B = 40, T = 12, R = 14;
    const profit = d => (d.income || 0) - (d.wages || 0) - (d.ads || 0) - (d.stockCost || 0);
    const series = [['Income', d => d.income || 0, '#4aa3e8'], ['Ad Budget', d => d.ads || 0, '#e86a8a'], ['Wages', d => d.wages || 0, '#f0a050'], ['Profit', profit, '#f0d060']];
    const max = Math.max(1, ...days.map(d => d.income || 0)) * 1.08;
    const x = i => L + (W - L - R) * (i / (days.length - 1)), y = v => T + (H - T - B) * (1 - Math.max(0, v) / max);
    const grid = [0, .25, .5, .75, 1].map(f => `<line x1="${L}" x2="${W - R}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 6}" y="${y(max * f) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">$${(max * f / 1e6).toFixed(0)}M</text>`).join('');
    const step = Math.max(1, Math.ceil(days.length / 12));
    const xl = days.map((d, i) => i % step === 0 ? `<text x="${x(i)}" y="${H - B + 16}" text-anchor="end" font-size="10" fill="var(--muted)" transform="rotate(-40 ${x(i)} ${H - B + 16})">${d.date.slice(8)}/${d.date.slice(5, 7)}</text>` : '').join('');
    const lines = series.map(([n, f, c]) => `<polyline fill="none" stroke="${c}" stroke-width="2" points="${days.map((d, i) => `${x(i).toFixed(1)},${y(f(d)).toFixed(1)}`).join(' ')}"/>`).join('');
    const legend = series.map(([n, f, c]) => `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:12px;font-size:12px;"><span style="width:14px;height:3px;background:${c};display:inline-block;"></span>${n}</span>`).join('');
    return `<div style="margin-bottom:4px;">${legend}</div><svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;max-height:300px;">${grid}${xl}${lines}</svg>`;
}
function coDetailsTable(days) {
    const profit = d => (d.income || 0) - (d.wages || 0) - (d.ads || 0) - (d.stockCost || 0);
    const nextSun = iso => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7)); return d.toISOString().slice(0, 10); };
    const groups = {};
    for (const d of days) (groups[nextSun(d.date)] = groups[nextSun(d.date)] || []).push(d);
    const td = (v, mono = true) => `<td style="padding:4px 8px;text-align:right;${mono ? 'font-family:var(--mono);' : ''}">${v}</td>`;
    const rows = Object.keys(groups).sort().reverse().map(end => {
        const ds = groups[end].slice().sort((a, b) => b.date.localeCompare(a.date));
        const sum = f => ds.reduce((s, d) => s + (f(d) || 0), 0);
        return ds.map(d => `<tr class="co-row" data-date="${esc(d.date)}" style="border-top:1px solid var(--line);cursor:pointer;"><td style="padding:4px 8px;"><button class="ghost small co-del" data-date="${esc(d.date)}" title="Delete this day" style="padding:0 6px;color:var(--danger);">✕</button></td><td style="padding:4px 8px;white-space:nowrap;">${coDay(d.date)}${d.imported ? ' <span style="color:var(--muted);font-size:10px;">(imported)</span>' : ''}</td>${td(coMoney(d.income))}${td(coMoney(d.wages))}${td(coMoney(d.ads))}${td(coMoney(d.stockCost))}${td(coMoney(profit(d)))}${td(coN(d.customers))}${td(coN(d.hired))}${td(coN(d.rating))}<td style="padding:4px 8px;color:var(--reagent);font-weight:700;" title="Open this day on the Details tab">›</td></tr>`).join('')
            + `<tr style="background:var(--bench-2);font-weight:700;"><td></td><td style="padding:4px 8px;">Weekly total</td>${td(coMoney(sum(d => d.income)))}${td(coMoney(sum(d => d.wages)))}${td(coMoney(sum(d => d.ads)))}${td(coMoney(sum(d => d.stockCost)))}${td(coMoney(sum(profit)))}${td(coN(sum(d => d.customers)))}<td></td><td></td><td></td><td></td></tr>`;
    }).join('');
    return `<div style="overflow-x:auto;"><table style="width:100%;font-size:12px;border-collapse:collapse;"><thead><tr style="color:var(--muted);"><th></th><th style="padding:4px 8px;text-align:left;">Date</th><th style="padding:4px 8px;text-align:right;">Income</th><th style="padding:4px 8px;text-align:right;">Wages</th><th style="padding:4px 8px;text-align:right;">Ad Budget</th><th style="padding:4px 8px;text-align:right;">Stock</th><th style="padding:4px 8px;text-align:right;">Profit</th><th style="padding:4px 8px;text-align:right;">Cust</th><th style="padding:4px 8px;text-align:right;">Employees</th><th style="padding:4px 8px;text-align:right;">Rating</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function coDayDetail(day) {
    const emps = (day.emps || []).map(e => `<tr style="border-top:1px solid var(--line);"><td style="padding:2px 8px;">${esc(e[1])}</td><td style="padding:2px 8px;">${esc(e[2])}</td><td style="padding:2px 8px;font-family:var(--mono);">${coK(e[5])} / ${coK(e[6])} / ${coK(e[7])}</td><td style="padding:2px 8px;font-family:var(--mono);text-align:right;">${coMoney(e[4])}</td><td style="padding:2px 8px;font-family:var(--mono);text-align:right;">${coN(e[8])}</td></tr>`).join('');
    const stock = (day.stock || []).map(s => `<tr style="border-top:1px solid var(--line);"><td style="padding:2px 8px;">${esc(s.name)}</td><td style="padding:2px 8px;font-family:var(--mono);text-align:right;">${coN(s.inStock)}</td><td style="padding:2px 8px;font-family:var(--mono);text-align:right;">${coN(s.sold)}</td><td style="padding:2px 8px;font-family:var(--mono);text-align:right;">${coMoney(s.soldWorth)}</td></tr>`).join('');
    return `<div style="display:flex;gap:24px;flex-wrap:wrap;font-size:12px;"><table style="border-collapse:collapse;"><thead><tr style="color:var(--muted);text-align:left;"><th style="padding:2px 8px;">Employee</th><th style="padding:2px 8px;">Role</th><th style="padding:2px 8px;">M / I / E</th><th style="padding:2px 8px;text-align:right;">Wage</th><th style="padding:2px 8px;text-align:right;">Effic.</th></tr></thead><tbody>${emps}</tbody></table>
        <table style="border-collapse:collapse;"><thead><tr style="color:var(--muted);text-align:left;"><th style="padding:2px 8px;">Product</th><th style="padding:2px 8px;text-align:right;">In stock</th><th style="padding:2px 8px;text-align:right;">Sold</th><th style="padding:2px 8px;text-align:right;">Worth</th></tr></thead><tbody>${stock}</tbody></table></div>`;
}

// the effectiveness breakdown shows under Torn's own names: every key any employee has, the usual ones first
const coEffOrder = [/work/i, /settl/i, /merit/i, /educ/i, /manage/i, /addict/i];
function coEffKeys(emps) {
    const keys = [...new Set(emps.flatMap(e => Object.keys(e.effAll || {})))].filter(k => !/^total$/i.test(k) && !/addict/i.test(k)); // addiction has its own column
    const rank = k => { const i = coEffOrder.findIndex(re => re.test(k)); return i < 0 ? 99 : i; };
    return keys.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
const coEffLabel = k => k.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
const coEffPick = (all, re) => { const k = Object.keys(all || {}).find(x => re.test(x)); return k ? all[k] : null; };
// a saved day in the shape of the live data, so the Details tab can show it with the same code
function coSnapData(live, s) {
    return { ...live, dailyIncome: s.income, weeklyIncome: s.weeklyIncome, dailyCustomers: s.customers, weeklyCustomers: s.weeklyCustomers, hired: s.hired, capacity: s.capacity, rating: s.rating, advertising: s.ads, bank: s.bank, funds: s.funds, popularity: s.popularity, efficiency: s.efficiency,
        employees: (s.emps || []).map(e => ({ id: e[0], name: e[1], position: e[2], days: e[3], wage: e[4], manual: e[5], intelligence: e[6], endurance: e[7], effectiveness: e[8], addiction: e[9], lastTs: e[10], effAll: (e[11] && typeof e[11] === 'object') ? e[11] : { working_stats: e[11], settled_in: e[12], merits: e[13], director_education: e[14] }, lastRel: '' })),
        stock: (s.stock || []).map(x => ({ name: x.name, cost: x.cost, rrp: x.rrp, price: x.price, inStock: x.inStock, onOrder: x.onOrder, sold: x.sold, soldWorth: x.soldWorth })), inactive: { day: [], long: [] } };
}
function renderCompany() {
    const { r, h } = coState;
    // a day opened from the table on Management: the Details tab then shows the company as it stood that day (fetched once, then kept)
    if (coTab === 'management' && coDetailDate && !coDayCache[coDetailDate]) {
        const asked = coDetailDate;
        coFetch({ action: 'co-day', companyId: coMyId, date: asked }).then(x => { coDayCache[asked] = x.error ? { error: x.error } : x.day; renderCompany(); });
        $('co-body').innerHTML = '<p style="color:var(--muted);">Loading that day…</p>';
        return;
    }
    const dayRec = coTab === 'management' && coDetailDate ? coDayCache[coDetailDate] : null;
    const pastDay = !!(dayRec && !dayRec.error);
    const d = pastDay ? coSnapData(r.data, dayRec) : r.data, c = r.company, sv = r.saving || { on: false };
    const pastBanner = coTab === 'management' && coDetailDate ? `<div class="panel" style="border-color:#f0b432;"><b>${coDay(coDetailDate)}</b> <span style="color:var(--muted);">: the company as it stood on that day.</span> <button class="ghost small" id="co-live" type="button" style="margin-left:8px;">Back to today</button>${dayRec && dayRec.error ? `<div style="color:var(--danger);margin-top:6px;">${esc(dayRec.error)}</div>` : ''}${pastDay && !(dayRec.emps || []).length ? '<div style="color:var(--muted);margin-top:6px;font-size:13px;">Only the table values were saved for this day (it was imported), so there are no employees or stock for it.</div>' : ''}</div>` : '';
    const days = h ? h.days : [];
    const effKeys = coEffKeys(d.employees);
    const tabs = [['details', 'Management'], ['management', 'Details'], ['staffing', 'Staffing'], ['payslip', 'Payslip'], ['saving', 'Daily saving']];
    const info = (k, v) => `<div style="margin:2px 0;"><b>${k}:</b> ${v}</div>`;
    const inactive = (list, title, color) => `<div style="margin:6px 0;"><b style="font-size:13px;">${title}</b> ${list.length ? list.map(e => `<span class="chip" style="cursor:default;border-color:${color};">${esc(e.name)} <span style="color:var(--muted);font-size:11px;">${esc(e.rel)}</span></span>`).join(' ') : '<span style="color:var(--muted);font-size:13px;">none</span>'}</div>`;
    const inc = days.map(x => x.income).filter(v => v != null);
    const monthPrefix = (h && h.today ? h.today : new Date().toISOString().slice(0, 10)).slice(0, 7);
    const monthIncome = days.filter(x => x.date.startsWith(monthPrefix)).reduce((s, x) => s + (x.income || 0), 0);
    let body = '';
    if (coTab === 'management') {
        body = `${pastBanner}<div class="panel"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px;font-size:14px;">
                <div>${info('Type', esc(d.type || '—'))}${info('Employees', d.hired != null ? `${d.hired}${d.capacity ? ` / ${d.capacity}` : ''}` : '—')}${info('Rating', coN(d.rating))}${info('Ad Budget', coMoney(d.advertising))}${info('Bank', coMoney(d.bank ?? d.funds))}</div>
                <div>${info('Daily Income', coMoney(d.dailyIncome))}${info('Daily Customers', coN(d.dailyCustomers))}${info('Weekly Income', coMoney(d.weeklyIncome))}${info('Weekly Customers', coN(d.weeklyCustomers))}${info('Popularity / Efficiency', `${d.popularity != null ? coN(d.popularity) + '%' : '—'} / ${d.efficiency != null ? coN(d.efficiency) + '%' : '—'}`)}</div>
                <div><div style="font-size:18px;margin-bottom:4px;">Notes</div><textarea id="co-notes" rows="4" maxlength="3000" style="width:100%;">${esc(c.notes || '')}</textarea><button class="ghost small" id="co-notes-save" type="button" style="margin-top:4px;">Save notes</button></div>
            </div></div>
            <div class="panel"><h3 style="margin-top:0;">Employees</h3>
            ${d.employees.length ? `<div style="overflow-x:auto;"><table style="width:100%;font-size:13px;border-collapse:collapse;"><thead><tr style="color:var(--muted);text-align:left;"><th style="padding:4px 8px;">Employee</th><th style="padding:4px 8px;text-align:right;">Efficiency</th>${effKeys.map(k => `<th style="padding:4px 8px;text-align:right;">${esc(coEffLabel(k))}</th>`).join("")}<th style="padding:4px 8px;">Role</th><th style="padding:4px 8px;">M / I / E</th><th style="padding:4px 8px;text-align:right;">Wage</th><th style="padding:4px 8px;text-align:right;">Addiction</th><th style="padding:4px 8px;">Last seen</th></tr></thead><tbody>${d.employees.map((e, i) => `<tr style="border-top:1px solid var(--line);${i % 2 ? 'background:var(--bench-2);' : ''}"><td style="padding:4px 8px;"><a href="https://www.torn.com/profiles.php?XID=${esc(e.id)}" target="_blank" rel="noopener" style="color:var(--text);">${esc(e.name)} [${esc(e.id)}]</a></td><td style="padding:4px 8px;text-align:right;font-family:var(--mono);">${coN(e.effectiveness)}</td>${effKeys.map(k => `<td style="padding:4px 8px;text-align:right;font-family:var(--mono);color:var(--muted);">${e.effAll && e.effAll[k] != null ? (e.effAll[k] > 0 ? "+" : "") + coN(e.effAll[k]) : "—"}</td>`).join("")}<td style="padding:4px 8px;">${esc(e.position)}</td><td style="padding:4px 8px;font-family:var(--mono);">${coK(e.manual)} / ${coK(e.intelligence)} / ${coK(e.endurance)}</td><td style="padding:4px 8px;text-align:right;font-family:var(--mono);">${coMoney(e.wage)}</td><td style="padding:4px 8px;text-align:right;font-family:var(--mono);${e.addiction != null && Math.abs(e.addiction) >= 12 ? 'color:var(--danger);' : ''}">${coN(e.addiction)}</td><td style="padding:4px 8px;color:var(--muted);">${esc(e.lastRel) || coAgo(e.lastTs)}</td></tr>`).join('')}</tbody></table></div>` : '<p style="color:var(--muted);margin:0;">Torn gave no employee list for this key.</p>'}</div>
            <div class="panel"><h3 style="margin-top:0;">Stock</h3>
            ${d.stock.length ? `<div style="overflow-x:auto;"><table style="width:100%;font-size:13px;border-collapse:collapse;"><thead><tr style="color:var(--muted);text-align:left;"><th style="padding:4px 8px;">Item</th><th style="padding:4px 8px;text-align:right;">Cost</th><th style="padding:4px 8px;text-align:right;">RRP</th><th style="padding:4px 8px;text-align:right;">Price</th><th style="padding:4px 8px;text-align:right;">In Stock</th><th style="padding:4px 8px;text-align:right;">On Order</th><th style="padding:4px 8px;text-align:right;">Amount Sold</th><th style="padding:4px 8px;text-align:right;">Amount Worth</th><th style="padding:4px 8px;text-align:right;">Profit</th></tr></thead><tbody>${d.stock.map((s, i) => `<tr style="border-top:1px solid var(--line);${i % 2 ? 'background:var(--bench-2);' : ''}"><td style="padding:4px 8px;font-weight:700;">${esc(s.name)}</td><td style="padding:4px 8px;text-align:right;font-family:var(--mono);">${coMoney(s.cost)}</td><td style="padding:4px 8px;text-align:right;font-family:var(--mono);">${coMoney(s.rrp)}</td><td style="padding:4px 8px;text-align:right;font-family:var(--mono);">${coMoney(s.price)}</td><td style="padding:4px 8px;text-align:right;font-family:var(--mono);">${coN(s.inStock)}</td><td style="padding:4px 8px;text-align:right;font-family:var(--mono);">${coN(s.onOrder)}</td><td style="padding:4px 8px;text-align:right;font-family:var(--mono);">${coN(s.sold)}</td><td style="padding:4px 8px;text-align:right;font-family:var(--mono);">${coMoney(s.soldWorth)}</td><td style="padding:4px 8px;text-align:right;font-family:var(--mono);">${coMoney((s.soldWorth || 0) - (s.cost || 0) * (s.sold || 0))}</td></tr>`).join('')}</tbody></table></div>` : '<p style="color:var(--muted);margin:0;">Torn gave no stock for this company.</p>'}</div>
            ${pastDay ? '' : `<div class="panel"><h3 style="margin-top:0;">Who has been away</h3>${inactive(d.inactive.day, 'Inactive 24–48 h', '#f0b432')}${inactive(d.inactive.long, 'Inactive over 48 h', 'var(--danger)')}</div>`}
            ${pastDay ? '' : `<details style="margin-top:8px;"><summary class="av-sum"><span style="font-size:12px;color:var(--muted);">Show Torn's raw answer (to check the numbers)</span></summary><pre id="co-raw" style="white-space:pre-wrap;word-break:break-all;font-size:11px;color:var(--muted);"></pre><button class="ghost small" id="co-raw-btn" type="button">Load the raw answer</button></details>`}`;
    } else if (coTab === 'details') {
        body = `<div class="panel"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px;font-size:14px;">
                <div>${info('Type', esc(d.type || '—'))}${info('Employees', coN(d.hired))}${info('Rating', coN(d.rating))}${info('Ad Budget', coMoney(d.advertising))}</div>
                <div>${info('Daily Income', coMoney(d.dailyIncome))}${info('Daily Customers', coN(d.dailyCustomers))}${info('Weekly Income', coMoney(d.weeklyIncome))}${info('Weekly Customers', coN(d.weeklyCustomers))}</div>
                <div>${info('Highest Daily Income', inc.length ? coMoney(Math.max(...inc)) : '—')}${info('Average Daily Income', inc.length ? coMoney(inc.reduce((s, v) => s + v, 0) / inc.length) : '—')}${info('Lowest Daily Income', inc.length ? coMoney(Math.min(...inc)) : '—')}${info('Current Month Income', days.length ? coMoney(monthIncome) : '—')}</div>
            </div></div>
            <div class="panel"><h3 style="margin-top:0;">Company details</h3>${coChart(days)}
                <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:10px 0;"><button class="ghost small" id="co-fetch" type="button">Fetch today's data</button><span style="font-size:12px;color:var(--muted);">Reads the company now and saves it for the latest tick. The daily saving does this by itself every day at 18:25 TCT.</span></div>
                ${days.length ? coDetailsTable(days) : '<p style="color:var(--muted);margin:0;">No days saved yet.</p>'}</div>
            <details class="panel"><summary class="av-sum"><h3 style="display:inline;margin:0;">Import history from TornStats</h3></summary>
                <p style="font-size:12px;color:var(--muted);margin:8px 0;">On TornStats open the company's Details page and copy the rows of the table (Date, Income, Wages, Ad Budget, Stock, Profit, Cust, Employees, Rating), then paste them here. Days WWL already has are kept as they are; "Weekly Total" rows are ignored.</p>
                <textarea id="co-import" rows="6" style="width:100%;font-family:var(--mono);font-size:12px;" placeholder="06/10/26  $44,697,000  $17,685,000  $3,000,000  $0  $24,012,000  2  15  5"></textarea>
                <button class="ghost small" id="co-import-btn" type="button" style="margin-top:6px;">Import</button></details>`;
    } else if (coTab === 'staffing') {
        body = typeof stfRender === 'function' ? stfRender(r) : '';
    } else if (coTab === 'payslip') {
        body = `<div class="panel"><h3 style="margin-top:0;">Payslip <span style="font-weight:400;font-size:12px;color:var(--muted);">— the week runs Monday to Sunday; the Sunday tick (18:00–18:10 TCT) is in the week it ends</span></h3>
            ${c.investment > 0 ? `<p style="margin:0 0 8px;">The owner owes you <b style="font-family:var(--mono);">${coMoney(c.investment)}</b>${c.invNote ? ` <span style="color:var(--muted);">(${esc(c.invNote)})</span>` : ''}. It is taken off what you send, so the money only moves once.</p>` : ''}
            ${renderPayslip(h)}</div>`;
    } else {
        body = `<div class="panel"><h3 style="margin-top:0;">Daily saving and the Discord reports</h3>
            ${sv.on ? `<p style="margin:0 0 8px;"><b style="color:var(--reagent);">On</b>: the numbers are saved every day after the tick${sv.lastRun ? `, last run ${coAgo(sv.lastRun)}` : ''}${sv.lastOk === false ? ` <span style="color:var(--danger);">(last run failed: ${esc(sv.lastError || '')})</span>` : ''}. The daily report (and the weekly one on Sunday) goes to your company's Discord channel.</p>` : '<p style="margin:0 0 8px;color:var(--muted);">Off: there is no history yet and no Discord report. Turn it on and your API key is kept (encrypted) only to read your company once a day.</p>'}
            ${r.isDirector ? `<button class="ghost small" id="co-daily" type="button">${sv.on ? 'Turn the daily saving off' : 'Turn the daily saving on'}</button>` : ''}</div>`;
    }
    $('co-body').innerHTML = `
        ${r.companies.length > 1 ? `<div class="field" style="max-width:300px;"><label for="co-pick">Company</label><select id="co-pick">${r.companies.map(x => `<option value="${esc(x.id)}" ${x.id === c.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>` : ''}
        <h3 style="margin:0 0 8px;font-size:20px;">${esc(d.name || c.name)}</h3>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;border-bottom:1px solid var(--line);padding-bottom:8px;">${tabs.map(([k, l]) => `<button type="button" class="co-tab" data-t="${k}" style="padding:7px 16px;border-radius:8px 8px 0 0;border:1px solid ${coTab === k ? 'var(--reagent)' : 'var(--line)'};background:${coTab === k ? 'rgba(53,217,155,.12)' : 'transparent'};color:var(--text);cursor:pointer;font-size:14px;">${l}</button>`).join('')}</div>
        ${body}`;
    document.querySelectorAll('.co-tab').forEach(b => b.addEventListener('click', () => { coTab = b.dataset.t; renderCompany(); }));
    if (coTab === 'staffing' && typeof stfWire === 'function') stfWire(r, loadCompany);
    $('co-pick')?.addEventListener('change', () => { coMyId = $('co-pick').value; coDetailDate = null; loadCompany(); });
    $('co-raw-btn')?.addEventListener('click', async () => { const x = await coFetch({ action: 'co-raw', companyId: coMyId }); $('co-raw').textContent = x.error || x.raw; });
    $('co-daily')?.addEventListener('click', async () => { const x = await coFetch({ action: 'co-daily', companyId: coMyId, on: !sv.on }); if (x.error) { toast(x.error); return; } toast(!sv.on ? 'Daily saving is on' : 'Daily saving is off'); loadCompany(); });
    $('co-live')?.addEventListener('click', () => { coDetailDate = null; renderCompany(); });
    $('co-notes-save')?.addEventListener('click', async () => { const x = await coFetch({ action: 'co-notes', companyId: coMyId, notes: $('co-notes').value }); if (x.error) { toast(x.error); return; } c.notes = $('co-notes').value; toast('Notes saved'); });
    $('co-fetch')?.addEventListener('click', async () => { const b = $('co-fetch'); b.disabled = true; const x = await coFetch({ action: 'co-fetch-now', companyId: coMyId }); b.disabled = false; if (x.error) { toast(x.error); return; } toast(`Saved for ${x.date}`); loadCompany(); });
    $('co-import-btn')?.addEventListener('click', async () => { const x = await coFetch({ action: 'co-import', companyId: coMyId, text: $('co-import').value }); if (x.error) { toast(x.error); return; } toast(`${x.added} day${x.added === 1 ? '' : 's'} imported${x.kept ? `, ${x.kept} already there` : ''}`); loadCompany(); });
    document.querySelectorAll('.co-del').forEach(b => b.addEventListener('click', async () => { if (!confirm(`Delete ${b.dataset.date} from the history?`)) return; const x = await coFetch({ action: 'co-day-delete', companyId: coMyId, date: b.dataset.date }); if (x.error) { toast(x.error); return; } loadCompany(); }));
    document.querySelectorAll('.co-row').forEach(tr => tr.addEventListener('click', e => { // a day of the table opens that day on the Details tab
        if (e.target.closest('.co-del')) return;
        coDetailDate = tr.dataset.date; coTab = 'management'; renderCompany();
    }));
}

// ---- the owner's page: register companies, set the cut, the Investment amount, the Discord channel and the key ----
const csOpen = {}; // which company cards have their settings open (all closed to begin with)
async function loadCompanies() {
    const st = $('cs-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    const r = await coFetch({ action: 'co-list' });
    if (r.error) { st.className = 'status err'; st.textContent = r.error; return; }
    st.textContent = ''; st.className = 'status';
    $('cs-list').innerHTML = r.companies.length ? r.companies.map(c => {
        const sv = c.saving || {};
        return `<div class="panel" style="margin-bottom:12px;" data-id="${esc(c.id)}">
        <div style="display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;"><h3 style="margin:0;">${esc(c.name)}</h3><span style="color:var(--muted);font-size:12px;">company ${esc(c.id)} · director <b style="color:var(--text);">${esc(c.directorName || c.directorId)}</b> [${esc(c.directorId)}]</span><button class="ghost small cs-open" style="margin-left:auto;">Open the company</button><button class="ghost small cs-del" style="color:var(--danger);">Remove</button></div>
        <details class="cs-det" data-id="${esc(c.id)}" ${csOpen[c.id] ? 'open' : ''} style="margin-top:8px;"><summary class="av-sum"><span style="font-size:12px;color:var(--muted);">Cut ${esc(c.cutPct)}% · Investment ${coMoney(c.investment)} · Discord ${c.discord.channelId || c.discord.webhookSet ? 'set' : 'not set'} · Daily saving ${sv.on ? 'on' : 'off'}</span></summary>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-top:10px;">
            <div class="field" style="margin:0;width:110px;"><label>Director cut %</label><input class="cs-cut" type="number" min="0" max="100" value="${esc(c.cutPct)}"></div>
            <button class="ghost small cs-cutsave">Save cut</button>
            <div class="field" style="margin:0;width:170px;"><label>Investment amount ($)</label><input class="cs-amount" inputmode="numeric" placeholder="${esc(Math.round(c.investment || 0))}" value=""></div>
            <div class="field" style="margin:0;flex:1;min-width:160px;"><label>Note (who it is for)</label><input class="cs-note" maxlength="120" value="${esc(c.invNote)}"></div>
            <button class="ghost small cs-inv" data-mode="set">Set</button><button class="ghost small cs-inv" data-mode="add">+ Add</button><button class="ghost small cs-inv" data-mode="take">− Take out</button>
        </div>
        <div style="margin-top:8px;font-size:13px;">Investment amount now: <b style="font-family:var(--mono);color:${c.investment > 0 ? '#f0b432' : 'var(--muted)'};">${coMoney(c.investment)}</b> <span style="color:var(--muted);font-size:12px;">— stays until you change it; 0 means nothing to settle</span></div>
        ${c.invLog.length ? `<details style="margin-top:6px;"><summary class="av-sum"><span style="font-size:12px;color:var(--muted);">History of the investment amount</span></summary>${c.invLog.map(l => `<div style="font-size:12px;color:var(--muted);padding:2px 0;">${new Date(l.t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${l.delta >= 0 ? '+' : '−'}${coMoney(Math.abs(l.delta))} → ${coMoney(l.after)}${l.note ? ` · ${esc(l.note)}` : ''} · ${esc(l.by)}</div>`).join('')}</details>` : ''}
        <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--line);">
            <div style="font-weight:700;font-size:13px;margin-bottom:6px;">Discord channel for this company's reports</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
                <div class="field" style="margin:0;width:230px;"><label>Channel ID (the bot posts there)</label><input class="cs-chan" inputmode="numeric" value="${esc(c.discord.channelId)}" placeholder="e.g. 123456789012345678"></div>
                <div class="field" style="margin:0;width:270px;"><label>Or a webhook URL ${c.discord.webhookSet ? `<span style="color:var(--reagent);">(saved: ${esc(c.discord.webhookHint)})</span>` : ''}</label><input class="cs-hook" type="password" autocomplete="off" placeholder="${c.discord.webhookSet ? 'Saved: paste a new one to replace it' : 'https://discord.com/api/webhooks/…'}"></div>
                <button class="ghost small cs-dsave">Save</button><button class="ghost small cs-dtest">Send a test message</button>${c.discord.webhookSet ? '<button class="ghost small cs-dclear">Remove webhook</button>' : ''}
            </div>
        </div>
        <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--line);">
            <div style="font-weight:700;font-size:13px;margin-bottom:4px;">Daily saving and reports</div>
            <div style="font-size:13px;margin-bottom:6px;">${sv.on ? `<b style="color:var(--reagent);">On</b> (${esc(sv.by || '')})${sv.lastRun ? `, last run ${coAgo(sv.lastRun)}` : ', has not run yet'}${sv.lastPosted ? `, last report ${esc(sv.lastPosted)}` : ''}${sv.lastOk === false ? ` <span style="color:var(--danger);">failed: ${esc(sv.lastError || '')}</span>` : ''}` : '<span style="color:var(--muted);">Off: no history and no reports. Save the director\'s API key to start.</span>'}</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
                <div class="field" style="margin:0;width:230px;"><label>Director's API key</label><input class="cs-key" type="password" autocomplete="off" placeholder="${sv.on ? 'Saved: paste a new one to replace it' : '16 characters'}"></div>
                <button class="ghost small cs-ksave">Save key</button>${sv.on ? '<button class="ghost small cs-kremove">Remove key</button>' : ''}
                <button class="ghost small cs-now" ${sv.on ? '' : 'disabled'}>Post today's report now</button>
            </div>
            <div style="font-size:11px;color:var(--muted);margin-top:4px;">The key is stored encrypted and only used to read this company once a day (after the 18:00–18:10 TCT tick).</div>
        </div>
        </details>
    </div>`; }).join('') : '<p style="color:var(--muted);">No companies registered yet.</p>';
    document.querySelectorAll('#cs-list .cs-det').forEach(d => d.addEventListener('toggle', () => { csOpen[d.dataset.id] = d.open; }));
    document.querySelectorAll('#cs-list [data-id]').forEach(card => {
        const id = card.dataset.id, q = s => card.querySelector(s), on = (s, fn) => { const el = q(s); if (el) el.addEventListener('click', fn); };
        const run = async (body, ok) => { const x = await coFetch({ companyId: id, ...body }); if (x.error) { toast(x.error); return null; } if (ok) toast(ok); return x; };
        on('.cs-del', async () => { if (!confirm('Remove this company? Its director can no longer log in to WWL.')) return; if (await run({ action: 'co-remove' })) loadCompanies(); });
        on('.cs-open', () => { coMyId = id; goToPage('company'); });
        on('.cs-cutsave', async () => { if (await run({ action: 'co-save', cutPct: q('.cs-cut').value }, 'Cut saved')) loadCompanies(); });
        card.querySelectorAll('.cs-inv').forEach(b => b.addEventListener('click', async () => {
            const amount = q('.cs-amount').value;
            if (amount === '' && b.dataset.mode !== 'set') { toast('Enter an amount first.'); return; }
            if (await run({ action: 'co-invest', mode: b.dataset.mode, amount: amount === '' ? 0 : amount, note: q('.cs-note').value }, 'Investment amount updated')) loadCompanies();
        }));
        on('.cs-dsave', async () => { if (await run({ action: 'co-discord-set', channelId: q('.cs-chan').value, webhookUrl: q('.cs-hook').value }, 'Discord saved')) loadCompanies(); });
        on('.cs-dtest', async () => { if (!(await run({ action: 'co-discord-set', channelId: q('.cs-chan').value, webhookUrl: q('.cs-hook').value }))) return; if (await run({ action: 'co-discord-test' }, 'Test message sent: check the channel')) loadCompanies(); });
        on('.cs-dclear', async () => { if (await run({ action: 'co-discord-set', clearWebhook: true }, 'Webhook removed')) loadCompanies(); });
        on('.cs-ksave', async () => { const k = q('.cs-key').value.trim(); if (!k) { toast('Paste the key first.'); return; } if (await run({ action: 'co-key-set', companyKey: k }, 'Key saved: the daily saving is on')) loadCompanies(); });
        on('.cs-kremove', async () => { if (!confirm('Remove the saved key? The daily saving and the reports stop.')) return; if (await run({ action: 'co-key-remove' }, 'Key removed')) loadCompanies(); });
        on('.cs-now', async () => { const b = q('.cs-now'); b.disabled = true; const x = await run({ action: 'co-report-now' }); b.disabled = false; if (x) { const r0 = x.results[0] || {}; toast(r0.ok ? (r0.posted ? 'Report posted' : 'Saved, but nothing could be posted: set the Discord channel') : (r0.error || 'Could not run')); loadCompanies(); } });
    });
}
$('cs-add').addEventListener('click', async () => {
    const id = $('cs-id').value.replace(/\D/g, '');
    if (!id) return;
    const b = $('cs-add'); b.disabled = true;
    const x = await coFetch({ action: 'co-save', companyId: id });
    b.disabled = false;
    if (x.error) { toast(x.error); return; }
    $('cs-id').value = ''; toast(`${x.company.name} added, director ${x.company.directorName || x.company.directorId}`); loadCompanies();
});
