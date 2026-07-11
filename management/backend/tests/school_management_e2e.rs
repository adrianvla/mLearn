use mlearn_management::{
    authorization::{AuthorizationService, Capability},
    config::Config,
    db::connect_database,
    error::AppError,
    identity::{IdentityType, Principal},
};

#[tokio::test]
async fn german_tree_permissions_are_downward_scoped_and_revocation_is_immediate() {
    let path = std::env::temp_dir().join(format!("mlearn-school-e2e-{}.db", uuid::Uuid::now_v7()));
    let mut config = Config::from_env();
    config.management_db_path = path.to_string_lossy().into_owned();
    let pool = connect_database(&config).await.unwrap();
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    for (id, email, root) in [
        ("root-admin", "root@test", 1),
        ("german-manager", "manager@test", 0),
        ("a-teacher", "a@test", 0),
        ("b-teacher", "b@test", 0),
        ("project-teacher", "project@test", 0),
        ("learner", "learner@test", 0),
    ] {
        sqlx::query("INSERT INTO users(id,email,normalized_email,display_name,status,identity_type,is_root,created_at,updated_at) VALUES(?,?,?,?, 'active','teacher',?,?,?)").bind(id).bind(email).bind(email).bind(id).bind(root).bind(now).bind(now).execute(&pool).await.unwrap();
    }
    sqlx::query("INSERT INTO groups(id,parent_id,name,slug,status,created_at) VALUES('school',NULL,'School','school','active',?),('german','school','German','german','active',?),('german-a','german','German A','german-a','active',?),('german-b','german','German B','german-b','active',?),('project','german-a','Project','project','active',?)").bind(now).bind(now).bind(now).bind(now).bind(now).execute(&pool).await.unwrap();
    for (id, group, user) in [
        ("m-root", "school", "root-admin"),
        ("m-manager", "german", "german-manager"),
        ("m-a", "german-a", "a-teacher"),
        ("m-b", "german-b", "b-teacher"),
        ("m-project", "project", "project-teacher"),
        ("m-learner", "german-a", "learner"),
        ("m-learner-b", "german-b", "learner"),
    ] {
        sqlx::query("INSERT INTO group_memberships(id,group_id,user_id,status,created_at) VALUES(?,?,?,'active',?)").bind(id).bind(group).bind(user).bind(now).execute(&pool).await.unwrap();
    }
    for membership in ["m-root", "m-manager", "m-a", "m-b", "m-project"] {
        sqlx::query("INSERT INTO membership_capabilities(membership_id,capability) VALUES(?,'analytics.view')").bind(membership).execute(&pool).await.unwrap();
    }
    sqlx::query("INSERT INTO policy_versions(id,group_id,document_json,document_hash,compiled_hash,author_user_id,summary,parent_version_ids_json,created_at) VALUES('policy-school-v1','school','{}','document-school-v1','compiled-school-v1','root-admin','School defaults','[]',?)")
        .bind(now).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO active_policies(group_id,policy_version_id,activated_at) VALUES('school','policy-school-v1',?)")
        .bind(now).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO quota_definitions(id,owner_group_id,subject_kind,subject_id,metric,period,limit_value,status,created_by_user_id,created_at,updated_at) VALUES('quota-german-a','german-a','user','learner','requests','monthly',250,'active','a-teacher',?,?)")
        .bind(now).bind(now).execute(&pool).await.unwrap();
    let occurred_at = now * 1000;
    let event_row = sqlx::query("INSERT INTO activity_events(event_id,user_id,group_id,policy_version_id,payload_hash,schema_version,event_type,activity_kind,privacy,activity_session_id,source_id,sequence,occurred_at,ingested_at,content_id,language,title,current_page,total_pages,ancestry_state,retained_until) VALUES('event-german-a-1','learner','german-a','policy-school-v1','payload-event-1',1,'activity.completed','reader','title-and-progress','session-german-a-1','reader-source-1',1,?,?, 'reader-content-1','de','German Reader',12,12,'building',?)")
        .bind(occurred_at).bind(occurred_at).bind(occurred_at + 86_400_000).execute(&pool).await.unwrap().last_insert_rowid();
    for (ordinal, group) in [(0_i64, "school"), (1, "german"), (2, "german-a")] {
        sqlx::query(
            "INSERT INTO activity_event_ancestry(event_row_id,ordinal,group_id) VALUES(?,?,?)",
        )
        .bind(event_row)
        .bind(ordinal)
        .bind(group)
        .execute(&pool)
        .await
        .unwrap();
    }
    sqlx::query("UPDATE activity_events SET ancestry_state='finalized' WHERE id=?")
        .bind(event_row)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO conversations(id,owner_group_id,learner_user_id,created_at,updated_at,retained_until,status) VALUES('conversation-german-a-1','german-a','learner',?,?,?,'completed')")
        .bind(now).bind(now).bind(now + 86_400).execute(&pool).await.unwrap();
    let principal = |user: &str, group: &str, root: bool| Principal {
        user_id: user.into(),
        service_key_id: None,
        session_id: "acceptance".into(),
        device_id: "browser".into(),
        active_group_id: Some(group.into()),
        identity_type: IdentityType::Teacher,
        is_root: root,
    };
    let auth = AuthorizationService::new(pool.clone());
    assert!(auth
        .require(
            &principal("german-manager", "german", false),
            "project",
            Capability::AnalyticsView
        )
        .await
        .is_ok());
    let learner_memberships: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM group_memberships WHERE user_id='learner' AND status='active'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        learner_memberships, 2,
        "fixture must cover a multi-class learner"
    );
    let seeded_governance: i64 = sqlx::query_scalar(
        "SELECT (SELECT COUNT(*) FROM active_policies) + (SELECT COUNT(*) FROM quota_definitions) + (SELECT COUNT(*) FROM activity_events WHERE ancestry_state='finalized') + (SELECT COUNT(*) FROM conversations)",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        seeded_governance, 4,
        "fixture must cover policy, quota, activity, and conversation data"
    );
    assert!(matches!(
        auth.require(
            &principal("a-teacher", "german-a", false),
            "german-b",
            Capability::AnalyticsView
        )
        .await,
        Err(AppError::Forbidden(_))
    ));
    assert!(auth
        .require(
            &principal("root-admin", "school", true),
            "german-b",
            Capability::AnalyticsView
        )
        .await
        .is_ok());
    sqlx::query("UPDATE group_memberships SET status='archived' WHERE id='m-a'")
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        auth.require(
            &principal("a-teacher", "german-a", false),
            "german-a",
            Capability::AnalyticsView
        )
        .await,
        Err(AppError::Forbidden(_))
    ));
    let _ = std::fs::remove_file(path);
}
