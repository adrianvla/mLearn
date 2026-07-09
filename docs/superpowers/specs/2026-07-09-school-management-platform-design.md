# School Management Platform Design

**Date:** 2026-07-09

**Status:** Approved design

**Scope:** `management/` plus the smallest required integrations in the main mLearn frontend

## 1. Purpose

Turn `management/` into the self-hosted control plane for a school deployment of mLearn. It must provide:

- managed administrator, teacher, and learner accounts;
- hierarchical groups with downward-only permissions;
- inherited policies and locked app settings;
- school, group, and learner analytics;
- an authenticated, policy-aware LLM gateway;
- searchable learner LLM conversation logs;
- a polished HeroUI administration console;
- compatible endpoints so the main app can switch from the public mLearn services by changing its login and API URLs.

This is not a generic Docker dashboard. Infrastructure health remains available to administrators, but the product hierarchy is people, groups, policy, learning activity, and AI governance.

## 2. Product Principles

1. **Management is the school control plane.** Identity, permissions, policies, analytics, LLM routing, quotas, and audit history are canonical in `management/`.
2. **The main app remains a learning client.** It reuses its existing cloud-login and cloud-API seams. Its only substantial new responsibilities are active-group selection, policy enforcement, managed-setting presentation, and frontend activity reporting.
3. **Groups are the universal scope.** Classes, departments, subjects, cohorts, and project teams are all groups in one strict tree.
4. **Authority flows downward; analytics roll upward.** A capability at a group applies to that group and descendants. Child data contributes to ancestor analytics, but child membership never reveals ancestors or siblings.
5. **Policy is explicit and versioned.** Drafts do not affect clients. Published policies are immutable versions with auditable authorship.
6. **No duplicate activity instrumentation.** The existing `app.user.activity` model becomes the basis of a platform-neutral frontend activity hub used by both plugins and management analytics.
7. **School cost exposure is enforceable.** LLM quotas are checked atomically before provider requests, not merely reported after billing.

## 3. System Boundary

### 3.1 Management service

`management/` ships as one deployable service containing:

- the Rust/Axum API;
- the embedded React 19 + HeroUI administration console;
- SQLite persistence in the management data volume;
- local account authentication and token issuance;
- policy compilation and delivery;
- analytics and audit ingestion;
- LLM provider adapters and SSE-compatible streaming;
- encrypted provider configuration and conversation storage.

### 3.2 Main app integration

The app already exposes the intended replacement seam:

- `settings.cloudLoginUrl` replaces `https://mlearn.kikan.net`;
- `settings.cloudApiUrl` replaces `https://mlearn-cloud.kikan.net`;
- `settings.overrideCloudEndpointUrl` activates both overrides;
- `CloudLLMAdapter` already sends streaming requests to the resolved cloud API URL.

The management service implements compatible authentication and cloud API routes so existing login, refresh-token, and LLM code remains in place. New app code is limited to:

- active-group selection;
- effective-policy retrieval and verification;
- enforcement at the existing `SettingsContext` update boundary;
- managed-setting indicators and disabled controls;
- a frontend-only activity hub and analytics delivery adapter.

No new Electron-only analytics service or native Capacitor bridge is introduced.

## 4. Identity and Authentication

### 4.1 Account types

Every person has a managed school account with one identity type:

- `admin`
- `teacher`
- `learner`

Identity type is descriptive and controls safe baseline behavior. Actual data access comes from group memberships and their capabilities.

### 4.2 Provisioning

There is no public self-signup. Admins and authorized teachers can provision accounts through:

- individual creation;
- CSV import with validation and a dry-run summary;
- expiring invitation links;
- group join codes where policy permits them.

Learner invitations always place the learner into an allowed group. A teacher may only provision or invite people into a group they can manage or one of its descendants.

### 4.3 Sessions

The service implements the existing desktop/browser authentication exchange shape expected by `cloudAuthService`, including access and refresh tokens. Sessions are:

- stored as hashed or otherwise non-recoverable server-side credentials;
- individually revocable;
- associated with user, device, and last active group;
- rotated on refresh;
- invalidated immediately after account suspension or relevant membership revocation.

Password hashes use a memory-hard algorithm. Login, reset, invitation, and refresh endpoints are rate-limited and audited.

The existing `MLEARN_MANAGEMENT_TOKEN` becomes a bootstrap and emergency-recovery credential rather than the normal console session. On a new deployment it authorizes creation of the first root administrator. After bootstrap, human access uses named accounts; use of the recovery credential is prominently reported and audited.

### 4.4 API keys

Administrators may create scoped API keys for integrations and non-interactive clients. Each key:

