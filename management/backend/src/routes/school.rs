use axum::{extract::State, Json};

use crate::{
    config::DeploymentMode,
    dto::SchoolDto,
    error::AppError,
    state::AppState,
};

pub async fn get_school_status(
    State(state): State<AppState>,
) -> Result<Json<SchoolDto>, AppError> {
    let mode_str = match state.config.deployment_mode {
        DeploymentMode::LocalOnly => "local-only",
        DeploymentMode::SelfHosted => "self-hosted",
        DeploymentMode::CloudConnected => "cloud-connected",
    };

    let cloud_llm_access = state.config.cloud_ai_enabled;
    let admin_auth_enabled = state.config.auth_enabled();
    let console_bound_locally =
        state.config.bind_address == "127.0.0.1" || state.config.bind_address == "localhost";

    let mut warnings = Vec::new();

    if !admin_auth_enabled {
        warnings.push(
            "Admin authentication is not enabled. Enable MLEARN_MANAGEMENT_TOKEN immediately."
                .to_string(),
        );
    }

    if cloud_llm_access && mode_str != "cloud-connected" {
        warnings.push(
            "Public Cloud LLM access is enabled without cloud-connected deployment mode. Review SCHOOL_DEPLOYMENT.md."
                .to_string(),
        );
    }

    if !console_bound_locally {
        warnings.push(
            "Management console is bound to a non-localhost address. Ensure it is behind a TLS-terminating reverse proxy."
                .to_string(),
        );
    }

    if mode_str == "local-only" && cloud_llm_access {
        warnings.push(
            "Cloud LLM access is enabled in local-only mode. This may conflict with institutional data policies."
                .to_string(),
        );
    }

    let notes = vec![
        "Local/offline AI is the recommended default for school deployments.".to_string(),
        "The institution is the data controller for all student data.".to_string(),
        "Review SCHOOL_DEPLOYMENT.md for compliance responsibilities.".to_string(),
        "Destructive data operations are intentionally disabled in this version.".to_string(),
    ];

    Ok(Json(SchoolDto {
        deployment_mode: mode_str.to_string(),
        public_cloud_llm_access: cloud_llm_access,
        admin_auth_enabled,
        console_bound_locally,
        warnings,
        notes,
    }))
}
