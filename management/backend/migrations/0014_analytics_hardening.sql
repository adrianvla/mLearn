DROP TRIGGER activity_events_immutable_update;
DROP TRIGGER activity_ancestry_immutable_update;

ALTER TABLE activity_events ADD COLUMN ancestry_state TEXT NOT NULL DEFAULT 'building'
  CHECK (ancestry_state IN ('building','finalized'));

CREATE TABLE analytics_ingestion_quarantine (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_row_id INTEGER NOT NULL UNIQUE,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('missing','gapped','invalid_root','missing_group','broken_parent','wrong_leaf')),
  quarantined_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX analytics_quarantine_user_time_idx ON analytics_ingestion_quarantine(user_id, quarantined_at DESC);
CREATE INDEX analytics_quarantine_group_time_idx ON analytics_ingestion_quarantine(group_id, quarantined_at DESC);
CREATE TRIGGER analytics_quarantine_immutable_update BEFORE UPDATE ON analytics_ingestion_quarantine
BEGIN SELECT RAISE(ABORT, 'analytics quarantine is immutable'); END;
CREATE TRIGGER analytics_quarantine_immutable_delete BEFORE DELETE ON analytics_ingestion_quarantine
BEGIN SELECT RAISE(ABORT, 'analytics quarantine is immutable'); END;

INSERT INTO analytics_ingestion_quarantine(event_row_id,event_id,user_id,group_id,occurred_at,reason)
SELECT e.id,e.event_id,e.user_id,e.group_id,e.occurred_at,
  CASE
    WHEN (SELECT COUNT(*) FROM activity_event_ancestry a WHERE a.event_row_id=e.id)=0 THEN 'missing'
    WHEN (SELECT MIN(ordinal) FROM activity_event_ancestry a WHERE a.event_row_id=e.id)!=0
      OR (SELECT MAX(ordinal)+1 FROM activity_event_ancestry a WHERE a.event_row_id=e.id)!=(SELECT COUNT(*) FROM activity_event_ancestry a WHERE a.event_row_id=e.id) THEN 'gapped'
    WHEN EXISTS(SELECT 1 FROM activity_event_ancestry a LEFT JOIN groups g ON g.id=a.group_id WHERE a.event_row_id=e.id AND g.id IS NULL) THEN 'missing_group'
    WHEN NOT EXISTS(SELECT 1 FROM activity_event_ancestry a JOIN groups g ON g.id=a.group_id WHERE a.event_row_id=e.id AND a.ordinal=0 AND g.parent_id IS NULL) THEN 'invalid_root'
    WHEN EXISTS(SELECT 1 FROM activity_event_ancestry child JOIN groups cg ON cg.id=child.group_id LEFT JOIN activity_event_ancestry parent ON parent.event_row_id=child.event_row_id AND parent.ordinal=child.ordinal-1 WHERE child.event_row_id=e.id AND child.ordinal>0 AND (parent.group_id IS NULL OR cg.parent_id!=parent.group_id)) THEN 'broken_parent'
    ELSE 'wrong_leaf'
  END
FROM activity_events e
WHERE (SELECT COUNT(*) FROM activity_event_ancestry a WHERE a.event_row_id=e.id)=0
  OR (SELECT MIN(ordinal) FROM activity_event_ancestry a WHERE a.event_row_id=e.id)!=0
  OR (SELECT MAX(ordinal)+1 FROM activity_event_ancestry a WHERE a.event_row_id=e.id)!=(SELECT COUNT(*) FROM activity_event_ancestry a WHERE a.event_row_id=e.id)
  OR EXISTS(SELECT 1 FROM activity_event_ancestry a LEFT JOIN groups g ON g.id=a.group_id WHERE a.event_row_id=e.id AND g.id IS NULL)
  OR NOT EXISTS(SELECT 1 FROM activity_event_ancestry a JOIN groups g ON g.id=a.group_id WHERE a.event_row_id=e.id AND a.ordinal=0 AND g.parent_id IS NULL)
  OR EXISTS(SELECT 1 FROM activity_event_ancestry child JOIN groups cg ON cg.id=child.group_id LEFT JOIN activity_event_ancestry parent ON parent.event_row_id=child.event_row_id AND parent.ordinal=child.ordinal-1 WHERE child.event_row_id=e.id AND child.ordinal>0 AND (parent.group_id IS NULL OR cg.parent_id!=parent.group_id))
  OR (SELECT group_id FROM activity_event_ancestry a WHERE a.event_row_id=e.id ORDER BY ordinal DESC LIMIT 1)!=e.group_id;

