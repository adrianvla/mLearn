# School Management HeroUI Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic management UI with the approved HeroUI school console and expose every identity, group, policy, analytics, conversation, gateway, and settings workflow.

**Architecture:** One authenticated React shell owns session, group scope, permission-aware navigation, and a typed API client. Pages compose reusable HeroUI data surfaces and small SVG chart components; the backend remains the sole authorization layer. Infrastructure pages move into administrator-only diagnostics.

**Tech Stack:** React 19, React Router 7, HeroUI 3, Tailwind 4 utilities, Lucide React, Vitest/Testing Library, inline SVG charts.

## Global Constraints

- Match the approved HeroUI reference: near-black shell, continuous sidebar, charcoal surfaces, crisp white type, muted secondary text, and blue primary actions/charts.
- Use HeroUI primitives intentionally; avoid default-card repetition, excessive pills, oversized metrics, and decorative gradients.
- Primary navigation is Dashboard, Users, Groups, Policies, Analytics, Conversation Logs, LLM Gateway, Settings.
- Every page and API request is scoped to the selected authorized group.
- Teachers never see ancestor/sibling navigation or data without explicit membership.
- Keep operational/container logs under administrator-only Settings > Diagnostics.
- Provide keyboard navigation, visible focus, semantic tables, explicit loading/error/empty states, and responsive layouts.

---

### Task 1: Typed API client, console sessions, and group scope

**Files:**
- Replace: `management/frontend/src/api/types.ts`
- Expand: `management/frontend/src/api/client.ts`
- Create: `management/frontend/src/auth/AuthProvider.tsx`
- Create: `management/frontend/src/auth/AuthProvider.test.tsx`
- Create: `management/frontend/src/groups/GroupScopeProvider.tsx`
- Create: `management/frontend/src/groups/GroupScopeProvider.test.tsx`
- Modify: `management/frontend/src/main.tsx`
- Modify: `management/frontend/src/App.tsx`

**Interfaces:**
- Produces: `useAuth()` and `useGroupScope()`.
- Produces: typed cursor pagination and structured API errors.

- [ ] **Step 1: Write failing session/scope tests**

```tsx
it('restores the session and selects only eligible group automatically', async () => {
  mockApi.me.mockResolvedValue(USER_WITH_ONE_GROUP);
  render(<Providers><Probe /></Providers>);
  expect(await screen.findByText('German A')).toBeVisible();
  expect(mockApi.activateGroup).toHaveBeenCalledWith('german-a');
});

it('removes a forbidden selected group after permission loss', async () => {
  localStorage.setItem('mlearn-management-group', 'german-b');
  mockApi.me.mockResolvedValue(GERMAN_A_ONLY);
  render(<Providers><Probe /></Providers>);
  expect(await screen.findByText('German A')).toBeVisible();
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm --prefix management/frontend run test -- AuthProvider.test.tsx GroupScopeProvider.test.tsx`

- [ ] **Step 3: Replace token-only auth state**

Store access token in memory/session storage and refresh through an HttpOnly-compatible flow where available. Keep the recovery/bootstrap token only on the bootstrap screen. `ApiClient` automatically sends access token, retries once after refresh, and dispatches signed-out state after terminal `401`.

- [ ] **Step 4: Implement group scope**

Load eligible groups from `/api/auth/me`, persist only an authorized selected ID, activate server-side, and expose:

```ts
interface GroupScopeValue {
  groups: AuthorizedGroupNode[];
  selectedGroup: AuthorizedGroupNode | null;
  selectGroup(id: string): Promise<void>;
  can(capability: Capability): boolean;
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm --prefix management/frontend run test && npm --prefix management/frontend run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add management/frontend/src/api management/frontend/src/auth management/frontend/src/groups management/frontend/src/main.tsx management/frontend/src/App.tsx
git commit -m "feat(management-ui): add sessions and group scope"
```

### Task 2: Approved HeroUI shell and reusable data components

**Files:**
- Replace: `management/frontend/src/Layout.tsx`
- Replace: `management/frontend/src/index.css`
- Replace: `management/frontend/src/components/shared.tsx`
- Create: `management/frontend/src/components/AppSidebar.tsx`
- Create: `management/frontend/src/components/GroupSwitcher.tsx`
- Create: `management/frontend/src/components/PageToolbar.tsx`
- Create: `management/frontend/src/components/MetricCard.tsx`
- Create: `management/frontend/src/components/LineChart.tsx`
- Create: `management/frontend/src/components/BarChart.tsx`
- Create: `management/frontend/src/components/DataTableShell.tsx`
- Create: `management/frontend/src/components/components.test.tsx`

