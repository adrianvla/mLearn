use std::{future::Future, net::SocketAddr, pin::Pin, sync::Arc};

use crate::{
    authorization::Capability,
    crypto::SecretCipher,
    groups::tests::GroupFixture,
    identity::{IdentityType, Principal},
    policy::PolicyService,
};

use super::{
    validate_base_url, validate_price, EndpointResolver, LlmConfigurationService, ProviderKind,
};

struct FixedResolver(Vec<SocketAddr>);

impl EndpointResolver for FixedResolver {
    fn resolve<'a>(
        &'a self,
        _host: &'a str,
        _port: u16,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<SocketAddr>, crate::error::AppError>> + Send + 'a>>
    {
        let targets = self.0.clone();
        Box::pin(async move { Ok(targets) })
    }
}

#[test]
fn provider_urls_fail_closed_against_ssrf_targets() {
    for url in [
        "http://example.com/v1",
        "https://localhost/v1",
        "https://127.0.0.1/v1",
        "https://169.254.169.254/latest/meta-data",
        "https://user:password@example.com/v1",
    ] {
        assert!(
            validate_base_url(ProviderKind::OpenAiCompatible, url).is_err(),
            "{url}"
        );
    }
    assert!(validate_base_url(ProviderKind::OpenAiCompatible, "https://api.openai.com/v1").is_ok());
    assert!(validate_base_url(ProviderKind::Ollama, "http://ollama:11434").is_ok());
}

#[test]
fn prices_require_exact_currency_unit_and_safe_nonnegative_integers() {
    assert!(validate_price(
        "USD",
        "perMillionTokens",
        0,
        9_007_199_254_740_991,
        "request"
    )
    .is_ok());
    for invalid in [
        validate_price("usd", "perMillionTokens", 1, 1, "request"),
        validate_price("USD", "tokens", 1, 1, "request"),
        validate_price("USD", "perMillionTokens", -1, 1, "request"),
        validate_price("USD", "perMillionTokens", 1, 1, ""),
    ] {
        assert!(invalid.is_err());
    }
}

#[test]
fn associated_data_contains_entity_identity_and_purpose() {
    assert_ne!(
        super::provider_secret_aad("one"),
        super::provider_secret_aad("two")
    );
    assert!(String::from_utf8(super::provider_secret_aad("one"))
        .unwrap()
        .starts_with("mlearn:llm-provider-secret:v1:"));
}

async fn fixture_service() -> (GroupFixture, LlmConfigurationService) {
    let fixture = GroupFixture::german_tree().await;
    sqlx::query("INSERT INTO membership_capabilities (membership_id, capability) VALUES ('membership-a', ?), ('membership-other', ?)")
            .bind(Capability::LlmConfigure.as_str())
            .bind(Capability::LlmConfigure.as_str())
            .execute(&fixture.pool)
            .await
            .unwrap();
    let service =
        LlmConfigurationService::new(fixture.pool.clone(), SecretCipher::from_key([33_u8; 32]));
    (fixture, service)
}

async fn parent_actor(fixture: &GroupFixture) -> Principal {
    let principal = Principal {
        user_id: "teacher-parent".into(),
        service_key_id: None,
        session_id: "session-parent".into(),
        device_id: "device-parent".into(),
        active_group_id: Some(fixture.german.clone()),
        identity_type: IdentityType::Teacher,
        is_root: false,
    };
    sqlx::query("INSERT INTO users (id, email, normalized_email, display_name, status, identity_type, is_root, created_at, updated_at) VALUES (?, 'parent@test.invalid', 'parent@test.invalid', 'Parent', 'active', 'teacher', 0, 1, 1)")
            .bind(&principal.user_id).execute(&fixture.pool).await.unwrap();
    sqlx::query("INSERT INTO group_memberships (id, group_id, user_id, status, created_at) VALUES ('membership-parent', ?, ?, 'active', 1)")
            .bind(&fixture.german).bind(&principal.user_id).execute(&fixture.pool).await.unwrap();
    for capability in [
        Capability::LlmConfigure,
        Capability::PoliciesEdit,
        Capability::PoliciesPublish,
    ] {
        sqlx::query("INSERT INTO membership_capabilities (membership_id, capability) VALUES ('membership-parent', ?)")
                .bind(capability.as_str()).execute(&fixture.pool).await.unwrap();
    }
    principal
}

