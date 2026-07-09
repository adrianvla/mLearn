# School Management Policies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add versioned group policies, deterministic inheritance, signed effective snapshots, active-group selection, and enforced managed settings in every app window.

**Architecture:** The backend owns a typed policy registry and compiles root-to-leaf snapshots with provenance. The app stores only the active group and last signed snapshot, then applies managed values at `SettingsContext`, the existing mutation and cross-window boundary. Policy UI metadata is exposed through the same context.

**Tech Stack:** Rust/SQLx/Ed25519, Serde JSON, SolidJS, TypeScript, `@noble/ed25519`, IndexedDB, Vitest.

## Global Constraints

- Policies attach only to groups; one-off exceptions use child groups.
- Drafts never affect clients; published versions are immutable.
- Parent hard denies and maximum limits cannot be weakened by children.
- App policy code is language-agnostic and setting keys come from a validated registry.
- Every settings mutation still uses `updateSetting()` or `updateSettings()`.
- Cached restrictions remain enforced while management is unavailable.
- Switching active group refreshes and verifies policy before group-scoped network features resume.

---

### Task 1: Typed policy contract and registry

**Files:**
- Create: `management/backend/src/policy/mod.rs`
- Create: `management/backend/src/policy/model.rs`
- Create: `management/backend/src/policy/registry.rs`
- Modify: `management/backend/src/lib.rs`
- Create: `src/shared/managementPolicy.ts`
- Test: `management/backend/src/policy/registry.rs`
- Test: `src/shared/managementPolicy.test.ts`

**Interfaces:**
- Produces Rust `PolicyDocument`, `SettingRule`, `FeatureRule`, `LlmPolicy`, `QuotaRule`.
- Produces TypeScript `EffectiveManagementPolicy` and `ManagedSettingRule<K>`.
- Produces `validate_policy_document` and `validateEffectiveManagementPolicy`.

- [ ] **Step 1: Write failing registry tests**

```rust
#[test]
fn registry_rejects_unknown_setting_and_wrong_value_type() {
    assert!(validate_setting_rule("notASetting", &json!(true)).is_err());
    assert!(validate_setting_rule("llmEnabled", &json!("yes")).is_err());
    assert!(validate_setting_rule("llmEnabled", &json!(false)).is_ok());
}
```

```ts
it('rejects executable or unknown policy fields', () => {
  expect(validateEffectiveManagementPolicy({ version: 1, settings: { unknown: { value: true } } }).ok).toBe(false);
});
```

- [ ] **Step 2: Run and confirm failures**

Run: `cargo test --manifest-path management/backend/Cargo.toml policy::registry::tests`

Run: `npx vitest run --project node src/shared/managementPolicy.test.ts`

Expected: both FAIL because the policy contracts do not exist.

- [ ] **Step 3: Define the canonical JSON shape**

Use this public contract in both languages:

```ts
export interface EffectiveManagementPolicy {
  schemaVersion: 1;
  policyVersionId: string;
  activeGroupId: string;
  ancestry: Array<{ id: string; name: string }>;
  settings: Partial<Record<keyof Settings, {
    value: Settings[keyof Settings];
    sourceGroupId: string;
    sourceGroupName: string;
    locked: true;
  }>>;
  features: Record<string, { enabled: boolean; sourceGroupId: string; hard: boolean }>;
  llm: EffectiveLlmPolicy;
  issuedAt: string;
  expiresAt: string;
  keyId: string;
  signature: string;
}
```

The Rust registry maps allowed keys to JSON types and rejects `cloudAuthAccessToken`, `cloudAuthRefreshToken`, secret/provider credentials, and custom executable content.

- [ ] **Step 4: Implement validators and round-trip fixtures**

Add a shared JSON fixture under `test/fixtures/management-policy-v1.json`. Rust serializes it; TypeScript parses it; both assert the same schema/version/key behavior.

- [ ] **Step 5: Run focused tests**

Expected: Rust and TypeScript contract tests PASS.

- [ ] **Step 6: Commit**

```bash
git add management/backend/src/policy management/backend/src/lib.rs src/shared/managementPolicy.ts src/shared/managementPolicy.test.ts test/fixtures/management-policy-v1.json
git commit -m "feat: define management policy contract"
```

### Task 2: Drafts, immutable versions, inheritance, and provenance

**Files:**
- Create: `management/backend/migrations/0004_policies.sql`
- Create: `management/backend/src/policy/compiler.rs`
- Create: `management/backend/src/policy/service.rs`
- Create: `management/backend/src/routes/policies.rs`
- Modify: `management/backend/src/routes/mod.rs`
- Modify: `management/backend/src/main.rs`
- Test: `management/backend/src/policy/compiler.rs`
- Test: `management/backend/src/routes/policies.rs`

