// Monthly member evaluation (Leadership → Leaders). For each member it lines up the two things the faction asks of
// everyone — the war rule (from Member Overview's own war data) and training (energy trained against the member's
// own tier requirement, over the picked newsletter period) — next to what was said to them before (a log of earlier
// warnings, filled by importing an earlier report or by hand), and writes a ready-to-send "what are your plans?"
// message for whoever is below requirement. It reads Member Overview's loaded data (moData, moRows, moFetch ... in
// member-overview.js, which loads first) instead of counting anything a second time.
//
// Not covered: online time / "uptime" and respect lost to enemy hits (the "bleed" in the report this replaces) —
// WWL does not record either per member.

let evPeriodId = null;
let evEnergy = null;
let evLog = {};
let evBusy = false;
let evOnlyBelow = false;
let evOpen = new Set();
let evSort = { key: 'status', dir: 'desc' };

const EV_KIND_LABEL = { keep: 'Kept', probation: 'Probation', warning: 'Warning', remove: 'Removed', excused: 'Excused', told: 'Told', note: 'Note', other: 'Other' };
const EV_KIND_COLOR = { warning: '#f0b432', probation: '#f0b432', remove: '#e05555', excused: '#58a6ff', keep: '#35d99b', told: '#8b98a8', note: '#8b98a8', other: '#8b98a8' };
const evKey = name => String(name || '').trim().toLowerCase();
const evDate = d => { const t = Date.parse(`${d}T00:00:00Z`); return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : d; };
const evNum = n => Math.round(n).toLocaleString();

function evPeriods() {
    return moPeriods().filter(p => p.id === 'now' || p.id.startsWith('p'));
}
function evPeriod() {
    const list = evPeriods();
    return list.find(p => p.id === evPeriodId) || list.find(p => p.id === 'now') || list[0];
}

async function loadEvaluation() {
    const locked = !canEditLeaderOnly; // Leader/Co-leader only, same tier as the Effort Calculator
    $('ev-locked').style.display = locked ? 'block' : 'none';
    $('ev-editor').style.display = locked ? 'none' : 'block';
    if (locked || evBusy) return;
    evBusy = true;
    const st = $('ev-status');
    st.className = 'status ok';
    try {
        if (!moData) {
            st.textContent = 'Loading the members and wars…';
            const r = await moFetch({ action: 'mo-get' });
            if (r.error) throw new Error(r.error);
            moData = r;
        }
        // count any of the last 5 wars not counted yet (same as Member Overview does, each is saved for good)
        const todo = moWarsInPeriod().filter(w => !w.event && !moData.hits[w.id]);
        for (let i = 0; i < todo.length; i++) {
            for (let round = 1; round <= 10; round++) {
                st.textContent = `Counting hits for the war vs ${todo[i].opponent} (${i + 1} of ${todo.length}${round > 1 ? `, part ${round}` : ''})…`;
                const w = await moFetch({ action: 'mo-war', warId: todo[i].id });
                if (w.error) throw new Error(`War vs ${todo[i].opponent}: ${w.error}`);
                if (!w.partial) { moData.hits[w.warId] = w.hits; break; }
            }
        }
        st.textContent = 'Reading the training and the earlier evaluations…';
        const p = evPeriod();
        const [en, lg] = await Promise.all([
            moFetch({ action: 'mo-energy', from: p.start, to: p.end }),
            moFetch({ action: 'ev-log-get' }),
        ]);
        evEnergy = en.error ? null : en;
        if (lg.error) throw new Error(lg.error);
        evLog = lg.log || {};
        st.textContent = '';
        renderEvaluation();
    } catch (e) {
        st.className = 'status err'; st.textContent = e.message;
    } finally { evBusy = false; }
}

