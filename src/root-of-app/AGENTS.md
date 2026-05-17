# Python Backend

FastAPI NLP service (port 7752) bundled as Electron extraResources. Serves tokenization, translation, OCR, TTS.

## STRUCTURE

```
.
server.py          # Main FastAPI app, route registration
routes/            # OCR, voice, translation, tokenization endpoints
languages/         # Per-language modules: {lang}.py + {lang}.json
locales/           # UI localization strings (en, de, fr, ja, ru)
dictionaries/      # Yomitan JSON dictionaries
```

## WHERE TO LOOK

| Task | File |
|---|---|
| Add endpoint | `server.py` → `routes/{name}.py` → register in `server.py` |
| Add language | `languages/{lang}.py` + `languages/{lang}.json` |
| Language features | `languages/{lang}.json` (vertical_text, furigana, readings, etc.) |
| Update strings | `locales/{lang}.json` |
| Add dictionary | `dictionaries/` (Yomitan format) |
| Structured logging | `log_channel(status, message)` or `::STATUS::CHANNEL::TIMESTAMP::MESSAGE` |

## CONVENTIONS

- **Routes**: Use `router = APIRouter(prefix="/api/v1/{name}")`, export `get_router()`
- **Language modules**: Implement `LANGUAGE_TOKENIZE(text)`, `LOAD_MODULE(folder)`, `LANGUAGE_TRANSLATE(word)`
- **Logging**: Structured format only. `::STATUS::CHANNEL::TIMESTAMP::MESSAGE`
- **No third-party NLP libs in core**: Use `languages/{lang}.py` wrappers
- **JSON over Py for config**: Language features live in `.json`, logic in `.py`

## ANTI-PATTERNS

- Never import from `src/electron/` or `src/renderer/` (separate runtime)
- Never use `print()` for logs, use structured logging
- Never hardcode language features (vertical text, furigana) in Python, read from `.json`
- No global state in route modules, use FastAPI dependency injection
- No blocking I/O in async endpoints without `run_in_executor`
