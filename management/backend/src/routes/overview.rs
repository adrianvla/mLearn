use axum::{extract::State, Json};

use crate::{
    config::DeploymentMode, dto::OverviewDto, error::AppError, state::AppState,
};

pub async fn get_overview(
    State(state): State<AppState>,
) -> Result<Json<OverviewDto>, AppError> {
    let project = state.config.compose_project.clone();

    let (containers, docker_available, docker_error) =
        match crate::docker::containers::list_mlearn_containers(&state.docker, &project).await {
            Ok(containers) => (containers, true, None),
            Err(error) => (Vec::new(), false, Some(error.to_string())),
        };

    let mut inspects = Vec::with_capacity(containers.len());
    for container in &containers {
        if let Some(id) = container.id.as_deref() {
            if let Ok(inspect) =
                crate::docker::containers::inspect_container(&state.docker, id).await
            {
                inspects.push(inspect);
            }
        }
    }

    let overview = OverviewDto {
        version: env!("CARGO_PKG_VERSION").to_string(),
        mlearn_version: state.config.app_version.clone(),
        deployment_mode: deployment_mode_string(&state.config.deployment_mode),
        docker_available,
        docker_error,
        compose_project: project,
        service_count: crate::sanitize::containers_to_counts(&containers),
        exposed_ports: crate::sanitize::extract_exposed_ports(&containers),
        health: crate::sanitize::containers_to_health_summary(&containers, &inspects),
        management_auth_enabled: state.config.auth_enabled(),
        cloud_features_enabled: state.config.cloud_ai_enabled,
    };

    Ok(Json(overview))
}

fn deployment_mode_string(mode: &DeploymentMode) -> String {
    match mode {
        DeploymentMode::LocalOnly => "local-only".to_string(),
        DeploymentMode::SelfHosted => "self-hosted".to_string(),
        DeploymentMode::CloudConnected => "cloud-connected".to_string(),
    }
}
