# Current implementation checkpoint

## Active authorization — integration checkpoint before M03–M07

On October 22 the maintainer authorized autonomous sequential M03–M07, with
independent review and full verification per milestone, and an independent
M01–M04 architecture review/repair before M05. Current integration/native
translucency/corrections must finish in a verified pushed checkpoint FIRST.
M03 has not started. Minor cosmetic polish may defer; usability and architectural
or functional gates may not. See the current PLAN/AGENTS authorization. Preserve
H00, branch history and draft PR44; stop after the consolidated M07 review
package for manual acceptance, without merging or self-acceptance.

## Active visual-parity rewrite - 2026-10-20

Status: `implementation_resumed`, not complete or accepted. Execute
[VISUAL-PARITY.md](VISUAL-PARITY.md) on existing `agent/m01`, draft PR #44,
against unchanged `agent/h00`. Requested `4a86df32` was fetched and already
equalled clean HEAD; no reset, history rewrite or new worktree was used.
This authorization supersedes the historical frozen-review, minimal-restyle
and unpictured `visual_pending` restrictions below. No new domain milestone,
merge, release or maintainer acceptance is authorized.

### Current application and verification - 2026-10-22

Pushed candidate `4a7927a0ca66f4882badc0aee9ea928c21509144`, tree
`06f1d1c38616d892b1e2f4ff601507bfac0d89a4`, includes the independently reviewed
Acrylic and native browsing repairs. The tracked worktree was clean at push.
Foundation `39722347849` passes all four jobs. Windows actually runs all 13
host tests, including rejected native Acrylic and owned-window apply/clear/
destruction; both new tests pass. Its source receipt, five native DWM/save/
restart states and all five compositor captures are inspected in
`ci-4a7927a0-windows/`. The Acrylic execution gate is closed.

Desktop consuming run `39722347957` also passes with matching source/tree and
the complete real IPC/package/playback/seek/Inspector/claim/restart/recovery
receipt. Actual progress is 66.67%, with tracks/ranges passing. Home progress,
focused Japanese card and narrow 2x theme-editor captures are inspected in
`ci-4a7927a0-desktop/`. Headless runner audio/portal/DRI warnings remain in the
retained log; this is not physical audio-output certification.

Native run `39722347870` fails in the original iOS UI workflow after 134.486 s:
the first English movie remains visible after the unchanged dismissal deadline.
This is not the earlier Japanese keyboard-focused state: actual before/failure
captures show list browsing with no keyboard, and the new Back/folder transition
executed. The failed hierarchy contains one English movie cell at
[0,327][393,391], with no search-dismiss container. Original failure, hierarchy,
logs and diagnostic exits remain retained in
`ci-4a7927a0-native/ios-build-evidence/`.
Diagnosis continues on the retained binary and matching runtime; no unchanged
CI rerun, assertion relaxation or new application build is scheduled.
Independent native timeline analysis, checked against the original log, shows
the intended movie was selected before FileProvider failed to resolve
`localstorage/did=6` with error `-1005`, returning no URL. This refutes a missing
or wholly consumed tap for this failure; the underlying identifier-resolution
cause is still unknown. An unchanged full-flow reproduction on a new disposable
profile and the same retained binary passes in 360.400 s; actual Japanese
Inspector and final English frames are inspected. A clean profile alone does
not explain the hosted failure. The owned local QA app is terminated and its
device shut down; both earlier retained profiles remain preserved.

A bounded buildless hosted diagnostic now reuses the immutable failed-source
binary, preserving its source/hash separately from diagnostic source. The
original unchanged UI flow runs before metadata probes, and its failing exit
cannot become green because a later probe succeeds. Host and simulator
Foundation observers report physical files and file/document/volume identities.
Both observers compile and execute on the local synthetic fixtures; the
simulator SDK launcher correction removes the initial sysroot warning. YAML
and every shell block validate; YAML LSP/actionlint are not installed, so no
such diagnostic pass is claimed. This temporary diagnostic is not an app fix,
an acceptance retry, or permission to start M03.
Diagnostic implementation is committed as `f4759b0af43bd5178e6501c7f3e7bb1caac768a0`,
tree `532b38ea57f9afe3a1053e8f209684d2c062e135`. Its push paths exclude the
normal application-build workflows; the diagnostic keeps binary source
`4a7927a0` distinct from its own harness source.
That buildless run `39730539643` reproduces the original Japanese dismissal
failure in 387.076 s, preserving original exit 1 and observation exit 0.
Initial/final containers match; all four files exist and are readable. Host
and guest agree that the Japanese file has document ID 3, while provider log
50816–50817 reports `did=3` cannot resolve and returns no URL. No file-loss or
wrong-tap explanation fits this observation.

The next controlled diagnostic changes only synthetic fixture preparation:
set the SDK's tracked-document flag and read its identifiers before Files first
enumerates it. Disposable local copies demonstrate flags 0 becoming 64 and
receiving distinct document IDs; the supported BSD command uses octal `0100`,
not an unsupported symbolic `tracked` argument. Original UI code, deadlines,
binary and provider remain unchanged. This registration hypothesis is not yet
a verified hosted repair.
The controlled registration change is `bab8b4c30b2841c008848936071aa3b8d4beaba8`
(tree `b5043be154e23c39f7bfa557f7b7e352038eecc9`), still confined to the
temporary diagnostic. Its original failed control remains independently retained.
The `4a7927a0` compiled simulator app is retained in `ci-4a7927a0-ios-binary/`
before UI completion. Source/tree match the candidate, gzip integrity passes,
and the main executable retains mode 0755 and size 630474056 bytes. Archive
SHA-256 is `a261f39dd44c5b9868af5fe94990b6ada262d5ee6e7aecdd8142572065942b2c`.
No extraction or rebuild was required for verification. The artifact-triggered
midpoint confirms Android job `119638455776` succeeded. Its retained original
workflow passes in 422.614 s with zero failures; source/tree match and selected
NDK is 30.0.16248370. Actual Japanese Inspector and restored English-continuity
frames are inspected in `ci-4a7927a0-native/android-build-evidence/`.
Hosted iOS acceptance still gates
the prerequisite checkpoint; M03 has not started.
Earlier owned duplicate export, extracted app, generated fixtures and
eight temporary probes are removed with absence readback. Both installed
runtimes remain Ready; retained iOS 27 stays booted and the owned iOS 26.5
fixture device stays shut down for reuse within the authorized batch.
Compiled archives, native profiles and all original failed/passing evidence
remain preserved.
The new clean-profile reproduction extraction, fixtures and standalone observer
binaries remain cleanup-owned until the resolver diagnosis ends.

#### Repair history and earlier-source evidence

Independent integration source audit `st_01a1613f` finds one genuine blocker:
window-vibrancy 0.8.1 discards the older-Windows Acrylic native BOOL on apply and
clear. The host could therefore report active translucency after an unsuccessful
native call. Primary verifies the pinned source. Local commit `9180d53e` replaces
only that unchecked boundary with checked native interop, borrowed module
ownership and the existing supported-build guard; Mica remains preferred.
Actual apply failure retains inactive state and accepted opaque RGB/alpha 255,
and failed clear propagates without pretending the effect was removed.
Windows-only tests call the real invalid-HWND failure and real owned-window
apply/clear with checked destruction. Their Windows execution remains pending;
no Windows red run is invented on this Mac host.

Independent delta review `st_01a1614c` is APPROVE CODE, no remaining scoped
blocker. Both changed Rust diagnostics, scoped formatting and all 11 Mac host
tests pass. Fresh normal Mac startup renders saved Dark Quartz and exact
original theme JSON reads back unchanged; compositor capture
`checked-acrylic-macos-startup.png` is inspected. Graceful Quit releases PID95922
and ports8081/7780. No source/claims/preferences are changed. Workspace-wide
formatting still reports 21 unchanged baseline files; these are recorded in the
current notepad, not reformatted or suppressed.

Local commit `9f8363b1` aligns the failure-only picker replay with the same
document-cell selection. Its real preserved-binary diagnostic passes in 32.431 s,
with dismissal capture inspected and owned app cleaned. These local commits
were held until exact de7bcfed mobile verification ended, avoiding duplicate
native compilation. Its iOS failure is now reproduced and repaired locally
through the shared browsing-state helper below. Windows runtime verification
of the checked Acrylic boundary and matching hosted iOS 26.5 acceptance still
gate the prerequisite checkpoint/M03.

Corrected-source compiled iOS artifact from `39706097460` is retained in
`ci-de7bcfed-ios-binary/`: source `de7bcfedbcf6cca114b5c58997ab437964880747`,
tree `cfde21a086b4318e97d034c67d76d873e2a1a6fe`. The archived real executable
retains mode 0755 and size 630474056 bytes. Archive SHA-256:
`571f1a8905eab4184b88050592848bc4d6ccb325deff1a4cad89248f83ddb818`.
Archive identity verification needed no extraction or rebuild. A single artifact-triggered midpoint check
confirms Android job119586366500 succeeded. Its exact-source evidence is retained
in `ci-de7bcfed-native/android-build-evidence/`: complete original workflow
passes in 376.477 s with zero failures, source/tree match, and actual Japanese
Inspector and restored English-continuity compositor frames are inspected.
iOS119586366668 fails the original Japanese movie-dismissal assertion after
376.505 s. Exact native row bounds [0,199][393,263] and tap (196,231) are confirmed
in the log; pre/post captures remain unchanged with focused Files Search and
keyboard. Document-cell selection therefore does not repair hosted iOS 26.5.
The old failure-only replay still used the filename target in this source;
its failure is not a cell-replay result. This run's keyboard experiment fails
`hideKeyboard` itself, not a subsequent keyboard-hidden movie selection.
All original failures/exits remain retained in
`ci-de7bcfed-native/ios-build-evidence/`.

