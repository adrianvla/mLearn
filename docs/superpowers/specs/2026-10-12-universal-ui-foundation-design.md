# mLearn v3 — Universal UI Foundation (Design)

**Status:** Proposed for maintainer review; not an implementation approval.
**Date:** 2026-10-12
**Baseline:** `rewrite/v3` at `91dc5f9049b77fd1f6fa52e9603444d30d5ba0d2`
**Reference implementation:** `archive/v2-final` (`1788f9c74dc73dd884b687ec80d9550c3ebf6c6b`)

## 1. Intent and success conditions

mLearn v3 is a **greenfield rewrite** in the same Git history. Its UI must be one React component/screen implementation for iOS, Android, and desktop, rather than two applications that share only business logic. Desktop runs that app through Expo's React Native Web output hosted in **Tauri 2**; iOS and Android run through **Expo/React Native**. There is no second React DOM app and no Electron/Capacitor/Python runtime.

This foundation should stop the v2 proliferation of competing `Button`/`Btn` implementations, unlabelled clickable controls, ad hoc themes, inaccessible interaction patterns, and platform conditionals copied across feature screens. The protection must be enforced by dependency boundaries, public APIs, lint/tests/CI, not just an instruction document.

Constraints:
- Prefer **one feature screen/component source**. Permit thin `.web.tsx`/`.native.tsx` adapters for platform primitives, host APIs, navigation chrome, native materials and specialist document rendering; no duplicate rating, review, settings, word-inspector or messenger feature trees.
- Preserve the **v2.9 desktop visual identity**; new mobile presentation should honor native navigation, safe areas, touch and accessibility. Selectively reuse old CSS/visual assets, never copy old application architecture.
- **No Tailwind, NativeWind or UnoCSS** as the universal styling system. Colocate portable styles.
- Support arbitrary user-defined *theme data* at runtime (palette, typography, spacing, surface style, etc.), without claiming arbitrary CSS source is portable to native.
- Keep the current working Expo dev-web → Tauri boot path operational throughout the refactor. Do not touch the v2 production profile.
- Use plain **npm workspaces** and **Cargo workspace** with committed lockfiles; do not add a monorepo task runner without a measured need.

This design covers the **cross-platform foundation, enforceable Rust/UI ownership, and one genuine persisted settings/theme vertical slice**, not the entire v2 feature migration, language engine, inference backend, or data-profile importer. A UI-only demonstration may exist as an isolated control test, but may not masquerade as a working learner feature.

### Historical product references are not implementation blueprints

`archive/v2-final` is a pinned **T2-era product/behavior reference**, not a golden source tree. It contains both user-valued capabilities and recent UI decisions the maintainer dislikes. The older **v2.9 appearance** is a visual direction, not a blanket instruction to preserve every historical interaction or screen. The last two months' product changes must be assessed deliberately; chronological recency confers no approval.

Before implementing a substantive feature, record a concise **reference decision** in `docs/architecture/reference-decisions.md` or the feature acceptance record: source commit/screenshot/workflow, observed behavior, intended user outcome, acceptance criteria, known defects, and **keep / change / reject / awaiting user decision** for UX and for functional semantics separately. Reference-derived behavior can be used to define acceptance cases; a test that merely codifies an old bug is not an acceptance criterion. Do not invent an answer when the historical versions conflict—request an explicit decision for meaningful ambiguities.

The functional scope should draw from T2's actual learner, practice, language, immersion and agent capabilities, but **not reuse its implementation techniques, state organization, setting IDs, storage schemas, UI state machines, or accidental workarounds**. Not every historical mechanism merits inclusion just because it once existed. Excluded behavior and unfinished parity remain visible in the acceptance register.

## 2. Source audit

Observed at the pinned branch SHA:

