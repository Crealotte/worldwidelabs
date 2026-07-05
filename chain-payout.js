// chain-payout.js — the Chain Payout (non-war hits) leadership tool.
'use strict';

    // ================= CHAIN PAYOUT =================
    const chains = [];
    let cpResult = null;

    function parseChainID(input) {
        input = input.trim();
        const m = input.match(/chainID=(\d+)/i);
        if (m) return m[1];
        if (/^\d+$/.test(input)) return input;
        return null;
    }
    function cpStatus(msg, isErr) {
        const el = $('cp-status');
        el.className = 'status ' + (msg ? (isErr ? 'err' : 'ok') : '');
        el.innerHTML = msg || '';
    }
    function renderChainList() {
        const list = $('chain-list');
        list.innerHTML = '';
        chains.forEach((c, i) => {
            const chip = document.createElement('div');
            chip.className = 'chip';
            const meta = c.report ? `${c.report.details?.chain ?? '?'} hits` : 'not loaded';
            chip.innerHTML = `<span class="cid">#${esc(c.id)}</span><span class="meta">${esc(meta)}</span>`;
            const del = document.createElement('button');
            del.textContent = '✕';
            del.addEventListener('click', () => { chains.splice(i, 1); renderChainList(); });
            chip.appendChild(del);
            list.appendChild(chip);
        });
    }
    function addChain() {
        const id = parseChainID($('chain-input').value);
        if (!id) { cpStatus('Enter a chain ID or paste the full chain report URL.', true); return; }
        if (chains.some(c => c.id === id)) { cpStatus(`Chain #${id} is already added.`, true); return; }
        chains.push({ id, report: null });
        $('chain-input').value = '';
        cpStatus('');
        renderChainList();
    }
    $('add-chain').addEventListener('click', addChain);
    $('chain-input').addEventListener('keydown', e => { if (e.key === 'Enter') addChain(); });

    $('cp-calc').addEventListener('click', async () => {
        if (!chains.length) { cpStatus('Add at least one chain ID first.', true); return; }
        const rate = toNumber($('cp-rate').value);
        if (rate <= 0) { cpStatus('Enter a valid $ per hit.', true); return; }
        localStorage.setItem(RATE_STORAGE, $('cp-rate').value);

        const btn = $('cp-calc');
        btn.disabled = true; btn.textContent = 'Fetching…';
        try {
            const nameMap = new Map();
            const namesPromise = tornV2('/faction/members?striptags=true')
                .then(d => (d.members || []).forEach(m => nameMap.set(m.id, m.name)))
                .catch(() => {});

            for (const c of chains) {
                if (!c.report) {
                    const data = await tornV2(`/faction/${c.id}/chainreport`);
                    c.report = data.chainreport;
                }
            }
            await namesPromise;
            renderChainList();

            const players = new Map();
            for (const c of chains) {
                for (const att of (c.report.attackers || [])) {
                    const total = att.attacks?.total ?? 0;
                    const war = att.attacks?.war ?? 0;
                    const nonWar = Math.max(0, total - war);
                    if (!players.has(att.id)) players.set(att.id, { id: att.id, total: 0, war: 0, nonWar: 0, perChain: {} });
                    const p = players.get(att.id);
                    p.total += total; p.war += war; p.nonWar += nonWar;
                    p.perChain[c.id] = (p.perChain[c.id] || 0) + nonWar;
                }
            }

            const list = [...players.values()]
                .map(p => ({ ...p, name: nameMap.get(p.id) || `User #${p.id}`, payout: p.nonWar * rate }))
                .sort((a, b) => b.payout - a.payout);
            const totals = list.reduce((t, p) => ({
                total: t.total + p.total, war: t.war + p.war, nonWar: t.nonWar + p.nonWar, payout: t.payout + p.payout
            }), { total: 0, war: 0, nonWar: 0, payout: 0 });

            cpResult = { list, totals, rate, chainIDs: chains.map(c => c.id) };
            renderPayout();
            cpStatus(`Loaded ${chains.length} chain report(s), ${list.length} members.`, false);
        } catch (e) {
            cpStatus(esc(e.message) + '<br>Your key needs faction chain-report access, and the chains must belong to your faction.', true);
        } finally {
            btn.disabled = false; btn.textContent = 'Calculate';
        }
    });

    function renderPayout() {
        const { list, totals, rate, chainIDs } = cpResult;
        const hideZero = $('cp-hidezero').checked;
        const visible = hideZero ? list.filter(p => p.nonWar > 0) : list;
        const multi = chainIDs.length > 1;

        $('cp-head').innerHTML = `<tr><th>Member</th>
            ${multi ? chainIDs.map(id => `<th class="num">#${esc(id)}</th>`).join('') : ''}
            <th class="num">Total hits</th><th class="num">War hits</th><th class="num">Non-war hits</th>
            <th class="num">Payout @ ${fmt$(rate)}</th></tr>`;

        $('cp-body').innerHTML = visible.map(p => `
            <tr${p.nonWar === 0 ? ' style="opacity:.45"' : ''}>
                <td>${esc(p.name)} [${p.id}]</td>
                ${multi ? chainIDs.map(id => `<td class="num">${p.perChain[id] ?? '—'}</td>`).join('') : ''}
                <td class="num">${p.total}</td><td class="num">${p.war}</td><td class="num">${p.nonWar}</td>
                <td class="num pay">${fmt$(p.payout)}</td>
            </tr>`).join('');

        $('cp-foot').innerHTML = `<tr>
            <td>TOTAL — add to war costs</td>
            ${multi ? chainIDs.map(() => '<td></td>').join('') : ''}
            <td class="num">${totals.total}</td><td class="num">${totals.war}</td>
            <td class="num">${totals.nonWar}</td><td class="num pay">${fmt$(totals.payout)}</td></tr>`;

        $('cp-results-panel').style.display = 'block';
    }
    $('cp-hidezero').addEventListener('change', () => { if (cpResult) renderPayout(); });

    $('cp-copy').addEventListener('click', () => {
        if (!cpResult) return;
        const { list, totals, rate, chainIDs } = cpResult;
        const text = `Chain payout (${chainIDs.map(i => '#' + i).join(' + ')}) — ${fmt$(rate)} per non-war hit\n\n`
            + list.filter(p => p.nonWar > 0).map(p => `${p.name} [${p.id}] — ${p.nonWar} non-war hits — ${fmt$(p.payout)}`).join('\n')
            + `\n\nTOTAL: ${totals.nonWar} non-war hits — ${fmt$(totals.payout)}`;
        navigator.clipboard.writeText(text).then(() => toast('Payout list copied'));
    });

