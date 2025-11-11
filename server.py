# MODIFY THIS
LANGUAGE = ""
FETCH_ANKI = True
ANKI_CONNECT_URL = "http://127.0.0.1:8765"

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
print("Arguments: ", ANKI_CONNECT_URL, FETCH_ANKI, LANGUAGE)
LANGUAGE_DIR_PATH = os.path.join(RESPATH,"languages")


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
from fastapi.responses import JSONResponse
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
                dtype = torch.bfloat16 if hasattr(torch, "bfloat16") else torch.float32  # type: ignore[attr-defined]
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

@app.post("/fwd-to-anki")
async def fwd_to_anki(req: Request):

    # Get the body of the incoming request
    body = await req.json()

    # Forward the request to AnkiConnect
    requestJson = json.dumps(body).encode('utf-8')
    response = json.load(urllib.request.urlopen(urllib.request.Request(ANKI_CONNECT_URL, requestJson)))
    _log("Received response from AnkiConnect:", response)
    return response

@app.post("/quit")
def quit():
    _log("Received /quit; exiting shortly...")
    # Delay hard-exit slightly so the HTTP response doesn't get stream-closed prematurely
    def _shutdown():
        os._exit(0)
    threading.Timer(0.2, _shutdown).start()
    return {"response": "quitting"}


# --- OCR Support (PaddleOCR + MangaOCR) ---
_paddle_ocr = None
_manga_ocr = None


def _get_paddle_ocr():
    global _paddle_ocr
    if _paddle_ocr is not None:
        _log_ocr_init("PaddleOCR already initialized")
        return _paddle_ocr
    try:
        from paddleocr import PaddleOCR  # type: ignore
    except Exception as e:
        _log_ocr_init("PaddleOCR import error", e)
        return None
    # Use Japanese models if LANGUAGE == 'ja', else default to 'en'
    langs = {
        "de": "german",
        "ja": "japan",
        "en": "en",
        "ch": "ch",
        "ko": "korean",
        "fr": "french",
        "es": "spanish",
        "ru": "russian"
    }
    lang_code = langs.get(LANGUAGE, 'en')  # Default to 'en' if language not found
    # Log PaddlePaddle version if available
    try:
        import paddle  # type: ignore
        _log_ocr_init("PaddlePaddle version", getattr(paddle, "__version__", "unknown"))
    except Exception as e:
        _log_ocr_init("Paddle import/version error", e)
    _log_ocr_init("Initializing PaddleOCR with lang", lang_code)
    t0 = time.perf_counter()
    _paddle_ocr = PaddleOCR(lang=lang_code, use_angle_cls=True, use_doc_orientation_classify=False, use_doc_unwarping=False)
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
        # Older signatures may not accept cls
        res = paddle_inst.ocr(img)
        _log_ocr_run("paddle ocr produced (compat)", len(res) if isinstance(res, list) else 'n/a', "items")
        return res


def _get_manga_ocr():
    global _manga_ocr
    if _manga_ocr is not None:
        _log_ocr_init("MangaOCR already initialized")
        return _manga_ocr
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


