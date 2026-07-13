use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
};
use mlearn_management::{
    application_router,
    authorization::Capability,
    config::Config,
    state::AppState,
};
use serde_json::{json, Value};
use sqlx::sqlite::SqlitePoolOptions;
use time::OffsetDateTime;
use tower::ServiceExt;

fn valid_definition(group_id: &str) -> Value {
    json!({
        "groupId": group_id,
        "from": 1_700_000_000_000_i64,
        "to": 1_700_086_400_000_i64,
        "preset": "custom",
        "comparison": "previousPeriod",
        "granularity": "daily",
        "tab": "overview",
        "visibleMetrics": ["readerPages", "watchSeconds"],
        "breakdown": "none"
    })
}

async fn response_json(response: axum::response::Response) -> Value {
    serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
}

fn authorized(request: axum::http::request::Builder, token: &str) -> axum::http::request::Builder {
    request.header(header::AUTHORIZATION, format!("Bearer {token}"))
}

struct Fixture {
    app: axum::Router,
    owner_token: String,
    peer_token: String,
    group_id: String,
    unauthorized_group_id: String,
}

async fn fixture() -> Fixture {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    let now = OffsetDateTime::now_utc().unix_timestamp();
    for user_id in ["owner", "peer"] {
        sqlx::query("INSERT INTO users(id,email,normalized_email,display_name,status,identity_type,is_root,created_at,updated_at) VALUES(?,?,?,?, 'active','teacher',0,?,?)")
            .bind(user_id)
            .bind(format!("{user_id}@test.invalid"))
            .bind(format!("{user_id}@test.invalid"))
            .bind(user_id)
            .bind(now)
            .bind(now)
            .execute(&pool)
            .await
            .unwrap();
    }
    sqlx::query("INSERT INTO groups(id,parent_id,name,slug,status,created_at) VALUES('school',NULL,'School','school','active',?)")
        .bind(now)
        .execute(&pool)
        .await
        .unwrap();
    for (id, name) in [("class-a", "Class A"), ("class-b", "Class B")] {
        sqlx::query("INSERT INTO groups(id,parent_id,name,slug,status,created_at) VALUES(?,'school',?,?,'active',?)")
            .bind(id)
            .bind(name)
            .bind(id)
            .bind(now)
            .execute(&pool)
            .await
            .unwrap();
    }
    for (membership_id, user_id) in [("owner-a", "owner"), ("peer-a", "peer")] {
        sqlx::query("INSERT INTO group_memberships(id,group_id,user_id,status,created_at) VALUES(?,'class-a',?,'active',?)")
            .bind(membership_id)
            .bind(user_id)
            .bind(now)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO membership_capabilities(membership_id,capability) VALUES(?,?)")
            .bind(membership_id)
            .bind(Capability::AnalyticsView.as_str())
            .execute(&pool)
            .await
            .unwrap();
    }
    let state = AppState::new(
        bollard::Docker::connect_with_http_defaults().unwrap(),
        Config::from_env(),
        pool,
    );
    let owner = state.identity.issue_session("owner", None, Some("class-a")).await.unwrap();
    let peer = state.identity.issue_session("peer", None, Some("class-a")).await.unwrap();
    Fixture {
        app: application_router(state),
        owner_token: owner.access_token,
        peer_token: peer.access_token,
        group_id: "class-a".into(),
        unauthorized_group_id: "class-b".into(),
    }
}

