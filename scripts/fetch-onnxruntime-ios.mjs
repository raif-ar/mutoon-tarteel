/**
 * Fetch the ONNX Runtime iOS framework for the native listener module into
 * app/modules/recite-listener/ios/Frameworks/ (gitignored, ~200 MB unpacked).
 *
 * Source: the official Microsoft.ML.OnnxRuntime NuGet package (MIT). The CocoaPods
 * archive host for onnxruntime-c was unreachable on 2026-11-25, and the NuGet
 * package carries the same static xcframework (device + simulator slices).
 * Runs on `npm install` in app/ (macOS only); a no-op when already in place.
 *
 * Usage: node scripts/fetch-onnxruntime-ios.mjs [--check]
 * ORT_XCFRAMEWORK_ZIP=<path> uses an already-downloaded inner zip (still sha-checked).
 */
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const VERSION = "1.31.1";
const NUPKG_SHA256 = "6871ccbc97f3d5bdb4095a1dcec33aa78d56f6ed8de5980ef5fa1d9f2e7c679a";
const XCFRAMEWORK_ZIP_SHA256 = "d871ff5f3fa0beef014d5baff965ac6ba5c2724d37b2de2d738d8bc78fcca3a4";
const URL = `https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime/${VERSION}/microsoft.ml.onnxruntime.${VERSION}.nupkg`;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "app/modules/recite-listener/ios/Frameworks");
const marker = join(dest, "onnxruntime.version");
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

const DROP_CATALYST = `
import plistlib, sys
p = sys.argv[1]
d = plistlib.load(open(p, "rb"))
d["AvailableLibraries"] = [l for l in d["AvailableLibraries"] if l.get("SupportedPlatformVariant") != "maccatalyst"]
plistlib.dump(d, open(p, "wb"))
`;

async function main() {
  if (process.platform !== "darwin") return console.log("onnxruntime (iOS): skipped, not macOS");
  if (existsSync(join(dest, "onnxruntime.xcframework/Info.plist")) && existsSync(marker) && readFileSync(marker, "utf8").trim() === VERSION) {
    return console.log(`onnxruntime (iOS): ${VERSION} present`);
  }
  if (process.argv.includes("--check")) {
    console.error("onnxruntime (iOS): missing. Run: node scripts/fetch-onnxruntime-ios.mjs");
    process.exit(1);
  }
  const work = mkdtempSync(join(tmpdir(), "ort-ios-"));
  try {
    mkdirSync(dest, { recursive: true });
    const inner = join(work, "onnxruntime.xcframework.zip");
    const local = process.env.ORT_XCFRAMEWORK_ZIP;
    if (local && existsSync(local)) {
      writeFileSync(inner, readFileSync(local));
    } else {
      console.log(`onnxruntime (iOS): downloading ${VERSION} from nuget.org (about 160 MB)`);
      const res = await fetch(URL);
      if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
      const nupkg = Buffer.from(await res.arrayBuffer());
      if (sha(nupkg) !== NUPKG_SHA256) throw new Error("nupkg sha256 mismatch");
      const pkg = join(work, "ort.nupkg");
      writeFileSync(pkg, nupkg);
      execFileSync("unzip", ["-o", "-q", pkg, "runtimes/ios/native/onnxruntime.xcframework.zip", "LICENSE", "-d", work]);
      writeFileSync(inner, readFileSync(join(work, "runtimes/ios/native/onnxruntime.xcframework.zip")));
      writeFileSync(join(dest, "LICENSE-onnxruntime.txt"), readFileSync(join(work, "LICENSE")));
    }
    if (sha(readFileSync(inner)) !== XCFRAMEWORK_ZIP_SHA256) throw new Error("xcframework zip sha256 mismatch");
    rmSync(join(dest, "onnxruntime.xcframework"), { recursive: true, force: true });
    execFileSync("unzip", ["-o", "-q", inner, "-d", dest]);
    // The app ships iPhone and simulator builds only.
    rmSync(join(dest, "onnxruntime.xcframework/ios-arm64_x86_64-maccatalyst"), { recursive: true, force: true });
    execFileSync("python3", ["-c", DROP_CATALYST, join(dest, "onnxruntime.xcframework/Info.plist")]);
    writeFileSync(marker, VERSION + "\n");
    console.log(`onnxruntime (iOS): ${VERSION} installed`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(String(e.message ?? e));
  process.exit(1);
});