**Interfaces:**
- Produces: `PolicyService::{save_draft, validate_draft, publish, history, effective_for_group}`.
- Produces: `CompiledPolicy { document, provenance, parent_versions }`.

- [ ] **Step 1: Write failing inheritance tests**

```rust
#[tokio::test]
async fn child_specializes_language_but_cannot_weaken_parent_hard_deny() {
    let f = PolicyFixture::german_tree().await;
    f.publish_root(json!({"features":{"cloud_tts":{"enabled":false,"hard":true}}})).await;
    f.publish_german_a(json!({
        "languageProfile":{"language":"de"},
        "features":{"cloud_tts":{"enabled":true}}
    })).await;
    let effective = f.service.effective_for_group(&f.german_a).await.unwrap();
    assert_eq!(effective.language_profile.language, "de");
    assert!(!effective.features["cloud_tts"].enabled);
    assert_eq!(effective.features["cloud_tts"].source_group_id, f.root);
}
```

- [ ] **Step 2: Run and confirm failure**

Run: `cargo test --manifest-path management/backend/Cargo.toml policy::compiler::tests`

Expected: FAIL because compiler/service are undefined.

- [ ] **Step 3: Implement schema and compiler**

Create `policy_drafts`, `policy_versions`, and `active_policies`. Store normalized JSON plus SHA-256 hash, author, summary, parent version IDs, and timestamp. Compile ancestors root-to-leaf in one read transaction. Merge rules by kind; preserve hard constraints and attach source-group provenance.

- [ ] **Step 4: Implement permission-scoped routes**

Add:

- `GET/PUT /api/groups/{group_id}/policy/draft`
- `POST /api/groups/{group_id}/policy/validate`
- `POST /api/groups/{group_id}/policy/publish`
- `GET /api/groups/{group_id}/policy/history`
- `GET /api/groups/{group_id}/policy/effective`

Require `policies.view`, `policies.edit`, or `policies.publish` as appropriate. Publishing writes version activation and audit event atomically.

- [ ] **Step 5: Run focused tests and migration tests**

Expected: drafts remain inert; publish is immutable; provenance is deterministic; unauthorized sibling queries return `403`.

- [ ] **Step 6: Commit**

```bash
git add management/backend
git commit -m "feat(management): add inherited group policies"
```

### Task 3: Signed effective-policy endpoint

**Files:**
- Modify: `management/backend/Cargo.toml`
- Modify: `management/backend/src/config.rs`
- Modify: `management/backend/src/state.rs`
- Create: `management/backend/src/policy/signing.rs`
- Modify: `management/backend/src/routes/policies.rs`
- Test: `management/backend/src/policy/signing.rs`

**Interfaces:**
- Produces: `PolicySigner::{load_or_generate, public_key, sign_snapshot}`.
- Produces: `GET /api/policy/me` and `GET /api/policy/public-key`.

- [ ] **Step 1: Write failing tamper test**

```rust
#[test]
fn signature_fails_after_managed_value_is_changed() {
    let signer = PolicySigner::generate_for_test();
    let signed = signer.sign_snapshot(fixture_snapshot()).unwrap();
    let mut tampered = signed.clone();
    tampered.policy.settings.get_mut("llmEnabled").unwrap().value = json!(true);
    assert!(!signer.verify_for_test(&tampered));
}
```

- [ ] **Step 2: Run and confirm failure**

Run: `cargo test --manifest-path management/backend/Cargo.toml policy::signing::tests`

- [ ] **Step 3: Add Ed25519 signing**

Add `ed25519-dalek = { version = "2", features = ["rand_core"] }`. Canonicalize the unsigned snapshot, sign its bytes, and encode signature/public key as base64url. Persist the private key at `MLEARN_POLICY_SIGNING_KEY_PATH` (`/data/policy-signing-key` in release) with mode `0600`.

- [ ] **Step 4: Implement endpoint semantics**

`/api/policy/me` uses the authenticated session's active group, verifies current membership, compiles the policy, sets a bounded expiry, and signs it. `/api/policy/public-key` returns `{ keyId, algorithm: "Ed25519", publicKey }`.

- [ ] **Step 5: Verify signatures and membership revocation**

Expected: tampering fails; an archived group or removed membership cannot receive a new snapshot.

- [ ] **Step 6: Commit**

