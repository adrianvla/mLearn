# Current implementation checkpoint

## Active visual-parity rewrite - 2026-10-20

Status: `verifying`, not complete or accepted. Execute
[VISUAL-PARITY.md](VISUAL-PARITY.md) on existing `agent/m01`, draft PR #44,
against unchanged `agent/h00`. Requested `4a86df32` was fetched and already
equalled clean HEAD; no reset, history rewrite or new worktree was used.
This authorization supersedes the historical frozen-review, minimal-restyle
and unpictured `visual_pending` restrictions below. No new domain milestone,
merge, release or maintainer acceptance is authorized.

### Current verification checkpoint

The preceding hosted native-build candidate was `f4b59d78`; the verified
lifecycle and fixture-input repair below is the current working candidate.
Its foundation run `39467499076` passes. Native run `39467499143` completed
with the failures detailed below. Desktop run `39467499144` failed the usable-Watch assertion after
route blur. Its retained capture is still Home and `media-failure.json` is null,
not an unannotated Watch: the special Resume helper checked enabled/presence
but skipped the shared click helper's scrolling and actual hit-target check.
Resume now delegates to that existing readiness owner and the real WebDriver
click; the original usable-Watch assertion is unchanged. Rerun `39469345870`
reaches real Watch (paused at 20 seconds, readyState 2), but its raw
`recent_sources` read returns a response without `sources` during initialization;
the harness dereferenced `sources` before waiting for annotations. This read
bypasses the client's admission queue and can compete with the three permitted
native operations. It now follows visible annotation readiness, reports an
unexpected response explicitly, and retains the original exact persisted-position
predicate before the raw seek. No retries or native-limit changes were added.
The corrected `c3203961` foundation run `39470921398` and complete real desktop
run `39470921482` pass, including both cancellation/blur iterations, exact
resume/checkpoint persistence and enlarged Inspector clearance. Prior
`0ddb9b28` foundation/desktop runs also passed cancellation/blur,
rate-failure/retry, keyboard ownership and enlarged-text Inspector clearance.

Native run `39467499143` completed with both jobs failed. Android built and passed
ABI validation but never launched the emulator or app: SDK installation failed
with `Error on ZipFile unknown archive`; the following port-5554 refusal was
cleanup, not a product assertion. Its earlier passing Android run uses the same
emulator action revision and has the same XML-version warning, so that warning
does not establish an incompatibility. iOS built successfully but remained in
Files after its enabled video cell was tapped at the filename-area centre.
The helper now targets each exact enabled fixture's preview area; original
import and product assertions remain. Do not count these failures as passes.
The rejected Android-only retry started no job. One new candidate CI run will
cover the connected native repair and a fresh Android SDK download, rather than
starting an obsolete-source retry plus duplicate builds.

Earlier native run `39450937682` passes Android but fails iOS before media
import: Files had already restored the app container with `M01 fixtures`
visible, while the helper insisted on seeing the parent container row.
Captured hierarchy, image and command records establish that mismatch.
The picker helper now waits for any of its three real navigation levels;
exact video/subtitle selection and all product assertions remain unchanged.
Focused consuming verification passed the picker and exposed native transport
reveal failure with the precompiled video module after enlarged-toolbar reflow.
The earlier source-built module could pass an individual workflow but still
lost input on a subsequent local reopening. The new lifecycle repair below
passes the complete normal local workflow; hosted verification remains open.
Superseded run `39448604470` was cancelled
before any jobs ran, not counted as verification.

The current local consuming iOS Watch flow passes in 187.988 seconds, including
actual paused control hide/reveal, fullscreen/return and restart.
The prior Android Watch flow passes in 216.126 seconds.
The native stage now clears the app toolbar; removing only that clearance
reproduces the iOS fullscreen hit-test failure. Earlier claims that the Expo
Swift repair had consuming positive/negative proof are withdrawn: Pods linked
the precompiled ExpoVideo XCFramework, and the executable hash did not change
when Swift source changed. Those runs establish flow results only, not SDK
repair causality. The application now opts only ExpoVideo into iOS source
compilation; a real-autolinker configuration regression failed before this
setting. Pods now compiles VideoView.swift for arm64/x86_64. A source-built
comparison with the two-line patch passes in 185 seconds; removing only those
lines and genuinely recompiling also passed once in 193 seconds. Those
individual passes did not establish stable equivalence. A later unmodified
full flow failed after Home/Resume; an identical settled tap failed for 19
seconds while UIKit confirmed the point reached AVKit and the player was
ready, paused and controls-enabled. Calling only the missing public
`endAppearanceTransition()` restored that same tap in 2 seconds. This was
diagnosis, not staged acceptance.

