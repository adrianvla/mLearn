# M10 independent gate review

## Current verdict: APPROVE for M10 engineering continuation

Re-reviewed candidate: `5fa83f47cddf78a9c0e47dff5c4112fd80926100`.
Reviewer `st_01a1939e` returns APPROVE, high confidence, no blocking findings,
in4m27s. Actual routing: `chatgpt-subscription / gpt-6.1-sol / medium`.
The reviewer inspected primary JUnit/XML/PNG artifacts, the exact two Material
layout repairs and strengthened existing tests, matching retained binary/UI
hashes, and UI invalidation through native cancellation/lease cleanup.
No reviewer files or workloads were created. The clean owned5fa review
checkout was unlocked/removed after completion; older worktrees were untouched.

The previously missing graph, evidence, document-search and both mobile
Material rows below are supported. The reviewer explicitly distinguishes
scenario proof from a green invocation: `android-draft-scroll/junit.xml`
fails its empty-text predicate. Its `commands.json:721-995` records successful
Cancel/draft retention and Discard/navigation, and `android-discard.xml`
independently establishes empty Reading; later durable-save JUnit passes.
That failed invocation is retained, not reclassified or weakened.

Residual limits remain: the LLDB extract is manually copied and labelled;
cancellation execution is Android only; mobile keyboard/accessibility-focus
restoration is unestablished. The prior report does not explicitly document
the same programming/slop checklist coverage as this reviewer; that is a
reporting note, not a demonstrated product blocker. Historical platform and
visual failures and provisional M03-M07 status are preserved.

After review, exact-source Mobile run41234326545 completed with Android
job124634813285 SUCCESS and iOS job124634813085 failure in step13,
`Exercise actual iOS UI and Rust persistence`. The decisive log at
`2026-10-31T20:23:03.7257180Z` is:
`Assertion is false: id: m01-watch, mp4 is not visible`.
This is the retained a54 Watch-picker assertion, distinct from af9's earlier
Open-local-video assertion. Foundation41234326537 and Desktop41234326567
pass. No CI rerun or deferred diagnostic variant was launched, and no iOS
platform pass is claimed. The targeted repaired M10 gate is independently
approved for continuation; M11 and maintainer acceptance are not approved by
that verdict. PR44/45 remain drafts, unmerged and unreleased.

## Original independent review and repair history

Candidate: `a54da893511102374b3ddbb91903c5d048a48dc1`.
Reviewer: `st_01a19234`, configured GPT-6.1 Sol, medium.
Scope: read-only source and recorded evidence in the locked candidate checkout.
No reviewer workloads, writes or maintainer acceptance.

## Verdict: REQUESTS_CHANGES

There are no blocking implementation findings. Engineering verification remains
incomplete because connected Rust-host Chromium tests do not certify the actual
Tauri/Expo adapters, native cancellation dispatch, modal focus or native input.

### P2: affected native-flow evidence

References: `AGENTS.md:232`, `docs/implementation/STATE.md:50`,
`apps/client/src/host/createHost.native.ts:125`,
`apps/client/src/features/material/MaterialScreen.tsx:339`.

Required proof before M11:

- Actual native graph/evidence/search reads followed by Stop or dismissal;
  cancellation drains, late results stay rejected and subsequent reads work.
- Actual native Material cross-window Previous/Next with dirty
  Save/Discard/Cancel, keyboard interaction and originating-collection
  restoration, including affected iOS/Android interactions.

Reuse unchanged owner evidence. Do not repeat the deferred Watch-picker
diagnostic campaign. This is a missing engineering gate, not an established
product-code defect.

## Frozen selection

Satisfied. `FEATURES.md:176-183` requires preserving the underlying selection,
not restricting modal Previous/Next to selected members. The existing native
owner remains authoritative; the candidate proves exact cross-page selection
snapshot identity/membership/revision equality after editing/navigation,
origin restoration and native restart.

## Source review

The reviewer found the inspected collection/filter authority, bounded wire
budgets, immutable selection revisions, transactional bulk recovery,
proposal/evidence separation, source restoration and package-driven
graph/character semantics consistent with the requirements. The final
Add/Previous and stale-publication guards match their recorded regressions.

