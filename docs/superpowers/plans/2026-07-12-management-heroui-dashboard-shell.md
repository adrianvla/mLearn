# Management Console HeroUI Dashboard and Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the complete management-console shell and dashboard around the supplied stock HeroUI reference while preserving every existing route, feature, permission, metric, and workflow.

**Architecture:** Use HeroUI semantic theme tokens and components as the visual source of truth. Refactor the shell and dashboard into focused React components, then harmonize every route through shared HeroUI surfaces and controls without changing API state or backend contracts. Validate the live embedded frontend with the Browser plugin at desktop and mobile widths.

**Tech Stack:** React 19, TypeScript, Vite, HeroUI 3.2.2, React Testing Library, Vitest, Rust static embedding, Browser plugin.

## Global Constraints

- Preserve every existing route, metric, filter, action, permission, policy workflow, API call, and responsive behavior.
- Every visible interactive control is a HeroUI component or a wrapper composed exclusively from HeroUI primitives.
- Use the user-supplied light and dark HeroUI variables as the canonical global theme.
- Do not replace existing data with demo or placeholder data.
- Do not alter management backend contracts, authorization, group scope, or policy semantics.
- Browser QA must cover every authorized route, one core interaction, desktop, and mobile.
- `design-qa.md` must end with `final result: passed`.

---

### Task 1: Canonical HeroUI theme and shell

**Files:**
- Modify: `management/frontend/src/index.css`
- Modify: `management/frontend/src/Layout.tsx`
- Modify: `management/frontend/src/components/AppSidebar.tsx`
- Modify: `management/frontend/src/components/GroupSwitcher.tsx`
- Test: `management/frontend/src/components/components.test.tsx`

**Interfaces:**
- Consumes existing authentication and `GroupScopeProvider` state.
- Produces the unchanged route navigation, group selector, mobile drawer, signed-in identity, and logout behavior in the reference shell geometry.

- [ ] **Step 1: Add failing shell assertions**

```tsx
expect(screen.getByRole('navigation', { name: 'Primary' })).toHaveAttribute('data-console-navigation');
expect(screen.getByRole('button', { name: /Current group:/ })).toHaveAttribute('data-slot', 'button');
```

- [ ] **Step 2: Verify the shell test fails**

Run: `cd management/frontend && npm test -- --run src/components/components.test.tsx`

Expected: FAIL because the reference shell contract is not present.

- [ ] **Step 3: Implement the reference shell and theme**

```tsx
<aside className="app-sidebar">
  <header className="sidebar-identity">...</header>
  <nav data-console-navigation aria-label="Primary">...</nav>
  <footer className="sidebar-footer">...</footer>
</aside>
```

Apply the supplied `:root`, `.light`, `.default`, and `.dark` variables verbatim after `@import "@heroui/styles"`. Replace hard-coded interactive colors and sizing with `var(--background)`, `var(--surface)`, `var(--foreground)`, `var(--muted)`, `var(--border)`, and HeroUI slot selectors. Keep all navigation items and permission checks.

- [ ] **Step 4: Run shell tests and typecheck**

Run: `cd management/frontend && npm test -- --run src/components/components.test.tsx && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit shell work**

```bash
git add management/frontend/src/index.css management/frontend/src/Layout.tsx management/frontend/src/components/AppSidebar.tsx management/frontend/src/components/GroupSwitcher.tsx management/frontend/src/components/components.test.tsx
git commit -m "refactor(management): rebuild HeroUI console shell"
```

### Task 2: Reference-style dashboard with existing school data

**Files:**
- Modify: `management/frontend/src/pages/Overview.tsx`
- Modify: `management/frontend/src/components/MetricCard.tsx`
- Modify: `management/frontend/src/components/LineChart.tsx`
- Modify: `management/frontend/src/components/RecentActivityTable.tsx`
- Test: `management/frontend/src/pages/Dashboard.test.tsx`

**Interfaces:**
- Consumes the existing summary, learner, LLM, timeseries, and group-scope API responses.
- Produces Overview, Usage, and Security tabs; 7/30/90-day selection; refresh; four metric cards; two balanced analysis panels; and recent activity without changing request URLs.

- [ ] **Step 1: Add failing dashboard structure and interaction tests**

```tsx
expect(await screen.findAllByTestId('dashboard-metric')).toHaveLength(4);
expect(screen.getByRole('region', { name: 'Dashboard analysis' })).toBeVisible();
fireEvent.click(screen.getByRole('tab', { name: 'Usage' }));
expect(screen.getByRole('tab', { name: 'Usage' })).toHaveAttribute('aria-selected', 'true');
```

- [ ] **Step 2: Verify the dashboard test fails**

Run: `cd management/frontend && npm test -- --run src/pages/Dashboard.test.tsx`

Expected: FAIL because the new card and analysis contracts are absent.

- [ ] **Step 3: Implement stock HeroUI dashboard composition**

```tsx
<Tabs selectedKey={view} onSelectionChange={(key) => setView(String(key) as DashboardView)}>
  <Tabs.ListContainer><Tabs.List aria-label="Dashboard view">...</Tabs.List></Tabs.ListContainer>
