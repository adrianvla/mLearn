use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
};
use serde_json::{json, Value};
use tower::ServiceExt;

static_assertions::assert_not_impl_any!(super::IncomingSecret: std::fmt::Debug, serde::Serialize, Clone);

use crate::{
    authorization::Capability, config::Config, groups::tests::GroupFixture, state::AppState,
};

#[tokio::test]
async fn provider_routes_expose_only_secret_presence_and_deny_ancestor_access() {
    let fixture = GroupFixture::german_tree().await;
    sqlx::query("INSERT INTO membership_capabilities (membership_id, capability) VALUES ('membership-a', ?), ('membership-other', ?)")
            .bind(Capability::LlmConfigure.as_str())
            .bind(Capability::LlmConfigure.as_str())
            .execute(&fixture.pool)
            .await
            .unwrap();
    let mut config = Config::from_env();
    let signing_path =
        std::env::temp_dir().join(format!("mlearn-llm-route-signing-{}", uuid::Uuid::now_v7()));
    let encryption_path = std::env::temp_dir().join(format!(
        "mlearn-llm-route-encryption-{}",
        uuid::Uuid::now_v7()
    ));
    config.policy_signing_key_path = signing_path.to_string_lossy().into_owned();
    config.encryption_key_path = encryption_path.to_string_lossy().into_owned();
    config.encryption_key = None;
    let docker = bollard::Docker::connect_with_http_defaults().unwrap();
    let state = AppState::new(docker, config, fixture.pool.clone());
    let teacher = state
        .identity
        .issue_session(
            &fixture.german_a_teacher.user_id,
            None,
            Some(&fixture.german_a),
        )
        .await
        .unwrap();
    let other = state
        .identity
        .issue_session(
            &fixture.other_teacher.user_id,
            None,
            Some(&fixture.project_1),
        )
        .await
        .unwrap();
    let app = super::router(state.clone()).with_state(state);

    let response = app
        .clone()
        .oneshot(
            Request::post("/api/llm/providers")
                .header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", teacher.access_token),
                )
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "groupId": fixture.german_a,
                        "name": "School provider",
                        "providerKind": "openaiCompatible",
                        "baseUrl": "https://api.openai.com/v1",
                        "secret": "route-plaintext-secret"
                        ,"idempotencyKey": "route-provider-create"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let text = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(!text.contains("route-plaintext-secret"));
    assert!(!text.contains("secretEnvelope"));
    let body: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(body["hasSecret"], true);
    let provider_id = body["id"].as_str().unwrap();

    let updated = app
        .clone()
        .oneshot(
            Request::put(format!("/api/llm/providers/{provider_id}"))
                .header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", teacher.access_token),
                )
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "name":"Renamed provider","providerKind":"openaiCompatible",
                        "baseUrl":"https://api.openai.com/v1","status":"active",
                        "idempotencyKey":"route-provider-update"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(updated.status(), StatusCode::OK);

    let secret_update = app
        .clone()
        .oneshot(
            Request::put(format!("/api/llm/providers/{provider_id}/secret"))
                .header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", teacher.access_token),
                )
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({"secret":"replacement-secret","idempotencyKey":"route-secret-update"})
                        .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(secret_update.status(), StatusCode::OK);
    let secret_text = String::from_utf8(
        to_bytes(secret_update.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(!secret_text.contains("replacement-secret"));

    let health = app
        .clone()
        .oneshot(
            Request::post(format!("/api/llm/providers/{provider_id}/health"))
                .header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", teacher.access_token),
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(health.status(), StatusCode::OK);

    let model_response = app
        .clone()
        .oneshot(
            Request::post("/api/llm/models")
                .header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", teacher.access_token),
                )
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "groupId":fixture.german_a,"providerId":provider_id,"modelKey":"balanced",
                        "upstreamModel":"school-model","idempotencyKey":"route-model-create"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(model_response.status(), StatusCode::OK);
    let model: Value = serde_json::from_slice(
        &to_bytes(model_response.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let model_id = model["id"].as_str().unwrap();
    let model_update = app.clone().oneshot(
            Request::put(format!("/api/llm/models/{model_id}"))
                .header(header::AUTHORIZATION, format!("Bearer {}", teacher.access_token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({"modelKey":"balanced","upstreamModel":"school-model-v2","status":"active","idempotencyKey":"route-model-update"}).to_string())).unwrap()
        ).await.unwrap();
    assert_eq!(model_update.status(), StatusCode::OK);

    let prompt_response = app.clone().oneshot(
            Request::post("/api/llm/prompt-profiles")
                .header(header::AUTHORIZATION, format!("Bearer {}", teacher.access_token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({"groupId":fixture.german_a,"name":"German tutor","systemPrompt":"Teach German","idempotencyKey":"route-prompt-create"}).to_string())).unwrap()
        ).await.unwrap();
    assert_eq!(prompt_response.status(), StatusCode::OK);
    let prompt: Value = serde_json::from_slice(
        &to_bytes(prompt_response.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let prompt_id = prompt["id"].as_str().unwrap();
    let prompt_update = app.clone().oneshot(
            Request::put(format!("/api/llm/prompt-profiles/{prompt_id}"))
                .header(header::AUTHORIZATION, format!("Bearer {}", teacher.access_token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({"name":"German tutor","systemPrompt":"Teach German carefully","status":"active","idempotencyKey":"route-prompt-update"}).to_string())).unwrap()
        ).await.unwrap();
    assert_eq!(prompt_update.status(), StatusCode::OK);

    let price = app.clone().oneshot(
            Request::post("/api/llm/prices")
                .header(header::AUTHORIZATION, format!("Bearer {}", teacher.access_token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({"groupId":fixture.german_a,"providerId":provider_id,"modelId":model_id,"currency":"USD","unit":"perMillionTokens","inputCostMicros":1,"outputCostMicros":2,"idempotencyKey":"route-price-create"}).to_string())).unwrap()
        ).await.unwrap();
    assert_eq!(price.status(), StatusCode::OK);

    for path in [
        "/api/llm/models",
        "/api/llm/prompt-profiles",
        "/api/llm/prices",
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::get(format!("{path}?groupId={}", fixture.german_a))
                    .header(
                        header::AUTHORIZATION,
                        format!("Bearer {}", teacher.access_token),
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{path}");
    }

    let list = app
        .clone()
        .oneshot(
            Request::get(format!(
                "/api/llm/providers?groupId={}&limit=1",
                fixture.german_a
            ))
            .header(
                header::AUTHORIZATION,
                format!("Bearer {}", teacher.access_token),
            )
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(list.status(), StatusCode::OK);
    let page: Value =
        serde_json::from_slice(&to_bytes(list.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(page["items"].as_array().unwrap().len(), 1);
    assert!(page.get("nextCursor").is_some());

    for path in [
        "/api/llm/providers",
        "/api/llm/models",
        "/api/llm/prompt-profiles",
        "/api/llm/prices",
    ] {
        let denied = app
            .clone()
            .oneshot(
                Request::get(format!("{path}?groupId={}", fixture.german_a))
                    .header(
                        header::AUTHORIZATION,
                        format!("Bearer {}", other.access_token),
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(denied.status(), StatusCode::FORBIDDEN, "{path}");
    }
    std::fs::remove_file(signing_path).unwrap();
    std::fs::remove_file(encryption_path).unwrap();
}