#[tokio::test]
async fn descendant_list_does_not_disclose_parent_configuration() {
    let (fixture, service) = fixture_service().await;
    let parent = parent_actor(&fixture).await;
    let provider = service
        .create_provider(
            &parent,
            &fixture.german,
            "Hidden parent",
            ProviderKind::OpenAiCompatible,
            "https://api.openai.com/v1",
            None,
            "hidden-parent-provider",
        )
        .await
        .unwrap();
    let model = service
        .create_model(
            &parent,
            &fixture.german,
            &provider.id,
            "hidden-model",
            "hidden-upstream",
            "hidden-parent-model",
        )
        .await
        .unwrap();
    service
        .create_prompt_profile(
            &parent,
            &fixture.german,
            "Hidden prompt",
            "Do not disclose",
            "hidden-parent-prompt",
        )
        .await
        .unwrap();
    service
        .create_price_version(
            &parent,
            &fixture.german,
            &provider.id,
            Some(&model.id),
            "USD",
            "perMillionTokens",
            1,
            2,
            "parent-price",
        )
        .await
        .unwrap();

    let visible = service
        .list_providers(&fixture.german_a_teacher, &fixture.german_a)
        .await
        .unwrap();
    assert!(visible.is_empty());
    assert!(service
        .list_models(&fixture.german_a_teacher, &fixture.german_a)
        .await
        .unwrap()
        .is_empty());
    assert!(service
        .list_prompt_profiles(&fixture.german_a_teacher, &fixture.german_a)
        .await
        .unwrap()
        .is_empty());
    assert!(service
        .list_price_versions(&fixture.german_a_teacher, &fixture.german_a, None, 50)
        .await
        .unwrap()
        .0
        .is_empty());
}

#[tokio::test]
async fn explicit_empty_effective_allowlists_deny_route_resolution() {
    let (fixture, service) = fixture_service().await;
    for capability in [Capability::PoliciesEdit, Capability::PoliciesPublish] {
        sqlx::query("INSERT INTO membership_capabilities (membership_id, capability) VALUES ('membership-a', ?)")
                .bind(capability.as_str()).execute(&fixture.pool).await.unwrap();
    }
    let provider = service
        .create_provider(
            &fixture.german_a_teacher,
            &fixture.german_a,
            "Provider",
            ProviderKind::OpenAiCompatible,
            "https://api.openai.com/v1",
            None,
            "empty-provider",
        )
        .await
        .unwrap();
    service
        .create_model(
            &fixture.german_a_teacher,
            &fixture.german_a,
            &provider.id,
            "balanced",
            "upstream-model",
            "empty-model",
        )
        .await
        .unwrap();
    service
        .create_price_version(
            &fixture.german_a_teacher,
            &fixture.german_a,
            &provider.id,
            None,
            "USD",
            "perMillionTokens",
            1,
            1,
            "empty-policy-price",
        )
        .await
        .unwrap();
    let policy = PolicyService::new(fixture.pool.clone());
    policy
        .save_draft(
            &fixture.german_a_teacher,
            &fixture.german_a,
            serde_json::json!({"llm":{"enabled":true,"allowedProviders":[],"allowedModels":[]}}),
        )
        .await
        .unwrap();
    policy
        .publish(
            &fixture.german_a_teacher,
            &fixture.german_a,
            "deny all LLM routes",
        )
        .await
        .unwrap();

    assert!(service
        .resolve_route(&fixture.german_a, None)
        .await
        .is_err());
}

