// newsletter.js — the "Newsletter" page (Leadership menu): builds a DRAFT of the monthly newsletter from what WWL
// already knows, for Torn (so: no emoji, no markup characters):
//   1. the winner of each competition (from Member Overview, incl. energy trained) for the chosen period
//   2. the Steadfast perks set now and next month (the rotation in faction-perks.js)
//   3. respect gained in the period (exact, from the respect tracker), the perks upgraded (daily lines kept by
//      lib/steadfast.js) and the perks coming up next (the roadmap)
// Shown as a styled card (copy with formatting) and as plain text boxes. Nothing is posted anywhere.
'use strict';

const nlNum = n => Math.round(n).toLocaleString();
const nlPerkName = k => k.replace(/^steadfast (\w+)$/, (m, s) => `${s[0].toUpperCase()}${s.slice(1)} Steadfast`).replace(/^./, c => c.toUpperCase());

// ---- "Sent this month": the war related role changes (to Chemist and back down) wait until the newsletter with the check-in messages is marked as sent here ----
let nlSent = null;
function nlRenderSent() {
    const s = nlSent; if (!s) return;
    const from = new Date(s.cycle).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    $('nl-sent-text').innerHTML = s.sent
        ? `<span style="color:var(--reagent);font-weight:700;">✓ Marked as sent</span>${s.at ? ` on ${esc(new Date(s.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}` : ''}${s.by ? ` by ${esc(s.by)}` : ''} (month from ${esc(from)}): the war related role changes are open.`
        : `Not marked yet for the month from ${esc(from)}: the war related role changes wait.`;
    $('nl-sent-btn').textContent = s.sent ? 'Take the mark back' : '✓ Newsletter and check-in messages sent';
}
async function nlLoadSent() {
    try { const r = await moFetch({ action: 'checkin-sent-get' }); if (!r.error) { nlSent = r; nlRenderSent(); } } catch (e) { /* the page still works */ }
}
$('nl-sent-btn').addEventListener('click', async () => {
    const b = $('nl-sent-btn'); b.disabled = true;
    try { const r = await moFetch({ action: 'checkin-sent-set', on: !(nlSent && nlSent.sent) }); if (!r.error) { nlSent = r; nlRenderSent(); toast(r.sent ? 'Marked as sent: the war related role changes are open' : 'Mark taken back'); } else toast(r.error); }
    catch (e) { toast('Could not save that'); }
    finally { b.disabled = false; }
});

async function loadNewsletter() {
    const locked = !canEditLeaderOnly; // Leader/Co-leader only end to end — see AUDIT.md
    $('nl-locked').style.display = locked ? 'block' : 'none';
    $('nl-body').style.display = locked ? 'none' : 'block';
    if (locked) return;
    nlLoadSent();
    {
        // Listed running-period-first (if a full week has passed since the last newsletter), then the
        // finished ones, and it DEFAULTS to the running one (the same as Member Overview and the Energy tracker);
        // when none is running yet (the very first day of a cycle) it falls back to the last finished one.
        const keep = $('nl-period').value;
        const list = moPeriods().filter(p => p.id === 'now' || p.id.startsWith('p'));
        $('nl-period').innerHTML = list.map(p => `<option value="${p.id}">${esc(p.id === 'now' ? `Current period (so far) — ${moFmt(p.start)} → ${moFmt(p.end)}` : `${moFmt(p.start)} → ${moFmt(p.end)}`)}</option>`).join('');
        if (keep && list.some(p => p.id === keep)) $('nl-period').value = keep;
        else { const first = list.find(p => p.id === 'now' && p.end > p.start) || list.find(p => p.id.startsWith('p')) || list[0]; if (first) $('nl-period').value = first.id; } // a period that only started today is listed, but the finished one is what is sent
    }
}

// A section is { title, groups: [{ head, rows: [[label, value], ...], note }] }. The same data is drawn twice:
// as plain text (editable boxes, no emoji or markup, since Torn shows markup characters literally) and as a styled
// card that can be copied with its formatting.
const nlDay = ts => new Date(ts * 1000).toISOString().slice(0, 10);

function nlPlain(s) {
    if (s.raw) return s.lines.join('\n'); // free text (intro / closing), no heading
    return [s.title.toUpperCase(), ...s.groups.map(g => [g.head || '', ...(g.rows || []).map(([l, v]) => l ? `${l}: ${v}` : v), g.note || ''].filter(Boolean).join('\n'))].join('\n\n');
}

const NL_CSS = { bg: '#161a20', panel: '#1d232b', line: '#2b333d', text: '#e6ebf0', muted: '#8f9aa6', green: '#35d99b' };
function nlCardHtml(title, sections) {
    const c = NL_CSS;
    return `<div style="background:${c.bg};color:${c.text};font-family:Arial,Helvetica,sans-serif;border:1px solid ${c.line};border-top:3px solid ${c.green};padding:18px 20px;max-width:640px;">
        <div style="font-size:20px;font-weight:bold;letter-spacing:1px;margin-bottom:2px;">${esc(title)}</div>
        <div style="font-size:12px;color:${c.muted};margin-bottom:14px;">World Wide Labs</div>
        ${sections.map(s => s.raw ? `<div style="font-size:14px;margin:0 0 12px;line-height:1.5;">${s.lines.map(esc).join('<br>')}</div>` : `
        <div style="background:${c.panel};border:1px solid ${c.line};border-left:3px solid ${c.green};padding:12px 14px;margin-bottom:12px;">
            <div style="font-size:14px;font-weight:bold;letter-spacing:1px;color:${c.green};margin-bottom:8px;">${esc(s.title.toUpperCase())}</div>
            ${s.groups.map(g => `
            ${g.head ? `<div style="font-size:13px;font-weight:bold;margin:8px 0 4px;">${esc(g.head)}</div>` : ''}
            ${(g.rows || []).length ? `<table style="width:100%;border-collapse:collapse;font-size:13px;">${g.rows.map(([l, v]) => `<tr><td style="padding:3px 12px 3px 0;color:${c.muted};vertical-align:top;white-space:nowrap;">${esc(l)}</td><td style="padding:3px 0;text-align:right;color:${c.text};">${esc(v)}</td></tr>`).join('')}</table>` : ''}
            ${g.note ? `<div style="font-size:12px;color:${c.muted};margin-top:6px;">${esc(g.note)}</div>` : ''}`).join('')}
        </div>`).join('')}
    </div>`;
}

async function buildNewsletter() {
    const st = $('nl-status'), btn = $('nl-build');
    btn.disabled = true; st.className = 'status ok';
    try {
        const period = moPeriods().find(p => p.id === $('nl-period').value);
        if (!period) throw new Error('Pick a period first.');
        const running = period.id === 'now';
        const range = `${moFmt(period.start)} to ${moFmt(period.end)}${running ? ' (so far)' : ''}`;
        const sections = [{ title: 'Intro', raw: true, lines: ['Hey everyone!', '', 'Here is our monthly wrap up of everything we have accomplished together, and all the things to look forward to this coming month.'] }];

        // 1. winners: only the winner of each competition; the runners-up are on the Member Overview page
        st.textContent = 'Reading the competition numbers (this can take a minute the first time)...';
        moPeriodId = period.id; moPerWeek = false;
        await loadMemberOverview();
        const fmt = v => Math.round(v).toLocaleString();
        const winners = moData ? moWinners(moRows()) : [];
        sections.push({ title: 'Winners lead-in', raw: true, lines: ['A huge congrats to our winners! You made this month shine.'] });
        sections.push({ title: 'Competition winners', groups: [{
            head: range,
            rows: winners.length ? winners.map(w => [w.label, w.top.length ? `${w.top[0].name} (${fmt(w.top[0].value)})` : 'no data']) : [['', 'The competition numbers could not be read - open Member Overview once and try again.']],
            note: 'Runners-up and the full standings are on WWL, under Faction, Competition.',
        }] });

        // 2. Steadfast: the swap that happens now, and next month
        st.textContent = 'Reading the Steadfast numbers...';
        const endDate = new Date(running ? Date.now() : period.end * 1000); // a running period is about the month we are in
        const month = endDate.getUTCMonth() + 1, next = month % 12 + 1;
        const swap = m => [['Top perk', FP_ROTATION[m].slice(0, 2).map(s => FP_LABEL[s]).join(' and ')], ['Lower perk', FP_ROTATION[m].slice(2).map(s => FP_LABEL[s]).join(' and ')]];
        sections.push({ title: 'Steadfast perks', groups: [
            { head: `${FP_MONTHS[month - 1]} - set now`, rows: swap(month) },
            { head: `Next month - ${FP_MONTHS[next - 1]}`, rows: swap(next), note: 'The perks are swapped on the first Sunday of every month.' },
        ] });

        // 3. respect gained (exact, from the respect tracker) + perks upgraded + the perks coming up
        st.textContent = 'Reading respect and perks...';
        const groups = [];
        try {
            const rd = await respectFetch({ action: 'read' });
            if (rd.error) throw new Error(rd.error);
            const all = respectComputeDaily(rd.ocDaily || {}, rd.chainDaily || {}, rd.hitsDaily || {}, rd.warBonusDaily || {}, rd.warEntries || [], rd.lossDaily || {});
            const from = nlDay(period.start), to = running ? nlDay(Math.floor(Date.now() / 1000) + 86400) : nlDay(period.end); // days from the start, up to but not including the end Sunday (a running period includes today)
            const inRange = all.filter(r => r.date >= from && r.date < to);
            const sum = k => inRange.reduce((s, r) => s + (r[k] || 0), 0);
            const earliest = all.length ? all[all.length - 1].date : null;
            if (!inRange.length) groups.push({ head: 'Respect gained', rows: [['', 'The respect tracker has no days in this period.']] });
            else groups.push({
                head: 'Respect gained',
                rows: [['Total', `+${nlNum(sum('totalGain'))}`], ['Organized crimes', nlNum(sum('oc'))], ['Hits and chains (after losses)', nlNum(sum('hits') + sum('chains') + sum('losses'))], ['War bonuses', nlNum(sum('war'))]],
                note: earliest && earliest > from ? `The respect tracker has data from ${earliest} on, so the start of this period is missing.` : '',
            });
        } catch (e) { groups.push({ head: 'Respect gained', rows: [['', `The respect tracker could not be read: ${e.message}`]] }); }

        const nl = await moFetch({ action: 'steadfast-newsletter', from: period.start, to: period.end });
        let levels = {};
        try { levels = (await moFetch({ action: 'steadfast-get' })).countdown?.allLevels || {}; } catch (e) { /* only used for the "up next" list */ }
        if (nl.error) groups.push({ head: 'Perks upgraded', rows: [['', `Could not be read: ${nl.error}`]] });
        else if (!nl.available) groups.push({ head: 'Perks upgraded', rows: [['', 'Not recorded for this period - perk levels are kept daily from the day this page went live.']] });
        else groups.push({
            head: 'Perks upgraded',
            rows: nl.upgraded.length ? nl.upgraded.map(u => {
                const sf = /^steadfast (\w+)$/.exec(u.perk);
                return sf ? [nlPerkName(u.perk), `${nl.steadfastFrom[sf[1]] ?? '?'}% to ${nl.steadfastTo[sf[1]] ?? '?'}%`] : [nlPerkName(u.perk), `level ${u.from} to ${u.to}`];
            }) : [['', 'No perks were upgraded in this period.']],
            note: nl.startDay * 86400 > period.start + 86400 ? `Perk levels have been recorded since ${nlDay(nl.startDay * 86400)}, so earlier upgrades in this period are missing.` : '',
        });
        const todo = FP_ROADMAP.filter(([perk, level]) => level > 0 && (levels[perk.toLowerCase()] || 0) < level).slice(0, 3);
        if (todo.length) groups.push({ head: 'Up next', rows: todo.map(([perk, level, respect, date]) => [fpPerk(perk, level), `needs ${nlNum(respect)} respect, planned ${fpDateLabel(date)}`]) });
        sections.push({ title: 'Respect and perks', groups });

        sections.push({ title: 'Closing', raw: true, lines: ['Lots of Love', 'Crea <3'] });
        renderNewsletter(sections, `Newsletter - ${moFmt(period.start)} to ${moFmt(period.end)}`);
        st.textContent = '';
    } catch (e) { st.className = 'status err'; st.textContent = e.message; }
    finally { btn.disabled = false; }
}

// Announcements: one free-text box that sits after the last section and before the closing lines, so it goes into
// both the preview card and the plain-text copy. Kept in this browser so a reload does not lose it.
let nlAnnounce = '';
try { nlAnnounce = localStorage.getItem('wwl_nl_announce') || ''; } catch (e) { /* just starts empty */ }

function renderNewsletter(parts, title) {
    // the closing lines are always last; the announcements go right before them
    const closing = parts.filter(s => s.title === 'Closing'), body = parts.filter(s => s.title !== 'Closing');
    const full = () => [...body, ...(nlAnnounce.trim() ? [{ title: 'Announcements', raw: true, lines: nlAnnounce.trim().split('\n') }] : []), ...closing];
    const cardHtml = () => nlCardHtml(title, full());
    $('nl-parts').innerHTML = `
        <div class="panel">
            <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;flex-wrap:wrap;"><h3 style="margin:0;">Preview</h3>
                <span style="margin-left:auto;"></span>
                <button class="ghost small" id="nl-copy-rich">Copy formatted</button>
                <button class="ghost small" id="nl-copy-all">Copy as plain text</button></div>
            <div id="nl-card" style="overflow-x:auto;">${cardHtml()}</div>
            <p style="color:var(--muted);font-size:12px;margin:8px 0 0;">"Copy formatted" copies the preview with its formatting (paste it into the Torn editor and see what it keeps); "Copy as plain text" copies the same thing without any formatting.</p>
        </div>
        <div class="panel">
            <h3 style="margin:0 0 6px;">Announcements</h3>
            <p style="color:var(--muted);font-size:12px;margin:0 0 6px;">Anything you type here is added after the last section and before the closing lines. Leave it empty to skip it.</p>
            <textarea id="nl-announce" rows="6" style="width:100%;font-size:13px;" placeholder="Write your announcements here…">${esc(nlAnnounce)}</textarea>
        </div>`;
    $('nl-announce').addEventListener('input', () => {
        nlAnnounce = $('nl-announce').value;
        try { localStorage.setItem('wwl_nl_announce', nlAnnounce); } catch (e) { /* not remembered */ }
        $('nl-card').innerHTML = cardHtml();
    });
    $('nl-copy-all').addEventListener('click', () => {
        navigator.clipboard.writeText(full().map(nlPlain).join('\n\n')).then(() => toast('Copied'));
    });
    $('nl-copy-rich').addEventListener('click', async () => {
        try {
            const plain = full().map(nlPlain).join('\n\n');
            await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([cardHtml()], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })]);
            toast('Copied with formatting - paste it in the Torn editor');
        } catch (e) { toast('Your browser would not copy formatted text here - use the plain text instead.'); }
    });
}

$('nl-build').addEventListener('click', buildNewsletter);
