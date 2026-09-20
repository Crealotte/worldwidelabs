// whats-new.js — the "What's new" page: a list of updates, newest first, open to every member.
// Each entry has two lists: `everyone` (shown to all) and `leaders` (only shown to leaders/council,
// and never revealed to normal members). Leaders also get a "Copy as message" button that turns an
// entry into text ready to paste into Discord.
//
// TO ADD AN UPDATE: put a new object at the TOP of WHATS_NEW below. Plain text only (no HTML).
'use strict';

const WHATS_NEW = [
    {
        date: '2026-09-21',
        title: 'Tailored training plan and Gym stats',
        everyone: [
            'Energy planner: pick how you train (natural energy, Lollipop jump, Big Choco, EDVD…) and get a week plan — 4 training days, 2 war prep days and the war day — with tick boxes to track it.',
            'It also estimates the stat growth and the item cost of each method for one week, side by side, so you can see what a jump really buys you. These are estimates, since Torn adds a random amount to every train.',
            'Everything in the planner is now pulled from your own account (stat, max happy, energy bar, gym, and your gym bonuses like the faction Steadfast, candy bonus and cooldown perks) — you only pick the stat to train and how you train. Your total battle stats only set your weekly minimum: 4,400 energy at 1.5m+, 2,200 under.',
            'Natural energy comes as Soft (3 bars + 2 Xanax a day, 3 log-ins) or Hard (4 bars + 3 Xanax), each with the daily energy refill on by default, and you can add energy cans (every can has its own energy and price). Experienced players can set their own bars and Xanax.',
            'New War reports page (War menu): every past war payout report with the opponent, win or loss, the score and a link to the full report. Open the pay details to see what was paid — leaders see everyone, everyone else sees their own line.',
            'New Gym stats page (Training menu): a graph of your own battle stats over time, your growth over the last weeks, and personal goals per stat with an estimate of when you will reach them. It builds up every day you open WWL.',
            'The stat to train is now a row of buttons: the two stats with the best faction (Steadfast) bonus are marked with a star. Every training method is a card that already shows its estimated stat gain and cost for a week, and both Soft and Hard natural energy are compared next to the jump methods.',
        ],
        leaders: [],
    },
    {
        date: '2026-09-20',
        title: 'Sidebar tidy-up and war rule fix',
        everyone: [
            'The sidebar is reorganised: a new War group (War Badges and War Availability), a Crimes group (Crimes Guide and OC Fit Tracker), and What\'s new, Tools & links and Feedback now sit at the bottom. What\'s new turns bold with a dot when there is an update you haven\'t opened yet.',
            'War participation: a war now counts when you did 10 war hits, or 20 chain hits if you did fewer than 10 war hits (before, the chain hits only counted if you had no war hits at all).',
        ],
        leaders: [],
    },
    {
        date: '2026-09-20',
        title: 'Your standing on the dashboard',
        everyone: [
            'New "Your standing" card on the dashboard: your energy group (worked out from your own total battle stats), the energy you need to train this month (4,400 a week at 1.5m+ stats, 2,200 below — 17,600 or 22,000 in a 4 or 5 week month at the top group), how many of the last 5 wars you took part in, and your place this month in each competition.',
            'The "Who\'s on board" and "Other factions" lists on the dashboard are now closed by default — click the title to open them.',
        ],
        leaders: [
            'Member Overview: the energy group is now picked automatically from each member\'s own battle stats (you can still override it), it shows the energy each member needs for the period, and there is an "Exact dates" option to compare with other tools.',
            'Polls: you can now hide a poll from the dashboard (and show it again) without deleting it — under Announcements, "Hide from dashboard".',
        ],
    },
    {
        date: '2026-09-20',
        title: 'Member Overview, Labs Funds and a lot more',
        everyone: [
            'What\'s new page (this one): every update from now on is listed here.',
            'War Availability: click a box once for green (available), twice for yellow (probably, but busy with something else), a third time to clear it.',
        ],
        leaders: [
            'Member Overview (Leadership menu): hits over the wars in a period (war + chain), blood bags filled, candy / alcohol / energy drinks used, and a green / yellow / red light for who needs a push. Periods run Sunday to Sunday and follow the newsletter (first Sunday of the month), with a winner for each competition and a "Copy for newsletter" button.',
            'Labs Funds (Leadership menu): every faction\'s war payout cut in one place, view-only for leaders.',
            'View as member: a button in the sidebar to preview exactly what a normal member sees.',
            'War Availability: pick between several plans (this weekend, next weekend), link a plan to a war, ping people on Discord with a message and start time, and see who has overdosed since 48 hours before the war. Set your faction\'s Discord channel first under "Discord settings".',
        ],
    },
    {
        date: '2026-09-06',
        title: 'War Payout, War Badges and Consumption Tracker',
        everyone: [
            'War Badges: see your badges from past wars, with the receipts of every payout.',
            'Every page now has its own address, so you can link straight to a page (for example /availability).',
        ],
        leaders: [
            'War Payout calculator fixed: every war hit is now counted straight from Torn, not just hits inside the chains you add. Chain hits after the war are paid at the flat chain rate. Payout receipts can be saved and shared with a link.',
            'Consumption Tracker: pick a date range to see what was used per item and get a shopping list to restock. There is a "restocked" tick box per war.',
        ],
    },
];

const wnFmtDate = d => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function renderWhatsNew() {
    markWhatsNewSeen(); // opening the page counts as having seen the latest update
    const leader = typeof isLeaderCached !== 'undefined' && isLeaderCached;
    $('wn-list').innerHTML = WHATS_NEW.map((e, i) => {
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
