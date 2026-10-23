# mLearn engineering contract

## Active execution-resource constraint — 16 GB Mac, 2026-10-23

The maintainer reported a kernel watchdog panic after severe memory exhaustion,
including OmO at about 13 GiB RSS and Android QEMU at about 12 GiB RSS.
Restoring the stopped session had restarted an owned Android emulator.

- Never automatically restart Android emulators, iOS simulators, reference
  applications or persistent test servers when resuming. Inspect surviving
  jobs first; stop only unnecessary processes whose ownership is established.
  Do not register persistent launch monitors that replay these workloads.
- Keep local work serial when substantial: one build, inference run or targeted
  device verification at a time. Use one Cargo build job locally. Prefer the
  existing GitHub Actions workflows for broad native integration checks.
  Local device runs must be targeted and shut down afterward without erasing
  profiles, evidence, compiled artifacts or unrelated/user-owned processes.
- Record memory pressure, OmO/workload RSS and swap before, during and after
  substantial work. Investigate unexplained growth rather than accumulating
  more jobs. Keep diagnostic output bounded; do not load full histories or
  large heap dumps into the session as a recovery shortcut.
- Resume actual M06 OCR on `agent/m01`, then M07 under the existing
  authorization. Obsolete visual-parity goal metadata is not the active task.
  Reuse completed M03–M05 and recovered passing M06 evidence. Make frequent
  durable checkpoints and keep PR #44 open and unmerged.

These are execution constraints, not waivers of tests, architecture or milestone
acceptance. Preserve original assertions and record remaining verification gaps.

## Active desktop OCR requirement — Python-free inference, 2026-10-23

M06 desktop OCR must execute through Rust-owned ONNX Runtime, not Python,
a packaged Python sidecar, an installation prerequisite or a Python fallback.
Python remains allowed for offline conversion/reference testing only. Preserve
the tuned Japanese Paddle detection -> package-owned vertical regrouping ->
original-resolution crops -> MangaOCR pipeline; macOS Vision is not its
replacement. MangaOCR is selected only by the Japanese package. Other language packages use
their generic/package-selected OCR path, never MangaOCR as a fallback; do not
add language-code dispatch to core.
Audit the specified Rust implementations and ONNX model exports, pin
preprocessing, complete decoding/tokenization and provenance, and compare
real outputs against the original pipeline. Optional resources require verified
integrity/licenses and must not download during normal Cargo builds/tests.
Detect actual macOS CoreML, Windows and Linux GPU availability with reliable CPU
fallback, bounded reusable cancellable/unloadable sessions, and real macOS and
Windows functional OCR verification. Reuse existing OCR resource/source owners.
Inventory Python ML dependencies of already implemented product functionality;
advanced speech/TTS stays in its appropriate milestones. Preserve earlier
packaged-Python results only as offline reference evidence. Continue M06–M07 on
the existing branch/PR with verified committed/pushed increments, without merge
or self-acceptance.

## Active authorization — implement M03–M07 now, 2026-10-22

The maintainer explicitly **defers the existing hosted iOS FileProvider gate**.
It remains an unresolved platform acceptance failure, not passed and not a
prerequisite for further implementation. Stop that investigation and launch no
further variants of its diagnostic workflows during M03–M07. Preserve evidence,
compiled artifacts, successful local verification and original assertions.
Stale pre-M03 gate conditions in older checkpoints must not reinstate this stop.

Start M03 immediately, then execute M04, M05, M06 and M07 sequentially on
existing `agent/m01`, draft PR #44, using the complete PLAN/SPEC/FEATURES scope.
This supersedes the older domain-milestone exclusion and intermediate manual
review stops, not architectural or verification requirements. Preserve history,
H00, profiles, completed work, shared design and genuine native materials.

Each milestone requires relevant passing checks, genuine end-to-end workflows
including persistence/restart/cancellation/recoverable failures, shared-owner
proof, applicable native verification, independent code review with blockers
resolved, and a committed/pushed exact-source evidence checkpoint. After M04,
perform an independent comprehensive M01–M04 architecture review and repair
significant structural findings before M05. Record `verified_for_continuation`,
never maintainer acceptance.

