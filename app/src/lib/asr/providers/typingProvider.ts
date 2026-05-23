import type { AsrProvider, TranscriptEvent } from "../types";

/** Push transcripts manually — for tests and when native ASR unavailable. */
export class TypingAsrProvider implements AsrProvider {
  readonly name = "typing";
  private transcriptListeners = new Set<(e: TranscriptEvent) => void>();
  private errorListeners = new Set<(e: Error) => void>();
  private active = false;

  async start(): Promise<void> {
    this.active = true;
  }

  async stop(): Promise<void> {
    this.active = false;
  }

  pushText(text: string, isFinal = true): void {
    if (!this.active) return;
    for (const l of this.transcriptListeners) {
      l({ text, isFinal });
    }
  }

  onTranscript(listener: (event: TranscriptEvent) => void): () => void {
    this.transcriptListeners.add(listener);
    return () => this.transcriptListeners.delete(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }
}
