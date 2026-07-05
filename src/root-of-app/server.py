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
from fastapi.responses import JSONResponse

# ── Bootstrap configuration (CLI args, settings.json, language module) ──
import config

config.init()

# ── Logging ──
from logging_utils import (
    get_crash_log_path,
    get_logger,
    install_crash_handler,
    set_log_dir,
    _process_stats,
)

install_crash_handler(config.USER_DATA_PATH)
set_log_dir(config.USER_DATA_PATH)

log = get_logger("server")

config.QUIT_TOKEN = secrets.token_hex(32)

log.info(f"::QUIT_TOKEN::{config.QUIT_TOKEN}")

# ── Route modules ──
from routes import nlp, ocr, llm, voice

# ── FastAPI app ──
app = FastAPI()

# Mount routers
app.include_router(nlp.router)
app.include_router(ocr.router)
app.include_router(llm.router)
app.include_router(voice.router)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    log.error("Unhandled HTTP exception:", exc_info=True)
    response = JSONResponse(status_code=500, content={"detail": str(exc)})
    if request.headers.get("origin"):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "*"
    return response


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


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health endpoint ──


@app.get("/health")
async def health():
    _process_stats("health")
    return {"status": "ok", "language": config.LANGUAGE}


# ── Startup ──


@app.on_event("startup")
async def startup_event():
    _process_stats("startup")
    log.info(f"Runtime info: {config.get_runtime_info()}")

    # Faulthandler for crash diagnostics
    try:
        import faulthandler
        import signal

        crash_log_path = get_crash_log_path()
        if not crash_log_path:
            fallback_user_data = config.USER_DATA_PATH or os.path.join(
                os.path.expanduser("~"), ".mlearn"
            )
            crash_log_path = os.path.join(fallback_user_data, "logs", "python_crash.log")
        os.makedirs(os.path.dirname(crash_log_path), exist_ok=True)
        global _crash_log
        _crash_log = open(crash_log_path, "a", encoding="utf-8")
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

    # Mark transformer-based OCR preimport as not yet done; /ocr/warmup
    # starts it lazily only for languages whose OCR metadata needs it.
    preimport_event = ocr.get_transformers_preimport_event()
    if not config.OCR_ALLOWED:
        preimport_event.set()


if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=7752, log_level="debug")
