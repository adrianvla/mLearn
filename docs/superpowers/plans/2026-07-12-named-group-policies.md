# Named Group Policies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single all-options group policy form with multiple named, ordered policies composed from explicit rules, including enforceable app-setting locks and clear save/validate/publish state.

**Architecture:** Introduce stable policy containers and immutable policy-set revisions while preserving immutable published versions. Authoring uses a discriminated rule array, compiled server-side into the existing signed effective-policy shape so the learning app keeps one enforcement boundary. The React console consumes a server policy registry and presents a local/inherited policy list, focused rule builder, status machine, and history.

**Tech Stack:** Rust 2021, Axum, SQLx/SQLite, Serde, React 19, TypeScript 5.7, HeroUI 3, Vitest, Testing Library, SolidJS, Vitest.

## Global Constraints

- Policies attach only to groups; there are no user-specific exceptions.
- Published policy versions and policy-set revisions are immutable and auditable.
- Drafts never affect clients; only active published versions participate in compilation.
- Every effective rule carries group, policy, version, and rule provenance.
- Unknown rule kinds, arbitrary setting keys, arbitrary code, and arbitrary CSS are rejected.
- All policy-addressable settings remain language-agnostic and come from a validated registry.
- Settings are enforced through `SettingsContext`; renderer code must use `updateSetting()` or `updateSettings()`, never raw `setStore`.
- Existing group policies migrate without republishing or changing their effective behavior.
- New functionality is test-driven and each task ends in a focused commit.

---

### Task 1: Persist Named Policies Without Losing Legacy History

**Files:**
- Create: `management/backend/migrations/0016_named_policies.sql`
- Modify: `management/backend/src/db.rs`
- Test: `management/backend/src/db.rs`

**Interfaces:**
- Produces tables `policies`, `policy_draft_validations`, `policy_set_revisions`, and `policy_set_revision_entries`.
- Produces `policy_id` relationships on drafts, versions, and active policy records for all later tasks.

- [ ] **Step 1: Write a failing migration test**

Add a DB test that initializes through migration `0012`, inserts two legacy group versions plus a draft and active row, applies migrations, and asserts one `Group policy` container exists with all IDs, hashes, authors, timestamps, and active selection preserved.

```rust
assert_eq!(sqlx::query_scalar::<_, i64>(
    "SELECT COUNT(*) FROM policies WHERE group_id='class' AND name='Group policy'"
).fetch_one(&pool).await.unwrap(), 1);
assert_eq!(sqlx::query_scalar::<_, i64>(
    "SELECT COUNT(*) FROM policy_versions WHERE group_id='class' AND policy_id IS NOT NULL"
).fetch_one(&pool).await.unwrap(), 2);
assert_eq!(sqlx::query_scalar::<_, String>(
    "SELECT document_hash FROM policy_drafts WHERE group_id='class'"
).fetch_one(&pool).await.unwrap(), "draft-hash");
```

- [ ] **Step 2: Run the migration test and verify it fails**

Run: `cargo test --manifest-path management/backend/Cargo.toml db::tests::legacy_policy_rows_migrate_to_named_policy -- --exact`

Expected: FAIL because migration `0016_named_policies.sql` and table `policies` do not exist.

- [ ] **Step 3: Add the migration**

Create stable containers, validation records, and immutable composition revisions. Rebuild the three legacy tables in a foreign-key-safe transaction because SQLite cannot replace their primary keys in place. Use deterministic legacy IDs (`'legacy-' || group_id`) so all legacy rows for a group converge on one container.

