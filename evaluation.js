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
        await evXanLoadCached();
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
        // Joined during this period (Torn only gives whole days in the faction, so this is approximate): the target
        // counts only the time they have been here, and they get the softer approach like other new members.
        const joinedTs = r.daysInFaction == null ? null : Math.floor(Date.now() / 1000) - r.daysInFaction * 86400;
        const partial = joinedTs !== null && joinedTs > p.start;
        const presentWeeks = partial ? Math.max(1 / 7, (p.end - joinedTs) / (7 * 86400)) : weeks;
        const need = tier ? Math.round(moData.energyTarget[tier] * presentWeeks) : null;
        const trained = evEnergy?.snapshots ? (evEnergy.perMember[r.id] ?? 0) : null;
        const pct = need && trained !== null ? trained / need : null;
        const trainBelow = pct !== null && pct < 1;
        const warBelow = r.light === 'red';
        const history = (evLog[evKey(r.name)] || []).slice().sort((a, b) => b.date.localeCompare(a.date));
        const warned = history.some(h => h.kind === 'warning' || h.kind === 'probation');
        const xanax = evXanFor(r);
        const xanBelow = xanax.known && xanax.outstanding > 0; // took more Xanax than the hits covered, and has not put it back
        const fails = (warBelow ? 1 : 0) + (trainBelow ? 1 : 0) + (xanBelow ? 1 : 0);
        // New: has only been around for a few wars (up to the number the rule asks for), so they get a softer approach.
        const fresh = r.counted <= moData.settings.needWars || partial;
        let status = 'ok';
        if (r.light === 'grey' && pct === null) status = 'nodata';
        else if (fails && fresh) status = 'new';
        else if (fails === 1) status = 'improve';
        else if (fails >= 2) status = 'risk';
        const severity = { ok: 0, nodata: 1, new: 1.5, improve: 2, risk: 3 }[status] + (fails && warned ? 0.5 : 0);
        return { ...r, xanax, xanBelow, fresh, partial, tierEff: tier, energyNeed: need, trained, pct, trainBelow, warBelow, history, warned, fails, status, severity, weekly: trained === null ? null : trained / presentWeeks };
    });
}

const EV_STATUS = {
    ok: ['On track', '#35d99b'], improve: ['Needs improvement', '#f0b432'], risk: ['At risk', '#e05555'], nodata: ['Not enough data yet', '#8b98a8'], new: ['New — settling in', '#58a6ff'],
};