- Root `package.json` is private npm workspaces (`apps/*`, `packages/*`) and scripts for Expo web export and Tauri dev. Expo client is **SDK 57**, React 19.2.3, React Native 0.86.3, Expo Router and RN Web 0.21.
- `apps/client/src/app/index.tsx`, `explore.tsx`, `_layout.tsx` are Expo starter routes. Starter `ThemedText`, `ThemedView`, tab UI, theme constants and a CSS Module are not mLearn components; avoid graduating them to permanent public APIs.
- `apps/client/app.json` enables `experiments.reactCompiler`; it has distinct iOS/Android dev identifiers. `@expo/ui` is already installed.
- `apps/desktop/src-tauri/tauri.conf.json` has the right Expo URL and output path but still uses placeholder app identifier `com.tauri.dev`, generic metadata, and `csp: null`. Host code is the stock Tauri app.
- No root `Cargo.toml` and no `crates/` Rust runtime yet; the only Cargo package is the generated Tauri host. Initial desktop compilation is not evidence of common native behavior.
- The archived T2 implementation illustrates *mixed state and storage authority*: `src/shared/learningModel.ts` implements probabilistic learning policy in TypeScript; `src/electron/services/flashcardStorage.ts` contains whole-store `JSON.stringify(store, null, 2)` plus temporary-file replacement; `src/electron/services/knowledgeHistoryStore.ts` already uses SQLite for event/history data. Do not incorrectly claim v2 used only JSON, and do not reproduce the hybrid design.
- Historical compact encodings, packed numeric fields inside JSON, legacy settings, migration flags and renderer caches are **compatibility inputs to inspect**, not normalized v3 data types.

Any plan must inspect current HEAD again before writing because this baseline may evolve.

## 3. Selected architecture and rejected alternatives

### Selected: Expo-first universal app

```
apps/client (one Expo Router application)
  -> React Native on iOS/Android
  -> React Native Web on desktop/web -> apps/desktop/src-tauri (Tauri host)

apps/client -> @mlearn/ui -> @mlearn/theme
apps/client -> @mlearn/runtime-client -> typed contracts
apps/desktop/src-tauri -> Rust runtime (when implemented)
apps/client/modules/mlearn-native -> Rust runtime via portable FFI (when implemented)
```

An Expo route file only binds navigation to a screen in `apps/client/src/features/`. It should not contain **domain/application** state logic or native service ownership. All domain decisions belong in the portable Rust runtime, including when a screen uses them; the UI can own ephemeral presentation state.

### Rust is the application; React is its presentation

**Rust authority from the first real feature, not a later migration:**
- **Learner domain:** canonical learner identities and data; graph and knowledge projections; observations vs claims vs passive exposure; model evaluation and forecasts; probe generation/selection; SRS policy and due ordering; learning/teaching policy; rating admission, retraction/undo, provenance, aggregation and evidence compaction.
- **Language runtime:** open-world package/schema/capability discovery and adapters, authoritative linguistic analysis and language-owned transformations. The core must not contain language-code behavior switches or fixed linguistic ontologies.
- **Runtime services:** long-lived tasks, OCR/STT/TTS/LLM provider choice and inference scheduling, media ownership, resource budgets, cancellation, plugin execution, sync and conflict handling, and background jobs.
- **Durable configuration and storage:** validated/versioned preferences, theme selections and documents, learner settings, migrations, profiles, SQLite transactions, snapshots/recovery, imports/exports, and authority over all saved writes. UI-only presentation token application remains in the theme adapter.

**React/Expo/RNW may own only presentation concerns:** composition, accessibility, navigation, layout/responsive adaptation, formatting of Rust-supplied display values, open popovers, gestures, focus, animation, scroll position, and unsubmitted draft inputs. UI input validation may provide immediate feedback, but Rust is authoritative for accepting a command. React must not implement or cache an independent knowledge model, due scheduler, derived learner status, settings authority, or provider routing policy. A view-local draft rating is not persisted evidence.

**Data flow:** a screen requests a **bounded, typed, paginated or otherwise scoped read model** through `@mlearn/runtime-client`; Rust computes and returns the model plus revision/readiness/provenance as applicable. An interaction sends a typed command with appropriate identity/idempotency preconditions; Rust validates and commits it, then returns a receipt/revision and an invalidation/change signal. Optimistic UI never claims durable success before the receipt. Events are coalesced or backpressured; do not stream every internal state transition or entire history through React.