```sql
CREATE TABLE policies (
    id TEXT PRIMARY KEY NOT NULL,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
    description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 1000),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
    priority INTEGER NOT NULL CHECK(priority >= 0),
    created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
    UNIQUE(group_id, name),
    UNIQUE(group_id, priority)
);

CREATE TABLE policy_draft_validations (
    policy_id TEXT PRIMARY KEY NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
    document_hash TEXT NOT NULL,
    validated_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    validated_at INTEGER NOT NULL
);

CREATE TABLE policy_set_revisions (
    id TEXT PRIMARY KEY NOT NULL,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    summary TEXT NOT NULL CHECK(length(trim(summary)) > 0),
    created_at INTEGER NOT NULL
);

CREATE TABLE policy_set_revision_entries (
    revision_id TEXT NOT NULL REFERENCES policy_set_revisions(id) ON DELETE RESTRICT,
    policy_id TEXT NOT NULL REFERENCES policies(id) ON DELETE RESTRICT,
    policy_version_id TEXT NOT NULL REFERENCES policy_versions(id) ON DELETE RESTRICT,
    priority INTEGER NOT NULL,
    PRIMARY KEY(revision_id, policy_id),
    UNIQUE(revision_id, priority)
);
```

Add immutability triggers for both revision tables and indexes for `(group_id, priority)` and policy history pagination.

- [ ] **Step 4: Run database tests**

Run: `cargo test --manifest-path management/backend/Cargo.toml db::tests`

Expected: all DB tests PASS, including legacy migration preservation and immutable revision triggers.

- [ ] **Step 5: Commit**

```bash
git add management/backend/migrations/0016_named_policies.sql management/backend/src/db.rs
git commit -m "feat(management): migrate policies to named containers"
```

### Task 2: Define Explicit Authoring Rules and Registry Metadata

**Files:**
- Modify: `management/backend/src/policy/registry.rs`
- Modify: `management/backend/src/policy/service.rs`
- Modify: `management/backend/src/policy/mod.rs`
- Test: `management/backend/src/policy/registry.rs`

**Interfaces:**
- Produces `PolicyRule`, `PolicyDraftDocument { rules: Vec<PolicyRule> }`, `PolicyRegistryEntry`, and `policy_registry()`.
- Produces `normalize_and_validate()` that canonicalizes explicit rules for Tasks 3–5.

- [ ] **Step 1: Write failing registry and normalization tests**

Cover a locked boolean setting, a literal select setting, duplicate singleton rejection, unknown setting rejection, duplicate rule-ID rejection, unsafe number rejection, and deterministic canonical sorting.

```rust
let document = json!({"rules":[{
    "id":"reader-size", "kind":"setting", "settingKey":"readerTextSize",
    "value":22, "locked":true
}]});
let (typed, normalized, _) = normalize_and_validate(document).unwrap();
assert_eq!(typed.rules.len(), 1);
assert!(normalized.contains("readerTextSize"));
assert_eq!(policy_registry().iter().find(|entry| entry.key == "readerTextSize").unwrap().value_type, PolicyValueType::Number);
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `cargo test --manifest-path management/backend/Cargo.toml policy::registry::tests`

Expected: FAIL because the public registry metadata and `rules` authoring format do not exist.

- [ ] **Step 3: Implement typed rules and registry descriptors**

Use one tagged enum and keep setting values as validated JSON:

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum PolicyRule {
    Setting { id: String, setting_key: String, value: Value, locked: bool },
    Feature { id: String, feature_key: String, enabled: bool, #[serde(default)] hard: bool },
    LlmAccess { id: String, enabled: bool },
    LlmRateLimit { id: String, requests_per_minute: u32, max_concurrent_streams: u16 },
    LlmProviders { id: String, allowed_providers: Vec<String> },
    LlmModels { id: String, allowed_models: Vec<String> },
    PromptProfile { id: String, prompt_profile_id: Option<String> },
    Quota { id: String, metric: QuotaMetric, limit: u64, period: QuotaPeriod, #[serde(default)] hard: bool },
    GovernanceRetention { id: String, activity_retention_days: u16, conversation_retention_days: u16 },
    GovernanceExports { id: String, teacher_analytics_export: bool, teacher_conversation_export: bool },
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PolicyDraftDocument { pub rules: Vec<PolicyRule> }
```

Expose safe labels, descriptions, categories, value types, allowed values, minimum/maximum values, and lock/hard support from `policy_registry()`. Do not expose secrets or settings absent from the existing validated setting registry.

- [ ] **Step 4: Implement legacy-document conversion**

During migration reads, convert the existing `settings/features/llm/governance` document to stable deterministic rule IDs derived from kind and key. New saves always write `{ "rules": [...] }`. Preserve all old values and constraints exactly.

