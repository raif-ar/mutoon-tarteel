import { reciteLog } from "../../reciteLog";
import { getAsrConfig, type AsrConfig } from "../asrConfig";
import {
  createPcmAudioSource,
  type PcmAudioSource,
} from "../audioCapture";
import { buildBias } from "../biasing";
import { TranscriptAccumulator } from "../transcriptAccumulator";
import type {
  AsrProvider,
  AsrStartOptions,
  HeardWord,
  TranscriptDelta,
  TranscriptEvent,
} from "../types";
import { DeepgramVendor } from "./vendors/deepgramVendor";
import { OpenAiRealtimeVendor } from "./vendors/openaiRealtimeVendor";
import type { CloudAsrVendor, VendorWord } from "./vendors/types";

export type VendorFactory = (config: AsrConfig) => CloudAsrVendor;

function defaultVendorFactory(config: AsrConfig): CloudAsrVendor {
  if (config.cloudVendor === "openai") {
    return new OpenAiRealtimeVendor({
      apiKey: config.openai.apiKey,
      tokenUrl: config.openai.tokenUrl,
    });
  }
  return new DeepgramVendor({
    apiKey: config.deepgram.apiKey,
    tokenUrl: config.deepgram.tokenUrl,
  });
}

/**
 * Streaming cloud ASR provider.
 *
 * Captures 16 kHz PCM via the shared audio source, streams it to a hosted
 * recognizer (Deepgram Nova-3 by default; OpenAI gpt-realtime-whisper as alt),
 * and maps interim/final transcripts onto the same `TranscriptAccumulator`
 * contract the engine expects. Biasing comes from the upcoming matn words the
 * engine already passes via `contextualStrings`.
 */
export class CloudStreamingAsrProvider implements AsrProvider {
  readonly name: string;
  private readonly acc = new TranscriptAccumulator();
  private readonly config: AsrConfig;
  private readonly source: PcmAudioSource;
  private readonly vendorFactory: VendorFactory;
  private vendor: CloudAsrVendor | null = null;
  private transcriptListeners = new Set<(e: TranscriptEvent) => void>();
  private errorListeners = new Set<(e: Error) => void>();
  private unsubVendorTranscript?: () => void;
  private unsubVendorError?: () => void;
  private lastStartOptions?: AsrStartOptions;
  private running = false;
  /** Wall-clock anchor for the session, used to rebase vendor word timings. */
  private sessionStartMs = 0;
  /** Wall-clock anchor for the currently active socket (resets on rebias). */
  private socketStartMs = 0;
  private heardTimeline: HeardWord[] = [];
  /** Latest interim segment's words, not yet finalized (flushed on read). */
  private pendingWords: HeardWord[] = [];

  constructor(deps?: {
    config?: AsrConfig;
    source?: PcmAudioSource;
    vendorFactory?: VendorFactory;
  }) {
    this.config = deps?.config ?? getAsrConfig();
    this.source = deps?.source ?? createPcmAudioSource();
    this.vendorFactory = deps?.vendorFactory ?? defaultVendorFactory;
    this.name = `cloud:${this.config.cloudVendor}`;
  }

  get isAvailable(): boolean {
    return this.source.isAvailable;
  }

  getAlignmentTranscript(isFinal: boolean): string {
    return this.acc.getAlignmentTranscript(isFinal);
  }

  getTranscriptDelta(isFinal: boolean): TranscriptDelta {
    return this.acc.getTranscriptDelta(isFinal);
  }

  resetRecognitionBuffer(): void {
    this.acc.reset();
    reciteLog.asr("bufferReset", { provider: this.name });
  }

  async start(options?: AsrStartOptions): Promise<void> {
    if (this.running) return;
    if (!this.source.isAvailable) {
      throw new Error("Audio capture unavailable for cloud ASR");
    }
    this.lastStartOptions = options;
    this.acc.reset();
    this.heardTimeline = [];
    this.pendingWords = [];
    this.sessionStartMs = Date.now();
    this.socketStartMs = this.sessionStartMs;

    const bias = buildBias(options?.contextualStrings ?? []);
    const vendor = this.vendorFactory(this.config);
    this.vendor = vendor;
    const wired = this.wireVendor(vendor);
    this.unsubVendorTranscript = wired.unsubTranscript;
    this.unsubVendorError = wired.unsubError;

    reciteLog.asr("start", {
      provider: this.name,
      contextualCount: options?.contextualStrings?.length ?? 0,
      biasCount: bias.terms.length,
    });

    await vendor.open(this.vendorOpenParams(bias.terms));

    await this.source.start(
      (frame) => this.vendor?.sendPcm(frame.pcm16),
      (e) => {
        for (const l of this.errorListeners) l(e);
      }
    );
    this.running = true;
  }

