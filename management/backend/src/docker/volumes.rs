use std::collections::HashMap;

use bollard::models::Volume;
use bollard::query_parameters::{ListContainersOptionsBuilder, ListVolumesOptionsBuilder};
use bollard::Docker;

use crate::docker::{COMPOSE_PROJECT_LABEL, COMPOSE_SERVICE_LABEL};
use crate::dto::BindMountInfo;
use crate::error::AppError;

pub async fn list_mlearn_volumes(
    docker: &Docker,
    project: &str,
) -> Result<Vec<Volume>, AppError> {
    let mut filters: HashMap<&str, Vec<String>> = HashMap::new();
    filters.insert(
        "label",
        vec![format!("{}={}", COMPOSE_PROJECT_LABEL, project)],
    );

    let options = ListVolumesOptionsBuilder::default()
        .filters(&filters)
        .build();

    let response = docker.list_volumes(Some(options)).await?;
    Ok(response.volumes.unwrap_or_default())
}

pub async fn get_bind_mounts_for_project(
    docker: &Docker,
    project: &str,
) -> Result<Vec<BindMountInfo>, AppError> {
    let mut filters: HashMap<&str, Vec<String>> = HashMap::new();
    filters.insert(
        "label",
        vec![format!("{}={}", COMPOSE_PROJECT_LABEL, project)],
    );

    let options = ListContainersOptionsBuilder::default()
        .all(true)
        .filters(&filters)
        .build();

    let containers = docker.list_containers(Some(options)).await?;
    let mut mounts = Vec::new();

    for container in containers {
        let Some(id) = container.id.as_deref() else {
            continue;
        };

        let service = container
            .labels
            .as_ref()
            .and_then(|labels| labels.get(COMPOSE_SERVICE_LABEL))
            .cloned();

        let inspected = docker.inspect_container(id, None).await?;

        if let Some(mount_points) = inspected.mounts {
            for mount in mount_points {
                if mount.typ.as_deref() != Some("bind") {
                    continue;
                }
                let Some(source) = mount.source else {
                    continue;
                };
                let Some(destination) = mount.destination else {
                    continue;
                };
                let mode = if mount.rw.unwrap_or(false) {
                    "rw"
                } else {
                    "ro"
                };

                mounts.push(BindMountInfo {
                    service: service.clone().unwrap_or_default(),
                    source,
                    destination,
                    mode: mode.to_string(),
                });
            }
        }
    }

    Ok(mounts)
}
