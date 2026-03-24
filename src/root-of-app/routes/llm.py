"""
LLM routes — DEPRECATED.

LLM inference has moved to node-llama-cpp in the Electron main process.
These endpoints are retained for backward compatibility and will eventually
be removed.
"""

import asyncio
import gc
import importlib
import json
import os
import threading
import time
import traceback
from pathlib import Path
from typing import List, Optional, Tuple

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

import config
from logging_utils import _log

router = APIRouter()

# ── Constants ──

LLM_MODEL_ID = "Qwen/Qwen2.5-3B"
MIN_LLM_DOWNLOAD_BYTES = 100 * 1024 * 1024  # 100 MB fallback threshold

# ── Global state ──

_llm_lock = threading.Lock()
_llm_tokenizer = None
_llm_model = None
_llm_device = "cpu"
_llm_dtype = None
_LLM_EXPECTED_BYTES: int | None = None
_LLM_EXPECTED_LOCK = threading.Lock()

# Idle-unload
_LLM_IDLE_TIMEOUT_SECONDS = 600
_llm_last_used: float = 0.0
_llm_idle_timer: threading.Timer | None = None
_llm_idle_lock = threading.Lock()

try:
    from huggingface_hub import HfApi  # type: ignore
except ImportError:
    HfApi = None  # type: ignore

AutoTokenizer = None
AutoModelForCausalLM = None


# ── Idle management ──


def _llm_touch():
    global _llm_last_used, _llm_idle_timer
    _llm_last_used = time.monotonic()
    with _llm_idle_lock:
        if _llm_idle_timer is not None:
            _llm_idle_timer.cancel()
        _llm_idle_timer = threading.Timer(_LLM_IDLE_TIMEOUT_SECONDS, _llm_check_idle)
        _llm_idle_timer.daemon = True
        _llm_idle_timer.start()


def _llm_check_idle():
    elapsed = time.monotonic() - _llm_last_used
    if elapsed >= _LLM_IDLE_TIMEOUT_SECONDS:
        _llm_unload()
    else:
        remaining = _LLM_IDLE_TIMEOUT_SECONDS - elapsed
        with _llm_idle_lock:
            global _llm_idle_timer
            _llm_idle_timer = threading.Timer(remaining, _llm_check_idle)
            _llm_idle_timer.daemon = True
            _llm_idle_timer.start()


def _llm_unload():
    global _llm_model, _llm_tokenizer, _llm_device, _llm_dtype
    with _llm_lock:
        if _llm_model is None and _llm_tokenizer is None:
            return
        _log("LLM idle timeout reached — unloading model to free memory")
        try:
            del _llm_model
            del _llm_tokenizer
        except Exception:
            pass
        _llm_model = None
        _llm_tokenizer = None
        _llm_device = "cpu"
        _llm_dtype = None
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
        _log("LLM unloaded successfully")


# ── Cache helpers ──


def _llm_cache_root() -> Path:
    env_cache = os.environ.get("TRANSFORMERS_CACHE")
    if env_cache:
        return Path(env_cache).expanduser()
    env_home = os.environ.get("HF_HOME")
    if env_home:
        return Path(env_home).expanduser() / "hub"
    return Path.home() / ".cache" / "huggingface" / "hub"


def _llm_snapshot_ready(snap_dir: Path) -> bool:
    if not snap_dir.exists() or not snap_dir.is_dir():
        return False
    config_file = snap_dir / "config.json"
    tokenizer_file = snap_dir / "tokenizer.json"
    if not config_file.exists() or not tokenizer_file.exists():
        return False
    min_size = 100 * 1024 * 1024
    for weight_ext in (".safetensors", ".bin", ".pt"):
        for candidate in snap_dir.glob(f"**/*{weight_ext}"):
            try:
                if candidate.is_file() and candidate.stat().st_size >= min_size:
                    return True
            except OSError:
                continue
    return False


def _llm_cache_exists() -> bool:
    try:
        base = _llm_cache_root()
        if not base.exists():
            return False
        model_dir = base / f"models--{LLM_MODEL_ID.replace('/', '--')}"
        if not model_dir.exists():
            return False
        snapshots_dir = model_dir / "snapshots"
        if not snapshots_dir.exists():
            return False
        for entry in snapshots_dir.iterdir():
            if _llm_snapshot_ready(entry):
                return True
    except Exception as exc:
        _log("LLM cache detection error", exc)
    return False


def _set_expected_llm_size() -> None:
    global _LLM_EXPECTED_BYTES
    with _LLM_EXPECTED_LOCK:
        if _LLM_EXPECTED_BYTES is not None:
            return
        expected_bytes = None
        token = os.environ.get("HUGGINGFACEHUB_API_TOKEN")
        if HfApi is not None:
            try:
                api = HfApi(token=token) if token else HfApi()
                info = api.model_info(LLM_MODEL_ID)
                expected_bytes = info.safetensors_size or info.size
            except Exception as exc:
                _log("LLM expected size lookup failed", exc)
        if expected_bytes is None:
            expected_bytes = MIN_LLM_DOWNLOAD_BYTES
        _LLM_EXPECTED_BYTES = int(expected_bytes)


