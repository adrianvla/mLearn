# M05 Reader gate review and bounded B1 closeout

Date: 2026-10-23

recommendation: **APPROVE for continuation**

blockers: []

Final reviewed tree: `72d34083dedcb02d8d09666165850dc65748dde1`.
Application repair reviewed at: `fc0a51fb23b0f0142a26339ea913c8942f5ba5ad`.
Originally rejected tree: `a0e4ee117cb04a5284a517381848ed9168356223`.
M04 baseline: `f5f350ab62880378c23485552fc5aa306c033eba`.

B1 is closed. The final delta strengthens readiness waits after passage selection and restart without changing application code. Final retained native results and actual rendered captures have now been inspected. No concrete remaining blocker was found within the requested B1/Watch/readiness closeout. This is continuation review, not maintainer acceptance, full visual parity, release readiness, merge or self-acceptance.

## originalIntent

The maintainer authorized sequential M03-M07 implementation with independent review, relevant real platform workflows and exact-source publication per milestone. M05 is a usable Reader connected to the existing native language, Knowledge, Inspector, Capture and Review owners, not an isolated parser demonstration. This review performs no M06 work, commit, push, merge or release.

## desiredOutcome

Read structural TXT/EPUB and honestly bounded PDF text; preserve publisher-authored partial ruby, source identity and reflow/resume across appearance changes; navigate contents and source previews; inspect/capture/review and return to the same original passage; show consistent Knowledge in Reader and Watch without duplicate semantic owners. Cancellation, failure recovery and native rendering must be real. The hosted iOS FileProvider gate remains explicitly deferred/red and is not a prerequisite.

## userOutcomeReview — final closeout

The repaired Review handoff now preserves the frozen encounter source instead of reinterpreting it through mutable Material. Ordinary Material Return remains distinct. The connected actual-screen regression has a meaningful adversarial fixture: the Material source is cleared after the encounter source is frozen, and Return must still reach the original chapter/seed and highlight Tokyo bytes 5..11. Its retained red result fails on the rejected behavior; the inspected final capture shows the actual source selection.

The directly inspected final iOS captures show a real resumed document body with authored ruby and vertical flow, plus selected Serif and size 26 appearance. The final Android captures show original PDF page 1, the honestly text-unavailable original page 2, and original page 3 after restart. These support the bounded native workflows, not hosted Files acceptance or physical-device coverage.

## Closeout findings and mechanism

No remaining blocker was established in the bounded repair.

- `apps/client/src/features/review/ReviewScreen.tsx:167-171` passes `reviewSessionId` and `reviewEncounterId`, not `materialId`.
- `apps/client/src/features/reader/ReaderScreen.tsx:21-37` admits those route parameters and passes them to the existing hook.
- `apps/client/src/features/reader/useReader.ts:85-106` resolves Review returns through `returnReviewSource(sessionId, encounterId)` and publishes that returned anchor/window. Ordinary Material Return still calls `returnMaterialSource`; ordinary document resume remains separate. Existing source-ID/type validation and session guards remain.
- `apps/client/src/features/watch/WatchScreen.tsx:149-160` consumes the same frozen Review identity for video returns, verifies source/type/locator, and uses the existing selection/window pipeline with active-session guards. Its existing Material path remains separate.

This closes **SRC-07 / PLAN M05 Review / SPEC exact source-session continuity** at the frontend handoff identified by B1. No backend owner, protocol, semantic store or helper framework was added.

`apps/client/src/features/reader/DocumentViewport.tsx:120-128,156-165` marks the existing surface busy/loading until its identity-checked DOM visible-block callback runs. It then publishes `reader-document-ready`. The callback comes from the existing actual-layout/source-position reporting path, not a timer, fabricated completion or hidden document. Content stays mounted and the overlay does not intercept input. Stale identity reports cannot mark a different source window ready.

The final Git delta from `fc0a51fb...` to `72d34083...` contains only `docs/implementation/STATE.md` and `tests/mobile/reader-{android,ios}.yaml`. Directly inspected test diffs add the same ready-surface wait after subsequent selected passages and restart. They retain the original position, ruby, unavailable-page and persistence assertions. This closes the earlier exact limitation that restart screenshots could precede DOM layout. The final diff whitespace check exited 0. Application code and the reviewed repair are unchanged by this delta.

