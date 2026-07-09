# School Management Identity and Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single management bearer token with durable named accounts, compatible app sessions, a strict group tree, and downward-only capability delegation.

**Architecture:** SQLx owns transactional SQLite migrations and repositories. `Principal` is the single authenticated request identity, and `AuthorizationService` is the only path for subtree/capability checks. The existing management token becomes bootstrap/recovery authority, while normal console and app requests use rotating sessions.

**Tech Stack:** Rust 1.75+, Axum 0.8, Tokio, SQLx SQLite, Argon2id, JWT access tokens, UUID v7 identifiers, Serde.

## Global Constraints

- Groups have exactly one parent except the root; cycles are rejected.
- Identity type never grants group visibility without a membership.
- A delegator cannot grant a capability they do not hold at the target group.
- `/api/auth/desktop/init`, `/api/auth/desktop/exchange`, `/api/auth/refresh`, and `/api/auth/me` must match `src/renderer/services/cloudAuthService.ts`.
- `MLEARN_MANAGEMENT_TOKEN` remains bootstrap/recovery only and every use is audited.
- All database mutations and their audit event commit in one transaction.
- Preserve current Docker diagnostics and `/api/health` behavior.

---

### Task 1: SQLite runtime and transactional migrations

**Files:**
- Modify: `management/backend/Cargo.toml`
- Modify: `management/backend/src/config.rs`
- Modify: `management/backend/src/state.rs`
- Modify: `management/backend/src/lib.rs`
- Modify: `management/backend/src/main.rs`
- Create: `management/backend/src/db.rs`
- Create: `management/backend/migrations/0001_identity.sql`
- Test: `management/backend/src/db.rs`

**Interfaces:**
- Produces: `pub async fn connect_database(config: &Config) -> Result<SqlitePool, AppError>`
- Produces: `AppState { db: SqlitePool, ... }`
- Produces: `Config::management_db_path: String`

- [ ] **Step 1: Write the failing migration test**

```rust
#[tokio::test]
async fn migrates_empty_database_with_foreign_keys_enabled() {
    let pool = connect_test_database().await.unwrap();
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).fetch_all(&pool).await.unwrap();
    assert!(tables.contains(&"users".to_string()));
    assert!(tables.contains(&"sessions".to_string()));
    assert!(tables.contains(&"audit_events".to_string()));
    assert_eq!(sqlx::query_scalar::<_, i64>("PRAGMA foreign_keys")
        .fetch_one(&pool).await.unwrap(), 1);
}
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `cargo test --manifest-path management/backend/Cargo.toml db::tests::migrates_empty_database_with_foreign_keys_enabled`

Expected: FAIL because `db` and `connect_test_database` do not exist.

- [ ] **Step 3: Add SQLx and the database state**

Add `sqlx = { version = "0.8", features = ["runtime-tokio", "sqlite", "migrate", "macros"] }`, `uuid = { version = "1", features = ["v7", "serde"] }`, and `time = { version = "0.3", features = ["serde"] }`. Implement:

```rust
pub async fn connect_database(config: &Config) -> Result<SqlitePool, AppError> {
    let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", config.management_db_path))?
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal);
    let pool = SqlitePoolOptions::new().max_connections(8).connect_with(options).await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(pool)
}
```

Create `users`, `password_credentials`, `sessions`, `refresh_tokens`, `devices`, `desktop_login_requests`, `audit_events`, and `deployment_settings`. Use text UUID primary keys, UTC integer timestamps, foreign keys, and unique normalized email.

- [ ] **Step 4: Initialize the pool before the router**

Change `AppState::new` to accept `SqlitePool`; call `connect_database` before `build_router`; default `MLEARN_MANAGEMENT_DB` to `management.db` in debug and `/data/management.db` in release.

- [ ] **Step 5: Run the focused and existing backend tests**

Run: `cargo test --manifest-path management/backend/Cargo.toml db::tests::migrates_empty_database_with_foreign_keys_enabled`

Expected: PASS.

Run: `cargo test --manifest-path management/backend/Cargo.toml`

Expected: existing token/config/router tests remain PASS.

- [ ] **Step 6: Commit**

```bash
git add management/backend/Cargo.toml management/backend/Cargo.lock management/backend/migrations/0001_identity.sql management/backend/src/config.rs management/backend/src/db.rs management/backend/src/lib.rs management/backend/src/main.rs management/backend/src/state.rs
git commit -m "feat(management): add sqlite persistence foundation"
```

### Task 2: Password accounts, bootstrap, and rotating sessions

**Files:**
- Modify: `management/backend/Cargo.toml`
- Modify: `management/backend/src/auth.rs`
- Modify: `management/backend/src/error.rs`
- Modify: `management/backend/src/lib.rs`
- Modify: `management/backend/src/main.rs`
- Create: `management/backend/src/identity.rs`
- Create: `management/backend/src/routes/auth.rs`
- Modify: `management/backend/src/routes/mod.rs`
- Test: `management/backend/src/identity.rs`
- Test: `management/backend/src/routes/auth.rs`

**Interfaces:**
- Produces: `IdentityType::{Admin, Teacher, Learner}`
- Produces: `Principal { user_id, session_id, device_id, active_group_id, identity_type }`
- Produces: `IdentityService::{bootstrap_root, authenticate_password, issue_session, rotate_refresh_token, revoke_session}`
- Produces compatible auth route payloads consumed by `cloudAuthService.ts`.

- [ ] **Step 1: Write failing password and refresh-rotation tests**

```rust
#[tokio::test]
async fn refresh_tokens_are_single_use_and_rotate() {
    let fixture = IdentityFixture::new().await;
    let issued = fixture.issue_learner_session().await;
    let rotated = fixture.service.rotate_refresh_token(&issued.refresh_token).await.unwrap();
    assert_ne!(rotated.refresh_token, issued.refresh_token);
    assert!(fixture.service.rotate_refresh_token(&issued.refresh_token).await.is_err());
}

