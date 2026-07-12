# Management Analytics and Console Product Design

## Objective

Turn the management console into a useful, permission-aware school operations product centered on factual historical trends, governance visibility, and administrative history. Preserve the existing users, groups, policies, conversation logs, LLM gateway, settings, and operational features.

The console remains one product for teachers and administrators. Permissions and group scope reveal additional capabilities; there are no separate role-specific dashboards. Teachers see only authorized groups and capabilities. Administrators additionally see governance and configuration. Root administrators additionally see the root group and deployment operations.

## Truth Boundary

Current telemetry can describe activity but cannot reliably determine comprehension, difficulty, or whether a learner is struggling.

Supported factual data includes activity sessions, reader page positions, video time, flashcard-session completion, LLM requests and usage, policy blocks, timestamps, groups, and optional content metadata. The product may show trends, comparisons, histories, and operational conditions derived from those facts.

The product must not infer or label:

- struggling or at-risk learners;
- understanding or learning improvement;
- content difficulty;
- the cause or educational meaning of slow, repeated, or absent activity.

A future app-owned struggle detector may supply an explicit, versioned signal with its own reason, confidence, and evidence references. This design only preserves an extension point for that future signal; it does not approximate it from current activity.

## Information Architecture

The existing sidebar remains, with two additions:

- Dashboard
- Users
- Groups
- Policies
- Analytics
- Conversation Logs
- LLM Gateway
- Governance
- Activity Log
- Settings

The top bar contains the existing group selector plus global search and a compact notification indicator. Notifications are console-only and link to existing pages or filtered logs.

## Analytics Workspace

Analytics becomes a historical exploration workspace rather than a collection of isolated totals.

### Global Controls

- Selected group from the global group selector
- Preset ranges of 7, 30, 90, and 365 days
- Custom date range
- Comparison with the previous equivalent period, previous year, or no comparison
- Automatic granularity with daily, weekly, and monthly overrides
- Export of the currently visible scope and filters
- Save and restore an analytics view

All date boundaries use the school quota-calendar timezone. UTC is the explicit fallback when the school timezone is unavailable.

### Summary Cards

The overview shows four uniform cards:

- Active learners
- Activity sessions
- Recorded activity, with reader pages, video minutes, and flashcard sessions kept distinct
- LLM requests and cost

Each card may show the current value, absolute change, a percentage change when mathematically meaningful, and a factual sparkline. Percentage change is omitted when the comparison value is zero.

### Activity History

A multi-series line or area chart supports:

- active learners;
- sessions;
- reader pages recorded;
- video minutes recorded;
- flashcard sessions.

The comparison period appears as a subdued dashed series. Tooltips show exact values. Selecting a point opens the matching period history and factual event summary when retained raw data is available.

### LLM History

Charts show requests, input and output tokens, cost, latency when recorded, errors, and policy blocks over time. Authorized users may break the data down by provider, model, or group. Conversation content never appears in analytics.

### Governance History

Charts show policy blocks over time with breakdowns by rule and group. Policy-publication markers may appear on the timeline to provide context, but the UI must not claim that a publication caused a later change.

### Activity Composition

Stacked bars compare reader, video, flashcard, and LLM activity across periods. Decorative pie charts are avoided because they obscure historical comparison.

### Detailed Tabs

- Learners: last recorded activity, sessions, reader pages, video time, flashcard sessions, LLM usage, cost, and blocks
- Content: factual engagement totals and history
- LLM: provider and model utilization, cost, errors, latency, and block totals
- Policy blocks: rule, group, provider, model, totals, and history
- History: chronological aggregate records with authorized drill-down

Every graph has a matching accessible data table. Empty periods show zero or `No recorded data` as appropriate. Missing, partial, incomplete, and retention-expired data are identified explicitly rather than rendered as zero.

## Lean Governance

Governance is a compact overview that connects existing policy, LLM, and logging features. It is not a new incident-management or policy-approval system.

### Policies

Show each authorized group with:

- active policy count;
- inherited or local status;
- unpublished-draft indicator;
- last publication time;
- a link that opens Policies in that group scope.

### Usage and Limits

Show current LLM usage, quota remaining, provider configuration or health problems, and API keys approaching expiry. Each item links to LLM Gateway.

### Recent Governance Activity

Show policy publications, recorded policy blocks, quota thresholds, failed provider health checks, and API-key creation or revocation. Items link to their existing page or a filtered Activity Log.

