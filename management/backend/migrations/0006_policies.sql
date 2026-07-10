CREATE TABLE policy_drafts (
    group_id TEXT PRIMARY KEY NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    document_json TEXT NOT NULL,
    document_hash TEXT NOT NULL,
    author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_at INTEGER NOT NULL
);

CREATE TABLE policy_versions (
    id TEXT PRIMARY KEY NOT NULL,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    document_json TEXT NOT NULL,
    document_hash TEXT NOT NULL,
    author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    summary TEXT NOT NULL,
    parent_version_ids_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (group_id, id)
);

CREATE INDEX policy_versions_group_created_idx
    ON policy_versions(group_id, created_at DESC, id DESC);

CREATE TABLE active_policies (
    group_id TEXT PRIMARY KEY NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    policy_version_id TEXT NOT NULL UNIQUE REFERENCES policy_versions(id) ON DELETE RESTRICT,
    activated_at INTEGER NOT NULL,
    FOREIGN KEY (group_id, policy_version_id)
        REFERENCES policy_versions(group_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER policy_versions_immutable_update
BEFORE UPDATE ON policy_versions
BEGIN
    SELECT RAISE(ABORT, 'policy versions are immutable');
END;

CREATE TRIGGER policy_versions_immutable_delete
BEFORE DELETE ON policy_versions
BEGIN
    SELECT RAISE(ABORT, 'policy versions are immutable');
END;
