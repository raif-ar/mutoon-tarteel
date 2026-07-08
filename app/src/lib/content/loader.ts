import type { ContentManifest, FlatLineRef, MatnDocument } from "../../types/content";

import manifest from "../../../assets/content/manifest.json";
import tuhfat from "../../../assets/content/tuhfat_al_atfal.json";
import thalathat from "../../../assets/content/thalathat_al_usool.json";
import qawaid from "../../../assets/content/qawaid_al_arba.json";

const MATN_BY_ID: Record<string, MatnDocument> = {
  tuhfat_al_atfal: tuhfat as MatnDocument,
  thalathat_al_usool: thalathat as MatnDocument,
  qawaid_al_arba: qawaid as MatnDocument,
};

export function getManifest(): ContentManifest {
  return manifest as ContentManifest;
}

export function listMatns(): MatnDocument[] {
  return getManifest().matns.map((m) => getMatn(m.id));
}

export function getMatn(id: string): MatnDocument {
  const doc = MATN_BY_ID[id];
  if (!doc) {
    throw new Error(`Unknown matn: ${id}`);
  }
  return doc;
}

export function flattenLines(matn: MatnDocument): FlatLineRef[] {
  const refs: FlatLineRef[] = [];
  let globalIndex = 0;
  for (const section of matn.sections) {
    for (const line of section.lines) {
      refs.push({
        matnId: matn.id,
        sectionId: section.id,
        sectionTitle: section.title_ar,
        line,
        globalIndex,
      });
      globalIndex += 1;
    }
  }
  return refs;
}

export function getLineRange(
  matn: MatnDocument,
  startIndex: number,
  endIndex: number
): FlatLineRef[] {
  const all = flattenLines(matn);
  return all.slice(startIndex, Math.min(endIndex + 1, all.length));
}

/** Flat word sequence for recite alignment (one entry per expected word). */
export interface SessionWordRef {
  word: string;
  lineIndex: number;
  wordIndex: number;
  globalIndex: number;
}

export function flattenSessionWords(lines: FlatLineRef[]): SessionWordRef[] {
  const refs: SessionWordRef[] = [];
  let globalIndex = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex].line;
    for (let wordIndex = 0; wordIndex < line.words.length; wordIndex++) {
      refs.push({
        word: line.words[wordIndex],
        lineIndex,
        wordIndex,
        globalIndex,
      });
      globalIndex += 1;
    }
  }
  return refs;
}

export function searchLines(matn: MatnDocument, query: string, limit = 20): FlatLineRef[] {
  const normalized = query.trim();
  if (!normalized) return [];
  const all = flattenLines(matn);
  return all
    .filter(
      (r) =>
        r.line.text_ar.includes(normalized) ||
        r.sectionTitle.includes(normalized)
    )
    .slice(0, limit);
}