Perform affected-platform verification, including local iOS where available.
Repair demonstrated product defects; isolate unrelated hosted-infrastructure
failures without stopping independent work. This specific deferral is not
release readiness or permission to weaken functional/platform requirements.

Minor pixel polish may defer precisely until after M07; usability, accessibility,
responsiveness and functional controls may not. After verified M07 deliver one
consolidated review package with sources, architecture, subsystem diffs, review
resolutions, tests/real platform workflows, captures/demos, resource observations,
remaining discrepancies and prioritized remediation, then stop for manual
acceptance. No M08, merge, release or self-acceptance.

## Active authorization — visual-parity rewrite, 2026-10-20

The maintainer has rejected the current visual result and authorized a **large presentation refactor**, not another small restyle or unchanged-layout component cleanup. Execute [VISUAL-PARITY.md](docs/implementation/VISUAL-PARITY.md) on existing `agent/m01`, draft PR #44. This is the current job; read STATE for persisted work/evidence, not as a veto from its older frozen status. No new domain milestone, merge, release or maintainer acceptance is authorized.

- **Target:** matched app/reference screenshots should not look like different UIs. Replace the rejected v3 theme/presets, insufficient primitives and actual screen compositions where necessary. The previous DESIGN numeric/style choices are not authority; rebuild [DESIGN.md](DESIGN.md) from measured reference evidence. Reusing the old appearance under a shared component name fails this job.
- **Reference hierarchy:** edited `docs/product/screenshots/` images first; for current surfaces they do not cover, the corresponding isolated running `../mlearn-ts` screen is now the secondary visual reference. This explicitly supersedes older PLAN/REFERENCE/DESIGN instructions excluding unpictured legacy layouts. Home may not remain generic under `visual_pending`. Legacy architectural defects and fake capabilities must not be copied.
- **Scope:** all currently implemented UI, including Home, Settings/package management, Watch/window/player chrome, captions/transcript, Inspector/corrections and their controls/dialog/error/pending states. Preserve the existing React/Expo/Tauri/Unistyles boundaries, real Rust semantics and repaired Wasmi performance. This is not an authorization to implement the absent Reader/Messenger/Review backends.
- **Iteration:** autonomously capture, compare, repair the responsible shared owner, exercise and recapture. No fixed pass count, task counter or functional test pass substitutes for visual conformity. Continue while useful repair work remains; a real quota/access/tool blocker means `paused_incomplete` or `blocked`, not success. Never spin or buy capacity to satisfy “forever.” No unapproved paid route or premium-model escalation.
- **Delivery:** normal app startup with persisted built-in theme handling must show the reference-derived result. Do not restore the rejected Slate appearance after QA or wipe custom themes/profiles. Preserve meaningful tests/data; remove superseded styling after migrating callers. Commit verified work to the existing draft PR and stop for final maintainer acceptance only after the job's gates pass, or explicitly report an incomplete blocker.

This active authorization overrides conflicting historical frozen-review, minimal-restyle and unpictured-layout wording; unrelated engineering, safety and product-semantic constraints below remain in force. The visual job has not been implemented merely by updating this contract.

## Read and resolve scope

- [Product specification](docs/product/SPEC.md) and [feature catalogue](docs/product/FEATURES.md) define required behavior and exclusions. [Reference map](docs/product/REFERENCE.md) identifies historical evidence, known traps, and the [21 approved UI screenshots](docs/product/screenshots/) already present in the repository. `README.md` documents commands; `docs/architecture/foundation.md` records the initial implementation, not the complete product.
- Implement the specification, not every behavior found in old code. A conflicting implementation is a defect; do not weaken the specification or its acceptance checks to make it pass. Product changes require the maintainer's decision. Choose ordinary implementation details yourself; record only consequential assumptions. An unresolved product choice blocks that choice, not unrelated work.
- Study `../mlearn-ts` source, CSS dependencies, computed styles and actual interactions; record its revision. Running `npm run dev` there is authorized after verifying its script and a supported isolated disposable profile. Preserve tracked reference source/lockfiles and live learner data; do not invent an isolation flag. The maintainer describes that UI as roughly 90% of the intended direction, with architectural debt. Edited screenshots win where it differs. Otherwise use `archive/v2-final` (`1788f9c74dc73dd884b687ec80d9550c3ebf6c6b`) as a reference, not a correctness oracle. Earlier reports do not override this contract or product requirements.
- Before replacing a feature, trace its real entry, producer, consumer, persistence and failure behavior. A type, setting, test fixture or unreachable function is not a delivered capability. Preserve accepted workflows and data meaning; do not translate the old architecture, compatibility scaffolding or defects.

