import {
  normalizeWord,
  stripCliticPrefix,
  stripDefiniteArticle,
  type NormalizeOptions,
} from "./normalize";
import { phoneticCollapse } from "./lev";

export type MistakeKind = "missed" | "wrong" | "extra" | "match";

export interface WordMistake {
  kind: MistakeKind;
  expectedIndex: number | null;
  expectedWord: string | null;
  recognizedWord: string | null;
  /** Global word index in session (primary mistake location). */
  globalWordIndex?: number;
  /** Derived for mushaf rendering only */
  lineIndex?: number;
  wordIndex?: number;
}

/** Greedy prefix scan result (relative to alignment anchor). */
export interface MatchResult {
  /** Expected words matched from anchor (0 = no progress). */
  matchedThrough: number;
  mistakes: WordMistake[];
  recognizedConsumed: number;
  recognizedTokens: string[];
  relocalized?: boolean;
  /** Global cursor after relocalize (set by engine when applicable). */
  relocalizeCursor?: number;
  debug?: Record<string, unknown>;
}

export interface AlignmentResult {
  mistakes: WordMistake[];
  matchedThrough: number;
  recognizedConsumed: number;
  recognizedTokens: string[];
}

/** Max expected words ahead of current index in one greedy step (R5, R6). */
export const LOCAL_LOOKAHEAD = 3;

/** Minimum heard words to attempt backward relocalize (R17). */
export const MIN_RELOCALIZE_WORDS = 3;

/** Never jump back more than this many words in one relocalize (prevents ASR phrase repeats). */
export const RELOCALIZE_MAX_BACK = 8;

/** How far back to search passed text when matching any heard subphrase (voice rewind). */
export const RELOCALIZE_SEARCH_BACK = 48;

/** Heard tokens scanned for backward phrase match (middle of utterance, not only tail suffix). */
export const RELOCALIZE_HEARD_WINDOW = 24;

/** Heard tokens used for backward suffix-only match (legacy path). */
export const RELOCALIZE_HEARD_TAIL = 8;

/** Minimum words rewound for phrase search to apply (avoids 1-word jitter). */
export const RELOCALIZE_MIN_BACK_WORDS = 3;

/** Minimum normalized length for fuzzy prefix match (R4). */
export const MIN_FUZZY_LENGTH = 3;

/** Tanween-stripped matn words (e.g. سِتٍّ → ست) fuzz-match ASR ه/ة suffix (سته). */
export const MIN_FUZZY_SHORT = 2;

/** Align only the recent ASR tail (cumulative iOS buffer can be 100+ tokens). */
export const RECOGNITION_ALIGN_TAIL = 24;

/** Search this many tail tokens for an anchor on the current expected word. */
export const RECOGNITION_ANCHOR_SEARCH = 16;

/** When cursor word is not in tail, match up to this many words before cursor (same utterance). */
export const TAIL_RESYNC_MAX_BACK = 10;

/** Lookback passed into alignment slice from engine. */
export const ALIGN_LOOKBACK = 8;

function stripAttachedHa(word: string, options: NormalizeOptions): string {
  const n = normalizeWord(word, options);
  if (n.endsWith("\u0647\u0627") && n.length > 3) {
    return n.slice(0, -2);
  }
  return n;
}

/** ASR often adds ي (كلامي ↔ كلم) or drops it. */
function stripPossessiveYa(word: string, options: NormalizeOptions): string {
  const n = normalizeWord(word, options);
  if (n.endsWith("\u064A") && n.length > 2) {
    return n.slice(0, -1);
  }
  return n;
}

/** Hamza/alef confusion: اضمن ↔ ضمن. */
function stripLeadingAlef(word: string, options: NormalizeOptions): string {
  const n = normalizeWord(word, options);
  if (n.startsWith("\u0627") && n.length > 2) {
    return n.slice(1);
  }
  return n;
}

/** ASR often appends ه on short words (سته for سِتٍّ, فعرف for فَلْتَعْرِفِ). */
function stripTerminalHa(word: string, options: NormalizeOptions): string {
  const n = normalizeWord(word, options);
  if (n.length > MIN_FUZZY_SHORT && n.endsWith("\u0647")) {
    return n.slice(0, -1);
  }
  return n;
}

