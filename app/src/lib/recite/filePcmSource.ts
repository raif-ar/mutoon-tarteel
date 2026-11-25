/**
 * Dev-only audio source: replays a WAV file as if it were the microphone, in
 * real time. Lets the whole Recite flow be exercised in the iOS simulator and
 * in the listening check without anyone reciting.
 */
import { ASR_SAMPLE_RATE, type PcmAudioSource, type PcmFrame } from "./audioCapture";

const FRAME_MS = 100;

export class FilePcmSource implements PcmAudioSource {
  readonly sampleRate = ASR_SAMPLE_RATE;
  readonly isAvailable = true;
  private timer: ReturnType<typeof setInterval> | null = null;
  private offset = 0;

  /** `samples`: 16 kHz mono floats in [-1, 1]. `speed` > 1 replays faster than real time. */
  constructor(private readonly samples: Float32Array, private readonly speed = 1) {}

  async start(onFrame: (frame: PcmFrame) => void): Promise<void> {
    const step = Math.round((ASR_SAMPLE_RATE * FRAME_MS) / 1000);
    this.timer = setInterval(() => {
      if (this.offset >= this.samples.length) return;
      const end = Math.min(this.samples.length, this.offset + step);
      const pcm16 = new Int16Array(end - this.offset);
      for (let i = 0; i < pcm16.length; i++) {
        const s = Math.max(-1, Math.min(1, this.samples[this.offset + i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      onFrame({ pcm16, position: (this.offset / ASR_SAMPLE_RATE) * 1000 });
      this.offset = end;
    }, FRAME_MS / this.speed);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** True once the whole file has been delivered. */
  get finished(): boolean {
    return this.offset >= this.samples.length;
  }
}
