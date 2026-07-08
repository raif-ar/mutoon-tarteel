import {
  flattenSessionWords,
  type SessionWordRef,
} from "../content/loader";
import type { FlatLineRef } from "../../types/content";
import {
  ALIGN_LOOKBACK,
  isSubstitutionCandidate,
  LOCAL_LOOKAHEAD,
  MIN_RELOCALIZE_WORDS,
  RECOGNITION_ALIGN_TAIL,
  relocalizeBackward,
  scanTailResync,
  skippedMissesInRange,
  speculativeMissCutoff,
  type WordMistake,
} from "./align";
import { acousticReconcile } from "./acousticReconcile";
import {
  dedupeRecognizedTokens,
  tokenizeTranscript,
  type NormalizeOptions,
} from "./normalize";
import { getReciteBuildFingerprint } from "../reciteBuildStamp";
import { reciteLog } from "../reciteLog";
import type {
  AsrProvider,
  HeardWord,
  ReciteEngineState,
  TranscriptEvent,
} from "./types";

export type ReciteEngineListener = (state: ReciteEngineState) => void;

const MIC_EXPECTED_WINDOW = 32;
/** Re-bias cloud keyterms once the cursor advances this many words (R11). */
const MIC_REBIAS_ADVANCE = 12;
const MIC_MAX_PARTIAL_ADVANCE = 8;
const MIC_MAX_FINAL_ADVANCE = 10;
/** UI update coalescing for non-final partials (pure paint latency). */
const EMIT_DEBOUNCE_MS = 50;
/**
 * Don't paint mistakes right after the mic (re)starts. The first cloud final is
 * frequently garbage (clipped onset, wrong first word) and would otherwise
 * commit a false "missed" on the opening word before the reciter is rolling.
 * The cursor still advances during this window — we only suppress red marks.
 */
const MIC_COMMIT_GRACE_MS = 1_200;
/**
 * A single alignment step that skips more than this many expected words at once
 * is the cloud catching up after lag (the reciter said the line; ASR batched it
 * late or garbled a rhyme), not a burst of that many real per-word errors. Above
 * this we advance the cursor but record no mistakes — multi-word red clusters
 * are almost always mismatch, and those false reds are what block the ≥90% match
 * bar. A genuine single missed word (= this) is still recorded; reciters rarely
 * omit exactly two adjacent words then continue fluently (a real stall instead
 * stops advancing and is surfaced via stuckHint), so 2+ in one step is noise.
 */
const MIC_MAX_SKIP_MISSES = 1;
/**
 * v4 precision-first policy: a skip-ahead miss with no competing heard token is
 * an *omission*, and live a human skip is byte-identical to an ASR drop (the
 * recognizer simply never emitted the word — true of every false red in the
 * clean golden log, mostly trailed-off rhyme words). We cannot tell them apart
 * from text alone, so on the mic we suppress omission reds entirely and recover
 * the real ones post-session from the logged heard stream + recorded audio
 * (`heardStream` / reconcile roadmap). Substitutions (a wrong word was heard)
 * are still painted live. Set true to fall back to recording single omissions.
 */
const MIC_RECORD_OMISSIONS = false;
/**
 * At stop, replace the live mistake list with the acoustic reconcile over the
 * full word timeline (timings + confidence). The live greedy pass suppresses
 * omissions and only catches single-word swaps, so real skips and multi-word
 * substitutions go unflagged; the reconcile recovers them and uses the
 * inter-word time gap to drop ASR drops (audio present) from true omissions.
 * Live cues stay as-is during recitation; this only rewrites the final tally.
 * Set false to fall back to the live mistake list.
 */
const RECONCILE_AT_STOP = true;
/**
 * Rolling reconcile (align-trust-v5): run the acoustic reconcile on every
 * cloud *final* over the words the cursor has passed, not just at stop. This
 * repairs the two live failure modes RECONCILE_AT_STOP leaves open mid-session:
 * an interim-garble substitution red that the segment's own final corrects
 * (النَّظْمُ heard "المظلوم" on the partial, "النظم" on the final), and real
 * omissions that otherwise stay invisible until stop. Kill independently of
 * the stop-time pass if fresh logs regress.
 */
const RECONCILE_ON_FINAL = true;
/**
 * Words at the cursor edge excluded from the rolling reconcile: their closing
 * final may not have arrived yet, so timings there are provisional interim
 * evidence. The stop-time pass (upTo = cursor) covers them at the end.
 */
