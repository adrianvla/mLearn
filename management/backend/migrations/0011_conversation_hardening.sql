ALTER TABLE llm_requests ADD COLUMN policy_compiled_hash TEXT;
ALTER TABLE llm_requests ADD COLUMN policy_blocked INTEGER NOT NULL DEFAULT 0 CHECK (policy_blocked IN (0,1));
ALTER TABLE conversation_messages ADD COLUMN redacted_at INTEGER;

CREATE INDEX conversations_retention_idx ON conversations(retained_until, id);
CREATE INDEX conversation_messages_retained_idx ON conversation_messages(conversation_id, retained) WHERE retained = 1;
CREATE INDEX llm_requests_policy_block_idx ON llm_requests(policy_blocked, created_at DESC, id DESC);

CREATE TABLE llm_policy_block_events (
    id TEXT PRIMARY KEY NOT NULL,
    owner_group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    learner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    policy_version_id TEXT NOT NULL,
    policy_compiled_hash TEXT NOT NULL,
    error_code TEXT NOT NULL CHECK (error_code = 'policy_denied'),
    created_at INTEGER NOT NULL
);
CREATE INDEX llm_policy_block_events_scope_idx ON llm_policy_block_events(owner_group_id,created_at DESC,id DESC);
CREATE TRIGGER llm_policy_block_events_immutable_update BEFORE UPDATE ON llm_policy_block_events BEGIN SELECT RAISE(ABORT,'policy block history is immutable'); END;
CREATE TRIGGER llm_policy_block_events_immutable_delete BEFORE DELETE ON llm_policy_block_events BEGIN SELECT RAISE(ABORT,'policy block history is immutable'); END;

DROP TRIGGER llm_requests_identity_immutable;
CREATE TRIGGER llm_requests_identity_immutable
BEFORE UPDATE OF id,conversation_id,reservation_id,provider_id,model_id,price_version_id,policy_version_id,policy_compiled_hash,policy_blocked,created_at ON llm_requests
BEGIN SELECT RAISE(ABORT, 'conversation request identity is immutable'); END;

CREATE TRIGGER llm_requests_terminal_immutable
BEFORE UPDATE OF usage_quality,input_tokens,output_tokens,cost_micros,latency_ms,error_code,completed_at ON llm_requests
WHEN OLD.status != 'pending'
BEGIN SELECT RAISE(ABORT, 'terminal conversation accounting is immutable'); END;

DROP TRIGGER conversations_identity_immutable;
CREATE TRIGGER conversations_identity_immutable
BEFORE UPDATE OF id,owner_group_id,learner_user_id,created_at,retained_until ON conversations
BEGIN SELECT RAISE(ABORT, 'conversation ownership and retention are immutable'); END;

CREATE TRIGGER conversations_terminal_immutable
BEFORE UPDATE OF updated_at ON conversations
WHEN OLD.status != 'pending'
BEGIN SELECT RAISE(ABORT, 'terminal conversation history is immutable'); END;

DROP TRIGGER conversation_messages_ciphertext_lifecycle;
CREATE TRIGGER conversation_messages_ciphertext_lifecycle
BEFORE UPDATE OF encrypted_content,encrypted_tool_data,retained,redacted_at ON conversation_messages
WHEN NOT (OLD.retained=1 AND NEW.retained=0 AND NEW.encrypted_content IS NULL AND NEW.encrypted_tool_data IS NULL AND NEW.redacted_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'message ciphertext is immutable except retention redaction'); END;
