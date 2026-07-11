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
        conversations::{BeginConversation, ConversationService},
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
    debug_assert!(state.llm_preflight_deadline.as_secs() < GATEWAY_LEASE_SECONDS as u64);
    if principal.service_key_id.is_some() || principal.identity_type != IdentityType::Learner {
        return Err(map_preflight_error(AppError::InvalidActiveGroup(
            "learner session required for LLM gateway".into(),
        )));
    }
    let active_group_id = principal
        .active_group_id
        .clone()
        .ok_or_else(|| {
            map_preflight_error(AppError::InvalidActiveGroup(
                "authenticated session has no active group".into(),
            ))
        })?;

    let conversation_service = ConversationService::with_retention_days(
        state.db.clone(),
        state.secret_cipher.as_ref().clone(),
        state.config.conversation_retention_days,
    );
    let configuration = LlmConfigurationService::with_resolver(
        state.db.clone(),
        state.secret_cipher.as_ref().clone(),
        state.llm_endpoint_resolver.clone(),
    );
    // This performs policy/database resolution only. DNS and provider connection happen after
    // the quota transaction has accepted this exact stable provider/model/price tuple.
    let route_config = match configuration
        .resolve_route_metadata(&active_group_id, None)
        .await
    {
        Ok(route) => route,
        Err(error) => {
            if is_policy_denial(&error) {
                conversation_service
                    .record_policy_denial(&principal, &active_group_id)
                    .await
                    .map_err(map_preflight_error)?;
            }
            return Err(map_preflight_error(error));
        }
    };
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
                active_group_id: active_group_id.clone(),
                provider_id: route_config.provider_id.clone(),
                model_id: route_config.model_id.clone(),
                price_version_id: route_config.price_version.id.clone(),
                amounts: amounts.clone(),
                expires_at: None,
            },
            GatewayReservationRequirements {
                policy_version_id: &route_config.policy_version_id,
                policy_compiled_hash: &route_config.policy_compiled_hash,
                expected_prompt_profile_id: route_config.prompt_profile_id.as_deref(),
                config_fingerprint: route_config.config_fingerprint,
                conservative_actual: &amounts,
                requests_per_minute: route_config.requests_per_minute,
                max_concurrent_streams: route_config.max_concurrent_streams,
                lease_seconds: GATEWAY_LEASE_SECONDS,
            },
        )
        .await;
    let reservation = match reservation {
        Ok(value) => value,
        Err(error) => {
            if is_policy_denial(&error) {
                conversation_service
                    .record_policy_denial(&principal, &active_group_id)
                    .await
                    .map_err(map_preflight_error)?;
            }
            return Err(map_preflight_error(error));
        }
    };

    // Pin DNS only after quota succeeds; PinnedEndpoint disables proxies and redirects. The
    // whole DNS/connect/header phase is bounded well inside the durable capacity lease.
    let reservation_id = reservation.id;
    let recorder_request = normalized.clone();
    let preflight = async {
        let route = configuration.pin_route(route_config).await.map_err(|_| {
            GatewayFailure::new(StatusCode::SERVICE_UNAVAILABLE, "provider_unavailable")
        })?;
        quota
            .mark_gateway_contacting(&reservation_id)
            .await
            .map_err(map_preflight_error)?;
        let opened = adapter_for(route.provider_kind)
            .stream(&route, normalized)
            .await
            .map_err(map_provider_error)?;
        Ok::<_, GatewayFailure>((route, opened))
    };
    let (route, opened) = match tokio::time::timeout(state.llm_preflight_deadline, preflight).await
    {
        Ok(Ok(opened)) => opened,
        Ok(Err(error)) => {
            quota
                .cancel_gateway(&reservation_id)
                .await
                .map_err(map_preflight_error)?;
            return Err(error);
        }
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
        .mark_gateway_pending(&reservation_id)
        .await
        .map_err(map_preflight_error)?;

    let mut recorder = ConversationService::with_retention_days(
        state.db.clone(),
        state.secret_cipher.as_ref().clone(),
        state.config.conversation_retention_days,
    )
    .begin(BeginConversation {
        reservation_id: &reservation_id,
        learner_user_id: &principal.user_id,
        group_id: &active_group_id,
        provider_id: &route.provider_id,
        model_id: &route.model_id,
        price_version_id: &route.price_version.id,
        policy_version_id: Some(&route.policy_version_id),
        policy_compiled_hash: Some(&route.policy_compiled_hash),
        request: &recorder_request,
    })
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
                    Ok(kind) => {
                        if let Some(delta) = accounting.take_delta() { recorder.record_delta(&delta); }
                        if let Some(delta) = accounting.take_tool_delta() { recorder.record_tool_delta(&delta); }
                        match kind {
                    FrameKind::Data => yield Ok::<Bytes, Infallible>(frame),
                    FrameKind::Done => {
                        let mut measured = completion.clone();
                        measured.actual = accounting.measured_amounts();
                        let final_record = recorder.final_record(if accounting.exact_usage { "exact" } else { "estimated" }, &measured.actual, None);
                        if quota.complete_gateway_recorded(measured, Some((&recorder, &final_record))).await.is_ok() {
                            yield Ok::<Bytes, Infallible>(frame);
                        } else {
                            yield Ok::<Bytes, Infallible>(terminal_error_frame(ProviderError::Unavailable));
                        }
                        break;
                    }
                        }
                    }
                    Err(error) => {
                        let fallback = completion.clone();
                        let record = recorder.final_record("estimated", &fallback.actual, Some(error.stable_code()));
                        let _ = quota.complete_gateway_recorded(fallback, Some((&recorder, &record))).await;
                        yield Ok::<Bytes, Infallible>(terminal_error_frame(error));
                        break;
                    }
                },
                Err(error) => {
                    let fallback = completion.clone();
                    let record = recorder.final_record("estimated", &fallback.actual, Some(error.stable_code()));
                    let _ = quota.complete_gateway_recorded(fallback, Some((&recorder, &record))).await;
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
    exact_usage: bool,
    delta: Option<String>,
    tool_delta: Option<String>,
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
            exact_usage: false,
            delta: None,
            tool_delta: None,
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
            let mut captured = String::new();
            let mut captured_tool = String::new();
            let delta_bytes = value
                .get("choices")
                .and_then(serde_json::Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|choice| choice.get("delta"))
                .try_fold(0_i64, |total, delta| {
                    let content_value = delta.get("content").and_then(serde_json::Value::as_str);
                    if let Some(content) = content_value {
                        captured.push_str(content);
                    }
                    let content = content_value.map_or(0_usize, str::len);
                    let argument_values = delta
                        .get("tool_calls")
                        .and_then(serde_json::Value::as_array)
                        .into_iter()
                        .flatten()
                        .filter_map(|call| call.pointer("/function/arguments"))
                        .filter_map(serde_json::Value::as_str)
                        .collect::<Vec<_>>();
                    for arguments in &argument_values {
                        captured_tool.push_str(arguments);
                    }
                    let arguments = argument_values
                        .iter()
                        .map(|value| value.len())
                        .sum::<usize>();
                    total.checked_add(i64::try_from(content.checked_add(arguments)?).ok()?)
                })
                .ok_or(ProviderError::ResponseTooLarge)?;
            self.output = self
                .output
                .checked_add(delta_bytes)
                .ok_or(ProviderError::ResponseTooLarge)?;
            if !captured.is_empty() {
                self.delta = Some(captured);
            }
            if !captured_tool.is_empty() {
                self.tool_delta = Some(captured_tool);
            }
            if let Some(usage) = value.get("usage") {
                let prompt = usage
                    .get("prompt_tokens")
                    .and_then(serde_json::Value::as_i64);
                let output = usage
                    .get("completion_tokens")
                    .and_then(serde_json::Value::as_i64);
                if let (Some(prompt), Some(output)) = (prompt, output) {
                    self.exact_usage = true;
                    self.input = prompt;
                    self.output = output;
                }
            }
            if let (Some(input), Some(output)) = (
                value
                    .get("prompt_eval_count")
                    .and_then(serde_json::Value::as_i64),
                value.get("eval_count").and_then(serde_json::Value::as_i64),
            ) {
                self.exact_usage = true;
                self.input = input;
                self.output = output;
            }
            self.ensure_within_reservation()?;
        }
        Ok(if done {
            FrameKind::Done
        } else {
            FrameKind::Data
        })
    }

    fn take_delta(&mut self) -> Option<String> {
        self.delta.take()
    }
    fn take_tool_delta(&mut self) -> Option<String> {
        self.tool_delta.take()
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
        AppError::TooManyRequests | AppError::RateLimited(_) => {
            GatewayFailure::new(StatusCode::TOO_MANY_REQUESTS, "rate_limited")
        }
        AppError::QuotaExceeded(_) => {
            GatewayFailure::new(StatusCode::TOO_MANY_REQUESTS, "quota_exceeded")
        }
        AppError::InvalidActiveGroup(_) => {
            GatewayFailure::new(StatusCode::CONFLICT, "invalid_active_group")
        }
        AppError::Forbidden(_) => GatewayFailure::new(StatusCode::FORBIDDEN, "forbidden"),
        AppError::PolicyDenied(_) => GatewayFailure::new(StatusCode::FORBIDDEN, "policy_denied"),
        AppError::ConfigurationUnavailable(_) => {
            GatewayFailure::new(StatusCode::SERVICE_UNAVAILABLE, "provider_unavailable")
        }
        AppError::BadRequest(_) => GatewayFailure::new(StatusCode::BAD_REQUEST, "invalid_request"),
        AppError::Conflict(_) => GatewayFailure::new(StatusCode::CONFLICT, "conflict"),
        _ => GatewayFailure::new(StatusCode::SERVICE_UNAVAILABLE, "provider_unavailable"),
    }
}

