# Management Console HeroUI-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every interactive control in the management frontend with a HeroUI component while preserving the console's API, accessibility, and authorization behavior.

**Architecture:** Build a narrow, typed control layer in `management/frontend/src/components/console/` that composes HeroUI v3 primitives and exposes the existing controlled React contracts. Migrate pages in cohesive route groups, retaining semantic HTML only for non-interactive content and retaining page CSS only for layout. Use HeroUI overlay primitives for all dialogs, confirmations, selects, and date popovers.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, React Testing Library, `@heroui/react` 3.2.2, `@internationalized/date` 3.12.2.

## Global Constraints

- Every user-facing interactive component in `management/frontend/src` is a HeroUI primitive or a console wrapper that composes HeroUI primitives.
- Native HTML remains only for semantic non-interactive structure and HeroUI's inaccessible implementation details; it must never be the visible control.
- Preserve current accessible names, controlled values, disabled states, validation rules, and API request bodies.
- Do not alter backend contracts or authorization behavior.
- Add focused tests before each shared control or migration behavior change.
- Run `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check` before the final commit.

---

### Task 1: Establish the typed HeroUI console-control layer

**Files:**
- Create: `management/frontend/src/components/console/ConsoleButton.tsx`
- Create: `management/frontend/src/components/console/ConsoleField.tsx`
- Create: `management/frontend/src/components/console/ConsoleSelect.tsx`
- Create: `management/frontend/src/components/console/ConsoleSwitch.tsx`
- Create: `management/frontend/src/components/console/ConsoleDialog.tsx`
- Create: `management/frontend/src/components/console/index.ts`
- Create: `management/frontend/src/components/console/console-controls.test.tsx`
- Modify: `management/frontend/src/components/DatePickerField.tsx`
- Modify: `management/frontend/src/components/DatePickerField.test.tsx`

**Interfaces:**
- Produces `ConsoleField`, `ConsoleNumberField`, `ConsoleTextArea`, `ConsoleSelect`, `ConsoleSwitch`, `ConsoleButton`, `ConsoleDialog`, and `DatePickerField` wrappers.
- `ConsoleSelect<T>` accepts `label`, `selectedKey`, `onSelectionChange(key: string)`, and `{ key, label }[]` options.
- `ConsoleDialog` accepts `open`, `onOpenChange`, `title`, `children`, and a HeroUI footer slot.

- [ ] **Step 1: Write failing tests for HeroUI controls and the date-picker popup**

```tsx
it('opens the HeroUI select list and emits the selected key', async () => {
  const onSelectionChange = vi.fn();
  render(<ConsoleSelect label="Rule type" selectedKey="setting" onSelectionChange={onSelectionChange} options={[{ key: 'setting', label: 'Lock app setting' }, { key: 'llm', label: 'Enable LLM access' }]} />);
  await userEvent.click(screen.getByRole('button', { name: /rule type/i }));
  await userEvent.click(await screen.findByRole('option', { name: 'Enable LLM access' }));
  expect(onSelectionChange).toHaveBeenCalledWith('llm');
});
```

- [ ] **Step 2: Run the control test and verify it fails**

Run: `cd management/frontend && npm test -- --run src/components/console/console-controls.test.tsx`

Expected: FAIL because the console controls do not exist.

- [ ] **Step 3: Implement HeroUI compositions only**

```tsx
export function ConsoleSelect({ label, selectedKey, onSelectionChange, options, isDisabled }: ConsoleSelectProps) {
  return <Select selectedKeys={selectedKey ? new Set([selectedKey]) : new Set()} onSelectionChange={(keys) => onSelectionChange(Array.from(keys)[0] ?? '')} isDisabled={isDisabled}>
    <Label>{label}</Label><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
    <Select.Popover><ListBox>{options.map((option) => <ListBoxItem id={option.key} key={option.key}>{option.label}</ListBoxItem>)}</ListBox></Select.Popover>
  </Select>;
}
```

Use `Button`, `TextField` with `Input`, `TextArea`, `NumberField`, `Switch`, `Modal`, and `AlertDialog` from `@heroui/react`; retain `DatePickerField` as the HeroUI `DatePicker` and `Calendar` composition.

