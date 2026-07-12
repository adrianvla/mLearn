CREATE TABLE analytics_daily_totals (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  day_start INTEGER NOT NULL,
  active_learners INTEGER NOT NULL DEFAULT 0 CHECK(active_learners >= 0),
  sessions INTEGER NOT NULL DEFAULT 0 CHECK(sessions >= 0),
  watch_seconds INTEGER NOT NULL DEFAULT 0 CHECK(watch_seconds >= 0),
  completions INTEGER NOT NULL DEFAULT 0 CHECK(completions >= 0),
  reader_pages INTEGER NOT NULL DEFAULT 0 CHECK(reader_pages >= 0),
  flashcard_events INTEGER NOT NULL DEFAULT 0 CHECK(flashcard_events >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(group_id, day_start)
);

CREATE INDEX analytics_daily_totals_group_day_idx
  ON analytics_daily_totals(group_id, day_start);

CREATE TABLE analytics_group_daily_learners (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  day_start INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  PRIMARY KEY(group_id, day_start, user_id)
);

CREATE TABLE analytics_group_daily_sessions (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  day_start INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  activity_session_id TEXT NOT NULL,
  PRIMARY KEY(group_id, day_start, user_id, activity_session_id)
);

CREATE INDEX analytics_group_daily_sessions_bucket_idx
  ON analytics_group_daily_sessions(group_id, day_start);

CREATE TABLE analytics_daily_totals_backfill_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  completed_at INTEGER NOT NULL
);

CREATE TABLE analytics_raw_retention_watermarks (
  group_id TEXT PRIMARY KEY NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  retained_from INTEGER NOT NULL CHECK(retained_from >= 0),
  updated_at INTEGER NOT NULL
);