def _extract_lines_from_paddle_result(result):
    """Normalize PaddleOCR result to a flat list of (box, text, score).
    Supports legacy list-based output and newer dict-based outputs that contain
    keys such as 'rec_texts', 'rec_scores', and (ideally) some polygon boxes.
    """
    if not result:
        print("_extract_lines_from_paddle_result: Empty result")
        return []

    # Use global numpy alias 'np' imported at module level

    # If it's a batch-of-one list, unwrap
    if isinstance(result, list) and len(result) == 1 and not isinstance(result[0], (list, tuple)):
        # Could be a dict inside
        result = result[0]

    # Handle dict-based output
    if isinstance(result, dict):
        print("_extract_lines_from_paddle_result: Detected dict-based output. Keys:", list(result.keys()))
        # Common fields
        texts = result.get('rec_texts') or result.get('texts')
        scores = result.get('rec_scores') or result.get('scores')

        # Try common box keys in order
        box_keys = [
            'text_det_polys', 'det_polys', 'dt_polys', 'polys',
            'text_region_polys', 'boxes', 'dt_boxes', 'det_boxes'
        ]
        boxes = None
        for k in box_keys:
            if k in result:
                boxes = result[k]
                print(f"_extract_lines_from_paddle_result: Found boxes under key '{k}' with count:", (len(boxes) if isinstance(boxes, (list, tuple)) else 'n/a'))
                break

        # If boxes not found, attempt to heuristically locate a list of polygon-like arrays
        if boxes is None:
            for k, v in result.items():
                if isinstance(v, (list, tuple)) and len(v) > 0:
                    first = v[0]
                    try:
                        arr = np.array(first)
                        if arr.ndim == 2 and arr.shape[1] == 2 and arr.shape[0] >= 4:
                            boxes = v
                            print(f"_extract_lines_from_paddle_result: Heuristically using key '{k}' for boxes; count:", len(v))
                            break
                    except Exception:
                        pass

        if texts is None:
            print("_extract_lines_from_paddle_result: No 'rec_texts'/'texts' found.")
        else:
            print("_extract_lines_from_paddle_result: Text count:", len(texts))
        if isinstance(boxes, (list, tuple)):
            print("_extract_lines_from_paddle_result: Box count:", len(boxes))
        else:
            print("_extract_lines_from_paddle_result: Boxes missing or not a sequence.")

        # If we have both texts and boxes, pair them by index
        flat: list[tuple] = []
        try:
            if texts is not None and isinstance(boxes, (list, tuple)) and len(boxes) > 0:
                n = min(len(texts), len(boxes))
                for i in range(n):
                    pts = boxes[i]
                    # normalize to list of [x,y]
                    if isinstance(pts, np.ndarray):
                        pts = pts.tolist()
                    # Some formats might be [[x1,y1,x2,y2,...]] -> convert to [[x,y],...]
                    if pts and isinstance(pts[0], (int, float)) and len(pts) % 2 == 0:
                        pts = [[float(pts[j]), float(pts[j+1])] for j in range(0, len(pts), 2)]
                    # Ensure it's a list of pairs
                    pts = [[float(x), float(y)] for x, y in pts]
                    txt = str(texts[i])
                    scr = float(scores[i]) if scores is not None and i < len(scores) else None
                    flat.append((pts, txt, scr))
                return flat
            # If we only have texts, return without boxes (caller can decide fallback)
            if texts is not None:
                return [(None, str(t), float(scores[i]) if scores is not None and i < len(scores) else None) for i, t in enumerate(texts)]
        except Exception as e:
            print("_extract_lines_from_paddle_result: Exception while pairing dict-based output:", e)
            return []

        return []

    # Handle legacy list-based outputs
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
            # Expected: item[0] = points, item[1] = (text, score)
            pts = item[0]
            txt, scr = None, None
            if len(item) > 1 and isinstance(item[1], (list, tuple)) and len(item[1]) >= 2:
                txt, scr = item[1][0], float(item[1][1])
            flat.append((pts, txt, scr))
    except Exception as e:
        print(f"Failed to parse PaddleOCR lines. Error: {e}. Data was: {lines}")
        return []
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


class OcrResponse(BaseModel):
    boxes: List[OcrBox]