Read-only input-target log investigation `st_01a16171` completed. Initially
only iOS 27 existed locally; matching iOS 26.5 was acquired through normal Xcode tooling,
with explicit resource ownership. Reproduction and repair used the retained
exact app before changing helpers. No application compile or unchanged CI retry
was needed.
Native logs prove the touch reaches DocumentManager and completes, not that a
movie is activated. Failure hierarchy exposes a full-area search-dismiss
surface; its hit-test role is unverified. Matching runtime acquisition is
iOS 26.5 build 23F77, confirmed equal to the hosted backend path, now available.
The retained de7bcfed app is installed on one owned matching iPhone 16 device
`2CD4B3B7-5ABB-4A12-83D2-4D3E8841953A`; the separate27 profile was not used
for that reproduction.
Pinned Maestro2.11.0 is verified. The unchanged full workflow reproduces the
same Japanese dismissal failure after 262.512 s with original synthetic fixtures
and assertions, no recompile or acceptance-helper edits. Its native state is
retained. Apple denies debugger attachment to the protected picker service;
no hit-test result is claimed or protection bypass attempted. The actual
search-dismiss action also leaves search/keyboard unchanged. This Xcode has no
Simulator GUI, so no independent HID result is claimed. Real native text entry
and Search submission work, but fixture queries return no indexed results.
Actual native `BackButton` navigates to the parent; re-entering the real fixture
folder clears the search-owned state. The unchanged movie-cell tap, original
10-second dismissal and actual player opening then pass in 6.056 s on the same app,
media and profile; before/after compositor images are inspected.

The shared `watch/open-ios.yaml` now keeps Search/More/List modal coverage,
then navigates through that real parent/folder transition before selection.
No movie/player/subtitle/claim/restart assertion or deadline is removed or
relaxed, and no search-index dependency, coordinates or app workaround is added.
Full original acceptance `997` passes in 343.522 s on the same retained iOS 26.5 binary
after fresh-process termination only. Real Japanese browsing/Inspector and final
English-continuity images are inspected in `ios26_5-browsing-full/`.
The picker diagnosis is complete; matching hosted verification remains separate.

Cross-runtime iOS 27 first acceptance `999` exposes a real helper regression after
56.394 s: that runtime uses `DOC.navBarButton.backInHistory`, not `BackButton`.
Its actual Back action is exercised and inspected: it leaves search in the
current folder, whereas iOS 26.5 returns the parent. The shared selector now recognizes
both observed controls and conditionally re-enters the folder only when the
parent is actually shown. No OS-version branch, coordinate, retry or weakened
product assertion is added. Corrected full acceptance `1001` passes in 373.352 s
on the same retained current de7bcfed app and preserved profile. Actual Japanese
Inspector and final English-continuity frames are inspected in
`ios27-browsing-corrected-full/`. Final shared-helper regression `1002` also
passes in 120.340 s on iOS 26.5, exercising both complete movie/subtitle imports and real
English/Japanese annotations, with inspected frames. This checks the final
selector/conditional expansion without repeating unrelated claim/restart work.
Independent source/evidence review `st_01a161ce` APPROVE CODE has no blockers;
all original product assertions/deadlines and original failing-exit handling
remain intact. Final exact-source hosted and Windows runtime gates are not
waived by these local results or the review.

Installer relocation5FE62004 -> D3D91385 does not lose data: main/WAL and all
four fixture hashes match exactly, logical database hash is unchanged, and
readonly counts remain 2 sources, 2 claims and 12 claim receipts before app launch.
Both owned QA apps are terminated/read back absent. The original iOS 27 simulator
remains booted and intact; the owned iOS 26.5 device is shut down. Retain the matching runtime and new
fixture device for the same authorized M03–M07 batch instead of recreating this
large environment each milestone; temporary duplicate exports/extraction and
probes remain cleanup-owned. Actual Windows Acrylic execution and the next
exact-source hosted checkpoint still gate M03.

Status remains `implementation_resumed`, not accepted. Pushed consuming source
is `de7bcfed`, containing approved queued-Inspector source cancellation
correction `b60adaef` and native document-cell target `0597d4a0`. Its foundation
`39706097367` passes all four jobs; actual Windows five-state native transitions
and receipts match source/tree. Desktop `39706097259` passes with exact-source
complete consuming receipt, progress/ranges and current Inspector flow.
Local helper checkpoint is `033b4a2a6f6b2df79ea764a785f6dcc2a71d1f2d`, tree
`80b4db07f377b28ba6163b9bf8708690316fe87c`, including the reviewed Acrylic
repair, diagnostic alignment and shared browsing-state repair. Current client
export and all eight
browser interactions pass. Windows execution of the new boundary and matching
hosted iOS acceptance still gate M03; documentation does not replace them.

Remaining mobile presentation difference: native player-control shapes can show
through translucent Inspector chrome during paused-control presentation.
Actual modal/claim/restart workflows pass; no input interception is established.
Keep this visible material/readability refinement explicit in the permitted
post-M07 cosmetic review rather than claim mobile visual acceptance.

Candidate `442e4b96ab45cd08fa8b0894413a83adb5777f40`, tree
`acb8d4da42c53af5537107eca8094326395a5dd7`, is pushed. Foundation
`39698852577` passes Rust, web and both desktop jobs. Windows now passes the
entire real native UIA/DWM sequence: Quartz Mica/light, Dark Quartz Mica/dark,
opaque Slate, new-process persisted Dark Quartz, and final Quartz/light save.
All five compositor captures, source/tree, JSON and run log are inspected in
`ci-442e4b96-windows/`. This resolves the earlier focus-input failure without
a product focus workaround. Real desktop `39698852567` also passes; exact
source/tree, complete consuming receipt, actual progress/ranges, focused
Japanese card and narrow 2x editor are inspected in `ci-442e4b96-desktop/`.
Native `39698852590` completes with Android passing the full 423.119-second
English/Japanese workflow. Actual selected NDK30.0.16248370 is verified across
all 23 consuming modules, including Unistyles; source receipts and real
Inspector/English-continuity frames are inspected. iOS26.5 fails Japanese
movie dismissal after563.693s. Its same-state identical label replay fails;
confirmed keyboard removal followed by the same selection also fails.
This rules out keyboard-only or transient identical-retry explanations.
Exact artifacts are retained in `ci-442e4b96-native/`; no failure is waived.
The enabled native document cell is distinct from its filename descendant.
Movie selection now targets that cell by exact ID, with all dismissal/product
assertions and deadlines retained. This is an unverified hosted repair hypothesis,
not a claimed product defect. Full original-flow verification passes354.254s
using the actual preserved CI app on the retained iOS27 simulator; no rebuild
or profile reset. Picker dismissal, Japanese Inspector and restored English
continuity captures are inspected in `ios-retained-document-cell/`.
Installing the app relocates its data container, but October21 fixture files and
native storage (2 sources/2 claims/6 receipts) survive. Do not mistake the changed
container UUID for data loss. Replay app termination is read back absent from
launchctl; the owned extracted copy is removed and the compressed artifact
retained. Hosted26.5 verification remains mandatory.
Its compiled iOS simulator app is
preserved locally before UI completes in `ci-442e4b96-ios-binary/`; source/tree
match this candidate and the archived executable retains mode0755.
Archive SHA-256:
`f535904737af7e9694835075d57de07df0f65521032a63119dfa8c0b9ba4ac14`.
No build is duplicated or cancelled.

Read-only M01/M02 readiness audit identifies a queued Inspector lifetime issue.
Native in-flight inspection already has source cancellation; the client queue
was missing that epoch fence. An event-gated client test fails before the fix
because obsolete inspection enters transport after source cancellation.
Both single/batch lookups now reuse the existing source epoch fence; admitted
durable checkpoints and claims remain unaffected. Targeted 12 tests,
typecheck, ownership lint and all 56 harness / 27 package tests pass.
Logs: `inspector-queue-cancellation-{red,green}.log`. Independent review
`st_01a160ff` APPROVE has no blockers and independently passes all 16 existing
client-suite tests. This two-file correction is committed as `b60adaef`,
held until the previous native candidate ended, now included in the next push.
No new native
cancellation framework is introduced. Review does not waive native gates.

The retained automatically restarted dev window was blank. Its screenshot is
retained as a failure, not acceptance. Graceful quit releases PID57868 and both
development ports; a fresh normal documented launch with the same profile
renders Home, exact Japanese source and genuine Inspector correctly. No product
startup change or profile reset was needed. Current repaired-client telemetry:
fresh-process/warm-filesystem Resume to usable captions 581ms, initialization
416.184ms, Inspector action to frame 75ms, warm reopen 113ms without another
initialization. The source remains paused18.8050003052s/rate1/offset0 and no
claims change. Captures `current-integration-normal-{inspector,warm-resume}.png`
and `current-integration-normal-startup.log` are inspected. Graceful quit exits
PID78458 and ports8081/7780; builds, evidence and profiles are retained.
Client LSP freshness times out; actual typecheck and changed-test diagnostics
pass. No clean LSP result is claimed for the timeout.

