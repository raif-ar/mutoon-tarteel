import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorEvent,
  type ExpoSpeechRecognitionResultEvent,
} from "expo-speech-recognition";
import { Platform } from "react-native";
import { dedupeRecognizedTokens, tokenizeTranscript } from "../normalize";
import { reciteLog } from "../../reciteLog";
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

function longestCommonCumulative(committed: string, addition: string): string {
  const a = committed.trim();
  const b = addition.trim();
  if (!a) return b;
  if (!b) return a;
  if (b.startsWith(a)) return b;
  if (a.startsWith(b)) return a;
  return `${a} ${b}`.trim();
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
  /** Finalized text from prior iOS segments (after pseudo-finals). */
  private committedTranscript = "";
  /** Current in-progress segment (replaced on each cumulative partial). */
  private liveSegment = "";
  private lastAsrLogFull = "";
  /** Token baseline for getTranscriptDelta (alignment phrase only). */
  private lastAlignTokens: string[] = [];
  private lastStartOptions?: AsrStartOptions;

  private buildFullTranscript(): string {
    if (!this.committedTranscript) return this.liveSegment.trim();
    if (!this.liveSegment) return this.committedTranscript.trim();
    return `${this.committedTranscript} ${this.liveSegment}`.trim();
  }

  /** Max words from live segment used for partial alignment (avoids 600-char poem dump). */
  private static readonly PARTIAL_ALIGN_WORDS = 18;

  /** Recent phrase for alignment — partials use only the end of the live segment. */
  getAlignmentTranscript(isFinal: boolean): string {
    const live = this.liveSegment.trim();
    if (!isFinal) {
      if (!live) return "";
      const liveWords = live.split(/\s+/).filter(Boolean);
      return liveWords.slice(-ExpoSpeechAsrProvider.PARTIAL_ALIGN_WORDS).join(" ");
    }

    const committedWords = this.committedTranscript
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const tail = committedWords.slice(-10).join(" ");
    if (!tail) return live;
    if (!live) return tail;
    return `${tail} ${live}`;
  }

  resetRecognitionBuffer(): void {
    this.committedTranscript = "";
    this.liveSegment = "";
    this.lastAlignTokens = [];
    this.lastAsrLogFull = "";
    reciteLog.asr("bufferReset", {});
  }

  private tokenizeAlignPhrase(isFinal: boolean): string[] {
    const text = this.getAlignmentTranscript(isFinal);
    return dedupeRecognizedTokens(
      tokenizeTranscript(text, { stripTashkeel: true, unifyAlef: true })
    );
  }

  private diffAlignTokens(current: string[]): string[] {
    const prev = this.lastAlignTokens;
    if (prev.length === 0) return [...current];
    const maxOverlap = Math.min(prev.length, current.length);
    for (let overlap = maxOverlap; overlap > 0; overlap--) {
      let ok = true;
      for (let i = 0; i < overlap; i++) {
        if (prev[prev.length - overlap + i] !== current[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return current.slice(overlap);
    }
    return [...current];
  }

  getTranscriptDelta(isFinal: boolean): TranscriptDelta {
    const alignmentText = this.getAlignmentTranscript(isFinal);
    const tokens = this.tokenizeAlignPhrase(isFinal);
    let newTokens = this.diffAlignTokens(tokens);
    if (newTokens.length > 10) {
      newTokens = newTokens.slice(-10);
    }
    if (isFinal) {
      this.lastAlignTokens = [];
    } else {
      this.lastAlignTokens = tokens.slice(-18);
    }
    return {
      alignmentText,
      newTokens,
      reset: isFinal,
    };
  }

  private ingestResult(raw: string, isFinal: boolean): string {
    const chunk = raw;
    const trimmed = chunk.trim();
    if (!trimmed) return this.buildFullTranscript();

    if (chunk.startsWith(" ")) {
      // iOS: new segment after a final — append only genuinely new words.
      const addition = trimmed;
      if (!this.committedTranscript.includes(addition)) {
        this.committedTranscript = longestCommonCumulative(
          this.committedTranscript,
          addition
        );
      }
      this.liveSegment = "";
    } else {
      // Cumulative partial for the active segment — replace, don't stack.
      this.liveSegment = trimmed;
    }

    if (isFinal && this.liveSegment) {
      this.committedTranscript = longestCommonCumulative(
        this.committedTranscript,
        this.liveSegment
      );
      this.liveSegment = "";
    }

    return this.buildFullTranscript();
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
    this.committedTranscript = "";
    this.liveSegment = "";
    this.lastAsrLogFull = "";
    this.lastAlignTokens = [];

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
      this.committedTranscript = this.buildFullTranscript();
      this.liveSegment = "";
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
    this.committedTranscript = "";
    this.liveSegment = "";
    this.lastAlignTokens = [];
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