const RECONCILE_HOLDBACK = 3;
/** Match RECOGNITION_ALIGN_TAIL so scanTailResync sees the full recent phrase. */
const MIC_RECOGNIZED_TAIL = 24;
/**
 * 150ms (was 300): the cloud path resets the transcript accumulator on start,
 * so only mic-onset clipping needs guarding; MIC_COMMIT_GRACE_MS (1.2s) still
 * protects against a garbage first final.
 */
const MIC_WARMUP_MS = 150;
/** Hint when listening with no cursor advance (R16). */
const STUCK_HINT_MS = 8_000;
/**
 * Only relocalize backward after this idle (avoids yo-yo on noisy partials).
 * Cloud finals are accurate and re-biasing keeps the cursor honest, so we wait
 * longer before second-guessing forward progress with a backward jump.
 */
const RELOCALIZE_MIN_IDLE_MS = 4_500;
/** Cooldown between backward relocalize attempts. */
const RELOCALIZE_COOLDOWN_MS = 6_000;
/** Lines to move back when user taps the stuck hint. */
const REWIND_LINES_ON_STUCK = 2;

export class ReciteEngine {
  private lines: FlatLineRef[] = [];
  private sessionWords: SessionWordRef[] = [];
  private wordCursor = 0;
  private mistakes: WordMistake[] = [];
  private peekCount = 0;
  private isListening = false;
  private lastHeard: string | null = null;
  private asrError: string | null = null;
  private stuckHint = false;
  private lastAdvanceAtMs = 0;
  private lastRelocalizeAtMs = 0;
  private lastMatchedThrough = 0;
  private lastAlignAnchor = 0;
  /** Normalized tokens heard this listen (for backward relocalize + deltas). */
  private sessionHeardWords: string[] = [];
  private lastRecognizedTail: string[] = [];
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAlignLogKey = "";
  private listenStartedAtMs = 0;
  /** Cursor position at which the active ASR bias keyterms were computed. */
  private lastBiasCursor = 0;
  /** Guards overlapping live re-bias swaps. */
  private rebiasInFlight = false;
  /** Ignore transient no-speech right after mic start/restart (RAI-7). */
  private ignoreAsrErrorsUntilMs = 0;
  private listeners = new Set<ReciteEngineListener>();
  private unsubTranscript?: () => void;
  private unsubError?: () => void;
  private normalizeOptions: NormalizeOptions;

  constructor(
    private readonly asr: AsrProvider,
    options?: { strictTashkeel?: boolean }
  ) {
    this.normalizeOptions = {
      stripTashkeel: !options?.strictTashkeel,
      unifyAlef: true,
    };
  }

  loadSession(lines: FlatLineRef[]): void {
    this.lines = lines;
    this.sessionWords = flattenSessionWords(lines);
    this.wordCursor = 0;
    this.mistakes = [];
    this.peekCount = 0;
    this.lastHeard = null;
    this.asrError = null;
    this.stuckHint = false;
    this.lastMatchedThrough = 0;
    this.lastAlignAnchor = 0;
    this.sessionHeardWords = [];
    this.lastRecognizedTail = [];
    this.lastRelocalizeAtMs = 0;
    reciteLog.session("load", {
      totalWords: this.sessionWords.length,
      lines: lines.length,
      start: reciteLog.previewWords(
        this.sessionWords.slice(0, 6).map((w) => w.word)
      ),
    });
    this.emitNow();
  }

  getState(): ReciteEngineState {
    const pos = this.cursorPosition();
    return {
      wordCursor: this.wordCursor,
      totalWords: this.sessionWords.length,
      lineIndex: pos.lineIndex,
      wordIndex: pos.wordIndex,
      mistakes: [...this.mistakes],
      isListening: this.isListening,
      lastHeard: this.lastHeard,
      asrError: this.asrError,
      stuckHint: this.stuckHint,
    };
  }

  getLines(): FlatLineRef[] {
    return this.lines;
  }

