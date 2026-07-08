use axum::{extract::State, Json};

use crate::{
    config::DeploymentMode,
    dto::{AiStatusDto, CloudAiStatus, LocalAiStatus},
    error::AppError,
    state::AppState,
};

pub async fn get_ai_status(
    State(state): State<AppState>,
) -> Result<Json<AiStatusDto>, AppError> {
    let cloud_enabled = state.config.cloud_ai_enabled;
    let not_cloud_connected = state.config.deployment_mode != DeploymentMode::CloudConnected;

    let school_mode_warning = if cloud_enabled && not_cloud_connected {
        Some("Cloud LLM access is enabled in a school/self-hosted deployment. Review data protection policies.".to_string())
    } else {
        None
    };

    let local_ai = LocalAiStatus {
        enabled: state.config.local_ai_enabled,
        provider_name: state.config.local_ai_provider.clone(),
        service_status: None,
    };

    let cloud_ai = CloudAiStatus {
        enabled: cloud_enabled,
        provider_names: state.config.cloud_ai_providers.clone(),
        school_mode_warning,
    };

    let mut warnings = Vec::new();

    if cloud_enabled && not_cloud_connected {
        warnings.push(
            "Cloud LLM access is enabled. Ensure age-gating and consent requirements are met."
                .to_string(),
        );
    }

    if !state.config.local_ai_enabled {
        warnings.push(
            "No local AI configured. Some features will be unavailable offline.".to_string(),
        );
    }

    Ok(Json(AiStatusDto {
        local_ai,
        cloud_ai,
        warnings,
    }))
}
