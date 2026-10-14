# Review-gated implementation plan

**Goal:** Build the specified mLearn product as connected, usable increments, with a maintainer decision between increments.

**Architecture:** One universal React/Expo client calls a native Rust application. Knowledge, source context, annotated text, Inspector, Capture, learning sessions, settings and resource ownership are shared capabilities, not separately rebuilt services for each screen.

**Execution profile:** GPT 6.1 Sol, medium reasoning, as selected by the maintainer. This is the development executor, not the application's LLM provider or learner model. Use the installed coding harness; do not build a second agent platform to execute this plan.

**Authority:** [AGENTS.md](../../AGENTS.md), [SPEC.md](../product/SPEC.md), [required feature catalogue](../product/FEATURES.md). [STATE.md](STATE.md) holds the current unit, source and review status. The [reference guide](../product/REFERENCE.md) locates v2 and requested screenshots. These documents override old unbounded continuation instructions.

## 1. Execution and review loop

```text
Select the next authorized unit and its feature rows
    → inspect its reference behavior and current owners
    → implement a working integrated increment
    → run change-appropriate checks and the affected real workflow
    → freeze the candidate and provide a short review packet
    → WAIT FOR MAINTAINER REVIEW
        changes requested → repair the same unit → verify → review again
        accepted          → record the decision → open the next unit
```

Only the maintainer supplies product acceptance. Tests, screenshots, an independent reviewer or an agent saying 'complete' cannot supply that decision. A report such as 'the greeting runs' accepts that reported behavior, not every outstanding feature or mobile workflow.

Acceptance is tied to the candidate source and named feature scope. Revisions that change reviewed behavior require rechecking that behavior. No coding of the next feature while the current unit awaits review; read-only discovery may identify dependencies without creating a competing implementation. Internal work within a unit can proceed without repeated approval for every function or component.

If a unit is too broad for a meaningful single review, split it into named subunits before implementing it. Carry all feature IDs and dependencies forward; accepting the first subunit must not mark the parent or its omitted capabilities complete. A dependency change is discussed when it changes product behavior or the review boundary, not for ordinary private implementation choices.

### A review packet contains

- Candidate commit/tree, unit and exact feature IDs delivered; previous accepted baseline.
- What to run, fixture/input location and a short sequence of user actions with expected results.
- What changed in the live product; which shared capabilities were reused or extended; any intentional reference differences.
- Actual checks/targets/results, failed or unverified areas and the specific screenshots/clips needed for visual review.
- A request for acceptance or changes. No projected percentage-complete, generated marketing summary or bulk test-count argument.

Keep this packet in the current STATE record or its linked PR, not a new report hierarchy. After acceptance, record a compact entry identifying the decision and source, then replace the current working details with the next unit. Never manufacture the maintainer's approval.

### Review status

`not_started` → `implementing` → `verification` → `awaiting_review` → `accepted`.

`changes_requested` returns to the same unit. `blocked` records a concrete missing input/tool/decision and the next safe action. Missing tools are not passing checks. Failed tests remain failures until resolved or independently characterized within an explicitly accepted scope.

Track **functional/platform acceptance** separately from **mobile visual design**. A native workflow may be accepted with mobile design pending when its controls, text, touch/keyboard operation, navigation and accessibility remain usable. A pretty desktop screenshot cannot waive a broken native build, unusable mobile control or missing function.

## 2. Connected product boundaries

These names identify responsibilities and shared semantics, not mandatory new packages or frozen future function signatures. Use existing modules first; choose the smallest concrete API needed by the active unit.

| Boundary | Owned meaning | Reuse obligation |
|---|---|---|
| Knowledge | Stable capability targets, claims/evidence/predictions, native projection and version | All annotations, Inspector, learning, lists, goals and agents use it. No renderer-wide card/knowledge object as authority |
| Source context | Content identity/revision, language/variant, selected span/page/time/message, return position | Capture, Inspector, practice and conversation handoffs carry it without reconstructing context from screen text |
| Annotated text | Bounded analyzed spans, readings/linguistic display data, target mapping and Knowledge view | Subtitles first, then Reader/OCR/messages. No per-surface tokenizer or per-word request/subscription graph |
| Inspector | Contextual linguistic and learner inspection/actions | A popup and mobile drawer are presentations of the same feature; deep detail is not another status authority |
| Capture / Material | Authored item and source/media references, eligibility, duplicates and recoverable write | Every source creates compatible material; later collection tools do not migrate a temporary capture format |
| Learning session | Admitted task, cue/assistance, response, correction, receipt and resume | Review, deliberate practice, calibration and supported assessments share lifecycle with distinct evidence semantics |
| Conversation / world | People, messages, scope/witnesses, source canon and lived continuity | Text/voice/Rooms/Threads/Director/background jobs share identities and event ownership |
| Resources / settings | Accepted configuration, provider readiness, packages/models, jobs and budgets | Native providers and platform adapters cannot create parallel durable settings or unrestricted pools |
| Runtime Inspector | Actual execution/decision observability | Used by development, learning policy and agent tools; not confused with the linguistic Inspector |

