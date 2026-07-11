# Policies Task 3 Report: Signed effective-policy endpoint

## Status

Implemented Ed25519 policy snapshot signing, persistent deployment key lifecycle, `GET /api/policy/me`, and `GET /api/policy/public-key`.

## TDD evidence

### RED: signing tamper behavior

Added `signature_fails_after_managed_value_is_changed` before `PolicySigner` existed.

Command:

```bash
cargo test --manifest-path management/backend/Cargo.toml policy::signing::tests
```

Observed failure: `unresolved import super::PolicySigner`.

### GREEN: signing

Added deterministic recursive-key canonical JSON, Ed25519 signing, base64url signature/public-key encoding, and key IDs derived from the public key. The focused signing test passed 1/1 and proves a managed setting mutation invalidates the signature.

### RED: endpoint and authorization semantics

Added route tests for signed active-group policy retrieval, unauthenticated public-key retrieval, removed membership, archived active group, and service-key rejection.

Command:

```bash
cargo test --manifest-path management/backend/Cargo.toml routes::policies::tests
```

Observed failure: all five new requests returned `404` before the routes existed.

### GREEN: endpoints

`/api/policy/me` now:

- accepts authenticated human sessions only;
- uses the session's live `active_group_id`;
- checks a live, direct active membership and active group in the same database transaction used to compile the policy;
- sets RFC 3339 issuance and expiry timestamps with a maximum 15-minute lifetime;
- returns the direct `PolicyDocument` wire shape signed by the deployment key.

`/api/policy/public-key` returns only `{ keyId, algorithm: "Ed25519", publicKey }`. The existing `/api/groups/{group_id}/policy/effective` management inspection route remains unsigned and retains service-key read behavior.

## Key lifecycle and protection

- `MLEARN_POLICY_SIGNING_KEY_PATH` configures the key location.
- Release default: `/data/policy-signing-key`.
- Existing keys are loaded; absent keys are generated once and atomically linked into place.
- Unix key permissions are created and enforced as `0600`.
- Symlink key paths are rejected.
- The 32-byte private key is held only inside `PolicySigner`; it has no serialization or API surface and is never logged.
- Production startup uses fallible `AppState::try_new`, so key initialization failures stop startup instead of silently rotating identity.

## Verification

```bash
cargo test --manifest-path management/backend/Cargo.toml policy::signing::tests
# 1 passed

cargo test --manifest-path management/backend/Cargo.toml routes::policies::tests
# 8 passed

cargo test --manifest-path management/backend/Cargo.toml
# 145 library tests passed; 5 binary tests passed; 0 failed

git diff --check
# passed
```

## Self-review

- Confirmed no private-key field is present in the public response.
- Confirmed membership removal and group archival take effect without refreshing the access token.
- Confirmed service keys remain allowed on the unsigned management inspection route but are rejected by `/api/policy/me`.
- Removed formatter-only changes outside the task.
- Moved binary-test signing keys to unique temporary paths and delete them after state initialization, avoiding repository artifacts.

## Concern for the later app-verification task

The verifier must reproduce the signer contract exactly: remove the top-level `signature` field, recursively sort JSON object keys, emit compact JSON scalars, and verify those UTF-8 bytes. App verification was intentionally not added in this task.

---

## Review findings remediation

All findings from `policies-task-3-review-findings.md` were implemented while preserving the explicit exclusions: live membership checks, service-principal rejection, bounded expiry, key secrecy, and startup failure remain intact; full app policy caching/enforcement was not added.

### RED: shared RFC 8785 contract

Added `test/fixtures/policy-jcs-vectors.json` before replacing either serializer. The shared vectors cover:

- nested objects supplied out of canonical order;
- BMP and astral Unicode keys and string values, including UTF-16 key ordering;
- positive and negative JavaScript-safe integers;
- negative zero, decimals, `1e-6`/`1e-7` and `1e20`/`1e21` exponent thresholds;
- nulls, booleans, and nested arrays;
- every signed policy snapshot field, with only the top-level `signature` excluded from canonical bytes.

Rust RED command:

```bash
cargo test --manifest-path management/backend/Cargo.toml policy::signing::tests
```

