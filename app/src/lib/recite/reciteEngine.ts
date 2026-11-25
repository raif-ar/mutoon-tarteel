/**
 * On-device Recite engine.
 *
 * mic PCM -> listener model (phonemes) -> live aligner (word cursor + slips).
 * Nothing leaves the phone and nothing is recorded: audio is turned into
 * phonemes and dropped.
 *
 * Public surface mirrors what the Recite screen needs: loadSession, subscribe,
 * startListening, stopListening (resolves with the final state), peekNextWord,
 * rewindAndRetry.
 */
import type { FlatLineRef } from "../../types/content";
import { flattenSessionWords, type SessionWordRef } from "../content/loader";
import { reciteLog } from "../reciteLog";
import { createPcmAudioSource, rmsOfPcm16, type PcmAudioSource } from "./audioCapture";
import type { Listener } from "./listener/listener";
import { LISTENER_FRAME_MS, openListener } from "./nativeListener";
import { heardToArabic, PhonemeAligner, type AlignerUpdate } from "./phonemeAlign";
import { lineWordPhonemes } from "./phonemize";
import type { ReciteEngineState, Slip } from "./types";

/** No progress for this long while the reciter is audible: offer to go back. */
const STUCK_HINT_MS = 8000;
const REWIND_LINES = 2;
/** Mic level below this for LOW_INPUT_AFTER_MS means the mic is too far or too quiet. */
const LOW_INPUT_RMS = 0.01;
const LOW_INPUT_AFTER_MS = 3000;
const EMIT_DEBOUNCE_MS = 50;
const TICK_MS = 500;

export interface ReciteEngineDeps {
  /** Audio source (the microphone by default; a file source in dev). */
  source?: PcmAudioSource;
  /** Opens the phoneme listener (the native model by default). */
  openListener?: () => Promise<Listener>;
}

export type ReciteEngineListener = (state: ReciteEngineState) => void;

export class ReciteEngine {
  private readonly source: PcmAudioSource;
  private readonly open: () => Promise<Listener>;
  private lines: FlatLineRef[] = [];
  private words: SessionWordRef[] = [];
  private aligner: PhonemeAligner | null = null;
  private listener: Listener | null = null;
  private listeners = new Set<ReciteEngineListener>();
  /** Serializes model work: frames are pushed strictly in arrival order. */
  private chain: Promise<void> = Promise.resolve();
  /** Bumped on every start/stop so stale async work is ignored. */
  private run = 0;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private lastAdvanceMs = 0;
  private lastLoudMs = 0;
  private smoothedRms = 0;
  private starting: Promise<void> | null = null;
  private stopping: Promise<ReciteEngineState> | null = null;

  private state: ReciteEngineState = {
    wordCursor: 0,
    totalWords: 0,
    lineIndex: 0,
    wordIndex: 0,
    mistakes: [],
    isListening: false,
    isPreparing: false,
    asrError: null,
    stuckHint: false,
    inputLevel: 0,
    lowInput: false,
  };

  constructor(deps: ReciteEngineDeps = {}) {
    this.source = deps.source ?? createPcmAudioSource();
    this.open = deps.openListener ?? openListener;
  }

  /** Lines of the session, in order. They need not be contiguous in the matn. */
  loadSession(lines: FlatLineRef[]): void {
    this.lines = lines;
    this.words = flattenSessionWords(lines);
    const phonemes: string[] = [];
    for (const l of lines) phonemes.push(...lineWordPhonemes(l.line.words));
    this.aligner = new PhonemeAligner(phonemes);
    this.state = {
      ...this.state,
      wordCursor: 0,
      totalWords: this.words.length,
      lineIndex: 0,
      wordIndex: 0,
      mistakes: [],
      asrError: null,
      stuckHint: false,
    };
    reciteLog.session("load", { lines: lines.length, words: this.words.length, engine: "on-device" });
    this.emitNow();
  }

  getState(): ReciteEngineState {
    return this.state;
  }

