CholScore v1.25.0 - Removed random-exercise button, added in-workout note editing

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

## v1.25.0 removed random-exercise button, added in-workout note editing
Both from direct tester feedback.

- **Removed "Add a random exercise"** from the live workout screen entirely —
  button, its whole dialog, the submit handler, and its now-unused CSS.
  Deliberately left the "added today" badge display logic in place rather
  than ripping it out too, since any exercise already saved with that flag
  from before this change should still render correctly — removing the
  *ability to create new ones* doesn't require breaking the display of old
  ones.
- **Exercise notes can now be added or edited mid-workout**, not just when
  editing a routine beforehand — a small "✎ Add/Edit exercise note" link at
  the bottom of each exercise card, using the same lightweight `prompt()`
  pattern already established for the in-workout weight adjuster, rather than
  building a whole new dialog for it.
- The actual point of the feature: a note added mid-workout is saved back to
  the routine's own exercise definition, not just this session — so it's
  there next time too, rather than needing a separate trip into editing the
  routine afterward. Tested this directly rather than assumed it: confirmed
  both the live session and the routine itself update correctly, confirmed
  cancelling the prompt changes neither, confirmed a whitespace-only note
  correctly clears rather than saving as a phantom space, and confirmed an
  exercise with no matching routine source (e.g. old data) still updates the
  live session safely without touching a routine it can't find, rather than
  crashing.
- `index.html`, `styles.css`, `app.js`, `sw.js`, and all cache-busting query
  strings (including `APP_VERSION`) bumped to `v165`.

## v1.24.0 100 achievements, up from 56
- Requested via an uploaded spreadsheet listing all 100 achievements, with the
  44 new ones highlighted — verified programmatically that the highlighted
  rows matched exactly against what's new versus the existing 56 (down to the
  achievement, not just the count) before writing a single line, rather than
  assuming the spreadsheet and the live app agreed.
- 41 of the 44 new achievements mapped directly onto metrics that already
  existed (points, on-target days, workout count, sets, food entries,
  scanned foods, personal records, lifetime weight, lifetime distance,
  combined weekly distance) — just new threshold tiers. Checked every new
  threshold against every existing one per metric first to rule out an
  accidental duplicate goal.
- 3 new metrics added for real: weekly workout count, the number of distinct
  calendar weeks with at least one workout (`52 Week Warrior` — 52 different
  weeks, not 52 consecutive), and combined lifetime walk+run distance. All
  three tested directly with realistic multi-week data before shipping.
- Distance-based achievements needed no separate km/mile text at all — the
  existing display system already swaps "mile(s)" for "kilometre(s)" in both
  the title and description automatically, purely from the metric name
  containing "miles". Verified this directly against several of the new
  achievements in both unit settings, including one with the word "mile"
  appearing twice in its own flavour text, and one where the swap correctly
  changes the title itself ("Forty Mile Week" → "Forty Kilometre Week").
- Every new achievement categorised to match the app's existing section
  conventions exactly (checked precedent first rather than guessed) — so they
  file correctly under the existing Food/Workout/Walking/Running/This
  Week/Consistency/CholScore tabs already in the Achievement Collection
  screen, not a new sectioning system.
- Icons chosen with reasonable judgement per the achievement's theme,
  explicitly starting points rather than final choices — happy to revisit
  any that don't feel right once seen in the app.
- Confirmed zero duplicate IDs or titles across all 100, and confirmed every
  achievement-count display in the app (progress ring, category summary,
  "X still waiting to be unlocked") reads its total directly from the
  achievement list's own length rather than a hardcoded number, so nothing
  else needed updating to reflect the new total.
- Final distribution: 25 Common, 25 Rare, 20 Epic, 18 Legend, 12 Mythic.
- `index.html`, `styles.css`, `app.js`, `sw.js`, and all cache-busting query
  strings (including `APP_VERSION`) bumped to `v164`.

## v1.23.3 removed unintended blue focus outline on dialogs (needs device confirmation)
- Reported: a blue border tracing the full screen edge on the Exercise
  Complete screen specifically, reproducible every time, not present on
  similar screens, and confirmed not related to any phone setting.
- First guess (an iOS accessibility feature like Guided Access) was wrong and
  said so directly rather than defended it — the border didn't match anything
  in the app's own CSS, but "not in my code" isn't the same as "not caused by
  my code," and that distinction got missed the first time.
- Investigated properly on the second pass: found that none of the app's ~18
  dialogs ever suppress the browser's default focus outline — `outline:none`
  exists in exactly two places in the whole stylesheet, both on form inputs,
  never on a dialog. Confirmed directly (not assumed) that `showModal()`
  genuinely moves focus onto the dialog element itself by checking
  `document.activeElement`.
- Couldn't fully reproduce the visible bug in this sandbox's testing browser
  (Chromium), and said so rather than claiming false certainty — Chromium's
  `:focus-visible` implementation specifically suppresses that default
  outline for non-keyboard-triggered focus, while Safari has historically been
  less consistent about that exact distinction, which is a known, documented
  cross-browser gap and a plausible, well-reasoned explanation rather than a
  fresh guess. Attempted to install a real WebKit browser engine specifically
  to test this directly rather than continue reasoning about it secondhand;
  blocked by this sandbox's own network restrictions, not something to paper
  over.
- Fix: one shared `dialog{outline:none}` rule covering every dialog in the app
  at once, rather than guessing which specific one needs it. Safe to ship
  regardless of the exact mechanism — removing an unintended default outline
  can't break anything else.
- Flagged honestly rather than marked resolved: shipped for real-device
  testing specifically because Safari-specific behavior couldn't be verified
  directly from here.