Windows foundation `39693981018` (job `119546767596`, c5e89717) verifies actual
Quartz Mica/light, Dark Quartz Mica/dark, opaque Slate and a new-process
persisted Dark Quartz startup. DWM backdrop values are respectively 2, 2, 1,
2; dark values 0, 1, 1, 1; all HRESULTs zero. The final Quartz restoration
fails before save: editor content stays Dark Quartz. The probe now waits for
the dialog's real initial Close-button focus, then subscribes before moving
focus to the editor and sending its single paste. This follows the actual
pinned modal FocusScope lifecycle. No product focus change, repeated input or
weakened native assertion is introduced. Final Windows verification is pending.

Android NDK alignment is locally verified. The Expo config mod sets the root
and every Android application/library module from ANDROID_NDK_HOME metadata.
Repeated real prebuilds are byte-stable. Release Gradle with the consuming
init-script assertion passes in 7m8s; all 23 native modules use 27.1.12297006,
matching Rust. The initial assertion incorrectly included pure-Java Gradle
plugin builds; its scope was repaired and the failed Gradle step rerun.
The APK contains exactly arm64-v8a/x86_64 with both Rust bridges; SHA-256
37c39c71c71ef86b10ac5785717bb23ec59e6b294d46c850ff3b3cbc7e50c5f2.
The retained API35 ARM64 device installs it with `adb install -r`, preserves
its profile, and passes the real Runtime/Hello native boundary in 11.371s.
Its owned emulator is gracefully stopped without wiping data. Evidence:
`android-aligned-ndk-build-scoped.log`, `android-aligned-ndk-smoke/`.

Hosted native b7fac91e run `39688396167` still fails both UI gates. Android
builds and exercises English/Japanese annotations and synchronization, then
loses its ADB connection during the resumed Japanese flow after 371.236s.
The retained native log records host-17 offline at 23:50:28.830, before
Maestro teardown at 23:50:30.257; teardown is not the cause. No app crash,
memory kill or transport root cause is established. Exact artifacts:
`ci-b7fac91e-android/`. iOS 26.5 again fails Japanese Files dismissal after
436.46s, with the exact enabled filename and keyboard still visible:
`ci-b7fac91e-ios/`. Neither is waived by earlier platform passes.

The iOS runner now preserves the original acceptance exit while running
failure-only same-picker experiments: one identical filename selection,
then keyboard dismissal plus selection only if the identical attempt fails.
Original acceptance flows/assertions are unchanged. Actual shell-exit
regressions pass for success and both diagnostic branches. The retained
iOS27 simulator/binary validates keyboard removal and selection in 13.606s;
this is command validation, not reproduction or repair of hosted iOS26.5.
Its isolated fixture profile now contains that diagnostic selection; no
learner claims or production profiles were reset. The workflow archives the
compiled simulator app with source identity before UI testing, preserving
executable modes and symlinks. A real local retained-binary tar validates
packaging, but source-bound hosted artifact upload is still pending.

The integrated candidate passes typecheck, ownership lint, 56 harness and
26 package/source tests, web export and all eight browser interactions.
Retained terminal run: `bash_957`, exit zero. Android build/runtime checks above
are separate from full hosted acceptance. Windows focus readiness and iOS
same-failure diagnostics require their actual platform runners. No active
build was cancelled, profile wiped or CI assertion relaxed.

Earlier source-bound verification history:

Current runtime/shared UI inputs remain
`b7fac91ef93a8e25854f0052f689d3d0a794fd1b`; Windows test/evidence repairs and
the isolated Android NDK-generation repair continue on existing draft #44.
Status: `implementation_resumed`, not complete or accepted. Windows startup
focus verification `39689717875` fails at the same UIA lookup; that unproven
product change is removed. Product inputs match verified b7fac91e exactly.
Provider-discovery run `39690695182` fails earlier and supplies the actual cause:
`Process.MainWindowHandle` initially selects an unnamed helper pane, not the
eventual process-owned `mLearn` window. Its exact job `119535859749` and capture
show that helper before the application is visible. The UIA-parent diagnosis
was wrong and is withdrawn, not carried as an application accessibility defect.
The Windows probe now waits for the actual process-owned, named top-level
window and carries that same UIA/HWND identity through controls, DWM capture
and closing. Browser flags, renderer-class assumptions and the unproven product
focus change are absent. Original controls, deadlines and DWM assertions remain;
the corrected window identity still requires Windows verification.
Run `39691697164` verifies the corrected identity: native UIA finds Home,
invokes Settings and exposes the full real control tree. It then waits for
an InvokePattern on the visible enabled popup trigger `Edit theme JSON`, which
does not offer that pattern. The probe now dispatches supported native Invoke
or ExpandCollapse activation, without replacing controls or changing deadlines.
Native DWM state is logged before assertions; the pwsh wrapper retains UTF-8
run logs while the UIA child remains Windows PowerShell/MTA. Windows material
transitions are still unverified.
Run `39692819010` now verifies actual native Mica and the live light/dark
transition: Quartz backdrop=2/dark=0, Dark Quartz backdrop=2/dark=1, both DWM
HRESULTs zero. Their compositor captures are inspected. The next Slate paste
fails an immediate complete-value comparison before save. The probe now
subscribes to native ValueProperty changes before its single paste and awaits
the entire expected document, normalizing only CRLF/LF in both values; a timeout
retains exact escaped expected/received text. No input is replayed. Opaque
clear and persisted restart remain unverified on Windows.
Current mobile verification remains subscribed, with the earlier hosted iOS
Files failure unresolved.
Native `39685611279` has completed: iOS 26.5 builds and passes the English
claim/player/restart path, then fails Japanese Files dismissal at 466.499
seconds. Its exact enabled filename tap is (154,221); before/failure images
still show the focused Search field and picker. Android fails during Gradle's
NDK27.0.12077973 auto-install (`Archive is not a ZIP archive`), before UI.
Both platforms' exact artifacts are retained; Android NDK consumer alignment
is being traced separately. No original native assertion is weakened.
Local 11 host tests, 54 harness / 26 package tests, typecheck, ownership lint,
web export and eight browser interactions pass in their affected scopes.
Portable-font real desktop `39688396439` passes at b7fac91e; exact source/tree,
full consuming receipt, narrow 2x editor and focused card were inspected.
macOS normal startup, real saved Dark Quartz -> Quartz -> opaque Slate ->
original Dark Quartz transitions and a fresh normal restart were inspected in
actual compositor captures. The original theme document is read back unchanged;
source checkpoints and learner claims are preserved. Direct native-view
introspection failed and is not claimed. Windows UIA/material transitions and
hosted iOS remain open; passing builds do not waive these gates.
Compositor evidence: `native-theme-quartz-settings-composited.png`,
`native-theme-opaque-slate-composited.png`,
`native-theme-dark-restored-settings-composited.png` and
`native-theme-after-save-restart-composited.png`.

Retained native-material evidence sequence (source-bound history):

Native theme integration `fdcaf52f4cc4257bc00207a148a126098c90bbcb` is pushed and undergoing platform
verification, not visually accepted. Accepted Quartz/Dark Quartz preferences now
drive the desktop host's actual NSVisualEffectView or Windows Mica, with Acrylic
on older supported Windows versions and opaque fallback when native application
fails. Slate/custom palettes remain opaque. Startup reads the persisted Rust
snapshot before showing the window; successful saves synchronize from the
committed snapshot, with revision ordering and no additional theme preference.
The renderer receives actual native availability instead of inferring it from
window chrome. Historical built-in fingerprints have one shared data owner.
The shared AppShell, ContextPanel and MediaOverlay now put backdrop materials
in noninteractive background siblings, preventing an ancestor backdrop root
from blocking nested Inspector/popover blur. The actual Knowledge popover was
inspected at desktop, narrow and 2x text scale, including scrolling actions and
focus restoration. The original saved Dark Quartz JSON was restored exactly.

