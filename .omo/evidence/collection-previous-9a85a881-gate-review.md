# Native preceding-bookmark gate review

Verdict on `9a85a881c007253c24eeb6de62e13694a19fab6b`:
**REQUESTS_CHANGES**.

Reviewer `st_01a18ee4`, effective `chatgpt-subscription/gpt-6.1-sol`, inspected
the exact nine-file delta in the clean locked dedicated checkout. It performed
source/artifact review only: no edits, workloads, devices, tests or network.

## P2: reverse byte-budget rollback needs a consequential regression

At `crates/storage/src/collection.rs:572-601`, an oversized reverse candidate
must be removed from the beginning and both accepted bookmarks restored.
Existing reverse tests at `crates/storage/tests/collection.rs:1434-1478` use
small catalog fixtures. Their size assertions do not force byte truncation.
The escaped frozen-selection test exercises a different implementation.

The requested repair is one storage-owner test with admitted large/escaped
entries that exceed 262144 bytes before 24 items. It must assert the whole
serialized page, including both bookmarks, fits; complete traversal terminates
with every expected identity exactly once; and changing direction uses accepted
boundary items. Preserve the existing ordering tests.

## Other findings and limits

No ordering defect was demonstrated. Comparison, NULL placement and tie
direction reverse correctly, and output returns to natural order. Native
query/package/Knowledge/Material epoch and cursor-kind checks remain intact;
ordinary continuation stays strict and explicit refresh keeps its existing
exception. There is no renderer cursor decoding or page cache.

The reviewer read the red/green logs and confirmed the recorded checks.
`git diff --check` passed. It found no additional ownership, assertion-weakening
or quality blocker.

Modal integration and full-selection navigation remain unimplemented.
Native-mobile/Windows and earlier visual/resource gaps remain open. This is
not M10 completion, M11 authorization or maintainer acceptance.

## Executor regression follow-up

The added storage-owner regression admits 13 real Material items, expands each
with 8000 escaped control characters within the existing content limit, and
traverses the actual bounded collection in both directions. It constructs an
oversized page with the adjacent rejected item to prove truncation occurs below
24 items, measures the whole accepted page including both bookmarks, and checks
unique complete membership plus accepted boundaries when switching direction.

`collection-reverse-budget-baseline.log` passes this complete scenario in
0.21 s after a successful compile. A temporary wrong-end rollback mutation
genuinely fails the accepted next-boundary identity assertion in
`collection-reverse-budget-wrong-end.log`. That mutation was restored before
the next check. A separate temporary mutation retaining the rejected candidate's
previous bookmark also genuinely fails the accepted next-boundary assertion in
`collection-reverse-budget-rejected-bookmark.log` (0.22 s). It too was restored.
The production storage file has no diff against `9a85a881`; neither mutation
will be committed. Changed-file diagnostics, Rust formatting and diff checks
pass. The complete restored owner suite passes all 24 tests in 0.73 s
(`collection-reverse-budget-final.log`, exit 0), including the new escaped-byte
regression and all existing ordering/epoch/refresh/selection cases. The
original 4 GiB memory reserve held; footprint was about 3.58 GB, pressure 1,
with 2550028 KiB free at disk admission. Independent re-review remains pending.
