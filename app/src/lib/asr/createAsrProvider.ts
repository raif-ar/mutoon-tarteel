import { getAsrConfig } from "./asrConfig";
import { CloudStreamingAsrProvider } from "./providers/cloudStreamingProvider";
import type { AsrProvider } from "./types";

/**
 * Cloud (Deepgram Nova-3 streaming) is the only recitation ASR engine.
 *
 * The on-device Whisper and OS-speech providers were removed so we can focus on
 * perfecting the cloud path (live keyterm re-biasing, alignment, logging). If
 * the cloud provider can't run — no mic, no network, or no credentials — its
 * `start()` throws and the recite screen surfaces the error.
 */
export const ASR_MODE = "cloud" as const;
export type AsrMode = typeof ASR_MODE;

export function createAsrProvider(): AsrProvider {
  return new CloudStreamingAsrProvider({ config: getAsrConfig() });
}
