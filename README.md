CholScore v1.13.1 - Reward claims now show on the Day Report

# CholScore v0.8.5 — Cache + Delete Hotfix

Root cause found:

The HTML update containing the Delete button was reaching Android, but the installed PWA's service worker was still serving the old cached `app.js`.

That meant:
- the button appeared
- but the delete click-handler did not exist in the JavaScript Android was running

v0.8.5 fixes the update mechanism itself.

Changes:
- service-worker cache version bumped to `cholscore-v085`
- old CholScore caches are removed during activation
- `index.html`, `app.js`, `styles.css`, and `manifest.json` are now network-first
- cached copies are used only as an offline fallback
- app.js and styles.css have v0.8.5 cache-busting query strings
- the service worker checks for an update on app launch
- the food-delete fix from v0.8.4 is retained

No new features.

## v0.9 guided workout update
- Added optional weight (kg) and exercise notes to routine exercises.
- Replaced the spreadsheet-style live workout with a guided one-exercise-at-a-time flow.
- Sets are visibly ticked as they are completed; each exercise gets a positive completion screen.
- Final workout celebration shows total weighted training volume and workout duration.
- Existing routine data remains backwards-compatible; missing weight/notes default safely.
- service-worker cache version bumped to `cholscore-v090`.


## v0.9.1 workout cancel hotfix
- Added a clearly visible **Cancel workout** action to the live guided workout screen.
- Cancelling requires confirmation to prevent accidental loss.
- Cancelling discards only the unfinished workout; the saved routine remains unchanged.
- Cancelled workouts are not written to History.
- service-worker cache version bumped to `cholscore-v091`.

## v1.13.1 reward claims now show on the Day Report
- Requested: when a reward is cashed out, show what it was and how many points it
  cost on that day's History report — matching the same gold treatment the report
  already uses for Personal Record badges.
- Cash-out history entries now store which day they happened on (`dayKey`), so the
  report can look up "was anything claimed on this exact day" directly rather than
  parsing a raw timestamp.
- New section appears right after Today's Rings, before Strength Session — shows
  the reward's icon, name, and its point cost. Only appears on days something was
  actually claimed; every other day's report is completely unaffected, same as how
  PR badges only show up where they were actually earned rather than adding empty
  placeholders everywhere.
- Tested against realistic multi-day claim history before shipping: a claim
  correctly appears on its own day, is correctly absent from every other day,
  a different day's claim doesn't leak into the wrong report, and a brand-new
  user who's never touched the Reward Bank doesn't crash the report.
- `index.html`, `styles.css`, `app.js`, and the image cache-busting query strings
  bumped to `v140`.
- service-worker cache version bumped to `cholscore-v140`.

## v1.13.0 Reward Bank — persistent points and custom goals
- Reported: the "Weekly Bank" reset every Monday, discarding points earned the
  week before — not wanted. Rebuilt as a persistent Reward Bank instead of
  patching the reset behaviour.
- **New, simpler earning rule, confirmed explicitly**: points banked = your daily
  saturated fat target minus what you actually consumed that day, direct and
  uncapped — 20g limit, 14g consumed = 6 points. This replaces the old formula
  entirely, which capped at 5/day and used a different scaling curve. Has nothing
  to do with exercise minutes or the overall CholScore — purely saturated fat
  headroom, as specified.
