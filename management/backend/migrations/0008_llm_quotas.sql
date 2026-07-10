CREATE TABLE school_quota_calendars (
    root_group_id TEXT PRIMARY KEY NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    timezone TEXT NOT NULL,
    term_starts_at INTEGER NOT NULL,
    term_ends_at INTEGER NOT NULL,
    updated_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_at INTEGER NOT NULL,
    CHECK (term_starts_at >= 0 AND term_ends_at > term_starts_at)
);

CREATE TABLE quota_definitions (
    id TEXT PRIMARY KEY NOT NULL,
    owner_group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    subject_kind TEXT NOT NULL CHECK (subject_kind IN ('group', 'user')),
    subject_id TEXT NOT NULL,
    metric TEXT NOT NULL CHECK (metric IN ('requests', 'inputTokens', 'outputTokens', 'totalTokens', 'costMicros')),
    period TEXT NOT NULL CHECK (period IN ('daily', 'weekly', 'monthly', 'term')),
    limit_value INTEGER NOT NULL CHECK (limit_value >= 0 AND limit_value <= 9007199254740991),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (owner_group_id, subject_kind, subject_id, metric, period),
    CHECK ((subject_kind = 'group' AND subject_id = owner_group_id) OR subject_kind = 'user')
);

CREATE INDEX quota_definitions_subject_idx
    ON quota_definitions(subject_kind, subject_id, metric, period);

CREATE TABLE quota_mutations (
    actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    owner_group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    operation TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_hash BLOB NOT NULL,
    target_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (actor_user_id, owner_group_id, operation, idempotency_key)
);

CREATE TABLE quota_reservations (
    id TEXT PRIMARY KEY NOT NULL,
    request_id TEXT NOT NULL,
    learner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    direct_group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    price_version_id TEXT NOT NULL REFERENCES provider_price_versions(id) ON DELETE RESTRICT,
    payload_hash BLOB NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('building', 'open', 'reconciled', 'expired')),
    expires_at INTEGER NOT NULL,
    accounting_at INTEGER NOT NULL,
    finalized INTEGER NOT NULL DEFAULT 0 CHECK (finalized IN (0, 1)),
    created_at INTEGER NOT NULL,
    reconciled_at INTEGER,
    reconcile_hash BLOB,
    UNIQUE (learner_user_id, request_id),
    FOREIGN KEY (provider_id) REFERENCES llm_providers(id) ON DELETE RESTRICT,
    FOREIGN KEY (model_id) REFERENCES llm_models(id) ON DELETE RESTRICT
);

CREATE INDEX quota_reservations_open_expiry_idx
    ON quota_reservations(status, expires_at);

CREATE TABLE quota_reservation_metrics (
    reservation_id TEXT NOT NULL REFERENCES quota_reservations(id) ON DELETE RESTRICT,
    metric TEXT NOT NULL CHECK (metric IN ('requests', 'inputTokens', 'outputTokens', 'totalTokens', 'costMicros')),
    reserved_value INTEGER NOT NULL CHECK (reserved_value >= 0 AND reserved_value <= 9007199254740991),
    required INTEGER NOT NULL CHECK (required IN (0, 1)),
    PRIMARY KEY (reservation_id, metric)
);

CREATE TABLE quota_reservation_scopes (
    reservation_id TEXT NOT NULL REFERENCES quota_reservations(id) ON DELETE RESTRICT,
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('user', 'group')),
    scope_id TEXT NOT NULL,
    depth INTEGER NOT NULL CHECK (depth >= 0),
    PRIMARY KEY (reservation_id, scope_kind, scope_id)
);

