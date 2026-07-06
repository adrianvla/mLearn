"""
Voice routes — STT (faster-whisper), local TTS (Kokoro / Qwen3), VAD (Silero).

Provides:
  POST /voice/tts           — generate TTS audio (WAV)
  POST /voice/models/download — pre-download voice models
  GET  /voice/stt/status    — STT model status
  GET  /voice/tts/status    — TTS model status
  WS   /voice/stream        — real-time VAD + STT WebSocket
  WS   /voice/tts/stream    — local real-time Qwen3-TTS WebSocket
"""

import asyncio
import gc
import importlib
import inspect
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
from logging_utils import get_logger

log = get_logger("voice")

router = APIRouter()

os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

# ── Global state ──

_voice_stt_model = None
_voice_tts_pipelines: dict[str, object] = {}  # Kokoro KPipeline instances by lang_code
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

_DEFAULT_SENTENCE_TERMINATORS = ".!?。！？؟؛"


def _tts_runtime(language: str) -> dict:
    return config.language_runtime_config_for_language(language, "tts")


def _stt_runtime(language: str) -> dict:
    return config.language_runtime_config_for_language(language, "stt")


def _stt_language_hint(language: str | None) -> str | None:
    requested_language = language or config.LANGUAGE
    if not requested_language:
        return None
    value = _stt_runtime(requested_language).get("whisperLanguage")
    if value == "auto":
        return None
    if isinstance(value, str) and value:
        return value
    return None


def _stt_transcribe_options(language: str | None, **overrides) -> dict:
    options = dict(overrides)
    language_hint = _stt_language_hint(language)
    if language_hint:
        options["language"] = language_hint
    return options


def _kokoro_lang_code(language: str) -> str | None:
    value = _tts_runtime(language).get("kokoroLangCode")
    return str(value) if value else None


def _kokoro_voice(language: str, lang_code: str) -> str:
    value = _tts_runtime(language).get("kokoroVoice")
    if isinstance(value, str) and value:
        return value
    raise RuntimeError(
        f"Kokoro TTS voice is not configured for language '{language}' (lang={lang_code})"
    )


def _qwen3_language_name(language: str) -> str | None:
    value = _tts_runtime(language).get("qwen3LanguageName")
    return str(value) if value else None


def _language_tts_engine(language: str) -> str | None:
    value = _tts_runtime(language).get("engine")
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _resolve_tts_engine(language: str | None, provider: str | None = None) -> str:
    requested_language = language or config.LANGUAGE
    if not requested_language:
        raise RuntimeError("No language selected for TTS")
    requested_provider = provider or _tts_provider
    if requested_provider == "cloud":
        requested_provider = "qwen3"
    if requested_provider == "qwen3":
        if _qwen3_language_name(requested_language):
            return "qwen3"
        raise RuntimeError(f"Qwen3 TTS is not configured for language '{requested_language}'")
    if requested_provider == "kokoro":
        if _kokoro_lang_code(requested_language):
            return "kokoro"
        if _qwen3_language_name(requested_language):
            return "qwen3"
        package_engine = _language_tts_engine(requested_language)
        if package_engine:
            return package_engine
        raise RuntimeError(f"No TTS engine supports language '{requested_language}'")
    raise RuntimeError(f"Unsupported TTS provider: {requested_provider}")


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
            provider = settings.get("ttsProvider", "kokoro")
            _tts_provider = "qwen3" if provider == "cloud" else provider
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
    global _voice_stt_model, _voice_vad_model
    any_unloaded = False
    with _voice_vad_lock:
        if _voice_vad_model is not None:
            log.info("Voice idle — unloading VAD model")
            del _voice_vad_model
            _voice_vad_model = None
            any_unloaded = True
    with _voice_stt_lock:
        if _voice_stt_model is not None:
            log.info("Voice idle — unloading STT model")
            del _voice_stt_model
            _voice_stt_model = None
            any_unloaded = True
    with _voice_tts_lock:
        if _voice_tts_pipelines:
            log.info("Voice idle — unloading TTS pipeline")
            _voice_tts_pipelines.clear()
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
        log.info("Voice models unloaded")


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
            log.info("Loading Silero VAD model...")
            torch = config.torch
            _torch = importlib.import_module("torch") if torch is None else torch
            model, utils = _torch.hub.load(
                repo_or_dir="snakers4/silero-vad",
                model="silero_vad",
                force_reload=False,
                onnx=False,
            )
            _voice_vad_model = {"model": model, "utils": utils}
            log.info("Silero VAD loaded")
            _voice_touch()
            return _voice_vad_model
        except Exception as e:
            log.error(f"Failed to load VAD: {e}", exc_info=True)
            raise


