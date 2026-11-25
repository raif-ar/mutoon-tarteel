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
  /** Only show and judge words with clearly heard words around them (see `release`). Off only for measurements. */
  requireEvidence?: boolean;
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
  requireEvidence: true,
};
const MAX_HEARD = 260;
/** Already-judged words kept behind the committed point, so going back over them is recognised. */
const BACK_WORDS = 18;
/** Extra alignment cost accepted to move the front ahead when the user paused (about one skipped word). */
const SKIP_BUDGET = 4.5;
/**
 * Reward per expected phoneme consumed. Raw cost alone ties "stop here, the rest is junk" with
 * "carry on with one error"; the reward breaks that tie toward progress.
 */
const PROGRESS = 0.35;
/** Cost of going back to an earlier word (needs about five matching sounds to pay off). */
const JUMP = 1.5;
/** Flat cost of skipping ahead to a later word start (a left-out word or line), instead of paying per phoneme. */
const SKIP_AHEAD = 4;
/** A run of this many undecoded words is a skipped passage, however much time it had. */
const SKIP_RUN = 3;
/**
 * A word counts as clearly heard at or below this cost per phoneme (with two consonants or more,
 * most of them right). Other speech lands on expected words at about 0.3 to 0.7.
 */
const SOLID_ERR = 0.25;
/** Released words remembered for the "are we following the reciter" check. */
const TRUST_WORDS = 4;
const INF = 1e9;

