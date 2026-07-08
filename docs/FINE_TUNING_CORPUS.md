# Fine-tuning corpus collection

The long-game accuracy step is a model adapted to mutoon recitation (classical
Arabic verse, memorization cadence, rhyme-word trail-offs). Every recite
session can contribute a training example — the app already logs transcripts,
word timings, confidences, and reciter-labeled mistakes; the missing piece was
audio.

## What a corpus example looks like

| Piece | Source |
|---|---|
| 16 kHz mono WAV | `EXPO_PUBLIC_RECITE_SAVE_AUDIO=1` build → `recite-logs/<ts>_session_audio.wav` (src/lib/asr/sessionAudioRecorder.ts) |
| Ground-truth text | the matn lines recited (session log records matnId + start/end range) |
| ASR hypothesis + timings | `session.heardTimeline` in the recite log |
| Reciter labels | `samples/recite-logs/*_labels.json` (intentional vs ASR-artifact mistakes) |

## Collection workflow

1. Build the dev client with `EXPO_PUBLIC_RECITE_SAVE_AUDIO=1`.
2. Recite normally. Each listening stretch writes one WAV segment next to the
   text log (a mid-session recognition restart starts a new segment).
3. Pull pairs with `npm run recite:pull` (fixture workflow) — it fetches both
   logs and WAVs from the device.
4. Label per the existing fixture process (confirm intentional mistakes).

## Privacy / consent

Audio recording is **opt-in at build time** and never ships enabled in a
release build. If external reciters ever contribute, add explicit in-app
consent before flipping the flag for them.

## When is it enough to fine-tune?

Rules of thumb (Deepgram custom-model training and Whisper LoRA experience):
- **~2–5 hours** of labeled audio: enough for a first adaptation experiment
  (expect the biggest gains on the failure modes we log: rhyme-word
  trail-offs, merged short words, emphatic-consonant confusions).
- **10+ hours across multiple reciters**: enough to expect a durable WER win
  over biased Nova-3 (current baseline: 9.5% WER / 100% coverage on the
  12-clip eval, docs/ACCURACY_BASELINE.md).

Candidate paths, in preference order:
1. **Deepgram custom model training** on Nova-3 Arabic — keeps streaming +
   keyterm biasing, no infra.
2. **FastConformer fine-tune** (NeMo, the tilawa base) — opens the offline
   door; pairs with their proven 88 MB int4/int8 ONNX RN deployment recipe.
3. **Cohere Transcribe Arabic LoRA** — best open-source base WER, but batch
   only (no timestamps/streaming), so only useful as a post-session pass.

Until one of these gates is reached, the corpus grows passively — the only
discipline needed is recording sessions with the flag on and labeling the
occasional fixture pair.
