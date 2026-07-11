CREATE TABLE groups (
    id TEXT PRIMARY KEY NOT NULL,
    parent_id TEXT REFERENCES groups(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('pending', 'active', 'archived')),
    created_at INTEGER NOT NULL,
    archived_at INTEGER
);

CREATE UNIQUE INDEX groups_root_slug_unique
    ON groups(slug) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX groups_sibling_slug_unique
    ON groups(parent_id, slug) WHERE parent_id IS NOT NULL;
CREATE INDEX groups_parent_id_idx ON groups(parent_id);

CREATE TABLE group_memberships (
    id TEXT PRIMARY KEY NOT NULL,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    invited_email TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('invited', 'active', 'archived')),
    created_at INTEGER NOT NULL,
    archived_at INTEGER,
    CHECK (user_id IS NOT NULL OR invited_email IS NOT NULL)
);

CREATE UNIQUE INDEX group_memberships_active_user_unique
    ON group_memberships(group_id, user_id)
    WHERE user_id IS NOT NULL AND status != 'archived';
CREATE UNIQUE INDEX group_memberships_active_invite_unique
    ON group_memberships(group_id, invited_email)
    WHERE invited_email IS NOT NULL AND status = 'invited';
CREATE INDEX group_memberships_user_id_idx ON group_memberships(user_id);
CREATE INDEX group_memberships_group_id_idx ON group_memberships(group_id);

CREATE TABLE membership_capabilities (
    membership_id TEXT NOT NULL REFERENCES group_memberships(id) ON DELETE CASCADE,
    capability TEXT NOT NULL,
    PRIMARY KEY (membership_id, capability)
);

INSERT INTO groups (id, parent_id, name, slug, status, created_at, archived_at)
SELECT 'root-group-' || id, NULL, 'School', 'school', 'active', created_at, NULL
FROM users WHERE is_root = 1;

INSERT INTO group_memberships (id, group_id, user_id, invited_email, status, created_at, archived_at)
SELECT 'root-membership-' || id, 'root-group-' || id, id, NULL, 'active', created_at, NULL
FROM users WHERE is_root = 1;

INSERT INTO membership_capabilities (membership_id, capability)
SELECT 'root-membership-' || users.id, capabilities.capability
FROM users
CROSS JOIN (
    SELECT 'group.view' AS capability UNION ALL SELECT 'group.manage'
    UNION ALL SELECT 'members.view' UNION ALL SELECT 'members.manage'
    UNION ALL SELECT 'permissions.delegate' UNION ALL SELECT 'policies.view'
    UNION ALL SELECT 'policies.edit' UNION ALL SELECT 'policies.publish'
    UNION ALL SELECT 'analytics.view' UNION ALL SELECT 'conversations.view'
    UNION ALL SELECT 'conversations.export' UNION ALL SELECT 'llm.configure'
    UNION ALL SELECT 'api_keys.manage'
) capabilities
WHERE users.is_root = 1;

ALTER TABLE sessions ADD COLUMN active_group_id TEXT REFERENCES groups(id) ON DELETE SET NULL;