**Batching contract:** choose a bounded relevant range, analyze it once per content/package/options revision, deduplicate target reads and retrieve Knowledge as a batch. Knowledge changes restyle/invalidate affected projections; they do not automatically reanalyze the document. Cache/prefetch by actual source and package identity, reject stale results and release subscriptions. 'One batch' does not mean loading an entire book or history in one operation. Streaming bounded results is allowed.

**Two-consumer proof:** when a second real surface is added, demonstrate that it uses the existing semantic boundary and that a change is reflected in both. Do not create a fake second consumer merely to justify an abstraction. Reuse semantic content and behavior, not a universal visual layout that cannot handle subtitles, document flow and OCR geometry.

**Vocabulary:** `Inspector`, `Knowledge`, `Material`, `Review`, `Practice`, `LearningSession`, `SourceContext` and `AnnotatedText` describe the new responsibilities. Legacy `WordHover`, `FlashcardContext` and route/window names are reference search terms. Renaming does not authorize a god-context that owns all knowledge, UI and storage.

## 3. H00 — reliable development and application harnesses

**Historical planning baseline:** `b3e571dd9a70ce0a8fe280f1d2966aeccf720732`; original application foundation was squashed at `d726ea9f81bfc4a77e762487dec345eb56177eb4`. Subsequent commits `b3ccc00b6` and `e3cebd9c2` altered native packaging and launch behavior. Re-read current HEAD, source and current CI before diagnosing; do not recreate scaffold, reapply a fix that has landed or revive `work/v3-foundation`.

**Scope:** reliable source/build/test/review handling plus the existing hello/settings native integration. No learner, media or new UI feature starts before H00 is accepted.

### Existing evidence and concrete blockers

| Evidence | What it establishes / what remains |
|---|---|
| Foundation workflow `38404304561` at b3e571dd | Existing web/Rust/foundation checks passed. It is not proof that native mobile workflows work |
| Native desktop workflow `38377484637` at d726ea9 | Linux Tauri/WebKit sample download, invocation, theme and restart path passed |
| Maintainer Mac checks in this conversation | Hello response, actual theme change, saved theme on restart and theme editor were reported working |
| Native mobile workflow `38377484585` at d726ea9 | iOS build failed; Android release build/ABI checks passed but the interaction flow failed |
| iOS `ios-build-evidence`, artifact `11802962825` | Two definitions of `MlearnRustFFI`: generated headers module map and copied XCFramework intermediates module map. Standalone binding preparation did not catch the full consuming-app failure |
| Android `android-build-evidence`, artifact `11803122199` | JUnit reports no visible `Slate`. Screenshot shows a real `Hello, world!` response; the flow searches upward for Theme after the result was moved above Theme. Treat stale navigation as a concrete hypothesis and reproduce it, not as certification of the remaining flow |

These are pinned historical evidence references, not an instruction to rerun obsolete commits or assume current HEAD still has the same defect. For `e3cebd9c2`, native UI verification still failed on both platforms (run `38453671706`), foundation web tests failed while Rust/desktop checks passed (run `38453671823`), and desktop native integration passed (run `38453671797`). Reproduce and isolate the **current** failures before editing. Expired artifacts require a fresh reproduction, not guessed logs.

### H00.1 — establish the execution session

**Owners to inspect:** `AGENTS.md`, this plan, STATE, root `package.json`, `rust-toolchain.toml`, `README.md`, current worktree and actual coding-harness settings.

