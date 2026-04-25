"""
Voice routes — STT (faster-whisper), TTS (Kokoro / Qwen3 / Remote), VAD (Silero).

Provides:
  POST /voice/tts           — generate TTS audio (WAV)
  POST /voice/models/download — pre-download voice models
  GET  /voice/stt/status    — STT model status
  GET  /voice/tts/status    — TTS model status
  WS   /voice/stream        — real-time VAD + STT WebSocket
"""

import asyncio
import gc
import importlib
import io
import json
import os
import threading
import time
import traceback

import numpy as np
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from starlette.responses import Response
from typing import Optional

import config
from logging_utils import _log

router = APIRouter()

# ── Global state ──

_voice_stt_model = None
_voice_tts_pipeline = None  # Kokoro KPipeline instance
_voice_vad_model = None
_voice_vad_lock = threading.Lock()
_voice_stt_lock = threading.Lock()
_voice_tts_lock = threading.Lock()

_VOICE_IDLE_TIMEOUT_SECONDS = 600
_voice_last_used: float = 0.0
_voice_idle_timer: threading.Timer | None = None
_voice_idle_lock = threading.Lock()

_voice_stt_downloading = False
_voice_tts_downloading = False
_voice_stt_progress = 0.0
_voice_tts_progress = 0.0

_qwen3_model_loading = False  # True while model download/load is in progress

# TTS provider config — reloaded from settings.json per-request
_tts_provider: str = "kokoro"  # 'kokoro' | 'qwen3' | 'cloud'

# Kokoro language code mapping (mLearn lang → Kokoro lang_code)
_KOKORO_LANG_MAP = {
    "ja": "j",
    "en": "a",
    "zh": "z",
    "ko": "j",  # fallback to Japanese phonemizer
    "fr": "f",
    "es": "e",
    "hi": "h",
    "it": "i",
    "pt": "p",
}

# Default Kokoro voice per language
_KOKORO_VOICE_MAP = {
    "j": "jf_alpha",
    "a": "af_heart",
    "z": "zf_xiaobei",
    "f": "ff_siwis",
    "e": "ef_dora",
    "h": "hf_alpha",
    "i": "if_sara",
    "p": "pf_dora",
}


def _reload_tts_settings():
    """Reload TTS provider settings from settings.json (called per-request)."""
    global _tts_provider
    user_data = config.USER_DATA_PATH
    if not user_data:
        return
    settings_path = os.path.join(user_data, "settings.json")
    if not os.path.exists(settings_path):
        return
    try:
        with open(settings_path, "r", encoding="utf-8") as f:
            settings = json.load(f)
            _tts_provider = settings.get("ttsProvider", "kokoro")
    except Exception:
        pass


# Load initial settings
_reload_tts_settings()


def _validate_voice_sample_path(path_str: str | None) -> str | None:
    """Validate voiceSamplePath is within USER_DATA_PATH."""
    if not path_str:
        return None
    resolved = os.path.realpath(path_str)
    allowed_base = os.path.realpath(config.USER_DATA_PATH)
    if not resolved.startswith(allowed_base + os.sep) and resolved != allowed_base:
        raise HTTPException(status_code=400, detail="Invalid voice sample path")
    if not os.path.exists(resolved):
        return None
    return resolved


# ── Idle management ──


def _voice_touch():
    global _voice_last_used, _voice_idle_timer
    _voice_last_used = time.monotonic()
    with _voice_idle_lock:
        if _voice_idle_timer is not None:
            _voice_idle_timer.cancel()
        _voice_idle_timer = threading.Timer(
            _VOICE_IDLE_TIMEOUT_SECONDS, _voice_check_idle
        )
        _voice_idle_timer.daemon = True
        _voice_idle_timer.start()


def _voice_check_idle():
    elapsed = time.monotonic() - _voice_last_used
    if elapsed >= _VOICE_IDLE_TIMEOUT_SECONDS:
        _voice_unload()
    else:
        remaining = _VOICE_IDLE_TIMEOUT_SECONDS - elapsed
        with _voice_idle_lock:
            global _voice_idle_timer
            _voice_idle_timer = threading.Timer(remaining, _voice_check_idle)
            _voice_idle_timer.daemon = True
            _voice_idle_timer.start()


