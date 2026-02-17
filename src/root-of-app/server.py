# MODIFY THIS
LANGUAGE = ""
FETCH_ANKI = True
ANKI_CONNECT_URL = "http://127.0.0.1:8765"
LLM_ALLOWED = True
OCR_ALLOWED = True

import uvicorn
from typing import List, Tuple, Optional
import json
import urllib.request
from urllib.parse import quote
import urllib.error
import pickle
import os
import sys
import importlib
import re
import threading
import time
import traceback
import platform
import faulthandler
import signal
import atexit
from pathlib import Path
import struct
import asyncio

# Raise the per-process file-descriptor limit as early as possible.
# MangaOCR + transformers + torch + ONNX together open thousands of files;
# macOS defaults (256–2560) are too low and cause ENFILE / EMFILE crashes.
try:
    import resource as _resource
    _soft, _hard = _resource.getrlimit(_resource.RLIMIT_NOFILE)
    _desired = min(_hard, 65536) if _hard > 0 else 65536
    if _soft < _desired:
        _resource.setrlimit(_resource.RLIMIT_NOFILE, (_desired, _hard))
        print(f"Raised RLIMIT_NOFILE from {_soft} to {_desired} (hard={_hard})")
    else:
        print(f"RLIMIT_NOFILE already sufficient: soft={_soft} hard={_hard}")
except Exception as _rlimit_err:
    print(f"Could not adjust RLIMIT_NOFILE: {_rlimit_err}")

# Ensure printing non-ASCII (e.g., Japanese) won't crash on Windows consoles
try:
    # Python 3.7+ TextIOWrapper exposes reconfigure
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    # As a fallback, attempt to replace the streams entirely (rarely needed in our packaging)
    try:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')  # type: ignore[attr-defined]
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')  # type: ignore[attr-defined]
    except Exception:
        # Last resort: do nothing; individual prints may still succeed for ASCII
        pass


# print arguments
arguments = sys.argv[1:]
print("Arguments: ", arguments)
ANKI_CONNECT_URL = arguments[0]
FETCH_ANKI = arguments[1] == "true"
LANGUAGE = arguments[2]
RESPATH = arguments[3]
if len(arguments) >= 5:
    LLM_ALLOWED = str(arguments[4]).lower() == "true"
if len(arguments) >= 6:
    OCR_ALLOWED = str(arguments[5]).lower() == "true"

USER_DATA_PATH = ""
if len(arguments) >= 7:
    USER_DATA_PATH = arguments[6]

ANKI_FIELD_EXPRESSION = "Expression"
ANKI_FIELD_READING = "Reading"
ANKI_FIELD_MEANING = "Meaning"
OCR_RAM_SAVER = False

if USER_DATA_PATH:
    settings_path = os.path.join(USER_DATA_PATH, "settings.json")
    if os.path.exists(settings_path):
        try:
            with open(settings_path, 'r', encoding='utf-8') as f:
                settings = json.load(f)
                ANKI_FIELD_EXPRESSION = settings.get("anki_field_expression", "Expression")
                ANKI_FIELD_READING = settings.get("anki_field_reading", "Reading")
                ANKI_FIELD_MEANING = settings.get("anki_field_meaning", "Meaning")
                OCR_RAM_SAVER = settings.get("ocrRamSaver", False)
                print(f"Loaded Anki field mappings: Expression='{ANKI_FIELD_EXPRESSION}', Reading='{ANKI_FIELD_READING}', Meaning='{ANKI_FIELD_MEANING}'")
                print(f"OCR Ram Saver: {OCR_RAM_SAVER}")
        except Exception as e:
            print(f"Error reading settings.json: {e}")

print("Arguments: ", ANKI_CONNECT_URL, FETCH_ANKI, LANGUAGE)
print("LLM allowed:", LLM_ALLOWED)
print("OCR allowed:", OCR_ALLOWED)
LANGUAGE_DIR_PATH = os.path.join(RESPATH,"languages")

# Read language-specific config from the JSON file next to the .py module.
# This is used to determine features like vertical text support at runtime
# without hardcoding per-language behaviour.
SUPPORTS_VERTICAL_TEXT = False
_lang_json_path = os.path.join(LANGUAGE_DIR_PATH, f"{LANGUAGE}.json")
if os.path.isfile(_lang_json_path):
    try:
        with open(_lang_json_path, 'r', encoding='utf-8') as _lf:
            _lang_cfg = json.load(_lf)
            SUPPORTS_VERTICAL_TEXT = bool(_lang_cfg.get("supportsVerticalText", False))
    except Exception as _e:
        print(f"Warning: failed to read {_lang_json_path}: {_e}")
print("Supports vertical text:", SUPPORTS_VERTICAL_TEXT)

print("Language dir path: ", LANGUAGE_DIR_PATH)


sys.path.append(LANGUAGE_DIR_PATH)
language_module = None

language_module = importlib.import_module(LANGUAGE)

language_module.LOAD_MODULE(RESPATH)
print(language_module)
# rest api
from fastapi import FastAPI, Request
from fastapi import UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from typing import List
from fastapi.middleware.cors import CORSMiddleware
import base64
import io
from PIL import Image
import numpy as np
import statistics
import math
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.websockets import WebSocket, WebSocketDisconnect
import asyncio

torch = None  # populated lazily to avoid heavy import costs
AutoTokenizer = None  # populated lazily
AutoModelForCausalLM = None  # populated lazily

try:
    from huggingface_hub import HfApi  # type: ignore
except ImportError:
    HfApi = None  # type: ignore

app = FastAPI()



def _now():
    try:
        return time.strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return "time?"


LOG_PATTERN_PREFIX = "::STATUS::"  # sentinel prefix so Electron side can parse quickly

def _format_status(channel: str, *parts) -> str:
    """Return a strict machine‑parsable status line.
    Pattern: ::STATUS::<CHANNEL>::<TIMESTAMP>::<MESSAGE>
    CHANNEL examples: GENERAL, OCR, OCR-INIT, OCR-RUN, OCR-DL
    """
    ts = _now()
    try:
        msg = " ".join(str(p) for p in parts)
    except Exception:
        try:
            msg = " ".join(repr(p) for p in parts)
        except Exception:
            msg = "?"
    msg = msg.replace('\n', ' ')  # single line
    return f"{LOG_PATTERN_PREFIX}{channel}::{ts}::{msg}"

def _emit(line: str):
    try:
        print(line, flush=True)
    except Exception:
        try:
            sys.stdout.write(line + '\n')
            sys.stdout.flush()
        except Exception:
            pass

def _log(*args):
    """General log (structured)."""
    _emit(_format_status("GENERAL", *args))

def _log_ocr(*args):
    _emit(_format_status("OCR", *args))

def _log_ocr_init(*args):
    _emit(_format_status("OCR-INIT", *args))

def _log_ocr_run(*args):
    _emit(_format_status("OCR-RUN", *args))

def _log_ocr_dl(*args):
    _emit(_format_status("OCR-DL", *args))


def _process_stats(tag: str = "stats"):
    try:
        pid = os.getpid()
        th = threading.active_count()
        info = f"[{tag}] pid={pid} threads={th} platform={platform.platform()} python={platform.python_version()}"
        try:
            import resource  # available on Unix, including macOS
            usage = resource.getrusage(resource.RUSAGE_SELF)
            info += f" rss(max)={usage.ru_maxrss}KB"
        except Exception:
            pass
        _log(info)
    except Exception:
        pass


def request(action, **params):
    return {'action': action, 'params': params, 'version': 6}


def invoke(action, **params):
    try:
        requestJson = json.dumps(request(action, **params)).encode('utf-8')
        response = json.load(urllib.request.urlopen(urllib.request.Request(ANKI_CONNECT_URL, requestJson)))
        if len(response) != 2:
            raise Exception('response has an unexpected number of fields')
        if 'error' not in response:
            raise Exception('response is missing required error field')
        if 'result' not in response:
            raise Exception('response is missing required result field')
        if response['error'] is not None:
            raise Exception(response['error'])
        return response['result']
    except urllib.error.URLError as e:
        _log(f"Failed to connect to Anki: {e}")
        return None
    except Exception as e:
        _log(f"An error occurred: {e}")
        return None


@app.get("/llm/status")
async def llm_status():
    """DEPRECATED: LLM inference has moved to node-llama-cpp in the Electron main process.
    This endpoint is retained for backward compatibility but will be removed."""
    if not LLM_ALLOWED:
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


all_cards = []

cards_per_id = {}

words_ids = {}

who_contain = {}

LLM_MODEL_ID = "Qwen/Qwen2.5-3B"
MIN_LLM_DOWNLOAD_BYTES = 100 * 1024 * 1024  # 100MB fallback threshold

_llm_lock = threading.Lock()
_llm_tokenizer = None
_llm_model = None
_llm_device = "cpu"
_llm_dtype = None
_LLM_EXPECTED_BYTES: int | None = None
_LLM_EXPECTED_LOCK = threading.Lock()

# LLM idle-unload: free VRAM/RAM after inactivity
_LLM_IDLE_TIMEOUT_SECONDS = 600  # 10 minutes
_llm_last_used: float = 0.0  # monotonic timestamp of last LLM request
_llm_idle_timer: threading.Timer | None = None
_llm_idle_lock = threading.Lock()


def _llm_touch():
    """Mark that the LLM was just used; reset the idle-unload timer."""
    global _llm_last_used, _llm_idle_timer
    _llm_last_used = time.monotonic()
    with _llm_idle_lock:
        if _llm_idle_timer is not None:
            _llm_idle_timer.cancel()
        _llm_idle_timer = threading.Timer(_LLM_IDLE_TIMEOUT_SECONDS, _llm_check_idle)
        _llm_idle_timer.daemon = True
        _llm_idle_timer.start()


