/**
 * Streaming phoneme listener: filterbank, then the streaming Zipformer one
 * window at a time, then a greedy CTC decode into phoneme tokens.
 *
 * Ported from @tilawa/core 1.0.0-rc.1 (dist/runtime/listener.js), MIT License,
 * Copyright (c) 2026 yazinsai. Trimmed to what Recite needs (16 kHz input, no
 * posteriors) and typed; the decode itself is unchanged. The model weights
 * ("spliced-clean", CC BY 4.0) are fetched by scripts/fetch-listener-model.mjs.
 */
import { Fbank } from "./fbank";

export interface StateSpec {
  name: string;
  shape: number[];
  dtype: "float32" | "int64";
}

export interface ListenerManifest {
  /** Token `i + 1` is `tokens[i]`; 0 is the CTC blank. */
  tokens: string;
  sampleRate: number;
  /** Duration of one output frame. */
  frameMs: number;
  mels: number;
  padValue: number;
  /** Filterbank frames per model call, and frames to advance by. */
  window: number;
  shift: number;
  states: StateSpec[];
}

export interface Tensor {
  type: "float32" | "int64";
  data: Float32Array | BigInt64Array;
  dims: readonly number[];
}

/** One ONNX session, whatever the runtime (onnxruntime-react-native in the app, onnxruntime-node in the gate). */
export interface InferenceBackend {
  run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
  release(): Promise<void>;
  /**
   * True when the backend keeps the model's recurrent state itself (the native
   * module does, to avoid moving ~1.8 MB across the bridge per step). The
   * listener then feeds only `x` and reads only `log_probs`.
   */
  readonly holdsState?: boolean;
  /** Zero the backend-held state. Required when `holdsState`. */
  reset?(): Promise<void>;
}

/** One decoded phoneme. `start`/`end` are output frames (inclusive) of its CTC spike run. */
export interface DecodedPhoneme {
  p: string;
  start: number;
  end: number;
  conf: number;
}

export interface Listener {
  /** 16 kHz float samples in [-1, 1]. Returns the phonemes that became final. */
  push(samples: Float32Array): Promise<DecodedPhoneme[]>;
  /** Pads and drains the stream: the rest of the phonemes. */
  end(): Promise<DecodedPhoneme[]>;
  /** Output frames decoded so far (the listener clock; one frame is `frameMs`). */
  readonly frames: number;
}

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;

function freshStates(m: ListenerManifest): Record<string, Tensor> {
  const out: Record<string, Tensor> = {};
  for (const s of m.states) {
    const n = s.shape.reduce((a, b) => a * b, 1);
    out[s.name] = {
      type: s.dtype,
      data: s.dtype === "int64" ? new BigInt64Array(n) : new Float32Array(n),
      dims: s.shape,
    };
  }
  return out;
}

export function createListener(m: ListenerManifest, backend: InferenceBackend): Listener {
  const fbank = new Fbank();
  const vocab = m.tokens.length + 1;
  let states = backend.holdsState ? {} : freshStates(m);
  let feats: Float32Array[] = [];
  let consumed = 0;
  let fbankFrames = 0;
  let outFrames = 0;
  let prev = 0;
  let open: DecodedPhoneme | null = null;
  /** The run at the end of the previous window was emitted; its continuation is the same phoneme. */
  let carried = false;
  let done: DecodedPhoneme[] = [];

  async function step(window: Float32Array[], keep: number): Promise<void> {
    const x = new Float32Array(m.window * m.mels);
    window.forEach((f, i) => x.set(f, i * m.mels));
    const out = await backend.run({ x: { type: "float32", data: x, dims: [1, m.window, m.mels] }, ...states });
    if (!backend.holdsState) {
      const next: Record<string, Tensor> = {};
      for (const s of m.states) next[s.name] = out[`new_${s.name}`];
      states = next;
    }
    const lp = out.log_probs.data as Float32Array;
    const n = Math.min(keep, lp.length / vocab);
    for (let t = 0; t < n; t++) {
      // Greedy: the best token of the frame.
      let id = 0;
      let best = -Infinity;
      const base = t * vocab;
      for (let v = 0; v < vocab; v++) {
        const lpv = lp[base + v];
        if (lpv > best) { best = lpv; id = v; }
      }
      const p = round4(Math.exp(best));
      const frame = outFrames + t;
      if (id !== 0 && id === prev && open) {
        open.end = frame;
        open.conf = Math.max(open.conf, p);
      } else if (!(id !== 0 && id === prev && carried)) {
        if (open) done.push(open);
        open = id !== 0 ? { p: m.tokens[id - 1], start: frame, end: frame, conf: p } : null;
        carried = false;
      }
      if (id !== prev) carried = false;
      prev = id;
    }
    outFrames += n;
    // A run still open at the window's end goes out with it: continuing it in the next window can't change the token.
    if (open) {
      done.push(open);
      open = null;
      carried = true;
    }
  }

  function flush(): DecodedPhoneme[] {
    const out = done;
    done = [];
    return out;
  }

  const outputsFor = (frames: number): number => Math.floor((Math.floor((frames - 7) / 2) + 1) / 2);

  async function drain(): Promise<void> {
    while (feats.length - consumed >= m.window) {
      await step(feats.slice(consumed, consumed + m.window), Infinity);
      consumed += m.shift;
    }
    if (consumed > 4 * m.window) {
      feats = feats.slice(consumed);
      consumed = 0;
    }
  }

  return {
    get frames() {
      return outFrames;
    },
    async push(samples) {
      const f = fbank.push(samples);
      fbankFrames += f.length;
      for (const frame of f) feats.push(frame);
      await drain();
      return flush();
    },
    async end() {
      const total = outputsFor(fbankFrames);
      const pad = new Float32Array(m.mels).fill(m.padValue);
      while (outFrames < total) {
        while (feats.length - consumed < m.window) feats.push(pad);
        await step(feats.slice(consumed, consumed + m.window), total - outFrames);
        consumed += m.shift;
      }
      if (open) {
        done.push(open);
        open = null;
      }
      return flush();
    },
  };
}
