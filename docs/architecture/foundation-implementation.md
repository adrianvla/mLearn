# v3 foundation implementation

The maintainer authorized implementation of a hello-world foundation after choosing the universal UI and Rust-owned runtime. This milestone is not a language-learning implementation or a claim of feature parity.

## Binding decisions

- `apps/client` is the only UI: Expo native on iOS/Android, React Native Web in the Tauri desktop host.
- Interactive primitives belong to `@mlearn/ui`; themes are presentation data, while accepted settings and persistence belong to Rust.
- Language code is independent Rust plugin code compiled to core Wasm and run by Wasmi. It does not become a language-specific core dependency.
- **iOS AND Android bundle executable plugins. Desktop bundles NO executable language plugin; it obtains code and assets from a verified CDN catalog.** Mobile may download assets only. This supersedes earlier suggestions that desktop also bundles basic language code.
- The sample plugin is explicitly an SDK integration fixture, not a tokenizer. A local signed development catalog exercises the desktop download path without publishing to a production CDN.
- Recent user decisions replace lifetime exact replay with session undo and progressively coarser historical summaries/checkpoints. No learner history implementation is included here.

## Sequence and acceptance

1. Pin the working scaffold and run its web and macOS Rust checks. Add negative architecture tests before enabling the guard.
2. Establish native contracts, SQLite-backed theme preferences, bounded Wasmi execution and code-source policy. Test persistence, invalid input, fuel exhaustion, tampered modules and the mobile/desktop distinction.
3. Add the Rust-authored hello plugin and SDK, generated TypeScript contracts and UniFFI mobile bindings. Desktop must never link/include its Wasm bytes; mobile build resources must contain the same module.
4. Add UI/theme/runtime-client workspaces, replace starter routes with one honest integration screen and wire commands through host adapters. Plain browser preview must report the missing native runtime instead of faking persistence.
5. Add native build tooling, CI, browser interaction/a11y checks, and fresh-build verification. Update AGENTS and the README with actual commands and limitations.
6. Integrate onto `rewrite/v3` only after the implemented scope has passing evidence; never force-push or modify the v2 reference.

## Evidence ledger

Baseline `03b4f9b8`: GitHub Actions run 38312338408 passed Expo web export on Linux and the existing Tauri Cargo check on macOS. No Rust core or mobile native bridge existed at that baseline.

This environment cannot resolve external hosts directly. Builds and package resolution use isolated GitHub Actions runners; final reports must distinguish source/build verification from physical-device acceptance.