- **Points never expire.** Architecture: a lifetime "earned" total is summed fresh
  from every checked-out day (same pattern as the rest of the app — nothing stored
  redundantly, so it can't drift out of sync with day data), and a separate
  `spentPoints` counter only increases when a reward is actually cashed out.
  Available balance = earned minus spent. No day's history is ever edited to
  "remove" points — spending is its own ledger, exactly like a real bank account.
- **Set a custom reward goal**: tap the card (renamed from "Weekly Bank" to
  "Reward Bank") to open a sheet — name a goal, pick a point cost, and pick an
  icon from a 20-option picker (book, chocolate, plant, trainers, game, coffee,
  and more). Built as a custom dropdown-style grid rather than a native `<select>`,
  matching how the rest of the app avoids default browser UI for anything visually
  significant.
- **Progress tracking**: the card itself shows a live mini progress bar toward the
  active goal without needing to open anything. The full sheet shows exact
  fraction (e.g. 14/17), today's contribution, and a Cash Out button that's
  disabled with "need N more" until the goal is actually reached.
- **Checkout integration**: the existing checkout summary now gets a reward line
  underneath it — "+6 points banked today, 3 points away from New plant — keep
  going," a distinct celebratory version the day the goal is actually reached, and
  an honest "no points banked today" version on an over-target day, still showing
  distance to the goal rather than going silent.
- Cashing out asks for confirmation, deducts the goal's cost from the ledger,
  archives it to a small history array, and clears the active goal so a new one
  can be set.
- Tested the full lifecycle end-to-end before shipping: the exact 20g/14g/6-point
  example, lifetime accumulation across old and new days (proving the removal of
  the weekly cutoff actually works), zero points for an over-target day, zero
  points for a day with no food logged, the cash-out guard correctly blocking
  early redemption, and the ledger continuing to accumulate correctly immediately
  after a cash-out (not resetting, not double-counting).
- `index.html`, `styles.css`, `app.js`, and the image cache-busting query strings
  bumped to `v139`.
- service-worker cache version bumped to `cholscore-v139`.

## v1.12.4 reverted best-score banner back to Rewards
- Full circle: the original move to Exercise (v1.12.2) turned out to be based on a
  naming mix-up — "personal best" sounded like it meant exercise Personal Records,
  but it's actually the highest-ever daily CholScore, which blends food and
  exercise together rather than being an exercise-specific number at all. Once the
  label was clarified (v1.12.3) it became obvious it never belonged on the
  Exercise tab to begin with.
- Reverted cleanly: removed the gold banner from the top of Exercise, restored the
  third stat card (streak/points/personal best) in Rewards' 3-column grid exactly
  as it was originally.
- Removed all the now-dead CSS from the banner detour (`.best-score-banner`,
  `.best-score-icon`, `.best-score-max`, `.stats-grid-2`) rather than leaving it
  as unused weight in the stylesheet.
- Confirmed zero dangling references in either direction before shipping — nothing
  left pointing at the removed banner elements, and `bestStat` back to exactly one
  HTML definition and one JS write, matching the file's original shape before this
  detour began.
- `index.html`, `styles.css`, `app.js`, and the image cache-busting query strings
  bumped to `v138`.
- service-worker cache version bumped to `cholscore-v138`.

## v1.12.3 clarified the best-score banner
- Reported: a bare "40" next to "Personal best CholScore" gave no sense of scale —
  genuinely read as ambiguous (a count of something? out of what?) rather than
  obviously "your best day was 40 out of 100."
- Now reads **"40/100 — Best CholScore"** — the number keeps its bold size, `/100`
  sits right after it in a smaller, muted gold tone so it doesn't compete with the
  main figure, and the label underneath is simplified since the number now
  explains its own scale.
- Purely a display/wording change — same `bestEverScore()` computation as v1.12.2,
  same banner position at the top of Exercise, nothing about what's tracked
  changed.
- `index.html`, `styles.css`, and the image cache-busting query strings bumped to
  `v137`.
- service-worker cache version bumped to `cholscore-v137`.

## v1.12.2 personal best score moved to top of Exercise
- Follow-up to v1.12.1: the "personal best" stat card (trophy icon, e.g. "40") was
  still sitting in Rewards, unmoved.
- Moved it to a new compact gold banner right at the very top of the Exercise tab —
  above "Movement today", the first thing visible on the tab, matching "see it at a
  glance" rather than being buried at the bottom with the Personal Records list.
- Rewards now shows only day streak and total points — rearranged from a 3-column
  grid down to a proper 2-column one rather than leaving an empty gap where the
  third card used to be.
- The computation itself (highest-ever daily CholScore across all checked-out days)
  didn't change at all, just where it's read from — factored into a small
  `bestEverScore()` helper so it's not duplicated, and tested against both real
  multi-day data and a brand-new-user zero-data case before shipping.
- `index.html`, `styles.css`, `app.js`, and the image cache-busting query strings
  bumped to `v136`.
- service-worker cache version bumped to `cholscore-v136`.

## v1.12.1 Personal Records moved to Exercise
- Reported: with 6+ PR entries, the Rewards tab required scrolling past the entire
  Personal Records list before reaching the actual achievement collection — the
  thing the tab is supposedly about.
- Moved the whole Personal Records section from Rewards to the bottom of the
  Exercise tab, where it's more topically at home — it's about exercise history,
  not the gamification/collection layer.
- Rewards' "personal best" stat card (the trophy one showing e.g. "40") stays
  exactly where it is — checked, and despite the similar name it's actually your
  highest-ever daily CholScore, a completely different thing from exercise PRs
  that just happened to share a name. No reason to move it.
- Straightforward move, not a rebuild: `renderPersonalRecords()` now runs as part
  of `renderExercise()` instead of `renderRewards()`, so it's still just as live
  (refreshes every render), just attached to the right tab. Confirmed exactly one
  definition and exactly one call site afterward, and that `#prList` only exists
  once in the page.
- `index.html`, `styles.css`, `app.js`, and the image cache-busting query strings
  bumped to `v135`.
- service-worker cache version bumped to `cholscore-v135`.

## v1.12.0 10 new achievements, including 2 real Mythic ones
- v1.11.0 shipped the colour-coding system and the Mythic visual treatment, but
  left it unused — no achievement actually had `rarity:"MYTHIC"` yet. That was a
  real miss: the whole point of the two brainstorming rounds and the mockup was to
  get actual new achievements in, not just a palette. Fixed properly this time —
  10 new achievements added, going from 44 to 54 total.
- **Quick wins**: Back Again (2-day streak), Scan Squad (3 scanned foods, bridges
  to the existing 10), Set It Once (first custom routine), Personal Best (first PR),
  On A Roll (3 PRs).
- **Long haul**: Two Months Strong (60-day streak), Century Streak (100-day
  streak), Ten Ton Club (10,000kg lifted lifetime).
- **Mythic, finally used for real**: 365 Days (a full year streak) and Hundred Ton
  Club (100,000kg lifted, lifetime — "roughly a loaded shipping container").
- Three new metrics added to `achievementMetrics()`: `routines` (just
  `state.routines.length`), `totalWeightLifted` (summed from the `totalWeight`
  field workouts already store at save time — not recalculated, so it's guaranteed
  to agree with what the workout-complete screen showed on the day), and `prCount`
  (reuses the exact same `computePersonalRecords()` function the Rewards tab's
  Personal Records list and the Day Report's gold PR flags already use, so this
  can't disagree with what's shown elsewhere in the app).
- Verified all three new metrics against realistic multi-day data (workouts, a
  walk, routines, streaks) and a zero-data brand-new-user case before shipping —
  including catching and correcting my own arithmetic on an edge case (a first-ever
  walk sets both a distance PR *and* a pace PR at once, since there's nothing to
  compare it against yet — the code was right, my mental maths checking it wasn't).
- `index.html`, `styles.css`, `app.js`, and the image cache-busting query strings
  bumped to `v134`.
- service-worker cache version bumped to `cholscore-v134`.

## v1.11.0 colour-coded achievement rarity + Mythic tier
- Every existing achievement now shows its actual rarity colour — Common (grey),
  Rare (cyan), Epic (violet), Legend (gold). Previously every tier looked visually
  identical; only the printed word ("COMMON"/"LEGEND"/etc.) differed at all.
- One-line change applies retroactively to every achievement already defined —
  added a `r-{rarity}` class at render time rather than needing to touch each of
  the ~35 existing achievement definitions individually.
- Added a new **Mythic** tier above Legend, reserved for genuine long-haul
  achievements (a year-long streak, lifetime tonnage lifted) — not shipped with any
  achievements using it yet, since which specific long-haul achievements to add is
  still being decided, but the treatment is ready.
- Mythic is deliberately not just "gold but bigger": a multi-colour glow around the
  whole card, an animated shifting gradient ring instead of a flat border, a
  shimmer sweep that periodically catches the light like foil, a glowing icon, and
  a gradient-text title. Stays glowing even while locked (just slightly dimmer)
  rather than the usual flat grey-out other locked achievements get — the point is
  that it should look worth a year of dedication before it's earned, not just
  decorate it after the fact.
- Respects `prefers-reduced-motion` (shimmer/border/pulse animations disabled,
  glow stays as a static state).
- `index.html`, `styles.css`, `app.js`, and the image cache-busting query strings
  bumped to `v133`.
- service-worker cache version bumped to `cholscore-v133`.

## v1.10.3 routine editor scrolls as one page, not a nested container
- Reported again after the v1.10.2 fix: still couldn't reach the rest of an
  expanded exercise's fields or the Save/Cancel buttons.
- v1.10.2 fixed the iOS touch-scroll bug on the nested list container, but the
  underlying layout — a fixed-size scrollable list sitting between a fixed header
  and fixed Save/Cancel buttons — was still the wrong shape for this content. A
  single tall expanded exercise can genuinely need more room than that inner box
  ever had, regardless of whether its scrolling worked.
- Removed the nested scroll container entirely rather than continuing to patch it.
  The whole form (header, routine name, exercise list, Save/Cancel) is now one
  single natural scrolling page — expand an exercise and the page simply grows and
  scrolls to show it, the same way a normal long web page works. No inner box with
  its own height limit to run out of room.
- Simpler and more robust than the previous approach: one scroll context instead of
  two nested ones means there's no equivalent of the v1.10.2 bug left to hit here,
  since there's no longer a separate inner container that could fail independently
  of the outer page.
- `styles.css` cache-busting query string bumped; `index.html`, `app.js`, and the
  image cache-busting query strings bumped to `v132`.
- service-worker cache version bumped to `cholscore-v132`.

## v1.10.2 fixed iOS touch-scroll failing on nested scroll containers
- Reported: after expanding an exercise (e.g. Bench press) in the newly full-screen
  routine editor, the list couldn't be scrolled — no way to reach Save/Cancel.
- Root cause: `.routine-builder-list` uses `overflow:auto` on a flex child to scroll
  independently of the header/buttons around it — correct approach, but missing
  `-webkit-overflow-scrolling:touch`. Without it, iOS Safari frequently fails to
  register actual finger-swipe gestures on a nested flex-child scroll container,
  even though the exact same element would scroll fine via a mouse wheel — which is
  exactly why this wasn't obvious from the CSS alone and needed a real report on a
  real phone to surface.
- Fixed by adding the missing property — the same one every other *working* scroll
  container in the app already had, which is what made this easy to spot once
  looked for directly.
- Audited every `overflow:auto`/`overflow-y:auto` in the stylesheet for the same gap
  rather than fixing only the reported instance, and found it in two more real,
  live dialogs: the main workout-complete celebration screen and the daily checkout
  dialog. Both could have hit the identical "can't scroll, can't reach the button"
  failure on iOS if their content ever ran long enough to need scrolling — fixed
  both before they could get reported separately.
- `styles.css` cache-busting query string bumped; `index.html`, `app.js`, and the
  image cache-busting query strings bumped to `v131`.
- service-worker cache version bumped to `cholscore-v131`.

## v1.10.1 full-screen routine editor + clearer expanded rows
- Reported, with a screenshot marked up in red: significant wasted space down both
  sides and across the bottom of the routine editor, and the expanded exercise row
  ("Sumo squats") was hard to tell apart from the collapsed rows around it — "looks
  like the same block of text."
- **Wasted space**: root cause was that the routine editor was still a floating
  card dialog (94vw wide, default modal padding, centered with visible margins) —
  a reasonable choice for a short confirmation, wrong for a long, scrollable
  editing surface with a variable number of exercises. Made it genuinely
  full-screen instead, the same treatment `.workout-modal` already uses
  successfully. The exercise list itself was also capped at a fixed `46vh`
  regardless of how much room was actually available — changed it to flex and
  fill whatever space the full-screen layout actually provides.
- Making it full-screen introduced the exact same class of bug fixed earlier this
  session on the Day Report's close button: the title/close button can end up
  sitting under the notch/status bar once a dialog is truly edge-to-edge. Caught
  and fixed it here before it could ship, then proactively audited every other
  full-screen surface in the app for the same unhandled-safe-area pattern —
  found and fixed it on two more: the live workout screen and the barcode
  scanner, both of which had the identical gap.
- **Expanded row clarity**: added a visible cyan border + glow around the whole
  card while it's open, a darker background and a divider line marking exactly
  where the collapsed header ends and the editable fields begin, and increased
  the gap between separate exercise cards (9px → 14px) so distinct exercises
  don't read as one continuous block. Also removed the redundant "Exercise" text
  label above the name field — the name was effectively showing twice (once as
  the header title, once as the label plus the input's own value), which was
  part of what made it look duplicated.
- `index.html`, `styles.css`, `app.js`, and the image cache-busting query strings
  bumped to `v130`.
- service-worker cache version bumped to `cholscore-v130`.

## v1.10.0 collapsible exercise rows in the routine builder
- Reported: editing a routine with several exercises meant every exercise was
  fully expanded at once — name, the timed toggle with its two-line description,
  the sets/reps/weight grid, and a notes textarea — so only about 1.5 exercises
  fit on screen at a time and reviewing a routine meant constant scrolling.
- Built and approved as a mockup first, then implemented for real: exercises are
  now collapsed by default, showing just the name and a one-line summary
  ("3 sets × 10 reps · 12kg", or a "⏱ Timed" indicator, plus a 📝 mark if there
  are notes). Tap a row to expand it for editing.
- A brand-new blank exercise still opens automatically — there's nothing to
  summarize yet, so it makes sense to land straight in the fields. This falls out
  naturally from one rule (open if the exercise has no name yet) rather than
  needing special-case handling at each of the three places rows get created
  (new routine, editing an existing one, tapping "+ Exercise").
- Rows are numbered (1, 2, 3...) so it's easier to reference a specific exercise
  when a routine has several.
- Every actual form field — name, timed toggle, sets, reps, weight, notes — is
  exactly the same as before, same classes, same validation, same data shape.
  This only changes what's visible by default, not what's editable or how
  `saveRoutine()` reads the data back out.
- Removed the old always-expanded grid CSS entirely rather than leaving it as
  dead weight in the stylesheet, since nothing references it anymore.
- Cross-checked every class name used in the new markup against both the CSS and
  against `saveRoutine()`'s field reads before shipping, to make sure the
  restructuring didn't silently break saving.
- `index.html`, `styles.css`, `app.js`, and the image cache-busting query strings
  bumped to `v129`.
- service-worker cache version bumped to `cholscore-v129`.

## v1.9.4 delete a mis-logged activity
- Reported: an incorrectly-entered exercise/activity under "Today's completed
  activity" on the Exercise tab had no way to be removed — the row was static, no
  tap handler, no delete option at all.
- Added a small delete button to every activity row (workout, walk, run, or
  one-off — all of them, since all four types already carried a unique `id`, this
  needed no data migration). Tap it, confirm, it's gone — same simple
  confirm()-then-remove pattern the app already uses for other destructive actions
  like resetting data, rather than introducing a new dialog for something this
  straightforward.
- Deletion targets the specific activity by its `id`, not its position in the list,
  so it can't accidentally remove the wrong entry if two activities look similar.
- Tested against a realistic 3-activity day (workout, walk, and a mis-entered
  workout) — confirms only the targeted activity is removed, the other two are
  left completely untouched, and deleting a non-existent id safely no-ops rather
  than corrupting the list.
- `index.html`, `styles.css`, `app.js`, and the image cache-busting query strings
  bumped to `v128`.
- service-worker cache version bumped to `cholscore-v128`.

## v1.9.3 fixed unreachable Day Report close button
- Reported: the Day Report's close (✕) button appeared to do nothing when tapped,
  with the report stuck open — screenshot showed the button visually overlapping
  the status bar/battery indicator on an iPhone 17 Pro Max.
- Root cause: `.rep-close` was positioned with a flat `top:16px`, with no account
  for `env(safe-area-inset-top)` — the only element in the entire stylesheet with
  this gap; every other top-anchored element already handled it correctly. On a
  phone with a notch or Dynamic Island, that placed the button underneath the area
  iOS reserves for its own status bar. Taps landing there get intercepted by iOS
  itself (e.g. the tap-to-scroll-to-top gesture) rather than ever reaching the
  button's own click handler — which was actually correct and unchanged the whole
  time; this was never a JavaScript bug.
- Fixed by changing it to `top:calc(env(safe-area-inset-top) + 16px)`, so the
  button now sits a consistent 16px below the safe area on any device — notched,
  Dynamic Island, or neither, since the inset resolves to 0 on older devices and
  the calc simplifies back to the original 16px automatically.
- Audited the rest of the stylesheet for the same class of bug (any top-anchored
  fixed/absolute element not using the safe-area inset) before shipping — this was
  the only instance.
- `index.html`, `styles.css`, and `sw.js` updated; cache-busting query strings and
  the service worker cache version bumped to `v127`.

## v1.9.2 splash links switched to absolute URLs
- Follow-up to v1.9.1: after the white-flash fix, a full cold reboot + fresh launch
  still showed a brief white screen with no branded splash. That specific
  combination is actually a useful, clean result — the inline background-colour
  fix applies instantly, before any network activity, so a white screen persisting
  through that fix isn't the page rendering at all. It's iOS's own built-in
  fallback for "no startup image matched", happening at the OS level before the
  page starts loading — a different layer entirely from anything the page's own
  CSS can reach.
- Changed all 10 `apple-touch-startup-image` links (and `apple-touch-icon`) from
  relative paths to absolute URLs (`https://lasagneking.github.io/splash/...`) —
  an occasionally-cited fix for this exact mechanism specifically failing to
  resolve relative paths correctly on some iOS versions, despite the same relative
  paths working completely normally for every other resource on the page.
- Re-verified every referenced splash file still exists under the new absolute
  URLs before shipping.
- If this doesn't resolve it: everything checkable from a static-HTML level has
  now been verified correct or tried — file serving, dimensions (3 independent
  sources), tag syntax, required meta tags, FOUC elimination, relative vs. absolute
  URLs, and testing on an actual cold boot. At that point this is a genuine
  platform-level quirk on this specific device/iOS build, not something further
  code changes can reach.
- `index.html` and `sw.js` updated; cache-busting query strings and the service
  worker cache version bumped to `v126`.

## v1.9.1 fixed the white flash on launch
- Follow-up to v1.9.0: on an iPhone 17 Pro Max, the splash mechanism was fully
  verified correct (file serves correctly, dimensions confirmed against three
  independent sources, tag syntax correct) but a brief white screen was still
  appearing on launch. Traced this to a genuinely separate issue.
- Root cause: the dark background only existed in the external `styles.css` file,
  which has to be fetched and parsed before it applies. Until then, the browser
  shows its own default white background — a real gap, however brief, between the
  page starting to load and the stylesheet actually arriving. That gap is what was
  reading as a white flash, independent of whatever is or isn't happening with the
  `apple-touch-startup-image` splash mechanism.
- Fixed by setting the background colour inline in the `<head>`, before the
  external stylesheet link, so it's applied the instant the page starts parsing
  rather than waiting on a network round-trip.
- Confirmed also correctly resolves the also-reported iPhone 17 Pro Max case: it
  shares the exact same 440×956 CSS viewport as the 16 Pro Max (verified against
  three independent sources), so it was already covered by the existing splash
  image — no new device-specific entry was actually needed for it, just this fix.
- Also corrected a stale code comment left over from v1.9.0 that still said the 17
  series was excluded, which was no longer accurate once the shared-dimensions fact
  was confirmed.
- `index.html` and `sw.js` updated; cache-busting query strings and the service
  worker cache version bumped to `v125`.

## v1.9.0 iOS launch splash screens
- Reported: on Android, installing the PWA shows an auto-generated splash screen
  (from the manifest icon); on iOS, "Add to Home Screen" showed nothing at launch.
- Confirmed via current research: unlike Android, iOS Safari still doesn't generate
  a splash screen from the web manifest as of 2026 — it's a known, long-standing gap.
  It needs an exact, pixel-matched PNG per physical device size and orientation,
  declared as a separate `<link rel="apple-touch-startup-image">` per size, matched
  by a media query it won't scale to fit if the numbers are even slightly off.
- Added the two meta tags that actually enable proper standalone-mode behaviour on
  iOS (`apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`) —
  kept alongside the existing modern `mobile-web-app-capable` tag rather than
  replacing it, since not every iOS version in circulation honours the newer
  standard tag yet.
- Generated 10 splash images (portrait only — the app is orientation-locked to
  portrait-primary already) covering iPhone X through the iPhone 16 line: the
  CholScore icon centred on the exact `background_color` from the manifest, so it
  reads as a continuation of the app rather than a separate loading screen.
- Found and fixed a real bug in the source icon while generating these: it has no
  actual alpha transparency (checked directly — alpha channel is 255 everywhere),
  just a flat near-white background baked into the file behind the rounded-square
  shape. Centering it as-is on the dark splash background produced a visible white
  halo. Fixed by colour-keying near-white pixels to transparent before compositing.
  This is very likely also why the existing Android splash "isn't very good" — same
  underlying icon file, same white-background problem — worth a follow-up if you'd
  like that specifically improved too, since I haven't seen your wife's phone's
  actual result to confirm the exact cause there.
- Deliberately left out the very newest iPhone 17 series / iPhone Air — their exact
  CSS-point dimensions weren't confidently verifiable from current sources at the
  time of writing, and a wrong number silently fails a media-query match with no
  visible error. Better to ship a solid, verified range now and extend it once
  those numbers are confirmed than guess.
- Verified all 10 entries three ways before shipping: every referenced file exists
  on disk, every file's actual pixel dimensions exactly match its filename and its
  media query, and the CSS-width × pixel-ratio arithmetic is internally consistent
  for every single entry (e.g. 393×852 at 3x really does equal the 1179×2556 PNG).
- New `splash/` folder added to the service worker's precached app shell, so these
  load offline too, consistent with the rest of the app's assets.
- `index.html` and `sw.js` updated; cache-busting query strings and the service
  worker cache version bumped to `v124`.

## v1.8.1 Cardio progress added to Trends
- Reported: walk/run activities (both cardio) weren't represented anywhere in
  Trends — only Strength progress existed, covering workout exercises only.
- New **Cardio progress** card, directly under Strength progress, mirroring its
  exact structure: pick Walk or Run from a chip row, see a session-by-session chart,
  get a plain-language callout.
- Chart shows **speed**, not raw pace, deliberately — pace is "lower is better",
  which would make an improving trend look like a *decline* on a normal up-right
  chart. Charting speed instead means a rising line always reads as "getting
  faster", the same up-is-better visual language as the Strength chart's rising
  weight line. The callout still describes it in ordinary pace (e.g. "19:14/mi"),
  since that's the familiar way anyone actually talks about running/walking pace —
  only the chart's axis is inverted, not the language.
- Handles all three directions honestly: faster ("3:05/mi faster since 1 Aug"),
  slower ("Pace eased from... to..." — no judgemental framing), and steady,
  with a small dead-zone around exact ties so float rounding can't produce a
  meaningless "0:00 faster" message.
- Only activity types with 2+ logged sessions appear in the picker — same
  threshold as Strength progress and Personal Records — so a single one-off walk
  doesn't produce a meaningless one-point "trend".
- Tested pace-series extraction against a realistic 5-session improving walk (20:00/mi
  down to 16:55/mi) and all three callout branches (faster/slower/steady) before
  shipping.
- `index.html`, `app.js`, and the image cache-busting query strings bumped to `v123`.
- service-worker cache version bumped to `cholscore-v123`.

## v1.8.0 Trends
- New **Calendar / Trends** toggle at the top of the History tab — switches between
  the existing calendar and a new charts view, matching the approved mockup. No new
  bottom-nav tab; it lives where History already lives.
- **Saturated fat** and **CholScore** trend charts over a 7/30/90-day range you pick,
  each a hand-rolled SVG area chart (no charting library — stays lightweight and
  fully offline-safe for the PWA, same principle as the existing progress rings).
  Sat fat chart includes a dashed line at your actual daily target.
- **Strength progress** — the feature I said I'd push hardest for. Pick any exercise
  you've done at least twice from a chip row and see a chart of weight (or hold time,
  for timed exercises) over every session, plus a plain-language callout: "+15.0kg
  since 12 Jun — up from 15.0kg to 30.0kg." Only exercises with 2+ data points appear
  in the picker, sorted by how much history they have.
- Every series computed fresh from `totals()`/`scoreDay()`/the same exercise-scanning
  logic Personal Records already uses — never a separate cache, so it can't drift out
  of sync with the rest of the app.
- Empty states throughout: the whole Trends view stays quiet with a plain message
  until at least one day has ever been logged; the Strength card independently stays
  quiet until some exercise has 2+ sessions, even if sat fat/score data already exists.
- If you're looking at Trends and log something elsewhere, it refreshes automatically
  next render rather than going stale until you manually flip back to it.
- Tested date-key generation (chronological order, correct count), exercise-series
  building (progressive weight capture, single-session exercises correctly excluded
  from the picker), and the chart coordinate math against edge cases — all-zero data,
  a single data point — to confirm nothing produces `NaN`/`Infinity` in the SVG paths.
- `index.html`, `styles.css`, `app.js`, and the image cache-busting query strings
  bumped to `v122`.
- service-worker cache version bumped to `cholscore-v122`.

## v1.7.2 background scroll lock for all dialogs
- Reported: with a dialog open on top (e.g. Exercise tab → "+ Routine"), scrolling
  sometimes scrolled the page underneath instead of the dialog itself, requiring
  scrolling back within the dialog to regain control of it.
- Root cause: native `<dialog>` doesn't reliably stop the page behind it from
  scrolling on mobile Safari — a well-known platform quirk, not specific to any one
  dialog in this app.
- Fixed at the root rather than patching individual dialogs: `showModal()` is now
  wrapped once so **every** dialog in the app is covered automatically, including
  ones added in the future, instead of needing a scroll-lock call added at each of
  the ~16 individual `showModal()` sites throughout the app.
- Uses the standard mobile-safe technique — `position:fixed` on `<body>` with the
  scroll position preserved via `top` and restored via `window.scrollTo()` on close
  — rather than plain `overflow:hidden`, which is the part that doesn't actually
  work reliably on iOS Safari.
- Cleanup listens for the dialog's native `close` event (captured, since `close`
  doesn't bubble) so it correctly unlocks regardless of *how* the dialog closed —
  Esc key or a form submit included, not just an explicit `.close()` call.
- Handles stacked dialogs correctly via an open-counter: if a dialog is opened from
  within another dialog, the lock stays engaged until the last one actually closes,
  not the first. Verified this exact scenario (open → nested open → nested close →
  outer close) before shipping, since it's the case most likely to get the count
  wrong.
- `index.html`, `styles.css`, `app.js`, and the image cache-busting query strings
  bumped to `v121`.
- service-worker cache version bumped to `cholscore-v121`.

## v1.7.1 fixed celebration dialogs appearing off-screen
- Reported: the walk/run completion card sometimes appeared scrolled above the
  visible viewport, requiring a scroll up to see it — most noticeable on the first
  activity logged in a session, right after scrolling down the Exercise tab to reach
  the Quick Activity buttons.
- Root cause, found by auditing every custom celebration dialog's CSS: three of the
  four never actually had working `position:fixed` centering, so they fell back to
  rendering wherever the page's current scroll position happened to place them
  rather than staying pinned to the viewport:
  - `.exercise-complete-modal` and `.activity-complete-modal` (the walk/run medal
    card) only ever had `position:relative` — no fixed/centered positioning was set
    at all.
  - `.premium-workout-result` (the main end-of-workout screen) actually did have
    `position:fixed` — but a second, contradictory `position:relative` later in the
    exact same CSS rule silently won and overrode it. This one's been quietly broken
    since it was first styled; it just hadn't been reported yet because it wasn't
    always visible from the page's default scroll position.
  - `.checkout-premium` (the daily checkout dialog) was the only one written
    correctly from the start, which is exactly why it was never reported.
- Fixed by making all three match the one dialog that was already correct: a single,
  unambiguous `position:fixed;inset:0;margin:auto`, so every completion dialog is
  now always centered in the viewport regardless of where the underlying page
  happens to be scrolled.
- `index.html`, `styles.css`, and the image cache-busting query strings bumped to
  `v120`.
- service-worker cache version bumped to `cholscore-v120`.

## v1.7.0 Staples — quick add for repeat foods
- New "Staples" row on the Food tab, between the barcode scanner and today's food
  list: a horizontally-scrolling set of cards for foods logged repeatedly, each a
  single tap to re-add to today.
- Computed fresh from `state.days` every time — same principle as Personal Records
  and the Day Report — so it's always accurate and needs no separate storage. Only
  foods logged **twice or more** qualify; a one-off entry isn't a staple. Grouped by
  name + brand, case-insensitively, so "Chicken breast" and "chicken breast" count
  as the same staple rather than splitting into two.
- Each card carries over the food's most recently logged nutrition values (sat fat,
  protein, brand, image, amount) and defaults to whichever meal that food is most
  often logged under — e.g. Greek yoghurt logged 6 times at breakfast defaults to
  Breakfast automatically, no meal picker needed for the common case.
- Deliberately no confirmation dialog on tap — it lands straight in today's food
  list, visible immediately as feedback. If it's ever wrong, the existing tap-to-view
  → delete flow on any logged food already covers correcting a mistake, so no new
  undo mechanism was needed.
- Section stays hidden entirely until there are at least two qualifying staples, so
  new accounts still see the same clean "no food logged today" state as before.
- Tested the grouping/threshold/meal-mode logic directly (6× breakfast yoghurt →
  correctly surfaces with Breakfast default; 3× chicken breast across mixed
  meals/casing → correctly merges and picks the majority meal; 1× pizza → correctly
  excluded) before shipping.
- `index.html`, `styles.css`, `app.js`, and the image cache-busting query strings
  bumped to `v119`.
- service-worker cache version bumped to `cholscore-v119`.

## v1.6.1 personal bests flagged in the Day Report
- Personal bests now show up directly in History's Day Report, right next to the
  exercise or activity that set them — a gold "🏆 PR" chip on the exercise/activity
  name, plus the whole row gets a gold left-border and background wash so it's
  genuinely easy to spot while scanning down a day, not just a small icon easy to miss.
- Cardio rows also mark the specific stat that was the record (distance, pace, or
  both) with a small 🏆 next to that column's label, since a walk/run can set one,
  the other, or both at once.
- Flagging works by matching the day being viewed **and** the exact value against
  the current all-time record for that exercise/activity — so it only lights up on
  the day the record actually happened, not on every subsequent viewing of an
  exercise that merely exists. Tested against two days (one that set a Bench Press
  and Planks PR, a later weaker day for the same exercises) to confirm the flag
  appears only where it should.
- Reuses the same `computePersonalRecords()` from v1.6.0 — one records lookup per
  report, so this stays free and can't drift out of sync with the Rewards tab's
  Personal Records list.
- `index.html`, `styles.css`, `app.js`, and the image cache-busting query strings
  bumped to `v118`.
- service-worker cache version bumped to `cholscore-v118`.

## v1.6.0 Personal Records
- New PR tracking across strength, timed, and cardio (walk/run, as scoped) —
  heaviest weight and longest hold per exercise name, fastest pace and longest
  distance per activity type.
- **New PR badges** now appear on the exercise-complete card and the walk/run medal
  card the moment a record is actually broken — gold pill, "🏆 New PR — heaviest
  Bench Press: 20.0 kg", reusing the same gold/glow language already established for
  medals and the final-exercise variant. Both distance and pace can trigger together
  on the same walk/run if it's both farther and faster than before.
- **New Personal Records section on the Rewards tab**, above the achievement
  browser — one row per record, sorted by best-first, each showing the value and the
  date it was set. Shows a plain-language empty state until the first record exists.
- PRs are computed fresh from `state.days` every time rather than cached, so they
  can never drift out of sync with actual history — same principle as the Day Report.
  A brand-new exercise's first-ever completion counts as a PR (it genuinely is your
  best so far) — flagging this in case you'd rather that stayed quiet until a second
  attempt beats it.
