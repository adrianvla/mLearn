CREATE TABLE provider_health_checks (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL REFERENCES llm_providers(id) ON DELETE RESTRICT,
    actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    configuration_valid INTEGER NOT NULL CHECK(configuration_valid IN (0,1)),
    network_check_performed INTEGER NOT NULL CHECK(network_check_performed IN (0,1)),
    outcome TEXT NOT NULL CHECK(outcome IN ('healthy','configuration_error','network_error')),
    created_at INTEGER NOT NULL
);

CREATE INDEX provider_health_checks_provider_time_idx
    ON provider_health_checks(provider_id, created_at DESC, id DESC);
