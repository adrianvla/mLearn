use axum::{extract::State, Json};

use crate::{dto::ConfigDto, error::AppError, state::AppState};

pub async fn get_config(
    State(state): State<AppState>,
) -> Result<Json<ConfigDto>, AppError> {
    let config_dto = crate::sanitize::build_config_dto(&state.config);
    Ok(Json(config_dto))
}
