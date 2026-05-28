import {
  flattenSessionWords,
  type SessionWordRef,
} from "../content/loader";
import type { FlatLineRef } from "../../types/content";
import {
  ALIGN_LOOKBACK,
  LOCAL_LOOKAHEAD,
  MIN_RELOCALIZE_WORDS,
  RECOGNITION_ALIGN_TAIL,
  relocalizeBackward,
  scanTailResync,
  skippedMissesInRange,
  speculativeMissCutoff,
  type WordMistake,
} from "./align";
import {
  dedupeRecognizedTokens,
  tokenizeTranscript,
  type NormalizeOptions,
} from "./normalize";
import { reciteLog } from "../reciteLog";
import type { AsrProvider, ReciteEngineState, TranscriptEvent } from "./types";

export type ReciteEngineListener = (state: ReciteEngineState) => void;

const MIC_EXPECTED_WINDOW = 32;
const MIC_MAX_PARTIAL_ADVANCE = 6;
const MIC_MAX_FINAL_ADVANCE = 10;
/** Match RECOGNITION_ALIGN_TAIL so scanTailResync sees the full recent phrase. */
const MIC_RECOGNIZED_TAIL = 24;
const MIC_WARMUP_MS = 300;
/** Hint when listening with no cursor advance (R16). */
const STUCK_HINT_MS = 8_000;
/** Only relocalize backward after this idle (avoids yo-yo on noisy partials). */
const RELOCALIZE_MIN_IDLE_MS = 3_500;
/** Cooldown between backward relocalize attempts. */
const RELOCALIZE_COOLDOWN_MS = 4_000;
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
    });
    await this.asr.start({
      locale: "ar-SA",
      contextualStrings: remaining.slice(0, MIC_EXPECTED_WINDOW),
    });
    this.listenStartedAtMs = Date.now();
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

  applyTranscript(text: string, options?: { isFinal?: boolean }): void {
    reciteLog.align("typing", {
      text: text.trim(),
      isFinal: options?.isFinal ?? true,
      wordCursor: this.wordCursor,
    });
    this.handleTranscript({
      text,
      isFinal: options?.isFinal ?? true,
      anchor: this.wordCursor,
      monotonic: false,
      source: "typing",
    });
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
    if (cursorAdvanced && !result.relocalized) {
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

      for (const m of toRecord) {
        if (m.expectedIndex == null) continue;

        const globalWordIndex = anchor + m.expectedIndex;
        if (
          globalWordIndex < savedCursor ||
          globalWordIndex >= this.wordCursor
        ) {
          continue;
        }

        const ref = this.sessionWords[globalWordIndex];
        if (!ref) continue;

        const absolute: WordMistake = {
          ...m,
          globalWordIndex,
          lineIndex: ref.lineIndex,
          wordIndex: ref.wordIndex,
        };

        const dup = this.mistakes.some(
          (x) =>
            x.globalWordIndex === absolute.globalWordIndex &&
            x.kind === absolute.kind
        );
        if (!dup) {
          this.mistakes.push(absolute);
          reciteLog.mistake({
            kind: absolute.kind,
            globalWordIndex: absolute.globalWordIndex,
            expected: absolute.expectedWord,
            recognized: absolute.recognizedWord,
            lineIndex: absolute.lineIndex,
            wordIndex: absolute.wordIndex,
            partial: !event.isFinal,
          });
        }
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
    }, 80);
  }

  private emitNow(): void {
    const state = this.getState();
    for (const l of this.listeners) {
      l(state);
    }
  }
}