- belongs to one group;
- has explicit capabilities;
- operates only on that group and descendants;
- is shown in plaintext once and stored as a hash;
- supports expiry, rotation, and immediate revocation;
- cannot grant or exercise capabilities above its group.

## 5. Hierarchical Groups and Authorization

### 5.1 Group tree

Groups form a strict tree. Every group has exactly one parent except the school root.

Example:

```text
School
└── German
    ├── German A
    │   ├── Project Group 1
    │   └── Project Group 2
    └── German B
```

Multiple parents are forbidden. This keeps inheritance, visibility, quota accounting, and analytics aggregation deterministic.

### 5.2 Memberships and capabilities

A membership attaches a user to a group with an explicit capability set. Initial capabilities include:

- `group.view`
- `group.manage`
- `members.view`
- `members.manage`
- `permissions.delegate`
- `policies.view`
- `policies.edit`
- `policies.publish`
- `analytics.view`
- `conversations.view`
- `conversations.export`
- `llm.configure`
- `api_keys.manage`

A capability granted at a group applies to that group and descendants. It never grants visibility into ancestors or siblings.

Identity type alone grants no group data. A teacher without a membership sees no classes, and a learner without a membership cannot select an active learning group.

### 5.3 Delegation safety

A user with member-management and delegation capabilities may invite another person to the current group or a descendant, subject to all of these rules:

- the inviter can see and manage the target group;
- the inviter cannot grant a capability they do not hold at the target group;
- the invitation cannot target an ancestor or sibling outside the inviter's authorized subtree;
- changes that would leave a group without a manager are rejected;
- every grant, removal, invitation, and acceptance is audited.

For example, teachers managing `German A` may invite another teacher into `German A` or `Project Group 1`. They cannot inspect or join the parent `German` group unless a parent manager explicitly grants access.

### 5.4 Active group

A learner or teacher may belong to multiple branches. The main app therefore has an active-group context:

- users with one eligible learning group enter it automatically;
- users with multiple eligible groups select one after login;
- the selection is available from the account menu;
- LLM requests, activity events, effective policy, and analytics are associated with that active group;
- switching groups refreshes policy before group-scoped network features resume.

## 6. Policy Model

### 6.1 Group-owned policies

Policies attach only to groups. There are no hidden user-specific policy exceptions. A one-off exception is represented by a child group containing the affected users.

Each group may have:

- one editable draft;
- zero or more immutable published versions;
- one active published version.

Publishing records author, timestamp, change summary, parent policy versions, and compiled policy hash.

### 6.2 Inheritance

Effective policy is compiled from the school root down to the active group.

- Child values may specialize inherited defaults where the parent allows overrides.
- Parent hard-deny and maximum-limit constraints cannot be weakened by descendants.
- Conflicting policies cannot occur through multiple ancestry paths because groups form a strict tree.
- Compilation produces a normalized snapshot with provenance for every effective rule.

The console explains whether a value is local, inherited, or constrained by an ancestor.

### 6.3 Policy capabilities

A policy can:

- enforce a supported app setting value;
- lock a setting while keeping it visible;
- hide or disable a feature;
- configure the group's target language and language profile;
- restrict content sources;
- allow or deny local and remote AI providers;
- allow specific LLM providers and models;
- choose an inherited or group-specific prompt profile;
- impose rate limits and LLM quotas;
- set activity and conversation retention constraints;
- control whether teachers can export analytics or conversations.

Settings are addressed by validated keys from a server-supported policy registry. The app never executes arbitrary policy code or arbitrary CSS.

### 6.4 App enforcement

After login and active-group selection, the app fetches `/api/policy/me`. The response contains:

- active group and ancestry identifiers;
- compiled effective policy;
- policy version and hash;
- provenance for managed settings;
- expiry/revalidation metadata;
- a deployment signature.

The app verifies the snapshot with the deployment public key obtained during the authenticated enrollment flow and caches the last valid snapshot. Enforcement occurs at `SettingsContext`, so every settings mutation path—including cross-window synchronization—passes through the same rule boundary.

Managed controls remain visible and disabled with a `Managed by your school` explanation and source group. If stale local data or another window attempts to change an enforced value, reconciliation restores the policy value.

If management is unavailable, the app uses the last valid snapshot. Local learning remains available, locked settings remain enforced, and network-controlled features fail closed when no valid policy authorizes them.

## 7. LLM Gateway and Quotas

### 7.1 Compatibility

Management implements the existing `/api/llm/stream` SSE contract used by `CloudLLMAdapter`. The request token identifies the user, device, and active group. No parallel school-specific LLM client is added to the app.