/**
 * Tanween nunation: a matn word ending in tanween (مِيمًا, تَلْقَى) loses its
 * diacritic in normalization but keeps the seat letter (ميما), while ASR renders
 * the spoken "-an/-in/-un" with an explicit nun (ميمن). Reduce a trailing alef
 * OR nun to a shared stem so the two forms match. Length-guarded so function
 * words (مَنْ, عَنْ, لَا) are never touched.
 */
function stripTanweenTail(word: string, options: NormalizeOptions): string {
  const n = normalizeWord(word, options);
  if (n.length > MIN_FUZZY_LENGTH && (n.endsWith("\u0627") || n.endsWith("\u0646"))) {
    return n.slice(0, -1);
  }
  return n;
}

function matchVariants(word: string, options: NormalizeOptions): string[] {
  const n = normalizeWord(word, options);
  const bare = stripDefiniteArticle(word, options);
  const clitic = stripCliticPrefix(word, options);
  const cliticBare = stripDefiniteArticle(clitic, options);
  const ha = stripAttachedHa(word, options);
  const ya = stripPossessiveYa(word, options);
  const noAlef = stripLeadingAlef(word, options);
  const noTerminalHa = stripTerminalHa(word, options);
  const tanween = stripTanweenTail(word, options);
  return [
    n,
    bare,
    clitic,
    cliticBare,
    ha,
    ya,
    noAlef,
    noTerminalHa,
    tanween,
    stripAttachedHa(ya, options),
    stripLeadingAlef(ha, options),
    stripPossessiveYa(ha, options),
    stripTerminalHa(ha, options),
  ];
}

/** ASR may drop a medial letter (رتت ↔ رُتِّبَتْ) without sharing a prefix. */
function isOrderedSubsequence(shorter: string, longer: string): boolean {
  let i = 0;
  for (let j = 0; j < longer.length && i < shorter.length; j++) {
    if (longer[j] === shorter[i]) i += 1;
  }
  return i === shorter.length;
}

/** Below this, an adjacent letter swap is too likely a real short-word difference. */
const MIN_TRANSPOSE_LENGTH = 4;

/**
 * ASR metathesis: two equal-length forms differing by exactly one adjacent swap
 * (الْحُرُوفِ → "الحورف", رُتِّبَتْ-style reorderings). A reciter does not transpose
 * letters mid-word, so this is an ASR artifact and should match, not flag a red.
 */
function isSingleTransposition(x: string, y: string): boolean {
  if (x.length !== y.length || x.length < MIN_TRANSPOSE_LENGTH) return false;
  let i = 0;
  while (i < x.length && x[i] === y[i]) i += 1;
  if (i >= x.length - 1) return false;
  if (x[i] !== y[i + 1] || x[i + 1] !== y[i]) return false;
  for (let k = i + 2; k < x.length; k++) {
    if (x[k] !== y[k]) return false;
  }
  return true;
}

/** Bounded-Levenshtein acceptance: dist ≤ 2 AND similarity ≥ ratio. */
export const LEV_RATIO = 0.75;

/**
 * Edit-distance acceptance over a variant pair, indel-only: the residual
 * difference must be pure letter drops (one side an ordered subsequence of
 * the other), never a substitution — a substituted consonant is exactly what
 * a real recitation error looks like (وصلا↔اصلا, السلام↔الصلاة stay reds).
 * Guards: both sides ≥ 3 chars, dist ≤ 2, ratio ≥ {@link LEV_RATIO}.
 * Runs again on the phonetically collapsed forms so emphatic confusions
 * (طوقا ↔ تُقًى) don't pay edit cost for the ط/ت swap itself.
 */
function levAccept(x: string, y: string): boolean {
  if (Math.min(x.length, y.length) < MIN_FUZZY_LENGTH) return false;
  if (indelOnlyAccept(x, y)) return true;
  const px = phoneticCollapse(x);
  const py = phoneticCollapse(y);
  if (px === x && py === y) return false;
  if (px === py) return true;
  return indelOnlyAccept(px, py);
}