Only that matching end call is now persisted by the version/content-pinned
`tools/patch-expo-video.mjs`; the old extra super call is not restored.
Actual arm64/x86_64 source compilation produced the new binary below. After
terminating the debugger-mutated process, the unchanged full native flow passed
in a normal fresh process (JUnit timestamp `2026-10-20T20:58:46`). Normal
`npm ci` reproduces the same native-tested source; 40 harness and 19 package
tests, typecheck, ownership lint and contracts pass. The guard protects exact
dependency transformation, idempotence and rejection of an unreviewed upgrade;
runtime proof remains the real native flow. The new enabled-preview fixture
input also passes the complete fresh-process flow in 187.988 seconds
(JUnit timestamp `2026-10-20T21:08:50`), with all assertions kept.
Current repaired SDK source SHA256 is
`a0bf4cc7557d9092b7bd24054c6e774bcd988176091ed085bb0b11e2f6c0c705`.
Unmodified SDK source SHA256 is
`d4296ca377d39150928d2cb58375bd1161954f9fcc3993ef5a48de4bd6da5a0b`.
Prior local Android APK
SHA256 is `698be22a6d14b91f785f462bfdf5ae65e910219ca616fd368f06343d9fbd5663`;
current iOS bundle is
`2993271d6cfd718e03ae3bd439b6023cc7871bf33167ea7c8e9528695712848c`
and executable is `2f3a8c0f49dfb6db5eb1999977a19370b5bee9e25f1a77fd2b47b3c82a84e422`.

With owned simulators stopped, the normal documented desktop development
launch renders the existing Japanese source in 1296 ms on a fresh process
with warm filesystem caches; warm reopen takes 895 ms. Initialization takes
391541 us, with 23615 us resource work and 367926 us interpreter work.
Inspector activation to its first entry frame takes 47 ms, including 4 ms
runtime transport. Missing action/frame telemetry is now gated by
`EXPO_PUBLIC_MLEARN_METRICS=1`, carries no source text/path and cancels its
frame callback on entry replacement/unmount. Typecheck, ownership lint,
web export and all seven web tests pass after that change. Earlier
load-contaminated samples below remain anomalies, not passing evidence.

Full-window and narrow Home, Settings, Watch and Inspector comparisons,
including enlarged text and actual dictionary content, are retained under
`.mlearn/visual-parity/`. Normal startup preserves the user's saved theme
document; copied-profile 2x QA restored its exact original theme. No live
v2 profile was used. Remaining unavailable pictured capabilities (structured
ruby/prosody, live translation, aggregate Known/Flashcard/Explain and cue
alignment arrows) are explicitly incomplete, not replaced with fake actions.
Manual subtitle offset remains in advanced Playback options. No absent
Reader/Messenger/Review backend is authorized by this work.

The language-package controls also have connected native evidence on the
same application source. In the retained copied profile, a loopback server
served the existing signed catalog and authentic English package bytes:
catalog HTTP503/recovery, a held 1024-byte transfer, acknowledged cancellation,
artifact HTTP503/failure and retry to all 25876710 authenticated bytes/Installed.
No transport or result was mocked. Pending, cancellation, failure, recovery
and narrow long-label captures were inspected; competing starts were disabled
and feedback remained beside the initiating action. No source fix was needed.

Owned apps, reference/browser processes, Metro and catalog servers are stopped;
ports 3000/8081/7780/9229 are closed. Only the task-created Android AVD and iOS
simulator were deleted; retained H00 is untouched. Dock autohide is restored
to false. Useful isolated profiles, caches and diagnostic evidence are retained
under ignored `.mlearn/visual-parity/retained-20261020`; the temporary root was
removed. Later package QA reused that copy and stopped all its new processes.
The rewrite diff from requested `4a86df32` is whitespace-clean; the broader
H00 diff has pre-existing vendored Japanese whitespace, reproduced on that
unchanged baseline and left alone.