- `index.html`, `styles.css`, `app.js`, `sw.js`, and all cache-busting query
  strings (including `APP_VERSION`) bumped to `v163`.

## v1.23.2 fixed the same Dynamic Island overlap on all celebration screens
- Reported on the Workout Complete screen specifically — the star badge at the
  top getting caught in the Dynamic Island, same symptom as the header fix
  from the previous release.
- Given that fix turned out to be a pattern (two separate spots had the exact
  same gap last time), swept the rest of the app properly rather than patching
  only the one screen reported: found the identical fixed-padding-with-no-
  safe-area-inset issue in five more places across three related celebration
  screens — `.premium-workout-result` (the one reported, with fixes needed at
  *three* separate breakpoints, not just one), `.acm-content` (the walk/run
  completion screen), and `.ecm-content` (the single-exercise completion
  screen) — each with their own base rule and mobile breakpoint override that
  both needed the same fix.
- Also checked the daily checkout celebration screen specifically, since it's
  the same category of screen — confirmed it already correctly uses
  `top:max(14px, env(safe-area-inset-top))` and needed no change.
- Same fix throughout: add the device's actual safe-area inset on top of the
  existing padding rather than replace it, so phones with no notch or Dynamic
  Island render identically to before and only the devices that actually need
  more clearance get it.
- `index.html`, `styles.css`, `app.js`, `sw.js`, and all cache-busting query
  strings (including `APP_VERSION`) bumped to `v162`.

## v1.23.1 fixed header overlapping the status bar on Dynamic Island iPhones
- Reported on an iPhone 17 Pro Max, working fine on Android: the new profile
  photo overlapped the battery indicator.
