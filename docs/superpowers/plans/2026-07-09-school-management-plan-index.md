# School Management Platform Plan Index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan suite task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete school management platform specified in `docs/superpowers/specs/2026-07-09-school-management-platform-design.md` through independently reviewable subsystems.

**Architecture:** The Rust management service becomes the canonical identity, group, policy, analytics, and LLM control plane. The main app keeps its existing cloud endpoint contracts and adds only active-group selection, policy enforcement, and a frontend-only activity pipeline. The React/HeroUI console consumes the same permission-scoped API.

**Tech Stack:** Rust 1.75+, Axum 0.8, Tokio, SQLx/SQLite, React 19, HeroUI 3, TypeScript 5.7, SolidJS, IndexedDB, Vitest.

## Global Constraints

- Preserve `cloudLoginUrl`, `cloudApiUrl`, `overrideCloudEndpointUrl`, and the existing `/api/llm/stream` SSE contract.
- Keep activity collection frontend-only so Electron, browser, and Capacitor share one implementation.
- Use `app.user.activity` as the plugin-compatible live activity projection; do not add parallel renderer instrumentation.
- Groups form a strict single-parent tree; permissions apply only to a granted group and descendants.
- Policies attach to groups, inherit root-to-leaf, and retain parent hard-deny and maximum-limit constraints.
- LLM quota checks reserve atomically before provider contact and charge learner plus every ancestor group.
- Use HeroUI 3 primitives with the approved near-black, charcoal, white, and blue visual composition.
- Use `updateSetting()` and `updateSettings()` for main-app settings; never mutate the settings store directly.
- Do not add language-code conditionals; language profiles remain metadata-driven.
- Write tests before implementation in every task and keep commits scoped to the files listed by that task.
- Preserve unrelated dirty-worktree changes.

---

## Execution Order

1. [Identity, persistence, and hierarchical groups](./2026-07-09-school-management-identity-groups.md)
2. [Group policy delivery and main-app enforcement](./2026-07-09-school-management-policies.md)
3. [LLM gateway, conversations, and hierarchical quotas](./2026-07-09-school-management-llm-gateway.md)
4. [Frontend activity hub and analytics](./2026-07-09-school-management-analytics.md)
5. [HeroUI administration console and final integration](./2026-07-09-school-management-console.md)

Plans are dependency-ordered. A later plan may start only after the earlier plan's exported interfaces and focused verification commands pass. Each plan produces usable software: named account/group administration; enforced policies; compatible governed LLM streaming; cross-platform learning analytics; then the complete production console.

## Suite Completion Gate

Run all of the following after Plan 5:

```bash
cargo test --manifest-path management/backend/Cargo.toml
npm --prefix management/frontend run test
npm --prefix management/frontend run typecheck
npm --prefix management/frontend run build
npm run test
npm run typecheck
npm run build
npm run build:mobile
git diff --check
```

Expected: every command exits `0`; production and Capacitor builds complete; no whitespace errors.
