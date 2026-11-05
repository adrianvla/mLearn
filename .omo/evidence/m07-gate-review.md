# Independent M07 implementation gate

Reviewer: st_01a16d8f / m07-independent-gate,
chatgpt-subscription/gpt-6.1-sol. Read-only review against dirty M07 increment
on baseline 9640c9e4166c682b83e392dbb7753ea879d869b0.
No workloads, product edits, child agents or report writes by the reviewer.
This artifact is the root's preserved receipt of its returned findings.

## Initial verdict: REJECT

### P1 — Uncertain explanation admission escapes cancellation

Pre-fix pointers: SourceActions.tsx:55, :124, :164.
An explanation can be admitted natively while its response or subsequent owner/
history validation read is lost. The UI has no generation yet, so Close/Stop/
source cleanup does not cancel the actual job. Reopening prepares another
command instead of recovering the original identity, causing Busy or another
Thread/request. Violates CON-03/07 and cancellation/idempotent-publication.

Required repair: retain uncertain identity through cleanup, resolve/cancel it
through the native owner before fresh work, and exercise actual committed/lost
receipt cases for Stop, Close, source replacement and reopen.

### P2 — Person mutations leave the current chat stale

Pre-fix pointers: MessengerScreen.tsx:118/:194,
useMessenger.ts:89/:293, storage/conversation.rs:255.
Edit/archive updates native contact and invalidates dependent responses, but
the UI refreshes only rail lists. Participant IDs do not change, so attribution
and completed-response analysis/status remain stale without active polling.
Violates CON-01/05 and affected-projection consistency.

Required repair: reconcile current participants and bounded affected message/
analysis state after contact mutation, with assertions before leaving/reopening.

## Evidence and limits reported by the reviewer

The reviewer inspected dirty product/test additions, owner/storage/protocol/
provider/native adapters, root actual native captures and passing logs. No
second renderer database, per-token IPC owner, blocking prose-pinned/tautological
tests or deletion-only slop finding was identified. Oversized owner modules are
a maintenance note, not an additional outcome-based blocker.

Final matched visual/performance/resource acceptance, checkpoint/push and
consolidated delivery remain open. Mobile binaries predate the final macOS
chrome delta. Current M07 Windows/Linux clipboard workflows are not evidenced.
Hosted iOS FileProvider remains unresolved and expressly deferred.

## Root reproduction and repair progress

`review-blockers-red.log` reproduces both defects through real Rust and HTTP:
Person attribution fails to update, and the held explanation HTTP request fails
to close after an acknowledged native admission response is deliberately lost.
Four adjacent source/Thread scenarios still pass.

Initial targeted repairs pass `contact-projection-green.log` and
`explanation-close-green.log`. A broader matrix of three lost-receipt stages
times four exit actions, plus actual edit/archive invalidation, is running.
This is not review approval. Root will return verified changes to the same
reviewer after the matrix and affected real-surface checks pass.

## Verified repair delta returned to the same reviewer

`review-recovery-final.log` passes 17 scenarios with typecheck/lint/export.
`review-pending-close.log` passes 20 scenarios in 39.7 seconds. Three loss stages
(admission, owner validation and history validation) each exercise Stop, Close,
Close before receipt loss settles, actual SPA source exit and reopen. These
subscribe to the actual external HTTP start/close events, require native
cancelled status, byte-identical prepared retries and no duplicate request.
The first failed matrix and corrected native-source-exit input remain retained.

Person save/archive/restore now await bounded affected-projection reconciliation.
The current retained message window is refreshed without replacing drafts or
jumping to the latest page. Older participant fetches cannot republish over
the new contact revision. The editor row publishes only after refresh succeeds,
so retry feedback remains reachable.

SourceActions presentation flights retain the original admission closure,
share its pending resolution and cancellation, and recover the exact native
receipt before Stop when the acknowledgement is uncertain. Reopen/source
cleanup cannot silently prepare a replacement command. Repeated recovery failure
remains visible and retains the unresolved original intent.

Root also exercised the repaired native macOS UI on the existing normal dev
process/profile. Person edit changes current attribution to M07 desktop tutor
and marks the old response invalidated in place. A fresh real response followed
by archive invalidates both replies in place. Captures:
desktop-native-person-edit-reconciled.png and
desktop-native-person-archive-reconciled.png.

An actual Reader explanation was held by the real external SSE fixture.
Native Close released the HTTP response stream; reopening shows cancelled
without another request (counter remains 6). Captures:
desktop-native-explanation-held-stream.png and
desktop-native-explanation-cancelled-reopened.png.
These files are under the M07 evidence directory.

Full UI/browser regressions and affected final-source mobile consuming
verification remain root's integration work. The Rust/protocol/FFI owners are
unchanged by these two repairs. Independent re-approval is still pending.

## Same-reviewer delta verdict: APPROVE