## Review-gated delivery

- Execute [PLAN.md](docs/implementation/PLAN.md) using the current [STATE.md](docs/implementation/STATE.md). Establish the development/native harness in H00 before starting product increments. Use the maintainer-selected development model/effort; record its effective setting instead of assuming it was applied.
- Default: implement one connected unit, verify it and stop for maintainer review. Exception: a maintainer-authorized bounded batch may traverse its named units after the foundation gate below, retaining per-unit scope/evidence for one combined review. Record `verified_for_continuation`, not `accepted`. A reviewer cannot grant maintainer acceptance. Do not pause for routine human approvals inside an authorized batch, advance beyond its ceiling, merge or extend the authorization indefinitely.
- Each unit consumes and extends the product's existing capabilities. Knowledge, SourceContext, AnnotatedText, Inspector, Capture, learning sessions and providers do not get separate owners per screen. When a second real consumer arrives, demonstrate reuse and cross-surface consistency; do not invent a fake consumer or a universal widget framework to justify abstraction.
- Record every wanted small behavior in the feature catalogue before closing its area. A broad Reader/Review/Messenger label, missing screenshot or a minimal successful path cannot retire menu actions, modes, shortcuts, context operations or recovery behavior. Unclear required behavior stays explicitly unresolved until traced or reviewed.
- Final mobile visual design can remain pending until the maintainer's design pass. Native builds, accessible controls, touch/input, source continuity and domain behavior remain requirements during feature work; desktop acceptance does not certify mobile functionality. Desktop browser overlays/extensions and transparent utility windows are out of scope on both mobile platforms for this release; do not build nominal mobile counterparts or require a share-sheet workaround for parity. In-app inspection and ordinary supported media import remain separate requirements.

## Foundation gate before extension

- Inspect actual owners and the next real consumer. Fix **propagating debt** before its dependants: wrong authority/identity, unsafe lifetimes or migrations, duplicated semantics, unusable shared UI, or a contract the next feature would cement incorrectly. Separate this from contained visual refinements and explicit product decisions. Do not demand a debt-free universe, count components, or invent a framework for distant features.
- Record only concrete findings: evidence, owner, effect on the next consumer, repair/regression result and advance/repair decision. Protect useful existing work. Test the real connected flow and its relevant failure/cancellation/restart paths; an unrelated passing run does not explain a failure. Audit changes to acceptance wording too: a missing capability must not be renamed out of the requirements.
- Within an authorized batch, repair blockers and re-evaluate autonomously. Advance when dependency readiness is demonstrated; remaining nonblocking gaps stay explicit. Use change-appropriate checks during integration and the complete relevant regressions/native workflows for the final candidate. No new consumer may require a parallel implementation of an existing semantic owner.

## Code ownership

