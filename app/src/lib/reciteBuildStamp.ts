/**
 * Grep-friendly build marker for Share logs / Metro.
 * If a recite log does NOT contain RECITE_BUILD_TAG, the device is running stale JS.
 */
export const RECITE_BUILD_TAG = "MUTOON_RECITE_BUILD=on-device-v1";
/** Bump when the listener model, the phonemizer or the aligner's rules change. */
export const RECITE_ENGINE_VERSION = 1;
export const RECITE_ENGINE = {
  listener: "tilawa spliced-clean@1-int8 (on-device, ONNX Runtime)",
  aligner: "phonemeAlign: live phoneme alignment, slips = wrong | skipped",
} as const;
export function getReciteBuildFingerprint(): Record<string, unknown> {
  let appVersion: string | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Constants = require("expo-constants").default as {
      expoConfig?: { version?: string };
    };
    appVersion = Constants.expoConfig?.version;
  } catch {
    appVersion = undefined;
  }

  return {
    tag: RECITE_BUILD_TAG,
    engineVersion: RECITE_ENGINE_VERSION,
    appVersion,
    listener: RECITE_ENGINE.listener,
    aligner: RECITE_ENGINE.aligner,
    dev: typeof __DEV__ !== "undefined" ? __DEV__ : null,
  };
}
