# mLearn Knowledge Base

## OVERVIEW
Language-learning immersion app: Electron + SolidJS + TypeScript frontend, Capacitor mobile target, Python/FastAPI NLP backend (port 7752). SRS flashcards, video subtitles, OCR, TTS, LLM tutoring.

## STRUCTURE
```
src/
├── electron/        # Main process (CommonJS). IPC, window management, voice/LLM/OCR services
├── renderer/        # SolidJS UI (ESNext). Components, windows, hooks, contexts
├── shared/          # Types, constants, platform bridges/backends. Renderer-only abstractions
├── root-of-app/     # Python FastAPI backend. NLP tokenization, translation, OCR, TTS
└── html/            # 15 Electron window entries + mobile.html (Capacitor)
extension/           # Chrome browser extension
android/, ios/       # Capacitor native projects
examples/plugins/    # Plugin templates (shiritori, discord-activity)
```

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Add IPC channel | `shared/constants.ts` → `preload.ts` → `shared/global.d.ts` → `shared/bridges/types.ts` → both bridges → `electron/services/` |
| Add UI window | `src/html/{name}.html` → `vite.config.ts` input → `src/renderer/windows/{name}/` |
| Add component | `src/renderer/components/common/{Name}/{Name}.tsx` + `.css` → `common/index.ts` |
| Add backend endpoint | `shared/backends/types.ts` → `shared/backends/httpBackend.ts` → `src/root-of-app/routes/{name}.py` |
| Add setting | `shared/types.ts` (Settings + DEFAULT_SETTINGS) → settings context |
| Add language runtime capability | `src/shared/types.ts` language metadata schema + `src/root-of-app/generic_language.py` |
| Add language package/data | `~/Desktop/projects/mlearn-website` language-data packaging, then install via catalog |
| Platform-specific code | `src/shared/platform.ts` helpers; never hardcode OS checks in renderer |

## CONVENTIONS
- **Two tsconfigs**: root (ESNext, renderer+shared) + `src/electron/tsconfig.json` (CommonJS, excludes bridges/backends/platform)
- **Path aliases**: `@/` → `src/`, `@shared/` → `src/shared/`, `@renderer/` → `src/renderer/`
- **Strict TS**: `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`
- **CSS**: Co-located `.css` per component, no CSS modules. 6 override theme files in `src/renderer/styles/themes/` + default light in `src/renderer/styles/index.css`. Applied via `body.theme-{name}`. No hardcoded colors in TSX. Do not add CSS variable fallbacks.
- **Localization**: `t('mlearn.Section.Key')` with `{param}`. 5 UI languages in `src/root-of-app/locales/`. Validate JSON after editing locale files.
- **Flashcard keys**: SHA-256 hashes (64-char hex), not raw text.
- **Tests**: Co-located `*.test.ts`/`*.test.tsx`. Vitest 3 projects: `node` (electron+shared+extension), `examples` (plugins), `renderer` (happy-dom). Pool: `forks`, maxWorkers: 4, setup: `test/setup.ts`. Write tests for every new feature.
- **Bridge composition**: `PlatformBridge` is 22 sub-interfaces. `getBridge()` is renderer-only; never import bridges/backends/platform into `src/electron/`.
- **Backend modes**: `settings.backendMode` is `'local' | 'tethered'` only. `getBackend()` returns `HttpBackend` for both. Cloud LLM calls bypass `getBackend()` entirely and use `CloudLLMAdapter` (SSE streaming).
- **Context nesting order** (via `WindowWrapper`): `ServerProvider → LocalizationProvider → ResponsiveProvider → SettingsProvider → LowPowerGateProvider → LanguageProviderBridge → MigrationHandler → FlashcardProvider`
- **Settings updates**: Always use `updateSetting()`/`updateSettings()` from Settings context — triggers `reconcile()`, DOM theme application, backend reconfig, bridge save, and `BroadcastChannel` cross-window sync. Never use raw `setStore`.
- **Setting fallbacks**: When reading optional or migrated settings, use `DEFAULT_SETTINGS.<key>` as the fallback. Do not hardcode literal defaults like `?? true`, `?? 300`, or `|| 'local'`.
- **State patterns**: Settings uses `createStore` + `reconcile()`. Flashcards use `createStore` + `produce()`.
- **Capacitor stub**: `electron` imports are aliased to `src/shared/stubs/electron.ts` in Capacitor builds.
- **Barrel exports**: Every new common component must be exported from `src/renderer/components/common/index.ts`.
- **Icons**: Use SVGs from `https://blendicons.com/free-icons/all-styles`. Do not use emojis.
- **Language data**: Runtime language metadata, dictionaries, frequencies, and optional adapters are downloaded into user `language-data/`. Do not add bundled app-source language modules or dictionaries.
- **Deprecation**: If you encounter legacy code worth removing, flag it for discussion rather than silently deleting.