// ---- the numbers per member ----
function evRows() {
    const p = evPeriod();
    const weeks = moWeeksIn(p);
    return moRows().map(r => {
        const tier = r.tier || moData.autoTier?.[r.id]?.tier || '';
        const need = tier ? Math.round(moData.energyTarget[tier] * weeks) : null;
        const trained = evEnergy?.snapshots ? (evEnergy.perMember[r.id] ?? 0) : null;
        const pct = need && trained !== null ? trained / need : null;
        const trainBelow = pct !== null && pct < 1;
        const warBelow = r.light === 'red';
        const history = (evLog[evKey(r.name)] || []).slice().sort((a, b) => b.date.localeCompare(a.date));
        const warned = history.some(h => h.kind === 'warning' || h.kind === 'probation');
        const fails = (warBelow ? 1 : 0) + (trainBelow ? 1 : 0);
        let status = 'ok';
        if (r.light === 'grey' && pct === null) status = 'nodata';
        else if (fails === 1) status = 'improve';
        else if (fails === 2) status = 'risk';
        const severity = { ok: 0, nodata: 1, improve: 2, risk: 3 }[status] + (fails && warned ? 0.5 : 0);
        return { ...r, tierEff: tier, energyNeed: need, trained, pct, trainBelow, warBelow, history, warned, fails, status, severity, weekly: trained === null ? null : trained / weeks };
    });
}

const EV_STATUS = {
    ok: ['On track', '#35d99b'], improve: ['Needs improvement', '#f0b432'], risk: ['At risk', '#e05555'], nodata: ['Not enough data yet', '#8b98a8'],
};

function evMessage(r) {
    const p = evPeriod();
    const s = moData.settings;
    const wars = moWarsInPeriod();
    const lines = [`Hi ${r.name},`, '', `This is our monthly check-in (${moFmt(p.start)} → ${moFmt(p.end - (p.id === 'now' ? 0 : 86400))}).`, ''];
    // war
    if (r.light === 'grey') lines.push('War participation: you have not been here for enough wars to judge yet.');
    else {
        lines.push(`War participation: you met the war rule (${s.minWarHits} war hits, or ${s.minChainHits} chain hits, in a war) in ${r.okWars} of the last ${r.counted} wars you were here for — we need ${r.need}.${r.warBelow ? ' That is below what we ask.' : ' That is fine.'}`);
        // one war per line, so it reads as a short list instead of a wall of numbers
        const per = r.perWar.map((x, i) => x && !x.notIn ? `- ${wars[i].event ? 'Chain event' : 'War vs'} ${wars[i].opponent}: ${x.war} war hits${x.chain ? `, ${x.chain} chain hits` : ''} — ${x.ok ? 'met' : x.skipped ? 'not met, but you told us beforehand so it is not held against you' : 'not met'}` : null).filter(Boolean);
        if (per.length) lines.push(...per);
    }
    // training
    if (r.pct === null) lines.push(r.tierEff ? 'Training: I could not read your trained energy for this period.' : 'Training: your energy tier is not known yet.');
    else lines.push(`Training: you trained ${evNum(r.trained)} E in this period; your target is ${evNum(r.energyNeed)} E (${Math.round(r.pct * 100)}%).${r.trainBelow ? ' That is below what we ask.' : ' That is fine.'}`);
    // earlier
    const prev = r.history.find(h => h.kind === 'warning' || h.kind === 'probation' || h.kind === 'excused');
    if (prev) lines.push('', `Earlier: on ${evDate(prev.date)} this was noted for you — ${prev.verdict || EV_KIND_LABEL[prev.kind]}${prev.note && prev.source === 'manual' ? ` (${prev.note})` : ''}.`);
    lines.push('');
    if (r.fails) lines.push('Could you let me know what your plans are, and whether you expect this to improve next month? If something is going on (offline, ill, busy, a different play style) just say so and we will take it into account.', '', 'And is there anything we can do to help you improve? Tips on training or the war, a different schedule, a mentor — just tell us what would make it easier for you.');
    else lines.push('You are meeting both of the requirements — thank you, keep it up!');
    lines.push('', 'Thanks!');
    return lines.join('\n');
}

