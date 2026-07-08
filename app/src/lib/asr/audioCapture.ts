/**
 * Shared microphone PCM capture for streaming ASR providers.
 *
 * Wraps `@siteed/audio-studio`'s native module + `AudioData` event stream and
 * emits 16 kHz mono 16-bit linear PCM frames. The module is loaded lazily and
 * guarded so the app degrades gracefully (and falls back to Expo speech) when
 * the native module isn't built into the binary — e.g. on web or before a
 * native rebuild.
 *
 * We talk to the imperative `AudioStudioModule` directly (rather than the
 * `useAudioRecorder` hook, which can't run outside React) and subscribe to the
 * `AudioData` event, decoding both the `pcmFloat32` (float stream) and base64
 * `encoded` (pcm_16bit) payload shapes the native layer can deliver.
 */

export const ASR_SAMPLE_RATE = 16000;

export interface PcmFrame {
  /** 16-bit signed little-endian mono samples. */
  pcm16: Int16Array;
  /** Position in the recording (bytes or seconds, per native). */
  position: number;
}

export interface PcmAudioSource {
  readonly sampleRate: number;
  start(onFrame: (frame: PcmFrame) => void, onError?: (e: Error) => void): Promise<void>;
  stop(): Promise<void>;
  readonly isAvailable: boolean;
}

/** RMS of a 16-bit PCM frame, normalized to 0..1 (1 = full-scale sine). */
export function rmsOfPcm16(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    const s = pcm[i] / 0x8000;
    sum += s * s;
  }
  return Math.sqrt(sum / pcm.length);
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

const B64_LOOKUP = (() => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const table = new Int16Array(256).fill(-1);
  for (let i = 0; i < chars.length; i++) table[chars.charCodeAt(i)] = i;
  return table;
})();

/** Decode a base64 string of little-endian 16-bit PCM into an Int16Array. */
export function base64Pcm16ToInt16(b64: string): Int16Array {
  let len = b64.length;
  while (len > 0 && b64[len - 1] === "=") len--;
  const byteLen = (len * 3) >> 2;
  const bytes = new Uint8Array(byteLen);
  let p = 0;
  let acc = 0;
  let accBits = 0;
  for (let i = 0; i < len; i++) {
    const v = B64_LOOKUP[b64.charCodeAt(i)];
    if (v < 0) continue;
    acc = (acc << 6) | v;
    accBits += 6;
    if (accBits >= 8) {
      accBits -= 8;
      bytes[p++] = (acc >> accBits) & 0xff;
    }
  }
  // Reinterpret byte pairs as signed 16-bit LE.
  const sampleCount = p >> 1;
  const out = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const lo = bytes[i * 2];
    const hi = bytes[i * 2 + 1];
    let s = (hi << 8) | lo;
    if (s >= 0x8000) s -= 0x10000;
    out[i] = s;
  }
  return out;
}

// --- Native module + event types (declared locally; no install needed for tsc) ---

interface NativeAudioEvent {
  pcmFloat32?: Float32Array | number[] | null;
  encoded?: string | null;
  position?: number;
  deltaSize?: number;
}

interface EventSubscription {
  remove(): void;
}

interface AudioStudioNativeModule {
  startRecording(config: Record<string, unknown>): Promise<unknown>;
  stopRecording(): Promise<unknown>;
}

type AddAudioEventListener = (
  listener: (e: NativeAudioEvent) => void
) => EventSubscription;

interface LoadedAudioStudio {
  module: AudioStudioNativeModule;
  addAudioEventListener: AddAudioEventListener;
}

function isNativeModule(m: unknown): m is AudioStudioNativeModule {
  const mod = m as Partial<AudioStudioNativeModule> | null | undefined;
  return (
    typeof mod?.startRecording === "function" &&
    typeof mod?.stopRecording === "function"
  );
}

