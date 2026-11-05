# mLearn v3

This branch contains a cross-platform integration foundation, **not the completed language-learning application**.

One Expo application renders with React Native on iOS/Android and React Native Web inside Tauri on desktop. Rust owns settings, learner state, Material, learning sessions, document preparation and bounded Wasmi language execution. Watch, Reader/OCR and the in-progress Conversation increment reuse the same language analysis, Inspector, Knowledge and Capture owners. Current source, verified scope and unresolved gates are in [STATE.md](docs/implementation/STATE.md); these are not parity or maintainer-acceptance claims.

## Start on desktop

Prerequisites: Node.js 22+ and npm, stable Rust with the `wasm32-unknown-unknown` target, curl for initial language-data acquisition, and Tauri's native platform build prerequisites. On macOS use Xcode command-line tools. Linux needs installed system fonts covering the displayed scripts; Japanese web and native verification use Ubuntu's `fonts-noto-cjk`.

```sh
npm ci
npm run prepare:language-data # once online: pinned public WordNet/Japanese inputs → local indexed data
npm run dev:desktop
```

WordNet acquisition tries the NetBSD pkgsrc CDN and distribution mirror before
Princeton. Every candidate must match the original 11,537,239-byte WordNet 3.0
archive and its pinned SHA-256 before atomic publication. Requests have finite
connection/transfer deadlines; failed downloads cannot poison the cache. The
conversion preserves the original version, Princeton attribution and license.
Already verified inputs remain usable offline.

The development command builds the sample plugin, starts a **local signed CDN fixture** on `127.0.0.1:7780`, starts Expo web on port 8081, and launches Tauri. The extra browser tab is suppressed. Ports must be free; the command does not kill another process to claim them.

In the Tauri window, choose **Get language packages** and install **org.mlearn.english** or **org.mlearn.japanese**. Select the matching package on Home, open a local video and attach its UTF-8 SRT subtitles. Select a subtitle word to inspect genuine entries/readings and change a granular Knowledge claim. Home lists actual sources and saved positions. **Settings** retains the H00 theme/runtime diagnostics. Unsupported analysis or host codecs produce explicit errors; import success alone does not establish decoding support.

The ordinary browser preview (`npm run dev:web`) explicitly has **no native backend**. Visual theme previews work there; it does not pretend to save settings or execute a plugin.

## Conversation

Open **Conversation** from Home. **People** stores reusable identities independently
of chats; Message opens the same person's direct conversation in the selected
installed language. **New Thread** creates temporary task-focused continuity with
an explicit purpose and participants. Saved content remains readable without a
working provider.

Open **Conversation actions → Provider** to configure an OpenAI-compatible chat
completions base URL and model. Rust saves the endpoint/model; an optional API key
is held only for the current native process. No bundled local LLM or default cloud
provider is supplied. Requests run only when sending or asking for an explanation.
Send/Stop, explicit response retry, drafts, history search, reply/edit/delete and
participant changes use the native storage/generation owner.

Visible completed messages prepare their language analysis before inspection.
**Show analysis** reveals it; Inspector supports the same Knowledge and Capture
workflow as other sources. Material Return restores its captured message revision
even after the current message changes. **Message actions → Inspect execution**
opens actual native prompt/request/response records without issuing another
generation. Platform verification and remaining visual discrepancies for this
increment are tracked in STATE.

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

Preparation bundles the SDK fixture and English/Japanese executables into the **mobile Rust library**, with pinned WordNet and Sudachi/JMdict resources for offline use. No executable-code download interface is enabled for mobile. Desktop obtains executable packages and data from its authenticated catalogue. Subsequent mobile updates are data-only.

Linux and Windows frame/clip capture requires local `ffmpeg` and `ffprobe` on
`PATH`, with PNG, AAC and libx264 encoders. Missing tools produce an explicit
unavailable error. macOS and iOS use AVFoundation; Android uses its platform
media APIs. Saved Material media is copied into Rust-owned authored storage,
independently of picker and capture temporary files.

Generated Swift/Kotlin bindings, XCFrameworks, native binaries and Expo application projects are reproducible build outputs, not checked-in parallel implementations. Rerun preparation when the Rust interface or bundled plugin changes.