def _current_snapshot_dir() -> Optional[Path]:
    try:
        base = _llm_cache_root()
        model_dir = base / f"models--{LLM_MODEL_ID.replace('/', '--')}"
        snapshots_dir = model_dir / "snapshots"
        if not snapshots_dir.exists():
            return None
        candidates: List[Path] = []
        for entry in snapshots_dir.iterdir():
            if entry.is_dir():
                candidates.append(entry)
        if not candidates:
            return None
        candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        return candidates[0]
    except Exception:
        return None


def _llm_download_bytes() -> Tuple[int, bool]:
    snap_dir = _current_snapshot_dir()
    if snap_dir is None:
        return 0, False
    total = 0
    ready = _llm_snapshot_ready(snap_dir)
    try:
        for path in snap_dir.rglob("*"):
            if path.is_file():
                try:
                    total += path.stat().st_size
                except OSError:
                    continue
    except Exception as exc:
        _log("LLM download byte scan failed", exc)
    return total, ready


# ── Model loading ──


def _ensure_llm_loaded():
    global _llm_tokenizer, _llm_model, _llm_device, _llm_dtype
    global AutoTokenizer, AutoModelForCausalLM

    if _llm_tokenizer is not None and _llm_model is not None:
        return
    with _llm_lock:
        if _llm_tokenizer is not None and _llm_model is not None:
            return

        torch = config.torch
        try:
            if torch is None:
                torch = importlib.import_module("torch")
                config.torch = torch
            if AutoTokenizer is None or AutoModelForCausalLM is None:
                transformers_mod = importlib.import_module("transformers")
                AutoTokenizer = getattr(transformers_mod, "AutoTokenizer")
                AutoModelForCausalLM = getattr(transformers_mod, "AutoModelForCausalLM")
        except Exception as exc:
            raise RuntimeError("torch/transformers dependencies are missing") from exc

        try:
            _set_expected_llm_size()
            if torch.cuda.is_available():
                device = "cuda"
                dtype = torch.bfloat16
            elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                device = "mps"
                dtype = torch.float16
            else:
                device = "cpu"
                dtype = torch.float32
            _log("Initializing LLM", {"device": device, "dtype": str(dtype)})

            tokenizer = AutoTokenizer.from_pretrained(LLM_MODEL_ID)
            load_kwargs = {
                "torch_dtype": dtype,
                "low_cpu_mem_usage": True,
            }
            if device == "cuda":
                load_kwargs["device_map"] = "auto"

            try:
                model = AutoModelForCausalLM.from_pretrained(
                    LLM_MODEL_ID, **load_kwargs
                )
            except Exception as first_exc:
                if (
                    device == "cpu"
                    and load_kwargs.get("torch_dtype") is not torch.float32
                ):
                    load_kwargs["torch_dtype"] = torch.float32
                    _log(
                        "LLM load retry",
                        {"reason": "float32 fallback", "error": str(first_exc)},
                    )
                    model = AutoModelForCausalLM.from_pretrained(
                        LLM_MODEL_ID, **load_kwargs
                    )
                    dtype = torch.float32
                else:
                    raise

            if device != "cuda":
                model.to(device)
            if tokenizer.pad_token_id is None and tokenizer.eos_token_id is not None:
                tokenizer.pad_token = tokenizer.eos_token
            if model.config.pad_token_id is None and tokenizer.pad_token_id is not None:
                model.config.pad_token_id = tokenizer.pad_token_id

            model.eval()
            _llm_tokenizer = tokenizer
            _llm_model = model
            _llm_device = device
            _llm_dtype = dtype
            _llm_touch()
            _log("LLM ready")
        except Exception as exc:
            _llm_tokenizer = None
            _llm_model = None
            _llm_device = "cpu"
            _llm_dtype = None
            raise RuntimeError(f"Failed to initialize LLM: {exc}") from exc


# ── Pydantic models ──


class LlmRequest(BaseModel):
    prompt: str = Field(..., max_length=50000)
    max_new_tokens: int = 128
    temperature: float = 0.0


class LlmResponse(BaseModel):
    output: str
    device: str


# ── Endpoints ──


