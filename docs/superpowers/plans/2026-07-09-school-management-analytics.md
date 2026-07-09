# School Management Activity and Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing app activity model into one frontend-only, cross-platform telemetry pipeline and expose permission-scoped learner/content/LLM analytics with upward group rollups.

**Architecture:** A renderer `ActivityHub` owns typed source state and sessionization. Existing reader/video/flashcard publishers call it once; adapters mirror live state to Electron plugins and enqueue durable management events in IndexedDB. The backend ingests idempotently and queries raw events plus SQL rollups under centralized subtree authorization.

**Tech Stack:** TypeScript/SolidJS, native IndexedDB, BroadcastChannel, Web Fetch, Vitest, Rust/SQLx SQLite.

## Global Constraints

- Analytics collection stays in the frontend; do not add Electron main-process upload logic or a Capacitor native bridge.
- Preserve Discord plugin behavior through `app.user.activity`.
- Do not upload raw document text, subtitle text, OCR output, or unrelated settings.
- Every event includes active group and policy version; the server derives user identity from the access token.
- Delivery never blocks learning and uses no polling timer.
- Ingestion is idempotent and tolerates duplicate or reordered offline batches.
- Parent analytics sum descendant data; teachers cannot query ancestors or siblings.

---

### Task 1: Platform-neutral ActivityHub and session events

**Files:**
- Modify: `src/shared/plugins/appActivity.ts`
- Create: `src/renderer/services/activityHub.ts`
- Create: `src/renderer/services/activityHub.test.ts`
- Create: `src/renderer/services/activitySessionizer.ts`
- Create: `src/renderer/services/activitySessionizer.test.ts`

**Interfaces:**
- Produces: `activityHub.updateSource(sourceId, { isFocused, activity, context })`.
- Produces: `activityHub.subscribeLive(listener)` and `activityHub.subscribeEvents(listener)`.
- Produces: `ManagementActivityEventV1` union.

- [ ] **Step 1: Write failing focus and sessionization tests**

```ts
it('emits one started, coalesced progress, and completed event', () => {
  const events: ManagementActivityEventV1[] = [];
  const hub = createActivityHub({ now: sequenceClock(), emitEvent: event => events.push(event) });
  hub.updateSource('video-route', focused(video('lesson-1', 0, 120)));
  hub.updateSource('video-route', focused(video('lesson-1', 5, 120)));
  hub.updateSource('video-route', focused(video('lesson-1', 16, 120)));
  hub.updateSource('video-route', focused(video('lesson-1', 120, 120)));
  expect(events.map(e => e.type)).toEqual(['activity.started', 'activity.progressed', 'activity.completed']);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run --project renderer src/renderer/services/activityHub.test.ts src/renderer/services/activitySessionizer.test.ts`

Expected: FAIL because the hub/sessionizer do not exist.

- [ ] **Step 3: Extend `AppActivity` additively**

Keep existing fields for Discord and add optional stable metadata:

```ts
export type ActivityContext = {
  contentId?: string;
  language?: string;
  privacy: 'title-and-progress' | 'progress-only';
};

export type ManagementActivityEventV1 = {
  schemaVersion: 1;
  id: string;
  type: 'activity.started' | 'activity.progressed' | 'activity.completed' | 'activity.stopped';
  sessionId: string;
  sourceId: string;
  activeGroupId: string;
  policyVersionId: string;
  sequence: number;
  occurredAt: string;
  activity: AppActivity;
  context: ActivityContext;
};
```

- [ ] **Step 4: Implement deterministic source and session behavior**

Reuse structural equality and 15-second video threshold logic from `appActivity.ts`. Emit stop on focus loss/source removal, complete at 100% progress, and a new start when kind/content changes. Inject clock/UUID functions in tests.

- [ ] **Step 5: Run focused tests**