Next: verify the picker repair and finish the consuming mobile rerun.
Unavailable target states remain incomplete even if all checks pass. Final
maintainer acceptance remains separate.

### Historical visual-rewrite progress

The following paragraphs retain earlier observations and superseded pending
statuses; the current checkpoint above is authoritative. Historical Expo SDK
positive/negative comparisons below did not consume the Swift edits and must
not be reused as proof of that repair.

Post-`73e362b3` verification found two regressions. Exact-source foundation CI passed all
web/Rust/macOS/Windows jobs, but real desktop CI failed its existing preference
cancellation recovery assertion: media remained decoded at 20 seconds while subtitles
had no usable annotation controls. The new rate-failure/retry and combobox-key
checks passed before that failure. Focus clears the analysis batch; a retained
source with unchanged cue/revision/position must explicitly reanalyze after
resume admission. The one-line refresh in `19fa6771` passes local checks and
the entire real desktop run 39440737621, including both cancellation/blur
checkpoint paths and the new rate-error/retry/combobox-key regressions.
Foundation run 39440737605 also passes all jobs.

Final local iOS Watch passed claims, transcript, preferences and restart, then
failed to reveal Play/Pause after source reopen. A clean unmodified process
passes the same native transport probe in 12 seconds, narrowing the failure to reuse/
navigation lifetime. Read-only UIKit inspection found AVKit ready with
controls enabled and frame analysis disabled, but direct hit testing returned
nil. Diagnostic containment, appearance and transport reconfiguration did not
restore the unchanged touch probe; none is shipped as a fix. A later debugger
controller-replacement experiment interrupted the disposable process, which
was restarted before further evidence. No native assertion was weakened.

The installed Expo 57.0.5 view starts an appearance transition on each window
move without ending it. Balancing it and calling super passes the unchanged
full iOS Watch flow in 176.736 seconds. Removing only those two SDK lines on identical
`19fa6771` source fails at Play/Pause in 159.137 seconds. The durable install repair is
`tools/patch-expo-video.mjs`, invoked by the normal npm postinstall; it is pinned
to 57.0.5 and rejects partial/unexpected source or versions. Its idempotence and
drift rejection are exercised in the existing mobile-packaging suite. Both real
postinstall invocations and local tests/typecheck/lint/contracts pass.
Patched SDK SHA256 is `ee45004def0d1e78239fbfa2818015595ee4d78337e47ff99d6541eb70e3a2a8`.
The final consuming build/full Watch rerun after durable reapplication is
pending. This changes AVKit lifecycle, not its transport semantics or assertions.

The shared foundation and Home are being replaced, not merely centralized:
measured reference palettes, historical built-in rendering resolution,
portable icons/selectors, bounded shell, native overlay titlebar and actual
source cards. Same-ID customized themes are preserved. Settings now consumes
the same shell, navigation, selector, field and divided-row families.
Watch now composes the measured seek rail/icon footer, with real subtitle,
transcript and playback actions. Transcript uses the shared bounded sidebar
on desktop and a dialog on narrow/native screens. Inspector now uses shared
gradient reading metadata, vector claim icons, disclosure anatomy and a bounded
nested correction popover without shrinking away dictionary content. Final
convergence remains open.

Current private comparison entry point:
`.mlearn/visual-parity/manifest.json`, with surface/state inventory in
`.mlearn/visual-parity/surfaces.md`. The append-only execution notepad is
`/var/folders/f2/d3_jzj917kg6sqsc9tgc80200000gn/T/ulw-20261020-visual.XXXXXX.md.aXK9yXuTab`.
Source/state identities, captures, failed attempts and cleanup ownership are
recorded there. Edited images remain primary; actual isolated reference
`1788f9c7` completed legitimate Japanese onboarding and supplies unpictured
Home evidence. Normal existing-profile launch already renders the replacement
palette without rewriting the saved Slate document or clearing any profile.

