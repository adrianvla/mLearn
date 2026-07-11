use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use sqlx::Connection;

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
        .route("/api/conversations/export.csv", get(export_csv))
        .route("/api/conversations/{id}", get(get_one))
        .route("/api/conversations/maintenance", post(maintenance))
        .with_state(state)
}

async fn export_csv(
    State(state): State<AppState>,
    principal: Principal,
    Query(query): Query<ListQuery>,
) -> Result<impl IntoResponse, AppError> {
    let limit = query.limit.unwrap_or(100);
    if limit == 0 || limit > 100 {
        return Err(AppError::BadRequest(
            "export row limit must be 1..100".into(),
        ));
    }
    let page = service(&state)
        .list(
            &principal,
            &query.group_id,
            query.cursor.as_deref(),
            limit,
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
        .await?;
    let mut connection = state.db.acquire().await.map_err(database_error)?;
    let mut transaction = connection
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(database_error)?;
    crate::authorization::AuthorizationService::new(state.db.clone())
        .require_in_transaction(
            &mut transaction,
            &principal,
            &query.group_id,
            crate::authorization::Capability::ConversationsExport,
        )
        .await?;
    let effective =
        crate::policy::compiler::compile_in_transaction(&mut transaction, &query.group_id).await?;
    if !effective.document.governance.teacher_conversation_export {
        return Err(AppError::PolicyDenied(
            "conversation export is disabled by effective policy".into(),
        ));
    }

    let row_count = page.items.len();
    let mut writer = csv::Writer::from_writer(vec![]);
    writer
        .write_record([
            "conversation_id",
            "group_id",
            "learner_user_id",
            "provider_id",
            "model_id",
            "status",
            "input_tokens",
            "output_tokens",
            "cost_micros",
            "policy_version_id",
            "error_code",
            "created_at",
        ])
        .map_err(|_| AppError::Internal("conversation csv export failed".into()))?;
    for row in page.items {
        writer
            .write_record([
                csv_safe(row.id),
                csv_safe(row.group_id),
                csv_safe(row.learner_user_id),
                csv_safe(row.provider_id),
                csv_safe(row.model_id),
                csv_safe(row.status),
                row.input_tokens.unwrap_or_default().to_string(),
                row.output_tokens.unwrap_or_default().to_string(),
                row.cost_micros.unwrap_or_default().to_string(),
                csv_safe(row.policy_version_id.unwrap_or_default()),
                csv_safe(row.error_code.unwrap_or_default()),
                row.created_at.to_string(),
            ])
            .map_err(|_| AppError::Internal("conversation csv export failed".into()))?;
    }
    sqlx::query("INSERT INTO audit_events(id,actor_user_id,action,target_type,target_id,metadata_json,created_at,authorized_group_id,request_id,actor_api_key_id) VALUES(?,?,'conversations.exported','group',?,?,unixepoch(),?,NULL,?)")
        .bind(uuid::Uuid::now_v7().to_string()).bind(&principal.user_id).bind(&query.group_id)
        .bind(serde_json::json!({"rows":row_count,"from":query.from,"to":query.to}).to_string())
        .bind(&query.group_id).bind(&principal.service_key_id).execute(&mut *transaction).await.map_err(database_error)?;
    transaction.commit().await.map_err(database_error)?;
    let bytes = writer
        .into_inner()
        .map_err(|_| AppError::Internal("conversation csv export failed".into()))?;
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        "text/csv; charset=utf-8".parse().unwrap(),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        "attachment; filename=conversations.csv".parse().unwrap(),
    );
    Ok((headers, bytes))
}

fn csv_safe(value: String) -> String {
    if matches!(
        value.as_bytes().first(),
        Some(b'=') | Some(b'+') | Some(b'-') | Some(b'@')
    ) {
        format!("'{value}")
    } else {
        value
    }
}

fn database_error(error: sqlx::Error) -> AppError {
    AppError::Internal(format!("conversation database error: {error}"))
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