The coherent local candidate passes 11 desktop host unit tests, typecheck,
ownership lint, all 54 harness / 25 package tests, web export and all eight
browser interactions. Log: `native-theme-and-backdrop-checks.log`. Tests include
real temporary persistence, accepted versus rejected theme saves, custom/Slate
policy and historical startup fingerprints. Native tests also exposed an older
SourceRecord fixture missing subtitle_offset_revision; its neutral zero field
is restored without changing assertions. The normal documented desktop launch
rebuilt and rendered the saved Dark Quartz Home. Read-only LLDB inspection of
the actual native view is awaiting the maintainer's macOS debugger authorization
dialog; no authorization interaction was automated. Dynamic macOS transitions
and compositor captures remain open. Windows UI Automation/DWM transition and
restart captures are added to the existing foundation Windows job, but have not
yet run; no Windows visual result is claimed.
Changed-source foundation `39685611412` has completed: Rust, web and macOS
desktop pass. Windows builds and all desktop host tests pass, but the native
material step fails before producing its run log/captures. The uploaded source
receipt contains the correct commit followed by literal `HEAD^`, demonstrating
PowerShell parsed unquoted `HEAD^{tree}` incorrectly. Exact job `119518775627`
confirms `fatal: ambiguous argument 'HEAD^'` terminates the step before launching
the material script. The revision argument is now quoted; workflow YAML parses
and the diff check passes. No Windows visual result is claimed. Real desktop
`39685611328` passes; its source-bound evidence download is active. Native mobile
`39685611279` remains subscribed; no active build was cancelled or duplicated.
The quoted-revision follow-up `39686510030` passes Rust, web and macOS again;
Windows build/11 host tests pass, then its real UI exercise times out after
25 seconds waiting for an unnamed control. Exact job `119521821872` is
retrieved with ANSI output explicitly enabled; only source receipts were
uploaded, so the missing UI state and cause are not established. The Windows
harness now names each subscribed wait, retains native stderr, and captures
the desktop, bounded UI Automation tree and process/interactive-session state
on failure before releasing its owned process. Assertions, event subscriptions
and 25-second deadlines are unchanged. This diagnostic code cannot execute on
the local macOS host and requires the actual Windows runner.
Diagnostic `ebdc7b7f` / foundation `39687315674` again passes Rust, web and macOS;
Windows builds/tests pass and its named wait fails at `Home Settings action`.
Exact job `119524559332`, screenshot and bounded UIA tree are inspected:
the owned window is foreground, alive and visibly renders Home in interactive
session 2, but WebView2 exposes only panes, no web controls. The test process
now enables WebView2's documented `--force-renderer-accessibility` on-demand
renderer tree; production host arguments and real UI/DWM assertions are unchanged.
The screenshot independently exposes a serif fallback on Windows. Shared web
text roles now retain Helvetica Neue first with Helvetica/Arial/sans-serif
fallbacks; TextField preserves those role properties while adding search
geometry. The new regression fails before that repair, then all 54 harness /
26 package tests, typecheck, ownership lint, export and eight browser tests pass.
Desktop light Settings, dark editor and 390px editor captures are inspected.
Theme/TextField diagnostics are clean; the test file retains its existing LSP
node:test/node:assert type-resolution diagnostics (the executable suite passes).
Actual Windows font rendering, controls and native transitions remain pending.
Follow-up `b7fac91e` / foundation `39688396309` passes Rust, web and macOS;
Windows app/host tests pass and its new screenshot confirms the sans-serif
repair, but `Home Settings action` still times out with only renderer panes
in UIA. The renderer-accessibility flag was ineffective and is removed.
Pinned Tauri 2.12.3 `show()` only shows the native window; pinned Wry 0.57.0
ignores its initial WebView2 MoveFocus failure while the host is hidden.
Windows startup now explicitly restores webview focus after showing the
material-configured window. This is a focused startup repair hypothesis,
not a claimed Windows pass; the original UIA controls/DWM assertions remain.
Local 11 host tests and lib diagnostics pass. Real desktop `39688396439`
also passes at b7fac91e; its artifact inspection remains open.
The pending macOS debugger attach ended with `could not pause execution`;
the previous app/dev process also exited. Native view introspection is
unverified, not evidence against the implementation. The normal documented
desktop launch is restarted using the saved profile for compositor verification.
Actual current native Home/Settings,
focused live-card backing, card Inspector, nested Knowledge and synchronization
were inspected. Nested Knowledge visibly blurs dictionary text beneath it;
Inspector dismissal restores focus to the originating live card. Captures:
`native-theme-settings-dark-inactive.png`,
`native-theme-live-card-nested-material.png` and
`native-theme-live-card-focused-material.png`. These window captures prove
shared content composition, not under-window OS vibrancy. The original
test-video.mov is restored paused at 18.8050003052 seconds, offset zero, rate 1;
temporary live cards and synchronization are hidden again. No claims changed.

Native `39672070585` has completed: Android passes its complete 423.368-second
flow with zero failures. iOS fails after 225.951 seconds at the first English
movie's Files dismissal, before the later Japanese boundary. Exact artifacts,
hierarchy and tap logs are retained under `ci-e494df59-native`. The enabled
English filename was tapped at (142,349), but the picker remains visible.
The focused Search field/keyboard and slower hosted interactions are evidence,
not an established cause. The unchanged local iOS 27 full-flow pass below does
not waive the hosted iOS 26.5 failure. No speculative picker fix or weakened
assertion has been introduced.

Status: `implementation_resumed`; current-source hosted acceptance is incomplete,
not accepted. Previous verified application is `fc14fcff81a2a2c72e8593fe2a1be7da61754862`,
tree `4d50a95db7ed049ff4e5ebc2ef374c0edebf2665`, on existing `agent/m01` / draft #44.
Changed-source foundation `39672070578` passes all four jobs (Rust, web,
macOS desktop build and Windows desktop build), with exact HEAD verified.
Desktop `39672070821` fails in the real consuming flow at
`native-smoke.mjs:750`: `Timed out: 日本語`, after replacing subtitles and seeking
from the resumed source position to 2 seconds. Exact job `119472351053` and
source are verified. Exact artifacts under `ci-e494df59-desktop` show a paused,
error-free player at 20 seconds with `字幕`, not the requested 2-second cue.
The raw harness seek raced `MediaPlayer.web.tsx`'s initial metadata seek, the
same race already guarded in the preference probe. The test now observes the
visible player's completed native 20-second resume before its raw seek, then
observes the completed 2-second seek and `日本語`. All original subtitle
assertions remain. The shared event observer also listens for `loadeddata`;
there is no sleep, retry, timeout increase or application change. Harness repair
`fc14fcff` is pushed; syntax, ownership lint and all 54 harness / 25 package/source
checks pass. Foundation `39673421392` passes all four jobs with exact source
verified. Desktop `39673421585` now passes the full real consuming flow at exact
`fc14fcff`; exact source/tree and artifacts are inspected. The formerly failing
frame now shows `日本語` at 0:02; real Japanese focused-card and 66.67% source
progress/range receipts also pass. The full receipt confirms IPC, authenticated
packages, playback/seek, contextual Inspector, shared claims, exact source
restart and missing-source recovery. Native input paths
did not change, so the existing
native run remains valid and was not cancelled or duplicated.
Native `39672070585` has completed with the separate Android/iOS results above.
No unchanged workflow was retried. Previous application `a555dc39` foundation
`39656998985` and real desktop `39656999028` pass. Its native
`39656998975` has completed: Android passes the full 429.918-second flow; iOS
builds and passes English import, claims, playback and restart, then fails
Japanese media-picker dismissal at 453.049 seconds. No build was cancelled or
unchanged workflow retried.

Current iOS investigation: exact source/tree, JUnit, screenshots, hierarchy and
tap log are retained in `ci-a555dc39-ios`. The Japanese filename is enabled at
`[100,211][208,232]`; the actual tap is `(154,221)`. Before/after frames still show
the picker and keyboard, so this is not the old missing-List snapshot failure.
Keyboard/first-row interaction, filename hit behavior and inherited picker state
remain hypotheses, not an established cause. The unchanged full flow on retained
diagnostic device `6790712D-7A1A-4BFC-A084-45B427A2652A` passes imports but stops
at its historical Knowledge labels, before the Japanese boundary; it does not
reproduce the new failure. A focused picker/player/restart-history replay passes
on that same binary without rebuilding: 132.013 seconds, including real Japanese
movie/subtitle selection and visible Japanese captions. The before-selection
capture still has the focused Search field and keyboard, so those conditions
alone do not reproduce the failure. Only iOS 27.0 is installed locally; CI uses
iOS 26.5, so a local result does not certify the hosted platform. Current-source
native preparation and the incremental Release simulator build both pass.
The unchanged full acceptance flow passes on that device with current source:
368.346 seconds, zero failures, including English claims/player/restart,
Japanese movie/subtitle selection, Inspector, synchronization and original
English continuity. The latter two real screenshots were inspected. This is
local iOS 27.0 evidence, not a reversal of the hosted iOS 26.5 failure.
No new simulator or environment was created.
The build retains upstream React/Expo warnings; it is not warning-free. No
helper or product repair has been made for this new failure. Artifacts are under
`picker-current-repro`, `picker-history-repro` and
`picker-current-source-repro`; build logs are `picker-current-prepare-ios.log`
and `picker-current-xcodebuild.log`.

Independent visual follow-up: selected-reference Home and the current app were
inspected at the same 1200x700 logical size. Reference text ghost buttons have
visible dark material; current Home quiet actions are visually transparent.
The reference's shared `.btn-default` owns `backdrop-filter: blur(8px)` even when
the ghost variant clears its fill, whereas v3's shared quiet variant lacks it.
The actual reference console confirms transparent fill, blur(8px), transparent
1px border and 8px radius. WebKit receives the same blur but does not reproduce
Chromium's native dark backing from blur alone. A shared web-only quiet material
now uses the measured 35% black tint in dark appearance and no light tint;
icon-only and native quiet controls retain their existing treatment. The actual
Home now shows the reference's dark nav/action material. No interface preference
or alternate implementation was introduced. Actual browser hover feedback passes,
as do typecheck, ownership lint, 54 harness and 25 package/source tests, web export
and all eight browser interactions. Narrow light Home, narrow dark Settings and
desktop dark Settings were inspected. The current native Home capture is
`home-selected-quiet-material-final.png`. The test file has clean diagnostics;
final theme/button LSP freshness checks time out, not a clean diagnostic result.
The local iOS pass precedes this web-only material change; its native branch and
picker are unchanged.

