# On-device Recite + approved prototype build (2026-11-25, branch feat/on-device-recite)

Approved by Raif 2026-11-25 15:31Z ("i love this. let's gooo!!!", "build the whole thing out"). Prototype:
`../proto/` (SPEC.md, README.md). Engine write-up: `../docs/ON_DEVICE_ENGINE.md`. Build maps: `../proto/build-maps/`.

## Checklist

- [x] Engine core: phonemizer + live aligner, gate on recorded audio (0 false reds on 61 recorded words, 4/4 planted mistakes, repeats / restarts / left-out line handled)
- [x] Listener vendored from @tilawa/core; model fetched and sha-checked
- [x] Native runner (local Expo module on ONNX Runtime), proven on the iOS simulator
- [x] ReciteEngine on the mic source; Recite screen rewired (popover, On this phone, mic-off banner, practice mode)
- [x] DB: slips table, coverage progress, minutes today, settings in one read, local-day streak
- [x] Cloud engine removed (Deepgram / OpenAI, aligner, reconcile, replay gate)
- [ ] Screens: intro, library, matn page + sheet + picker, results, review, listen, progress, settings
- [ ] Review of the whole change; typecheck; simulator end-to-end
- [ ] Attribution row in Settings (model is CC BY 4.0)
- [ ] Real iPhone test (needs Raif: TestFlight upload is his call)

## Decisions

- **Engine**: Tilawa's acoustic model only, with our own alignment. Its tracker/checker is Quran-tuned and loses
  the start and end of a passage on mutoon.
- **Own native module instead of onnxruntime-react-native**: the pod's binary host was down and upstream is
  frozen; a ~200-line module on the ONNX Runtime C++ API keeps the model state native (only 14 KB in and 1.4 KB
  out per step) and has no legacy-bridge dependency.
- **Listener vendored, not imported**: the package's React Native entry pulls the 4.7 MB Quran reference and its
  export map hides the listener.
- **Full model (68 MB)**: the lite model gave a false red on the gate.
- **Progress = lines actually recited** (union of session ranges), not a high-water mark, so reciting one
  section out of order does not mark earlier ones done. Practice sessions are logged with an empty range.
- **"Sounded like"** instead of "You said" for a wrong word: the engine hears sounds, not spelled words.
- **Slips cleared by any clean recitation of the line**, in normal and practice sessions.
- **No session audio capture** in the new engine. It was off by default before (build-time flag); now the code
  is gone, so "nothing is recorded" is simply true.
- **Release simulator builds** for verification: the Debug configuration does not link in this checkout (the
  prebuilt React core is the release flavour).

## Deviations from the prototype

- Popover label "Sounded like" (see above); "Hear it" pauses listening first so the mic does not hear the phone.
- Settings has one extra row, "Check listening" (the listening check screen).
- A slip on the word being recited shows as a red dot in hide mode, without revealing the word.
- Large buttons keep the app's shape (height 54, radius 27); the prototype drew radius 18.

## Surprises

- `github.com/microsoft/onnxruntime` is gone and the CocoaPods archive host has a bad certificate. NuGet works.
- This ONNX Runtime build references the system SQLite: the podspec links `sqlite3`.
- `expo-file-system`'s new `File` API refuses app-bundle paths; bundled assets are read with `fetch`.
- `Ort::TypeInfo` must outlive the tensor info taken from it (first run failed with garbage element types).
- Release simulator builds default to two architectures and filled the disk; build with `ONLY_ACTIVE_ARCH=YES ARCHS=arm64`.
- `app/.env` holds a Deepgram key that was inlined into the 1.0.2 build. It should be revoked.

---

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