First connected checkpoint: npm tests (38 harness/architecture and 19 package
tests), typecheck, ownership lint, web export, all six web tests including the
unchanged axe assertion, and generated-contract checks pass. The new shared
selector preserves combobox semantics and supplies native scrolling. The
saved-built-in regression failed before the repair and passes
after it, including custom-palette/radius/extension preservation. Actual
pre-rewrite Japanese Resume-to-caption baseline is 1.280 seconds.
Native Settings rejects an invalid theme name in its actual dialog; closing,
reloading native state and reopening returns the exact original saved document.
SDK input produces `Hello, Ada!`; installed language metadata and the signed
catalog render real package actions. No package transfer or profile reset was
used for these checks. Metro now watches shared resources: its actual-config
regression is red/green, and live accent edit/restore reached the rendered
action without another server restart. Native overlay window dragging moves
the window; the task restored its original position.
These checks do not close visual, functional/native or performance gates.
First pushed checkpoint `7700d7b0` passed hosted foundation checks. Its native
desktop integration exposed a test selector collision: the newly labelled
hidden Home heading was measured instead of the visible 44px Home button.
The collision was reproduced in the real browser (heading0px/button44px);
the selector now requires a visible button and retains the 44px assertion,
also exercised in the existing Home navigation web test. Corrected native CI
is pending; the original failure is not erased by local passing checks.
Second pushed checkpoint `3e845487` also passed hosted foundation checks.
Its native desktop test exposed the same aria-label collision in the generic
click helper. The current correction requires a visible enabled interactive
element, observes layout readiness and performs the real driver click; no
assertion or touch-target requirement was removed. Its hosted rerun is pending.

Current convergence adds measured light Quartz, 20px Settings headings,
14/12px divided rows, reference Home preview/full-width continuation rows and
shared glass/canvas material. A direct-entry Watch Home regression failed
before the navigation repair and passes afterward. The last integrated local
run passed seven web tests; a final-source run is in progress.

Both consuming mobile Release builds now pass after the maintainer resolved
disk capacity; the old ENOSPC failure remains historical evidence. No removed
large acceptance environment was recreated. Current Android foundation and
complete Watch flows pass, including keyboard-visible offset editing. Current
iOS foundation passes in 7m12s after an event-based keyboard/caret gesture
repair. Native hit testing identified AVKit's
AVVisualAnalysisView at the failed touch point; disabling its optional Live
Text analysis passes the same touch/skip diagnostic. The host now sets the
supported Expo property, and its rebuilt full Watch passed in198.775s.
The real interactive language-selector owner also passes Android Watch
in235.185s; a disabled placeholder Text child was not a valid readiness signal.
Both final consuming Release builds pass after shared typography/material
changes. Android foundation141.822s and complete Watch231.631s pass; iOS
foundation passes in7m41s and final Watch is running. Android's first attempt
was obstructed by a screenshot-confirmed System UI ANR, not an mLearn crash;
after dismissing that system obstruction, the unchanged flow passed.
Retained H00 devices and live learner profiles remain unchanged.

Fresh native startup renders the replacement Quartz theme. A bounded421MB
APFS clone plus consistent SQLite readonly backup supplies existing-profile
copy verification, with database integrity and process isolation checked.
Matching media/entry comparisons now use real test-video.mov at25.182s,
offset-6350ms and the actual courage entry in that copy, not a different
headword. The normal profile retains its original18.805s/offset0/rate1x.
Shared navigation density, Inspector definition/badge spacing and WebKit text
rendering were repaired from these comparisons. Latest local38harness,
19package and7web tests, typecheck, ownership lint, export and contracts pass.
Exact target states requiring absent ruby/prosody, live translation, aggregate
Known/Flashcard/Explain actions or cue-alignment arrows remain incomplete;
their semantics were not faked or added as new backends.
Final regional comparison repaired shared Inspector opacity/saturation,
platform CJK fallback, 40/64px subtitles, 166px Settings selectors and section
rhythm, Home outlines and the compact volume trough. Manual offset editing
is retained in Playback options; superseded floating APIs were removed.
An invalid offset is rejected beside its field, a valid retry saves through
Rust, and closing restores focus to Playback options.

Two review regressions have real before/after proof: a failed playback-rate
write now remains visible beside the selector, and focused combobox keys no
longer seek/mute/fullscreen the video. A temporary SQLite trigger in the
isolated profile rejected only rate updates; after removing it, retry saved
and cleared feedback. No trigger or held database transaction remains.
The desktop harness now protects both contracts through real WebDriver/native
actions; its Linux execution is pending. Latest local tests, typecheck, lint,
web export, seven browser tests and generated contracts pass. A stale
setSyncOpen reset initially failed typecheck, was removed, and the blocked
checks subsequently passed.