#[tokio::test]
async fn route_resolution_uses_stable_ids_and_pins_only_public_dns_answers() {
    let fixture = GroupFixture::german_tree().await;
    for capability in [
        Capability::LlmConfigure,
        Capability::PoliciesEdit,
        Capability::PoliciesPublish,
    ] {
        sqlx::query("INSERT INTO membership_capabilities (membership_id, capability) VALUES ('membership-a', ?)")
                .bind(capability.as_str()).execute(&fixture.pool).await.unwrap();
    }
    let service = LlmConfigurationService::with_resolver(
        fixture.pool.clone(),
        SecretCipher::from_key([44_u8; 32]),
        Arc::new(FixedResolver(vec!["93.184.216.34:443".parse().unwrap()])),
    );
    let provider = service
        .create_provider(
            &fixture.german_a_teacher,
            &fixture.german_a,
            "Stable provider",
            ProviderKind::OpenAiCompatible,
            "https://example.com/v1",
            None,
            "stable-provider",
        )
        .await
        .unwrap();
    let model = service
        .create_model(
            &fixture.german_a_teacher,
            &fixture.german_a,
            &provider.id,
            "display-key",
            "upstream-name",
            "stable-model",
        )
        .await
        .unwrap();
    let price = service
        .create_price_version(
            &fixture.german_a_teacher,
            &fixture.german_a,
            &provider.id,
            Some(&model.id),
            "USD",
            "perMillionTokens",
            3,
            4,
            "stable-price",
        )
        .await
        .unwrap();
    let policy = PolicyService::new(fixture.pool.clone());
    policy.save_draft(&fixture.german_a_teacher, &fixture.german_a, serde_json::json!({"llm":{"enabled":true,"allowedProviders":[provider.id],"allowedModels":[model.id]}})).await.unwrap();
    policy
        .publish(
            &fixture.german_a_teacher,
            &fixture.german_a,
            "stable route IDs",
        )
        .await
        .unwrap();

    let route = service
        .resolve_route(&fixture.german_a, None)
        .await
        .unwrap();
    assert_eq!(route.provider_id, provider.id);
    assert_eq!(route.model, "upstream-name");
    assert_eq!(route.price_version.id, price.id);
    let request = route
        .endpoint
        .request(reqwest::Method::POST, "chat/completions")
        .unwrap()
        .build()
        .unwrap();
    assert_eq!(request.url().host_str(), Some("example.com"));
    let rebinding = LlmConfigurationService::with_resolver(
        fixture.pool.clone(),
        SecretCipher::from_key([44_u8; 32]),
        Arc::new(FixedResolver(vec!["127.0.0.1:443".parse().unwrap()])),
    );
    assert!(rebinding
        .resolve_route(&fixture.german_a, None)
        .await
        .is_err());

    service
        .update_model(
            &fixture.german_a_teacher,
            &model.id,
            "display-key",
            "upstream-name",
            "disabled",
            "stable-model-disable",
        )
        .await
        .unwrap();
    assert!(service
        .resolve_route(&fixture.german_a, None)
        .await
        .is_err());
    service
        .update_model(
            &fixture.german_a_teacher,
            &model.id,
            "display-key",
            "upstream-name",
            "active",
            "stable-model-enable",
        )
        .await
        .unwrap();

    let child_prompt = service
        .create_prompt_profile(
            &fixture.german_a_teacher,
            &fixture.project_1,
            "Nested prompt",
            "Nested only",
            "nested-prompt",
        )
        .await
        .unwrap();
    policy.save_draft(&fixture.german_a_teacher, &fixture.german_a, serde_json::json!({"llm":{"enabled":true,"allowedProviders":[provider.id],"allowedModels":[model.id],"promptProfileId":child_prompt.id}})).await.unwrap();
    policy
        .publish(
            &fixture.german_a_teacher,
            &fixture.german_a,
            "invalid downward prompt reference",
        )
        .await
        .unwrap();
    assert!(service
        .resolve_route(&fixture.german_a, None)
        .await
        .is_err());

    policy.save_draft(&fixture.german_a_teacher, &fixture.german_a, serde_json::json!({"llm":{"enabled":true,"allowedProviders":["Stable provider"],"allowedModels":["display-key"]}})).await.unwrap();
    policy
        .publish(
            &fixture.german_a_teacher,
            &fixture.german_a,
            "aliases must not authorize",
        )
        .await
        .unwrap();
    assert!(service
        .resolve_route(&fixture.german_a, None)
        .await
        .is_err());
}

