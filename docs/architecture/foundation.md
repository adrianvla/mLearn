# Foundation boundaries

This is the current implementation record. It supersedes earlier design text where that text describes separate desktop/mobile frontends, lifetime exact event retention, or desktop-bundled executable language packages.

## One client, native authority

`apps/client/src/app` contains thin routes. Features use `@mlearn/ui` and the injected `@mlearn/runtime-client`. Only host adapters know Tauri or Expo native module APIs. The browser preview exposes absence of a backend; it does not install an in-memory fake application service.

Rust defines the wire types, validates settings, opens the isolated profile, commits a SQLite transaction and returns a revision receipt. The frontend only applies an accepted theme or an explicitly unsaved visual preview. Schema creation and its initial preference row are atomic. Stale writes are rejected; command receipts permit bounded retries. JSON is used as a documented small theme/interchange payload, not as a library snapshot database.

## Plugin code and data

The host policy is fixed at native startup:

| Platform | Executable source | Data |
|---|---|---|
| Desktop | Downloaded from a trusted signed catalog | Downloaded declared assets |
| iOS / Android | Compiled-in bundled Wasm | Tiny bundled integration fixture now; large data downloads later |

`language-plugins/hello` depends only on the SDK, never application core. Its namespaced capability and output are plugin-owned. The current macro handles allocation, call/result serialization and deallocation through a core-Wasm ABI. It does not claim Component Model compatibility. The structured error/data envelope is versioned and experimental.

Wasmi enables validation and auto-dispatch explicitly: debug builds cannot rely on LLVM tail-call elimination. An infinite guest loop must exhaust fuel, not overflow the host stack. Guest imports have no filesystem, networking or WASI access. Only declared, bounded assets are exposed. Host reads count toward a separate byte budget; Wasm instruction fuel alone cannot bound host functions.

Desktop catalog signatures cover exact payload bytes. Artifact sizes, SHA-256, relative paths, schema and ABI are validated. Release requires HTTPS; debug permits numeric loopback for the test CDN. There are no redirects. The local signer private key is generated under ignored `.mlearn/` and is never trusted by release builds. A complete publisher/update/key-rotation system is outside this foundation.

## UI constraints

Unistyles is initialized before Expo Router. An arbitrary theme document maps into one active runtime theme; its identifier is data. UI owns consistent button/field/dialog semantics, labels and disabled states. RN Primitives supplies dialog behavior; feature screens cannot import it directly. AST rules inspect imports, aliases, re-exports, DOM JSX and persistence APIs. These checks are safeguards, not a proof that arbitrary future UI is accessible.

Automated browser tests exercise missing-native state, theme updates, labels, dialog dismissal/focus restoration and WCAG checks. Native builds and physical screen-reader/keyboard behavior are distinct acceptance claims.

### Packaged desktop styling and CSP

React Native Web and Unistyles generate styles at runtime. Tauri's automatic style nonces/hashes caused the packaged WebKit view to reject those styles even though the same export looked correct in a browser. `dangerousDisableAssetCspModification` is therefore restricted to **`["style-src"]`**, whose policy explicitly permits inline styling. Script nonce/hash protection remains enabled, production scripts remain restricted to self, and object/network restrictions are retained. Do not change this to `true`, add production script `unsafe-inline`/`unsafe-eval`, or remove CSP to solve a styling problem.

The native desktop acceptance test checks computed typography, theme colors and hit-target size in addition to real IPC, signed plugin download, Wasmi invocation and restart persistence. A saved theme name alone is not proof that the theme is rendered.

### Mobile bindings and native build evidence

UniFFI-generated Swift/Kotlin remains build output. CocoaPods receives an explicit **target-local** generated FFI module-map path; merely linking the Rust static XCFramework does not make its separately named Clang module visible to Swift. `prepare:ios` typechecks the generated Swift against that unchanged module map before building Pods, then packages device arm64 and a combined arm64/x86_64 simulator slice. Do not patch generated bindings or change all pods' compiler settings to hide a missing import.

Android preparation builds arm64-v8a and x86_64 Rust libraries, with 16 KiB page alignment. This is not certification of every third-party library on a 16 KiB device. Release/device ABI support and physical-device behavior need explicit acceptance.

CI artifacts record the checked-out commit and source tree together with build logs and screenshots. Verify that evidence belongs to the code under review. Native compilation is not runtime UI acceptance on phones. Dependency audits are captured without automatic fixes; unresolved advisories require triage before distributing a production release.

## Deferred deliberately

The learner graph, models/HMM, rating history, summaries/checkpoints, sync, ONNX inference, real languages, package asset streaming, multi-plugin performance certification, storage import, and full product UI are not implemented. Add them as real vertical slices, not placeholder APIs that claim success.

The approved future history design distinguishes session undo, observations, coarse summaries and model-versioned checkpoints. Summaries must not become fictitious review observations; outstanding sync/correction references need a separate retention policy. This is a constraint for future work, not a current implementation claim.