- Verify the active model and effort are the maintainer's chosen Sol/medium. In Codex, use the supported model/reasoning controls and status display. Do not assume a marketing label is an accepted CLI alias or silently substitute another model. Record the effective selection, harness version and permission/worktree scope once.
- Confirm the harness can read both v3 and the read-only reference, edit the authorized worktree, run a focused command, inspect its exit code/log, launch the relevant app, and retrieve a screenshot. Do not grant blanket filesystem/network permission to compensate for a missing tool.
- Confirm a session interruption can resume from Git and STATE without resetting source, redoing accepted work or losing the next required action. Keep commands and artifacts discoverable; temporary process handles are not the only checkpoint.
- Ensure the harness stops at `awaiting_review`; no automatic 'continue until entire app done' loop, self-approval, or human-approval text written by the executor.

**Pass:** one bounded work item can be resumed, its source/result identified, and it ends at the review gate. A manually entered user decision is required to advance.

### H00.2 — verify source identity, isolation and fast checks

**Owners:** root scripts/lockfiles; `tools/checks/`; `tools/dev-desktop.mjs`; `tools/prepare-plugins.mjs`; native host/profile configuration; existing test fixture creation.

- Confirm v3 profile/application identities cannot target the live legacy `net.kikan.mlearn` data. Display/title changes remain independent. Tests use explicit disposable profiles and authored/sanitized fixtures.
- Run dependency install with the checked-in lockfile, existing focused tests/typecheck/ownership checks and generated-contract check as appropriate. Record exact commands and source; do not resolve dependency drift with forced installs or regenerate lockfiles just to make CI match a local machine.
- Exercise an existing failing fixture or a temporary local deliberate contract violation to prove the check fails for the intended reason. Restore it before proposing the candidate. Do not add a new test framework or committed failure marker for this demonstration.
- Confirm logs and source provenance identify the binary actually executed; stale generated Swift/Kotlin/native libraries cannot pass as current Rust. Renderer-only HMR is not a native rebuild.

**Pass:** checks can fail meaningfully and pass when corrected, and neither testing nor restarting touches v2 data or silently mutates tracked source.

### H00.3 — fix the iOS build boundary

**Files:** `apps/client/modules/mlearn-native/ios/MlearnNative.podspec`, `tools/build-mobile.mjs`, relevant existing checks under `tools/checks/`, `.github/workflows/v3-mobile.yml` and generated outputs for inspection only.

- Reproduce/read the duplicate `MlearnRustFFI` definition at the actual consuming application boundary. Compare generated headers, the XCFramework slice and CocoaPods' propagated search/module flags.
- Make one owner expose the FFI module to consumers. Do not edit generated UniFFI source, disable module checking globally, remove the native backend, or change every Pod's compiler flags. Retain matched slice filenames, correct simulator/device separation and a reproducible clean build.
- Strengthen the closest useful packaging regression; a string assertion that merely preserves today's podspec is insufficient. Verify the generated binding and consuming app, not only independent Swift typechecking.
- Build and launch the actual iOS Simulator app. Complete the existing offline hello → native theme save → process restart path and check a deliberately rejected command has usable feedback.

**Pass:** current-source native app compiles and runs on Simulator with real bundled Wasm, native SQLite and native UI; no Metro/JavaScript fake backend used as evidence. Physical iPhone and distribution signing remain separate release checks.

### H00.4 — repair and verify Android interaction evidence

**Files:** `tests/mobile/foundation.yaml`, `tests/mobile/run-android.sh`, shared feedback components only if a real application defect is reproduced, and `.github/workflows/v3-mobile.yml` where required.

- Inspect the failing hierarchy/screenshot. Reproduce whether the direction/selector became stale after feedback moved into its source panel.
- Locate the real control robustly within the relevant section. Do not move good UI to satisfy an old test, use invisible controls, suppress the assertion or replace native transport with a mock.
- Complete the whole flow: bundled plugin invocation with changed input, theme application, confirmed Rust save, process restart, retained value and dialog interaction. A greeting alone does not cover later steps.
- Verify the release artifact includes every advertised native ABI and does not claim support for missing Rust slices. Preserve the documented Android page-size/linkage checks and state what they do not prove about other native libraries.

**Pass:** current-source Android app executes the complete real workflow; fixture/navigation failure is distinguished from application failure.

### H00.5 — make verification proportional and reusable

**Files:** `.github/workflows/v3-foundation.yml`, `v3-mobile.yml`, `v3-desktop-e2e.yml`, `v3-resolve.yml`, relevant root scripts and README.

