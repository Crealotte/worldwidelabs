// announcements.js — faction announcement text (see polls.js for polls — kept separate
// on purpose, so editing one never disturbs the other).
'use strict';

    // ================= ANNOUNCEMENTS (text only — polls are fully separate, see below) =================
    async function fetchAnnouncement() {
        const res = await fetch('/api/announcement', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: apiKey, action: 'read' }),
        });
        return res.json();
    }

    async function loadAnnouncement() {
        try {
            const data = await fetchAnnouncement();
            const ann = data?.announcement;
            const panel = $('announcement-panel');
            if (!ann?.text) { panel.style.display = 'none'; return; }
            panel.style.display = 'block';
            $('announcement-body').innerHTML = `<p style="white-space:pre-wrap;line-height:1.6;margin:0;">${esc(ann.text)}</p>`;
        } catch (e) {
            $('announcement-panel').style.display = 'none'; // no server (local file) or a network hiccup — fail quietly here
        }
    }

    async function loadAnnouncementEditor() {
        try {
            const data = await fetchAnnouncement();
            $('an-text').value = data?.announcement?.text || '';
        } catch (e) { /* start from a blank form if loading the current one fails */ }
    }

    $('an-save').addEventListener('click', async () => {
        const btn = $('an-save');
        btn.disabled = true; btn.textContent = 'Saving…';
        const st = $('an-status');
        try {
            const res = await fetch('/api/announcement', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: apiKey, text: $('an-text').value.trim() }),
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            st.className = 'status ok'; st.textContent = 'Saved — live on everyone\'s dashboard now.';
        } catch (e) {
            st.className = 'status err'; st.textContent = e.message;
        } finally {
            btn.disabled = false; btn.textContent = 'Save announcement';
        }
    });

    $('an-clear').addEventListener('click', async () => {
        if (!confirm('Clear the announcement text for everyone?')) return;
        try {
            await fetch('/api/announcement', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: apiKey, text: '' }),
            });
            loadAnnouncementEditor();
            toast('Announcement cleared');
        } catch (e) { toast('Could not clear announcement'); }
    });

