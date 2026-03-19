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

config.QUIT_TOKEN = secrets.token_hex(32)

# ── Logging ──
from logging_utils import _log, _process_stats

_log(f"::QUIT_TOKEN::{config.QUIT_TOKEN}")

# ── Route modules ──
from routes import anki, nlp, ocr, llm, voice

# ── FastAPI app ──
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:7753",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:7753",
        "http://localhost:7752",
        "http://127.0.0.1:7752",
    ],
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
    _log("HTTP", request.method, str(request.url))
    try:
        response = await call_next(request)
        _log("HTTP Response", response.status_code, request.method, str(request.url))
        return response
    except Exception:
        _log("HTTP Exception during handling:")
        _log(traceback.format_exc())
        raise


# ── Health endpoint ──


@app.get("/health")
async def health():
    _process_stats("health")
    return {"status": "ok", "language": config.LANGUAGE}


# ── Startup ──


@app.on_event("startup")
async def startup_event():
    _log("Getting all cards")
    _process_stats("startup")
    _log("Runtime info:", config.get_runtime_info())

    resp = anki.get_all_cards()
    if not resp:
        _log("Anki is offline, loading from Cache")
        if anki.get_all_cards_CACHE():
            _log("Loaded from cache")
        else:
            _log("Failed to load from cache")
            _log("ANKI_ERROR", "connection_failed")
            sys.exit(-1)

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
        _log(f"Faulthandler enabled; crash logs -> {crash_log_path}")
    except Exception as e:
        _log("Failed to enable faulthandler:", e)

    # Mark transformers preimport as not yet done; it will be triggered
    # lazily via POST /ocr/warmup when the reader is first opened,
    # avoiding unnecessary CPU usage on startup.
    preimport_event = ocr.get_transformers_preimport_event()
    if not config.OCR_ALLOWED:
        preimport_event.set()


if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=7752, log_level="debug")
