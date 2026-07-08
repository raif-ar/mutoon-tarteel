# Deepgram config sweep (2026-07-08): keep eval config; FIX the app's keyterm form

`node scripts/deepgram-sweep.mjs` (reuses `asr-eval.mjs` scoring; same 12
WAVs; `SWEEP_ONLY=<substr,…>` filters variants, `SWEEP_VERBOSE=1` per-case).
Docs verified first (developers.deepgram.com, 2026-07-08): nova-3 keyterm
prompting has **no intensifier/weight syntax** (`word:2` is the legacy
nova-2 `keywords` feature, and nova-2 has no Arabic anyway); keyterms cap at
500 tokens/request; multi-word phrase keyterms are supported; Flux (the only
newer model family) is English/multilingual with **no Arabic**. Eval lines
are 4–8 words, so keyterm counts >line-size were tested against the
app-realistic pool: the upcoming-matn window the live engine biases with
(`MIC_EXPECTED_WINDOW = 32`, `reciteEngine.ts`).

| Variant | avg WER | coverage | golden | avg latency |
|---|---|---|---|---|
| **current (kt=line words, normalized)** | **9.5%** | **100.0%** | 14/15 | 1.28s |
| kt=line + punctuate=false + numerals=false | 9.5% | 100.0% | 14/15 | 0.64s |
| kt=line, language=ar-SA | 9.5% | 100.0% | 14/15 | 0.57s |
| kt=line normalized ×3 (repetition probe) | 9.5% | 100.0% | 14/15 | 1.84s |
| kt=line normalized + vocalized (dual form) | 9.9% | 97.9% | **15/15** | 1.85s |
| kt=12 window, normalized | 10.5% | 97.9% | 14/15 | 1.08s |
| kt=whole-line phrase, normalized | 11.5% | 100.0% | 14/15 | 0.69s |
| kt=15 window, normalized | 11.5% | 97.9% | 14/15 | 0.67s |
| kt=30 window, normalized | 13.6% | 97.9% | 14/15 | 1.36s |
| kt=60 window, normalized | 22.0% | 97.9% | 14/15 | 1.13s |
| kt=whole-line phrase, vocalized | 26.4% | 97.9% | 14/15 | 1.54s |
| kt=line, vocalized (tashkeel) | 26.9% | 100.0% | 14/15 | 1.34s |
| **kt=32 window, vocalized (≈ live app config)** | **27.4%** | 91.7% | 14/15 | 0.81s |
| unbiased (kt=0) | 30.6% | 82.9% | 14/15 | 1.44s |
| nova-2 | — | — | — | 400 "no such model/language" |

Findings:

1. **No eval-config change adopted.** Nothing beats the current
   `asr-eval.mjs` default (nova-3, `language=ar`, `smart_format=false`,
   normalized keyterms) on the gate criteria. `punctuate=false` /
   `numerals=false` are default-off no-ops; `ar-SA` is identical to `ar`;
   keyterm repetition does nothing (consistent with "no weighting" docs).
2. **Keyterm form dominates everything else.** Vocalized (tashkeel) keyterms
   score barely better than *no biasing at all* (26.9% vs 30.6%); the same
   words normalized score 9.5%. Dilution is second: every keyterm beyond the
   immediate line costs accuracy (12→10.5%, 15→11.5%, 30→13.6%, 60→22.0%).
3. **The live app sent a near-worst combination — FIXED (applied same day).**
   `biasing.ts biasVariants` put the *vocalized surface form first* for every
   word with a 60-term budget over a 32-word window (pure-vocalized 32-window
   proxy: **27.4% / 91.7%**). Applied: `biasVariants` now emits the
   normalized form only (+ clipped rhyme alif), and `reciteEngine.ts`
   tightened `MIC_EXPECTED_WINDOW` 32→16 / `MIC_REBIAS_ADVANCE` 12→8.
   Measured proxy for the exact new payload
   (`kt=16 window, norm+clipped`): **17.0% / 97.9% / golden 14/15**.
   The clipped-alif variants cost ~3.4 WER pts on this proxy (16-window
   normalized-only scores 13.6%) but were added for a *live* failure the
   batch proxy cannot reproduce (rhyme-word stuck clusters, see README) —
   kept pending an on-device A/B. Caveat: sweep is batch REST over
   single-line WAVs; re-verify on-device (streaming websocket, moving
   window) via the recite log gates before trusting the deltas.