- Pace comparisons happen in unit-agnostic minutes-per-km internally, so a PR
  recognised while using miles stays correctly recognised if the distance unit
  setting is ever changed later — only the display formatting is unit-aware.
- Tested PR detection (heavier beats lighter, lighter doesn't trigger, first-ever
  counts, combined distance+pace PRs, no-PR case) and the Rewards list rendering
  (populated and empty states) against real sample data before shipping.
- `index.html`, `styles.css`, `app.js`, and the image cache-busting query strings
  bumped to `v117`.
- service-worker cache version bumped to `cholscore-v117`.

## v1.5.1 export now targets real off-device destinations
- Correction to v1.5.0: as first shipped, "Export backup" only ever saved the file
  to the same phone's Downloads/Files — which doesn't actually protect against
  losing that phone, the exact scenario this feature was for.
- Export now tries `navigator.share()` with the backup file first, wherever the OS
  supports sharing files (iOS Safari, Android Chrome). That hands the file straight
  to the native share sheet — iCloud Drive, Google Drive, email, Messages, AirDrop —
  genuine off-device destinations, rather than just Downloads.
- Falls back to the previous plain-download behaviour only where file-sharing isn't
  supported (desktop browsers, very old mobile browsers) — and now shows a reminder
  afterwards to move the file off the device manually in that case.
