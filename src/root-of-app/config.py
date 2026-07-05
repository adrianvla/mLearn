"""
Global configuration for the mLearn Python backend.

Parses CLI arguments, reads settings.json, loads language modules,
and exposes all global state used by route modules.
"""

import json
import os
import re
import sys
import importlib.util
import inspect
import platform

import plugin_registry
from generic_language import GenericLanguageModule
from logging_utils import get_logger

log = get_logger("config")

ROOT_OF_APP_DIR = os.path.dirname(os.path.abspath(__file__))

# ── Defaults (overridden by CLI args) ──
LANGUAGE = ""
LLM_ALLOWED = True
OCR_ALLOWED = True
RESPATH = ""
USER_DATA_PATH = ""
LANGUAGE_DATA_PATH = ""
LANGUAGE_DIR_PATH = ""

OCR_RAM_SAVER = False
SUPPORTS_VERTICAL_TEXT = False
LANGUAGE_METADATA: dict = {}

QUIT_TOKEN = ""

# Lazily populated heavy imports (avoid startup cost)
torch = None  # type: ignore


def _load_language_module(language_module, resource_path: str, language_data_path: str) -> None:
    """Load a language module, passing the per-user language data root when supported."""
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
        load_module(resource_path, language_data_path)
    else:
        load_module(resource_path)


def _language_module_search_paths(language_data_path: str) -> list[str]:
    return [os.path.join(language_data_path, "adapters")]


def _language_metadata_path(language_data_path: str, language: str) -> str:
    return os.path.join(language_data_path, "languages", f"{language}.json")


def _language_metadata_declares_python_adapter(metadata: dict) -> bool:
    adapter = _language_metadata_python_adapter_config(metadata)
    return isinstance(adapter, dict) and adapter.get("type") == "python-module"


def _language_metadata_python_adapter_config(metadata: dict) -> dict:
    runtime = metadata.get("runtime", {})
    if not isinstance(runtime, dict):
        return {}
    adapter = runtime.get("adapter", {})
    if isinstance(adapter, dict) and adapter.get("type") == "python-module":
        return adapter
    nlp = runtime.get("nlp", {})
    if not isinstance(nlp, dict):
        return {}
    adapter = nlp.get("adapter", {})
    return adapter if isinstance(adapter, dict) else {}


def _declared_language_adapter_path(language_data_path: str, language: str, metadata: dict) -> str:
    adapter = _language_metadata_python_adapter_config(metadata)
    configured_path = adapter.get("path")
    if not isinstance(configured_path, str) or not configured_path.strip():
        raise ValueError(f"Python language adapter path is required for {language}")
    relative_path = configured_path.strip()
    if os.path.isabs(relative_path):
        raise ValueError(f"Invalid language adapter path for {language}: {relative_path!r}")
    normalized = os.path.normpath(relative_path)
    if normalized == ".." or normalized.startswith(f"..{os.path.sep}"):
        raise ValueError(f"Invalid language adapter path for {language}: {relative_path!r}")
    if os.path.basename(normalized) in {"", ".", ".."} or not normalized.endswith(".py"):
        raise ValueError(f"Invalid language adapter path for {language}: {relative_path!r}")
    root = os.path.realpath(language_data_path)
    candidate = os.path.realpath(os.path.join(language_data_path, normalized))
    if os.path.commonpath([root, candidate]) != root:
        raise ValueError(f"Invalid language adapter path for {language}: {relative_path!r}")
    return candidate


def _language_adapter_module_name(language: str) -> str:
    safe_name = re.sub(r"[^A-Za-z0-9_]", "_", language)
    return f"_mlearn_language_{safe_name}"


def _read_language_metadata_from_path(language_data_path: str, language: str) -> dict:
    if not language or not _is_safe_language_id(language) or not language_data_path:
        return {}
    metadata_path = _language_metadata_path(language_data_path, language)
    if not os.path.isfile(metadata_path):
        return {}
    try:
        with open(metadata_path, "r", encoding="utf-8") as metadata_file:
            data = json.load(metadata_file)
        return data if isinstance(data, dict) else {}
    except Exception as exc:
        log.warning(f"Warning: failed to read {metadata_path}: {exc}")
        return {}


def _read_language_metadata(language: str) -> dict:
    return _read_language_metadata_from_path(LANGUAGE_DATA_PATH, language)


def _metadata_for_language(language: str) -> dict:
    installed_metadata = _read_language_metadata(language)
    if installed_metadata:
        if language == LANGUAGE:
            global LANGUAGE_METADATA
            LANGUAGE_METADATA = installed_metadata
        return installed_metadata
    return LANGUAGE_METADATA if language == LANGUAGE else {}


def _language_metadata_fingerprint(metadata: dict) -> str:
    try:
        return json.dumps(metadata if isinstance(metadata, dict) else {}, sort_keys=True, separators=(",", ":"))
    except Exception:
        return ""


def _is_safe_language_id(language: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9_-]{1,32}", language or ""))