def _ensure_stt_loaded():
    global _voice_stt_model, _voice_stt_downloading, _voice_stt_progress
    if _voice_stt_model is not None:
        return _voice_stt_model
    with _voice_stt_lock:
        if _voice_stt_model is not None:
            return _voice_stt_model
        try:
            _voice_stt_downloading = True
            _voice_stt_progress = max(_voice_stt_progress, 0.05)
            log.info("Loading faster-whisper STT model (small)...")
            from faster_whisper import WhisperModel

            device = _get_stt_device()
            compute_type = "float16" if device == "cuda" else "int8"
            _voice_stt_model = WhisperModel(
                "small",
                device=device,
                compute_type=compute_type,
            )
            log.info(f"faster-whisper loaded on {device}")
            _voice_touch()
            _voice_stt_progress = 1.0
            _voice_stt_downloading = False
            return _voice_stt_model
        except Exception as e:
            _voice_stt_progress = 0.0
            _voice_stt_downloading = False
            log.error(f"Failed to load STT: {e}", exc_info=True)
            raise


def _ensure_tts_loaded(language: str | None = None):
    """Load the local Kokoro TTS pipeline (lazy, thread-safe)."""
    global _voice_tts_downloading, _voice_tts_progress
    requested_language = language or config.LANGUAGE
    lang_code = _kokoro_lang_code(requested_language)
    if not lang_code:
        raise RuntimeError(
            f"Kokoro TTS is not configured for language '{requested_language}'"
        )
    if lang_code in _voice_tts_pipelines:
        return _voice_tts_pipelines[lang_code]
    with _voice_tts_lock:
        if lang_code in _voice_tts_pipelines:
            return _voice_tts_pipelines[lang_code]
        try:
            _voice_tts_downloading = True
            _voice_tts_progress = max(_voice_tts_progress, 0.05)
            log.info(f"Loading Kokoro-82M TTS pipeline (lang={lang_code})...")
            from kokoro import KPipeline

            pipeline = KPipeline(
                lang_code=lang_code,
                repo_id="hexgrad/Kokoro-82M",
            )
            _voice_tts_pipelines[lang_code] = pipeline
            log.info(f"Kokoro TTS pipeline loaded (lang={lang_code})")
            _voice_touch()
            _voice_tts_progress = 1.0
            _voice_tts_downloading = False
            return pipeline
        except Exception as e:
            _voice_tts_progress = 0.0
            _voice_tts_downloading = False
            log.error(f"Failed to load Kokoro TTS: {e}", exc_info=True)
            raise


def _sentence_terminators(language: str | None) -> str:
    requested_language = language or config.LANGUAGE
    value = (
        config.language_text_processing_config_for_language(requested_language)
        .get("sentenceTerminators")
    )
    if isinstance(value, list):
        configured = "".join(str(item) for item in value if isinstance(item, str) and item)
        if configured:
            return configured
    return _DEFAULT_SENTENCE_TERMINATORS


def _split_into_sentences(text: str, language: str | None = None) -> list:
    import re as _re

    sentence_endings = _sentence_terminators(language)
    sentences = _re.split(rf"(?<=[{_re.escape(sentence_endings)}])\s*", text)
    return [s.strip() for s in sentences if s.strip()]


def _normalize_stt_hallucination_text(text: str, language: str | None = None) -> str:
    return text.strip().lower().rstrip(_sentence_terminators(language))


# ── Pydantic models ──


class TTSRequest(BaseModel):
    text: str
    language: str = ""
    voiceSamplePath: Optional[str] = None
    speed: float = 1.0
    provider: Optional[str] = None


def _requested_tts_language(req: TTSRequest) -> str:
    return req.language or config.LANGUAGE


# ── STT / TTS status endpoints ──


@router.get("/voice/stt/status")
async def voice_stt_status(language: Optional[str] = None):
    requested_language = language or config.LANGUAGE
    whisper_language = _stt_language_hint(requested_language) if requested_language else None
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
        "language": requested_language,
        "whisperLanguage": whisper_language or "auto",
    }