CREATE TABLE quota_reservation_periods (
    reservation_id TEXT NOT NULL REFERENCES quota_reservations(id) ON DELETE RESTRICT,
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('user', 'group')),
    scope_id TEXT NOT NULL,
    metric TEXT NOT NULL CHECK (metric IN ('requests', 'inputTokens', 'outputTokens', 'totalTokens', 'costMicros')),
    quota_period TEXT NOT NULL CHECK (quota_period IN ('event', 'daily', 'weekly', 'monthly', 'term')),
    period_starts_at INTEGER NOT NULL,
    period_ends_at INTEGER NOT NULL,
    limit_value INTEGER CHECK (limit_value IS NULL OR (limit_value >= 0 AND limit_value <= 9007199254740991)),
    definition_id TEXT REFERENCES quota_definitions(id) ON DELETE RESTRICT,
    is_primary INTEGER NOT NULL CHECK (is_primary IN (0, 1)),
    PRIMARY KEY (reservation_id, scope_kind, scope_id, metric, quota_period, period_starts_at, period_ends_at),
    FOREIGN KEY (reservation_id, scope_kind, scope_id)
        REFERENCES quota_reservation_scopes(reservation_id, scope_kind, scope_id) ON DELETE RESTRICT,
    FOREIGN KEY (reservation_id, metric)
        REFERENCES quota_reservation_metrics(reservation_id, metric) ON DELETE RESTRICT,
    CHECK (period_starts_at >= 0 AND period_ends_at > period_starts_at)
);

CREATE UNIQUE INDEX quota_reservation_periods_primary
    ON quota_reservation_periods(reservation_id, scope_kind, scope_id, metric)
    WHERE is_primary = 1;

CREATE TABLE usage_ledger (
    id TEXT PRIMARY KEY NOT NULL,
    reservation_id TEXT NOT NULL,
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('user', 'group')),
    scope_id TEXT NOT NULL,
    metric TEXT NOT NULL CHECK (metric IN ('requests', 'inputTokens', 'outputTokens', 'totalTokens', 'costMicros')),
    value INTEGER NOT NULL CHECK (value >= 0 AND value <= 9007199254740991),
    period_starts_at INTEGER NOT NULL,
    period_ends_at INTEGER NOT NULL,
    quota_period TEXT NOT NULL CHECK (quota_period IN ('event', 'daily', 'weekly', 'monthly', 'term')),
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    price_version_id TEXT NOT NULL REFERENCES provider_price_versions(id) ON DELETE RESTRICT,
    learner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    direct_group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    created_at INTEGER NOT NULL,
    UNIQUE (reservation_id, scope_kind, scope_id, metric, quota_period, period_starts_at, period_ends_at),
    FOREIGN KEY (reservation_id, scope_kind, scope_id)
        REFERENCES quota_reservation_scopes(reservation_id, scope_kind, scope_id) ON DELETE RESTRICT,
    FOREIGN KEY (reservation_id, scope_kind, scope_id, metric, quota_period, period_starts_at, period_ends_at)
        REFERENCES quota_reservation_periods(reservation_id, scope_kind, scope_id, metric, quota_period, period_starts_at, period_ends_at) ON DELETE RESTRICT,
    CHECK (period_starts_at >= 0 AND period_ends_at > period_starts_at)
);

CREATE INDEX usage_ledger_scope_period_idx
    ON usage_ledger(scope_kind, scope_id, metric, period_starts_at, period_ends_at);
CREATE INDEX usage_ledger_breakdown_idx
    ON usage_ledger(direct_group_id, learner_user_id, provider_id, model_id, created_at);

CREATE TRIGGER quota_definitions_owner_insert
BEFORE INSERT ON quota_definitions
BEGIN
    SELECT CASE
        WHEN NEW.subject_kind = 'group' AND NOT EXISTS (
            SELECT 1 FROM groups WHERE id = NEW.owner_group_id AND id = NEW.subject_id AND status != 'archived'
        ) THEN RAISE(ABORT, 'group quota owner is inconsistent')
        WHEN NEW.subject_kind = 'user' AND NOT EXISTS (
            SELECT 1 FROM group_memberships
            WHERE group_id = NEW.owner_group_id AND user_id = NEW.subject_id AND status = 'active'
        ) THEN RAISE(ABORT, 'user quota subject is not an active direct member')
    END;
