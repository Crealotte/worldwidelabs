// banners.js — banners at the top of every page: a leader writes a short message in Leader settings (a new feature, a Torn event, a reminder),
// everyone in the faction sees it until it expires. A member can close a banner; it stays closed for that text (a changed text comes back).
// Backend: 'banners-get' / 'banners-save' / 'banners-delete' in api/war-payout.js.
'use strict';

const BAN_DISMISS_KEY = 'wwl_banners_dismissed'; // { bannerId: hash of its text }
const banHash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); };
const banDismissed = () => { try { return JSON.parse(localStorage.getItem(BAN_DISMISS_KEY) || '{}'); } catch (e) { return {}; } };

async function banFetch(body) {
    const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, ...body }) });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Server problem (${res.status})` }; }
}

function banHtml(b, closable) {
    const btn = b.page ? `<a href="/${esc(b.page)}" class="ghost small sb-go" data-page="${esc(b.page)}" style="padding:5px 12px;border:1px solid currentColor;border-radius:var(--radius);text-decoration:none;white-space:nowrap;">${esc(b.linkLabel || 'Open')} →</a>` : '';
    return `<div class="site-banner tone-${esc(b.tone || 'info')}" data-id="${esc(b.id)}"><span class="sb-text">${esc(b.text)}</span>${btn}${closable ? '<span class="sb-x" title="Close">×</span>' : ''}</div>`;
}

function renderBanners(list) {
    const gone = banDismissed();
    const shown = list.filter(b => gone[b.id] !== banHash(b.text));
    const box = $('site-banners');
    box.innerHTML = shown.map(b => banHtml(b, true)).join('');
    box.querySelectorAll('.sb-x').forEach(x => x.addEventListener('click', () => {
        const id = x.closest('.site-banner').dataset.id, b = list.find(y => y.id === id);
        const d = banDismissed(); d[id] = banHash(b.text);
        try { localStorage.setItem(BAN_DISMISS_KEY, JSON.stringify(d)); } catch (e) { /* not saved */ }
        renderBanners(list);
    }));
    box.querySelectorAll('.sb-go').forEach(a => a.addEventListener('click', e => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault(); goToPage(a.dataset.page);
    }));
}

// Once after login (and again when the dashboard is opened): one cheap request answered from our own database.
async function loadBanners() {
    const r = await banFetch({ action: 'banners-get' });
    renderBanners(r.error ? [] : r.banners || []);
}

// ---- Leader settings: write and remove banners ----
async function loadBannerSettings() {
    const sel = $('ls-ban-page');
    if (sel.options.length <= 1) {
        sel.insertAdjacentHTML('beforeend', [...document.querySelectorAll('.nav-item')].filter(n => n.style.display !== 'none').map(n => `<option value="${esc(n.dataset.page)}">${esc(n.textContent.replace(/[🔒●]/g, '').trim())}</option>`).join(''));
    }
    const r = await banFetch({ action: 'banners-get', manage: true });
    renderBannerList(r.error ? [] : r.banners || [], r.error);
}
function renderBannerList(list, error) {
    const today = new Date().toISOString().slice(0, 10);
    $('ls-ban-list').innerHTML = error ? `<p style="color:var(--danger);font-size:13px;">${esc(error)}</p>`
        : list.length ? list.map(b => `<div style="margin-bottom:8px;">${banHtml(b, false)}
            <div style="font-size:12px;color:var(--muted);margin:3px 0 0 2px;">${b.audience === 'leaders' ? 'Leaders only' : 'Everyone'} · ${b.expires ? (b.expires < today ? `<span style="color:var(--danger);">expired ${esc(b.expires)}</span>` : `until ${esc(b.expires)}`) : 'no end date'} · <a href="#" class="ls-ban-del" data-id="${esc(b.id)}" style="color:var(--danger);">Delete</a></div></div>`).join('')
            : '<p style="color:var(--muted);font-size:13px;margin:0;">No banners right now.</p>';
    document.querySelectorAll('.ls-ban-del').forEach(a => a.addEventListener('click', async e => {
        e.preventDefault();
        if (!confirm('Delete this banner?')) return;
        const r = await banFetch({ action: 'banners-delete', id: a.dataset.id });
        if (r.error) { toast(r.error); return; }
        renderBannerList(r.banners || []); loadBanners();
    }));
}

$('ls-ban-add').addEventListener('click', async () => {
    const r = await banFetch({ action: 'banners-save', text: $('ls-ban-text').value, audience: $('ls-ban-audience').value, tone: $('ls-ban-tone').value,
        expires: $('ls-ban-expires').value, page: $('ls-ban-page').value, linkLabel: $('ls-ban-label').value });
    if (r.error) { toast(r.error); return; }
    $('ls-ban-text').value = ''; $('ls-ban-expires').value = ''; $('ls-ban-label').value = ''; $('ls-ban-page').value = ''; $('ls-ban-preview').innerHTML = '';
    toast('Banner added — it shows at the top of every page');
    renderBannerList(r.banners || []); loadBanners();
});
// a live preview while typing
['ls-ban-text', 'ls-ban-tone', 'ls-ban-page', 'ls-ban-label'].forEach(id => $(id).addEventListener('input', () => {
    const text = $('ls-ban-text').value.trim();
    $('ls-ban-preview').innerHTML = text ? `<div style="font-size:12px;color:var(--muted);margin-bottom:4px;">Preview:</div>${banHtml({ id: 'preview', text, tone: $('ls-ban-tone').value, page: $('ls-ban-page').value, linkLabel: $('ls-ban-label').value }, false)}` : '';
}));