function indelOnlyAccept(x: string, y: string): boolean {
  const shorter = x.length <= y.length ? x : y;
  const longer = x.length <= y.length ? y : x;
  const gap = longer.length - shorter.length;
  if (gap === 0 || gap > 2) return false;
  if (1 - gap / longer.length < LEV_RATIO) return false;
  return isOrderedSubsequence(shorter, longer);
}

/** Variants the Levenshtein layer runs on (kept narrow to bound false positives). */
function coreVariants(word: string, options: NormalizeOptions): string[] {
  const n = normalizeWord(word, options);
  const clitic = stripCliticPrefix(word, options);
  const cliticBare = stripDefiniteArticle(clitic, options);
  const out = [n];
  if (clitic !== n) out.push(clitic);
  if (cliticBare !== n && cliticBare !== clitic) out.push(cliticBare);
  return out;
}

/**
 * ASR merges adjacent short matn words into one token (صِفْ ذَا ثَنَا heard as
 * "صيفثانا"). The expected word then lives at the *tail* of the heard token,
 * possibly stretched by an epenthetic long vowel (ثنا → ثانا). Accept only an
 * exact suffix, or a one-char-longer suffix containing the expected word as an
 * ordered subsequence — substituted letters must NOT match (a dist-1 suffix
 * rule let the joined token الغفوردوما match وَمَنْ via "وما"). Directional
 * (heard, expected); heard must be ≥ 2 chars longer than expected.
 */
function mergedTokenTailMatch(heard: string, expected: string): boolean {
  if (expected.length < MIN_FUZZY_LENGTH) return false;
  if (heard.length - expected.length < 2) return false;
  if (heard.endsWith(expected)) return true;
  const suffix = heard.slice(-(expected.length + 1));
  return isOrderedSubsequence(expected, suffix);
}

export function wordMatch(
  a: string,
  b: string,
  options: NormalizeOptions = { stripTashkeel: true }
): boolean {
  const va = matchVariants(a, options);
  const vb = matchVariants(b, options);
  for (const x of va) {
    for (const y of vb) {
      if (x === y) return true;
    }
  }

  for (const x of va) {
    for (const y of vb) {
      const shorter = x.length <= y.length ? x : y;
      const longer = x.length <= y.length ? y : x;
      if (shorter.length < MIN_FUZZY_SHORT || longer.length < MIN_FUZZY_LENGTH) {
        continue;
      }
      const lenGap = longer.length - shorter.length;
      if (lenGap > 2) continue;
      if (longer.startsWith(shorter)) {
        return true;
      }
      // ASR metathesis on the matn word (الحروف ↔ الحورف): not a human error.
      if (lenGap === 0 && isSingleTransposition(shorter, longer)) {
        return true;
      }
      // Single dropped letter inside the matn word (not a distant partial).
      if (lenGap === 1 && isOrderedSubsequence(shorter, longer)) {
        return true;
      }
    }
  }

  // Bounded edit distance over the narrow core variants (align-trust-v5).
  const ca = coreVariants(a, options);
  const cb = coreVariants(b, options);
  for (const x of ca) {
    for (const y of cb) {
      if (levAccept(x, y)) return true;
    }
  }

  // Merged-token tail: `a` is the heard token by call convention.
  const heardN = normalizeWord(a, options);
  const expectedN = normalizeWord(b, options);
  if (mergedTokenTailMatch(heardN, expectedN)) return true;

  return false;
}

/**
 * A skip-ahead miss is a *substitution* (positive evidence the reciter said a
 * different word) only when the competing heard token is not just an echo of a
 * word already recited correctly. ASR routinely re-emits the previous word(s) in
 * its cumulative tail, so without this guard those echoes would masquerade as
 * wrong words. When it returns false, the miss is an omission / ASR drop.
 *
 * align.ts has already filtered out the ahead/near-variant/fragment cases via
 * {@link competingTokenIfSubstitution}; this is the engine-side check that needs
 * the recited (passed) text, which the aligner does not have.
 */
export function isSubstitutionCandidate(
  candidate: string | null | undefined,
  passedWords: (string | null | undefined)[],
  options: NormalizeOptions = { stripTashkeel: true }
): boolean {
  if (!candidate) return false;
  for (const passed of passedWords) {
    if (passed && wordMatch(candidate, passed, options)) return false;
  }
  return true;
}

