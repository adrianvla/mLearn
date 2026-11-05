# Inspector/Reader implementation-delta gate review

recommendation: REJECT

Reviewed range: `0639c5ce..dcfb1d39f2108344ddbb563d8923e60bb1017794`.
Commits: `569fe913` and `dcfb1d39`. Date: 2026-10-25.
This verdict applies only to this implementation delta, not PR44, M07, visual parity, mobile readiness, performance, or maintainer acceptance.

## originalIntent

Use the existing shared pill Button for every Inspector footer action, in one horizontally scrolling row at all widths, without changing body sense-selection controls. Make Reader's toolbar one row with secondary controls collapsed as available width shrinks, following the secondary v2 reference, and shorten its bottom rail. Preserve real actions, original source identity, cancellation, persistence, shared ownership and touch accessibility. Repair Message dismissal during an admitted retry refresh without changing native job lifetime or mutation admission.

## desiredOutcome

The compact layouts work without hiding actions or changing their lifetimes. Closing an options surface must not discard an uncertain native correction's retry identity or turn a previously dismissed crop request into a fresh automatic modal opening.

## Criteria used

These IDs label the explicit brief rather than introduce new requirements.

- C1: Every Inspector footer action uses the existing shared pill Button; no new Button implementation or feature-local interactive styling.
- C2: Inspector footer is one horizontal scrolling row at all widths; resize and trailing-action access work.
- C3: Existing body sense-selection controls remain unchanged pending separate design.
- C4: Reader retains a single toolbar row, responsive secondary controls and a shorter bottom rail.
- C5: Preserve source identity, persistence and existing uncertain correction/retry recovery across the changed modal/portal lifetimes.
- C6: Preserve real actions and cancellation, including modal dismissal while busy and source crop recovery.
- C7: Preserve shared UI/domain owners, bounded resources and native touch accessibility.

## blockers

### B1 - P1: Closing View options destroys uncertain correction recovery

violatedCriterion: C5

evidencePointer: `apps/client/src/features/reader/ReaderScreen.tsx:171-188`, especially `:185`; `apps/client/src/features/reader/ImageRecognition.tsx:33-35,59-76,137-139`; `packages/ui/src/Dialog.tsx:23-49`; `packages/runtime-client/src/ocrClient.ts:64-66`; `crates/storage/src/ocr.rs:629-651`.

Proven scenario, by tracing the checked source and existing failure fixture:

1. Open View options -> Recognition details. Edit a recognized region and Save correction. The existing fixture commits revision 2, then returns `Correction receipt lost` (`tests/web/reader-image.spec.ts:251-268`). This is the existing uncertain-correction scenario, not a newly invented failure class.
2. Dismiss Recognition details, then close View options. This delta moves `ImageRecognition` inside View options' portal. Closing that portal now unmounts `ImageRecognition`, unlike the base revision where it remained outside the options dialog.
3. Its only prepared `OcrCorrection` is `command.current`, a local ref. Its draft, error and retry indication are local too. On reopening View options -> Recognition details, a fresh component has no command and loads the still-stale Reader page at revision 1. The first attempt's thrown receipt never reached `reader.receive`.
4. `Retry same correction` is gone. Saving again calls `prepareOcrCorrection`, which creates a new command ID with expected revision 1. The real storage owner can recover revision 2 only through the original command ID's receipt; the fresh command instead reaches the revision check and returns `StorageError::Conflict`.

Thus closing a newly introduced presentation parent discards the existing native recovery identity and the edited correction draft. Load current saved recognition is still available, but it does not preserve the original retry behavior.

The passing correction scenarios at `tests/web/reader-image.spec.ts:505-538` retry before any parent dismissal. Their two-command equality assertion is meaningful, but does not exercise this new unmount boundary. This review did not run the scenario; the failure above is source-proven, including the native receipt/CAS behavior.

Minimal repair: retain the existing correction owner's prepared command and draft for the Reader/source lifetime rather than the View options portal lifetime, while keeping its controls in the options presentation. Do not make all dialog content globally force-mounted. Extend the existing lost-receipt scenario with inner/parent close and reopen before Retry, retaining exact command equality and revision-2 recovery.

### B2 - P2: A cancelled drag crop reopens Recognize whenever View options remounts

violatedCriterion: C6

