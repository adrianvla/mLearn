use axum::{
    extract::{DefaultBodyLimit, Query, State},
    http::{header, HeaderMap},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use sqlx::Connection;
use time::OffsetDateTime;

use crate::{
    analytics::ingestion::{AnalyticsIngestionService, IngestionBatch, IngestionResult},
    analytics::queries::{
        AnalyticsQueryService, AnalyticsSummary, DimensionAnalytics, LearnerAnalytics,
        LlmAnalytics, Page, PolicyBlockAnalytics, TimeseriesPoint,
    },
    dto::AnalyticsDto,
    error::AppError,
    identity::Principal,
    state::AppState,
};

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/api/analytics/events", post(ingest_events))
        .route("/api/analytics/summary", get(summary))
        .route("/api/analytics/timeseries", get(timeseries))
        .route("/api/analytics/learners", get(learners))
        .route("/api/analytics/content", get(content))
        .route("/api/analytics/languages", get(languages))
        .route("/api/analytics/llm", get(llm))
        .route("/api/analytics/policy-blocks", get(policy_blocks))
        .route("/api/analytics/export.csv", get(export_csv))
        .route("/api/analytics/retention", post(run_retention))
        .layer(DefaultBodyLimit::max(300 * 1024))
        .with_state(state)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AnalyticsQuery {
    group_id: String,
    from: Option<i64>,
    to: Option<i64>,
    limit: Option<i64>,
    cursor: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RetentionQuery {
    group_id: String,
    limit: Option<i64>,
}
async fn run_retention(
    State(state): State<AppState>,
    principal: Principal,
    Json(q): Json<RetentionQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let deleted = AnalyticsQueryService::new(state.db)
        .run_retention(&principal, &q.group_id, q.limit.unwrap_or(250))
        .await?;
    Ok(Json(serde_json::json!({"deletedEvents":deleted})))
}
fn bounds(q: &AnalyticsQuery) -> Result<(i64, i64, i64), AppError> {
    let to =
        q.to.unwrap_or_else(|| OffsetDateTime::now_utc().unix_timestamp() * 1000);
    let from = q.from.unwrap_or(to - 30 * 86_400_000);
    let limit = q.limit.unwrap_or(50);
    if !(1..=200).contains(&limit) {
        return Err(AppError::BadRequest(
            "analytics limit must be between 1 and 200".into(),
        ));
    }
    Ok((from, to, limit))
}
async fn summary(
    State(state): State<AppState>,
    principal: Principal,
    Query(q): Query<AnalyticsQuery>,
) -> Result<Json<AnalyticsSummary>, AppError> {
    let (from, to, _) = bounds(&q)?;
    Ok(Json(
        AnalyticsQueryService::new(state.db)
            .summary(&principal, &q.group_id, from, to)
            .await?,
    ))
}
async fn timeseries(
    State(state): State<AppState>,
    principal: Principal,
    Query(q): Query<AnalyticsQuery>,
) -> Result<Json<Vec<TimeseriesPoint>>, AppError> {
    let (from, to, _) = bounds(&q)?;
    Ok(Json(
        AnalyticsQueryService::new(state.db)
            .timeseries(&principal, &q.group_id, from, to)
            .await?,
    ))
}
async fn learners(
    State(state): State<AppState>,
    principal: Principal,
    Query(q): Query<AnalyticsQuery>,
) -> Result<Json<Page<LearnerAnalytics>>, AppError> {
    let (from, to, limit) = bounds(&q)?;
    Ok(Json(
        AnalyticsQueryService::new(state.db)
            .learners(
                &principal,
                &q.group_id,
                from,
                to,
                limit,
                q.cursor.as_deref(),
            )
            .await?,
    ))
}
async fn content(
    State(state): State<AppState>,
    principal: Principal,
    Query(q): Query<AnalyticsQuery>,
) -> Result<Json<Page<DimensionAnalytics>>, AppError> {
    let (from, to, limit) = bounds(&q)?;
    Ok(Json(
        AnalyticsQueryService::new(state.db)
            .dimensions(
                &principal,
                &q.group_id,
                from,
                to,
                false,
                limit,
                q.cursor.as_deref(),
            )
            .await?,
    ))
}
async fn languages(
    State(state): State<AppState>,
    principal: Principal,
    Query(q): Query<AnalyticsQuery>,
) -> Result<Json<Page<DimensionAnalytics>>, AppError> {
    let (from, to, limit) = bounds(&q)?;
    Ok(Json(
        AnalyticsQueryService::new(state.db)
            .dimensions(
                &principal,
                &q.group_id,
                from,
                to,
                true,
                limit,
                q.cursor.as_deref(),
            )
            .await?,
    ))
}
async fn llm(
    State(state): State<AppState>,
    principal: Principal,
    Query(q): Query<AnalyticsQuery>,
) -> Result<Json<LlmAnalytics>, AppError> {
    let (from, to, _) = bounds(&q)?;
    Ok(Json(
        AnalyticsQueryService::new(state.db)
            .llm_summary(&principal, &q.group_id, from, to)
            .await?,
    ))
}
async fn policy_blocks(
    State(state): State<AppState>,
    principal: Principal,
    Query(q): Query<AnalyticsQuery>,
) -> Result<Json<PolicyBlockAnalytics>, AppError> {
    let (from, to, _) = bounds(&q)?;
    Ok(Json(
        AnalyticsQueryService::new(state.db)
            .policy_blocks(&principal, &q.group_id, from, to)
            .await?,
    ))
}
async fn export_csv(
    State(state): State<AppState>,
    principal: Principal,
    Query(q): Query<AnalyticsQuery>,
) -> Result<impl IntoResponse, AppError> {
    let (from, to, limit) = bounds(&q)?;
    if limit > 10_000 {
        return Err(AppError::BadRequest("export row limit exceeded".into()));
    }
    let page = AnalyticsQueryService::new(state.db.clone())
        .learners(
            &principal,
            &q.group_id,
            from,
            to,
            limit,
            q.cursor.as_deref(),
        )
        .await?;
    let mut writer = csv::Writer::from_writer(vec![]);
    writer
        .write_record([
            "learner_id",
            "display_name",
            "sessions",
            "watch_seconds",
            "llm_requests",
            "total_tokens",
            "cost_micros",
        ])
        .map_err(|_| AppError::Internal("csv export failed".into()))?;
    for row in page.items {
        let safe = |v: String| {
            if matches!(
                v.as_bytes().first(),
                Some(b'=') | Some(b'+') | Some(b'-') | Some(b'@')
            ) {
                format!("'{v}")
            } else {
                v
            }
        };
        writer
            .write_record([
                safe(row.learner_id),
                safe(row.display_name),
                row.summary.sessions.to_string(),
                row.summary.watch_seconds.to_string(),
                row.summary.llm_requests.to_string(),
                row.summary.total_tokens.to_string(),
                row.summary.cost_micros.to_string(),
            ])
            .map_err(|_| AppError::Internal("csv export failed".into()))?;
    }
    let mut connection = state
        .db
        .acquire()
        .await
        .map_err(|e| AppError::Internal(format!("analytics database error: {e}")))?;
    let mut tx = connection
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(|e| AppError::Internal(format!("analytics database error: {e}")))?;
    let effective = crate::policy::compiler::compile_in_transaction(&mut tx, &q.group_id).await?;
    if !effective.document.governance.teacher_analytics_export {
        return Err(AppError::PolicyDenied(
            "analytics export is disabled by effective policy".into(),
        ));
    }
    crate::authorization::AuthorizationService::new(state.db.clone())
        .require_in_transaction(
            &mut tx,
            &principal,
            &q.group_id,
            crate::authorization::Capability::AnalyticsView,
        )
        .await?;
    sqlx::query("INSERT INTO audit_events(id,actor_user_id,action,target_type,target_id,metadata_json,created_at,authorized_group_id,request_id,actor_api_key_id) VALUES(?,?,'analytics.exported','group',?,?,unixepoch(),?,NULL,?)")
        .bind(uuid::Uuid::now_v7().to_string()).bind(&principal.user_id).bind(&q.group_id).bind(serde_json::json!({"from":from,"to":to,"rows":limit}).to_string()).bind(&q.group_id).bind(&principal.service_key_id).execute(&mut *tx).await.map_err(|e|AppError::Internal(format!("analytics database error: {e}")))?;
    tx.commit()
        .await
        .map_err(|e| AppError::Internal(format!("analytics database error: {e}")))?;
    let bytes = writer
        .into_inner()
        .map_err(|_| AppError::Internal("csv export failed".into()))?;
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        "text/csv; charset=utf-8".parse().unwrap(),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        "attachment; filename=analytics.csv".parse().unwrap(),
    );
    Ok((headers, bytes))
}

async fn ingest_events(
    State(state): State<AppState>,
    principal: Principal,
    Json(batch): Json<IngestionBatch>,
) -> Result<Json<IngestionResult>, AppError> {
    Ok(Json(
        AnalyticsIngestionService::new(state.db)
            .ingest(&principal, batch)
            .await?,
    ))
}

pub async fn get_analytics() -> Result<Json<AnalyticsDto>, AppError> {
    Err(AppError::NotImplemented(
        "Analytics are not connected to a real metrics or audit-log source yet.".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use axum::{
        body::{to_bytes, Body},
        http::{header, Request, StatusCode},
    };
    use serde_json::{json, Value};
    use sha2::{Digest, Sha256};
    use sqlx::sqlite::SqlitePoolOptions;
    use time::OffsetDateTime;
    use tower::ServiceExt;

    #[tokio::test]
    async fn production_route_authenticates_learner_and_returns_exact_shape() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let now = OffsetDateTime::now_utc().unix_timestamp();
        sqlx::query("INSERT INTO users(id,email,normalized_email,display_name,status,identity_type,is_root,created_at,updated_at) VALUES('learner','l@test','l@test','L','active','learner',0,?,?)").bind(now).bind(now).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO groups(id,parent_id,name,slug,status,created_at) VALUES('class',NULL,'Class','class','active',?)").bind(now).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO group_memberships(id,group_id,user_id,status,created_at) VALUES('membership','class','learner','active',?)").bind(now).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO policy_versions(id,group_id,document_json,document_hash,compiled_hash,author_user_id,summary,parent_version_ids_json,created_at) VALUES('v1','class','{}','d','c','learner','test','[]',?)").bind(now-1).execute(&pool).await.unwrap();
        let signing =
            std::env::temp_dir().join(format!("analytics-signing-{}", uuid::Uuid::now_v7()));
        let encryption =
            std::env::temp_dir().join(format!("analytics-encryption-{}", uuid::Uuid::now_v7()));
        let mut config = crate::config::Config::from_env();
        config.policy_signing_key_path = signing.to_string_lossy().into();
        config.encryption_key_path = encryption.to_string_lossy().into();
        config.encryption_key = None;
        let state = crate::state::AppState::try_new(
            bollard::Docker::connect_with_http_defaults().unwrap(),
            config,
            pool,
        )
        .unwrap();
        let session = state
            .identity
            .issue_session("learner", Some("device"), Some("class"))
            .await
            .unwrap();
        let policy = hex::encode(Sha256::digest(b"v1"));
        let payload = json!({"schemaVersion":1,"events":[{"schemaVersion":1,"id":"event","type":"activity.started","sessionId":"watch","sourceId":"reader","activeGroupId":"class","policyVersionId":policy,"sequence":1,"occurredAt":OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339).unwrap(),"activity":{"kind":"flashcards"},"context":{"privacy":"progress-only"}}]});
        let response = crate::application_router(state)
            .oneshot(
                Request::post("/api/analytics/events")
                    .header(
                        header::AUTHORIZATION,
                        format!("Bearer {}", session.access_token),
                    )
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(
            body,
            json!({"acceptedIds":["event"],"duplicateIds":[],"rejected":[]})
        );
        let _ = std::fs::remove_file(signing);
        let _ = std::fs::remove_file(encryption);
    }
}
