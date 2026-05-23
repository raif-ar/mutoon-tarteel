export type HarakatPolicy = "full" | "partial" | "none";

export interface LineAudio {
  asset?: string;
  start_ms?: number;
  end_ms?: number;
}

export interface MatnLine {
  id: string;
  text_ar: string;
  words: string[];
  audio?: LineAudio;
}

export interface MatnSection {
  id: string;
  title_ar: string;
  lines: MatnLine[];
}

export interface MatnDocument {
  id: string;
  version: number;
  title_ar: string;
  title_en?: string;
  author_ar?: string;
  edition: string;
  harakat_policy: HarakatPolicy;
  source_url?: string | null;
  sections: MatnSection[];
}

export interface ContentManifest {
  version: number;
  matns: Array<{
    id: string;
    title_ar: string;
    file: string;
    line_count: number;
  }>;
}

export interface FlatLineRef {
  matnId: string;
  sectionId: string;
  sectionTitle: string;
  line: MatnLine;
  globalIndex: number;
}
