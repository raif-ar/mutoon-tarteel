/**
 * ASR accuracy eval harness (RAI-11).
 *
 * Runs sample recitation WAVs through cloud vendors (Deepgram Nova-3,
 * OpenAI gpt-4o-transcribe) — with and without matn contextual biasing — and
 * optionally a local Whisper command, then reports WER and the alignment
 * `matchedThrough` (via the same greedy scanner the app uses) against the
 * expected matn words. Use it to prove a provider beats the Expo-speech
 * baseline on the same lines.
 *
 * Setup:
 *   scripts/../samples/asr-eval/manifest.json  (see SAMPLE_MANIFEST_HELP below)
 *   export DEEPGRAM_API_KEY=...     # enables Deepgram
 *   export OPENAI_API_KEY=...       # enables gpt-4o-transcribe
 *   export ASR_EVAL_LOCAL_CMD='whisper-cli -m model.bin -l ar -otxt -f {wav}'  # optional
 *
 * Run: node scripts/asr-eval.mjs
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLES_DIR = join(root, "samples", "asr-eval");
const MANIFEST = join(SAMPLES_DIR, "manifest.json");

const SAMPLE_MANIFEST_HELP = `
No eval manifest found at samples/asr-eval/manifest.json.

Create it with real recitation clips (16 kHz mono WAV recommended):

  {
    "cases": [
      { "wav": "intro_l001.wav", "lineId": "intro_l001" },
      { "wav": "noon_l004.wav",  "expected": "للحلقة ست رتبت فعرف" }
    ]
  }

Each case needs a "wav" (relative to samples/asr-eval/) plus either a
"lineId" (resolved from content/mutoon/tuhfat_al_atfal.json) or a raw
"expected" string. Then set DEEPGRAM_API_KEY and/or OPENAI_API_KEY and re-run.
`;

// --- Normalization + greedy matcher (mirrors app/src/lib/asr/align.ts) ---

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

function tokenize(text) {
  return normalize(text).split(/\s+/).filter(Boolean);
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

function matchedThrough(expected, recognized) {
  let ei = 0;
  let ri = 0;
  let through = 0;
  while (ri < recognized.length && ei < expected.length) {
    if (wordMatch(recognized[ri], expected[ei])) {
      ei += 1;
      ri += 1;
      through = ei;
    } else if (ei + 1 < expected.length && wordMatch(recognized[ri], expected[ei + 1])) {
      ei += 2;
      ri += 1;
      through = ei;
    } else {
      ri += 1;
    }
  }
  return through;
}

/** Word-level WER via Levenshtein over normalized tokens. */
function wer(reference, hypothesis) {
  const r = tokenize(reference);
  const h = tokenize(hypothesis);
  if (r.length === 0) return h.length === 0 ? 0 : 1;
  const d = Array.from({ length: r.length + 1 }, () => new Array(h.length + 1).fill(0));
  for (let i = 0; i <= r.length; i++) d[i][0] = i;
  for (let j = 0; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++) {
    for (let j = 1; j <= h.length; j++) {
      const cost = r[i - 1] === h[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[r.length][h.length] / r.length;
}

// --- Expected words from matn ---

let matn = null;
function lineWords(lineId) {
  if (!matn) {
    matn = JSON.parse(
      readFileSync(join(root, "content/mutoon/tuhfat_al_atfal.json"), "utf8")
    );
  }
  const line = matn.sections.flatMap((s) => s.lines).find((l) => l.id === lineId);
  if (!line) throw new Error(`Missing line ${lineId}`);
  return line.words.map((w) => normalize(w));
}

function expectedFor(testCase) {
  if (testCase.lineId) return lineWords(testCase.lineId);
  if (testCase.expected) return tokenize(testCase.expected);
  throw new Error(`Case ${testCase.wav} needs lineId or expected`);
}

// --- Vendors (batch REST) ---

async function deepgramTranscribe(wavPath, biasTerms) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return null;
  const params = new URLSearchParams({ model: "nova-3", language: "ar", smart_format: "false" });
  let url = `https://api.deepgram.com/v1/listen?${params.toString()}`;
  for (const t of biasTerms.slice(0, 60)) url += `&keyterm=${encodeURIComponent(t)}`;
  const body = readFileSync(wavPath);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": "audio/wav" },
    body,
  });
  if (!res.ok) throw new Error(`Deepgram ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
}

async function openaiTranscribe(wavPath, biasTerms) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const body = readFileSync(wavPath);
  const form = new FormData();
  form.append("model", "gpt-4o-transcribe");
  form.append("language", "ar");
  if (biasTerms.length) form.append("prompt", biasTerms.join(" "));
  form.append("file", new Blob([body], { type: "audio/wav" }), "audio.wav");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.text ?? "";
}

// --- FastConformer sidecar (decision gate for the tilawa-style on-device path) ---
//
// Set FASTCONFORMER_PY to the venv python (see scripts/fastconformer-sidecar.py
// header for setup). Optional: FASTCONFORMER_ARGS="--decoder ctc --tta".
// The model loads once for the whole batch; results are cached per wav.
let fcCache = null;

function runFastconformerBatch(cases) {
  const py = process.env.FASTCONFORMER_PY;
  if (!py) return null;
  const entries = cases
    .map((c) => ({ id: c.wav, wav: resolve(SAMPLES_DIR, c.wav) }))
    .filter((e) => existsSync(e.wav));
  if (!entries.length) return new Map();
  const manifestPath = join(tmpdir(), `fc-manifest-${process.pid}.json`);
  writeFileSync(manifestPath, JSON.stringify(entries));
  const extra = (process.env.FASTCONFORMER_ARGS ?? "").split(/\s+/).filter(Boolean);
  const sidecar = join(root, "scripts", "fastconformer-sidecar.py");
  console.log(`\nRunning FastConformer sidecar over ${entries.length} wav(s)…`);
  const out = execFileSync(py, [sidecar, "--manifest", manifestPath, ...extra], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const cache = new Map();
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.id && !row.error) cache.set(row.id, row);
    } catch {
      /* skip non-JSON */
    }
  }
  return cache;
}

function localTranscribe(wavPath, biasTerms) {
  const tmpl = process.env.ASR_EVAL_LOCAL_CMD;
  if (!tmpl) return null;
  const cmd = tmpl
    .replace("{wav}", wavPath)
    .replace("{prompt}", biasTerms.join(" "));
  const [bin, ...args] = cmd.split(/\s+/);
  try {
    return execFileSync(bin, args, { encoding: "utf8" }).trim();
  } catch (e) {
    return `ERROR: ${e.message}`;
  }
}

// --- Runner ---

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

async function evalCase(testCase) {
  const wavPath = resolve(SAMPLES_DIR, testCase.wav);
  if (!existsSync(wavPath)) {
    console.log(`  ! missing wav: ${testCase.wav}`);
    return [];
  }
  const expected = expectedFor(testCase);
  const expectedText = expected.join(" ");
  const bias = expected;
  const rows = [];

  const fc = fcCache?.get(testCase.wav) ?? null;
  const engines = [
    ["deepgram", deepgramTranscribe],
    ["openai", openaiTranscribe],
    ["local", (w, b) => Promise.resolve(localTranscribe(w, b))],
    // FastConformer has no biasing mechanism: unbiased row only, timing from
    // the sidecar's decode clock (model load excluded).
    ["fastconformer", fc ? () => Promise.resolve(fc.text) : () => Promise.resolve(null)],
  ];

  const goldenWords = testCase.goldenWords ?? [];
  for (const [name, fn] of engines) {
    const labels = name === "fastconformer" ? [["unbiased", []]] : [["unbiased", []], ["biased", bias]];
    for (const [label, terms] of labels) {
      let hyp;
      const t0 = Date.now();
      try {
        hyp = await fn(wavPath, terms);
      } catch (e) {
        console.log(`  ${name}/${label}: ERROR ${e.message}`);
        continue;
      }
      if (hyp == null) continue; // engine not configured
      const latencySec =
        name === "fastconformer" ? (fc && fc.decodeSec) ?? null : (Date.now() - t0) / 1000;
      const recognized = tokenize(hyp);
      const through = matchedThrough(expected, recognized);
      // False-red recovery probe: labeled ASR-drop words for this line — did
      // this engine's transcript emit something the matcher accepts?
      const goldenHits = goldenWords.filter((g) =>
        recognized.some((t) => wordMatch(t, g))
      ).length;
      rows.push({
        case: testCase.wav,
        engine: `${name}/${label}`,
        wer: wer(expectedText, hyp),
        matched: through,
        expectedLen: expected.length,
        latencySec,
        rtf: name === "fastconformer" ? fc?.rtf ?? null : null,
        goldenHits,
        goldenTotal: goldenWords.length,
      });
    }
  }
  return rows;
}

async function main() {
  if (!existsSync(MANIFEST)) {
    console.log(SAMPLE_MANIFEST_HELP);
    process.exit(0);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const cases = manifest.cases ?? [];
  if (cases.length === 0) {
    console.log("Manifest has no cases.");
    process.exit(0);
  }

  fcCache = runFastconformerBatch(cases);

  const allRows = [];
  for (const testCase of cases) {
    console.log(`\n# ${testCase.wav}`);
    const rows = await evalCase(testCase);
    for (const r of rows) {
      const lat = r.latencySec != null ? `  ${r.latencySec.toFixed(2)}s` : "";
      const rtf = r.rtf != null ? ` (rtf ${r.rtf})` : "";
      const golden = r.goldenTotal ? `  golden ${r.goldenHits}/${r.goldenTotal}` : "";
      console.log(
        `  ${r.engine.padEnd(22)} WER ${pct(r.wer).padStart(7)}  matched ${r.matched}/${r.expectedLen}${lat}${rtf}${golden}`
      );
      allRows.push(r);
    }
  }

  // Summary by engine.
  console.log("\n## Summary (avg by engine)");
  const byEngine = new Map();
  for (const r of allRows) {
    const e =
      byEngine.get(r.engine) ??
      { werSum: 0, mtSum: 0, n: 0, latSum: 0, latN: 0, goldenHits: 0, goldenTotal: 0 };
    e.werSum += r.wer;
    e.mtSum += r.expectedLen ? r.matched / r.expectedLen : 0;
    e.n += 1;
    if (r.latencySec != null) {
      e.latSum += r.latencySec;
      e.latN += 1;
    }
    e.goldenHits += r.goldenHits ?? 0;
    e.goldenTotal += r.goldenTotal ?? 0;
    byEngine.set(r.engine, e);
  }
  for (const [engine, e] of [...byEngine.entries()].sort()) {
    const lat = e.latN ? `  avg latency ${(e.latSum / e.latN).toFixed(2)}s` : "";
    const golden = e.goldenTotal ? `  golden ${e.goldenHits}/${e.goldenTotal}` : "";
    console.log(
      `  ${engine.padEnd(22)} avg WER ${pct(e.werSum / e.n).padStart(7)}  avg coverage ${pct(
        e.mtSum / e.n
      ).padStart(7)}  (n=${e.n})${lat}${golden}`
    );
  }

  // Decision gate (see docs/ACCURACY_BASELINE.md): go on-device only if
  // FastConformer *unbiased* beats Deepgram *biased* on WER and coverage,
  // recovers most labeled golden false-red words, and RTF < 0.5 on this CPU.
  const fc = byEngine.get("fastconformer/unbiased");
  const dg = byEngine.get("deepgram/biased");
  if (fc && dg) {
    const fcRows = allRows.filter((r) => r.engine === "fastconformer/unbiased");
    const rtfs = fcRows.map((r) => r.rtf).filter((x) => x != null);
    const avgRtf = rtfs.length ? rtfs.reduce((a, b) => a + b, 0) / rtfs.length : null;
    const checks = [
      ["WER  : fastconformer ≤ deepgram/biased", fc.werSum / fc.n <= dg.werSum / dg.n],
      ["cover: fastconformer ≥ deepgram/biased", fc.mtSum / fc.n >= dg.mtSum / dg.n],
      [
        `golden recovery ≥ 75% (${fc.goldenHits}/${fc.goldenTotal})`,
        fc.goldenTotal === 0 || fc.goldenHits / fc.goldenTotal >= 0.75,
      ],
      [`RTF < 0.5 (avg ${avgRtf?.toFixed(2) ?? "?"})`, avgRtf != null && avgRtf < 0.5],
    ];
    console.log("\n## On-device decision gate");
    let pass = true;
    for (const [label, ok] of checks) {
      console.log(`  ${ok ? "✓" : "✗"} ${label}`);
      if (!ok) pass = false;
    }
    console.log(
      pass
        ? "  → GATE PASSED: proceed to on-device FastConformer investigation (quantization + RN port)."
        : "  → GATE NOT PASSED: stay on Deepgram; matcher/reconcile improvements stand on their own."
    );
  }
  if (allRows.length === 0) {
    console.log("\nNo engines ran. Set DEEPGRAM_API_KEY / OPENAI_API_KEY / ASR_EVAL_LOCAL_CMD.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
