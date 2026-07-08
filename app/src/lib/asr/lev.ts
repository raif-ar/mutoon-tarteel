/**
 * Bounded Levenshtein for ASR-vs-matn word matching (align-trust-v5).
 *
 * Words are short (≤ ~12 chars after normalization), so a two-row DP is
 * cheaper than any library and keeps the app dependency-free.
 */

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Similarity in [0,1]: 1 - dist / max(len). Empty-vs-empty is 1. */
export function levRatio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

/**
 * ASR phonetic confusions Nova-3 makes on classical Arabic that plain edit
 * distance over-counts: emphatic consonants heard as their plain twin
 * (تُقًى → "طوقا"), and a final long-a rendered ا instead of ى/ي. Collapsing
 * both sides before the distance check makes those garbles cheap without
 * loosening the ratio for genuinely different words (وَالثَّانِي vs والثالث
 * share no emphatic pair, so their distance is unchanged).
 *
 * Input must already be normalized (normalizeWord) — this maps normalized
 * forms only.
 */
export function phoneticCollapse(word: string): string {
  let out = word
    .replace(/ط/g, "ت") // ط → ت
    .replace(/ظ/g, "ذ") // ظ → ذ
    .replace(/ض/g, "د") // ض → د
    .replace(/ص/g, "س"); // ص → س
  // Final long-a variance: ASR writes ا where the matn has ى (normalized ي).
  if (out.length > 2 && out.endsWith("ا")) {
    out = out.slice(0, -1) + "ي";
  }
  return out;
}