  subscribe(listener: ReciteEngineListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  async startListening(): Promise<void> {
    if (this.isListening) return;
    this.lastMatchedThrough = 0;
    this.lastAlignAnchor = this.wordCursor;
    this.sessionHeardWords = [];
    this.lastRecognizedTail = [];
    this.stuckHint = false;
    this.lastAdvanceAtMs = Date.now();
    this.lastRelocalizeAtMs = 0;

    this.unsubTranscript = this.asr.onTranscript((e) => {
      if (!e.text.trim()) return;
      this.handleMicTranscript(e.text, e.isFinal);
    });
    this.unsubError = this.asr.onError((err) => {
      if (Date.now() < this.ignoreAsrErrorsUntilMs) {
        reciteLog.asr("errorIgnored", {
          message: err.message,
          graceMs: this.ignoreAsrErrorsUntilMs - Date.now(),
        });
        return;
      }
      const msg = err.message.toLowerCase();
      if (msg.includes("no-speech") || msg.includes("no speech")) {
        reciteLog.asr("noSpeechIgnored", { message: err.message });
        return;
      }
      this.asrError = err.message;
      reciteLog.error("asr", { message: err.message });
      this.scheduleEmit(true);
    });

    const remaining = this.expectedWordsFrom(this.wordCursor);
    reciteLog.listen("start", {
      wordCursor: this.wordCursor,
      remainingCount: remaining.length,
      remaining: reciteLog.previewWords(remaining, 12),
      provider: this.asr.name,
      ...getReciteBuildFingerprint(),
    });
    await this.asr.start({
      locale: "ar-SA",
      contextualStrings: remaining.slice(0, MIC_EXPECTED_WINDOW),
    });
    this.listenStartedAtMs = Date.now();
    this.lastBiasCursor = this.wordCursor;
    this.ignoreAsrErrorsUntilMs = Date.now() + 1_200;
    this.isListening = true;
    this.emitNow();
  }

  async stopListening(): Promise<void> {
    if (!this.isListening) return;
    reciteLog.listen("stop", {
      wordCursor: this.wordCursor,
      totalWords: this.sessionWords.length,
      mistakes: this.mistakes.length,
    });
    // Full normalized recognition stream for post-session reconciliation: a
    // global alignment of this against the matn is far more accurate than the
    // live greedy cursor, and (with recorded audio) lets us tell a real human
    // omission from an ASR drop — the false reds the live pass cannot avoid.
    reciteLog.session("heardStream", {
      count: this.sessionHeardWords.length,
      wordCursor: this.wordCursor,
      tokens: this.sessionHeardWords.join(" "),
    });
    // Acoustic timeline: per-word timings + confidence on a continuous session
    // clock. The gap between two matched words separates a human omission
    // (adjacent in time) from an ASR drop (audio present, word never emitted) —
    // the residual false reds the text-only pass cannot resolve.
    const timeline = this.asr.getHeardTimeline?.() ?? [];
    if (timeline.length > 0) {
      reciteLog.session("heardTimeline", {
        count: timeline.length,
        words: timeline.map((w) => ({
          w: w.word,
          t0: Math.round(w.start * 1000) / 1000,
          t1: Math.round(w.end * 1000) / 1000,
          c: Math.round(w.confidence * 1000) / 1000,
        })),
      });
    }
    if (RECONCILE_AT_STOP && timeline.length > 0 && this.wordCursor > 0) {
      this.applyAcousticReconcile(timeline);
    }
    await this.asr.stop();
    this.unsubTranscript?.();
    this.unsubError?.();
    this.unsubTranscript = undefined;
    this.unsubError = undefined;
    this.isListening = false;
    this.stuckHint = false;
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    this.emitNow();
  }

  /**
   * Replace the live mistake list with the acoustic reconcile over the full word
   * timeline. The live pass suppresses omissions and only catches single-word
   * swaps; the reconcile recovers real skips and multi-word substitutions, and
   * uses the inter-word time gap to drop ASR drops (audio present) from true
   * omissions. The mapped list reuses the same WordMistake shape the UI renders.
   */
  private applyAcousticReconcile(
    timeline: HeardWord[],
    upTo: number = this.wordCursor,
    mode: "stop" | "final" = "stop"
  ): void {
    const matn = this.sessionWords.slice(0, upTo).map((w) => w.word);
    if (matn.length === 0) return;
    const result = acousticReconcile(matn, timeline, this.normalizeOptions);
    const reconciled: WordMistake[] = [];
    for (const m of result.mistakes) {
      const ref = this.sessionWords[m.expectedIndex];
      if (!ref) continue;
      reconciled.push({
        kind: m.kind,
        expectedIndex: m.expectedIndex,
        expectedWord: m.expectedWord,
        recognizedWord: m.recognizedWord,
        globalWordIndex: m.expectedIndex,
        lineIndex: ref.lineIndex,
        wordIndex: ref.wordIndex,
      });
    }
    // Reconcile is authoritative below the watermark; live reds at the cursor
    // edge (>= upTo) are kept until their closing final arrives.
    const edge = this.mistakes.filter(
      (m) => (m.globalWordIndex ?? m.expectedIndex ?? 0) >= upTo
    );
    const merged = reconciled.concat(edge);
    merged.sort((a, b) => (a.globalWordIndex ?? 0) - (b.globalWordIndex ?? 0));
    reciteLog.session(mode === "stop" ? "reconciled" : "reconcileLive", {
      live: this.mistakes.length,
      reconciled: reconciled.length,
      upTo,
      asrDropsSuppressed: result.drops.length,
      matched: result.matched,
      mistakes: reconciled.map((m) => ({
        i: m.globalWordIndex,
        kind: m.kind,
        expected: m.expectedWord,
        heard: m.recognizedWord,
      })),
    });
    this.mistakes = merged;
  }

  peekNextWord(): string | null {
    const next = this.sessionWords[this.wordCursor];
    if (!next) return null;
    this.peekCount += 1;
    return next.word;
  }

  /** Move cursor manually (e.g. tap a word). Allowed backward within the session. */
  setWordCursor(index: number): void {
    const next = Math.max(0, Math.min(index, this.sessionWords.length));
    if (next === this.wordCursor) return;
    reciteLog.cursor("setWordCursor", { from: this.wordCursor, to: next });
    this.wordCursor = next;
    this.lastMatchedThrough = 0;
    this.lastAlignAnchor = next;
    this.stuckHint = false;
    this.lastAdvanceAtMs = Date.now();
    this.emitNow();
  }

  private globalIndexAtLineStart(lineIndex: number): number {
    const idx = this.sessionWords.findIndex((w) => w.lineIndex === lineIndex);
    return idx >= 0 ? idx : 0;
  }

  /**
   * Keep cloud keyterm biasing aligned with where the reciter actually is.
   *
   * The opening bias only covers the first window of the matn; as the cursor
   * moves forward it goes stale. When the provider supports live re-biasing
   * (cloud streaming), swap in keyterms for the upcoming window — without
   * dropping audio — once the cursor has advanced past the threshold.
   */
  private maybeRefreshBias(): void {
    if (!this.isListening) return;
    if (!this.asr.rebias) return;
    if (this.rebiasInFlight) return;
    if (this.wordCursor - this.lastBiasCursor < MIC_REBIAS_ADVANCE) return;

    this.lastBiasCursor = this.wordCursor;
    this.rebiasInFlight = true;
    const contextualStrings = this.expectedWordsFrom(this.wordCursor).slice(
      0,
      MIC_EXPECTED_WINDOW
    );
    reciteLog.asr("rebiasRequest", {
      cursor: this.wordCursor,
      count: contextualStrings.length,
    });
    void this.asr
      .rebias({ locale: "ar-SA", contextualStrings })
      .catch((e: unknown) => {
        reciteLog.error("asr.rebias", {
          message: e instanceof Error ? e.message : String(e),
        });
      })
      .finally(() => {
        this.rebiasInFlight = false;
      });
  }

  private async restartMicAfterRewind(): Promise<void> {
    this.lastRecognizedTail = [];
    this.sessionHeardWords = [];
    this.lastMatchedThrough = 0;
    this.lastAlignAnchor = this.wordCursor;
    this.stuckHint = false;
    this.lastAdvanceAtMs = Date.now();
    this.lastRelocalizeAtMs = 0;

    const startOptions = {
      locale: "ar-SA",
      contextualStrings: this.expectedWordsFrom(this.wordCursor).slice(
        0,
        MIC_EXPECTED_WINDOW
      ),
    };

    if (this.isListening && this.asr.restartRecognition) {
      await this.asr.restartRecognition(startOptions);
      this.listenStartedAtMs = Date.now();
      this.lastBiasCursor = this.wordCursor;
      this.ignoreAsrErrorsUntilMs = Date.now() + 1_200;
    } else {
      this.asr.resetRecognitionBuffer?.();
    }
    this.emitNow();
  }

  /** Repeat from the current highlighted word (no cursor move). */
  /** Move cursor back N lines and restart mic (stuck recovery). */
  async rewindAndRetry(linesBack = REWIND_LINES_ON_STUCK): Promise<void> {
    const from = this.wordCursor;
    const targetLine = Math.max(
      0,
      this.cursorPosition().lineIndex - linesBack
    );
    const targetIndex = this.globalIndexAtLineStart(targetLine);
    reciteLog.listen("rewindAndRetry", {
      from,
      to: targetIndex,
      linesBack,
      targetLine,
    });
    this.setWordCursor(targetIndex);
    await this.restartMicAfterRewind();
  }

  private cursorPosition(): { lineIndex: number; wordIndex: number } {
    if (this.wordCursor >= this.sessionWords.length) {
      const last = this.sessionWords[this.sessionWords.length - 1];
      return last
        ? { lineIndex: last.lineIndex + 1, wordIndex: 0 }
        : { lineIndex: 0, wordIndex: 0 };
    }
    const ref = this.sessionWords[this.wordCursor];
    return { lineIndex: ref.lineIndex, wordIndex: ref.wordIndex };
  }

  private expectedWordsFrom(anchor: number, maxWords?: number): string[] {
    const slice = this.sessionWords.slice(anchor);
    const limited = maxWords != null ? slice.slice(0, maxWords) : slice;
    return limited.map((w) => w.word);
  }

  private appendSessionHeard(recognized: string[]): void {
    const delta = this.diffRecognizedTail(recognized);
    if (delta.length > 0) {
      this.sessionHeardWords.push(...delta);
      if (this.sessionHeardWords.length > 120) {
        this.sessionHeardWords = this.sessionHeardWords.slice(-120);
      }
    }
    this.lastRecognizedTail = recognized;
  }

  /** New tokens since last recognition tail (R15). */
  private diffRecognizedTail(recognized: string[]): string[] {
    if (recognized.length === 0) return [];
    const prev = this.lastRecognizedTail;
    if (prev.length === 0) return [...recognized];

    const maxOverlap = Math.min(prev.length, recognized.length);
    for (let overlap = maxOverlap; overlap > 0; overlap--) {
      let ok = true;
      for (let i = 0; i < overlap; i++) {
        if (prev[prev.length - overlap + i] !== recognized[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return recognized.slice(overlap);
    }

    return [...recognized];
  }

  private handleMicTranscript(text: string, isFinal: boolean): void {
    if (!isFinal && Date.now() - this.listenStartedAtMs < MIC_WARMUP_MS) {
      reciteLog.asr("warmupSkip", {
        ageMs: Date.now() - this.listenStartedAtMs,
      });
      return;
    }

    const before = this.wordCursor;
    const deltaPayload = this.asr.getTranscriptDelta?.(isFinal);
    const alignText =
      deltaPayload?.alignmentText ??
      this.asr.getAlignmentTranscript?.(isFinal) ??
      text;

    this.handleTranscript({
      text: alignText,
      displayText: text,
      isFinal,
      anchor: this.wordCursor,
      monotonic: true,
      source: "mic",
      deltaTokens: deltaPayload?.newTokens,
      resetHeard: deltaPayload?.reset ?? isFinal,
    });

    if (isFinal) {
      reciteLog.listen("segmentFinal", { wordCursor: this.wordCursor });
      if (RECONCILE_ON_FINAL) {
        const upTo = Math.max(0, this.wordCursor - RECONCILE_HOLDBACK);
        const timeline = this.asr.getHeardTimeline?.() ?? [];
        if (upTo > 0 && timeline.length > 0) {
          this.applyAcousticReconcile(timeline, upTo, "final");
        }
      }
      this.lastMatchedThrough = 0;
      this.lastAlignAnchor = this.wordCursor;
      this.lastRecognizedTail = [];
      if (deltaPayload?.reset ?? true) {
        /* keep sessionHeardWords for relocalize within listen */
      }
      this.scheduleEmit(true);
      return;
    }

    this.updateStuckHint();
    this.scheduleEmit(this.wordCursor > before);
  }

  private updateStuckHint(): void {
    if (!this.isListening) {
      this.stuckHint = false;
      return;
    }
    const idle = Date.now() - this.lastAdvanceAtMs;
    const next = idle >= STUCK_HINT_MS;
    if (next !== this.stuckHint) {
      this.stuckHint = next;
      if (next) {
        reciteLog.listen("stuckHint", {
          idleMs: idle,
          wordCursor: this.wordCursor,
        });
      }
    }
  }

  private handleTranscript(
    event: TranscriptEvent & {
      anchor: number;
      monotonic: boolean;
      source: "mic" | "typing";
      displayText?: string;
      deltaTokens?: string[];
      resetHeard?: boolean;
    }
  ): void {
    if (this.wordCursor >= this.sessionWords.length && event.isFinal) return;

    const alignText = event.text.trim();
    if (!alignText) return;

    this.asrError = null;

    if (event.monotonic && event.anchor !== this.lastAlignAnchor) {
      this.lastMatchedThrough = 0;
      this.lastAlignAnchor = event.anchor;
    }

    let recognized = dedupeRecognizedTokens(
      tokenizeTranscript(alignText, this.normalizeOptions)
    );
    if (event.source === "mic") {
      if (recognized.length > MIC_RECOGNIZED_TAIL) {
        recognized = recognized.slice(-MIC_RECOGNIZED_TAIL);
      }
      if (!event.isFinal && recognized.length === 0) {
        return;
      }
    }
    if (recognized.length === 0) return;

    if (event.source === "mic") {
      if (event.deltaTokens && event.deltaTokens.length > 0) {
        this.sessionHeardWords.push(...event.deltaTokens);
        if (this.sessionHeardWords.length > 120) {
          this.sessionHeardWords = this.sessionHeardWords.slice(-120);
        }
      } else {
        this.appendSessionHeard(recognized);
      }
      if (event.resetHeard) {
        this.lastRecognizedTail = recognized;
      }
    }

    const heardSource = (event.displayText ?? event.text).trim();
    if (heardSource) {
      this.lastHeard = dedupeRecognizedTokens(
        tokenizeTranscript(heardSource, this.normalizeOptions)
      ).join(" ");
    }

    const isMic = event.source === "mic";
    const savedCursor = this.wordCursor;
    const anchor = event.anchor;

    const lookback = isMic ? ALIGN_LOOKBACK : LOCAL_LOOKAHEAD;
    const localStart = Math.max(0, anchor - lookback);
    const localExpected = this.expectedWordsFrom(
      localStart,
      MIC_EXPECTED_WINDOW + lookback
    );
    const offsetInSlice = anchor - localStart;

    let result = scanTailResync(
      localExpected,
      offsetInSlice,
      recognized,
      this.normalizeOptions
    );

    let matchedThrough = result.matchedThrough;
    const rawMatchedThrough = matchedThrough;

    const resyncBack =
      typeof result.debug?.resyncBack === "number" ? result.debug.resyncBack : 0;
    if (
      isMic &&
      !event.isFinal &&
      resyncBack > 0 &&
      matchedThrough > MIC_MAX_PARTIAL_ADVANCE
    ) {
      matchedThrough = Math.min(
        matchedThrough,
        MIC_MAX_PARTIAL_ADVANCE + resyncBack
      );
    }

    const relativeCursor = savedCursor - anchor;

    if (isMic) {
      const maxAdvance = event.isFinal
        ? MIC_MAX_FINAL_ADVANCE
        : MIC_MAX_PARTIAL_ADVANCE;
      const maxThrough = relativeCursor + maxAdvance;
      if (matchedThrough > maxThrough) {
        reciteLog.cursor(event.isFinal ? "finalCap" : "partialCap", {
          matchedThrough,
          cappedTo: maxThrough,
          anchor,
        });
        matchedThrough = maxThrough;
      }
    }

    let nextCursor = Math.min(
      anchor + matchedThrough,
      this.sessionWords.length
    );

    // No forward jump beyond prefix match + cap (R9).
    if (nextCursor > savedCursor + (matchedThrough - relativeCursor)) {
      nextCursor = Math.min(
        savedCursor + Math.max(0, matchedThrough - relativeCursor),
        this.sessionWords.length
      );
    }

    // Backward relocalize only when genuinely stuck (R16–R18) — not every partial.
    const idleMs = Date.now() - this.lastAdvanceAtMs;
    const relocalizeCooldownOk =
      Date.now() - this.lastRelocalizeAtMs >= RELOCALIZE_COOLDOWN_MS;
    const relocalizeIdleMs = this.stuckHint ? 1_500 : RELOCALIZE_MIN_IDLE_MS;
    const canRelocalize =
      isMic &&
      nextCursor <= savedCursor &&
      recognized.length >= MIN_RELOCALIZE_WORDS &&
      relocalizeCooldownOk &&
      (this.stuckHint || idleMs >= relocalizeIdleMs);

    if (canRelocalize) {
      const passed = this.sessionWords
        .slice(0, savedCursor)
        .map((w) => w.word);
      const heardForRelocalize = recognized.slice(
        -Math.min(recognized.length, RECOGNITION_ALIGN_TAIL)
      );

      const reloc = relocalizeBackward(
        passed,
        heardForRelocalize,
        savedCursor,
        this.normalizeOptions
      );
      if (
        reloc?.relocalized &&
        reloc.relocalizeCursor != null &&
        reloc.relocalizeCursor < savedCursor
      ) {
        reciteLog.cursor("relocalizeBackward", {
          from: savedCursor,
          to: reloc.relocalizeCursor,
          len: reloc.debug?.relocalizeLen,
          idleMs,
          stuckHint: this.stuckHint,
        });
        nextCursor = reloc.relocalizeCursor;
        result = reloc;
        matchedThrough = 0;
        this.lastRelocalizeAtMs = Date.now();
      }
    }

    if (event.monotonic && matchedThrough > 0) {
      this.lastMatchedThrough = matchedThrough;
    }

    if (event.monotonic && nextCursor < savedCursor) {
      this.wordCursor = nextCursor;
    } else if (nextCursor >= savedCursor) {
      this.wordCursor = nextCursor;
    } else {
      this.wordCursor = savedCursor;
    }

    if (this.wordCursor > savedCursor) {
      this.lastAdvanceAtMs = Date.now();
      this.stuckHint = false;
      if (isMic) this.maybeRefreshBias();
    } else if (isMic) {
      this.updateStuckHint();
    }

    const expectedWordAt = (idx: number) =>
      this.sessionWords[anchor + idx]?.word ?? null;

    const alignLogKey = `${event.source}|${recognized.join("|")}|${this.wordCursor}`;
    const shouldLogAlign =
      event.isFinal ||
      event.source === "typing" ||
      this.wordCursor !== savedCursor ||
      alignLogKey !== this.lastAlignLogKey;
    if (shouldLogAlign) {
      this.lastAlignLogKey = alignLogKey;
      reciteLog.align("result", {
        source: event.source,
        isFinal: event.isFinal,
        monotonic: event.monotonic,
        anchor,
        cursorBefore: savedCursor,
        cursorAfter: this.wordCursor,
        rawMatchedThrough,
        matchedThrough,
        relocalized: result.relocalized ?? false,
        recognized: reciteLog.previewWords(recognized, 16),
        expectedFromAnchor: reciteLog.previewWords(
          localExpected.slice(offsetInSlice, offsetInSlice + 12),
          12
        ),
        nextExpected: expectedWordAt(matchedThrough),
        alignMistakes: result.mistakes.length,
      });
    }

    const cursorAdvanced = this.wordCursor > savedCursor;
    const withinCommitGrace =
      isMic && Date.now() - this.listenStartedAtMs < MIC_COMMIT_GRACE_MS;
    if (cursorAdvanced && withinCommitGrace) {
      reciteLog.cursor("commitGraceSkip", {
        ageMs: Date.now() - this.listenStartedAtMs,
        fromCursor: savedCursor,
        toCursor: this.wordCursor,
      });
    }
    if (cursorAdvanced && !result.relocalized && !withinCommitGrace) {
      const fromRelative = savedCursor - anchor;
      const toRelative = this.wordCursor - anchor;
      const speculativeBefore = isMic && !event.isFinal
        ? speculativeMissCutoff(result.debug)
        : 0;
      const toRecord = skippedMissesInRange(
        result.mistakes,
        matchedThrough,
        fromRelative,
        toRelative
      ).filter((m) => {
        if (m.expectedIndex == null) return false;
        if (speculativeBefore <= 0) return true;
        return m.expectedIndex >= fromRelative + speculativeBefore;
      });

      // Split skip-ahead misses by evidence. A *substitution* has a competing
      // heard token that is not an echo of an already-recited word — positive
      // evidence the reciter said a different word, so it is a high-confidence
      // human error worth painting even inside a cluster. An *omission* has no
      // heard token: live, a human skip and an ASR drop are indistinguishable
      // (only the recorded audio can tell them apart — see reconcile roadmap),
      // so we keep the conservative cluster suppression that hides ASR catch-up.
      const subs: WordMistake[] = [];
      const omissions: WordMistake[] = [];
      for (const m of toRecord) {
        if (m.expectedIndex == null) continue;
        const gi = anchor + m.expectedIndex;
        const passed = [
          this.sessionWords[gi - 1]?.word,
          this.sessionWords[gi - 2]?.word,
        ];
        if (
          isSubstitutionCandidate(m.recognizedWord, passed, this.normalizeOptions)
        ) {
          subs.push({ ...m, kind: "wrong" });
        } else {
          omissions.push({ ...m, kind: "missed", recognizedWord: null });
        }
      }

      const recordMistake = (m: WordMistake) => {
        if (m.expectedIndex == null) return;
        const globalWordIndex = anchor + m.expectedIndex;
        if (globalWordIndex < savedCursor || globalWordIndex >= this.wordCursor) {
          return;
        }
        const ref = this.sessionWords[globalWordIndex];
        if (!ref) return;

        const absolute: WordMistake = {
          ...m,
          globalWordIndex,
          lineIndex: ref.lineIndex,
          wordIndex: ref.wordIndex,
        };

        // A word is either wrong or missed, never both: upgrade missed→wrong as
        // evidence arrives across partials, but never duplicate or downgrade.
        const existingIdx = this.mistakes.findIndex(
          (x) => x.globalWordIndex === globalWordIndex
        );
        if (existingIdx >= 0) {
          const existing = this.mistakes[existingIdx];
          if (existing.kind === absolute.kind) return;
          if (absolute.kind === "wrong" && existing.kind === "missed") {
            this.mistakes[existingIdx] = absolute;
            reciteLog.mistake({
              kind: absolute.kind,
              globalWordIndex,
              expected: absolute.expectedWord,
              recognized: absolute.recognizedWord,
              lineIndex: absolute.lineIndex,
              wordIndex: absolute.wordIndex,
              partial: !event.isFinal,
              upgraded: true,
            });
          }
          return;
        }

        this.mistakes.push(absolute);
        reciteLog.mistake({
          kind: absolute.kind,
          globalWordIndex,
          expected: absolute.expectedWord,
          recognized: absolute.recognizedWord,
          lineIndex: absolute.lineIndex,
          wordIndex: absolute.wordIndex,
          partial: !event.isFinal,
        });
      };

      // Substitutions are always painted (real human swaps must survive clusters).
      for (const m of subs) recordMistake(m);

      // Omissions: on the mic, either suppressed entirely (precision-first, v4)
      // or — when re-enabled — only past the cluster cap, since cloud catching up
      // after lag looks like many consecutive misses while a reciter does not
      // skip this many distinct words in one step. Typing is exact, so it always
      // records.
      const suppressOmissions =
        isMic &&
        (!MIC_RECORD_OMISSIONS || omissions.length > MIC_MAX_SKIP_MISSES);
      if (suppressOmissions && omissions.length > 0) {
        reciteLog.cursor("skipAheadMissesIgnored", {
          source: event.source,
          isFinal: event.isFinal,
          count: omissions.length,
          reason: MIC_RECORD_OMISSIONS ? "cluster" : "omissionPolicy",
          fromCursor: savedCursor,
          toCursor: this.wordCursor,
          expected: reciteLog.previewWords(
            omissions
              .map((m) => m.expectedWord)
              .filter((w): w is string => w != null),
            8
          ),
        });
      } else {
        for (const m of omissions) recordMistake(m);
      }
    }

    if (cursorAdvanced && rawMatchedThrough > savedCursor - anchor) {
      reciteLog.align("skipAhead", {
        source: event.source,
        fromCursor: savedCursor,
        toCursor: this.wordCursor,
        skipped: savedCursor - anchor,
      });
    }

    const beforePrune = this.mistakes.length;
    this.pruneMistakes();
    if (this.mistakes.length < beforePrune) {
      reciteLog.cursor("pruneMistakes", {
        before: beforePrune,
        after: this.mistakes.length,
        wordCursor: this.wordCursor,
      });
    }

    this.scheduleEmit(event.isFinal);

    if (event.isFinal && this.wordCursor >= this.sessionWords.length) {
      reciteLog.session("complete", { wordCursor: this.wordCursor });
      void this.stopListening();
    }
  }

  private pruneMistakes(): void {
    this.mistakes = this.mistakes.filter((m) => {
      if (m.kind === "extra") return false;
      if (m.globalWordIndex == null) return false;
      if (m.globalWordIndex > this.wordCursor) return false;
      return true;
    });
  }

  private scheduleEmit(immediate = false): void {
    if (immediate) {
      if (this.emitTimer) clearTimeout(this.emitTimer);
      this.emitTimer = null;
      this.emitNow();
      return;
    }
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emitNow();
    }, EMIT_DEBOUNCE_MS);
  }

  private emitNow(): void {
    const state = this.getState();
    for (const l of this.listeners) {
      l(state);
    }
  }
}