4. Dual-form keyterms (normalized + vocalized) is the only variant to
   recover all 15 golden words (fixes `خَمْسَةٍ` on noon_l019) but it costs
   coverage (noon_l003 drops to 3/4) and WER — not adopted; noted as a
   candidate if golden recovery ever outranks coverage.

# Reconcile tuning (2026-07-08, align-trust-v5 stamp) — device gates GREEN

Fresh on-device fixture pair (iPhone 13): `2026-07-08T16-26-59` (clean) +
`2026-07-08T16-28-37` (seeded, 5 swaps, no omissions — `#61` was initially
labeled a swap from memory but the heardTimeline shows it recited correctly;
reclassified on acoustic evidence). First fixtures with `session.heardTimeline`,
so the reconcile finally ran against real data. Gates:
`npm run recite:golden-device` / `recite:seeded-device`.

## Pre-tuning findings (what the fresh fixtures exposed)

- Clean log: 1 live false red (`#55 فَلْتَعْرِفِ` heard `تعريفي`) and the
  reconcile as shipped would have painted **7 false reds** on a clean
  recitation — it trusted truncated tokens (`وللت` ⊑ `وَلِلتَّنْوِينِ`,
  `بيني` ⊑ `تَبْيِينِي`) and low-confidence short garbles (`عام` c=0.72 for
  `عَلَى`, `هاء` c=0.83 for `حَاءُ`) as substitution evidence, and misread the
  merged token `الميهيذ` (= `الميهي` + `ذي`) as an omission of `ذي`.

## Fixes (all three verified by the gates)

1. **Subsequence-garble rejection** (`align.ts competingTokenIfSubstitution`):
   a candidate that is a pure ordered subsequence of the expected word (or
   vice versa, over core variants, no length cap) is a truncation/stretch of
   the correct word, not swap evidence. A real swap substitutes a consonant
   and never survives this test (checked against all 9 labeled swaps).
2. **Confidence-by-length gating** (`acousticReconcile.ts`): substitution
   evidence requires ASR confidence ≥ 0.85 (token ≤3 chars) / 0.75 (4) /
   0.60 (5+). Below, the word falls through to the timing test.
3. **Merged-into-anchor suppression** (`acousticReconcile.ts`): an unmatched
   word whose neighboring anchor token is longer than the anchor word and
   fuzzy-matches the two matn words concatenated was spoken, not omitted.

The `recite-align-test.mjs` sweep now replays the REAL `acousticReconcile`
for the RECONCILE_ON_FINAL clearing simulation when the log has a timeline
(matching engine behavior), instead of the token-presence approximation.

## Post-tuning results

| Gate | Result |
|---|---|
| golden-device (clean) | **0 false reds** — live's 1 red clears on final; reconcile: 0 human reds, 9 ASR drops suppressed |
| seeded-device | live 3/5 swaps (precision 100%); **reconcile 5/5 swaps, 0 false reds, 0 false omissions** |
| June golden / seeded | unchanged, ALL PASS |
| `asr:benchmark` | 16/16 |

Thresholds are tuned on n=2 device sessions — re-validate when new fixture
pairs land (margin is thin for ≤3-char tokens: false garbles at c≤0.83 vs
real swaps at c≥0.88).

# Cohere Transcribe Arabic gate (2026-07-08): NOT PASSED — no second-opinion stage

Evaluated `CohereLabs/cohere-transcribe-arabic-07-2026` (2B, Apache 2.0, top
open-source model on the Open Universal Arabic ASR Leaderboard) as a
*post-session second-opinion* candidate — it has no word timestamps, no
streaming, and no biasing, so it was never a live-path candidate. Run via
`COHERE_PY` + `scripts/cohere-sidecar.py` on the same 12 WAVs (MPS, bf16):

| Engine | avg WER | coverage | golden | latency |
|---|---|---|---|---|
| deepgram/biased | **9.5%** | **100%** | **14/15** | 1.6s |
| cohere/unbiased | 27.9% | 97.1% | 13/15 | **0.24s** (RTF 0.03) |
| deepgram/unbiased | 30.6% | 82.9% | 14/15 | 1.5s |

Verdict: loses to biased Deepgram on all three gate criteria — a Cohere
re-transcription pass would not recover anything the biased stream misses.
Notable: unbiased-vs-unbiased it beats Deepgram (leaderboard claim holds),
and it emits fully vocalized text (يَقُولُ رَاجِي رَحْمَةِ الْغَفُورِ
letter-perfect with tashkeel) — worth remembering if we ever need a
diacritized transcript. Matn keyterm biasing remains our decisive lever, and
only Deepgram offers it.

