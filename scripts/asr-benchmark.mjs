/**
 * ASR alignment benchmark (offline) — mirrors app/src/lib/asr/align.ts (greedy scanner).
 * Run: node scripts/asr-benchmark.mjs
 * Or: cd app && npm run asr:benchmark
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const LOCAL_LOOKAHEAD = 3;
const MIN_RELOCALIZE_WORDS = 3;
const MIN_FUZZY_LENGTH = 3;
const RECOGNITION_ALIGN_TAIL = 24;
const RECOGNITION_ANCHOR_SEARCH = 16;

function normalize(text, stripTashkeel = true) {
  let out = text.replace(/\u0640/g, "").trim();
  if (stripTashkeel) out = out.replace(DIACRITICS, "");
  return out
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\s+/g, " ")
    .trim();
}

function stripAl(word) {
  const n = normalize(word);
  return n.startsWith("\u0627\u0644") ? n.slice(2) : n;
}

function variants(word) {
  const n = normalize(word);
  const ha = n.endsWith("\u0647\u0627") && n.length > 3 ? n.slice(0, -2) : n;
  const ya = n.endsWith("\u064A") && n.length > 2 ? n.slice(0, -1) : n;
  const noAlef = n.startsWith("\u0627") && n.length > 2 ? n.slice(1) : n;
  return [...new Set([n, stripAl(word), ha, ya, noAlef])];
}

function wordMatch(a, b) {
  const va = variants(a);
  const vb = variants(b);
  for (const x of va) {
    for (const y of vb) {
      if (x === y) return true;
    }
  }
  for (const x of va) {
    for (const y of vb) {
      if (x.length < MIN_FUZZY_LENGTH || y.length < MIN_FUZZY_LENGTH) continue;
      const shorter = x.length <= y.length ? x : y;
      const longer = x.length <= y.length ? y : x;
      if (longer.startsWith(shorter) && Math.abs(x.length - y.length) <= 2) {
        return true;
      }
    }
  }
  return false;
}

function prefixMatchedThrough(ops, expectedLength) {
  const matched = new Set();
  const wrong = new Set();
  const missed = new Set();
  for (const op of ops) {
    if (op.expectedIndex == null) continue;
    if (op.kind === "match") matched.add(op.expectedIndex);
    else if (op.kind === "wrong") wrong.add(op.expectedIndex);
    else if (op.kind === "missed") missed.add(op.expectedIndex);
  }
  let through = 0;
  for (let k = 0; k < expectedLength; k++) {
    if (matched.has(k)) {
      through = k + 1;
      continue;
    }
    if (
      missed.has(k) &&
      k + 1 < expectedLength &&
      matched.has(k + 1)
    ) {
      through = k + 2;
      k += 1;
      continue;
    }
    break;
  }
  return through;
}

function joinedTokens(a, b) {
  return normalize(`${a}${b}`);
}

function consumeRecognized(recognized, ri, expectedWord) {
  if (ri >= recognized.length) return 0;
  if (wordMatch(recognized[ri], expectedWord)) return 1;
  if (
    ri + 1 < recognized.length &&
    wordMatch(joinedTokens(recognized[ri], recognized[ri + 1]), expectedWord)
  ) {
    return 2;
  }
  return 0;
}

function matchesExpectedToken(recognized, ri, expectedWord) {
  return consumeRecognized(recognized, ri, expectedWord) > 0;
}

function scanPrefixMatch(expected, recognized) {
  const ops = [];
  let ei = 0;
  let ri = 0;

  while (ri < recognized.length && ei < expected.length) {
    const consumed = consumeRecognized(recognized, ri, expected[ei]);
    if (consumed > 0) {
      ops.push({ kind: "match", expectedIndex: ei });
      ei += 1;
      ri += consumed;
      continue;
    }
    if (ei + 1 < expected.length) {
      const skipConsumed = consumeRecognized(recognized, ri, expected[ei + 1]);
      if (skipConsumed > 0) {
        ops.push({ kind: "missed", expectedIndex: ei });
        ops.push({ kind: "match", expectedIndex: ei + 1 });
        ei += 2;
        ri += skipConsumed;
        continue;
      }
    }
    ops.push({ kind: "extra", expectedIndex: null });
    ri += 1;
  }

  let matchedThrough = prefixMatchedThrough(ops, expected.length);
  const hasMatch = ops.some((o) => o.kind === "match");
  if (!hasMatch) matchedThrough = 0;
  return { matchedThrough, ops };
}

function scanTailResync(expected, cursorIndex, recognized) {
  if (expected.length === 0 || recognized.length === 0 || cursorIndex < 0) {
    return { matchedThrough: 0, debug: {} };
  }
  const tail =
    recognized.length > RECOGNITION_ALIGN_TAIL
      ? recognized.slice(-RECOGNITION_ALIGN_TAIL)
      : recognized;
  const TAIL_RESYNC_MAX_BACK = 10;
  let bestAdvance = 0;
  let bestResult = null;
  let bestStartIdx = cursorIndex;

  for (let back = 0; back <= TAIL_RESYNC_MAX_BACK; back++) {
    const startIdx = cursorIndex - back;
    if (startIdx < 0) break;
    const slice = expected.slice(startIdx);
    const sub = scanPrefixMatchAtCursor(slice, tail);
    if (sub.matchedThrough <= 0) continue;
    const newAbsolute = startIdx + sub.matchedThrough;
    const advance = newAbsolute - cursorIndex;
    if (advance <= bestAdvance) continue;
    bestAdvance = advance;
    bestStartIdx = startIdx;
    bestResult = sub;
  }

  if (!bestResult || bestAdvance <= 0) {
    return scanPrefixMatchAtCursor(expected.slice(cursorIndex), tail);
  }

  const indexShift = bestStartIdx - cursorIndex;
  return {
    matchedThrough: bestAdvance,
    mistakes: bestResult.ops
      .filter((o) => o.kind === "missed")
      .map((o) => ({
        kind: "missed",
        expectedIndex:
          o.expectedIndex != null ? o.expectedIndex + indexShift : o.expectedIndex,
      })),
    debug: {
      resyncBack: cursorIndex - bestStartIdx,
      advance: bestAdvance,
      leadingSkipped: bestResult.debug?.leadingSkipped,
    },
  };
}

function speculativeMissCutoff(debug) {
  const resyncBack = typeof debug?.resyncBack === "number" ? debug.resyncBack : 0;
  const leadingSkipped =
    typeof debug?.leadingSkipped === "number" ? debug.leadingSkipped : 0;
  return Math.max(0, resyncBack, leadingSkipped);
}

function scanPrefixMatchAtCursor(expected, recognized) {
  if (expected.length === 0 || recognized.length === 0) {
    return { matchedThrough: 0, ops: [], debug: {} };
  }
  const tail =
    recognized.length > RECOGNITION_ALIGN_TAIL
      ? recognized.slice(-RECOGNITION_ALIGN_TAIL)
      : recognized;
  let bestStart = -1;
  const searchFrom = Math.max(0, tail.length - RECOGNITION_ANCHOR_SEARCH);
  for (let start = searchFrom; start < tail.length; start++) {
    if (matchesExpectedToken(tail, start, expected[0])) {
      bestStart = start;
    }
  }
  if (bestStart < 0) {
    for (let skip = 1; skip <= LOCAL_LOOKAHEAD && skip < expected.length; skip++) {
      let skipStart = -1;
      for (let start = searchFrom; start < tail.length; start++) {
        if (matchesExpectedToken(tail, start, expected[skip])) {
          skipStart = start;
        }
      }
      if (skipStart < 0) continue;
      const sub = scanPrefixMatch(expected.slice(skip), tail.slice(skipStart));
      if (sub.matchedThrough <= 0) continue;
      const missed = [];
      for (let i = 0; i < skip; i++) {
        missed.push({ kind: "missed", expectedIndex: i });
      }
      return {
        matchedThrough: skip + sub.matchedThrough,
        ops: [...missed, ...sub.ops],
        debug: { leadingSkipped: skip, anchorStart: skipStart },
      };
    }
    return { matchedThrough: 0, ops: [], debug: {} };
  }
  const sub = scanPrefixMatch(expected, tail.slice(bestStart));
  return { ...sub, debug: { anchorStart: bestStart } };
}

function wordMatchRelocalize(a, b) {
  if (wordMatch(a, b)) return true;
  const na = normalize(a);
  const nb = normalize(b);
  if (
    (na === "\u0644\u0627" && nb === "\u0644\u0627\u0645") ||
    (na === "\u0644\u0627\u0645" && nb === "\u0644\u0627")
  ) {
    return true;
  }
  if (na.length >= 2 && nb.length >= 2) {
    const shorter = na.length <= nb.length ? na : nb;
    const longer = na.length <= nb.length ? nb : na;
    if (longer.startsWith(shorter)) return true;
  }
  return false;
}

function phraseMatchesRelocalize(heard, expected) {
  if (heard.length !== expected.length) return false;
  for (let i = 0; i < heard.length; i++) {
    if (!wordMatchRelocalize(heard[i], expected[i])) return false;
  }
  return true;
}

function searchHeardPhraseInPassed(passed, heard, cursor, searchBack = 48) {
  if (cursor <= 0 || heard.length < MIN_RELOCALIZE_WORDS) return null;
  const window =
    heard.length > 24 ? heard.slice(-24) : heard;
  let bestStart = -1;
  let bestLen = 0;
  const maxPhraseLen = Math.min(12, window.length, cursor);
  for (let len = maxPhraseLen; len >= MIN_RELOCALIZE_WORDS; len--) {
    for (let hStart = 0; hStart <= window.length - len; hStart++) {
      const phrase = window.slice(hStart, hStart + len);
      const searchStart = Math.max(0, cursor - searchBack);
      for (let pStart = searchStart; pStart <= cursor - len; pStart++) {
        const slice = passed.slice(pStart, pStart + len);
        if (!phraseMatchesRelocalize(phrase, slice)) continue;
        if (len > bestLen || (len === bestLen && pStart > bestStart)) {
          bestLen = len;
          bestStart = pStart;
        }
      }
    }
  }
  if (bestStart < 0 || cursor - bestStart < 3) return null;
  return { relocalizeCursor: bestStart, len: bestLen, mode: "phraseSearch" };
}

function relocalizeBackward(passed, heard, cursor) {
  if (cursor <= 0 || heard.length < MIN_RELOCALIZE_WORDS) return null;
  const phraseHit = searchHeardPhraseInPassed(passed, heard, cursor);
  if (phraseHit) return phraseHit;
  const maxLen = Math.min(heard.length, cursor, 12);
  for (let len = maxLen; len >= MIN_RELOCALIZE_WORDS; len--) {
    const phrase = heard.slice(-len);
    const suffix = passed.slice(cursor - len, cursor);
    if (phraseMatchesRelocalize(phrase, suffix)) {
      return { relocalizeCursor: cursor - len, len, mode: "suffix" };
    }
  }
  return null;
}

function tokenize(text) {
  return normalize(text).split(/\s+/).filter(Boolean);
}

const matn = JSON.parse(
  readFileSync(join(root, "content/mutoon/tuhfat_al_atfal.json"), "utf8")
);

function lineWords(lineId) {
  const line = matn.sections.flatMap((s) => s.lines).find((l) => l.id === lineId);
  if (!line) throw new Error(`Missing line ${lineId}`);
  return line.words.map((w) => normalize(w));
}

const cases = [
  {
    name: "perfect_first_line",
    run: () => {
      const expected = lineWords("intro_l001");
      const recognized = tokenize("يقول راجي رحمة الغفور");
      const { matchedThrough } = scanPrefixMatch(expected, recognized);
      return matchedThrough === expected.length;
    },
  },
  {
    name: "about_sheikh_skip_one",
    run: () => {
      const expected = lineWords("intro_l008");
      const recognized = tokenize("شيخنا الميهي ذي الكمال");
      const { matchedThrough, ops } = scanPrefixMatch(expected, recognized);
      const missedAbout = ops.some((o) => o.kind === "missed" && o.expectedIndex === 0);
      return matchedThrough >= 4 && missedAbout;
    },
  },
  {
    name: "stale_cumulative_no_bulk_skip",
    run: () => {
      const expected = lineWords("intro_l001");
      const recognized = tokenize(
        "يقول راجي رحمة الغفور يقول راجي رحمة الغفور"
      );
      const { matchedThrough } = scanPrefixMatch(expected, recognized);
      return matchedThrough === expected.length && matchedThrough <= 5;
    },
  },
  {
    name: "distant_fuzzy_rejected",
    run: () => {
      const expected = lineWords("intro_l008");
      const recognized = tokenize("الكمال");
      const { matchedThrough } = scanPrefixMatch(expected, recognized);
      return matchedThrough === 0;
    },
  },
  {
    name: "backward_relocalize_B_success",
    run: () => {
      const expected = lineWords("intro_l008");
      const cursor = 5;
      const passed = expected.slice(0, cursor);
      const heard = tokenize("الميهي ذي الكمال");
      const reloc = relocalizeBackward(passed, heard, cursor);
      return reloc?.relocalizeCursor === 2;
    },
  },
  {
    name: "backward_relocalize_B_fail_not_suffix",
    run: () => {
      const expected = lineWords("intro_l008");
      const cursor = 5;
      const passed = expected.slice(0, cursor);
      const heard = tokenize("عن شيخنا");
      const reloc = relocalizeBackward(passed, heard, cursor);
      return reloc === null;
    },
  },
  {
    name: "fast_burst_capped",
    run: () => {
      const expected = lineWords("intro_l001")
        .concat(lineWords("intro_l002"))
        .concat(lineWords("intro_l003"));
      const recognized = tokenize(
        "يقول راجي رحمة الغفور دوما سليمان هو الجمزوري ومنه"
      );
      const { matchedThrough } = scanPrefixMatch(expected, recognized);
      const MIC_MAX_FINAL_ADVANCE = 8;
      const capped = Math.min(matchedThrough, MIC_MAX_FINAL_ADVANCE);
      return matchedThrough >= MIC_MAX_FINAL_ADVANCE && capped === MIC_MAX_FINAL_ADVANCE;
    },
  },
  {
    name: "no_forward_jump_via_distant",
    run: () => {
      const expected = lineWords("intro_l008");
      const recognized = tokenize("الميهي ذي");
      const { matchedThrough } = scanPrefixMatch(expected, recognized);
      return matchedThrough <= 2;
    },
  },
  {
    name: "unrelated_asr_no_advance",
    run: () => {
      const expected = tokenize("وَمَنْ تَلَا وَبَعْدُ هَذَا النَّظْمُ");
      const recognized = tokenize("يقول راجي رحمة الغفور دوما");
      const { matchedThrough } = scanPrefixMatch(expected, recognized);
      return matchedThrough === 0;
    },
  },
  {
    name: "dammenha_verb_form",
    run: () => {
      const expected = tokenize("ضَمَّنْتُهَا");
      const recognized = tokenize("اضمن ضمنها");
      const { matchedThrough } = scanPrefixMatch(expected, recognized);
      return matchedThrough === 1 && wordMatch("ضمنها", "ضَمَّنْتُهَا");
    },
  },
  {
    name: "cumulative_tail_anchor",
    run: () => {
      const expected = tokenize("فَلْتَعْرِفِ هَمْزٌ فَهَاءٌ");
      const preamble = tokenize(
        "يقول راجي رحمة الغفور دوما سليمان الجمزوري الحمد لله"
      );
      const tail = tokenize("فل تعرفي همز");
      const recognized = [...preamble, ...tail];
      const { matchedThrough } = scanPrefixMatchAtCursor(expected, recognized);
      return matchedThrough >= 2;
    },
  },
  {
    name: "tail_resync_mid_phrase_advance",
    run: () => {
      const expected = lineWords("intro_l001");
      const cursor = 0;
      const recognized = tokenize("راجي رحمة الغفور");
      const { matchedThrough, debug } = scanTailResync(
        expected,
        cursor,
        recognized
      );
      return matchedThrough >= 3 && speculativeMissCutoff(debug) > 0;
    },
  },
  {
    name: "partial_speculative_miss_cutoff",
    run: () => {
      const expected = lineWords("intro_l001");
      const cursor = 0;
      const recognized = tokenize("راجي رحمة الغفور");
      const { matchedThrough, mistakes, debug } = scanTailResync(
        expected,
        cursor,
        recognized
      );
      const cutoff = speculativeMissCutoff(debug);
      const speculative = mistakes.filter(
        (m) => m.expectedIndex != null && m.expectedIndex < cursor + cutoff
      );
      return matchedThrough >= 3 && cutoff > 0 && speculative.length > 0;
    },
  },
  {
    name: "voice_back_phrase_in_middle",
    run: () => {
      const all = matn.sections.flatMap((s) => s.lines).flatMap((l) => l.words);
      const passed = all.slice(0, 102).map((w) => normalize(w));
      const heard = tokenize(
        "الثاني اضواء بغير غنه في لا وراء ثم كر والثالث لكنها قسم"
      );
      const reloc = relocalizeBackward(passed, heard, 102);
      return (
        reloc?.mode === "phraseSearch" &&
        reloc.relocalizeCursor >= 90 &&
        reloc.relocalizeCursor < 102 &&
        102 - reloc.relocalizeCursor >= 3
      );
    },
  },
];

let passed = 0;
for (const c of cases) {
  let ok = false;
  try {
    ok = c.run();
  } catch (e) {
    console.error(`✗ ${c.name}:`, e.message);
    continue;
  }
  if (ok) passed += 1;
  console.log(`${ok ? "✓" : "✗"} ${c.name}`);
}

console.log(`\n${passed}/${cases.length} alignment checks passed`);
process.exit(passed === cases.length ? 0 : 1);
