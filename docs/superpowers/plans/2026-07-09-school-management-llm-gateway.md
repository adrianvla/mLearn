# School Management LLM Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement an OpenAI-compatible streaming gateway that enforces group policy, atomically caps LLM spend, and stores permission-scoped learner conversations.

**Architecture:** Provider configuration and price versions are encrypted/persistent. Before upstream contact, the gateway resolves the signed-equivalent server policy and creates one transactional quota reservation across the learner, active group, and ancestors. Streaming is proxied without full-response buffering while a bounded recorder captures content and usage for encrypted conversation storage.

**Tech Stack:** Rust/Axum, Reqwest rustls streaming, SQLx SQLite, AES-256-GCM, SSE, Serde.

## Global Constraints

- Preserve the request body and SSE response forms consumed by `CloudLLMAdapter`.
- Never log provider credentials, bearer tokens, prompts, responses, or decrypted secrets operationally.
- Reject over-budget requests before provider contact.
- Charge usage to learner and every ancestor group using one atomic reservation transaction.
- Store the provider price-version ID on every reconciled usage entry.
- Apply `conversations.view` and subtree authorization to every conversation query/export.
- Provider/model/language decisions come from effective group policy, never language-code branches.

---

### Task 1: Encrypted provider, model, prompt, and price configuration

**Files:**
- Modify: `management/backend/Cargo.toml`
- Modify: `management/backend/src/config.rs`
- Modify: `management/backend/src/state.rs`
- Create: `management/backend/migrations/0005_llm_configuration.sql`
- Create: `management/backend/src/crypto.rs`
- Create: `management/backend/src/llm/mod.rs`
- Create: `management/backend/src/llm/configuration.rs`
- Create: `management/backend/src/routes/llm_configuration.rs`
- Test: `management/backend/src/crypto.rs`
- Test: `management/backend/src/llm/configuration.rs`

**Interfaces:**
- Produces: `SecretCipher::{encrypt, decrypt}`.
- Produces: `LlmConfigurationService::{create_provider, update_provider_secret, create_price_version, resolve_route}`.
- Produces: `ResolvedLlmRoute { provider_id, provider_kind, base_url, secret, model, prompt_profile_id, price_version }`.

- [ ] **Step 1: Write failing authenticated-encryption tests**

```rust
#[test]
fn ciphertext_round_trips_and_tampering_fails() {
    let cipher = SecretCipher::from_key([7_u8; 32]);
    let encrypted = cipher.encrypt(b"provider-key", b"provider:openai").unwrap();
    assert_ne!(encrypted.ciphertext, b"provider-key");
    assert_eq!(cipher.decrypt(&encrypted, b"provider:openai").unwrap(), b"provider-key");
    assert!(cipher.decrypt(&encrypted, b"provider:other").is_err());
}
```

- [ ] **Step 2: Run and confirm failure**

Run: `cargo test --manifest-path management/backend/Cargo.toml crypto::tests`

Run: `cargo test --manifest-path management/backend/Cargo.toml llm::configuration::tests`

- [ ] **Step 3: Add encryption and schema**

Add `aes-gcm = "0.10"`, `secrecy = "0.10"`, `reqwest = { version = "0.12", default-features = false, features = ["json", "stream", "rustls-tls"] }`, and `async-stream = "0.3"`. Load a 32-byte key from `MLEARN_ENCRYPTION_KEY` or `/data/encryption-key`; generate mode `0600` on first production start.

Create `llm_providers`, `llm_models`, `prompt_profiles`, and append-only `provider_price_versions`. API DTOs expose `has_secret`, never ciphertext or plaintext.

- [ ] **Step 4: Implement provider configuration routes**

Add permission-scoped CRUD under `/api/llm/providers`, `/api/llm/models`, `/api/llm/prices`, and `/api/llm/prompt-profiles`. Require `llm.configure` at the selected group. Provider health checks decrypt only inside the request scope.

- [ ] **Step 5: Run focused tests**

Expected: encryption round-trip passes, associated-data mismatch fails, old price versions remain immutable, sibling configuration access returns `403`.

- [ ] **Step 6: Commit**

```bash
git add management/backend
git commit -m "feat(management): add encrypted llm configuration"
```

### Task 2: Hierarchical quota definitions and atomic reservations

**Files:**
- Create: `management/backend/migrations/0006_llm_quotas.sql`
- Create: `management/backend/src/llm/quota.rs`
- Create: `management/backend/src/routes/quotas.rs`
- Modify: `management/backend/src/main.rs`
- Test: `management/backend/src/llm/quota.rs`