@app.post("/ocr", response_model=OcrResponse)
async def ocr_endpoint(
    file: UploadFile | None = File(None),
    image_base64: str | None = Form(None)
):
    _log_ocr_run("Loading Neural Network")
    _process_stats("ocr_req")
    try:
        # Load image
        # if file is not None:
        #     _log_ocr_run("UploadFile", {"filename": file.filename, "content_type": file.content_type})
        file_bytes = await file.read() if file is not None else None
        image = _load_image_from_inputs(file_bytes, image_base64)
        np_img = np.array(image, dtype=np.uint8)
        if not np_img.flags['C_CONTIGUOUS']:
            np_img = np.ascontiguousarray(np_img)
        # _log_ocr_run("Image numpy shape", np_img.shape, "dtype", str(np_img.dtype), "contiguous", np_img.flags['C_CONTIGUOUS'])

        # Init paddle
        t0 = time.perf_counter()
        paddle = _get_paddle_ocr()
        t1 = time.perf_counter()
        if paddle is None:
            raise HTTPException(status_code=500, detail="PaddleOCR not available")
        _log_ocr_run(f"Paddle handle ready in {t1 - t0:.2f}s")
        # _log_ocr_run(f"OCR requested for language {LANGUAGE}")
        _log_ocr_run(f"Recognizing text positions...")

        results: list[OcrBox] = []

        if LANGUAGE == 'ja':
            # Detection with Paddle, recognition with MangaOCR
            H, W = int(np_img.shape[0]), int(np_img.shape[1])
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
            _log_ocr_run(f"Paddle detection {t3 - t2:.2f}s")
            lines = _extract_lines_from_paddle_result(det)
            _log_ocr_run(f"Extracted {len(lines)} lines (det stage)")
            initial_boxes = [item[0] for item in lines if item and item[0] is not None]
            if scale != 1.0 and initial_boxes:
                inv = 1.0 / scale
                initial_boxes = [[[float(x)*inv, float(y)*inv] for x, y in pts] for pts in initial_boxes]
            _log_ocr_run(f"Found {len(initial_boxes)} boxes after rescale")
            mocr = _get_manga_ocr()
            if mocr is None:
                raise HTTPException(status_code=500, detail="MangaOCR not available")
            if not initial_boxes:
                try:
                    full_txt = mocr(image) or ''
                    w, h = image.size
                    full_box = [[0.0,0.0],[float(w),0.0],[float(w),float(h)],[0.0,float(h)]]
                    results.append(OcrBox(box=full_box, text=full_txt, score=None))
                    _log_ocr_run(f"Full-image fallback len={len(full_txt)}")
                except Exception as e:
                    _log_ocr_run("Full-image fallback error", e)
            else:
                for i, pts in enumerate(initial_boxes):
                    crop = _crop_by_box(image, pts)
                    try:
                        txt = mocr(crop) or ''
                        # if i % 10 == 0:
                        _log_ocr_run(f"Recognition progress {i+1}/{len(initial_boxes)}")
                    except Exception as e:
                        _log_ocr_run(f"MangaOCR error box {i+1}", e)
                        txt = ''
                    results.append(OcrBox(box=[[float(x),float(y)] for x,y in pts], text=txt, score=None))
        else:
            # Use paddle for detection + recognition
            t2 = time.perf_counter()
            out = _paddle_run_ocr(paddle, np_img)
            t3 = time.perf_counter()
            _log_ocr_run(f"Paddle e2e {t3 - t2:.2f}s")
            lines = _extract_lines_from_paddle_result(out)
            _log_ocr_run(f"Extracted {len(lines)} lines (e2e)")
            for i, (pts, txt, scr) in enumerate(lines):
                if pts is None:
                    continue
                if i % 25 == 0:
                    _log_ocr_run(f"Recognition progress {i+1}/{len(lines)}")
                results.append(OcrBox(box=[[float(x),float(y)] for x,y in pts], text=str(txt or ''), score=(float(scr) if scr is not None else None)))

        _log_ocr_run(f"Final boxes {len(results)}")
        _process_stats("ocr_done")
        return {"boxes": [r.dict(exclude_none=True) for r in results]}
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
    _log("LLM request", {"chars": len(req.prompt), "max_new_tokens": req.max_new_tokens})
    try:
        _ensure_llm_loaded()
    except RuntimeError as exc:
        _log("LLM init error", exc)
        raise HTTPException(status_code=500, detail=str(exc))

    if torch is None or _llm_tokenizer is None or _llm_model is None:
        raise HTTPException(status_code=500, detail="LLM unavailable")

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



if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=7752, log_level="debug")
