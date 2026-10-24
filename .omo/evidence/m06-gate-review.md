# M06 independent gate review

Reviewer: `omo-native-gate-reviewer`, task `st_01a16c25`,
`chatgpt-subscription/gpt-6.1-sol`, read-only locked checkout.
Candidate: `8934e1583db70251fb9e31cd397e266c4d637a8a`.
Base: `620c0fafaf95f8844577e1df1eca7e9c4d905314`.
Verdict: **REJECT**. Confidence: **HIGH** in the concrete blocker.

The full returned report is preserved in the task/session receipt. This durable
record retains all blockers, requirement conclusions and acceptance limits.

## B1 - P1: native model-test response rejected by Settings

OPS-04 requires actual testing of separately installable models. Rust
`apps/desktop/src-tauri/src/ocr.rs:1004-1013` selects the first recognized
string and serializes it as `rawRecognition`. The real host consumer
`apps/client/src/host/ocrModels.ts:54-62` instead requires an array.
`apps/client/src/features/settings/OcrModels.tsx:113-118` invokes that consumer,
so a successful native inference becomes a protocol error in the ordinary UI.

The old client and browser tests invented an array response. Native owner probes
actually ran inference but bypassed the rejecting TypeScript adapter. Required
repair: agree on one bounded producer/consumer contract without bypassing
validation, exercise actual native command output through createOcrModelsHost,
and verify the Settings result. Returning an array from Rust was one suggested
option, not a requirement to change the producer rather than its consumer.

Resolution: **ROOT REPAIR VERIFIED; INDEPENDENT DELTA REVIEW PENDING**.
Root reproduced the adapter and all three Settings failures with the captured
actual native response, then retained the existing bounded single-crop string
producer contract and corrected the adapter validation. Malformed responses
remain rejected. The captured fixture exactly matches source job `120773804588`.
All 161 owner/checker tests, typecheck, lint, export and 29 Settings/image
workflows pass; desktop/narrow result captures were inspected. Native inference
was not changed or rerun. A fresh delta review remains required.

## Other requirement conclusions

RDR-03/05/06/09 and OCR-02 through OCR-11 were found achieved in inspected code
and supporting scoped evidence. OPS-04 is missed because of B1. OCR-01 remains
partial pending exact-candidate consuming mobile integration; older native
evidence cannot certify every current-source application change.

The reviewer traced import/recognition/Inspector/Capture; cancellation/navigation/
recovery/retry; correction/immutable revision/Capture/Return; authenticated
resource installation/inference/testing/removal. It inspected empty recognition,
crop preservation, stale publication, duplicate completion, restart recovery,
raw/projection separation, frozen revisions, EXIF/crop transforms and archive/
executor admission. No other blocker was established.

Rust-owned domain/persistence, package-owned Japanese MangaOCR selection,
independent generic OCR, shared Knowledge/AnnotatedText/Inspector/Capture/Review,
bounded native lifetimes, generated contracts and Python-free desktop execution
were found consistent with the stated constraints. Scoped practice extends the
existing Review owner rather than implementing M07.

## Evidence audit and retained limits

Verified from inspected artifacts: all five final-source foundation jobs; final
source/tree receipts; exact-candidate Linux desktop integration; 26 image Reader
browser workflows and captures; static checks; actual Android cancellation;
disconnected iOS provider execution; iOS missing-source recovery; real Windows
and macOS recognition artifacts.

Still unproven at review delivery: exact-candidate mobile integration
`40060531803`; physical-device coverage; acceleration from provider registration
or CPU fallback; general model accuracy from synthetic/reference inputs.
The older Android driver failure remains red without an inferred app defect.
The expressly deferred hosted iOS FileProvider assertion remains unresolved and
was not investigated or replayed.

The reviewer ran no builds, models, devices, tests or downloads, created no files,
workers or worktrees, and performed no Git writes or external messaging.
It directly checked programming and AI-slop perspectives; the concrete
false-confidence finding is the invented mock response in B1.
This report grants no continuation verification, maintainer acceptance, merge,
release or M07 completion.