This design excludes policy simulation, approval workflows, configuration-drift classification, automatic remediation, and incident assignment.

## Console Notifications

Notifications are lightweight, console-only derived records for actionable operational conditions:

- unpublished policy drafts;
- low quota;
- unavailable or repeatedly failing providers;
- API keys approaching expiry.

Each notification contains a type, severity, authorized group scope, factual message, source link, creation time, and read or dismissed state. Notifications are deduplicated. Resolving the source condition prevents a duplicate from being recreated immediately.

There is no email, webhook, escalation, assignment, or comment workflow. Relevant conditions also appear contextually on Policies, LLM Gateway, Governance, or Activity Log.

## Additional Product Features

### Global Search

Search authorized users, groups, and policies from the top bar. Selecting a result opens the existing owning page. Search does not become a command or mutation system.

### Recent Activity and Activity Log

The dashboard shows recent important administrative events already represented by audit data: policy publication, user and membership changes, group changes, exports, provider configuration, and API-key changes.

`View all` opens Activity Log. Activity Log supports filters for date, group, actor, action, and target. An event detail shows safe metadata, request ID, and a safe before-and-after diff when one exists.

### Saved Analytics Views

A saved view stores group, date range, comparison mode, granularity, active tab, visible metrics, and breakdown. Saved views are private to the user in the initial implementation. Sharing, scheduling, and a general report builder are excluded.

### User History

User detail gains an Activity tab with factual daily history for sessions, reader pages, video time, flashcard sessions, LLM usage, blocks, devices, and membership changes. It contains no score or interpretation.

### Provider History

LLM Gateway shows request, error, latency, and cost history per provider and model. Provider health-test results are recorded so intermittent failures are visible rather than reduced to the latest result.

### Later Enhancements

Dashboard panel rearrangement and historical annotations for holidays, exams, outages, or migrations may follow after the initial release. They are not required for the first implementation plan.

## Backend and Data Flow

The existing management backend remains the only service.

- Activity events and daily rollups remain canonical for activity analytics.
- Historical charts read daily rollups whenever possible.
- Raw activity events support authorized drill-down only while retained.
- LLM usage, policy blocks, audit events, provider health, and configuration history remain separate datasets joined at the API and view layer.
- Every query applies current group authorization and descendant scoping.
- Comparison periods are calculated server-side so cards, graphs, tables, and exports use identical boundaries.

Required backend capabilities are limited to:

- richer analytics timeseries with selected metrics and granularity;
- period-comparison summaries;
- factual learner and content histories;
- provider and model usage and health history;
- compact governance summary;
- filtered recent administrative activity;
- authorized search across users, groups, and policies;
- saved analytics-view preferences;
- lightweight notification state.

## Frontend Structure

Shared HeroUI-based chart surfaces normalize all time-series responses into the same structure. Reusable units cover:

- line and area charts;
- stacked-bar charts;
- comparison series;
- legends and tooltips;
- accessible data tables;
- loading, error, missing-data, and empty states.

Graphs remain interactive without hiding the corresponding exact values. Failed secondary requests do not blank the entire page. Each panel reports its own recoverable error state.

## Export Contract

Exports use the exact group scope, date boundaries, comparison-independent primary period, filters, breakdowns, and permissions visible in the console. The export action remains policy-controlled and audited. The initial format remains CSV.

## Testing and Verification

Backend tests cover:

- timezone and daylight-saving boundaries;
- daily, weekly, and monthly aggregation;
- current and comparison-period alignment;
- permission and descendant scoping;
- zero, missing, incomplete, and retention-expired data;
- provider health history and notification deduplication;
- search and saved-view authorization;
- export parity with visible filters.

Frontend tests cover:

- chart and accessible-table agreement;
- comparison formatting and zero denominators;
- per-panel loading and failure behavior;
- filters, saved views, drill-down navigation, and notification state;
- permission-driven visibility;
- desktop and mobile layouts.

Final verification includes the complete frontend and backend suites, typechecking, production builds, management Clippy with warnings denied, and live browser inspection of every affected page at desktop and mobile widths.

## Initial Delivery Order

1. Historical analytics APIs, graphs, comparison periods, and accessible tables
2. Analytics drill-down and factual user, content, LLM, and policy-block history
3. Lean governance summary and console-only notifications
4. Recent administrative activity and Activity Log
5. Authorized global search
6. User and provider history
7. Saved analytics views

Dashboard rearrangement, graph annotations, external notifications, assessment systems, and inferred learning outcomes are outside the initial scope.
