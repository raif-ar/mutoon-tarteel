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

- Evidence first. Speech that is not the recitation (someone talking nearby, other lines, another language)
  still lines up with the expected words at a mediocre cost, about 0.3 to 0.7 per phoneme, and the lenient
  rules above passed half of it as recited. Over a long expected text it also hits some words well by chance,
  but it brings its own sounds along. So a word is "clearly heard" when its cost is 0.25 or less, it has two
  consonants or more with most of them right, at most one extra sound was heard inside it, and it is not
  spread thin over time: 84% of real recited words are, under 3% of other speech is.
  - A word is shown or judged only up to a clearly heard word that has a second one within two words of it,
    or that follows at most two unclear words while three of the last four judged words were clear.
  - At a pause, a batch that is mostly clear goes through; otherwise one unclear word, on the strength of the
    words before it. At stop, and on the last words of the session (no later word can vouch for them), two.
  - While the reciter is clearly followed, one passable word may light up early (shown, not judged). It gets
    its verdict at stop at the latest, so nothing on screen counts as recited without a verdict.
  - A session starts unlocked, so the first words light up together about a second later. The lock is kept
    across pause, resume and rewind (dropping it left too few words to lock again near the end of a session).
    It is dropped when 48 sounds have piled up with no word released.
  - A wrong attempt at stop ("the next word was said wrong") is reported only on the word the reciter is on,
    when every word before it is released.
- A word is only called wrong when two consonants were heard in its place. One stray sound is not a word.
- An undecided (dropped or paused) word right before a word that was certainly skipped is skipped too.
- Pause and resume: `resetTo(word)` also restarts the aligner's clock, because the listener's frame counter
  starts again from zero on every start. Without that, the first words after a resume were timed against the
  old session and could be forgiven or flagged wrongly.

The bar is zero false reds on clean audio, and nothing shown as recited when the audio is not the
recitation; catching every slip comes second. The gate checks both, on: silence and noise, other lines and
English against long expected texts (0 of 585 words shown), other speech before the recitation, other speech
after the reciter was followed (1 of 96 words shown, none judged), a pause before the last words (22 of 22
lines still finish), and one-line sessions finishing by themselves (12 of 12). `--no-evidence` shows what the
rule stops.

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
- The live microphone path with a real reciter. On the simulator the microphone starts, the level meter and
  timer run and the session saves, but nobody recited into it. Resampling quality from the phone's mic rate to
  16 kHz is untested.
- Background speech on a real phone. The evidence rule is tuned on 61 recorded words and 213 words of other
  speech; a long stretch of talk can still by chance produce two clear words close together.
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
