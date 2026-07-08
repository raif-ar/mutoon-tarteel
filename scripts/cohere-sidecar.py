#!/usr/bin/env python3
"""Cohere Transcribe Arabic benchmark sidecar for scripts/asr-eval.mjs.

Loads CohereLabs/cohere-transcribe-arabic-07-2026 (2B audio->text, Apache 2.0,
top open-source model on the Open Universal Arabic ASR Leaderboard as of
07/2026) once, transcribes a manifest of WAVs, and emits one JSON line per
case on stdout. Evaluated as a decision gate for a post-session
"second-opinion" reconcile pass — the model has no word timestamps, no
streaming, and no keyterm biasing, so it cannot drive the live path.

Setup (macOS, Apple Silicon; MPS via device_map=auto):
    python3.11 -m venv .venv-cohere && source .venv-cohere/bin/activate
    pip install "transformers>=5.4.0" torch accelerate librosa soundfile \
        sentencepiece protobuf huggingface_hub
    # first run downloads ~4 GB from Hugging Face

Usage:
    python scripts/cohere-sidecar.py --manifest /tmp/cohere-manifest.json

Manifest: [{"id": "intro_l001.wav", "wav": "/abs/path.wav"}, ...]
Stdout:   {"id": ..., "text": ..., "decodeSec": 0.41, "audioSec": 4.2,
           "rtf": 0.10}
Stderr:   progress + a final {"modelLoadSec": ...} summary line.

Invoked by asr-eval.mjs when COHERE_PY points at the venv python.
"""

import argparse
import json
import sys
import time

MODEL = "CohereLabs/cohere-transcribe-arabic-07-2026"


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--max-new-tokens", type=int, default=256)
    args = ap.parse_args()

    with open(args.manifest) as f:
        cases = json.load(f)

    log(f"loading {MODEL}…")
    t0 = time.perf_counter()
    from transformers import AutoProcessor, CohereAsrForConditionalGeneration
    from transformers.audio_utils import load_audio

    processor = AutoProcessor.from_pretrained(MODEL)
    model = CohereAsrForConditionalGeneration.from_pretrained(
        MODEL, device_map="auto"
    )
    model.eval()
    load_sec = time.perf_counter() - t0
    log(f"model loaded in {load_sec:.1f}s (device: {model.device})")

    for case in cases:
        cid, wav = case["id"], case["wav"]
        try:
            audio = load_audio(wav, sampling_rate=16000)
            audio_sec = len(audio) / 16000.0
            t1 = time.perf_counter()
            inputs = processor(
                audio, sampling_rate=16000, return_tensors="pt", language="ar"
            ).to(model.device)
            outputs = model.generate(
                **inputs, max_new_tokens=args.max_new_tokens
            )
            text = processor.decode(outputs, skip_special_tokens=True)
            decode_sec = time.perf_counter() - t1
            print(
                json.dumps(
                    {
                        "id": cid,
                        "text": text.strip(),
                        "decodeSec": round(decode_sec, 3),
                        "audioSec": round(audio_sec, 3),
                        "rtf": round(decode_sec / audio_sec, 4) if audio_sec else None,
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
            log(f"  {cid}: {decode_sec:.2f}s")
        except Exception as e:  # noqa: BLE001 — report per-case, keep batch going
            print(json.dumps({"id": cid, "error": str(e)}), flush=True)
            log(f"  {cid}: ERROR {e}")

    log(json.dumps({"modelLoadSec": round(load_sec, 1)}))


if __name__ == "__main__":
    main()
