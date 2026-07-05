#!/usr/bin/env python3
"""
Qwen3-TTS remote server.

Runs on a CUDA-capable machine and exposes a
simple HTTP endpoint compatible with the mLearn TTS API.

Usage:
    pip install qwen-tts "transformers>=4.57.3" "accelerate>=1.12.0" librosa torchaudio soundfile
    python qwen3_tts_server.py --host 0.0.0.0 --port 7760

    # In the mLearn app settings, set TTS provider to "remote" and
    # enter the server IP:port (e.g. 192.168.1.100:7760).

Endpoints:
    POST /voice/tts        - Generate TTS audio (same contract as mLearn backend)
    GET  /voice/tts/status - Check model status
    GET  /health           - Health check
"""

import argparse
import io
import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Optional

import torch
import torchaudio
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s"
)
log = logging.getLogger("qwen3-tts-server")

app = FastAPI(title="Qwen3-TTS Remote Server")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

# ---------------------------------------------------------------------------
# Global state
# ---------------------------------------------------------------------------
_model = None
_loading = False
_voice_prompt_cache: dict[str, object] = {}
SAMPLE_RATE = 24000
MODEL_NAME = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
DEFAULT_SENTENCE_TERMINATORS = ".!?。！？؟؛"
LANGUAGE_DATA_PATH = Path(
    os.environ.get(
        "MLEARN_LANGUAGE_DATA_PATH",
        Path.home() / ".mlearn" / "language-data",
    )
)


def _install_sox_shim():
    """Install pure-numpy shim for the ``sox`` module (avoids SoX CLI dep)."""
    import sys
    import types

    if "sox" in sys.modules:
        return
    import numpy as np

    class _Transformer:
        def __init__(self):
            self._target_db: float = 0.0

        def norm(self, db_level: float = 0.0):
            self._target_db = db_level
            return self

        def build_array(self, input_array, sample_rate_in: int = 16000):
            audio = np.array(input_array, dtype=np.float64)
            peak = np.max(np.abs(audio))
            if peak < 1e-10:
                return audio.astype(np.float32)
            target_peak = 10.0 ** (self._target_db / 20.0)
            return (audio * (target_peak / peak)).astype(np.float32)

    mod = types.ModuleType("sox")
    mod.Transformer = _Transformer  # type: ignore[attr-defined]
    sys.modules["sox"] = mod


def load_model():
    global _model, _loading
    if _model is not None:
        return
    _loading = True
    try:
        _install_sox_shim()
        from qwen_tts import Qwen3TTSModel

        device = "cuda" if torch.cuda.is_available() else "cpu"
        log.info(f"Loading {MODEL_NAME} on {device}...")

        _model = Qwen3TTSModel.from_pretrained(MODEL_NAME)
        _model = _model.to(device)

        log.info("Qwen3-TTS loaded successfully.")
    except Exception as e:
        log.error(f"Failed to load model: {e}")
        raise
    finally:
        _loading = False


def _validate_voice_sample_path(path_str: Optional[str]) -> Optional[str]:
    """Reject paths containing traversal sequences; return resolved path or None."""
    if not path_str:
        return None
    resolved = os.path.realpath(path_str)
    if ".." in path_str.split(os.sep):
        raise HTTPException(status_code=400, detail="Invalid voice sample path")
    if not os.path.exists(resolved):
        return None
    return resolved


def _get_voice_prompt(sample_path: str) -> object:
    """Get or create a cached voice clone prompt from an audio file."""
    mtime = os.path.getmtime(sample_path)
    cache_key = f"{sample_path}:{mtime}"

    if cache_key in _voice_prompt_cache:
        return _voice_prompt_cache[cache_key]

    # Look for transcript sidecar file
    txt_path = re.sub(r"\.[^.]+$", ".txt", sample_path)
    transcript = None
    if os.path.exists(txt_path):
        transcript = open(txt_path, "r", encoding="utf-8").read().strip()

    if transcript:
        prompt = _model.create_voice_clone_prompt(
            ref_audio=sample_path,
            ref_text=transcript,
        )
    else:
        prompt = _model.create_voice_clone_prompt(
            ref_audio=sample_path,
            x_vector_only_mode=True,
        )

    _voice_prompt_cache[cache_key] = prompt
    return prompt


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


class TTSRequest(BaseModel):
    text: str
    language: str = ""
    qwen3LanguageName: Optional[str] = None
    voiceSamplePath: Optional[str] = None
    speed: float = 1.0


@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": _model is not None}


@app.get("/voice/tts/status")
async def tts_status():
    return {
        "downloaded": True,
        "loaded": _model is not None,
        "downloading": False,
        "progress": 1.0 if _model is not None else 0.0,
        "modelName": MODEL_NAME,
        "loading": _loading,
    }