// ---- drawing ----
function renderEvaluation() {
    if (!moData) return;
    const p = evPeriod();
    const list = evPeriods();
    $('ev-period').innerHTML = list.map(x => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.id === 'now' ? `Running now — ${moFmt(x.start)} → ${moFmt(x.end)} (up to today)` : `${moFmt(x.start)} → ${moFmt(x.end)}`)}</option>`).join('');
    const rows = evRows();
    const below = rows.filter(r => r.fails);
    const count = k => rows.filter(r => r.status === k).length;
    $('ev-summary').innerHTML = `
        <div><div style="color:var(--muted);font-size:11px;">Members</div><div style="font-weight:700;">${rows.length}</div></div>
        <div><div style="color:var(--muted);font-size:11px;">On track</div><div style="font-weight:700;color:${EV_STATUS.ok[1]};">${count('ok')}</div></div>
        <div><div style="color:var(--muted);font-size:11px;">Needs improvement</div><div style="font-weight:700;color:${EV_STATUS.improve[1]};">${count('improve')}</div></div>
        <div><div style="color:var(--muted);font-size:11px;">At risk</div><div style="font-weight:700;color:${EV_STATUS.risk[1]};">${count('risk')}</div></div>
        <div><div style="color:var(--muted);font-size:11px;">Below AND warned before</div><div style="font-weight:700;">${rows.filter(r => r.fails && r.warned).length}</div></div>`;
    const notes = [];
    if (!evEnergy?.snapshots) notes.push('No training snapshots cover this period yet, so training shows as unknown.');
    else if (evEnergy.partial && evEnergy.sinceDay) notes.push(`Energy trained is only counted since ${moFmt(evEnergy.sinceDay * 86400)} — that is when counting started.`);
    notes.push(`Training target = the member's own tier × the weeks in the period (${Math.round(moWeeksIn(p) * 10) / 10} weeks); war rule = ${moData.settings.minWarHits} war hits (or ${moData.settings.minChainHits} chain hits) in ${moData.settings.needWars} of the last 5 wars.`);
    $('ev-notes').innerHTML = notes.map(esc).join('<br>');
    $('ev-below').checked = evOnlyBelow;

    const shown = evOnlyBelow ? below : rows;
    const accessors = {
        name: r => r.name.toLowerCase(),
        war: r => (r.counted ? r.okWars / r.counted : -1),
        train: r => (r.pct === null ? -1 : r.pct),
        status: r => r.severity,
        prev: r => r.history[0]?.date || '',
    };
    const sorted = sortRows(shown, evSort, accessors);
    const wars = moWarsInPeriod();
    const dot = c => `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c};margin-right:6px;"></span>`;
    $('ev-table').innerHTML = `
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <thead><tr style="color:var(--muted);text-align:left;">
                <th data-sort="name" style="padding:4px 8px;">Member</th>
                <th data-sort="war" style="padding:4px 8px;">War rule</th>
                <th style="padding:4px 8px;">Last wars (war + chain hits)</th>
                <th data-sort="train" style="padding:4px 8px;">Training</th>
                <th data-sort="status" style="padding:4px 8px;">Suggested</th>
                <th data-sort="prev" style="padding:4px 8px;">Earlier</th>
            </tr></thead>
            <tbody>${sorted.map(r => {
                const open = evOpen.has(r.id);
                const last = r.history[0];
                const perWar = r.perWar.map((x, i) => !x ? '<span style="color:var(--muted);">·</span>' : x.notIn ? '<span style="color:#666;" title="not in the faction yet">–</span>'
                    : `<span style="color:${x.skipped ? '#8b98a8' : x.ok ? MO_LIGHT.green : MO_LIGHT.red};" title="${esc(`${wars[i]?.opponent || ''}${x.excused ? ` — ${moExcuseTitle(x.excused)}` : ''}`)}">${x.war}${x.chain ? `+${x.chain}` : ''}${x.excused ? ' 🚫' : ''}</span>`).join(' <span style="color:var(--line);">|</span> ');
                const [stLabel, stColor] = EV_STATUS[r.status];
                return `
                <tr class="ev-row" data-id="${esc(r.id)}" style="border-top:1px solid var(--line);cursor:pointer;">
                    <td style="padding:6px 8px;white-space:nowrap;"><span style="color:var(--muted);">${open ? '▾' : '▸'}</span> ${esc(r.name)}</td>
                    <td style="padding:6px 8px;white-space:nowrap;font-family:var(--mono);color:${MO_LIGHT[r.light]};">${dot(MO_LIGHT[r.light])}${r.counted ? `${r.okWars}/${r.counted} (need ${r.need})` : 'new'}</td>
                    <td style="padding:6px 8px;white-space:nowrap;font-family:var(--mono);">${perWar}</td>
                    <td style="padding:6px 8px;white-space:nowrap;font-family:var(--mono);color:${r.pct === null ? 'var(--muted)' : r.trainBelow ? MO_LIGHT.red : MO_LIGHT.green};">${r.pct === null ? (r.tierEff ? '…' : 'no tier') : `${evNum(r.trained)} / ${evNum(r.energyNeed)} (${Math.round(r.pct * 100)}%)`}</td>
                    <td style="padding:6px 8px;white-space:nowrap;color:${stColor};font-weight:600;">${stLabel}${r.fails && r.warned ? ' <span title="Below requirement and has an earlier warning/probation" style="color:var(--danger);">· repeat</span>' : ''}</td>
                    <td style="padding:6px 8px;white-space:nowrap;">${last ? `<span style="color:${EV_KIND_COLOR[last.kind]};">${esc(EV_KIND_LABEL[last.kind])}</span> <span style="color:var(--muted);">${esc(evDate(last.date))}${r.history.length > 1 ? ` · ${r.history.length} entries` : ''}</span>` : '<span style="color:var(--muted);">—</span>'}</td>
                </tr>
                ${open ? `<tr class="ev-detail" data-id="${esc(r.id)}"><td colspan="6" style="padding:10px 12px;background:var(--bench-2);white-space:normal;">${evDetailHtml(r)}</td></tr>` : ''}`;
            }).join('')}</tbody>
        </table>`;
    wireSort($('ev-table'), evSort, shown, accessors, renderEvaluation);
    const rowById = Object.fromEntries(rows.map(r => [r.id, r]));
    $('ev-table').querySelectorAll('tr.ev-row').forEach(tr => tr.addEventListener('click', () => {
        const id = tr.dataset.id;
        if (evOpen.has(id)) evOpen.delete(id); else evOpen.add(id);
        renderEvaluation();
    }));
    $('ev-table').querySelectorAll('tr.ev-detail').forEach(tr => wireEvDetail(tr, rowById[tr.dataset.id]));
    $('ev-copy-all').onclick = () => {
        if (!below.length) { toast('Nobody is below requirement'); return; }
        const text = below.map(r => `===== ${r.name} =====\n${evMessage(r)}`).join('\n\n');
        navigator.clipboard.writeText(text).then(() => toast(`${below.length} message${below.length === 1 ? '' : 's'} copied`));
    };
    $('ev-copy-all').textContent = `Copy all messages (${below.length} below requirement)`;
}

