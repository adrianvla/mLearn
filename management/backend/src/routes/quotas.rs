use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::{
    authorization::{AuthorizationService, Capability},
    error::AppError,
    identity::Principal,
    llm::quota::{
        QuotaDefinition, QuotaScopeKind, QuotaService, SchoolQuotaCalendar, UsageSummary,
    },
    policy::model::{QuotaMetric, QuotaPeriod},
    state::AppState,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CalendarRequest {
    root_group_id: String,
    timezone: String,
    term_starts_at: i64,
    term_ends_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DefinitionRequest {
    owner_group_id: String,
    subject_kind: QuotaScopeKind,
    subject_id: String,
    metric: QuotaMetric,
    period: QuotaPeriod,
    limit: i64,
    idempotency_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GroupQuery {
    group_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SummaryQuery {
    group_id: String,
    cursor: Option<String>,
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeleteQuery {
    idempotency_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CurrentReservation {
    id: String,
    learner_user_id: String,
    direct_group_id: String,
    provider_id: String,
    model_id: String,
    status: String,
    expires_at: i64,
    created_at: i64,
}

#[derive(Serialize)]
struct CurrentReservationsResponse {
    items: Vec<CurrentReservation>,
}

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/api/llm/quota-calendar", put(configure_calendar))
        .route(
            "/api/llm/quotas",
            get(list_definitions).put(upsert_definition),
        )
        .route("/api/llm/quotas/{definition_id}", delete(delete_definition))
        .route("/api/llm/usage", get(usage_summary))
        .route("/api/llm/reservations", get(current_reservations))
        .with_state(state)
}

async fn current_reservations(
    State(state): State<AppState>,
    principal: Principal,
    Query(query): Query<GroupQuery>,
) -> Result<Json<CurrentReservationsResponse>, AppError> {
    AuthorizationService::new(state.db.clone())
        .require(&principal, &query.group_id, Capability::LlmConfigure)
        .await?;
    let rows = sqlx::query("WITH RECURSIVE descendants(id) AS (SELECT id FROM groups WHERE id=? AND status='active' UNION ALL SELECT child.id FROM groups child JOIN descendants parent ON child.parent_id=parent.id WHERE child.status='active') SELECT reservation.id,reservation.learner_user_id,reservation.direct_group_id,reservation.provider_id,reservation.model_id,reservation.status,reservation.expires_at,reservation.created_at FROM quota_reservations reservation JOIN descendants scope ON scope.id=reservation.direct_group_id WHERE reservation.status='open' AND reservation.expires_at>unixepoch() ORDER BY reservation.created_at DESC,reservation.id DESC LIMIT 100")
        .bind(&query.group_id).fetch_all(&state.db).await.map_err(|error| AppError::Internal(format!("quota reservation database error: {error}")))?;
    Ok(Json(CurrentReservationsResponse {
        items: rows
            .into_iter()
            .map(|row| CurrentReservation {
                id: row.get("id"),
                learner_user_id: row.get("learner_user_id"),
                direct_group_id: row.get("direct_group_id"),
                provider_id: row.get("provider_id"),
                model_id: row.get("model_id"),
                status: row.get("status"),
                expires_at: row.get("expires_at"),
                created_at: row.get("created_at"),
            })
            .collect(),
    }))
}

fn service(state: &AppState) -> QuotaService {
    QuotaService::new(state.db.clone())
}

async fn configure_calendar(
    State(state): State<AppState>,
    principal: Principal,
    Json(request): Json<CalendarRequest>,
) -> Result<Json<SchoolQuotaCalendar>, AppError> {
    Ok(Json(
        service(&state)
            .configure_calendar(
                &principal,
                &request.root_group_id,
                &request.timezone,
                request.term_starts_at,
                request.term_ends_at,
            )
            .await?,
    ))
}

async fn upsert_definition(
    State(state): State<AppState>,
    principal: Principal,
    Json(request): Json<DefinitionRequest>,
) -> Result<Json<QuotaDefinition>, AppError> {
    Ok(Json(
        service(&state)
            .upsert_definition(
                &principal,
                &request.owner_group_id,
                request.subject_kind,
                &request.subject_id,
                request.metric,
                request.period,
                request.limit,
                &request.idempotency_key,
            )
            .await?,
    ))
}

async fn delete_definition(
    State(state): State<AppState>,
    principal: Principal,
    Path(definition_id): Path<String>,
    Query(query): Query<DeleteQuery>,
) -> Result<StatusCode, AppError> {
    service(&state)
        .delete_definition(&principal, &definition_id, &query.idempotency_key)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_definitions(
    State(state): State<AppState>,
    principal: Principal,
    Query(query): Query<GroupQuery>,
) -> Result<Json<Vec<QuotaDefinition>>, AppError> {
    Ok(Json(
        service(&state)
            .list_definitions(&principal, &query.group_id)
            .await?,
    ))
}

async fn usage_summary(
    State(state): State<AppState>,
    principal: Principal,
    Query(query): Query<SummaryQuery>,
) -> Result<Json<UsageSummary>, AppError> {
    Ok(Json(
        service(&state)
            .usage_summary(
                &principal,
                &query.group_id,
                query.cursor.as_deref(),
                query.limit.unwrap_or(50),
            )
            .await?,
    ))
}

#[cfg(test)]
mod tests {
    use axum::{
        body::Body,
        http::{header, Request, StatusCode},
    };
    use tower::ServiceExt;

    use crate::{
        api_keys::ApiKeyService, auth::hash_token, authorization::Capability, config::Config,
        groups::tests::GroupFixture, llm::quota::QuotaService, state::AppState,
    };

    #[tokio::test]
    async fn analytics_service_key_reads_own_subtree_but_cannot_administer_quotas() {
        let fixture = GroupFixture::german_tree().await;
        for capability in [
            Capability::LlmConfigure,
            Capability::AnalyticsView,
            Capability::PoliciesView,
        ] {
            sqlx::query("INSERT INTO membership_capabilities (membership_id, capability) VALUES ('membership-a', ?)")
                .bind(capability.as_str()).execute(&fixture.pool).await.unwrap();
        }
        sqlx::query("INSERT INTO group_memberships (id, group_id, user_id, status, created_at) VALUES ('calendar-admin', ?, ?, 'active', 1)")
            .bind(&fixture.german)
            .bind(&fixture.german_a_teacher.user_id)
            .execute(&fixture.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO membership_capabilities (membership_id, capability) VALUES ('calendar-admin', ?)")
            .bind(Capability::LlmConfigure.as_str())
            .execute(&fixture.pool)
            .await
            .unwrap();
        QuotaService::new(fixture.pool.clone())
            .configure_calendar(
                &fixture.german_a_teacher,
                &fixture.german,
                "Europe/Zurich",
                chrono::DateTime::parse_from_rfc3339("2025-01-01T00:00:00Z")
                    .unwrap()
                    .timestamp(),
                chrono::DateTime::parse_from_rfc3339("2028-01-01T00:00:00Z")
                    .unwrap()
                    .timestamp(),
            )
            .await
            .unwrap();
        let key = ApiKeyService::new(fixture.pool.clone())
            .create(
                &fixture.german_a_teacher,
                &fixture.german_a,
                vec![Capability::AnalyticsView],
                None,
            )
            .await
            .unwrap();
        let view_key = ApiKeyService::new(fixture.pool.clone())
            .create(
                &fixture.german_a_teacher,
                &fixture.german_a,
                vec![Capability::PoliciesView],
                None,
            )
            .await
            .unwrap();
        let mut config = Config::from_env();
        config.token_hash = Some(hash_token("quota-route-test"));
        let state = AppState::new(
            bollard::Docker::connect_with_http_defaults().unwrap(),
            config,
            fixture.pool.clone(),
        );
        let human_session = state
            .identity
            .issue_session(
                &fixture.german_a_teacher.user_id,
                None,
                Some(&fixture.german_a),
            )
            .await
            .unwrap()
            .access_token;
        let app = super::router(state.clone()).with_state(state);
        let reservations = app
            .clone()
            .oneshot(
                Request::get(format!(
                    "/api/llm/reservations?groupId={}",
                    fixture.german_a
                ))
                .header(header::AUTHORIZATION, format!("Bearer {}", human_session))
                .body(Body::empty())
                .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(reservations.status(), StatusCode::OK);

        let summary = app
            .clone()
            .oneshot(
                Request::get(format!("/api/llm/usage?groupId={}", fixture.german_a))
                    .header(header::AUTHORIZATION, format!("Bearer {}", key.secret))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(summary.status(), StatusCode::OK);

        let definitions = app
            .clone()
            .oneshot(
                Request::get(format!("/api/llm/quotas?groupId={}", fixture.german_a))
                    .header(header::AUTHORIZATION, format!("Bearer {}", view_key.secret))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(definitions.status(), StatusCode::OK);

        let sibling = app
            .clone()
            .oneshot(
                Request::get(format!("/api/llm/usage?groupId={}", fixture.german_b))
                    .header(header::AUTHORIZATION, format!("Bearer {}", key.secret))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(sibling.status(), StatusCode::FORBIDDEN);

        let mutation = app.oneshot(Request::put("/api/llm/quotas").header(header::AUTHORIZATION, format!("Bearer {}", key.secret)).header(header::CONTENT_TYPE, "application/json").body(Body::from(serde_json::json!({"ownerGroupId": fixture.german_a, "subjectKind":"group", "subjectId": fixture.german_a, "metric":"requests", "period":"daily", "limit":0, "idempotencyKey":"service-write"}).to_string())).unwrap()).await.unwrap();
        assert_eq!(mutation.status(), StatusCode::FORBIDDEN);
    }
}
