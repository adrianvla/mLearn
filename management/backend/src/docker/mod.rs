pub mod containers;
pub mod logs;
pub mod volumes;

use bollard::{Docker, API_DEFAULT_VERSION};

const DOCKER_SOCKET: &str = "/var/run/docker.sock";

pub fn connect_docker() -> Result<Docker, bollard::errors::Error> {
    if let Ok(docker) = Docker::connect_with_unix(DOCKER_SOCKET, 120, API_DEFAULT_VERSION) {
        return Ok(docker);
    }
    if let Ok(host) = std::env::var("DOCKER_HOST") {
        if let Some(path) = host.strip_prefix("unix://") {
            if let Ok(docker) = Docker::connect_with_unix(path, 120, API_DEFAULT_VERSION) {
                return Ok(docker);
            }
        }
    }
    Docker::connect_with_unix("/dev/null", 120, API_DEFAULT_VERSION)
}

pub const COMPOSE_PROJECT_LABEL: &str = "com.docker.compose.project";
pub const COMPOSE_SERVICE_LABEL: &str = "com.docker.compose.service";
pub const COMPOSE_CONFIG_FILES_LABEL: &str = "com.docker.compose.config-files";
pub const COMPOSE_CONTAINER_NUMBER_LABEL: &str = "com.docker.compose.container-number";