END;

CREATE TRIGGER quota_definitions_identity_immutable
BEFORE UPDATE OF id, owner_group_id, subject_kind, subject_id, metric, period, created_by_user_id, created_at
ON quota_definitions BEGIN
    SELECT RAISE(ABORT, 'quota definition identity and ownership are immutable');
END;

CREATE TRIGGER quota_definitions_inherited_cap_insert
BEFORE INSERT ON quota_definitions
BEGIN
    SELECT CASE WHEN NEW.subject_kind = 'group' AND EXISTS (
        WITH RECURSIVE ancestors(id, parent_id) AS (
            SELECT parent_id, (SELECT parent_id FROM groups WHERE id = g.parent_id) FROM groups g WHERE g.id = NEW.owner_group_id AND g.parent_id IS NOT NULL
            UNION ALL SELECT p.id, p.parent_id FROM groups p JOIN ancestors a ON a.parent_id = p.id
        ) SELECT 1 FROM quota_definitions q JOIN ancestors a ON a.id = q.owner_group_id
          WHERE q.status = 'active' AND q.subject_kind = 'group' AND q.subject_id = q.owner_group_id AND q.metric = NEW.metric AND q.period = NEW.period AND q.limit_value < NEW.limit_value
    ) THEN RAISE(ABORT, 'child quota exceeds inherited cap') END;
    SELECT CASE WHEN NEW.subject_kind = 'user' AND EXISTS (
        WITH RECURSIVE ancestors(id, parent_id) AS (
            SELECT id, parent_id FROM groups WHERE id = NEW.owner_group_id
            UNION ALL SELECT p.id, p.parent_id FROM groups p JOIN ancestors a ON a.parent_id = p.id
        ) SELECT 1 FROM quota_definitions q JOIN ancestors a ON a.id = q.owner_group_id
          WHERE q.status = 'active' AND q.id != NEW.id AND q.metric = NEW.metric AND q.period = NEW.period AND q.limit_value < NEW.limit_value
            AND ((q.subject_kind = 'group' AND q.subject_id = q.owner_group_id) OR (q.subject_kind = 'user' AND q.subject_id = NEW.subject_id))
    ) THEN RAISE(ABORT, 'user quota exceeds inherited cap') END;
END;

CREATE TRIGGER quota_definitions_inherited_cap_update
BEFORE UPDATE OF limit_value ON quota_definitions
BEGIN
    SELECT CASE WHEN NEW.subject_kind = 'group' AND EXISTS (
        WITH RECURSIVE ancestors(id, parent_id) AS (
            SELECT parent_id, (SELECT parent_id FROM groups WHERE id = g.parent_id) FROM groups g WHERE g.id = NEW.owner_group_id AND g.parent_id IS NOT NULL
            UNION ALL SELECT p.id, p.parent_id FROM groups p JOIN ancestors a ON a.parent_id = p.id
        ) SELECT 1 FROM quota_definitions q JOIN ancestors a ON a.id = q.owner_group_id
          WHERE q.status = 'active' AND q.subject_kind = 'group' AND q.metric = NEW.metric AND q.period = NEW.period AND q.limit_value < NEW.limit_value
    ) THEN RAISE(ABORT, 'child quota exceeds inherited cap') END;
    SELECT CASE WHEN NEW.subject_kind = 'user' AND EXISTS (
        WITH RECURSIVE ancestors(id, parent_id) AS (
            SELECT id, parent_id FROM groups WHERE id = NEW.owner_group_id
            UNION ALL SELECT p.id, p.parent_id FROM groups p JOIN ancestors a ON a.parent_id = p.id
        ) SELECT 1 FROM quota_definitions q JOIN ancestors a ON a.id = q.owner_group_id
          WHERE q.status = 'active' AND q.id != NEW.id AND q.metric = NEW.metric AND q.period = NEW.period AND q.limit_value < NEW.limit_value
            AND ((q.subject_kind = 'group' AND q.subject_id = q.owner_group_id) OR (q.subject_kind = 'user' AND q.subject_id = NEW.subject_id))
    ) THEN RAISE(ABORT, 'user quota exceeds inherited cap') END;
    SELECT CASE WHEN NEW.subject_kind = 'group' AND EXISTS (
        WITH RECURSIVE descendants(id) AS (
            SELECT id FROM groups WHERE parent_id = NEW.owner_group_id
            UNION ALL SELECT g.id FROM groups g JOIN descendants d ON g.parent_id = d.id
        ) SELECT 1 FROM quota_definitions q JOIN descendants d ON d.id = q.owner_group_id
          WHERE q.status = 'active' AND q.subject_kind = 'group' AND q.metric = NEW.metric AND q.period = NEW.period AND q.limit_value > NEW.limit_value
    ) THEN RAISE(ABORT, 'parent quota cannot be lowered below an active descendant') END;
    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM active_policies active
        JOIN policy_versions version ON version.id = active.policy_version_id,
        json_each(version.document_json, '$.llm.quotas') rule
        WHERE active.group_id = NEW.owner_group_id
          AND json_extract(rule.value, '$.hard') = 1
          AND json_extract(rule.value, '$.metric') = NEW.metric
          AND json_extract(rule.value, '$.period') = NEW.period
          AND NEW.limit_value > json_extract(rule.value, '$.limit')
    ) THEN RAISE(ABORT, 'quota definition would invalidate active policy') END;
