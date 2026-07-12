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
    auth::{extract_bearer, hash_token_hex},
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
    #[serde(rename = "isRoot")]
    is_root: bool,
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
        .route("/api/auth/recover-root", post(recover_root))
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
    let (user, session) = state
        .identity
        .bootstrap_root_with_session(recovery_token, &request.email, &request.password)
        .await?;
    Ok(Json(auth_response(user, session)))
}

async fn recover_root(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<BootstrapRequest>,
) -> Result<StatusCode, AppError> {
    let recovery_token = bearer_from_headers(&headers)?;
    state
        .identity
        .recover_root_password(recovery_token, &request.email, &request.password)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn login(
    State(state): State<AppState>,
    Json(request): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    let identifier_hash = hash_token_hex(&request.email.trim().to_ascii_lowercase());
    if let Err(error) = check_auth_rate_limits(&state, "login", &identifier_hash) {
        audit_auth_failure(
            &state,
            "identity.login_failure",
            &identifier_hash,
            "rate_limited",
        )
        .await?;
        return Err(error);
    }
    let user = match state
        .identity
        .authenticate_password(&request.email, &request.password)
        .await
    {
        Ok(user) => user,
        Err(error) => {
            audit_auth_failure(
                &state,
                "identity.login_failure",
                &identifier_hash,
                "invalid_credentials",
            )
            .await?;
            return Err(error);
        }
    };
    let mut transaction = state.db.begin().await.map_err(database_error)?;
    let session = state
        .identity
        .issue_session_in_transaction(
            &mut transaction,
            &user.id,
            request.device_id.as_deref(),
            None,
        )
        .await?;
    insert_auth_audit(
        &mut transaction,
        Some(&user.id),
        "identity.login_success",
        &identifier_hash,
        "success",
    )
    .await?;
    transaction.commit().await.map_err(database_error)?;
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
        "loginUrl": format!("{}/login?request={request_id}", state.config.public_url)
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
    let user = state.identity.user(&user_id).await?;
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
    let session = state
        .identity
        .issue_session_in_transaction(&mut transaction, &user_id, Some(&device_id), None)
        .await?;
    transaction.commit().await.map_err(database_error)?;
    Ok(Json(auth_response(user, session)))
}

async fn refresh(
    State(state): State<AppState>,
    Json(request): Json<RefreshRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let identifier_hash = hash_token_hex(&request.refresh_token);
    if let Err(error) = check_auth_rate_limits(&state, "refresh", &identifier_hash) {
        audit_auth_failure(
            &state,
            "identity.refresh_failure",
            &identifier_hash,
            "rate_limited",
        )
        .await?;
        return Err(error);
    }
    let session = match state
        .identity
        .rotate_refresh_token(&request.refresh_token)
        .await
    {
        Ok(session) => session,
        Err(error) => {
            audit_auth_failure(
                &state,
                "identity.refresh_failure",
                &identifier_hash,
                "invalid_token",
            )
            .await?;
            return Err(error);
        }
    };
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
        is_root: principal.is_root,
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
            is_root: user.is_root,
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

fn check_auth_rate_limits(
    state: &AppState,
    endpoint: &str,
    identifier_hash: &str,
) -> Result<(), AppError> {
    state.auth_endpoint_rate_limiter.check(endpoint)?;
    state
        .auth_rate_limiter
        .check(&format!("{endpoint}:{identifier_hash}"))
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

async fn audit_auth_failure(
    state: &AppState,
    action: &str,
    identifier_hash: &str,
    outcome: &str,
) -> Result<(), AppError> {
    let mut transaction = state.db.begin().await.map_err(database_error)?;
    insert_auth_audit(&mut transaction, None, action, identifier_hash, outcome).await?;
    transaction.commit().await.map_err(database_error)?;
    Ok(())
}

async fn insert_auth_audit(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    actor_user_id: Option<&str>,
    action: &str,
    identifier_hash: &str,
    outcome: &str,
) -> Result<(), AppError> {
    let metadata = serde_json::json!({
        "identifierHash": identifier_hash,
        "outcome": outcome,
    })
    .to_string();
    sqlx::query("INSERT INTO audit_events (id, actor_user_id, action, target_type, target_id, metadata_json, created_at) VALUES (?, ?, ?, 'authentication', NULL, ?, ?)")
        .bind(Uuid::now_v7().to_string())
        .bind(actor_user_id)
        .bind(action)
        .bind(metadata)
        .bind(OffsetDateTime::now_utc().unix_timestamp())
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
        fixture_with_public_url("https://school.example").await
    }

    async fn fixture_with_public_url(public_url: &str) -> (Router, String, sqlx::SqlitePool) {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let bootstrap = "route-bootstrap-token".to_string();
        let mut config = Config::from_env();
        config.token_hash = Some(hash_token(&bootstrap));
        config.public_url = public_url.to_string();
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
        assert_eq!(bootstrapped["user"]["isRoot"], true);
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
        let login_url = initialized["loginUrl"].as_str().unwrap();
        assert!(login_url.starts_with("https://school.example/login?request="));
        let request_id = login_url.split("request=").nth(1).unwrap();

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

    #[tokio::test]
    async fn bootstrap_failure_rolls_back_account_and_remains_retryable() {
        let (app, bootstrap_token, pool) = fixture().await;
        sqlx::query(
            "CREATE TRIGGER fail_bootstrap_session_audit BEFORE INSERT ON audit_events WHEN NEW.action = 'identity.session_issued' BEGIN SELECT RAISE(ABORT, 'injected session failure'); END",
        )
        .execute(&pool)
        .await
        .unwrap();

        let (failed_status, _) = json_request(
            &app,
            "POST",
            "/api/auth/bootstrap",
            json!({
                "email": "admin@school.test",
                "password": "Correct Horse Battery Staple"
            }),
            Some(&bootstrap_token),
        )
        .await;
        assert_eq!(failed_status, StatusCode::INTERNAL_SERVER_ERROR);
        let users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(users, 0);

        sqlx::query("DROP TRIGGER fail_bootstrap_session_audit")
            .execute(&pool)
            .await
            .unwrap();
        let retried = bootstrap(&app, &bootstrap_token).await;
        assert!(retried["session"]["accessToken"].is_string());
    }

    #[tokio::test]
    async fn recovery_credential_resets_the_existing_root_password_and_revokes_sessions() {
        let (app, bootstrap_token, _) = fixture().await;
        let bootstrapped = bootstrap(&app, &bootstrap_token).await;
        let old_access_token = bootstrapped["session"]["accessToken"].as_str().unwrap();

        let (reset_status, reset_body) = json_request(
            &app,
            "POST",
            "/api/auth/recover-root",
            json!({ "email": "admin@school.test", "password": "A New Correct Horse Battery Staple" }),
            Some(&bootstrap_token),
        )
        .await;
        assert_eq!(reset_status, StatusCode::NO_CONTENT, "{reset_body}");

        let (old_login_status, _) = json_request(
            &app,
            "POST",
            "/api/auth/login",
            json!({ "email": "admin@school.test", "password": "Correct Horse Battery Staple" }),
            None,
        )
        .await;
        assert_eq!(old_login_status, StatusCode::UNAUTHORIZED);
        let (new_login_status, _) = json_request(
            &app,
            "POST",
            "/api/auth/login",
            json!({ "email": "admin@school.test", "password": "A New Correct Horse Battery Staple" }),
            None,
        )
        .await;
        assert_eq!(new_login_status, StatusCode::OK);
        let (old_session_status, _) = json_request(&app, "GET", "/api/auth/me", Value::Null, Some(old_access_token)).await;
        assert_eq!(old_session_status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn desktop_exchange_failure_leaves_code_unconsumed_and_retryable() {
        let (app, bootstrap_token, pool) = fixture().await;
        let bootstrapped = bootstrap(&app, &bootstrap_token).await;
        let access_token = bootstrapped["session"]["accessToken"].as_str().unwrap();
        let verifier = "transaction-pkce-verifier";
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let (_, initialized) = json_request(
            &app,
            "POST",
            "/api/auth/desktop/init",
            json!({
                "state": "transaction-state",
                "codeChallenge": challenge,
                "codeChallengeMethod": "S256"
            }),
            None,
        )
        .await;
        let request_id = initialized["loginUrl"]
            .as_str()
            .unwrap()
            .split("request=")
            .nth(1)
            .unwrap();
        let (_, approved) = json_request(
            &app,
            "POST",
            "/api/auth/desktop/approve",
            json!({ "requestId": request_id }),
            Some(access_token),
        )
        .await;

        sqlx::query(
            "CREATE TRIGGER fail_exchange_session_audit BEFORE INSERT ON audit_events WHEN NEW.action = 'identity.session_issued' BEGIN SELECT RAISE(ABORT, 'injected session failure'); END",
        )
        .execute(&pool)
        .await
        .unwrap();
        let (failed_status, _) = json_request(
            &app,
            "POST",
            "/api/auth/desktop/exchange",
            json!({ "code": approved["code"], "codeVerifier": verifier }),
            None,
        )
        .await;
        assert_eq!(failed_status, StatusCode::INTERNAL_SERVER_ERROR);
        let request_status: String =
            sqlx::query_scalar("SELECT status FROM desktop_login_requests WHERE id = ?")
                .bind(request_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(request_status, "approved");

        sqlx::query("DROP TRIGGER fail_exchange_session_audit")
            .execute(&pool)
            .await
            .unwrap();
        let (retry_status, retried) = json_request(
            &app,
            "POST",
            "/api/auth/desktop/exchange",
            json!({ "code": approved["code"], "codeVerifier": verifier }),
            None,
        )
        .await;
        assert_eq!(retry_status, StatusCode::OK, "{retried}");
    }

    #[tokio::test]
    async fn login_rate_limit_audits_sanitized_failures_and_success() {
        let (app, bootstrap_token, pool) = fixture().await;
        bootstrap(&app, &bootstrap_token).await;
        let unknown_email = "missing-person@school.test";
        let rejected_password = "Never Persist This Password";

        for attempt in 0..6 {
            let (status, _) = json_request(
                &app,
                "POST",
                "/api/auth/login",
                json!({ "email": unknown_email, "password": rejected_password }),
                None,
            )
            .await;
            assert_eq!(
                status,
                if attempt < 5 {
                    StatusCode::UNAUTHORIZED
                } else {
                    StatusCode::TOO_MANY_REQUESTS
                }
            );
        }

        let (bad_password_status, _) = json_request(
            &app,
            "POST",
            "/api/auth/login",
            json!({ "email": "admin@school.test", "password": rejected_password }),
            None,
        )
        .await;
        assert_eq!(bad_password_status, StatusCode::UNAUTHORIZED);

        let (success_status, _) = json_request(
            &app,
            "POST",
            "/api/auth/login",
            json!({
                "email": "admin@school.test",
                "password": "Correct Horse Battery Staple"
            }),
            None,
        )
        .await;
        assert_eq!(success_status, StatusCode::OK);
        let failure_metadata: Vec<String> = sqlx::query_scalar(
            "SELECT metadata_json FROM audit_events WHERE action = 'identity.login_failure'",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(failure_metadata.len(), 7);
        assert!(failure_metadata.iter().all(|metadata| {
            !metadata.contains(unknown_email) && !metadata.contains(rejected_password)
        }));
        let successes: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_events WHERE action = 'identity.login_success'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(successes, 1);
    }

    #[tokio::test]
    async fn refresh_rate_limit_audits_sanitized_failures_and_preserves_success_rotation() {
        let (app, bootstrap_token, pool) = fixture().await;
        let bootstrapped = bootstrap(&app, &bootstrap_token).await;
        let refresh_token = bootstrapped["session"]["refreshToken"].as_str().unwrap();
        let rejected_token = "invalid-refresh-secret.device-id";

        for attempt in 0..6 {
            let (status, _) = json_request(
                &app,
                "POST",
                "/api/auth/refresh",
                json!({ "refreshToken": rejected_token }),
                None,
            )
            .await;
            assert_eq!(
                status,
                if attempt < 5 {
                    StatusCode::UNAUTHORIZED
                } else {
                    StatusCode::TOO_MANY_REQUESTS
                }
            );
        }

        let (success_status, _) = json_request(
            &app,
            "POST",
            "/api/auth/refresh",
            json!({ "refreshToken": refresh_token }),
            None,
        )
        .await;
        assert_eq!(success_status, StatusCode::OK);
        let failure_metadata: Vec<String> = sqlx::query_scalar(
            "SELECT metadata_json FROM audit_events WHERE action = 'identity.refresh_failure'",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(failure_metadata.len(), 6);
        assert!(failure_metadata
            .iter()
            .all(|metadata| !metadata.contains(rejected_token)));
        let rotations: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_events WHERE action = 'identity.refresh_rotated'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(rotations, 1);
        let successes: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_events WHERE action = 'identity.refresh_success'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(successes, 1);
    }

    #[tokio::test]
    async fn distinct_invalid_refresh_tokens_hit_stable_endpoint_limit() {
        let (app, _bootstrap_token, _pool) = fixture().await;

        for attempt in 0..101 {
            let (status, _) = json_request(
                &app,
                "POST",
                "/api/auth/refresh",
                json!({ "refreshToken": format!("invalid-refresh-{attempt}.device") }),
                None,
            )
            .await;
            assert_eq!(
                status,
                if attempt < 100 {
                    StatusCode::UNAUTHORIZED
                } else {
                    StatusCode::TOO_MANY_REQUESTS
                },
                "attempt {attempt}"
            );
        }
    }

    #[tokio::test]
    async fn desktop_init_uses_navigable_loopback_url_for_wildcard_bind_default() {
        let (app, _bootstrap_token, _pool) = fixture_with_public_url("http://127.0.0.1:3000").await;
        let verifier = "wildcard-bind-verifier";
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));

        let (status, initialized) = json_request(
            &app,
            "POST",
            "/api/auth/desktop/init",
            json!({
                "state": "wildcard-bind-state",
                "codeChallenge": challenge,
                "codeChallengeMethod": "S256"
            }),
            None,
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        let login_url = initialized["loginUrl"].as_str().unwrap();
        assert!(login_url.starts_with("http://127.0.0.1:3000/login?request="));
        assert!(!login_url.contains("0.0.0.0"));
        assert!(!login_url.contains("[::]"));
    }
}
