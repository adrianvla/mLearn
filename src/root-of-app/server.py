"""
mLearn NLP Backend — FastAPI entrypoint.

All route logic lives in the ``routes/`` package.  This file wires up
configuration, CORS, middleware, the startup event, and the Uvicorn server.
"""

import gc
import os
import secrets
import sys
import traceback

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

# ── Bootstrap configuration (CLI args, settings.json, language module) ──
import config

config.init()

# ── Logging ──
from logging_utils import get_logger, install_crash_handler, set_log_dir, _process_stats

install_crash_handler(config.USER_DATA_PATH)
set_log_dir(config.USER_DATA_PATH)

log = get_logger("server")

config.QUIT_TOKEN = secrets.token_hex(32)

log.info(f"::QUIT_TOKEN::{config.QUIT_TOKEN}")

# ── Route modules ──
from routes import anki, nlp, ocr, llm, voice

# ── FastAPI app ──
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers
app.include_router(anki.router)
app.include_router(nlp.router)
app.include_router(ocr.router)
app.include_router(llm.router)
app.include_router(voice.router)


# ── Middleware ──


@app.middleware("http")
async def log_requests(request: Request, call_next):
    log.info(f"HTTP {request.method} {request.url}")
    try:
        response = await call_next(request)
        log.info(f"HTTP Response {response.status_code} {request.method} {request.url}")
        return response
    except Exception:
        log.error("HTTP Exception during handling:", exc_info=True)
        raise


# ── Health endpoint ──


@app.get("/health")
async def health():
    _process_stats("health")
    return {"status": "ok", "language": config.LANGUAGE}


# ── Startup ──


@app.on_event("startup")
async def startup_event():
    log.info("Getting all cards")
    _process_stats("startup")
    log.info(f"Runtime info: {config.get_runtime_info()}")

    resp = anki.get_all_cards()
    if not resp:
        log.info("Anki is offline, loading from Cache")
        if anki.get_all_cards_CACHE():
            log.info("Loaded from cache")
        else:
            log.error("Failed to load from cache")
            log.error("ANKI_ERROR connection_failed")

    # Faulthandler for crash diagnostics
    try:
        import faulthandler
        import signal

        crash_log_path = os.path.join(config.RESPATH, "python_crash.log")
        global _crash_log
        _crash_log = open(crash_log_path, "a")
        faulthandler.enable(_crash_log)
        for _sig in (
            getattr(signal, n, None)
            for n in ["SIGSEGV", "SIGABRT", "SIGBUS", "SIGFPE", "SIGILL"]
        ):
            try:
                if _sig is not None:
                    faulthandler.register(
                        _sig, file=_crash_log, all_threads=True, chain=True
                    )
            except Exception:
                pass
        log.info(f"Faulthandler enabled; crash logs -> {crash_log_path}")
    except Exception as e:
        log.error(f"Failed to enable faulthandler: {e}", exc_info=True)

    # Mark transformers preimport as not yet done; it will be triggered
    # lazily via POST /ocr/warmup when the reader is first opened,
    # avoiding unnecessary CPU usage on startup.
    preimport_event = ocr.get_transformers_preimport_event()
    if not config.OCR_ALLOWED:
        preimport_event.set()


if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=7752, log_level="debug")