Final desktop1000px and420px Home, Settings, editor and matching Inspector
captures are retained and inspected. The real copied-source English switch
shows its unsupported-script error beside Retry analysis; restoring Japanese
recovers annotations without changing source time/rate/offset.
Final APK SHA256 is85a12c778fe64eb4ab56dea267215cebadc293370848f09f2b43d369a635f483;
iOS JS bundle isd24d4a0676ccf9d4dbad0706b717344d0bf82e9cb7286d029a06abdee380af0f.

Normal documented startup Resume-to-caption is1321ms with one401560us
Japanese initialization, versus1280ms before the rewrite. A warm reopen
during simultaneous simulator boot/build work took16465ms in resume_source
metadata preparation, while analysis remained cached; this is retained as an
anomaly, not counted as a passing latency sample. Its frame callback also
waited149638ms while the WebKit window was backgrounded. A visible warm
sample under remaining native load was2190ms; copied-source reopen1347ms.
Repeat with the normal app foreground and owned device load stopped before
closing the performance gate.
Next: finish final native workflows, narrow captures and uncontended warm/
package-switch measurements, then record gates and publish verified repairs.
Unavailable exact target capabilities remain incomplete, not accepted.

## Historical focused foundation repair - 2026-10-19

The maintainer authorized a focused performance/shared-UI repair on existing
`agent/m01`, draft PR #44, without advancing M02, starting M03, merging or granting
acceptance. The clean worktree was fast-forwarded to requested contract
`13ab1e8897a71f85843cf22efd6517d0b4439d28`. The unchanged base is `agent/h00`
at `87df9c137167601c6ae210ad2f663235f0a2a820`.

Application source `66a5f04d99c960b568e0f34d71ebb5752b4e7dad` includes backend
repair `52f94f5e` and shared UI repair `66a5f04d`, both pushed to the existing
draft PR. The backend retains Wasmi, validation, authentication, fuel/memory
bounds, cancellation and the single execution slot. Safe portable dispatch plus
bounded development optimization reduces real Japanese initialization from
21.6-21.9 seconds to 365-400 milliseconds; actual Resume to committed annotations
is 1.26-1.32 seconds, including the documented normal launch. Reopen reuses
morphology with fresh Knowledge. An unchanged package selection no longer
invalidates morphology; a real version change still validates/adopts normally.
The Release throughput tradeoff, failed experiments, exact inputs and full
red/green evidence are explicit in [FOUNDATION-REPAIR.md](FOUNDATION-REPAIR.md).

Shared theme roles now own complete typography. Text/Badge/Button/SettingRow
express reading/POS, selection and divided settings composition through real
Home/Settings/Watch/transcript/Inspector callers. Actual native light/dark,
420x560/2x, long/expanded/alternative, nested focus, error and pending-state QA
passed; the observed opening-label overlap was repaired. Home/final mobile
composition remains `visual_pending`, not accepted.

