CholScore v1.5.1 - Export now offers real off-device destinations

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