/** Resolve the event-listener helper, tolerating export-shape differences. */
function resolveAddListener(
  pkg: Record<string, unknown>,
  nativeModule: AudioStudioNativeModule
): AddAudioEventListener | null {
  const exported = pkg.addAudioEventListener;
  if (typeof exported === "function") return exported as AddAudioEventListener;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const events = require("@siteed/audio-studio/build/cjs/events") as {
      addAudioEventListener?: AddAudioEventListener;
    };
    if (typeof events?.addAudioEventListener === "function") {
      return events.addAudioEventListener;
    }
  } catch {
    /* fall through to emitter construction */
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const core = require("expo-modules-core") as {
      LegacyEventEmitter?: new (m: unknown) => {
        addListener: (name: string, cb: (e: NativeAudioEvent) => void) => EventSubscription;
      };
      EventEmitter?: new (m: unknown) => {
        addListener: (name: string, cb: (e: NativeAudioEvent) => void) => EventSubscription;
      };
    };
    const Emitter = core.LegacyEventEmitter ?? core.EventEmitter;
    if (Emitter) {
      const emitter = new Emitter(nativeModule);
      return (listener) => emitter.addListener("AudioData", listener);
    }
  } catch {
    /* no emitter available */
  }
  return null;
}

function loadAudioStudio(): LoadedAudioStudio | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require("@siteed/audio-studio") as Record<string, unknown>;
    const candidate = pkg.AudioStudioModule ?? (pkg.default as Record<string, unknown>)?.AudioStudioModule;
    if (!isNativeModule(candidate)) return null;
    const addAudioEventListener = resolveAddListener(pkg, candidate);
    if (!addAudioEventListener) return null;
    return { module: candidate, addAudioEventListener };
  } catch {
    return null;
  }
}

function frameFromEvent(event: NativeAudioEvent): PcmFrame | null {
  const position = event.position ?? 0;
  const float = event.pcmFloat32;
  if (float != null) {
    const f32 = float instanceof Float32Array ? float : new Float32Array(float);
    if (f32.length === 0) return null;
    return { pcm16: float32ToPcm16(f32), position };
  }
  if (typeof event.encoded === "string" && event.encoded.length > 0) {
    const pcm16 = base64Pcm16ToInt16(event.encoded);
    if (pcm16.length === 0) return null;
    return { pcm16, position };
  }
  return null;
}

export class ExpoAudioStudioPcmSource implements PcmAudioSource {
  readonly sampleRate = ASR_SAMPLE_RATE;
  private loaded: LoadedAudioStudio | null;
  private subscription: EventSubscription | null = null;
  private running = false;

  constructor() {
    this.loaded = loadAudioStudio();
  }

  get isAvailable(): boolean {
    return this.loaded != null;
  }

  async start(
    onFrame: (frame: PcmFrame) => void,
    onError?: (e: Error) => void
  ): Promise<void> {
    if (!this.loaded) {
      throw new Error("Audio capture module unavailable");
    }
    const { module, addAudioEventListener } = this.loaded;
    this.running = true;

    this.subscription = addAudioEventListener((event) => {
      if (!this.running) return;
      if ((event.deltaSize ?? 1) === 0) return;
      try {
        const frame = frameFromEvent(event);
        if (frame) onFrame(frame);
      } catch (e) {
        onError?.(e instanceof Error ? e : new Error(String(e)));
      }
    });

    try {
      await module.startRecording({
        sampleRate: ASR_SAMPLE_RATE,
        channels: 1,
        encoding: "pcm_16bit",
        interval: 100,
        enableProcessing: false,
        keepAwake: true,
        keepFullAnalysis: false,
        output: { primary: { enabled: false } },
      });
    } catch (e) {
      this.running = false;
      this.subscription?.remove();
      this.subscription = null;
      onError?.(e instanceof Error ? e : new Error(String(e)));
      throw e;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.subscription?.remove();
    this.subscription = null;
    try {
      await this.loaded?.module.stopRecording();
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
