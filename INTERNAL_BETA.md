# Internal beta checklist

## Build

```bash
cd app
npm install              # picks up @siteed/audio-studio, expo-file-system, expo-sharing
npm run content:build
npx eas build --profile preview --platform all
```

Requires [EAS](https://expo.dev/eas) account and Node 20+. The mic capture (`@siteed/audio-studio`) is a native module — Recite only runs in a dev-client / EAS build, not Expo Go.

### ASR key (required — cloud is the only engine)

Set before building so it inlines into the binary (use a scoped/rotatable key or a short-lived token endpoint — do not commit a long-lived key):

```bash
export EXPO_PUBLIC_ASR_DEEPGRAM_KEY=...     # cloud streaming (Deepgram Nova-3 Arabic)
# or EXPO_PUBLIC_ASR_OPENAI_KEY=... with EXPO_PUBLIC_ASR_CLOUD_VENDOR=openai
```

There is no on-device or OS-speech fallback: without a key (or token endpoint) Recite shows a microphone/recognition error instead of listening.

## Testers (5–10 students)

1. Install preview build on iOS/Android.
2. Open **تحفة الأطفال** → set range (e.g. lines 1–10) → **Recite**.
3. Grant microphone; recite with **Start mic**. Use a quiet room and a live voice (no speaker playback into the mic).
4. Recognition runs on **Cloud (Deepgram Nova-3)** only. The header has a **Share log** button — tap it after a session to send the recite log for analysis.
5. Confirm mistakes (missed / wrong / extra) match expectations.
6. Open **الثلاثة الأصول** → **Listen** → verify TTS highlights lines.
7. Check **Goals** and **Mistakes** tabs persist after app restart.

## Recite debug logs (file)

In dev builds, every `[MutoonRecite]` line is also written to:

`Documents/recite-logs/<timestamp>_<matn>_cloud.log`

Three ways to retrieve a log (easiest first):

1. **Share log button** (in the Recite header) — flushes the current log and opens the iOS share sheet (AirDrop / Files / Mail). This is the primary path; no Xcode needed.
2. **Files app** — **Files → On My iPhone → Mutoon Tarteel → recite-logs** (works after a rebuild now that `UIFileSharingEnabled` is in the Info.plist).
3. **Xcode** — Devices & Simulators → app container → download `Documents/recite-logs/`.

Metro also prints `fileLog.begin` / `fileLog.end` with the full `file://` path when a recite screen opens and closes.

Pull from the iOS Simulator:

```bash
CONTAINER=$(xcrun simctl get_app_container booted com.mutoon.tarteel data)
ls "$CONTAINER/Documents/recite-logs/"
```

## Feedback to collect

- Edition mismatches vs classroom mushaf (wording / harakat).
- Cloud Arabic recognition quality on the same lines — attach the shared recite log.
- Desired teacher audio for listen mode.

## Known limits (Phase 2 — production ASR)

- **Cloud-only** (Deepgram Nova-3 Arabic, OpenAI realtime as alt): needs a key + network, biased with the upcoming matn words and re-biased as the cursor advances. On-device Whisper and OS speech were removed to focus on the cloud path.
- No offline mode: recite requires network + mic. Errors surface in-app rather than falling back.
- Live accuracy must be signed off on a real build — run `npm --prefix app run asr:eval` with sample clips for WER evidence, and attach a **Share log** capture from a live session (see README).
- Thalathat / Qawaaid texts are abbreviated samples — expand in `content/scripts/generate-content.mjs`.
