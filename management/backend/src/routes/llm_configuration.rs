use axum::{
    extract::{Path, Query, State},
    routing::{get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::{
    error::AppError,
    identity::Principal,
    llm::configuration::{
        LlmConfigurationService, LlmModel, LlmProvider, PromptProfile, ProviderHealth,
        ProviderKind, ProviderPriceVersion,
    },
    state::AppState,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PageQuery {
    group_id: String,
    cursor: Option<String>,
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateProviderRequest {
    group_id: String,
    name: String,
    provider_kind: ProviderKind,
    base_url: String,
    secret: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateSecretRequest {
    secret: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateModelRequest {
    group_id: String,
    provider_id: String,
    model_key: String,
    upstream_model: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreatePromptRequest {
    group_id: String,
    name: String,
    system_prompt: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreatePriceRequest {
    group_id: String,
    provider_id: String,
    model_id: Option<String>,
    currency: String,
    unit: String,
    input_cost_micros: i64,
    output_cost_micros: i64,
    idempotency_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ListPage<T> {
    items: Vec<T>,
    next_cursor: Option<String>,
}

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route(
            "/api/llm/providers",
            get(list_providers).post(create_provider),
        )
        .route(
            "/api/llm/providers/{provider_id}/secret",
            put(update_provider_secret),
        )
        .route(
            "/api/llm/providers/{provider_id}/health",
            post(provider_health),
        )
        .route("/api/llm/models", get(list_models).post(create_model))
        .route(
            "/api/llm/prompt-profiles",
            get(list_prompt_profiles).post(create_prompt_profile),
        )
        .route("/api/llm/prices", get(list_prices).post(create_price))
        .with_state(state)
}

fn service(state: &AppState) -> LlmConfigurationService {
    LlmConfigurationService::new(state.db.clone(), (*state.secret_cipher).clone())
}

async fn list_providers(
    State(state): State<AppState>,
    principal: Principal,
    Query(query): Query<PageQuery>,
) -> Result<Json<ListPage<LlmProvider>>, AppError> {
    let items = service(&state)
        .list_providers(&principal, &query.group_id)
        .await?;
    let (items, next_cursor) =
        paginate(items, query.cursor.as_deref(), query.limit, |item| &item.id)?;
    Ok(Json(ListPage { items, next_cursor }))
}

async fn create_provider(
    State(state): State<AppState>,
    principal: Principal,
    Json(request): Json<CreateProviderRequest>,
) -> Result<Json<LlmProvider>, AppError> {
    Ok(Json(
        service(&state)
            .create_provider(
                &principal,
                &request.group_id,
                &request.name,
                request.provider_kind,
                &request.base_url,
                request.secret.as_deref(),
            )
            .await?,
    ))
}

async fn update_provider_secret(
    State(state): State<AppState>,
    principal: Principal,
    Path(provider_id): Path<String>,
    Json(request): Json<UpdateSecretRequest>,
) -> Result<Json<LlmProvider>, AppError> {
    Ok(Json(
        service(&state)
            .update_provider_secret(&principal, &provider_id, request.secret.as_deref())
            .await?,
    ))
}

async fn provider_health(
    State(state): State<AppState>,
    principal: Principal,
    Path(provider_id): Path<String>,
) -> Result<Json<ProviderHealth>, AppError> {
    Ok(Json(
        service(&state)
            .provider_health(&principal, &provider_id)
            .await?,
    ))
}

async fn list_models(
    State(state): State<AppState>,
    principal: Principal,
    Query(query): Query<PageQuery>,
) -> Result<Json<ListPage<LlmModel>>, AppError> {
    let items = service(&state)
        .list_models(&principal, &query.group_id)
        .await?;
    let (items, next_cursor) =
        paginate(items, query.cursor.as_deref(), query.limit, |item| &item.id)?;
    Ok(Json(ListPage { items, next_cursor }))
}

async fn create_model(
    State(state): State<AppState>,
    principal: Principal,
    Json(request): Json<CreateModelRequest>,
) -> Result<Json<LlmModel>, AppError> {
    Ok(Json(
        service(&state)
            .create_model(
                &principal,
                &request.group_id,
                &request.provider_id,
                &request.model_key,
                &request.upstream_model,
            )
            .await?,
    ))
}

async fn list_prompt_profiles(
    State(state): State<AppState>,
    principal: Principal,
    Query(query): Query<PageQuery>,
) -> Result<Json<ListPage<PromptProfile>>, AppError> {
    let items = service(&state)
        .list_prompt_profiles(&principal, &query.group_id)
        .await?;
    let (items, next_cursor) =
        paginate(items, query.cursor.as_deref(), query.limit, |item| &item.id)?;
    Ok(Json(ListPage { items, next_cursor }))
}

async fn create_prompt_profile(
    State(state): State<AppState>,
    principal: Principal,
    Json(request): Json<CreatePromptRequest>,
) -> Result<Json<PromptProfile>, AppError> {
    Ok(Json(
        service(&state)
            .create_prompt_profile(
                &principal,
                &request.group_id,
                &request.name,
                &request.system_prompt,
            )
            .await?,
    ))
}

async fn list_prices(
    State(state): State<AppState>,
    principal: Principal,
    Query(query): Query<PageQuery>,
) -> Result<Json<ListPage<ProviderPriceVersion>>, AppError> {
    let (items, next_cursor) = service(&state)
        .list_price_versions(
            &principal,
            &query.group_id,
            query.cursor.as_deref(),
            query.limit.unwrap_or(50),
        )
        .await?;
    Ok(Json(ListPage { items, next_cursor }))
}

fn paginate<T, F>(
    items: Vec<T>,
    cursor: Option<&str>,
    requested_limit: Option<usize>,
    id: F,
) -> Result<(Vec<T>, Option<String>), AppError>
where
    F: Fn(&T) -> &str,
{
    let limit = requested_limit.unwrap_or(50).clamp(1, 100);
    let start = match cursor {
        Some(cursor) => items
            .iter()
            .position(|item| id(item) == cursor)
            .map(|index| index + 1)
            .ok_or_else(|| AppError::BadRequest("invalid list cursor".into()))?,
        None => 0,
    };
    let end = (start + limit).min(items.len());
    let has_more = end < items.len();
    let page = items
        .into_iter()
        .skip(start)
        .take(limit)
        .collect::<Vec<_>>();
    let next = if has_more {
        page.last().map(|item| id(item).to_string())
    } else {
        None
    };
    Ok((page, next))
}

async fn create_price(
    State(state): State<AppState>,
    principal: Principal,
    Json(request): Json<CreatePriceRequest>,
) -> Result<Json<ProviderPriceVersion>, AppError> {
    Ok(Json(
        service(&state)
            .create_price_version(
                &principal,
                &request.group_id,
                &request.provider_id,
                request.model_id.as_deref(),
                &request.currency,
                &request.unit,
                request.input_cost_micros,
                request.output_cost_micros,
                &request.idempotency_key,
            )
            .await?,
    ))
}

#[cfg(test)]
mod tests {
    use axum::{
        body::{to_bytes, Body},
        http::{header, Request, StatusCode},
    };
    use serde_json::{json, Value};
    use tower::ServiceExt;

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

        let denied = app
            .oneshot(
                Request::get(format!("/api/llm/providers?groupId={}", fixture.german_a))
                    .header(
                        header::AUTHORIZATION,
                        format!("Bearer {}", other.access_token),
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(denied.status(), StatusCode::FORBIDDEN);
        std::fs::remove_file(signing_path).unwrap();
        std::fs::remove_file(encryption_path).unwrap();
    }
}
