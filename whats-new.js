// whats-new.js — the "What's new" page: the updates, newest first, each with a version number and the
// real date it went online (taken from the push history). Open to every member.
// Each entry has two lists: `everyone` (shown to all) and `leaders` (only shown to leaders/council, and
// never revealed to normal members).
//
// For the leaders' Discord posts: each version can be marked as "posted", and the big post only builds
// what is NEW since the last posted version, so nothing is announced twice (see wnBigPost below).
//
// TO ADD AN UPDATE: put a new object at the TOP of WHATS_NEW below with the next version number
// (the last one is 1.16 → the next is 1.17). Plain text only (no HTML).
'use strict';

const WHATS_NEW = [
    {
        version: '1.19', date: '2026-09-26',
        title: 'War & chain register for the war rule',
        everyone: [
            'The war rule ("3 of the last 5 wars") now uses a register where every chain belongs to exactly one war or chain event, so no chain is ever counted twice. A chain thrown after a war (to use up faction energy, which used to count for nothing once it ran past the 24 hours after the war) can now be counted, and a "chain event" — a chain done instead of a war — takes one of the last 5 slots like a war does and is passed with the chain-hit minimum. The "Your standing" card on the dashboard shows it as one of the last 5.',
            'The "current month" numbers on your dashboard (candy, alcohol, blood bags, and your place in each) now count every day up to today, not just full weeks — training midweek shows up right away instead of waiting for the next Sunday.',
            'Fixed: your War hits and Chain hits places (and the same competitions in the newsletter) now only count a war or chain event that ended in the period being looked at. Before, they were based on the rolling last 5 wars regardless of period, so a war could still be sitting in the "last 5" during the next newsletter too and win that competition a second time. The 3-of-5 war rule itself is unaffected — it still always looks at the last 5 wars.',
            'Fixed: the script\'s "Fill in your availability" reminder, and the leader dashboard\'s "X members haven\'t filled it in yet" card, used to stay hidden until a plan started within 4 days, so a plan made before a war is even matched (a placeholder date further out) never reminded anyone. Both now show as soon as there is a live plan.',
            'Fixed: Candy, Alcohol and Blood bags filled — on Member Overview, your "Your standing" card, and the newsletter — used to come from Torn\'s personal lifetime stats, which count everything you\'ve ever used or filled from any source, not specifically our own faction armory (so a member\'s number could be much higher than what the real armory log shows). These now come straight from that real armory log instead, per member, per day. It can only count from the day this went live on — a leader can press "Dig deeper" on Member Overview to pull in further history from Torn\'s own armory news. (Blood bags specifically were wrong on the very first day this shipped — the "filled" wording was a guess and Torn actually phrases it differently — fixed the same day against a real example; the tracker rebuilds itself once automatically, so press "Dig deeper" again to get back to where it was.)',
            'New personal reminder in the userscript\'s To do tab: "You\'re not in an Organized Crime right now" with a link straight to the OC tab, if you don\'t currently hold a spot in one — same idea as the existing revive/availability/feedback/Discord reminders, checked from your own key, no faction API access needed.',
            'Energy tracker: new "Weekly avg" column (your daily average scaled to a week, so it compares the same way whatever period you\'ve picked), colored green when you\'re meeting your own weekly minimum and red when you\'re not — the minimum is your own personal one from your total battle stats (4,400 or 2,200), never a flat number for everyone. It\'s known once you\'ve opened the Energy planner at least once; until then that member shows muted with no color, never guessed.',
            'Energy tracker: now defaults to the LAST FINISHED newsletter period instead of a rolling 30 days (a new "Last newsletter period" button too, next to "This newsletter month") - that\'s the cycle you\'re actually judged on, and it means opening the page doesn\'t need a re-pick (and a second fetch) just to see the numbers that matter. Also added a "Tier" column showing each member\'s Energy tier (1.5m+ / under 1.5m total battle stats) - the exact same one Member Overview shows, for a quick check without switching pages. Every column in the table is now clickable to sort by (Member, Avg E/day, Weekly avg, Tier, each stat, Total).',
        ],
        leaders: [
            'New "War & chain register" panel on Member Overview (above Rules): press "Load the register" to see every chain Torn has for us, newest first, each with a dropdown — a war, a chain event, Ignore, or not placed yet. Chains you haven\'t placed show the war they overlapped most with an Accept button (and "Accept all suggestions"). Add a chain event with a name and date at the bottom of the panel. The chain is read from Torn when you place it, so a wrong or unfinished chain is refused instead of silently counting nothing.',
            'Once a war has chains assigned, those are its chain hits for the war rule (the automatic chain scan is dropped for that war; war hits stay as they were). A chain event doesn\'t count for anyone until a chain is assigned to it. The panel title shows a warning when recent chains haven\'t been placed yet.',
            'The War Payout Calculator no longer has an "add chain" step: pick a war or a chain event from the list and its assigned chains are used automatically, so a chain can\'t be paid under two wars. Chain events have no war hits, so all their hits are paid at the flat chain rate.',
            'War payout reports now hold the whole picture: total pool, the costs by category, what was retained, the amount divided among members, the rates and hit totals, then the member list with a totals row. The payout calculator also shows a "Total to pay out" box, and only lists the latest 10 wars and chain events ("Show older" for the rest). War reports cards show the money flow for leaders. Reports saved earlier fill in what they can (the total pool is worked out from the net pool plus costs).',
            'The Newsletter page now builds the draft for Torn: no emoji, only the winner of each competition, the Steadfast swap (this month and next), the exact respect gained from the respect tracker, the perks upgraded and the perks coming up, shown as a styled card you can copy with its formatting (plus plain text boxes). You can also build it for the current, still running period.',
            'The per-kind numbers in Member Overview → Torn API usage are now estimates (1 call in 10 is recorded, 10 at a time), to cut the database writes that used up the monthly allowance. The per-minute figure, which is what matters for Torn\'s rate limit, is still exact.',
            'Fixed: members\' candy/alcohol/blood bag numbers for the current period could sit blank or stale, because Member Overview\'s dropdown defaults to the last FINISHED period, and only visiting with "Running now" selected used to keep the current period\'s numbers up to date. It\'s now refreshed every time Member Overview is opened, whatever period the dropdown is showing.',
            'The "View as" preview (sidebar) now has four options instead of a plain member toggle: Member, Council, Leader, Owner — previewing what each is meant to see, panel by panel where a page is split (e.g. Council sees the Respect Tracker\'s numbers but not its Goals or Log-war-respect panels). The Leadership menu now has two sub-menus, Leaders and Council, each locking as one group with a single 🔒 (closed, not clickable) instead of every page inside it being marked separately. This is mostly a look-and-feel preview, same as the old toggle — real enforcement (so Council genuinely can\'t call the Leader-only actions) is a separate, later step, tracked in AUDIT.md, except for Labs Funds which is now actually Leader/Co-leader/Owner only on the server, not just hidden.',
            'Dashboard: Respect Goal, Steadfast countdown and War Badges are now collapsible (Respect Goal open by default, the other two closed). "Who\'s on board" is gone from the Dashboard (it\'s Member Overview\'s own copy now, same as before, just not shown twice). "Other factions" and the "share this overview" toggle moved to the Labs Funds page, and "Other factions" is now really Owner-only, enforced on the server, not just hidden — before, any faction\'s leader who opted into sharing could see every other opted-in faction\'s data too. Every leader can still turn their own faction\'s sharing on/off.',
            'War Badges: turns out the "only 4 of 8 showing" wasn\'t a bug — checked against a real war (1,598 attacks) and the field names were all correct; those 4 categories (Rogue Element, Catalyst, Detonator, Volatile Compound) were just genuinely rare or zero for that particular war. A more recent war already shows all 8. Kept the "why are only 4 of 8 showing?" check on the War Badges page (leaders, under a picked war) in case a real pattern ever turns up.',
            'Weekly energy goals: fixed the Happy Jumping Guide telling people to "stack 4 Xanax back-to-back to reach 1000 Energy" (found the same wrong wording in two places, both fixed) - Xanax\'s drug cooldown is 6-8h per dose, so 4 of them takes at least a day, never one sitting. Every 4-Xanax jump (Big Choco, 5x/9x EDVD, Poison Mistletoe) now shows the real sequence: Xanax, wait 6-8h, Xanax, wait, Xanax, wait, Xanax. Guide steps are checkboxes now too, but a "wait" step isn\'t its own checkbox - it\'s a small arrow note under the step before it, since waiting isn\'t something you complete. "This week\'s plan" is collapsible now, and the "Install the script" panel is gone (the userscript is a general one now, linked from elsewhere).',
            'New training method: "Candy jump (2x daily)" - 24 candies + Ecstasy, twice a day about 12h apart, suggested by a faction member. Checked against the planner\'s own gym formula rather than taken on faith: hitting elevated Happy twice a day beats one bigger jump, since the formula\'s dominant term is close to linear in Happy. Shows up as a real option in the Tailored training plan and its comparison chart, same as every other method.',
            'The Tailored training plan\'s weekly checklist still crammed a whole 4-Xanax stack into one day even after the wording fix above - now properly rebuilt: a new "Xanax you\'ll take per day" setting (using a conservative 8h cooldown throughout) spreads the stacking across however many real days it takes, as its own block separate from the actual jump day; how many full jumps fit in the week is worked out from that instead of guessed, with any leftover day using natural energy rather than a half-finished jump; every step is a real checkbox except "wait" ones, which are a small arrow note; the 25-point refill at the end is now optional; and each method now shows the property it needs (Shack/Mansion/Private Island) right on its card and in the comparison chart. "This week\'s plan" is also its own separate, closeable card now.',
            'Fixed: Ecstasy is a drug too, and shares Xanax\'s drug cooldown - it can\'t be taken until the last Xanax\'s 6-8h cooldown has cleared, and then has its own 4h cooldown before the next drug. Every 4-Xanax jump\'s steps (guide and real weekly checklist) now show that extra wait instead of skipping straight from the last Xanax to the Ecstasy. Candy jump\'s daily repeat count is now a setting (2-4x a day) instead of fixed at "2x" - 2 is the member\'s own tested minimum, 4 is the real max worked out from whichever takes longer, a full Energy bar\'s own ~5h regen or Ecstasy\'s 4h cooldown.',
            'Fixed: the weekly checklist was still mixing natural energy fills into the same days spent waiting out a Xanax/Ecstasy cooldown, and Candy jump (Nx daily) was getting "extra" bars piled on top of its own already-repeating sessions - neither is actually possible in a day. Natural energy now only shows up on a genuine day off from stacking, once every jump for the week is placed, sized to however many days are really left over. Every natural energy fill now says how long it takes to regen (~5h a full bar) with a wait note in between, and the Natural energy - Soft/Hard day\'s own bars and Xanax doses show the same timing, so a plan reads as real pacing instead of a wall of same-instant checkboxes.',
            'Fixed: the LAST day of a Xanax stack was being written off completely even when it finished early with real spare time left (e.g. just the Ecstasy step, nothing queued after it) - that spare time now gets its own natural energy top-up, sized to exactly how much of the day is free, on top of any fully free days after it. Streamlined every method\'s "several jumps" labelling to one consistent "Jump 1 -", "Jump 2 -" style (Candy jump (Nx daily) used to say "Morning jump" / "Evening jump" / "Jump #3", all different). Moved "Compared over one week" higher up the page, right under the settings, so it\'s visible while you\'re still changing things instead of below the whole weekly checklist - and it\'s now collapsible too, same as the other panels on this page.',
            'Newsletter page now defaults to the last newsletter period that actually finished, instead of the one still running - that\'s the period a newsletter is normally built for, so opening the page no longer needs a re-pick (and a second, wasted round of API calls building the draft for the wrong period) almost every time.',
            'Added clickable column sorting to more tables that didn\'t have it yet: Labs Funds, War Payout Calculator and its shareable receipts, Respect tracker\'s daily breakdown, Mentoring\'s mentor/pupil lists, the Crimes guide\'s uniques list, and Availability\'s "compare hours vs hits" and overdose-list tools - click a header to sort by it, click again to flip direction.',
            'Respect tracker Goals: "Pace calculated from" now also offers "Past 3 months" alongside 14/21/28 days - useful when weekly respect gain is spiky rather than steady, since 28 days can be too short a window to give a fair ETA. Fixed: switching that setting used to replace the whole ETA, losing the other window\'s number - each goal now also shows a "Compare" line with every other window\'s own pace and projected date, so 14/21/28-day and 3-month can all be seen side by side instead of one at a time.',
        ],
    },
    {
        version: '1.18', date: '2026-09-25',
        title: 'To-do list: Discord/Intel/CAT, availability, and a real revive fix',
        everyone: [
            'The revive reminder on the WWL userscript\'s To do tab was actually wrong yesterday — turns out Torn\'s `revivable` field reads true for BOTH "Everyone" and "Friends and faction", and false only for "No one" (confirmed live against a real key on all three). So it can\'t tell those first two apart, but it doesn\'t need to: the message is now simply "You have your revives on, set them to \'no one\'." and fires correctly for either one.',
            'The To do tab now also flags: an upcoming war/weekend availability plan you haven\'t filled in yet, Torn Intel if a leader hasn\'t verified you on "Who\'s on board" yet, the CAT script the same way, and Discord if you haven\'t linked your Torn account to it (skipped for anyone a leader has marked exempt, e.g. a member in a country where Discord is banned).',
            'The WWL userscript now re-checks your to-do list when you come back to the Torn tab or click into the To do tab (at most every 30 seconds) — previously it only checked once when you opened it, so changing a setting (like revive) in another tab showed nothing new until you closed and reopened it. (An earlier version polled every 15 seconds instead, which used up far too much of the database\'s monthly request allowance — see below.)',
            'Cut the WWL userscript\'s database usage sharply after the monthly request allowance ran out: no more constant polling, energy/war standing numbers are kept locally for 30 minutes, the Targets tab only loads when you open it, banners are re-checked every 10 minutes again, and the revive check no longer writes throwaway cache entries.',
            'Fixed the ⚙ Settings button doing absolutely nothing on a computer: pressing it started the window-drag behavior (only the × close button was ever excluded from that), which stole the click before it could reach Settings.',
            'Tried putting the WWL button inside Torn\'s own page (the chat bar, then the header toolbar next to search/clock/avatar) a few times — both spots turned out to be too fragile (drag-and-drop conflicts in the chat bar; the header toolbar had no spare room and visibly squeezed Torn\'s own avatar icon when anything was added to it). Settled on keeping it a fully standalone icon instead — top-left on a computer, top-right on TornPDA — which never fights Torn\'s own layout.',
            'When a newer version of the WWL userscript is out, a small banner now shows right in the window (any tab, not just buried in ⚙ Settings) with a link straight to the update. (Computer only for now — checking for updates from inside TornPDA isn\'t possible the same way.)',
            'The WWL userscript\'s own window still said "WWL energy plan" in its title bar from before the rename — now says "World Wide Labs" too.',
            'The WWL userscript has two new tabs: a simplified 🎯 Targets tab showing the same My Targets list you build on the site (star a target on Level targets / Target finder / My targets and it shows up here, with live status and an Attack button), and a small strip above every tab with your energy trained this month and war participation — the same numbers "Your standing" on the dashboard shows, separate from the weekly plan checklist.',
            'The WWL userscript\'s ⚙ Settings now shows a "Show N dismissed banners again" button if you\'ve closed any with the banner\'s × — closing one hides it in your browser for good (by design), which had no way back if you didn\'t mean to, or forgot you had.',
            'Fixed the WWL userscript never flagging a newer version on TornPDA: the update check used to fetch the live script file directly and read its @version line, which needs a GET-capable connection TornPDA\'s script manager doesn\'t provide (only a POST one) — it silently never ran there at all. Now goes through the same request path every other call in the script already uses, so it works on both platforms.',
            'Fixed a just-added (or just-deleted) banner not showing up in the Torn-wide rotation right away: adding or deleting one via ⚙ Settings only ever refreshed the list shown there, not the separate cached copy the actual banner display reads from — it now refreshes that too.',
        ],
        leaders: [
            'Fixed "Who\'s on board" → Userscript column only ever showing leaders: the script\'s "I\'m here" check-in was being rejected for everyone who isn\'t a leader (it sat behind a leaders-only gate on the server), so members who installed the script and added their key never appeared. Members will show up the next time they open Torn with the script — and straight away when they add their key in ⚙ Settings.',
            '"Who\'s on board" has a new "Discord exempt" toggle next to Intel/CAT, for members who shouldn\'t be nagged to link Discord (e.g. it\'s banned where they are).',
        ],
    },
    {
        version: '1.17', date: '2026-09-24',
        title: 'Userscript to-do list and Torn-wide banners',
        everyone: [
            'The WWL userscript is renamed to "World Wide Labs" (was "WWL Energy plan"), moved to a cleaner install/update link (worldwidelabs.user.js — the old link still works so nobody\'s existing install breaks), and now opens on a new "To do" tab by default (order: To do, Energy, Mentoring): a daily "Check your energy plan" reminder that ticks off for today and resets tomorrow, plus small automated reminders — the Feedback form if you haven\'t answered it, the Timezone map if you haven\'t picked your country, your availability if there\'s an upcoming war/weekend plan you haven\'t filled in yet, and your revive setting specifically if it is "Everyone" (Torn\'s API can only ever detect that one setting, not tell "Friends and faction" apart from "Nobody" — cross-check Torn Intel for the other two) — each with a button straight to where you fix it. The little WWL button in Torn shows a dot with the count when there\'s something outstanding.',
            'WWL userscript: a new ⚙ Settings view (in the header) shows the installed version, flags it with a dot when a newer one is out, and lets you set or replace your saved API key whenever you\'re ready — it no longer forces a popup asking for your key the instant the script loads, which could catch you on a screen (like right after adding it in TornPDA) where you have no way to get to your key at all.',
            'WWL userscript on TornPDA now asks for your API key the same deliberate way as on a computer (via ⚙ Settings), instead of TornPDA\'s own prompt handing it over automatically the moment the script is installed. If you already had it linked, you\'ll need to paste your key in once via ⚙ Settings after this update.',
            'WWL userscript: banners a leader posts (Leader settings → Banners) now also show at the top of every Torn page, not just on the WWL site — so a faction message doesn\'t get lost in Torn\'s own event feed. Always exactly one line: a short banner sits centered, a long one scrolls sideways instead of wrapping, so the page never shifts as banners rotate. Closing one only dismisses it in Torn; the WWL site\'s own copy is unaffected.',
            'Fixed the WWL userscript\'s header buttons (⚙ Settings, ×) not responding to taps on TornPDA — a leftover style meant for dragging the window around on a computer was blocking normal taps on a touchscreen.',
            'The WWL button is now its own flask icon (dark background, green outline) instead of a generic emoji. On a computer it\'s back top-left, same spot as always. On TornPDA it\'s a small round icon top-right instead of the old bottom-right pill, which sat behind Torn\'s own bottom button row and couldn\'t be tapped at all — the to-do count now shows as a small corner badge there instead of full text, since there\'s no room for that on a small icon. (A version in between briefly tried putting it inside Torn\'s own chat bar, but that bar turns out to be drag-and-drop managed, which fought with it — caused lag and stopped taps from registering — so that was undone too.)',
            'Member Overview and Your standing no longer track Energy drinks, and it\'s dropped off the list of competitions.',
        ],
        leaders: [
            '"Who\'s on board" has a new "Userscript" column — whether a member actually has the WWL energy-plan script open in Torn (checked in within about the last hour), not just installed once and forgotten.',
            'WWL userscript: the new ⚙ Settings view also lets a leader add or delete their faction\'s banners right from Torn — same banners as Leader settings → Banners on the site, no need to switch over just to post one.',
        ],
    },
    {
        version: '1.16', date: '2026-09-23',
        title: 'Unfilled-in reminders on Feedback and War Availability',
        everyone: [
            'Feedback: the Feedback item in the menu now turns bold with a dot for as long as there is a form (built inside WWL, not a linked Google Form) you have not answered yet — unlike What\'s new, opening the page does not clear it, only actually submitting an answer does.',
            'War Availability: the same reminder now applies there too — the menu item turns bold with a dot for as long as you have not ticked a slot (or said you can\'t make it) on the next plan that has not finished yet.',
            'Perk roadmap: now shows the faction\'s current respect as a fraction of what the next perk needs ("X / Y respect available", with a small progress bar) instead of just the bare total.',
        ],
        leaders: [
            'Fixed a bug where adding a pupil in Mentoring admin returned an "Unknown action" error — adding a mentor already worked, adding a pupil now does too.',
            'War reports: new "＋ Add a report saved elsewhere" button, for payout reports made with WWL that never made it onto this list. If you still have the old reports\' links (or just their ids), paste them in — one per line, several at once — and they\'re added straight away, with a summary of what was added versus not found; nothing about the reports themselves changes. No link for one any more? Match it to the actual past war instead (fills in opponent, date, result and score) or type those in by hand, then list who got paid what.',
            'War reports: a "Restocked" checkbox now shows on each report too (whenever it is matched to a real war), the same shared marker as the one already on the War payout page\'s past-wars list — tick it in either place and it stays in sync.',
            'War reports: a 🗑 button next to each report removes it from this list (with a confirmation) — the receipt itself and its shareable link are left untouched, so pasting the same link back in brings it right back if it was removed by mistake.',
            'War reports: a report added by pasting an old link doesn\'t always come with enough to find its restocked checkbox automatically (it depends on whether Torn still lists that war). A new "🔗 Match to a war" button on any report missing it lets you pick the real war by hand instead — it also fills in the result and score if the report didn\'t have those either.',
            'Consumption Tracker: the restock shopping list now shows a "Restocked" column pulled straight from real armory deposits over the same date range — no typing needed. Deposit less than was needed and it shows how much is still short; deposit more and it shows the spare surplus.',
            'Consumption Tracker: a temporary weapon (flash grenade, HEG, etc.) that gets loaned out now counts as consumption too, same as a real "used" event — Torn never logs a "used" event for one once it has already left the armory via a loan, so the loan itself was the only signal it was ever gone, and it was being missed entirely.',
            'Consumption Tracker: 23 more of Torn\'s real "Temporary type" weapons are now tracked (only 6 were before) — including Epinephrine, Melatonin, Serotonin and Tyrosine, the four combat stat-boost needles, which were very likely the biggest actual gap since they\'re heavily used in wars.',
            'Consumption Tracker: new "Current armory stock" panel — a live snapshot straight from Torn (no date range) of Drugs, Medical, Boosters and Temporary items actually sitting in the armory right now, no news-parsing involved. Temporary items also show how many are ready versus out on loan, and to who — so a member holding onto a flash grenade shows up immediately, not just after they use it.',
        ],
    },
    {
        version: '1.15', date: '2026-09-22',
        title: 'Mentoring Platform, native feedback forms',
        everyone: [
            'New Mentoring Platform: if a leader has paired you up as a mentor or a pupil, a new 🎓 Mentoring item appears in the menu with your pairing, a shared checklist (ticked separately per pair) and a private chat with your mentor or pupil. Your checklist also shows in the WWL energy-plan userscript inside Torn, under a new Mentoring tab.',
            'Fixed a bug in the feedback form editor where a multiple-choice/checkbox option got cut off if it was longer than 50 characters — the limit is now 120, with a wider box to type it in. Long text also wraps properly now instead of ever running past the edge.',
            'Feedback form: leaders can now build a form right into WWL — no Google account needed — with short answer, paragraph, multiple choice and checkbox questions, a new "several short items" question for an open list of quick answers, and an optional "Other: ___" choice on multiple choice / checkbox questions. A live results chart (a donut for pick-one, bars for pick-several) shows for whichever questions the leader marks as public — open text is never made public, only the leader ever sees it. Linking a Google Form is still there too, for whoever prefers that. Each question now sits in its own card, closer to how Google\'s forms look.',
            'Member Overview and Your standing now also count what you have trained today so far, not just up to midnight — the same live number the Energy tracker shows.',
            'Energy tracker: today\'s row now updates through the day (roughly every hour) instead of staying at zero until tomorrow, with a note saying how fresh it is ("up to date as of HH:MM TCT").',
            '"Who\'s on board" (who has logged into WWLabs, Discord, Torn Intel and CAT) now also shows on Member Overview, under the member table, not just the dashboard. It also has two new columns: Torn Intel and CAT have no way for WWL to check automatically, so click the ○/✓ next to a member to tick them by hand once you\'ve confirmed it — their own "Tools & Links" page then shows the same ✓ badge Discord gets.',
            'War Availability: you can now change how many days a plan\'s grid shows after creating it ("✎ Change days shown" next to the plan dropdown) — no need to delete and recreate it just because a termed war ran shorter than expected. A termed war can also get an "Expected to last about (days)" guess, which softly rings those whole days in the grid — it never stops anyone ticking a later day, so nothing is lost if the terms fall through and it runs long.',
        ],
        leaders: [
            'Mentoring admin: adding a mentor or pupil is now a dropdown of your actual roster (pick the name) instead of typing a player ID and name by hand. Leaders can also now see "👁 All mentoring pairs" on the Mentoring page itself — every pairing\'s checklist and chat, read-only — even without being signed up as a mentor or pupil yourself.',
            'Availability overview: you can now archive a plan (📦 Archive this plan, next to the plan dropdown). An archived plan stops showing to members and can\'t be filled in any more, but nothing on it is deleted — pick it later from the new "Archived plans" list to check it, its entries and its war result.',
        ],
    },
    {
        version: '1.14', date: '2026-09-21',
        title: 'Availability hours vs hits, map fix',
        everyone: [
            'Target pages: the hospital status is now shown by itself (Okay, or Hospital with the time left counting down) on Level targets, Target finder and the other target lists. A row you pressed Attack on turns faded green for 24 hours, so you know where you left off. New ★ button on every target adds the player to the new My targets page (Targets menu): your own list of easy targets with decent respect, with a note, their status and an Attack button. The list follows you between PC and TornPDA.',
            'The tool now uses much more of a wide screen (it was limited to a narrow column).',
            'Bugs & suggestions: the full text of a bug report is now shown to everyone right under each known bug, so you can read it before pressing "I have this too" (long ones have a "Read the rest"; the name of the sender is only shown to leaders). Long titles are cut at a word with …, and long text wraps on a phone instead of running off the screen.',
            'New banners: a leader can pin a short message at the top of every page (Leader settings → Banners) — for a new feature, a Torn event or a reminder. Pick who sees it (everyone in your faction or only its leaders; an owner can also show a banner to all factions), a colour, an end date, an optional icon, an optional live countdown (for example to a Torn event) and an optional button to a page. With more than one, they slide to the next by themselves (arrows, dots and swiping work too). You can close a banner; it comes back only if the text is changed.',
            'War Availability: new blue ring. Turn on the switch above your grid and click hours to mark when you will be a Chain saver (on a chain plan: online and active, keeping an eye on the chain) or a War guard (on a war plan: online and active, keeping an eye out for when things go wrong — making the calls, changing plans, keeping the chat clear, motivating people). Green and yellow still say how sure you are to be online; the blue ring says what you will do while you are. Each hour has room for one, plus one backup, so not everyone piles into the same hour. Leaders see the blue count per hour and who it is.',
            'Behind the scenes: WWL now remembers answers from Torn that hardly ever change (who you are, faction access, the member list) for a few minutes instead of asking again on every page, waits and retries once when Torn says "too many requests", and counts its calls. Members will notice fewer "too many requests" errors.',
            'War Availability: when a plan has a start time (a linked war, or a chain start typed in), the hours before that start are now greyed out and can\'t be ticked any more. Hours ticked there before are left out of the counts.',
            'Timezone map: fixed the stretched line across the map — the far east of Russia (and Alaska\'s far islands) now show up correctly on the other side of the map.',
        ],
        leaders: [
            'Availability overview: the overdoses are now a list — every member who overdosed, how many times, when it shows up in Torn history and how many hours before the war start that was (red = within 24 h, yellow = 24 to 48 h). Torn only saves stats as snapshots, so the time means it was in the record by then.',
            'Bugs & suggestions: a "Copy all bugs & suggestions" button copies every bug and suggestion with the full text (status, votes, who sent it, screenshot yes/no) in one go. New bug reports now keep their full text, which you can open under each known bug ("Full report").',
            'New "Torn API usage (my key)" button in Member Overview → Checks for the developer: shows how many calls WWL made with your key in the last two hours, the busiest minute and which kinds of calls are used most, so we can see where they go.',
            'Availability overview: new "Leader: link a war to this plan" panel — once we are matched, link the ranked war to the plan (its start time comes from Torn), mark it as termed or not, and for a termed war fill in what was agreed — who wins, the lead needed and the loser\'s share (for example a lead of 10,000 with 40% for the loser gives 14,000 for the winner and 4,000 for the loser). It shows in the war line above the grid.',
            'New Leader settings page (Leadership menu): the Discord settings and the nightly saving now live together in one place, with a list of where the other leader tools are. The Discord settings moved here from the Availability overview, and the nightly switch moved here from the dashboard card.',
            'New "For leaders: things to do" card at the top of the dashboard (and a red count next to Dashboard in the menu): it lists what needs a leader — Discord not connected, nightly saving off or failed, no availability plan for what is coming up, members who have not filled in the plan yet, and Steadfast challenges that are all done — each with a button that takes you to the right page and spot. It disappears when there is nothing to do.',
            'Availability overview: name pills of members who are on Discord are tinted faded green, and the ping only @mentions those. On our Discord server the bot decides who is on it; a faction with its own Discord server uses the account linked on Torn instead. Members who are not on it are skipped and listed, and the ping buttons say how many will be pinged.',
            'Availability overview: in the "Filled in" list every member now shows the hours they ticked, green for available and yellow for maybe (for example 43 +12).',
            'Availability overview: new "Hours ticked vs hits made" — for a plan linked to a ranked war, compare each member\'s ticked hours with their real war hits. Someone who ticked 40 hours and hit once is flagged with a ⚠️, and you can copy the flagged names for the review. When we are only chaining and not warring, add chain report IDs or links there and it counts the chain hits instead. A chain that is still running works too: fill in when it started and it counts the chain hits from then until now.',
        ],
    },
    {
        version: '1.13', date: '2026-09-20',
        title: 'Timezone map, Newsletter and the energy plan inside Torn',
        everyone: [
            'On a phone the menu is now hidden like in Torn: press the ☰ button or swipe from the left edge to the right to open it. The menu items are real links now, so you can open one in a new tab, and Vimium and other browser tools work with them.',
            'Bugs & suggestions: the screenshot of a bug is now shown to everyone on the Known bugs list (press "View screenshot"), and you can attach a short screen recording (up to about 3 MB) to a bug report.',
            'Energy planner: a new "Use this checklist inside Torn" box has a small userscript you install with one click in Tampermonkey (or paste into TornPDA). It shows your weekly checklist on Torn\'s gym page, with the same ticks as the site, and a link back to the planner for changing your settings.',
            'New Timezone map (Faction menu): a world map with the timezone lines. Choose your country and it lights up — the more members from a country, the greener. The US is split into its states, and a magnifier button (2×, 4× or 8×) enlarges any spot you hover over. Nobody is shown by name.',
        ],
        leaders: [
            'New Newsletter page (Leadership menu): builds a draft of the monthly newsletter in Discord-sized parts — competition winners incl. energy trained, the Steadfast perks of this and next month, respect gained, perks upgraded and what the perk roadmap unlocks next. You can change every part before you copy it. Respect gained and perks upgraded are saved from today on, so they fill in from the next newsletter.',
        ],
    },
    {
        version: '1.12', date: '2026-09-20',
        title: 'Energy tracker: energy trained in the gym per member',
        everyone: [
            'New Energy tracker page (Training menu): the energy every member trained in the gym per stat and per day, like Torn Intel — click a member for the day-by-day rows, pick any dates in the calendar (or "This newsletter month"), and follow your own row.',
            '"Your standing" on the dashboard now shows your real energy trained this month and over the rolling 4-5 weeks.',
            'Bug reports page: new Suggestions box — add an idea and vote 👍 or 👎 on the ideas of others; the most wanted come first.',
        ],
        leaders: [
            'Energy trained in the gym is now counted for every member from the faction\'s own gym counters: an "Energy trained" column in Member Overview (with a winner for it, and the weekly minimum next to it).',
            'The days before we started counting were filled in from Torn Intel (Member Overview → "Energy trained: fill in the past"). From now on the counter runs by itself.',
            'You can switch on nightly saving on the dashboard card (Steadfast countdown) with your own key, kept encrypted — so nothing is missed on days nobody logs in.',
            'Suggestions: you can mark each idea as planned, done or not planned, or delete it.',
        ],
    },
    {
        version: '1.11', date: '2026-09-20',
        title: 'Faction menu, Steadfast countdown, Availability overview and more',
        everyone: [
            'New Faction menu → Steadfast planner: which stats get the top perk this month and next month (swapped on the first Sunday), the rotation for the whole year, and the countdown of the energy still to train per stat.',
            'New Faction menu → Perk roadmap: the order in which the faction unlocks its perks with respect. What we have is ticked off automatically from the real levels, the next perk is highlighted, and it shows how far behind schedule we are.',
            'New "Steadfast countdown" card on the dashboard: for every stat, how much energy the faction has trained towards the challenge to be able to upgrade to 9%, how much is still to go, and about when it will be done. We upgrade when all of them are done.',
            'The Lollipop jump is now the Candy jump: any candy worth 25 happy works, and you pick which candy you use in the training planner, so the cost is right for you. There are also Candy jumps with 1 or 4 Xanax, like the Big Choco ones.',
            'Bug reports: a report you send now also appears in the Known bugs list as "To review" (without your name), so others who run into the same thing can press "I have this too" instead of sending it again.',
        ],
        leaders: [
            'The Steadfast countdown updates by itself whenever a leader opens WWL. You can get a picture link (like YATA\'s posters) on the dashboard card, paste it in the faction announcement once, and the picture stays up to date for everyone, without logging in.',
            'Availability overview (Leadership menu): the leaders\' side of War Availability — the heatmap, who filled it in, overdoses, creating plans and the Discord settings — moved to its own page, so the War Availability page is just the grid for everyone.',
            'Known bugs: reports sent through the site arrive with the status "To review"; mark them known, being fixed or fixed, or delete them.',
        ],
    },
    {
        version: '1.10', date: '2026-09-20',
        title: 'War reports, Gym stats and Bug reports',
        everyone: [
            'War reports (War menu): every past war payout report with the opponent, win or loss, the score and a link to the full report. Open the pay details to see what was paid — leaders see everyone, everyone else sees their own line.',
            'Gym stats (Training menu): a graph of your own battle stats over time, your growth over the last weeks, and personal goals per stat with an estimate of when you will reach them. It builds up every day you open WWL.',
            'Bug reports (bottom of the menu): describe a problem, add a screenshot (or paste one with Ctrl+V) and it goes straight to the owner on Discord. Check the "Known bugs" list first — if your problem is on it, press "I have this too" instead of sending another report.',
        ],
        leaders: [
            'Bug reports: you can keep the Known bugs list up to date (add a bug, mark it known / being fixed / fixed, delete it) and you see how many members have each one.',
        ],
    },
    {
        version: '1.9', date: '2026-09-20',
        title: 'Tailored training plan (Energy planner)',
        everyone: [
            'Pick the stat to train (the two stats with the best faction Steadfast bonus are starred) and how you train: natural energy — Soft or Hard — or a happy jump (Candy, Big Choco, 5 EDVD, 9 EDVD). Every method is a card that already shows its estimated stat gain and item cost for a week, and all methods are compared side by side.',
            'You get a week plan — 4 training days, 2 war prep days and the war day — with a tick box for every step and a progress bar in energy.',
            'Everything is pulled from your own account: your stat, max happy, energy bar (donator or not), gym, and your gym bonuses (faction Steadfast, candy bonus, property and education perks, cooldowns). Your total battle stats only decide your weekly minimum: 4,400 energy at 1.5m+, 2,200 under. The estimates use the community gym formula, so they are estimates — Torn adds a random amount to every train.',
            'Natural energy: Soft is 3 bars + 2 Xanax a day (3 log-ins), Hard is 4 bars + 3 Xanax. The daily energy refill is on by default, you can add energy cans (each can has its own energy and price), and experienced players can set their own bars and Xanax per day.',
            'Your settings fold away into one button once you have chosen, so the page shows your plan first.',
        ],
        leaders: [],
    },
    {
        version: '1.8', date: '2026-09-20',
        title: 'Tidier menu and Energy planner fixes',
        everyone: [
            'The menu is reorganised: a War group (War Badges, War Availability, War reports), a Crimes group (Crimes Guide, OC Fit Tracker), and What\'s new, Tools & links, Feedback and Bug reports at the bottom. What\'s new turns bold with a dot when there is an update you haven\'t opened yet.',
            'Energy planner: the Happy Jump guides are closed by default, and the weekly minimum under 1.5m battle stats is now correctly 2,200 energy (it said 2,400).',
            'War participation fix: a war counts when you did 10 war hits, or 20 chain hits if you did fewer than 10 war hits (before, the chain hits only counted if you had no war hits at all).',
        ],
        leaders: [],
    },
    {
        version: '1.7', date: '2026-09-20',
        title: 'Your standing on the dashboard',
        everyone: [
            'New "Your standing" card on the dashboard: how much energy you need to train this month (4,400 a week at 1.5m+, 2,200 below — 17,600 or 22,000 for a 4 or 5 week month), how many of your last 5 wars count as taken part in (e.g. 3/5, or 1/2 if you joined recently), and your place this month for war hits, chain hits, blood bags, candy, alcohol and energy drinks.',
        ],
        leaders: [
            'The "Who\'s on board" and "Other factions" lists on the dashboard are closed by default — click the title to open them.',
            'Polls: you can hide a poll from the dashboard (and show it again) without deleting it — under Announcements, "Hide from dashboard".',
        ],
    },
    {
        version: '1.6', date: '2026-09-19',
        title: 'Member Overview and this What\'s new page',
        everyone: [
            'What\'s new (this page): every update, with a version number and date.',
            'War participation rule: a war counts when you did 10 war hits, or 20 chain hits if you did fewer than 10 war hits, and you need it in 3 of your last 5 wars. Wars from before you joined the faction are not held against you.',
        ],
        leaders: [
            'Member Overview (Leadership menu, leaders and council only): for the last 5 wars, war hits and chain hits per member with a green / red light for who took part in enough wars — wars before someone joined are not counted against them. Also blood bags filled, candy, alcohol and energy drinks used per period, and each member\'s energy group and weekly need.',
            'Member Overview periods run Sunday to Sunday and follow the newsletter (first Sunday of the month, 4 or 5 weeks), with a Total / Per week switch, an "Exact dates" option to compare with other tools, a winner for each competition and a "Copy for newsletter" button.',
        ],
    },
    {
        version: '1.5', date: '2026-09-19',
        title: 'Labs Funds and View as member',
        everyone: [],
        leaders: [
            'Labs Funds (Leadership menu): every faction\'s war payout cut in one place with history and totals. Any leader can view it; only the owner can change it (the owner claims it on first use).',
            'View as member: a button in the sidebar to preview exactly what a normal member sees.',
        ],
    },
    {
        version: '1.4', date: '2026-09-19',
        title: 'War Availability: plans, overdoses and yellow boxes',
        everyone: [
            'Click a box once for green (available), twice for yellow (probably, but busy with something else), a third time to clear it.',
            'A plan picker to see this weekend and next weekend, and the "Create a plan" and Discord settings panels are closed by default; the timezone switch now sits right above the grid.',
        ],
        leaders: [
            'Create several plans (this weekend, next weekend), each with its own grid and linked war.',
            'Overdoses: who has overdosed since midnight before the 48 hours ahead of the war, so you know who may take part less.',
        ],
    },
    {
        version: '1.3', date: '2026-09-19',
        title: 'War Availability: timezone, who is available and Discord pings',
        everyone: [
            'A switch to show all times in your own timezone, plus a big banner explaining it, and smaller boxes in a scrollable grid.',
            'An "I can\'t make it" button for when you are out for the whole war.',
        ],
        leaders: [
            'Click an hour in the heatmap to see who is available then.',
            'A list of who has filled it in, who hasn\'t, and who can\'t make it. Link a plan to a war so the start time comes from Torn.',
            'Ping people on Discord — everyone in an hour, or everyone who hasn\'t filled it in — with a message from a set of standard ones and the time it starts. Each faction sets its own Discord channel or webhook under "Discord settings", so factions never post into each other\'s channels.',
        ],
    },
    {
        version: '1.2', date: '2026-09-18',
        title: 'War Availability and page links',
        everyone: [
            'War Availability (War menu): tick the hours you can play before a war, in real time slots (00:00 – 01:00), so leaders can see when the faction can mobilise.',
            'Every page now has its own address, so you can link straight to a page (for example /availability).',
        ],
        leaders: [],
    },
    {
        version: '1.1', date: '2026-09-18',
        title: 'War Badges for everyone and a better Consumption Tracker',
        everyone: [
            'War Badges (War menu) is open to everyone and reads from the saved payout reports, so everyone can see the badge winners of past wars.',
        ],
        leaders: [
            'Consumption Tracker: a hand-picked list of items (drugs, medical, energy drinks, candy, alcohol, temporary items), blood bags grouped under Medical, and the numbers now match the armory log (long date ranges are read in pieces).',
            'A "restocked" tick box per war in the War Payout list.',
        ],
    },
    {
        version: '1.0', date: '2026-09-06',
        title: 'War Payout fix, War Badges and Consumption Tracker',
        everyone: [
            'War Badges: awards for the best in each category of a war, with the badge winners of the last war shown on the dashboard.',
            'Payout receipts can be opened by everyone with the link.',
        ],
        leaders: [
            'War Payout calculator fixed: every war hit is now counted straight from Torn, not just hits inside the chains you add. Chain hits after the war are paid at the flat chain rate, and hits can\'t be counted twice.',
            'Consumption Tracker (Leadership menu): pick a date range to see what was used per item, and get a shopping list to restock.',
        ],
    },
];