#[tokio::test]
async fn disjoint_parent_and_child_stable_allowlists_deny_all_routes() {
    let fixture = GroupFixture::german_tree().await;
    for capability in [
        Capability::LlmConfigure,
        Capability::PoliciesEdit,
        Capability::PoliciesPublish,
    ] {
        sqlx::query("INSERT INTO membership_capabilities (membership_id, capability) VALUES ('membership-a', ?)")
                .bind(capability.as_str()).execute(&fixture.pool).await.unwrap();
    }
    let parent = parent_actor(&fixture).await;
    let service = LlmConfigurationService::with_resolver(
        fixture.pool.clone(),
        SecretCipher::from_key([55_u8; 32]),
        Arc::new(FixedResolver(vec!["93.184.216.34:443".parse().unwrap()])),
    );
    let parent_provider = service
        .create_provider(
            &parent,
            &fixture.german,
            "Shared name",
            ProviderKind::OpenAiCompatible,
            "https://example.com/v1",
            None,
            "parent-provider",
        )
        .await
        .unwrap();
    let parent_model = service
        .create_model(
            &parent,
            &fixture.german,
            &parent_provider.id,
            "same-key",
            "parent-upstream",
            "parent-model",
        )
        .await
        .unwrap();
    service
        .create_price_version(
            &parent,
            &fixture.german,
            &parent_provider.id,
            Some(&parent_model.id),
            "USD",
            "perMillionTokens",
            1,
            1,
            "parent-price-disjoint",
        )
        .await
        .unwrap();
    let child_provider = service
        .create_provider(
            &fixture.german_a_teacher,
            &fixture.german_a,
            "Shared name",
            ProviderKind::OpenAiCompatible,
            "https://example.com/v1",
            None,
            "child-provider",
        )
        .await
        .unwrap();
    let child_model = service
        .create_model(
            &fixture.german_a_teacher,
            &fixture.german_a,
            &child_provider.id,
            "same-key",
            "child-upstream",
            "child-model",
        )
        .await
        .unwrap();
    service
        .create_price_version(
            &fixture.german_a_teacher,
            &fixture.german_a,
            &child_provider.id,
            Some(&child_model.id),
            "USD",
            "perMillionTokens",
            1,
            1,
            "child-price-disjoint",
        )
        .await
        .unwrap();
    let policy = PolicyService::new(fixture.pool.clone());
    policy.save_draft(&parent, &fixture.german, serde_json::json!({"llm":{"enabled":true,"allowedProviders":[parent_provider.id],"allowedModels":[parent_model.id]}})).await.unwrap();
    policy
        .publish(&parent, &fixture.german, "parent stable IDs")
        .await
        .unwrap();
    service
        .update_provider_metadata(
            &parent,
            &parent_provider.id,
            "Shared name",
            ProviderKind::OpenAiCompatible,
            "https://example.com/v1",
            "disabled",
            "disable-parent-shadow-test",
        )
        .await
        .unwrap();
    assert!(service
        .resolve_route(&fixture.german_a, None)
        .await
        .is_err());
    service
        .update_provider_metadata(
            &parent,
            &parent_provider.id,
            "Shared name",
            ProviderKind::OpenAiCompatible,
            "https://example.com/v1",
            "active",
            "enable-parent-shadow-test",
        )
        .await
        .unwrap();
    policy.save_draft(&fixture.german_a_teacher, &fixture.german_a, serde_json::json!({"llm":{"allowedProviders":[child_provider.id],"allowedModels":[child_model.id]}})).await.unwrap();
    policy
        .publish(
            &fixture.german_a_teacher,
            &fixture.german_a,
            "disjoint child IDs",
        )
        .await
        .unwrap();

    assert!(service
        .resolve_route(&fixture.german_a, None)
        .await
        .is_err());
}

