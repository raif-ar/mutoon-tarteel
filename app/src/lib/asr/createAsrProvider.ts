import { Platform } from "react-native";
import type { AsrProvider } from "./types";
import { ExpoSpeechAsrProvider } from "./providers/expoSpeechProvider";
import { TypingAsrProvider } from "./providers/typingProvider";
import { WebSpeechAsrProvider } from "./providers/webSpeechProvider";

export type AsrMode = "auto" | "voice" | "web" | "typing";

export function createAsrProvider(mode: AsrMode = "auto"): AsrProvider {
  if (mode === "typing") {
    return new TypingAsrProvider();
  }
  if (mode === "web" || (mode === "auto" && Platform.OS === "web")) {
    return new WebSpeechAsrProvider();
  }
  if (mode === "voice" || mode === "auto") {
    return new ExpoSpeechAsrProvider();
  }
  return new TypingAsrProvider();
}