/**
 * Truncation/stretch garble: one side is a pure ordered subsequence of the
 * other over the narrow core variants, with NO substituted letters and no
 * length cap. Looser than wordMatch's bounded indel fuzz on purpose — this
 * never *advances* the cursor, it only says "this token is not trustworthy
 * evidence of a swap" (وللت for وَلِلتَّنْوِينِ, بيني for تَبْيِينِي, فأخذت
 * for فَخُذْ). A real swap substitutes at least one consonant and therefore
 * is never a subsequence of the expected word (checked against every labeled
 * swap in samples/recite-logs).
 */
function subsequenceGarble(
  candidate: string,
  expected: string,
  options: NormalizeOptions
): boolean {
  for (const x of coreVariants(candidate, options)) {
    for (const y of coreVariants(expected, options)) {
      const shorter = x.length <= y.length ? x : y;
      const longer = x.length <= y.length ? y : x;
      if (shorter.length < MIN_FUZZY_LENGTH) continue;
      if (isOrderedSubsequence(shorter, longer)) return true;
    }
  }
  return false;
}

/**
 * Decide whether `candidate` (a heard token consumed at a skipped slot) is real
 * evidence of a substitution, or just ASR noise the live aligner cannot trust.
 * Returns the token when it looks like a genuine wrong word, else null.
 *
 * Rejects, because each masquerades as a swap on clean recitations:
 *  - short fragments (ASR splinters like "ذا"),
 *  - near-variants of the missed word itself (ميمن for مِيمًا — a drop, not a swap),
 *  - truncations/stretches of the missed word (وللت for وَلِلتَّنْوِينِ) — see
 *    {@link subsequenceGarble},
 *  - the next / nearby expected words duplicated or reordered in the ASR tail.
 */
export function competingTokenIfSubstitution(
  candidate: string | null | undefined,
  missedWord: string,
  aheadWords: string[],
  options: NormalizeOptions
): string | null {
  if (!candidate) return null;
  if (normalizeWord(candidate, options).length < MIN_FUZZY_LENGTH) return null;
  if (wordMatch(candidate, missedWord, options)) return null;
  if (subsequenceGarble(candidate, missedWord, options)) return null;
  for (const ahead of aheadWords) {
    if (ahead && wordMatch(candidate, ahead, options)) return null;
  }
  return candidate;
}

/** iOS often splits one matn word into two tokens (e.g. فل + تعرفي). */
function joinedTokens(a: string, b: string, options: NormalizeOptions): string {
  return normalizeWord(`${a}${b}`, options);
}

function matchesExpectedToken(
  recognized: string[],
  ri: number,
  expectedWord: string,
  options: NormalizeOptions
): boolean {
  if (ri >= recognized.length) return false;
  if (wordMatch(recognized[ri], expectedWord, options)) return true;
  if (ri + 1 < recognized.length) {
    return wordMatch(
      joinedTokens(recognized[ri], recognized[ri + 1], options),
      expectedWord,
      options
    );
  }
  return false;
}

function consumeRecognizedForExpected(
  recognized: string[],
  ri: number,
  expectedWord: string,
  options: NormalizeOptions
): number {
  if (ri >= recognized.length) return 0;
  if (wordMatch(recognized[ri], expectedWord, options)) return 1;
  if (
    ri + 1 < recognized.length &&
    wordMatch(
      joinedTokens(recognized[ri], recognized[ri + 1], options),
      expectedWord,
      options
    )
  ) {
    return 2;
  }
  return 0;
}

function phraseMatches(
  heard: string[],
  expected: string[],
  options: NormalizeOptions
): boolean {
  if (heard.length !== expected.length || heard.length === 0) return false;
  for (let i = 0; i < heard.length; i++) {
    if (!wordMatch(heard[i], expected[i], options)) return false;
  }
  return true;
}

/** Looser matching for voice rewind only (ASR drops tashkeel / splits لام into لا). */
function wordMatchRelocalize(
  a: string,
  b: string,
  options: NormalizeOptions
): boolean {
  if (wordMatch(a, b, options)) return true;
  const na = normalizeWord(a, options);
  const nb = normalizeWord(b, options);
  if (
    (na === "\u0644\u0627" && nb === "\u0644\u0627\u0645") ||
    (na === "\u0644\u0627\u0645" && nb === "\u0644\u0627")
  ) {
    return true;
  }
  if (na.length >= 2 && nb.length >= 2) {
    const shorter = na.length <= nb.length ? na : nb;
    const longer = na.length <= nb.length ? nb : na;
    if (longer.startsWith(shorter) && shorter.length >= 2) return true;
  }
  return false;
}

