# Current implementation checkpoint

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