### 7.2 Request resolution

For every request, the gateway resolves:

- account and session status;
- active-group membership;
- effective policy version;
- allowed provider and model;
- language and prompt profile;
- rate limits;
- user, group, and ancestor quota availability.

Only then does the gateway contact the configured provider. Responses stream through without waiting for full completion.

### 7.3 Hierarchical quotas

Policies may define soft warnings and hard caps using any combination of:

- request count;
- input tokens;
- output tokens;
- total tokens;
- estimated or reconciled monetary cost;
- requests per minute and concurrent requests.

Quota periods support daily, weekly, monthly, and explicitly configured school terms. Resets use the school's configured timezone.

Usage is charged to the learner and active group, then rolled up through every ancestor. A child allocation can be smaller than an ancestor cap but can never increase the ancestor's available budget.

To prevent concurrent requests from overspending:

1. the gateway calculates a conservative reservation;
2. it atomically verifies and reserves capacity across user, group, and ancestor counters;
3. it rejects the request before provider contact if any hard cap would be exceeded;
4. it reconciles the reservation against actual provider usage after completion;
5. it releases unused reservation or records the measured overage caused by provider reporting variance.

Provider pricing is versioned. Each usage record stores the price snapshot used for cost calculation so historical analytics do not change when pricing is edited.

### 7.4 Conversation logs

The gateway records:

- conversation and request identifiers;
- learner, device, active group, and ancestry snapshot;
- provider and model;
- policy and prompt-profile versions;
- timestamps and latency;
- token counts and reconciled cost;
- policy blocks and provider errors;
- prompt and response content according to the configured retention policy.

Conversation contents and provider secrets are encrypted at rest. Secret redaction runs before operational logs are written. Teachers may view conversations only for groups where they hold `conversations.view`; parent managers receive descendant data through normal subtree access.

### 7.5 Failure contract

Policy denial, exhausted budget, rate limiting, unavailable providers, invalid group context, and upstream failures return structured errors compatible with the existing streaming client. Every failure creates an auditable gateway event without leaking provider secrets.

## 8. Frontend Activity and Analytics

### 8.1 Canonical activity source

The current plugin API already models live activity through `AppActivity` and `app.user.activity`, including reader, video, flashcard, and idle states. This becomes the base contract rather than adding separate analytics calls to each screen.

A new platform-neutral `ActivityHub` lives in the frontend. Reader, video, flashcard, and future activity publishers send typed state to this hub once.

### 8.2 Subscribers

Two adapters subscribe to the hub:

1. `ManagementAnalyticsAdapter` sessionizes, queues, and uploads durable events.
2. `ElectronPluginActivityAdapter` mirrors current live state into the existing Electron plugin bus so the Discord activity plugin remains compatible.

Capacitor and browser builds use the same activity hub and analytics adapter. The Electron plugin adapter becomes a no-op where the plugin bridge is unavailable.

### 8.3 Sessionization

The activity hub converts changing live state into bounded events:

- `activity.started`
- `activity.progressed`
- `activity.completed`
- `activity.stopped`

It suppresses structural no-ops and coalesces frequent progress updates. Events include:

- stable activity session ID;
- authenticated user and device context supplied by the server session;
- active group;
- activity kind;
- stable content identifier where available;
- work title where policy permits collection;
- language profile;
- progress and completion state;
- client timestamp and monotonic sequence;
- policy version;
- privacy classification.

Raw document text, subtitle text, OCR output, and unrelated local settings are never included in activity telemetry.

### 8.4 Offline delivery

Events are stored in a bounded IndexedDB queue and uploaded in batches. Delivery is triggered by:

- event-count or byte thresholds;
- restoration of network connectivity;
- foreground/background transitions;
- clean shutdown where the platform provides an opportunity;
- successful authentication or token refresh.

There is no polling timer. Queue overflow follows an explicit oldest-first compaction policy and records a local dropped-event count for later reporting. Analytics delivery never blocks the learning UI.

### 8.5 Analytics model

Management stores accepted activity events and derives rollups by:

- learner;
- group and descendants;
- activity/content;
- language profile;
- day/week/month/term;
- LLM provider and model;
- request, token, cost, error, and policy-block totals.

Teachers can answer which learners watched or read which content, progress and completion, learning activity over time, LLM usage per student, and remaining quota. Parent managers receive sums from descendant groups. Permission checks are applied before every query and export.

## 9. Persistence

SQLite is stored in the management data volume. The initial logical schema includes:

- `users`, `password_credentials`, `invitations`;
- `sessions`, `refresh_tokens`, `api_keys`, `devices`;
- `groups`, `group_memberships`, `membership_capabilities`;
- `policy_drafts`, `policy_versions`, `active_policies`;
- `llm_providers`, `llm_models`, `provider_price_versions`;
- `quota_definitions`, `quota_reservations`, `usage_ledger`;
- `conversations`, `llm_requests`, `conversation_messages`;
- `activity_events`, `analytics_rollups`;
- `audit_events`;
- `deployment_settings`, `encryption_metadata`.

Foreign keys, uniqueness constraints, and recursive group-cycle prevention are enforced by both database constraints where possible and application validation. Migrations run transactionally and preserve forward-only version history.

Provider credentials and conversation contents use authenticated encryption with a deployment key supplied through configuration or generated into protected management storage. API responses never return recoverable secrets.

## 10. Administration Console

### 10.1 Visual direction

The console uses HeroUI well rather than presenting a collage of default components. The approved direction follows HeroUI's own polished dashboard examples:

- near-black application shell;
- continuous sidebar with restrained active navigation;
- charcoal data surfaces;
- crisp white hierarchy and muted secondary text;
- blue reserved for primary actions and charts;
- compact semantic status colors;
- dense but breathable charts and tables;
- minimal decorative treatment and no generic gradient-heavy admin aesthetic.

HeroUI supplies accessible cards, buttons, tabs, tables, inputs, dropdowns, dialogs, chips, tooltips, and overlays. Custom layout and composition establish the product identity.

### 10.2 Navigation

Primary navigation is:

- Dashboard
- Users
- Groups
- Policies
- Analytics
- Conversation Logs
- LLM Gateway
- Settings

Infrastructure/container diagnostics move into an administrator-only area under Settings instead of occupying primary navigation.

### 10.3 Group scope

The selected group is persistent and visible throughout the console. Navigation and queries respect that scope.

- Teachers see only explicitly granted groups and descendants.
- Root administrators can select school-wide and intermediate groups.
- Dashboards show descendant rollups where permitted.
- Policy screens distinguish inherited constraints from local values.
- User and conversation screens cannot search outside the authorized subtree.

### 10.4 Core screens

**Dashboard:** managed users, active learners, LLM requests, quota consumption, policy blocks, deployment health, group activity, and recent audit events.

**Users:** provisioning, CSV import, invitations, account state, sessions/devices, memberships, active policies, usage, and revocation.

**Groups:** tree management, membership delegation, capability editor, child creation, active language profile, and analytics summary.

**Policies:** inherited-value inspector, editable draft, validation, diff, publish confirmation, rollback by republishing an earlier snapshot, settings registry, feature controls, and quota rules.

**Analytics:** group tree filtering, learner activity, content progress, LLM usage and cost, quota projections, policy blocks, errors, and exports.

**Conversation Logs:** permission-scoped search, learner/group/model filters, conversation detail, usage/cost, policy provenance, export controls, and retention indicators.

**LLM Gateway:** provider health, model routing, encrypted credentials, price versions, prompt profiles, current quota reservations, and compatible API-key management.

**Settings:** school identity, timezone/term calendar, retention, security, deployment endpoints, diagnostics, container status, and backup guidance.

## 11. API Shape

Exact payloads are defined during implementation planning, but route families are fixed:

- `/api/auth/*` — compatible login, exchange, refresh, logout, current user, invitation, and reset flows;
- `/api/groups/*` — authorized tree, memberships, capabilities, invitations, and active-group selection;
- `/api/policies/*` — drafts, validation, publish, history, effective snapshots, and `/api/policy/me`;
- `/api/analytics/*` — ingestion, group rollups, learner detail, content activity, and exports;
- `/api/llm/stream` — compatible streaming gateway;
- `/api/llm/*` — providers, models, pricing, prompt profiles, usage, and quotas;
- `/api/conversations/*` — permission-scoped conversation search and detail;
- `/api/audit/*` — immutable administrative audit queries;
- `/api/settings/*` — deployment-wide management configuration;
- `/api/diagnostics/*` — administrator-only infrastructure health and container logs.

All list endpoints use stable cursor pagination. Mutation endpoints support idempotency keys where retries could duplicate effects. Responses use a consistent structured-error envelope, except the existing LLM SSE path where compatibility controls framing.

## 12. Security and Privacy

