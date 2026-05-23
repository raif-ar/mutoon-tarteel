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

Pipeline (see plan):

1. 16 kHz audio → Arabic ASR (`expo-speech-recognition` on device; Web Speech on web)
2. Arabic normalization (optional tashkeel strip)
3. **Forced alignment** to expected `words[]` for the current line ([`app/src/lib/asr/align.ts`](app/src/lib/asr/align.ts))

Offline alignment benchmark:

```bash
node scripts/asr-benchmark.mjs
```

**On-device models (optional upgrade):**

- [yazinsai/offline-tarteel](https://github.com/yazinsai/offline-tarteel) FastConformer ONNX (~131 MB)
- [tarteel-ai/whisper-base-ar-quran](https://huggingface.co/tarteel-ai/whisper-base-ar-quran) — transcribe then align

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
