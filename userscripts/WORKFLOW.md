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
- Script 1.40.7 (dev): the Energy tab has My week starts (a date, or Automatic), shared with the planner on the site; the server part is live.
- Script 1.40.6 (dev): the Energy tab can count the energy really trained instead of the ticks (plan-track, shared with the planner on the site; the server part is live).
- Script 1.40.5 (dev): the Energy tab opens on the day you are working on (the last day with a tick), not always on day 1. Script 1.40.4 (dev): the Avail grid has the days as columns and the hours as rows, like the site. Script 1.40.3 (dev): the Mentoring tab is removed (the Notes tab has the same chapters; the mentor and the chat are on the site, with a link in the Notes tab).
- Script 1.40.2 (dev): new Avail tab with the faction overview (everybody, with names when you tap an hour, now-hour framed) and My hours (tap to set green, yellow or off). The server part (crowd numbers in availability-get) is already live.
- Nothing queued. Last release: script 1.40 (2026-10-18): the Trade helper on Torn's trade pages (total at the WWL pricelist, receipt link and Copy message, Accept button with Accept anyway, the money page filled in, a full Plushie/Flower Set priced as the set, finished trades saved to the ledger with Undo). It stays quiet for anybody without a pricelist.

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