Scope clarification, 2026-10-21: the legacy Interface style selector is explicitly
excluded, including persisted style preferences, parallel implementations and
selector compatibility machinery. Integrate only the maintainer-selected
reference presentation without a style name; ignore alternative style variants.
Themes remain separate. Audit of SettingsScreen, the native ThemeDocument/preferences storage,
theme projection and shared UI finds no selector or style preference to remove.
`surfaces.glass` is a shared material role, not a mode; `windowMaterial` is a host
capability, not a saved user preference. Existing built-in palette migration
handles theme documents only. Approved materials are preserved. SPEC P13,
FEATURES OPS-01, REFERENCE, DESIGN and AGENTS record the exclusion. No
selector-removal runtime change is needed. The actual isolated reference now
uses the selected presentation, read back through its public setting; Home and
Settings were inspected and captured as `reference-selected-home-dark.png` and
`reference-selected-settings-dark.png`. Its source style file adds no structural
overrides; base shared controls/panels and palette supply the design. Existing v3
materials already belong to those shared roles, not an alternate mode. No
runtime style branch or extra component implementation was introduced.

- `4175206` repairs the reproduced iOS test-driver snapshot boundary, not product
  accessibility. The default XCTest modal optimization hides actual Files
  controls while Search owns the keyboard. The public
  `snapshotKeyHonorModalViews: false` workspace setting restores them. The
  default reproduces missing More; the override passes both real English and
  Japanese media/subtitle imports on the retained diagnostic device/binary.
  The ordinary helper deliberately traverses Search/More/List and selects
  filenames; the workflow passes the config explicitly. These local results do
  not certify the new source's native flow.
- `a555dc39` restores the reference's real macOS under-window material through
  the host/bootstrap/shared-shell owners. The actual defect included opaque
  router ancestors; a solid sampled background was not a fix. Native appearance
  follows the system. Built-in light and dark palettes receive measured tints;
  custom palettes preserve their saved opaque colors. Browser/mobile fallbacks,
  opaque Settings content and media canvases remain intact.
- Controlled running-v2/v3 captures use the same 1200x700 logical / 2x window
  rectangle and background bands. Window-only bitmaps flatten native vibrancy,
  so the material proof is composited region capture. Actual light WebKit
  rendering needs a white 75% floor, not Chromium's 50% body value. Shared
  navigation is transparent and the reference Quartz backdrop filter is retained.
  Light and dark Home, Settings, loaded idle/focused cards and the courage
  Inspector were inspected. Current images and identities are in
  `.mlearn/visual-parity/manifest.json`.
- Final material source passes native-inclusive typecheck, ownership lint, all
  54 harness and 25 package/source regressions, web export and eight browser
  interactions, including transparent router-ancestor protection. Root and
  Layout diagnostics are clean; theme LSP freshness timed out. CLI typechecking
  passes, but a freshness timeout is not a clean LSP result.
- Exact-source desktop artifacts under `ci-a555dc39-desktop` verify source/tree,
  real progress ranges (66.67%), compact header/source geometry, narrow focused
  auxiliary cards and the complete IPC/package/playback/Inspector/claim/restart/
  missing-source flow. Foundation passes all four jobs, including both desktop
  host builds. One read-only increment gate `st_01a15fd6`, explicitly verified
  on `chatgpt-subscription/gpt-6.1-sol`, approves `6f840964..a555dc39` with no
  blocking code findings; this does not grant native or maintainer acceptance.
- Exact original Dark Quartz JSON was restored through real editor input and
  read back byte-equivalently as parsed data, with textScale 1 and unchanged
  extensions. The isolated reference also reads back Dark Quartz. Diagnostic
  background processes are terminated. The actual original paused test-video.mov
  is read back at 18.8050003052 seconds, zero offset and 1x; the courage claim and
  Mixed aggregate remain intact. `final-restoration.json` records this boundary.
- Previous `59b4b666` foundation `39646152390` passes. Native `39646152404`
  fails iOS's Files List lookup before the snapshot repair; Android's JUnit
  records `DeviceServerDiedException` during screenshot at 284.633 seconds,
  caused by ADB `device offline`, not a demonstrated product assertion failure.
  Exact failed-job log and Android artifacts are retained under
  `ci-59b4b666-failed.log` and `ci-59b4b666-android`. Historical receipts below
  retain their exact-source scope; they are not current-source acceptance.

Next: inspect exact-source workflow receipts and delivered images, resolve any actual failures,
then reconcile the final gates. No full visual/native acceptance is claimed.

### Historical state before the final material and snapshot repairs

Status: `implementation_resumed`. The maintainer authorized immediate reliable
acquisition repair and independent visual/functional work, not another pause.
Current pushed candidate is `59b4b666ad77ab536e43e3379d3b7af9f9ff00c4`, tree
`c1453a73adf440cb6aa23e08e8739e2d29af323d`, on existing `agent/m01` / draft #44.
Its foundation `39646152390`, desktop `39646152497` and mobile `39646152404`
are subscribed. Prior exact-source `6f840964` foundation `39634188618` and
desktop `39634188632` pass.
Native `39634188723` has completed: Android passes its 419.609-second consuming
flow; iOS compiles but fails the first Files `^List$` lookup after 1m51s.
Its artifact upload also fails `ENOTFOUND`, so no current iOS screenshot or
hierarchy was delivered. The earlier keyboard-owned hierarchy is evidence of
the earlier run only. Exact current failed-job logs are retained under
`.mlearn/visual-parity/ci-6f840964-ios`; unchanged CI was not retried.
The actual current
desktop receipt reports source progress 66.67% with valid ranges, and a 344px
header scroll content inside a 186.19px viewport, leaving 345.81px of the 560px
window for source content. Prior `e3d8293a` native `39626073010` passes Android's complete
401.552-second consuming flow. Exact source/tree, JUnit, Japanese ruby and the
final original-English continuity frame were inspected under
`.mlearn/visual-parity/ci-e3d8293a-android`.
Its iOS job fails during CocoaPods installation, before Xcode or
the app runs: `curl: (6) Could not resolve host: repo1.maven.org`, including
CocoaPods' two retries. The earlier verified dependency download succeeded;
this failure is the second download of that same pinned React Native archive.
Exact source and preparation logs are retained under
`.mlearn/visual-parity/ci-e3d8293a-ios`. This is neither an application compile
failure nor a successful recheck of the separate Files accessibility defect.
No active build was cancelled. The verified presentation increment was pushed
only after that native run completed; no unchanged failing workflow was retried.
One read-only code gate, `st_01a15f55`, approves only `48b27c9a..6f840964` on explicitly selected and
verified `chatgpt-subscription/gpt-6.1-sol`; no premium/model escalation was used.
Its verdict cannot close the pending consuming mobile or visual gates.

#### Current follow-up after the loaded-card audit

- `35717d9` fixes a reproduced language-package defect: Sudachi keiyoushi
  incorrectly admitted same-reading JMdict taru adjectives because both English
  POS labels contain "adjective". The failing unit regression admitted
  `jmdict:2571360` for いい. The corrected owner retains `jmdict:2820690`
  and auxiliary adjectives. All 14 guest tests and both actual Wasmi runtime
  tests pass after rebuilding the signed package as
  `0.1.3-sudachi20260116-jmdict20261017-pos1`.
- Normal app Settings installs all 256,972,969 declared bytes from the real signed
  local catalog. Playback options explicitly adopts the installed version for
  the saved source. The unchanged paused one-line cue now displays
  "good; excellent; fine" for いい. 銀河, source bytes, 25.182-second checkpoint,
  zero offset and the existing 度胸 Meaning claim remain intact. The separate
  ない ambiguity is authentic dictionary alternatives, not proven contextual
  ranking; no translation model or arbitrary ranking was added.
- The loaded wide audit disproved the prior two-column/row-first assumption.
  Approved card flow fills two rows per column, with 300px cards, 10px gaps and
  hover-revealed leading dismissal/backing. The shared `MediaOverlay` now owns
  that material/disclosure and synchronization chrome. Keyboard focus reveals it;
  touch retains dismissal. Narrow auxiliary cards scroll horizontally, and
  focusing a card scrolls its actual column into view without another lookup.
  Actual 1200x700 idle/focused and 420x560 second-card focus frames were inspected.
- Synchronization now uses the measured 24px numeric role, 30px reference filled
  arrows and 50px desktop bar; source clearance still consumes measured overlay
  height. Desktop card inset is 20px, top 48px; native touch sizes remain 44px.
- Shared Button projects selected/expanded/checked states through supported web
  ARIA aliases while retaining native state. The new selected-navigation browser
  test fails before the fix and passes after it. Normal WebKit exposes selected
  Settings navigation and the real Watch expanded state.
- Native-inclusive typecheck, ownership lint, web export and all eight browser
  tests pass for the final UI source. All 54 harness and 24 package/source
  regressions pass. Desktop consuming assertions now cover expanded state and
  narrow focused auxiliary-card visibility; the latter is not yet a CI pass.
  Current-source native builds and consuming UI remain required. No source
  restoration is claimed until the original test-video workflow is read back.

- `15ae24a` acquires the byte-identical WordNet 3.0 archive from verified NetBSD
  pkgsrc CDN/distribution mirrors before Princeton. Both observed downloads are
  11,537,239 bytes with the unchanged pinned SHA-256. Acquisition stages beside
  the cache, validates before atomic publication, preserves offline mode and
  bounds connection/transfer/process lifetimes. All four CI consumers retain
  preparation logs and enforce a 15-minute data-preparation step.
