// newsletter.js — the "Newsletter" page (Leadership menu): builds a DRAFT of the monthly newsletter from what WWL
// already knows, in Discord-sized parts a leader can adjust and copy:
//   1. competition winners (from Member Overview, incl. energy trained) for the chosen newsletter period
//   2. the Steadfast perks of this month and next month (the rotation in faction-perks.js) + how the countdown stands
//   3. respect gained in the period and the perks upgraded (from the daily lines kept by lib/steadfast.js, so these
//      two fill up from the day this page went live) + what the perk roadmap unlocks next
// Nothing is posted anywhere — every part is a text box with a Copy button.
'use strict';

const NL_MAX = 1900; // Discord's limit is 2000 characters per message
const nlNum = n => Math.round(n).toLocaleString();
const nlPerkName = k => k.replace(/^steadfast (\w+)$/, (m, s) => `${s[0].toUpperCase()}${s.slice(1)} Steadfast`).replace(/^./, c => c.toUpperCase());

async function loadNewsletter() {
    const locked = !isLeaderCached;
    $('nl-locked').style.display = locked ? 'block' : 'none';
    $('nl-body').style.display = locked ? 'none' : 'block';
    if (locked) return;
    if (!$('nl-period').options.length) {
        const list = moPeriods().filter(p => p.id.startsWith('p'));
        $('nl-period').innerHTML = list.map(p => `<option value="${p.id}">${esc(`${moFmt(p.start)} → ${moFmt(p.end)}`)}</option>`).join('');
    }
}

function nlSplit(text) { // cut a long text into parts below Discord's limit, at blank lines
    const parts = [];
    let cur = '';
    for (const block of text.split(/\n\n/)) {
        if ((cur + '\n\n' + block).length > NL_MAX && cur) { parts.push(cur); cur = block; } else cur = cur ? `${cur}\n\n${block}` : block;
    }
    if (cur) parts.push(cur);
    return parts;
}

async function buildNewsletter() {
    const st = $('nl-status'), btn = $('nl-build');
    btn.disabled = true; st.className = 'status ok';
    try {
        const period = moPeriods().find(p => p.id === $('nl-period').value);
        if (!period) throw new Error('Pick a period first.');
        const sections = [];

        // 1. winners — the same numbers as Member Overview for this period
        st.textContent = 'Reading the competition numbers (this can take a minute the first time)…';
        moPeriodId = period.id; moPerWeek = false;
        await loadMemberOverview();
        const medal = ['🥇', '🥈', '🥉'];
        const fmt = v => Math.round(v).toLocaleString();
        const winners = moData ? moWinners(moRows()) : [];
        sections.push({ title: '🏆 Competition winners', text: `🏆 **Competition winners — ${moFmt(period.start)} → ${moFmt(period.end)}**\n\n` + (winners.length ? winners.map(w =>
            `**${w.label}**\n${w.top.length ? w.top.map((t, i) => `${medal[i]} ${t.name} — ${fmt(t.value)}`).join('\n') : '(no data)'}`).join('\n\n') : '(the competition numbers could not be read — open Member Overview once and try again)') });

        // 2. Steadfast perks this month and next month
        st.textContent = 'Reading the Steadfast numbers…';
        const endDate = new Date(period.end * 1000);
        const month = endDate.getUTCMonth() + 1, next = month % 12 + 1;
        const role = arr => `**${arr.slice(0, 2).map(s => FP_LABEL[s]).join(' & ')}** get the top perk, ${arr.slice(2).map(s => FP_LABEL[s]).join(' & ')} the lower one`;
        let steadfast = `💪 **Steadfast perks**\n\n**${FP_MONTHS[month - 1]}:** ${role(FP_ROTATION[month])}\n**${FP_MONTHS[next - 1]}:** ${role(FP_ROTATION[next])}\n(swapped on the first Sunday of the month)`;
        const sf = await moFetch({ action: 'steadfast-get' });
        const cd = sf.countdown;
        if (cd?.rows?.length) {
            steadfast += '\n\n**Countdown to the next Steadfast level**\n' + cd.rows.map(r => `${FP_LABEL[r.stat]}: ${r.goal ? `${nlNum(r.total)} / ${nlNum(r.goal)}${r.done ? ' ✅' : ''}` : 'n/a'} (now ${r.pct}%)`).join('\n');
        }
        sections.push({ title: '💪 Steadfast', text: steadfast });

        // 3. respect gained + perks upgraded
        st.textContent = 'Reading respect and perks…';
        const nl = await moFetch({ action: 'steadfast-newsletter', from: period.start, to: period.end });
        let prog = '📈 **Respect & perks**\n\n';
        if (nl.error) prog += `(could not be read: ${nl.error})`;
        else if (!nl.available) prog += '(respect gained and perks upgraded are kept from the day this page went live — they will be filled in from the next newsletter on)';
        else {
            const from = new Date(nl.startDay * 86400e3).toISOString().slice(0, 10), to = new Date(nl.endDay * 86400e3).toISOString().slice(0, 10);
            prog += nl.respectFrom != null && nl.respectTo != null ? `**Respect gained:** +${nlNum(nl.respectTo - nl.respectFrom)} (${from} → ${to}), now ${nlNum(nl.respectTo)} in total\n` : '**Respect gained:** (not available)\n';
            prog += nl.upgraded.length ? `\n**Perks upgraded**\n${nl.upgraded.map(u => {
                const st2 = /^steadfast (\w+)$/.exec(u.perk);
                return st2 ? `⬆️ ${nlPerkName(u.perk)}: ${nl.steadfastFrom[st2[1]] ?? '?'}% → ${nl.steadfastTo[st2[1]] ?? '?'}%` : `⬆️ ${nlPerkName(u.perk)}: level ${u.from} → ${u.to}`;
            }).join('\n')}` : '\nNo perks were upgraded in this period.';
        }
        // what the roadmap unlocks next (from the real levels)
        const levels = cd?.allLevels || {};
        const todo = FP_ROADMAP.filter(([perk, level]) => (levels[perk.toLowerCase()] || 0) < level).slice(0, 3);
        if (todo.length) prog += `\n\n**Up next on the perk roadmap**\n${todo.map(([perk, level, respect, date]) => `▫️ ${perk} ${fpRoman(level)} — needs ${nlNum(respect)} respect, planned ${fpDateLabel(date)}`).join('\n')}`;
        sections.push({ title: '📈 Respect & perks', text: prog });

        renderNewsletter(sections);
        st.textContent = '';
    } catch (e) { st.className = 'status err'; st.textContent = e.message; }
    finally { btn.disabled = false; }
}