def _voice_unload():
    global _voice_stt_model, _voice_tts_pipeline, _voice_vad_model
    any_unloaded = False
    with _voice_vad_lock:
        if _voice_vad_model is not None:
            _log("Voice idle — unloading VAD model")
            del _voice_vad_model
            _voice_vad_model = None
            any_unloaded = True
    with _voice_stt_lock:
        if _voice_stt_model is not None:
            _log("Voice idle — unloading STT model")
            del _voice_stt_model
            _voice_stt_model = None
            any_unloaded = True
    with _voice_tts_lock:
        if _voice_tts_pipeline is not None:
            _log("Voice idle — unloading TTS pipeline")
            del _voice_tts_pipeline
            _voice_tts_pipeline = None
            any_unloaded = True
    if any_unloaded:
        gc.collect()
        torch = config.torch
        if torch is not None:
            try:
                if hasattr(torch, "cuda") and torch.cuda.is_available():
                    torch.cuda.empty_cache()
                if hasattr(torch, "mps") and hasattr(torch.mps, "empty_cache"):
                    torch.mps.empty_cache()
            except Exception:
                pass
        _log("Voice models unloaded")


# ── Device helpers ──


def _get_stt_device():
    """CUDA or CPU only (faster-whisper / CTranslate2 has no MPS support)."""
    torch = config.torch
    _torch = importlib.import_module("torch") if torch is None else torch
    if _torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _get_tts_device():
    """MPS > CUDA > CPU."""
    torch = config.torch
    _torch = importlib.import_module("torch") if torch is None else torch
    if hasattr(_torch.backends, "mps") and _torch.backends.mps.is_available():
        return "mps"
    if _torch.cuda.is_available():
        return "cuda"
    return "cpu"


# ── Model loading ──


def _ensure_vad_loaded():
    global _voice_vad_model
    if _voice_vad_model is not None:
        return _voice_vad_model
    with _voice_vad_lock:
        if _voice_vad_model is not None:
            return _voice_vad_model
        try:
            _log("Loading Silero VAD model...")
            torch = config.torch
            _torch = importlib.import_module("torch") if torch is None else torch
            model, utils = _torch.hub.load(
                repo_or_dir="snakers4/silero-vad",
                model="silero_vad",
                force_reload=False,
                onnx=False,
            )
            _voice_vad_model = {"model": model, "utils": utils}
            _log("Silero VAD loaded")
            _voice_touch()
            return _voice_vad_model
        except Exception as e:
            _log("Failed to load VAD:", e)
            raise


def _ensure_stt_loaded():
    global _voice_stt_model
    if _voice_stt_model is not None:
        return _voice_stt_model
    with _voice_stt_lock:
        if _voice_stt_model is not None:
            return _voice_stt_model
        try:
            _log("Loading faster-whisper STT model (small)...")
            from faster_whisper import WhisperModel

            device = _get_stt_device()
            compute_type = "float16" if device == "cuda" else "int8"
            _voice_stt_model = WhisperModel(
                "small",
                device=device,
                compute_type=compute_type,
            )
            _log(f"faster-whisper loaded on {device}")
            _voice_touch()
            return _voice_stt_model
        except Exception as e:
            _log("Failed to load STT:", e)
            raise


def _ensure_tts_loaded():
    """Load the local Kokoro TTS pipeline (lazy, thread-safe)."""
    global _voice_tts_pipeline
    if _voice_tts_pipeline is not None:
        return _voice_tts_pipeline
    with _voice_tts_lock:
        if _voice_tts_pipeline is not None:
            return _voice_tts_pipeline
        try:
            _log("Loading Kokoro-82M TTS pipeline...")
            from kokoro import KPipeline

            lang_code = _KOKORO_LANG_MAP.get(config.LANGUAGE, "a")
            _voice_tts_pipeline = KPipeline(
                lang_code=lang_code,
                repo_id="hexgrad/Kokoro-82M",
            )
            _log(f"Kokoro TTS pipeline loaded (lang={lang_code})")
            _voice_touch()
            return _voice_tts_pipeline
        except Exception as e:
            _log("Failed to load Kokoro TTS:", e)
            raise


def _split_into_sentences(text: str) -> list:
    import re as _re

    sentences = _re.split(r"(?<=[.!?。！？])\s*", text)
    return [s.strip() for s in sentences if s.strip()]


# ── Pydantic models ──


class TTSRequest(BaseModel):
    text: str
    language: str = "en"
    voiceSamplePath: Optional[str] = None
    speed: float = 1.0
    provider: Optional[str] = None


