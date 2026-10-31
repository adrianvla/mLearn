# M10 independent gate review

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