```bash
git add management/backend
git commit -m "feat(management): sign effective policy snapshots"
```

### Task 4: Active-group session integration in the app

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/services/cloudAuthService.ts`
- Create: `src/renderer/services/managementGroupService.ts`
- Modify: `src/renderer/context/SettingsContext.tsx`
- Modify: `src/renderer/services/cloudSessionManager.ts`
- Test: `src/renderer/services/cloudAuthService.test.ts`
- Test: `src/renderer/services/managementGroupService.test.ts`

**Interfaces:**
- Adds settings: `cloudAuthActiveGroupId`, `cloudAuthActiveGroupName` with `DEFAULT_SETTINGS` empty-string fallbacks.
- Produces: `getEligibleGroups`, `activateGroup`, `ensureActiveGroup`.

- [ ] **Step 1: Write failing active-group tests**

```ts
it('auto-selects the only eligible group and persists it through updateSettings', async () => {
  mockFetch.mockResolvedValue(okJson({ groups: [{ id: 'german-a', name: 'German A' }] }));
  const result = await ensureActiveGroup(settings, updateSettings);
  expect(result.id).toBe('german-a');
  expect(updateSettings).toHaveBeenCalledWith({
    cloudAuthActiveGroupId: 'german-a',
    cloudAuthActiveGroupName: 'German A',
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run --project renderer src/renderer/services/managementGroupService.test.ts`

- [ ] **Step 3: Implement group APIs and settings migration**

Call `GET /api/groups/eligible` and `POST /api/groups/{id}/activate` at the resolved cloud API URL with the refreshed access token. Clear active group on sign-out and when `/api/auth/me` no longer lists it.

- [ ] **Step 4: Integrate with session startup**

After a valid/refreshed session, call `ensureActiveGroup`; for multiple groups expose `needsSelection: true` rather than choosing silently. Do not allow group-scoped LLM/policy calls until activation succeeds.

- [ ] **Step 5: Run auth/session tests and typecheck**

Run: `npx vitest run --project renderer src/renderer/services/cloudAuthService.test.ts src/renderer/services/managementGroupService.test.ts src/renderer/services/cloudSessionManager.test.ts`

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/renderer/services src/renderer/context/SettingsContext.tsx
git commit -m "feat: add active school group sessions"
```

### Task 5: Policy verification, cache, and SettingsContext enforcement

**Files:**
- Create: `src/renderer/services/managementPolicyService.ts`
- Create: `src/renderer/services/managementPolicyCache.ts`
- Modify: `src/renderer/context/SettingsContext.tsx`
- Modify: `src/renderer/context/SettingsContext.test.tsx`
- Create: `src/renderer/services/managementPolicyService.test.ts`
- Create: `src/renderer/services/managementPolicyCache.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `fetchEffectivePolicy`, `verifyEffectivePolicy`, `loadCachedPolicy`, `saveCachedPolicy`.
- Extends `SettingsContextValue` with `managedPolicy`, `isSettingManaged`, and `getManagedSettingSource`.

- [ ] **Step 1: Write failing enforcement tests**

```ts
it('restores a locked value for local and broadcast updates', async () => {
  const policy = policyWithSetting('llmEnabled', false, 'School');
  const { context, broadcast } = await mountSettings({ llmEnabled: true }, policy);
  context.updateSetting('llmEnabled', true);
  expect(context.settings.llmEnabled).toBe(false);
  broadcast({ ...context.settings, llmEnabled: true });
  expect(context.settings.llmEnabled).toBe(false);
  expect(context.getManagedSettingSource('llmEnabled')?.sourceGroupName).toBe('School');
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run --project renderer src/renderer/context/SettingsContext.test.tsx src/renderer/services/managementPolicyService.test.ts`

- [ ] **Step 3: Implement cross-platform signature verification and IndexedDB cache**

Add `@noble/ed25519` to `package.json` and verify Ed25519 over the same canonical JSON bytes as Rust. Cache the authenticated deployment public key by management API origin and require re-enrollment if that key changes unexpectedly. Cache snapshots by origin and user ID. Reject wrong key ID, expired signatures for network authorization, mismatched active group, and unsupported schema versions. This avoids depending on uneven Web Crypto Ed25519 support across Capacitor WebViews.

- [ ] **Step 4: Add one policy application function**

```ts
export function applyManagedSettings(base: Settings, policy: EffectiveManagementPolicy | null): Settings {
  if (!policy) return base;
  const next = { ...base };
  for (const [key, rule] of Object.entries(policy.settings)) {
    if (rule) (next as Record<string, unknown>)[key] = rule.value;
  }
  return next;
}
```

Call it after disk load, before `updateSetting`, before `updateSettings`, and in `handleBroadcast`. Persist and broadcast the reconciled snapshot only.

- [ ] **Step 5: Implement fail-closed network feature helpers**

Expose `policyAllowsFeature(featureId)` and `hasFreshNetworkPolicy()`. Cached managed values remain applied when stale, but LLM/cloud features require a fresh policy.

- [ ] **Step 6: Run settings, service, full tests, and typecheck**

Expected: locked values survive every mutation path; stale policy preserves restrictions; invalid signature is rejected.

- [ ] **Step 7: Commit**

```bash
git add src/shared/managementPolicy.ts src/renderer/context/SettingsContext.tsx src/renderer/context/SettingsContext.test.tsx src/renderer/services/managementPolicy*
git commit -m "feat: enforce signed school policies in settings"
```

### Task 6: Active-group selector and managed-setting affordances

**Files:**
- Create: `src/renderer/components/cloud/ActiveGroupSelector.tsx`
- Create: `src/renderer/components/cloud/ActiveGroupSelector.css`
- Create: `src/renderer/components/cloud/ActiveGroupSelector.test.tsx`
- Create: `src/renderer/components/common/ManagedSettingNotice/ManagedSettingNotice.tsx`
- Create: `src/renderer/components/common/ManagedSettingNotice/ManagedSettingNotice.css`
- Create: `src/renderer/components/common/ManagedSettingNotice/ManagedSettingNotice.test.tsx`
- Modify: `src/renderer/components/common/index.ts`
- Modify: `src/renderer/context/WindowWrapper.tsx`
- Modify: `src/renderer/windows/settings/tabs/ConnectionTab.tsx`
- Modify: `src/renderer/windows/settings/tabs/AITab.tsx`
- Modify: `src/renderer/windows/settings/tabs/BehaviourTab.tsx`
- Modify: `src/renderer/windows/settings/tabs/ComponentsTab.tsx`
- Modify: `src/renderer/windows/settings/tabs/CustomizationTab.tsx`
- Modify: `src/renderer/windows/settings/tabs/GeneralTab.tsx`
- Modify: `src/renderer/windows/settings/tabs/ReaderTab.tsx`
- Modify: `src/renderer/windows/settings/tabs/SRSTab.tsx`
- Modify: `src/renderer/windows/settings/tabs/StatsTab.tsx`
- Modify: `src/renderer/windows/settings/tabs/VideoPlayerTab.tsx`

**Interfaces:**
- Produces reusable `ActiveGroupSelector` and `ManagedSettingNotice`.

- [ ] **Step 1: Write failing UI behavior tests**

```tsx
it('requires explicit selection when multiple groups are eligible', async () => {
  render(() => <ActiveGroupSelector groups={GROUPS} activeGroupId="" onActivate={activate} />);
  expect(screen.getByRole('dialog', { name: 'Choose a class or group' })).toBeVisible();
});

it('labels a locked control with its source group', () => {
  render(() => <ManagedSettingNotice sourceGroupName="German" />);
  expect(screen.getByText('Managed by German')).toBeVisible();
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run --project renderer src/renderer/components/cloud/ActiveGroupSelector.test.tsx src/renderer/components/common/ManagedSettingNotice/ManagedSettingNotice.test.tsx`

- [ ] **Step 3: Implement accessible selection and lock messaging**

Use existing mLearn common controls and SVG icons. Single-group users never see the modal. Switching calls `activateGroup`, refreshes policy, then updates settings. Managed controls remain visible, disabled, and explain their source.

Mount `ActiveGroupSelector` once in `WindowWrapper` so every desktop and mobile entry point receives the required post-login selection gate. Wrap every registry-supported setting control in the listed settings tabs with the same `isSettingManaged(key)`/source behavior; unsupported and secret settings are never made policy-addressable.

- [ ] **Step 4: Add strings to every shipped locale and validate JSON**

Add keys under `mlearn.Management` in every shipped `src/root-of-app/locales/lang.*.json` file, currently English, German, French, Japanese, Russian, and Chinese; run `node -e "for (const f of require('fs').readdirSync('src/root-of-app/locales').filter(f=>f.endsWith('.json'))) JSON.parse(require('fs').readFileSync('src/root-of-app/locales/'+f,'utf8'))"`.

- [ ] **Step 5: Run focused tests, full typecheck, and commit**

```bash
git add src/renderer/components src/renderer/windows/settings src/root-of-app/locales
git commit -m "feat: show active groups and managed settings"
```
