# mLearn v3 — engineering contract

Greenfield implementation, not a line-by-line v2 port. Read `README.md` for commands and `docs/architecture/foundation.md` for actual boundaries and limitations. Historical design discussions do not override the rules below.

## Ownership

- **One UI:** `apps/client` is Expo/React Native on mobile and React Native Web on desktop. `apps/desktop` is the Tauri host, never another frontend. Thin routes compose shared feature screens. Platform differences belong in small host/UI adapters, not duplicate screen trees.
- **Rust is the application:** `crates/runtime` coordinates commands, `core` defines domain contracts, `storage` owns SQLite, `language-host` executes plugins. React owns display, focus, gestures, animation and unsaved drafts only. Never implement learner/scheduling/projection authority or a parallel JSON/AsyncStorage/localStorage database in the renderer.
- **One design system:** feature code imports `@mlearn/ui/*`. Only that package owns `Pressable`, `TextInput`, RN Primitives and other low-level controls. Do not create `Btn`, `CustomButton`, clickable text/divs or feature-local replacements. Add a missing semantic component to its owner with interaction tests. A link, tab or toggle is not a button styling variant.
- **Portable styling:** Unistyles and semantic theme values; no Tailwind/NativeWind/UnoCSS. Colocate component styles. CSS/DOM are reserved for explicitly owned specialist content such as the future document renderer. Native views are the normal shared UI.
- `@mlearn/theme` resolves presentation values; Rust validates and commits saved theme documents. User theme identifiers are data, not a hardcoded list. Do not duplicate durable defaults or hide storage errors behind fallback success.
- `@mlearn/runtime-client` sends typed commands through an injected transport. Only `apps/client/src/host` imports Tauri/Expo native module APIs. Generated contracts come from Rust via `npm run codegen`; do not edit their output by hand.

## Language extensions and distribution

- Language algorithms, schemas and language-specific dependencies belong to independently authored plugins, not core. Core provides execution, storage, resource access and open capability mechanisms, not a closed linguistic ontology. Preserve unknown namespaced structured values.
- Plugins use the Rust SDK and core Wasm/Wasmi. Do not introduce another interpreter or proprietary scripting language. The current ABI is an experimental integration contract, not yet a performance-certified NLP SDK.
- **iOS AND Android bundle executable plugins. Desktop does NOT bundle executable language plugins: it downloads code and assets from a trusted CDN catalog.** Code origin is selected by the native host, never a UI parameter. Mobile can download data through data-only interfaces; never disguise downloaded executable code as data.
- The hello plugin is a test/integration fixture, not language support. Desktop development uses a local signed catalog. Never trust its development key in release, publish its private key, or claim a production CDN is deployed.
- No network/filesystem/WASI access for guest code unless a bounded, explicitly reviewed host capability provides it. Keep execution, memory and message budgets. Do not copy entire dictionaries/models into renderer state.

## Reference and data integrity

- `archive/v2-final` (`1788f9c7`) is the T2 functional reference. Inspect exact historical revisions and screenshots; classify behavior as keep/change/reject/undecided. Do not preserve bugs, legacy settings or every recent UI change merely because they exist. Retain selected v2.9 visual ideas, not its component/state architecture.
- SQLite writes are incremental, transactional and Rust-owned. Never rewrite the full learner library on each interaction. No live v2 profile writes; use isolated v3 data and synthetic/sanitized fixtures.
- No per-review full-card revisions. The approved future history policy distinguishes session undo, compact recent evidence, coarse older summaries and versioned model checkpoints. A summary is not a fabricated review. Sync tombstones and user-authored content have separate lifetimes.
- Learning observations, self-claims, exposure and predictions are distinct. Do not silently turn an exposure into demonstrated knowledge. Review scheduling and user-selected practice remain separate.

## Verification and change discipline

- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build:web`; native scope additionally uses `npm run test:native`. Contract edits require `npm run codegen` and `npm run check:contracts`. Test real UI behavior with `npm run test:web` after exporting web.
- Architecture checks include negative fixtures: aliases/re-exports must not bypass ownership. Add a failing fixture before broadening a rule; exceptions must be explicit and narrowly scoped.
- A successful browser build does not verify Tauri IPC or mobile native modules. A successful simulator compile does not certify physical-device behavior. Report the exact platforms, tests and missing acceptance evidence.
- Never call stubs, test counts or an agent report feature completion. Inspect user-facing behavior, visual output, error states and persisted results. This foundation contains no actual learner model, OCR, speech or sync.
- Keep npm and Cargo lockfiles tracked. Use npm workspaces, not pnpm. Do not add empty packages, speculative frameworks or native dependencies with no implemented use.
- Work only on the authorized v3 branch. Do not modify v2, force-push, overwrite concurrent commits, kill processes by name, or use real user data in tests. Read branch HEAD before writing and preserve other contributors' changes.
