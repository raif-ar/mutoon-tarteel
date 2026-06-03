/**
 * Contextual biasing for ASR providers.
 *
 * The recite engine already knows the exact words coming up in the matn and
 * passes them via `AsrStartOptions.contextualStrings`. This module turns that
 * list into the bias payload each backend expects:
 *
 * - Deepgram Nova-3 / Flux: repeated `keyterm` query params.
 * - OpenAI transcription (`gpt-realtime-whisper` / `gpt-4o-transcribe`): a
 *   natural `prompt` seed.
 * - On-device Whisper (`whisper.rn` / WhisperKit): `initialPrompt` prefix.
 * - sherpa-onnx: a hotwords block (`word :boost`).
 */

export interface BiasPayload {
  /** De-duplicated upcoming expected words (surface form, order preserved). */
  terms: string[];
  /** Deepgram query fragment: `keyterm=...&keyterm=...` (URL-encoded). */
  deepgramKeytermQuery: string;
  /** Whisper / OpenAI prompt seed (space-joined). */
  prompt: string;
  /** sherpa-onnx hotwords block, one `word :boost` per line. */
  hotwords: string;
}

export interface BuildBiasOptions {
  /** Cap on number of bias terms (keeps Deepgram under its 500-token budget). */
  maxTerms?: number;
  /** Boost weight for sherpa-onnx hotwords. */
  hotwordBoost?: number;
}

const DEFAULT_MAX_TERMS = 60;
const DEFAULT_HOTWORD_BOOST = 2.0;

/** Rough upper bound so we never exceed Deepgram's 500-token keyterm budget. */
const MAX_BIAS_TOKENS = 480;

function uniqueWords(upcoming: string[], maxTerms: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let tokenEstimate = 0;
  for (const raw of upcoming) {
    const word = raw.trim();
    if (!word) continue;
    if (seen.has(word)) continue;
    // Arabic words are typically 1-3 subword tokens; budget conservatively.
    const cost = Math.max(1, Math.ceil(word.length / 3));
    if (tokenEstimate + cost > MAX_BIAS_TOKENS) break;
    seen.add(word);
    out.push(word);
    tokenEstimate += cost;
    if (out.length >= maxTerms) break;
  }
  return out;
}

export function buildBias(
  upcoming: string[],
  options?: BuildBiasOptions
): BiasPayload {
  const maxTerms = options?.maxTerms ?? DEFAULT_MAX_TERMS;
  const boost = options?.hotwordBoost ?? DEFAULT_HOTWORD_BOOST;
  const terms = uniqueWords(upcoming ?? [], maxTerms);

  const deepgramKeytermQuery = terms
    .map((t) => `keyterm=${encodeURIComponent(t)}`)
    .join("&");

  const prompt = terms.join(" ");

  const hotwords = terms.map((t) => `${t} :${boost}`).join("\n");

  return { terms, deepgramKeytermQuery, prompt, hotwords };
}