**Enforcement:** CI must reject feature/renderer imports of learning-model, scheduling, tokenizer, graph-policy or native database implementations; direct persistence of user/application authority via `localStorage`, AsyncStorage, unstructured settings JSON files, or hand-maintained global React stores; direct platform IPC from feature code; and parallel “temporary” TypeScript domain implementations. Test the AST-boundary rules with deliberately forbidden fixture imports. React still needs ordinary event handlers and transient UI state—do not confuse the rule with banning all client-side logic.

### Alternatives not chosen

1. Separate React DOM/Tauri and Expo screen hierarchies: simpler desktop styling but contradicts the user's requirement of one maintained UI.
2. Base UI + CSS Modules as universal UI: Base UI and HTML/CSS Modules are DOM renderers, not native widgets. They are permitted only inside an explicitly DOM-specific integration.
3. Tamagui or Tailwind-style frameworks: credible alternatives, but introduce different foundational abstractions and/or utility styling. Reassess only on a failed documented feasibility test; do not install multiple design-system foundations simultaneously.

The **one-screen guarantee** is source-level ownership and business behavior. Low-level native/web host elements may differ, and real native UI controls do not automatically look identical to desktop custom controls.

## 4. Repository shape and module ownership

```
apps/
  client/
    src/
      app/                    # Expo Router route wrappers, layout
      bootstrap/              # dependency injection, theme initialization, app startup
      shell/                  # universal navigation and adaptive chrome
      features/               # review/, library/, reader/, settings/, ...
      widgets/                # mLearn domain-specific reusable compositions
      host/                   # web/native host adapters and capability discovery
    modules/                  # future local Expo native module, no Rust logic duplicates
    app.json
    babel.config.js           # when styling integration is implemented
    metro.config.js           # only if required
  desktop/
    src-tauri/                # Tauri host and minimal IPC adapter, no UI implementation
packages/
  ui/                         # authoritative interactive primitives, overlays, layout, a11y
  theme/                      # theme schema, validation, resolution, runtime application
  contracts/                  # versioned cross-language service contracts, when needed
  runtime-client/             # typed asynchronous client, when Rust API exists
  reader-dom/                 # single specialist DOM document renderer, when needed
crates/
  core/                       # portable domain logic, when first implemented
  runtime/                    # native application use cases, when first implemented
  storage/                    # DB/migrations, when first implemented
docs/
  superpowers/specs/
  architecture/              # durable decisions, feature parity verification
tools/
  checks/                     # dependency and forbidden-control checks
.github/workflows/            # focused CI verification
```

**Do not create empty packages/crates to match a diagram.** Start with the client, desktop host, UI and theme packages plus one checkable screen. Add Rust crates and remaining packages only when their first tested feature needs them.

Package dependency graph (acyclic):

- `packages/theme`: presentation-oriented, pure rendering-token resolution and UI preview checks; canonical theme/settings acceptance, versioning and durable storage remain Rust-owned. No UI or host imports.
- `packages/ui`: depends on `theme`, RN/RNW, approved primitive libraries; **never** on features, Rust service clients, Tauri or platform-specific backend APIs.
- `packages/contracts`: versioned, preferably generated typed data/errors/capability shapes from the authoritative Rust protocol. It is not a dumping ground for UI concepts or a master list of linguistic categories.
- `packages/runtime-client`: consumes contracts and injected host transport; does not import UI, React or direct Tauri/Expo APIs.
- `apps/client/src/features`: imports public `@mlearn/ui/*` exports and the runtime-client; coordinates only presentation and pending input, never domain computations or durable state; cannot reach into another feature's internals.
- `apps/client/src/host`: sole consumer of Tauri bridge and Expo native module APIs. Host code implements runtime-client transport.
- `apps/desktop`: Tauri configuration, entry, capabilities, signed native code, and no feature JSX.

Allow narrowly justified `.web`/`.native` substitutions for UI adapters and host. The same `ReviewScreen` and `SettingsScreen` remain common files; platform-specific screen copies need explicit architectural review.