def _llm_check_idle():
    """Called by the idle timer; unload if the model hasn't been used recently."""
    elapsed = time.monotonic() - _llm_last_used
    if elapsed >= _LLM_IDLE_TIMEOUT_SECONDS:
        _llm_unload()
    else:
        # Re-schedule for the remaining time
        remaining = _LLM_IDLE_TIMEOUT_SECONDS - elapsed
        with _llm_idle_lock:
            global _llm_idle_timer
            _llm_idle_timer = threading.Timer(remaining, _llm_check_idle)
            _llm_idle_timer.daemon = True
            _llm_idle_timer.start()


def _llm_unload():
    """Unload the LLM model and tokenizer to free memory."""
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
        # Force garbage collection and clear GPU cache if available
        import gc
        gc.collect()
        if torch is not None:
            try:
                if hasattr(torch, 'cuda') and torch.cuda.is_available():
                    torch.cuda.empty_cache()
                if hasattr(torch, 'mps') and hasattr(torch.mps, 'empty_cache'):
                    torch.mps.empty_cache()
            except Exception:
                pass
        _log("LLM unloaded successfully")


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
    min_size = 100 * 1024 * 1024  # require at least ~100MB to treat as fully downloaded
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
                # Prefer safetensors size when available, fallback to repo size.
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
        # Prefer most recent snapshot (sorted by mtime).
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


def _ensure_llm_loaded():

    global _llm_tokenizer
    global _llm_model
    global _llm_device
    global _llm_dtype
    global torch
    global AutoTokenizer
    global AutoModelForCausalLM
    if _llm_tokenizer is not None and _llm_model is not None:
        return
    with _llm_lock:
        if _llm_tokenizer is not None and _llm_model is not None:
            return
        try:
            if torch is None:
                torch = importlib.import_module("torch")  # type: ignore[assignment]
            if AutoTokenizer is None or AutoModelForCausalLM is None:
                transformers_mod = importlib.import_module("transformers")
                AutoTokenizer = getattr(transformers_mod, "AutoTokenizer")  # type: ignore[attr-defined]
                AutoModelForCausalLM = getattr(transformers_mod, "AutoModelForCausalLM")  # type: ignore[attr-defined]
        except Exception as exc:
            raise RuntimeError("torch/transformers dependencies are missing") from exc

        try:
            _set_expected_llm_size()
            if torch.cuda.is_available():  # type: ignore[attr-defined]
                device = "cuda"
                dtype = torch.bfloat16  # type: ignore[attr-defined]
            elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                device = "mps"
                dtype = torch.float16  # type: ignore[attr-defined]
            else:
                device = "cpu"
                # Default to float32 on CPU for broader compatibility (Windows lacks bfloat16 CPU kernels).
                dtype = torch.float32  # type: ignore[attr-defined]
            _log("Initializing LLM", {"device": device, "dtype": str(dtype)})

            tokenizer = AutoTokenizer.from_pretrained(LLM_MODEL_ID, trust_remote_code=True)  # type: ignore[operator]
            load_kwargs = {
                "torch_dtype": dtype,
                "trust_remote_code": True,
                "low_cpu_mem_usage": True,
            }
            if device == "cuda":
                load_kwargs["device_map"] = "auto"

            try:
                model = AutoModelForCausalLM.from_pretrained(LLM_MODEL_ID, **load_kwargs)  # type: ignore[operator]
            except Exception as first_exc:
                if device == "cpu" and load_kwargs.get("torch_dtype") is not torch.float32:  # type: ignore[attr-defined]
                    load_kwargs["torch_dtype"] = torch.float32  # type: ignore[attr-defined]
                    _log("LLM load retry", {"reason": "float32 fallback", "error": str(first_exc)})
                    model = AutoModelForCausalLM.from_pretrained(LLM_MODEL_ID, **load_kwargs)  # type: ignore[operator]
                    dtype = torch.float32  # type: ignore[attr-defined]
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

def get_all_cards_CACHE():
    global all_cards
    global cards_per_id
    global words_ids
    global who_contain
    if not os.path.exists('anki-cache.pkl'):
        _log("Cache file not found")
        return False
    try:
        with open(os.path.join(RESPATH,'anki-cache.pkl'), 'rb') as f:
            data = pickle.load(f)
            all_cards = data['all_cards']
            cards_per_id = data['cards_per_id']
            words_ids = data['words_ids']
            who_contain = data['who_contain']
        return True
    except Exception as e:
        print(f"Failed to load cache: {e}")
        return False


def get_all_cards():
    global FETCH_ANKI
    _log("Fetch Anki is set to", FETCH_ANKI)
    if not FETCH_ANKI:
        return True
    global all_cards
    global cards_per_id
    global words_ids
    global who_contain

    _log("Loading all card ids")

    card_ids = invoke('findCards', query='deck:*')
    if card_ids is None:
        _log("Failed to load card ids")
        return False
    _log("Loaded all card ids")
    _log("Loading all cards")
    all_cards = invoke('cardsInfo', cards=card_ids)
    if all_cards is None:
        _log("Failed to load cards")
        return False
    _log("Recieved all cards")
    # print(all_cards[0]['fields']['Expression']['value'])
    # filter out cards that may crash the server
    all_cards_temp = []
    for card in all_cards:
        # Map user configured fields to standard fields
        if ANKI_FIELD_EXPRESSION in card['fields'] and ANKI_FIELD_EXPRESSION != 'Expression':
            card['fields']['Expression'] = card['fields'][ANKI_FIELD_EXPRESSION]
        if ANKI_FIELD_READING in card['fields'] and ANKI_FIELD_READING != 'Reading':
            card['fields']['Reading'] = card['fields'][ANKI_FIELD_READING]
        if ANKI_FIELD_MEANING in card['fields'] and ANKI_FIELD_MEANING != 'Meaning':
            card['fields']['Meaning'] = card['fields'][ANKI_FIELD_MEANING]

        if 'Expression' in card['fields']:
            all_cards_temp.append(card)
        # or 'Front' in card['fields'] and 'Front' contains "<intelligent_definition >"
        elif 'Front' in card['fields']:
            if "</intelligent_definition>" in card['fields']['Front']['value']:
                front = re.sub(r'<intelligent_definition\b[^>]*>.*?</intelligent_definition>', '', card['fields']['Front']['value'], flags=re.DOTALL)
                card['fields']['Expression'] = {}
                card['fields']['Meaning'] = {}
                card['fields']['Reading'] = {}
                card['fields']['Reading']['value'] = ""
                card['fields']['Expression']['value'] = front
                match1 = re.search(r'<intelligent_definition\b[^>]*>(.*?)</intelligent_definition>', card['fields']['Front']['value'], flags=re.DOTALL)
                if match1:
                    card['fields']['Meaning']['value'] = match1.group(1).strip()
                    all_cards_temp.append(card)
                else:
                    if 'Back' in card['fields']:
                        card['fields']['Meaning']['value'] = card['fields']['Back']['value']
                        all_cards_temp.append(card)

    all_cards = all_cards_temp
    all_cards = [card for card in all_cards if 'Expression' in card['fields']]

    if len(all_cards) == 0:
        _log("No valid cards found, maybe you have selected the wrong deck?")
        sys.exit(-1)
        return

    for card in all_cards:
        words = card['fields']['Expression']['value']
        # trim everything that's ascii
        words = ''.join([i for i in words if ord(i) > 128])
        words_ids[words] = card['cardId']

        cards_per_id[card['cardId']] = card
    _log("Loaded all cards")
    _log("Loading who_contain")


    # generate who_contain

    no_duplicates = {}

    for card in all_cards:
        characters = card['fields']['Expression']['value']
        characters = ''.join([i for i in characters if ord(i) > 128])
        for character in list(characters):
            if character in who_contain:
                if characters in no_duplicates[character]:
                    continue
                no_duplicates[character].add(characters)
                who_contain[character].append((characters, card['cardId']))
            else:
                no_duplicates[character] = set([characters])
                who_contain[character] = [(characters, card['cardId'])]

    _log("Loaded who_contain")
    # Save the objects to a file
    with open(os.path.join(RESPATH,'anki-cache.pkl'), 'wb') as f:
        pickle.dump({
            'all_cards': all_cards,
            'cards_per_id': cards_per_id,
            'words_ids': words_ids,
            'who_contain': who_contain
        }, f)
    return True

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

@app.on_event("startup")
async def startup_event():
    _log("Getting all cards")
    _process_stats("startup")
    _log("Runtime info:", {
        "LANGUAGE": LANGUAGE,
        "RESPATH": RESPATH,
        "ANKI_CONNECT_URL": ANKI_CONNECT_URL,
        "FETCH_ANKI": FETCH_ANKI,
        "python": platform.python_version(),
        "platform": platform.platform(),
    })
    resp = get_all_cards()
    if not resp:
        _log("Anki is offline, loading from Cache")
        if get_all_cards_CACHE():
            _log("Loaded from cache")
        else:
            _log("Failed to load from cache")
            sys.exit(-1)
    # Enable faulthandler to diagnose crashes
    try:
        crash_log_path = os.path.join(RESPATH, 'python_crash.log') if 'RESPATH' in globals() else 'python_crash.log'
        global _crash_log
        _crash_log = open(crash_log_path, 'a')
        faulthandler.enable(_crash_log)
        for _sig in (getattr(signal, n, None) for n in ["SIGSEGV", "SIGABRT", "SIGBUS", "SIGFPE", "SIGILL"]):
            try:
                if _sig is not None:
                    faulthandler.register(_sig, file=_crash_log, all_threads=True, chain=True)
            except Exception:
                pass
        _log(f"Faulthandler enabled; crash logs -> {crash_log_path}")
    except Exception as e:
        _log("Failed to enable faulthandler:", e)

    # Pre-import heavy libraries that open many temporary FDs during
    # their module scan (transformers imports 100+ model submodules).
    # Doing it at startup — before ONNX/RapidOCR models claim permanent
    # FDs — avoids hitting the macOS kern.maxfiles limit later.
    # This is SYNCHRONOUS (blocking) so uvicorn won't accept connections
    # until the import scan is done and its temporary FDs are released.
    if OCR_ALLOWED:
        try:
            _log("Pre-importing transformers for MangaOCR...")
            # MangaOCR uses these specific classes, whose import triggers
            # transformers' auto-model config scan (opens 100s of .py files).
            # A plain `import transformers` is lazy and skips this scan.
            from transformers import (  # noqa: F401
                ViTImageProcessor,
                AutoTokenizer,
                VisionEncoderDecoderModel,
                GenerationMixin,
            )
            import gc
            gc.collect()
            _log("Transformers pre-import done")
        except Exception as _e:
            _log("Transformers pre-import failed (non-fatal):", _e)
        finally:
            _transformers_preimport_done.set()
    else:
        _transformers_preimport_done.set()

