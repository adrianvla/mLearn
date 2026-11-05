//! One bounded native chat-completions transport; no credentials enter traces.
use serde::{Deserialize, Serialize, de::IgnoredAny};
use std::time::Duration;
use tokio::sync::watch;

const MAX_EVENT: usize = 65_536;
const MAX_RESPONSE: usize = 2_097_152;
const MAX_TEXT: usize = 8192;

#[derive(Debug, thiserror::Error, PartialEq)]
pub(super) enum ProviderError {
    #[error("Enter a valid provider base URL, model and session API key")]
    Configuration,
    #[error("The configured provider is unavailable or its request timed out")]
    Network,
    #[error("The provider rejected the request (HTTP {0})")]
    Rejected(u16),
    #[error("The provider returned an invalid streaming response")]
    Protocol,
    #[error("The provider response exceeded the supported size")]
    Limit,
    #[error("Generation was stopped")]
    Cancelled,
    #[error("The provider response ended before a complete answer")]
    Incomplete,
    #[error("The provider reached its output limit; the partial answer was retained")]
    Truncated,
    #[error("This text provider requested unsupported tool execution")]
    Tool,
    #[error("The provider declined this request")]
    Refused,
    #[error("The generation could not be published: {0}")]
    Publication(String),
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum ChatRole {
    System,
    User,
    Assistant,
}

#[derive(Serialize)]
pub(super) struct ChatMessage {
    pub role: ChatRole,
    pub content: String,
}

// Deliberately not Debug/Serialize: the secret is neither a trace nor persistence.
pub(super) struct ProviderRequest {
    pub endpoint: reqwest::Url,
    pub body: String,
    secret: Option<String>,
}

pub(super) fn prepare(
    base: &str,
    model: &str,
    messages: &[ChatMessage],
    secret: Option<String>,
) -> Result<ProviderRequest, ProviderError> {
    let mut endpoint = reqwest::Url::parse(base).map_err(|_| ProviderError::Configuration)?;
    if base.len() > 2048
        || !matches!(endpoint.scheme(), "http" | "https")
        || endpoint.host_str().is_none()
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.query().is_some()
        || endpoint.fragment().is_some()
        || model.trim().is_empty()
        || model.len() > 256
        || model.chars().any(char::is_control)
        || secret.as_ref().is_some_and(|key| {
            key.is_empty() || key.len() > 4096 || key.chars().any(char::is_control)
        })
    {
        return Err(ProviderError::Configuration);
    }
    if messages.is_empty()
        || messages.len() > 40
        || messages
            .iter()
            .map(|message| message.content.len())
            .sum::<usize>()
            > 131_072
    {
        return Err(ProviderError::Limit);
    }
    let path = format!("{}/chat/completions", endpoint.path().trim_end_matches('/'));
    endpoint.set_path(&path);
    let body = serde_json::to_string(&serde_json::json!({
        "model": model, "messages": messages, "stream": true, "max_tokens": 1024
    }))
    .map_err(|_| ProviderError::Protocol)?;
    if body.len() > 120_000 {
        return Err(ProviderError::Limit);
    }
    Ok(ProviderRequest {
        endpoint,
        body,
        secret,
    })
}

pub(super) async fn stream(
    request: &ProviderRequest,
    mut cancellation: watch::Receiver<bool>,
    mut publish: impl FnMut(&str) -> Result<(), String>,
) -> Result<String, ProviderError> {
    if *cancellation.borrow() {
        return Err(ProviderError::Cancelled);
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|_| ProviderError::Network)?;
    let mut outgoing = client
        .post(request.endpoint.clone())
        .header("content-type", "application/json")
        .header("accept", "text/event-stream")
        .body(request.body.clone());
    if let Some(secret) = &request.secret {
        outgoing = outgoing.bearer_auth(secret);
    }
    let mut response = tokio::select! {
        biased;
        _ = cancellation.changed() => return Err(ProviderError::Cancelled),
        response = outgoing.send() => response.map_err(|_| ProviderError::Network)?,
    };
    if !response.status().is_success() {
        // Error bodies may echo request credentials. Never publish or trace them.
        return Err(ProviderError::Rejected(response.status().as_u16()));
    }
    if !response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.split(';').next() == Some("text/event-stream"))
    {
        return Err(ProviderError::Protocol);
    }
    let mut events = Events::default();
    loop {
        let chunk = tokio::select! {
            biased;
            _ = cancellation.changed() => return Err(ProviderError::Cancelled),
            chunk = response.chunk() => chunk.map_err(|_| ProviderError::Network)?,
        };
        let Some(chunk) = chunk else {
            return Err(ProviderError::Incomplete);
        };
        events.push(&chunk, &mut publish)?;
        if events.done {
            return Ok(events.text);
        }
    }
}