def _import_language_module(language: str, language_data_path: str, metadata: dict | None = None):
    """Import an installed Python language adapter, or use the metadata adapter."""
    if not _is_safe_language_id(language):
        raise ValueError(f"Invalid language id: {language!r}")
    metadata = metadata if isinstance(metadata, dict) else _read_language_metadata_from_path(language_data_path, language)
    if not metadata or not _language_metadata_declares_python_adapter(metadata):
        log.info(
            "Language metadata for %s does not request a Python adapter; using metadata-driven generic adapter",
            language,
        )
        return GenericLanguageModule(language)

    module_path = _declared_language_adapter_path(language_data_path, language, metadata)
    if not os.path.isfile(module_path):
        raise RuntimeError(f"Declared Python adapter for {language} is not installed: {module_path}")

    for language_path in reversed([os.path.dirname(module_path), *_language_module_search_paths(language_data_path)]):
        if os.path.isdir(language_path) and language_path not in sys.path:
            sys.path.insert(0, language_path)

    module_name = _language_adapter_module_name(language)
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load language adapter for {language}: {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(module_name, None)
        raise
    return module


def get_or_load_language(language: str):
    """Return a registered language adapter, loading installed metadata/modules on demand."""
    if not language or not _is_safe_language_id(language):
        return None
    if not LANGUAGE_DATA_PATH:
        return None
    metadata_path = _language_metadata_path(LANGUAGE_DATA_PATH, language)
    if not os.path.isfile(metadata_path):
        return None
    metadata = _read_language_metadata(language)
    fingerprint = _language_metadata_fingerprint(metadata)
    existing = plugin_registry.get_language(language)
    if existing is not None and getattr(existing, "__mlearn_metadata_fingerprint", None) == fingerprint:
        return existing
    lang_mod = _import_language_module(language, LANGUAGE_DATA_PATH, metadata)
    _load_language_module(lang_mod, ROOT_OF_APP_DIR, LANGUAGE_DATA_PATH)
    setattr(lang_mod, "__mlearn_metadata_fingerprint", fingerprint)
    plugin_registry.register_language(language, lang_mod)
    if language == LANGUAGE:
        global LANGUAGE_METADATA
        LANGUAGE_METADATA = metadata
    return lang_mod


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
    """Ensure printing non-ASCII language text won't crash on Windows consoles."""
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
    global RESPATH, USER_DATA_PATH, LANGUAGE_DATA_PATH, LANGUAGE_DIR_PATH
    global OCR_RAM_SAVER, SUPPORTS_VERTICAL_TEXT, LANGUAGE_METADATA

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

    if len(arguments) >= 6:
        LANGUAGE_DATA_PATH = arguments[5]
    else:
        LANGUAGE_DATA_PATH = (
            os.path.join(USER_DATA_PATH, "language-data")
            if USER_DATA_PATH
            else os.path.join(os.path.expanduser("~"), ".mlearn", "language-data")
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

    LANGUAGE_DIR_PATH = os.path.join(LANGUAGE_DATA_PATH, "languages")

    # Read language-specific config from installed on-demand language data.
    LANGUAGE_METADATA = _read_language_metadata(LANGUAGE)
    SUPPORTS_VERTICAL_TEXT = language_supports_vertical_text_for_language(LANGUAGE)
    log.info(f"Supports vertical text: {SUPPORTS_VERTICAL_TEXT}")
    log.info(f"Language dir path:  {LANGUAGE_DIR_PATH}")

    # Load and register the installed language adapter. Packages may either
    # provide a Python module or rely entirely on metadata-driven bricks.
    _lang_mod = get_or_load_language(LANGUAGE)
    if _lang_mod is None:
        log.warning(
            "Language data is not installed for %s; backend will start without an active language",
            LANGUAGE,
        )
        return
    plugin_registry.set_active(LANGUAGE)
    log.info(f"[config] Registered language: {LANGUAGE}")


def language_runtime_config(section: str | None = None) -> dict:
    """Return backend runtime hints from the installed language metadata."""
    return language_runtime_config_for_language(LANGUAGE, section)


def language_runtime_config_for_language(language: str, section: str | None = None) -> dict:
    """Return backend runtime hints for any installed language."""
    metadata = _metadata_for_language(language)
    runtime = metadata.get("runtime", {})
    if not isinstance(runtime, dict):
        return {}
    if section is None:
        return runtime
    value = runtime.get(section, {})
    return value if isinstance(value, dict) else {}


def language_text_processing_config_for_language(language: str) -> dict:
    """Return text-processing hints for any installed language."""
    metadata = _metadata_for_language(language)
    text_processing = metadata.get("textProcessing", {})
    return text_processing if isinstance(text_processing, dict) else {}


def language_supports_vertical_text_for_language(language: str) -> bool:
    ocr_config = language_runtime_config_for_language(language, "ocr")
    if isinstance(ocr_config.get("supportsVerticalText"), bool):
        return bool(ocr_config["supportsVerticalText"])
    return False


def language_supports_vertical_text() -> bool:
    return language_supports_vertical_text_for_language(LANGUAGE)


def language_supports_ocr_ram_saver_for_language(language: str) -> bool:
    ocr_config = language_runtime_config_for_language(language, "ocr")
    if isinstance(ocr_config.get("supportsRamSaver"), bool):
        return bool(ocr_config["supportsRamSaver"])
    return False


def get_runtime_info() -> dict:
    """Return a dict of runtime information for logging."""
    return {
        "LANGUAGE": LANGUAGE,
        "RESPATH": RESPATH,
        "python": platform.python_version(),
        "platform": platform.platform(),
    }