function renderNewsletter(sections) {
    const parts = sections.flatMap(s => nlSplit(s.text).map((t, i, a) => ({ title: a.length > 1 ? `${s.title} (${i + 1}/${a.length})` : s.title, text: t })));
    $('nl-parts').innerHTML = parts.map((p, i) => `
        <div class="panel">
            <div style="display:flex;gap:10px;align-items:center;margin-bottom:6px;"><h3 style="margin:0;">${esc(p.title)}</h3><span class="nl-count" data-i="${i}" style="margin-left:auto;font-size:12px;color:var(--muted);"></span><button class="ghost small nl-copy" data-i="${i}">Copy</button></div>
            <textarea class="nl-text" data-i="${i}" rows="${Math.min(22, p.text.split('\n').length + 1)}" style="width:100%;font-family:var(--mono);font-size:13px;">${esc(p.text)}</textarea>
        </div>`).join('');
    const count = i => { const t = document.querySelector(`.nl-text[data-i="${i}"]`); const c = document.querySelector(`.nl-count[data-i="${i}"]`); c.textContent = `${t.value.length} / 2000`; c.style.color = t.value.length > 2000 ? 'var(--danger)' : 'var(--muted)'; };
    document.querySelectorAll('.nl-text').forEach(t => { count(t.dataset.i); t.addEventListener('input', () => count(t.dataset.i)); });
    document.querySelectorAll('.nl-copy').forEach(b => b.addEventListener('click', () => {
        navigator.clipboard.writeText(document.querySelector(`.nl-text[data-i="${b.dataset.i}"]`).value).then(() => toast('Copied — paste it in Discord'));
    }));
    $('nl-parts').insertAdjacentHTML('afterbegin', '<p style="color:var(--muted);font-size:13px;margin:0 0 10px;">This is a draft — change anything you like in the boxes, then press Copy on each part and paste them in Discord in this order.</p>');
}

$('nl-build').addEventListener('click', buildNewsletter);