- Cancelling the share sheet is handled as a cancellation, not an error: no
  redundant fallback download fires, and "Last backup" doesn't update, since nothing
  was actually saved anywhere.
- Settings now says outright, before you even tap Export, that the file only
  protects you once it's somewhere other than this phone.
- Tested all four code paths (share succeeds / share cancelled / share unsupported /
  `File` constructor unsupported) before shipping.
- `index.html`, `styles.css`, `app.js`, and the image cache-busting query strings
  bumped to `v116`.
- service-worker cache version bumped to `cholscore-v116`.

## v1.5.0 Backup & Restore
- Everything in CholScore lives only in this device's `localStorage` — losing the
  phone, clearing site data, or a browser/OS update gone wrong would otherwise mean
  losing everything with no way back. Added a proper Export/Import to Settings.
- **Export backup**: downloads a JSON file (`cholscore-backup-YYYY-MM-DD.json`)
  containing the entire state — profile, every logged day, all routines, workout
  history, achievements. Works the same way on iOS Safari and Android Chrome (both
  hand it to the device's normal "save/share file" flow — no server involved, since
  this is a fully static app).
- **Restore from backup**: reads a previously exported file back in. Reuses the
  app's own `normaliseState()` — the exact same function that runs every time the
  app loads — so a restored backup gets the same defaulting/migration safety net as
  normal data, and old exports stay restorable even after future updates change the
  data shape.
