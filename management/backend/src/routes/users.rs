use axum::Json;

use crate::{dto::UsersDto, error::AppError};

pub async fn get_users() -> Result<Json<UsersDto>, AppError> {
    Err(AppError::NotImplemented(
        "User and policy management is not connected to a real identity source yet.".to_string(),
    ))
}
