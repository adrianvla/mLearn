CREATE TABLE console_notification_state (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    fingerprint TEXT NOT NULL,
    read_at INTEGER,
    dismissed_at INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(user_id, fingerprint)
);
