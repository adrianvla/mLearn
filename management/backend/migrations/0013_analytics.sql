CREATE TABLE activity_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    policy_version_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    event_type TEXT NOT NULL CHECK (event_type IN ('activity.started','activity.progressed','activity.completed','activity.stopped')),
    activity_kind TEXT NOT NULL CHECK (activity_kind IN ('idle','reader','video','flashcards')),
    privacy TEXT NOT NULL CHECK (privacy IN ('title-and-progress','progress-only')),
    activity_session_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    occurred_at INTEGER NOT NULL,
    ingested_at INTEGER NOT NULL,
    content_id TEXT,
    language TEXT,
    title TEXT,
    current_page INTEGER,
    total_pages INTEGER,
    current_time_millis INTEGER,
    duration_millis INTEGER,
    UNIQUE(user_id, event_id),
    UNIQUE(user_id, activity_session_id, sequence),
    CHECK (privacy != 'progress-only' OR title IS NULL)
);

CREATE TABLE activity_event_ancestry (
    event_row_id INTEGER NOT NULL REFERENCES activity_events(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    PRIMARY KEY(event_row_id, ordinal),
    UNIQUE(event_row_id, group_id)
);

CREATE INDEX activity_events_user_time_idx ON activity_events(user_id, occurred_at DESC, id DESC);
CREATE INDEX activity_events_group_time_idx ON activity_events(group_id, occurred_at DESC, id DESC);
CREATE INDEX activity_events_session_idx ON activity_events(user_id, activity_session_id, sequence);
CREATE INDEX activity_events_content_time_idx ON activity_events(content_id, occurred_at DESC) WHERE content_id IS NOT NULL;
CREATE INDEX activity_events_kind_time_idx ON activity_events(activity_kind, occurred_at DESC);
CREATE INDEX activity_events_policy_time_idx ON activity_events(policy_version_id, occurred_at DESC);
CREATE INDEX activity_ancestry_group_event_idx ON activity_event_ancestry(group_id, event_row_id);

CREATE TRIGGER activity_events_immutable_update BEFORE UPDATE ON activity_events
BEGIN SELECT RAISE(ABORT, 'activity events are immutable'); END;
CREATE TRIGGER activity_ancestry_immutable_update BEFORE UPDATE ON activity_event_ancestry
BEGIN SELECT RAISE(ABORT, 'activity ancestry is immutable'); END;