- The real offline conversion remains byte-identical:
  `c8d5f5a88dd39d4316af4e5e4c23a1be9b46c121292cfa874282327a2138e2d1`,
  206,978 lexical senses and 147,306 lemmas. Version, canonical Princeton
  attribution and license are unchanged. All 54 harness/acquisition and 24
  package/source regressions pass, including corrupt/truncated/oversized and
  failed-publication/deadline/offline cases.
- Fresh running v2/v3 Home comparison exposed a disappearing preview-progress
  outline. `2dffb05` introduces the shared accessible read-only Progress owner,
  uses the actual native source positions and package byte totals, and restores
  the reference's neutral outlined trough/equal title-track composition.
  Wide and minimum 420x560 Home captures were inspected; the real authenticated
  English update shows the new transfer track and completes with exact byte
  counts, removing pending controls. Unknown totals do not invent a percentage.
  Native-inclusive typecheck, ownership lint, web export and all seven browser
  interactions pass. The consuming desktop flow now checks real native ranges.
- Exact-source foundation `39619403964` passes all four jobs. Native run
  `39619404237` passes Android's complete 430.976-second flow. Actual source,
  JUnit, verified CDN/digest receipt, Japanese ruby and final English continuity
  captures are inspected under `.mlearn/visual-parity/ci-2dffb053-android`.
  iOS completes preparation/build but fails its 113.693-second flow finding
  `^List$` in Files. The actual screenshot shows List in the open menu while
  the hierarchy contains only Cancel and keyboard keys, not the menu or files.
  There is no tutorial in this frame. Exact failure/source evidence is retained
  under `ci-2dffb053-ios`; reproduction on the retained device is in progress
  before changing application code or the picker helper.
  The public UIKit probe identifies the actual `UIDocumentPickerViewController`.
  Its presentation-style getter remains form-sheet (`2`) both before and after
  setting full-screen on the next presentation. This did not establish a repair;
  no Expo dependency or product presentation change was made.
  The unchanged helper then passes the real CLI on the retained historical
  binary from both List and an explicitly selected Icons starting state.
  Actual Icons, subsequent List and successful media/subtitle dismissal images
  were inspected under `picker-cli-icons-ready-repro/2026-10-21_183447`.
  The original List preference is restored by the helper. An initial temporary
  setup failed on Home because it omitted the real entry readiness; only that
  diagnostic setup was corrected. Neither result certifies current native
  acceptance or establishes a fix for the hosted accessibility failure.
- Real desktop `39619403647` catches a genuine accessibility regression:
  native source progress is 66.67%, but the DOM reports neither ranges nor
  values. React Native Web does not project the compound `accessibilityValue`
  prop. The follow-up uses the direct ARIA aliases supported by both native
  View and RN Web; real macOS accessibility now reports distinct actual source
  percentages rather than a default 50%. The failing consuming assertion is
  preserved. Changed-source desktop `39626073084` passes.
- Enlarged compact Home exposed a fixed header consuming the source workspace.
  The shared shell now bounds compact header scrolling independently of content,
  keeps its viewport below desktop traffic lights and preserves stationary wide
  headers. Actual 420x560, 2x text testing reaches Get language packages by
  scrolling the header and opens the real package section. The consuming flow
  now protects the available source workspace and reachable action.
  Follow-up typecheck, ownership lint, syntax check, 54/24 owner tests, web
  export and seven browser interactions pass; shared shell diagnostics are clean.
  The exact original desktop theme is restored/read back at textScale 1.
- Native Inspector pan investigation has not reproduced an overflowing-body
  defect. The retained historical binary is diagnostic only. Its attempted
  large-theme input did not save: inspection exposed corrupted unsubmitted
  input, which was discarded. Reopening confirms the exact original Quartz
  document and textScale 1. OS text size is restored to `large`.
  No speculative responder change or current-source native pass is claimed.
- A bounded independent pixel audit identifies three further real differences:
  a continuous full-width live-card backing instead of individual two-column
  cards, muted Inspector-pill contour endpoints, and video-tinted noun metadata.
  `6f84096` bounds the real card flow, removes only the enclosing material,
  retains backed pending/failure states and a shared contrast-safe floating
  dismissal, and introduces measured pill-only colors plus neutral POS material.
  It also restores the approved black Watch top rail after directly reproducing
  unreadable source identity over a white video bar, and removes the redundant
  nested synchronization-number backing. Wide/narrow real cards, synchronization,
  dismissal and Inspector were inspected. Native-inclusive typecheck, lint,
  54/24 tests, web export and seven browser interactions pass. The new consuming
  title-contrast assertion rejects transparent backing and now passes the actual
  exact-source Tauri flow `39634188632`. Its source/tree receipt, real progress
  ranges, compact scrolling, narrow cards and pronunciation/POS Inspector
  captures were inspected under `ci-6f840964-desktop`. The consuming mobile
  gate remains pending. LSP freshness timed out on some
  final shared files; no clean diagnostics are claimed for those timeouts.
- Secondary v2 Home uses Electron under-window vibrancy with a translucent
  page. The resolved Tauri 2.12.3 / Wry 0.57.0 transparency path invokes the
  private WebKit `drawsBackground` key even through the public Tauri effects
  API. No such adaptation was introduced. Controlled matching-backdrop
  comparisons and any remaining material limitation must be explicit; a
  static sampled color cannot certify live backdrop parity.

### Prior verification chronology

Application candidate: `c071d5c08dedee6705874ea79f11e618ded6b136`, tree
`794ac5cc70aa213c054643d3b2aa15fd00920142`, pushed to the existing draft.
Status is `paused_incomplete` at an upstream preparation timeout: desktop clearance, native dialog
scrolling and both-platform ruby alignment are verified. Current harness
`ac6b9e6f9362375d33846b42c00c6a21e25154a6` is pushed; native run
`39591442550` completes with Android passing its full 375.44-second flow;
exact source/tree, JUnit and final English continuity frame were inspected.
The preceding Android transport failure is rechecked successfully.
Exact-source foundation `39591442540` also passes. iOS fails at List selection:
the actual image shows its first-use typing tutorial over the Files menu,
and the hierarchy exposes `UIContinuousPathIntroductionView` instead of List.
The same system tutorial is reproduced through Files Search on the retained
local diagnostic device. The final iOS cross-source return remains pending.
Continue alone dismisses that tutorial but leaves Files controls absent from
the actual local hierarchy; that attempted helper change was removed.
Setup-only `a791e0c4d11cd411ce49e656645ea08a023e21e4` initializes the observed
keyboard-onboarding preference on the generated CI simulator before its first
keyboard use. YAML parsing, four mobile configuration checks and whitespace
checks pass. Native consuming run `39600078919` completed; no app source,
product assertions or timeouts changed in that candidate. The diagnostic device's original
onboarding value is restored and read back as true.

The maintainer's stalled-run investigation established actual progress, not an
overnight deadlock: the run began October 21 at 12:30 UTC, finished its iOS build
at 13:09:43 and completed the UI step at 13:19:32. Android's complete flow passes
in 369.431 seconds, with exact source/tree and JUnit retained under
`.mlearn/visual-parity/ci-a791e0c4-android`. iOS's 130.361-second flow fails the
original 60-second Watch readiness assertion; its Files list stays open.
The actual trace selects List successfully, then taps the English row center
at (196,359), outside its short filename bounds (100,339)-(185,360).
The new narrow diagnostic repair targets the exact filename child in List mode,
requires picker dismissal within ten seconds and captures before/after selection
for both media and subtitles. Helper-only `48b27c9a` is pushed. Its local English
MP4/SRT and real-annotation flow passes, as do YAML parsing, all four mobile
configuration tests and whitespace checks.
The single changed-source native run `39607879380` and foundation
`39607879436` fail before build/UI in `tools/prepare-wordnet.py:14`:
Princeton's pinned WordNet archive connection times out (iOS Errno 60;
Linux Errno 110). The exact URL is
`https://wordnetcode.princeton.edu/3.0/WordNet-3.0.tar.gz`, expected SHA-256
`640db279c949a88f61f851dd54ebbb22d003f8b90b85267042ef85a3781d3a52`.
Current-source iOS acceptance is therefore unverified, not a Files pass.
Exact source/tree and failure evidence are retained under
`.mlearn/visual-parity/ci-48b27c9a-ios`; successful earlier Android results remain
preserved. No unchanged test or broader implementation campaign was relaunched.

The native Files failure was reproduced locally with Maestro 2.11.0 and the
retained historical binary on owned device
`6790712D-7A1A-4BFC-A084-45B427A2652A`, not H00. Exact filename/grid taps
left the movie picker open; animation completion did not repair hosted run
`39581891266`. Switching the real Files menu to List and tapping the same exact
file row succeeds. The actual edited `open-ios.yaml` then opened both Japanese
and English media/subtitle pairs; English annotations also became usable.
Evidence: `.mlearn/visual-parity/local-picker-{list-selection,japanese-pair,english-pair}-success.png`.
These local boundary diagnostics do not certify the current application binary.
The same prior hosted run's Android failure was Maestro
`DeviceServerDiedException` caused by ADB `device offline`, with transport
termination in the retained host log, not an application assertion.

