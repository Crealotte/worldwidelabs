// feedback.js — the public Feedback page (embedded Google Form + results chart) and its
// leader-only editor.
'use strict';

    // ================= FEEDBACK FORM =================
    // Extracts a URL whether the leader pastes a bare link or Google's whole <iframe> snippet,
    // and only allows https:// URLs — this renders in an iframe for every member, so no
    // arbitrary/unsafe schemes get through even if something odd gets pasted in.
    function extractEmbedUrl(input) {
        if (!input) return null;
        const trimmed = input.trim();
        const iframeMatch = trimmed.match(/src=["']([^"']+)["']/i);
        const url = iframeMatch ? iframeMatch[1] : trimmed;
        return /^https:\/\//i.test(url) ? url : null;
    }

    async function loadFeedback() {
        try {
            const res = await fetch('/api/feedback-form', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: apiKey, action: 'read' }),
            });
            const data = await res.json();
            const form = data?.form;
            if (!form) { $('fb-empty').style.display = 'block'; $('fb-content').style.display = 'none'; return; }

            $('fb-title').textContent = form.title || 'Feedback';
            $('fb-empty').style.display = 'none';
            $('fb-content').style.display = 'block';
            $('fb-form-frame').src = form.formUrl;
            if (form.chartUrl) {
                $('fb-chart-panel').style.display = 'block';
                $('fb-chart-frame').src = form.chartUrl;
            } else {
                $('fb-chart-panel').style.display = 'none';
            }
        } catch (e) {
            $('fb-empty').style.display = 'block'; $('fb-content').style.display = 'none';
        }
    }

    async function loadFeedbackEditor() {
        try {
            const res = await fetch('/api/feedback-form', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: apiKey, action: 'read' }),
            });
            const data = await res.json();
            const form = data?.form;
            $('fb-title-input').value = form?.title || '';
            $('fb-form-url').value = form?.formUrl || '';
            $('fb-chart-url').value = form?.chartUrl || '';
        } catch (e) { /* start blank if loading the current one fails */ }
    }

    $('fb-save').addEventListener('click', async () => {
        const btn = $('fb-save');
        const st = $('fb-editor-status');
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
            const title = $('fb-title-input').value.trim();
            const formUrl = extractEmbedUrl($('fb-form-url').value);
            const chartUrl = $('fb-chart-url').value.trim() ? extractEmbedUrl($('fb-chart-url').value) : null;

            if (!formUrl) {
                st.className = 'status err';
                st.textContent = 'That doesn\'t look like a valid embed URL — paste the link Google gives you (or the whole <iframe> snippet), starting with https://';
                return;
            }
            const res = await fetch('/api/feedback-form', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: apiKey, title, formUrl, chartUrl }),
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            st.className = 'status ok'; st.textContent = 'Saved — live on the Feedback page now.';
        } catch (e) {
            st.className = 'status err'; st.textContent = e.message;
        } finally {
            btn.disabled = false; btn.textContent = 'Save';
        }
    });

    $('fb-clear').addEventListener('click', async () => {
        if (!confirm('Remove the current feedback form for everyone?')) return;
        try {
            await fetch('/api/feedback-form', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: apiKey, action: 'clear' }),
            });
            loadFeedbackEditor();
            toast('Feedback form cleared');
        } catch (e) { toast('Could not clear the form'); }
    });