Root lockfiles: one npm `package-lock.json`, one root `Cargo.lock` after making the Cargo workspace. Avoid a second independently maintained Tauri crate lockfile.

## 5. Design system and accessibility

### Universal controls

`@mlearn/ui` becomes the only production home for interactive primitives:

- `Button`, `IconButton`, `Link`/navigation action, `TextField`, `Checkbox`, `Switch`, `Select`, `Dialog`, `Popover`, `Tooltip`, `Tabs`, `Panel`, `Text`, `Stack`, `Row`, `Skeleton`, `Status`.
- Build only the controls needed by the first vertical slice, then extend. Distinguish semantic controls; do not turn link/tab/switch into button variants.
- Use built-in React Native `Pressable` appropriately for `Button` (RN Primitives does not offer a general Button primitive); use maintained **RN Primitives** for complex headless dialog/select/popover/menu behavior **after testing native and web compatibility**.
- `@expo/ui` universal controls (present in SDK 57) can be used **inside** `@mlearn/ui` when genuine SwiftUI/Compose presentation is needed; do not mix public competing button APIs. Test how its `Host` interacts with custom styling and accessiblity.
- All icon-only actions must have a statically typed accessible name; each interactive control must expose correct role, disabled/loading state, keyboard/focus semantics and touch behavior. Prefer an explicit `label` contract rather than assuming decorative content is an accessible name.
- Reusable generic loading, empty/error/readiness affordances live in UI. A feature supplies pending/error data, not its own unbounded skeleton engine.

### Prevent `Button` / `Btn` / raw clickable elements

A checked-in ESLint configuration plus an architecture check script enforce:

1. Interactive native primitives (`Pressable`, `Touchable*`, low-level `TextInput`) and DOM interactive tags (`button`, `input`, `select`, `a`, clickable `div`) are forbidden **directly in feature/screen code**; use `@mlearn/ui`. Document exceptions for specialist reader/video input layers. Do not ban legitimate noninteractive semantics blindly.
2. Only `packages/ui` may import `@rn-primitives/*`, `@expo/ui` or direct control hosts; only `host` may import `@tauri-apps/api` or locally generated native modules.
3. Feature imports from other features' private paths, cyclic package dependencies, and duplicate exports are rejected.
4. Tests prove the guards actually fail on intentionally bad fixtures, not merely that they parse the code.
5. When a component is missing, add it to `@mlearn/ui` with a focused API and accessibility test—do not create a local `Btn2`.

Allow ordinary `View`, `Text`, static content and specialist rendering; the goal is semantic consistency and accessibility, not a superficial ban on markup.

## 6. Styling and arbitrary runtime themes

**Preferred portable styles:** `react-native-unistyles` v3. Styled component implementation and adjacent `Name.styles.ts` are the organizational equivalent of CSS Modules for universal RN + RNW.

- No global Tailwind/UnoCSS utility vocabulary. Use `Row`/`Stack`/spacing primitives and feature-local colocated styles for meaningful layout.
- Preserve CSS Modules selectively in `reader-dom` and exceptional web-only surfaces. Arbitrary browser CSS injection is **not** presented as portable native theming.
- A versioned, validated, JSON-serializable `ThemeDocument` contains editable semantic tokens for colors, typography, spacing, radii, visual materials, motion and component overrides; unknown namespaced fields survive roundtrips. Rust accepts and persists its canonical form; the UI schema/resolver supports preview and display. **Using JSON as a documented interchange format is not the same as using ad hoc JSON files as the application database.**
- A pure `resolveTheme(document, systemPreferences)` returns a complete `ResolvedTheme` with required tokens and validated values. No scattered hard-coded colors or per-component fallback cascades. Palette, dark/light setting, and material style (tactile/glass/flat) are separate axes.
- Apply the resolved theme to a stable Unistyles registered theme slot via runtime `updateTheme`. Arbitrary user theme IDs remain **application data**, not compile-time Unistyles theme-name unions. Use a separate CSS-variable adapter for the document renderer.
- Initialize a safe built-in theme synchronously before component styles mount; load persisted custom themes later, with a bounded visible readiness state. Theme switching must not remount application state, cause data refetches or lose draft ratings.
- A translucent material adapter chooses a web CSS or supported native material implementation and respects reduced transparency/motion and content contrast.

