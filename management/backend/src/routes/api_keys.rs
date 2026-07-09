use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

use crate::{
    api_keys::{ApiKeyService, CreatedApiKey},
    authorization::{AuthorizationService, Capability},
    error::AppError,
    identity::Principal,
    state::AppState,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateApiKeyRequest {
    #[serde(default)]
    capabilities: Vec<Capability>,
    expires_at: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiKeySummary {
    id: String,
    group_id: String,
    name: Option<String>,
    capabilities: Vec<String>,
    expires_at: Option<i64>,
    created_at: i64,
}

#[derive(Serialize)]
struct ApiKeysResponse {
    api_keys: Vec<ApiKeySummary>,
}

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/api/groups/{id}/api-keys", get(list_keys).post(create_key))
        .route("/api/groups/{id}/api-keys/{key_id}", delete(revoke_key))
        .with_state(state)
}

async fn create_key(
    State(state): State<AppState>,
    principal: Principal,
    Path(id): Path<String>,
    Json(request): Json<CreateApiKeyRequest>,
) -> Result<(StatusCode, Json<CreatedApiKey>), AppError> {
    let key = ApiKeyService::new(state.db)
        .create(&principal, &id, request.capabilities, request.expires_at)
        .await?;
    Ok((StatusCode::CREATED, Json(key)))
}

async fn list_keys(
    State(state): State<AppState>,
    principal: Principal,
    Path(id): Path<String>,
) -> Result<Json<ApiKeysResponse>, AppError> {
    AuthorizationService::new(state.db.clone())
        .require(&principal, &id, Capability::ApiKeysManage)
        .await?;
    Ok(Json(ApiKeysResponse {
        api_keys: fetch_keys(&state.db, &id).await?,
    }))
}

async fn fetch_keys(pool: &SqlitePool, group_id: &str) -> Result<Vec<ApiKeySummary>, AppError> {
    let rows = sqlx::query("SELECT key.id, key.group_id, key.name, key.expires_at, key.created_at, GROUP_CONCAT(capability.capability) AS capabilities FROM api_keys key LEFT JOIN api_key_capabilities capability ON capability.api_key_id = key.id WHERE key.group_id = ? AND key.status = 'active' GROUP BY key.id ORDER BY key.created_at DESC, key.id DESC")
        .bind(group_id).fetch_all(pool).await.map_err(database_error)?;
    Ok(rows
        .into_iter()
        .map(|row| ApiKeySummary {
            id: row.get("id"),
            group_id: row.get("group_id"),
            name: row.get("name"),
            capabilities: row
                .get::<Option<String>, _>("capabilities")
                .unwrap_or_default()
                .split(',')
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect(),
            expires_at: row.get("expires_at"),
            created_at: row.get("created_at"),
        })
        .collect())
}

async fn revoke_key(
    State(state): State<AppState>,
    principal: Principal,
    Path((id, key_id)): Path<(String, String)>,
) -> Result<StatusCode, AppError> {
    ApiKeyService::new(state.db)
        .revoke(&principal, &id, &key_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

fn database_error(error: sqlx::Error) -> AppError {
    AppError::Internal(format!("database error: {error}"))
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
        api_keys::ApiKeyService, auth::hash_token, config::Config, groups::tests::GroupFixture,
        routes, state::AppState,
    };

    #[tokio::test]
    async fn scoped_key_routes_return_plaintext_once_and_accept_key_authentication() {
        let fixture = GroupFixture::german_tree().await;
        let mut config = Config::from_env();
        config.token_hash = Some(hash_token("route-secret"));
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
        let app: Router = Router::new()
            .merge(super::router(state.clone()))
            .merge(routes::groups::router(state.clone()))
            .with_state(state);

        let created = app
            .clone()
            .oneshot(
                Request::post(format!("/api/groups/{}/api-keys", fixture.german_a))
                    .header(
                        header::AUTHORIZATION,
                        format!("Bearer {}", session.access_token),
                    )
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({"capabilities": ["group.view"]}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(created.status(), StatusCode::CREATED);
        let created: Value =
            serde_json::from_slice(&to_bytes(created.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        let secret = created["secret"].as_str().unwrap();

        let listed = app
            .clone()
            .oneshot(
                Request::get(format!("/api/groups/{}/api-keys", fixture.german_a))
                    .header(
                        header::AUTHORIZATION,
                        format!("Bearer {}", session.access_token),
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let listed: Value =
            serde_json::from_slice(&to_bytes(listed.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert!(listed.to_string().find(secret).is_none());

        let key_request = app
            .clone()
            .oneshot(
                Request::get(format!("/api/groups/{}", fixture.project_1))
                    .header(header::AUTHORIZATION, format!("Bearer {secret}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(key_request.status(), StatusCode::OK);

        let tree = app
            .clone()
            .oneshot(
                Request::get("/api/groups")
                    .header(header::AUTHORIZATION, format!("Bearer {secret}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(tree.status(), StatusCode::OK);
        let tree: Value =
            serde_json::from_slice(&to_bytes(tree.into_body(), usize::MAX).await.unwrap()).unwrap();
        let ids: Vec<_> = tree["groups"]
            .as_array()
            .unwrap()
            .iter()
            .map(|group| group["id"].as_str().unwrap())
            .collect();
        assert!(ids.contains(&fixture.german_a.as_str()));
        assert!(ids.contains(&fixture.project_1.as_str()));
        assert!(!ids.contains(&fixture.german.as_str()));
        assert!(!ids.contains(&fixture.german_b.as_str()));

        let revoked = app
            .oneshot(
                Request::delete(format!(
                    "/api/groups/{}/api-keys/{}",
                    fixture.german_a,
                    created["id"].as_str().unwrap()
                ))
                .header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", session.access_token),
                )
                .body(Body::empty())
                .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(revoked.status(), StatusCode::NO_CONTENT);
        assert!(ApiKeyService::new(fixture.pool)
            .authenticate(secret)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn service_key_cannot_activate_human_session_group() {
        let fixture = GroupFixture::german_tree().await;
        let mut config = Config::from_env();
        config.token_hash = Some(hash_token("activation-route-secret"));
        let docker = bollard::Docker::connect_with_http_defaults().unwrap();
        let state = AppState::new(docker, config, fixture.pool.clone());
        let created = ApiKeyService::new(fixture.pool.clone())
            .create(
                &fixture.german_a_teacher,
                &fixture.german_a,
                vec![crate::authorization::Capability::GroupView],
                None,
            )
            .await
            .unwrap();
        let app: Router = routes::groups::router(state.clone()).with_state(state);
        let audit_before: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_events WHERE action = 'group.activated'",
        )
        .fetch_one(&fixture.pool)
        .await
        .unwrap();

        let response = app
            .oneshot(
                Request::post(format!(
                    "/api/groups/{}/activate",
                    fixture.german_a
                ))
                .header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", created.secret),
                )
                .body(Body::empty())
                .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let audit_after: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_events WHERE action = 'group.activated'",
        )
        .fetch_one(&fixture.pool)
        .await
        .unwrap();
        assert_eq!(audit_before, audit_after);
    }
}
