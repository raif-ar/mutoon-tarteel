/** Split matn line into word tokens (whitespace, strip tatweel). */
export function tokenizeLine(text) {
  return text
    .replace(/\u0640/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function buildLine(id, text_ar) {
  return { id, text_ar, words: tokenizeLine(text_ar) };
}

export function buildSection(id, title_ar, lineTexts) {
  return {
    id,
    title_ar,
    lines: lineTexts.map((text, i) =>
      buildLine(`${id}_l${String(i + 1).padStart(3, "0")}`, text)
    ),
  };
}
