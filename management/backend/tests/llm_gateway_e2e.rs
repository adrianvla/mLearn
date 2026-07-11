use std::{
    collections::{HashMap, VecDeque},
    future::Future,
    net::SocketAddr,
    pin::Pin,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
    Router,
};
use mlearn_management::{
    application_router,
    authorization::Capability,
    config::Config,
    error::AppError,
    identity::{IdentityType, Principal},
    llm::{endpoint::EndpointResolver, quota::QuotaService},
    state::AppState,
};
use serde_json::Value;
use sqlx::{sqlite::SqlitePoolOptions, Row, SqlitePool};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
use tower::ServiceExt;
use uuid::Uuid;

struct FixedResolver {
    address: SocketAddr,
    calls: Arc<AtomicUsize>,
}

impl EndpointResolver for FixedResolver {
    fn resolve<'a>(
        &'a self,
        _host: &'a str,
        _port: u16,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<SocketAddr>, AppError>> + Send + 'a>> {
        Box::pin(async move {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(vec![self.address])
        })
    }
}

struct Fixture {
    app: Router,
    pool: SqlitePool,
    db_path: String,
    learner_a: String,
    learner_b: String,
    teacher_b: String,
    root: String,
    resolver_calls: Arc<AtomicUsize>,
    provider_contacts: Arc<AtomicUsize>,
    key_paths: Vec<String>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        for path in &self.key_paths {
            let _ = std::fs::remove_file(path);
        }
        for path in [
            self.db_path.clone(),
            format!("{}-wal", self.db_path),
            format!("{}-shm", self.db_path),
        ] {
            let _ = std::fs::remove_file(path);
        }
    }
}

async fn mock_ollama(
    responses: Vec<(u16, &'static str, Duration)>,
) -> (SocketAddr, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let responses = Arc::new(Mutex::new(VecDeque::from(responses)));
    let contacts = Arc::new(AtomicUsize::new(0));
    let task_contacts = contacts.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                break;
            };
            let responses = responses.clone();
            let contacts = task_contacts.clone();
            tokio::spawn(async move {
                contacts.fetch_add(1, Ordering::SeqCst);
                let mut request = vec![0_u8; 64 * 1024];
                let _ = socket.read(&mut request).await;
                let (status, body, delay) = responses.lock().unwrap().pop_front().unwrap_or((
                    503,
                    "mock response queue exhausted",
                    Duration::ZERO,
                ));
                tokio::time::sleep(delay).await;
                let reason = if status == 200 { "OK" } else { "Failure" };
                let response = format!(
                    "HTTP/1.1 {status} {reason}\r\nContent-Type: application/x-ndjson\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                socket.write_all(response.as_bytes()).await.unwrap();
            });
        }
    });
    (address, contacts)
}

