# Management Analytics and Console Product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build factual historical analytics, lean governance, console notifications, administrative activity, authorized search, user/provider history, and saved analytics views without inferring learner outcomes.

**Architecture:** Extend the existing Rust/SQLite management backend with narrowly scoped query services and migrations, then expose typed REST contracts to the React/HeroUI console. Activity rollups remain canonical for charts, raw events remain retention-limited drill-down evidence, and LLM, audit, provider-health, notification, and preference data remain separate domains composed by page-level APIs.

**Tech Stack:** Rust, Axum, SQLx, SQLite, React, TypeScript, HeroUI, Vitest, Testing Library, Cargo test, Clippy.

## Global Constraints

- Use one permission-aware console; do not create separate teacher and administrator dashboards.
- Show factual trends and history only; never infer struggle, comprehension, content difficulty, or learning improvement.
- Preserve group authorization and descendant scoping on every endpoint.
- Use the school quota-calendar timezone and an explicit UTC fallback.
- Distinguish zero, missing, incomplete, and retention-expired data.
- Use HeroUI components for all interactive console controls.
- Every graph must have an accessible exact-value table.
- Console notifications only; no email, webhooks, escalation, assignment, or comments.
- Preserve all existing routes, exports, policies, logs, settings, and LLM workflows.

---

### Task 1: Historical analytics contract and aggregation

**Files:**
- Modify: `management/backend/src/analytics/queries.rs`
- Modify: `management/backend/src/routes/analytics.rs`
- Modify: `management/frontend/src/api/types.ts`
- Test: `management/backend/src/analytics/queries.rs`
- Test: `management/backend/src/routes/analytics.rs`

**Interfaces:**
- Produces: `AnalyticsMetric`, `AnalyticsGranularity`, `HistoricalAnalyticsQuery`, `HistoricalSeries`, `PeriodComparison`, and `GET /api/analytics/history`.
- Consumes: existing `activity_events`, `analytics_daily_rollups`, `llm_requests`, `llm_policy_block_events`, `Principal`, and `AuthorizationService`.

- [ ] **Step 1: Write failing aggregation tests**