# ── STT / TTS status endpoints ──


@router.get("/voice/stt/status")
async def voice_stt_status():
    downloaded = False
    loaded = _voice_stt_model is not None
    try:
        from faster_whisper import WhisperModel  # noqa: F401

        downloaded = True
    except ImportError:
        pass
    return {
        "downloaded": downloaded,
        "loaded": loaded,
        "downloading": _voice_stt_downloading,
        "progress": _voice_stt_progress,
        "modelName": "openai/whisper-small",
    }


@router.get("/voice/tts/status")
async def voice_tts_status():
    if _tts_provider == "cloud":
        # Cloud TTS is handled entirely on the client side (CloudTTSAdapter).
        # Report as "loaded" so the UI doesn't show download/loading spinners.
        return {
            "downloaded": True,
            "loaded": True,
            "downloading": False,
            "progress": 1.0,
            "modelName": "Cloud TTS",
        }

    # Kokoro or Qwen3 local
    package_installed = False
    loaded = _voice_tts_pipeline is not None
    if _tts_provider == "qwen3":
        try:
            _install_sox_shim()
            from qwen_tts import Qwen3TTSModel  # noqa: F401

            package_installed = True
        except ImportError:
            pass
        return {
            "downloaded": package_installed,
            "loaded": _qwen3_tts_model is not None,
            "downloading": _voice_tts_downloading or _qwen3_model_loading,
            "progress": _voice_tts_progress,
            "modelLoading": _qwen3_model_loading,
            "modelName": "Qwen3-TTS-1.7B",
        }

    # Kokoro
    try:
        from kokoro import KPipeline  # noqa: F401

        package_installed = True
    except ImportError:
        pass
    return {
        "downloaded": package_installed,
        "loaded": loaded,
        "downloading": _voice_tts_downloading,
        "progress": _voice_tts_progress,
        "modelName": "Kokoro-82M",
    }


# ── Download trigger ──


@router.post("/voice/models/download")
async def voice_download_models():
    global _voice_stt_downloading, _voice_tts_downloading
    global _voice_stt_progress, _voice_tts_progress

    errors = []

    try:
        _voice_stt_downloading = True
        _voice_stt_progress = 0.0
        _log("Pre-downloading STT model...")
        _ensure_stt_loaded()
        _voice_stt_progress = 1.0
        _voice_stt_downloading = False
    except Exception as e:
        _voice_stt_downloading = False
        errors.append(f"STT: {e}")

    if _tts_provider in ("kokoro", "qwen3"):
        try:
            _voice_tts_downloading = True
            _voice_tts_progress = 0.0
            _log("Pre-downloading TTS model...")
            if _tts_provider == "qwen3":
                _ensure_qwen3_tts_loaded()
            else:
                _ensure_tts_loaded()
            _voice_tts_progress = 1.0
            _voice_tts_downloading = False
        except Exception as e:
            _voice_tts_downloading = False
            errors.append(f"TTS: {e}")

    if errors:
        return {"success": False, "errors": errors}
    return {"success": True}


# ── Main TTS endpoint ──


@router.post("/voice/tts")
async def voice_tts_generate(req: TTSRequest):
    """Generate TTS audio. Returns binary WAV with sentence boundary metadata."""
    _reload_tts_settings()
    try:
        # Allow per-request provider override (e.g. flashcard TTS testing)
        provider = req.provider or _tts_provider
        if provider == "cloud":
            raise HTTPException(
                status_code=400,
                detail="Cloud TTS is handled on the client side. This endpoint should not be called for cloud provider.",
            )
        if provider == "qwen3":
            return await _generate_tts_qwen3(req)
        if provider == "kokoro" and req.language not in _KOKORO_LANG_MAP:
            # Kokoro has no phonemizer for this language; delegate to Qwen3
            # which supports a broader language set (see _QWEN3_LANG_MAP).
            if req.language in _QWEN3_LANG_MAP:
                _log(
                    f"Kokoro does not support language '{req.language}'; "
                    "falling back to Qwen3-TTS"
                )
                return await _generate_tts_qwen3(req)
            raise HTTPException(
                status_code=400,
                detail=f"No TTS engine supports language '{req.language}'",
            )
        return await _generate_tts_kokoro(req)
    except Exception as e:
        _log("TTS generation error:", e)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


