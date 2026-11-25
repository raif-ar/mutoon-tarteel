/**
 * Gate for the on-device Recite engine: recorded audio -> the app's REAL listener,
 * phonemizer and live aligner (transpiled from app/src/lib/recite).
 *
 * Tokens are replayed on the listener clock in small steps, so verdicts are the ones
 * the app would commit live, and the report includes how late each verdict lands.
 *
 * Usage: node scripts/recite-phoneme-gate.mjs [--verbose] [--max-false-reds=N] [--threshold=0.55]
 * Needs: `npm install` in the repo root (onnxruntime-node), the model (scripts/fetch-listener-model.mjs) and ffmpeg.
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
const MAX_FALSE_REDS = flagVal("max-false-reds", 0);
const THRESHOLD = flagVal("threshold", undefined);
const STEP = 8; // frames per replay step (320 ms)
const FRAME_MS = 40;

// ---- load the shipped TypeScript ----
const require = createRequire(join(appDir, "package.json"));
const ts = require("typescript");
const outDir = mkdtempSync(join(tmpdir(), "recite-gate-"));
/** Transpile one app file (and its relative imports) to ESM in a temp dir and import it. */
function emitTs(rel) {
  const src = readFileSync(join(appDir, rel), "utf8");
  let js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  js = js.replace(/from "(\.\.?\/[^"]+)"/g, (_, spec) => {
    const dep = join(dirname(rel), spec) + ".ts";
    emitTs(dep);
    return `from "./${dep.replace(/[\/]/g, "_").replace(/\.ts$/, ".mjs")}"`;
  });
  const file = join(outDir, rel.replace(/[\/]/g, "_").replace(/\.ts$/, ".mjs"));
  writeFileSync(file, js);
  return file;
}
const loadTs = (rel) => import(pathToFileURL(emitTs(rel)).href);
const { lineWordPhonemes } = await loadTs("src/lib/recite/phonemize.ts");
const { PhonemeAligner, heardToArabic } = await loadTs("src/lib/recite/phonemeAlign.ts");
const { createListener } = await loadTs("src/lib/recite/listener/listener.ts");

// ---- the listener: the app's own listener code on onnxruntime-node ----
const manifest0 = JSON.parse(readFileSync(join(appDir, "src/lib/recite/listener/model.json"), "utf8"));
const modelPath = process.env.LISTENER_MODEL ?? join(appDir, "assets/models/listener.onnx");
if (!existsSync(modelPath)) { console.error("Model missing. Run: node scripts/fetch-listener-model.mjs"); process.exit(2); }
let ort;
try { ort = createRequire(join(root, "package.json"))("onnxruntime-node"); } catch { console.error("Run `npm install` in the repo root (onnxruntime-node)."); process.exit(2); }
const ortSession = await ort.InferenceSession.create(modelPath, { graphOptimizationLevel: "all", intraOpNumThreads: 1 });
const backend = {
  async run(feeds) {
    const input = {};
    for (const [k, t] of Object.entries(feeds)) input[k] = new ort.Tensor(t.type, t.data, t.dims);
    const out = await ortSession.run(input);
    const res = {};
    for (const [k, t] of Object.entries(out)) res[k] = { type: t.type, data: t.data, dims: t.dims };
    return res;
  },
  async release() { await ortSession.release?.(); },
};

