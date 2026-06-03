import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorEvent,
  type ExpoSpeechRecognitionResultEvent,
} from "expo-speech-recognition";
import { Platform } from "react-native";
import { reciteLog } from "../../reciteLog";
import { TranscriptAccumulator } from "../transcriptAccumulator";
import type {
  AsrProvider,
  AsrStartOptions,
  TranscriptDelta,
  TranscriptEvent,
} from "../types";

const ARABIC_LOCALE_CANDIDATES = ["ar-SA", "ar-AE", "ar", "ar-EG"];

async function pickArabicLocale(preferred?: string): Promise<string> {
  const locales = await ExpoSpeechRecognitionModule.getSupportedLocales(
    {}
  ).catch(() => ({ locales: [] as string[] }));

  const supported = new Set(locales.locales ?? []);
  const tryList = preferred
    ? [preferred, ...ARABIC_LOCALE_CANDIDATES]
    : ARABIC_LOCALE_CANDIDATES;

  for (const code of tryList) {
    if (supported.size === 0 || supported.has(code)) {
      return code;
    }
  }
  return preferred ?? "ar-SA";
}

/**
 * Expo-maintained speech recognition (SFSpeechRecognizer on iOS).
 */
export class ExpoSpeechAsrProvider implements AsrProvider {
  readonly name = "expo-speech-recognition";
  private transcriptListeners = new Set<(e: TranscriptEvent) => void>();
  private errorListeners = new Set<(e: Error) => void>();
  private resultSubscription?: { remove: () => void };
  private errorSubscription?: { remove: () => void };
  private endSubscription?: { remove: () => void };
  /** Committed/live segment state + alignment tail + token deltas. */
  private readonly acc = new TranscriptAccumulator();
  private lastAsrLogFull = "";
  private lastStartOptions?: AsrStartOptions;

  private get committedTranscript(): string {
    return this.acc.committedTranscript;
  }

  private get liveSegment(): string {
    return this.acc.liveSegment;
  }

  getAlignmentTranscript(isFinal: boolean): string {
    return this.acc.getAlignmentTranscript(isFinal);
  }

  resetRecognitionBuffer(): void {
    this.acc.reset();
    this.lastAsrLogFull = "";
    reciteLog.asr("bufferReset", {});
  }

  getTranscriptDelta(isFinal: boolean): TranscriptDelta {
    return this.acc.getTranscriptDelta(isFinal);
  }

  private ingestResult(raw: string, isFinal: boolean): string {
    const chunk = raw;
    const trimmed = chunk.trim();
    if (!trimmed) return this.acc.buildFullTranscript();

    if (chunk.startsWith(" ")) {
      // iOS: new segment after a final — append only genuinely new words.
      this.acc.appendCommitted(trimmed);
      this.acc.setLiveSegment("");
    } else {
      // Cumulative partial for the active segment — replace, don't stack.
      this.acc.setLiveSegment(trimmed);
    }

    if (isFinal) {
      this.acc.commitLiveSegment();
    }

    return this.acc.buildFullTranscript();
  }

  async start(options?: AsrStartOptions): Promise<void> {
    if (Platform.OS === "web") {
      throw new Error("Use web speech provider on web");
    }

    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      throw new Error(
        "Speech recognition is not available on this device. Use typing below."
      );
    }

    const mic = await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync();
    if (!mic.granted) {
      throw new Error(
        "Microphone permission denied. Enable it in Settings → Mutoon Tarteel."
      );
    }

    const speech =
      await ExpoSpeechRecognitionModule.requestSpeechRecognizerPermissionsAsync();
    if (!speech.granted) {
      throw new Error(
        "Speech recognition permission denied. Enable it in Settings → Mutoon Tarteel."
      );
    }

    this.detachListeners();
    this.acc.reset();
    this.lastAsrLogFull = "";

    const lang = await pickArabicLocale(options?.locale);

    this.resultSubscription = ExpoSpeechRecognitionModule.addListener(
      "result",
      (event: ExpoSpeechRecognitionResultEvent) => {
        const raw = event.results[0]?.transcript ?? "";
        const text = this.ingestResult(raw, event.isFinal);
        if (!text) return;

        if (event.isFinal || text !== this.lastAsrLogFull) {
          this.lastAsrLogFull = text;
          reciteLog.asr("result", {
            isFinal: event.isFinal,
            raw: raw.trim(),
            full: text,
            committedLen: this.committedTranscript.length,
            liveLen: this.liveSegment.length,
          });
        }

        for (const l of this.transcriptListeners) {
          l({ text, isFinal: event.isFinal });
        }
      }
    );

    this.errorSubscription = ExpoSpeechRecognitionModule.addListener(
      "error",
      (event: ExpoSpeechRecognitionErrorEvent) => {
        const message =
          event.message ??
          (typeof event.error === "string" ? event.error : "Speech recognition error");
        const err = new Error(message);
        reciteLog.error("asr.native", {
          message,
          error: typeof event.error === "string" ? event.error : String(event.error),
        });
        for (const l of this.errorListeners) {
          l(err);
        }
      }
    );

    this.endSubscription = ExpoSpeechRecognitionModule.addListener("end", () => {
      reciteLog.asr("end", { hadCommitted: this.committedTranscript.length > 0 });
      this.acc.commitLiveSegment();
    });

    this.lastStartOptions = options;

    reciteLog.asr("start", {
      lang,
      contextualCount: options?.contextualStrings?.length ?? 0,
    });

    ExpoSpeechRecognitionModule.start({
      lang,
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: false,
      contextualStrings: options?.contextualStrings,
      iosVoiceProcessingEnabled: true,
    });
  }

  async restartRecognition(options?: AsrStartOptions): Promise<void> {
    const opts = options ?? this.lastStartOptions;
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      /* not running */
    }
    this.resetRecognitionBuffer();

    if (!this.resultSubscription) {
      await this.start(opts);
      return;
    }

    const lang = await pickArabicLocale(opts?.locale);
    this.lastStartOptions = opts;
    reciteLog.asr("restart", {
      lang,
      contextualCount: opts?.contextualStrings?.length ?? 0,
    });

    ExpoSpeechRecognitionModule.start({
      lang,
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: false,
      contextualStrings: opts?.contextualStrings,
      iosVoiceProcessingEnabled: true,
    });
  }

  async stop(): Promise<void> {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      /* not running */
    }
    this.acc.reset();
    this.detachListeners();
  }

  onTranscript(listener: (event: TranscriptEvent) => void): () => void {
    this.transcriptListeners.add(listener);
    return () => this.transcriptListeners.delete(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  private detachListeners(): void {
    this.resultSubscription?.remove();
    this.errorSubscription?.remove();
    this.endSubscription?.remove();
    this.resultSubscription = undefined;
    this.errorSubscription = undefined;
    this.endSubscription = undefined;
  }
}
