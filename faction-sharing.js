// faction-sharing.js — the leader-only "Who's on board" roster panel (shown on the dashboard AND, further
// down, on Member Overview — same data, fetched once and reused so opening both in one session doesn't ask
// Torn twice), plus the opt-in snapshot-sharing toggle that lets other factions' leaders see it without a
// shared key.
'use strict';

let adoptionCache = null, adoptionCacheAt = 0; // { logins, members, discordMembers, verifyMap } — good for a few minutes
let adoptionSort = { key: null, dir: 'desc' }; // Who's on board's clickable column sort

async function fetchVerifyMap() {
    try {
        const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, action: 'verify-get' }) });
        const data = await res.json();
        return data.error ? {} : (data.map || {});
    } catch (e) { return {}; }
}

// Stamped by the userscript itself (see 'script-checkin'), at most about once an hour per browser —
// a real "has this member actually opened it recently" signal, not just "installed it once ever".
async function fetchUserscriptMap() {
    try {
        const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, action: 'userscript-get' }) });
        const data = await res.json();
        return data.error ? {} : (data.map || {});
    } catch (e) { return {}; }
}
const US_STALE_MS = 30 * 24 * 60 * 60 * 1000; // seen once but not in the last 30 days — probably uninstalled or stopped using it

// Leaders only: who in the faction has logged into WWLabs, and who hasn't yet. `sfx` picks which set of
// elements to fill in — '' for the dashboard's own panel, '-mo' for the copy on Member Overview.
async function loadAdoption(sfx = '') {
    const panel = $('adoption' + sfx);
    try {
        let data = adoptionCache;
        if (!data || Date.now() - adoptionCacheAt > 3 * 60 * 1000) {
            const [trackData, membersData, discordData, verifyMap, userscriptMap] = await Promise.all([
                fetch('/api/presence', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: apiKey, action: 'list' }),
                }).then(r => r.json()),
                tornV2('/faction/members?striptags=true'),
                fetch('/api/discord-members', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: apiKey }),
                }).then(r => r.json()).catch(() => null),
                fetchVerifyMap(),
                fetchUserscriptMap(),
            ]);
            if (trackData.error) throw new Error(trackData.error);
            data = { logins: trackData.logins || {}, members: (membersData.members || []).slice(), discordMembers: (discordData && !discordData.error) ? discordData.members : null, verifyMap, userscriptMap };
            adoptionCache = data; adoptionCacheAt = Date.now();
        }
        const { logins, members, discordMembers, verifyMap, userscriptMap } = data;

        const defaultOrder = members.slice().sort((a, b) =>
            (logins[b.id]?.last || 0) - (logins[a.id]?.last || 0) || a.name.localeCompare(b.name));
        // Every column is clickable to sort (see core.js's sortRows/wireSort); until one is clicked, it
        // stays in the original most-recently-logged-in-first order.
        const adoptionAccessors = {
            name: m => m.name.toLowerCase(),
            wwl: m => (logins[m.id] ? 1 : 0),
            discord: m => (discordMembers ? (discordMembers[m.id] ? (discordMembers[m.id].verified ? 2 : 1) : 0) : -1),
            exempt: m => (verifyMap[m.id]?.discordExempt ? 1 : 0),
            intel: m => (verifyMap[m.id]?.intel ? 1 : 0),
            cat: m => (verifyMap[m.id]?.cat ? 1 : 0),
            userscript: m => { const at = userscriptMap[m.id] || 0; return !at ? 0 : Date.now() - at > US_STALE_MS ? 1 : 2; },
            last: m => logins[m.id]?.last || 0,
        };
        const sorted = sortRows(defaultOrder, adoptionSort, adoptionAccessors);

        const onboard = sorted.filter(m => logins[m.id]).length;
        $('adoption-summary' + sfx).textContent = discordMembers
            ? `${onboard} of ${sorted.length} members have logged into WWLabs · ${sorted.filter(m => discordMembers[m.id]).length} of ${sorted.length} found in Discord.`
            : `${onboard} of ${sorted.length} members have logged in. (Discord check not set up yet.)`;

        // Torn Intel and CAT can't be checked automatically — a leader clicks the ○/✓ badge to tick a member
        // by hand once they've confirmed it themselves. Not tracked at all for someone not yet on WWLabs.
        // Who's on board is read-only for Council on Member Overview (see AUDIT.md) — this same table is
        // also shown elsewhere (e.g. the main adoption page), which stays editable as before.
        const canVerify = sfx !== '-mo' || typeof canEditLeaderOnly === 'undefined' || canEditLeaderOnly; // only the Member Overview copy is read-only for Council
        const manualBadge = (id, tool, on) => canVerify
            ? `<span class="adopt-verify" data-id="${esc(id)}" data-tool="${tool}" style="cursor:pointer;${on ? 'color:var(--reagent);' : 'color:var(--muted);'}" title="Click to mark ${on ? 'not verified' : 'verified'}">${on ? '✓ verified' : '○ not yet'}</span>`
            : `<span style="${on ? 'color:var(--reagent);' : 'color:var(--muted);'}">${on ? '✓ verified' : '○ not yet'}</span>`;
        // Discord exempt: a member in a country where Discord is banned — clicking this stops the
        // userscript's to-do list nagging them to join/link it. Same click handler as intel/cat, since
        // it's stored in the same manual-verify record; just a different label and sense (on = skip it).
        const exemptBadge = (id, on) => canVerify
            ? `<span class="adopt-verify" data-id="${esc(id)}" data-tool="discordExempt" style="cursor:pointer;${on ? 'color:var(--happy);' : 'color:var(--muted);'}" title="Click to mark ${on ? 'not exempt' : 'exempt (e.g. Discord banned in their country)'}">${on ? '✓ exempt' : '○ no'}</span>`
            : `<span style="${on ? 'color:var(--happy);' : 'color:var(--muted);'}">${on ? '✓ exempt' : '○ no'}</span>`;

        $('adoption-body' + sfx).innerHTML = sorted.map(m => {
            const l = logins[m.id];
            const when = l
                ? new Date(l.last).toLocaleDateString() + ' ' +
                  new Date(l.last).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '';
            let discordCell = '<span style="color:var(--muted);font-size:11px;">—</span>';
            if (discordMembers) {
                const d = discordMembers[m.id];
                discordCell = d
                    ? (d.verified
                        ? '<span style="color:var(--reagent)">● verified</span>'
                        : '<span style="color:var(--happy)">● in server</span>')
                    : '<span style="color:var(--muted)">○ not found</span>';
            }
            const v = verifyMap[m.id] || {};
            const usAt = userscriptMap[m.id] || 0;
            const usCell = !usAt ? '<span style="color:var(--muted)">○ not seen</span>'
                : Date.now() - usAt > US_STALE_MS
                    ? `<span style="color:var(--happy)" title="Last seen ${new Date(usAt).toLocaleDateString()}">● seen, quiet lately</span>`
                    : '<span style="color:var(--reagent)">● installed</span>';
            return `<tr${l ? '' : ' style="opacity:.5"'}>
                <td>${esc(m.name)} [${m.id}]</td>
                <td>${l ? '<span style="color:var(--reagent)">● on board</span>' : '<span style="color:var(--muted)">○ not yet</span>'}</td>
                <td>${discordCell}</td>
                <td>${exemptBadge(m.id, !!v.discordExempt)}</td>
                <td>${manualBadge(m.id, 'intel', !!v.intel)}</td>
                <td>${manualBadge(m.id, 'cat', !!v.cat)}</td>
                <td>${usCell}</td>
                <td class="num" style="font-family:var(--mono);font-size:12px;">${when}</td>
            </tr>`;
        }).join('');
        wireSort($('adoption-body' + sfx).closest('table'), adoptionSort, members, adoptionAccessors, () => loadAdoption(sfx));
        $('adoption-body' + sfx).querySelectorAll('.adopt-verify').forEach(el => el.addEventListener('click', async () => {
            const id = el.dataset.id, tool = el.dataset.tool, next = !(adoptionCache?.verifyMap?.[id]?.[tool]);
            el.style.pointerEvents = 'none';
            try {
                const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, action: 'verify-set', id, tool, value: next }) });
                const r = await res.json();
                if (r.error) throw new Error(r.error);
                if (adoptionCache) { adoptionCache.verifyMap = adoptionCache.verifyMap || {}; adoptionCache.verifyMap[id] = { ...(adoptionCache.verifyMap[id] || {}), [tool]: next }; }
                loadAdoption('-mo'); // Member Overview's own copy — the Dashboard no longer has a duplicate
            } catch (e) { toast(`Couldn't update it: ${e.message}`); el.style.pointerEvents = ''; }
        }));
        panel.style.display = 'block';
    } catch (e) {
        // No server (local file), no database yet, or not a leader — just keep the panel hidden.
        panel.style.display = 'none';
    }
}

    // ================= FACTION SHARING (opt-in, no keys exchanged) =================
    // A leader flips a toggle to share their own faction's roster overview snapshot —
    // built server-side from their own key, refreshed automatically each time they open
    // this dashboard. Other leaders just see the resulting snapshot; nobody's key ever
    // leaves their own faction.
    const DISCORD_LABELS = {
        verified: '<span style="color:var(--reagent)">● verified</span>',
        in_server: '<span style="color:var(--happy)">● in server</span>',
        not_found: '<span style="color:var(--muted)">○ not found</span>',
    };

    // One independent sort state per shared faction (each faction's table sorts on its own).
    const sharedSort = {};
    const sharedAccessors = {
        name: m => m.name.toLowerCase(),
        wwl: m => (m.onWWLabs ? 1 : 0),
        discord: m => (m.discord === 'verified' ? 2 : m.discord === 'in_server' ? 1 : m.discord === null ? -1 : 0),
    };
    function renderSharedFactionTable(data) {
        const onboard = data.members.filter(m => m.onWWLabs).length;
        const hasDiscord = data.members.some(m => m.discord !== null);
        const summary = hasDiscord
            ? `${onboard} of ${data.members.length} on WWLabs · ${data.members.filter(m => m.discord === 'verified').length} of ${data.members.length} verified in Discord.`
            : `${onboard} of ${data.members.length} on WWLabs.`;
        const state = sharedSort[data.factionName] || (sharedSort[data.factionName] = { key: null, dir: 'desc' });
        const rows = sortRows(data.members, state, sharedAccessors).map(m => `
            <tr${m.onWWLabs ? '' : ' style="opacity:.5"'}>
                <td>${esc(m.name)} [${m.id}]</td>
                <td>${m.onWWLabs ? '<span style="color:var(--reagent)">● on board</span>' : '<span style="color:var(--muted)">○ not yet</span>'}</td>
                <td>${m.discord !== null ? (DISCORD_LABELS[m.discord] || '—') : '<span style="color:var(--muted);font-size:11px;">—</span>'}</td>
            </tr>`).join('');
        const ago = Math.round((Date.now() - data.updatedAt) / 60000);
        return `
            <div class="sf-block" data-fac="${esc(data.factionName)}" style="border-top:1px solid var(--line);padding-top:14px;margin-top:14px;">
                <h4 style="margin:0 0 4px;font-size:14px;">${esc(data.factionName)}</h4>
                <p style="color:var(--muted);font-size:12px;margin:0 0 8px;">${summary} · updated ${ago < 1 ? 'just now' : ago + 'm ago'}</p>
                <div class="table-scroll" style="max-height:280px;overflow-y:auto;">
                    <table><thead><tr><th data-sort="name">Member</th><th data-sort="wwl">WWLabs</th><th data-sort="discord">Discord</th></tr></thead>
                    <tbody>${rows}</tbody></table>
                </div>
            </div>`;
    }

    async function loadFactionSharing() {
        try {
            const res = await fetch('/api/faction-share', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: apiKey, action: 'read' }),
            });
            const data = await res.json();
            if (data.error) { $('shared-factions-panel').style.display = 'none'; return; }

            $('share-toggle').checked = !!data.mine?.enabled;
            $('share-status').textContent = data.mine?.enabled
                ? `Sharing · last updated ${new Date(data.mine.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : '';

            if (data.others?.length) {
                $('shared-factions-panel').style.display = 'block';
                const paintShared = () => {
                    $('shared-factions-list').innerHTML = data.others.map(renderSharedFactionTable).join('');
                    $('shared-factions-list').querySelectorAll('.sf-block').forEach(block => {
                        const f = data.others.find(o => o.factionName === block.dataset.fac);
                        if (f) wireSort(block, sharedSort[f.factionName], f.members, sharedAccessors, paintShared);
                    });
                };
                paintShared();
            } else {
                $('shared-factions-panel').style.display = 'none';
            }
        } catch (e) {
            $('shared-factions-panel').style.display = 'none';
        }
    }

    $('share-toggle').addEventListener('change', async () => {
        const cb = $('share-toggle');
        const enabling = cb.checked;
        cb.disabled = true;
        $('share-status').textContent = enabling ? 'Turning on…' : 'Turning off…';
        try {
            const res = await fetch('/api/faction-share', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: apiKey, action: 'toggle', enabled: enabling }),
            });
            const result = await res.json();
            if (result.error) throw new Error(result.error);
            toast(enabling ? 'Now sharing your overview' : 'Sharing turned off');
            loadFactionSharing();
        } catch (e) {
            cb.checked = !enabling; // revert on failure
            toast(e.message || 'Could not update sharing');
        } finally {
            cb.disabled = false;
        }
    });