fn is_policy_denial(error: &AppError) -> bool {
    matches!(error, AppError::PolicyDenied(_))
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
    use std::{
        future::Future,
        net::SocketAddr,
        pin::Pin,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        },
        time::Duration,
    };

    use axum::{http::Request, Router};
    use sqlx::{sqlite::SqlitePoolOptions, Row};
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };
    use tower::ServiceExt;

    use super::*;
    use crate::{
        authorization::Capability,
        config::Config,
        identity::{IdentityType, Principal},
        llm::{
            endpoint::EndpointResolver,
            provider::{GatewayMessage, NormalizedProviderRequest},
            quota::QuotaService,
        },
        state::AppState,
    };

    struct FixedResolver(SocketAddr, Arc<AtomicUsize>);

    impl EndpointResolver for FixedResolver {
        fn resolve<'a>(
            &'a self,
            _host: &'a str,
            _port: u16,
        ) -> Pin<Box<dyn Future<Output = Result<Vec<SocketAddr>, AppError>> + Send + 'a>> {
            self.1.fetch_add(1, Ordering::SeqCst);
            let address = self.0;
            Box::pin(async move { Ok(vec![address]) })
        }
    }

    struct DelayedResolver(Duration, SocketAddr, Arc<AtomicUsize>);

    impl EndpointResolver for DelayedResolver {
        fn resolve<'a>(
            &'a self,
            _host: &'a str,
            _port: u16,
        ) -> Pin<Box<dyn Future<Output = Result<Vec<SocketAddr>, AppError>> + Send + 'a>> {
            self.2.fetch_add(1, Ordering::SeqCst);
            let delay = self.0;
            let address = self.1;
            Box::pin(async move {
                tokio::time::sleep(delay).await;
                Ok(vec![address])
            })
        }
    }

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
    fn preflight_errors_use_only_typed_wire_categories() {
        let cases = [
            (
                AppError::Unauthorized,
                StatusCode::UNAUTHORIZED,
                "unauthorized",
            ),
            (
                AppError::QuotaExceeded("requests daily".into()),
                StatusCode::TOO_MANY_REQUESTS,
                "quota_exceeded",
            ),
            (
                AppError::InvalidActiveGroup("membership revoked".into()),
                StatusCode::CONFLICT,
                "invalid_active_group",
            ),
            (
                AppError::RateLimited("gateway capacity".into()),
                StatusCode::TOO_MANY_REQUESTS,
                "rate_limited",
            ),
            (
                AppError::ConfigurationUnavailable("model missing".into()),
                StatusCode::SERVICE_UNAVAILABLE,
                "provider_unavailable",
            ),
            (
                AppError::PolicyDenied("model disallowed".into()),
                StatusCode::FORBIDDEN,
                "policy_denied",
            ),
            (
                AppError::Forbidden("policy_denied quota exceeded active group".into()),
                StatusCode::FORBIDDEN,
                "forbidden",
            ),
            (
                AppError::Conflict("policy_denied quota exceeded active group".into()),
                StatusCode::CONFLICT,
                "conflict",
            ),
        ];
        for (error, status, code) in cases {
            let failure = map_preflight_error(error);
            assert_eq!(failure.status, status);
            assert_eq!(failure.code, code);
        }
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

    async fn configured_router_fixture(
        address: SocketAddr,
        resolver: Arc<dyn EndpointResolver>,
        preflight_deadline: Duration,
    ) -> (Router, sqlx::SqlitePool, String, String, String) {
        let database_path =
            std::env::temp_dir().join(format!("mlearn-gateway-real-{}.db", Uuid::now_v7()));
        let options = crate::db::sqlite_connect_options(database_path.to_str().unwrap()).unwrap();
        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(options)
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        for (id, kind, root) in [
            ("admin", "admin", 1_i64),
            ("learner", "learner", 0),
            ("sibling-teacher", "teacher", 0),
        ] {
            sqlx::query("INSERT INTO users (id, email, normalized_email, display_name, status, identity_type, is_root, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?, 1, 1)")
                .bind(id).bind(format!("{id}@test.invalid")).bind(format!("{id}@test.invalid"))
                .bind(id).bind(kind).bind(root).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO groups (id, parent_id, name, slug, status, created_at) VALUES ('school', NULL, 'School', 'school', 'active', 1), ('class', 'school', 'Class', 'class', 'active', 1), ('sibling', 'school', 'Sibling', 'sibling', 'active', 1)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO group_memberships (id, group_id, user_id, status, created_at) VALUES ('admin-membership', 'school', 'admin', 'active', 1), ('learner-membership', 'class', 'learner', 'active', 1)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO group_memberships (id,group_id,user_id,status,created_at) VALUES ('sibling-membership','sibling','sibling-teacher','active',1)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO membership_capabilities (membership_id,capability) VALUES ('sibling-membership','conversations.view')").execute(&pool).await.unwrap();
        for capability in [
            Capability::LlmConfigure,
            Capability::PoliciesView,
            Capability::PoliciesEdit,
            Capability::PoliciesPublish,
            Capability::ConversationsView,
        ] {
            sqlx::query("INSERT INTO membership_capabilities (membership_id, capability) VALUES ('admin-membership', ?)")
                .bind(capability.as_str()).execute(&pool).await.unwrap();
        }
        let admin = Principal {
            user_id: "admin".into(),
            service_key_id: None,
            session_id: "admin-session".into(),
            device_id: "admin-device".into(),
            active_group_id: Some("school".into()),
            identity_type: IdentityType::Admin,
            is_root: true,
        };
        QuotaService::new(pool.clone())
            .configure_calendar(
                &admin,
                "school",
                "Europe/Zurich",
                1_735_689_600,
                1_830_297_600,
            )
            .await
            .unwrap();
        sqlx::query("INSERT INTO quota_definitions (id, owner_group_id, subject_kind, subject_id, metric, period, limit_value, created_by_user_id, created_at, updated_at) VALUES ('root-cost', 'school', 'group', 'school', 'costMicros', 'monthly', 1000000000, 'admin', 1, 1)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO llm_providers (id, group_id, name, provider_kind, base_url, status, created_by_user_id, created_at, updated_at) VALUES ('provider', 'class', 'Provider', 'ollama', ?, 'active', 'admin', 1, 1)")
            .bind(format!("http://ollama:{}", address.port())).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO llm_models (id, group_id, provider_id, model_key, upstream_model, status, created_by_user_id, created_at, updated_at) VALUES ('model', 'class', 'provider', 'balanced', 'model-v1', 'active', 'admin', 1, 1)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO provider_price_versions (id, group_id, provider_id, model_id, currency, unit, input_cost_micros, output_cost_micros, idempotency_key, created_by_user_id, created_at) VALUES ('price', 'class', 'provider', 'model', 'CHF', 'perMillionTokens', 1, 1, 'price', 'admin', 1)")
            .execute(&pool).await.unwrap();
        let document = serde_json::json!({"llm":{"enabled":true,"requestsPerMinute":60,"maxConcurrentStreams":1,"allowedProviders":["provider"],"allowedModels":["model"],"quotas":[{"metric":"costMicros","limit":1000000000_i64,"period":"monthly","hard":true}]}}).to_string();
        sqlx::query("INSERT INTO policy_versions (id, group_id, document_json, document_hash, compiled_hash, author_user_id, summary, parent_version_ids_json, created_at) VALUES ('policy', 'school', ?, 'hash', 'compiled', 'admin', 'governed', '[]', 1)")
            .bind(document).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO active_policies (group_id, policy_version_id, activated_at) VALUES ('school', 'policy', 1)")
            .execute(&pool).await.unwrap();

        let signing = std::env::temp_dir().join(format!("gateway-policy-{}", Uuid::now_v7()));
        let encryption =
            std::env::temp_dir().join(format!("gateway-encryption-{}", Uuid::now_v7()));
        let mut config = Config::from_env();
        config.policy_signing_key_path = signing.to_string_lossy().into_owned();
        config.encryption_key_path = encryption.to_string_lossy().into_owned();
        let mut state = AppState::new(
            bollard::Docker::connect_with_http_defaults().unwrap(),
            config,
            pool.clone(),
        );
        state.llm_endpoint_resolver = resolver;
        state.llm_preflight_deadline = preflight_deadline;
        let session = state
            .identity
            .issue_session("learner", None, Some("class"))
            .await
            .unwrap();
        let sibling = state
            .identity
            .issue_session("sibling-teacher", None, Some("sibling"))
            .await
            .unwrap();
        let admin_session = state
            .identity
            .issue_session("admin", None, Some("school"))
            .await
            .unwrap();
        let app = router(state.clone())
            .merge(crate::routes::conversations::router(state.clone()))
            .with_state(state);
        (
            app,
            pool,
            session.access_token,
            sibling.access_token,
            admin_session.access_token,
        )
    }

    async fn mock_upstream(status: u16, body: &'static str) -> SocketAddr {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                let mut request = vec![0_u8; 16 * 1024];
                let _ = socket.read(&mut request).await;
                let reason = if status == 200 { "OK" } else { "Error" };
                let response = format!("HTTP/1.1 {status} {reason}\r\nContent-Type: application/x-ndjson\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                socket.write_all(response.as_bytes()).await.unwrap();
            }
        });
        address
    }

    async fn post_gateway(app: Router, token: &str) -> Response {
        app.oneshot(
            Request::post("/api/llm/stream")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"messages":[{"role":"user","content":"private-gateway-prompt-7f4b"},{"role":"assistant","content":"","tool_calls":[{"id":"call_1","type":"function","function":{"name":"lookup","arguments":"{\"term\":\"private-tool-argument\"}"}}]},{"role":"tool","content":"private-tool-result","tool_call_id":"call_1"}],"tools":[{"type":"function","function":{"name":"lookup","description":"","parameters":{"type":"object"}}}],"think":false}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap()
    }

    async fn assert_gateway_files_exclude(pool: &sqlx::SqlitePool, secrets: &[&str]) {
        let row = sqlx::query("PRAGMA database_list")
            .fetch_all(pool)
            .await
            .unwrap()
            .into_iter()
            .find(|row| row.get::<String, _>("name") == "main")
            .unwrap();
        let path: String = row.get("file");
        assert!(!path.is_empty());
        for candidate in [path.clone(), format!("{path}-wal"), format!("{path}-shm")] {
            if let Ok(bytes) = std::fs::read(&candidate) {
                for secret in secrets {
                    assert!(
                        !bytes
                            .windows(secret.len())
                            .any(|window| window == secret.as_bytes()),
                        "plaintext leaked to {candidate}"
                    );
                }
            }
        }
    }

    #[tokio::test]
    async fn configured_router_reserves_before_contact_and_completes_exact_sse() {
        let address = mock_upstream(200, "{\"message\":{\"content\":\"private-assistant-response-93ac\"},\"done\":false}\n{\"done\":true,\"prompt_eval_count\":2,\"eval_count\":1}\n").await;
        let resolutions = Arc::new(AtomicUsize::new(0));
        let resolver = Arc::new(FixedResolver(address, resolutions.clone()));
        let (app, pool, token, sibling_token, admin_token) =
            configured_router_fixture(address, resolver, Duration::from_secs(2)).await;
        sqlx::query("INSERT INTO quota_reservations(id,request_id,learner_user_id,direct_group_id,provider_id,model_id,price_version_id,payload_hash,status,expires_at,accounting_at,finalized,created_at,reconciled_at,reconcile_hash) VALUES('expired-retention-reservation','expired-retention-request','learner','class','provider','model','price',zeroblob(32),'reconciled',1,1,1,1,1,zeroblob(32))").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO conversations(id,owner_group_id,learner_user_id,created_at,updated_at,retained_until,status) VALUES('expired-retention','class','learner',0,0,0,'pending')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO llm_requests(id,conversation_id,reservation_id,provider_id,model_id,price_version_id,status,created_at) VALUES('expired-retention-request-row','expired-retention','expired-retention-reservation','provider','model','price','pending',0)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO conversation_messages(id,conversation_id,request_id,sequence,role,encrypted_content,content_bytes,truncated,retained,created_at) VALUES('expired-message','expired-retention','expired-retention-request-row',0,'user','v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA',8,0,1,0)").execute(&pool).await.unwrap();
        assert_eq!(resolutions.load(Ordering::SeqCst), 0);
        let response = post_gateway(app.clone(), &token).await;
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        assert_eq!(bytes, Bytes::from_static(b"data: {\"choices\":[{\"delta\":{\"content\":\"private-assistant-response-93ac\"}}]}\n\ndata: {\"choices\":[{\"delta\":{}}],\"eval_count\":1,\"prompt_eval_count\":2}\n\ndata: [DONE]\n\n"));
        assert_eq!(resolutions.load(Ordering::SeqCst), 1);
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT retained FROM conversation_messages WHERE id='expired-message'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            0
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM audit_events WHERE action='conversations.retention_redacted'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM quota_reservations WHERE id!='expired-retention-reservation'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT phase FROM llm_gateway_reservations")
                .fetch_one(&pool)
                .await
                .unwrap(),
            "completed"
        );
        let stored: Vec<String> = sqlx::query_scalar(
            "SELECT encrypted_content FROM conversation_messages WHERE conversation_id!='expired-retention' ORDER BY sequence",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(stored.len(), 4);
        assert!(stored.iter().all(|ciphertext| {
            !ciphertext.contains("private-gateway-prompt-7f4b")
                && !ciphertext.contains("private-assistant-response-93ac")
                && !ciphertext.contains("private-tool")
        }));
        let stored_tools:Vec<String>=sqlx::query_scalar("SELECT encrypted_tool_data FROM conversation_messages WHERE encrypted_tool_data IS NOT NULL").fetch_all(&pool).await.unwrap();
        assert!(stored_tools
            .iter()
            .all(|ciphertext| !ciphertext.contains("private-tool")));
        assert_gateway_files_exclude(
            &pool,
            &[
                "private-gateway-prompt-7f4b",
                "private-assistant-response-93ac",
                "private-tool-argument",
                "private-tool-result",
            ],
        )
        .await;
        let request =
            sqlx::query("SELECT status,usage_quality,input_tokens,output_tokens,policy_version_id,policy_compiled_hash FROM llm_requests WHERE status='completed'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(request.get::<String, _>("status"), "completed");
        assert_eq!(request.get::<String, _>("usage_quality"), "exact");
        assert_eq!(request.get::<i64, _>("input_tokens"), 2);
        assert_eq!(request.get::<i64, _>("output_tokens"), 1);
        assert!(!request.get::<String, _>("policy_version_id").is_empty());
        assert_eq!(request.get::<String, _>("policy_compiled_hash").len(), 64);
        let conversation_id: String =
            sqlx::query_scalar("SELECT id FROM conversations WHERE id!='expired-retention'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let detail_response = app
            .clone()
            .oneshot(
                Request::get(format!("/api/conversations/{conversation_id}"))
                    .header(header::AUTHORIZATION, format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(detail_response.status(), StatusCode::OK);
        let detail: serde_json::Value = serde_json::from_slice(
            &to_bytes(detail_response.into_body(), usize::MAX)
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            detail["messages"][0]["content"],
            "private-gateway-prompt-7f4b"
        );
        assert_eq!(
            detail["messages"][1]["toolData"][0][0]["function"]["arguments"],
            "{\"term\":\"private-tool-argument\"}"
        );
        assert_eq!(detail["messages"][2]["content"], "private-tool-result");
        assert_eq!(
            detail["messages"][3]["content"],
            "private-assistant-response-93ac"
        );
        let normal_list = app
            .clone()
            .oneshot(
                Request::get("/api/conversations?groupId=class&policyBlocked=false&limit=1")
                    .header(header::AUTHORIZATION, format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let normal_status = normal_list.status();
        let normal_bytes = to_bytes(normal_list.into_body(), usize::MAX).await.unwrap();
        assert_eq!(
            normal_status,
            StatusCode::OK,
            "{}",
            String::from_utf8_lossy(&normal_bytes)
        );
        let normal_list: serde_json::Value = serde_json::from_slice(&normal_bytes).unwrap();
        assert_eq!(normal_list["items"].as_array().unwrap().len(), 1);
        assert!(normal_list.get("nextCursor").is_some());
        assert!(
            sqlx::query("UPDATE llm_requests SET cost_micros=999 WHERE status='completed'")
                .execute(&pool)
                .await
                .is_err()
        );
        assert!(sqlx::query(
            "UPDATE conversations SET retained_until=999999 WHERE status='completed'"
        )
        .execute(&pool)
        .await
        .is_err());
        assert!(
            sqlx::query("UPDATE conversation_messages SET encrypted_content='v1.bad.bad'")
                .execute(&pool)
                .await
                .is_err()
        );
        sqlx::query("UPDATE sessions SET revoked_at=unixepoch() WHERE user_id='learner'")
            .execute(&pool)
            .await
            .unwrap();
        let revoked = app
            .clone()
            .oneshot(
                Request::get(format!("/api/conversations/{conversation_id}"))
                    .header(header::AUTHORIZATION, format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(revoked.status(), StatusCode::UNAUTHORIZED);
        sqlx::query("UPDATE groups SET status='archived' WHERE id='class'")
            .execute(&pool)
            .await
            .unwrap();
        let archived = app
            .clone()
            .oneshot(
                Request::get(format!("/api/conversations/{conversation_id}"))
                    .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(archived.status(), StatusCode::OK);
        let denied = app
            .clone()
            .oneshot(
                Request::get(format!("/api/conversations/{conversation_id}"))
                    .header(header::AUTHORIZATION, format!("Bearer {sibling_token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(denied.status(), StatusCode::FORBIDDEN);
        let denied_body = to_bytes(denied.into_body(), usize::MAX).await.unwrap();
        let missing = app
            .oneshot(
                Request::get("/api/conversations/does-not-exist")
                    .header(header::AUTHORIZATION, format!("Bearer {sibling_token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            to_bytes(missing.into_body(), usize::MAX).await.unwrap(),
            denied_body
        );
    }

    #[tokio::test]
    async fn configured_router_non_success_headers_cancel_without_charge() {
        for (status, expected_status, expected_code) in [
            (401, StatusCode::SERVICE_UNAVAILABLE, "provider_unavailable"),
            (403, StatusCode::SERVICE_UNAVAILABLE, "provider_unavailable"),
            (404, StatusCode::SERVICE_UNAVAILABLE, "provider_unavailable"),
            (429, StatusCode::TOO_MANY_REQUESTS, "rate_limited"),
            (500, StatusCode::SERVICE_UNAVAILABLE, "provider_unavailable"),
        ] {
            let address = mock_upstream(status, "secret provider body").await;
            let resolver = Arc::new(FixedResolver(address, Arc::new(AtomicUsize::new(0))));
            let (app, pool, token, _, _) =
                configured_router_fixture(address, resolver, Duration::from_secs(2)).await;
            let response = post_gateway(app, &token).await;
            assert_eq!(response.status(), expected_status, "upstream {status}");
            let value: serde_json::Value =
                serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                    .unwrap();
            assert_eq!(value["error"], expected_code);
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM usage_ledger")
                    .fetch_one(&pool)
                    .await
                    .unwrap(),
                0
            );
            assert_eq!(
                sqlx::query_scalar::<_, String>("SELECT phase FROM llm_gateway_reservations")
                    .fetch_one(&pool)
                    .await
                    .unwrap(),
                "cancelled"
            );
            assert_gateway_files_exclude(&pool, &["secret provider body"]).await;
        }
    }

    #[tokio::test]
    async fn policy_denial_records_only_filterable_metadata_without_contact_or_charge() {
        let address: SocketAddr = "93.184.216.34:11434".parse().unwrap();
        let resolutions = Arc::new(AtomicUsize::new(0));
        let resolver = Arc::new(FixedResolver(address, resolutions.clone()));
        let (app, pool, token, _, _) =
            configured_router_fixture(address, resolver, Duration::from_secs(2)).await;
        let denied=serde_json::json!({"llm":{"enabled":false,"requestsPerMinute":60,"maxConcurrentStreams":1,"allowedProviders":["provider"],"allowedModels":["model"],"quotas":[]}}).to_string();
        sqlx::query("INSERT INTO policy_versions(id,group_id,document_json,document_hash,compiled_hash,author_user_id,summary,parent_version_ids_json,created_at) VALUES('denied-policy','school',?,'denied-hash','denied-compiled','admin','denied','[]',2)").bind(denied).execute(&pool).await.unwrap();
        sqlx::query("UPDATE active_policies SET policy_version_id='denied-policy',activated_at=2 WHERE group_id='school'").execute(&pool).await.unwrap();
        let response = post_gateway(app.clone(), &token).await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_eq!(resolutions.load(Ordering::SeqCst), 0);
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM quota_reservations")
                .fetch_one(&pool)
                .await
                .unwrap(),
            0
        );
        sqlx::query("UPDATE active_policies SET policy_version_id='policy',activated_at=5 WHERE group_id='school'").execute(&pool).await.unwrap();
        sqlx::query("UPDATE llm_providers SET status='disabled' WHERE id='provider'")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            post_gateway(app.clone(), &token).await.status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
        sqlx::query("UPDATE llm_providers SET status='active' WHERE id='provider'")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE llm_models SET status='disabled' WHERE id='model'")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            post_gateway(app.clone(), &token).await.status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
        sqlx::query("UPDATE llm_models SET status='active' WHERE id='model'")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO prompt_profiles(id,group_id,name,system_prompt,status,created_by_user_id,created_at,updated_at) VALUES('missing-prompt','class','Missing','private prompt','disabled','admin',5,5)").execute(&pool).await.unwrap();
        let prompt_policy=serde_json::json!({"llm":{"enabled":true,"requestsPerMinute":60,"maxConcurrentStreams":1,"allowedProviders":["provider"],"allowedModels":["model"],"promptProfileId":"missing-prompt","quotas":[{"metric":"costMicros","limit":1000000000_i64,"period":"monthly","hard":true}]}}).to_string();
        sqlx::query("INSERT INTO policy_versions(id,group_id,document_json,document_hash,compiled_hash,author_user_id,summary,parent_version_ids_json,created_at) VALUES('missing-prompt-policy','school',?,'missing-prompt-hash','missing-prompt-compiled','admin','missing prompt','[]',5)").bind(prompt_policy).execute(&pool).await.unwrap();
        sqlx::query("UPDATE active_policies SET policy_version_id='missing-prompt-policy',activated_at=5 WHERE group_id='school'").execute(&pool).await.unwrap();
        assert_eq!(
            post_gateway(app.clone(), &token).await.status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM llm_policy_block_events")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM llm_policy_block_events WHERE error_code='policy_denied'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            1
        );
        for (id, providers, models, prompt) in [
            (
                "missing-provider-policy",
                serde_json::json!(["missing-provider"]),
                serde_json::json!(["model"]),
                serde_json::Value::Null,
            ),
            (
                "missing-model-policy",
                serde_json::json!(["provider"]),
                serde_json::json!(["missing-model"]),
                serde_json::Value::Null,
            ),
            (
                "absent-prompt-policy",
                serde_json::json!(["provider"]),
                serde_json::json!(["model"]),
                serde_json::json!("absent-prompt"),
            ),
        ] {
            let mut llm = serde_json::json!({
                "enabled": true,
                "requestsPerMinute": 60,
                "maxConcurrentStreams": 1,
                "allowedProviders": providers,
                "allowedModels": models,
                "quotas": [{"metric":"costMicros","limit":1000000000_i64,"period":"monthly","hard":true}]
            });
            if !prompt.is_null() {
                llm["promptProfileId"] = prompt;
            }
            let document = serde_json::json!({"llm": llm}).to_string();
            sqlx::query("INSERT INTO policy_versions(id,group_id,document_json,document_hash,compiled_hash,author_user_id,summary,parent_version_ids_json,created_at) VALUES(?, 'school', ?, ?, ?, 'admin', 'missing resource', '[]', 6)")
                .bind(id).bind(document).bind(format!("{id}-hash")).bind(format!("{id}-compiled"))
                .execute(&pool).await.unwrap();
            sqlx::query("UPDATE active_policies SET policy_version_id=?,activated_at=6 WHERE group_id='school'")
                .bind(id).execute(&pool).await.unwrap();
            let response = post_gateway(app.clone(), &token).await;
            assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE, "{id}");
            let body: serde_json::Value =
                serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                    .unwrap();
            assert_eq!(body["error"], "provider_unavailable", "{id}");
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM llm_policy_block_events")
                    .fetch_one(&pool)
                    .await
                    .unwrap(),
                1,
                "{id} must not be recorded as a policy denial",
            );
        }
        let list = app
            .clone()
            .oneshot(
                Request::get("/api/conversations?groupId=class&policyBlocked=true")
                    .header(header::AUTHORIZATION, format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(list.status(), StatusCode::OK);
        let value: serde_json::Value =
            serde_json::from_slice(&to_bytes(list.into_body(), usize::MAX).await.unwrap()).unwrap();
        assert_eq!(value["items"].as_array().unwrap().len(), 1);
        sqlx::query("INSERT INTO llm_providers (id,group_id,name,provider_kind,base_url,status,created_by_user_id,created_at,updated_at) VALUES ('other-provider','class','Other','ollama','http://ollama:11434','active','admin',7,7)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO llm_models (id,group_id,provider_id,model_key,upstream_model,status,created_by_user_id,created_at,updated_at) VALUES ('other-model','class','other-provider','other','other-v1','active','admin',7,7)").execute(&pool).await.unwrap();
        let disallowed=serde_json::json!({"llm":{"enabled":true,"requestsPerMinute":60,"maxConcurrentStreams":1,"allowedProviders":["provider"],"allowedModels":["other-model"],"quotas":[{"metric":"costMicros","limit":1000000000_i64,"period":"monthly","hard":true}]}}).to_string();
        sqlx::query("INSERT INTO policy_versions(id,group_id,document_json,document_hash,compiled_hash,author_user_id,summary,parent_version_ids_json,created_at) VALUES('disallowed-policy','school',?,'disallowed-hash','disallowed-compiled','admin','disallowed','[]',3)").bind(disallowed).execute(&pool).await.unwrap();
        sqlx::query("UPDATE active_policies SET policy_version_id='disallowed-policy',activated_at=3 WHERE group_id='school'").execute(&pool).await.unwrap();
        assert_eq!(
            post_gateway(app.clone(), &token).await.status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM llm_policy_block_events")
                .fetch_one(&pool)
                .await
                .unwrap(),
            2,
            "nonempty but disallowed provider/model IDs must record a block event",
        );
        let no_quota=serde_json::json!({"llm":{"enabled":true,"requestsPerMinute":60,"maxConcurrentStreams":1,"allowedProviders":["provider"],"allowedModels":["model"],"quotas":[]}}).to_string();
        sqlx::query("INSERT INTO policy_versions(id,group_id,document_json,document_hash,compiled_hash,author_user_id,summary,parent_version_ids_json,created_at) VALUES('no-quota-policy','school',?,'no-quota-hash','no-quota-compiled','admin','no quota','[]',4)").bind(no_quota).execute(&pool).await.unwrap();
        sqlx::query("UPDATE active_policies SET policy_version_id='no-quota-policy',activated_at=4 WHERE group_id='school'").execute(&pool).await.unwrap();
        assert_eq!(
            post_gateway(app.clone(), &token).await.status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM llm_policy_block_events")
                .fetch_one(&pool)
                .await
                .unwrap(),
            3
        );
        assert_eq!(resolutions.load(Ordering::SeqCst), 0);
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM quota_reservations")
                .fetch_one(&pool)
                .await
                .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn configured_router_rejects_revoked_archived_and_sibling_context_before_contact() {
        for scenario in ["revoked", "archived", "sibling"] {
            let address: SocketAddr = "93.184.216.34:11434".parse().unwrap();
            let resolutions = Arc::new(AtomicUsize::new(0));
            let resolver = Arc::new(FixedResolver(address, resolutions.clone()));
            let (app, pool, token, _, _) =
                configured_router_fixture(address, resolver, Duration::from_secs(2)).await;
            match scenario {
                "revoked" => {
                    sqlx::query("UPDATE group_memberships SET status = 'archived' WHERE id = 'learner-membership'")
                        .execute(&pool).await.unwrap();
                }
                "archived" => {
                    sqlx::query("UPDATE groups SET status = 'archived' WHERE id = 'class'")
                        .execute(&pool)
                        .await
                        .unwrap();
                }
                "sibling" => {
                    sqlx::query(
                        "UPDATE sessions SET active_group_id = 'sibling' WHERE user_id = 'learner'",
                    )
                    .execute(&pool)
                    .await
                    .unwrap();
                }
                _ => unreachable!(),
            }
            let response = post_gateway(app, &token).await;
            assert_ne!(response.status(), StatusCode::OK, "{scenario}");
            assert_eq!(resolutions.load(Ordering::SeqCst), 0, "{scenario}");
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM quota_reservations")
                    .fetch_one(&pool)
                    .await
                    .unwrap(),
                0,
                "{scenario}"
            );
        }
    }

    #[tokio::test]
    async fn configured_router_post_header_failure_and_output_overrun_use_stable_frames() {
        for body in [
            "not-json\n",
            Box::leak(
                format!(
                    "{{\"message\":{{\"content\":\"{}\"}},\"done\":false}}\n",
                    "x".repeat(4097)
                )
                .into_boxed_str(),
            ),
        ] {
            let address = mock_upstream(200, body).await;
            let resolver = Arc::new(FixedResolver(address, Arc::new(AtomicUsize::new(0))));
            let (app, pool, token, _, _) =
                configured_router_fixture(address, resolver, Duration::from_secs(2)).await;
            let response = post_gateway(app, &token).await;
            assert_eq!(response.status(), StatusCode::OK);
            let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
            assert_eq!(
                bytes,
                Bytes::from_static(b"data: {\"error\":\"provider_unavailable\",\"done\":true}\n\n")
            );
            assert_eq!(
                sqlx::query_scalar::<_, String>("SELECT phase FROM llm_gateway_reservations")
                    .fetch_one(&pool)
                    .await
                    .unwrap(),
                "completed"
            );
        }
    }

    #[tokio::test]
    async fn configured_router_disconnect_leaves_pending_fallback_recovered_exactly_once() {
        let address = mock_upstream(
            200,
            "{\"message\":{\"content\":\"partial\"},\"done\":false}\n",
        )
        .await;
        let resolver = Arc::new(FixedResolver(address, Arc::new(AtomicUsize::new(0))));
        let (app, pool, token, _, _) =
            configured_router_fixture(address, resolver, Duration::from_secs(2)).await;
        let response = post_gateway(app, &token).await;
        assert_eq!(response.status(), StatusCode::OK);
        drop(response);
        let reservation_id: String =
            sqlx::query_scalar("SELECT reservation_id FROM llm_gateway_reservations")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT phase FROM llm_gateway_reservations WHERE reservation_id = ?"
            )
            .bind(&reservation_id)
            .fetch_one(&pool)
            .await
            .unwrap(),
            "pending"
        );
        assert!(
            sqlx::query("UPDATE llm_requests SET status='completed' WHERE reservation_id=?")
                .bind(&reservation_id)
                .execute(&pool)
                .await
                .is_err()
        );
        assert!(
            sqlx::query("UPDATE conversations SET status='failed',updated_at=unixepoch()")
                .execute(&pool)
                .await
                .is_err()
        );
        sqlx::query("UPDATE llm_gateway_leases SET acquired_at = 0, expires_at = 1 WHERE reservation_id = ?")
            .bind(&reservation_id).execute(&pool).await.unwrap();
        let quota = QuotaService::new(pool.clone());
        quota.release_expired().await.unwrap();
        let ledger_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM usage_ledger WHERE reservation_id = ?")
                .bind(&reservation_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(ledger_count > 0);
        assert_eq!(
            sqlx::query_as::<_, (String, String)>(
                "SELECT status,error_code FROM llm_requests WHERE reservation_id=?"
            )
            .bind(&reservation_id)
            .fetch_one(&pool)
            .await
            .unwrap(),
            ("failed".into(), "stream_abandoned".into())
        );
        quota.release_expired().await.unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM usage_ledger WHERE reservation_id = ?"
            )
            .bind(&reservation_id)
            .fetch_one(&pool)
            .await
            .unwrap(),
            ledger_count
        );
    }

    #[tokio::test]
    async fn preflight_deadline_releases_capacity_before_delayed_resolution_can_contact() {
        let address: SocketAddr = "93.184.216.34:11434".parse().unwrap();
        let resolutions = Arc::new(AtomicUsize::new(0));
        let resolver = Arc::new(DelayedResolver(
            Duration::from_millis(200),
            address,
            resolutions.clone(),
        ));
        let (app, pool, token, _, _) =
            configured_router_fixture(address, resolver, Duration::from_millis(20)).await;
        let first = post_gateway(app.clone(), &token).await;
        assert_eq!(first.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT phase FROM llm_gateway_reservations ORDER BY updated_at DESC LIMIT 1"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            "cancelled"
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM llm_gateway_leases WHERE released_at IS NULL"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            0
        );
        let second = post_gateway(app, &token).await;
        assert_eq!(second.status(), StatusCode::SERVICE_UNAVAILABLE);
        tokio::time::sleep(Duration::from_millis(250)).await;
        assert_eq!(resolutions.load(Ordering::SeqCst), 2);
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM usage_ledger")
                .fetch_one(&pool)
                .await
                .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn configured_router_concurrency_is_atomic_and_released_after_completion() {
        let address = mock_upstream(200, "{\"done\":true,\"eval_count\":0}\n").await;
        let resolutions = Arc::new(AtomicUsize::new(0));
        let resolver = Arc::new(DelayedResolver(
            Duration::from_millis(100),
            address,
            resolutions.clone(),
        ));
        let (app, pool, token, _, _) =
            configured_router_fixture(address, resolver, Duration::from_secs(2)).await;
        let first_app = app.clone();
        let first_token = token.clone();
        let first = tokio::spawn(async move { post_gateway(first_app, &first_token).await });
        while resolutions.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
        let rejected = post_gateway(app.clone(), &token).await;
        assert_eq!(rejected.status(), StatusCode::TOO_MANY_REQUESTS);
        let rejected_body: serde_json::Value =
            serde_json::from_slice(&to_bytes(rejected.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(rejected_body["error"], "rate_limited");
        let completed = first.await.unwrap();
        assert_eq!(completed.status(), StatusCode::OK);
        let _ = to_bytes(completed.into_body(), usize::MAX).await.unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM llm_gateway_leases WHERE released_at IS NULL"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            0
        );
    }
}
