use axum::{
    extract::{DefaultBodyLimit, State},
    routing::post,
    Json, Router,
};

use crate::{
    analytics::ingestion::{AnalyticsIngestionService, IngestionBatch, IngestionResult},
    dto::AnalyticsDto,
    error::AppError,
    identity::Principal,
    state::AppState,
};

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/api/analytics/events", post(ingest_events))
        .layer(DefaultBodyLimit::max(300 * 1024))
        .with_state(state)
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
