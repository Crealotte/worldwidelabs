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

**2026-09-27 — decided.** You confirmed: every page NOT under the "Leadership" nav menu is fine as
it is (no change). Everything below is scoped to exactly the 12 pages in that menu. This is now the
final spec, ready to implement — not a proposal.

### Leader/Co-leader only — the whole page, view and edit

- **Announcements** (`announce-edit`)
- **Feedback form** (`feedback-edit`) — editing questions, seeing raw answers, and clearing responses all stay Leader-only
- **War Payout** (`war-payout`)
- **Newsletter** (`newsletter`)
- **Leader settings** (`leader-settings`)
- **Mentoring admin** (`mentoring-admin`)
- **Labs Funds** (`labs-funds`) — Leader views, Owner edits (already built this way)

### Council can use fully (view and edit)

- **OC Team Builder** (`ocfit-team`)
- **Consumption Tracker** (`armory-tracker`)

### Split within the page — some sections Council, some Leader-only

**Respect Tracker** (`respect-edit`) — panel by panel:
| Panel | Elements | Tier |
|---|---|---|
| Goals | `rg-window`/`rg-label`/`rg-target`/`rg-deadline`/`rg-save` + the goal list | Leader-only |
| Log war respect manually | `rg-war-*` | Leader-only |
| Check a specific period | `rg-range-*` | Council |
| Daily breakdown | the table itself | Council |
| Daily breakdown | its 3 buttons: `rg-sync-all`, `rg-deep-sync-oc`, `rg-deep-sync-hits` | Leader-only |

**Availability overview** (`availability-leaders`) — panel by panel:
| Panel | Elements | Tier |
|---|---|---|
| Plan picker (choosing which plan to view) | `av-plan-select-l` | Council |
| Resize / archive / delete this plan | `av-plan-resize-l`/`av-plan-archive-l`/`av-plan-delete-l` | Leader-only |
| Link a war to this plan | `av-link-panel` (the whole panel) | Leader-only |
| Faction availability (the table) | `av-summary-panel` | Council |
| Responses | `av-out-panel` | Council |
| Overdoses | `av-od-panel` | Council |
| Create a plan | `av-start-panel` (the whole panel) | Leader-only |
| Archived plans (view/unarchive) | `av-archived-*` | **OPEN** — not covered by your answer, defaulting to Leader-only (structural) until you say otherwise |

**Member Overview** (`members-overview`) — panel by panel:
| Panel | Elements | Tier |
|---|---|---|
| Summary counts, Winners for this period | top panels | Council |
| The hits/rules table | the table itself (period switching, sorting, viewing) | Council (read-only) |
| The hits/rules table | each row's tier-override dropdown (`.mo-tier`) | Leader-only (this is the "editable bit" in an otherwise read-only table) |
| Who's on board | the table | Council (read-only) |
| Who's on board | the Verify checkboxes/toggles | Leader-only |
| War & chain register | the whole panel | Leader-only |
| Rules (settings: min war/chain hits, wars needed) | the whole panel | Leader-only |
| Energy trained: fill in from Torn Intel | the whole panel | Leader-only |
| Checks for the developer | the whole panel | Leader-only |

**Built 2026-09-27:** the "View as" selector (sidebar, member/council/leader/owner) previews all of
the above, and the nav itself now matches the split: the "Leadership" group has two subgroups,
**Leaders** (the six whole-page items, plus Labs Funds) and **Council** (the two fully-open pages
plus the three split ones). Locking happens at the group level, not per page — a locked subgroup
shows one 🔒 on its own header, starts closed, and its header isn't clickable (nothing to open),
instead of decorating every page inside it. Inside an OPEN group, the split pages (Respect Tracker,
Availability overview, Member Overview) still hide their own Leader-only panels/edit controls.

### Real enforcement, done so far

