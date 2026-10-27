# M03-M07 review package

## Status and source

Prepared October 27, 2026. This is an incomplete review package, not maintainer
acceptance, release readiness or a claim that every platform gate passed.
M03-M06 and the M01-M04 architecture gate are `verified_for_continuation`.
M07 is implemented; the remaining verification and cleanup gaps below stay open.
Branch `agent/m01`, PR #44, remains OPEN/draft against `agent/h00`, unmerged.

The current product/test candidate is
`3ffc28fb7599bbf4945787b9ca8b23c84ea04761`, tree
`cd91e3d6176169ec3ce93d0d43f79955a7c48d93`. Later documentation-only commits
do not replace that source identity in the evidence. The M07 range from
`9640c9e4166c682b83e392dbb7753ea879d869b0` contains 190 changed files,
18,964 insertions and 1,284 deletions; these are scope, not acceptance metrics.

[STATE](STATE.md) is the current execution checkpoint.
The retained local index, exact commands, logs and captures are under
`.mlearn/m03-m07/m07-messenger/`, especially `REVIEW.md` and `PLAN.md`.
Historical pending/failure statements there are source-scoped; the current
sections supersede them without discarding their evidence.

## Milestone and architecture map

| Unit | Source boundary | Delivered responsibility |
| --- | --- | --- |
| M03 Capture | `4fdae38a..fbfb1a59cbee3173d95ff9e06bbc6c336fc5e7c8` | Rust-owned Material persistence, idempotent capture, duplicate/exclusion handling, bounded authored media and exact source Return |
| M04 Learning and foundation repairs | `fbfb1a59..f5f350ab62880378c23485552fc5aa306c033eba` | Package-defined probes, finite practice, granular ratings, native delivery, scheduling/evidence and exact Undo/resume |
| M05 Reader | `f5f350ab..620c0fafaf95f8844577e1df1eca7e9c4d905314` | Bounded TXT/EPUB/PDF, authored ruby/writing flow, immutable resources, contents/reflow and source continuity |
| M06 OCR | `620c0faf..9640c9e4166c682b83e392dbb7753ea879d869b0` | Native mobile recognition/rasterization; Python-free Rust desktop ONNX inference; authenticated optional resources; source regions/corrections |
| M07 Messenger and presentation integration | `9640c9e..3ffc28fb7599bbf4945787b9ca8b23c84ea04761` | Persistent People/Threads/messages, provider streaming/cancellation, shared explanations/Capture, reference-derived shared presentation and responsive source controls |

One React/Expo application serves native mobile and Tauri's frontend.
Host adapters own platform APIs. Rust owns settings acceptance, persistence,
Knowledge, source identity, learning decisions, inference and background work.
Shared annotated text, Inspector, Capture and source-practice owners serve
Watch, Reader and Messenger rather than duplicating domain state per screen.
Language semantics and Japanese OCR selection remain package-owned.

Review routes are `crates/core`, `crates/runtime`, `crates/storage`,
`crates/desktop-ocr`, `packages/contracts`, `packages/runtime-client`,
`packages/ui`, `packages/theme`, and `apps/client/src/features`.
Generated contracts are not a second renderer authority.

## Independent review and repaired failures

| Gate | Reproduced finding and resolution | Retained record |
| --- | --- | --- |
| M03 | Attachment provenance and unbounded media staging/output repaired; uncertain retries, preview recovery and Return remain covered | `.omo/evidence/m03-blocker-closeout-gate-review.md` |
| M04/foundation | Closed grade adjustment must retain grades/Untested; Pause interrupts native delivery; ready-audio focus releases pending state | `.omo/evidence/m04-foundation-gate-review.md` |
| M05 | Frozen Review Return must not re-read mutable Material; shared session/source routing repaired | `.omo/evidence/m05-reader-gate-review.md` |
| M06 | Settings must accept the genuine scalar native model-test response, not an invented array fixture | `.omo/evidence/m06-gate-review.md` |
| M07 | Uncertain explanation admission escaped cancellation; Person mutations left current attribution stale; edited questions could reuse pending intent. Real-core/HTTP reproductions and scoped closeout approvals are retained | `.omo/evidence/m07-gate-review.md` |

Later bounded UI repairs have root checks and actual native evidence, not
retroactive independent approval. They include shared menu/portal lifetimes,
bounded capture receipts, action order, sense selection, native Menu hit testing,
sidebar synchronization and local scroll-focus visibility.

## Current checks and platform evidence

| Evidence | Exact result and limit |
| --- | --- |
| Foundation `40456368381` | Detector, Rust, web, macOS and Windows jobs pass at the candidate source |
| Real Linux desktop `40456368198`, job `122030523329` | Real IPC, authenticated packages, playback/seek, contextual Inspector/shared claims, Transcript search, exact restart and missing-source recovery pass. Artifact `12713250736` matches commit/tree |
| Android `40456368189`, job `122030524178` | Original Watch/Inspector/Knowledge/source-resume flow passes: one test, zero failures, 400.793 seconds. Artifact `12713548234` matches commit/tree; JUnit and actual search frame inspected |
| iOS `40456368189`, job `122030523715` | Consuming app builds; original fixture creation fails with AVFoundation `-11821 Cannot Decode`, underlying `-16977`, then Swift SIGTRAP. Product UI assertions are not reached |
| Connected UI run 1121 | All 79 affected cases pass; typecheck, ownership lint and web export pass |
| Local macOS Focus QA build 1112 | One-job offline consuming build passes in 7.87 seconds; actual nested focus, corrections, source search, narrow layouts and restoration exercised |