Historical platform/visual limits, provisional M03-M07 status and draft PR
restrictions remain. Approval is not recorded until the native evidence gap
is repaired and independently reviewed.

## Root native evidence repair: Tauri Material

Product source remains `a54da893`. One serial debug host build reuses the
verified exported frontend, with a separate QA identifier
`net.kikan.mlearn.v3dev.m10qa`. No product code was changed for this proof.

- Executable SHA-256:
  `802b3a1eba0e586974d593e06247ff9e496856e05a1d179c05aa5e5a1d5b7a5c`.
- UI SHA-256:
  `0e666df115e1d8ac5c61f0717c677a55c7a1d97124a5a80f0d5e679a3604aa8b`.
- Real OS-controlled window: `mlearn-desktop`, PID `72179`, window `2473`.
- Fixture: 52 entries authored through the typed client and actual Rust
  createMaterial commands in a closed isolated desktop-runtime profile.
  The complete profile was copied only into a verified-absent QA destination;
  no database rows or UI projections were fabricated.

Root drove the actual WebKit/Tauri window through OS accessibility actions,
clicks and keyboard input. The native sort popover was selected with Down/Enter;
material fields received real click, Cmd+A and typing.

| Scenario | Observed result | Artifact under `/tmp/mlearn-resume.i3aHcr/` |
| --- | --- | --- |
| Text A-Z, later collection page, Add | Previous disabled for unsaved Material | `native-add-disabled.png` |
| Edit entry47, change Notes, Next | Save/Discard/Cancel shown; Cancel focused | `native-dirty-guard.png` |
| Enter to Cancel | Current47 and exact draft retained | OS action/AX transcript in session |
| Next, Discard, Previous | Reaches48, returns47 with original persisted notes | OS action/AX transcript in session |
| Edit Notes, Next, Save, Previous | Reaches48;47 reloads `Native durable boundary note` | `native-window-after-save.png` |
| Reopen47, Next48, Close | Original47 focused; unsubmitted query and positive-scroll geometry unchanged | `native-origin-before.png`, `native-origin-restored.png` |

The final origin assertion compares exact native AX bounds before and after:
`{x:1399,y:629,width:53,height:32}`, focused entry47, and query
`Native origin query`. Root inspected the actual native captures. This is
Tauri Material evidence, not Expo/iOS/Android certification.

Native graph/evidence/search cancellation and mobile interaction proof remain
open. Current-source Foundation and Desktop CI pass; those broad runs do not
substitute for the missing targeted native paths.

## Current-source mobile build and retained iOS candidate

Mobile run `41206790229` is terminal failure on the same candidate:
Android job `124553386597` passed, while iOS job `124553386277` failed
`Exercise actual iOS UI and Rust persistence`. Its decisive assertion is
`id: m01-watch, mp4 is not visible`, in the existing Watch-only flow.
This failure remains recorded; no deferred picker diagnostic rerun was started.
Neither broad result supplies the missing targeted M10 interaction evidence.

The successfully compiled iOS artifact `13046380045` was retained independently
before that failed UI step. Its `verification/source.txt` binds candidate
`a54da893511102374b3ddbb91903c5d048a48dc1`, tree
`30153a81e69f2a13c2d00ecabc2185330242472a`. The app contains both arm64 and
x86_64 simulator architectures:

- Executable SHA-256:
  `cb7075f4c935d4fc70689b1b86ae2972b9ae0f6cc929ef00e697fadaee67fb9c`.
- `main.jsbundle` SHA-256:
  `3d16b38e55443fe7a3940b058d8e5bc97671ebd33c7d2d56b003a3bdd318e249`.

After fresh unchanged resource admission, root deliberately booted the retained
owned H00 QA simulator `2C4A73B3-435F-4CD0-86E4-09F549DC3B4F`
and installed that app without clearing its data. Actual targeted interactions
are still pending; installation is not a functionality claim.

The owned desktop app and waiting LLDB process were stopped before mobile work.
LLDB never attached: Developer Tools authorization was not granted, no worker
was suspended and native cancellation is still unverified.