@router.get("/voice/tts/status")
async def voice_tts_status(language: Optional[str] = None):
    _reload_tts_settings()
    requested_language = language or config.LANGUAGE
    try:
        engine = _resolve_tts_engine(requested_language)
    except RuntimeError as exc:
        return {
            "downloaded": False,
            "loaded": False,
            "downloading": False,
            "progress": 0.0,
            "modelName": "Unavailable",
            "error": str(exc),
        }

    # Kokoro or Qwen3 local
    package_installed = False
    if engine == "qwen3":
        try:
            from mlx_audio.tts import load_model  # noqa: F401

            package_installed = True
        except ImportError:
            pass
        return {
            "downloaded": package_installed,
            "loaded": _qwen3_tts_model is not None,
            "downloading": _voice_tts_downloading or _qwen3_model_loading,
            "progress": _voice_tts_progress,
            "modelLoading": _qwen3_model_loading,
            "modelName": "Qwen3-TTS-12Hz-0.6B-MLX",
        }

    if engine != "kokoro":
        try:
            language_module = config.get_or_load_language(requested_language)
            has_handler = callable(getattr(language_module, "LANGUAGE_TTS", None))
            return {
                "downloaded": has_handler,
                "loaded": has_handler,
                "downloading": False,
                "progress": 1.0 if has_handler else 0.0,
                "modelName": engine,
                "error": None if has_handler else f"TTS adapter is not installed for language '{requested_language}'",
            }
        except Exception as exc:
            return {
                "downloaded": False,
                "loaded": False,
                "downloading": False,
                "progress": 0.0,
                "modelName": engine,
                "error": str(exc),
            }

    # Kokoro
    lang_code = _kokoro_lang_code(requested_language)
    try:
        from kokoro import KPipeline  # noqa: F401

        package_installed = True
    except ImportError:
        pass
    return {
        "downloaded": package_installed,
        "loaded": bool(lang_code and lang_code in _voice_tts_pipelines),
        "downloading": _voice_tts_downloading,
        "progress": _voice_tts_progress,
        "modelName": "Kokoro-82M",
    }


# ── Download trigger ──


@router.post("/voice/models/download")
async def voice_download_models(language: Optional[str] = None):
    global _voice_stt_downloading, _voice_tts_downloading
    global _voice_stt_progress, _voice_tts_progress

    errors = []

    try:
        _voice_stt_downloading = True
        _voice_stt_progress = 0.0
        log.info("Pre-downloading STT model...")
        _ensure_stt_loaded()
        _voice_stt_progress = 1.0
        _voice_stt_downloading = False
    except Exception as e:
        _voice_stt_downloading = False
        errors.append(f"STT: {e}")

    requested_language = language or config.LANGUAGE
    try:
        tts_engine = _resolve_tts_engine(requested_language)
    except RuntimeError as e:
        tts_engine = "unavailable"
        errors.append(f"TTS: {e}")

    if tts_engine in ("kokoro", "qwen3"):
        try:
            _voice_tts_downloading = True
            _voice_tts_progress = 0.0
            log.info("Pre-downloading TTS model...")
            if tts_engine == "qwen3":
                _ensure_qwen3_tts_loaded()
            else:
                _ensure_tts_loaded(requested_language)
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
        requested_language = _requested_tts_language(req)
        if provider == "cloud":
            raise HTTPException(
                status_code=400,
                detail="Cloud realtime TTS is disabled. Choose a local provider.",
            )
        engine = _resolve_tts_engine(requested_language, provider)
        if engine == "qwen3":
            return await _generate_tts_qwen3(req, requested_language)
        if engine == "kokoro":
            return await _generate_tts_kokoro(req, requested_language)
        return await _generate_tts_language_adapter(req, engine, requested_language)
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"TTS generation error: {e}", exc_info=True)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