Shared captions/transcript now consume real package readings and contours.
Inspector shows authentic pronunciation alternatives, attributed JLPT metadata
and one native aggregate Knowledge pill with attached granular corrections.
Live cards use bounded real dictionary batches and package-declared eligibility;
native previous/next alignment, manual offset and reset persist independently of
original subtitle bytes. Japanese ruby bases remove duplicated inline reading
markers through the package's actual preprocessed surface, never frontend
language rules or lemma substitution. Source bytes, inflection and UTF-8 offsets
remain authoritative.

Matched real-app comparisons include the original courage source, a separately
imported one-line reference composition, multiple Japanese pronunciations,
the minimum 420x560 window, supported 2x text and reachable correction controls.
The original source retains its authored line breaks. The comparison fixture uses
a distinct losslessly repacked media identity, not staged DOM or altered UI.
The exact original Dark Quartz document was restored/read back at scale 1;
the original media path, subtitle association, 18.805-second checkpoint and zero
offset were restored through native actions. Existing claims were not changed.

All relevant root Rust owner suites, 13 Japanese library tests, 40 harness and
24 package/source tests, typecheck, ownership lint, generated contracts, web
export and seven browser interactions pass. The normal app authenticates the
current Japanese guest `8cef5d7b6e8d041ddb7d64855b29d9e44bbf2202a678bdbcb0ff0012bc3ab923`.
Measured development SHA-256 specialization reduced the same authenticated
package update from 21,409 to 2,119 ms without relaxing verification. Moving JSON
trees and bounded per-call resource reuse repaired the actual six-cue transcript
fuel failure: the final enriched source uses 63,269,037 of the unchanged 64M fuel
allowance, and its consuming transcript renders in 96 ms. Fresh-process,
warm-filesystem Resume measured 545 ms; warm reopen and package-switch evidence
remain in the execution record. These are observed cases, not cold-cache claims.

Application-source foundation `39543218137` and real desktop `39543218151`
pass, including the actual Japanese metadata, enlarged ruby and source-overlay
assertions. Artifact inspection then exposed missing CJK glyph fonts in the Linux
runner; those tofu captures are not visual acceptance. Verification-only source
`6157c330` adds the system font prerequisite and coverage check. Real desktop
`39544257847` passes; its font receipt and actual readable Japanese metadata and
enlarged source-overlay captures were inspected. macOS glyphs were inspected directly.
Native `39543218156` completed: Android passes its full real English/Japanese
flow (423.417 seconds), while iOS repeats the clipped rate-button failure below.
Android's source receipt, JUnit and actual metadata, cards, pronunciation details,
source continuity and synchronization captures were inspected.

That successful flow still exposed a native visual defect: plain words and
punctuation aligned with ruby readings rather than source bases in both captions
and transcript. `c9960d14` aligns native source-box bottoms and the shared control's
content bottom while preserving 44px touch targets. Native shared controls now
join the app typecheck so they use its real theme registration instead of an
untyped inferred project; the compiler and fresh native-control diagnostics pass.
Typecheck, ownership lint, 40/24 owner tests, web export and seven browser
interactions were rerun successfully. Android run `39549617162` now passes;
its exact c996 source/tree receipt and actual enlarged caption and transcript
captures were inspected. Plain words and punctuation now align with ruby source
bases in both consumers. iOS in the same run repeats the known rate-1 failure
before reaching Japanese; its baseline after-evidence remains pending.

Rate-input run `39544717796` (`230d30be`) completed: Android passes, iOS still
fails the rate-1 assertion. Its exact trace shows five centered DOWN swipes with
unchanged target bounds behind the fixed header, followed by the same clipped tap.
Centering alone is not a verified repair. A fresh owned iPhone 15 Pro simulator
(`DCF92FD4-C843-441D-86CD-76D3AB2D25DF`, iOS 27) reuses the retained historical
binary to diagnose the unchanged Dialog scroll boundary without another build
or profile copy. This older binary/runtime is not current-source acceptance.
At a supported enlarged OS text size, ordinary and element-relative swipes both
leave its overflowing dialog body and scrollbar unchanged. The same `Dialog`
owner is unchanged from that binary; installed primitive 1.5.2 explicitly claims
the initial responder above its ScrollView. `c071d5c0` overrides that claim on
native only. This source correction still needs real native after-evidence;
no gesture assertion or timeout was relaxed. Native-inclusive typecheck, lint,
43/24 tests, web export and all seven browser interactions pass after the change.
Current foundation `39555587192` passes. Desktop `39555587195` fails its loaded
Inspector whole-cue clearance assertion at `native-smoke.mjs:524`; its actual
failed frame visibly overlaps the preceding subtitle line. This is not the
earlier stale-handle failure, and the passing 2fda run does not waive it.
The exact source/tree receipt, failure image and media state are retained in
`.mlearn/visual-parity/ci-c071d5c0-desktop`. Harness-only `7a7c234` adds actual
viewport, cue, token, scroll and panel geometry to failure evidence without
changing input or assertions; syntax and all three driver regressions pass.
Its foundation `39558703352` and desktop `39558703481` pass on unchanged app
source. Exact receipts and actual readable Japanese/narrow captures were
inspected. That green rerun does not erase the earlier failure.
The seek readiness condition accepted `home` from either authored cue even though
the media clock updates before React publishes the new caption. Harness-only
`af4ecd42` requires `came` and `home` in the same actual second-line cue before
activation; all loaded-panel clearance, resize and narrow assertions remain.
Foundation `39559794944` and desktop `39559794929` pass. Their exact source/tree
receipt and real publication/clearance evidence confirm the diagnosis:
immediately after seeking, the clock is 20 seconds but the cue is still
`Children walked home.` and the intended cue is not ready. After waiting for
the actual `Children came\nhome.` caption, the loaded panel bottom is 444 and
the entire cue top is 456, leaving 12px clear. The explicit enlarged second-line
frame was inspected; resize and minimum-window assertions also pass.
Evidence is retained in `.mlearn/visual-parity/ci-af4ecd42-desktop`.
No application placement change or relaxed assertion was needed for this race.
Native `39555587383` remains subscribed; no duplicate mobile run was started.
Its Android job `119081417327` passes the full real English/Japanese flow
(368.847 seconds). Exact c071/tree794a provenance, JUnit and current persisted
rate/offset, aligned caption/transcript and actual pronunciation/level Inspector
frames were inspected in `.mlearn/visual-parity/ci-c071d5c0-android`.
iOS job `119081416935` completed with a later Home-selection failure, not the
old rate failure. Its trace confirms actual rate-button movement from y=65 to
y=182 after the native responder fix, a safe tap at y=204 and the unchanged
saved-1x assertion passing. The full preferences/restart/reset flow passes.
Current iOS caption, transcript and Inspector captures were inspected: ruby
source bases, plain words and punctuation align, with real alternatives and N5.
These close the native scroll, rate-input and mixed-ruby repairs.
The final return to the original English source fails because its second recent
row is below the enlarged iOS Home viewport. The actual failure frame shows
the latest Japanese source and its Resume action; selecting that instead would
test the wrong source. The Japanese flow now scrolls to the original source's
own Resume action before tapping, keeping all continuity/claim assertions.
Exact iOS trace, provenance and images are retained in
`.mlearn/visual-parity/ci-c071d5c0-ios`. No application/data change is needed for
this test navigation correction. The overall native run remains failed until
the corrected complete flow passes.
The correction is committed/pushed as harness-only `50a146df`; YAML parsing,
all four mobile configuration tests and whitespace checks pass. Its native
`39562873224` and foundation `39562873286` runs are subscribed. Application
inputs remain c071; desktop af4 evidence remains applicable.
The new Android job `119098032153` passes (404.086-second full flow); exact
50a/tree5ca5 provenance, JUnit and the final original-English continuity frame
were inspected in `.mlearn/visual-parity/ci-50a146df-android`.
iOS job `119098031891` was cancelled by the outer 75-minute job limit, not a
failed product assertion. GitHub's check annotation states that maximum explicitly.
Preparation reached the UI step after 58 minutes; Maestro's retained trace still
passes English source/claim/restart checks and begins Japanese when cancellation
lands. The exact interrupted evidence remains in
`.mlearn/visual-parity/ci-50a146df-ios`. The outer iOS job budget is now 90 minutes
to reserve its unchanged 20-minute UI step and evidence upload after the measured
cold build. No assertion, gesture timeout or product behavior is relaxed.
That workflow-only correction is committed/pushed as `477a39d3`; YAML parsing
confirms 90/20-minute job/UI bounds and all four mobile configuration tests pass.
Native `39572849831` is subscribed durably. Previous completed Android evidence
is retained; the full iOS return-to-original-source gate remains open.
That reserved-budget run completed: Android passes; iOS reaches an actual
assertion failure rather than the outer deadline. The failed frame remains in
the native Files picker after the Japanese MP4 tap (`step-225`), not a failed
Rust import or subtitle analysis. Its trace navigates through the app container
and fixture folder, exposes the destination cell and dispatches the tap while
that native navigation can still be settling. `open-ios.yaml` now waits for
native animation completion before each media/subtitle selection; exact file
targets and the original 60-second app-ready assertion remain unchanged.
This picker correction still requires real consuming proof. Exact JUnit,
trace and failed frame are retained in `.mlearn/visual-parity/ci-477a39d3-ios`.
The picker-only correction is committed/pushed as `5606de36`; YAML parsing,
four mobile configuration tests and whitespace pass. Native `39581891266` and
foundation `39581891140` are subscribed durably. App inputs remain c071, so
the existing native visual and desktop evidence remains applicable.
The 5606 foundation passes. Android job `119161235933` then failed because
Maestro lost its emulator connection: JUnit reports `DeviceServerDiedException`
with `device offline`, and the host ADB trace records transport read failure and
unregistration. This is retained in `.mlearn/visual-parity/ci-5606de36-android`;
it is not relabeled as a product assertion failure or erased by older passes.
The only source delta is the iOS picker helper. No Android/application change
or retry wrapper was made for this transport loss. iOS job `119161236102`
remains active under the same durable subscription; after it finishes, recheck
only the failed Android platform rather than duplicating the active build.
An expired watcher was renewed for the same run; it was not treated as a build
failure or a reason to duplicate/cancel the native build.
The diagnostic driver was stopped and its owned simulator shut down, retaining
only its small fresh sandbox for follow-up; H00 remains untouched.
After its current-source diagnosis was verified, only the owned diagnostic
simulator `DCF92FD4-C843-441D-86CD-76D3AB2D25DF` was deleted and read back absent.
H00 remains booted and untouched. The normal app and owned temporary run root
remain available until final verification/cleanup; useful builds and evidence
are preserved.
Current-source foundation `39549617192` passes. Desktop `39549617175` failed
at its second-line word click: WebDriver rejected a detached DOM handle before
dispatch (`native-smoke.mjs:555`); the real failed frame and logs are retained.
Harness-only `2fda1762` reacquires only a protocol-declared stale element inside
the existing 15-second readiness deadline. It preserves real WebDriver clicks
and propagates intercepted/other failures. The deterministic replacement test
failed on the original one-shot behavior; all three driver cases now pass,
including no replay after interception or expiry. The complete 43/24 tests and
Node syntax checks pass. Foundation `39551043267` and real desktop `39551043215`
pass. Exact source/tree receipts, completed native flow and readable metadata,
enlarged source and overlay captures were inspected; the driver repair is verified.
No app/mobile input changed in that increment.
No active hosted build was canceled. Current native visual gates remain open.

