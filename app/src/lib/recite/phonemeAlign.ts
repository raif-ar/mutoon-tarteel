/**
 * Live alignment of a heard phoneme stream against the expected matn words.
 *
 * The listener model emits phonemes (one token per CTC spike) while the user
 * recites. We always know which words are expected next, so instead of
 * transcribing we align: a small dynamic program over a sliding window of
 * expected words, re-run on every batch of new phonemes. Words far enough
 * behind the alignment front are committed with a verdict (ok / wrong /
 * skipped); the front itself drives the on-screen cursor.
 *
 * Chanting stretches vowels freely and drops or keeps case endings, so both
 * sides are compared on a length-free "skeleton" (see `skeleton`).
 *
 * Pure and dependency-free: the Node gate (scripts/recite-phoneme-gate.mjs)
 * replays recorded audio through this exact file.
 */

/** One decoded phoneme from the listener. Times are in model frames. */
export interface HeardPhoneme {
  p: string;
  start: number;
  end: number;
  conf: number;
}

export type SlipKind = "wrong" | "skipped";

export interface WordVerdict {
  /** Index into the session's word list. */
  index: number;
  ok: boolean;
  kind?: SlipKind;
  /** Alignment cost per skeleton phoneme, 0 = exact. */
  err: number;
  /** Consonants of the word that were wrong or missing (near-misses count half), and its consonant count. */
  consBad: number;
  cons: number;
  /** Skeleton phonemes heard where this word was expected. */
  heard: string;
  /** Mean listener confidence of the heard phonemes matched to the word (0 if none). */
  conf: number;
  /** Frames of the first and last heard phoneme aligned to the word (-1 if none). */
  startFrame: number;
  endFrame: number;
  /** Frame at which the verdict was committed. */
  atFrame: number;
}

export interface AlignerOptions {
  /** A word is a slip when its cost per phoneme exceeds this. */
  threshold?: number;
  /** Threshold for the first word after a (re)start, where audio is often clipped. */
  firstWordThreshold?: number;
  /** Expected words kept in the alignment window ahead of the committed point. */
  windowWords?: number;
  /** Skeleton phonemes the front must be past a word before it is committed. */
  holdback?: number;
  /** Frames of silence after which everything behind the front is committed. */
  settleFrames?: number;
}

export interface AlignerUpdate {
  /** Words completed so far (committed or provisionally matched). Never decreases. */
  cursor: number;
  /** Words with a final verdict. */
  committed: number;
  /** Verdicts committed by this call. */
  verdicts: WordVerdict[];
}

const LENGTH_FOLD: Record<string, string> = { "ا": "َ", "ۥ": "ُ", "ۦ": "ِ" };
const DROP = new Set(["ڇ", "ـ", "ۜ", "۪"]);
const NASAL_FOLD: Record<string, string> = { "ں": "ن", "۾": "ن", "ٲ": "َ", "ؙ": "ُ" };

const isVowel = (c: string): boolean => c === "َ" || c === "ُ" || c === "ِ";

/** Fold one phoneme to its skeleton symbol ("" = dropped). */
function fold(ch: string): string {
  if (DROP.has(ch)) return "";
  return LENGTH_FOLD[ch] ?? NASAL_FOLD[ch] ?? ch;
}

/**
 * Length-free skeleton: long vowels become their short vowel, repeated
 * symbols collapse (so doubling and madd length are ignored), and the
 * tajweed-only tokens (qalqala, ikhfa, iqlab) fold away.
 */
export function skeleton(phonemes: string): string {
  let out = "";
  for (const ch of phonemes) {
    const c = fold(ch);
    if (!c || out[out.length - 1] === c) continue;
    out += c;
  }
  return out;
}

/** Consonant pairs the model (or a learner) commonly confuses: half cost. */
const NEAR = ["تط", "سص", "دض", "ذظ", "ثس", "ذز", "هح", "ءع", "كق", "نم", "ثف", "ظض", "ءه", "وُ", "يِ"];
const nearKey = new Set<string>();
for (const pair of NEAR) {
  const [a, b] = [...pair];
  nearKey.add(a + b);
  nearKey.add(b + a);
}