#[tokio::test]
async fn lifecycle_mutations_are_idempotent_audited_and_preserve_identity() {
    let (fixture, service) = fixture_service().await;
    let provider = service
        .create_provider(
            &fixture.german_a_teacher,
            &fixture.german_a,
            "Provider",
            ProviderKind::OpenAiCompatible,
            "https://api.openai.com/v1",
            Some("secret"),
            "provider-create",
        )
        .await
        .unwrap();
    let replay = service
        .create_provider(
            &fixture.german_a_teacher,
            &fixture.german_a,
            "Provider",
            ProviderKind::OpenAiCompatible,
            "https://api.openai.com/v1",
            Some("secret"),
            "provider-create",
        )
        .await
        .unwrap();
    assert_eq!(provider.id, replay.id);
    let stored_fingerprint: Vec<u8> = sqlx::query_scalar("SELECT payload_hash FROM llm_configuration_mutations WHERE group_id = ? AND operation = 'provider.create' AND idempotency_key = 'provider-create'")
            .bind(&fixture.german_a).fetch_one(&fixture.pool).await.unwrap();
    let public_candidate = super::mutation_payload_hash(&[
        &fixture.german_a,
        "Provider",
        "openaiCompatible",
        "https://api.openai.com/v1",
        "secret",
    ]);
    assert_ne!(stored_fingerprint, public_candidate);
    let wrong_deployment_key =
        LlmConfigurationService::new(fixture.pool.clone(), SecretCipher::from_key([99_u8; 32]));
    assert!(wrong_deployment_key
        .create_provider(
            &fixture.german_a_teacher,
            &fixture.german_a,
            "Provider",
            ProviderKind::OpenAiCompatible,
            "https://api.openai.com/v1",
            Some("secret"),
            "provider-create"
        )
        .await
        .is_err());
    assert!(service
        .create_provider(
            &fixture.german_a_teacher,
            &fixture.german_a,
            "Different",
            ProviderKind::OpenAiCompatible,
            "https://api.openai.com/v1",
            Some("secret"),
            "provider-create"
        )
        .await
        .is_err());

    let disabled = service
        .update_provider_metadata(
            &fixture.german_a_teacher,
            &provider.id,
            "Renamed",
            ProviderKind::OpenAiCompatible,
            "https://api.openai.com/v1",
            "disabled",
            "provider-create",
        )
        .await
        .unwrap();
    assert_eq!(disabled.status, "disabled");
    let disabled_replay = service
        .update_provider_metadata(
            &fixture.german_a_teacher,
            &provider.id,
            "Renamed",
            ProviderKind::OpenAiCompatible,
            "https://api.openai.com/v1",
            "disabled",
            "provider-create",
        )
        .await
        .unwrap();
    assert_eq!(disabled, disabled_replay);
    service
        .update_provider_secret(
            &fixture.german_a_teacher,
            &provider.id,
            Some("rotated"),
            "provider-secret",
        )
        .await
        .unwrap();
    service
        .update_provider_secret(
            &fixture.german_a_teacher,
            &provider.id,
            Some("rotated"),
            "provider-secret",
        )
        .await
        .unwrap();
    let stored_secret_fingerprint: Vec<u8> = sqlx::query_scalar("SELECT payload_hash FROM llm_configuration_mutations WHERE group_id = ? AND operation = 'provider.secret' AND idempotency_key = 'provider-secret'")
        .bind(&fixture.german_a).fetch_one(&fixture.pool).await.unwrap();
    assert_ne!(
        stored_secret_fingerprint,
        super::mutation_payload_hash(&[&provider.id, "rotated"])
    );
    assert!(wrong_deployment_key
        .update_provider_secret(
            &fixture.german_a_teacher,
            &provider.id,
            Some("rotated"),
            "provider-secret"
        )
        .await
        .is_err());
    assert!(
        sqlx::query("UPDATE llm_providers SET group_id = ? WHERE id = ?")
            .bind(&fixture.german_b)
            .bind(&provider.id)
            .execute(&fixture.pool)
            .await
            .is_err()
    );

    service
        .update_provider_metadata(
            &fixture.german_a_teacher,
            &provider.id,
            "Renamed",
            ProviderKind::OpenAiCompatible,
            "https://api.openai.com/v1",
            "active",
            "provider-enable",
        )
        .await
        .unwrap();
    let model = service
        .create_model(
            &fixture.german_a_teacher,
            &fixture.german_a,
            &provider.id,
            "model",
            "upstream",
            "model-create",
        )
        .await
        .unwrap();
    assert_eq!(
        service
            .create_model(
                &fixture.german_a_teacher,
                &fixture.german_a,
                &provider.id,
                "model",
                "upstream",
                "model-create"
            )
            .await
            .unwrap()
            .id,
        model.id
    );
    assert_eq!(
        service
            .update_model(
                &fixture.german_a_teacher,
                &model.id,
                "model",
                "upstream-v2",
                "disabled",
                "model-disable"
            )
            .await
            .unwrap()
            .status,
        "disabled"
    );
    assert!(
        sqlx::query("UPDATE llm_models SET provider_id = 'other' WHERE id = ?")
            .bind(&model.id)
            .execute(&fixture.pool)
            .await
            .is_err()
    );

    let prompt = service
        .create_prompt_profile(
            &fixture.german_a_teacher,
            &fixture.german_a,
            "Prompt",
            "Original",
            "prompt-create",
        )
        .await
        .unwrap();
    assert_eq!(
        service
            .create_prompt_profile(
                &fixture.german_a_teacher,
                &fixture.german_a,
                "Prompt",
                "Original",
                "prompt-create"
            )
            .await
            .unwrap()
            .id,
        prompt.id
    );
    assert_eq!(
        service
            .update_prompt_profile(
                &fixture.german_a_teacher,
                &prompt.id,
                "Prompt",
                "Revised",
                "disabled",
                "prompt-disable"
            )
            .await
            .unwrap()
            .status,
        "disabled"
    );
    assert!(
        sqlx::query("UPDATE prompt_profiles SET group_id = ? WHERE id = ?")
            .bind(&fixture.german_b)
            .bind(&prompt.id)
            .execute(&fixture.pool)
            .await
            .is_err()
    );

    let audited: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_events WHERE authorized_group_id = ? AND action LIKE 'llm.%'",
    )
    .bind(&fixture.german_a)
    .fetch_one(&fixture.pool)
    .await
    .unwrap();
    assert_eq!(audited, 8);
}

