/**
 * Substitution-detection test for the REAL alignment code (align-trust-v4).
 *
 * Unlike asr-benchmark.mjs (a hand-written JS mirror), this transpiles the
 * actual app/src/lib/asr/{normalize,align}.ts with the installed TypeScript
 * compiler and imports them, so the assertions exercise shipped code.
 *
 * It checks two claims behind v4:
 *   1. A skip-ahead miss with a non-matching token before the next-word anchor
 *      surfaces that token as a substitution candidate (the swap word).
 *   2. A clean ASR drop (next word at the head of the tail) stays an omission
 *      (recognizedWord === null), so substitution detection adds no false reds.
 *
 * Usage:
 *   node scripts/recite-align-test.mjs                 # unit cases
 *   node scripts/recite-align-test.mjs <log> [labels]  # + sweep a real log
 */

import { createRequire } from "module";
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  existsSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join, basename } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(root, "app");
const srcDir = join(appDir, "src", "lib", "asr");
const require = createRequire(join(appDir, "package.json"));
const ts = require("typescript");

function transpileToEsm(tsSource) {
  return ts.transpileModule(tsSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
}

async function loadRealAlign() {
  const out = mkdtempSync(join(tmpdir(), "recite-align-"));
  const normalize = transpileToEsm(readFileSync(join(srcDir, "normalize.ts"), "utf8"));
  const lev = transpileToEsm(readFileSync(join(srcDir, "lev.ts"), "utf8"));
  let align = transpileToEsm(readFileSync(join(srcDir, "align.ts"), "utf8"));
  align = align.replace(/(["'])\.\/normalize\1/g, '"./normalize.mjs"');
  align = align.replace(/(["'])\.\/lev\1/g, '"./lev.mjs"');
  let acoustic = transpileToEsm(readFileSync(join(srcDir, "acousticReconcile.ts"), "utf8"));
  acoustic = acoustic.replace(/(["'])\.\/align\1/g, '"./align.mjs"');
  writeFileSync(join(out, "normalize.mjs"), normalize);
  writeFileSync(join(out, "lev.mjs"), lev);
  writeFileSync(join(out, "align.mjs"), align);
  writeFileSync(join(out, "acousticReconcile.mjs"), acoustic);
  const alignMod = await import(pathToFileURL(join(out, "align.mjs")).href);
  const acousticMod = await import(
    pathToFileURL(join(out, "acousticReconcile.mjs")).href
  );
  return Object.assign({}, alignMod, {
    acousticReconcile: acousticMod.acousticReconcile,
    MIN_WORD_GAP_SEC: acousticMod.MIN_WORD_GAP_SEC,
  });
}

// --- assertions ---

let failures = 0;
function check(name, cond, detail = "") {
  const ok = !!cond;
  if (!ok) failures += 1;
  console.log(`${ok ? "\u2713" : "\u2717"} ${name}${ok || !detail ? "" : `  — ${detail}`}`);
}

function missedAt(result, expectedIndex) {
  return result.mistakes.find(
    (m) => m.kind === "missed" && m.expectedIndex === expectedIndex
  );
}

function runUnitCases(A) {
  const { scanPrefixMatchAtCursor, scanPrefixMatch, isSubstitutionCandidate } = A;

  // Real swaps from the seeded log — leading-skip branch, candidate = token
  // immediately before the next-word anchor.
  const swaps = [
    {
      idx: 48,
      label: "فالثان→فَالْأَوَّلُ",
      expected: ["فَالْأَوَّلُ", "الْإِظْهَارُ", "قَبْلَ", "أَحْرُفِ"],
      recognized: ["فالثان", "الاظهار", "قبل"],
      candidate: "فالثان",
      passed: ["تَبْيِينِي", "قَبْلَ"],
    },
    {
      idx: 65,
      label: "والثالث→وَالثَّانِي",
      expected: ["وَالثَّانِي", "إِدْغَامٌ", "بِسِتَّةٍ"],
      recognized: ["والثالث", "ادغام"],
      candidate: "والثالث",
      passed: ["خَاءُ", "ثُمَّ"],
    },
    {
      idx: 85,
      label: "بحرف→بِكَلِمَةٍ",
      expected: ["بِكَلِمَةٍ", "فَلَا", "تُدْغِمْ", "كَدُنْيَا"],
      recognized: ["اذا", "كانا", "بحرف", "فلا"],
      candidate: "بحرف",
      passed: ["كَانَا", "إِذَا"],
    },
  ];

  for (const s of swaps) {
    const r = scanPrefixMatchAtCursor(s.expected, s.recognized);
    const m = missedAt(r, 0);
    check(
      `swap #${s.idx} (${s.label}): surfaces candidate "${s.candidate}"`,
      m && m.recognizedWord === s.candidate,
      `got ${m ? JSON.stringify(m.recognizedWord) : "no missed@0"}`
    );
    check(
      `swap #${s.idx}: classified as substitution (not echo of passed word)`,
      m && isSubstitutionCandidate(m.recognizedWord, s.passed) === true
    );
  }

  // Clean ASR drops — next word at head of tail, no preceding token.
  const drops = [
    { label: "ومن (drop وَآلِهِ)", expected: ["وَآلِهِ", "وَمَنْ", "تَلَا"], recognized: ["ومن"] },
    {
      label: "والاجر (drop الطُّلَّابَا)",
      expected: ["الطُّلَّابَا", "وَالْأَجْرَ", "وَالْقَبُولَ"],
      recognized: ["والاجر", "والاجر", "وال"],
    },
  ];
  for (const d of drops) {
    const r = scanPrefixMatchAtCursor(d.expected, d.recognized);
    const m = missedAt(r, 0);
    check(
      `drop ${d.label}: stays omission (recognizedWord === null)`,
      m && m.recognizedWord === null,
      `got ${m ? JSON.stringify(m.recognizedWord) : "no missed@0"}`
    );
  }

  // Echo guard: a candidate that equals a recently-passed word is NOT a swap.
  check(
    "echo guard: previous correct word is not a substitution",
    A.isSubstitutionCandidate("والثاني", ["وَالثَّانِي", "خَاءُ"]) === false
  );
  check(
    "echo guard: genuinely different word is a substitution",
    A.isSubstitutionCandidate("والثالث", ["وَالثَّانِي", "خَاءُ"]) === true
  );

  // Tanween: مِيمًا (normalized ميما) must match ASR's nunated ميمن so it is a
  // real match, not a drop or a false substitution.
  check(
    "tanween: ميمن matches مِيمًا (nunation)",
    A.wordMatch("ميمن", "مِيمًا") === true
  );
  check(
    "tanween guard: من does not match عن (short words untouched)",
    A.wordMatch("من", "عن") === false
  );

  // Levenshtein layer (align-trust-v5): bounded edit distance catches ASR
  // garbles the hand-tuned variants miss, without swallowing real swaps.
  check(
    "lev: الطلاب matches الطُّلَّابَا (rhyme alif clipped)",
    A.wordMatch("الطلاب", "الطُّلَّابَا") === true
  );
  check(
    "lev: طوقا matches تُقًى (emphatic ط/ت + final-alif variance)",
    A.wordMatch("طوقا", "تُقًى") === true
  );
  check(
    "lev merged-token: صيفثانا matches ثَنَا (ASR merged صِفْ ذَا ثَنَا)",
    A.wordMatch("صيفثانا", "ثَنَا") === true
  );
  check(
    "lev guard: والثالث does NOT match وَالثَّانِي (real swap, ratio 0.714)",
    A.wordMatch("والثالث", "وَالثَّانِي") === false
  );
  check(
    "lev guard: فالثان does NOT match فَالْأَوَّلُ (real swap)",
    A.wordMatch("فالثان", "فَالْأَوَّلُ") === false
  );
  check(
    "lev guard: بحرف does NOT match بِكَلِمَةٍ (real swap)",
    A.wordMatch("بحرف", "بِكَلِمَةٍ") === false
  );
  check(
    "lev guard: المظلوم does NOT match النَّظْمُ (garble too far — reconcile's job)",
    A.wordMatch("المظلوم", "النَّظْمُ") === false
  );

  // Transposition: ASR metathesis (الحروف ↔ الحورف) is a match, not a wrong red.
  check(
    "transposition: الحورف matches الْحُرُوفِ (ASR metathesis)",
    A.wordMatch("الحورف", "الْحُرُوفِ") === true
  );
  check(
    "transposition guard: ضرب does not match رضب (too short / not adjacent)",
    A.wordMatch("ضرب", "رضب") === false
  );
  check(
    "transposition guard: distinct words كتب / بتك do not match",
    A.wordMatch("كتب", "بتك") === false
  );

  // Threshold-creep guard: no matn word may fuzzy-match its neighbour. If the
  // lev layer ever loosens enough to merge adjacent words, recitation errors
  // become invisible. Whitelist pairs that are legitimately the same word.
  const matnWords = loadMatnWords();
  // Pre-existing collisions from the v4 prefix rule (tanween-stripped قسما
  // startsWith قسم; clitic-stripped كلمه startsWith كل). Kept: changing the
  // prefix rule risks recall regressions; the lev layer must not add new ones.
  const adjacentWhitelist = new Set([
    "قِسْمَانِ|قِسْمٌ",
    "كُلٌّ|بِكَلِمَةٍ",
    // stripLeadingAlef(اصلا) === stripCliticPrefix(وصلا) === صلا (exact pass).
    "أُصِّلَا|وَصْلًا",
  ]);
  let adjacentCollisions = 0;
  for (let i = 0; i + 1 < matnWords.length; i++) {
    const a = matnWords[i];
    const b = matnWords[i + 1];
    if (adjacentWhitelist.has(`${a}|${b}`)) continue;
    if (A.wordMatch(a, b) || A.wordMatch(b, a)) {
      adjacentCollisions += 1;
      console.log(`    adjacent collision: "${a}" ↔ "${b}" (#${i}/#${i + 1})`);
    }
  }
  check(
    `adjacent-word sweep: 0 collisions across ${matnWords.length - 1} matn pairs`,
    adjacentCollisions === 0,
    `${adjacentCollisions} collision(s)`
  );

  // Regression: candidate enrichment must not change cursor advancement.
  const reg = scanPrefixMatch(
    ["فَالْأَوَّلُ", "الْإِظْهَارُ", "قَبْلَ"],
    ["فالثان", "الاظهار", "قبل"]
  );
  check(
    "regression: matchedThrough unchanged (skip-one then match)",
    reg.matchedThrough === 3,
    `got ${reg.matchedThrough}`
  );
}

// --- acoustic reconcile: timing separates omission / drop / substitution ---

function w(word, start, end, confidence = 0.95) {
  return { word, start, end, confidence };
}

function runAcousticCases(A) {
  const { acousticReconcile } = A;
  if (typeof acousticReconcile !== "function") {
    check("acousticReconcile exported", false, "module missing");
    return;
  }
  const matn = ["الف", "باء", "تاء", "ثاء", "جيم"];

  // 1. Clean pass — every word heard in order, no mistakes.
  const clean = acousticReconcile(matn, [
    w("الف", 0.0, 0.3),
    w("باء", 0.3, 0.6),
    w("تاء", 0.6, 0.9),
    w("ثاء", 0.9, 1.2),
    w("جيم", 1.2, 1.5),
  ]);
  check(
    "acoustic clean: 0 mistakes, 0 drops, all matched",
    clean.mistakes.length === 0 && clean.drops.length === 0 && clean.matched === 5,
    JSON.stringify({ m: clean.mistakes.length, d: clean.drops.length, a: clean.matched })
  );

  // 2. Human omission — تاء never spoken; باء→ثاء are adjacent in time.
  const omit = acousticReconcile(matn, [
    w("الف", 0.0, 0.3),
    w("باء", 0.3, 0.6),
    w("ثاء", 0.6, 0.9),
    w("جيم", 0.9, 1.2),
  ]);
  const omitMiss = omit.mistakes.find((m) => m.expectedWord === "تاء");
  check(
    "acoustic omission: تاء flagged as omission (no time gap)",
    omitMiss && omitMiss.kind === "missed" && omitMiss.cause === "omission" && omit.drops.length === 0,
    JSON.stringify(omitMiss)
  );

  // 3. ASR drop — reciter said تاء (0.6s of audio) but recognizer never emitted it.
  const drop = acousticReconcile(matn, [
    w("الف", 0.0, 0.3),
    w("باء", 0.3, 0.6),
    w("ثاء", 1.2, 1.5),
    w("جيم", 1.5, 1.8),
  ]);
  const dropEntry = drop.drops.find((m) => m.expectedWord === "تاء");
  check(
    "acoustic drop: تاء suppressed as asrDrop (audio gap present)",
    dropEntry && dropEntry.cause === "asrDrop" &&
      drop.mistakes.find((m) => m.expectedWord === "تاء") === undefined,
    JSON.stringify({ drops: drop.drops.map((d) => d.expectedWord), mistakes: drop.mistakes.map((m) => m.expectedWord) })
  );

  // 4. Substitution — a wrong word sits in تاء's slot.
  const sub = acousticReconcile(matn, [
    w("الف", 0.0, 0.3),
    w("باء", 0.3, 0.6),
    w("زاي", 0.6, 0.9, 0.88),
    w("ثاء", 0.9, 1.2),
    w("جيم", 1.2, 1.5),
  ]);
  const subMiss = sub.mistakes.find((m) => m.expectedWord === "تاء");
  check(
    "acoustic substitution: تاء→زاي flagged wrong with token + confidence",
    subMiss && subMiss.kind === "wrong" && subMiss.cause === "substitution" &&
      subMiss.recognizedWord === "زاي" && subMiss.confidence === 0.88,
    JSON.stringify(subMiss)
  );
}

// --- log sweep: replay every recorded mistake through the real aligner ---

function splitPreview(s) {
  if (typeof s !== "string") return [];
  return s
    .split(/\s*\u00B7\s*/)
    .map((t) => t.trim())
    .filter((t) => t && !t.includes("\u2026") && !t.startsWith("(+"));
}

function loadMatnWords() {
  const matn = JSON.parse(
    readFileSync(join(root, "content", "mutoon", "tuhfat_al_atfal.json"), "utf8")
  );
  return matn.sections.flatMap((s) => s.lines).flatMap((l) => l.words);
}

/** Merge a tail-overlapping token chunk into the running stream (ASR previews are cumulative tails). */
function mergeTokens(acc, tokens) {
  if (!acc.length) return [...tokens];
  const max = Math.min(acc.length, tokens.length);
  for (let k = max; k > 0; k--) {
    let ok = true;
    for (let i = 0; i < k; i++) {
      if (acc[acc.length - k + i] !== tokens[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return acc.concat(tokens.slice(k));
  }
  return acc.concat(tokens);
}

/** Reconstruct an approximate full heard stream from align.result preview tails. */
function reconstructHeard(events) {
  let acc = [];
  for (const ev of events) {
    if (ev.name !== "align.result") continue;
    acc = mergeTokens(acc, splitPreview(ev.data.recognized));
  }
  return acc;
}

function parseEvents(text) {
  const RE = /^\[MutoonRecite\]\s+(?:#(\d+)\s+)?(.*?)\s+(\{.*\})\s*$/;
  const events = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const m = line.match(RE);
    if (!m) continue;
    try {
      events.push({ name: m[2].trim(), data: JSON.parse(m[3]) });
    } catch {
      /* skip */
    }
  }
  return events;
}

function sweepLog(A, logFile, labelsFile) {
  const { scanPrefixMatchAtCursor, isSubstitutionCandidate } = A;
  const matnWords = loadMatnWords();
  const events = parseEvents(readFileSync(logFile, "utf8"));
  const labels = labelsFile && existsSync(labelsFile)
    ? JSON.parse(readFileSync(labelsFile, "utf8"))
    : null;
  const swapIdx = new Set(
    (labels?.intentional ?? []).filter((e) => e.kind === "swap").map((e) => e.globalWordIndex)
  );

  const intentionalIdx = new Set((labels?.intentional ?? []).map((e) => e.globalWordIndex));
  // Rolling-reconcile simulation (RECONCILE_ON_FINAL): a red painted from an
  // interim is cleared when the closing final of the segment emits a token
  // that matches the expected word (the timeline the engine reconciles against
  // is built from finals). v3 logs lack heardTimeline, so approximate with the
  // next isFinal align.result's recognized stream.
  const nextFinalTokens = (fromIdx) => {
    for (let i = fromIdx + 1; i < events.length; i++) {
      const ev = events[i];
      if (ev.name === "align.result" && ev.data.isFinal === true) {
        return splitPreview(ev.data.recognized);
      }
    }
    return [];
  };
  let wordCursor = null;
  let lastAlign = null;
  const rows = [];
  for (let evIdx = 0; evIdx < events.length; evIdx++) {
    const ev = events[evIdx];
    if (ev.name === "align.result") lastAlign = ev.data;
    if (ev.name === "listen.stop") wordCursor = ev.data.wordCursor ?? wordCursor;
    if (ev.name !== "WARN mistake" || !lastAlign) continue;
    const gi = ev.data.globalWordIndex;
    const anchor = lastAlign.anchor;
    if (gi == null || anchor == null || gi < anchor) continue;
    const expected = splitPreview(lastAlign.expectedFromAnchor);
    const recognized = splitPreview(lastAlign.recognized);
    if (!expected.length || !recognized.length) continue;
    const r = scanPrefixMatchAtCursor(expected, recognized);
    const m = missedAt(r, gi - anchor);
    const candidate = m ? m.recognizedWord : null;
    const passed = [matnWords[gi - 1], matnWords[gi - 2]];
    const isSub = isSubstitutionCandidate(candidate, passed);
    const finalClears =
      isSub && nextFinalTokens(evIdx).some((t) => A.wordMatch(t, ev.data.expected));
    rows.push({
      gi,
      expected: ev.data.expected,
      candidate,
      isSub,
      finalClears,
      labeledSwap: swapIdx.has(gi),
    });
  }

  // Presence probe: reconstruct the full heard stream and ask, for each labeled
  // word, whether ASR produced it *anywhere*. This is the ceiling for a global
  // reconcile pass: a false drop whose word IS present can be recovered to a
  // match; a real omission whose word is ABSENT is correctly a miss. Words ASR
  // never emitted at all can only be rescued by the recorded audio.
  const heard = reconstructHeard(events);
  const present = (w) => (w ? heard.some((t) => A.wordMatch(t, w)) : false);
  if (labels) {
    console.log(`\npresence probe (reconstructed heard stream: ${heard.length} tokens):`);
    const fmt = (e, tag) =>
      `    ${tag} #${e.globalWordIndex} ${e.expected}: ${present(e.expected) ? "PRESENT \u2192 recoverable" : "ABSENT \u2192 needs audio"}`;
    for (const e of labels.intentional ?? []) console.log(fmt(e, e.kind === "swap" ? "swap " : "omit "));
    for (const e of labels.notIntentional ?? []) console.log(fmt(e, "false"));
  }

  const subs = rows.filter((r) => r.isSub && !r.finalClears);
  const cleared = rows.filter((r) => r.isSub && r.finalClears);
  console.log(`\nsweep ${basename(logFile)} — replayed ${rows.length} recorded misses through real align.ts`);
  console.log(`  v5 substitutions detected: ${subs.length} (+${cleared.length} cleared by final reconcile)`);
  for (const s of subs) {
    const verdict = s.labeledSwap ? "labeled swap \u2713" : "NOT labeled swap \u26a0";
    console.log(`    #${s.gi} ${s.expected}  heard="${s.candidate}"  (${verdict})`);
  }
  for (const s of cleared) {
    const note = s.labeledSwap ? "labeled swap CLEARED ⚠" : "interim garble";
    console.log(`    #${s.gi} ${s.expected}  heard="${s.candidate}"  cleared on final (${note})`);
  }
  if (labels) {
    const detectedSwaps = subs.filter((s) => s.labeledSwap).length;
    const falseSubs = subs.filter((s) => !s.labeledSwap).length;
    const clearedSwaps = cleared.filter((s) => s.labeledSwap).length;
    if (clearedSwaps > 0) {
      console.log(`  [gate] final reconcile cleared ${clearedSwaps} REAL swap(s)`);
      failures += 1;
    }
    console.log(`  labeled swaps caught as substitution: ${detectedSwaps}/${swapIdx.size}`);
    console.log(`  false substitutions (would be wrong reds on a non-swap): ${falseSubs}`);
    const maxFalse = numFlag(process.argv, "--max-false-subs", null);
    if (maxFalse != null && falseSubs > maxFalse) {
      console.log(`  [gate] false substitutions ${falseSubs} > ${maxFalse}`);
      failures += 1;
    }

    // Projected v4 live policy: reds = substitutions only (omissions suppressed).
    const reds = subs.map((s) => s.gi);
    const tp = reds.filter((gi) => intentionalIdx.has(gi)).length;
    const fp = reds.length - tp;
    const fn = intentionalIdx.size - reds.filter((gi) => intentionalIdx.has(gi)).length;
    const precision = tp + fp > 0 ? (tp / (tp + fp)) * 100 : 100;
    const recall = tp + fn > 0 ? (tp / (tp + fn)) * 100 : 100;
    const matchPct = wordCursor ? ((wordCursor - reds.length) / wordCursor) * 100 : null;
    console.log(`\n  projected v4 (suppress omissions, paint substitutions):`);
    console.log(`    live reds  : ${reds.length}  (v3 painted ${rows.length})`);
    console.log(
      `    match %    : ${matchPct == null ? "?" : matchPct.toFixed(1) + "%"}  (v3 ${
        wordCursor ? (((wordCursor - rows.length) / wordCursor) * 100).toFixed(1) + "%" : "?"
      })`
    );
    console.log(`    precision  : ${precision.toFixed(1)}%   recall (live): ${recall.toFixed(1)}%`);
  }
}

function lastTimeline(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].name === "session.heardTimeline") return events[i].data;
  }
  return null;
}

function recordedReds(events) {
  const reds = [];
  for (const ev of events) {
    if (ev.name !== "WARN mistake") continue;
    reds.push({
      gi: ev.data.globalWordIndex,
      expected: ev.data.expected,
      heard: ev.data.recognized ?? null,
      kind: ev.data.kind,
    });
  }
  return reds;
}

/** Run the real acousticReconcile against a v4 log's heardTimeline. */
function reconcileLog(A, logFile, labelsFile) {
  const events = parseEvents(readFileSync(logFile, "utf8"));
  const tl = lastTimeline(events);
  if (!tl || !Array.isArray(tl.words)) {
    console.log("\n(no heardTimeline in this log — older build, skipping reconcile)");
    return;
  }
  const matnWords = loadMatnWords();
  const stop = lastEventData(events, "listen.stop");
  const hs = lastEventData(events, "session.heardStream");
  const wordCursor = hs?.wordCursor ?? stop?.wordCursor ?? matnWords.length;
  const timeline = tl.words.map((x) => ({
    word: x.w,
    start: x.t0,
    end: x.t1,
    confidence: x.c,
  }));
  const minGap = numFlag(process.argv, "--min-gap", undefined);
  const res = A.acousticReconcile(matnWords.slice(0, wordCursor), timeline, undefined, minGap);

  const labels = labelsFile && existsSync(labelsFile)
    ? JSON.parse(readFileSync(labelsFile, "utf8"))
    : null;
  const intentionalIdx = new Set((labels?.intentional ?? []).map((e) => e.globalWordIndex));

  console.log(`\n=== acoustic reconcile (real heardTimeline: ${timeline.length} words, cursor ${wordCursor}) ===`);
  console.log(`  minWordGapSec : ${minGap ?? A.MIN_WORD_GAP_SEC}`);
  console.log(`  matched       : ${res.matched}/${wordCursor}`);
  console.log(`  human reds    : ${res.mistakes.length} (omission + substitution)`);
  console.log(`  asr drops     : ${res.drops.length} (suppressed — audio covered the word)`);

  const sub = res.mistakes.filter((m) => m.cause === "substitution");
  const omit = res.mistakes.filter((m) => m.cause === "omission");
  const fmt = (m) =>
    `    #${m.expectedIndex} ${m.expectedWord}  ${m.cause}${
      m.recognizedWord ? ` heard="${m.recognizedWord}" c=${m.confidence}` : ""
    }  gap=${m.gapSec.toFixed(2)}s${labels ? (intentionalIdx.has(m.expectedIndex) ? "  [labeled ✓]" : "  [NOT labeled ⚠]") : ""}`;
  console.log(`  substitutions (${sub.length}):`);
  for (const m of sub) console.log(fmt(m));
  console.log(`  omissions (${omit.length}):`);
  for (const m of omit) console.log(fmt(m));

  // Compare to what the live pass actually painted.
  const live = recordedReds(events);
  console.log(`\n  live pass painted ${live.length} reds:`);
  const acousticByIdx = new Map(res.mistakes.map((m) => [m.expectedIndex, m]));
  const dropByIdx = new Map(res.drops.map((m) => [m.expectedIndex, m]));
  for (const r of live) {
    const a = acousticByIdx.get(r.gi);
    const d = dropByIdx.get(r.gi);
    const verdict = a
      ? `acoustic AGREES (${a.cause})`
      : d
        ? `acoustic CLEARS (asrDrop, gap=${d.gapSec.toFixed(2)}s)`
        : `acoustic MATCHES it (no red)`;
    console.log(`    #${r.gi} ${r.expected} heard="${r.heard}" → ${verdict}`);
  }
}

function lastEventData(events, name) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].name === name) return events[i].data;
  }
  return null;
}

function numFlag(args, name, def) {
  const a = args.find((x) => x.startsWith(name + "="));
  if (!a) return def;
  const v = Number(a.slice(name.length + 1));
  return Number.isFinite(v) ? v : def;
}

async function main() {
  const A = await loadRealAlign();
  console.log("# real align.ts substitution detection\n");
  runUnitCases(A);
  console.log("\n# acoustic reconcile (timing-arbitrated)\n");
  runAcousticCases(A);

  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));
  const logFile = positional[0];
  if (logFile) {
    const labelsFile = positional[1] ?? null;
    sweepLog(A, logFile, labelsFile);
    reconcileLog(A, logFile, labelsFile);
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