- Remove the obsolete feature-branch-only source-writing lock-generation path or replace its legitimate need with explicit local generation and non-mutating CI validation. Tests must not commit code behind the review candidate.
- Verify branch/PR/manual triggers cover the actual delivery branches and protected integration branch. Avoid duplicate push/PR work for the same candidate without leaving coverage gaps. Documentation-only changes need document checks, not all native builds.
- Avoid repeatedly cancelling lengthy native validation because an unrelated documentation or screenshot-test file changed. Cache dependencies/build outputs only with appropriate source/configuration keys; identify stale artifacts before trusting them.
- Keep the existing web, Rust, Tauri and native-device test tools. Add only missing launch/fixture/log plumbing; no broad coordinator service, continuously polling daemon or large review automation framework.
- Document the actual local commands, native prerequisites, source/profile location and artifact retrieval. Preserve the maintainer's ability to run a failed check manually. Desktop platform gaps, including Windows, must be named; obtain an available Windows build smoke check before claiming all desktop hosts, without making up runtime evidence.

**Pass:** one coherent current-source verification can be run, inspected and resumed; unrelated edits do not force repetition, and failed/missing targets remain explicit.

### H00 review gate

The review packet contains working Mac launch instructions, iOS Simulator and Android emulator evidence, exact known desktop gaps, the chosen development model/effort and a demonstrated stop/resume procedure. Stop for the maintainer to accept H00. Do not claim the product or a production SDK is complete.

## 4. Ordered product increments

Each row is a review boundary. The executor reads its feature IDs, shared contracts and v2 sources before coding. The work item includes the settings, errors, storage and source continuity needed for that increment, not a disconnected demo. Changes may use ordinary modules; the table does not authorize creating every future package immediately.

### M01 — Watch → Inspector → Knowledge

**Deliver:** a real local video/subtitle source using a real initial language package, bounded annotated text, contextual Inspector, explicit Knowledge claim changes and exact source resume. Replace the integration home with useful entry/recents and retain native diagnostics outside ordinary content.

**Owns/extends:** source identity, batched analysis/Knowledge access, basic Inspector, initial real package data, shared navigation. Existing theme/runtime/host/storage mechanisms remain the foundation. No `FlashcardContext` or `WordHover` API in the new product.

**Review:** open content, play/pause/seek, inspect several occurrences, change one capability claim, confirm relevant annotations agree, close/reopen and return to the same source. Demonstrate a failed/missing file or package without losing existing state. The first native language integration receives both-mobile smoke coverage.

**Catalogue:** all M01 rows. If this exceeds a useful review, split source playback and connected linguistic inspection into M01a/M01b, with no 'feature complete' claim before the connection exists.

### M02 — full subtitle interaction and language-package management

**Deliver:** remaining track/timing/ASS/transcript controls, source/definition-language independence, rich Inspector data and deliberate activation, active reading/color aids, real package install/update/remove/failure flows and third-party capability conformance.

**Consumes:** the same source/Knowledge/Inspector path from M01. Do not create a `VideoWord` service separate from shared analysis. Validate a structurally different plugin and unknown structured data without hardcoding it into core.

**Review:** change source and definition language independently; install/retry/update a package; navigate and resynchronize subtitles; inspect ambiguity and a long entry. Confirm stale analysis cannot repaint the wrong source. Check documented subtitle limitations rather than declaring all formats equivalent.

### M03 — capture → Material → source return

**Deliver:** one capture path from Inspector/subtitles, source sentence/anchor/media references, duplicate handling, author/edit a saved item, basic material list, single/bulk eligibility and failure retry, exclusions and source-scoped practice handoff data.

**Consumes:** source context and Knowledge. Capture does not create a separate learner model or store full media in every observation. A future practice destination may remain unavailable until M04/M11, but saved scope/return identity must be valid rather than a fake action.

**Review:** capture a word/context and segment, edit it, repeat the capture without accidental duplication, inspect the saved source and reopen it. Fail one bulk item and retry without repeating successful writes.

### M04 — real Review and shared learning-session lifecycle

**Deliver:** native scheduler-led review, compatible granular probes, written/audio direction, reveal/rating/Adjust/shortcuts, automatic probe candidates, idempotent submission, correction, exact pause/resume and explicit finite versus continuous sessions.

**Consumes:** Material, Knowledge, packages and source context. Establish task/evidence/model version boundaries needed by the later predictor. Use a tested honest baseline scheduling policy until the reviewed predictive controller arrives; do not label placeholder probabilities as intelligence. Required audio playback must work here; general voice-provider expansion follows in M08.