async def _generate_tts_language_adapter(req: TTSRequest, engine: str, language: str):
    """Generate TTS audio using a package-installed language adapter."""
    language_module = config.get_or_load_language(language)
    handler = getattr(language_module, "LANGUAGE_TTS", None)
    if not callable(handler):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported TTS engine for language '{language}': {engine}",
        )

    options = {
        "language": language,
        "engine": engine,
        "speed": req.speed,
        "voiceSamplePath": req.voiceSamplePath,
    }

    if inspect.iscoroutinefunction(handler):
        result = await handler(req.text, options)
    else:
        result = await asyncio.to_thread(handler, req.text, options)

    media_type = "audio/wav"
    sample_rate = 24000
    sentence_boundaries = []
    audio = result

    if isinstance(result, dict):
        audio = result.get("audio")
        if "sampleRate" in result:
            sample_rate = int(result["sampleRate"])
        if isinstance(result.get("sentenceBoundaries"), list):
            sentence_boundaries = result["sentenceBoundaries"]
        if isinstance(result.get("mediaType"), str) and result["mediaType"]:
            media_type = result["mediaType"]

    if not isinstance(audio, (bytes, bytearray)):
        raise HTTPException(status_code=500, detail=f"TTS adapter '{engine}' did not return audio bytes")

    _voice_touch()
    return Response(
        content=bytes(audio),
        media_type=media_type,
        headers={
            "X-Sentence-Boundaries": json.dumps(sentence_boundaries),
            "X-Sample-Rate": str(sample_rate),
        },
    )


async def _generate_tts_kokoro(req: TTSRequest, language: str):
    """Generate TTS audio using the local Kokoro pipeline."""

    def _run_sync():
        pipeline = _ensure_tts_loaded(language)
        _voice_touch()

        sentences = _split_into_sentences(req.text, language)
        if not sentences:
            sentences = [req.text]

        lang_code = _kokoro_lang_code(language)
        if not lang_code:
            raise RuntimeError(f"Kokoro TTS is not configured for language '{language}'")
        voice = _kokoro_voice(language, lang_code)

        active_pipeline = pipeline

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

_QWEN3_TTS_MODEL_ID = "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit"
_QWEN3_TTS_SAMPLE_RATE = 24000
_QWEN3_TTS_STREAMING_INTERVAL = 0.32


def _qwen3_lang_code(language: str) -> str:
    lang = _qwen3_language_name(language)
    if not lang:
        raise RuntimeError(f"Qwen3 TTS is not configured for language '{language}'")
    return lang[:1].upper() + lang[1:] if lang.islower() else lang


def _ensure_qwen3_tts_loaded():
    """Load the MLX Qwen3-TTS model lazily and keep it hot in-process."""
    global _qwen3_tts_model, _qwen3_model_loading, _voice_tts_progress
    if _qwen3_tts_model is not None:
        return _qwen3_tts_model
    with _qwen3_tts_lock:
        if _qwen3_tts_model is not None:
            return _qwen3_tts_model
        _qwen3_model_loading = True
        _voice_tts_progress = 0.05
        stop_monitor = threading.Event()
        try:
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
                                log.info(
                                    f"Qwen3-TTS download: {mb_done:.0f}/{mb_total:.0f} MB ({pct:.0%})"
                                )
                        except Exception:
                            pass
                    stop_monitor.wait(2)

            monitor_thread = threading.Thread(target=_monitor, daemon=True)

            if total_bytes > 0 and cache_blobs_dir:
                log.info(f"Downloading Qwen3-TTS model ({total_bytes / (1024**3):.1f} GB)…")
                monitor_thread.start()
            else:
                log.info("Loading MLX Qwen3-TTS model…")

            from mlx_audio.tts import load_model

            _qwen3_tts_model = load_model(_QWEN3_TTS_MODEL_ID)
            stop_monitor.set()
            _set_tts_progress(1.0)
            _qwen3_model_loading = False
            log.info("MLX Qwen3-TTS model loaded successfully")
            _voice_touch()
            return _qwen3_tts_model
        except Exception as e:
            stop_monitor.set()
            _qwen3_model_loading = False
            _voice_tts_progress = 0.0
            log.error(f"Failed to load Qwen3-TTS: {e}", exc_info=True)
            raise


def _set_tts_progress(value: float):
    """Helper to update the TTS progress global."""
    global _voice_tts_progress
    _voice_tts_progress = value


def _qwen3_reference_pair(voice_sample_path: str | None) -> tuple[str | None, str | None]:
    if not voice_sample_path or not os.path.exists(voice_sample_path):
        return None, None

    base, _ext = os.path.splitext(voice_sample_path)
    transcript_path = base + ".txt"
    if not os.path.exists(transcript_path):
        raise RuntimeError("Qwen3 voice cloning requires a transcribed voice sample")
    with open(transcript_path, "r", encoding="utf-8") as f:
        ref_text = f.read().strip()
    if not ref_text:
        raise RuntimeError("Qwen3 voice cloning requires a non-empty voice sample transcript")
    return voice_sample_path, ref_text


