use std::sync::Arc;
use std::time::Duration;

use bollard::Docker;
use sqlx::SqlitePool;

use crate::{
    auth::{generate_random_token, hash_token, AuthRateLimiter},
    config::Config,
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
    pub auth_rate_limiter: AuthRateLimiter,
    pub auth_endpoint_rate_limiter: AuthRateLimiter,
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
        let policy_signer = PolicySigner::load_or_generate(&config.policy_signing_key_path)?;
        Ok(Self {
            docker: Arc::new(docker),
            db,
            config: Arc::new(config),
            identity,
            policy_signer: Arc::new(policy_signer),
            auth_rate_limiter,
            auth_endpoint_rate_limiter,
        })
    }
}