evidencePointer: `apps/client/src/features/reader/ReaderScreen.tsx:67-68,89,171-178,274`; `apps/client/src/features/reader/ImageReaderControls.tsx:48-58,94-98`; `packages/ui/src/Dialog.tsx:23-49`.

Proven scenario:

1. View options -> Select crop closes options so the original image is interactive. Drag a crop. `onCrop` saves `cropDraft`, and the new Reader effect opens View options.
2. The freshly mounted `ImageReaderControls` consumes that non-null draft in its mount effect and opens Recognize source image with the selected region. This initial opening is intended.
3. Dismiss Recognize without submitting, then close View options. Neither dismissal consumes or clears `cropDraft`. Its only reset is the `imageRevision` effect; cancelling on the same unchanged page does not change that revision.
4. Open View options again, for example to change page reading direction. `ImageReaderControls` remounts, runs the same draft effect and automatically opens Recognize again. This repeats on every options reopening until the page/recognition revision changes.

Before this move, closing options did not remount `ImageReaderControls`, so an unchanged draft did not retrigger its effect. The current manual-coordinate crop test at `tests/web/reader-image.spec.ts:541-560` never creates a drag `cropDraft`, cancels it and reopens options. The failure is source-proven; no runtime reproduction was run under the read-only review constraint.

Minimal repair: consume the crop-opening request once when handed to the recognition dialog, or explicitly clear it on cancellation while preserving the active dialog's coordinate draft. Add the cancel/reopen sequence to the existing crop interaction coverage; reopening View options must not reopen Recognize without a new crop or explicit action.

## userOutcomeReview

The requested shared-control and compact-layout changes are otherwise supported by the delta and the inspected captures. `SourceActions` selects `pill` for media-context actions, retains content-context presentation and uses nonwrapping Row composition. Inspector's existing Knowledge button already uses `pill`. ContextPanel owns the horizontal scroller. The Inspector diff adds the source-backed opacity choice without modifying body sense controls.

The actual Reader wide/narrow captures show a single toolbar and a shorter bottom rail. Image fit/layout retain shared Select owners and move into options at narrower measured toolbar widths. Cancellation and feedback remain outside options. Native shared Button minimum targets remain 44 px; compact 32/28 px overrides remain web-only. ContextPanel's measured-overlay state updates only when dimensions change and preserves anchor subscription cleanup.

The Messenger change removes only the busy dismissal guard. Mutation buttons remain disabled by the existing action owner. The held-read red log proves Close was ignored before the fix, and the green log plus inspected screenshot supports dismissal and eventual saved response without an extra authored turn/provider request.

These successful parts do not retire B1/B2. The new parent portal lifetime must preserve the existing stateful image-control behavior as well as its visual placement.

## Evidence inspected and limits

Read Git history, exact diff and workspace status. No production/test files were changed. No build, test, browser, native application, download, model change or subagent was launched.

Recorded evidence checked directly:

- `.mlearn/m03-m07/m07-messenger/reader-final.log`: typecheck, architecture lint, 67 checker tests, 134 client tests, web export and all 40 listed Reader/image/Watch interactions pass. Existing exact-pixel/no-repeat-inference, uncertain correction, navigation cancellation, frozen practice and Return assertions are retained in the code. This log is recorded execution, not a rerun by this reviewer.
- `.mlearn/m03-m07/m07-messenger/hosted-dismissal-held-red.log`: original visible-versus-hidden assertion fails while the post-admission refresh is held.
- `.mlearn/m03-m07/m07-messenger/hosted-dismissal-green.log`: typecheck/lint/export and all 32 listed recovery/contextual-source scenarios pass.
- `.mlearn/m03-m07/m07-messenger/hosted-dismissal-green-results/messenger-recovery-provide-ce22e--an-explicit-fresh-response-chromium/message-dismissed-after-admitted-retry.png`: personally inspected; dialog absent, original authored message and completed response visible.
- Personally inspected `reader-native-final-wide.png`, `reader-native-final-narrow.png`, `inspector-final-native-reader-wide.png`, and `inspector-final-native-footer-scrolled.png`, all under the same M07 directory. These support actual macOS layout and trailing-action visibility. A still image alone does not reproduce focus restoration or prove scrolling occurred; those details remain root's recorded manual observations.
- Personally inspected `docs/product/screenshots/watch/watch-inspector-subtitles-subtitle-sync.png` as primary reference. v2 ReaderNav source/CSS and WordHover footer source/CSS were read as secondary context only.