Current npm tests/typecheck/lint/contracts/web export/six browser tests, complete
native Rust suite and eight desktop host tests pass. Strict runtime/host
all-target and desktop production Clippy pass; unchanged desktop media-test
`useless_format` and the historical storage-test warning remain explicit, not
suppressed. Missing/timed-out LSPs are not passes. Both consuming mobile Release
builds pass; Android foundation/Watch pass in 123/205 seconds and current iOS
foundation/Watch pass in 598/164 seconds, zero failures. The diagnosed iOS
edit-menu automation gesture was repaired without weakening any assertion.
Hosted foundation `39295160843` passes on application source `66a5f04d`;
consuming mobile `39295160679` compiled both apps but failed its UI jobs:
Android's Pixel Launcher ANR obscured correctly selected English Home; iOS
completed persisted offset/transcript/claim/restart checks before its final Reset
tap hit a clipped control. Opened artifacts and JUnit failures remain retained.
Harness-only `8aa53c46` scrolls the real Reset/status targets into view and
dismisses only the specifically identified launcher ANR. Original assertions
remain unchanged. Consuming mobile rerun `39299585014` has passed Android's
actual UI/persistence, complete APK ABI and unchanged-source steps (zero failures
in 242.955 seconds; actual transcript/restart captures opened). iOS compiled but
its artifacts reproduced the clipped Reset failure: visibility alone did not move
the target. The job then exceeded its 55-minute execution budget; this is not a
passing iOS run. The harness now centers the target away from the viewport edge,
and the complete local consuming iOS 27 flow passes with zero failures in
177.994 seconds. The iOS job budget
reserves time for the unchanged 20-minute UI bound after its observed 42-minute
cold preparation/build, without weakening assertions.
Centered harness `0ca5ca83` passes complete hosted consuming mobile run
`39308549546`: actual iOS 26.5 and Android UI/persistence/source-integrity steps
all succeeded, none skipped. JUnit reports zero failures in 317.383/272.984
seconds; current native transcript/restart captures were opened. Current
foundation `39308549547` also passes all web/Rust/macOS/Windows jobs.
No application or native binary input changed after `66a5f04d`.
Linux `39295160705` exposed a real-pointer dismissal synchronization failure
immediately after Inspector reopen. Harness-only `463b76cf` observes entry/layout
readiness without changing the pointer action, disappearance assertion or timeout;
the complete real Linux rerun `39296832207` and foundation `39296832201` both
pass. Current Linux minimum/Inspector/transcript captures were opened.
Application/mobile inputs are unchanged; the original slow mobile build was
not cancelled or restarted.

Original desktop Slate 1x is restored at preferences revision 25; Japanese source
18,805 ms/offset 0/rate 1/click and learner revision/claim receipts 21/21 are
preserved. Private evidence remains local under `.mlearn/foundation-repair/`.
This focused checkpoint supersedes the older executable/theme identities below,
not its unresolved feature catalogue. All owned apps/reference servers/emulator,
QA app, database/computer handles and CI subscriptions are closed. The exact
2.1 GB task cache `/tmp/mlearn-repair.7JcXPy` was removed; ports
3000/8081/7780/4173 and owned desktop PIDs are clear, reference Git is clean.
`cleanup-receipt.log` records exit-zero verification. Original profiles/media,
compiled candidates, retained simulator/AVD and shared caches are preserved.

## Historical overnight batch - frozen for maintainer review, 2026-10-19

Execute [OVERNIGHT.md](OVERNIGHT.md) on existing `agent/m01`, draft PR #44 against unchanged `agent/h00`. H00/M01 remain unaccepted. No merge, release, M04+, new worktree or production/v2 writes. Starting local/remote source: `8d4589e162cee76224476cf959d4c04cb72f0a52`; H00: `87df9c137167601c6ae210ad2f663235f0a2a820`. Authorization documentation: `117cfc573b16c31139799b89e80e8695487dc4e6`. The historical checkpoint remains in that commit.

Effective executor: `chatgpt-subscription/gpt-6.1-sol`, medium. Started 02:35 local; no large new feature after 08:35; reserve through 10:35 for integration and handoff. Quota telemetry unavailable; no percentage inferred. One append-only notepad: `/var/folders/f2/d3_jzj917kg6sqsc9tgc80200000gn/T/ulw-20261019-023551.XXXXXX.md.AV9eHJ4Zbh`.

## Foundation: verified_for_continuation, not accepted

Pushed checkpoint `5e4135c631cde170054e5f514badcfcd5dde7fe7`. Reproduced repairs: ABI/initializer compatibility before activation; same-version compiled-artifact/cache freshness; package-local corrupt startup isolation; authenticated readable package names; Rust-owned spacingScale without narrowing OPS-02; shared 420x560/2x dialog body access; bounded oversized captions. Home and ordinary Settings now consume the same semantic controls and density rather than integration scaffolding.

Independent foundation source and rendered gates APPROVE. Actual original Japanese MOV/SRT -> Inspector -> Unknown/Withdraw/Known -> focused return passed. Native Android/iOS foundation and Watch flows passed on consuming Release builds; source and learner identity were preserved. Final Home/mobile composition remains visual_pending.

Foundation hosted runs: `39193890314` PASS; mobile `39193890392` PASS. Linux `39193890431` FAILED because its theme observer measured hidden retained Home rather than visible Settings; actual Settings was correctly 56px. Its JSON and opened failure image remain retained. The observer now selects visible Settings and preserves the 2x assertion; final current-source Linux passes as recorded below.

