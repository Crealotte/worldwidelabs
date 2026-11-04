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
        version: '1.53', date: '2026-11-04',
        title: 'Script 1.56: a better Faction radar',
        everyone: [
            'The faction radar now counts people who have been idle for more than 30 minutes as offline, because Torn keeps people on Idle for hours. You can change the minutes in the Labs Assistant settings, and idle names show how long they have been idle.',
            'Members who are in hospital get a bed icon next to their name (hover it to see how long is left), and the title shows how many are in hospital.',
            'The Refresh button is clearer and really asks Torn again (at most once every 30 seconds for the whole faction). The radar says when it was last updated.',
            'You can choose where the radar shows: on every page, on faction pages only, or on pages you list yourself. Thank you for the ideas, shukolza and Solo050!',
        ],
        leaders: [],
    },
    {
        version: '1.52', date: '2026-11-03',
        title: 'Script 1.55: Lab Notes in groups',
        everyone: [
            'The Notes tab in the Labs Assistant now shows the Lab Notes in groups, like the site: Finances, Merits and Education, each one to open and close. Update the script to get it: the update banner shows when a new version is ready.',
            'The faction radar setting now says who made it: Solo050. Thank you!',
        ],
        leaders: [],
    },
    {
        version: '1.51', date: '2026-11-03',
        title: 'Lab Notes guides and the Growth simulator',
        everyone: [
            'Lab Notes now has three guide groups you can open and close: Finances (your first millions, making your money work, your first company job), Merits (where to spend them and how to get them fast) and Education (your first courses, picking a direction, the courses for directors). Tick the steps as you go and switch on the daily reminders.',
            'The Gym stats page has a new Growth simulator, built on the Compounding Gains Simulator by ArcaneReaper. It starts from your own stat and shows how many days a milestone takes when your gains compound, next to your real pace of the last 28 days.',
            'There is a new Growth planner page under Training. Pick an example (a standard new member to 100k total stats, or to 100k and then 250k) or fill in your own numbers, with phases like up to 100k, then up to 250k. It follows the real gyms, the monthly Steadfast perk and how you split your energy over the four stats, and shows how long each phase takes. You can save your own plan.',
            'The Tools and links page has a new Credits box: Solo050 made the faction radar and ArcaneReaper made the simulator. Thank you both!',
        ],
        leaders: [],
    },
    {
        version: '1.50', date: '2026-11-03',
        title: 'Overseas Stock: best trip for your own setup',
        everyone: [
            'The Overseas Stock page now has a My setup box. Tick what applies to you once: an airstrip, the WLT stock block, business class tickets, your suitcase, your company (Toy Shop, Flower Shop, Lingerie Store, Cruise Line) and the travel books. It is remembered on your device.',
            'Under it, Best trips for you right now shows, for every country, a full trip of the most profitable items in stock: how many items you can carry, the flight time, the profit per trip and the profit per hour. Our Excursion perk is already counted for everybody. The list of all items is still below.',
        ],
        leaders: [],
    },
    {
        version: '1.49', date: '2026-11-02',
        title: 'Crimes Guide: all 13 crimes',
        everyone: [
            'The Crimes Guide now has a guide for every one of the 13 Crimes 2.0 crimes: Search For Cash, Bootlegging, Graffiti, Shoplifting, Pickpocketing, Card Skimming, Burglary, Hustling, Disposal, Cracking, Forgery, Scamming and Arson. They are written up from the community in-depth guides on the Torn forum and the Torn wiki.',
            'Each crime has tabs for the locations or steps, the key items, the unique finds, how to level up fast, tips, and the honor bars with a tick for the ones you already have. Some crimes also have tabs for things like security, notoriety, the rig and heat, or the persuasion bar.',
        ],
        leaders: [],
    },
    {
        version: '1.48', date: '2026-11-02',
        title: 'Script 1.54: Labs Assistant, mentoring sign-up and more',
        everyone: [
            'Mentoring: you can now sign up yourself. On the Mentoring page choose I want a mentor, or I want to be a mentor (from Lab Rat up, and one full newsletter cycle in the faction). Tick the hours you are usually online, and you see who fits best, sorted by the hours you share. Press Ask: the other person gets your ask on the Mentoring page and in their To do, and has to accept before you are paired. A mentor can take up to 3 pupils.',
            'The WWL script has a new name: Labs Assistant. It is the same script, so nothing needs to be installed again and your settings and key stay as they are. After the update (1.54) the button and the window in Torn say Labs Assistant. In the Tampermonkey list it still shows under its old name, World Wide Labs.',
            'Everywhere on the site the script is now called Labs Assistant too: the install card on the dashboard, the Lab Notes steps, the trading page and the messages that remind you to install it.',
            'An open poll made on the site that you have not voted in yet now shows as a line in the To do of the Labs Assistant, with a button that opens the poll.',
        ],
        leaders: [
            'Mentoring admin has a new switch at the top: self sign-up for members is open by default, and you can close it when needed. Leaders can always use it, also when it is closed. You can still add mentors and pupils and pair them by hand.',
        ],
    },
    {
        version: '1.47', date: '2026-11-02',
        title: 'Script 1.53: Bidding War OC, perk roadmap and energy goal',
        everyone: [
            'Organized crimes: the Bidding War crime now only needs 50 percent success chance to join, while the rest of level 6 stays at 70 percent. The WWL script (update to 1.53) greys out the Join button of a Bidding War slot only below 50 percent. Leaders can add more crimes with their own range in Leader settings, OC join rules.',
            'The Perk roadmap page now shows everything the faction has unlocked, with the day it was unlocked, in a tab that is closed by default. Below it the new plan: Addiction XIV to XXV, Booster cooldown XVI to XXIV, the chain upgrade, Travel capacity V to VIII and Rehab cost I to III.',
            'Training goal of the period of 4 October: the Halloween week counts as a week without training, so the energy goal is one week lower. What you trained stays exactly as it was.',
        ],
        leaders: [
            'Member Overview has a new row under the period line: Weeks without training in this period. It lowers the energy goal on Member Overview and on the Evaluation page. Chain events now take their dates from the chains placed in them, and a chain event counts in the period it started in. A new button Re-read the chain numbers refreshes the stored chain numbers.',
            'Consumption Tracker: chain events are in the By war list, interrupted reads of the armory log keep the days that were complete and retry by themselves, and the nightly saving now keeps the finished days of the armory log, so the war pay calculator and the tracker agree.',
        ],
    },
    {
        version: '1.46', date: '2026-10-30',
        title: 'Script 1.52: chain watching limit, onboarding and OC overview',
        everyone: [
            'Chain watching: as Chain saver or War guard you can now take at most 4 hours in any 12 hours, because watching is tiring and the hours are shared. A block from 18 to 22 TCT and another one from 6 to 10 the next morning still works. This counts on the site and in the script.',
            'In the WWL script (update to 1.52) the Award tracker in the To do can be opened and closed by clicking its title. The choice is remembered.',
            'The faction radar in the script now refreshes every 5 minutes instead of every minute, which saves hosting time.',
            'The reminder messages no longer have a bracket, full stop or comma stuck to a link, because that made the link not work.',
        ],
        leaders: [
            'The first week of new members is split in two: 4 days to join WWL and install the script (that makes them Experiment B), and 3 more days, a week in all, for Discord, Intel and CAT (Guinea Pig or Lab Rat). The removal list follows these days.',
            'The leader To do has new sections with a toggle per line: Recruit to Experiment B (not on WWL, without the script), To Guinea Pig or Lab Rat (Discord, Intel, CAT) and Organized crimes (not in an OC now, no OC in the last 30 days, out for 7 days or more). Each member has a message to copy and a Notified button, which everybody with leader access sees. The sections show on the site and in the script.',
        ],
    },
    {
        version: '1.45', date: '2026-10-25',
        title: 'Script 1.51: OC join rules, availability click fixed',
        everyone: [
            'In the WWL script (update to 1.51) the availability calendar now shows your click at once, instead of only after a refresh.',
            'On the faction OC page the script greys out the Join button of a slot when your success chance is outside the range the leaders set for that OC level, so you do not join a crime that is not meant for you. Hover over the button to see why.',
            'When you open the OC page, the script also keeps your success chances up to date for the OC Fit Tracker and the OC team builder of the leaders.',
        ],
        leaders: [
            'New in Leader settings: OC join rules. For each OC level you set the lowest and highest success chance (both allowed), with a switch for members and a switch for leaders. The script reads them and keeps them for 10 minutes.',
            'The OC team builder now lists the members who have no numbers yet, so you know who the suggestions leave out.',
            'The payout calendar now uses the real TCT date (it was a day behind until 18:10 TCT) and shows a payout you marked in advance as paid.',
        ],
    },
    {
        version: '1.44', date: '2026-10-24',
        title: 'Awards tracker, script 1.50, stay logged in',
        everyone: [
            'New page Awards (under Player profile): every honor and medal of Torn with where you are, how far you are and how many days it takes, like YATA. Click a category card on top to filter, click a column title to sort, and press the pin to follow an award. Awards that give 2 or more merits are marked.',
            'In the WWL script (update to 1.50) the awards you pin show in the To do under your own reminders: an Award tracker with a bar for each one and how many days are left.',
            'On the WWL login page you can now tick Keep me logged in on this device (it is on by default), so you do not have to paste your key again each time.',
        ],
        leaders: [
            'The recruit timer now counts 3 days from the last time a member joined, so someone who left and came back is a recruit again, with the hours left shown in the role changes.',
            'The default reminder for members without the script now says that the script is not the website.',
        ],
    },
    {
        version: '1.43', date: '2026-10-24',
        title: 'Script 1.49: see if WWL accepts your key',
        everyone: [
            'In the WWL script (update to 1.49) the settings (the cog) now show whether WWL accepts your API key and when it last saw the script, with your device and version. If the key is not accepted it says why, so you can enter a working one. If WWL has never seen the script, it checks in right away.',
        ],
        leaders: [
            'A member who says they installed the script but is not in Who is on board can now open the cog in the script: it shows at once whether the key works.',
        ],
    },
    {
        version: '1.42', date: '2026-10-24',
        title: 'Script 1.48: recruits that can move up',
        everyone: [
            'Small update of the WWL script (1.48).',
        ],
        leaders: [
            'In the role changes drop-down of the script To do, recruits who already meet the requirements for Experiment B or Guinea Pig / Lab Rat show with a clock mark and how many days their recruit status has left. Members who can be promoted now are a line of their own again, the recruits who can move up later too, and the rest (roles held without the requirements, removals) together.',
        ],
    },
    {
        version: '1.41', date: '2026-10-24',
        title: 'Script 1.47: close requests in the script, no energy check while stacking',
        everyone: [
            'In the WWL script (update to 1.47) the Check your energy plan box in the To do is done by itself, with the reason, from 48 hours before a war until its plan ends and during a chain plan: nobody trains in those days, so there is nothing to check.',
        ],
        leaders: [
            'Recruits who already have what the next roles ask for are listed too: with the script installed they can go to Experiment B, with the script, Discord, Intel and CAT done to Guinea Pig or Lab Rat, shown as after the recruit status wears off with the days left, so you can allow Xanax until then. The same goes for Experiment A: with everything done they are listed for Guinea Pig or Lab Rat directly.',
            'A bank or OC request you claimed from the script stays in your To do (red, counted in the red number) with an Open link and a Paid or Spawned button. The button closes it on the site too: Discord changes to completed and it goes to the History.',
        ],
    },
    {
        version: '1.40', date: '2026-10-24',
        title: 'Script 1.46: a shorter To do for leaders, and a red number for urgent requests',
        everyone: [
            'Nothing changes for members in this update, apart from the small fixes.',
        ],
        leaders: [
            'The To do in the script is shorter: the members who have not logged into WWL, the members without the script, the war related role changes and the other role changes are each ONE line with the count, for example 5 members have not logged into WWL yet. Tap a line to drop it down: the message and a Send button per member, or the members with what changes for them.',
            'Next to the yellow To do count there is now a red number for the waiting OC and bank requests together, so you can see at a glance that something is urgent. The lines no longer have a red ball in front of them.',
        ],
    },
    {
        version: '1.39', date: '2026-10-24',
        title: 'Script 1.45: crimes and money first, claim and open, reminders with a Send button',
        everyone: [
            'The To do in the WWL script (update to 1.45) is kept fresher: the list is asked again sooner when something is waiting.',
        ],
        leaders: [
            'In the script To do the crimes and the money come first: OC and bank requests have a red mark and a Claim and open button. It claims the oldest open request for you (Discord shows Claimed by you) and opens the crimes page, or the vault with the member and amount filled in.',
            'The friendly reminders for members who are not on WWL or did not install the script now show unfolded in the script, with your message and a Send button per member: it opens Torn mail to that member with your message filled in and copied. You press Torn own Send. Save your message once, it is kept on that device.',
            'A leader with things waiting gets a fresh To do list every minute while the window is open on the To do tab.',
        ],
    },
    {
        version: '1.38', date: '2026-10-24',
        title: 'Script 1.44: radar names in the colour of your availability',
        everyone: [
            'In the Faction radar of the WWL script (update to 1.44) the names are now coloured by what each member put in the availability plan for the current hour: green available, orange maybe, blue watching (chain saver or war guard). Under the names a small legend shows it while a plan is running.',
        ],
        leaders: [
            'Bank requests: a request that was paid out now moves to the History at once and no longer sits in the open list (claimed ones stay for a day so two bankers do not both pay).',
            'Faster to dos: the leader to do list is kept 45 seconds (was 2 minutes) and the list of members ready for promotion 3 minutes (was 30), so a member who just installed the script shows up quickly. The script asks for a fresh list every minute while a leader has things waiting.',
            'Who is on board: the Userscript column now says which device (browser or TornPDA) and which version the script reports, and when it is behind the newest one, so update needed can be checked at a glance.',
            'In the script (next release): the crimes and the money (OC and bank requests) are at the top of the To do with a red mark and a Claim and open button that claims the oldest open request for you and opens the crimes page or the vault with the amount filled in. The friendly reminders for members without WWL or the script show unfolded, with a message and a Send button per member that opens Torn mail with the message filled in.',
        ],
    },
    {
        version: '1.37', date: '2026-10-24',
        title: 'Script 1.43: faction radar',
        everyone: [
            'The WWL script (update to 1.43) has a Faction radar at the top of every Torn page: how many members are online and idle, with their names (green dot online, orange dot idle). Tap a name for the profile and Refresh for the latest. You can turn it off in the script settings (the cog).',
        ],
        leaders: [],
    },
    {
        version: '1.36', date: '2026-10-22',
        title: 'Script 1.42: watch hours and your own timezone in the Avail tab',
        everyone: [
            'The Avail tab of the WWL script (update to 1.42) now lets you add yourself as Chain saver, or War guard when the plan is linked to a war: tap one of your hours in the new blue button. Each hour has room for one and a backup, like on the site.',
            'The grids have grid lines (a stronger line every 6 hours) and a switch to show the times in your own timezone, like the site. Everything is still saved in TCT.',
        ],
        leaders: [
            'Who\'s on board has a new Script exempt column: click it for a member who cannot install scripts (for example a locked-down phone or computer). They then count as having the script for the role path, the promotion list, the removal list and the welcome chapter, and they are no longer asked to install it. Intel and CAT stay as they are: tick CAT by hand for a member who does that in another way (for example the dibs system in Intel).',
            'Member Overview has a new Battle stats of the faction box: the average, median, highest and lowest total battle stats per member (from the members who have opened WWL), and a What if calculator: add or remove a number of people at a total each and see the new average. The Who\'s on board part also shows how many members are on WWL, Discord, the script, Intel and CAT, with a Copy for council button.',
        ],
    },
    {
        version: '1.35', date: '2026-10-22',
        title: 'Script 1.41: availability in Torn, a smarter energy plan',
        everyone: [
            'The WWL script (update to 1.41) has a new Avail tab: the faction overview of the war or chain plan, with the days as columns and the hours as rows like on the site. Tap an hour to see who is available, who is on maybe and who is watching, and switch to My hours to set your own with a tap (green, yellow, off).',
            'The Energy plan can count what you really trained: choose on the Energy planner (or in the script) what the progress bar counts, your ticks or the energy trained this week. The boxes can be ticked either way.',
            'Your training week starts the day the last war ended, or the day after if you pick that, or any day you choose yourself (My training week starts on). The ticks and the energy count follow it.',
            'The Energy tab now opens on the day you are working on, not always on day 1.',
            'The Mentoring tab is gone from the script: the Notes tab has the same chapters. Your mentor and the chat are still on the site, and the Notes tab links to them.',
        ],
        leaders: [],
    },
    {
        version: '1.34', date: '2026-10-21',
        title: 'All roles on Lab Notes, availability start hour, own timezone',
        everyone: [
            'Lab Notes has a new card: All roles and what they need. It lists the whole ladder from Recruit to Senior Researcher with what each role asks of you and what it gives.',
            'Every member can set the day their own training week starts on (Energy planner, My training week starts on), because it depends on the war and how it ended. The week, the ticks and the automatic energy count follow that day. Without a day of your own, your training week starts automatically the day the last ranked war ended, or the day after if you pick that (the plan then starts over, with fresh ticks, after every war); with no war known it is the calendar week.',
            'The Energy planner lets you choose what the progress bar counts: the boxes you tick (as before) or the energy you really trained this week, counted automatically by the energy tracker. You can tick the boxes either way. The script in Torn follows your choice.',
            'The availability page now has a Faction overview for every member: per hour how many members are available, maybe, or watching the chain or war, with the current hour framed. Click an hour to see who. Coming online, you can see at once if others are around or if somebody should keep an eye on things.',
            'Availability plans can start at an hour you choose (From, in TCT), next to the end date and hour. A chosen start hour also opens the hours before a linked war.',
            'The tables on Member overview and Who\'s on board can be made taller or shorter by dragging the corner at their bottom right.',
            'The own timezone of the availability tracker now shows the offset you are on today (UTC+2 in Belgium until 25 October).',
        ],
        leaders: [
            'Members get one week to get through Experiment A and B. The promotions list and a new dashboard to-do now show members who are still Experiment A or B after a week in the faction without the WWL script or Discord (door sign), so you can remove them from the faction in Torn. Nothing is removed automatically. Intel and CAT are not a reason on their own, since you verify those yourself. The Lab Notes roles card tells members about the week.',
            'Role check: the promotions list (dashboard card and Lab Notes editor) now also shows members who hold Experiment B or higher without meeting the earlier requirements (script not installed, not on Discord, Intel or CAT not verified), marked with a warning sign and the role they should be. Unknown Discord answers are not flagged. Click Check again now to refresh it.',
            'Recruiter script 24.7.0: a yellow F older than 30 days no longer fades to grey, it turns orange (the row gets an orange tint) so you can choose to look at that player again.',
        ],
    },
    {
        version: '1.33', date: '2026-10-20',
        title: 'Friendly reminders for members, leader to dos in the script, closing a feedback form',
        everyone: [
            'Labs services has a fourth program: Trading funding. You can send a request there with the amount you would like, what you would trade and who can vouch for you. A request does not mean you get a funding: the owner only grants it to people she trusts or who are vouched for.',
            'A feedback form can now be closed: it shows a short thank-you note and the results, and nobody can fill it in any more.',
        ],
        leaders: [
            'The leader to-do card on the dashboard has two new items: members who have not logged into WWL yet, and members who are on WWL but did not install the script. Each opens up to a list with a friendly message to copy for every member (edit the message once, it is kept in your browser) and shows when you reminded them.',
            'All the leader to dos now also show in the To do list of the script in Torn, the same ones as on the dashboard. You do not need to update the script for this.',
            'War related role changes (a move to Chemist, and a Chemist moving back down) now come up in the to dos only after the monthly newsletter with the check-in messages is marked as sent: there is a Sent this month button on the Newsletter page, and the mark resets on the first Sunday of the next month. The changes that depend on requirements (WWL, script, Discord, Intel, CAT) still come up straight away. Until it is marked, the to do list shows one line saying how many war related changes are waiting.',
            'Availability plans can now be edited after creating them: the new Edit this plan button changes the name, the start date and the number of days. Moving the start date keeps every tick at the same real hour (you are asked first if some ticks would fall outside the new dates). A plan can also get an optional end: pick an end date and an hour (TCT) when you create it or in Edit this plan, and the plan stops at that hour instead of at the end of the last day. It can also start at an hour (the From box next to the start date): the hours before it are closed.',
            'Feedback: in the form editor there is a Close the form button. The form and all answers stay, nobody can fill it in any more, and it stops asking people in the to do lists. You can reopen it at any time.',
        ],
    },
    {
        version: '1.32', date: '2026-10-19',
        title: 'Recruiter script: free for directors and faction leaders',
        everyone: [
            'The Recruiter script is now free for the directors of the companies registered on WWL and for the leaders and co-leaders of the factions on the WWL list. Install it from the Recruiting menu: it recognises you by your Torn API key, nothing to pay or check.',
            'New in the script: faction chips in the Advanced Search (faction respect and whether its leader has more battle stats than you, read from BSP), leaders hidden from the results, sorting by faction respect, and a mail button for players with chat off.',
        ],
        leaders: [],
    },
    {
        version: '1.31', date: '2026-10-18',
        title: 'Recruiting: the Recruiter script and its subscription on WWL',
        everyone: [
            'New Recruiting menu with the Recruiter script page. Install the CoreLabs Recruiter script for Torn from there (it updates by itself), and see and renew your subscription: 1 Xanax per 7 days, separate from the Ledger VIP. Press Check my payment after you sent the Xanax, it checks right away and never on a timer.',
            'The script is faster and lighter: it only loads the players you can see on the user list, saves your F / C / S / U clicks on your computer at once, and has a new minimum activity streak filter. A yellow F fades after a month, and rows with a red button or a yellow F get a faded colour.',
        ],
        leaders: [],
    },
    {
        version: '1.30', date: '2026-10-18',
        title: 'Userscript 1.40: a trade bar on the trade pages in Torn',
        everyone: [
            'The WWL script now adds a bar to the trade pages in Torn for anybody who made a pricelist on WWL (the Trading menu). Open a trade where somebody sells you items and it shows the total at your pricelist, with buttons to copy the total, to copy a link to the receipt (a page you can send to the seller), and to accept. The Accept button turns green when the money in the trade is the total, and shows Add Money, Too Low or Too High when it is not (Accept anyway is there if you want it).',
            'The money page is filled in for you, a full Plushie Set or Flower Set is priced as the set when the set is on your list, and a finished trade is saved to your ledger from its trade log page, with Undo. It only reads the trade page you have open, it does not use the Torn API, and it stays quiet when you have no pricelist.',
            'Install or update it from the dashboard card, or from the Pricelist and Receipts & ledger pages. Your script manager asks you to confirm the update.',
        ],
        leaders: [],
    },
    {
        version: '1.29', date: '2026-10-18',
        title: 'Trading: a pricelist and receipts for everybody',
        everyone: [
            'New Trading menu with two pages: Pricelist and Receipts & ledger. They are free for everybody who logs in to WWL, also for people outside the faction.',
            'Pricelist: every Torn item by category. Give an item a percentage of its market value and it is on your list, at the price you pay. Tick several items to set a percentage for all of them at once, round the prices, and share the list as a public page (worldwidelabs.vercel.app/?pricelist=your Torn ID) with your number of trades and a vote for the trader. The Plushie Set and Flower Set show what is in them.',
            'Receipts: make a receipt of a trade at your prices from a pasted trade log (Quick Receipt Generator), or with the WWL userscript while you trade. A receipt is a page anybody can open without logging in, and you can delete it whenever you want. Overview, Purchases and Partners show what you bought and how much you saved against the market.',
            'Ledger & profit (what you bought, sold and made, the stock, the profit per sale and per month, sets exchanged for points) is VIP: 1 Xanax per 7 days. Press Subscribe to get a message of your own, send the Xanax to CreaLotte with exactly that message and press the check button, then WWL switches VIP on by itself. Only a Xanax with your message counts. A trader with a Trading Funding has it for free, and your trades keep being saved while you have no VIP.',
        ],
        leaders: [],
    },
    {
        version: '1.28', date: '2026-10-17',
        title: 'New members are pointed to Lab Notes',
        everyone: [
            'New members (in the faction for 3 weeks or less) now see a card at the top of the dashboard, New here? Start with Lab Notes, and the very first time they log in they land on Lab Notes. Lab Notes guide you step by step through what we need from you. You can hide the card with I know my way around.',
        ],
        leaders: [
            'Tip for recruiting: send new people the link https://worldwidelabs.vercel.app/lab-notes. After they log in with their key, it opens straight on Lab Notes.',
        ],
    },
    {
        version: '1.27', date: '2026-10-17',
        title: 'Userscript 1.39.2: fewer calls to the server',
        everyone: [
            'Userscript 1.39.2 (update it when the banner shows, or with the button on your dashboard): it asks the server less often. With the window left open, a Torn page load now reuses what it fetched in the last few minutes instead of fetching your plan, mentoring status and To do again on every page. Opening the window yourself still shows fresh numbers. Nothing else changed.',
        ],
        leaders: [],
    },
    {
        version: '1.26', date: '2026-10-14',
        title: 'Labs services, and My buddy plan',
        everyone: [
            'New page Labs services in the menu: the three Labs programs (the investment fund, rent-to-own private islands and buddy banking), how each one works and its terms, with a form to ask the owner to join one. People who are not in the faction can log in with their Torn key and will only see this page.',
            'If you are a buddy in buddy banking there is a new page My buddy plan: your plan, what you keep and what you send back, and what Torn shows about your City Bank (read with your own key, your key is never stored).',
        ],
        leaders: [],
    },
    {
        version: '1.25', date: '2026-10-14',
        title: 'Availability: your usual week in one click',
        everyone: [
            'Availability tracker: tick the hours you are usually free, press Save my hours as my usual week, and on a new plan press Use my usual week to tick them all again in one go. Nothing is filled in by itself: you choose each week, and you can still change any hour that is different. Using it replaces what you have ticked in that plan.',
        ],
        leaders: [],
    },
    {
        version: '1.24', date: '2026-10-14',
        title: 'Bugs & suggestions show their date, one amount for CreaLotte',
        everyone: [
            'Every bug and every suggestion on the Bugs & suggestions page now shows the date it was added.',
        ],
        leaders: [
            'Bugs & suggestions: each item has a Copy button that copies everything about it (status, date, who reported it, who has it too, the full text) so it can be pasted in one go.',
            'War payout for a sub-faction: next to your 5%, the mutual fund 10% and their leadership 5% there is now one box, Send to CreaLotte (15%), with the amount to send and a button that copies it without commas.',
        ],
    },
    {
        version: '1.23', date: '2026-10-14',
        title: 'War hits: only successful attacks count',
        everyone: [
            'War hits now only count attacks you WON. Before, an attack that was lost, ended in a stalemate or was escaped from also counted as a war hit, which made some hit totals too high. Your war counts in Member Overview are counted again automatically with the fix, so you may see a lower number for wars you lost attacks in.',
            'Assists are counted apart from hits (and so are failed attacks), so they never inflate your hits.',
        ],
        leaders: [
            'The war payout calculator and the war rule in Member Overview now count only won attacks as war hits. In the payout results there are two new grey columns, Assists and Failed, per member. A tick box "Also count assists as hits" lets a faction that wants to pay for assists include them; it is off by default. The saved war counts of the last wars are recounted by the page itself the next time you open Member Overview or the Evaluation (it takes a moment per war); a recount that finds nothing never wipes the counts that were saved.',
            'Payouts that were already calculated and paid keep the numbers they were made with.',
        ],
    },
    {
        version: '1.22', date: '2026-10-10',
        title: 'Userscript 1.39.1: the To do button moved',
        everyone: [
            'Userscript 1.39.1 (update it when the banner shows, or with the button on your dashboard): the To do button moved out of the row of tabs to the top of the window, next to your energy and war numbers, because that row had become too crowded with the new Notes tab. Nothing else changed.',
        ],
        leaders: [],
    },
    {
        version: '1.21', date: '2026-10-10',
        title: 'Userscript 1.39: Lab Notes in the script, own reminders, mentoring',
        everyone: [
            'Userscript 1.39 (update it when the banner shows, or with the button on your dashboard): a new Notes tab (the beaker) with your Lab Notes right inside Torn: your role path, the welcome chapters (one chapter at a time, in order) and the extra notes cards. Tick the steps there; the ones that can check themselves tick themselves. When a note has daily steps you can put them on your own To do with one tick, and take them off again the same way.',
            'Userscript 1.39: your own reminders in the To do tab now have a checkbox each. A "once" reminder stays ticked, a "daily" one unticks itself every day, and ticked reminders no longer count in the To do number. The add box and the delete marks moved into the settings (the gear) to keep the To do tab short.',
            'Userscript 1.39: for members in the mentoring program the Mentoring tab shows the welcome chapters and your role path; a mentor sees how far each pupil is, can tick a step for them and sees their training per week and their energy plan, all closed until opened.',
        ],
        leaders: [
            'Userscript 1.39: the Mentoring tab also shows a mentor every chapter of their pupil with what is ticked, and the To do lines for a pupil open that tab.',
        ],
    },
    {
        version: '1.20', date: '2026-10-10',
        title: 'Monthly evaluation: who never replied',
        everyone: [],
        leaders: [
            'Monthly evaluation: a new Reply column. Tick "replied" when a member answers the evaluation message, and "stacking" when they tell you they are stacking. A row turns red when the message was sent and nobody has replied yet (with the number of days they have been waiting), and the summary now counts who never replied. Only members who are below requirement (the ones asked what they will do to improve) can turn red.',
            'Monthly evaluation: the new box "Only who never replied" shows just those members, and "Copy names: never replied" copies their names. If you sent the messages outside WWL, "Mark below requirement as sent..." marks everyone below requirement as sent some days ago, so the waiting time is right.',
        ],
    },
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
            'Energy tracker: now opens on the newsletter period that is still RUNNING (first Sunday up to today) instead of a rolling 30 days, with a "Last newsletter period" button next to it for the finished one - so opening the page doesn\'t need a re-pick (and a second fetch). Also fixed: "This newsletter month (so far)" used to start a whole cycle too early, and "Last newsletter period" was showing the cycle before the last finished one. Also added a "Tier" column showing each member\'s Energy tier (1.5m+ / under 1.5m total battle stats) - the exact same one Member Overview shows, for a quick check without switching pages. Every column in the table is now clickable to sort by (Member, Avg E/day, Weekly avg, Tier, each stat, Total).',
        ],
        leaders: [
            'Fixed: the respect tracker was missing a lot of the respect we LOSE when the enemy attacks us (so its total came out too high, e.g. 7,645 shown vs 6,878 actually gained). Torn only hands over about 100 news entries per request, which in a busy war is roughly one hour, so everything beyond that was silently dropped - the regular refresh only saw the latest hour, and "Dig deeper — Losses" kept just 100 entries out of each 6-hour block. Both now keep asking for the older part of the same window until the whole stretch is covered (nothing is counted twice), and the regular refresh remembers where it got to and carries on next click. "Dig deeper — Losses" restarts from now once to repair the days already walked - press it a few times after a war until it says it reached the edge of history.',
            'Respect tracker daily table: new "Losses" column (what hits against us took off, shown separately instead of hidden inside Hits), and Chains/Hits are now worked out from the actual hits - Chains is the part of that day\'s hit respect that came from hits inside a chain (Torn\'s own chain marker, or a hit whose time falls between a chain\'s start and end), so what a chain gained is easy to see apart from ordinary hits and losses. Before, Chains was each chain\'s total (milestone bonuses included, booked on the day the chain ended) capped by that day\'s net hits, which pushed Hits to 0 on a chain day. Total gain = OC + hits + losses + war. Because old hits and losses were stored mixed together they can\'t be pulled apart, so the first visit after this clears the stored Hits/Losses once and they rebuild from Torn - press "Refresh tracking now", then "Dig deeper — Hits" and "Dig deeper — Losses" a few times each (OC and war numbers are untouched). Mugs, hospitalizations and leaves against us were already counted whenever the news line has its number, e.g. "Someone mugged X (-0.61)".',
            'Every table on the site now keeps its column names in view when you scroll down, and its first column (the member / date it belongs to) in view when you scroll sideways - on tables that start with a small marker column, like Member Overview\'s status dot, the name column right after it is pinned too. Tables inside a scrolling box got a height limit (75% of the screen, so long ones scroll inside their box) - that is what lets the header stay put. The availability grid keeps its own version of this.',
            'New on Monthly evaluation (leaders): a Xanax check, as a test before it goes into the evaluations. Pick a war and it counts the Xanax each member used straight from the faction armory during that war (from 48 hours before the start, which is the stacking window - changeable - until 24 hours after it ended; Xanax given out as prizes is not counted) against the hits they made in that war (war hits plus chain hits). Every Xanax covers 10 hits, rounded up: 4 taken and 25 hits = 3 covered, so 1 to put back. It lists everyone who took Xanax with how many to put back (and a Copy button for the people who should), and the answer for a finished war is saved so it can be used per war in the evaluation later.',
            'Monthly evaluation now includes the Xanax, per member: a new Xanax column (how many Xanax someone still has to put back, or a tick), a per-war breakdown when you click a member (took N, made H hits, covers C, N-C to put back, how many already returned), and a paragraph in the message listing the wars and how many to put back. Only the wars that ended inside the picked newsletter period are judged for Xanax, from 48 hours before each war until 24 hours after; every Xanax covers 10 hits, rounded up. Press "Load Xanax data" above the table once per period (it reads the armory log war by war and saves the answer). What has been put back is read from the deposit lines in the armory log ("Name deposited 1x Xanax") and counted against the oldest war first. Taking more Xanax than the hits cover now counts as a third thing below requirement in the suggested status.',
            'Xanax check: hits above what the Xanax taken needed in one war now balance out a shortfall in another war of the same period. Example: took 4 and made 23 hits in the first war (1 too many), then took 4 and made 48 hits in the next (covers 5, so 1 spare) - the spare one balances out the first, nothing to put back. Surplus is used against the oldest shortfall first, in the evaluation, in the message ("you already balanced out 1 Xanax") and on the member own card.',
            'If you still have Xanax to put back, the script To do list now shows it too ("You still have N Xanax to put back in the faction armory", with a button to the armory), next to what your dashboard card already shows. It is kept up to date by itself: every night WWL reads the new deposits in the armory log and refreshes everyone, so once you have put Xanax back it disappears without a leader doing anything (and straight away when a leader presses Re-check deposits). Nothing to update: it is worked out on the server.',
            'Your standing card on the dashboard now has a Xanax section with your own numbers: per war of the current period how many Xanax you took from the armory, the hits you made (war + chain), how many that covers (10 hits each) and how many you still have to put back - or a tick when there is nothing to put back. It shows once a leader has checked the Xanax for the period (until then it says it has not been checked yet), and only you see your own line.',
            'The script To do list now starts with a very clear warning whenever a war is coming up: "WAR COMING: it starts ... Start STACKING XANAX 48 HOURS BEFORE the start, from ...", which turns into "STACK XANAX NOW!" once those 48 hours have begun. It appears for everyone as soon as an availability plan is linked to a war that has not started yet, and goes away when the war starts. Nothing to update: it is worked out on the server.',
            'Userscript 1.38 (update it when the banner shows, or with the button on your dashboard): (1) the small WWL button can be dragged anywhere - on a computer and on TornPDA - and remembers its spot; (2) under the "You are not in an Organized Crime" reminder in the To do tab there is now a level picker to request an OC straight from Torn; (3) a new Bank tab shows your live faction balance and lets you request money out of it (never more than your balance). Leaders and council also see open OC and bank requests in their To do.',
            'New page Faction, Bank request: ask for money out of your own faction balance. WWL reads your balance and will not let you ask for more than it, so a request is always something you actually have. Bankers see the open requests there; if a Discord channel is set for it (Availability overview, Discord settings, "Bank requests") the request is posted with Claim and Cancel buttons. Claim is exclusive - the first banker to press it gets it - and opens Torn vault screen with the member and the amount already filled in, so you only confirm the payout in Torn (WWL never pays anything itself). Cancel can be pressed by the person who asked or by a banker. It needs "nightly saving" switched on in Leader settings, because only a leader key can read members balances.',
            'Bank request: the balance is now read live from Torn - with your own key first (no leader needed), and never from the 10-minute saved answer that made it look wrong - and there is a Refresh balance button (it also refreshes when you come back to the tab). When a banker claims a request the balance is checked once more: if it dropped below the requested amount, the Torn vault link uses the lower amount and the banker is told. If your key cannot show a faction balance, it falls back to a leader key (nightly saving).',
            'Bank request on Discord: when a banker presses Claim, the Discord message is updated straight away - the button becomes a greyed-out "Claimed by Name" and the text says who claimed it - so nobody else can press it and pay the same request twice (a second banker who still gets to the link is told it is already claimed by Name). Cancelling also updates the message ("Cancelled"). The Claim page now sends the banker straight on to the Torn vault screen without waiting.',
            'Bank request, the Claim button now goes straight to Torn: for a banker who has opened WWL at least once in the last 30 days (the dashboard does it by itself), Claim claims the request, updates the Discord message to "Claimed by Name" with the button greyed out, and sends you directly to the Torn vault screen with the member and amount filled in - no WWL page in between. The very first time (or if the cookie is gone) it goes through the WWL page once, which sets it up for next time. Cancel still goes through WWL.',
            'Bank request message in Discord is now a neat card like other banking bots: the member (linked to their Torn profile), the requested amount and when it was requested - and it no longer shows the member balance, only what was asked for. Claim greys the button out ("Claimed") and adds "Name is on it"; Cancel changes the message to "This request has been cancelled by Name" and removes the buttons.',
            'Bank request, from "is on it" to "Completed": once a banker has claimed a request, the Discord message gets a "Mark paid" button - press it after paying and the message turns into "Completed - paid out by Name" (green, buttons gone). It also completes by itself: when a leader opens the Bank request page, any claimed request whose member balance has dropped by the paid amount is marked completed. The page shows each request as open, claimed by Name, or paid out by Name, with a Mark paid button for claimed ones.',
            'OC requests in Discord now work like the bank requests: the message is a card with a Claim button that sends a leader straight to Torn crimes page (Torn has no link for the three sub tabs there, so it opens the main one) and turns the message into "Name is on it..." with a greyed-out button; a "Mark spawned" button then turns it into "Spawned by Name". The member cancelling changes it to "cancelled by Name". The OC requests page shows who has claimed each request, and the To do counts only requests nobody has claimed yet. Needs the same banker cookie (the dashboard sets it up for leaders).',
            'For leaders and council, the script To do list now also shows the open OC requests and bank requests, each with a button to the page. Nothing to update: the list is worked out on the server.',
            'New page Crimes, OC requests: if you cannot find an Organized Crime that suits you, ask for one at the level you want (1 to 10, with an optional note) instead of anyone spawning crimes. Leadership and council see the open requests on the same page (with a Done button once it is spawned) and as a To do on their dashboard, and a Discord channel can be pointed at it too (Availability overview, Discord settings, "OC requests" - it posts once per member per level every 6 hours, with no @mentions). You have at most one open request; a new one replaces the old. The script To do "You are not in an Organized Crime" now also points to it.',
            'Fixed: the "You are not in an Organized Crime right now" reminder in the script To do list never showed. It was reading the wrong Torn answer (the open slots of crimes that are still recruiting, not whether you are in one yourself). It now reads your own current organized crime, so it shows when you are not in one. This is a server-side fix: nobody needs to update the script for it.',
            'Feedback form results (leaders): the responses now open "By question" - under each question you see which members chose which option (with the Other answers listed by member), and for the open questions a plain list "member: answer". A By member button switches to the earlier view with each member whole form together. Copy all responses is unchanged.',
            'Monthly evaluation: Copy message now copies in the same look as the newsletter - a dark card with a green accent and a panel per topic (War participation, Training, Xanax, Earlier) - so it keeps its line breaks and looks good when pasted into Torn. A new Copy plain text button next to it gives just the text.',
            'Monthly evaluation now shows who you have already sent the message to: a Sent column (a tick with the date, hover to see who sent it), a "Mark as sent" button in each member panel (press again to undo), a "Message sent: X of Y" count, and an "Only not sent yet" filter so you can work through the rest. It is saved per newsletter period and shared by every leader, so two people do not message the same member. Marking a member as sent also adds a "Told" line to their history, so it shows under Earlier next time.',
            'New on your dashboard: "My own reminders". Add anything you want to be reminded of (up to 15, 100 characters each) and it shows in your script To do list too. Leaders can see what people add (the dashboard says so), grouped on a new Leadership page, Member to-do, so reminders that several members want can be built for everyone later.',
            'My own reminders now have a checkbox and you choose how often: "One time" (stays ticked once you tick it) or "Every day" (unticks itself every new day, TCT). A ticked reminder is shown struck through. This works on the dashboard now; in the script, ticking happens in the To do tab and adding or deleting your reminders is in the script Settings (the gear), which keeps the To do list short - that comes with the next script update.',
            'Leadership page renamed to Member to-do (was Member reminders): each line now says whether people added it as a one-time or a recurring (daily) reminder - or a mix - and has a Delete button to clear it from the overview once you have dealt with it. Deleting only clears the overview; members keep it on their own lists.',
            'Owner: in Discord settings (Leader settings) the owner now gets a picker to set up the Discord destinations of ANY faction (the shared server factions, every faction with nightly saving on, or any faction ID you add): channel IDs for the bot or a webhook, for availability pings, feedback, What is new, OC requests and bank requests, with a test message. Everyone else still only sees their own faction.',
            'Member Overview: the list of members who need a push above the table is gone. The numbers (members, on track, needs a push, wars judged) stay, and the red lights in the table still show who it is.',
            'New: Lab Notes, in the menu for everyone. Short guides in steps (the welcome chapters, and more to come like money making): open one, tick the steps as you go, some tick themselves. Your role path and the welcome chapters moved here from the Mentoring page. After finishing a Lab Note you can switch on its daily habits and they land on your own daily to-do. Mentors still see their pupil on the Mentoring page. Leaders write everything in the Lab Notes editor (was Welcome steps).',
            'Mentoring: in the card of each pupil a mentor now has a closed section Their training and energy plan: the energy the pupil trained per week over the last six weeks (amber under their weekly minimum) and the energy plan they picked, or a note that they have none yet so you can help them choose. Only the mentor and the leaders see it, for their own pupil.',
            'Energy plan: you no longer have to pick your plan again every week. A plan you picked once carries on into each new week by itself (same method, ticks cleared), so the script stops asking you to open the planner. You only open the planner when you want to change method.',
            'Roles: Junior Researcher and Senior Researcher are now at the end of the role path as council roles. They are chosen by the leaders, so there is nothing to tick for them, and they never show up in the promotion or move-down lists. A Chemist sees them as the next step, marked as chosen by the leaders.',
            'Roles: a Chemist who no longer meets the war rule (3 of the last 5 wars, counting only wars they could take part in) now shows up for leaders as a move back down to Guinea Pig or Lab Rat, next to the promotions, with a line in the leader To do. A Chemist also sees on their role path what they need to keep the role.',
            'Welcome chapters: every chapter is now its own window that you can open and close, and they are all closed to begin with (for pupils, for mentors looking at their pupil, in the leaders editor, and in the script). A locked chapter just shows a lock.',
            'Periods: the new period now shows up from 00:00 on the first Sunday itself (as Running now, just started), so the hits and respect of that day already count for it. On that first day the newsletter, evaluation and Member Overview still open on the finished period by default, since the new one has nothing to show yet; pick it from the dropdown to see it.',
            'Gym Planner: every jump method now shows what one jump costs and how many jumps a week it assumes (for example Big Choco with 1 Xanax is 4 jumps a week, with 4 Xanax it is 1, because stacking takes days of cooldowns), so the weekly costs can be compared properly.',
            'Bank request and OC requests (leaders): a History panel under each now keeps every request ever made, with who claimed, paid or spawned, cancelled or replaced it and when. You can filter it (including requests that were claimed but never finished) and search a member or leader, so mistakes can be traced.',
            'Roles: a role path for pupils on the Mentoring page (Recruit, Experiment A after 3 days, Experiment B with the script installed, Guinea Pig or Lab Rat with Discord, Intel and CAT, Chemist after the war rule in 3 of the last 5 wars) showing where you are and what the next role still needs. The chapters follow the new order: settling in, roles, Organized Crimes, Intel Discord and CAT, wars and chains. Leaders get a Ready for promotion list on the Welcome chapters page and a line in their To do.',
            'Mentoring: a mentor now sees all chapters of their pupil with every step and what is ticked (tap a chapter to open it), on the site and in the script. The To do list has a line for each: Check your welcome chapters for a pupil, and Help NAME for a mentor, which opens the Mentoring tab.',
            'Mentoring: the old shared checklist per mentor and pupil is replaced by the welcome chapters (on the Mentoring page, and in the Mentoring admin page the checklist editor is gone: chapters are written on Welcome chapters).',
            'Welcome missions: the five welcome mails are now chapters with a checklist each, at the top of the Mentoring page for pupils. A pupil only sees the chapter they are on (the others show a lock), and ticking every step opens the next one, so you can go at your own pace or do it all in one go. Steps that WWL can check tick themselves (script installed, online hours set, revives off, in an Organized Crime). The mentor sees how far their pupil is, can tick manual steps for them, and gets a To do line per pupil. Leaders write the chapters on the Welcome chapters page (Leaders menu).',
            'Dashboard: My own reminders moved to the bottom, below the energy and war panels, and can now be closed (it remembers how you left it).',
            'New: When are you usually online? at the top of the Mentoring page. Tick the hours of a normal day you are usually around (saved as TCT, with a switch to show and tick them in your own time zone). Leaders see everyone\'s hours on the Mentoring admin page, next to each mentor and pupil, and when assigning a mentor the mentors online at the same hours as the pupil come first with how many hours they share.',
            'Consumption Tracker and Xanax check: finished days of the armory log are now kept after they were read once, so running the same period again (By war, war payout costs, the deposit check) no longer uses up Torn\x27s daily read limit. Only today and anything not read yet comes from Torn. If the limit is reached you now get a clear message instead of a vague error.',
            'Energy programs now count Xanax at its market value: the Weekly Energy Goals plan shows how many Xanax the week uses and what that costs (and what you have taken so far), the happy jump guide shows the Xanax cost of each jump, and the Gym Planner natural energy methods now include their daily Xanax in the weekly item cost.',
            'Bugs and suggestions (leaders): each bug now shows who reported it and the names of everyone who pressed I have this too; each suggestion shows who suggested it and who gave a thumbs up or down. The names are in the copied export as well.',
            'Consumption Tracker shopping list: a new "Pull costs from war payouts" button. It lists your saved war reports; tick the ones you want and their cost lines (and total) are added to the shopping list, the grand total and the copied text, so the list matches what the war payout deducted. New payouts also save which items were bought, so the list shows the exact meds and drugs; older reports only kept the totals. Leaders only.',
            'Consumption Tracker: a new "By war" box at the top. Tick the wars you want to restock for and press Use these wars: the period starts the day after the war before the first ticked one (so the restocking in between is counted), runs to the end date of the last ticked war (the same range the war payout page uses), fills in the dates, and runs the consumption report and the restock shopping list for you.',
            'Userscript 1.38.1 (update it when the banner shows, or with the button on your dashboard): in the To do tab you can now add reminders of your own right there (an add box at the end of the list, and a small red cross to delete one), and reminders that are only a notice, like the Xanax stacking one, show as a full-width amber box and are no longer counted in the To do number.',
            'Xanax deposits are read more carefully: besides the armory use/loan log, WWL now also looks in the armory deposit log (where a line like "Name deposited 1x Xanax" may live), the Load/Re-check button always reads fresh instead of a saved answer up to 15 minutes old, and a new "Check deposit log" button on the evaluation page shows the deposit lines Torn sends for the last 3 days and which log each one came from, so if a deposit still does not show up we can see exactly where it is.',
            'Fixed: Xanax that members had put back was not changing their row. The deposits are in their own armory log (a separate one from item uses), but WWL was reading the big uses log first, which ran out of pages before it finished. It now reads only the small deposit log, so Re-check deposits is quick and complete, and deposits made today or tomorrow count against what a member owes.',
            'Xanax deposits now count from the START of the war: a deposit made before the war starts (stocking up) does not count, one made from the war start on does. Each deposit is kept with the time it was made and matched against the oldest war that had started when it was made, and is used once. So a deposit made during or after a war, or on the first Sunday of the month, reduces what someone owes for the wars before it. Press Re-check deposits once so the deposits are read with their times.',
            'Xanax reminders no longer disappear when a new newsletter period starts: your dashboard card and the script To do keep showing what you still have to put back for the wars of the period that just finished (plus the new one) until you have put it back, and the nightly refresh keeps reading new deposits, so Xanax put back today or tomorrow is counted. A war a leader has not checked yet is simply left out instead of blocking the list.',
            'War availability: clicking a box cycles it (off, green, yellow, off), so clearing a green box takes two more clicks - the first few clicks of a visit now say what the box just became and what the next click does. And the blue-ring switch ("Mark the hours I can watch the chain / be a War guard") now shows a clear blue warning while it is on, because with it on a click only adds or removes the ring and leaves green/yellow alone, which looked like boxes that could not be undone.',
            'Fixed: War availability could get stuck on an old plan with no plan picker. If the plan you last had open was archived afterwards, the page kept showing it (picker hidden, no way back) for anyone whose key also sees leader pages. The page now only shows an archived plan when a leader picks it on purpose in that visit; otherwise it goes straight to the current plan and the picker is back.',
            'Consumption Tracker: drugs and medical items you GIVE to a member out of the armory (the "gave 3x Xanax to ... from the faction armory" line) now count in the costs as a faction expense (for example competition prizes), with a "given out" line under the item showing who received how many - before, only an item used straight from the armory counted, so a Xanax handed to a player never showed. Given items are not counted as the member own use, so they do not affect the 10-hits-per-Xanax check. Only drugs and medical items count this way; candy, boosters and the rest do not. A loaned single-use item (grenade, pepper spray, needles) is now also credited to the member it was loaned to instead of the leader who handed it out.',
            'New card on your dashboard, "WWL script for Torn": if the script has never been seen for you (or not for a while) it has an Install the script button, and if you have an old version it has an Update the script button - one press, your script manager (Tampermonkey, or TornPDA) asks you to confirm, and your key and settings stay. Once you are on the newest version it turns into a calm "installed and up to date" line with a small Reinstall button, so there is always a button to find. It looks at when your script last checked in, so it can take up to an hour to notice a fresh install.',
            'WWL script card: if the install button only opens a page for you (for example inside the WWL app or an in-app browser), the card now has a "copy the script link" line - paste that link into your script manager (Tampermonkey: Utilities, Install from URL; TornPDA: add a script from a link) or open it in your normal browser.',
            'Who is on board, Userscript column: hover a member to see when the script last checked in and which version it is (and whether it is on TornPDA or a computer); a script that is too old to report its version, or older than the newest, shows as "installed, update needed" instead of looking the same as an up-to-date one. Also fixed members of older script versions showing "not seen" even though the script was running: every version fetches the energy plan, and that now counts as a sign of life too. Script is now 1.35 - update it so your version shows up. A member only shows up once the script has a key saved in its Settings and a Torn page has been opened.',
            'Userscript 1.36: it now notices a new version much sooner - the check no longer needs your key and costs the database nothing, so besides the usual check every few hours it also runs whenever you open the script Settings (at most every 5 minutes). Opening Settings after a push shows the "update available" banner straight away.',
            'Userscript 1.37: the "update available" banner now shows right under the header of the script window on every tab, and the window checks for a new version every time it is opened (not only in Settings, which nobody visits). While an update is waiting, the closed WWL button also gets a small amber dot, so you notice it without opening anything.',
            'New page Faction, Competition, open to everyone: the full standings of every competition (war hits, chain hits, candy, alcohol, blood bags, energy trained) for the running newsletter period and the last finished one, top 10 with "show the rest". The newsletter now points members there for the runners-up instead of at Member Overview, which only leaders and council can open. It is built from what WWL has already stored, so it can lag a little behind until a leader has opened Member Overview.',
            'Newsletter: the draft now starts with a greeting and "Here is our monthly wrap up of everything we have accomplished together, and all the things to look forward to this coming month.", has "A huge congrats to our winners!" above the winners, and ends with "Lots of Love, Crea <3" (the closing lines are fixed). The plain-text copy no longer starts with the "Newsletter - dates" heading, so it pastes straight into Torn.',
            'Newsletter: the separate plain-text boxes per section are gone (they did not serve a purpose); the preview card is what you copy, either with formatting or as plain text. Instead there is one Announcements box after the last section and before the closing lines - whatever you type there appears in the preview straight away and in both copies, and it is remembered in your browser.',
            'Fixed: while a newsletter period is still running, a war that ended TODAY (and today respect) was left out of the war and chain hit competition, the respect gained and the Your standing places, because the running period stopped at the start of today. A running period now includes a war that ended today.',
            'Respect tracker: new "Check war bonuses" button compares the war bonus of each of the last 8 wars with Torn own news line ("ranked up ... received N bonus respect") and shows what the tracker has next to what Torn shows, plus any war Torn has no end time for yet; "Check and fill in missing" also fills in a bonus Torn shows that the tracker is missing.',
            'Member Overview: the War hits and Chain hits columns are now labelled "last 5 wars" (what the war rule is judged on, whatever period is picked), and two new columns show War hits and Chain hits "this period" - only wars and chain events that ended inside the picked period, which are exactly the numbers the newsletter competition uses. Before, the newsletter could show a different hit count than the table, because the table only had the last-5-wars totals.',
            'Fixed in the userscript (now 1.34, update it when the banner shows): the Attack button on your saved targets opened a Torn page that only said "This endpoint is no longer available". It was using an old Torn attack address; it now uses the current one, the same as the target links on the site.',
            'New page Leadership, Leaders, Monthly evaluation: every member against the two requirements (the war rule from Member Overview, and training - energy trained against each member own tier over the picked newsletter period), next to what they were told before, with a suggested status (on track / needs improvement / at risk, and a "repeat" flag when someone below requirement was already warned). Click a member for a ready-to-send message asking their plans and whether it will improve (editable, with Copy and an Open Torn mail button), plus their history and a log to note their reply or a warning. "Copy all messages" gives everyone below requirement in one go. An earlier report (like the one from 6 September, with a Verdict line per member) can be pasted into "Import an earlier evaluation report" so the warnings already given show up - matched by name, and members who left keep their history. Online time and respect lost to enemy hits are not recorded per member, so they are not part of it.',
            'Monthly evaluation: members who have only been around for a few wars (up to the number the war rule asks for, 3 by default) get a softer message when they are below requirement - it says they are new and have some more time to adjust, repeats what we ask without calling it below what we ask, and invites them to ask for help. They show as "New - settling in" instead of Needs improvement / At risk, and are counted separately in the summary.',
            'Monthly evaluation: a member who joined during the period being looked at is treated as new too (softer message, "New - settling in"), and their training target only counts the time they have been in the faction that period instead of the whole period, so joining halfway no longer makes someone look far behind. Torn only gives whole days in the faction, so the join moment is approximate.',
            'War rule: a war a member marked "I can not make this war" in the war availability tracker BEFORE it started is no longer held against them - if they did not meet the war rule in it, that war is left out of their count (like a war from before they joined), so one excused war cannot turn them red. A war they did meet still counts normally. It shows as a 🚫 on that war in Member Overview, on the Monthly evaluation page and on the member own War participation card (hover for their note); a flag set after the war started still shows the icon but does not excuse. It is matched through the availability plan that is linked to the war, so link the plan to its war for it to apply.',
            'Respect tracker: new "Load 3 months of history" button (what the goal planner\'s longest pace window needs). One click walks Hits, Losses and OC back until they cover 3 months, the edge of what Torn still keeps, or Torn rate-limits (it then waits 30 seconds and carries on) - keep the page open while it runs, it shows how far back it has got. It is just "Dig deeper" repeated for you, and each step now works for up to ~45 seconds instead of 15 pages.',
            'Respect tracker now keeps itself up to date: the nightly saving (the one switched on from the dashboard) also catches up OC, chains, hits, losses and war bonus every night at 00:05 UTC, so a day nobody pressed Refresh is no longer lost. Hits got the same "catch up from where you left off" treatment as losses (a single refresh used to only reach back a few hours in a war). It is deliberately once a night, not every few minutes: each run costs database commands, and the free database allowance has already run out once.',
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
            'Newsletter page, Member Overview and the Energy tracker now all open on the newsletter period that is still running (the finished ones are one pick away), so every page starts on the same period and opening one doesn\'t need a re-pick. If no period is running yet (the first day of a cycle) they fall back to the last finished one.',
            'Member Overview and Who\'s on board now sort on EVERY column (click a header, click again to flip direction): Member Overview\'s per-war columns, Wars OK and Energy tier were the ones missing before, and Who\'s on board had no sorting at all. The War & chain register, other factions\' shared tables and each War report\'s pay details sort too.',
            'Added clickable column sorting to more tables that didn\'t have it yet: Labs Funds, War Payout Calculator and its shareable receipts, Respect tracker\'s daily breakdown, Mentoring\'s mentor/pupil lists, the Crimes guide\'s uniques list, and Availability\'s "compare hours vs hits" and overdose-list tools - click a header to sort by it, click again to flip direction.',
            'Respect tracker Goals: "Pace calculated from" now also offers "Past 3 months" alongside 14/21/28 days. Fixed: it used to be ONE setting shared by every goal, so making a 28-day estimate and then a 3-month one for a second goal silently switched the first goal\'s pace too - each goal now keeps its own, saved when you add it. Each goal also shows every other window\'s pace/ETA for comparison, and new: the actual respect/week needed from now to hit your deadline (worked out from the target and date directly, not from recent pace) - so you can see at a glance whether the faction needs to speed up or is coasting.',
            'New page: Effort Calculator (Leadership -> Leaders). Built for a termed loss - the point of taking one on purpose is usually to free members up to train more, but that can\'t come out of the respect the faction still needs. Enter a weekly respect goal and whether it\'s a term loss/win/no war; OC, war bonus (tracked separately for wins vs losses), a real chain respect curve calibrated from your own chains, energy-bar hits (from your real donator mix) and roster size all start filled in from your own history. Uses Torn\'s actual chain-bonus formula (respect climbs the longer a chain runs, not a flat rate) and accounts for war hits being worth double, so it correctly tells a 1000-hit chain from a 1500-hit one apart. Also flags when rounding up to the next real chain milestone (10/25/50/.../100000) only costs a little more effort for a much bigger bonus, shows what a round number of Xanax per person would actually reach, and lists your recent real war scores for reference (Torn doesn\'t publish the target-score formula, so this shows real examples instead of a guess). Works out the minimum chain length, hits per active member, and Xanax needed - the floor to hit the goal, not a "push as hard as possible" target.',
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