- Validates the file before touching anything: rejects anything that isn't
  recognisable as CholScore data (tested against garbage JSON, arrays, and other
  nonsense) before ever asking to proceed, and requires an explicit confirmation
  naming the backup's export date before overwriting current data. Also accepts a
  raw (unwrapped) state dump, not just the full export format, in case anyone's
  hand-editing files.
- Settings now shows **"Last backup: N days ago"** (tracked locally, separate from
  the data itself), nudging towards another backup once it's been a couple of
  weeks — the low-effort version of a backup reminder, without adding a persistent
  banner elsewhere in the app.
- Verified the full export→import round trip against real sample data (profile,
  a logged day with food/activities, a routine, achievements) before shipping —
  every field survives intact, including things like food IDs that must NOT get
  regenerated on restore.
- `index.html`, `styles.css`, `app.js`, and the image cache-busting query strings
  bumped to `v115`.
- service-worker cache version bumped to `cholscore-v115`.

## v1.4.1 iOS zoom fix + Rewards legibility
- **Fixed the iOS Safari auto-zoom on focus.** Root cause: `<input>`/`<select>` use
  `font:inherit` and every one of them sits inside a `<label>` styled at 14px —
  under Safari's 16px no-zoom threshold, so focusing *any* field zoomed the whole
  page. Fixed once at the shared `input,select{}` and `textarea{}` rules rather than
  patching individual fields, so it's fixed everywhere at once and can't regress if a
  new field gets added later without an explicit font-size.
  Deliberately did **not** use `user-scalable=no`/`maximum-scale=1` on the viewport
  meta tag — that "fixes" the same symptom but disables pinch-zoom entirely, which
  is a real accessibility regression for anyone who needs it. Keeping fields at 16px
  is the correct fix, not a workaround.