## Connected M02 increment: partial, verified for review

Implemented: native per-source/subtitle offset and reset, rate, validated source-language selection and deliberate inspection modes; real host seek/fullscreen/guarded shortcuts; bounded 16-cue exact case-sensitive transcript search/pagination and authoritative cue navigation; a second real AnnotatedText/Inspector/Knowledge consumer; authenticated install byte progress, scoped cancellation/retry, current-job recovery and schema-3 atomic durable install receipts (last 256 commands).

Actual desktop proof: positive 500ms offset navigates authored cue18000ms to media17500ms; original timestamps/text remain unchanged. Rate1.25 reaches the actual player and survives restart. Real immediate/delayed/Shift-assisted inspection, leave cancellation, shortcuts/fullscreen and minimum/2x surfaces were exercised. Current schema2->3 migration preserves exact original Slate revision18 and Japanese source18.805s/offset0/rate1/click. Transcript Withdraw then Known updates both transcript/caption and restores focus; learner revision/receipts21/21 reflect those two explicit actions, not hover evidence.

Actual Settings transfer cancelled at38674110/256569458 bytes, retained prior package, retried under a new command, recovered the same job after Home/return at120590725 bytes, validated and installed all256569458 bytes. Source/claims remained intact. Duplicated expected cancellation alert and concurrent catalog action were repaired. Normal network errors remain visible with explicit retry.

Independent M02 source review requested changes for cancelled Watch session ownership and save-before-fallible-window mutation ordering. Primary reproduced the latter with17 overlapping cues, then validated the response before saving every new preference. Watch now keeps session ownership in the focus effect, guards obsolete operations and re-enters that lifetime after cancellation. The real hosted cancellation/blur/checkpoint regression passes in the full Linux flow. Separately, a real healthy-server catalog failure was reproduced by event-gating a peer close while the current-thread reactor was parked; disabling idle reuse fixes the exact red/green regression. iOS rate assignment was found to start a paused AVPlayer in the pinned Expo implementation; the adapter now preserves paused state.

## Exact M02 catalogue ledger

These statuses describe this batch, not acceptance or deletion of required scope.

| Row | Current result | Still required |
|---|---|---|
| SRC-03 | Partial: independent persisted video package selection and two-source owner proof | Independent definition-language/resources and later real source consumers |
| SRC-06 | Partial: original SRT text, UTF-8 spans, combining marks, punctuation and literal transcript coordinates retained | Other source formats and richer alternatives/selection mappings |
| LNG-02 | Pending | Dictionary/definition-language resource selection and management |
| LNG-03 | Partial: authenticated progress/cancel/retry, failure rollback, durable receipts and screen-return recovery | Removal, full disk/network/native recovery inventory and mobile data management |
| LNG-04 | Partial: existing real English/Japanese plugin logic reused without core language branches | Structurally different genuine plugin conformance |
| LNG-05 | Pending | Third-party/private package, SDK/schema/licensing/catalog/mobile-inclusion proof |
| LNG-06 | Partial: activation identity, stale work rejection and receipt/history retention | Changed/withdrawn capability incompatibility workflow |
| LNG-07 | Partial: existing package-owned readings/senses remain shared | Open-ended declared structures/pronunciation rendering |
| LNG-08 | Partial: package-local startup issues and scoped operation/install diagnostics | Complete resource/capability diagnostics inventory |
| INS-03 | Partial: real existing reading/morphology/alternative entry data retained | Richer applicable structures and uncertainty |
| INS-06 | Implemented; real desktop and rebuilt iOS/Android touch flows pass | Maintainer review |
| INS-11 | Pending | Persisted reading/annotation/linguistic-color controls |
| INS-12 | Partial: long/ambiguous existing entries, granular corrections and scoped retry preserved | Final changed-consumer long-entry integration evidence |
| VID-04 | Pending | Real alternate/embedded track discovery and selection |
| VID-05 | Partial: bounded transcript, exact search, shared contextual inspection and offset-aware seek | Complete supported selection/line-navigation inventory and native long-page proof |
| VID-06 | Implemented; persistence/reset/real shifted timing and failure atomicity verified across desktop/iOS/Android | Maintainer review |
| VID-07 | Pending | ASS timing/style/layout and linguistic coordinate fidelity |
| VID-08 | Partial: real fullscreen, focus-safe shortcuts and Inspector continuity | Compact mode and complete shortcut inventory |
| VID-09 | Partial: persisted actual playback rate | Repeat/line/subtitle-aid legacy-control inventory and implementation |
| OPS-07 | Pending | User-facing authenticated catalog/service configuration |

