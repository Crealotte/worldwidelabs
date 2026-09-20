// whats-new.js — the "What's new" page: a list of updates, newest first, open to every member.
// Each entry has two lists: `everyone` (shown to all) and `leaders` (only shown to leaders/council,
// and never revealed to normal members). Leaders also get a "Copy as message" button per update and
// buttons that build ONE big post of all updates (split in parts that fit a Discord message).
//
// TO ADD AN UPDATE: put a new object at the TOP of WHATS_NEW below. Plain text only (no HTML).
// Dates of the older entries are approximate (they group what was added around then).
'use strict';

const WHATS_NEW = [
    {
        date: '2026-09-21',
        title: 'New pages: War reports, Gym stats and Bug reports',
        everyone: [
            'War reports (War menu): every past war payout report with the opponent, win or loss, the score and a link to the full report. Open the pay details to see what was paid — leaders see everyone, everyone else sees their own line.',
            'Gym stats (Training menu): a graph of your own battle stats over time, your growth over the last weeks, and personal goals per stat with an estimate of when you will reach them. It builds up every day you open WWL.',
            'Bug reports (bottom of the menu): describe a problem, add a screenshot (or paste one with Ctrl+V) and it goes straight to the owner on Discord, with your name and the page you were on.',
        ],
        leaders: [],
    },
    {
        date: '2026-09-21',
        title: 'Tailored training plan (Energy planner)',
        everyone: [
            'Pick the stat to train (the two stats with the best faction Steadfast bonus are starred) and how you train: natural energy — Soft or Hard — or a happy jump (Lollipop, Big Choco, 5 EDVD, 9 EDVD). Every method is a card that already shows its estimated stat gain and item cost for a week, and all methods are compared side by side.',
            'You get a week plan — 4 training days, 2 war prep days and the war day — with a tick box for every step and a progress bar in energy.',
            'Everything is pulled from your own account: your stat, max happy, energy bar (donator or not), gym, and your gym bonuses (faction Steadfast, candy bonus, property and education perks, cooldowns). Your total battle stats only decide your weekly minimum: 4,400 energy at 1.5m+, 2,200 under. The estimates use the community gym formula, so they are estimates — Torn adds a random amount to every train.',
            'Natural energy: Soft is 3 bars + 2 Xanax a day (3 log-ins), Hard is 4 bars + 3 Xanax. The daily energy refill is on by default, you can add energy cans (each can has its own energy and price), and experienced players can set their own bars and Xanax per day.',
            'Your settings fold away into one button once you have chosen, so the page shows your plan first. The Happy Jump guides are closed by default, and the weekly minimum under 1.5m is now correctly 2,200 energy (it said 2,400).',
        ],
        leaders: [],
    },
    {
        date: '2026-09-20',
        title: 'Your standing, a tidier menu and the war participation rule',
        everyone: [
            'New "Your standing" card on the dashboard: how much energy you need to train this month (4,400 a week at 1.5m+, 2,200 below — 17,600 or 22,000 for a 4 or 5 week month), how many of your last 5 wars count as taken part in (e.g. 3/5, or 1/2 if you joined recently), and your place this month for war hits, chain hits, blood bags, candy, alcohol and energy drinks.',
            'War participation: a war counts when you did 10 war hits, or 20 chain hits if you did fewer than 10 war hits. You need it in 3 of your last 5 wars. Wars from before you joined the faction are not held against you.',
            'The menu is reorganised: a War group (War Badges, War Availability, War reports), a Crimes group (Crimes Guide, OC Fit Tracker), and What\'s new, Tools & links, Feedback and Bug reports at the bottom. What\'s new turns bold with a dot when there is an update you haven\'t opened yet.',
        ],
        leaders: [
            'The "Who\'s on board" and "Other factions" lists on the dashboard are closed by default — click the title to open them.',
            'Polls: you can hide a poll from the dashboard (and show it again) without deleting it — under Announcements, "Hide from dashboard".',
        ],
    },
    {
        date: '2026-09-20',
        title: 'Member Overview, Labs Funds and View as member',
        everyone: [],
        leaders: [
            'Member Overview (Leadership menu, leaders and council only): for the last 5 wars, war hits and chain hits per member with a green / red light for who took part in enough wars (10 war hits or 20 chain hits, in 3 of 5) — wars before someone joined are not counted against them. Also blood bags filled, candy, alcohol and energy drinks used per period, and each member\'s energy group and weekly need.',
            'Member Overview periods run Sunday to Sunday and follow the newsletter (first Sunday of the month, 4 or 5 weeks), with a Total / Per week switch, an "Exact dates" option to compare with other tools, a winner for each competition and a "Copy for newsletter" button.',
            'Labs Funds (Leadership menu): every faction\'s war payout cut in one place with history and totals. Any leader can view it; only the owner can change it.',
            'View as member: a button in the sidebar to preview exactly what a normal member sees.',
        ],
    },
    {
        date: '2026-09-14',
        title: 'War Availability',
        everyone: [
            'War Availability (War menu): tick the hours you can play before a war. Click a box once for green (available), twice for yellow (probably, but busy with something else), a third time to clear it. Big banner on top, and a switch to show all times in your own timezone.',
            'A "I can\'t make it" button for when you are out for the whole war, and a plan picker to see this weekend and next weekend.',
        ],
        leaders: [
            'Create several plans (this weekend, next weekend) and link a plan to a war so the start time comes from Torn.',
            'A heatmap of how many people are available per hour — click an hour to see who — plus a list of who has filled it in, who hasn\'t, and who can\'t make it.',
            'Ping people on Discord: everyone in an hour, or everyone who hasn\'t filled it in, with a message from a set of standard ones and the time it starts. Set your faction\'s Discord channel or webhook first under "Discord settings" (closed by default, like "Create a plan").',
            'Overdoses: who has overdosed since midnight before the 48 hours ahead of the war, so you know who may take part less.',
        ],
    },
    {
        date: '2026-09-06',
        title: 'War Payout, War Badges and Consumption Tracker',
        everyone: [
            'War Badges (War menu): badges for the best in each category of the last war (like most hits, most assists, most respect), with the badge winners of the last war on the dashboard too.',
            'Every page now has its own address, so you can link straight to a page (for example /availability).',
            'Payout receipts can be opened by everyone with the link.',
        ],
        leaders: [
            'War Payout calculator fixed: every war hit is now counted straight from Torn, not just hits inside the chains you add. Chain hits after the war are paid at the flat chain rate, and hits can\'t be counted twice. Payout receipts can be saved and shared with a link.',
            'Consumption Tracker (Leadership menu): pick a date range to see what was used per item (drugs, medical with the blood bags, energy drinks, candy, alcohol, temporary items), and get a shopping list to restock. There is a "restocked" tick box per war.',
        ],
    },
];