# Request Body
class TokenizeRequest(BaseModel):
    text: str


class TokenizeResponse(BaseModel):
#     tokens: List[Tuple[str, str]]
    tokens: List

class GetCardRequest(BaseModel):
    word: str

class GetCardResponse(BaseModel):
    cards: List
    error: bool
    poor: bool

@app.post("/tokenize", response_model=TokenizeResponse)
def tokenize(req: TokenizeRequest):
    global language_module
#     if language_module is None:
#         print("Language module not loaded")
#         return {"tokens": [], "error": "Language module not loaded"}
#     if not hasattr(language_module, 'LANGUAGE_TOKENIZE'):
#         print("LANGUAGE_TOKENIZE function not found in the language module")
#         return {"tokens": [], "error": "LANGUAGE_TOKENIZE function not found in the language module"}
    _log("requested tokenization: ", req.text)
    # text = nagisa.tagging(req.text)
#     print(language_module, language_module.LANGUAGE_TOKENIZE
    tokens = language_module.LANGUAGE_TOKENIZE(req.text)
    # tokens = list(zip(text.words, text.postags))
    return {"tokens": tokens}

getCardCache = {}

@app.post("/getCard", response_model=GetCardResponse)
def get_card(req: GetCardRequest):
    global who_contain
    global all_cards
    global cards_per_id
    global words_ids
    # print("requested card: ", req.word)
    if req.word in getCardCache:
        return getCardCache[req.word]
    # get all cards that contain the word
    word = req.word
    matched = []
    max_score = 0
    for character in word:
        if character in who_contain:
            cards = who_contain[character]
            # print("Testing: ", cards)
            # compute closest match
            for card in cards:
                #see how many characters match
                score = 0
                for c in word:
                    if c in card[0]:
                        score += 0.5
                # try to see if the word is a substring of the card
                if word in card[0]:
                    score = len(word)
                # remove score for each character that is not in the word
                for c in card[0]:
                    if c not in word:
                        score -= 1
                if score > max_score:
                    max_score = score
                matched.append((score, card[1]))
    #filter out cards that have the same id
    matched = list(set(matched))
    matched.sort(reverse=True)
    # print(matched)
    matched = matched[:5]
    # #get ease of the cards
    # eases = invoke('getEaseFactors', cards=[match[1] for match in matched])
    # for i, match in enumerate(matched):
    #     matched[i] = (match[0], match[1], eases[i])
    result = []
    for match in matched:
        current_card = cards_per_id[match[1]]
        # current_card['ease'] = match[2]
        result.append(current_card)
    if len(result) == 0:
        getCardCache[req.word] = {"cards": ["No cards found"], "error": True}
        return {"cards": ["No cards found"], "error": True}

    getCardCache[req.word] = {"cards": result, "error": False, "poor": max_score < len(req.word)}
    return {"cards": result, "error": False, "poor": max_score < len(req.word)}





class TranslationRequest(BaseModel):
    word: str

class TranslationResponse(BaseModel):
    data: List


class LlmRequest(BaseModel):
    prompt: str
    max_new_tokens: int = 128
    temperature: float = 0.0


class LlmResponse(BaseModel):
    output: str
    device: str


@app.post("/translate", response_model=TranslationResponse)
def get_translation(req: TranslationRequest):
    global language_module
    _log("requested translation: ", req.word)
    return language_module.LANGUAGE_TRANSLATE(req.word)
class ControlRequest(BaseModel):
    function: str

@app.post("/control")
def control(req: ControlRequest):
    _log("/control called with function:", req.function)
    if req.function == "ping":
        return {"response": "pong"}
    elif req.function == "reload":
        get_all_cards()
        return {"response": "Reloaded"}
    else:
        return {"response": "Unknown function"}

@app.post("/quit")
def quit():
    _log("Received /quit; exiting shortly...")
    # Delay hard-exit slightly so the HTTP response doesn't get stream-closed prematurely
    def _shutdown():
        os._exit(0)
    threading.Timer(0.2, _shutdown).start()
    return {"response": "quitting"}


# --- OCR Support (RapidOCR + PaddleOCR + MangaOCR) ---
_rapid_ocr = None
_paddle_ocr = None
_manga_ocr = None
_ocr_model_lock = threading.Lock()  # protects _rapid_ocr, _paddle_ocr, _manga_ocr init/unload
_transformers_preimport_done = threading.Event()  # set once transformers has been pre-imported

# OCR idle-unload: free RAM after inactivity (mirrors LLM idle-unload)
_OCR_IDLE_TIMEOUT_SECONDS = 600  # 10 minutes
_ocr_last_used: float = 0.0
_ocr_idle_timer: threading.Timer | None = None
_ocr_idle_lock = threading.Lock()


def _ocr_touch():
    """Mark that OCR was just used; reset the idle-unload timer."""
    global _ocr_last_used, _ocr_idle_timer
    _ocr_last_used = time.monotonic()
    with _ocr_idle_lock:
        if _ocr_idle_timer is not None:
            _ocr_idle_timer.cancel()
        _ocr_idle_timer = threading.Timer(_OCR_IDLE_TIMEOUT_SECONDS, _ocr_check_idle)
        _ocr_idle_timer.daemon = True
        _ocr_idle_timer.start()


def _ocr_check_idle():
    """Called by the idle timer; unload OCR models if not used recently."""
    elapsed = time.monotonic() - _ocr_last_used
    if elapsed >= _OCR_IDLE_TIMEOUT_SECONDS:
        _ocr_unload()
    else:
        remaining = _OCR_IDLE_TIMEOUT_SECONDS - elapsed
        with _ocr_idle_lock:
            global _ocr_idle_timer
            _ocr_idle_timer = threading.Timer(remaining, _ocr_check_idle)
            _ocr_idle_timer.daemon = True
            _ocr_idle_timer.start()


def _ocr_unload():
    """Unload all OCR models to free memory."""
    global _rapid_ocr, _paddle_ocr, _manga_ocr
    with _ocr_model_lock:
        _ocr_unload_inner()


def _ocr_unload_inner():
    """Inner unload — caller must hold _ocr_model_lock."""
    global _rapid_ocr, _paddle_ocr, _manga_ocr
    any_unloaded = False
    if _rapid_ocr is not None:
        _log_ocr("OCR idle timeout — unloading RapidOCR")
        try:
            del _rapid_ocr
        except Exception:
            pass
        _rapid_ocr = None
        any_unloaded = True
    if _paddle_ocr is not None:
        _log_ocr("OCR idle timeout — unloading PaddleOCR")
        try:
            del _paddle_ocr
        except Exception:
            pass
        _paddle_ocr = None
        any_unloaded = True
    if _manga_ocr is not None:
        _log_ocr("OCR idle timeout — unloading MangaOCR")
        try:
            del _manga_ocr
        except Exception:
            pass
        _manga_ocr = None
        any_unloaded = True
    if any_unloaded:
        import gc
        gc.collect()
        if torch is not None:
            try:
                if hasattr(torch, 'cuda') and torch.cuda.is_available():
                    torch.cuda.empty_cache()
                if hasattr(torch, 'mps') and hasattr(torch.mps, 'empty_cache'):
                    torch.mps.empty_cache()
            except Exception:
                pass
        _log_ocr("OCR models unloaded successfully")


def _get_rapid_ocr():
    """Lazily initialize RapidOCR with the appropriate language."""
    global _rapid_ocr
    if not OCR_ALLOWED:
        _log_ocr_init("OCR disabled; RapidOCR not initialised")
        return None
    with _ocr_model_lock:
        if _rapid_ocr is not None:
            return _rapid_ocr
        return _init_rapid_ocr()


def _init_rapid_ocr():
    """Inner init — caller must hold _ocr_model_lock."""
    global _rapid_ocr
    try:
        from rapidocr import RapidOCR, LangRec  # type: ignore
    except Exception as e:
        _log_ocr_init("RapidOCR import error", e)
        return None

    lang_map = {
        "de": LangRec.LATIN,
        "ja": LangRec.JAPAN,
        "en": LangRec.EN,
        "zh": LangRec.CH,
        "ko": LangRec.KOREAN,
        "fr": LangRec.LATIN,
        "es": LangRec.LATIN,
        "ru": LangRec.CYRILLIC,
        "ar": LangRec.ARABIC,
        "th": LangRec.TH,
    }
    lang_type = lang_map.get(LANGUAGE, LangRec.EN)

    _log_ocr_init("Initializing RapidOCR with lang", str(lang_type))
    t0 = time.perf_counter()
    params = {
        "Global.use_cls": False,
        "Rec.lang_type": lang_type,
    }
    if SUPPORTS_VERTICAL_TEXT:
        # Use PaddleOCR-compatible detection parameters for vertical text.
        # PaddleOCR used limit_type='max' (limit the longest side) and
        # limit_side_len=960 which yields a higher-resolution detection
        # input that separates adjacent vertical columns more reliably.
        # The default RapidOCR values (limit_type='min', 736, unclip=1.6)
        # tend to merge neighbouring vertical columns into one wide box.
        params["Det.limit_type"] = "max"
        params["Det.limit_side_len"] = 960
        params["Det.unclip_ratio"] = 1.5
    _rapid_ocr = RapidOCR(params=params)
    t1 = time.perf_counter()
    _log_ocr_init(f"RapidOCR initialized in {t1 - t0:.2f}s")
    _process_stats("rapid_ocr_init")
    return _rapid_ocr


