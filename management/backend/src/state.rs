use std::sync::Arc;

use bollard::Docker;
use sqlx::SqlitePool;

use crate::config::Config;

#[derive(Clone)]
pub struct AppState {
    pub docker: Arc<Docker>,
    pub db: SqlitePool,
    pub config: Arc<Config>,
}

impl AppState {
    pub fn new(docker: Docker, config: Config, db: SqlitePool) -> Self {
        Self {
            docker: Arc::new(docker),
            db,
            config: Arc::new(config),
        }
    }
}
