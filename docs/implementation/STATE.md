# Current implementation checkpoint

## Active continuation — M10 then M11, 2026-10-27

The maintainer authorizes M10–M11 while comprehensive M03–M07 review is
unavailable. M03–M07 remain provisional and unaccepted. Their source/evidence,
visual discrepancies, iOS gaps, unexplained Windows input loss and unidentified
historical cleanup roots below are preserved, not converted into passing gates.
PR44 remains OPEN/draft at `2a1f13a53b6cc4852e6b4fea24881d05d31f8af9`,
unmerged and unreleased; its tested product source remains `3ffc28fb`.

The new branch is `agent/m10-m11`, created from that exact committed foundation.
Its separate stacked draft is PR45, based on `agent/m01`; authorization source
is `f9378744`. M10 is in progress, not implemented or verified as a milestone.
M11 must wait for M10 engineering
and independent-review gates. The scope is PLAN M10/M11 and feature IDs
SRC-10, KNW-04/06/07, INS-05, MAT-05/06/07, NAV-02 and
LRN-12/13/14/15/18, reusing existing native/package/session owners.

Initial resource readback: OmO PID82251 footprint3753899088 bytes,
available6249381888, pressure1, swapUsed3135242240, swapOut45443366912;
disk available27981336 KiB. No surviving app, QEMU, Simulator.app or Electron
was listed. No model/device/reference/server was restarted. Substantial local
work stays serial and requires fresh disk/physical-footprint/pressure/swap
admission. The four original untracked reports/Watch fixtures remain untouched.

Current task: finish Material presentation and NAV-02 workspace/source departure
and cancellation ownership.
October 30 Messenger Back candidate: the new real-Rust recovery case reproduced
Back reaching Home without issuing save_draft, removing the unsent draft/retry
owner (`messenger-back-red.log`, actual Home capture inspected). Removal now
uses existing messenger.act/persistDraft and its exact-command recovery. Active
conversation failures appear beside the composer, including narrow layout.
Replay checks current conversation identity and route focus. Home uses this
same guard; no draft, persistence or history authority was added.

Export `824a878a1952b3ded4107770eb373977` passes typecheck, architecture lint
and the focused case (`messenger-back-green.log`, 3.6s). It holds a real committed
draft receipt, retains Messenger/URL/text while pending, loses that receipt,
retains explicit Retry, retries the identical command, then returns Home,
preserves the Material query and restores the unsent draft after native process
crash/restart, with zero provider calls. Root inspected pending/failed/restored
390px captures. Source LSP is clean; test LSP timed out.
Adjacent Messenger regressions, desktop-state inspection, independent review
and push remain pending; this is not NAV-02/M10 or OS-native acceptance.

The launch incorrectly continued despite1153644KiB disk because the environment
prefix broke the intended shell AND chain. This is a root orchestration error,
not a waived disk gate. Grouping the prefix and gate in one child shell was
verified without a workload:1089548KiB emitted DISK_ADMISSION_HELD and exited75.
Use that grouped form for future work; memory reserve stayed4GiB in the run.
Owned QA processes are absent. Preserve this candidate/evidence while adjacent
execution waits for capacity; do not delete profiles or infer approval from
the passing single case.

October 30 Watch Back checkpoint repair: extending the existing decoded-video/
real-Rust transcript case to browser Back reproduced Home becoming visible
without any save_position attempt (`watch-back-red.log`, actual Home capture).
The original Home scenario and its timing/rate/offset/restart assertions remain.
Back now enters Watch from retained Home via normal Material/Home/Continue UI
and verifies that the unsubmitted Material query survives departure.

Watch now guards removal through its existing pauseAndSave operation. It
serializes departures, rejects overlapping busy work, checks focus/source
ownership before replaying the blocked action and cancels the source session
only after the checkpoint succeeds. Failed persistence retains the same player
and explicit Retry instead of cancelling/reloading away its unsaved position.
Home and Reselect share this guard. No player, native persistence or history
authority changed. The first five-case pass exposed a duplicate generic source
error in captures; checkpoint failures now remain solely with saveError, while
post-checkpoint cancellation failures retain generic source recovery. The
existing browser case asserts that checkpoint failure does not offer Retry source.

Initial Watch checkpoint export `806381c0831c415fe0e32d3946a4bfa9` passes typecheck, architecture
lint and all 114 affected browser scenarios in one serial run
(`/tmp/mlearn-ci-independent.6EaZ3F/watch-back-final.log` and
`watch-back-final-results/`). Root inspected final Back failed/held 390px
captures and the 1100px restored transcript state. Original Home, failed receipt,
exact Retry, actual decoded playback pausing while a checkpoint is held,
post-departure Space suppression, native crash/restart position/rate/offset,
saved-Material returns and proposal source return pass. This is shared browser
media plus real Rust persistence, not native OS player/gesture certification.
At that checkpoint source/test LSP requests timed out after the error-channel edit;
earlier clean diagnostics are not reused as final evidence. Exact-source
review `st_01a18c9c` REQUESTS_CHANGES on `c368f450`: the guard can discard a
video-drop replacement while busy. Report:
`.omo/evidence/watch-back-c368f450-gate-review.md`. A host-drop regression is
added to verify the replacement route/player. Broader NAV-02/M10/native/maintainer
gates stay open.

The new real host-drop case passed against the original web checkpoint
(`watch-drop-red.log`, despite its historical filename); the conditional busy
race was not reproduced there. Handoff is now explicit after busy clears:
a source/focus-owned pending replacement dispatches from an effect, and the
redundant success reload is removed because the new route initializes its source.
The guard is not bypassed. The test invokes the actual Tauri drop callback,
opens a distinct authored source through Rust, serves its actual media bytes,
checks route/title/media URI and waits for real decoding. It retains the original
checkpoint, draft, playback/rate/offset and restart assertions.
Export `ec0e539ea25562acc17e1d7ac4a1ceca` passes typecheck, architecture lint and
all five affected Watch cases (`watch-drop-green.log`, 30.6s); source/test have
fresh clean LSP diagnostics. Root inspected the replacement player and failed/
held recovery PNGs in `watch-drop-green-results/`. The earlier 114-case run stays
bound to the earlier source; it was not rerun for this local handoff delta.
The same reviewer `st_01a18c9c` APPROVEs exact clean
`b9f7392ec147461ae7d057bb2e34cceb1e9ffae0`, with no blocker. The reviewer
confirmed post-busy, single-consumption, source/focus-owned replacement without
guard bypass or old-source reload, and inspected the five-case log/replacement
capture. No execution/writes; fresh LSP is supplied evidence, not independently
inspected. The original conditional concern was not reproduced on web.
Final resolution is appended to the original review report; native OS and
broader NAV-02/M10/M11/maintainer gates remain open.
Latest footprint3256989136, RSS6201737216, available7191298048,
pressure1, swap4165074944 bytes; original 4 GiB reserve held.
Final guard footprint3212391888, RSS6569213952, available7592034304,
pressure1, swap4404805632 bytes; original 4 GiB reserve held.
Owned QA processes are absent. Disk has1526572 KiB available after this run;
admit no further substantial local work until capacity is restored.
Disk later recovered to about2.5GiB. Measuring existing QA profiles found a
30172KiB maximum; only the focused reproduction/five-case delta and web export
were admitted above a 2GiB disk gate, without a native rebuild. Disk is now
1641060KiB; broader local work remains held. Profiles/evidence are preserved.

October 30 Reader Back checkpoint repair: the real-Rust browser harness reproduced
Back reaching Home after a failed appearance checkpoint, losing the visible Retry
owner. Reader now routes removal through its existing `persist()` operation,
retains the workspace on failure, rejects duplicate departures while saving and
replays the original action only for the current source after persistence succeeds.
Home and Reselect use the same guard. No checkpoint/session/store authority changed.

The guard alone still failed. Installed-router probes established that Back reset
Expo's outer `__root` stack, whose direct routes did not change; replacing its
nested state bypassed Reader's beforeRemove listener. The pinned Expo57.0.25 patch
now reuses its existing `findMatchingState` helper to reset the changed navigator.
The existing browser-cursor rollback remains. Exact prior managed output upgrades
to the new output; original hashes, version/drift/partial-patch rejection remain.
All temporary app/dependency probes were removed. Failed owner-only, focus and
router probes remain in `reader-back-{red,green,probe,focus,context,activation,dispatch,target}.log`
under `/tmp/mlearn-ci-independent.6EaZ3F`, not passing evidence.

Export `f472384e4e607db2f35c7f7585711b70` passes typecheck, architecture lint,
89 tooling tests and 202 client/owner tests (`reader-back-final.log`).
That first wider browser run had 108 passes and one test timeout: changing
viewport during retry triggered a normal layout checkpoint, detached Retry and
intercepted its click. No assertion was relaxed; separate fixed-width flows and
guaranteed backend cleanup repair the test. The complete affected browser run
then passed all 110 cases once (`reader-back-fixed-width.log`,
`reader-back-fixed-width-results/`). Both 390/1080 flows retain Reader and its URL after failed
Back, retry the native checkpoint, return Home, preserve the unsubmitted Material
query and verify the changed appearance after native process crash/restart.
Root inspected all four failure/restored-draft PNGs. Reader source and new test
have fresh clean LSP diagnostics; scratch/earlier timeout reports are not passes.
This is browser UI plus real Rust persistence, not native OS gesture verification.
Checkpoint `c78ef60b4a0620356f920c29f401070f9e0df75d` received APPROVE from
sole exact-source reviewer `st_01a18c8a` (subscription GPT6.1Sol), with no scoped
blocker. The reviewer inspected all five changed files, relevant owners, logs
and two captures; no workloads or writes. Report:
`.omo/evidence/reader-back-c78ef60b-gate-review.md`. Separate code-review skill
coverage was not supplied. NAV-02/M10 and native/maintainer gates are not closed.

The final run's footprint was 3201283536 bytes, RSS6235045888,
available7776780288, pressure1, swap4178051072; original 4 GiB reserve held.
Earlier OmO footprint growth to about7.2GB was investigated with bounded vmmap
(6.0GiB current, 14.4GiB historical peak), without assigning a cause; later
admission samples returned near3.2GB and were stable. No devices, native rebuild,
model run or heap dump. Owned QA browser/runtime/4173 processes are absent.
Disk now has 4272220 KiB available; reserve capacity before substantial new work.

October 30 Review Back departure repair: browser Back removed ready audio before
its interruption could save, unlike the existing Home path. The complete Home
fixture reproduces this (`review-back-fixture.log`, missing Saving Review and
Home already visible). The first red run also had missing drag-unlisten and
recent-document fixture handlers; those were supplied before isolating the same
product failure. Review now uses the installed router's usePreventRemove hook
and reuses its existing departure/save/retry owner for route removal, including
Home. It replays the original blocked action only after interruption is durable.
No session/evidence authority or saved navigation store was added.

The first owner repair retained Review but exposed an actual web history split:
URL Home while Review/retry remained visible. Expo57.0.25's web linking fork
does not restore a rejected reset. Its memory-history listener also leaves the
internal cursor stale on external Back, making the restoring go(1) a no-op;
a direct deterministic owner test reproduced '/' instead of '/review' before
the one-line cursor update. The managed postinstall patch is version/hash-pinned
to `build/fork/useLinking.js` and `build/fork/createMemoryHistory.js`. It tracks
the committed index, flushes the external browser reset before distinguishing
accepted from blocked navigation, and restores the existing history cursor on
rejection. No renderer history handler, duplicate stack or new dependency.
Fresh upstream strings produce exactly the installed patched artifacts; repeat
application and altered-version/source rejection pass. Remove the patch only
after upstream owns the repair and the held/failed Back workflow still passes.

Failed attempts remain under task-root `review-back-{red,fixture,green,history,
history-final,fork,probe,cursor,memory}.log` and results. The wrong bundled React
Navigation target was restored before targeting Expo's actual fork. The first
pin check stopped before build because root's edit added an EOF newline; the
original hash remains enforced, with only the exact managed output accepted.
Temporary route/index probes were removed. No URL, retry or prior Home assertion
was weakened; the final regression covers both ready and genuinely playing audio.
It holds then fails interruption, keeps Review and its URL, retries the identical
command, and permits Back with the same encounter/completed count and no Submit.
Existing playback tests now subscribe to the exact fixture commit signal before
Play instead of polling.

Final export `aa9fa4f39f97878d98e5bf467e682039` passes normal typecheck and
architecture lint,89 tooling and202 package/client tests, then63 affected
Foundation/Review/Material/Messenger/Reader/Watch browser cases in1.5m
(`review-back-integrated.log`/results). Pending/failure captures for ready/light
and playing/dark at1080/390 were inspected: stopped player, disabled departure
while saving and a contained actionable Review retry. This is actual browser UI
with mocked Review IPC, not native audio/OS gesture or new Rust persistence proof.
Native gesture, whole NAV-02/M10, visual and independent-review gates stay open.
Fresh test/scratch JS LSP requests timed out; package JSON LSP lacks Biome.
No tool was installed: actual execution, owner tests and normal typecheck pass.
Post-run preview4173 and QA owners were absent. Final guard sample:
footprint3134174672, available7245856768, pressure1, swap4599644160 bytes,
unchanged4GiB reserve. No device, reference app or CI campaign was restarted.
Sole exact-source reviewer `st_01a18c62` APPROVEs checkpoint `b15784d7` with no
scoped blocker; report `.omo/evidence/review-back-b15784d7-gate-review.md`.
The review inspected source/historical logs and two captures, ran no workloads,
and does not independently certify native gestures, persistence or M10.
Its nonblocking test-deadline note is repaired with an explicit5000ms Node test
timeout; both focused router tests pass afterward. Product source/export is
unchanged by that test-only follow-up.

October 30 shared collection disclosure: the full-width quiet action bar is
replaced by an intrinsic, right-aligned shared Button with existing navigation
material and chevron glyphs. CollectionFilters still owns expansion and the
native-backed draft editor; neither screen duplicates the control. Existing
expanded accessibility semantics, full-width nested editor, Apply/Clear and
compact header scroll ownership remain intact. No shared Button palette or
global shell geometry changed. Product diagnostics, normal typecheck,
architecture lint, draft guard and single-worker export
`72bfc36ad49db07c69a00055d36d8545` pass.

Root inspected actual Material and unprepared Knowledge in both themes at
1080/390px, collapsed/expanded, with separate narrow captures scrolled to Apply.
Final evidence: `.mlearn/m10/collection-disclosure-settled.json` and its20
PNG states; task-root `collection-disclosure-final.log`/results. The trigger
measures95.25x34px in Chromium, stays contained and exposes expanded true/false;
Apply is reachable in each narrow caller/theme. The first capture's immediate
post-resize geometry was stale in two cases; the settled driver waits for paint
before measurement and preserves the original manifest. No product timing
workaround was added. Metadata records0 provider requests, no active catalog,
and0 prepare_collection commands: Knowledge capture intentionally stops before
catalog preparation and does not prove populated Knowledge or native layouts.
All18 existing Material editor/collection/proposal scenarios then pass in19.0s,
including real compound counts, paging, exclusion, restart and keyboard removal.
Preview4173, capture browser/native host and test owners are absent after exit.
The process-search command returns1 for no matches, not a test failure.
Last guard sample: OmO footprint3109352912, available7944290304, pressure1,
swap4819976192 bytes, unchanged4GiB reserve. Material header density, sidebar,
compositor material and applicable native parity remain open below.

October 30 Material populated-grid baseline and focused status-region repair:
the real GUI authored Japanese 猫/犬/鳥 through existing native Material commands.
The grid already used 280px minimum tracks,16px gaps and24px grid/card insets;
no replacement grid, store or shared-shell styling was introduced. The empty
status wrapper nevertheless reserved an extra20px section gap after readiness.
Material now mounts that region only for actual pending/error/preparing/
unavailable feedback. Existing recovery content and actions are unchanged.
Typecheck, architecture lint, draft guard and fresh single-worker export
`bb54349b854791ca8de44fb2ae3c434b` pass. All18 existing Material editor,
collection and proposal browser scenarios pass in19.2s, including native
filter/count/paging/edit and crash-restart flows (`material-status-tests.log`
and `material-status-results` in the current task root). No cosmetic-value
test or acceptance assertion was added or weakened.

Root finite native-backed captures reused the genuine GUI-authored profile
`/tmp/mlearn-ci-independent.6EaZ3F/material-grid-baseline-native.E81938`.
Before/scoped/after manifests and PNGs are `.mlearn/m10/material-grid-baseline`,
`material-grid-scoped` and `material-grid-status` respectively. Both themes
were captured at390/1080/1440/1920px and narrow end-of-list. Inspected after
captures show first-card y250->230 desktop and518->498 narrow; card widths
remain408px at1080,342px at390,286px at1440 and321.59px at1920.
The scoped Material body is the sole results scroll owner and its last card,
paging and Refresh remain reachable. The initial baseline's global shell
selector targeted a retained hidden route; its supposed end capture is invalid
scroll proof, preserved rather than overwritten. The corrected driver scopes
to the actual Material card's ancestor and asserts last-card visibility.
The first export invocation failed because root forwarded a worker flag through
two npm script layers; direct workspace forwarding then exported successfully.
Both failed-driver interpretation and failed invocation remain explicit.

This repairs only the demonstrated empty status spacing. Material parity and
applicable native layouts remain open: the reference has a220px sidebar,
different header/filter/selection density and darker collection materials;
current shared-shell width is200px. Narrow Chromium with touch emulation/DPR1
is not native-device or compositor evidence. No Lighthouse, native-device,
IME or new independent M10 gate verdict is claimed. Root capture/QA processes
and preview4173 were absent after completion; genuine profiles are preserved.
The unchanged4GiB resource reserve held. Last focused-test sample: OmO
footprint3109729744, available8563212288, pressure1, swap4655022080 bytes.

October 30 integrated JS/TypeScript owner checks pass at product625ef496 and
test checkpointc9e13103:87 tooling checks plus202 package/client tests, with
zero failures, skips or cancellations. Both stages ran serially using
`node --test --test-concurrency=1 tools/checks/*.test.mjs` and
`tsx --test --test-concurrency=1 packages/*/tests/*.test.ts tests/client/*.test.ts`.
Evidence: task-root `m10-owner-suite-toolchain.log`, exit0. The original
`m10-owner-suite.log` remains a failed run: root's login-shell wrapper selected
Xcode Python3.9.6, causing seven offline character-converter syntax failures;
its TypeScript stage never started. A non-login shell with explicit existing
`/opt/homebrew/bin` PATH selects verified Python3.14.7. No product/test assertion
or interpreter compatibility code changed. Node rejected test-concurrency in
NODE_OPTIONS; the supported CLI flag was used instead.
Rust source continuity was checked againstf3e7366a: `git diff --stat f3e7366a
HEAD -- crates Cargo.toml Cargo.lock` is empty. Reuse the recorded warning-free
22 language-host and70 runtime passes and exact139b78f8 hosted Rust evidence
below, rather than rebuilding unchanged owners. This does not promote the
separate native/platform/M10 gates to passing. The owner-suite guard stayed
safe with the unchanged4GiB reserve; last sample footprint3445405136,
available8293810176, pressure1, swap3987603456 bytes. Disk readback is8111908KiB
available; owned verification roots were measured, not deleted or attributed
to unexplained memory growth. Preserve genuine profiles and compiled artifacts.

October 30 accepted source-proposal departure: Open saved Material bypassed
Inspector's checkpoint-aware owner and left its source Inspector portaled over
the editor. The new real-conversation regression reproduced expected0/received1
Inspector before repair (`accepted-proposal-departure-red.log`/results).
SourceActions now delegates that action to its parent Inspector when present,
reusing the same draft/checkpoint acknowledgement, close and management-entry
owner as ordinary captured Material. Standalone callers keep their existing
route behavior; no duplicate departure implementation or new state owner.
Normal typecheck, ownership lint and fresh export
`9531139e3df9cdb27877868aa62d9e5a` pass. All41 affected proposal/Reader/Watch/
Messenger cases pass in1.1m (`accepted-proposal-departure-green.log`/results).
The actual conversation's unsent draft and retained unsubmitted Material search
both survive opening the accepted editor and returning to the captured message.
Desktop/narrow editor captures were inspected with no stranded Inspector.
Product/test diagnostics and diff check are clean. Native QA processes and
preview4173 were absent after completion. Resource reserve stayed4GiB; last
sample footprint3354998224, available7352434688, pressure1,
swap3634298880 bytes. Prior independent approval remains bound to19e35a9a,
not this later two-owner callback increment; full M10 review is still required.

The follow-up pending-proposal draft-loss hypothesis did not reproduce.
Against unchanged625ef496 product/export, the actual message proposal Return
keeps the unsent composer text after closing the captured-original dialog.
The strengthened existing test passes in3.0s (`pending-proposal-draft-red.log`,
despite that preselected filename); its final diagnostics/diff check pass.
No speculative checkpoint/focus/lifetime repair was added, and dependent
save-recovery work for that hypothetical repair was dropped. This is observed
browser navigation continuity, not evidence of an extra native draft save.
The4GiB reserve stayed unchanged; last launch footprint3357947344,
available7988281344, pressure1, swap3674800128 bytes. The finite QA owners closed.

October 30 proposal Return repair: the real Reader regression returned the
right document but lost the captured selection (`Children` stayed transparent).
Proposal navigation now carries only its stable proposal ID; existing Reader,
Watch and captured-message owners resolve the authoritative anchor through
`returnMaterialProposalSource`. No anchor store, protocol or Rust authority was
added. Reader selection survives reload; Watch restores the original subtitle
selection; Messenger opens its captured-original dialog rather than only a chat.
The first integrated captures exposed the originating Inspector still portaled
behind the destination. Successful Return now invokes that existing Inspector's
close callback before navigation, and tests reject duplicate/stranded Inspectors.
Failures retain the initiating proposal dialog.

Typecheck, ownership lint and final export
`a8e5f48bc2d012a3bd23050edd89a00f` passed. All40 affected proposal/Reader/Watch/
Messenger scenarios then passed in1.1m (`proposal-selection-settled.log`/results).
Desktop/narrow Reader, Watch and captured-message captures were inspected.
The source-only Watch proposal fixture intentionally does not decode; the
separate genuine-media departure case also passed in this run. Image proposal
Return shares Reader's existing image-anchor path but was not independently
exercised here. No native-device/platform certification or complete M10 claim.
Original red evidence is `proposal-selection-red.log`/results. The earlier
40-pass intermediate (`proposal-selection-integrated`) predates the portal fix.
`proposal-selection-final` retains39 passes plus a polling-driver timing failure:
virtual time advanced before an outstanding native poll scheduled its next timer.
The repaired test awaits the exact held polling request before pausing time;
it does not sleep, extend a timeout, weaken cleanup assertions or retry to green.
Fresh diagnostics for all three affected test files were clean before that final
small synchronization edit; normal product typecheck is clean. The final run
kept the4GiB reserve: last sample footprint3335583184, available7760494592,
pressure1, swap5011406848 bytes. QA native processes and preview4173 were absent
afterward. Existing Inspector action-rail clipping/lexical-alternative differences
remain outside this navigation repair. M10 review/native/visual gates and M11's
dependency gate stay open.

Root's separate finite omowright replay passed on exact product checkpoint
`19e35a9a`, not a later renderer build. Actual GUI creation of an unaccepted
proposal, Return, native SIGKILL/restart and route reload preserve the exact
Children highlight at1080/390px, zero stranded Inspectors and no horizontal
overflow. Home/Material/Review proposals reopens the same pending revision1
with unchanged authored meaning/notes and zero provider requests. The manifest
is `.mlearn/m10/proposal-return-root-qa.json`; linked pending/restart/management
captures were inspected. `proposal-return-root.log` exits0. Its native profile
`proposal-return-root-native.vkMSua` is preserved under the task root; owned
browser/native/server were closed and exact profile processes/port4173 absent.
The4GiB reserve remained unchanged; last sample footprint3340760528,
available7888781312, pressure1, swap3773366272 bytes. The single read-only
independent reviewer approved exact source `19e35a9a` with no blocker and
moderate-high confidence for this bounded increment. It inspected source,
native owners, tests, logs and captures without running workloads or writing
files. Report: `.omo/evidence/proposal-return-19e35a9a-gate-review.md`.
The clean locked review checkout was verified at that source and removed.
Closed-dialog/route-change races remain statically audited only; image/native/
visual limits remain open. This verdict is not milestone or maintainer acceptance.

October 30 unavailable-Review recovery increment: the browser-preview Home
action replaced Home and discarded the retained Knowledge workspace, even
though an ordinary management roundtrip preserved its unsubmitted search.
The real browser regression reproduced that reset before repair. The fallback
now uses the same `dismissTo('/')` navigation as available Review; no session,
audio or persistence owner changes. Typecheck, ownership lint and fresh export
`334c468c247a93ef7e6f01fb82605df6` passed, followed by all20 affected foundation/
Review tests in11.7s. Both1080/390px paths preserve the exact authored query.
Root's separate finite omowright replay passed at both widths; all four captures
were inspected for usable, contained unsupported/recovered states.
Evidence: task-root `review-unavailable-red-admitted.log`,
`review-unavailable-green.log`, `review-unavailable-root-qa.log`, and
`.mlearn/m10/review-unavailable-root-qa.json` with linked PNGs. The earlier
`review-unavailable-red.log` held before workload launch, not a test failure.
The root replay loaded that exact fresh bundle without a native shim or state
mock and closed its owned browser/server; port4173 and its profile process
were absent afterward. Guard samples stayed safe with the unchanged4GiB
reserve: final footprint3599087056, available7993245696, pressure1,
swap4901371904 bytes. This proves browser-preview navigation, not Rust session
persistence, native TextInput/IME or complete NAV-02/M10 acceptance. The wider
M10 independent review remains required; M11 stays gated.

The follow-up real English-package/SQLite regression passed in4.3s against
product checkpoint `fd7db9c5`, with no further product edit. A real Inspector
capture starts a finite scheduled Review; Home then visits Knowledge/Material
with distinct unsubmitted searches at1080/390px. Reopening the existing session
preserves its entire revealed encounter and exactly one session; both management
drafts survive the Review roundtrip. Pause, native SIGKILL/restart, browser reload
and Resume retain the same encounter with zero completed reviews and zero provider
requests. Both restored captures were inspected: cue, answer, rating controls and
Return remain contained. This is browser/Rust integration, not consuming-platform
media or native TextInput proof. `review-management.log` and its result directory
under the task root preserve execution/captures; test diagnostics and diff check
passed. Admission held until three safe samples, without lowering the4GiB reserve;
last launch sample footprint3310302672, available8739602432, pressure1,
swap4282777600 bytes. Owned native QA processes and preview4173 were absent after
the finite test closed. Full navigation/M10 gates remain open.

Messenger Home polling-lifetime regression passes in2.6s with the real native
generation held streaming. After send/draft cleanup settles, the test holds one
actual polling receipt, departs through Home, releases that receipt and advances
four600ms polling periods with Playwright's virtual clock. No further status
read is issued by the unmounted conversation. The native generation remains
streaming with one provider request; reopening Coach permits explicit Stop,
closes that same provider request and publishes cancelled. No product edit was
needed. The first driver held the initial poll before send cleanup could finish,
blocking the serialized request lane and leaving Home disabled; its AbortError
and trace remain in `messenger-home-poll.log`/results. The corrected event-bound
run is `messenger-home-poll-v2.log`/results; this is not a product-failure repair.
Diff check passes. Fresh LSP diagnostics timed out after the change; the earlier
initial diagnostics were clean, but that does not certify the final test source.
The final test executed successfully. Guard samples stayed safe with unchanged
4GiB reserve; last launch footprint3333420496, available8197242880, pressure1,
swap4115005440 bytes. Native QA processes and preview4173 were absent afterward.
This verifies Home unmount/stale-receipt cleanup, not a retained-but-hidden route
or consuming-platform Watch playback lifetime.

Watch's existing genuine-media search/departure case now starts decoded
H.264 playback before its held Home save. The player stops while that receipt
is still pending, stays paused after Home and after a Home-body Space key,
and its exact measured stopped position survives native SIGKILL/restart.
The unchanged failed-save recovery, transcript/cue seeks, subtitle offset
and playback-rate assertions also pass. No product edit was needed.
The changed case passed in3.0s (`watch-playing-home.log`/results), reusing
`.mlearn/m03-m07/m07-messenger/fixture-decode-local-e6986c8a/watch-fixture.mp4`
through the existing byte-range adapter, without regenerating media or starting
a device. Pending/error390px captures were inspected; feedback and recovery stay
visible beside Home, and the genuine frame/captions/controls remain contained.
This is decoded Chromium media plus real Rust persistence, not Tauri asset-server
or native-device playback certification. Final Watch test diagnostics and diff
check pass; the unrelated Messenger test LSP freshness timeout remains recorded.
The unchanged4GiB reserve stayed safe: last launch footprint3330553296,
available8788393984, pressure1, swap4098228224 bytes. Native QA processes and
preview4173 were absent after completion.

October 30 independent engineering checkpoint `6eda570a`: Watch Home previously popped back
to Material instead of Home; Reselect from Home replaced the retained management
workspace and erased its unsubmitted search. Both failures were reproduced against
the real Rust source/analysis/storage fixture before repair. The existing departure
owner now dismisses to Home after cancellation/checkpoint acknowledgement; both
actions share that owner. Typecheck, ownership lint and a fresh web export passed;
all 11 affected departure/layout/foundation scenarios passed in 13.5s. Eight captures
at 1080/390px were inspected. Evidence is under
`/tmp/mlearn-ci-independent.6EaZ3F/`: `watch-home-red2*`,
`watch-reselect-red*` and `watch-home-green*`. The fixture does not decode
media and proves neither native playback nor failed/held playback-save recovery.

Root's first additional omowright manual run was interrupted before browser attachment.
Its guard recorded OmO footprint jumping from 3344430520 to 12286080440 bytes,
pressure 1 to 2 and available memory 2910306304 bytes; it automatically stopped the
owned workload. A subsequent sample was footprint 7099332024, pressure 1,
available 7291895808 and swapUsed 5577179136 bytes. This is unexplained OmO growth,
not attributed to Chromium/native owners. Substantial work was held for fresh
resource investigation and trend evidence. Exact native/browser/web PIDs 50958/50960/
50959 and listeners 4173/59140/59141 were absent on readback. The harness did not
deliver its graceful-close receipts; supervisor termination plus process/port
absence are the available cleanup evidence. That run remains incomplete.
Raw samples are in `manual-watch-supervision.log` under the same task root.
Bounded vmmap summary subsequently reported 6.6G current/14.4G historical peak.
The eval heap was only 28944705 bytes with 6419377 external bytes, while process
mimalloc counters reported 10401349632 current huge-allocation bytes. These
counters locate the discrepancy outside the small eval heap but do not establish
its owner or cause. No heap dump or large session history was loaded.

CI polling is stopped; API 403 observations are not CI failures. Existing endpoint/
request-ID/body evidence is in that root's `ci-observation.md`; original rate-limit
response headers were not captured. No diagnostic CI variant or unchanged rerun
was launched. Four source-only lanes returned: Windows theme failure investigation
(no causal fix established), 25 explicitly UNRUN M11 package/session scenarios,
Messenger lifecycle assessment (candidate restored because no real retained-exit
consumer was established), and Material reference-owner audit (no visual change).
M11 integration remains gated on M10. The latest inherited Windows input and iOS
Watch failures below remain unresolved.

### Watch checkpoint and pending-action increment, October 30

After the recovery question timed out, the idle resource trend and three fresh
samples showed normal pressure, flat swap and approximately 6.0 GB projected
headroom after a 1 GiB allowance. This justified one deliberately selected,
automatically supervised run; it did not explain or repair the earlier OmO spike.
The four-GiB reserve and serial-work requirement were unchanged. No stopped
device, old manual harness or CI polling loop was automatically restarted.

The existing decoded-video/source-search test now fails `save_position` transport,
uses explicit Retry, holds the next Home save, and verifies no departure before
acknowledgement plus persisted position/rate/offset after another native restart.
The first run passed, but its inspected pending capture exposed an unrelated
native-open cancellation control during Home saving. The strengthened assertion
failed before repair (expected zero `Cancel opening` controls, received one).
Watch now exposes that existing control only during the actual `openSource` await;
generic busy admission and the native cancellation authority remain unchanged.

Both changed files have clean LSP error diagnostics. Normal typecheck, ownership
lint, fresh export `432136dd68020a28fd34d62458b00b2a` and all 12 affected
foundation/Watch layout/departure/source-search scenarios passed in 15.0s.
Guard samples remained safe; no assertions were skipped or weakened. The browser
decodes the authored 30-second video, while byte delivery and shell event
registration are adapted. This is real Rust source/checkpoint/restart evidence,
not native operating-system media or drag/drop cancellation certification.
Raw red/green logs and captures are in `/tmp/mlearn-ci-independent.6EaZ3F/`.

Root then drove the real page with omowright from eval against a fresh isolated
Rust profile and authenticated English package. The actual subtitle `Children`
was captured into Material. At 1080px, Watch Home reached Home and retained
`Manual retained Watch draft 1080`; at 390px, Reselect from Home reached Home
and retained `Manual retained Watch draft 390`. The manual adapter explicitly
lacks native media services; its visible media failure is the recovery scenario,
not a decoding result. The decoded-video proof above is separate.

| Increment scenario | Observed result | Artifact |
| --- | --- | --- |
| Failed save, explicit recovery, held Home, native restart | PASS | `watch-checkpoint-green.log` and `watch-checkpoint-green-results/` in the task root |
| Wrong cancellation action while saving | Reproduced red, repaired green | `watch-checkpoint-red.log`; green pending capture |
| Desktop Home retains Material draft | PASS, root omowright | `.mlearn/m10/manual-watch-{home,material-retained}-1080.png` |
| Narrow Reselect retains Material draft | PASS, root omowright | `.mlearn/m10/manual-watch-{home,material-retained}-390.png` |
| Adjacent navigation/layout/accessibility | 12 affected scenarios passed | `watch-checkpoint-green.log` |
| Owned manual browser/web/native teardown | Graceful close receipts and process/port absence | `manual-watch-final.log` in the task root; root readback |

Manual teardown reported Chrome exit 0, preview SIGTERM, no active provider/catalog
and successful native close. PIDs 58247/58248/58249 and ports 4173/59375/59376
were absent afterward. The outer manual command nevertheless exited 255: it used
Zsh `pipestatus` in Bash, leaving its reported status empty. Preserve that wrapper
failure, not a false command pass. A separate bounded Bash probe verified the
correct `PIPESTATUS[0]` expression preserves both success 0 and failure 1; the
manual application workflow was not needlessly replayed. Final footprint was
6735279544 bytes, pressure 1, available 6607536128 and swapUsed 3806068736.
Independent review approved exact `0875124772a6621a98c18a7c7b124e081189d053`
with no demonstrated blocker. The sole reviewer used the current subscription
GPT6.1Sol route, read the complete changed source/test and inspected red/green
logs and captures in a clean locked checkout; it ran no workloads. Its report is
`.omo/evidence/watch-checkpoint-08751247-gate-review.md`. It records unexecuted
native drag/drop cancellation and broad blur/unmount interleavings, the long
existing connected test, and evidence-association limits rather than inventing
another report or OS verification. This approves only the bounded increment.
The genuine closed native profile is preserved at
`.mlearn/m10/watch-checkpoint-08751247-native`; unused Chrome profile and manual
harness are removed. M10 remains incomplete and M11 integration remains gated.

Material reference inspection and the bounded multiline-field increment now have
finite real-surface evidence; this is not whole-Material visual acceptance.
A deliberately admitted retained
Electron/Vite session reached readiness, but the resource supervisor stopped it
before root could attach. OmO footprint changed 3304060344 -> 4442142136 ->
11340527032 bytes, pressure rose to 2, and available memory fell to 2977906688.
The reference connection was then refused. This is another OmO-process spike,
not proof of a model/reference allocation or a failed product assertion. No
reference editor measurement or Material styling change was made by that run. PIDs 60724/
60749 and ports 3000/7752/7753/9229 were absent afterward; post-stop footprint
6866531768, pressure 1 and swapUsed 4525064192 were recorded. The run exited 70.
Raw evidence is `material-reference-manual.log` in the current task root.
Do not repeat the live-ready/model-callback orchestration unchanged. A finite
reference probe that closes its owned workload before returning observations was
then exercised under the same admission/reserve/shutdown policy. It completed
with exit 0, safe guard samples and no reference listeners afterward. Root
inspected actual Browse captures at 1080/390px; the reference's narrow clipping/
sidebar overlay is a legacy defect, not a target to copy.
The first editor probe captured real short states at both widths, then failed
omowright's strict contenteditable fill check for multiline input. The changed
wrapped-paragraph case was not executed: its third admission sample held at
4175167488 bytes projected headroom, below the unchanged 4294967296-byte reserve.
No reference app was launched in that attempt. No competing compiler or QA
owner was found; OmO dominated the process inventory. Preserve both failed/held
receipts. The subsequently admitted wrapped-paragraph probe completed with exit 0,
closed its reference owner before notifying, and cancelled rather than saved.
Reference source is clean `1ab95600bee97017635afe538af4e890e0cded3a`.
`material-reference-editor-wrapped-admitted.log` records actual short Meaning
52.3984375px, empty example fields60px and long Meaning capped at200px, with
internal overflow at1080/390. Reference captures use
`.mlearn/m10/reference-material-editor-{short,long}-{1080,390}-dark-wrapped.png`;
the long captures are partly scrolled past Meaning, so their measured geometry
does not establish a fully framed long-field comparison.

`TextField` adds one shared compact multiline role, reused by `MaterialFields`
for Meaning, Context and Notes across saved/proposed/capture forms. It reuses
the existing composer measurement owner: empty60px, grow/shrink through200px,
then internal scrolling. Ordinary multiline remains180px; composer44–120px
is unchanged. No observer framework, store or feature-local input styling was
added. The new real-Rust/SQLite test failed against the old export because the
overflowing Notes field did not grow. Normal typecheck, ownership lint, export
`86bca5ba1062bf53a3000d7a8000d8c3`, and24 affected foundation/Material/proposal/
Messenger tests passed (`material-fields-first-green.log`,24.5s). The augmented
case then passed separately in3.1s (`material-fields-hidden.log`), covering
retained navigation/hidden resize, exact Unicode input, shrink, save and native
crash/restart. No product change followed the first green source.

Root-authored finite omowright workflows drove actual GUI package installation,
Material creation/save and both-theme1080/390 captures. Three driver failures
(unsupported handle API, value-bearing accessible name, custom versus HTML
select) are preserved under `material-root-{evaluate-handle-error,select-label-error,html-select-driver-error}.log`;
they are not product failures or passing commands. The final continuation reused
the closed, genuinely saved native profile rather than reinstalling/recreating.
`.mlearn/m10/material-field-root-qa.json` is PASS and links the completed light
evidence; `material-root-qa.log` exits0. It verifies exact saved text from a
fresh browser and again after native crash/reload, the Rust-snapshot theme ID
`mlearn.dark-quartz` before/after restart, and the adjacent default JSON field180px.
No generation request occurred. Browser, native owner and preview close before
notification. Guard samples stayed safe with the unchanged4GiB reserve; final
footprint3559241168, available8362442752, pressure1, swap3935305728.
Root inspected light/dark short and long captures under
`.mlearn/m10/material-field-root-appearance-*`. Empty60/overflow200 remain
contained and legible; narrow outer scrolling reaches the remaining form.
These captures are browser/Rust proof, not native TextInput/IME certification.
Caret position survives resize, but automatic caret reveal is not established.
Meaning60px versus reference52.4px, body16/24 versus17.6/26.4, inline-editor versus
modal composition, and the large persistent narrow management header remain
explicit visual differences. Independent review approved exact source
`94ff049b33abf61abcf6c7cec3cbaa01b9ece652` for this bounded web checkpoint only,
with no blocker. The single reviewer used the current subscription GPT6.1Sol
route, inspected source/callers/logs/receipts/images, and ran no workloads.
Its report is `.omo/evidence/material-fields-94ff049b-gate-review.md`.
The hidden-resize case proves no collapse at the cap, not intermediate-height
remeasurement; no product failure was demonstrated. The clean locked review
checkout is removed. Reference driver source is preserved byte-for-byte as
`.mlearn/m10/material-reference-driver.mjs.txt`, with no runnable scratch copy;
the retained reference and genuine native profiles are preserved. Inspected
current images were opened in Preview. Broader Material/native/M10 gates remain
open; M11 is still gated.

Departure checkpoint `5a540c88` preserves Messenger's retained management
workspace and waits for the existing Reader/image, Watch and Messenger source
save owner before Inspector opens saved Material. Failed saves retain the source,
Inspector and explicit recovery; Close invalidates a pending navigation intent.
Shared capture/source controls expose the pending disabled state.
Two real-Rust-backend departure regressions failed before repair and passed after
repair, including desktop/narrow draft restoration, native conversation/history/
analysis continuity, failed document checkpoint retention and explicit recovery.
Final client typecheck, ownership lint and diff checks passed. Four desktop/narrow
captures were inspected; the Inspector footer intentionally scrolls horizontally.
Evidence and both raw fixture profiles are preserved at
`.mlearn/m10/nav02-departure-5a540c88/`. The local rendered diff precedes one final
disabled-prop forwarding line in an unexercised non-actions row; exact-final-source
hosted web checks passed at `519df6e1`. Four matching exact-source captures
were retrieved and inspected: Reader failure/recovery at390px and Messenger
retained Material search at1212/390px. They confirm visible recovery and
workspace continuity, not whole-app visual acceptance. The selected captures
and failure state are retained under the evidence directory's `hosted519/`.

Exact-source `519df6e1` workflows are terminal. Foundation40936296995 failed
only its Windows native-theme UI job123670721181: foreground/editor focus and
clipboard were correct, but dispatched paste left the earlier theme value.
Its web, Rust, OCR detector and macOS desktop jobs passed. Real desktop
integration40936296952 passed. Mobile40936296936 passed Android123667605947,
but iOS123667606042 failed the original Watch flow after46s because `Browse`
was not found. Preserve the logs and original assertions; no unchanged rerun
or deferred FileProvider diagnostic variant was launched. These are still
unresolved platform gates, not milestone acceptance.

Substantial local work remains serial under fresh physical-footprint/pressure/
swap/headroom admission. A separate guard watcher tripped during that passing
UI run without automatically stopping it; this orchestration defect is explicit,
not a passing resource gate. No QA processes/listener remained afterward.
The owned `guarded-workload.mjs` now starts a workload immediately after three
healthy samples and automatically terminates its owned process groups on unsafe
measurement. Its real-process probes verified a detached child was stopped,
an unrelated sibling survived, and failed admission launched no workload.
Final typecheck/lint ran through that supervisor with no guard stop. Original
resource evaluation and the four-GiB reserve were unchanged; no device was restarted.

The preceding `c92fb10` foundation and macOS/Windows desktop jobs passed.
Its mobile jobs did not pass: Android's Watch flow lost Maestro's device server
during hierarchy collection; iOS could not find `m01-watch, mp4`. Existing logs/
artifacts are retained; no diagnostic variant or unchanged workflow was rerun.
Do not substitute these failures for product assertions or silently close them.
The management-only tab boundary passed its fresh hosted restoration assertions
and eight desktop/narrow captures. The original retained-editor regression is
repaired in `486c507`, with exact-source hosted checks and after captures below.
Fresh receipts confirm restored Material entry and changed package selection.
Rapid Home return's renderer request-admission defect is repaired and verified
against exact-source hosted checks and fresh captures below. Active-workspace
Reader return and the focused source-entry failure/recovery path are verified;
the remaining active-task/hidden-work lifecycle and native scenarios remain open.
CI is asynchronous relative to independent engineering: the current ready-work
queue and disjoint review/prerequisite lanes are recorded below. NAV-02 is incomplete.
The pinned publisher metadata defect is repaired. The mixed character
catalog, shared probe owner and related-detail producer have the owner evidence
below. The generic metadata-only catalog repair and graph source disclosure have
passing targeted evidence. Graph details, package-driven character views/learning
entry and Inspector deeper navigation are now verified_for_continuation against
exact `4f0c788` hosted tests and all 25 fresh captures. This is implementation
closure, not native-platform parity, independent milestone review or maintainer
acceptance. The live task ledger tracks the remaining integration, platform,
review and ownership-proven cleanup work rather than retiring inherited M07 gaps.
The latest parallel
authorization permits up to twelve useful workers, constrained by measured
headroom; all eight initial source-only/read-only lanes have returned. Root owns integration
and serial substantial workloads. Provisional cancellation checkpoint `eb077ac9`
extends `519df6e1`; its engineering and independent-review gates remain open.
Its earlier isolated
client owner run passed50 tests after root repaired uncertain-receipt slot reuse,
terminal cleanup, typed native Busy handling and the source-cancellation barrier.
The integrated runtime and language-host
library suites passed70+4 tests, warning-free, and the integrated selected client/
view/control suites passed44/44 with no skipped or cancelled tests. The earlier
private runtime owner suite passed70/70 after restoring only
hash-verified existing PDF guest and English package fixtures. The real Rust
browser QA host compiled. Structured native control-error tests passed1/1.
The full three-artifact FFI build was held before launch by unchanged resource
admission. A smaller no-link FFI check and a single metadata-only cdylib build
passed under supervision; no static/mobile library was built. Both exposed the
unchanged build generator's unused-mut warning for its empty desktop plugin vector. Scoped
private-source UI/host/test typechecking passed after fixing the new test's
unsupported `.ts` import suffix. Swift and Kotlin bindings were generated from
that actual Rust metadata, and generated Swift typechecked for arm64 and x86_64
simulator targets. The existing flat-config generator warning remains explicit;
generated names match the host calls. After buffered readiness, the isolated
desktop Rust host check passed without warnings. Full integrated application
typechecking and ownership lint passed. Automatic edit diagnostics ignored the
temporary native-server disable configuration and started a new3GiB Rust analyzer;
validation admission held, its exact parent/birth/workspace ownership was verified,
and only that analyzer, its workers and the paired Swift server were released.
Explicit tests/checks, not incomplete editor diagnostics, provide the evidence.
Mobile host builds remain unverified. Graph/evidence/search UI now pass operation-scoped abort
signals on Stop and dismissal. Three graph and four evidence/search cases
failed at the missing-abort assertion before repair and passed afterward;
these use real React/runtime-client with substituted native presentation, not
actual native-shell rendering. A real Rust QA-host/JS-adapter/client smoke
also passed bounded admission, cancellation receipt and error-classification
checks. The fresh main-tree QA binary and web export completed. At browser startup
the automatic guard stopped the owned run before any scenario completed; the
original reserve was not lowered. The remaining session-owned TypeScript
diagnostics were released after parent/birth/workspace verification. A buffered
read-only admission watch allowed the focused consuming-UI run, reusing those
completed artifacts rather than rebuilding. Six scenarios passed, including
actual Reader search stop/restart, evidence paging/restart and saved image-search
navigation. The new graph scenario failed on an incorrect new root-source label
assertion and a held-route cleanup race; both test defects were corrected without
changing product code. The corrected rerun was automatically stopped during
browser startup before any scenario completed. A subsequent one-hour read-only
4096MiB admission watch timed out; that local run remained held, without lowering the
four-GiB reserve or restarting workloads. The19
successful-scenario captures were inspected at desktop/narrow widths, including
both evidence themes and expanded provenance. Existing Inspector footer scrolling
and retained visual/platform gaps are not waived; native-shell functionality is
not claimed. Exact `eb077ac9` hosted web123763515779 and real desktop40963943223
passed. Foundation40963943227 failed Rust123763515784 at the unchanged persistent
guest cancellation assertion in `language-host/tests/resources.rs:140`; dependent
desktop jobs were skipped, not passed. Unconditional early cancellation had
preserved the cancelled owner's cache. Repair `f3e7366a` restores source-only
eviction while preserving nonwaiting operation-scoped cancellation. All22
language-host tests and70 runtime caller tests pass after repair, warning-free
with no ignored tests. Mobile40963943258 is terminal: Android123763515735
passed; iOS123763515335 built but failed the original Watch flow because
`m01-watch, mp4` was not visible after1m32s.
New exact-source hosted verification and independent review remain required.
No deferred iOS diagnostic variant or milestone acceptance is introduced.

Review Home departure is now verified_for_continuation in the shared web app.
The new regression failed with delivery still `pending` after Home removed Review,
while the existing Pause control passed. Home now awaits the actual audio owner's
terminal write through the existing departure/command owner before returning to
retained Home. Held or failed writes keep Review and the identical Retry command;
session, encounter, exposure and grading meaning are preserved. Normal typecheck,
ownership lint,11 audio-owner tests and all13 Review web scenarios passed on fresh
export `219225d61d656a13e338de4b0f00de01`. All18 PNGs were decoded, dimension-checked
and inspected, including1080/390 pending/error states in light/dark. Evidence is in
the retained orchestration root's `review-home-*` logs/results. Native audio/OS
lifecycle parity, the other Home exits and M10 milestone gates remain open.

Exact `139b78f8` hosted web123788934861, Rust123788935328, OCR123788935234
and real desktop40971451775 passed. Foundation40971451738 failed both
macOS123791352052 and Windows123791352101 at the all-feature compiler gate:
the opt-in OCR probe still initialized the removed `NativeState.cancellation`.
The minimal repair initializes the existing two-slot `read_controls` owner,
matching normal startup, and removes the obsolete local handle. No OCR probe,
model installation or inference was run. The full local desktop test attempt
was automatically resource-stopped during dependency compilation before tests
ran; its compiled artifacts remain. The smaller
`cargo check --locked -p mlearn-desktop --lib --tests --all-features` passed
warning-free in6.21s under serial1536/1024MiB supervision with the unchanged
four-GiB reserve. Logs are `desktop-probe-*` in the orchestration root.
OmO physical footprint was6.60GB, available6.00GB, pressure1 and swap3.26GB;
the metadata check's maximum RSS399425536 is diagnostic, not physical headroom.
Full desktop tests on repaired source remain for hosted verification.
Windows also reported an untouched-file `ocr.rs` unused `PathBuf` import;
it is not silently suppressed or claimed warning-free.
Mobile40971451757 passed Android123788935658; iOS123788935607 built, then
failed the original Watch flow after5m16s because enabled `Open local video`
was not found. Its raw failed-step log is `139b78f8-ios-failure.log`.
No unchanged rerun or deferred diagnostic variant was launched. Independent
M10 review, native parity and maintainer acceptance remain open.

Empty Reader/Watch entry now returns through `dismissTo('/')`, preserving the
existing management navigator instead of replacing it. The real-Rust regression
first reproduced the cleared document-entry Knowledge draft. The repaired flow
preserves all four document/video drafts at1080/390px. The complete existing
Knowledge/Material scenario then passed in2.3minutes, including its claim,
evidence cancellation/recovery, source-return and restart assertions. Production
export `e227967c20884ff325cd87b433ec883b`, normal typecheck, architecture lint,
source diagnostics and diff checks passed. All eight new1080/390x900 PNGs were
decoded, dimension-checked and inspected. Source-entry controls and retained
Knowledge remain visible and contained; the harness explicitly reports its
unsupported native window/media/clipboard services rather than fabricating them.
Evidence is `nav02-empty-{red,ready}*` in the retained orchestration root.
An intermediate fixture navigated again while metadata was pending, exhausted
the unchanged bounded request queue and failed the later paging assertion.
The final test observes actual ready controls before leaving each screen;
it adds no sleeps, retries or relaxed assertions. This verifies normal ready
entry/return, not sustained rapid-navigation admission or hidden-work closure.
An earlier export attempt also failed only because root forwarded npm flags
incorrectly; the corrected workspace export passed. Resource supervision never
stopped either assertion run. Post-QA footprint6581253560, available7040630784,
pressure1 and swap3904176128 were recorded; the preview listener was released.
Other Home fallbacks, Watch checkpoint departure and hidden-work ownership
remain open. Exact `764b9ac8` real desktop40977525036 and
foundation40977525010 passed, including Windows123811368520 and
macOS123811368530. This closes that source's all-feature constructor gate,
not the intermittent native input gate. No platform gate is waived.

Unavailable Messenger now uses the same shared AppShell/Row/Button/Text recovery
composition as Review, with a Conversation heading and Home action. Its prior
alert-only screen had no recovery control; the new regression reproduced that
missing button before repair. Home uses the existing `dismissTo('/')` behavior,
including the no-history fallback. No native client or parallel recovery owner
was added, and the obsolete local unavailable style was removed.
All six foundation web tests passed in4.4s on fresh production export
`fc3ea35690831ff70207dbe4f67c0a2f`, including direct Messenger, Reader, Review
and Watch Home recovery at1080/390px. Normal typecheck, architecture lint,
Messenger diagnostics and diff checks passed. Eight recovery PNGs were decoded,
dimension-checked and inspected; Messenger matches Review's shared shell and
its explanation wraps within390px. Logs/captures are `nav02-unavailable-*`
in the retained orchestration root. The first test attempt incorrectly expected
an unavailable alert from Watch; actual Watch still shows `Opening source…`
without a runtime. The corrected test preserves the original Watch Home
assertion rather than asserting a fabricated error state. That misleading
pending state and Reader's older unthemed fallback remain explicit presentation
gaps, not repaired or certified by Messenger's change. This browser-only
fallback verification does not certify native conversation or media lifetimes,
dark fallback rendering, retained unavailable Reader/Review return, or M10.

Exact `fa2bbfe9` real desktop40979941349 passed. Foundation40979941378 passed
web123817940225, Rust123817940168, OCR123817939886 and macOS123819919478;
Windows123819919456 failed its original native-theme input assertion.
Dark Quartz and Slate edits, repeated cycles and restored Dark Quartz native
material passed before the final post-restart Quartz edit. Foreground/editor
focus and the expected clipboard were confirmed, but paste left the previous
Dark Quartz JSON; `window-materials.ps1:352` reported incomplete native input.
The raw failed-step log is `fa2bbfe9-windows-failure.log` in the orchestration
root. This is the retained input-loss failure family, not proof of its cause
or a reason to change product code without reproduction. No assertion was
weakened, diagnostic variant launched or unchanged workflow rerun.
The earlier a25ef895 foundation40979349126 was cancelled before jobs ran,
not a failing product check; its real desktop40979349106 passed.
Mobile observation recovered after the October30 01:59:06UTC reset boundary.
Earlier mobile40979349137 passed Android123815202481; iOS123815201952
built but failed the original Watch flow after2m41s because `m01-watch, mp4`
was not visible. Its original failed-step log is `a25ef895-ios-failure.log`.
Latest mobile40979941319 passed Android123832772718; iOS123832772428 failed
the original Watch flow after 1m35s because `m01-watch, mp4` was not visible.
Its raw failed-step log is `fa2bbfe9-ios-failure.log` in the independent task root.
All observers, including the reduced-frequency observer, are terminal; no polling
process remains and no workflow was rerun.
The earlier observers exited on GitHub HTTP403 API rate exhaustion and left
empty receipt files; those exits were observation failures, not CI results.
Root's concurrent default-frequency watches produced excessive API traffic.
The rate endpoint briefly reported available quota while actual run requests
still returned403; a single time-bound subscription then recovered both receipts.
Do not restore the rapid watches or repeatedly query exhausted endpoints.
Independent M10 work and all unresolved platform gates remain open.

M11's scratch finite reference matched all 40 original and 14 adversarial cases,
but executed zero package/native session scenarios and granted no learner evidence.
M11 product integration remains gated on M10.
The execution record is
`/var/folders/f2/d3_jzj917kg6sqsc9tgc80200000gn/T/ulw-mlearn-20261028.XXXXXX.md.sfqTwzdUNN`;
new scratch root `/tmp/mlearn-parallel-ulw.M8JsP2`.
The goal API rejected replacing obsolete unfinished visual-parity metadata;
that metadata neither changes current scope nor establishes completed work.
KNW-04's connected evidence implementation is
verified_for_continuation, not native-platform or maintainer acceptance.
SRC-10's connected implementation is verified for
continuation, not platform or maintainer acceptance. Its Watch/cross-source
closure is committed/pushed as
`c61df5af66cbf2a1a9b01ce7668333236ed94099`, following Reader2505a044.
KNW-04 is committed/pushed as
`bb9fce3974254aa5c8876046396428945d3d48b4`. Its exact-source automatic
desktop40756004919 and foundation40756007680 passed. Mobile40756004929 is
terminal: Android123059177109 passed; iOS123059177501 failed its original
actual-UI step because enabled `Open local video` was not found. The authored
H.264/AAC fixture exported successfully; this is not the earlier export failure.
Its exact failed-step log is retained as `knowledge-ios-ci-failed.log` in the
existing execution root. No diagnostic workflow variant was launched.
Selective extraction retained only its JUnit, Maestro log and failing frame.
The English picker entry completed. The later Japanese entry reports
`home-open-watch` bounds[41,87][352,156] and tap[196,121], but its failure frame
still shows Home with the Watch action above the scrolled body/behind the
header. This narrows the failure to that Home entry; product versus test-input
cause remains unverified. Preserve the assertions and reproduce on retained
native artifacts before changing code or helpers.
This does not establish the unfinished graph work.

Graph trace: core currently has no linguistic relationship query/store; the
existing immutable package SQLite key/value index is the resource owner.
English target identities are WordNet lexical senses; Japanese targets remain
the existing explicit JMdict targets. Related forms/readings and other entries
must not inherit their Knowledge. The v2 GraphNeighborhood and graph addressing
sources distinguish identity, property and support; their fixed linguistic
ontology/compact graph machinery is not a v3 architecture requirement.
The in-progress generic contract adds package-owned entity kinds, properties,
predicates, provenance and qualifiers, plus identity/property/alternative/support
roles. It preserves unknown structured values and parallel relation IDs.
Native admission bounds16 edges/128KiB, validates exact endpoints, declared
target capabilities and consistent entity metadata, and fences continuations by
package/target/revision. Completion queries the existing Knowledge owner only
for explicit target bindings; no edge copies or predicts learner state.
English source now retains the original WordNet synset word list and exposes
separate lexical alternatives/synset support. Japanese source exposes attested
form/reading properties, written-form alternatives and shared-reading support
under separate target bindings. Its per-call32-candidate/16-edge quantum and
local decoded-index cache bound work without dropping continuation; hashed
semantic relation IDs do not depend on array positions. Both package manifests
declare the new capability and versions; source pins/licenses remain unchanged.
These are source edits, not delivered graph behavior. The first guarded owner
check initially waited on the unchanged2GiB/4GiB policy: footprint4585911424/
available6030770176 projected less than the reserve. No workload was admitted
during that hold; no reserve was lowered or waiting run duplicated.
The bounded process inventory then found Rust analyzer39186 at3505440KiB RSS,
parent47976 (an OmO child of82251), cwd this repository, started during this
session's diagnostics at2026-10-28T20:44:17. Its requested diagnostics had
completed. That exact owned analyzer received SIGTERM; it and its two owned
helpers39269/39270 were confirmed absent afterward. No other process was
stopped. Available memory rose to8114208768; OmO footprint remained4582290560,
RSS3954819072, pressure1, swapUsed3966238720, swapOut78071758848. This explains
one current capacity consumer, not the earlier OmO incident or OmO footprint.
The registered check then passed both native graph admission tests and core
contract generation (`graph-owner-first.log`). Its final footprint4581848192,
available7545552896, pressure1, swapUsed3966238720, swapOut78071758848 was safe.
`graph-packages-first.log` passed both English and both Japanese graph tests,
including real package producers with synthetic bounded dictionary fixtures.
The subsequent typecheck correctly failed because the explicit export list
omitted serde_json's recursive `JsonValue` declaration. The exporter now emits
that actual dependency instead of hand-editing generated types. Vendor Sudachi
warnings are retained, not suppressed. The typed graph client now validates
bounded inert metadata/relationships and exact explicit Knowledge-key coverage,
snapshots scope/revision, and uses the existing bounded source-read lane with
source-epoch rejection. `graph-client-first.log` passed its3 new boundary/
snapshot/concurrency tests, the50 affected existing client tests, typecheck
and lint. Offline authenticated package preparation then succeeded in
`graph-integration-first.log`; the guard stopped runtime compilation at
available6434275328/projected4286791680, below the unchanged4294967296 reserve.
The old negative-group cleanup again returned EPERM; no owned compiler survived.
The temporary runner now signals only positive PIDs in its live child's
observed descendant tree, leaves first. The package-reusing retry stopped at
available6165790720/projected4018307072; that cleanup completed without EPERM,
and the bounded process inventory found no owned compiler/guard survivor or
large analyzer. OmO footprint4603278464, available6654623744, pressure1,
swapUsed3941072896 and swapOut78071758848 remain observations, not a diagnosis
of the earlier OmO incident. Neither stop ran the graph assertions.
The actual compiled-package runtime graph suite now passes all3 tests in
`graph-integration-limited-debug.log`. It covers live Knowledge between graph
pages, cross-target/stale-revision
cursors, restart, real JMdict homophones versus unlearnable form properties,
and an undeclared capability's explicit unavailable result. The QA host also
built; SHA256e1d6b67cd7c99ff15eba2650cf9cae5b138f86ec1dd810999de9316cf98bfcf9.
The verbose compiler commands confirm runtime, graph test and QA host debug1.
The invocation explicitly retains debug assertions/overflow checks and does not
change optimized interpreter profiles, one Cargo job or the2GiB/4GiB policy.
This is functional evidence, not normal-debug performance acceptance.
Final guard sample: footprint5053609088, available6857424896, pressure1,
swapUsed4837867520, swapOut79362883584; all policy checks safe. A later bounded
vmmap identifies the dominant allocation category as App-Specific Tag1
(4.5GiB resident/1.8GiB swapped), not WebKit Malloc(67.9MiB resident). The eval
kernel shares PID82251; one full GC reduced its reported JS heap about15MiB
but did not materially reduce physical footprint(5047399552 afterward).
That is allocation-category evidence, not a causal diagnosis. Footprint is
currently stable near5.05GB; admit no concurrent substantial workload.
Next: reuse the already inspected retained isolated reference launcher/profile
for the actual graph composition, then capture the current Inspector baseline
before presentation changes. Do not repeat completed native/package checks.
The deliberate graph-reference attempt reused the retained compiled Electron
host and real159416064-byte Japanese graph under the supported isolated
`MLEARN_USER_DATA` profile. Its unchanged2GiB/4GiB guard stopped at
available6224478208/projected4076994560 before a capture; no visual result is
claimed. `graph-reference-first.log` retains the stop and CDP-disconnect result.
Its owner tree/ports3000,7752,7753,9229 were confirmed absent afterward.
The earlier pending diagnostic/run wording is superseded by the source results
and capacity readbacks below. Do not automatically restore workloads; retain
the execution root
`/var/folders/f2/d3_jzj917kg6sqsc9tgc80200000gn/T/mlearn-m10-m11.VLSN0zAbpw`.
The bounded character trace found its actual reference at
`../mlearn-ts/src/renderer/windows/characterGrid/`. New source preparation
reuses the package's existing `resource_entries` table/codec, with separate
`character/<ucs>` keys. It does not derive character knowledge from words.
The original catalog enumerates only `entry/`, so these facts are not yet
advertised as supported character targets.

Character inputs are the genuine KANJIDIC2 edition2026-301/date2026-10-28 and
KRADFILE, pinned by compressed and expanded size/SHA256. Publisher licensing
was retrieved directly; attribution, supplementary-source credits, source
update procedure and pre-2010 JLPT/lookup-element limitations are recorded in
the existing Japanese license document. The explicit offline freezer generated
immutable archives in the existing package assets directory; normal builds
do not depend on a moving daily download. The converter preserves reading/
meaning groups, unknown reading attributes, supplementary UCS identities,
name readings and absent-versus-present component data. Representative KRAD
lookup elements are not learner target bindings.
`character-source-full-first.log` passed all5 baseline conversion/integrity/
rollback tests and real-source conversion:13108 characters,6355 component-
covered records,5787648-byte test resource, and actual bridge readings/components.
Reported maximum RSS was53641216 bytes for the fixture target and38043648
for real conversion. These bounded, model-free offline targets use a512MiB
estimate and capped128MiB Node heap; the4GiB reserve and native/browser2GiB
reservations are unchanged. The earlier2GiB admission expired without tests;
its runner/guard were confirmed absent before the source-only target started.
The connected-owner/publication suite and full unified offline rebuild passed
in `character-index-full-first.log`:7 tests,0 failures;218923 unchanged JMdict
entries/forms465834,13108 characters,6355 component-covered records.
The unified SQLite is137007104 bytes,
SHA256`48e95432e6bf36d0ccd5cde86ff289a36b33fbcc53c281b315de10da6e3b331d`;
the representative word-identity comparison covered12 entries.
The real index process reported145801216-byte maximum RSS; fixture tests
reported54706176. The existing Sudachi input remains122948155 bytes.
Recipe identity now includes the character converter, and metadata separates
word counts from character/source-component counts. No runtime character
inspection, learning entry or UI/native acceptance is claimed.
JSON/Python LSP servers are unavailable; source-test diagnostics timed out.
The exact owned TypeScript tree52036/52037/52038/52039 was inspected; all had
already exited before the attempted SIGTERM, so that command stopped nothing.
After that completed run, OmO footprint4938527848/available6563872768,
pressure1, swapUsed4653318144, swapOut79362883584 were recorded.

The source-only character backend investigation returned a concrete blocker,
not an implementation: `collection_catalog.rs` rejects an empty capability set.
The preserved supplementary-character fixture is valid source-format input but
has no supported meaning/reading task. Catalog admission must not manufacture a
capability merely to include it. Existing collection reads already project only
declared per-target capabilities and capability filters join that membership.
`characters-native-proposal.patch` is explicitly a blocker report, not a diff.
The root regression is now applied. `catalog-metadata-before-fix.log` proves
its expected failure: Cargo101, `Invalid("Catalog target exceeds bounds")`,
0 passed/1 failed/19 filtered. The subsequent production repair removes only
the nonempty-target-capability restriction; namespace, declared-capability,
continuity and byte bounds remain intact. The test covers resume/restart,
browsable source metadata, empty Knowledge projections and capability-filter
exclusion. The two original root patch artifacts remain as preparation evidence.
The package's Inspector now dispatches canonical `kanjidic:<ucs>` identities
to the existing source resource. Only Japanese on/kun/name readings and
default/English meanings supply supported entry capabilities; foreign facts,
missing associations, audio and stroke-order capabilities are not fabricated.
Supplementary scalar identity is checked against both literal and source UCS.
This is an in-progress connected native entry path, not a delivered grid/list,
related-character graph or completed learning workflow.

The storage regression and repaired validator had no diagnostics. Later package
queries explicitly reported `unlinked-file`: the analyzer rooted at the application repository,
despite the separate package Cargo workspace; that topology did not establish
a smaller diagnostic footprint. Completed owned analyzer61585 and its helpers
were signalled before baseline compilation; analyzer62241 and its helpers were
signalled after the repaired-validator diagnostic, before serial verification.
The first verification exited before tests: checking `plugin.rs` recursively
found existing formatting differences in `review.rs`. Git confirms that file is
unchanged from HEAD. That failed check is retained, not reported green.
`catalog-character-native-second.log` then passed all20 storage collection tests
and all3 new character package tests, terminal exit0, one Cargo job and unchanged
2GiB/4GiB guards. Final sample: OmO footprint4611650664, available7616577536,
pressure1, swapUsed3893755904, swapOut86668214272; safe. The generic admission
repair is verified for continuation, not completed character-feature acceptance.
`character-catalog-package-first.log` subsequently passed all 34 affected plugin
tests. The opaque words/characters cursor preserves prefix-local resource keys
and the original 12-row word quantum, crosses the prefix boundary without empty
intermediate pages, retains metadata-only targets and truthful totals, and
rejects foreign-prefix cursors. Character rows have separate kinds/scopes and
no invented JLPT N-level membership. Activation now requires character schema 1;
manifest source is `0.1.11-...-graph1-characters1-ocr2`. It has NOT yet been
restaged into the authenticated development catalog.

The shared existing review owner now handles canonical character material and
narrows tasks/keys to its actual inspected capabilities. Missing meaning/reading
and character audio are not supplied by the word path; mismatching glyph content
is rejected. Metadata-only input returns no eligible probes. Authored content
still follows the existing self-report mechanism, not an external correctness
or stroke-order validator.
`character-learning-package-first.log` passed all 38 affected plugin tests,
including four new character probe boundary cases, terminal exit 0. The related
review-file edit was formatted; the previously failing recursive package format
check now passes. No assertions or diagnostics were disabled.
The completed analyzer's actual footprint was 2453245816 bytes versus 4120870912
RSS. Native run sample: OmO footprint 4759843944, available 8139849728, pressure 1,
swapUsed 3759538176, swapOut 86668214272; safe under unchanged reservations.
Next: real related-detail/UI consumers, authenticated compiled-package workflow,
persistence/restart/cancellation/recovery, visual/native QA and independent review.
No character UI or milestone acceptance is claimed.
`character-graph-package-first.log` then passed all 41 affected plugin tests and
recursive package format checking, terminal exit 0. Character code/radical/
variant, grouped reading/meaning, name and KRAD lookup facts use attributed
unlearnable property entities. Semantic fact/group identities survive source
array reordering; bounded continuations cover a group larger than one property
budget without dropping associations. KRAD representative glyphs never bind a
different character's learner keys; absent component coverage remains explicit.
Run sample: OmO footprint 4737102952, available 8175616000, pressure 1,
swapUsed 3700817920, swapOut 86668214272; safe. Existing Sudachi vendor warnings
remain unsuppressed.

The read-only source-boundary query found `entry/9999999`, followed by
`entry/5748098`. Decoding those exact immutable resource rows showed the former
is `ＪＭｄｉｃｔ`, whose source gloss reports creation date 2026-10-17, not an
ordinary lexical learning item; the latter is the published Aton/Aten entry.
No hardcoded injection of either ID was found in the bounded preparation/package
source search. The creation record currently receives ordinary word capabilities
in the package, a real provenance/learning defect to repair before dependent QA.
Keep it browsable and preserve stored history; do not manufacture lexical
eligibility or remove the source record to conceal the count.
The first before-fix launch failed closed because the old analyzer identity had
changed; no test ran. After fresh ownership inspection, the unchanged regression
proved the defect: `publisher-metadata-before-fix.log`, Cargo 101, 41 passed and
one new Inspector assertion failed. The production fix keeps the same source
identity and record, with an explicit source-metadata kind, no lexical
capabilities/POS/levels, no linguistic graph edges and no review probes.
One shared dictionary-capability policy feeds inspection and graph projection.
Existing stored claims/history are not deleted. Native claims already validate
against the actual inspected target capabilities in `guest.rs`; this is not a
renderer-only restriction.
`publisher-metadata-after-fix.log` passed all 45 affected package tests and
recursive formatting, terminal exit 0, including catalog, graph and probe
boundary regressions. No original assertion was weakened.

`mon_C8TY1YZQG8P0QZ4R`/`bash_1717` ran the serial authenticated package
stage, real native graph compatibility tests, rebuilt QA host and
`character-runtime-qa.mjs` into `character-native-runtime-first.log`.
It retains one Cargo job and runtime-only debug1 with assertions/overflow checks.
The new QA driver is NOT yet verified or run: it consumes the real final source page
then all 13108 compiled character targets, checks bounded real graphs and
unsupported claims, and uses the existing Material/Review owner with pause,
crash/restart, resume and exact submit replay. It explicitly does not certify
whole-catalog persisted preparation, cancellation or UI/platform acceptance.
The isolated profile is `character-runtime-qa-profile` under the retained
execution root; do not erase it or launch a duplicate if resuming.
Latest disk readback: 13610084 KiB available, 97% capacity. No paid provider,
model, device or reference application was launched by this stage.
The stage stopped at the native graph suite: English and undeclared-capability
cases passed, Japanese failed before analysis with `Language package unavailable;
install its compatible version and retry`; Cargo 101, terminal exit 1.
The guard stayed safe (available 6555910144, projected 4408426496), so this is
not a resource-guard stop. The QA host rebuild and new native driver were not
reached. Preserve the failing log and original assertions.

Activation investigation: `Runtime::open` stores bundled rejection messages in
`package_issues` and omits rejected packages from the installed map. The generated
Japanese version is 61 bytes (within 128), code is 2590438 bytes (within 4MiB),
but its lexicon is 137007104 bytes, above the unchanged 128MiB/134217728 per-asset
declaration bound. Manifest validation precedes compilation. Competing identity/
ABI and code-artifact hypotheses do not explain that first failing predicate;
do not change a compatibility/fuel/size limit to make the test green.
The physical index is already WITHOUT ROWID, its candidate scratch table is
dropped and VACUUM runs. Read-only dbstat: payload 130490298, unused 3166340,
resource table 137003008 bytes/33448 pages; schema page 4096. The resource host
uses bounded key/value queries and a BINARY primary key, not physical row IDs.
Next measure a lossless 64KiB-page candidate before changing preparation.
Journaled measurement artifacts: `japanese-index-layout-check.py`,
`japanese-index-pages65536.sqlite` and its execution log under the retained root.
They must compare all ordered key/BLOB bytes and preserve source/input/profiles.
The existing content-addressed 48e95432 resource remains the reference artifact.
`mon_BM8AEHQTQAQ8EAV8`/`bash_1718` now runs that one read-only-source measurement
into `japanese-index-layout-first.log`. It uses the existing 512MiB offline
SQLite estimate, not a reduced native/model budget; the 4GiB reserve is unchanged.
The measurement completed successfully: all 822328 ordered key/BLOB records
retain logical SHA256
`f72db7f82667d6173b8a43ebf26e97050d1f57703d9b952b1e92b17ed382665e`.
The 64KiB-page candidate is 133824512 bytes, below 134217728 by 393216 bytes;
counts remain 218923 dictionary-source entries, 13108 characters and 465834
form indices. Integrity checks passed for both files. No data, codec or limit
was removed or relaxed.
Only after that evidence, normal preparation was changed to select 64KiB pages
before creating its existing table. The host's cache remains bounded in KiB.
`mon_4YCJHNVVX28FGE3X`/`bash_1719` now runs seven source tests, the real normal
offline producer and full logical-equivalence/budget verification into
`character-index-layout-produced-first.log`. Do not treat the experimental copy
as the shipped resource or mark the budget repair complete before this run and
native package admission pass. The original content-addressed file is preserved.
Python IDE diagnostics remain unavailable; no missing server was installed.
The temporary runner's
TypeScript LSP could not find TypeScript in its isolated directory; Node executes
that runner directly. No project diagnostic was suppressed or dependency added.

The normal-producer run completed: seven source tests passed, integrity checks
passed, all822328 ordered key/BLOB rows retained the logical digest above, and
the shipped-source index is133824512 bytes with physical SHA256
`fc6bceb86d715cf2a8805cd51a474f3d75d3f9e11258bff0145d54808b3dffe5`.
Maximum RSS was195952640 bytes for the real producer and54296576 for fixtures.
The signed-bundle/native retest is now registered as
`mon_2GQMT3BTEZ2BWYX0`/`bash_1722`, log
`character-native-runtime-compacted.log`. Its unchanged2GiB/4GiB admission
reported three healthy samples before starting. It restages the normal output,
runs the original graph suite, rebuilds the QA host and then runs the prepared
character driver. No pending result is counted as a pass. The driver's two
unsupported-claim predicates now match the actual `operation_failed` error code.

The compacted signed package passed all3 original native graph cases and the
QA host rebuilt. The first connected driver was guard-stopped after startup.
The preceding admission log also captured OmO footprint14100116584 bytes,
available1758052352 and pressure4 before workload admission; subsequent readings
returned near5.22GB. `vmmap -summary` later reported4.8GiB footprint,14.4GiB peak,
with App-Specific Tag1 dominant. That is allocation-category evidence, not a
causal explanation. The stopped host77437 was confirmed absent.
Eight completed workers and their diagnostics were no longer needed. The
positively identified idle host76226/supervisor76223 and TypeScript tree77302/
77303/77304/77305 were released; an exit race stopped the first cleanup command,
and a subsequent inventory confirmed that whole diagnostic tree absent.
All listed idle-host PIDs were also confirmed absent. Available memory rose
to7263436800, pressure1; OmO footprint5213795432 and swapUsed3995402240 remained
observations, not resolution of the earlier transient spike.

The character workflow then completed all assertions, but Bun's Node HTTP
teardown returned `ERR_SERVER_NOT_RUNNING`. No product assertion was removed.
The isolated driver now uses Node's built-in SQLite and the existing QA harness's
Node runtime; `character-runtime-node-teardown.log` exits0 with clean teardown.
It enumerated all13108 real characters in1093 bounded pages, including475
metadata-only characters, with total232031 dictionary/character entries.
Actual graphs had21 bridge facts over2 pages and72 生 facts over5 pages.
Unsupported publisher/character claims rejected; explicit word and character
Knowledge stayed separate. A linked Material completed both Practice directions,
with exact paused encounter retained across crash/restart and exact submit replay.
No external provider was called. Persisted whole-catalog preparation, cancellation,
UI fidelity and consuming-native acceptance remain unverified by that driver.
All guard samples for the final run stayed safe and the main footprint remained
near5.21GB rather than continuing the earlier growth.

Independent admission audit6c found no defect in the lossless layout repair;
its old-bundle observation preceded the successful restaging above.
Graph audit73 found conflicting repeated entity definitions accepted by the
typed client despite native rejection. The original transport regression now
fails before the repair and passes after it,3/3 cases; structurally equal JSON
with different object member order and identical parallel entities remain valid.
Source diagnostics passed; test-file diagnostics timed out, not a typecheck pass.
Collection audit6d identified stale catalog metadata on all-language Material
queries after package replacement; that concrete repair remains open.
Both M11 briefs returned actual owner/dependency maps: current responses contain
self-report grades, not executed typed/choice validation, and exact target/
capability scope, calibration purpose and accountable expert definitions need
shared native contracts. No M11 product integration has begun.

Workers70/71/72 returned the first GraphDetails, deeper Inspector navigation and
package-kind/grid/list Knowledge increments plus focused tests. Root typecheck,
architecture lint and all14 focused cases passed in `graph-ui-first.log`.
The subsequent ordinary web export was guard-stopped at Metro startup
(available6099828736/projected3952345088); no successful render is claimed.
The installed CLI supports `--max-workers`; the export-only retry
`mon_E1JGB0GFA7DFN5DG`/`bash_1738` limits Metro to one worker and Node heaps512MiB,
retaining the original2GiB reservation and4GiB reserve. Its log is
`/tmp/mlearn-parallel-ulw.M8JsP2/graph-ui-single-export.log`. Do not repeat the
already-passing focused checks merely because export was interrupted.
The one-worker/512MiB-heap export completed successfully (`GRAPH_UI_SINGLE_EXPORT_EXIT0`).
The actual UI host's first admission observer was cancelled while still held;
it had not started catalog preparation or an application. Root took the concrete
native collection defect first rather than overlapping substantial workloads.

The native graph/character checkpoint is committed/pushed as
`0cc16256d186676fc67124e98d535d52fe5f3238`; the first UI increment remains
uncommitted and visually unverified. Exact-source desktop40806767438 passed;
foundation40806767205 and mobile40806767161 remain in progress, observed by
`mon_ACFED8FP4TVRGC19`/`bash_1744`. No workflow variant was launched.
All-language Material revision checking now uses the same installed-package
authority as scoped browsing, evicting only mismatched rebuildable catalogs.
The real compiled-package regression in `collection-revision-before.log` failed
on `target.is_none()` before the repair. `collection-revision-after.log` passes
all4 collection owner cases, including the replacement/reopen flow, preserved
authored Material, independent claim, bulk unavailable-package recovery and
committed-cursor cancellation/resume. Cargo debug1 retains assertions/overflow
checks and one job. Source diagnostics passed; each completed owned analyzer
and its verified helpers were released before compilation, not run alongside it.
The follow-up native host rebuild and full persisted character catalog/UI host
are subscribed as `mon_KEG7M0ZN5JE9SWM7`/`bash_1753`, log
`/tmp/mlearn-parallel-ulw.M8JsP2/graph-repaired-ui-host.log`.
Two further read-only lanes are active: independent first-increment UI semantics
audit83 and concrete package grammar content/validator preparation84. M11 product
integration remains gated; no rendered UI or full-catalog pass is implied.
The repaired native checkpoint is committed/pushed as
`ef2f7e2baa5358fb56f2e7b31b47689d7aa9145c`. Full persisted Japanese preparation
subsequently passed232031 total entries and13108 characters in the retained QA
profile. Real Omowright interaction selected the package's Character kind,
switched Grid/List and searched橋 to one actual result. First desktop Knowledge,
character-grid and graph captures plus a390CSS/DPR3 graph capture were inspected
under `/tmp/mlearn-parallel-ulw.M8JsP2`. Narrow document width stayed390, with
header and Inspector body scroll owners. This is first-render evidence, not
reference parity: raw graph IDs and repeated attribution crowd the detail;
both themes, scrolling/focus and failure states remain open.
Capture browser lifetimes are now bounded to one eval call with finally-close;
cross-cell preparation tabs disappeared and must not be retried unchanged.
The UI host received explicit stop and exited0; native81667 is confirmed absent.

Audit83 found two concrete UI defects: kind controls disappear during a changed
collection query and stay unavailable after collection failure; graph Knowledge
does not refresh after an Inspector claim. The first is now repaired: package-keyed
description loads independently of collection rows and survives query failure.
The initial regression was guard-cancelled; the next attempt deadlocked because
setup page.evaluate returned the pending event Promise. Its confirmed orphaned
test descendants were released. Corrected before-fix regression exited1 with
the kind selector absent; the same case passed after the repair. Typecheck,
ownership lint and one-worker export exited0 in `character-filter-after.log`.
Inspected real native-backed desktop and phone grid captures are
`kind-recovery-desktop-1440.png` and `kind-recovery-phone-grid.png`; the latter is
1170x2532 at390CSS pixels, with no horizontal overflow. Navigation reset an
earlier emulation attempt to1440; `kind-recovery-iphone-14.png` is not phone
evidence. Apply emulation after navigation and verify actual viewport.

The second finding is reproduced in the real native-backed Inspector: Reading
claim changed to unknown in the adjustment while the graph still displayed
claimed known, with unchanged graph text. Capture:
`graph-claim-stale-native-before.png`. A real GraphDetails scenario was added to
the existing Inspector harness. Both automated before-fix attempts were
resource-interrupted after four navigation cases passed; neither is an assertion
failure receipt. The real native workflow is the before-fix evidence. Inspector
now includes native capability/projection revisions in the graph lifetime key.
The resulting five scenarios/six tests, typecheck, lint and one-worker export
all passed in `graph-claim-after.log`; source diagnostics were clean.
The first post-fix native UI run was guard-stopped during character filtering,
before verifying the claim. Native91500 is confirmed absent and the browser
closed in finally. Post-fix native verification is still incomplete.
`mon_PDV1RHRHKTX14T15`/`bash_1781` passed its stricter2560MiB admission,
but the native host92331 was immediately stopped by the original running guard:
OmO footprint12678804608, pressure2, available2976251904, swap5412159488 and
swapOut98674147328. The host had reported ready; no browser was launched and
no post-fix native claim pass is established. Native92331 is confirmed absent.
The original2048MiB guard and4294967296-byte host reserve remain unchanged.
No replacement workload is registered after this recurrent unexplained spike.
About32 seconds later, footprint recovered to5284426880, available8095367168,
pressure1, swap5592252416 and swapOut99030401024. Bounded vmmap showed4.9GiB
current/14.4GiB peak with App-Specific Tag1 dominating. This is not a diagnosis
or a memory fix; native application/model attribution is unsupported.
The recovery question timed out; the maintainer directed continuation on best
judgment without asking it again. Local builds/native hosts/browsers remain
paused. The existing foundation workflow already builds the real Rust QA host
and runs all `tests/web`, so the connected regression is being moved to that
ordinary hosted path without changing workflows or weakening assertions.
`inspector-graph-native-core.spec.ts` uses an isolated profile and genuine
WordNet graph: claim refresh, separate sibling Knowledge, source-preserving
navigation/Return, restart persistence, and bounded desktop/narrow captures.
Its fixture is authored text `run`. Foundation40816503734/web123258705616
passed all140 connected web tests, including this actual native scenario.
Artifact12872912729's source manifest matches8b025be0/tree4061e8bd. All four
light/dark1080/390 captures were decoded and inspected under
`/tmp/mlearn-parallel-ulw.M8JsP2/hosted-graph-8b.4rmPRR`. Required files extracted
successfully, but the extraction command exited1 because optional
`test-results/.last-run.json` was absent; no archive retry is needed.
The hosted verification and claim-refresh repair tasks are closed. Graph UI
presentation remains open: raw IDs and repeated attribution dominate the detail.
The shared footer is intentionally horizontally scrollable with focus reveal;
the screenshots alone do not establish inaccessible clipped controls.
The initial local diagnostics request timed out, not passed. A fresh bounded
resource sample later measured footprint2833642600, available7144652800,
pressure1 and stable historical swap-out99922853888; RSS is diagnostic only.
One targeted macOS Rust-host/browser graph test passed in3.7s after three fresh
stricter admission samples, `mon_RN7BXDF3ZAGTK46Y`/`bash_1797`, retaining the
original running guard. Native binary SHA256:
`95e6b117bac5e33fcd6c7118b25ad59838c46fed00c73c3da4ff6747c7867005`.
Log: `graph-native-macos.log`; captures: `graph-native-macos/`. Desktop light
and narrow dark captures were inspected; all four hosted counterparts were
already inspected. Cleanup inventory found no surviving native/browser/compiler
or analyzer. Post-run footprint2863232104, available7114358784, pressure1,
swap4008837120, swapOut99922853888; a later available7309262848 sample remained
stable. This is a real macOS Rust-host/browser flow, not a Tauri WebKit or mobile
device certification. No broad local suite, rebuild, model or device launch.
The next bounded graph presentation increment adds one source-metadata
disclosure through the existing shared control; its before captures and design
contract are recorded. Its regression is added before production changes.
The initial graph/character UI and these regressions are committed/pushed as
`8b025be0789b9f6f155490288646bcdce1a52616`, with CI explicitly pending,
not milestone acceptance. Scoped staged inspection and diff hygiene passed.
PR45 remains open/draft, headagent/m10-m11 and baseagent/m01.
Exact-source foundation40816503734 and desktop40816503580 passed.
Mobile40816503665 is terminal: Android123259318406 passed; iOS123259319042
failed its original actual-UI step at2026-10-29T05:01:02Z:
`Assertion is false: id: m01-watch, mp4 is not visible`.
The exact failed log is `mobile-ios-8b025be-failed.log` in the current scratch
root. Observer1791 completed; no workflow variant or rerun was launched.
At the earlier8b push stop, OmO footprint4816925824 and available6422822912 produced projected
headroom4275339264 below that reserve. A bounded eval heap reading was26.6MB,
not process-wide accounting or a diagnosis of the4.8GB physical footprint.
Native UI host89485 was explicitly stopped and exited0;
capture browsers closed in finally. Audit84 returned five proposed package-owned grammar
targets/fifteen real task definitions with original examples and bounded
accepted/rejected/unassessed validators, not shipped content or M11 integration.

Graph source disclosure now preserves all native fields behind the existing
shared disclosure Button. Before-fix regression is `graph-sources-before.log`;
`graph-sources-after.log` passes all8 graph presentation cases, typecheck,
ownership lint, one-worker export and the genuine Rust-host/browser scenario
(1 test,3.9s). Final capture framing also passes that full native scenario
(1 test,3.7s), `graph-sources-framed-render.log`. All12 resulting English
light/dark1080/390 top/source/end images were decoded and inspected in
`graph-sources-framed-native-macos/` under the scratch root. No native window,
WebKit or mobile certification is implied.

The prepared Japanese profile was reused without rebuilding its232031-entry/
13108-character catalog. Manual native-backed character grid, graph disclosure,
16->5 pagination, refresh, no invented fact targets and close-focus passed in
Quartz1440, Quartz390/DPR3 and darkQuartz1440. Actual restored focus was the
implicit HTML BUTTON labeled `橋: assessed known`; an earlier probe incorrectly
required an explicit role attribute. The correction changes QA, not product
focus behavior. Capture names are
`character-<theme>-<device>-{grid,graph,sources}.png` in the scratch root.
DarkQuartz390 reached its grid capture but not the subsequent search/graph:
the resource guard stopped the native host, so that case is incomplete.
The isolated character QA profile retains darkQuartz because the failure
prevented end-of-run theme restoration; no live learner profile was changed.
Character detail still exposes technical reading/meaning-group property values
and structured source records in ordinary property content. This is a remaining
presentation issue, not permission to discard those values or infer language
semantics from their labels. Character Capture -> Material -> Review must still
be exercised through reachable UI; selected Word Practice remains M11 scope.

Both owned character browsers closed in finally; native2966 and4899 were
confirmed absent after guards1809/1811 terminated. The second stop measured OmO
footprint5239993472, available6438256640, pressure1, swap5361172480 and
swapOut101593956352; the original2GiB work reservation/4GiB reserve was not
lowered. Post-close footprint5219726464/available6647955456 remained well above
the earlier3.27GB footprint. Bounded `omo-vmmap-after-character-stop.txt` shows
App-Specific Tag1 dominating,4.9GiB current/14.4GiB historical peak. This is
not a diagnosis or an application attribution. The eval kernel shares PID82251
but reports only25.6MB live heap/9.6MB external memory, not process-wide
allocation ownership. Do not resume substantial local verification on that
heap reading or automatically restart the stopped hosts.

The disclosure checkpoint is committed/pushed as
`9a9a10e3ebc1e65e10a346a35c30030a0135f975`. Its ordinary foundation40826963970
and real desktop40826963986 workflows passed. Mobile40826963947 is terminal:
Android123292104240 passed; iOS123292104025 failed at2026-10-29T06:52:37Z,
`Assertion is false: id: m01-watch, mp4 is not visible`. Its exact30101-byte
failed log is `mobile-ios-9a9a10e-failed.log`. Observer1824 completed.
No other workflow was dispatched. Owned preview2637 was verified as
`node tools/serve-web.mjs` in this checkout, then stopped; observer1818
confirmed its exit and no4173 listener. Exports, native artifacts and profiles
remain intact.

The character scenario was committed/pushed as
`f1c7b2eff42b0a5097852180c7e5094b29590304` in the existing native Inspector
web spec, not part of9a or a passing workflow. It uses a fresh genuine
Japanese package/profile, cold catalog preparation, character grid/detail
captures in both themes/widths, Capture -> Material -> scheduled Review,
explicit character target/Material bindings, and pause/crash/restart/resume.
It adds no mocked Knowledge, graph, grading or catalog. Final file diagnostics
were clean. Foundation40833812757 ran it and failed before reaching character
views: the full cold import did not finish before the new test's120-second
deadline. The other140 web cases, Rust, detector and macOS passed.
Windows123315797625 independently failed its final Slate paste with
`Incomplete native theme input`; the editor retained Dark Quartz despite
reported focus and correct clipboard. Preserve `f1-windows-failed.log`;
the retained input discrepancy is not repaired or attributed to this test.
No further visual change has been
made; retain a complete character before set before altering record/qualifier
presentation. Both graph and character tasks remain open.

Releasing the closed browser handles and one kernel garbage collection reduced
the small eval heap, not the unexplained process allocation: final footprint
5214237824, available6403538944, pressure1, swap5092671488 and
swapOut101593956352. This is not a memory repair or admission for another
local workload. Current work continues through source inspection and hosted CI.

The exact f1 trace exposes the primary count timeout at line152; forced native
shutdown15 seconds later masked it. Artifact12880378417 is retained as
`f1-web-inspection.zip`; only the failed context/frame/trace and its SQLite/WAL
were extracted. Read-only inspection found232031 total and51912 committed
targets, cursor `entry/1552970`. Installation took2.8s. This is a progressing
import, not proof of a deadlock or an incorrect total. The existing native
baseline below already records278227ms for218923 Japanese targets: imposing
120 seconds on the complete cold setup was an invalid new test assumption,
not an established product latency requirement.

The repair subscribes to the actual preparation HTTP receipt before clicking,
with a bounded720-second cold-setup deadline and900-second test deadline.
The original exact232031/13108 counts and120-second UI-publication assertion
remain unchanged after that native receipt. The existing foundation web job
allows40 minutes for this new full-corpus setup plus the unchanged suite;
no steps, source/model pins, fuel/memory/data limits or assertions are removed.
Failure cleanup queries the existing native preparation owner, cancels active
work, closes the host and preserves the primary error alongside cleanup errors.
TypeScript diagnostics and native Bun YAML parsing pass; YAML LSP is absent,
and no dependency was installed. The repair is committed/pushed as
`44bc9bd57d213f14d7cae978706ad659c9cd1bb5`. Its ordinary foundation 40841186176
passed all five jobs, including Windows native theme input on this run; the
earlier unexplained Windows failure is not thereby diagnosed or repaired.
The web job 123337684111 passed all 141 cases in 11.3 minutes, including the
genuine character Capture -> Material -> scheduled Review and restart scenario.
The graph/character spec took 6.1 minutes with the full cold preparation.
Exact log `44bc9bd-web.log` and artifact 12883946489 are retained in the existing
scratch root. Only 13 character PNGs were extracted into
`44bc9bd-character-evidence/`; every grid/graph/source capture for both
themes at 1080/390 and the scheduled Review capture was directly decoded/inspected.
Character grid, actual character probe and footer containment are visible.
These are Linux Rust-host/browser results, not mobile or native-window parity.

That complete before set confirms the remaining graph presentation issue:
structured source records and opaque reading/meaning-group qualifiers crowd
the ordinary character facts. The next shared-owner change places structured
entity properties and relation qualifiers under the existing Graph sources
disclosure, retaining scalar entity facts in the ordinary list. It does not
interpret package IDs/labels, remove native data, fabricate a bound target or
add a new protocol/display flag. The existing graph presentation test now covers
scalar facts remaining readable and structured values/qualifiers surviving
expand/collapse unchanged. Both touched TypeScript files have no LSP diagnostics
and diff whitespace checks pass. Local execution remains paused for unexplained
OmO allocation growth; this source change still needs fresh hosted tests/captures.
Character and graph tasks remain open.

The structured-detail increment is committed/pushed as
`4f0c78815c3f005197690686a2b80349c0215265`. Foundation 40844656408 and real
desktop integration 40844656413 passed. Exact web job 123349084514 passed the
extended graph presentation regression, typecheck, ownership lint, export and
all 141 web cases in 14.8 minutes. The graph/character spec took 8.1 minutes.
Its exact log is `4f0c788-web.log`; artifact 12884819393 is retained as
`4f0c788-web-inspection.zip`. All 25 extracted English/character PNGs were
directly decoded and inspected under `4f0c788-graph-evidence/`.
Both themes at 1080/390 show the scalar English definitions preserved, technical
character records absent from the ordinary facts, source disclosure available,
bounded Inspector header/footer, related-target actions and native page controls.
The character Review frame still presents the actual character probe.
The full native-backed tests also verify separate sibling claims, source-bound
Material, deeper navigation/Return focus, character Capture -> Material -> Review,
and native crash/restart/resume. These close the three implementation tasks as
verified_for_continuation. M10 real-platform QA and independent review remain
open. Mobile 40844656393 is terminal: Android job 123349084519 passed; iOS job
123349084310 failed its original Watch flow at 2026-10-29T09:22:31Z:
`Element not found: Text matching regex: Open local video, Enabled`.
The authored H.264/AAC fixture exported successfully before this failure.
Exact failed-step log `mobile-4f0c788-failed.log` is retained in the existing
scratch root. This matches a previously retained failure surface, not a diagnosis
of its cause or a passing iOS gate. Observer 1869 completed; no rerun, variant or
cancellation was requested.

NAV-02 trace: the root is currently a Stack. Home pushes new Knowledge/Material
screens; Knowledge and Material push one another, while their Home actions
replace the current route. Collection query/filter/layout/paging lives in each
screen instance. This leaves route restoration unverified and can recreate
collection presentation rather than revisit it. Inspect the pinned router's
route identity and existing activity focus/persistence owners before changing
the shell; do not introduce another domain store. A bounded read-only lifetime
audit returned: Reader already releases source/OCR/viewports on blur, whereas
Watch media, Review audio and Messenger polling do not all have equivalent
focus-scoped lifetimes. Keep those activity workspaces outside any preserved
management-tab boundary. This is caller-source evidence, not observed background
playback or a new activity-lifecycle implementation.
No navigation implementation has changed yet. The existing genuine Knowledge
scenario now records unsubmitted search drafts before and after
Knowledge/Material/Home switching, with four baseline captures and a bounded
`navigation-baseline.json` receipt. It preserves all existing assertions and
does not assert or claim that restoration works. Retrieve that ordinary hosted
baseline before repairing the route boundary and adding restoration assertions.
The diagnostic file has no LSP diagnostics and diff whitespace checks pass.
No local execution was launched. A bounded post-inspection native sample reported
OmO PID 82251 RSS 8743344 KiB, rounded physical footprint 3.7G (historical peak
14.4G), pressure 1 and swap used 4041.19 MiB. This lower current footprint does
not establish a diagnosis or admission for substantial workloads.

Exact `32f9b18641ba3520caa60f55ec8f0b834252dd84` foundation 40849011822 is
terminal: web 123363527117, Rust, detector and macOS passed; Windows
123366120536 failed its original native-theme input check. At
2026-10-29T09:37:41Z it reported `Incomplete native theme input` while restoring
Quartz: the editor retained Dark Quartz despite reported keyboard focus and
correct clipboard. The exact `32f9b18-failed.log` is retained. This is another
observed input failure, not a diagnosed cause, a product repair or a passing
Windows gate.

Web artifact 12888190121 is retained as `32f9b18-web-inspection.zip`. All four
navigation PNGs were selectively extracted and directly inspected under
`32f9b18-navigation-evidence/`: the original unsubmitted Material/Knowledge
searches are visible before navigation and blank after revisiting. The after
frames also show collection loading; they prove the lost local input, not a
completed refreshed result. Successful traces and in-memory JSON attachments
were not present in the uploaded artifact. Do not invent that missing receipt.

The repair moves only Home/Knowledge/Material into a lazy management Tabs
group with no added visible tab bar, retaining the root Stack and existing
RuntimeProvider. Their existing controls now navigate to those stable routes.
Reader/Watch/Review/Messenger/Settings remain outside that preserved subtree.
No domain cache, settings persistence or new resource owner was added.
The real Knowledge scenario now asserts search draft restoration after switching
and Home, plus unchanged sort/grid/cursor and bounded target membership at
1080/390. It writes its bounded JSON receipt into the uploaded test-results
directory, alongside eight fresh captures. Explicit package/source parameter
changes and repeated Material entry still require verification before NAV-02
closure; neither is inferred from draft preservation.
Local route declarations initially lacked Knowledge and were stale. They were
regenerated through Expo CLI's own `setupTypedRoutes` owner, without Metro,
a server, dependency installation or hand edits to generated types. The
generator exited 0, and all eight touched TypeScript files have no LSP
diagnostics. No fresh application render or hosted execution is claimed yet.

Exact `191726ce6e5020b0724501bcab0e5cabad136bf6` foundation 40853931224 is
terminal with web job 123380049070 failing one original regression:
`material-proposal-native-core.spec.ts:322` expected the accepted replacement
meaning but read the old editor's empty meaning. The other 140 web cases passed
in 11.7 minutes, including the new real navigation restoration assertions and
the graph/character scenarios. Rust, detector and both foundation desktop jobs
passed; real desktop integration 40853931257 also passed. Mobile 40853931366
is terminal: Android 123380049624 passed; iOS 123380049746 failed its original
Watch flow at 2026-10-29T10:31:28Z:
`Element not found: Text matching regex: Open local video, Enabled`.
The authored H.264/AAC fixture exported first. Exact failed-step log
`mobile-191726c-failed.log` is retained. Observer 1891 completed; this result
does not certify or diagnose the separately pending `486c507` repair.

Retained `191726c-failed.log`, artifact 12888724571 as
`191726c-web-inspection.zip`, and selectively extracted the eight navigation
PNGs/JSON receipt plus the original failed Material frame/context/trace under
`191726c-navigation-evidence/`. All nine PNGs were directly inspected.
The navigation receipt confirms both drafts at both widths, with the original
assertions also checking sort/grid/cursor and the same bounded 24 target IDs.
The failed frame has the accepted meaning on the saved card while the editor
still holds its earlier content. Bounded trace metadata and selected JSON blobs
under `191726c-material-trace/` show the initial Material read returning revision
1, the native proposal receipt committing revision 2, and no new native read
after the explicit Open saved Material click.

The preserved screen's opened-ID guard no longer implies that a same-ID
navigation is a request to reload its committed content. The repair makes
MaterialProposalReview delegate explicit saved/existing entry opening to its
actual caller: MaterialScreen uses its existing native `open` owner directly;
SourceActions uses its router boundary. No copy of loading/retry/editor state,
new native store, route nonce or automatic replacement of unsaved drafts was
added. The original failing assertions remain unchanged. That same regression
now additionally checks an unsaved editor draft surviving ordinary tab switching
and captures explicit revision reload at 1080/390.
Three touched files have clean LSP diagnostics; MaterialProposalReview's fresh
diagnostics timed out twice and are not counted as passing. Full diff/whitespace
checks pass. Fresh hosted typecheck, the original regression and after captures
are still required; NAV-02 remains in progress.

Exact repair `486c50766d65fd90a2f7cc47e2c9ce47b916df9c` foundation
40857907374 passed all five jobs, including typecheck/lint and all 141 web
cases in 17.9 minutes (web 123393458599). This includes the unchanged original
accepted-replacement assertions, the added unsaved-editor tab switch and native
revision 2 check. Real desktop integration 40857907413 passed. Mobile
40857907407 is terminal: Android 123394753785 passed; iOS 123394753531 failed
its original Watch flow at 2026-10-29T11:24:45Z:
`Assertion is false: id: m01-watch, mp4 is not visible`.
The authored H.264/AAC fixture exported first. This is a different assertion
from the earlier enabled-button lookup, not proof of its cause or repair.
Retained exact `mobile-486c507-failed.log`; observers 1902/1915 completed.
No diagnostic rerun or new variant was launched; iOS acceptance remains open.
Retained `486c507-web.log` and artifact 12891592225 as
`486c507-web-inspection.zip`. Selectively extracted and directly inspected all
11 relevant PNGs: eight draft/navigation before/after frames, explicit saved
revision editors at 1080/390, and the existing source-return recovery frame.
Both explicit editors contain the accepted meaning, the drafts/order/grid/page
remain intact, and recovery feedback remains beside its action. These captures
are Linux Rust-host/browser evidence, not native-window or mobile parity.
The durable JSON receipt retains exact draft values at both widths. Hosted
typecheck also supplies the missing compilation check after the earlier local
LSP freshness timeout.

The next source-preserving baseline extends only the two existing real Knowledge
scenarios: reopen the same saved target through Inspector's existing-Material
action after closing its editor; and enter an already-mounted Knowledge route
with a different real package selected on Home. It subscribes to collection
receipts before navigation, waits for owning pending state, and writes PNG/JSON
observations without claiming these new paths work or weakening any original
assertion. The source-scope probe installs the existing pinned Japanese package
but does not prepare another Japanese catalog. No product source changes until
these observations have been read. The edited test has clean LSP diagnostics
and whitespace checks. Its ordinary push affects foundation only; desktop/mobile
workflow paths exclude this web-test-only change.

Small capture batches recorded OmO footprint 3.8G before / 4.0G after, pressure
level 1 throughout, RSS 9179312 / 7993712 KiB and swap 4678.25 / 4518.25 MiB.
Peak footprint remains 14.4G. This does not diagnose the allocation or admit
local app/browser/device/build workloads; none were restarted.

Baseline `b6e42a18d18271404ae4deb15be157e6c288fab3` foundation 40863487839
is terminal: Rust, detector and both desktop jobs passed; web 123412296832
reported 140 passed in 18.2 minutes and one failed scope probe. Its new selector
waited for literal `Japanese` at line 305, but the actual installed option is
`Japanese · 日本語`. This is a test error, not evidence of a package-navigation
failure; no scope JSON was produced. Retained `b6e42a1-failed.log`, artifact
12893717769 as `b6e42a1-web-inspection.zip`, and the selectively extracted
context, failed frame and completed closed-editor PNG/JSON under
`b6e42a1-navigation-evidence/`. Both PNGs were directly inspected.

The completed same-ID receipt has `editorVisible: false` on a Material URL
containing the exact saved ID, after its collection receipt and enabled Edit
control. The frame shows its saved card but no editor. Closing had left both
the opened-ID guard and selected route ID behind. The repair clears those two
pieces of presentation state when the user closes the editor; it does not
reload on every focus, change saved content or discard an open draft on ordinary
navigation. The former diagnostic is now a real regression asserting the
reopened editor and exact phrase at 1080/390, with fresh captures/receipts.
The scope probe now selects Home options by the existing authoritative package
test IDs instead of guessing their labels. Its diagnostic status is unchanged;
no Knowledge/package-scope product repair is claimed.

Both touched TypeScript files have clean LSP diagnostics and the full code diff
and whitespace check pass. Fresh hosted execution and after captures remain
required before another presentation-source change. No timeout, original
assertion, resource limit or model pin was relaxed.

Exact `8d3ccd3e56e3634eada7c630865456de071a2242` foundation 40867693534
failed web 123426520043 with 140 passed in 12.9 minutes. The unchanged
closed-editor regression reached `Edit able` still busy after its 5-second
assertion budget. Rust, detector, both foundation desktop jobs and real desktop
40867693509 passed. Mobile 40867693648 is terminal: Android 123426521430
passed; iOS 123426521162 failed its original Watch flow at
2026-10-29T12:40:40Z:
`Element not found: Id matching regex: DOC.sidebar.item.On My iPhone`.
The authored H.264/AAC fixture exported first. Retained exact
`mobile-8d3ccd3-failed.log`; observers 1923/1947 completed. This is distinct
from the preceding file-row and enabled-button assertions; no cause or repair
is inferred, and no diagnostic rerun or variant was launched.
Retained `8d3ccd3-failed.log`, artifact 12895437499 as
`8d3ccd3-web-inspection.zip`, and selectively extracted three PNGs, scope JSON,
failure context and failing trace under `8d3ccd3-navigation-evidence/`.
All three frames were directly inspected.

The scope receipt now proves a real mismatch: requested/URL package
`org.mlearn.japanese`, but the completed native Knowledge query and selector
remain English. Returning with explicit English remains English. The Material
trace's final native read returned the correct saved revision in 2.29ms,
before collection (3.761ms) and snapshot (2.907ms), yet Opening Material remains
after the assertion. Read bounded final network records and six selected blobs
under `8d3ccd3-reentry-trace/`; this is not evidence of slow native loading.
Installed useFocusEffect can run a changed callback immediately for an already
focused route, independently of existing focus listeners. The owner-ref value
was not instrumented; do not claim that scalar was directly observed.

The candidate combines Material focus-scope admission and explicit route
opening in the same existing callback, retaining cleanup and stale-publication
guards. Knowledge applies a changed explicit package only once, clears its
package-bound filter/cursor, and reflects a local language choice in route
parameters so later explicit Home entry cannot retain the wrong selection.
Unchanged scope does not reset drafts, order, layout or cursor. No second native
owner, route nonce, navigation store or new dependency was introduced.
The scope regression now awaits the exact requested native package, checks its
authoritative installed label at both widths, and returns from a local picker
change through Home. The earlier closed-editor assertions are unchanged.

Both product files have clean LSP diagnostics. The test was clean before the
literal-dot URL-regex correction; fresh diagnostics then timed out twice and
are not claimed as passing. Full diff/whitespace checks pass. Fresh hosted
typecheck, original regressions and captures remain required; no native/read
timeout, model pin or original assertion was relaxed.

`d15558aa952a66512049a5eddd831f66e6ac936b` real desktop integration
40872207601 / native 123441851191 failed with a raw
`DOMException [TimeoutError]: The operation was aborted due to timeout`.
Retained `d15558a-desktop-failed.log` and artifact 12896731842 as
`d15558a-native-desktop.zip`. Its archived source receipt matches that commit
and tree `bb1fe95303bbef7eca5a5d7da964f47a71fd757d`. Selectively recovered the
failure frame, media/geometry receipts and two exact driver files. The frame
was directly inspected: raw Japanese caption with an explicit incompatible
English-analysis message. Video is readyState 4, paused at 20/30 seconds, with
no media error. Portal/audio warnings do not establish the failure's cause.
The lost awaited operation remains unresolved; foundation 40872207253 and
mobile 40872207514 remain independently watched by 1933.

The driver's existing transport wrapper awaited the response body outside its
catch, allowing a body-read timeout to lose the request identity. Added one
actual-Response/errored-stream case to its existing script owner suite. Before
the fix, the single mocked test failed on
`assert.ok(error instanceof WebDriverTransportError)` (140.7ms process).
After moving the body read into the same catch, the full six-test owner suite
passed once in 129.9ms, preserving method/endpoint/cause and no replay; native
protocol errors remain distinct. The 30-second RPC deadline and original
native scenarios are unchanged. This repairs diagnostics, not desktop acceptance.
Only this small mocked Node test process ran locally; no app, browser, device,
build or inference workload was started. Both edited JavaScript files' fresh
LSP diagnostics timed out and are not counted as passing. Full diff/whitespace
checks pass; hosted lint and the real failing workflow remain required.
No product UI source changed after d15558aa.

The d15558aa web failure is now narrowed: Material re-entry passes at 1080/390,
both changed-package entries match the actual requested native package and
installed label, and the eight draft/sort/grid/page frames remain intact. The
final local-picker/Home return shows `Native request queue is full; retry the
action.` before its English collection dispatch. The guard is the unchanged
eight-slot admission in `packages/runtime-client/src/client.ts:79`.
Bounded final trace reads show a 702.941ms Japanese describe followed by queued
Japanese collection, Home snapshot/recent-source/recent-document reads executing
after Home blur, then Knowledge snapshot/selection reads. Admitted requests
drain, but the rejected foreground collection has no receipt to await. The
test's 30-second timeout is not evidence of a slow collection or installation.

Directly inspected 14 current relevant frames in batches of one/two: two
reopened editors, two correct package scopes, eight retention comparisons,
the native Home preimage and the queue-failure frame. Durable re-entry and
navigation JSON receipts were read. The first two scope receipts were previously
lost because their write followed the final failing step.
OmO footprint stayed 4.8G before/after this batch (peak 14.4G), pressure 1;
RSS 5510032/5723344 KiB, swap 3860.75/3812.75 MiB. No substantial local
verification was admitted; the allocation remains undiagnosed.

The Home candidate retains its existing focus lease but admits its three reads
sequentially, checking that lease between reads. The shared client already
serializes them; pre-admitting off-screen follow-ups was filling its bounded
queue. No admission limit, retry, new store or UI delay was added.
The original scope-return assertions remain, now with a held real Home snapshot
receipt to make blur/admission ordering deliberate rather than dependent on
package execution speed. Request events must show no off-screen recent-source
or recent-document follow-up; the foreground scope must still complete. Gates
are subscribed before input and released in cleanup, with no sleeps. First-two
scope receipts are persisted before the last step and its successful receipt
is appended only after assertions. Home LSP diagnostics are clean; the test's
fresh diagnostics timed out and are not counted as passing. Full code diff and
whitespace checks pass; hosted execution and fresh captures remain required.

The diagnostic-only a571cb87 real desktop run 40874832765 passed; it does not
explain or erase the earlier d15558aa timeout on identical UI/deadlines. Its
foundation 40874832751 failed web 123453596679 in the same final scope-return
response wait at line 344 (140 passed, 17.8 minutes); the other four jobs passed.
Retained `a571cb8-foundation-failed.log`; observer 1957 completed. Its UI and
scope-test source match d15558aa, so no duplicate 258MB capture download was
needed for the same observed failure.
No iOS variant or unchanged native rerun was launched. After this repair's
evidence, active-workspace return and explicit source-parameter preservation
still need verification before closing NAV-02.

Home repair `84a02fa38e7cb238f1625d227f10d51025068b49` passed foundation
40880351787: web123469888829 reports 141 passed in18.5minutes, including the
held real Home snapshot regression with zero off-screen recent-read requests.
Unit tests, typecheck, lint, web build, Rust/contracts, detector and both
desktop build/OCR jobs passed. Real desktop integration40880351909 also passed.
Mobile40880351754 is terminal: Android123478764447 passed; iOS123478763651
failed at14:05:30Z with `Element not found: Text matching regex: Open local
video, Enabled`. Authored H.264/AAC fixture export succeeded at14:00:11Z.
Retained `mobile-84a02fa-failed.log` in the scratch root. This is the original
actual-UI gate, not a fixture-export failure or proof of a navigation cause.
No diagnostic variant, unchanged native rerun or platform-parity claim is made.
Artifact12901586854 is retained as `84a02fa-web-inspection.zip` under the
existing scratch root; the passing web log is `84a02fa-web.log`.

Directly inspected all15 relevant fresh PNGs, one/two per batch: eight
Knowledge/Material draft and page-restoration comparisons, two reopened saved
editors, two accepted-replacement editors, two explicit-package entries and the
formerly failing narrow Home-after-local-choice return. No blank or overlapping
navigation output appeared. Existing long English grid-word wrapping remains,
not a new visual-conformity claim. Read all three structured receipts:
both reopened editors are visible, both widths retain the unsubmitted drafts,
and all three requested packages match the native collection query and selector.
The last receipt is English after a local Japanese choice and explicit Home
return; the former queue error is absent. Extracted evidence is
`84a02fa-navigation-evidence/test-results/` in the same scratch root.
OmO PID82251 footprint3965/3528MB before/after the image batch, historical
peak14GB, pressure1, RSS9174752/8646048KiB and swap3825.56/3785.50MiB.
The lower current footprint does not explain prior growth. No local app,
browser, device, server, model or substantial verification workload was launched.
This closes the demonstrated Home admission regression, not NAV-02 or M10.

The next source-only probe extends the existing genuine Knowledge workflow,
without changing presentation or routing: open the real continuity document
through Home, save its Reader checkpoint, return through Reader's Home action,
then assert the retained Knowledge draft/order/grid/exact24-item page and Material
draft at1080/390. Actual checkpoint and return-state receipts are written before
the restoration assertions, with fresh Reader/return captures. This baseline is
unrun; it must establish the activity boundary before any return-control repair.
No local browser/build/device run is admitted for it. Hosted typecheck and the
connected scenario remain required; prior test-file LSP timeouts are not passes.
The source-only baseline is committed/pushed as
`9486370f695d4ba570d33a90f96cb60cee3f1609`; ordinary foundation40885194660
failed web123486904256: 140 passed in11.7minutes, with the new original
activity-return assertion receiving an empty Knowledge draft atline264.
Rust/detector/both desktop build/OCR jobs passed. Its full-SHA observer1978
replaced the short-SHA observer1976;
only the subscription changed, with no workload restart.

Read the actual return JSON and directly inspected both available fresh frames
from artifact12903048105 (`9486370-web-inspection.zip`, selectively extracted
to `9486370-activity-evidence/`). Reader showed the real continuity document;
its saved/resumed parser/resource/block/offset checkpoint matched exactly.
Knowledge after Reader return showed an empty search, Package order and List,
not the prior draft, descending order, Grid or non-first page. The source
checkpoint survived; management presentation was replaced. This is a reproduced
navigation defect, not a timing hypothesis.

The installed router's REPLACE action creates/replaces the current route;
POP_TO instead keeps the matching earlier route key and removes routes above
it, falling back to replacement only when that destination is absent.
Reader's existing checkpointing Home action now uses `router.dismissTo('/')`,
which delegates to that existing POP_TO owner. Its persistence/error behavior,
workspace cleanup and direct-entry fallback remain unchanged. No new navigation
store, cache or activity-retention owner was added. Other audited return controls
remain unmodified until their connected evidence is obtained.
The same unchanged activity-return assertions and fresh1080/390 captures must
verify this candidate before another presentation-source edit. No passing
runtime result or native workflow is claimed for it yet.
Reader's fresh LSP diagnostics and diff/whitespace checks are clean.
Current OmO footprint3682MB, historical peak14GB, RSS8274352KiB, pressure1,
swap4996.19MiB; no substantial local workload was admitted. Swap growth remains
unexplained and is not attributed to an app/device/model.

Reader repair `38b303c26be642cce4f99b27564a12dc6bad7546` passed
foundation40889446715: web123501935901 reports141 passed in11.4minutes;
the other four foundation jobs and real desktop40889446716 passed.
Mobile40889446765 is terminal: Android123501935053 passed; iOS123501935467
failed at14:46:06Z with `Element not found: Text matching regex: Open local
video, Enabled`, after authored fixture export succeeded at14:40:38Z.
Retained `mobile-38b303c-failed.log`; no diagnostic variant or unchanged rerun
was launched. This preserves the unresolved platform gate, not a Reader cause.
Exact web log `38b303c-web.log` and
artifact12905646121 (`38b303c-web-inspection.zip`) are retained. Selectively
extracted all four new Reader/return PNGs and `navigation-activity-return.json`
to `38b303c-activity-evidence/`. Directly inspected both widths: the source
remains readable and the returned Knowledge draft/descending order/Grid/page
remain intact without blank or overlapping controls. The unchanged test also
asserts the same24 target identities and Material draft. Both native
saved/resumed document checkpoints match exactly. This is the regression's
red/green connected evidence, not completion of other activity/source routes.
Pre-image-batch OmO footprint3041MB, peak14GB, RSS9155280KiB,
pressure1, swap4764.19MiB; no substantial local workload was started.

The next source-only baseline extends that same real workflow through Reader
Inspector's existing Capture/Open saved action. It checks the actual document
source ID, saved Material anchor and native source-filter query, then returns
to Knowledge/Material and asserts their retained unsubmitted drafts at1080/390.
Native receipts and source-editor/return captures are recorded before the draft
assertions. No route producer or Material scope owner is changed by this probe.
Its runtime result remains unverified; fresh hosted evidence must precede repair.
Fresh test-file LSP diagnostics and diff/whitespace checks are clean.
Post-batch OmO footprint3461MB, peak14GB, RSS7474976KiB, pressure1,
swap4756.19MiB. No local application or substantial verification was started.
The source-only probe is committed/pushed as
`f43440cbea5e907e06293d6050e6c8885bf7e851`; foundation40893592752 is
terminal: web123516588708 failed atline315, expected the retained Knowledge
draft and received empty;140 cases passed in12.3minutes. The other four jobs
passed. Its source-entry receipt proves the saved Children Material anchor
and first native source filter are correct; subsequent Knowledge presentation
was replaced. Directly inspected both actual1080 frames from artifact12906698513
under `/tmp/mlearn-orchestration.JNbU5h/f43440c-source-evidence/`, with the
exact failed log and original artifact retained in that owned root.

Inspector's saved-Material entry now uses existing `dismissTo('/materials')`
with its exact id/sourceId rather than pushing another management subtree.
Material's source-only preference defaults on even if the retained screen
first mounted without a source; no filter is added without an actual sourceId,
and explicit user toggling remains retained. The existing source-only query
guard is unchanged. No new store, route nonce, limit or deadline was introduced.
Both edited files have clean fresh LSP diagnostics. The unchanged real regression
and fresh1080/390 frames must verify this candidate before another UI edit;
no runtime pass is claimed yet.

### Asynchronous engineering ready queue — 2026-10-29

The maintainer explicitly corrected CI-induced global stalls. Root continues
independent engineering whenever only a dependent verification is pending.
Current HEAVY execution notepad:
`/var/folders/f2/d3_jzj917kg6sqsc9tgc80200000gn/T/ulw-orchestration-20261029.XXXXXX.md.DBKdm39MMr`.
Four independent source-only/report lanes were launched beside root navigation
work: graph/Knowledge audit1882e, persistence audit1882f, M11 contract/fixture
prerequisites18830 and activity-lifetime audit18831. None watches CI or launches
local compilers/devices. M11 product integration remains gated on M10.
Persistence audit returned two concrete client/native bounds mismatches, not
executed failures: byte-bounded native extension maps versus client32-key cap,
and frozen-selection64-row output versus its131072-byte consumer limit.
Root will verify/reproduce each in its existing owner suite before repair.
Reports and exact lane receipts are under `/tmp/mlearn-orchestration.JNbU5h/reports/`.

An isolated Messenger regression lane is preparing one disjoint existing test.
Automatic isolation failed on an invalid ignored legacy cache `.git` file;
no cache was edited. A detached source-only worktree at
`/tmp/mlearn-orchestration.JNbU5h/messenger-worktree` was created at exactf43440cb
instead, with explicit ownership and no shared branch edits. Root retains all
product/navigation/STATE commits and serial workload admission. PR45 readback is
OPEN/DRAFT, headagent/m10-m11, baseagent/m01; PR44 remains preserved/unmerged.

While exact913b5b86 hosted verification is pending, the first independent owner
repair is reproduced and locally verified. Native catalog admission bounds the
whole target to16384 encoded bytes and validates namespaced keys; it has no32-key
limit. The typed client incorrectly imposed that extra limit, making an admitted
33-field target unreadable. Extended the existing collection-page owner test with
33 small namespaced fields and retained malformed/oversized rejection.
Before: `./node_modules/.bin/tsx --test --test-name-pattern='collection pages retain native counts' packages/runtime-client/tests/collection.test.ts`
failed1/1 with `RuntimeError: Malformed bounded collection` atline218, codeprotocol,
277.55ms process. Removed only the client key-count restriction; encoded byte and
namespace checks remain. After:
`./node_modules/.bin/tsx --test packages/runtime-client/tests/collection.test.ts`
passed6/6, zero skipped/cancelled,197.79ms. Both touched files have clean fresh
LSP diagnostics and full diff/whitespace review. No app/browser/server/build/
model/device workload ran. Logs are `catalog-extensions-before.log` and
`catalog-extensions-after.log` under the orchestration root. Native33-field
reopen coverage and frozen-selection byte paging are being prepared in the
separate selection-worktree; no native runtime result is claimed for that lane.

Graph review returned an operation-lifetime finding: Stop rejects display
receipts but leaves graph/evidence work in the shared two-read admission pool.
Activity review also requires awaiting Reader/Watch persistence before dismissing
their local checkpoint recovery owners, and identifies Review audio-departure,
remaining Home/unavailable recovery and hidden polling/playback scenarios.
These are registered ready tasks, not passing runtime findings or acceptance.
Root will reproduce them in their actual existing suites. M11 preparation remains
independent and product integration remains gated. Current expanded ledger adds20
ready-work/cleanup units to the original125:75 completed,1 dropped,69 open of145.

The frozen-selection omission is now reproduced and repaired, independently of
pending913b5b86 CI. Applied the isolated worker's tests before its owner change.
`CARGO_BUILD_JOBS=1 cargo test --locked -p mlearn-storage --test collection frozen_selection_pages_budget_escaped_revision_bytes_without_skipping_entries -- --exact`
failed the actual serialized-page131072-byte assertion atline370 after real
65-Material freeze/reopen (1.60s build,0.10s test). The owner now admits an encoded
prefix within the unchanged byte/64-row limits, including cursor overhead,
retaining the preceding accepted identity when deferring the next row.
No frozen data, selection identity, revision or transaction behavior changed.
The full existing collection suite then passed22/22, zero ignored/filtered,
0.50s after3.83s build. This includes the new native33-field catalog/reopen case
and all prior membership/replay/filter/migration cases.
Both Rust files' diagnostics and full diff/whitespace checks are clean.
Automatic tool formatting also normalized existing assertion/import layout;
no original assertion was removed or weakened. Logs:
`selection-owner-before.log`, `selection-owner-after.log` in the orchestration root.

One local Cargo job was deliberately admitted only after the original three
fresh2560MiB samples passed with4GiB reserve, then guarded at2048MiB.
The completed owned Rust diagnostics trees70032/70077/70078 and
70949/70993/70994 were identified by parent/cwd and released before each build;
no unrelated process was touched. Both running guards were stopped when their
test exited. Post-run process readback showed no Cargo/rustc/analyzer.
OmO physical5267486160, available8348598272, pressure1, swap6265241600;
growth remains undiagnosed, not attributed to app/device/model. Original limits
and resource policy were not relaxed.

All initial independent audits and M11 prerequisites have returned. Root read
and parsed both scratch JSON files with explicit full ranges:5 topics,15 tasks,
40 response cases,26 unique native scenarios, disjoint finite accepted/rejected
sets. Files are `reports/m11-prerequisites.md`, `m11-grammar-vectors.json` and
`m11-session-vectors.json` under the orchestration root. These are concrete
future package/native fixtures, not registered targets, executed validators,
approved content distribution or an accepted calibration policy. M11 integration
remains gated. Messenger regression source is integrated with clean diagnostics
but runtime UNRUN. Review audio source/test patches returned in their separate
checkout and await root reproduction/integration; operation-scoped bounded-read
cancellation design is actively being narrowed against actual native admission.
READY work continues; pending CI blocks only its dependent render/evidence step.

The independent audio owner regression is also reproduced and repaired:
`./node_modules/.bin/tsx --test --test-name-pattern='repeated cancellation awaits' tests/client/review-media.test.ts`
failed1/1 with `true !== false` atline122 after447.65ms: a second cancellation
returned before the already-admitted interruption write acknowledged.
The finish owner now awaits its existing writes promise when already terminal;
it neither queues another write nor admits another player/event.
The event-gated test releases/joins both promises in finally.
Both files have clean diagnostics. The intended narrow green filter
`--test-name-pattern='^(?!ReviewAudio )'` unexpectedly selected all11 existing/
new cases, including the authored-audio browser integration; actual output is
11passed,0failed,0skipped in1908.14ms, not10 browser-free cases. The browser
closed in the existing finally, and process readback found no browser/compiler
remnants. Post samplephysical5258229200, available6962823168, pressure1,
swap6223298560. Logs: `review-audio-owner-before.log` and
`review-audio-owner-after.log`. This proves only the acknowledgement sub-contract;
actual Review Home/encounter persistence UI changes remain unintegrated/unrun.

Source913b5b86 foundation40898847160 failed web123535286965 with139 passed
in18.1minutes. Its new dismiss action broke both original source-free Knowledge
and character Inspector -> Material entries: Edit Material was missing at
knowledge-native-core:157 and inspector-graph-native-core:233. Directly inspected
both actual failed frames plus context from artifact12909662882; both remain on
Knowledge after Inspector closes. Existing assertions and timeouts are retained.
Other foundation jobs and real desktop40898847553 passed; mobile40898847133
remains pending. This regression is root's route change, not an invalid test.
Exact log/artifact/selected frames are retained under the orchestration root.

Verified owner incrementse5ff77b8/bf23f7cc are pushed. Their ordinary runs are
foundation40903381345, desktop40903381336 (passed), mobile40903381341 (pending).
They preserve the same still-failing UI input while checking genuinely changed
client/storage owners; no unchanged workflow was manually rerun or dispatched.
The next navigation checkpoint must repair the current-Tab versus root-Stack
action boundary and obtain fresh captures. Root is not waiting on native jobs.

The next minimal Inspector correction preserves the two actual route owners:
source-free Knowledge/character inspection navigates to the sibling management
tab, while a source-bearing activity returns to the prior management Stack
destination with its exact source/id. POP_TO is not sent to the current Tab
navigator. This keeps the original source-free paths and the deliberate
source-entry reuse; no route nonce/store or dependency was added.
Fresh Inspector diagnostics are clean; the original failing assertions remain.
Hosted execution/captures are required, not claimed. Separate checkpoint-save
failure gating remains a registered open task and is not covered by this change.

Read-only return-control audit found Reader and Messenger Home actions replacing
the root route, while Watch has a distinct back/fallback path. Their persisted
management state and explicit source parameters still need real workflow
verification; no change to those callers or claim of equivalence was made.

A single source-only audit returned concrete redundant JSON conversion and
statement-preparation opportunities, but no measured speedup. No speculative
Rust optimization or fuel/batch change was applied. The newly added throughput
task was dropped after recovering the earlier timing evidence, not marked as a
product repair. Native resource and cancellation assertions remain requirements.

Exact0cc foundation40806767205 passed. Latest ef2 desktop40807702149 failed
at `tests/desktop/native-smoke.mjs:614`: Shift-assisted pointer-entry
`entry.trusted` expectedtrue but receivedundefined with `{"timedOut":true}`.
The exact log is `desktop-ef2-failed.log`; the key event had passed and the
pointer entry did not arrive. Cause remains unestablished. Preserve its assertions
and native-input discrepancy rather than calling it a catalog regression or
changing unrelated tests. Latest ef2 foundation40807702124 is in progress and
mobile40807702147 pending, watched by `mon_8S7QTFZFRTFVFDM2`/`bash_1757`.
Exact0cc mobile40806767161 is now terminal: Android123227475709 passed;
iOS123227475469 failed its actual UI flow at2026-10-29T03:24:38Z,
`Element not found: Text matching regex: Open local video, Enabled`.
The exact failed log is `mobile-ios-0cc-failed.log`; this remains an unresolved
native Watch workflow failure, not an M10 character pass or a proven catalog
regression. The0cc observer completed. Exact ef2 foundation40807702124 passed.
Its mobile40807702147 is now terminal: Android123244268145 passed;
iOS123244267916 failed at2026-10-29T04:14:44Z,
`Assertion is false: id: m01-watch, mp4 is not visible`.
Exact log: `mobile-ios-ef2-failed.log`. Preserve this unresolved native Watch
workflow failure; it is not a passing platform gate or an established graph
defect. Replacement observer1784 completed; no workflow was rerun.

Temporary project LSP settings did not reliably prevent the automatic analyzer
and were removed, along with the temporary Rust probe. No persisted tooling
override remains. Actual analyzer54584 footprint was2474004320 bytes versus
3510943744 RSS; OmO footprint5064717416/available5989711872, pressure1,
swapUsed4644929536/swapOut79362883584 at that readback. Do not use RSS alone
as admission or treat empty diagnostic output as compiler verification.

An extra startup-cushion observer was cancelled while still waiting, before
launching an app. The subsequent real graph-reference attempt retained the
original2GiB workload/4GiB reserve policy and stopped again before capture:
available6190825472/projected4043341824, OmO footprint4979995752,
RSS4911415296, pressure1, swapUsed4001955840/swapOut80978919424.
`graph-reference-reclaimed-capacity.log` retains its stop/CDP disconnect;
`GRAPH_REFERENCE_RECLAIMED_EXIT1` is not visual evidence. Do not repeat that
unchanged capture attempt; first establish materially sufficient capacity.
The completed source-only task's verified owned idle host57165/supervisor57162
were released; subsequent process checks confirmed both absent. Unrelated
Virtualization, Colima, OpenCode and user services were untouched.
Latest sampled OmO footprint4976751720/available6487556096, pressure1,
swapUsed3993567232/swapOut80978919424. Automatic Rust diagnostics can themselves
be substantial; require fresh capacity before the next Rust edit and keep them
serial with native checks. Native/browser guards remain unchanged.
The capacity-only observer `mon_RJPCV60FDZ5QXFBK`/`bash_1690` completed ready,
but the wake's fresh readback had only6810320896 available, not sustained3GiB
diagnostic headroom. The subsequent work reused completed diagnostic state and
released the owned analyzers before compiler runs; no app/device was restored.
Verification `mon_XXFNGMP7TN6FNN34`/`bash_1699` stopped at that unrelated format
finding. Its successor `mon_CXEJ3AGXQEQ1S9GQ`/`bash_1702` completed successfully.
Inspect surviving jobs if the session resumes; never duplicate a live workload.
Native package paths have owner-test evidence, not compiled-host or native-platform
acceptance. No graph UI or real-surface acceptance is claimed.

Knowledge evidence trace: the shared projection gives explicit claims
precedence over the latest active qualifying Review self-report; worked-out,
assisted and untested responses are not externally validated performance.
Prediction is currently absent, not an implemented predictor. Review already
retains frozen admission, grade, attempt conditions, original attempt time and
Undo activity. Correction replaces the same physical attempt's observations.
Current claims retain a revision, not timestamps or a lifetime claim history.
The in-progress bounded read reuses that projection/assessment SQL and exposes
only16 observations/128KiB per page, exact package/capability snapshot cursors,
claim revision and the actual assessment-owning attempt. No schema, prediction
engine or parallel renderer aggregate is added. Owner tests now cover original
correction provenance and bounded pagination/restart/foreign-cursor/stale-claim
and long-source contexts. `knowledge-evidence-owner-first.log` passed all133
storage tests, including the two new paging/payload tests and strengthened
correction provenance assertions. Its newly unused shared-fixture submit/
schedule warnings were addressed by exercising those existing practice helpers
and asserting that evidence inspection creates no scheduler state; existing
unused-practice warnings in other suites remain unchanged.
Runtime/client transport is now in source, with strict unknown-page validation,
shared Review grade/condition guards, immutable query snapshots and source-
epoch stale-result rejection. Generated contracts now match the Rust source.
An existing real package/source/practice test now checks shared projection,
frozen source, claim separation and restart without the executable package.
The first guarded transport run stopped during core contract compilation
before generation/tests: available6393085952 minus the2GiB workload budget
left4245602304 bytes, below the4294967296 reserve. No generated evidence
contracts appeared. The temporary runner then reported `kill EPERM` on its
owned process-group cleanup. A subsequent process listing found no surviving
owned Cargo/rustc/export/guard process; no process was killed by name.
Fresh footprint4234900608, available7029932032, pressure1,
swapUsed4689100800, swapOut76471255040. Footprint was stable versus the
resource-stop sample, not attributed to a model/device workload.
The transport run is being readmitted only after fresh policy samples; no
reserve or workload budget is lowered. It must also capture the existing
Knowledge popover at desktop/narrow widths before presentation edits.
The readmitted run generated contracts and passed both evidence and both
correction storage tests, then the live guard stopped during runtime
compilation at available6141591552/projected3993682600 bytes. Cleanup again
reported `kill EPERM`; the subsequent bounded process list found no owned
compiler/guard survivor or large language-server process. OmO footprint rose
to4899878016, available7926644736, pressure1, swapUsed4360568832,
swapOut78071758848. This unexplained harness growth is retained, not
attributed to product/model workloads.
Verification is split: the small core contract/client checks run separately
from runtime compilation; runtime/GUI checks remain pending, not waived.
The Rust integer observation timestamp now explicitly generates a JSON numeric
TypeScript field, matching transport rather than ts-rs's default BigInt type.
The client still requires a safe integer; generated source is not hand-edited.
The separated `knowledge-evidence-client-first.log` passed Rust contract
generation, typecheck, architecture lint and49 affected client tests, including
the three new evidence boundary/snapshot/cancellation cases. Final
footprint1768895616, available7150190592, pressure1, swapUsed4301848576,
swapOut78071758848; the guard reported safe. The earlier high footprint receded.
The separated `knowledge-evidence-runtime-first.log` passed all12 real runtime
Review tests, including evidence restart without the executable package, and
rebuilt the actual QA host (SHA256517dc8849353b59e54065daf871d191cae8803f165b0a132af5dd0fd3786dd23).
Pre-edit Knowledge/Inspector captures at1100/390 were inspected before editing.
The new evidence body reuses Inspector's single bounded scroller and shared
controls, preserving its source/entry/header/footer. It presents the native
claim/assessment/model limits, newest-first bounded observations and expandable
original-condition/material/probe/package/source provenance. Back restores the
selected capability controls. `knowledge-evidence-ui-first.log` passed typecheck,
architecture lint, web export and native-backed empty-evidence captures at both
widths; those captures were inspected. Its final guard sample was safe:
footprint3740071040, available6838681600, pressure1, swapUsed4226285568,
swapOut78071758848.
The deterministic held-receipt regression first failed because evidence shared
the mutation queue. Evidence now reuses the existing bounded source-read lane:
two total pending search/evidence reads, source-epoch fencing, no mutation-tail
occupancy. `knowledge-evidence-held-after.log` passed50 affected client tests;
typecheck and architecture lint passed. The original failing log is preserved.
The first captured-Material browser run reached correction/paging/restart, then
failed an incorrect test expectation: one capability's unknown claim plus other
assessed capabilities correctly gives the source's native `mixed` rollup, not
`claimed_unknown`. The test now asserts that actual shared rollup separately
from the selected capability. The second run completed its light/dark,
desktop/narrow top/end captures and advanced to source-free browsing, then the
live guard stopped at available6292570112/projected4144137141 bytes, below the
unchanged4GiB reserve. No owned runtime/browser/runner/guard survivor was found
afterward. Subsequent footprint4228920448, available6031998976, pressure1,
swapUsed4209508352, swapOut78071758848. This is not a complete passing run.
Final `knowledge-evidence-final.log` passed typecheck, architecture lint, web
export, both evidence and both correction storage tests, and all3 actual
native-backed browser workflows. The exact-source QA host SHA256 is
`f624847d23c6260e27f167d24f2ec01db216418e8239bdc3490ce0e94f36d3ee`.
Those workflows cover17 real package-admitted physical attempts, correction,
16+1 paging/refresh, claim/self-report separation, source-backed and source-free
entry, native restart, failed read/retry and stopped-receipt replacement with
stale publication rejection, selected-capability Back focus, original-source
Escape focus and unavailable-package recovery. The12 fresh summary/provenance/
end captures across Quartz/Dark Quartz and1080/390 widths, plus both error/stop
captures, were inspected directly. Identifier wrapping and body paging remain
inside the existing Inspector; header/footer/source identity are retained.
Final guard sample: footprint1752806528, available6894977024, pressure1,
swapUsed4134010880, swapOut78071758848; safe with the same2GiB workload and4GiB
reserve. Earlier transient harness footprint receded without process cleanup.
The bounded read-only review `st_01a18400` returned APPROVE with no blocking
findings after inspecting the owners, all14 final captures, both baselines and
both empty-state captures and referenced test logs. It used the parent's
explicit `chatgpt-subscription/gpt-6.1-sol` route without escalation, builds,
devices or edits. `knowledge-evidence-contract-check.log` also passed the exact
generated-contract consistency check. This checkpoint ships with the connected
evidence increment based on `fa59ec48`; the tested QA binary identity is above.
Residual evidence limits: actual native compositor/mobile behavior and
pending-read Back/unmount GUI interactions are not established by these
captures; ownership/stale-result guards remain in source and source-free Stop/
replacement was exercised. The full M10 review remains an open gate.
No milestone or maintainer acceptance is claimed.
Source Return mobile40746113030: Android123025217962 passed; iOS123025218387
failed. Exact `ci-40746113030-ios-failed.log` reports the Watch picker assertion
at2026-10-28T19:45:06Z: `id: m01-watch, mp4 is not visible`. Its source-bound
simulator build completed before UI testing. No downstream iOS flow is claimed,
and no rerun/hosted FileProvider diagnostic variant was launched.
Reader search's verified increment is committed/pushed as
`2505a044a08574cd2a41283673e025f351a38a8e`; it does not close the remaining
Watch playback Return work or M10's native/compositor and review gates.
Exact-source automatic CI observers: desktop40738484644,
foundation40738484650, mobile40738484551. Desktop40738484644 passed.
Foundation40738484650 passed Rust, macOS, Windows and detector jobs, but its
web job122993370968 failed:136/137 tests passed, including Reader search.
The unchanged Knowledge browsing scenario failed during `backend.close()`:
`Native QA owner did not shut down cleanly` at runtime-browser-qa.mjs:80.
The test's functional assertions completed; this log does not establish why
the native process failed or whether shutdown was forced. Retained failure:
`ci-40738484650-web-failed.log`. No check was weakened or workflow rerun;
the teardown failure remains an integration concern to diagnose, not a passed
gate. Reader mobile40738484551 completed: Android122993371299 passed;
iOS122993370757 failed at2026-10-28T18:41:24.363399Z with the same deferred
Watch picker assertion, `id: m01-watch, mp4 is not visible`. Retained log:
`ci-40738484551-ios-failed.log`. That does not verify downstream iOS flows
or diagnose the picker. No workflow was manually rerun.
Source Return checkpointc61df5af desktop40746113011 passed.
Foundation40746113052 failed only web123020234888:137/138 tests passed;
the new Watch playback test could not generate its Linux fixture because
`ffmpeg` was not installed (`FileNotFoundError`). This is an omitted CI
prerequisite introduced with that test, not a product success or an
infrastructure waiver. `ci-40746113052-web-failed.log` is retained.
The bounded Ubuntu prerequisite step now installs ffmpeg alongside existing
CJK fonts, keeps download/install deadlines and no-download installation, and
records its actual package version. Ruby/Psych parsed the workflow and
`git diff --check` passed. Automatic foundation40749937097 completed successfully:
Rust, web, detector, macOS and Windows jobs passed, including Linux media fixture
tooling and the complete web suite. `ci-40749937097.log` preserves the exact run.
The workflow-only repair is committed/pushed separately as
`fa59ec48c8bf716b3a1bb015993028ddfb168c07`, excluding unfinished Knowledge
evidence. No assertion, model input or data identity was changed.
The next guarded baseline captures Watch transcript search at desktop/narrow
widths using the retained authored video/subtitles and actual native source/
cue owners. Its browser transport serves those same local video bytes for
real decoding; this is not Tauri/native playback certification.
That baseline passed in `watch-search-baseline.log`; desktop/narrow images
were inspected before product edits. Its drag/drop shell subscription remains
explicitly unsupported in the baseline adapter; actual video decoding and
native cue search succeeded. A portable regression now serves authored video
bytes through that same browser media boundary and adapts only shell event
registration, while exercising real source/package/cue timing and persistence.
The first red-run observer expired before starting: no log was created.
Fresh footprint2361308288, available6957006848, pressure1,
swapUsed4185522176, swapOut75548114944. The additional fixed7.5GB prefilter
was more conservative than the repository policy and repeatedly prevented
admission. Subsequent runs use `resource-guard.mjs admission` directly:
unchanged2GiB workload budget,4GiB reserve, three healthy samples, physical
growth/sustained swap checks and live guard. No workload budget or repository
safeguard is reduced.
The first Watch red run reached real video decoding but its HTTP adapter did
not support byte ranges, leaving the initial seek at0. Correcting that test
boundary and asserting native position readback produced the intended failure
in `watch-search-red-range.log`: the player resumed3s, native cue2 under a
2000ms subtitle offset sought13s, and the query survived native restart, but
Return was absent. No product assertion was weakened.
Transcript now retains the actual player-reported pre-jump position in its
existing source-keyed view and offers Return when reopened. Watch's existing
controller pauses/reads/seeks; unavailable playback refuses the jump, with
feedback beside cue/Return actions. Rust remains the saved-position owner.
The first typecheck/lint/export/actual-playback Return run passed in
`watch-search-first.log`: actual3s -> offset cue13s -> Return3s persisted across
native restart with the2000ms offset and1.5x rate retained. Desktop/narrow
captures were inspected before further changes. They expose the deliberately
killed owner's pending analysis as explicit Retry feedback, not clean final
surface evidence. The test now waits for the exact connected source token to
render before the controlled restart, avoiding a race with its guest read.
Messenger's existing source search is also being verified through its explicit
Latest return, with the unsubmitted draft preserved; ordinary clear-search
and edit/delete assertions remain. The final serial run uses the tracked
offline video generator rather than relying on the retained untracked video,
and includes existing Watch layout and affected Messenger history checks.
Final `source-search-final.log` passed all five selected scenarios: generated
offline video, native cue offset and rate, actual browser3s/13s/3s playback,
native restart/persistence,1200/500/320 Watch layouts, and Messenger search/
Latest with an unsubmitted draft preserved. Desktop/narrow Watch Return and
Messenger captures under `watch-search-final` were inspected; source errors
from the deliberately interrupted first attempt are absent after waiting for
the connected token render. Dictionary preparation remains explicit pending
feedback, not a fabricated result. Final footprint1718367360,
available7088128000, pressure1, swapUsed4764598272, swapOut76471255040;
the live guard reported safe with no observed sustained growth.
Reader search and source Return are checkpoint2505a044 above. The Watch
Return addition and cross-source verification are locally verified and being
checkpointed next. This finishes SRC-10's implementation/connected browser
work, not M10 acceptance: native/compositor interaction, the unchanged
Knowledge teardown failure and independent M10 review remain separate gates.
Latest verified increment: shared proposal review is committed/pushed as
`5a9c938cc6325d1791a069ffbd801c2146406512`, based on native generation
`87c73fe27784f640c6eb445f036c9bb5e709e1cb`. That earlier ledger was50/109.
Local integration passed17 affected client tests, six real Rust-backed GUI
scenarios, all20 existing desktop/narrow Material editor regressions, typecheck,
architecture/draft lint and web export. Final log:
owned root `proposal-retry-lane-final.log`; captures are under
`proposal-ui-retry-lane-final`. Desktop/narrow light and dark proposal, source
Return, partial-output and cancellation surfaces were inspected across the
recorded runs. This is verified for continuation, not M10 acceptance.
Native/compositor interaction on the new controls and the independent M10
review remain integration gates. Existing platform discrepancies below remain
unresolved; the new GUI evidence is not a claim about native window materials.
Exact-source proposal CI: desktop40722951356 passed. Foundation40722951324
failed only its web job122938476762:131 tests passed, while the two Inspector
footer layout cases still expected six actions after Propose Material made
seven. The retained failed log is `ci-40722951324-web-failed.log`; this is an
omitted stale test update caused by the proposal increment, not infrastructure.
The test now expects all seven and extends its keyboard/scroll reachability
assertions to Propose Material, retaining all original geometry/material checks.
That focused repair is committed/pushed as
`e17bccd34fe91a85ffbd8ce55c5a03823027ee6c`; unfinished Reader search source was
not included. Its foundation CI40728696872 completed: web, Rust, macOS desktop
and detector passed. Windows job122962714012 passed builds, both real OCR
workflows and initial theme transitions, then failed in repeated-edit cycle4 at
2026-10-28T17:01:31Z: `Incomplete native theme input`, expected Slate but
received unchanged Dark Quartz. Clipboard matched expected input and editor
reported focused; the native focus HWND changed from66140 to131684 before
that failed paste. This repeats the unresolved input-loss symptom, without
establishing its root cause. Exact failed log:
`ci-40728696872-windows-failed.log`. No assertion was weakened and no workflow
was rerun. Footer web coverage is green; the overall workflow is not.
Windows job122941995691 passed its actual theme/OCR steps; that does not explain
the earlier intermittent input-loss evidence. Mobile40722951303 completed on
exact proposal source5a9c938c: Android job122938475335 passed; iOS
job122938474874 failed `Exercise actual iOS UI and Rust persistence` at
2026-10-28T17:08:44Z. The observer reached its deadline; a subsequent one-shot
status read confirmed the workflow's actual terminal result. Retained log
`ci-40722951303-ios-failed.log` shows the same deferred Watch picker
assertion at2026-10-28T17:07:56.558748Z:
`id: (mLearn v3 Dev, Container|M01 fixtures, Folder|m01-watch, mp4) is visible`
was false. Fixture export succeeded; this does not diagnose the picker failure
or verify downstream iOS workflows. No workflow was rerun or assertion changed.

Source-search owner trace: Watch already searches literal subtitle text through
`transcript_page` and navigates real cue indexes; Messenger already searches
retained history through `ReadMessages`. Reader has no text/content-search
owner. The new work extends document storage and the existing shared
`return_source_anchor`, rather than adding a parallel universal search store.
Native Reader-search contracts/storage passed run1544
(`document-search-owner-first.log`): all16 document and16 OCR owner tests,
including the five new cases. Its new unused macro doc-comment warning was
fixed as an ordinary comment, not suppressed. The implementation provides:
explicit canonical-text versus saved-recognition scope,16 bounded source hits,
64-row/1MiB scan quanta, UTF-8 source coordinates, immutable source/package/query
cursor binding, OCR-revision invalidation and explicit missing-page coverage.
Search does not invoke recognition or a provider, and no index/schema or
whole-source renderer copy was added. Five new owner regressions reuse the
existing document/OCR fixtures for pagination/restart, late matches, stale
coordinates/packages and missing/corrected recognition. Reader GUI and
cross-surface Return verification are still unimplemented.
Runtime/client dispatch is now in source with strict search-page validation and
one generic ReturnSourceAnchor action reusing the existing native source owner.
Native and client tests cover actual imported Unicode spans, forged quotations,
false scan progress, immutable query admission and replaced-source receipt
rejection. Rust contract generation must run before TypeScript checks; current
missing-type diagnostics reflect that pending generated output, not hand-edited
contracts. The next guarded serial run also verifies the corrected Inspector
footer tests against the retained proposal export. Guarded run1546 passed
in `document-search-transport-first.log`: Rust-generated contracts, all131
storage tests,12 actual runtime document tests,58 affected typed-client tests,
typecheck, architecture lint and both Inspector footer layouts. The footer
captures were inspected; all original one-row/material/keyboard assertions
remain, including keyboard access to the new seventh action. Existing ts-rs
serde-attribute diagnostics and unused `practice` test-fixture warnings remain;
the new macro doc-comment warning is gone. Reader search is still not connected
to the GUI, and native/compositor/M10 acceptance remains open.
Before Reader presentation edits, guarded run1549
(`reader-search-before-ui.log`) rebuilt the actual QA host/export and captured
normal desktop/narrow Reader on the retained isolated corpus profile. Both
baseline images were inspected. Reader now has a shared-control source-search
Dialog, bounded result pages, stop/retry, explicit unavailable-recognition
coverage, exact source-anchor navigation and Return to the original position.
Navigation reuses useReader's existing save/cancel/source-session owner and
retains native returned highlights; image navigation propagates failed
admission rather than retaining prepared pages. Guarded
`reader-search-first-ui.log` passed typecheck, architecture lint, web export,
and actual native-backed search/navigation/Return capture. Desktop1100/narrow390
results and retained Return captures were inspected: no blank, overlap or
overflow; compact source title truncates while accessible actions remain.
The final sample was footprint1654191232, available7206174720, pressure1,
swapUsed3663527936, swapOut73977217024; the guard reported safe. No device,
reference application or persistent server was launched.
Three new native-backed GUI regressions now cover source-span/position
persistence across native restart, bounded Unicode paging and stop/late-result/
failed-search retry. Their first run, together with existing Reader/image and
Messenger-history regressions, passed48/50 (`reader-search-native-first.log`).
All47 existing tests and the new Unicode paging test passed. Two new tests
failed: a stopped search's held receipt blocked the replacement behind the
typed client's serialized mutation lane; the position test incorrectly
expected saving the first visible line to retain the matched word's byte10,
although DocumentCanvas explicitly reports the first visible scalar (byte0
on this short line). Search now admits at most two independent bounded reads
with source-epoch fencing, allowing one replacement without blocking source/
control commands. A client regression asserts replacement, admission bound,
navigation and stale receipt rejection. The GUI test still asserts the exact
native anchor/returned position, and separately asserts the actual byte0
reading checkpoint; source restoration assertions remain exact.
The first repair observer expired before resource admission; no repair log was
created and no test was started. A fresh sample after its deadline showed
footprint4807357568, available8327069696, pressure1, swapUsed4705681408,
swapOut75548114944. Footprint was stable versus the preceding run's
4824708224, not explained away as workload memory. No surviving browser/build/
model/device workload appeared among the largest processes; no unrelated
process was stopped. The readmitted repair passed in
`reader-search-native-repair.log`:14 typed client tests, all three native-backed
Reader GUI scenarios, typecheck, architecture lint and web export. Its light
desktop/narrow result captures were inspected alongside earlier dark captures.
Final footprint1718498432, available9273917440, pressure1,
swapUsed4613341184, swapOut75548114944; the guard reported safe. The earlier
high footprint receded without killing a process.
Review of the image consumer found search navigation also needs to cancel its
running recognition, as existing keyboard/rail/contents navigation already do.
The shared search callback now uses that existing cancellation before native
anchor Return. The existing image-navigation test loop gains one search case
covering saved recognition, held-inference cancellation, exact page, no extra
recognition, and Return to the original page; the toolbar layout checks now
include Search. Final `reader-search-final.log` passed14 client tests, three
native-backed GUI scenarios and four image/toolbar cases after typecheck,
architecture lint and export. The saved-recognition desktop/narrow captures
were inspected; source text, scope, actual page and controls remain contained.
Its final resource sample: footprint1709831296, available6836633600, pressure1,
swapUsed4512677888, swapOut75548114944; guard safe, no observed growth.
Recognition
quality/persistence remains separately covered by real native owners, not this
explicit browser-boundary fixture.
Watch's existing cue search seeks
real cue positions, but an explicit pre-search playback Return still needs
verification/repair; this source-search task is not complete.
The consumer-boundary increment adds immutable row amendments,
bounded visible membership, readable result labels and Schema17 retirement;
guarded run1460 passed its owner/runtime/client checks. Shared native selection
controls on Knowledge and Material passed export/capture and recovery checks.
The committed bulk-action composition connects those handles to
confirmation, live control, retained jobs and bounded result pages. Final
five-scenario native GUI and 20 desktop/narrow Material regressions pass,
including Retry/Clear, alongside authentic Japanese addition outcomes.
This bulk increment is verified for continuation; M10 native/compositor,
independent-review and remaining feature gates are still open.
The committed proposal owner adds source/existing-Material-grounded text
drafts, immutable identity, editable fields, explicit accept/reject and atomic
Material/receipt publication. Its six new persistence tests and all123 storage
tests pass. Native dispatch, Rust-generated contracts and a typed client passed
integration checks, including the repaired cross-language replacement regression.
Shared native generation integration is committed and verified at its
native/storage/client boundaries. The actual review UI now connects source and
saved-Material suggestions, grounded generation, editable drafts, explicit
accept/reject, bounded recovery/history and partial failure. Native proposal
identity/source validation and atomic acceptance remain the sole authority;
unsubmitted fields and view lifetimes remain in React. M10 is not complete.
Shared `MaterialFields` extraction passed typecheck, architecture lint, draft
guard, web export and all20 existing desktop/narrow editor regressions.
The native-backed after captures at1100/390 were inspected: the same field
hierarchy and usable single-column narrow editor remain intact. Log:
owned root `material-fields-ui-verify.log`; after images use
`material-fields-after-proposal-before-editor-final-*`.
The first real proposal dialog now connects bounded pending/history pages,
existing-Material suggestions, shared editable fields, CAS review, accept/reject,
duplicate/distinct outcomes, exact-command recovery and native source Return.
Its first serial guarded verification/capture passed in run1526,
`proposal-review-first.log`: typecheck, architecture/draft lint, export and all20
editor regressions pass; real native suggestion publication and pending-list
recovery rendered at1100/390. The suggestion/list/pending captures were inspected;
the shared Dialog owns scrolling and narrow controls wrap without overlap.
Generation controls and a shared SourceActions entry are now connected in source.
They reuse shared provider settings, native admission/retry/cancellation and
retained generation pages; only the visible active job samples native progress,
and closing the view stops sampling without pretending to cancel the job.
The first generation-control run1527 passed typecheck but architecture lint
rejected SourceActions' private cross-feature import before any export/capture.
The repair exports the shared review composition through the existing Material
public boundary; no rule was relaxed. Guarded run1528 now verifies that repair
and partial-output rendering in `generation-controls-public.log`; these new
paths are not yet verified by that first failed run. Run1528 subsequently
passed typecheck, architecture/draft lint, export and all20 Material editor
regressions. Native generation used the shared provider fixture, retained one
grounded replacement, reported the second invalid candidate and published no
Material automatically. Its `generation-controls-public-generation-partial`
desktop/narrow images were inspected: progress, partial error and review entry
remain contained and readable. This proves that path, not all MAT-07 recovery.
New native GUI regression run1529 (`proposal-focus-red.log`) now checks the
actual editor opener versus the global Review proposals trigger, retaining the
separate unsaved Material editor fields. This suspected focus defect is being
reproduced before repair; run1529 failed exactly because the editor's
Propose changes opener was inactive after dismissal. MaterialScreen had always
restored the global Review proposals button. The fix passes the actual shared
Button ref from MaterialEditor and retains it at the dialog owner. Fresh LSP
diagnostics are clean; guarded run1531 in `proposal-focus-fixed.log` verifies
the existing regression plus desktop/narrow before/after captures. Run1531
passed typecheck, architecture lint, export and that actual native GUI
regression; its desktop/narrow focus-return images were inspected. Unsaved
Material fields and the saved revision remained separate; dismissal wrote no
proposal or Material.
Run1532 (`proposal-recovery-first.log`) now exercises the four-scenario native
GUI suite: exact editor focus, actual Reader source suggestion/edit/accept with
lost receipt and process restart, held generation admission cancellation followed
by retained retry/partial collection/explicit replacement acceptance, and
provider-free rejection/history persistence. Assertions observe native state,
real source anchors and exact wire-command identity. Provider waits subscribe
before the action; no test sleeps or timing-based passes were added. These new
recovery scenarios all passed in run1532 (four tests,6.6s). The source and
partial-generation captures at desktop/narrow widths were inspected; actual
source selection, authored edits, replay identity, rejection history and native
restart behavior held.
Capture inspection exposed a stale empty proposal list after native generation
collection. A strengthened generation test also now drops the held original
admission response after successful Cancel, rather than delivering it normally,
to verify the late failure cannot publish a stale recovery action. Targeted
run1534 (`proposal-late-failure-red.log`) reproduces that edge before repair.
Run1534 failed exactly because the lost original admission receipt published
`Recover generation action` after a successful cancellation receipt. The repair
gives each presentation action a scoped owner; successful Cancel invalidates the
held action and releases its UI lock, so its late success/failure cannot publish
or unlock a newer action. Native generation identity and cancellation are
unchanged. Collection now invalidates the parent proposal page, and choosing a
generated proposal collapses job controls to reveal its authored fields.
LSP diagnostics are clean. Guarded run1535 (`proposal-recovery-fixed.log`)
passed all four native scenarios with the stronger dropped-receipt assertion,
fresh desktop/narrow source and generated-review captures, and all20 existing
editor regressions. Typecheck, architecture/draft lint and export also passed.
Generated-review and source-Return images were inspected; job controls collapse
to the reviewed fields and the real Reader resumes on the native anchor.
Before committing, owner inspection identified two additional bounded edges:
Open saved Material can target the same already-open item, and a retry has its
own admission receipt/control identity. New targeted regressions run1536
(`proposal-review-edges-red.log`) test obsolete editor draft reopening and a
held retry receipt before repairing either. Same-item Open saved Material
passed without a product change: actual router navigation reloads the saved
revision. The retry scenario failed because Cancel was absent while its own
admission receipt was held. The repair retains one exact admission function for
both initial and retried jobs; Cancel replays that same command independently
of its held wire receipt. Retry preparation is shared only until its command
identity exists, without a second provider/queue owner.
Guarded run1537 (`proposal-integrated-final.log`) now verifies all six native
GUI scenarios, all20 existing editor regressions, typecheck, architecture/draft
lint and export. Fresh LSP requests timed out, not a diagnostic pass; the full
typecheck in this run remains the pending authority. No unrelated feature was
expanded. Run1537 passed typecheck, architecture/draft lint, export and five
native scenarios. The held-retry test then timed out waiting for provider
cancellation. Its inspected surface had the Cancel action, exposing the deeper
shared-client issue: `retry_generation` still used the serialized request lane,
so resolving the exact retry queued behind the held receipt itself.
The owning conversation client now routes retry admission through the same
direct control lane as explanation/cancellation. No new worker or private
generation transport was introduced. Client LSP diagnostics are clean.
Guarded run1538 (`proposal-retry-lane-final.log`) passed the affected
conversation/generation/proposal client suites, all six native proposal
scenarios and all20 existing editor tests with a fresh export. The17 client
tests, typecheck and architecture/draft lint passed. Successful held-retry
cancellation captures were inspected at desktop and narrow widths. The prior
cancellation timeout remains recorded and is explained by the verified lane
repair, not waived.
Resource note: run1534 sampled OmO footprint4773246056 bytes, available7010107392,
pressure1, swapUsed4059889664, swapOut72139259904. Fresh pre-admission readback
decreased to4491097192 bytes with available7988019200, pressure1; swapUsed
5024645120 and swapOut73229844480 had increased. This remains unexplained OmO
growth, not attributed to the native fixture. The three-sample7.5GB admission,
2GiB reservation and4GiB reserve remain unchanged; no concurrent local workload
was added, and model work pauses while serial verification holds the reservation.
Final run1538 readback: OmO footprint1682191488 bytes, available7727300608,
pressure1, swapUsed3780968448 and unchanged swapOut73977217024. The transient
OmO growth receded; no emulator, simulator or persistent server was started.
The generation-review implementation task is locally verified for continuation;
the named native/compositor and M10 review gates remain open. No second
provider/session owner was added.
Exact-source generation checkpoint foundation CI40707752973 has terminated
successfully; its preserved log is `ci-40707752973.log`. The mobile observer
40707752976 first observer timed out, not the hosted run. Its continuation1530
is now terminal: Android job122886719522 passed at15:18:29Z; iOS122886720125
failed the actual UI/persistence step after1h5m36s. The job's exact failed log
was retained by observer1533 as `ci-40707752976-ios-failed.log`. At15:46:28.843Z
it reports `Watch Inspector Knowledge and native source resume` failed after
1m42s with `Assertion is false: id: m01-watch, mp4 is not visible`.
This repeats the earlier observable assertion, without establishing a common
root cause. No workflow was rerun or cancelled. Earlier iOS/Windows failed
evidence remains open; Android success is not an iOS verdict.
The Material grid has passing local functional/layout evidence; consuming-native
GUI/reference-material fidelity remains open at the M10 gate, not self-accepted.
The Knowledge GUI increment is committed/pushed at
`8eec14d991542ece155812fc87b1b0cf8db49c05` on draft PR45 and locally verified;
Material collection presentation and the M10 milestone remain incomplete.
New execution note:
`/var/folders/f2/d3_jzj917kg6sqsc9tgc80200000gn/T/ulw-20261027-194056.XXXXXX.md.bjGW2XKx9h`.
The historical M03–M07 record follows; its older ceiling is not a stop on the
newly authorized M10–M11 work.

2026-10-28 selection increment (bulk actions incomplete): the
existing core frozen-selection contract is reused, with native SQLite snapshots
of identities and Material/package edit revisions, bounded identity pages,
explicit release, eight live handles and one million retained identities total.
Normal collection reads and snapshot creation share one SQL predicate compiler.
Schema14 preserves selection receipts across restart and retains released-command
digests so a retry cannot silently select new membership. Four new storage
regressions cover filter/edit/restart stability, exact explicit membership,
release/capacity/retry and incomplete-catalog/cursor rejection. The initial
fixture incorrectly restarted a partially populated catalog; it now completes
the actual saved package cursor instead. Guarded run1414 passed all105 storage
tests, including all17 collection tests. Existing unused `practice` fixture
warnings remain. Log: owned root `selection-storage-verify.log`.

Selection request/response dispatch, Rust-generated contract exports and typed
client methods/guards are now verified together, not yet connected to the
management UI. Bounded listing exposes retained handles after restart so a
lost renderer cannot exhaust the eight-handle allowance permanently. Run1420
passed all105 storage tests, both native-runtime collection tests, all five
client collection tests, typecheck and ownership lint. The native transport test
exercises create/replay/reopen/list/page/release and rejects an uninstalled
Knowledge package. Log: owned root `selection-recovery-idle-verify.log`.
Generated contracts were produced from Rust, not hand-edited. Mobile/native
application verification remains pending; these are native-owner/transport
receipts, not GUI acceptance.

Run1415 generated contracts and then ended during storage
compilation with runner cleanup `kill EPERM`; no Cargo/rustc/resource-guard or
owned native QA process survived the subsequent process inventory. The runner
now avoids signalling an already exited child and preserves guard-stop samples.
Run1419 exposed another group-signal EPERM after a guard stop: projected headroom
4229021696 bytes was below the unchanged 4294967296-byte reserve. No owned
verification process survived inspection. The successful idle run1420 ended at
footprint1770173544, available7294713856, pressure1, swapUsed4414767104 and
swapOut67667247104, with the unchanged 2GiB workload budget. No
device/model/server was launched. Bulk mutation/progress/retry UI remains the
active work; this selection increment does not retire MAT-06.

Selection increment committed/pushed as
`4ca6474f1512071f56ce5a0070bace7d01f6552b` on `agent/m10-m11`.
Exact hosted gates are foundation40660669537, desktop40660669326 and
mobile40660669332, with final-only observers1426–1428; no extra workflow was
dispatched. The current uncommitted removal increment adds revision-checked,
idempotent native Material deletion and tombstones so historical create/edit
receipts cannot recreate deleted authored data. It deliberately retains
Knowledge and admitted Review state. Shared media cleanup now considers
retained Review admissions as well as Material references. Schema15 and three
new owner regressions cover CAS/replay/claims/frozen identity, shared asset
release and active audio/source continuity after restart. These removal changes
passed all108 storage tests under guarded run1429, including shared-media and
admitted-audio restart retention. Log: owned root
`material-removal-storage-verify.log`. Removal is now exposed through the same
native metadata and typed Material client boundaries, with an added real-runtime
CAS/reopen/replay test and client receipt-validation regression; those integration
changes are not yet verified or connected to the UI. MAT-06 remains open.
Exact-source 4ca6474 desktop40660669326 passed; the other hosted gates remain
under their existing observers.

Removal transport run1430 passed all108 storage tests and all five native
Material integration tests. Its typecheck caught an omitted `material_removed`
member in the client's response-narrowing union; the union is now corrected.
Resume1431 passed typecheck, ownership lint and all17 Material client tests;
the already passing Rust checks were not repeated for this TypeScript-only fix.
Logs: owned root `material-removal-transport-verify.log` and
`material-removal-client-recheck.log`. Native/client removal is verified for
continuation, not connected management UI or milestone acceptance.
The next bulk-owner step must commit each item mutation and its bulk result in
the same native transaction; calling a mutation and separately recording success
would leave a crash window that can invalidate frozen edit preconditions on retry.

Removal committed/pushed as `d1d80ffdd4e69cb006951b0fcc3ef701bd01921c`.
Its exact foundation40663084168, desktop40663084158 and mobile40663084185
have observers1438–1440; desktop passed. Selection4ca6474 foundation40660669537
also passed; its mobile observer1428 remains active. No hosted iOS variant was
dispatched and no platform gap is converted into acceptance.

The current uncommitted native bulk-storage increment extracts transaction-scoped
create/edit/remove functions in the existing Material owners, reused by individual
actions and the bulk ledger. Schema16 adds bounded retained jobs, indexed pending
identities and per-item receipts; progress and a successful item mutation commit
together. Jobs pin their immutable native selection until results are released.
Cancellation fences later commits; restart interruption and explicit retry
preserve successes and reset only failed/pending work. The indexed pending table
avoids rescanning the completed prefix for each next item. Four new storage
regressions cover an injected SQLite progress-write rollback, cancellation and
restart retry, paging/capacity/release, and package identity/duplicate-versus-
distinct addition. This storage increment is not yet executed or connected to a
runtime bulk worker or management UI at that checkpoint. MAT-06 and M10 remain incomplete.

Bulk-storage recheck1445 passed all112 storage tests, including all four new
transaction/recovery/capacity/addition regressions. Log: owned root
`material-bulk-storage-recheck.log`. Initial1441 compiled successfully and passed
the collection suite before a resource-guard interruption; it did not report a
product assertion failure. Guard sample: footprint4235195520, available6380929024,
growth extrapolation707834630, projected headroom3525610746 below the unchanged
4294967296 reserve. Its group-signal cleanup again reported EPERM; no owned
verification process survived inspection. A small owned `/bin/cat` process-group
probe signalled and closed normally, so the Cargo cleanup EPERM is not diagnosed
or reported fixed. Successful1445 ended at footprint1791833216,
available8810414080, pressure1, swapUsed4288937984 and unchanged
swapOut67667247104.

The uncommitted bulk runtime now uses the existing blocking executor and shared
guest admission, with durable per-item transactions, live status/cancel,
explicit failed/pending retry, bounded result recovery and explicit release.
Dictionary addition uses the selected package's actual entry/default sense,
checks its revision before lookup and commit, and invents no source provenance.
Runtime reopen marks abandoned jobs Interrupted without automatically resuming.
New event-driven native tests cover cancellation publication fencing and
restart recovery; a bounded authentic English target fixture exercises package
unavailability/reopen retry and real dictionary output, not full-corpus or GUI
acceptance. These runtime tests and generated bulk contracts are not yet run.
Typed bulk client methods and the management UI remain unimplemented.

Exact selection4ca6474 mobile40660669332: Android122722613375 passed;
iOS122722612935 failed at 2026-10-28T09:26:02Z with
`Element not found: Text matching regex: Open local video, Enabled`.
Exact removald1d80ff foundation40663084168: Rust/web/OCR detector/macOS passed,
Windows122733429663 failed at 2026-10-28T09:36:42Z during actual native theme
input: expected Quartz JSON, received unchanged Dark Quartz JSON despite the
reported focused editor and expected clipboard. This is an observed input-loss
gate, not a diagnosed cause or a passing platform. Logs are owned-root
`ios-4ca6474-failure.log` and `windows-d1d80ff-failure.log`.
No workflow was rerun and no hosted iOS diagnostic variant was launched.

Native bulk run1448 passed both event-driven worker tests, all three collection
runtime tests (including authentic package-unavailable/reopen bulk addition),
all five native Material tests, Rust contract generation, typecheck and ownership
lint. Log: owned root `material-bulk-native-verify.log`. Final sample:
footprint1788589184, available6939967488, pressure1, swapUsed4280549376,
swapOut67667247104. These are native owner/transport tests, not management GUI
or full-corpus readiness.

Typed bulk client methods and nested packet guards are now implemented but
unverified. They bypass their own long admission for live control, retain exact
prepared intent across source navigation/lost receipts, compare action semantics
without depending on object key order, and validate frozen identity/revision,
counts, recovery capacity and bounded result pages. Three client regressions
cover those contracts. Inspection found that eight maximal edit drafts plus
status messages could exceed the existing transport limit; native admission now
caps retained job documents at262144 bytes, reserving wire headroom for future
bounded errors. A fifth bulk storage regression verifies release restores that
capacity without hiding retained handles. This new bound and the typed client
checks are pending. Native management selection controls/UI remain unimplemented;
MAT-06, M10 and M11 are not complete.

Integrated bulk run1449 passed all113 storage tests, both native bulk worker
tests, all three native collection tests, all five native Material tests,
Rust-generated contracts, typecheck, ownership lint and all25 targeted client
tests. Log: owned root `material-bulk-client-verify.log`. Final sample:
footprint1806234752, available6978830336, pressure1, swapUsed4171497472,
swapOut67667247104. The native engine and typed transport are verified for
continuation; no management GUI workflow is claimed.

Next real consumers are Knowledge/Material selection controls and per-item
results. Their required native projection work remains explicit: bounded visible
membership queries and immutable selection amendment for row toggles without
loading an entire selected corpus into React; human-readable result labels must
come from the native content/receipt owner, including after removal. These are
not implemented by the current identity-only packet. Build those boundaries
before composing the shared controls, then inspect real desktop/narrow rendering
and exercise the four bulk actions with cancellation/restart/retry.

Engine570ae39 exact foundation40670697356 and desktop40670697311 passed;
mobile40670697251 failed. Android122756404068 built/installed successfully but
failed the initial `Watch Inspector Knowledge and native source resume` flow
after14s at2026-10-28T10:40:12Z. Retained `android-build-evidence`
artifact12809368322, under owned-root `android-ci-570ae39`, records
`DeviceServerDiedException` during `viewHierarchy`, caused by
`Command failed (host:transport:emulator-5554): device offline`.
The initial enabled `source-language-select` assertion was still running;
this is not a completed negative product assertion. The retained native log
has no `Fatal signal`, `FATAL EXCEPTION`, `OutOfMemory`, `am_crash` or `ANR in`
match. This identifies a lost device/driver connection, not its underlying
cause. Artifact source.txt matches570ae394 and treea8cd3262.
iOS122756404720 failed before a functional flow started:
`LocalXCTestInstaller$IOSDriverTimeoutException: iOS driver not ready in time`
at2026-10-28T11:15:34Z. This is a harness startup failure, not a product
assertion pass or proof of a product regression. Exact logs are owned-root
`android-570ae39-failure.log` and `ios-570ae39-failure.log`. No workflow rerun,
timeout change or local device launch was made.
Removald1d80ff mobile40663084185
finished with Android122737199189 passing and iOS122737198915 failing at
2026-10-28T10:12:22Z: `Assertion is false: id: m01-watch, mp4 is not visible`.
This differs from selection4ca6474's missing Open-local-video control; no common
cause is claimed. The exact log is owned-root `ios-d1d80ff-failure.log`.

The uncommitted selection amendments retain original edit/package preconditions,
validate newly added keys through the existing native filter compiler, and
permit removal of frozen keys without an available catalog. Visible membership
reads at most64 requested keys and distinguishes package aliases. Storage/client
and authentic-package runtime regressions cover those boundaries.

Result labels now come from native content/package/media metadata and are stored
with each mutation receipt before removal. Missing historical content falls back
to its genuine identifier, not invented text. Consumer tracing also exposed that
clearing results retained full edit drafts indefinitely. Schema17 now migrates
released documents in bounded windows to typed compact progress summaries,
discarding edit inputs/labels while preserving the digest. An exact Start replay
reconstructs its summary only from the digest-matched incoming command and never
reapplies work. Direct released-result reads fail explicitly; release acknowledges
only the command ID and is idempotent. New retirement/migration regressions cover
these lifetimes. No affected UI has been edited yet.

Consumer-boundary run1460 passed all117 storage tests, both native bulk-worker
tests, all three native collection tests, all five native Material tests,
Rust contract generation, typecheck, ownership lint and all26 targeted client
tests. Log: owned root `management-boundaries-verify.log`. Existing unused
`practice` fixture and ts-rs serde-attribute warnings remain. Final sample:
footprint1806054528, available8569831424, pressure1, swapUsed4070834176,
swapOut67667247104, with the unchanged 2GiB workload budget and 4GiB reserve.
These native boundaries are verified for continuation, not GUI or milestone
acceptance. Management selection/bulk controls and real four-action workflows
remain incomplete; M11 has not begun.

Consumer boundaries committed/pushed as
`f074bc701cb6093bfe768c5a28ee5773ae4ccad3`. Existing automatically triggered
foundation40678063354 and desktop40678063477 passed;
mobile40678063651 remains under its final-only observer.
No additional workflow was dispatched. A deliberate,
guarded current-native Material baseline run is active before the first visible
selection change: owned-root `management-ui-baseline.log`. No device/model or
reference application was started. The surviving static server PID2637
(`node tools/serve-web.mjs`, started October24) was inspected and reused, not
restarted or stopped.

That baseline run stopped at the resource guard after the current native QA
binary compiled successfully and the single Material test started. It produced
no accepted baseline or product assertion verdict. Sample: footprint3925767296,
available6229327872, pressure1, swapUsed4037279744, swapOut67667247104;
projected headroom4081844224 was below the unchanged4294967296 reserve.
The immediate process inventory found no owned QA/browser/Cargo/guard process
remaining. Follow-up footprint3924833408 and available6487851008, with unchanged
swap, leave little margin for the browser. Keep visible UI edits behind fresh
baseline evidence; wait for three samples with at least7.5GiB available before
another deliberate full test run, retaining the original guard and workload budget.
That one-shot headroom watch timed out without restarting any workload.

Native `vmmap -summary 82251` then reported footprint2.1GiB, peak14.4GiB
(a historical peak, not a current allocation), and App-Specific Tag1 resident7.7GiB,
dirty3.9GiB. The allocation owner behind that tag is unidentified. The eval
runtime reported about75MB JavaScript heap and42MB external storage; retained
inspection results totaled only200KB. Normal `Bun.gc(true)` reduced reported
footprint by about6.5MB, not the tagged allocation. Do not call this resolved
or attribute it to a device/model. Follow-up native sample:
footprint2187179136, available6896467968, pressure1,
swapUsed4028891136, swapOut67667247104.

A materially smaller baseline path is now running: reuse the retained isolated
native corpus profile and current compiled binary, one headless browser context,
no Playwright test worker,52-entry seed run or trace recorder. It captures both
Material and Knowledge before selection edits at1100/390 widths. Its original
2GiB workload guard and4GiB reserve remain unchanged, with fresh admission and
per-capture samples. Log: owned-root `management-ui-lean-baseline.log`.
The temporary helper's LSP cannot initialize TypeScript outside the workspace;
no dependency installation was attempted. No visible product source has changed.

The lean baseline's first attempt exposed a helper-only mistake: baseline mode
inherited the filter editor's390px Apply-filters scroll. The condition is now
restricted to actual filter/source modes. Corrected capture passed with four
inspected frames: `selection-before-material-final-{1100,390}-dark.png` and
`selection-before-knowledge-final-{1100,390}-dark.png` in the owned root.
Real Japanese Knowledge count was218923; Material had five real retained entries.
No blank/overlapping frames were observed. After cleanup: footprint2412770432,
available7101726720, pressure1, swapUsed4012113920, swapOut67667247104.
These are browser-layout/native-owner baselines, not native compositor acceptance.

Shared selection UI is now uncommitted in `features/collection`, with both
screens reusing their exact native browse query for selection. Ordinary browsing
keeps controls collapsed. Explicit activation supports individual row toggles,
select-all-matching, retained-handle recovery, clear and lost-receipt retry.
Replaced unpinned snapshots release; bulk-pinned snapshots stay retained.
Only visible bounded membership enters React; filters/pages do not rewrite
the frozen native handle. All four touched UI files had clean LSP diagnostics.
Serial typecheck/lint/export and actual native-backed desktop/narrow captures
passed: owned-root `management-selection-ui-verify.log`. All eight collapsed/
active Material/Knowledge frames at1100/390 widths were inspected. Individual
selection and clear returned real native receipts; controls stayed contained
with the actual218923-entry Japanese catalog. This is not a full-corpus bulk
run or native-compositor parity gate. Final guard sample:
footprint2536076416, available6618021888, pressure1, swapUsed3986948096,
swapOut67667247104, projected headroom4419393458.

The new real-native web regression covers nonadjacent-page selection,
filter refresh, original edit revisions, native restart recovery, loss of a
committed amendment receipt followed by identical-command retry, select-all
beyond the visible page, and explicit release. It retains the real SQLite and
package owners; only the response delivery is interrupted. That test and the
existing Material collection flow both passed serially in5.9s under the guard:
owned-root `management-selection-recovery-tests.log`. The actual lost response
was delivered only after the native amendment committed; retry submitted the
identical command and retained one live snapshot, not a duplicate. Select-all
retained all25 identities beyond the24-row visible page. Native restart kept the
original selected revision1 despite a subsequent authored revision2. Explicit
clear released the handle without changing authored content. The light-theme
desktop/narrow25-item frames were inspected as well as the eight dark-theme
Material/Knowledge frames. Final sample: footprint2569254016,
available6600294400, pressure1, swapUsed3986948096, swapOut67667247104,
projected headroom4452810752. Fresh LSP diagnostics for
the new test timed out; this is not reported as a clean diagnostic. All product
UI diagnostics remain clean. MAT-06 and the milestone remain incomplete.

Shared selection UI committed/pushed as
`910aac71216c70178f477a1c3c4249336e471db2`. Its desktop40685089659 and
foundation40685089644 passed; mobile40685089625 remains under its final-only observer.
The f074bc70 mobile observer timed out without a workflow verdict. Its actual
readback showed Android122783458222 passed and iOS122783457953 still running;
a final-only observer was renewed, not the workflow. No native device was
launched and no iOS diagnostic variant was dispatched.

Uncommitted `CollectionBulkActions` now uses the existing typed native worker
for add/edit/exclude/include/remove, confirmation with frozen scope, recovery,
status/cancel/retry, bounded per-item results and result release. The first
typecheck/lint/export passed and all four affected product UI diagnostics were
clean. Render log: owned-root `management-bulk-ui-first-render.log`.
The same-session Knowledge capture hit projected headroom4258463744 below the
unchanged4294967296 reserve. The next split-session attempt released each
browser/native owner before the next consumer; Material captured, but Knowledge
still hit4276436992 at footprint2884220032, available6423920640, pressure1,
swapUsed3986948096 and unchanged swapOut67667247104. Log:
`management-bulk-ui-split-render.log`. No complete bulk UI render gate passed.
Material screenshots exposed capture focus/scroll framing, not evidence of
missing controls; the helper now focuses/reveals the leading selection control.
Capture tags preserve the earlier verified selection evidence.

The new bulk native-UI regression is written but not run. It holds delivery of
an already committed start receipt, exercises the independent cancel/status
channel, then checks stale revision refusal, reselection, exclusion/inclusion,
destructive confirmation focus, removal labels and restart retention.
Cancellation publication and exact-opener focus remain explicit review concerns
to reproduce/fix before any bulk checkpoint; no passing workflow is claimed.

Knowledge-only capture succeeded after three samples with at least7GB available
(extra launch margin, not a reduced guard). Active desktop/narrow frames were
inspected: `bulk-controls-framed-selection-active-knowledge-final-{1100,390}-dark.png`.
The real218923-entry catalog, frozen selection and add/distinct/recovery controls
remained contained. Log: `management-bulk-knowledge-render.log`. After cleanup:
footprint1631777920, available7262912512, pressure1, swapUsed3936616448,
swapOut67667247104. Material's final framing and functional dialogs still need
fresh evidence; earlier clipped capture positions are not a visual pass.

The first bulk GUI regression run is active with serial typecheck/lint/export:
owned-root `management-bulk-regression-baseline.log`. It must establish the
held-receipt cancellation and destructive-focus behavior before repairs.
The new test's fresh LSP diagnostic timed out; no clean test diagnostic is claimed.
That first run stopped before any check/test command launched: the new guard's
initial sample had projected headroom4292673536, just below the unchanged
4294967296 reserve, with OmO footprint4158944384. No owned verification process
survived inspection. There is no test assertion verdict. The continuation adds
the same measured7GB/three-sample launch cushion that admitted the successful
Knowledge capture, then retains the original2GiB workload/4GiB guard throughout.
Do not do concurrent local work during that run or call this memory incident
resolved. Next log: `management-bulk-regression-admitted.log`.
That admitted run passed typecheck, ownership lint and web export, then stopped
at the resource guard after the single regression started. It has no assertion
verdict. The intermediate `Architecture boundaries passed` match woke the model
during verification; that unwanted wake is now removed by using only the final
MATERIAL_COLLECTION sentinel. No memory root cause is inferred from timing.
Stopped sample: footprint4021302400, available6370885632, pressure1,
projected headroom3560547105 including growth662854879, unchanged swap.
No owned verification process survived inspection. The test-only continuation
reuses the passing, unchanged export/checks and waits for the same7GB launch
cushion. Next log: `management-bulk-regression-final-only.log`.
The final-only test continuation reached a real assertion failure with healthy
resources: native control reported `completed · 3 of 3 processed`, but
`Cancel bulk operation` still had count1 instead of0 while the original start
response remained held. This is a reproduced UI publication bug, not a resource
failure. Log: `management-bulk-regression-final-only.log`; first trace/results
remain in owned-root `bulk-ui-tests/results`. Its automatic failure screenshot
was taken after teardown had closed the backend, so its fetch/write errors are
not accepted as additional product findings.

The minimal repair retires a matching local submission only after native terminal
cancellation acknowledgement, and makes late start/retry responses verify their
operation token before publishing. It also clears the invalidated read's loading
flag before control. Product diagnostics are clean; the repaired test has not
yet run. The next export/test uses separate `bulk-ui-tests/cancellation-fix`
artifacts and `management-bulk-cancellation-fix.log`. Remaining review concerns:
exact opener focus on destructive confirmation, truthful Knowledge actions
before any selection exists, and cursor reset if a retained job disappears.
Cancellation-fix run passed typecheck/lint/export and the prior terminal-status/
Cancel-absence assertions. It then failed in the test harness:
`route.fulfill: Route is already handled!`, while the next exclusion was
submitting. The test removed interception before the held handler finished.
It now uses `unrouteAll({ behavior: 'wait' })` before advancing, and guarantees
native cleanup in a nested finally. Product assertions were not weakened.
Trace/log remain in `bulk-ui-tests/cancellation-fix` and
`management-bulk-cancellation-fix.log`. The test-only continuation will use
`bulk-ui-tests/route-drain` and `management-bulk-route-drain.log`.
The f074bc70 mobile observer has now finished with failure; Android was already
verified passing, so retain the iOS verdict and retrieve its exact failed-step
evidence after the serial local regression, without rerunning the workflow.
Route-drain run passed held-receipt/terminal acknowledgement, stale revision
refusal, fresh reselection, exclusion and inclusion. It then reproduced
destructive-dialog focus loss: `Remove selected` was inactive after Cancel change.
The shared confirmation target was always the Edit/Add ref. The repair retains
the actual Add/Edit/Exclude/Include/Remove opener before opening each proposal.
The pre-fix removal dialog capture was inspected; it shows the real frozen
three-item scope and retention/no-undo consequences, not a staged modal.
Log/artifacts remain `management-bulk-route-drain.log` and
`bulk-ui-tests/route-drain`. The next run rebuilds the changed product source
and preserves separate `bulk-ui-tests/focus-fix` evidence. Its fresh product
LSP check timed out, so typecheck still needs to confirm the edit.
Focus-fix run passed typecheck, ownership lint, export and the complete native
Material GUI regression in3.0s. It verified held-response control, exact focus
return, stale-revision refusal, edit/exclude/include/remove receipts, retained
removal labels and native restart. All three removal/confirmation desktop/
narrow captures were inspected under `bulk-ui-tests/focus-fix`. Log:
`management-bulk-focus-fix.log`. Final sample: footprint1682797696,
available6842941440, pressure1, swapUsed3928227840, unchanged swapOut67667247104.
Bulk add through Knowledge, result retry/release UI and remaining recovery
boundaries are not yet a completed four-action gate.

Two focused regressions now protect the remaining concrete recovery concerns:
the existing unavailable-Knowledge test checks truthful add-only actions before
any selection, and a new real25-item/two-job case clears the selected job from
another consumer before Next results. Its surviving job must reset to page1.
These tests are about to run against the current unmodified product logic;
no assertion was weakened and no full-catalog preparation is required.
Both boundary regressions failed specifically as predicted: the replacement
job's First-result-page action stayed enabled (foreign cursor retained), and
empty Knowledge had no disabled Add-selected action because it incorrectly
rendered Material-edit actions. Baseline log/artifacts:
`management-bulk-boundary-baseline.log`, `bulk-ui-tests/boundary-baseline`.
The small fixes now choose actions from the explicit collection surface and
reset the cursor when the retained job identity changes. The next guarded run
rebuilds these changes, repeats the complete Material workflow and both boundary
cases, and captures empty Knowledge/recovery and narrow removal confirmation.
No test expectations were relaxed. Next log:
`management-bulk-boundary-fix.log`; artifacts `bulk-ui-tests/boundary-fix`.
Boundary-fix run passed typecheck, ownership lint, export and all three native
GUI scenarios in5.6s. Empty Knowledge, narrow destructive confirmation and
replacement-job recovery frames were inspected. Final sample:
footprint1681896576, available6845399040, pressure1, swapUsed3928227840,
unchanged swapOut67667247104. The cursor scenario is now extended to exercise
the real Retry-unfinished and Clear-results controls, explicit selection release
and released-command replay without changing authored revisions; that extension
is not yet run.

The retained-corpus helper now has a package-grounded bulk-add probe using the
actual Japanese search/results, not synthetic target records. It will drive
default addition, a duplicate attempt and explicit distinct addition, inspect
their native receipts/content/source absence, clear each job through the UI,
compare learner-state projections, restart the native owner and replay cleared
commands without rebuilding results. It preserves the isolated corpus/profile
and any new authored records; no model/device or Python inference is involved.
Helper syntax passed; actual execution is pending. Next log:
`management-bulk-japanese-add.log`, with separate `bulk-add-*` capture tags.

Exact f074bc70 mobile40678063651: Android122783458222 passed;
iOS122783457953 failed the Watch assertion at2026-10-28T12:33:13Z:
`Assertion is false: id: m01-watch, mp4 is not visible`.
Log: `ios-f074bc70-failure.log`. The earlier observer timeout was not a verdict.
No diagnostic variant, rerun, platform waiver or local device launch was made.
The first real Japanese add created `愛猫`, target`jmdict:1151020`,
Material`material-c25bba474af3b03b7839f5806f587f7c3dd93abe50a13f610fe6f577b82167e9`,
revision1, from command`8be3735f-bc2e-4f18-82a1-e015bfcd09d4`. Its native
receipt had `reused:false`, a real default sense and no source association.
The next add returned that same ID/revision with `reused:true`, not a duplicate.
The helper's expectation was wrong. Read-only SQLite receipts and the existing
Material identity/policy tests confirm exact-origin reuse is intentional and
preserves authored edits. No backend identity, duplicate policy or assertion
was changed to fit the probe. The failed job remains retained as evidence.
Native binary SHA256:8a11d5e95899a3a9a4d117bdfd6c1a8d403e35ca82e56ea227fc9889444f6136.

The bulk UI now labels native reused outcomes as Reused rather than Saved, and
its confirmation explains exact reuse separately from other matching entries.
The corrected probe checks default/reuse/duplicate/distinct as four separate
outcomes. For a genuine different-origin duplicate, it will bind only the
explicitly identified QA-created Material above to an authored one-word
`bulk-add-source.txt` functional fixture containing its actual headword.
The real document parser supplies source ID/revisions/block/UTF-8 coordinates;
the existing native edit owner accepts that association. This is an authored
functional input, not fabricated reference-corpus data or a staged UI.
Other profile content and prior failed receipts remain untouched.
The subsequent source-free add must report a duplicate, and explicit distinct
must create a new item. Restart checks include the deliberate fixture edit.
Learner comparison covers key/claim/assessment/prediction/status, not incidental
projection revision. Next log: `management-bulk-japanese-outcomes.log`.

That corrected Japanese run passed typecheck, ownership lint, web export and
real native default/reuse/different-origin duplicate/distinct workflows. Its
default attempt reused the item retained from the earlier successful creation;
it is not a second new-create verdict. Reuse preserved the same ID/revision1;
different-origin addition reported one duplicate; distinct created
`material-bdf54ef722daada20ce23a44355c6bbcf1bc7759bb3749469a9357a49295fbd0`.
Native restart retained authored content, Knowledge claim/assessment/prediction/
status stayed unchanged, and cleared-command replay did not rebuild results.
Provider requests remained zero. Desktop/narrow reuse/result and confirmation
captures under `bulk-outcomes-*` were inspected; browser/native owners closed.
Cleanup sample: footprint1723888744, available7590445056, pressure1,
swapUsed3928227840, unchanged swapOut67667247104.

Final serial regression run1499 stopped during the second of five native GUI
scenarios at the unchanged resource guard, not a test assertion. The Material
editor suite did not start; the newly extended Retry/Clear case has no verdict.
Log: `management-bulk-final-regressions.log`; artifacts `bulk-ui-tests/final`.
Stop sample: footprint3709564008, available6264913920, pressure1,
projected headroom4117430272 below reserve4294967296. No owned browser/native
QA/guard process survived inspection. Post-stop footprint4938691688,
available8313896960, swapUsed4973658112 and swapOut69005623296 demonstrate
unexplained OmO growth and swap increase, not a resolved resource incident.
Bounded vmmap showed footprint4.4GiB, historical peak14.4GiB, App-Specific
Tag1 resident4.1GiB/dirty2.4GiB; eval heap was about51MB, external26MB.
The tag owner remains unidentified. Pause substantial verification while
investigating; do not relax the 2GiB workload reservation or 4GiB reserve,
restart devices/models, or attribute this allocation to them.

Idle-only monitor1500 observed 12 samples over55s: footprint fell from
4669273192 to1609659520, available rose from7691075584 to9582444544,
pressure stayed1 and swapOut stayed69005623296. It relaunched nothing.
The tagged allocation owner remains unidentified; stabilization is not a fix.
With fresh headroom and unchanged safeguards, run1501 passed all five targeted
native GUI scenarios in11.4s and all20 existing desktop/narrow Material editor
checks in8.4s. This includes the extended Retry/Clear controls, native selection
release, released-command replay and unchanged authored revisions/exclusion.
Log: `management-bulk-final-stable.log`; artifacts `bulk-ui-tests/final-stable`
and `bulk-ui-tests/final-stable-editor`. Final recovery-phone and destructive
confirmation-desktop frames were inspected against the earlier final-source
dark desktop/narrow addition and light Material captures. These are real native
owner/browser flows, not native compositor or platform acceptance.
Final guard sample: footprint1612854400, available7515422720, pressure1,
swapUsed4872994816, unchanged swapOut69005623296, projected headroom5367939072.
No Rust/protocol source changed after the117-storage/26-client passing boundary
checkpoint; those checks are reused, not falsely reported rerun.

Bulk UI checkpoint134fac93 is committed/pushed on the existing stacked draft.
Automatically triggered exact-source gates: foundation40697502070,
desktop40697502407 (passed), mobile40697502478; final-only observers1504–1506.
No workflow was manually dispatched and neither draft PR was merged.
Selection910aac71 mobile40685089625 ended with Android122818463123 passing
and iOS122818462698 failing during `Exercise actual iOS UI and Rust persistence`.
Its exact failed assertion still needs retrieval; this is not a platform pass.

The proposal-storage candidate introduces Schema18 with bounded12-item/
192KiB pages and at most128 pending drafts. Proposals preserve source/package/
dictionary identity; replacements retain their original Material revision and
media owner. Acceptance reuses the existing transaction-scoped Material
create/edit functions and commits its result receipt in that same transaction.
Digest-checked receipt replay cannot resurrect rejected drafts or deleted
Material. Normal duplicate detection leaves the proposal pending for an explicit
distinct decision. Five new real-SQLite tests cover edit/reject/restart/evidence
separation, injected acceptance-receipt rollback and replay, duplicates,
concurrent authored revisions and bounded paging/capacity. Existing migration
assertions move the current version17 to18 and future-version rejection18 to19;
no historical-data assertion is removed. A shared authored-text patch operation
now serves the existing bulk owner and proposal editing. New native modules have
clean LSP diagnostics. The whole storage suite must pass before this native
candidate is verified, and the generation/provider/UI work remains open.

Proposal storage run1507 passed all122 storage tests, including the five new
draft/receipt/CAS/paging cases and all existing migration/data/evidence checks.
Log: `material-proposal-storage-verify.log`. Existing unused `practice` fixture
warnings remain. Final sample: footprint1613395072, available7148306432,
pressure1, swapUsed4780720128, unchanged swapOut69005623296.
Native proposal metadata now routes suggest/read/list/edit/accept/reject/Return
through the existing runtime/store. Fresh source drafts cannot claim invented
dictionary IDs; replacement proposals retain the existing Material's trusted
identity and are usable without an optional provider. Two new runtime tests
cover actual JSON dispatch, explicit acceptance, restart/receipt recovery and
forged identity refusal. A typed client adds bounded nested validation, command/
revision correlation, immutable-basis checks, stable lost-receipt retry and the
existing source-cancellation lane. New client tests cover adversarial packets
and exact retry. Integration verification and Rust-generated types are pending;
stale-generated-type LSP errors are not suppressed or claimed passing.
Exact bulk134fac93 foundation40697502070 and desktop40697502407 passed;
mobile40697502478 remains under its existing observer.

Proposal transport run1508 passed Rust contract generation, all122 storage
tests, both new runtime proposal tests, all five existing native Material tests,
typecheck, ownership lint and all28 targeted client tests. Log:
`material-proposal-transport-verify.log`. Existing ts-rs attribute and unused
`practice` fixture warnings remain. Final sample: footprint1636971648,
available6794870784, pressure1, swapUsed4755554304, unchanged swapOut69005623296.
Fresh proposal-client diagnostics were clean after generated types landed.
Review then found an invalid extra restriction: replacement proposals must
preserve an existing Material whose target language differs from its original
source language. The focused new storage regression reproduced
`Invalid("Proposal source belongs to another language package")` against the
original predicate, with healthy resources, in run1509. Baseline log:
`material-proposal-language-baseline.log`. The repair limits that same-package
check to fresh source-text proposals; replacements still preserve exact existing
source/dictionary identity. A corresponding typed-client test protects that
separation. The repaired six-proposal/29-client candidate needs final recheck
before commit; provider generation and review UI remain incomplete.

Final proposal run1511 passed Rust contract generation, all123 storage tests,
both native proposal tests, all five existing native Material tests, typecheck,
ownership lint and all29 targeted client tests. The cross-language regression
now passes without changing existing identity/provenance assertions. Log:
`material-proposal-language-fixed.log`. Final guard sample:
footprint1638626432, available9004613632, pressure1, swapUsed6674579456,
swapOut71275069440. Swap increased during this interval despite the final low
OmO footprint; do not call the host allocation incident resolved or blame an
unobserved device/model workload. This is a verified native proposal/transport
increment, not generated-provider behavior, GUI completion or MAT-07 acceptance.
Next integration must reuse the existing native generation worker, provider
settings/session credential, trace and cancellation owners, not add another
queue or a renderer-owned parser/admission path.

Native proposal checkpoint42d13e66 is committed/pushed on the existing stacked
draft. Exact desktop40703061791 passed; mobile40703061767 remains under its
existing observer. Foundation40703061724 passed Rust/web/OCR/macOS but failed
Windows122871010373 at2026-10-28T14:27:12Z during actual native theme input:
expected Dark Quartz JSON, received unchanged Slate JSON. The runner reported
the expected clipboard/focused editor. This is an observed input-loss failure,
not a diagnosed cause or an overall foundation pass. Its failed job log was
retrieved; no diagnostic variant, workflow rerun or local device was launched.

The uncommitted generation integration reuses ConversationOwner's single
provider worker, session credential, settings, bounded SSE transport, trace,
explicit retry and cancellation. New source/Material generation admission and
its marker commit in the existing conversation receipt transaction. Schema19
adds only bounded generation-review metadata; actual submitted input/output
stay in the existing conversation content owner. Ordinary conversation text or
an edited purpose cannot authorize proposal admission.
Native collection is explicit and atomic after complete/failed/interrupted
output, preserves good JSON lines with per-candidate failures, rejects invented
dictionary/source fields, and derives UTF-8 quote occurrences from the original
selection. Cancelled/invalidated work cannot be collected. Existing Material
revisions fence generation publication and replacement collection; retry keeps
the original inputs and uses the same worker. No automatic learner evidence or
Material acceptance is introduced.
Three new SQLite scenarios cover partial UTF-8 grounding/restart/retry,
collection rollback/replay and stale/cancelled admission. Three event-driven
native HTTP/SSE tests exercise actual common-provider generation/collection/
acceptance, shared worker admission/cancellation and missing-provider retention.
Two typed-client tests cover held/lost admission receipts, independent control
and bounded/correlated recovery reports. None is run yet. Native diagnostics are
clean; generated TypeScript is stale until the next guarded integration run.
The review UI and real app/provider-fixture workflows remain open.

Shared generation run1517 passed Rust contract generation, all126 storage tests,
all six native conversation/provider tests (including the three new generation
cases), both native proposal tests, all five native Material tests, typecheck,
ownership lint and all43 targeted client tests. Log:
`material-generation-native-verify.log`. These tests use the actual shared
native HTTP/SSE worker and event subscriptions, not a renderer parser or mocked
state transitions. Source quotes/UTF-8 occurrence ranges, partial failures,
explicit collection/acceptance, exact replay, provider absence, shared worker
admission and cancellation are verified. No application UI is yet connected.
Final sample: footprint1634792576, available7031128064, pressure1,
swapUsed4001038336, swapOut71340490752; the guard retains its 2GiB workload and
4GiB reserve. Historical OmO allocation/swap growth remains unresolved.
The next visible increment must reuse the existing shared Material editor/control
owners, expose saved proposals and retained generation recovery without an
optional provider, and verify real desktop/narrow source-grounded workflows.

Shared generation checkpoint87c73fe2 is committed/pushed on the same stacked
draft. Automatically triggered gates: foundation40707752973,
desktop40707752998 and mobile40707752976, under final-only observers1521–1523.
Proposal42d13e66 mobile40703061767 ended cancelled with no jobs reported;
it supplies no platform verification verdict. Bulk134fac93 Android122851408995
passed; iOS122851408394 was still running on readback and has observer1519.
No workflow was manually rerun or cancelled.
Before the first proposal-review presentation edit, a serial native-example
rebuild/web export will capture the unchanged Material grid and existing shared
editor at1100/390 widths in the retained isolated corpus profile. The current
normal preview PID2637, started October24, was inspected and reused, not
restarted. Temporary capture scripts pass node syntax checks; their out-of-tree
TypeScript LSP initialization remains unavailable. Capture tag:
`generation-ui-before`; next log: `material-generation-ui-baseline.log`.
No application UI source has changed in this increment yet.

Pre-edit run1524 passed native-example build, web export and all four fresh
Material grid/editor captures at1100/390 widths; all four frames were inspected.
The actual retained corpus still has seven authored entries. Native QA binary
SHA256:de537b9b71f328e478080ca5ef5b362597933c44d8e87dad9f1a3f822434326b.
It includes87c73fe2 and migrations18/19, not the earlier bulk-only binary.
Log: `material-generation-ui-baseline.log`; frames `generation-ui-before-*`.
Cleanup sample: footprint1612051584, available7910965248, pressure1,
swapUsed3959095296, unchanged swapOut71340490752.

The first presentation change extracts existing authored fields/examples and
read-only source/sense references into controlled `MaterialFields`, reusing the
same semantic controls, labels, limits and spacing in the ordinary editor.
Phrase edits still revoke explicit audio target bindings; staged media and
native save ownership remain in MaterialEditor. This is the field owner for the
upcoming proposal editor, not a second authoring authority. Both touched UI files
have clean LSP diagnostics. Typecheck/lint, draft guard, all20 existing editor
interactions and fresh desktop/narrow renders must pass before the next visible
change. Log: `material-fields-ui-verify.log`; capture tag `material-fields-after`.
The proposal-review controls and source entry points are still unimplemented.

Exact bulk134fac93 iOS122851408394 failed at2026-10-28T14:40:50Z:
`Assertion is false: id: m01-watch, mp4 is not visible`. Its native failed-step
log was retrieved; Android passed. This is not a platform acceptance pass or a
diagnosed common cause. Generation87c73fe2 desktop40707752998 passed; its other
hosted gates remain under their existing final-only observers.

Exact selection910aac71 iOS122818462698 failed at
2026-10-28T13:38:50Z: `Assertion is false: id: m01-watch, mp4 is not visible`.
This was retrieved from the failed job log, not inferred from its step name.
Bulk134fac93 mobile40697502478 observer timed out; actual readback has both
iOS122851408394 and Android122851408995 still running. Final-only observer1510
was renewed without rerunning the workflow or launching a device.

910aac71 mobile40685089625 observer timed out; actual readback has
Android122818463123 passing and iOS122818462698 still running. Renew only its
final-verdict observer, not the workflow.

Exact 8eec14d hosted gates: real desktop 40629230952 passed. Foundation
40629230889 also passed; mobile 40629230832 is pending under observer 1330;
no extra workflow was dispatched. The working tree retains only the four
original untracked files plus this continuation record and the new Material
collection test and current Material integration edits. Guarded baseline 1331
seeded 52 actual authored entries without a prepared catalog and failed at the
absent count. Its actual pre-edit desktop frame was inspected. Material now uses
the same native collection API for count, sort, text/source/exclusion predicates
and opaque paging, without changing its authoring/source-return owner. Saving
resets the cursor and a removed opener restores focus to the real heading.
Targeted run 1332 passed: typecheck/lint/export, the real-native paging/edit/
exclusion/restart flow and all 20 existing desktop/narrow Material interaction
tests (8.2 seconds). The fixture transport now returns the typed collection
response; its original assertions and request budgets are preserved.
The fresh 1080x900 and 390x844 native-backed captures were inspected: real
24-of-52/51 counts, fitting sort controls and rows, working edit/exclusion,
first-page/focus reset and durable membership. All owned processes were absent
in 1333; the guard remained healthy at 4.66 GB projected headroom, pressure 1,
declining swap. MaterialScreen LSP was clean; the new test's freshness timeout
was not labeled a clean diagnostic.
Material's final card-grid reference conformity remains open, not inferred from
the current functional list or the other surface's My learning reference.
Before a new deliberate Material reference capture, revision
`1ab95600bee97017635afe538af4e890e0cded3a` and its clean tracked source were
rechecked, ports 3000/7752/7753/9229 were free, and only selected settings from
the retained isolated profile were inspected: selected UI, Dark Quartz,
Japanese, OCR/voice/LLM disabled. Nothing was automatically restarted.
The functional Material increment is committed/pushed at
`34da32d4f1d7896efaab04702f0ed77cda7f44f2`. Its foundation 40632466774 and
desktop 40632466768 gates passed; mobile 40632466908 remains pending.
Older 8eec14d mobile 40629230832 failed. Android job 122621426915 passed.
iOS job 122621426713 failed `Exercise actual iOS UI and Rust persistence`;
its retrieved log confirms the unchanged Watch assertion at 04:48:54 UTC on
October 28: `id: m01-watch, mp4 is not visible`. Fixture-copy commands appear
in that same failed-step log. No diagnostic variant or rerun was launched.
Read-only final-verdict observer 1343 remains active for 34da32d.

Deliberate reference job 1339 reached the real Material view, then its explicit
pre-capture resource check rejected projected headroom 3613737876 below the
unchanged 4294967296 reserve (OmO footprint 3562108008, pressure 1).
It closed the owned app/process group, browser, servers and guard; 1341 confirmed
no matching processes. No image or visual pass is claimed. Intermediate CI
notifications have been silenced in replacement observers, and the next attempt
will be launched last, after setup is complete, with a stronger 2560 MiB startup
forecast and unchanged 1536 MiB running policy/4 GiB reserve. The normal isolated
reference launch, real bridge window action, event subscriptions, measurements
and cleanup are owned by `material-reference-capture.mjs` in the execution root.
No product UI changed after its inspected passing render.
Reference retry 1346 passed with stable physical footprint about 1.46 GB,
pressure 1, flat/declining swap and 4.93/5.10 GB projected headroom. It closed
all owned processes before notification; 1347 confirmed absence. Both actual
empty-state images were inspected. At 1100x760 logical pixels the sidebar is
220 px and toolbar is 880x89 with 24 px padding; at 390x844 the closed navigation
uses a 49 px header and the toolbar is 177 px tall. No card geometry is claimed
from an empty library.

The next deliberate capture uses the same helper's `filled` mode: add only
three fixtures through the reference's real modal and persisted authoring path,
then measure/capture the actual cards at both widths. Existing empty images and
profile data are preserved. The legacy Input's unattached visual label was
confirmed in source; automation targets the actual placeholder-bearing control,
not a DOM/state patch. Do not reproduce that accessibility defect in v3.
Launch remains the last action under the stronger startup forecast and unchanged
running policy; inspect results only after its owned cleanup.
Filled attempt 1348 stayed healthy but failed before any authoring because its
snapshot-metadata matcher did not identify Add Card. Its owned processes closed
and 1349 confirmed absence. The driver now uses supported CSS locators rooted
in the source-verified sidebar, actual form and actual modal footer. The fields,
save action, persisted-card witness and all resource checks are unchanged.
Filled job 1350 successfully authored and persisted the three fixtures through
the real form. Its inspected desktop capture confirms two 408 px card columns,
16 px gaps, 24 px grid/card padding, 12 px card radius, 24/36 lexical text,
12/12 ruby and 14/19.6 translation text. The narrow image caught the responsive
drawer mid-transition and is not valid final layout evidence. The driver now
awaits the actual Web Animations completion after resize, bounded by a failure
deadline, before measurement; it does not disable animation or stage the DOM.
Job 1350 closed owned processes and kept pressure 1 with declining swap and
4.76–4.80 GB phase headroom. The underlying OmO allocation remains unexplained.
Settled capture 1351 passed and its narrow image was inspected: sidebar fully
closed at x=-280, one 334 px card column. The legacy narrow bulk toolbar clips;
that defect is not a responsive target. Cleanup receipt 1352 confirmed no owned
reference processes/listeners. Material's first layout change now uses spacious
shared Panels in a measured-width wrapping grid, shared entryTitle/caption Text
roles, visible authored reading and compact real actions. Search/order/count
and filters moved into the existing bounded header. No second visual edit
may precede rendering/inspection at desktop and narrow widths. LSP reports no
MaterialScreen errors; guarded typecheck/lint/export/native regression plus the
existing Material interaction suite are next. Final sidebar/compositor fidelity
and consuming-native verification remain open.
Verification 1353 stopped before commands began: its first resource sample
projected 3863592960 bytes headroom, below the unchanged 4 GiB reserve.
No test/build result or rendered layout is claimed. The retry first waits for
the existing admission policy's three safe samples, then runs the same guarded
serial checks. Workload forecast and reserve are unchanged.
Run 1354 passed typecheck, lint/architecture, web export and the actual native
collection workflow (2.5 seconds). Both resulting images were inspected before
the next visual edit: cards reflowed without overflow, but navigation/creation
still occupied the main toolbar instead of the reference sidebar. The next
change moves those existing controls into AppShell's existing navigation slot;
it does not create alternate controls or state owners. At the intermediate
test notification OmO footprint rose to 3239195776 bytes and the guard stopped
before the editor suite (headroom 3373616918, pressure 1, unchanged swap).
The suite is not claimed passing for this source. Retry notifications are
final-only to avoid waking the active model during serial verification.
AppShell's shared 200 px navigation differs from the reference's 220 px rail;
native window/compositor and matched Japanese dark-state evidence stay open.
Run 1355 completed with exit 0: typecheck, lint/architecture, export, native
collection workflow (2.1 seconds), and all 20 existing Material interaction
tests (8.1 seconds). Its desktop and narrow images were inspected: two card
columns beside navigation on desktop, one column below wrapped navigation and
controls at 390 px, with no clipping. Cleanup 1356 found no owned test/guard
processes; `git diff --check` passed. This is native-core browser evidence,
not consuming-native GUI certification. The final guard sample was pressure 1,
footprint 1550005376, headroom 7021690880. Swap increased to 4594073600 and
swapOut to 60105834496 during this interval; cause is not attributed or resolved.
The fresh post-cleanup sample was footprint 3095262336, available 7175651328,
pressure 1 and swapUsed 4577296384. Further substantial work requires fresh
stable admission; no devices/models have been started.
Committed 34da32d mobile run 40632466908 finished failed: Android job
122638181427 passed; iOS job 122638181218 failed the actual UI/persistence
step. Foundation/desktop passed. Exact iOS assertion retrieval is in 1358;
no rerun or diagnostic variant has been dispatched.
The retrieved assertion differs from the older missing-row failure:
at 05:38:43 UTC on October 28, `Watch Inspector Knowledge and native source
resume` failed after 6m32s with `Element not found: Text matching regex:
Open local video, Enabled`. This remains an unresolved consuming-iOS failure.
Next capture reuses the retained Japanese native profile, authors only three
real Material fixtures through the normal editor, and captures the normal
persisted dark theme at desktop/narrow widths. Its helper closes browser,
native QA host and guard before final-only notification; the existing user
preview on 4173 is read-only and remains untouched.
Capture 1359 closed its owned workloads but failed before authoring because
the reference driver assumed a Japanese option `aria-label` the actual web
primitive does not retain. The primitive's installed source confirms an
Item/textValue boundary. The retry reads actual rendered option text and ID,
requires a unique Japanese option and clicks that existing node. This is a
driver repair, not a product failure or a staged state; no dark image is yet
claimed. Its resource samples stayed safe with flat swapOut and declining swap.
Capture 1360 established the actual menu labels `English` and
`Japanese · 日本語`; neither option has an ID. It again closed without
authoring. Stop extending CSS assumptions: the separate Material capture now
uses the installed Playwright accessibility locators from the passing native
suite, selecting the real `/Japanese/` option and exercising the same editor.
No dependencies, renderer DOM or native data are patched for capture.
Capture 1361 completed with exit 0 through the existing Playwright accessibility
harness. Both native-persisted Dark Quartz images were inspected after owned
cleanup: two 418 px columns at 1100 and one 342 px column at 390, authored
readings/meanings visible, long existing `able` definition wrapping correctly.
The retained earlier `able` Material is preserved: the real count is four,
not an artificially matched three. Three Japanese fixtures were authored through
the normal editor. No metadata/content was fabricated for the screenshots.
Phase headroom was 5.41 GB, pressure 1, flat swapOut 60256894976 and declining
swap at cleanup; OmO footprint 3657561216 remains unexplained. Diff/cleanup
1362 and 1363 inspected the actual product change; no owned capture processes
remained. Functional tests are from 1355; no product edit followed those tests.
This connected increment is `verified_for_continuation`, not full visual or
native acceptance. Sidebar width (200 versus 220), native materials and broader
M10 controls remain explicit follow-up gates; no M11 transition is authorized
until M10 passes its gates. Continue compound filter membership next.
Material layout checkpoint is committed/pushed as
`77c58abb7a21b9d225355120124f271921dee8e0`; only the four original untracked
files remained afterward. Exact hosted runs are foundation 40640068424,
desktop 40640068557 and mobile 40640068421, under read-only final observer
1369. No workflow was manually dispatched.

Compound-filter readiness: auditing the SQL owner found potentially nullable
equality in source and target-kind predicates. Negation may drop source-free
or unlinked Material rather than include it. A new owner-suite regression
creates real linked/unlinked Material and checks both counts and membership;
LSP is clean. Run it against unchanged product SQL before repair. This is
still a hypothesis, not a confirmed defect. The serial helper's `filter`
target runs only the storage collection suite with one Cargo build job,
2048 MiB forecast, unchanged 4 GiB reserve and final-only notification.
Baseline 1370 reproduced the native defect without product changes:
`negated_source_and_kind_filters_include_unlinked_material` failed at
collection.rs:688 with actual counts `[1, 0]`, expected `[2, 1]`.
The repair changes only the nullable `source_id` and joined `entity_kind`
comparisons to SQLite `IS`, making absence false before Boolean negation.
LSP reports no errors. The entire collection owner suite is next; the
regression remains unchanged and no acceptance assertion is weakened.
Verification 1371 passed all 13 real-storage collection tests in 0.25 seconds,
including the new red/green case and existing compound counts, paging,
revision-conflict, unavailable-scope, migration and persistence coverage.
Diff/cleanup 1372 confirmed the two SQL changes, unchanged original assertions
(the edit hook reformatted four existing assertions only), clean whitespace,
and no owned test/guard process. Post-cleanup footprint 3604460672, available
6744621056, pressure 1, swapUsed 4524736512, swapOut 60321775616.
This repairs native membership; the compound-filter controls are still pending.
The native repair is committed/pushed at
`92ad607aa053afcde49fbd303c6b849f0ab50701`. Exact hosted gates are foundation
40640874535, desktop 40640874478 and mobile 40640874659, under final-only
observer 1377. Earlier 77c58abb observation 1369 is retained, not canceled.

Compound-filter implementation now has one shared CollectionFilters editor
consumed by both Knowledge and Material, using existing shared controls.
Draft all/any/not composition is presentation state; native SQL still owns
membership. Package metadata supplies scope/level/kind/capability choices;
bounded recent sources/documents supply source labels. Material adds a distinct
collection language, retaining all-language browsing and its creation language.
Apply/clear/language changes reset opaque paging and reject stale results.
The UI retains native expression bounds with room for existing screen scope;
no language-code dispatch or whole-profile evaluation was added.
Knowledge/Material LSP found no errors; the new editor's freshness timeout is
not a clean diagnostic. The existing real Material regression now exercises
nested OR/AND/NOT: 19 exact entries, excludes entry-19, clears to 52, and captures
expanded desktop/narrow controls before continuing original persistence checks.
Render and inspect this connected change before any further visual edit.
Run 1378 passed typecheck, then ownership lint stopped before export/render:
Material imported the editor through Knowledge's private implementation path.
The editor now has one `features/collection` owner and public index, consumed
by both screens through that entry point. No ownership rule was changed.
Rerun the same guarded checks/captures; no rendered-filter pass is yet claimed.
Run 1379 passed typecheck, ownership lint, export, the real compound-filter/
paging/edit/restart test (3.2 seconds) and all 20 Material interaction tests
(8.4 seconds). Both expanded desktop/narrow images were inspected: the
19-entry nested OR/AND/NOT query has exact membership, clear returns 52, and
Apply/Clear remain reachable within the compact header's scrolling region.
No further product UI edit followed those captures.
The next serial QA reuses the retained prepared Japanese native profile, not
a new corpus export. It selects collection language separately, applies a
real package level and its negation on source-free Material, then level/scope/
Knowledge predicates on Knowledge. Expected counts come from independent
bounded native queries using the actual package metadata, not renderer
evaluation. It captures both consumers at desktop/narrow widths in the
persisted dark theme, then closes owned browser/native host/guard.
Saved-source choice UI is still awaiting a real source-backed flow; existing
Rust coverage is not being substituted for that remaining surface check.
QA 1380 passed using actual package metadata: JLPT N1 Material count 0,
negated level count 3; Knowledge JLPT N1 + JMdict + untracked Written
recognition count 3093, matching independent bounded native queries.
All four dark desktop/narrow captures were inspected. Compact controls use
the existing independently scrolling header; the next captures explicitly
scroll Apply into view rather than implying the truncated header is expanded
evidence. Headroom stayed about 5.0 GB, pressure 1, flat swapOut and declining
swap; owned cleanup completed before notification.
The remaining source check will reuse the retained actual m01 MP4/SRT, obtain
its real native cue and save that exact excerpt through the existing native
Material command in the isolated QA profile. Source IDs, media/subtitle
revisions and byte selection derive from that receipt, not fabricated anchors.
It will exercise positive/negated saved-source UI membership and source-free
retention. It also adds count-changing scope-negation/claimed-known cases to
the Japanese UI check, so unchanged positive counts alone cannot certify the
scope/state controls. No new media/model conversion or corpus export is needed.
Source QA 1381 saved the exact real cue and rendered its positive count 1,
but negation returned 0 and omitted source-free Material. Receipt 1382 found
the cause: the reused `target/debug/examples/runtime_browser_qa` was built
at 01:30:14+0100, before the SQL source edit at 06:52:46+0100. Its old SHA256
was `7241b87ebf9b514d69e0b7dc98118a8bbf17033ae1eaeabe10c96ba74b17658c`.
The storage test binary was current; this consuming QA executable was not.
Do not count 1380/1381 as integration proof of the native SQL repair.
Both positive source images were inspected after owned cleanup, but the full
source workflow remains failed until rebuilt/retested. The guarded runner now
explicitly builds `cargo build -p mlearn-runtime --example runtime_browser_qa`
with one Cargo job before browser QA; source mode records the resulting hash
and repeats the affected source and discriminating Knowledge flows. No product
assertions or profile data were changed to hide this failure.
Fresh-source QA 1383 passed after a 5.52-second serial runtime rebuild.
Executable SHA256:
`86f12be63649ce00e071ed37b8a7b4368e43a57b7878f1aa8fa6360b59ca1305`.
Real saved-source filter count 1 and negated count 4 now agree with native
membership and retain source-free Japanese Material. Source receipt:
`material-5ea00ceee177058ca2c600c9931e60c534c44dd0e4bc77d0aa3d0193b7cc0e72`,
cue 0, subtitle revision
`f4f15b8c43016470724075b3e2b5ba9f0c32ffbb94fcf5a00d2bef2e8d6b710d`.
Japanese scope negation and claimed-known selection each changed the count
from 3093 to 0; restoring untracked returned 3093. New negative-source and
Knowledge captures were inspected at both widths with compact Apply visible.
Headroom stayed 4.86–5.11 GB, pressure 1, flat swap/swapOut; cleanup completed.
The final targeted test addition exercises Excluded/Not Excluded via the actual
shared selector after restart, then removes the focused condition with Enter
and requires focus on the surviving group action. Run against unchanged UI
first; no focus repair or passing claim is made yet. Only this changed native
regression runs, reusing the already verified export and fresh QA executable.
Run 1384 confirmed Excluded count 1 and negated count 51 after restart,
then failed at line 113: removing the focused condition with Enter left the
surviving group Add condition action inactive. The failure screenshot was
inspected. The shared editor now retains live group-action refs, drops them
on unmount and restores focus/accessibility focus to the surviving parent
after removal. It does not apply an unsubmitted draft as a side effect.
Both editor and test LSP diagnostics are clean. Re-export and rerun the
unchanged regression plus the affected Material interaction suite next;
package/source counts remain reusable because no predicate translation changed.
Final filter run 1385 passed typecheck, ownership lint, export, current-source
native QA build, the expanded native workflow (4.6 seconds), and all 20 existing
Material interactions (8.5 seconds). The unchanged keyboard assertion now
passes; removal keeps the applied 51-entry result until Apply explicitly
returns all 52. The final narrow keyboard capture was inspected.
Cleanup/diff receipt 1386 found no owned verification/browser/native/guard
process and clean whitespace; the four original untracked files are preserved.
Final guard: footprint 1552249984, pressure 1, headroom 5073305600, declining
swapUsed 4222681088 and unchanged swapOut 60321775616. OmO allocation remains
unexplained, not resolved by these bounded passing runs.
Collection-filter behavior is `verified_for_continuation` (47/108 tracked items
done), not M10/native GUI/visual acceptance. Next: bulk stable selection,
supported add/edit/exclude/remove receipts, then grounded proposal review.

### Native modifier gate follow-up — M10 still in progress

Filters are committed/pushed at `a0e6c10acdd626b123c0365f2dcc417c29acddaf`.
Its exact gates are foundation 40644740351, desktop 40644740447 and mobile
40644740359 under observer 1391. Prior 92ad607 foundation passed; desktop
40640874478 failed, and its mobile run was cancelled, not passed. Failed native
job 122658452144 retained the original Shift-assisted pointer/Inspector
assertion at 06:04:24 UTC on October 28. Its failure image and geometry were
inspected: Children is visible and hit-testable, with no Inspector, but there
is no native modifier-event trace from that run. No product cause is established.
Artifact 12795363672 (54,718,970 bytes) is preserved under the owned execution
root's `native-ci-92ad607`; no model/device was launched to inspect it.

Earlier 77c58abb foundation/desktop passed. Mobile 40640068421 finished failed:
Android job 122655898465 passed; iOS 122655898116 failed its UI/persistence
step. Observer 1369's deadline was not a job verdict; continuation 1399 obtained
the terminal parent result. No hosted run was manually restarted or cancelled.

The original Inspector/no-new-claim assertions remain unchanged. The desktop
test now subscribes to actual native key/pointer events before input, requires
trusted Shift and mouse-entry delivery, moves through a real blank media point
instead of window chrome, releases Shift immediately after entry, and retains
up to 16 events in modifier-input.json. Listeners/timer are released in finally.
Node syntax, both embedded browser programs, ownership lint and whitespace
checks passed (1398/1401). Actual WebKitGTK execution is pending; this is not
a claim that the native failure is repaired. No renderer behavior or policy
was changed. A new tracked gate brings the ledger to 47/109.

Bulk audit: current Material create/edit/capture receipts are the mutation owner;
there is no core bulk/removal command yet. Collection filtering must remain the
selection authority, with stable native membership rather than a renderer-wide
library copy. Review admissions and authored-media references need retention
proof before removal; current media unreferenced checks inspect material_assets.
Do not delete learner claims/evidence or create a parallel learning owner.

The goal tool still holds the blocked historical visual goal. Registering the
new M10/M11 objective was rejected as an unfinished-goal conflict; it was not
falsely marked complete. Continue the current authorization/checkpoint, not the
obsolete goal's branch, milestone ceiling or resume workloads.

### Knowledge presentation — verified local increment, M10 still open

The new `/knowledge` route reads 24 bounded native targets, exact counts,
package-selected annotation capability, native ordering and opaque continuation.
Home and Material link to it. Shared AppShell gains an opt-in edge-to-edge
content inset; existing callers retain their defaults. LinguisticWord owns
lexical rendering and activation. Inspector now accepts an absent SourceAnchor:
source-only actions are absent and ordinary capture preserves `source: null`.
Messenger's contextual invalidation guard was updated for that explicit type.

Actual isolated reference `1ab95600bee97017635afe538af4e890e0cded3a` was
captured from My learning at 1100x760 logical pixels. The correct owners are
`windows/wordDbEditor/App.tsx` and `WordDbEditorLayout.css`, not the unrelated
conversation-memory browser. Reference and candidate captures are under
`mlearn-m10-m11.VLSN0zAbpw` in the execution note. Candidate Knowledge was
inspected at 1100 and 390 widths in light and native-persisted Dark Quartz;
shared lexical typography and badge stretching were repaired through existing
owners. Actual Japanese switching, search (`猫`: 147 entries) and descending
native ordering worked. A duplicated fallback reading beneath shared ruby was
removed; final desktop and narrow renders retain ruby without the repeated line.

With the complete authenticated corpus profile, source-free `able` lookup,
Written recognition claim and capture opened the original Material editor.
Native receipt `material-a0153fb2e38e304e5c8c26e82c3f8b49717a3543f808642d848187f331e8f60e`
has revision 1, target `wn30:a:00001740:able`, and `source: null`.
The list deliberately displays the package-selected Meaning projection, not an
invented aggregate of all capabilities.
The first real-native `knowledge-native-core.spec.ts` run failed before any
preparation request: a newly installed package returned `unavailable` with
`This package has no prepared collection catalog`, while the UI offered Prepare
only for an already-started `preparing` state. The completed manual-QA profile
did not expose this defect. The UI now offers preparation in either state when
the package actually declares a catalog. The unchanged native paging, claim,
capture and restart regression then passed in 2.0 minutes, including fresh-install
desktop/narrow captures and an explicit action-presence assertion.
Later-page claim invalidation was found to dismiss Inspector prematurely.
The verified repair defers collection refresh until Inspector closes, then
resets the invalid cursor and restores focus to the real Knowledge heading.
The real-native regression also verified that path and ordinary trigger focus
after reopening. Typecheck, ownership lint and export passed on that source.
The four existing Material source-return tests passed in desktop/narrow projects
in 2.7 seconds. Those source-bound assertions were not changed.

Final-source typecheck, ownership lint and export passed in run 1299. The only
product change after the passing native workflow was suppressing the duplicate
fallback reading when package ruby is present; English's unchanged path reuses
that workflow evidence. Japanese's affected rendering was inspected at both
widths: `knowledge-reading-final-1100-dark.png` (2200x1520, DPR 2) and
`knowledge-reading-final-390-dark.png` (390x844, DPR 1). These are real native
catalog results, not staged data or consuming-native window/material evidence.

Resource incidents remain findings, not erased by the pass. Guards 1260, 1283,
1288, 1298 and 1305 stopped for projected headroom; one export mistakenly started
alongside a returned stop was killed and not counted. All owned processes were
closed. A 3072 MiB speculative startup forecast held for 30 minutes without
launching work. The final smaller capture used the original 2048 MiB admission
and running guard, unchanged 4 GiB reserve, and explicit phase measurements in
one background job. Its first text probe failed and was corrected to observe
the actual count element; product code was unchanged.

Final capture 1318 passed and closed browser/native/guard before notification.
Pre-capture: OmO footprint 1567765608 bytes, available 6650707968, pressure 1,
flat swap 3710582784, projected headroom 4503224320 above reserve 4294967296.
Native main-process RSS was 169280 KiB; headless-shell main-process RSS was
94768 KiB (not whole-tree totals). Post-cleanup available memory was 6958661632
bytes with unchanged footprint/pressure/swap. PIDs 82822/82824 were absent.
The original preview PID2637 remains untouched. Full measurements, failed
attempts and captures are retained in the execution note/root. Unexplained OmO
physical-footprint growth is not repaired or attributed to product inference.

Material collection presentation, compound filters, remaining M10 flows,
preparation-control UI recovery/cancellation and consuming-native GUI verification
remain open. No M10 review/continuation or platform acceptance is claimed.

Final scope audit found that the snapshot callback replaces an explicit missing
package with the first installed language. A separate short native regression
now exercises unavailable-scope retention and explicit replacement at desktop
and narrow widths. Baseline 1320 reproduced the defect: the missing-package URL
rendered English with no error. The one-line repair retains a nonempty requested
package ID; only an initially unspecified scope chooses the first language.
Run 1322 passed typecheck and lint, then export failed because the temporary
runner supplied an empty `CI` environment value. After unsetting that value,
1323 passed export and the native error/recovery test in 1.7 seconds. Its
desktop/narrow captures were inspected: the unavailable scope remains visible,
controls fit, and explicitly choosing English restores real preparation.
Owned test processes and guard are closed (1324); memory checks stayed safe.
The current exported bundle is `index-e75e1b012bad48abcd15c06848270333.js`.

Exact42ff2f4 hosted receipts: foundation40615392019 and desktop40615391965
passed. Native40615391983: Android122576576230 passed;
iOS122576576574 failed its original Watch flow at
`id: m01-watch, mp4 is not visible`. No diagnostic variant or rerun was launched.
All three observer processes are terminal. This preserves the deferred iOS gap;
it does not certify the uncommitted collection GUI on either mobile platform.

### Native collection owner checkpoint — `3a5570d`

Product/test source `3a5570d699f887f806835a30c691dc48b5fd66e5` adds the
rebuildable package catalog and schema12 migration, shared native Boolean
scope/level/capability/Material predicates, exact counts, bounded24-row/256KiB
pages, deterministic text/due cursors and explicit revision conflicts.
Saved Material remains readable across languages and without catalog metadata;
catalog eviction preserves authored content and learner state. Point projection
and collection status share the existing Knowledge authority, including claim
precedence and active latest observations. Native selection types are contracts
only; selection execution is not implemented by this checkpoint.

The first new owner test reproduced a Unicode search mismatch (Material count6
versus expected5). Material's existing text-index/input owner now uses Rust
Unicode lowercase; migration repairs old cache rows in32-row windows without
rewriting authored content, identity or revision.

At this source, `cargo test --locked -p mlearn-storage -- --test-threads=1`
passed all96 tests, including8 collection cases; `cargo check --locked -p
mlearn-core --features typescript` passed. LSP and staged-diff checks were clean.
These are real temporary-SQLite owner tests, not real-package corpus, runtime,
desktop/mobile GUI or milestone evidence. Package producers, runtime/client
integration, frozen selections/bulk actions, proposals, source search and
evidence/graph/character surfaces remain open. No M10 continuation verdict or
maintainer acceptance is claimed.

Automatic CI at `d9753b6`: foundation run40577193503 passed. Real desktop
run40577193516 failed on Ubuntu job122446665437 at the unchanged native smoke
test's second `attach_subtitles` assertion (`native-smoke.mjs:812`): response type
`error`, expected `source`. Its response payload was not printed, so the cause
is unclassified, not assumed to be infrastructure or a pre-existing M07 defect.
The assertion now retains that payload without changing its success condition.
LSP and `node --check` pass; no diagnostic workflow variant or rerun was launched.
Native-mobile run40577193378 completed: Android job122446665582 passed;
iOS job122446665731 failed the original UI/persistence step with
`Assertion is false: id: m01-watch, mp4 is not visible`. This matches the
explicitly deferred picker failure retained below, not a passed iOS gate.
All CI observation sessions are terminal. No iOS diagnostic variant was launched.
Independent M10 implementation continues while the desktop failure stays open.

### Indexed resource producer boundary — `f97e461`

A generic `resource_keys` import provides literal prefix/keyset windows over
authenticated SQLite resources: at most 64 keys, 256 UTF-8 bytes each, and
128 KiB of encoded JSON. Binary primary-key ordering is
required for this operation; existing point reads retain their behavior.
Immutable snapshots, namespace boundaries, ranges, shared 1024-query/8 MiB
budgets and charged capacity negotiation are covered by four passing real
SQLite/Wasmi tests. All five SDK tests, including two new pointer/length adapter
tests, pass under
Miri default, strict-provenance/symbolic-alignment and explicit Tree Borrows
configurations. Its Rust host-span model is not actual Wasm SDK execution.
ASan passed all five SDK tests and all four SQLite/Wasmi cases, with Rust and bundled
SQLite C instrumentation. The first C-link attempt failed on Apple's
`___asan_version_mismatch_check_apple_clang_2100`; using the retained upstream
NDK clang 18.0.2 for macOS 11 produced the compatible v8 guard and passed without
disabling instrumentation, assertions or budgets. No emulator was started.
Actual package catalog producers, opaque package-cursor persistence, runtime
jobs and typed-client/UI integration remain
unimplemented; this is not a collection feature or M10 continuation verdict.

The serial SDK guards are stopped. Post-run OmO footprint 4031394944 bytes,
available 5958828032, pressure 1, swapUsed 3857448960, swapOut 48338993152;
disk available 23917652 KiB. The owned nightly toolchain remains under the
registered runtime root until cleanup. Compiled `target/miri-sdk`,
`target/asan-language-host` and the shared Miri compiler sysroot at
`/Users/adrian/Library/Caches/org.rust-lang.miri` are retained as artifacts,
not guessed-deleted as worker caches.

### Catalog cursor and membership checkpoint — local `3c1a29c`

The real producers require opaque package cursors, not numeric dictionary
offsets. Japanese inline presentation also intentionally selects only the
hardest JLPT level; that is not full source membership. The native contract
now persists the package cursor atomically with processed ordinals and target
rows, rejects stale or stalled progress, and indexes explicit level memberships
separately from inline display.

Schema 13 rebuilds only the old derived catalog cache. Tests retain Material,
claims, receipts and preferences through the schema 12 upgrade and retained-table
replays. The full storage suite passes all 99 tests, including 11 collection
cases; the Core TypeScript-feature check and seven file diagnostics pass.
Post-run OmO footprint 4037194880 bytes, available 6200639488, pressure 1,
swapUsed 3832283136, swapOut 48338993152; disk available 23798092 KiB.
The serial guard is stopped. This checkpoint is committed locally, not pushed;
real package production, runtime jobs and client functionality remain open.

At published `8a4f350`, foundation run 40592717257 and real desktop run
40592717283 pass. Native-mobile run40592717267 completed: Android job
122500776388 passed; original iOS job122500775895 failed at the unchanged
Watch import assertion, `id: m01-watch, mp4 is not visible`. That is the
retained deferred picker gap, not a passing iOS gate. All three original
observers are terminal; no diagnostic workflow variant was launched. The
desktop pass does not explain or close the earlier `d9753b6` subtitle error.

All substantial local runs were serial and passed fresh three-sample1GiB
admission. Post-run OmO footprint4093637736 bytes, RSS2802679808,
available6143328256, pressure1, swapUsed3932946432 and swapOut48338993152;
disk available25637364 KiB. Both temporary verification guards are stopped.
The earlier transient OmO allocation spike remains unexplained; no product
inference/device workload is blamed, and no such workload was launched.

### Real package catalog producers — `98ba7fb`

English0.1.4 and Japanese0.1.8 declare `collection.targets.v1`, with bounded
package-owned keyset pages and stable existing target IDs. Optional catalog
metadata is generated from Core; one validator serves native publication and
cache admission. Inspection, dictionary batches and catalog rows reuse the same
summary projection. Japanese retains all source level memberships separately
from its unchanged hardest-level inline presentation. Source/model pins,
licenses, resource codecs and executable-host policies are unchanged.

Serial checks pass: English12 owner tests, Japanese26 plugin tests, all99
storage tests, two existing real Japanese runtime workflows, and one new
production-runtime test executing actual compiled SDK imports for both packages.
The latter verifies replay, next-page identities and inspection equality for
six targets per package; it is not full-corpus preparation evidence. WordNet's
stored array lengths independently sum to its declared206978 targets, and all
four POS values match its declared scopes. Architecture ownership, codegen,
typed consumers and contract freshness pass. The existing catalog test file also has mechanical Rustfmt
changes. JSON LSP is unavailable because Biome is absent; the existing package
builder and Rust loader parsed and executed both manifests.

Compiled Wasm SHA256: English
`50166a12251dbf51c43386a2413bfeb59977f924050552ad45ad52df4ae475e8`;
Japanese `d7690ea7c4ecb4e5472e41a8b17e33755ec90815bfcdbf801daa551a40b1ea89`.
Both verification guards are stopped. Afterward OmO footprint4213699688,
RSS3608870912, available8565817344, pressure1, swapUsed4111663104,
swapOut50273304576. Footprint and swap rose during the serial work; keep
monitoring the unexplained allocation trend before admitting another workload.
A later idle sample decreased to footprint4173100136 with swap counters
unchanged, available8129806336 and pressure1; this does not explain the earlier
growth.
Runtime preparation/cancellation/restart, full-corpus cache completion and
typed-client/UI flows remain open. M10 is not complete or independently gated.

### Optional metadata boundary repairs — `b7eeac0`, `a194be8`

Both observed failures were reproduced before repair. At98ba, foundation
run40603221309 Rust job122536239804 failed the existing ABI1 offline test:
a retained three-method manifest plus the current compatible module made
ordinary source analysis fail on its optional catalog metadata. `b7eeac0`
withholds that optional metadata unless the authenticated manifest grants its
method. The unchanged offline/source/claim/restart assertions now pass, with
additional checks that no catalog is published and direct invocation is denied.

`a194be8` keeps package-scoped saved Material readable during partial catalog
preparation. Its new real-SQLite regression failed before repair. Knowledge
and catalog-dependent predicates still return Preparing instead of partial
counts. The full storage suite passes100 tests; ABI1 passes, eleven of twelve
package-catalog cases pass (including the real SDK producer case), and both
Japanese runtime workflows pass.

The unchanged HTTP recovery test fails independently on Darwin at
`catalog.rs:908`: server `shutdown(Both)` returns OS57/NotConnected, then its
notification receiver disconnects. Isolated reproduction also fails before any
language/collection operation. Its production owner `runtime/src/catalog.rs`
has identical blob51ea8ba6 at8a4f350 and98ba; no assertion or product HTTP code
was changed to hide it. This remains an open platform/test finding, not a
passing full runtime suite. Source98ba real desktop CI passed40603221290;
native-mobile40603221308 completed: Android122536239924 passed; original
iOS122536239666 failed the deferred `m01-watch, mp4 is not visible` assertion.
Its observers are closed, with no diagnostic variant.

Guard1222 is stopped. Post-run footprint4182144128, RSS3275128832,
available6568738816, pressure1, swapUsed4078108672, swapOut50273304576.
Native preparation/client flows remain the next implementation work.

### Native collection API and full corpora — `f3eea3c`, `3b9d49a`

`f3eea3c` connects bounded native queries, package preparation, replayable command
identity, independent status/cancel and generated typed clients. One native
controller reuses the host blocking call, existing three-call admission and
per-page guest admission; no scheduler, worker pool or database is duplicated.
Publication checks package revision and shares the cancellation boundary.
Authored Material remains readable without complete optional metadata.

Actual DesktopDownloaded/authenticated-fixture QA through that typed client
prepared all206978 English targets in110846ms and all218923 Japanese targets
in278227ms. Both returned48 distinct identities across two sorted24-row query
pages, exact untracked counts, unchanged pages after process restart and an
identical replayed preparation outcome. English scopes counted146347 nouns,
25047 verbs,30004 adjectives and5580 adverbs. Japanese's JMdict scope counted
218923; package-owned JLPT memberships counted N1:3093,N2:1708,N3:1646,
N4:610,N5:648. Compound level/untracked/unsaved counts matched; authored Material
was genuinely empty. This is native-owner/transport evidence, not rendered GUI,
mobile binary or maintainer acceptance.

The initial Japanese24-entry page failed at18744 entries, cursor
`entry/1207490`, on the unchanged64M fuel allowance. Its profile is retained.
An exact source-window probe failed at24 and passed at12 using35.8M fuel;
all24 single-entry probes passed. `3b9d49a` caps the package-owned effective
page at12, advances Japanese to0.1.9 and preserves the native fuel guard.
No core language branch, retry shim, source/model pin or assertion was changed.
The complete fresh-profile run above proves the repaired corpus, not only the
original failing window. Japanese Wasm SHA256 is
`3c4d10904acd2b814830d809f164a4d67bdf1befd2589c85609c3a33892b8cd4`;
English remains50166a12 and both dictionary asset hashes remain unchanged.

Passing serial checks: storage100, runtime library52, ABI1 offline1, real
Japanese runtime2, Japanese plugin27 and typed-client69 tests. The native
commit-event test proves cancellation at24, restart/resume at48 and isolation
from an old cancel command. Project typecheck, architecture and contract
freshness pass. Existing ts-rs attribute and vendored Sudachi lifetime warnings
remain visible, not suppressed. The earlier isolated Darwin HTTP shutdown
failure and Windows native input failure above remain unresolved.

Published a1d6092 automatic evidence: real desktop40605543357 passed.
Foundation40605543383 Rust, web, detector and macOS passed; Windows theme
job122545898220 failed `Incomplete native theme input` despite focused-editor
telemetry. Mobile40605543386 Android122559113179 passed; original
iOS122559112784 failed the deferred `m01-watch, mp4 is not visible` assertion.
All source-a1d6092 observers are terminal and closed. These receipts do not
certify the newer native collection API on mobile or close retained M07 gaps.

All local QA hosts/fixture servers and guards are stopped. Before the repaired
run, an idle OmO allocation spiked to13.313GB footprint with pressure2 after the
probe had exited; no product/device workload is blamed. Its cause is still
unexplained. Fresh admission subsequently showed stable footprint/pressure/swap.
Final footprint2768860288, RSS7733395456, available7625752576, pressure1,
swapUsed5432737792, swapOut52846051328; disk18604348KiB available.
Continue fresh admission and bounded reads, not an RSS/peak-only decision.
Queued-admission cancellation and actual collection UI/platform workflows
remain part of the open M10 verification scope.

## Active authorization — sequential M03–M07 implementation

On October 22 the maintainer authorized autonomous sequential M03–M07, with
independent review and full verification per milestone, and an independent
M01–M04 architecture review/repair before M05. Current integration/native
translucency/corrections were verified except the hosted platform failure below.
The maintainer now explicitly defers that specific gate and orders immediate
M03 implementation followed by M04–M07. Minor cosmetic polish may defer; usability and architectural
or functional gates may not. See the current PLAN/AGENTS authorization. Preserve
H00, branch history and draft PR44; stop after the consolidated M07 review
package for manual acceptance, without merging or self-acceptance.

## Current gate status — 2026-10-24

M03–M06 and the M01–M04 architecture gate are now
`verified_for_continuation`, not maintainer-accepted. M06 product source is
`18791267e3c59297a66d79febfdf8503dccf8aaa`; the final native-smoke repair source
is `f27f4e5594e3188c1002ea743a5d610f75720dd8`. Subsequent changes are evidence
documentation only through M06 checkpoint `9640c9e4`. M07 is now in progress;
no merge, release or M08 is authorized.

M06 verification closes with the original full independent review and fresh
B1 closure review, 161 owner/checker tests, typecheck, architecture lint, web
export, 29 Settings/image interactions, all five final-source foundation jobs,
actual Linux desktop workflows, actual Windows/macOS OCR, retained offline
Android/iOS OCR matrices and source-bound consuming mobile builds. Reviewed-source
Android job `120781725575` now passes the complete real Watch/Inspector/Knowledge
and native source-resume workflow: JUnit has one test, zero failures, 479.959
seconds. Its source/tree receipt matches `18791267` /
`e38148b3ef541cd0239a9bca47c7f740ecc418c0`; actual restarted playback settings
and Japanese live-card Inspector captures were inspected.
Evidence is `hosted-1879-mobile/android-build-evidence/` and
`run/hosted-1879-android-job.log`. Both source-bound consuming applications
compiled successfully and were retained by run `40062981295`; its metadata and
artifact identities are recorded in `run/hosted-1879-mobile-continuation-metadata.json`
and `run/hosted-1879-mobile-artifacts.json`.

Hosted iOS job `120781725240` completed with the exact existing picker failure:
`Assertion is false: id: m01-watch, mp4 is not visible`. The complete log is
`run/hosted-1879-ios-job.log`; completed job/source metadata is
`run/hosted-1879-mobile-metadata.json`. It is not reported green and does not
reinstate the expressly deferred FileProvider prerequisite. Earlier hosted iOS
failures remain unresolved and retained. No diagnostic variant, local device restart or extra inference was
launched to close this checkpoint. Physical-device coverage and general model
accuracy remain unproven; CPU fallback is not acceleration evidence. The
specified model limitations and minor visual discrepancies remain explicit.
Both independent review worktrees and owned local OCR verification devices/
launchers were released with retained read-back receipts.

### M07 current implementation

The consolidated, explicitly incomplete review package is
[M03-M07-REVIEW.md](M03-M07-REVIEW.md). It binds subsystem/source boundaries,
review resolutions, exact-source checks, genuine replay/capture paths,
resource observations and remaining platform/cleanup gaps.

#### Final-source desktop and Watch comparison — 2026-10-27

Published source `3ffc28fb7599bbf4945787b9ca8b23c84ea04761`, tree
`cd91e3d6176169ec3ce93d0d43f79955a7c48d93`, passes all five foundation
jobs in `40456368381` and real Linux desktop `40456368198`, job
`122030523329`. Artifact `12713250736` is retained as
`3ffc-desktop-evidence.zip`; its source receipt matches both hashes.
The final native log confirms real IPC, signed packages, playback/seek,
contextual Inspector, shared claims, exact source restart and missing-source
recovery. This supersedes the pending Transcript re-run below without
discarding its original failing evidence. Mobile run `40456368189` is terminal:
Android job `122030524178` passes the original native
Watch/Inspector/Knowledge/source-resume flow, one test and zero failures in
400.793 seconds. Retained artifact `12713548234`, `3ffc-android-evidence.zip`,
has the matching commit/tree receipt; selected JUnit and the actual
Transcript-search frame were inspected.
iOS job `122030523715` compiles its consuming app, then fails while preparing
the existing fixture: AVFoundation `-11821 Cannot Decode`, underlying
`-16977`, makes `tools/create-watch-fixture.swift` terminate with SIGTRAP.
`3ffc-ios-failed.log` preserves the original failure. No product UI assertion
is reached, no diagnostic variant or rerun is launched, and neither the
deferred FileProvider gate nor the later Home-progress repair is certified.

Guarded native run 1140 reuses the exact product contents of Focus QA build
1112, with no rebuild, model, device or reference-app launch. The requested
1512x948 comparison window is constrained by the current display to
1500x919, captured at 3000x1838 physical pixels. Actual position 25240 ms
matches the approved burnt-in timecode 25:05; authored subtitle newlines
remain intact. Vocabulary has 17 actual package-derived words, not the staged
reference's 12. Its separate header/canvas/card materials, capture receipts,
source captions and -6350 ms overlay were inspected. The transient overlay
covers part of the header while open, as in the approved composition;
the toolbar toggle dismisses it and reveals the filters. Opening its numeric
offset editor and Escape returns focus to that same offset control.
No synchronization or learner mutation was submitted.

Actual keyboard input searches Transcript for `度胸`, yielding only cue 3
at 0:24 while retaining the source position. Native AX `setValue` alone did
not publish a controlled-input change and is not counted as search proof.
The query and result survive reflow to 420x560; Close stays visible and the
body scrolls within the bounded modal. Retained frames are
`watch-final-vocabulary-sync.png`, `watch-final-transcript-search.png` and
`watch-final-transcript-minimum.png`. The first was also opened in Preview.
Transcript's full capture rows remain a denser presentation than the
Vocabulary cards; this comparison does not claim pixel identity for
unpictured Transcript states or reproduce unsupported legacy Anki status.

Normal source navigation restores `19849|223042|-6350|1.0`, confirmed through
read-only SQLite. App PID 57111 quits normally, exit 0. During the run OmO
footprint is 3856381056 bytes, app footprint 185222416, available memory
5588926464, pressure 1 and unchanged swap-out 40652308480. This is a bounded
workflow sample, not a diagnosis of the earlier OmO allocation incidents.
Final platform verification, demonstrations and consolidated M07 delivery
remain open; there is no maintainer acceptance or merge.

Final normal-launch Home/Settings run 1157 reuses that same compiled product.
`final-home-1080.png` and `final-settings-1080.png` retain the current native
theme and composition. Settings reads saved Dark Quartz, JLPT vocabulary and
Auto collapse; opening its actual theme editor, then wrapping Close -> Save
at 420x560, keeps Save visibly focused without submitting a preference.
Escape restores the editor trigger. The second-consumer frame is
`final-settings-theme-minimum-focus.png`.

An initially malformed background resize capture is explicitly excluded from
product-failure and visual-pass evidence. Native Web Inspector measures
inner/client/visual widths 420, then observes one window and one visual-viewport
resize event at width 500. React's dimension state is 500; the actual shell
style arguments are `[28,0,true,true]` and both matching stylesheet rules say
column, while background computed style still reports row. Bringing the same
unmodified app forward produces the correct narrow layout. Foreground resize
to 420x560 then passes with no DOM/style staging or source repair.
`final-settings-420-foreground.png`, `final-settings-packages-420.png` and
`final-home-420.png` preserve the real responsive surfaces. The latter has one
activity column; navigation/header/content retain their bounded scroll owners.
The tentative Settings product-defect task is dropped, not reported fixed.
Future native resize captures must activate the owned window before a verdict.

Package management retains the actual English/Japanese versions. Its optional
OCR catalog read reports the unavailable local port 7780 explicitly rather
than fabricating an empty successful result. No install, model inference,
theme save or learner mutation occurs. The diagnostic inspector and its
transient event observers disappear with normal app exit; PID 62114 is absent,
the window was restored to 1080x800/Home, computer control/session and owned
guard 1156 are released. Read-only source state is still
`19849|223042|-6350|1.0`. During the run footprint is 3128882304 bytes for OmO
and 202081672 for the app, available memory 6334218240, pressure 1. Post-quit
OmO footprint is 3130602600, available 6753910784, pressure 1; swap-out remains
45199720448 throughout this continuation. Its increase since the previous
idle checkpoint is retained without attributing a cause.

#### Inspector primary capture repair: local desktop verified — 2026-10-27

Published source `b38f4039848d0a3e1e79449ce8ae3159a93c61ac`, tree
`f8ddf0ebdb72ec86ee8204f1c20fd3e04a6947d2`, passes all five foundation jobs
in `40447023875` and Android job `122000615156` in mobile `40447023866`.
The original Android Watch/Inspector/Knowledge/source-resume flow has one
test, zero failures and 403.773 seconds. Its retained source receipt matches
both hashes; `b38-android-junit.xml` and the inspected
`b38-android-transcript-search.png` prove the formerly blocked menu path.
Artifact `12710315901` remains retained as a ZIP with only those selected
records extracted. Compiled Android/iOS apps remain retained remotely.

Real desktop `40447023902`, Ubuntu job `122000615432`, fails at
`native-smoke.mjs:492`: an immediate WebDriver search-input lookup follows a
Transcript menu selection without observing its publication. The retained
original failure DOM and frame both show that the real search input did
subsequently render. `b38-desktop-failed.log`, evidence ZIP `12709340425`
and its selected `b38-desktop-failure*` files are preserved. The local probe
now subscribes through the existing event observer before selection and
awaits the visible input with the menu closed, retaining every original
search, claim and restart assertion. Syntax/LSP checks pass; its native
re-run is pending, not green.

iOS job `122000615545` fails at the original `m01-watch, mp4 is not visible`
picker assertion, not the preceding source's Browse lookup. Its original
log is `b38-ios-failed.log`. The expressly deferred FileProvider gate remains
unresolved; no diagnostic variant or rerun was launched.

A deliberate same-binary native comparison uses a normal 1512x948 window,
the actual 25.05-second source, courage Inspector, live words and -6350 ms
synchronization. `watch-matched-current-inspector-before.png` preserves the
finding: Capture is below the dictionary scroll while secondary copy actions
occupy its footer. Authored subtitle newlines remain required by VID-03;
they were not flattened to imitate the staged single-line reference.
The app restores 19.849 seconds through the actual slider, returns Home and
exits normally (run 1002, PID 28277, exit 0). Its guard is stopped.

The existing footer cases reproduce the absent primary action at 1080px and
393px before product edits (run 1006, two failures). CaptureList now offers a
compact action presentation while retaining the same eligibility, prepared
command, receipt, retry and exclusion owner. Inspector places that owner in
its footer; saved/exclusion choices use the shared Menu. SourceActions orders
Explain before secondary copy actions. No native/domain contract changed.
All three changed product files have clean LSP diagnostics. Typecheck,
ownership lint and web export pass. Initial rendered cases reach the new
Capture action, then fail their stale four-button expectation with six actual
controls; both resulting desktop/narrow frames were inspected. The test now
distinguishes primary pills from the options menu and checks menu access,
focus return and access to trailing copy actions. At that initial checkpoint
the adaptation was not run and fresh test diagnostics timed out; neither
repair nor tests were green or included in a consuming native build then.

During run 1008, guard 1007 observes OmO PID 82251 footprint 10,608,129,152
bytes, pressure 2, available memory 3,949,117,440 bytes and swap-out
32,883,867,648 bytes; it exits 70. The test command exits 1. A bounded process
inventory finds no owned application, browser/test runner, device, model or
compiler remaining. Subsequent same-PID footprint is 3,719,640,192 bytes,
pressure 1 and available memory 8,103,575,552 bytes, but swap-out has risen to
34,144,059,392 bytes. `vmmap -summary` reports 3.5 GiB current footprint and
14.4 GiB historical peak; App-Specific Tag 1 dominates resident allocation.
The eval heap counter is only about 10 MB and is not process-wide accounting.
This is another unexplained OmO allocation incident, not a demonstrated
application/model leak or memory fix. Further substantial local verification
is held while investigating. Existing artifacts, profiles, four original
untracked files and unrelated preview PID 2637 remain preserved.

Fresh recovery samples subsequently pass the unchanged 1536 MiB budget:
footprint settles near 3.69 GB, pressure remains normal and swap-out stays
34,211,610,624 bytes. During serial connected verification, footprint is
3,692,704,896 bytes with 6,504,529,920 bytes available and normal pressure.
The bounded incident investigation is recorded, not a diagnosed allocation
fix; historical RSS/peak is not an admission cutoff. Guarded serial browser
checks resume without launching any app, device or model.

The compact capture menu exposes a genuine nested Escape failure: both menu
and Inspector dismiss. Dialog and Menu resolve separate physical Radix
dismissal/focus modules. Broad dedupe previews are rejected because they
would change Metro/Hermes. The applied named update only relocates six Radix
packages and removes 24 duplicate Radix entries. Root overrides retain the
existing app React/ReactDOM 19.2.3 and shared dismissal 1.2.1/focus 1.3.1
identities. Actual resolution now matches for Dialog and Menu; postinstall
repairs pass and `npm ls` has no invalid React peer. Initial npm preview peer
warnings are retained in the logs, not suppressed.

The original Escape checks now pass. Focused trailing actions initially
remain clipped by 86 px; ContextPanel now reveals only its own horizontal
footer, without scrolling source ancestors. The browser's remaining 0.34 CSS
pixel scroll rounding maps to the same painted device-pixel edge; the test
compares physical-pixel edges and still rejects the original clipping.
An ineffective intrinsic-width experiment was removed. Saved/exclusion
entries retain their semantics through the new menu; tests use its actual
painted surface rather than the transparent accessibility wrapper.

Connected run 1041 passes 76/78 cases. Run 1046 passes 77/78: the remaining
saved-Material case is blocked by a pointer-intercepting, aria-hidden outer
dialog subtree, not missing capture persistence. ContextPanel now provides
its own nested portal target, rather than inheriting Reader appearance's
portal. Original editor/dismissal/source assertions remain intact.
Targeted run 1048 passes all four original cases in 2.5 seconds; its desktop
menu and narrow footer captures were inspected. Final candidate run 1049
passes typecheck, ownership lint, web export, all 78 connected browser cases
in 1.2 minutes, 79 infrastructure cases and 137 client/package cases, with
one test worker/process at a time. No test is skipped. Pre-Saved-refinement macOS build
1051 passes in 8.41 seconds, retaining `net.kikan.mlearn.v3dev.m07qa`.
UI SHA-256 is
`9175341a63e334f93aba15c519fb95cc939d9bff342833190c1639312448c9fd`;
executable SHA-256 is
`b3b8676bcd58d7f5beca3ffb7e71f4ee200268b38bb0bf035038b662c306c8ae`.
After the separate 1024 MiB admission, actual native run 1054 captures the
real courage occurrence at 25240 ms (burnt-in timecode 25:05), opens its
saved Material through the native menu and returns to the same caption
selection/position. The real revision-1 receipt is
`material-9a2a0a3f3ae7d5faaf3c47500f6c619a0f14906e2d60233c2f3160aff214b887`;
read-only SQLite confirms its Japanese package, position and -6350 ms offset.
The app quits normally. SQLite confirms restored source state
`19849|223042|-6350|1.0` and unchanged Japanese package version
`0.1.7-sudachi20260116-jmdict20261017-ocr2`. The QA capture is preserved.

That actual saved frame reveals a compact-footer defect: the opaque receipt
ID expands the action block and pushes Explain away. The before frame is
`inspector-menu-native-receipt-overflow-before.png`. New real-length-ID
regressions fail at both widths in 1059. Compact saved receipts now expose a
bounded Saved/Reused button using the actual result Material ID and committed
revision; full receipts remain in the normal list/card presentations.
Run 1061 passes type/lint/export and both width regressions with the Saved
and Explain buttons wholly visible. Candidate 1062 passes type/lint/export
and 76/78 browser cases; the two Page words cases retained the old short
fixture ID. Their exact receipt expectation is updated to the new 64-character
fixture ID, without dropping receipt persistence/resize assertions.
Run 1070 passes both corrected Page words cases and all 20 capture-owner
cases, including opening the new receipt ID rather than an older eligibility
result. Both post-save browser frames were inspected. Thus all 78 connected
cases have passing evidence for this product source across 1062 and 1070;
this is not a claim of one 78-case green run.

Consuming Saved-refinement build 1071 passes in 8.12 seconds with maximum
resident set size 1026228224 bytes, one Cargo job and offline dependencies.
It preserves the earlier compiled Inspector app and produces
`mLearn M07 Saved QA.app` under the same isolated bundle identity.
Its UI SHA-256 is
`afd217db28c4d21df95637a8fadb444e4d73869e9c2ccc178e9ded2e96e00f2a`;
executable SHA-256 is
`2cdc4b6ad154587364594889fcd683382713ba72fc243ec208cda9b28e37daa7`.
Actual run 1073 captures the real `いい` occurrence at 25240 ms, exposes
`Open saved いい: revision 1`, keeps that receipt through 1512x948 -> 420x700
reflow, opens the correct real editor from the Saved action and returns to
the same caption selection/position. Desktop/narrow frames are retained as
`inspector-saved-native-{desktop,narrow}.png`. SQLite confirms new receipt
`material-d2cb4d337bf0ce75ec7045bc5bbed620325d01b18139407c99d053ff3cf0df7d`,
revision 1, Japanese package, 25240 ms and -6350 ms source offset.
Normal navigation restores `19849|223042|-6350|1.0`; app PID 43619 then
quits with exit 0. Both genuine QA captures remain preserved.

Resource guard 1060 stops on renewed OmO growth at physical footprint
11656770688 bytes, RSS 3112304640, available 3042852864, pressure 2 and swap-out
35210182656. No further substantial verification is admitted. The next sample
falls to footprint 3872617600, available 8243118080 and pressure 1, but swap-out
has increased to 35541663744. The in-process eval context reports only 13.0 MB
JS heap and 8.7 MB external memory; that does not characterize other VM/native
allocations. This recurrence is not a diagnosed fix. Passive observer 1066
completes five minutes without verification workloads: footprint falls from
3958256768 to 1262089344, peak is 3958256768, pressure stays 1 and swap-out
remains 35541663744. No growth trigger/thread sample occurs. The first
post-context-recovery sample has footprint 3714921600, normal pressure and
8411824128 available, but the system swap-out counter is now 40450801664;
that intervening increase is not attributed to a device or model.
Guard 1069 and unchanged three-sample admission protect narrow run 1070,
build 1071 and native run 1073. During the native workflow root footprint is
3693212800, app-PID footprint 185418952, available memory 6196756480 and
pressure 1. After normal quit root footprint is 3700520064 with 6981255168
available, pressure 1 and unchanged swap-out 40450801664. These are sampled
process values, not a peak or all-WebKit-process accounting. No heap dump,
device/model launch or broad verification accompanies this continuation.

Published mobile run `40433857901` is terminal failure. Android job
`121957744753` fails on absent `transcript-search-input`; JUnit records one
test, one failure, 141.623 seconds. Its completed menu-item tap uses settled
hierarchy bounds `[140,46][586,162]`, point `(363,104)`, but the failure frame
still shows the menu. Original logs, source/tree receipt, hierarchy and that
single frame are retained under `ci-4bcf900-android-ui`; artifact
`12703788588` is retained as a ZIP, not broadly extracted. No device was
launched. The local Menu candidate now includes actual safe-area insets and
an explicit native hit-test layer above absolute source chrome; the old
overlay applied its z-index only on web and its frame overlapped system UI.
This candidate now has the exact-source passing Android workflow above;
native menu delivery is verified rather than inferred from a changed style.
iOS job `121957744870`
fails at `Element not found: Text matching regex: Browse` in the original
picker path; this is not the earlier mp4-visibility assertion. Its original
log is retained without a FileProvider diagnostic variant or rerun.

The current Inspector comparison also exercises the real package-declared
Written recognition, Meaning, Reading and Listening recognition controls.
Meaning Known yields aggregate Mixed, correcting it to Unknown remains Mixed,
and Withdraw restores Untracked with withdrawal disabled. The assessment
remains unmeasured and prediction unavailable: no single capability becomes
an all-known action or fabricated evidence. Escape closes only the adjustment
and restores Knowledge focus. At 420x560, Shift+Tab reaches the authoring
trigger; child Escape restores that trigger and a second Escape closes
Inspector. Both runs restore source position/rate/offset through normal
navigation and quit, without submitting the authoring form.

That minimum-size run exposes a further shared focus defect: wrapping from
the child Close button focuses Save Material but leaves it offscreen.
`inspector-native-nested-capture-focus-before.png` preserves the native
failure. Browser run 1106 reproduces it with focused Save and viewport ratio
0. Installed Radix focus-scope explicitly uses `preventScroll: true`; the
bounded view had no local focus-reveal behavior. The shared `scrollFocus`
adapter now reveals descendants only within their own scroll viewport.
Dialog body and Inspector body/adjustment/footer reuse it, retaining native
framework behavior outside web hosts and avoiding global `scrollIntoView`.
Run 1109 passes type/lint/export and the original vertical plus both existing
horizontal regressions. Integrated run 1121 passes all 79 connected cases
in 1.2 minutes.

Consuming Focus QA build 1112 passes in 7.87 seconds, maximum RSS 1028505600,
retaining the preceding compiled apps and the same isolated profile.
UI SHA-256:
`f75c1e3568108e173bd5eb67ba71fb6dafa07ec0b01d8bc052d121f643d03f4b`;
executable:
`30dd74de383c6c8ec0ef5f43db36743fa60ce1c3f42c7c15c12bac005687fea4`.
Actual run 1116 replays the same 420x560 wrap: Save Material is visibly
focused with the heading retained; child dismissal also reveals the focused
parent authoring trigger. Inspected after frames are
`inspector-native-nested-capture-focus-after.png` and
`inspector-native-parent-focus-after.png`. The original Untracked claim is
still present after restart. No Material is saved; source state returns to
`19849|223042|-6350|1.0` and the app quits normally, exit 0.
During that run root footprint is 3746051200, app-PID footprint 179586248,
available memory 5901844480, pressure 1 and swap-out 40652308480. After quit,
root footprint is 3746690176 with 6534086656 available and unchanged swap-out.
Guard 1110 protects the serial continuation; earlier guard expiry was not
an unsafe-resource event.

Ledger: 221/256 done, 35 open. The local focus repair and current Inspector
correction/nested-state comparison are complete. Current work is
`Verify M07 genuine workflows and affected platforms`.
Watch/final matched captures, the source-bound desktop re-run, remaining
platform proof and M07 delivery remain incomplete. No acceptance or merge.

#### Current sidebar composition: local verification complete — 2026-10-27

Measured reference header/list/card regions use distinct materials; the old
native pane used its surface role for both header and canvas. Dialog now owns
the full-width header and inset list canvas, with one shared 720px breakpoint.
CaptureList groups actual Watch/Reader controls and its batch action above the
divider without moving command, pending or receipt state. This source passes
typecheck, lint, export and all 50 browser cases in 29.9 seconds.

The first consuming native build (7.57 seconds) confirms the division but
exposes the missing surface beneath Panel's translucent card tint. Capture
`sidebar-material-native-card-backing-before.png` preserves that result.
The shared Panel repair passes typecheck/lint/export and all 50 browser cases
in 29.2 seconds; wide and narrow captures were inspected. Its final dark native
capture remains pending.
The app exited normally before further work. Three idle footprint samples
decrease from 3,187,242,112 to 3,160,290,432 bytes with normal pressure,
6.56 GB headroom and unchanged swap-out. GC of the small JS heap does not
identify the earlier OmO growth. Another workload needs fresh admission.

The selector-placement question timed out. The agent is proceeding with the
recommended player action menu, not treating silence as maintainer approval.
A shared Menu owns keyboard/touch/focus through pinned RN Primitives 1.5.2;
Transcript and Vocabulary remain real actions. The inside-pane selector is
removed. Browser, native desktop and mobile workflows retain their assertions
and use the new entry actions. Installation and both guarded dependency repairs
pass; 14 packages are recorded in the generated lockfile.
The first 1536 MiB admission held below the 4,294,967,296-byte reserve;
event-driven admission then waited for three safe samples without lowering
limits. Seven initial cases pass; both compact pointer handoffs fail.
The bounded focus trace proves the drawer opens before the menu finishes
restoring focus. Menu now delivers web choices from its close-focus event,
restores the trigger first and clears queued choices on unmount. There is no
timer, retry or weakened assertion.

The pending capture also exposed a short-word wrap. A held eligibility reply
reproduces two text lines before the repair and one afterward. The first
line-height metric was invalid and is not reproduction evidence; the corrected
text-node rectangles are. Loading copy now sits below a card's heading.
Dictionary failure/retry already behaves correctly; new coverage passes
without any dictionary product change.
Final typecheck, lint, export and both desktop-driver syntax checks pass;
all 51 affected browser cases pass in 30.1 seconds, alongside 79 infrastructure
and 137 client/package cases. Pending, wide and 320px captures were inspected.
Both adapted Maestro files parse cleanly; their final-source mobile execution
remains pending. The consuming debug macOS build passes in 7.17 seconds.
Renderer SHA-256 is
`21e5389d05359823eaba1f1c51efa9e26e4acd41ce58472eecb196b251021952`;
executable SHA-256 is
`edc3ba1204cb2a3475909325c0260cbbeaff579200edc68295800704b52873f9`.

Actual macOS keyboard selection opens Vocabulary; pointer selection switches
to Transcript and exposes its real search field. ArrowDown/Escape restores
the player trigger. Source-caption activation opens Inspector with Vocabulary
retained; dismissal restores the original source token. The backed cards and
distinct header/canvas are inspected in `sidebar-composition-native-vocabulary.png`;
`sidebar-composition-native-synchronization.png` records the offset state.
The first run reaches its deliberately bounded ten-minute deadline after
those checks, so its final dismissal/normal exit are not claimed.
The same binary is deliberately reused after fresh admission: restart retains
19.849 seconds, rate 1 and offset -6350 ms. Options close returns to offset;
widget dismissal returns to sidebar Close; pane dismissal returns to the
player trigger. Home return and normal Cmd+Q exit pass (run 988, code 0).
No rebuild, profile reset, model or device launch is used for this follow-up.

Both owned app PIDs are absent; the live guard is stopped. Final OmO footprint
is 3,176,461,392 bytes, RSS 4,141,793,280 bytes, available memory 6,398,623,744
bytes, pressure normal and swap-out unchanged at 28,479,864,832 bytes.
The first native main process was sampled at 186,582,312 bytes footprint.
This is bounded local verification, not a diagnosed OmO memory fix, whole
Watch conformity, mobile certification or maintainer acceptance.

#### Published sidebar hierarchy checkpoint — 2026-10-27

The next coherent visual batch places the actual count/description under the
desktop sidebar title, using shared sidebarTitle/detail roles. The wide Close
action retains its semantics and focus return with the edited reference's
downward chevron. CaptureList now uses neutral exclusion/saved/context pills
before its info capture pill; row presentation keeps its original action order.
The batch action is trailing-aligned. Watch and Reader share these owners;
no capture command, retry identity or learner-state meaning was replaced.
The existing mode selector remains functional while its placement question is
open; the reference header/body material boundary also remains unfinished.

Typecheck, ownership lint and export pass. The title/count change passes all
50 affected browser cases; the final card-action source passes all 41 Watch/
Reader-image cases in 25.7 seconds. Wide and compact captures were inspected.
The consuming debug macOS build passes in 7.77 seconds; its renderer SHA-256 is
`24a8d28fb20c57c2bbda887234412b7fbf81119efe6f270b3579feb3fdc4da56`,
and executable SHA-256 is
`1c96d8c6646d1d130ead54d7566b8ded7c7a926701ce36449cd3f13c53083567`.
Actual retained-profile Vocabulary shows 17 real words, the new hierarchy and
card pills (`sidebar-hierarchy-native-vocabulary.png`). The chevron closes
the pane and returns focus to Transcript; Home return and normal exit pass.
The owned app and guard are released. During the run OmO footprint is
2,715,268,248 bytes, app footprint 182,551,872 bytes, headroom 6,077,628,416
bytes, pressure normal and swap-out unchanged at 28,479,864,832 bytes.
The final owner suite passes all 79 infrastructure and 136 client/package
cases. This is not whole Watch visual conformity.

Published usability source is `79759b84bb9fbf2d931146328aca40057d8da32c`,
tree `cfe0de1e5c1f27701383c21d6bae43a12e57c1b6`, read back on OPEN/draft
PR #44. Its real desktop run `40422893910` passes. Exact-source foundation
`40422893803` passes all five jobs. Mobile `40422893805` is terminal:
Android `121921399601` passes in 36m55s, including its unchanged 9m51s UI step;
iOS `121921399896` repeats the original deferred
`m01-watch, mp4 is not visible` assertion. The failed-step log is
`ci-79759b8-mobile-failed.log`; no variant/rerun was launched.
Hierarchy source `566ce549d35300a5912d2835e50c6432f1477deb` is also pushed;
tree `b3e24aa130943e4adfea30576ec88e7556e6b8ad`, OPEN/draft PR #44.
Its real desktop run `40424830700` and all five foundation `40424830953` jobs
pass; mobile `40424830747` remains under exact-source read-only observation.
The ledger remains 215/250; no M07 acceptance or merge is claimed.

#### Published desktop sidebar usability repair — 2026-10-26

The current Watch comparison reproduced a distinct usability defect: opening
Vocabulary hid the source from accessibility and blocked caption inspection.
The original 1200px regression fails at the source Home action under the modal
sidebar (`sidebar-nonmodal-red.log`). The shared owner is `packages/ui/src/Dialog.tsx`;
its other actual sidebar consumer is Reader `ImageSourceWords`.

Watch sidebars now retain one nonmodal content owner across the 720px drawer
breakpoint. Ordinary web dialogs and native dialogs retain modal behavior.
Reader's Page words keeps its existing nested modal workflow; the first broader
run reproduced three failures when that child was incorrectly nonmodal beneath
Reader appearance. Dialog now exposes modality independently from its geometry,
and only Watch requests nonmodal behavior.
The pinned RN Primitives 1.5.2 web Root previously dropped Radix's `modal` prop;
`tools/patch-rn-dialog.mjs` forwards it through the existing private context and
guards all four consumed web/type artifacts by exact upstream hashes.
Postinstall applies it alongside the existing ExpoVideo repair. Native runtime
artifacts are not patched. Its unit test, typecheck and ownership lint pass.

The first passing interaction render exposed a misplaced frame in document
flow. A plain portal boundary now keeps Unistyles frame styles below Radix's
direct-child clone. The strengthened regression verifies the right 320px pane
and full viewport height. Six Watch/ordinary-dialog desktop and narrow checks
pass; the corrected wide capture was inspected. These fixture captures
explicitly lack native media decoding and do not certify full visual parity.
The first broader run had 46 passes and four failures: the three nested-modal
failures above and an invalid Watch fixture expectation of successful capture
without native duration. Watch now checks preservation of the actual recoverable
capture error across resizing; Reader's existing capture-capable fixture checks
the real committed receipt across the same breakpoint. The corrected product
source passes 49/50 checks; the remaining failure sampled the resized bounds
before React applied desktop geometry (the failure capture already shows the
correct pane). The assertion now waits for the actual full-height/compact
layout state before reading bounds, without a sleep. The final serial run
passes all 50 checks in 29.0 seconds (`sidebar-modality-verified.log`).
It covers both real sidebar consumers, ordinary dialogs, source inspection,
capture/error state across resizing, practice retry identity and focus return.
Wide and compact Watch captures were inspected; the wide pane remains at the
right edge with the source available. Exported renderer SHA-256 is
`1d830f0783db0a3cc3bb934d9912a5b0dd734e80e5c1549646e7a7d4c4c267b3`.
Both owner suites pass (79 infrastructure and 136 client/package cases).
The consuming debug macOS build succeeds in 8.31 seconds. In the retained
`net.kikan.mlearn.v3dev.m07qa` profile, native caption activation opens Inspector
with Vocabulary retained; dismissal returns focus to the original caption token.
Capture `sidebar-modality-native-source-inspector.png` was inspected.

That real-surface check exposes another blocker: Play receives focus, but the
old Watch `paused` prop still forces pause whenever `transcriptOpen` is true.
The source remains at 22 seconds. The condition now forces pause only for a
covering compact/native sidebar; desktop panes retain the initial pause on
opening but permit explicit playback afterward. Final-source typecheck,
ownership lint, web export and all nine Watch/foundation browser checks pass
(7.7 seconds). The second consuming debug build succeeds in 6.51 seconds.
Its renderer SHA-256 is
`f7ec2093a41ccac919ea7427efba7ca09431935ce03c3a4a7e272868d03d2253`;
the `mlearn-desktop` executable SHA-256 is
`ca4d1deb5303cd6519afa2bdcf7ebd870f90da3233036dcbdc8022885bae0868`.
In the actual macOS app, clicking Play beside Vocabulary changes the control
to Pause and advances from 22.000 to 27.696 seconds; explicit Pause stops at
33.795 seconds. A real seek then moves to 19.849 seconds with the pane retained.
Opening offset options and closing returns focus to the same -6350ms control.
`sidebar-playback-native-synchronization.png` was inspected. Home returns with
the saved source progress; the app exits normally (code 0).

The first app exited cleanly before the next serial build;
its bundle and evidence are retained. OmO physical footprint is 2,181,166,232
bytes afterward, pressure is normal, host headroom is 6,732,513,280 bytes and
swap-out remains 28,479,864,832 bytes. The first app's sampled footprint was
183,747,832 bytes; these measurements do not diagnose the earlier OmO spike.
During final native verification, OmO physical footprint is 2,353,624,216
bytes, app footprint 188,253,456 bytes, host headroom 6,578,733,056 bytes,
pressure normal and swap-out unchanged. The expired bounded guard was
replaced while the owned app ran; the replacement guard was stopped after
normal app exit. No device, inference or reference workload ran. Both native
candidate bundles and the original source-bound bundle remain retained.
This closes the demonstrated source-access/playback blocker, not the
remaining header/control/content-order differences against the edited
Vocabulary reference. Full Watch visual conformity, Inspector comparisons,
Windows input cause and the distinct iOS verification remain open.
No native/reference application, device or model was started for this repair.

#### Current source-bound platform follow-up — 2026-10-26

Sidebar checkpoint `c4ce513b351121e4803178a6567487b6b677a3af` and the separate
Android-budget checkpoint `4620a573` are pushed to existing OPEN/draft PR #44.
Exact source tree is `e29ddeeca19cefea1729f8afbc1d26b9af4b3b8d`.
Real desktop run `40405789588` passes. Foundation `40405789602` passes Rust,
OCR detector, web and macOS, but Windows job `121865345557` fails its actual
native-theme-material input stage. It is not an all-green foundation result.

Artifact `12690653356`, `windows-native-materials`, is retained under
`.mlearn/m03-m07/m07-messenger/ci-c4ce513-windows-materials/`.
Source receipt matches exactly; failure desktop/UIA frame was inspected.
Dark Quartz input/save and native DWM checks pass. Subsequent Slate input
never replaces the complete Dark Quartz JSON, although UIA reports the editor
focused. This does not establish a Settings reset, persistence or DWM defect.
The existing native keyboard/clipboard path, complete-input equality and all
material/restart assertions remain intact. A bounded diagnostic delta records
own clipboard equality, observed value changes and native foreground/focus/
caret handles alongside UIA focus. This is not a verified fix.
PowerShell, Windows UIA and a `.ps1` language server are unavailable locally.
Diagnostic source `e99f5dcc6cb9a98790ff799296ba4e6a8e25a203` now passes all
five foundation jobs in run `40410634669`, including actual Windows compilation
and material execution. Its real desktop run `40410634672` also passes.
Artifact `12694167204` verifies source/tree `e99f5dcc`/`b4757ce3` and all five
native material/restart states. Logs, JSON and every frame were inspected.
Clipboard equality and foreground ownership are correct in this passing run;
zero native caret handles are normal here. The value trace observes the old
document before the complete replacement, correctly handled by the existing
event-driven wait. This passing run does not identify the earlier input-loss
cause; the Windows repair remains open.

The next bounded reproduction adds four alternating Dark Quartz/Slate modal
reopen/edit/save cycles before the original restart/restore checks. Every
input/save assertion still terminates immediately on failure; no action retry,
sleep, API substitute or material assertion is removed. This changes the
repeated-modal-lifetime stimulus to obtain a failing trace, not a count-based
acceptance claim. The extended Windows scenario still requires execution.
The diagnostic-only paths do not trigger mobile; that workflow explicitly has
`cancel-in-progress: false`. The bounded repeated-input probe is published as
`91b5a0e78457873acb38f484e6c9f79f10ed7224`, tree
`6c5b09719d2e2253efa674eb090de57b56b1883f`. PR #44 remains OPEN/draft.
Its foundation run `40414695189` passes all five jobs; consuming desktop run
`40414696033` passes. Artifact `12695942848` is retained under
`ci-91b5a0e-windows-materials/`; exact source/tree receipt and run log verify
all four repeated cycles, twelve input operations and the original five
material/restart checks. This is bounded passing evidence, not an identified
fix for the intermittent input loss. Application/UI source is unchanged by
both QA increments.

Preserved mobile run `40405789643` is now terminal at actual product source
`c4ce513b`, tree `e29ddeec`. Android job `121863064558` passes in 66m46s:
21:36:37 to 22:43:23 UTC. Preparation reaches the unchanged UI step at
22:33:26, already beyond the old 55-minute job limit. The UI step passes
in 9m50s; JUnit has one test, zero failures, 382.462 seconds. This verifies
the published 90-minute job allowance without changing its 20-minute UI
deadline or assertions. The Android-budget task is closed.
Artifact `12695355497` is retained under
`.mlearn/m03-m07/m07-messenger/ci-c4ce513-android/`. Exact source receipt,
JUnit and all 16 native captures were inspected in small batches: saved and
restarted rate/offset, actual playback/seek, Knowledge claim, transcript search,
Japanese readings/prosody/synchronization/live-card Inspector and independent
English source continuity. These are functional native evidence, not completed
desktop visual parity or physical-device certification.

iOS job `121863064345` fails the specifically deferred original picker gate:
`Assertion is false: id: m01-watch, mp4 is not visible`.
Artifact `12694805642`, exact source receipt and JUnit (one test, one failure,
123.368 seconds) are retained under `ci-c4ce513-ios/`; failed-step log is
`ci-c4ce513-ios-failed.log`. This does not verify the later SourceRow/UIKit
metadata repair. No FileProvider variant, workflow rerun or local device was
started. Windows input cause, that distinct iOS verification and all remaining
Watch/Inspector comparisons stay open. Ledger is 215/250, not M07 acceptance.

A deliberate isolated-reference measurement was admitted, then stopped
immediately when its live guard observed OmO PID 82251 physical footprint
9,471,160,344 bytes, RSS 1,868,644,352 bytes, pressure 2 and headroom
3,421,011,968 bytes. The cause is unestablished, not attributed to Electron.
The detached owned reference PID 96796 and its two identified children were
released; all reference ports are absent. Its isolated settings hash and
tracked source remain unchanged. No new reference capture is claimed.
Bounded `vmmap -summary` reports current 3.2 GiB and historical peak 14.4 GiB;
later normal pressure is recovery, not a diagnosed fix. Evidence is
`watch-reference-header-{resource.jsonl,app.log,omo-vmmap.log}`.
That reference measurement remains incomplete. Later bounded serial sidebar
checks above were separately admitted from fresh footprint, pressure, swap
trend and headroom samples, with a live guard while applications ran. They do
not diagnose the OmO spike or grant general admission to large workloads.

#### Sidebar synchronization placement and focus verified — 2026-10-26

The same Watch synchronization controls now render within the open desktop
Transcript/Vocabulary sidebar's Dialog focus scope, rather than underneath its
modal layer. Dialog owns the floating slot and header return target; MediaOverlay
owns disclosure, backdrop contrast and dismissal. There is no second control
implementation or feature-local button styling. Light-sidebar contrast is
protected at the existing large-text threshold; source translucency is preserved.
Playback options resolve the actual toolbar/offset opener through live refs,
and widget dismissal returns to the retained sidebar Close action.

Evidence base remains `.mlearn/m03-m07/m07-messenger/`. The original
`watch-sidebar-focus-red.log` reproduces the lost offset focus. Owner checks
and 50 Watch/dialog/foundation/Reader-image cases pass before the final
live-opener refinement (`watch-sidebar-focus-green.log`). The final tree passes
typecheck, architecture lint, web export and all nine Watch/foundation cases
in 7.6 seconds (`watch-sidebar-current-focus.log`). Desktop and 320px captures
were inspected; the wide case asserts sidebar containment, readable contrast,
both playback return targets and retained parent focus after dismissal.

Fresh 1536 MiB admission precedes one-job native build 816: dev profile,
7.49 seconds, maximum compiler RSS 1,027,145,728 bytes. Bundle
`target/debug/bundle/macos/mLearn M07 Sidebar Focus QA.app` retains the isolated
`net.kikan.mlearn.v3dev.m07qa` identity. Executable SHA256:
`618f3772d1265b08f7d02fb97a496c935d01dfb315665fac5c06c075f3a7abfa`.
Embedded UI SHA256:
`982b40442d15cc4b93d3a8781d95b8bb10db4aa7373701ea74d5b4bc7737d08e`.
The final read-back log binds all five changed source files to this native proof.

After fresh 1024 MiB app admission, PID 93343/window 1475 resumed the actual
test-video.mov at paused 22 seconds. Native AX/keyboard actions opened
synchronization, Transcript, Sidebar content and Vocabulary, then the actual
offset/options dialog. Closing options focused `Subtitle offset: -6350
milliseconds`; dismissing synchronization focused the sidebar Close button.
The Vocabulary group remained present in the atomic native observation.
Closing the sidebar, opening options from the toolbar and closing again focused
`Playback options`. No focus was manually restored between action and read-back.
Native full frames and inspected crops are `watch-sidebar-native-options-return*`
and `watch-sidebar-native-dismiss-focus*`. Home return succeeds.

Read-only SQLite confirms unchanged position/duration/offset/rate
`22000|223042|-6350|1.0`. Cmd+Q exits app 817 with code 0, PS confirms PID absent,
guard 805 is stopped and the desktop session is closed. Final same-PID OmO
sample is physical footprint 4,091,129,808 bytes, RSS 4,502,339,584 bytes,
available 6,884,212,736 bytes, pressure 1. Compiler/app admission logs and
`watch-sidebar-focus-resource.jsonl` retain the resource observations; the
earlier unexplained OmO spike is not declared fixed.

This closes the demonstrated sidebar usability/focus defect, not whole
Watch/Inspector visual parity or M07 acceptance. Self-review found one shared
control owner, bounded live view refs and no domain/protocol/persistence change.
The ordinary source-bound mobile run must still verify the Android job-budget
repair and existing iOS SourceRow change. The specifically deferred iOS picker
failure stays unresolved; no diagnostic variant or device restart was launched.

#### CJK acquisition and synchronization anatomy verified — 2026-10-26

Evidence base: `.mlearn/m03-m07/m07-messenger/`.

Three source-bound web jobs (88ebc0a3, be006f2c and cfafc611) exceed the
20-minute job limit downloading the same 61.2 MB fonts-noto-cjk archive
from Azure's Ubuntu mirror. Job 121674173479, log lines 445–446, records
that boundary; its application checks never ran. The independent 8bade6b2
web job passes, so no product or test change is justified.
Both Linux consumers now use `tools/configure-ci-apt.sh` and Ubuntu's primary
HTTPS archive through the existing local APT mirror-list mechanism, preserving
authenticated metadata/package hashes and every package/font/Japanese assertion.
The helper records before/used mirror lists and the 30-second HTTP/HTTPS,
two-retry policy. Foundation bounds font download at 180 seconds and records
the installed version; desktop bounds update/download at 120/360 seconds.
Both install verified cached archives with --no-download; step limits are
5/12 minutes, with fail-fast Bash and unchanged job limits.
Both complete YAML files, exact acquisition shells, helper bash -n
and diff checks pass (`cjk-shared-acquisition-checks.log`); Bash LSP is
unavailable and no dependency was installed.
Checkpoint `9c5f9329f252f67cf505a421b3120677d2008c1e` is pushed to agent/m01;
PR #44 read-back remains OPEN/draft at that head. Both automatic source-bound
workflows now pass. Foundation run 40366543976 passes all five jobs:
Rust 121725695205, detector 121725695675, web 121725695788, Windows 121728392909
and macOS 121728392983. Web includes npm tests, typecheck, lint, export,
authenticated fixtures and 119 browser tests. Its genuine 61.2 MB font download
finishes in four seconds; installed version is 1:20230817+repack1-3.
Real desktop run 40366543954 / job 121725694184 passes acquisition, Japanese
glyph coverage, fixture decoding, actual build, IPC, plugin download and restart.
It downloads 393 MB in 62 seconds, including the same font from the primary
HTTPS archive. No assertion or package was removed. Raw successful logs are
`ci-9c5f9329-web-complete.log` and `ci-9c5f9329-desktop-success.log`.
The first web-log fetch was refused while other foundation jobs were running;
that response remains in `ci-9c5f9329-web-success.log`, not a test failure.
The font-repair task is closed. macOS did not execute apt or install packages.

The later source-bound mobile run 40390043745 at eb754814 is not green:
iOS job 121808342489 reaches the expressly deferred picker assertion,
`id: m01-watch, mp4 is not visible`; log ci-eb754814-ios-failed.log is retained.
Android job 121808342890 independently exceeds its 55-minute job limit,
not an iOS dependency or matrix fail-fast. It starts at 19:48:41 UTC,
enters actual UI at 20:38:20 and is cancelled at 20:43:50 on October 26.
The check annotation explicitly reports the 55m0s execution limit.
Cold preparation consumed 49m39s, leaving only 5m30s for the existing
20-minute UI step. The bounded Android job allowance is now 90 minutes,
matching the existing iOS allowance; UI limits, assertions, runners, pins,
inputs and uploads are unchanged. Complete YAML parsing and exact budget/
concurrency checks pass; YAML LSP is unavailable and was not installed.
Observation receipt is ci-eb754814-android-deadline-observation.json.
This is a configuration repair, not a passing Android workflow claim;
the next ordinary source-bound run must execute the unchanged gate.

MediaOverlay now owns typed synchronization controls, 10 px body inset/gaps
and leading close, with feedback below its wrapping row; Watch migrates its
actual controls without local button styles. First native build 693/app 695
exposed a 40 x 32 close and missing header. Red run 706 proves 221 expected /
220 actual. Actual PanelHeader.css specifies a 1 px hidden / 50 px disclosed
header, 5 px leading inset, divider and 40 x 40 close. Padding now belongs
to the body; native touch retains its 54 px header / 44 px target.
The shared mediaClose role also restores SubtitleSync.css's 70% white close
glyph and dark.css's 15% white intense hover; cue controls retain secondary ink.

Final renderer run 764 passes all 78 checker and 136 client/package tests,
typecheck, ownership lint, web export and three responsive cases in 3.9 seconds.
Five changed-file LSP checks have no errors. All nine idle/focus/hover frames
at 1200/500/320 px were inspected. Assertions protect 221 px idle width,
40 x 40 close, unchanged cue positions, actual dismissal and card containment.
Logs/frames are sync-close-role-green.log and sync-close-role-green-results/.
Native build 766 passes in 7.58 seconds after 1536 MiB compiler admission,
with one Cargo job and peak RSS 1,027,129,344 bytes. Earlier compiled bundles
are retained. New bundle mLearn M07 Sync Close QA uses the same isolated
identifier net.kikan.mlearn.v3dev.m07qa.
Executable SHA256 dd48107c72cd8ae3ee9e48495706baef513decf74253736c78cf6ea5f919e2dd;
UI SHA256 d33650594e56822aeb3998065e8eac9c8996c33b42f365bf052f022394cd2779.
This binary consumes the seven-file candidate over 562cd3ef; the retained
source-file hashes bind the precommit native proof to the checkpoint.

Corrected app admission uses the established 1024 MiB allowance, not the
1536 MiB compiler estimate; the separate 25% host reserve is unchanged.
Guard 759 genuinely stopped on pressure/headroom: OmO footprint rose from
4,530,630,608 to 10,938,134,504 bytes, pressure 1 to 2 and swap-out increased.
The new app had not launched. Bounded same-PID diagnostics later show recovery;
cause remains unestablished, not attributed to devices/models or declared fixed.
Compact evidence is omo-footprint-spike-vmmap.log. Its historical peak is not
an admission threshold. Three fresh samples in admission 770 pass with normal
pressure and stable swap-out before deliberate app launch 771.

Actual PID 80098/window 1412 resumes test-video.mov paused at 22 s / -6.35.
Real global pointer hover reveals the 40 x 40 close at 1225,113 while
previous/offset/next remain at 1280/1330/1440,113 with widths 40/100/40.
Native hover full frame and 540 x 100 region are
sync-close-role-native-hover.png / sync-close-role-native-hover-region-2x.png.
The region was directly compared with the approved 600 x 150 reference crop.
Backdrop differs over video versus Sidebar, so this is not full Watch parity.
Actual close dismisses synchronization, Home return works, and read-only SQLite
confirms original position/duration/offset/rate 22000/223042/-6350/1.0.
Cmd+Q exits 771 with code 0; PS confirms absent. Control is released,
desktop session closed and owned guard 769 stopped after verification.
All 117 recovered guard samples are safe: pressure 1, maximum OmO footprint
4,248,449,000 bytes, minimum available 6,623,264,768 bytes and unchanged
swap-out 18,156,847,104. Raw evidence is
sync-close-role-native-resource-recovered.jsonl. No model/device/reference
was started. Full Watch/sidebar/Inspector and final milestone gates stay open.
The planned isolated reference launch 680 also held before any process;
reference source remains clean and settings SHA256 unchanged
130fb58b57b132474dde4399188d9dc3480d759df834281177a8dcf88f52aa94.

The cfafc611 foundation Rust/detector/macOS/Windows jobs pass, including all
five Windows material states with the unchanged keyboard harness. Original
8bade6b2 Quartz replacement loss is retained with screenshot/UIA: the owned
HWND remains foreground, the editor focused and JSON unchanged. Its cause
remains unexplained. Separate desktop job 121674171820 cancels after 40 minutes
of Azure package acquisition, before any app build/test; its log records a font
retry at 16:17:11 UTC and cancellation at 16:22:58 UTC on October 26.
Older iOS job 121664227372 fails at 16:21:59 UTC at the expressly deferred
picker gate, before metadata verification; its Android job 121664226842 passes.
Mobile run 40351977298 is now terminal at cfafc611: Android 121697308039
passes; iOS 121697307639 fails at 17:24:42 UTC with the same expressly
deferred `m01-watch, mp4 is not visible` picker assertion, before testing the
source-row metadata candidate. Raw log: `ci-cfafc611-ios-failure.log`.
That candidate remains native-unverified; this is not evidence against it.
No FileProvider diagnostic variant was launched. The CI-only 9c5f9329 change
triggers only the two workflows above, not another mobile run.
Ledger: 212/246 closed, 34 open.

#### iOS source-row metadata accessibility candidate — 2026-10-26

The older exact604c9954 mobile40343044633 is terminal: Android121642544970
passes; iOS121642545459 fails after318.772s at player-ios.yaml's original
`0:20 · English · Subtitles` assertion. This is NOT the deferred FileProvider
failure: real picker, claim/settings/restart/playback/paused20s stages completed.
Source/tree receipt604c9954/7743640a, JUnit, command trace, exactstep211image/
hierarchy and preceding paused-seek image are retained under
`ci-604c9954-ios/`; original artifact12663410334 (83452092bytes) is retained
as `ci-604c9954-ios-evidence.zip`. Both actual frames are inspected; failed
Home frame is opened in Preview. No app save-position defect is inferred.

The Home recent-source row is partly below the viewport. Its native hierarchy
exposes only `Resume m01-watch.mp4`, bounds24,771–369,849, no metadata value.
SourceRow's labelled Pressable groups/hides its child detail Text. Repair that
shared accessibility owner: expose the existing detail as UIKit value, keeping
the stable action label and Rust-derived source projection. iOSonly because
installed ReactNative BaseViewManager.java439–446 merges Android value into
contentDescription, which would change the existing action identity.
Pinned Maestro2.11.0 IOSDriver maps UIKit value to text when titleempty;
Filters.textMatches checks that text. No renderer clock/persistence authority,
new theme setting, fabricated progress or data migration.
The existing iOS flow scrolls/centers the real Resume row, retains the exact
original20s assertion and all restart assertions, and adds a Home evidence frame.

Psych parses both YAMLdocuments; typecheck/lint/webexport and all7existing
foundation/real-core Home/source cases pass in6.8s (`source-row-ios-checks.log`).
Browser proof does not certify UIKit. Fresh SourceRow LSP repeatedly times out;
yaml-ls is not installed. Neither is reported clean; no package is installed.
All27guard samples safe/pressure1, maxfootprint3670847512/minheadroom5837406208,
swap4319543296/swap-out16247193600 unchanged. Guard662 stopped; no local
device/app/reference/native build or model was launched. Reference geometry
measurement is paused before execution in favor of this demonstrated native
functional gate. Exact native entry/wrapper/action recipe is in current PLAN.
Candidate native verification remains required from the standard source-bound
workflow; no FileProvider variant or unchanged manual rerun is launched.
Repair task stays open; ledger211/245closed,34open.

Other CI receipts: 8bade6b2 desktop40347729831 is direct-confirmed success.
be006f2c foundation40346002717 has four native/Rust/detector successes, but
web121652965707 exceeds20min during CJK-font installation before web checks;
original `ci-be006f2c-web-cancelled.log` is retained, not reported green.
Current glyph-source foundation/mobile observers remain source-scoped.

#### Synchronization glyph scale verified on native — 2026-10-26

Shared Button mediaSync glyph now uses the reference's effective20px size,
not the nominal30px SubtitleSync rule; identical SVG path/opacity and existing
hit geometry remain. Red expected20/actual30, green3responsive cases in3.9s,
typecheck/lint/export and Button/test LSP all pass. Native proof now also passes.
All exact entry points, commands and actions were recorded in current PLAN
before each scenario; the earlier2GiB admission hold remains retained.

Read-only admission619 became stale before launch: fresh headroom6257115136
did not cover2GiB plus4GiBreserve. Use the measured matching cached build581
maximumRSS1029144576 to estimate1536MiBadditional (~56%allowance), while
leaving reserve/pressure/swap/growth guards unchanged. Fresh3sample admission
passes. Offline single-job debug build626 passes7.33s, maximumRSS1028276224.
This is a workload estimate, not RSS admission or a guaranteed peak.
`watch-glyph-native-measured-build.log` preserves the actual run.
Bundle `target/debug/bundle/macos/mLearn M07 Watch Glyph QA.app` uses isolated
m07qa identifier; executable SHA256
`68875e53311b6fe82a12f0a31425bf6d033cecd95ba36e56d6094b3c46f30634`;
UI `index-5393161ba95dfa0b40a7174ed5423607.js` SHA256
`7f4f4aada129370f92445fb630dd014d97719bda11dbf4bd10986dd0bad9834e`.

Fresh1024MiB admission precedes app51275/window1318. Actual Continue ->
paused25.22s -> synchronization is inspected at1512x949 and500x850.
Same-scale native500x150region and approved reference are compared directly:
glyph ink size now matches; overall panel width/control spacing still differs
and is not declared visually complete. Full windows and narrow containment
are inspected/opened in Preview. Offset focus reveals enabled Hide; pressing it
closes synchronization. Actual slider22s/Home restores22000/-6350/rate1,
confirmed read-only. No alignment/Material/claim mutation.
Native captures and SHA256:
`watch-glyph-native-wide.png`3024x1898
`561098852671a73ea2c3d4012334804f7bba4403d1100e6cf285046bf5ba483a`;
`watch-glyph-native-narrow.png`1000x1700
`318da9fb5878429e4ed5433d8bb6d42bd7235477317bf3a67572cdf257251fdc`;
`watch-glyph-native-region.png`500x150
`9800d1da4e0edc07ec149e63fda553c0b36310baf7a8bfdb838c21d3aab5e230`.

All52guard samples safe/pressure1: maximum footprint3710136344,
minimum headroom5450432512; swap4344709120 and swap-out16247193600
unchanged. App628/guard625 stopped; control released/computer closed;
PID51275 and ports8081/7780/58359 absent. Post-stop physical3675631640,
headroom6276169728/pressure1. No device/reference/model/server launched.
The glyph increment is verified, not whole Watch/Inspector/M07/final acceptance.

Separately, exact diagnostic-source be006f2c desktop40346002844/
job121652966062 passes the complete original Linux native workflow.
Application source is unchanged from604c9954; only tested timeout provenance
changed. Original604ctimeout remains unexplained and retained, not reported
fixed or erased. No speculative app fix, assertion weakening or extra workflow
variant is justified by that non-reproduced failure.
The optional deeper timeout investigation is dropped, not marked repaired;
ledger211/245closed,34open includes historical dropped items.

#### Source-bound desktop timeout evidence; glyph delta awaiting native admission — 2026-10-26

Automatic desktop run40343043589/job121642541443 fails on exact
604c9954/tree7743640a during real IPC/plugin/restart verification.
Exact-source foundation40343043608 separately passes all5jobs:
Rust121642541624, detector121642541867, web121642541939,
macOS121645644869 and Windows121645644876. The earlier font-download timeout
therefore remains historical; no font/workflow repair was made or is claimed.
Mobile40343044633 remains on its existing observer.
Original failed log is `ci-604c9954-desktop-failure.log`; original54.97MB
artifact12660832111 is retained as `ci-604c9954-desktop-evidence.zip`.
Only source receipt and immediate failure files are extracted under
`ci-604c9954-desktop/`. The actual failure image is inspected/opened in Preview:
paused source20s, raw字幕 and explicit unsupported-English analysis error.
Media diagnostic has readyState4/networkState1/currentTime20,
pausedtrue/errornull/duration30. Earlier restart/progress/Inspector captures
exist, but the final raw-subtitle scenario does not pass.
The last exception is a bare fetch DOMException TimeoutError with no awaiting
scenario or request endpoint. Original code does not establish which RPC
timed out; no application defect or infrastructure-only cause is inferred.

The existing rpc owner moves beside clickControl/WebDriverError in
tests/desktop/webdriver.mjs. A typed WebDriverTransportError retains method,
endpoint, original cause and caller stack without recording scripts/payloads.
No request replay, deadline extension, assertion change or native retry is added.
Five targeted desktop-driver tests pass, including no-replay timeout identity
and distinct native protocol rejection; both harness syntax checks, architecture
lint and all3changed-file LSP diagnostics pass.
Evidence: `desktop-timeout-provenance-checks.log`. Actual Linux diagnosis
remains open until source-bound execution identifies the failed operation.

Independent local glyph delta: reference Button.css357–362 overrides the
nominal30px SubtitleSync SVG to20px; path/opacity already match. Shared
Button mediaSync now uses20px while hit targets remain unchanged. Existing
watch-layout regression fails expected20/actual30 before repair; all3responsive
cases pass after in3.9s, including20x20glyph and>=40x40desktop hit assertions.
Typecheck/lint/export and Button/test LSP pass; all3standalone frames inspected.
This delta is not native-verified or included in the timeout-provenance commit.
Fresh2048MiB build admission608 exits70 without starting a build: pressure1,
stable swap-out16247193600, headroom5939249152–5992677376 is insufficient
after the explicit budget and unchanged4294967296host reserve.
No app/device/reference/inference is launched. Guard605 is stopped.
No reserve reduction or automatic workload launcher is introduced.
Full Watch/Inspector/M07/final gates remain open; ledger210/245closed,35open.

#### Watch comparison exposes standalone synchronization misalignment — 2026-10-26

The alignment increment is now verified on genuine native wide/narrow
windows. After the stopped release-LTO attempt below, stable recovery samples
admit a different cached development-profile build with an explicit2048MiB
budget and unchanged host reserve/pressure guards. No Cargo profile is edited;
optimized Wasmi/sha2 dev overrides and safety checks remain. Build581 passes
in1m10s, `watch-sync-dev-build.log`; reported build-command maximum RSS is
1029144576 bytes (diagnostic, not whole-host peak). No Metro/reference/device/
model workload is started. This is layout/function proof, not release performance.

Separate bundle `target/debug/bundle/macos/mLearn M07 Watch Dev QA.app`
retains isolated identifier `net.kikan.mlearn.v3dev.m07qa`.
Executable SHA256:
`45e06c95299fc027ec30dcdb1f46b24649d2b5b34f289da608908636e9be75c1`.
Exported/consumed UI `index-d05d272db8f9939c3851fe637ac6b449.js` SHA256:
`8be48af6dfda547629476f0b178b910afc83b5e0905d713ffb2ff02a3ece279c`.
Local WatchScreen repair diff SHA256:
`575340186d342ae79028c30f381546d2a2c413000e95739d9e3d33e3a927dd46`.
Earlier retained release bundles are preserved.

Fresh1024MiB admission precedes deliberate app46846/window1300.
Actual Continue test-video.mov -> paused slider25.22s -> Subtitle
synchronization produces the repaired right-aligned control at1512x949.
Native next-cue bounds are global1557,73,40,40 in the window at100,30.
The same source/control remains contained at500x850. Focusing offset reveals
the real Hide synchronization button; pressing it removes the offset control.
Slider22s then Home restores persisted Japanese
0.1.7-sudachi20260116-jmdict20261017-ocr2/22000/-6350/rate1, confirmed
read-only. No alignment/claim/Material mutation is made.
Both actual captures are inspected/opened in Preview:
`watch-final-sync-alone-wide-after.png`3024x1898 SHA256
`3edc54ac01ced41c79b7989bfb1113929568890e965a1b278bc80ffa16d193c8`;
`watch-final-sync-alone-narrow-after.png`1000x1700 SHA256
`49f9d538c11fe94b25301eab2d491752320a3b7b750b719c81fe61567c9d078d`.

Primary reference window is cropped only outside its complete chrome:
original3248x2122 -> crop3024x1898 atx112/y76; originals remain untouched.
Same-scale500x150 synchronization crops atx2524/y60 are inspected separately.
`watch-sync-region-diff.json` has matching dimensions and13% similarity;
it is not a visual pass. Alignment is corrected, but current double-arrow
glyphs visibly exceed the edited target and control width differs.
Button's mediaSync30px icon and Icon cueArrow are the next traced owners.
Sidebar placement/composition and the full Watch/Inspector matrix stay open.

All60build/native guard samples are safe/pressure1: maximum OmO footprint
4388696112, minimum estimated headroom5460590592; swap used4445372416 to
4420206592, cumulative swap-out unchanged16247193600 bytes. App584 and
guard580 are stopped, control released, desktop session closed; app46846
and ports8081/7780/58359 are absent. Post-stop sample physical3850530816,
RSS4821286912, headroom6208569344, pressure1. Earlier genuine pressure stop
and unexplained transient allocation below remain recorded, not dismissed.
Alignment task is done; ledger210/244closed,34open. No whole-M07, visual or
maintainer acceptance is claimed.

Requested reference commit `4a86df32` is already an ancestor of current
`88ebc0a3`; no fetch/reset/integration duplication is needed. Exact-head
desktop run `40337839331` is directly confirmed completed/success.
Foundation `40337839426` is terminal/cancelled at the same full SHA:
Rust121624099959, detector121624100029, macOS121626968741 and
Windows121626968853 pass. Web121624099468 exceeds the20minute job timeout
during Linux CJK-font installation; its npm test/typecheck/lint/export and
browser steps never run. Do not report that job green or infer an application
failure. Original job log is retained as
`ci-88ebc0a3-web-cancelled.log`: lines425–446 show the61.2MB
fonts-noto-cjk download from azure.archive.ubuntu.com starting14:21:32UTC
with no subsequent progress before cancellation14:35:06UTC. No assertion
failed and no repository repair is inferred from that timeout.
No rerun is dispatched.

Fresh guarded native comparison reaches original test-video.mov at25.22s,
offset-6350ms/rate1, in1512x949 and500x850 windows. The primary edited
`watch-sidebar-subtitle-sync.png` and
`watch-subtitles-sync-non-hovered-live-word-translator.png` are inspected.
Current wide synchronization defaults to the left when live cards are closed;
the edited targets place it at the right. Narrow placement is already correct.
Genuine originals are `watch-final-vocabulary-wide.png`,
`watch-final-sync-alone-wide-before.png` and
`watch-final-sync-alone-narrow-before.png` in the existing M07 evidence folder.
The current Vocabulary composition/content order and sidebar-inset
synchronization remain incomplete comparisons, not a whole-Watch visual pass.

Native source position is restored through the actual slider and Home.
Read-only SQLite JSON fields confirm22000/-6350/rate1. App43685, its guard
and computer session are stopped; no device or reference app is launched.
All42native guard samples are safe/pressure1; footprint maximum4448022552
bytes, minimum headroom5065506816, swap used3683844096 to3675455488 and
cumulative swap-out unchanged15410167808. These are observed bounds, not
leak repair or long-session certification. Initial direct local-wrapper
invocations failed126 because it is not executable; explicit Bash invocation
passed admission before launching the app.

The existing real-core `watch-layout.spec.ts` now reproduces the missing wide
alignment: after correcting the test locator to the actual offset-with-value
accessible name, next-cue x179 fails the expected right-half boundary600.
`watch-sync-placement-red.log` preserves that failure. One conditional
`justifyContent` on WatchScreen's existing overlay row repairs the owner;
the compact column and live-card flex owner are preserved.
Typecheck, architecture lint and web export pass; all3existing responsive
cases1200/500/320 pass in3.9s (`watch-sync-green.log`). All6standalone and
focused-card screenshots are inspected. WatchScreen LSP is clean; test-file
LSP freshness times out and is not claimed clean.

One offline single-job consuming native build was freshly admitted but is
stopped incomplete by the live guard: `watch-sync-native-build.log`,
session569. Guard sample at167593530ms records physical footprint9652547632,
RSS2884173824, host pressure2, estimated headroom2963423232, swap4301127680
and cumulative swap-out16044228608 bytes. It rejects host pressure and
insufficient projected headroom, exits70, and the owned build is killed.
Cargo45099 and rustc45224 are absent afterward. Post-stop physical footprint
4422168576, pressure1 and headroom6848970752 recover, but swap4462149632
and swap-out16247193600 increased. The transient OmO allocation is unexplained;
neither product causation nor resource repair is inferred. Do not replay the
same substantial build while investigating this event. No new app is launched.
The planned output is a separate
`mLearn M07 Watch QA.app` under the same isolated m07qa identifier, preserving
the earlier Sense/Escape/performance bundles. Exact invocation and native
after-capture/restoration recipe were recorded in current PLAN before launch.
The later development-profile replay above closes native alignment after
proof. Checkpoint commit/push and broader Watch/Inspector/M07/visual/cleanup
gates remain open.

#### Resource admission corrected; native selector replay passes — 2026-10-26

The maintainer requests fresh physical-footprint/host-pressure/swap-trend
admission rather than RSS or historical-peak blocking. Audit confirms the old
guard already reads `ri_phys_footprint`, not RSS; its defect is the fixed
3 GiB process ceiling and the subsequent overly restrictive quiet-reserve
gates despite normal host pressure. Those admission rules are superseded,
not the original exhaustion evidence or platform acceptance requirements.
The obsolete read-only observer is killed; its terminal status/notification
are confirmed despite a terminal-metadata cleanup EPERM. No persistent
workload launcher is introduced.

Tracked owners are `tools/macos-resource-sample.c` and
`tools/resource-guard.mjs`; the existing local resource-guard.sh delegates to
them. The macOS sampler reads the same PID's current physical footprint and
resident bytes, host pressure, total memory, free+inactive headroom estimate,
swap usage and cumulative swap-out bytes with a monotonic timestamp.
Speculative pages are not double-counted. Headroom is an estimate, corroborated
by pressure and trends, not a promise that every inactive page is immediately
free. RSS remains diagnostic and historical peaks are not admission inputs.
Sampling failures, unknown pressure and inconsistent process/clock/counters
fail closed.

Admission requires three fresh samples, 5 seconds apart. It retains 25% of
physical host memory as reserve, subtracts the explicit projected workload,
and projects sustained footprint growth over 10 seconds from both recent
intervals. Warning/critical pressure rejects work. Sustained swap-use growth
of at least 8 MiB/s with swap-out traffic of at least 16 MiB/s over both
intervals also rejects work; stable allocated swap alone does not.
The native QA admission budget is 1 GiB. The running guard uses zero additional
workload budget because existing allocations are already reflected in current
host headroom; it still checks pressure, growth, swap and the host reserve.
There is no artificial requirement that OmO become smaller than its healthy
idle footprint. This corrects admission, not the underlying OmO allocation.

The old guard's real healthy-host rejection is retained in
`resource-correction-old-guard.log`. Strict native compilation
(`clang -Wall -Wextra -Werror -O2`), bash syntax and both JS LSP checks pass.
All 9 deterministic `tools/checks/resource-guard.test.mjs` cases pass, covering
RSS divergence, footprint above the former cap, warning/critical pressure,
oversized projected work, no double counting, sustained/transient growth,
swap trends and malformed samples. No real memory-pressure stress is induced.
Fresh same-PID measurement gives 3885.59 MiB from libproc and 3886 MiB from
top MEM (0.42 MiB difference), normal pressure and non-growing swap.
Three live admission samples pass with about 5.62 GB estimated headroom,
a separate 4 GiB host reserve and the 1 GiB projected QA budget.

Native QA then deliberately resumes the retained `mLearn M07 Sense QA.app`,
unchanged executable SHA256
`5b959d9912acc4763de1f8a48ba70b32eceddaac2bf5cf7136dc57bfc8f716a7`.
On original test-video.mov/Japanese 0.1.7, the real `度胸` entry opens
at 25.22s. Its compact selector changes native AX value 0 to 1 and shares the
sense-heading row at 1512x949 and 500x850. The unsaved Capture editor retains
`courage; bravery; pluck; nerve; grit; guts`, selected noun sense, original
context/source and package revision. No learner claim or Save Material action
is performed. Closing the editor retains selection and restores focus to its
trigger; the narrow capture records that scrolled, focused state, not an
initial-scroll reference verdict. All three full-resolution captures are
inspected and opened in Preview.

| Native evidence | Dimensions | SHA256 |
| --- | --- | --- |
| resource-corrected-native-sense-wide.png | 3024x1898 | `12f004d830698b512a56ef3fe7f5cadc6f01de3cd3778cec9ae72e65fdd07111` |
| resource-corrected-native-sense-narrow.png | 1000x1700 | `b4036cc9a8ccd2147374befece21d8e19039da0c5b43cc411600532321eae458` |
| resource-corrected-native-capture-editor.png | 3024x1898 | `b8c1489d552858bb7602108a470f1ebda2d044b952e4429d5f15fd7debde57e8` |

The complete running-guard receipt has 76 safe samples: footprint
4078153704–4332417024 bytes, minimum estimated headroom 5321588736 bytes,
normal pressure throughout, and unchanged swap-used/swap-out counters.
No guard stop occurs. This is a bounded functional replay, not a leak fix or
long-session resource certification. Logs/captures are under
`.mlearn/m03-m07/m07-messenger/` with `resource-correction-` and
`resource-corrected-` prefixes.
Normal slider/Home actions restore 22000 ms; read-only SQLite confirms the
original Japanese package/version, -6350 ms and rate 1. App PID 40907, guard,
control grant and desktop session are released; owned QA ports are clear.
Existing profiles, models, binaries and the four original untracked files
are preserved. Compact-selector verification closes with prior 38-case
browser proof plus this native replay; the full M07/visual gates remain open.

Reproduce the bounded guard checks with:
`clang -Wall -Wextra -Werror -O2 tools/macos-resource-sample.c -o .mlearn/m03-m07/m07-messenger/macos-resource-sample`,
`node --test tools/checks/resource-guard.test.mjs`, and
`node tools/resource-guard.mjs <PID> once <sampler-path> 1024`.
The sampler is an explicit local QA prerequisite, not a normal Cargo/test
download or compilation step.

#### Compact dictionary-sense selection — 2026-10-26

The matched Inspector comparison identifies a concrete composition defect:
the full-width `Select sense ... for capture` row separates pronunciation
from the sense heading/definitions and consumes scarce dictionary height.
INS-10/MAT-01/MAT-03 still require selecting the meaning retained by Capture.
The placement question times out; the maintainer directs continuation on best
judgment. The existing selectedSense Button now shares the metadata row with
the sense heading, using the existing compact media icon-only treatment and
circle/checkCircle icons. Native targets retain the shared 44px minimum.
No new primitive, styling layer, backend authority or capture semantics.
DESIGN records the layout contract. Product diff SHA256 against `9223d3b4`:
`b7514ce0d69f949023d722e4dd8327a9c6abddf7f08f2034912f4fae06c80289`.

The existing Reader-image browser suite gains two-sense fixture data and one
scenario at each of 1080/393px. Both fail before the product repair because
the selector and sense heading occupy different rows (`sense-selector-red.log`).
Both pre-edit images are inspected. After repair, typecheck, architecture lint
and fresh export pass (`sense-selector-build.log`); Inspector and test LSP
diagnostics are clean. All 38 Reader-image scenarios pass in a single 21.7s
run (`sense-selector-green.log`). The new cases verify compact heading-row
geometry, keyboard-exclusive selection and the actual Capture IPC payload's
selected sense, meaning and original source. Both after images are inspected;
the full-width rows are gone and the definitions remain readable.
The full suite retains footer/Escape, crop, recovery, practice and source tests.
The owned static server is stopped before export and recreated afterward,
avoiding the previously demonstrated stale asset inventory.

One offline, single-job unsigned consuming desktop build passes in 2m54s:
`sense-selector-native-build.log`. New retained bundle is
`target/release/bundle/macos/mLearn M07 Sense QA.app`, identifier
`net.kikan.mlearn.v3dev.m07qa`; prior Escape/performance bundles are untouched.
Executable SHA256 is
`5b959d9912acc4763de1f8a48ba70b32eceddaac2bf5cf7136dc57bfc8f716a7`;
UI `index-0f9505cc950af6bcaf6360acd19d13b4.js` SHA256 is
`bcad37febb3efc2d9be3aeb9d9fde5fcd66997df8f73c17c6f1bc20ae282a525`.
This build is not a native functional pass. The deliberately launched app
PID 91430/window 1227 initially shows a blank window and only frame buttons
in AX; no source, Inspector or selector interaction is reached.
Before further native replay, the guard records OmO footprint 3272077312
bytes, exceeding the unchanged 3221225472-byte ceiling. The owned app is
immediately terminated and the desktop session closed. No startup cause is
inferred from that interrupted observation, and no passing native screenshot
or sense-selection replay is claimed.

Fresh admission before the bounded work is stable at
2483498984/2483466216/2482909160 bytes, 82% availability. The guard remains
active through the serial browser/build/native sequence, then terminates 70;
`sense-selector-admission.log` and `sense-selector-resource.log` preserve the
samples. At termination availability is 73%, swap 3889.19 MiB; post-stop OmO
footprint is 3236245504 bytes, availability 74%, and the QA port is clear.
This remains an OmO resource incident, not evidence that the application
caused the allocation. All owned app, server, build and guard sessions are
terminal. Browser placement repair is complete; affected-surface native
verification, the full visual matrix and the M07 milestone remain open.
This checkpoint preserves the partial result without self-acceptance,
weakening assertions or restarting a workload automatically.

Source-bound automatic CI for published `3da08793385f636eada913d8d0f9151782a7393c`
is now terminal. Foundation `40271434272` passes OCR detector `121404899884`,
Rust `121404900027`, web `121404900158`, macOS `121406482388` and Windows
`121406482606`. Real Linux desktop `40271434338` / native `121404900072`
passes. Mobile `40271434276` has Android `121404900267` passing and iOS
`121404900058` failing the exact expressly deferred
`Assertion is false: id: m01-watch, mp4 is not visible` after 1m13s.
Original failed output is `mobile-3da08793-ios-failure.log`, 30449 bytes.
No workflow is dispatched or rerun, and no assertion is relaxed.
The Swift/Python fixture blobs are unchanged from decode-failing `e6986c8a`;
both exports succeed on this run despite the same scaler service warning.
That warning alone is not sufficient cause. The optional fixture investigation
is dropped without a speculative fix; the original decode failure remains
unexplained and preserved, not reported repaired.

A second, materially different local replay avoids in-process screenshots:
fresh three-sample admission is 2955014144/2956390400/2956603392 bytes,
74% availability. The retained app is deliberately launched under a fresh
guard, using only AX and an explicit interactive foreground-control grant.
After activation, AX shows genuine Home, installed-language selection and
real source continuation controls. The earlier blank frame is therefore not
established as a startup defect. Continue test-video.mov is pressed once, but
before Inspector is reached the OmO guard crosses 3243798528 bytes at 70%
availability. The owned PID 96973/window 1233 is immediately terminated;
the control grant is released and the desktop session closed. A first attempt
to close through desktop.close inside computer.run is unavailable; the direct
close action succeeds. Read-only SQLite still confirms Japanese package
0.1.7 / 22000 ms / -6350 ms / rate 1. No claim or Capture write is performed.
Evidence is `sense-selector-ax-admission.log` and
`sense-selector-ax-resource.log`. No native selector pass is claimed.

The second breach occurs without an in-process image request, so that image
path is not a necessary cause. With all owned workloads stopped, resetting
only the persistent JS evaluation kernel plus synchronous GC reduces reported
JS heap to 3359744 bytes but leaves OmO physical footprint 3312414720 bytes
(from 3332304896 before reset), still above the unchanged ceiling; availability
is 70%, swap 3745.19 MiB. No app, device, server or model restarts during this
recovery. Retained evaluation state does not explain or repair the multi-GiB
allocation. Further substantial local verification remains held for the OmO
resource blocker. Current status is 204/239 ledger items closed, including the
dropped optional investigation, with 35 open; M07 is not verified complete.

#### Exact-source CI closeout and resource hold — 2026-10-26

Published source `e6986c8add4b5369d2d2ae514df7c2580ce737a1` is independently
confirmed as local HEAD, origin/agent/m01 and draft PR44's head. PR44 remains
OPEN against agent/h00. This is the verified bounded Escape repair below,
not a completed M07 milestone or visual-conformity verdict.

Foundation run `40260196003` passes all five jobs at that exact source:
web `121370708107`, OCR detector `121370708327`, Rust `121370708347`,
macOS `121371948286` and Windows `121371948294`. Desktop run `40260195990`,
native job `121370708154`, also passes. Direct run metadata confirms the
source and conclusions; both completion watchers terminate successfully.
Mobile run `40260195939` is terminal: Android `121370707975` passes, while
iOS `121370708175` fails in fixture generation before the UI driver starts.
The original 38144-byte failed output is retained at
`.mlearn/m03-m07/m07-messenger/mobile-e6986c8a-ios-failure.log`.
At 03:24:46 UTC AVFoundation reports error -11821, `Cannot Decode`, with
underlying OSStatus -16977, and the Swift fixture producer traps.
The preceding AppleM2ScalerParavirtDriver service-matching warning is not a
proven cause. This failure is distinct from the expressly deferred
FileProvider assertion; neither the picker nor subsequent iOS synchronization
behavior is certified by this run. The failed media directory is excluded
from the workflow's artifact paths. No workflow was manually dispatched,
rerun or weakened, and no picker diagnostic variant was launched.

One unchanged local fixture-only reproduction succeeds in 20.66 seconds,
exit 0, maximum RSS 253427712 bytes. It uses a fresh isolated output directory,
no application, simulator, model or private corpus:
`.mlearn/m03-m07/m07-messenger/fixture-decode-local-e6986c8a`.
Both H.264/AAC exports, matching SRTs and the distinct-content assertion pass.
English MP4 is 77170 bytes, SHA256
`f17e8a6d23d4d1596259861d46ab696ed34a86322492539e35e680e495e22850`;
Japanese MP4 is 77216 bytes, SHA256
`483f8d11171ee40d29e1e42403656613c94fdc4c7d8753934e9f02b046883622`.
The macOS 27 compiler emits existing AVAssetWriter API deprecation warnings.
This local pass does not reproduce or resolve the hosted failure. No
speculative fixture/product fix or new decoder dependency is introduced.

Three-sample memory admission passes before that probe, but the independent
guard records OmO PID 82251 rising from 2061348888 to 6740979736 physical
footprint bytes, above the unchanged 3221225472-byte ceiling. Availability
falls from 74% to 46%; swap remains 2597.19 MiB. The fixture has already
exited; no fixture/Swift process survives. The guard is terminal. Evidence:
`fixture-decode-admission.log`, `fixture-decode-resource.log` and
`fixture-decode-omo-vmmap.log` under the same evidence directory.
The bounded vmmap summary reports 2.7 GiB current footprint and a 12.8 GiB
process-lifetime peak. App-Specific Tag 1 has 4.2 GiB resident, 1.9 GiB dirty
and 1.1 GiB swapped; neither that tag nor the virtual address-space total
identifies a root cause. Evaluation-kernel GC reduces reported JS heap use
from 9767968 to 7531820 bytes but does not reclaim the multi-GiB footprint.
Do not attribute the OmO allocation to the 253 MB fixture process.

The recovery question times out; bounded read-only work continues on best
judgment without restarting workloads. Subsequent ownership recovery samples
small ranges from the 1094474945-byte session transcript. Output bounds do
not establish bounded internal allocation: footprint later reads 3112808448
bytes and swap 4145.19 MiB, versus 2101669840 bytes and 2573.19 MiB before
that work. Transcript reading is a candidate trigger, not a proven cause.
Further raw-transcript reads and substantial local verification are held
while this unexplained OmO growth continues. All owned fixture, guard, CI
and allocation-summary sessions are terminal; user-owned processes remain
untouched. Profiles, models, compiled apps, source and original evidence
are preserved. Remaining M07, visual, demonstration and cleanup gates stay
open: status is `paused_incomplete`, not acceptance or a passing milestone.

#### Native Inspector Escape regression — 2026-10-26

Actual original-video Japanese Inspector QA at 500×850 reproduced a keyboard
ownership defect: one Escape while Knowledge was open closed both the popover
and Inspector. Fresh native AX confirmed the original caption had focus and
Inspector was gone. The source remained at the original package/version and was
restored through normal controls to 22000 ms / -6350 ms / rate 1, independently
confirmed read-only in SQLite before the owned app was stopped.

The existing Reader-image browser suite now reproduces the same failure at
1080 and 393 pixels (`escape-red.log`): both fail because Inspector disappears
after the first Escape. Shared ContextPanel now uses the installed primitive's
cancellable Escape callback to dismiss its current popover; Inspector closes
only its Knowledge state and restores the real Knowledge button ref. A second
Escape retains the existing source-trigger restoration. No global keyboard
listener, claim mutation, renderer authority or alternate Inspector was added.
Typecheck, architecture lint and fresh web export pass in
`escape-green-build.log`. Inspector/test LSP are clean; ContextPanel's fresh
diagnostics request times out and is not reported passed.

The first full-file green attempt was cancelled after a proven QA-server asset
inventory failure: current HTML requested the new `8429b6d9` bundle, present on
disk, but the server registered before export returned 404. Its original logs
and failures remain. Restarting only that owned ephemeral static listener after
export serves the same asset with 200; the unchanged repaired source then passes
all 36 Reader-image scenarios in 20 seconds (`escape-green-served.log`),
including both Escape/focus regressions, footer geometry, crop/recovery and
capture interactions. The owned 58359 listener is released; user-owned 4173 is
untouched. The first native packaging invocation fails before compilation
because preflight's inherited `CI=1` is not a valid Tauri `--ci` boolean.
Only the invocation changes to `unset CI`; the same offline single-job
consuming macOS build then passes in 2m55s
(`escape-native-build-unset-ci.log`). The prior failure is retained.

The original native 500×850 Japanese `度胸` scenario now passes on
`mLearn M07 Escape QA.app`, executable SHA256
`9af5964e0a7739e202e86513c1cb72e5f75adfdde6cdd84cf69db968a7f33a15`,
with repaired UI SHA256
`75246f2a0e861960a336053f4847a0f552ec618d38e0a192787e775fcf52e37e`.
Actual AX first confirms the open Knowledge popover with its real claim action
focused. First Escape removes only Knowledge, retains Inspector and focuses
the real Knowledge button. Second Escape closes Inspector and focuses the
original caption token. No claim, model operation or injected state is used.
Full native capture `escape-native-narrow-first-escape.png` is 1000×1700,
SHA256 `a393358bbd583028512d63e49448c5c5fb64fede209c9fd16049d0ff0dfd3d80`.
The wide reference-comparison capture `escape-native-inspector-wide.png` is
3024×1898, SHA256
`fbfca0a83c177cf61206a7c15ab82f22d1dbb8118dcb86b050c5e97083f9580a`.
Both actual files were inspected and opened in Preview with the approved
Inspector reference. Earlier tool-returned wide PNGs are 2000×1255 inspection
derivatives, not relabeled as full-resolution originals or pixel-exact proof.

The app returns Home normally after restoring 22000 ms. Read-only SQLite again
confirms the original Japanese version, 22000 ms / -6350 ms / rate 1.
The owned app, static server and guards are released; 8081/7780/58359 are free.
Post-run OmO footprint is 2539335704 bytes, system availability 71% and swap
2853.25 MiB. No allocation fix or model/device cause is claimed.
Product-only diff SHA256 is
`17b064ca3fb82efc0101721e48205a83a6f27948f92616d00311153737c8c3a8`.
This bounded keyboard repair is verified locally for continuation. Its source
identity is the enclosing commit; the preceding bb9b595c CI does not certify
this newer delta. Full M07 and matched visual gates remain open.

#### Current performance continuation — 2026-10-26

The measured two-line timestamp increment and evidence below are now published
as `bb9b595cb58b4e7c00f58e1dffa243eb41bf9085`; PR44 remains OPEN/draft.
Exact-source foundation `40252289538` passes all five jobs: OCR detector,
Rust, web, Windows desktop and macOS desktop. Real Linux desktop
`40252289537` / native job `121346606465` passes in 6m16s, including the
Vocabulary/source-caption coexistence assertion. Both watcher filters returned
1 after their successful jobs; direct source-bound GitHub metadata confirms
success, not a workflow failure. Mobile `40252289555` now completes:
Android `121346606706` passes; iOS `121346606850` fails only the existing
`Exercise actual iOS UI and Rust persistence` step with the exact deferred
`id: m01-watch, mp4 is not visible` assertion after 1m48s.
Original failed output is retained in `mobile-bb9b595c-ios-failure.log`
(59548 bytes). Both consuming applications compile; a watcher subscription
deadline earlier expired while they were compiling, not because a CI step
failed. Its renewed subscription is now terminal. No manual dispatch or iOS
diagnostic variant was run.
The stale shared-vocabulary/scoped-practice implementation task is reconciled
as complete using its existing Watch/Reader consumers, owner/web regressions
and retained native selected-Material/two-probe/exact-Return workflow.
Full Watch visual comparison and full M07 verification remain open.
The existing local M07 `REVIEW.md` now consolidates both performance matrices,
exact resource-stop receipts and bounded persistence/storage observations;
long-session storage growth and physical-device coverage remain unproven.

Published Reader recovery checkpoint is
`38f92e7b51ea06ea98587026203bebef3875e744`; PR44 remains OPEN/draft.
Its foundation `40234894640` and real desktop `40234894664` pass.
Mobile `40234894606` completed: Android `121297520933` passes; iOS
`121297521343` fails the same deferred `m01-watch, mp4 is not visible`
assertion in 1m32s. Its original failed log is
`mobile-38f92e7b-ios-failure.log`. Earlier `dcfb1d39` mobile finishes
Android `121283773292` successfully; iOS `121283773472` fails the exact deferred
`m01-watch, mp4 is not visible` assertion in 2m26s. Its original failed log is
`mobile-dcfb-ios-failure.log`; no diagnostic variant was launched.

Two fresh normal documented desktop processes now exercise the same original
corpus video/subtitles, Japanese package and saved source settings. The sole
subsequent product delta is a two-line, metrics-flagged
`source_language_action` timestamp in the existing validated selector handler;
it supplies the missing application-side start span, not another command or
state owner. Its typecheck, ownership lint and LSP pass. Measured source is
base `38f92e7b` plus diff SHA256
`254e6d7df7928ee25373d5eadb4e09481cf000099353170668f0307a828b0dc6`.
Exact file/native/input identities are retained in
`performance-timestamped-source-identities.log` and
`performance-38f92e7b-input-identities.log`.

| Same-input observation | Fresh process 1 | Fresh process 2 | Existing comparison budget |
| --- | ---: | ---: | ---: |
| Resume to usable captions | 560 ms | 552 ms | 1000 ms |
| Warm Home-to-Watch reopen | 113 ms | 110 ms | 250 ms |
| First Inspector | 76 ms | 77 ms | 250 ms |
| Warm Inspector | 64 ms | 55 ms | 250 ms |
| Japanese recovery after package switch | 493 ms | 472 ms | 1000 ms |
| First six-cue Transcript, pre-input upper bound | 158 ms | 157 ms | 1000 ms |
| Warm Transcript, pre-input upper bound | 130 ms | 118 ms | 250 ms |

These are fresh-process/warm-filesystem observations, not cold-filesystem
measurements or a new product SLA. Transcript upper bounds include the native
input-helper round trip; its actual request-to-frame spans are 119/115 ms first
and 89/88 ms warm. The package switch deliberately exposes the English
package's unsupported-language result for Japanese text before restoring the
original Japanese package; it is not English recognition success.
Logs are `performance-timestamped-normal-1.log` and `-2.log`.
The earlier `performance-38f92e7b-normal-1.log` is a separately identified
pre-marker baseline, not relabeled as the later source.

The native host uses the documented dev profile with debug information and the
existing optimized interpreter/host/SHA overrides; Metro remains development
mode. Initial three-cue analysis makes one Japanese initialization and three
bounded morphology calls. Warm reopen and pointer-only rerenders add neither;
Knowledge remains a 29-key batch. The six-cue Transcript uses one 34-key batch
and cache hits on reopen. Package switching evicts the previous owner and
performs one genuine Japanese reinitialization on return. Both real Home returns
are followed by read-only SQLite confirmation of Japanese package version
`0.1.7-sudachi20260116-jmdict20261017-ocr2`, position 22000 ms,
offset -6350 ms and rate 1. All owned apps and 8081/7780 listeners are released.

Earlier optimized consuming-host preparation remains recorded: admission timed out
after samples at 2.6/3.0 GiB, never reaching three consecutive healthy samples.
Root incorrectly started the production UI export before that admission result;
the export completed successfully, but no optimized native build, host,
catalog server or inference was started in that inadmitted attempt.
The preparation guard was released. A new read-only admission subsequently
passes three consecutive healthy samples before optimized work resumes.
The unchanged ceiling is 3 GiB charged / 25% system availability. Native
footprint later reads 2618 MB charged / 2136 MB reclaimable, availability 60%,
swap 2121.31 MiB and 45 GiB free disk. Allocation categories were inspected;
charged/reclaimable totals do not establish a new leak, and no device/model
workload is blamed for the OmO accounting changes.

The optimized native candidate now uses ordinary embedded-UI app packaging,
the existing release profile, one Cargo job, offline resources and the isolated
M07qa identifier. The earlier `dev --release` HTTP-origin attempt was unsuitable:
release host policy intentionally excludes localhost from media-capability
initialization. That policy was not weakened. A private Metro temporary/cache
directory produced a complete metrics-enabled export without deleting the
shared cache; the earlier cached export omitted several action/frame markers
and is excluded. All six required markers were verified in the new bundle.
The passive observer changes no DOM, application state or native transport.
It forwards only numeric timing lines through bounded loopback image requests
already allowed by the production policy. The collector has a 128-event limit
and one cancellable frame subscriber, registered before each measured action.

The retained local unsigned candidate is
`target/release/bundle/macos/mLearn M07 Performance QA.app`; its executable
SHA256 is `712cd6618e9dcd809514872993cd59102c867f9544a01de80921fd02aa2b3420`.
Production UI SHA256 is
`ef12e474d5b51cebafb7b9667566f86c01d7a355ea1e33efcfa7c0b047cd8b91`;
observer SHA256 is
`c87c3d79dc74e4fe714e1a23cb7bf49317458aa5dc39aa4ca1b8a61689c00bfa`.
The existing app bundle, exports and failed harness evidence remain retained.
This is local verification, not a signed release or distribution.

Two valid fresh optimized processes use the same original `test-video.mov`,
subtitles, Japanese package and saved settings. Both measure the real `今度`
Inspector, six-cue Transcript, explicit unsupported-English state and Japanese
recovery through actual native controls. No English-success claim or direct
speedup ratio is made.

| Optimized observation | Fresh process 1 | Fresh process 2 | Existing comparison budget |
| --- | ---: | ---: | ---: |
| Resume to committed captions | 373 ms | 374 ms | 1000 ms |
| Warm Home-to-Watch reopen | 114 ms | 104 ms | 250 ms |
| First Inspector | 71 ms | 61 ms | 250 ms |
| Warm Inspector | 56 ms | 44 ms | 250 ms |
| Japanese recovery frame readiness | 300 ms | 290 ms | 1000 ms |
| First six-cue Transcript, pre-input upper bound | 112 ms | 113 ms | 1000 ms |
| Warm Transcript, pre-input upper bound | 96 ms | 99 ms | 250 ms |

Transcript request-to-frame spans are 76/74 ms first and 68/70 ms warm.
Package recovery records committed analysis readiness; normal options dismissal
and visible restored annotations were checked separately. Raw observations are
`performance-optimized-sample-1.log`, `performance-optimized-sample-2.log`,
their `-ui.json` files and corresponding frame logs. Both collectors report
zero drops/rejections and no script error or observer overflow. All measurements
are fresh-process/warm-filesystem observations, not cold-filesystem results.

Initial Japanese initialization is 230235/233118 us with three morphology calls and
138805248 guest bytes. Warm uses hit the existing analysis cache; Transcript
uses six cues and a 34-key Knowledge batch, then hits the cache on reopen.
Returning from English performs a genuine Japanese reinitialization.
The 15-minute run deadline expired after these measurements and interrupted
the attempted final Home return; that return is not claimed. Read-only SQLite
instead confirms the original package/version, 22000 ms, -6350 ms and rate 1.
The second process returns Home normally and independently confirms the same
persisted baseline. Repeated normal and optimized performance verification is
complete; this does not close the remaining visual/platform/M07 gates.

The resource guard now compares exact `proc_pid_rusage` physical-footprint
bytes rather than `vmmap`'s rounded display. Its ceiling remains 3221225472
bytes (3 GiB), with the same 25% minimum system availability. All 30 samples
during the first process are below that ceiling: 3068667072–3095815360 bytes.
After the first run root footprint is 3069224128 bytes, system availability
74% and swap 2235.06 MiB. OmO's unexplained allocation is not declared fixed; no model,
emulator or reference app was launched or blamed for it.

#### Native desktop corpus crop cancellation — 2026-10-26

The earlier NSOpenPanel access failure and expired picker request remain recorded;
no successful picker interaction is claimed. The actual approved
`~/mlearn-test-corpus/loadable/0.png` (1442060 bytes, 1023×1024 pixels) was instead
imported by a genuine Finder drag into the existing Home image-import owner.
Japanese was selected through the real control. Root created and closed only
Finder window 1130; all three original user Finder windows remained present.
The real imported page and thumbnail were visually inspected.
Read-only persistence confirms one-page Japanese image document
`document-e6c7ba37347da1e33b47ff53c8e273d327082cc8569734b20df9ea0e5f43d3ad`.
The isolated profile has zero recognition admissions and zero recognition pages.

Selecting crop closes Reader options normally. A real image-space drag opens
recognition with selected-region geometry: left 77.28884301229692%, top
8.608321377331421%, width 15.797504712323848%, height 21.52080344332855%.
The provider remains unselected and Recognize is disabled; no OCR/inference,
model download or injected application/DOM state was used. Cancelling returns
to parent Reader options with Select crop unchecked. Closing and reopening
options does not replay the old request or reopen recognition. This closes
the bounded macOS crop/cancel/reopen gap, not model-quality or screen-reader
verification. Actual VoiceOver/TalkBack and a new native uncertain-correction
receipt scenario remain unclaimed; existing reviewed owner/web/native-seam
evidence is not relabeled as those device workflows.

Unmodified native capture:
`.mlearn/m03-m07/m07-messenger/native-corpus-crop-cancel-options.png`,
2160×1600, 1275386 bytes, SHA256
`c53ab5f19b08a2e5aeab99da4ff17634bf1498229f8ff761fc72ec9fbfd171b5`.
The second process continued into this bounded case after its performance
trace was frozen. The exact guard later stopped at 3250889920 bytes, above the
unchanged 3221225472-byte ceiling. Root immediately stopped the owned app and
collector; no app/media/recognition worker, build or 8081/7780 listener remains.
The owned desktop capture session was explicitly released. Post-cleanup OmO
footprint is 3166856384 bytes, system availability 73%, swap 2211.06 MiB.
No OmO allocation fix, model/device cause or full M07 completion is claimed.
Final platform, visual and full-M07 gates remain open.

#### Reader lifetime review continuation — 2026-10-25

The same reviewer subsequently closes B1/B2 but rejects B3: the triggerless
dialogs rely on web-only close autofocus and lose the native Trigger's
accessibility-focus return. Root reproduces the missing native event in
`dialog-native-focus-red.log`, using the real shared Dialog/React effects with
native host operations recorded at the adapter boundary. The repair makes
triggerless callers provide a current focus target; shared Dialog owns web focus
and the installed native `AccessibilityInfo.sendAccessibilityEvent(..., 'focus')`
on an actual open-to-closed transition. Reader returns no target after route
blur, and keeps the originating Button or options Button fallback. No timeout,
per-feature native handling or second control owner is added. The focused
regression passes both iOS/Android branches, latest-target changes, repeated
closed renders and absent/blurred targets; typecheck, ownership lint and affected
LSP checks pass (`dialog-native-focus-green.log`). This is native-adapter seam
coverage, not a VoiceOver/TalkBack device claim. The current web export and all
37 affected Reader/image/shared-dialog scenarios pass in
`dialog-native-focus-web.log`; root inspected narrow cancelled-crop options and
wide correction-recovery captures and opened them in Preview. The same reviewer
appends B3 approval with no blockers while preserving both earlier negative
verdicts and their fixes. B1/B2 were closed by the preceding delta verdict.
The production-only diff SHA256 is
`86097f1d0f40088a66fd7b9abfefdd4e859f902398eecc7e411df624ab73c453`.

Fresh admission subsequently passes three healthy samples. During/after the
focused checks, root charged footprint is 1307/1338 MB, system availability is
79/77%, and swap remains 2129.31 MiB; RSS is recorded separately. A retained
debug native host (PID 33423) now consumes the current exported UI without
Cargo/Metro. Its open database is verified as the isolated
`net.kikan.mlearn.v3dev.m07qa` profile. The real image picker is open for
`~/mlearn-test-corpus/loadable/0.png`, but foreground sheet targeting is refused
and its native AXOpen action fails. Root asks the maintainer only to make that
file selection, not to debug the application. No successful image admission,
crop or native accessibility outcome is claimed yet. The owned host, ephemeral
8081 frontend and streaming 7780 catalog must be released after this bounded
case; unrelated 4173 remains untouched. Final platform, performance and M07
acceptance gates remain open.

The bounded independent delta review of `0639c5ce..dcfb1d39` rejects two
presentation-lifetime regressions: options dismissal destroys the uncertain
correction command/draft, and a cancelled dragged crop reopens recognition
whenever options remount. Its retained report is
`.omo/evidence/m07-inspector-reader-delta-gate-review.md`. This is not approval
or milestone acceptance; the earlier passing layout checks did not cover
these close/reopen boundaries.

Root reproduces both at desktop/narrow widths and an adjacent uncertain
Word Practice receipt loss: all five strengthened image-reader cases fail
before repair. The existing shared-practice owner test also fails both
before/after-commit modes when its word projection is hidden and restored.
Original command equality, revision, coordinates and no-inference assertions
remain intact. Red evidence is `reader-lifetimes-red*` and
`reader-practice-owner-red.log` in the existing M07 directory.

The current repair keeps correction and Page words owners mounted for the
Reader/source lifetime while their ordinary shared Button triggers remain in
View options. Programmatic shared Dialog callers must supply focus restoration;
there is no global force-mount or second button owner. Drag requests are
consumed after the active recognition form receives its coordinates. Shared
practice keeps its prepared receipt across a hidden empty projection, while
retiring it for a different client/source or changed nonempty selection.
Owner epochs still cancel stale preparation/publication. The final serial
integration passes 67 checker and 135 client tests plus all 83 affected
Reader/image/Watch/shared-dialog/Messenger browser scenarios. A replacement
selection also proves a different nonempty membership starts a fresh intent,
rather than retaining the earlier prepared command indefinitely. Source
typecheck, ownership lint, web export and all six affected-owner LSP checks
pass. The narrow cancelled-crop/reopened-options and correction-evidence
captures were inspected; close actions restore their actual originating
buttons. Evidence is `reader-lifetimes-green*` and
`reader-lifetimes-final*`. A bounded native crop/cancel/reopen check uses the
actual `~/mlearn-test-corpus/loadable/0.png`; independent re-approval and final
consuming verification remain required. That normal-launch attempt stopped
before import after OmO's guard reported a transient 3.2 GiB charged footprint.
The owned app and dev servers were released immediately. Subsequent native
footprint is 2857 MB charged / 1253 MB reclaimable, 67% system availability,
2062.38 MiB swap and 45 GiB free disk; this is not an exhaustion or proved
leak diagnosis. No model/inference or device workload was started. The fresh
read-only admission for the narrower retained-host/exported-UI check remained
held at the unchanged 3 GiB limit: subsequent samples reported 3.0–3.3 GiB
charged, 67–68% system availability and unchanged 2062.38 MiB swap. The repetitive
admission watcher was stopped without launching the retained host or servers.
No threshold was raised. Native crop/cancel/reopen therefore remains unverified;
the corpus image is 1023 by 1024 and no import or crop success is claimed.
The same independent reviewer is auditing the repaired delta and recorded
browser/owner evidence, with this native gap explicit. Published `dcfb1d39`
foundation and desktop CI pass; its mobile run `40228690709` remains in progress
for both platforms under the existing completion subscription.

The remaining Watch comparison now has a genuine compositor capture,
`watch-compositor-inspector-live-cards.png`, at 1512 by 950 logical pixels.
The actual original video pixels, live dictionary cards, synchronization and
pill-footer Inspector were inspected together. Earlier window-only captures'
black video is not a demonstrated playback defect. The first region capture
included Preview after foreground protection restored it; the subsequent
capture verified the exact QA process was frontmost and restored the previous
window afterward. No reference app, staged DOM or fabricated Knowledge state
was used. Current-source samples are 614 ms Home resume to usable captions,
45 ms warm caption commit, and 72/46 ms Inspector action to commit; these do
not close the repeated performance/package-switch budget gate. Source playback
was restored through the real UI with an observed 22000 ms acknowledgement.
The owned app/launcher/guard were then stopped before Reader integration checks.

#### Hosted Messenger dismissal regression — 2026-10-25

Foundation run `40222306761`, web job `121256324092`, failed the original
provider-recovery assertion that the Message dialog closes after Retry response.
The unchanged local case passes, so it did not retire that failure. Holding
the actual post-admission conversation read now reproduces the same visible
dialog after Close: MessageActions rejects every open-state change while
`actions.busy` remains true. Close was visibly enabled but ignored.

MessageActions now permits dismissal while the existing action owner finishes
its native retry/refresh. Its mutation controls remain disabled while busy;
closing neither cancels nor duplicates the admitted generation. The existing
provider-failure test subscribes to a held refresh before triggering Retry,
checks Close before releasing it in finally, then preserves all original
authored-turn, pending-admission, completion and provider-request-count
assertions. No sleep, wider timeout or weakened assertion is introduced.
The red fails with visible-versus-hidden; the repair passes all 32 affected
Messenger recovery and contextual source-action interactions. Typecheck,
ownership lint and web export pass, and the resulting real-browser screenshot
was inspected. Evidence is `hosted-dismissal-held-red*` and
`hosted-dismissal-green*` in the existing M07 directory. Native UI/platform
coverage remains part of the open exact-source milestone verification.

#### Inspector footer and shared-material correction — 2026-10-25

Reader follow-up: the maintainer requires one top-toolbar row, responsive
overflow for secondary controls and a shorter bottom bar. Read-only v2
`ReaderNav.tsx` prioritizes fit/layout before language/import/spread controls;
`ReaderNav.css` establishes its bounded single-row composition. Shared
`StatusBar.css` uses a compact 30 px status rail. Reader now retains Home,
title, previous/next, Contents and View options in one row, switching ordinary
shared Buttons to labelled icon-only controls at compact widths. Fit/layout
selectors appear inline only when the measured toolbar width permits; other
image controls move into the existing View options dialog. No control is
deleted. Pending/error/retry feedback and recognition cancellation remain
outside overflow. The normal web footer is now 33 px rather than 41 px, without
reducing shared native touch targets or safe-area handling.

First integration retained 37 passes and exposed three failures: pixel retry
in two widths and the admitted source-practice screen obscured by Reader's
still-open parent dialog. The latter now closes Reader dialogs on route blur.
Pixel retry now explicitly reloads the failed spread when accepted settings
already exist; it no longer depends on a transient null-settings render during
full initialization. Existing exact URI/recognition counts and frozen practice
identity assertions remain intact. The final serial run passes all 40 affected
Reader/image/Watch interactions, including recognition cancellation from
keyboard/rail/Contents, uncertain correction/recovery, nested Inspector,
white-page contrast, pill footer scrolling and resize containment. All 67
checker and 134 client tests, typecheck, ownership lint and web export pass.
Wide/narrow first renders and the narrow overflow dialog were inspected.
Current-source normal desktop verification now passes on the isolated M07 QA
profile. Real `continuity.txt` retains its original source text/position and
settings. At 1280 and 500 px, Home, previous/next, Contents and View options
share y=58 and 32 px height; the Save position action remains in the compact
bottom rail. Native options open/dismiss normally. Captures
`reader-native-final-wide.png` and `reader-native-final-narrow.png` were
inspected and opened in Preview. This is macOS evidence, not a fresh iOS or
Android run.

The maintainer identifies every Inspector footer action as the existing shared
pill Button, with one horizontal row and scrolling overflow on mobile. The
body's sense-selection controls remain unchanged pending interaction design;
a sense selector plus one Add action is a proposal, not a delivered decision.
Read-only v2 `WordHover.tsx:763` places Knowledge, resource/capture and Explain
in that footer; `WordHover.css:155` explicitly owns horizontal overflow and
non-wrapping pill content. Its dictionary alternatives and metadata stay in
the body. The approved Inspector image remains the visual authority.

`ContextPanel` now owns horizontal footer scrolling. Shared `Row` accepts a
non-wrapping composition without feature-local control styling. Inspector's
existing `SourceActions` media presentation selects `Button variant="pill"`;
Explain uses its existing informational tone and shared icon. Content-context
callers retain their ordinary presentation. Red browser regressions reproduce
the mismatched material/radius at desktop width and the second footer row at
393 px. Both pass after the repair, including keyboard access to the trailing
offscreen action. Typecheck, ownership lint, web export, affected-file LSP
diagnostics and the original white-page contrast/accessibility check pass.
Both rendered captures were inspected and opened in Preview. The final native
Reader Inspector also passes narrow/wide/re-narrow resizing: its close control
is contained after the overlay measurement repair, all four footer actions
share y=839 and 28 px height in the 500 px window, and actual horizontal
scrolling moves Explain from x=586 to x=564, fully inside the panel. Dismissal
restores the original Children token's focus. The real source remains Untracked;
no Knowledge claims, captures or provider requests were made. Retained evidence
is `inspector-final-native-reader-{wide,narrow}.png` and
`inspector-final-native-footer-scrolled.png`; the narrow/scrolled captures were
inspected and the latter opened in Preview. Owned native launchers and ports
are released after verification.
The first native resize exposed a panel retaining its earlier desktop width.
ContextPanel now measures its actual overlay instead of relying only on cached
window dimensions; the desktop-to-narrow browser regression passes. Native
footer bounds before that correction share the same y/28 px height, but their
clipped panel is not a passing narrow-native capture. The paused video also
appeared black in that launch; it does not certify background-material parity.
The QA source still points to `/Users/adrian/mlearn-test-corpus/test-video.mov`.
That launch has ended and the original 22000/223042/-6350/1 playback values
were read back through the source document's actual JSON storage schema.
During the final native run, charged OmO footprint remained 2.7–2.8 GiB,
system availability 63–64%, and swap 2086.38 MiB. RSS was logged separately.

The adjacent material repair separates reference-derived translucent video
glass from the opaque image/document backing; it does not weaken the original
white-page contrast assertion. Its preceding four-case Watch/image run passes,
including focused-card containment synchronized with actual layout events.
The earlier normal native wide/narrow/correction captures were inspected.
Full final-source platform and milestone acceptance remain open.

The button audit finds Inspector's existing actions already consume the shared
Button; their wrong variants and wrapping composition caused the reported
inconsistency. A feature-source literal scan finds no raw button/Pressable,
Touchable, local Btn or button-style escape. The TypeScript-AST ownership guard
also passes. This does not establish a debt-free UI package: `ActivityCard`
and `SourceRow` each own independent Pressable hover/focus/disabled behavior,
and Button contains specialist dictionary/source-preview layout. A separate
repair proposal is to consolidate activation behavior while preserving those
compound controls and their nested/native hit regions, rather than replacing
them with another parallel button implementation. No broad primitive rewrite
is included in this footer repair.

#### Normal-launch document preparation job budget — 2026-10-25

The normal desktop launch exposed `prepare-documents.mjs` overriding
`CARGO_BUILD_JOBS=1` with CLI `-j 2` and environment `2`. It now forwards the
configured value to both, retaining the existing default when unset.
A child-process boundary probe fails before the fix and passes for one job,
the unset default and an explicit override afterward, without launching Cargo.
Node syntax, architecture lint and LSP diagnostics pass. Real offline one-job
preparation then completes in 0.35 seconds and preserves the 1,873,755-byte guest
SHA256 `c432e917c4ea1a42a57ff6c799b6b35448db2e9a114316884263c4312d7387a1`.
The original red/green/integration logs remain in the existing M07 directory.

#### Memory-accounting correction and resumed verification — 2026-10-25

The maintainer reports Activity Monitor staying around 2.5 GB. A direct
`footprint -p 82251` probe reconciles that with the larger RSS: 1867 MB charged,
4924 MB reclaimable, 6808416 KiB RSS and 80% system availability. The earlier
agent-added RSS cutoff was unnecessarily treating reclaimable residency as
charged allocation; those readings do not establish a current leak or require
another harness restart. Earlier actual exhaustion incidents remain valid.

The ignored guard now retains RSS diagnostics and the same three-sample
admission, 3 GiB charged-footprint ceiling and 25% minimum system availability,
but removes the extra RSS-only rejection. Shell syntax and fresh admission
pass. The helper build and checks below complete under the corrected guard.
No simulator, app or persistent server is automatically restarted. Earlier
resource-blocked records, including goal metadata, describe the superseded
interpretation, not a new request for maintainer recovery.

#### Verified live-card focus closure — 2026-10-25

The current-source `runtime_browser_qa` built offline with one Cargo job in
8.94 seconds, executable SHA256
`6515955d8a5772b46be93d6c4f1410fdee276e6a86a0be41f56062ca49ff6ade`.
Its real `save_position` returned `position_saved`, exit 0. The source is now
restored to 22000 ms / duration 223042 ms / offset -6350 ms / rate 1 /
Japanese 0.1.7, with view revision 9 / JLPT / Auto unchanged. Read-only integrity
is `ok`. All 44 non-source tables exactly match the preserved pre-capture digest
`a3e1e896c898ec65466e17457786bda19f8c9798111124da4ab4d55902070eb8`.
The baseline JSON retains the receipt and exact row-hashing method. System
SQLite BLOBs must be reconstructed as Uint8Array before comparison with the
original Bun serialization; the initial plain-CLI mismatch was a reader
representation difference, not a data change.

The three 1200/500/320-pixel focused-layout cases now pass again in 3.7 seconds
against that current-source helper. The narrow screenshots are byte-identical
to the already inspected passing captures; the new desktop capture was
personally inspected. `live-card-focus-current-owner-green.log` and its sibling
results directory preserve this run without overwriting the original red/green
evidence. Together with the previously inspected actual Japanese native desktop
and 500-pixel captures, typecheck, architecture lint and web export, this closes
the bounded focus repair, not the full visual, performance or M07 gates.

Native files `live-card-native-after-desktop.png` and
`live-card-native-after-500-focused.png` show the real Japanese source/package.
At 500 pixels the focused card ends at x=900 inside the x=920 window edge;
the reading and close control are complete. The old-helper schema rejection,
initial representation mismatch, interrupted resource attempts and expired
capture remain in the durable notepad/logs, not overwritten as passes.
Post-check OmO footprint is 2131 MB, reclaimable memory 4513 MB, RSS
6022832 KiB, system availability 75% and swap 2150.38 MiB. The guard was
released after checks; 8081/7780 have no listeners and unrelated 4173 remains
untouched. No app, device, inference or reference workload was launched.

Published lexical source `a055ad4f` passes all five foundation jobs in
`40208892956`, Android `121215675568` in `40208893225`, and desktop
`40208893129` attempt 2 / native `121228398995`. Desktop attempt 1 exceeded
40 minutes during apt installation before product tests; the unchanged-source
retry passed. iOS `121215675777` repeats the deferred
`id: m01-watch, mp4 is not visible` assertion after 1 minute 48 seconds.
Exact receipts and logs remain in the existing M07 evidence directory.
These earlier CI results do not certify the subsequent focus source. Overall
visual, performance, affected-platform and M07 gates remain incomplete.

#### Disk recovery and verified Settings header repair — 2026-10-25

Published source `f5caf675` now passes Linux desktop `40202743902` and all
five foundation jobs in `40202743976`, including Windows and macOS. Mobile
`40202743824` passes Android job `121197163468`; iOS job `121197163601` fails
the original deferred `id: m01-watch, mp4 is not visible` assertion after
1 minute 36 seconds. The exact selected failure log is retained; no additional
FileProvider diagnostic variant was launched.

The continued matched Watch comparison found a separate real content defect:
the live card for negative `ない` displayed “dead.” The existing Japanese ABI
regression reproduces first target `jmdict:1518450` instead of normalized-form
`jmdict:1529520`. The working package repair prefers normalized-spelling matches
while preserving every alternative identity; package revision 0.1.7 makes the
changed executable explicit. All 26 package unit tests, both real Japanese ABI
tests, offline bundle regeneration, Rust diagnostics and architecture lint pass.
After the maintainer restarted OmO, fresh admission allowed genuine native
verification: Settings installed signed package 0.1.7 and Playback options
explicitly activated it for the saved source. The real live card now reads
“nonexistent; not being (there)” rather than “dead.” The installed executable is
`bf6242174d590e12f99f53d98699d3100a5bd57baa937d9cd4347f2f795da66a`;
both dictionary assets and the native host binary remain unchanged.
The desktop tool frame and narrow real-card output were personally inspected.
All 41 tables outside package installation, source state and SQLite sequence
metadata remain equivalent under ordered row hashing. Only plugins, install
receipts, sources and the install receipt sequence change. The source is
restored to 22000 ms / -6350 ms / rate 1, explicitly using package 0.1.7.
Dark Quartz and view revision 9 / JLPT / Auto remain. Captures, exact readings
and red/green logs remain in the existing M07 evidence directory.

The earlier resource pause is preserved, not a product failure or goal
completion. Before the restart, OmO RSS was 8,536,160 KiB despite charged
footprint 2.7 GiB, 85% system availability and 3,408.19 MiB swap. Bounded
`vmmap` inspection places 8.1 GiB resident / 2.7 GiB dirty in OmO's
App-Specific Tag 1 region; it does not establish why that resident allocation
persists. No emulator or model workload explained that allocation. The ignored
local admission guard now requires both RSS and charged footprint below the
existing 3 GiB ceiling, with three healthy samples; shell syntax and diff checks
pass. Subscriptions only observe resources and never restart a workload.
The admitted native run completed and released its app, launcher, guard and
8081/7780 listeners. A subsequent deliberate restart was terminated when the
new harness again reached 3 GiB charged footprint; no fresh-process UI
persistence claim comes from that interrupted attempt. A desktop file captured
after live-card expiry is retained as an expired attempt, not meaning proof.
The direct desktop tool frame and narrow files establish the observed repair,
not a completed final capture matrix.

Separate narrow-focus clipping remains open: focusing a second-column live
card leaves its rightmost 20 pixels outside the 500-pixel window. Repair and
recapture are required before Watch parity can close. Remaining work includes
publication of the verified content increment, that layout repair, durable
matched captures and the still-open Inspector, performance, M07/platform,
review-package and cleanup gates. The harness memory issue is not reported
fixed by a restart or by these product tests.

The maintainer freed disk space by removing simulator runtimes and Rust
incremental cache; OmO deleted neither. Fresh native continuation now passes
SQLite `quick_check`, real restart of the retained profile, JLPT/Always restoration,
Dark Quartz revision 4 and exact source resume at 22000 ms / -6350 ms.
Native Never and Auto were then inspected in real captions and filtered
transcript. View revision 9 / JLPT / Auto is the final persisted state.
All 45 non-view tables remain unchanged across each cosmetic preference write.
The prior disk-full launch below is retained as failed historical evidence.

The responsive pass reproduced Settings' absolutely positioned Home action
overlapping its description. The new layout regression fails on the old source
(264 square pixels of overlap), then passes with an in-flow title/description
column and shared Home control. Typecheck, ownership lint, web export and all
9 affected foundation/dialog browser interactions pass. Actual native desktop
and 500-pixel after-captures were inspected; the narrow Home action remains
usable and its bounds no longer intersect the description. Captures and exact
invocations are indexed in the existing ignored M07 `PLAN.md`.

The subsequent transcript repair is also verified locally. A full 16-cue
Japanese owner regression reproduced exhaustion before the fix. Independent
source spans now retain separate bounded guest calls while one complete,
source-validated result and Knowledge batch are published. Fuel/memory limits,
package authentication, cancellation, output bounds and cache ownership remain.
The Japanese, source/cancellation, conversation, OCR, Watch and document runs
pass (57 test executions); no test assertion was weakened.

The original six-cue native failure now completes uncached and on cached reopen,
with one reusable guest initialization, no failed calls and at most 20,300,038
fuel per call under the existing 64-million ceiling. Its 34 Knowledge keys
remain one batch. Actual desktop and 500-pixel first/last-cue captures were
inspected, with real reading/pitch/stars and Capture controls. All 44 non-source
domain tables remain unchanged across this analysis; the source table changes
during media resume, while the original source document and 22000 ms / -6350 ms
values remain unchanged. Auto / JLPT / view revision 9 is retained.
Native binary SHA256:
`b06dfc366f30e8542ab41853fa7b8ac1c054236a870be2b53ff1d30072a712d5`.
The runtime guest blob is `2fbd51435544a4e4a2ebdaa5d263a4ea194b100a`;
the authenticated Japanese code remains `4355190664c4216a8d2e0ff2228fe66ad2d173b6515803793dca870bdac2e8c5`.

Full M07 visual/performance/platform gates remain incomplete.
Source `97df66b0` passed Linux native CI and foundation web/Rust/detector/macOS;
Windows still failed before publishing its configured application window.
Both mobile builds succeeded, but Android's Maestro connection died during
Playback options and iOS hit the explicitly deferred FileProvider assertion.
Neither failure is reported green or resolved by the header repair.

All targeted native launchers/apps, their 8081/7780 listeners and resource
guards are now stopped with readback receipts. The unrelated 4173 server remains
untouched. Latest disk free is 49 GiB; root charged footprint is 2638 MB and swap
2849.75 MiB. These scoped results do not close full visual/performance/platform
acceptance, remaining cleanup or the consolidated M07 review package.

#### Historical native continuation pause: disk exhaustion

The connected vocabulary and cosmetic-display source is ready for an evidence
checkpoint, not M07 acceptance. The latest generated-contract check, web
export, typecheck, architecture lint, 30 affected client/renderer/source tests
and Rust preference/migration/runtime checks pass. Earlier full runs and
cross-consumer browser evidence remain scoped as described below.

Actual native collapse controls exercised Auto -> Always -> Never -> Auto ->
Always while preserving selected JLPT, all 45 non-view tables and theme
revision 4. View revisions 3–7 change alone; their common domain hash is
`76e1f0a4364a3eff1b153f60aaf1521e192a0d2203700c1af0ef5a4ebcc614c8`.
The real original source shows orange `4` plus one star under 今度 in
`star-collapse-always-word.png`; both Settings selectors were captured and
inspected. Normal Home navigation then saved 22000 ms / -6350 ms offset.

The deliberate restart compiled successfully in 5.87 seconds but WebKit could
not create its ServiceWorkers directory: `NSPOSIXErrorDomain Code=28`,
`No space left on device`. It was stopped immediately; no app, build or owned
8081/7780 listener remains, and the guard was released. The view remains
durably revision 7 / JLPT / Always. Restarted UI, native Never/Auto comparison,
final narrow controls and restoration to Auto remain unverified.

Disk readback is 237 MiB available. `target/debug/incremental` is 14.9 GiB;
no cache, compiled artifact, profile, model or evidence was deleted. Permission
was requested to remove only that regenerable compiler cache. Until space is
resolved, launch no further local build/app/device workload. Preserve
`target/debug/mlearn-desktop`, SHA256
`bfa84038591fe4fe4b14f690c822bda6b520f3680595daaffcc242d4a3b6a0d2`.
Source checkpoint/publication and hosted verification can proceed independently;
the full visual/M07/platform/performance/cleanup goal remains open.

#### Current continuation: published repairs and native comparison, 2026-10-24

Source-entry migration is verified for continuation, not final visual or
maintainer acceptance. Todo 168/212: matched native Home, built-in/custom theme
restart and Settings recovery comparisons are recorded. Watch/Inspector,
performance, affected-platform and delivery gates remain open. No new milestone.

Latest published product source `de9a04e038e5bb00d8707938ea88e5cf37f88b04`
passes foundation `40137435031` in all five jobs, including actual macOS and
Windows desktop/OCR, and Linux native desktop `40137435083`. Its mobile run
`40137435041` confirms Android success; iOS job `121006339504` fails the exact
deferred FileProvider assertion `id: m01-watch, mp4 is not visible`
(one test, one failure, 89.488 seconds). Its JUnit and original screenshots/logs
are retained in `mobile-watch-de9/ios-build-evidence/`. No picker diagnostic
variant was launched. Earlier `7be174c` also passes foundation/Linux/Android, but
iOS `40134355303` fails before any picker: its initial Home language tap never
exposes `language-org.mlearn.english`. The real screenshot, native hierarchy
and Maestro log are retained under `mobile-catalog-7be174c/`; this is distinct
from the expressly deferred FileProvider assertion. No missing-portal-host fix
is justified: the installed primitive and actual UIProvider have the required
root host. Local retained simulators were inspected only; all remain shut down.

The uncommitted connected vocabulary increment reuses CaptureList, the native
dictionary batches and existing finite Review admission. Shared source-practice
preparation/lifetime code has two genuine consumers, Watch and image Reader;
original image provenance and full video cue UTF-8 offsets remain intact.
Native individual capture first exposed a genuine old producer defect: empty
reading/meaning fields caused “no supported Word Practice probe.” Canonical
dictionary-backed capture now admits one selected Japanese Material/two probes;
Return opens the same word in Inspector at 21.1499996185 seconds with -6350 ms
synchronization. The incomplete earlier QA Material is retained and excluded
through its real control, not silently rewritten.

The actual Transcript producer regression is red without dictionary fields
(`''` versus `meaning word0`) and green after restoration. A filtered-word focus
regression is red before source-trigger fallback and green afterward. Their
real-React/typed-client tests also cover lost receipts, cancellation and image
normalization. Checkpoint checks pass 66 checker/124 client tests, typecheck,
architecture lint, web export and 45 cross-consumer browser interactions.
Original and failed evidence remains in the M07 directory. LSP freshness
requests time out; those are not reported as passing diagnostics.

Shared source cards, compact pills and real package metadata were iterated at
1512x948 and 500x850 with raw compositor captures and actual controls. Pixel
measurement then found generic glass too bright: approved card #2F2F2F versus
candidate #3D3E3C. A subtle shared card material and compact Badge/Pronunciation
roles now have a real final 1512x948 native render in
`watch-vocabulary-compact-final.png` (bounded inspection derivative beside it).
Compact readings, package labels and subdued cards were inspected after actual
Vocabulary selection; launcher `bash_327` was stopped afterward.
Subsequent scale-integrated desktop and narrow source/Transcript captures were
also inspected. The last full client run passes 133 tests, typecheck, contracts
and export; the isolated shared-star rendering exception passes 38 architecture
tests and lint, followed by 45 affected browser interactions (22.9 seconds).
The first lint failure remains recorded, not erased. These checks precede the
latest collapse-setting and caption-coexistence changes described below.
Do not close the whole Watch comparison task.

The final native render was stopped when OmO footprint crossed the unchanged
3 GiB ceiling (3.2 GiB sample); another idle admission saw 3.0 GiB. No owned app
or dev listener remains. Bounded readback falls to 2.7 GiB with 63–64% system
free and 1610.19 MiB swap. Eval's reachable JS heap is about 5.3 MiB; explicit
collection barely changes RSS and is not a leak repair. Preserve guard-stop
receipts rather than raise limits. A read-only admission subscription now waits
for three healthy samples under the same ceiling/free-memory floor, without
restarting any workload. Subsequent healthy admission allowed corrected contract
generation and one-job Rust checks: storage preferences 5/5, runtime cosmetic
restart 1/1 and linguistic admission 3/3 pass. Another resource stop occurred
after those checks finished; no build or app remains running. A fresh read-only
admission is active before further substantial checks.
Source edits, new helper files, originals, profiles
and compiled artifacts remain intact; memory admission and final verification
are pending, not a completed or maintainer-accepted M07.

The maintainer's focused inline-star extension is in progress within M07.
Actual v2 FrequencyStars and its geometry tests were read: seven-rank palette,
6/10/14 px sizes, same-line half-gap clearance, number-plus-one-star collapse,
and a shared ref-counted ResizeObserver. A separate Rust-owned view preference
and bounded optional package display scales/values now extend the existing
annotation metadata, without adding goal or scheduler mechanisms. Japanese
declares only its already sourced JLPT vocabulary scale; BJT, university and
custom curricula are not fabricated. All learning authority stays independent.
The selector and shared renderer have actual native proof: authenticated local
Japanese update, saved selection null -> JLPT -> null -> JLPT, revisions 0–3,
and five magenta source stars plus compact number/one-star Transcript display.
All 45 non-view SQLite tables remain byte-value identical across those preference
writes; aggregate row hash is
`5e0739c0d8297d62c07c3a0e9abf54d4650f749bbbd28c15026d6726059d1add`.
Theme remains Dark Quartz revision 4. Raw `inline-scale-*.png` and bounded
inspection derivatives are retained. The normal native dev build passed in
34.61 seconds; its owned launcher was stopped afterward.
The first codegen attempt rejected `ts(optional)` on Vec; optional vectors were
corrected to Option and subsequent codegen passed. No generated file was
edited by hand. The maintainer then explicitly confirmed v2's collapse setting.
Actual defaults are Auto and 8px clearance, with Auto/Always/Never controls.
Schema 11 adds that cosmetic policy while preserving schema-10 scale/receipts;
future-schema rejection targets 12. Historical migration fixtures now remove
newer view tables before downgrading instead of changing production migration
to tolerate impossible historical schemas. After this refinement, affected
storage suites pass 10/13/1/14/6, runtime restart 1, typecheck/lint and 30
client/renderer/source interactions. The final export is in progress; actual
native collapse-mode/restart and affected-platform verification remain pending.

Native Vocabulary exposed a real connected presentation defect: it inherited
Transcript's source-caption suppression. The before image is
`inline-scale-vocabulary-desktop.png`. Watch now owns the mode and suppresses
source/analysis only for reading Transcript or a covering narrow modal.
`inline-scale-vocabulary-caption-repaired.png` shows real captions and stars
beside Vocabulary after the repair. Existing native smoke now asserts this
coexistence; its hosted replay has not yet run. No source text/newlines were
flattened to imitate staged reference text. Frame 25:05 was reached by ordinary
native seeking to 25.22 seconds, not injected UI/media state.

Older mobile `40131298998` has two distinct failures, not a blanket FileProvider
deferral: Android JUnit records `DeviceServerDiedException` during
`viewHierarchy` after playback/persistence captures, without a failing product
assertion. iOS reaches the real playback dialog, then `scrollUntilVisible`
keeps swiping until timeout because `centerElement: true` requires centering
Reset at the end of its scroll extent. The retained trace shows the enabled
target fully visible at y723..767 for four iterations; its actual capture and
native hierarchy agree. The test repair requires full visibility without
impossible centering at all three Reset scrolls. Actual taps, saved-value
assertions, restart checks and other assertions remain intact. Both edited
YAML flows parse without errors using the installed parser; native replay is
pending, not claimed passed. YAML LSP is unavailable; no dependency was added.
Evidence lives under `.mlearn/m03-m07/m07-messenger/mobile-selector-2c60e3e/`.

Normal one-job offline consuming desktop startup at `7be174c` passes, with an
8.82-second dev build. In the retained isolated profile, Japanese source import
and subtitle attachment use the original 223.0417-second test-video.mov/test.srt
through real native pickers, with owned-player mute and source-local -6350 ms
saved through normal controls. Native caption frames take 13/57/30/54/56 ms
request-to-frame in these observed actions; the transcript frame takes 130 ms.
These are fresh-process/warm-filesystem observations, not the final repeated
performance budget. Source hashes remain unchanged.

Actual candidate/reference Watch baseline captures use the same originals,
real 1512x948 logical windows and 3024x1896 backing images; the approved image
has one additional logical row, which remains explicit. Reference source
`1ab95600` is unchanged and uses only its retained disposable profile. Current
candidate transcript and live/synchronization captures show unresolved
composition differences: wide source/Capture text actions crowd the icon rail,
the source title occupies the otherwise sparse header, and transcript/capture
composition still needs comparison with the approved vocabulary sidebar.
Trace and reuse the existing Transcript/SourceCapture/CaptureList owners; do not
invent another Knowledge or Capture owner. Preserve authored subtitle line
breaks required by VID-03 rather than silently flattening source text to match
an edited frame. This is baseline evidence, not visual acceptance.
Both deliberate local app runs were stopped; release verification follows.
Observed root footprint stays 2.6 GiB; native host RSS is 295056 KiB, reference
RSS 395792 KiB before shutdown, system free memory 58–64 percent and swap falls
from 1491.69 to 1467.69 MiB. No device, model inference or download was launched.

The first measured Watch repair replaces the two wide Material/Capture text
actions with existing shared icon-only Buttons, preserving their accessible
labels and behavior; the camera path belongs to shared Icon. Normal native
startup builds in 6.45 seconds and renders the repair at 1512x948 and 500x850.
The wide rail now matches the reference's icon hierarchy; the narrow rail wraps
inside the window without overlap. Actual icon activation opens the real
Capture source editor with the selected Japanese cue/source anchor, and the
Material action opens the source-filtered list. Returning via Home resumes the
same Japanese source at 25.2 seconds despite the Home language being English.
The resumed source retains -6350 ms synchronization; this is not a new source
language authority or a fake capture result.

Native compositor captures `candidate-watch-icon-rail.png`,
`candidate-watch-icon-rail-narrow.png` and `candidate-watch-capture-rail.png`
and bounded inspection derivatives are retained beside the before captures.
Both touched-owner diagnostics are clean. All 66 checker/115 client tests,
typecheck, architecture lint, consuming web export and 18 existing foundation/
dialog/Material browser interactions pass. Native replay on other platforms
and remaining Watch/Inspector comparison gates remain open. The owned app and
Metro were stopped after this targeted run; footprint was 2.7 GiB, host RSS
293600 KiB, system free61% and swap1459.69 MiB. No new local device was launched.

Functionality source is committed as0217bcd98c7cec66e8b00ee5bd8634be6a1d3de0,
`feat: add shared conversation and source workflows`, on agent/m01.
This records the existing connected Rust/protocol/native/UI increment, not
visual or M07 milestone acceptance. PR44 remains the existing draft target,
base agent/h00; publication/readback receipts belong to M07 PLAN and the visual
manifest. Existing independent approvals remain scoped to their repaired deltas;
the shared source-entry/control delta received root self-review and real native
verification, not a newly claimed independent verdict.
Exact-source checks pass core5/runtime50/storage35, checker65/client115 and
all browser101, plus contracts/typecheck/lint/web build; source aggregate
b222f0c17933831f7d2fe3f171cc1835f7b620c9f5d8de9b8bac564c703aceb7.
The remaining35 browser cases pass15.9s after five healthy admission samples,
with unchanged source, served index and bundle hashes; resource watch exits0.
The earlier CI=1 refusal on occupied4173 and RSS guard exit70 are retained,
not erased. No assertion/config/cap was relaxed. Root RSS later falls below
the same3 GiB cap without restart; final sample1899936 KiB, footprint2.8 GiB,
58% free,1016.75 MiB swap. Preexisting static PID2637 remains untouched because
exact ownership is unproven. Its read-only served bytes match current dist.
No native app/device/reference application was launched in this checkpoint.
Effective root route: chatgpt-subscription/gpt-6.1-sol, medium, no escalation.
Preflight: root footprint2.7 GiB (historical peak8.7),69% free,
1048.75 MiB swap,6.1 GiB disk available. One Cargo job, serial checks, no devices/
apps/dev servers. The selected checks and source receipt are in M07 PLAN.

The functionality and documentation increments were published as0217bcd/5e86056,
with PR44 read back OPEN/draft on agent/m01. Exact-source CI exposed two new
integration misses: web39 cases lacked authenticated native fixtures, and the
opt-in Windows OCR verifier omitted the new clipboard state field. Rust,
detector conversion, macOS desktop and real Linux native integration passed.

Verified repairs are published through b10eb253b5ffeb0832fd574afd8bace4b7050f9e;
PR #44 readback is OPEN/draft with that exact head. Foundation run 40127558237
and Linux native desktop run 40127558041 both pass, including the original Windows
Japanese pipeline and clean-CI authenticated browser preparation. Mobile
run 40127558027 remains subscribed. These scoped repairs are not M07 acceptance:
- 9161077 initializes the gated OCR state and compiles all desktop lib features
  in CI. Offline ocr-probe example check passes15.69s, no inference.
- 1476a70 prepares pinned signed plugin/document fixtures and the real Rust QA
  executable before hosted browser tests. Missing trust now rejects before
  acquiring a catalog listener. Its actual startup regression is red1!=0 before
  repair, then66 checker/115 client, typecheck/lint/syntax pass. The new case
  also passes under pinned Node22.23.3.
- 1e65caa adds only the missing UP scroll before the existing Android Watch
  action. Hosted step182 and a retained-binary replay both fail on the clipped
  target; the repaired actual helper then passes62.641s (JUnit1/0), including
  real picker/player/subtitles and Japanese annotations. All original assertions
  and the iOS picker flow are unchanged. APK b4834bf2... and bundled JS70e1207e...
  match the earlier source-entry consuming binary. Source aggregate now
  ba737f61315ce0569e1ee7538aff36e932caf94a5fba141af9935b34779f97ea.

Actual native/composited Home pairs are retained at 1920x960 and 960x960 against
unchanged isolated reference 1ab95600. Read/Watch title actions open source entry;
their nested previews resume the retained document/video instead. Shared
typography, activity anatomy, preview controls and native materials follow the
reference; absent legacy activities/metrics are not fabricated. English native
Watch resume-to-caption is 80 ms with 41 ms request-to-frame, followed by an
unchanged-analysis cache hit. This is not final Japanese/package-switch proof.

Actual Settings at 1000x760 and its shared theme selector are captured. Approved
edited Settings images override the live reference's translucent content;
candidate opaque content is retained. Choosing Quartz through real UI commits
native preferences revision 2. Normal native restart then displays saved Quartz.
Invalid JSON remains editable in the same native dialog, reports its error beside
Save and leaves revision 2 unchanged. Correcting it saves the actual custom
document at revision 3, including background #223344, radius 10 and text scale 1.1.
Another normal native restart preserves those exact fields. Explicit preset
selection restores original Dark Quartz at revision 4; no database write/profile
reset, rejected Slate restoration or live/default profile modification.

This real flow exposed a selector defect: custom themes displayed Select or a
misleading built-in label when retaining a built-in ID. Settings now represents
the complete current custom document with a view-only option in the existing
shared Select; explicit preset choice still uses the native save owner.
Actual-Rust regressions fail before the repair, including same-ID/same-name
custom colors. All 10 relevant browser checks pass in 5.3 s, covering real
restart/reset, 390px/1080px dialog containment, keyboard/focus and accessibility;
typecheck, ownership lint and web export pass. Native repaired/restarted custom
selector and restored Dark Quartz captures are directly inspected. Earlier
test-file LSP requests timed out; current test/Settings diagnostics are clean. This scoped delta has root
self-review, not a new milestone/maintainer approval. Final broad gates remain.

Earlier RSS-only guards and refused prelaunches remain evidence. Investigation
shows about 5.7 GiB resident but only 2.4 GiB physical footprint, with 74-75%
system free: clean resident mappings made that guard too coarse. The diagnostic
now retains a strict 3 GiB physical-footprint ceiling and 25% free-memory floor,
fails closed on missing measurements and still records RSS/swap. It never
relaunches workloads. This is a measurement correction, not a leak repair.
After the serial native round trip, the owned app/Metro/catalog and observer
are released; ports are absent, footprint 2.5 GiB, RSS 3259200 KiB, 63% free,
swap 1515.69 MiB. The unowned static server remains untouched.

Native signed catalog check and Japanese module/data installation also succeed:
0.1.6-sudachi20260116-jmdict20261017-ocr2, 257075561 bytes received/declared.
It completes before capture; no pending/cancellation frame is fabricated and
no optional OCR model download/inference runs.

Real package recovery now has actual-Rust/SQLite/HTTP proof: catalog rejection
and retry, an authenticated artifact body held pending, cancellation closing
that socket, explicit retry/activation and installed data after core restart.
Only external HTTP availability is controlled; native status is never mocked.
Error/pending/cancelled/installed frames are directly inspected. This adapter
explicitly does not supply native window/media/clipboard/OCR services; native
material and modal evidence remains the separate consuming-app verification.

The test exposed two real execution-boundary issues. Its QA-only stdin host
serialized install ahead of status/cancel; it now has three scoped workers,
a bounded 32-message queue and whole-line output serialization, preserving
RuntimeExecutor admission/guest limits. Then cancellation reached terminal UI
state but left its HTTP socket open: the private current-thread catalog reactor
parked before connection cleanup ran. One always-driven Tokio I/O worker and
one blocking worker fix the identical failing close assertion, without changing
timeouts, signatures, sizes, hashes or pooling. Only Tokio's existing
rt-multi-thread feature is added. Owner build peaks are 374/476 MB, one Cargo job.
All 50 runtime owner tests, 66 checker/115 client tests, typecheck/lint and 11
related browser cases pass; the settled install/restart case also passes after
removing an unrelated in-flight catalog refresh. Rust example formatting and
current diagnostics pass. Root self-review finds no additional scoped blocker.
Affected native builds/replay remain required for this dependency-feature delta.

Source 2c60e3e CI passes web/Rust/detector/macOS and real Linux integration.
Windows fails only its stale saved-Slate selector expectation; the existing
native probe now expects Slate (custom), retaining every DWM/input/persistence/
restart assertion. No local Windows pass is claimed. Previous repair-run
40127558027 Android passes; iOS repeats exactly the deferred FileProvider
assertion. No diagnostic variant is launched. Final Watch/Inspector, normal
package-switch measurements and consolidated acceptance remain open.

Hosted iOS repeats the exact already-deferred m01-watch,mp4 FileProvider failure;
it is unresolved, not passed, and no diagnostic variant was launched. Android
replay used only the retained AVD/profile, no rebuild/data clear. Actual captures
were inspected. Emulator/app/owned ADB are released; guard exits0 with sampled
free50-58%, root RSS1167072-2303312 KiB, swap968.75 MiB unchanged. Profiles,
authored fixtures and compiled artifacts remain. These are scoped functional
proofs, not final visual, performance or M07 acceptance.

Native capture is available: system_profiler and the actual display registry
show existing display3 Virtual16:9,1920x1080 logical/3840x2160 pixels; a direct
native display->screenshot succeeds. The capability summary's zero-display/
capturefalse fields are inconsistent, not a valid veto. No OS/display change
or new permission was needed. Do not repeat the timed-out display question.
Full goal remains active/incomplete. Resume matched real native comparison.
Independent next-launch preflight is retained: reference revision1ab95600,
clean tracked tree, MLEARN_USER_DATA first-import override confirmed, cleanup
script removes only dist-electron/electron and shared. Isolated reference
profile remains dark-quartz with the selected reference presentation; OCR/voice/
LLM disabled. No interface-style selector will be ported. Candidate uses the
existing m07qa identifier/profile with Rust app_data_dir authority. No device,
candidate or reference app is running. Preexisting static PID2637 remains
untouched because exact ownership is unproven.

Earlier source-entry native evidence: the headroom subscription passed five samples at
2867 MiB physical/68% free. A serial Android consuming UI rebuild then passes50s,
with one worker,2 GiB Gradle heap and1 GiB Node heap. No Rust rebuild/device ran
alongside it. APK SHA256
b4834bf2c5458481c79a8063d9c3c0e9b75a5fc807e02b7306ac979c44092ed8;
JS70e1207e3ed33b582bf2a224cad03fc97b7bd2ba3df979de204adb0ac8b2d160.
Both ABIs and the bundle are present; no Gradle daemon survives. Build memory
guard stayed63–68% free and was released.

Only then was retained emulator5556 deliberately booted at2 GiB guest/2 cores,
without snapshots/window/audio. It was bash_23/PID8162, guarded by bash_22;
both are now released. Install -r succeeds without data clearing. Missing owned
15713-byte m05-journey.pdf was copied from the CC0 fixture; host/device hash
4dfbed3f5ca686720d2e0176565d8b73fb1fa821844d975a116a537fb65d13b9 matches.
Airplane0/WiFi1 unchanged. Original native PDF import/page identity/restart flow
is now bash_29/mon_31HTPCA623797A9W, native-android-source-entry-reader.
That Reader flow passes48.777s, JUnit1/0, exit0. All four native1080x2400 frames
were inspected individually: original Page1 text, honest graphics-only Page2,
Page3 text and exact Page3 restoration after process restart. No blank native
Reader or lost PDF position. Serial Home flow is now bash_31 /
mon_DK9CTFCSB1FMVXCS, native-android-source-entry-home; it passes57.208s,
JUnit1/0, exit0. All seven1080x2400 frames were inspected individually:
Reader/Watch entry headers and controls visible; independent Chats/Review,
restarted Home and SourceRow→actual Page3 PDF display remain usable.
During Reader flow system free61%, swap1080.75 MiB,
QEMU RSS4489136 KiB, OmO RSS1260832 KiB, Maestro Java RSS276576 KiB.
The guest2 GiB setting does not imply a2 GiB emulator process.
Owned app force-stop and emulator exit0; ADB is empty, owned idle server released,
QEMU absent, no booted iOS simulator. Original airplane0/WiFi1 unchanged.
Post-release physical2.9 GB/peak8.7 GB,63% free,1072.75 MiB swap. Receipts:
android-source-entry-shutdown.log and android-source-entry-release.log.
iOS headroom then passes five samples at1433 MiB physical/72% free; before boot
system free73%, swap1064.75 MiB and no other native workload. The exact retained
JS hash was rechecked unchanged. H00 settled no-picker entry flow is now
bash_40/mon_72ZEF1MVGSSE4PQ9, native-ios-source-entry-settled, under memory guard
bash_39/mon_GYYWSBSQ4XZWMPD0. It passes63.474s, JUnit1/0, exit0, with no rebuild
or data clearing. All seven frames inspected individually: Watch header now
visible, but this run's Reader-entry frame omits its header/status bar despite
the earlier same-binary Reader frame showing it. Do not assume product or
capture cause. Other navigation/restart/recents remain usable; image is still
opening, not new OCR/loaded-image acceptance. App termination/H00 shutdown pass0,
no booted devices, guard released,59% free/1056.75 MiB swap.
The separate no-picker Reader-only control passes13.107s, JUnit1/0, exit0.
Direct simctl capture after Maestro exits shows the real full header/status bar,
Home button and document/image actions on the unchanged binary:
ios-reader-entry-simctl.png,1206x2622, SHA256
4d345565ae7ab66d8d31ba28219a3652f5858c1afe93d498159f8ab76d22f458.
Earlier inconsistent in-flow frames remain retained; no stable missing-header
product defect was established and no style change was made. App termination/
H00 shutdown pass0, no booted devices, guard released,60% free/1056.75 MiB swap.
Both the capture blocker and source-entry task are closed at this scoped
evidence level. No native/reference/development-server workload is live.
The following recovery paragraphs preserve earlier source-bound observations.

Recovery update: the maintainer reports OmO12.5 GB, 0 bytes available and6.5 GB
swap before a complete workstation restart. All old process/monitor handles
are historical; no app/device/reference/server was automatically restored.
Post-restart owned browser run bash_5 was explicitly stopped after this report;
its new unavailable-package test remains unverified. No native workload is live.
`post-restart-memory-receipt.log` records main OmO1758 RSS2489792 KiB,
physical footprint3.6 GB/peak5.9 GB, RPC host2005 footprint317.1 MB,
57% free memory and0 swap. These are current observations, not a diagnosis of
the lost12.5 GB allocation. Avoid large output/image batches and further
substantial work until memory behavior is understood.

The bounded idle observation completed with no product workload: main RSS
2810448→3306240 KiB over six samples, physical footprint3.2 GB/peak8.7 GB,
62% free memory and1128.75 MiB swap. This does not establish allocation cause.
Historical gateway M06 messages were replayed during recovery; none authorized
new work or restarted its obsolete Python/model/Practice tracks.
The stopped browser run had already exposed a test-locator error: the shared
Select is named `Source language: Select`, not exactly `Source language`.
Its rendered invalid-package alert and disabled import are correct. Corrected
the locator to its established accessible-name prefix. The focused recheck
actually completed before the stop request:1 pass in2.0s, exit0, recorded in
`source-entry-language-focused.log`. Both Reader and Watch require an explicit
replacement and pass the unmodified Axe scan. The full interrupted run is not
reported green.
The requested visual commit4a86df32 is already an ancestor of current9640c9e4
(`REQUESTED_COMMIT_ANCESTOR_EXIT=0`); do not merge it again or disturb dirty M07.
The conservative RSS guard subsequently tripped6057200 KiB and a stop was sent;
the post-stop receipt shows current physical footprint2.7 GB, peak8.7 GB,
67% free memory,1128.75 MiB swap and no surviving product workload. RSS and
physical footprint differ substantially; neither this recovery nor the passing
focused test diagnoses or fixes the harness. Native devices remain off.
The bounded recovery static run passes diff check, typecheck and architecture
lint (`source-entry-recovery-static.log`, exit0). The specified temporary
notepad was missing after restart; recreated that exact path from retained
STATE/PLAN/manifest evidence rather than inventing its lost historical text.
A bounded headroom subscription is now active as `mon_0MJNZJVAWZ2YZVE1`,
`bash_15`, log `post-restart-headroom.log`: five consecutive samples at no more
than3 GiB main physical footprint and at least60% system free memory admit only
one retained UI build, not concurrent devices or a leak-fix claim. It launches
no application/build itself. If ready, the next native step is the retained
Android UI refresh with one worker and a2 GiB Gradle heap, then release/readback
before considering a device. If unstable, preserve `paused_incomplete` rather
than restarting workloads. No model, inference, Cargo or simulator is needed
to take these headroom samples.

The pre-restart iOS flow completed successfully: JUnit1/0,82.875s and all seven
captures survived in `native-ios-source-entry/2026-10-24_174126/`.
All were inspected. Reader entry and restarted Home render; Watch's capture
contains its card but no visible header/status bar, and the final Reader is
still opening. Do not count those two frames as complete settled visual proof.
The flow now requests bounded animation settlement before captures and asserts
Watch Home visibility. Its YAML parses; this capture-only revision is unrun.
No repeated iOS build or FileProvider diagnostic is needed for that revision.

Dirty M07 remains on `agent/m01`, pushed M06 baseline `9640c9e4`, draft PR44.
Current task: move existing import controls from the oversized Home footers to
the reference-derived empty Reader/Watch screens, without adding a backend.
`features/source-entry` now exports SourceEntryScreen and useSourceImport.
Home drops and both entry kinds share the same picker/staging/release/session/
cancellation owner; Home no longer contains a parallel import pipeline.
Empty routes preserve contextual Material/Review restoration; explicit invalid
package context cannot silently select another language. Shared sourcePreview,
spacious Panel and entryTitle roles supply the measured presentation.
Initial lint caught private cross-feature imports; public exports repaired it.
Typecheck, architecture lint, export and all33 affected browser workflows now
pass in `source-entry-solid-workflows.log`. The initial run had five timeouts:
the stretched Read target's center is deliberately covered by its independent
Continue preview. Trace evidence shows that interception; the test now clicks
the visible header without forcing input or weakening admission assertions.
The next run passes25/26 and exposes a real light-theme contrast defect:
translucent white Panel over the black source canvas gives muted copy3.66:1.
Shared Panel now owns a solid material option for these two entry kinds; the
native theme surface also backs their header. The existing full Axe assertion
passes after the repair, together with image retry and late-picker cancellation.

Normal isolated desktop `bash_1048`, PID56272, window641 is deliberately live
for this delta (`normal-desktop-source-entry.log`). Reader and Watch entry
rendered at420/1200x700 with all controls contained. Native video picker Cancel
restores enabled entry; reopening and selecting the retained m07-qa-watch.mov
opens actual0:30 playback and Children walked home. annotations. AXOpen returned
an accessibility error while closing the picker, so the actual resulting source
route, not that return code, supplies the product evidence. No duplicate open
was dispatched. The local iOS consuming UI rebuild is `bash_1061`,
`mon_PM6Z6PCAR07TF9DQ`, `ios-source-entry-build.log`. Entry-specific native
captures remain pending. YAML parser validates all four affected mobile flows;
yaml-language-server is unavailable, not a passing LSP check.

Before this new entry delta, coherent Home owners passed 65 checker, 115 client
and 7 browser cases. Native owner flows pass on iOS (51.102s, JS
`d3fb4f342a186844a76f15d189535833063df6a7a21c1057250748ad19afadae`)
and Android (45.746s, APK
`8e1f4cd602c877c47079ad27e09648cbe7dd17621afd5008a340d98878a60b0f`).
All five frames per platform were inspected; both select actual
dense-cancellation.png through SourceRow. Android shows its real pixels; iOS
capture is still opening, so neither flow is new OCR-quality acceptance.
Both devices are shut down; ADB absence is confirmed. Android airplane0/WiFi1
was not changed. Two byte-identical Gradle packaging copies were removed only
after cmp/SHA proof, preserving canonical ABIs, APK, symbols and evidence.
`home-owners-packaging-cache-release.log` records identities; disk is now3.3 GiB.
Earlier native bundles do not certify the new entry-screen delta.

Next: finish the retained iOS UI build, deliberately run the bounded Home flow
including Reader/Watch entry and release H00; then refresh and verify Android.
No automatic device/reference/server restart, no FileProvider diagnostics,
M08, merge, release or acceptance. Full visual/theme/performance/delivery
gates remain open; durable inputs are M07 PLAN and the visual mismatch manifest.

#### Earlier Home-owner checkpoint (historical)

Current presentation delta: Home now places Read, Watch and Messenger in the
first activity row, with Review below, using shared growing Panels. Existing
imports, continuation actions and native-unavailable behavior remain connected.
Typecheck, ownership lint and web export pass in `home-composition-checks.log`.
Normal desktop renders at1200x700 and420x700 have been inspected; scrolling to
Conversation and Review opens the genuine native surfaces and Home returns.
All7 affected foundation/real-core browser workflows pass in
`home-composition-workflows.log`, including row/stack geometry and narrow entry.
Both revised mobile YAML flows parse with the existing yaml dependency.
Native iOS Home verification passes37.664s (1 test/0 failures):
Conversation/Review entry, Home return and process restart on retained H00.
All3 genuine frames were inspected. H00 is now shut down without profile
clearing; `native-ios-home-release.log` confirms no booted device.
The earlier generation-owner mobile hashes and workflows below predate this
Home delta and do not certify it.

Desktop verification `bash_958`, PID41023, window569 has been deliberately
released; readback confirms no process or8081/7780 listener. Its log is
`normal-desktop-home-composition.log`. The retained iOS consuming Release
rebuild is now `bash_965` (`mon_3KB8GMYA7T7EFQNX`), with log
`ios-home-composition-build.log` and passed. Its JS SHA-256 is
`1835fcba28cf66e9ea4dc568ee1e614a90438bc01a33abe48f074f02f0f57cfa`.
The retained Android consuming UI rebuild passes38s, log
`android-home-composition-build.log`, APK SHA-256
`42f3e43890a3c9dce442e5bdc1e151fc034ca064830635185630c791d3ba6ef1`.
`native-android-home-ready` passes35.922s (1/0), with genuine hydrated Home,
Review and Chats frames inspected. The earlier passing28.908s run captured
pre-snapshot light state and is not appearance proof. The harness now waits for
the existing enabled language selector, not a delay. Both devices are released,
ADB/simctl empty; original Android airplane0/WiFi1 remains unchanged.
The isolated reference launcher and its verified detached Electron PID37592
have both been released; its release monitor reported
`OWNED_REFERENCE_DETACHED_RELEASED`. Do not automatically restart either app.
Window-only captures flatten native vibrancy; material comparisons require an
unobscured composited capture. AX focus flags alone established no host defect.

Current deliberate comparison launches: v3 `bash_996`
(`mon_YP1RDGYR8FQD3SC4`), PID45964/window580, and isolated reference `bash_999`
(`mon_DBCJSA7H3XC2JBB7`), PID46259/window591. Both are1200x700 at360,126.
Reference revision1ab95600, clean, retained isolated selected presentation,
Dark Quartz; OCR/voice/LLM disabled. Foreground compositor captures are
`candidate-home-composited-1200.png` and
`reference-home-composited-matched-1200.png`. The raise helper left Electron
foreground; under explicit control grant, native PID-specific visibility/
activation confirmed the candidate foreground before capture and restored both
apps afterward. No product focus fix was inferred.

The shared conversation glyph was corrected to the actual rounded robot path.
Reference focus visibly outlines the whole Messenger card; the new regression
fails without its main action (`home-compound-red.log`). Shared ActivityCard
now owns all4 main actions/header/focus/hover materials; native uses a separate
44px header target. First nested-Button stacking was wrong: actual Reader
Continue pointer input opened import instead. Cancelled that picker, removed
the added Button context/styles, and lifted the independent content region at
ActivityCard because RN Web View defaults to zIndex0. The same pointer now
opens the genuine continuity.txt Reader; main Messenger separately opens Chats.
Wide/focused/narrow renders were inspected; narrow layout capture is
`home-compound-narrow-layout.png`. The unused Panel fill addition was removed.

Typecheck/lint/export pass for the repaired owner. Failed interaction runs
remain retained. A later test reached duplicate hidden Home routes after
Reader return because Expo retains stack screens; geometry now starts from an
ordinary page.goto Home with the same persistent Rust backend, not a reset or
an arbitrary first match. `home-compound-route-green.log` passes all7 cases
in7.7s. Shared SourceRow subsequently replaces passive recent Panels plus
separate Resume controls for both real document/media consumers. Its wide
rows were compared with the actual reference two-column grid; metadata and
actual/unknown progress remain real, with no invented dates or percentages.
After that delta, `home-integrated-green.log` passes65 checker +115 client +7
browser cases with typecheck/lint/export. LSP currently times out; do not claim
fresh diagnostics. Existing mobile consuming proofs predate ActivityCard/
SourceRow and do not certify their new native boundaries.

Both comparison launchers reached their bounds; PID45964/PID46259 and all
8081/7780/3000/7752/7753 listeners are absent. Do not automatically restart them.
An attempted late Reader window capture therefore failed; do not cite
reference-reader-entry-layout.png as an existing capture. The running Reader
entry was inspected in session frame50 and its ReaderWelcomeCard/CSS read:
import actions belong on the empty Reader screen, not Home card footers.
The new todo tracks relocating existing import presentation with one shared
lifetime owner, preserving Home drop, staging release, cancellation, source
identity and all required formats. No entry-screen implementation yet.

Temporary Home resize logs showed inactive viewport420/measured1152, then real
foreground resize1200/columns3 and1198/measured1150/card370. No host/viewport fix
was made from this inactive-capture artifact. Temporary instrumentation is
removed and its sole tail monitor killed. The next consuming iOS build covers
the coherent ActivityCard/SourceRow batch before further presentation changes,
reusing unchanged Rust bridges and retained profiles.
That build is now `bash_1028` (`mon_7WJ432Z8C930Y9ZN`), log
`ios-home-owners-build.log`; no simulator is booted during it.
Current Home compound/material, theme restoration, Settings/Watch/Inspector
matched states and final performance/regression gates remain explicit todo
tasks. No material/visual acceptance is claimed from the successful mobile flow.

Dirty M07 remains on pushed M06 baseline `9640c9e4`, branch `agent/m01`, draft
PR44. The single reviewer approved the original uncertain-admission/Person
projection repairs and the later edited-question/pending-intent repair.
Both Stop/Close races fail before the epoch guard; all 24 affected cases pass
after it with LSP, typecheck, ownership lint and export. Full integration passes
65 checker +115 client +100 browser cases (`final-intent-integration.log`).
Only the subsequent stable search test ID/harness corrections follow that full
run; their LSP/typecheck/lint and both consuming native workflows pass.
No Rust/protocol/FFI owner changed in this final presentation repair.

Final iOS consuming JS SHA-256:
`28172f99af2ef221bc86533e294d040af660e750be2bc088c3ba5aba52051f09`.
`native-ios-observed-intent` passes in 224.734 seconds: persistence/restart,
keyboard/input, three actual native requests, held-stream Stop and the edited
Why plural? request under the same message/package/revision anchor. Immediate
independent simulator clipboard readback differs before Copy and matches the
40-byte fixture response exactly afterward. Only private-baseline hashes/lengths
are recorded. Actual request JSON is in `native-ios-observed-intent-receipt.json`.

Final Android APK SHA-256:
`a63a6545dedc38bfb52c70fdc68b5254454c763cc1ce3fd2d3f99b02f0432210`;
bundled JS:
`c075cc3a8ae0ac6a90debb1cc0a35c05642ccbe1ca8e6e59a3cd4ec97ba4cbbb`.
Both arm64-v8a/x86_64 bridges are present; consuming build passes in 28 seconds.
`native-android-filtered-intent` passes in 242.124 seconds with actual system
Paste, restart, three native requests, held-stream cancellation and the edited
question/source anchor in received JSON. Receipt:
`native-android-filtered-intent-receipt.json`. Both platforms' saved request
bodies were compared exactly with the actual fixture receipts. Native keyboard,
streaming, edited-dialog, Paste and fresh composited captures were inspected.

Failed native inputs remain preserved: an iOS below-selector hit an older row;
retained Knowledge was mixed rather than untracked; Android's new Person was
below the pre-search viewport. The corrected harness filters real People,
preserves Knowledge/profile data and observes Copy immediately. No assertion
about required product behavior was removed. The emulator renderer error remains
in its log; subsequent real frames and the complete workflow passed.

H00 and emulator5556 are shut down; both device lists are empty. Original
Android airplane0/WiFi1 remain unchanged. Fixture41235 is stopped, no listener
or held stream remains. Host clipboard restoration never overwrote a non-QA
value. `native-final-resource-release.log` records 75% memory free, swap used
4,526.62 MiB and 4.9 GiB disk free. Keep substantial work serial and never
automatically restart devices, reference apps or persistent servers.

Final normal desktop is deliberately running as bash_931 /
mon_MD5R9P0CSQ3GTV2R, PID35919/window532, using the existing isolated
`net.kikan.mlearn.v3dev.m07qa` profile and the documented npm command.
`normal-desktop-final-intent.log` records the normal dev build (54.90 seconds,
existing optimized package overrides with debug/safety checks retained) and
actual UI/plugin metrics. Binary SHA-256:
`b997f8b7a01e54dcebee9d1a30d870486fc59bd451e136023166d50dae5cf6af`.
Default 1080x800 Home and Settings read back saved Dark Quartz and authenticated
English0.1.3-wn30-ocr2. Current English measurements: first usable captions87ms,
warm reopen60ms, Inspector49ms, transcript59ms; request-to-frame39/29ms.
Matching/empty/recovered transcript searches and cue2/cue1 navigation pass;
paused0/rate1 are restored. One nonempty morphology call is followed by cached
two-cue reads with current Knowledge refresh. Cheap stateless English Fresh
slot initialization/eviction is visible; Japanese heavy-resource behavior is
not certified by these English timings. Metrics watch: bash_934 /
mon_5SCFN09D1FN8DDG5. Actual frames are `desktop-final-*.png`.

The current clean `../mlearn-ts` reference revision is
`1ab95600bee97017635afe538af4e890e0cded3a`, not the older historical1788f9c
captures. Its inspected user-data override targets only the retained isolated
reference profile, with the selected presentation/Dark Quartz, no cloud tokens
and disabled OCR/voice/LLM. A deliberate npm dev launch is starting as
bash_941 / mon_EMZJDC8T1K09VS6G (`reference-final-comparison.log`); Vite3000 is
ready, actual reference Home is not yet certified. Ports3000/7752/7753 were
unoccupied before launch; never let legacy port cleanup kill another owner.
Edited screenshots remain primary; match actual state/viewport/theme/focus.

Storage recovery preserved all fixture bytes before exact-root cleanup.
The 297-profile gzip archive SHA-256 is
`a82877515ba0b3f46bdbd66b585d4b7daa81e1111923fdf578015221cf1c66b5`.
The final 66-root xz archive (65 UUID profiles plus retained browser-preflight)
SHA-256 is `4aa9845f860aede11958a6a819546f054eb5c69d9078b0c5bd4a9854bb169bc4`.
Both integrity/full membership checks passed; only exact archived UUID roots
were removed. Named preflight, evidence, native builds and learner profiles
remain. M07 PLAN contains exact invocations, failures and restoration recipes.

Next: finish matched visual/narrow/custom-theme/restart and remaining
Japanese/package-switch/performance comparisons, repair demonstrated defects,
then commit/push the verified M07 checkpoint and deliver the consolidated
package with owned-resource cleanup. M07 is not yet verified for continuation,
committed, pushed or maintainer-accepted. Historical source-bound progress below
does not override this compact checkpoint or reopen the deferred FileProvider gate.

M07 starts from pushed M06 checkpoint `9640c9e4`. Its complete requirement and
reference trace is recorded in `.mlearn/m03-m07/m07-messenger/PLAN.md`, including
the two approved Messenger screenshots and real smaller reference actions.
Legacy inactive reply/edit/delete/regeneration controls are not counted as
delivered. Root owns runtime/provider/source integration; the client surface is
being implemented separately against the generated Rust boundary.

The content unit now has schema9 incremental SQLite People, direct/temporary
conversations, bounded history/search/drafts, idempotent authored mutations,
generation publication, dependency invalidation and frozen message versions.
Its 16 real-storage owner tests pass. Explanation content admission is one
transaction with one reused software Assistant identity, not a person per turn.
Session credentials are not stored. This is owner proof, not a complete M07 UI.

Root added the actual native HTTP/SSE transport with bounded text/frame/body
sizes, credential-free diagnostics, no redirects, cancellation and honest
incomplete/refused/tool/limit failures. All five transport tests pass, including
real local HTTP streaming and post-delta cancellation. No real paid/remote model
was called. The integrated native generation worker, original request traces
and source-grounded execution are implemented but still need connected runtime
tests and actual UI/platform verification.

Message sources extend SourceAnchor, native Capture/Return and scoped practice
rather than creating another owner. Four Material storage boundary tests and
all 15 Material client tests pass, including message revision/UTF-8/cross-source
rejection. Message analysis extends the existing native package/cache/Knowledge
pipeline without fabricated video cues; the shared AnnotatedText accepts native
message token batches while retaining existing cue-scoped media annotations.
The fresh Rust source/analysis/worker diagnostics are clean. Fresh test-file
TypeScript LSP reports orphan Node-test configuration errors; no clean result is
claimed for that file, and no extra dependency was installed.

The first transport test attempt stopped at missing exhaustive runtime arms
while the content contract was being integrated; no transport behavior ran in
that attempt. The real dispatch/analysis integration then compiled and the five
transport tests passed in 0.02 seconds. Logs are `provider-tests.log`,
`material-storage-tests.log` and `material-client-tests.log` in the M07 directory.
Generated contracts and their conformance check now pass. All eight connected
runtime tests pass, including actual external-source edit -> failed explanation
publication -> released pending HTTP read. That defect was reproduced first
(`explanation-origin-red.log`) and repaired at the shared worker's source
validation/cancellation boundary, not in individual screens. Publication is
bounded/coalesced, request/response traces exclude keys, terminal source checks
and publication share the native lock, and timing uses one monotonic job clock.

Immutable captured message analysis is an explicit native action, not a
relaxation of current-message freshness. The real original is restored and
analyzed after an authored edit; current stale inspection and forged original
hashes still fail. Material and Review Return admit the same source response.
The shared source protocol was extracted when conversation became its second
consumer, avoiding a Material/conversation validator cycle. All 32 focused
conversation/Material/message client tests pass. The integrated client
typecheck, ownership lint and web export also pass.

Normal Home now reaches Conversation without provider readiness. The compact
composer size belongs to shared TextField (44-pixel minimum, 120-pixel cap from
the reference mechanism), not a route CSS escape. Copy is a real host operation:
desktop retains its arboard text clipboard owner, iOS uses the main-thread
pasteboard, Android its native clipboard service. Desktop Cargo check passes;
the new mobile bridge methods still require consuming native builds/flows.
Swift LSP lacks the Expo module context and Kotlin LSP is unavailable; neither
is represented as a successful mobile build.

The exported-UI workflow now passes through a bounded JSON-lines QA host
using the actual RuntimeExecutor, SQLite, authenticated desktop downloads and
language execution. Only the external text provider is deterministic. The
normal UI creates contacts/chats/configuration/messages and opens real prepared
language/Inspector; no fake native domain responses or staged DOM. Test entry
points, exact invocation and 1212x872/390x844 captures are recorded before the
run in the M07 PLAN. This is not Tauri window/media/clipboard or native mobile
acceptance. Catalog preflight passed with the actual `available_packages`
action; an earlier unsupported diagnostic action is retained separately.

The normal actual-core Messenger workflow passes at desktop and phone widths,
including eager native analysis, real Inspector lookup and composer growth and
collapse. Captures in `qa-native-core-autosize` were inspected. They establish
functionality and compact composer behavior, not final reference conformity:
the rail composition and extra secondary tool rows still need repair.
The complete storage regression suite passes (`storage-regressions.log`);
existing unused `practice` fixture warnings remain unsuppressed.

Actual native oversized UTF-8 draft rejection reproduced a recovery defect:
correcting the text left Send disabled and retained the rejected save command.
The draft owner now releases only explicitly rejected `invalid_conversation`
commands and clears their recovery state on editing; uncertain receipts retain
the original command. The keyboard-send regression failed before the repair
(`draft-recovery-keyboard.log`), then passed with the normal desktop/phone
workflow, typecheck, architecture lint and fresh export in
`draft-recovery-green.log` (two browser tests, 4.1 seconds). The separate real
native committed-write/lost-acknowledgement regression also passes with the
validation case (`draft-receipt.log`, two tests, 3.6 seconds): the exact original
save command is replayed and only one provider turn is admitted. The actual-core
UI matrix for partial-response Stop, process-crash interruption and provider
failure with explicit retry now passes with both draft cases
(`stream-recovery-routes.log`, five tests, 9.7 seconds). Initial matrix failures
were harness assumptions: reload retains the Messenger route, and retry retains
the old cancelled/failed message dialog while appending a fresh response. The
corrected checks await the actual native admission and completed prepared reply,
preserve the old record and assert one authored message and two provider calls.

Real-core People/Thread workflows also pass (`content-ui.log`, two tests,
5.1 seconds): edit/archive/restore, direct-chat identity/history reuse, two-Person
temporary Thread, title/participant changes, acknowledged draft persistence
through process crash and reload, discard and independent Person retention.
Streaming/history work remains open for authored edit/delete/reply, bounded
search and prepend/tail behavior. None of these passes certifies visual parity.

The actual-core source workflow now passes (`source-ui.log`, two tests,
4.9 seconds): native language preparation -> Inspector -> Capture -> authored
message edit -> native process crash/restart -> Material Return restores and
reanalyzes the original immutable message, not the new text. Contextual
explanation admits the exact selected UTF-8 span and full original sentence
through the native generation owner. Both captured dialogs were inspected;
they are usable, but the surrounding Messenger composition remains visually
unfinished. Browser coverage does not certify platform clipboard behavior.

The longer history workflow reproduced and repaired a live-tail defect.
Actual geometry proved FlatList's estimated scroll-to-end moved to 24 rather
than the measured 184 tail. The owner now uses real content/viewport extents.
The temporary geometry probes were removed. A second exposed readiness defect
left message action triggers interactive while their dialog refused to open;
the shared message-action trigger now exposes its actual busy state.
All seven history/recovery tests pass (`history-actions.log`, 15.5 seconds),
including 21 actual UI sends, native 40-message reopening and two-message
prepend without forcing the learner back to the latest response. Previous
failed logs/captures remain evidence, not erased runs.

The reference-derived header disclosure removes permanent Provider/Runtime
Inspector/history-search rows from normal chat composition while keeping all
actions reachable. All 12 connected actual-core workflows pass after the change
(`compact-header.log`, 27 seconds), with typecheck/lint/export. Desktop output
was inspected. Normal Settings selection of Dark Quartz then native process
crash/restart preserves its SQLite theme identity and chat content. Fresh
desktop, phone and expanded Inspector captures in `qa-dark-restart` were
inspected (`dark-restart.log`, 3.7 seconds); the sparse rail and message
materials still differ from the reference, so no visual-parity pass is claimed.

Actual Runtime Inspector UI now passes with the source workflows
(`runtime-trace-ui.log`, three tests, 6.8 seconds): saved prompt/request/delta/
response and original input identities are read natively without a second
generation. Recorded request content has no Authorization/Bearer data.
Reference ChatBubble/ConversationAgent material evidence is now in DESIGN;
the shared secondary/authored surface projection and composer backing now pass
the complete npm owner/checker suite (114 client tests plus checker tests),
typecheck, architecture lint, web export and four actual-core UI/source cases
(`message-materials.log`). Fresh light/dark desktop/phone output was inspected
in `qa-message-materials`; no generic source-selection tint is used for
authored bubbles.

The remaining sparse rail is being repaired at its actual owners. Native
conversation pages now project at most one latest-message preview per returned
conversation (160 Unicode scalars, at most 640 UTF-8 bytes), actual status and
original timestamp. Empty conversations invent no preview; deleted messages
reveal no deleted text. A first test caught SQL double-to-JSON timestamp
rounding; the query now retains the original JSON numeric representation.
The native/client projection and generated-contract checks pass in
`preview-owner-exact.log`; the initial failure is retained in
`preview-owner.log`. Shared Button owns proper stacked navigation-row copy/date
slots, and shared segmented selection replaces the feature's outlined tabs.
The rebuilt actual-core binary and consuming UI now pass the full 13-case
connected matrix (`native-previews.log`, 31.1 seconds), complete npm tests,
typecheck, architecture lint and web export. Fresh dark desktop/phone rail
captures were inspected in `qa-native-previews`: native text/date projections,
stacked selected rows and filled shared segments are visible. Authored avatars
are not invented when the Person has none. Remaining reference discrepancies
and the other implemented surfaces still require their final comparison pass.

Affected local iOS preparation/consuming build is now running with Xcode 27,
the existing iOS consuming workspace and all Rust mobile targets are retained;
no simulator is booted. Disk has only 12 GiB free, so native builds must reuse
the existing caches and run sequentially after the current rendering check,
without recreating acceptance environments or deleting retained evidence.

Additional adversarial QA reproduced a real uncertain-send defect:
new input authored after a lost draft receipt remained trapped behind the
original send's recovery state (`later-draft-red.log`). Send now retains its
acknowledged stage, recovers the exact original save/send/clear command and
preserves later input rather than clearing it. Blur/background autosave cannot
race that owning recovery action with a stale pre-clear revision. The full
six-case acknowledgement-loss matrix (draft/send/clear, with and without later
input), native Stop/crash/provider failure, People/Thread persistence and
history workflows now pass (`draft-ownership.log`, 14 tests, 30.2 seconds)
with fresh typecheck/lint/export. Intermediate failed assertions and the
demonstrated blur conflict remain retained; no tolerance or native bound was
weakened.

Standalone `tests/mobile/messenger.yaml` and its acknowledged-character input
helper are now running. They cover real native contact creation,
provider configuration, generated-message copy and process restart without a
media picker. The provider is to be a local deterministic HTTP/SSE fixture,
not a paid model. New native input test IDs are on the actual shared fields.
The original iOS preparation and consuming build both passed, then the final
incremental consuming build also passed (`ios-final-ui-build.log`,
`BUILD SUCCEEDED` at line 10557) after the draft repair and real field IDs.
The complete browser regression suite passes on that final presentation:
65 checker tests, 115 client/owner tests, typecheck, architecture lint, web
export and all 79 browser tests in 1.2 minutes (`full-web.log`). These include
the other shared-control consumers, not only Messenger.

The deliberate standalone iOS scenario uses retained project device
`2C4A73B3-435F-4CD0-86E4-09F549DC3B4F` and the existing preflight Maestro/
Java17 toolchain, not a new simulator or installation. Native provider fixture
is owned loopback port 41235; its Bun server lives in the active eval kernel
as `nativeProviderServer` with `nativeProviderRequests`. Do not restart that
server or device on resumption. Native iOS UI now passes (`native-ios.log`,
one actual flow, 3m9s): create fields with acknowledged native input, select
English, save local provider configuration, execute the real Rust request,
copy its generated message through UIPasteboard and reopen the persisted
conversation after process restart. The loopback fixture observed exactly one
provider request. `xcrun simctl pbpaste` read back exactly
`Children walked home.` after restart. The packaged JS bundle SHA-256 is
`c58e83dbd5d41e5cf9a48a61a1b4b51e7ead2bfa8be93a9be70a62d18a5f79a1`.
The restarted view and actual copied-message dialog captures were inspected.
Maestro's first completed-message screenshot had missing compositor regions
and is retained as invalid visual evidence, not a product-state pass. A fresh
native `final-composited.png` was captured and inspected before shutdown.
The owned provider stopped, and `simctl list devices booted` confirms no
remaining booted device after shutting down only the deliberate H00 target.

Android preparation and the retained consuming build now pass
(`android-consuming-build.log`, `BUILD SUCCESSFUL in 1m9s`). APK inventory
contains exactly arm64-v8a/x86_64, both `libmlearn_ffi.so` bridges and the real
`assets/index.android.bundle`. The exact local SDK/NDK27.1/retained Java17
invocation is recorded in the M07 PLAN.

Standalone Android UI is running deliberately on retained AVD
`mlearn-h00-api35-20261016`, port5556, without wiping data or loading/saving a
snapshot. The first run created the actual Person, then stopped at a harness
selector mismatch before any provider call: Android exposes the select as
`Language for direct conversation, English`, not the iOS label alone. Its exact
log, screenshot and native hierarchy are retained under `native-android`.
The selector now matches the labelled value, and each run uses a distinct
explicit QA Person with a checked matching conversation dialog.

The next native run demonstrated a product defect: typing hid the composer
behind Gboard. Geometry probes proved native keyboard coordinates and avoiding
state were correct, but direct Unistyles shadow binding reset the calculated
height from 577.9 to 914.3 logical pixels while its bottom state remained 336.4.
Shared UI now resolves styles through `withUnistyles` before React Native's
avoiding view; both Messenger and Dialog consume it. Safe-area padding belongs
to the outer screen. The same failing native keyboard visibility regression now
passes with the composer above Gboard, and its capture was inspected
(`android-keyboard-boundary.log`, `native-android-keyboard-boundary`).
All temporary geometry probes were removed. The full 79 browser regressions,
65 checker tests, 115 client tests, typecheck/lint/export pass for that shared
boundary (`keyboard-owner-web.log`).

Remaining Android retries exposed harness errors, not new product assertions:
dynamic erase counts were unsupported, deleting from a tapped mid-field caret
damaged retained input, and an extra hideKeyboard/Back after system Copy
navigated Home. Their complete logs/captures remain retained. The flow now
waits for actual provider settings readiness and reuses exact already-saved QA
values instead of destructive caret workarounds. A native editor Copy seeds
a different clipboard value before the app's Copy message, so no-op clipboard
code cannot pass by coincidence. The actual system Paste must insert the
generated text into the real composer. `native-android-system-copy.log` reached
the actual failed-generation state: zero fixture requests, emulator airplane
mode enabled and no IP route. This is retained environment-failure evidence,
not a functional pass. Disabled airplane mode and enabled Wi-Fi only on the
owned QA emulator; readback confirms AndroidWifi at 10.0.2.16 and its host
subnet route. The unchanged standalone flow on the same installed APK is now
verified under `M07_ANDROID_NETWORK_RESTORED_EXIT=0` /
`native-android-network-restored.log` (2 minutes 56 seconds). Exactly one real
native request reached the fixture. System Paste inserted the generated text
over the distinct editor-copy baseline, and both messages survived app restart.
The keyboard-open Paste capture and completed-message frame were inspected.
The immediate restart capture had missing compositor regions; it is not valid
visual evidence. Fresh `native-android-network-restored/final-composited.png`
shows the complete persisted conversation and was inspected. Android's original
airplane setting was restored before shutting down only the owned AVD.
`bash_786` exited 0; `adb devices` is empty and port41235 has no listener after
stopping the owned fixture. No profile or evidence was deleted.

Provider error-state QA also reproduced a real recovery defect: an explicitly
rejected endpoint left fields read-only (`provider-editability-red.log`).
Native validation precedes admission, so only those definite validation
outcomes now release their command for correction. Uncertain receipts still
retain the exact configuration and command ID. Both real-core provider cases
and all ten draft/generation recovery cases pass (`provider-owner.log`,
12 tests, 23.5 seconds) with typecheck/lint/export. Its native consuming
Android app has been rebuilt and its connected workflow passes. Final-source
iOS consuming build also passes (`ios-shared-keyboard-build.log`, actual
`BUILD SUCCEEDED`). Bundled JS SHA-256 is
`6c2f041f475d9897b8b5af87cdd64c2390936e4602be0c795cf8c0b75db0615d`.
Only the retained H00 device was deliberately booted and updated without
clearing its profile. The standalone final-source flow is running under
`M07_IOS_SHARED_KEYBOARD_FLOW_EXIT` / `native-ios-shared-keyboard.log`.
The first run stopped before any request because iOS long press positioned a
caret without a Copy menu; its exact screenshot confirms visible composer and
Send above the keyboard. The YAML-only correction uses iOS word-selection
double tap, preserving Android's proven long press. Final flow is now running
under `native-ios-editor-copy.log`; that attempt also stopped at missing Copy
before any provider request. Independent verbose simctl readback now explicitly
confirms an empty system pasteboard. This distinct empty baseline makes a no-op
app Copy detectable without guessing more editor gestures. Android retains its
successful native editor baseline. The final iOS flow is running under
`M07_IOS_EMPTY_BASELINE_EXIT` / `native-ios-empty-baseline.log`; its post-copy
system readback equals the actual generated response `Children walked home.`.
The full final-source iOS flow passes in 2 minutes 27 seconds, with exactly one
native provider request. Keyboard-open composer, copied-message dialog and
persisted restarted conversation captures were inspected. The owned fixture
stopped; H00 was terminated/shut down and `simctl list devices booted` is empty.
ADB devices and listeners on 41235/7780/8081 were also empty before advancing.
Shared native keyboard repair is now verified on both affected platforms.

The recorded normal desktop scenario has started using the supported isolated
identifier `net.kikan.mlearn.v3dev.m07qa`, normal documented dev launch and
existing Cargo profile, not a separate renderer or invented profile flag.
`normal-desktop-dev.log` / monitor `mon_22H2BPYYTRSNNNBZ`, `bash_831` owns this
launch. Do not restart it on resumption. Finish native desktop interaction,
matched comparison and performance checks, then release only its owned tree.

Normal native desktop now runs PID10282, window380, 1080x800 logical,
after a successful 45.65-second dev consuming build. Its real isolated profile
is `~/Library/Application Support/net.kikan.mlearn.v3dev.m07qa`, confirmed on
disk. Actual Settings installed authenticated English 0.1.3-wn30-ocr2,
26,017,613 bytes. Person/direct-chat creation, rejected file-URL provider
feedback and in-dialog correction, real send/analysis/Inspector, Capture and
Material Return all execute through the native host. The local external SSE
fixture has received four requests: one chat reply and one grounded explanation
each from message, Reader and Watch. This is not a bundled-model claim.
For all three source surfaces, native selected-text clipboard readback equals
`Children` and full context equals `Children walked home.`. The text-only
clipboard was preserved/restored without logging its original contents.
Reader used actual `tests/fixtures/reader/continuity.txt` via the macOS picker.
Watch used a byte-identical retained movie/SRT pair selected through native rows.
The Go to Folder sheet did not accept confirmation through the available input
routes; its parent Cancel correctly released pending import. No product fix or
picker success is inferred from those failed attempts. Visible owned copies
`tests/fixtures/reader/m07-qa-watch.mov` and `.srt` then imported successfully;
their SHA-256 equality to the original fixtures is recorded in the session.
Keep these copies for the remaining restart checks, then remove only these two.

Actual native captures are `desktop-native-settings-packages.png`,
`desktop-native-provider-rejected.png`, `desktop-native-message-inspector.png`,
`desktop-native-grounded-explanation.png`,
`desktop-native-captured-message-return.png`,
`desktop-native-reader-explanation.png` and
`desktop-native-watch-explanation.png` under the M07 evidence directory.
The actual message Inspector and Watch explanation were personally inspected.
Normal-dev metrics show message Inspect action-to-commit 41 ms, Watch Inspect
42 ms and caption request-to-frame 42 ms for this English input. These are
individual measured stages, not a fresh/warm/restart performance acceptance.
Full matched visual comparisons, source-bound repeat/restart measurements and
final regression/review/checkpoint work remain. The app and fixture port41235
are deliberately still owned for those checks; foreground control is released.

The requested temporary visual notepad was absent. Restored its exact path as
an explicitly new index, without inventing missing historical prose.
`.mlearn/visual-parity/surfaces.md` and `manifest.json` now point to this current
checkpoint and label preserved pre-M03 evidence as historical. Their old hosted
gate/exclusion wording must not reinstate the deferred stop or certify M07.

Normal native restart is now verified: old PID10282 and ports7780/8081 were
released before deliberate launch `bash_849` / `mon_0BYPGRKK1B88G8QT`.
Current app is PID13334/window479 with the same isolated profile. First Home
and Settings show persisted Dark Quartz; authored/generated chat content,
three explanation Threads, endpoint/model and native execution trace survive.
Opening the saved trace makes no provider request; bounded request JSON and
absence of Authorization/Bearer were checked. Native fixture requests remain4.
Captures include `desktop-native-dark-home-after-restart.png` and
`desktop-native-runtime-trace-after-restart.png`.

Integrated checks pass before the subsequently discovered narrow-layout fix:
65 checker tests, 115 client tests, typecheck, ownership lint, contracts,
web export and all81 browser scenarios (`integrated-final-web.log`).
All affected core/runtime/storage owner suites pass
(`integrated-final-rust.log`). Existing unused `practice` fixture warnings
remain visible and unsuppressed.

Actual 420x700 native inspection found Messenger Back overlapping the macOS
minimize hit region: Back x440–474/y85–118, minimize x451–467/y78–94.
The new existing-suite regression fails with x20 instead of the host's80px
reservation (`narrow-chrome-red.log`). The collapsed header now consumes the
existing host windowControlsWidth, matching Reader/Watch; mobile/browser-zero
hosts keep the same inset. Native Back moves to x500–534 and its real action
opens Chats without minimizing. LSP is clean. Focused type/lint/export/layout
verification is running under `M07_NARROW_CHROME_GREEN_EXIT`,
`narrow-chrome-green.log`, `bash_859` / `mon_YFTHQWY2N2VR95JF`.
The focused narrow regression now passes in 3.3 seconds with typecheck,
ownership lint and export (`narrow-chrome-green.log`). The stable real-window
frame was inspected with Back visibly clear of traffic lights and retained as
`desktop-native-messenger-narrow-chrome-fixed-stable.png`. No updated
mobile-binary claim is made for this newer macOS host-reservation delta.

One independent read-only M07 implementation reviewer completed with REJECT:
`st_01a16d8f`, name `m07-independent-gate`. Inputs and root manual QA matrix are
in the adjacent M07 `REVIEW.md`. Explicit requested route is
`chatgpt-subscription/gpt-6.1-sol`, matching inspected root PI_PROVIDER/PI_MODEL;
no premium/Astra routing or new worktree. The two concrete findings are retained
in `.omo/evidence/m07-gate-review.md`: uncertain explanation admission escaped
cancellation, and Person changes left current attribution/status stale.
Both now fail real-core regressions (`review-blockers-red.log`).
Root retains all implementation/QA/resource ownership. This is not a
review claiming the original visual goal complete. Final visual/performance
and consolidated-delivery gates remain open alongside the independent review.

Initial targeted repairs pass `contact-projection-green.log` (2 scenarios)
and `explanation-close-green.log` (4 scenarios), with typecheck/lint/export.
Person changes refresh native participants, retained bounded message pages,
current generation and analysis without replacing drafts or jumping history.
Both save and archive/restore use that path. The editor stays mounted until
dependent refresh succeeds; a final publication-order delta needs re-export.
Explanation presentation flights retain the exact admission closure, shared
in-flight resolution and Stop promise. Cleanup recovers that native receipt
before cancellation, retains uncertainty across close/source/reopen and does
not prepare a new recovery command.

The expanded 17-scenario matrix passes 13 and exposes test-input errors:
the added second turn requires two preserved response matches, not a strict
single locator; hard page.goto destroys browser JavaScript without running
React cleanup and does not model a native source transition. The source-exit
case now uses the actual Provider settings in Chats SPA action. Those failed
artifacts remain under `qa-review-recovery-matrix`. The rebuilt rerun passes
all 17 scenarios in 33.4 seconds. Three additional pending-Close cases then
pass all 20 in 39.7 seconds (`review-pending-close.log`), including each
admission/owner/history receipt loss both before and after Close.

Root's affected native repair QA also passes on the retained normal app.
Current message attribution changes to M07 desktop tutor and native response
status becomes invalidated immediately after Person edit, without navigation.
A fresh actual response followed by archive invalidates both replies in place.
Frames `desktop-native-person-edit-reconciled.png` and
`desktop-native-person-archive-reconciled.png` preserve this state. An actual
Reader explanation was held by the external SSE fixture; native Close releases
its HTTP stream, and reopen shows cancelled without another request. Captures
are `desktop-native-explanation-held-stream.png` and
`desktop-native-explanation-cancelled-reopened.png`. Native fixture requests
now total 6; no external stream remains held, but its listener is still owned.
Both implementation blockers are closed by the same reviewer's scoped APPROVE
(st_01a16d8f), preserved in `.omo/evidence/m07-gate-review.md`. No second
reviewer or model switch. Root independently verified full integration:
`M07_REVIEW_FINAL_INTEGRATION_EXIT=0`, `review-final-integration.log`,
65 checker +115 client +96 browser scenarios, typecheck/lint/export all pass.
Final-source consuming builds also pass: actual BUILD SUCCEEDED in
`ios-review-repairs-build.log`, BUILD SUCCESSFUL in 30 seconds in
`android-review-repairs-build.log`. APK contains both arm64-v8a/x86_64 Rust
bridges and the consuming JS bundle. iOS JS SHA-256:
`3430dedf796ef7d2834fadfa483fd09779332ebf5052225f8f0b1a740d3663be`;
APK SHA-256:
`9e321656b9736dceda9cf164844b383688214e5411a8096315310b2f22605ade`.
The normal app remains PID13334/window479, dev launch bash_849, isolated
profile unchanged. It is currently at the cancelled/reopened Reader explanation.
Native SSE fixture41235 remains owned, configured to hold new responses, with
no active response after the successful cancellation. Do not silently restart
or send to it on resumption. The recorded final-source mobile scenario now
reconfigures this idle owned fixture deliberately, then boots only the retained
H00 target; inspect that scenario's new handle before any resumption action.

M07 changes remain uncommitted and unverified as a milestone. Actual screenshot
inspection/repair, broader regressions, native workflows, independent review and
the complete consolidated delivery package remain. No acceptance/continuation claim.

### Historical M06 continuation record

M03–M05 and the M01–M04 architecture gate are `verified_for_continuation`;
M06 remains in progress and M07 has not started. Code/test checkpoint
`b3ec2cfd` includes the green foundation/font repairs, source-bound online iOS
OCR/restart/Inspector/Capture/return evidence and the independently passed
disconnected iOS provider check below. Android's finite source-bound offline
collection/vertical/spread/crop, correction/recovery, PDF/restart, eight-orientation
and actual pending cancellation/fresh-retry checks now pass. Its emulator is shut
down, and both completed iOS sessions have also stopped their device.
Do not automatically restart devices on resumption. Native iOS post-admission
cancellation, malformed-input recovery and all 15 offline recognition/transform
cases pass at `6ce6be1a`. Its foundation run also passes all five jobs. Local iOS
numeric-input automation did not establish its intended invalid-alignment case;
those failures are preserved, not reported as recovery. The real desktop workflow
now passes at `7a7dfa04`. The reversible iOS missing-image/retry case passes in
full, preserving recognition revision 4 and exact original bytes. Latest Android
run `40056615548` compiled successfully and passed source resume plus persisted
playback rate, then lost the Maestro device server during hierarchy collection;
its exact failed JUnit and device logs remain intact. A separate demonstrated
empty-viewport false-busy defect is repaired with a failing-before/passing-after
browser regression; the full 26-case image suite, typecheck, architecture lint
and fresh web export pass. Exact repair source `8934e158` now passes the real
desktop workflow (`40060531796`) and all five foundation jobs (`40060531785`):
Rust, detector conversion, web, macOS and Windows. Source-bound mobile run
`40060531803` now passes Android's full primary workflow. Its iOS app compiles,
then the native Files picker is blank and `Browse` is not found; the exact
failure remains preserved within the deferred hosted FileProvider acceptance
gate, not reported as a pass. No diagnostic variant was launched.
The latest desktop input-harness rerun now passes at `f27f4e55`; its retained
source receipt and genuine captures were inspected. Earlier failed captures
and their bounded repairs remain recorded below. All five foundation jobs now
pass at that same source. M06 remains open while mobile integration completes.
Single independent M06 reviewer `st_01a16c25`
returned REJECT with one deterministic OPS-04 protocol blocker: the successful
native model-test command returns a string, but Settings required an array.
Its full-scope findings are retained in `.omo/evidence/m06-gate-review.md`.
The read-only locked review checkout was removed after report delivery; other
worktrees were preserved. The bounded repair below passes root checks and fresh
independent delta review `st_01a16c32` now APPROVES B1 closure with no blockers.
Affected mobile integration remains a separate gate before M07.
The final-source foundation artifacts are retained in `hosted-8934-foundation/`.
Source receipts match commit `8934e158` and tree
`074ef23ea2a7c098d2142e5fa36bc9ed4c9a5bca`. Both Windows generic and tuned native
reports were read: actual cancellation, six inputs, cropped/PDF recognition and
restart persistence pass. DirectML initialization is unavailable and both execute
on the recorded CPU fallback. Exact vertical Japanese/ruby remains intact;
generic mixed text is exact, while MangaOCR's English degradation and graphic
`○口` false positive remain observable model limitations, not accuracy successes.
The following continuation evidence preserves earlier failures and their
specific resolutions; it is not a set of new investigation instructions.

### Independent review blocker B1 and bounded repair

The actual native `modelTest` response from Windows job `120773804588` is now
retained as `tests/fixtures/ocr/native-model-test.json`; parsed content was
independently compared with the source artifact and matches exactly. Feeding
that response through the existing createOcrModelsHost reproduces the protocol
error. All three Settings UI workflows also reproduce the visible error before
the fix (`run/model-test-contract-red-client.log`, `run/model-test-ui-red.log`,
`qa/model-test-ui-red/`). The first browser attempt failed earlier on the test
runner's CommonJS import.meta handling; that loader failure was corrected and
is not counted as a product reproduction.

The repair preserves the existing native command's single-crop string result:
the adapter validates a nonempty bounded string with no NUL, rather than an
invented array, and returns it without joining. Null/array/empty/NUL/oversized
responses remain rejected. Native model execution, inference resources and
provider semantics are unchanged. The original mocked array is removed from
both client and browser suites in favor of the captured real response.

`npm test` passes 65 checker and 96 client/theme tests. Fresh typecheck,
architecture lint and web export pass; all 29 Settings/image browser workflows
pass in 15.6 seconds. Actual Settings result captures at desktop and narrow
widths were inspected and display the native recognized text and work metrics
beside Test model. Evidence is `run/model-test-contract-green-*` and
`qa/model-test-contract-green/`. This is real exported Settings/host-adapter
execution against a captured genuine command result, not a new inference run.
The host adapter has clean LSP diagnostics; fresh test-file LSP requests timed
out, so those are not claimed clean. No extra language server was installed.
The verified repair is committed as `18791267`; a fresh locked delta-review
checkout is `/private/tmp/mlearn-m06-review-18791267`. The first review's
REJECT verdict remains intact until a separate reviewer verifies B1's closure.
Fresh scoped reviewer `st_01a16c32` completed read-only on that checkout, on the
same approved route, and returned APPROVE for B1 closure with HIGH confidence
and no blockers. It independently checked the actual response/fixture equality,
producer/adapter/Settings trace, malformed-input coverage, all check receipts
and both result captures. Its verdict is appended to the original report without
erasing the initial rejection. No models/builds/devices were launched by review.
Both completed M06 review checkouts were removed after clean-status checks;
the worktree-list read-back confirms neither remains. Unrelated worktrees,
profiles and artifacts were preserved. M06 is still not marked
`verified_for_continuation` while affected platform verification is pending.

### Desktop controlled-input continuation after B1

Run `40062981268`, source `18791267`, job `120780254659`, fails the existing
native preference-admission assertion at native-smoke line 422, not Settings
model testing. The retained failure capture shows subtitle offset `375625`:
the second iteration's requested `625` was appended to the first `375` after
WebDriver clear. Original source receipt, job log, capture and failure state are
in `hosted-1879-desktop/` and `run/hosted-1879-desktop-job.log`.

The harness now replaces the value using native Control+A/release/Backspace
and digit key events, and checks the exact field value before Apply. It preserves
the original native response, cancellation and route-blur assertions; it adds no
retry, delay, response fabrication or product change. Syntax, clean LSP, three
driver ownership tests and whitespace checks pass. The real Linux rerun remains
required; those local checks do not certify the native input repair.
The candidate harness-only repair is committed and pushed as `9ceba482`;
desktop run `40063718304` and foundation run `40063718367` are monitored.
No application source changed after the
independently approved `18791267` product repair.
That product repair now also passes all five jobs in foundation run
`40062981300`: detector conversion, Rust, web, macOS and Windows. Exact-source
metadata is `run/hosted-1879-foundation-metadata.json`; artifacts are
retained in `hosted-1879-foundation/`. Source/tree receipts were inspected, as
were both new genuine native modelTest outputs. Root passed both unmodified
bodies through the repaired production createOcrModelsHost and confirmed text
preservation; the exact outputs and scope are recorded in
`run/model-test-newsource-response-check.md`. This response replay is not another
inference run and does not erase the failed desktop controlled-input run.
The `9ceba482` harness rerun remains a separate open gate.

That rerun (`40063718304`, job `120782447356`) now fails its strengthened
exact-value assertion before Apply: actual empty string versus expected `375`.
Its screenshot confirms the empty field. The NULL-code sequence is not a pass.
The raw WebKit Session.cpp implementation was then inspected in full: this
send-keys path toggles a modifier on its second occurrence and does not map
U+E000 to modifier release, leaving Control active until end-of-command cleanup.
The candidate replaces that NULL with a second Control code before Backspace
and digits. Primary source identity and the exact observed limit are in
`run/webkit-send-keys-primary.md`. Syntax, clean LSP and driver tests pass;
the actual hosted interaction remains required. Both failed captures are kept.

Source `619826f5`, desktop run `40064486549`, job `120784760308`, now passes
the exact `375` input check, real preference admission and cancellation. It
fails later at line 443: the harness's raw `recent_sources` request receives
`Native runtime is busy; retry after the current operation`. This is not a
passing complete keyboard scenario: the second `625` iteration is not reached.
The actual capture shows the usable Watch at 20 seconds. Full log and artifacts
are retained in `run/hosted-6198-desktop-job.log` and `hosted-6198-desktop/`.

The test now subscribes to the actual replacement-source response instead of
issuing that unsynchronized read. At a checkpoint acknowledgement, its existing
durable read is issued before delivering the acknowledgement to the client:
delivery can admit another queued action alongside both display lanes, exhausting
the host's three permits before a raw harness request arrives. The actual read
result and unchanged acknowledgement are returned together, avoiding a second
unsynchronized read after the checkpoint. No retry, sleep, fabricated response,
native admission change or weakened persistence assertion is introduced. This
candidate remains unverified until the real desktop workflow passes.

That real workflow now passes: run `40065130974`, job `120786658416`, source
`f27f4e5594e3188c1002ea743a5d610f75720dd8`, tree
`65a90dfbffdffb9bc4bc65116ded4b0462c56f6b`. Both cancel/blur iterations complete,
including exact `375`/`625` keyboard input, actual preference admission, recovered
Watch, native position acknowledgements and durable offset/position assertions.
The complete native IPC, signed package, playback/seek, contextual Inspector,
shared claims, exact source restart and missing-source recovery workflow passes.
Evidence is retained in `hosted-f27f-desktop/` and
`run/hosted-f27f-desktop-job.log`; the source receipt, final success line and
actual modifier-Inspector/source-restart captures were inspected. These are
Linux Tauri observations, not new mobile or physical-device evidence.

Final candidate foundation run `40065130965` also passes all five jobs at exact
source `f27f4e55`: web `120788484843`, detector `120788485006`, Rust
`120788485091`, Windows `120789364473`, macOS `120789364672`. Its complete
job/source metadata is `run/hosted-f27f-foundation-metadata.json`. The product
has not changed since independently approved `18791267`; subsequent source
changes are the two reproduced native-smoke repairs and checkpoint evidence.
Mobile run `40062981295` remains separately monitored, not inferred green from
these desktop/foundation results.
Both final-source Windows native OCR reports are retained in
`hosted-f27f-foundation/windows-native-ocr/` and were parsed and inspected.
Each covers six fixture inputs, actual cropped/PDF recognition, `OCR cancelled`
and `restartPersistence: true`. Both model tests return the existing scalar
string contract. DirectML initialization is unavailable and the recorded actual
execution is CPU fallback. Vertical Japanese/ruby remains exact; generic mixed
text is exact, low-contrast losses remain, and tuned English degradation plus
the graphic `○口` false positive remain limitations rather than accuracy passes.

Mobile run `40060531803`, source `8934e158`, Android job `120773365649` passes
the complete Watch/Inspector/Knowledge/native-source-resume workflow in 383.944
seconds. iOS job `120773365844` fails at `Element not found: Text matching regex:
Browse`; its actual capture shows a blank native picker immediately after
Open local video, rather than the earlier missing-file grid state. Both exact
JUnits and full logs are retained in `hosted-8934-mobile/` and `run/`.
This is a preserved hosted Files/FileProvider failure, not proof of its cause or
successful iOS acceptance. No helper change, diagnostic variant or replay is
launched for that deferred gate.

### Current native continuation and expanded offline checks

Foundation run `40049585630`, source `3334669dd4867e7f338030fa14c38ff7a97bd4d3`,
completed successfully after removal of the resolved Reader diagnostics.
Mobile run `40049009419`, source `67a845c0`, now passes Android's complete
Watch/Inspector/Knowledge/native-source-resume workflow (457.295 seconds,
zero failures). Its original iOS primary flow still fails at
`id: m01-watch, mp4 is not visible`, preserving the deferred FileProvider gate;
no diagnostic replay was launched. Both JUnit reports and full job logs are
retained under `hosted-67a8-{android,ios}` and `run/`.

The dedicated offline Apple checker now generates all eight EXIF orientation
inputs through independent Core Image inverse transforms, validates their
written ImageIO orientation tags, checks real recognition and compares the
provider's displayed source pixels with ImageIO's transformed decoder. It
records actual provider-call latency and source hashes, and checks rejection
of a pre-cancelled job and a malformed image before fresh successful recognition.
Pre-cancellation is not evidence of in-flight cancellation. Both iOS-simulator
and macOS aggregate Swift builds pass with warnings treated as errors; local
fixture generation passes and generated inputs were inspected. Actual expanded
offline iOS execution now passes in run `40053773717`, job `120752054758`,
source `4b074aeaa6776fa686164b845eb61ef66bc749c4`: all 15 genuine recognition
cases pass on arm64 iOS 26.5 / 23F77 after the observed network disconnection.
All eight EXIF variants produce both exact mixed-language lines at upright
720x300 dimensions; every source-display comparison has zero mean absolute
pixel error against the independent ImageIO decoder. Actual orientation provider
calls range from 1293 to 3001 ms, not app end-to-end latency. Pre-cancelled and
malformed inputs are rejected before successful fresh recognition; original
empty-image, image-only PDF and mapped crop observations remain intact.
Network restoration is observed afterward. Evidence, generated inputs and
display captures are retained in `hosted-4b07-ios-offline/`; selected actual
display captures were inspected. The eight locally generated JPEG hashes exactly
match that hosted corpus, enabling identical Android inputs without another
model download. Android orientation execution and in-flight cancellation are
still open. Helper-only changes route to the dedicated
workflow rather than rebuilding both full applications and desktop models.
The dedicated workflow also runs the existing primary-exit and hosted-only
network-guard tests. Four focused tests and architecture lint pass; all three
workflow documents parse successfully. No YAML language server is installed,
so YAML LSP validation is not claimed.

### Hosted continuation after d8a24bed

Foundation run `40039665884` passed Rust and clean web typechecking, but
eight Reader web cases reported hidden source-token buttons (51 passed).
A fresh one-worker local export of the same source passed all 29 Reader/image
tests; no UI fix or relaxed assertion has been applied. Hosted screenshot/trace
inspection remains pending. Linux desktop run `40039665883` reached the actual
application and failed at `native-smoke.mjs:604`: the enabled visible `Meaning`
control was unavailable after opening Knowledge. This is not the earlier APT
timeout and remains unresolved.

The complete detector job `120707495737` log shows all three pinned downloads
succeeded. Pip rejected `paddle2onnx==2.1.0` with `onnx==1.23.2` because its
metadata requires ONNX 1.16.1–1.17.0. The workflow now explicitly resolves the
converter's other dependencies and installs the retained converter with
`--no-deps`, preserving the measured four version pins, input hashes and
conversion assertions. Execution compatibility is not yet verified. Independent
macOS/generic Windows jobs may run after Rust succeeds despite detector failure;
the detector job and required Japanese artifact remain failing gates rather
than being waived. YAML parsing and `git diff --check` passed.

CI checkpoint `90e8ee7ca023feb2a8842b4b24c7c0e5bdaa517b` is pushed.
Its foundation run `40040864691` detector job `120711369916` succeeded,
verifying installation and actual pinned conversion; downstream native jobs
remain pending. The Reader failure screenshot shows vertical source glyphs
overlapping despite present token markup. A diagnostic attachment now records
token/descendant/ancestor bounds and computed styles on the existing visibility
failure, preserving and rethrowing the original assertion. LSP and all five
local document Reader tests pass; hosted geometry is still needed before a
product repair.

Run `40041166945` reproduced the Reader failure. Its attached geometry shows
the vertical CJK source spans and button have zero height while visible, with
positive ancestor geometry; this is not a hidden ancestor or zero-width control.
No minimum-size workaround was applied. A Chromium platform-font attachment now
identifies the actual shaping font before the unchanged visibility assertion.
The affected local Reader test passes with that diagnostic; fresh LSP requests
timed out, so fresh LSP validation is not claimed for the diagnostic addition.
The first platform-font probe queried the button and returned no direct-text
fonts. It now queries its actual `[data-source-start]` text leaf. A real local
Reader run returns `Hiragino Sans / HiraginoSans-W3`, two glyphs; the corrected
Linux font result remains pending.
The corrected Linux text-leaf probe selects `WenQuanYi Zen Hei`; the package log
pins Ubuntu `fonts-wqy-zenhei` 0.9.45-8. That exact font's `東` vertical advance
is zero (`vmtx=[0,841]`, units-per-em 1024). The retained font SHA256 is
`79c18ebe7b811951e8311bad7103ebeae8c337ed9988ea69e8a78a66cfe029b9`.
A disposable local custom-font probe did not reproduce Linux's zero height:
macOS supplies different metric fallback. No system font was installed or
application style changed for that diagnostic. Its temporary browser/server
closed; font inspection used an isolated pinned tool, not the reference env.

The web CI job now installs the same `fonts-noto-cjk` prerequisite already used
by native Linux verification and records font availability/matching. README
documents the shared prerequisite. YAML parsing passes; unchanged real Reader
tests must still verify positive usable geometry on Ubuntu. No minimum-size
workaround, CJK-specific renderer branch or relaxed visibility check was added.
Run `40045175574` still fails the same eight Reader cases: installing Noto alone
does not displace WenQuanYi in Chromium's actual glyph fallback. The retained
text-leaf attachment again identifies WenQuanYi. The disposable web runner now
removes that legacy package after installing Noto, matching the native Linux
harness's usable CJK-font environment. The unchanged browser checks remain the
verification gate; this second prerequisite adjustment is not yet passed.
That correction is now verified by foundation run `40047165680`, source
`b7ea856d3371c1e520e1efb09ba01e797c6e41dd`, tree
`a18a2b8e70926b64f73cf68009f7b637653c8047`: all 59 browser workflows pass,
including the eight previously failing cases. Rust, detector conversion, macOS
and Windows jobs also pass. The source receipt, Linux font inventory and narrow
Reader/image captures are retained under `hosted-b7ea-web`; both captures were
inspected. No product sizing hack, renderer branch or assertion relaxation was
needed. Temporary Chromium font/geometry diagnostics are removed now that their
evidence has resolved the cause. The unchanged five-case Reader suite passes
again locally against the matching product export, with fresh clean diagnostics.

Foundation run `40040864691` completed: Rust, pinned detector conversion and
macOS desktop build/tests passed. Windows job `120713091191` passed eight
document tests, including image admission/registry/restart publication, but
three byte-addressed text-fixture tests failed before the OCR probe started.
Its log shows CRLF-converted fixture bytes being parsed as one LF-only paragraph.
The parser explicitly advertises LF blank-line paragraphs and preserves original
source bytes; this is not evidence to normalize source IDs.

The exact checkout failure was reproduced without modifying the real fixture:
`git -c core.autocrlf=true checkout-index --temp` produced 178 bytes and
13 CRLFs from the 165-byte authored fixture. `.gitattributes` now marks only
`tests/fixtures/reader/journey.txt` as `-text`. The same checkout operation then
produced exactly the original 165 bytes with no CRLFs. Both generated temporary
copies were removed. The existing parser byte-container test and all 11 runtime
document tests pass locally; hosted Windows execution remains pending.
No product parser or assertion was changed.
The following source's Windows document suite and full generic OCR/persistence
probe pass in run `40042948769`, job `120719470068`. Its tuned Japanese probe
instead fails before inference with `Unsafe native artifact path`: ZIP's
`enclosed_name()` constructs host-native separators, and the extractor used
that Windows path as the portable inventory key. The publisher already emits
forward-slash names; it was not the faulty owner.

Extraction now validates the original ZIP name, retains that portable inventory
identity and separately checks the enclosed filesystem path has exactly the same
canonical slash-separated identity. Backslashes, aliases, traversal, symlinks,
unlisted files and tampered bytes remain rejected. Existing nested-install
coverage now checks both runtime and model bytes; a noncanonical ZIP-name
regression failed before the canonical guard and passes afterward. All 12 native
resource-owner tests, fresh Rust diagnostics and strict Runtime Clippy pass.
The Windows job now runs that existing owner suite before its real OCR probes.
Hosted tuned execution is still pending.
That gate now passes in foundation run `40045175574`, source
`71ef009043dbde0dfea00ccd6b13ebdfb8a9c7d3`, Windows job `120726520494`.
Its retained `windows-native-ocr` artifact (`12541382731`) contains both actual
generic and tuned Japanese results: authenticated installation, six image
fixtures, cropped recognition, image-only PDF, cancellation and restart
persistence. Both vertical Japanese lines and ruby are recognized correctly.
The generic mixed page preserves both expected lines; MangaOCR retains its
documented English degradation and graphic no-text false positive (`○口`).
DirectML initialization fails on this hosted machine and execution explicitly
falls back to CPU; this is not GPU verification. Together with the retained
macOS native-owner runs below, functional macOS/Windows OCR execution is
verified, not consuming GUI acceptance or general recognition accuracy.
The same run passes Rust, pinned detector conversion and macOS build/tests;
its separate web font failure remains open.

Linux failure evidence now includes Inspector control bounds, expanded/disabled
state and center-hit labels alongside the existing geometry capture. Node syntax,
LSP diagnostics and diff whitespace checks pass. The native scenario has not
been rerun locally; this records the missing diagnostic, not an interaction fix.
Run `40042402948` reproduced the Linux failure with Knowledge enabled,
hit-testable and still `aria-expanded=false` after the click. Its immediately
preceding window restoration had no event-driven viewport/layout acknowledgment.
The scenario now subscribes before restoring and requires the original viewport
and source-anchored panel geometry before its next action. Syntax, fresh LSP
and whitespace checks pass; this candidate race repair is not claimed verified
until the actual Linux scenario passes.
That candidate now passes the complete unchanged Linux desktop scenario:
run `40043476671`, native job `120719684628`, source
`87be689d1ec27af341a279c522a4b943a740e82d`, tree
`3597f03133c9c950efce804d928c8bedff9942fa`. The source receipt, captures and
results are retained under `hosted-87be-linux`. Knowledge input after window
restoration is repaired; this is not whole-M06 OCR UI acceptance.

Mobile run `40039665858` remains in progress. Its repaired Swift binding step
passed. Android compilation and pre-UI upload passed; source-bound artifact
`android-compiled-app` (`12539538398`, 693914688 bytes) is retained on GitHub.
No device or reference app was started during these CI-only repairs.
The iOS consuming simulator build also passed and retained source-bound artifact
`ios-simulator-app` (`12540261602`, 277056390 bytes). Its later UI failure is
the existing missing Files picker item (`m01-watch, mp4`), not a compiler failure;
the hosted FileProvider acceptance deferral remains explicit. No new picker
diagnostic variant was created or manually dispatched.
The existing `run-ios.sh` still automatically launched its old identical/keyboard
picker replays after a primary failure. That diagnostic tail is now removed for
the authorized deferral. The primary Watch flow, every assertion and all retained
replay files/evidence remain untouched; `set -euo pipefail` preserves its failure.
Shell syntax and isolated primary-exit fixtures prove statuses 7 and 0 remain
7 and 0. No diagnostic replay or device was launched by those fixture checks.
Foundation run `40045951891` stopped before browser verification because the
existing runner test still required those removed diagnostic invocations. That
test now exercises primary statuses 0, 7 and 3, requires exactly one Watch
invocation on the selected device, and preserves each primary exit unchanged.
The focused runner suite and full `npm test` pass (64 tooling and 96 client
tests); fresh JavaScript diagnostics are clean. The web font correction still
needs its unchanged hosted browser checks; no device was started for this fix.

Android job `120707495228` later failed inside `watch/preferences.yaml` at
step 118, after returning Home and restarting the app: the exact saved source's
Resume row was below the visible Watch/Reader cards. The failure capture and
hierarchy show Home with `m01-watch.mp4` present, not lost persistence or a
crashed application. Earlier real claims, withdrawal, subtitle-offset entry and
transcript inspection had completed. Both the nested restart path and the main
Watch flow now scroll to the exact Resume action before tapping it; all existing
source/playback assertions remain intact. YAML parsing and whitespace checks
pass. A real rerun is pending; no local device was restarted for this repair.
Evidence is retained under `hosted-d8-android/test-results/mobile` in the M06 root.
The corrected preferences restart now completes in source `0abce8e1`, run
`40043214031`, Android job `120721816047`. That run also completes real playback,
inspection-triggered pause and the 15-second native seek before finding the same
offscreen Resume assumption in `watch/player-android.yaml` after its own restart.
Its failure screenshot again shows Home and the retained video, not data loss.
The remaining Android/iOS player and Japanese restart consumers now scroll to
their exact saved-source action before tapping it; their original position,
language, Knowledge and offset assertions remain unchanged. All three YAML
files parse cleanly and the whitespace check passes. Device execution of this
additional correction is still pending. Evidence is retained under
`hosted-0abce-android/test-results/mobile`.

### Finite offline Android OCR verification

#### Source-bound run — 2026-10-24

A subsequent finite run uses the actual retained APK from source
`0abce8e1a176e7735736862c90a15f93ca8aea4c`, tree
`0592a0475676581229f488c8da0c488356736ee3`, artifact `12541581849`.
Its APK SHA256 is
`16529035a1d0df0287b6e91beba678e66351686289eb33d04e9723612c33a175`.
Client/shared UI/mobile-adapter source is unchanged since this build; later
Rust native-resource extraction changes exist, so this is not substituted for
the current-source hosted mobile build. Installation preserves the retained
profile; Wi-Fi/data were disabled before launch and the original corpus was
staged in its own QA Downloads folder. `dumpsys connectivity` reports
`Active default network: none` before the first recognition. Three original
image hashes were verified on-device before normal picker selection.

The normal picker imports all three images, retaining their selected order:
horizontal mixed, vertical/ruby, then spread. Bundled ML Kit Japanese recognizes
both exact horizontal lines and the vertical `日本語を読む`; it introduces spaces
in the other main column and ruby. The package identifies publisher readings,
so their control appears. Spread recognition retains four actual observations;
left `01` is misread as `O1`, a recorded model limitation, not silently corrected.

A real drag on the original spread creates a crop at approximately left 51.87%,
top 7.04%, width 44.94%, height 24.66%. Re-recognition retains the other three
observations and replaces the right title with `RIGHT PAGE 02`. The saved page
is revision 4; its namespaced crop ID is `3:line-0`, with original-image top-left
coordinates 54.2%, 13.7778% (about 542,62 in the 1000x450 source). Storage's
existing crop namespace preserves request-local provider IDs in raw evidence
without colliding with retained projection IDs. Explicit Save position followed
by app stop/launch and Home resume reopens page 3 of 3 without another recognition.
That restart checks source position, not a fresh inspection of crop revision 4.

The exploratory failures are preserved: ADB staging left the three new MediaStore
rows pending, so only those completed QA transfers were published; picker labels
include filename plus size/date, not a bare filename. A new publisher-reading row
also moved Recognition details below the header viewport, requiring a contained
scroll. The crop script's expected `01` failed against the actual native `O1`;
the follow-up checks the retained native observation without claiming it matches
ground truth. No application code or original fixture was modified, and no OCR
result was injected or manually edited; the real crop recognition produced the
new saved OCR revision.
Successful command receipts/captures are under `run/android-source-{open,
select-labeled,recognize,vertical-spread,crop-check}`; failed attempts remain beside
them. Captures were inspected directly.

The final flow stopped the app before its twenty-minute deadline. The deadline
restored test-device Wi-Fi/data settings and shut down its owned AVD; `adb devices`
is empty and no emulator/QEMU process remains. Emulator and memory-watch sessions
later reached their limits; no live device or guard remains. Host memory is 61%
free afterward. Actual image-only PDF OCR, EXIF variants and remaining mobile
recovery/cancellation interactions are still open; this run does not close M06.

#### Finite correction and orientation continuation — 2026-10-24

A new explicitly bounded session of the same retained API 35 device uses the
same source-bound APK, without clearing its profile. Wi-Fi/data are disabled
before app launch; `run/android-matrix-offline.txt` again records no active
default network. The cropped spread reopens at page 3 with saved revision 4.
An actual invalid alignment save is rejected beside its action with
`OCR region corners must describe a convex source quad`; the draft remains
editable. A subsequent valid correction changes native `LEFT PAGE O1` to authored
`LEFT PAGE 01` and saves revision 5. The numeric automation leaves a valid
top-left X of 2.4042%, not the intended restored 4.2%; this is not evidence of
unchanged alignment. After stop/launch/resume, corrected text and the retained
right-page crop remain present. Package interpretation creates derived revision
6 while preserving authored text/geometry/candidates, as enforced by the existing
storage projection boundary. The original script's final revision-5 assertion
fails against that legitimate derived revision and is retained. The follow-up
passes against the observed revision 6 and opens parent revision 5's genuine
correction evidence, whose parent is revision 4. Captures were inspected.
Receipts are under `run/android-native-{matrix-open,correction,
correction-provenance}`.

All eight byte-identical EXIF JPEGs are then imported through the normal
multi-select picker in orientation order. Real offline Android display and ML Kit
Japanese recognition pass for every page: both exact mixed-language strings are
present in each saved result. The matrix takes 187.209 seconds; all eight original
source-display captures were inspected and show upright, unmirrored source pixels.
This closes mobile EXIF inference/display transforms together with the independent
iOS pixel comparison above. Android evidence is under
`run/android-orientation-{select,matrix}`. Image-only PDF and cancellation
execution remain in progress.

The same offline app then imports the unchanged image-only PDF through the
native document picker, explicitly switches from available text to original
PDF pages and recognizes the actual raster with bundled ML Kit Japanese.
Both exact mixed-language lines are saved at recognition revision 2.
Save position, app stop/launch, Home resume and return to original pages retain
both recognized regions without another recognition. The recognition/restart
workflow passes in 50.487 seconds; import/original-page and result/restart
captures were inspected. Evidence is under `run/android-pdf-{open,recognize}`.
This closes actual Android image-only PDF recognition and persistence, separate
from the existing iOS/desktop component PDF results. Cancellation is still open.

A bounded 2880x2400 dense source, rendered from the unchanged mixed-language
fixture, has SHA256
`de2d01ed9ce8a157764b7c80f6ca24df91870542af783b84f0c8d869eeb4bbd6`.
The ordinary Maestro cancellation attempt does not observe the transient Cancel
control before recognition completes. An immediate-navigation follow-up exits
successfully, but its captures show revision 2 becoming revision 4 with no pending
state at interruption; it is navigation/re-recognition evidence, not cancellation
proof. Both attempts remain preserved under `run/android-cancel-*`.
The completed device session is stopped and its Wi-Fi/data settings restored.

A small self-targeted Android instrumentation probe now subscribes to actual
accessibility events before activating Recognize page, scrolls the actual pending
Cancel control into view when necessary, and activates that control through native
accessibility. It checks preservation of the previous saved revision and explicit
fresh retry, without sleeps, animation settling or backend-result injection.
Its source and manifest are in `tests/mobile/ocr/`; compilation against the retained
Android SDK and APK signature verification pass. Java LSP is unavailable, so no
Java language-server result is claimed. A separate ten-minute, memory-guarded
device session was explicitly launched for this probe; actual execution is now
verified: the pending Cancel control is observed and activated after the
subscription. Saved revision 4 remains revision 4 after cancellation; an explicit
fresh recognition produces revision 6, the sole new native result plus package
projection. The probe requires that exact revision span to reject a late cancelled
publication hiding behind the fresh result. Pending/cancelled/retried captures were
inspected; the dense source uses the English package, so its Japanese analysis
limitation remains visible and is not claimed as successful annotation.
The executing product APK hash still matches the source-bound `16529035…a175`
binary above; it was not replaced. The test-only APK hash is
`87e84d81bdc6224cb62202056475c575d52363c45abb68cd941e261dbed314e9`.
Actual artifacts and `report.json` are in `run/android-cancel-probe/actual/`,
with its marker/report in `execution.log`. The test-only package is removed after
retrieval, product app stopped, device Wi-Fi/data restored and emulator shut down.
The same dense input is staged in the retained iOS app's owned QA folder, but its
simulator's subsequent finite session imports it successfully through Files.
Apple Vision completes genuine recognition before Maestro observes the brief
pending Cancel state; that failed interaction remains preserved and is not
claimed as cancellation. Source display and saved recognition are real.

The Apple checker now observes the precise worker-admission boundary instead:
an `MLEARN_OCR_CHECKS`-only one-shot observer runs after the real cancellation
closure is installed and its lock released. It cancels the actual admitted job,
joins the real worker and then requires successful fresh recognition. The observer
is compiled out of ordinary application builds; there is no sleep, fake provider,
result injection or altered recognition pipeline. Normal iOS-module compilation
without the flag and full checker compilation for iOS/macOS with it pass with
warnings treated as errors. Runner guard tests and architecture lint also pass.
Actual disconnected execution now passes in run `40056615413`, job
`120760882952`, source `6ce6be1ae70bfa25a1ad29d85738dbf41b4d8df8`, on
iOS 26.5 / 23F77. The report records pre-cancelled, post-admission-cancelled and
malformed-image rejections, followed by all 15 successful real recognition cases.
All eight orientation display comparisons still have zero pixel error.
Network unreachability and restoration were observed. This is native
post-admission cancellation, not a claim that GUI automation caught the transient
control. Evidence is in `hosted-6ce6-ios-offline/`.

The two finite local iOS sessions ended at their guarded limits and all devices
are stopped. Numeric-field attempts did not reach the intended invalid polygon:
the visible label and editable input are separate accessibility nodes, insertion
at the existing caret did not replace the complete value, and generic keyboard
dismissal differs from the app's explicit Done accessory. Their red receipts
remain under `run/ios-ocr-*`; no product correction/recovery pass is inferred.

The next source-retry probe is `run/ios-source-retry.mjs`. It touches only the
newly authored dense source's canonical copied image, whose exact SHA256 is
`de2d01ed9ce8a157764b7c80f6ca24df91870542af783b84f0c8d869eeb4bbd6`.
Its source ID is `document-f57b71f9636c58d9c39a59625b9373581024dcd33e8aba9db2ef8e7ae26ea412`,
resource `image-0`, Japanese package, saved revision 4 (read-only SQLite query).
After ordinary Home startup, the probe temporarily renames that canonical
`document-assets/2fc4f9a7f1d5f2438b8e66fca307ac3842aa6a1a7197f01738730f09701299b5/`
file to the same path plus `.m06-recovery-held`, observes the real image error,
restores it in `finally`, verifies original bytes and exercises explicit Retry.
It keeps a second copy in `run/ios-missing-source/original-source.bin`; no database
or original QA input is edited. The script refuses an existing held file or an
already booted device, has a four-minute abort/memory guard and always shuts down
its owned device. If interrupted, inspect/restore the held file before any boot;
never overwrite an unexpected replacement.

The first run exposed the expected missing-file error, but its Retry tap targeted
an accessibility node below the clipped header viewport, not the visible button.
Both new browser retry cases (1080 and 390 widths) pass on unchanged product code:
restored pixels and cached analysis return without repeating recognition.
In the corrected native run, `run/ios-missing-source-visible/recovered/`,
explicit visible Retry completes, `reader-image-ready` passes and the inspected
capture shows the original dense source with cached interactive annotations.
The subsequent Recognition details tap again targeted an offscreen header node
after the header reset to its top; its revision assertion failed without opening
the dialog. The final probe scrolls both controls into view and retains separate
evidence under `run/ios-missing-source-complete/`. No product initialization repair
is justified by these observations; the speculative repair task is dropped.
All completed fault sessions restore the exact original hash in `finally` and
shut down their owned simulator. Failed automation receipts remain intact.

The final full native case passes: explicit Retry displays original pixels and
cached annotations, the real Recognition details dialog reports Apple Vision
recognition revision 4, and the runner verifies the same input/restored SHA256
above. Its `report.json`, both JUnit reports and inspected captures are retained
in `run/ios-missing-source-complete/`. This source-bound retained application
does not include the later viewport status repair below.

Capture inspection found a separate actual presentation defect: when source URI
loading had failed and no pages existed, ImageViewport still reported busy and
displayed its image-render loader. The source-load error/retry already belongs to
ImageReaderControls. The viewport now reports an empty, non-busy state when it
has no pages, reserving image-render loading feedback for actual pending pixels.
Both width-specific regression assertions fail on the preceding export
(`qa/false-loading-red/`) and all 26 image Reader cases pass after the fix
(`qa/loading-fix/`, 14.5 seconds). Fresh typecheck, architecture lint and export
also pass; the repaired narrow error capture was inspected. No error is suppressed
and native recognition, persistence and retry ownership are unchanged.
The verified product/test increment is committed and pushed as `8934e158`;
new-source native and foundation verification is subscribed. This is a repair
checkpoint, not M06 `verified_for_continuation` or maintainer acceptance.

Android job `120762608084` in run `40056615548`, exact source `6ce6be1a`,
fails with `maestro.android.DeviceServerDiedException` during `viewHierarchy`,
not a failed product assertion. The actual command receipt shows ordinary
Watch/Inspector/Knowledge work, app stop/relaunch, source resume and persisted
`Playback rate · 1.25×` all completed; the next scroll for saved offset was still
running when transport ended. Full device logs show memory-pressure cleanup
earlier and driver-package removal at shutdown; they do not establish why the
connection died. Do not claim that removal caused the initial failure or mark
this run passed. Artifacts are in `hosted-6ce6-android/` and the complete job log
is `run/hosted-6ce6-android-job.log`. New-source verification will retain the
original assertions; no product repair is inferred from this driver failure.

### Real desktop pointer-origin continuation

Run `40056615377`, source `6ce6be1a`, failed at native-smoke line 528 with
`WebDriverError: stale element reference` during the Shift/pointer action sequence.
The test retained a token element handle across asynchronous rendering/input
ticks. Checkpoint `7a7dfa04` targets the same hit-tested token center in viewport
coordinates, preserving actual Shift/pointer actions and the original Inspector
assertion; it adds no retry or delay and changes no application code.
Syntax, LSP and all three driver ownership tests pass. Real native execution in
run `40057789254`, job `120764503613`, source
`7a7dfa0457c4515253f13e9ee44611d4ccc24c85`, now passes. Its first watch ended on
a GitHub API TCP timeout while the job was still running; the rearmed authoritative
completion check confirms success, not another product failure. The exact job log
and native artifact are retained under `run/hosted-7a7d-desktop-job.log` and
`hosted-7a7d-desktop/`.

Native mobile run `40053773772`, source `4b074aea`, passes Android and compiles
iOS; the original iOS primary flow again fails at `id: m01-watch, mp4 is not
visible`, the explicitly deferred FileProvider gate. No diagnostic replay was
launched. The exact JUnit/job log is in `hosted-4b07-ios/` and `run/`.

#### Earlier provider-only run

After the preceding CI-only work, one retained API 35 / Android 15 arm64 emulator
was deliberately cold-booted with 2 GiB guest RAM, two cores, software graphics,
no window/audio and no snapshot load/save. The retained release APK has SHA256
`478078a5cc17292676aa624c40ff02e51081fd63fada54a49c7fb1bca407ce33`.
Its exact build commit was not independently recovered, so this is provider/
persistence evidence for that binary, not latest-source mobile acceptance.
No second device, reference application or local model process was started.

The real image picker imported `tests/fixtures/ocr/vision/horizontal-mixed.png`.
Wi-Fi and mobile data were disabled before the first recognition; Android
reported `Active default network: none` both before inference and after restart.
The protected airplane-mode broadcast was rejected by Android; it is not used
as proof of disconnection. Bundled `ML Kit Japanese` recognized exactly
`Open the blue book. 42` and `日本語の本を読む。`. The real Recognition details
dialog retained provider identity, source-corner percentages and revision 2.
After Home, process stop, launch and reopening the saved source, the unchanged
recognition revision and English line were present without rerunning inference.
Both bounded provider and restart Maestro flows exited 0.

Evidence lives in `.mlearn/m03-m07/m06-ocr/run/`: the
`android-offline-provider.yaml` / `android-offline-restart.yaml` invocations,
`android-provider` / `android-restart` command receipts and captures, plus
`android-recognized.xml`, `android-recognized.png` and
`android-offline-restarted.png`. Captures were inspected directly. The initial
Maestro Home tap did not open the picker; a real touch at the inspected enabled
control did. The recognition toolbar required scrolling its bounded header.
These observations are preserved, not silently counted as flawless automation.
The source used the English package, which explicitly rejects the Japanese
analysis span; native recognition succeeded independently. This does not prove
all five bundled scripts' quality, Japanese annotation integration or iOS OCR.

The app was stopped, test-device networking restored and the emulator shut down.
Its owning session `bash_229` exited 0; subsequent `adb devices` was empty and
no matching QEMU/browser profile process remained. The twenty-minute shutdown
watch was cancelled only after that shutdown. Host memory was 62% free during
OCR; QEMU RSS reached about 4.2 GiB despite the 2 GiB guest cap. After shutdown,
free memory was 84%, swap use 3975 MiB and OmO RSS about 6.7 GiB. OmO growth remains
unexplained; releasing eval references did not resolve it. No further local
device/model runs should overlap this investigation.
The subsequent bounded `vmmap` summary records a 1.4 GiB current physical
footprint and a 12.3 GiB peak, distinct from the approximately 6.7 GiB RSS.
Most resident mapping size is in `App-Specific Tag 1`; WebKit malloc is about
63 MiB resident plus 303.5 MiB swapped. This does not identify the allocator or
prove the earlier growth fixed. The original summary is
`run/omo-memory-after-android.txt`; no heap dump or agent restart was attempted.

### Finite iOS OCR quality and restart verification — 2026-10-24

The retained H00 iOS27 simulator was deliberately booted alone for bounded QA,
with a fifteen-minute shutdown deadline. It uses the compiled simulator app from
source `d8a24bede425f3b8a4b984c92d99e685550af787`, artifact `12540261602`;
subsequent changes do not alter its client, shared UI or Apple provider source.
The ordinary Files picker imported the unchanged 720x300 horizontal mixed image
from the app's dedicated `M06 OCR quality` folder without erasing the profile.

The initial global `scrollUntilVisible: ja` dismissed the language menu before
inference. Two gestures wholly inside the observed menu bounds scroll normally
and select the actual advertised `ja` option. No shared Select repair is justified
by that harness mistake. Real Apple Vision recognition then produced exactly
`Open the blue book. 42` and `日本語の本を読む。`, saved as revision 2 with provider
and original-source corner coordinates.

After inspecting both regions, the app was stopped and relaunched, and the
saved image reopened through Home. Both exact lines, provider and revision 2
persist without another recognition request. The bounded recognition and
contained-navigation restart flows exit 0; their captures were inspected.
An initial Home scroll targeted the image instead of its separate header; that
failed receipt remains preserved. The corrected gesture stays inside the header.
Evidence is under `run/ios-menu-open`, `run/ios-menu-swipe`,
`run/ios-menu-recognize`, `run/ios-vision-restart` and
`run/ios-vision-restart-contained` in the M06 root.

This is online simulator execution, not disconnected iOS or physical-device
evidence. The Simulator shares host networking; no host network setting was
changed and no cosmetic status-bar override is treated as an offline test.
Broader iOS quality, offline execution and full M06 integration remain open.
The real image overlay also opens the shared Japanese Inspector (`日本`, Japan,
native readings and JLPT metadata). The initial expected `日本語` token was a
harness assumption: the actual package analyzes this occurrence as `日本` + `語`.
Its retained accessibility hierarchy identifies the genuine controls and bounds.
Capture saves `日本` through the existing Material owner with its original OCR
context. Return restores the original image and visibly highlights exactly `日本`.
The first return check wrongly requested Watch's `returned-source-selection`
test ID, which Reader does not render; its failing receipt remains preserved.
The follow-up actual-target check exits 0, reopens the same Inspector, finds
Existing Material and reopens the saved `日本` editor without another capture.
Captures in `run/ios-vision-source-touch`, `run/ios-vision-capture` and
`run/ios-vision-return-check` were inspected. This is shared-owner integration
evidence, not a claim that the initial exploratory scripts all passed.

The final flow returned Home with the prior English selection and stopped the
app. H00 was then shut down explicitly; `simctl list devices booted -j` confirms
both retained runtimes have no booted devices. Only afterward were its shutdown
deadline and memory guard cancelled. No Android emulator, local model or
reference application ran alongside it.

An independent `v3 offline iOS OCR` workflow now targets the remaining offline
proof. Its verifier refuses ordinary and self-hosted machines before launching
any tool. Only on a disposable GitHub-hosted Mac, it compiles the actual Apple
provider, creates its own simulator and subscribes to the native network-path
transition before disabling previously enabled host network services. Recognition
starts only after iOS reports `unsatisfied`, without an earlier inference warmup.
It records real horizontal/vertical/glare/spread/empty/PDF/crop observations,
input hashes, executing capabilities and original-source crop coordinates.
Every attempted service change is restoration-owned, including uncertain command
failure; successful completion also awaits iOS's real online transition.
The owned simulator is shut down/deleted and source-bound evidence uploaded.
This does not touch the deferred Files acceptance workflow.

Local preflight passes: the actual simulator executable links without warnings
and `vtool` identifies `IOSSIMULATOR`, SDK27.0; the hosted-only guard regression
and full `npm test` pass (65 tooling and 96 client tests). YAML parsing and Node
syntax checks pass. SourceKit cannot resolve this standalone check's sibling
provider types; aggregate compiler verification supplies that context. Fresh
JavaScript diagnostics time out for the new orchestration file, so no clean
fresh LSP result is claimed there. Hosted offline execution remains pending;
neither this compile nor the guard test certifies offline iOS recognition.
The genuine offline run now passes: workflow `40049009440`, job `120737201485`,
source `67a845c0ec6d55100853fd7ff0024866c73e7efd`, tree
`7345e65ada3becbc90053f422c9680e7151890d8`. It executes arm64 iOS26.5/23F77,
SDK26.5 under Xcode26.6, not this workstation's iOS27 runtime. The native log
records online readiness, actual offline confirmation, completed recognition
and restored networking. During inference, `scutil --nwi` reports no IPv4 or
IPv6 states and both Not Reachable; afterward en0 is Reachable.

All seven real provider cases complete. Horizontal, glare and image-only PDF
preserve both exact English/Japanese lines; vertical text preserves both main
columns and `にほんご`; the shape-only source is genuinely empty. The spread
misreads left `01` as `O1`, an explicit recognition limitation. The selected crop
returns only `RIGHT PAGE 02` with original 1000x450 source dimensions and mapped
right-page geometry. Both providers' exact executing language inventories are
retained; thirty are advertised, but only Japanese/English quality is exercised.
In particular this iOS26.5 inventory does not advertise Hindi or Bengali; macOS
probe support must not be projected onto it. Evidence, binary, input hashes and
environment/source receipts are retained under `hosted-67a8-ios-offline`.
Successful exit also includes network restoration and owned-device deletion.
This is real disconnected iOS provider execution, not an offline app GUI or
physical-device claim; the separate online app flow supplies bridge/persistence
and shared-owner evidence.

### Retained original/native golden comparison

The six original Python-reference inputs and current native report inputs have
equal SHA256 identities. All recognized region texts and ordering match exactly;
source geometry matches exactly except a one-original-pixel shift in the ruby
region and one spread region. The geometric illustration still produces `○口`
in both implementations; it is not a successful no-text rejection.

| Fixture | Original observed ms | Native observed ms | Maximum corner drift |
|---|---:|---:|---:|
| vertical-ruby.png | 25413 | 3806 | 1 px |
| horizontal-mixed.png | 9527 | 1981 | 0 px |
| low-contrast-glare.png | 9489 | 1880 | 0 px |
| spread.png | 10413 | 3318 | 1 px |
| spread-right-crop.png | 8871 | 720 | 0 px |
| no-text.png | 9113 | 670 | 0 px |

Sources are `desktop-unit-qa/desktop-ocr-results.json` and
`native-onnx-qa-current/desktop-ocr-results.json` beneath the existing M06 root.
These are retained consuming-owner observations, not a controlled speedup
claim: initialization/provider conditions differ. No Python process or new
inference run was used for this six-case comparison.

The retained 1909 Tokyo Puck scan was separately reduced into an explicitly
owned input, not silently resized by the product: 2800×4032 pixels, 3954711
bytes, SHA256
`be22a4b22f5b3af996c8b7590cb8f539507958b7e2c650c530a6bf6da42ae108`.
Its unmodified 3982×5734 original remains retained. The exact admitted-input crop
`[470,780,80,970]` was recognized sequentially by the native CPU recognizer and
the pinned original CPU MangaOCR adapter, both with one framework thread.
The original weights and adapter were checked against their retained SHA256
pins before loading. Offline flags disabled downloads; the reference script
stays under ignored `run/native-corpus`, outside every product execution path.

Both produced identical raw text and all 25 token IDs. Direct visual inspection
shows the historic caption is poorly transcribed in both; this is a shared model
limitation, not a newly introduced native mismatch or an accuracy success.
The native model initialization was 391.59 ms and encoder/decoder work was
1135.91 ms; original initialization including its constructor warmup was
426.02 ms and measured crop recognition was 237.17 ms. Native steady crop
recognition is slower in this CPU sample. Complete process wall times were
3.01 / 4.63 seconds, with maximum RSS 628834304 / 943095808 bytes respectively.
Different import/warmup contracts prohibit claiming a controlled speedup from
these wall times. No GPU, device or concurrent model process was used.

Exact outputs, token IDs, pins, resource receipts, the comparison script and
preview/caption captures live under `run/native-corpus`. Native verifier SHA256:
`0b3d51928548ee61c1a049a4d6851cf85990a324ff3ad7be95ebc5d2945ad7d6`.
Both successful processes exited 0. Two earlier CLI invocations were rejected
before inference because the model directory/absolute-path admission was wrong;
their failure receipts are retained and no admission rule was relaxed.
Final consuming-UI and platform acceptance remains separate.

### Crash recovery and resource constraints

The current task is M06 OCR followed by M07, not the obsolete visual-parity
objective still stored in the goal service. M03–M05 must not be repeated.
The maintainer reported a watchdog panic with OmO around 13 GiB RSS, QEMU
around 12 GiB RSS, 21 swapfiles and compressor exhaustion. No devices,
reference applications or test servers may restart automatically on resume.
Use serial local work, one Cargo job, bounded diagnostics and targeted device
runs with shutdown; prefer GitHub Actions for broad native verification.
This does not weaken any functional or architectural gate.

Recovery stopped restored monitors `mon_MH4AFEHHYT9JZNDX`,
`mon_M31W23XKAN1P7HRY` and `mon_CYDW6ED4CE8FW60M`.
The Android launcher `mon_HFQ4QSM9DMKNB59M` was already absent; no Android
QEMU was running. Owned desktop dev session `bash_101` was terminated.
The isolated reference Electron orphan PID 7942 was identified by its retained
QA profile and terminated; the owned H00 simulator
`2C4A73B3-435F-4CD0-86E4-09F549DC3B4F` was shut down without erasure.
Unrelated processes, all workspaces, profiles and artifacts were preserved.

The bounded memory audit measured 67% system-wide free memory and 4,455 MiB
swap use. OmO's `vmmap` footprint was about 2.0 GiB with a 6.6 GiB peak,
while `ps` reported about 4.7 GiB RSS. The eval heap was only about 7.5 MB
before GC and 3.7 MB afterward; GC did not materially reduce the footprint.
The larger native/other-context allocation remains unexplained; do not treat
the small eval heap or green pressure as proof that the earlier growth is fixed.
No heap dump, session reset, broad model load or emulator restart was performed.
After owned QA cleanup, free memory increased to 76% and swap use fell to
3,021 MiB; no matching emulator, reference-profile, dev-server or OCR-probe
process remained. A further bounded map showed WebKit malloc at about 185 MiB
resident plus 181 MiB swapped, which does not explain the whole footprint.

Recovered terminal evidence proves the native M06 run completed **exit 0**:
`mon_B4VJ0F74M905AH13` reported authenticated installation, all six image
cases, cancellation/display/restart and `DESKTOP_OCR_VERIFIED`.
Its existing `native-onnx-qa/desktop-ocr-results.json` is 48,288 bytes and
records native profile `org.mlearn.paddle-manga.onnx.v1`, immutable restart
persistence and a successful real model test. Do not rerun this completed
workflow because the session's final receipt was interrupted.
Case latencies were 2,673 / 1,975 / 1,883 / 3,267 / 716 / 649 ms.
The executor revision was
`e5bf5ba78cbabc7ec88d995715b0b5d7ae994e782830aeb39346a6faac4573f4`;
resource profile revision was
`2b91a213cc5cc8feaf61b7465f425a72d7344ade1794eb55821a409a3cda8299`.
These are actual native-owner workflows, not consuming GUI/device acceptance.
Current implementation also passed 37 native worker tests, six host OCR tests
and scoped strict Clippy before the restart. CoreML traces contain executed
CoreML nodes, beyond provider registration alone. Earlier evidence below is
historical where it predates these results.

Recovery is complete. The maintainer also reiterated that MangaOCR is exclusive
to the Japanese package; generic OCR for other packages must not use it as a
fallback or introduce language-code dispatch in core.

### Generic native OCR continuation — 2026-10-23

The English package now independently selects `org.mlearn.paddle-ctc.onnx.v1`
and declares its own profile/geometry/recognition stages. Only Japanese selects
MangaOCR. Shared Rust inference dispatches authenticated executor contracts, not
language codes; neither recognizer falls back to the other.
Generic inference uses pinned RapidOCR 3.9.2 PP-OCRv6 small ONNX detector and
CTC recognizer, with their distinct RGB normalization, global resize/padding,
DB thresholds/dilation, cubic perspective crops, tall-line rotation, embedded
18,710-class alphabet and blank/repeat decoding. English owns line ordering
and preserves raw whitespace; stored confidence is actual CTC confidence.
Raw empty/low-confidence observations remain evidence rather than silently
disappearing under Rapid's presentation filter. Selected crops bypass detection.
Authenticated model-envelope admission now rejects a catalog/executor mismatch;
the new regression failed before the repair and passes afterward.
The local development publisher preserves both authenticated native profiles
and rejects a tampered existing catalog.

Serial checks passed: 47 native OCR tests, strict native-crate Clippy,
three English OCR tests, 11 native resource tests and the publisher test.
The exact consuming native probe built successfully. Existing Sudachi dependency
warnings remain unchanged. No device or reference application was launched.
The one-shot generic owner run completed exit 0, including authenticated install,
six images, source crop/display, image-only PDF, genuine cancellation with child
reap and immutable persistence across restart. Its temporary loopback catalog
closed afterward; it is not a persistent launcher.
Evidence: `.mlearn/m03-m07/m06-ocr/generic-native-qa/desktop-ocr-results.json`.
The real English line was `Open the blue book. 42`, confidence `0.99973`;
PDF recognition returned two regions. Package-supported language remains English,
not an invented claim that all of the multilingual model's scripts are supported.
Executor revision:
`401684fba3444c04a642bb245e3081d56d5835521cd286b8182a5c56fe66a12c`;
authenticated resource revision:
`657f0e030892e9cc3587af834e7f5b24b0c8c0fd1c1425eb844a9732d28340a1`.
The command's maximum resident size was 579,747,840 bytes. Swap stayed at
3,005 MiB, system free memory was 66%, and OmO RSS was about 2.63 GiB afterward.
This is bounded headless native-owner verification, not consuming UI or Windows
acceptance, and does not prove the earlier OmO growth fixed.

### Portable PDF and independent native review — 2026-10-23

Non-Apple image/PDF display now uses the same cancellable, deadline-bounded
kill/reap helper owner as PDF preparation for inference. Its Rust process mode
starts before GUI/runtime initialization, requires no optional OCR installation,
and ships pinned Hayro 0.8.0 CPU rendering with offline standard fonts/CMaps.
The renderer's Vello dependency disables default features, including an implicit
thread pool. Admitted PDFs retain the existing 8 MiB encoded / 16 megapixel page
bounds, upright rotation/crop-box coordinates, white background and exact
original-pixel crop semantics. Warned unsupported content is an explicit error,
not a fabricated blank image. This is not a claim of universal PDF compatibility.

The portable helper rendered the actual image-only PDF to a complete 720×300
page, inspected beside its original horizontal fixture: both English and Japanese
lines are present, upright and unclipped. Rotation, crop box, missing/malformed
pages and oversized embedded images have owner tests; two subprocess tests run
the shipped helper and compare cropped PNG pixels exactly.
Evidence: `.mlearn/m03-m07/m06-ocr/run/portable-pdf-page.png`.

One independent read-only native review identified two blockers. Both were
reproduced before repair (each test exited 101), then passed after repair:

- Inline `BI/ID/EI` images bypassed XObject budgeting. Page and reachable Form
  inline images now share the same pre-decode dimension/pixel budget, including
  PDF abbreviated keys. Compressed oversized-inline fixtures protect both
  side-length and pixel bounds. The non-Apple one-shot process additionally
  establishes a 512 MiB OS allocation boundary (Windows job object / Linux data
  limit) before parsing; those platform-specific calls remain subject to hosted
  execution, not certified by macOS tests.
- Dropping alpha exposed invisible RGB values and could erase black text over
  transparent black. One upright-raster owner now composites PNG/WebP/GIF alpha
  onto white before RGB inference/display. Transparent, opaque and partially
  transparent edge values are protected without changing opaque source pixels.

Current serial results: 53 native worker/raster tests, two shipped-helper
subprocess tests, six affected desktop owner tests and strict native-crate Clippy
passed. The coherent JavaScript integration run passed 64 Node checks, 96
TypeScript/client tests, typecheck, ownership lint and generated-contract checks.
The full native consuming probe built. Updated **both-profile** owner workflows
completed exit 0 against executor
`cc3813baeb9010a7ea223fd3fb28ca93fe8039521b925195868767933b7c19ba`.
Each exercised all six fixtures, original-pixel crop/display, image-only PDF,
cancellation with child reap, explicit white-page empty detection, and immutable
restart persistence. The new Rust-only fixture checker also proved the magnifier
is an exact 375×250 crop. Reports are
`.mlearn/m03-m07/m06-ocr/generic-native-qa-current/desktop-ocr-results.json`
and `.mlearn/m03-m07/m06-ocr/native-onnx-qa-current/desktop-ocr-results.json`;
older reports remain preserved. Resource revisions are unchanged from the
per-profile records above. Command peaks were 582,877,184 bytes (generic) and
878,493,696 bytes (tuned Japanese). Final OmO RSS was about 1.12 GiB; swap stayed
at 2,989 MiB and free memory 62%.

The Manga path still reads the geometric `no-text.png` fixture as `○口`, exactly
as the retained Python reference report does; its English fixture errors also
remain reference behavior, not a generic-recognizer substitution. Do not turn
pipeline parity or a passing workflow into a claim of perfect no-text rejection
or completed real-manga corpus quality. The explicit blank white page produces
zero regions in both providers.
No device, reference application or persistent server was launched. After the
native build, OmO RSS was about 1.45 GiB, system free memory 62%, swap 2,989 MiB;
the earlier memory-growth cause remains unresolved.

The foundation workflow now includes portable raster tests and a real Windows
generic-CTC owner workflow, using pinned Microsoft ONNX Runtime 1.24.2 DirectML
and DirectML 1.15.4 archives plus pinned RapidOCR models. Resource acquisition is
an explicit hosted QA step; application runtime/installation remain Python-free.
The already-built plugin bundle can be signed under a disposable hosted key
without rebuilding or transporting a private key in an artifact. Windows results
are pending; this addition is not Windows acceptance, and the tuned Japanese
Windows path still needs its own actual execution.

The source checkpoint is committed/pushed as
`ed21b1e00260cd9a33fa6f541c571d9580448241` (tree
`407cffec7349a4e2c0b1b5f34465b9d5ddd1458b`), status `implementing_M06`,
not milestone acceptance. Exact-source runs: foundation `40033573961`, normal
mobile `40033574011`, normal Linux desktop `40033573960`. No FileProvider
diagnostic variant was dispatched.

The first foundation web job `120687492950` failed in `npm test`: authored
ReviewAudio and CaptureList browser tests could not find Playwright Chromium.
The workflow installed the browser only afterward. Logs were retrieved before
repair; the prerequisite step is now moved before `npm test`, preserving all
assertions. Native jobs in that run continue independently. The workflow repair
still needs its hosted result; no local application rebuild is relevant to it.

The same source's Rust job `120687492825` passed, including the portable helper
tests on Linux. The macOS desktop job `120689684088` failed compiling the shared
Apple OCR provider at lines 246/278: Swift could not infer `autoreleasepool`'s
generic result. Exact job logs were retrieved before editing. A fresh unmodified
local typecheck with the actual helper flags passed on Swift 6.4 / Xcode 27,
so local cached output is not the explanation. The leading hypothesis is
toolchain-sensitive result/name-shadow inference; an unavailable Vision API
would instead have produced a member/availability diagnostic, which these logs
do not contain. Both closures now explicitly name `Raster` and `Self.raster`.
Fresh local macOS/iOS compilation and a new hosted build are the verification
gates; the fix is not yet certified by the old failure.

Hosted Japanese verification is also being connected, not substituted by the
generic Windows run. The exact original detector is reproducible from
`PaddlePaddle/PP-OCRv6_medium_det@8e0f56fb2ef86b461d99cfc7ac5c137738985f61`:
its parameter digest, program and YAML match all three measured retained pins.
A separate hosted offline conversion step uses the original pinned tool versions
and publishes only the Apache-licensed detector plus its provenance/license.
Windows then acquires the exact FP32 Manga encoder/decoder/vocabulary directly,
retains the original tokenizer card's unresolved license declarations, signs its
separate native profile and runs the original six-case/crop/PDF/cancellation/
restart owner verifier. No Python enters Windows runtime/installation or the
recognizer. Model-test reports now include bounded real backend/initialization
metrics so CPU fallback/registration is observable without claiming GPU execution.
These new hosted steps remain unexecuted until the next source push.

### Hosted failures and bounded repairs — 2026-10-23

Foundation `40033573961` completed with the known web prerequisite failure,
the Swift inference failure and a genuine Windows import failure. Windows
compiled the app and passed the portable raster/helper tests; pinned resource
preparation and authenticated generic model installation also succeeded.
Job `120689684129` then returned `Document file operation failed: Access is
denied. (os error 5)` from `import_image_collection`, before OCR inference.
Both image and text/document preparation opened their staging directory as a
regular file to fsync after journal rename. That is not a portable Windows
operation. The shared `write_journal` owner now uses `atomicwrites` 0.4.4:
write-through atomic replacement on Windows and parent-directory fsync on Unix,
not a skipped durability step. All 11 existing document import/recovery/restart
tests and strict runtime Clippy pass locally. The same document suite now runs
before Windows OCR in CI; its Windows result remains pending.

The explicit Swift result/callee repair passed fresh macOS and both arm64 and
x86_64 iOS-simulator typechecks, plus the consuming native probe build. No
simulator was booted. Its hosted-compiler verification is still pending.

The browser prerequisite repair was pushed as
`5317dd52643d6ff17ca407a3b33cd28197c4a651`; run `40034002013` passed `npm test`
and then exposed a clean-host type error in Material's programmatic heading
focus: native `TextProps` does not declare web `tabIndex`. Local nonincremental
typechecking also accepted the old code, so do not assert a diagnosed local-cache
cause. Shared `Text` now explicitly owns the bounded web-only focus prop and
does not forward it to native Text. No cast/suppression or feature-local
primitive was added. All 64 Node / 96 client tests, nonincremental typecheck,
ownership lint, one-worker web export and both real Add/Edit keyboard-focus/
exact-trigger-restoration browser tests passed; their temporary server closed.

Both real native owner profiles then passed all six cases, original-pixel crop,
PDF, cancellation/child reap and persistence after the journal change, executor
`8683e158d0f8e1f6c18631cc3f8e04b68d4e30edd2a13acfa14223298c2a0ca2`.
The preceding `cc3813ba` reports were archived beside the current reports.
This run also exercised real automatic CPU fallback: CoreML graph saving
failed, while detector/recognizer initialization stayed at one and both complete
workflows succeeded. Disk had 26 GiB available and plentiful inodes, so disk
exhaustion was not demonstrated; the accelerator-save cause remains unresolved.
Command peaks were 582,942,720 / 881,934,336 bytes; free memory 68%, swap
2,973 MiB and final OmO RSS about 1.51 GiB.

The failure additionally exposed private temporary paths in fallback metrics.
A serialized-metrics regression reproduced that leak (exit 101). Native graph
initialization/execution now retains typed ORT errors until the boundary and
publishes only provider, stage and error code in successful CPU-fallback metrics,
not raw runtime messages. Fatal action errors still reach their initiating
action. The repair passed 54 native tests, both real helper subprocess tests and
strict native-crate Clippy. The exact retained original-pixel crop
`[177,36,41,217]` again returned raw `青 い 本 で す`. That subsequent direct run
registered CoreML successfully for encoder and decoder; it is not a new
node-execution profile or an explanation of the earlier full-worker save
failures. Do not present the earlier full workflow as proof of this later
diagnostic edit. Final memory was 67% free, swap 2,973 MiB and OmO RSS about
1.39 GiB.

The retained full iOS log
`.mlearn/m03-m07/m06-ocr/hosted-ed21-ios/apps/client/ios/build.log`
confirms the same two `autoreleasepool` inference diagnostics at provider lines
246/278 in the consuming Pods build under Xcode 26.6. The console's final
150 lines had omitted them; no extra iOS repair was guessed from that truncated
console. The existing explicit `Raster`/`Self.raster` fix targets both actual
desktop and iOS failures.

Normal Linux desktop run `40033573960` timed out after 40 minutes in its initial
APT update/install step, before application build or UI execution. Its last
package progress was the Ubuntu mirror; no product failure was demonstrated.
That infrastructure result remains recorded and is not renamed a native pass.
No cancellation command or FileProvider diagnostic variant was issued.

Android job `120687492845` successfully built the Release APK and verified both
Rust ABIs. Its UI step failed before emulator boot or application execution:
SDK Manager reported `Error on ZipFile unknown archive` while installing
`system-images;android-35;google_apis;x86_64`. No `host-adb-start.log` or Maestro
run log exists because the project script never ran. The retained console is
`.mlearn/m03-m07/m06-ocr/hosted-ed21-android/android-job.log`, with compiled-app
build evidence beside it. This is hosted SDK acquisition failure, not an app or
ADB-ownership diagnosis; no product assertion was weakened. The workflow now
retains the source-bound compiled APK before UI setup, as iOS already does, so a
later SDK/picker failure cannot discard an otherwise useful build. The old run
did not retain that APK; do not claim it remains retrievable from that runner.

Next: finish hosted verification of the source checkpoint and remaining native platform
verification and review. Windows execution, mobile quality/device acceptance,
full manga corpus coverage and model-license discrepancies remain open.

### Earlier M06 incremental evidence

Status: `implementing_M06`. M05 is published as
`620c0fafaf95f8844577e1df1eca7e9c4d905314` on `agent/m01`, with its independent
continuation closeout committed. M03 is published as `fbfb1a59`, M04 as
`f5f350ab62880378c23485552fc5aa306c033eba`. None is maintainer acceptance.

The current desktop M06 requirement is Python-free Rust-owned ONNX inference:
Paddle detection, package-owned vertical regrouping, original-resolution crops
and complete MangaOCR autoregressive recognition. Apple Vision is not a
replacement for tuned Japanese manga OCR. Python is permitted only for offline
reference/conversion, never the application runtime, sidecar, installation
prerequisite or fallback. The earlier packaged-Python desktop unit below is
preserved reference evidence, not a verified native desktop implementation.
Optional pinned, integrity/license-verified resources must not download during
Cargo builds or ordinary tests. macOS CoreML, Windows acceleration and a viable
Linux GPU path require actual capability detection and reliable CPU fallback;
bounded reusable sessions must support cancellation and unloading. Native
quality/performance comparison and real macOS/Windows OCR remain open gates.

Independent Reader review's three reproduced defects are repaired: native
topToBottom and package-derived missing orientation now produce vertical hit
targets; Contents/rail navigation aborts native OCR; original PDF presentation
does not admit hidden document-text analysis. Typecheck, ownership lint,
consuming web export and 27 Reader/Material workflows pass; four vertical
alignment cases pass at desktop/narrow widths, with captures inspected.
The Japanese package passes all five OCR tests. Before/after evidence is in
`qa/{vertical-before,navigation-before,presentation-before,review-repairs,vertical-final}`.

`NATIVE-REFERENCE.md` recovers the exact tuned stages and Python ML inventory;
`NATIVE-CANDIDATES.md` audits all four requested candidates. The native
`crates/desktop-ocr` session owner compiles with ORT rc.10, default downloads
disabled and explicit optional runtime loading. Actual Mayocream FP32 graphs
at `24b12778d85800835e2ca409236de281b8ab7b9f` load through retained native
ORT 1.24.2; both register CoreML, which is not yet proof of accelerated node
execution. Four-beam native CPU recognition of the original-resolution
vertical crop returns the preserved raw golden `日 本 語 を 読 む`.
Its encoder/decode observations are 204.5/271.6 ms, not end-to-end app budgets.
Nineteen beam/preprocessing tests and strict Clippy pass. All four synthetic
color/scale tensors match the original Pillow 12.1.1/ViTImageProcessorPil
bit-for-bit. Native-only signed inventory tests pass 10/10 and reject the
superseded Python executor. Detector conversion/integration, warm worker
lifetime, native app quality and Windows execution remain incomplete.

M06's Rust owner, Vision adapter and bundled Android adapter are implemented.
Their evidence is `.mlearn/m03-m07/m06-ocr/{RUST,VISION,ANDROID}.md`; the shared
wire and integration ownership are in that directory's `PLAN.md`. The original
OCR owner passed 149 tests, scoped Clippy, formatting and generated contracts;
subsequent shared-practice integration has its separate owner evidence below.
Vision's scoped iOS16.4/macOS13 checks and real standalone fixture/geometry/
cancellation checks pass. Root's additive original-pixel display crop also
typechecks for both targets; the Expo module parses. Android's display-admission
regression failed before repair: a running SDK task blocked source navigation.
Independent bounded display/inference gates and two bounded execution lanes now
pass all ten geometry/lifetime tests. These are not consuming-app or offline-device
acceptance.

Typed OCR clients, native host adapters and the first real image Reader are
connected. Original pixels cross the DOM boundary once per visible source,
separately from bounded token/Knowledge updates. Ordinary document and image
words share one native/DOM anchor lifetime owner and the existing Inspector/
Capture path. Fit/spread/direction controls, original-page progress, cached
recognition, provider selection and explicit crop input are wired. Source-pixel
magnification has hold/release/wheel and a touch toggle; publisher readings can
be concealed without removing source data. Source words reuse CaptureList for
eligibility/exclusion, capture and saved-Material navigation, and the existing
Inspector for native Knowledge. Locate highlights the exact original token.
`ImageSourceWords` owns bounded view filtering/pagination only; Rust remains
authoritative. Knowledge refresh retains useful source hit targets while pending.

Root's twelve Reader browser workflows pass at desktop/narrow widths; the latest
compact source-word row also passes both affected layout workflows and was
visually inspected at both widths. They substitute native IPC and do not prove
recognition quality or native persistence. Typecheck and ownership lint pass.
Earlier scoped checks passed 37 architecture and nine client regressions.
Evidence is under `.mlearn/m03-m07/m06-ocr/qa/`, including
`source-word-sidebar-final/` and `source-word-density/`. A reproduced shared
Inspector contrast failure over white pixels is repaired in its shared material
role. A subsequent source-locate capture exposed white selection material washing
out actual glyphs; DocumentViewport and ImageViewport now use the same translucent
source-selection role instead of the selected-button material. Before/after
captures preserve readable original pixels. The current complete Node run passes
62 checker tests and 94 client/theme tests, including the shared theme regressions.

The shared encounter owner now has explicit finite selected Word Practice,
distinct from scheduled Review, with purpose-qualified evidence and frozen
Source Return. Its owner verification is in `PRACTICE.md`. Root's actual Reader
entry now freezes source-selected membership, retries identical uncertain
admission and opens the returned shared encounter. Typecheck/lint/build and
23 Reader/Material workflows pass; the source-to-practice capture was inspected.
Recognition details now edits real text/corner coordinates through the native
revision-checked correction command, preserves uncertain retry identity, loads
current saved recognition explicitly, and displays immutable raw/parent evidence.
Desktop/narrow workflows verify those effects without recopying original pixels.
The first strengthened post-correction readiness run failed on both sizes:
old shared-anchor passive cleanup erased the newly rendered identity before the
child's ready publication. The shared lifetime owner now invalidates only its
own identity; the complete 25-workflow Reader/Material rerun passes, with
typecheck/lint/build also passing. Before/after evidence is in
`qa/readiness-before-fix/` and `qa/readiness-after-fix/`. Genuine native consuming
workflows and final continuation review remain incomplete.

Actual crop/provider tests exposed a shared Select portal below its owning
Dialog: the dialog's body intercepted option clicks. Select now mounts its web
portal in the owning dialog's stacking/focus scope; native portal behavior is
unchanged. The CaptureList test presentation adapter was extended for its real
InlineWord consumer and dynamic Unistyles roles without weakening retry checks.
The crop/navigation boundary tests now pass. The first navigation fixture
incorrectly returned a window beginning at page 1 for a requested page 2; it now
honors the actual typed native window contract instead of bypassing validation.

Native OCR recovery had a genuine terminal-identity mismatch: adapters cancel
failed SDK jobs, while UI retry reused their forbidden cancelled IDs; a lost
committed receipt could also rerun inference. A bounded Rust-owned `ocr_recovery`
read now distinguishes unknown/pending/cancelled/completed by the original
request. Completed recovery returns its immutable committed revision, not later
corrections. Explicit retry uses a fresh action only after native cancellation
is confirmed; uncertain pending work retains identity. Both regressions fail
on pre-recovery consuming bytes and pass after repair. Evidence:
`qa/retry-before-fix/`, `qa/retry-after-fix/`. Final root checks pass 29
Reader/Material workflows, 14 real-SQLite OCR tests, 39 runtime unit and 11
document workflows, strict core/storage/runtime library Clippy and contract
freshness. No native recognition-quality claim comes from browser IPC fixtures.

On 2026-10-23 the maintainer clarified that there is no separately required OCR
text mirror: the approved behavior is interactive OCR text aligned over the
original image, source-coordinate alignment, crop recognition, annotation
controls and an independent source-image magnifier/zoom. OCR-04, PLAN and
REFERENCE now reflect that correction without dropping those functions.
The obsolete mirror task/reference blocker is retired. `MIRROR.md` preserves
the actual overlay/annotation/lens source evidence with its former blocker
explicitly superseded. Continue M06 through its remaining implementation and
native verification gates; there is no external-reference blocker here.
Desktop's retained Paddle/MangaOCR path and authenticated installable v3 provider
now have verified unit handback in `DESKTOP-IMPLEMENTATION.md`. It reuses the
signed catalog/resource-transfer owner, real pinned detection/recognition,
package-owned geometry/reading/context interpretation and a separate display
lane. Real image/PDF/crop, cancellation/reaping and offline fresh-process restore
pass. Standalone first-action latency (25.4s), restore validation (13.5s) and
peak neural RSS (about 1.73GB) remain integration observations, not app budgets
or acceptance. Root still owns model-management UI, actual consuming workflows
and platform quality. System Vision must not silently replace this provider.

Current iOS Rust/mobile bindings and both simulator architectures are prepared
successfully, retaining existing build outputs. UniFFI emits its existing
old-style-config warning; it was not suppressed. Consuming Release build
`mon_A2K9SKW9D5RMAF9F` / `bash_48` is active after successful retained Pod
installation. The existing H00 iOS27 simulator
`2C4A73B3-435F-4CD0-86E4-09F549DC3B4F` is booted, not recreated.
Android retained AVDs include `mlearn-h00-api35-20261016`; none was booted by
this step. Source `.mlearn/preflight/env.sh` in each shell: the first device probe
without that environment could not locate adb; the documented-path probe passed.

Effective Rust/Android/reference-lane routing was subscription GPT6.1 Sol,
medium. The Vision completion receipt reports subscription GPT6.1 Sol Fast
fallback; preserve that distinction from its earlier selected-route note.
The host restarted during integration. Reuse retained source/build/evidence and
restored owned reference/emulator monitors; do not infer device readiness or
repeat completed M05 gates. Current root scratch/cache lives under
`.mlearn/m03-m07/m06-ocr/run/`.

### Published M05 verification record

M04 source and its M01–M04 architecture repairs are independently approved and
verified for continuation. M05 was published only after its continuation checks.
M04 publication `f5f350ab62880378c23485552fc5aa306c033eba` is now pushed.
M05 is independently verified for continuation, not maintainer-accepted.
The real bounded TXT/EPUB parser
and paged PDF Wasm guest are integrated into the root workspace and lock.
The normal workspace guest is 1,873,755 bytes with SHA256
`c432e917c4ea1a42a57ff6c799b6b35448db2e9a114316884263c4312d7387a1`.
The earlier standalone verification produced hash
`454e421213de1f9c6d39c731da73e0dfa86d6f67d152c801cc289f3f0f5f4418`;
the normal artifact was reproduced and its 29 parser tests rerun successfully.
Root parser tests pass 30/30; the reproduced Fresh fuel-slicing regression and
existing deterministic execution-cancellation test pass 2/2. Startup/ABI fuel
is deducted before granting the remaining 32M allowance in 1M resumable slices.
The production-only ZIP check exposed a missing compression backend hidden by
test dependency unification; selecting zip's explicit pure-Rust zlib backend
fixes the actual runtime compilation. Document storage tests pass 13/13.

Root now owns asynchronous document admission, immutable source/image
publication, a bounded crash-recovery journal, revision-bound return anchors,
and shared analysis/Knowledge integration. Authored `horizontal-tb`,
`vertical-rl` and `vertical-lr` are distinct from user appearance choices.
Image alternative text is not linguistically analyzed. Real EPUB import,
partial ruby, image bytes, duplicate passage restoration, profile relocation
and Material return tests pass; PDF import preserves all three original pages
including the text-unavailable page. Its first analysis regression exposed
unnecessary all-capability Knowledge expansion on a short real page. The shared
owner now requests only the annotation capability. The connected parser/runtime
run passes all suites, including 27 runtime library tests and seven real document
integration tests; cancellation/recovery and unchanged-language cache reuse pass.
The real desktop application has imported EPUB and TXT through its native
picker, displayed authored partial ruby/mixed writing modes and original image
bytes, captured Tokyo through the shared Inspector, opened the saved Material,
and returned to the exact seed block at byte 5. Rendered overlap, disabled
within-window navigation, default-serif image captions and a surviving Inspector
portal were reproduced and repaired in their responsible owners. The old export
fails the portal regression; the repaired export passes all four Reader browser
tests, including a genuine bounded PNG thumbnail and unmounted hidden document.
Typecheck, ownership lint, contract generation, all 30 web workflows, 59 checker
tests and 80 client tests pass. Both consuming native builds pass on retained
arm64 simulator/emulator targets. They are not final-source native acceptance:
the first iOS build exceeded its watcher deadline during dependency compilation;
the retained arm64 continuation completed. Current Rust/UI repairs are being
rebuilt into both candidates without recreating environments.
The real English-selected mixed-language TXT exposed a separate analysis failure:
one unsupported neighboring paragraph rejects the visible supported paragraph.
Its connected regression failed first, then passed after limiting document
admission to the visible stable source passage. Unsupported selected-language
text still returns an explicit error rather than invented targets.
The independent backend audit reproduced four further defects: torn journal
startup failure, dropped container/inline contents anchors, unrelated navigation
links aborting import, and a duplicate import returning the previous language.
Atomic journal publication and legacy interrupted-write cleanup, exact UTF-8
authored-anchor mappings, contents-only link extraction/local-fragment resolution
and the existing explicit-language mutation owner repair these findings. Their
connected parser/runtime regressions pass. This audit is not the final M05 gate.
Real desktop PDF import and original graphics-only page navigation work without
inventing text or running OCR. The real Android import's permission-denied
failure was isolated to hard-link publication and repaired with atomic no-replace
rename. The actual PDF import/navigation/restart workflow passed, with its first,
empty original second and final third pages inspected directly. Preserve the
earlier red operation-specific runs.
The initial local iOS EPUB flow passed footer/resume assertions, but direct image
inspection exposed a blank document surface. That run is not rendering acceptance.
The shipped native DOM bundle reproduced an eager Unistyles theme-registry error
in an isolated browser. Shared inline activation/focus/hover now has one theme-free
DOM element owner used by both themed controls and the document entry; source
reading segmentation also has one pure owner. The repaired shipped bundle renders
the authored ruby with no boot errors and correct viewport geometry. A new boundary
regression rejects eager themed imports; 60 checker tests, 80 client tests and all
30 web workflows pass after extraction. Direct retained-device iOS QA selected
the real EPUB in Files and verified native source text, authored ruby, original
SVG image, Japanese analysis, Inspector capture, saved Material and highlighted
Return to source. Changing to vertical/serif/26 and restarting preserved the
seed passage and those appearance values. The final installed iOS candidate
also passes manual Inspector/Open saved/Return with the old document unmounted.
The iOS Maestro import attempt remains red at Files selection; manual selection
dismisses the same picker successfully. Its stronger content assertions remain
intact. This is not a passing hosted FileProvider gate.
The operation-specific Android red capture identifies `hard_link` publication,
not picker access or parsing, as the permission-denied operation. Android now
uses atomic no-replace rename through Rustix; other platforms retain hard links.
The root checks and all seven document tests pass. The document capture regression
also admits the captured passage to real Review and returns its frozen original
anchor and duplicate-passage byte offset through `return_review_source`.
Both final consuming Release arm64 builds pass. Typecheck, ownership lint and
all four Reader web workflows pass after the final blur lifecycle adjustment.
The repeated Android flow exposed two test preconditions, not import regressions:
duplicate import correctly restores its saved third page, and Home can retain a
scrolled position. The flow now explicitly navigates to the first original page
and locates the import entry from the upper Home section. The final consuming
candidate passes that complete flow 1/1 in 55 seconds
(`android-final-navigation-junit.xml`); its original first page and restarted third
page captures were inspected directly. The original H00 Device Hub selection is
restored without sending any input to that device.
Hosted FileProvider diagnostics remain deferred.
Disk pressure reached 2.8 GiB free. Only the obsolete task-owned
`m04-shared/target` cache was released after verifying it was a separate directory
unused by running work; free space returned to 16 GiB. Its source/evidence,
root Cargo/native outputs, profiles and retained devices remain intact.
Desktop continuity QA added `continuity.txt`, using the same Children target as
the Watch fixture. Its original Meaning claim was known; QA changed it to unknown
in Reader, observed claimed unknown in Watch, restored known there, and observed
claimed known back in Reader. The original claim is restored.
Native artifacts are under `.mlearn/m03-m07/m05-reader/qa/`: `ios-original-image.png`,
`ios-appearance-settings.png`, `ios-restarted-ruby.png`, `ios-final-inspector.png`,
`ios-final-material.png` and `ios-final-return.png`. Android's first passing run is
`android-rename-junit.xml`; all red runs are retained separately.
The final independent M05 gate rejected frozen source tree
`a0e4ee117cb04a5284a517381848ed9168356223` against M04 using the retained locked
review worktree. Effective route is `chatgpt-subscription/gpt-6.1-sol`, not a paid
or premium escalation. Superseded standalone parser prototype sources are removed;
the production parser/tests and original fixture generator remain.
Its sole blocker B1 is a real Review-to-Reader handoff defect: Review returns the
frozen encounter anchor, but Reader then follows `materialId` and re-fetches the
mutable authored association. A new connected Review navigation regression
reproduced the failure after that association was cleared. Review now routes its
session/encounter identity; Reader and the existing Watch consumer resolve that
same frozen source. Ordinary Material Return keeps its separate current-source
semantics. The repaired export passes all 31 web workflows, typecheck, ownership
lint and strict typing of the new test fixture. The actual desktop saved Review
also returns to its video at 11.2 seconds with the original selected token; capture
is `desktop-review-frozen-video-return.png`. Both repaired consuming native builds
pass. A bounded independent B1 closeout and affected native smoke run remain open.
The first repaired iOS resume smoke passed footer/appearance assertions but its
source screenshot preceded DOM layout and was blank. It is not body-rendering
acceptance. `DocumentViewport` now exposes busy/loading until the existing DOM
visible-block callback confirms actual source layout; native checks wait for that
event-derived ready surface before capture. The five Reader web workflows,
typecheck and ownership lint pass with this signal. Android's renewed test missed
the import action with a full-screen fling; waiting for the enabled language-bound
action and bounded body-only gestures passes the complete flow in 54 seconds.
Both final readiness-aware native candidates now build, install and pass their
local checks: iOS saved EPUB/reflow resume 1/1 in 19 seconds, Android actual PDF
picker, all original pages and restart 1/1 in 52 seconds. The Android flow waits
for actual DOM readiness after every page transition and restart. Final iOS
source/ruby/serif/26 and Android first/empty/restarted source images were inspected
directly under `qa/ios-render-ready/` and `qa/android-ready-navigation/`.
The final iOS main bundle SHA256 is
`5227fc3167350ddc7c02aa783344fee2800467206569c6c3f232add43f84303d`;
the installed Android APK SHA256 is
`e16f2ccf36f7ca613c069e8514ea1b84ae50b4ed9fac59fc0da4eb419c263af4`.
Application code matches the B1-closeout tree
`fc0a51fb23b0f0142a26339ea913c8942f5ba5ad`; subsequent changes only strengthen
native test readiness assertions and update this record. All prior red captures
remain retained rather than relabeled. H00 remains selected and untouched.
Independent closeout now approves final reviewed tree
`72d34083dedcb02d8d09666165850dc65748dde1` with no remaining blocker.
`.omo/evidence/m05-reader-gate-review.md` preserves the original B1 rejection,
its independently reproduced repair, and inspected final native captures.
Local native verification and continuation review are complete; no final
visual-parity, hosted Files acceptance or maintainer acceptance is claimed.
Publish M05 before M06;
preserve the deferred hosted iOS gate below. Parser/storage lane evidence is retained under
`/var/folders/f2/d3_jzj917kg6sqsc9tgc80200000gn/T/tmp.zHcXwfdacR`.

The existing hosted iOS FileProvider acceptance gate
is **deferred by the maintainer, not passed**. It does not block M03–M07.
Stop its investigation and launch no further diagnostic workflow variants.
No verified application fix for the hosted Files-to-URL failure has
been found; the underlying platform cause remains unresolved. Do not mark the
hosted acceptance green or claim release readiness. Earlier pre-M03 halt and
verification-environment-decision conditions are superseded by this explicit
decision, not by diagnostic success. The maintainer subsequently authorized a
90-minute high-capacity window (up to32 useful concurrent lanes), followed by
continued autonomous execution. M04 implementation is isolated from the M03
candidate; milestone integration order and the architecture gate remain binding.

Authorization checkpoint `4fdae38a` is pushed on `agent/m01`. M03 application,
protocol, storage, runtime and native-media changes form the verified milestone
checkpoint. Local owner/application verification passes with the platform limits
recorded below. Independent blocker closeout `st_01a16547` returned `APPROVE`;
the16 scoped repair/test blobs match preserved tree
`080ea0dcfe45a8194735affb89dbfcaa3ef085dc`. This is continuation permission, not
maintainer acceptance. The retained `4a7927a0`/`06f1d1c3` binary and platform evidence
below establish the earlier integration baseline only.

### M03 independent review repairs — current continuation

The independent review returned `REVISE`, identifying forged provenance on reused
attachments and native staging/output that could exceed128MiB. The runtime now
validates introduced or changed reused references against authoritative source
and catalog metadata, while preserving unchanged historical references and
receipt-first replay. Its real-storage regression failed before the repair and
passes afterward; all seven affected runtime Material/source tests and library
Clippy pass.

Apple, Android and desktop producer/import owners now bound admission/copying,
reject oversized final output and clean partial resources before subsequent
success. Their owner probes pass; the probes' simulated Android media boundaries
do not certify native muxer execution. The native host selects without Expo's
unbounded cache copy, then uses the bounded `importPickedMedia` method on both
mobile platforms. Fresh Rust FFI preparation and consuming iOS/Android Release
builds pass. Final changed-source native workflows pass on both retained devices.

Capture retains stable command identities across whole-call uncertain failure.
Material opening/source-return recovery is action-local, and editor heading
focus restores to the exact initiating control. Actual desktop focus handoff
and restoration pass. A genuine missing-file preview fails explicitly; restoring
the owned QA image and pressing Preview once in the same editor decodes it.
The original SHA256 is unchanged. Final client/harness tests (56+47), typecheck,
ownership lint, contracts, web export and17 browser interactions pass.

The refreshed iOS source flow saved/restored all media and exercised native
controls, then failed because its final test still scrolled DOWN after the
editor's Return action moved beside its heading. Exact pixels/hierarchy justify
changing that scroll to UP, without weakening return assertions. A separate
SpringBoard `EXC_BAD_ACCESS` report is preserved; no app-causality claim is made.
The refreshed Android flow failed scrolling to Capture frame. A retained
single-scroll reproduction finds the exact control100% visible and moving with
gestures, but centering exceeds20s. Actual hierarchy latency reached11.8s on a
host with13.9GiB swap used; the initial Resume scroll similarly expired while
the final image showed the real button. These two bounded visibility deadlines
are now60s, with no sleeps, retries or weaker assertions. The subsequent Android
flow saves frame and audio, then exposes a real video regression: the bounded
preflight's second seek rejects the unchanged source as changed. Real numeric
reproduction proves original request15000000us selects14500000us, while
re-seeking that derived timestamp selects14461333us. The second seek now replays
the original request, retaining the equality, size and cancellation guards;
temporary instrumentation is removed. The rebuilt consuming app passes the
same focused video reproduction in42s; native size/cleanup owner probes also
pass after the repair. Final full Android and iOS media workflows pass in161s
and175s respectively. All3 Android and5 iOS captures were inspected: authored
media survives restart, iOS native audio/video controls work, and Return restores
the original source selection and time. The original real source-media flow is
the tracked regression. Earlier failures remain recorded as failures.
Focused independent review closeout is approved with no remaining blockers.
Report: `.omo/evidence/m03-blocker-closeout-gate-review.md`. Publication is complete;
the remote confirms `fbfb1a59cbee3173d95ff9e06bbc6c336fc5e7c8`.
The completed private M04 implementation is now adopted into the main workspace.

On October22 the maintainer ordered immediate checkpoint/closeout,
targeted blocker regressions only, and integration of existing M04 work rather
than another verification or generation campaign. The prepared extra bounded
picker GUI scenarios are **unrun/incomplete**; owner-level byte/cleanup probes
and consuming native builds are verified. Windows/Linux consuming builds and
the local ffmpeg codec smoke remain **unverified**. The hosted iOS FileProvider
failure remains **deferred/red**. None is relabeled as a pass. Preserve these
limits and proceed after genuine blocking findings are closed; cosmetic work
and additional broad review/verification do not hold this checkpoint.

The final native core/storage/runtime regressions and library Clippy pass,
followed by21 desktop tests passing and one explicitly unrun local ffmpeg codec
smoke. A real desktop missing-source failure also recovers through its adjacent
Retry returning to source action to the original frame at0.0s. The temporarily
held owned source is restored; no learner content was changed.

The same-editor preview regression now also has explicit toggle proof: both
desktop and narrow browser cases fail on an isolated original-behavior export
and pass on the fixed export, with authored draft fields preserved. Production
source was restored immediately after capturing the isolated red bundle;
typecheck and whitespace checks pass.

M04's frozen Review protocol/policy and shared roles were recovered into the
parent-owned private `m04-shared` workspace. Seven disjoint package, storage,
runtime, typed-client, UI, media and integration owners completed source and
coherent checks there, never in the M03 candidate. The full relevant Rust
workspace and contracts,56 checker tests,76 client tests,18 Material browser
cases,20 Review browser cases and8 adjacent browser cases pass. These are private
implementation results, not native workflow verification or independent
acceptance. Parent adoption validated64 source-manifest hashes, imported the
existing77 implementation/test paths, generated contracts from the adopted Rust
authority and merged the two Material fixture/test additions without losing
M03 preview recovery. Main typecheck, ownership lint, contracts and targeted
regressions pass:36 Rust cases,41 client/media/input cases,20 Review browser
cases and20 merged Material browser cases. The completed team is retired; no
M04 implementation was regenerated.

Both retained consuming native apps build and install from the adopted source.
The new finite Review workflow passes on Android in84s and iOS in66s: real
Material creation,1/1 completion, Undo to0/1, pause/process restart, exact saved
session resume and correction back to1/1 rather than2/1. All6 captures were
inspected. The earlier iOS failure is preserved: its label selector left the
limit unchanged; selecting the actual numeric input fixes only the test, without
weakening an assertion or changing/rebuilding the app.

Normal desktop startup uses the retained v3dev profile. Actual authenticated
package updates enable the new tasks without deleting data. A finite3 session
demonstrates durable Reveal, shortcut3, Undo/correction, process restart and the
same saved-session ID. Source return restores the Japanese selection at11.2s;
the shared annotated word shows native `assessed unknown` after Struggled.

A real3.4s clip captured from that source is explicitly bound through Material
and persisted. Normal continuous Review reaches its listening encounter after
existing due work. The user-initiated player commits native `delivery: completed`,
enables Reveal, and presents Listening recognition/Meaning targets. Pausing
preserves completed delivery and revealed state. Read-only native aggregates
confirm62 explicit Untested attempts created0 learning observations; no mastery
was fabricated while advancing the retained queue. These verify playback and
data/control flow, not speech quality or comprehension.

Actual captures and native JUnit results are under `.mlearn/m03-m07/m04/`.
The combined independent M04/M01–M04 gate initially returned `REJECT` with two reproduced
blockers: Close Adjust overwrote explicit grades/Untested, and session Pause
caused invalid audio-cleanup writes that disabled Resume. No additional
architecture blocker was established. Report:
`.omo/evidence/m04-foundation-gate-review.md`. Root regressions reproduce both;
repairs preserve drafts independently of expansion and commit nonterminal audio
interruption atomically with native Pause, with cleanup acknowledging that state.
The ready-audio regression also exposed stale pending UI when the saved-session
route renews focus during a write; its flight cleanup now clears current-focus
pending state. The same reviewer approved repaired tree
`21de44758a4f284fe76c23f61f9c0f4b512b3829`, closing both blockers and the directly
exposed pending-state regression. Targeted proof includes18 client/media cases,
11 real-storage Review cases,32 routed browser cases, typecheck, ownership lint
and warning-free storage-library Clippy. Real desktop audio Pause/Resume recovers
without a failed save. A native Untested/Close Adjust/bulk response retains null;
immediate exact Undo retracts that QA attempt. Screenshot:
`desktop-audio-pause-resumed.png` under the milestone evidence directory.
Both repaired consuming iOS/Android builds and installations pass. Their bundles
postdate the final UI repair. Targeted retained-device Review workflows pass on
Android in85.626s and iOS in62.443s, with zero failures. All six final captures were
inspected: completion, paused Undo, process restart/resume and correction remain
usable. Exact JUnit/captures are `android-review-repaired*` and
`ios-review-repaired*`; red/green closeout receipts are under `gate-closeout/`.
No further source-review or native blocker remains before M04 publication and
the M05 source-boundary extension. Native mobile audio-delivery callbacks and
physical-device/hardware-keyboard behavior are not separately certified by the
written native workflow or browser audio tests; this limit remains explicit.
An additive explicit audio-target binding is M04 scope;
historical attachments remain unbound, and source/time/text do not imply binding.
Reader parsing fixtures/prototype, offline macOS Vision measurements, Android
OCR packaging, Messenger ownership and performance prerequisites are prepared,
not delivered M05–M07 milestones. The PDF prototype's aggregate loader-memory
bound and actual iOS/Android OCR quality remain unresolved.

### M03 current implementation and checks

One Rust-owned Material model now has schema-v4 incremental SQLite storage,
bounded reads, exact/distinct capture identity, independent capture exclusions,
CAS edits and metadata-only durable receipts. Source anchors preserve original
source/package/cue/UTF-8 coordinates separately from editable authored content.
Return restores the source language, selection, time, offset and rate; missing
or changed source is explicit without disabling unrelated authored edits.

Authored media uses bounded content-addressed files and transactional
catalog/references, not cache or repeated base64 history. Atomic bounded staging
journals recover interrupted publication on restart while preserving catalogued
and shared authored bytes. Native capture/pick/URI/export adapters exist;
Material media controls and genuine app-level verification are being integrated.
macOS/iOS use shared AVFoundation; Android uses its native media APIs;
Linux/Windows use an actual local ffmpeg provider with explicit unavailable
errors when its executables are absent. Local ffmpeg extraction and those two
platform builds have not been exercised.

The complete core/storage/runtime test run and library Clippy pass locally.
Runtime tests use actual temporary SQLite, byte IO, reopened profiles and
bundled language execution. New regressions caught and repaired startup orphan
recovery, forged linked-sense edits and stale-edit conflict response codes;
each failed without its corresponding repair. Storage frame/manual-sense
regressions and all 12 Material client tests pass. Four bounded source-capture
tests, standalone Node-typed test checking, app typecheck and architecture lint
pass; lint first caught and then verified repair of a private feature import.
Whole-source capture streams existing native pages and six-target dictionary
batches, retains only the failed group for exact retry, and does not equate
Knowledge claims with capture eligibility.

Fresh iOS simulator and Android Release application builds pass. Both retained
devices pass actual manual authoring/restart; iOS also exercises exact-existing
selection. Android's first attempt exposed a readiness test targeting a label
instead of the enabled button; the ready-state reproduction and corrected
semantic-control flow pass without sleeps or weakened assertions.

Normal desktop startup, actual selected-sense capture, preservation of a distinct
draft and staged frame, image import/export, captured frame/audio/video playback
and exact source return pass. A real whole-source Japanese capture and its
idempotent post-restart repeat show existing Material with no duplicate writes.
The new desktop helper originally caused a development rebuild loop; caching
actual compiler inputs and publishing only changed bytes repairs normal startup.
Desktop library tests pass18, with the local ffmpeg codec smoke explicitly
unrun because its executables are absent. Windows/Linux consuming builds remain
unverified.

Android's real source-media flow saves a frame but initially rejects the
end-of-source audio origin. The error and retry controls were below the scroll
fold, not a hung command. Canonical duration is30000ms; the retained produced
audio decodes to14973.3ms. Microsecond duration arithmetic alone did not repair
the actual muxed overrun: production tracing measured end30035ms against the
canonical30000ms. Explicit empty EOS samples now bound the final muxed sample
duration. The real Android flow subsequently saved frame, audio and video;
measured produced endpoints are30000ms for both clips. The full capture,
restart, protected preview and exact-source-return flow passes in139s on Android
and131s on retained iOS26. Repeated-phrase selection, a search-field label
mistaken for the submit action, keyboard obstruction and edge-of-scroll tapping
were repaired in the new regression without relaxing its media assertions.
It now authors a unique phrase marker, searches through the actual semantic
submit button, verifies the restored phrase and scrolls to each attachment.
Strict source validation remains unchanged. Temporary root debugging was confined to the owned emulator,
probe files were removed and ordinary shell privileges restored.

A real no-subtitle desktop source also captures, saves and decodes a frame,
then returns from the saved source-scoped list at0.0s without a fake cue.
This exposed an empty returned-selection label; the shared Watch presentation
now names the returned frame time. Its actual fixed native capture is
`desktop-no-subtitle-return-fixed.png`. Final native bundles build successfully;
source flows pass148s on Android and129s on iOS. The combined monitor first
expired during iOS after its successful build; the interrupted flow was rerun
separately with an explicit deadline, not counted as passed.

Actual native Android audio/video play and pause also pass, with decoded frames
and advancing playback inspected. The initial probe incorrectly waited past
the native controls' lifetime; it now uses the existing Watch helper's immediate
control observation. iOS's compact 64-point audio preview hid AVKit's controls.
The existing player owner now reserves 200 points on iOS, preserving its native
play, pause, seek and fullscreen controls. Real audio and video both pass
Play → Pause → Play on the retained iOS device; decoded video and advancing
time are inspected in `ios-direct-{audio,video}-{playing,paused}.png`.
The focused probe uses the installed XCTest driver's native input and
accessibility states, avoiding the CLI screenshot-settling race with AVKit's
auto-hide. Its platform guard confirms the actual retained simulator identity.
Earlier incorrectly bound direct probes selected Android and provide no iOS
evidence.

The source regression now also requires restored iOS audio/video controls to
seek forward to 10 seconds and back to zero while paused. Its first integration
attempt exposed a test scroll target clipped beneath the fixed header, despite
Maestro reporting it visible; the regression now anchors the real Preview
button rather than scrolling the AVKit accessibility frame. The focused seek
regression and complete source-capture/restart/control/source-return flow now
pass. All five final captures are inspected under
`ios-material-controls-integrated/2026-10-22_202542/`.

Final client typecheck and ownership lint pass. Rust contract generation now
trims generator-emitted trailing whitespace; regenerated contracts pass the
authoritative check. Changed desktop Rust formatting and `git diff --check`
pass. The broader workspace formatting check remains red on unchanged files,
independently reproduced in the locked `4fdae38a` review baseline; those
unrelated files have not been reformatted.

Independent M03 review and milestone push remain pending. No M04 work has
started. Execution invocations, failures, source-specific evidence and current
resource handles are retained in the ultrawork notepad; command logs, JUnit
results and screenshots are under `.mlearn/m03-m07/m03/`.

### Preserved pre-M03 integration evidence

| Gate | Current evidence |
| --- | --- |
| Windows/materials | Foundation `39722347849` passes; 13 real host tests and five DWM/save/restart states inspected. |
| Android consuming flow | Original workflow passes in 422.614 s on the exact candidate, with NDK 30.0.16248370. |
| Desktop consuming flow | `39722347957` passes the real IPC/package/playback/Inspector/claim/restart/recovery flow. |
| Local iOS | The same retained app and iOS 26.5/23F77 complete the unchanged fresh-profile workflow in 360.400 s. |
| Hosted iOS | Still red: real selection reaches LocalStorage, whose document-ID lookup returns `ENOENT`/`-1005` and no URL despite stable readable files and successful inode controls. |
| APFS diagnostic | Inconclusive for FileProvider: latest run `39749303873` preserves ownership and factory root metadata but times out during managed-configuration data migration, before app installation or UI testing. |
| Structural/performance | Prior source-bound verification is retained; diagnostic syntax or filesystem probes do not constitute new product or latency acceptance. |
| Visual | Retained comparisons remain evidence, not maintainer acceptance. Only the two previously recorded cosmetic items are deferred under the October 22 authorization. |

Windows host/API evidence does not supply an actual Windows 10 compositor
capture, and hosted desktop audio warnings do not certify physical audio output.
Those previously recorded coverage limits remain explicit.

The deferred cosmetics are paused-player shapes visible through translucent
mobile Inspector chrome, and an opaque custom Slate theme showing the Theme
selector placeholder alongside its correct current-theme label. No interface
style preference, rejected preset restoration, or functional omission is
authorized by this deferral.

Latest diagnostic source is `ce9ea292`, tree `683be61e`; its retained binary
receipt still matches `4a7927a0`/`06f1d1c3`. Evidence is
`ci-ce9ea292-root-metadata/`. The ownership assertion and UID/GID/mode comparison
pass as 501:20/0775, but boot exceeds its bounded 300 seconds. No original UI
exit or JUnit exists for that run. Final receipts show its owned device and
mount removed; local generated regression images/directories are also gone.
Both retained 26.5 profiles remain available and Shutdown, the original 27
profile remains Booted, and ports 8081/7780 are free. The shared 26.5 asset is
Ready under registration `B9DC92F5`; superseded `D157CD04` metadata is Unusable
and is not deleted because it points to the same retained asset.

The temporary diagnostic workflow and observer are retired from the working
tree; their exact source remains in Git at `ce9ea292`, and retained artifacts,
logs, compiled binaries and successful local verification are preserved.
Normal native assertions are unchanged. Perform real functional, persistence,
architectural and affected-platform checks at each milestone, including local
iOS where available. Isolate unrelated hosted infrastructure failures rather
than blocking independent implementation. No merge, release, M08 or milestone
acceptance has been granted.

## Active visual-parity rewrite - 2026-10-20

Status: active authorization, not complete or accepted. M03–M07 now proceed
under the explicit gate decision above. Execute
[VISUAL-PARITY.md](VISUAL-PARITY.md) on existing `agent/m01`, draft PR #44,
against unchanged `agent/h00`. Requested `4a86df32` was fetched and already
equalled clean HEAD; no reset, history rewrite or new worktree was used.
This authorization supersedes the historical frozen-review, minimal-restyle
and unpictured `visual_pending` restrictions below. Domain milestones remain
subject to the sequential authorization above; no merge,
release or maintainer acceptance is authorized.

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
Run `39733308564` now rejects registration alone as a repair: the original
English movie dismissal fails in 116.013 s (original exit 1; observations exit
0). Before UI, flags become 64 and guest document IDs are assigned as 3–6.
After failure those same files and IDs remain readable and unchanged.
`ci-dfc54253-registration/verification/provider.log:10348–10363` shows the
correct English selection followed by `localstorage/did=3`, error `-1005`,
and a nil URL. The final screenshot confirms ordinary list browsing without
a keyboard. Binary and harness receipts match `4a7927a0` and `dfc54253`.
No main native-workflow or application repair is justified by this contrast.
The next investigation must distinguish reverse lookup/filesystem behavior,
not repeat tap changes or registration retries. M03 remains gated.
The temporary observer now records native filesystem type/mount/FSID and
public inode-to-path lookup results with errno. Host and simulator builds
compile and execute locally on all four retained synthetic files: APFS and
successful inode lookup are observed. This is not document-ID lookup proof.
The diagnostic removes forced registration and enables targeted FileProvider
debug persistence before the original UI flow. YAML and all shell blocks
validate; hosted execution of this richer probe has not yet run.
Independent investigation `st_01a16252` confirms this discriminating probe and
the distinction between inode and document identity. The completed local
observer also confirms capability validity/support for path-from-ID and
document IDs, read-only `F_GETPATH`, and re-stat identity equality after each
inode round trip on all four files, from both host and simulator. Both SDK
builds pass, and Swift diagnostics are clean. No claim is made about the
FileProvider service's own sandbox or document-ID resolution.
Hosted reverse-lookup diagnostic `39735492932` fails the original first-English
dismissal in 174.517 s, preserving original exit 1 and observation exit 0.
Exact harness `b8d4d7ac` and immutable binary `4a7927a0` receipts match.
Both host and guest report APFS, valid/supported path-from-ID and document-ID
capabilities, successful read-only opened paths, and matching inode/device
round trips for all four files. Generic inode lookup is therefore not the
observed failure. The selected English movie remains document ID 6.
`ci-b8d4d7ac-reverse/verification/provider.log:16962–16993` traces the URL
request into the LocalStorage extension and its `-1005` reply in about 61 ms;
the final frame remains ordinary list browsing. Earlier collection changes
report document IDs deleted while their physical files remain present, but
that is not proof of the cause. The full native stream identifies
`LocalStorageFileProvider[14380]`; the filtered persisted-debug predicate omitted
that process. Extend the existing diagnostic predicate to include FileProvider
processes and subsystems before making another causal claim. M03 stays gated.
Extension trace `39737137054` now shows the missing detail. The original flow
fails first-English dismissal in 215.025 s, with original exit 1 and observation
exit 0. Exact `0c0da6b2` harness and retained `4a7927a0` binary match.
`ci-0c0da6b2-extension/verification/provider.log:16457–16514` resolves document
ID 6 via a cached VFS handle and host-proxy inode open. The later real
selection at lines 25715–25725 repeatedly receives `ENOENT` while resolving
that same document ID, then returns `-1005`; physical files/IDs and native
inode round trips remain unchanged. The final screenshot is inspected.
This is a provider document-lookup failure, not evidence of a missing tap,
blocked app importer, or a slow operation that a longer deadline would repair.

The next isolated contrast stages byte-identical generated fixtures through
a simulator-native Foundation helper instead of host `mkdir`/`cp`, retaining
the real picker and all original assertions. It tests guest-side file creation
and identity lifecycle; it is not yet a proven repair. The helper belongs
only to the temporary diagnostic until the hosted original flow verifies it.
Host and simulator helper builds pass, Swift diagnostics are clean, and both
helpers execute against disposable local directories with all eight source/
destination byte comparisons passing. YAML and every shell block validate.
This verifies fixture transport only; the hosted picker outcome is pending.
Guest creation contrast `39739133200` rejects that hypothesis: the unchanged
first-English dismissal fails in 88.859 s, preserving original exit 1 and
observation exit 0. Byte comparisons passed during setup, while document-ID
lookup still returns `ENOENT`/`-1005` at
`ci-6a2cdf81-guest-stage/verification/provider.log:21756–21785`.
All four post-outcome inode controls pass. The temporary staging helper is
removed and original host-copy preparation restored.

The next bounded diagnostic holds iOS 26.5/23F77, the immutable app, and
original UI fixed while changing the hosted macOS/Xcode generation to 27,
matching the generation with successful local runs. `xcode-27` is listed as
a standard runner in GitHub's hosted-runner reference; this repository is
public, and no paid larger runner or premium model is selected. Its current
image has only iOS 27 bundled, so the diagnostic uses the supported
`xcodebuild -downloadPlatform` command for arm64 iOS 26.5 and explicitly
requires build 23F77 before continuing. Source/environment and disk receipts
precede acquisition, the 25-minute job limit stays, and the original failing
host evidence remains intact. This is an environment contrast, not a product
fix or permission to substitute iOS 27 for the failed guest version.
Host contrast `39740572008` stops before app download and UI: Xcode's
version-only acquisition installs release-candidate build `23F73`, then the
explicit `23F77` check fails as intended. Actual hosted macOS is 27.0.1,
Xcode is 27.0/27A266a, and initial free disk is 39 GiB. No picker outcome
or capacity failure is inferred. Cached Apple metadata distinguishes the
`23F73` release-candidate and final `23F77` entries despite their shared
26.5 version. Exact-build selection must be corrected, not the guest gate.
The explicit `-buildVersion 23F77` selector is now verified locally with exit 0
and the expected final runtime. It re-registers the existing asset: new image
`B9DC92F5-DF29-485A-B70E-9A8F288B1E18` is Ready, with the same asset path and
size; old registration `D157CD04-F12F-422D-8C66-F92E4051DC84` becomes Unusable.
Both retained 26.5 devices remain available and Shutdown, and the original 27
runtime remains Ready. No shared asset is deleted to prune the stale entry.
The hosted command now uses the exact build selector, retaining its independent
post-install build assertion. This correction has no hosted UI result yet.
Exact-build host contrast `39741368708` does reach the original UI, but fails
first-English dismissal in 85.795 s. Source and retained-binary receipts match;
actual host is macOS 27.0.1/Xcode 27A266a and guest is available 26.5/23F77.
Original exit 1 and observation exit 0 remain separate.
`ci-2018853c-host27/verification/provider.log:27127–27155` shows the same
document-ID `ENOENT`, `-1005`, and nil URL. The final frame is inspected.
Changing host/toolchain generation alone is therefore insufficient.

The next filesystem contrast is confined to a new disposable simulator's
complete userdata on an owned 8 GiB sparse APFS image, not a mounted folder
inside Documents or a mutation of retained profiles. Ordinary inode controls
passed, so filesystem causality is still a hypothesis. Local image preparation,
remounting, actual 26.5 simulator boot, retained-app installation, and real
container lookup pass. The container is on the new APFS volume with 1.2 GiB
used; no app rebuild occurred. The disposable device is shut down and the
image detached before cleanup. The temporary hosted workflow now applies
this same isolated userdata preparation, preserving original UI and outcome
gates. This is not yet a hosted FileProvider repair.
The local feasibility device, detached image, and staging directory are now
removed with absence verified. YAML and all shell blocks validate; executable
cleanup controls preserve original failure and reject detach failure.
Hosted APFS contrast `39743794079` is inconclusive: the run is cancelled after
the setup/UI step exceeds 20 minutes, without reaching Maestro or producing
an original test exit/JUnit. Boot status spends 12 minutes 12 seconds waiting
for System App before reporting Finished; later setup never reaches the app
test. The small retained setup artifact verifies the distinct APFS mount and
source/runtime identity, not a FileProvider result. Volume ownership was not
recorded, and bounded startup diagnostics are needed before another contrast.
The ownership probe now identifies a concrete setup mismatch: default mounted
images disable ownership, while the baseline Data volume enables it. Explicit
`diskutil image attach --mountOptions nobrowse,owners` is exercised locally
and enables ownership; its disposable image/mount are removed and absence
verified. The diagnostic now requires `GlobalPermissionsEnabled` before boot,
records root ownership/mode, bounds boot and installation subprocesses, and
retains their output plus final host/device state. Original UI deadlines and
outcome gates remain unchanged. This repairs the experiment's setup invariant,
not yet the FileProvider failure.
Run `39748092986` stops before boot at the root metadata guard: factory userdata
is UID/GID 501:20, mode `0775`, but the mounted root is `0755`. Ownership itself
is enabled. `ditto` merges children without preserving an existing volume
root's mode. The guard remains; the diagnostic now explicitly copies the
factory root UID/GID/mode onto only the staged volume root before remounting.
Pre-boot cleanup skips screenshot/shutdown on an unbooted device. No app or
original UI result is claimed from this setup failure.
The small local regression reproduces `0775` becoming `0755` before the fix,
then verifies UID/GID/mode equality after the fix and an ownership-enabled
remount. All generated regression resources are removed with absence checked.
Hosted final receipts also confirm its failed device and mount were released.
YAML, shell/Python syntax, and both cleanup branches pass their relevant checks.
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
