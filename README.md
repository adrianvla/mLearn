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

## H00 candidate verification and resume

Work on an `agent/**` delivery branch and open a PR to `rewrite/v3`. Foundation,
mobile and Linux desktop integration run on affected pushes to delivery branches
and `rewrite/v3`, with manual dispatch also available. Their commit checks attach
to the PR; opening or updating the PR does not duplicate the push runs. Other
branch names require manual dispatch. This also lets a documentation-only review
checkpoint skip application builds even when the PR already contains code changes. Mobile and
native desktop runs finish without cancellation by a later documentation edit.
Documentation alone does not schedule application builds. The foundation desktop
job builds on macOS and Windows; Linux has the separate WebKit interaction flow.
A build is not runtime evidence for an unexercised platform.

CI validates the committed npm/Cargo lockfiles and generated contracts without
committing source. When deliberately changing dependencies, resolve the relevant
lockfile locally (`npm install --package-lock-only --ignore-scripts` or
`cargo generate-lockfile`), review its diff, regenerate contracts only when needed,
and run the affected checks before committing.

For the prepared local H00 Mac, source `.mlearn/preflight/env.sh` in **each** shell
that needs Node 22, Java 17, Android SDK/NDK or Maestro. This ignored file describes
that machine, not a portable dependency. The preflight report retains the installed
versions and isolated device IDs. Keep `.mlearn/preflight/` and incremental native
outputs; they are evidence/build caches, not source.

To build offline mobile Release apps after shared UI changes (from the repo root):

```sh
# Run preparation/prebuild/pod install first if Rust, bindings or native config changed.
xcodebuild -workspace apps/client/ios/mLearnv3Dev.xcworkspace -scheme mLearnv3Dev \
  -configuration Release -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath apps/client/ios/build CODE_SIGNING_ALLOWED=NO build
(cd apps/client/android && ./gradlew :app:assembleRelease --no-daemon --console=plain)
```

Install the current Release artifact on a disposable H00 simulator/emulator, then
run `maestro --device DEVICE_ID test tests/mobile/foundation.yaml` (Android). For
iOS, prefix that command with `PATH="$PWD/tests/mobile/ios-driver:$PATH"`. The narrow
Xcode shim selects Maestro 2.11’s HTTP-server XCTest, avoiding its bundled helper
unit tests stalling in Xcode 27 crash-log teardown. It forwards unrelated builds
unchanged and does not skip any mLearn flow assertion; remove it when the pinned
runner selects its serving test itself. The checked-in
flow clears only `net.kikan.mlearn.v3dev`, invokes bundled Wasm, saves Slate through
Rust, restarts the process, checks persistence, opens the dialog, checks a rejected
native save and changes the greeting input. The pinned iOS XCTest driver loses
characters in bulk typing, so the small JSON fixture uses bounded per-character
native-value acknowledgements (about 11 minutes locally); the flow fails on any
loss and never retries a character. This is test-input pacing, not a product
input filter. iOS shared text fields expose Done without changing multiline Return. Android's existing CI entry is
`EMULATOR_PORT=5556 bash tests/mobile/run-android.sh` for the retained local device.
Use `--format junit --output PATH --test-output-dir DIR --debug-output DIR` to retain
Maestro results. Native CI uploads `ios-build-evidence` and `android-build-evidence`;
Linux uploads `native-desktop-evidence`. Retrieve a specific run with
`gh run download RUN_ID --dir .mlearn/h00/ci-RUN_ID`.

Record source commit/tree, app/bundle hashes, device/configuration and complete
command logs under `.mlearn/h00/`. Reuse Rust outputs only while their source and
configuration match; rebuild the consuming app for changed JavaScript. On resume,
read Git status/history and `docs/implementation/STATE.md`, then the local checkpoint
and retained command logs. Continue the next recorded action without resetting
source or rerunning successful unrelated builds. Stop at the named review gate.

For a local Mac app bundle use `CI=true npm run tauri -w @mlearn/desktop -- build --debug --bundles app`
(the Tauri CLI accepts boolean `CI`, unlike the preflight scripts using `CI=1`).
Mac development launches through `npm run dev:desktop` using the v3 identifier
`net.kikan.mlearn.v3dev`; the native profile is in
`~/Library/Application Support/net.kikan.mlearn.v3dev/`, separate from v2. Mobile
profiles are inside each disposable app sandbox. Never point tests at a live v2
profile. The foundation screen has no approved final visual reference; its current
composition is interim. Physical devices, distribution signing and Windows runtime
interaction remain separate from H00 simulator/emulator and build evidence.