- [ ] **Step 5: Run focused tests**

Run: `cargo test --manifest-path management/backend/Cargo.toml policy::registry::tests policy::service::tests`

Expected: all registry and authoring-format tests PASS.

- [ ] **Step 6: Commit**

```bash
git add management/backend/src/policy/registry.rs management/backend/src/policy/service.rs management/backend/src/policy/mod.rs
git commit -m "feat(management): add explicit policy rule registry"
```

### Task 3: Implement Named Policy Lifecycle and Concurrency

**Files:**
- Modify: `management/backend/src/policy/service.rs`
- Test: `management/backend/src/policy/service.rs`

**Interfaces:**
- Produces `PolicySummary`, `PolicyDetails`, `PolicyList`, `CreatePolicyRequest`, `UpdatePolicyRequest`, and revision-aware draft responses.
- Produces service methods consumed by HTTP routes in Task 5.

- [ ] **Step 1: Write failing lifecycle tests**

Test create/list/update/delete-never-published, local plus inherited summaries, duplicate names, authorization on owner group, stale metadata revision conflict, stale draft hash conflict, saved-validation invalidation, publish-without-validation rejection, validation-hash publication, and audit rollback.

```rust
let created = service.create(&admin, "class", "Exam restrictions", "Locked during exams").await.unwrap();
let saved = service.save_draft(&admin, &created.id, json!({"rules":[]}), None).await.unwrap();
assert!(service.publish(&admin, &created.id, "Initial policy").await.is_err());
let validated = service.validate_draft(&admin, &created.id).await.unwrap();
assert_eq!(validated.document_hash, saved.document_hash);
assert!(service.publish(&admin, &created.id, "Initial policy").await.is_ok());
```

- [ ] **Step 2: Run focused lifecycle tests and verify failure**

Run: `cargo test --manifest-path management/backend/Cargo.toml policy::service::tests`

Expected: FAIL because named-policy service methods and validation persistence do not exist.

- [ ] **Step 3: Implement service DTOs and methods**

Add these exact methods:

```rust
pub async fn list(&self, principal: &Principal, group_id: &str) -> Result<PolicyList, AppError>;
pub async fn create(&self, principal: &Principal, group_id: &str, name: &str, description: &str) -> Result<PolicyDetails, AppError>;
pub async fn get(&self, principal: &Principal, policy_id: &str) -> Result<PolicyDetails, AppError>;
pub async fn update(&self, principal: &Principal, policy_id: &str, request: UpdatePolicyRequest) -> Result<PolicyDetails, AppError>;
pub async fn delete_unpublished(&self, principal: &Principal, policy_id: &str, expected_revision: i64) -> Result<(), AppError>;
pub async fn get_draft_for_policy(&self, principal: &Principal, policy_id: &str) -> Result<Option<PolicyDraft>, AppError>;
pub async fn save_draft_for_policy(&self, principal: &Principal, policy_id: &str, document: Value, expected_hash: Option<&str>) -> Result<PolicyDraft, AppError>;
pub async fn validate_policy_draft(&self, principal: &Principal, policy_id: &str) -> Result<DraftValidation, AppError>;
pub async fn publish_policy(&self, principal: &Principal, policy_id: &str, summary: &str, validated_hash: &str) -> Result<PolicyVersion, AppError>;
pub async fn history_for_policy(&self, principal: &Principal, policy_id: &str, cursor: Option<&str>, limit: usize) -> Result<PolicyHistoryPage, AppError>;
```

Every mutation starts an immediate transaction, rechecks authorization inside it, checks the expected revision/hash, writes its audit event, and commits atomically. Saving deletes a validation whose hash differs. Publishing requires an exact persisted validation hash.

- [ ] **Step 4: Run lifecycle tests**

Run: `cargo test --manifest-path management/backend/Cargo.toml policy::service::tests`

Expected: all lifecycle, conflict, authorization, and audit rollback tests PASS.

- [ ] **Step 5: Commit**

```bash
git add management/backend/src/policy/service.rs
git commit -m "feat(management): implement named policy lifecycle"
```

### Task 4: Compile Multiple Policies and Version Their Composition