DELETE FROM activity_events WHERE id IN (SELECT event_row_id FROM analytics_ingestion_quarantine);
UPDATE activity_events SET occurred_at=occurred_at*1000, ancestry_state='finalized';

CREATE TRIGGER activity_events_safe_sequence_insert BEFORE INSERT ON activity_events
WHEN NEW.sequence < 1 OR NEW.sequence > 9007199254740991
BEGIN SELECT RAISE(ABORT, 'activity sequence must be a positive safe integer'); END;

CREATE TRIGGER activity_events_immutable_update BEFORE UPDATE ON activity_events
WHEN OLD.ancestry_state = 'finalized' OR NEW.ancestry_state != 'finalized'
  OR OLD.event_id != NEW.event_id OR OLD.user_id != NEW.user_id OR OLD.group_id != NEW.group_id
  OR OLD.policy_version_id != NEW.policy_version_id OR OLD.payload_hash != NEW.payload_hash
  OR OLD.schema_version != NEW.schema_version OR OLD.event_type != NEW.event_type
  OR OLD.activity_kind != NEW.activity_kind OR OLD.privacy != NEW.privacy
  OR OLD.activity_session_id != NEW.activity_session_id OR OLD.source_id != NEW.source_id
  OR OLD.sequence != NEW.sequence OR OLD.occurred_at != NEW.occurred_at OR OLD.ingested_at != NEW.ingested_at
  OR OLD.content_id IS NOT NEW.content_id OR OLD.language IS NOT NEW.language OR OLD.title IS NOT NEW.title
  OR OLD.current_page IS NOT NEW.current_page OR OLD.total_pages IS NOT NEW.total_pages
  OR OLD.current_time_millis IS NOT NEW.current_time_millis OR OLD.duration_millis IS NOT NEW.duration_millis
BEGIN SELECT RAISE(ABORT, 'activity events are immutable'); END;

CREATE TRIGGER activity_events_finalize_ancestry BEFORE UPDATE OF ancestry_state ON activity_events
WHEN NEW.ancestry_state = 'finalized' AND (
  NOT EXISTS (SELECT 1 FROM activity_event_ancestry a JOIN groups g ON g.id=a.group_id WHERE a.event_row_id=OLD.id AND a.ordinal=0 AND g.parent_id IS NULL AND g.status='active')
  OR (SELECT COUNT(*) FROM activity_event_ancestry WHERE event_row_id=OLD.id) = 0
  OR (SELECT MAX(ordinal)+1 FROM activity_event_ancestry WHERE event_row_id=OLD.id) != (SELECT COUNT(*) FROM activity_event_ancestry WHERE event_row_id=OLD.id)
  OR (SELECT group_id FROM activity_event_ancestry WHERE event_row_id=OLD.id ORDER BY ordinal DESC LIMIT 1) != OLD.group_id
  OR EXISTS (SELECT 1 FROM activity_event_ancestry child JOIN groups cg ON cg.id=child.group_id LEFT JOIN activity_event_ancestry parent ON parent.event_row_id=child.event_row_id AND parent.ordinal=child.ordinal-1 WHERE child.event_row_id=OLD.id AND (cg.status!='active' OR (child.ordinal>0 AND (parent.group_id IS NULL OR cg.parent_id!=parent.group_id))))
)
BEGIN SELECT RAISE(ABORT, 'invalid activity ancestry'); END;

CREATE TRIGGER activity_ancestry_immutable_insert BEFORE INSERT ON activity_event_ancestry
WHEN (SELECT ancestry_state FROM activity_events WHERE id=NEW.event_row_id) != 'building'
BEGIN SELECT RAISE(ABORT, 'activity ancestry is immutable'); END;
CREATE TRIGGER activity_ancestry_immutable_update BEFORE UPDATE ON activity_event_ancestry
WHEN OLD.event_row_id != NEW.event_row_id
  OR (SELECT ancestry_state FROM activity_events WHERE id=OLD.event_row_id) = 'finalized'
  OR (SELECT ancestry_state FROM activity_events WHERE id=NEW.event_row_id) = 'finalized'
BEGIN SELECT RAISE(ABORT, 'activity ancestry is immutable'); END;
CREATE TRIGGER activity_ancestry_immutable_delete BEFORE DELETE ON activity_event_ancestry
WHEN EXISTS (SELECT 1 FROM activity_events WHERE id=OLD.event_row_id AND ancestry_state='finalized')
BEGIN SELECT RAISE(ABORT, 'activity ancestry is immutable'); END;
