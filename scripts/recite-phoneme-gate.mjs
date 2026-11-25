/**
 * Gate for the on-device Recite engine: recorded audio -> Tilawa listener (phonemes)
 * -> the app's REAL phonemizer + live aligner (transpiled from app/src/lib/recite).
 *
 * Tokens are replayed on the listener clock in small steps, so verdicts are the ones
 * the app would commit live, and the report includes how late each verdict lands.
 *
 * Usage: node scripts/recite-phoneme-gate.mjs [--lite] [--verbose] [--max-false-reds=N] [--threshold=0.5]
 * Needs @tilawa/core + onnxruntime-node: resolved from TILAWA_NM, else app/node_modules, else scripts/tilawa-spike.
 */
import { createRequire } from "module";
import { execFileSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(root, "app");
const flags = new Set(process.argv.slice(2));
const flagVal = (name, dflt) => { const f = [...flags].find((x) => x.startsWith(`--${name}=`)); return f ? Number(f.split("=")[1]) : dflt; };
const VERBOSE = flags.has("--verbose");
const tier = flags.has("--lite") ? "lite" : "full";
const MAX_FALSE_REDS = flagVal("max-false-reds", 0);
const THRESHOLD = flagVal("threshold", undefined);
const STEP = 8; // frames per replay step (320 ms)
const FRAME_MS = 40;

// ---- load the shipped TypeScript ----
const ts = createRequire(join(appDir, "package.json"))("typescript");
const outDir = mkdtempSync(join(tmpdir(), "recite-gate-"));
async function loadTs(rel) {
  const js = ts.transpileModule(readFileSync(join(appDir, rel), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  const file = join(outDir, rel.split("/").pop().replace(/\.ts$/, ".mjs"));
  writeFileSync(file, js);
  return import(pathToFileURL(file).href);
}
const { lineWordPhonemes } = await loadTs("src/lib/recite/phonemize.ts");
const { PhonemeAligner, heardToArabic } = await loadTs("src/lib/recite/phonemeAlign.ts");

// ---- the listener ----
const nmCandidates = [process.env.TILAWA_NM, join(appDir, "node_modules"), join(root, "scripts/tilawa-spike/node_modules"), "/private/tmp/claude-501/-Users-raif-IslamTech/9b069af5-5798-4d61-8e97-2fe8bfa19d7a/scratchpad/tilawa/node_modules"].filter(Boolean);
const nm = nmCandidates.find((d) => existsSync(join(d, "@tilawa/core/dist/node.js")) && existsSync(join(d, "onnxruntime-node")));
if (!nm) { console.error("Install @tilawa/core@next and onnxruntime-node (see scripts/tilawa-spike/NOTES.md)."); process.exit(2); }
process.chdir(dirname(nm)); // onnxruntime-node is resolved from the package's own location
const { createTilawa, readWav } = await import(pathToFileURL(join(nm, "@tilawa/core/dist/node.js")).href);
const tilawa = await createTilawa({ tier, recordEvidence: true });

async function hear(wav) {
  const session = tilawa.startFreeRecitation();
  const { samples, sampleRate } = await readWav(wav);
  for (let i = 0; i < samples.length; i += 4800) await session.pushAudio(samples.subarray(i, i + 4800), sampleRate);
  await session.end();
  const tokens = session.evidence().flatMap((x) => x.phonemes).map((d) => ({ p: d.p, start: d.start, end: d.end, conf: d.conf }));
  session.dispose();
  return { tokens, frames: Math.ceil((samples.length / sampleRate) * 1000 / FRAME_MS) };
}

// ---- content ----
const matn = JSON.parse(readFileSync(join(root, "content/mutoon/tuhfat_al_atfal.json"), "utf8"));
const lines = matn.sections.flatMap((s) => s.lines);
const lineById = Object.fromEntries(lines.map((l) => [l.id, l]));

function runSession(tokens, frames, lineIds) {
  const words = [], phon = [];
  for (const id of lineIds) { const l = lineById[id]; const ph = lineWordPhonemes(l.words); l.words.forEach((w, i) => { words.push({ w, line: id }); phon.push(ph[i]); }); }
  const al = new PhonemeAligner(phon, THRESHOLD ? { threshold: THRESHOLD } : {});
  if (process.env.DEBUG_ALIGN) al.debug = (d) => { if (d.mode !== "live") console.log("   ", JSON.stringify(d)); };
  const verdicts = [];
  let k = 0, cursor = 0;
  for (let now = STEP; now <= frames + STEP; now += STEP) {
    const batch = [];
    while (k < tokens.length && tokens[k].end <= now) batch.push(tokens[k++]);
    const u = al.push(batch, now);
    verdicts.push(...u.verdicts); cursor = u.cursor;
  }
  const u = al.finish(frames + STEP);
  verdicts.push(...u.verdicts);
  return { words, verdicts, cursor: u.cursor };
}

function concat(files, name) {
  const out = join(outDir, name);
  const args = ["-y", "-loglevel", "error"];
  for (const f of files) args.push("-i", f);
  args.push("-filter_complex", `${files.map((_, i) => `[${i}:a]`).join("")}concat=n=${files.length}:v=0:a=1`, "-ar", "16000", "-ac", "1", out);
  execFileSync("ffmpeg", args);
  return out;
}

const EVAL = join(root, "samples/asr-eval"), SEED = join(root, "samples/scribe-seeded");
const manifest = JSON.parse(readFileSync(join(EVAL, "manifest.json"), "utf8"));
const stats = { cleanWords: 0, falseReds: 0, planted: 0, caught: 0, extraReds: 0, lat: [], unjudged: 0 };
const show = (r) => r.words.map((x, i) => { const v = r.verdicts.find((y) => y.index === i); return !v ? `${x.w}(–)` : v.ok ? `${x.w}(${v.err.toFixed(2)} c${v.consBad.toFixed(1)}/${v.cons} conf${v.conf.toFixed(2)} f${v.startFrame}-${v.endFrame})` : `RED[${v.kind}] ${x.w}(${v.err.toFixed(2)} c${v.consBad.toFixed(1)}/${v.cons} conf${v.conf.toFixed(2)} f${v.startFrame}-${v.endFrame} heard ${heardToArabic(v.heard)})`; }).join("  ");
function score(label, r, plantedIdx = []) {
  for (let i = 0; i < r.words.length; i++) {
    const v = r.verdicts.find((y) => y.index === i);
    if (!v) { stats.unjudged++; continue; }
    if (v.endFrame >= 0) stats.lat.push((v.atFrame - v.endFrame) * FRAME_MS);
    if (plantedIdx.includes(i)) { if (!v.ok) stats.caught++; }
    else { stats.cleanWords++; if (!v.ok) { plantedIdx.length ? stats.extraReds++ : stats.falseReds++; } }
  }
  stats.planted += plantedIdx.length;
  const reds = r.verdicts.filter((v) => !v.ok).length;
  if (VERBOSE || reds || r.verdicts.length < r.words.length) console.log(`${label}: ${show(r)}`);
}

console.log(`# listener tier=${tier}, replay step=${STEP * FRAME_MS}ms`);
console.log("## clean single lines (real voice)");
const heardCache = {};
for (const c of manifest.cases) {
  const h = (heardCache[c.wav] = await hear(join(EVAL, c.wav)));
  score(c.lineId, runSession(h.tokens, h.frames, [c.lineId]));
}
console.log("## seeded single lines (synthetic voice)");
const seeded = [["control_intro_l001", "intro_l001", []], ["swap_ghafur_shakur", "intro_l001", [3]], ["swap_tuqa_huda", "noon_l022", [4]], ["swap_thabatat_dhaharat", "noon_l008", [4]], ["drop_aalihi", "intro_l004", [1]]];
for (const [id, lineId, planted] of seeded) { const h = await hear(join(SEED, `${id}.wav`)); score(id, runSession(h.tokens, h.frames, [lineId]), planted); }

console.log("## one continuous session: the 12 real clips back to back");
{
  const ids = manifest.cases.map((c) => c.lineId);
  const wav = concat(manifest.cases.map((c) => join(EVAL, c.wav)), "session-clean.wav");
  const h = await hear(wav);
  const r = runSession(h.tokens, h.frames, ids);
  score("session-clean", r);
  console.log(`  cursor ${r.cursor}/${r.words.length}, judged ${r.verdicts.length}/${r.words.length}`);
}
console.log("## one continuous session with 4 planted mistakes (real + synthetic voice)");
{
  const plan = [["asr-eval/intro_l001.wav", "intro_l001", []], [`scribe-seeded/drop_aalihi.wav`, "intro_l004", [1]], ["asr-eval/intro_l005.wav", "intro_l005", []], ["asr-eval/intro_l008.wav", "intro_l008", []],
    ["scribe-seeded/swap_ghafur_shakur.wav", "intro_l001", [3]], ["asr-eval/noon_l003.wav", "noon_l003", []], ["scribe-seeded/swap_thabatat_dhaharat.wav", "noon_l008", [4]], ["asr-eval/noon_l011.wav", "noon_l011", []],
    ["scribe-seeded/swap_tuqa_huda.wav", "noon_l022", [4]], ["asr-eval/noon_l021.wav", "noon_l021", []]];
  const wav = concat(plan.map((p) => join(root, "samples", p[0])), "session-seeded.wav");
  const h = await hear(wav);
  const ids = plan.map((p) => p[1]);
  const planted = []; let off = 0;
  for (const p of plan) { for (const i of p[2]) planted.push(off + i); off += lineById[p[1]].words.length; }
  const r = runSession(h.tokens, h.frames, ids);
  score("session-seeded", r, planted);
  console.log(`  cursor ${r.cursor}/${r.words.length}, judged ${r.verdicts.length}/${r.words.length}`);
}

const lat = stats.lat.sort((a, b) => a - b);
const pct = (q) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * q))] : 0);
console.log("\n# result");
console.log(`false reds on clean audio: ${stats.falseReds} / ${stats.cleanWords} words (gate: <= ${MAX_FALSE_REDS})`);
console.log(`planted mistakes caught: ${stats.caught} / ${stats.planted}; extra reds beside planted ones: ${stats.extraReds}`);
console.log(`words never judged: ${stats.unjudged}`);
console.log(`verdict delay after the word ended: median ${pct(0.5)} ms, p90 ${pct(0.9)} ms, max ${lat[lat.length - 1] ?? 0} ms`);
await tilawa.dispose();
process.exit(stats.falseReds > MAX_FALSE_REDS ? 1 : 0);
