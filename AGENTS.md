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
| Add generic language runtime mechanism | `src/shared/types.ts` language-package contract + `src/root-of-app/generic_language.py`; shared types describe extensibility mechanisms, not a catalog of linguistic concepts |
| Add a language-owned feature, category, rule, or data field | The language package/data under `scripts/language-data/`; declare it through package metadata/schema or an installed adapter instead of adding a language-specific field to shared app types |
| Add language package/data | `scripts/language-data/` builders and sources, then publish through `~/Desktop/projects/mlearn-website` |
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
- **Language-owned runtime dependencies**: Language-specific OCR/tokenizer/TTS/STT Python packages belong in `scripts/language-data/` package metadata under `runtime.python.packagesByComponent`, not in app-level `pip_requirements.json` defaults. If a clean install is missing OCR or tokenizer libraries for one language, fix the language package here, then regenerate and deploy the website catalog.
- **Language-agnostic app code**: Renderer, shared TS, Electron services, and generic Python routes must read capabilities from installed language metadata/features. Language-specific labels, levels, scripts, tokenization behavior, OCR behavior, prosody behavior, colors, dictionary availability, grammatical categories, morphology, and relations belong in language packages or generic capability adapters, not in conditionals like if (language === 'ja'). Shared/core code must define extensibility mechanisms, not a closed catalog of linguistic concepts.
- **Deprecation**: If you encounter legacy code worth removing, flag it for discussion rather than silently deleting.

## LANGUAGE ARCHITECTURE: OPEN-WORLD

The language system is an open-world package/plugin architecture. It must remain possible for a third party to add a language whose grammatical categories, writing system, morphology, segmentation model, pronunciation system, or pedagogical concepts the mLearn core has never heard of.

The goal is not merely "support all currently supported languages without `if (language === ...)`". The stronger invariant is:

**Adding a new language must not require teaching shared/core code what linguistic concepts that language has.**

### Core vs language package

Core/shared code owns **mechanisms**: package loading, generic schemas/envelopes, capability discovery, graph/storage primitives, generic rendering hooks, adapter invocation, validation boundaries, and graceful fallback behavior.

Language packages own **linguistic semantics**: grammatical categories and values, paradigms, morphology, agreement, classifiers/counters, scripts, transliterations, tokenization/segmentation behavior, pronunciation/prosody dimensions, language-specific relations, pedagogical levels, labels, and rules.

Do not promote a concept into core merely because several currently supported languages use it. Shared types may define an extensible feature/capability protocol, but must not become a master ontology of human language.

### Unknown future linguistic concepts must fit

A third-party language package must be able to introduce categories and values that do not exist anywhere in app source.

Examples include grammatical gender, noun class, animacy, evidentiality, mirativity, switch-reference, obviation, direct/inverse marking, logophoricity, allocutivity, inclusive/exclusive person, dual/trial/paucal number, possession classes, arbitrary classifier systems, case systems, conjugation classes, pitch/prosody systems, or completely unknown future categories.

These examples are **counterexamples, not a list to encode**. Do not create a giant union containing all known linguistic categories.

### Do not hardcode linguistic dimensions into generic types

Bad:

```ts
interface GenericLexiconEntry {
  gender?: 'm' | 'f' | 'n';
  animacy?: 'animate' | 'inanimate';
  case?: 'nom' | 'acc' | 'gen' | 'dat';
  pitchAccent?: number;
}
```

Optional fields are still hardcoding. They assume core knows the universe of possible linguistic dimensions and often encode one language family's value system as universal.

Prefer package-declared/open-ended feature identifiers and values. The exact representation may differ depending on the graph/schema, but conceptually it should allow something like:

```ts
type FeatureId = string;
type FeatureValue = unknown;

interface LanguageFeature {
  id: FeatureId;
  value: FeatureValue;
}
```

The exact interface above is illustrative, not mandatory. The important property is that a language package can declare an unknown feature and value without modifying shared TypeScript/Python types solely because core has never seen that feature before.

### Features are not necessarily scalar properties of words

Do not assume a language-defined feature is attached only to a lemma or "word", single-valued, intrinsic, context-free, a finite enum, independent of other features, or identical across languages because its English label is the same.

Language-owned information may attach to lexical entities, senses, forms, morphemes, tokens, spans, multiword expressions, constructions, syntactic relations, clauses, utterances, discourse participants, speaker/hearer relationships, pronunciations, or another package-defined entity.

Values may be structured, relational, hierarchical, conditional, contextual, computed, or multi-valued.

### Do not universalize linguistic assumptions

Do not assume one orthographic token corresponds to one lexical or semantic unit. Do not assume every language has the same POS inventory. Do not assume number is `singular | plural`, gender is `m | f | n`, case has a fixed inventory, or person is only `1 | 2 | 3`.

Do not assume inflection means suffix replacement, words have one stem, compounds split by one universal algorithm, whitespace defines words, or pronunciation is one reading plus optional stress.

