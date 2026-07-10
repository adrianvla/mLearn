CREATE TABLE llm_providers (
    id TEXT PRIMARY KEY NOT NULL,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    provider_kind TEXT NOT NULL CHECK (provider_kind IN ('openaiCompatible', 'ollama')),
    base_url TEXT NOT NULL,
    secret_envelope TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (id, group_id),
    UNIQUE (group_id, name)
);

CREATE INDEX llm_providers_group_status_idx ON llm_providers(group_id, status, id);

CREATE TABLE llm_models (
    id TEXT PRIMARY KEY NOT NULL,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    provider_id TEXT NOT NULL,
    model_key TEXT NOT NULL,
    upstream_model TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (id, group_id),
    UNIQUE (group_id, model_key),
    FOREIGN KEY (provider_id, group_id) REFERENCES llm_providers(id, group_id) ON DELETE RESTRICT
);

CREATE INDEX llm_models_group_status_idx ON llm_models(group_id, status, id);

CREATE TABLE prompt_profiles (
    id TEXT PRIMARY KEY NOT NULL,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (id, group_id),
    UNIQUE (group_id, name)
);

CREATE INDEX prompt_profiles_group_status_idx ON prompt_profiles(group_id, status, id);

CREATE TABLE provider_price_versions (
    id TEXT PRIMARY KEY NOT NULL,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    provider_id TEXT NOT NULL,
    model_id TEXT,
    currency TEXT NOT NULL CHECK (length(currency) = 3),
    unit TEXT NOT NULL CHECK (unit = 'perMillionTokens'),
    input_cost_micros INTEGER NOT NULL CHECK (input_cost_micros >= 0 AND input_cost_micros <= 9007199254740991),
    output_cost_micros INTEGER NOT NULL CHECK (output_cost_micros >= 0 AND output_cost_micros <= 9007199254740991),
    idempotency_key TEXT NOT NULL UNIQUE,
    created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (provider_id, group_id) REFERENCES llm_providers(id, group_id) ON DELETE RESTRICT,
    FOREIGN KEY (model_id, group_id) REFERENCES llm_models(id, group_id) ON DELETE RESTRICT
);

CREATE INDEX provider_price_versions_current_idx
    ON provider_price_versions(provider_id, model_id, created_at DESC, id DESC);

CREATE TRIGGER provider_price_versions_immutable_update
BEFORE UPDATE ON provider_price_versions
BEGIN
    SELECT RAISE(ABORT, 'provider price versions are immutable');
END;

CREATE TRIGGER provider_price_versions_immutable_delete
BEFORE DELETE ON provider_price_versions
BEGIN
    SELECT RAISE(ABORT, 'provider price versions are immutable');
END;
