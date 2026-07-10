use std::sync::Arc;
use std::time::Duration;

use bollard::Docker;
use secrecy::ExposeSecret;
use sqlx::SqlitePool;

use crate::{
    auth::{generate_random_token, hash_token, AuthRateLimiter},
    config::Config,
    crypto::SecretCipher,
    error::AppError,
    identity::IdentityService,
    policy::signing::PolicySigner,
};

#[derive(Clone)]
pub struct AppState {
    pub docker: Arc<Docker>,
    pub db: SqlitePool,
    pub config: Arc<Config>,
    pub identity: IdentityService,
    pub policy_signer: Arc<PolicySigner>,
    pub secret_cipher: Arc<SecretCipher>,
    pub auth_rate_limiter: AuthRateLimiter,
    pub auth_endpoint_rate_limiter: AuthRateLimiter,
    pub llm_endpoint_rate_limiter: AuthRateLimiter,
}

impl AppState {
    pub fn new(docker: Docker, config: Config, db: SqlitePool) -> Self {
        Self::try_new(docker, config, db).expect("policy signer initialization must succeed")
    }

    pub fn try_new(docker: Docker, config: Config, db: SqlitePool) -> Result<Self, AppError> {
        let jwt_secret = config
            .token_hash
            .unwrap_or_else(|| hash_token(&generate_random_token()))
            .to_vec();
        let identity = IdentityService::new(db.clone(), config.token_hash, jwt_secret);
        let auth_rate_limiter = AuthRateLimiter::new(5, Duration::from_secs(60), 1_024);
        let auth_endpoint_rate_limiter = AuthRateLimiter::new(100, Duration::from_secs(60), 2);
        let llm_endpoint_rate_limiter = AuthRateLimiter::new(120, Duration::from_secs(60), 10_000);
        let policy_signer = PolicySigner::load_or_generate(&config.policy_signing_key_path)?;
        let secret_cipher = match config.encryption_key.as_ref() {
            Some(encoded) => SecretCipher::from_encoded_key(encoded.expose_secret())?,
            None => SecretCipher::load_or_generate(&config.encryption_key_path)?,
        };
        Ok(Self {
            docker: Arc::new(docker),
            db,
            config: Arc::new(config),
            identity,
            policy_signer: Arc::new(policy_signer),
            secret_cipher: Arc::new(secret_cipher),
            auth_rate_limiter,
            auth_endpoint_rate_limiter,
            llm_endpoint_rate_limiter,
        })
    }
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;

    use crate::config::Config;

    use super::AppState;

    #[tokio::test]
    async fn malformed_policy_key_prevents_state_startup_without_rotation() {
        let path = std::env::temp_dir().join(format!(
            "mlearn-malformed-policy-key-{}",
            uuid::Uuid::now_v7()
        ));
        std::fs::write(&path, b"malformed").unwrap();
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let mut config = Config::from_env();
        config.policy_signing_key_path = path.to_string_lossy().into_owned();
        let docker = bollard::Docker::connect_with_http_defaults().unwrap();

        assert!(AppState::try_new(docker, config, pool).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"malformed");
        std::fs::remove_file(path).unwrap();
    }

    #[tokio::test]
    async fn malformed_encryption_key_prevents_state_startup_without_rotation() {
        let encryption_path = std::env::temp_dir().join(format!(
            "mlearn-malformed-encryption-key-{}",
            uuid::Uuid::now_v7()
        ));
        let signing_path = std::env::temp_dir().join(format!(
            "mlearn-policy-key-for-encryption-test-{}",
            uuid::Uuid::now_v7()
        ));
        std::fs::write(&encryption_path, b"malformed").unwrap();
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let mut config = Config::from_env();
        config.policy_signing_key_path = signing_path.to_string_lossy().into_owned();
        config.encryption_key_path = encryption_path.to_string_lossy().into_owned();
        config.encryption_key = None;
        let docker = bollard::Docker::connect_with_http_defaults().unwrap();

        assert!(AppState::try_new(docker, config, pool).is_err());
        assert_eq!(std::fs::read(&encryption_path).unwrap(), b"malformed");
        std::fs::remove_file(encryption_path).unwrap();
        std::fs::remove_file(signing_path).unwrap();
    }
}