function evDetailHtml(r) {
    const hist = r.history.length ? r.history.map(h => `
        <div style="display:flex;gap:8px;align-items:baseline;margin-bottom:4px;font-size:12px;">
            <span style="color:${EV_KIND_COLOR[h.kind]};min-width:70px;font-weight:600;">${esc(EV_KIND_LABEL[h.kind])}</span>
            <span style="color:var(--muted);min-width:90px;">${esc(evDate(h.date))}${h.source === 'import' ? ' · report' : ''}</span>
            <span style="flex:1;">${esc([h.verdict, h.note].filter(Boolean).join(' — '))}</span>
            <button class="ghost small ev-del" data-eid="${esc(h.id)}" title="Remove this entry">✕</button>
        </div>`).join('') : '<div style="color:var(--muted);font-size:12px;">Nothing logged for this member yet.</div>';
    return `
        <div style="display:grid;grid-template-columns:minmax(260px,1.2fr) minmax(260px,1fr);gap:16px;">
            <div>
                <div style="color:var(--muted);font-size:11px;margin-bottom:4px;">Message to send (you can edit it)</div>
                <textarea class="ev-msg" rows="12" style="width:100%;font-size:12px;font-family:var(--mono);">${esc(evMessage(r))}</textarea>
                <div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="small ev-copy">Copy message</button>
                    <button class="ghost small ev-mail" type="button" data-xid="${esc(r.id)}">Open Torn mail</button>
                </div>
            </div>
            <div>
                <div style="color:var(--muted);font-size:11px;margin-bottom:4px;">Earlier evaluations and what was said</div>
                ${hist}
                <div style="margin-top:10px;border-top:1px solid var(--line);padding-top:8px;">
                    <div style="color:var(--muted);font-size:11px;margin-bottom:4px;">Log something now (their reply, a warning given, an excuse…)</div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
                        <select class="ev-kind" style="width:auto;font-size:12px;">${Object.entries(EV_KIND_LABEL).filter(([k]) => k !== 'other').map(([k, l]) => `<option value="${k}" ${k === 'note' ? 'selected' : ''}>${l}</option>`).join('')}</select>
                        <input class="ev-date" type="date" value="${new Date().toISOString().slice(0, 10)}" style="width:auto;font-size:12px;">
                    </div>
                    <textarea class="ev-note" rows="2" placeholder="e.g. Replied: on holiday until the 20th, will catch up" style="width:100%;font-size:12px;"></textarea>
                    <button class="small ev-save" style="margin-top:6px;">Save to log</button>
                </div>
            </div>
        </div>`;
}