Observed: 7 passed and 2 failed. The custom serializer sorted astral and private-use BMP keys in Unicode scalar order instead of RFC 8785 UTF-16 order. The non-regular path test also showed that the old path-based permission update changed a directory from `0755` to `0600` before rejecting it.

TypeScript RED command:

```bash
npx vitest run --project node src/shared/managementPolicy.test.ts
```

Observed: the new vector test failed because plain `JSON.stringify` preserved the nested input object's insertion order.

Endpoint RED command:

```bash
cargo test --manifest-path management/backend/Cargo.toml routes::policies::tests::current_session_receives_a_signed_policy_for_its_active_group
```

Observed: a signed snapshot containing the `1e20` exponent-threshold value failed Ed25519 verification when verified with only `/api/policy/public-key` and RFC 8785 bytes.

### GREEN: standards-based canonical bytes

- Rust now uses `serde_json_canonicalizer` 0.3.2.
- TypeScript now uses `json-canonicalize` 2.0.0 through `canonicalizePolicyJson`.
- Both runtimes verify the same shared fixture bytes.
- The endpoint test retrieves the public key independently, asserts matching key IDs, removes only `signature`, canonicalizes with JCS, and verifies the returned Ed25519 signature without signer-private test helpers.

### GREEN: descriptor-safe key lifecycle

- Unix existing-key opens use `O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK`.
- File type is checked from the opened descriptor before any permission mutation or read.
- `0600` is applied and checked through that same descriptor, including special mode bits.
- The same descriptor is used to read exactly 32 private-key bytes.
- Non-Unix builds retain a pre-open symlink rejection and validate regular-file status from the opened handle.
- Regression coverage includes symlinks, non-regular paths without mode mutation, newly created and repaired `0600` modes, persistence/reload, concurrent creation convergence, malformed-key startup failure without rotation, and key secrecy at the public endpoint.

### GREEN: expanded tamper coverage

Independent tests reject signature reuse after changing a managed value, active group ID, expiry, or key ID. Existing tests continue to reject archived groups, removed memberships, and service principals.

## Review verification evidence

Focused verification:

```bash
cargo test --manifest-path management/backend/Cargo.toml policy::signing::tests
# 12 passed; 0 failed

cargo test --manifest-path management/backend/Cargo.toml routes::policies::tests
# 8 passed; 0 failed

cargo test --manifest-path management/backend/Cargo.toml state::tests
# 1 passed; 0 failed

npx vitest run --project node src/shared/managementPolicy.test.ts
# 1 file passed; 7 tests passed

npm run typecheck
# passed
```

Full verification:

```bash
cargo test --manifest-path management/backend/Cargo.toml
# 157 library tests and 5 binary tests passed; 0 failed

npm run test
# 231 files and 4,826 tests passed; 0 failed

npm run typecheck
# passed

git diff --check
# passed
```

The earlier custom-canonicalization concern is superseded: the cross-runtime contract is now RFC 8785/JCS, pinned by shared fixtures and dedicated libraries. Full app verification, caching, and enforcement remain intentionally deferred.

Verification note: one post-hardening full TypeScript run transiently failed the unrelated zero-delay assertion `FlashcardContext.test.ts > answerCard recalculates explicit non-active language stats with that language primary form` (`0` observed instead of `6`). It failed once in isolation, passed on the immediate isolated rerun without source changes, and the subsequent full `npm run test` passed all 4,826 tests. No flashcard code or test was changed in this policy task.

---

## Re-review: I-JSON numeric policy boundary

The remaining high-severity cross-runtime boundary was fixed without changing the RFC 8785/JCS contract, key lifecycle, authorization behavior, or the app caching/enforcement exclusion.

### RED

Registry boundary:

```bash
cargo test --manifest-path management/backend/Cargo.toml policy::registry::tests::registry_rejects_integer_settings_outside_javascript_safe_range
```

Observed failure: `9007199254740992 must be rejected`; the registry accepted all JSON numbers based only on JSON type.

Publication recheck:

```bash
cargo test --manifest-path management/backend/Cargo.toml policy::compiler::tests::publish_rejects_unsafe_integer_even_when_stored_hash_matches
```

