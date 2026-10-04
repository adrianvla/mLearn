# mLearn Coherent Product Implementation Plan

> Execute inline with superpowers:executing-plans. Track implementation and evidence in docs/product-refactor/LEDGER.md. Use one integrated review after final acceptance work.

**Goal:** Implement PRODUCT_SPEC.md M1–M4 and verify J01–J24 without duplicating learning authorities.
**Architecture:** One route shell hosts content components under one WindowWrapper. Existing durable review, study and mock owners remain authoritative; explicit navigation and shared foreground input/layout connect them.
**Tech Stack:** Electron, SolidJS, TypeScript, Vitest, Python/FastAPI.
**Spec:** /Users/adrian/Downloads/mlearn_product_refactor/PRODUCT_SPEC.md

## Global constraints
Preserve personal history, package references, privacy/consent, managed boundaries and unrelated work. No new learning model, cloud deployment, design system or fabricated assessment content. Unknown language features remain package-owned. Scoped commits only; both TS configurations must pass.

## Review focus
Pending persistence during route replacement; same-route new requests; old language/group records; answer exposure after correction/replay; failed library/backend recovery.

### Task 1: M1 shell and entry cutover
Files: shared/applicationNavigation.ts + tests; electron/services/windowManager.ts; renderer/windows/main/ApplicationShell.tsx + CSS + ApplicationRoutes.tsx; main/index.tsx; mobile/index.tsx; shared/bridges/capacitorBridge.ts; WelcomeRoute.tsx + welcome.css; FlashcardsContent host props.
Interface: resolveApplicationDestination(type, context) returns purpose route and retained context or null for native exceptions. An application navigation envelope identifies its destination and request. Content mounts once, without WindowWrapper. Host supplies Return.
- [ ] Test ordinary aliases, explicit grammar/material/check intents, generic open clearing stale contexts, native exceptions and QR redirect; observe failure.
- [ ] Implement semantic mapping and route shell with stable immersion/Practise/Evaluate and secondary Plan/Knowledge/Progress/Settings.
- [ ] Route native menu/bridge entries through that boundary; keep overlay/lookup/setup/plugin hosts.
- [ ] Restore tactile Home cards with real media recents and separate Open/Resume.
- [ ] Run focused navigation tests and typecheck; demonstrate destination identity in matching app before commit.

### Task 2: M2 learning lifecycle and workspace
Files: learning/studySessionController.ts + tests; common/StudyEncounter and RatingMatrix; FlashcardReview; levelStudy/GrammarCoverage, LevelStudyTab, MockExam; wordSync/App.
Interface: retain multiple suspended activities, one foreground input owner, canonical writes retain immutable attempts and retry identities.
- [ ] Reproduce Undo/rerate and persisted events before changing admission.
- [ ] Test requested scope outranks paused unrelated work, two suspended activities, correction/replay and retry/navigation.
- [ ] Extract Plan inspection from grammar/mock execution into purpose routes; shared content/layout/input owns reveal/chords/focus.
- [ ] Preserve real mock timing/feedback and mixed recall semantics; remove superseded inline hosts.
- [ ] Run focused regressions, typecheck and copied-profile J03/J05–J14/J21; commit coherent changes.

### Task 3: M3 scope and peripheral integration
Files: LearningPlanSettings, LearningGoals + shared scope; Knowledge/material route; statistics/Dashboard; conversationAgent/App and memoryBrowser/App; settings/recovery and native aliases.
- [ ] Test assessed state does not overwrite intended target, unknown requirements survive, scoped stats and operation-specific Messenger readiness.
- [ ] Remove generic-goal runtime after tracing persisted data obligations; preserve structured package identities.
- [ ] Integrate character knowledge, saved management, inspector, social memory context and device connections.
- [ ] Verify J04/J15–J20/J22/J23 with normal loaded packages and safe copied history; commit.

### Task 4: M4 removal and acceptance
- [ ] Prove old paths have no live callers and remove obsolete entry assets, helpers, CSS and references; ledger each disposition.
- [ ] Run full appropriate tests, both typechecks, desktop/mobile builds and matching built app with clean + returning profiles.
- [ ] Record J01–J24 individually, persisted evidence and baseline/changed latency; unsupported content remains separate from broken integration.
- [ ] Perform at most one fresh integrated read-only review (or labeled self-review), fix concrete in-scope findings, recheck affected cases.
- [ ] Deliver surface/owner/removal map, scoped commits, build/profile provenance and limitations. No whole-product/pilot readiness claim.