- `apps/client` is the single Expo/React Native application; React Native Web supplies Tauri's frontend. `apps/desktop` is a host, not a second UI. Share screens and feature behavior. Keep platform substitutions at actual host, navigation, input or rendering boundaries.
- Use semantic names: **Knowledge** for unified learner access, **Inspector** for contextual language inspection, **Runtime Inspector** for execution diagnostics, **Material** for authored items. Legacy `FlashcardContext`/`WordHover` are reference search names, not v3 architecture. A Knowledge provider may expose bounded view state; it must not become another monolithic renderer store.
- Rust owns domain decisions, learner state, settings acceptance, persistence, language execution, inference coordination and background work. React owns presentation, focus, gestures, navigation and unsubmitted input. Derived knowledge, due selection and saved settings must not acquire another authority in a hook, context, localStorage, AsyncStorage or JSON file.
- Features call the typed runtime client. Only host adapters import Tauri/Expo backend APIs. Commands represent user actions; reads are scoped and bounded. Do not transport entire profiles, graphs, dictionaries, histories or model tensors to render a screen. Generate shared protocol types from Rust; do not edit generated contracts or native bindings manually. Validate untrusted payloads at their owning boundary; TypeScript casts are not validation.
- Shared Annotated Text consumes bounded native analysis and deduplicated Knowledge batches keyed by source/package/revision. Do not issue one query or create one backend-owning component per token. A Knowledge change updates the relevant projection without retokenizing unrelated content. Streaming/prefetch remain bounded; batching is not loading an entire corpus.
- Keep one owner for each responsibility. Use ordinary modules and direct calls before introducing a new package, trait hierarchy, event bus, repository interface or state machine. A new boundary needs a concrete ownership, platform, lifetime or dependency reason. Do not reproduce another language's standard library, async runtime or memory model in Rust when an existing library or native construct meets the contract.
- Name modules for the behavior they own. Do not create parallel `new`, `v3`, `legacy`, `compat` or generic `utils` implementations as permanent destinations. Compatibility code belongs at an explicit import/protocol boundary, not inside normal domain behavior.

## Language packages

- Language algorithms, dependencies, linguistic schemas, task declarations and content belong to plugins. Core supplies generic execution, resource access, storage and capability mechanisms. No language-code branches, built-in per-language analyzers, closed POS/prosody inventories or centrally enumerated language features. A plugin may implement a complete analyzer, not merely configure built-in kernels.
- Use the Rust SDK and Wasmi for the current execution path. Keep guest contracts independent of Wasmi internals. JIT, native plugin AOT, additional interpreters and speculative engine-switching frameworks are deferred.
- First mobile release: plugin-defined morphological tokenizers execute locally; iOS OCR uses Apple's native Vision recognition through a Swift platform adapter, while Android uses an explicitly validated on-device recognition provider (initial candidate: bundled ML Kit Text Recognition v2). Neither provider becomes a language-specific branch in core. Report actual supported scripts/languages, availability, text regions and confidence instead of silently falling back to cloud OCR or inventing an unsupported result.
- No Qwen3-TTS, MangaOCR or PaddleOCR model conversion is required for the first mobile release. These tuned engines remain desktop/reference paths. Platform OCR input/output and source alignment share the product contract, not the underlying network/model engine. Mobile OCR must be exercised offline after any required model installation; an API being present does not establish recognition quality.
- **Both iOS and Android bundle executable language plugins. Desktop downloads executable plugins and assets from authenticated catalogs; it does not embed a hidden language-code fallback.** Mobile downloads language data, not replacement executable modules. Host policy cannot be selected or relaxed by renderer or guest input.
- Preserve valid unknown namespaced data through storage/export. Unknown semantics are not executable authority, learner evidence or identity. Stable semantic IDs must not depend on array positions, locale labels or rebuild ordering.
- Authenticate package identity/version and declared artifacts; validate compatibility before activation. Bound guest execution, memory, messages and host resource work. Guest code has no ambient database, filesystem or network access. Never solve missing capabilities with fake success or silently substitute a different language/scope.

## UI and component boundaries