Exact evidence gaps:

- No retained scenario found in the supplied affected tests/evidence for uncertain correction -> close inner and parent dialogs -> reopen -> retry, or drag crop -> cancel -> close/reopen options. These gaps explain why passing tests do not refute the source-proven blockers.
- No JS eval or agentToolkit tool is exposed to this reviewer, so `currentAttemptDir` could not be queried. The prescribed no-plan fallback report path is used.
- No separate current-delta code-review report or notepad path was supplied. `.mlearn/m03-m07/m07-messenger/REVIEW.md` and `.omo/evidence/m07-gate-review.md` were inspected: they describe earlier source boundaries and earlier reviews, not an explicit skill-perspective check of these two commits. The current STATE top sections serve as executor/manual-QA checkpoint, not independent approval. This is a reporting note, not an additional product blocker.
- Exact-source CI is pending per the brief. No fresh mobile execution, performance, full Watch compositor parity or whole-M07 readiness is certified. The iOS FileProvider failure remains expressly deferred and unresolved. No additional blocker is inferred from those excluded gates.

## Direct programming / remove-ai-slops review

Read the installed `remove-ai-slops` and `programming` skills and the TypeScript reference README. Applied their perspectives directly to the bounded production/test diff; did not substitute old review prose for this check or execute their out-of-scope refactor/test procedures.

- No removal-only/deletion-only tests, tests pinning requested removals, prompt/prose pins, or tautological expected values were introduced.
- Geometry tests observe actual rendered containment, same-row placement, overflow and keyboard access. The gradient/radius comparisons are narrowly coupled to the explicit shared-pill visual requirement, not a general architecture proof; production shared Button imports/variants were checked separately.
- New toolbar widths exercise inline, collapsed and compact states. Existing interaction scenarios were updated to enter options, without deleting their original source identity, retry, cancellation or persistence assertions.
- Held Messenger refresh uses an event subscription before Retry and releases the route in finally. Watch layout uses ResizeObserver/scroll/focus signals with bounded timeout and cleanup rather than sleep. These checks can fail for the stated regressions.
- No unnecessary production parsing/normalization, new button, duplicated domain owner, speculative framework, dependency, unbounded cache, or new background job was introduced. ImageLayoutControls has actual inline and options consumers; ImageReaderFeedback's separate mounting keeps recovery feedback visible outside the collapsed controls.
- The significant maintenance/false-confidence finding is lifetime coupling: options now owns the mounts of stateful source controls. Existing same-open-session tests miss that changed boundary. B1/B2 are concrete consequences, not size or architecture-taste objections.
- Existing large owners and unrelated ActivityCard/SourceRow activation concerns are not expanded into scope. No blanket size-rule refactor is required by this bounded user brief.
- The supplied earlier code-review report does not explicitly cover this delta's programming/overfit checklist. That limitation is recorded above; this direct pass supplies the current review's findings.

## Checked source/artifact paths

All 16 delta paths were inspected through the exact diff and relevant source sections:

- `DESIGN.md`
- `docs/implementation/STATE.md` (current top sections)
- `packages/theme/src/theme.ts`
- `packages/ui/src/Button.styles.ts`
- `packages/ui/src/ContextPanel.tsx`
- `packages/ui/src/Layout.tsx`
- `packages/ui/src/MediaOverlay.tsx`
- `apps/client/src/features/explanation/SourceActions.tsx`
- `apps/client/src/features/inspector/Inspector.tsx`
- `apps/client/src/features/messenger/MessageActions.tsx`
- `apps/client/src/features/reader/ImageReaderControls.tsx`
- `apps/client/src/features/reader/ReaderScreen.tsx`
- `apps/client/src/features/reader/useImageReader.ts`
- `tests/web/messenger-recovery.spec.ts`
- `tests/web/reader-image.spec.ts`
- `tests/web/watch-layout.spec.ts`

Neighbor owners inspected: `packages/ui/src/{Button,Dialog}.tsx`, Reader's `ImageRecognition.tsx` and `ImageSourceWords.tsx`, `packages/runtime-client/src/ocrClient.ts:53-87`, and `crates/storage/src/ocr.rs:623-682`.