async def _generate_tts_kokoro(req: TTSRequest):
    """Generate TTS audio using the local Kokoro pipeline."""

    def _run_sync():
        pipeline = _ensure_tts_loaded()
        _voice_touch()

        sentences = _split_into_sentences(req.text)
        if not sentences:
            sentences = [req.text]

        lang_code = _KOKORO_LANG_MAP.get(req.language, "a")
        voice = _KOKORO_VOICE_MAP.get(lang_code, "af_heart")

        # Recreate pipeline if language changed
        active_pipeline = pipeline
        if active_pipeline.lang_code != lang_code:
            from kokoro import KPipeline

            active_pipeline = KPipeline(
                lang_code=lang_code, repo_id="hexgrad/Kokoro-82M"
            )

        all_audio = []
        sentence_boundaries = []
        sample_offset = 0
        sr = 24000

        for i, sentence in enumerate(sentences):
            chunks = []
            for _gs, _ps, audio in active_pipeline(
                sentence, voice=voice, speed=req.speed
            ):
                chunks.append(audio)

            if chunks:
                sentence_audio = np.concatenate(chunks)
                num_samples = len(sentence_audio)
                sentence_boundaries.append(
                    {
                        "index": i,
                        "text": sentence,
                        "sampleOffset": sample_offset,
                        "sampleCount": num_samples,
                    }
                )
                sample_offset += num_samples
                all_audio.append(sentence_audio)

        if not all_audio:
            raise HTTPException(status_code=500, detail="No audio generated")

        combined = np.concatenate(all_audio)
        import soundfile as sf

        buf = io.BytesIO()
        sf.write(buf, combined, sr, format="WAV", subtype="PCM_16")
        buf.seek(0)
        return buf.read(), sentence_boundaries, sr

    content, sentence_boundaries, sr = await asyncio.to_thread(_run_sync)

    return Response(
        content=content,
        media_type="audio/wav",
        headers={
            "X-Sentence-Boundaries": json.dumps(sentence_boundaries),
            "X-Sample-Rate": str(sr),
        },
    )


# ── Qwen3-TTS ──

_qwen3_tts_model = None
_qwen3_tts_lock = threading.Lock()
_qwen3_voice_prompt_cache: dict[str, object] = {}

_QWEN3_TTS_MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"

# Qwen3-TTS supported languages (full names required by the model)
_QWEN3_LANG_MAP = {
    "zh": "chinese",
    "en": "english",
    "ja": "japanese",
    "ko": "korean",
    "de": "german",
    "fr": "french",
    "ru": "russian",
    "pt": "portuguese",
    "es": "spanish",
    "it": "italian",
}


def _install_sox_shim():
    """Install a pure-numpy replacement for the ``sox`` (pysox) module.

    qwen_tts uses ``sox.Transformer().norm(db_level).build_array(…)`` which
    shells out to the SoX CLI binary.  Requiring users to install SoX is
    impractical, so we inject a lightweight shim that normalises audio peak
    amplitude using numpy — the only operation qwen_tts actually needs.
    """
    import sys
    import types

    if "sox" in sys.modules:
        return

    class _Transformer:
        def __init__(self):
            self._target_db: float = 0.0

        def norm(self, db_level: float = 0.0):
            self._target_db = db_level
            return self

        def build_array(
            self,
            input_array: "np.ndarray",
            sample_rate_in: int = 16000,
        ) -> "np.ndarray":
            audio = np.array(input_array, dtype=np.float64)
            peak = np.max(np.abs(audio))
            if peak < 1e-10:
                return audio.astype(np.float32)
            target_peak = 10.0 ** (self._target_db / 20.0)
            audio = audio * (target_peak / peak)
            return audio.astype(np.float32)

    sox_module = types.ModuleType("sox")
    sox_module.Transformer = _Transformer  # type: ignore[attr-defined]
    sys.modules["sox"] = sox_module


