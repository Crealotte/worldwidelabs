// banners.js — banners at the top of every page: a leader writes a short message in Leader settings (a new feature, a Torn event, a reminder),
// everyone in the faction sees it until it expires (several rotate like a slideshow). A member can close a banner; it stays closed for that text (a changed text comes back).
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

// The banners run across the whole top of the page. With more than one they slide to the next by themselves every few seconds (they stop while
// the mouse is over them or a finger is on them), with dots, arrows and swipe to move by hand.
let banTimer = null, banIndex = 0;
function renderBanners(list) {
    clearInterval(banTimer);
    const gone = banDismissed();
    const shown = list.filter(b => gone[b.id] !== banHash(b.text));
    const box = $('site-banners');
    if (!shown.length) { box.innerHTML = ''; return; }
    banIndex = Math.min(banIndex, shown.length - 1);
    const many = shown.length > 1;
    box.innerHTML = `<div class="sb-track">${shown.map(b => banHtml(b, true)).join('')}</div>`
        + (many ? `<button class="sb-arrow sb-prev" aria-label="Previous banner">‹</button><button class="sb-arrow sb-next" aria-label="Next banner">›</button><div class="sb-dots">${shown.map((b, i) => `<span class="sb-dot" data-i="${i}"></span>`).join('')}</div>` : '');
    const track = box.querySelector('.sb-track');
    const go = i => {
        banIndex = (i + shown.length) % shown.length;
        track.style.transform = `translateX(-${banIndex * 100}%)`;
        box.querySelectorAll('.sb-dot').forEach((d, k) => d.classList.toggle('on', k === banIndex));
    };
    go(banIndex);
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
    if (!many) return;
    let paused = false;
    banTimer = setInterval(() => { if (!paused && !document.hidden) go(banIndex + 1); }, 7000);
    box.addEventListener('mouseenter', () => { paused = true; });
    box.addEventListener('mouseleave', () => { paused = false; });
    box.querySelector('.sb-prev').addEventListener('click', () => go(banIndex - 1));
    box.querySelector('.sb-next').addEventListener('click', () => go(banIndex + 1));
    box.querySelectorAll('.sb-dot').forEach(d => d.addEventListener('click', () => go(Number(d.dataset.i))));
    let x0 = null; // swipe
    box.addEventListener('touchstart', e => { paused = true; x0 = e.touches[0].clientX; }, { passive: true });
    box.addEventListener('touchend', e => {
        paused = false;
        if (x0 === null) return;
        const dx = e.changedTouches[0].clientX - x0; x0 = null;
        if (Math.abs(dx) > 40) go(banIndex + (dx < 0 ? 1 : -1));
    }, { passive: true });
}

// Once after login (and again when the dashboard is opened): one cheap request answered from our own database.
async function loadBanners() {
    const r = await banFetch({ action: 'banners-get' });
    renderBanners(r.error ? [] : r.banners || []);
}

// ---- Leader settings: write and remove banners ----
// A leader writes banners for their OWN faction (everyone in it, or only its leaders). An owner can also write one for ALL factions.
async function loadBannerSettings() {
    const sel = $('ls-ban-page');
    if (sel.options.length <= 1) {
        sel.insertAdjacentHTML('beforeend', [...document.querySelectorAll('.nav-item')].filter(n => n.style.display !== 'none').map(n => `<option value="${esc(n.dataset.page)}">${esc(n.textContent.replace(/[🔒●]/g, '').trim())}</option>`).join(''));
    }
    const r = await banFetch({ action: 'banners-get', manage: true });
    const keep = $('ls-ban-audience').value;
    $('ls-ban-audience').innerHTML = '<option value="fac-all">My faction — everyone</option><option value="fac-leaders">My faction — leaders only</option>'
        + (r.owner ? '<option value="all-all">ALL factions — everyone</option><option value="all-leaders">ALL factions — leaders only</option>' : '');
    if ([...$('ls-ban-audience').options].some(o => o.value === keep)) $('ls-ban-audience').value = keep;
    renderBannerList(r.error ? [] : r.banners || [], r.error, !!r.owner);
}
function renderBannerList(list, error, owner) {
    const today = new Date().toISOString().slice(0, 10);
    const who = b => `${b.scope === 'all' ? '<b>All factions</b>' : 'My faction'} · ${b.audience === 'leaders' ? 'leaders only' : 'everyone'}`;
    $('ls-ban-list').innerHTML = error ? `<p style="color:var(--danger);font-size:13px;">${esc(error)}</p>`
        : list.length ? list.map(b => `<div style="margin-bottom:8px;">${banHtml(b, false)}
            <div style="font-size:12px;color:var(--muted);margin:3px 0 0 2px;">${who(b)} · ${b.expires ? (b.expires < today ? `<span style="color:var(--danger);">expired ${esc(b.expires)}</span>` : `until ${esc(b.expires)}`) : 'no end date'}${b.scope === 'all' && !owner ? '' : ` · <a href="#" class="ls-ban-del" data-id="${esc(b.id)}" style="color:var(--danger);">Delete</a>`}</div></div>`).join('')
            : '<p style="color:var(--muted);font-size:13px;margin:0;">No banners right now.</p>';
    document.querySelectorAll('.ls-ban-del').forEach(a => a.addEventListener('click', async e => {
        e.preventDefault();
        if (!confirm('Delete this banner?')) return;
        const r = await banFetch({ action: 'banners-delete', id: a.dataset.id });
        if (r.error) { toast(r.error); return; }
        loadBannerSettings(); loadBanners();
    }));
}

$('ls-ban-add').addEventListener('click', async () => {
    const [scope, audience] = $('ls-ban-audience').value.split('-'); // 'fac-all' | 'fac-leaders' | 'all-all' | 'all-leaders'
    const r = await banFetch({ action: 'banners-save', text: $('ls-ban-text').value, scope: scope === 'all' ? 'all' : 'faction', audience: audience === 'leaders' ? 'leaders' : 'all',
        tone: $('ls-ban-tone').value, expires: $('ls-ban-expires').value, page: $('ls-ban-page').value, linkLabel: $('ls-ban-label').value });
    if (r.error) { toast(r.error); return; }
    $('ls-ban-text').value = ''; $('ls-ban-expires').value = ''; $('ls-ban-label').value = ''; $('ls-ban-page').value = ''; $('ls-ban-preview').innerHTML = '';
    toast(scope === 'all' ? 'Banner added — it shows in ALL factions' : 'Banner added — it shows at the top of every page for your faction');
    loadBannerSettings(); loadBanners();
});
// a live preview while typing
['ls-ban-text', 'ls-ban-tone', 'ls-ban-page', 'ls-ban-label'].forEach(id => $(id).addEventListener('input', () => {
    const text = $('ls-ban-text').value.trim();
    $('ls-ban-preview').innerHTML = text ? `<div style="font-size:12px;color:var(--muted);margin-bottom:4px;">Preview:</div>${banHtml({ id: 'preview', text, tone: $('ls-ban-tone').value, page: $('ls-ban-page').value, linkLabel: $('ls-ban-label').value }, false)}` : '';
}));
