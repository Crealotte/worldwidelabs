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
- DEV 1.54.1 (2026-11-03): the Notes tab shows the Lab Notes under their main titles (Finances, Merits), collapsible, like the site.
- Last release: script 1.54 (2026-11-02): Labs Assistant name inside Torn (the Tampermonkey name stays World Wide Labs, a new name would reinstall), released together with the mentoring sign-up (live on the site, open by default, switch on the Mentoring admin page). Before that, script 1.53 (2026-11-02): OC join rules with exceptions per crime (Bidding War 50 percent). Before that, script 1.52 (2026-10-30): the Award tracker can be opened and closed, clean links in the reminder messages, the leader To do sections (Recruit to Experiment B, to Guinea Pig / Lab Rat, Organized crimes) with a toggle per line, a message to copy and Notified, the faction radar every 5 minutes, and the chain watching limit message (4 hours in any 12 hours). Before that, script 1.51 (2026-10-25): the OC join rules, the OC numbers refresh and the availability calendar redraw.

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