Expected: idle transitions, focus changes, reader pages, video thresholds, flashcards, and no-op suppression PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/plugins/appActivity.ts src/renderer/services/activityHub* src/renderer/services/activitySessionizer*
git commit -m "feat: add cross-platform activity hub"
```

### Task 2: Refactor existing publishers and preserve Discord projection

**Files:**
- Modify: `src/renderer/windows/main/routes/readerPluginActivity.ts`
- Modify: `src/renderer/windows/main/routes/VideoRoute.tsx`
- Modify: `src/renderer/windows/flashcards/pluginActivity.ts`
- Create: `src/renderer/services/electronPluginActivityAdapter.ts`
- Modify: `src/renderer/context/WindowWrapper.tsx`
- Modify: existing activity tests under reader/video/flashcards
- Create: `src/renderer/services/electronPluginActivityAdapter.test.ts`

**Interfaces:**
- Consumes: `ActivityHub` from Task 1.
- Produces: one plugin adapter that calls `window.mLearnInternal?.setScopedPluginValue`.

- [ ] **Step 1: Rewrite tests against one publisher boundary**

```ts
it('publishes video state once to the hub and mirrors the live value to Electron', () => {
  publishVideoActivity(videoState);
  expect(activityHub.updateSource).toHaveBeenCalledTimes(1);
  expect(setScopedPluginValue).toHaveBeenCalledWith(expect.objectContaining({
    channel: 'app.user.activity',
    sourceId: 'video-route',
  }));
});
```

- [ ] **Step 2: Run affected tests and confirm failure**

Run: `npx vitest run --project renderer src/renderer/windows/main/routes/VideoRoute.activity.test.ts src/renderer/windows/main/routes/readerPluginActivity.test.ts src/renderer/windows/flashcards/App.activity.test.tsx`

- [ ] **Step 3: Route publishers through `ActivityHub`**

Remove direct plugin IPC calls from reader/video/flashcards helpers. Register `ElectronPluginActivityAdapter` once per window through `WindowWrapper`; it mirrors live hub changes only when `mLearnInternal` exists.

- [ ] **Step 4: Keep main-process arbitration unchanged**

Do not rewrite `src/electron/services/pluginBus.ts`. Its focused-source behavior remains the cross-window Discord source of truth.

- [ ] **Step 5: Run renderer and plugin tests**

Run: `npx vitest run --project renderer src/renderer/windows/main/routes/VideoRoute.activity.test.ts src/renderer/windows/flashcards/App.activity.test.tsx`

Run: `npx vitest run --project node src/electron/services/pluginBus.test.ts examples/plugins/discord-activity/src/runtime.test.ts`

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/windows src/renderer/services/electronPluginActivityAdapter* src/renderer/context/WindowWrapper.tsx
git commit -m "refactor: share app activity with plugins and analytics"
```

### Task 3: IndexedDB queue and authenticated management adapter

**Files:**
- Create: `src/renderer/services/activityQueue.ts`
- Create: `src/renderer/services/activityQueue.test.ts`
- Create: `src/renderer/services/managementAnalyticsAdapter.ts`
- Create: `src/renderer/services/managementAnalyticsAdapter.test.ts`
- Modify: `src/renderer/context/WindowWrapper.tsx`
- Modify: `src/renderer/services/cloudSessionManager.ts`

**Interfaces:**
- Produces: `ActivityQueue::{enqueue, peekBatch, acknowledge, compact, stats}`.
- Produces: `ManagementAnalyticsAdapter::{start, flush, stop}`.

- [ ] **Step 1: Write failing queue/idempotency tests**

```ts
it('retains a batch until every accepted event is acknowledged', async () => {
  const queue = await createTestActivityQueue();
  await queue.enqueue(EVENT_A);
  await queue.enqueue(EVENT_B);
  await queue.acknowledge(['a']);
  expect((await queue.peekBatch(10, 64_000)).map(e => e.id)).toEqual(['b']);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run --project renderer src/renderer/services/activityQueue.test.ts src/renderer/services/managementAnalyticsAdapter.test.ts`

- [ ] **Step 3: Implement native IndexedDB storage**

Database: `mlearn-management-analytics`, store `events`, key `id`, index `[occurredAt, sequence]`. Bound by configured event and byte limits. Compact oldest progress events first while retaining start/completion/stop; persist dropped count.

- [ ] **Step 4: Implement authenticated batching**

POST `{ schemaVersion: 1, events }` to `${resolveCloudApiUrl(settings)}/api/analytics/events` using `ensureCloudAccessToken()`. Flush on count/byte threshold, `online`, `visibilitychange`, `pagehide`, and successful session refresh. Serialize flushes with one in-flight promise; do not poll.

- [ ] **Step 5: Register once per renderer window**

`WindowWrapper` starts the adapter after settings/session/active-group readiness and stops it on cleanup. The adapter ignores events while signed out or without active group/policy context.

- [ ] **Step 6: Run tests, typecheck, and Capacitor build**

Run: `npx vitest run --project renderer src/renderer/services/activityQueue.test.ts src/renderer/services/managementAnalyticsAdapter.test.ts`

Run: `npm run typecheck && npm run build:mobile`