**Interfaces:**
- Produces the visual/layout primitives used by every page.

- [ ] **Step 1: Write failing shell/accessibility tests**

```tsx
it('shows only authorized navigation and keeps group scope visible', () => {
  renderShell({ capabilities: ['analytics.view'], selectedGroup: GERMAN_A });
  expect(screen.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Current group: German A' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'LLM Gateway' })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm --prefix management/frontend run test -- components.test.tsx`

- [ ] **Step 3: Implement the fixed shell**

Use a `248px` desktop sidebar, near-black `--background`, `#191a1c` surfaces, `#2a2b2d` selected navigation, white foreground, muted gray secondary text, and HeroUI accent blue. Keep the sidebar scrollable with help/logout anchored when space permits. At narrow widths use a HeroUI drawer.

- [ ] **Step 4: Implement charts without a chart dependency**

`LineChart` and `BarChart` accept normalized series, render accessible SVG with labeled legends, and expose a tabular screen-reader summary. Use blue for primary series and semantic colors only where meaning is labeled.

- [ ] **Step 5: Implement shared page states**

Loading skeletons match final geometry; errors include retry; empty states explain the next action; tables own filter/sort/column/search controls and cursor pagination.

- [ ] **Step 6: Run component tests, build, and visual check**

Run: `npm --prefix management/frontend run test && npm --prefix management/frontend run typecheck && npm --prefix management/frontend run build`

Expected: PASS; render at 1440×900 and compare hierarchy/spacing against the approved visual companion.

- [ ] **Step 7: Commit**

```bash
git add management/frontend/src/Layout.tsx management/frontend/src/index.css management/frontend/src/components
git commit -m "feat(management-ui): build polished heroui shell"
```

### Task 3: Dashboard and group-aware navigation

**Files:**
- Replace: `management/frontend/src/pages/Overview.tsx`
- Create: `management/frontend/src/pages/Dashboard.test.tsx`
- Create: `management/frontend/src/components/RecentActivityTable.tsx`
- Modify: `management/frontend/src/App.tsx`

**Interfaces:**
- Consumes `/api/analytics/summary`, `/api/analytics/timeseries`, `/api/llm/usage`, and diagnostics summary.

- [ ] **Step 1: Write failing dashboard composition test**

Assert managed users, active learners, LLM requests, policy blocks, quota consumed, LLM usage chart, school controls, and recent activity render for the selected group; unauthorized diagnostics do not.

- [ ] **Step 2: Run and confirm failure**

Run: `npm --prefix management/frontend run test -- Dashboard.test.tsx`

- [ ] **Step 3: Implement reference-aligned dashboard**

Use four compact metric cards, one dominant usage chart, one controls/health panel, and one recent activity table. Controls at the top select Overview/Usage/Security and date period. Avoid nested card borders and redundant chips.

- [ ] **Step 4: Verify group changes refetch all queries**

Use request cancellation and selected-group IDs in query keys. Clear old-group data immediately when scope changes.

- [ ] **Step 5: Run tests/build and commit**

```bash
git add management/frontend/src/pages/Overview.tsx management/frontend/src/pages/Dashboard.test.tsx management/frontend/src/components/RecentActivityTable.tsx management/frontend/src/App.tsx
git commit -m "feat(management-ui): add school dashboard"
```

### Task 4: Users and hierarchical groups workflows

**Files:**
- Replace: `management/frontend/src/pages/Users.tsx`
- Create: `management/frontend/src/pages/Groups.tsx`
- Create: `management/frontend/src/pages/Users.test.tsx`
- Create: `management/frontend/src/pages/Groups.test.tsx`
- Create: `management/frontend/src/components/GroupTree.tsx`
- Create: `management/frontend/src/components/CapabilityEditor.tsx`
- Create: `management/frontend/src/components/CsvImportDialog.tsx`
- Modify: `management/frontend/src/App.tsx`

**Interfaces:**
- Consumes user/group/membership/invitation/import APIs from Plan 1.

- [ ] **Step 1: Write failing permission-boundary UI tests**

Test that German A teacher sees descendants only, cannot select German/German B, cannot grant `llm.configure` without holding it, and CSV preview errors are row-specific before import.

- [ ] **Step 2: Run and confirm failure**

