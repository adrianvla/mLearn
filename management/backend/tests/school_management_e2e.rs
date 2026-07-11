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
    ] {
        sqlx::query("INSERT INTO group_memberships(id,group_id,user_id,status,created_at) VALUES(?,?,?,'active',?)").bind(id).bind(group).bind(user).bind(now).execute(&pool).await.unwrap();
    }
    for membership in ["m-root", "m-manager", "m-a", "m-b", "m-project"] {
        sqlx::query("INSERT INTO membership_capabilities(membership_id,capability) VALUES(?,'analytics.view')").bind(membership).execute(&pool).await.unwrap();
    }
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
