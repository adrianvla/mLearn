"""
Structured logging + crash handling for the mLearn Python backend.

Two output sinks:

1. **stdout** — machine-parsable lines consumed by the Electron main process.
   Format: ``::STATUS::v2::<LEVEL>::<MODULE>::<TIMESTAMP>::<MESSAGE>``
   A v1 fallback (``::STATUS::<CHANNEL>::<TS>::<MSG>``) is also emitted for
   channels that the Electron side routes by name (e.g. OCR/OCR-INIT).

2. **rotating files** — written under ``<USER_DATA>/logs/``:
     - ``python.log``        — all levels, rotated (5 MB × 5)
     - ``python_crash.log``  — uncaught exceptions, signals, atexit, faulthandler

Public API:

    log = get_logger("ocr.init")
    log.info("Loading model %s", name)
    log.warning("...")
    log.error("...", exc_info=True)

    install_crash_handler(user_data_path)        # call once at startup
    set_log_dir(user_data_path)                  # configures file handlers
    _log("legacy message")                        # back-compat shim
"""
from __future__ import annotations

import atexit
import logging
import os
import platform
import signal
import sys
import threading
import time
import traceback
from logging.handlers import RotatingFileHandler
from typing import Optional


# ────────────────────────────────────────────────────────────────────────────
# Constants
# ────────────────────────────────────────────────────────────────────────────

LOG_PATTERN_PREFIX = "::STATUS::"
LOG_PATTERN_VERSION = "v2"

# Map Python logging levels to short tags surfaced to Electron
_LEVEL_TAG = {
    logging.DEBUG: "DEBUG",
    logging.INFO: "INFO",
    logging.WARNING: "WARN",
    logging.ERROR: "ERROR",
    logging.CRITICAL: "FATAL",
}

# Legacy channel names that the Electron main process routes specially
# (preserved so OCR_STATUS_UPDATE, etc. keep working).
_LEGACY_CHANNEL_FOR_MODULE = {
    "ocr": "OCR",
    "ocr.init": "OCR-INIT",
    "ocr.run": "OCR-RUN",
    "ocr.dl": "OCR-DL",
    "anki": "ANKI",
}

ROOT_LOGGER_NAME = "mlearn"


_log_dir: Optional[str] = None
_crash_log_path: Optional[str] = None
_crash_log_fp = None  # type: ignore[assignment]
_initialized = False
_lock = threading.Lock()


# ────────────────────────────────────────────────────────────────────────────
# Formatter — emits the ::STATUS::v2 protocol on stdout
# ────────────────────────────────────────────────────────────────────────────


class _StatusFormatter(logging.Formatter):
    """Formats records as ``::STATUS::v2::LEVEL::MODULE::TS::MSG``.

    Newlines in the message are replaced with ``\\n`` literals so each log
    record stays on a single line (Electron parses by linebreak). Multi-line
    tracebacks are appended after ``\\n``.
    """

    def format(self, record: logging.LogRecord) -> str:
        try:
            msg = record.getMessage()
        except Exception:
            try:
                msg = repr(record.msg)
            except Exception:
                msg = "<unformattable log record>"

        if record.exc_info:
            try:
                exc_text = "".join(traceback.format_exception(*record.exc_info))
                msg = f"{msg}\n{exc_text.rstrip()}"
            except Exception:
                pass

        msg = msg.replace("\\", "\\\\").replace("\n", "\\n")

        level_tag = _LEVEL_TAG.get(record.levelno, record.levelname)
        module = record.name
        if module.startswith(ROOT_LOGGER_NAME + "."):
            module = module[len(ROOT_LOGGER_NAME) + 1 :]
        elif module == ROOT_LOGGER_NAME:
            module = "general"

        ts = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(record.created))
        return f"{LOG_PATTERN_PREFIX}{LOG_PATTERN_VERSION}::{level_tag}::{module}::{ts}::{msg}"


class _FileFormatter(logging.Formatter):
    """Human-friendly file format with full tracebacks expanded."""

    def format(self, record: logging.LogRecord) -> str:
        ts = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(record.created))
        ms = int((record.created - int(record.created)) * 1000)
        try:
            msg = record.getMessage()
        except Exception:
            msg = repr(record.msg)
        head = (
            f"{ts}.{ms:03d} {record.levelname:<7} "
            f"[{record.name}] (pid={record.process} tid={record.thread}) {msg}"
        )
        if record.exc_info:
            try:
                head += "\n" + "".join(traceback.format_exception(*record.exc_info)).rstrip()
            except Exception:
                pass
        return head


# ────────────────────────────────────────────────────────────────────────────
# Initialisation
# ────────────────────────────────────────────────────────────────────────────


