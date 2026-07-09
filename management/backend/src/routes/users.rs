use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

use crate::{
    authorization::{AuthorizationService, Capability},
    error::AppError,
    identity::{IdentityType, Principal},
    provisioning::{
        CreatedInvitation, CsvImportResult, CsvPreview, ProvisionedUser, ProvisioningService,
    },
    state::AppState,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedUser {
    id: String,
    email: String,
    display_name: String,
    identity_type: String,
    status: String,
    group_ids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UsersPage {
    users: Vec<ManagedUser>,
    next_cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsersQuery {
    group_id: Option<String>,
    cursor: Option<String>,
    limit: Option<usize>,
}

#[derive(Deserialize)]
struct CsvRequest {
    csv: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportRequest {
    csv: String,
    idempotency_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InvitationRequest {
    email: String,
    identity_type: IdentityType,
    #[serde(default)]
    capabilities: Vec<Capability>,
    expires_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JoinCodeRequest {
    identity_type: IdentityType,
    #[serde(default)]
    capabilities: Vec<Capability>,
    expires_at: i64,
    max_uses: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AcceptInvitationRequest {
    token: String,
    email: String,
    display_name: String,
}

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/api/users", get(get_users))
        .route(
            "/api/groups/{id}/provisioning/csv/preview",
            post(preview_csv),
        )
        .route("/api/groups/{id}/provisioning/csv/import", post(import_csv))
        .route(
            "/api/groups/{id}/provisioning/invitations",
            post(create_invitation),
        )
        .route(
            "/api/groups/{id}/provisioning/join-codes",
            post(create_join_code),
        )
        .route(
            "/api/provisioning/invitations/accept",
            post(accept_invitation),
        )
        .with_state(state)
}

async fn get_users(
    State(state): State<AppState>,
    principal: Principal,
    Query(query): Query<UsersQuery>,
) -> Result<Json<UsersPage>, AppError> {
    let group_id = query
        .group_id
        .or_else(|| principal.active_group_id.clone())
        .ok_or_else(|| AppError::BadRequest("groupId or an active group is required".into()))?;
    AuthorizationService::new(state.db.clone())
        .require(&principal, &group_id, Capability::MembersView)
        .await?;
    Ok(Json(
        list_users(
            &state.db,
            &group_id,
            query.cursor.as_deref(),
            query.limit.unwrap_or(50),
        )
        .await?,
    ))
}

async fn list_users(
    pool: &SqlitePool,
    group_id: &str,
    cursor: Option<&str>,
    limit: usize,
) -> Result<UsersPage, AppError> {
    let limit = limit.clamp(1, 100);
    let rows = sqlx::query(
        "WITH RECURSIVE subtree(id) AS (
            SELECT id FROM groups WHERE id = ? AND status != 'archived'
            UNION ALL SELECT child.id FROM groups child JOIN subtree parent ON child.parent_id = parent.id WHERE child.status != 'archived'
        ) SELECT user.id, user.email, user.display_name, user.identity_type, user.status,
                 GROUP_CONCAT(membership.group_id) AS group_ids
          FROM users user JOIN group_memberships membership ON membership.user_id = user.id
          JOIN subtree ON subtree.id = membership.group_id
          WHERE membership.status = 'active' AND (? IS NULL OR user.id > ?)
          GROUP BY user.id ORDER BY user.id LIMIT ?",
    ).bind(group_id).bind(cursor).bind(cursor).bind((limit + 1) as i64).fetch_all(pool).await.map_err(database_error)?;
    let has_more = rows.len() > limit;
    let users: Vec<_> = rows
        .into_iter()
        .take(limit)
        .map(|row| ManagedUser {
            id: row.get("id"),
            email: row.get("email"),
            display_name: row.get("display_name"),
            identity_type: row.get("identity_type"),
            status: row.get("status"),
            group_ids: row
                .get::<String, _>("group_ids")
                .split(',')
                .map(str::to_string)
                .collect(),
        })
        .collect();
    let next_cursor = if has_more {
        users.last().map(|user| user.id.clone())
    } else {
        None
    };
    Ok(UsersPage { users, next_cursor })
}

async fn preview_csv(
    State(state): State<AppState>,
    principal: Principal,
    Path(id): Path<String>,
    Json(request): Json<CsvRequest>,
) -> Result<Json<CsvPreview>, AppError> {
    Ok(Json(
        ProvisioningService::new(state.db)
            .preview_csv(&principal, &id, &request.csv)
            .await?,
    ))
}

async fn import_csv(
    State(state): State<AppState>,
    principal: Principal,
    Path(id): Path<String>,
    Json(request): Json<ImportRequest>,
) -> Result<Json<CsvImportResult>, AppError> {
    Ok(Json(
        ProvisioningService::new(state.db)
            .import_csv(&principal, &id, &request.csv, &request.idempotency_key)
            .await?,
    ))
}

async fn create_invitation(
    State(state): State<AppState>,
    principal: Principal,
    Path(id): Path<String>,
    Json(request): Json<InvitationRequest>,
) -> Result<(StatusCode, Json<CreatedInvitation>), AppError> {
    let invitation = ProvisioningService::new(state.db)
        .create_invitation(
            &principal,
            &id,
            &request.email,
            request.identity_type,
            request.capabilities,
            request.expires_at,
        )
        .await?;
    Ok((StatusCode::CREATED, Json(invitation)))
}

async fn create_join_code(
    State(state): State<AppState>,
    principal: Principal,
    Path(id): Path<String>,
    Json(request): Json<JoinCodeRequest>,
) -> Result<(StatusCode, Json<CreatedInvitation>), AppError> {
    let code = ProvisioningService::new(state.db)
        .create_join_code(
            &principal,
            &id,
            request.identity_type,
            request.capabilities,
            request.expires_at,
            request.max_uses,
        )
        .await?;
    Ok((StatusCode::CREATED, Json(code)))
}

async fn accept_invitation(
    State(state): State<AppState>,
    Json(request): Json<AcceptInvitationRequest>,
) -> Result<Json<ProvisionedUser>, AppError> {
    Ok(Json(
        ProvisioningService::new(state.db)
            .accept_invitation(&request.token, &request.email, &request.display_name)
            .await?,
    ))
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
    use serde_json::Value;
    use tower::ServiceExt;

    use crate::{auth::hash_token, config::Config, groups::tests::GroupFixture, state::AppState};

    #[tokio::test]
    async fn users_route_is_subtree_scoped_and_cursor_paginated() {
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
        let app: Router = super::router(state.clone()).with_state(state);

        let response = app
            .oneshot(
                Request::get(format!("/api/users?groupId={}&limit=1", fixture.german_a))
                    .header(
                        header::AUTHORIZATION,
                        format!("Bearer {}", session.access_token),
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(body["users"].as_array().unwrap().len(), 1);
        assert!(body["nextCursor"].is_string());
    }
}