The retained original iOS job `119023396747` shows a rate-button tap at y=87 while
the dialog body starts at y=142: accessibility reported a clipped button as visible
behind the fixed header. The preference flow now centers both rate targets before
input, like its existing Reset guard; saved-rate assertions are unchanged.
The latest failure above proves that gesture change is insufficient.
Native gates remain open until the corrected flow and actual captures pass.
Prior desktop failures exposed and repaired
test-side WAL lock acquisition, a stale theme-label query and a reused pre-restart
WebDriver session URL. Android's new Japanese fixture was a byte-identical renamed
English video, so native identity correctly reused its source/checkpoint.
The fixture producer now emits distinct media bytes and verifies their SHA-256
identities; all three consuming harnesses use that output. No domain identity,
native assertion or test timeout was weakened. Retained platform evidence is local
under `.mlearn/visual-parity/`.

M03 capture/Anki, M07 Explain and absent Reader/Messenger/Review backends remain
outside this authorization. The independently reproduced preparation-script
`KeyError: 'definition'` remains a baseline finding, not a passing check.

### Historical runtime-boundary audit - 2026-10-21

The maintainer clarified that v2 is a reference/data source, never a runtime
dependency. The audit found one leak in the resumed Japanese guest: initialization
embedded `enrichment-pin.json` and checked the source-import manifest. That
dependency is removed. The guest now validates only the package-owned
`org.mlearn.japanese.lexicon` version 3 and
`org.mlearn.japanese.linguistic` version 1 formats. Legacy source fields are
converted by explicit tooling into canonical accent-drop/POS/level records;
they are not interpreted by Rust core or React.

`tools/prepare-japanese-enrichment.py` alone understands the reference-bank
layout. Normal builds consume its frozen snapshot offline. Source pins,
licensing and attribution remain provenance, not compatibility switches.
Generic runtime/frontend inspection found no v2 paths or Japanese taxonomy;
the shared logo's reference comment describes an embedded asset, not a dependency.
Existing ABI-v1 compatibility is for installed **v3** packages, not a v2 adapter.
Bounded UI projections do not replace private linguistic data. Package resource
codecs retain opaque versioned fields, open tags and pronunciation alternatives.

The new canonical-only metadata regression failed before the fix and now passes.
All 12 Japanese package-owner tests, two generic linguistic-admission tests,
the real Japanese Wasm metadata/claim/restart flow, retained ABI-v1 offline flow
and six Watch persistence/recovery tests pass. The exact source snapshot
reproduces byte-for-byte: 124,137 source rows, 124,134 pitch pairs and 8,127 level
rows. Every one of the 124,462 resulting canonical pairs was compared against
that authenticated snapshot, including every accent/POS variant and level.
The 131,850,240-byte index remains below the unchanged 128 MiB resource limit.
The preparation script's previously reproduced final `KeyError: 'definition'`
remains an explicit baseline finding; its canonical conversion assertions pass.

Shared ruby/metadata, live-card, aggregate Knowledge and synchronization
presentation changes are being integrated. Typecheck and ownership lint pass,
but no new visual or consuming-mobile acceptance is claimed. Resume matched
real-app verification after this boundary repair; M03/M07 remain excluded.

### Historical native projection and synchronization checkpoint

Native-only increment: `verified_for_continuation`, not a visually complete
application or maintainer acceptance. Rust now admits bounded package-owned
readings, labels and normalized pronunciation contours; native inspection returns
current granular Knowledge plus a distinct aggregate claim. A source/revision/
artifact-bound dictionary batch admits at most six distinct targets. Previous/
next subtitle alignment uses indexed real cue starts, validates before saving,
and preserves offset/checkpoint identity across restart. Shared generated types,
transport guards and the existing Inspector entry consumer are migrated together.
Its persisted monotonic synchronization revision rejects a repeated relative
intent, including after an offset changes away and back or the app restarts.

The actual legacy-package regressions pass: 18 runtime-owner tests, the retained
ABI-v1 offline test and six real Watch persistence tests. The new alignment test
first failed with `Not a Watch action`; its corrected flow passes. The held
inspection/claim regression initially exposed its fixture's unsupported request
branch, not a product race; the exact event gate now covers inspection without
changing its assertions or timeouts. Linguistic admission tests, `npm test`,
typecheck, ownership lint, generated-contract checks and whitespace checks pass.
The three storage-owner tests and the existing seven browser interactions also
pass. No new desktop/mobile consuming or visual pass is claimed for this increment.

The authentic enriched Japanese package now passes its real consuming-runtime
flow and the boundary audit above. Rendered desktop/mobile verification remains
open. M03 capture/Anki and M07 Explain remain excluded.

### Prior verified application

Prior application source `1a9a24c70f66bba0d4362120196a34836e4edc7a`, tree
`3069cd5547ceb35ffc4ae6c7c98134c75d2daee1`, is pushed to the existing draft.
Exact-source foundation `39481892368`, real desktop `39481892120` and native
`39481892339` all pass. Native reports bind that same source/tree: Android's
complete emulator flow passes in 251.835 seconds; iOS simulator 26.5 passes
in 339.883 seconds. Its build log also confirms actual ExpoVideo source-target
compilation, not the rejected prebuilt-binary inference. Current artifacts,
JUnit, source receipts and normal local iOS 27 captures are retained under
`.mlearn/visual-parity/`; local iOS flows pass in 188.618 and 187.988 seconds.
Normal `npm ci`, 40 harness and 19 package tests, typecheck, ownership lint and
contracts pass. Web presentation inputs remain unchanged from the recorded
web export and seven passing interactions.

These checks bind the preceding application source, not the resumed changes.
Full visual parity remains **incomplete**. The earlier diagnosis that an external
reference-state package had to be supplied is withdrawn: authentic pitch banks,
reading/level data, live-word dictionary behavior and cue-alignment algorithms
already exist in the approved reference checkout. Missing v3 projections and
controls are implementation work, not evidence of unavailable external input.

The maintainer explicitly resumed authentic ruby/readings, pitch accent,
JLPT/linguistic metadata, dictionary-driven live-word cards, subtitle sync
controls and truthful aggregate Knowledge presentation through the existing
Rust/package/UI boundaries. Preserve stable source/target identities and
granular Knowledge semantics. No additional external package is expected.
M03 capture/Anki and M07 Explain remain separate, unauthorized milestones;
their missing operations must not be represented as functional success.
Current execution/evidence is recorded in
`/var/folders/f2/d3_jzj917kg6sqsc9tgc80200000gn/T/ulw-20261020-resume.XXXXXX.md.gDU0LQvD5f`.

Previous owned-device cleanup preserved the complete native profile under
`.mlearn/visual-parity/retained-20261020/native-picker-profile` before deleting
only simulator `BD432C33-7ECC-4EB3-9FF9-03F97E30F4B1`. Ten final diagnostic
scripts were removed; canonical tests, logs, captures and useful build/profile
outputs remain. Those cleanup receipts describe that completed run; resumed
resources require their own ownership and teardown receipts. Continue the
reference-derived implementation and real-app comparisons, without treating
the former package question or green tests as visual acceptance. No maintainer
acceptance, merge or release is claimed.

### Historical verification detail before the final candidate

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