**Files:**
- Modify: `management/backend/src/policy/compiler.rs`
- Modify: `management/backend/src/policy/model.rs`
- Modify: `management/backend/src/policy/signing.rs`
- Modify: `src/shared/managementPolicy.ts`
- Test: `management/backend/src/policy/compiler.rs`
- Test: `management/backend/src/policy/signing.rs`
- Test: `src/shared/managementPolicy.test.ts`

**Interfaces:**
- Consumes active named policy versions and explicit `PolicyRule` values.
- Produces signed effective snapshots with `policySetRevisionId` and policy-level provenance.

- [ ] **Step 1: Write failing composition tests**

Cover root-to-child inheritance, two same-group policies ordered by priority, later soft override, preserved hard deny, preserved hard quota ceiling, disabled policy exclusion, exact policy/rule provenance, deterministic hash, and signature tamper detection.

```rust
assert_eq!(compiled.document.settings["readerTextSize"].value, json!(24));
assert_eq!(compiled.document.settings["readerTextSize"].source_policy_name, "Accessibility");
assert_eq!(compiled.document.settings["readerTextSize"].source_rule_id, "large-reader-text");
assert!(!compiled.document.features["cloud_llm"].enabled);
```

- [ ] **Step 2: Run compiler tests and verify failure**

Run: `cargo test --manifest-path management/backend/Cargo.toml policy::compiler::tests`

Expected: FAIL because compilation currently selects one active version per group and lacks policy provenance.

- [ ] **Step 3: Compile the ordered policy set**

For each ancestor root-first, select the latest policy-set revision and join its entries to immutable versions ordered by `priority`. If no revision exists for migrated data, synthesize the single legacy active entry without changing effective behavior. Apply each explicit rule through one exhaustive match and retain existing hard-constraint semantics.

Extend setting and feature provenance:

```rust
pub struct SettingRule {
    pub value: Value,
    pub source_group_id: String,
    pub source_group_name: String,
    pub source_policy_id: String,
    pub source_policy_name: String,
    pub source_policy_version_id: String,
    pub source_rule_id: String,
    pub locked: bool,
}
```

Add equivalent policy/version/rule source fields to `FeatureRule` and quota provenance. Add `policy_set_revision_ids: Vec<String>` to `PolicyDocument` and include it in canonical signing bytes and shared TypeScript validation.

- [ ] **Step 4: Implement audited activation and ordering**

Add `activate_policy_set(principal, group_id, ordered_policy_ids, summary)` to `PolicyService`. It verifies every policy belongs to the group and has an active published version, inserts one immutable revision plus entries, updates container enabled/priority metadata, and writes `policy_set.activated` in the same transaction.

- [ ] **Step 5: Run Rust and shared policy tests**

Run: `cargo test --manifest-path management/backend/Cargo.toml policy::compiler::tests policy::signing::tests`

Run: `npm test -- --run src/shared/managementPolicy.test.ts`

Expected: all composition, provenance, signature, and TypeScript snapshot validation tests PASS.

- [ ] **Step 6: Commit**

```bash
git add management/backend/src/policy/compiler.rs management/backend/src/policy/model.rs management/backend/src/policy/signing.rs management/backend/src/policy/service.rs src/shared/managementPolicy.ts src/shared/managementPolicy.test.ts
git commit -m "feat(management): compile ordered named policies"
```

### Task 5: Expose Named Policy and Registry APIs

**Files:**
- Modify: `management/backend/src/routes/policies.rs`
- Modify: `management/backend/src/application.rs`
- Test: `management/backend/src/routes/policies.rs`

**Interfaces:**
- Consumes Task 3 service methods and Task 2 registry metadata.
- Produces the collection/resource endpoints specified in the approved design.

- [ ] **Step 1: Write failing route tests**

Test list/create/get/patch/delete, draft GET/PUT with `expectedDocumentHash`, validate, publish with `validatedDocumentHash`, history, registry, activation ordering, inherited read-only access, capability failures, and `409 Conflict` bodies for stale revisions.

