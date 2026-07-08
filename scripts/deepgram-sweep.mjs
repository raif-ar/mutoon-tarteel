/**
 * Deepgram config sweep (RAI-12).
 *
 * Evaluates deepgram request-parameter variants over the same 12 recorded
 * WAVs as scripts/asr-eval.mjs (whose scoring functions it imports: WER,
 * matchedThrough coverage, golden-word recovery). Goal: find settings that
 * beat the current baseline (nova-3 + normalized-line keyterms, avg WER
 * ~9.5%, coverage 100%, golden 14/15).
 *
 * Axes covered (see docs/ACCURACY_BASELINE.md "Deepgram config sweep"):
 *   - keyterm pool size: 0 / line-only / 15 / 30 / 60 upcoming matn words.
 *     NOTE: eval lines are 4-8 words, so ">line" counts only make sense
 *     against the app-realistic pool — the upcoming-matn window that the
 *     live engine biases with (MIC_EXPECTED_WINDOW = 32 in reciteEngine.ts).
 *   - keyterm form: normalized (diacritics stripped, what asr-eval sends)
 *     vs vocalized (raw matn words with tashkeel, what the app sends).
 *   - multi-word keyterm: whole line as one phrase (docs support phrases).
 *   - punctuate/numerals explicit off (both default-off; confirms no-op).
 *   - language=ar vs dialect code ar-SA.
 *   - model: nova-3 vs nova-2 (expected to fail: nova-2 has no Arabic and
 *     no keyterm support — kept in the sweep so the failure is on record).
 *   - NO keyterm weighting variant: nova-3 keyterm prompting has no
 *     intensifier syntax (`word:2` is the legacy nova-2 `keywords` feature;
 *     verified against developers.deepgram.com/docs/keyterm, 2026-07-08).
 *
 * Run:
 *   export DEEPGRAM_API_KEY=$(grep -o 'EXPO_PUBLIC_ASR_DEEPGRAM_KEY=.*' app/.env | cut -d= -f2-)
 *   node scripts/deepgram-sweep.mjs
 */

import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import {
  root,
  SAMPLES_DIR,
  MANIFEST,
  normalize,
  tokenize,
  wordMatch,
  matchedThrough,
  wer,
  expectedFor,
} from "./asr-eval.mjs";

const KEY = process.env.DEEPGRAM_API_KEY;
if (!KEY) {
  console.error(
    "DEEPGRAM_API_KEY not set. Try:\n" +
      "  export DEEPGRAM_API_KEY=$(grep -o 'EXPO_PUBLIC_ASR_DEEPGRAM_KEY=.*' app/.env | cut -d= -f2-)"
  );
  process.exit(1);
}

// --- Matn pools -------------------------------------------------------------

const matn = JSON.parse(
  readFileSync(join(root, "content/mutoon/tuhfat_al_atfal.json"), "utf8")
);
const flatLines = matn.sections.flatMap((s) => s.lines);
/** Raw vocalized words of the whole matn, in recitation order. */
const flatWords = flatLines.flatMap((l) => l.words.map((w) => ({ id: l.id, word: w })));

function lineRawWords(lineId) {
  const line = flatLines.find((l) => l.id === lineId);
  if (!line) throw new Error(`Missing line ${lineId}`);
  return line.words;
}

/**
 * App-realistic bias pool: upcoming matn words starting at this line — this
 * is what the live engine's keyterm window contains when the reciter reaches
 * the line (reciteEngine.ts expectedWordsFrom(cursor).slice(0, WINDOW)).
 */
function windowWords(lineId, count, { vocalized }) {
  const start = flatWords.findIndex((w) => w.id === lineId);
  if (start < 0) throw new Error(`Missing line ${lineId}`);
  const slice = flatWords.slice(start, start + count).map((w) => w.word);
  return vocalized ? slice : slice.map((w) => normalize(w));
}

// --- Variants ---------------------------------------------------------------

/**
 * Each variant: { name, note, model?, language?, extraParams?, terms(case) }.
 * terms() returns the keyterm list (possibly multi-word entries) for a case.
 */