Portal unmount semantics were verified from installed source, not recalled API documentation: `node_modules/@rn-primitives/dialog/dist/dialog.mjs:79-89` returns null while closed; `dist/dialog.web.mjs:71-73` delegates to Radix; `node_modules/@rn-primitives/dialog/node_modules/@radix-ui/react-dialog/dist/index.mjs:98-103` mounts its Presence only for forceMount/open. Shared Dialog supplies no forceMount. The actual source therefore proves the changed unmount boundary on native and web.

Secondary reference paths: `../mlearn-ts/src/renderer/windows/main/routes/components/ReaderNav.tsx` (bounded priority search), `ReaderNav.css:1-130`, and `../mlearn-ts/src/renderer/components/subtitle/WordHover.tsx:750-814`, `WordHover.css:145-189`.

Only this report artifact was written. No fixes, acceptance or merge were performed.

## Delta verdict - 2026-10-25: uncommitted Reader lifetime repairs

recommendation: REJECT

Original REJECT and findings above are preserved as the historical verdict. B1 and B2 are now resolved in the inspected repair. One consequential repair regression, B3 below, prevents approval of the complete current delta. This is not a rejection merely because fresh native QA is missing.

Reviewed source: uncommitted changes against `dcfb1d39f2108344ddbb563d8923e60bb1017794`. Independently reproduced the supplied production checksum with `GIT_MASTER=1 git diff HEAD -- apps/client/src packages/ui/src | shasum -a256`:

`f9e48bc50493e8956387905292e8da27b1ac1e240d501ed21b4a5b8a72c7e37a`.

### Original findings and adjacent recovery

- B1 / C5 resolved: `ReaderScreen.tsx:329-342` mounts ImageRecognition and ImageSourceWords outside the options portal. ImageRecognition's command, edited coordinates/text and error live in the mounted controller, while only its Dialog contents disappear on close. Its identity reset still retires state when the selected source/region/revision changes. The strengthened correction test closes the inner dialog and parent options, reopens both, checks the retained error/draft, retries, and retains the original command-equality, expected-revision and native-evidence assertions (`tests/web/reader-image.spec.ts:511-550`).
- B2 / C6 resolved: `ImageReaderControls.tsx:53-60` copies the dragged region into active form state, opens recognition, then calls `onCropConsumed`; `ReaderScreen.tsx:181-182` clears only the handoff request. Nulling the request does not clear the form's coordinates. The real pointer-drag tests at `tests/web/reader-image.spec.ts:555-579` check transferred geometry, cancel, close/reopen options, verify the options controls are accessible without a new recognition dialog, and assert zero inference requests.
- Adjacent uncertain practice recovery is repaired at its existing owner: `useSourcePractice.ts:16-35,44-48` retains the prepared command across a hidden empty candidate projection, cancels obsolete preparation/publication through the existing owner/controller checks, and retires it for a new client, scope or different nonempty selection. `ImageSourceWords.tsx:38-39,70-73` deliberately projects no words while hidden, which explains why keeping the controller mounted alone was insufficient. The current owner test checks both pre-commit rejection and post-commit lost receipt across hide/show, retaining exact original commands and one committed session; its added replacement mode uses different target/material membership and proves a fresh admission (`tests/client/source-capture.test.ts:217-295`). The connected Reader test also closes/reopens both surfaces before retrying the exact frozen practice request (`tests/web/reader-image.spec.ts:483-508`).
- Ordinary triggers remain existing shared Buttons. The shared Dialog discriminated props require an explicit restoration callback for triggerless callers, without global force-mounting. Web focus assertions pass. However, that restoration callback has no native execution path, as detailed next.

### blockers

#### B3 - P2: Triggerless dialogs remove native accessibility-focus restoration

violatedCriterion: C7 (preserve native touch accessibility), and the existing modal focus-restoration contract referenced by C6.

evidencePointer: `packages/ui/src/Dialog.tsx:24,32-33`; `apps/client/src/features/reader/ReaderScreen.tsx:183-188,330-334`; `apps/client/src/features/reader/ImageRecognition.tsx:109-110`; `apps/client/src/features/reader/ImageSourceWords.tsx:75-76`; installed `node_modules/@rn-primitives/dialog/dist/dialog.mjs:53-58,113-147`; installed `node_modules/@rn-primitives/hooks/dist/index.mjs:28-42`.

