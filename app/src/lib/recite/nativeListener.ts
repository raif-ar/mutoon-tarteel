/**
 * The listener model on this device: loads the bundled ONNX file into the
 * native runner once, and opens a fresh streaming listener per recitation.
 */
import { Asset } from "expo-asset";
import { ReciteListenerNative } from "../../../modules/recite-listener";
import {
  createListener,
  type InferenceBackend,
  type Listener,
  type ListenerManifest,
} from "./listener/listener";
import model from "./listener/model.json";

export const LISTENER_MANIFEST = model as unknown as ListenerManifest;
/** Duration of one listener frame (the engine's clock unit). */
export const LISTENER_FRAME_MS = LISTENER_MANIFEST.frameMs;

/** False on platforms where the native runner is not built in (web, Android for now). */
export function isListenerAvailable(): boolean {
  return ReciteListenerNative != null;
}

/**
 * File audio may stand in for the microphone in dev builds and on the simulator
 * (which has no usable mic), so the Recite flow can be exercised end to end.
 */
export function canReplayFileAudio(): boolean {
  return (typeof __DEV__ !== "undefined" && __DEV__) || ReciteListenerNative?.isSimulator === true;
}

let backendPromise: Promise<InferenceBackend> | null = null;

async function loadBackend(): Promise<InferenceBackend> {
  const native = ReciteListenerNative;
  if (!native) {
    throw new Error("Listening is not available on this device yet.");
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const asset = Asset.fromModule(require("../../../assets/models/listener.onnx"));
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error("The listening model could not be found in the app.");
  const info = await native.load(asset.localUri, 2);
  const vocab = LISTENER_MANIFEST.tokens.length + 1;
  if (info.vocab !== vocab || info.window !== LISTENER_MANIFEST.window || info.mels !== LISTENER_MANIFEST.mels) {
    throw new Error("The listening model does not match this version of the app.");
  }
  return {
    holdsState: true,
    async run(feeds) {
      const x = feeds.x.data as Float32Array;
      const out = await native.run(new Uint8Array(x.buffer, x.byteOffset, x.byteLength));
      // Copy: the returned bytes may not be 4-byte aligned inside their buffer.
      const logProbs = new Float32Array(out.byteLength >> 2);
      new Uint8Array(logProbs.buffer).set(out);
      return { log_probs: { type: "float32", data: logProbs, dims: [1, logProbs.length / vocab, vocab] } };
    },
    reset: () => native.reset(),
    release: () => native.release(),
  };
}

/** Load the model (once). Safe to call early to hide the load time. */
export function prepareListener(): Promise<InferenceBackend> {
  if (!backendPromise) {
    backendPromise = loadBackend().catch((e) => {
      backendPromise = null;
      throw e;
    });
  }
  return backendPromise;
}

/** A fresh listener with zeroed state. Only one can be live at a time. */
export async function openListener(): Promise<Listener> {
  const backend = await prepareListener();
  await backend.reset?.();
  return createListener(LISTENER_MANIFEST, backend);
}