- **Bumped Rewards tab text sizes.** The main offender: achievement descriptions
  were full sentences rendered at 10px. Bumped to 12px with more line-height and a
  taller card to fit. Also nudged up the card title, category tabs, category
  summary, unlocked/locked state text, and the rarity badge — smaller, supporting
  bumps so the size hierarchy still holds together rather than everything becoming
  the same size.
- Left the short uppercase "eyebrow" labels (SETS, WEIGHT, DISTANCE, etc.) alone
  throughout the app — those are a deliberate small-caps label convention, not a
  readability miss, and bumping them would blur the hierarchy between labels and
  the values they describe.
- `index.html` and the styles.css cache-busting query string bumped to `v114`.
- service-worker cache version bumped to `cholscore-v114`.

## v1.4.0 Day Report + pulsing exercise days
- Tapping any date on the History calendar (past or present) now opens a full-screen
  Day Report — a "sports report" style recap, matching the approved mockup.
  Deliberately breaks from the rest of the app's dark navy/purple scheme on purpose:
  near-black background, a single cyan accent (matches the calendar's own `--cyan` so
  it still feels part of the same product), angled broadcast-graphics style dividers.
- Sections: date hero with a scoreboard-style CholScore readout (counts up on open),
  a Rings recap (sat fat/minutes/score, same draw-in animation as elsewhere), Strength
  Session (numbered like a team sheet — sets/reps/volume, or time held for timed
  exercises, one section per workout logged that day), Cardio (results-table style:
  time/distance/pace per walk or run), and Nutrition (protein as the hero stat, a
  sat-fat progress bar, then the full food list — no images, as asked). Empty
  sections show a quiet "No X logged this day" line rather than being hidden, so the
  report always reads as complete.
