import { reciteLog } from "../../../reciteLog";
import type { CloudAsrVendor, VendorOpenOptions, VendorTranscript } from "./types";

/**
 * Deepgram Nova-3 streaming adapter (the 2026 production pick for Arabic STT).
 *
 * Connects to the live websocket with `encoding=linear16`, `interim_results`,
 * and `keyterm` biasing seeded from the upcoming matn words. Auth uses the
 * `["token", <key>]` websocket subprotocol so no key lands in the URL. A
 * short-lived token endpoint (`tokenUrl`) is preferred over an embedded key.
 */

const DG_BASE = "wss://api.deepgram.com/v1/listen";
/** Deepgram caps keyterms at 500 tokens; keep a safe count. */
const MAX_KEYTERMS = 60;

interface DeepgramResult {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives?: Array<{ transcript?: string }> };
}

export interface DeepgramVendorOptions {
  apiKey?: string;
  tokenUrl?: string;
}

async function resolveToken(opts: DeepgramVendorOptions): Promise<string> {
  if (opts.tokenUrl) {
    const res = await fetch(opts.tokenUrl);
    if (!res.ok) throw new Error(`Token endpoint ${res.status}`);
    const json = (await res.json()) as { key?: string; access_token?: string };
    const token = json.access_token ?? json.key;
    if (!token) throw new Error("Token endpoint returned no key");
    return token;
  }
  if (opts.apiKey) return opts.apiKey;
  throw new Error("Deepgram: no apiKey or tokenUrl configured");
}

function buildUrl(options: VendorOpenOptions): string {
  const params = new URLSearchParams({
    model: options.model || "nova-3",
    language: options.language || "ar",
    encoding: "linear16",
    sample_rate: String(options.sampleRate),
    channels: "1",
    interim_results: "true",
    smart_format: "false",
    punctuate: "false",
  });
  let url = `${DG_BASE}?${params.toString()}`;
  for (const term of options.biasTerms.slice(0, MAX_KEYTERMS)) {
    url += `&keyterm=${encodeURIComponent(term)}`;
  }
  return url;
}

export class DeepgramVendor implements CloudAsrVendor {
  readonly name = "deepgram-nova-3";
  private ws: WebSocket | null = null;
  private transcriptListeners = new Set<(t: VendorTranscript) => void>();
  private errorListeners = new Set<(e: Error) => void>();
  private opened = false;
  private pending: ArrayBuffer[] = [];

  constructor(private readonly opts: DeepgramVendorOptions) {}

  async open(options: VendorOpenOptions): Promise<void> {
    const token = await resolveToken(this.opts);
    const url = buildUrl(options);
    reciteLog.asr("cloudOpen", {
      vendor: this.name,
      model: options.model,
      language: options.language,
      biasCount: Math.min(options.biasTerms.length, MAX_KEYTERMS),
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url, ["token", token]);
      ws.binaryType = "arraybuffer";
      this.ws = ws;

      ws.onopen = () => {
        this.opened = true;
        settled = true;
        for (const buf of this.pending) ws.send(buf);
        this.pending = [];
        resolve();
      };
      ws.onmessage = (ev) => this.handleMessage(ev.data);
      ws.onerror = () => {
        const err = new Error("Deepgram websocket error");
        if (!settled) {
          settled = true;
          reject(err);
        }
        for (const l of this.errorListeners) l(err);
      };
      ws.onclose = () => {
        this.opened = false;
        if (!settled) {
          settled = true;
          reject(new Error("Deepgram websocket closed before open"));
        }
      };
    });
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") return;
    let parsed: DeepgramResult;
    try {
      parsed = JSON.parse(data) as DeepgramResult;
    } catch {
      return;
    }
    if (parsed.type && parsed.type !== "Results") return;
    const transcript = parsed.channel?.alternatives?.[0]?.transcript ?? "";
    if (!transcript) return;
    const isFinal = Boolean(parsed.is_final);
    for (const l of this.transcriptListeners) l({ transcript, isFinal });
  }

  sendPcm(pcm16: Int16Array): void {
    const buf = pcm16.buffer.slice(
      pcm16.byteOffset,
      pcm16.byteOffset + pcm16.byteLength
    );
    if (this.opened && this.ws) {
      this.ws.send(buf);
    } else {
      this.pending.push(buf);
    }
  }

  async close(): Promise<void> {
    const ws = this.ws;
    this.ws = null;
    this.opened = false;
    this.pending = [];
    if (!ws) return;
    try {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "CloseStream" }));
      }
      ws.close();
    } catch {
      /* already closed */
    }
  }

  onTranscript(listener: (t: VendorTranscript) => void): () => void {
    this.transcriptListeners.add(listener);
    return () => this.transcriptListeners.delete(listener);
  }

  onError(listener: (e: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }
}