## Checks

```sh
npm test                   # architecture negative tests, theme and client tests
npm run typecheck
npm run lint               # AST ownership/boundary checks
npm run build:web
npm run test:web           # Playwright interactions and automated accessibility
npm run test:native        # builds language/document Wasm, then Rust owner tests
npm run check:contracts
```

The native-backed Messenger browser tests need authenticated language fixtures
and the Rust QA executable. From a clean checkout, prepare them before
`npm run test:web`:

```sh
npm run prepare:language-data
npm run build:plugin
npm run build:documents
cargo build --locked -p mlearn-runtime --example runtime_browser_qa
```

When Rust boundary types change, run `npm run codegen` and commit the generated contracts. The root npm and Cargo lockfiles are authoritative.
Before direct Cargo checks that compile the runtime from a clean checkout, run
`npm run build:documents` to build its bounded PDF Wasm guest. The ordinary desktop,
mobile preparation and `test:native` commands already include this step.

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
| `language-plugins/english` | WordNet 3.0 analysis, morphology and linguistic schema |

## Release configuration and limitations

Desktop release builds do **not** trust the generated development publisher key and contain **no executable language plugin**. Supply `MLEARN_RELEASE_CATALOG_TRUST` at build time as single-line JSON containing `url` (HTTPS) and `publicKey` (base64 Ed25519 public key). With no configured publisher, the UI reports that installation is unavailable. This repository does not publish a production CDN or contain a release signing key.

All v3 development identities and profile paths are separate from v2. SQLite owns
bounded source projections, authored Material, explicit capability claims and
learning-session evidence. Claims do not create assessments, predictions or
Material. A real v2 profile import is not implemented.

The experimental plugin ABI now supports immutable indexed resources: 4 MiB executable, up to 32 MiB per SQLite resource / 40 MiB total package data, 8 MiB ordinary guest-readable assets, 64 MiB guest memory and bounded messages/fuel. The generic host admits only primary-key resource lookups, not guest SQL or access to learner storage. WordNet is 24.4 MiB; guest calls fetch bounded entries instead of copying the dictionary into Wasm or React. Broader analyzer benchmarks remain required before declaring a production SDK. No claim of full language support, native device acceptance, or T2 feature parity is made by the presence of a green build.

See [architecture](docs/architecture/foundation.md) and the GitHub Actions evidence for the exact verified scope. Source/asset licenses remain applicable; the archived v2 implementation is a reference, not copied production code.

## H00 candidate verification and resume

Work on an `agent/**` delivery branch. H00 targets `rewrite/v3`; the provisional M01 stack targets `agent/h00` and depends on PR #43. Foundation,
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

## M01 review and focused native flow

The current connected native flow is `tests/mobile/watch.yaml`. It uses the synthetic red/blue 30-second video produced by `python3 tools/create-watch-fixture.py <ignored-output-directory>`; this is deterministic regression input, not real-corpus acceptance. Android expects `m01-watch.mp4` and `m01-watch.srt` in Downloads. iOS expects those names in the development app's Documents/**M01 fixtures** folder. The workflow copies them there before running Maestro. `tests/mobile/foundation.yaml` retains H00's separate diagnostic flow.

M01 source, actual checks, unresolved coverage and manual review steps are recorded in [STATE.md](docs/implementation/STATE.md). Local raw evidence and the review packet `.mlearn/M01-review.md` remain ignored. Corpus media and private diagnostics are never PR artifacts. Neither milestone is accepted or merged by these checks.

The rescue implements the measured [Japanese analyzer resource/lifetime boundary](docs/architecture/japanese-language-boundary.md) and [bounded desktop media transport](docs/architecture/media-playback.md). The current product serves authorized ordinary GET/ranges over loopback HTTP; actual macOS originals and the Linux native playback gate pass. Japanese original-SRT Inspector/claim/restart flows run in the desktop and offline mobile apps. Codec support remains host-specific: the Android emulator decodes the original VP9/Opus WebM but explicitly rejects the original MOV's HEVC 10-bit profile. See the checkpoint for exact source, retained failures, pending gates and evidence limits.
