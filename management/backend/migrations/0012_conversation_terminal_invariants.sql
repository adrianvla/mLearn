DROP TRIGGER llm_requests_terminal_lifecycle;
DROP TRIGGER conversations_terminal_lifecycle;

CREATE TRIGGER llm_requests_terminal_lifecycle
BEFORE UPDATE OF status ON llm_requests
WHEN OLD.status != NEW.status
BEGIN
    SELECT CASE WHEN OLD.status != 'pending' OR NEW.status NOT IN ('completed','failed','truncated')
        THEN RAISE(ABORT,'invalid conversation request lifecycle') END;
    SELECT CASE WHEN NEW.usage_quality NOT IN ('exact','estimated')
        OR NEW.input_tokens IS NULL OR NEW.input_tokens < 0
        OR NEW.output_tokens IS NULL OR NEW.output_tokens < 0
        OR NEW.cost_micros IS NULL OR NEW.cost_micros < 0
        OR NEW.latency_ms IS NULL OR NEW.latency_ms < 0
        OR NEW.completed_at IS NULL
        OR (NEW.status IN ('completed','truncated') AND NEW.error_code IS NOT NULL)
        OR (NEW.status = 'failed' AND NEW.error_code IS NULL)
        THEN RAISE(ABORT,'terminal conversation request snapshot is incomplete') END;
END;

CREATE TRIGGER llm_requests_terminalize_conversation
AFTER UPDATE OF status ON llm_requests
WHEN OLD.status='pending' AND NEW.status IN ('completed','failed','truncated')
BEGIN
    UPDATE conversations SET status=NEW.status,updated_at=NEW.completed_at
    WHERE id=NEW.conversation_id AND status='pending';
    SELECT CASE WHEN (SELECT status FROM conversations WHERE id=NEW.conversation_id) != NEW.status
        THEN RAISE(ABORT,'conversation terminal state mismatch') END;
END;

CREATE TRIGGER conversations_terminal_lifecycle
BEFORE UPDATE OF status ON conversations
WHEN OLD.status != NEW.status
BEGIN
    SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM llm_requests r WHERE r.conversation_id=OLD.id AND r.status=NEW.status AND r.completed_at=NEW.updated_at)
        THEN RAISE(ABORT,'conversation terminal state requires its request transition') END;
END;
