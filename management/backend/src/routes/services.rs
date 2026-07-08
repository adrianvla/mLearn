use axum::{
    extract::{Path, State},
    Json,
};

use crate::{
    dto::{ServiceActionResponse, ServiceDto},
    error::AppError,
    state::AppState,
};

pub async fn get_services(
    State(state): State<AppState>,
) -> Result<Json<Vec<ServiceDto>>, AppError> {
    let containers = crate::docker::containers::list_mlearn_containers(
        &state.docker,
        &state.config.compose_project,
    )
    .await?;

    let mut services = Vec::with_capacity(containers.len());
    for summary in &containers {
        let inspect = match summary.id.as_deref() {
            Some(id) => crate::docker::containers::inspect_container(&state.docker, id)
                .await
                .ok(),
            None => None,
        };
        services.push(crate::sanitize::container_to_service_dto(
            summary,
            inspect.as_ref(),
        ));
    }

    Ok(Json(services))
}

pub async fn perform_service_action(
    State(state): State<AppState>,
    Path((id, action)): Path<(String, String)>,
) -> Result<Json<ServiceActionResponse>, AppError> {
    crate::validation::validate_container_id(&id)?;

    let action = crate::validation::validate_action(&action)?;

    let belongs = crate::docker::containers::container_belongs_to_project(
        &state.docker,
        &id,
        &state.config.compose_project,
    )
    .await?;

    if !belongs {
        return Err(AppError::ActionNotAllowed);
    }

    match action {
        "start" => crate::docker::containers::start_container(&state.docker, &id).await?,
        "stop" => crate::docker::containers::stop_container(&state.docker, &id).await?,
        "restart" => {
            crate::docker::containers::restart_container(&state.docker, &id).await?
        }
        _ => return Err(AppError::BadRequest(format!("unsupported action: {action}"))),
    }

    let inspect = crate::docker::containers::inspect_container(&state.docker, &id).await?;
    let status = inspect
        .state
        .as_ref()
        .and_then(|state| state.status)
        .map(|status| status.to_string())
        .filter(|status| !status.is_empty())
        .unwrap_or_else(|| "unknown".to_string());

    Ok(Json(ServiceActionResponse {
        id,
        action: action.to_string(),
        status,
    }))
}
