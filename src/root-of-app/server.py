"""
mLearn NLP Backend — FastAPI entrypoint.

All route logic lives in the ``routes/`` package.  This file wires up
configuration, CORS, authentication, middleware, the startup event, and the
Uvicorn server.
"""

import gc
import os
import secrets
import sys
import traceback

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.requests import HTTPConnection
from starlette.exceptions import WebSocketException  # type: ignore[import-untyped]

# ── Bootstrap configuration (CLI args, settings.json, language module) ──
import config

config.init()

# ── Per-run backend token ──
# Generated once per process. Emitted to stdout ONLY (the Electron main
# process parses `::QUIT_TOKEN::` from stdout to learn it); deliberately not
# routed through the logger, which also writes to rotating files under
# USER_DATA_PATH. A per-run token must never persist to disk.
config.QUIT_TOKEN = secrets.token_hex(32)
sys.stdout.write(f"::QUIT_TOKEN::{config.QUIT_TOKEN}\n")
sys.stdout.flush()

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

# ── Route modules ──
from routes import convert, nlp, ocr, llm, voice

# ── FastAPI app ──
app = FastAPI()

# Allowed browser/WebView origins. The Python backend is a local service:
# Electron production renders via file:// (Origin: "null"), the Vite dev
# server serves http://localhost:3000, and Capacitor WebViews use
# capacitor://localhost (iOS) / https://localhost (Android). The mobile
# flashcards PWA may call the desktop backend directly in tethered mode.
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "null",
    "capacitor://localhost",
    "https://localhost",
    "https://mlearn-app.kikan.net",
]

# ── Authentication ──
# Every route except /health requires the per-run bearer token. The
# dependency reads the Authorization header and works for both HTTP and
# WebSocket scopes (HTTPConnection covers both).
def require_backend_token(connection: HTTPConnection) -> None:
    authorization = connection.headers.get("authorization", "")
    scheme, _, credential = authorization.partition(" ")
    if (
        scheme.lower() != "bearer"
        or not credential
        or not config.QUIT_TOKEN
        or not secrets.compare_digest(credential, config.QUIT_TOKEN)
    ):
        if connection.scope["type"] == "websocket":
            raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Unauthorized")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing backend token",
            headers={"WWW-Authenticate": "Bearer"},
        )


# Mount routers. All endpoints (HTTP + WebSocket) require the backend token;
# /health is defined directly on `app` and stays public (used for liveness).
app.include_router(nlp.router, dependencies=[Depends(require_backend_token)])
app.include_router(ocr.router, dependencies=[Depends(require_backend_token)])
app.include_router(llm.router, dependencies=[Depends(require_backend_token)])
app.include_router(voice.router, dependencies=[Depends(require_backend_token)])
app.include_router(convert.get_router(), dependencies=[Depends(require_backend_token)])


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    log.error("Unhandled HTTP exception:", exc_info=True)
    response = JSONResponse(status_code=500, content={"detail": "Internal server error"})
    # The base-Exception handler runs in ServerErrorMiddleware, which is
    # outside CORSMiddleware, so decorate allowed origins manually.
    origin = request.headers.get("origin")
    if origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
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
    allow_origins=ALLOWED_ORIGINS,
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
    # Parse --host (e.g. `--host 0.0.0.0` for tethered LAN serving). Defaults
    # to loopback: the backend is a local service and must not be exposed to
    # the LAN unless the desktop user explicitly enables tethered serving.
    host = "127.0.0.1"
    argv = sys.argv[1:]
    for i, arg in enumerate(argv):
        if arg == "--host" and i + 1 < len(argv):
            host = argv[i + 1]
            break

    # Pass the app object, not the "server:app" string: the string form
    # re-imports server.py as a fresh module, regenerating a second token and
    # duplicating config.init().
    uvicorn.run(app, host=host, port=7752, log_level="debug")