Run: `npm --prefix management/frontend run test -- Users.test.tsx Groups.test.tsx`

- [ ] **Step 3: Implement Users**

Add searchable/paginated users, role/status filters, individual creation, CSV preview/import, invitations, sessions/devices, memberships, usage summary, suspension, and revocation. Destructive mutations use confirmation dialogs and optimistic updates only after server acceptance.

- [ ] **Step 4: Implement Groups**

Use a tree/detail split: hierarchy and search on the left, overview/members/permissions/policy/analytics tabs on the right. Capability editor disables authority the current user cannot grant and explains inherited access.

- [ ] **Step 5: Run tests/build and commit**

```bash
git add management/frontend/src/pages/Users* management/frontend/src/pages/Groups* management/frontend/src/components/GroupTree.tsx management/frontend/src/components/CapabilityEditor.tsx management/frontend/src/components/CsvImportDialog.tsx management/frontend/src/App.tsx
git commit -m "feat(management-ui): manage users and group hierarchy"
```

### Task 5: Policy editor with inheritance and quotas

**Files:**
- Create: `management/frontend/src/pages/Policies.tsx`
- Create: `management/frontend/src/pages/Policies.test.tsx`
- Create: `management/frontend/src/components/PolicySettingRow.tsx`
- Create: `management/frontend/src/components/QuotaEditor.tsx`
- Create: `management/frontend/src/components/PolicyDiffDialog.tsx`
- Modify: `management/frontend/src/App.tsx`

**Interfaces:**
- Consumes policy draft/effective/history/publish and quota APIs from Plans 2-3.

- [ ] **Step 1: Write failing inheritance test**

Test inherited root hard deny is labeled with source, disabled in child editor, and included unchanged in publish diff; local language profile and lower quota remain editable.

- [ ] **Step 2: Run and confirm failure**

Run: `npm --prefix management/frontend run test -- Policies.test.tsx`

- [ ] **Step 3: Implement policy editor**

Group settings by app settings, features, language profile, AI/model routing, quotas, and retention. Every row shows `Local`, `Inherited from …`, or `Constrained by …`. Save draft explicitly; validate before enabling Publish.

- [ ] **Step 4: Implement quota editor and publish flow**

Support request/token/cost metrics and daily/weekly/monthly/term periods. Show ancestor cap, child allocation, projected exhaustion, and remaining headroom. Publish dialog shows normalized diff, validation warnings, and required summary.

- [ ] **Step 5: Run tests/build and commit**

```bash
git add management/frontend/src/pages/Policies* management/frontend/src/components/PolicySettingRow.tsx management/frontend/src/components/QuotaEditor.tsx management/frontend/src/components/PolicyDiffDialog.tsx management/frontend/src/App.tsx
git commit -m "feat(management-ui): add inherited policy editor"
```

### Task 6: Analytics and conversation logs

**Files:**
- Replace: `management/frontend/src/pages/Analytics.tsx`
- Replace: `management/frontend/src/pages/Logs.tsx`
- Create: `management/frontend/src/pages/Analytics.test.tsx`
- Create: `management/frontend/src/pages/ConversationLogs.test.tsx`
- Create: `management/frontend/src/components/ConversationDetail.tsx`
- Modify: `management/frontend/src/App.tsx`

**Interfaces:**
- Consumes analytics and conversation APIs from Plans 3-4.

- [ ] **Step 1: Write failing scope and cost tests**

Test per-student requests/tokens/cost/remaining quota, content watched/progress, ancestor rollup, sibling isolation, encrypted conversation detail response rendering, and audited export confirmation.

- [ ] **Step 2: Run and confirm failure**

Run: `npm --prefix management/frontend run test -- Analytics.test.tsx ConversationLogs.test.tsx`

- [ ] **Step 3: Implement Analytics**

Tabs: Overview, Learners, Content, LLM Usage, Policy Blocks. Use group/date filters and charts with labeled series. Learner table shows activity, content completion, requests, tokens, cost, blocks, and quota remaining.

- [ ] **Step 4: Replace Logs with Conversation Logs**

Search/filter by learner, descendant group, provider/model, date, status, and policy block. Detail shows messages, usage/cost, latency, policy/provider provenance, truncation, and error events. Hide export unless capability allows it.

- [ ] **Step 5: Run tests/build and commit**

```bash
git add management/frontend/src/pages/Analytics* management/frontend/src/pages/Logs* management/frontend/src/components/ConversationDetail.tsx management/frontend/src/App.tsx
git commit -m "feat(management-ui): add analytics and conversation logs"
```

