DROP TRIGGER activity_events_immutable_update;
DROP TRIGGER activity_ancestry_immutable_update;

ALTER TABLE activity_events ADD COLUMN ancestry_state TEXT NOT NULL DEFAULT 'building'
  CHECK (ancestry_state IN ('building','finalized'));

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
WHEN (SELECT ancestry_state FROM activity_events WHERE id=OLD.event_row_id) = 'finalized'
BEGIN SELECT RAISE(ABORT, 'activity ancestry is immutable'); END;
CREATE TRIGGER activity_ancestry_immutable_delete BEFORE DELETE ON activity_event_ancestry
WHEN EXISTS (SELECT 1 FROM activity_events WHERE id=OLD.event_row_id AND ancestry_state='finalized')
BEGIN SELECT RAISE(ABORT, 'activity ancestry is immutable'); END;