/** One word of the commit batch, before the skip-run pass decides the soft ones. */
interface Draft {
  index: number;
  err: number;
  consBad: number;
  cons: number;
  conf: number;
  heard: string;
  startFrame: number;
  endFrame: number;
  /** A slip by the rules. */
  slip: boolean;
  skippedKind: boolean;
  /** Undecoded with time to spare: on its own, more likely a dropped word or a pause than a skip. */
  soft: boolean;
}

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
  /** Symbols in `heard` when the alignment last ran (skip the work when nothing is new). */
  private alignedAt = -1;
  /** The next committed word is the first after a (re)start. */
  private first = true;
  /** Words already reported as a slip (a verdict is final: first one wins). */
  private slipped = new Set<number>();
  /** Frame of the last heard consonant matched to a committed word. */
  private prevFrame = -1;
  /** Soft (undecided) undecoded words at the end of the last commit, in case the run continues. */
  private softTail: Draft[] = [];
  /** The last committed words were a skipped passage (a run that reached SKIP_RUN). */
  private inSkipRun = false;
  /** Whether each of the last TRUST_WORDS committed words was clearly heard (newest last). */
  private recent: boolean[] = [];
  /** Test hook: called with the alignment internals on every pass. */
  debug: ((info: Record<string, unknown>) => void) | null = null;

  /** `wordPhonemes`: phonemes of every word of the session, in order (see `lineWordPhonemes`). */
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
    this.alignedAt = -1;
    this.first = true;
    this.softTail = [];
    this.inSkipRun = false;
    this.recent = [];
    // A resume opens a new listener whose frame clock starts again at 0.
    this.lastFrame = 0;
    this.prevFrame = -1;
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
    if (!settle && this.heard.length === this.alignedAt) {
      return { cursor: this.cursor, committed: this.committed, verdicts: [] };
    }
    return this.align(now, settle ? "settle" : "live");
  }

  /** Recording stopped: commit everything the alignment front has reached. */
  finish(nowFrame?: number): AlignerUpdate {
    return this.align(nowFrame ?? this.lastFrame, "final");
  }

  /**
   * One alignment pass over the heard buffer.
   *
   * The expected text is the window `[back context][next words]`. A path starts at the committed
   * point and moves forward (layer 0). It may go back ONCE to the start of an earlier word and move
   * forward again from there (layer 1): that is a reciter repeating a line or restarting a few
   * lines back, and without it the repeated audio gets forced onto the next words as mistakes.
   */
  private align(now: number, mode: "live" | "settle" | "final"): AlignerUpdate {
    const verdicts: WordVerdict[] = [];
    this.alignedAt = this.heard.length;
    if (this.committed >= this.skels.length || this.heard.length === 0) {
      return { cursor: this.cursor, committed: this.committed, verdicts };
    }
    if (this.heard.length > MAX_HEARD) {
      this.heard.splice(0, this.heard.length - MAX_HEARD);
      this.alignedAt = this.heard.length;
    }

    // ---- expected window ----
    const backFrom = Math.max(0, this.committed - BACK_WORDS);
    const lastWord = Math.min(this.skels.length, this.committed + this.opts.windowWords);
    let ref = "";
    const starts: number[] = [];
    const ends: number[] = [];
    for (let w = backFrom; w < lastWord; w++) {
      starts.push(ref.length);
      ref += this.skels[w];
      ends.push(ref.length);
    }
    const fw = this.committed - backFrom; // index in starts/ends of the first uncommitted word
    const nb = starts[fw]; // offset of the committed point
    const N = ref.length;
    const m = this.heard.length;
    const W = m + 1;
    const isStart = new Uint8Array(N + 1);
    for (const st of starts) isStart[st] = 1;
    const h = this.heard;

    // ---- layer 0: forward from the committed point ----
    // D[i][j]: cost of explaining heard[0..j) while standing at expected offset i.
    // Ops: 0 = match/substitute, 1 = expected phoneme not heard, 2 = extra heard sound,
    // 3 = went back to an earlier word, 4 = skipped ahead to a later word.
    const size = (N + 2) * W;
    const D0 = new Float32Array(size).fill(INF);
    const B0 = new Uint8Array(size);
    /** For op 4: the offset skipped from. */
    const F0 = new Int32Array(size);
    /** Cheapest layer-0 cost so far at each heard index, over the offsets already filled, and where. */
    const pMin = new Float32Array(W).fill(INF);
    const pArg = new Int32Array(W);
    D0[nb * W] = 0;
    for (let j = 1; j <= m; j++) {
      D0[nb * W + j] = D0[nb * W + j - 1] + insCost(h[j - 1].c);
      B0[nb * W + j] = 2;
    }
    for (let i = nb + 1; i <= N; i++) {
      // Offsets up to i - 1 are final: fold row i - 1 into the running minimum.
      for (let j = 0; j <= m; j++) {
        const v = D0[(i - 1) * W + j];
        if (v < pMin[j]) { pMin[j] = v; pArg[j] = i - 1; }
      }
      const rc = ref[i - 1];
      const del = delCost(rc) - PROGRESS;
      const landing = isStart[i] === 1;
      D0[i * W] = D0[(i - 1) * W] + del;
      B0[i * W] = 1;
      for (let j = 1; j <= m; j++) {
        const hc = h[j - 1].c;
        let best = D0[(i - 1) * W + j - 1] + subCost(rc, hc) - PROGRESS;
        let op = 0;
        const d = D0[(i - 1) * W + j] + del;
        if (d < best) { best = d; op = 1; }
        const ins = D0[i * W + j - 1] + insCost(hc);
        if (ins < best) { best = ins; op = 2; }
        if (landing) {
          const skip = pMin[j] + SKIP_AHEAD;
          if (skip < best) { best = skip; op = 4; F0[i * W + j] = pArg[j]; }
        }
        D0[i * W + j] = best;
        B0[i * W + j] = op;
      }
    }
    // Suffix minimum over offsets: the cheapest place layer 0 could be, at or after offset i.
    const S = new Float32Array(size).fill(INF);
    const SA = new Int32Array(size);
    for (let j = 0; j <= m; j++) {
      for (let i = N; i >= nb; i--) {
        const here = D0[i * W + j];
        const after = S[(i + 1) * W + j];
        if (here <= after) { S[i * W + j] = here; SA[i * W + j] = i; }
        else { S[i * W + j] = after; SA[i * W + j] = SA[(i + 1) * W + j]; }
      }
    }

    // ---- layer 1: after going back once to an earlier word start ----
    const D1 = new Float32Array(size).fill(INF);
    const B1 = new Uint8Array(size);
    for (let i = 0; i < N; i++) {
      const canLand = isStart[i] === 1;
      const from = Math.max(i + 1, nb);
      const rc = i > 0 ? ref[i - 1] : "";
      const del = i > 0 ? delCost(rc) - PROGRESS : 0;
      for (let j = 0; j <= m; j++) {
        let best = INF;
        let op = 0;
        if (canLand && j > 0) {
          const land = S[from * W + j] + JUMP;
          if (land < best) { best = land; op = 3; }
        }
        if (i > 0) {
          if (j > 0) {
            const sub = D1[(i - 1) * W + j - 1] + subCost(rc, h[j - 1].c) - PROGRESS;
            if (sub < best) { best = sub; op = 0; }
          }
          const d = D1[(i - 1) * W + j] + del;
          if (d < best) { best = d; op = 1; }
        }
        if (j > 0) {
          const ins = D1[i * W + j - 1] + insCost(h[j - 1].c);
          if (ins < best) { best = ins; op = 2; }
        }
        D1[i * W + j] = best;
        B1[i * W + j] = op;
      }
    }
    // Row N of layer 1 (the window's end) is reachable only by advancing.
    {
      const rc = ref[N - 1];
      const del = delCost(rc) - PROGRESS;
      for (let j = 0; j <= m; j++) {
        let best = INF;
        let op = 0;
        if (j > 0) {
          const sub = D1[(N - 1) * W + j - 1] + subCost(rc, h[j - 1].c) - PROGRESS;
          if (sub < best) { best = sub; op = 0; }
        }
        const d = D1[(N - 1) * W + j] + del;
        if (d < best) { best = d; op = 1; }
        if (j > 0) {
          const ins = D1[N * W + j - 1] + insCost(h[j - 1].c);
          if (ins < best) { best = ins; op = 2; }
        }
        D1[N * W + j] = best;
        B1[N * W + j] = op;
      }
    }

    // ---- where the reciter is: the cheapest end over both layers ----
    let layer = 0;
    let front = nb;
    for (let i = nb + 1; i <= N; i++) if (D0[i * W + m] < D0[front * W + m]) front = i;
    let bestCost = D0[front * W + m];
    for (let i = 0; i <= N; i++) {
      if (D1[i * W + m] < bestCost - 1e-6) { bestCost = D1[i * W + m]; layer = 1; front = i; }
    }

    // ---- traceback ----
    const cost = new Float32Array(N);
    const matched = new Uint8Array(N);
    const filled = new Uint8Array(N);
    const heardOn: string[] = new Array(N).fill("");
    const frameOn = new Int32Array(N).fill(-1);
    const frameFirst = new Int32Array(N).fill(-1);
    const confOn = new Float32Array(N);
    /** Heard index at which the LAST pass over offset i stood there (-1: never). */
    const heardAt = new Int32Array(N + 1).fill(-1);
    let trail = 0;
    /** Furthest offset the reciter has reached (layer 0's end when they went back). */
    let reach = front;
    const trace = (startLayer: number, row: number): void => {
      cost.fill(0); matched.fill(0); filled.fill(0); heardOn.fill(""); frameOn.fill(-1); frameFirst.fill(-1); confOn.fill(0); heardAt.fill(-1);
      trail = 0;
      reach = row;
      let L = startLayer;
      let i = row;
      let j = m;
      let inTrail = true;
      heardAt[i] = j;
      // The later pass is visited first; an offset keeps the data of the last pass over it.
      for (;;) {
        if (L === 0 && i === nb && j === 0) break;
        const op = L === 0 ? B0[i * W + j] : B1[i * W + j];
        if (L === 0 && i === nb) {
          // Sounds before the first expected one.
          if (inTrail) trail++;
          j--;
          continue;
        }
        if (op === 3) {
          const to = SA[Math.max(i + 1, nb) * W + j];
          L = 0;
          i = to;
          if (to > reach) reach = to;
          inTrail = false;
          if (heardAt[i] < 0) heardAt[i] = j;
          continue;
        }
        if (op === 4) {
          // Skipped ahead: everything between was left out.
          const fromOffset = F0[i * W + j];
          inTrail = false;
          for (let q = i - 1; q >= fromOffset; q--) {
            if (!filled[q]) { cost[q] += delCost(ref[q]); filled[q] = 1; }
            if (heardAt[q] < 0) heardAt[q] = j;
          }
          i = fromOffset;
          continue;
        }
        if (op === 2) {
          if (inTrail) trail++;
          else if (i > 0 && !filled[i - 1]) heardOn[i - 1] = h[j - 1].c + heardOn[i - 1];
          j--;
          continue;
        }
        inTrail = false;
        const q = i - 1;
        const fresh = !filled[q];
        if (op === 0) {
          const hc = h[j - 1];
          if (fresh) {
            cost[q] += subCost(ref[q], hc.c);
            matched[q] = 1;
            heardOn[q] = hc.c + heardOn[q];
            if (frameOn[q] < hc.frame) frameOn[q] = hc.frame;
            frameFirst[q] = hc.frame;
            confOn[q] = hc.conf;
          }
          j--;
        } else if (fresh) {
          cost[q] += delCost(ref[q]);
        }
        // An offset is settled once the traceback moves past it.
        filled[q] = 1;
        i--;
        if (heardAt[i] < 0) heardAt[i] = j;
      }
    };
    trace(layer, front);

    // The user has paused or stopped with sounds left over after the front. If a front further
    // ahead explains them at the price of about one skipped word, they skipped: move there.
    if (layer === 0 && mode !== "live" && trail >= 3 && front < N) {
      const base = D0[front * W + m];
      const cands: number[] = [];
      for (let i = front + 1; i <= N; i++) {
        const d = D0[i * W + m];
        if (d - base > SKIP_BUDGET) continue;
        if (d <= D0[(i - 1) * W + m] && (i === N || d <= D0[(i + 1) * W + m])) cands.push(i);
      }
      cands.sort((a, b) => D0[a * W + m] - D0[b * W + m]);
      let moved = false;
      for (const i of cands.slice(0, 4)) {
        trace(0, i);
        if (trail <= 1) { front = i; moved = true; break; }
      }
      if (!moved) trace(0, front);
    }

    // Words fully behind the furthest point reached.
    let reached = 0; // counted from the first uncommitted word
    while (fw + reached < ends.length && ends[fw + reached] <= reach) reached++;
    // Words the last pass has gone past (what may be committed now).
    let passed = 0;
    while (fw + passed < ends.length && ends[fw + passed] <= front) passed++;

    /** Word k (from the first uncommitted word): 2 = clearly heard, 1 = would pass as recited, 0 = neither. */
    const heardAs = (k: number): number => {
      const start = starts[fw + k];
      const end = ends[fw + k];
      let c = 0;
      let hits = 0;
      let cons = 0;
      let consBad = 0;
      for (let q = start; q < end; q++) {
        c += cost[q];
        hits += matched[q];
        if (!isVowel(ref[q])) { cons++; consBad += Math.min(1, cost[q]); }
      }
      const len = Math.max(1, end - start);
      const err = c / len;
      if (cons >= 2 && err <= SOLID_ERR && consBad <= 0.4 * cons && hits / len >= 0.6) return 2;
      return hits > 0 && !isSlip(err, consBad, cons, false, this.opts) ? 1 : 0;
    };
    const solid = (k: number): boolean => heardAs(k) === 2;
    /**
     * How many of the first `n` pending words have enough evidence around them to be shown or
     * judged. Speech that is not the recitation (someone talking nearby, the reciter saying
     * something else) still lines up with the expected words at a mediocre cost, and the lenient
     * rules below would pass much of it as fine. So a word is only released up to a clearly
     * heard word that has a second clearly heard word within two of it, or that follows a short
     * unclear stretch while the last few released words were mostly clear. `seen` words have
     * evidence to look ahead at. At a pause there is nothing more to wait for: one unclear word
     * (two at the end of the recording) is released on the strength of the words before it.
     * `showOnly`: for lighting a word up (not judging it), one passable word is let through while
     * the reciter is clearly being followed, so short and softly spoken words do not lag.
     */
    const release = (n: number, seen: number, showOnly = false): number => {
      if (!this.opts.requireEvidence) return n;
      const before = this.recent;
      const hist = before.slice();
      const flags: boolean[] = [];
      for (let k = 0; k < seen; k++) flags.push(solid(k));
      // Negative k looks back into the words already committed.
      const at = (k: number): boolean => (k >= 0 ? k < seen && flags[k] : before.length + k >= 0 && before[before.length + k]);
      const trust = (): number => hist.reduce((a, x) => a + (x ? 1 : 0), 0);
      let out = 0;
      for (let k = 0; k < n; k++) {
        if (!flags[k]) continue;
        const paired = at(k - 1) || at(k - 2) || at(k + 1) || at(k + 2);
        if (!paired && !(trust() >= 2 && k - out <= 2)) continue;
        for (let q = out; q <= k; q++) {
          hist.push(flags[q]);
          if (hist.length > TRUST_WORDS) hist.shift();
        }
        out = k + 1;
      }
      if (mode !== "live" && out < n) {
        const run = n - out;
        let clear = 0;
        for (let k = out; k < n; k++) if (flags[k]) clear++;
        if (clear >= 2 && clear >= 0.4 * run) out = n;
        else if (mode === "final" ? trust() >= 2 && run <= 2 : trust() >= 3 && run <= 1) out = n;
      }
      if (showOnly && out < n && trust() >= 3 && heardAs(out) === 1) out++;
      return out;
    };

    const draft = (k: number): Draft => {
      const start = starts[fw + k];
      const end = ends[fw + k];
      const len = Math.max(1, end - start);
      let c = 0;
      let hits = 0;
      let heard = "";
      let endFrame = -1;
      let startFrame = -1;
      let cons = 0;
      let consBad = 0;
      let confSum = 0;
      for (let q = start; q < end; q++) {
        c += cost[q];
        hits += matched[q];
        heard += heardOn[q];
        confSum += confOn[q];
        if (frameOn[q] > endFrame) endFrame = frameOn[q];
        if (startFrame < 0 && frameFirst[q] >= 0) startFrame = frameFirst[q];
        if (!isVowel(ref[q])) { cons++; consBad += Math.min(1, cost[q]); }
      }
      const err = c / len;
      const first = this.first;
      this.first = false;
      let slip = isSlip(err, consBad, cons, first, this.opts);
      const skippedKind = hits / len < 0.34;
      let soft = false;
      if (slip && skippedKind) {
        // Nothing was decoded for the word. With time to spare between its neighbours (consonants
        // only: a stray vowel can match anywhere) it may be a dropped word or a pause.
        let before = -1;
        for (let q = start - 1; q >= nb && before < 0; q--) if (!isVowel(ref[q])) before = frameOn[q];
        if (before < 0) before = this.prevFrame;
        let after = -1;
        for (let q = end; q < N && after < 0; q++) if (!isVowel(ref[q])) after = frameFirst[q];
        const room = after >= 0 && before >= 0 ? after - before : Infinity;
        soft = room >= 4 + 2 * len;
      }
      // A "wrong" word smeared over far more audio than it needs is a garbled stretch, not evidence.
      if (slip && !skippedKind && startFrame >= 0 && endFrame - startFrame > 10 + 6 * len) slip = false;
      // Calling a word wrong takes two heard consonants in its place; one stray sound is not a word.
      if (slip && !skippedKind) {
        let heardCons = 0;
        for (const ch of heard) if (!isVowel(ch)) heardCons++;
        if (heardCons < 2) slip = false;
      }
      for (let q = end - 1; q >= start; q--) {
        if (!isVowel(ref[q]) && frameOn[q] >= 0) { this.prevFrame = frameOn[q]; break; }
      }
      return { index: this.committed + k, err, consBad, cons, conf: hits ? confSum / hits : 0, heard, startFrame, endFrame, slip, skippedKind, soft };
    };
    const emit = (d: Draft, slip: boolean): void => {
      if (this.slipped.has(d.index)) return; // already reported while the reciter was on it
      const v: WordVerdict = { index: d.index, ok: !slip, err: d.err, consBad: d.consBad, cons: d.cons, conf: d.conf, heard: d.heard, startFrame: d.startFrame, endFrame: d.endFrame, atFrame: now };
      if (slip) {
        v.kind = d.skippedKind ? "skipped" : "wrong";
        this.slipped.add(d.index);
      }
      verdicts.push(v);
    };

    // Commit words the front is safely past (all passed words when settled or final).
    let commitCount = 0;
    for (let k = 0; k < passed; k++) {
      if (mode === "live" && front - ends[fw + k] < this.opts.holdback) break;
      commitCount = k + 1;
    }
    let dropTail = 0;
    let lastPartial = false;
    if (mode === "final" && layer === 0 && fw + passed < ends.length) {
      const wordStart = starts[fw + passed];
      const len = ends[fw + passed] - wordStart;
      const partial = front - wordStart;
      if (partial >= Math.ceil(len * 0.6)) {
        // A last word that is mostly spoken when recording stops is judged too.
        for (let q = front; q < ends[fw + passed]; q++) cost[q] += delCost(ref[q]) * 0.5;
        commitCount = passed + 1;
        lastPartial = true;
      } else if (partial === 0 && trail > 0 && (!this.opts.requireEvidence || this.recent.filter(Boolean).length >= 2)) {
        // Recording stopped on sounds that are not the next word (and not a repeat of earlier
        // ones, or layer 1 would have explained them): the next word was said wrong. It is
        // reported, but the position stays on it.
        const tail = h.slice(m - trail);
        const text = tail.map((x) => x.c).join("");
        const consonants = tail.filter((x) => !isVowel(x.c)).length;
        const index = this.committed + passed;
        if (consonants >= 2 && text.length >= 3) {
          if (!this.slipped.has(index)) {
            this.slipped.add(index);
            verdicts.push({ index, ok: false, kind: "wrong", err: 1, consBad: 0, cons: 0, conf: tail.reduce((a, x) => a + x.conf, 0) / tail.length, heard: text, startFrame: tail[0].frame, endFrame: tail[tail.length - 1].frame, atFrame: now });
          }
          dropTail = trail;
        }
      }
    }

    // Only words with enough evidence around them are shown as recited or judged.
    const seenWords = Math.max(reached, passed + (lastPartial ? 1 : 0));
    const shown = release(Math.max(reached, lastPartial ? commitCount : 0), seenWords, true);
    this.cursor = Math.max(this.cursor, this.committed + shown);
    commitCount = Math.min(commitCount, release(commitCount, seenWords));
    for (let k = 0; k < commitCount; k++) {
      this.recent.push(solid(k));
      if (this.recent.length > TRUST_WORDS) this.recent.shift();
    }

    if (this.debug) this.debug({ mode, layer, front, reach, nb, N, m, passed, reached, trail, commitCount, shown, ref, heard: h.map((x) => x.c).join("") });

    // Verdicts, with the skip-run pass: a soft (undecoded, unhurried) word is forgiven on its own,
    // but a run of SKIP_RUN of them, also across commits, is a skipped passage.
    let run = this.softTail;
    let inSkip = this.inSkipRun;
    for (let k = 0; k < commitCount; k++) {
      const d = draft(k);
      if (!(d.slip && d.soft)) {
        // An undecoded word with no time for it is a skip, and so are the undecided ones right before it.
        if (d.slip && d.skippedKind) for (const e of run) emit(e, true);
        run = [];
        inSkip = false;
        emit(d, d.slip);
      } else if (inSkip) {
        emit(d, true);
      } else {
        run.push(d);
        if (run.length >= SKIP_RUN) {
          // The run just became a skipped passage: its earlier words are slips after all.
          for (const e of run) emit(e, true);
          run = [];
          inSkip = true;
        } else {
          emit(d, false);
        }
      }
    }
    this.softTail = run;
    this.inSkipRun = inSkip;

    if (dropTail > 0) h.splice(m - dropTail, dropTail);
    if (commitCount > 0) {
      const cut = ends[fw + commitCount - 1];
      const at = heardAt[Math.min(cut, front)];
      h.splice(0, Math.max(0, Math.min(at, h.length)));
      this.committed += commitCount;
    }
    this.alignedAt = h.length;
    return { cursor: this.cursor, committed: this.committed, verdicts };
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
