import {
  dedupeRecognizedTokens,
  tokenizeTranscript,
  type NormalizeOptions,
} from "./normalize";
import type { TranscriptDelta } from "./types";

/**
 * Shared transcript state for streaming ASR providers.
 *
 * Originally lived inside `expoSpeechProvider`; extracted so the cloud and
 * on-device providers expose identical `getAlignmentTranscript`,
 * `getTranscriptDelta`, and buffer-reset behavior. The recite engine relies on
 * these being consistent across providers (alignment tail, token deltas, and
 * clean resets — see RAI-7).
 *
 * Model:
 * - `committedTranscript`: finalized text from prior segments.
 * - `liveSegment`: the in-progress segment, replaced on each cumulative partial.
 */

/** Merge a new cumulative chunk into committed text without double-appending. */
export function longestCommonCumulative(
  committed: string,
  addition: string
): string {
  const a = committed.trim();
  const b = addition.trim();
  if (!a) return b;
  if (!b) return a;
  if (b.startsWith(a)) return b;
  if (a.startsWith(b)) return a;
  return `${a} ${b}`.trim();
}

export interface TranscriptAccumulatorOptions {
  /** Max words from the live segment used for partial alignment. */
  partialAlignWords?: number;
  /** Committed-tail words prepended on final alignment. */
  committedTailWords?: number;
  /** Baseline token window kept for delta diffing on partials. */
  alignBaselineWords?: number;
  /** Cap on new tokens reported per delta. */
  maxDeltaTokens?: number;
  normalizeOptions?: NormalizeOptions;
}

const DEFAULTS = {
  partialAlignWords: 18,
  committedTailWords: 10,
  alignBaselineWords: 18,
  maxDeltaTokens: 10,
} as const;

export class TranscriptAccumulator {
  committedTranscript = "";
  liveSegment = "";
  private lastAlignTokens: string[] = [];
  private readonly opts: Required<Omit<TranscriptAccumulatorOptions, "normalizeOptions">> & {
    normalizeOptions: NormalizeOptions;
  };

  constructor(options?: TranscriptAccumulatorOptions) {
    this.opts = {
      partialAlignWords: options?.partialAlignWords ?? DEFAULTS.partialAlignWords,
      committedTailWords:
        options?.committedTailWords ?? DEFAULTS.committedTailWords,
      alignBaselineWords:
        options?.alignBaselineWords ?? DEFAULTS.alignBaselineWords,
      maxDeltaTokens: options?.maxDeltaTokens ?? DEFAULTS.maxDeltaTokens,
      normalizeOptions:
        options?.normalizeOptions ?? { stripTashkeel: true, unifyAlef: true },
    };
  }

  /** Replace the active (in-progress) segment with a cumulative partial. */
  setLiveSegment(text: string): void {
    this.liveSegment = text.trim();
  }

  /** Append a finalized cumulative chunk to committed text. */
  appendCommitted(addition: string): void {
    const trimmed = addition.trim();
    if (!trimmed) return;
    if (this.committedTranscript.includes(trimmed)) return;
    this.committedTranscript = longestCommonCumulative(
      this.committedTranscript,
      trimmed
    );
  }

  /** Fold the current live segment into committed text and clear it. */
  commitLiveSegment(): void {
    if (!this.liveSegment) return;
    this.committedTranscript = longestCommonCumulative(
      this.committedTranscript,
      this.liveSegment
    );
    this.liveSegment = "";
  }

  buildFullTranscript(): string {
    if (!this.committedTranscript) return this.liveSegment.trim();
    if (!this.liveSegment) return this.committedTranscript.trim();
    return `${this.committedTranscript} ${this.liveSegment}`.trim();
  }

  reset(): void {
    this.committedTranscript = "";
    this.liveSegment = "";
    this.lastAlignTokens = [];
  }

  /** Recent phrase for alignment — partials use only the end of the live segment. */
  getAlignmentTranscript(isFinal: boolean): string {
    const live = this.liveSegment.trim();
    if (!isFinal) {
      if (!live) return "";
      const liveWords = live.split(/\s+/).filter(Boolean);
      return liveWords.slice(-this.opts.partialAlignWords).join(" ");
    }

    const committedWords = this.committedTranscript
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const tail = committedWords.slice(-this.opts.committedTailWords).join(" ");
    if (!tail) return live;
    if (!live) return tail;
    return `${tail} ${live}`;
  }

  private tokenizeAlignPhrase(isFinal: boolean): string[] {
    const text = this.getAlignmentTranscript(isFinal);
    return dedupeRecognizedTokens(
      tokenizeTranscript(text, this.opts.normalizeOptions)
    );
  }

  private diffAlignTokens(current: string[]): string[] {
    const prev = this.lastAlignTokens;
    if (prev.length === 0) return [...current];
    const maxOverlap = Math.min(prev.length, current.length);
    for (let overlap = maxOverlap; overlap > 0; overlap--) {
      let ok = true;
      for (let i = 0; i < overlap; i++) {
        if (prev[prev.length - overlap + i] !== current[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return current.slice(overlap);
    }
    return [...current];
  }

  getTranscriptDelta(isFinal: boolean): TranscriptDelta {
    const alignmentText = this.getAlignmentTranscript(isFinal);
    const tokens = this.tokenizeAlignPhrase(isFinal);
    let newTokens = this.diffAlignTokens(tokens);
    if (newTokens.length > this.opts.maxDeltaTokens) {
      newTokens = newTokens.slice(-this.opts.maxDeltaTokens);
    }
    if (isFinal) {
      this.lastAlignTokens = [];
    } else {
      this.lastAlignTokens = tokens.slice(-this.opts.alignBaselineWords);
    }
    return { alignmentText, newTokens, reset: isFinal };
  }
}
