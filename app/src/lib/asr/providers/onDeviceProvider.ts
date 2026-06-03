import { reciteLog } from "../../reciteLog";
import { getAsrConfig, type AsrConfig } from "../asrConfig";
import { buildBias } from "../biasing";
import { TranscriptAccumulator } from "../transcriptAccumulator";
import type {
  AsrProvider,
  AsrStartOptions,
  TranscriptDelta,
  TranscriptEvent,
} from "../types";

/**
 * On-device streaming ASR.
 *
 * Premium target is WhisperKit (Whisper Large v3 Turbo) on the Apple Neural
 * Engine; the cross-platform implementation here wraps `whisper.rn`
 * (whisper.cpp), which manages its own mic capture and sliding-window decode.
 * Biasing is applied via the Whisper `prompt` (initial prompt) seeded with the
 * upcoming matn words. sherpa-onnx is an alternative when stronger hotword
 * biasing is needed.
 *
 * The model is downloaded on first run into the app documents dir; until a
 * model URL is configured (or a model is bundled), the provider reports
 * unavailable and the factory falls back to Expo speech.
 */

const MODEL_DIR = "asr-models";
const MODEL_FILE = "whisper-asr.bin";

// --- Lazy native module shims (kept local so typecheck needs no native deps) ---

interface RealtimeEvent {
  isCapturing: boolean;
  code?: number;
  error?: string;
  data?: { result?: string; segments?: Array<{ text: string }> };
}
interface RealtimeHandle {
  stop: () => Promise<void>;
  subscribe: (cb: (e: RealtimeEvent) => void) => void;
}
interface RealtimeOptions {
  language?: string;
  prompt?: string;
  realtimeAudioSec?: number;
  realtimeAudioSliceSec?: number;
}
interface WhisperContext {
  transcribeRealtime(opts: RealtimeOptions): Promise<RealtimeHandle>;
  release(): Promise<void>;
}
interface WhisperModule {
  initWhisper(opts: { filePath: string }): Promise<WhisperContext>;
}

interface FsModule {
  documentDirectory: string | null;
  getInfoAsync(uri: string): Promise<{ exists: boolean; size?: number }>;
  makeDirectoryAsync(uri: string, opts?: { intermediates?: boolean }): Promise<void>;
  downloadAsync(uri: string, fileUri: string): Promise<{ uri: string; status: number }>;
}

function loadWhisper(): WhisperModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("whisper.rn") as Partial<WhisperModule>;
    return typeof mod?.initWhisper === "function" ? (mod as WhisperModule) : null;
  } catch {
    return null;
  }
}

function loadFileSystem(): FsModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("expo-file-system") as Partial<FsModule>;
    return mod && "documentDirectory" in mod ? (mod as FsModule) : null;
  } catch {
    return null;
  }
}

export class OnDeviceAsrProvider implements AsrProvider {
  readonly name = "device:whisper";
  private readonly acc = new TranscriptAccumulator();
  private readonly config: AsrConfig;
  private readonly whisper: WhisperModule | null;
  private readonly fs: FsModule | null;
  private ctx: WhisperContext | null = null;
  private realtime: RealtimeHandle | null = null;
  private transcriptListeners = new Set<(e: TranscriptEvent) => void>();
  private errorListeners = new Set<(e: Error) => void>();
  private lastStartOptions?: AsrStartOptions;
  private modelPath: string | null = null;
  private running = false;

  constructor(deps?: { config?: AsrConfig }) {
    this.config = deps?.config ?? getAsrConfig();
    this.whisper = loadWhisper();
    this.fs = loadFileSystem();
  }

  /** Available when the native module loaded and a model can be resolved. */
  get isAvailable(): boolean {
    return Boolean(this.whisper && this.fs && this.config.onDeviceModelUrl);
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

  /** Ensure the model file exists locally, downloading on first run. */
  private async ensureModel(): Promise<string> {
    if (this.modelPath) return this.modelPath;
    if (!this.fs) throw new Error("File system module unavailable");
    const url = this.config.onDeviceModelUrl;
    if (!url) throw new Error("On-device ASR model URL not configured");

    const base = this.fs.documentDirectory;
    if (!base) throw new Error("No document directory for model storage");
    const dir = `${base}${MODEL_DIR}`;
    const path = `${dir}/${MODEL_FILE}`;

    const info = await this.fs.getInfoAsync(path);
    if (info.exists && (info.size ?? 0) > 0) {
      this.modelPath = path;
      return path;
    }

    reciteLog.asr("modelDownloadStart", { provider: this.name, url });
    await this.fs.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    const res = await this.fs.downloadAsync(url, path);
    if (res.status >= 400) {
      throw new Error(`Model download failed (${res.status})`);
    }
    reciteLog.asr("modelDownloadDone", { provider: this.name, path: res.uri });
    this.modelPath = path;
    return path;
  }

  async start(options?: AsrStartOptions): Promise<void> {
    if (this.running) return;
    if (!this.whisper) {
      throw new Error("On-device speech recognition not available on this device.");
    }
    this.lastStartOptions = options;
    this.acc.reset();

    const filePath = await this.ensureModel();
    const bias = buildBias(options?.contextualStrings ?? []);

    if (!this.ctx) {
      this.ctx = await this.whisper.initWhisper({ filePath });
    }

    reciteLog.asr("start", {
      provider: this.name,
      contextualCount: options?.contextualStrings?.length ?? 0,
      biasCount: bias.terms.length,
    });

    this.realtime = await this.ctx.transcribeRealtime({
      language: "ar",
      prompt: bias.prompt || undefined,
      realtimeAudioSec: 60,
      realtimeAudioSliceSec: 12,
    });
    this.running = true;

    this.realtime.subscribe((e) => {
      if (e.error) {
        const err = new Error(e.error);
        reciteLog.error("asr.device", { message: e.error, provider: this.name });
        for (const l of this.errorListeners) l(err);
        return;
      }
      const result = e.data?.result ?? "";
      if (!result.trim()) return;
      this.ingestResult(result, !e.isCapturing);
    });
  }

  private ingestResult(result: string, isFinal: boolean): void {
    this.acc.setLiveSegment(result.trim());
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
    await this.stopRealtime();
    this.acc.reset();
    await this.start(opts);
  }

  private async stopRealtime(): Promise<void> {
    this.running = false;
    try {
      await this.realtime?.stop();
    } catch {
      /* already stopped */
    }
    this.realtime = null;
  }

  async stop(): Promise<void> {
    await this.stopRealtime();
    try {
      await this.ctx?.release();
    } catch {
      /* ignore */
    }
    this.ctx = null;
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