The first local iOS attempt failed before reaching mLearn. The retained
`ios-a54-initial.png` shows the Apple boot logo, and Maestro hierarchy startup
failed with `IOSDriverTimeoutException`. The app launch returned no success
receipt. One bounded SpringBoard sample also timed out without a report.
These observations establish no product defect and no Material pass.
Root stopped the waiting launch and shut down only the owned H00 simulator;
the subsequent booted-device list is empty. Its profile and compiled app remain
intact. Android artifact retention is proceeding independently, without a new
build or an automatic device restart.

## Root native evidence repair: Android, partial

The retained Android APK binds the same candidate and tree through its
`verification/source.txt`; SHA-256 is
`285c5168770684e3290fc2c4e84522cfa3e9db6528439ba0b46d572e589363dc`.
It contains both arm64-v8a and x86_64 Rust bridges and installed successfully
with `adb install -r`, preserving the existing isolated QA profile.

The first software-renderer configuration silently raised guest RAM to
2560 MB and QEMU footprint reached 5.82 GB. Root stopped that owned process.
After fresh unchanged admission, explicit `-lowram -memory 1536 -gpu host`
uses the Apple M2 renderer and actual guest Total RAM 1,507,244 K. Measured
QEMU footprint settled around 3.38 GB; host pressure stayed 1 and swapOut did
not grow. This is bounded observed verification, not a memory-leak repair or
physical-device certification.

Actual Android evidence now proves:

- The empty collection and English authoring scope are real native UI.
- Add exposes disabled Previous/Next. Root asserted native
  `Previous Material` `enabled=false` and inspected `android-a54-add.png`.
- Native input acknowledges exact phrase `Native entry 00` and meaning
  `Native sense`, then executes the actual Rust-owned save.
- A tail-only recovery scrolls to the machine-consumed `material-result`
  receipt, closes, stops/relaunches the actual app without clearing data,
  reopens `Native entry 00` and verifies both exact fields.
  That flow passes in 15 seconds; root inspected its restarted native frame.

The original fixture flow first failed YAML parsing, then its corrected version
failed receipt visibility because it did not scroll past the newly inserted
saved-item controls. Both failures remain retained. Recovery did not create
the item twice or weaken the receipt/value assertions.

Artifacts are under `/tmp/mlearn-resume.i3aHcr/android-first-receipt/`,
with exact flow and invocations in the append-only notepad. Cross-window
navigation, dirty guards, exact origin and native read cancellation/reuse remain
open. One authored native item is not the 52-item window fixture or M10 approval.

## New native finding: collapsed Material search

The closed Android collection renders only the search icon, with no editable
search field in two complete native hierarchies. Root inspected
`android-a54-one.png`; this is not an offscreen header control. The existing
`tests/mobile/material.yaml` now asserts visible `material-search` before Add.
Against the unchanged installed candidate, it fails exactly that assertion in
22 seconds. The failure frame is retained under `android-search-red/`.

This is an additional demonstrated product blocker, not merely the original
review's missing evidence. The minimal repair candidate gives the existing
220-unit Material search basis the same minimum width, instead of allowing it
to collapse to zero beside other controls. No shared primitive or native
semantic owner changed.

TypeScript LSP, typecheck, architecture lint, single-worker export and all 22
connected Material/selection/proposal scenarios pass on that working-tree
repair. Root inspected actual desktop1080 and narrow390 collection captures:
the input is visible and contained, and narrow controls wrap below it.
The consuming Gradle build subsequently passed in 1m49, with one worker and
bounded Java memory. All four packaged native libraries match the exact
unchanged candidate CI bytes; its newly compiled UI bundle matches the generated
frontend output. The artifact and both hashes are recorded in STATE/notepad.
The same unweakened native assertion now passes in the full existing Material
authoring/process-restart flow (56 seconds). A further native flow passes in
14 seconds: type and acknowledge `Native entry`, submit the real collection
query, observe 1 of 1, find the persisted `Native entry 00` and exclude `M03card`.
Root inspected its actual native frame: the input is usable and contained;
the order and other controls remain visible without overlap.

Evidence is `android-search-green/` and `android-search-usable/` beneath the
task root. The owned emulator was stopped, with empty PID/device readbacks.
This closes the new search blocker only. Cross-window mobile navigation,
dirty/origin proof, iOS interactions and native cancellation/reuse still gate
the whole-M10 independent approval.

