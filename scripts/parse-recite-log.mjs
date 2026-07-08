/**
 * Recite log grader (RAI-204).
 *
 * Parses a Share log produced by the Recite engine and prints the headline
 * numbers a reviewer cares about — build stamp, words, mistakes, UI match %,
 * and how many mistakes the align-trust policy already suppressed — plus a
 * per-mistake classification used to answer the only question that matters for
 * the ≥90% beta gate: *is each recorded mistake backed by evidence of a human
 * error, or is it a system (ASR/alignment) artifact?*
 *
 * The decisive signal is `recognized`: a committed mistake with
 * `recognized: null` means the cursor stepped past a word because the *next*
 * word was recognized — the engine never heard a competing token, so there is
 * no positive evidence the reciter erred (overwhelmingly an ASR drop). A
 * mistake with a non-null `recognized` is a substitution: the reciter (or ASR)
 * produced a different word at that slot — the only shape that can be a real
 * human error.
 *
 * Usage:
 *   node scripts/parse-recite-log.mjs <log-file> [--min-match=90] [--expect-build=align-trust-v3]
 *   npm --prefix app run recite:parse -- <log-file>
 *
 * Exit code is non-zero when --min-match or --expect-build is violated, so this
 * doubles as a CI regression check against a checked-in golden log.
 */

import { readFileSync, existsSync } from "fs";
import { dirname, join, basename } from "path";

// --- Normalization + fuzzy match (mirrors app/src/lib/asr/align.ts) ---

const DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const MIN_FUZZY_LENGTH = 3;
const MIN_FUZZY_SHORT = 2;