- **Component-first implementation:** before changing UI, inspect the existing `@mlearn/ui` API and its actual callers. Reuse or replace insufficient semantic controls; do not recreate a button, pill/badge, disclosure, field, dialog or focus/hover behavior with feature-local styling. A large visual rewrite may replace primitive APIs and screen compositions, migrating affected callers in the same batch. Static `View` composition and feature-local layout are fine; specialist document/media rendering needs a narrow explicit owner. No raw clickable DOM or feature imports from headless-control libraries. Reuse is not permission to preserve rejected output.
- A component must own semantics, state/lifecycle, meaningful reuse, a platform adaptation or substantial composition. Do not wrap each element, create a component per style rule, or add pass-through layers that merely rename props. The shared control boundary is justified; a chain of wrappers around it is not. Prefer composition over a universal configurable widget framework.
- Use Unistyles, colocated layout styles and semantic theme values. Shared text roles own font family, size, line-height and weight; add missing roles to the shared typography/Text boundary instead of styling ordinary `NativeText` separately in each feature. Shared surface/control roles own material, color, radius and state treatments. Geometry belonging to source content or a measured layout may remain local. No Tailwind/NativeWind/UnoCSS or route-specific CSS override layer. User theme IDs remain runtime data. Integrate only the maintainer-selected reference presentation as one shared system without a style name; ignore alternate reference styles. Do not port the Interface style selector, persist a style preference or retain parallel style implementations/selector compatibility. Themes remain separate and approved materials remain shared component behavior.
- **The maintainer's deliberately edited reference images are the approved visual specification for the states they depict.** Match arrangement, hierarchy, typography, density, materials and relative geometry while preserving real behavior, accessibility and responsiveness. Study legacy CSS and rendered measurements to understand the mechanism; do not transplant brittle overrides or staged DOM. During visual-parity work, actual comparisons decide whether a difference is immaterial rasterization or unfinished UI; a blanket “minor alignment” claim cannot waive it.
- **One design system applies to ALL product UI.** Approved images define typography, density, materials, action hierarchy and interaction conventions; merely importing `Button` and `Text` does not establish conformity. Compose real source rows, selectors, settings sections and linguistic content around those conventions. Different layouts and intentional media contrast are valid; isolated theme islands and generic form scaffolding are not. Prove shared changes in both media and non-media contexts. Do not turn every token into a user setting or extract one component per element.
- The supplied designs can be **artificially staged states**: the maintainer restyled and repositioned the running v2 UI through DevTools, sometimes while the original application was unstable. A screenshot is an authoritative visual target, **not evidence that v2 actually implemented the depicted behavior or that its DOM, CSS overrides, layout measurements, IPC, state or performance can be reused**. Implement the intended presentation using the clean shared UI/runtime boundaries; independently exercise it with real data, input and persistence. Never reproduce DevTools-only conditions to make an acceptance screenshot pass.
- For current surfaces without an edited screenshot, use the secondary running-v2 visual reference authorized above. Home is included, not exempt. Where the reference cannot be established or requires unavailable product behavior, record the exact blocked state and continue independent work; do not label a generic replacement visually complete. Derive package labels from authoritative metadata and preserve stable IDs. No fabricated metrics, slogans, decorative filler or unsupported actions. Resolve ordinary presentation details through reference evidence, not repeated maintainer interruptions.
- Absence of a control from an edited image does not authorize silently deleting its independently required feature; nor does a legacy feature authorize inserting an unpictured control into the approved composition. Surface the placement/scope conflict for the maintainer to decide. For features absent from both edited references and the product catalogue, do not reconstruct legacy UI by default.
- Labels name an action, object or real state. Add explanations only where they help a decision or recovery. Do not add taglines, promotional hero sections, fabricated metrics, roadmap tiles or decorative descriptions to working screens. Replace integration-placeholder content as real features arrive.
- Keep results and errors beside the initiating action. Preserve keyboard/IME/modal ownership and touch accessibility. Reuse a stable pending/error/empty pattern where useful; do not create an automatic skeleton framework or a bespoke skeleton for every component.
- When replacing a tuned model pipeline, pin the exact model variant, input preparation, feature settings, postprocessing and observable outputs from a representative reference run before selecting a native engine. Compare outputs at the meaningful stage boundaries with real samples; for stochastic audio use waveform/quality, timing, transcription and interruption evidence rather than byte-exact audio equality. Reuse available inference libraries, but neither port an entire Python framework nor count 'model loaded' as the product behavior.