## Independent closeout checks and retained evidence

Used `git show TREE:path` and `git diff BASE TREE` from the retained locked worktree `/private/var/folders/f2/d3_jzj917kg6sqsc9tgc80200000gn/T/tmp.zHcXwfdacR/m03-review`. Its historical checkout was not treated as the candidate. No checkout/index, product/test source, profile, device, build artifact, commit or push was changed. Only this report was authored. There is no JS eval/toolkit status tool in this session; the task explicitly supplied this report path. No children or alternate model route were used.

### Checks actually executed by this reviewer

Independently executed repaired frozen `useReader.ts` with frozen `documentFlow.ts`, using in-memory TypeScript transpilation and minimal framework lifecycle adapters. The probe subscribed to source-anchor publication before focus, with a bounded timeout. Review parameters were supplied while a mutable Material lookup would fail because its source was cleared. It verified that the existing Review command was selected and that the original chapter/seed position and selection 5..11 were published. A second case verified ordinary Material Return still selects the current authored association. Output, exit 0:

```text
PASS frozen Review identity bypasses cleared mutable Material and publishes chapter/seed selection 5..11
PASS ordinary Material Return still resolves current authored association
```

Both rejected-to-repaired and repaired-to-final `git diff --check` runs exited 0. These are direct reviewer checks, not independent browser/native reruns. The original gate also independently ran all three frozen document-flow regressions successfully and reproduced B1 with an event-driven frozen-hook probe.

### Connected regression

Inspected `tests/web/reader.spec.ts:223-236` and its actual-screen fixture. It starts on `/review?sessionId=book-review`; the fixture preserves the encounter source while clearing the Material source. Its IPC boundary requires the actual screen's typed-client source-assistance mutation before allowing encounter return. Clicking Return must reach Reader, resolve chapter/seed and visibly highlight source-marked Tokyo bytes 5..11. The mutable-Material endpoint rejects this fixture, so the regression cannot pass through the rejected path.

Directly read:

- `.mlearn/m03-m07/m05-reader/qa/review-return-red/reader-Review-Return-prese-537a4--Material-source-is-cleared-chromium/error-context.md`: the connected test failed because `reader-title` stayed `Reader` instead of `Mixed source.epub`.
- `qa/browser-green/.last-run.json`: passed/no failed tests; this file alone does not establish the later suite count or exact source provenance.

Directly viewed the preserved final capture:

- `qa/review-return-final/reader-Review-Return-prese-537a4--Material-source-is-cleared-chromium/review-original-document-return.png`.

It shows `Mixed source.epub`, chapter/seed, the original authored reading and selected Tokyo. The reported 811 ms passing run and all 31 web workflows/strict test typing/typecheck/lint remain root execution results, not independent reruns here.

### Watch

Directly viewed `qa/desktop-review-frozen-video-return.png`. It shows `test-video.mov`, returned selection `な`, and playback around 0:11. It supports the real Watch return surface. The screenshot does not independently establish the exact 11.2-second timestamp or preceding assistance write; those are root-reported workflow facts. No grades or acceptance were inferred from it.

### Final native results

All paths below are relative to `.mlearn/m03-m07/m05-reader/`.

Read `qa/ios-render-ready-junit.xml`: one test, zero failures, SUCCESS, 18.7-second testcase, retained iOS 26.5 simulator identity. Read the separate `qa/ios-repaired-resume.yaml`: it waits for the ready surface after resume and checks saved size 26.

Directly viewed both captures under `qa/ios-render-ready/2026-10-23_040344/Repaired Reader resumes its real saved EPUB and appearance/takeScreenshot/`:

- `ios-repaired-source.png`: real source body, publisher ruby and vertical text; footer seed byte 0 legitimately includes the emoji prefix.
- `ios-repaired-appearance.png`: Vertical and Serif selected; text size 26.

Read `qa/android-ready-navigation-junit.xml`: one test, zero failures, SUCCESS, 51.607-second testcase. Directly viewed these images under `qa/android-ready-navigation/2026-10-23_040551/Reader imports real PDF text and retains original empty-page identity/takeScreenshot/`:

- `reader-pdf-first-page.png`: original page 1 text and source identity.
- `reader-pdf-empty-original-page.png`: original page 2 explicitly text-unavailable, not fake OCR.
- `reader-pdf-restarted-position.png`: original page 3 text after restart, position `page:2 / pdf-page:2`.

These results supersede the pending-native status in the intermediate closeout. Earlier blank footer-only rendering evidence remains rejected; it was not used to approve these runs. No native workflow was launched by this reviewer. No H00 input or FileProvider diagnostic was sent.

Root supplied the consuming binary identities below; this reviewer did not recompute them. Git confirms the final strengthening delta changes no application code:

- iOS main.jsbundle SHA-256: `5227fc3167350ddc7c02aa783344fee2800467206569c6c3f232add43f84303d`.
- Android APK SHA-256: `e16f2ccf36f7ca613c069e8514ea1b84ae50b4ed9fac59fc0da4eb419c263af4`.

## Direct programming / remove-ai-slops closeout pass

Consulted the previously loaded `programming` and `remove-ai-slops` skills and Rust/TypeScript reference READMEs. Applied their criteria directly to the bounded diff, not merely the executor's report.

The fix reuses the existing runtime identity/return owner; route fields do not become a second source authority. The regression models distinct mutable-versus-frozen state, drives real screens and checks source/highlight output. It is not deletion-only, prose-pinning, tautological, implementation-mirroring or a test that merely verifies a requested removal. Its expected bytes come from the authored fixture. No assertion was weakened in the inspected diff. The small lifecycle probe supplements rather than replaces the connected test.

The readiness state derives from an existing source-layout event; there is no sleep, timeout-based success, delayed reveal, extra semantic store, needless parsing/normalization, speculative helper or backend extraction. The final mobile delta strengthens synchronization at the behavior boundary rather than relaxing source assertions. No concrete maintenance or scope-drift finding warrants another blocker. The added hook parameters follow the local API; argument count alone was not promoted to a failed product criterion.

The earlier backend audit did not explicitly show the requested skill-perspective/overfit coverage. Its report was not treated as approval. This gate's original and closeout direct checks supply that coverage independently.

## Historical original B1 finding — preserved

Original recommendation: REJECT / REVISE on tree `a0e4ee117cb04a5284a517381848ed9168356223`. The following finding describes that rejected tree, not the repaired final candidate.

### B1 — Review Return discards the frozen encounter source at the Reader handoff

- Severity: P2, functional continuation blocker.
- violatedCriterion: **SRC-07**, **PLAN M05 Review** (review the captured passage and Return to it), **SPEC P07/P18 exact source/session continuity**.
- evidencePointer: `apps/client/src/features/review/ReviewScreen.tsx:167-171`; `apps/client/src/features/reader/useReader.ts:85-101`; `crates/runtime/tests/review.rs:402-427`; `crates/runtime/tests/document.rs:363-459`, all at the reviewed tree. Independent in-memory frozen-hook reproduction is described below.

The Review action correctly calls `returnReviewSource(sessionId, encounterId)`. Rust returns and checkpoints the encounter's frozen source anchor, independent of later Material edits. But the route carries only the source ID and `encounter.materialId`; it discards the returned anchor and the review encounter identity. On focus, Reader sees `materialId` and calls `returnMaterialSource(materialId)` again. That second command obtains the current, mutable Material source, replacing the successful frozen return.

A valid authored edit that clears the Material's source therefore makes Reader fail with `This authored item has no source association`, even though Return from the persisted Review encounter succeeded. Replacing the association with another passage in the same document instead silently selects that newer passage, including the wrong duplicate quotation. A different-document association fails the ID check at line 88. This is the new document consumer's actual control path, not merely an absent hypothetical feature. The existing Review regression expressly exercises clearing a Material source after encounter admission and requires the original source to remain returnable.

Independent reproduction: loaded the exact frozen `useReader.ts` and `documentFlow.ts` Git blobs, transpiled them in memory with the installed TypeScript compiler, and invoked the hook with minimal React/focus/AppState adapters. The route inputs were `id = original-document`, `materialId = captured-material`; the mutable Material response rejected its absent source. The probe subscribed to the exact error-state publication before triggering focus, with a bounded timeout. It observed exactly one `returnMaterialSource(captured-material)` call, a null document window, and the expected visible error. Output, exit 0:

