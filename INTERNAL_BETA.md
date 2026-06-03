# Internal beta checklist

## Build

```bash
cd app
npm install              # picks up @siteed/audio-studio, whisper.rn, expo-file-system
npm run content:build
npx eas build --profile preview --platform all
```

Requires [EAS](https://expo.dev/eas) account and Node 20+. The new ASR providers are native modules — they only run in a dev-client / EAS build, not Expo Go.

### ASR keys (optional, for cloud mode)

Set before building so they inline into the binary (use a scoped/rotatable key or a short-lived token endpoint — do not commit a long-lived key):

```bash
export EXPO_PUBLIC_ASR_DEEPGRAM_KEY=...     # cloud streaming (Deepgram Nova-3 Arabic)
# or EXPO_PUBLIC_ASR_OPENAI_KEY=... with EXPO_PUBLIC_ASR_CLOUD_VENDOR=openai
export EXPO_PUBLIC_ASR_ONDEVICE_MODEL_URL=... # whisper model bundle for offline mode
```

Without a key the app falls back to OS speech automatically.

## Testers (5–10 students)

1. Install preview build on iOS/Android.
2. Open **تحفة الأطفال** → set range (e.g. lines 1–10) → **Recite**.
3. Grant microphone; recite with **Start mic** OR use **typing fallback** to validate alignment.
4. The header pill shows the active speech engine (**Cloud / On-device / OS speech**). Tap it to switch and recite the same line on each — note which is most accurate.
5. Confirm mistakes (missed / wrong / extra) match expectations.
6. Open **الثلاثة الأصول** → **Listen** → verify TTS highlights lines.
7. Check **Goals** and **Mistakes** tabs persist after app restart.

## Feedback to collect

- Edition mismatches vs classroom mushaf (wording / harakat).
- Arabic speech recognition quality per engine (Cloud vs On-device vs OS speech) on the same lines.
- Desired teacher audio for listen mode.

## Known limits (Phase 2 — production ASR)

- **Cloud** (Deepgram Nova-3 Arabic / OpenAI realtime) needs a key + network; biased with the upcoming matn words. Best accuracy, lowest latency.
- **On-device** (whisper.rn / WhisperKit) downloads its model on first run (one-time, needs `EXPO_PUBLIC_ASR_ONDEVICE_MODEL_URL`); fully offline + private after that.
- **OS speech** (`ar-SA`) remains the always-available fallback when no key/model is present.
- Device + live accuracy must be signed off on a real build — run `npm --prefix app run asr:eval` with sample clips for WER evidence (see README).
- Thalathat / Qawaaid texts are abbreviated samples — expand in `content/scripts/generate-content.mjs`.