/** Decode any audio file to 16 kHz mono float samples. */
function readAudio(file) {
  const raw = execFileSync("ffmpeg", ["-loglevel", "error", "-i", file, "-f", "f32le", "-ac", "1", "-ar", "16000", "-"], { maxBuffer: 1 << 30 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength >> 2);
}
let cpuMs = 0, audioMs = 0;
async function hear(wav) {
  const samples = readAudio(wav);
  const listener = createListener(manifest0, backend);
  const tokens = [];
  const t0 = performance.now();
  for (let i = 0; i < samples.length; i += 1600) tokens.push(...(await listener.push(samples.subarray(i, i + 1600))));
  tokens.push(...(await listener.end()));
  cpuMs += performance.now() - t0; audioMs += (samples.length / 16000) * 1000;
  return { tokens, frames: Math.ceil((samples.length / 16000) * 1000 / FRAME_MS) };
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
const verdictOf = (r, i) => r.verdicts.find((y) => y.index === i && !y.ok) ?? r.verdicts.find((y) => y.index === i);
const show = (r) => r.words.map((x, i) => { const v = verdictOf(r, i); return !v ? `${x.w}(–)` : v.ok ? `${x.w}(${v.err.toFixed(2)} c${v.consBad.toFixed(1)}/${v.cons} conf${v.conf.toFixed(2)} f${v.startFrame}-${v.endFrame})` : `RED[${v.kind}] ${x.w}(${v.err.toFixed(2)} c${v.consBad.toFixed(1)}/${v.cons} conf${v.conf.toFixed(2)} f${v.startFrame}-${v.endFrame} heard ${heardToArabic(v.heard)})`; }).join("  ");
function score(label, r, plantedIdx = []) {
  for (let i = 0; i < r.words.length; i++) {
    const v = verdictOf(r, i);
    if (!v) { stats.unjudged++; continue; }
    if (v.endFrame >= 0) stats.lat.push((v.atFrame - v.endFrame) * FRAME_MS);
    if (plantedIdx.includes(i)) { if (!v.ok) stats.caught++; }
    else { stats.cleanWords++; if (!v.ok) { plantedIdx.length ? stats.extraReds++ : stats.falseReds++; } }
  }
  stats.planted += plantedIdx.length;
  const reds = r.verdicts.filter((v) => !v.ok).length;
  if (VERBOSE || reds || new Set(r.verdicts.map((v) => v.index)).size < r.words.length) console.log(`${label}: ${show(r)}`);
}

console.log(`# listener ${manifest0.id}@${manifest0.version}, replay step=${STEP * FRAME_MS}ms`);
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

console.log("## reciter behaviours, from the 12 real clips (not counted in the totals above)");
const behaviours = { skippedLineWords: 0, skippedLineReds: 0, repeatReds: 0, restartReds: 0 };
{
  const ids = manifest.cases.map((c) => c.lineId);
  const files = manifest.cases.map((c) => join(EVAL, c.wav));
  const wordsBefore = (n) => ids.slice(0, n).reduce((a, id) => a + lineById[id].words.length, 0);
  // (a) the reciter leaves out a whole line (the third clip is not in the audio)
  {
    const h = await hear(concat(files.filter((_, i) => i !== 2), "skip-line.wav"));
    const r = runSession(h.tokens, h.frames, ids);
    const from = wordsBefore(2), to = wordsBefore(3);
    behaviours.skippedLineWords = to - from;
    const redIdx = new Set(r.verdicts.filter((v) => !v.ok).map((v) => v.index));
    behaviours.skippedLineReds = [...redIdx].filter((i) => i >= from && i < to).length;
    const others = [...redIdx].filter((i) => i < from || i >= to).length;
    behaviours.repeatReds += others; // reds outside the left-out line count as false reds
    console.log(`skip-line: ${behaviours.skippedLineReds}/${behaviours.skippedLineWords} words of the left-out line flagged, ${others} reds elsewhere, cursor ${r.cursor}/${r.words.length}`);
    if (VERBOSE) console.log(`  ${show(r)}`);
  }
  // (b) the reciter says one line twice
  {
    const twice = [...files.slice(0, 2), files[1], ...files.slice(2)];
    const h = await hear(concat(twice, "repeat-line.wav"));
    const r = runSession(h.tokens, h.frames, ids);
    behaviours.repeatReds += new Set(r.verdicts.filter((v) => !v.ok).map((v) => v.index)).size;
    console.log(`repeat-line: ${behaviours.repeatReds} reds, cursor ${r.cursor}/${r.words.length}`);
    if (VERBOSE || behaviours.repeatReds) console.log(`  ${show(r)}`);
  }
  // (c) the reciter goes back two lines and carries on from there
  {
    const again = [...files.slice(0, 4), files[2], files[3], ...files.slice(4)];
    const h = await hear(concat(again, "restart.wav"));
    const r = runSession(h.tokens, h.frames, ids);
    behaviours.restartReds = new Set(r.verdicts.filter((v) => !v.ok).map((v) => v.index)).size;
    console.log(`restart-two-lines-back: ${behaviours.restartReds} reds, cursor ${r.cursor}/${r.words.length}`);
    if (VERBOSE || behaviours.restartReds) console.log(`  ${show(r)}`);
  }
}

const lat = stats.lat.sort((a, b) => a - b);
const pct = (q) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * q))] : 0);
console.log("\n# result");
const uniqueWords = manifest.cases.reduce((n, c) => n + lineById[c.lineId].words.length, 0);
console.log(`false reds on clean audio: ${stats.falseReds} in ${stats.cleanWords} verdicts (gate: <= ${MAX_FALSE_REDS}). These are ${uniqueWords} recorded words, judged alone, stitched into one session, and beside planted mistakes.`);
console.log(`planted mistakes caught: ${stats.caught} / ${stats.planted} (4 distinct mistakes, each alone and inside a session); extra reds beside them: ${stats.extraReds}`);
console.log(`words never judged: ${stats.unjudged}`);
console.log(`left-out line: ${behaviours.skippedLineReds}/${behaviours.skippedLineWords} words flagged; repeated line: ${behaviours.repeatReds} reds; restart two lines back: ${behaviours.restartReds} reds`);
console.log(`verdict delay after the word ended: median ${pct(0.5)} ms, p90 ${pct(0.9)} ms, max ${lat[lat.length - 1] ?? 0} ms`);
console.log(`listener speed: ${(audioMs / cpuMs).toFixed(0)}x real time on this machine (onnxruntime-node, 1 thread)`);
await backend.release();
const failed = stats.falseReds > MAX_FALSE_REDS || stats.caught < stats.planted || stats.extraReds > 0 || stats.unjudged > 0 ||
  behaviours.skippedLineReds < behaviours.skippedLineWords || behaviours.repeatReds > 0 || behaviours.restartReds > 0;
console.log(failed ? "GATE FAILED" : "GATE PASSED");
process.exit(failed ? 1 : 0);
