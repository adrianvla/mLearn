# Bounded Reader fallback gate review

recommendation: APPROVE

blockers: []

originalIntent: Complete this bounded M10 NAV-02 unavailable Reader recovery increment using existing shared presentation and real Home navigation, without changing empty source entry or available Reader workspaces.

desiredOutcome: An unavailable Reader identifies itself, displays the actual host failure within the shared themed shell, and lets the user reach Home even after a direct entry without history.

userOutcomeReview: The inspected source and recorded desktop/narrow-browser artifacts support that outcome. No specific bounded success criterion fails. This is not whole-M10 approval, M11 integration permission, maintainer acceptance, merge permission or release readiness.

## Source and scope

Independently read Git HEAD, the complete four-file diff and short status in `/tmp/mlearn-ci-independent.6EaZ3F/reader-e8bdcb7e-review`. HEAD is `e8bdcb7e2f3f995c05bd195c63bf12cd5faba722`; status output was empty. Reviewed only `b819c18dcac09f6c2863429f624ca640b7765796..e8bdcb7e2f3f995c05bd195c63bf12cd5faba722`. Git calls used `GIT_MASTER=1 GIT_PAGER=cat`; status additionally disabled optional locks. No builds, tests, browsers, devices, network, agents or Git writes were run.

## Criteria and direct review

- C1, shared recovery composition and truthful identity/reason: `apps/client/src/features/reader/ReaderScreen.tsx:28-43` uses the same AppShell/Row/Button/Text composition as the inspected Review, Messenger and Watch fallbacks. Reader is an accessible heading; the alert renders `host.reason` directly. Shared Layout owns theme, safe-area padding, wrapping and bounded scrolling. The old local fallback style is removed.
- C2, real Home recovery: `ReaderScreen.tsx:35` calls the existing `router.dismissTo('/')`. `tests/web/foundation.spec.ts:131-153` directly opens all four activities at 1080 and 390, checks the actual alert and Home button, subscribes to the Home URL before clicking, and then checks the Home heading. The inspected green log records this scenario passing. This supports direct-entry fallback, not retained-management recovery from unavailable Reader.
- C3, preserve other branches and owners: the empty-entry condition and SourceEntryScreen props are unchanged, as are ReaderWorkspace props and all document/image workspace bodies. All three ReaderScreen hooks remain unconditional before returns. No host, store, session, persistence, cancellation or recovery-widget owner was introduced. Available-workspace hooks remain in their separate existing component.
- C4, meaningful regression protection: the only test addition is an accessible Reader identity assertion inside the existing real-navigation scenario. The red artifact fails on exactly that missing heading. No assertions were removed, weakened or replaced; no new fixture, mock, parsing or normalization was introduced.
- C5, scope and evidence honesty: current STATE keeps M10 in progress and M11 gated. Dark/native/mobile and unavailable Reader retained-management limits remain explicit. Earlier Watch resource-stop evidence is preserved rather than relabeled as a Reader failure or erased by subsequent passing runs.

## Direct programming and remove-ai-slops pass

The named skills were not available in the exposed skill inventory; the accessible skill directory listed only bun-1-4. Applied the supplied criteria directly to the complete diff, changed production wrapper, shared owners and affected test context. No excessive/useless new tests, deletion-only tests, tests merely asserting a removal, tautologies, implementation-mirroring tests, gratuitous extraction, parsing, normalization or extra abstraction were found. The heading assertion protects observable screen identity, not implementation spelling. Existing URL subscriptions precede actions; no fixed delay was added. No maintenance or scope blocker was found.

There is no separate code-review report by explicit task design. This artifact supplies both the direct code/test-quality review and gate review; independent report-to-report agreement is not claimed.

## Checked artifacts

Checkout-relative paths inspected:
- `AGENTS.md`.
- `apps/client/src/features/reader/ReaderScreen.tsx` wrapper/workspace boundary and full file diff.
- `apps/client/src/features/{review,messenger,watch}/*Screen.tsx` relevant fallback excerpts.
- `apps/client/src/bootstrap/RuntimeProvider.tsx` relevant host/provider excerpts.
- `packages/ui/src/Layout.tsx`, `Text.tsx`, `Button.tsx`.
- `tests/web/foundation.spec.ts:85-178` and its complete diff.
- `tests/web/reader-search-native-core.spec.ts:1-250` for adjacent real-runtime checkpoint/retry, retained Material draft, restart and source-return coverage; the remaining cancellation test body was not read.
- `DESIGN.md:15-79` and complete diff.
- `docs/implementation/STATE.md:1-35,160-264` and complete bounded diff.

Under `/tmp/mlearn-ci-independent.6EaZ3F/`, read all three logs:
- `unavailable-reader-red.log`: missing Reader heading, one failed scenario.
- `unavailable-reader-green.log`: fresh export `a3a1566e44e31d1324a27dc040c71460`; one test passed in 2.2 seconds.
- `unavailable-reader-adjacent.log`: normal typecheck invocation, architecture boundaries passed, 15 tests passed in 15.6 seconds using one worker. All shown resource samples are safe, with a 4 GiB reserve; the final sample matches the supplied physical footprint, available-memory, pressure and swap numbers.

Independently viewed the following images, with `case` meaning `foundation-Home-recovers-d-1f267--without-navigation-history-chromium`:
- `unavailable-reader-red-results/<case>/test-failed-1.png`.
- `unavailable-watch-resume-results/<case>/unavailable-reader-1080.png` and `unavailable-reader-390.png`.
- `unavailable-reader-green-results/<case>/unavailable-reader-1080.png` and `unavailable-reader-390.png`.

The before images show the centered Home and missing Reader identity on a white local surface. Both fresh images show Home and Reader together at the top of the shared surface. The real reason is readable and wraps at 390; no clipping or overlap is visible in either supplied fresh image.

## Exact evidence gaps and notes

Recorded executor results were inspected, not rerun. The logs establish their printed pass/fail results and bundle identifier, but contain no independently authenticated source-to-bundle manifest or process exit receipts. Executor claims of clean LSP diagnostics, initial 2560 MiB admission, final teardown/no listener, and untouched profiles were not independently reproduced. No separate teardown or LSP artifact path was supplied. Available Reader tests are browser-core evidence, not native-window/device UI evidence. The exact checkout has no installed expo-router global-state directory, so its dependency implementation of dismissTo was not inspected; direct-entry recovery is supported by the existing integration test and recorded passing run.

Dark fallback, native/mobile rendering, and retained-management recovery through an actually unavailable Reader remain unverified. No new current-Reader native evidence was inspected or inferred from earlier Watch/hosted checks. Previous Watch resource exhaustion and the unexplained OmO memory category remain unresolved historical constraints; this review neither attributes them to Reader nor waives admission.

Nonblocking documentation note: `docs/implementation/STATE.md:241` still calls the now-committed delta uncommitted, and line 246 still calls the older Reader fallback an explicit presentation gap immediately after recording its replacement. These stale phrases should be reconciled in the next checkpoint while retaining the separate retained-management and platform limits. They do not demonstrate a failure of the bounded shipped behavior.
