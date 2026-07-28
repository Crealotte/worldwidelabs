// polls.js — faction polls: active poll + full history, voting, creation, deletion.
'use strict';

    // ================= POLLS (independent of the announcement text) =================
    // A faction keeps a running history of polls, newest first. Only the newest one accepts
    // votes ("active"); everything older stays visible with its final results, and leaders
    // can delete any of them outright.
    async function fetchPolls() {
        const res = await fetch('/api/polls', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: apiKey, action: 'read' }),
        });
        return res.json();
    }

    function pollResultsHtml(poll, { votable }) {
        const total = poll.totalVotes || 0;
        const myVote = poll.myVote;
        let html = `<div class="lab-label" style="margin-bottom:8px;">${esc(poll.question)}</div>`;
        html += poll.options.map((opt, i) => {
            const count = poll.tally?.[i] || 0;
            const pct = total ? Math.round((count / total) * 100) : 0;
            const mine = myVote !== null && Number(myVote) === i;
            const names = (poll.voters?.[i] || []).map(v => esc(v.name)).join(', ');
            const canVote = votable && !poll.closed;
            return `
                <div class="poll-option" style="margin-bottom:10px;">
                    <label style="display:flex;align-items:center;gap:8px;${canVote ? 'cursor:pointer;' : ''}font-size:13px;margin-bottom:4px;">
                        <input type="checkbox" class="poll-vote-check" data-idx="${i}" data-pollid="${esc(poll.pollId)}" style="width:auto;" ${mine ? 'checked' : ''} ${canVote ? '' : 'disabled'}>
                        <span style="flex:1;">${esc(opt)}</span>
                        <span style="color:var(--muted);">${count} (${pct}%)</span>
                    </label>
                    <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${mine ? 'var(--reagent)' : 'var(--line)'};"></div></div>
                    ${names ? `<div style="font-size:11px;color:var(--muted);margin-top:3px;">Voted: ${names}</div>` : ''}
                </div>`;
        }).join('');

        if (poll.closed) {
            html += `<p style="color:var(--danger);font-size:12px;margin-top:8px;">Poll closed · ${total} vote${total === 1 ? '' : 's'} total</p>`;
        } else if (votable) {
            html += `<button class="ghost small poll-vote-submit" data-pollid="${esc(poll.pollId)}" style="margin-top:6px;">${myVote !== null ? 'Change vote' : 'Cast vote'}</button>`;
            const expiryNote = poll.expiresAt ? ` · closes in ${formatDuration(poll.expiresAt - Date.now())}` : '';
            html += `<p style="color:var(--muted);font-size:11px;margin-top:8px;">${total} vote${total === 1 ? '' : 's'} so far${expiryNote}</p>`;
        } else {
            html += `<p style="color:var(--muted);font-size:11px;margin-top:8px;">${total} vote${total === 1 ? '' : 's'} total</p>`;
        }
        return html;
    }

    function wirePollVoting(container) {
        const checks = container.querySelectorAll('.poll-vote-check');
        checks.forEach(cb => {
            cb.addEventListener('change', () => {
                if (cb.checked) checks.forEach(other => { if (other !== cb) other.checked = false; }); // single choice
            });
        });
        const submitBtn = container.querySelector('.poll-vote-submit');
        if (submitBtn) {
            submitBtn.addEventListener('click', async () => {
                const chosen = [...checks].find(cb => cb.checked);
                if (!chosen) { toast('Check an option first'); return; }
                submitBtn.disabled = true; submitBtn.textContent = 'Voting…';
                try {
                    const res = await fetch('/api/polls', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ key: apiKey, action: 'vote', pollId: chosen.dataset.pollid, optionIndex: parseInt(chosen.dataset.idx, 10) }),
                    });
                    const result = await res.json();
                    if (result.error) throw new Error(result.error);
                    loadPolls();
                } catch (e) {
                    toast(e.message || 'Vote failed — try again');
                    submitBtn.disabled = false; submitBtn.textContent = 'Cast vote';
                }
            });
        }
    }

    async function loadPolls() {
        try {
            const data = await fetchPolls();
            const panel = $('poll-panel');
            if (!data?.active) { panel.style.display = 'none'; return; }
            panel.style.display = 'block';

            $('poll-active-body').innerHTML = pollResultsHtml(data.active, { votable: true });
            wirePollVoting($('poll-active-body'));

            if (data.past?.length) {
                $('poll-past-wrap').style.display = 'block';
                $('poll-past-body').innerHTML = data.past.map(p => `
                    <div style="border-top:1px solid var(--line);padding-top:10px;margin-top:10px;">
                        ${pollResultsHtml(p, { votable: false })}
                    </div>`).join('');
            } else {
                $('poll-past-wrap').style.display = 'none';
            }
        } catch (e) {
            $('poll-panel').style.display = 'none';
        }
    }

    // ---- Poll editor (leaders only) ----
    function addPollOptionField(value = '') {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;';
        wrap.innerHTML = `<input class="an-poll-option" value="${esc(value)}" placeholder="Option" style="flex:1;">
            <button class="ghost small an-remove-option" type="button">✕</button>`;
        wrap.querySelector('.an-remove-option').addEventListener('click', () => wrap.remove());
        $('an-poll-options').appendChild(wrap);
    }
    $('an-poll-add-option').addEventListener('click', () => addPollOptionField());

    function resetPollForm() {
        $('an-poll-question').value = '';
        $('an-poll-duration').value = '';
        $('an-poll-options').innerHTML = '';
        addPollOptionField(); addPollOptionField();
    }

    async function loadPollEditor() {
        resetPollForm();
        try {
            const data = await fetchPolls();
            const all = [data.active, ...(data.past || [])].filter(Boolean);
            if (!all.length) { $('an-poll-list').innerHTML = '<p style="color:var(--muted);font-size:13px;">No polls yet.</p>'; return; }

            $('an-poll-list').innerHTML = all.map((p, i) => `
                <div style="border-top:1px solid var(--line);padding-top:10px;margin-top:10px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
                        <div>
                            <b style="font-size:13px;">${esc(p.question)}</b>
                            ${i === 0 ? '<span class="badge" style="position:static;margin-left:8px;">Active</span>' : ''}
                            <div style="color:var(--muted);font-size:11px;margin-top:2px;">${p.totalVotes || 0} vote${p.totalVotes === 1 ? '' : 's'} · created ${new Date(p.createdAt).toLocaleDateString()}${p.closed ? ' · closed' : ''}</div>
                        </div>
                        <div style="display:flex;gap:8px;">
                            ${i === 0 && !p.closed ? `<button class="ghost small poll-close" data-pollid="${esc(p.pollId)}">Close vote</button>` : ''}
                            <button class="ghost small poll-delete" data-pollid="${esc(p.pollId)}">Delete</button>
                        </div>
                    </div>
                </div>`).join('');

            $('an-poll-list').querySelectorAll('.poll-close').forEach(btn => {
                btn.addEventListener('click', async () => {
                    if (!confirm('Close this vote now? No more votes will be accepted, and results become final.')) return;
                    btn.disabled = true; btn.textContent = 'Closing…';
                    try {
                        const res = await fetch('/api/polls', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ key: apiKey, action: 'close', pollId: btn.dataset.pollid }),
                        });
                        const result = await res.json();
                        if (result.error) throw new Error(result.error);
                        loadPollEditor();
                        loadPolls();
                        toast('Vote closed');
                    } catch (e) {
                        toast(e.message || 'Could not close the vote');
                        btn.disabled = false; btn.textContent = 'Close vote';
                    }
                });
            });

            $('an-poll-list').querySelectorAll('.poll-delete').forEach(btn => {
                btn.addEventListener('click', async () => {
                    if (!confirm('Delete this poll and its votes for everyone? This can\'t be undone.')) return;
                    try {
                        await fetch('/api/polls', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ key: apiKey, action: 'delete', pollId: btn.dataset.pollid }),
                        });
                        loadPollEditor();
                        toast('Poll deleted');
                    } catch (e) { toast('Could not delete poll'); }
                });
            });
        } catch (e) {
            $('an-poll-list').innerHTML = '<p style="color:var(--muted);font-size:13px;">Could not load poll history.</p>';
        }
    }

    $('an-poll-create').addEventListener('click', async () => {
        const btn = $('an-poll-create');
        const st = $('an-poll-status');
        const question = $('an-poll-question').value.trim();
        const options = [...document.querySelectorAll('.an-poll-option')].map(i => i.value.trim()).filter(Boolean);
        if (!question || options.length < 2) {
            st.className = 'status err'; st.textContent = 'A poll needs a question and at least 2 filled-in options.';
            return;
        }
        const durationMs = parseInt($('an-poll-duration').value, 10) || null;
        btn.disabled = true; btn.textContent = 'Creating…';
        try {
            const res = await fetch('/api/polls', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: apiKey, action: 'create', question, options, durationMs }),
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            st.className = 'status ok'; st.textContent = 'Poll created — live on everyone\'s dashboard now.';
            loadPollEditor();
        } catch (e) {
            st.className = 'status err'; st.textContent = e.message;
        } finally {
            btn.disabled = false; btn.textContent = 'Create poll';
        }
    });