const VARIANTS = [
  {
    name: "current (kt=line, normalized)",
    note: "asr-eval.mjs baseline — must reproduce ~9.5% WER",
    terms: (c) => expectedFor(c),
  },
  {
    name: "unbiased (kt=0)",
    note: "no keyterms",
    terms: () => [],
  },
  {
    name: "kt=15 window, normalized",
    note: "upcoming-matn pool",
    terms: (c) => windowWords(c.lineId, 15, { vocalized: false }),
  },
  {
    name: "kt=30 window, normalized",
    note: "upcoming-matn pool",
    terms: (c) => windowWords(c.lineId, 30, { vocalized: false }),
  },
  {
    name: "kt=60 window, normalized",
    note: "upcoming-matn pool (current MAX_KEYTERMS cap)",
    terms: (c) => windowWords(c.lineId, 60, { vocalized: false }),
  },
  {
    name: "kt=line, vocalized",
    note: "tashkeel keyterms, line only",
    terms: (c) => lineRawWords(c.lineId),
  },
  {
    name: "kt=32 window, vocalized (app config)",
    note: "exactly what the live app sends (MIC_EXPECTED_WINDOW=32, punctuate=false)",
    extraParams: { punctuate: "false" },
    terms: (c) => windowWords(c.lineId, 32, { vocalized: true }),
  },
  {
    name: "kt=16 window, normalized only (no clipped)",
    note: "prices the clipped-alif variants against the 16-word window",
    terms: (c) => windowWords(c.lineId, 16, { vocalized: false }),
  },
  {
    name: "kt=16 window, norm+clipped (new app config)",
    note: "post-sweep live config: biasVariants normalized-only + clipped rhyme alif, MIC_EXPECTED_WINDOW=16",
    terms: (c) => {
      const out = [];
      for (const w of windowWords(c.lineId, 16, { vocalized: false })) {
        if (!out.includes(w)) out.push(w);
        if (w.length > 3 && w.endsWith("ا")) {
          const clipped = w.slice(0, -1);
          if (!out.includes(clipped)) out.push(clipped);
        }
      }
      return out;
    },
  },
  {
    name: "kt=whole-line phrase, normalized",
    note: "single multi-word keyterm per line",
    terms: (c) => [expectedFor(c).join(" ")],
  },
  {
    name: "kt=line + punctuate=false + numerals=false",
    note: "explicit defaults (expected no-op)",
    extraParams: { punctuate: "false", numerals: "false" },
    terms: (c) => expectedFor(c),
  },
  {
    name: "kt=line, language=ar-SA",
    note: "dialect code instead of generic ar",
    language: "ar-SA",
    terms: (c) => expectedFor(c),
  },
  {
    name: "nova-2, unbiased",
    note: "expected to fail — nova-2 has no Arabic support",
    model: "nova-2",
    terms: () => [],
  },
  // --- Round 2 probes (after round 1 showed line-scale normalized keyterms win) ---
  {
    name: "kt=line normalized x3 (repetition)",
    note: "repetition-as-weight probe (nova-3 has no intensifier syntax)",
    terms: (c) => {
      const t = expectedFor(c);
      return [...t, ...t, ...t];
    },
  },
  {
    name: "kt=line normalized + vocalized",
    note: "both forms of every line word",
    terms: (c) => [...expectedFor(c), ...lineRawWords(c.lineId)],
  },
  {
    name: "kt=whole-line phrase, vocalized",
    note: "single tashkeel multi-word keyterm per line",
    terms: (c) => [lineRawWords(c.lineId).join(" ")],
  },
  {
    name: "kt=12 window, normalized",
    note: "line + small lookahead (app rebias threshold is 12 words)",
    terms: (c) => windowWords(c.lineId, 12, { vocalized: false }),
  },
];

// --- Transcription ----------------------------------------------------------

