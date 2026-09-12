use std::{io::ErrorKind, net::{IpAddr, SocketAddr}};

use axum::Router;
use mlearn_management::{
    application_router, auth,
    config::Config,
    db::connect_database,
    docker,
    state::AppState,
};
use tracing_subscriber::EnvFilter;

const TOKEN_FILE_TOKEN_PREFIX: &str = "token:";
const TOKEN_FILE_HASH_PREFIX: &str = "sha256:";

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    match parse_cli_command(&std::env::args().skip(1).collect::<Vec<_>>()) {
        Ok(CliCommand::Serve) => {}
        Ok(CliCommand::ResetAdminToken) => {
            reset_admin_token()?;
            return Ok(());
        }
        Ok(CliCommand::Help) => {
            print_help();
            return Ok(());
        }
        Err(message) => {
            eprintln!("{message}");
            print_help();
            std::process::exit(2);
        }
    }

    let config = ensure_token(Config::from_env())?;

    let docker = docker::connect_docker()?;
    match docker.ping().await {
        Ok(info) => tracing::info!("Docker connected: {}", info),
        Err(e) => tracing::warn!("Docker daemon unavailable: {}", e),
    }

    let db = connect_database(&config).await?;
    let has_accounts: i64 = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users)").fetch_one(&db).await?;
    if has_accounts != 0 {
        for (purpose, path) in [("policy signing", Some(config.policy_signing_key_path.as_str())),
            ("encryption", config.encryption_key.is_none().then_some(config.encryption_key_path.as_str()))] {
            if let Some(path) = path {
                if !std::path::Path::new(path).try_exists()? {
                    return Err(format!("existing Management database requires its original {purpose} key; restore the matching backup").into());
                }
            }
        }
    }
    let state = AppState::try_new(docker, config, db)?;

    let bind_addr = SocketAddr::new(state.config.bind_address.parse::<IpAddr>()?, state.config.port);

    let app = build_router(state);

    let listener = tokio::net::TcpListener::bind(bind_addr).await?;
    tracing::info!(
        "mLearn management console listening on http://{}",
        bind_addr
    );

    let shutdown = async {
        let _ = tokio::signal::ctrl_c().await;
        tracing::info!("Shutdown signal received");
    };

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown)
        .await?;

    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CliCommand {
    Serve,
    ResetAdminToken,
    Help,
}

fn parse_cli_command(args: &[String]) -> Result<CliCommand, String> {
    match args {
        [] => Ok(CliCommand::Serve),
        [command]
            if command == "reset-admin-token"
                || command == "--reset-admin-token"
                || command == "reset-token-hash"
                || command == "--reset-token-hash" =>
        {
            Ok(CliCommand::ResetAdminToken)
        }
        [command] if command == "help" || command == "--help" || command == "-h" => {
            Ok(CliCommand::Help)
        }
        [command] => Err(format!("Unknown command: {command}")),
        _ => Err("Expected at most one command".to_string()),
    }
}

fn print_help() {
    println!("mLearn management console");
    println!();
    println!("Usage:");
    println!("  mlearn-management");
    println!("  mlearn-management reset-admin-token");
    println!("  mlearn-management --reset-admin-token");
    println!();
    println!("Commands:");
    println!("  reset-admin-token   Delete the persisted generated admin token file.");
    println!("                      Restart the service to generate and print a new token.");
}

fn reset_admin_token() -> Result<(), Box<dyn std::error::Error>> {
    let token_file = token_file_path();

    if env_value_present("MLEARN_MANAGEMENT_TOKEN")
        || env_value_present("MLEARN_MANAGEMENT_TOKEN_HASH")
    {
        tracing::warn!(
            "MLEARN_MANAGEMENT_TOKEN or MLEARN_MANAGEMENT_TOKEN_HASH is set. Resetting {} only affects generated persisted tokens.",
            token_file
        );
    }

    match std::fs::remove_file(&token_file) {
        Ok(()) => {
            tracing::info!("Reset persisted admin token file: {}", token_file);
            tracing::info!(
                "Restart the management service to generate and print a new admin token."
            );
            Ok(())
        }
        Err(err) if err.kind() == ErrorKind::NotFound => {
            tracing::info!("No persisted admin token file found at {}", token_file);
            tracing::info!("Start the management service to generate and print a new admin token.");
            Ok(())
        }
        Err(err) => Err(Box::new(err)),
    }
}

