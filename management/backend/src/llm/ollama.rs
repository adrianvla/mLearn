use std::{future::Future, pin::Pin};

use async_stream::try_stream;
use axum::body::Bytes;
use futures_util::StreamExt;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde_json::{json, Map, Value};
use tokio::time::{timeout, Instant};

use crate::llm::configuration::ResolvedLlmRoute;

use super::provider::{
    classify_status, LlmProviderAdapter, NormalizedProviderRequest, OpenedProviderStream,
    ProviderError, MAX_FRAME_BYTES, MAX_UPSTREAM_BYTES, UPSTREAM_CONNECT_TIMEOUT,
    UPSTREAM_IDLE_TIMEOUT, UPSTREAM_TOTAL_TIMEOUT,
};

pub(crate) struct OllamaAdapter;

impl LlmProviderAdapter for OllamaAdapter {
    fn stream<'a>(
        &'a self,
        route: &'a ResolvedLlmRoute,
        request: NormalizedProviderRequest,
    ) -> Pin<Box<dyn Future<Output = Result<OpenedProviderStream, ProviderError>> + Send + 'a>>
    {
        Box::pin(async move {
            let mut body = json!({
                "model": route.model,
                "messages": request.messages,
                "stream": true,
                "think": request.think,
            });
            if !request.tools.is_empty() {
                body["tools"] =
                    serde_json::to_value(request.tools).map_err(|_| ProviderError::Unavailable)?;
            }
            let mut builder = route
                .endpoint
                .request(reqwest::Method::POST, "api/chat")
                .map_err(|_| ProviderError::Unavailable)?
                .header(CONTENT_TYPE, "application/json")
                .json(&body);
            if let Some(secret) = route.secret.as_ref() {
                builder = builder.header(AUTHORIZATION, format!("Bearer {}", secret.expose()));
            }
            let response = timeout(UPSTREAM_CONNECT_TIMEOUT, builder.send())
                .await
                .map_err(|_| ProviderError::Timeout)?
                .map_err(|_| ProviderError::Unavailable)?;
            if !response.status().is_success() {
                return Err(classify_status(response.status()));
            }
            let mut source = response.bytes_stream();
            let stream = try_stream! {
                let started = Instant::now();
                let mut total = 0_usize;
                let mut decoder = NdjsonDecoder::default();
                while !decoder.done {
                    let remaining = UPSTREAM_TOTAL_TIMEOUT.checked_sub(started.elapsed()).ok_or(ProviderError::Timeout)?;
                    let next = timeout(remaining.min(UPSTREAM_IDLE_TIMEOUT), source.next()).await.map_err(|_| ProviderError::Timeout)?;
                    match next {
                        Some(Ok(chunk)) => {
                            total = total.checked_add(chunk.len()).ok_or(ProviderError::ResponseTooLarge)?;
                            if total > MAX_UPSTREAM_BYTES { Err(ProviderError::ResponseTooLarge)?; }
                            for frame in decoder.push(&chunk)? { yield frame; }
                        }
                        Some(Err(_)) => Err(ProviderError::Unavailable)?,
                        None => {
                            for frame in decoder.finish()? { yield frame; }
                            if !decoder.done { Err(ProviderError::InvalidResponse)?; }
                        }
                    }
                }
            };
            Ok(OpenedProviderStream {
                stream: Box::pin(stream),
            })
        })
    }
}

#[derive(Default)]
struct NdjsonDecoder {
    bytes: Vec<u8>,
    done: bool,
}

impl NdjsonDecoder {
    fn push(&mut self, chunk: &[u8]) -> Result<Vec<Bytes>, ProviderError> {
        self.bytes.extend_from_slice(chunk);
        if self.bytes.len() > MAX_FRAME_BYTES {
            return Err(ProviderError::ResponseTooLarge);
        }
        let mut frames = Vec::new();
        while let Some(newline) = self.bytes.iter().position(|byte| *byte == b'\n') {
            let mut line = self.bytes.drain(..=newline).collect::<Vec<_>>();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if !line.is_empty() {
                frames.extend(self.normalize(&line)?);
            }
            if self.done {
                self.bytes.clear();
                break;
            }
        }
        Ok(frames)
    }

