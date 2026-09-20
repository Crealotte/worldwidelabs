// mobile-nav.js — on a phone the sidebar is hidden and slides in from the left, like Torn's own menu: press the
// ☰ button, or swipe from the left edge of the screen to the right. Swipe left, tap outside, or pick a page to close it.
// (The layout itself is in index.html's @media (max-width: 760px) block.)
'use strict';

(function () {
    const open = on => document.body.classList.toggle('nav-open', on);
    const isOpen = () => document.body.classList.contains('nav-open');
    const phone = () => window.matchMedia('(max-width: 760px)').matches;

    document.getElementById('nav-burger').addEventListener('click', () => open(!isOpen()));
    document.getElementById('nav-backdrop').addEventListener('click', () => open(false));
    document.querySelector('nav.side').addEventListener('click', e => { if (e.target.closest('a.nav-item')) open(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') open(false); });
    window.addEventListener('resize', () => { if (!phone()) open(false); });

    // the swipe: a mostly horizontal drag of 60 px or more; opening only counts when it starts at the left edge
    let start = null;
    document.addEventListener('touchstart', e => {
        const t = e.touches[0];
        start = { x: t.clientX, y: t.clientY, edge: t.clientX <= 32 };
    }, { passive: true });
    document.addEventListener('touchend', e => {
        if (!start || !phone()) { start = null; return; }
        const t = e.changedTouches[0], dx = t.clientX - start.x, dy = t.clientY - start.y;
        if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            if (dx > 0 && start.edge && !isOpen()) open(true);
            else if (dx < 0 && isOpen()) open(false);
        }
        start = null;
    }, { passive: true });
})();