def _get_paddle_ocr():
    """Lazily initialize PaddleOCR — the accurate (non-turbo) engine.

    PaddleOCR produces significantly better detection boxes for vertical text
    (e.g. manga) compared to RapidOCR's DBNet, which tends to merge adjacent
    vertical columns into horizontal rows.
    """
    global _paddle_ocr
    if not OCR_ALLOWED:
        _log_ocr_init("OCR disabled; PaddleOCR not initialised")
        return None
    with _ocr_model_lock:
        if _paddle_ocr is not None:
            return _paddle_ocr
        return _init_paddle_ocr()


def _init_paddle_ocr():
    """Inner init — caller must hold _ocr_model_lock."""
    global _paddle_ocr
    try:
        from paddleocr import PaddleOCR  # type: ignore
    except Exception as e:
        _log_ocr_init("PaddleOCR import error", e)
        return None
    langs = {
        "de": "german",
        "ja": "japan",
        "en": "en",
        "ch": "ch",
        "ko": "korean",
        "fr": "french",
        "es": "spanish",
        "ru": "russian",
    }
    lang_code = langs.get(LANGUAGE, 'en')
    try:
        import paddle  # type: ignore
        _log_ocr_init("PaddlePaddle version", getattr(paddle, "__version__", "unknown"))
    except Exception as e:
        _log_ocr_init("Paddle import/version error", e)
    _log_ocr_init("Initializing PaddleOCR with lang", lang_code)
    t0 = time.perf_counter()
    _paddle_ocr = PaddleOCR(
        lang=lang_code,
        use_angle_cls=True,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
    )
    t1 = time.perf_counter()
    _log_ocr_init(f"PaddleOCR initialized in {t1 - t0:.2f}s")
    _process_stats("paddle_init")
    return _paddle_ocr


def _paddle_run_ocr(paddle_inst, img):
    """Call paddle.ocr with broad compatibility and structured progress logs."""
    try:
        res = paddle_inst.ocr(img, cls=False)
        _log_ocr_run("paddle ocr produced", len(res) if isinstance(res, list) else 'n/a', "items")
        return res
    except TypeError:
        res = paddle_inst.ocr(img)
        _log_ocr_run("paddle ocr produced (compat)", len(res) if isinstance(res, list) else 'n/a', "items")
        return res


def _extract_lines_from_paddle_result(result):
    """Normalize PaddleOCR result to a flat list of (box, text, score)."""
    if not result:
        return []

    if isinstance(result, list) and len(result) == 1 and not isinstance(result[0], (list, tuple)):
        result = result[0]

    if isinstance(result, dict):
        texts = result.get('rec_texts') or result.get('texts')
        scores = result.get('rec_scores') or result.get('scores')
        box_keys = [
            'text_det_polys', 'det_polys', 'dt_polys', 'polys',
            'text_region_polys', 'boxes', 'dt_boxes', 'det_boxes',
        ]
        boxes = None
        for k in box_keys:
            if k in result:
                boxes = result[k]
                break
        if boxes is None:
            for k, v in result.items():
                if isinstance(v, (list, tuple)) and len(v) > 0:
                    try:
                        arr = np.array(v[0])
                        if arr.ndim == 2 and arr.shape[1] == 2 and arr.shape[0] >= 4:
                            boxes = v
                            break
                    except Exception:
                        pass
        flat: list[tuple] = []
        try:
            if texts is not None and isinstance(boxes, (list, tuple)) and len(boxes) > 0:
                n = min(len(texts), len(boxes))
                for i in range(n):
                    pts = boxes[i]
                    if isinstance(pts, np.ndarray):
                        pts = pts.tolist()
                    if pts and isinstance(pts[0], (int, float)) and len(pts) % 2 == 0:
                        pts = [[float(pts[j]), float(pts[j + 1])] for j in range(0, len(pts), 2)]
                    pts = [[float(x), float(y)] for x, y in pts]
                    txt = str(texts[i])
                    scr = float(scores[i]) if scores is not None and i < len(scores) else None
                    flat.append((pts, txt, scr))
                return flat
            if texts is not None:
                return [(None, str(t), float(scores[i]) if scores is not None and i < len(scores) else None) for i, t in enumerate(texts)]
        except Exception:
            return []
        return []

    lines = result
    if isinstance(result, list) and len(result) > 0 and isinstance(result[0], list) and (
        len(result) == 1 or (result and isinstance(result[0][0], (list, tuple)))
    ):
        lines = result[0]

    flat = []
    try:
        for item in lines:
            if not item:
                continue
            pts = item[0]
            txt, scr = None, None
            if len(item) > 1 and isinstance(item[1], (list, tuple)) and len(item[1]) >= 2:
                txt, scr = item[1][0], float(item[1][1])
            flat.append((pts, txt, scr))
    except Exception as e:
        _log_ocr_run(f"Failed to parse PaddleOCR lines: {e}")
        return []
    return flat


def _get_manga_ocr():
    global _manga_ocr
    if not OCR_ALLOWED:
        _log_ocr_init("OCR disabled; MangaOCR not initialised")
        return None
    with _ocr_model_lock:
        if _manga_ocr is not None:
            return _manga_ocr
        return _init_manga_ocr()


def _init_manga_ocr():
    """Inner init — caller must hold _ocr_model_lock."""
    global _manga_ocr
    # Wait for the background transformers pre-import to finish so the heavy
    # module scan happens before ONNX sessions claim permanent FDs.
    _transformers_preimport_done.wait(timeout=120)
    # Log FD count for diagnostics
    try:
        _fd_count = len(os.listdir('/dev/fd'))
        _log_ocr_init(f"Process FDs before MangaOCR init: {_fd_count}")
    except Exception:
        pass
    # Force GC to close unreferenced file handles before the heavy
    # transformers import, which opens hundreds of module files.
    import gc
    gc.collect()
    try:
        from manga_ocr import MangaOcr  # type: ignore
    except Exception as e:
        _log_ocr_init("MangaOCR import error", e)
        return None
    try:
        _log_ocr_init("Initializing MangaOCR")
        t0 = time.perf_counter()
        _manga_ocr = MangaOcr()
        t1 = time.perf_counter()
        _log_ocr_init(f"MangaOCR initialized in {t1 - t0:.2f}s")
        _process_stats("mangaocr_init")
    except Exception as e:
        _log_ocr_init("Failed to initialize MangaOCR", e)
        _manga_ocr = None
    return _manga_ocr