**Compatibility gate before committing Unistyles as foundational:** SDK 57 + RN 0.86 + React Compiler + Unistyles Babel transform + Nitro Modules + npm workspace `packages/ui` must compile and visibly update styles in **packaged Tauri web, actual iOS and actual Android**. Unistyles 3 requires the new RN architecture, custom native code, Babel, and Expo development builds (not Expo Go). Pin the matching Nitro version and prevent duplicate React instances. If it fails, compare an intentionally minimal `StyleSheet`-based fallback rather than patching around native/tooling errors across the app.

Sources: https://unistyl.es/v3/start/getting-started/ ; https://unistyl.es/v3/other/babel-plugin/ ; https://unistyl.es/v3/guides/theming/ ; https://rnprimitives.com/ ; https://docs.expo.dev/versions/v57.0.0/sdk/ui/universal/ .

## 7. Native capabilities and document exception

UI feature code requests semantic capabilities (`runtime.ocr.recognize`, `runtime.learning.submitAttempt`, etc.). Browser/desktop transports and Expo native modules implement a **typed, narrow contract** via host injection. Host availability and failure are explicit; avoid silently returning fake success. **Rust must own state, transactions, storage, policy and model lifetimes before any real user-facing feature claims completion.** No shipping Python dependency and no second mobile learning model.

### Persistence is designed anew

V3 is **SQLite-first**, with explicit schema migrations, stable IDs, indexes, transaction boundaries, recoverable event history, rebuildable projections and isolated attachments/media; all under Rust authority. State persists incrementally instead of rewriting an entire flashcard/settings/world JSON document on each interaction. Feature data can use typed relational columns plus structured, namespaced extension payloads when openness requires them; version and round-trip unknown fields. Avoid excessive table fragmentation or prematurely locking in compression formats.

**No opaque bit-packed integers hidden in JSON as core persistence.** Bit sets, varints, delta encoding and compressed blobs are legitimate inside explicitly versioned Rust codecs **only when measured and lossless**, with round-trip, migration and corruption tests. Compactness must not destroy provenance, exact retraction identities, unknown plugin data, or safe recovery. Record bytes-per-record, WAL/index overhead, and latency before claiming a compression win.

Preferences have an owned, versioned Rust schema, known defaults, explicit migration/forward-compatibility handling, and narrowly namespaced plugin extensions. Do not scatter settings in unrelated JSON files, expose legacy migration switches as new product settings, or duplicate defaults in UI hooks. V2 JSON and SQLite schemas are **read-only importer inputs**, not the normalized v3 data model. Import must retain evidence, histories, user assets and reversible recovery, not merely current flashcard summaries.

Rich EPUB/PDF/manga/vertical-text rendering is an explicit specialist DOM renderer: inside React DOM on desktop and, on mobile, a **bounded** Expo DOM/WebView surface with asynchronous serialized bridge messages. The reader does not gain privileged direct database access and does not have a WebView per word. Cross-boundary selection and annotation positions must have explicit stable IDs.

## 8. Tauri/Expo integration constraints

- Tauri's `frontendDist` points at Expo Router's single web export. Expo development server can remain the Tauri `devUrl`, while standalone browser and Tauri host differences are represented in host capability discovery.
- Change the placeholder Tauri `com.tauri.dev` identifier to a distinct `net.kikan.mlearn.v3dev`; keep Expo iOS/Android dev IDs similarly isolated from v2.
- Remove starter routes, `ThemedText`/`ThemedView`, duplicate color constants and starter tab system **as one tested replacement**, not by blindly deleting the working boot route.
- React Compiler remains enabled only if the Unistyles integration passes its explicit compiler-order/device gates. Use the supported Babel pipeline; do not enable incompatible SWC transforms.
- Replace `csp: null` with a restrictive, tested production Content Security Policy and explicit minimal Tauri capabilities. Debug allowances must never silently ship to production. Production app must load its packaged assets **offline** and not require Expo's development server.
- Mobile generated native directories stay reproducible through Expo config plugins and local modules rather than untracked direct modifications. iOS/Android build capabilities are distinct from browser Tauri host; no `tauri ios/android init`.