```rust
#[tokio::test]
async fn history_aligns_primary_and_previous_period_in_school_timezone() {
    let fixture = analytics_fixture("Europe/Paris").await;
    fixture.record_reader_day("learner", "2026-03-28", 12).await;
    fixture.record_reader_day("learner", "2026-03-29", 18).await;
    let result = fixture.history(HistoryQuery {
        from: 1_774_656_000_000,
        to: 1_774_828_800_000,
        granularity: AnalyticsGranularity::Daily,
        metrics: vec![AnalyticsMetric::ReaderPages],
        comparison: ComparisonMode::PreviousPeriod,
    }).await.unwrap();
    assert_eq!(result.timezone, "Europe/Paris");
    assert_eq!(result.primary.len(), 2);
    assert_eq!(result.comparison.as_ref().unwrap().len(), 2);
}

#[tokio::test]
async fn history_marks_missing_rollup_buckets_without_turning_them_into_zero() {
    let fixture = analytics_fixture("UTC").await;
    let result = fixture.history(default_history_query()).await.unwrap();
    assert_eq!(result.primary[0].coverage, Coverage::Missing);
    assert_eq!(result.primary[0].values.reader_pages, None);
}
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `cargo test --manifest-path management/backend/Cargo.toml analytics::queries::tests::history -- --nocapture`

Expected: FAIL because the history types and query do not exist.

- [ ] **Step 3: Add exact backend types and boundary calculation**

```rust
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AnalyticsGranularity { Daily, Weekly, Monthly }

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ComparisonMode { None, PreviousPeriod, PreviousYear }

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Coverage { Complete, Partial, Missing, RawExpired }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoricalBucket {
    pub start: i64,
    pub end: i64,
    pub coverage: Coverage,
    pub values: AnalyticsSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoricalSeries {
    pub timezone: String,
    pub granularity: AnalyticsGranularity,
    pub primary: Vec<HistoricalBucket>,
    pub comparison: Option<Vec<HistoricalBucket>>,
}
```

Implement bucket boundaries with `chrono_tz::Tz`; aggregate activity from `analytics_daily_rollups` and LLM values from `llm_requests` using the same `[from, to)` boundaries. Never divide by zero when calculating comparisons.

- [ ] **Step 4: Add and test the route**

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryParams {
    group_id: String,
    from: i64,
    to: i64,
    granularity: AnalyticsGranularity,
    comparison: ComparisonMode,
}

async fn history(
    State(state): State<AppState>,
    principal: Principal,
    Query(query): Query<HistoryParams>,
) -> Result<Json<HistoricalSeries>, AppError> {
    Ok(Json(state.analytics.history(&principal, &query.group_id, query).await?))
}
```

Register `GET /api/analytics/history`. Test sibling denial, descendant inclusion, a 366-day maximum, DST boundaries, and the UTC fallback.

- [ ] **Step 5: Add matching frontend DTOs**

```ts
export type AnalyticsGranularity = 'daily' | 'weekly' | 'monthly';
export type ComparisonMode = 'none' | 'previousPeriod' | 'previousYear';
export type AnalyticsCoverage = 'complete' | 'partial' | 'missing' | 'rawExpired';
export interface HistoricalBucket {
  start: number;
  end: number;
  coverage: AnalyticsCoverage;
  values: AnalyticsSummary;
}
export interface HistoricalSeries {
  timezone: string;
  granularity: AnalyticsGranularity;
  primary: HistoricalBucket[];
  comparison: HistoricalBucket[] | null;
}
```

- [ ] **Step 6: Run tests and commit**

Run: `cargo test --manifest-path management/backend/Cargo.toml analytics::queries routes::analytics`

Expected: PASS.

```bash
git add management/backend/src/analytics/queries.rs management/backend/src/routes/analytics.rs management/frontend/src/api/types.ts
git commit -m "feat(management): add historical analytics contract"
```

### Task 2: Shared historical chart system

**Files:**
- Create: `management/frontend/src/components/charts/HistoricalChart.tsx`
- Create: `management/frontend/src/components/charts/HistoricalChart.test.tsx`
- Create: `management/frontend/src/components/charts/StackedActivityChart.tsx`
- Create: `management/frontend/src/components/charts/chartTypes.ts`
- Modify: `management/frontend/src/index.css`

**Interfaces:**
- Consumes: `HistoricalBucket`, `AnalyticsCoverage`, and normalized `ChartSeries`.
- Produces: `HistoricalChart`, `StackedActivityChart`, and accessible exact-value tables.

- [ ] **Step 1: Write failing component tests**

```tsx
it('renders primary and comparison values in an accessible table', () => {
  render(<HistoricalChart title="Sessions" series={fixtureSeries} />);
  expect(screen.getByRole('img', { name: 'Sessions history' })).toBeVisible();
  expect(screen.getByRole('table', { name: 'Sessions data' })).toHaveTextContent('Previous period');
  expect(screen.getByText('No recorded data')).toBeVisible();
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `cd management/frontend && npm test -- --run src/components/charts/HistoricalChart.test.tsx`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement normalized chart types and rendering**

```ts
export interface ChartDatum {
  start: number;
  end: number;
  value: number | null;
  coverage: AnalyticsCoverage;
}
export interface ChartSeries {
  key: string;
  label: string;
  kind: 'primary' | 'comparison';
  values: ChartDatum[];
}
```

Render SVG paths only for contiguous non-null values. Render comparison paths with a dashed stroke. Render the exact same data in a visually hidden table and expose missing or partial coverage in its cells.

- [ ] **Step 4: Add responsive HeroUI presentation and pass tests**

Use HeroUI `Card`, `Tabs`, `Tooltip`, and `Button` for the chart shell and metric toggles. Do not add native interactive controls.

Run: `cd management/frontend && npm test -- --run src/components/charts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add management/frontend/src/components/charts management/frontend/src/index.css
git commit -m "feat(management): add accessible historical charts"
```

### Task 3: Analytics workspace and comparison UI

**Files:**
- Modify: `management/frontend/src/pages/Analytics.tsx`
- Modify: `management/frontend/src/pages/Analytics.test.tsx`
- Create: `management/frontend/src/pages/analytics/AnalyticsFilters.tsx`
- Create: `management/frontend/src/pages/analytics/AnalyticsOverview.tsx`
- Create: `management/frontend/src/pages/analytics/AnalyticsHistoryTable.tsx`
- Modify: `management/frontend/src/index.css`

**Interfaces:**
- Consumes: `GET /api/analytics/history`, existing learner/content/LLM/policy endpoints, `HistoricalChart`, and `StackedActivityChart`.
- Produces: preset/custom ranges, comparison selection, granularity selection, visible-series toggles, charts, and exact history tables.

- [ ] **Step 1: Write failing page tests**

```tsx
it('loads a previous-period comparison and keeps chart and table values aligned', async () => {
  render(<Analytics />);
  fireEvent.click(await screen.findByRole('button', { name: /Comparison/i }));
  fireEvent.click(screen.getByRole('option', { name: 'Previous period' }));
  expect(await screen.findByRole('img', { name: 'Activity history' })).toBeVisible();
  expect(screen.getByRole('table', { name: 'Activity history data' })).toHaveTextContent('Previous period');
});
```

- [ ] **Step 2: Verify failure**

Run: `cd management/frontend && npm test -- --run src/pages/Analytics.test.tsx`

Expected: FAIL because comparison controls and historical panels do not exist.

- [ ] **Step 3: Split the page and implement filters**

`AnalyticsFilters` owns only controlled filter values:

```ts
export interface AnalyticsFilterValue {
  from: number;
  to: number;
  preset: '7' | '30' | '90' | '365' | 'custom';
  comparison: ComparisonMode;
  granularity: AnalyticsGranularity | 'auto';
}
```

Use `DatePickerField` for custom boundaries and `ConsoleSelect` for preset, comparison, and granularity. Keep export parameters derived from the same state.

- [ ] **Step 4: Implement overview panels and independent errors**

Fetch historical activity, LLM, and policy data independently. A failed LLM request renders an error state only inside the LLM panel. Do not clear successfully loaded activity data.

- [ ] **Step 5: Implement tabs and factual labels**

Use labels `Reader pages recorded`, `Video minutes recorded`, and `Flashcard sessions`. Do not use `learning progress`, `difficulty`, `at risk`, or `struggling`.

- [ ] **Step 6: Run page tests, typecheck, and commit**

Run: `cd management/frontend && npm test -- --run src/pages/Analytics.test.tsx src/components/charts && npm run typecheck`

Expected: PASS.

```bash
git add management/frontend/src/pages/Analytics.tsx management/frontend/src/pages/Analytics.test.tsx management/frontend/src/pages/analytics management/frontend/src/index.css
git commit -m "feat(management): build historical analytics workspace"
```

### Task 4: Factual drill-down histories

**Files:**
- Modify: `management/backend/src/analytics/queries.rs`
- Modify: `management/backend/src/routes/analytics.rs`
- Modify: `management/frontend/src/api/types.ts`
- Create: `management/frontend/src/pages/analytics/HistoryDrawer.tsx`
- Test: `management/backend/src/analytics/queries.rs`
- Test: `management/frontend/src/pages/Analytics.test.tsx`

**Interfaces:**
- Produces: `GET /api/analytics/history/events`, `HistoryEventPage`, and `HistoryDrawer`.
- Consumes: retained `activity_events`, LLM request metadata, policy-block metadata, cursor pagination, and current group authorization.

- [ ] **Step 1: Write retention and authorization tests**

```rust
#[tokio::test]
async fn history_drilldown_reports_expired_raw_coverage_without_fabricating_events() {
    let fixture = analytics_fixture("UTC").await;
    fixture.insert_rollup_without_raw_events().await;
    let page = fixture.history_events(default_event_query()).await.unwrap();
    assert_eq!(page.coverage, Coverage::RawExpired);
    assert!(page.items.is_empty());
}
```

- [ ] **Step 2: Verify failure**

Run: `cargo test --manifest-path management/backend/Cargo.toml history_drilldown -- --nocapture`

Expected: FAIL because the endpoint does not exist.

- [ ] **Step 3: Implement a cursor-paginated factual event DTO**

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEvent {
    pub id: String,
    pub occurred_at: i64,
    pub learner_id: Option<String>,
    pub activity_kind: String,
    pub event_type: String,
    pub content_title: Option<String>,
    pub reader_page: Option<i64>,
    pub video_time_millis: Option<i64>,
}
```

Return only fields already authorized for analytics. Never return prompt or conversation content.

- [ ] **Step 4: Implement the HeroUI drawer and test navigation**

Clicking a chart bucket opens `HistoryDrawer`, which shows coverage, exact date boundaries, totals, a paginated event table, and a retention-expired explanation when applicable.

- [ ] **Step 5: Run tests and commit**

Run: `cargo test --manifest-path management/backend/Cargo.toml analytics::queries routes::analytics && cd management/frontend && npm test -- --run src/pages/Analytics.test.tsx`

Expected: PASS.

```bash
git add management/backend/src/analytics/queries.rs management/backend/src/routes/analytics.rs management/frontend/src/api/types.ts management/frontend/src/pages/analytics/HistoryDrawer.tsx management/frontend/src/pages/Analytics.test.tsx
git commit -m "feat(management): add factual analytics drilldown"
```

### Task 5: Lean governance and console notifications

**Files:**
- Create: `management/backend/migrations/0017_console_notifications.sql`
- Create: `management/backend/src/routes/governance.rs`
- Modify: `management/backend/src/routes/mod.rs`
- Modify: `management/backend/src/lib.rs`
- Create: `management/frontend/src/pages/Governance.tsx`
- Create: `management/frontend/src/pages/Governance.test.tsx`
- Create: `management/frontend/src/components/NotificationMenu.tsx`
- Modify: `management/frontend/src/Layout.tsx`
- Modify: `management/frontend/src/App.tsx`
- Modify: `management/frontend/src/components/AppSidebar.tsx`

**Interfaces:**
- Produces: `GET /api/governance/summary`, `GET /api/notifications`, `PATCH /api/notifications/:id`, and the `/governance` page.
- Consumes: named policy state, quota buckets, provider status, API-key expiry, audit events, and group authorization.

- [ ] **Step 1: Write failing migration and route tests**

```sql
CREATE TABLE console_notification_state (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    fingerprint TEXT NOT NULL,
    read_at INTEGER,
    dismissed_at INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(user_id, fingerprint)
);
```

Test that the same low-quota condition returns one stable fingerprint, dismissed state is user-specific, and sibling-group conditions are not disclosed.

- [ ] **Step 2: Verify failure**

Run: `cargo test --manifest-path management/backend/Cargo.toml governance notifications -- --nocapture`

Expected: FAIL because the migration and routes do not exist.

- [ ] **Step 3: Implement derived notification and governance DTOs**

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleNotification {
    pub fingerprint: String,
    pub kind: String,
    pub severity: String,
    pub group_id: String,
    pub message: String,
    pub href: String,
    pub created_at: i64,
    pub read: bool,
    pub dismissed: bool,
}
```

Generate only unpublished-draft, low-quota, provider-unavailable, and expiring-key conditions. Store only per-user read/dismissed state; derive the condition from canonical tables.

- [ ] **Step 4: Build the lean Governance page**

Render three HeroUI sections: Policies, Usage and limits, and Recent governance activity. Every row links to Policies, LLM Gateway, or Activity Log. Do not add simulation, approval, drift, or remediation controls.

- [ ] **Step 5: Add top-bar notification menu**

Use HeroUI `Button`, `Popover`, and `ListBox`. Show unread count, mark-read, dismiss, and `View all`. Do not poll with a timer; refresh on navigation, group changes, and explicit user refresh.

- [ ] **Step 6: Run tests and commit**

Run: `cargo test --manifest-path management/backend/Cargo.toml governance notifications && cd management/frontend && npm test -- --run src/pages/Governance.test.tsx src/components/NotificationMenu.test.tsx && npm run typecheck`

Expected: PASS.

```bash
git add management/backend/migrations/0017_console_notifications.sql management/backend/src/routes management/backend/src/lib.rs management/frontend/src/pages/Governance.tsx management/frontend/src/pages/Governance.test.tsx management/frontend/src/components/NotificationMenu.tsx management/frontend/src/Layout.tsx management/frontend/src/App.tsx management/frontend/src/components/AppSidebar.tsx
git commit -m "feat(management): add lean governance notifications"
```

### Task 6: Administrative Activity Log

**Files:**
- Modify: `management/backend/src/routes/audit.rs`
- Create: `management/frontend/src/pages/ActivityLog.tsx`
- Create: `management/frontend/src/pages/ActivityLog.test.tsx`
- Modify: `management/frontend/src/App.tsx`
- Modify: `management/frontend/src/components/AppSidebar.tsx`
- Modify: `management/frontend/src/pages/Overview.tsx`

**Interfaces:**
- Produces: expanded safe audit filters and `/activity`.
- Consumes: immutable `audit_events`, cursor pagination, group subtree authorization, and existing `RecentActivityTable`.

- [ ] **Step 1: Write failing audit-filter tests**

Test `from`, `to`, `actorUserId`, `action`, `targetType`, and `targetId`; assert root includes descendants and child scope excludes ancestors and siblings.

- [ ] **Step 2: Verify failure**

Run: `cargo test --manifest-path management/backend/Cargo.toml routes::audit -- --nocapture`

Expected: FAIL for unsupported filters.

- [ ] **Step 3: Extend the safe audit DTO and query**

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuditQuery {
    group_id: String,
    from: Option<i64>,
    to: Option<i64>,
    actor_user_id: Option<String>,
    action: Option<String>,
    target_type: Option<String>,
    target_id: Option<String>,
    cursor: Option<String>,
    limit: Option<i64>,
}
```

Keep metadata redacted through the existing safe audit contract. Add a safe diff only where the mutation already recorded explicit before/after values.

- [ ] **Step 4: Build Activity Log and dashboard recent activity**

Use `ConsoleTextField`, `ConsoleSelect`, `DatePickerField`, `DataTableShell`, and `ConsoleDialog`. The dashboard shows the newest five important events and a `View all` link to `/activity`.

- [ ] **Step 5: Run tests and commit**

Run: `cargo test --manifest-path management/backend/Cargo.toml routes::audit && cd management/frontend && npm test -- --run src/pages/ActivityLog.test.tsx src/pages/Dashboard.test.tsx`

Expected: PASS.

```bash
git add management/backend/src/routes/audit.rs management/frontend/src/pages/ActivityLog.tsx management/frontend/src/pages/ActivityLog.test.tsx management/frontend/src/App.tsx management/frontend/src/components/AppSidebar.tsx management/frontend/src/pages/Overview.tsx
git commit -m "feat(management): add administrative activity log"
```

### Task 7: Authorized global search

**Files:**
- Create: `management/backend/src/routes/search.rs`
- Modify: `management/backend/src/routes/mod.rs`
- Create: `management/frontend/src/components/GlobalSearch.tsx`
- Create: `management/frontend/src/components/GlobalSearch.test.tsx`
- Modify: `management/frontend/src/Layout.tsx`

**Interfaces:**
- Produces: `GET /api/search?q=<bounded query>&limit=10` and top-bar search.
- Consumes: authorized users, visible groups, named policies, and React Router navigation.

- [ ] **Step 1: Write failing authorization tests**

Test that search returns only users in the authorized subtree, only visible groups, and only policies belonging to those groups. Reject queries shorter than two or longer than 100 characters.

- [ ] **Step 2: Verify failure**

Run: `cargo test --manifest-path management/backend/Cargo.toml routes::search -- --nocapture`

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement typed results**

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub kind: String,
    pub id: String,
    pub group_id: String,
    pub title: String,
    pub subtitle: String,
    pub href: String,
}
```

Use escaped `LIKE` matching against normalized display fields. This endpoint is read-only and must not accept action parameters.

- [ ] **Step 4: Build HeroUI search**

Use a HeroUI `Autocomplete` or `ComboBox` with grouped User, Group, and Policy results. Navigate only after selection. Close and clear the overlay after navigation.

- [ ] **Step 5: Run tests and commit**

Run: `cargo test --manifest-path management/backend/Cargo.toml routes::search && cd management/frontend && npm test -- --run src/components/GlobalSearch.test.tsx && npm run typecheck`

Expected: PASS.

```bash
git add management/backend/src/routes/search.rs management/backend/src/routes/mod.rs management/frontend/src/components/GlobalSearch.tsx management/frontend/src/components/GlobalSearch.test.tsx management/frontend/src/Layout.tsx
git commit -m "feat(management): add authorized global search"
```

### Task 8: User and provider histories

**Files:**
- Modify: `management/backend/src/analytics/queries.rs`
- Modify: `management/backend/src/routes/analytics.rs`
- Create: `management/backend/migrations/0018_provider_health_history.sql`
- Modify: `management/backend/src/llm/configuration.rs`
- Modify: `management/frontend/src/pages/Users.tsx`
- Modify: `management/frontend/src/pages/Users.test.tsx`
- Modify: `management/frontend/src/pages/LlmGateway.tsx`
- Create: `management/frontend/src/pages/llm/ProviderHistory.tsx`

**Interfaces:**
- Produces: factual user daily history, provider/model usage history, and durable provider-health checks.
- Consumes: Task 1 historical buckets, current provider health endpoint, `llm_requests`, and user detail dialog.

- [ ] **Step 1: Add failing history tests**

Assert user history contains only sessions, pages, video time, flashcard sessions, LLM usage, cost, and blocks. Assert provider health records configuration validity, whether a network check occurred, safe outcome, and timestamp without secrets or response bodies.

- [ ] **Step 2: Verify failure**

Run: `cargo test --manifest-path management/backend/Cargo.toml user_history provider_health_history -- --nocapture`

Expected: FAIL because the history contracts do not exist.

- [ ] **Step 3: Add provider-health migration and recording**

```sql
CREATE TABLE provider_health_checks (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL REFERENCES llm_providers(id) ON DELETE RESTRICT,
    actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    configuration_valid INTEGER NOT NULL CHECK(configuration_valid IN (0,1)),
    network_check_performed INTEGER NOT NULL CHECK(network_check_performed IN (0,1)),
    outcome TEXT NOT NULL CHECK(outcome IN ('healthy','configuration_error','network_error')),
    created_at INTEGER NOT NULL
);
CREATE INDEX provider_health_checks_provider_time_idx ON provider_health_checks(provider_id, created_at DESC, id DESC);
```

- [ ] **Step 4: Add User Activity tab and Provider History panels**

Use the shared historical charts and tables. Keep all labels factual. Preserve the existing user membership, device, session, status, provider, model, pricing, profile, quota, key, and reservation features.

- [ ] **Step 5: Run tests and commit**

Run: `cargo test --manifest-path management/backend/Cargo.toml user_history provider_health_history && cd management/frontend && npm test -- --run src/pages/Users.test.tsx src/pages/LlmGateway.test.tsx && npm run typecheck`

Expected: PASS.

```bash
git add management/backend/migrations/0018_provider_health_history.sql management/backend/src/analytics/queries.rs management/backend/src/routes/analytics.rs management/backend/src/llm/configuration.rs management/frontend/src/pages/Users.tsx management/frontend/src/pages/Users.test.tsx management/frontend/src/pages/LlmGateway.tsx management/frontend/src/pages/llm
git commit -m "feat(management): add user and provider history"
```

### Task 9: Saved analytics views and final integration

**Files:**
- Create: `management/backend/migrations/0019_saved_analytics_views.sql`
- Create: `management/backend/src/routes/analytics_views.rs`
- Modify: `management/backend/src/routes/mod.rs`
- Create: `management/frontend/src/pages/analytics/SavedViewSelector.tsx`
- Modify: `management/frontend/src/pages/Analytics.tsx`
- Modify: `management/frontend/src/pages/Analytics.test.tsx`
- Modify: `management/frontend/src/index.css`
- Modify: `design-qa.md`

**Interfaces:**
- Produces: private per-user saved analytics views and complete integrated console.
- Consumes: `AnalyticsFilterValue`, selected tab, visible metrics, breakdown, and the authenticated user.

- [ ] **Step 1: Write failing ownership tests**

Test create/list/update/delete for the owning user, rejection for another user, bounded names, schema validation, and rejection of group IDs outside current authorization.

- [ ] **Step 2: Verify failure**

Run: `cargo test --manifest-path management/backend/Cargo.toml analytics_views -- --nocapture`

Expected: FAIL because saved views do not exist.

- [ ] **Step 3: Add migration and route contract**

```sql
CREATE TABLE saved_analytics_views (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
    definition_json TEXT NOT NULL CHECK(json_valid(definition_json)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX saved_analytics_views_owner_idx ON saved_analytics_views(owner_user_id, updated_at DESC, id DESC);
```

The validated JSON schema contains only `groupId`, `from`, `to`, `preset`, `comparison`, `granularity`, `tab`, `visibleMetrics`, and `breakdown`.

- [ ] **Step 4: Add saved-view UI**

Use HeroUI `Select`, `Modal`, `Input`, and `Button`. Selecting a view replaces all analytics state atomically. Saving an existing view requires explicit overwrite confirmation.

- [ ] **Step 5: Run all verification gates**

Run:

```bash
cd management/frontend && npm test && npm run typecheck && npm run build
cd ../../ && npm run test && npm run typecheck && npm run build
npm run lint:management
cargo test --manifest-path management/backend/Cargo.toml
git diff --check
```

Expected: all commands PASS; Clippy emits no warnings.

- [ ] **Step 6: Perform live browser QA**

Build the management frontend, restart the embedded Rust server, and inspect `/`, `/analytics`, `/governance`, `/activity`, `/users`, `/policies`, `/llm-gateway`, and `/settings` at 1280x720 and 390x844. Verify page identity, nonblank content, no overlays, no horizontal overflow, zero browser console errors, chart/table agreement, comparison switching, notification read/dismiss, search navigation, history drill-down, and saved-view restoration.

Update `design-qa.md` with `final result: passed` only after every check succeeds.

- [ ] **Step 7: Commit final integration**

```bash
git add management/backend/migrations/0019_saved_analytics_views.sql management/backend/src/routes/analytics_views.rs management/backend/src/routes/mod.rs management/frontend/src/pages/analytics/SavedViewSelector.tsx management/frontend/src/pages/Analytics.tsx management/frontend/src/pages/Analytics.test.tsx management/frontend/src/index.css design-qa.md
git commit -m "feat(management): finish analytics console product"
```