END;

CREATE TRIGGER quota_definitions_active_policy_delete
BEFORE UPDATE OF status ON quota_definitions
WHEN OLD.status = 'active' AND NEW.status = 'deleted'
BEGIN
    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM active_policies active
        JOIN policy_versions version ON version.id = active.policy_version_id,
        json_each(version.document_json, '$.llm.quotas') rule
        WHERE active.group_id = OLD.owner_group_id
          AND json_extract(rule.value, '$.hard') = 1
          AND json_extract(rule.value, '$.metric') = OLD.metric
          AND json_extract(rule.value, '$.period') = OLD.period
    ) THEN RAISE(ABORT, 'active policy requires quota definition') END;
END;

CREATE TRIGGER quota_reservations_immutable_identity
BEFORE UPDATE OF id, request_id, learner_user_id, direct_group_id, provider_id, model_id, price_version_id, payload_hash, expires_at, accounting_at, created_at
ON quota_reservations BEGIN
    SELECT RAISE(ABORT, 'quota reservation identity is immutable');
END;

CREATE TRIGGER quota_reservations_lifecycle
BEFORE UPDATE OF status, finalized, reconcile_hash ON quota_reservations
BEGIN
    SELECT CASE WHEN OLD.status = 'reconciled' AND (NEW.status != OLD.status OR NEW.reconcile_hash != OLD.reconcile_hash)
        THEN RAISE(ABORT, 'reconciled reservation is immutable') END;
    SELECT CASE WHEN NEW.status = 'open' AND (OLD.status != 'building' OR NEW.finalized != 1)
        THEN RAISE(ABORT, 'reservation must be finalized exactly once') END;
    SELECT CASE WHEN NEW.status = 'open' AND NOT EXISTS (
        SELECT 1 FROM quota_reservation_scopes WHERE reservation_id = NEW.id AND scope_kind = 'user' AND scope_id = NEW.learner_user_id AND depth = 0
    ) THEN RAISE(ABORT, 'finalized reservation requires learner scope') END;
    SELECT CASE WHEN NEW.status = 'open' AND EXISTS (
        WITH RECURSIVE ancestors(id, parent_id, depth) AS (
            SELECT id, parent_id, 0 FROM groups WHERE id = NEW.direct_group_id
            UNION ALL SELECT p.id, p.parent_id, c.depth + 1 FROM groups p JOIN ancestors c ON c.parent_id = p.id
        ) SELECT 1 FROM ancestors a
          WHERE NOT EXISTS (SELECT 1 FROM quota_reservation_scopes s WHERE s.reservation_id = NEW.id AND s.scope_kind = 'group' AND s.scope_id = a.id AND s.depth = a.depth)
    ) THEN RAISE(ABORT, 'finalized reservation is missing an ancestor scope') END;
    SELECT CASE WHEN NEW.status = 'open' AND EXISTS (
        SELECT 1 FROM quota_reservation_scopes s WHERE s.reservation_id = NEW.id AND s.scope_kind = 'group'
          AND NOT EXISTS (
              WITH RECURSIVE ancestors(id, parent_id, depth) AS (
                  SELECT id, parent_id, 0 FROM groups WHERE id = NEW.direct_group_id
                  UNION ALL SELECT p.id, p.parent_id, c.depth + 1 FROM groups p JOIN ancestors c ON c.parent_id = p.id
              ) SELECT 1 FROM ancestors a WHERE a.id = s.scope_id AND a.depth = s.depth
          )
    ) THEN RAISE(ABORT, 'finalized reservation has an invalid ancestor scope') END;
    SELECT CASE WHEN NEW.status = 'open' AND NOT EXISTS (
        SELECT 1 FROM quota_reservation_metrics WHERE reservation_id = NEW.id AND metric = 'requests' AND reserved_value = 1
    ) THEN RAISE(ABORT, 'finalized reservation requires exactly one request') END;
    SELECT CASE WHEN NEW.status = 'open' AND EXISTS (
        SELECT 1 FROM quota_reservation_scopes s CROSS JOIN quota_reservation_metrics m
        WHERE s.reservation_id = NEW.id AND m.reservation_id = NEW.id
          AND NOT EXISTS (SELECT 1 FROM quota_reservation_periods p WHERE p.reservation_id = NEW.id AND p.scope_kind = s.scope_kind AND p.scope_id = s.scope_id AND p.metric = m.metric AND p.is_primary = 1)
    ) THEN RAISE(ABORT, 'finalized reservation scope metric is missing a primary accounting period') END;
    SELECT CASE WHEN NEW.status = 'open' AND EXISTS (
        SELECT 1 FROM quota_reservation_periods p JOIN quota_reservation_metrics m ON m.reservation_id = p.reservation_id AND m.metric = p.metric
        WHERE p.reservation_id = NEW.id AND p.limit_value IS NOT NULL AND m.required != 1
    ) THEN RAISE(ABORT, 'governed reservation metric must be required') END;
    SELECT CASE WHEN NEW.status = 'reconciled' AND (NEW.reconcile_hash IS NULL OR
        (SELECT COUNT(*) FROM usage_ledger WHERE reservation_id = NEW.id) !=
        (SELECT COUNT(*) FROM quota_reservation_periods WHERE reservation_id = NEW.id))
        THEN RAISE(ABORT, 'reconciled reservation requires a complete ledger shape') END;
    SELECT CASE WHEN OLD.status = 'expired' AND NEW.status NOT IN ('expired', 'reconciled')
        THEN RAISE(ABORT, 'expired reservation cannot be reopened') END;