Source-proven affected scenario: on iOS/Android, open View options -> Recognition details or Page words, then dismiss the child while View options remains open. Previously each child Dialog rendered Primitive.Trigger, whose native implementation calls `useRestoreAccessibilityFocus(open, triggerRef)`. That hook detects open -> closed and explicitly invokes `AccessibilityInfo.setAccessibilityFocus` on the originating trigger.

The repair replaces those Primitive.Trigger instances with Buttons outside the child Dialog roots. Shared Dialog renders no Primitive.Trigger when `trigger` is absent (`Dialog.tsx:24`). Its only invocation of the required `restoreFocus` callback is `onCloseAutoFocus` on Primitive.Content (`:33`). Inspection of the installed implementation confirms that event is handled by the web Content wrapper, but native Content does not emit or invoke it: it only passes remaining props to its View/Slot and registers BackHandler/accessibility escape. Native Content's `useAccessibilityFocus(open)` moves focus into the opened dialog; it does not restore it on close. The explicit native restoration path removed from Trigger therefore has no replacement for either child.

Additionally, Reader's supplied callbacks call only `View.focus()` (`ReaderScreen.tsx:331,334`), not the native accessibility-focus operation used by the previous primitive. Simply invoking those callbacks on native close would not restore the former accessibility-focus contract. The existing platform-aware pattern is visible in `packages/ui/src/DictionaryCard.tsx:19-25`: web focus versus native findNodeHandle/AccessibilityInfo.

This is a concrete lost execution path in a supported platform adapter, not a prediction based on an absent screenshot. It does not claim a measured VoiceOver/TalkBack outcome; no device was launched. The 83 browser cases and newly added `toBeFocused` assertions execute the web implementation and cannot establish the missing native path.

Minimal repair: make the shared Dialog's triggerless restoration contract platform-aware. Invoke native restoration on an actual open -> closed transition and restore accessibility focus to the originating shared Button (or valid fallback), preserving Reader's route-blur guard. Keep this responsibility in the shared UI/input boundary rather than adding per-feature native event handling or another button. Protect that native close-transition callback/target behavior with a focused regression at the existing shared-owner test seam; retain the current web focus and lifetime assertions. No broad platform campaign is requested by this finding.

### Evidence inspected for this delta

- `.mlearn/m03-m07/m07-messenger/reader-lifetimes-red.log`: five failing connected scenarios. Both correction widths lose the retained error after reopening. Both crop widths fail the options reopening assertion. The narrow crop failure's `reader-lifetimes-red-results/reader-image-cancelled-dra-dbdbb-ith-Reader-options-at-393px-chromium/error-context.md` explicitly shows Recognize source image reopened with the dragged coordinates, corroborating B2 rather than merely inferring it from a missing options locator.
- `.mlearn/m03-m07/m07-messenger/reader-practice-owner-red.log`: before/after-commit hide/show modes lose their errors and fail, supporting the adjacent receipt-lifetime fix.
- `.mlearn/m03-m07/m07-messenger/reader-lifetimes-green.log`: recorded typecheck, architecture lint, web export, 67 checker/134 client tests and eight targeted browser passes, including both repaired correction and crop widths and connected practice.
- `.mlearn/m03-m07/m07-messenger/reader-lifetimes-final.log`: 67 checker tests, 135 client tests (including the replacement-selection subcase) and all 83 listed Reader/image/Watch/foundation/dialog/Messenger browser cases pass, with zero recorded checker/client failures. This final log is aggregate tests/browser evidence; typecheck/lint/export are verified in the preceding green log, not invented as additional lines in this log.
- Personally inspected current final-results narrow `crop-cancelled-options-reopened.png` and `recognition-correction-evidence.png` at their listed paths under `reader-lifetimes-final-results`. The former shows options visible and usable without Recognize; the latter shows retained correction/evidence UI. Neither image is native lifetime proof.
- Read current top STATE lifetime checkpoint and `/var/folders/f2/d3_jzj917kg6sqsc9tgc80200000gn/T/ulw-20261020-visual.XXXXXX.md.aXK9yXuTab` top as executor scope/evidence records, not as independent verification. The latest user message explicitly supersedes the notepad's prospective reduced-process native plan: that admission remained held and was stopped without an app launch.

### Direct programming / remove-ai-slops delta pass

Consulted the skills and TypeScript criteria loaded for the original review and applied them directly again to all current product/test changes. The original code-review section remains above; this appendix supplies explicit current-repair coverage rather than borrowing its old verdict.

