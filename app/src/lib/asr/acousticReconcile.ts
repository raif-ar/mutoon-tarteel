import { competingTokenIfSubstitution, wordMatch } from "./align";
import type { NormalizeOptions } from "./normalize";
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
      gapMatn.forEach((mi, k) => {
        if (k < subCount) {
          const tok = gapHeard[k];
          // Only a token that is a *genuine* wrong word counts as a swap; ASR
          // fragments and near-variants of the expected word (garble of the
          // correct recitation) fall through to the timing test instead.
          const competing = competingTokenIfSubstitution(
            tok.word,
            matnWords[mi],
            aheadWords,
            options
          );
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
        // No trustworthy competing token: timing decides drop vs omission.
        const isDrop = perWord >= minGapSec;
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