#[tokio::test]
async fn analytics_views_are_private_owned_and_authorized_by_their_saved_group() {
    let fixture = fixture().await;
    let app = fixture.app;

    let created = app
        .clone()
        .oneshot(
            authorized(
                Request::post("/api/analytics/views").header(header::CONTENT_TYPE, "application/json"),
                &fixture.owner_token,
            )
            .body(Body::from(
                json!({"name": "Weekly activity", "definition": valid_definition(&fixture.group_id)})
                    .to_string(),
            ))
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    let created = response_json(created).await;
    assert_eq!(created["name"], "Weekly activity");
    assert_eq!(created["definition"], valid_definition(&fixture.group_id));
    let view_id = created["id"].as_str().unwrap();

    let owner_list = app
        .clone()
        .oneshot(
            authorized(
                Request::get(format!("/api/analytics/views?groupId={}", fixture.group_id)),
                &fixture.owner_token,
            )
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(owner_list.status(), StatusCode::OK);
    assert_eq!(response_json(owner_list).await["items"].as_array().unwrap().len(), 1);

    let peer_list = app
        .clone()
        .oneshot(
            authorized(
                Request::get(format!("/api/analytics/views?groupId={}", fixture.group_id)),
                &fixture.peer_token,
            )
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(peer_list.status(), StatusCode::OK);
    assert!(response_json(peer_list).await["items"].as_array().unwrap().is_empty());

    for request in [
        authorized(
            Request::get(format!("/api/analytics/views/{view_id}")),
            &fixture.peer_token,
        )
        .body(Body::empty())
        .unwrap(),
        authorized(
            Request::put(format!("/api/analytics/views/{view_id}")).header(header::CONTENT_TYPE, "application/json"),
            &fixture.peer_token,
        )
        .body(Body::from(json!({"name": "Peer change", "definition": valid_definition(&fixture.group_id)}).to_string()))
        .unwrap(),
        authorized(
            Request::delete(format!("/api/analytics/views/{view_id}")),
            &fixture.peer_token,
        )
        .body(Body::empty())
        .unwrap(),
    ] {
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    let updated = app
        .clone()
        .oneshot(
            authorized(
                Request::put(format!("/api/analytics/views/{view_id}")).header(header::CONTENT_TYPE, "application/json"),
                &fixture.owner_token,
            )
            .body(Body::from(json!({"name": "Updated activity", "definition": valid_definition(&fixture.group_id)}).to_string()))
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(updated.status(), StatusCode::OK);
    assert_eq!(response_json(updated).await["name"], "Updated activity");

    let denied_group = app
        .clone()
        .oneshot(
            authorized(
                Request::post("/api/analytics/views").header(header::CONTENT_TYPE, "application/json"),
                &fixture.owner_token,
            )
            .body(Body::from(json!({"name": "Sibling", "definition": valid_definition(&fixture.unauthorized_group_id)}).to_string()))
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(denied_group.status(), StatusCode::FORBIDDEN);

    let deleted = app
        .clone()
        .oneshot(
            authorized(
                Request::delete(format!("/api/analytics/views/{view_id}")),
                &fixture.owner_token,
            )
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn analytics_views_reject_invalid_names_definitions_and_listing_groups() {
    let fixture = fixture().await;
    let app = fixture.app;
    let mut unknown_field = valid_definition(&fixture.group_id);
    unknown_field["unexpected"] = json!(true);
    let mut unknown_metric = valid_definition(&fixture.group_id);
    unknown_metric["visibleMetrics"] = json!(["not-a-metric"]);
    let cases = [
        json!({"name": "", "definition": valid_definition(&fixture.group_id)}),
        json!({"name": "x".repeat(81), "definition": valid_definition(&fixture.group_id)}),
        json!({"name": "Unknown field", "definition": unknown_field}),
        json!({"name": "Unknown metric", "definition": unknown_metric}),
    ];
    for body in cases {
        let response = app
            .clone()
            .oneshot(
                authorized(
                    Request::post("/api/analytics/views").header(header::CONTENT_TYPE, "application/json"),
                    &fixture.owner_token,
                )
                .body(Body::from(body.to_string()))
                .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    let response = app
        .oneshot(
            authorized(
                Request::get(format!("/api/analytics/views?groupId={}", fixture.unauthorized_group_id)),
                &fixture.owner_token,
            )
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}