- Real cause, and not new: `.app-header` has always used a fixed `34px` top
  padding rather than accounting for the device's actual safe area. `env(
  safe-area-inset-top)` was already used correctly in five other places in
  this app — the routine form, the live workout and scanner shells, a floating
  banner, and dialog close buttons — but the one thing visible on literally
  every screen never got the same treatment. A small 42px gear icon sitting
  slightly into that zone was easy to miss; an actual photo with real visual
  detail made it obvious immediately.
- Fixed by adding the device's safe-area inset on top of the existing 34px
  rather than replacing it — `calc(34px + env(safe-area-inset-top))` — so
  devices with no notch or Dynamic Island (older iPhones, Android, desktop)
  render identically to before, and only devices that actually need more
  clearance get it.
- Checked for the same pattern elsewhere rather than assuming this was the
  only spot: found onboarding had the identical gap (fixed `70px`, no safe
  area accounted for) and fixed it the same way. Checked the Day Report's
  full-screen dialog too — its close button already handles this correctly on
  its own, and the content beneath it wasn't showing any actual problem, so
  left that one alone rather than making a speculative change with no
  evidence behind it.
- `index.html`, `styles.css`, `app.js`, `sw.js`, and all cache-busting query
  strings (including `APP_VERSION`) bumped to `v161`.

## v1.23.0 profile photo, replacing the plain gear icon
- Requested and mocked up first: a user-chosen photo in the header, tapping it
  still opens Settings exactly like the gear icon always has, selectable
  during first-time setup or added later from Settings for existing users.
- Sizing wasn't guessed — pushed on directly ("is that really big enough to
  make out anything"), so before committing to a size I built a fairer test
  than the first mockup's flat, artificially high-contrast placeholder: a
  synthetic face with actual eyes/nose/mouth, compared at 46/56/64/72px side
  by side at real 3x device resolution. Confirmed 46px was workable but tight,
  and that a real photo would likely read worse than even that test given how
  much softer real tonal contrast is — landed on 60px in the header (72px in
  the larger Settings preview) with room to spare in the layout either way.
- New default state for anyone without a photo set: initials on the app's own
  green-to-cyan gradient, live-updating in onboarding as the name is typed,
  rather than a generic placeholder silhouette — still feels personal before
  a photo's ever been added.
- Photos are resized and centre-cropped to a small square via canvas before
  being stored — 240px, 2x the largest place it's shown, for retina sharpness
  without saving whatever multi-megabyte original the camera actually
  produced. Verified the real pipeline end-to-end in an actual browser (not
  just reasoned about it): fed it a deliberately non-square 1200×1600 test
  photo, decoded the real output, and confirmed it came back a true 240×240
  square with no stretching or distortion, at roughly 2KB — comfortably small
  for local storage.
- Also tested the initials fallback across edge cases directly: correct
  capitalisation, correct "?" fallback for an empty or missing name, a photo
  correctly taking priority over initials when both exist, and confirmed the
  name gets safely escaped rather than trusted raw, even against a
  deliberately malicious input.
- One thing flagged transparently rather than assumed: a large grey circle
  visible in the original reference screenshot didn't match anything in the
  actual codebase (the existing button there was a plain 42px gear icon in a
  different row entirely from what it appeared to overlap) — built to the
  clear intent of the request regardless, on the working theory that circle
  was an unrelated artifact rather than a real app element.
- `index.html`, `styles.css`, `app.js`, `sw.js`, and all cache-busting query
  strings (including `APP_VERSION`) bumped to `v160`.

## v1.22.0 Vacation Mode for streak achievements
Prompted by a genuinely good fairness question: is it right that illness or a
holiday can wipe out months of progress toward a streak-based achievement like
the Mythic 365-day one? Agreed it's worth softening, on one condition raised
directly: no free progress. Paused days protect the streak from breaking, but
they never count toward it either — any missed time still has to be made up
with real checked-out days afterward, matching the compromise landed on
together rather than either extreme (a purist no-exceptions streak, or a
loophole that trivializes it).

- New "Vacation Mode" section in Settings — a simple on/off toggle, no date
  range picker to fuss with. Turning it on lets you back-date the start up to
  7 days, since if you're properly ill you might not open the app at all for
  the first few days and would only think to flip it once you're back.
- Deliberately no cap on how often it's used, per direct instruction — since
  it only pauses the clock and never grants credit, there's no actual benefit
  to overusing it, so no limit was needed to keep it honest.
- Touches both places a streak gets calculated, not just the achievement:
  `calculateStreak()` (the live streak counter shown elsewhere in the app) and
  the `bestStreak` metric that every streak achievement — including the
  Mythic one — is measured against. A paused day is invisible to both: it
  can't break a run in progress, but it's also simply never counted as one of
  the days needed to reach a goal.
- Found and fixed a real bug in my own first implementation before it ever
  shipped: my initial version let a skipped vacation day consume the "today
  might not be checked out yet" leniency meant for the very next real day
  examined, which would have subtly mis-counted the live streak. Caught this
  by actually running the calculation, not by reading the code back.
- Verified thoroughly with the exact scenario described — 10 real days, a
  multi-day illness gap, then 8 more real days — confirming the streak
  correctly bridges to 18 only when every single gap day is genuinely covered
  by Vacation Mode, and correctly breaks and resets if even one gap day isn't
  covered, which is the honesty check the whole feature depends on. Also hit
  a bug in my own *test* along the way (a date range that was one day short of
  the actual gap) and want to be upfront that it was a test-authoring mistake,
  not a rerun of the same application bug.
- `index.html`, `styles.css`, `app.js`, `sw.js`, and all cache-busting query
  strings (including `APP_VERSION`) bumped to `v159`.

## v1.21.0 fixed a foundational BST timezone bug in week/day boundaries
This turned out to be much bigger than the original report — a genuine,
long-standing bug affecting week and day boundaries throughout the whole app
for anyone in a positive UTC offset timezone (the UK during BST specifically,
which is in effect right now), not something specific to the Reports feature.

- Reported: "Last 4 weeks" showed less total distance than "This week" alone —
  mathematically only possible if the aggregate was missing data. Ruled out a
  timing/staleness explanation directly (confirmed it persisted across a full
  app restart on a real device), which meant it was a genuine calculation bug,
  not two screenshots taken at different moments.
- Traced it to its actual root, not just patched the symptom: `mondayKeyFor()`
  forces its calculation to *local* midnight, then converts to a UTC string
  via `.toISOString()`. Local midnight in BST (UTC+1) is 23:00 UTC the
  *previous* day — so the returned date was wrong by one day, and verified
  directly this happens at literally every hour, not just near a real
  midnight boundary.
- The monthly report's loop made this worse by re-applying `mondayKeyFor()` a
  second time to its own already-wrong output. Since that string didn't
  actually land on a real Monday, the second application snapped it backward
  again — compounding a 1-day bug into what looked like an entire missing
  week. Reproduced this exact compounding mechanism directly against the
  screenshots sent (`Jul 19 / Jul 26 / Aug 2 / Aug 9` — precisely the four
  wrong weeks shown) before writing a single line of the fix.
- Checked how widespread the underlying pattern was rather than fix just the
  one function: found the identical `.toISOString().slice(0,10)` idiom in
  seven places total, including `todayKey()` — used everywhere in the app to
  decide which calendar day food and exercise get logged under — and the
  streak calculator. Fixed all seven with one shared, properly timezone-safe
  `localDateKey()` helper (reads year/month/day directly from local time,
  never converts through UTC) rather than patching each spot slightly
  differently.
- Verified the fix directly against the exact scenarios that exposed the bug:
  `mondayKeyFor()` now returns the correct Monday at every hour of the day,
  the monthly loop now correctly lands on the real current week instead of
  compounding backward, and the narrower midnight-boundary window that
  `todayKey()` was separately exposed to is also confirmed correct.
- Worth knowing: this only fixes date-key computation going forward. Anything
  logged in the narrow ~1-hour window right after local midnight before this
  fix may have been filed under the previous day — a much smaller and
  narrower concern than the week-boundary bug, and nothing to actively fix
  retroactively, but flagging it for transparency.
- `index.html`, `styles.css`, `app.js`, `sw.js`, and all cache-busting query
  strings (including `APP_VERSION`) bumped to `v158`.

## v1.20.1 added total distance to Weekly/Monthly Reports
- Requested after approving v1.20.0: reports were missing total distance
  walked/run.
- Added combined walk+run distance tracking to `weekSummary()`, converted at
  render time through the app's existing `kmToDisplay()`/`distanceUnit()`
  functions so it correctly respects each user's mi/km preference — verified
  both units directly rather than assumed, including catching a false alarm
  in my own test check (a sloppy string match against " mi" that was actually
  just matching the start of the word "minutes").
- Added as a 5th stat card spanning the full width of the 2-column grid,
  rather than leaving an awkward half-empty row — new `.full-width` and
  `.amber` utility classes, reusing the existing `--amber` palette token
  rather than referencing an undefined color.
- Rendered real proof screenshots for both the weekly and monthly views with
  mixed walk/run data before shipping, confirming the total sums correctly
  across activity types and the new card sits cleanly below the existing grid.
- `index.html`, `styles.css`, `app.js`, `sw.js`, and all cache-busting query
  strings (including `APP_VERSION`) bumped to `v157`.

## v1.20.0 on-demand Last Week tab, tense-aware and highlight-rich reports
Rethought the Weekly/Monthly Report after stepping back to look at it properly:
the once-a-week popup was replaced with an on-demand tab, since a report that's
always sitting there to check whenever you want beats one that interrupts you
once and is gone.

- **New "Last week" tab, shown first** — Reports is now a 3-way toggle: Last
  week / This week / Last 4 weeks. All available any time, no waiting for
  Monday.
- **Auto-popup removed entirely** — the dialog, its trigger check, and the
  state field tracking which week you'd last seen are all gone. Confirmed zero
  dangling references left behind rather than just deleting the obvious parts.
- **Fixed a real tense bug, not just reworded copy**: "This week" was
  previously scored out of a fixed 7 days even while the week was still in
  progress, meaning Tuesday would show "1 of 7 days on target" — technically
  true but reads like a failing grade for a week that's barely started. Now
  uses days-elapsed as its own denominator, the title switches from "in
  review" to "so far," and the message shifts to forward-looking present tense
  ("3 days left to build on it") instead of a verdict on a week that hasn't
  finished. The monthly view had the identical bug hardcoded as "of 28 days"
  even when the current week was partial — fixed there too.
- **Genuinely richer narrative**, not just longer: pulls in personal records
  and reward points banked that week from the data already being tracked
  elsewhere, and names your best single day when it's actually a standout
  (CholScore 80+) rather than every time. These only appear when true, so an
  ordinary week doesn't get a hollow "you hit 0 personal records."
- Tested explicitly for never being negative: a genuinely quiet week and a
  brand-new Monday with zero data both stay supportive without claiming
  anything false. Proved this and everything else above with real rendered
  screenshots from actual working code before shipping, not a static mockup.
- `index.html`, `styles.css`, `app.js`, `sw.js`, and all cache-busting query
  strings (including `APP_VERSION`) bumped to `v156`.

## v1.19.2 fixed Day Report cardio table column misalignment
- Reported: Time/Dist/Pace columns in the Day Report's cardio table didn't
  line up well row to row.
- Real cause: each row was its own independent CSS Grid (`display:grid` on
  every `.rep-cardio-row`), with the three value columns sized `auto`. Grid's
  `auto` sizing is computed per-row from that row's own content, completely
  independently of every other row — so "2h 1m" in one row and "1h" in
  another genuinely produced different column widths, with nothing forcing
  them to align. Fixed with fixed pixel widths shared identically across
  every row and the header, then proved it with actual pixel measurements via
  a headless browser rather than eyeballing a screenshot — every row's column
  right-edges landed at the exact same x-coordinate afterward.
- Found and fixed a second, subtler instance of the same underlying category
  of bug while verifying the first fix: the PR-highlighted row was still
  landing 5px off from every other row. Traced it to CSS Grid's default
  `min-width:auto` behavior — the "🏆 PR" chip badge made that row's name
  column need more minimum space than normal rows, so the whole row grew
  wider to fit it, which shifted every column to its right. Restructured the
  name column into its own flex layout (chip protected with `flex-shrink:0`,
  text given `min-width:0` and ellipsis) so the badge can never force the row
  wider — verified this holds at three realistic device widths (375/390/440px)
  and doesn't clip the activity name into invisibility on a real phone the way
  an artificially narrow first test round showed.
- While in there: removed the per-row "duration"/"distance"/"min/mi" captions
  since the header already labels the columns — but checked first that the
  distance/pace ones weren't purely redundant, since they also carried which
  specific metric hit a PR via a trophy icon. Kept that as a dedicated
  trophy-only indicator instead of deleting it outright. Moved the pace unit
  into the header once (it's the same for every row in a report) rather than
  losing it when the per-row captions came out.
- Also re-verified the Exercise section's PR chip (which shares the same CSS
  class) still renders correctly after these changes — confirmed with an
  actual render, not assumed safe because the selectors looked separate.
- `index.html`, `styles.css`, `app.js`, `sw.js`, and all cache-busting query
  strings (including `APP_VERSION`) bumped to `v155`.

## v1.19.1 thousands separators on every large number, app-wide
- Reported: weight volume numbers like "4050.0" and "11556.0" were hard to read
  at a glance with no thousands separator, and asked for a full audit of number
  formatting across the app, not just the two spots shown.
- Upgraded `fmt()` (the shared weight/volume formatter used nearly everywhere)
  to use locale-aware comma formatting instead of a plain `.toFixed(1)` — fixes
  exercise volume, PR displays, and the new Weekly/Monthly Report's weight
  stats all at once, from a single source. Small values are completely
  unaffected (`21.5` stays `21.5`, only genuinely large numbers gain commas).
- Added `fmtInt()` for whole-number displays that shouldn't carry a decimal —
  minutes and points — and went through the app systematically applying it
  rather than stopping at the two reported screenshots: Today's movement ring,
  the Exercise tab's minute counter, the Day Report's ring number, the History
  calendar detail panel, the checkout dialog and its shared image, the workout
  share image, the Reward Bank balance and goal text (both the card and the
  full dialog), and the Weekly/Monthly Report throughout.
- One deliberate exception, checked carefully rather than blanket-applied:
  achievement progress numbers (Ten Ton Club, Point Collector, etc.) keep their
  original floor-based rounding rather than switching to fmtInt's round-based
  behaviour — flooring a value like 9,999.7kg toward a 10,000kg goal correctly
  still shows "9,999", not a misleading "10,000" that would imply the
  achievement's already complete.
- Verified the exact numbers from the reported screenshots directly — 4050,
  456, 330, 1350, 11556, 1270, and 2349 — all format correctly, alongside
  confirming small values like 21.5 and 12 are untouched.
- `index.html`, `styles.css`, `app.js`, `sw.js`, and all cache-busting query
  strings (including `APP_VERSION`) bumped to `v154`.

## v1.19.0 Weekly/Monthly Reports, maskable icon, tenure achievements
Three loose ends from a step-back review of the whole project, all finished
properly rather than left as "started but not done."

**Weekly/Monthly Report** — the feature that got mocked up, approved in spirit,
and then genuinely never built.
- History's Calendar/Trends toggle is now a 3-way segmented control:
  Calendar / Trends / Reports.
- **This week**: date range, a message that actually varies by how the week
  went (strong ≥85% of days on target, solid ≥50%, quieter otherwise — not one
  canned line regardless of data), and a 4-stat grid: movement minutes, weight
  lifted, workouts completed, days under your saturated fat target.
- **Last 4 weeks**: same stats aggregated, plus a week-by-week bar breakdown so
  you can see which week was strongest, not just a flat total.
- **Auto-popup**: fires once, automatically, the first time you open the app
  after a new week has started — the honest version of "at the start of each
  week" for an app with no server/push capability. Correctly stays silent for a
  brand-new user's very first check, for a week already seen, and for a
  previous week with genuinely zero data (no hollow "0 minutes" popup) —
  tested all four of those cases directly before shipping, not just the happy
  path.
- Reuses `mondayKeyFor()` (the same Monday-Sunday boundary weekly achievements
  already use) and the same `totals()`/`scoreDay()` functions as the rest of
  the app, so it can't disagree with Today, Trends, or the Day Report.

**Maskable Android icon** — diagnosed back when the Android splash screen
"wasn't very good," never actually fixed until now.
- The existing icon has the CholScore wordmark baked directly into the same
  image as the heart glyph, extending almost to its own edges — fine for
  iOS/desktop, but exactly the shape Android's own icon masking (circle,
  squircle, rounded square) tends to clip.
- Built a proper maskable variant: isolated just the heart/leaf/heartbeat
  glyph with real alpha transparency (not just a rectangular crop — an
  earlier attempt left a visible background ghost, fixed by tightening the
  brightness threshold used to key it out), scaled to sit inside Android's
  80% safe-zone circle with real margin, not right at the boundary.
- Verified by simulating the most aggressive mask Android applies — a full
  circle — and confirming the entire glyph, leaf tips included, survives with
  margin to spare.
- Added as a genuinely additional `purpose: "maskable"` manifest entry, not a
  replacement — existing icons untouched, still used exactly as before on iOS
  and everywhere else that doesn't apply its own masking.

**Tenure achievements** — closing out the sparse Mythic tier (2 achievements)
with a third, and a whole small ladder leading up to it.
- New `daysSinceFirstLog` metric: days since your very first-ever log,
  independent of streaks — deliberately more forgiving than a pure streak,
  since one missed day doesn't erase months of tenure the way breaking a
  streak would. Tested against multiple days, a brand-new user, and a
  same-day edge case before shipping.
- Three new achievements: A Quarter Year (90 days, Rare), Half A Year (180
  days, Epic), One Year On (365 days, **Mythic**) — 54 achievements → 57.

`index.html`, `styles.css`, `app.js`, `sw.js`, `manifest.json`, the new
`icon-512-maskable.png`, and all cache-busting query strings (including the
`APP_VERSION` constant used by the share templates) bumped to `v153`.

## v1.18.2 fixed missing cache-busting on share templates
- Reported: replaced the watermarked walk/run template images on GitHub, but the
  shared image kept showing the old watermarked version regardless.
- Real cause, and a genuine gap in v1.18.0: every other asset in this app
  (`styles.css`, `app.js`, the workout silhouette) is loaded with a `?v=NNN`
  cache-busting query string, specifically so browsers, the service worker, and
  GitHub's own CDN all know to fetch a fresh copy whenever the underlying file
  changes. The two new share template images were the only assets in the whole
  app that never got this treatment — loaded by a plain filename with nothing
  to signal "this changed," so all three caching layers kept serving whatever
  they'd fetched the very first time, no matter how many times the file was
  replaced on GitHub.
- Confirmed the fix would actually work end-to-end before shipping it, not just
  assumed: checked the service worker's own fetch handler specifically, since
  `caches.match()` does an exact URL match including the query string — a
  request for `run-share-template.jpeg?v=152` genuinely won't match the old
  entry cached under the plain, query-string-less filename, which correctly
  forces a real network fetch instead of serving the stale cached copy.
- Added a proper `APP_VERSION` constant to `app.js` itself, since the template
  images are requested from inside app.js (not index.html), where the existing
  `?v=` numbers weren't reachable at all — needed a real source of truth
  in the right file, not another one-off patch.
- `index.html`, `styles.css`, `app.js`, `sw.js`, and the image cache-busting
  query strings bumped to `v152`.

## v1.18.1 fixed run template filename mismatch
- After replacing the walk/run templates to remove a watermark, GitHub's upload
  flow normalized `run-share-template.jpg` to `.jpeg` on its own — walk stayed
  `.jpg`, run became `.jpeg`, genuinely different extensions now live on the two
  files. The code was asking for `.jpg` on both, so run would have silently
  loaded nothing (falling back to a blank background rather than crashing,
  since that fallback was deliberately built in — but still not showing the
  actual template).
- Fixed by matching the extension per type rather than asking for another round
  of GitHub renaming, which had already caused enough friction this session.
- Updated the service worker's precache list and an outdated code comment to
  match.
- `index.html`, `styles.css`, `app.js`, `sw.js`, and the image cache-busting
  query strings bumped to `v151`.

## v1.18.0 shareable walk/run images
- Requested with three reference images: a "Share achievement" button on the
  walk/run completion card, using pre-built template images (supplied directly,
  not built from scratch) as the background — only the dynamic text needed
  positioning.
- Caught a real discrepancy between the references before writing any position
  code: the filled example showed card order Distance → Duration → Pace, but the
  actual walk/run template images have the labels baked in as Duration →
  Distance → Pace — the first two are swapped. Confirmed by cropping and
  comparing the label rows directly rather than eyeballing it. Since the
  template is the literal background being shipped, followed its printed order
  — otherwise values would land under the wrong labels.
- Measured every text position directly from the reference image via pixel
  analysis (finding the actual bright-pixel bands for each line of text, and the
  icon circle centres for horizontal alignment) rather than estimating from the
  screenshot by eye: headline at y≈530/574, three card values at x=213/504/796,
  y≈768, captions at y≈826.
- Templates saved as `walk-share-template.jpg` / `run-share-template.jpg` — used
  JPEG rather than PNG for the source images (~1MB → ~166KB each, checked
  visually for artifacts around the sharp text and found none) since the final
  shared image is re-encoded as PNG at export time regardless, so the
  intermediate template doesn't need to be lossless.
- Headline and captions adapt to what actually happened: "You hit a new PR
  today!" only when `checkCardioPR()`'s badges actually mention a PR, "Nice and
  steady." otherwise; a duration-only activity with no distance logged shows "—"
  for distance/pace rather than a broken "0.0mi" or hiding the share option
  entirely.
- Verified against three rendered scenarios before shipping: the exact reference
  scenario with a pace PR, a run with no PR at all, and a duration-only walk with
  zero distance — all three read correctly.
- Both new template images added to the service worker's precache list.
- `index.html`, `styles.css`, `app.js`, `sw.js`, and the image cache-busting
  query strings bumped to `v150`.

## v1.17.1 tightened proportions, removed duplicate branding
- Follow-up to v1.17.0: the image was 1080×1516 (ratio 0.712) against a reference
  of 1215×1259 (ratio 0.965) — noticeably taller and more elongated than intended,
  confirmed with real numbers rather than left as a vague impression.
- Tightened the circle, stat cards, and spacing to bring it down to 1080×1207
  (0.895). While doing this, rendering an actual proof caught a real bug the
  numbers alone didn't show: shrinking the circle's vertical position pushed the
  star badge up into the fixed header text, overlapping it. Fixed by giving the
  circle enough clearance below the header instead of chasing the tightest
  possible ratio at the cost of correctness.
- Also reported: CholScore's name and tagline were appearing twice — once at the
  top, once again at the bottom. Removed the duplicate footer entirely, ending the
  image cleanly at the motivation banner instead. This also matches the checkout
  share image, which only ever showed the branding once, and it further tightened
  the ratio to 1080×1177 (0.918) — genuinely closer to the reference, not just
  "close enough."
- Re-verified the long-name and bodyweight-only edge cases against every one of
  these layout changes, each confirmed with an actual rendered proof rather than
  assumed to still work from the earlier numbers.
- `index.html`, `styles.css`, `app.js`, and the image cache-busting query strings
  bumped to `v149`.
- service-worker cache version bumped to `cholscore-v149`.

## v1.17.0 shareable workout-complete image
- Requested with a reference design: a "Share achievement" button on the
  workout-complete celebration screen, same pattern as the checkout share, but a
  deliberately distinct, more elaborate layout built specifically for sharing
  rather than reusing the in-app celebration screen verbatim.
- New `generateWorkoutShareImageBlob()` reuses the app's real assets and colours
  for genuine brand consistency rather than approximating them: the same
  `workout-victory-silhouette.png` artwork already used live, the exact confetti
  palette from `startConfettiLoop()` (`#8d36ff #f8bd36 #ea62c8 #fff0ba #54d9ff`),
  and the same gold/purple tokens as the live celebration's own CSS
  (`.premium-star`, `.premium-stat-card`, `.premium-motivation`).
