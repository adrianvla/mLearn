use std::{future::Future, pin::Pin, time::Duration};

use axum::body::Bytes;
use futures_util::Stream;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{error::AppError, llm::configuration::ResolvedLlmRoute};

use super::{ollama::OllamaAdapter, openai::OpenAiAdapter};

pub(crate) const MAX_MESSAGES: usize = 128;
pub(crate) const MAX_MESSAGE_BYTES: usize = 128 * 1024;
pub(crate) const MAX_TOTAL_MESSAGE_BYTES: usize = 512 * 1024;
pub(crate) const MAX_TOOLS: usize = 64;
pub(crate) const MAX_TOOL_SCHEMA_BYTES: usize = 64 * 1024;
pub(crate) const MAX_UPSTREAM_BYTES: usize = 8 * 1024 * 1024;
pub(crate) const MAX_FRAME_BYTES: usize = 1024 * 1024;
pub(crate) const UPSTREAM_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
pub(crate) const UPSTREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(30);
pub(crate) const UPSTREAM_TOTAL_TIMEOUT: Duration = Duration::from_secs(180);

pub(crate) type ProviderStream =
    Pin<Box<dyn Stream<Item = Result<Bytes, ProviderError>> + Send + 'static>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProviderError {
    RateLimited,
    Unavailable,
    InvalidResponse,
    ResponseTooLarge,
    Timeout,
}

