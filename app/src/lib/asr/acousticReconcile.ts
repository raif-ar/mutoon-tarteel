import { competingTokenIfSubstitution, wordMatch } from "./align";
import { normalizeWord, type NormalizeOptions } from "./normalize";
import type { HeardWord } from "./types";

/**
 * Acoustic reconciliation: the post-session pass that finally separates a human
 * omission from an ASR drop.
 *
 * The live cursor and a text-only batch align both hit the same wall — a matn
 * word with no matching heard token is ambiguous: the reciter may have skipped
 * it (a real mistake) or said it while the recognizer dropped it (a false red).
 * Text cannot tell them apart. The acoustic timeline can: anchor the matn to the
 * recognized words by exact (fuzzy) match, then look at the time *between* two
 * anchors. If enough audio elapsed to fit the missing word, the reciter almost
 * certainly spoke it (ASR drop → suppress). If the anchors are adjacent in time,
 * nothing was said there (real omission → keep). A non-matching word sitting in
 * that window is a substitution (the wrong word was heard).
 *
 * This is intentionally anchor-only (an LCS over fuzzy-equal words): we never
 * take a "diagonal mismatch", so unmatched words are decided by timing/locality,
 * not by alignment tie-breaks — the same discipline as the live scanner.
 */

/** Below this, no real Arabic word fits the inter-anchor gap (tune on device logs). */
export const MIN_WORD_GAP_SEC = 0.22;

/**
 * Minimum ASR confidence for a heard token to count as substitution evidence,
 * by normalized token length. Short tokens carry little phonetic signal, so a
 * short low-confidence token is far more likely a garble of the correct word
 * than a real swap (عام c=0.72 for عَلَى, هاء c=0.83 for حَاءُ — both clean
 * recitations) while a real short swap is emitted confidently (ذلك c=0.985).
 * Tuned on the 2026-07-08 device fixture pair; below threshold the token is
 * ignored and the word falls through to the timing test.
 */
function minSubstitutionConfidence(tokenLength: number): number {
  if (tokenLength <= 3) return 0.85;
  if (tokenLength === 4) return 0.75;
  return 0.6;
}

export type ReconcileCause = "omission" | "asrDrop" | "substitution";

export interface ReconcileMistake {
  expectedIndex: number;
  expectedWord: string;
  kind: "missed" | "wrong";
  recognizedWord: string | null;
  cause: ReconcileCause;
  /** Audio seconds available in the inter-anchor block (for inspection/tuning). */
  gapSec: number;
  /** Heard-token confidence for substitutions; null for omissions. */
  confidence: number | null;
}

export interface AcousticReconcileResult {
  /** Human errors to paint: omissions + substitutions. */
  mistakes: ReconcileMistake[];
  /** ASR drops, suppressed because audio covered the missing word. */
  drops: ReconcileMistake[];
  /** Count of matn words anchored to a heard token. */
  matched: number;
}