#[tokio::test]
async fn bootstrap_token_creates_exactly_one_root_admin() {
    let fixture = IdentityFixture::new().await;
    fixture.service.bootstrap_root(&fixture.bootstrap, "admin@school.test", "Correct Horse Battery Staple").await.unwrap();
    assert!(fixture.service.bootstrap_root(&fixture.bootstrap, "second@school.test", "Another Strong Password").await.is_err());
}
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `cargo test --manifest-path management/backend/Cargo.toml identity::tests`

Expected: FAIL because `IdentityService` is undefined.

- [ ] **Step 3: Implement password and session primitives**

Add `argon2 = "0.5"`, `jsonwebtoken = "9"`, `rand = "0.8"`, and `base64 = "0.22"`. Define:

```rust
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IdentityType { Admin, Teacher, Learner }

#[derive(Clone, Debug)]
pub struct IssuedSession {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
}
```

Hash passwords with Argon2id defaults, hash refresh tokens with SHA-256 before persistence, rotate refresh tokens transactionally, and include `sub`, `sid`, `did`, `active_group_id`, `identity_type`, `iat`, and `exp` in access claims.

- [ ] **Step 4: Implement compatible auth routes**

Implement request/response names exactly:

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopInitRequest { state: String, code_challenge: String, code_challenge_method: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthSessionDto { access_token: String, refresh_token: String, expires_at: i64 }
```

Routes:

- `POST /api/auth/bootstrap`
- `POST /api/auth/login`
- `POST /api/auth/desktop/init`
- `GET /login?request=<id>` served by the frontend
- `POST /api/auth/desktop/approve`
- `POST /api/auth/desktop/exchange`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Desktop exchange must return `{ session: { accessToken, refreshToken, expiresAt }, user: { id, email } }`.

- [ ] **Step 5: Replace the global admin middleware with `Principal` extraction**

Keep recovery-token verification only on bootstrap/recovery routes. Protected product routes require an access-token `Principal`; legacy diagnostics temporarily accept a root admin principal. Return structured `401`/`403` JSON via `AppError`.

- [ ] **Step 6: Run route compatibility tests**

Run: `cargo test --manifest-path management/backend/Cargo.toml routes::auth::tests`

Expected: init → approval → exchange returns the exact camelCase session envelope; a refresh token succeeds once; `/api/auth/me` rejects a revoked session.

- [ ] **Step 7: Commit**

```bash
git add management/backend
git commit -m "feat(management): add named accounts and compatible sessions"
```

### Task 3: Strict group tree and capability authorization

**Files:**
- Create: `management/backend/migrations/0002_groups.sql`
- Create: `management/backend/src/groups.rs`
- Create: `management/backend/src/authorization.rs`
- Create: `management/backend/src/routes/groups.rs`
- Modify: `management/backend/src/lib.rs`
- Modify: `management/backend/src/routes/mod.rs`
- Modify: `management/backend/src/main.rs`
- Test: `management/backend/src/groups.rs`
- Test: `management/backend/src/authorization.rs`

**Interfaces:**
- Produces: `Capability` enum with the exact strings from the design spec.
- Produces: `AuthorizationService::require(principal, group_id, capability)`.
- Produces: `GroupService::{create_group, archive_group, add_membership, delegate_capabilities, visible_tree}`.

- [ ] **Step 1: Write failing isolation and delegation tests**

```rust
#[tokio::test]
async fn child_manager_cannot_see_parent_or_sibling() {
    let f = GroupFixture::german_tree().await;
    assert!(f.authz.require(&f.german_a_teacher, &f.german_a, Capability::GroupView).await.is_ok());
    assert!(f.authz.require(&f.german_a_teacher, &f.project_1, Capability::GroupView).await.is_ok());
    assert!(f.authz.require(&f.german_a_teacher, &f.german, Capability::GroupView).await.is_err());
    assert!(f.authz.require(&f.german_a_teacher, &f.german_b, Capability::GroupView).await.is_err());
}

#[tokio::test]
async fn delegator_cannot_grant_capability_they_do_not_hold() {
    let f = GroupFixture::german_tree().await;
    let result = f.groups.delegate_capabilities(
        &f.german_a_teacher,
        &f.project_1,
        &f.other_teacher,
        &[Capability::LlmConfigure],
    ).await;
    assert!(matches!(result, Err(AppError::Forbidden(_))));
}
```

- [ ] **Step 2: Run and confirm failure**

Run: `cargo test --manifest-path management/backend/Cargo.toml authorization::tests`

Run: `cargo test --manifest-path management/backend/Cargo.toml groups::tests`

Expected: FAIL because group services do not exist.

- [ ] **Step 3: Create group schema and recursive queries**

Create `groups(id, parent_id, name, slug, status, created_at, archived_at)`, `group_memberships`, and `membership_capabilities`. Enforce unique sibling slugs. Use recursive CTEs for ancestor/descendant checks and reject cycles before updating `parent_id`.

Define:

```rust
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum Capability {
    #[serde(rename = "group.view")] GroupView,
    #[serde(rename = "group.manage")] GroupManage,
    #[serde(rename = "members.view")] MembersView,
    #[serde(rename = "members.manage")] MembersManage,
    #[serde(rename = "permissions.delegate")] PermissionsDelegate,
    #[serde(rename = "policies.view")] PoliciesView,
    #[serde(rename = "policies.edit")] PoliciesEdit,
    #[serde(rename = "policies.publish")] PoliciesPublish,
    #[serde(rename = "analytics.view")] AnalyticsView,
    #[serde(rename = "conversations.view")] ConversationsView,
    #[serde(rename = "conversations.export")] ConversationsExport,
    #[serde(rename = "llm.configure")] LlmConfigure,
    #[serde(rename = "api_keys.manage")] ApiKeysManage,
}
```

- [ ] **Step 4: Implement centralized authorization**

`require` succeeds only when a non-archived membership at the target or one of its ancestors contains the requested capability. It must never infer permissions from identity type or from membership in a descendant.

- [ ] **Step 5: Implement permission-scoped group routes**

Add `GET/POST /api/groups`, `GET/PATCH /api/groups/{id}`, `POST /api/groups/{id}/archive`, membership CRUD, delegation, invitations, and `POST /api/groups/{id}/activate`. Every mutation writes an audit row in the same SQL transaction.

- [ ] **Step 6: Run the focused tests and backend suite**

Run: `cargo test --manifest-path management/backend/Cargo.toml authorization::tests`

Run: `cargo test --manifest-path management/backend/Cargo.toml groups::tests`

Run: `cargo test --manifest-path management/backend/Cargo.toml routes::groups::tests`

Expected: all subtree and subset-of-authority cases PASS.

- [ ] **Step 7: Commit**

```bash
git add management/backend
git commit -m "feat(management): add hierarchical groups and capabilities"
```

### Task 4: Provisioning, invitations, CSV import, and group API keys

**Files:**
- Create: `management/backend/migrations/0003_provisioning.sql`
- Create: `management/backend/src/provisioning.rs`
- Create: `management/backend/src/api_keys.rs`
- Modify: `management/backend/src/routes/users.rs` (replace stub implementation)
- Create: `management/backend/src/routes/api_keys.rs`
- Create: `management/backend/src/routes/audit.rs`
- Modify: `management/backend/src/main.rs`
- Test: `management/backend/src/provisioning.rs`
- Test: `management/backend/src/api_keys.rs`

**Interfaces:**
- Produces: `ProvisioningService::{preview_csv, import_csv, create_invitation, accept_invitation}`.
- Produces: `ApiKeyService::{create, authenticate, revoke}`.
- Produces: paginated `/api/users` and scoped `/api/groups/{id}/api-keys`.
- Produces: cursor-paginated, permission-scoped `GET /api/audit/events`.

- [ ] **Step 1: Write failing provisioning-boundary tests**

```rust
#[tokio::test]
async fn teacher_import_cannot_target_sibling_group() {
    let f = ProvisioningFixture::new().await;
    let result = f.service.preview_csv(&f.german_a_teacher, &f.german_b, CSV).await;
    assert!(matches!(result, Err(AppError::Forbidden(_))));
}

#[tokio::test]
async fn api_key_plaintext_is_returned_once_and_hash_is_persisted() {
    let f = ApiKeyFixture::new().await;
    let created = f.service.create(&f.root_admin, &f.german, vec![Capability::AnalyticsView], None).await.unwrap();
    assert!(created.secret.starts_with("mlsk_"));
    assert!(!f.raw_database_contains(&created.secret).await);
}
```

- [ ] **Step 2: Run and confirm failure**

Run: `cargo test --manifest-path management/backend/Cargo.toml provisioning::tests`

Run: `cargo test --manifest-path management/backend/Cargo.toml api_keys::tests`

Expected: FAIL because both services are undefined.

- [ ] **Step 3: Implement validation and idempotent import**

Accept UTF-8 CSV columns `email,display_name,identity_type,group_slug`. Preview returns row-indexed errors without writes. Import uses an idempotency key and one transaction to create/update users, memberships, and audit events.

- [ ] **Step 4: Implement expiring invitations and join codes**

Store only token hashes. Acceptance verifies expiry, intended group, allowed identity type, and membership capability ceilings. Join codes never grant management capabilities.

- [ ] **Step 5: Implement scoped API keys**

Generate 32 random bytes with prefix `mlsk_`, hash with SHA-256, and return plaintext once. `authenticate` returns a service `Principal` bound to the key group and exact capabilities.

- [ ] **Step 6: Implement immutable audit queries**

Expose actor, action, target type/ID, authorized group, timestamp, request ID, and redacted metadata. Root and parent managers may query authorized descendant events; child managers cannot query parent/sibling events. Audit rows have no update/delete route.

- [ ] **Step 7: Verify all foundation acceptance cases**

Run: `cargo test --manifest-path management/backend/Cargo.toml`

Expected: PASS, including root bootstrap, compatible desktop exchange, refresh rotation, strict subtree visibility, delegation ceilings, provisioning scope, and key revocation.

- [ ] **Step 8: Commit**

```bash
git add management/backend
git commit -m "feat(management): add scoped user provisioning and api keys"
```