const wnFmtDate = d => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// ---- which version was last posted in Discord — one shared, faction-wide fact on the server, not
// localStorage (that was per-browser, so different leaders on different devices each had their own
// independent "posted up to" marker instead of one everyone agreed on). ----
const WN_POSTED_DEFAULT = '1.13'; // what the owner had already posted in Discord (up to v1.13); a leader can move it with "Mark posted up to here"
let wnPostedVersion = null; // filled in by wnEnsurePosted() the first time the page renders
let wnPostedRequested = false;
async function wnEnsurePosted() {
    if (wnPostedRequested) return;
    wnPostedRequested = true;
    try {
        const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, action: 'whatsnew-posted-get' }) });
        const d = await res.json();
        wnPostedVersion = d.posted || WN_POSTED_DEFAULT;
    } catch (e) { wnPostedVersion = WN_POSTED_DEFAULT; }
    renderWhatsNew(); // re-render now that the real value (rather than the fallback default) is known
}
const wnPostedIndex = () => WHATS_NEW.findIndex(e => e.version === (wnPostedVersion || WN_POSTED_DEFAULT)); // index of the newest version already posted, -1 = none
function wnSetPosted(version) {
    wnPostedVersion = version; // reflected locally right away; the save below is best-effort
    fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, action: 'whatsnew-posted-set', version }) }).catch(() => {});
}