function phraseMatchesRelocalize(
  heard: string[],
  expected: string[],
  options: NormalizeOptions
): boolean {
  if (heard.length !== expected.length || heard.length === 0) return false;
  for (let i = 0; i < heard.length; i++) {
    if (!wordMatchRelocalize(heard[i], expected[i], options)) return false;
  }
  return true;
}

/**
 * Contiguous progress from the start of the expected window only.
 */
export function prefixMatchedThrough(
  ops: WordMistake[],
  expectedLength: number
): number {
  const matched = new Set<number>();
  const missed = new Set<number>();

  for (const op of ops) {
    if (op.expectedIndex == null) continue;
    if (op.kind === "match") matched.add(op.expectedIndex);
    else if (op.kind === "missed") missed.add(op.expectedIndex);
  }

  let through = 0;
  for (let k = 0; k < expectedLength; k++) {
    if (matched.has(k)) {
      through = k + 1;
      continue;
    }
    if (
      missed.has(k) &&
      k + 1 < expectedLength &&
      matched.has(k + 1)
    ) {
      through = k + 2;
      k += 1;
      continue;
    }
    break;
  }
  return through;
}

function missedBeforeMatchInPrefix(
  ops: WordMistake[],
  missedIndex: number,
  matchedThrough: number
): boolean {
  if (missedIndex >= matchedThrough) return false;
  for (let k = missedIndex + 1; k < matchedThrough; k++) {
    const hit = ops.some(
      (op) =>
        op.expectedIndex === k && (op.kind === "match" || op.kind === "wrong")
    );
    if (hit) return true;
  }
  return false;
}

export function skippedMissesInRange(
  ops: WordMistake[],
  matchedThrough: number,
  fromExpectedIndex: number,
  toExpectedIndex: number
): WordMistake[] {
  if (matchedThrough <= fromExpectedIndex) return [];
  const out: WordMistake[] = [];
  for (const op of ops) {
    if (op.kind !== "missed" || op.expectedIndex == null) continue;
    if (op.expectedIndex < fromExpectedIndex) continue;
    if (op.expectedIndex >= toExpectedIndex) continue;
    if (op.expectedIndex >= matchedThrough) continue;
    out.push(op);
  }
  return out;
}

/**
 * Misses inferred before the live cursor via tail resync are speculative on partial ASR.
 */
export function speculativeMissCutoff(
  debug: Record<string, unknown> | undefined
): number {
  const resyncBack =
    typeof debug?.resyncBack === "number" ? debug.resyncBack : 0;
  const leadingSkipped =
    typeof debug?.leadingSkipped === "number" ? debug.leadingSkipped : 0;
  return Math.max(0, resyncBack, leadingSkipped);
}

/**
 * Greedy prefix alignment from anchor: contiguous prefix, one miss per skip, no distant match.
 */