## 9. Verification and failure criteria

The first end-to-end proof is a **real Rust-owned persisted theme/settings interaction** through the same `@mlearn/ui` controls and feature screen on desktop, iOS and Android. A test-only component catalog can use synthetic values to verify UI states, but the app must not offer a fake, success-shaped settings or learner workflow while a Rust backend is missing. The next functional milestone is a Rust-owned rating → evidence → due projection → undo → restart flow.

Gates:

1. **Static:** `npm ci`; typecheck/lint; package boundary & forbidden-control tests; `npm run build:web`; Cargo metadata/check; no React duplicates or unstated platform dependencies.
2. **Desktop:** packaged/offline Tauri startup; UI and keyboard behavior, theme switching and focus; macOS native window; browser screenshot comparison to approved v2.9 desktop references (not to Expo starter).
3. **Native:** iOS + Android Expo development builds; same shared component tree; screen-reader focus/dismissal, accessibility labels, touch sizing; actual custom theme update with native Unistyles/Nitro.
4. **Theme:** user-loaded non-built-in theme, invalid document rejection, unknown extension data roundtrip, different material setting, OS appearance and reduced-motion interaction.
5. **Arch negative tests:** direct `Pressable` in feature, direct low-level third-party primitive, cross-feature private import, direct Tauri bridge in UI, imported TS learner policy, and unapproved renderer-side durable JSON/localStorage/AsyncStorage state owners must all fail CI.
6. **Long interaction:** bounded cache/subscriptions, no unbounded UI memory growth from theme changes and navigation; missing capabilities and pending states must settle or produce a real error.
7. **No declaration of full parity:** legacy data importer, full Rust learner/runtime/storage, plugins, OCR/TTS, native real-profile sessions and the rest of v2 remain unverified until individually demonstrated. Each feature's acceptance record includes the accepted/rejected historical behaviors, not a blanket 'match v2'.

Failures should report the precise platform, command, error, trace and affected feature. Do not mark unfinished real workflows as optional polish.

## 10. Implementation order after approval

1. Confirm source baseline; record which historical UI/behavior is accepted versus rejected; define authoritative Rust/UI boundary and failing architecture-guard tests.
2. Fix host metadata/CSP strategy; establish Cargo workspace with one reproducible lockfile and the smallest portable Rust runtime plus typed desktop/mobile command bindings. Keep existing Expo→Tauri boot intact.
3. Implement the **first real persisted Rust settings/theme command and query**, with versioned schema, SQLite transaction and restart/recovery tests. No temporary TypeScript settings authority.
4. Add `@mlearn/theme` **presentation-only** resolver and UI preview helpers. Prove its output matches the Rust-accepted theme document; bootstrap a built-in visual theme.
5. Integrate Unistyles + `@mlearn/ui` one control at a time; prove npm workspace Babel processing and the actual native target.
6. Add the first accessible controls, layout/material primitives and a test-only component catalog; CI rejects raw competing controls, cross-feature private imports and TS domain/persistence shortcuts.
7. Replace Expo starter routes with a thin route → shared real settings/theme screen; verify Rust commit receipt, restart persistence, visual theme switching and accessibility on packaged desktop and iOS/Android.
8. Only then design the next Rust-owned learner encounter/rating vertical slice with independently reviewed T2 semantics and stored sample data; expand subsequent features under their own plans.

**Scope boundary:** This initial architecture milestone implements only the minimal Rust storage/settings path required to prove the authority boundary. It does **not** implement the full learner database, compression, the T2 learning engine, v2 profile importer, language plugin runtime, ONNX inference, school feature parity or mobile reader fidelity. Those require separate designs and independently verified plans.
