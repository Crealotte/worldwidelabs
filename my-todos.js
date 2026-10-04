// Members' own reminders. Every member can add short reminders of their own on the dashboard (they also show up in the script To do list);
// leaders get a page that groups what people add, so reminders that several members want can be built for everyone later.
// Backend: mytodo-* and todo-ideas in api/war-payout.js.
'use strict';

async function mtFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    return res.json();
}

// ---- dashboard panel (every member) ----
// Each reminder has a checkbox. A "once" reminder stays checked once ticked; a "daily" one is unchecked again every new day (TCT).
function renderMyTodos(items) {
    $('mt-list').innerHTML = items.length
        ? items.map(x => `<div style="display:flex;gap:8px;align-items:center;padding:5px 0;border-top:1px solid var(--line);font-size:13px;">
              <input type="checkbox" class="mt-check" data-id="${esc(x.id)}" ${x.done ? 'checked' : ''} style="width:auto;">
              <span style="flex:1;${x.done ? 'text-decoration:line-through;color:var(--muted);' : ''}">${esc(x.text)}</span>
              <span style="font-size:11px;color:${x.repeat === 'daily' ? 'var(--reagent)' : 'var(--muted)'};border:1px solid var(--line);border-radius:10px;padding:1px 7px;">${x.repeat === 'daily' ? 'daily' : 'one time'}</span>
              <button class="ghost small mt-del" data-id="${esc(x.id)}" title="Delete">✕</button></div>`).join('')
        : '<div style="color:var(--muted);font-size:13px;">You have no reminders of your own yet.</div>';
    $('mt-list').querySelectorAll('.mt-del').forEach(b => b.addEventListener('click', async () => {
        const r = await mtFetch({ action: 'mytodo-delete', id: b.dataset.id });
        if (r.error) { toast(r.error); return; }
        renderMyTodos(r.items);
    }));
    $('mt-list').querySelectorAll('.mt-check').forEach(c => c.addEventListener('change', async () => {
        const r = await mtFetch({ action: 'mytodo-check', id: c.dataset.id, done: c.checked });
        if (r.error) { toast(r.error); return; }
        renderMyTodos(r.items);
    }));
}
async function loadMyTodos() {
    const panel = $('dash-mytodo-panel');
    if (!panel) return;
    try {
        const r = await mtFetch({ action: 'mytodo-list' });
        if (r.error) { panel.style.display = 'none'; return; }
        panel.style.display = 'block';
        renderMyTodos(r.items);
    } catch (e) { panel.style.display = 'none'; }
}
async function addMyTodo() {
    const inp = $('mt-input');
    if (!inp.value.trim()) return;
    $('mt-add').disabled = true;
    try {
        const r = await mtFetch({ action: 'mytodo-add', text: inp.value, repeat: $('mt-repeat').value });
        if (r.error) throw new Error(r.error);
        inp.value = '';
        renderMyTodos(r.items);
    } catch (e) { toast(e.message); } finally { $('mt-add').disabled = false; }
}
$('mt-add').addEventListener('click', addMyTodo);
$('mt-input').addEventListener('keydown', e => { if (e.key === 'Enter') addMyTodo(); });

// ---- leaders: what members add ----
async function loadTodoIdeas() {
    const locked = typeof canEditLeaderOnly !== 'undefined' ? !canEditLeaderOnly : false;
    $('ti-locked').style.display = locked ? 'block' : 'none';
    $('ti-body').style.display = locked ? 'none' : 'block';
    if (locked) return;
    const st = $('ti-status');
    st.className = 'status ok'; st.textContent = 'Loading…';
    try {
        const r = await mtFetch({ action: 'todo-ideas' });
        if (r.error) throw new Error(r.error);
        st.textContent = ''; st.className = 'status';
        const typeOf = i => (i.repeats.daily && i.repeats.once ? `mixed (${i.repeats.daily} daily, ${i.repeats.once} one time)` : i.repeats.daily ? 'recurring (daily)' : 'one time');
        $('ti-list').innerHTML = r.ideas.length
            ? `<p style="color:var(--muted);font-size:12px;margin:0 0 8px;">${r.total} reminder${r.total === 1 ? '' : 's'} added in total (the latest 1,000 are kept). Same words in a different order count as the same idea. Most people first.</p>
               <table style="width:100%;font-size:13px;border-collapse:collapse;"><thead><tr style="color:var(--muted);text-align:left;"><th style="padding:4px 8px;">To-do</th><th style="padding:4px 8px;">Type</th><th style="padding:4px 8px;">People</th><th style="padding:4px 8px;">Times</th><th style="padding:4px 8px;">Who</th><th></th></tr></thead>
               <tbody>${r.ideas.map(i => `<tr style="border-top:1px solid var(--line);"><td style="padding:4px 8px;" title="${esc(i.variants.join(' | '))}">${esc(i.text)}</td><td style="padding:4px 8px;white-space:nowrap;color:${i.repeats.daily ? 'var(--reagent)' : 'var(--muted)'};">${esc(typeOf(i))}</td><td style="padding:4px 8px;font-family:var(--mono);font-weight:700;">${i.people.length}</td><td style="padding:4px 8px;font-family:var(--mono);">${i.count}</td><td style="padding:4px 8px;color:var(--muted);white-space:normal;">${esc(i.people.slice(0, 8).join(', '))}${i.people.length > 8 ? ` +${i.people.length - 8}` : ''}</td><td style="padding:4px 8px;text-align:right;"><button class="ghost small ti-del" data-key="${esc(i.key)}" title="Remove this one from the overview">Delete</button></td></tr>`).join('')}</tbody></table>`
            : '<p style="color:var(--muted);margin:0;">Nobody has added a reminder yet.</p>';
        $('ti-list').querySelectorAll('.ti-del').forEach(b => b.addEventListener('click', async () => {
            if (!confirm('Remove this to-do from the overview? (Members keep it on their own lists.)')) return;
            b.disabled = true;
            const d = await mtFetch({ action: 'todo-ideas-delete', key: b.dataset.key });
            if (d.error) { toast(d.error); b.disabled = false; return; }
            loadTodoIdeas();
        }));
    } catch (e) { st.className = 'status err'; st.textContent = e.message; }
}