Observed failure: publication succeeded for a legacy-style stored draft containing `9007199254740992` even when its stored canonical hash matched, proving the publish recheck did not enforce the cross-runtime numeric boundary.

TypeScript wire boundary:

```bash
npx vitest run --project node src/shared/managementPolicy.test.ts -t "rejects unsafe integer settings while preserving finite fractions"
```

Observed failure: the effective-policy validator accepted the rounded JavaScript value because it required only a finite number.

### GREEN

- Rust `validate_setting_rule` now accepts numeric settings only when finite and either fractional or within `-9007199254740991..=9007199254740991` when integer-valued.
- Exact Rust JSON integers `9007199254740992`, `9007199254740993`, `-9007199254740992`, and `-9007199254740993` are rejected before draft persistence/publication/signing.
- The same registry validation is re-run during publication, so a hash-consistent legacy stored draft cannot bypass the boundary.
- TypeScript mirrors the rule with `Number.isFinite` plus `Number.isSafeInteger` for integer-valued settings, rejecting values after JavaScript parsing/rounding as well.
- Safe boundary integers and supported finite fractions such as `20.5` and `1e-7` remain accepted.
- Quota validation remains independently constrained to non-negative JavaScript-safe integers.
- `/api/policy/me` now exercises an accepted `1e-7` numeric setting and still verifies using only the public-key endpoint, the returned signature, and RFC 8785 canonical bytes.

### Verification

```bash
cargo test --manifest-path management/backend/Cargo.toml policy::registry::tests
# 6 passed; 0 failed

cargo test --manifest-path management/backend/Cargo.toml policy::compiler::tests
# 10 passed; 0 failed

cargo test --manifest-path management/backend/Cargo.toml routes::policies::tests
# 8 passed; 0 failed

npx vitest run --project node src/shared/managementPolicy.test.ts
# 1 file and 8 tests passed

cargo test --manifest-path management/backend/Cargo.toml
# 159 library tests and 5 binary tests passed; 0 failed

npm run test
# 231 files and 4,827 tests passed; 0 failed

npm run typecheck
# passed

git diff --check
# passed
```

---

## Final re-review: legacy active-version signing boundary

The accepted policy setting domain is now enforced at the last possible trust boundary, so active policy versions created before current validation cannot produce signed snapshots that JavaScript would parse differently.

### RED

Direct signer:

```bash
cargo test --manifest-path management/backend/Cargo.toml policy::signing::tests::signer_rejects_legacy_unsafe_integer_setting
```

Observed failure: `PolicySigner::sign_snapshot` returned `Ok` for a compiled `subtitle_font_size` value of exact Rust integer `9007199254740992`.

Legacy active endpoint:

```bash
cargo test --manifest-path management/backend/Cargo.toml routes::policies::tests::legacy_active_policy_with_unsafe_integer_cannot_be_signed
```

Observed failure: `/api/policy/me` returned `200` and issued a signature for a directly stored, active legacy version containing `9007199254740992`.

### GREEN

- `PolicySigner::sign_snapshot` now revalidates every compiled setting key/value with `validate_setting_rule` before assigning a key ID, canonicalizing, or signing.
- Invalid legacy data fails closed as an internal server error that identifies only the setting key and validator error, never the setting value or private key.
- `/api/policy/me` therefore returns no policy signature for a legacy active version outside the accepted domain.
- A direct signer regression proves finite fractional `20.5` still signs and verifies.
- The existing endpoint regression continues to sign and publicly verify accepted `1e-7` through RFC 8785/JCS.
- Unsigned management inspection, live membership, service-principal rejection, bounded expiry, descriptor-safe keys, and app caching/enforcement exclusions remain unchanged.

### Verification

```bash
cargo test --manifest-path management/backend/Cargo.toml policy::signing::tests
# 14 passed; 0 failed

cargo test --manifest-path management/backend/Cargo.toml routes::policies::tests
# 9 passed; 0 failed

npx vitest run --project node src/shared/managementPolicy.test.ts
# 1 file and 8 tests passed

cargo test --manifest-path management/backend/Cargo.toml
# 162 library tests and 5 binary tests passed; 0 failed

npm run test
# 231 files and 4,827 tests passed; 0 failed

npm run typecheck
# passed

git diff --check
# passed
```