def _ensure_root_initialised() -> logging.Logger:
    """Configure the root mLearn logger once with the stdout handler.

    File handlers are added later via :func:`set_log_dir` — at startup we may
    not yet know the userData path.
    """
    global _initialized
    root = logging.getLogger(ROOT_LOGGER_NAME)
    if _initialized:
        return root
    with _lock:
        if _initialized:
            return root
        root.setLevel(logging.DEBUG)
        root.propagate = False

        stdout_handler = logging.StreamHandler(stream=sys.stdout)
        stdout_handler.setLevel(logging.DEBUG)
        stdout_handler.setFormatter(_StatusFormatter())
        root.addHandler(stdout_handler)

        _initialized = True
    return root


def get_logger(module: str = "general") -> logging.Logger:
    """Return a module-scoped logger. Use dotted names: ``ocr.init``, ``voice.tts``."""
    _ensure_root_initialised()
    if not module:
        module = "general"
    return logging.getLogger(f"{ROOT_LOGGER_NAME}.{module}")


def set_log_dir(user_data_path: Optional[str]) -> Optional[str]:
    """Attach a rotating file handler under ``<user_data_path>/logs/``.

    Safe to call multiple times — replaces existing file handlers. Returns the
    resolved log directory, or ``None`` if no path was given.
    """
    global _log_dir, _crash_log_path
    if not user_data_path:
        return None

    log_dir = os.path.join(user_data_path, "logs")
    try:
        os.makedirs(log_dir, exist_ok=True)
    except Exception as e:
        get_logger("logging").error("Failed to create log dir %s: %s", log_dir, e)
        return None

    root = _ensure_root_initialised()

    for h in list(root.handlers):
        if isinstance(h, RotatingFileHandler):
            try:
                h.close()
            except Exception:
                pass
            root.removeHandler(h)

    log_path = os.path.join(log_dir, "python.log")
    file_handler = RotatingFileHandler(
        log_path,
        maxBytes=5 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
        delay=True,
    )
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(_FileFormatter())
    root.addHandler(file_handler)

    _log_dir = log_dir
    _crash_log_path = os.path.join(log_dir, "python_crash.log")
    get_logger("logging").info(
        "Logging initialised: file=%s crash=%s", log_path, _crash_log_path
    )
    return log_dir


def get_log_dir() -> Optional[str]:
    return _log_dir


def get_crash_log_path() -> Optional[str]:
    return _crash_log_path


# ────────────────────────────────────────────────────────────────────────────
# Crash handler
# ────────────────────────────────────────────────────────────────────────────


def _write_crash_record(header: str, body: str) -> None:
    """Append a structured crash record to crash log + stderr + status stream."""
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    record = (
        f"\n{'=' * 70}\n"
        f"[{ts}] {header}\n"
        f"pid={os.getpid()} python={platform.python_version()} "
        f"platform={platform.platform()}\n"
        f"{'=' * 70}\n"
        f"{body}\n"
    )

    if _crash_log_path:
        try:
            with open(_crash_log_path, "a", encoding="utf-8") as f:
                f.write(record)
                f.flush()
        except Exception:
            pass

    try:
        sys.stderr.write(record)
        sys.stderr.flush()
    except Exception:
        pass

    try:
        get_logger("crash").critical("%s | %s", header, body.replace("\n", " | ")[:2000])
    except Exception:
        pass


def _excepthook(exc_type, exc_value, exc_tb) -> None:
    if issubclass(exc_type, (KeyboardInterrupt, SystemExit)):
        sys.__excepthook__(exc_type, exc_value, exc_tb)
        return
    body = "".join(traceback.format_exception(exc_type, exc_value, exc_tb))
    _write_crash_record(f"UNCAUGHT EXCEPTION: {exc_type.__name__}: {exc_value}", body)


def _thread_excepthook(args) -> None:
    if args.exc_type is SystemExit:
        return
    body = "".join(
        traceback.format_exception(args.exc_type, args.exc_value, args.exc_traceback)
    )
    thread_name = getattr(args.thread, "name", "?") if args.thread else "?"
    _write_crash_record(
        f"THREAD CRASH ({thread_name}): {args.exc_type.__name__}: {args.exc_value}",
        body,
    )


def _signal_handler(signum, _frame) -> None:
    try:
        name = signal.Signals(signum).name
    except Exception:
        name = f"signal {signum}"
    body = "".join(traceback.format_stack())
    _write_crash_record(f"FATAL SIGNAL: {name}", body)
    signal.signal(signum, signal.SIG_DFL)
    os.kill(os.getpid(), signum)


def _atexit_handler() -> None:
    try:
        get_logger("lifecycle").info(
            "Process exiting cleanly (pid=%d, threads=%d)",
            os.getpid(),
            threading.active_count(),
        )
    except Exception:
        pass
    if _crash_log_fp is not None:
        try:
            _crash_log_fp.flush()
            _crash_log_fp.close()
        except Exception:
            pass