**Review:** use material captured in M03; rate mixed capabilities, Undo/correct, force a recoverable write failure, retry/restart, resume the exact revealed state, and return to the original video. Keep a local sustained-work fixture for early resource measurement, not only an empty profile.

### M05 — text/EPUB/PDF Reader through the shared language path

**Deliver:** structural text/EPUB, usable PDF text path, authored ruby, vertical/horizontal flow, source-anchored reflow/resume, navigation and accessible long content.

**Consumes:** Annotated Text, Inspector, Knowledge, Capture and Review. Extend a source adapter; do not copy subtitle or per-token state into a Reader-specific knowledge stack.

**Review:** inspect and capture from a book; change typography/orientation; revisit the exact passage; review the capture and Return. Demonstrate the same target's claim change in Reader and Watch without reinitializing either language pipeline.

### M06 — image/PDF OCR and complete image-reading interaction

**Deliver:** on-device recognition, image/folder pages, crop recognition, aligned text and recognized-text mirror presentation, annotation hiding, magnifier, spread/collation/fit controls, OCR queue/cache/retry and unknown-word side actions.

**Consumes:** Reader source coordinates, shared text/Knowledge/Inspector/Capture and a native model/provider resource owner. The initial iOS provider is Apple's Vision text recognition through a Swift Expo native-module adapter; Android must use real offline OCR, with bundled ML Kit Text Recognition v2 as the first candidate to evaluate. Supported language/script information is obtained from the executing provider rather than a hardcoded core map. Use shared normalized image coordinates and source orientation, preserve provider identity and recognition candidates, and let installed language packages postprocess available OCR results without choosing a hardcoded per-language engine in core. Desktop retains its independently tuned OCR paths. Do not port MangaOCR/PaddleOCR/Python or force ONNX on mobile as a prerequisite to the first release.

**Reference and fidelity gate:** inspect `archive/v2-final` `src/root-of-app/routes/ocr.py` and `src/renderer/utils/ocrUtils.ts`, including real language runtime metadata, detection/recognition separation, downscaling, vertical regrouping, crop coordinates, box/annotation filtering and caching. The Japanese desktop path runs PaddleOCR detection then MangaOCR recognition; this tuned behavior is a reference, not a mobile implementation mandate. Keep a small representative corpus with vertical manga/ruby, horizontal mixed text, glare/low contrast, one crop and a two-page spread. Compare recognized content, source geometry, hit behavior and processing/lifetime costs; do not demand byte-identical outputs from unrelated OCR models.

**Review:** use a real licensed/sanitized image/PDF with main text and annotations, then a spread. Crop/reprocess, resize, hide/reveal annotations, magnify, inspect and capture on each page. Verify exact mirrored-presentation behavior against the selected reference before acceptance. Test native Vision/Android OCR offline on actual supported languages and record unsupported ones; test cancellation/retry and image/orientation transforms on both mobile platforms. No custom neural model port or cosmetic mobile redesign is part of this unit.

### M07 — People, temporary conversations and contextual explanations

**Deliver:** Contacts independent of conversations, usable history/composer/streaming/error flow, task-focused Threads, contextual explanation/correction, language inspection/capture inside messages and initial real Runtime Inspector.

**Consumes:** shared source/Annotated Text/Knowledge/Capture, settings/providers and native job lifecycle. No new analysis starting exclusively on hover, transcript store per view or generic dashboard instead of messenger.

**Review:** start a conversation from a contact, inspect/capture a message, stop/retry generation, read older history while new content arrives and reopen with the provider unavailable. Inspect the actual prompt/tool response without exposing secrets. Source-based explanation returns to the same reading/video context.

### M08 — shared speech and native calls

**Deliver:** provider/model management, microphone/STT/VAD, TTS/playback, persistent voice selection, supported authorized voice-reference workflow, interruption and call recovery. Extend rather than replace M04's audio delivery behavior.