No deletion-only/removal-verification tests, tautologies, prose pins, implementation-mirroring production assertions, fixed sleeps, new production parsing/normalization or unnecessary extraction were introduced. Existing tests were extended at the actual failure boundary, not weakened: correction command equality and revision recovery remain; practice equality remains for both original modes and replacement membership deliberately differs; crop is produced by pointer input against source image geometry, not direct state injection. Existing fixture receipt maps preserve the admission/CAS behavior being asserted. Additional focus assertions observe browser behavior but expose the native coverage boundary in B3; they are not cross-platform proof.

Controllers stay in their existing owners, and prepared practice state remains bounded to one command/context, not a growing cache. The changed effect dependencies preserve cleanup on client/scope/selection transitions. No duplicate domain authority, feature-local interactive style, new Button or global hidden mounted-dialog tree was added. No additional maintenance/scope-drift blocker was identified. The source-level cross-platform callback mismatch in B3 is the consequential repair regression.

Checked paths: all nine current changed files from Git status/diff: `apps/client/src/features/material/useSourcePractice.ts`, Reader's `ImageReaderControls.tsx`, `ImageRecognition.tsx`, `ImageSourceWords.tsx`, `ReaderScreen.tsx`, `packages/ui/src/Dialog.tsx`, `tests/client/source-capture.test.ts`, `tests/web/reader-image.spec.ts`, and current top `docs/implementation/STATE.md`. Neighbor reads were limited to the installed native/web dialog and focus-hook implementations, their native type declaration, and the existing shared DictionaryCard focus adaptation.

### Exact remaining gaps and verdict scope

No fresh native corpus crop/cancel/reopen or correction/practice lifetime check was completed. The initial native launch stopped before input at the root OmO resource ceiling. The reduced-process admission stayed held and was stopped without launching an app. No inference, device or new native success is inferred. Previous native captures remain geometry evidence only, not evidence for this uncommitted lifetime change.

Affected-platform consuming/native continuation, the deferred unresolved iOS FileProvider failure, repeated normal-launch/package-switch performance, full visual conformity, full-M07 delivery and maintainer acceptance remain open. Earlier compositor/performance claims in STATE/notepad were not re-reviewed here and do not close those gates. A successful committed-head CI run would not verify this uncommitted checksum.

No build, test, device, server, model, download or agent was launched by this review; reported executions are inspected retained artifacts. No product/test file was edited. Only this report was updated. B1/B2 closeout stands; current-delta recommendation remains REJECT solely for B3.

## Focused B3 closeout verdict - 2026-10-25

recommendation: APPROVE

blockers: []

This approval closes B3 / C7 and its modal focus-restoration concern only. It does not reopen or re-review B1/B2, certify the entire uncommitted delta, or grant M07/platform/performance/maintainer acceptance. All prior findings and dated verdicts remain above as historical records.

Reviewed production checksum, independently reproduced using the supplied Git diff pipeline:

`86097f1d0f40088a66fd7b9abfefdd4e859f902398eecc7e411df624ab73c453`.

### originalIntent and desiredOutcome

Restore the explicit native accessibility-focus path lost when the Reader child dialogs became triggerless, while retaining web focus restoration and keeping platform behavior in the existing shared UI boundary. Dismissal should return to the current valid origin/fallback, not steal focus on route blur or repeat restoration on unrelated renders.

### userOutcomeReview and B3 resolution

`packages/ui/src/Dialog.tsx:10-15` now requires a `focusTarget` getter for triggerless callers and leaves ordinary triggered callers with their existing Primitive.Trigger. The shared restoration callback resolves that getter at restoration time, returns for null, uses web `target.focus()`, and uses native `AccessibilityInfo.sendAccessibilityEvent(target, 'focus')` (`:23-28`).

Native restoration is no longer dependent on the absent web event: the actual open -> closed transition is detected in a React effect (`:29-35`). `wasOpen` is updated before invoking restoration, so a fresh getter identity or other closed-state rerender does not produce another event. The web path still uses `onCloseAutoFocus` (`:45-46`), and the native effect excludes web. No timeout, global forceMount or feature-local platform branch is added.

