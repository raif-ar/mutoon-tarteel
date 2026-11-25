/**
 * Gate for the on-device Recite engine: recorded audio -> the app's REAL listener,
 * phonemizer and live aligner (transpiled from app/src/lib/recite).
 *
 * Tokens are replayed on the listener clock in small steps, so verdicts are the ones
 * the app would commit live, and the report includes how late each verdict lands.
 *
 * Usage: node scripts/recite-phoneme-gate.mjs [--verbose] [--max-false-reds=N] [--threshold=0.55] [--no-evidence]
 * (--no-evidence switches off the "clearly heard words around it" rule, to measure what it costs and what it stops.)
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

function runSession(tokens, frames, lineIds, opts = {}) {
  const words = [], phon = [];
  for (const id of lineIds) { const l = lineById[id]; const ph = lineWordPhonemes(l.words); l.words.forEach((w, i) => { words.push({ w, line: id }); phon.push(ph[i]); }); }
  const al = new PhonemeAligner(phon, { ...(THRESHOLD ? { threshold: THRESHOLD } : {}), ...(flags.has("--no-evidence") ? { requireEvidence: false } : {}), ...opts });
  if (process.env.DEBUG_ALIGN) al.debug = (d) => { if (d.mode !== "live") console.log("   ", JSON.stringify(d)); };
  const verdicts = [];
  /** Frame at which each word was first shown as recited (the on-screen cursor passed it). */
  const shownAt = [];
  let k = 0, cursor = 0;
  for (let now = STEP; now <= frames + STEP; now += STEP) {
    const batch = [];
    while (k < tokens.length && tokens[k].end <= now) batch.push(tokens[k++]);
    const u = al.push(batch, now);
    verdicts.push(...u.verdicts); cursor = u.cursor;
    while (shownAt.length < cursor) shownAt.push(now);
  }
  const liveCursor = cursor;
  const u = al.finish(frames + STEP);
  verdicts.push(...u.verdicts);
  return { words, verdicts, cursor: u.cursor, liveCursor, shownAt };
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
const stats = { cleanWords: 0, falseReds: 0, planted: 0, caught: 0, extraReds: 0, lat: [], shownLat: [], shownLatLater: [], unjudged: 0 };
const verdictOf = (r, i) => r.verdicts.find((y) => y.index === i && !y.ok) ?? r.verdicts.find((y) => y.index === i);
const show = (r) => r.words.map((x, i) => { const v = verdictOf(r, i); return !v ? `${x.w}(–)` : v.ok ? `${x.w}(${v.err.toFixed(2)} c${v.consBad.toFixed(1)}/${v.cons} conf${v.conf.toFixed(2)} f${v.startFrame}-${v.endFrame})` : `RED[${v.kind}] ${x.w}(${v.err.toFixed(2)} c${v.consBad.toFixed(1)}/${v.cons} conf${v.conf.toFixed(2)} f${v.startFrame}-${v.endFrame} heard ${heardToArabic(v.heard)})`; }).join("  ");
function score(label, r, plantedIdx = []) {
  for (let i = 0; i < r.words.length; i++) {
    const v = verdictOf(r, i);
    if (!v) { stats.unjudged++; continue; }
    if (v.endFrame >= 0) stats.lat.push((v.atFrame - v.endFrame) * FRAME_MS);
    if (v.endFrame >= 0 && r.shownAt[i] !== undefined) {
      stats.shownLat.push((r.shownAt[i] - v.endFrame) * FRAME_MS);
      // The first words after a start wait for a second clearly heard word; report the rest apart.
      if (i >= 3) stats.shownLatLater.push((r.shownAt[i] - v.endFrame) * FRAME_MS);
    }
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

// (d) the reciter pauses half-way and resumes: the app opens a new listener, whose clock restarts at 0
{
  const ids = manifest.cases.map((c) => c.lineId);
  const half = 6;
  const first = await hear(concat(manifest.cases.slice(0, half).map((c) => join(EVAL, c.wav)), "resume-a.wav"));
  const second = await hear(concat(manifest.cases.slice(half).map((c) => join(EVAL, c.wav)), "resume-b.wav"));
  const words = [], phon = [];
  for (const id of ids) { const l = lineById[id]; const ph = lineWordPhonemes(l.words); l.words.forEach((w, i) => { words.push({ w, line: id }); phon.push(ph[i]); }); }
  const al = new PhonemeAligner(phon);
  const verdicts = [];
  let cursor = 0;
  for (const part of [first, second]) {
    al.resetTo(cursor);
    let k = 0;
    for (let now = STEP; now <= part.frames + STEP; now += STEP) {
      const batch = [];
      while (k < part.tokens.length && part.tokens[k].end <= now) batch.push(part.tokens[k++]);
      const u = al.push(batch, now);
      verdicts.push(...u.verdicts); cursor = u.cursor;
    }
    const u = al.finish(part.frames + STEP);
    verdicts.push(...u.verdicts); cursor = u.cursor;
  }
  behaviours.resumeReds = new Set(verdicts.filter((v) => !v.ok).map((v) => v.index)).size;
  behaviours.resumeCursor = cursor;
  console.log(`pause-and-resume: ${behaviours.resumeReds} reds, cursor ${cursor}/${words.length}`);
  if (VERBOSE || behaviours.resumeReds) console.log(`  ${show({ words, verdicts })}`);
}

// (e) nobody is reciting: silence and noise, speech that is not the matn, and lines other than the expected ones.
// Nothing may be shown as recited or judged. Then: other speech first, the real recitation after it.
console.log("## not the recitation");
const other = { shown: 0, judged: 0, words: 0, afterChatterReds: 0, afterChatterCursor: 0, afterChatterWords: 0, chatterShown: 0 };
{
  const gen = (name, args) => { const out = join(outDir, name); execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args, "-ar", "16000", "-ac", "1", out]); return out; };
  const quiet = [
    ["silence", gen("silence.wav", ["-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "20"])],
    ["hiss", gen("hiss.wav", ["-f", "lavfi", "-i", "anoisesrc=d=20:c=white:a=0.02:r=16000"])],
    ["rumble", gen("rumble.wav", ["-f", "lavfi", "-i", "anoisesrc=d=20:c=brown:a=0.1:r=16000"])],
  ];
  const ids = manifest.cases.map((c) => c.lineId);
  const unrecorded = lines.map((l) => l.id).filter((id) => !ids.includes(id));
  const tally = (label, r) => {
    other.words += r.words.length; other.shown += r.cursor; other.judged += r.verdicts.length;
    if (VERBOSE || r.cursor || r.verdicts.length) console.log(`${label}: shown ${r.cursor}/${r.words.length}, judged ${r.verdicts.length}${r.verdicts.length ? `  ${show(r)}` : ""}`);
  };
  for (const [label, wav] of quiet) { const h = await hear(wav); tally(label, runSession(h.tokens, h.frames, ids.slice(0, 3))); }
  // Every real clip against eight lines it is not (a long expected text gives chance more words to hit).
  manifest.cases.forEach((c, i) => tally(`other lines (${c.lineId} audio)`, runSession(heardCache[c.wav].tokens, heardCache[c.wav].frames, unrecorded.slice(10 + i * 8, 18 + i * 8))));
  // English speech (macOS `say`), against the start of the matn, then followed by the real recitation.
  let english = null;
  try { english = join(outDir, "english.aiff"); execFileSync("say", ["-o", english, "The quick brown fox jumps over the lazy dog. I went to the market this morning and bought some bread, milk and eggs. Then I walked home."]); } catch { english = null; }
  const chatter = english ?? join(SEED, "swap_tuqa_huda.wav");
  if (english) { const h = await hear(english); for (const from of [0, 30, 60]) tally("english speech", runSession(h.tokens, h.frames, unrecorded.slice(from, from + 8))); }
  {
    const lead = await hear(chatter);
    const h = await hear(concat([chatter, ...manifest.cases.map((c) => join(EVAL, c.wav))], "chatter-then-recite.wav"));
    const r = runSession(h.tokens, h.frames, ids);
    other.chatterShown = r.shownAt.filter((f) => f <= lead.frames).length;
    other.afterChatterReds = new Set(r.verdicts.filter((v) => !v.ok).map((v) => v.index)).size;
    other.afterChatterCursor = r.cursor; other.afterChatterWords = r.words.length;
    console.log(`other speech, then the recitation: ${other.chatterShown} words shown during the other speech, then ${other.afterChatterReds} reds, cursor ${r.cursor}/${r.words.length}`);
    if (VERBOSE || other.afterChatterReds) console.log(`  ${show(r)}`);
  }
}

// (f) the reciter stops right before the last word(s) of a session and resumes (pause, "hear it",
// app to the background). The engine restarts the aligner at the cursor; the rest must still light up.
console.log("## pause before the last words, then resume");
const endings = { cases: 0, finished: 0, reds: 0, notFollowed: 0, selfCases: 0, selfFinished: 0 };
{
  const ids = manifest.cases.map((c) => c.lineId);
  const tryResume = (label, tokens, frames, lineIds, leave) => {
    const full = runSession(tokens, frames, lineIds);
    const total = full.words.length;
    const firstLeft = verdictOf(full, total - leave);
    const before = verdictOf(full, total - leave - 1);
    if (!firstLeft || !before || firstLeft.startFrame < 0 || before.endFrame < 0) return; // no clean place to cut
    const cut = Math.floor((before.endFrame + firstLeft.startFrame) / 2);
    const phon = [];
    for (const id of lineIds) phon.push(...lineWordPhonemes(lineById[id].words));
    const al = new PhonemeAligner(phon);
    const verdicts = [];
    let cursor = 0;
    const feed = (toks, len) => {
      let k = 0;
      for (let now = STEP; now <= len + STEP; now += STEP) {
        const batch = [];
        while (k < toks.length && toks[k].end <= now) batch.push(toks[k++]);
        const u = al.push(batch, now);
        verdicts.push(...u.verdicts); cursor = u.cursor;
      }
      const u = al.finish(len + STEP);
      verdicts.push(...u.verdicts); cursor = u.cursor;
    };
    feed(tokens.filter((t) => t.end <= cut), cut);
    const at = cursor;
    // Only the case in question: everything before the cut was followed when the reciter paused.
    if (at !== total - leave) { endings.notFollowed++; return; }
    al.resetTo(cursor);
    feed(tokens.filter((t) => t.end > cut).map((t) => ({ ...t, start: t.start - cut, end: t.end - cut })), frames - cut);
    const reds = new Set(verdicts.filter((v) => !v.ok).map((v) => v.index)).size;
    endings.cases++; endings.reds += reds;
    if (cursor >= total) endings.finished++;
    if (VERBOSE || cursor < total || reds) console.log(`${label}, ${leave} left: paused at ${at}/${total}, ended at ${cursor}/${total}, ${reds} reds`);
  };
  for (const c of manifest.cases) for (const leave of [1, 2]) tryResume(c.lineId, heardCache[c.wav].tokens, heardCache[c.wav].frames, [c.lineId], leave);
  // A one-line session must also finish by itself: the reciter says the line and waits two seconds, no tap.
  for (const c of manifest.cases) {
    const h = heardCache[c.wav];
    const phon = lineWordPhonemes(lineById[c.lineId].words);
    const al = new PhonemeAligner(phon);
    let k = 0, cursor = 0, reds = 0;
    for (let now = STEP; now <= h.frames + 56; now += STEP) {
      const batch = [];
      while (k < h.tokens.length && h.tokens[k].end <= now) batch.push(h.tokens[k++]);
      const u = al.push(batch, now);
      cursor = u.cursor; reds += u.verdicts.filter((v) => !v.ok).length;
    }
    endings.selfCases++;
    if (cursor >= phon.length && reds === 0) endings.selfFinished++;
    else console.log(`${c.lineId}: did not finish by itself (cursor ${cursor}/${phon.length}, ${reds} reds)`);
  }
}

// (g) the reciter is followed well, stops reciting, and other speech carries on with the mic open.
console.log("## followed well, then other speech");
const afterLock = { leaked: 0, judged: 0, words: 0 };
{
  const ids = manifest.cases.map((c) => c.lineId);
  const unrecorded = lines.map((l) => l.id).filter((id) => !ids.includes(id));
  for (const split of [3, 6, 9]) {
    // The first `split` clips are recited as expected; the rest of the audio is lines the session does not expect.
    const expected = [...ids.slice(0, split), ...unrecorded.slice(40, 46)];
    const h = await hear(concat(manifest.cases.map((c) => join(EVAL, c.wav)), `lock-${split}.wav`));
    const r = runSession(h.tokens, h.frames, expected);
    const real = ids.slice(0, split).reduce((a, id) => a + lineById[id].words.length, 0);
    const leaked = Math.max(0, r.cursor - real);
    const judged = r.verdicts.filter((v) => v.index >= real).length;
    afterLock.leaked += leaked; afterLock.judged += judged; afterLock.words += r.words.length - real;
    console.log(`after ${split} recited lines: ${leaked} of ${r.words.length - real} unrecited words shown, ${judged} judged (cursor ${r.cursor}, real ${real})`);
    if (VERBOSE && (leaked || judged)) console.log(`  ${show(r)}`);
  }
}

// (h) the reciter reaches the last word, goes back one to three lines for a run-up, and finishes.
console.log("## run-up before the last word");
const runUp = { cases: 0, finished: 0, reds: 0 };
// (i) the recitation with someone talking in the room, 15 dB under it: the rule must not lose the reciter.
const talkOver = { on: null, off: null };
{
  const ids = manifest.cases.map((c) => c.lineId);
  const files = manifest.cases.map((c) => join(EVAL, c.wav));
  const sessionWav = concat(files, "session-all.wav");
  const full = await hear(sessionWav);
  const fr = runSession(full.tokens, full.frames, ids);
  const total = fr.words.length;
  const lastV = verdictOf(fr, total - 1), prevV = verdictOf(fr, total - 2);
  const head = join(outDir, "head.wav");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", sessionWav, "-t", String(((prevV.endFrame + lastV.startFrame) / 2) * FRAME_MS / 1000), "-ar", "16000", "-ac", "1", head]);
  for (const back of [1, 2, 3]) {
    const h = await hear(concat([head, ...files.slice(files.length - back)], `runup${back}.wav`));
    const r = runSession(h.tokens, h.frames, ids);
    const reds = new Set(r.verdicts.filter((v) => !v.ok).map((v) => v.index)).size;
    runUp.cases++; runUp.reds += reds;
    if (r.cursor >= total) runUp.finished++;
    if (VERBOSE || r.cursor < total || reds) console.log(`run-up of ${back}: cursor ${r.cursor}/${total}, ${reds} reds`);
  }
  let talk = null;
  try { talk = join(outDir, "talk.aiff"); execFileSync("say", ["-o", talk, "The quick brown fox jumps over the lazy dog. I went to the market this morning and bought some bread, milk and eggs. Then I walked home."]); } catch { talk = null; }
  if (talk) {
    const rms = (wav) => { const a = readAudio(wav); let q = 0; for (const x of a) q += x * x; return Math.sqrt(q / a.length); };
    const gain = Math.pow(10, -15 / 20) * rms(sessionWav) / rms(talk);
    const mixed = join(outDir, "talk-over.wav");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", sessionWav, "-stream_loop", "-1", "-i", talk, "-filter_complex", `[1:a]volume=${gain}[b];[0:a][b]amix=inputs=2:duration=first:normalize=0`, "-t", String(full.frames * FRAME_MS / 1000), "-ar", "16000", "-ac", "1", mixed]);
    const h = await hear(mixed);
    for (const key of ["on", "off"]) {
      const r = runSession(h.tokens, h.frames, ids, key === "off" ? { requireEvidence: false } : {});
      talkOver[key] = { live: r.liveCursor, cursor: r.cursor, total, reds: new Set(r.verdicts.filter((v) => !v.ok).map((v) => v.index)).size };
    }
    console.log(`talk 15 dB under the recitation: followed ${talkOver.on.live}/${total} live with ${talkOver.on.reds} reds (without the evidence rule: ${talkOver.off.live}/${total}, ${talkOver.off.reds} reds)`);
  }
}

const lat = stats.lat.sort((a, b) => a - b);
const pct = (q) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * q))] : 0);
const shownLat = stats.shownLat.sort((a, b) => a - b);
const spct = (q) => (shownLat.length ? shownLat[Math.min(shownLat.length - 1, Math.floor(shownLat.length * q))] : 0);
console.log("\n# result");
const uniqueWords = manifest.cases.reduce((n, c) => n + lineById[c.lineId].words.length, 0);
console.log(`false reds on clean audio: ${stats.falseReds} in ${stats.cleanWords} verdicts (gate: <= ${MAX_FALSE_REDS}). These are ${uniqueWords} recorded words, judged alone, stitched into one session, and beside planted mistakes.`);
console.log(`planted mistakes caught: ${stats.caught} / ${stats.planted} (4 distinct mistakes, each alone and inside a session); extra reds beside them: ${stats.extraReds}`);
console.log(`words never judged: ${stats.unjudged}`);
console.log(`left-out line: ${behaviours.skippedLineReds}/${behaviours.skippedLineWords} words flagged; repeated line: ${behaviours.repeatReds} reds; restart two lines back: ${behaviours.restartReds} reds; pause and resume: ${behaviours.resumeReds} reds`);
console.log(`not the recitation (silence, noise, other lines, other speech): ${other.shown} of ${other.words} expected words shown as recited, ${other.judged} judged (gate: 0 and 0)`);
console.log(`pause before the last one or two words, then resume: ${endings.finished} of ${endings.cases} lines finished, ${endings.reds} reds (${endings.notFollowed} more not counted: too few words before the pause to be followed)`);
console.log(`run-up of one to three lines before the last word: ${runUp.finished} of ${runUp.cases} sessions finished, ${runUp.reds} reds`);
if (talkOver.on) console.log(`someone talking 15 dB under the recitation: ${talkOver.on.live}/${talkOver.on.total} words followed live, ${talkOver.on.reds} reds (without the evidence rule: ${talkOver.off.live}, ${talkOver.off.reds} reds)`);
console.log(`one-line sessions that finish by themselves two seconds after the last word: ${endings.selfFinished} of ${endings.selfCases}`);
console.log(`followed well, then other speech: ${afterLock.leaked} of ${afterLock.words} unrecited words shown, ${afterLock.judged} judged (gate: at most one shown per case, none judged)`);
console.log(`other speech first, then the recitation: ${other.chatterShown} words shown early, ${other.afterChatterReds} reds, cursor ${other.afterChatterCursor}/${other.afterChatterWords}`);
const later = stats.shownLatLater.sort((a, b) => a - b);
const lpct = (q) => (later.length ? later[Math.min(later.length - 1, Math.floor(later.length * q))] : 0);
console.log(`word lights up after it ended: median ${spct(0.5)} ms, p90 ${spct(0.9)} ms, max ${shownLat[shownLat.length - 1] ?? 0} ms; from the fourth word of a session on: median ${lpct(0.5)} ms, p90 ${lpct(0.9)} ms`);
console.log(`verdict delay after the word ended: median ${pct(0.5)} ms, p90 ${pct(0.9)} ms, max ${lat[lat.length - 1] ?? 0} ms`);
console.log(`listener speed: ${(audioMs / cpuMs).toFixed(0)}x real time on this machine (onnxruntime-node, 1 thread)`);
await backend.release();
const failed = stats.falseReds > MAX_FALSE_REDS || stats.caught < stats.planted || stats.extraReds > 0 || stats.unjudged > 0 ||
  behaviours.skippedLineReds < behaviours.skippedLineWords || behaviours.repeatReds > 0 || behaviours.restartReds > 0 || behaviours.resumeReds > 0 ||
  other.shown > 0 || other.judged > 0 || other.chatterShown > 0 || other.afterChatterReds > 0 || other.afterChatterCursor < other.afterChatterWords ||
  endings.finished < endings.cases || endings.reds > 0 || endings.selfFinished < endings.selfCases ||
  runUp.finished < runUp.cases || runUp.reds > 0 || (talkOver.on && (talkOver.on.live < talkOver.off.live || talkOver.on.reds > talkOver.off.reds)) || afterLock.judged > 0 || afterLock.leaked > 3;
console.log(failed ? "GATE FAILED" : "GATE PASSED");
process.exit(failed ? 1 : 0);