- Circular gold-framed silhouette with a star badge overlapping the top, headline
  and sub-message, two stat cards (total weight lifted, workout duration) with
  circular icon badges, and the "every rep brings you closer" banner — matching
  the reference layout section by section.
- Same button pattern and full fallback chain as the checkout share (image share
  → text-only share → direct download → text-share/clipboard on error), and the
  same `wrapCanvasText` line-count trick so the one variable-length piece of text
  (a long name in the headline) can wrap to 2 lines without anything below it
  overlapping.
- Found and fixed a real rendering issue while testing with actual rendered
  output, not just reading the code: the source silhouette PNG has almost no
  transparent margin at its own bottom edge (checked directly — visible content
  extends to within 2-3px of the full image height), so drawing it too large
  made that edge visible as a hard cutoff line inside the circle. Fixed by
  scaling it down and shifting it upward slightly so that edge sits in the
  darker part of the circle's gradient instead of being prominent.
- Verified across three rendered scenarios before shipping: a normal two-exercise
  workout, a bodyweight-only session (correctly shows "—" instead of "0.0 kg",
  matching how the live screen already handles it), and a long name to confirm
  the headline wraps to 2 lines with everything below it shifting down cleanly
  rather than overlapping.
- `index.html`, `styles.css`, `app.js`, and the image cache-busting query strings
  bumped to `v148`.