```rust
let response = app.oneshot(Request::post("/api/groups/class/policies")
    .header(header::AUTHORIZATION, bearer(&token))
    .header(header::CONTENT_TYPE, "application/json")
    .body(Body::from(r#"{"name":"Exam restrictions","description":""}"#)).unwrap()).await.unwrap();
assert_eq!(response.status(), StatusCode::OK);
```

- [ ] **Step 2: Run route tests and verify failure**

Run: `cargo test --manifest-path management/backend/Cargo.toml routes::policies::tests`

Expected: FAIL with 404 for the new endpoints.

- [ ] **Step 3: Add routes and handlers**

Mount:

```rust
.route("/api/groups/{group_id}/policies", get(list_policies).post(create_policy))
.route("/api/groups/{group_id}/policies/activation", post(activate_policy_set))
.route("/api/policies/{policy_id}", get(get_policy).patch(update_policy).delete(delete_policy))
.route("/api/policies/{policy_id}/draft", get(get_policy_draft).put(save_policy_draft))
.route("/api/policies/{policy_id}/validate", post(validate_policy_draft))
.route("/api/policies/{policy_id}/publish", post(publish_policy))
.route("/api/policies/{policy_id}/history", get(policy_history))
.route("/api/policy-registry", get(get_policy_registry))
```

Return structured validation errors as `{ code, message, ruleId, field }`. Keep the old group-scoped endpoints temporarily as compatibility adapters to the migrated `Group policy`; mark them deprecated in response headers and remove their use from the console.

- [ ] **Step 4: Run route and backend tests**

Run: `cargo test --manifest-path management/backend/Cargo.toml routes::policies::tests`

Expected: all named-policy HTTP contract tests PASS.

- [ ] **Step 5: Commit**

```bash
git add management/backend/src/routes/policies.rs management/backend/src/application.rs
git commit -m "feat(management): expose named policy APIs"
```

### Task 6: Build the Console Policy State Model

**Files:**
- Modify: `management/frontend/src/api/types.ts`
- Create: `management/frontend/src/policies/types.ts`
- Create: `management/frontend/src/policies/policyState.ts`
- Test: `management/frontend/src/policies/policyState.test.ts`

**Interfaces:**
- Produces typed API contracts and pure functions used by the policy UI.
- Produces `derivePolicyStatus`, `canValidate`, `canPublish`, `publicationBlockReason`, and `serializeDraft`.

- [ ] **Step 1: Write failing status-machine tests**

```ts
expect(derivePolicyStatus({ serverHash: 'a', localHash: 'b', validatedHash: null, activeHash: null })).toBe('unsaved');
expect(publicationBlockReason({ serverHash: 'a', localHash: 'b', validatedHash: null, activeHash: null })).toBe('Save draft before validating or publishing');
expect(derivePolicyStatus({ serverHash: 'a', localHash: 'a', validatedHash: 'a', activeHash: null })).toBe('validated');
expect(canPublish({ serverHash: 'a', localHash: 'a', validatedHash: 'a', activeHash: null }, 'Initial')).toBe(true);
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm test -- --run src/policies/policyState.test.ts` from `management/frontend`.

Expected: FAIL because the state module does not exist.

- [ ] **Step 3: Add API and rule types**

Define `PolicySummary`, `PolicyDetails`, `PolicyDraft`, `PolicyVersion`, `PolicyRegistryEntry`, the discriminated `PolicyRule` union matching Rust, `PolicyEditorState`, and `PolicyStatus = 'draft' | 'unsaved' | 'saved' | 'invalid' | 'validated' | 'published' | 'disabled'`.

- [ ] **Step 4: Implement pure state transitions**

