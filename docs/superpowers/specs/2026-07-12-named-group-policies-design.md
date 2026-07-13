# Named Group Policies and Rule Builder Design

**Status:** Approved direction, implementation design
**Date:** 2026-07-12
**Supersedes:** The single-draft/single-active-policy-per-group restriction in section 6.1 of `2026-07-09-school-management-platform-design.md`

## 1. Problem

The current Policies page presents every supported policy field as one large form. It does not resemble a list of policies, makes unset options look like configured rules, and hides the required save/validate/publish sequence. Administrators cannot create multiple policies for a group or understand draft and publication state at a glance.

The product model will instead be:

- a group owns zero or more named policies;
- a policy is made only from rules an administrator explicitly adds;
- each policy has its own draft, immutable published versions, active version, enabled state, and ordering within the group;
- inherited policies remain visible with their source group and cannot be edited from a descendant group;
- a setting rule may enforce and lock an app setting to a validated value.

## 2. Policy Composition

### 2.1 Identity and lifecycle

A policy is a stable container with an ID, owning group, name, optional description, enabled state, and priority. The mutable draft and immutable published versions belong to that policy ID rather than directly to the group.

Its visible lifecycle is:

1. `Draft` — created but never published.
2. `Unsaved changes` — the browser model differs from the saved draft.
3. `Saved` — the current browser model matches the server draft but has not been validated.
4. `Invalid` or `Validated` — validation applies to the exact saved document hash.
5. `Published` — the validated draft became a new immutable active version.
6. `Disabled` — its active version remains in history but does not participate in effective policy compilation.

Editing a validated draft immediately returns it to `Unsaved changes`. Saving it invalidates the previous validation result. Publication is allowed only when the latest validation hash equals the current saved draft hash and a change summary is present.

### 2.2 Ordering and inheritance

Effective policy compilation remains deterministic:

1. groups are applied from the school root down to the selected group;
2. enabled policies within each group are applied from lowest to highest priority;
3. for ordinary values, a later rule specializes an earlier rule;
4. hard denials, hard limits, and other non-weakenable constraints remain in force regardless of later policy order;
5. every compiled rule records the source group, policy, policy version, and rule.

Reordering affects only enabled policies owned by the selected group. It is an audited operation and triggers recompilation. Inherited policies can be inspected but are reordered only from their owning group.

Enabling, disabling, and reordering policies creates an immutable policy-set revision for the owning group. Effective snapshots and analytics provenance include that revision, so the exact active policy IDs, versions, and order can always be reconstructed. These composition changes require publish capability and an explicit confirmation; they do not silently take effect while editing an individual policy draft.

## 3. Rules

The editor starts empty and displays only rules present in the selected policy. `Add rule` opens a searchable, categorized registry. It never renders all possible rule controls by default.

Initial rule categories are:

- **App settings:** enforce a supported setting value, with an explicit `Lock this setting` control.
- **Features:** enable or disable a registered feature, including a hard restriction where supported.
- **LLM access:** enablement, providers, models, prompt profile, rate limits, concurrent streams, and quotas.
- **Governance:** activity retention, conversation retention, and teacher export permissions.

Each registry entry defines a stable rule key, label, explanation, category, value type, constraints, allowed operators, and whether locking or hard enforcement is supported. App setting entries also define the corresponding typed editor: toggle, select, number, or text. The server remains authoritative and rejects unknown keys, invalid values, duplicate singleton rules, unsafe numeric values, and contradictory hard constraints.

For app settings, a rule is represented by a validated setting key, typed value, and `locked` flag. A locked setting is delivered in the effective policy snapshot. The main app keeps the setting visible, applies the required value, disables mutation, shows `Managed by your school`, and identifies the source group and policy.

Rules have stable IDs so the UI can edit, remove, and reorder them without relying on array position. Reordering is meaningful only for rule types whose registry definition permits it; singleton settings and constraints are unique by key within a policy.

Draft documents use a discriminated `rules` array. Every entry includes `id`, `kind`, and the fields registered for that kind. For example, a setting rule contains `settingKey`, `value`, and `locked`; a feature rule contains `featureKey`, `enabled`, and `hard`. The compiler normalizes this authoring format into the existing effective settings, features, LLM, quota, and governance structures delivered to clients.

## 4. Console Experience

### 4.1 Page structure

The Policies page is scoped by the existing selected-group control and repeats the group name in its heading.

The page uses a list-and-editor layout:

- **Local policies list:** named policies owned by the selected group, ordered by priority. Each row shows enabled state, Draft/Published/Disabled status, rule count, last update, and validation or unsaved indicator.
- **Inherited policies list:** enabled policies inherited from ancestors, grouped by source group and marked read-only.
- **Policy editor:** name, description, enabled state, explicit rule list, `Add rule`, draft state, and publication controls for the selected local policy.
- **Version history:** published versions for the selected policy with author, timestamp, summary, active marker, and a read-only rule snapshot/diff.