- service-worker cache version bumped to `cholscore-v148`.

## v1.16.2 checkmark badges added to the shared image
- Reported: checkmarks correct on every real checkout, but missing specifically
  from the shared image. Took a couple of rounds to pin down exactly what was
  meant — turned out not to be a regression from the v1.16.1 rotation fix at all.
  `drawShareRing()` (the canvas share-image code from v1.16.0) simply never drew
  a checkmark badge in the first place — only the arc, the number, and the label.
- Added it properly: same position (top-right of the ring), same colours, and the
  exact same checkmark path used in the live dialog (`M4 12.5L9.5 18L20 6` in a
  24×24 viewBox) — translated to coordinates relative to its own centre and
  scaled to the badge size, not approximated freehand, so it can't visually drift
  from the real one.
- Rendered real test images afterward to confirm rather than trust the code by
  eye — both a normal day and an over-target day came out with a correctly
  upright, well-positioned checkmark.
- Flagged rather than silently changed: the checkmark still appears even on an
  over-target ring, matching the live dialog's own current behaviour exactly
  (`checkoutBadgeSat` always pops regardless of over/under target) — deliberately
  matched rather than introducing a new inconsistency between the two surfaces.
  If checkmarks should only appear when actually under target, that's a real,
  separate change touching both places together, not something to decide
  unilaterally while fixing a narrower reported bug.