const wnFmtDate = d => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function renderWhatsNew() {
    markWhatsNewSeen(); // opening the page counts as having seen the latest update
    const leader = typeof isLeaderCached !== 'undefined' && isLeaderCached;
    $('wn-leader-tools').style.display = leader ? 'block' : 'none';
    $('wn-list').innerHTML = WHATS_NEW.filter(e => leader || (e.everyone || []).length).map(e => {
        const i = WHATS_NEW.indexOf(e);
        const items = (list, tag) => list.map(t => `<li style="margin:4px 0;">${tag ? `<span class="chip" style="cursor:default;font-size:10px;padding:1px 6px;margin-right:6px;">leaders</span>` : ''}${esc(t)}</li>`).join('');
        return `
        <div class="panel">
            <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
                <h3 style="margin:0;">${esc(e.title)}</h3>
                <span style="color:var(--muted);font-size:12px;">${wnFmtDate(e.date)}</span>
                ${leader ? `<button class="ghost small wn-copy" data-i="${i}" style="margin-left:auto;">Copy as message</button>` : ''}
            </div>
            <ul style="margin:0;padding-left:20px;font-size:14px;">
                ${items(e.everyone || [], false)}${leader ? items(e.leaders || [], true) : ''}
            </ul>
        </div>`;
    }).join('');
    document.querySelectorAll('.wn-copy').forEach(b => b.addEventListener('click', () => {
        const e = WHATS_NEW[Number(b.dataset.i)];
        const bullet = t => `• ${t}`;
        const text = [`📢 **WorldWideLabs update: ${e.title}**`,
            (e.everyone || []).length ? `\n**For everyone**\n${e.everyone.map(bullet).join('\n')}` : '',
            (e.leaders || []).length ? `\n**For leaders and council**\n${e.leaders.map(bullet).join('\n')}` : ''].join('\n');
        navigator.clipboard.writeText(text).then(() => toast('Message copied — paste it in Discord'));
    }));
}

