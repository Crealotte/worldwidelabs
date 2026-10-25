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
- Script 1.50.3 (dev): on the OC page the script also asks WWL to refresh the member's own OC success chances (api/oc-fit action refresh, at most once per 30 minutes), so the OC Fit Tracker and the team builder stay current. Together with: OC join rules - on the faction OC page the Join button of a slot is greyed out (no text, the reason only as a hover tooltip) when its success chance is outside the range set in Leader settings for that OC level (rules from the site, kept 10 min). Test mode in the script cog ("Show what the OC check reads"). Reads the page only, never joins. Still to check on the real page: how the level of an OC is shown.
- (Last release: script 1.50 (2026-10-24): the Award tracker in the To do (a block under your own reminders, with an Open button, a bar per followed award and the days left) and the new default reminder for members without the script. Before that, script 1.49 (2026-10-24): the Settings (cog) show whether WWL accepts the key and when it last saw the script.

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