## Data and resource integrity

- SQLite is Rust-owned and updated incrementally. One admitted action must not duplicate evidence or partially commit its related state. Preserve command identity across retries. Explicit claims, observations, predictions, exposure and exclusions remain distinct.
- Session Undo, learner evidence, summaries, model checkpoints, conversation records, sync metadata, authored media and caches have different lifetimes. A historical summary is not a review event. Do not recreate per-review full-card/library versions. Follow the retention semantics in the product specification.
- JSON is acceptable for small versioned interchange/configuration documents and structured extension payloads. It is not the mutable whole-library database. Compact codecs need a measured purpose, a version and round-trip/corruption coverage; do not hide opaque numeric fields inside ad hoc JSON to save space.
- Keep development profiles separate from v2 and production. `net.kikan.mlearn.v3dev` must not become the legacy `net.kikan.mlearn` identifier accidentally. Display names and window titles may be `mLearn` without changing storage identity. Do not write to the live v2 profile or implicitly import it. Test import/recovery against isolated copies.
- Every growing cache, worker, subscription, pending command and large buffer needs an owner and release/eviction behavior. Batch hot paths; avoid per-item IPC and repeated asset/database scans. Hidden screens do not keep recomputing full collections. Model sessions and thread pools must share a resource policy rather than each consuming all device resources.
- Cancellation must release work and prevent stale publication. Distinguish pending, unavailable, failed and empty. Keep useful existing state and explicit retry where safe; do not hide errors with empty arrays, fabricated results or unbounded retries.

## Interactive performance acceptance

- Measure the normal documented development launch as well as an optimized consuming app; an isolated release owner benchmark does not certify the user's dev workflow. Keep plugin/data/input identities equal, record effective Cargo profile and flags, and compare repeated fresh-process, warm, reopen and package-switch cases. A process restart is not proof of cold filesystem caches.
- Trace user action to usable annotations/Inspector, separating queue/admission wait, guest initialization, resource reads, actual capability calls, Knowledge/storage work, IPC and first usable render. Include capability/owner and initialization/eviction counts without private text or paths. An `initialize` span is not steady-state tokenization; a fast guest call is not end-to-end responsiveness. Reuse existing metrics and add only the missing spans.
- Establish measured latency and work-count budgets for representative visible-cue and transcript operations before claiming readiness. If unoptimized interpreter execution dominates, test an optimized dev profile/package override with debug information and safety checks retained; verify where generic hot code is instantiated. Do not claim a Cargo flag fixed performance without the same real-app before/after measurements. Do not remove authentication, fuel/memory limits or cancellation, replace the engine, hide the loader, or move the same delay to startup as a substitute for diagnosis.
- UI rerenders, pointer movement, progress ticks and unchanged cue selections must not needlessly reinitialize language resources or repeat morphology. Inspect actual cache hits, invalidation and session/guest eviction before changing policy. Reuse immutable analysis under source/content/package identity with bounded memory, while refreshing current Knowledge independently. Preserve stale-result rejection and responsive foreground operations; do not introduce an unbounded cache or keep cancelled work alive merely to improve a timing.

## Tests that protect behavior