def _iter_qwen3_tts_chunks(req: TTSRequest, language: str, stream: bool = True):
    model = _ensure_qwen3_tts_loaded()
    _voice_touch()
    safe_voice_path = _validate_voice_sample_path(req.voiceSamplePath)
    ref_audio, ref_text = _qwen3_reference_pair(safe_voice_path)
    lang_code = _qwen3_lang_code(language)

    gen = model.generate(
        req.text,
        ref_audio=ref_audio,
        ref_text=ref_text,
        stream=stream,
        streaming_interval=_QWEN3_TTS_STREAMING_INTERVAL,
        temperature=0.9,
        top_k=50,
        top_p=1.0,
        repetition_penalty=1.5,
        max_tokens=4096,
        speed=req.speed,
        lang_code=lang_code,
        verbose=False,
    )

    for chunk_index, result in enumerate(gen):
        audio_np = np.asarray(result.audio, dtype=np.float32).flatten()
        yield {
            "audio": audio_np,
            "chunkIndex": chunk_index,
            "sampleRate": int(getattr(result, "sample_rate", _QWEN3_TTS_SAMPLE_RATE) or _QWEN3_TTS_SAMPLE_RATE),
            "tokenCount": int(getattr(result, "token_count", 0) or 0),
            "isFinal": bool(getattr(result, "is_final_chunk", False)),
        }


async def _generate_tts_qwen3(req: TTSRequest, language: str):
    """Generate a full WAV with the same MLX Qwen3 path used by streaming."""

    def _run_sync():
        all_audio = []
        sr = _QWEN3_TTS_SAMPLE_RATE
        for chunk in _iter_qwen3_tts_chunks(req, language, stream=False):
            all_audio.append(chunk["audio"])
            sr = int(chunk["sampleRate"])

        if not all_audio:
            raise HTTPException(status_code=500, detail="No audio generated")

        combined = np.concatenate(all_audio)
        import soundfile as sf

        buf = io.BytesIO()
        sf.write(buf, combined, sr, format="WAV", subtype="PCM_16")
        buf.seek(0)
        sentence_boundaries = [{
            "index": 0,
            "text": req.text,
            "sampleOffset": 0,
            "sampleCount": len(combined),
        }]
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


@router.websocket("/voice/tts/stream")
async def voice_tts_stream_ws(websocket: WebSocket):
    """Stream local Qwen3-TTS float32 PCM chunks to Electron."""
    await websocket.accept()
    cancel = threading.Event()
    try:
        payload = await websocket.receive_json()
        req = TTSRequest(**payload)
        requested_language = _requested_tts_language(req)
        provider = req.provider or _tts_provider
        if provider == "cloud":
            await websocket.send_json({
                "type": "error",
                "message": "Cloud realtime TTS is disabled. Choose a local provider.",
            })
            return
        engine = _resolve_tts_engine(requested_language, provider)
        if engine != "qwen3":
            await websocket.send_json({
                "type": "error",
                "message": f"Streaming TTS requires qwen3; got '{engine}'",
            })
            return

        await websocket.send_json({
            "type": "status",
            "generating": True,
            "modelLoading": _qwen3_tts_model is None,
            "downloadProgress": _voice_tts_progress,
        })

        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[dict | bytes | Exception | None] = asyncio.Queue()
        def _worker():
            try:
                sample_offset = 0
                for chunk in _iter_qwen3_tts_chunks(req, requested_language, stream=True):
                    if cancel.is_set():
                        break
                    audio = chunk["audio"]
                    samples = np.asarray(audio, dtype="<f4").flatten()
                    msg = {
                        "type": "audio",
                        "sampleRate": chunk["sampleRate"],
                        "sentenceIndex": 0,
                        "sentenceText": req.text if chunk["chunkIndex"] == 0 else "",
                        "totalSentences": 1,
                        "sampleOffset": sample_offset,
                        "sampleCount": int(len(samples)),
                        "chunkIndex": chunk["chunkIndex"],
                        "tokenCount": chunk["tokenCount"],
                        "isFinal": chunk["isFinal"],
                        "encoding": "f32le",
                        "byteLength": int(samples.nbytes),
                        "channels": 1,
                    }
                    sample_offset += int(len(samples))
                    loop.call_soon_threadsafe(queue.put_nowait, msg)
                    loop.call_soon_threadsafe(queue.put_nowait, samples.tobytes())
            except Exception as exc:
                loop.call_soon_threadsafe(queue.put_nowait, exc)
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)

        thread = threading.Thread(target=_worker, daemon=True)
        thread.start()

        while True:
            item = await queue.get()
            if item is None:
                break
            if isinstance(item, Exception):
                await websocket.send_json({"type": "error", "message": str(item)})
                return
            if isinstance(item, bytes):
                await websocket.send_bytes(item)
            else:
                await websocket.send_json(item)

        await websocket.send_json({"type": "done"})
    except WebSocketDisconnect:
        log.info("TTS stream WebSocket disconnected")
    except Exception as e:
        log.error(f"TTS stream WebSocket error: {e}", exc_info=True)
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        cancel.set()
        try:
            await websocket.close()
        except Exception:
            pass