Also evaluated **yazinsai/tilawa** (the repo, not just its model): it does
verse *identification* (CTC decode → retrieval over 6,236 precomputed
verses), not word-level tracking — no forced alignment to adopt. Its model
is the same FastConformer gated below. Its int4/int8 ONNX quantization
(88 MB, onnxruntime-react-native) is the designated recipe if an offline
mode is ever built.

# FastConformer decision gate (2026-07-08): NOT PASSED — stay on Deepgram

Ran `asr-eval.mjs` with the sidecar (12 recorded WAVs, `.venv-fc` NeMo):
unbiased FastConformer avg WER 22.9% / coverage 91.1% vs biased Deepgram
9.5% / 100%. Golden recovery tied (14/15), RTF 0.03 (33× realtime). Verdict:
loses on WER + coverage → no on-device port for now; revisit if biasing-free
operation or offline mode becomes a requirement.

---

# Accuracy baseline (2026-07-04)

## Results after align-trust-v5 (matcher layers + rolling reconcile)

| Metric | v3 (logged) | v4 (pre-change) | v5 (current) |
|---|---|---|---|
| Golden log false reds | 13 | 1 (`النَّظْمُ`) | **0** |
| Golden match % | 91.0% | 99.3% | **100.0%** |
| Seeded false reds | — | 2 (`ثَنَا`, `تُقًى`) | **0** |
| Seeded swaps caught | — | 3/4 | 3/4 (unchanged — `شَيْخِنَا` never got an ASR candidate) |
| Seeded match % | 89.5% | 96.5% | **97.9%** |

What changed: indel-only bounded fuzz + phonetic collapse + merged-token tails
in `wordMatch` (align.ts / lev.ts), rolling acoustic reconcile on cloud finals
(`RECONCILE_ON_FINAL`, holdback 3), warmup 300→150ms, partial cap 6→8,
emit debounce 80→50ms. Gates: `recite:golden` / `recite:seeded` +
adjacent-matn-word collision sweep in `recite-align-test.mjs`.

---

# Pre-change baseline (align-trust-v4 code, recorded before the v5 work)

Recorded before the align-trust-v5 matcher work so every change can be diffed
against it. Commands: `npm run recite:golden` / `npm run recite:seeded`
(both wrap `scripts/recite-align-test.mjs` with `--max-false-subs=0`).

Both checked-in logs are from build `align-trust-v3` (no `session.heardTimeline`,
so the acoustic-reconcile section is skipped — capture fresh v4+ device logs to
exercise it; see "Fixtures needed" below).

## Golden log (clean recitation, 2026-06-04T16-42-24)

- v3 painted 13 reds live (all false — ASR drops/garbles).
- v4 projected policy (suppress omissions, paint substitutions): **1 false red**
  - `#18 النَّظْمُ` heard `المظلوم` — ASR garble beyond edit-distance repair;
    presence probe shows `النظم` PRESENT later in the stream → recoverable by
    rolling reconcile, not by word matching.
- Presence probe: 7/13 false-red words PRESENT in the reconstructed heard stream
  (recoverable by reconcile); 6 ABSENT (only recoverable from audio timings).
- match% projected: 99.3% (v3: 91.0%).

## Seeded log (intentional errors, 2026-06-04T17-17-12)

- v3 painted 15 reds.
- v4 projected: 5 substitutions
  - labeled swaps caught: 3/4 (`#48 فَالْأَوَّلُ`, `#65 وَالثَّانِي`, `#85 بِكَلِمَةٍ`);
    `#28 شَيْخِنَا` missed — ASR never emitted a candidate (ABSENT in probe).
  - **2 false reds:**
    - `#131 ثَنَا` heard `صيفثانا` — ASR merged `صِفْ ذَا ثَنَا` mnemonic words
      into one token.
    - `#141 تُقًى` heard `طوقا` — emphatic ط/ت confusion + final-alif variance.
- match% projected: 96.5% (v3: 89.5%).

## Regression suites

- `npm run asr:benchmark`: 16/16.
- `node scripts/recite-align-test.mjs` unit cases: ALL PASS.

## Fixtures needed (user action)

1. 10–15 sample WAVs in `samples/asr-eval/` (rhyme-word lines الطُّلَّابَا /
   تَلَا / وَآلِهِ and the mnemonic line صِفْ ذَا ثَنَا…) for the FastConformer
   decision-gate eval.
2. Fresh device log pairs (clean + seeded) from a v4+ build so
   `session.heardTimeline` exists for reconcile tuning (`--min-gap` sweep).
