ALTER TABLE activity_events ADD COLUMN retention_days INTEGER NOT NULL DEFAULT 90 CHECK(retention_days BETWEEN 1 AND 90);
ALTER TABLE activity_events ADD COLUMN retained_until INTEGER NOT NULL DEFAULT 0;

UPDATE activity_events SET retained_until = occurred_at + 90 * 86400000 WHERE retained_until = 0;
CREATE TRIGGER activity_events_retention_immutable BEFORE UPDATE OF retention_days,retained_until ON activity_events
BEGIN SELECT RAISE(ABORT, 'activity retention snapshot is immutable'); END;

CREATE INDEX activity_events_retention_idx ON activity_events(retained_until, id);
CREATE INDEX activity_ancestry_group_ordinal_event_idx ON activity_event_ancestry(group_id, ordinal, event_row_id);
DROP TRIGGER activity_ancestry_immutable_delete;
CREATE TABLE analytics_retention_delete_queue(event_row_id INTEGER PRIMARY KEY);
CREATE TRIGGER activity_ancestry_immutable_delete BEFORE DELETE ON activity_event_ancestry
WHEN EXISTS (SELECT 1 FROM activity_events WHERE id=OLD.event_row_id AND ancestry_state='finalized')
 AND NOT EXISTS (SELECT 1 FROM analytics_retention_delete_queue WHERE event_row_id=OLD.event_row_id)
BEGIN SELECT RAISE(ABORT, 'activity ancestry is immutable'); END;

CREATE TABLE analytics_daily_rollups (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  day_start INTEGER NOT NULL,
  activity_kind TEXT NOT NULL CHECK(activity_kind IN ('idle','reader','video','flashcards')),
  content_id TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT '',
  active_learners INTEGER NOT NULL DEFAULT 0 CHECK(active_learners >= 0),
  sessions INTEGER NOT NULL DEFAULT 0 CHECK(sessions >= 0),
  watch_seconds INTEGER NOT NULL DEFAULT 0 CHECK(watch_seconds >= 0),
  completions INTEGER NOT NULL DEFAULT 0 CHECK(completions >= 0),
  reader_pages INTEGER NOT NULL DEFAULT 0 CHECK(reader_pages >= 0),
  flashcard_events INTEGER NOT NULL DEFAULT 0 CHECK(flashcard_events >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(group_id, day_start, activity_kind, content_id, language)
);
CREATE INDEX analytics_rollups_group_day_idx ON analytics_daily_rollups(group_id, day_start);

CREATE TABLE analytics_retention_runs (
  id TEXT PRIMARY KEY,
  root_group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  deleted_events INTEGER NOT NULL CHECK(deleted_events >= 0),
  cutoff_at INTEGER NOT NULL,
  actor_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
