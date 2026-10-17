# Current implementation checkpoint

## M01 — implementing

- Authorized by the maintainer’s overnight M01 instruction as a one-time exception; **H00 remains unaccepted**. No merge or M02 authorization.
- Branch `agent/m01`, exact provisional H00 base `87df9c137167601c6ae210ad2f663235f0a2a820`. PR will target `agent/h00`; PR #43 and its branch are unchanged.
- Current batch: Rust-owned source identity, subtitle import/windows, exact paused resume, capability claims and projections; real English WordNet package through Wasmi with bounded immutable indexed resource reads; typed shared client; Home/Watch/Annotated Text/Inspector and platform media/picker boundaries.
- Checks so far: focused source/claim red→green, real-package connected owner test, broader owner suites, npm tests/typecheck/ownership lint/contracts pass. Logs `.mlearn/m01/`. Mac current consuming bundle has opened synthetic local video/SRT through native pickers, inspected irregular “Children”, committed a meaning claim, and updated the subtitle to mixed-sense state. UI focus/density corrections and both consuming native builds are still in progress; no final verification claim.
- Initial package decision: English WordNet 3.0 (206,978 lexical senses / 147,306 lemmas), Unicode word spans and package-owned Morphy candidate rules, without contextual disambiguation. No Japanese support is claimed for the corpus SRT. Public source is SHA-256 pinned; private corpus originals remain untouched/unpublished.
- Remaining: connected desktop playback/resume/recovery and reference/layout checks, both-mobile real integration smoke, candidate-wide checks, final review packet and stacked PR. Resume from Git and `.mlearn/m01/checkpoint.txt`; continue M01 only.

## Frozen H00 record (unaccepted; retained below)

## H00 candidate