function evMessage(r) {
    const p = evPeriod();
    const s = moData.settings;
    const soft = r.fresh && r.fails; // new member (only a few wars so far) below requirement: softer wording
    const lines = [`Hi ${r.name},`, '', `This is our monthly check-in (${moFmt(p.start)} → ${moFmt(p.end - (p.id === 'now' ? 0 : 86400))}).`, ''];
    // war
    if (r.light === 'grey') lines.push('War participation: you have not been with us for enough wars to judge yet — no worries, take your time to settle in.');
    else if (soft && r.warBelow) {
        lines.push(`War participation: you have been with us for ${r.counted} war${r.counted === 1 ? '' : 's'} so far and met the war rule (${s.minWarHits} war hits, or ${s.minChainHits} chain hits, in a war) in ${r.okWars} of ${r.counted === 1 ? 'it' : 'them'}. Remember we ask you to meet it in ${s.needWars} of the last 5 wars — but you are new, so you have some more time to adjust.`);
    } else {
        lines.push(`War participation: you met the war rule (${s.minWarHits} war hits, or ${s.minChainHits} chain hits, in a war) in ${r.okWars} of the last ${r.counted} wars you were here for — we need ${r.need}.${r.warBelow ? ' That is below what we ask.' : ' That is fine.'}`);
    }
    if (r.light !== 'grey') {
        const skipped = r.perWar.filter(x => x?.skipped).length;
        if (skipped) lines.push(`  (${skipped} war${skipped === 1 ? '' : 's'} you told us beforehand you could not make ${skipped === 1 ? 'is' : 'are'} not counted against you.)`);
    }
    // training (a blank line after the war part, so the message is not one block)
    lines.push('');
    if (r.pct === null) lines.push(r.tierEff ? 'Training: I could not read your trained energy for this period.' : 'Training: your energy tier is not known yet.');
    else lines.push(`Training: you trained ${evNum(r.trained)} E in this period; your target is ${evNum(r.energyNeed)} E${r.partial ? ` (it only counts the time you have been with us this period, about ${r.daysInFaction} days)` : ""} (${Math.round(r.pct * 100)}%).${r.trainBelow ? (soft ? ' You are still settling in, so this is just so you know what we are aiming for.' : ' That is below what we ask.') : ' That is fine.'}`);
    // Xanax (only the wars of this period): taken from the armory beyond what the hits covered
    if (r.xanax.known && r.xanax.owed > 0) {
        lines.push('');
        lines.push(`Xanax: every Xanax taken from the faction armory should be backed by 10 hits. ${soft ? 'No worries, but in' : 'In'} this period's wars you took more than your hits covered:`);
        for (const w of r.xanax.rows.filter(x => x.owed > 0)) lines.push(`- War vs ${w.opponent}: took ${w.taken}, made ${w.hits} hits (covers ${w.covered}) — ${w.owed} too many`);
        lines.push(r.xanax.outstanding > 0
            ? `${r.xanax.returned ? `You have already put back ${r.xanax.returned}. ` : ''}Please put ${r.xanax.outstanding} Xanax back in the faction armory.`
            : 'You have already put them all back — thank you!');
    }
    // earlier
    const prev = r.history.find(h => h.kind === 'warning' || h.kind === 'probation' || h.kind === 'excused');
    if (prev) lines.push('', `Earlier: on ${evDate(prev.date)} this was noted for you — ${prev.verdict || EV_KIND_LABEL[prev.kind]}${prev.note && prev.source === 'manual' ? ` (${prev.note})` : ''}.`);
    lines.push('');
    if (soft) lines.push('There is no pressure — you are new, so you have some time to find your feet. But please do ask us for help if you need anything: tips on training or war hits, someone to show you the ropes, or a schedule that works for you. And feel free to tell us your plans and how it is going so far.');
    else if (r.fails) lines.push('Could you let me know what your plans are, and whether you expect this to improve next month? If something is going on (offline, ill, busy, a different play style) just say so and we will take it into account.', '', 'And is there anything we can do to help you improve? Tips on training or the war, a different schedule, a mentor — just tell us what would make it easier for you.');
    else if (r.light === 'grey' && r.pct === null) lines.push('Welcome to the faction! We do not have enough data to judge yet — if you need anything at all, just ask us.');
    else lines.push('You are meeting both of the requirements — thank you, keep it up!');
    lines.push('', 'Thanks!', 'Lots of Love', 'Crea <3');
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
        <div><div style="color:var(--muted);font-size:11px;">New, settling in</div><div style="font-weight:700;color:${EV_STATUS.new[1]};">${count('new')}</div></div>
        <div><div style="color:var(--muted);font-size:11px;">At risk</div><div style="font-weight:700;color:${EV_STATUS.risk[1]};">${count('risk')}</div></div>
        <div><div style="color:var(--muted);font-size:11px;">Below AND warned before</div><div style="font-weight:700;">${rows.filter(r => r.fails && r.warned).length}</div></div>`;
    // the Xanax bar above the table: what is loaded for this period's wars, and the button that loads / refreshes it
    if (!evXan.busy) {
        const wars = evXan.wars, loaded = wars.filter(w => evXan.byWar[w.id]).length, all = loaded === wars.length;
        $('ev-xan-bar').innerHTML = !wars.length
            ? '<span style="color:var(--muted);">Xanax: no war ended in this period.</span>'
            : `<span>🧪 Xanax (wars of this period: ${wars.map(w => esc(w.opponent)).join(', ')}): <b>${loaded} of ${wars.length}</b> checked${evXan.deposits !== null ? ', deposits read' : ', deposits not read yet'}.</span>
               <button class="small" id="ev-xan-load" type="button">${all && evXan.deposits !== null ? 'Re-check deposits' : 'Load Xanax data'}</button>
               ${evXan.note ? `<span style="color:var(--danger);">${esc(evXan.note)}</span>` : ''}`;
        $('ev-xan-load')?.addEventListener('click', () => { evXan.note = ''; evXanLoadAll(all && evXan.deposits !== null); });
    }
    const notes = [];
    if (!evEnergy?.snapshots) notes.push('No training snapshots cover this period yet, so training shows as unknown.');
    else if (evEnergy.partial && evEnergy.sinceDay) notes.push(`Energy trained is only counted since ${moFmt(evEnergy.sinceDay * 86400)} — that is when counting started.`);
    notes.push(`Training target = the member's own tier × the weeks in the period (${Math.round(moWeeksIn(p) * 10) / 10} weeks); war rule = ${moData.settings.minWarHits} war hits (or ${moData.settings.minChainHits} chain hits) in ${moData.settings.needWars} of the last 5 wars.`);
    // which availability plan each war was matched to (and how many members excused themselves in it), so a missing 🚫 can be traced
    const matched = moWarsInPeriod().filter(w => !w.event).map(w => {
        const pl = moData.excusedInfo?.[w.id] || [];
        return `${w.opponent}: ${pl.length ? `${pl.join(', ')} (${Object.keys(moData.excused?.[w.id] || {}).length} excused)` : 'no availability plan found'}`;
    });
    if (matched.length) notes.push(`Availability plans matched to the wars — ${matched.join(' · ')}.`);
    $('ev-notes').innerHTML = notes.map(esc).join('<br>');
    $('ev-below').checked = evOnlyBelow;

    const shown = evOnlyBelow ? below : rows;
    const accessors = {
        name: r => r.name.toLowerCase(),
        war: r => (r.counted ? r.okWars / r.counted : -1),
        train: r => (r.pct === null ? -1 : r.pct),
        xan: r => (r.xanax.known ? r.xanax.outstanding : -1),
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
                <th data-sort="xan" style="padding:4px 8px;">Xanax</th>
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
                    <td style="padding:6px 8px;white-space:nowrap;font-family:var(--mono);">${r.xanax.known ? (r.xanax.outstanding > 0 ? `<span style="color:${MO_LIGHT.red};font-weight:700;" title="Took more Xanax than the hits covered and has not put it back">${r.xanax.outstanding} to return</span>` : r.xanax.owed > 0 ? `<span style="color:${MO_LIGHT.green};" title="Put it all back">✓ returned</span>` : `<span style="color:${MO_LIGHT.green};">✓</span>`) : `<span style="color:var(--muted);" title="Press Load Xanax data above the table">…</span>`}${r.xanax.known && !r.xanax.depKnown && r.xanax.owed > 0 ? ' <span style="color:var(--muted);" title="Deposits not checked yet">?</span>' : ''}</td>
                    <td style="padding:6px 8px;white-space:nowrap;color:${stColor};font-weight:600;">${stLabel}${r.fails && r.warned ? ' <span title="Below requirement and has an earlier warning/probation" style="color:var(--danger);">· repeat</span>' : ''}</td>
                    <td style="padding:6px 8px;white-space:nowrap;">${last ? `<span style="color:${EV_KIND_COLOR[last.kind]};">${esc(EV_KIND_LABEL[last.kind])}</span> <span style="color:var(--muted);">${esc(evDate(last.date))}${r.history.length > 1 ? ` · ${r.history.length} entries` : ''}</span>` : '<span style="color:var(--muted);">—</span>'}</td>
                </tr>
                ${open ? `<tr class="ev-detail" data-id="${esc(r.id)}"><td colspan="7" style="padding:10px 12px;background:var(--bench-2);white-space:normal;">${evDetailHtml(r)}</td></tr>` : ''}`;
            }).join('')}</tbody>
        </table>`;
    wireSort($('ev-table'), evSort, shown, accessors, renderEvaluation);
    renderXanaxPanel();
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
    const x = r.xanax;
    const xanHtml = !x.rows.length
        ? `<div style="color:var(--muted);font-size:12px;">${evXan.wars.length ? 'Not loaded yet — press Load Xanax data above the table.' : 'No war ended in this period.'}</div>`
        : x.rows.map(w => `<div style="font-size:12px;margin-bottom:3px;"><b>War vs ${esc(w.opponent)}:</b> took ${w.taken}, ${w.hits} hits (covers ${w.covered})${w.owed ? ` — <span style="color:${MO_LIGHT.red};font-weight:700;">${w.owed} to put back</span>${w.returned ? `, ${w.returned} returned` : ''}` : ' — ✓'}</div>`).join('')
            + (x.depKnown ? '' : '<div style="color:var(--muted);font-size:11px;">What has been put back is not checked yet.</div>');
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
                <div style="color:var(--muted);font-size:11px;margin-bottom:4px;">Xanax per war (wars of this period)</div>
                ${xanHtml}
                <div style="height:10px;"></div>
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
    await evXanLoadCached(); // the Xanax of that period's wars (saved answers only)
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

// ---- Xanax check: taken from the armory vs hits made, per war (a test panel — it does not change any status or message yet) ----
// Xanax counts come from the armory log (api/armory-tracker.js 'xanax-war-scan', kept for finished wars); the hits are the ones Member
// Overview already stored for that war (war hits + chain hits). Each Xanax covers 10 hits, rounded up: 4 taken, 25 hits = 3 covered, 1 to put back.
let evXanLast = null;
async function evXanFetch(body) {
    const res = await fetch('/api/armory-tracker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    return res.json();
}
function renderXanaxPanel() {
    const sel = $('ev-xan-war');
    if (!sel || !moData) return;
    const wars = moWarsInPeriod().filter(w => !w.event).slice().reverse(); // newest first
    const keep = sel.value;
    sel.innerHTML = wars.map(w => `<option value="${esc(w.id)}">War vs ${esc(w.opponent)} — ended ${moFmt(w.end)}</option>`).join('') || '<option value="">No wars</option>';
    if (keep && wars.some(w => w.id === keep)) sel.value = keep;
}
function evXanRows(r) {
    const hits = (moData.hits || {})[r.warId] || {};
    return Object.entries(r.taken || {}).map(([id, t]) => {
        const m = moData.members.find(x => x.id === id || x.name.toLowerCase() === String(t.name).toLowerCase());
        const h = hits[m ? m.id : id] || {};
        const nHits = (h.war || 0) + (h.chain || 0);
        const covered = Math.ceil(nHits / 10);
        return { name: m ? m.name : t.name, taken: t.n, hits: nHits, covered, back: Math.max(0, t.n - covered) };
    }).sort((a, b) => b.back - a.back || b.taken - a.taken);
}
function evXanRender() {
    const r = evXanLast;
    if (!r) return;
    const rows = evXanRows(r);
    const back = rows.filter(x => x.back > 0);
    const lead = r.leadHours;
    const notes = [];
    if (r.cached) notes.push('from the saved answer for this war');
    if (r.rateLimited || r.hitPageCap) notes.push('<span style="color:var(--danger);">the armory log could not be read completely — some Xanax may be missing; try again in a minute</span>');
    if (r.unparsed) notes.push(`${r.unparsed} armory lines were not recognised`);
    $('ev-xan-status').className = 'status ok';
    $('ev-xan-status').innerHTML = `${rows.length} member${rows.length === 1 ? '' : 's'} took Xanax from ${lead ? `${lead} h before the war start` : 'the war start'} until 24 h after it; <b>${back.length}</b> should put some back (${back.reduce((s, x) => s + x.back, 0)} Xanax in total).${notes.length ? ` (${notes.join(' · ')})` : ''}`;
    $('ev-xan-table').innerHTML = rows.length ? `<table style="width:100%;font-size:13px;border-collapse:collapse;"><thead><tr style="color:var(--muted);text-align:left;"><th style="padding:4px 8px;">Member</th><th style="padding:4px 8px;">Xanax taken</th><th style="padding:4px 8px;">Hits (war + chain)</th><th style="padding:4px 8px;">Xanax covered</th><th style="padding:4px 8px;">To put back</th></tr></thead>
        <tbody>${rows.map(x => `<tr style="border-top:1px solid var(--line);"><td style="padding:4px 8px;">${esc(x.name)}</td><td style="padding:4px 8px;font-family:var(--mono);">${x.taken}</td><td style="padding:4px 8px;font-family:var(--mono);">${x.hits}</td><td style="padding:4px 8px;font-family:var(--mono);">${x.covered}</td><td style="padding:4px 8px;font-family:var(--mono);font-weight:700;color:${x.back ? MO_LIGHT.red : MO_LIGHT.green};">${x.back || '✓'}</td></tr>`).join('')}</tbody></table>` : '<p style="color:var(--muted);">Nobody took Xanax from the armory in that window.</p>';
    $('ev-xan-copy').style.display = back.length ? '' : 'none';
}
$('ev-xan-run').addEventListener('click', async () => {
    const btn = $('ev-xan-run'), st = $('ev-xan-status'), warId = $('ev-xan-war').value;
    if (!warId) return;
    btn.disabled = true; st.className = 'status ok'; st.textContent = 'Reading the armory log for that war… (this can take up to a minute)';
    try {
        const r = await evXanFetch({ action: 'xanax-war-scan', warId, leadHours: Number($('ev-xan-lead').value) });
        if (r.error) throw new Error(r.error);
        evXanLast = r;
        evXanRender();
    } catch (e) { st.className = 'status err'; st.textContent = e.message; } finally { btn.disabled = false; }
});
$('ev-xan-copy').addEventListener('click', () => {
    if (!evXanLast) return;
    const war = moWarsInPeriod().find(w => w.id === evXanLast.warId);
    const text = `Xanax to put back in the armory (war vs ${war ? war.opponent : evXanLast.warId}) — every Xanax covers 10 hits:\n` + evXanRows(evXanLast).filter(x => x.back > 0).map(x => `${x.name}: took ${x.taken}, made ${x.hits} hits → put back ${x.back}`).join('\n');
    navigator.clipboard.writeText(text).then(() => toast('Copied'));
});

// ---- Xanax in the evaluation ----
// Only wars that ended inside the picked period are judged for Xanax (the war rule still looks at the last 5). Per war: Xanax taken from the
// armory from 48 h before the start until 24 h after the end (api/armory-tracker.js 'xanax-war-scan', kept per finished war) against the hits
// made in that war (Member Overview's stored war + chain hits); each Xanax covers 10 hits, rounded up. Xanax put back since the first of these
// wars (deposit lines in the armory log) is allocated to the oldest war first, so one deposit is never counted against two wars.
const EV_XAN_LEAD = 48;
let evXan = { wars: [], byWar: {}, deposits: null, busy: false, note: '' };
function evPeriodWars() {
    const p = evPeriod();
    return moWarsInPeriod().filter(w => !w.event && w.end >= p.start && (p.id === 'now' || w.end < p.end)).sort((a, b) => a.end - b.end);
}
const evXanMatch = (map, m) => (map && (map[m.id] || Object.values(map).find(v => String(v.name).toLowerCase() === m.name.toLowerCase()))) || null;
async function evXanLoadCached() {
    evXan.wars = evPeriodWars();
    evXan.byWar = {}; evXan.deposits = null;
    if (!evXan.wars.length) return;
    try {
        const g = await evXanFetch({ action: 'xanax-war-get', warIds: evXan.wars.map(w => w.id), leadHours: EV_XAN_LEAD });
        evXan.byWar = g.error ? {} : (g.wars || {});
        const from = Math.min(...evXan.wars.map(w => w.start)) - EV_XAN_LEAD * 3600;
        const d = await evXanFetch({ action: 'xanax-deposits', from, cacheOnly: true });
        evXan.deposits = d.error || d.none ? null : (d.deposited || {});
    } catch (e) { /* the Xanax column just shows it has not been loaded */ }
}
// One member's Xanax picture for this period (known = every war of the period has been checked)
function evXanFor(m) {
    const wars = evXan.wars;
    const known = wars.length > 0 && wars.every(w => evXan.byWar[w.id]);
    const rows = [];
    for (const w of wars) {
        const res = evXan.byWar[w.id];
        if (!res) continue;
        const taken = (evXanMatch(res.taken, m) || { n: 0 }).n;
        const h = (moData.hits[w.id] || {})[m.id] || {};
        const hits = (h.war || 0) + (h.chain || 0);
        const covered = Math.ceil(hits / 10);
        rows.push({ warId: w.id, opponent: w.opponent, taken, hits, covered, owed: Math.max(0, taken - covered), returned: 0, outstanding: 0 });
    }
    const depKnown = evXan.deposits !== null;
    let rem = depKnown ? (evXanMatch(evXan.deposits, m) || { n: 0 }).n : 0;
    for (const r of rows) { r.returned = Math.min(r.owed, rem); rem -= r.returned; r.outstanding = r.owed - r.returned; }
    return { known, depKnown, rows, owed: rows.reduce((s, r) => s + r.owed, 0), returned: rows.reduce((s, r) => s + r.returned, 0), outstanding: rows.reduce((s, r) => s + r.outstanding, 0) };
}
// The "Load Xanax data" button: checks every war of the period that has no saved answer yet (one at a time — each reads the armory log), then
// the deposits since the first of them, and redraws the evaluation.
async function evXanLoadAll(forceDep) {
    if (evXan.busy) return;
    evXan.busy = true;
    const bar = $('ev-xan-bar');
    try {
        const todo = evXan.wars.filter(w => !evXan.byWar[w.id]);
        for (let i = 0; i < todo.length; i++) {
            bar.textContent = `Xanax: reading the armory log for the war vs ${todo[i].opponent} (${i + 1} of ${todo.length})… this can take up to a minute each`;
            const r = await evXanFetch({ action: 'xanax-war-scan', warId: todo[i].id, leadHours: EV_XAN_LEAD });
            if (r.error) throw new Error(`War vs ${todo[i].opponent}: ${r.error}`);
            if (r.rateLimited || r.hitPageCap) evXan.note = 'The armory log could not be read completely for some war — press the button again in a minute.';
            evXan.byWar[todo[i].id] = r;
        }
        bar.textContent = 'Xanax: reading what has been put back…';
        const from = Math.min(...evXan.wars.map(w => w.start)) - EV_XAN_LEAD * 3600;
        const d = await evXanFetch({ action: 'xanax-deposits', from, force: !!forceDep });
        if (d.error) throw new Error(d.error);
        evXan.deposits = d.deposited || {};
        if (d.rateLimited || d.hitPageCap) evXan.note = 'The deposits could not be read completely — press the button again in a minute.';
    } catch (e) { evXan.note = e.message; }
    evXan.busy = false;
    renderEvaluation();
}
