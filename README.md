# Mutoon Tarteel

Local-first memorization app for **Mutoon Taalib al-Ilm** (Tuhfat al-Atfal, Thalathat al-Usool, Qawaaid al-Arba, …) with Tarteel-inspired recite mode: hide text, live word-level mistake detection, peeking, goals, and mistake history.

## Structure

```
content/          # Mutoon content package (JSON schema + matn files)
app/              # Expo React Native app (iOS, Android, web for dev)
scripts/          # Content generation & ASR alignment benchmark
```

## Quick start

```bash
# Regenerate matn JSON from scripts
node content/scripts/generate-content.mjs
cp content/mutoon/*.json content/manifest.json app/assets/content/

# App
cd app
npm install
npm start
```

- **iOS / Android (mic):** `npx expo run:ios` or `npx expo run:android` (dev build with `expo-speech-recognition`; does not run in Expo Go).
- **Web (alignment testing):** `npm run web` — use browser speech or the typing fallback on Recite.

## Content

- Schema: [`content/schema/matn.schema.json`](content/schema/matn.schema.json)
- **Tuhfat al-Atfal:** Wikisource-based edition (verify against your mushaf)
- Edit sources in `content/scripts/generate-content.mjs`, then regenerate

## ASR / mistake detection

Pipeline:

1. 16 kHz audio → Arabic ASR (pluggable provider, see below)
2. Arabic normalization (optional tashkeel strip)
3. **Forced alignment** to expected `words[]` for the current line ([`app/src/lib/asr/align.ts`](app/src/lib/asr/align.ts))

All providers implement the same `AsrProvider` seam ([`app/src/lib/asr/types.ts`](app/src/lib/asr/types.ts)) and share the transcript accumulator + alignment engine, so the recognizer is swappable without touching alignment.

### Providers (max-accuracy hybrid)

| Mode | Backend | Notes |
|------|---------|-------|
| `cloud` | **Deepgram Nova-3 Arabic** (default) or **OpenAI `gpt-realtime-whisper`** | Best streaming Arabic accuracy. WebSocket + `keyterm`/`prompt` biasing from the upcoming matn words. |
| `device` | **whisper.rn** (whisper.cpp; WhisperKit/Large-v3-Turbo on iOS) | Offline + private. `initialPrompt` biasing. Model downloaded on first run. |
| `voice` | `expo-speech-recognition` (OS `ar-SA`) | Always-available fallback. |
| `web` / `typing` | Web Speech API / manual | Browser testing + typing fallback. |

`auto` (default) picks the best available: cloud when a key is configured, else an on-device model, else OS speech. A pill in the Recite header switches providers live for A/B comparison.

**Contextual biasing** is the main accuracy lever: the engine already passes the upcoming expected words via `contextualStrings`; [`app/src/lib/asr/biasing.ts`](app/src/lib/asr/biasing.ts) turns them into Deepgram keyterms / Whisper prompts / sherpa hotwords.

### Configuration

Non-secret defaults live in `app.json` `extra.asr`. Secrets/overrides come from `EXPO_PUBLIC_ASR_*` env at build time (never commit a key — use a scoped/rotatable key or a short-lived token endpoint):

```bash
EXPO_PUBLIC_ASR_DEEPGRAM_KEY=...            # enables cloud (Deepgram)
EXPO_PUBLIC_ASR_DEEPGRAM_TOKEN_URL=...      # preferred: ephemeral token endpoint
EXPO_PUBLIC_ASR_CLOUD_VENDOR=deepgram|openai
EXPO_PUBLIC_ASR_OPENAI_KEY=...              # enables OpenAI realtime alt
EXPO_PUBLIC_ASR_ONDEVICE_MODEL_URL=...      # whisper model bundle for on-device mode
EXPO_PUBLIC_ASR_MODE=auto|cloud|device|voice
```

### Benchmarks

```bash
node scripts/asr-benchmark.mjs   # offline alignment regression suite (no audio needed)
node scripts/asr-eval.mjs        # accuracy eval: WER + alignment coverage on real WAVs
```

`asr-eval.mjs` streams sample recitation clips through Deepgram / OpenAI (with and without biasing) and reports WER + alignment `matchedThrough` against expected matn words. See [`samples/asr-eval/manifest.example.json`](samples/asr-eval/manifest.example.json).

**Model references (June 2026):** Deepgram Nova-3 Arabic (streaming winner), OpenAI `gpt-realtime-whisper` / `gpt-4o-transcribe`, WhisperKit + Whisper Large v3 Turbo on ANE. Quran-fine-tuned Whisper ([tarteel-ai/whisper-base-ar-quran](https://huggingface.co/tarteel-ai/whisper-base-ar-quran)) is an optional swap for Quran only — the mutoon are classical-Arabic poems, so a general Arabic model is the default.

## Features (Phase 1)

- Library of matns with RTL reader
- Recite: hide text, mic + typing fallback, peek, mistake detail
- Listen: line-by-line TTS (replace with teacher audio + timestamps later)
- SQLite: mistakes, goals, sessions, streak
- No accounts; all data on device

## Internal beta

Share dev builds via EAS:

```bash
cd app && npx eas build --profile preview --platform all
```
