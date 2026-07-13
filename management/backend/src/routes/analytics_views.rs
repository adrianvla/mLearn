use axum::{
    extract::{rejection::JsonRejection, Path, Query, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use time::OffsetDateTime;

use crate::{
    analytics::queries::{AnalyticsMetric, ComparisonMode},
    authorization::{AuthorizationService, Capability},
    error::AppError,
    identity::Principal,
    state::AppState,
};

const DAY: i64 = 86_400_000;

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/api/analytics/views", get(list_views).post(create_view))
        .route(
            "/api/analytics/views/{id}",
            get(read_view).put(update_view).delete(delete_view),
        )
        .with_state(state)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListViewsQuery {
    group_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveViewRequest {
    name: String,
    definition: SavedAnalyticsViewDefinition,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SavedAnalyticsViewDefinition {
    group_id: String,
    from: i64,
    to: i64,
    preset: SavedViewPreset,
    comparison: ComparisonMode,
    granularity: SavedViewGranularity,
    tab: SavedViewTab,
    visible_metrics: Vec<AnalyticsMetric>,
    breakdown: SavedViewBreakdown,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum SavedViewPreset {
    #[serde(rename = "7")]
    Seven,
    #[serde(rename = "30")]
    Thirty,
    #[serde(rename = "90")]
    Ninety,
    #[serde(rename = "365")]
    ThreeSixtyFive,
    Custom,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum SavedViewGranularity {
    Auto,
    Daily,
    Weekly,
    Monthly,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum SavedViewTab {
    Overview,
    Learners,
    Content,
    LlmUsage,
    PolicyBlocks,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum SavedViewBreakdown {
    None,
    Learners,
    Content,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedAnalyticsView {
    id: String,
    name: String,
    definition: SavedAnalyticsViewDefinition,
    created_at: i64,
    updated_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedAnalyticsViewsResponse {
    items: Vec<SavedAnalyticsView>,
}

async fn list_views(
    State(state): State<AppState>,
    principal: Principal,
    Query(query): Query<ListViewsQuery>,
) -> Result<Json<SavedAnalyticsViewsResponse>, AppError> {
    require_group_access(&state.db, &principal, &query.group_id).await?;
    let rows = sqlx::query(
        "SELECT id,name,definition_json,created_at,updated_at FROM saved_analytics_views WHERE owner_user_id=? AND json_extract(definition_json, '$.groupId')=? ORDER BY updated_at DESC,id DESC",
    )
    .bind(&principal.user_id)
    .bind(&query.group_id)
    .fetch_all(&state.db)
    .await
    .map_err(database_error)?;
    Ok(Json(SavedAnalyticsViewsResponse {
        items: rows
            .into_iter()
            .map(saved_view_from_row)
            .collect::<Result<Vec<_>, _>>()?,
    }))
}

async fn create_view(
    State(state): State<AppState>,
    principal: Principal,
    request: Result<Json<SaveViewRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<SavedAnalyticsView>), AppError> {
    let Json(request) = parse_request(request)?;
    validate_request(&request)?;
    require_group_access(&state.db, &principal, &request.definition.group_id).await?;
    let now = OffsetDateTime::now_utc().unix_timestamp() * 1_000;
    let view = SavedAnalyticsView {
        id: uuid::Uuid::now_v7().to_string(),
        name: request.name,
        definition: request.definition,
        created_at: now,
        updated_at: now,
    };
    sqlx::query("INSERT INTO saved_analytics_views(id,owner_user_id,name,definition_json,created_at,updated_at) VALUES(?,?,?,?,?,?)")
        .bind(&view.id)
        .bind(&principal.user_id)
        .bind(&view.name)
        .bind(serialize_definition(&view.definition)?)
        .bind(view.created_at)
        .bind(view.updated_at)
        .execute(&state.db)
        .await
        .map_err(database_error)?;
    Ok((StatusCode::CREATED, Json(view)))
}

async fn read_view(
    State(state): State<AppState>,
    principal: Principal,
    Path(id): Path<String>,
) -> Result<Json<SavedAnalyticsView>, AppError> {
    let view = owned_view(&state.db, &principal, &id).await?;
    require_group_access(&state.db, &principal, &view.definition.group_id).await?;
    Ok(Json(view))
}

async fn update_view(
    State(state): State<AppState>,
    principal: Principal,
    Path(id): Path<String>,
    request: Result<Json<SaveViewRequest>, JsonRejection>,
) -> Result<Json<SavedAnalyticsView>, AppError> {
    let Json(request) = parse_request(request)?;
    validate_request(&request)?;
    let existing = owned_view(&state.db, &principal, &id).await?;
    require_group_access(&state.db, &principal, &existing.definition.group_id).await?;
    require_group_access(&state.db, &principal, &request.definition.group_id).await?;
    let updated_at = OffsetDateTime::now_utc().unix_timestamp() * 1_000;
    sqlx::query("UPDATE saved_analytics_views SET name=?,definition_json=?,updated_at=? WHERE id=? AND owner_user_id=?")
        .bind(&request.name)
        .bind(serialize_definition(&request.definition)?)
        .bind(updated_at)
        .bind(&id)
        .bind(&principal.user_id)
        .execute(&state.db)
        .await
        .map_err(database_error)?;
    Ok(Json(SavedAnalyticsView {
        id,
        name: request.name,
        definition: request.definition,
        created_at: existing.created_at,
        updated_at,
    }))
}

async fn delete_view(
    State(state): State<AppState>,
    principal: Principal,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let view = owned_view(&state.db, &principal, &id).await?;
    require_group_access(&state.db, &principal, &view.definition.group_id).await?;
    sqlx::query("DELETE FROM saved_analytics_views WHERE id=? AND owner_user_id=?")
        .bind(&id)
        .bind(&principal.user_id)
        .execute(&state.db)
        .await
        .map_err(database_error)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn owned_view(
    pool: &SqlitePool,
    principal: &Principal,
    id: &str,
) -> Result<SavedAnalyticsView, AppError> {
    let row = sqlx::query("SELECT id,name,definition_json,created_at,updated_at FROM saved_analytics_views WHERE id=? AND owner_user_id=?")
        .bind(id)
        .bind(&principal.user_id)
        .fetch_optional(pool)
        .await
        .map_err(database_error)?
        .ok_or_else(|| AppError::NotFound("saved analytics view not found".into()))?;
    saved_view_from_row(row)
}

async fn require_group_access(
    pool: &SqlitePool,
    principal: &Principal,
    group_id: &str,
) -> Result<(), AppError> {
    AuthorizationService::new(pool.clone())
        .require(principal, group_id, Capability::AnalyticsView)
        .await
}

fn validate_request(request: &SaveViewRequest) -> Result<(), AppError> {
    if request.name.chars().count() > 80 || request.name.trim().is_empty() {
        return Err(AppError::BadRequest(
            "saved analytics view name must be between 1 and 80 characters".into(),
        ));
    }
    let definition = &request.definition;
    if definition.group_id.trim().is_empty()
        || definition.from < 0
        || definition.to <= definition.from
        || definition.to - definition.from > 366 * DAY
    {
        return Err(AppError::BadRequest(
            "saved analytics view has an invalid date range or group".into(),
        ));
    }
    if definition
        .visible_metrics
        .iter()
        .enumerate()
        .any(|(index, metric)| definition.visible_metrics[..index].contains(metric))
    {
        return Err(AppError::BadRequest(
            "saved analytics view visibleMetrics must not contain duplicates".into(),
        ));
    }
    Ok(())
}

fn parse_request(
    request: Result<Json<SaveViewRequest>, JsonRejection>,
) -> Result<Json<SaveViewRequest>, AppError> {
    request.map_err(|error| AppError::BadRequest(format!("invalid saved analytics view: {error}")))
}

fn serialize_definition(definition: &SavedAnalyticsViewDefinition) -> Result<String, AppError> {
    serde_json::to_string(definition).map_err(|error| {
        AppError::Internal(format!(
            "saved analytics definition serialization failed: {error}"
        ))
    })
}

fn saved_view_from_row(row: sqlx::sqlite::SqliteRow) -> Result<SavedAnalyticsView, AppError> {
    let definition_json: String = row.get("definition_json");
    let definition = serde_json::from_str(&definition_json).map_err(|_| {
        AppError::Internal("saved analytics view contains an invalid definition".into())
    })?;
    Ok(SavedAnalyticsView {
        id: row.get("id"),
        name: row.get("name"),
        definition,
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

fn database_error(error: sqlx::Error) -> AppError {
    AppError::Internal(format!("database error: {error}"))
}