function wireEvDetail(tr, r) {
    if (!r) return;
    tr.addEventListener('click', e => e.stopPropagation()); // clicks inside the panel must not close it
    tr.querySelector('.ev-mail').addEventListener('click', e => window.open(`https://www.torn.com/messages.php#/p=compose&XID=${e.currentTarget.dataset.xid}`, '_blank', 'noopener'));
    tr.querySelector('.ev-copy').addEventListener('click', () => navigator.clipboard.writeText(tr.querySelector('.ev-msg').value).then(() => toast('Message copied')));
    tr.querySelector('.ev-save').addEventListener('click', async () => {
        const btn = tr.querySelector('.ev-save');
        btn.disabled = true;
        try {
            const res = await moFetch({ action: 'ev-log-add', name: r.name, kind: tr.querySelector('.ev-kind').value, date: tr.querySelector('.ev-date').value, note: tr.querySelector('.ev-note').value });
            if (res.error) throw new Error(res.error);
            evLog[evKey(r.name)] = res.entries;
            renderEvaluation();
        } catch (e) { toast(e.message); btn.disabled = false; }
    });
    tr.querySelectorAll('.ev-del').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Remove this entry from the log?')) return;
        const res = await moFetch({ action: 'ev-log-delete', name: r.name, id: b.dataset.eid });
        if (res.error) { toast(res.error); return; }
        if (res.entries.length) evLog[evKey(r.name)] = res.entries; else delete evLog[evKey(r.name)];
        renderEvaluation();
    }));
}

$('ev-period').addEventListener('change', async () => {
    evPeriodId = $('ev-period').value;
    evEnergy = null;
    const p = evPeriod();
    $('ev-status').className = 'status ok'; $('ev-status').textContent = 'Reading the training for that period…';
    const en = await moFetch({ action: 'mo-energy', from: p.start, to: p.end });
    evEnergy = en.error ? null : en;
    $('ev-status').textContent = '';
    renderEvaluation();
});
$('ev-below').addEventListener('change', () => { evOnlyBelow = $('ev-below').checked; renderEvaluation(); });
$('ev-import-btn').addEventListener('click', async () => {
    const btn = $('ev-import-btn'), out = $('ev-import-status');
    btn.disabled = true; out.className = 'status ok'; out.textContent = 'Importing…';
    try {
        const r = await moFetch({ action: 'ev-import', date: $('ev-import-date').value, text: $('ev-import-text').value });
        if (r.error) throw new Error(r.error);
        const parts = Object.entries(r.counts).map(([k, n]) => `${n} ${EV_KIND_LABEL[k].toLowerCase()}`);
        out.textContent = `Imported ${r.imported} members (${parts.join(', ')}).`;
        $('ev-import-text').value = '';
        const lg = await moFetch({ action: 'ev-log-get' });
        if (!lg.error) evLog = lg.log || {};
        renderEvaluation();
    } catch (e) { out.className = 'status err'; out.textContent = e.message; } finally { btn.disabled = false; }
});
$('ev-refresh').addEventListener('click', () => { moData = null; loadEvaluation(); });
