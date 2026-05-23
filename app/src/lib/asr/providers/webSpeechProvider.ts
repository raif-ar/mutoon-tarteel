import { Platform } from "react-native";
import type { AsrProvider, TranscriptEvent } from "../types";

type WebSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: {
    results: { length: number; [i: number]: { isFinal: boolean; [j: number]: { transcript: string } } };
  }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => WebSpeechRecognition;
    webkitSpeechRecognition?: new () => WebSpeechRecognition;
  }
}

/** Web Speech API — useful for browser testing of alignment pipeline. */
export class WebSpeechAsrProvider implements AsrProvider {
  readonly name = "web-speech";
  private recognition: WebSpeechRecognition | null = null;
  private transcriptListeners = new Set<(e: TranscriptEvent) => void>();
  private errorListeners = new Set<(e: Error) => void>();

  constructor(private locale = "ar-SA") {}

  async start(): Promise<void> {
    if (Platform.OS !== "web") {
      throw new Error("WebSpeechAsrProvider is web-only");
    }
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) {
      throw new Error("Web Speech API not supported in this browser");
    }
    this.recognition = new Ctor();
    this.recognition.lang = this.locale;
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i];
        const t = r[0]?.transcript ?? "";
        if (r.isFinal) final += t;
        else interim += t;
      }
      const text = (final || interim).trim();
      if (!text) return;
      for (const l of this.transcriptListeners) {
        l({ text, isFinal: !!final });
      }
    };
    this.recognition.onerror = (e) => {
      for (const l of this.errorListeners) {
        l(new Error(e.error));
      }
    };
    this.recognition.start();
  }

  async stop(): Promise<void> {
    this.recognition?.stop();
    this.recognition = null;
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
