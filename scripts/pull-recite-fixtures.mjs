/**
 * Pull recite-log fixture pairs from a connected iPhone (RAI-12).
 *
 * One command turns on-device recite sessions into checked-in accuracy
 * fixtures: it lists Documents/recite-logs/ inside the app's data container
 * (bundle id com.mutoon.tarteel), copies the newest logs into
 * samples/recite-logs/, runs scripts/parse-recite-log.mjs on each, and
 * scaffolds a <timestamp>_labels.json next to each log so the reciter only
 * has to *confirm* ground truth instead of authoring it from scratch.
 *
 * Usage:
 *   node scripts/pull-recite-fixtures.mjs [--device=<udid>] [--count=2]
 *                                         [--all] [--min-kb=4] [--dry-run]
 *   npm --prefix app run recite:pull [-- --dry-run]
 *
 * Selection: the N most recent device logs (default 2, --count) that are
 * newer than the newest fixture already in samples/recite-logs/ and not
 * already present locally. --all drops the "newer than newest" filter (it
 * still never overwrites an existing fixture). Logs under --min-kb (default
 * 4 KB) are treated as aborted sessions and skipped.
 *
 * Requires Xcode's devicectl (`xcrun devicectl`) and a paired, unlocked
 * iPhone with a dev build of the app. Note the devicectl asymmetry:
 * `info files` takes --username, `copy from` takes --user.
 */

import { spawnSync } from "child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const BUNDLE_ID = "com.mutoon.tarteel";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPT_DIR);
const SAMPLES_DIR = join(REPO_ROOT, "samples", "recite-logs");
const PARSE_SCRIPT = join(SCRIPT_DIR, "parse-recite-log.mjs");
const DEVICE_LOG_DIR = "Documents/recite-logs";
const LOG_NAME_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)_(.+)\.log$/;

// --- CLI ---

const HELP = `pull-recite-fixtures — copy recite logs off an iPhone and scaffold label files

usage: node scripts/pull-recite-fixtures.mjs [options]
       npm --prefix app run recite:pull [-- options]

options:
  --device=<udid>   device UDID (skips auto-discovery; also accepts the
                    devicectl name/identifier). Default: the single paired
                    iPhone, or the single tunnel-connected one if several.
  --count=<n>       pull at most n logs, newest first (default 2)
  --all             consider every device log not yet in samples/recite-logs/
                    (default: only logs newer than the newest local fixture)
  --min-kb=<n>      skip logs smaller than n KB — aborted sessions (default 4;
                    0 disables)
  --dry-run         discover + list + show selection, but copy nothing
  --help            this text

workflow:
  1. On the device, record a clean session and a seeded-errors session
     (Recite writes ${DEVICE_LOG_DIR}/<timestamp>_<matnId>_<mode>.log).
  2. npm --prefix app run recite:pull
  3. Edit each scaffolded *_labels.json: move deliberate errors into
     intentional[] (with kind: swap|omit and the heard word) and confirm every
     "TODO confirm" note in notIntentional[].
  4. Gate it (see next-steps output), e.g. add to app/package.json:
     node ../scripts/recite-align-test.mjs ../samples/recite-logs/<log> \\
       ../samples/recite-logs/<ts>_labels.json --max-false-subs=0
`;

function parseArgs(argv) {
  const args = {
    device: null,
    count: 2,
    all: false,
    minKb: 4,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--all") args.all = true;
    else if (a.startsWith("--device=")) args.device = a.slice(9);
    else if (a === "--device") args.device = argv[++i] ?? null;
    else if (a.startsWith("--count=")) args.count = Number(a.slice(8));
    else if (a === "--count") args.count = Number(argv[++i]);
    else if (a.startsWith("--min-kb=")) args.minKb = Number(a.slice(9));
    else {
      console.error(`Unknown argument: ${a}\n`);
      console.error(HELP);
      process.exit(2);
    }
  }
  if (!Number.isFinite(args.count) || args.count < 1) args.count = 2;
  if (!Number.isFinite(args.minKb) || args.minKb < 0) args.minKb = 4;
  return args;
}

function fail(msg) {
  console.error(`\n[pull-recite-fixtures] ${msg}`);
  process.exit(1);
}

// --- devicectl helpers ---