def install_crash_handler(user_data_path: Optional[str] = None) -> None:
    """Wire up uncaught-exception, signal, faulthandler, and atexit hooks.

    Idempotent. ``user_data_path`` is forwarded to :func:`set_log_dir` if given.
    """
    if user_data_path:
        set_log_dir(user_data_path)
    _ensure_root_initialised()

    sys.excepthook = _excepthook
    try:
        threading.excepthook = _thread_excepthook  # type: ignore[assignment]
    except Exception:
        pass

    atexit.register(_atexit_handler)

    global _crash_log_fp
    if _crash_log_path:
        try:
            import faulthandler

            _crash_log_fp = open(_crash_log_path, "a", encoding="utf-8")
            faulthandler.enable(_crash_log_fp, all_threads=True)
            for sig_name in ("SIGSEGV", "SIGABRT", "SIGBUS", "SIGFPE", "SIGILL"):
                sig = getattr(signal, sig_name, None)
                if sig is not None:
                    try:
                        faulthandler.register(
                            sig, file=_crash_log_fp, all_threads=True, chain=True
                        )
                    except Exception:
                        pass
        except Exception as e:
            get_logger("crash").warning("faulthandler unavailable: %s", e)

    for sig_name in ("SIGTERM", "SIGHUP"):
        sig = getattr(signal, sig_name, None)
        if sig is None:
            continue
        try:
            signal.signal(sig, _signal_handler)
        except Exception:
            pass

    get_logger("crash").info("Crash handler installed")


# ────────────────────────────────────────────────────────────────────────────
# Process diagnostics
# ────────────────────────────────────────────────────────────────────────────


def _process_stats(tag: str = "stats") -> None:
    """Log a one-line process snapshot. Best-effort, never raises."""
    log = get_logger("diagnostics")
    try:
        info = (
            f"[{tag}] pid={os.getpid()} threads={threading.active_count()} "
            f"platform={platform.platform()} python={platform.python_version()}"
        )
        try:
            import resource

            usage = resource.getrusage(resource.RUSAGE_SELF)
            info += f" rss(max)={usage.ru_maxrss}KB"
        except Exception:
            pass
        log.info(info)
    except Exception:
        pass


# ────────────────────────────────────────────────────────────────────────────
# Backward-compatible shims (existing call sites)
# ────────────────────────────────────────────────────────────────────────────


def _format_legacy(channel: str, *parts) -> str:
    """Format a v1 ``::STATUS::CHANNEL::TS::MSG`` line for OCR/anki routing."""
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    try:
        msg = " ".join(str(p) for p in parts)
    except Exception:
        try:
            msg = " ".join(repr(p) for p in parts)
        except Exception:
            msg = "?"
    msg = msg.replace("\n", " ")
    return f"{LOG_PATTERN_PREFIX}{channel}::{ts}::{msg}"


def _emit_legacy(channel: str, *parts) -> None:
    """Emit a v1 status line (used by OCR routing in Electron)."""
    line = _format_legacy(channel, *parts)
    try:
        print(line, flush=True)
    except Exception:
        try:
            sys.stdout.write(line + "\n")
            sys.stdout.flush()
        except Exception:
            pass


def _log(*args) -> None:
    """Legacy: general info log."""
    get_logger("general").info(_join(args))


def _log_debug(*args) -> None:
    get_logger("general").debug(_join(args))


def _log_warn(*args) -> None:
    get_logger("general").warning(_join(args))


def _log_error(*args, exc: bool = False) -> None:
    get_logger("general").error(_join(args), exc_info=exc)


def _log_ocr(*args) -> None:
    _emit_legacy("OCR", *args)
    get_logger("ocr").info(_join(args))


def _log_ocr_init(*args) -> None:
    _emit_legacy("OCR-INIT", *args)
    get_logger("ocr.init").info(_join(args))


def _log_ocr_run(*args) -> None:
    _emit_legacy("OCR-RUN", *args)
    get_logger("ocr.run").info(_join(args))


def _log_ocr_dl(*args) -> None:
    _emit_legacy("OCR-DL", *args)
    get_logger("ocr.dl").info(_join(args))


def _join(args) -> str:
    try:
        return " ".join(str(a) for a in args)
    except Exception:
        try:
            return " ".join(repr(a) for a in args)
        except Exception:
            return "?"


__all__ = [
    "get_logger",
    "set_log_dir",
    "get_log_dir",
    "get_crash_log_path",
    "install_crash_handler",
    "_process_stats",
    "_log",
    "_log_debug",
    "_log_warn",
    "_log_error",
    "_log_ocr",
    "_log_ocr_init",
    "_log_ocr_run",
    "_log_ocr_dl",
    "LOG_PATTERN_PREFIX",
    "LOG_PATTERN_VERSION",
]
