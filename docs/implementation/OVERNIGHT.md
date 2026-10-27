# Overnight integration batch — 2026-10-19

## Objective and authority

Build useful next-stage mLearn functionality on a foundation that has earned continuation. Do not spend another night only polishing one popup, and do not multiply weak boilerplate across new features.

This job implements the maintainer's request for autonomous foundation scrutiny and conditional forward progress with one combined review. It authorizes **M01 repair → M02 → optional M03**, not acceptance of the existing candidate and not an unconditional feature marathon. The patched AGENTS/PLAN/STATE/REFERENCE resolve the earlier mandatory M01 stop and unpictured-screen ambiguity. This is one finite batch; it ends at its review/stop boundary. No M04+, merge, release or self-acceptance.

Work in existing `~/dev/mLearn-v3`, `agent/m01`, updating draft PR #44 against unchanged `agent/h00`. Last observed remote HEAD: `8d4589e162cee76224476cf959d4c04cb72f0a52`. Inspect actual local/remote state and retain newer work. Do not reset, force-push, rebase someone else's changes, create another worktree, or kill unrelated processes. Preserve the reviewed baseline in Git and record it before changes.

## 1. Reconcile and inspect, then act

First read this brief, AGENTS, current STATE, product SPEC/FEATURES, relevant PLAN rows and REFERENCE. Apply the supplied documentation patch only after checking it; reconcile overlapping changes instead of overwriting them. Mark the batch implementing, without changing previous units to accepted. Update the PR description to show the currently authorized batch when work begins; old no-M02 wording is historical, not current authority.

Use existing evidence to avoid redoing setup and unrelated passing checks. Investigate the actual next-feature dependency paths: source identity/return, plugin resource lifecycle, cancellation and stale publication, Knowledge/claims, UI semantics, theme resolution and persistence. Read the code, not just architecture summaries.

Aim to spend the first 60–90 minutes locating concrete risks and starting repairs, not generating a second architecture report. This is an investigation budget, not permission to leave a discovered blocker. For each consequential finding record owner, evidence, next-consumer impact, fix/test and remaining risk in the existing checkpoint. Audit recent specification/acceptance edits for unsupported scope reductions, including OPS-02's spacing/radius wording; do not silently adopt or reverse the change without tracing its authority and intended behavior.

Classify findings:

- **Must repair before dependent extension:** conflicting authority, corrupt/unstable identity, unsafe persistence/migration, foreground/background resource hazards, duplicated semantics, unusable shared controls, or APIs that the already specified M02/M03 would force you to replace.
- **Contained and explicit:** small visual differences, final composition decisions without a reference, or characterized platform limits that do not invalidate the next consumer. These are not acceptance, but need not block all independent progress.

A green suite alone does not pass this gate. A cohesive larger component is not automatically debt, either. Avoid wrapper multiplication, generic frameworks, cosmetic file splitting and rewrites of already sound native owners.

## 2. Make the design system apply beyond Inspector

Approved edited screenshots define pictured appearance. `../mlearn-ts` is roughly 90% of the intended UI and is a valuable source/CSS/interaction reference, not a trustworthy architecture. Inspect its actual dependencies and computed styles. Running `npm run dev` is authorized only after checking the real script and safely isolating the profile; preserve source, lockfiles and live user data. Screenshots win when references disagree.

Repair semantic typography, surface/material, density, spacing, buttons/pills, focus, popup composition and navigation in their real shared owners. Verify the same foundations in **Home and Settings as well as Watch/Inspector**. Do not create a special attractive media palette while ordinary content remains unrelated scaffolding. Intentional media contrast differences are legitimate; a universal glass layout is not required. Editable theme values must affect their documented consumers; not every design token needs a new setting.

Home must improve in this batch. Compose a restrained provisional entry/recents interface with clear hierarchy, useful compact source rows, human-readable package names from authoritative metadata, and appropriate primary/secondary actions. Preserve stable IDs internally. Remove the developer-test-form appearance; do not invent branding, hero copy, fake metrics, decorative card grids or unsupported navigation. No final Home screenshot means final composition approval is pending, **not** that Home must stay unchanged. Apply the same standard to ordinary Settings controls without building the later full settings catalogue.

Use shared product patterns where real semantics or reuse justify them; do not prescribe a component count or split each View into a file. Keep Inspector/Knowledge state in their feature/domain owners, not in generic buttons. Cross-check existing screens after shared changes.

Exercise one real Japanese Watch → Inspector → claim change → source return slice early. Have an independent visual/interaction reviewer inspect the actual targets and fresh native captures; correct concrete mismatches before spreading changes. Do this autonomously, without waiting for the maintainer to debug intermediate screenshots. Verify function separately from visual fidelity. Preserve genuine morphology/dictionary data, readable source context and truthful granular claims.

## 3. Advance conditionally, not ceremonially

Once the foundation gate passes for the next consumer, record `verified_for_continuation` with evidence and proceed. Do not stop merely to ask whether M02 may start. Conversely, no self-issued label permits building on unresolved propagating debt. If a blocker remains, repair it and re-evaluate; an honest foundation-only result is preferable to a larger broken app.