function normalize(text) {
  return text
    .replace(/\u0640/g, "")
    .replace(DIACRITICS, "")
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/[\u0624\u0626]/g, "\u0621")
    .replace(/\u0629/g, "\u0647")
    .replace(/[^\u0600-\u06FF\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripAl(word) {
  return word.startsWith("\u0627\u0644") ? word.slice(2) : word;
}

function variants(word) {
  const n = normalize(word);
  const ha = n.endsWith("\u0647\u0627") && n.length > 3 ? n.slice(0, -2) : n;
  const ya = n.endsWith("\u064A") && n.length > 2 ? n.slice(0, -1) : n;
  const noAlef = n.startsWith("\u0627") && n.length > 2 ? n.slice(1) : n;
  return [...new Set([n, stripAl(n), ha, ya, noAlef])];
}

// align-trust-v5 layer (best-effort mirror of app/src/lib/asr/lev.ts —
// scripts/recite-align-test.mjs exercises the real code and is authoritative).
const LEV_RATIO = 0.75;

function charLev(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function isOrderedSubsequence(shorter, longer) {
  let i = 0;
  for (let j = 0; j < longer.length && i < shorter.length; j++) {
    if (longer[j] === shorter[i]) i += 1;
  }
  return i === shorter.length;
}

function phoneticCollapse(word) {
  let out = word
    .replace(/ط/g, "ت")
    .replace(/ظ/g, "ذ")
    .replace(/ض/g, "د")
    .replace(/ص/g, "س");
  if (out.length > 2 && out.endsWith("ا")) out = out.slice(0, -1) + "ي";
  return out;
}

function indelOnlyAccept(x, y) {
  const shorter = x.length <= y.length ? x : y;
  const longer = x.length <= y.length ? y : x;
  const gap = longer.length - shorter.length;
  if (gap === 0 || gap > 2) return false;
  if (1 - gap / longer.length < LEV_RATIO) return false;
  return isOrderedSubsequence(shorter, longer);
}

function levAccept(x, y) {
  if (Math.min(x.length, y.length) < MIN_FUZZY_LENGTH) return false;
  if (indelOnlyAccept(x, y)) return true;
  const px = phoneticCollapse(x);
  const py = phoneticCollapse(y);
  if (px === x && py === y) return false;
  if (px === py) return true;
  return indelOnlyAccept(px, py);
}

function mergedTokenTailMatch(heard, expected) {
  // Exact suffix or epenthetic-vowel-stretched suffix only (see align.ts).
  if (expected.length < MIN_FUZZY_LENGTH) return false;
  if (heard.length - expected.length < 2) return false;
  if (heard.endsWith(expected)) return true;
  const suffix = heard.slice(-(expected.length + 1));
  return isOrderedSubsequence(expected, suffix);
}

function wordMatch(a, b) {
  const va = variants(a);
  const vb = variants(b);
  for (const x of va) for (const y of vb) if (x === y) return true;
  for (const x of va) {
    for (const y of vb) {
      const shorter = x.length <= y.length ? x : y;
      const longer = x.length <= y.length ? y : x;
      if (shorter.length < MIN_FUZZY_SHORT || longer.length < MIN_FUZZY_LENGTH) continue;
      if (longer.length - shorter.length > 2) continue;
      if (longer.startsWith(shorter)) return true;
    }
  }
  const na = normalize(a);
  const nb = normalize(b);
  if (levAccept(na, nb)) return true;
  if (mergedTokenTailMatch(na, nb)) return true;
  return false;
}

// --- Log parsing ---

const LINE_RE = /^\[MutoonRecite\]\s+(?:#(\d+)\s+)?(.*?)\s+(\{.*\})\s*$/;

function parseLog(text) {
  const lines = text.split(/\r?\n/);
  const events = [];
  const header = { buildTag: null, build: null, meta: null };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;

    if (line.startsWith("#")) {
      const tag = line.match(/MUTOON_RECITE_BUILD=([A-Za-z0-9._-]+)/);
      if (tag && !header.buildTag) header.buildTag = `MUTOON_RECITE_BUILD=${tag[1]}`;
      const build = line.match(/^#\s*build:\s*(\{.*\})\s*$/);
      if (build) header.build = safeJson(build[1]);
      const meta = line.match(/^#\s*meta:\s*(\{.*\})\s*$/);
      if (meta) header.meta = safeJson(meta[1]);
      continue;
    }

    const m = line.match(LINE_RE);
    if (!m) continue;
    const seq = m[1] != null ? Number(m[1]) : null;
    const name = m[2].trim();
    const data = safeJson(m[3]);
    if (!data) continue;
    events.push({ seq, name, data });
  }

  return { header, events };
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// --- Grading ---

function lastEvent(events, name) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].name === name) return events[i];
  }
  return null;
}

/** Recognized token list from an align.result preview ("a · b · c"). */
function recognizedTokens(ev) {
  const r = ev?.data?.recognized;
  if (typeof r !== "string") return [];
  return r
    .split("\u00B7")
    .map((t) => normalize(t))
    .filter(Boolean);
}

/**
 * Best-effort: did the engine hear a fuzzy match for `expected` anywhere near
 * the mistake? If yes the word was misrecognized (a "near-variant" the aligner
 * could potentially rescue); if no, the ASR never produced it (a clean drop).
 */
function classifyMissCause(events, mistakeIdx, expectedWord) {
  const exp = normalize(expectedWord);
  let triggerRecognized = [];
  const WINDOW = 4;
  for (let i = mistakeIdx - 1, seen = 0; i >= 0 && seen < WINDOW; i--) {
    if (events[i].name !== "align.result") continue;
    seen += 1;
    const toks = recognizedTokens(events[i]);
    if (i === firstAlignBefore(events, mistakeIdx)) triggerRecognized = toks.slice(-4);
    for (const t of toks) {
      if (wordMatch(t, exp)) return { cause: "near-variant", triggerRecognized: toks.slice(-4) };
    }
  }
  return { cause: "drop", triggerRecognized };
}

function firstAlignBefore(events, idx) {
  for (let i = idx - 1; i >= 0; i--) {
    if (events[i].name === "align.result") return i;
  }
  return -1;
}

/** Find a `<timestampZ>_labels.json` next to the log if --labels was not given. */
function autoLabelsPath(logFile) {
  const m = basename(logFile).match(/^(.*?Z)_/);
  if (!m) return null;
  const guess = join(dirname(logFile), `${m[1]}_labels.json`);
  return existsSync(guess) ? guess : null;
}

/**
 * Score recorded mistakes against reciter ground truth.
 *   TP = intentional error that the engine recorded
 *   FN = intentional error the engine missed
 *   FP = recorded mistake that was NOT an intentional error (system artifact)
 * Precision answers the beta question: of the reds we showed, how many were real?
 */
function scoreAgainstLabels(labels, recordedByIndex) {
  const intentional = labels.intentional ?? [];
  const intentionalIdx = new Set(intentional.map((e) => e.globalWordIndex));

  const tp = [];
  const fn = [];
  for (const e of intentional) {
    (recordedByIndex.has(e.globalWordIndex) ? tp : fn).push(e);
  }
  const fp = [];
  for (const [idx, rec] of recordedByIndex) {
    if (!intentionalIdx.has(idx)) fp.push({ globalWordIndex: idx, ...rec });
  }

  const precision = tp.length + fp.length > 0 ? tp.length / (tp.length + fp.length) : 1;
  const recall = tp.length + fn.length > 0 ? tp.length / (tp.length + fn.length) : 1;
  return { tp, fn, fp, precision, recall };
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const minMatch = numFlag(args, "--min-match", null);
  const minPrecision = numFlag(args, "--min-precision", null);
  const expectBuild = strFlag(args, "--expect-build", null);
  const labelsFlag = strFlag(args, "--labels", null);

  if (!file) {
    console.error("usage: node scripts/parse-recite-log.mjs <log-file> [--min-match=90] [--expect-build=align-trust-v3]");
    process.exit(2);
  }
  if (!existsSync(file)) {
    console.error(`No such log: ${file}`);
    process.exit(2);
  }

  const { header, events } = parseLog(readFileSync(file, "utf8"));
  const stop = lastEvent(events, "listen.stop");
  const mistakeEvents = events
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.name === "WARN mistake");
  const ignored = events.filter((e) => e.name === "cursor.skipAheadMissesIgnored");

  const wordCursor = stop?.data?.wordCursor ?? null;
  const totalWords = stop?.data?.totalWords ?? header.meta?.totalWords ?? null;
  const mistakes = stop?.data?.mistakes ?? mistakeEvents.length;
  const matchPct =
    wordCursor && wordCursor > 0
      ? Math.max(0, Math.min(100, ((wordCursor - mistakes) / wordCursor) * 100))
      : null;

  const ignoredWords = ignored.reduce((s, e) => s + (e.data?.count ?? 0), 0);
  const heardStream = lastEvent(events, "session.heardStream");

  const buildTag =
    header.buildTag ?? (header.build?.tag ? header.build.tag : null);
  const maxSkip =
    header.build?.maxSkipMissesPerStep ?? lastEvent(events, "listen.start")?.data?.maxSkipMissesPerStep ?? "?";
  const appVersion = header.build?.appVersion ?? "?";

  console.log(`# Recite log: ${file}`);
  console.log(`build stamp : ${buildTag ?? "(none — STALE JS / no stamp)"}  (maxSkipMissesPerStep=${maxSkip}, app ${appVersion})`);
  console.log(`result      : ${wordCursor ?? "?"} words, ${mistakes} mistakes, ${totalWords ?? "?"} total`);
  console.log(
    `match %     : ${matchPct == null ? "?" : matchPct.toFixed(1) + "%"}${
      minMatch != null && matchPct != null
        ? matchPct + 1e-9 >= minMatch
          ? `   [PASS ≥${minMatch}%]`
          : `   [FAIL <${minMatch}%]`
        : ""
    }`
  );
  console.log(`skip ignored: ${ignored.length} events, ${ignoredWords} words suppressed by align-trust`);
  const omissionPolicy = header.build?.omissionPolicy;
  if (omissionPolicy || header.build?.substitutionDetection != null) {
    console.log(
      `policy      : omissions=${omissionPolicy ?? "?"}, substitutionDetection=${header.build?.substitutionDetection ?? "?"}`
    );
  }
  if (heardStream) {
    console.log(`heard stream: ${heardStream.data?.count ?? "?"} tokens logged (reconcile-ready)`);
  }
  const reconciled = lastEvent(events, "session.reconciled");
  if (reconciled) {
    const d = reconciled.data ?? {};
    console.log(
      `reconciled  : live ${d.live ?? "?"} → ${d.reconciled ?? "?"} reds (authoritative), ${d.asrDropsSuppressed ?? "?"} ASR drops suppressed, ${d.matched ?? "?"} anchored`
    );
    for (const m of d.mistakes ?? []) {
      console.log(
        `              #${m.i} ${m.expected ?? "?"} [${m.kind}]${m.heard ? ` heard="${m.heard}"` : ""}`
      );
    }
  }

  // Mistake breakdown.
  const byKind = {};
  let withToken = 0;
  let committed = 0;
  for (const { e } of mistakeEvents) {
    const k = e.data?.kind ?? "?";
    byKind[k] = (byKind[k] ?? 0) + 1;
    if (e.data?.recognized != null) withToken += 1;
    if (e.data?.partial === false) committed += 1;
  }

  console.log(`\nrecorded mistakes (${mistakeEvents.length}):`);
  console.log(`  by kind     : ${Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join(", ") || "(none)"}`);
  console.log(`  with heard token (recognized != null) : ${withToken}`);
  console.log(`  no heard token  (recognized == null)  : ${mistakeEvents.length - withToken}`);
  console.log(`  committed (partial=false) : ${committed}`);

  if (mistakeEvents.length) {
    console.log(`\nper-mistake:`);
    console.log(`  ${pad("idx", 6)}${pad("expected", 16)}${pad("kind", 8)}${pad("heard", 10)}${pad("class", 13)}near-heard`);
    for (const { e, i } of mistakeEvents) {
      const expected = e.data?.expected ?? "?";
      const heard = e.data?.recognized == null ? "—" : String(e.data.recognized);
      const cls =
        e.data?.recognized != null
          ? "substitution"
          : classifyMissCause(events, i, expected).cause;
      const near =
        e.data?.recognized != null
          ? ""
          : classifyMissCause(events, i, expected).triggerRecognized.join(" ");
      console.log(
        `  ${pad("#" + (e.data?.globalWordIndex ?? "?"), 6)}${pad(expected, 16)}${pad(e.data?.kind ?? "?", 8)}${pad(heard, 10)}${pad(cls, 13)}${near}`
      );
    }
  }

  // Verdict: how many mistakes are backed by evidence of a human error.
  const humanEvidence = withToken; // only substitutions can be real human errors
  console.log(`\nverdict     : ${humanEvidence}/${mistakeEvents.length} recorded mistakes have a competing heard token (possible human error).`);
  console.log(`              ${mistakeEvents.length - humanEvidence}/${mistakeEvents.length} are skip-ahead drops with no heard token (system / ASR artifact).`);
  if (mistakeEvents.length > 0 && humanEvidence === 0) {
    console.log(`              → no positive evidence of any human error in this session.`);
  }

  // Score against reciter ground truth (precision/recall), if labels exist.
  const labelsPath = labelsFlag ?? autoLabelsPath(file);
  let score = null;
  if (labelsPath && existsSync(labelsPath)) {
    const labels = safeJson(readFileSync(labelsPath, "utf8"));
    if (labels) {
      const recordedByIndex = new Map();
      for (const { e } of mistakeEvents) {
        const gi = e.data?.globalWordIndex;
        if (gi == null) continue;
        recordedByIndex.set(gi, {
          kind: e.data?.kind ?? "?",
          expected: e.data?.expected ?? "?",
          recognized: e.data?.recognized ?? null,
        });
      }
      score = scoreAgainstLabels(labels, recordedByIndex);
      console.log(`\nground truth: ${labelsPath} (${labels.session ?? "?"})`);
      console.log(
        `  precision : ${(score.precision * 100).toFixed(1)}%  (${score.tp.length} real / ${
          score.tp.length + score.fp.length
        } shown)`
      );
      console.log(
        `  recall    : ${(score.recall * 100).toFixed(1)}%  (${score.tp.length} caught / ${
          score.tp.length + score.fn.length
        } intentional)`
      );
      if (score.fp.length) {
        console.log(
          `  false reds: ${score.fp
            .map((m) => `#${m.globalWordIndex}(${m.expected})`)
            .join(" ")}`
        );
      }
      if (score.fn.length) {
        console.log(
          `  missed err: ${score.fn
            .map((m) => `#${m.globalWordIndex}(${m.expected}${m.kind ? "/" + m.kind : ""})`)
            .join(" ")}`
        );
      }
    }
  }

  // CI gates.
  let failed = false;
  if (expectBuild != null) {
    const ok = buildTag && buildTag.includes(expectBuild);
    if (!ok) {
      console.error(`\n[gate] build stamp mismatch: expected ${expectBuild}, got ${buildTag ?? "none"}`);
      failed = true;
    }
  }
  if (minMatch != null) {
    if (matchPct == null) {
      console.error(`\n[gate] no match % (missing listen.stop)`);
      failed = true;
    } else if (matchPct + 1e-9 < minMatch) {
      console.error(`\n[gate] match ${matchPct.toFixed(1)}% < required ${minMatch}%`);
      failed = true;
    }
  }
  if (minPrecision != null) {
    if (score == null) {
      console.error(`\n[gate] --min-precision set but no labels found for ${file}`);
      failed = true;
    } else if (score.precision * 100 + 1e-9 < minPrecision) {
      console.error(
        `\n[gate] precision ${(score.precision * 100).toFixed(1)}% < required ${minPrecision}%`
      );
      failed = true;
    }
  }
  process.exit(failed ? 1 : 0);
}

function numFlag(args, name, def) {
  const a = args.find((x) => x.startsWith(name + "="));
  if (!a) return def;
  const v = Number(a.slice(name.length + 1));
  return Number.isFinite(v) ? v : def;
}

function strFlag(args, name, def) {
  const a = args.find((x) => x.startsWith(name + "="));
  return a ? a.slice(name.length + 1) : def;
}

main();
