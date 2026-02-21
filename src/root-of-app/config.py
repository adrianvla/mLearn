"""
Global configuration for the mLearn Python backend.

Parses CLI arguments, reads settings.json, loads language modules,
and exposes all global state used by route modules.
"""
import json
import os
import sys
import importlib
import platform

# ── Defaults (overridden by CLI args) ──
LANGUAGE = ""
FETCH_ANKI = True
ANKI_CONNECT_URL = "http://127.0.0.1:8765"
LLM_ALLOWED = True
OCR_ALLOWED = True
RESPATH = ""
USER_DATA_PATH = ""
LANGUAGE_DIR_PATH = ""

ANKI_FIELD_EXPRESSION = "Expression"
ANKI_FIELD_READING = "Reading"
ANKI_FIELD_MEANING = "Meaning"
OCR_RAM_SAVER = False
SUPPORTS_VERTICAL_TEXT = False

language_module = None

# Lazily populated heavy imports (avoid startup cost)
torch = None  # type: ignore


def _raise_fd_limit():
    """Raise the per-process file-descriptor limit as early as possible.

    MangaOCR + transformers + torch + ONNX together open thousands of
    files; macOS defaults (256–2560) are too low and cause ENFILE/EMFILE
    crashes.
    """
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


def _configure_utf8_streams():
    """Ensure printing non-ASCII (e.g. Japanese) won't crash on Windows consoles."""
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        try:
            import io
            sys.stdout = io.TextIOWrapper(
                sys.stdout.buffer, encoding='utf-8', errors='replace'  # type: ignore[attr-defined]
            )
            sys.stderr = io.TextIOWrapper(
                sys.stderr.buffer, encoding='utf-8', errors='replace'  # type: ignore[attr-defined]
            )
        except Exception:
            pass


def init():
    """Parse CLI arguments, read settings.json, and import language module.

    Must be called once at process startup before any route modules.
    """
    global LANGUAGE, FETCH_ANKI, ANKI_CONNECT_URL, LLM_ALLOWED, OCR_ALLOWED
    global RESPATH, USER_DATA_PATH, LANGUAGE_DIR_PATH
    global ANKI_FIELD_EXPRESSION, ANKI_FIELD_READING, ANKI_FIELD_MEANING
    global OCR_RAM_SAVER, SUPPORTS_VERTICAL_TEXT
    global language_module

    _raise_fd_limit()
    _configure_utf8_streams()

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

    if len(arguments) >= 7:
        USER_DATA_PATH = arguments[6]

    # Read Anki field mappings and OCR config from settings.json
    if USER_DATA_PATH:
        settings_path = os.path.join(USER_DATA_PATH, "settings.json")
        if os.path.exists(settings_path):
            try:
                with open(settings_path, 'r', encoding='utf-8') as f:
                    settings = json.load(f)
                    ANKI_FIELD_EXPRESSION = settings.get(
                        "anki_field_expression", "Expression"
                    )
                    ANKI_FIELD_READING = settings.get(
                        "anki_field_reading", "Reading"
                    )
                    ANKI_FIELD_MEANING = settings.get(
                        "anki_field_meaning", "Meaning"
                    )
                    OCR_RAM_SAVER = settings.get("ocrRamSaver", False)
                    print(
                        f"Loaded Anki field mappings: Expression="
                        f"'{ANKI_FIELD_EXPRESSION}', Reading="
                        f"'{ANKI_FIELD_READING}', Meaning="
                        f"'{ANKI_FIELD_MEANING}'"
                    )
                    print(f"OCR Ram Saver: {OCR_RAM_SAVER}")
            except Exception as e:
                print(f"Error reading settings.json: {e}")

    print("Arguments: ", ANKI_CONNECT_URL, FETCH_ANKI, LANGUAGE)
    print("LLM allowed:", LLM_ALLOWED)
    print("OCR allowed:", OCR_ALLOWED)

    LANGUAGE_DIR_PATH = os.path.join(RESPATH, "languages")

    # Read language-specific config from the JSON file next to the .py module.
    _lang_json_path = os.path.join(LANGUAGE_DIR_PATH, f"{LANGUAGE}.json")
    if os.path.isfile(_lang_json_path):
        try:
            with open(_lang_json_path, 'r', encoding='utf-8') as _lf:
                _lang_cfg = json.load(_lf)
                SUPPORTS_VERTICAL_TEXT = bool(
                    _lang_cfg.get("supportsVerticalText", False)
                )
        except Exception as _e:
            print(f"Warning: failed to read {_lang_json_path}: {_e}")
    print("Supports vertical text:", SUPPORTS_VERTICAL_TEXT)
    print("Language dir path: ", LANGUAGE_DIR_PATH)

    # Load language module
    sys.path.append(LANGUAGE_DIR_PATH)
    language_module = importlib.import_module(LANGUAGE)
    language_module.LOAD_MODULE(RESPATH)
    print(language_module)


def get_runtime_info() -> dict:
    """Return a dict of runtime information for logging."""
    return {
        "LANGUAGE": LANGUAGE,
        "RESPATH": RESPATH,
        "ANKI_CONNECT_URL": ANKI_CONNECT_URL,
        "FETCH_ANKI": FETCH_ANKI,
        "python": platform.python_version(),
        "platform": platform.platform(),
    }