- Add or strengthen a test when it protects a distinct contract, reproduced regression or consequential boundary not already covered. Prefer the existing owner suite and small representative fixtures. Do not target test counts, coverage percentages, one test per function or one file per change. Consolidate redundant tests without removing unique protection.
- For a bug, reproduce the failure before fixing it and verify the regression fails without the fix. For a new behavior, establish the intended contract first. Assert observable output and state, not internal call counts, copied implementation logic, source spelling or mere component/file existence. Architecture checks are an explicit exception: test forbidden and allowed dependency patterns, including realistic alias/re-export escapes. A measured boundary-call or memory-growth budget can also protect a performance contract; incidental private call counts cannot.
- Keep high-value semantic tests: claim/evidence separation; cue contamination; distinct probe directions; no doubled retry/correction; exact active-session resume; package identity; graph identity versus support; Sea/Thread visibility; migration/recovery; model-summary limits. Test the authoritative behavior once, with only the necessary transport/UI integration coverage.
- Prefer real temporary storage and real serializers at persistence boundaries. Mock nondeterministic external providers, not the state transitions being verified. Use fixed clocks/seeds where appropriate; wait for an event or bounded condition rather than arbitrary sleeps. Normal tests do not depend on public CDNs, paid inference or private profiles.
- Guard non-obvious workarounds with the smallest relevant test and a nearby explanation of the failure, reason and removal condition. Examples: runtime style CSP without weakening script policy; Wasmi validation/fuel in debug and release; generated FFI module visibility; matching XCFramework library names and Android ABIs; feedback visible beside its action. Do not freeze a workaround's exact source text or preserve a known-broken packaging arrangement.
- Layout tests protect usability: visibility, containment, focus restoration, keyboard/IME behavior, scrolling and essential touch targets. Avoid broad screenshot/DOM snapshots and exact cosmetic dimensions unless the particular regression requires them. Functional source comparison does not require visual identity.

## Verification scope and continuity

| Change | During implementation | Integration evidence |
|---|---|---|
| Documentation | Check consistency, references and paths | No simulator or application rebuild |
| Pure Rust/domain/storage | Owner tests, relevant checks; migration/replay fixtures where affected | Real boundary/persistence flow when integrating |
| Shared UI | Typecheck, ownership lint, affected interaction tests | Inspect changed desktop and narrow layouts; native checks for platform-dependent behavior |
| Protocol/FFI/native dependency/build | Regenerate outputs, conformance and affected builds | Both iOS/Android builds plus the affected native flow; desktop host where affected |
| Hot path/resource lifecycle | Representative workload and before/after measurements | Long-session/resource test at the milestone, not after every edit |

- Run broader regression suites once a coherent batch is integrated and before its acceptance. Do not rebuild every platform or launch simulators for unrelated edits. Reuse completed evidence only when its source, inputs and affected scope still match. Never claim a native workflow from browser tests or claim physical-device behavior from a simulator.
- Use current scripts in `package.json`/`README.md`: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build:web`, `npm run test:web`, `npm run test:native`, `npm run check:contracts`. Select the checks appropriate to the change; generated native binaries must include the source being tested.
- Keep one compact current checkpoint: authorization, source, per-unit verification, blockers and next action. Read Git and that record before repeating work. Clearly separate historical reports from current instructions; do not create report trees, recursive review campaigns or competing writers to an interface. Do not cancel slow builds for unrelated edits.
- Verification is the agent's work, not debugging homework for the maintainer. For a UI repair, record the reference-to-owner mapping and affected real callers in the existing checkpoint. Verify the structural fix in the diff and the rendered result: changing a shared role must reach its consumers without patching each screen. Strengthen existing boundary checks with allowed/forbidden examples when preventing a demonstrated escape; component/file counts prove nothing. Inspect approved and current images directly at comparable viewport, text scale and interaction/content state; check decoded dimensions and links. Capture the normal final app with source/UI/plugin identity. Check Home, Settings, Watch and Inspector, including pending/error/expanded states. Code, performance, function and visual conformity are separate gates; passing containment/accessibility or one attractive popup cannot waive another visibly rejected surface.
- Reserve resources for final verification. Inspect effective routing; no unapproved premium-reviewer fleets, Astra escalation or metered-provider switch. Use event-driven build/CI waits, not repeated large-model polling. Remaining quota is capacity, not a target to exhaust; follow the active batch's limits and checkpoint before interruption.
- A failing check is not erased by a later passing unrelated run. Investigate, fix or record an independently reproduced baseline issue with its affected scope. Do not silently skip, weaken or rebaseline tests to obtain green status. Test counts, documentation and placeholders do not complete a user workflow.
- Use npm/Cargo workspaces and their lockfiles. Keep changes in coherent, reviewable maintainer checkpoints rather than committing every generated file or trivial step. Do not modify reference branches, force-push, discard uncommitted work, kill processes by name, publish packages or replace user data without authorization.
