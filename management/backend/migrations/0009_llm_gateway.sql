CREATE TABLE llm_gateway_reservations (
    reservation_id TEXT PRIMARY KEY NOT NULL REFERENCES quota_reservations(id) ON DELETE RESTRICT,
    phase TEXT NOT NULL CHECK (phase IN ('reserved', 'contacting', 'pending', 'completed', 'cancelled')),
    config_fingerprint BLOB NOT NULL CHECK (length(config_fingerprint) = 32),
    conservative_actual_json TEXT NOT NULL,
    measured_actual_json TEXT,
    contact_started_at INTEGER,
    completed_at INTEGER,
    updated_at INTEGER NOT NULL,
    CHECK ((phase = 'reserved' AND contact_started_at IS NULL AND completed_at IS NULL)
        OR (phase IN ('contacting', 'pending') AND contact_started_at IS NOT NULL AND completed_at IS NULL)
        OR (phase IN ('completed', 'cancelled') AND completed_at IS NOT NULL))
);

CREATE INDEX llm_gateway_reservations_phase_idx
    ON llm_gateway_reservations(phase, updated_at);

CREATE TABLE llm_gateway_leases (
    reservation_id TEXT PRIMARY KEY NOT NULL REFERENCES quota_reservations(id) ON DELETE RESTRICT,
    learner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    direct_group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    acquired_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    released_at INTEGER,
    CHECK (expires_at > acquired_at),
    CHECK (released_at IS NULL OR released_at >= acquired_at)
);

CREATE INDEX llm_gateway_leases_user_window_idx
    ON llm_gateway_leases(learner_user_id, acquired_at);
CREATE INDEX llm_gateway_leases_group_window_idx
    ON llm_gateway_leases(direct_group_id, acquired_at);
CREATE INDEX llm_gateway_leases_active_idx
    ON llm_gateway_leases(learner_user_id, direct_group_id, expires_at)
    WHERE released_at IS NULL;

CREATE TRIGGER llm_gateway_reservation_identity_immutable
BEFORE UPDATE OF reservation_id, config_fingerprint, conservative_actual_json ON llm_gateway_reservations
BEGIN
    SELECT RAISE(ABORT, 'gateway reservation identity is immutable');
END;

CREATE TRIGGER llm_gateway_reservation_lifecycle
BEFORE UPDATE OF phase ON llm_gateway_reservations
WHEN NOT (
    (OLD.phase = 'reserved' AND NEW.phase IN ('contacting', 'cancelled'))
    OR (OLD.phase = 'contacting' AND NEW.phase IN ('pending', 'completed', 'cancelled'))
    OR (OLD.phase = 'pending' AND NEW.phase = 'completed')
    OR (OLD.phase = NEW.phase)
)
BEGIN
    SELECT RAISE(ABORT, 'invalid gateway reservation lifecycle');
END;