The Reader getters at `apps/client/src/features/reader/ReaderScreen.tsx:331,334` return null when the route is blurred; otherwise they resolve the current child trigger or options fallback. ImageRecognition and ImageSourceWords pass those getters directly to the shared Dialog (`ImageRecognition.tsx:20-25,110-111`; `ImageSourceWords.tsx:18-28,75-76`). This addresses both parts of B3: the native close event now reaches the restoration owner, and that owner dispatches an accessibility operation rather than only View.focus().

The installed RN implementation/type declarations were checked locally: `node_modules/react-native/Libraries/Components/AccessibilityInfo/AccessibilityInfo.js:443-466` defines the HostInstance-based sendAccessibilityEvent path and routes it through the renderer; `AccessibilityInfo.d.ts:41,174-177` admits the focus event and host target. The implementation explicitly deprecates numeric setAccessibilityFocus in favor of this API. This is source/API compatibility evidence, not a claim of screen-reader execution.

No remaining B3 blocker was identified.

### Checked evidence

- `.mlearn/m03-m07/m07-messenger/dialog-native-focus-red.log`: actual focused owner regression fails because the recorded focus operations are empty instead of the expected fallback focus event. This distinguishes the original missing native path from a generic test failure.
- `.mlearn/m03-m07/m07-messenger/dialog-native-focus-green.log`: the same owner test passes; recorded typecheck and ownership lint pass.
- `tests/client/dialog-focus.test.ts:8-105`: inspected the complete regression. It imports the real shared Dialog and runs real React rendering/effects. Native host accessibility operations are recorded at the adapter seam, and its native Content substitute deliberately never emits web onCloseAutoFocus. Both iOS and Android branches check no event on initial closed/open/open-rerender, the latest fallback on close, no duplicate closed-rerender event, null/missing targets, and subsequent origin restoration. flushSync settles the actual effects; no fixed sleep is used.
- `.mlearn/m03-m07/m07-messenger/dialog-native-focus-web.log`: current web export and all 37 listed Reader/image/shared-dialog browser cases pass, including recorded correction/practice close-reopen and real crop cancellation scenarios. These are inspected executor results, not tests launched by this reviewer or a new review of B1/B2.
- Personally inspected `.mlearn/m03-m07/m07-messenger/dialog-native-focus-web-results/reader-image-cancelled-dra-dbdbb-ith-Reader-options-at-393px-chromium/crop-cancelled-options-reopened.png`: current narrow options surface is present. This remains browser presentation evidence, not native accessibility evidence.

Checked product/test paths were restricted to `packages/ui/src/Dialog.tsx`, the relevant focus wiring in Reader's `ImageRecognition.tsx`, `ImageSourceWords.tsx`, `ReaderScreen.tsx`, and `tests/client/dialog-focus.test.ts`. Installed RN API source/types were consulted only to confirm the native operation. Existing report content was read for preservation, not a renewed review campaign.

### Direct programming / remove-ai-slops B3 pass

Consulted the previously loaded skill criteria and applied them directly to this focused repair/test. No removal-only/deletion-only assertion, prose pin, tautology, unnecessary extraction, parsing/normalization, new interactive owner, delay/retry or accumulating resource was introduced. The one owner regression covers the changed close-transition contract rather than mirroring the effect's private state. Its host substitute records the real production dispatch without supplying the missing web event, so the pre-fix red can fail meaningfully. Null/missing targets and differing origin/fallback inputs prevent false confidence from equivalent fixtures. Stubbing presentation collaborators is bounded to the focus-operation seam; actual RN rendering and assistive technology remain untested. No additional programming/overfit blocker was found. This section provides the explicit focused skill-perspective review rather than inferring coverage from earlier approval prose.

### Exact evidence gaps preserved

The native-operation seam is not actual VoiceOver/TalkBack or device proof. Native corpus lifetime verification, affected-platform consuming/native execution, the expressly deferred unresolved iOS FileProvider failure, repeated normal-launch/package-switch performance, full visual/M07 delivery and maintainer acceptance remain open. Previous native layout captures remain geometry evidence only. The earlier 83 browser cases and 202 checker/client passes remain historical recorded results, not rerun claims for this checksum.

Four changed-owner LSP probes and diff-check cleanliness were reported by the executor; this reviewer did not rerun them. Root resource samples are likewise executor observations, not an independently measured performance result. No tests, builds, servers, devices, models, downloads or agents were launched during this closeout. Only this report was edited.