export function scanPrefixMatch(
  expected: string[],
  recognized: string[],
  options: NormalizeOptions = { stripTashkeel: true }
): MatchResult {
  const ops: WordMistake[] = [];
  let ei = 0;
  let ri = 0;

  while (ri < recognized.length && ei < expected.length) {
    const token = recognized[ri];
    const consumed = consumeRecognizedForExpected(
      recognized,
      ri,
      expected[ei],
      options
    );

    if (consumed > 0) {
      const recognizedWord =
        consumed === 2
          ? `${recognized[ri]} ${recognized[ri + 1]}`
          : token;
      ops.push({
        kind: "match",
        expectedIndex: ei,
        expectedWord: expected[ei],
        recognizedWord,
      });
      ei += 1;
      ri += consumed;
      continue;
    }

    // One missed word, then match next (R3).
    if (ei + 1 < expected.length) {
      const skipConsumed = consumeRecognizedForExpected(
        recognized,
        ri,
        expected[ei + 1],
        options
      );
      if (skipConsumed > 0) {
        const recognizedWord =
          skipConsumed === 2
            ? `${recognized[ri]} ${recognized[ri + 1]}`
            : token;
        // A non-matching token consumed right before this skip is the word the
        // reciter actually said in place of expected[ei] — surface it as a
        // substitution candidate (the engine confirms it is not an echo).
        const prevOp = ops[ops.length - 1];
        const competing =
          prevOp && prevOp.kind === "extra"
            ? competingTokenIfSubstitution(
                prevOp.recognizedWord,
                expected[ei],
                expected.slice(ei + 1, ei + 2 + LOCAL_LOOKAHEAD),
                options
              )
            : null;
        ops.push({
          kind: "missed",
          expectedIndex: ei,
          expectedWord: expected[ei],
          recognizedWord: competing,
        });
        ops.push({
          kind: "match",
          expectedIndex: ei + 1,
          expectedWord: expected[ei + 1],
          recognizedWord,
        });
        ei += 2;
        ri += skipConsumed;
        continue;
      }
    }

    // Unrelated ASR (no match at cursor or skip-ahead) — extra only; never burn expected words (R5).
    ops.push({
      kind: "extra",
      expectedIndex: null,
      expectedWord: null,
      recognizedWord: token,
    });
    ri += 1;
  }

  let matchedThrough = prefixMatchedThrough(ops, expected.length);
  const hasMatch = ops.some((op) => op.kind === "match");
  if (!hasMatch) {
    matchedThrough = 0;
  }
  const mistakes = ops.filter(
    (op) =>
      op.kind !== "match" &&
      op.expectedIndex != null &&
      op.expectedIndex < matchedThrough &&
      (op.kind !== "missed" ||
        missedBeforeMatchInPrefix(ops, op.expectedIndex, matchedThrough))
  );

  let recognizedConsumed = 0;
  let expectedSeen = 0;
  for (const op of ops) {
    if (op.kind === "extra") {
      recognizedConsumed += 1;
      continue;
    }
    if (op.kind === "missed") {
      expectedSeen += 1;
      if (expectedSeen > matchedThrough) break;
      continue;
    }
    recognizedConsumed += 1;
    expectedSeen += 1;
    if (expectedSeen >= matchedThrough) break;
  }

  return {
    matchedThrough,
    mistakes,
    recognizedConsumed,
    recognizedTokens: recognized,
  };
}

/**
 * Match tail against expected text including words just before cursor (iOS trails behind).
 * Returns matchedThrough as **forward advance from cursorIndex** only.
 */
export function scanTailResync(
  expected: string[],
  cursorIndex: number,
  recognized: string[],
  options: NormalizeOptions = { stripTashkeel: true }
): MatchResult {
  if (expected.length === 0 || recognized.length === 0 || cursorIndex < 0) {
    return {
      matchedThrough: 0,
      mistakes: [],
      recognizedConsumed: 0,
      recognizedTokens: recognized,
    };
  }

  const tail =
    recognized.length > RECOGNITION_ALIGN_TAIL
      ? recognized.slice(-RECOGNITION_ALIGN_TAIL)
      : recognized;

  let bestAdvance = 0;
  let bestResult: MatchResult | null = null;
  let bestStartIdx = cursorIndex;

  for (let back = 0; back <= TAIL_RESYNC_MAX_BACK; back++) {
    const startIdx = cursorIndex - back;
    if (startIdx < 0) break;

    const slice = expected.slice(startIdx);
    const sub = scanPrefixMatchAtCursor(slice, tail, options);
    if (sub.matchedThrough <= 0) continue;

    const newAbsolute = startIdx + sub.matchedThrough;
    const advance = newAbsolute - cursorIndex;
    if (advance <= bestAdvance) continue;

    bestAdvance = advance;
    bestStartIdx = startIdx;
    bestResult = sub;
  }

  if (!bestResult || bestAdvance <= 0) {
    return scanPrefixMatchAtCursor(expected.slice(cursorIndex), tail, options);
  }

  const indexShift = bestStartIdx - cursorIndex;

  return {
    matchedThrough: bestAdvance,
    mistakes: bestResult.mistakes.map((m) => ({
      ...m,
      expectedIndex:
        m.expectedIndex != null ? m.expectedIndex + indexShift : m.expectedIndex,
    })),
    recognizedConsumed: bestResult.recognizedConsumed,
    recognizedTokens: tail,
    debug: {
      resync: true,
      tailLen: tail.length,
      resyncBack: cursorIndex - bestStartIdx,
      advance: bestAdvance,
    },
  };
}