def _read_language_metadata(language: str) -> dict:
    language_file = LANGUAGE_DATA_PATH / "languages" / f"{language}.json"
    if not language_file.is_file():
        return {}
    try:
        candidate = json.loads(language_file.read_text(encoding="utf-8"))
    except Exception as exc:
        log.warning("Failed to read language metadata for %s from %s: %s", language, language_file, exc)
        return {}
    return candidate if isinstance(candidate, dict) else {}


def _sentence_terminators(language: str | None) -> str:
    data = _read_language_metadata(language) if language else {}
    value = (
        data.get("textProcessing", {})
        .get("sentenceTerminators")
        if isinstance(data.get("textProcessing", {}), dict)
        else None
    )
    if isinstance(value, list):
        configured = "".join(str(item) for item in value if isinstance(item, str) and item)
        if configured:
            return configured
    return DEFAULT_SENTENCE_TERMINATORS


def _split_into_sentences(text: str, language: str | None = None) -> list[str]:
    sentence_endings = _sentence_terminators(language)
    sentences = re.split(rf"(?<=[{re.escape(sentence_endings)}])\s*", text)
    return [s.strip() for s in sentences if s.strip()]


def _metadata_qwen3_language_name(language: str) -> str | None:
    data = _read_language_metadata(language)
    if not data:
        return None

    value = (
        data.get("runtime", {})
        .get("tts", {})
        .get("qwen3LanguageName")
    )
    return value if isinstance(value, str) and value else None


def _set_language_data_path(path: str | None) -> None:
    global LANGUAGE_DATA_PATH
    if path:
        LANGUAGE_DATA_PATH = Path(path).expanduser().resolve()


def _log_language_data_path() -> None:
    log.info("Language metadata path: %s", LANGUAGE_DATA_PATH / "languages")


@app.post("/voice/tts")
async def tts_generate(req: TTSRequest):
    if _model is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet")

    sentences = _split_into_sentences(req.text, req.language)
    if not sentences:
        sentences = [req.text]

    lang_code = req.qwen3LanguageName or _metadata_qwen3_language_name(req.language)
    if not lang_code:
        raise HTTPException(
            status_code=400,
            detail=f"Qwen3 TTS is not configured for language '{req.language}'",
        )

    # Prepare voice clone prompt if sample provided
    voice_prompt = None
    safe_voice_path = _validate_voice_sample_path(req.voiceSamplePath)
    if safe_voice_path:
        try:
            voice_prompt = _get_voice_prompt(safe_voice_path)
        except Exception as e:
            log.warning(f"Failed to create voice clone prompt: {e}")

    all_wavs = []
    sentence_boundaries = []
    sample_offset = 0

    for i, sentence in enumerate(sentences):
        start = time.time()
        try:
            if voice_prompt is not None:
                wav = _model.generate_voice_clone(
                    text=f"<|{lang_code}|>{sentence}",
                    voice_clone_prompt=voice_prompt,
                    speed=req.speed,
                )
            else:
                wav = _model.generate(
                    text=f"<|{lang_code}|>{sentence}",
                    speed=req.speed,
                )
        except Exception as e:
            log.error(f"Generation failed for sentence {i}: {e}")
            continue

        elapsed = time.time() - start
        log.info(f"Sentence {i} ({len(sentence)} chars) generated in {elapsed:.2f}s")

        # generate_voice_clone may return (audio, sr) tuple
        if isinstance(wav, (tuple, list)):
            wav = wav[0]

        if isinstance(wav, torch.Tensor):
            if wav.dim() == 1:
                wav = wav.unsqueeze(0)
        else:
            wav = torch.tensor(wav).unsqueeze(0)

        num_samples = wav.shape[-1]
        sentence_boundaries.append(
            {
                "index": i,
                "text": sentence,
                "sampleOffset": sample_offset,
                "sampleCount": num_samples,
            }
        )
        sample_offset += num_samples
        all_wavs.append(wav)

    if not all_wavs:
        raise HTTPException(status_code=500, detail="No audio generated")

    combined = torch.cat(all_wavs, dim=-1)
    buf = io.BytesIO()
    torchaudio.save(buf, combined, SAMPLE_RATE, format="wav")
    buf.seek(0)

    from starlette.responses import Response

    return Response(
        content=buf.read(),
        media_type="audio/wav",
        headers={
            "X-Sentence-Boundaries": json.dumps(sentence_boundaries),
            "X-Sample-Rate": str(SAMPLE_RATE),
        },
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Qwen3-TTS remote server")
    parser.add_argument("--host", default="0.0.0.0", help="Bind address")
    parser.add_argument("--port", type=int, default=7760, help="Port")
    parser.add_argument(
        "--no-preload", action="store_true", help="Don't load model at startup"
    )
    parser.add_argument(
        "--language-data-path",
        default=os.environ.get("MLEARN_LANGUAGE_DATA_PATH"),
        help="Path to mLearn language-data containing languages/<code>.json metadata",
    )
    args = parser.parse_args()
    _set_language_data_path(args.language_data_path)
    _log_language_data_path()

    if not args.no_preload:
        load_model()

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port)
