use std::net::SocketAddr;

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
    docker,
    routes,
    state::AppState,
    static_handler,
};
use serde_json::json;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config = ensure_token(Config::from_env());

    if config.fail_closed() {
        tracing::warn!("FAIL-CLOSED: No admin token configured. All API requests will be rejected.");
        tracing::warn!("Set MLEARN_MANAGEMENT_TOKEN to enable access.");
    }

    let docker = docker::connect_docker()?;
    match docker.ping().await {
        Ok(info) => tracing::info!("Docker connected: {}", info),
        Err(e) => tracing::warn!("Docker daemon unavailable: {}", e),
    }

    let state = AppState::new(docker, config);

    let bind_addr: SocketAddr =
        format!("{}:{}", state.config.bind_address, state.config.port)
            .parse()
            .unwrap_or_else(|_| SocketAddr::from(([127, 0, 0, 1], 3000)));

    let app = build_router(state);

    let listener = tokio::net::TcpListener::bind(bind_addr).await?;
    tracing::info!("mLearn management console listening on http://{}", bind_addr);

    let shutdown = async {
        let _ = tokio::signal::ctrl_c().await;
        tracing::info!("Shutdown signal received");
    };

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown)
        .await?;

    Ok(())
}

fn ensure_token(mut config: Config) -> Config {
    if config.token_hash.is_some() {
        return config;
    }

    if config.env_mode != EnvMode::Production {
        return config;
    }

    let token_file = std::env::var("MLEARN_TOKEN_FILE")
        .unwrap_or_else(|_| "/data/admin-token-hash".to_string());

    if let Ok(hex_hash) = std::fs::read_to_string(&token_file) {
        let hex_hash = hex_hash.trim();
        if let Ok(bytes) = hex::decode(hex_hash) {
            if bytes.len() == 32 {
                let mut arr = [0u8; 32];
                arr.copy_from_slice(&bytes);
                config.token_hash = Some(arr);
                tracing::info!("Loaded persisted admin token from {}", token_file);
                return config;
            }
        }
        tracing::warn!("Existing token file at {} is malformed. Generating a new token.", token_file);
    }

    let token = auth::generate_random_token();
    let hash = auth::hash_token(&token);
    tracing::info!("Generated admin token: {}", token);
    tracing::info!("Store this securely. It will not be shown again.");

    if let Some(parent) = std::path::Path::new(&token_file).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::write(&token_file, hex::encode(hash)) {
        Ok(_) => {
            tracing::info!("Token hash persisted to {}", token_file);
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&token_file, std::fs::Permissions::from_mode(0o600));
            }
        }
        Err(e) => tracing::warn!("Failed to persist token hash to {}: {}. Token will change on restart.", token_file, e),
    }

    config.token_hash = Some(hash);
    config
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
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ));

    Router::new()
        .route("/api/health", get(|| async { Json(json!({"status": "ok"})) }))
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
