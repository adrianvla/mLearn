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
