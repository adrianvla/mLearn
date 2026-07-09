use axum::{extract::State, Json};

use crate::{dto::DistributionDto, error::AppError, state::AppState};

pub async fn get_distribution(
    State(_state): State<AppState>,
) -> Result<Json<DistributionDto>, AppError> {
    Err(AppError::NotImplemented(
        "Distribution status is not connected to a real catalog mirror or cache index yet."
            .to_string(),
    ))
}
