/**
 * Shared microphone PCM capture for streaming ASR providers.
 *
 * Wraps `@siteed/audio-studio` real-time streaming and emits 16 kHz mono
 * 16-bit linear PCM frames. The module is loaded lazily and guarded so the app
 * degrades gracefully (and falls back to Expo speech) when the native module
 * isn't built into the binary — e.g. on web or before a prebuild.
 */

export const ASR_SAMPLE_RATE = 16000;

export interface PcmFrame {
  /** 16-bit signed little-endian mono samples. */
  pcm16: Int16Array;
  /** Position in the recording, seconds. */
  position: number;
}

export interface PcmAudioSource {
  readonly sampleRate: number;
  start(onFrame: (frame: PcmFrame) => void, onError?: (e: Error) => void): Promise<void>;
  stop(): Promise<void>;
  readonly isAvailable: boolean;
}

/** Clamp + scale Float32 [-1,1] samples to 16-bit signed PCM. */
export function float32ToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    let s = input[i];
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

// Minimal shape of the bits we use from @siteed/audio-studio. Declared locally
// so typecheck doesn't require the native package to be installed/built.
interface AudioDataEvent {
  data: Float32Array | string;
  position?: number;
}
interface RecordingConfig {
  sampleRate: number;
  channels: number;
  encoding: string;
  streamFormat: string;
  interval?: number;
  onAudioStream: (event: AudioDataEvent) => void | Promise<void>;
}
interface ImperativeRecorder {
  startRecording(config: RecordingConfig): Promise<unknown>;
  stopRecording(): Promise<unknown>;
}

type AudioStudioModule = {
  startRecording?: (config: RecordingConfig) => Promise<unknown>;
  stopRecording?: () => Promise<unknown>;
  getAudioRecorder?: () => ImperativeRecorder;
  AudioRecorder?: ImperativeRecorder;
  default?: Partial<AudioStudioModule>;
};

function loadAudioStudio(): AudioStudioModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("@siteed/audio-studio") as AudioStudioModule;
    return mod ?? null;
  } catch {
    return null;
  }
}

function hasRecorderApi(r: unknown): r is ImperativeRecorder {
  const rec = r as Partial<ImperativeRecorder> | null | undefined;
  return (
    typeof rec?.startRecording === "function" &&
    typeof rec?.stopRecording === "function"
  );
}

/** Resolve an imperative recorder ({ startRecording, stopRecording }) from the module. */
function resolveRecorder(mod: AudioStudioModule): ImperativeRecorder | null {
  if (typeof mod.startRecording === "function" && typeof mod.stopRecording === "function") {
    return { startRecording: mod.startRecording, stopRecording: mod.stopRecording };
  }
  if (typeof mod.getAudioRecorder === "function") {
    const r = mod.getAudioRecorder();
    if (hasRecorderApi(r)) return r;
  }
  if (hasRecorderApi(mod.AudioRecorder)) {
    return mod.AudioRecorder;
  }
  if (hasRecorderApi(mod.default)) {
    return mod.default;
  }
  return null;
}

export class ExpoAudioStudioPcmSource implements PcmAudioSource {
  readonly sampleRate = ASR_SAMPLE_RATE;
  private recorder: ImperativeRecorder | null = null;
  private running = false;

  constructor() {
    const mod = loadAudioStudio();
    this.recorder = mod ? resolveRecorder(mod) : null;
  }

  get isAvailable(): boolean {
    return this.recorder != null;
  }

  async start(
    onFrame: (frame: PcmFrame) => void,
    onError?: (e: Error) => void
  ): Promise<void> {
    if (!this.recorder) {
      throw new Error("Audio capture module unavailable");
    }
    this.running = true;
    try {
      await this.recorder.startRecording({
        sampleRate: ASR_SAMPLE_RATE,
        channels: 1,
        encoding: "pcm_32bit",
        streamFormat: "float32",
        interval: 100,
        onAudioStream: (event) => {
          if (!this.running) return;
          const data = event.data;
          if (data instanceof Float32Array) {
            onFrame({ pcm16: float32ToPcm16(data), position: event.position ?? 0 });
          }
        },
      });
    } catch (e) {
      this.running = false;
      onError?.(e instanceof Error ? e : new Error(String(e)));
      throw e;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    try {
      await this.recorder?.stopRecording();
    } catch {
      /* already stopped */
    }
  }
}

export function createPcmAudioSource(): PcmAudioSource {
  return new ExpoAudioStudioPcmSource();
}

export function isAudioCaptureAvailable(): boolean {
  return new ExpoAudioStudioPcmSource().isAvailable;
}
