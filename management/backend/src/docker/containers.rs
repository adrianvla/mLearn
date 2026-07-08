use std::collections::HashMap;

use bollard::Docker;
use bollard::errors::Error as DockerError;
use bollard::models::ContainerInspectResponse;
use bollard::models::ContainerSummary;
use bollard::query_parameters::ListContainersOptionsBuilder;
use bollard::query_parameters::StopContainerOptionsBuilder;

use crate::docker::COMPOSE_PROJECT_LABEL;
use crate::error::AppError;

const STOP_TIMEOUT_SECONDS: i32 = 10;

pub async fn list_mlearn_containers(
    docker: &Docker,
    project: &str,
) -> Result<Vec<ContainerSummary>, AppError> {
    let mut filters: HashMap<String, Vec<String>> = HashMap::new();
    filters.insert(
        "label".to_string(),
        vec![format!("{}={}", COMPOSE_PROJECT_LABEL, project)],
    );

    let options = ListContainersOptionsBuilder::default()
        .all(true)
        .filters(&filters)
        .build();

    docker.list_containers(Some(options)).await.map_err(AppError::from)
}

pub async fn inspect_container(
    docker: &Docker,
    id: &str,
) -> Result<ContainerInspectResponse, AppError> {
    docker.inspect_container(id, None).await.map_err(AppError::from)
}

pub async fn start_container(docker: &Docker, id: &str) -> Result<(), AppError> {
    docker
        .start_container(id, None)
        .await
        .map_err(AppError::from)
}

pub async fn stop_container(docker: &Docker, id: &str) -> Result<(), AppError> {
    let options = StopContainerOptionsBuilder::default()
        .t(STOP_TIMEOUT_SECONDS)
        .build();

    docker
        .stop_container(id, Some(options))
        .await
        .map_err(AppError::from)
}

pub async fn restart_container(docker: &Docker, id: &str) -> Result<(), AppError> {
    docker
        .restart_container(id, None)
        .await
        .map_err(AppError::from)
}

pub async fn container_belongs_to_project(
    docker: &Docker,
    id: &str,
    project: &str,
) -> Result<bool, AppError> {
    match docker.inspect_container(id, None).await {
        Ok(inspect) => {
            let labels = inspect
                .config
                .as_ref()
                .and_then(|config| config.labels.clone());
            Ok(labels_match_project(&labels, project))
        }
        Err(DockerError::DockerResponseServerError { status_code: 404, .. }) => Ok(false),
        Err(err) => Err(AppError::from(err)),
    }
}

pub fn labels_match_project(labels: &Option<HashMap<String, String>>, project: &str) -> bool {
    match labels {
        Some(map) => map.get(COMPOSE_PROJECT_LABEL).map(|value| value == project).unwrap_or(false),
        None => false,
    }
}

pub fn extract_label(labels: &HashMap<String, String>, key: &str) -> Option<String> {
    labels.get(key).cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_labels(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect()
    }

    #[test]
    fn labels_match_project_returns_true_when_project_matches() {
        let labels = make_labels(&[
            (COMPOSE_PROJECT_LABEL, "mlearn"),
            ("com.docker.compose.service", "backend"),
        ]);

        assert!(labels_match_project(&Some(labels), "mlearn"));
    }

    #[test]
    fn labels_match_project_returns_false_when_project_differs() {
        let labels = make_labels(&[(COMPOSE_PROJECT_LABEL, "other-project")]);

        assert!(!labels_match_project(&Some(labels), "mlearn"));
    }

    #[test]
    fn labels_match_project_returns_false_when_none() {
        assert!(!labels_match_project(&None, "mlearn"));
    }

    #[test]
    fn labels_match_project_returns_false_when_label_missing() {
        let labels = make_labels(&[("com.docker.compose.service", "backend")]);

        assert!(!labels_match_project(&Some(labels), "mlearn"));
    }

    #[test]
    fn extract_label_returns_value_when_present() {
        let labels = make_labels(&[
            (COMPOSE_PROJECT_LABEL, "mlearn"),
            ("com.docker.compose.service", "backend"),
        ]);

        assert_eq!(
            extract_label(&labels, "com.docker.compose.service"),
            Some("backend".to_string())
        );
    }

    #[test]
    fn extract_label_returns_none_when_absent() {
        let labels = make_labels(&[(COMPOSE_PROJECT_LABEL, "mlearn")]);

        assert_eq!(extract_label(&labels, "missing.key"), None);
    }

    #[test]
    fn extract_label_returns_none_for_empty_map() {
        let labels = HashMap::new();

        assert_eq!(extract_label(&labels, COMPOSE_PROJECT_LABEL), None);
    }
}