**Interfaces:**
- Produces: `QuotaMetric::{Requests, InputTokens, OutputTokens, TotalTokens, CostMicros}`.
- Produces: `QuotaService::{reserve, reconcile, release_expired, usage_summary}`.
- Produces: `QuotaReservation { id, request_id, reserved_by_scope }`.

- [ ] **Step 1: Write failing concurrent reservation test**

```rust
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_requests_cannot_overspend_parent_cost_cap() {
    let f = QuotaFixture::with_monthly_cost_cap(1_000_000).await;
    let attempts = (0..10).map(|_| f.service.reserve(f.request(200_000)));
    let results = futures_util::future::join_all(attempts).await;
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 5);
    assert_eq!(f.total_reserved_cost().await, 1_000_000);
}
```

- [ ] **Step 2: Run and confirm failure**

Run: `cargo test --manifest-path management/backend/Cargo.toml llm::quota::tests::concurrent_requests_cannot_overspend_parent_cost_cap`

- [ ] **Step 3: Create quota and ledger schema**

Create `quota_definitions`, `quota_reservations`, `quota_reservation_scopes`, and append-only `usage_ledger`. Store monetary amounts as integer micros and periods as explicit `[starts_at, ends_at)` UTC bounds derived from school timezone/term configuration.

- [ ] **Step 4: Implement `BEGIN IMMEDIATE` reservation flow**

Inside one transaction:

1. load active user/group policy limits;
2. recursively load ancestors;
3. sum reconciled usage plus open reservations for each applicable scope/metric;
4. reject if any hard cap would be crossed;
5. insert the reservation and one scope row per charged user/group/ancestor.

Reconciliation inserts measured usage with the price-version ID and releases the reservation idempotently. Abandoned reservations expire by deadline during later reservation/summary transactions, not a polling timer.

- [ ] **Step 5: Implement quota CRUD and summary routes**

Expose inherited definitions, remaining allowance, warnings, and learner/group/provider/model breakdowns. Child limits may only tighten an ancestor maximum.

- [ ] **Step 6: Run concurrency and policy-limit tests**

Expected: no overspend under concurrent tasks; child allocation never enlarges parent budget; reconciliation is idempotent.

- [ ] **Step 7: Commit**

```bash
git add management/backend
git commit -m "feat(management): enforce hierarchical llm quotas"
```

### Task 3: Provider adapters and compatible SSE proxy

**Files:**
- Create: `management/backend/src/llm/provider.rs`
- Create: `management/backend/src/llm/openai.rs`
- Create: `management/backend/src/llm/ollama.rs`
- Replace: `management/backend/src/routes/llm_gateway.rs`
- Modify: `management/backend/src/main.rs`
- Test: `management/backend/src/llm/openai.rs`
- Test: `management/backend/src/routes/llm_gateway.rs`

**Interfaces:**
- Produces: `LlmProviderAdapter::stream(request) -> ProviderStream`.
- Produces: `POST /api/llm/stream` compatible with `CloudLLMAdapter.streamChat`.

- [ ] **Step 1: Write failing compatibility test**

```rust
#[tokio::test]
async fn stream_preserves_openai_delta_and_done_frames() {
    let upstream = MockProvider::frames(vec![
        r#"{"choices":[{"delta":{"content":"Hallo"}}]}"#,
        "[DONE]",
    ]);
    let response = test_app(upstream).post_json("/api/llm/stream", json!({
        "messages": [{"role":"user","content":"Hi"}],
        "model_tier": "balanced",
        "think": false
    })).await;
    assert_eq!(response.status(), 200);
    assert_eq!(response.text().await, "data: {\"choices\":[{\"delta\":{\"content\":\"Hallo\"}}]}\n\ndata: [DONE]\n\n");
}
```

- [ ] **Step 2: Run and confirm failure**

Run: `cargo test --manifest-path management/backend/Cargo.toml routes::llm_gateway::tests`

- [ ] **Step 3: Implement normalized provider requests**

Accept existing fields `messages`, optional `tools`, `model_tier`, and `think`. Resolve the provider/model/prompt from effective policy rather than trusting a client model. Support OpenAI-compatible and Ollama streaming behind one adapter trait.

- [ ] **Step 4: Reserve before upstream contact and stream with backpressure**

Authenticate principal and active group, reserve quota, then open upstream. Forward comment/data frames in the response format parsed by `CloudLLMAdapter`. Abort upstream on client disconnect. Never concatenate the entire response in memory.

- [ ] **Step 5: Return compatible failures**

Use JSON status responses before stream start and `data: {"error":"...","done":true}` if failure occurs after headers. Cover `policy_denied`, `quota_exceeded`, `rate_limited`, `provider_unavailable`, and `invalid_active_group`.

