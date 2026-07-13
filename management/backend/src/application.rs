use axum::{
    extract::{Request, State},
    middleware::{self, Next},
    response::Response,
    routing::{get, post},
    Json, Router,
};
use serde_json::json;
use tower_http::{cors::CorsLayer, trace::TraceLayer};

use crate::{auth, error::AppError, routes, state::AppState, static_handler};

async fn root_auth_middleware(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, AppError> {
    let auth_header = request
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let token = auth::extract_bearer(auth_header).ok_or(AppError::Unauthorized)?;
    let principal = state.identity.principal_from_access_token(token).await?;
    if !principal.is_root {
        return Err(AppError::Forbidden("root access required".into()));
    }
    request.extensions_mut().insert(principal);
    Ok(next.run(request).await)
}

/// Builds the exact production HTTP application. Keeping this in the library lets
/// external integration tests exercise the same auth, routing, and middleware stack.
pub fn application_router(state: AppState) -> Router {
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
            root_auth_middleware,
        ));

    Router::new()
        .route(
            "/api/health",
            get(|| async { Json(json!({"status": "ok"})) }),
        )
        .merge(routes::auth::router(state.clone()))
        .merge(routes::groups::router(state.clone()))
        .merge(routes::governance::router(state.clone()))
        .merge(routes::users::router(state.clone()))
        .merge(routes::api_keys::router(state.clone()))
        .merge(routes::audit::router(state.clone()))
        .merge(routes::policies::router(state.clone()))
        .merge(routes::search::router(state.clone()))
        .merge(routes::llm_configuration::router(state.clone()))
        .merge(routes::quotas::router(state.clone()))
        .merge(routes::llm_gateway::router(state.clone()))
        .merge(routes::conversations::router(state.clone()))
        .merge(routes::analytics::router(state.clone()))
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
