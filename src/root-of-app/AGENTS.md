# Python Backend

FastAPI NLP service (port 7752) bundled as Electron extraResources. Serves tokenization, translation, OCR, TTS.

## STRUCTURE

```
.
server.py          # Main FastAPI app, route registration
routes/            # OCR, voice, translation, tokenization endpoints
generic_language.py # Metadata-driven NLP/dictionary adapter for installed language packages
locales/           # UI localization strings (en, de, fr, ja, ru)
```

## WHERE TO LOOK

| Task | File |
|---|---|
| Add endpoint | `server.py` → `routes/{name}.py` → register in `server.py` |
| Add language runtime capability | Extend `generic_language.py` and the `LanguageData.runtime` metadata schema |
| Language features | Installed `language-data/languages/{lang}.json` metadata |
| Update strings | `locales/{lang}.json` |
| Add dictionary | Build/package it in the cloud repository and install it under user `language-data/` |
| Structured logging | `log_channel(status, message)` or `::STATUS::CHANNEL::TIMESTAMP::MESSAGE` |

## CONVENTIONS

- **Routes**: Use `router = APIRouter(prefix="/api/v1/{name}")`, export `get_router()`
- **Language packages**: Runtime language metadata and dictionaries are downloaded into user data. The app source must not bundle per-language adapters, metadata, or dictionaries.
- **Language adapters**: Prefer metadata-driven behavior in `generic_language.py`. Installed packages may provide explicit `adapters/*.py` modules only for capabilities that cannot be expressed as bricks yet.
- **Logging**: Structured format only. `::STATUS::CHANNEL::TIMESTAMP::MESSAGE`
- **No third-party NLP libs in core routes**: Put optional NLP integrations behind metadata-selected adapters.
- **JSON over Py for config**: Language features live in installed metadata; Python code should expose reusable bricks.

## ANTI-PATTERNS

- Never import from `src/electron/` or `src/renderer/` (separate runtime)
- Never use `print()` for logs, use structured logging
- Never hardcode language features (vertical text, readings, scripts, dictionary ranking) in Python routes; read installed metadata.
- Do not add app-bundled `languages/{lang}.py`, `languages/{lang}.json`, or dictionary payloads.
- No global state in route modules, use FastAPI dependency injection
- No blocking I/O in async endpoints without `run_in_executor`
