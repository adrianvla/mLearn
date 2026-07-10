use std::{collections::BTreeMap, convert::Infallible};

use axum::{
    body::{to_bytes, Body, Bytes},
    extract::{Request, State},
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
        quota::{
            GatewayReservationRequirements, QuotaService, ReconcileQuotaRequest,
            ReserveQuotaRequest,
        },
    },
    state::AppState,
};

const MAX_REQUEST_BODY_BYTES: usize = 1024 * 1024;
const RESERVED_OUTPUT_TOKENS: i64 = 4096;
const MICROS_PER_TOKEN_PRICE_UNIT: i64 = 1_000_000;
const GATEWAY_LEASE_SECONDS: i64 = 240;

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/api/llm/stream", post(stream_llm))
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
    request: Request,
) -> Response {
    if state
        .llm_endpoint_rate_limiter
        .check(&principal.user_id)
        .is_err()
    {
        return json_failure(StatusCode::TOO_MANY_REQUESTS, "rate_limited");
    }
    let body = match to_bytes(request.into_body(), MAX_REQUEST_BODY_BYTES).await {
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
    let quota = QuotaService::new(state.db.clone());
    let reservation = quota
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
            GatewayReservationRequirements {
                expected_prompt_profile_id: route_config.prompt_profile_id.as_deref(),
                config_fingerprint: route_config.config_fingerprint,
                conservative_actual: &amounts,
                requests_per_minute: route_config.requests_per_minute,
                max_concurrent_streams: route_config.max_concurrent_streams,
                lease_seconds: GATEWAY_LEASE_SECONDS,
            },
        )
        .await
        .map_err(map_preflight_error)?;

    // Pin DNS only after quota succeeds; PinnedEndpoint disables proxies and redirects.
    let reservation_id = reservation.id;
    let route = match configuration.pin_route(route_config).await {
        Ok(route) => route,
        Err(_) => {
            quota
                .cancel_gateway(&reservation_id)
                .await
                .map_err(map_preflight_error)?;
            return Err(GatewayFailure::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "provider_unavailable",
            ));
        }
    };
    quota
        .mark_gateway_contacting(&reservation_id)
        .await
        .map_err(map_preflight_error)?;
    let opened = match adapter_for(route.provider_kind)
        .stream(&route, normalized)
        .await
    {
        Ok(opened) => opened,
        Err(error) => {
            quota
                .cancel_gateway(&reservation_id)
                .await
                .map_err(map_preflight_error)?;
            return Err(map_provider_error(error));
        }
    };
    quota
        .mark_gateway_pending(&reservation_id)
        .await
        .map_err(map_preflight_error)?;

    let mut upstream = opened.stream;
    let completion = ReconcileQuotaRequest {
        reservation_id,
        provider_id: route.provider_id.clone(),
        model_id: route.model_id.clone(),
        price_version_id: route.price_version.id.clone(),
        actual: amounts.clone(),
    };
    let mut accounting = StreamAccounting::new(
        &amounts,
        route.price_version.input_cost_micros,
        route.price_version.output_cost_micros,
    );
    let downstream = async_stream::stream! {
        while let Some(item) = upstream.next().await {
            match item {
                Ok(frame) => match accounting.observe(&frame) {
                    Ok(FrameKind::Data) => yield Ok::<Bytes, Infallible>(frame),
                    Ok(FrameKind::Done) => {
                        let mut measured = completion.clone();
                        measured.actual = accounting.measured_amounts();
                        if quota.complete_gateway(measured).await.is_ok() {
                            yield Ok::<Bytes, Infallible>(frame);
                        } else {
                            yield Ok::<Bytes, Infallible>(terminal_error_frame(ProviderError::Unavailable));
                        }
                        break;
                    }
                    Err(error) => {
                        yield Ok::<Bytes, Infallible>(terminal_error_frame(error));
                        break;
                    }
                },
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

enum FrameKind {
    Data,
    Done,
}

struct StreamAccounting {
    reserved_input: i64,
    reserved_output: i64,
    reserved_total: i64,
    reserved_cost: i64,
    input: i64,
    output: i64,
    input_price: i64,
    output_price: i64,
}

impl StreamAccounting {
    fn new(amounts: &BTreeMap<String, i64>, input_price: i64, output_price: i64) -> Self {
        Self {
            reserved_input: amounts["inputTokens"],
            reserved_output: amounts["outputTokens"],
            reserved_total: amounts["totalTokens"],
            reserved_cost: amounts["costMicros"],
            input: amounts["inputTokens"],
            output: 0,
            input_price,
            output_price,
        }
    }

    fn observe(&mut self, frame: &Bytes) -> Result<FrameKind, ProviderError> {
        let text = std::str::from_utf8(frame).map_err(|_| ProviderError::InvalidResponse)?;
        let mut done = false;
        for line in text.lines() {
            let Some(data) = line.strip_prefix("data: ") else {
                continue;
            };
            if data == "[DONE]" {
                done = true;
                continue;
            }
            let value: serde_json::Value =
                serde_json::from_str(data).map_err(|_| ProviderError::InvalidResponse)?;
            let delta_bytes = value
                .get("choices")
                .and_then(serde_json::Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|choice| choice.get("delta"))
                .try_fold(0_i64, |total, delta| {
                    let content = delta
                        .get("content")
                        .and_then(serde_json::Value::as_str)
                        .map_or(0_usize, str::len);
                    let arguments = delta
                        .get("tool_calls")
                        .and_then(serde_json::Value::as_array)
                        .into_iter()
                        .flatten()
                        .filter_map(|call| call.pointer("/function/arguments"))
                        .filter_map(serde_json::Value::as_str)
                        .map(str::len)
                        .sum::<usize>();
                    total.checked_add(i64::try_from(content.checked_add(arguments)?).ok()?)
                })
                .ok_or(ProviderError::ResponseTooLarge)?;
            self.output = self
                .output
                .checked_add(delta_bytes)
                .ok_or(ProviderError::ResponseTooLarge)?;
            if let Some(usage) = value.get("usage") {
                if let Some(prompt) = usage
                    .get("prompt_tokens")
                    .and_then(serde_json::Value::as_i64)
                {
                    self.input = prompt;
                }
                if let Some(output) = usage
                    .get("completion_tokens")
                    .and_then(serde_json::Value::as_i64)
                {
                    self.output = self.output.max(output);
                }
            }
            if let Some(output) = value.get("eval_count").and_then(serde_json::Value::as_i64) {
                self.output = self.output.max(output);
            }
            self.ensure_within_reservation()?;
        }
        Ok(if done {
            FrameKind::Done
        } else {
            FrameKind::Data
        })
    }

    fn ensure_within_reservation(&self) -> Result<(), ProviderError> {
        let total = self
            .input
            .checked_add(self.output)
            .ok_or(ProviderError::ResponseTooLarge)?;
        let cost = stream_price(self.input, self.input_price)?
            .checked_add(stream_price(self.output, self.output_price)?)
            .ok_or(ProviderError::ResponseTooLarge)?;
        if self.input < 0
            || self.output < 0
            || self.input > self.reserved_input
            || self.output > self.reserved_output
            || total > self.reserved_total
            || cost > self.reserved_cost
        {
            Err(ProviderError::ResponseTooLarge)
        } else {
            Ok(())
        }
    }

    fn measured_amounts(&self) -> BTreeMap<String, i64> {
        let total = self.input + self.output;
        let cost = stream_price(self.input, self.input_price)
            .and_then(|input| {
                stream_price(self.output, self.output_price).and_then(|output| {
                    input
                        .checked_add(output)
                        .ok_or(ProviderError::ResponseTooLarge)
                })
            })
            .unwrap_or(self.reserved_cost);
        BTreeMap::from([
            ("requests".into(), 1),
            ("inputTokens".into(), self.input),
            ("outputTokens".into(), self.output),
            ("totalTokens".into(), total),
            ("costMicros".into(), cost),
        ])
    }
}

fn stream_price(tokens: i64, price: i64) -> Result<i64, ProviderError> {
    tokens
        .checked_mul(price)
        .and_then(|value| value.checked_add(MICROS_PER_TOKEN_PRICE_UNIT - 1))
        .map(|value| value / MICROS_PER_TOKEN_PRICE_UNIT)
        .ok_or(ProviderError::ResponseTooLarge)
}

fn map_provider_error(error: ProviderError) -> GatewayFailure {
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
            max_output_tokens: 4096,
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

    #[test]
    fn streamed_output_and_provider_usage_cannot_exceed_reserved_ceiling() {
        let amounts = BTreeMap::from([
            ("requests".into(), 1),
            ("inputTokens".into(), 10),
            ("outputTokens".into(), 4),
            ("totalTokens".into(), 14),
            ("costMicros".into(), 14),
        ]);
        let mut accounting = StreamAccounting::new(&amounts, 1_000_000, 1_000_000);
        assert!(accounting
            .observe(&Bytes::from_static(
                b"data: {\"choices\":[{\"delta\":{\"content\":\"1234\"}}]}\n\n"
            ))
            .is_ok());
        assert!(accounting
            .observe(&Bytes::from_static(
                b"data: {\"choices\":[{\"delta\":{\"content\":\"5\"}}]}\n\n"
            ))
            .is_err());

        let mut accounting = StreamAccounting::new(&amounts, 1_000_000, 1_000_000);
        assert!(accounting
            .observe(&Bytes::from_static(
                b"data: {\"choices\":[{\"delta\":{}}],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":5}}\n\n"
            ))
            .is_err());
    }
}