def _ensure_qwen3_tts_loaded():
    """Load Qwen3-TTS model (lazy, thread-safe).

    On first call the model weights are downloaded from HuggingFace (several GB)
    and then loaded into memory.  Progress is logged so the Electron front-end
    can relay it to the user.
    """
    global _qwen3_tts_model, _qwen3_model_loading, _voice_tts_progress
    if _qwen3_tts_model is not None:
        return _qwen3_tts_model
    with _qwen3_tts_lock:
        if _qwen3_tts_model is not None:
            return _qwen3_tts_model
        _qwen3_model_loading = True
        _voice_tts_progress = 0.0
        stop_monitor = threading.Event()
        try:
            _install_sox_shim()

            # ── Determine expected download size & start progress monitor ──
            total_bytes = 0
            cache_blobs_dir = None
            try:
                from huggingface_hub import model_info
                from huggingface_hub.constants import HF_HUB_CACHE

                info = model_info(_QWEN3_TTS_MODEL_ID)
                total_bytes = sum(s.size for s in (info.siblings or []) if s.size)
                import pathlib

                repo_dir = (
                    pathlib.Path(HF_HUB_CACHE)
                    / f"models--{_QWEN3_TTS_MODEL_ID.replace('/', '--')}"
                )
                cache_blobs_dir = repo_dir / "blobs"
            except Exception:
                pass

            def _monitor():
                """Background thread: poll cache dir size → update progress."""
                last_pct = -1
                while not stop_monitor.is_set():
                    if cache_blobs_dir and total_bytes > 0:
                        try:
                            cur = sum(
                                f.stat().st_size
                                for f in cache_blobs_dir.rglob("*")
                                if f.is_file()
                            )
                            pct = min(cur / total_bytes, 1.0)
                            # Download is 0-80 % of overall progress
                            _set_tts_progress(pct * 0.8)
                            pct_10 = int(pct * 10)
                            if pct_10 > last_pct:
                                last_pct = pct_10
                                mb_done = cur / (1024 * 1024)
                                mb_total = total_bytes / (1024 * 1024)
                                _log(
                                    f"Qwen3-TTS download: {mb_done:.0f}/{mb_total:.0f} MB ({pct:.0%})"
                                )
                        except Exception:
                            pass
                    stop_monitor.wait(2)

            monitor_thread = threading.Thread(target=_monitor, daemon=True)

            if total_bytes > 0 and cache_blobs_dir:
                _log(f"Downloading Qwen3-TTS model ({total_bytes / (1024**3):.1f} GB)…")
                monitor_thread.start()
            else:
                _log("Loading Qwen3-TTS model…")

            import torch
            from qwen_tts import Qwen3TTSModel

            device = (
                "cuda"
                if torch.cuda.is_available()
                else "mps"
                if torch.backends.mps.is_available()
                else "cpu"
            )
            _log(f"Loading Qwen3-TTS on device: {device}")

            # Qwen3TTSModel is a wrapper (not nn.Module), so .to() is not
            # available.  Pass device_map for CUDA; for MPS / CPU, load on
            # CPU first and move the inner PyTorch model manually.
            load_kwargs: dict = {}
            if device.startswith("cuda"):
                load_kwargs["device_map"] = device

            _qwen3_tts_model = Qwen3TTSModel.from_pretrained(
                _QWEN3_TTS_MODEL_ID, **load_kwargs
            )

            if not device.startswith("cuda"):
                _qwen3_tts_model.model = _qwen3_tts_model.model.to(device)
                _qwen3_tts_model.device = torch.device(device)
            stop_monitor.set()
            _set_tts_progress(1.0)
            _qwen3_model_loading = False
            _log(f"Qwen3-TTS model loaded successfully on {device}")
            _voice_touch()
            return _qwen3_tts_model
        except Exception as e:
            stop_monitor.set()
            _qwen3_model_loading = False
            _voice_tts_progress = 0.0
            _log("Failed to load Qwen3-TTS:", e)
            raise


def _set_tts_progress(value: float):
    """Helper to update the TTS progress global."""
    global _voice_tts_progress
    _voice_tts_progress = value