async fn setup(address: SocketAddr, provider_contacts: Arc<AtomicUsize>) -> Fixture {
    let db_path = std::env::temp_dir()
        .join(format!("mlearn-llm-e2e-{}.db", Uuid::now_v7()))
        .to_string_lossy()
        .into_owned();
    let options = mlearn_management::db::sqlite_connect_options(&db_path).unwrap();
    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(options)
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();

    for (id, kind, root) in [
        ("root", "admin", 1_i64),
        ("teacher-a", "teacher", 0),
        ("teacher-b", "teacher", 0),
        ("learner-a", "learner", 0),
        ("learner-b", "learner", 0),
    ] {
        sqlx::query("INSERT INTO users(id,email,normalized_email,display_name,status,identity_type,is_root,created_at,updated_at) VALUES(?,?,?,?, 'active',?,?,1,1)")
            .bind(id)
            .bind(format!("{id}@school.invalid"))
            .bind(format!("{id}@school.invalid"))
            .bind(id)
            .bind(kind)
            .bind(root)
            .execute(&pool)
            .await
            .unwrap();
    }
    sqlx::query("INSERT INTO groups(id,parent_id,name,slug,status,created_at) VALUES ('school',NULL,'School','school','active',1),('class-a','school','Class A','class-a','active',1),('class-b','school','Class B','class-b','active',1)")
        .execute(&pool).await.unwrap();
    for (membership, group, user) in [
        ("root-member", "school", "root"),
        ("teacher-a-member", "class-a", "teacher-a"),
        ("teacher-b-member", "class-b", "teacher-b"),
        ("learner-a-member", "class-a", "learner-a"),
        ("learner-b-member", "class-b", "learner-b"),
    ] {
        sqlx::query("INSERT INTO group_memberships(id,group_id,user_id,status,created_at) VALUES(?,?,?,'active',1)")
            .bind(membership).bind(group).bind(user).execute(&pool).await.unwrap();
    }
    for capability in [
        Capability::LlmConfigure,
        Capability::PoliciesView,
        Capability::PoliciesEdit,
        Capability::PoliciesPublish,
        Capability::ConversationsView,
        Capability::AnalyticsView,
    ] {
        sqlx::query(
            "INSERT INTO membership_capabilities(membership_id,capability) VALUES('root-member',?)",
        )
        .bind(capability.as_str())
        .execute(&pool)
        .await
        .unwrap();
    }
    for membership in ["teacher-a-member", "teacher-b-member"] {
        sqlx::query("INSERT INTO membership_capabilities(membership_id,capability) VALUES(?,'conversations.view')")
            .bind(membership).execute(&pool).await.unwrap();
    }

    let root_principal = Principal {
        user_id: "root".into(),
        service_key_id: None,
        session_id: "setup".into(),
        device_id: "setup".into(),
        active_group_id: Some("school".into()),
        identity_type: IdentityType::Admin,
        is_root: true,
    };
    QuotaService::new(pool.clone())
        .configure_calendar(
            &root_principal,
            "school",
            "Europe/Zurich",
            1_735_689_600,
            1_830_297_600,
        )
        .await
        .unwrap();
    for (id, group, metric, limit) in [
        ("root-cost", "school", "costMicros", 1_000_000_i64),
        ("class-a-cost", "class-a", "costMicros", 500_000),
        ("class-b-cost", "class-b", "costMicros", 500_000),
        ("root-requests", "school", "requests", 3),
        ("class-a-requests", "class-a", "requests", 1),
        ("class-b-requests", "class-b", "requests", 2),
    ] {
        sqlx::query("INSERT INTO quota_definitions(id,owner_group_id,subject_kind,subject_id,metric,period,limit_value,created_by_user_id,created_at,updated_at) VALUES(?,?,'group',?,?, 'monthly',?,'root',1,1)")
            .bind(id).bind(group).bind(group).bind(metric).bind(limit).execute(&pool).await.unwrap();
    }
    sqlx::query("INSERT INTO llm_providers(id,group_id,name,provider_kind,base_url,status,created_by_user_id,created_at,updated_at) VALUES('provider','school','Pinned mock','ollama',?,'active','root',1,1)")
        .bind(format!("http://ollama:{}", address.port())).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO llm_models(id,group_id,provider_id,model_key,upstream_model,status,created_by_user_id,created_at,updated_at) VALUES('model','school','provider','balanced','school-model','active','root',1,1)")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO provider_price_versions(id,group_id,provider_id,model_id,currency,unit,input_cost_micros,output_cost_micros,idempotency_key,created_by_user_id,created_at) VALUES('price','school','provider','model','CHF','perMillionTokens',1000,2000,'price-v1','root',1)")
        .execute(&pool).await.unwrap();
    let policy = serde_json::json!({"llm":{"enabled":true,"requestsPerMinute":3,"maxConcurrentStreams":1,"allowedProviders":["provider"],"allowedModels":["model"],"quotas":[{"metric":"costMicros","limit":1000000_i64,"period":"monthly","hard":true},{"metric":"requests","limit":3,"period":"monthly","hard":true}]}}).to_string();
    sqlx::query("INSERT INTO policy_versions(id,group_id,document_json,document_hash,compiled_hash,author_user_id,summary,parent_version_ids_json,created_at) VALUES('policy','school',?,'document-hash','compiled-hash','root','governed','[]',1)")
        .bind(policy).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO active_policies(group_id,policy_version_id,activated_at) VALUES('school','policy',1)")
        .execute(&pool).await.unwrap();

    let signing = std::env::temp_dir()
        .join(format!("mlearn-llm-e2e-signing-{}", Uuid::now_v7()))
        .to_string_lossy()
        .into_owned();
    let encryption = std::env::temp_dir()
        .join(format!("mlearn-llm-e2e-encryption-{}", Uuid::now_v7()))
        .to_string_lossy()
        .into_owned();
    let mut config = Config::from_env();
    config.management_db_path = db_path.clone();
    config.policy_signing_key_path = signing.clone();
    config.encryption_key_path = encryption.clone();
    config.encryption_key = None;
    config.conversation_retention_days = 30;
    let resolver_calls = Arc::new(AtomicUsize::new(0));
    let state = AppState::try_new(
        bollard::Docker::connect_with_http_defaults().unwrap(),
        config,
        pool.clone(),
    )
    .unwrap()
    .with_llm_endpoint_resolver(
        Arc::new(FixedResolver {
            address,
            calls: resolver_calls.clone(),
        }),
        Duration::from_secs(3),
    );
    let learner_a = state
        .identity
        .issue_session("learner-a", None, Some("class-a"))
        .await
        .unwrap()
        .access_token;
    let learner_b = state
        .identity
        .issue_session("learner-b", None, Some("class-b"))
        .await
        .unwrap()
        .access_token;
    let teacher_b = state
        .identity
        .issue_session("teacher-b", None, Some("class-b"))
        .await
        .unwrap()
        .access_token;
    let root = state
        .identity
        .issue_session("root", None, Some("school"))
        .await
        .unwrap()
        .access_token;
    Fixture {
        app: application_router(state),
        pool,
        db_path,
        learner_a,
        learner_b,
        teacher_b,
        root,
        resolver_calls,
        provider_contacts,
        key_paths: vec![signing, encryption],
    }
}