/** LCS anchor pairs [matnIndex, heardIndex] under a fuzzy word equality. */
function lcsAnchors(
  matn: string[],
  heard: HeardWord[],
  eq: (i: number, j: number) => boolean
): Array<[number, number]> {
  const m = matn.length;
  const n = heard.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = eq(i, j)
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (eq(i, j)) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

/**
 * Reconcile the matn against a recognized word timeline.
 *
 * @param matnWords  Expected words (raw; normalized internally via wordMatch).
 * @param timeline   Recognized words with session-clock timings + confidence.
 */
export function acousticReconcile(
  matnWords: string[],
  timeline: HeardWord[],
  options: NormalizeOptions = { stripTashkeel: true, unifyAlef: true },
  minGapSec: number = MIN_WORD_GAP_SEC
): AcousticReconcileResult {
  // wordMatch convention is (heard, expected) — merged-token tail matching
  // is directional, so the timeline word goes first.
  const eq = (i: number, j: number) =>
    wordMatch(timeline[j].word, matnWords[i], options);
  const anchors = lcsAnchors(matnWords, timeline, eq);

  const mistakes: ReconcileMistake[] = [];
  const drops: ReconcileMistake[] = [];

  const lastHeardEnd = timeline.length ? timeline[timeline.length - 1].end : 0;

  // Walk the blocks between consecutive anchors (with virtual endpoints).
  let prevMatn = -1;
  let prevHeard = -1;
  let prevEndSec = 0;
  const steps = [...anchors, [matnWords.length, timeline.length] as [number, number]];

  for (const [aM, aH] of steps) {
    const gapMatn: number[] = [];
    for (let i = prevMatn + 1; i < aM; i++) gapMatn.push(i);
    const gapHeard: HeardWord[] = [];
    for (let j = prevHeard + 1; j < aH; j++) gapHeard.push(timeline[j]);

    if (gapMatn.length > 0) {
      const windowStart = prevEndSec;
      const windowEnd = aH < timeline.length ? timeline[aH].start : lastHeardEnd;
      const windowDur = Math.max(0, windowEnd - windowStart);
      const perWord = windowDur / gapMatn.length;

      // Upcoming matn words guard against pairing a token that is really the
      // next correct word surfacing early (an ASR reorder, not a swap).
      const aheadWords = [matnWords[aM], matnWords[aM + 1], matnWords[aM + 2]]
        .filter((w): w is string => Boolean(w));
      const subCount = Math.min(gapMatn.length, gapHeard.length);

      // ASR merges a short matn word into the neighboring anchor's token
      // (الميهي + ذي heard as one token "الميهيذ"): the anchor token carries
      // extra letters and fuzzy-matches the two matn words concatenated. The
      // word was spoken — suppress as a drop instead of flagging an omission.
      // The strict length check keeps a clean anchor token (no extra letters)
      // from absorbing a genuinely omitted 2-letter neighbor via indel slack.
      const mergedIntoAnchor = (mi: number): boolean => {
        if (mi === prevMatn + 1 && prevHeard >= 0) {
          const tok = normalizeWord(timeline[prevHeard].word, options);
          const anchor = normalizeWord(matnWords[prevMatn], options);
          if (
            tok.length > anchor.length &&
            wordMatch(timeline[prevHeard].word, matnWords[prevMatn] + matnWords[mi], options)
          ) {
            return true;
          }
        }
        if (mi === aM - 1 && aH < timeline.length && aM < matnWords.length) {
          const tok = normalizeWord(timeline[aH].word, options);
          const anchor = normalizeWord(matnWords[aM], options);
          if (
            tok.length > anchor.length &&
            wordMatch(timeline[aH].word, matnWords[mi] + matnWords[aM], options)
          ) {
            return true;
          }
        }
        return false;
      };

      gapMatn.forEach((mi, k) => {
        if (k < subCount) {
          const tok = gapHeard[k];
          // Only a token that is a *genuine* wrong word counts as a swap; ASR
          // fragments and near-variants of the expected word (garble of the
          // correct recitation) fall through to the timing test instead. A
          // token below the confidence floor for its length is treated the
          // same way — weak audio evidence must not paint a red.
          const confOk =
            tok.confidence == null ||
            tok.confidence >=
              minSubstitutionConfidence(normalizeWord(tok.word, options).length);
          const competing = confOk
            ? competingTokenIfSubstitution(tok.word, matnWords[mi], aheadWords, options)
            : null;
          if (competing) {
            mistakes.push({
              expectedIndex: mi,
              expectedWord: matnWords[mi],
              kind: "wrong",
              recognizedWord: competing,
              cause: "substitution",
              gapSec: windowDur,
              confidence: tok.confidence,
            });
            return;
          }
        }
        // No trustworthy competing token: timing decides drop vs omission —
        // unless the word audibly lives inside a neighboring anchor token.
        const isDrop = perWord >= minGapSec || mergedIntoAnchor(mi);
        const entry: ReconcileMistake = {
          expectedIndex: mi,
          expectedWord: matnWords[mi],
          kind: "missed",
          recognizedWord: null,
          cause: isDrop ? "asrDrop" : "omission",
          gapSec: windowDur,
          confidence: null,
        };
        if (isDrop) drops.push(entry);
        else mistakes.push(entry);
      });
    }

    if (aM < matnWords.length) {
      prevMatn = aM;
      prevHeard = aH;
      prevEndSec = timeline[aH].end;
    }
  }

  return { mistakes, drops, matched: anchors.length };
}
