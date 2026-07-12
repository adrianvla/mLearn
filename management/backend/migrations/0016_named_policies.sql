DROP TRIGGER policy_versions_immutable_update;
DROP TRIGGER policy_versions_immutable_delete;

CREATE TABLE policies (
    id TEXT PRIMARY KEY NOT NULL,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
    description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 1000),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
    priority INTEGER NOT NULL CHECK(priority >= 0),
    created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
    UNIQUE(group_id, name),
    UNIQUE(group_id, priority)
);

ALTER TABLE policy_versions ADD COLUMN policy_id TEXT REFERENCES policies(id) ON DELETE RESTRICT;

INSERT INTO policies(id,group_id,name,description,enabled,priority,created_by_user_id,created_at,updated_at,revision)
SELECT 'legacy-' || legacy.group_id, legacy.group_id, 'Group policy', '', 1, 0,
       legacy.author_user_id, legacy.created_at, legacy.updated_at, 1
FROM (
    SELECT group_id, author_user_id, updated_at AS created_at, updated_at FROM policy_drafts
    UNION ALL
    SELECT group_id, author_user_id, created_at, created_at FROM policy_versions
) legacy
GROUP BY legacy.group_id;

UPDATE policy_versions SET policy_id = 'legacy-' || group_id WHERE policy_id IS NULL;

CREATE TRIGGER policy_versions_immutable_update
BEFORE UPDATE ON policy_versions
BEGIN SELECT RAISE(ABORT, 'policy versions are immutable'); END;

CREATE TRIGGER policy_versions_immutable_delete
BEFORE DELETE ON policy_versions
BEGIN SELECT RAISE(ABORT, 'policy versions are immutable'); END;

CREATE TABLE policy_drafts_named (
    policy_id TEXT PRIMARY KEY NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    document_json TEXT NOT NULL,
    document_hash TEXT NOT NULL,
    author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_at INTEGER NOT NULL
);

INSERT INTO policy_drafts_named(policy_id,group_id,document_json,document_hash,author_user_id,updated_at)
SELECT 'legacy-' || group_id, group_id, document_json, document_hash, author_user_id, updated_at
FROM policy_drafts;

DROP TABLE policy_drafts;
ALTER TABLE policy_drafts_named RENAME TO policy_drafts;

CREATE INDEX policy_drafts_group_updated_idx ON policy_drafts(group_id, updated_at DESC);
CREATE INDEX policy_drafts_policy_updated_idx ON policy_drafts(policy_id, updated_at DESC);
CREATE INDEX policy_versions_policy_created_idx ON policy_versions(policy_id, created_at DESC, id DESC);

CREATE TABLE policy_draft_validations (
    policy_id TEXT PRIMARY KEY NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
    document_hash TEXT NOT NULL,
    validated_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    validated_at INTEGER NOT NULL
);

CREATE TABLE policy_active_versions (
    policy_id TEXT PRIMARY KEY NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
    policy_version_id TEXT NOT NULL UNIQUE REFERENCES policy_versions(id) ON DELETE RESTRICT,
    activated_at INTEGER NOT NULL
);

INSERT INTO policy_active_versions(policy_id,policy_version_id,activated_at)
SELECT version.policy_id, active.policy_version_id, active.activated_at
FROM active_policies active
JOIN policy_versions version ON version.id = active.policy_version_id;

CREATE TABLE policy_set_revisions (
    id TEXT PRIMARY KEY NOT NULL,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    summary TEXT NOT NULL CHECK(length(trim(summary)) > 0),
    created_at INTEGER NOT NULL
);

CREATE TABLE policy_set_revision_entries (
    revision_id TEXT NOT NULL REFERENCES policy_set_revisions(id) ON DELETE RESTRICT,
    policy_id TEXT NOT NULL REFERENCES policies(id) ON DELETE RESTRICT,
    policy_version_id TEXT NOT NULL REFERENCES policy_versions(id) ON DELETE RESTRICT,
    priority INTEGER NOT NULL,
    PRIMARY KEY(revision_id, policy_id),
    UNIQUE(revision_id, priority)
);

INSERT INTO policy_set_revisions(id,group_id,author_user_id,summary,created_at)
SELECT 'legacy-set-' || active.group_id, active.group_id, version.author_user_id,
       'Migrated legacy group policy', active.activated_at
FROM active_policies active
JOIN policy_versions version ON version.id = active.policy_version_id;

INSERT INTO policy_set_revision_entries(revision_id,policy_id,policy_version_id,priority)
SELECT 'legacy-set-' || active.group_id, version.policy_id, active.policy_version_id, 0
FROM active_policies active
JOIN policy_versions version ON version.id = active.policy_version_id;

CREATE INDEX policies_group_priority_idx ON policies(group_id, priority);
CREATE INDEX policy_set_revisions_group_created_idx ON policy_set_revisions(group_id, created_at DESC, id DESC);

CREATE TRIGGER policy_set_revisions_immutable_update
BEFORE UPDATE ON policy_set_revisions
BEGIN SELECT RAISE(ABORT, 'policy set revisions are immutable'); END;

CREATE TRIGGER policy_set_revisions_immutable_delete
BEFORE DELETE ON policy_set_revisions
BEGIN SELECT RAISE(ABORT, 'policy set revisions are immutable'); END;

CREATE TRIGGER policy_set_revision_entries_immutable_update
BEFORE UPDATE ON policy_set_revision_entries
BEGIN SELECT RAISE(ABORT, 'policy set revision entries are immutable'); END;

CREATE TRIGGER policy_set_revision_entries_immutable_delete
BEFORE DELETE ON policy_set_revision_entries
BEGIN SELECT RAISE(ABORT, 'policy set revision entries are immutable'); END;
