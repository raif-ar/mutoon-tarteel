/**
 * Vocalized Arabic (imlaei spelling with full tashkeel) -> phoneme string in the
 * "muaalem-v3_2" inventory that the on-device listener model emits.
 *
 * Mutoon are poetry/prose, not Quran, so tajweed lengthening (ghunnah, ikhfa,
 * madd of 4) is off by default: the aligner compares on a length-free skeleton
 * anyway (see phonemeAlign.ts). Pure and dependency-free so the Node gate
 * (scripts/recite-phoneme-gate.mjs) runs the shipped code.
 */

export interface PhonemizeOptions {
  /** Apply ghunnah lengths on doubled noon/meem. */
  tajweed?: boolean;
  /** Lengthen the rhyme vowel at the end of the line. */
  ishbaa?: boolean;
}

export interface PhonemizedLine {
  /** Connected pronunciation of the whole line. */
  p: string;
  /** Start offset of each word inside `p`. */
  o: number[];
  /** Pause (isolated) pronunciation of each word. */
  iso: string[];
}

interface Seg {
  c: string;
  m: Set<string>;
}

interface Unit {
  p: string;
  kind: "c" | "v" | "long" | "tanween";
  ta?: boolean;
  sukun?: boolean;
  sv?: string;
}

const FATHA = "َ", DAMMA = "ُ", KASRA = "ِ", SUKUN = "ْ", SHADDA = "ّ";
const FATHATAN = "ً", DAMMATAN = "ٌ", KASRATAN = "ٍ", DAGGER = "ٰ", MADDAH = "ٓ";
const MARKS = new Set([FATHA, DAMMA, KASRA, SUKUN, SHADDA, FATHATAN, DAMMATAN, KASRATAN, DAGGER, MADDAH]);
const HAMZAS = new Set(["أ", "إ", "ؤ", "ئ", "ء"]);
const QALQALA = new Set(["ق", "ط", "ب", "ج", "د"]);
const LONG: Record<string, string> = { [FATHA]: "اا", [DAMMA]: "ۥۥ", [KASRA]: "ۦۦ" };
const SHORT_VOWELS = new Set([FATHA, DAMMA, KASRA]);

// Words whose long alif is not written.
const LEXICAL: Array<[RegExp, string]> = [
  [/^(.*)هَذَا$/, "$1هَاذَا"],
  [/^(.*)هَذِهِ$/, "$1هَاذِهِ"],
  [/^(.*)ذَلِكَ$/, "$1ذَالِكَ"],
  [/^(.*)لَكِنْ$/, "$1لَاكِنْ"],
  [/^(وَ|فَ)?لَكِنَّ(.*)$/, "$1لَاكِنَّ$2"],
  [/^(.*)أُولَئِكَ$/, "$1أُلَائِكَ"],
  [/^(.*)الرَّحْمَنِ$/, "$1الرَّحْمَانِ"],
  [/^(.*)إِلَهَ$/, "$1إِلَاهَ"],
  [/^(.*)إِلَهِ$/, "$1إِلَاهِ"],
  [/^(.*)إِلَهُ$/, "$1إِلَاهُ"],
  [/^(.*)لِلَّهِ$/, "$1لِلَّاهِ"],
  [/^(.*)اللَّهِ$/, "$1اللَّاهِ"],
  [/^(.*)اللَّهُ$/, "$1اللَّاهُ"],
  [/^(.*)اللَّهَ$/, "$1اللَّاهَ"],
];

function segment(word: string): Seg[] {
  const segs: Seg[] = [];
  for (const ch of word.replace(/ـ/g, "")) {
    if (MARKS.has(ch)) {
      if (segs.length) segs[segs.length - 1].m.add(ch);
    } else if (/[ء-يٱ]/.test(ch)) {
      segs.push({ c: ch, m: new Set() });
    }
  }
  return segs;
}

const vowelOf = (s: Seg): string | null => [...s.m].find((x) => SHORT_VOWELS.has(x)) ?? null;
const tanweenOf = (s: Seg): string | null => [...s.m].find((x) => x === FATHATAN || x === DAMMATAN || x === KASRATAN) ?? null;
const bare = (s: Seg): boolean => !vowelOf(s) && !tanweenOf(s) && !s.m.has(SHADDA);

/**
 * One word -> { units: phoneme units, wasl: starts with hamzat wasl, waslVowel }.
 * A unit is { p: string, kind: "c" | "v" | "long" | "tanween" }.
 */