## Android Material window and draft evidence on af9ddf9f

The search increment is committed/pushed as
`af9ddf9f89370e1ef8f44d6c4ce16b68422a2d47`. Root reused the verified consuming
APK and preserved QA profile. Through actual native fields and acknowledged
save receipts, three serial 17-item batches authored Native entry01..51;
entry00 already existed. The real `Native entry` query returns52, excluding
the separately preserved M03card. No database rows were injected.

Actual native controls then establish Text A-Z ordering, an unsubmitted
`Native origin query` draft and a frozen selection containing01/40 from
different collection pages. The selector is package/runtime-backed, not a
substitute UI projection.

| Scenario | Observed result | Artifact directory under `/tmp/mlearn-resume.i3aHcr/` |
| --- | --- | --- |
| Edit47, Next, Previous | Actual47 ->48 ->47 across the native window boundary; pass8s | `android-window-boundary/` |
| Native keyboard input, Next, Cancel | Exact transient Reading and current47 retained | `android-draft-scroll/` |
| Next, Discard, Previous |48 then47; native XML independently asserts Reading `text=""` | `android-discard.xml` |
| Native durable input, Next, Save, Previous |48 then47 with exact persisted `Native durable reading`; pass30s | `android-durable-origin/` |
| Close after navigation/save | Draft query, order, page2 and positive body scroll preserved | `android-durable-origin/` |
| Native selector24, Previous, Next |24 ->23 ->24; Close returns to originating47 | `android-reverse-selection/` |
| Return to selection controls | Actual `2 selected ... frozen selection` remains after saves/navigation; combined reverse flow passes62s | `android-reverse-selection/` |

Root inspected actual modal, guard, origin and frozen-selection captures.
The saved Reading adds a line to the collection row: Edit47 bounds change
from `[821,1817][952,1933]` to `[821,1862][952,1977]`; the clipped preceding
row and positive scroll remain. This is not a claim of pixel-identical
geometry after a deliberate content-height change. Native XML does not
establish Android keyboard/accessibility-focus restoration.

Failures are preserved: the first partial-screen scroll reached only item15;
an included helper rejected dynamic gesture coordinates before input; keyboard
auto-scroll initially hid Next; Maestro's empty-text/id predicate failed even
though the independently inspected native field was empty. Recovery used
literal bounded body gestures and tail-only scenarios, without repeated writes,
selection toggles or relaxed product assertions.

Latest samples: OmO physical footprint499976616B, QEMU3717386128B,
available7005224960B, pressure1, swap3221946368B, unchanged
swapOut314122223616B. The additional diagnostic observer retains its original
growth baselines. No admission safeguard changed.

Affected iOS interactions and actual native in-flight read cancellation,
drain/reuse and stale-publication proof remain open. M10 is not approved and
M11 remains untouched.

## iOS startup recovery and selector repair

The retained iOS27 H00 pre-app failure was not retried. After fresh unchanged
admission and Android teardown, root created one isolated iPhone16/iOS26.5 QA
device, `A5EAA41D-B8F0-4264-A9CA-9F6ECC7EF2F5`. The old profile and unknown
retained devices were untouched. Current af9 app installation, actual native
Home hierarchy and the existing Material flow pass: editable search, native
input, save, process stop/relaunch and exact M03card/sense reload in53s.

Root inspected the native modal and found a real additional defect: Current
Material selection `[139,198][305,242]` overlaps Next
`[291,198][348,242]` by14pt. The layout wrapper could shrink below the shared
native Select's166pt minimum. The minimal repair gives that existing wrapper
the same minimum, allowing the existing Row to wrap. Existing long-label tests
now check selection/Previous/Next non-overlap at1080/390/320. LSP, typecheck,
lint, normal export and13 connected modal/native-core cases pass; root
inspected all three fresh layouts.