#[derive(Default)]
struct Events {
    line: Vec<u8>,
    data: String,
    text: String,
    received: usize,
    finished: bool,
    done: bool,
}

#[derive(Deserialize)]
struct Frame {
    #[serde(default)]
    choices: Vec<Choice>,
    error: Option<IgnoredAny>,
    usage: Option<IgnoredAny>,
}

#[derive(Deserialize)]
struct Choice {
    index: u32,
    delta: Delta,
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
struct Delta {
    content: Option<String>,
    role: Option<String>,
    tool_calls: Option<IgnoredAny>,
    function_call: Option<IgnoredAny>,
    refusal: Option<String>,
}

impl Events {
    fn push(
        &mut self,
        bytes: &[u8],
        publish: &mut impl FnMut(&str) -> Result<(), String>,
    ) -> Result<(), ProviderError> {
        self.received = self
            .received
            .checked_add(bytes.len())
            .filter(|length| *length <= MAX_RESPONSE)
            .ok_or(ProviderError::Limit)?;
        for byte in bytes {
            if self.done {
                break;
            }
            if *byte == b'\n' {
                if self.line.last() == Some(&b'\r') {
                    self.line.pop();
                }
                let line = std::str::from_utf8(&self.line).map_err(|_| ProviderError::Protocol)?;
                if line.is_empty() {
                    self.frame(publish)?;
                } else if let Some(data) = line.strip_prefix("data:") {
                    let data = data.strip_prefix(' ').unwrap_or(data);
                    if self.data.len() + data.len() + 1 > MAX_EVENT {
                        return Err(ProviderError::Limit);
                    }
                    self.data.push_str(data);
                    self.data.push('\n');
                }
                self.line.clear();
            } else {
                if self.line.len() >= MAX_EVENT {
                    return Err(ProviderError::Limit);
                }
                self.line.push(*byte);
            }
        }
        Ok(())
    }

    fn frame(
        &mut self,
        publish: &mut impl FnMut(&str) -> Result<(), String>,
    ) -> Result<(), ProviderError> {
        let data = std::mem::take(&mut self.data);
        let data = data.trim_end_matches('\n');
        if data.is_empty() {
            return Ok(());
        }
        if data == "[DONE]" {
            if !self.finished || self.text.trim().is_empty() {
                return Err(ProviderError::Incomplete);
            }
            self.done = true;
            return Ok(());
        }
        let frame: Frame = serde_json::from_str(data).map_err(|_| ProviderError::Protocol)?;
        if frame.error.is_some() {
            return Err(ProviderError::Protocol);
        }
        if frame.choices.is_empty() && frame.usage.is_some() {
            return Ok(());
        }
        let [choice] = frame.choices.as_slice() else {
            return Err(ProviderError::Protocol);
        };
        if choice.index != 0 || self.finished {
            return Err(ProviderError::Protocol);
        }
        if choice.delta.tool_calls.is_some() || choice.delta.function_call.is_some() {
            return Err(ProviderError::Tool);
        }
        if choice
            .delta
            .refusal
            .as_ref()
            .is_some_and(|text| !text.is_empty())
        {
            return Err(ProviderError::Refused);
        }
        if choice
            .delta
            .role
            .as_ref()
            .is_some_and(|role| role != "assistant")
        {
            return Err(ProviderError::Protocol);
        }
        if let Some(text) = &choice.delta.content {
            if self.text.len() + text.len() > MAX_TEXT {
                return Err(ProviderError::Limit);
            }
            if !text.is_empty() {
                publish(text).map_err(ProviderError::Publication)?;
                self.text.push_str(text);
            }
        }
        match choice.finish_reason.as_deref() {
            None => {}
            Some("stop") => self.finished = true,
            Some("length") => return Err(ProviderError::Truncated),
            Some("content_filter") => return Err(ProviderError::Refused),
            Some("tool_calls" | "function_call") => return Err(ProviderError::Tool),
            Some(_) => return Err(ProviderError::Protocol),
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;