function renderWhatsNew() {
    markWhatsNewSeen(); // opening the page counts as having seen the latest update
    wnEnsurePosted(); // fires once; re-renders itself when the real "posted" value comes back
    const leader = typeof isLeaderCached !== 'undefined' && isLeaderCached;
    const posted = wnPostedIndex();
    $('wn-leader-tools').style.display = leader ? 'block' : 'none';
    const news = WHATS_NEW.filter((e, i) => posted < 0 || i < posted).length; // versions not posted yet
    $('wn-posted-note').innerHTML = posted < 0 ? 'Nothing is marked as posted yet.'
        : `Last posted in Discord: <b style="color:var(--text);">v${esc(WHATS_NEW[posted].version)}</b>. ${news ? `<b style="color:var(--reagent);">${news} newer version${news === 1 ? '' : 's'}</b> not posted yet.` : 'Everything has been posted.'}`;
    $('wn-list').innerHTML = WHATS_NEW.filter(e => leader || (e.everyone || []).length).map(e => {
        const i = WHATS_NEW.indexOf(e);
        const isPosted = posted >= 0 && i >= posted;
        const items = (list, tag) => list.map(t => `<li style="margin:4px 0;">${tag ? `<span class="chip" style="cursor:default;font-size:10px;padding:1px 6px;margin-right:6px;">leaders</span>` : ''}${esc(t)}</li>`).join('');
        return `
        <div class="panel">
            <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
                <span style="font-family:var(--mono);font-size:12px;font-weight:700;color:var(--reagent);border:1px solid var(--reagent);border-radius:10px;padding:1px 8px;">v${esc(e.version)}</span>
                <h3 style="margin:0;">${esc(e.title)}</h3>
                <span style="color:var(--muted);font-size:12px;">${wnFmtDate(e.date)}</span>
                ${leader ? `<span style="margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">${isPosted ? '<span style="color:var(--muted);font-size:12px;">✓ posted</span>' : ''}
                    <button class="ghost small wn-send" data-i="${i}" title="Posts this version straight to the What's new Discord channel, as an embed (no character limit)">🚀 Send to Discord</button>
                    <button class="ghost small wn-copy" data-i="${i}">Copy as message</button>
                    <button class="ghost small wn-mark" data-v="${esc(e.version)}" title="Marks this version and all older ones as posted in Discord">Mark posted up to here</button></span>` : ''}
            </div>
            <ul style="margin:0;padding-left:20px;font-size:14px;">
                ${items(e.everyone || [], false)}${leader ? items(e.leaders || [], true) : ''}
            </ul>
        </div>`;
    }).join('');
    document.querySelectorAll('.wn-copy').forEach(b => b.addEventListener('click', () => {
        const e = WHATS_NEW[Number(b.dataset.i)];
        const bullet = t => `• ${t}`;
        const text = [`📢 **WorldWideLabs v${e.version}: ${e.title}**`,
            (e.everyone || []).length ? `\n**For everyone**\n${e.everyone.map(bullet).join('\n')}` : '',
            (e.leaders || []).length ? `\n**For leaders and council**\n${e.leaders.map(bullet).join('\n')}` : ''].join('\n');
        navigator.clipboard.writeText(text).then(() => toast('Message copied — paste it in Discord'));
    }));
    document.querySelectorAll('.wn-mark').forEach(b => b.addEventListener('click', () => { wnSetPosted(b.dataset.v); renderWhatsNew(); toast(`Marked as posted up to v${b.dataset.v}`); }));
    document.querySelectorAll('.wn-send').forEach(b => b.addEventListener('click', () => wnSendOneToDiscord(Number(b.dataset.i))));
}
// Posts one version straight to Discord as a single embed (title + everyone/leaders bullets, same
// content "Copy as message" builds) instead of copy-paste text — an embed description allows ~4096
// characters vs. a message's 2000, which is what actually fixes a long version being too big to paste.
async function wnSendOneToDiscord(i) {
    const e = WHATS_NEW[i];
    if (!e) return;
    const mine = [...(e.everyone || []).map(t => `• ${t}`), ...(e.leaders || []).map(t => `• 🔒 (leaders) ${t}`)];
    const embed = { title: `v${e.version} — ${e.title}`, description: mine.join('\n') || '(nothing to show)', color: 0x35d99b };
    try {
        const res = await fetch('/api/war-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: apiKey, action: 'whatsnew-post', embeds: [embed] }) });
        const d = await res.json();
        if (d.error) throw new Error(d.error);
        toast(`Posted v${e.version} to Discord`);
        const curPosted = wnPostedIndex(); // lower index = newer version — only move "posted" forward
        if (curPosted < 0 || i < curPosted) wnSetPosted(e.version);
        renderWhatsNew();
    } catch (err) { toast(`Couldn't post to Discord: ${err.message}`); }
}

// ---- one big post with the updates NOT posted yet (or all of them), split into parts that each fit in a
// Discord message (2,000 characters) ----
function wnBigPost(includeLeaders, onlyNew) {
    const posted = wnPostedIndex();
    const from = onlyNew && posted >= 0 ? posted : WHATS_NEW.length; // entries with index < from are new
    const list = WHATS_NEW.slice(0, from);
    const first = list[list.length - 1], last = list[0];
    const lines = [`📢 **WorldWideLabs — ${onlyNew && posted >= 0 ? `new since v${WHATS_NEW[posted].version}` : 'everything that is new'}${list.length ? ` (v${first.version}${list.length > 1 ? ` – v${last.version}` : ''})` : ''}${includeLeaders ? ' — leaders and council' : ''}**`];
    list.forEach(e => {
        const mine = [...(e.everyone || []).map(t => `• ${t}`), ...(includeLeaders ? (e.leaders || []).map(t => `• 🔒 (leaders) ${t}`) : [])];
        if (!mine.length) return;
        lines.push(`\n**v${e.version} — ${e.title}**`, ...mine);
    });
    if (lines.length === 1) return [];
    const parts = []; let cur = '';
    for (const line of lines) {
        const piece = line.length > 1900 ? line.slice(0, 1900) : line;
        if ((cur + '\n' + piece).length > 1900 && cur) { parts.push(cur); cur = piece; } else cur = cur ? `${cur}\n${piece}` : piece;
    }
    if (cur) parts.push(cur);
    return parts;
}
function renderWnBig(parts, label) {
    if (!parts.length) { $('wn-big').innerHTML = '<div style="color:var(--muted);font-size:13px;margin:8px 0;">Nothing new to post — everything is already marked as posted.</div>'; return; }
    $('wn-big').innerHTML = `<div style="color:var(--muted);font-size:12px;margin:8px 0;">${esc(label)} — Discord takes 2,000 characters per message, so it is in ${parts.length} part${parts.length === 1 ? '' : 's'}. Copy and post them in order, then press "I posted it".</div>`
        + parts.map((p, i) => `<div style="margin-bottom:10px;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;"><b style="font-size:13px;">Part ${i + 1} of ${parts.length}</b><span style="color:var(--muted);font-size:12px;">${p.length} characters</span>
                <button class="ghost small wn-part" data-i="${i}" style="margin-left:auto;">Copy part ${i + 1}</button></div>
            <textarea readonly rows="6" style="width:100%;font-size:12px;">${esc(p)}</textarea></div>`).join('')
        + `<button class="ghost small" id="wn-posted-btn">✓ I posted it — mark v${esc(WHATS_NEW[0].version)} and older as posted</button>`;
    $('wn-big').querySelectorAll('.wn-part').forEach(b => b.addEventListener('click', () => {
        navigator.clipboard.writeText(parts[Number(b.dataset.i)]).then(() => toast(`Part ${Number(b.dataset.i) + 1} copied`));
    }));
    $('wn-posted-btn').addEventListener('click', () => { wnSetPosted(WHATS_NEW[0].version); $('wn-big').innerHTML = ''; renderWhatsNew(); toast('Marked as posted'); });
}
$('wn-big-new').addEventListener('click', () => renderWnBig(wnBigPost(false, true), 'Post for everyone — only what is new since the last posted version'));
$('wn-big-new-leaders').addEventListener('click', () => renderWnBig(wnBigPost(true, true), 'Post for leaders — only what is new since the last posted version'));
$('wn-big-all').addEventListener('click', () => renderWnBig(wnBigPost(false, false), 'Post for everyone — all versions'));
$('wn-big-leaders').addEventListener('click', () => renderWnBig(wnBigPost(true, false), 'Post for leaders — all versions'));

// ---- "something new" marker on the sidebar item -------------------------------------------------
// The item turns bold (with a dot) when the newest update this person can see hasn't been opened yet.
// Remembered per browser: opening the What's new page marks the latest update as seen.
const WN_SEEN_KEY = 'wwl_whatsnew_seen';
function wnLatestId() {
    const leader = typeof isLeaderCached !== 'undefined' && isLeaderCached;
    const e = WHATS_NEW.find(x => leader || (x.everyone || []).length); // members skip updates that are leaders-only
    return e ? `${e.version}|${e.title}` : '';
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
