use argon2::{
    password_hash::{
        rand_core::OsRng as PasswordOsRng, PasswordHash, PasswordHasher, PasswordVerifier,
        SaltString,
    },
    Argon2,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::{
    auth::{hash_token_hex, verify_token},
    error::AppError,
};

const ACCESS_TOKEN_LIFETIME: Duration = Duration::minutes(15);
const REFRESH_TOKEN_LIFETIME: Duration = Duration::days(30);

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IdentityType {
    Admin,
    Teacher,
    Learner,
}

impl IdentityType {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Admin => "admin",
            Self::Teacher => "teacher",
            Self::Learner => "learner",
        }
    }

    fn parse(value: &str) -> Result<Self, AppError> {
        match value {
            "admin" => Ok(Self::Admin),
            "teacher" => Ok(Self::Teacher),
            "learner" => Ok(Self::Learner),
            _ => Err(AppError::Internal(format!(
                "invalid persisted identity type: {value}"
            ))),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Principal {
    pub user_id: String,
    pub session_id: String,
    pub device_id: String,
    pub active_group_id: Option<String>,
    pub identity_type: IdentityType,
    pub is_root: bool,
}

#[derive(Clone, Debug)]
pub struct IssuedSession {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthenticatedUser {
    pub id: String,
    pub email: String,
    pub identity_type: IdentityType,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct AccessClaims {
    jti: String,
    sub: String,
    sid: String,
    did: String,
    active_group_id: Option<String>,
    identity_type: IdentityType,
    iat: i64,
    exp: i64,
}

#[derive(Clone)]
pub struct IdentityService {
    pool: SqlitePool,
    bootstrap_hash: Option<[u8; 32]>,
    jwt_secret: Vec<u8>,
}

impl IdentityService {
    pub fn new(pool: SqlitePool, bootstrap_hash: Option<[u8; 32]>, jwt_secret: Vec<u8>) -> Self {
        Self {
            pool,
            bootstrap_hash,
            jwt_secret,
        }
    }

    pub async fn bootstrap_root(
        &self,
        bootstrap_token: &str,
        email: &str,
        password: &str,
    ) -> Result<AuthenticatedUser, AppError> {
        let mut transaction = self.pool.begin().await.map_err(database_error)?;
        let user = self
            .bootstrap_root_in_transaction(&mut transaction, bootstrap_token, email, password)
            .await?;
        transaction.commit().await.map_err(database_error)?;
        Ok(user)
    }

    pub async fn bootstrap_root_with_session(
        &self,
        bootstrap_token: &str,
        email: &str,
        password: &str,
    ) -> Result<(AuthenticatedUser, IssuedSession), AppError> {
        let mut transaction = self.pool.begin().await.map_err(database_error)?;
        let user = self
            .bootstrap_root_in_transaction(&mut transaction, bootstrap_token, email, password)
            .await?;
        let session = self
            .issue_session_in_transaction(&mut transaction, &user.id, None, None)
            .await?;
        transaction.commit().await.map_err(database_error)?;
        Ok((user, session))
    }

    async fn bootstrap_root_in_transaction(
        &self,
        transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        bootstrap_token: &str,
        email: &str,
        password: &str,
    ) -> Result<AuthenticatedUser, AppError> {
        let expected_hash = self.bootstrap_hash.ok_or(AppError::Unauthorized)?;
        if !verify_token(bootstrap_token, &expected_hash) {
            return Err(AppError::Unauthorized);
        }
        validate_email_and_password(email, password)?;

        let normalized_email = normalize_email(email);
        let display_name = email
            .split('@')
            .next()
            .filter(|value| !value.is_empty())
            .unwrap_or("Administrator");
        let password_hash = hash_password(password)?;
        let user_id = Uuid::now_v7().to_string();
        let credential_id = Uuid::now_v7().to_string();
        let audit_id = Uuid::now_v7().to_string();
        let now = now_timestamp();
        let admin_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE is_root = 1")
            .fetch_one(&mut **transaction)
            .await
            .map_err(database_error)?;
        if admin_count != 0 {
            return Err(AppError::Conflict(
                "root administrator already exists".into(),
            ));
        }

        sqlx::query("INSERT INTO users (id, email, normalized_email, display_name, status, identity_type, is_root, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 'admin', 1, ?, ?)")
            .bind(&user_id)
            .bind(email.trim())
            .bind(&normalized_email)
            .bind(display_name)
            .bind(now)
            .bind(now)
            .execute(&mut **transaction)
            .await
            .map_err(database_error)?;
        sqlx::query("INSERT INTO password_credentials (id, user_id, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
            .bind(credential_id)
            .bind(&user_id)
            .bind(password_hash)
            .bind(now)
            .bind(now)
            .execute(&mut **transaction)
            .await
            .map_err(database_error)?;
        sqlx::query("INSERT INTO audit_events (id, actor_user_id, action, target_type, target_id, metadata_json, created_at) VALUES (?, ?, 'identity.bootstrap_root', 'user', ?, ?, ?)")
            .bind(audit_id)
            .bind(&user_id)
            .bind(&user_id)
            .bind(serde_json::json!({ "recoveryCredentialUsed": true }).to_string())
            .bind(now)
            .execute(&mut **transaction)
            .await
            .map_err(database_error)?;
        Ok(AuthenticatedUser {
            id: user_id,
            email: email.trim().to_string(),
            identity_type: IdentityType::Admin,
        })
    }

    pub async fn issue_session(
        &self,
        user_id: &str,
        device_id: Option<&str>,
        active_group_id: Option<&str>,
    ) -> Result<IssuedSession, AppError> {
        let mut transaction = self.pool.begin().await.map_err(database_error)?;
        let session = self
            .issue_session_in_transaction(&mut transaction, user_id, device_id, active_group_id)
            .await?;
        transaction.commit().await.map_err(database_error)?;
        Ok(session)
    }

    pub(crate) async fn issue_session_in_transaction(
        &self,
        transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        user_id: &str,
        device_id: Option<&str>,
        active_group_id: Option<&str>,
    ) -> Result<IssuedSession, AppError> {
        let row = sqlx::query("SELECT identity_type FROM users WHERE id = ? AND status = 'active'")
            .bind(user_id)
            .fetch_optional(&mut **transaction)
            .await
            .map_err(database_error)?
            .ok_or(AppError::Unauthorized)?;
        let identity_type = IdentityType::parse(row.get("identity_type"))?;
        let device_id = device_id
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| Uuid::now_v7().to_string());
        let session_id = Uuid::now_v7().to_string();
        let now = now_timestamp();
        let refresh_expires_at =
            (OffsetDateTime::now_utc() + REFRESH_TOKEN_LIFETIME).unix_timestamp();
        let (refresh_token, refresh_hash) = generate_refresh_token(&device_id);
        let access = self.encode_access_token(
            user_id,
            &session_id,
            &device_id,
            active_group_id,
            identity_type,
        )?;
        sqlx::query("INSERT OR IGNORE INTO devices (id, user_id, name, platform, created_at, last_seen_at) VALUES (?, ?, 'Unknown device', 'unknown', ?, ?)")
            .bind(&device_id)
            .bind(user_id)
            .bind(now)
            .bind(now)
            .execute(&mut **transaction)
            .await
            .map_err(database_error)?;
        sqlx::query("INSERT INTO sessions (id, user_id, expires_at, revoked_at, created_at, last_seen_at) VALUES (?, ?, ?, NULL, ?, ?)")
            .bind(&session_id)
            .bind(user_id)
            .bind(refresh_expires_at)
            .bind(now)
            .bind(now)
            .execute(&mut **transaction)
            .await
            .map_err(database_error)?;
        sqlx::query("INSERT INTO refresh_tokens (id, session_id, token_hash, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)")
            .bind(Uuid::now_v7().to_string())
            .bind(&session_id)
            .bind(refresh_hash)
            .bind(refresh_expires_at)
            .bind(now)
            .execute(&mut **transaction)
            .await
            .map_err(database_error)?;
        insert_audit(
            transaction,
            Some(user_id),
            "identity.session_issued",
            "session",
            &session_id,
            now,
        )
        .await?;
        Ok(IssuedSession {
            access_token: access.0,
            refresh_token,
            expires_at: access.1,
        })
    }

    pub async fn authenticate_password(
        &self,
        email: &str,
        password: &str,
    ) -> Result<AuthenticatedUser, AppError> {
        let row = sqlx::query(
            "SELECT users.id, users.email, users.identity_type, password_credentials.password_hash FROM users JOIN password_credentials ON password_credentials.user_id = users.id WHERE users.normalized_email = ? AND users.status = 'active'",
        )
        .bind(normalize_email(email))
        .fetch_optional(&self.pool)
        .await
        .map_err(database_error)?
        .ok_or(AppError::Unauthorized)?;
        let password_hash: String = row.get("password_hash");
        verify_password(password, &password_hash)?;

        Ok(AuthenticatedUser {
            id: row.get("id"),
            email: row.get("email"),
            identity_type: IdentityType::parse(row.get("identity_type"))?,
        })
    }

    pub async fn rotate_refresh_token(
        &self,
        refresh_token: &str,
    ) -> Result<IssuedSession, AppError> {
        let device_id = refresh_token
            .rsplit_once('.')
            .map(|(_, device_id)| device_id)
            .filter(|device_id| !device_id.is_empty())
            .ok_or(AppError::Unauthorized)?;
        let token_hash = hash_token_hex(refresh_token);
        let now = now_timestamp();
        let mut transaction = self.pool.begin().await.map_err(database_error)?;
        let row = sqlx::query(
            "SELECT refresh_tokens.id AS refresh_id, sessions.id AS session_id, sessions.user_id, users.identity_type FROM refresh_tokens JOIN sessions ON sessions.id = refresh_tokens.session_id JOIN users ON users.id = sessions.user_id WHERE refresh_tokens.token_hash = ? AND refresh_tokens.revoked_at IS NULL AND refresh_tokens.expires_at > ? AND sessions.revoked_at IS NULL AND sessions.expires_at > ? AND users.status = 'active'",
        )
        .bind(&token_hash)
        .bind(now)
        .bind(now)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(database_error)?
        .ok_or(AppError::Unauthorized)?;
        let refresh_id: String = row.get("refresh_id");
        let session_id: String = row.get("session_id");
        let user_id: String = row.get("user_id");
        let identity_type = IdentityType::parse(row.get("identity_type"))?;
        let (new_refresh_token, new_refresh_hash) = generate_refresh_token(device_id);
        let refresh_expires_at =
            (OffsetDateTime::now_utc() + REFRESH_TOKEN_LIFETIME).unix_timestamp();
        let access =
            self.encode_access_token(&user_id, &session_id, device_id, None, identity_type)?;

        let updated = sqlx::query(
            "UPDATE refresh_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
        )
        .bind(now)
        .bind(&refresh_id)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
        if updated.rows_affected() != 1 {
            return Err(AppError::Unauthorized);
        }
        sqlx::query("INSERT INTO refresh_tokens (id, session_id, token_hash, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)")
            .bind(Uuid::now_v7().to_string())
            .bind(&session_id)
            .bind(new_refresh_hash)
            .bind(refresh_expires_at)
            .bind(now)
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
        sqlx::query("UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE id = ?")
            .bind(refresh_expires_at)
            .bind(now)
            .bind(&session_id)
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
        insert_audit(
            &mut transaction,
            Some(&user_id),
            "identity.refresh_rotated",
            "session",
            &session_id,
            now,
        )
        .await?;
        insert_audit(
            &mut transaction,
            Some(&user_id),
            "identity.refresh_success",
            "session",
            &session_id,
            now,
        )
        .await?;
        transaction.commit().await.map_err(database_error)?;

        Ok(IssuedSession {
            access_token: access.0,
            refresh_token: new_refresh_token,
            expires_at: access.1,
        })
    }

    pub async fn revoke_session(&self, session_id: &str) -> Result<(), AppError> {
        let now = now_timestamp();
        let mut transaction = self.pool.begin().await.map_err(database_error)?;
        let user_id: Option<String> =
            sqlx::query_scalar("SELECT user_id FROM sessions WHERE id = ?")
                .bind(session_id)
                .fetch_optional(&mut *transaction)
                .await
                .map_err(database_error)?;
        let user_id = user_id.ok_or(AppError::Unauthorized)?;
        sqlx::query("UPDATE sessions SET revoked_at = ? WHERE id = ?")
            .bind(now)
            .bind(session_id)
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
        sqlx::query(
            "UPDATE refresh_tokens SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL",
        )
        .bind(now)
        .bind(session_id)
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
        insert_audit(
            &mut transaction,
            Some(&user_id),
            "identity.session_revoked",
            "session",
            session_id,
            now,
        )
        .await?;
        transaction.commit().await.map_err(database_error)?;
        Ok(())
    }

    pub async fn principal_from_access_token(
        &self,
        access_token: &str,
    ) -> Result<Principal, AppError> {
        let claims = decode::<AccessClaims>(
            access_token,
            &DecodingKey::from_secret(&self.jwt_secret),
            &Validation::default(),
        )
        .map_err(|_| AppError::Unauthorized)?
        .claims;
        let now = now_timestamp();
        let is_root: Option<i64> = sqlx::query_scalar(
            "SELECT users.is_root FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.id = ? AND sessions.user_id = ? AND sessions.revoked_at IS NULL AND sessions.expires_at > ? AND users.status = 'active' AND users.identity_type = ?",
        )
        .bind(&claims.sid)
        .bind(&claims.sub)
        .bind(now)
        .bind(claims.identity_type.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(database_error)?;
        let is_root = is_root.ok_or(AppError::Unauthorized)? != 0;

        Ok(Principal {
            user_id: claims.sub,
            session_id: claims.sid,
            device_id: claims.did,
            active_group_id: claims.active_group_id,
            identity_type: claims.identity_type,
            is_root,
        })
    }

    pub async fn user(&self, user_id: &str) -> Result<AuthenticatedUser, AppError> {
        let row = sqlx::query(
            "SELECT id, email, identity_type FROM users WHERE id = ? AND status = 'active'",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(database_error)?
        .ok_or(AppError::Unauthorized)?;
        Ok(AuthenticatedUser {
            id: row.get("id"),
            email: row.get("email"),
            identity_type: IdentityType::parse(row.get("identity_type"))?,
        })
    }

    fn encode_access_token(
        &self,
        user_id: &str,
        session_id: &str,
        device_id: &str,
        active_group_id: Option<&str>,
        identity_type: IdentityType,
    ) -> Result<(String, i64), AppError> {
        let issued_at = OffsetDateTime::now_utc();
        let expires_at = (issued_at + ACCESS_TOKEN_LIFETIME).unix_timestamp();
        let claims = AccessClaims {
            jti: Uuid::now_v7().to_string(),
            sub: user_id.to_string(),
            sid: session_id.to_string(),
            did: device_id.to_string(),
            active_group_id: active_group_id.map(ToOwned::to_owned),
            identity_type,
            iat: issued_at.unix_timestamp(),
            exp: expires_at,
        };
        let token = encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(&self.jwt_secret),
        )
        .map_err(|error| AppError::Internal(format!("access token encoding failed: {error}")))?;
        Ok((token, expires_at))
    }
}

fn validate_email_and_password(email: &str, password: &str) -> Result<(), AppError> {
    let email = email.trim();
    if email.is_empty() || !email.contains('@') {
        return Err(AppError::BadRequest("valid email is required".into()));
    }
    if password.len() < 12 {
        return Err(AppError::BadRequest(
            "password must contain at least 12 characters".into(),
        ));
    }
    Ok(())
}

fn normalize_email(email: &str) -> String {
    email.trim().to_ascii_lowercase()
}

fn hash_password(password: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut PasswordOsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| AppError::Internal(format!("password hashing failed: {error}")))
}

fn verify_password(password: &str, encoded_hash: &str) -> Result<(), AppError> {
    let parsed_hash = PasswordHash::new(encoded_hash).map_err(|_| AppError::Unauthorized)?;
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .map_err(|_| AppError::Unauthorized)
}

fn generate_refresh_token(device_id: &str) -> (String, String) {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    let token = format!("{}.{}", URL_SAFE_NO_PAD.encode(bytes), device_id);
    let hash = hash_token_hex(&token);
    (token, hash)
}

async fn insert_audit(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    actor_user_id: Option<&str>,
    action: &str,
    target_type: &str,
    target_id: &str,
    now: i64,
) -> Result<(), AppError> {
    sqlx::query("INSERT INTO audit_events (id, actor_user_id, action, target_type, target_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)")
        .bind(Uuid::now_v7().to_string())
        .bind(actor_user_id)
        .bind(action)
        .bind(target_type)
        .bind(target_id)
        .bind(now)
        .execute(&mut **transaction)
        .await
        .map_err(database_error)?;
    Ok(())
}

fn now_timestamp() -> i64 {
    OffsetDateTime::now_utc().unix_timestamp()
}

fn database_error(error: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(database_error) = &error {
        if database_error.is_unique_violation() {
            return AppError::Conflict("identity already exists".into());
        }
    }
    AppError::Internal(format!("database error: {error}"))
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;

    use crate::auth::hash_token;

    use super::{IdentityService, IdentityType, IssuedSession};

    struct IdentityFixture {
        service: IdentityService,
        bootstrap: String,
        learner_id: String,
    }

    impl IdentityFixture {
        async fn new() -> Self {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            sqlx::migrate!("./migrations").run(&pool).await.unwrap();

            let bootstrap = "bootstrap-recovery-token".to_string();
            let service = IdentityService::new(
                pool.clone(),
                Some(hash_token(&bootstrap)),
                b"test-jwt-secret-with-at-least-32-bytes".to_vec(),
            );
            let learner_id = uuid::Uuid::now_v7().to_string();
            let now = time::OffsetDateTime::now_utc().unix_timestamp();
            sqlx::query(
                "INSERT INTO users (id, email, normalized_email, display_name, status, identity_type, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 'learner', ?, ?)",
            )
            .bind(&learner_id)
            .bind("learner@school.test")
            .bind("learner@school.test")
            .bind("Learner")
            .bind(now)
            .bind(now)
            .execute(&pool)
            .await
            .unwrap();

            Self {
                service,
                bootstrap,
                learner_id,
            }
        }

        async fn issue_learner_session(&self) -> IssuedSession {
            self.service
                .issue_session(&self.learner_id, None, None)
                .await
                .unwrap()
        }
    }

    #[tokio::test]
    async fn refresh_tokens_are_single_use_and_rotate() {
        let fixture = IdentityFixture::new().await;
        let issued = fixture.issue_learner_session().await;
        let rotated = fixture
            .service
            .rotate_refresh_token(&issued.refresh_token)
            .await
            .unwrap();
        assert_ne!(rotated.refresh_token, issued.refresh_token);
        assert!(fixture
            .service
            .rotate_refresh_token(&issued.refresh_token)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn bootstrap_token_creates_exactly_one_root_admin() {
        let fixture = IdentityFixture::new().await;
        fixture
            .service
            .bootstrap_root(
                &fixture.bootstrap,
                "admin@school.test",
                "Correct Horse Battery Staple",
            )
            .await
            .unwrap();
        assert!(fixture
            .service
            .bootstrap_root(
                &fixture.bootstrap,
                "second@school.test",
                "Another Strong Password",
            )
            .await
            .is_err());
    }

    #[tokio::test]
    async fn password_authentication_normalizes_email_and_rejects_wrong_password() {
        let fixture = IdentityFixture::new().await;
        fixture
            .service
            .bootstrap_root(
                &fixture.bootstrap,
                "Admin@School.Test",
                "Correct Horse Battery Staple",
            )
            .await
            .unwrap();

        let user = fixture
            .service
            .authenticate_password("  admin@school.test  ", "Correct Horse Battery Staple")
            .await
            .unwrap();
        assert_eq!(user.email, "Admin@School.Test");
        assert!(fixture
            .service
            .authenticate_password("admin@school.test", "Definitely The Wrong Password")
            .await
            .is_err());
    }

    #[tokio::test]
    async fn suspension_preserves_identity_and_blocks_login_refresh_and_access() {
        let fixture = IdentityFixture::new().await;
        let user = fixture
            .service
            .bootstrap_root(
                &fixture.bootstrap,
                "admin@school.test",
                "Correct Horse Battery Staple",
            )
            .await
            .unwrap();
        let issued = fixture
            .service
            .issue_session(&user.id, None, None)
            .await
            .unwrap();

        sqlx::query("UPDATE users SET status = 'suspended' WHERE id = ?")
            .bind(&user.id)
            .execute(&fixture.service.pool)
            .await
            .unwrap();

        let identity_type: String =
            sqlx::query_scalar("SELECT identity_type FROM users WHERE id = ?")
                .bind(&user.id)
                .fetch_one(&fixture.service.pool)
                .await
                .unwrap();
        assert_eq!(identity_type, "admin");
        assert_eq!(user.identity_type, IdentityType::Admin);
        assert!(fixture
            .service
            .authenticate_password("admin@school.test", "Correct Horse Battery Staple",)
            .await
            .is_err());
        assert!(fixture
            .service
            .rotate_refresh_token(&issued.refresh_token)
            .await
            .is_err());
        assert!(fixture
            .service
            .principal_from_access_token(&issued.access_token)
            .await
            .is_err());
    }
}
