# src/shared/ AGENTS.md

Renderer-only platform abstraction layer. Types, constants, bridges, backends, platform detection. Zero Electron main process code.

## WHERE TO LOOK

| Task | File |
|------|------|
| Add IPC channel | `constants.ts` → `bridges/types.ts` → `electronBridge.ts` + `capacitorBridge.ts` |
| Add bridge method | `bridges/types.ts` → both `electronBridge.ts` and `capacitorBridge.ts` |
| Add backend endpoint | `backends/types.ts` → `httpBackend.ts` |
| Add shared type / setting | `types.ts` — update BOTH `Settings` interface AND `DEFAULT_SETTINGS` |
| Platform detection | `platform.ts` — `getPlatform()`, `isElectron()`, `isCapacitor()`, `isMobile()`, `isDesktop()` |
| Reset backend cache | `backends/index.ts` — `resetBackend()` when settings change |

## CONVENTIONS

- **Bridges are renderer-only** — they depend on browser APIs (`window.mLearnIPC`, `fetch`, Capacitor plugins)
- **Singleton factories** — `getBridge()` and `getBackend()` cache instances; call `resetBackend()` on URL/mode changes
- **Single source of truth** — `types.ts` for all cross-process types; `constants.ts` for all constants
- **Bridge composition** — `PlatformBridge` is 16 sub-interfaces (`SettingsBridge`, `FlashcardBridge`, `LLMBridge`, etc.)
- **Backend modes** — `local` (direct), `tethered` (desktop proxy), `cloud` (remote). All resolve to `HttpBackend` with different base URLs
- **`nodeServerAdapter.ts`** — HTTP client for desktop web server sync endpoints; used by `SyncService` and `CapacitorBridge` in tethered mode

## ANTI-PATTERNS

- **NEVER** import `shared/bridges`, `shared/backends`, or `shared/platform.ts` from `src/electron/` — these are renderer-only
- **NEVER** call `window.mLearnIPC` or use `ipcRenderer` directly — always go through `getBridge()`
- **NEVER** use raw `fetch()` for backend calls — always go through `getBackend()`
- **NEVER** add a bridge method to `types.ts` without implementing it in BOTH `electronBridge.ts` and `capacitorBridge.ts`
- **NEVER** mutate `DEFAULT_SETTINGS` inline — it's the source of truth for initialization and migrations
- **NEVER** hardcode migrated setting fallbacks — use `DEFAULT_SETTINGS.<key>` when a setting may be undefined
