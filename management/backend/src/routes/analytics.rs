use axum::Json;

use crate::{
    dto::{AnalyticsDto, AnalyticsEvent, AnalyticsOptIn, LlmUsageSummary, LogStream},
    error::AppError,
};

pub async fn get_analytics() -> Result<Json<AnalyticsDto>, AppError> {
    Ok(Json(AnalyticsDto {
        opt_in: AnalyticsOptIn {
            enabled: true,
            retention_days: 14,
            redact_prompts: true,
            collect_client_events: false,
        },
        llm_summary: LlmUsageSummary {
            requests_today: 128,
            estimated_tokens_today: 184_200,
            blocked_by_policy: 9,
            average_latency_ms: 842,
        },
        events: vec![
            AnalyticsEvent {
                id: "policy-block-1".to_string(),
                time: "10:41".to_string(),
                category: "Policy".to_string(),
                summary: "Direct cloud LLM request blocked for learner group.".to_string(),
                severity: "warning".to_string(),
            },
            AnalyticsEvent {
                id: "cache-hit-1".to_string(),
                time: "10:32".to_string(),
                category: "Distribution".to_string(),
                summary: "Language package served from LAN mirror.".to_string(),
                severity: "info".to_string(),
            },
            AnalyticsEvent {
                id: "gateway-route-1".to_string(),
                time: "10:18".to_string(),
                category: "LLM Gateway".to_string(),
                summary: "Tutor prompt routed to local provider with redacted metadata."
                    .to_string(),
                severity: "info".to_string(),
            },
        ],
        log_streams: vec![
            LogStream {
                id: "llm-audit".to_string(),
                label: "LLM audit trail".to_string(),
                enabled: true,
                destination: "/data/logs/llm-audit.jsonl".to_string(),
            },
            LogStream {
                id: "policy".to_string(),
                label: "Policy decisions".to_string(),
                enabled: true,
                destination: "/data/logs/policy.jsonl".to_string(),
            },
            LogStream {
                id: "client-events".to_string(),
                label: "Client analytics".to_string(),
                enabled: false,
                destination: "Disabled until opt-in".to_string(),
            },
        ],
    }))
}