- `app.js` and the image cache-busting query string bumped; `index.html` and
  `styles.css` cache-busting query strings bumped to `v147`.
- service-worker cache version bumped to `cholscore-v147`.

## v1.16.1 fixed checkmark badges rendering as chevrons
- Reported: the small green tick badges on the checkout dialog's rings looked
  like ">" arrows instead of checkmarks.
- Diagnosed properly rather than guessing — rendered the actual checkmark SVG
  path in isolation first (came out completely normal), which ruled out the path
  data itself and pointed at something rotating it after the fact. Found it:
  `.checkout-ring-wrap svg{transform:rotate(-90deg)}` is a *descendant* selector,
  matching any `<svg>` anywhere inside that wrapper — not just the intended
  progress-ring arc it was written for. The checkmark badge has its own inner
  `<svg>` nested two levels deeper, so it was silently getting caught by the same
  rule and rotated -90° right along with the ring. Confirmed by rendering the
  checkmark path with that exact rotation applied — pixel-for-pixel matched the
  chevron in the screenshot.
- Fixed by switching to a direct-child selector (`.checkout-ring-wrap > svg`),
  which only matches the ring's own SVG (a direct child of the wrapper) and
  correctly leaves the badge's nested SVG alone.
- While fixing it, searched for the same pattern elsewhere rather than assuming
  this was the only spot. Found it recurring in a `max-width:420px` mobile media
  query too — same bug, just gated behind a breakpoint that doesn't apply to a
  17 Pro Max's 440px viewport, which is exactly why it wasn't visible in the
  screenshot. Left unfixed it would have blown the checkmark badge up to a broken
  72×72px on any narrower phone (iPhone SE, mini models, etc.). Fixed that
  instance too. Separately checked the Day Report's rings for the same risk —
  confirmed they don't nest any badge SVG, so no fix was needed there, and
  nothing was changed that wasn't actually broken.