**Consumes:** common provider/resource management, messages/People and learning assistance semantics. Native output is not an independent speech app; Inspector and Review use the same provider contracts. Preserve the tuned local desktop Qwen3-TTS path identified at `archive/v2-final` `src/root-of-app/routes/voice.py`: `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit` with 24-kHz output, 0.32-s streaming interval, reference audio/transcript, and its selected generation parameters (`temperature=0.9`, `top_k=50`, `top_p=1.0`, `repetition_penalty=1.5`, `max_tokens=4096`). The separate `qwen3_tts_server.py` defaults to a 1.7B remote model and is not this local reference. Evaluate reusable Rust/native inference implementations against a small audio/reference corpus; retain streaming, actual delivered-text and interruption semantics. Differences from tuned settings require a reason and a listening/test comparison, not a silent default change.

No native mobile Qwen3-TTS, Kokoro, MangaOCR or PaddleOCR model port is required for the first mobile product release. Future mobile voice may use a declared system or remote provider within its true capabilities. Never report a fallback provider as though the selected model ran.

**Review:** pronounce an Inspector item, run an audio probe and make an interruptible conversation call. Verify generated versus delivered transcript and permission/error paths. Perform targeted native audio lifecycle tests and real model memory measurements.

### M09 — optional Sea/Rooms and scenario continuity

**Deliver:** persistent Rooms, shared People/cast identity, Scenario Director, deliberate Thread integration, witness-limited memory, source canon/progress versus lived history and a coherent task-focused versus Living World mode.

**Consumes:** working Messenger, sources, Knowledge and voice. No cloned participant for every scenario or separate scenario messenger. Structural events remain under Rust authority.

**Review:** reuse a person across a Thread and Room, integrate selected continuity, test an absent participant and a spoiler/canon boundary, correct/delete a message and inspect affected memory. Confirm ordinary task-focused use still needs no world setup.

### M10 — dense Knowledge and Material management

**Deliver:** complete large-list search/filter/sort, bulk actions, generation/suggestion review, source/content search, evidence/graph detail and package-supported character/writing views.

**Consumes:** already-used Knowledge, Material, Capture and Inspector. The list is another bounded view, not a global renderer store. Generated proposals are not admitted observations.

**Review:** use mixed captured/manual/import-fixture material; filter and bulk-edit a large set; inspect status basis and a graph relation; make a change and see source annotations and Review agree. Test one missing optional provider without losing saved content.

### M11 — deliberate practice, calibration and grammar

**Deliver:** exact scope practice, Word Sync/calibration, supported grammar detail/recall/contrast/typed tasks, expert probe authoring and shared session controls.

**Consumes:** M04's admission/evidence/correction/resume and M10's scope/material selections. Different purposes remain explicit instead of one generic exercise mode. Content/validator delivery is required, not just schemas.

**Review:** open a source-filtered practice, suspend it, calibrate a different scope, resume the first task, exercise valid and unsupported grammar tasks, and inspect the difference between self-report and validated evidence.

### M12 — structured outcomes, assessment and Plan

**Deliver:** package-defined goals/subsets/deadlines/constraints, passive scope inspection, genuine supported fixed/timed assessments and result-to-practice return.

**Consumes:** Knowledge, content, learning sessions and real package assessment mappings. Do not invent exam calibration or resurrect free-form legacy goal/status forms.

**Review:** choose a scope with overlap and an unavailable subgroup, inspect coverage, complete a supported assessment, open the relevant practice and return. Explicitly show what cannot be concluded from the available scoring/evidence.

### M13 — learner prediction and decision policy

**Deliver:** versioned learner predictor/HMM, honest checkpoint/recent-history initialization, action selection across environments and useful decision inspection, respecting goals, feasibility, costs and already admitted work.

**Consumes:** real observations, tasks, opportunities and provider constraints from earlier units. Differentiate measurement, instruction effects and information value. A changed prediction must not become a successful review or mutate a current cue.

**Review:** use fixed contrasting histories and realistic sources to inspect recommendations, alternatives and uncertainty; demonstrate continuing immersion/defer as legitimate choices. Compare predictions against a baseline with held-out chronology; performance improvements need representative release measurements. Do not require the maintainer to operate model internals to use the product.

### M14 — progress and bounded historical storage

**Deliver:** useful evidence-linked progress/history, storage categories/budgets, compact old observations/summaries and model checkpoints, cache cleanup and recovery-safe compaction.

**Consumes:** stable admitted evidence/model identities, not a second analytics journal. Define how old details age out and how model versions continue when exact replay is impossible.

**Review:** inspect a long synthetic/sanitized history, compact it, compare current state and aggregate counts, restart during recovery, and explain retained versus discarded detail. Do not collapse incompatible capabilities or delete content/messages as 'history'.