### Task 7: LLM gateway, settings, bootstrap/login, and diagnostics

**Files:**
- Replace: `management/frontend/src/pages/LlmGateway.tsx`
- Replace: `management/frontend/src/pages/Config.tsx`
- Create: `management/frontend/src/pages/Settings.tsx`
- Create: `management/frontend/src/pages/Login.tsx`
- Create: `management/frontend/src/pages/Bootstrap.tsx`
- Create: `management/frontend/src/pages/Diagnostics.tsx`
- Move/adapt: `Services.tsx`, `Storage.tsx`, `AiStatus.tsx`, `School.tsx`, `Distribution.tsx` into diagnostics/settings routes
- Create: `management/frontend/src/pages/LlmGateway.test.tsx`
- Create: `management/frontend/src/pages/Settings.test.tsx`
- Create: `management/frontend/src/pages/Login.test.tsx`
- Create: `management/frontend/src/pages/Bootstrap.test.tsx`
- Create: `management/frontend/src/pages/Diagnostics.test.tsx`
- Modify: `management/frontend/src/App.tsx`

**Interfaces:**
- Completes all routes and bootstrap/login flows.

- [ ] **Step 1: Write failing provider-secret and bootstrap tests**

Assert secrets are write-only, price history is immutable, provider test failures are safe, bootstrap requires recovery credential, and non-root users cannot access Diagnostics.

- [ ] **Step 2: Run and confirm failure**

Run: `npm --prefix management/frontend run test`

- [ ] **Step 3: Implement LLM Gateway**

Provider/model routing, prompt profiles, price versions, health, current reservations, API keys, and quota summary. Secret fields show `Configured` and accept replacement but never receive stored plaintext.

- [ ] **Step 4: Implement school settings and auth screens**

Settings covers school identity, timezone/term calendar, retention, security, endpoint guidance, and backups. Login handles normal credentials and desktop approval. Bootstrap creates the first root admin with the recovery credential.

- [ ] **Step 5: Consolidate diagnostics**

Keep container services/actions, storage, AI status, distribution, and redacted operational logs under `/settings/diagnostics`; require root diagnostics capability server-side and client-side.

- [ ] **Step 6: Run full management frontend verification and commit**

Run: `npm --prefix management/frontend run test`

Run: `npm --prefix management/frontend run typecheck`

Run: `npm --prefix management/frontend run build`

```bash
git add management/frontend
git commit -m "feat(management-ui): complete school administration console"
```

### Task 8: End-to-end permission, accessibility, and visual verification

**Files:**
- Create: `management/frontend/src/e2e/school-management.test.tsx`
- Create: `management/backend/tests/school_management_e2e.rs`
- Modify: `management/README.md`
- Modify: `management/DEPLOYMENT.md`
- Modify: `management/docker-compose.yml`

**Interfaces:**
- Verifies the entire plan suite and approved design.

- [ ] **Step 1: Add the full German-tree acceptance fixture**

Cover root admin, German manager, German A/B teachers, project group teacher, multi-class learner, policies, quotas, activity events, conversations, and permission revocation.

- [ ] **Step 2: Run backend and frontend acceptance tests**

Run: `cargo test --manifest-path management/backend/Cargo.toml --test school_management_e2e`

Run: `npm --prefix management/frontend run test -- school-management.test.tsx`

Expected: any incomplete integration fails with a specific boundary assertion.

- [ ] **Step 3: Verify accessibility and responsive shell**

Test keyboard-only navigation, focus restoration for dialogs/drawer, table accessible names, form errors, contrast, 1440×900 desktop, 1024×768 compact desktop, and 768px drawer layout.

- [ ] **Step 4: Verify the approved visual direction in the running app**

Run the Rust backend and Vite frontend with seeded fixtures. Inspect Dashboard, Groups, Policies, Analytics, Conversation Logs, and LLM Gateway. Confirm near-black shell, continuous sidebar, restrained HeroUI surfaces, consistent density, chart legends, and no clipped navigation.

- [ ] **Step 5: Run the suite completion gate**

Run every command in `2026-07-09-school-management-plan-index.md`.

Expected: all commands exit `0` and `git diff --check` is clean.

- [ ] **Step 6: Commit**

```bash
git add management management/frontend/src/e2e management/backend/tests
git commit -m "test: verify school management platform end to end"
```