An empty group gets an explanatory state and a primary `Create policy` action. Creation asks for a name and optional description, then opens an empty rule list.

### 4.2 Editing and publication feedback

The action area always explains the current state and required next action:

- unsaved: `Save draft before validating or publishing`;
- saved: `Validate this draft before publishing`;
- invalid: show validation problems beside the affected rules;
- validated: `Ready to publish` and enable publication once a summary is supplied;
- unchanged after publication: show the active version and disable redundant publication.

Buttons remain visible rather than disappearing. Disabled actions include an inline reason and accessible description. Saving, validating, and publishing have distinct loading, success, and error states. Navigation to another policy or group with unsaved changes requires confirmation.

Publication opens a review dialog showing added, changed, removed, and inherited effects. It requires a change summary. On success, the new version is marked active, history refreshes, and the editor remains on the policy with a `Published` confirmation.

### 4.3 Rule builder

`Add rule` presents searchable categories and excludes singleton rules already present. Selecting a rule creates a compact rule card with a plain-language sentence and its typed controls. Examples:

- `Lock app setting` → `Reader autoplay` → `Off` → `Lock this setting`.
- `Restrict LLM providers` → select allowed providers.
- `Limit requests` → requests per minute.
- `Retain conversations` → number of days.

Each card shows inheritance conflicts or hard ancestor constraints directly. A local rule that cannot change the effective result may be saved for clarity only if valid, but the UI warns that an ancestor currently constrains it.

## 5. Backend and API Contract

### 5.1 Storage

Add a `policies` table for stable identity and metadata. Existing draft, version, and active records gain `policy_id`; uniqueness moves from `group_id` to `policy_id`. Published versions remain immutable. A validation record stores the policy ID, exact draft hash, validator, and timestamp; saving a different hash makes it inapplicable. Policy-set revisions record the ordered active policy/version pairs for a group and are immutable once created.

Existing installations migrate each group’s legacy policy records into one named policy called `Group policy`, preserving draft contents, active version, history, hashes, authors, timestamps, and ancestry references. Migration must not republish or silently change effective behavior.

### 5.2 Endpoints

Group collection endpoints:

- `GET /api/groups/{groupId}/policies` — local policy summaries plus inherited summaries and effective ordering.
- `POST /api/groups/{groupId}/policies` — create a named empty policy.
- `PATCH /api/groups/{groupId}/policies/order` — reorder local policies.

Policy resource endpoints:

- `GET/PATCH /api/policies/{policyId}` — metadata and enabled state.
- `GET/PUT /api/policies/{policyId}/draft` — retrieve or save the explicit rule document.
- `POST /api/policies/{policyId}/validate` — validate the saved hash.
- `POST /api/policies/{policyId}/publish` — publish only the validated hash.
- `GET /api/policies/{policyId}/history` — immutable versions.
- `GET /api/policy-registry` — supported rule metadata and typed setting definitions.

Effective policy delivery endpoints remain compatible. Their provenance expands to include policy identity and rule identity. Authorization continues to derive from group ownership: viewing an inherited policy follows subtree visibility, while editing, ordering, enabling, and publishing require capability on the owning group.

Mutation requests use optimistic concurrency tokens. A stale editor receives a conflict response containing the current server revision rather than overwriting another administrator’s work.

## 6. Main-App Enforcement

The effective snapshot remains the only policy input to the learning app. Named policies and editor drafts are console concerns; clients receive one compiled, signed result. Setting locks use the existing centralized settings mutation boundary so initial load, ordinary edits, migration, and cross-window synchronization cannot bypass an enforced value.

The app must never interpret arbitrary rule code. Only server-registered setting keys and feature capabilities are accepted, compiled, signed, and enforced.

## 7. Errors, Auditing, and Safety

Create, rename, enable/disable, reorder, save, validate, and publish operations create audit records with actor, owning group, policy ID, revision/hash, and outcome. Published versions cannot be edited or deleted. A policy with an active version may be disabled but not destructively removed; never-published empty policies may be deleted after confirmation.

Validation errors are structured by rule ID and field so the console can place them next to the relevant control. Server errors remain visible without discarding the administrator’s unsaved browser state.

## 8. Verification

Backend tests cover migration preservation, policy CRUD authorization, ordering, inheritance, hard-constraint composition, optimistic concurrency, validation-hash publication, immutable history, audit events, and setting-lock compilation.

Console tests cover empty state, local and inherited lists, explicit rule addition/removal, typed setting controls, unsaved/saved/invalid/validated/published indicators, disabled-action explanations, publish review, history, conflict recovery, and unsaved-navigation confirmation.

Main-app tests prove that locked settings are applied, visible, disabled, source-labelled, restored after attempted mutation, preserved across cross-window synchronization, and retained from the last valid signed snapshot when management is unavailable.