async fn post_stream(app: Router, token: &str, marker: &str) -> (StatusCode, Vec<u8>) {
    let response = app.oneshot(
        Request::post("/api/llm/stream")
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(serde_json::json!({"messages":[{"role":"user","content":marker}],"model_tier":"balanced","think":false}).to_string()))
            .unwrap(),
    ).await.unwrap();
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap()
        .to_vec();
    (status, body)
}

async fn get_json(app: Router, token: &str, uri: &str) -> (StatusCode, Value) {
    let response = app
        .oneshot(
            Request::get(uri)
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| serde_json::json!({"raw":String::from_utf8_lossy(&bytes)})),
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn governed_gateway_isolated_accounted_encrypted_and_wire_compatible() {
    let (address, provider_contacts) = mock_ollama(vec![
        (200, "{\"message\":{\"content\":\"Hallo A\"},\"done\":false}\n{\"done\":true,\"prompt_eval_count\":4,\"eval_count\":2}\n", Duration::ZERO),
        (200, "{\"message\":{\"content\":\"Hallo B\"},\"done\":false}\n{\"done\":true}\n", Duration::ZERO),
        (503, "provider-private-body-9a72", Duration::ZERO),
    ]).await;
    let fixture = setup(address, provider_contacts).await;

    let first = post_stream(
        fixture.app.clone(),
        &fixture.learner_a,
        "learner-a-private-prompt-61bc",
    );
    let second = post_stream(
        fixture.app.clone(),
        &fixture.learner_b,
        "learner-b-private-prompt-18de",
    );
    let ((status_a, body_a), (status_b, body_b)) = tokio::join!(first, second);
    assert_eq!(status_a, StatusCode::OK);
    assert_eq!(status_b, StatusCode::OK);
    let expected = [
        b"data: {\"choices\":[{\"delta\":{\"content\":\"Hallo A\"}}]}\n\ndata: {\"choices\":[{\"delta\":{}}],\"eval_count\":2,\"prompt_eval_count\":4}\n\ndata: [DONE]\n\n".as_slice(),
        b"data: {\"choices\":[{\"delta\":{\"content\":\"Hallo B\"}}]}\n\ndata: {\"choices\":[{\"delta\":{}}]}\n\ndata: [DONE]\n\n".as_slice(),
    ];
    assert!(
        expected.contains(&body_a.as_slice()),
        "A: {}",
        String::from_utf8_lossy(&body_a)
    );
    assert!(
        expected.contains(&body_b.as_slice()),
        "B: {}",
        String::from_utf8_lossy(&body_b)
    );
    assert_ne!(body_a, body_b);

    let before_failure: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM usage_ledger")
        .fetch_one(&fixture.pool)
        .await
        .unwrap();
    let (failure_status, failure_body) = post_stream(
        fixture.app.clone(),
        &fixture.learner_b,
        "failure-private-prompt-55d1",
    )
    .await;
    assert_eq!(failure_status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        serde_json::from_slice::<Value>(&failure_body).unwrap()["error"],
        "provider_unavailable"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM usage_ledger")
            .fetch_one(&fixture.pool)
            .await
            .unwrap(),
        before_failure
    );
    let resolver_before_denial = fixture.resolver_calls.load(Ordering::SeqCst);
    let contacts_before_denial = fixture.provider_contacts.load(Ordering::SeqCst);
    assert_eq!(resolver_before_denial, 3);
    assert_eq!(contacts_before_denial, 3);
    let (limited_status, limited_body) = post_stream(
        fixture.app.clone(),
        &fixture.learner_a,
        "must-not-contact-provider",
    )
    .await;
    assert_eq!(limited_status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        serde_json::from_slice::<Value>(&limited_body).unwrap()["error"],
        "quota_exceeded"
    );
    assert_eq!(
        fixture.resolver_calls.load(Ordering::SeqCst),
        resolver_before_denial
    );
    assert_eq!(
        fixture.provider_contacts.load(Ordering::SeqCst),
        contacts_before_denial
    );

    let qualities: Vec<String> = sqlx::query_scalar(
        "SELECT usage_quality FROM llm_requests WHERE status='completed' ORDER BY usage_quality",
    )
    .fetch_all(&fixture.pool)
    .await
    .unwrap();
    assert_eq!(qualities, vec!["estimated", "exact"]);
    let completed: Vec<(String, String, String, String, i64, i64, i64, String)> = sqlx::query_as(
        "SELECT r.reservation_id,q.learner_user_id,q.direct_group_id,r.usage_quality,r.input_tokens,r.output_tokens,r.cost_micros,r.price_version_id FROM llm_requests r JOIN quota_reservations q ON q.id=r.reservation_id WHERE r.status='completed' ORDER BY r.usage_quality",
    )
    .fetch_all(&fixture.pool)
    .await
    .unwrap();
    assert_eq!(completed.len(), 2);
    for (reservation, learner, group, quality, input, output, cost, price) in &completed {
        assert_eq!(price, "price");
        let expected = if quality == "exact" {
            assert_eq!((*input, *output, *cost), (4, 2, 2));
            [
                ("requests", 1),
                ("inputTokens", 4),
                ("outputTokens", 2),
                ("totalTokens", 6),
                ("costMicros", 2),
            ]
        } else {
            assert_eq!(quality, "estimated");
            assert_eq!((*input, *output, *cost), (122, 7, 2));
            [
                ("requests", 1),
                ("inputTokens", 122),
                ("outputTokens", 7),
                ("totalTokens", 129),
                ("costMicros", 2),
            ]
        };
        for (scope_kind, scope_id) in [
            ("user", learner.as_str()),
            ("group", group.as_str()),
            ("group", "school"),
        ] {
            for &(metric, value) in &expected {
                let stored: (i64, String) = sqlx::query_as(
                    "SELECT value,price_version_id FROM usage_ledger WHERE reservation_id=? AND scope_kind=? AND scope_id=? AND metric=?",
                )
                .bind(reservation)
                .bind(scope_kind)
                .bind(scope_id)
                .bind(metric)
                .fetch_one(&fixture.pool)
                .await
                .unwrap();
                assert_eq!(stored, (value, "price".into()));
            }
        }
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM usage_ledger WHERE reservation_id=?"
            )
            .bind(reservation)
            .fetch_one(&fixture.pool)
            .await
            .unwrap(),
            15,
        );
    }
    let conversation_a: String = sqlx::query_scalar(
        "SELECT id FROM conversations WHERE owner_group_id='class-a' AND status='completed'",
    )
    .fetch_one(&fixture.pool)
    .await
    .unwrap();
    let (sibling_status, _) = get_json(
        fixture.app.clone(),
        &fixture.teacher_b,
        &format!("/api/conversations/{conversation_a}"),
    )
    .await;
    assert_eq!(sibling_status, StatusCode::FORBIDDEN);
    sqlx::query("UPDATE groups SET status='archived' WHERE id='class-a'")
        .execute(&fixture.pool)
        .await
        .unwrap();
    let (archived_status, archived) = get_json(
        fixture.app.clone(),
        &fixture.root,
        &format!("/api/conversations/{conversation_a}"),
    )
    .await;
    assert_eq!(archived_status, StatusCode::OK);
    assert_eq!(
        archived["messages"][0]["content"],
        "learner-a-private-prompt-61bc"
    );
    let (archived_sibling_status, _) = get_json(
        fixture.app.clone(),
        &fixture.teacher_b,
        &format!("/api/conversations/{conversation_a}"),
    )
    .await;
    assert_eq!(archived_sibling_status, StatusCode::FORBIDDEN);

    let (rollup_status, rollup) = get_json(
        fixture.app.clone(),
        &fixture.root,
        "/api/llm/usage?groupId=school&limit=50",
    )
    .await;
    assert_eq!(rollup_status, StatusCode::OK, "{rollup}");
    let breakdowns = rollup["breakdowns"].as_array().unwrap();
    assert!(breakdowns
        .iter()
        .any(|row| row["learnerUserId"] == "learner-a"));
    assert!(breakdowns
        .iter()
        .any(|row| row["learnerUserId"] == "learner-b"));
    for (metric, expected_total) in [
        ("requests", 2_i64),
        ("inputTokens", 126),
        ("outputTokens", 9),
        ("totalTokens", 135),
        ("costMicros", 4),
    ] {
        let breakdown_total: i64 = breakdowns
            .iter()
            .filter(|row| row["metric"] == metric)
            .map(|row| row["value"].as_i64().unwrap())
            .sum();
        assert_eq!(breakdown_total, expected_total, "root {metric} rollup");
        if matches!(metric, "requests" | "costMicros") {
            let bucket = rollup["buckets"]
                .as_array()
                .unwrap()
                .iter()
                .find(|row| row["scopeId"] == "school" && row["metric"] == metric)
                .unwrap();
            assert_eq!(bucket["used"], expected_total);
        }
    }
    let scopes: Vec<String> =
        sqlx::query("SELECT DISTINCT scope_id FROM usage_ledger ORDER BY scope_id")
            .fetch_all(&fixture.pool)
            .await
            .unwrap()
            .into_iter()
            .map(|row| row.get("scope_id"))
            .collect();
    assert!(scopes.contains(&"school".to_string()));
    assert!(scopes.contains(&"class-a".to_string()));
    assert!(scopes.contains(&"class-b".to_string()));

    sqlx::query("PRAGMA wal_checkpoint(FULL)")
        .execute(&fixture.pool)
        .await
        .unwrap();
    let forbidden = [
        "learner-a-private-prompt-61bc",
        "learner-b-private-prompt-18de",
        "failure-private-prompt-55d1",
        "Hallo A",
        "Hallo B",
        "provider-private-body-9a72",
    ];
    for path in [
        &fixture.db_path,
        &format!("{}-wal", fixture.db_path),
        &format!("{}-shm", fixture.db_path),
    ] {
        if let Ok(bytes) = std::fs::read(path) {
            for secret in forbidden {
                assert!(
                    !bytes
                        .windows(secret.len())
                        .any(|window| window == secret.as_bytes()),
                    "plaintext leaked to {path}"
                );
            }
        }
    }
    let audits: Vec<String> =
        sqlx::query_scalar("SELECT COALESCE(metadata_json,'') FROM audit_events")
            .fetch_all(&fixture.pool)
            .await
            .unwrap();
    for metadata in audits {
        for secret in forbidden {
            assert!(!metadata.contains(secret));
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn production_router_enforces_concurrency_and_recovers_abandoned_stream_once() {
    let (address, provider_contacts) = mock_ollama(vec![
        (
            200,
            "{\"message\":{\"content\":\"slow\"},\"done\":false}\n{\"done\":true,\"prompt_eval_count\":1,\"eval_count\":1}\n",
            Duration::from_millis(200),
        ),
        (
            200,
            "{\"message\":{\"content\":\"abandoned-private-output\"},\"done\":false}\n",
            Duration::ZERO,
        ),
    ])
    .await;
    let fixture = setup(address, provider_contacts).await;
    let first_app = fixture.app.clone();
    let first_token = fixture.learner_a.clone();
    let first =
        tokio::spawn(
            async move { post_stream(first_app, &first_token, "slow-private-prompt").await },
        );
    for _ in 0..100 {
        let active: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM llm_gateway_leases WHERE released_at IS NULL")
                .fetch_one(&fixture.pool)
                .await
                .unwrap();
        if active == 1 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    let (status, bytes) = post_stream(
        fixture.app.clone(),
        &fixture.learner_a,
        "concurrency-must-not-contact",
    )
    .await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        serde_json::from_slice::<Value>(&bytes).unwrap()["error"],
        "rate_limited"
    );
    assert_eq!(first.await.unwrap().0, StatusCode::OK);

    let response = fixture
        .app
        .clone()
        .oneshot(
            Request::post("/api/llm/stream")
                .header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", fixture.learner_b),
                )
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"messages":[{"role":"user","content":"abandoned-private-prompt"}]}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    drop(response);
    let reservation_id: String = sqlx::query_scalar(
        "SELECT reservation_id FROM llm_gateway_reservations WHERE phase='pending'",
    )
    .fetch_one(&fixture.pool)
    .await
    .unwrap();
    sqlx::query("UPDATE llm_gateway_leases SET acquired_at=0,expires_at=1 WHERE reservation_id=?")
        .bind(&reservation_id)
        .execute(&fixture.pool)
        .await
        .unwrap();
    let quota = QuotaService::new(fixture.pool.clone());
    quota.release_expired().await.unwrap();
    let first_ledger_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM usage_ledger WHERE reservation_id=?")
            .bind(&reservation_id)
            .fetch_one(&fixture.pool)
            .await
            .unwrap();
    assert!(first_ledger_count > 0);
    assert_eq!(
        sqlx::query_as::<_, (String, String)>(
            "SELECT status,error_code FROM llm_requests WHERE reservation_id=?",
        )
        .bind(&reservation_id)
        .fetch_one(&fixture.pool)
        .await
        .unwrap(),
        ("failed".into(), "stream_abandoned".into())
    );
    quota.release_expired().await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM usage_ledger WHERE reservation_id=?",)
            .bind(&reservation_id)
            .fetch_one(&fixture.pool)
            .await
            .unwrap(),
        first_ledger_count
    );
}