- **Labs Funds is now actually Leader/Co-leader-or-Owner only, enforced on the server** — not just
  hidden in the UI. This one used Torn's own `faction.position` field (exactly "Leader" or
  "Co-leader", the two reserved names) rather than the old `isLeader(key)` check, which only ever
  meant "has faction API access" and let Council in too. See `isLeaderRank()` in api/war-payout.js —
  this is the first real piece of the `getRole()` helper described above, built where it mattered
  most (Council could otherwise see every faction's war-pay history and retained cut).

### Still needs real enforcement, not just hiding

Every OTHER "Leader-only" vs "Council" boundary above is still enforced by one blanket
`isLeader(key)` check per action on the server (true API access, not rank) — there's no server-side
Council-vs-Leader distinction for these yet. Making each real (not just hidden in the UI) means
reusing `isLeaderRank()` in every action named in the tables — a genuinely separate, larger pass,
page by page, once you're ready. Until then, treat any UI hiding on those as look-and-feel only,
same as today's "View as" selector.

---

## Confirmed issue #2 — War Badges: only 4 of 8 categories ever show

**Reported:** the Dashboard's War Badges widget (and the War Badges page itself) only shows 4 of the
8 badges for a saved receipt.

**Likely cause, from reading [lib/warBadgeStats.js](lib/warBadgeStats.js) (not yet confirmed against
real data):** the file's own top comment says so directly — "Field-name risk: `is_ranked_war`/
`ranked_war`, the `overseas` modifier, and the `Assist` result string are all based on how other Torn
tool developers describe the API, not a verified live response (no API key available here to test
against)." A badge only shows at all when at least one member has a value above zero for it
(`war-badges-tracker.js`'s `wbTopTwoForReceipt`/`renderReceiptBadgesHtml` — a badge with nobody
qualifying is skipped, not shown as "0"). So 4 silently-always-empty categories would look exactly
like this: every war, always exactly those 4 missing.

The likeliest candidates, in order of how shaky their field-name guess is:
- **The Rogue Element** (`abroadHits`, reads `att.modifiers?.overseas`) — the shakiest guess.
- **The Catalyst** (`assists`, reads `result.toLowerCase().includes('assist')`).
- **The Detonator** (`hospitalized`, reads `result.includes('hospital')` AND the defender's faction).
- **The Volatile Compound** (needs both `warHits` and `timesDowned` to be nonzero — could fail even
  if `timesDowned` itself is fine, just because it also depends on `warHits`, which is more trusted).

**Resolved 2026-09-27 — the code was never actually broken.** A live diagnostic against a real war
(1,598 attacks) showed the field guesses were all correct: "Hospitalized" and "Assist" are real
`result` values, and the `overseas` modifier does go above 1 (rarely). The 4 missing badges on that
one older receipt were genuine near-zero events for that specific war (0 assists on our outgoing
hits, 0 of our own members hospitalized, 1 abroad hit total) — not a field-name bug. Confirmed by
checking a more recently-saved war ("Glory to Saints"), which shows all 8 badges correctly. The
older receipt's badge numbers were simply baked in once, at save time, possibly before something in
the pipeline was in its current shape — they're not recalculated afterward by design (see
war-badges-tracker.js's own top comment on why). Not touched further — an optional "refresh this
receipt's badges" button could be built if old receipts showing fewer badges bothers you, but it's
cosmetic history at this point, not a live bug.

**Also requested:** make the War Badges widget collapsible, closed by default — **done**, see below.
A leader-only diagnostic ("why are only 4 of 8 showing?", under a picked war) is also now live on
the War Badges page — kept in place in case a genuinely new pattern shows up later.

## Fixes — Dashboard, 2026-09-27

- **Respect Goal**: now collapsible, **open by default** (as asked).
- **Steadfast countdown**: now collapsible, **closed by default** (as asked).
- **War Badges**: now collapsible, **closed by default** (as asked). The 4-of-8 issue itself is
  Confirmed issue #2 above — not fixed yet, needs your input.
- **"Other factions" (cross-faction sharing) is now really Owner-only**, enforced on the server —
  not just hidden in the UI. Before, `api/faction-share.js`'s `read` action used the old
  `isLeader(key)` check (= "has faction API access", the same gap Labs Funds had), so any faction's
  leader who opted into sharing could see every OTHER opted-in faction's shared overview too. Now
  only `labsIsOwner()` gets the `others` list; every leader can still toggle their OWN faction's
  sharing on/off (that stays their own call).
- **"Who's on board" removed from the Dashboard** (per your call) — it's Member Overview's own copy
  now, nobody lost access (both were already Council+, same bar).
- **"Other factions" and the "share this overview" toggle moved from the Dashboard to Labs Funds**
  (per your call) — thematically the same "Owner sees across factions" idea Labs Funds already is.
  Every leader can still switch their own faction's sharing on/off there; only you see what other
  factions shared.
- **Also added while looking at this: a "why only 4 of 8 War Badges" diagnostic** — War Badges page,
  under a picked war, "Leaders: why are only 4 of 8 showing?" — dumps a few raw attacks' `result`/
  `modifiers` fields so the real Torn wording can be read directly. You confirmed the 4 that DO show
  (Alchemist, Reactor, Buffer, Reagent), which lines up exactly with the 4 that depend on the
  unconfirmed field guesses (Rogue Element, Catalyst, Detonator, Volatile Compound) always coming
  back empty — press the new button and paste the output here to fix the pattern for real.

## Noticed in passing, not yet looked into

- `index.html` has a pre-existing `<details>`/`</details>` count mismatch (off by 2, present before
  today's changes too) — could be a real unclosed tag, or just something inside a JS string/comment
  that isn't real markup. Not investigated; flagging so it doesn't get missed.

## Confirmed issue #3 — Happy Jumping Guide told people to stack 4 Xanax "back-to-back"

**Reported:** the 4-Xanax jump guides (Big Choco 4x, 5x/9x EDVD, Poison Mistletoe) said to "stack 4
Xanax back-to-back to reach 1000 Energy" then "wait out all drug cooldowns" as if that were one short
wait — but Xanax's drug cooldown is 6–8h **per dose**, so 4 of them takes at least 3 full cooldowns
back to back (roughly a day, sometimes into a second), never something you can do in one sitting on
day one.

**Fixed 2026-09-27.** Every jump that stacks 4 Xanax now shows the real sequence — Xanax #1 → wait
6–8h → #2 → wait → #3 → wait → #4 — via one shared step list (`xanaxStackSteps()` in
[energy-planner.js](energy-planner.js)) so the timing is consistent everywhere instead of retyped (and
re-guessed) per jump. The 4-Xanax Big Choco variant is now its own card, separate from the 1-Xanax
one, since they're different timelines, not one card with two branches.

**Also done, same page:**
- Steps are now checkboxes (persisted per browser) instead of plain bullets — but a "wait" step
  (buying items first, waiting for a Happy reset, waiting out a cooldown) isn't its own checkbox any
  more, since waiting isn't a task you complete — it shows as a small "→ Wait ..." note attached
  under the step before it, as asked.
- "This week's plan" panel is now collapsible.
- Removed the "Install the script" checklist panel — the userscript is a general one now and will be
  linked from somewhere else, not repeated per-page.

**Not done — needs your input:**
- **A "how many Xanax per day" cap for the weekly calculator** (planForGroupA/B) was suggested as an
  alternative/addition to timing the jumps exactly. The weekly plan itself was already spreading
  doses across days reasonably (2/day for group A, 4 over "days 1 & 2" for group B) — it was only the
  Happy Jump *guide* that had the impossible wording, now fixed. Say if you still want a daily-cap
  input added on top of that.
- **A member's "2x daily candy jump" suggestion** (their numbers: ~75% more stat gain than 1x49
  candy/day, using Private Island + 4,275 base Happy + 25-Happy candy boxes) — I don't want to add
  unverified stat-gain numbers as training guidance. Could you get their Google Sheet? Once I can see
  the actual formula behind their numbers (not just the conclusion), I can check it against Torn's
  known gym-gain mechanics and add it properly if it holds up.

## How to use this list

For each page below: open it, use it as a member would and as a leader would (if it has both
views), check the numbers against a real, independently-checkable source where one exists (Torn
itself, or another WWL page that computes the same thing a different way), and note anything wrong
or missing. Mark `[x]` once checked, with a one-line note (even "looks correct" counts).

## Page-by-page checklist

- [x] Dashboard (`dashboard`) — 2026-09-27. See "Confirmed issue #2" and the fixes below.
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
- [x] Energy planner (`energy`) — 2026-09-27. See "Confirmed issue #3" below.
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

- `availability-tracker.js`'s `renderAvailabilityPage()` sets `$('av-discord-panel').style.display`,
  but that element lives on the Leader settings page, not Availability overview — looks like a
  leftover/stray reference. Not touched; needs a look when we get to Availability overview or Leader
  settings in the page-by-page pass.

## Ops note

2026-09-27: commit `3ff0863` (the tallying version of the War Badges diagnostic) reached GitHub's
`main` fine but never showed up in Vercel's Deployments list at all — a missed webhook, not a build
failure. If this happens again: check Vercel → Project → Deployments for the commit; if it's simply
absent (not "Building"/"Error"), push a trivial follow-up commit to re-trigger it, same as this one.

## Fixes queued from the audit (add here as we find them)

1. ~~Candy/Alcohol/Blood bags data source~~ — **fixed 2026-09-27**, see above.
2. Access tiers (Personal/Members/Council/Leader/Owner) — **spec decided AND "View as" preview
   built, 2026-09-27**, see above. Next, whenever you're ready: real server-side enforcement, so
   Council is actually blocked (not just hidden from) the Leader-only bits — the `getRole()` helper
   described above, wired into each action named in the tables.
3. ~~War Badges showing only 4 of 8~~ — **resolved 2026-09-27, not a bug**, see Confirmed issue #2.
4. ~~"Who's on board" and "Other factions" placement~~ — **done 2026-09-27**, see above.
5. ~~Happy Jumping Guide's impossible "4 Xanax back-to-back"~~ — **fixed 2026-09-27**, see Confirmed
   issue #3. Daily-Xanax-cap input and the 2x-daily-candy-jump suggestion are still open, waiting on you.