function wordUnits(
  raw: string,
  opts: PhonemizeOptions
): { units: Unit[]; wasl: boolean; waslVowel: string } {
  let word = raw.normalize("NFC");
  for (const [re, to] of LEXICAL) if (re.test(word)) { word = word.replace(re, to); break; }
  const segs = segment(word);
  const units: Unit[] = [];
  let wasl = false;
  let waslVowel = KASRA;
  let prevVowel: string | null = null;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i], next = segs[i + 1], next2 = segs[i + 2];
    let c = s.c;

    // Hamzat wasl: bare alif at word start, or after a one-letter prefix, before lam of the article.
    const articleAhead = next && next.c === "ل" && (next.m.has(SUKUN) || (bare(next) && next2 && next2.m.has(SHADDA)) || (next.m.has(SHADDA)));
    if ((c === "ا" || c === "ٱ") && bare(s) && !s.m.has(DAGGER) && (i === 0 || (i <= 2 && articleAhead && prevVowel))) {
      if (i === 0) { wasl = true; waslVowel = articleAhead ? FATHA : KASRA; }
      // Shamsi lam: drop the lam too.
      if (articleAhead && bare(next) && !next.m.has(SUKUN) && next2 && next2.m.has(SHADDA)) i++;
      prevVowel = null;
      continue;
    }

    // Long vowels written as a letter.
    if ((c === "ا" || c === "ى") && bare(s) && !s.m.has(SUKUN) || (c === "ى" && bare(s))) {
      if (prevVowel === FATHA || prevVowel === null) {
        if (units.length && units[units.length - 1].kind === "tanween") continue; // alif after fathatan
        units.push({ p: "اا", kind: "long" });
        prevVowel = null;
        continue;
      }
    }
    if (c === "و" && bare(s) && prevVowel === DAMMA) { units.push({ p: "ۥۥ", kind: "long" }); prevVowel = null; continue; }
    if (c === "ي" && bare(s) && prevVowel === KASRA) { units.push({ p: "ۦۦ", kind: "long" }); prevVowel = null; continue; }
    if (c === "ا" && bare(s)) continue; // silent alif (e.g. after waw al-jama'a)

    if (c === "آ") { units.push({ p: "ء", kind: "c" }, { p: FATHA, kind: "v" }, { p: "اا", kind: "long" }); prevVowel = null; continue; }
    if (HAMZAS.has(c)) c = "ء";
    if (c === "ة") c = "ت";
    if (c === "ى") c = "ي";
    if (c === "ٱ") c = "ا";

    const shadda = s.m.has(SHADDA);
    const ghunnah = opts.tajweed && shadda && (c === "ن" || c === "م");
    units.push({ p: c.repeat(ghunnah ? 4 : shadda ? 2 : 1), kind: "c", ta: s.c === "ة", sukun: s.m.has(SUKUN) });
    if (s.m.has(MADDAH)) { units.push({ p: "اا", kind: "long" }); prevVowel = null; continue; }
    const v = vowelOf(s), t = tanweenOf(s);
    if (v) { units.push({ p: v, kind: "v" }); prevVowel = v; }
    else if (t) {
      const sv = t === FATHATAN ? FATHA : t === DAMMATAN ? DAMMA : KASRA;
      units.push({ p: sv, kind: "v" }, { p: "ن", kind: "tanween", sv });
      prevVowel = null;
    } else prevVowel = null;
    if (s.m.has(DAGGER)) { units.push({ p: "اا", kind: "long" }); prevVowel = null; }
  }
  return { units, wasl, waslVowel };
}

function render(
  units: Unit[],
  { pause, ishbaa, qalqala = true }: { pause: boolean; ishbaa?: boolean; qalqala?: boolean }
): string {
  let u = units.map((x) => ({ ...x }));
  if (pause) {
    const last = u[u.length - 1];
    if (last?.kind === "tanween") {
      u.pop(); // nun
      const v = u.pop() as Unit; // vowel
      if (last.sv === FATHA) u.push(v, { p: "اا", kind: "long" });
      else if (ishbaa) u.push(v, { p: LONG[last.sv as string], kind: "long" });
    } else if (last?.kind === "v") {
      if (ishbaa) u.push({ p: LONG[last.p], kind: "long" });
      else u.pop();
    }
    const end = u[u.length - 1];
    if (end?.kind === "c" && end.ta) end.p = "ه";
  }
  let out = "";
  for (let i = 0; i < u.length; i++) {
    out += u[i].p;
    const nxt = u[i + 1];
    if (qalqala && u[i].kind === "c" && QALQALA.has(u[i].p[0]) && (!nxt ? pause : nxt.kind === "c") && u[i].p.length === 1) out += "ڇ";
  }
  return out;
}

/**
 * A line of words -> { p, o, iso } in the Tilawa reference shape.
 * opts: { tajweed: bool (ghunnah lengths), ishbaa: bool (lengthen the rhyme vowel at line end) }
 */
export function phonemizeLine(
  words: string[],
  opts: PhonemizeOptions = {}
): PhonemizedLine {
  const parsed = words.map((w) => wordUnits(w, opts));
  let p = "";
  const o: number[] = [];
  const iso: string[] = [];
  parsed.forEach((w, i) => {
    const last = i === parsed.length - 1;
    const nextWasl = !last && parsed[i + 1].wasl;
    let units = w.units;
    // A long vowel is shortened before a hamzat wasl.
    if (nextWasl && units[units.length - 1]?.kind === "long") units = units.slice(0, -1);
    let s = render(units, { pause: last, ishbaa: opts.ishbaa });
    // Qalqala on a word-final sukun letter mid-line.
    const lastU = units[units.length - 1];
    if (!last && lastU?.kind === "c" && QALQALA.has(lastU.p[0]) && lastU.p.length === 1 && !s.endsWith("ڇ")) s += "ڇ";
    if (w.wasl && i === 0) s = "ء" + w.waslVowel + s;
    o.push(p.length);
    p += s;
    iso.push((w.wasl ? "ء" + w.waslVowel : "") + render(w.units, { pause: true, ishbaa: false }));
  });
  return { p, o, iso };
}

/**
 * Per-word phonemes as recited in flow: each word's slice of the connected line,
 * so case endings, tanween, assimilated lam and hamzat wasl follow connected
 * speech, and the last word of the line takes its pause form.
 */
export function lineWordPhonemes(words: string[], opts: PhonemizeOptions = {}): string[] {
  const { p, o } = phonemizeLine(words, opts);
  return words.map((_, i) => p.slice(o[i], i + 1 < o.length ? o[i + 1] : p.length));
}
