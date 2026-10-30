# Messenger departure review

Reviewer `st_01a18cce` returned **REQUEST_CHANGES** for exact source
`c46b2c0bfd085ce2286192e279314b089e437885`.

P2: narrow Home departure can hide save failure and Retry. At390px, select a
chat, enter text, open Chats and People, then press Home while save_draft fails.
`MessengerScreen.tsx:85` routes the action to composer feedback, but the
composer is unmounted by `:236`; rail feedback at `:193` rejects that origin.
Choose the visible pane or expose the existing feedback without another retry
owner. The five passing cases did not exercise this scenario.

The reviewer inspected the five-case log and two captures. No tautological or
removal-only tests, unnecessary extraction or competing persistence authority
were found. Named skills were unavailable; supplied criteria were applied
directly. No matching current code-review report was supplied/found.
No writes, execution, browsers or network calls were performed.

Root has added the narrow Home case. Its first launch was correctly held by
disk admission (exit75); reproduction and repair verification remain pending.
This verdict grants no approval or milestone acceptance.

## Root reproduction and repair

After the maintainer's cleanup/resumption, the first Home setup reached Home
because opening the rail had already saved the draft on blur. That setup did
not exercise the uncertain receipt; its AbortError is not defect evidence.

The corrected case subscribes before opening Chats and People, holds the real
committed blur-save receipt, then presses Home. Home joins the same pending
persistDraft. Losing that receipt reproduces missing visible Retry at390px,
while Messenger and its rail remain mounted. Exact red log:
`/tmp/mlearn-ci-independent.6EaZ3F/messenger-home-rail-red-joined-blur.log`.
Root inspected its actual failed-state capture.

The repair lets the existing rail ActionFeedback present composer-origin
feedback only when the main pane is hidden. Wide presentation and the existing
save/action/retry owners are unchanged. This also preserves blur-save recovery;
merely changing the departure's origin would leave the blur callback's
composer-origin failure hidden. Fresh source/test LSP diagnostics are clean.
Normal typecheck/ownership lint pass. Fresh export
`41c71e3593cefd62b8e2766aab962f9d` passes both complete affected suites,
38 scenarios in1.2m with one worker (`messenger-visible-green.log`).
Root inspected Home390 pending/failure/restored and Back390/1080 failure
captures. The rail shows one visible error/Retry, the composer states retain
their presentation, and the real retry/restoration checks pass.
Owned runtimes/port4173 are released; profiles/evidence preserved. Disk12521148KiB,
footprint7089206736, available6624133120, pressure1, swap4711251968 bytes;
the original4GiB reserve held. Log output is8958 bytes.
The original REQUEST_CHANGES remains recorded. A fresh, bounded delta reviewer
must recheck it against this evidence, as required by review-work/SKILL.md.