Hash canonical serialized rules deterministically using Web Crypto or compare the canonical server draft with a stable serializer. Never treat a validation as current unless its hash equals both local and saved hashes. Return the exact user-facing block reasons from the approved design.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -- --run src/policies/policyState.test.ts && npm run typecheck` from `management/frontend`.

Expected: status tests and TypeScript typecheck PASS.

- [ ] **Step 6: Commit**

```bash
git add management/frontend/src/api/types.ts management/frontend/src/policies
git commit -m "feat(management): model policy editor lifecycle"
```

### Task 7: Replace the Policies Page With List and Rule Builder

**Files:**
- Replace: `management/frontend/src/pages/Policies.tsx`
- Replace: `management/frontend/src/pages/Policies.test.tsx`
- Create: `management/frontend/src/components/policies/PolicyList.tsx`
- Create: `management/frontend/src/components/policies/PolicyEditor.tsx`
- Create: `management/frontend/src/components/policies/RulePicker.tsx`
- Create: `management/frontend/src/components/policies/RuleCard.tsx`
- Create: `management/frontend/src/components/policies/PolicyHistory.tsx`
- Create: `management/frontend/src/components/policies/PolicyPublishDialog.tsx`
- Modify: `management/frontend/src/styles.css`

**Interfaces:**
- Consumes Task 5 endpoints and Task 6 lifecycle functions.
- Produces the complete selected-group policy administration workflow.

- [ ] **Step 1: Write failing page tests**

Cover selected group heading, local and inherited lists, empty state, create policy, deleting a never-published empty policy with confirmation, refusing destructive deletion after publication, selecting a policy, adding only a chosen rule, typed setting values, lock toggle, duplicate-rule exclusion, remove rule, unsaved warning, save/validate/publish reasons, validation errors beside rule fields, history, inherited read-only view, activation/reorder confirmation, and unsaved navigation confirmation.

```tsx
expect(await screen.findByRole('heading', { name: 'Policies for German A' })).toBeVisible();
expect(screen.getByRole('button', { name: 'Create policy' })).toBeVisible();
fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
fireEvent.click(screen.getByRole('option', { name: 'Reader text size' }));
expect(screen.getByRole('spinbutton', { name: 'Reader text size' })).toBeVisible();
expect(screen.queryByLabelText('Conversation retention days')).not.toBeInTheDocument();
expect(screen.getByText('Save draft before validating or publishing')).toBeVisible();
```

- [ ] **Step 2: Run the page tests and verify failure**

Run: `npm test -- --run src/pages/Policies.test.tsx` from `management/frontend`.

Expected: FAIL because the current page renders every option and has no policy list.

- [ ] **Step 3: Implement list and selection**

Load `/api/groups/{groupId}/policies` on group changes. Render local policies ordered by priority and inherited policies grouped by source group. Each row shows name, rule count, status, enabled state, last update, and source. Preserve selection when refreshing; otherwise select the first local policy.

- [ ] **Step 4: Implement focused rule editing**

Load `/api/policy-registry` once per authenticated session. `RulePicker` searches labels/descriptions and groups by category. `RuleCard` renders boolean, number, text, nullable text, or allowed-value select from registry metadata. It shows `Lock this setting` only when supported and removes singleton entries from the picker after addition.

- [ ] **Step 5: Implement lifecycle actions**

Keep Save, Validate, and Publish visible. Show `publicationBlockReason()` under disabled actions. Save sends the expected hash, validate stores the returned hash, and publish requires the same hash plus summary. Refresh list/history/effective data after publish. Preserve local state on server errors and map structured validation errors to rule cards.

- [ ] **Step 6: Implement history, diff, activation, and navigation safety**

Show immutable version rows with author, timestamp, summary, active state, and rule snapshot. Review added/changed/removed rules in the publish dialog. Confirm enabled/order changes before creating a policy-set revision. Use a router blocker and `beforeunload` only while local state is unsaved.

- [ ] **Step 7: Run frontend verification**

Run: `npm test -- --run src/pages/Policies.test.tsx src/policies/policyState.test.ts && npm run typecheck && npm run build` from `management/frontend`.

Expected: policy tests, typecheck, and production build PASS.

- [ ] **Step 8: Commit**

```bash
git add management/frontend/src/pages/Policies.tsx management/frontend/src/pages/Policies.test.tsx management/frontend/src/components/policies management/frontend/src/styles.css
git commit -m "feat(management): rebuild policy administration UI"
```

### Task 8: Surface Policy Names on Locked Settings in the Learning App

**Files:**
- Modify: `src/shared/managementPolicy.ts`
- Modify: `src/renderer/components/common/ManagedSettingNotice/ManagedSettingNotice.tsx`
- Modify: `src/renderer/components/common/ManagedSettingNotice/ManagedSettingNotice.test.tsx`
- Modify: `src/renderer/components/common/Settings/SettingRow.test.tsx`
- Test: `src/renderer/context/SettingsContext.test.ts`

**Interfaces:**
- Consumes policy provenance from Task 4.
- Preserves existing centralized enforcement while displaying source group and named policy.

- [ ] **Step 1: Write failing provenance and enforcement tests**

```tsx
expect(screen.getByRole('note')).toHaveTextContent('Managed by your school');
expect(screen.getByRole('note')).toHaveTextContent('Accessibility');
expect(screen.getByRole('note')).toHaveTextContent('German A');
```

Extend `SettingsContext` tests to attempt `updateSetting`, `updateSettings`, persisted reload, and BroadcastChannel mutation against a locked value with named-policy provenance; every path must restore the enforced value.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- --run src/renderer/components/common/ManagedSettingNotice/ManagedSettingNotice.test.tsx src/renderer/context/SettingsContext.test.ts`

