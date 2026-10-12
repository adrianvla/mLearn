# mLearn v3 — Agent Guide

## What this repository is

mLearn is a local-first, open-world language immersion and learning application. This `rewrite/v3` branch is a **greenfield implementation** within the original v1 → v2 → v3 Git history, not a port or cleanup of v2.

**Target architecture (do not claim a component exists before it is built):** portable Rust core; Tauri 2 + React DOM on desktop; Expo/React Native on iOS and Android; shared typed contracts and feature behavior. npm workspaces + Cargo workspaces. No shipped Python runtime, Electron, or Capacitor. Prefer on-device inference with portable runtimes where feasible; make model/platform limitations explicit. Large local LLMs may use separate optional backends.

Rust owns durable learner state, storage, learning decisions, and platform-independent computation. Frontends own bounded interaction state and platform-specific presentation. Do not mirror entire databases into JS stores, pass inference tensors through UI state, or make a renderer authoritative over persisted knowledge. Keep host-specific APIs behind adapters.

## Use v2 as a reference, never as the foundation

- Consult `refactor/minimize-tech-debt`, its commit history, earlier v2.9-era commits/tags, and the eventual `archive/v2-final` tag to reconstruct requirements. The refactor branch may still move; cite an exact commit SHA when documenting findings.
- Read source, historical UI/CSS, tests, docs, and representative persisted data. Differentiate **intended behavior**, **observed implementation**, **known regression**, and **new proposal**. Recent HEAD is not necessarily the desired UX.
- Reimplement production logic and components against reviewed contracts. Do **not** mechanically translate/copy Solid components, Electron/Python services, legacy settings wiring, or IPC abstractions.
- Selectively reuse CSS, design tokens, icons, licensed assets, and other genuinely reusable visual materials. Preserve the characteristic **v2.9 desktop design**, not the later unwanted redesigns. Adapt presentation for native mobile instead of making desktop look like a phone.
- Never edit, merge into, or force-push the v2 reference branch as part of v3 work. Avoid broad merges of the old tree; inspect and deliberately port relevant fixes or tests.

## Open-world language packages are non-negotiable

- Core provides mechanisms: package loading/verification, capability discovery, storage and graph primitives, generic UI slots, validation, and adapter invocation. **Language packages provide linguistic semantics**, data, rules, schemas, and optional behavior.
- Adding a language must **not** require adding its language code or linguistic concepts to core. No `if (language === 'ja')`, language-specific shared fields, fixed POS/case/gender/number/prosody inventories, or central registry of every possible linguistic concept.
- A language-owned feature may attach to a sense, form, morpheme, token, span, construction, discourse entity, or another package-defined entity. Values may be structured, relational, contextual, or unknown to core.
- Preserve valid unknown, namespaced package data on load → store → export. Missing capabilities should degrade gracefully. Support executable/behavioral extensions only through documented cross-platform host contracts; account for iOS execution restrictions without pretending arbitrary native code can be downloaded.
- Prove extensibility with a synthetic third-party language that introduces unknown structured features and capabilities without changing core code.

## Learner correctness, storage, and performance

- Separate encounters/exposures, learner observations, explicit ratings, derived knowledge, SRS scheduling, and forecasts. Passive interaction must not silently become assessment evidence.
- Review selects due items through the scheduler; targeted practice/cramming is a separate workflow. Preserve the distinctions between probe modalities (written word, audio, reading, meaning, pronunciation, etc.) rather than flattening them into one card.
- Persist rating, evidence, retraction/undo, and sync intent atomically. Use idempotent commands, revision/receipt handling, and crash-safe recovery. Never rewrite a large JSON store for every rating.
- Build a **lossless, testable, reversible v2 data importer** before reading real profiles in v3. Never mutate the production v2 profile. Preserve unknown extension data and histories, not just current flashcard labels.
- Measure latency, peak/steady memory, DB/WAL size, and long-session behavior on real platforms; avoid per-item unbounded caches, repeated scans, and full-state reserialization. Treat prior heap exhaustion and stalled loading as architecture-level failure cases.

## UI and platform behavior

- Desktop: dense, keyboard-first, translucent custom mLearn design. Mobile: native-feeling navigation/controls, touch/gesture/accessibility behavior, with shared semantics and appropriate platform-specific renderers.
- Reuse semantic feature contracts where useful; do not force identical JSX, DOM elements, popover mechanics, or one component hierarchy on desktop and mobile.
- Keep colors, themes, localization, and settings effects centrally defined. No hardcoded language-specific UI assumptions, generic AI-dashboard styling, or emoji stand-ins for icons.
- Treat media readers, video/subtitles, OCR overlays, word inspection, voice, agent conversations, plugins, sync, recovery, and school flows as real parity work. Document platform restrictions as blockers or explicit adaptations, never silently omit them.

## How to implement a feature

1. Inspect the relevant pinned v2 source/history, UI, and data; record its contract, intended behavior, and known defects.
2. Define the smallest cross-platform interface and focused acceptance tests. Do not invent an abstraction before a real use case demands it.
3. Implement a complete vertical slice: core → storage/inference as applicable → desktop/mobile presentation → restart/undo/error behavior.
4. Verify builds and tests **and** exercise real user-facing workflows on representative data, including persisted state. Inspect screenshots for visual work; use actual iOS/Android devices for mobile claims.
5. Report exactly what was observed, not just which tests passed. Keep unverified surfaces and gaps explicit; never declare an app-wide workflow finished from agent summaries, test counts, or superficial polish.

Prefer small independently reviewable commits. Preserve data and user-facing workflows over rapid bulk changes. Do not introduce fake production implementations, pretend a stub is feature parity, or silently expand scope.

## Repository conventions

- Planned roots: `apps/desktop`, `apps/mobile`, `crates/`, `packages/`, `fixtures/legacy`, `docs/`. Keep this section aligned with the **actual** scaffold as it evolves.
- Use strict TypeScript, Rust formatting/lints, automated tests, and checked-in dependency lockfiles. Do not prescribe nonexistent commands; document commands after they are verified.
- Never commit real user profiles, credentials, voice samples, or private school data. Tests use synthetic or sanitized fixtures.
- Keep important architectural contracts and a feature-by-feature parity/verification register under `docs/`, so subsequent agents do not rediscover requirements or mislabel incomplete work.
