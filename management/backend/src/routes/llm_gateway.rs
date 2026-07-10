use std::{collections::BTreeMap, convert::Infallible};

use axum::{
    body::{Body, Bytes},
    extract::rejection::BytesRejection,
    extract::{DefaultBodyLimit, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use futures_util::StreamExt;
use serde_json::json;
use uuid::Uuid;

use crate::{
    dto::LlmGatewayDto,
    error::AppError,
    identity::{IdentityType, Principal},
    llm::{
        configuration::LlmConfigurationService,
        provider::{adapter_for, terminal_error_frame, GatewayRequest, ProviderError},
        quota::{QuotaService, ReconcileQuotaRequest, ReserveQuotaRequest},
    },
    state::AppState,
};

const MAX_REQUEST_BODY_BYTES: usize = 1024 * 1024;
const RESERVED_OUTPUT_TOKENS: i64 = 4096;
const MICROS_PER_TOKEN_PRICE_UNIT: i64 = 1_000_000;

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/api/llm/stream", post(stream_llm))
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BODY_BYTES))
        .with_state(state)
}

pub async fn get_llm_gateway(
    State(_state): State<AppState>,
) -> Result<Json<LlmGatewayDto>, AppError> {
    Err(AppError::NotImplemented(
        "LLM gateway status is not connected to real routing, model, or budget state yet."
            .to_string(),
    ))
}

async fn stream_llm(
    State(state): State<AppState>,
    principal: Principal,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    let body = match body {
        Ok(body) => body,
        Err(_) => return json_failure(StatusCode::PAYLOAD_TOO_LARGE, "invalid_request"),
    };
    let request = match serde_json::from_slice::<GatewayRequest>(&body) {
        Ok(request) => request,
        Err(_) => return json_failure(StatusCode::BAD_REQUEST, "invalid_request"),
    };
    match prepare_stream(state, principal, request).await {
        Ok(response) => response,
        Err(failure) => json_failure(failure.status, failure.code),
    }
}

async fn prepare_stream(
    state: AppState,
    principal: Principal,
    request: GatewayRequest,
) -> Result<Response, GatewayFailure> {
    if principal.service_key_id.is_some() || principal.identity_type != IdentityType::Learner {
        return Err(GatewayFailure::new(StatusCode::FORBIDDEN, "policy_denied"));
    }
    let active_group_id = principal
        .active_group_id
        .clone()
        .ok_or_else(|| GatewayFailure::new(StatusCode::CONFLICT, "invalid_active_group"))?;

    let configuration =
        LlmConfigurationService::new(state.db.clone(), state.secret_cipher.as_ref().clone());
    // This performs policy/database resolution only. DNS and provider connection happen after
    // the quota transaction has accepted this exact stable provider/model/price tuple.
    let route_config = configuration
        .resolve_route_metadata(&active_group_id, None)
        .await
        .map_err(map_preflight_error)?;
    let normalized = request
        .validate(route_config.system_prompt.as_deref())
        .map_err(map_preflight_error)?;
    let amounts = conservative_amounts(
        &normalized,
        route_config.price_version.input_cost_micros,
        route_config.price_version.output_cost_micros,
    )?;
    let reservation = QuotaService::new(state.db.clone())
        .reserve_gateway(
            &principal,
            ReserveQuotaRequest {
                request_id: Uuid::now_v7().to_string(),
                active_group_id,
                provider_id: route_config.provider_id.clone(),
                model_id: route_config.model_id.clone(),
                price_version_id: route_config.price_version.id.clone(),
                amounts: amounts.clone(),
                expires_at: None,
            },
            route_config.prompt_profile_id.as_deref(),
        )
        .await
        .map_err(map_preflight_error)?;

    // Pin DNS only after quota succeeds; PinnedEndpoint disables proxies and redirects.
    let route = configuration.pin_route(route_config).await.map_err(|_| {
        GatewayFailure::new(StatusCode::SERVICE_UNAVAILABLE, "provider_unavailable")
    })?;

    let reconciliation = ReservationReconciliation::new(
        QuotaService::new(state.db.clone()),
        ReconcileQuotaRequest {
            reservation_id: reservation.id,
            provider_id: route.provider_id.clone(),
            model_id: route.model_id.clone(),
            price_version_id: route.price_version.id.clone(),
            actual: amounts,
        },
    );
    let opened = match adapter_for(route.provider_kind)
        .stream(&route, normalized)
        .await
    {
        Ok(opened) => opened,
        Err(error) => return Err(map_provider_error(error, reconciliation)),
    };

    let mut upstream = opened.stream;
    let downstream = async_stream::stream! {
        // Holding this guard inside the response body makes client disconnect/drop reconcile the
        // conservative reservation. Task 4 will replace the conservative values with measured
        // conversation usage as part of its recorder/reconciliation handoff.
        let _reconciliation = reconciliation;
        while let Some(item) = upstream.next().await {
            match item {
                Ok(frame) => yield Ok::<Bytes, Infallible>(frame),
                Err(error) => {
                    yield Ok::<Bytes, Infallible>(terminal_error_frame(error));
                    break;
                }
            }
        }
    };
    let mut response = Response::new(Body::from_stream(downstream));
    *response.status_mut() = StatusCode::OK;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/event-stream; charset=utf-8"),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-cache, no-store"),
    );
    response
        .headers_mut()
        .insert("x-accel-buffering", HeaderValue::from_static("no"));
    Ok(response)
}

