use std::{io::ErrorKind, net::SocketAddr};

use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::Response,
    routing::{get, post},
    Json, Router,
};
use mlearn_management::{
    auth,
    config::{Config, EnvMode},
    docker, routes,
    state::AppState,
    static_handler,
};
use serde_json::json;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
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

    let config = ensure_token(Config::from_env());

    if config.fail_closed() {
        tracing::warn!(
            "FAIL-CLOSED: No admin token configured. All API requests will be rejected."
        );
        tracing::warn!("Set MLEARN_MANAGEMENT_TOKEN to enable access.");
    }

    let docker = docker::connect_docker()?;
    match docker.ping().await {
        Ok(info) => tracing::info!("Docker connected: {}", info),
        Err(e) => tracing::warn!("Docker daemon unavailable: {}", e),
    }

    let state = AppState::new(docker, config);

    let bind_addr: SocketAddr = format!("{}:{}", state.config.bind_address, state.config.port)
        .parse()
        .unwrap_or_else(|_| SocketAddr::from(([127, 0, 0, 1], 3000)));

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

fn ensure_token(mut config: Config) -> Config {
    if config.token_hash.is_some() {
        return config;
    }

    if config.env_mode != EnvMode::Production {
        return config;
    }

    let token_file = token_file_path();

    if let Ok(raw_token_file) = std::fs::read_to_string(&token_file) {
        match parse_token_file(raw_token_file.trim()) {
            TokenFileValue::Token(token) => {
                config.token_hash = Some(auth::hash_token(&token));
                tracing::info!("Loaded persisted admin token: {}", token);
                tracing::info!("Token loaded from {}", token_file);
                return config;
            }
            TokenFileValue::Hash(hash) => {
                config.token_hash = Some(hash);
                tracing::info!("Loaded persisted admin token hash from {}", token_file);
                tracing::warn!(
                    "This token file only contains a hash, so the admin token cannot be printed. Delete {} to generate a new recoverable token.",
                    token_file
                );
                return config;
            }
            TokenFileValue::Malformed => {
                tracing::warn!(
                    "Existing token file at {} is malformed. Generating a new token.",
                    token_file
                );
            }
        }
    }

    let token = auth::generate_random_token();
    let hash = auth::hash_token(&token);
    tracing::info!("Generated admin token: {}", token);
    tracing::info!(
        "The generated token will be printed again on restart while the token file is present."
    );

    if let Some(parent) = std::path::Path::new(&token_file).parent() {
        if let Err(err) = std::fs::create_dir_all(parent) {
            tracing::warn!(
                "Failed to create token directory {}: {}",
                parent.display(),
                err
            );
        }
    }
    match std::fs::write(&token_file, format!("{TOKEN_FILE_TOKEN_PREFIX}{token}\n")) {
        Ok(_) => {
            tracing::info!("Recoverable admin token persisted to {}", token_file);
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ =
                    std::fs::set_permissions(&token_file, std::fs::Permissions::from_mode(0o600));
            }
        }
        Err(e) => tracing::warn!(
            "Failed to persist token hash to {}: {}. Token will change on restart.",
            token_file,
            e
        ),
    }

    config.token_hash = Some(hash);
    config
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

async fn auth_middleware(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    if state.config.fail_closed() {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let stored_hash = match &state.config.token_hash {
        Some(hash) => hash,
        None => return Ok(next.run(request).await),
    };

    let auth_header = request
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let provided = auth::extract_bearer(auth_header).ok_or(StatusCode::UNAUTHORIZED)?;

    if auth::verify_token(provided, stored_hash) {
        Ok(next.run(request).await)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

fn build_router(state: AppState) -> Router {
    let protected = Router::new()
        .route("/api/overview", get(routes::overview::get_overview))
        .route("/api/services", get(routes::services::get_services))
        .route(
            "/api/services/{id}/{action}",
            post(routes::services::perform_service_action),
        )
        .route(
            "/api/services/{id}/logs",
            get(routes::logs::get_service_logs),
        )
        .route("/api/config", get(routes::config::get_config))
        .route("/api/storage", get(routes::storage::get_storage))
        .route("/api/ai-status", get(routes::ai_status::get_ai_status))
        .route("/api/school", get(routes::school::get_school_status))
        .route("/api/users", get(routes::users::get_users))
        .route(
            "/api/distribution",
            get(routes::distribution::get_distribution),
        )
        .route(
            "/api/llm-gateway",
            get(routes::llm_gateway::get_llm_gateway),
        )
        .route("/api/analytics", get(routes::analytics::get_analytics))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ));

    Router::new()
        .route(
            "/api/health",
            get(|| async { Json(json!({"status": "ok"})) }),
        )
        .merge(protected)
        .fallback(static_handler::serve_spa)
        .layer(TraceLayer::new_for_http())
        .layer(if cfg!(debug_assertions) {
            CorsLayer::permissive()
        } else {
            CorsLayer::new()
        })
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
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
}