## ANTI-PATTERNS
- **Never import `shared/bridges`, `shared/backends`, or `shared/platform.ts` from `src/electron/`** (one exception: `llmRouter.ts` imports `CloudLLMAdapter` — do not copy this)
- **Never call `window.mLearnIPC` or `ipcRenderer` directly in renderer** — use `getBridge()`
- **Never use raw `setStore` for settings** — use `updateSetting()` from context
- No hardcoding for any specific language (e.g., N1-N5 JLPT levels)
- Do not add `src/root-of-app/languages/{lang}.py`, `{lang}.json`, or bundled dictionary payloads; language packages belong in the cloud packaging repo and install on demand.
- No timeouts/timers unless required (race conditions)
- Avoid inline CSS in TSX unless unavoidable
- No AI-aesthetic styling (purple gradients, etc.)
- No sample/stub/demo code — everything is production
- No emojis

## COMMANDS
```bash
npm run dev              # Vite (3000) + Electron concurrent
npm run typecheck        # CRITICAL: both tsconfigs before commit
npm run build            # Production build (runs prebuild → clean-cache)
npm run bundle:preload   # esbuild preload.js with --external:electron
npm run dist:mac         # Package macOS
npm run dist:win         # Package Windows
npm run dist:linux       # Package Linux
npm run dist:tar         # Create .tar.gz from unpacked build
npm run dev:mobile       # Capacitor watch mode
npm run build:mobile     # Capacitor build → dist-mobile/
npm run ios              # build:mobile → cap sync → open Xcode
npm run android          # build:mobile → cap sync → open Android Studio
npm run test             # Vitest (all 3 projects)
npm run test:coverage    # Vitest with coverage
npm run build:extension  # ⚠️ macOS-only (uses sed -i '')
```

## RELATED REPOSITORIES
- **`~/Desktop/projects/mlearn-website`** — Website monorepo (deployed at `mlearn.kikan.net`, API at `mlearn-cloud.kikan.net`). HATEOAS architecture; no Supabase. All cloud data flows through the worker only.
- **`~/Desktop/projects/mlearn-mobile-website`** — Companion PWA with flashcards only. Syncs via the same cloud/tethered APIs.

## NOTES
- Single `package.json` for all targets — no monorepo. Vite multi-mode handles Electron vs Capacitor.
- `package-lock.json` is gitignored; repo relies on npm without a tracked lockfile.
- Python backend bundled via `electron-builder` `extraResources` to `resources/root-of-app/`.
- Python environment in dev is at `./dist-electron/env/`.
- Python deps are declared in `src/root-of-app/pip_requirements.json` (grouped: core, ocr, llm, voice, qwen3-tts), not a standard `requirements.txt`.
- Dictionary build and language-data packaging scripts live in `~/Desktop/projects/mlearn-website`; the app consumes the generated language catalog.
- Custom protocols: `flashcard-image://`, `flashcard-audio://`, `local-media://`.
- Tethered mode: desktop web server on 7753 proxies Python calls for browser/mobile and provides REST sync API.
- LLM routing: `builtin` (node-llama-cpp in main) / `ollama` / `cloud` (HTTP). Mobile uses `CloudLLMAdapter` directly.
- `resetBackend()` must be called when `backendMode`, `backendUrl`, or auth tokens change.
- Cross-window sync uses `BroadcastChannel` (`mlearn-settings`, `mlearn-flashcards`, `mlearn-localization`).
- Dev server sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers (required for SharedArrayBuffer).
- `global` and `process.env` are stubbed to `globalThis`/`{}` in Vite builds for `simple-peer` compatibility.
