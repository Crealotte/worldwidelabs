# Userscript workflow: work file, test, then one release

Members get `energy-plan.user.js` (the **release** file). Every change from now on goes into
`energy-plan.dev.user.js` (the **work** file) first. Pushing the work file never changes anything for members.

## Testing your own copy
1. Install the DEV script once from `https://worldwidelabs.vercel.app/worldwidelabs-dev.user.js` (Tampermonkey shows
   it as "World Wide Labs (DEV)"; the button and window say DEV).
2. **Turn the normal "World Wide Labs" script off** in Tampermonkey while you test (only one of the two can run at a
   time, whichever starts first wins). The saved key and window position are shared, so no setup again.
3. After a push, open the DEV window: it checks its own channel and shows the update banner / amber dot when the work
   file's `@version` is higher than what is installed. Each dev change bumps the work file's version (1.37.1, 1.37.2, ...).

## Collecting changes (the list)
Queue changes below instead of releasing each one. Nothing here is live for members until a release.

### Queued for the next release
- Script 1.51.6 (dev): chain watching: a message in the script for the new limit of 4 watch hours per person in any 12 hours (the server enforces it already, also for older scripts, which show the error). Together with 1.51.5: the onboarding overview got a toggle per line (see 1.51.3). Together with 1.51.4: the faction radar asks WWL at most every 5 minutes instead of every minute (saves free hosting time; the server side is live already). Together with 1.51.3: the leader To do shows the onboarding overview as two sections with ONE toggle per line (Recruit to Experiment B: not on WWL, without the script, past their 4 days; to Guinea Pig / Lab Rat: Discord, Intel, CAT), so only the group you open expands with a message to copy and a Notified button per member (kept on the server, shared with the site; server side and site are live already). Together with 1.51.2: in the reminder messages to send, no ")" "." or "," stays next to a link (new default texts, and a cleaner when sending that also fixes a message saved earlier); the same on the site (leader-todos.js) and for the trade receipt message (lib/ledger.js, live already). Together with 1.51.1: the Award tracker block in the To do can be opened and closed by clicking its title; it stays in the same place, the choice is remembered, and the closed title shows the number of awards.
- (Last release: script 1.51 (2026-10-25): the OC join rules (a slot outside the range from Leader settings gets a greyed-out Join button, reason as tooltip; the level is only read from a small "Level N" element outside the slots), the OC numbers refresh when the OC page is opened, and the availability calendar redraws at once. Before that, script 1.50 (2026-10-24): the Award tracker in the To do.

## Releasing (when the list is done and tested)
1. Copy the work file over the release file: `cp userscripts/energy-plan.dev.user.js userscripts/energy-plan.user.js`.
2. Set the next normal version in both `@version` and the `SCRIPT_VERSION` fallback (e.g. 1.38), in both files.
3. Add ONE What's new entry for everything in the list, push once. Members get one update banner.
4. Clear the list above.

## Which changes go live at once, and which wait
- **Server-side changes go live immediately.** The To do list, banners, plan and standing numbers are worked out on the
  server and only DISPLAYED by the script (for example the "not in an OC" reminder, which lives in `member-todo` in
  `api/war-payout.js`). Fix or add those straight away; no script update is needed.
- **Changes to the script file itself wait for a batch.** Anything in `userscripts/energy-plan.dev.user.js` (new tabs,
  buttons, layout, how it fetches or shows things) is queued in the list above and released together.
- When a request is a mix, split it: the server part goes live now, the script part is queued.