function subCost(a: string, b: string): number {
  if (a === b) return 0;
  const va = isVowel(a);
  const vb = isVowel(b);
  if (va && vb) return 0.4;
  if (nearKey.has(a + b)) return 0.5;
  return va !== vb ? 1.2 : 1;
}
/** Cost of an expected phoneme that was not heard. */
const delCost = (c: string): number => (isVowel(c) ? 0.4 : 1);
/** Cost of a heard phoneme with no expected counterpart (kept low: extra sounds are common). */
const insCost = (c: string): number => (isVowel(c) ? 0.2 : 0.45);

interface HeardSym {
  c: string;
  frame: number;
  conf: number;
}

const DEFAULTS: Required<AlignerOptions> = {
  threshold: 0.55,
  firstWordThreshold: 0.85,
  windowWords: 28,
  holdback: 6,
  settleFrames: 30,
};
const MAX_HEARD = 260;
/** Extra alignment cost accepted to move the front ahead when the user paused (about one skipped word). */
const SKIP_BUDGET = 4.5;
/** Reward per expected phoneme consumed when choosing the alignment front. */
const PROGRESS = 0.35;

export class PhonemeAligner {
  private readonly skels: string[];
  private readonly opts: Required<AlignerOptions>;
  /** Words [0, committed) have verdicts. */
  private committed = 0;
  private cursor = 0;
  /** Heard skeleton symbols not yet consumed by a committed word. */
  private heard: HeardSym[] = [];
  private lastSym = "";
  private lastFrame = 0;
  /** The next committed word is the first after a (re)start. */
  private first = true;
  /** Words already reported as a slip (a verdict is final: first one wins). */
  private slipped = new Set<number>();
  /** Frame of the last heard phoneme matched to a committed word. */
  private prevFrame = -1;
  /** Test hook: called with the alignment internals on every pass. */
  debug: ((info: Record<string, unknown>) => void) | null = null;

  /** `wordPhonemes`: phonemes of every word of the session, in order (see `sessionWordPhonemes`). */
  constructor(wordPhonemes: string[], options: AlignerOptions = {}) {
    this.skels = wordPhonemes.map(skeleton);
    this.opts = { ...DEFAULTS, ...options };
  }

  get totalWords(): number {
    return this.skels.length;
  }

  /** Restart alignment at `wordIndex` (rewind / retry). Verdicts before it stand. */
  resetTo(wordIndex: number): void {
    const w = Math.max(0, Math.min(this.skels.length, wordIndex));
    this.committed = w;
    this.cursor = w;
    this.heard = [];
    this.lastSym = "";
    this.first = true;
    for (const i of [...this.slipped]) if (i >= w) this.slipped.delete(i);
  }

  /** Feed newly decoded phonemes. `nowFrame` is the listener clock (defaults to the last phoneme). */
  push(tokens: HeardPhoneme[], nowFrame?: number): AlignerUpdate {
    for (const t of tokens) {
      for (const ch of t.p) {
        const c = fold(ch);
        if (!c || c === this.lastSym) continue;
        this.lastSym = c;
        this.heard.push({ c, frame: t.end, conf: t.conf });
      }
      this.lastFrame = Math.max(this.lastFrame, t.end);
    }
    const now = nowFrame ?? this.lastFrame;
    const settle = now - this.lastFrame >= this.opts.settleFrames;
    if (settle) this.lastSym = ""; // after a pause the same sound may legitimately repeat
    return this.align(now, settle ? "settle" : "live");
  }

  /** Recording stopped: commit everything the alignment front has reached. */
  finish(nowFrame?: number): AlignerUpdate {
    return this.align(nowFrame ?? this.lastFrame, "final");
  }

