use std::sync::Arc;
use std::time::Duration;

use bollard::Docker;
use sqlx::SqlitePool;

use crate::{
    auth::{generate_random_token, hash_token, AuthRateLimiter},
    config::Config,
    identity::IdentityService,
};

#[derive(Clone)]
pub struct AppState {
    pub docker: Arc<Docker>,
    pub db: SqlitePool,
    pub config: Arc<Config>,
    pub identity: IdentityService,
    pub auth_rate_limiter: AuthRateLimiter,
    pub auth_endpoint_rate_limiter: AuthRateLimiter,
}

impl AppState {
    pub fn new(docker: Docker, config: Config, db: SqlitePool) -> Self {
        let jwt_secret = config
            .token_hash
            .unwrap_or_else(|| hash_token(&generate_random_token()))
            .to_vec();
        let identity = IdentityService::new(db.clone(), config.token_hash, jwt_secret);
        let auth_rate_limiter = AuthRateLimiter::new(5, Duration::from_secs(60), 1_024);
        let auth_endpoint_rate_limiter = AuthRateLimiter::new(100, Duration::from_secs(60), 2);
        Self {
            docker: Arc::new(docker),
            db,
            config: Arc::new(config),
            identity,
            auth_rate_limiter,
            auth_endpoint_rate_limiter,
        }
    }
}