Root reused the af9 native binary and generated the consuming iOS frontend
through the existing Xcode production owner, `react-native-xcode.sh`, Expo
`export:embed` and Hermes `-O`, limited to one Metro worker. The copied
simulator app was ad-hoc signed and verified; no native code or binding was
rebuilt. Compiled `__TEXT,__text` is identical in both original and consumer:
arm64 digest `8225f19d9126974c528ad69d13d586d8ac963d0dc35e6a0a591a6cb62e0ea5ff`,
x86_64 digest `d37887203256ebbd41ef629533e606895b3035e6a07b35936dd25e3908cf6b35`.
Signed executable digest:
`b97e3a5742cd49d7ec222443fe6476454b308777cdecd212dad69680ed5775b4`;
consuming Hermes bundle:
`a9eb88538157596d02d27254dfdfe0811ec2b73e6bbf5f59030c3845e284398d`.

Actual repaired iOS replay passes12s on preserved M03card/sense. Root inspected
the native frame and checked native rectangles: Previous
`[45,198][127,242]`, selection `[139,198][348,242]`, Next
`[45,254][101,298]`. They do not intersect, and both44pt navigation controls
remain accessible. Evidence is `ios-material-current/` and
`ios-selector-replay/` under the task root. This verifies the repair on iOS,
not the outstanding Android consuming-layout replay or full iOS modal-window
and cancellation gates. Those remain open.

## iOS Material windows, draft guards and restart

On the same repaired consuming app, root authored25 distinct Native entry00..24
through actual iOS fields and save receipts, preserving separate M03card.
The real query returns24 of25, then1 of25 on page2. This bounded set exercises
the native24-item window boundary23/24; the deeper47/48 boundary is already
proved on Android/Tauri/browser.

| Scenario | Actual result | Artifact directory under `/tmp/mlearn-resume.i3aHcr/` |
| --- | --- | --- |
| Select01 on page1 and24 on page2 | Two-item frozen selection retained; Text A-Z and unsubmitted query draft preserved | `ios-origin-setup/`, `ios-origin-query/` |
| Edit24, Previous, Next |24 ->23 ->24 through the actual adapter | `ios-window-discard/` |
| Type Reading `draft`, Previous, Cancel | Current24 and exact draft retained | `ios-window-discard/` |
| Previous, Discard, Next |23 then24 with blank Reading, independently inspected in native hierarchy/frame | `ios-window-discard/` |
| Type Reading `durable`, Previous, Save, Next |23 then24 with exact persisted Reading | `ios-save-origin/` |
| Close after native switching/save | Original24, query draft, Text A-Z, page2 and positive body scroll remain | `ios-save-origin/` |
| Actual app stop/relaunch | Query/reopen24 returns `durable`; retained native two-item snapshot is available and can be selected | `ios-window-restart/` |

Window/Cancel/Discard passes31s, Save/origin36s, and actual process-restart
proof39s. Root inspected the reloaded24, restored origin, visible frozen
selection and restarted persisted-value frames. Edit24 moves from
`[292,656][343,699]` to `[292,673][343,717]` because the saved Reading adds a
row line; body scroll remains positive (71% before,69% after). Native
keyboard/accessibility-focus restoration is not established, so no such claim
is added. The volatile selected-pointer UI is not claimed to persist across
process restart: root explicitly chooses the existing Rust-retained snapshot.

One Maestro selection screenshot was uniformly gray and was rejected as
visual proof. Fresh compositor capture confirmed the app remained rendered.
Maestro also considered a caption at y233 visible despite its body viewport
starting at y434. One geometry-derived body gesture moved the caption to
`[24,468][369,489]`; root inspected `ios-selection-body-visible.png` and checked
that it lies inside the actual body. No product assertion was waived.

Whole-string automation probes reordered characters before save. Their actual
malformed native values and failure artifacts remain in the notepad. Recovery
discarded only unsaved QA drafts and retained completed receipts. The existing
per-character acknowledged pattern passes all remaining fixture writes, without
fixed sleeps or repeated saves. This does not certify the failed bulk-injection
path or attribute it to the layout change.

Post-restart sample: root physical596659104B, available5776474112B, pressure1,
swap3196780544B and unchanged swapOut314122223616B. The diagnostic observer was
stopped before deliberate app restart; its kill delivered no final summary,
so no final peak summary is invented. Individual recorded samples remain.
Android consuming-layout replay and native in-flight cancellation/reuse still
gate M10 independent approval. No M11 implementation has started.

## Android selector repair closure