```text
REPRODUCED frozen Reader hook: Review route materialId triggers returnMaterialSource, loses frozen encounter anchor, leaves document null and shows: This authored item has no source association
```

This probe isolates the routing/hook defect; it is not a claimed real-device reproduction. The first exploratory version checked state before the promise chain completed and failed its assertion; the event-driven version above replaced that inadequate probe rather than treating it as product evidence.

Repair the Review-to-source handoff so Reader resolves the frozen encounter source, rather than reinterpreting it as a current Material return. Keep ordinary Material Return semantics distinct. Add one connected regression through Review navigation into Reader after the source association is changed/cleared; assert the original resource, block, selection and highlight. The present seven-test document suite's successful `return_review_source` assertion ends at the Rust response, so it cannot catch this subsequent UI reversal. Retain its existing coverage.

## Original whole-scope gate evidence retained as context

The original gate reviewed requirements in AGENTS, PLAN M05, selected SPEC clauses and FEATURES SRC-09/RDR-01/02/04/07/08. Detailed source reads covered Reader rendering/hooks/source spans, shared Home/Inspector/Material/Review callers, theme-free shared inline controls, runtime import/publication/recovery/projection/analysis/Material Return, SQLite document admission/windows/checkpoints, parser archive/XML/EPUB/ruby/writing/PDF and hostile-input tests, the PDF guest and Wasmi fuel diff, typed document/Material/Review protocols, native image/import boundaries, desktop transport, build preparation and browser/architecture tests.

The original gate found no additional concrete failed criterion beyond B1. It traced bounded SQLite windows (eight blocks / 64 KiB), stable 1 KiB analysis admission through the shared cache/Knowledge owner, exact authored ruby and UTF-8 source anchors, original PDF empty-page identity, immutable no-overwrite publication and bounded journal recovery. It inspected the earlier audit record at `/Users/adrian/.omo/agent/projects/mLearn-v3-6d16e7ae274e/senpi-task/tasks/st_01a1662b.json` and the corresponding targeted repairs for torn journals, dropped EPUB anchors, unrelated navigation links and duplicate-import language selection. Those were not reopened in this bounded closeout.

Original retained evidence directly viewed/read included `qa/desktop-image-thumbnail.png`, `desktop-pdf-original-empty-page.png`, `desktop-watch-reader-claim-unknown.png`, `desktop-reader-watch-claim-restored.png`, `ios-original-image.png`, `ios-restarted-ruby.png`, `ios-final-material.png`, `ios-final-return.png`, `android-final-navigation-junit.xml` and its first/empty/restarted PDF captures. Build logs contained actual successful consuming-build markers. The earlier `reader-web.log` contained only a three-test run; it was not relabeled as the later complete suite.

Original owner records read were `.mlearn/m03-m07/m05-reader/PLAN.md`, current STATE, and `m05-reader-ui/NOTEPAD.md`, `m05-storage/NOTEPAD.md`, `m05-parser/NOTEPAD.md` under the supplied temporary run root. These records were treated as reports, not passing execution by themselves. Original direct slop review found behavioral parser/storage/protocol/geometry tests rather than removal-only or prose pins; the missing connected Review handoff was the concrete false-confidence seam now repaired. Formatting churn and large existing owners were maintenance notes, not unrequested architecture blockers.

## Exact remaining evidence limits

No broad rebuilds, new device operations, hosted workflows, package preparation, full Rust/browser-suite reruns, native accessibility-service session or sustained real-app resource run were performed by this reviewer. Root's reported full test counts, selected subscription route and binary hashes are not relabeled as independent execution. The independently inspected final JUnit records and actual source/appearance/page captures establish the named retained simulator/emulator workflows; they do not prove physical-device behavior or cryptographic binary provenance by themselves. Exact-source commit/push remains root-owned and was not performed here.

The hosted iOS FileProvider acceptance failure remains deferred/red. Minor cosmetic/reference differences, absent M06 OCR/page-image features, unsupported publisher layout and PDF geometry retain their honest scope. No full visual parity or maintainer acceptance is claimed.

**Final disposition:** B1 closed; final readiness assertion strengthening reviewed; named final native results and rendered captures inspected; no remaining blocker identified within this bounded closeout. APPROVE M05 for continuation on `72d34083dedcb02d8d09666165850dc65748dde1`.
