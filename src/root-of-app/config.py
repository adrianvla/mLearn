"""
Global configuration for the mLearn Python backend.

Parses CLI arguments, reads settings.json, loads language modules,
and exposes all global state used by route modules.
"""

import json
import os
import sys
import importlib
import inspect
import platform

import plugin_registry
from logging_utils import get_logger

log = get_logger("config")

ROOT_OF_APP_DIR = os.path.dirname(os.path.abspath(__file__))

# ── Defaults (overridden by CLI args) ──
LANGUAGE = ""
LLM_ALLOWED = True
OCR_ALLOWED = True
RESPATH = ""
USER_DATA_PATH = ""
CACHE_PATH = ""
LANGUAGE_DIR_PATH = ""

OCR_RAM_SAVER = False
SUPPORTS_VERTICAL_TEXT = False

QUIT_TOKEN = ""

# Lazily populated heavy imports (avoid startup cost)
torch = None  # type: ignore


def _load_language_module(language_module, resource_path: str, cache_path: str) -> None:
    """Load a language module, passing a mutable cache path when it supports one."""
    load_module = language_module.LOAD_MODULE
    signature = inspect.signature(load_module)
    accepts_varargs = any(
        param.kind == inspect.Parameter.VAR_POSITIONAL
        for param in signature.parameters.values()
    )
    positional_params = [
        param
        for param in signature.parameters.values()
        if param.kind
        in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
    ]

    if accepts_varargs or len(positional_params) >= 2:
        load_module(resource_path, cache_path)
    else:
        load_module(resource_path)


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
            log.info(f"Raised RLIMIT_NOFILE from {_soft} to {_desired} (hard={_hard})")
        else:
            log.info(f"RLIMIT_NOFILE already sufficient: soft={_soft} hard={_hard}")
    except Exception as _rlimit_err:
        log.warning(f"Could not adjust RLIMIT_NOFILE: {_rlimit_err}")


def _configure_utf8_streams():
    """Ensure printing non-ASCII (e.g. Japanese) won't crash on Windows consoles."""
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        try:
            import io

            sys.stdout = io.TextIOWrapper(
                sys.stdout.buffer,
                encoding="utf-8",
                errors="replace",  # type: ignore[attr-defined]
            )
            sys.stderr = io.TextIOWrapper(
                sys.stderr.buffer,
                encoding="utf-8",
                errors="replace",  # type: ignore[attr-defined]
            )
        except Exception:
            pass


def init():
    """Parse CLI arguments, read settings.json, and import language module.

    Must be called once at process startup before any route modules.
    """
    global LANGUAGE, LLM_ALLOWED, OCR_ALLOWED
    global RESPATH, USER_DATA_PATH, CACHE_PATH, LANGUAGE_DIR_PATH
    global OCR_RAM_SAVER, SUPPORTS_VERTICAL_TEXT

    _raise_fd_limit()
    _configure_utf8_streams()

    arguments = sys.argv[1:]
    log.info(f"Arguments:  {arguments}")

    LANGUAGE = arguments[0]
    RESPATH = arguments[1]
    if len(arguments) >= 3:
        LLM_ALLOWED = str(arguments[2]).lower() == "true"
    if len(arguments) >= 4:
        OCR_ALLOWED = str(arguments[3]).lower() == "true"

    if len(arguments) >= 5:
        USER_DATA_PATH = arguments[4]

    CACHE_PATH = (
        os.path.join(USER_DATA_PATH, "cache")
        if USER_DATA_PATH
        else os.path.join(os.path.expanduser("~"), ".mlearn", "cache")
    )

    # Read OCR config from settings.json
    if USER_DATA_PATH:
        settings_path = os.path.join(USER_DATA_PATH, "settings.json")
        if os.path.exists(settings_path):
            try:
                with open(settings_path, "r", encoding="utf-8") as f:
                    settings = json.load(f)
                    OCR_RAM_SAVER = settings.get("ocrRamSaver", False)
                    log.info(f"OCR Ram Saver: {OCR_RAM_SAVER}")
            except Exception as e:
                log.error(f"Error reading settings.json: {e}", exc_info=True)

    log.info(f"Arguments:  {LANGUAGE}")
    log.info(f"LLM allowed: {LLM_ALLOWED}")
    log.info(f"OCR allowed: {OCR_ALLOWED}")

    LANGUAGE_DIR_PATH = os.path.join(ROOT_OF_APP_DIR, "languages")

    # Read language-specific config from the JSON file next to the .py module.
    _lang_json_path = os.path.join(LANGUAGE_DIR_PATH, f"{LANGUAGE}.json")
    if os.path.isfile(_lang_json_path):
        try:
            with open(_lang_json_path, "r", encoding="utf-8") as _lf:
                _lang_cfg = json.load(_lf)
                SUPPORTS_VERTICAL_TEXT = bool(
                    _lang_cfg.get("supportsVerticalText", False)
                )
        except Exception as _e:
            log.warning(f"Warning: failed to read {_lang_json_path}: {_e}")
    log.info(f"Supports vertical text: {SUPPORTS_VERTICAL_TEXT}")
    log.info(f"Language dir path:  {LANGUAGE_DIR_PATH}")

    # Load and register built-in language module
    if LANGUAGE_DIR_PATH not in sys.path:
        sys.path.append(LANGUAGE_DIR_PATH)
    _lang_mod = importlib.import_module(LANGUAGE)
    _load_language_module(_lang_mod, ROOT_OF_APP_DIR, CACHE_PATH)
    plugin_registry.register_language(LANGUAGE, _lang_mod)
    plugin_registry.set_active(LANGUAGE)
    log.info(f"[config] Registered built-in language: {LANGUAGE}")


def get_runtime_info() -> dict:
    """Return a dict of runtime information for logging."""
    return {
        "LANGUAGE": LANGUAGE,
        "RESPATH": RESPATH,
        "python": platform.python_version(),
        "platform": platform.platform(),
    }