#[test]
fn operational_redaction_preserves_safe_identifiers_and_removes_secret_material() {
    let safe = "provider_id=provider-v1 model_id=school-model group_id=class-a request_id=018f47d2-01aa-7abc-8def-0123456789ab monkey_id=learner-1 compass_group=class-b";
    assert_eq!(mlearn_management::redaction::redact_line(safe), safe);
    let dangerous = "authorization=Bearer private-token prompt=private learner response provider_body=sk-abcdefghijklmnopqrstuvwxyz1234567890 policy_signing_key=abc";
    let redacted = mlearn_management::redaction::redact_line(dangerous);
    assert!(!redacted.contains("private-token"));
    assert!(!redacted.contains("sk-abcdefghijklmnopqrstuvwxyz1234567890"));
    assert!(
        redacted.contains("prompt=private learner response"),
        "ordinary words must not be guessed as secrets"
    );
    assert!(redacted.contains("policy_signing_key=[REDACTED]"));

    for key in [
        "apiKey",
        "apikey",
        "accessToken",
        "refreshToken",
        "clientSecret",
        "privateKey",
        "sessionId",
        "authHeader",
        "api-key",
        "ACCESS_TOKEN",
    ] {
        assert_eq!(
            mlearn_management::redaction::redact_value(key, "ordinary-private-value"),
            "[REDACTED]",
            "{key} must be recognized as credential material",
        );
    }
    let audit_metadata = mlearn_management::redaction::redact_map(&HashMap::from([
        ("apiKey".to_string(), "audit-private-api-key".to_string()),
        (
            "refreshToken".to_string(),
            "audit-private-refresh-token".to_string(),
        ),
        ("provider_id".to_string(), "provider-v1".to_string()),
    ]));
    let serialized = serde_json::to_string(&audit_metadata).unwrap();
    assert!(!serialized.contains("audit-private"));
    assert_eq!(audit_metadata["apiKey"], "[REDACTED]");
    assert_eq!(audit_metadata["refreshToken"], "[REDACTED]");
    assert_eq!(audit_metadata["provider_id"], "provider-v1");
}
