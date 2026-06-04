import type { WordMistake } from "./align";

export interface TranscriptEvent {
  text: string;
  isFinal: boolean;
}

export interface AsrStartOptions {
  locale?: string;
  /** Bias recognition toward upcoming expected words in the session. */
  contextualStrings?: string[];
}

export interface TranscriptDelta {
  /** Text slice used for alignment on this event. */
  alignmentText: string;
  /** New normalized tokens since the previous event (mic). */
  newTokens: string[];
  /** Reset delta baseline (e.g. after a final segment). */
  reset: boolean;
}

export interface AsrProvider {
  readonly name: string;
  start(options?: AsrStartOptions): Promise<void>;
  stop(): Promise<void>;
  onTranscript(listener: (event: TranscriptEvent) => void): () => void;
  onError(listener: (error: Error) => void): () => void;
  /**
   * Substring of the live transcript used for word alignment.
   * Partials should favor the current phrase; finals may use the full session text.
   */
  getAlignmentTranscript?(isFinal: boolean): string;
  /** Incremental tokens for session-heard tracking (mic). */
  getTranscriptDelta?(isFinal: boolean): TranscriptDelta;
  /** Clear iOS cumulative buffer so a retry only hears the new phrase. */
  resetRecognitionBuffer?(): void;
  /** Stop and start recognition without removing transcript listeners. */
  restartRecognition?(options?: AsrStartOptions): Promise<void>;
  /**
   * Update contextual bias mid-stream as the cursor advances, ideally without
   * dropping audio (cloud streaming swaps the socket while the mic keeps
   * running). Presence of this method signals the provider benefits from live
   * re-biasing; absence means the engine leaves the opening bias in place.
   */
  rebias?(options?: AsrStartOptions): Promise<void>;
}

export interface ReciteEngineState {
  /** How many expected words are completed (0 … totalWords). */
  wordCursor: number;
  totalWords: number;
  /** Derived cursor for mushaf layout (line containing current word). */
  lineIndex: number;
  wordIndex: number;
  mistakes: WordMistake[];
  isListening: boolean;
  /** Last raw transcript from ASR (for on-screen feedback). */
  lastHeard: string | null;
  /** Last speech-recognition error, if any. */
  asrError: string | null;
  /** True after ~8s listening with no cursor advance — UI may suggest repeating from here. */
  stuckHint?: boolean;
}