  private ingestVendorTranscript(
    transcript: string,
    isFinal: boolean,
    words?: VendorWord[]
  ): void {
    const trimmed = transcript.trim();
    if (!trimmed) return;
    if (words?.length) {
      if (isFinal) {
        this.appendTimeline(words);
        this.pendingWords = [];
      } else {
        // Replace the in-progress segment; committed on its final, or flushed
        // by getHeardTimeline() if recording stops before the final arrives.
        this.pendingWords = this.rebaseWords(words);
      }
    }
    this.acc.setLiveSegment(trimmed);
    if (isFinal) {
      this.acc.commitLiveSegment();
    }
    const text = this.acc.buildFullTranscript();
    if (!text) return;
    for (const l of this.transcriptListeners) {
      l({ text, isFinal });
    }
  }

  /** Rebase a segment's vendor-relative timings onto the continuous session clock. */
  private rebaseWords(words: VendorWord[]): HeardWord[] {
    const offsetSec = (this.socketStartMs - this.sessionStartMs) / 1000;
    return words.map((w) => ({
      word: w.word,
      start: w.start + offsetSec,
      end: w.end + offsetSec,
      confidence: w.confidence,
    }));
  }

  private appendTimeline(words: VendorWord[]): void {
    for (const w of this.rebaseWords(words)) this.heardTimeline.push(w);
  }

  getHeardTimeline(): HeardWord[] {
    // Include the trailing un-finalized segment so a mid-phrase stop is complete.
    return this.pendingWords.length
      ? this.heardTimeline.concat(this.pendingWords)
      : this.heardTimeline;
  }

  async restartRecognition(options?: AsrStartOptions): Promise<void> {
    const opts = options ?? this.lastStartOptions;
    await this.teardown();
    await this.start(opts);
  }

  /**
   * Refresh contextual bias mid-recitation without dropping audio.
   *
   * Opens a fresh vendor socket with the new keyterms, then atomically swaps
   * it in. The mic source keeps running the whole time and routes frames to
   * `this.vendor`, so the old socket covers the brief window while the new one
   * connects — no reconnect gap and no lost words at the boundary.
   */
  async rebias(options?: AsrStartOptions): Promise<void> {
    if (!this.running || !this.vendor) return;
    this.lastStartOptions = options;
    const bias = buildBias(options?.contextualStrings ?? []);

    const previous = this.vendor;
    const prevUnsubTranscript = this.unsubVendorTranscript;
    const prevUnsubError = this.unsubVendorError;

    const next = this.vendorFactory(this.config);
    const wired = this.wireVendor(next);

    reciteLog.asr("rebias", {
      provider: this.name,
      contextualCount: options?.contextualStrings?.length ?? 0,
      biasCount: bias.terms.length,
    });

    try {
      await next.open(this.vendorOpenParams(bias.terms));
    } catch (e) {
      wired.unsubTranscript();
      wired.unsubError();
      try {
        await next.close();
      } catch {
        /* ignore */
      }
      throw e instanceof Error ? e : new Error(String(e));
    }

    // Swap atomically: subsequent mic frames now flow to the new socket, whose
    // word timings restart at 0 — anchor the new epoch so the timeline stays
    // continuous on the session clock.
    this.vendor = next;
    // Preserve the old socket's trailing interim (already on the session clock)
    // before its closing final is lost, then anchor the new socket's epoch.
    if (this.pendingWords.length) {
      for (const w of this.pendingWords) this.heardTimeline.push(w);
      this.pendingWords = [];
    }
    this.socketStartMs = Date.now();
    this.unsubVendorTranscript = wired.unsubTranscript;
    this.unsubVendorError = wired.unsubError;

    prevUnsubTranscript?.();
    prevUnsubError?.();
    try {
      await previous.close();
    } catch {
      /* ignore */
    }
  }

  private vendorOpenParams(biasTerms: string[]) {
    return {
      sampleRate: this.source.sampleRate,
      language: this.config.deepgram.language,
      model:
        this.config.cloudVendor === "openai"
          ? this.config.openai.model
          : this.config.deepgram.model,
      biasTerms,
    };
  }

  private wireVendor(vendor: CloudAsrVendor): {
    unsubTranscript: () => void;
    unsubError: () => void;
  } {
    const unsubTranscript = vendor.onTranscript((t) =>
      this.ingestVendorTranscript(t.transcript, t.isFinal, t.words)
    );
    const unsubError = vendor.onError((e) => {
      reciteLog.error("asr.cloud", { message: e.message, provider: this.name });
      for (const l of this.errorListeners) l(e);
    });
    return { unsubTranscript, unsubError };
  }

  private async teardown(): Promise<void> {
    this.running = false;
    try {
      await this.source.stop();
    } catch {
      /* ignore */
    }
    this.unsubVendorTranscript?.();
    this.unsubVendorError?.();
    this.unsubVendorTranscript = undefined;
    this.unsubVendorError = undefined;
    if (this.vendor) {
      try {
        await this.vendor.close();
      } catch {
        /* ignore */
      }
      this.vendor = null;
    }
  }

  async stop(): Promise<void> {
    await this.teardown();
    this.acc.reset();
  }

  onTranscript(listener: (event: TranscriptEvent) => void): () => void {
    this.transcriptListeners.add(listener);
    return () => this.transcriptListeners.delete(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }
}
