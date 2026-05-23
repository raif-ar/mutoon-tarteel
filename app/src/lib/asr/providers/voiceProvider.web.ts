import type { AsrProvider, TranscriptEvent } from "../types";

/** Web stub — use WebSpeechAsrProvider instead. */
export class VoiceAsrProvider implements AsrProvider {
  readonly name = "voice-stub";
  async start(): Promise<void> {
    throw new Error("Use WebSpeechAsrProvider on web");
  }
  async stop(): Promise<void> {}
  onTranscript(): () => void {
    return () => {};
  }
  onError(): () => void {
    return () => {};
  }
}