fn env_value_present(key: &str) -> bool {
    std::env::var(key)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn ensure_token(config: Config) -> Result<Config, Box<dyn std::error::Error>> {
    if let Ok(value) = std::env::var("MLEARN_MANAGEMENT_TOKEN_HASH") {
        if !value.trim().is_empty() && hex::decode(value.trim()).map_or(true, |bytes| bytes.len() != 32) {
            return Err("MLEARN_MANAGEMENT_TOKEN_HASH must be a SHA-256 hex digest".into());
        }
    }
    ensure_token_at(config, std::path::Path::new(&token_file_path()))
}

fn ensure_token_at(mut config: Config, path: &std::path::Path) -> Result<Config, Box<dyn std::error::Error>> {
    use std::io::{Read, Write};
    if config.token_hash.is_some() { return Ok(config); }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)] {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    match options.open(path) {
        Ok(mut file) => {
            if !file.metadata()?.is_file() { return Err("recovery credential must be a regular file".into()); }
            #[cfg(unix)] {
                use std::os::unix::fs::PermissionsExt;
                file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
            }
            let mut raw = String::new();
            file.read_to_string(&mut raw)?;
            config.token_hash = Some(match parse_token_file(raw.trim()) {
                TokenFileValue::Token(token) => {
                    tracing::info!("Loaded persisted admin token: {}", token);
                    auth::hash_token(&token)
                }
                TokenFileValue::Hash(hash) => hash,
                TokenFileValue::Malformed => return Err("malformed recovery credential; restore it or explicitly reset-admin-token".into()),
            });
            return Ok(config);
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    if let Some(parent) = path.parent().filter(|parent| !parent.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)?;
    }
    let token = auth::generate_random_token();
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)] {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options.open(path)?;
    file.write_all(format!("{TOKEN_FILE_TOKEN_PREFIX}{token}\n").as_bytes())?;
    file.sync_all()?;
    config.token_hash = Some(auth::hash_token(&token));
    tracing::info!("Generated admin token: {}", token);
    Ok(config)
}

enum TokenFileValue {
    Token(String),
    Hash([u8; 32]),
    Malformed,
}

fn parse_token_file(value: &str) -> TokenFileValue {
    if let Some(token) = value.strip_prefix(TOKEN_FILE_TOKEN_PREFIX) {
        let token = token.trim();
        if !token.is_empty() {
            return TokenFileValue::Token(token.to_string());
        }
        return TokenFileValue::Malformed;
    }

    if let Some(hex_hash) = value.strip_prefix(TOKEN_FILE_HASH_PREFIX) {
        return parse_hash_token_file(hex_hash.trim());
    }

    parse_hash_token_file(value)
}

fn parse_hash_token_file(hex_hash: &str) -> TokenFileValue {
    if let Ok(bytes) = hex::decode(hex_hash) {
        if bytes.len() == 32 {
            let mut arr = [0u8; 32];
            arr.copy_from_slice(&bytes);
            return TokenFileValue::Hash(arr);
        }
    }

    TokenFileValue::Malformed
}

fn token_file_path() -> String {
    if let Ok(token_file) = std::env::var("MLEARN_TOKEN_FILE") {
        let token_file = token_file.trim();
        if !token_file.is_empty() {
            return token_file.to_string();
        }
    }

    if cfg!(debug_assertions) {
        "admin-token-hash".to_string()
    } else {
        "/data/admin-token-hash".to_string()
    }
}