    fn finish(&mut self) -> Result<Vec<Bytes>, ProviderError> {
        if self.bytes.is_empty() {
            return Ok(Vec::new());
        }
        let line = std::mem::take(&mut self.bytes);
        self.normalize(&line)
    }

    fn normalize(&mut self, line: &[u8]) -> Result<Vec<Bytes>, ProviderError> {
        let value: Value =
            serde_json::from_slice(line).map_err(|_| ProviderError::InvalidResponse)?;
        if value.get("error").is_some() {
            return Err(ProviderError::Unavailable);
        }
        let done = value.get("done").and_then(Value::as_bool).unwrap_or(false);
        let message = value.get("message").and_then(Value::as_object);
        let mut delta = Map::new();
        if let Some(content) = message
            .and_then(|message| message.get("content"))
            .and_then(Value::as_str)
        {
            if !content.is_empty() {
                delta.insert("content".into(), Value::String(content.into()));
            }
        }
        if let Some(calls) = message
            .and_then(|message| message.get("tool_calls"))
            .and_then(Value::as_array)
        {
            delta.insert(
                "tool_calls".into(),
                Value::Array(normalize_tool_calls(calls)?),
            );
        }
        let mut normalized = json!({"choices":[{"delta": Value::Object(delta)}]});
        for metric in [
            "eval_count",
            "eval_duration",
            "prompt_eval_duration",
            "total_duration",
        ] {
            if let Some(number) = value.get(metric).and_then(Value::as_u64) {
                normalized[metric] = Value::from(number);
            }
        }
        let mut frames = Vec::new();
        if message.is_some() || done {
            frames.push(Bytes::from(format!(
                "data: {}\n\n",
                serde_json::to_string(&normalized).map_err(|_| ProviderError::InvalidResponse)?
            )));
        }
        if done {
            frames.push(Bytes::from_static(b"data: [DONE]\n\n"));
            self.done = true;
        }
        Ok(frames)
    }
}

fn normalize_tool_calls(calls: &[Value]) -> Result<Vec<Value>, ProviderError> {
    calls
        .iter()
        .enumerate()
        .map(|(index, call)| {
            let function = call
                .get("function")
                .and_then(Value::as_object)
                .ok_or(ProviderError::InvalidResponse)?;
            let name = function
                .get("name")
                .and_then(Value::as_str)
                .ok_or(ProviderError::InvalidResponse)?;
            let arguments = function
                .get("arguments")
                .ok_or(ProviderError::InvalidResponse)?;
            let arguments = match arguments {
                Value::String(value) => value.clone(),
                value => {
                    serde_json::to_string(value).map_err(|_| ProviderError::InvalidResponse)?
                }
            };
            Ok(json!({
                "index": index,
                "id": format!("ollama_{index}"),
                "type": "function",
                "function": {"name": name, "arguments": arguments}
            }))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::NdjsonDecoder;

    #[test]
    fn normalizes_fragmented_ollama_content_tools_metrics_and_done() {
        let input = concat!(
            "{\"message\":{\"role\":\"assistant\",\"content\":\"Hi\",\"tool_calls\":[{\"function\":{\"name\":\"lookup\",\"arguments\":{\"q\":\"x\"}}}]},\"done\":false}\n",
            "{\"message\":{\"role\":\"assistant\",\"content\":\"\"},\"done\":true,\"eval_count\":7}\n"
        ).as_bytes();
        let mut decoder = NdjsonDecoder::default();
        let mut frames = Vec::new();
        for chunk in input.chunks(3) {
            frames.extend(decoder.push(chunk).unwrap());
        }
        let text = frames
            .into_iter()
            .map(|part| String::from_utf8(part.to_vec()).unwrap())
            .collect::<String>();
        assert!(text.contains("\\\"q\\\":\\\"x\\\""));
        assert!(text.contains("\"eval_count\":7"));
        assert!(text.ends_with("data: [DONE]\n\n"));
        assert!(decoder.done);
    }

    #[test]
    fn rejects_error_and_malformed_lines_without_exposing_them() {
        let mut decoder = NdjsonDecoder::default();
        assert!(decoder.push(b"{\"error\":\"secret body\"}\n").is_err());
        let mut decoder = NdjsonDecoder::default();
        assert!(decoder.push(b"not json\n").is_err());
    }
}
