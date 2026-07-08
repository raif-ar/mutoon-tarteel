/**
 * Cloud streaming ASR vendor adapter.
 *
 * A vendor owns the websocket protocol with a hosted recognizer. The
 * `CloudStreamingAsrProvider` feeds it 16-bit PCM frames and consumes
 * interim/final transcript events; alignment + biasing stay provider-side.
 */

/** A single recognized word with its acoustic timing/confidence (vendor-relative seconds). */
export interface VendorWord {
  word: string;
  /** Seconds from the current socket's stream start. */
  start: number;
  end: number;
  /** Recognizer confidence, 0..1. */
  confidence: number;
}

export interface VendorTranscript {
  /** Cumulative transcript for the current utterance/segment. */
  transcript: string;
  /** True when the recognizer finalized this segment. */
  isFinal: boolean;
  /**
   * Word-level timings for this segment when the vendor exposes them (Deepgram
   * does on finals). Times are relative to the socket that produced them; the
   * provider rebases them onto a continuous session clock.
   */
  words?: VendorWord[];
}

export interface VendorOpenOptions {
  sampleRate: number;
  language: string;
  model: string;
  /** Bias terms (upcoming matn words) for keyterm/prompt biasing. */
  biasTerms: string[];
}

export interface CloudAsrVendor {
  readonly name: string;
  open(options: VendorOpenOptions): Promise<void>;
  /** Send a chunk of 16-bit PCM audio. */
  sendPcm(pcm16: Int16Array): void;
  /** Update bias terms mid-stream when supported (else no-op). */
  updateBias?(biasTerms: string[]): void;
  close(): Promise<void>;
  onTranscript(listener: (t: VendorTranscript) => void): () => void;
  onError(listener: (e: Error) => void): () => void;
}