- [ ] **Step 6: Run backend tests plus the existing adapter tests**

Run: `cargo test --manifest-path management/backend/Cargo.toml routes::llm_gateway::tests`

Run: `npx vitest run --project node src/shared/backends/cloudLLMAdapter.test.ts`

Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add management/backend
git commit -m "feat(management): proxy compatible llm streams"
```

### Task 4: Encrypted conversations and usage reconciliation

**Files:**
- Create: `management/backend/migrations/0007_conversations.sql`
- Create: `management/backend/src/llm/conversations.rs`
- Create: `management/backend/src/routes/conversations.rs`
- Modify: `management/backend/src/routes/llm_gateway.rs`
- Test: `management/backend/src/llm/conversations.rs`
- Test: `management/backend/src/routes/conversations.rs`

**Interfaces:**
- Produces: `ConversationRecorder::{begin, record_request, record_delta, finish, fail}`.
- Produces cursor-paginated `/api/conversations` and `/api/conversations/{id}`.

- [ ] **Step 1: Write failing encryption and sibling-isolation tests**

```rust
#[tokio::test]
async fn sibling_teacher_cannot_read_conversation_and_database_has_no_plaintext() {
    let f = ConversationFixture::new().await;
    let id = f.record_for_german_a("private learner prompt").await;
    assert!(!f.database_bytes().contains("private learner prompt"));
    assert!(f.service.get(&f.german_b_teacher, &id).await.is_err());
    assert_eq!(f.service.get(&f.german_a_teacher, &id).await.unwrap().messages[0].content, "private learner prompt");
}
```

- [ ] **Step 2: Run and confirm failure**

Run: `cargo test --manifest-path management/backend/Cargo.toml llm::conversations::tests`

Run: `cargo test --manifest-path management/backend/Cargo.toml routes::conversations::tests`

- [ ] **Step 3: Implement bounded streaming recorder**

Create `conversations`, `llm_requests`, and `conversation_messages`. Encrypt each message with associated data containing conversation/request/message IDs. Buffer deltas only up to the configured maximum message size; mark truncation explicitly.

- [ ] **Step 4: Reconcile provider usage**

Parse usage frames where available. Otherwise estimate via the configured tokenizer/pricing strategy, mark the record `estimated`, reconcile quota, and store input/output tokens, cost micros, latency, provider, model, price version, policy version, and error code.

- [ ] **Step 5: Implement permission-scoped search and retention**

Filters: group subtree, learner, model, provider, date range, status, policy block. Retention deletion runs opportunistically during writes/admin maintenance and removes expired encrypted content while preserving configured aggregate/accounting fields.

- [ ] **Step 6: Run conversation, quota, and gateway suites**

Expected: encrypted contents are absent from database/log bytes; authorized parent can read descendants; siblings cannot; quota usage matches request records.

- [ ] **Step 7: Commit**

```bash
git add management/backend
git commit -m "feat(management): store governed llm conversations"
```

### Task 5: Gateway integration and security verification

**Files:**
- Modify: `management/backend/src/redaction.rs`
- Modify: `management/backend/src/sanitize.rs`
- Create: `management/backend/tests/llm_gateway_e2e.rs`
- Modify: `management/README.md`
- Modify: `management/.env.example`

**Interfaces:**
- Verifies all gateway interfaces from Tasks 1-4.

- [ ] **Step 1: Add an end-to-end failing scenario**

Test root and child caps, two learners, concurrent streams, a provider failure, a completed conversation, sibling-teacher denial, and root-admin rollup in one temporary database with a mock upstream server.

- [ ] **Step 2: Run and confirm the scenario exposes remaining gaps**

Run: `cargo test --manifest-path management/backend/Cargo.toml --test llm_gateway_e2e`

- [ ] **Step 3: Close only the concrete failures**

Keep fixes scoped to redaction, cancellation, reservation expiry/reconciliation, and route authorization found by the test. Add regression assertions for every fix.

- [ ] **Step 4: Document deployment configuration**

Document `MLEARN_ENCRYPTION_KEY`, generated key paths, provider setup, quota units, price versions, retention, backup requirements, and the compatible `/api/llm/stream` endpoint without printing example secrets.

- [ ] **Step 5: Run final gateway verification and commit**

Run: `cargo test --manifest-path management/backend/Cargo.toml`

Run: `npx vitest run --project node src/shared/backends/cloudLLMAdapter.test.ts`

```bash
git add management/backend management/README.md management/.env.example
git commit -m "test(management): verify governed llm gateway"
```
