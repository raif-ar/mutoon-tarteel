/**
 * Contextual biasing for ASR providers.
 *
 * The recite engine already knows the exact words coming up in the matn and
 * passes them via `AsrStartOptions.contextualStrings`. This module turns that
 * list into the bias payload the cloud backends expect:
 *
 * - Deepgram Nova-3: repeated `keyterm` query params (the production path).
 * - OpenAI transcription (`gpt-realtime-whisper`): a natural `prompt` seed.
 */

import { normalizeArabic } from "./normalize";

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

const ALEF = "\u0627";

/**
 * Variants of one matn word that help the cloud recognizer lock onto it.
 *
 * Nova-3 emits Arabic *without* tashkeel, and the 2026-07-08 keyterm sweep
 * (docs/ACCURACY_BASELINE.md) showed fully-voweled keyterms actively hurt:
 * line-scoped vocalized terms scored 26.9% WER vs 9.5% for the same terms
 * normalized — nearly as bad as no biasing at all. So we bias with the
 * normalized form only. Mutoon verses also end on an "alif al-itlaq"
 * (الطُّلَّابَا) that the model routinely drops (الطلاب), so we add the
 * clipped rhyme form too — this was the recurring stuck cluster (`-ابا`)
 * in recite logs.
 */
function biasVariants(raw: string): string[] {
  const surface = raw.trim();
  if (!surface) return [];
  const stripped = normalizeArabic(surface, {
    stripTashkeel: true,
    unifyAlef: true,
  });
  if (!stripped) return [];
  const out = [stripped];
  if (stripped.length > 3 && stripped.endsWith(ALEF)) {
    out.push(stripped.slice(0, -1));
  }
  return out;
}

function collectBiasTerms(upcoming: string[], maxTerms: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let tokenEstimate = 0;
  for (const raw of upcoming) {
    for (const term of biasVariants(raw)) {
      if (seen.has(term)) continue;
      // Arabic words are typically 1-3 subword tokens; budget conservatively.
      const cost = Math.max(1, Math.ceil(term.length / 3));
      if (tokenEstimate + cost > MAX_BIAS_TOKENS) return out;
      seen.add(term);
      out.push(term);
      tokenEstimate += cost;
      if (out.length >= maxTerms) return out;
    }
  }
  return out;
}

export function buildBias(
  upcoming: string[],
  options?: BuildBiasOptions
): BiasPayload {
  const maxTerms = options?.maxTerms ?? DEFAULT_MAX_TERMS;
  const boost = options?.hotwordBoost ?? DEFAULT_HOTWORD_BOOST;
  const terms = collectBiasTerms(upcoming ?? [], maxTerms);

  const deepgramKeytermQuery = terms
    .map((t) => `keyterm=${encodeURIComponent(t)}`)
    .join("&");

  const prompt = terms.join(" ");

  const hotwords = terms.map((t) => `${t} :${boost}`).join("\n");

  return { terms, deepgramKeytermQuery, prompt, hotwords };
}