Expected: notice test FAIL because policy name is not displayed; existing enforcement assertions remain green.

- [ ] **Step 3: Update the notice without changing enforcement semantics**

Render `Managed by your school · {sourcePolicyName} · {sourceGroupName}` when policy provenance exists, retaining the existing group-only fallback for cached legacy snapshots. Do not introduce direct settings mutation or another enforcement path.

- [ ] **Step 4: Run focused and full app checks**

Run: `npm test -- --run src/shared/managementPolicy.test.ts src/renderer/services/managementPolicyService.test.ts src/renderer/components/common/ManagedSettingNotice/ManagedSettingNotice.test.tsx src/renderer/components/common/Settings/SettingRow.test.tsx src/renderer/context/SettingsContext.test.ts`

Run: `npm run typecheck`

Expected: all policy enforcement tests and both TypeScript projects PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/managementPolicy.ts src/renderer/components/common/ManagedSettingNotice src/renderer/components/common/Settings/SettingRow.test.tsx src/renderer/context/SettingsContext.test.ts
git commit -m "feat: identify named policy on managed settings"
```

### Task 9: Remove Compatibility UI Assumptions and Verify the Whole Platform

**Files:**
- Modify: `docs/superpowers/specs/2026-07-09-school-management-platform-design.md`
- Modify: `docs/superpowers/plans/2026-07-09-school-management-console.md`
- Test: all policy-related backend, console, and app suites

**Interfaces:**
- Produces a release-ready, documented named-policy feature with legacy HTTP adapters retained only for external compatibility.

- [ ] **Step 1: Update the original SDD documents**

Replace the obsolete “one editable draft / one active version per group” language with a link to the approved named-policy design. Mark the old all-options Policies page plan as superseded and record the new API paths.

- [ ] **Step 2: Run formatting and static checks**

Run: `cargo fmt --manifest-path management/backend/Cargo.toml -- --check`

Run: `cargo clippy --manifest-path management/backend/Cargo.toml --all-targets -- -D warnings`

Run: `npm run typecheck`

Run from `management/frontend`: `npm run typecheck && npm run build`

Expected: every command exits 0 with no warnings or type errors.

- [ ] **Step 3: Run complete automated tests**

Run: `cargo test --manifest-path management/backend/Cargo.toml`

Run: `npm run test`

Run from `management/frontend`: `npm run test`

Expected: all Rust, main-app, and console tests PASS.

- [ ] **Step 4: Check migration and working-tree integrity**

Run: `git diff --check`

Start a backend against a copy of a pre-0016 database and verify the migrated effective snapshot has identical setting, feature, LLM, quota, and governance behavior. Create two policies in one group, add and lock a setting rule, save, validate, publish, activate, and confirm `/api/policy/me` contains the required value and full source provenance.

Expected: no whitespace errors; legacy behavior matches; the end-to-end named-policy workflow succeeds without 4xx/5xx responses.

- [ ] **Step 5: Commit documentation and final fixes**

```bash
git add docs/superpowers/specs/2026-07-09-school-management-platform-design.md docs/superpowers/plans/2026-07-09-school-management-console.md
git commit -m "docs(management): document named policy workflow"
```