The same source delta now passes the actual Android consuming replay in19s:
real search of persisted Native entry00, exact Native sense reload and disabled
Previous/Next for its one-item query. Root inspected the native frame and
asserted actual native XML rectangles do not intersect: Previous
`[119,527][330,643]`, selector `[362,527][963,643]`, Next
`[119,674][264,790]`. The fix is now exercised on both native platforms.

The one-worker consuming Gradle build passes47s. Retained APK:
`/tmp/mlearn-resume.i3aHcr/material-selector-native-current.apk`, SHA-256
`21126fb11393b977e8ca113f258bbf4ff75cbddc0e8824393f2abe02f9a54b7d`.
Packaged/generated current UI both hash
`71d15658e2f37044e2224f90f8e4c685e3dfcbd9a217fe4260f60a3276b61ac0`;
all four packaged native libraries match the previously recorded CI bytes.
The first identity command used an outdated generated-bundle path; only that
metadata tail was corrected, without rebuilding or claiming its failed pass.

Artifacts are `android-selector-replay/` and `android-selector-repaired.xml`
under the task root. End-of-case physical footprints: root568609696B,
QEMU3505442656B, available6680002560B, pressure1 and unchanged
swapOut314122223616B. The owned emulator was stopped afterward; exact PID/device
readbacks are empty and profiles remain. Native in-flight cancellation/reuse
and independent gate approval are still open. M11 remains untouched.

## Root native graph cancellation: `5fa83f47`

The consuming Android APK and its exact native libraries above were reused,
without a source patch, rebuild, reinstall or profile reset. The isolated
English profile had no collection catalog; one actual preparation completed
with206978 entries, then the `run` query returned1943 entries in2m2s. Root
inspected the real collection and opened `active: untracked`.

Stock debugging on this owned userdebug emulator succeeded with SELinux still
Enforcing. The installed Apple LLDB requires explicit `remote-android` here:
the first generic-platform connection stalled. Its server was stopped and the
app explicitly resumed before changing the platform. The NDK client could not
start because `libpython3.11.dylib` is absent; no dependency was installed.
The successful connection used the existing NDK27.1.12297006 arm64 server,
only appPID3149, and a finite app-stop failsafe. Runtime-handled SIGSEGV/SIGBUS
were passed through, not suppressed.

The actual APK-backed ELF mapping begins at `0x72dc110000`. Before setting a
breakpoint, root compared the mapped instruction at `0x72edb97548` with the
exact packaged library: `080940f9`, followed by the same three instructions.
This is `execute_bounded_read` after lease claim and heavy admission, before
its first cancellation check; the lease mutex is already released.

| Boundary | Observed native state |
| --- | --- |
| Real Linguistic relationships action hits the barrier | TID3202, request `graph_neighborhood`, package `org.mlearn.english`, target `wn30:a:00041618:active`, active1, operation flag0 |
| Only that worker suspended; all other threads resumed | Actual loading text and enabled Stop loading relations; Refresh disabled |
| Actual Stop action,3s passing native flow | Actual stopped state; native operation flag1 while worker remains suspended and active count remains1 |
| Worker resumed | Native active count0; worker no longer suspended |
| Debugger detached, native flow repeated without a barrier | Stopped state remains after drain, no late loading publication; Refresh completes in6s |

The request uses package revision
`0e3fcf644b46f81662a28ffad112f8b8e00d643701837db1dd52830ba301fe98`
and `after:null`. The admitted counter is `0xb40000776fe51ab8`; the operation
flag is `0xb40000775fe36020`. These are observed QA-process addresses, not
product constants. Root inspected the refreshed native entity and scrolled
its real body to the `active -> Alternative lexical sense -> active`
relationship, with the second sense's distinct definition. Thus reuse is an
actual package read, not a synthetic success or a hidden completed request.

Artifacts under the task root include `android-native-{catalog,graph-open,
graph-trigger,graph-stop,graph-reuse}/`, corresponding pending/refreshed/data
PNG/XML captures, `android-native-debug-maps.txt` and
`android-lldb-packets.log`. The pending and stopped states were observed while
the real worker was held; no arbitrary delay or fake transport was inserted.
The debugger deleted its own breakpoint and detached successfully, its server
exited0, the exact50397 forward and staged server were removed, and adbd was
restored to uid2000. The finite deadline was cancelled after safe detach.