  private align(now: number, mode: "live" | "settle" | "final"): AlignerUpdate {
    const verdicts: WordVerdict[] = [];
    if (this.committed >= this.skels.length || this.heard.length === 0) {
      return { cursor: this.cursor, committed: this.committed, verdicts };
    }
    if (this.heard.length > MAX_HEARD) this.heard.splice(0, this.heard.length - MAX_HEARD);

    // Expected window: skeleton of the next words, with word end offsets.
    const lastWord = Math.min(this.skels.length, this.committed + this.opts.windowWords);
    let ref = "";
    const ends: number[] = [];
    for (let w = this.committed; w < lastWord; w++) {
      ref += this.skels[w];
      ends.push(ref.length);
    }
    const n = ref.length;
    const m = this.heard.length;
    const W = m + 1;
    // D[i][j]: cost of aligning ref[0..i) with heard[0..j). B: 0 = diag, 1 = delete ref, 2 = insert heard.
    const D = new Float32Array((n + 1) * W);
    const B = new Uint8Array((n + 1) * W);
    for (let j = 1; j <= m; j++) {
      D[j] = D[j - 1] + insCost(this.heard[j - 1].c);
      B[j] = 2;
    }
    for (let i = 1; i <= n; i++) {
      const rc = ref[i - 1];
      D[i * W] = D[(i - 1) * W] + delCost(rc);
      B[i * W] = 1;
      for (let j = 1; j <= m; j++) {
        const hc = this.heard[j - 1].c;
        const s = D[(i - 1) * W + j - 1] + subCost(rc, hc);
        const d = D[(i - 1) * W + j] + delCost(rc);
        const ins = D[i * W + j - 1] + insCost(hc);
        let best = s;
        let op = 0;
        if (d < best) { best = d; op = 1; }
        if (ins < best) { best = ins; op = 2; }
        D[i * W + j] = best;
        B[i * W + j] = op;
      }
    }
    // Alignment front: the expected prefix that best explains everything heard.
    // Raw cost alone ties "stop here, the rest is junk" with "carry on with one error", so each
    // expected phoneme consumed earns a small reward.
    const score = (i: number): number => D[i * W + m] - PROGRESS * i;
    let front = 0;
    for (let i = 1; i <= n; i++) if (score(i) < score(front)) front = i;

    const cost = new Float32Array(n);
    const matched = new Uint8Array(n);
    const heardOn: string[] = new Array(n).fill("");
    const frameOn = new Int32Array(n).fill(-1);
    const frameFirst = new Int32Array(n).fill(-1);
    const confOn = new Float32Array(n);
    /** heard index the path is at when it has consumed ref[0..i). */
    const heardAt = new Int32Array(n + 1).fill(-1);
    /** Traceback from (row, m). Returns how many trailing heard symbols were left unexplained. */
    const trace = (row: number): number => {
      cost.fill(0); matched.fill(0); heardOn.fill(""); frameOn.fill(-1); frameFirst.fill(-1); confOn.fill(0); heardAt.fill(-1);
      let i = row;
      let j = m;
      let trail = 0;
      let inTrail = true;
      heardAt[i] = j;
      while (i > 0) {
        const op = B[i * W + j];
        if (op === 2) {
          // An extra heard sound: shown with the word, never charged to it.
          if (inTrail) trail++;
          else heardOn[i - 1] = this.heard[j - 1].c + heardOn[i - 1];
          j--;
          continue;
        }
        inTrail = false;
        if (op === 0) {
          const hc = this.heard[j - 1];
          cost[i - 1] += subCost(ref[i - 1], hc.c);
          matched[i - 1] = 1;
          heardOn[i - 1] = hc.c + heardOn[i - 1];
          if (frameOn[i - 1] < hc.frame) frameOn[i - 1] = hc.frame;
          frameFirst[i - 1] = hc.frame;
          confOn[i - 1] = hc.conf;
          i--; j--;
        } else {
          cost[i - 1] += delCost(ref[i - 1]);
          i--;
        }
        heardAt[i] = j;
      }
      if (row === 0) trail = m;
      return trail;
    };
    let trail = trace(front);

    // The user has paused or stopped with sounds left over after the front. If a front further
    // ahead explains them at the price of about one skipped word, they skipped: move there.
    if (mode !== "live" && trail >= 3 && front < n) {
      const base = score(front);
      const cands: number[] = [];
      for (let i = front + 1; i <= n; i++) {
        const d = score(i);
        if (d - base > SKIP_BUDGET) continue;
        if (d <= score(i - 1) && (i === n || d <= score(i + 1))) cands.push(i);
      }
      cands.sort((a, b) => score(a) - score(b));
      let moved = false;
      for (const i of cands.slice(0, 4)) {
        if (trace(i) <= 1) { front = i; trail = trace(i); moved = true; break; }
      }
      if (!moved) trail = trace(front);
    }

    // Provisional cursor: words fully behind the front.
    let reached = 0;
    while (reached < ends.length && ends[reached] <= front) reached++;
    this.cursor = Math.max(this.cursor, this.committed + reached);

    const emit = (k: number, forcedHeard?: string): void => {
      const start = k === 0 ? 0 : ends[k - 1];
      const end = ends[k];
      const len = Math.max(1, end - start);
      let c = 0;
      let hits = 0;
      let heard = "";
      let endFrame = -1;
      let cons = 0;
      let consBad = 0;
      let confSum = 0;
      let startFrame = -1;
      for (let q = start; q < end; q++) {
        confSum += confOn[q];
        if (startFrame < 0 && frameFirst[q] >= 0) startFrame = frameFirst[q];
        c += cost[q];
        hits += matched[q];
        heard += heardOn[q];
        if (frameOn[q] > endFrame) endFrame = frameOn[q];
        if (!isVowel(ref[q])) { cons++; consBad += Math.min(1, cost[q]); }
      }
      const index = this.committed + k;
      const first = this.first;
      this.first = false;
      if (this.slipped.has(index)) return; // already reported as a slip while the user was on it
      const err = c / len;
      let slip = isSlip(err, consBad, cons, first, this.opts);
      const skippedKind = hits / len < 0.34;
      if (slip && skippedKind) {
        // Nothing was decoded for the word. If there was time for it between its neighbours, the
        // listener most likely dropped it (or the user paused); only a tight join is a real skip.
        // Consonants only: a stray vowel can match anywhere.
        let before = -1;
        for (let q = start - 1; q >= 0 && before < 0; q--) if (!isVowel(ref[q])) before = frameOn[q];
        if (before < 0) before = this.prevFrame;
        let after = -1;
        for (let q = end; q < n && after < 0; q++) if (!isVowel(ref[q])) after = frameFirst[q];
        const room = after >= 0 && before >= 0 ? after - before : Infinity;
        if (room >= 4 + 2 * len) slip = false;
      }
      // A "wrong" word smeared over far more audio than it needs is a garbled stretch, not evidence.
      if (slip && !skippedKind && startFrame >= 0 && endFrame - startFrame > 10 + 6 * len) slip = false;
      const ok = forcedHeard == null && !slip;
      const v: WordVerdict = { index, ok, err, consBad, cons, conf: hits ? confSum / hits : 0, heard: forcedHeard ?? heard, startFrame, endFrame, atFrame: now };
      if (!ok) {
        v.kind = forcedHeard != null || !skippedKind ? "wrong" : "skipped";
        this.slipped.add(index);
      }
      for (let q = end - 1; q >= start; q--) if (!isVowel(ref[q]) && frameOn[q] >= 0) { this.prevFrame = frameOn[q]; break; }
      verdicts.push(v);
    };

    // Something was said after the front that is not the next word, and the user has paused
    // or stopped: either they went back over earlier words (ignore it), or they said the next
    // word wrong. A wrong attempt is reported at once but the position does not move, so a
    // correct retry carries on from the same word.
    let dropTail = 0;
    if (mode !== "live" && reached < ends.length && trail > 0) {
      const tail = this.heard.slice(m - trail).map((h) => h.c).join("");
      const consonants = [...tail].filter((c) => !isVowel(c)).length;
      const wordStart = reached === 0 ? 0 : ends[reached - 1];
      const partial = front - wordStart; // the next word is already partly matched: leave it to the live path
      if (consonants >= 2 && tail.length >= 3 && partial === 0) {
        const repeat = this.repeatsEarlier(tail, this.committed + reached);
        // Only when recording has stopped: mid-session, a wrong word shows up through the words after it.
        if (!repeat && mode === "final") {
          const index = this.committed + reached;
          if (!this.slipped.has(index)) {
            this.slipped.add(index);
            const tailSyms = this.heard.slice(m - trail);
            verdicts.push({ index, ok: false, kind: "wrong", err: 1, consBad: 0, cons: 0, conf: tailSyms.reduce((a, h) => a + h.conf, 0) / tailSyms.length, heard: tail, startFrame: tailSyms[0].frame, endFrame: this.heard[m - 1].frame, atFrame: now });
          }
        }
        if (repeat || mode === "final") dropTail = trail;
      }
    }

    // Commit words the front is safely past (all reached words when settled or final).
    let commitCount = 0;
    for (let k = 0; k < reached; k++) {
      if (mode === "live" && front - ends[k] < this.opts.holdback) break;
      commitCount = k + 1;
    }
    if (mode === "final" && reached < ends.length && dropTail === 0) {
      // A last word that is mostly spoken when recording stops is judged too.
      const start = reached === 0 ? 0 : ends[reached - 1];
      const len = ends[reached] - start;
      if (front - start >= Math.ceil(len * 0.6)) {
        for (let q = front; q < ends[reached]; q++) cost[q] += delCost(ref[q]) * 0.5;
        commitCount = reached + 1;
        this.cursor = Math.max(this.cursor, this.committed + commitCount);
      }
    }
    if (this.debug) this.debug({ mode, front, n, m, reached, trail, dropTail, commitCount, ref, heard: this.heard.map((h) => h.c).join(""), ends });
    for (let k = 0; k < commitCount; k++) emit(k);
    if (dropTail > 0) this.heard.splice(m - dropTail, dropTail);
    if (commitCount > 0) {
      const cut = ends[commitCount - 1];
      const hj = Math.max(0, heardAt[Math.min(cut, front)]);
      this.heard.splice(0, Math.min(hj, this.heard.length));
      this.committed += commitCount;
    }
    return { cursor: this.cursor, committed: this.committed, verdicts };
  }