Languages may use clitics, incorporation, polysynthesis, discontinuous expressions, nonconcatenative morphology, classifier systems, arbitrary noun/verb classes, tone, phonation, register, sandhi, pitch systems, or concepts not anticipated here.

### Language packages are behavior/schema providers, not only data blobs

A language package may need to provide data, schemas, rules, and behavior.

If a language needs behavior the generic runtime cannot currently express, add a **generic extension point or adapter contract that any language package could implement**. Do not solve it by adding a branch for that language.

For every language-system change, check that an installed package can declare it without editing core, can provide values the app has never seen before, and that an unrelated language could reuse the mechanism with completely different semantics.

Unknown language-owned metadata must survive load → store → serialize without being dropped merely because core cannot interpret it.

### Preserve unknown language-owned data

Validators must distinguish malformed data from merely unknown language-owned data.

Do not reject a package because it declares an unrecognized feature ID/value valid under that package's schema. Do not strip unknown extensible fields during parse/store/serialize round trips. Prefer namespaced/stable identifiers for package-owned concepts.

### Generic UI behavior

Generic UI discovers what a language package exposes; it must not contain a fixed checklist of linguistic concepts.

Language-specific labels, ordering, descriptions, grouping, presentation hints, and pedagogical relevance come from package metadata.

Specialized UI may exist behind a generic capability-driven extension surface. The shell must not choose specialized behavior by language code/name.

Missing features are normal. Unknown-but-valid features must degrade gracefully.

### The future-language test

For every shared language-model change, mentally test an imaginary third-party language that:

* has none of the categories you were designing around; and
* introduces one grammatical, lexical, phonological, orthographic, or discourse category the core has never seen.

The design fails if adding that language requires editing a shared union such as `gender?: 'm' | 'f' | 'n'`, adding its language code/name to core logic, adding a dedicated core field for its grammatical category, teaching generic UI its category values, updating a central registry of known linguistic features, or discarding its data because core cannot interpret the concept.

When practical, test this with a synthetic language package containing arbitrary unknown feature IDs and structured values. It should load, round-trip, and expose its capabilities without source-level registration of those feature IDs.



## ANTI-PATTERNS
- **Never import `shared/bridges`, `shared/backends`, or `shared/platform.ts` from `src/electron/`** (one exception: `llmRouter.ts` imports `CloudLLMAdapter` — do not copy this)
- **Never call `window.mLearnIPC` or `ipcRenderer` directly in renderer** — use `getBridge()`
- **Never use raw `setStore` for settings** — use `updateSetting()` from context
- No hardcoding for any specific language. Do not add checks for language codes, language names, scripts, JLPT/N1-N5, pitch accent, kana/kanji, Japanese OCR, or any other language-specific concept in app/runtime UI code. Model it as metadata, a feature capability, a package asset, or an installed adapter.
- **No closed-world linguistic enums in generic/shared code.** Do not add fields/unions such as `gender: 'm' | 'f' | 'n'`, fixed case inventories, fixed number systems, classifier types, known prosody categories, or equivalent enumerations merely because current languages need them.
- **No central registry of all linguistic concepts.** Core may register generic extension mechanisms/capability kinds where technically necessary, but language-owned feature IDs and values must remain open-ended.
- **No "generic" helper whose internals branch on languages.** Moving `if (language === ...)` behind a function named `generic*` is still hardcoding.
- **No language-specific behavior inferred from language code when package metadata/capabilities can state it.** Language codes identify packages/languages; they are not behavior switches.
- **No lossy normalization into familiar linguistic categories.** Do not force an unfamiliar language feature into the nearest existing concept such as gender, case, number, classifier, POS, reading, or pitch accent merely because the current schema already understands that concept.
- Do not "fix" missing language-specific OCR/tokenizer/TTS/STT dependencies by adding concrete packages to `src/root-of-app/pip_requirements.json`. Keep app dependency groups generic; add concrete language runtime packages to the cloud language package metadata and regenerate/deploy the language catalog.
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
- Dictionary builders, language package sources, and the packager live in `scripts/language-data/`. Packaging writes release artifacts and the public catalog into `~/Desktop/projects/mlearn-website`, which owns upload and deployment.
- Custom protocols: `flashcard-image://`, `flashcard-audio://`, `local-media://`.
- Tethered mode: desktop web server on 7753 proxies Python calls for browser/mobile and provides REST sync API.
- LLM routing: `builtin` (node-llama-cpp in main) / `ollama` / `cloud` (HTTP). Mobile uses `CloudLLMAdapter` directly.
- `resetBackend()` must be called when `backendMode`, `backendUrl`, or auth tokens change.
- Cross-window sync uses `BroadcastChannel` (`mlearn-settings`, `mlearn-flashcards`, `mlearn-localization`).
- Dev server sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers (required for SharedArrayBuffer).
- `global` and `process.env` are stubbed to `globalThis`/`{}` in Vite builds for `simple-peer` compatibility.