Expected: PASS; no Electron imports enter the new files.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/services/activityQueue* src/renderer/services/managementAnalyticsAdapter* src/renderer/context/WindowWrapper.tsx src/renderer/services/cloudSessionManager.ts
git commit -m "feat: deliver activity analytics across platforms"
```

### Task 4: Idempotent analytics ingestion

**Files:**
- Create: `management/backend/migrations/0008_analytics.sql`
- Create: `management/backend/src/analytics/mod.rs`
- Create: `management/backend/src/analytics/ingestion.rs`
- Replace: `management/backend/src/routes/analytics.rs`
- Modify: `management/backend/src/lib.rs`
- Modify: `management/backend/src/main.rs`
- Test: `management/backend/src/analytics/ingestion.rs`

**Interfaces:**
- Produces: `AnalyticsIngestionService::ingest(principal, batch) -> IngestionResult`.
- Produces: `POST /api/analytics/events` returning `{ acceptedIds, duplicateIds, rejected }`.

- [ ] **Step 1: Write failing duplicate/reorder tests**

```rust
#[tokio::test]
async fn duplicate_and_reordered_batches_are_idempotent() {
    let f = AnalyticsFixture::new().await;
    let first = f.ingest(vec![event(2), event(1)]).await.unwrap();
    let second = f.ingest(vec![event(1), event(2)]).await.unwrap();
    assert_eq!(first.accepted_ids.len(), 2);
    assert_eq!(second.duplicate_ids.len(), 2);
    assert_eq!(f.event_count().await, 2);
}
```

- [ ] **Step 2: Run and confirm failure**

Run: `cargo test --manifest-path management/backend/Cargo.toml analytics::ingestion::tests`

- [ ] **Step 3: Create validated event storage**

Create `activity_events` with unique `(user_id, event_id)`, group ancestry snapshot, policy version, activity kind, content ID/title subject to privacy flag, progress, timestamps, and payload version. Server ignores client user IDs and attaches the authenticated principal.

- [ ] **Step 4: Validate active-group membership and sequence**

Accept only the principal's active group. Reject unknown schema/activity kinds, impossible progress, oversized titles, and events outside retention/skew limits. Return row-specific rejection codes without rejecting valid sibling rows in the batch.

- [ ] **Step 5: Run ingestion and authorization tests**

Expected: duplicates/reordering succeed safely; revoked membership fails; spoofed user/group fields cannot change ownership.

- [ ] **Step 6: Commit**

```bash
git add management/backend
git commit -m "feat(management): ingest learner activity events"
```

### Task 5: Upward rollups and permission-scoped analytics queries

**Files:**
- Create: `management/backend/src/analytics/queries.rs`
- Create: `management/backend/src/analytics/rollups.rs`
- Modify: `management/backend/src/routes/analytics.rs`
- Test: `management/backend/src/analytics/queries.rs`
- Test: `management/backend/src/analytics/rollups.rs`

**Interfaces:**
- Produces: learner, group, content, language, and LLM usage analytics DTOs.
- Produces cursor-paginated `/api/analytics/*` endpoints.

- [ ] **Step 1: Write failing rollup/isolation test**

```rust
#[tokio::test]
async fn parent_sums_descendants_while_child_cannot_query_parent_or_sibling() {
    let f = AnalyticsFixture::german_tree().await;
    f.record_watch(&f.german_a_learner, 600).await;
    f.record_watch(&f.german_b_learner, 300).await;
    assert_eq!(f.summary(&f.german_manager, &f.german).await.total_watch_seconds, 900);
    assert_eq!(f.summary(&f.german_a_teacher, &f.german_a).await.total_watch_seconds, 600);
    assert!(f.summary(&f.german_a_teacher, &f.german_b).await.is_err());
}
```

- [ ] **Step 2: Run and confirm failure**

Run: `cargo test --manifest-path management/backend/Cargo.toml analytics::rollups::tests`

Run: `cargo test --manifest-path management/backend/Cargo.toml analytics::queries::tests`

- [ ] **Step 3: Implement query-time rollups first**

Use recursive descendant CTEs and indexed raw/LLM usage tables for correctness. Expose summary, timeseries, learners, content, and LLM usage/cost/quota remaining. Apply `analytics.view` to the requested root group before building any query.

- [ ] **Step 4: Add materialized daily rollups only for measured hotspots**

Create `analytics_daily_rollups` and upsert affected learner/group/ancestor/day rows in the ingestion transaction. Keep raw-event query parity tests so rollups cannot drift silently.

- [ ] **Step 5: Add stable cursor pagination and CSV export authorization**

Use `(occurred_at, id)` cursors. Export requires `analytics.view` at the requested group and an effective policy that permits teacher exports; audit every export.

- [ ] **Step 6: Enforce activity retention**

During ingestion and explicit administrator maintenance, delete expired raw activity according to the effective school retention floor while preserving configured non-identifying daily aggregates and dropped-event accounting. Add a test that expired child events disappear from both child and parent raw-event queries without changing retained aggregate totals.

- [ ] **Step 7: Run full backend, root tests, typecheck, and mobile build**

Run: `cargo test --manifest-path management/backend/Cargo.toml`

Run: `npm run test && npm run typecheck && npm run build:mobile`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add management/backend src/shared/plugins src/renderer/services src/renderer/windows src/renderer/context/WindowWrapper.tsx
git commit -m "feat: add hierarchical learning analytics"
```