def _opencv_detect_text_regions(np_img, prefer_vertical: bool = False):
    """Detect text regions using OpenCV morphological operations.

    This is the lightweight 'Ram Saver' detection path.
    It avoids loading any neural network for detection, using classical
    image processing instead: grayscale → adaptive threshold → dilate
    (to connect nearby characters) → contour detection → filter by
    area and aspect ratio.

    When *prefer_vertical* is ``False`` (default) two dilation passes are
    performed — one with a horizontal kernel and one with a vertical
    kernel — and their results are merged.  This ensures both horizontal
    and vertical text lines are captured.

    When *prefer_vertical* is ``True`` (vertical-text languages) only the
    vertical kernel is used so that characters stacked in a column merge
    into a single tall region instead of bridging across adjacent columns.

    Returns a list of 4-point bounding boxes (same shape as RapidOCR boxes).
    """
    import cv2  # type: ignore
    gray = cv2.cvtColor(np_img, cv2.COLOR_BGR2GRAY)
    # Adaptive threshold handles uneven lighting in scanned pages / photos
    binary = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 25, 15
    )

    if prefer_vertical:
        # Vertical-text path: only merge characters vertically so adjacent
        # columns stay separate.  A small horizontal component (4px) still
        # captures strokes that slightly exceed character bounding boxes.
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (4, 25))
        combined = cv2.dilate(binary, kernel, iterations=2)
    else:
        # Horizontal kernel — merges characters in horizontal text lines
        kernel_h = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 8))
        dilated_h = cv2.dilate(binary, kernel_h, iterations=2)

        # Vertical kernel — merges characters in vertical text columns
        kernel_v = cv2.getStructuringElement(cv2.MORPH_RECT, (8, 25))
        dilated_v = cv2.dilate(binary, kernel_v, iterations=2)

        # Combine both: any region found by either pass
        combined = cv2.bitwise_or(dilated_h, dilated_v)

    contours, _ = cv2.findContours(combined, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    H, W = np_img.shape[:2]
    img_area = H * W
    min_area = img_area * 0.0005   # filter tiny noise
    max_area = img_area * 0.95     # filter full-page blobs

    boxes = []
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        area = w * h
        if area < min_area or area > max_area:
            continue
        # Filter by aspect ratio — skip extremely thin/wide blobs
        aspect = w / max(h, 1)
        if aspect > 30 or aspect < 0.03:
            continue
        box = [
            [float(x), float(y)],
            [float(x + w), float(y)],
            [float(x + w), float(y + h)],
            [float(x), float(y + h)],
        ]
        boxes.append(box)

    # Sort top-to-bottom, then left-to-right
    boxes.sort(key=lambda b: (b[0][1], b[0][0]))
    _log_ocr_run(f"OpenCV morphological detection found {len(boxes)} regions")
    return boxes


def _regroup_boxes_for_vertical_text(boxes):
    """Post-process detection boxes for vertical-text languages.

    RapidOCR's DBNet detection may produce per-character boxes or horizontal-row
    boxes instead of per-column boxes for vertical text (e.g. manga).  This
    function clusters the detected boxes into vertical columns.

    Algorithm:
    1. Compute a bounding rect for each box.
    2. If the majority of boxes are already taller than wide (vertical columns),
       assume detection is correct and return unchanged.
    3. Otherwise, cluster boxes whose X-ranges overlap into vertical columns
       (union-find), merge each cluster into a single tall bounding box.
    """
    if not boxes or len(boxes) <= 1:
        return boxes

    # Compute metrics
    rects = []
    for box in boxes:
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        w = max_x - min_x
        h = max_y - min_y
        rects.append({
            'min_x': min_x, 'max_x': max_x,
            'min_y': min_y, 'max_y': max_y,
            'w': max(w, 1), 'h': max(h, 1),
            'cx': (min_x + max_x) / 2.0,
            'cy': (min_y + max_y) / 2.0,
        })

    # If most boxes are already taller than wide, detection was fine
    tall_count = sum(1 for r in rects if r['h'] > r['w'] * 1.3)
    if tall_count >= len(rects) * 0.5:
        _log_ocr_run(f"Vertical regroup: {tall_count}/{len(rects)} already vertical, skipping")
        return boxes

    _log_ocr_run(f"Vertical regroup: only {tall_count}/{len(rects)} vertical, regrouping into columns")

    # Union-Find for clustering boxes into columns
    n = len(rects)
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    # Median width of boxes (character width estimate)
    widths = sorted(r['w'] for r in rects)
    median_w = widths[len(widths) // 2] if widths else 1.0
    # Threshold: boxes within this horizontal distance share a column
    x_thresh = median_w * 1.2

    # Cluster boxes that overlap or are close in X
    for i in range(n):
        for j in range(i + 1, n):
            ri, rj = rects[i], rects[j]
            # Check if X-ranges overlap or are within threshold
            x_overlap = min(ri['max_x'], rj['max_x']) - max(ri['min_x'], rj['min_x'])
            if x_overlap >= -x_thresh:
                # Also verify they're not too far apart vertically
                # (they should be in the same text block, not different bubbles)
                y_gap = max(0, max(ri['min_y'], rj['min_y']) - min(ri['max_y'], rj['max_y']))
                max_h = max(ri['h'], rj['h'])
                if y_gap <= max_h * 3:
                    union(i, j)

    # Group by cluster
    from collections import defaultdict
    clusters = defaultdict(list)
    for i in range(n):
        clusters[find(i)].append(i)

    # Merge each cluster into one bounding box
    merged = []
    for indices in clusters.values():
        if not indices:
            continue
        min_x = min(rects[i]['min_x'] for i in indices)
        max_x = max(rects[i]['max_x'] for i in indices)
        min_y = min(rects[i]['min_y'] for i in indices)
        max_y = max(rects[i]['max_y'] for i in indices)
        merged.append([
            [min_x, min_y],
            [max_x, min_y],
            [max_x, max_y],
            [min_x, max_y],
        ])

    _log_ocr_run(f"Vertical regroup: {len(boxes)} boxes → {len(merged)} columns")
    return merged


def _load_image_from_inputs(file_bytes: bytes | None, image_base64: str | None) -> Image.Image:
    if file_bytes is None and not image_base64:
        raise HTTPException(status_code=400, detail="No image provided. Send 'file' or 'image_base64'.")
    try:
        if file_bytes is not None:
            _log("Loading image from file bytes of length:", len(file_bytes))
            img = Image.open(io.BytesIO(file_bytes))
            _log("Loaded image: mode=", img.mode, " size=", img.size)
            return img.convert('RGB')
        else:
            raw_part = image_base64.split(',')[-1] if image_base64 else ''
            _log("Loading image from base64 of length:", len(raw_part))
            raw = base64.b64decode(raw_part)
            img = Image.open(io.BytesIO(raw))
            _log("Loaded image: mode=", img.mode, " size=", img.size)
            return img.convert('RGB')
    except Exception as e:
        _log("_load_image_from_inputs error:", e)
        _log(traceback.format_exc())
        raise HTTPException(status_code=400, detail="Invalid image data.")


def _extract_rapid_ocr_boxes(result) -> list:
    """Extract boxes from a RapidOCR result object.

    Returns a list of (box, text, score) where box is a list of 4 [x,y] pairs.
    RapidOCR returns result.boxes as an (N, 4, 2) numpy array, result.txts
    as a tuple of strings, and result.scores as a tuple of floats.
    """
    if result is None:
        return []
    boxes = result.boxes
    txts = result.txts
    scores = result.scores
    if boxes is None or txts is None:
        return []
    flat = []
    try:
        n = min(len(boxes), len(txts))
        for i in range(n):
            pts = boxes[i]
            if isinstance(pts, np.ndarray):
                pts = pts.tolist()
            # Ensure list of [x, y] pairs
            pts = [[float(x), float(y)] for x, y in pts]
            txt = str(txts[i])
            scr = float(scores[i]) if scores is not None and i < len(scores) else None
            flat.append((pts, txt, scr))
    except Exception as e:
        _log_ocr_run("_extract_rapid_ocr_boxes error:", e)
    return flat


def _box_width(pts) -> float:
    try:
        xs = [p[0] for p in pts]
        return max(xs) - min(xs)
    except Exception:
        return 0.0


def _box_height(pts) -> float:
    try:
        ys = [p[1] for p in pts]
        return max(ys) - min(ys)
    except Exception:
        return 0.0


def _filter_furigana_boxes(boxes: list[list[list[float]]]) -> list[list[list[float]]]:
    """Remove boxes whose width is drastically different from the typical width (heuristic).
    We consider widths close to the median as typical; drop boxes outside [0.6, 1.8] * median.
    """
    if not boxes:
        return boxes
    widths = [max(1.0, _box_width(b)) for b in boxes]
    try:
        med = statistics.median(widths)
    except statistics.StatisticsError:
        med = sum(widths) / max(1, len(widths))
    lo, hi = 0.6 * med, 1.8 * med
    filtered = []
    for b, w in zip(boxes, widths):
        h = _box_height(b)
        # Also drop extremely tiny height (noise)
        if h < 5:
            continue
        if lo <= w <= hi:
            filtered.append(b)
    return filtered


def _crop_by_box(image: Image.Image, pts) -> Image.Image:
    # Use the bounding rectangle of the quad for simplicity
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    left, upper, right, lower = max(0, int(min(xs))), max(0, int(min(ys))), int(max(xs)), int(max(ys))
    # Ensure non-empty crop
    if right <= left:
        right = left + 1
    if lower <= upper:
        lower = upper + 1
    return image.crop((left, upper, right, lower))


class OcrBox(BaseModel):
    box: List[List[float]]  # 4x2 points
    text: str
    score: float | None = None
    is_vertical: bool | None = None


def _is_box_vertical(pts) -> bool:
    """Determine whether a 4-point box represents vertical text.

    Uses the actual edge lengths of the quadrilateral (not the axis-aligned
    bounding rect) so that slightly rotated boxes are handled correctly.
    A box is considered vertical when its height is at least 1.2× its width.
    """
    try:
        import math
        # Width  = average of top and bottom edges
        w_top = math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1])
        w_bot = math.hypot(pts[2][0] - pts[3][0], pts[2][1] - pts[3][1])
        # Height = average of left and right edges
        h_left  = math.hypot(pts[3][0] - pts[0][0], pts[3][1] - pts[0][1])
        h_right = math.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1])
        w = (w_top + w_bot) / 2.0
        h = (h_left + h_right) / 2.0
        return h > w * 1.2 if w > 0 else h > 0
    except Exception:
        return False


class OcrResponse(BaseModel):
    boxes: List[OcrBox]