st_01a16d8f returned APPROVE after inspecting the four repaired product files,
updated tests/fixture, red and 17/20-scenario green logs, current checkpoint and
all four native repair captures. Both original implementation findings are
closed. It traced concurrent admission completion, cleanup, cancellation
failure/retry and affected bounded projection reconciliation. No additional
programming or overfit/slop blocker was found.

The reviewer explicitly does not certify milestone completion, visual parity,
maintainer acceptance or final-source mobile execution. Its verdict did not
claim the then-pending full integration result. Root independently verified
`review-final-integration.log`: 65 checker +115 client +96 browser scenarios,
typecheck, ownership lint and export all pass. The final-source iOS consuming
build subsequently passed; Android consuming build is running. Remaining
platform/visual/performance/delivery gates remain open.

## Additional root-discovered input delta

The same reviewer's follow-up verdict is REJECT for this delta only: an edited
question can await uncertain-original recovery, then admit a fresh provider
request after the user has pressed Stop or Close. Cancelling the old flight does
not cancel that queued fresh intent. Root will reproduce both exits with the
original receipt deliberately held, then invalidate pending fresh intent on
Stop/Close/source cleanup without invalidating the internal recovery itself.
The original two-blocker approval remains scoped to its verified source.

The prior scoped approval predates a later reproduced question-edit defect.
After cancellation, Ask another question retried the original saved instruction
instead of admitting the newly authored input. `question-edit-red.log` proves
the native saved user message differs from the new field value.

SourceActions now snapshots only submitted editor input, distinguishes edited/
new intent from an explicit unchanged failed-request retry, and retains the
existing uncertain-admission cancellation gate before fresh work. The button
labels an edited failed instruction as a new question. No Rust/protocol owner
changes. `question-edit-green.log` passes 22 source/content scenarios, including
cancelled and failed edited-question cases, with typecheck/lint/export.
The actual native question field has a stable test ID and standalone mobile
workflow now includes streaming -> Stop -> edited question -> complete.
Final consuming bundles/native execution remain required.

## Same-reviewer pending-intent repair verdict: APPROVE

The same st_01a16d8f reviewer inspected the minimal intentEpoch repair, both
new Stop/Close scenarios and their actual red/green artifacts. It returned
APPROVE with no remaining blocker in this bounded delta. External Stop, Close,
source cleanup and unmount invalidate waiting fresh intent; the post-recovery
guard rejects stale admission/error publication without invalidating internal
old-flight cancellation. The subsequent explicit question still admits once.

`fresh-intent-red.log` reproduces both failures; `fresh-intent-green.log` passes
all 24 source/content scenarios in 47.2s with typecheck, ownership lint and export.
The reviewer found no additional programming or overfit/slop blocker. No files
or workloads were changed by the reviewer. This verdict explicitly excludes
mobile execution, visual/performance verification and milestone acceptance.
The original two-blocker approval remains scoped and unchanged.

## Root functionality checkpoint, 2026-10-24

Source0217bcd98c7cec66e8b00ee5bd8634be6a1d3de0 commits the connected
runtime/storage/protocol/native/UI workflow and its direct tests.
Exact-source aggregate:
b222f0c17933831f7d2fe3f171cc1835f7b620c9f5d8de9b8bac564c703aceb7.
Fresh verification passes core5/runtime50/storage35, checker65/client115 and
all101 browser cases, contract conformance, typecheck, ownership lint and web
build. Source and served index/bundle hashes remain unchanged through the runs.
Detailed commands, logs, failed admission/port attempts and resource receipts
remain in the existing M07 PLAN/evidence directory.

Root inspected the subsequent shared source-import/session/picker release,
Home activity/source-row controls, field/keyboard boundary, Panel/theme roles
and native clipboard lifetime/bounds. This is root self-review, not another
independent verdict or an expansion of the approvals above. Existing real
Android/iOS source-entry and conversation workflows remain scoped to their
recorded binaries/bundles and scenarios.

Native matched Home/material/theme/Settings/Watch/Inspector, normal-launch/
persistence/performance, remaining affected-platform and consolidated milestone
gates remain open. Quartz currently has no capturable display; no browser
fixture is being counted as native visual evidence. Hosted iOS FileProvider
remains expressly deferred and unresolved. No M07/visual/maintainer acceptance.

## Subsequent root CI integration repairs

Exact published-source foundation40120051384 exposed a missing gated
NativeState initializer and missing web-native fixture preparation; mobile
40120051374 exposed an offscreen Android Home action and the same expressly
deferred hosted iOS picker assertion. These are retained failed results, not
replaced by earlier unrelated passes.

Root repairs9161077/1476a70/1e65caa preserve model pins and all original
assertions. Feature compilation passes; the new missing-trust listener regression
is genuinely red then green, with66 checker/115 client/typecheck/lint passing.
The actual retained Android binary reproduces the clipped Watch action, then
its unchanged picker/player/Japanese path passes62.641s after the bounded scroll.
Device/resource release is verified; fresh hosted CI remains required.
This is root repair evidence, not a new independent approval or M07 acceptance.