def _get_qwen3_voice_prompt(model, voice_sample_path: str | None):
    """Get or create a cached voice clone prompt from a reference audio file."""
    if not voice_sample_path or not os.path.exists(voice_sample_path):
        return None

    # Cache key: file path + modification time
    try:
        mtime = os.path.getmtime(voice_sample_path)
        cache_key = f"{voice_sample_path}:{mtime}"
    except OSError:
        cache_key = voice_sample_path

    if cache_key in _qwen3_voice_prompt_cache:
        return _qwen3_voice_prompt_cache[cache_key]

    try:
        _log(f"Creating Qwen3 voice clone prompt from {str(voice_sample_path)[:100]}")

        # Load reference audio transcript from sidecar .txt file
        # Electron saves the sidecar by replacing the audio extension with .txt
        base, _ext = os.path.splitext(voice_sample_path)
        transcript_path = base + ".txt"
        ref_text = None
        if os.path.exists(transcript_path):
            try:
                with open(transcript_path, "r", encoding="utf-8") as f:
                    ref_text = f.read().strip()
                _log(f"Using transcript from {str(transcript_path)[:100]}")
            except Exception:
                pass

        if ref_text:
            prompt = model.create_voice_clone_prompt(
                ref_audio=voice_sample_path,
                ref_text=ref_text,
            )
        else:
            # No transcript — use x_vector_only mode (lower quality but no text needed)
            prompt = model.create_voice_clone_prompt(
                ref_audio=voice_sample_path,
                x_vector_only_mode=True,
            )

        _qwen3_voice_prompt_cache[cache_key] = prompt
        _log("Qwen3 voice prompt cached")
        return prompt
    except Exception as e:
        _log("Failed to create Qwen3 voice prompt:", e)
        return None


async def _generate_tts_qwen3(req: TTSRequest):
    """Generate TTS audio using local Qwen3-TTS model with optional voice cloning."""

    def _run_sync():
        model = _ensure_qwen3_tts_loaded()
        _voice_touch()

        sentences = _split_into_sentences(req.text)
        if not sentences:
            sentences = [req.text]

        lang = _QWEN3_LANG_MAP.get(req.language, "english")

        # Get voice clone prompt if a sample is provided
        safe_voice_path = _validate_voice_sample_path(req.voiceSamplePath)
        voice_prompt = _get_qwen3_voice_prompt(model, safe_voice_path)

        all_audio = []
        sentence_boundaries = []
        sample_offset = 0
        sr = 24000  # Qwen3-TTS output at 24kHz

        for i, sentence in enumerate(sentences):
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    gen_kwargs = {
                        "text": sentence,
                        "language": lang,
                    }
                    if voice_prompt is not None:
                        audio = model.generate_voice_clone(
                            **gen_kwargs,
                            voice_clone_prompt=voice_prompt,
                        )
                    else:
                        audio = model.generate(**gen_kwargs)

                    if audio is not None:
                        # generate_voice_clone may return (audio, sr) tuple
                        if isinstance(audio, (tuple, list)):
                            audio = audio[0]
                        if hasattr(audio, "numpy"):
                            audio = audio.numpy()
                        audio_np = np.asarray(audio, dtype=np.float32).flatten()

                        # Apply speed adjustment if not 1.0
                        if req.speed != 1.0 and req.speed > 0:
                            import librosa

                            audio_np = librosa.effects.time_stretch(
                                audio_np, rate=req.speed
                            )

                        num_samples = len(audio_np)
                        sentence_boundaries.append(
                            {
                                "index": i,
                                "text": sentence,
                                "sampleOffset": sample_offset,
                                "sampleCount": num_samples,
                            }
                        )
                        sample_offset += num_samples
                        all_audio.append(audio_np)
                    break  # Success or None result, stop retrying
                except Exception as e:
                    is_retryable = (
                        "probability tensor" in str(e)
                        or "inf" in str(e)
                        or "nan" in str(e)
                    )
                    if is_retryable and attempt < max_retries - 1:
                        _log(
                            f"Qwen3-TTS retryable error on sentence {i} (attempt {attempt + 1}/{max_retries}):",
                            e,
                        )
                        continue
                    _log(f"Qwen3-TTS error on sentence {i}:", e)
                    break

        if not all_audio:
            raise HTTPException(status_code=500, detail="No audio generated")

        combined = np.concatenate(all_audio)
        import soundfile as sf

        buf = io.BytesIO()
        sf.write(buf, combined, sr, format="WAV", subtype="PCM_16")
        buf.seek(0)
        return buf.read(), sentence_boundaries, sr

    content, sentence_boundaries, sr = await asyncio.to_thread(_run_sync)

    return Response(
        content=content,
        media_type="audio/wav",
        headers={
            "X-Sentence-Boundaries": json.dumps(sentence_boundaries),
            "X-Sample-Rate": str(sr),
        },
    )


# ── Voice sample transcription ──


class TranscribeRequest(BaseModel):
    voiceSamplePath: str


