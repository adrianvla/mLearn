CREATE TABLE saved_analytics_views (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
    definition_json TEXT NOT NULL CHECK(json_valid(definition_json)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX saved_analytics_views_owner_idx
    ON saved_analytics_views(owner_user_id, updated_at DESC, id DESC);
