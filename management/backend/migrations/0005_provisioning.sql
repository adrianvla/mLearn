ALTER TABLE audit_events ADD COLUMN authorized_group_id TEXT REFERENCES groups(id) ON DELETE RESTRICT;
ALTER TABLE audit_events ADD COLUMN request_id TEXT;

CREATE INDEX audit_events_authorized_group_created_idx
    ON audit_events(authorized_group_id, created_at DESC, id DESC);

CREATE TABLE provisioning_imports (
    id TEXT PRIMARY KEY NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    target_group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    result_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE invitations (
    id TEXT PRIMARY KEY NOT NULL,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    invited_email TEXT,
    identity_type TEXT NOT NULL CHECK (identity_type IN ('admin', 'teacher', 'learner')),
    token_hash TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('invitation', 'join_code')),
    expires_at INTEGER NOT NULL,
    max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
    use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'accepted', 'revoked')),
    created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at INTEGER NOT NULL,
    CHECK ((kind = 'invitation' AND invited_email IS NOT NULL AND max_uses = 1)
        OR (kind = 'join_code' AND invited_email IS NULL))
);

CREATE TABLE invitation_capabilities (
    invitation_id TEXT NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
    capability TEXT NOT NULL,
    PRIMARY KEY (invitation_id, capability)
);

CREATE TABLE api_keys (
    id TEXT PRIMARY KEY NOT NULL,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    name TEXT,
    secret_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    expires_at INTEGER,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
);

CREATE TABLE api_key_capabilities (
    api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    capability TEXT NOT NULL,
    PRIMARY KEY (api_key_id, capability)
);

CREATE INDEX api_keys_group_id_idx ON api_keys(group_id);
CREATE INDEX invitations_group_id_idx ON invitations(group_id);

CREATE TRIGGER audit_events_immutable_update
BEFORE UPDATE ON audit_events
BEGIN
    SELECT RAISE(ABORT, 'audit events are immutable');
END;

CREATE TRIGGER audit_events_immutable_delete
BEFORE DELETE ON audit_events
BEGIN
    SELECT RAISE(ABORT, 'audit events are immutable');
END;
