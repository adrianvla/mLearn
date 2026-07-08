use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;

use crate::{
    dto::LogsDto, error::AppError, state::AppState,
};

#[derive(Deserialize)]
pub struct LogsQuery {
    pub tail: Option<u64>,
}

pub async fn get_service_logs(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<LogsQuery>,
) -> Result<Json<LogsDto>, AppError> {
    crate::validation::validate_container_id(&id)?;

    let tail = crate::validation::validate_tail(query.tail.unwrap_or(300));

    let belongs = crate::docker::containers::container_belongs_to_project(
        &state.docker,
        &id,
        &state.config.compose_project,
    )
    .await?;

    if !belongs {
        return Err(AppError::ActionNotAllowed);
    }

    let mut lines = crate::docker::logs::get_container_logs(&state.docker, &id, tail).await?;

    for line in lines.iter_mut() {
        line.message = crate::redaction::redact_line(&line.message);
    }

    let truncated = lines.len() as u64 >= tail;

    Ok(Json(LogsDto {
        service_id: id.clone(),
        lines,
        truncated,
    }))
}