- [ ] **Step 4: Run the focused control tests**

Run: `cd management/frontend && npm test -- --run src/components/console/console-controls.test.tsx src/components/DatePickerField.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the foundation**

```bash
git add management/frontend/src/components/console management/frontend/src/components/DatePickerField.tsx management/frontend/src/components/DatePickerField.test.tsx
git commit -m "feat(management): add HeroUI console controls"
```

### Task 2: Migrate authentication and global interactive components

**Files:**
- Modify: `management/frontend/src/pages/Login.tsx`
- Modify: `management/frontend/src/pages/Bootstrap.tsx`
- Modify: `management/frontend/src/components/AppSidebar.tsx`
- Modify: `management/frontend/src/components/GroupSwitcher.tsx`
- Modify: `management/frontend/src/components/CapabilityEditor.tsx`
- Modify: `management/frontend/src/components/DataTableShell.tsx`
- Modify: `management/frontend/src/components/QuotaEditor.tsx`
- Modify: `management/frontend/src/components/CsvImportDialog.tsx`
- Modify: `management/frontend/src/components/ConversationDetail.tsx`
- Modify: `management/frontend/src/components/PolicyDiffDialog.tsx`
- Modify: `management/frontend/src/components/GroupTree.tsx`
- Test: `management/frontend/src/pages/Login.test.tsx`
- Test: `management/frontend/src/pages/Bootstrap.test.tsx`
- Test: `management/frontend/src/components/components.test.tsx`

**Interfaces:**
- Consumes the Task 1 wrappers; no route imports native form elements.
- Produces unchanged sign-in, bootstrap, group switching, CSV preview, and close/confirm behavior.

- [ ] **Step 1: Add failing assertions for HeroUI roles and preserved auth submission**

```tsx
expect(screen.getByRole('button', { name: 'Sign in' })).toHaveAttribute('data-slot', 'button');
await userEvent.type(screen.getByLabelText('Email'), 'admin@example.test');
await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery staple');
await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ method: 'POST' }));
```

- [ ] **Step 2: Run auth and component tests to verify failure**

Run: `cd management/frontend && npm test -- --run src/pages/Login.test.tsx src/pages/Bootstrap.test.tsx src/components/components.test.tsx`

Expected: FAIL before the native controls are replaced.

- [ ] **Step 3: Replace inputs, buttons, selects, switches, and overlays**

Use `ConsoleField` for credentials and CSV text, `ConsoleButton` for all actions, `ConsoleSelect` for group selection, `ConsoleSwitch` for capabilities, and `ConsoleDialog` or `AlertDialog` for all dialogs. Keep existing labels and `onChange` state handlers.

- [ ] **Step 4: Run the focused tests**

Run: `cd management/frontend && npm test -- --run src/pages/Login.test.tsx src/pages/Bootstrap.test.tsx src/components/components.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the auth and global migration**

```bash
git add management/frontend/src/pages/Login.tsx management/frontend/src/pages/Bootstrap.tsx management/frontend/src/components
git commit -m "refactor(management): use HeroUI for auth and shared controls"
```

### Task 3: Migrate named policies and group administration

**Files:**
- Modify: `management/frontend/src/pages/Policies.tsx`
- Modify: `management/frontend/src/pages/Groups.tsx`
- Test: `management/frontend/src/pages/Policies.test.tsx`
- Test: `management/frontend/src/pages/Groups.test.tsx`

**Interfaces:**
- Policy rule kind and setting selection still update `ruleKind` and `settingKey` strings.
- Policy values still serialize as booleans, numbers, or strings; locked setting values still emit `{ value, locked: true }`.
- Group create/edit/archive requests retain their current endpoint and body contracts.

- [ ] **Step 1: Add failing policy interaction tests**

```tsx
await userEvent.click(screen.getByRole('button', { name: /rule type/i }));
await userEvent.click(await screen.findByRole('option', { name: 'Lock app setting' }));
await userEvent.click(screen.getByRole('button', { name: /app setting/i }));
await userEvent.click(await screen.findByRole('option', { name: 'Srs Learning Threshold' }));
await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
expect(screen.getByRole('switch', { name: 'LLM enabled' })).toBeInTheDocument();
```

