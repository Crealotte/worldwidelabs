# WWL audit — cross-checking what we have before adding anything new

Started 2026-09-27. Purpose: go through every page/feature one at a time, check it's correct and
complete, and log what needs fixing here instead of jumping straight to code. Work through this
top to bottom; tick a box and add a note when a page has been checked.

---

## Confirmed issue #1 — Candy / Alcohol / Blood bags numbers don't match the armory log

**Reported:** solo050 shows 78 "blood bags filled" on WWL; the real armory log shows 34. Someone
else's candy/alcohol number was also reported wrong.

**Root cause (confirmed by reading the code, not yet fixed):** Member Overview, the dashboard's
"Your standing" card, and the newsletter's competition winners all get Candy/Alcohol/Blood-bags
from **Torn's personal lifetime stats** (`candyused`, `alcoholused`, `bloodwithdrawn` — see
[lib/memberOverview.js](lib/memberOverview.js) `PS_STATS`), diffed between two snapshots. Those
stats count **every** candy/alcohol/blood-draw a player has ever done, from **any** source — bought
themselves, gifted, market — not specifically what they took from or filled for OUR faction armory.

WWL already has the *correct*, armory-specific data, just not wired up to these numbers: the
Consumption Tracker's `consumption-report` (see [api/armory-tracker.js](api/armory-tracker.js) and
[lib/armoryNewsParser.js](lib/armoryNewsParser.js)) parses Torn's real faction news for
`"X used one of the faction's <item> items"` and `"X filled a <item> for the faction armory"` —
per player, for a real date range — which is exactly what a leader sees when they check the armory
log by hand. `lib/trackedItems.js` already lists the specific Candy and Alcohol items and the 8
Blood Bag types this covers.

**So:** the mismatch isn't a calculation bug — it's the wrong data source for what a leader actually
means by "candy/alcohol/blood bags used" (armory stock, not personal lifetime habit). 78 vs 34 is
consistent with solo050 having also drawn blood outside of what he filled for the faction.

**Fixed 2026-09-27 (Option A).** Candy/Alcohol/Blood-bags on Member Overview, the dashboard's "Your
standing" card, and the newsletter now come from a new tracker,
[lib/armoryConsumption.js](lib/armoryConsumption.js), that reads the same real armory news log a
leader checks by hand — "X used one of the faction's Candy/Alcohol items" and "X filled a Blood Bag
for the faction armory" — per player, per day. The old personal-lifetime-stat system
(`candyused`/`alcoholused`/`bloodwithdrawn` snapshots) is removed.

- Kept up to date automatically, a little at a time, whenever a leader opens Member Overview.
- **Coverage only starts from the day this went live**, same limit as respect gained/perk levels
  elsewhere — except a leader can press **"Dig deeper"** (shown right under the period picker,
  Member Overview) to walk back further into Torn's armory news history, as far as it still goes.
  You only need it to reach back through the current newsletter period.
- The "filled a Blood Bag" wording match is an educated guess (not confirmed against a real Torn
  news line, unlike the "used" wording which is) — if Blood bags filled looks off after this ships,
  send a real news line from your faction's armory log and it can be corrected.

---

## How to use this list

For each page below: open it, use it as a member would and as a leader would (if it has both
views), check the numbers against a real, independently-checkable source where one exists (Torn
itself, or another WWL page that computes the same thing a different way), and note anything wrong
or missing. Mark `[x]` once checked, with a one-line note (even "looks correct" counts).

## Page-by-page checklist

- [ ] Dashboard (`dashboard`) — the aggregate widgets (Your standing, War Badges, announcements, banners, polls)
- [ ] Your standing card specifically (`my-standing.js`) — energy, war/chain hits, places
- [ ] Member Overview (`members-overview`) — hits table, war rule, War & chain register, consumption columns, tiers
- [ ] War Payout Calculator (`war-payout`)
- [ ] War reports (`war-reports`)
- [ ] War Badges (`war-badges`)
- [ ] Availability tracker — member view (`availability`)
- [ ] Availability tracker — leader view (`availability-leaders`)
- [ ] Armory / Consumption Tracker (`armory-tracker`)
- [ ] Labs funds (`labs-funds`)
- [ ] Newsletter (`newsletter`)
- [ ] Steadfast / faction perks (`steadfast`)
- [ ] Perk roadmap (`perk-roadmap`)
- [ ] Respect tracker (`respect-edit`, plus the dashboard goal panel)
- [ ] Energy tracker (`energy-tracker`)
- [ ] Energy planner (`energy`)
- [ ] Gym stats (`gym-stats`)
- [ ] OC Fit (`ocfit`)
- [ ] OC Fit team planner (`ocfit-team`)
- [ ] Target finder (`targetfinder`)
- [ ] My targets (`my-targets`) / Targets (`targets`)
- [ ] Timezone map (`tz-map`)
- [ ] Foreign stock tracker (`foreign-stock`)
- [ ] Crimes guide (`crimes-guide`)
- [ ] Mentoring — member view (`mentoring`)
- [ ] Mentoring — admin view (`mentoring-admin`)
- [ ] Feedback form — filling it in (`feedback`)
- [ ] Feedback form — editing/results (`feedback-edit`)
- [ ] Bug report page (`bug-report`)
- [ ] Announcement editor (`announce-edit`)
- [ ] Tools & links (`links`)
- [ ] Leader settings (`leader-settings`) — Discord, nightly saving, verify records, etc.
- [ ] What's new (`whats-new`)
- [ ] Player profile popup (`profile`)
- [ ] Payout receipt viewer (`payout-receipt`, shareable link)
- [ ] The userscript (Torn/TornPDA) — to-do list, energy tab, targets tab, banners, update flagging

## Fixes queued from the audit (add here as we find them)

1. ~~Candy/Alcohol/Blood bags data source~~ — **fixed 2026-09-27**, see above.
