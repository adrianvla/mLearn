use std::sync::Arc;

use bollard::Docker;
use sqlx::SqlitePool;

use crate::{
    auth::{generate_random_token, hash_token},
    config::Config,
    identity::IdentityService,
};

#[derive(Clone)]
pub struct AppState {
    pub docker: Arc<Docker>,
    pub db: SqlitePool,
    pub config: Arc<Config>,
    pub identity: IdentityService,
}

impl AppState {
    pub fn new(docker: Docker, config: Config, db: SqlitePool) -> Self {
        let jwt_secret = config
            .token_hash
            .unwrap_or_else(|| hash_token(&generate_random_token()))
            .to_vec();
        let identity = IdentityService::new(db.clone(), config.token_hash, jwt_secret);
        Self {
            docker: Arc::new(docker),
            db,
            config: Arc::new(config),
            identity,
        }
    }
}