/** Run `xcrun devicectl <args>` with --json-output and return the parsed JSON. */
function devicectlJson(args, { timeoutMs = 120_000 } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "recite-pull-"));
  const jsonPath = join(tmp, "out.json");
  try {
    const res = spawnSync(
      "xcrun",
      ["devicectl", ...args, "--json-output", jsonPath],
      { encoding: "utf8", timeout: timeoutMs }
    );
    if (res.error) throw res.error;
    if (res.status !== 0) {
      const err = new Error(
        (res.stderr || res.stdout || "").trim() ||
          `devicectl ${args.join(" ")} exited ${res.status}`
      );
      err.devicectl = true;
      throw err;
    }
    return JSON.parse(readFileSync(jsonPath, "utf8"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function discoverDevice() {
  let devices = [];
  try {
    const json = devicectlJson(["list", "devices"]);
    devices = json?.result?.devices ?? [];
  } catch (e) {
    // Fall back to xctrace text parsing if devicectl itself is unhappy.
    const alt = discoverViaXctrace();
    if (alt) return alt;
    fail(`device discovery failed: ${e.message}\nPass --device=<udid> explicitly.`);
  }

  const phones = devices
    .map((d) => ({
      name: d.deviceProperties?.name ?? "?",
      udid: d.hardwareProperties?.udid ?? d.identifier,
      type:
        d.hardwareProperties?.deviceType ??
        d.hardwareProperties?.productType ??
        "",
      paired: d.connectionProperties?.pairingState === "paired",
      tunnel: d.connectionProperties?.tunnelState ?? "unknown",
    }))
    .filter((d) => /iPhone/i.test(d.type) && d.paired && d.udid);

  if (phones.length === 0) {
    fail(
      "no paired iPhone found via `xcrun devicectl list devices`.\n" +
        "Pair/connect the phone (same network or USB) or pass --device=<udid>."
    );
  }
  if (phones.length === 1) return pick(phones[0], "only paired iPhone");

  const connected = phones.filter((d) => d.tunnel === "connected");
  if (connected.length === 1) {
    return pick(connected[0], "only tunnel-connected iPhone");
  }

  console.error("Multiple paired iPhones — pass --device=<udid>:");
  for (const d of phones) {
    console.error(`  ${d.udid}  ${d.name}  (tunnel: ${d.tunnel})`);
  }
  process.exit(2);

  function pick(d, why) {
    console.log(`device      : ${d.name} (${d.udid}) — ${why}`);
    return d.udid;
  }
}

/** Last-resort discovery: `xcrun xctrace list devices` (physical section only). */
function discoverViaXctrace() {
  const res = spawnSync("xcrun", ["xctrace", "list", "devices"], {
    encoding: "utf8",
    timeout: 60_000,
  });
  if (res.status !== 0 || !res.stdout) return null;
  const physical = res.stdout.split(/==\s*Simulators\s*==/)[0];
  const found = [];
  for (const line of physical.split("\n")) {
    // e.g. "Raif's iPhone (26.1) (00008110-001E596A3A20401E)"
    const m = line.match(/^(.*?)\s+\([^)]*\)\s+\(([0-9A-Fa-f]{8}-[0-9A-Fa-f]{16})\)\s*$/);
    if (m && /iphone/i.test(m[1])) found.push({ name: m[1].trim(), udid: m[2] });
  }
  if (found.length !== 1) return null;
  console.log(`device      : ${found[0].name} (${found[0].udid}) — via xctrace fallback`);
  return found[0].udid;
}

function listDeviceLogs(udid) {
  let json;
  try {
    json = devicectlJson([
      "device",
      "info",
      "files",
      "--device",
      udid,
      "--username",
      "mobile",
      "--domain-type",
      "appDataContainer",
      "--domain-identifier",
      BUNDLE_ID,
      "--subdirectory",
      DEVICE_LOG_DIR,
    ]);
  } catch (e) {
    fail(
      `could not list ${DEVICE_LOG_DIR} on device ${udid}:\n${e.message}\n` +
        "Is the phone unlocked and connected, with a dev build of the app that " +
        "has recorded at least one Recite session?"
    );
  }
  return (json?.result?.files ?? [])
    .filter((f) => !f.resources?.isDirectory && LOG_NAME_RE.test(f.name ?? ""))
    .map((f) => ({
      name: f.name,
      size: f.metadata?.size ?? 0,
      modified: f.metadata?.lastModDate ?? null,
    }))
    .sort((a, b) => (a.name < b.name ? 1 : -1)); // timestamp prefix ⇒ newest first
}

function copyFromDevice(udid, name, dest) {
  const res = spawnSync(
    "xcrun",
    [
      "devicectl",
      "device",
      "copy",
      "from",
      "--device",
      udid,
      "--user", // NB: `copy from` takes --user, `info files` takes --username
      "mobile",
      "--domain-type",
      "appDataContainer",
      "--domain-identifier",
      BUNDLE_ID,
      "--source",
      `${DEVICE_LOG_DIR}/${name}`,
      "--destination",
      dest,
    ],
    { encoding: "utf8", timeout: 180_000 }
  );
  if (res.status !== 0 || !existsSync(dest)) {
    fail(
      `copy failed for ${name}:\n${(res.stderr || res.stdout || "").trim()}`
    );
  }
}

// --- Log parsing for the labels scaffold (mirrors parse-recite-log.mjs) ---

const LINE_RE = /^\[MutoonRecite\]\s+(?:#(\d+)\s+)?(.*?)\s+(\{.*\})\s*$/;

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function parseLogForScaffold(text) {
  const out = { startedAt: null, matnId: null, warnMistakes: [], reconciled: null };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (line.startsWith("#")) {
      const started = line.match(/^#\s*started:\s*(\S+)/);
      if (started && !out.startedAt) out.startedAt = started[1];
      const meta = line.match(/^#\s*meta:\s*(\{.*\})\s*$/);
      if (meta) out.matnId = safeJson(meta[1])?.matnId ?? out.matnId;
      continue;
    }
    const m = line.match(LINE_RE);
    if (!m) continue;
    const name = m[2].trim();
    const data = safeJson(m[3]);
    if (!data) continue;
    if (name === "WARN mistake") out.warnMistakes.push(data);
    else if (name === "session.reconciled") out.reconciled = data; // last one wins
  }
  return out;
}

/**
 * Scaffold <ts>_labels.json next to the log (skipped if it already exists).
 * notIntentional[] is pre-populated from the authoritative reconciled reds
 * (falling back to live "WARN mistake" events for older logs); every entry
 * carries a "TODO confirm" note so the reciter edits instead of authoring.
 */
function scaffoldLabels(logPath) {
  const name = basename(logPath);
  const [, ts, rest] = name.match(LOG_NAME_RE);
  const labelsPath = join(dirname(logPath), `${ts}_labels.json`);
  if (existsSync(labelsPath)) return { labelsPath, created: false };

  const parsed = parseLogForScaffold(readFileSync(logPath, "utf8"));
  const liveIdx = new Set(
    parsed.warnMistakes.map((w) => w.globalWordIndex).filter((i) => i != null)
  );

  let notIntentional = [];
  if (parsed.reconciled?.mistakes?.length) {
    notIntentional = parsed.reconciled.mistakes.map((m) => ({
      globalWordIndex: m.i,
      expected: m.expected ?? "?",
      inUiMistakes: liveIdx.has(m.i),
      note: `TODO confirm${m.heard ? ` — reconciled heard "${m.heard}"` : ""} (move to intentional[] with kind+heard if this error was seeded)`,
    }));
    // Live reds the reconcile suppressed are still worth confirming.
    const reconciledIdx = new Set(parsed.reconciled.mistakes.map((m) => m.i));
    const liveOnly = new Map();
    for (const w of parsed.warnMistakes) {
      if (w.globalWordIndex == null || reconciledIdx.has(w.globalWordIndex)) continue;
      liveOnly.set(w.globalWordIndex, w);
    }
    for (const [idx, w] of [...liveOnly.entries()].sort((a, b) => a[0] - b[0])) {
      notIntentional.push({
        globalWordIndex: idx,
        expected: w.expected ?? "?",
        inUiMistakes: true,
        note: `TODO confirm — live red only, suppressed by reconcile${w.recognized ? ` (live heard "${w.recognized}")` : ""}`,
      });
    }
  } else {
    const byIdx = new Map();
    for (const w of parsed.warnMistakes) {
      if (w.globalWordIndex == null) continue;
      byIdx.set(w.globalWordIndex, w); // last event wins
    }
    notIntentional = [...byIdx.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([idx, w]) => ({
        globalWordIndex: idx,
        expected: w.expected ?? "?",
        inUiMistakes: true,
        note: `TODO confirm${w.recognized ? ` — live heard "${w.recognized}"` : " — no heard token (likely ASR drop)"} (move to intentional[] with kind+heard if this error was seeded)`,
      }));
  }

  const matnId =
    parsed.matnId ?? rest.replace(/_(cloud|voice)$/, "");
  const recordedAt =
    parsed.startedAt ??
    ts.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z");

  const labels = {
    log: name,
    matnId,
    session: "TODO confirm: clean | seeded-errors",
    recordedAt,
    notes:
      "TODO confirm — scaffolded by scripts/pull-recite-fixtures.mjs. Move each deliberate error into intentional[] (kind: swap|omit, plus the heard word), and replace every TODO note in notIntentional[] with why the red was not a real error.",
    intentional: [],
    notIntentional,
  };
  writeFileSync(labelsPath, JSON.stringify(labels, null, 2) + "\n");
  return { labelsPath, created: true };
}

// --- Selection ---

function localState() {
  const names = existsSync(SAMPLES_DIR)
    ? readdirSync(SAMPLES_DIR).filter((n) => LOG_NAME_RE.test(n))
    : [];
  const newestTs = names
    .map((n) => n.match(LOG_NAME_RE)[1])
    .sort()
    .pop() ?? null;
  return { names: new Set(names), newestTs };
}

function selectLogs(deviceLogs, local, args) {
  const skipped = { existing: 0, older: 0, tiny: 0 };
  const candidates = [];
  for (const f of deviceLogs) {
    if (local.names.has(f.name)) {
      skipped.existing++;
      continue;
    }
    const ts = f.name.match(LOG_NAME_RE)[1];
    if (!args.all && local.newestTs && ts <= local.newestTs) {
      skipped.older++;
      continue;
    }
    if (args.minKb > 0 && f.size < args.minKb * 1024) {
      skipped.tiny++;
      continue;
    }
    candidates.push(f);
  }
  return { picked: candidates.slice(0, args.count), skipped };
}

// --- Main ---

function kb(size) {
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  const udid = args.device ?? discoverDevice();
  if (args.device) console.log(`device      : ${udid} (from --device)`);

  const deviceLogs = listDeviceLogs(udid);
  const local = localState();
  console.log(
    `device logs : ${deviceLogs.length} in ${DEVICE_LOG_DIR} — local fixtures: ${local.names.size}${
      local.newestTs ? ` (newest ${local.newestTs})` : ""
    }`
  );

  const { picked, skipped } = selectLogs(deviceLogs, local, args);
  const skipNote = [
    skipped.existing && `${skipped.existing} already local`,
    skipped.older && `${skipped.older} older than newest fixture (use --all)`,
    skipped.tiny && `${skipped.tiny} under ${args.minKb} KB (aborted; --min-kb=0 to include)`,
  ]
    .filter(Boolean)
    .join(", ");
  if (skipNote) console.log(`skipped     : ${skipNote}`);

  if (picked.length === 0) {
    console.log("\nNothing new to pull. Record a Recite session on the device first.");
    return;
  }

  console.log(`\n${args.dryRun ? "Would pull" : "Pulling"} ${picked.length} log(s):`);
  for (const f of picked) {
    console.log(`  ${f.name}  (${kb(f.size)}${f.modified ? `, modified ${f.modified}` : ""})`);
  }
  if (args.dryRun) {
    console.log("\n--dry-run: nothing copied.");
    return;
  }

  const pulled = [];
  for (const f of picked) {
    const dest = join(SAMPLES_DIR, f.name);
    copyFromDevice(udid, f.name, dest);
    console.log(`\n=== pulled ${f.name} ===`);

    const parse = spawnSync("node", [PARSE_SCRIPT, dest], {
      encoding: "utf8",
      timeout: 60_000,
    });
    process.stdout.write(parse.stdout ?? "");
    if (parse.status !== 0) {
      process.stderr.write(parse.stderr ?? "");
      console.warn(`[warn] parse-recite-log exited ${parse.status} for ${f.name}`);
    }

    const { labelsPath, created } = scaffoldLabels(dest);
    console.log(
      created
        ? `labels      : scaffolded ${labelsPath}`
        : `labels      : ${labelsPath} already exists — left untouched`
    );
    pulled.push({ log: dest, labelsPath });
  }

  console.log("\nNext steps:");
  for (const p of pulled) {
    const logName = basename(p.log);
    const labelsName = basename(p.labelsPath);
    console.log(`  1. Edit ${p.labelsPath}`);
    console.log(
      "     — set session (clean | seeded-errors), move seeded errors into intentional[]"
    );
    console.log(
      '     — confirm/replace every "TODO confirm" note in notIntentional[]'
    );
    console.log(`  2. Gate it (recite:golden-device style):`);
    console.log(
      `     node ${join(REPO_ROOT, "scripts/recite-align-test.mjs")} \\\n` +
        `       ${join(SAMPLES_DIR, logName)} \\\n` +
        `       ${join(SAMPLES_DIR, labelsName)} --max-false-subs=0`
    );
    console.log(
      `     then add it as an npm script next to recite:golden-device in app/package.json.`
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}

export { parseLogForScaffold, scaffoldLabels };
