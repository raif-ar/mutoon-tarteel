import type { MatnDocument } from "../../types/content";
import { flattenLines } from "./loader";

export type MatnCategory = "Tajweed" | "Aqeedah" | "Hadith";

export interface MatnListItem {
  id: string;
  title: string;
  titleAr: string;
  author: string;
  category: MatnCategory;
  totalLines: number;
  accentColor: string;
}

const META: Record<
  string,
  Omit<MatnListItem, "id" | "titleAr" | "totalLines"> & { title?: string }
> = {
  tuhfat_al_atfal: {
    title: "Tuhfatul Atfaal",
    author: "Sulayman al-Jamzuri",
    category: "Tajweed",
    accentColor: "#0C8C7E",
  },
  thalathat_al_usool: {
    title: "Three Principles",
    author: "Muhammad ibn Abdul-Wahhab",
    category: "Aqeedah",
    accentColor: "#3B6FD4",
  },
  qawaid_al_arba: {
    title: "Four Rules",
    author: "Muhammad ibn Abdul-Wahhab",
    category: "Aqeedah",
    accentColor: "#3B6FD4",
  },
};

export const MATN_CATEGORIES: Array<MatnCategory | "All"> = [
  "All",
  "Tajweed",
  "Aqeedah",
  "Hadith",
];

export function toMatnListItem(doc: MatnDocument): MatnListItem {
  const meta = META[doc.id] ?? {
    title: doc.title_en ?? doc.title_ar,
    author: doc.author_ar,
    category: "Tajweed" as MatnCategory,
    accentColor: "#0C8C7E",
  };
  return {
    id: doc.id,
    title: meta.title ?? doc.title_en ?? doc.title_ar,
    titleAr: doc.title_ar,
    author: meta.author ?? doc.author_ar,
    category: meta.category,
    totalLines: flattenLines(doc).length,
    accentColor: meta.accentColor,
  };
}
