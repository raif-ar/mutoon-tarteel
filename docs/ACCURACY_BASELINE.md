# Fresh device fixtures (2026-07-08) — first pairs with `session.heardTimeline`

Recorded on-device (iPhone 13, v5 code, stamp still reads v4) and labeled by the
reciter: `2026-07-08T16-26-59` (clean) + `2026-07-08T16-28-37` (seeded, 6 swaps,
no omissions). Gates: `npm run recite:golden-device` / `recite:seeded-device`.

## Findings (why the reconcile needs tuning before RECONCILE_AT_STOP ships)

- **Clean log FAILS the live gate**: 1 false red — `#55 فَلْتَعْرِفِ` heard
  `تعريفي` (metathesis-ish garble `wordMatch` rejects).
- **Reconcile on the clean session would paint 7 false reds** (0 real): ASR
  quality on this session was much worse than the June logs (confidences
  0.3–0.8), and the reconcile trusts heard tokens as substitution evidence.
  Several are truncations the matcher should absorb (`وللت` ⊑ `وَلِلتَّنْوِينِ`,
  `بيني` ⊑ `تَبْيِينِي`) — the reconcile's matcher lacks `wordMatch`'s
  indel/tail acceptance.
- **Seeded log PASSES live** (4 reds, all real; precision 100%, recall 4/6).
  Reconcile additionally recovers `#7` and `#23` (good) but adds the same 3
  truncation false reds (`#22`, `#43`, `#47`) and wrongly *clears* the real
  swap `#61 مُهْمَلَتَانِ` (acoustic matcher accepted `فاهاء`).

Next: sweep `--min-gap`, add confidence gating + indel/tail matching to
`acousticReconcile`, re-run both device gates until clean=0 false reds with
seeded swaps still caught.

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
