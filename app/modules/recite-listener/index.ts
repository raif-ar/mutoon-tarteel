import { requireOptionalNativeModule } from "expo";

/**
 * Native runner for the on-device listener model (ONNX Runtime, iOS).
 *
 * The streaming model carries ~1.8 MB of state between calls; the native side
 * keeps it, so each call only sends one window of filterbank features and gets
 * the frame log-probabilities back.
 */
export interface ReciteListenerNativeModule {
  /** Load the model file. Resolves with the size of the model's output vocabulary. */
  load(path: string, threads: number): Promise<{ vocab: number; window: number; mels: number }>;
  /** One model step. `x` holds window x mels float32 values; resolves with frames x vocab float32 log-probabilities. */
  run(x: Uint8Array): Promise<Uint8Array>;
  /** Zero the streaming state (new recitation). */
  reset(): Promise<void>;
  release(): Promise<void>;
}

/** Null on platforms without the native module (web, Android for now). */
export const ReciteListenerNative =
  requireOptionalNativeModule<ReciteListenerNativeModule>("ReciteListener");
