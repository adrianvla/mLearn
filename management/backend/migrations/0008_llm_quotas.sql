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
    status TEXT NOT NULL CHECK (status IN ('open', 'reconciled', 'expired')),
    expires_at INTEGER NOT NULL,
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
    PRIMARY KEY (reservation_id, metric)
);

CREATE TABLE quota_reservation_scopes (
    reservation_id TEXT NOT NULL REFERENCES quota_reservations(id) ON DELETE RESTRICT,
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('user', 'group')),
    scope_id TEXT NOT NULL,
    depth INTEGER NOT NULL CHECK (depth >= 0),
    PRIMARY KEY (reservation_id, scope_kind, scope_id)
);

CREATE TABLE usage_ledger (
    id TEXT PRIMARY KEY NOT NULL,
    reservation_id TEXT NOT NULL,
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('user', 'group')),
    scope_id TEXT NOT NULL,
    metric TEXT NOT NULL CHECK (metric IN ('requests', 'inputTokens', 'outputTokens', 'totalTokens', 'costMicros')),
    value INTEGER NOT NULL CHECK (value >= 0 AND value <= 9007199254740991),
    period_starts_at INTEGER NOT NULL,
    period_ends_at INTEGER NOT NULL,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    price_version_id TEXT NOT NULL REFERENCES provider_price_versions(id) ON DELETE RESTRICT,
    learner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    direct_group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    created_at INTEGER NOT NULL,
    UNIQUE (reservation_id, scope_kind, scope_id, metric),
    FOREIGN KEY (reservation_id, scope_kind, scope_id)
        REFERENCES quota_reservation_scopes(reservation_id, scope_kind, scope_id) ON DELETE RESTRICT,
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
END;

CREATE TRIGGER quota_reservations_immutable_identity
BEFORE UPDATE OF id, request_id, learner_user_id, direct_group_id, provider_id, model_id, price_version_id, payload_hash, expires_at, created_at
ON quota_reservations BEGIN
    SELECT RAISE(ABORT, 'quota reservation identity is immutable');
END;

CREATE TRIGGER quota_reservations_lifecycle
BEFORE UPDATE OF status, reconcile_hash ON quota_reservations
BEGIN
    SELECT CASE WHEN OLD.status = 'reconciled' AND (NEW.status != OLD.status OR NEW.reconcile_hash != OLD.reconcile_hash)
        THEN RAISE(ABORT, 'reconciled reservation is immutable') END;
    SELECT CASE WHEN NEW.status = 'reconciled' AND (NEW.reconcile_hash IS NULL OR NOT EXISTS (SELECT 1 FROM usage_ledger WHERE reservation_id = NEW.id))
        THEN RAISE(ABORT, 'reconciled reservation requires ledger entries') END;
    SELECT CASE WHEN OLD.status = 'expired' AND NEW.status NOT IN ('expired', 'reconciled')
        THEN RAISE(ABORT, 'expired reservation cannot be reopened') END;
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