### M15 — reflection, autonomy and proactive contact

**Deliver:** grounded Dreamer/consolidation, bounded fictional intentions/occurrences, optional proactive invitations and complete runtime inspection/cancel/retry.

**Consumes:** Sea/Thread visibility, shared People, jobs, resources and learner policy. Publishing a message, memory or invitation follows the same authority/lifecycle as foreground work.

**Review:** inspect a background run, interrupt/restart it, verify once-only publication and witness bounds, decline/mute contact, and confirm no fabricated human participation or uncontrolled external action.

### M16 — real legacy/Anki exchange

**Deliver:** supported v2 profile and Anki/material import/export, preserved IDs/content/provenance/media, live Anki integration where available, source-safe activation and conflict/retry handling.

**Consumes:** stable canonical owners from earlier units. Inspect real import fixtures early during M01/M03/M04 schema decisions; do not wait until this unit to discover basic legacy evidence shapes. This unit delivers the complete user-facing importer, not years of unused prototype-format compatibility.

**Review:** import an isolated copy, inspect retained material and evidence, export and round-trip, rerun without duplication, and simulate a missing peer/failed mapping. The original profile remains unchanged. Only actually shipped or explicitly designated data formats require compatibility.

### M17 — pairing, sync and cross-device continuation

**Deliver:** local-authorized peers, optional supported hosted/self-hosted sync, canonical action/evidence transfer, conflicts/tombstones/assets and exact compatible task/source continuation.

**Consumes:** all existing identities and durable owners. Do not sync a renderer snapshot or replace learner evidence with the final color of a badge. Authorization and data scope are explicit.

**Review:** continue a source and learning task between desktop and mobile, perform concurrent/offline edits and retry, reconnect an old peer, and verify no resurrection or double admission. Missing local media has an explicit resolution rather than a new blank task.

### M18 — shared watching and collaborative media use

**Deliver:** Watch Together session create/join, real playback coordination and links into the existing source/learning/conversation flows.

**Consumes:** the existing player, source identity, participants/network authorization and sync primitives where applicable. A room identifier is not permission to distribute its media.

**Review:** two peers seek/pause/reconnect, inspect/capture during playback and preserve individual learning state and source availability.

### M19 — external capture and host integrations

**Deliver:** supported overlays, external definition entry, browser-extension/online-subtitle paths, PiP or justified utilities and mobile share/import alternatives.

**Consumes:** the same SourceContext, Inspector, Capture and player. Add host adapters, not separate mobile/desktop domain code. Record actual OS/site capability limits.

**Review:** capture an external occurrence into the existing workflow and Return; deny a permission or disconnect the extension; verify no arbitrary filesystem/network exposure and no phantom success on unsupported hosts.

### M20 — institution-managed client integration

**Deliver:** role/account/provider/policy connection, teacher-directed material and permitted evidence/reporting, clear managed visibility and separation from personal content.

**Consumes:** existing service contracts, goals, resources, Knowledge and conversations. The client rewrite does not authorize replacing a working management backend or creating a separate school app.

**Review:** managed and personal contexts, denied access, offline/local-provider use and an authorized assignment. Confirm staff cannot inspect unrelated personal conversations and generated feedback is not treated as formal grading.

### M21 — group speaking and campaigns

**Deliver:** mixed human/agent Rooms, reusable missions/campaign templates and deliberate transfer of accepted continuity to a personal world.

**Consumes:** M08/M09/M15/M20 rather than duplicating voice, agent identity, scenario direction or school assessment.

**Review:** a small group activity with interruption/rejoin, teacher constraints, individual formative evidence and scoped integration. Group audio/turn behavior must be real before calling a multi-participant UI delivered.

### M22 — active-settings and recovery closure

**Deliver:** finish the active settings inventory, search, input/localization/accessibility, storage/recovery/diagnostics routes and service controls not already completed by their owner units. Earlier units must ship the settings they need; this is a closure pass, not a reason to hardcode them until now.

**Review:** trace each retained setting from control to native consumer and safe application timing; test reset, unavailable dependency and failed profile startup with usable recovery/export. Retired modes/aliases have no active v3 consumer.

### M23 — maintainer-directed mobile design

**Deliver:** the approved phone/tablet layout, navigation, Inspector drawer and input arrangements using existing feature semantics. The maintainer supplies visual direction after seeing real workflows.

