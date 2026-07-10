use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    error::AppError,
    identity::Principal,
    llm::conversations::{
        ConversationDetail, ConversationFilter, ConversationService, ConversationSummary,
    },
    state::AppState,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListQuery {
    group_id: String,
    cursor: Option<i64>,
    limit: Option<usize>,
    learner_user_id: Option<String>,
    provider_id: Option<String>,
    model_id: Option<String>,
    status: Option<String>,
    from: Option<i64>,
    to: Option<i64>,
    policy_blocked: Option<bool>,
}

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/api/conversations", get(list))
        .route("/api/conversations/{id}", get(get_one))
        .route("/api/conversations/maintenance", post(maintenance))
        .with_state(state)
}
fn service(state: &AppState) -> ConversationService {
    ConversationService::with_retention_days(
        state.db.clone(),
        state.secret_cipher.as_ref().clone(),
        state.config.conversation_retention_days,
    )
}
async fn list(
    State(state): State<AppState>,
    principal: Principal,
    Query(query): Query<ListQuery>,
) -> Result<Json<Vec<ConversationSummary>>, AppError> {
    Ok(Json(
        service(&state)
            .list(
                &principal,
                &query.group_id,
                query.cursor,
                query.limit.unwrap_or(50),
                ConversationFilter {
                    learner_user_id: query.learner_user_id.as_deref(),
                    provider_id: query.provider_id.as_deref(),
                    model_id: query.model_id.as_deref(),
                    status: query.status.as_deref(),
                    from: query.from,
                    to: query.to,
                    policy_blocked: query.policy_blocked,
                },
            )
            .await?,
    ))
}
async fn get_one(
    State(state): State<AppState>,
    principal: Principal,
    Path(id): Path<String>,
) -> Result<Json<ConversationDetail>, AppError> {
    Ok(Json(service(&state).get(&principal, &id).await?))
}
async fn maintenance(
    State(state): State<AppState>,
    principal: Principal,
) -> Result<Json<Value>, AppError> {
    let redacted = service(&state).maintain_retention(&principal).await?;
    Ok(Json(json!({"redactedMessages":redacted})))
}