@app.post("/ocr", response_model=OcrResponse)
async def ocr_endpoint(
    file: UploadFile | None = File(None),
    image_base64: str | None = Form(None),
    turbo: str | None = Form(None),
    ram_saver: str | None = Form(None),
):
    if not OCR_ALLOWED:
        raise HTTPException(status_code=403, detail="OCR disabled by user")

    # Parse turbo flag — default to True (fast mode)
    is_turbo = turbo is None or turbo.lower() not in ("0", "false", "no")
    # Parse ram_saver flag — fall back to startup value from settings.json
    if ram_saver is not None:
        use_ram_saver = ram_saver.lower() in ("1", "true", "yes")
    else:
        use_ram_saver = OCR_RAM_SAVER

    _log_ocr_run(f"Loading Neural Network (turbo={is_turbo})")
    _process_stats("ocr_req")
    _ocr_touch()
    try:
        file_bytes = await file.read() if file is not None else None
        image = _load_image_from_inputs(file_bytes, image_base64)
        np_img = np.array(image, dtype=np.uint8)
        if not np_img.flags['C_CONTIGUOUS']:
            np_img = np.ascontiguousarray(np_img)

        results: list[OcrBox] = []

        if is_turbo:
            # ── Turbo mode: RapidOCR (fast, may misdetect vertical text) ──
            import cv2 as _cv2
            np_img_bgr = _cv2.cvtColor(np_img, _cv2.COLOR_RGB2BGR)

            if LANGUAGE == 'ja':
                _log_ocr_run(f"Japanese OCR — Turbo ON, Ram Saver {'ON' if use_ram_saver else 'OFF'}")
                H, W = int(np_img.shape[0]), int(np_img.shape[1])

                if use_ram_saver:
                    t2 = time.perf_counter()
                    initial_boxes = _opencv_detect_text_regions(np_img_bgr, prefer_vertical=SUPPORTS_VERTICAL_TEXT)
                    t3 = time.perf_counter()
                    _log_ocr_run(f"OpenCV detection {t3 - t2:.2f}s, {len(initial_boxes)} boxes")
                else:
                    t0 = time.perf_counter()
                    rapid = _get_rapid_ocr()
                    t1 = time.perf_counter()
                    if rapid is None:
                        raise HTTPException(status_code=500, detail="RapidOCR not available")
                    _log_ocr_run(f"RapidOCR handle ready in {t1 - t0:.2f}s (turbo)")

                    det_img = np_img_bgr
                    scale = 1.0
                    if max(H, W) > 2000:
                        scale = 2000.0 / float(max(H, W))
                        new_w = max(1, int(W * scale))
                        new_h = max(1, int(H * scale))
                        _log_ocr_run(f"Downscaling for detection {W}x{H}->{new_w}x{new_h} scale={scale:.3f}")
                        det_img = _cv2.resize(np_img_bgr, (new_w, new_h), interpolation=_cv2.INTER_AREA)
                        if not det_img.flags['C_CONTIGUOUS']:
                            det_img = np.ascontiguousarray(det_img)

                    t2 = time.perf_counter()
                    det_result = rapid(det_img, use_det=True, use_cls=False, use_rec=False)
                    t3 = time.perf_counter()
                    _log_ocr_run(f"RapidOCR detection-only {t3 - t2:.2f}s")

                    initial_boxes = []
                    if det_result is not None and det_result.boxes is not None:
                        for pts in det_result.boxes:
                            if isinstance(pts, np.ndarray):
                                pts = pts.tolist()
                            initial_boxes.append([[float(x), float(y)] for x, y in pts])

                    if scale != 1.0 and initial_boxes:
                        inv = 1.0 / scale
                        initial_boxes = [[[float(x) * inv, float(y) * inv] for x, y in pts] for pts in initial_boxes]
                    _log_ocr_run(f"Found {len(initial_boxes)} boxes after rescale")

                # For vertical-text languages, regroup boxes into vertical columns
                # if RapidOCR produced horizontal-row boxes instead.
                if SUPPORTS_VERTICAL_TEXT and initial_boxes:
                    initial_boxes = _regroup_boxes_for_vertical_text(initial_boxes)

                # Recognition with MangaOCR
                _log_ocr_run("Recognizing text with MangaOCR...")
                mocr = _get_manga_ocr()
                if mocr is None:
                    raise HTTPException(status_code=500, detail="MangaOCR not available")
                if not initial_boxes:
                    try:
                        full_txt = mocr(image) or ''
                        w, h = image.size
                        full_box = [[0.0, 0.0], [float(w), 0.0], [float(w), float(h)], [0.0, float(h)]]
                        results.append(OcrBox(box=full_box, text=full_txt, score=None, is_vertical=_is_box_vertical(full_box)))
                        _log_ocr_run(f"Full-image fallback len={len(full_txt)}")
                    except Exception as e:
                        _log_ocr_run("Full-image fallback error", e)
                else:
                    for i, pts in enumerate(initial_boxes):
                        crop = _crop_by_box(image, pts)
                        try:
                            txt = mocr(crop) or ''
                            _log_ocr_run(f"Recognition progress {i + 1}/{len(initial_boxes)}")
                        except Exception as e:
                            _log_ocr_run(f"MangaOCR error box {i + 1}", e)
                            txt = ''
                        box_pts = [[float(x), float(y)] for x, y in pts]
                        results.append(OcrBox(box=box_pts, text=txt, score=None, is_vertical=_is_box_vertical(box_pts)))
            else:
                # Non-Japanese turbo: RapidOCR end-to-end
                t0 = time.perf_counter()
                rapid = _get_rapid_ocr()
                t1 = time.perf_counter()
                if rapid is None:
                    raise HTTPException(status_code=500, detail="RapidOCR not available")
                _log_ocr_run(f"RapidOCR handle ready in {t1 - t0:.2f}s (turbo)")
                _log_ocr_run("Recognizing text positions...")

                t2 = time.perf_counter()
                out = rapid(np_img_bgr, use_det=True, use_cls=False, use_rec=True)
                t3 = time.perf_counter()
                _log_ocr_run(f"RapidOCR e2e {t3 - t2:.2f}s")

                lines = _extract_rapid_ocr_boxes(out)
                _log_ocr_run(f"Extracted {len(lines)} lines (e2e)")
                for i, (pts, txt, scr) in enumerate(lines):
                    if pts is None:
                        continue
                    if i % 25 == 0:
                        _log_ocr_run(f"Recognition progress {i + 1}/{len(lines)}")
                    box_pts = [[float(x), float(y)] for x, y in pts]
                    results.append(OcrBox(
                        box=box_pts,
                        text=str(txt or ''),
                        score=(float(scr) if scr is not None else None),
                        is_vertical=_is_box_vertical(box_pts),
                    ))
        else:
            # ── Accurate mode: PaddleOCR (better vertical text detection) ──
            if LANGUAGE == 'ja':
                _log_ocr_run(f"Japanese OCR — Turbo OFF (PaddleOCR), Ram Saver {'ON' if use_ram_saver else 'OFF'}")
                H, W = int(np_img.shape[0]), int(np_img.shape[1])

                if use_ram_saver:
                    import cv2 as _cv2
                    np_img_bgr = _cv2.cvtColor(np_img, _cv2.COLOR_RGB2BGR)
                    t2 = time.perf_counter()
                    initial_boxes = _opencv_detect_text_regions(np_img_bgr, prefer_vertical=SUPPORTS_VERTICAL_TEXT)
                    t3 = time.perf_counter()
                    _log_ocr_run(f"OpenCV detection {t3 - t2:.2f}s, {len(initial_boxes)} boxes")
                else:
                    # PaddleOCR detection — handles vertical text columns correctly
                    t0 = time.perf_counter()
                    paddle = _get_paddle_ocr()
                    t1 = time.perf_counter()
                    if paddle is None:
                        raise HTTPException(status_code=500, detail="PaddleOCR not available")
                    _log_ocr_run(f"PaddleOCR handle ready in {t1 - t0:.2f}s")

                    det_img = np_img
                    scale = 1.0
                    if max(H, W) > 2000:
                        scale = 2000.0 / float(max(H, W))
                        new_w = max(1, int(W * scale))
                        new_h = max(1, int(H * scale))
                        _log_ocr_run(f"Downscaling for detection {W}x{H}->{new_w}x{new_h} scale={scale:.3f}")
                        det_img = np.ascontiguousarray(np.array(image.resize((new_w, new_h)), dtype=np.uint8))

                    t2 = time.perf_counter()
                    det = _paddle_run_ocr(paddle, det_img)
                    t3 = time.perf_counter()
                    _log_ocr_run(f"PaddleOCR detection {t3 - t2:.2f}s")

                    lines = _extract_lines_from_paddle_result(det)
                    _log_ocr_run(f"Extracted {len(lines)} lines (det stage)")
                    initial_boxes = [item[0] for item in lines if item and item[0] is not None]
                    if scale != 1.0 and initial_boxes:
                        inv = 1.0 / scale
                        initial_boxes = [[[float(x) * inv, float(y) * inv] for x, y in pts] for pts in initial_boxes]
                    _log_ocr_run(f"Found {len(initial_boxes)} boxes after rescale")

                # Recognition with MangaOCR
                _log_ocr_run("Recognizing text with MangaOCR...")
                mocr = _get_manga_ocr()
                if mocr is None:
                    raise HTTPException(status_code=500, detail="MangaOCR not available")
                if not initial_boxes:
                    try:
                        full_txt = mocr(image) or ''
                        w, h = image.size
                        full_box = [[0.0, 0.0], [float(w), 0.0], [float(w), float(h)], [0.0, float(h)]]
                        results.append(OcrBox(box=full_box, text=full_txt, score=None, is_vertical=_is_box_vertical(full_box)))
                        _log_ocr_run(f"Full-image fallback len={len(full_txt)}")
                    except Exception as e:
                        _log_ocr_run("Full-image fallback error", e)
                else:
                    for i, pts in enumerate(initial_boxes):
                        crop = _crop_by_box(image, pts)
                        try:
                            txt = mocr(crop) or ''
                            _log_ocr_run(f"Recognition progress {i + 1}/{len(initial_boxes)}")
                        except Exception as e:
                            _log_ocr_run(f"MangaOCR error box {i + 1}", e)
                            txt = ''
                        box_pts = [[float(x), float(y)] for x, y in pts]
                        results.append(OcrBox(box=box_pts, text=txt, score=None, is_vertical=_is_box_vertical(box_pts)))
            else:
                # Non-Japanese accurate: PaddleOCR end-to-end
                t0 = time.perf_counter()
                paddle = _get_paddle_ocr()
                t1 = time.perf_counter()
                if paddle is None:
                    raise HTTPException(status_code=500, detail="PaddleOCR not available")
                _log_ocr_run(f"PaddleOCR handle ready in {t1 - t0:.2f}s")
                _log_ocr_run("Recognizing text positions...")

                t2 = time.perf_counter()
                out = _paddle_run_ocr(paddle, np_img)
                t3 = time.perf_counter()
                _log_ocr_run(f"PaddleOCR e2e {t3 - t2:.2f}s")

                lines = _extract_lines_from_paddle_result(out)
                _log_ocr_run(f"Extracted {len(lines)} lines (e2e)")
                for i, (pts, txt, scr) in enumerate(lines):
                    if pts is None:
                        continue
                    if i % 25 == 0:
                        _log_ocr_run(f"Recognition progress {i + 1}/{len(lines)}")
                    box_pts = [[float(x), float(y)] for x, y in pts]
                    results.append(OcrBox(
                        box=box_pts,
                        text=str(txt or ''),
                        score=(float(scr) if scr is not None else None),
                        is_vertical=_is_box_vertical(box_pts),
                    ))

        _log_ocr_run(f"Final boxes {len(results)}")
        _process_stats("ocr_done")
        return {"boxes": [r.model_dump(exclude_none=True) for r in results]}
    except HTTPException:
        _log_ocr_run("/ocr http exception")
        raise
    except Exception as e:
        _log_ocr_run("Unhandled error", e)
        _log_ocr_run(traceback.format_exc())
        raise HTTPException(status_code=500, detail="OCR processing error")