END;

CREATE TRIGGER quota_reservation_scopes_building_only
BEFORE INSERT ON quota_reservation_scopes
BEGIN
    SELECT CASE WHEN (SELECT status FROM quota_reservations WHERE id = NEW.reservation_id) != 'building'
        THEN RAISE(ABORT, 'reservation scopes can only be inserted while building') END;
END;

CREATE TRIGGER quota_reservation_metrics_building_only
BEFORE INSERT ON quota_reservation_metrics
BEGIN
    SELECT CASE WHEN (SELECT status FROM quota_reservations WHERE id = NEW.reservation_id) != 'building'
        THEN RAISE(ABORT, 'reservation metrics can only be inserted while building') END;
END;

CREATE TRIGGER quota_reservation_periods_building_only
BEFORE INSERT ON quota_reservation_periods
BEGIN
    SELECT CASE WHEN (SELECT status FROM quota_reservations WHERE id = NEW.reservation_id) != 'building'
        THEN RAISE(ABORT, 'reservation periods can only be inserted while building') END;
END;

CREATE TRIGGER quota_reservation_periods_immutable_update BEFORE UPDATE ON quota_reservation_periods BEGIN
    SELECT RAISE(ABORT, 'quota reservation periods are immutable');
END;
CREATE TRIGGER quota_reservation_periods_immutable_delete BEFORE DELETE ON quota_reservation_periods BEGIN
    SELECT RAISE(ABORT, 'quota reservation periods are immutable');
