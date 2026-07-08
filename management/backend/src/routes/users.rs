use axum::Json;

use crate::{
    dto::{BlockedSettingRule, ManagedUser, PolicyPreset, UsersDto},
    error::AppError,
};

pub async fn get_users() -> Result<Json<UsersDto>, AppError> {
    Ok(Json(UsersDto {
        users: vec![
            ManagedUser {
                id: "admin-1".to_string(),
                display_name: "Local Admin".to_string(),
                role: "admin".to_string(),
                status: "active".to_string(),
                policy: "Full control".to_string(),
                devices: 2,
                last_seen: Some("Just now".to_string()),
            },
            ManagedUser {
                id: "teacher-1".to_string(),
                display_name: "Teacher Console".to_string(),
                role: "teacher".to_string(),
                status: "active".to_string(),
                policy: "Classroom managed".to_string(),
                devices: 4,
                last_seen: Some("14 minutes ago".to_string()),
            },
            ManagedUser {
                id: "learner-1".to_string(),
                display_name: "Learner Group A".to_string(),
                role: "learner".to_string(),
                status: "restricted".to_string(),
                policy: "Locked study mode".to_string(),
                devices: 18,
                last_seen: Some("1 hour ago".to_string()),
            },
        ],
        policy_presets: vec![
            PolicyPreset {
                id: "full-control".to_string(),
                name: "Full control".to_string(),
                description: "Admins can change all deployment, catalog, and AI settings."
                    .to_string(),
                user_count: 1,
                locked_settings: Vec::new(),
            },
            PolicyPreset {
                id: "classroom-managed".to_string(),
                name: "Classroom managed".to_string(),
                description: "Teachers can manage learners but cannot expose public cloud AI."
                    .to_string(),
                user_count: 1,
                locked_settings: vec!["cloud_ai_enabled".to_string(), "backend_mode".to_string()],
            },
            PolicyPreset {
                id: "locked-study".to_string(),
                name: "Locked study mode".to_string(),
                description:
                    "Learners keep sync, catalog, and LLM routing controlled by this server."
                        .to_string(),
                user_count: 18,
                locked_settings: vec![
                    "languageCatalogUrl".to_string(),
                    "backendMode".to_string(),
                    "llmProvider".to_string(),
                ],
            },
        ],
        blocked_settings: vec![
            BlockedSettingRule {
                id: "catalog-url-lock".to_string(),
                setting_key: "languageCatalogUrl".to_string(),
                label: "Language Catalog URL".to_string(),
                scope: "Learners".to_string(),
                reason: "Force app installs through the local mirror when available.".to_string(),
                enforced_value: Some("/catalog/language-catalog.json".to_string()),
            },
            BlockedSettingRule {
                id: "llm-gateway-lock".to_string(),
                setting_key: "llmProvider".to_string(),
                label: "LLM Provider".to_string(),
                scope: "Learners and teachers".to_string(),
                reason: "Route requests through policy, budget, and logging controls.".to_string(),
                enforced_value: Some("mlearn-gateway".to_string()),
            },
            BlockedSettingRule {
                id: "cloud-ai-guard".to_string(),
                setting_key: "cloudAiEnabled".to_string(),
                label: "Direct Cloud AI".to_string(),
                scope: "School deployments".to_string(),
                reason: "Prevent clients from bypassing consent and retention settings."
                    .to_string(),
                enforced_value: Some("false".to_string()),
            },
        ],
    }))
}
