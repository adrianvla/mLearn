# Electron Main Process

Main-process code. CommonJS, compiles to `dist-electron/`.

## WHERE TO LOOK

| Task | File |
|------|------|
| Add IPC channel | `preload.ts` → expose method, then handle in `services/` |
| New window type | `services/windowManager.ts` → add to `WINDOW_TYPES`, create in `services/windowFactory.ts` |
| LLM routing | `services/llmRouter.ts` → delegates to `builtinLLMService.ts`, `ollamaService.ts`, or `cloud` |
| TTS/STT/Voice | `services/voiceService.ts` → Python `POST /voice/tts`, WebSocket `WS /voice/stream` |
| Flashcard audio | `services/flashcardTtsStorage.ts` → `.ogg` + `.meta.json` in userData |
| Flashcard images | `services/flashcardImageStorage.ts` → custom `flashcard-image://` protocol |
| OCR | `services/ocrService.ts` → Python `POST /ocr` |
| Python backend | `services/pythonBackend.ts` → spawn/manage FastAPI on 7752 |
| Web server | `services/webServer.ts` → HTTP + WebSocket on 7753, proxies `/forward/*` to Python |
| Media storage | `services/mediaStatsStorage.ts`, `services/localMediaProtocol.ts` |
| Custom protocols | Register in `main.ts`, handlers in `services/` |

## CONVENTIONS

- **CommonJS only**: `require()`/`module.exports`. No ES modules.
- **IPC**: Expose methods via `preload.ts` contextBridge. Never expose raw `ipcRenderer`.
- **Protocols**: Register with `protocol.registerFileProtocol()` in `main.ts`. Use `flashcard-image://`, `flashcard-audio://`, `local-media://`.
- **User data**: Store everything under `app.getPath('userData')`. Use `services/paths.ts` for subdirectories.
- **Services**: Each service is a module with `init()` or factory function. No global singletons.
- **Python communication**: Structured logs `::STATUS::<CHANNEL>::<TIMESTAMP>::<MESSAGE>`. Parse with `services/pythonLogParser.ts`.
- **Window lifecycle**: Create via `windowManager.ts`. Destroy on `closed`, dereference from `windowMap`.

## ANTI-PATTERNS

- **Never import from `shared/bridges`, `shared/backends`, or `shared/platform.ts`** — these are renderer-only.
- **No direct `ipcMain.on` in `main.ts`** — route through `services/` modules.
- **No hardcoded paths** — use `app.getPath()` and `path.join()`.
- **No timers for Python health checks** — use process events and structured logs.
- **No raw `fs` in handlers** — use service abstractions (`mediaStatsStorage.ts`, `flashcardImageStorage.ts`).
- **No window access after `closed`** — `closed` destroys webContents; use `close` event for cleanup.