@router.post("/voice/transcribe")
async def voice_transcribe(req: TranscribeRequest):
    """Transcribe an audio file using STT. Used to generate transcripts for voice samples."""
    audio_path = _validate_voice_sample_path(req.voiceSamplePath)
    if not audio_path:
        raise HTTPException(status_code=400, detail="Audio file not found")

    stt_model = _ensure_stt_loaded()
    _voice_touch()
    try:
        segments, info = await asyncio.to_thread(
            lambda: stt_model.transcribe(
                audio_path,
                beam_size=5,
                vad_filter=True,
            )
        )
        text = " ".join(seg.text for seg in segments).strip()
        return {"text": text, "language": info.language}
    except Exception as e:
        _log("Transcription error:", e)
        raise HTTPException(status_code=500, detail=str(e))


# ── WebSocket streaming ──


@router.websocket("/voice/stream")
async def voice_stream_ws(websocket: WebSocket):
    """
    Real-time voice streaming WebSocket.
    Receives raw PCM audio (16kHz, mono, float32).
    Sends JSON messages:
      { "type": "vad", "event": "speech-start" | "speech-end" }
      { "type": "stt", "text": "...", "isFinal": bool, "isPartial": bool }
      { "type": "error", "message": "..." }
      { "type": "ready" }
    """
    token = websocket.query_params.get("token")
    quit_token = getattr(config, "QUIT_TOKEN", None)
    if quit_token and token != quit_token:
        await websocket.close(code=4003, reason="Unauthorized")
        return

    await websocket.accept()

    language = websocket.query_params.get("language", config.LANGUAGE or "en")
    silence_threshold = float(websocket.query_params.get("silence", "1.5"))

    try:
        _reload_tts_settings()
        loop = asyncio.get_running_loop()
        vad_future = loop.run_in_executor(None, _ensure_vad_loaded)
        stt_future = loop.run_in_executor(None, _ensure_stt_loaded)

        futures = [vad_future, stt_future]
        if _tts_provider == "kokoro":
            futures.append(loop.run_in_executor(None, _ensure_tts_loaded))
        elif _tts_provider == "qwen3":
            futures.append(loop.run_in_executor(None, _ensure_qwen3_tts_loaded))

        results = await asyncio.gather(*futures)
        vad_data = results[0]
        stt_model = results[1]
        vad_model = vad_data["model"]

        await websocket.send_json({"type": "ready"})

        # State
        audio_buffer = bytearray()
        speech_buffer = bytearray()
        is_speaking = False
        silence_start: float | None = None
        last_partial_time: float = 0.0
        PARTIAL_INTERVAL = 1.0
        SAMPLE_RATE = 16000
        CHUNK_SAMPLES = 512
        MAX_SPEECH_SECONDS = 30
        MAX_SPEECH_BYTES = MAX_SPEECH_SECONDS * SAMPLE_RATE * 4

        _HALLUCINATION_PATTERNS = {
            "ご視聴ありがとうございます",
            "ご視聴ありがとうございました",
            "おやすみなさい",
            "お疲れ様でした",
            "次の動画でお会いしましょう",
            "チャンネル登録",
            "thank you for watching",
            "thanks for watching",
            "please subscribe",
            "see you in the next video",
            "like and subscribe",
        }

        def _is_hallucination(text: str, audio_duration_s: float) -> bool:
            stripped = text.strip().lower().rstrip("。！？.!?")
            if audio_duration_s < 1.0 and len(stripped) > 5:
                return True
            for pattern in _HALLUCINATION_PATTERNS:
                if pattern in stripped:
                    return True
            return False

        async def _run_final_stt(buffer: bytearray) -> None:
            buffer_bytes = bytes(buffer)
            if len(buffer_bytes) < int(SAMPLE_RATE * 4 * 0.3):
                return
            try:
                speech_np = np.frombuffer(buffer_bytes, dtype=np.float32)
                audio_duration = len(speech_np) / SAMPLE_RATE
                _voice_touch()
                segments, info = await asyncio.to_thread(
                    lambda: stt_model.transcribe(
                        speech_np,
                        language=language,
                        beam_size=5,
                        vad_filter=False,
                        condition_on_previous_text=False,
                        no_speech_threshold=0.6,
                        log_prob_threshold=-1.0,
                    )
                )
                final_text = " ".join(seg.text for seg in segments).strip()
                if final_text and not _is_hallucination(final_text, audio_duration):
                    await websocket.send_json(
                        {
                            "type": "stt",
                            "text": final_text,
                            "isFinal": True,
                            "isPartial": False,
                        }
                    )
            except Exception as e:
                _log("Final STT error:", e)
                await websocket.send_json({"type": "error", "message": str(e)})

        while True:
            try:
                raw_data = await asyncio.wait_for(websocket.receive(), timeout=30.0)
            except asyncio.TimeoutError:
                try:
                    await websocket.send_json({"type": "ping"})
                except Exception:
                    break
                continue
            except WebSocketDisconnect:
                break

            if "text" in raw_data:
                try:
                    cmd = json.loads(raw_data["text"])
                    cmd_type = cmd.get("type", "")

                    if cmd_type == "flush":
                        if is_speaking and len(speech_buffer) > 0:
                            is_speaking = False
                            silence_start = None
                            await websocket.send_json(
                                {"type": "vad", "event": "speech-end"}
                            )
                            await _run_final_stt(speech_buffer)
                            speech_buffer = bytearray()
                        continue

                    if cmd_type == "silence_threshold":
                        new_threshold = float(cmd.get("value", silence_threshold))
                        silence_threshold = max(0.3, min(10.0, new_threshold))
                        continue

                    if cmd_type == "pong":
                        continue

                except (json.JSONDecodeError, ValueError):
                    pass
                continue

            if "bytes" not in raw_data:
                continue

            data = raw_data["bytes"]
            audio_buffer.extend(data)

            bytes_per_sample = 4
            chunk_bytes = CHUNK_SAMPLES * bytes_per_sample

            while len(audio_buffer) >= chunk_bytes:
                chunk_data = bytes(audio_buffer[:chunk_bytes])
                del audio_buffer[:chunk_bytes]

                samples = np.frombuffer(chunk_data, dtype=np.float32)
                torch = config.torch
                _torch = importlib.import_module("torch") if torch is None else torch
                tensor = _torch.from_numpy(samples.copy())

                speech_prob = vad_model(tensor, SAMPLE_RATE).item()

                if speech_prob > 0.5:
                    if not is_speaking:
                        is_speaking = True
                        silence_start = None
                        speech_buffer = bytearray()
                        await websocket.send_json(
                            {"type": "vad", "event": "speech-start"}
                        )

                    speech_buffer.extend(chunk_data)

                    if len(speech_buffer) >= MAX_SPEECH_BYTES:
                        is_speaking = False
                        silence_start = None
                        await websocket.send_json(
                            {"type": "vad", "event": "speech-end"}
                        )
                        await _run_final_stt(speech_buffer)
                        speech_buffer = bytearray()
                        continue

                    now = time.monotonic()
                    if (
                        now - last_partial_time > PARTIAL_INTERVAL
                        and len(speech_buffer) > SAMPLE_RATE * bytes_per_sample
                    ):
                        last_partial_time = now
                        try:
                            speech_np = np.frombuffer(
                                bytes(speech_buffer), dtype=np.float32
                            )
                            segments, _ = await asyncio.to_thread(
                                lambda: stt_model.transcribe(
                                    speech_np,
                                    language=language,
                                    beam_size=1,
                                    vad_filter=False,
                                    condition_on_previous_text=False,
                                    no_speech_threshold=0.6,
                                )
                            )
                            partial_text = " ".join(
                                seg.text for seg in segments
                            ).strip()
                            if partial_text and not _is_hallucination(
                                partial_text, len(speech_np) / SAMPLE_RATE
                            ):
                                await websocket.send_json(
                                    {
                                        "type": "stt",
                                        "text": partial_text,
                                        "isFinal": False,
                                        "isPartial": True,
                                    }
                                )
                        except Exception as e:
                            _log("Partial STT error:", e)
                else:
                    if is_speaking:
                        speech_buffer.extend(chunk_data)
                        if silence_start is None:
                            silence_start = time.monotonic()
                        elif time.monotonic() - silence_start > silence_threshold:
                            is_speaking = False
                            silence_start = None
                            await websocket.send_json(
                                {"type": "vad", "event": "speech-end"}
                            )
                            await _run_final_stt(speech_buffer)
                            speech_buffer = bytearray()
                    else:
                        silence_start = None

    except WebSocketDisconnect:
        _log("Voice WebSocket disconnected")
    except Exception as e:
        _log("Voice WebSocket error:", e)
        traceback.print_exc()
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