- [ ] **Step 2: Run policy/group tests and verify failure**

Run: `cd management/frontend && npm test -- --run src/pages/Policies.test.tsx src/pages/Groups.test.tsx`

Expected: FAIL until the native policy and group controls are replaced.

- [ ] **Step 3: Implement HeroUI policy and group controls**

Replace policy list/action buttons, new-policy and publish-summary fields, rule selects, setting selects, booleans, retention number fields, and remove actions with Task 1 controls. Replace group search, group editor, archive confirmation, and permission actions with HeroUI SearchField, fields, buttons, and AlertDialog.

- [ ] **Step 4: Run policy/group tests**

Run: `cd management/frontend && npm test -- --run src/pages/Policies.test.tsx src/pages/Groups.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit policy/group migration**

```bash
git add management/frontend/src/pages/Policies.tsx management/frontend/src/pages/Groups.tsx management/frontend/src/pages/Policies.test.tsx management/frontend/src/pages/Groups.test.tsx
git commit -m "refactor(management): use HeroUI policy and group controls"
```

### Task 4: Migrate user and LLM configuration workflows

**Files:**
- Modify: `management/frontend/src/pages/Users.tsx`
- Modify: `management/frontend/src/pages/LlmGateway.tsx`
- Test: `management/frontend/src/pages/Users.test.tsx`
- Test: `management/frontend/src/pages/LlmGateway.test.tsx`

**Interfaces:**
- User creation, invitation, status, role, and membership permissions preserve their current state and request bodies.
- Provider, model, prompt profile, price, secret rotation, and API-key workflows retain the existing API calls and one-time-key display.

- [ ] **Step 1: Add failing tests for modal, select, and secret workflow interactions**

```tsx
await userEvent.click(screen.getByRole('button', { name: 'Add provider' }));
expect(await screen.findByRole('dialog', { name: 'Add provider' })).toBeVisible();
await userEvent.click(screen.getByRole('button', { name: /provider kind/i }));
await userEvent.click(await screen.findByRole('option', { name: 'Ollama' }));
```

- [ ] **Step 2: Run users and LLM tests to verify failure**

Run: `cd management/frontend && npm test -- --run src/pages/Users.test.tsx src/pages/LlmGateway.test.tsx`

Expected: FAIL before dialog/form migration.

- [ ] **Step 3: Implement HeroUI forms and dialogs**

Use `ConsoleDialog` for create/invite/detail/provider/configuration/secret flows; use `ConsoleField`, `ConsoleTextArea`, `ConsoleNumberField`, `ConsoleSelect`, `ConsoleSwitch`, and `ConsoleButton` for their contents. Ensure disabled submit logic remains exactly equivalent.

- [ ] **Step 4: Run users and LLM tests**

Run: `cd management/frontend && npm test -- --run src/pages/Users.test.tsx src/pages/LlmGateway.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit user and gateway migration**

```bash
git add management/frontend/src/pages/Users.tsx management/frontend/src/pages/LlmGateway.tsx management/frontend/src/pages/Users.test.tsx management/frontend/src/pages/LlmGateway.test.tsx
git commit -m "refactor(management): use HeroUI user and gateway workflows"
```

### Task 5: Migrate data filters, settings, analytics, and operational controls

**Files:**
- Modify: `management/frontend/src/pages/Logs.tsx`
- Modify: `management/frontend/src/pages/Settings.tsx`
- Modify: `management/frontend/src/pages/Analytics.tsx`
- Modify: `management/frontend/src/pages/Overview.tsx`
- Modify: `management/frontend/src/pages/OperationalLogs.tsx`
- Modify: `management/frontend/src/pages/Config.tsx`
- Modify: `management/frontend/src/pages/Diagnostics.tsx`
- Modify: `management/frontend/src/pages/Distribution.tsx`
- Modify: `management/frontend/src/pages/Services.tsx`
- Modify: `management/frontend/src/pages/Storage.tsx`
- Modify: `management/frontend/src/pages/AiStatus.tsx`
- Modify: `management/frontend/src/pages/School.tsx`
- Test: `management/frontend/src/pages/ConversationLogs.test.tsx`
- Test: `management/frontend/src/pages/Settings.test.tsx`
- Test: `management/frontend/src/pages/Analytics.test.tsx`
- Test: `management/frontend/src/pages/OperationalLogs.test.tsx`
- Test: `management/frontend/src/pages/Dashboard.test.tsx`
- Test: `management/frontend/src/pages/Diagnostics.test.tsx`

