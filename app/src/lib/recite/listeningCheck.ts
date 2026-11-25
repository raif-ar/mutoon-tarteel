/**
 * "Check listening": runs a short bundled clip (a synthetic voice reading the
 * first line of Tuhfat al-Atfal) through the listener and the aligner, to show
 * that the on-device engine works on this phone and how fast it is.
 */
import { Asset } from "expo-asset";
import { openListener, LISTENER_FRAME_MS } from "./nativeListener";
import { PhonemeAligner } from "./phonemeAlign";
import { lineWordPhonemes } from "./phonemize";
import { decodeWav } from "./wav";
import type { DecodedPhoneme } from "./listener/listener";

const CHECK_WORDS = ["يَقُولُ", "رَاجِي", "رَحْمَةِ", "الْغَفُورِ"];

export interface ListeningCheckResult {
  ok: boolean;
  /** Words of the clip recognised as correct, out of `totalWords`. */
  wordsHeard: number;
  totalWords: number;
  /** How many times faster than real time the model ran. */
  speed: number;
  /** Time to load the model (0 when it was already loaded). */
  loadMs: number;
  /** Phonemes heard, for the log. */
  heard: string;
}

export async function loadCheckClip(): Promise<Float32Array> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const asset = Asset.fromModule(require("../../../assets/audio/listening-check.wav"));
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error("The check clip is missing from the app.");
  // Bundled assets live in the app bundle, which expo-file-system will not read; fetch does.
  const bytes = new Uint8Array(await (await fetch(asset.localUri)).arrayBuffer());
  const { samples, sampleRate } = decodeWav(bytes);
  if (sampleRate !== 16000) throw new Error("The check clip must be 16 kHz.");
  return samples;
}

export async function runListeningCheck(): Promise<ListeningCheckResult> {
  const t0 = Date.now();
  const listener = await openListener();
  const loadMs = Date.now() - t0;
  const samples = await loadCheckClip();
  const tokens: DecodedPhoneme[] = [];
  const t1 = Date.now();
  for (let i = 0; i < samples.length; i += 1600) tokens.push(...(await listener.push(samples.subarray(i, i + 1600))));
  tokens.push(...(await listener.end()));
  const runMs = Math.max(1, Date.now() - t1);
  const aligner = new PhonemeAligner(lineWordPhonemes(CHECK_WORDS));
  const verdicts = [...aligner.push(tokens, listener.frames).verdicts, ...aligner.finish(listener.frames).verdicts];
  const wordsHeard = verdicts.filter((v) => v.ok).length;
  const audioMs = (samples.length / 16000) * 1000;
  return {
    ok: wordsHeard === CHECK_WORDS.length,
    wordsHeard,
    totalWords: CHECK_WORDS.length,
    speed: audioMs / runMs,
    loadMs,
    heard: tokens.map((t) => t.p).join(""),
  };
}

export { LISTENER_FRAME_MS };
