use std::sync::Arc;

use bollard::Docker;

use crate::config::Config;

#[derive(Clone)]
pub struct AppState {
    pub docker: Arc<Docker>,
    pub config: Arc<Config>,
}

impl AppState {
    pub fn new(docker: Docker, config: Config) -> Self {
        Self {
            docker: Arc::new(docker),
            config: Arc::new(config),
        }
    }
}