async function transcribe(wavPath, variant, testCase) {
  const params = new URLSearchParams({
    model: variant.model ?? "nova-3",
    language: variant.language ?? "ar",
    smart_format: "false",
    ...(variant.extraParams ?? {}),
  });
  let url = `https://api.deepgram.com/v1/listen?${params.toString()}`;
  for (const t of variant.terms(testCase).slice(0, 60)) {
    url += `&keyterm=${encodeURIComponent(t)}`;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Token ${KEY}`, "Content-Type": "audio/wav" },
    body: readFileSync(wavPath),
  });
  if (!res.ok) throw new Error(`Deepgram ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
}

// --- Runner -----------------------------------------------------------------

const pct = (x) => `${(x * 100).toFixed(1)}%`;

async function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const cases = (manifest.cases ?? []).filter((c) =>
    existsSync(resolve(SAMPLES_DIR, c.wav))
  );
  if (!cases.length) {
    console.error("No wav cases found in", MANIFEST);
    process.exit(1);
  }
  // SWEEP_ONLY="phrase,repetition" runs only variants whose name contains a
  // comma-separated substring (case-insensitive).
  const only = (process.env.SWEEP_ONLY ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const variants = only.length
    ? VARIANTS.filter((v) => only.some((s) => v.name.toLowerCase().includes(s)))
    : VARIANTS;
  console.log(`Sweeping ${variants.length} variants x ${cases.length} wavs…\n`);

  const summary = [];
  for (const variant of variants) {
    let werSum = 0;
    let covSum = 0;
    let n = 0;
    let latSum = 0;
    let goldenHits = 0;
    let goldenTotal = 0;
    let error = null;
    console.log(`## ${variant.name}`);
    for (const testCase of cases) {
      const wavPath = resolve(SAMPLES_DIR, testCase.wav);
      const expected = expectedFor(testCase);
      const goldenWords = testCase.goldenWords ?? [];
      const t0 = Date.now();
      let hyp;
      try {
        hyp = await transcribe(wavPath, variant, testCase);
      } catch (e) {
        error = e.message.slice(0, 160);
        console.log(`  ${testCase.wav}: ERROR ${error}`);
        break; // config-level failure (bad model/param) — same for every wav
      }
      const latency = (Date.now() - t0) / 1000;
      const recognized = tokenize(hyp);
      const through = matchedThrough(expected, recognized);
      const hits = goldenWords.filter((g) =>
        recognized.some((t) => wordMatch(t, g))
      ).length;
      const caseWer = wer(expected.join(" "), hyp);
      werSum += caseWer;
      covSum += expected.length ? through / expected.length : 0;
      latSum += latency;
      goldenHits += hits;
      goldenTotal += goldenWords.length;
      n += 1;
      if (process.env.SWEEP_VERBOSE) {
        console.log(
          `  ${testCase.wav.padEnd(16)} WER ${pct(caseWer).padStart(6)}  matched ${through}/${expected.length}  golden ${hits}/${goldenWords.length}  "${hyp}"`
        );
      }
    }
    const row = {
      name: variant.name,
      note: variant.note,
      n,
      avgWer: n ? werSum / n : null,
      avgCov: n ? covSum / n : null,
      avgLat: n ? latSum / n : null,
      goldenHits,
      goldenTotal,
      error,
    };
    summary.push(row);
    if (!error) {
      console.log(
        `  avg WER ${pct(row.avgWer)}  coverage ${pct(row.avgCov)}  golden ${goldenHits}/${goldenTotal}  latency ${row.avgLat.toFixed(2)}s (n=${n})`
      );
    }
    console.log();
  }

  console.log("\n## Markdown summary\n");
  console.log("| Variant | avg WER | coverage | golden | avg latency |");
  console.log("|---|---|---|---|---|");
  for (const r of summary) {
    if (r.error) {
      console.log(`| ${r.name} | — | — | — | ERROR: ${r.error} |`);
    } else {
      console.log(
        `| ${r.name} | ${pct(r.avgWer)} | ${pct(r.avgCov)} | ${r.goldenHits}/${r.goldenTotal} | ${r.avgLat.toFixed(2)}s |`
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
