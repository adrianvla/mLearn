use axum::{extract::State, Json};

use crate::{dto::LlmGatewayDto, error::AppError, state::AppState};

pub async fn get_llm_gateway(
    State(_state): State<AppState>,
) -> Result<Json<LlmGatewayDto>, AppError> {
    Err(AppError::NotImplemented(
        "LLM gateway status is not connected to real routing, model, or budget state yet."
            .to_string(),
    ))
}