  /** True when `tail` is a re-recitation of words just before `wordIndex` (going back over a line). */
  private repeatsEarlier(tail: string, wordIndex: number): boolean {
    const from = Math.max(0, wordIndex - 14);
    const ref = this.skels.slice(from, wordIndex).join("");
    if (!ref || tail.length < 3) return false;
    const n = tail.length;
    const m = ref.length;
    // Semi-global: all of `tail` must be explained by some stretch of `ref`.
    let prev = new Float32Array(m + 1);
    let best = Infinity;
    for (let i = 1; i <= n; i++) {
      const cur = new Float32Array(m + 1);
      cur[0] = prev[0] + insCost(tail[i - 1]);
      for (let j = 1; j <= m; j++) {
        cur[j] = Math.min(prev[j - 1] + subCost(ref[j - 1], tail[i - 1]), prev[j] + insCost(tail[i - 1]), cur[j - 1] + delCost(ref[j - 1]));
      }
      prev = cur;
    }
    for (let j = 0; j <= m; j++) if (prev[j] < best) best = prev[j];
    return best / n <= 0.3;
  }
}

/** Slip rule. Tuned on scripts/recite-phoneme-gate.mjs; the bar is zero false reds on clean audio. */
function isSlip(err: number, consBad: number, cons: number, first: boolean, o: Required<AlignerOptions>): boolean {
  // The first word after a (re)start is often clipped by the mic or the model warming up.
  if (first) return err > o.firstWordThreshold;
  // One-consonant words (في، ذا) are too short to judge on their own: only a total miss counts.
  if (cons <= 1) return err >= 0.95;
  // Mostly-wrong consonants are the clearest sign of a different word.
  if (consBad >= 2 && consBad / cons >= 0.6) return true;
  return err > o.threshold;
}

/**
 * Skeleton phonemes -> a readable Arabic approximation for "what was heard".
 * Not a spelling: short vowels stay as harakat on the letter before them.
 */
export function heardToArabic(skel: string): string {
  let out = "";
  for (const ch of skel) {
    if (isVowel(ch) && out === "") out += "ا";
    out += ch;
  }
  return out;
}
