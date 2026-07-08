/**
 * Grep-friendly build marker for Share logs / Metro.
 * If a recite log does NOT contain RECITE_BUILD_TAG, the device is running stale JS.
 */
export const RECITE_BUILD_TAG = "MUTOON_RECITE_BUILD=align-trust-v4";

/** Bump when align-trust behavior changes (must match log expectations). */
export const RECITE_ALIGN_TRUST_VERSION = 4;

export const RECITE_ALIGN_FEATURES = {
  commitGraceMs: 1_200,
  maxSkipMissesPerStep: 1,
  /** v4: skip-ahead misses with a competing heard token are painted as `wrong`. */
  substitutionDetection: true,
  /** v4: live omission reds suppressed (recovered post-session); see engine. */
  omissionPolicy: "suppress" as const,
  /** v4: Deepgram word timings + confidence logged for acoustic reconciliation. */
  wordTimings: true,
  /** v4: at stop, the live mistakes are replaced by the acoustic reconcile. */
  reconcileAtStop: true,
  logMarkers: [
    "commitGraceSkip",
    "skipAheadMissesIgnored",
    "heardStream",
    "heardTimeline",
    "reconciled",
  ] as const,
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
    alignTrustVersion: RECITE_ALIGN_TRUST_VERSION,
    appVersion,
    commitGraceMs: RECITE_ALIGN_FEATURES.commitGraceMs,
    maxSkipMissesPerStep: RECITE_ALIGN_FEATURES.maxSkipMissesPerStep,
    substitutionDetection: RECITE_ALIGN_FEATURES.substitutionDetection,
    omissionPolicy: RECITE_ALIGN_FEATURES.omissionPolicy,
    wordTimings: RECITE_ALIGN_FEATURES.wordTimings,
    reconcileAtStop: RECITE_ALIGN_FEATURES.reconcileAtStop,
    expectLogMarkers: [...RECITE_ALIGN_FEATURES.logMarkers],
    dev: typeof __DEV__ !== "undefined" ? __DEV__ : null,
  };
}
