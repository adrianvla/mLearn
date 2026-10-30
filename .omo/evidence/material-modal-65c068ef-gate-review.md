# Material modal independent gate review

Verdict: **REQUESTS_CHANGES**.

Reviewer: `st_01a18ee4`, `omo-native-gate-reviewer`, effective
`chatgpt-subscription/gpt-6.1-sol` (explicitly routed and checked by root).
Source: `65c068efb697672386ffaead01ad06367546d2fb`, compared with
`6939b428`, in locked `/tmp/mlearn-material-modal-review-65c068ef`.
The reviewer made no edits, network calls or workload launches. This report
records its returned review; it does not grant maintainer acceptance.

## P2: saved later-page bookmark fails after management refocus

Evidence: `apps/client/src/features/material/MaterialScreen.tsx:105-119`,
especially the refresh-marker clear at line119, and
`crates/storage/src/collection.rs:495-502`.

Save on a later Material page, let refresh complete, navigate to Knowledge
through the modal, then return to Material. Successful refresh clears its
provenance without replacing the original `after` bookmark. The next focus
read uses ordinary continuation, which correctly rejects that bookmark's old
Material revision. Retry then resets the first page, losing origin context.

The reviewer established this from source, not an executed reproduction.
Existing coverage separately checked later-page Save/Close and first-page
Save/Knowledge return, missing their combination. The requested smallest
repair is to retain refresh provenance for the retained bookmark, or obtain
a native-rebased bookmark, without weakening ordinary revision checks.
Extend the existing later-page case through Knowledge return and verify page,
selection, query, scroll and clean recovery.

## Quality and evidence reviewed

The reviewer inspected changed production/tests/docs and relevant consumers,
consulted programming and remove-ai-slops guidance, and found no additional
concrete blocker involving duplicate draft ownership, speculative extraction,
unnecessary parsing, deletion-only tests or tautological assertions.
Modal interactions were adapted rather than merely removed.

It read `material-modal-refresh.log`, the final adjacent/palette log and
Playwright result records, inspected decisive light/dark captures and the
reference, and checked current STATE. `git diff --check` passed. These reads
verify the recorded artifacts, not a reviewer-run build or application flow.

## Limits retained

- No reviewer builds, tests, browser/device runs or network calls.
- No separate older code-review report was found in its bounded search.
- The selector covers the originating collection page, not full cross-page
  frozen-selection editor navigation.
- Current native-mobile UI/build verification remains pending; browser
  captures do not satisfy it.
- Previous iOS, Windows, visual and unexplained resource gaps remain open.
  M10 completion and maintainer acceptance are not granted. Both PRs remain
  draft, unmerged and unreleased.

Root will reproduce and repair the P2 and record its regression evidence
separately; this source's verdict remains REQUESTS_CHANGES.

## Subsequent executor reproduction

Root's extended existing collection scenario genuinely fails on the65c068ef
export after Save/Knowledge/Material: the asserted native ready projection is
an error response instead. Log: `material-modal-refocus-red.log`; actual failed
modal frame under its corresponding results directory was inspected. This is
now executed evidence, not only the reviewer's source inference.

The next source change retains explicit-refresh provenance for the same held
bookmark across focus reads. Ordinary continuation, native revision checks and
the bounded page owner are unchanged. Its normal source checks, fresh export
and complete affected Material scenarios are pending in
`material-modal-refocus-green.log`. No repair pass or review approval is claimed.
The first repaired run passes source checks and20 scenarios on fresh export
`c2c41cca07b4994c8b955cddcbd48efe`. The combined flow now gets a native ready
response, no error, and restored page/item/query/selection; its remaining failure
is an ambiguous scroll locator after Knowledge and Material both remain mounted.
Root inspected both actual frames and scoped only that test locator to the
visible workspace. The complete focused rerun remains pending; the prior
failure is not counted as a pass.
The first CSS-visible scroll probe also matched both retained tab panes and
failed; that probe is preserved in `material-modal-refocus-focused.log`.
The final probe scopes to the existing AppShell containing Material's search
control. The complete flow now passes in 4.7 s
(`material-modal-refocus-scoped.log`), including exact positive scroll and
the remaining exclusion/count/restart assertions. Root inspected the healthy
modal and origin-list captures. The product export is unchanged `c2c41cca`.
This executes the requested P2 regression; independent re-review is still open.

## Adjacent source-return verification after repair

`material-modal-hosted-regressions.log` exits 0: all five accepted-Messenger
proposal and Watch Home/Reselect cases pass in 10.1 s on the same `c2c41cca`
product export. Watch covers both 1080 px and 390 px through real Home and
collection input before opening the modal. Retained background values are
inspected readonly; no hidden input is filled. Exact source selection,
conversation checkpointing and unsubmitted collection drafts remain asserted.
Root inspected the accepted-proposal narrow modal and desktop/narrow Watch
return captures. These are browser/native-runtime flows, not native-mobile
rendering or media decoding/playback claims. The original 4 GiB resource
reserve held throughout this serial run.