Resource observer limits were unchanged. Its first real summary records peak
physical700255160B root /3479654192B QEMU, minimum available6516948992B,
pressure1 and unchanged swapOut314122223616B. A replacement observer preserves
the same baseline/maxima and corrects only the event filter from `ALARM` to the
script's actual `STOP`; it remains active for the owned case. Native evidence
and document-search cancellation/dismissal plus subsequent use remain open,
as does independent M10 approval. Exact-source Foundation and Desktop CI now
pass for `5fa83f47`; Mobile remains pending. M11 has not started.

## Root native evidence dismissal and acknowledged drain

The same running Android app and packaged native instructions were used.
Root prepared the actual Knowledge -> Inspect evidence action, then verified
the original admission-barrier instruction again. A second breakpoint was
armed before triggering the action, at `0x72ed9ce2e4`: the instruction
immediately after the Rust `cancel_bounded_read` call returns to its UniFFI
wrapper. The mapped `e81f8052` bytes match the packaged library. That Rust call
signals this lease and joins its cleanup before returning.

The actual `knowledge_evidence` request selects the same English target and
`org.mlearn.english:written-recognition`, `after:null`. TID3177 hit the
admission barrier with native active1 and operation flag0
(`0xb40000775fe7cd90`). Only that worker was suspended. The actual Inspector
Close action passes in4s while the worker remains held: loading evidence was
present, then the collection's1943 entries returned and Back to entry was
absent.

After dismissal, native flag1, active1 and zero acknowledgement-breakpoint
hits were observed while the worker was still suspended. Releasing that worker
caused the prearmed post-join breakpoint to fire on TID3202, with successful
Rust return value255, native active0 and no suspended worker. This observes the
real control acknowledgement after cleanup rather than guessing from UI
pending state. Both owned breakpoints were deleted, detach succeeded and the
client/server exited0. The finite app-stop deadline and exact forward were
removed; adbd returned to normal non-root operation. The inert staged server
file is retained only for the following document-search case.

The10s post-drain flow first verifies that dismissed evidence stays dismissed,
then opens a fresh evidence request through the actual native action. Root
inspected its rendered authoritative projection: untracked status, no explicit
claim, unmeasured self-report, unavailable prediction and explicitly no recorded
Review observations. No claim/history fixture was fabricated. Artifacts are
`android-native-evidence-{entry,trigger,dismiss,reuse}/` and
`android-native-evidence.xml` under the task root.

Current physical footprints are579947448B root /3614969720B QEMU, with
6687457280B available, pressure1, swap3188391936B and unchanged
swapOut314122223616B. Disk available10912516KiB remains above the unchanged
2621440KiB floor. Document-search Stop/dismissal and reuse remain the native
engineering gap; M10 independent approval and M11 remain gated.

## Root native document-search Stop and acknowledged drain

Root reused the already imported `m05-journey.pdf` through its actual native
Home continuation. There was no reimport or profile reset. Its retained
page2 displays `Turn the page.`; the exact case-sensitive query is `Turn`.
The source separately reports that language analysis requires its original
package version. That warning remains: this case proves canonical document
search, not successful language analysis or source-package recovery.

The actual native `search_document` request has source identity
`document-31aac431ada2633c09a8a99bc8605369d839df5265f153dc8d7db409a990ce90`,
content revision
`4dfbed3f5ca686720d2e0176565d8b73fb1fa821844d975a116a537fb65d13b9`,
parser revision `mlearn-document-1`, scope `text`, query `Turn`, `after:null`.
The same two mapped instructions were verified before enabling breakpoints.
TID7093 hit the native admission barrier with active1 and operation flag0
at `0xb40000775fe676d0`; only that worker was suspended.

Actual Stop search passes in3s while the native worker remains held. The
subsequent native observation is flag1, active1 and acknowledgement-hit0.
After worker release, the prearmed post-join breakpoint fires on TID3177 with
successful return255, active0 and no suspended worker. Both owned breakpoints
were deleted and detach succeeded; client/server exited0. The finite deadline,
exact forward and staged debugger file were removed; adbd is confirmed uid2000,
appPID3149 remains running normally and no debugserver remains.

