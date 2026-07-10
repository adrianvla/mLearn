CREATE TABLE conversations (
    id TEXT PRIMARY KEY NOT NULL,
    owner_group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    learner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    retained_until INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending','completed','failed','truncated'))
);

CREATE TABLE llm_requests (
    id TEXT PRIMARY KEY NOT NULL,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT,
    reservation_id TEXT NOT NULL UNIQUE REFERENCES quota_reservations(id) ON DELETE RESTRICT,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    price_version_id TEXT NOT NULL,
    policy_version_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending','completed','failed','truncated')),
    usage_quality TEXT CHECK (usage_quality IN ('exact','estimated')),
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_micros INTEGER,
    latency_ms INTEGER,
    error_code TEXT,
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    CHECK (input_tokens IS NULL OR input_tokens >= 0),
    CHECK (output_tokens IS NULL OR output_tokens >= 0),
    CHECK (cost_micros IS NULL OR cost_micros >= 0),
    CHECK (latency_ms IS NULL OR latency_ms >= 0)
);

CREATE TABLE conversation_messages (
    id TEXT PRIMARY KEY NOT NULL,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT,
    request_id TEXT NOT NULL REFERENCES llm_requests(id) ON DELETE RESTRICT,
    sequence INTEGER NOT NULL CHECK (sequence >= 0),
    role TEXT NOT NULL CHECK (role IN ('system','user','assistant','tool')),
    encrypted_content TEXT,
    encrypted_tool_data TEXT,
    content_bytes INTEGER NOT NULL DEFAULT 0 CHECK (content_bytes >= 0),
    truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0,1)),
    retained INTEGER NOT NULL DEFAULT 1 CHECK (retained IN (0,1)),
    created_at INTEGER NOT NULL,
    UNIQUE (request_id, sequence),
    CHECK ((retained = 1 AND encrypted_content IS NOT NULL) OR
           (retained = 0 AND encrypted_content IS NULL AND encrypted_tool_data IS NULL))
);

CREATE INDEX conversations_scope_cursor_idx ON conversations(owner_group_id, created_at DESC, id DESC);
CREATE INDEX conversations_learner_cursor_idx ON conversations(learner_user_id, created_at DESC, id DESC);
CREATE INDEX llm_requests_filter_idx ON llm_requests(provider_id, model_id, status, created_at DESC);
CREATE INDEX conversation_messages_request_idx ON conversation_messages(request_id, sequence);

CREATE TRIGGER conversations_identity_immutable
BEFORE UPDATE OF id, owner_group_id, learner_user_id, created_at ON conversations
BEGIN SELECT RAISE(ABORT, 'conversation ownership is immutable'); END;

CREATE TRIGGER llm_requests_identity_immutable
BEFORE UPDATE OF id, conversation_id, reservation_id, provider_id, model_id, price_version_id, policy_version_id, created_at ON llm_requests
BEGIN SELECT RAISE(ABORT, 'conversation request identity is immutable'); END;

CREATE TRIGGER conversation_messages_identity_immutable
BEFORE UPDATE OF id, conversation_id, request_id, sequence, role, content_bytes, truncated, created_at ON conversation_messages
BEGIN SELECT RAISE(ABORT, 'conversation message identity is immutable'); END;

CREATE TRIGGER conversation_messages_no_delete BEFORE DELETE ON conversation_messages
BEGIN SELECT RAISE(ABORT, 'conversation messages use retention redaction'); END;

CREATE TRIGGER conversations_terminal_lifecycle
BEFORE UPDATE OF status ON conversations
WHEN NOT (OLD.status = 'pending' AND NEW.status IN ('completed','failed','truncated')) AND OLD.status != NEW.status
BEGIN SELECT RAISE(ABORT, 'invalid conversation lifecycle'); END;

CREATE TRIGGER llm_requests_terminal_lifecycle
BEFORE UPDATE OF status ON llm_requests
WHEN NOT (OLD.status = 'pending' AND NEW.status IN ('completed','failed','truncated')) AND OLD.status != NEW.status
BEGIN SELECT RAISE(ABORT, 'invalid conversation request lifecycle'); END;

CREATE TRIGGER conversation_messages_ciphertext_lifecycle
BEFORE UPDATE OF encrypted_content, encrypted_tool_data, retained ON conversation_messages
WHEN NOT (OLD.retained = 1 AND NEW.retained = 0 AND NEW.encrypted_content IS NULL AND NEW.encrypted_tool_data IS NULL)
BEGIN SELECT RAISE(ABORT, 'message ciphertext is immutable except retention redaction'); END;