/**
 * Align against the recent recognition tail, anchored on the current expected word.
 * Cumulative ASR dumps must not be scanned from يقول when the cursor is at فَلْتَعْرِفِ.
 */
export function scanPrefixMatchAtCursor(
  expected: string[],
  recognized: string[],
  options: NormalizeOptions = { stripTashkeel: true }
): MatchResult {
  if (expected.length === 0 || recognized.length === 0) {
    return {
      matchedThrough: 0,
      mistakes: [],
      recognizedConsumed: 0,
      recognizedTokens: recognized,
    };
  }

  const tail =
    recognized.length > RECOGNITION_ALIGN_TAIL
      ? recognized.slice(-RECOGNITION_ALIGN_TAIL)
      : recognized;

  let bestStart = -1;
  const searchFrom = Math.max(0, tail.length - RECOGNITION_ANCHOR_SEARCH);
  for (let start = searchFrom; start < tail.length; start++) {
    if (matchesExpectedToken(tail, start, expected[0], options)) {
      bestStart = start;
    }
  }

  if (bestStart < 0) {
    for (let skip = 1; skip <= LOCAL_LOOKAHEAD && skip < expected.length; skip++) {
      let skipStart = -1;
      for (let start = searchFrom; start < tail.length; start++) {
        if (matchesExpectedToken(tail, start, expected[skip], options)) {
          skipStart = start;
        }
      }
      if (skipStart < 0) continue;

      const sub = scanPrefixMatch(
        expected.slice(skip),
        tail.slice(skipStart),
        options
      );
      if (sub.matchedThrough <= 0) continue;

      const missed: WordMistake[] = [];
      for (let i = 0; i < skip; i++) {
        // Single skipped word with a non-matching token right before the anchor
        // = substitution candidate. Multi-word skips are too ambiguous to
        // attribute a heard word to one slot, so leave them as plain omissions.
        const competing =
          skip === 1 && skipStart >= 1
            ? competingTokenIfSubstitution(
                tail[skipStart - 1],
                expected[i],
                expected.slice(i + 1, i + 2 + LOCAL_LOOKAHEAD),
                options
              )
            : null;
        missed.push({
          kind: "missed",
          expectedIndex: i,
          expectedWord: expected[i],
          recognizedWord: competing,
        });
      }

      return {
        matchedThrough: skip + sub.matchedThrough,
        mistakes: [...missed, ...sub.mistakes.map((m) => ({
          ...m,
          expectedIndex:
            m.expectedIndex != null ? m.expectedIndex + skip : m.expectedIndex,
        }))],
        recognizedConsumed: sub.recognizedConsumed,
        recognizedTokens: tail,
        debug: {
          anchorFound: true,
          leadingSkipped: skip,
          anchorStart: skipStart,
          tailLen: tail.length,
        },
      };
    }

    return {
      matchedThrough: 0,
      mistakes: [],
      recognizedConsumed: 0,
      recognizedTokens: tail,
      debug: { anchorFound: false, tailLen: tail.length },
    };
  }

  const result = scanPrefixMatch(expected, tail.slice(bestStart), options);
  return {
    ...result,
    recognizedTokens: tail,
    debug: { anchorFound: true, anchorStart: bestStart, tailLen: tail.length },
  };
}

/**
 * Match any contiguous subphrase in the recent heard window against passed text before cursor.
 * Used when the user repeats earlier lines (phrase is often in the middle of heard, not the tail).
 */