- Unit: **H00 — development and native application harnesses** only. Status: **awaiting_review**; no maintainer acceptance, **M01 not authorized**.
- Baseline: `rewrite/v3` at `a32a77d24ea4be1091e5c71420d43d8976557706`; no accepted H00 baseline. Historical plan input `b3e571dd9a70ce0a8fe280f1d2966aeccf720732`, original foundation `d726ea9f81bfc4a77e762487dec345eb56177eb4`.
- Candidate code/tests/CI: `194e284ed9ae3f9e6a794c88221e9d449085dc9b` on `agent/h00`, [PR #43](https://github.com/adrianvla/mLearn/pull/43). Final review-record commit changes documentation only. Application source is `62df5197ab32c2d0a745a5bf2e51ec0b29efcb4d`, unchanged through the candidate's test/CI corrections.
- Effective executor: **gpt-6.1-sol / medium**, verified from this session's `turn_context`; CLI **0.163.0** from `session_meta`. Harness `danger-full-access`, approval `never`; original checkout `/Users/adrian/dev/mLearn-v3`, no new worktree.
- Initial tracked changes: none. Only untracked `apps/client/modules/mlearn-native/android/build/`, confirmed generated Gradle output, retained with a precise ignore rule. Preflight and generated outputs preserved. Dependency manifests/lockfiles unchanged.
- Read-only reference: `/Users/adrian/dev/mlearn-ts` at actual `1788f9c74dc73dd884b687ec80d9550c3ebf6c6b` (`archive/v2-final`). Corpus and live v2 profiles untouched. All test data is synthetic in isolated `net.kikan.mlearn.v3dev` profiles.

## Delivered scope and repairs

H00 integration subset of **OPS-02, OPS-08, OPS-09**, plus the settings-editor recovery detail **OPS-15**. Other permission, diagnostics and accessibility experiences remain with their feature owners; this does not retire the full operations catalogue.

- Packaging regression reproduced under Node 22: the tool stub returned an SDK path for `find`. Corrected command-specific output; real inspection of assembled fixture headers now checks both matching device/simulator library names and rejection of embedded module maps. Native build implementation unchanged; no historical duplicate-module patch reapplied.
- First Android Slate navigation corrected **UP → DOWN**, matching the successful preflight diagnostic; all original greeting, edited-input, Rust save, restart and dialog assertions retained. Added exact Rust-rejected theme feedback and retained-draft assertions.
- Shared `@mlearn/ui` Dialog resolves its active surface/border/radius across the portal boundary through Unistyles. Both native dark-dialog captures are legible. Shared iOS TextField supplies native **Done**, preserving multiline Return and unsubmitted text.
- Pinned Maestro 2.11 starts helper unit tests before its HTTP server. On local Xcode 27 those helpers stalled in XCTest crash-log teardown; 120s and 300s startup attempts failed. A narrow Xcode invocation shim selects the serving XCTest and forwards unrelated builds unchanged. Its owner regression failed without selection and passes with it; CI uses the same shim. No vendor binary, generated binding or OS security setting modified.
- iOS focus-before-long-press is explicit. Bulk XCTest typing corrupted JSON even in eight-character batches. The bounded fixture enters each character once and verifies the native prefix before continuing; it never retries lost input. A complete focused probe reached the exact Rust rejection. The complete connected candidate flow passes below. The pinned [input helper](https://github.com/mobile-dev-inc/Maestro/blob/cli-2.11.0/maestro-ios-xctest-runner/maestro-driver-iosUITests/Routes/Helpers/TextInputHelper.swift) already documents dropped characters after its slow first-character path; this fixture uses that path with native-value acknowledgement. Android keeps compact ordinary typing.
- All three workflows cover affected `agent/**` and `rewrite/v3` pushes plus manual dispatch; commit checks attach to the PR without duplicate PR builds. Other branch names require dispatch. Documentation-only pushes do not rebuild apps. Native/foundation runs are not cancelled by subsequent pushes. The obsolete source-writing lock generator is removed; Windows build smoke is included.

## Verification and evidence

Full local logs, diagnostic failures and screenshots: ignored **`.mlearn/h00/`**; original **`.mlearn/preflight/`** retained. Artifact provenance: `source.txt`, `ios-artifact-sha256.txt`, `android-artifact.json`, `desktop-artifact-sha256.txt`. Rust/FFI/plugin inputs are unchanged from baseline; the new shared UI is in freshly rebuilt consuming apps, not the retained preflight binaries.

| Check / platform | Actual result and evidence |
|---|---|
| Locked install and fast checks | PASS: `npm ci`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run check:contracts`; `npm-ci.log`, `npm-test-final.log`, `typecheck-accessory.log`, `lint-accessory.log`, `contracts.log`. Packaging and driver-boundary red/green logs retained. Added web title locator initially failed, corrected and rerun in the same suite. |
| Rust owner tests | PASS: `npm run test:native`; `rust-tests.log`. Reused only for unchanged Rust/plugin/storage source and inputs. |
| Web / shared controls | PASS: `npm run build:web`, `npm run test:web`; `build-web-final.log`, `web-tests-final.log`. Desktop 1080×900 and narrow 390×740 dialog containment, theme, focus/dismissal and WCAG checks; rendered captures inspected. Browser plugin unavailable, existing Playwright used. |
| macOS native | PASS: `CI=true npm run tauri -w @mlearn/desktop -- build --debug --bundles app`; `desktop-build-final.log`. Current bundle via Computer Use: Ada greeting, Quartz/Slate Rust receipts, dialog/Escape focus, real quit/relaunch retaining Slate; `mac-final*.png` and AX. Earlier same-owner custom `h00.custom.slate` save/restart and rejected save also passed; `mac-interaction.log`. |
| iOS 27 Simulator | Release consuming build PASS: `build-ios.log`, `build-ios-accessory.log`; current app installed on `2C4A73B3-435F-4CD0-86E4-09F549DC3B4F`. Palette, greeting, save/restart, focus/Done and exact native rejection exercised; complete checked-in candidate flow **PASS (10m45s)** with the checked-in Xcode shim: `ios-candidate-flow.log`, `ios-candidate/junit.xml`. All captures inspected; exact draft, Rust rejection, Done and Ada result verified. |
| Android API 35 ARM64 | Release consuming build PASS: `build-android.log`, `android-original-daemon.log`, `build-android-accessory.log`. Current checked-in flow PASS (2m13s): `EMULATOR_PORT=5556 bash tests/mobile/run-android.sh`; `android-candidate-flow.log`, `android-candidate/junit.xml`. Exact draft retained through dismissal, Rust rejection, final Ada greeting. |
| APK integrity | Current APK has exactly arm64-v8a/x86_64 and both Rust bridges; `android-artifact.json`. Both Rust ELF LOAD alignments ≥16 KiB; `android-rust-load-alignment.log`. This does not certify every third-party library or a physical 16 KiB device. |
| Hosted foundation / desktop | At application source `62df519`: foundation [38978725702](https://github.com/adrianvla/mLearn/actions/runs/38978725702) PASS (web, Rust, macOS, Windows build); Linux real Tauri/WebKit [38978722126](https://github.com/adrianvla/mLearn/actions/runs/38978722126) PASS. Candidate verification source `194e284`: foundation [38980855057](https://github.com/adrianvla/mLearn/actions/runs/38980855057) PASS, including Windows/macOS builds. Linux application inputs are unchanged from its passing run. |
| Hosted native mobile | Initial [38974743068](https://github.com/adrianvla/mLearn/actions/runs/38974743068) at `3f08ad6`: Android PASS, iOS cancelled after ~55min with old driver/flow. Candidate [38980855025](https://github.com/adrianvla/mLearn/actions/runs/38980855025) at `194e284` is **pending** behind source `62df519` run `38978722169` (iOS consuming build and Android interaction in progress at last inspection). Hosted current mobile is **unverified, not passed**. Required local current-source Release builds and connected native gates pass independently; hosted confirmation is not inferred from them. Exact status in `.mlearn/h00/candidate-ci.json`. |

Local invocation/environment failures were retained and corrected or bounded: Tauri build needs `CI=true` rather than preflight `CI=1`; one duplicate owned Gradle invocation was stopped while the original continued. The emulator exited during compilation, then cold-boot System UI ANR obscured the first Android attempt; failures retained, exact H00 device restarted headlessly, OS Wait dismissed, full flow rerun successfully. None of these recoveries was added as an automatic product-test retry. Synthetic `simctl pbcopy/pbpaste` returned empty; current verification does not depend on that diagnostic route. Expo Doctor's direct `expo-modules-core` and six patch-version advisories were reviewed, retained in preflight, and not disguised as a green diagnostic or solved by dependency churn.

## Review / resume

The fresh session resumed from preflight + Git without resetting source or recreating setup. Independent shells source `.mlearn/preflight/env.sh` and resume from this record plus `.mlearn/h00/checkpoint.txt`, immutable source IDs and full log paths; temporary process handles are not the checkpoint. README records local build/launch, artifacts and failed-check commands.

Final packet: **`.mlearn/H00-review.md`**. Current capture mapping is `.mlearn/h00/evidence.json`; `ios-candidate-{result,rejection,restart}.png` and `android-candidate-{result,rejection,restart}.png` are explicit copies from the passing runs, not earlier attempts. Review current `target/debug/bundle/macos/mLearn.app` or `npm run dev:desktop`; mobile Release apps remain installed on the retained H00 devices (shut down after final capture; boot through Device Hub/Android Studio for review) (Android `emulator-5556`, AVD `mlearn-h00-api35-20261016`).

1. Run hello, enter Ada, run again; result is beside its action.
2. Select Quartz then Slate, wait for Rust's save receipt, quit/relaunch; Slate remains.
3. Open theme JSON: dark surface/title/description/label are legible. On iOS use Done to reveal Save/Close without changing Return/newline or the draft. Desktop Escape restores focus.
4. Set the JSON name to one space, Save: exact native name-validation error remains beside Save and the editor stays open. Close: saved Slate remains. Optionally save an arbitrary valid custom ID and restart.

Final mobile composition is **visual_pending**; the welcome harness has no edited reference. Relevant approved settings image inspected, no legacy layout copied. Physical iPhone/Android devices, Windows runtime interaction, distribution/signing and permissions/media workflows beyond this integration remain explicitly unverified. None is inferred from browser tests or build smoke.

No H00 acceptance has been supplied. The local H00 functional/platform gates support **awaiting_review**; hosted mobile confirmation and the named release/design gaps remain explicit. Candidate is frozen for the maintainer to accept H00 or request changes. **Do not merge or start M01.**