#[tokio::test]
async fn service_principal_cannot_mutate_llm_configuration() {
    let (fixture, service) = fixture_service().await;
    let mut service_principal = fixture.german_a_teacher.clone();
    service_principal.service_key_id = Some("service-key".into());
    assert!(service
        .create_provider(
            &service_principal,
            &fixture.german_a,
            "Blocked",
            ProviderKind::OpenAiCompatible,
            "https://api.openai.com/v1",
            None,
            "service-create"
        )
        .await
        .is_err());
}

#[tokio::test]
async fn provider_secret_is_encrypted_and_sibling_actor_is_denied() {
    let (fixture, service) = fixture_service().await;
    let provider = service
        .create_provider(
            &fixture.german_a_teacher,
            &fixture.german_a,
            "School OpenAI",
            ProviderKind::OpenAiCompatible,
            "https://api.openai.com/v1",
            Some("plaintext-provider-secret"),
            "secret-provider",
        )
        .await
        .unwrap();
    let stored: String =
        sqlx::query_scalar("SELECT secret_envelope FROM llm_providers WHERE id = ?")
            .bind(&provider.id)
            .fetch_one(&fixture.pool)
            .await
            .unwrap();
    assert!(stored.starts_with("v1."));
    assert!(!stored.contains("plaintext-provider-secret"));
    assert!(service
        .list_providers(&fixture.other_teacher, &fixture.german_a)
        .await
        .is_err());
    let health = service
        .provider_health(&fixture.german_a_teacher, &provider.id)
        .await
        .unwrap();
    assert!(health.configuration_valid);
    assert!(!health.network_check_performed);
}