- Sections cascade in as you scroll (IntersectionObserver-driven fade/slide), rather
  than all appearing at once.
- Implemented as a genuine full-viewport `<dialog>` (not a small modal), so it gets
  Esc-to-close and top-layer stacking for free, consistent with how every other
  overlay in the app works.
- Built entirely from existing data functions (`totals`, `scoreDay`, `exerciseVolume`,
  `formatActivityDuration`, `formatPace`, `distanceUnit`/`kmToDisplay`) — verified
  against real sample data (workout + walk + food day, and an empty day) before
  shipping, so the report is guaranteed to agree with the rest of the app rather than
  recalculating things its own way.
- Calendar days with any exercise logged (workout, walk, run, or one-off) now get a
  pulsing cyan ring instead of just the plain dot, so active days are easy to spot at
  a glance across a whole month.
- Respects `prefers-reduced-motion` throughout (report entrance, ring fills, section
  reveals, and the calendar pulse all disable cleanly).
- `index.html`, `styles.css`, and the image cache-busting query strings bumped to `v113`.
- service-worker cache version bumped to `cholscore-v113`.

## v1.3.0 walk/run completion card
- Replaced the native browser `alert()` ("Great work, Bill! 125 minutes completed.")
  that fired after logging a quick Walk or Run with a proper on-brand card, matching
  the approved mockup. "One-off" activity logging is untouched — still the plain
  alert, as scoped.
- Gold medal on a ribbon is the signature element: gently swings side to side like
  it's hanging around your neck, with a light sweep animation passing across it. A
  small 🚶/🏃 badge on the medal's corner shows which activity it was — same medal
  theme for both rather than two different designs.
- Distance is the "contrast" stat: shown in its own gold-tinted, slightly larger
  card, and used to derive a **pace** stat (min per mile/km) alongside duration —
  the useful number duration alone can't tell you. Falls back to Duration + Feeling
  when distance is left blank, since it's an optional field on the form.
- Message is one combined sentence: "You walked 6.5 mi in 2h 5m — averaging a
  19:14/mi pace. Feeling great 😄."
- Reuses the existing `distanceUnit()`/`kmToDisplay()` helpers, so it correctly
  respects the user's mi/km preference.
- Reuses the `seedStarField()` helper (factored out this release) for its
  twinkling star background, same as the checkout and exercise-complete cards.
- Respects `prefers-reduced-motion`.
- `index.html`, `styles.css`, and the image cache-busting query strings bumped to `v112`.
- service-worker cache version bumped to `cholscore-v112`.

## v1.2.0 exercise-complete card redesign
- Redesigned the "exercise complete" card that appears after every exercise (all 3
  variants — standard/weighted, timed, and the final one leading into the workout
  result), matching the app's existing dark theme and following the same visual
  family established for the daily checkout and workout-complete screens.
