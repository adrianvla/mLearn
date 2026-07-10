use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, patch, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::{
    authorization::Capability,
    error::AppError,
    groups::{Group, GroupService, Membership},
    identity::{IdentityType, Principal},
    state::AppState,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateGroupRequest {
    parent_id: String,
    name: String,
    slug: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateGroupRequest {
    parent_id: Option<String>,
    name: Option<String>,
    slug: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MembershipRequest {
    user_id: String,
    #[serde(default)]
    capabilities: Vec<Capability>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DelegationRequest {
    user_id: String,
    capabilities: Vec<Capability>,
}

#[derive(Deserialize)]
struct UpdateMembershipRequest {
    capabilities: Vec<Capability>,
}

#[derive(Deserialize)]
struct InvitationRequest {
    email: String,
}

#[derive(Serialize)]
struct GroupsResponse {
    groups: Vec<Group>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EligibleGroup {
    id: String,
    name: String,
}

#[derive(Serialize)]
struct EligibleGroupsResponse {
    groups: Vec<EligibleGroup>,
}

#[derive(Serialize)]
struct MembershipsResponse {
    memberships: Vec<Membership>,
}

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/api/groups", get(list_groups).post(create_group))
        .route("/api/groups/eligible", get(list_eligible_groups))
        .route("/api/groups/{id}", get(get_group).patch(update_group))
        .route("/api/groups/{id}/archive", post(archive_group))
        .route(
            "/api/groups/{id}/memberships",
            get(list_memberships).post(add_membership),
        )
        .route(
            "/api/groups/{id}/memberships/{membership_id}",
            patch(update_membership).delete(remove_membership),
        )
        .route("/api/groups/{id}/delegations", post(delegate_capabilities))
        .route(
            "/api/groups/{id}/invitations",
            get(list_invitations).post(invite),
        )
        .route(
            "/api/groups/{id}/invitations/{membership_id}",
            delete(remove_membership),
        )
        .route("/api/groups/{id}/activate", post(activate_group))
        .with_state(state)
}

async fn list_groups(
    State(state): State<AppState>,
    principal: Principal,
) -> Result<Json<GroupsResponse>, AppError> {
    let groups = GroupService::new(state.db).visible_tree(&principal).await?;
    Ok(Json(GroupsResponse { groups }))
}

async fn list_eligible_groups(
    State(state): State<AppState>,
    principal: Principal,
) -> Result<Json<EligibleGroupsResponse>, AppError> {
    let groups = GroupService::new(state.db)
        .eligible_groups(&principal)
        .await?
        .into_iter()
        .map(|group| EligibleGroup {
            id: group.id,
            name: group.name,
        })
        .collect();
    Ok(Json(EligibleGroupsResponse { groups }))
}

async fn create_group(
    State(state): State<AppState>,
    principal: Principal,
    Json(request): Json<CreateGroupRequest>,
) -> Result<(StatusCode, Json<Group>), AppError> {
    let group = GroupService::new(state.db)
        .create_group(&principal, &request.parent_id, &request.name, &request.slug)
        .await?;
    Ok((StatusCode::CREATED, Json(group)))
}

async fn get_group(
    State(state): State<AppState>,
    principal: Principal,
    Path(id): Path<String>,
) -> Result<Json<Group>, AppError> {
    Ok(Json(
        GroupService::new(state.db)
            .get_group(&principal, &id)
            .await?,
    ))
}

async fn update_group(
    State(state): State<AppState>,
    principal: Principal,
    Path(id): Path<String>,
    Json(request): Json<UpdateGroupRequest>,
) -> Result<Json<Group>, AppError> {
    let service = GroupService::new(state.db);
    let current = service.get_group(&principal, &id).await?;
    let parent_id = request
        .parent_id
        .as_deref()
        .or(current.parent_id.as_deref());
    let group = service
        .update_group(
            &principal,
            &id,
            parent_id,
            request.name.as_deref().unwrap_or(&current.name),
            request.slug.as_deref().unwrap_or(&current.slug),
        )
        .await?;
    Ok(Json(group))
}

async fn archive_group(
    State(state): State<AppState>,
    principal: Principal,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    GroupService::new(state.db)
        .archive_group(&principal, &id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_memberships(
    State(state): State<AppState>,
    principal: Principal,
    Path(id): Path<String>,
) -> Result<Json<MembershipsResponse>, AppError> {
    let memberships = GroupService::new(state.db)
        .list_memberships(&principal, &id)
        .await?;
    Ok(Json(MembershipsResponse { memberships }))
}

async fn add_membership(
    State(state): State<AppState>,
    principal: Principal,
    Path(id): Path<String>,
    Json(request): Json<MembershipRequest>,
) -> Result<(StatusCode, Json<Membership>), AppError> {
    let member = member_principal(request.user_id);
    let membership = GroupService::new(state.db)
        .add_membership(&principal, &id, &member, &request.capabilities)
        .await?;
    Ok((StatusCode::CREATED, Json(membership)))
}

async fn delegate_capabilities(
    State(state): State<AppState>,
    principal: Principal,
    Path(id): Path<String>,
    Json(request): Json<DelegationRequest>,
) -> Result<Json<Membership>, AppError> {
    let member = member_principal(request.user_id);
    Ok(Json(
        GroupService::new(state.db)
            .delegate_capabilities(&principal, &id, &member, &request.capabilities)
            .await?,
    ))
}

async fn update_membership(
    State(state): State<AppState>,
    principal: Principal,
    Path((id, membership_id)): Path<(String, String)>,
    Json(request): Json<UpdateMembershipRequest>,
) -> Result<Json<Membership>, AppError> {
    Ok(Json(
        GroupService::new(state.db)
            .update_membership_capabilities(&principal, &id, &membership_id, &request.capabilities)
            .await?,
    ))
}

async fn remove_membership(
    State(state): State<AppState>,
    principal: Principal,
    Path((id, membership_id)): Path<(String, String)>,
) -> Result<StatusCode, AppError> {
    GroupService::new(state.db)
        .archive_membership(&principal, &id, &membership_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn invite(
    State(state): State<AppState>,
    principal: Principal,
    Path(id): Path<String>,
    Json(request): Json<InvitationRequest>,
) -> Result<(StatusCode, Json<Membership>), AppError> {
    let membership = GroupService::new(state.db)
        .invite(&principal, &id, &request.email)
        .await?;
    Ok((StatusCode::CREATED, Json(membership)))
}

async fn list_invitations(
    State(state): State<AppState>,
    principal: Principal,
    Path(id): Path<String>,
) -> Result<Json<MembershipsResponse>, AppError> {
    let mut memberships = GroupService::new(state.db)
        .list_memberships(&principal, &id)
        .await?;
    memberships.retain(|membership| membership.status == "invited");
    Ok(Json(MembershipsResponse { memberships }))
}

async fn activate_group(
    State(state): State<AppState>,
    principal: Principal,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    GroupService::new(state.db)
        .activate(&principal, &id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

fn member_principal(user_id: String) -> Principal {
    Principal {
        user_id,
        service_key_id: None,
        session_id: String::new(),
        device_id: String::new(),
        active_group_id: None,
        identity_type: IdentityType::Learner,
        is_root: false,
    }
}

#[cfg(test)]
mod tests {
    use axum::{
        body::{to_bytes, Body},
        http::{header, Request, StatusCode},
        Router,
    };
    use serde_json::{json, Value};
    use sqlx::sqlite::SqlitePoolOptions;
    use tower::ServiceExt;

    use crate::{auth::hash_token, config::Config, routes, state::AppState};

    async fn fixture() -> (Router, String, sqlx::SqlitePool, AppState) {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let bootstrap = "groups-route-bootstrap".to_string();
        let mut config = Config::from_env();
        config.token_hash = Some(hash_token(&bootstrap));
        let docker = bollard::Docker::connect_with_http_defaults().unwrap();
        let state = AppState::new(docker, config, pool.clone());
        let app = Router::new()
            .merge(routes::auth::router(state.clone()))
            .merge(super::router(state.clone()))
            .with_state(state.clone());
        (app, bootstrap, pool, state)
    }

    async fn request(
        app: &Router,
        method: &str,
        uri: &str,
        body: Value,
        bearer: Option<&str>,
    ) -> (StatusCode, Value) {
        let mut builder = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(token) = bearer {
            builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        let response = app
            .clone()
            .oneshot(builder.body(Body::from(body.to_string())).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    #[tokio::test]
    async fn bootstrap_membership_authorizes_group_creation_and_audits_it() {
        let (app, bootstrap, pool, _) = fixture().await;
        let (status, bootstrapped) = request(
            &app,
            "POST",
            "/api/auth/bootstrap",
            json!({ "email": "root@school.test", "password": "Correct Horse Battery Staple" }),
            Some(&bootstrap),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{bootstrapped}");
        let token = bootstrapped["session"]["accessToken"].as_str().unwrap();
        let root_group_id: String =
            sqlx::query_scalar("SELECT id FROM groups WHERE parent_id IS NULL")
                .fetch_one(&pool)
                .await
                .unwrap();

        let (status, created) = request(
            &app,
            "POST",
            "/api/groups",
            json!({ "parentId": root_group_id, "name": "German", "slug": "german" }),
            Some(token),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{created}");
        assert_eq!(created["parentId"], root_group_id);
        let audit_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_events WHERE action = 'group.created' AND target_id = ?",
        )
        .bind(created["id"].as_str().unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(audit_count, 1);
    }

    #[tokio::test]
    async fn group_routes_reject_recovery_credentials_and_missing_sessions() {
        let (app, bootstrap, _, _) = fixture().await;
        let (recovery_status, _) =
            request(&app, "GET", "/api/groups", Value::Null, Some(&bootstrap)).await;
        let (anonymous_status, _) = request(&app, "GET", "/api/groups", Value::Null, None).await;
        assert_eq!(recovery_status, StatusCode::UNAUTHORIZED);
        assert_eq!(anonymous_status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn eligible_groups_returns_only_the_authenticated_visible_tree() {
        let (app, bootstrap, pool, _) = fixture().await;
        let (status, bootstrapped) = request(
            &app,
            "POST",
            "/api/auth/bootstrap",
            json!({ "email": "root@school.test", "password": "Correct Horse Battery Staple" }),
            Some(&bootstrap),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{bootstrapped}");
        let token = bootstrapped["session"]["accessToken"].as_str().unwrap();
        let root_group_id: String =
            sqlx::query_scalar("SELECT id FROM groups WHERE parent_id IS NULL")
                .fetch_one(&pool)
                .await
                .unwrap();

        let (status, payload) = request(
            &app,
            "GET",
            "/api/groups/eligible",
            Value::Null,
            Some(token),
        )
        .await;

        assert_eq!(status, StatusCode::OK, "{payload}");
        let groups = payload["groups"].as_array().unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0]["id"], root_group_id);
    }

    #[tokio::test]
    async fn eligible_groups_does_not_disclose_an_inaccessible_parent_id() {
        let (app, _bootstrap, pool, state) = fixture().await;
        sqlx::query("INSERT INTO users (id, email, normalized_email, display_name, status, identity_type, is_root, created_at, updated_at) VALUES ('learner', 'learner@school.test', 'learner@school.test', 'Learner', 'active', 'learner', 0, 1, 1)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO groups (id, parent_id, name, slug, status, created_at) VALUES ('hidden-parent', NULL, 'Hidden Parent', 'hidden-parent', 'active', 1)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO groups (id, parent_id, name, slug, status, created_at) VALUES ('learner-group', 'hidden-parent', 'Learner Group', 'learner-group', 'active', 1)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO group_memberships (id, group_id, user_id, status, created_at) VALUES ('learner-membership', 'learner-group', 'learner', 'active', 1)")
            .execute(&pool)
            .await
            .unwrap();
        let session = state
            .identity
            .issue_session("learner", None, None)
            .await
            .unwrap();

        let (status, payload) = request(
            &app,
            "GET",
            "/api/groups/eligible",
            Value::Null,
            Some(&session.access_token),
        )
        .await;

        assert_eq!(status, StatusCode::OK, "{payload}");
        assert_eq!(payload["groups"], json!([{ "id": "learner-group", "name": "Learner Group" }]));
        assert!(payload.to_string().find("hidden-parent").is_none());
    }
}
