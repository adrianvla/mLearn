# mLearn v3 foundation

This branch contains a cross-platform integration foundation, **not the completed language-learning application**.

One Expo application renders with React Native on iOS/Android and React Native Web inside Tauri on desktop. A portable Rust runtime owns persisted settings and a bounded Wasmi plugin host. The placeholder demonstrates native state, theme editing and a Rust-authored hello plugin.

## Start on desktop

Prerequisites: Node.js 22+ and npm, stable Rust with the `wasm32-unknown-unknown` target, and Tauri's native platform build prerequisites. On macOS use Xcode command-line tools.

```sh
npm ci
npm run dev:desktop
```

The development command builds the sample plugin, starts a **local signed CDN fixture** on `127.0.0.1:7780`, starts Expo web on port 8081, and launches Tauri. The extra browser tab is suppressed. Ports must be free; the command does not kill another process to claim them.

In the Tauri window, choose **Install SDK example**, then **Run hello**. Its executable Wasm and separate greeting data travel through the catalog download and hash/signature verification path. Change the theme, close and reopen the application, and reload native state to inspect persisted settings.

The ordinary browser preview (`npm run dev:web`) explicitly has **no native backend**. Visual theme previews work there; it does not pretend to save settings or execute a plugin.

## Mobile development

Use an Expo **development build**, not Expo Go. The custom Rust module, Wasmi and Unistyles/Nitro are native dependencies.

```sh
# macOS + Xcode: builds Rust libraries and generates Swift bindings/XCFramework
npm run prepare:ios
npm run ios

# Android SDK/NDK, Java and cargo-ndk; set ANDROID_NDK_HOME when needed
cargo install cargo-ndk --locked
npm run prepare:android
npm run android
```

Preparation builds the same SDK fixture and embeds its executable into the **mobile Rust library**. No executable-code download interface is enabled for mobile. The tiny greeting JSON is bundled for this offline integration example; large language assets/data-only downloads are a subsequent package feature.

Generated Swift/Kotlin bindings, XCFrameworks, native binaries and Expo application projects are reproducible build outputs, not checked-in parallel implementations. Rerun preparation when the Rust interface or bundled plugin changes.

## Checks

```sh
npm test                   # architecture negative tests, theme and client tests
npm run typecheck
npm run lint               # AST ownership/boundary checks
npm run build:web
npm run test:web           # Playwright interactions and automated accessibility
npm run test:native        # builds sample Wasm, then Rust runtime/storage/plugin tests
npm run check:contracts
```

When Rust boundary types change, run `npm run codegen` and commit the generated contracts. The root npm and Cargo lockfiles are authoritative.

## Packages

| Owner | Responsibility |
|---|---|
| `apps/client` | One application screen tree; feature presentation and host injection |
| `apps/desktop/src-tauri` | Desktop window, bounded IPC and native runtime ownership |
| `packages/ui` | Accessible shared controls and layouts; no application services |
| `packages/theme` | Rendering values and unsaved preview support; no persistence |
| `packages/contracts` | Generated Rust protocol types |
| `packages/runtime-client` | Typed asynchronous native API, injected transport |
| `crates/core` | Authoritative request/response and theme document contracts |
| `crates/storage` | SQLite transactions, revisions and bounded command receipts |
| `crates/runtime` | Settings commands, plugin installation and invocation |
| `crates/language-host` | Wasmi validation, execution limits and origin policy |
| `crates/language-sdk` | Experimental guest ABI and asset access |
| `crates/ffi` | Mobile UniFFI binding; no second business implementation |
| `language-plugins/hello` | Independent Rust plugin fixture |

## Release configuration and limitations

Desktop release builds do **not** trust the generated development publisher key and contain **no executable language plugin**. Supply `MLEARN_RELEASE_CATALOG_TRUST` at build time as single-line JSON containing `url` (HTTPS) and `publicKey` (base64 Ed25519 public key). With no configured publisher, the UI reports that installation is unavailable. This repository does not publish a production CDN or contain a release signing key.

All v3 development identities and profile paths are separate from v2. The schema currently persists a small validated theme document in one SQLite row; it is not a whole-library JSON file. No real profile import or learner evidence storage is implemented.

The plugin ABI and resource limits are deliberately a **bounded hello-world prototype**: 4 MiB executable, 8 MiB fixture assets, 64 MiB guest memory, bounded messages and execution fuel. They are not appropriate defaults for large language dictionaries without the planned resource-streaming and analyzer benchmarks. No claim of full language support, native device acceptance, or T2 feature parity is made by the presence of a green build.

See [architecture](docs/architecture/foundation.md) and the GitHub Actions evidence for the exact verified scope. Source/asset licenses remain applicable; the archived v2 implementation is a reference, not copied production code.
