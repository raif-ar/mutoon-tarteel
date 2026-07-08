import Constants from "expo-constants";

/**
 * ASR runtime configuration.
 *
 * Non-secret defaults live in `app.json` `extra.asr`; secrets and overrides come
 * from `EXPO_PUBLIC_ASR_*` env vars (inlined at build time by Expo). Never commit
 * a real key — use a scoped/rotatable key or an ephemeral-token endpoint for beta.
 */

export type CloudVendor = "deepgram" | "openai";

export interface AsrConfig {
  cloudVendor: CloudVendor;
  deepgram: {
    apiKey?: string;
    /** Short-lived token endpoint (preferred over embedding a long-lived key). */
    tokenUrl?: string;
    model: string;
    language: string;
  };
  openai: {
    apiKey?: string;
    tokenUrl?: string;
    model: string;
  };
}

interface ExtraAsr {
  cloudVendor?: CloudVendor;
  deepgramModel?: string;
  deepgramLanguage?: string;
  openaiTranscriptionModel?: string;
}

function extra(): ExtraAsr {
  const e = (Constants.expoConfig?.extra ?? {}) as { asr?: ExtraAsr };
  return e.asr ?? {};
}

// Babel's Expo env-inlining transform only rewrites literal `process.env.EXPO_PUBLIC_X`
// member access at build time (RN has no real process.env at runtime) — a generic
// `process.env[key]` helper can't be statically inlined, so each var is read directly here.
function normalize(v: string | undefined): string | undefined {
  return v && v.length > 0 ? v : undefined;
}

let cached: AsrConfig | null = null;

export function getAsrConfig(): AsrConfig {
  if (cached) return cached;
  const x = extra();
  cached = {
    cloudVendor:
      (normalize(process.env.EXPO_PUBLIC_ASR_CLOUD_VENDOR) as
        | CloudVendor
        | undefined) ??
      x.cloudVendor ??
      "deepgram",
    deepgram: {
      apiKey: normalize(process.env.EXPO_PUBLIC_ASR_DEEPGRAM_KEY),
      tokenUrl: normalize(process.env.EXPO_PUBLIC_ASR_DEEPGRAM_TOKEN_URL),
      model:
        normalize(process.env.EXPO_PUBLIC_ASR_DEEPGRAM_MODEL) ??
        x.deepgramModel ??
        "nova-3",
      language:
        normalize(process.env.EXPO_PUBLIC_ASR_DEEPGRAM_LANGUAGE) ??
        x.deepgramLanguage ??
        "ar",
    },
    openai: {
      apiKey: normalize(process.env.EXPO_PUBLIC_ASR_OPENAI_KEY),
      tokenUrl: normalize(process.env.EXPO_PUBLIC_ASR_OPENAI_TOKEN_URL),
      model:
        normalize(process.env.EXPO_PUBLIC_ASR_OPENAI_MODEL) ??
        x.openaiTranscriptionModel ??
        "gpt-realtime-whisper",
    },
  };
  return cached;
}

/** True when a cloud vendor has credentials configured (key or token endpoint). */
export function isCloudConfigured(config: AsrConfig = getAsrConfig()): boolean {
  if (config.cloudVendor === "deepgram") {
    return Boolean(config.deepgram.apiKey || config.deepgram.tokenUrl);
  }
  return Boolean(config.openai.apiKey || config.openai.tokenUrl);
}

/** Reset memoized config (tests / config changes). */
export function resetAsrConfigCache(): void {
  cached = null;
}