- `index.html`, `styles.css`, `app.js`, and the image cache-busting query strings
  bumped to `v146`.
- service-worker cache version bumped to `cholscore-v146`.

## v1.16.0 shareable branded checkout image
- Reported: "Share achievement" on the checkout dialog only produced plain text —
  wanted an actual shareable image, with the app name included, since a real image
  is genuinely worth sharing (and a bit of free advertising in the process).
- Built entirely client-side on a `<canvas>` at share time — the app has no server
  to render an image for, so this draws the whole card from scratch: gradient
  background, CholScore wordmark and tagline, the headline and summary text, the
  reward-bank progress line when a goal's active, and the three rings, matching
  the app's real colours.
- Wired into the existing share button with a full fallback chain: image share on
  browsers that support it, falling back to the original text-only share, falling
  back to a direct image download if there's no native share at all, falling back
  further to text-share/clipboard if image generation itself fails for any reason
  — nothing regresses on a browser that can't do the new thing.
- **Actually tested by installing a real canvas renderer and running the drawing
  code for real**, not just reading it — this caught three genuine bugs no amount
  of code review would have:
  - A compound font string worked as CSS but silently reset to a 10px default
    inside canvas specifically. Traced it to the `-apple-system` keyword itself
    breaking font parsing — replaced every canvas font string with plain
    `sans-serif` rather than gamble on real browsers behaving differently, on the
    one platform already known for its own rendering quirks.
  - The ring row was pinned to a fixed minimum position regardless of how much
    text came before it, leaving a large dead gap on ordinary days with no active
    goal box.
  - A two-line goal message was drawn inside a box still sized for one line,
    cramming the second line right against the border.
- Fixed by switching to a two-pass approach: a scratch canvas measures the exact
  wrapped-text height first (headline, body, and the goal box if present), then
  the real canvas is created at precisely the right size — nothing wasted, nothing
  clipped, regardless of name length or message length.
- Also fixed a real, if smaller, honesty issue while building this: an
  over-target saturated fat day was rendering as a fully-filled *green* ring,
  which reads as "complete/good" even though the day was actually over the limit.
  Now renders in a warning orange when over target instead.
- Verified all of the above across four rendered scenarios before shipping: a
  normal day, a day with an active goal (including the two-line wrap case), an
  over-target day with an unusually long name, and a short single-line goal for
  comparison — checked pixel dimensions directly, not just eyeballed.
- `index.html`, `styles.css`, `app.js`, and the image cache-busting query strings
  bumped to `v145`.
- service-worker cache version bumped to `cholscore-v145`.

## v1.15.0 score label info button
- Asked directly: a score of 95 shows as "Outstanding" — what are the actual
  thresholds for each label? Confirmed from the real code (90+ Outstanding, 80–89
  Flying, 70–79 Great day, 55–69 Building momentum, 35–54 Good start, 0–34 Getting
  started), then added an in-app way for anyone to see this without having to ask.
- New small ⓘ button in the top-right of the "Today's progress" card, opening a
  simple dialog listing every score band and its label.
