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
}