@app.get("/health")
async def health():
    _process_stats("health")
    return {"status": "ok", "language": LANGUAGE}


# Request/Response logging middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    _log("HTTP", request.method, str(request.url))
    try:
        response = await call_next(request)
        _log("HTTP Response", response.status_code, request.method, str(request.url))
        return response
    except Exception:
        _log("HTTP Exception during handling:")
        _log(traceback.format_exc())
        raise

@app.post("/llm", response_model=LlmResponse)
async def llm_endpoint(req: LlmRequest):
    """DEPRECATED: LLM inference has moved to node-llama-cpp in the Electron main process."""
    _log("LLM request", {"chars": len(req.prompt), "max_new_tokens": req.max_new_tokens})
    if not LLM_ALLOWED:
        raise HTTPException(status_code=403, detail="LLM disabled by user")
    try:
        _ensure_llm_loaded()
    except RuntimeError as exc:
        _log("LLM init error", exc)
        raise HTTPException(status_code=500, detail=str(exc))

    if torch is None or _llm_tokenizer is None or _llm_model is None:
        raise HTTPException(status_code=500, detail="LLM unavailable")

    _llm_touch()
    try:
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
        text = _llm_tokenizer.decode(output_ids[0], skip_special_tokens=True).strip()
        return {"output": text, "device": _llm_device}
    except Exception as exc:
        _log("LLM generation error", exc)
        raise HTTPException(status_code=500, detail="Generation failed")


from fastapi.responses import StreamingResponse


@app.post("/llm/stream")
async def llm_stream_endpoint(req: LlmRequest):
    """DEPRECATED: Streaming LLM endpoint. LLM inference has moved to node-llama-cpp in the Electron main process."""
    _log("LLM stream request", {"chars": len(req.prompt), "max_new_tokens": req.max_new_tokens})
    if not LLM_ALLOWED:
        raise HTTPException(status_code=403, detail="LLM disabled by user")
    try:
        _ensure_llm_loaded()
    except RuntimeError as exc:
        _log("LLM init error", exc)
        raise HTTPException(status_code=500, detail=str(exc))

    if torch is None or _llm_tokenizer is None or _llm_model is None:
        raise HTTPException(status_code=500, detail="LLM unavailable")

    _llm_touch()
    async def generate_stream():
        """Generator that yields SSE events with tokens as they are generated."""
        try:
            from transformers import TextIteratorStreamer
            
            inputs = _llm_tokenizer(req.prompt, return_tensors="pt")
            tensor_inputs = {k: v.to(_llm_device) for k, v in inputs.items()}
            max_new_tokens = max(1, min(req.max_new_tokens, 512))
            
            # Create a streamer
            streamer = TextIteratorStreamer(
                _llm_tokenizer, 
                skip_prompt=True, 
                skip_special_tokens=True
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
            
            # Start generation in a separate thread
            generation_thread = threading.Thread(
                target=lambda: _llm_model.generate(**tensor_inputs, **gen_opts)
            )
            generation_thread.start()
            
            # Yield tokens as they come
            full_text = ""
            for text_chunk in streamer:
                if text_chunk:
                    full_text += text_chunk
                    # SSE format: data: <content>\n\n
                    yield f"data: {json.dumps({'chunk': text_chunk, 'done': False})}\n\n"
            
            # Signal completion
            yield f"data: {json.dumps({'chunk': '', 'done': True, 'full_text': full_text.strip(), 'device': _llm_device})}\n\n"
            
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
        }
    )

# ============================================================================
# Voice Service — STT (faster-whisper) + TTS (Kokoro / Remote) + VAD (Silero)
# ============================================================================

_voice_stt_model = None
_voice_tts_pipeline = None   # Kokoro KPipeline instance
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

# TTS provider config — reloaded from settings.json on each TTS request
_tts_provider: str = "kokoro"   # 'kokoro' | 'remote'
_remote_tts_url: str = ""


def _reload_tts_settings():
    """Reload TTS provider settings from settings.json (called per-request)."""
    global _tts_provider, _remote_tts_url
    if not USER_DATA_PATH:
        return
    settings_path = os.path.join(USER_DATA_PATH, "settings.json")
    if not os.path.exists(settings_path):
        return
    try:
        with open(settings_path, 'r', encoding='utf-8') as f:
            settings = json.load(f)
            _tts_provider = settings.get("ttsProvider", "kokoro")
            _remote_tts_url = settings.get("remoteTtsUrl", "")
    except Exception:
        pass


# Load initial settings
_reload_tts_settings()