The5s post-drain flow first confirms the stopped state is stable, then issues
a fresh real query. Root inspected PNG/XML showing `3 of 3 blocks scanned`,
the actual `Turn the page.` hit and `page:2 · byte 0`. This is a useful native
reread with source location, not a completed promise substituted for work.
Artifacts are `android-native-search-{home,source,entry,trigger,stop,reuse}/`
and `android-native-search-result.{xml,png}` under the task root.

`native-cancellation-selected-output.txt` is a clearly labelled root-copied,
bounded extract of exact LLDB output from the three monitor sessions, not an
automatically generated full transcript. It retains the observed request
identities, flag/capacity values, acknowledgement results and safe detach
receipts. The scratch `.lldb` script and flow YAML files remain alongside it.

The resource observer's actual final summary records peak physical700255160B
root /3749875672B QEMU, minimum available6516948992B, pressure1 and unchanged
swapOut314122223616B. Only the owned emulator and observer were stopped.
Readbacks show PID15882 absent and the ADB device list empty. Post-stop root
physical584092624B, available8508489728B, swap3180003328B and disk10906164KiB.
Profiles, compiled artifacts and all evidence remain; no automatic restart is
registered.

## Native QA matrix supplied to independent re-review

At submission, the original REQUESTS_CHANGES verdict remained open: root's
results did not grant approval. These repaired rows were supplied to the
independent evidence/source audit; its current verdict is recorded above.
Common command: `maestro --device emulator-5556 test --format junit` with
the recorded task-root YAML and same-named artifact directory; exact output,
test-output and debug-output arguments are retained in the notepad.

| Scenario | Expected | Observed | Verdict | Artifact relative to `/tmp/mlearn-resume.i3aHcr/` |
| --- | --- | --- | --- | --- |
| Real graph action -> Stop while admitted -> release -> refresh | Cancel current lease, retain capacity until cleanup, reject old publication, useful fresh result | Flag0->1 with active1, release->active0, stopped stable, real alternative lexical sense | PASS | `android-native-graph-stop/junit.xml`, `android-native-graph-reuse/junit.xml`, `android-native-graph-data.png`, `native-cancellation-selected-output.txt` |
| Real evidence action -> Inspector dismissal while admitted -> joined release -> reopen | Dismissal cancels native work, acknowledgement waits for cleanup, old result cannot reopen UI, useful fresh projection | Flag0->1 with active1/ack0, release->active0/successful ack, dismissed stable, real untracked/no-claim projection | PASS | `android-native-evidence-dismiss/junit.xml`, `android-native-evidence-reuse/junit.xml`, `android-native-evidence.xml`, `native-cancellation-selected-output.txt` |
| Real document search -> Stop while admitted -> joined release -> new query | Stop current quantum and continuation, drain before acknowledgement, reject stale result, useful source-bound hit | Flag0->1 with active1/ack0, release->active0/successful ack, stopped stable,3/3 blocks and page2 byte0 hit | PASS | `android-native-search-stop/junit.xml`, `android-native-search-reuse/junit.xml`, `android-native-search-result.png`, `android-native-search-result.xml`, `native-cancellation-selected-output.txt` |
| Android native Material boundary/draft/origin/frozen selection | Save/Discard/Cancel, cross-window navigation and retained collection/selection | Boundary/durable/reverse/layout flows pass; failed empty-text predicate remains, with command receipts and independent empty Reading XML supplying that scenario | PASS (scenario, not every invocation) | `android-window-boundary/`, `android-draft-scroll/`, `android-discard.xml`, `android-durable-origin/`, `android-reverse-selection/`, `android-selector-repaired.xml` |
| iOS native Material boundary/draft/origin/restart/frozen selection | Same native behavior, acknowledged keyboard input, persisted save and retained snapshot |25 real fixtures,24->23->24, draft guards, durable restart, explicit retained-snapshot selection; inspected actual geometry | PASS | `ios-window-discard/`, `ios-save-origin/`, `ios-window-restart/`, `ios-selection-body-visible.png` |

Cancellation rows above are Android/Expo evidence, not claims of actual iOS or
Tauri cancellation execution. Native Material platform-specific focus limits
and the original historical platform/visual discrepancies remain as stated.
