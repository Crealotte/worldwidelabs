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
- Own reminders: a checkbox on each (once = stays ticked, daily = unticks itself every day), ticked ones not counted in the To do number, and the add box + delete marks moved into the script's ⚙ Settings to keep the To do tab short (work file 1.38.3, not released). The server side and the dashboard panel are already live.
- Mentoring tab for pupils in the program (even before they have a mentor): the welcome chapters (only the open chapter in detail, the others locked), ticking manual steps; and for a mentor, how far each pupil is with ticking steps for them (DEV 1.38.8; every chapter is a window that is closed to begin with; the role path (Recruit, Experiment A and B, Guinea Pig or Lab Rat, Chemist) with what the next role needs; the mentor sees every chapter of their pupil with the ticks, the To do lines open this tab; the old shared pair checklist is gone from the tab too). The To do lines for this are server-side and already live.

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