- Bigger card throughout: wider dialog, larger heading, bigger icon badge, more
  generous stat-card padding.
- Each variant gets its own animated icon badge instead of a static 💪 emoji:
  💪 flexes gently for standard weighted exercises, ⏱️ ticks side to side for timed
  ones, 🏆 sparkles gold for the final exercise of the workout, foreshadowing
  the workout-result screen — each with a matching glow-scene background tint
  (green/cyan/gold) and a twinkling star field, all built from the app's own colour
  tokens rather than external images.
- Stat cards (Sets/Weight/Volume or Sets/Total Time/Best Set) fade and slide in with
  a stagger, and the numeric ones (weight, volume, total time, best set) count up
  from zero over ~650ms rather than just appearing — reuses the existing
  `formatExerciseSeconds` helper so timed values are formatted exactly as before.
- Removed the old static "✦ · ✧ · ✦" sparkle text row and the old flat 💪 emoji in
  favour of the animated icon badge + star field.
- Respects `prefers-reduced-motion` (animations disabled, content shown in its final
  state immediately).
- `index.html`, `styles.css`, and the image cache-busting query strings bumped to `v111`.
- service-worker cache version bumped to `cholscore-v111`.

## v1.1.0 daily checkout redesign
- Replaced the basic "Nice work, Bill!" checkout dialog with a redesigned summary
  matching the approved mockup: opens anchored to the top of the screen (was
  centred), bigger card, a layered CSS glow + twinkling star-field background
  (no external/stock image — built from the app's own `--green`/`--cyan`/`--violet`
  tokens so it can't clash or break if a link dies), with the headline and message
  sitting in a frosted glass panel for legibility over the busier background.
- Three animated rings (sat fat, minutes, score) fill in with a stagger on open, each
  gaining a checkmark badge that pops in once its ring finishes — real data from
  `totals()`/`scoreDay()`, not placeholders. Sat-fat ring shows amber instead of green
  on days you've gone over target.
- Message is now one combined, dynamically-built sentence in the style you asked for:
  "You stayed within your Xg saturated fat limit (Yg consumed) and exercised for N
  minutes, earning you a super score of NN." Falls back to gentler phrasing on
  over-target days, consistent with the app's existing non-judgemental tone.
- "Share achievement" is now functional — uses the native share sheet
  (`navigator.share`) where available, otherwise copies a text summary to the
  clipboard with a brief confirmation.
- Old unused `#checkoutScore`/`.checkout-score` markup removed from the dialog (the
  score now lives in its ring instead); the `.checkout-score` CSS rule was left in
  place unused rather than risk touching something shared elsewhere.
- Respects `prefers-reduced-motion` throughout.
- `index.html`, `styles.css`, and the image cache-busting query strings bumped to `v110`.
- service-worker cache version bumped to `cholscore-v110`.

## v1.0.3 debug removed
- Confirmed via the v1.0.2 diagnostic: the "—" was correct behaviour, not a
  calculation bug — the affected exercise genuinely had `weight:0` stored against it
  (stale/legacy data on one pre-existing exercise). Re-adding that exercise fixed it.
- `#finishVolumeDebug` element and its wiring in `showWorkoutCelebration` removed —
  the completion screen is back to just the two stat cards.
- The `Number.isFinite` hardening and the `completeCurrentExercise` fix from v1.0.2
  are kept, since they're good practice regardless.
- `index.html`, `styles.css`, and the image cache-busting query strings bumped to `v103`.
- service-worker cache version bumped to `cholscore-v103`.

## v1.0.2 volume-zero diagnostic (temporary)
- Reported: "Total Weight Lifted" sometimes shows "—" on the completion screen even
  though every exercise had a weight entered, all came from the saved routine, and
  the workout duration is correct.
- Code review + isolated testing of `workoutVolume`/`exerciseVolume`/
  `resolvedWorkoutWeight` against realistic and deliberately-corrupted data could not
  reproduce a zero total under those conditions — the weight-resolution and
  reps-completion logic is deterministic, so if weight displays correctly mid-workout
  it must resolve the same way at the finish screen.
- Hardened `resolvedWorkoutWeight`/`exerciseVolume`/`workoutVolume` with explicit
  `Number.isFinite` guards throughout (defensive, doesn't rely on NaN comparisons
  quietly working) and fixed `completeCurrentExercise` calling `exerciseVolume`
  without the workout context (a real, separate inconsistency).
- Added a **temporary on-screen diagnostic**: `#finishVolumeDebug`. If the total is
  ever 0 while the workout has exercises, a small dashed box appears under the stat
  cards printing each exercise's exact weight, timed flag, and per-set
  completed/actual values — no browser dev tools needed. Screenshot it next time this
  happens and that'll pinpoint the exact cause. Safe to delete once resolved.
- `index.html`, `styles.css`, and the image cache-busting query strings bumped to `v102`.
- service-worker cache version bumped to `cholscore-v102`.

## v1.0.1 continuous confetti loop
- The v1.0.0 burst only ran once (~2s) and then stopped. Confetti now trickles
  continuously — 4 new pieces every 220ms — for as long as the completion screen
  is open.
- Each piece removes itself from the DOM right after its own fall animation
  finishes, so the piece count stays small and constant rather than growing forever.
- The loop is tied to the dialog's native `close` event, so it stops the instant the
  screen closes however that happens (Done button, cancel workout, Esc key) — nothing
  keeps running in the background.
- `index.html`, `styles.css`, and the image cache-busting query strings bumped to `v101`.
- service-worker cache version bumped to `cholscore-v101`.

## v1.0.0 fully animated confetti burst
- Removed the confetti diamond and star shapes that were baked into
  `workout-victory-silhouette.png` (cleaned out with inpainting) — the artwork is now
  a plain silhouette with no static decoration on it.
- Removed the old static, non-animated `.premium-confetti` dots that sat behind the
  title.
- Replaced both with a single animated confetti burst (`#confettiBurst` /
  `spawnConfetti()` in app.js): ~34 randomly coloured, sized, and timed pieces are
  generated fresh each time `showWorkoutCelebration()` runs, and fall/rotate/fade via
  a `confettiFall` CSS keyframe.
- Palette matches the app's existing purple/gold/pink/cream/cyan accents.
- Respects `prefers-reduced-motion`: confetti pieces stay invisible instead of animating.
- `index.html`, `styles.css`, and the image cache-busting query strings bumped to `v100`.
- service-worker cache version bumped to `cholscore-v100`.