# ── Voice sample transcription ──


class TranscribeRequest(BaseModel):
    voiceSamplePath: str
    language: Optional[str] = None


@router.post("/voice/transcribe")
async def voice_transcribe(req: TranscribeRequest):
    """Transcribe an audio file using STT. Used to generate transcripts for voice samples."""
    audio_path = _validate_voice_sample_path(req.voiceSamplePath)
    if not audio_path:
        raise HTTPException(status_code=400, detail="Audio file not found")

    stt_model = _ensure_stt_loaded()
    _voice_touch()
    requested_language = req.language or config.LANGUAGE
    try:
        segments, info = await asyncio.to_thread(
            lambda: stt_model.transcribe(
                audio_path,
                **_stt_transcribe_options(
                    requested_language,
                    beam_size=5,
                    vad_filter=True,
                ),
            )
        )
        text = " ".join(seg.text for seg in segments).strip()
        return {"text": text, "language": info.language}
    except Exception as e:
        log.error(f"Transcription error: {e}", exc_info=True)
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
        await websocket.accept()
        await websocket.close(code=4003, reason="Unauthorized")
        return

    await websocket.accept()

    language = websocket.query_params.get("language") or config.LANGUAGE
    silence_threshold = float(websocket.query_params.get("silence", "1.5"))
    mode = websocket.query_params.get("mode", "vad")

    try:
        _reload_tts_settings()
        loop = asyncio.get_running_loop()
        vad_future = loop.run_in_executor(None, _ensure_vad_loaded)
        stt_future = loop.run_in_executor(None, _ensure_stt_loaded)

        futures = [vad_future, stt_future]
        try:
            tts_engine = _resolve_tts_engine(language)
        except RuntimeError as exc:
            log.warning("Skipping TTS warmup for %s: %s", language, exc)
            tts_engine = "unavailable"
        if tts_engine == "kokoro":
            futures.append(loop.run_in_executor(None, _ensure_tts_loaded, language))
        elif tts_engine == "qwen3":
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
        stt_runtime = _stt_runtime(language) if language else {}
        hallucination_phrases = {
            _normalize_stt_hallucination_text(str(phrase), language)
            for phrase in stt_runtime.get("hallucinationPhrases", [])
            if str(phrase).strip()
        }
        short_audio_max_seconds = float(stt_runtime.get("shortAudioMaxSeconds", 1.0))
        short_audio_min_text_length = int(stt_runtime.get("shortAudioMinTextLength", 5))

        def _is_hallucination(text: str, audio_duration_s: float) -> bool:
            stripped = _normalize_stt_hallucination_text(text, language)
            if audio_duration_s < short_audio_max_seconds and len(stripped) > short_audio_min_text_length:
                return True
            for pattern in hallucination_phrases:
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
                        **_stt_transcribe_options(
                            language,
                            beam_size=5,
                            vad_filter=False,
                            condition_on_previous_text=False,
                            no_speech_threshold=0.6,
                            log_prob_threshold=-1.0,
                        ),
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
                log.error(f"Final STT error: {e}", exc_info=True)
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

                # PTT mode: accumulate all audio, skip VAD
                if mode == "push-to-talk":
                    if not is_speaking:
                        is_speaking = True
                        speech_buffer = bytearray()
                    speech_buffer.extend(chunk_data)
                    continue

                # VAD mode: run voice activity detection
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
                                    **_stt_transcribe_options(
                                        language,
                                        beam_size=1,
                                        vad_filter=False,
                                        condition_on_previous_text=False,
                                        no_speech_threshold=0.6,
                                    ),
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
                            log.warning(f"Partial STT error: {e}")
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
        log.info("Voice WebSocket disconnected")
    except Exception as e:
        log.error(f"Voice WebSocket error: {e}", exc_info=True)
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
