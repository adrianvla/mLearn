use axum::{extract::State, Json};

use crate::{
    dto::{BudgetControl, LlmGatewayDto, LlmLanguageProfile, LlmProvider, LlmRouteRule},
    error::AppError,
    state::AppState,
};

pub async fn get_llm_gateway(
    State(state): State<AppState>,
) -> Result<Json<LlmGatewayDto>, AppError> {
    let local_provider = state
        .config
        .local_ai_provider
        .clone()
        .unwrap_or_else(|| "local-runtime".to_string());

    let mut providers = vec![LlmProvider {
        id: "local".to_string(),
        name: local_provider.clone(),
        kind: "local".to_string(),
        status: if state.config.local_ai_enabled {
            "ready"
        } else {
            "offline"
        }
        .to_string(),
        models: vec![
            "local tutoring model".to_string(),
            "embedding model".to_string(),
        ],
    }];

    for provider in &state.config.cloud_ai_providers {
        providers.push(LlmProvider {
            id: provider.to_ascii_lowercase().replace(' ', "-"),
            name: provider.clone(),
            kind: "cloud".to_string(),
            status: if state.config.cloud_ai_enabled {
                "limited"
            } else {
                "offline"
            }
            .to_string(),
            models: vec!["policy routed".to_string()],
        });
    }

    Ok(Json(LlmGatewayDto {
        gateway_enabled: true,
        server_side_logging: true,
        providers,
        routing_rules: vec![
            LlmRouteRule {
                id: "conversation-tutor".to_string(),
                label: "Tutor chat and answer explanations".to_string(),
                r#match: "AI chat, card explanations, sentence breakdowns, study questions".to_string(),
                provider: local_provider,
                fallback: state.config.cloud_ai_providers.first().cloned(),
            },
            LlmRouteRule {
                id: "mistake-checker".to_string(),
                label: "Mistake checker agent".to_string(),
                r#match: "learner messages reviewed for grammar, word choice, register, and safety flags".to_string(),
                provider: "local-runtime".to_string(),
                fallback: state.config.cloud_ai_providers.first().cloned(),
            },
            LlmRouteRule {
                id: "ocr-image-context".to_string(),
                label: "OCR and image context".to_string(),
                r#match: "screen OCR, manga panels, subtitle captures, and image-grounded lookup requests".to_string(),
                provider: "installed language OCR adapter".to_string(),
                fallback: None,
            },
            LlmRouteRule {
                id: "dictionary-language-pack".to_string(),
                label: "Dictionary and language package metadata".to_string(),
                r#match: "dictionary definitions, frequency levels, tokenizer output, script direction, register hints".to_string(),
                provider: "local language-data package".to_string(),
                fallback: None,
            },
        ],
        language_profiles: vec![
            LlmLanguageProfile {
                id: "ja".to_string(),
                language: "Japanese".to_string(),
                locale: "ja-JP".to_string(),
                route: "Local tokenizer, OCR, dictionary, pitch/prosody metadata, then LLM explanation.".to_string(),
                notes: vec![
                    "Uses installed language package metadata instead of hardcoded language rules.".to_string(),
                    "Cloud fallback is only for explanation quality, not OCR/tokenization.".to_string(),
                ],
            },
            LlmLanguageProfile {
                id: "zh".to_string(),
                language: "Chinese".to_string(),
                locale: "zh-CN".to_string(),
                route: "Local script-aware tokenizer and dictionary lookup before tutoring response.".to_string(),
                notes: vec![
                    "Keeps segmentless text handling language-package driven.".to_string(),
                    "Routes screenshots through OCR capability checks first.".to_string(),
                ],
            },
            LlmLanguageProfile {
                id: "ko".to_string(),
                language: "Korean".to_string(),
                locale: "ko-KR".to_string(),
                route: "Local dictionary and morphology support first, with tutor fallback when enabled.".to_string(),
                notes: vec![
                    "Preserves local lookup for subtitle and card workflows.".to_string(),
                ],
            },
            LlmLanguageProfile {
                id: "es".to_string(),
                language: "Spanish".to_string(),
                locale: "es-ES".to_string(),
                route: "Dictionary, sentence explanation, and register correction through the gateway.".to_string(),
                notes: vec![
                    "Mistake checking can use language package correction guidelines.".to_string(),
                ],
            },
        ],
        budget_controls: vec![
            BudgetControl {
                id: "cloud-fallback-daily".to_string(),
                label: "Cloud fallback daily limit".to_string(),
                limit: "Only after local route cannot answer or cloud provider is explicitly enabled".to_string(),
                scope: "Tutor chat and explanations".to_string(),
            },
            BudgetControl {
                id: "ocr-local-first".to_string(),
                label: "OCR and dictionary stay local".to_string(),
                limit: "No cloud route for raw OCR frames, installed dictionaries, or token cache payloads".to_string(),
                scope: "Image lookup, subtitle OCR, dictionary cache".to_string(),
            },
        ],
    }))
}
