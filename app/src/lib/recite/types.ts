/** Shared types of the on-device Recite engine. */

export type SlipKind = "wrong" | "skipped";

/** One word the reciter got wrong or left out. */
export interface Slip {
  kind: SlipKind;
  /** Index into the session's word list (not the matn). */
  globalWordIndex: number;
  /** Index into the session's lines. */
  lineIndex: number;
  /** Index of the word within its line. */
  wordIndex: number;
  expectedWord: string;
  /** Readable approximation of what was heard instead ("" when nothing was). */
  heard: string;
}

export interface ReciteEngineState {
  /** Words completed so far (0 … totalWords). */
  wordCursor: number;
  totalWords: number;
  /** Session line that holds the current word (lines.length when done). */
  lineIndex: number;
  wordIndex: number;
  mistakes: Slip[];
  isListening: boolean;
  /** The listener model is being loaded (first start only). */
  isPreparing: boolean;
  /** Last listening error, if any. */
  asrError: string | null;
  /** Listening for a while with no progress: the UI may offer to go back two lines. */
  stuckHint: boolean;
  /** Smoothed mic level 0..1 (RMS) while listening. */
  inputLevel: number;
  /** The mic has been very quiet for a sustained stretch. */
  lowInput: boolean;
}