- Refactored `scoreLabel()` to read from a shared `SCORE_BANDS` array instead of a
  hardcoded if/else chain, and the new dialog generates its list from that exact
  same array — not a separately hand-typed copy. If the thresholds are ever
  changed later, the info dialog updates automatically instead of silently
  drifting out of sync with what the score actually does.
- Verified the refactor didn't change behaviour: every boundary score (34/35,
  54/55, 69/70, 79/80, 89/90) produces the identical label before and after, and
  the generated ranges have no gaps or overlaps between them.
- `index.html`, `styles.css`, `app.js`, and the image cache-busting query strings
  bumped to `v144`.
- service-worker cache version bumped to `cholscore-v144`.

## v1.14.2 weight adjuster repositioned to fill the row
- Reported with a screenshot: the "Weight" label and the −/value/+ stepper were
  stacked and bunched to the left, leaving a large empty gap on the right.
- Mocked up first, approved, then built for real. Now one row: label on the left,
  stepper pushed all the way to the right edge, wrapped in its own subtle card
  matching the same background/border treatment already used for the sets below
  it, so it reads as a distinct control rather than floating text.
- Pure layout change — the HTML structure and class names were already exactly
  right (same IDs, same behaviour), so this only touched CSS: `justify-content`,
  the card wrapper, and resized the stepper slightly to sit comfortably against
  the right edge. Nothing about how the stepper actually works changed.
- `styles.css` and the image cache-busting query strings bumped; `index.html` and
  `app.js` cache-busting query strings bumped to `v143`.
- service-worker cache version bumped to `cholscore-v143`.

## v1.14.1 fixed PRs/Trends missing the true heaviest set
- Asked directly: "will the reports all be correct if there's a mid-set weight
  change?" Checked rather than assumed — they weren't.
- Found the bug: Personal Records, the "New PR!" badge on the completion card, and
  the Trends strength-progress chart all read the exercise's *final* weight (the
  last value the stepper was left on) rather than the actual heaviest weight used
  across its sets. In the exact reported scenario — 15kg on set 1, dropped to 10kg
  for the rest — the exercise gets saved with `weight: 10`, so all three would
  have silently missed that 15kg was ever lifted at all. A genuine new PR at 15kg
  would never have fired the badge, never shown up in Personal Records, and never
  plotted correctly on the Trends chart.
- The Day Report's "kg volume" number was already correct — that one already used
  `exerciseVolume()`, fixed in v1.14.0.
- Fixed with one shared helper (`exerciseHeaviestWeight`) — the true max across a
  set's own recorded weights, falling back to the exercise-level value for older
  data with no per-set weight — used consistently in all four places rather than
  patching each spot separately with potentially inconsistent logic.
- Caught and fixed a mistake in my own edit before it shipped: an early version of
  this change accidentally deleted the `workoutVolume` function's own declaration
  line while inserting the new helper next to it, which would have been a hard
  syntax error. Runs a syntax check after every edit specifically to catch this
  class of mistake before it reaches a real device.
- Tested the exact reported scenario end to end: the true heaviest weight (15kg)
  is now correctly detected as a new PR against a lower prior best, correctly
  recorded in Personal Records, and correctly plotted in Trends — plus confirmed
  older workout data with no per-set weight, and the common case of an exercise
  whose weight was never adjusted, are both completely unaffected.
- `index.html`, `styles.css`, `app.js`, and the image cache-busting query strings
  bumped to `v142`.
- service-worker cache version bumped to `cholscore-v142`.

## v1.14.0 in-workout weight adjuster
- Reported: weight is locked in once a workout starts — if it turns out too heavy
  (or too light) a few reps in, the only option was cancelling the whole exercise.
  Mocked up first, approved, then built for real.
- **Stepper (−/+), always visible**, right where the weight used to show as plain
  text — no "enter edit mode" tap needed first, since speed matters mid-set.
  2.5kg per tap, matching real plate/dumbbell increments. Tapping the number
  itself opens exact entry for a bigger jump in one go.
- **Completed sets keep the weight they were actually done at.** This needed a
  real data model change, not just new buttons: exercises used to store one
  weight applied to every set uniformly. Each set now snapshots its own weight
  the moment it's marked complete, so adjusting mid-exercise only affects sets
  not yet done — set 1 at 15kg stays recorded at 15kg even after dropping to
  10kg for the rest. A completed set whose weight differs from the current
  value gets a small gold tag showing what it was actually done at.
- As a side effect, this is also now a genuine way to do drop sets on purpose
  (deliberately lighter for the last set or two) — same control, not a
  separate feature.
- Volume calculation (`exerciseVolume`) now uses each set's own recorded weight
  when present, falling back to the exercise-level value for older saved
  workouts that predate this change — fully backward compatible, nothing needed
  migrating.
- Found and fixed a real edge case while building this: the existing weight
  resolution logic treated exactly 0kg as "never set" and would silently fall
  back to the routine's original weight on the next render — meaning
  deliberately dropping all the way to bodyweight would have quietly reset
  itself moments later. Added a `weightManuallySet` flag so an intentional 0kg
  is respected once the adjuster's actually been used.
- Tested against the exact scenario from the report — a set done at 15kg
  followed by two at an adjusted 10kg — confirming volume comes out to exactly
  350kg (10×15 + 10×10 + 10×10), plus backward compatibility with old workout
  data with no per-set weight, the 0kg drop staying put, and confirming
  untouched exercises still correctly inherit the routine's original weight.
- `index.html`, `styles.css`, `app.js`, and the image cache-busting query strings
  bumped to `v141`.
- service-worker cache version bumped to `cholscore-v141`.

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
