#!/usr/bin/env python3
"""FastConformer Arabic benchmark sidecar for scripts/asr-eval.mjs.

Loads NVIDIA's Arabic FastConformer hybrid (RNNT+CTC) once, transcribes a
manifest of WAVs, and emits one JSON line per case on stdout — the tilawa
(github.com/yazinsai/tilawa) breakthrough model, evaluated here as a
decision gate before any on-device port. Quantization/ONNX is out of scope.

Setup (macOS; system Python 3.9 is too old for NeMo — use 3.10+):
    brew install python@3.11 ffmpeg
    python3.11 -m venv .venv-fc && source .venv-fc/bin/activate
    pip install "nemo_toolkit[asr]" soundfile
    # first run downloads ~460 MB from Hugging Face

Usage:
    python scripts/fastconformer-sidecar.py --manifest /tmp/fc-manifest.json \
        [--decoder rnnt|ctc] [--tta]

Manifest: [{"id": "intro_l001.wav", "wav": "/abs/path.wav"}, ...]
Stdout:   {"id": ..., "text": ..., "decodeSec": 0.41, "audioSec": 4.2,
           "rtf": 0.10, "tempo": 1.0}
Stderr:   progress + a final {"modelLoadSec": ...} summary line.

Invoked by asr-eval.mjs when FASTCONFORMER_PY points at the venv python.
"""

import argparse
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

MODEL = "nvidia/stt_ar_fastconformer_hybrid_large_pcd_v1.0"
TTA_TEMPOS = (0.9, 1.1)  # anchor 1.0x always runs


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def load_model(decoder):
    import nemo.collections.asr as nemo_asr

    t0 = time.perf_counter()
    model = nemo_asr.models.ASRModel.from_pretrained(MODEL)
    if decoder == "ctc" and hasattr(model, "change_decoding_strategy"):
        model.change_decoding_strategy(decoder_type="ctc")
    model.eval()
    return model, time.perf_counter() - t0


def to_16k_mono(wav_path, out_dir, tempo=1.0):
    """Resample (and optionally tempo-shift) via ffmpeg into a temp wav."""
    out = Path(out_dir) / f"{Path(wav_path).stem}_{tempo}.wav"
    af = f"atempo={tempo}" if tempo != 1.0 else "anull"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav_path),
         "-af", af, "-ar", "16000", "-ac", "1", str(out)],
        check=True,
    )
    return out


def audio_seconds(path):
    import soundfile as sf

    info = sf.info(str(path))
    return info.frames / info.samplerate


def transcribe(model, path):
    t0 = time.perf_counter()
    out = model.transcribe([str(path)], verbose=False)
    dt = time.perf_counter() - t0
    hyp = out[0]
    text = hyp.text if hasattr(hyp, "text") else str(hyp)
    return text, dt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--decoder", choices=["rnnt", "ctc"], default="rnnt")
    ap.add_argument("--tta", action="store_true",
                    help="also decode 0.9x/1.1x tempo variants; pick the "
                         "variant with the longest transcript (proxy for "
                         "least-dropped words; the Node side re-scores)")
    args = ap.parse_args()

    cases = json.loads(Path(args.manifest).read_text())
    model, load_sec = load_model(args.decoder)
    log(f"model loaded in {load_sec:.1f}s ({MODEL}, decoder={args.decoder})")

    with tempfile.TemporaryDirectory() as tmp:
        for case in cases:
            wav = case["wav"]
            try:
                base = to_16k_mono(wav, tmp)
                audio_sec = audio_seconds(base)
                text, decode_sec = transcribe(model, base)
                tempo_used = 1.0
                if args.tta:
                    for tempo in TTA_TEMPOS:
                        variant = to_16k_mono(wav, tmp, tempo)
                        vtext, vsec = transcribe(model, variant)
                        decode_sec += vsec
                        if len(vtext.split()) > len(text.split()):
                            text, tempo_used = vtext, tempo
                print(json.dumps({
                    "id": case["id"],
                    "text": text,
                    "decodeSec": round(decode_sec, 3),
                    "audioSec": round(audio_sec, 3),
                    "rtf": round(decode_sec / audio_sec, 3) if audio_sec else None,
                    "tempo": tempo_used,
                }, ensure_ascii=False), flush=True)
            except Exception as e:  # keep the batch going; Node skips errors
                print(json.dumps({"id": case["id"], "error": str(e)}),
                      flush=True)
                log(f"ERROR {case['id']}: {e}")

    log(json.dumps({"modelLoadSec": round(load_sec, 1)}))


if __name__ == "__main__":
    main()