</Tabs>
<section className="metric-grid">{metrics.map((metric) => <MetricCard data-testid="dashboard-metric" {...metric} />)}</section>
<section className="dashboard-analysis" aria-label="Dashboard analysis">...</section>
```

Use HeroUI `Card`, `Button`, `Select`, `Tabs`, `Chip`, and `Table` compositions. Preserve zero/loading/error states and every existing metric.

- [ ] **Step 4: Run dashboard and component tests**

Run: `cd management/frontend && npm test -- --run src/pages/Dashboard.test.tsx src/components/components.test.tsx && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit dashboard work**

```bash
git add management/frontend/src/pages/Overview.tsx management/frontend/src/components/MetricCard.tsx management/frontend/src/components/LineChart.tsx management/frontend/src/components/RecentActivityTable.tsx management/frontend/src/pages/Dashboard.test.tsx
git commit -m "refactor(management): rebuild HeroUI dashboard"
```

### Task 3: Harmonize every management route and finish HeroUI migration

**Files:**
- Modify: `management/frontend/src/pages/Users.tsx`
- Modify: `management/frontend/src/pages/Groups.tsx`
- Modify: `management/frontend/src/pages/Policies.tsx`
- Modify: `management/frontend/src/pages/Analytics.tsx`
- Modify: `management/frontend/src/pages/Logs.tsx`
- Modify: `management/frontend/src/pages/LlmGateway.tsx`
- Modify: `management/frontend/src/pages/Settings.tsx`
- Modify: `management/frontend/src/pages/Login.tsx`
- Modify: `management/frontend/src/pages/Bootstrap.tsx`
- Modify: `management/frontend/src/components/console/*`
- Test: `management/frontend/src/pages/*.test.tsx`

**Interfaces:**
- Consumes the shared HeroUI console control layer.
- Produces the same user, group, policy, analytics, conversation, LLM, settings, and authentication workflows with consistent HeroUI cards, fields, tabs, tables, popovers, and dialogs.

- [ ] **Step 1: Add a failing runtime-source guard**

```tsx
it('does not render direct native controls from management pages', () => {
  expect(findDirectNativeControlSources()).toEqual([]);
});
```

The guard scans runtime `.tsx` files and rejects direct `<input>`, `<select>`, `<textarea>`, and `<button>` outside the HeroUI wrappers.

- [ ] **Step 2: Run the full frontend suite and record failures**

Run: `cd management/frontend && npm test`

Expected: FAIL while Users and LLM Gateway still contain direct native controls and route tests expose stale selectors.

- [ ] **Step 3: Replace remaining controls and align route surfaces**

```tsx
<ConsoleDialog open={open} onOpenChange={setOpen} title={title} footer={actions}>...</ConsoleDialog>
<ConsoleSelect label={label} selectedKey={value} onSelectionChange={setValue} options={options} />
```

Preserve request bodies and disabled-state logic. Fix the Policies selected item with `height:auto`, `align-items:start`, and `white-space:normal`. Update legacy CSS selectors to HeroUI `data-slot` selectors.

- [ ] **Step 4: Run all frontend verification**

Run: `cd management/frontend && npm test && npm run typecheck && npm run build && git diff --check`

Expected: PASS.

- [ ] **Step 5: Commit route harmonization**

```bash
git add management/frontend
git commit -m "refactor(management): finish HeroUI console migration"
```

### Task 4: Browser design QA across every page

**Files:**
- Create: `design-qa.md`
- Modify as findings require: `management/frontend/src/**/*.tsx`
- Modify as findings require: `management/frontend/src/index.css`

**Interfaces:**
- Consumes the production frontend embedded by `management/backend`.
- Produces visual proof that every page loads, aligns, and retains its primary controls.

- [ ] **Step 1: Build and restart the embedded frontend**

Run: `cd management/frontend && npm run build`, then restart `cargo run` in `management/backend`.

Expected: `http://127.0.0.1:3000` serves the new asset hashes.

- [ ] **Step 2: Audit every authorized route in Browser**

Visit `/`, `/users`, `/groups`, `/policies`, `/analytics`, `/conversations`, `/llm-gateway`, `/settings`, and root-only diagnostic routes visible to the signed-in account. For each route capture page identity, first-viewport screenshot, console warnings/errors, and clipping/alignment findings.

- [ ] **Step 3: Exercise core interactions**

Open Dashboard Usage, change period, open the policy rule selector, open a date picker, and open/close one modal. Verify visible selected/open/closed state after each action without submitting mutating forms.

- [ ] **Step 4: Run desktop and mobile comparison and write QA**

Use the reference desktop viewport and a 390px mobile viewport. Write `design-qa.md` with mismatch severity and `final result: passed` only after all P0/P1/P2 issues are fixed.

- [ ] **Step 5: Run final gates and commit QA**

Run: `cd management/frontend && npm test && npm run typecheck && npm run build`, then `npm run lint:management && cargo test --manifest-path management/backend/Cargo.toml && git diff --check`.

```bash
git add design-qa.md management/frontend
git commit -m "test(management): verify HeroUI console design"
```
