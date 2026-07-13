use axum::{extract::State, Json};

use crate::{
    dto::{StorageDto, VolumeInfo},
    error::AppError,
    state::AppState,
};

pub async fn get_storage(State(state): State<AppState>) -> Result<Json<StorageDto>, AppError> {
    let volumes = match crate::docker::volumes::list_mlearn_volumes(
        &state.docker,
        &state.config.compose_project,
    )
    .await
    {
        Ok(volumes) => volumes,
        Err(err) => {
            tracing::warn!(error = %err, "failed to list mlearn volumes");
            Vec::new()
        }
    };

    let volume_dtos: Vec<VolumeInfo> = volumes
        .iter()
        .map(|vol| crate::sanitize::volume_to_dto(vol, &[]))
        .collect();

    let bind_mounts = match crate::docker::volumes::get_bind_mounts_for_project(
        &state.docker,
        &state.config.compose_project,
    )
    .await
    {
        Ok(mounts) => mounts,
        Err(err) => {
            tracing::warn!(error = %err, "failed to list bind mounts");
            Vec::new()
        }
    };

    Ok(Json(StorageDto {
        volumes: volume_dtos,
        bind_mounts,
    }))
}
