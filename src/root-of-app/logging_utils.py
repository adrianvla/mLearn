"""
Structured logging utilities for the mLearn Python backend.

All log output follows the pattern:
    ::STATUS::<CHANNEL>::<TIMESTAMP>::<MESSAGE>
which allows the Electron main process to parse and route messages.
"""
import os
import sys
import time
import platform
import threading


LOG_PATTERN_PREFIX = "::STATUS::"


def _now() -> str:
    try:
        return time.strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return "time?"


def _format_status(channel: str, *parts) -> str:
    """Return a strict machine-parsable status line.

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
        info = (
            f"[{tag}] pid={pid} threads={th} "
            f"platform={platform.platform()} "
            f"python={platform.python_version()}"
        )
        try:
            import resource
            usage = resource.getrusage(resource.RUSAGE_SELF)
            info += f" rss(max)={usage.ru_maxrss}KB"
        except Exception:
            pass
        _log(info)
    except Exception:
        pass
