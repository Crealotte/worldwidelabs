// oc-rules.js — the "OC join rules" panel of Leader settings: for each organized crime level the lowest and highest success chance a member may have to join it, and whether the
// rules apply to members and to leaders. The WWL script greys out the Join button of a slot outside the range. Backend: 'ocrules-get' / 'ocrules-set' (lib/ocrules.js).
'use strict';

const OCR_LEVELS = 10;
async function ocrFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}
async function loadOcRules() {
    const st = $('ocr-status');
    try {
        const r = await ocrFetch({ action: 'ocrules-get' });
        if (r.error) throw new Error(r.error);
        const rows = [];
        for (let l = 1; l <= OCR_LEVELS; l++) {
            const x = (r.levels || {})[l];
            rows.push(`<tr><td style="padding:3px 10px;font-weight:600;">Level ${l}</td><td style="padding:3px 10px;"><input type="number" min="0" max="100" class="ocr-min" data-l="${l}" value="${x ? x.min : ''}" placeholder="no limit" style="width:90px;"></td><td style="padding:3px 10px;"><input type="number" min="0" max="100" class="ocr-max" data-l="${l}" value="${x ? x.max : ''}" placeholder="no limit" style="width:90px;"></td></tr>`);
        }
        $('ocr-body').innerHTML = rows.join('');
        $('ocr-members').checked = r.members !== false;
        $('ocr-leaders').checked = r.leaders !== false;
        st.textContent = ''; st.className = 'status';
    } catch (e) { st.className = 'status err'; st.textContent = e.message; }
}
$('ocr-save').addEventListener('click', async () => {
    const st = $('ocr-status'), levels = {};
    for (let l = 1; l <= OCR_LEVELS; l++) {
        const min = document.querySelector(`.ocr-min[data-l="${l}"]`).value.trim(), max = document.querySelector(`.ocr-max[data-l="${l}"]`).value.trim();
        if (min !== '' || max !== '') levels[l] = { min, max };
    }
    $('ocr-save').disabled = true;
    const r = await ocrFetch({ action: 'ocrules-set', levels, members: $('ocr-members').checked, leaders: $('ocr-leaders').checked });
    $('ocr-save').disabled = false;
    if (r.error) { st.className = 'status err'; st.textContent = r.error; return; }
    st.className = 'status ok'; st.textContent = 'Saved. The script picks the new rules up within 10 minutes (or after the next reload of Torn).';
    loadOcRules();
    setTimeout(() => { if (st.textContent.startsWith('Saved')) { st.textContent = ''; st.className = 'status'; } }, 6000);
});
