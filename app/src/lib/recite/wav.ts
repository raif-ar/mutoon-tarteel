/** Minimal RIFF/WAVE reader for PCM16 files (dev audio replay and the listening check). */

export interface WavAudio {
  sampleRate: number;
  /** Mono samples in [-1, 1]. */
  samples: Float32Array;
}

/** Walks the chunk list, so files with LIST/FLLR chunks before `data` decode correctly. */
export function decodeWav(bytes: Uint8Array): WavAudio {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number): string => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("Not a WAV file");
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  let format = 0;
  let off = 12;
  while (off + 8 <= bytes.length) {
    const id = tag(off);
    const size = view.getUint32(off + 4, true);
    const body = off + 8;
    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === "data") {
      if ((format !== 1 && format !== 0xfffe) || bits !== 16 || channels < 1) {
        throw new Error("Only 16-bit PCM WAV is supported");
      }
      const frames = Math.floor(Math.min(size, bytes.length - body) / (2 * channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) sum += view.getInt16(body + (i * channels + c) * 2, true);
        samples[i] = sum / channels / 32768;
      }
      return { sampleRate, samples };
    }
    off = body + size + (size & 1);
  }
  throw new Error("WAV file has no audio data");
}
