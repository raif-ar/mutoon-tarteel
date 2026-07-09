# Mutoon redesign implementation notes

Source: Claude Design handoff bundle `mutoon-tarteel/project/Mutoon Redesign.html` +
`mutoon2/*.jsx` (onboarding, home, reader, results, progress, theme). Recreating
visuals in React Native (Expo Router) — not copying the prototype's DOM/CSS-in-JS
structure, per the handoff README.

## Scope (confirmed with user)
- Full redesign: onboarding, tab-bar shell (Library/Progress), restyled Library,
  restyled Reader, new Results screen, new Progress tab.
- Add the tab bar now (restructure navigation).
- Progress/streak/heatmap/stats computed from real session data in the local
  SQLite DB — no stubs/placeholders.

## Working branch
`rai-13-mutoon-redesign`, branched from latest master (57ed827) after
`rai-12-recite-ux` (input-level meter, session audio capture, Deepgram sweep
tuning) was merged as PR #3. recite.tsx's real ASR engine (ReciteEngine /
WordMistake / ReciteEngineState) is the reader's data source, not the
prototype's fake setTimeout-driven word advance.

## Key existing pieces preserved as-is (not rewritten)
- `src/lib/asr/reciteEngine.ts` — real ASR-driven session state machine. The
  redesign is a visual skin on top of `ReciteEngineState` (wordCursor, mistakes,
  lineIndex, isListening, inputLevel, lowInput, stuckHint, asrError).
- `src/lib/content/*` — real word-tokenized matn content (3 real texts).
- `src/lib/db/database.ts` — real session/mistake/goal logging; extending with
  new read-only aggregate queries, not changing existing writes.

## Navigation restructure
- `app/index.tsx` becomes a redirect gate (checks `onboarded` setting from DB
  settings table, redirects to `/onboarding` or `/library`).
- `app/onboarding.tsx` — new 3-step flow.
- `app/(tabs)/_layout.tsx` — Tabs navigator with custom floating capsule tab bar
  (Library, Progress). Tab routes are `/library` and `/progress` (not `/`) since
  `/` is claimed by the gate.
- `matn/[id]/*` stack screens unchanged in location, pushed over the tab view.

## Data decisions (avoiding schema migration risk)
- No new SQLite columns. `sessions` table already has duration_sec and
  mistake_count but not word counts, so "avg accuracy" for the Progress tab is
  computed in JS by joining session rows with content (`getLineRange` +
  word counts) rather than altering the schema.
- Streak/heatmap/week-activity are new read-only queries over `sessions`.

## Deviations / follow-ups
- **Prototype's fake reader vs real engine**: the prototype simulates word
  advance with setTimeout and a scripted `mistakeAt`; the implementation binds
  the same visuals to `ReciteEngineState`. The prototype's center waveform in
  the control capsule was replaced by the existing real RMS input meter (it
  shows actual mic level, which the fake waveform can't).
- **Kept features the redesign didn't cover**: hide-upcoming (memorization)
  toggle, peek hint, stuck-rewind banner, low-input warning, Share-log pill.
  These live in the reader header/capsule alongside the new design.
- **"Verses" → "lines"**: the app's content model is line-based (a bayt is 2
  lines in the prototype but 1 line in our content), so all copy says lines.
- **Results routing**: recite completes → `router.replace(matn/[id]/results)`
  with stats as params; results Continue → `router.back()` lands on the tab
  shell. Back-exit from an unfinished session saves and skips results.
- **expo-router 6 has no @react-navigation dep**: custom tab bar types come
  from `expo-router/build/react-navigation/bottom-tabs` (type-only deep import).
- **metro.config.js added** for expo-sqlite web support (wasm asset + COOP/COEP
  headers) so the whole flow is verifiable in web preview; native unaffected.
- **Onboarding goal**: persisted to settings as `dailyGoalMin` but nothing
  consumes it yet — future daily-goal feature can read it.
- **Web LogBox noise**: `direction: "ltr"` style (pre-existing pattern, needed
  on native for RTL isolation) is rejected by react-native-web and shows a
  dev-only LogBox error toast on web. Harmless; silence by gating with
  Platform.select if it gets annoying.
- Deleted now-unused `MatnListCard` (replaced by `MatnCard`). `goals.tsx` /
  `history.tsx` kept but are currently unreachable from the new UI (they were
  already unlinked before the redesign).

## Logo / rebrand (MatnHifdh Logo v4 handoff, "The Whorl")
- Mark = single-stroke م spiral. Source of truth: `assets/brand/*.svg`;
  PNGs (icon, android adaptive set, splash-icon, favicon) rasterized from
  them via `npx sharp-cli` (regenerate with the same command if the SVGs
  change; needs node 20 from nvm).
- RN components: `src/components/brand/WhorlMark.tsx` (static + tiny 1.5-turn
  variant below 28px + AnimatedWhorlMark that writes itself, stroke length
  ≈156) and `BrandLockup.tsx` (mark + MatnHifdh two-tone wordmark, Gabarito
  800 via @expo-google-fonts/gabarito).
- Placements: onboarding welcome tile (animated draw-in) + wordmark; library
  header lockup; app icon (white on teal gradient 135° #109382→#0A5A50);
  splash (white mark on #0F3B34 via expo-splash-screen plugin config);
  android adaptive bg #0A5A50; favicon (tiny variant, teal).
- Rebrand per user decision: display name → "MatnHifdh" (app.json name +
  permission strings). Slug, scheme, and bundle ids intentionally unchanged.
  ios/ is gitignored — native icons/splash refresh on next prebuild
  (`expo run:ios`).
- Design's "draws further with every verse memorized" splash idea not
  implemented (native splash is static); could be done on a JS boot screen
  later.