**Primary forward target: M02, as defined by PLAN and the exact catalogue rows.** Its existing scope includes subtitle tracks/timing/ASS/transcript interaction, independent source/definition-language selection, rich Inspector data and deliberate activation, reading/color aids, and real package management/conformance. Use coherent connected slices and record each row as implemented/verified/pending; a subset does not complete M02. Do not silently shrink format or platform support to fit the tests.

Reuse the M01 source, language-package, Annotated Text, Inspector and Knowledge owners. Exercise failure/cancel/retry/update/removal with active sources and persisted claims. Preserve authenticated activation, version identity and bounded resources. Mobile still bundles executable plugins; it must not gain desktop executable-download behavior. A structurally different real plugin validates generic contracts; fixture-shaped success does not.

**Optional stretch: M03 only after a coherent M02 integration passes its relevant checks and enough time/quota remains for end-to-end verification.** Implement the existing Capture → Material → source-return scope: real authored content and source anchors/media references, duplicate/retry semantics, editing/list/eligibility and exact return. No separate learner model, throwaway capture schema or full-media copy per item. Do not begin M04 Review, scheduling, Messenger, OCR or an inference platform. Missing product authorization or a material decision blocks that branch, not unrelated authorized repairs.

Read forthcoming consumers to avoid obviously wrong interfaces, but do not scaffold their implementation. Demonstrate reuse using the real new consumer rather than a fake test-only second screen.

## 4. Verification and efficient execution

Keep one owner per interface and coordinate parallel work to avoid conflicting edits. Use the already selected Sol/medium subscription lead for consequential reasoning/review-and-repair. Delegate bounded implementation or discovery only to suitable already configured subscription/Go models. Do not silently replace the lead, summon Astra, use metered credentials or create a recursive premium-review campaign. Stronger review must correspond to an identified need and explicit authorization.

Reproduce defects before fixing them; add the smallest useful regression at the owning boundary. Run focused checks during edits and broader regressions on coherent batches, not a full native rebuild per CSS change. Rebuild actual consuming native apps when their inputs change. Retain meaningful assertions; fix the product or harness without disguising which failed. Do not redefine the specification to make a test green.

Verify real desktop and relevant native-mobile interactions: playback/seek/return; entries/alternatives/Knowledge consistency; failures and recovery; cancellation/source switching; persistence/restart; layout/focus/scroll/large text. Measure hot-path and lifecycle behavior when changed: no hover writes, per-word query storms, repeated asset initialization or unbounded queues. A prior uninstrumented cold-start observation stays unknown unless evidence resolves it; investigate with targeted instrumentation rather than guessing or repeating unrelated runs.

Independently inspect architecture and rendered behavior before finalization. Tests, code review and screenshots protect different claims. A code approval cannot certify visual coherence; a pretty Inspector cannot waive a broken Home or native flow. Reviewers must consume the actual artifacts/source, not only the implementer's summary.

Use event-driven tool waits for CI/builds. Do not wake a large model repeatedly to poll or preserve a cache. Reuse valid evidence only for unchanged source/inputs/scope; a browser viewport is not native runtime evidence.

## 5. Operating budget and stop conditions

These are conservative operating defaults for this job, not a claim that quota accounting can be enforced by a prompt. Target an approximately eight-hour work session, start no large new feature during its final two hours, and reserve that time for integration, repairs, native checks and the handoff. Finish earlier when the authorized useful scope is complete.

Starting quota reported by the maintainer: about 50% remaining. Preserve roughly 20 percentage points for later work. Where real remaining-quota telemetry is available, stop expanding scope at about 25% remaining and checkpoint before the reserve is exhausted. Do not derive quota percentages from displayed dollar estimates or raw token counts. If telemetry is unavailable, say so, use the time/scope ceiling and conservative routing; do not pretend there is a hard quota cap.

Unattended execution does not authorize purchases, new paid services, credential exports, uploads of private evidence or changes to production/live v2 profiles. On a genuine unresolvable blocker or time/resource boundary, preserve a runnable coherent checkpoint and explain what is incomplete. Never run until failure solely because quota remains.

## 6. One combined, independently checked handoff

Commit/push coherent verified changes to the existing branch; update the existing draft PR without merging. Group related fixes/features into meaningful checkpoints; do not rewrite old history or commit every trivial edit. Keep the last verified candidate distinct from incomplete work and label any remaining WIP explicitly.

Maintain one concise active STATE and one local review entry point. Preserve earlier evidence with its original source identity; do not append another giant history to the active instructions. Refresh the familiar `.mlearn/m01/Watch-review-comparison.html` or make it point clearly to the current consolidated report. It must include fresh whole-app and detail captures for Home, Settings, Watch/Inspector and any newly implemented surfaces, plus approved references where provided. Identify application/UI/plugin source, viewport, state and timestamps. Open it and inspect it: check decoded image dimensions, broken links and correspondence with the actual current application. No stale images labeled current, screenshot-only styling or fabricated action states. Keep private originals/profile evidence local; public CI uses synthetic/licensed safe inputs.

The final handoff must answer: What foundation risks were found and repaired? What is genuinely reusable? Why was progression safe, or why did it stop? Which exact M02/M03 capabilities work? What remains unverified or visually provisional? Provide one launch command and a short combined workflow, actual check results and current captures. Do not ask the maintainer to perform the verification you were assigned, and do not equate task counts or generated lines with quality.

Stop for one combined maintainer review. `awaiting_review` is not `accepted`. The overnight exception then expires; further units require new authorization.
