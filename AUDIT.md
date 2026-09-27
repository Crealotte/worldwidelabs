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
- The "filled a Blood Bag" wording was wrong on the first day this shipped (a guess); confirmed and
  fixed the same day against a real line ("Solo050 filled one of the faction's Empty Blood Bags to
  create a Blood Bag : A+"). The tracker auto-resets once to rebuild with the corrected pattern —
  press "Dig deeper" again afterward to get back to where it was.

---

## Access tiers — design proposal (nothing implemented yet, needs your decisions)

You asked for five tiers: **Personal** (only you), **Members** (everyone in the faction),
**Council** (has faction API access, but isn't Leader/Co-leader), **Leader/Co-leader** (full access
to their own faction), **Owner** (you — edits Labs funds by hand, sees every faction on WWL).

**Torn side, checked and workable:** WWL already tells "has faction API access" from "doesn't"
(that's what `isLeader(key)` actually checks today — the name is misleading, it really means "this
key's position has API Access turned on," which a leader can grant to non-Leader positions too,
which is exactly your Council). What's missing is telling **Council apart from Leader/Co-leader**
specifically. Torn's own profile data includes `faction.position` — the exact position name — and
"Leader" and "Co-leader" are two reserved names Torn itself assigns and nobody can rename. So:
- **Leader/Co-leader** = has API access AND position is exactly "Leader" or "Co-leader".
- **Council** = has API access AND position is anything else (whatever your custom rank is called).
- **Owner** = the existing `labsIsOwner()` check (already built, already faction-independent).
- **Members** = a working key that resolves to the faction at all (no API access needed).
- **Personal** = not really a tier — it's "only this row is about you," which cuts across all of the
  above (a Council member's OWN feedback answer, say, vs. everyone's).

Plan: one shared helper, computed once per request from data already being fetched (the existing
profile lookup + the existing `isLeader`/`labsIsOwner` checks), so this doesn't add any extra Torn
calls anywhere. Every action then declares its own required tier instead of the current one-size
`isLeader` gate.

**Below is a first pass at sorting every currently leader-gated thing into a tier**, page by page,
based on your own rule of thumb (Council can *see* most things, but not change money, form
questions, or integration settings). Anything I wasn't confident about is marked **OPEN**. Please
go through this and correct/confirm before any of it gets built — this is a proposal, not a plan.

| Page / feature | Gated today | Proposed | Note |
|---|---|---|---|
| Availability tracker (view) | Extra detail (names, who's out) is Leader-only; the count is public | **Council sees the same detail as Leader** | Your own example — high confidence |
| Availability tracker (create/edit/archive a plan) | Leader-only | OPEN — lean Leader-only (structural) | Council could still "see and ping" |
| Availability tracker ("see who and ping them") | Leader-only | OPEN — lean Council | Operational, not structural |
| Feedback form (fill in your own / see public results) | Already open to everyone | No change (Members/Personal) | |
| Feedback form (edit the questions) | Leader-only | **Leader-only** | Your own example — high confidence |
| Feedback form (see everyone's raw answers) | Leader-only | OPEN — lean **Leader-only** | Feedback often includes opinions about leadership itself; worth keeping Council out even though they can see availability |
| Feedback form ("clear"/reset all responses) | Leader-only | **Leader-only** | Destructive |
| Member Overview (view hits/rules/register) | Leader-only (whole `mo-*` bucket) | OPEN — lean Council | |
| Member Overview (change rule settings, tier overrides, register assignments) | Leader-only | OPEN — lean **Leader-only** | Affects who "passes" and payout amounts |
| War Payout Calculator (view/calculate/pay) | Leader-only | OPEN — lean **Leader/Co-leader only** | Real money moves via the "Pay" button |
| War reports (remove a report from the list) | Leader-only | OPEN — lean Council | Low risk, just tidies a list |
| Labs funds (view) | Leader-only | OPEN — lean **Leader-only** | Financial |
| Labs funds (add/edit an entry) | Owner-only | No change | Already matches your Owner definition exactly |
| Newsletter (build the draft) | Leader-only | OPEN — lean Council | No money, no real changes, just a copy-paste helper |
| Steadfast (sync numbers) | Leader-only | OPEN — lean Council | Routine refresh |
| Steadfast (set respect goals) | Leader-only | OPEN — lean **Leader-only** | Target-setting decision |
| Respect tracker (view) | Already open to everyone | No change | |
| Respect tracker (sync) | Leader-only | OPEN — lean Council | Routine refresh |
| Respect tracker (add manual war entry / set goal) | Leader-only | OPEN — lean **Leader-only** | |
| OC Fit team planner (assign members to slots) | Leader-only | OPEN — lean Council | Scheduling, no money |
| Mentoring admin (assign/monitor pairs) | Leader-only | OPEN — lean Council | Scheduling/oversight, no money |
| Bug reports & suggestions (change status/delete) | Leader-only | OPEN — lean Council | Moderation |
| Announcement editor | Leader-only | OPEN — lean **Leader-only** | Faction-wide public message |
| Leader settings → "Who's on board" verify ticks | Leader-only | OPEN — lean Council | Routine data entry |
| Leader settings → Discord/nightly/faction-share config | Leader-only | OPEN — lean **Leader-only** | Credentials/integration |
| What's New → send version to Discord | Leader-only | OPEN — lean **Leader-only** | Outward-facing post |
| Armory / Consumption Tracker (view report) | Leader-only | OPEN — lean Council | Report only, doesn't spend anything |
| Banners (create/edit for this faction) | Leader-only | OPEN — lean Council | Just a message |
| Banners (create/edit for ALL factions) | Owner-only | No change | Already matches Owner |

Everything else on the page-by-page list below has no leader gate today and stays Members/Personal
as-is.

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
2. Access tiers (Personal/Members/Council/Leader/Owner) — see the design proposal above. **Waiting
   on your answers to the OPEN rows before any of this is built.** Nothing changes until then.
