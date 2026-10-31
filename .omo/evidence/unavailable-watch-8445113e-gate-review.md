# Unavailable Watch recovery gate review

recommendation: APPROVE
blockers: []

Reviewer: omo-native-gate-reviewer, task st_01a18e59, October 30, 2026.
Scope: only 8b74e7a69fe89a0b5f17742e6f13d67be5f1b975..8445113ea4f9601d56a2befc545a9d48bed2693b.
Checkout: /tmp/mlearn-ci-independent.6EaZ3F/watch-8445113e-review.
Evidence root: /tmp/mlearn-ci-independent.6EaZ3F.

## Original intent and desired outcome

originalIntent: Repair the current M10 NAV-02 direct Watch recovery defect: a source/material/proposal/review route must distinguish an unavailable runtime from an opening operation that can actually proceed.

desiredOutcome: Show the existing host's real unavailability reason and a working Home action using the established Review/Messenger composition. Do not mount the media workspace in that state. Preserve empty SourceEntry and available media behavior, their existing ownership and cancellation semantics. This is not whole-M10 approval, M11 integration, merge/release approval or maintainer acceptance.

userOutcomeReview: The exact-source change satisfies this bounded outcome. There are no blocking findings and no required repairs. Inspected before captures show the false permanent opening state. Inspected after captures show a readable Watch heading, Home and the actual reason at both 1080 and 390 pixels, without overlap or clipped reason text. The regression code checks actual navigation to Home, not just disappearance of the Watch view. The provided passing log supports that interaction; this reviewer did not execute it again.

## Criteria and findings

The following criterion IDs label requirements from the supplied brief, not new requirements.

- NAV02-UNAVAILABLE: PASS. `apps/client/src/features/watch/WatchScreen.tsx:28-38` reads the existing runtime and router before any return. All five existing identifier predicates feed the common unavailable guard. The reason is rendered directly from `host.reason` as an alert; `WatchWorkspace` is not mounted. There is no synthetic success, loading state or unsupported retry in this branch.
- NAV02-EMPTY: PASS by exact-source inspection. `WatchScreen.tsx:32-33` retains the earlier empty-entry decision before the new guard, including the existing preferred-package handling. `SourceEntryScreen.tsx:15-95` retains its own actual runtime reason and disabled import behavior. No source-entry file changed.
- NAV02-HOME: PASS. `WatchScreen.tsx:35` uses the existing `router.dismissTo('/')` action. `tests/web/foundation.spec.ts:151-167` observes the Home URL and heading after clicking the real control, with the navigation subscription registered before the click. The red and green logs concern this same regression at both widths.
- NAV02-AVAILABLE: PASS for this delta. The available branch still renders the same `WatchWorkspace`; its source-session, save, focus, cancellation and media code is unchanged. `RuntimeProvider.tsx:12` memoizes the existing host, so the extra context consumer creates neither a host nor a separate lifetime. The resumed 12-case log supports adjacent available behavior; inspection of `watch-search.spec.ts` confirms decoded media, checkpoint failures/pending saves, late preference receipt, cancellation, restart and drop replacement assertions rather than fabricated successful UI alone.
- NAV02-SHARED: PASS. The composition matches `ReviewScreen.tsx:20-26` and `MessengerScreen.tsx:27-35`. `packages/ui/src/layout.tsx:10-38,57-59` supplies the existing shell, scrolling and wrapping. There is no new wrapper, store, parser, normalization, style selector or feature-local design system.
- NAV02-EVIDENCE: PASS within the stated bounded gate. The entire four-file delta was inspected. The checkpoint retains the interrupted run, unresolved memory cause and source-specific native verification limits. It does not convert this fix into milestone acceptance.

No severity/file/scenario/repair blocker exists. The identifier-only material/proposal/review routes and empty entry were checked structurally, not independently exercised by the two new tests. That is a verification limit, not evidence of an unmet behavior.

## Direct programming and remove-ai-slops review

The named skills were not available among this session's supplied skills. Their explicit criteria from the brief were applied directly to the production diff, test diff and surrounding production/test code. No separate code-review report was supplied; this report is the sole requested quality and gate review, not a claim that another reviewer performed the same pass.

- Excessive/useless tests: No blocking finding. Two viewport cases protect the specifically requested desktop/narrow recovery behavior. Home navigation overlaps the older direct-activity test, but the old test explicitly excluded Watch's runtime alert; the added reason assertion demonstrably fails on the old bundle. This is small connected regression coverage rather than a test-count target.
- Deletion-only/removal tests: None. Absence of opening/retry controls is paired with positive runtime-alert and actual Home-navigation checks.
- Tautological or implementation-mirroring tests: None in the delta. The tests use the real missing-runtime browser preview, observable accessibility roles, URL and rendered Home heading. They do not inspect source spelling, React internals or reproduce the guard algorithm.
- Prose pinning: No documentation/source-copy tests were added. The runtime-reason text is used to identify the actual user-facing host error, consistent with the existing foundation tests and this brief's explicit visible-real-reason requirement.
- Timing and mocks: The new cases add no sleeps, polling delays or runtime mocks. Navigation is subscribed before the triggering click. Existing available-runtime tests use actual media decoding and native fixture calls while adapting transport/media delivery; they do not prove a native window/device UI.
- Production burden/scope: The new logic is a direct early return with existing semantic controls. Hooks are unconditional in the exported component. No unnecessary extraction, helper, state owner, parsing or normalization was introduced. No changed assertion was weakened or removed.

