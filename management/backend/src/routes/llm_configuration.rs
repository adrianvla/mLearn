use axum::{
    extract::{Path, Query, State},
    routing::{get, post, put},
    Json, Router,
};
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Deserializer, Serialize};

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
    secret: Option<IncomingSecret>,
    idempotency_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateSecretRequest {
    secret: Option<IncomingSecret>,
    idempotency_key: String,
}

struct IncomingSecret(SecretString);

impl IncomingSecret {
    fn expose(&self) -> &str {
        self.0.expose_secret()
    }
}

impl<'de> Deserialize<'de> for IncomingSecret {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        String::deserialize(deserializer).map(|value| Self(SecretString::from(value)))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateModelRequest {
    group_id: String,
    provider_id: String,
    model_key: String,
    upstream_model: String,
    idempotency_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateProviderRequest {
    name: String,
    provider_kind: ProviderKind,
    base_url: String,
    status: String,
    idempotency_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateModelRequest {
    model_key: String,
    upstream_model: String,
    status: String,
    idempotency_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreatePromptRequest {
    group_id: String,
    name: String,
    system_prompt: String,
    idempotency_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdatePromptRequest {
    name: String,
    system_prompt: String,
    status: String,
    idempotency_key: String,
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
        .route("/api/llm/providers/{provider_id}", put(update_provider))
        .route(
            "/api/llm/providers/{provider_id}/health",
            post(provider_health),
        )
        .route("/api/llm/models", get(list_models).post(create_model))
        .route("/api/llm/models/{model_id}", put(update_model))
        .route(
            "/api/llm/prompt-profiles",
            get(list_prompt_profiles).post(create_prompt_profile),
        )
        .route(
            "/api/llm/prompt-profiles/{profile_id}",
            put(update_prompt_profile),
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
                request.secret.as_ref().map(IncomingSecret::expose),
                &request.idempotency_key,
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
            .update_provider_secret(
                &principal,
                &provider_id,
                request.secret.as_ref().map(IncomingSecret::expose),
                &request.idempotency_key,
            )
            .await?,
    ))
}

async fn update_provider(
    State(state): State<AppState>,
    principal: Principal,
    Path(provider_id): Path<String>,
    Json(request): Json<UpdateProviderRequest>,
) -> Result<Json<LlmProvider>, AppError> {
    Ok(Json(
        service(&state)
            .update_provider_metadata(
                &principal,
                &provider_id,
                &request.name,
                request.provider_kind,
                &request.base_url,
                &request.status,
                &request.idempotency_key,
            )
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
                &request.idempotency_key,
            )
            .await?,
    ))
}

async fn update_model(
    State(state): State<AppState>,
    principal: Principal,
    Path(model_id): Path<String>,
    Json(request): Json<UpdateModelRequest>,
) -> Result<Json<LlmModel>, AppError> {
    Ok(Json(
        service(&state)
            .update_model(
                &principal,
                &model_id,
                &request.model_key,
                &request.upstream_model,
                &request.status,
                &request.idempotency_key,
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
                &request.idempotency_key,
            )
            .await?,
    ))
}

async fn update_prompt_profile(
    State(state): State<AppState>,
    principal: Principal,
    Path(profile_id): Path<String>,
    Json(request): Json<UpdatePromptRequest>,
) -> Result<Json<PromptProfile>, AppError> {
    Ok(Json(
        service(&state)
            .update_prompt_profile(
                &principal,
                &profile_id,
                &request.name,
                &request.system_prompt,
                &request.status,
                &request.idempotency_key,
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
#[path = "llm_configuration_tests.rs"]
mod tests;
