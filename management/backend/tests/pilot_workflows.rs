use axum::{body::{to_bytes, Body}, http::{header, Request, StatusCode}, Router};
use mlearn_management::{application_router, config::Config, db::connect_database, state::AppState};
use serde_json::{json, Value};
use tower::ServiceExt;

async fn request(app: &Router, method: &str, path: &str, token: Option<&str>, body: Value, expected: StatusCode) -> Value {
    let mut builder = Request::builder().method(method).uri(path).header(header::CONTENT_TYPE, "application/json");
    if let Some(token) = token { builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}")); }
    let response = app.clone().oneshot(builder.body(if body.is_null() { Body::empty() } else { Body::from(body.to_string()) }).unwrap()).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    assert_eq!(status, expected, "{method} {path}: {value}");
    value
}

#[tokio::test]
async fn fresh_school_onboarding_calendar_and_sessions_survive_restart() {
    let directory = std::env::temp_dir().join(format!("mlearn-pilot-{}", uuid::Uuid::now_v7()));
    std::fs::create_dir_all(&directory).unwrap();
    let mut config = Config::from_env();
    config.management_db_path = directory.join("management.db").to_string_lossy().into_owned();
    config.encryption_key_path = directory.join("encryption-key").to_string_lossy().into_owned();
    config.policy_signing_key_path = directory.join("signing-key").to_string_lossy().into_owned();
    config.token_hash = Some(mlearn_management::auth::hash_token("pilot-recovery"));
    config.encryption_key = None;
    config.env_mode = mlearn_management::config::EnvMode::Production;
    config.allowed_origins = vec!["https://learner.school.test".into()];
    let pool = connect_database(&config).await.unwrap();
    let app = application_router(AppState::try_new(bollard::Docker::connect_with_http_defaults().unwrap(), config.clone(), pool.clone()).unwrap());
    for (origin, allowed) in [("https://learner.school.test", true), ("https://untrusted.test", false)] {
        let response = app.clone().oneshot(Request::builder().method("OPTIONS").uri("/api/llm/stream")
            .header(header::ORIGIN, origin).header(header::ACCESS_CONTROL_REQUEST_METHOD,"POST")
            .header(header::ACCESS_CONTROL_REQUEST_HEADERS,"authorization,content-type").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(response.headers().contains_key(header::ACCESS_CONTROL_ALLOW_ORIGIN), allowed);
    }
    let bootstrap = request(&app, "POST", "/api/auth/bootstrap", Some("pilot-recovery"), json!({"email":"root@pilot.test","password":"Pilot root password 123!"}), StatusCode::OK).await;
    let root = bootstrap["session"]["accessToken"].as_str().unwrap();
    let groups = request(&app,"GET","/api/groups/eligible",Some(root),Value::Null,StatusCode::OK).await;
    let school = groups["groups"][0]["id"].as_str().unwrap();
    request(&app,"GET",&format!("/api/notifications?groupId={school}"),Some(root),Value::Null,StatusCode::OK).await;
    request(&app,"GET",&format!("/api/governance/summary?groupId={school}"),Some(root),Value::Null,StatusCode::OK).await;
    let usage = request(&app,"GET",&format!("/api/llm/usage?groupId={school}"),Some(root),Value::Null,StatusCode::OK).await;
    assert_eq!(usage["buckets"],json!([]));
    let members = request(&app,"GET",&format!("/api/groups/{school}/memberships"),Some(root),Value::Null,StatusCode::OK).await;
    let root_membership = members["memberships"][0]["id"].as_str().unwrap();
    request(&app,"PATCH",&format!("/api/groups/{school}/memberships/{root_membership}"),Some(root),json!({"capabilities":[]}),StatusCode::FORBIDDEN).await;
    let calendar_path = format!("/api/llm/quota-calendar?rootGroupId={school}");
    let empty = request(&app,"GET",&calendar_path,Some(root),Value::Null,StatusCode::OK).await;
    assert!(empty["current"].is_null());
    request(&app,"PUT","/api/llm/quota-calendar",Some(root),json!({"rootGroupId":school,"timezone":"Invalid/Zone","termStartsAt":time::OffsetDateTime::now_utc().unix_timestamp()-86400,"termEndsAt":time::OffsetDateTime::now_utc().unix_timestamp()+86400*90}),StatusCode::BAD_REQUEST).await;
    request(&app,"PUT","/api/llm/quota-calendar",Some(root),json!({"rootGroupId":school,"timezone":"Europe/Zurich","termStartsAt":time::OffsetDateTime::now_utc().unix_timestamp()-86400,"termEndsAt":time::OffsetDateTime::now_utc().unix_timestamp()+86400*90}),StatusCode::OK).await;
    let policy = request(&app,"POST",&format!("/api/groups/{school}/policies"),Some(root),json!({"name":"Pilot safeguards","description":""}),StatusCode::OK).await;
    let policy_id = policy["id"].as_str().unwrap();
    let draft = request(&app,"PUT",&format!("/api/policies/{policy_id}/draft"),Some(root),json!({"document":{"settings":{},"features":{},"llm":{"enabled":false,"quotas":[]},"governance":{}},"expectedDocumentHash":null}),StatusCode::OK).await;
    request(&app,"POST",&format!("/api/policies/{policy_id}/validate"),Some(root),Value::Null,StatusCode::OK).await;
    request(&app,"POST",&format!("/api/policies/{policy_id}/publish"),Some(root),json!({"summary":"Pilot safeguards","validatedDocumentHash":draft["documentHash"]}),StatusCode::OK).await;
    let child = request(&app,"POST","/api/groups",Some(root),json!({"parentId":school,"name":"Pilot class","slug":"pilot-class"}),StatusCode::CREATED).await;
    let child_id = child["id"].as_str().unwrap();
    let invitation_path = format!("/api/groups/{child_id}/provisioning/invitations");
    let invite = request(&app,"POST",&invitation_path,Some(root),json!({"email":"teacher@pilot.test","identityType":"teacher","capabilities":["group.view","members.view","analytics.view"],"expiresAt":time::OffsetDateTime::now_utc().unix_timestamp()+3600}),StatusCode::CREATED).await;
    let acceptance = json!({"token":invite["secret"],"email":"teacher@pilot.test","displayName":"Pilot teacher","password":"Pilot teacher password 123!"});
    request(&app,"POST","/api/provisioning/invitations/accept",None,acceptance.clone(),StatusCode::OK).await;
    request(&app,"POST","/api/provisioning/invitations/accept",None,acceptance,StatusCode::UNAUTHORIZED).await;
    let login = request(&app,"POST","/api/auth/login",None,json!({"email":"teacher@pilot.test","password":"Pilot teacher password 123!"}),StatusCode::OK).await;
    let teacher = login["session"]["accessToken"].as_str().unwrap();
    request(&app,"POST",&format!("/api/groups/{child_id}/activate"),Some(teacher),Value::Null,StatusCode::NO_CONTENT).await;
    request(&app,"GET",&format!("/api/users?groupId={child_id}"),Some(teacher),Value::Null,StatusCode::OK).await;
    request(&app,"GET",&format!("/api/users?groupId={school}"),Some(teacher),Value::Null,StatusCode::FORBIDDEN).await;
    request(&app,"GET","/api/config",Some(teacher),Value::Null,StatusCode::FORBIDDEN).await;
    request(&app,"GET","/api/obsolete-operation",None,Value::Null,StatusCode::NOT_FOUND).await;
    drop(app);
    pool.close().await;
    let reopened = connect_database(&config).await.unwrap();
    let app = application_router(AppState::try_new(bollard::Docker::connect_with_http_defaults().unwrap(), config, reopened.clone()).unwrap());
    let calendar = request(&app,"GET",&calendar_path,Some(root),Value::Null,StatusCode::OK).await;
    assert_eq!(calendar["current"]["timezone"],"Europe/Zurich");
    request(&app,"GET","/api/auth/me",Some(teacher),Value::Null,StatusCode::OK).await;
    request(&app,"POST","/api/auth/logout",Some(teacher),Value::Null,StatusCode::NO_CONTENT).await;
    request(&app,"GET","/api/auth/me",Some(teacher),Value::Null,StatusCode::UNAUTHORIZED).await;
    drop(app);
    reopened.close().await;
    std::fs::remove_dir_all(directory).unwrap();
}