END;

CREATE TRIGGER usage_ledger_snapshot_match
BEFORE INSERT ON usage_ledger
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM quota_reservations r WHERE r.id = NEW.reservation_id
          AND r.status IN ('open', 'expired')
          AND r.provider_id = NEW.provider_id AND r.model_id = NEW.model_id
          AND r.price_version_id = NEW.price_version_id
          AND r.learner_user_id = NEW.learner_user_id AND r.direct_group_id = NEW.direct_group_id
    ) THEN RAISE(ABORT, 'usage ledger identity does not match reservation snapshot') END;
END;

CREATE TRIGGER quota_reservation_scopes_immutable_update BEFORE UPDATE ON quota_reservation_scopes BEGIN
    SELECT RAISE(ABORT, 'quota reservation scopes are immutable');
END;
CREATE TRIGGER quota_reservation_scopes_immutable_delete BEFORE DELETE ON quota_reservation_scopes BEGIN
    SELECT RAISE(ABORT, 'quota reservation scopes are immutable');
END;
CREATE TRIGGER quota_reservation_metrics_immutable_update BEFORE UPDATE ON quota_reservation_metrics BEGIN
    SELECT RAISE(ABORT, 'quota reservation metrics are immutable');
END;
CREATE TRIGGER quota_reservation_metrics_immutable_delete BEFORE DELETE ON quota_reservation_metrics BEGIN
    SELECT RAISE(ABORT, 'quota reservation metrics are immutable');
END;
CREATE TRIGGER usage_ledger_immutable_update BEFORE UPDATE ON usage_ledger BEGIN
    SELECT RAISE(ABORT, 'usage ledger is append only');
END;
CREATE TRIGGER usage_ledger_immutable_delete BEFORE DELETE ON usage_ledger BEGIN
    SELECT RAISE(ABORT, 'usage ledger is append only');
END;
CREATE TRIGGER quota_mutations_immutable_update BEFORE UPDATE ON quota_mutations BEGIN
    SELECT RAISE(ABORT, 'quota mutations are immutable');
END;
CREATE TRIGGER quota_mutations_immutable_delete BEFORE DELETE ON quota_mutations BEGIN
    SELECT RAISE(ABORT, 'quota mutations are immutable');
END;

CREATE TRIGGER quota_reservation_scope_group_ancestry
BEFORE INSERT ON quota_reservation_scopes WHEN NEW.scope_kind = 'group'
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        WITH RECURSIVE ancestors(id, parent_id) AS (
            SELECT id, parent_id FROM groups WHERE id = (SELECT direct_group_id FROM quota_reservations WHERE id = NEW.reservation_id)
            UNION ALL SELECT parent.id, parent.parent_id FROM groups parent JOIN ancestors child ON child.parent_id = parent.id
        ) SELECT 1 FROM ancestors WHERE id = NEW.scope_id
    ) THEN RAISE(ABORT, 'quota scope is outside reservation ancestry') END;
END;

CREATE TRIGGER quota_reservation_scope_user_identity
BEFORE INSERT ON quota_reservation_scopes WHEN NEW.scope_kind = 'user'
BEGIN
    SELECT CASE WHEN NEW.scope_id != (SELECT learner_user_id FROM quota_reservations WHERE id = NEW.reservation_id)
        THEN RAISE(ABORT, 'quota user scope is inconsistent') END;
END;
