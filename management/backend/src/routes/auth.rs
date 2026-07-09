use axum::{
    extract::State,
    http::{header, HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::{
    auth::extract_bearer,
    error::AppError,
    identity::{AuthenticatedUser, IssuedSession, Principal},
    state::AppState,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapRequest {
    email: String,
    password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginRequest {
    email: String,
    password: String,
    device_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopInitRequest {
    state: String,
    code_challenge: String,
    code_challenge_method: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopApproveRequest {
    request_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopExchangeRequest {
    code: String,
    code_verifier: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RefreshRequest {
    refresh_token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthSessionDto {
    access_token: String,
    refresh_token: String,
    expires_at: i64,
}

#[derive(Serialize)]
struct UserDto {
    id: String,
    email: String,
}

#[derive(Serialize)]
struct AuthResponse {
    session: AuthSessionDto,
    user: UserDto,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopRequestData {
    state: String,
    code_challenge: String,
    code_challenge_method: String,
}

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/api/auth/bootstrap", post(bootstrap))
        .route("/api/auth/login", post(login))
        .route("/api/auth/desktop/init", post(desktop_init))
        .route("/api/auth/desktop/approve", post(desktop_approve))
        .route("/api/auth/desktop/exchange", post(desktop_exchange))
        .route("/api/auth/refresh", post(refresh))
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/me", get(me))
        .with_state(state)
}

async fn bootstrap(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<BootstrapRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    let recovery_token = bearer_from_headers(&headers)?;
    let user = state
        .identity
        .bootstrap_root(recovery_token, &request.email, &request.password)
        .await?;
    let session = state.identity.issue_session(&user.id, None, None).await?;
    Ok(Json(auth_response(user, session)))
}

async fn login(
    State(state): State<AppState>,
    Json(request): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    let user = state
        .identity
        .authenticate_password(&request.email, &request.password)
        .await?;
    let session = state
        .identity
        .issue_session(&user.id, request.device_id.as_deref(), None)
        .await?;
    Ok(Json(auth_response(user, session)))
}

async fn desktop_init(
    State(state): State<AppState>,
    Json(request): Json<DesktopInitRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if request.state.trim().is_empty()
        || request.code_challenge.trim().is_empty()
        || request.code_challenge_method != "S256"
    {
        return Err(AppError::BadRequest(
            "desktop login requires state and S256 PKCE".into(),
        ));
    }
    let request_id = Uuid::now_v7().to_string();
    let device_id = Uuid::now_v7().to_string();
    let now = OffsetDateTime::now_utc().unix_timestamp();
    let expires_at = (OffsetDateTime::now_utc() + Duration::minutes(10)).unix_timestamp();
    let request_data = serde_json::to_string(&DesktopRequestData {
        state: request.state,
        code_challenge: request.code_challenge,
        code_challenge_method: request.code_challenge_method,
    })
    .map_err(|error| AppError::Internal(format!("desktop request encoding failed: {error}")))?;
    let mut transaction = state.db.begin().await.map_err(database_error)?;
    sqlx::query("INSERT INTO devices (id, user_id, name, platform, created_at, last_seen_at) VALUES (?, NULL, 'Desktop login', 'desktop', ?, ?)")
        .bind(&device_id)
        .bind(now)
        .bind(now)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
    sqlx::query("INSERT INTO desktop_login_requests (id, device_id, user_id, request_secret_hash, status, expires_at, created_at, completed_at) VALUES (?, ?, NULL, ?, 'pending', ?, ?, NULL)")
        .bind(&request_id)
        .bind(&device_id)
        .bind(request_data)
        .bind(expires_at)
        .bind(now)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
    insert_route_audit(
        &mut transaction,
        None,
        "identity.desktop_initialized",
        &request_id,
        now,
    )
    .await?;
    transaction.commit().await.map_err(database_error)?;
    Ok(Json(serde_json::json!({
        "loginUrl": format!("/login?request={request_id}")
    })))
}

async fn desktop_approve(
    State(state): State<AppState>,
    principal: Principal,
    Json(request): Json<DesktopApproveRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let now = OffsetDateTime::now_utc().unix_timestamp();
    let mut transaction = state.db.begin().await.map_err(database_error)?;
    let row = sqlx::query("SELECT request_secret_hash, device_id FROM desktop_login_requests WHERE id = ? AND status = 'pending' AND expires_at > ?")
        .bind(&request.request_id)
        .bind(now)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(database_error)?
        .ok_or_else(|| AppError::BadRequest("desktop login request is invalid or expired".into()))?;
    let request_data: DesktopRequestData = serde_json::from_str(row.get("request_secret_hash"))
        .map_err(|error| AppError::Internal(format!("desktop request decoding failed: {error}")))?;
    let device_id: String = row.get("device_id");
    sqlx::query("UPDATE desktop_login_requests SET user_id = ?, status = 'approved' WHERE id = ? AND status = 'pending'")
        .bind(&principal.user_id)
        .bind(&request.request_id)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
    sqlx::query("UPDATE devices SET user_id = ?, last_seen_at = ? WHERE id = ?")
        .bind(&principal.user_id)
        .bind(now)
        .bind(device_id)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
    insert_route_audit(
        &mut transaction,
        Some(&principal.user_id),
        "identity.desktop_approved",
        &request.request_id,
        now,
    )
    .await?;
    transaction.commit().await.map_err(database_error)?;
    Ok(Json(serde_json::json!({
        "code": request.request_id,
        "state": request_data.state
    })))
}

async fn desktop_exchange(
    State(state): State<AppState>,
    Json(request): Json<DesktopExchangeRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    let now = OffsetDateTime::now_utc().unix_timestamp();
    let row = sqlx::query("SELECT request_secret_hash, device_id, user_id FROM desktop_login_requests WHERE id = ? AND status = 'approved' AND expires_at > ?")
        .bind(&request.code)
        .bind(now)
        .fetch_optional(&state.db)
        .await
        .map_err(database_error)?
        .ok_or_else(|| AppError::BadRequest("desktop auth code is invalid or expired".into()))?;
    let request_data: DesktopRequestData = serde_json::from_str(row.get("request_secret_hash"))
        .map_err(|error| AppError::Internal(format!("desktop request decoding failed: {error}")))?;
    if request_data.code_challenge_method != "S256"
        || URL_SAFE_NO_PAD.encode(Sha256::digest(request.code_verifier.as_bytes()))
            != request_data.code_challenge
    {
        return Err(AppError::Unauthorized);
    }
    let device_id: String = row.get("device_id");
    let user_id: String = row.get("user_id");
    let mut transaction = state.db.begin().await.map_err(database_error)?;
    let completed = sqlx::query("UPDATE desktop_login_requests SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'approved'")
        .bind(now)
        .bind(&request.code)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
    if completed.rows_affected() != 1 {
        return Err(AppError::Conflict(
            "desktop auth code has already been used".into(),
        ));
    }
    insert_route_audit(
        &mut transaction,
        Some(&user_id),
        "identity.desktop_exchanged",
        &request.code,
        now,
    )
    .await?;
    transaction.commit().await.map_err(database_error)?;
    let user = state.identity.user(&user_id).await?;
    let session = state
        .identity
        .issue_session(&user_id, Some(&device_id), None)
        .await?;
    Ok(Json(auth_response(user, session)))
}

async fn refresh(
    State(state): State<AppState>,
    Json(request): Json<RefreshRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let session = state
        .identity
        .rotate_refresh_token(&request.refresh_token)
        .await?;
    Ok(Json(serde_json::json!({
        "session": AuthSessionDto::from(session)
    })))
}

async fn logout(
    State(state): State<AppState>,
    principal: Principal,
) -> Result<StatusCode, AppError> {
    state.identity.revoke_session(&principal.session_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn me(
    State(state): State<AppState>,
    principal: Principal,
) -> Result<Json<UserDto>, AppError> {
    let user = state.identity.user(&principal.user_id).await?;
    Ok(Json(UserDto {
        id: user.id,
        email: user.email,
    }))
}

impl From<IssuedSession> for AuthSessionDto {
    fn from(session: IssuedSession) -> Self {
        Self {
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            expires_at: session.expires_at,
        }
    }
}

fn auth_response(user: AuthenticatedUser, session: IssuedSession) -> AuthResponse {
    AuthResponse {
        session: session.into(),
        user: UserDto {
            id: user.id,
            email: user.email,
        },
    }
}

fn bearer_from_headers(headers: &HeaderMap) -> Result<&str, AppError> {
    let value = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    extract_bearer(value).ok_or(AppError::Unauthorized)
}

async fn insert_route_audit(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    actor_user_id: Option<&str>,
    action: &str,
    target_id: &str,
    now: i64,
) -> Result<(), AppError> {
    sqlx::query("INSERT INTO audit_events (id, actor_user_id, action, target_type, target_id, metadata_json, created_at) VALUES (?, ?, ?, 'desktop_login_request', ?, NULL, ?)")
        .bind(Uuid::now_v7().to_string())
        .bind(actor_user_id)
        .bind(action)
        .bind(target_id)
        .bind(now)
        .execute(&mut **transaction)
        .await
        .map_err(database_error)?;
    Ok(())
}

fn database_error(error: sqlx::Error) -> AppError {
    AppError::Internal(format!("database error: {error}"))
}

#[cfg(test)]
mod tests {
    use axum::{
        body::{to_bytes, Body},
        http::{header, Request, StatusCode},
        Router,
    };
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use serde_json::{json, Value};
    use sha2::{Digest, Sha256};
    use sqlx::sqlite::SqlitePoolOptions;
    use tower::ServiceExt;

    use crate::{auth::hash_token, config::Config, state::AppState};

    async fn fixture() -> (Router, String, sqlx::SqlitePool) {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let bootstrap = "route-bootstrap-token".to_string();
        let mut config = Config::from_env();
        config.token_hash = Some(hash_token(&bootstrap));
        let docker = bollard::Docker::connect_with_http_defaults().unwrap();
        let state = AppState::new(docker, config, pool.clone());
        (
            super::router(state.clone()).with_state(state),
            bootstrap,
            pool,
        )
    }

    async fn json_request(
        app: &Router,
        method: &str,
        uri: &str,
        body: Value,
        bearer: Option<&str>,
    ) -> (StatusCode, Value) {
        let mut request = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(token) = bearer {
            request = request.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        let response = app
            .clone()
            .oneshot(request.body(Body::from(body.to_string())).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, body)
    }

    async fn bootstrap(app: &Router, token: &str) -> Value {
        let (status, body) = json_request(
            app,
            "POST",
            "/api/auth/bootstrap",
            json!({
                "email": "admin@school.test",
                "password": "Correct Horse Battery Staple"
            }),
            Some(token),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        body
    }

    #[tokio::test]
    async fn desktop_exchange_returns_compatible_camel_case_session_envelope() {
        let (app, bootstrap_token, pool) = fixture().await;
        let bootstrapped = bootstrap(&app, &bootstrap_token).await;
        let access_token = bootstrapped["session"]["accessToken"].as_str().unwrap();
        let verifier = "desktop-pkce-verifier";
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));

        let (init_status, initialized) = json_request(
            &app,
            "POST",
            "/api/auth/desktop/init",
            json!({
                "state": "desktop-state",
                "codeChallenge": challenge,
                "codeChallengeMethod": "S256"
            }),
            None,
        )
        .await;
        assert_eq!(init_status, StatusCode::OK, "{initialized}");
        let request_id = initialized["loginUrl"]
            .as_str()
            .unwrap()
            .split("request=")
            .nth(1)
            .unwrap();

        let (approve_status, approved) = json_request(
            &app,
            "POST",
            "/api/auth/desktop/approve",
            json!({ "requestId": request_id }),
            Some(access_token),
        )
        .await;
        assert_eq!(approve_status, StatusCode::OK, "{approved}");

        let (exchange_status, exchanged) = json_request(
            &app,
            "POST",
            "/api/auth/desktop/exchange",
            json!({ "code": approved["code"], "codeVerifier": verifier }),
            None,
        )
        .await;
        assert_eq!(exchange_status, StatusCode::OK, "{exchanged}");
        assert!(exchanged["session"]["accessToken"].is_string());
        assert!(exchanged["session"]["refreshToken"].is_string());
        assert!(exchanged["session"]["expiresAt"].is_number());
        assert_eq!(exchanged["user"]["email"], "admin@school.test");
        assert!(exchanged["session"].get("access_token").is_none());
        let audited_actions: Vec<String> = sqlx::query_scalar(
            "SELECT action FROM audit_events WHERE action LIKE 'identity.desktop_%' ORDER BY action",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            audited_actions,
            vec![
                "identity.desktop_approved".to_string(),
                "identity.desktop_exchanged".to_string(),
                "identity.desktop_initialized".to_string(),
            ]
        );
    }

    #[tokio::test]
    async fn refresh_is_single_use_and_me_rejects_revoked_session() {
        let (app, bootstrap_token, _pool) = fixture().await;
        let bootstrapped = bootstrap(&app, &bootstrap_token).await;
        let access_token = bootstrapped["session"]["accessToken"].as_str().unwrap();
        let refresh_token = bootstrapped["session"]["refreshToken"].as_str().unwrap();

        let (first_status, refreshed) = json_request(
            &app,
            "POST",
            "/api/auth/refresh",
            json!({ "refreshToken": refresh_token }),
            None,
        )
        .await;
        assert_eq!(first_status, StatusCode::OK, "{refreshed}");
        let (second_status, _) = json_request(
            &app,
            "POST",
            "/api/auth/refresh",
            json!({ "refreshToken": refresh_token }),
            None,
        )
        .await;
        assert_eq!(second_status, StatusCode::UNAUTHORIZED);

        let current_access = refreshed["session"]["accessToken"].as_str().unwrap();
        let (logout_status, _) = json_request(
            &app,
            "POST",
            "/api/auth/logout",
            json!({}),
            Some(current_access),
        )
        .await;
        assert_eq!(logout_status, StatusCode::NO_CONTENT);
        let (me_status, _) = json_request(
            &app,
            "GET",
            "/api/auth/me",
            Value::Null,
            Some(current_access),
        )
        .await;
        assert_eq!(me_status, StatusCode::UNAUTHORIZED);
        assert_ne!(access_token, current_access);
    }
}
