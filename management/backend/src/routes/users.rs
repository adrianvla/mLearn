use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get, patch, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use time::OffsetDateTime;
use uuid::Uuid;

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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateUserRequest {
    group_id: String,
    email: String,
    display_name: String,
    identity_type: IdentityType,
    idempotency_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UserScopeQuery {
    group_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateUserStatusRequest {
    status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UserSessionDto {
    id: String,
    expires_at: i64,
    revoked_at: Option<i64>,
    created_at: i64,
    last_seen_at: i64,
    active_group_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UserDeviceDto {
    id: String,
    name: String,
    platform: String,
    created_at: i64,
    last_seen_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UserMembershipDto {
    id: String,
    group_id: String,
    group_name: String,
    status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedUserDetail {
    user: ManagedUser,
    sessions: Vec<UserSessionDto>,
    devices: Vec<UserDeviceDto>,
    memberships: Vec<UserMembershipDto>,
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
        .route("/api/users", get(get_users).post(create_user))
        .route("/api/users/{id}", get(get_user))
        .route("/api/users/{id}/status", patch(update_user_status))
        .route(
            "/api/users/{id}/sessions/{session_id}",
            delete(revoke_user_session),
        )
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

async fn create_user(
    State(state): State<AppState>,
    principal: Principal,
    Json(request): Json<CreateUserRequest>,
) -> Result<(StatusCode, Json<ManagedUser>), AppError> {
    AuthorizationService::new(state.db.clone())
        .require(&principal, &request.group_id, Capability::MembersManage)
        .await?;
    let identity_type = match request.identity_type {
        IdentityType::Admin => "admin",
        IdentityType::Teacher => "teacher",
        IdentityType::Learner => "learner",
    };
    let group_slug: String =
        sqlx::query_scalar("SELECT slug FROM groups WHERE id = ? AND status = 'active'")
            .bind(&request.group_id)
            .fetch_optional(&state.db)
            .await
            .map_err(database_error)?
            .ok_or_else(|| AppError::NotFound("group not found".into()))?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record(["email", "display_name", "identity_type", "group_slug"])
        .map_err(|error| AppError::Internal(error.to_string()))?;
    writer
        .write_record([
            request.email.as_str(),
            request.display_name.as_str(),
            identity_type,
            group_slug.as_str(),
        ])
        .map_err(|error| AppError::BadRequest(error.to_string()))?;
    let csv = String::from_utf8(
        writer
            .into_inner()
            .map_err(|error| AppError::Internal(error.to_string()))?,
    )
    .map_err(|error| AppError::Internal(error.to_string()))?;
    ProvisioningService::new(state.db.clone())
        .import_csv(
            &principal,
            &request.group_id,
            &csv,
            &request.idempotency_key,
        )
        .await?;
    let user_id: String = sqlx::query_scalar("SELECT id FROM users WHERE normalized_email = ?")
        .bind(request.email.trim().to_ascii_lowercase())
        .fetch_one(&state.db)
        .await
        .map_err(database_error)?;
    let user = fetch_managed_user(&state.db, &user_id).await?;
    Ok((StatusCode::CREATED, Json(user)))
}

async fn get_user(
    State(state): State<AppState>,
    principal: Principal,
    Path(id): Path<String>,
    Query(query): Query<UserScopeQuery>,
) -> Result<Json<ManagedUserDetail>, AppError> {
    AuthorizationService::new(state.db.clone())
        .require(&principal, &query.group_id, Capability::MembersView)
        .await?;
    ensure_user_in_subtree(&state.db, &id, &query.group_id).await?;
    let user = fetch_managed_user(&state.db, &id).await?;
    let sessions = sqlx::query("SELECT id, expires_at, revoked_at, created_at, last_seen_at, active_group_id FROM sessions WHERE user_id = ? ORDER BY created_at DESC").bind(&id).fetch_all(&state.db).await.map_err(database_error)?.into_iter().map(|row| UserSessionDto { id: row.get("id"), expires_at: row.get("expires_at"), revoked_at: row.get("revoked_at"), created_at: row.get("created_at"), last_seen_at: row.get("last_seen_at"), active_group_id: row.get("active_group_id") }).collect();
    let devices = sqlx::query("SELECT id, name, platform, created_at, last_seen_at FROM devices WHERE user_id = ? ORDER BY last_seen_at DESC").bind(&id).fetch_all(&state.db).await.map_err(database_error)?.into_iter().map(|row| UserDeviceDto { id: row.get("id"), name: row.get("name"), platform: row.get("platform"), created_at: row.get("created_at"), last_seen_at: row.get("last_seen_at") }).collect();
    let memberships = sqlx::query("WITH RECURSIVE subtree(id) AS (SELECT id FROM groups WHERE id = ? UNION ALL SELECT child.id FROM groups child JOIN subtree parent ON child.parent_id = parent.id) SELECT membership.id, membership.group_id, groups.name AS group_name, membership.status FROM group_memberships membership JOIN groups ON groups.id = membership.group_id JOIN subtree ON subtree.id = membership.group_id WHERE membership.user_id = ? ORDER BY groups.name").bind(&query.group_id).bind(&id).fetch_all(&state.db).await.map_err(database_error)?.into_iter().map(|row| UserMembershipDto { id: row.get("id"), group_id: row.get("group_id"), group_name: row.get("group_name"), status: row.get("status") }).collect();
    Ok(Json(ManagedUserDetail {
        user,
        sessions,
        devices,
        memberships,
    }))
}

async fn update_user_status(
    State(state): State<AppState>,
    principal: Principal,
    Path(id): Path<String>,
    Query(query): Query<UserScopeQuery>,
    Json(request): Json<UpdateUserStatusRequest>,
) -> Result<Json<ManagedUser>, AppError> {
    if !matches!(request.status.as_str(), "active" | "suspended") {
        return Err(AppError::BadRequest(
            "user status must be active or suspended".into(),
        ));
    }
    let authorization = AuthorizationService::new(state.db.clone());
    let mut transaction = state
        .db
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(database_error)?;
    require_user_management(
        &authorization,
        &mut transaction,
        &principal,
        &id,
        &query.group_id,
    )
    .await?;
    let is_root: i64 = sqlx::query_scalar("SELECT is_root FROM users WHERE id = ?")
        .bind(&id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(database_error)?
        .ok_or_else(|| AppError::NotFound("user not found".into()))?;
    if is_root != 0 {
        return Err(AppError::Forbidden(
            "the root administrator cannot be suspended".into(),
        ));
    }
    let now = OffsetDateTime::now_utc().unix_timestamp();
    sqlx::query("UPDATE users SET status = ?, updated_at = ? WHERE id = ?")
        .bind(&request.status)
        .bind(now)
        .bind(&id)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
    if request.status == "suspended" {
        revoke_all_user_sessions(&mut transaction, &id, now).await?;
    }
    insert_user_audit(
        &mut transaction,
        &principal.user_id,
        "user.status_updated",
        &id,
        &query.group_id,
        serde_json::json!({"status":request.status}).to_string(),
    )
    .await?;
    transaction.commit().await.map_err(database_error)?;
    Ok(Json(fetch_managed_user(&state.db, &id).await?))
}

async fn revoke_user_session(
    State(state): State<AppState>,
    principal: Principal,
    Path((id, session_id)): Path<(String, String)>,
    Query(query): Query<UserScopeQuery>,
) -> Result<StatusCode, AppError> {
    let authorization = AuthorizationService::new(state.db.clone());
    let mut transaction = state
        .db
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(database_error)?;
    require_user_management(
        &authorization,
        &mut transaction,
        &principal,
        &id,
        &query.group_id,
    )
    .await?;
    let owns_session: i64 =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sessions WHERE id = ? AND user_id = ?)")
            .bind(&session_id)
            .bind(&id)
            .fetch_one(&mut *transaction)
            .await
            .map_err(database_error)?;
    if owns_session == 0 {
        return Err(AppError::NotFound("session not found".into()));
    }
    let now = OffsetDateTime::now_utc().unix_timestamp();
    sqlx::query("UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?")
        .bind(now)
        .bind(&session_id)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
    sqlx::query(
        "UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE session_id = ?",
    )
    .bind(now)
    .bind(&session_id)
    .execute(&mut *transaction)
    .await
    .map_err(database_error)?;
    insert_user_audit(
        &mut transaction,
        &principal.user_id,
        "identity.session_revoked_by_admin",
        &session_id,
        &query.group_id,
        serde_json::json!({"userId":id}).to_string(),
    )
    .await?;
    transaction.commit().await.map_err(database_error)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn fetch_managed_user(pool: &SqlitePool, user_id: &str) -> Result<ManagedUser, AppError> {
    let row = sqlx::query(
        "SELECT id, email, display_name, identity_type, status FROM users WHERE id = ?",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(database_error)?
    .ok_or_else(|| AppError::NotFound("user not found".into()))?;
    let group_ids = sqlx::query_scalar("SELECT group_id FROM group_memberships WHERE user_id = ? AND status = 'active' ORDER BY group_id").bind(user_id).fetch_all(pool).await.map_err(database_error)?;
    Ok(ManagedUser {
        id: row.get("id"),
        email: row.get("email"),
        display_name: row.get("display_name"),
        identity_type: row.get("identity_type"),
        status: row.get("status"),
        group_ids,
    })
}

async fn ensure_user_in_subtree(
    pool: &SqlitePool,
    user_id: &str,
    group_id: &str,
) -> Result<(), AppError> {
    let visible: i64 = sqlx::query_scalar("WITH RECURSIVE subtree(id) AS (SELECT id FROM groups WHERE id = ? UNION ALL SELECT child.id FROM groups child JOIN subtree parent ON child.parent_id = parent.id) SELECT EXISTS(SELECT 1 FROM group_memberships membership JOIN subtree ON subtree.id = membership.group_id WHERE membership.user_id = ? AND membership.status = 'active')").bind(group_id).bind(user_id).fetch_one(pool).await.map_err(database_error)?;
    if visible == 0 {
        Err(AppError::Forbidden(
            "user is outside the authorized subtree".into(),
        ))
    } else {
        Ok(())
    }
}

async fn require_user_management(
    authorization: &AuthorizationService,
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    principal: &Principal,
    user_id: &str,
    group_id: &str,
) -> Result<(), AppError> {
    authorization
        .require_in_transaction(transaction, principal, group_id, Capability::MembersManage)
        .await?;
    let in_target: i64 = sqlx::query_scalar("WITH RECURSIVE subtree(id) AS (SELECT id FROM groups WHERE id = ? UNION ALL SELECT child.id FROM groups child JOIN subtree parent ON child.parent_id = parent.id) SELECT EXISTS(SELECT 1 FROM group_memberships membership JOIN subtree ON subtree.id = membership.group_id WHERE membership.user_id = ? AND membership.status = 'active')").bind(group_id).bind(user_id).fetch_one(&mut **transaction).await.map_err(database_error)?;
    if in_target == 0 {
        return Err(AppError::Forbidden(
            "user is outside the authorized subtree".into(),
        ));
    }
    let active_groups: Vec<String> = sqlx::query_scalar(
        "SELECT group_id FROM group_memberships WHERE user_id = ? AND status = 'active'",
    )
    .bind(user_id)
    .fetch_all(&mut **transaction)
    .await
    .map_err(database_error)?;
    for active_group in active_groups {
        authorization
            .require_in_transaction(
                transaction,
                principal,
                &active_group,
                Capability::MembersManage,
            )
            .await?;
    }
    Ok(())
}

async fn revoke_all_user_sessions(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    user_id: &str,
    now: i64,
) -> Result<(), AppError> {
    sqlx::query("UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?")
        .bind(now)
        .bind(user_id)
        .execute(&mut **transaction)
        .await
        .map_err(database_error)?;
    sqlx::query("UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE session_id IN (SELECT id FROM sessions WHERE user_id = ?)").bind(now).bind(user_id).execute(&mut **transaction).await.map_err(database_error)?;
    Ok(())
}

async fn insert_user_audit(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    actor_user_id: &str,
    action: &str,
    target_id: &str,
    group_id: &str,
    metadata: String,
) -> Result<(), AppError> {
    sqlx::query("INSERT INTO audit_events (id, actor_user_id, action, target_type, target_id, metadata_json, created_at, authorized_group_id, request_id) VALUES (?, ?, ?, 'user', ?, ?, ?, ?, NULL)")
        .bind(Uuid::now_v7().to_string()).bind(actor_user_id).bind(action).bind(target_id).bind(metadata).bind(OffsetDateTime::now_utc().unix_timestamp()).bind(group_id)
        .execute(&mut **transaction).await.map_err(database_error)?;
    Ok(())
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
    use serde_json::{json, Value};
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

    #[tokio::test]
    async fn administrator_can_create_inspect_suspend_and_revoke_a_scoped_user_session() {
        let fixture = GroupFixture::german_tree().await;
        let mut config = Config::from_env();
        config.token_hash = Some(hash_token("route-secret"));
        let docker = bollard::Docker::connect_with_http_defaults().unwrap();
        let state = AppState::new(docker, config, fixture.pool.clone());
        let admin_session = state
            .identity
            .issue_session(
                &fixture.german_a_teacher.user_id,
                None,
                Some(&fixture.german_a),
            )
            .await
            .unwrap();
        let app: Router = super::router(state.clone()).with_state(state.clone());

        let created = app.clone().oneshot(Request::post("/api/users")
            .header(header::AUTHORIZATION, format!("Bearer {}", admin_session.access_token))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(json!({"groupId":fixture.german_a,"email":"learner@example.test","displayName":"Learner","identityType":"learner","idempotencyKey":"create-learner"}).to_string())).unwrap()).await.unwrap();
        assert_eq!(created.status(), StatusCode::CREATED);
        let created: Value =
            serde_json::from_slice(&to_bytes(created.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        let user_id = created["id"].as_str().unwrap();
        let learner_session = state
            .identity
            .issue_session(user_id, Some("learner-device"), Some(&fixture.german_a))
            .await
            .unwrap();

        let detail = app
            .clone()
            .oneshot(
                Request::get(format!("/api/users/{user_id}?groupId={}", fixture.german_a))
                    .header(
                        header::AUTHORIZATION,
                        format!("Bearer {}", admin_session.access_token),
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(detail.status(), StatusCode::OK);
        let detail: Value =
            serde_json::from_slice(&to_bytes(detail.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(detail["sessions"].as_array().unwrap().len(), 1);
        let session_id = detail["sessions"][0]["id"].as_str().unwrap();

        let revoked = app
            .clone()
            .oneshot(
                Request::delete(format!(
                    "/api/users/{user_id}/sessions/{session_id}?groupId={}",
                    fixture.german_a
                ))
                .header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", admin_session.access_token),
                )
                .body(Body::empty())
                .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(revoked.status(), StatusCode::NO_CONTENT);
        assert!(state
            .identity
            .rotate_refresh_token(&learner_session.refresh_token)
            .await
            .is_err());

        sqlx::query("INSERT INTO group_memberships(id,group_id,user_id,status,created_at) VALUES('learner-sibling',?,?,'active',1)").bind(&fixture.german_b).bind(user_id).execute(&fixture.pool).await.unwrap();
        let cross_scope = app
            .clone()
            .oneshot(
                Request::patch(format!(
                    "/api/users/{user_id}/status?groupId={}",
                    fixture.german_a
                ))
                .header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", admin_session.access_token),
                )
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({"status":"suspended"}).to_string()))
                .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(cross_scope.status(), StatusCode::FORBIDDEN);
        sqlx::query("UPDATE group_memberships SET status='archived' WHERE id='learner-sibling'")
            .execute(&fixture.pool)
            .await
            .unwrap();

        let suspended = app
            .oneshot(
                Request::patch(format!(
                    "/api/users/{user_id}/status?groupId={}",
                    fixture.german_a
                ))
                .header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", admin_session.access_token),
                )
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({"status":"suspended"}).to_string()))
                .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(suspended.status(), StatusCode::OK);
        let status: String = sqlx::query_scalar("SELECT status FROM users WHERE id = ?")
            .bind(user_id)
            .fetch_one(&fixture.pool)
            .await
            .unwrap();
        assert_eq!(status, "suspended");
    }
}