@router.get("/llm/status")
async def llm_status():
    """DEPRECATED: LLM inference has moved to node-llama-cpp."""
    if not config.LLM_ALLOWED:
        return {
            "allowed": False,
            "downloaded": False,
            "cached": False,
            "device": None,
            "downloadedBytes": 0,
            "expectedBytes": 0,
            "progress": 0.0,
            "downloading": False,
        }
    downloaded = _llm_model is not None
    cached = _llm_cache_exists()
    device = _llm_device if downloaded else None
    _set_expected_llm_size()
    expected_bytes = _LLM_EXPECTED_BYTES or MIN_LLM_DOWNLOAD_BYTES
    downloaded_bytes, snapshot_ready = _llm_download_bytes()
    progress_ratio = 0.0
    if expected_bytes > 0:
        progress_ratio = min(float(downloaded_bytes) / float(expected_bytes), 1.0)
    in_progress = bool(downloaded_bytes and not snapshot_ready)
    return {
        "allowed": True,
        "downloaded": bool(downloaded),
        "cached": bool(cached),
        "device": device,
        "downloadedBytes": int(downloaded_bytes),
        "expectedBytes": int(expected_bytes),
        "progress": progress_ratio,
        "downloading": in_progress,
    }


@router.post("/llm", response_model=LlmResponse)
async def llm_endpoint(req: LlmRequest):
    """DEPRECATED: LLM inference has moved to node-llama-cpp."""
    _log(
        "LLM request",
        {
            "chars": len(req.prompt),
            "max_new_tokens": req.max_new_tokens,
        },
    )
    if not config.LLM_ALLOWED:
        raise HTTPException(status_code=403, detail="LLM disabled by user")
    try:
        _ensure_llm_loaded()
    except RuntimeError as exc:
        _log("LLM init error", exc)
        raise HTTPException(status_code=500, detail=str(exc))

    torch = config.torch
    if torch is None or _llm_tokenizer is None or _llm_model is None:
        raise HTTPException(status_code=500, detail="LLM unavailable")

    _llm_touch()
    try:

        def _run_inference():
            inputs = _llm_tokenizer(req.prompt, return_tensors="pt")
            tensor_inputs = {k: v.to(_llm_device) for k, v in inputs.items()}
            max_new_tokens = max(1, min(req.max_new_tokens, 512))
            gen_opts = {
                "max_new_tokens": max_new_tokens,
                "do_sample": False,
                "pad_token_id": _llm_tokenizer.pad_token_id,
                "eos_token_id": _llm_tokenizer.eos_token_id,
            }
            if req.temperature > 0:
                gen_opts["temperature"] = float(req.temperature)
                gen_opts["do_sample"] = True
            with torch.no_grad():
                output_ids = _llm_model.generate(**tensor_inputs, **gen_opts)
            return _llm_tokenizer.decode(
                output_ids[0], skip_special_tokens=True
            ).strip()

        text = await asyncio.to_thread(_run_inference)
        return {"output": text, "device": _llm_device}
    except Exception as exc:
        _log("LLM generation error", exc)
        raise HTTPException(status_code=500, detail="Generation failed")


@router.post("/llm/stream")
async def llm_stream_endpoint(req: LlmRequest):
    """DEPRECATED: Streaming LLM endpoint."""
    _log(
        "LLM stream request",
        {
            "chars": len(req.prompt),
            "max_new_tokens": req.max_new_tokens,
        },
    )
    if not config.LLM_ALLOWED:
        raise HTTPException(status_code=403, detail="LLM disabled by user")
    try:
        _ensure_llm_loaded()
    except RuntimeError as exc:
        _log("LLM init error", exc)
        raise HTTPException(status_code=500, detail=str(exc))

    torch = config.torch
    if torch is None or _llm_tokenizer is None or _llm_model is None:
        raise HTTPException(status_code=500, detail="LLM unavailable")

    _llm_touch()

    async def generate_stream():
        try:
            from transformers import TextIteratorStreamer

            inputs = _llm_tokenizer(req.prompt, return_tensors="pt")
            tensor_inputs = {k: v.to(_llm_device) for k, v in inputs.items()}
            max_new_tokens = max(1, min(req.max_new_tokens, 512))

            streamer = TextIteratorStreamer(
                _llm_tokenizer,
                skip_prompt=True,
                skip_special_tokens=True,
            )

            gen_opts = {
                "max_new_tokens": max_new_tokens,
                "do_sample": False,
                "pad_token_id": _llm_tokenizer.pad_token_id,
                "eos_token_id": _llm_tokenizer.eos_token_id,
                "streamer": streamer,
            }
            if req.temperature > 0:
                gen_opts["temperature"] = float(req.temperature)
                gen_opts["do_sample"] = True

            generation_thread = threading.Thread(
                target=lambda: _llm_model.generate(**tensor_inputs, **gen_opts)
            )
            generation_thread.start()

            full_text = ""
            for text_chunk in streamer:
                if text_chunk:
                    full_text += text_chunk
                    yield (
                        f"data: {json.dumps({'chunk': text_chunk, 'done': False})}\n\n"
                    )

            yield (
                f"data: {json.dumps({'chunk': '', 'done': True, 'full_text': full_text.strip(), 'device': _llm_device})}\n\n"
            )
            generation_thread.join()
        except Exception as exc:
            _log("LLM stream error", exc)
            yield f"data: {json.dumps({'error': str(exc), 'done': True})}\n\n"

    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
