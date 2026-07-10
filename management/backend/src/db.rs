use std::str::FromStr;

use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    SqlitePool,
};

use crate::{config::Config, error::AppError};

pub async fn connect_database(config: &Config) -> Result<SqlitePool, AppError> {
    let options =
        SqliteConnectOptions::from_str(&format!("sqlite://{}", config.management_db_path))
            .map_err(database_error)?
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal);
    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(options)
        .await
        .map_err(database_error)?;
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .map_err(|error| AppError::Internal(format!("database migration failed: {error}")))?;
    Ok(pool)
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
        assert_eq!(
            sqlx::query_scalar::<_, i64>("PRAGMA foreign_keys")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn identity_schema_separates_lifecycle_type_and_root_marker() {
        let pool = connect_test_database().await.unwrap();
        let columns: Vec<String> = sqlx::query_scalar("SELECT name FROM pragma_table_info('users')")
            .fetch_all(&pool)
            .await
            .unwrap();

        assert!(columns.contains(&"identity_type".to_string()));
        assert!(columns.contains(&"is_root".to_string()));
        assert!(columns.contains(&"status".to_string()));
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

        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE id = 'prior-user'").fetch_one(&pool).await.unwrap(), 1);
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM groups WHERE id = 'prior-group'").fetch_one(&pool).await.unwrap(), 1);
        for object in [
            "llm_providers",
            "llm_models",
            "prompt_profiles",
            "provider_price_versions",
            "llm_configuration_mutations",
            "llm_providers_identity_immutable",
            "provider_price_versions_current_idx",
        ] {
            assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sqlite_master WHERE name = ?").bind(object).fetch_one(&pool).await.unwrap(), 1, "{object}");
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
        sqlx::raw_sql(include_str!("../migrations/0008_llm_quotas.sql")).execute(&pool).await.unwrap();
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE id = 'prior-user'").fetch_one(&pool).await.unwrap(), 1);
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM groups WHERE id = 'prior-group'").fetch_one(&pool).await.unwrap(), 1);
        for object in ["quota_definitions", "quota_reservations", "quota_reservation_scopes", "usage_ledger", "usage_ledger_immutable_update", "quota_reservation_scope_group_ancestry"] {
            assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sqlite_master WHERE name = ?").bind(object).fetch_one(&pool).await.unwrap(), 1, "{object}");
        }
    }
}
