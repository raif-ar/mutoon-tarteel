const DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const TATWEEL = /\u0640/g;
const ALEF_VARIANTS = /[\u0622\u0623\u0625\u0671]/g;
const ALEF_MAKSURA = /\u0649/g;
const HAMZA_VARIANTS = /[\u0624\u0626]/g;
const TA_MARBUTA = /\u0629/g;

export interface NormalizeOptions {
  stripTashkeel?: boolean;
  unifyAlef?: boolean;
}

export function normalizeArabic(text: string, options: NormalizeOptions = {}): string {
  const { stripTashkeel = true, unifyAlef = true } = options;
  let out = text.replace(TATWEEL, "").trim();
  if (stripTashkeel) {
    out = out.replace(DIACRITICS, "");
  }
  if (unifyAlef) {
    out = out
      .replace(ALEF_VARIANTS, "\u0627")
      .replace(ALEF_MAKSURA, "\u064A")
      .replace(HAMZA_VARIANTS, "\u0621")
      .replace(TA_MARBUTA, "\u0647");
  }
  return out.replace(/\s+/g, " ").trim();
}

export function normalizeWord(word: string, options?: NormalizeOptions): string {
  return normalizeArabic(word, options);
}

/** Strip definite article for looser ASR matching (الغفور ↔ غفور). */
export function stripDefiniteArticle(word: string, options?: NormalizeOptions): string {
  const n = normalizeWord(word, options);
  return n.startsWith("\u0627\u0644") ? n.slice(2) : n;
}

/** Strip proclitics ASR often fuses (وهو → هو, بالله → لله). */
export function stripCliticPrefix(word: string, options?: NormalizeOptions): string {
  let n = normalizeWord(word, options);
  if (n.startsWith("\u0648") && n.length > 2) n = n.slice(1);
  if (n.startsWith("\u0641") && n.length > 2) n = n.slice(1);
  if (n.startsWith("\u0628") && n.length > 2) n = n.slice(1);
  return n;
}

/** Strip punctuation / Latin noise ASR sometimes prepends. */
export function sanitizeTranscript(transcript: string): string {
  return transcript
    .replace(/[^\u0600-\u06FF\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeTranscript(transcript: string, options?: NormalizeOptions): string[] {
  return normalizeArabic(sanitizeTranscript(transcript), options)
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * iOS continuous speech may re-append the same phrase; drop the repeated tail
 * so alignment can advance to the next line.
 */
export function dedupeRecognizedTokens(tokens: string[]): string[] {
  if (tokens.length < 4) return tokens;

  for (let i = 1; i < tokens.length - 2; i++) {
    if (tokens[i] !== tokens[0]) continue;
    let run = 0;
    while (
      i + run < tokens.length &&
      run < i &&
      tokens[i + run] === tokens[run]
    ) {
      run++;
    }
    if (run >= 3) {
      return tokens.slice(0, i);
    }
  }

  return tokens;
}