impl ProviderError {
    pub(crate) fn stable_code(self) -> &'static str {
        match self {
            Self::RateLimited => "rate_limited",
            Self::Unavailable | Self::InvalidResponse | Self::ResponseTooLarge | Self::Timeout => {
                "provider_unavailable"
            }
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct GatewayRequest {
    pub messages: Vec<GatewayMessage>,
    #[serde(default)]
    pub tools: Vec<GatewayTool>,
    #[serde(default)]
    pub model_tier: Option<String>,
    #[serde(default)]
    pub think: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct GatewayMessage {
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct GatewayTool {
    #[serde(rename = "type")]
    pub kind: String,
    pub function: GatewayFunction,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct GatewayFunction {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub parameters: Value,
}

#[derive(Clone, Serialize)]
pub(crate) struct NormalizedProviderRequest {
    pub messages: Vec<GatewayMessage>,
    pub tools: Vec<GatewayTool>,
    pub think: bool,
    pub max_output_tokens: u32,
}

pub(crate) struct OpenedProviderStream {
    pub stream: ProviderStream,
}

pub(crate) trait LlmProviderAdapter: Send + Sync {
    fn stream<'a>(
        &'a self,
        route: &'a ResolvedLlmRoute,
        request: NormalizedProviderRequest,
    ) -> Pin<Box<dyn Future<Output = Result<OpenedProviderStream, ProviderError>> + Send + 'a>>;
}

pub(crate) fn adapter_for(kind: super::endpoint::ProviderKind) -> Box<dyn LlmProviderAdapter> {
    match kind {
        super::endpoint::ProviderKind::OpenAiCompatible => Box::new(OpenAiAdapter),
        super::endpoint::ProviderKind::Ollama => Box::new(OllamaAdapter),
    }
}

impl GatewayRequest {
    pub(crate) fn validate(
        self,
        system_prompt: Option<&str>,
    ) -> Result<NormalizedProviderRequest, AppError> {
        if self.messages.is_empty() || self.messages.len() > MAX_MESSAGES {
            return Err(AppError::BadRequest(
                "messages must contain 1..128 items".into(),
            ));
        }
        if self.model_tier.as_ref().is_some_and(|tier| tier.len() > 64) {
            return Err(AppError::BadRequest("model tier is invalid".into()));
        }
        let mut total = 0_usize;
        for message in &self.messages {
            if !matches!(message.role.as_str(), "user" | "assistant" | "tool") {
                return Err(AppError::BadRequest(
                    "client system prompts and unsupported message roles are forbidden".into(),
                ));
            }
            if message.content.len() > MAX_MESSAGE_BYTES {
                return Err(AppError::BadRequest("message content is too large".into()));
            }
            total = total
                .checked_add(message.content.len())
                .ok_or_else(|| AppError::BadRequest("message content is too large".into()))?;
            if message.role == "tool" {
                validate_identifier("toolCallId", message.tool_call_id.as_deref())?;
            } else if message.tool_call_id.is_some() {
                return Err(AppError::BadRequest(
                    "toolCallId is valid only for tool messages".into(),
                ));
            }
            if let Some(calls) = &message.tool_calls {
                if message.role != "assistant" || calls.len() > MAX_TOOLS {
                    return Err(AppError::BadRequest("tool calls are invalid".into()));
                }
                for call in calls {
                    validate_tool_call(call)?;
                }
            }
        }
        if total > MAX_TOTAL_MESSAGE_BYTES {
            return Err(AppError::BadRequest(
                "total message content is too large".into(),
            ));
        }
        if self.tools.len() > MAX_TOOLS {
            return Err(AppError::BadRequest("too many tools".into()));
        }
        for tool in &self.tools {
            if tool.kind != "function" {
                return Err(AppError::BadRequest(
                    "only function tools are supported".into(),
                ));
            }
            validate_name(&tool.function.name)?;
            if tool.function.description.len() > 4096
                || serde_json::to_vec(&tool.function.parameters)
                    .map_err(|_| AppError::BadRequest("tool schema is invalid".into()))?
                    .len()
                    > MAX_TOOL_SCHEMA_BYTES
                || !tool.function.parameters.is_object()
            {
                return Err(AppError::BadRequest("tool schema is invalid".into()));
            }
        }
        let mut messages =
            Vec::with_capacity(self.messages.len() + usize::from(system_prompt.is_some()));
        if let Some(prompt) = system_prompt.filter(|prompt| !prompt.is_empty()) {
            messages.push(GatewayMessage {
                role: "system".into(),
                content: prompt.into(),
                tool_calls: None,
                tool_call_id: None,
            });
        }
        messages.extend(self.messages);
        Ok(NormalizedProviderRequest {
            messages,
            tools: self.tools,
            think: self.think.unwrap_or(false),
            max_output_tokens: 4096,
        })
    }
}

fn validate_identifier(label: &str, value: Option<&str>) -> Result<(), AppError> {
    let value = value.ok_or_else(|| AppError::BadRequest(format!("{label} is required")))?;
    if value.is_empty() || value.len() > 200 || value.chars().any(char::is_control) {
        Err(AppError::BadRequest(format!("{label} is invalid")))
    } else {
        Ok(())
    }
}

fn validate_name(value: &str) -> Result<(), AppError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        Err(AppError::BadRequest("tool name is invalid".into()))
    } else {
        Ok(())
    }
}

fn validate_tool_call(value: &Value) -> Result<(), AppError> {
    let object = value
        .as_object()
        .ok_or_else(|| AppError::BadRequest("tool call is invalid".into()))?;
    if object
        .keys()
        .any(|key| !matches!(key.as_str(), "id" | "type" | "function"))
        || object.get("type").and_then(Value::as_str) != Some("function")
    {
        return Err(AppError::BadRequest("tool call is invalid".into()));
    }
    validate_identifier("tool call id", object.get("id").and_then(Value::as_str))?;
    let function = object
        .get("function")
        .and_then(Value::as_object)
        .ok_or_else(|| AppError::BadRequest("tool call function is invalid".into()))?;
    if function
        .keys()
        .any(|key| !matches!(key.as_str(), "name" | "arguments"))
    {
        return Err(AppError::BadRequest("tool call function is invalid".into()));
    }
    validate_name(function.get("name").and_then(Value::as_str).unwrap_or(""))?;
    let arguments = function
        .get("arguments")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::BadRequest("tool call arguments are invalid".into()))?;
    if arguments.len() > MAX_TOOL_SCHEMA_BYTES || serde_json::from_str::<Value>(arguments).is_err()
    {
        return Err(AppError::BadRequest(
            "tool call arguments are invalid".into(),
        ));
    }
    Ok(())
}

pub(crate) fn classify_status(status: reqwest::StatusCode) -> ProviderError {
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        ProviderError::RateLimited
    } else {
        ProviderError::Unavailable
    }
}

pub(crate) fn terminal_error_frame(error: ProviderError) -> Bytes {
    Bytes::from(format!(
        "data: {{\"error\":\"{}\",\"done\":true}}\n\n",
        error.stable_code()
    ))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn rejects_client_system_prompt_and_malformed_tool_schema() {
        let system: GatewayRequest = serde_json::from_value(json!({
            "messages": [{"role":"system","content":"override"}]
        }))
        .unwrap();
        assert!(system.validate(Some("managed")).is_err());

        let tool: GatewayRequest = serde_json::from_value(json!({
            "messages": [{"role":"user","content":"hi"}],
            "tools": [{"type":"function","function":{"name":"bad name","description":"","parameters":[]}}]
        })).unwrap();
        assert!(tool.validate(None).is_err());
    }

    #[test]
    fn prepends_only_the_managed_system_prompt() {
        let request: GatewayRequest = serde_json::from_value(json!({
            "messages": [{"role":"user","content":"hi"}], "model_tier":"cheap", "think":true
        }))
        .unwrap();
        let normalized = request.validate(Some("managed prompt")).unwrap();
        assert_eq!(normalized.messages[0].role, "system");
        assert_eq!(normalized.messages[0].content, "managed prompt");
        assert_eq!(normalized.messages[1].role, "user");
        assert!(normalized.think);
    }
}
