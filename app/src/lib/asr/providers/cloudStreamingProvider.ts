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
  TranscriptDelta,
  TranscriptEvent,
} from "../types";
import { DeepgramVendor } from "./vendors/deepgramVendor";
import { OpenAiRealtimeVendor } from "./vendors/openaiRealtimeVendor";
import type { CloudAsrVendor } from "./vendors/types";

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

    const bias = buildBias(options?.contextualStrings ?? []);
    const vendor = this.vendorFactory(this.config);
    this.vendor = vendor;

    this.unsubVendorTranscript = vendor.onTranscript((t) =>
      this.ingestVendorTranscript(t.transcript, t.isFinal)
    );
    this.unsubVendorError = vendor.onError((e) => {
      reciteLog.error("asr.cloud", { message: e.message, provider: this.name });
      for (const l of this.errorListeners) l(e);
    });

    reciteLog.asr("start", {
      provider: this.name,
      contextualCount: options?.contextualStrings?.length ?? 0,
      biasCount: bias.terms.length,
    });

    await vendor.open({
      sampleRate: this.source.sampleRate,
      language: this.config.deepgram.language,
      model:
        this.config.cloudVendor === "openai"
          ? this.config.openai.model
          : this.config.deepgram.model,
      biasTerms: bias.terms,
    });

    await this.source.start(
      (frame) => vendor.sendPcm(frame.pcm16),
      (e) => {
        for (const l of this.errorListeners) l(e);
      }
    );
    this.running = true;
  }

  private ingestVendorTranscript(transcript: string, isFinal: boolean): void {
    const trimmed = transcript.trim();
    if (!trimmed) return;
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

  async restartRecognition(options?: AsrStartOptions): Promise<void> {
    const opts = options ?? this.lastStartOptions;
    await this.teardown();
    await this.start(opts);
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
