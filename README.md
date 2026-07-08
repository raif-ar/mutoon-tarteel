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

- **iOS / Android (mic):** `npx expo run:ios` or `npx expo run:android`. Recite streams the mic (`@siteed/audio-studio`) to the cloud recognizer — a dev-client / EAS build is required (does not run in Expo Go).
- **Web:** `npm run web` runs the UI for layout work, but Recite needs the native mic, so use a device/simulator build to test recognition. Alignment logic can be exercised offline with `scripts/asr-benchmark.mjs`.

## Content

- Schema: [`content/schema/matn.schema.json`](content/schema/matn.schema.json)
- **Tuhfat al-Atfal:** Wikisource-based edition (verify against your mushaf)
- Edit sources in `content/scripts/generate-content.mjs`, then regenerate

## ASR / mistake detection

Pipeline:

1. 16 kHz audio → Arabic ASR (pluggable provider, see below)
2. Arabic normalization (optional tashkeel strip)
3. **Forced alignment** to expected `words[]` for the current line ([`app/src/lib/asr/align.ts`](app/src/lib/asr/align.ts))

The recognizer sits behind the `AsrProvider` seam ([`app/src/lib/asr/types.ts`](app/src/lib/asr/types.ts)) and shares the transcript accumulator + alignment engine, so the cloud vendor is swappable without touching alignment.

### Provider (cloud-only)

The app uses a **single streaming cloud recognizer**. On-device Whisper and OS-speech were removed to focus on perfecting the cloud path (live re-biasing, alignment, logging).

| Vendor | Backend | Notes |
|--------|---------|-------|
| `deepgram` (default) | **Deepgram Nova-3 Arabic** | Streaming WebSocket; `keyterm` biasing from upcoming matn words; live re-bias as the cursor advances. |
| `openai` (alt) | **OpenAI `gpt-realtime-whisper`** | Realtime transcription with a `prompt` seed; selected via `EXPO_PUBLIC_ASR_CLOUD_VENDOR=openai`. |

The mic is captured as 16 kHz PCM via `@siteed/audio-studio` and streamed to the vendor. If the mic, network, or credentials are unavailable, recite surfaces the error (there is no on-device fallback).

**Contextual biasing** is the main accuracy lever: the engine passes the upcoming expected words via `contextualStrings`, and [`app/src/lib/asr/biasing.ts`](app/src/lib/asr/biasing.ts) turns them into Deepgram keyterms (or an OpenAI prompt). Each word also seeds a **tashkeel-stripped** form (Nova-3 emits unvoweled Arabic) and the clipped **verse-end alif** (`الطلابا → الطلاب`) so rhyme words still anchor. The engine **re-biases mid-recitation** (`reciteEngine.maybeRefreshBias`) by swapping the Deepgram socket without dropping audio as the cursor moves forward.

### Configuration

Non-secret defaults live in `app.json` `extra.asr`. Secrets/overrides come from `EXPO_PUBLIC_ASR_*` env at build time (never commit a key — use a scoped/rotatable key or a short-lived token endpoint):

```bash
EXPO_PUBLIC_ASR_DEEPGRAM_KEY=...            # required for recite (Deepgram)
EXPO_PUBLIC_ASR_DEEPGRAM_TOKEN_URL=...      # preferred: ephemeral token endpoint
EXPO_PUBLIC_ASR_CLOUD_VENDOR=deepgram|openai
EXPO_PUBLIC_ASR_OPENAI_KEY=...              # only if vendor=openai
```

Cloud is the only recognizer, so a key (or token endpoint) is required for recite to run.

### Matching (align-trust-v5)

Beyond the exact normalization variants, `wordMatch` accepts bounded **indel-only fuzz**
(1–2 dropped letters as an ordered subsequence, similarity ≥ 0.75 — substituted
consonants never match, so real recitation errors stay red), a **phonetic collapse**
for ASR confusions (emphatic ط/ظ/ض/ص → plain twin, final-alif ↔ ya: `طوقا ↔ تُقًى`),
and **merged-token tails** (`صيفثانا ↔ ثَنَا` when ASR fuses adjacent short words).
The acoustic reconcile now also runs on every cloud *final* (`RECONCILE_ON_FINAL`,
3-word holdback), so interim garbles are cleared within a segment and real omissions
paint within seconds instead of at session stop.

### Benchmarks

```bash
node scripts/asr-benchmark.mjs        # offline alignment regression suite (no audio needed)
node scripts/recite-align-test.mjs    # exercises the REAL align.ts (authoritative gate)
npm --prefix app run recite:golden    # clean-recitation log gate (0 false reds)
npm --prefix app run recite:seeded    # seeded-errors log gate (swaps still caught)
node scripts/asr-eval.mjs             # accuracy eval: WER + alignment coverage on real WAVs
```

`asr-eval.mjs` streams sample recitation clips through Deepgram / OpenAI (with and without biasing) and reports WER + alignment `matchedThrough` against expected matn words. See [`samples/asr-eval/manifest.example.json`](samples/asr-eval/manifest.example.json). Baseline numbers: [`docs/ACCURACY_BASELINE.md`](docs/ACCURACY_BASELINE.md).

**FastConformer decision gate:** set `FASTCONFORMER_PY` to a venv python with NeMo installed (setup in [`scripts/fastconformer-sidecar.py`](scripts/fastconformer-sidecar.py)) and `asr-eval.mjs` also runs NVIDIA's Arabic FastConformer (the [tilawa](https://github.com/yazinsai/tilawa) model) offline over the same WAVs, printing a WER/coverage/latency table and a go/no-go verdict for an on-device port (criteria: unbiased FastConformer beats biased Deepgram on WER + coverage, recovers ≥75% of labeled golden false-red words, RTF < 0.5).

**Model references (June 2026):** Deepgram Nova-3 Arabic (streaming winner, default), OpenAI `gpt-realtime-whisper` / `gpt-4o-transcribe` (alt). On-device Whisper/WhisperKit was removed for now; if offline recitation is revived later, Whisper Large v3 Turbo on ANE is the candidate. The mutoon are classical-Arabic poems, so a general Arabic model (not a Quran-fine-tuned one) is the right base.

## Features (Phase 1)

- Library of matns with RTL reader
- Recite: hide text, live mic (cloud ASR), peek, mistake detail, share-log button
- Listen: line-by-line TTS (replace with teacher audio + timestamps later)
- SQLite: mistakes, goals, sessions, streak
- No accounts; all data on device

## Internal beta

Share dev builds via EAS:

```bash
cd app && npx eas build --profile preview --platform all
```
