pub mod containers;
pub mod logs;
pub mod volumes;

use bollard::{Docker, API_DEFAULT_VERSION};

const DOCKER_SOCKET: &str = "/var/run/docker.sock";

pub fn connect_docker() -> Result<Docker, bollard::errors::Error> {
    let socket = std::env::var("DOCKER_HOST").ok()
        .and_then(|host| host.strip_prefix("unix://").map(str::to_owned))
        .unwrap_or_else(|| DOCKER_SOCKET.to_string());
    // Keep school administration available without a Docker daemon. Operations
    // on this unavailable transport still return an explicit Docker error.
    Docker::connect_with_unix(&socket, 120, API_DEFAULT_VERSION)
        .or_else(|_| Docker::connect_with_unix("/dev/null", 120, API_DEFAULT_VERSION))
}

pub const COMPOSE_PROJECT_LABEL: &str = "com.docker.compose.project";
pub const COMPOSE_SERVICE_LABEL: &str = "com.docker.compose.service";
pub const COMPOSE_CONFIG_FILES_LABEL: &str = "com.docker.compose.config-files";
pub const COMPOSE_CONTAINER_NUMBER_LABEL: &str = "com.docker.compose.container-number";