// ---- one big post with every update, split into parts that each fit in a Discord message (2,000 characters) ----
function wnBigPost(includeLeaders) {
    const lines = [`📢 **WorldWideLabs — everything that is new${includeLeaders ? ' (leaders and council)' : ''}**`];
    WHATS_NEW.forEach(e => {
        const mine = [...(e.everyone || []).map(t => `• ${t}`), ...(includeLeaders ? (e.leaders || []).map(t => `• 🔒 (leaders) ${t}`) : [])];
        if (!mine.length) return;
        lines.push(`\n**${e.title}**`, ...mine);
    });
    const parts = []; let cur = '';
    for (const line of lines) {
        const piece = line.length > 1900 ? line.slice(0, 1900) : line;
        if ((cur + '\n' + piece).length > 1900 && cur) { parts.push(cur); cur = piece; } else cur = cur ? `${cur}\n${piece}` : piece;
    }
    if (cur) parts.push(cur);
    return parts;
}
function renderWnBig(parts, label) {
    $('wn-big').innerHTML = `<div style="color:var(--muted);font-size:12px;margin:8px 0;">${esc(label)} — Discord takes 2,000 characters per message, so it is in ${parts.length} part${parts.length === 1 ? '' : 's'}. Copy and post them in order.</div>`
        + parts.map((p, i) => `<div style="margin-bottom:10px;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;"><b style="font-size:13px;">Part ${i + 1} of ${parts.length}</b><span style="color:var(--muted);font-size:12px;">${p.length} characters</span>
                <button class="ghost small wn-part" data-i="${i}" style="margin-left:auto;">Copy part ${i + 1}</button></div>
            <textarea readonly rows="6" style="width:100%;font-size:12px;">${esc(p)}</textarea></div>`).join('');
    $('wn-big').querySelectorAll('.wn-part').forEach(b => b.addEventListener('click', () => {
        navigator.clipboard.writeText(parts[Number(b.dataset.i)]).then(() => toast(`Part ${Number(b.dataset.i) + 1} copied`));
    }));
}
$('wn-big-all').addEventListener('click', () => renderWnBig(wnBigPost(false), 'Post for everyone (no leader features)'));
$('wn-big-leaders').addEventListener('click', () => renderWnBig(wnBigPost(true), 'Post for leaders (includes the leader features)'));

// ---- "something new" marker on the sidebar item -------------------------------------------------
// The item turns bold (with a dot) when the newest update this person can see hasn't been opened yet.
// Remembered per browser: opening the What's new page marks the latest update as seen.
const WN_SEEN_KEY = 'wwl_whatsnew_seen';
function wnLatestId() {
    const leader = typeof isLeaderCached !== 'undefined' && isLeaderCached;
    const e = WHATS_NEW.find(x => leader || (x.everyone || []).length); // members skip updates that are leaders-only
    return e ? `${e.date}|${e.title}` : '';
}
function updateWhatsNewBadge() {
    const nav = $('nav-whats-new');
    if (!nav) return;
    let seen = '';
    try { seen = localStorage.getItem(WN_SEEN_KEY) || ''; } catch (e) { /* storage blocked — never nag */ seen = wnLatestId(); }
    nav.classList.toggle('has-new', !!wnLatestId() && seen !== wnLatestId());
}
function markWhatsNewSeen() {
    try { localStorage.setItem(WN_SEEN_KEY, wnLatestId()); } catch (e) { /* not critical */ }
    updateWhatsNewBadge();
}