fn conservative_amounts(
    request: &crate::llm::provider::NormalizedProviderRequest,
    input_price: i64,
    output_price: i64,
) -> Result<BTreeMap<String, i64>, GatewayFailure> {
    // UTF-8 bytes are a deliberately conservative tokenizer-independent upper bound.
    let input = i64::try_from(
        serde_json::to_vec(request)
            .map_err(|_| GatewayFailure::new(StatusCode::BAD_REQUEST, "invalid_request"))?
            .len(),
    )
    .map_err(|_| GatewayFailure::new(StatusCode::BAD_REQUEST, "invalid_request"))?;
    let total = input
        .checked_add(RESERVED_OUTPUT_TOKENS)
        .ok_or_else(|| GatewayFailure::new(StatusCode::BAD_REQUEST, "invalid_request"))?;
    let input_cost = checked_ceil_price(input, input_price)?;
    let output_cost = checked_ceil_price(RESERVED_OUTPUT_TOKENS, output_price)?;
    let cost = input_cost
        .checked_add(output_cost)
        .ok_or_else(|| GatewayFailure::new(StatusCode::BAD_REQUEST, "invalid_request"))?;
    Ok(BTreeMap::from([
        ("requests".into(), 1),
        ("inputTokens".into(), input),
        ("outputTokens".into(), RESERVED_OUTPUT_TOKENS),
        ("totalTokens".into(), total),
        ("costMicros".into(), cost),
    ]))
}

fn checked_ceil_price(tokens: i64, price: i64) -> Result<i64, GatewayFailure> {
    tokens
        .checked_mul(price)
        .and_then(|value| value.checked_add(MICROS_PER_TOKEN_PRICE_UNIT - 1))
        .map(|value| value / MICROS_PER_TOKEN_PRICE_UNIT)
        .ok_or_else(|| GatewayFailure::new(StatusCode::BAD_REQUEST, "invalid_request"))
}

struct ReservationReconciliation {
    service: Option<QuotaService>,
    request: Option<ReconcileQuotaRequest>,
}

impl ReservationReconciliation {
    fn new(service: QuotaService, request: ReconcileQuotaRequest) -> Self {
        Self {
            service: Some(service),
            request: Some(request),
        }
    }
}

impl Drop for ReservationReconciliation {
    fn drop(&mut self) {
        let (Some(service), Some(request)) = (self.service.take(), self.request.take()) else {
            return;
        };
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                if let Err(error) = service.reconcile(request).await {
                    tracing::error!(error = %error, "quota reservation reconciliation failed");
                }
            });
        }
    }
}

fn map_provider_error(
    error: ProviderError,
    reconciliation: ReservationReconciliation,
) -> GatewayFailure {
    drop(reconciliation);
    match error {
        ProviderError::RateLimited => {
            GatewayFailure::new(StatusCode::TOO_MANY_REQUESTS, "rate_limited")
        }
        _ => GatewayFailure::new(StatusCode::SERVICE_UNAVAILABLE, "provider_unavailable"),
    }
}

fn map_preflight_error(error: AppError) -> GatewayFailure {
    match error {
        AppError::Unauthorized => GatewayFailure::new(StatusCode::UNAUTHORIZED, "unauthorized"),
        AppError::TooManyRequests => {
            GatewayFailure::new(StatusCode::TOO_MANY_REQUESTS, "rate_limited")
        }
        AppError::Conflict(message) if message.contains("quota exceeded") => {
            GatewayFailure::new(StatusCode::TOO_MANY_REQUESTS, "quota_exceeded")
        }
        AppError::Forbidden(message)
            if message.contains("active group") || message.contains("membership") =>
        {
            GatewayFailure::new(StatusCode::CONFLICT, "invalid_active_group")
        }
        AppError::Forbidden(_) => GatewayFailure::new(StatusCode::FORBIDDEN, "policy_denied"),
        AppError::BadRequest(_) => GatewayFailure::new(StatusCode::BAD_REQUEST, "invalid_request"),
        AppError::Conflict(_) => GatewayFailure::new(StatusCode::CONFLICT, "policy_denied"),
        _ => GatewayFailure::new(StatusCode::SERVICE_UNAVAILABLE, "provider_unavailable"),
    }
}

#[derive(Debug)]
struct GatewayFailure {
    status: StatusCode,
    code: &'static str,
}

impl GatewayFailure {
    const fn new(status: StatusCode, code: &'static str) -> Self {
        Self { status, code }
    }
}

fn json_failure(status: StatusCode, code: &'static str) -> Response {
    (status, Json(json!({"error": code}))).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::provider::{GatewayMessage, NormalizedProviderRequest};

    #[test]
    fn conservative_quota_estimate_includes_managed_prompt_and_all_metrics() {
        let request = NormalizedProviderRequest {
            messages: vec![
                GatewayMessage {
                    role: "system".into(),
                    content: "managed".into(),
                    tool_calls: None,
                    tool_call_id: None,
                },
                GatewayMessage {
                    role: "user".into(),
                    content: "hello".into(),
                    tool_calls: None,
                    tool_call_id: None,
                },
            ],
            tools: Vec::new(),
            think: false,
        };
        let values = conservative_amounts(&request, 1_000_000, 2_000_000).unwrap();
        assert!(values["inputTokens"] > 12);
        assert_eq!(values["outputTokens"], 4096);
        assert_eq!(
            values["totalTokens"],
            values["inputTokens"] + values["outputTokens"]
        );
        assert_eq!(
            values["costMicros"],
            values["inputTokens"] + values["outputTokens"] * 2
        );
        assert_eq!(values["requests"], 1);
    }

    #[test]
    fn stable_preheader_and_postheader_errors_never_include_provider_details() {
        let response = json_failure(StatusCode::SERVICE_UNAVAILABLE, "provider_unavailable");
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            terminal_error_frame(ProviderError::Unavailable),
            Bytes::from_static(b"data: {\"error\":\"provider_unavailable\",\"done\":true}\n\n")
        );
    }
}