# Kokoro language code mapping (mLearn language code → Kokoro lang_code)
_KOKORO_LANG_MAP = {
    "ja": "j",   # Japanese
    "en": "a",   # American English
    "zh": "z",   # Chinese (Mandarin)
    "ko": "j",   # Korean — fallback to Japanese phonemizer
    "fr": "f",   # French
    "es": "e",   # Spanish
    "hi": "h",   # Hindi
    "it": "i",   # Italian
    "pt": "p",   # Portuguese (Brazilian)
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


def _voice_touch():
    global _voice_last_used, _voice_idle_timer
    _voice_last_used = time.monotonic()
    with _voice_idle_lock:
        if _voice_idle_timer is not None:
            _voice_idle_timer.cancel()
        _voice_idle_timer = threading.Timer(_VOICE_IDLE_TIMEOUT_SECONDS, _voice_check_idle)
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
        import gc
        gc.collect()
        if torch is not None:
            try:
                if hasattr(torch, 'cuda') and torch.cuda.is_available():
                    torch.cuda.empty_cache()
                if hasattr(torch, 'mps') and hasattr(torch.mps, 'empty_cache'):
                    torch.mps.empty_cache()
            except Exception:
                pass
        _log("Voice models unloaded")


def _get_stt_device():
    """Device for STT (faster-whisper / CTranslate2) — CUDA or CPU only (no MPS support)."""
    _torch = importlib.import_module("torch") if torch is None else torch
    if _torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _get_tts_device():
    """Device for TTS (Kokoro) — MPS > CUDA > CPU."""
    _torch = importlib.import_module("torch") if torch is None else torch
    if hasattr(_torch.backends, "mps") and _torch.backends.mps.is_available():
        return "mps"
    if _torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _ensure_vad_loaded():
    global _voice_vad_model
    if _voice_vad_model is not None:
        return _voice_vad_model
    with _voice_vad_lock:
        if _voice_vad_model is not None:
            return _voice_vad_model
        try:
            _log("Loading Silero VAD model...")
            _torch = importlib.import_module("torch") if torch is None else torch
            model, utils = _torch.hub.load(
                repo_or_dir='snakers4/silero-vad',
                model='silero_vad',
                force_reload=False,
                onnx=False
            )
            _voice_vad_model = {
                'model': model,
                'utils': utils,
            }
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
            # Default to Japanese; the pipeline can be recreated per-language
            # but 'j' is the primary use case.
            lang_code = _KOKORO_LANG_MAP.get(LANGUAGE, "a")
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
    """Split text into sentences for sentence-level TTS."""
    import re as _re
    sentences = _re.split(r'(?<=[.!?。！？])\s*', text)
    return [s.strip() for s in sentences if s.strip()]


@app.get("/voice/stt/status")
async def voice_stt_status():
    """Check STT model status."""
    downloaded = False
    loaded = _voice_stt_model is not None
    try:
        from faster_whisper import WhisperModel
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


@app.get("/voice/tts/status")
async def voice_tts_status():
    """Check TTS model status."""
    if _tts_provider == "remote":
        # For remote provider, check if the remote server is reachable
        reachable = False
        remote_loaded = False
        if _remote_tts_url:
            try:
                import urllib.request
                resp = urllib.request.urlopen(f"{_remote_tts_url.rstrip('/')}/voice/tts/status", timeout=3)
                data = json.loads(resp.read())
                reachable = True
                remote_loaded = data.get("loaded", False)
            except Exception:
                pass
        return {
            "downloaded": reachable,
            "loaded": remote_loaded,
            "downloading": False,
            "progress": 1.0 if reachable else 0.0,
            "modelName": "MOSS-TTS-Realtime (Remote)",
        }

    # Kokoro local
    package_installed = False
    loaded = _voice_tts_pipeline is not None
    try:
        from kokoro import KPipeline
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


@app.post("/voice/models/download")
async def voice_download_models():
    """Trigger pre-download of voice models (STT + TTS)."""
    global _voice_stt_downloading, _voice_tts_downloading, _voice_stt_progress, _voice_tts_progress

    errors = []

    # Download STT
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

    # Download TTS (Kokoro only — remote doesn't need local download)
    if _tts_provider == "kokoro":
        try:
            _voice_tts_downloading = True
            _voice_tts_progress = 0.0
            _log("Pre-downloading TTS model...")
            _ensure_tts_loaded()
            _voice_tts_progress = 1.0
            _voice_tts_downloading = False
        except Exception as e:
            _voice_tts_downloading = False
            errors.append(f"TTS: {e}")

    if errors:
        return {"success": False, "errors": errors}
    return {"success": True}


class TTSRequest(BaseModel):
    text: str
    language: str = "en"
    voiceSamplePath: Optional[str] = None
    speed: float = 1.0


@app.post("/voice/tts")
async def voice_tts_generate(req: TTSRequest):
    """Generate TTS audio. Returns binary WAV with sentence boundary metadata in headers."""
    # Reload TTS settings so runtime changes take effect without restart
    _reload_tts_settings()
    try:
        # If using remote provider, forward request to the remote server
        if _tts_provider == "remote" and _remote_tts_url:
            return await _generate_tts_remote(req)

        # Local Kokoro generation
        return await _generate_tts_kokoro(req)
    except Exception as e:
        _log("TTS generation error:", e)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


async def _generate_tts_remote(req: TTSRequest):
    """Forward TTS request to the remote MOSS-TTS server."""
    import urllib.request
    url = f"{_remote_tts_url.rstrip('/')}/voice/tts"
    body_bytes = json.dumps({
        "text": req.text,
        "language": req.language,
        "voiceSamplePath": req.voiceSamplePath or "",
        "speed": req.speed,
    }).encode("utf-8")
    http_req = urllib.request.Request(
        url, data=body_bytes,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    resp = urllib.request.urlopen(http_req, timeout=60)
    audio_bytes = resp.read()
    boundaries = resp.headers.get("X-Sentence-Boundaries", "[]")
    sample_rate = resp.headers.get("X-Sample-Rate", "24000")
    from starlette.responses import Response
    return Response(
        content=audio_bytes,
        media_type="audio/wav",
        headers={
            "X-Sentence-Boundaries": boundaries,
            "X-Sample-Rate": sample_rate,
        },
    )


async def _generate_tts_kokoro(req: TTSRequest):
    """Generate TTS audio using the local Kokoro pipeline."""
    pipeline = _ensure_tts_loaded()
    _voice_touch()

    global torch
    if torch is None:
        torch = importlib.import_module("torch")
    import numpy as np

    sentences = _split_into_sentences(req.text)
    if not sentences:
        sentences = [req.text]

    lang_code = _KOKORO_LANG_MAP.get(req.language, "a")
    voice = _KOKORO_VOICE_MAP.get(lang_code, "af_heart")

    # If the pipeline was created for a different language, recreate it
    if pipeline.lang_code != lang_code:
        from kokoro import KPipeline
        pipeline = KPipeline(lang_code=lang_code, repo_id="hexgrad/Kokoro-82M")

    all_audio = []
    sentence_boundaries = []
    sample_offset = 0
    sr = 24000  # Kokoro default sample rate

    for i, sentence in enumerate(sentences):
        chunks = []
        for _gs, _ps, audio in pipeline(sentence, voice=voice, speed=req.speed):
            chunks.append(audio)

        if chunks:
            sentence_audio = np.concatenate(chunks)
            num_samples = len(sentence_audio)
            sentence_boundaries.append({
                "index": i,
                "text": sentence,
                "sampleOffset": sample_offset,
                "sampleCount": num_samples,
            })
            sample_offset += num_samples
            all_audio.append(sentence_audio)

    if not all_audio:
        raise HTTPException(status_code=500, detail="No audio generated")

    combined = np.concatenate(all_audio)
    # Convert to WAV bytes
    import soundfile as sf
    buf = io.BytesIO()
    sf.write(buf, combined, sr, format="WAV", subtype="PCM_16")
    buf.seek(0)

    boundaries_json = json.dumps(sentence_boundaries)
    from starlette.responses import Response
    return Response(
        content=buf.read(),
        media_type="audio/wav",
        headers={
            "X-Sentence-Boundaries": boundaries_json,
            "X-Sample-Rate": str(sr),
        },
    )


@app.websocket("/voice/stream")
async def voice_stream_ws(websocket: WebSocket):
    """
    WebSocket endpoint for real-time voice streaming.
    Receives raw PCM audio (16kHz, mono, float32) from the client.
    Sends back JSON messages:
      { "type": "vad", "event": "speech-start" | "speech-end" }
      { "type": "stt", "text": "...", "isFinal": false, "isPartial": true }
      { "type": "stt", "text": "...", "isFinal": true, "isPartial": false }
      { "type": "error", "message": "..." }
      { "type": "ready" }
    """
    await websocket.accept()

    language = websocket.query_params.get("language", LANGUAGE or "en")
    silence_threshold = float(websocket.query_params.get("silence", "1.5"))

    try:
        # Load voice models concurrently — run blocking loads in threads
        # so the event loop stays responsive and models init in parallel.
        _reload_tts_settings()
        loop = asyncio.get_running_loop()
        vad_future = loop.run_in_executor(None, _ensure_vad_loaded)
        stt_future = loop.run_in_executor(None, _ensure_stt_loaded)

        futures = [vad_future, stt_future]
        if _tts_provider == "kokoro":
            tts_future = loop.run_in_executor(None, _ensure_tts_loaded)
            futures.append(tts_future)

        results = await asyncio.gather(*futures)
        vad_data = results[0]
        stt_model = results[1]
        vad_model = vad_data['model']

        await websocket.send_json({"type": "ready"})

        # State
        audio_buffer = bytearray()
        speech_buffer = bytearray()
        is_speaking = False
        silence_start: float | None = None
        last_partial_time: float = 0.0
        PARTIAL_INTERVAL = 1.0  # Send partial transcription every 1s during speech
        SAMPLE_RATE = 16000
        CHUNK_SAMPLES = 512  # VAD window size
        MAX_SPEECH_SECONDS = 30  # Cap speech buffer to prevent runaway accumulation
        MAX_SPEECH_BYTES = MAX_SPEECH_SECONDS * SAMPLE_RATE * 4  # float32 = 4 bytes

        # Hallucination-filtering: common Whisper phantom phrases for short/silent input
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
            """Detect Whisper hallucinations: phantom phrases on very short audio."""
            stripped = text.strip().lower().rstrip("。！？.!?")
            # Very short audio producing long text is suspicious
            if audio_duration_s < 1.0 and len(stripped) > 5:
                return True
            for pattern in _HALLUCINATION_PATTERNS:
                if pattern in stripped:
                    return True
            return False

        async def _run_final_stt(buffer: bytearray) -> None:
            """Run final STT transcription on accumulated speech buffer."""
            buffer_bytes = bytes(buffer)
            if len(buffer_bytes) < int(SAMPLE_RATE * 4 * 0.3):
                return  # Too short — skip
            try:
                speech_np = np.frombuffer(buffer_bytes, dtype=np.float32)
                audio_duration = len(speech_np) / SAMPLE_RATE
                _voice_touch()
                segments, info = stt_model.transcribe(
                    speech_np,
                    language=language,
                    beam_size=5,
                    vad_filter=False,
                    condition_on_previous_text=False,
                    no_speech_threshold=0.6,
                    log_prob_threshold=-1.0,
                )
                final_text = " ".join(seg.text for seg in segments).strip()
                if final_text and not _is_hallucination(final_text, audio_duration):
                    await websocket.send_json({
                        "type": "stt",
                        "text": final_text,
                        "isFinal": True,
                        "isPartial": False,
                    })
            except Exception as e:
                _log("Final STT error:", e)
                await websocket.send_json({"type": "error", "message": str(e)})

        while True:
            try:
                raw_data = await asyncio.wait_for(websocket.receive(), timeout=30.0)
            except asyncio.TimeoutError:
                # Send keepalive ping to prevent connection drop
                try:
                    await websocket.send_json({"type": "ping"})
                except Exception:
                    break
                continue
            except WebSocketDisconnect:
                break

            # Handle both binary audio data and text commands
            if "text" in raw_data:
                try:
                    cmd = json.loads(raw_data["text"])
                    cmd_type = cmd.get("type", "")

                    if cmd_type == "flush":
                        # PTT release or explicit flush — immediately process buffered speech
                        if is_speaking and len(speech_buffer) > 0:
                            is_speaking = False
                            silence_start = None
                            await websocket.send_json({"type": "vad", "event": "speech-end"})
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

            # Process in VAD-sized chunks
            bytes_per_sample = 4  # float32
            chunk_bytes = CHUNK_SAMPLES * bytes_per_sample

            while len(audio_buffer) >= chunk_bytes:
                chunk_data = bytes(audio_buffer[:chunk_bytes])
                del audio_buffer[:chunk_bytes]

                samples = np.frombuffer(chunk_data, dtype=np.float32)
                _torch = importlib.import_module("torch") if torch is None else torch
                tensor = _torch.from_numpy(samples.copy())

                speech_prob = vad_model(tensor, SAMPLE_RATE).item()

                if speech_prob > 0.5:
                    if not is_speaking:
                        is_speaking = True
                        silence_start = None
                        speech_buffer = bytearray()
                        await websocket.send_json({"type": "vad", "event": "speech-start"})

                    speech_buffer.extend(chunk_data)

                    # Cap speech buffer to prevent unbounded growth
                    if len(speech_buffer) >= MAX_SPEECH_BYTES:
                        # Force-process what we have and reset
                        is_speaking = False
                        silence_start = None
                        await websocket.send_json({"type": "vad", "event": "speech-end"})
                        await _run_final_stt(speech_buffer)
                        speech_buffer = bytearray()
                        continue

                    # Periodic partial transcription
                    now = time.monotonic()
                    if now - last_partial_time > PARTIAL_INTERVAL and len(speech_buffer) > SAMPLE_RATE * bytes_per_sample:
                        last_partial_time = now
                        try:
                            speech_np = np.frombuffer(bytes(speech_buffer), dtype=np.float32)
                            segments, _ = stt_model.transcribe(
                                speech_np,
                                language=language,
                                beam_size=1,
                                vad_filter=False,
                                condition_on_previous_text=False,
                                no_speech_threshold=0.6,
                            )
                            partial_text = " ".join(seg.text for seg in segments).strip()
                            if partial_text and not _is_hallucination(partial_text, len(speech_np) / SAMPLE_RATE):
                                await websocket.send_json({
                                    "type": "stt",
                                    "text": partial_text,
                                    "isFinal": False,
                                    "isPartial": True,
                                })
                        except Exception as e:
                            _log("Partial STT error:", e)
                else:
                    if is_speaking:
                        speech_buffer.extend(chunk_data)
                        if silence_start is None:
                            silence_start = time.monotonic()
                        elif time.monotonic() - silence_start > silence_threshold:
                            # Speech ended — run final transcription
                            is_speaking = False
                            silence_start = None
                            await websocket.send_json({"type": "vad", "event": "speech-end"})
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


if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=7752, log_level="debug")