The local app's UI SHA256 is
`f75c1e3568108e173bd5eb67ba71fb6dafa07ec0b01d8bc052d121f643d03f4b`;
executable SHA256 is
`30dd74de383c6c8ec0ef5f43db36743fa60ce1c3f42c7c15c12bac005687fea4`.
Its isolated identity is `net.kikan.mlearn.v3dev.m07qa`; the live v2 profile
is not used. Compiled iOS/Android artifacts are retained remotely as
`12715247983` / `12713197529`; iOS build evidence is `12716340366`.

Earlier genuine local iOS/Android Messenger demonstrations cover keyboard,
provider response, Copy, persistence/restart and exact request receipts.
They remain tied to their recorded consuming binaries, not relabeled as
final-source platform visual approval. The local review index maps their
frames, hashes and replay inputs.

## Actual workflows and captures

Launch through the documented `npm run dev:desktop` workflow with a separate
development profile. The evidence's retained compiled QA app may instead be
used only with its recorded isolated profile/source identity. Do not boot a
device, start a provider/reference server or download models automatically.
Inputs are available in `~/mlearn-test-corpus` and retained test fixtures.

| Workflow | Actual actions and evidence under the M07 evidence directory |
| --- | --- |
| Home/Settings | Normal launch reads persisted Dark Quartz/JLPT vocabulary/Auto. Inspect 1080x800, then foreground resize to 420x560: `final-home-{1080,420}.png`, `final-settings-1080.png`, `final-settings-420-foreground.png` |
| Settings dialog/package state | Open theme JSON, Shift+Tab from Close to Save without submitting; Escape restores trigger. Inspect installed English/Japanese and explicit unavailable optional catalog state: `final-settings-theme-minimum-focus.png`, `final-settings-packages-420.png` |
| Watch | Continue actual `test-video.mov`, pause at 25.24 seconds, open Vocabulary/synchronization and numeric offset; Escape returns to the offset control. Type `度胸` in Transcript; cue 3 at 0:24 remains through narrow reflow: `watch-final-vocabulary-sync.png`, `watch-final-transcript-{search,minimum}.png` |
| Inspector/corrections | Meaning Known -> Mixed; correct to Unknown; Withdraw restores Untracked. Nested editor Escape restores authoring trigger; minimum-window wrap reveals Save: `inspector-native-granular-meaning-*.png`, `inspector-native-nested-capture-focus-after.png`, `inspector-native-parent-focus-after.png` |
| Real Capture/Return | Bounded Saved action opens the actual newly captured Material and returns to the original source selection: `inspector-saved-native-{desktop,narrow}.png`; earlier message Capture/Return is `desktop-native-captured-message-return.png` |

The wide Watch frame is display-constrained to 1500x919, not the requested
1512x948. Its actual 25.24 seconds matches burnt-in 25:05. Authored subtitle
newlines, real package-derived word counts and source captions are preserved;
staged legacy counts, cue contamination and unsupported Anki status are not
copied. Native resize captures activate the owned app first: stale background
WebKit frames are excluded, not repaired by staging CSS or DOM.

## Performance, resources and preservation

Repeated same-input normal/optimized measurements, budgets and stage boundaries
are in STATE and `performance-timestamped-normal-{1,2}.log`,
`performance-optimized-sample-{1,2}.log` plus their UI traces. Warm operations
reuse analysis while refreshing Knowledge; six-cue Transcript uses one bounded
34-key Knowledge batch. Do not infer cold filesystem caches, arbitrary-model
accuracy, GPU execution or long-session storage growth from those samples.

Substantial local work is serial, with one Cargo job and fresh footprint,
pressure, swap-trend and workload-headroom admission. The final macOS run has
OmO footprint 3,128,882,304 bytes, app footprint 202,081,672, available memory
6,334,218,240 and normal pressure. Swap-out stays 45,199,720,448 during that run.
Prior recurrent OmO allocation spikes remain unexplained, not attributed to a
model/device or reported fixed.

Owned app/inspector/control/guard resources are released; PID 62114 is absent.
Normal Home/window state is restored. Read-only SQLite confirms original
source `19849|223042|-6350|1.0`. Existing themes, captures, profiles, models,
compiled apps, review records and the four original untracked files remain.

## Remaining discrepancies and remediation

1. **iOS verification:** preserve the expressly deferred FileProvider failure
   and the distinct current fixture-decoder failure. The post-repair Home
   progress/accessibility path has not been traversed. Do not call either green,
   weaken assertions or dispatch diagnostic variants to bypass the gate.
2. **Windows input reliability:** original keyboard-paste loss remains
   unexplained. Subsequent original checks and four alternating reopen/edit
   cycles pass with event-derived full-input assertions, but are not a causal
   fix. Retain diagnostic traces and inspect a recurrence before changing code.
3. **Historical cleanup:** exact paths/ownership receipts for several old worker
   roots are unavailable. The registered worktrees are only current, reference,
   orchestrator and restoration; unrelated roots stay untouched. No guessed
   deletion or blanket absence claim is made.
4. **Acceptance limits:** physical-device coverage, arbitrary-input recognition
   quality and long-session growth are not established. Transcript's full
   capture rows are denser than Vocabulary cards; unpictured states are not
   claimed pixel-identical. Final M07 closure remains open.

No M08, merge, release or maintainer acceptance is included in this package.
