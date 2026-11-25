/**
 * Fetch the on-device listener model into app/assets/models/ (gitignored, ~68 MB).
 *
 * The model is Tilawa's "spliced-clean" streaming phoneme model (CC BY 4.0,
 * https://github.com/yazinsai/tilawa). Its URL, size and sha256 live in
 * app/src/lib/recite/listener/model.json. Runs on `npm install` in app/ and is a
 * no-op when the file is already there and matches.
 *
 * Usage: node scripts/fetch-listener-model.mjs [--check]
 */
import { createHash } from "crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "app/src/lib/recite/listener/model.json"), "utf8"));
export const MODEL_PATH = join(root, "app/assets/models/listener.onnx");
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const good = (file) => existsSync(file) && statSync(file).size === manifest.bytes && sha(file) === manifest.sha256;

async function main() {
  if (good(MODEL_PATH)) return console.log("listener model: present");
  if (process.argv.includes("--check")) { console.error("listener model: missing or wrong. Run: node scripts/fetch-listener-model.mjs"); process.exit(1); }
  mkdirSync(dirname(MODEL_PATH), { recursive: true });
  const cached = join(homedir(), ".cache/tilawa", `${manifest.id}@${manifest.version}`, "model.onnx");
  if (good(cached)) { copyFileSync(cached, MODEL_PATH); return console.log("listener model: copied from the local Tilawa cache"); }
  console.log(`listener model: downloading ${(manifest.bytes / 1e6).toFixed(0)} MB from ${manifest.url}`);
  const res = await fetch(manifest.url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== manifest.sha256) throw new Error(`sha256 mismatch: got ${got}`);
  writeFileSync(MODEL_PATH, bytes);
  console.log("listener model: saved");
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