**Interfaces:**
- Conversation filters preserve the same query string keys and export scope.
- Settings preserve time zone, term start/end, and save validation.
- Analytics and operational filters preserve selected period/service behavior.

- [ ] **Step 1: Add failing filter and date-picker tests**

```tsx
await userEvent.click(screen.getByRole('button', { name: 'Choose From date' }));
expect(await screen.findByRole('grid')).toBeVisible();
await userEvent.click(screen.getByRole('button', { name: /analytics date period/i }));
await userEvent.click(await screen.findByRole('option', { name: '30 days' }));
expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('periodDays=30'), expect.anything());
```

- [ ] **Step 2: Run affected page tests and verify failure**

Run: `cd management/frontend && npm test -- --run src/pages/ConversationLogs.test.tsx src/pages/Settings.test.tsx src/pages/Analytics.test.tsx src/pages/OperationalLogs.test.tsx src/pages/Dashboard.test.tsx src/pages/Diagnostics.test.tsx`

Expected: FAIL until the page filters/actions use HeroUI components.

- [ ] **Step 3: Implement HeroUI filters and actions**

Use `SearchField` for search boxes, `ConsoleField` for identifiers, `ConsoleSelect` for status/group/service/period filters, `DatePickerField` for all dates, `Tabs` for analytics/overview navigation, and HeroUI buttons and dialogs for exports/retries/confirmations. Migrate the remaining root-only pages' actions and configuration fields in the same pass.

- [ ] **Step 4: Run all affected page tests**

Run: `cd management/frontend && npm test -- --run src/pages/ConversationLogs.test.tsx src/pages/Settings.test.tsx src/pages/Analytics.test.tsx src/pages/OperationalLogs.test.tsx src/pages/Dashboard.test.tsx src/pages/Diagnostics.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit data and settings migration**

```bash
git add management/frontend/src/pages
git commit -m "refactor(management): use HeroUI filters and settings controls"
```

### Task 6: Enforce the console-wide rule and validate the rendered application

**Files:**
- Modify as needed: `management/frontend/src/**/*.tsx`
- Modify as needed: `management/frontend/src/**/*.css`
- Test: `management/frontend/src/e2e/school-management.test.tsx`

**Interfaces:**
- Produces a frontend with no visible native interactive controls.
- Does not change API endpoints, authorization rules, policy compilation, or database behavior.

- [ ] **Step 1: Add a source-level guard and end-to-end smoke assertion**

```tsx
it('renders the policy rule picker with HeroUI controls', async () => {
  render(<Policies />);
  expect(await screen.findByRole('button', { name: /rule type/i })).toHaveAttribute('data-slot', 'select-trigger');
});
```

Add a source guard that rejects direct `<input>`, `<select>`, `<textarea>`, and `<button>` in management page/component source except the documented HeroUI date-picker accessibility synchronization assertion in its test.

- [ ] **Step 2: Run the guard and full frontend suite**

Run: `cd management/frontend && npm test && npm run typecheck && npm run build`

Expected: PASS.

- [ ] **Step 3: Rebuild and validate the served console in Browser**

Run: `cd management/frontend && npm run build`

Then restart `management/backend` so its `include_dir` static bundle contains the rebuilt frontend. In the Browser plugin, validate desktop and a narrow viewport by opening `/policies`, selecting a rule type and app setting, adding a rule, opening `/conversations`, and opening the HeroUI From-date calendar. Confirm no browser-native popup, blank page, console error, clipping, or interaction regression.

- [ ] **Step 4: Run final repository checks**

Run: `npm run lint:management && cargo test --manifest-path management/backend/Cargo.toml && git diff --check`

Expected: PASS.

- [ ] **Step 5: Commit final guard and cleanup**

```bash
git add management/frontend
git commit -m "refactor(management): enforce HeroUI-only controls"
```
