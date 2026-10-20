# Current implementation checkpoint

## Active visual-parity rewrite - 2026-10-20

Status: `implementing`, not complete or accepted. Execute
[VISUAL-PARITY.md](VISUAL-PARITY.md) on existing `agent/m01`, draft PR #44,
against unchanged `agent/h00`. Requested `4a86df32` was fetched and already
equalled clean HEAD; no reset, history rewrite or new worktree was used.
This authorization supersedes the historical frozen-review, minimal-restyle
and unpictured `visual_pending` restrictions below. No new domain milestone,
merge, release or maintainer acceptance is authorized.

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
Next: finish Settings and migrate Watch/player/captions/transcript, then
Inspector/corrections, compare all states and run consuming verification.

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
