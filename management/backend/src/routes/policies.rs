use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::Value;

use crate::{
    error::AppError,
    identity::Principal,
    policy::{
        CompiledPolicy, DraftValidation, PolicyDraft, PolicyHistoryPage, PolicyService,
        PolicyVersion,
    },
    state::AppState,
};

#[derive(Deserialize)]
struct PublishRequest {
    summary: String,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryQuery {
    cursor: Option<String>,
    limit: Option<usize>,
}

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route(
            "/api/groups/{group_id}/policy/draft",
            get(get_draft).put(save_draft),
        )
        .route(
            "/api/groups/{group_id}/policy/validate",
            post(validate_draft),
        )
        .route("/api/groups/{group_id}/policy/publish", post(publish))
        .route("/api/groups/{group_id}/policy/history", get(history))
        .route("/api/groups/{group_id}/policy/effective", get(effective))
        .with_state(state)
}

async fn get_draft(
    State(state): State<AppState>,
    principal: Principal,
    Path(group_id): Path<String>,
) -> Result<Json<Option<PolicyDraft>>, AppError> {
    Ok(Json(
        PolicyService::new(state.db)
            .get_draft(&principal, &group_id)
            .await?,
    ))
}

async fn save_draft(
    State(state): State<AppState>,
    principal: Principal,
    Path(group_id): Path<String>,
    Json(document): Json<Value>,
) -> Result<Json<PolicyDraft>, AppError> {
    Ok(Json(
        PolicyService::new(state.db)
            .save_draft(&principal, &group_id, document)
            .await?,
    ))
}

async fn validate_draft(
    State(state): State<AppState>,
    principal: Principal,
    Path(group_id): Path<String>,
) -> Result<Json<DraftValidation>, AppError> {
    Ok(Json(
        PolicyService::new(state.db)
            .validate_draft(&principal, &group_id)
            .await?,
    ))
}

async fn publish(
    State(state): State<AppState>,
    principal: Principal,
    Path(group_id): Path<String>,
    Json(request): Json<PublishRequest>,
) -> Result<Json<PolicyVersion>, AppError> {
    Ok(Json(
        PolicyService::new(state.db)
            .publish(&principal, &group_id, &request.summary)
            .await?,
    ))
}

async fn history(
    State(state): State<AppState>,
    principal: Principal,
    Path(group_id): Path<String>,
    Query(query): Query<HistoryQuery>,
) -> Result<Json<PolicyHistoryPage>, AppError> {
    Ok(Json(
        PolicyService::new(state.db)
            .history(
                &principal,
                &group_id,
                query.cursor.as_deref(),
                query.limit.unwrap_or(50),
            )
            .await?,
    ))
}

async fn effective(
    State(state): State<AppState>,
    principal: Principal,
    Path(group_id): Path<String>,
) -> Result<Json<CompiledPolicy>, AppError> {
    Ok(Json(
        PolicyService::new(state.db)
            .effective_for_group(&principal, &group_id)
            .await?,
    ))
}

#[cfg(test)]
mod tests {
    use axum::{
        body::{to_bytes, Body},
        http::{header, Request, StatusCode},
        Router,
    };
    use serde_json::{json, Value};
    use tower::ServiceExt;

    use crate::{
        api_keys::ApiKeyService, auth::hash_token, authorization::Capability, config::Config,
        groups::tests::GroupFixture, policy::PolicyService, state::AppState,
    };

    async fn policy_app(fixture: &GroupFixture) -> (Router, String) {
        for capability in [
            Capability::PoliciesView,
            Capability::PoliciesEdit,
            Capability::PoliciesPublish,
        ] {
            sqlx::query(
                "INSERT INTO membership_capabilities (membership_id, capability) VALUES ('membership-a', ?)",
            )
            .bind(capability.as_str())
            .execute(&fixture.pool)
            .await
            .unwrap();
        }
        let mut config = Config::from_env();
        config.token_hash = Some(hash_token("policy-route-secret"));
        let docker = bollard::Docker::connect_with_http_defaults().unwrap();
        let state = AppState::new(docker, config, fixture.pool.clone());
        let session = state
            .identity
            .issue_session(
                &fixture.german_a_teacher.user_id,
                None,
                Some(&fixture.german_a),
            )
            .await
            .unwrap();
        (
            super::router(state.clone()).with_state(state),
            session.access_token,
        )
    }

    #[tokio::test]
    async fn unauthorized_sibling_effective_query_returns_forbidden() {
        let fixture = GroupFixture::german_tree().await;
        let (app, token) = policy_app(&fixture).await;

        let response = app
            .oneshot(
                Request::get(format!("/api/groups/{}/policy/effective", fixture.german_b))
                    .header(header::AUTHORIZATION, format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn view_service_key_reads_effective_policy_but_cannot_mutate_draft() {
        let fixture = GroupFixture::german_tree().await;
        let (app, _) = policy_app(&fixture).await;
        let key = ApiKeyService::new(fixture.pool.clone())
            .create(
                &fixture.german_a_teacher,
                &fixture.german_a,
                vec![Capability::PoliciesView],
                None,
            )
            .await
            .unwrap();

        let read = app
            .clone()
            .oneshot(
                Request::get(format!("/api/groups/{}/policy/effective", fixture.german_a))
                    .header(header::AUTHORIZATION, format!("Bearer {}", key.secret))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(read.status(), StatusCode::OK);

        let write = app
            .oneshot(
                Request::put(format!("/api/groups/{}/policy/draft", fixture.german_a))
                    .header(header::AUTHORIZATION, format!("Bearer {}", key.secret))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(json!({"features": {}}).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(write.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn history_route_returns_cursor_page_shape() {
        let fixture = GroupFixture::german_tree().await;
        let (app, token) = policy_app(&fixture).await;
        let service = PolicyService::new(fixture.pool.clone());
        service
            .save_draft(
                &fixture.german_a_teacher,
                &fixture.german_a,
                json!({"features":{"cloud_tts":{"enabled":false}}}),
            )
            .await
            .unwrap();
        for summary in ["first", "second"] {
            service
                .publish(&fixture.german_a_teacher, &fixture.german_a, summary)
                .await
                .unwrap();
        }

        let response = app
            .oneshot(
                Request::get(format!(
                    "/api/groups/{}/policy/history?limit=1",
                    fixture.german_a
                ))
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(body["items"].as_array().unwrap().len(), 1);
        assert!(body["items"][0]["compiledHash"].is_string());
        assert!(body["nextCursor"].is_string());
    }
}