fn build_router(state: AppState) -> Router {
    application_router(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::{header, Request, StatusCode},
    };
    use serde_json::Value;
    use sqlx::sqlite::SqlitePoolOptions;
    use tower::ServiceExt;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn recovery_token_persists_and_malformed_state_does_not_rotate() {
        let path = std::env::temp_dir().join(format!("mlearn-recovery-{}", uuid::Uuid::now_v7()));
        let mut config = Config::from_env();
        config.token_hash = None;
        config.env_mode = mlearn_management::config::EnvMode::Development;
        let first = ensure_token_at(config.clone(), &path).unwrap();
        let second = ensure_token_at(config.clone(), &path).unwrap();
        assert_eq!(first.token_hash, second.token_hash);
        std::fs::write(&path, "malformed").unwrap();
        assert!(ensure_token_at(config, &path).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "malformed");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn cli_defaults_to_serving() {
        assert_eq!(parse_cli_command(&args(&[])), Ok(CliCommand::Serve));
    }

    #[test]
    fn cli_accepts_admin_token_reset_aliases() {
        assert_eq!(
            parse_cli_command(&args(&["reset-admin-token"])),
            Ok(CliCommand::ResetAdminToken)
        );
        assert_eq!(
            parse_cli_command(&args(&["--reset-admin-token"])),
            Ok(CliCommand::ResetAdminToken)
        );
        assert_eq!(
            parse_cli_command(&args(&["reset-token-hash"])),
            Ok(CliCommand::ResetAdminToken)
        );
        assert_eq!(
            parse_cli_command(&args(&["--reset-token-hash"])),
            Ok(CliCommand::ResetAdminToken)
        );
    }

    #[test]
    fn cli_rejects_unknown_commands() {
        assert!(parse_cli_command(&args(&["wat"])).is_err());
        assert!(parse_cli_command(&args(&["reset-admin-token", "extra"])).is_err());
    }

    #[tokio::test]
    async fn application_router_uses_named_sessions_and_preserves_health() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let recovery_token = "application-router-recovery";
        let mut config = Config::from_env();
        config.token_hash = Some(auth::hash_token(recovery_token));
        let signing_key_path = std::env::temp_dir().join(format!(
            "mlearn-policy-signing-key-{}",
            uuid::Uuid::now_v7()
        ));
        config.policy_signing_key_path = signing_key_path.to_string_lossy().into_owned();
        let encryption_key_path =
            std::env::temp_dir().join(format!("mlearn-encryption-key-{}", uuid::Uuid::now_v7()));
        config.encryption_key_path = encryption_key_path.to_string_lossy().into_owned();
        let docker = bollard::Docker::connect_with_http_defaults().unwrap();
        let app = build_router(AppState::new(docker, config, pool));
        let _ = std::fs::remove_file(signing_key_path);
        let _ = std::fs::remove_file(encryption_key_path);

        let health = app
            .clone()
            .oneshot(Request::get("/api/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(health.status(), StatusCode::OK);

        let legacy = app
            .clone()
            .oneshot(
                Request::get("/api/school")
                    .header(header::AUTHORIZATION, format!("Bearer {recovery_token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(legacy.status(), StatusCode::UNAUTHORIZED);

        let bootstrap = app
            .clone()
            .oneshot(
                Request::post("/api/auth/bootstrap")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::AUTHORIZATION, format!("Bearer {recovery_token}"))
                    .body(Body::from(
                        serde_json::json!({
                            "email": "admin@school.test",
                            "password": "Correct Horse Battery Staple"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(bootstrap.status(), StatusCode::OK);
        let body: Value =
            serde_json::from_slice(&to_bytes(bootstrap.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        let access_token = body["session"]["accessToken"].as_str().unwrap();
        let named = app
            .oneshot(
                Request::get("/api/school")
                    .header(header::AUTHORIZATION, format!("Bearer {access_token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(named.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn non_root_admin_cannot_access_root_only_legacy_routes() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let mut config = Config::from_env();
        config.token_hash = Some(auth::hash_token("root-recovery"));
        let signing_key_path = std::env::temp_dir().join(format!(
            "mlearn-policy-signing-key-{}",
            uuid::Uuid::now_v7()
        ));
        config.policy_signing_key_path = signing_key_path.to_string_lossy().into_owned();
        let encryption_key_path =
            std::env::temp_dir().join(format!("mlearn-encryption-key-{}", uuid::Uuid::now_v7()));
        config.encryption_key_path = encryption_key_path.to_string_lossy().into_owned();
        let docker = bollard::Docker::connect_with_http_defaults().unwrap();
        let state = AppState::new(docker, config, pool.clone());
        let _ = std::fs::remove_file(signing_key_path);
        let _ = std::fs::remove_file(encryption_key_path);
        let user_id = uuid::Uuid::now_v7().to_string();
        let now = time::OffsetDateTime::now_utc().unix_timestamp();
        sqlx::query("INSERT INTO users (id, email, normalized_email, display_name, status, identity_type, is_root, created_at, updated_at) VALUES (?, 'admin@branch.test', 'admin@branch.test', 'Branch Admin', 'active', 'admin', 0, ?, ?)")
            .bind(&user_id)
            .bind(now)
            .bind(now)
            .execute(&pool)
            .await
            .unwrap();
        let issued = state
            .identity
            .issue_session(&user_id, None, None)
            .await
            .unwrap();
        let app = build_router(state);

        let response = app
            .oneshot(
                Request::get("/api/school")
                    .header(
                        header::AUTHORIZATION,
                        format!("Bearer {}", issued.access_token),
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn llm_stream_router_enforces_named_learner_sessions_and_stable_errors() {
        let pool = SqlitePoolOptions::new()
            .max_connections(2)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let mut config = Config::from_env();
        let signing_key_path = std::env::temp_dir().join(format!(
            "mlearn-policy-signing-key-{}",
            uuid::Uuid::now_v7()
        ));
        config.policy_signing_key_path = signing_key_path.to_string_lossy().into_owned();
        let encryption_key_path =
            std::env::temp_dir().join(format!("mlearn-encryption-key-{}", uuid::Uuid::now_v7()));
        config.encryption_key_path = encryption_key_path.to_string_lossy().into_owned();
        let state = AppState::new(
            bollard::Docker::connect_with_http_defaults().unwrap(),
            config,
            pool.clone(),
        );
        let now = time::OffsetDateTime::now_utc().unix_timestamp();
        for (id, kind) in [("teacher", "teacher"), ("learner", "learner")] {
            sqlx::query("INSERT INTO users (id, email, normalized_email, display_name, status, identity_type, is_root, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, 0, ?, ?)")
                .bind(id).bind(format!("{id}@test.invalid")).bind(format!("{id}@test.invalid")).bind(id).bind(kind).bind(now).bind(now).execute(&pool).await.unwrap();
        }
        let teacher = state
            .identity
            .issue_session("teacher", None, None)
            .await
            .unwrap();
        let learner = state
            .identity
            .issue_session("learner", None, None)
            .await
            .unwrap();
        let app = build_router(state);
        let body = serde_json::json!({"messages":[{"role":"user","content":"hi"}]}).to_string();

        let nonlearner = app
            .clone()
            .oneshot(
                Request::post("/api/llm/stream")
                    .header(
                        header::AUTHORIZATION,
                        format!("Bearer {}", teacher.access_token),
                    )
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(nonlearner.status(), StatusCode::CONFLICT);
        assert_eq!(
            serde_json::from_slice::<Value>(
                &to_bytes(nonlearner.into_body(), usize::MAX).await.unwrap()
            )
            .unwrap()["error"],
            "invalid_active_group"
        );

        let no_group = app
            .clone()
            .oneshot(
                Request::post("/api/llm/stream")
                    .header(
                        header::AUTHORIZATION,
                        format!("Bearer {}", learner.access_token),
                    )
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(no_group.status(), StatusCode::CONFLICT);
        assert_eq!(
            serde_json::from_slice::<Value>(
                &to_bytes(no_group.into_body(), usize::MAX).await.unwrap()
            )
            .unwrap()["error"],
            "invalid_active_group"
        );

        for _ in 0..119 {
            let invalid = app
                .clone()
                .oneshot(
                    Request::post("/api/llm/stream")
                        .header(
                            header::AUTHORIZATION,
                            format!("Bearer {}", learner.access_token),
                        )
                        .body(Body::from("not-json"))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
        }
        let limited = app
            .clone()
            .oneshot(
                Request::post("/api/llm/stream")
                    .header(
                        header::AUTHORIZATION,
                        format!("Bearer {}", learner.access_token),
                    )
                    .body(Body::from("not-json"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(limited.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(
            serde_json::from_slice::<Value>(
                &to_bytes(limited.into_body(), usize::MAX).await.unwrap()
            )
            .unwrap()["error"],
            "rate_limited"
        );

        let session_id: String =
            sqlx::query_scalar("SELECT id FROM sessions WHERE user_id = 'learner'")
                .fetch_one(&pool)
                .await
                .unwrap();
        sqlx::query("UPDATE sessions SET revoked_at = ? WHERE id = ?")
            .bind(now)
            .bind(session_id)
            .execute(&pool)
            .await
            .unwrap();
        let revoked = app
            .oneshot(
                Request::post("/api/llm/stream")
                    .header(
                        header::AUTHORIZATION,
                        format!("Bearer {}", learner.access_token),
                    )
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(revoked.status(), StatusCode::UNAUTHORIZED);
        let _ = std::fs::remove_file(signing_key_path);
        let _ = std::fs::remove_file(encryption_key_path);
    }
}
