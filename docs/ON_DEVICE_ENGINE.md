# On-device Recite engine (2026-11-25)

Recite runs on the phone. No server, no API key, no audio stored or uploaded.

```
mic (16 kHz PCM) -> listener model (phonemes) -> live aligner -> word cursor + slips
                    ONNX Runtime, native          app/src/lib/recite/phonemeAlign.ts
```

## Why this engine

Deepgram needed a key inside the app and a network. Two on-device options were tested on the same audio
(12 recorded lines of Tuhfat al-Atfal, 61 words, plus 5 synthetic clips with planted mistakes):

| | Deepgram (before) | Tilawa model + our aligner | Whisper small (prompted) |
|---|---|---|---|
| Correct recitation | 9.5% WER | 0 false reds on the 61 recorded words | 2.1% WER (41.5% unprompted) |
| Planted mistakes | 3/5 live, 5/5 after stop (device session) | 4/4 | 4/4 visible in transcript |
| Repeats, restarts, a left-out line | not tested | repeat a line: 0 reds; go back two lines: 0 reds; leave a line out: its 4 words flagged, 0 elsewhere | not tested |
| Live | yes, ~1 s behind | yes, verdict ~1.2 s after the word (p90 1.8 s) | no (re-transcribes chunks) |
| Size | none | 68 MB | 190-490 MB |

The rows are not like for like (WER vs. words marked wrong), and the Tilawa column is `npm run recite:gate`.
The gate judges the same 61 words three ways (each line alone, all lines stitched into one session, and beside
planted mistakes: 188 verdicts) and each of the 4 planted mistakes twice (alone and inside a session).
Tilawa's own tracker and checker are tuned for Quran recitation and lost the start and end of passages on mutoon;
its acoustic model is not tied to Quran text, so we use only the model and align against the matn ourselves.
The 25 MB lite model gave 1 false red on the gate, so the full model ships.

## Pieces

| Piece | Where | Notes |
|---|---|---|
| Phonemizer | `app/src/lib/recite/phonemize.ts` | vocalized matn text -> phonemes, connected speech within a line, pause form at line end |
| Listener | `app/src/lib/recite/listener/` | filterbank + streaming Zipformer + greedy CTC. Ported from `@tilawa/core` 1.0.0-rc.1 (MIT) |
| Model | `app/assets/models/listener.onnx` (gitignored) | Tilawa `spliced-clean@1-int8`, CC BY 4.0. `scripts/fetch-listener-model.mjs`, sha-checked |
| Native runner | `app/modules/recite-listener/` | local Expo module, ONNX Runtime C++ API, keeps the ~1.8 MB model state native. iOS only |
| ONNX Runtime | `app/modules/recite-listener/ios/Frameworks/` (gitignored) | 1.31.1 from the official NuGet package, `scripts/fetch-onnxruntime-ios.mjs`, sha-checked |
| Aligner | `app/src/lib/recite/phonemeAlign.ts` | sliding dynamic program on a length-free phoneme skeleton; commits words behind the front |
| Engine | `app/src/lib/recite/reciteEngine.ts` | mic -> listener -> aligner -> state for the Recite screen |
| Gate | `scripts/recite-phoneme-gate.mjs` | recorded audio through the shipped listener, phonemizer and aligner on onnxruntime-node |

Both fetch scripts run on `npm install` in `app/`.

## Aligner rules (all in phonemeAlign.ts)

- Compare on a skeleton: long vowels fold to short, doubled sounds collapse, tajweed-only tokens drop. Chanting
  stretches vowels freely.
- The alignment front is the expected prefix that best explains everything heard, with a small reward per
  expected phoneme so "stop here, the rest is junk" does not tie with "carry on with one error".
- A word is committed once the front is 6 phonemes past it, or after 1.2 s of silence, or at stop.
- Slip = mostly wrong consonants, or cost per phoneme above 0.55. The first word after a start is lenient (the
  mic and the model clip it). One-consonant words are only flagged when completely missing.
- A word with nothing decoded is a skip only if its neighbours are tight in time; otherwise the listener
  dropped it or the reciter paused, and it is not flagged.
- A "wrong" word smeared over far more audio than it needs is a garbled stretch, not flagged.
- Going back: the path may return once to the start of an earlier word (up to 18 words behind the committed
  point) and carry on from there. Without this, a repeated line was forced onto the following words as
  mistakes (14 false reds in the restart test).
- Skipping ahead: a flat-cost jump to a later word start. A left-out line is then flagged word for word
  instead of smearing errors over its neighbours.
- A run of 3 or more undecoded words is a skipped passage even when there was time for them.
- At stop, leftover sounds that match nothing (not the next word, not earlier words) mark the next word wrong
  without moving past it.

- Pause and resume: `resetTo(word)` also restarts the aligner's clock, because the listener's frame counter
  starts again from zero on every start. Without that, the first words after a resume were timed against the
  old session and could be forgiven or flagged wrongly.

The bar is zero false reds on clean audio; catching every slip comes second.

## What a session stores (src/lib/recite/session.ts)

- Accuracy is over judged words only (green or red). Words the reciter never reached do not count.
- A session is saved as one row per unbroken run of recited lines, all with the same timestamp, so a line that
  was left out is not logged as recited. Totals count distinct timestamps, so the runs are still one session.
- Slips are stored only for lines inside a logged run. A line recited cleanly later removes its slips, in
  normal and practice sessions.
- Time counts listening only. Going to the background stops listening.

## Not verified

- A real iPhone. Verified so far: Release build on the iOS simulator, where Settings > Check listening runs a
  bundled clip through the native model (all 4 words followed, 20x real time on the Mac's CPU).
- The live microphone path (the simulator proof uses file audio). Resampling quality from the phone's mic rate
  to 16 kHz is untested.
- More than one voice. The gate is one reciter plus a synthetic voice, one matn (poetry). The two prose mutoon
  have no audio. The rules above were tuned on this same small set.
- Audio interruptions (a phone call, Siri) while listening. Going to the background is handled; the
  interruption event itself is not.
- Android. The native runner is iOS only; Recite reports that listening is not available there.
- Tilawa is a release candidate. The listener code is vendored, so an upstream change cannot break the app,
  but model updates must be pulled in by hand.

## Upstream state to know about (2026-11-25)

`github.com/microsoft/onnxruntime` returned 404 and the CocoaPods archive host for `onnxruntime-c` served a wrong
TLS certificate, so `onnxruntime-react-native` could not be installed. NuGet still publishes the official
packages (1.32.0 on 2026-11-13), which is where the framework comes from. If that changes, the fallbacks are a
sherpa-onnx binding (bundles its own runtime; needs a metadata-patched model) or on-device Whisper.

## Attribution (shown in Settings > Credits)

- Listener model: Tilawa `spliced-clean` by yazinsai, CC BY 4.0, built on tlog (Tarteel, CC-BY) and Quranic
  Universal Ayahs (QUD Technologies, CC-BY), distilled from `obadx/muaalem-model-v3_2` (MIT), architecture from
  k2-fsa icefall (Apache-2.0).
- Listener code: `@tilawa/core` (MIT, Copyright (c) 2026 yazinsai).
- ONNX Runtime (MIT, Microsoft).