**Review:** representative reading, watching, learning and messaging flows, rotation/large text/keyboard/safe-area behavior. Cosmetic deferral from earlier units ends here; there is no second mobile screen tree or data model.

### M24 — complete-product release qualification

**Deliver:** remaining catalogue rows and accepted omissions reconciled, sustained resource/lifecycle acceptance, physical-device checks, all supported desktop/native artifacts, signed catalogs/update/privacy/license configuration and safe migration/recovery release paths.

**Review:** a connected journey from installing a language through real media, Inspector/Capture, Review, conversation, sync and restart. Use representative large retained state and >30-minute active sessions. Inspect native and renderer memory, model/cache/WAL growth and idle work. Actual iPhone/Android testing and Windows/macOS/Linux release evidence remain named targets, not extrapolated from a browser build.

Do not defer every performance, data-safety or platform check until M24. This unit verifies the integrated product after the earlier owner-level checks, and it cannot waive a required feature because the main demo works. The first mobile release's **neural deployment scope** is limited to OS-native OCR alongside local Rust/Wasmi morphology; that is not a reason to fork or omit shared supported learning/reading workflows. Advanced native TTS and specialist OCR models are later options, not hidden first-release prerequisites. Clearly identify any currently unsupported mobile voice or OCR language capabilities rather than displaying dead actions.

## 5. Test and build economy

Use the existing owner suite, with the smallest regression that protects the behavior. Catalogue rows are not a command to generate one test each. One real connected scenario can cover several rows; pure semantic cases normally belong below the UI.

| Change | During work | At the unit's review candidate |
|---|---|---|
| Documents/plan/state | Links, ID/coverage consistency, actual scope/status | No application build |
| Pure native domain/data | Affected Rust tests, stable fixtures, explicit serialization/migration checks | Relevant real boundary/persistence scenario |
| Shared React UI | Typecheck, ownership lint, affected browser/component interactions | Real desktop action plus narrow/native interaction when affected |
| Native dependencies, FFI, packaging | Generated-output and affected native-build checks | Both mobile native builds and affected real native workflow; desktop where affected |
| Inference/audio/media | Deterministic pipeline fixtures, actual compatibility/resource probe | Relevant native devices/simulators with representative assets; real external services only when authorized |
| Hot paths/lifetimes | Comparable local release workload with fixed data | Integrated sustained-work measurement; no arbitrary sleep-based success |

Reuse prior evidence only with its source/configuration/input scope intact. Never count a passed build of a previous binary as current code. Fix a red test, characterize a real baseline defect or request a scoped decision; do not silently skip it, move the failure outside the suite or alter the product expectation.

A missing simulator, account, fixture or native SDK is a concrete blocker requiring setup or maintainer help. It is not permission to silently substitute a mock backend. A visual screenshot can remain pending while semantic work continues inside the same unit, but the review packet must say which claims are not established.

## 6. Daily operation

1. Read STATE, Git status/history and the active unit. Verify the user-selected development model/effort and worktree. Preserve local changes and prior accepted commits.
2. Read only the relevant catalogue, semantic contracts and pinned v2 sources. Resolve a product ambiguity before implementing it; do not reread the entire old app or every historical log on each session.
3. Update the short active scope/dependency note. Implement and verify within the unit, with no redundant implementation of shared capabilities.
4. Commit a coherent candidate to the authorized branch, preserving other changes. Record exact source, checks and remaining feature rows; retain focused evidence without credentials or real user profiles.
5. Set `awaiting_review`, give the review actions, and stop. On interruption resume this state, not the next unit. On requested changes stay on the same unit. On explicit acceptance record the decision and start the next authorized unit.

### Initial executor instruction

Read `AGENTS.md`, `docs/product/SPEC.md`, `docs/product/FEATURES.md`, `docs/implementation/PLAN.md` and `docs/implementation/STATE.md`. Work on H00 only. Confirm your effective model is GPT 6.1 Sol with medium reasoning and use the existing coding harness. Recover the actual branch/worktree state before editing; do not recreate completed scaffolding. Inspect the pinned mobile failures and repair/verify their real causes, retaining desktop behavior and isolated profiles. Use the existing test/build infrastructure and leave a resumable checkpoint. Present exact evidence and a short manual review procedure, set the state to awaiting_review, and stop before implementing M01. Do not grant yourself product acceptance, publish releases or use production learner data.