export function searchHeardPhraseInPassed(
  passedExpected: string[],
  heard: string[],
  cursor: number,
  options: NormalizeOptions = { stripTashkeel: true },
  searchBack: number = RELOCALIZE_SEARCH_BACK
): MatchResult | null {
  if (cursor <= 0 || heard.length < MIN_RELOCALIZE_WORDS) return null;

  const window =
    heard.length > RELOCALIZE_HEARD_WINDOW
      ? heard.slice(-RELOCALIZE_HEARD_WINDOW)
      : heard;

  let bestStart = -1;
  let bestLen = 0;

  const maxPhraseLen = Math.min(12, window.length, cursor);
  for (let len = maxPhraseLen; len >= MIN_RELOCALIZE_WORDS; len--) {
    for (let hStart = 0; hStart <= window.length - len; hStart++) {
      const phrase = window.slice(hStart, hStart + len);
      const searchStart = Math.max(0, cursor - searchBack);
      for (let pStart = searchStart; pStart <= cursor - len; pStart++) {
        const slice = passedExpected.slice(pStart, pStart + len);
        if (!phraseMatchesRelocalize(phrase, slice, options)) continue;
        if (len > bestLen || (len === bestLen && pStart > bestStart)) {
          bestLen = len;
          bestStart = pStart;
        }
      }
    }
  }

  if (bestStart < 0) return null;
  if (cursor - bestStart < RELOCALIZE_MIN_BACK_WORDS) return null;

  return {
    matchedThrough: 0,
    mistakes: [],
    recognizedConsumed: window.length,
    recognizedTokens: window,
    relocalized: true,
    relocalizeCursor: bestStart,
    debug: {
      relocalizeLen: bestLen,
      suffixStart: bestStart,
      searchBack,
      mode: "phraseSearch",
    },
  };
}

/**
 * Backward relocalize: phrase search in heard window, then suffix/sliding fallback (Option B).
 */
export function relocalizeBackward(
  passedExpected: string[],
  heard: string[],
  cursor: number,
  options: NormalizeOptions = { stripTashkeel: true },
  maxBack: number = RELOCALIZE_MAX_BACK
): MatchResult | null {
  if (cursor <= 0 || heard.length < MIN_RELOCALIZE_WORDS) return null;

  const phraseHit = searchHeardPhraseInPassed(
    passedExpected,
    heard,
    cursor,
    options
  );
  if (phraseHit) return phraseHit;

  const heardTail =
    heard.length > RELOCALIZE_HEARD_TAIL
      ? heard.slice(-RELOCALIZE_HEARD_TAIL)
      : heard;

  const maxLen = Math.min(heardTail.length, cursor, 12);
  for (let len = maxLen; len >= MIN_RELOCALIZE_WORDS; len--) {
    const phrase = heardTail.slice(-len);

    const suffix = passedExpected.slice(cursor - len, cursor);
    if (phraseMatchesRelocalize(phrase, suffix, options)) {
      if (cursor - len < cursor - maxBack) continue;
      if (cursor - (cursor - len) < RELOCALIZE_MIN_BACK_WORDS) continue;
      return {
        matchedThrough: 0,
        mistakes: [],
        recognizedConsumed: heardTail.length,
        recognizedTokens: heardTail,
        relocalized: true,
        relocalizeCursor: cursor - len,
        debug: { relocalizeLen: len, suffixStart: cursor - len, maxBack, mode: "suffix" },
      };
    }

    const searchStart = Math.max(0, cursor - maxBack - len);
    for (let start = cursor - len; start >= searchStart; start--) {
      const slice = passedExpected.slice(start, start + len);
      if (!phraseMatchesRelocalize(phrase, slice, options)) continue;
      if (start < cursor - maxBack) continue;
      if (cursor - start < RELOCALIZE_MIN_BACK_WORDS) continue;
      return {
        matchedThrough: 0,
        mistakes: [],
        recognizedConsumed: heardTail.length,
        recognizedTokens: heardTail,
        relocalized: true,
        relocalizeCursor: start,
        debug: {
          relocalizeLen: len,
          suffixStart: start,
          maxBack,
          mode: "sliding",
        },
      };
    }
  }

  return null;
}

/**
 * @deprecated Use scanPrefixMatch. Kept for offline benchmarks that still import alignWords.
 */
export function alignWords(
  expected: string[],
  recognized: string[],
  options: NormalizeOptions = { stripTashkeel: true }
): AlignmentResult {
  const r = scanPrefixMatch(expected, recognized, options);
  return {
    mistakes: r.mistakes,
    matchedThrough: r.matchedThrough,
    recognizedConsumed: r.recognizedConsumed,
    recognizedTokens: r.recognizedTokens,
  };
}
