// faction-sharing.js — the leader-only "Who's on board" roster panel, plus the opt-in
// snapshot-sharing toggle that lets other factions' leaders see it without a shared key.
'use strict';

    // Leaders only: who in the faction has logged into WWLabs, and who hasn't yet.
    async function loadAdoption() {
        const panel = $('adoption');
        try {
            const [trackData, membersData, discordData] = await Promise.all([
                fetch('/api/presence', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: apiKey, action: 'list' }),
                }).then(r => r.json()),
                tornV2('/faction/members?striptags=true'),
                fetch('/api/discord-members', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: apiKey }),
                }).then(r => r.json()).catch(() => null),
            ]);
            if (trackData.error) throw new Error(trackData.error);
            const logins = trackData.logins || {};
            const members = (membersData.members || []).slice();
            const discordMembers = (discordData && !discordData.error) ? discordData.members : null;

            members.sort((a, b) =>
                (logins[b.id]?.last || 0) - (logins[a.id]?.last || 0) || a.name.localeCompare(b.name));

            const onboard = members.filter(m => logins[m.id]).length;
            $('adoption-summary').textContent = discordMembers
                ? `${onboard} of ${members.length} members have logged into WWLabs · ${members.filter(m => discordMembers[m.id]).length} of ${members.length} found in Discord.`
                : `${onboard} of ${members.length} members have logged in. (Discord check not set up yet.)`;

            $('adoption-body').innerHTML = members.map(m => {
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
                return `<tr${l ? '' : ' style="opacity:.5"'}>
                    <td>${esc(m.name)} [${m.id}]</td>
                    <td>${l ? '<span style="color:var(--reagent)">● on board</span>' : '<span style="color:var(--muted)">○ not yet</span>'}</td>
                    <td>${discordCell}</td>
                    <td class="num" style="font-family:var(--mono);font-size:12px;">${when}</td>
                </tr>`;
            }).join('');
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

    function renderSharedFactionTable(data) {
        const onboard = data.members.filter(m => m.onWWLabs).length;
        const hasDiscord = data.members.some(m => m.discord !== null);
        const summary = hasDiscord
            ? `${onboard} of ${data.members.length} on WWLabs · ${data.members.filter(m => m.discord === 'verified').length} of ${data.members.length} verified in Discord.`
            : `${onboard} of ${data.members.length} on WWLabs.`;
        const rows = data.members.map(m => `
            <tr${m.onWWLabs ? '' : ' style="opacity:.5"'}>
                <td>${esc(m.name)} [${m.id}]</td>
                <td>${m.onWWLabs ? '<span style="color:var(--reagent)">● on board</span>' : '<span style="color:var(--muted)">○ not yet</span>'}</td>
                <td>${m.discord !== null ? (DISCORD_LABELS[m.discord] || '—') : '<span style="color:var(--muted);font-size:11px;">—</span>'}</td>
            </tr>`).join('');
        const ago = Math.round((Date.now() - data.updatedAt) / 60000);
        return `
            <div style="border-top:1px solid var(--line);padding-top:14px;margin-top:14px;">
                <h4 style="margin:0 0 4px;font-size:14px;">${esc(data.factionName)}</h4>
                <p style="color:var(--muted);font-size:12px;margin:0 0 8px;">${summary} · updated ${ago < 1 ? 'just now' : ago + 'm ago'}</p>
                <div class="table-scroll" style="max-height:280px;overflow-y:auto;">
                    <table><thead><tr><th>Member</th><th>WWLabs</th><th>Discord</th></tr></thead>
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
                $('shared-factions-list').innerHTML = data.others.map(renderSharedFactionTable).join('');
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
