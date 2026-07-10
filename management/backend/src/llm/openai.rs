use std::{future::Future, pin::Pin};

use async_stream::try_stream;
use axum::body::Bytes;
use futures_util::StreamExt;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde_json::{json, Value};
use tokio::time::{timeout, Instant};

use crate::llm::configuration::ResolvedLlmRoute;

use super::provider::{
    classify_status, LlmProviderAdapter, NormalizedProviderRequest, OpenedProviderStream,
    ProviderError, MAX_FRAME_BYTES, MAX_UPSTREAM_BYTES, UPSTREAM_CONNECT_TIMEOUT,
    UPSTREAM_IDLE_TIMEOUT, UPSTREAM_TOTAL_TIMEOUT,
};

pub(crate) struct OpenAiAdapter;

impl LlmProviderAdapter for OpenAiAdapter {
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
            });
            if !request.tools.is_empty() {
                body["tools"] =
                    serde_json::to_value(request.tools).map_err(|_| ProviderError::Unavailable)?;
            }
            let mut builder = route
                .endpoint
                .request(reqwest::Method::POST, "chat/completions")
                .map_err(|_| ProviderError::Unavailable)?
                .header(CONTENT_TYPE, "application/json")
                .header(ACCEPT, "text/event-stream")
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
                let mut decoder = SseDecoder::default();
                while !decoder.done {
                    let remaining = UPSTREAM_TOTAL_TIMEOUT
                        .checked_sub(started.elapsed())
                        .ok_or(ProviderError::Timeout)?;
                    let wait = remaining.min(UPSTREAM_IDLE_TIMEOUT);
                    let next = timeout(wait, source.next()).await.map_err(|_| ProviderError::Timeout)?;
                    match next {
                        Some(Ok(chunk)) => {
                            total = total.checked_add(chunk.len()).ok_or(ProviderError::ResponseTooLarge)?;
                            if total > MAX_UPSTREAM_BYTES {
                                Err(ProviderError::ResponseTooLarge)?;
                            }
                            for frame in decoder.push(&chunk)? {
                                yield frame;
                            }
                        }
                        Some(Err(_)) => Err(ProviderError::Unavailable)?,
                        None => {
                            for frame in decoder.finish()? {
                                yield frame;
                            }
                            if !decoder.done {
                                Err(ProviderError::InvalidResponse)?;
                            }
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
struct SseDecoder {
    bytes: Vec<u8>,
    data: Vec<String>,
    comments: Vec<String>,
    event_bytes: usize,
    done: bool,
}

impl SseDecoder {
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
            self.line(&line, &mut frames)?;
            if self.done {
                self.bytes.clear();
                break;
            }
        }
        Ok(frames)
    }

    fn finish(&mut self) -> Result<Vec<Bytes>, ProviderError> {
        let mut frames = Vec::new();
        if !self.bytes.is_empty() {
            let mut line = std::mem::take(&mut self.bytes);
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            self.line(&line, &mut frames)?;
        }
        if !self.data.is_empty() || !self.comments.is_empty() {
            self.dispatch(&mut frames)?;
        }
        Ok(frames)
    }

    fn line(&mut self, raw: &[u8], frames: &mut Vec<Bytes>) -> Result<(), ProviderError> {
        let line = std::str::from_utf8(raw).map_err(|_| ProviderError::InvalidResponse)?;
        if line.is_empty() {
            return self.dispatch(frames);
        }
        if let Some(comment) = line.strip_prefix(':') {
            self.event_bytes = self
                .event_bytes
                .checked_add(line.len())
                .ok_or(ProviderError::ResponseTooLarge)?;
            self.comments
                .push(comment.strip_prefix(' ').unwrap_or(comment).to_string());
        } else if let Some(data) = line.strip_prefix("data:") {
            self.event_bytes = self
                .event_bytes
                .checked_add(line.len())
                .ok_or(ProviderError::ResponseTooLarge)?;
            self.data
                .push(data.strip_prefix(' ').unwrap_or(data).to_string());
        }
        if self.event_bytes > MAX_FRAME_BYTES {
            return Err(ProviderError::ResponseTooLarge);
        }
        Ok(())
    }

    fn dispatch(&mut self, frames: &mut Vec<Bytes>) -> Result<(), ProviderError> {
        if self.data.is_empty() && self.comments.is_empty() {
            return Ok(());
        }
        self.event_bytes = 0;
        let mut output = String::new();
        for comment in self.comments.drain(..) {
            output.push(':');
            if !comment.is_empty() {
                output.push(' ');
                output.push_str(&comment);
            }
            output.push('\n');
        }
        if !self.data.is_empty() {
            let multiline = self.data.len() > 1;
            let data = self.data.join("\n");
            self.data.clear();
            if data == "[DONE]" {
                output.push_str("data: [DONE]\n\n");
                self.done = true;
            } else {
                let parsed: Value =
                    serde_json::from_str(&data).map_err(|_| ProviderError::InvalidResponse)?;
                if parsed.get("error").is_some() {
                    return Err(ProviderError::Unavailable);
                }
                output.push_str("data: ");
                if multiline {
                    output.push_str(
                        &serde_json::to_string(&parsed)
                            .map_err(|_| ProviderError::InvalidResponse)?,
                    );
                } else {
                    output.push_str(&data);
                }
                output.push_str("\n\n");
            }
        } else {
            output.push('\n');
        }
        frames.push(Bytes::from(output));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::{future::Future, net::SocketAddr, pin::Pin};

    use futures_util::StreamExt;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    use crate::llm::{
        configuration::{ProviderPriceVersion, ResolvedLlmRoute},
        endpoint::{EndpointResolver, PinnedEndpoint, ProviderKind},
        provider::{GatewayMessage, LlmProviderAdapter, NormalizedProviderRequest},
    };

    use super::{OpenAiAdapter, SseDecoder};

    struct FixedResolver(SocketAddr);

    impl EndpointResolver for FixedResolver {
        fn resolve<'a>(
            &'a self,
            _host: &'a str,
            _port: u16,
        ) -> Pin<
            Box<dyn Future<Output = Result<Vec<SocketAddr>, crate::error::AppError>> + Send + 'a>,
        > {
            Box::pin(async move { Ok(vec![self.0]) })
        }
    }

    async fn mock_response(
        status: &str,
        body: &'static str,
    ) -> (SocketAddr, tokio::task::JoinHandle<String>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let status = status.to_string();
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = vec![0_u8; 16 * 1024];
            let read = socket.read(&mut request).await.unwrap();
            request.truncate(read);
            let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\n\r\n{body}", body.len());
            socket.write_all(response.as_bytes()).await.unwrap();
            String::from_utf8(request).unwrap()
        });
        (address, task)
    }

    async fn route(address: SocketAddr) -> ResolvedLlmRoute {
        ResolvedLlmRoute {
            provider_id: "provider-id".into(),
            model_id: "model-id".into(),
            provider_kind: ProviderKind::OpenAiCompatible,
            secret: None,
            model: "upstream-model".into(),
            prompt_profile_id: None,
            system_prompt: None,
            price_version: ProviderPriceVersion {
                id: "price-id".into(),
                group_id: "group-id".into(),
                provider_id: "provider-id".into(),
                model_id: Some("model-id".into()),
                currency: "USD".into(),
                unit: "perMillionTokens".into(),
                input_cost_micros: 1,
                output_cost_micros: 1,
                created_at: 1,
            },
            endpoint: PinnedEndpoint::resolve(
                ProviderKind::Ollama,
                &format!("http://ollama:{}", address.port()),
                &FixedResolver(address),
            )
            .await
            .unwrap(),
        }
    }

    fn request() -> NormalizedProviderRequest {
        NormalizedProviderRequest {
            messages: vec![GatewayMessage {
                role: "user".into(),
                content: "Hi".into(),
                tool_calls: None,
                tool_call_id: None,
            }],
            tools: Vec::new(),
            think: false,
        }
    }

    #[test]
    fn preserves_delta_comments_multiline_done_and_utf8_across_fragmentation() {
        let input = concat!(
            ": keepalive\r\n\r\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hallö\"}}]}\n\n",
            "data: [DONE]\n\n"
        )
        .as_bytes();
        let mut decoder = SseDecoder::default();
        let mut output = Vec::new();
        for byte in input {
            output.extend(decoder.push(&[*byte]).unwrap());
        }
        let text = output
            .into_iter()
            .map(|part| String::from_utf8(part.to_vec()).unwrap())
            .collect::<String>();
        assert_eq!(
            text,
            concat!(
                ": keepalive\n\n",
                "data: {\"choices\":[{\"delta\":{\"content\":\"Hallö\"}}]}\n\n",
                "data: [DONE]\n\n"
            )
        );
        assert!(decoder.done);
    }

    #[test]
    fn rejects_provider_error_and_oversized_unterminated_frame() {
        let mut decoder = SseDecoder::default();
        assert!(decoder.push(b"data: {\"error\":{}}\n\n").is_err());
        let mut decoder = SseDecoder::default();
        assert!(decoder
            .push(&vec![b'a'; super::MAX_FRAME_BYTES + 1])
            .is_err());
    }

    #[test]
    fn multiline_data_is_normalized_to_one_adapter_compatible_json_line() {
        let mut decoder = SseDecoder::default();
        let output = decoder
            .push(b"data: {\"choices\":\ndata: [{\"delta\":{}}]}\n\n")
            .unwrap()
            .into_iter()
            .map(|part| String::from_utf8(part.to_vec()).unwrap())
            .collect::<String>();
        assert_eq!(output, "data: {\"choices\":[{\"delta\":{}}]}\n\n");
    }

    #[tokio::test]
    async fn pinned_adapter_posts_expected_path_and_preserves_exact_frames() {
        let body = "data: {\"choices\":[{\"delta\":{\"content\":\"Hallo\"}}]}\n\ndata: [DONE]\n\n";
        let (address, server) = mock_response("200 OK", body).await;
        let route = route(address).await;
        let opened = OpenAiAdapter.stream(&route, request()).await.unwrap();
        let output = opened
            .stream
            .map(|part| part.unwrap())
            .collect::<Vec<_>>()
            .await
            .concat();
        assert_eq!(output, body.as_bytes());
        let received = server.await.unwrap();
        assert!(received.starts_with("POST /chat/completions HTTP/1.1\r\n"));
        assert!(received.contains("\"model\":\"upstream-model\""));
    }

    #[tokio::test]
    async fn provider_rate_limit_is_classified_without_reading_or_exposing_body() {
        let (address, server) =
            mock_response("429 Too Many Requests", "secret provider body").await;
        let route = route(address).await;
        let result = OpenAiAdapter.stream(&route, request()).await;
        assert!(matches!(result, Err(super::ProviderError::RateLimited)));
        server.await.unwrap();
    }
}