#[tokio::test]
async fn swapping_provider_ciphertext_fails_entity_authentication() {
    let (fixture, service) = fixture_service().await;
    let mut ids = Vec::new();
    for (name, secret) in [("First", "first-secret"), ("Second", "second-secret")] {
        ids.push(
            service
                .create_provider(
                    &fixture.german_a_teacher,
                    &fixture.german_a,
                    name,
                    ProviderKind::OpenAiCompatible,
                    "https://api.openai.com/v1",
                    Some(secret),
                    name,
                )
                .await
                .unwrap()
                .id,
        );
    }
    let second: String =
        sqlx::query_scalar("SELECT secret_envelope FROM llm_providers WHERE id = ?")
            .bind(&ids[1])
            .fetch_one(&fixture.pool)
            .await
            .unwrap();
    sqlx::query("UPDATE llm_providers SET secret_envelope = ? WHERE id = ?")
        .bind(second)
        .bind(&ids[0])
        .execute(&fixture.pool)
        .await
        .unwrap();
    assert!(service
        .provider_health(&fixture.german_a_teacher, &ids[0])
        .await
        .is_err());
}

#[tokio::test]
async fn price_versions_are_append_only_and_creation_is_payload_idempotent() {
    let (fixture, service) = fixture_service().await;
    let provider = service
        .create_provider(
            &fixture.german_a_teacher,
            &fixture.german_a,
            "Pricing provider",
            ProviderKind::OpenAiCompatible,
            "https://api.openai.com/v1",
            None,
            "pricing-provider",
        )
        .await
        .unwrap();
    let first = service
        .create_price_version(
            &fixture.german_a_teacher,
            &fixture.german_a,
            &provider.id,
            None,
            "USD",
            "perMillionTokens",
            100,
            200,
            "price-request-1",
        )
        .await
        .unwrap();
    let replay = service
        .create_price_version(
            &fixture.german_a_teacher,
            &fixture.german_a,
            &provider.id,
            None,
            "USD",
            "perMillionTokens",
            100,
            200,
            "price-request-1",
        )
        .await
        .unwrap();
    assert_eq!(first, replay);
    assert!(service
        .create_price_version(
            &fixture.german_a_teacher,
            &fixture.german_a,
            &provider.id,
            None,
            "USD",
            "perMillionTokens",
            999,
            200,
            "price-request-1",
        )
        .await
        .is_err());
    assert!(
        sqlx::query("UPDATE provider_price_versions SET input_cost_micros = 0 WHERE id = ?")
            .bind(&first.id)
            .execute(&fixture.pool)
            .await
            .is_err()
    );

    let project_provider = service
        .create_provider(
            &fixture.german_a_teacher,
            &fixture.project_1,
            "Project provider",
            ProviderKind::OpenAiCompatible,
            "https://api.openai.com/v1",
            None,
            "project-provider",
        )
        .await
        .unwrap();
    assert!(service
        .create_price_version(
            &fixture.german_a_teacher,
            &fixture.project_1,
            &project_provider.id,
            None,
            "USD",
            "perMillionTokens",
            7,
            8,
            "price-request-1",
        )
        .await
        .is_ok());

    let model = service
        .create_model(
            &fixture.german_a_teacher,
            &fixture.german_a,
            &provider.id,
            "provider-one-model",
            "upstream-one",
            "provider-one-model",
        )
        .await
        .unwrap();
    let second_provider = service
        .create_provider(
            &fixture.german_a_teacher,
            &fixture.german_a,
            "Second pricing provider",
            ProviderKind::OpenAiCompatible,
            "https://api.openai.com/v1",
            None,
            "second-pricing-provider",
        )
        .await
        .unwrap();
    assert!(sqlx::query("INSERT INTO provider_price_versions (id, group_id, provider_id, model_id, currency, unit, input_cost_micros, output_cost_micros, idempotency_key, created_by_user_id, created_at) VALUES ('mismatched-price', ?, ?, ?, 'USD', 'perMillionTokens', 1, 1, 'mismatched-price', ?, 10)")
            .bind(&fixture.german_a).bind(&second_provider.id).bind(&model.id)
            .bind(&fixture.german_a_teacher.user_id).execute(&fixture.pool).await.is_err());
}
