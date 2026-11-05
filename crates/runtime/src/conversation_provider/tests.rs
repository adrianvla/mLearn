use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn frame(content: &str, reason: Option<&str>) -> String {
    format!(
        "data: {}\r\n\r\n",
        serde_json::json!({"choices":[{"index":0,"delta":{"content":content},"finish_reason":reason}]})
    )
}

#[test]
fn fragmented_events_preserve_unicode_and_publish_only_actual_deltas() {
    let input = format!(
        ": heartbeat\r\n\r\n{}{}data: [DONE]\r\n\r\n",
        frame("日本", None),
        frame("語", Some("stop"))
    );
    let mut events = Events::default();
    let mut published = String::new();
    for byte in input.as_bytes() {
        events
            .push(&[*byte], &mut |text| {
                published.push_str(text);
                Ok(())
            })
            .unwrap();
    }
    assert!(events.done);
    assert_eq!(events.text, "日本語");
    assert_eq!(published, events.text);
}

#[test]
fn incomplete_refused_tool_and_oversized_output_never_become_complete() {
    for (input, expected) in [
        ("data: [DONE]\n\n".to_owned(), ProviderError::Incomplete),
        (frame("partial", Some("length")), ProviderError::Truncated),
        (frame("", Some("content_filter")), ProviderError::Refused),
        (frame("", Some("tool_calls")), ProviderError::Tool),
        (frame(&"x".repeat(MAX_TEXT + 1), None), ProviderError::Limit),
        ("data: {invalid}\n\n".to_owned(), ProviderError::Protocol),
    ] {
        let mut events = Events::default();
        assert_eq!(
            events.push(input.as_bytes(), &mut |_| Ok(())),
            Err(expected)
        );
        assert!(!events.done);
    }
    let mut events = Events::default();
    assert_eq!(
        events.push(&vec![b'x'; MAX_EVENT + 1], &mut |_| Ok(())),
        Err(ProviderError::Limit)
    );
    let mut events = Events::default();
    assert_eq!(
        events.push(&vec![b'x'; MAX_RESPONSE + 1], &mut |_| Ok(())),
        Err(ProviderError::Limit)
    );
}

#[test]
fn configuration_never_admits_credentials_in_urls_or_trace_body() {
    let messages = [ChatMessage {
        role: ChatRole::User,
        content: "Hello".into(),
    }];
    for base in [
        "file:///private/data",
        "https://secret@example.com/v1",
        "https://example.com/v1?api_key=secret",
        "https://example.com/v1#secret",
    ] {
        assert!(matches!(
            prepare(base, "model", &messages, None),
            Err(ProviderError::Configuration)
        ));
    }
    let request = prepare(
        "http://127.0.0.1:11434/v1/",
        "model",
        &messages,
        Some("private-key".into()),
    )
    .unwrap();
    assert_eq!(
        request.endpoint.as_str(),
        "http://127.0.0.1:11434/v1/chat/completions"
    );
    assert!(!request.body.contains("private-key"));
    let body: serde_json::Value = serde_json::from_str(&request.body).unwrap();
    assert_eq!(body["messages"][0]["content"], "Hello");
    assert_eq!(body["stream"], true);
}

async fn serve(listener: tokio::net::TcpListener, response: String) -> String {
    let (mut socket, _) = tokio::time::timeout(Duration::from_secs(5), listener.accept())
        .await
        .unwrap()
        .unwrap();
    let mut bytes = Vec::new();
    let header_end = loop {
        let mut buffer = [0; 1024];
        let count = tokio::time::timeout(Duration::from_secs(5), socket.read(&mut buffer))
            .await
            .unwrap()
            .unwrap();
        assert_ne!(count, 0);
        bytes.extend_from_slice(&buffer[..count]);
        if let Some(end) = bytes.windows(4).position(|value| value == b"\r\n\r\n") {
            break end + 4;
        }
        assert!(bytes.len() < 16_384);
    };
    let headers = String::from_utf8(bytes[..header_end].to_vec()).unwrap();
    let length: usize = headers
        .lines()
        .find_map(|line| {
            line.to_ascii_lowercase()
                .strip_prefix("content-length:")
                .map(|value| value.trim().parse().unwrap())
        })
        .unwrap();
    while bytes.len() < header_end + length {
        let mut buffer = [0; 1024];
        let count = tokio::time::timeout(Duration::from_secs(5), socket.read(&mut buffer))
            .await
            .unwrap()
            .unwrap();
        assert_ne!(count, 0);
        bytes.extend_from_slice(&buffer[..count]);
    }
    socket.write_all(response.as_bytes()).await.unwrap();
    String::from_utf8(bytes).unwrap()
}

#[tokio::test]
async fn actual_http_stream_rejects_disconnect_and_preserves_completed_text() {
    for complete in [false, true] {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}/v1", listener.local_addr().unwrap());
        let body = if complete {
            format!("{}data: [DONE]\n\n", frame("Actual response", Some("stop")))
        } else {
            frame("Partial response", None)
        };
        let wire = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let server = serve(listener, wire);
        let request = prepare(
            &base,
            "fixture-model",
            &[ChatMessage {
                role: ChatRole::User,
                content: "Actual prompt".into(),
            }],
            Some("test-secret".into()),
        )
        .unwrap();
        let (_cancel, receiver) = watch::channel(false);
        let mut published = String::new();
        let client = stream(&request, receiver, |text| {
            published.push_str(text);
            Ok(())
        });
        let (sent, result) = tokio::join!(server, client);
        assert!(sent.starts_with("POST /v1/chat/completions HTTP/1.1"));
        assert!(sent.contains("Actual prompt"));
        if complete {
            assert_eq!(result.unwrap(), "Actual response");
        } else {
            assert_eq!(result, Err(ProviderError::Incomplete));
        }
        assert!(!published.is_empty());
    }
}

#[tokio::test]
async fn cancellation_after_actual_delta_releases_the_pending_http_read() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/v1", listener.local_addr().unwrap());
    let (cancel, receiver) = watch::channel(false);
    let (released, release) = tokio::sync::oneshot::channel();
    let server = async {
        let (mut socket, _) = tokio::time::timeout(Duration::from_secs(5), listener.accept())
            .await
            .unwrap()
            .unwrap();
        let mut buffer = [0; 8192];
        assert!(socket.read(&mut buffer).await.unwrap() > 0);
        let body = frame("Started", None);
        socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n{body}").as_bytes()).await.unwrap();
        tokio::time::timeout(Duration::from_secs(5), release)
            .await
            .unwrap()
            .unwrap();
    };
    let client = async {
        let request = prepare(
            &base,
            "fixture",
            &[ChatMessage {
                role: ChatRole::User,
                content: "Hello".into(),
            }],
            None,
        )
        .unwrap();
        let result = stream(&request, receiver, |text| {
            assert_eq!(text, "Started");
            cancel.send(true).unwrap();
            Ok(())
        })
        .await;
        released.send(()).unwrap();
        result
    };
    let (_, result) = tokio::join!(server, client);
    assert_eq!(result, Err(ProviderError::Cancelled));
}
