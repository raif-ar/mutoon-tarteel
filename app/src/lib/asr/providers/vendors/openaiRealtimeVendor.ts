import { reciteLog } from "../../../reciteLog";
import type { CloudAsrVendor, VendorOpenOptions, VendorTranscript } from "./types";

/**
 * OpenAI Realtime transcription adapter using `gpt-realtime-whisper`
 * (the 2026 streaming STT model). Documented A/B alternate to Deepgram.
 *
 * Opens a realtime *transcription* session, biases via the `prompt` field
 * seeded with upcoming matn words, appends PCM to the input buffer, and reads
 * streaming `*transcription*.delta` / `.completed` events.
 *
 * Note: OpenAI recommends 24 kHz mono PCM for realtime; we forward the
 * provider's configured sample rate and let the session resample. Auth uses
 * the websocket subprotocol so no key lands in the URL.
 */

const OAI_URL = "wss://api.openai.com/v1/realtime?intent=transcription";

interface OpenAiEvent {
  type?: string;
  delta?: string;
  transcript?: string;
}

export interface OpenAiVendorOptions {
  apiKey?: string;
  tokenUrl?: string;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  if (i < bytes.length) {
    const rem = bytes.length - i;
    if (rem === 1) {
      const n = bytes[i] << 16;
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + "==";
    } else {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + "=";
    }
  }
  return out;
}

async function resolveToken(opts: OpenAiVendorOptions): Promise<string> {
  if (opts.tokenUrl) {
    const res = await fetch(opts.tokenUrl);
    if (!res.ok) throw new Error(`Token endpoint ${res.status}`);
    const json = (await res.json()) as {
      client_secret?: { value?: string };
      value?: string;
    };
    const token = json.client_secret?.value ?? json.value;
    if (!token) throw new Error("Token endpoint returned no client secret");
    return token;
  }
  if (opts.apiKey) return opts.apiKey;
  throw new Error("OpenAI: no apiKey or tokenUrl configured");
}

export class OpenAiRealtimeVendor implements CloudAsrVendor {
  readonly name = "openai-gpt-realtime-whisper";
  private ws: WebSocket | null = null;
  private transcriptListeners = new Set<(t: VendorTranscript) => void>();
  private errorListeners = new Set<(e: Error) => void>();
  private opened = false;
  private liveDelta = "";

  constructor(private readonly opts: OpenAiVendorOptions) {}

  async open(options: VendorOpenOptions): Promise<void> {
    const token = await resolveToken(this.opts);
    reciteLog.asr("cloudOpen", {
      vendor: this.name,
      model: options.model,
      biasCount: options.biasTerms.length,
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(OAI_URL, [
        "realtime",
        `openai-insecure-api-key.${token}`,
        "openai-beta.realtime-v1",
      ]);
      this.ws = ws;

      ws.onopen = () => {
        this.opened = true;
        settled = true;
        ws.send(
          JSON.stringify({
            type: "session.update",
            session: {
              type: "transcription",
              audio: {
                input: {
                  format: { type: "audio/pcm", rate: options.sampleRate },
                  transcription: {
                    model: options.model || "gpt-realtime-whisper",
                    prompt: options.biasTerms.join(" "),
                  },
                },
              },
            },
          })
        );
        resolve();
      };
      ws.onmessage = (ev) => this.handleMessage(ev.data);
      ws.onerror = () => {
        const err = new Error("OpenAI realtime websocket error");
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
          reject(new Error("OpenAI websocket closed before open"));
        }
      };
    });
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") return;
    let ev: OpenAiEvent;
    try {
      ev = JSON.parse(data) as OpenAiEvent;
    } catch {
      return;
    }
    const type = ev.type ?? "";
    if (type.endsWith("transcription.delta") || type.endsWith("transcript.text.delta")) {
      this.liveDelta += ev.delta ?? "";
      if (this.liveDelta) {
        for (const l of this.transcriptListeners) {
          l({ transcript: this.liveDelta, isFinal: false });
        }
      }
      return;
    }
    if (
      type.endsWith("transcription.completed") ||
      type.endsWith("transcript.text.done")
    ) {
      const final = ev.transcript ?? this.liveDelta;
      this.liveDelta = "";
      if (final) {
        for (const l of this.transcriptListeners) {
          l({ transcript: final, isFinal: true });
        }
      }
    }
  }

  sendPcm(pcm16: Int16Array): void {
    if (!this.opened || !this.ws) return;
    const bytes = new Uint8Array(
      pcm16.buffer,
      pcm16.byteOffset,
      pcm16.byteLength
    );
    this.ws.send(
      JSON.stringify({
        type: "input_audio_buffer.append",
        audio: bytesToBase64(bytes),
      })
    );
  }

  async close(): Promise<void> {
    const ws = this.ws;
    this.ws = null;
    this.opened = false;
    this.liveDelta = "";
    try {
      ws?.close();
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