  subscribe(listener: ReciteEngineListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  get isComplete(): boolean {
    return this.state.totalWords > 0 && this.state.wordCursor >= this.state.totalWords;
  }

  async startListening(): Promise<void> {
    if (this.stopping) await this.stopping;
    if (this.state.isListening) return;
    if (this.starting) return this.starting;
    if (!this.aligner || this.isComplete) return;
    this.starting = this.doStart().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async doStart(): Promise<void> {
    const aligner = this.aligner;
    if (!aligner) return;
    const run = ++this.run;
    this.patch({ isPreparing: true, asrError: null, stuckHint: false });
    this.emitNow();
    try {
      this.listener = await this.open();
      if (run !== this.run) return;
      aligner.resetTo(this.state.wordCursor);
      const now = Date.now();
      this.lastAdvanceMs = now;
      this.lastLoudMs = now;
      this.smoothedRms = 0;
      this.chain = Promise.resolve();
      await this.source.start(
        (frame) => this.onFrame(run, frame.pcm16),
        (e) => this.fail(run, e)
      );
      if (run !== this.run) {
        await this.source.stop();
        return;
      }
      this.patch({ isListening: true, isPreparing: false, inputLevel: 0, lowInput: false });
      this.tickTimer = setInterval(() => this.tick(run), TICK_MS);
      reciteLog.listen("start", { fromWord: this.state.wordCursor });
      this.emitNow();
    } catch (e) {
      if (run === this.run) {
        this.listener = null;
        this.patch({ isListening: false, isPreparing: false });
        this.emitNow();
      }
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  /** Stops the mic, drains the model and settles every word reached. Resolves with the final state. */
  async stopListening(): Promise<ReciteEngineState> {
    // Pause, Finish and the auto-finish can all ask at once: drain the model only once.
    if (this.stopping) return this.stopping;
    this.stopping = this.doStop().finally(() => {
      this.stopping = null;
    });
    return this.stopping;
  }

  private async doStop(): Promise<ReciteEngineState> {
    if (this.starting) {
      try {
        await this.starting;
      } catch {
        /* start failed: nothing to stop */
      }
    }
    if (!this.state.isListening) return this.state;
    const run = this.run;
    const listener = this.listener;
    const aligner = this.aligner;
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    try {
      await this.source.stop();
    } catch {
      /* already stopped */
    }
    await this.chain; // frames delivered before the stop, including the tail
    if (run === this.run && listener && aligner) {
      try {
        const rest = await listener.end();
        this.apply(aligner.push(rest, listener.frames));
        this.apply(aligner.finish(listener.frames));
      } catch (e) {
        reciteLog.error("listen.drain", { message: e instanceof Error ? e.message : String(e) });
      }
    }
    this.run++;
    this.listener = null;
    this.patch({ isListening: false, isPreparing: false, stuckHint: false, inputLevel: 0, lowInput: false });
    reciteLog.listen("stop", { wordCursor: this.state.wordCursor, slips: this.state.mistakes.length });
    this.emitNow();
    return this.state;
  }

  peekNextWord(): string | null {
    return this.words[this.state.wordCursor]?.word ?? null;
  }

  /** Go back to the start of the line `linesBack` before the current one and listen again from there. */
  async rewindAndRetry(linesBack = REWIND_LINES): Promise<void> {
    if (!this.aligner || this.words.length === 0) return;
    const at = Math.min(this.state.wordCursor, this.words.length - 1);
    const line = Math.max(0, this.words[at].lineIndex - linesBack);
    const target = this.words.findIndex((w) => w.lineIndex === line);
    await this.chain;
    this.aligner.resetTo(target);
    this.state = {
      ...this.state,
      wordCursor: target,
      ...this.position(target),
      mistakes: this.state.mistakes.filter((m) => m.globalWordIndex < target),
      stuckHint: false,
    };
    this.lastAdvanceMs = Date.now();
    reciteLog.cursor("rewind", { toWord: target, toLine: line });
    this.emitNow();
  }

  // ---- audio path ----

  private onFrame(run: number, pcm16: Int16Array): void {
    if (run !== this.run) return;
    const rms = rmsOfPcm16(pcm16);
    this.smoothedRms = this.smoothedRms * 0.7 + rms * 0.3;
    if (rms >= LOW_INPUT_RMS) this.lastLoudMs = Date.now();
    const samples = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) samples[i] = pcm16[i] / 0x8000;
    this.chain = this.chain.then(() => this.process(run, samples));
  }

  private async process(run: number, samples: Float32Array): Promise<void> {
    const listener = this.listener;
    const aligner = this.aligner;
    if (run !== this.run || !listener || !aligner) return;
    try {
      const tokens = await listener.push(samples);
      if (run !== this.run) return;
      this.apply(aligner.push(tokens, listener.frames));
    } catch (e) {
      this.fail(run, e);
    }
  }

  private apply(update: AlignerUpdate): void {
    let { mistakes } = this.state;
    for (const v of update.verdicts) {
      if (v.ok || mistakes.some((m) => m.globalWordIndex === v.index)) continue;
      const w = this.words[v.index];
      if (!w) continue;
      const slip: Slip = {
        kind: v.kind ?? "wrong",
        globalWordIndex: v.index,
        lineIndex: w.lineIndex,
        wordIndex: w.wordIndex,
        expectedWord: w.word,
        heard: v.kind === "skipped" ? "" : heardToArabic(v.heard),
      };
      mistakes = [...mistakes, slip].sort((a, b) => a.globalWordIndex - b.globalWordIndex);
      reciteLog.mistake({ word: v.index, kind: slip.kind, expected: slip.expectedWord, heard: slip.heard, err: Number(v.err.toFixed(2)), atMs: v.atFrame * LISTENER_FRAME_MS });
    }
    const cursor = Math.max(this.state.wordCursor, update.cursor);
    if (cursor === this.state.wordCursor && mistakes === this.state.mistakes) return;
    if (cursor !== this.state.wordCursor) this.lastAdvanceMs = Date.now();
    this.state = {
      ...this.state,
      wordCursor: cursor,
      ...this.position(cursor),
      mistakes,
      stuckHint: cursor !== this.state.wordCursor ? false : this.state.stuckHint,
    };
    this.emitSoon();
  }

  private tick(run: number): void {
    if (run !== this.run || !this.state.isListening) return;
    const now = Date.now();
    const lowInput = now - this.lastLoudMs >= LOW_INPUT_AFTER_MS;
    // Only when the reciter is audible: silence is a pause, not being stuck.
    const stuckHint = !this.isComplete && !lowInput && now - this.lastAdvanceMs >= STUCK_HINT_MS;
    const inputLevel = this.smoothedRms;
    if (lowInput !== this.state.lowInput || stuckHint !== this.state.stuckHint || Math.abs(inputLevel - this.state.inputLevel) > 0.002) {
      this.patch({ lowInput, stuckHint, inputLevel });
      this.emitNow();
    }
  }

  private fail(run: number, e: unknown): void {
    if (run !== this.run) return;
    const message = e instanceof Error ? e.message : String(e);
    reciteLog.error("listen", { message });
    this.patch({ asrError: message });
    this.emitNow();
    void this.stopListening();
  }

  // ---- state ----

  private position(cursor: number): { lineIndex: number; wordIndex: number } {
    const w = this.words[cursor];
    if (w) return { lineIndex: w.lineIndex, wordIndex: w.wordIndex };
    return { lineIndex: this.lines.length, wordIndex: 0 };
  }

  private patch(p: Partial<ReciteEngineState>): void {
    this.state = { ...this.state, ...p };
  }

  private emitSoon(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emitNow();
    }, EMIT_DEBOUNCE_MS);
  }

  private emitNow(): void {
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    for (const l of this.listeners) l(this.state);
  }
}