## Evidence inspected

Exact-source Git readback returned `8445113ea4f9601d56a2befc545a9d48bed2693b` and empty tracked/untracked short status. Read-only Git commands were prefixed with `GIT_MASTER=1 GIT_PAGER=cat`. The diff contains only WatchScreen, foundation tests, DESIGN and STATE, with 94 additions and one deletion.

Checked source/document paths, relative to the review checkout:

- `AGENTS.md` (complete file).
- `apps/client/src/features/watch/WatchScreen.tsx` (changed wrapper and surrounding workspace through line 220; the remaining unchanged workspace was not fully reread).
- `apps/client/src/bootstrap/RuntimeProvider.tsx` and `apps/client/src/host/createHost.web.ts`.
- `apps/client/src/app/watch.tsx`.
- `apps/client/src/features/review/ReviewScreen.tsx` and `apps/client/src/features/messenger/MessengerScreen.tsx` (fallback excerpts).
- `apps/client/src/features/source-entry/SourceEntryScreen.tsx`.
- `packages/ui/src/layout.tsx`.
- `tests/web/foundation.spec.ts`, `tests/web/watch-search.spec.ts`, `tests/web/messenger-native-fixture.ts`, `playwright.config.ts`.
- `DESIGN.md` (changed evidence paragraph), `docs/product/FEATURES.md` (NAV-02 entry), `docs/implementation/STATE.md` (leading 240 lines and complete delta).

Checked evidence files, relative to the evidence root:

- `unavailable-watch-red.log`: both cases fail because the runtime alert is absent, not because of a generic harness/setup failure.
- `unavailable-watch-green.log`: fresh export bundle `d9c6f2db6b48e424187f0d8d1e6ce247`; two passed in 1.5 seconds.
- `unavailable-watch-adjacent.log`: normal typecheck precedes architecture-lint success; the later suite ends at RESOURCE_GUARD_STOP / OWNED_WORKLOAD_STOPPED without a final verdict. It is not counted as a passing suite.
- `unavailable-watch-readiness.log`: original 2560 MiB readiness requirement initially holds, then records three consecutive safe samples.
- `unavailable-watch-resume.log`: 12 passed in 32.9 seconds; all shown resource samples are safe with the same 4 GiB reserve.
- `omo-memory-summary-watch-stop.log`: identifies a large App-Specific Tag 1 allocation category but does not establish its cause or blame a device/model.
- `unavailable-watch-red-results/foundation-unavailable-Wat-46d74-e-and-Home-recovery-at-1080-chromium/unavailable-watch-1080.png`.
- `unavailable-watch-red-results/foundation-unavailable-Wat-5ac19-re-and-Home-recovery-at-390-chromium/unavailable-watch-390.png`.
- `unavailable-watch-green-results/foundation-unavailable-Wat-46d74-e-and-Home-recovery-at-1080-chromium/unavailable-watch-1080.png`.
- `unavailable-watch-green-results/foundation-unavailable-Wat-5ac19-re-and-Home-recovery-at-390-chromium/unavailable-watch-390.png`.

## Exact evidence gaps and verification limits

No builds, tests, browsers, devices, agents, network calls or Git writes were performed. The only write is this report outside the locked review checkout. The supplied logs contain passing summaries, but not explicit process exit-code records or a complete machine-generated commit-to-bundle provenance manifest. Exit 0/70, clean LSP results, red-bundle identity and post-run teardown are executor/checkpoint claims; they were not independently reproduced here. The source identity and green bundle name were directly inspected.

The available-path suite source and fixture were read, but its native binary/toolchain integrity was not revalidated. Prior hosted desktop results belong to `8b74e7a6`, not `8445113e`, and were not fetched or treated as current-source native acceptance. Dark unavailable fallback and native/mobile rendering remain unverified. Reader's existing fallback gap and whole-M10 gates remain open. No separate manual-QA matrix, code-review report or notepad path was supplied beyond the brief and leading STATE record; the four screenshots and logs above were inspected directly instead of accepting their summaries alone.

No JS eval/toolkit-status tool or ULW attempt plan was available in this child session. The report therefore uses the requested `.omo/evidence/<goal>-gate-review.md` fallback location.

## Subsequent executor receipt

Desktop run 41118373071 passed on exact pushed receipt source
`b819c18dcac09f6c2863429f624ca640b7765796`. Root readback verified native job
124278410272, including successful real IPC/plugin-download/restart smoke and
tracked-source integrity. This supplements the review's earlier native-evidence
limit; it is not native-mobile or whole-M10 acceptance and does not cover the
subsequent Reader fallback delta.

Foundation run 41118372934 on the same `b819c18d` receipt source passed web,
Rust, OCR detection and macOS, but Windows job 124284625336 failed before theme
interaction: "Native UI did not publish the owned mLearn application window."
The exact failed-step log is
`/tmp/mlearn-ci-independent.6EaZ3F/foundation-b819c18d-windows-failed.log:15`.
This leaves a Windows platform gate open; it does not identify a cause or
demonstrate a fallback-screen defect. No assertion or workflow was changed.
