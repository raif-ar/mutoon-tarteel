import { Platform } from "react-native";
import { getAsrConfig, isCloudConfigured } from "./asrConfig";
import type { AsrProvider } from "./types";
import { CloudStreamingAsrProvider } from "./providers/cloudStreamingProvider";
import { ExpoSpeechAsrProvider } from "./providers/expoSpeechProvider";
import { OnDeviceAsrProvider } from "./providers/onDeviceProvider";
import { TypingAsrProvider } from "./providers/typingProvider";
import { WebSpeechAsrProvider } from "./providers/webSpeechProvider";

export type AsrMode = "auto" | "cloud" | "device" | "voice" | "web" | "typing";

interface MaybeAvailable {
  isAvailable?: boolean;
}

/** A provider is usable unless it explicitly reports `isAvailable === false`. */
function isUsable(p: AsrProvider): boolean {
  return (p as AsrProvider & MaybeAvailable).isAvailable !== false;
}

export function createAsrProvider(mode: AsrMode = "auto"): AsrProvider {
  if (mode === "typing") {
    return new TypingAsrProvider();
  }
  if (mode === "web" || (mode === "auto" && Platform.OS === "web")) {
    return new WebSpeechAsrProvider();
  }
  if (mode === "voice") {
    return new ExpoSpeechAsrProvider();
  }

  const config = getAsrConfig();

  if (mode === "cloud") {
    const cloud = new CloudStreamingAsrProvider({ config });
    return isUsable(cloud) ? cloud : new ExpoSpeechAsrProvider();
  }
  if (mode === "device") {
    const device = new OnDeviceAsrProvider({ config });
    return isUsable(device) ? device : new ExpoSpeechAsrProvider();
  }

  // mode === "auto" on native: best available, then graceful fallback.
  if (isCloudConfigured(config)) {
    const cloud = new CloudStreamingAsrProvider({ config });
    if (isUsable(cloud)) return cloud;
  }
  const device = new OnDeviceAsrProvider({ config });
  if (isUsable(device)) return device;
  return new ExpoSpeechAsrProvider();
}

/** Modes that can actually run right now, for the recite A/B selector. */
export function getAvailableAsrModes(): AsrMode[] {
  if (Platform.OS === "web") {
    return ["web", "typing"];
  }
  const config = getAsrConfig();
  const modes: AsrMode[] = [];
  if (isCloudConfigured(config) && isUsable(new CloudStreamingAsrProvider({ config }))) {
    modes.push("cloud");
  }
  if (isUsable(new OnDeviceAsrProvider({ config }))) {
    modes.push("device");
  }
  modes.push("voice", "typing");
  return modes;
}

/** Default mode honoring config (`auto` resolves to the best available). */
export function getDefaultAsrMode(): AsrMode {
  const configured = getAsrConfig().defaultMode as AsrMode;
  const allowed: AsrMode[] = ["auto", "cloud", "device", "voice", "web", "typing"];
  return allowed.includes(configured) ? configured : "auto";
}

/** Short human label for a mode (UI). */
export function asrModeLabel(mode: AsrMode): string {
  switch (mode) {
    case "auto":
      return "Auto";
    case "cloud":
      return "Cloud";
    case "device":
      return "On-device";
    case "voice":
      return "OS speech";
    case "web":
      return "Web";
    case "typing":
      return "Typing";
  }
}
