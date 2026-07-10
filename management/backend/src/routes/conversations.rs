use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;

use crate::{
    error::AppError,
    identity::Principal,
    llm::conversations::{
        ConversationDetail, ConversationFilter, ConversationPage, ConversationService,
        RetentionPage,
    },
    state::AppState,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListQuery {
    group_id: String,
    cursor: Option<String>,
    limit: Option<usize>,
    learner_user_id: Option<String>,
    provider_id: Option<String>,
    model_id: Option<String>,
    status: Option<String>,
    from: Option<i64>,
    to: Option<i64>,
    policy_blocked: Option<bool>,
}
#[derive(Deserialize)]
struct MaintenanceQuery {
    cursor: Option<String>,
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
) -> Result<Json<ConversationPage>, AppError> {
    Ok(Json(
        service(&state)
            .list(
                &principal,
                &query.group_id,
                query.cursor.as_deref(),
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
    Query(query): Query<MaintenanceQuery>,
) -> Result<Json<RetentionPage>, AppError> {
    let result = service(&state)
        .maintain_retention(&principal, query.cursor.as_deref())
        .await?;
    Ok(Json(result))
}
