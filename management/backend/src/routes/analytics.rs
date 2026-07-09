use axum::Json;

use crate::{dto::AnalyticsDto, error::AppError};

pub async fn get_analytics() -> Result<Json<AnalyticsDto>, AppError> {
    Err(AppError::NotImplemented(
        "Analytics are not connected to a real metrics or audit-log source yet.".to_string(),
    ))
}
