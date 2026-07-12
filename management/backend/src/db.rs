use std::{str::FromStr, time::Duration};

use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    SqlitePool,
};

use crate::{config::Config, error::AppError};

pub async fn connect_database(config: &Config) -> Result<SqlitePool, AppError> {
    let options = sqlite_connect_options(&config.management_db_path)?;
    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(options)
        .await
        .map_err(database_error)?;
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .map_err(|error| AppError::Internal(format!("database migration failed: {error}")))?;
    let backfill_complete: i64 = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM analytics_daily_totals_backfill_state WHERE id=1)",
    )
    .fetch_one(&pool)
    .await
    .map_err(database_error)?;
    if backfill_complete == 0 {
        crate::analytics::rollups::backfill_daily_totals(&pool).await?;
    }
    Ok(pool)
}

#[doc(hidden)]
pub fn sqlite_connect_options(path: &str) -> Result<SqliteConnectOptions, AppError> {
    Ok(SqliteConnectOptions::from_str(&format!("sqlite://{path}"))
        .map_err(database_error)?
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5)))
}

fn database_error(error: sqlx::Error) -> AppError {
    AppError::Internal(format!("database error: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn connect_test_database() -> Result<SqlitePool, AppError> {
        let path =
            std::env::temp_dir().join(format!("mlearn-management-{}.db", uuid::Uuid::now_v7()));
        let mut config = Config::from_env();
        config.management_db_path = path.to_string_lossy().into_owned();
        connect_database(&config).await
    }

    #[tokio::test]
    async fn migrates_empty_database_with_foreign_keys_enabled() {
        let pool = connect_test_database().await.unwrap();
        let tables: Vec<String> =
            sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert!(tables.contains(&"users".to_string()));
        assert!(tables.contains(&"sessions".to_string()));
        assert!(tables.contains(&"audit_events".to_string()));
        assert!(tables.contains(&"activity_events".to_string()));
        assert!(tables.contains(&"activity_event_ancestry".to_string()));
        assert_eq!(
            sqlx::query_scalar::<_, i64>("PRAGMA foreign_keys")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn daily_total_backfill_retries_after_marker_is_removed() {
        let path =
            std::env::temp_dir().join(format!("mlearn-backfill-{}.db", uuid::Uuid::now_v7()));
        let mut config = Config::from_env();
        config.management_db_path = path.to_string_lossy().into_owned();
        let pool = connect_database(&config).await.unwrap();
        sqlx::query("INSERT INTO users(id,email,normalized_email,display_name,status,identity_type,is_root,created_at,updated_at) VALUES('learner','l@test','l@test','Learner','active','learner',0,1,1)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO groups(id,parent_id,name,slug,status,created_at) VALUES('root',NULL,'Root','root','active',1)")
            .execute(&pool)
            .await
            .unwrap();
        let event_id = sqlx::query("INSERT INTO activity_events(event_id,user_id,group_id,policy_version_id,payload_hash,schema_version,event_type,activity_kind,privacy,activity_session_id,source_id,sequence,occurred_at,ingested_at,retention_days,retained_until,ancestry_state) VALUES('prior','learner','root','policy','hash',1,'activity.started','flashcards','progress-only','session','source',1,1,1,90,7776000001,'building')")
            .execute(&pool)
            .await
            .unwrap()
            .last_insert_rowid();
        sqlx::query(
            "INSERT INTO activity_event_ancestry(event_row_id,ordinal,group_id) VALUES(?,0,'root')",
        )
        .bind(event_id)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE activity_events SET ancestry_state='finalized' WHERE id=?")
            .bind(event_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM analytics_daily_totals_backfill_state")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;

        let restarted = connect_database(&config).await.unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM analytics_daily_totals WHERE group_id='root'"
            )
            .fetch_one(&restarted)
            .await
            .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM analytics_daily_totals_backfill_state WHERE id=1"
            )
            .fetch_one(&restarted)
            .await
            .unwrap(),
            1
        );
        restarted.close().await;
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn identity_schema_separates_lifecycle_type_and_root_marker() {
        let pool = connect_test_database().await.unwrap();
        let columns: Vec<String> =
            sqlx::query_scalar("SELECT name FROM pragma_table_info('users')")
                .fetch_all(&pool)
                .await
                .unwrap();

        assert!(columns.contains(&"identity_type".to_string()));
        assert!(columns.contains(&"is_root".to_string()));
        assert!(columns.contains(&"status".to_string()));
    }

    #[tokio::test]
    async fn analytics_migrates_from_0012_through_0014_without_losing_data() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for migration in [
            include_str!("../migrations/0001_identity.sql"),
            include_str!("../migrations/0002_identity_hardening.sql"),
            include_str!("../migrations/0003_groups.sql"),
            include_str!("../migrations/0004_group_invariants.sql"),
            include_str!("../migrations/0005_provisioning.sql"),
            include_str!("../migrations/0006_policies.sql"),
            include_str!("../migrations/0007_llm_configuration.sql"),
            include_str!("../migrations/0008_llm_quotas.sql"),
            include_str!("../migrations/0009_llm_gateway.sql"),
            include_str!("../migrations/0010_conversations.sql"),
            include_str!("../migrations/0011_conversation_hardening.sql"),
            include_str!("../migrations/0012_conversation_terminal_invariants.sql"),
        ] {
            sqlx::raw_sql(migration).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO users(id,email,normalized_email,display_name,status,identity_type,is_root,created_at,updated_at) VALUES('prior','p@test','p@test','Prior','active','learner',0,1,1)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO groups(id,parent_id,name,slug,status,created_at) VALUES('prior-group',NULL,'Prior','prior','active',1)").execute(&pool).await.unwrap();

        sqlx::raw_sql(include_str!("../migrations/0013_analytics.sql"))
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO activity_events(event_id,user_id,group_id,policy_version_id,payload_hash,schema_version,event_type,activity_kind,privacy,activity_session_id,source_id,sequence,occurred_at,ingested_at) VALUES('prior-event','prior','prior-group','policy','hash',1,'activity.started','flashcards','progress-only','session','source',1,1000,1)").execute(&pool).await.unwrap();
        let event_row_id: i64 =
            sqlx::query_scalar("SELECT id FROM activity_events WHERE event_id='prior-event'")
                .fetch_one(&pool)
                .await
                .unwrap();
        sqlx::query("INSERT INTO activity_event_ancestry(event_row_id,ordinal,group_id) VALUES(?,0,'prior-group')").bind(event_row_id).execute(&pool).await.unwrap();
        sqlx::raw_sql(include_str!("../migrations/0014_analytics_hardening.sql"))
            .execute(&pool)
            .await
            .unwrap();

        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE id='prior'")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT ancestry_state FROM activity_events WHERE event_id='prior-event'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            "finalized"
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT occurred_at FROM activity_events WHERE event_id='prior-event'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            1_000_000
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM groups WHERE id='prior-group'")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='activity_events'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn analytics_0014_quarantines_every_malformed_legacy_ancestry_shape() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for migration in [
            include_str!("../migrations/0001_identity.sql"),
            include_str!("../migrations/0002_identity_hardening.sql"),
            include_str!("../migrations/0003_groups.sql"),
            include_str!("../migrations/0004_group_invariants.sql"),
            include_str!("../migrations/0005_provisioning.sql"),
            include_str!("../migrations/0006_policies.sql"),
            include_str!("../migrations/0007_llm_configuration.sql"),
            include_str!("../migrations/0008_llm_quotas.sql"),
            include_str!("../migrations/0009_llm_gateway.sql"),
            include_str!("../migrations/0010_conversations.sql"),
            include_str!("../migrations/0011_conversation_hardening.sql"),
            include_str!("../migrations/0012_conversation_terminal_invariants.sql"),
            include_str!("../migrations/0013_analytics.sql"),
        ] {
            sqlx::raw_sql(migration).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO users(id,email,normalized_email,display_name,status,identity_type,is_root,created_at,updated_at) VALUES('u','u@test','u@test','U','active','learner',0,1,1)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO groups(id,parent_id,name,slug,status,created_at) VALUES('root',NULL,'Root','root','active',1),('child','root','Child','child','active',1),('sibling','root','Sibling','sibling','active',1)").execute(&pool).await.unwrap();
        async fn event(pool: &SqlitePool, id: &str, leaf: &str, sequence: i64) -> i64 {
            sqlx::query("INSERT INTO activity_events(event_id,user_id,group_id,policy_version_id,payload_hash,schema_version,event_type,activity_kind,privacy,activity_session_id,source_id,sequence,occurred_at,ingested_at,title,content_id) VALUES(?,'u',?,'p',?,1,'activity.started','flashcards','progress-only',?,'source',?,1000,1,NULL,NULL)").bind(id).bind(leaf).bind(format!("hash-{id}")).bind(format!("session-{id}")).bind(sequence).execute(pool).await.unwrap().last_insert_rowid()
        }
        let valid = event(&pool, "valid", "child", 1).await;
        let missing = event(&pool, "missing", "child", 2).await;
        let gapped = event(&pool, "gapped", "child", 3).await;
        let reordered = event(&pool, "reordered", "child", 4).await;
        let sibling = event(&pool, "sibling-event", "child", 5).await;
        let truncated = event(&pool, "truncated", "child", 6).await;
        let missing_group = event(&pool, "missing-group", "child", 7).await;
        sqlx::query("INSERT INTO activity_event_ancestry VALUES(?,0,'root'),(?,1,'child')")
            .bind(valid)
            .bind(valid)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO activity_event_ancestry VALUES(?,0,'root'),(?,2,'child')")
            .bind(gapped)
            .bind(gapped)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO activity_event_ancestry VALUES(?,0,'child'),(?,1,'root')")
            .bind(reordered)
            .bind(reordered)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO activity_event_ancestry VALUES(?,0,'root'),(?,1,'sibling')")
            .bind(sibling)
            .bind(sibling)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO activity_event_ancestry VALUES(?,0,'root')")
            .bind(truncated)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("PRAGMA foreign_keys=OFF")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO activity_event_ancestry VALUES(?,0,'root'),(?,1,'gone')")
            .bind(missing_group)
            .bind(missing_group)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("PRAGMA foreign_keys=ON")
            .execute(&pool)
            .await
            .unwrap();
        assert!(
            sqlx::query("INSERT INTO activity_event_ancestry VALUES(?,0,'root')")
                .bind(valid)
                .execute(&pool)
                .await
                .is_err(),
            "0013 constraints prevent duplicate ordinals"
        );
        assert!(missing > 0);

        sqlx::raw_sql(include_str!("../migrations/0014_analytics_hardening.sql"))
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM activity_events")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT event_id FROM activity_events")
                .fetch_one(&pool)
                .await
                .unwrap(),
            "valid"
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM analytics_ingestion_quarantine")
                .fetch_one(&pool)
                .await
                .unwrap(),
            6
        );
        let columns: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM pragma_table_info('analytics_ingestion_quarantine')",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert!(!columns
            .iter()
            .any(|name| matches!(name.as_str(), "title" | "content_id" | "payload_hash")));
        assert!(
            sqlx::query("UPDATE analytics_ingestion_quarantine SET reason='missing'")
                .execute(&pool)
                .await
                .is_err()
        );
        assert!(sqlx::query("DELETE FROM analytics_ingestion_quarantine")
            .execute(&pool)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn llm_configuration_migrates_from_0006_without_losing_prior_data() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for migration in [
            include_str!("../migrations/0001_identity.sql"),
            include_str!("../migrations/0002_identity_hardening.sql"),
            include_str!("../migrations/0003_groups.sql"),
            include_str!("../migrations/0004_group_invariants.sql"),
            include_str!("../migrations/0005_provisioning.sql"),
            include_str!("../migrations/0006_policies.sql"),
        ] {
            sqlx::raw_sql(migration).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO users (id, email, normalized_email, display_name, status, identity_type, is_root, created_at, updated_at) VALUES ('prior-user', 'prior@test.invalid', 'prior@test.invalid', 'Prior', 'active', 'admin', 1, 1, 1)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO groups (id, parent_id, name, slug, status, created_at) VALUES ('prior-group', NULL, 'Prior School', 'prior-school', 'active', 1)")
            .execute(&pool).await.unwrap();

        sqlx::raw_sql(include_str!("../migrations/0007_llm_configuration.sql"))
            .execute(&pool)
            .await
            .unwrap();

        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE id = 'prior-user'")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM groups WHERE id = 'prior-group'")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        for object in [
            "llm_providers",
            "llm_models",
            "prompt_profiles",
            "provider_price_versions",
            "llm_configuration_mutations",
            "llm_providers_identity_immutable",
            "provider_price_versions_current_idx",
        ] {
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sqlite_master WHERE name = ?")
                    .bind(object)
                    .fetch_one(&pool)
                    .await
                    .unwrap(),
                1,
                "{object}"
            );
        }
    }

    #[tokio::test]
    async fn llm_quotas_migrate_from_0007_without_losing_prior_data() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for migration in [
            include_str!("../migrations/0001_identity.sql"),
            include_str!("../migrations/0002_identity_hardening.sql"),
            include_str!("../migrations/0003_groups.sql"),
            include_str!("../migrations/0004_group_invariants.sql"),
            include_str!("../migrations/0005_provisioning.sql"),
            include_str!("../migrations/0006_policies.sql"),
            include_str!("../migrations/0007_llm_configuration.sql"),
        ] {
            sqlx::raw_sql(migration).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO users (id, email, normalized_email, display_name, status, identity_type, is_root, created_at, updated_at) VALUES ('prior-user', 'prior@test.invalid', 'prior@test.invalid', 'Prior', 'active', 'admin', 1, 1, 1)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO groups (id, parent_id, name, slug, status, created_at) VALUES ('prior-group', NULL, 'Prior School', 'prior-school', 'active', 1)").execute(&pool).await.unwrap();
        sqlx::raw_sql(include_str!("../migrations/0008_llm_quotas.sql"))
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE id = 'prior-user'")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM groups WHERE id = 'prior-group'")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        for object in [
            "school_quota_calendar_versions",
            "school_quota_period_instances",
            "school_quota_period_instances_building_only",
            "school_quota_calendar_versions_finalize",
            "quota_definitions",
            "quota_reservations",
            "quota_reservation_scopes",
            "quota_definition_periods",
            "quota_definition_periods_authoritative_insert",
            "quota_reservation_periods",
            "usage_ledger",
            "usage_ledger_immutable_update",
            "quota_reservation_scope_group_ancestry",
            "quota_reservations_lifecycle",
            "usage_ledger_snapshot_match",
            "school_quota_calendars_active_accounting_guard",
        ] {
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sqlite_master WHERE name = ?")
                    .bind(object)
                    .fetch_one(&pool)
                    .await
                    .unwrap(),
                1,
                "{object}"
            );
        }
    }

    #[tokio::test]
    async fn llm_gateway_lifecycle_schema_is_durable() {
        let pool = connect_test_database().await.unwrap();
        for object in ["llm_gateway_reservations", "llm_gateway_leases"] {
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sqlite_master WHERE name = ?")
                    .bind(object)
                    .fetch_one(&pool)
                    .await
                    .unwrap(),
                1,
                "{object}"
            );
        }
    }

    #[tokio::test]
    async fn conversations_migrate_from_0009_without_losing_prior_data() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for migration in [
            include_str!("../migrations/0001_identity.sql"),
            include_str!("../migrations/0002_identity_hardening.sql"),
            include_str!("../migrations/0003_groups.sql"),
            include_str!("../migrations/0004_group_invariants.sql"),
            include_str!("../migrations/0005_provisioning.sql"),
            include_str!("../migrations/0006_policies.sql"),
            include_str!("../migrations/0007_llm_configuration.sql"),
            include_str!("../migrations/0008_llm_quotas.sql"),
            include_str!("../migrations/0009_llm_gateway.sql"),
        ] {
            sqlx::raw_sql(migration).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO users (id,email,normalized_email,display_name,status,identity_type,is_root,created_at,updated_at) VALUES ('prior','prior@test.invalid','prior@test.invalid','Prior','active','admin',1,1,1)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO groups (id,parent_id,name,slug,status,created_at) VALUES ('school',NULL,'School','school','active',1)").execute(&pool).await.unwrap();
        sqlx::raw_sql(include_str!("../migrations/0010_conversations.sql"))
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(include_str!(
            "../migrations/0011_conversation_hardening.sql"
        ))
        .execute(&pool)
        .await
        .unwrap();
        sqlx::raw_sql(include_str!(
            "../migrations/0012_conversation_terminal_invariants.sql"
        ))
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE id='prior'")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        for object in [
            "conversations",
            "llm_requests",
            "conversation_messages",
            "conversation_messages_ciphertext_lifecycle",
            "llm_requests_terminal_immutable",
            "conversations_retention_idx",
            "llm_policy_block_events",
            "llm_requests_terminalize_conversation",
        ] {
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sqlite_master WHERE name=?")
                    .bind(object)
                    .fetch_one(&pool)
                    .await
                    .unwrap(),
                1,
                "{object}"
            );
        }
    }

    #[tokio::test]
    async fn legacy_policy_rows_migrate_to_named_policy_without_changing_history() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for migration in [
            include_str!("../migrations/0001_identity.sql"),
            include_str!("../migrations/0002_identity_hardening.sql"),
            include_str!("../migrations/0003_groups.sql"),
            include_str!("../migrations/0004_group_invariants.sql"),
            include_str!("../migrations/0005_provisioning.sql"),
            include_str!("../migrations/0006_policies.sql"),
        ] {
            sqlx::raw_sql(migration).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO users(id,email,normalized_email,display_name,status,identity_type,is_root,created_at,updated_at) VALUES('author','author@test.invalid','author@test.invalid','Author','active','admin',1,1,1)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO groups(id,parent_id,name,slug,status,created_at) VALUES('class',NULL,'Class','class','active',1)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO policy_drafts(group_id,document_json,document_hash,author_user_id,updated_at) VALUES('class','{\"settings\":{}}','draft-hash','author',12)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO policy_versions(id,group_id,document_json,document_hash,compiled_hash,author_user_id,summary,parent_version_ids_json,created_at) VALUES('v1','class','{\"settings\":{}}','version-hash','compiled-hash','author','Initial policy','[]',11)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO active_policies(group_id,policy_version_id,activated_at) VALUES('class','v1',13)")
            .execute(&pool).await.unwrap();

        sqlx::raw_sql(include_str!("../migrations/0016_named_policies.sql"))
            .execute(&pool)
            .await
            .unwrap();

        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM policies WHERE id='legacy-class' AND group_id='class' AND name='Group policy'"
            ).fetch_one(&pool).await.unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT policy_id FROM policy_drafts WHERE group_id='class'"
            ).fetch_one(&pool).await.unwrap(),
            "legacy-class"
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT document_hash FROM policy_versions WHERE id='v1'"
            ).fetch_one(&pool).await.unwrap(),
            "version-hash"
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT policy_version_id FROM policy_active_versions WHERE policy_id='legacy-class'"
            ).fetch_one(&pool).await.unwrap(),
            "v1"
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT summary FROM policy_set_revisions WHERE group_id='class'"
            ).fetch_one(&pool).await.unwrap(),
            "Migrated legacy group policy"
        );
    }
}
