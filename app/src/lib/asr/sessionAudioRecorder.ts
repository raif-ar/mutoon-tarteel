/**
 * Opt-in per-session microphone WAV capture for the fine-tuning corpus.
 *
 * The recite logs already persist transcripts, timings, and reciter-labeled
 * mistakes — but not the audio, which is what model fine-tuning (and the
 * "needs audio" reconcile cases) ultimately require. When enabled, the raw
 * 16 kHz mono PCM stream that feeds the recognizer is also buffered here and
 * written as a standard WAV into the same `recite-logs/` directory the text
 * logs use (UIFileSharingEnabled exposes it in the Files app; the fixture
 * pull tooling can fetch it with devicectl).
 *
 * Enable with `EXPO_PUBLIC_RECITE_SAVE_AUDIO=1` at build time (Babel inlines
 * the literal `process.env.EXPO_PUBLIC_*` member access; see asrConfig.ts).
 * Memory cost is ~1.9 MB/min of Int16 buffer — fine for recitation sessions.
 * A mid-session recognition restart finishes the current file and begins a
 * new segment; segments correlate with the log by timestamp.
 */

const LOG_DIR = "recite-logs";
const SAMPLE_RATE = 16000;

const ENABLED = process.env.EXPO_PUBLIC_RECITE_SAVE_AUDIO === "1";

interface FsModule {
  documentDirectory: string | null;
  makeDirectoryAsync: (
    uri: string,
    options?: { intermediates?: boolean }
  ) => Promise<void>;
  writeAsStringAsync: (
    uri: string,
    contents: string,
    options?: { encoding?: string }
  ) => Promise<void>;
}

function loadFs(): FsModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("expo-file-system/legacy") as Partial<FsModule>;
    return mod?.documentDirectory != null &&
      typeof mod.makeDirectoryAsync === "function" &&
      typeof mod.writeAsStringAsync === "function"
      ? (mod as FsModule)
      : null;
  } catch {
    return null;
  }
}

const B64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    parts.push(
      B64_CHARS[(n >> 18) & 63] +
        B64_CHARS[(n >> 12) & 63] +
        B64_CHARS[(n >> 6) & 63] +
        B64_CHARS[n & 63]
    );
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    parts.push(B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + "==");
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    parts.push(
      B64_CHARS[(n >> 18) & 63] +
        B64_CHARS[(n >> 12) & 63] +
        B64_CHARS[(n >> 6) & 63] +
        "="
    );
  }
  return parts.join("");
}

function wavBytes(frames: Int16Array[], totalSamples: number): Uint8Array {
  const dataLen = totalSamples * 2;
  const out = new Uint8Array(44 + dataLen);
  const view = new DataView(out.buffer);
  const writeAscii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[offset + i] = s.charCodeAt(i);
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, dataLen, true);
  let offset = 44;
  for (const frame of frames) {
    for (let i = 0; i < frame.length; i++) {
      view.setInt16(offset, frame[i], true);
      offset += 2;
    }
  }
  return out;
}

class SessionAudioRecorder {
  private frames: Int16Array[] = [];
  private totalSamples = 0;
  private active = false;
  private startedAtIso: string | null = null;

  get isEnabled(): boolean {
    return ENABLED;
  }

  begin(): void {
    if (!ENABLED) return;
    this.frames = [];
    this.totalSamples = 0;
    this.active = true;
    this.startedAtIso = new Date().toISOString().replace(/[:.]/g, "-");
  }

  addFrame(pcm16: Int16Array): void {
    if (!this.active) return;
    // Copy: the native layer may reuse the underlying buffer between events.
    this.frames.push(pcm16.slice());
    this.totalSamples += pcm16.length;
  }

  /** Write the buffered session audio as WAV; resolves to the file URI or null. */
  async finish(): Promise<string | null> {
    if (!this.active) return null;
    this.active = false;
    const frames = this.frames;
    const totalSamples = this.totalSamples;
    const startedAt = this.startedAtIso;
    this.frames = [];
    this.totalSamples = 0;
    this.startedAtIso = null;
    if (totalSamples === 0) return null;

    const fs = loadFs();
    if (!fs?.documentDirectory) return null;
    const dir = `${fs.documentDirectory}${LOG_DIR}`;
    try {
      await fs.makeDirectoryAsync(dir, { intermediates: true });
    } catch {
      /* exists */
    }
    const uri = `${dir}/${startedAt}_session_audio.wav`;
    try {
      const b64 = bytesToBase64(wavBytes(frames, totalSamples));
      await fs.writeAsStringAsync(uri, b64, { encoding: "base64" });
      return uri;
    } catch {
      return null;
    }
  }
}

export const sessionAudioRecorder = new SessionAudioRecorder();