- Every API query is scoped server-side; hiding navigation is never treated as authorization.
- Recursive subtree checks are centralized and reused across users, analytics, conversations, and policy routes.
- Capability delegation enforces subset-of-authority rules.
- Policy compilation and quota charging are performed server-side.
- LLM content, provider secrets, session tokens, and API keys never appear in operational logs.
- Conversation access and export are themselves audited.
- Retention deletion removes expired conversation content and raw activity while preserving non-identifying aggregate/accounting records where configured.
- Account suspension, session revocation, group removal, and API-key revocation take effect on the next request.
- CSV import, names, titles, filters, and log output are validated and safely rendered.

## 13. Error Handling

- Database migrations are transactional. Startup fails clearly if a migration cannot complete.
- Policy drafts are validated before publication. Invalid settings, cycles, unsupported keys, and quota contradictions prevent publishing.
- Groups are archived rather than deleted in the initial release. Archiving blocks new activity and membership changes while preserving ancestry, policies, conversations, and analytics. A group with active children must have those children moved or archived first.
- Analytics ingestion is idempotent by event ID and tolerates reordered offline batches.
- Quota reservations expire safely after abandoned requests and reconcile idempotently.
- LLM provider failures do not expose credentials and do not consume unreconciled estimated cost.
- Frontend permission loss redirects to the nearest still-authorized group and clears inaccessible cached data.
- Stale effective-policy snapshots retain their last known restrictions until a valid replacement is available.

## 14. Verification Strategy

### 14.1 Backend

- migration tests from an empty and previous-version database;
- password, session, refresh, API-key, and revocation tests;
- recursive group authorization tests;
- property tests for downward permission propagation and no upward/sibling leakage;
- policy compilation, provenance, hard-limit, and versioning tests;
- concurrent quota reservation and reconciliation tests;
- provider adapter and SSE compatibility tests;
- analytics idempotency and rollup tests;
- conversation encryption, retention, and permission tests;
- route-level integration tests against a temporary SQLite database.

### 14.2 Main app

- `ActivityHub` source arbitration and sessionization tests;
- existing Discord activity compatibility tests;
- IndexedDB queue, batching, idempotency, and lifecycle-trigger tests;
- policy signature, cache, and stale-policy tests;
- `SettingsContext` enforced-value and cross-window reconciliation tests;
- active-group selection and policy refresh tests;
- Electron and Capacitor builds and focused integration tests.

### 14.3 Console

- route permission and group-scope tests;
- policy inheritance and provenance UI tests;
- destructive-action and publish confirmations;
- table filtering/pagination and empty/error/loading states;
- keyboard navigation and accessible-name checks for HeroUI compositions;
- responsive behavior at supported administration-console widths;
- visual verification against the approved HeroUI dashboard direction.

### 14.4 End-to-end acceptance scenarios

1. A root admin creates `German`, two classes, and child project groups.
2. A teacher managing `German A` invites another teacher into a project group but cannot inspect `German` or `German B`.
3. Root policy selects the shared LLM provider and hard school budget; `German A` selects its language profile and receives a smaller quota.
4. A learner in multiple classes selects an active group and receives the correct effective policy.
5. A locked setting cannot be changed through the UI, stale storage, or another app window.
6. Video/reader/flashcard activity reaches management from Electron and Capacitor through the same frontend hub while Discord presence still works on Electron.
7. Teachers see learner/content/LLM analytics only inside their authorized subtree.
8. Concurrent learner requests cannot overspend a group or ancestor hard quota.
9. LLM conversations stream through the existing adapter, are logged by management, and are inaccessible to sibling-group teachers.
10. Management downtime preserves local learning and cached restrictions without silently enabling network-controlled features.

## 15. Delivery Slices

Implementation is divided into independently verifiable slices that share the contracts above:

1. persistence, migrations, encryption foundation, accounts, and compatible auth;
2. group tree, memberships, capabilities, provisioning, and active-group context;
3. policy registry, drafts, compilation, publication, delivery, and app enforcement;
4. LLM provider adapters, compatible streaming, pricing, reservations, quotas, and conversations;
5. frontend activity hub, IndexedDB delivery, ingestion, aggregation, and analytics queries;
6. approved HeroUI console across all product areas;
7. security hardening, migration coverage, cross-platform verification, and complete end-to-end acceptance tests.

Each slice must pass its focused tests before the next depends on it. Full backend tests, management frontend tests/typecheck/build, root app tests/typecheck/build, and `git diff --check` form the final verification gate.

## 16. Explicit Non-Goals for the Initial Release

- Public learner self-signup.
- SAML, OIDC, or SCIM integrations; the identity schema retains external-provider identifiers for later adapters.
- A general-purpose Docker or host administration product.
- Multiple parents for a group.
- Arbitrary executable policy code.
- Silent user-specific policy overrides outside the group tree.
- Analytics collection outside the documented typed activity allowlist.