M02 is not complete. M03 is not admitted; Capture/Material has not started.

## Verification and next action

Final current npm tests/typecheck/lint/contracts/web export/six browser tests and harness syntax pass in `.mlearn/overnight/m02-current-final-ui.log`. Complete frozen `npm run test:native` passes in `m02-complete-native.log`. Final repaired catalog 11/source 5 suites, strict Runtime Clippy and shared type/lint pass in `m02-repaired-final-check.log`; the parked-connection and failed-mutation regressions each failed before their fixes. Broad all-owner strict Clippy exposed an unchanged pre-existing default-field assignment in `crates/storage/tests/preferences.rs:9`; the actual baseline blob confirms it. It is not suppressed or claimed clean.

Final current consuming Release builds pass in `m02-{ios,android}-input-build.log`. Both complete native Watch/transcript claim/withdraw/preferences/reset/process-restart/exact-seek flows pass: iOS202.015s and Android225.684s, failures0, in `{ios,android}-m02-input/junit.xml`; complete action traces and viewed captures remain beside them. Earlier failures are retained: iOS rate assignment started AVPlayer, the first lifecycle repair prematurely closed the initiating dialog on both platforms, and an iOS label selector never focused the transcript input. Product repairs preserve pause and successful dialogs; the test now targets the real input and acknowledges each character. No assertion was deleted or weakened. Missing/timed-out LSPs are not compiler passes.

Independent final rendered gate APPROVE applies only to its opened actual captures and approved targets. Source gate REQUEST_CHANGES is preserved, with primary disposition separate from independent approval. Full real Linux `39213243022` PASS on `4eabcb307f4d4c02bd4fce872d3376052b7e8b92` includes held-native-response Cancel/route-blur, exact durable 10000/11000 ms checkpoints, offsets 375/625 ms, transcript claims/focus, real Shift entry, 2x/minimum bounds and exact restart/recovery. Earlier harness failures remain retained; the final harness observes genuine UI analysis without competing for its guest slot.

Application source `5e0f47170bb3b231b1a3cada377d7625ca7e937e` is frozen; subsequent harness-only repairs do not change native/mobile application inputs (actual path diff checked). Final foundation `39213243035` PASS on harness head `4eabcb3`. Hosted mobile `39208953200` PASS on application `5e0f471`, with both actual UI steps successful, not skipped: iOS 273.986 s and Android 243.57 s, zero failures. Source receipts, full logs and JUnit are retained locally. No mobile build was cancelled or restarted. Feature expansion is frozen; M03 remains unadmitted.

The current desktop executable is `0021bdcd47139f59298e9f01da044c720cab3d0bb4a8bf4c2df0b0d7bcace1a6`; exact served UI and source/package/image hashes are in `.mlearn/overnight/final-captures.json`. Actual minimum/2x nested transcript/Inspector search, scroll, correction controls and focused return passed. Original theme is restored at revision 20; source/claims remain at 18.805 seconds and 21/21. The combined report has been refreshed and inspected at desktop/phone widths in light/dark; all 17 images and 23 local links loaded.

Evidence stays local under `.mlearn/overnight/`; no private media/profile/capture upload. Combined review: `.mlearn/M01-review.md` and `.mlearn/m01/Watch-review-comparison.html`. Owned app/reference servers, emulator, iOS QA app, report renderers and disposable profiles are stopped; idle task cache root is removed. Original media, development profiles, compiled candidates, retained booted iOS simulator/Android AVD and shared caches remain. All required remote-CI watches have completed. This documentation-only reconciliation does not change tested application/harness inputs. Next: maintainer review of this named partial unit; no further product increment is admitted.

Launch: `source .mlearn/preflight/env.sh; export CI=true; npm run dev:desktop -- --no-watch`.
