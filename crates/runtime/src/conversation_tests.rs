use crate::{Runtime, RuntimeExecutor};
use mlearn_core::*;
use mlearn_language_host::CodePolicy;
use std::{sync::mpsc, thread::JoinHandle, time::Duration};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn action(runtime: &RuntimeExecutor, command: ConversationCommand) -> ConversationResult {
    let response: Response = serde_json::from_str(
        &runtime.execute(&serde_json::to_string(&Request::Conversation { command }).unwrap()),
    )
    .unwrap();
    match response {
        Response::Conversation { result } => result,
        other => panic!("Unexpected native response: {other:?}"),
    }
}

fn conversation(runtime: &RuntimeExecutor) -> Conversation {
    match action(
        runtime,
        ConversationCommand::GetConversation {
            id: ConversationId("native-conversation".into()),
        },
    ) {
        ConversationResult::Conversation { conversation } => conversation,
        other => panic!("{other:?}"),
    }
}

fn messages(runtime: &RuntimeExecutor) -> Vec<ConversationMessage> {
    match action(
        runtime,
        ConversationCommand::ReadMessages {
            conversation_id: ConversationId("native-conversation".into()),
            before: None,
            query: String::new(),
        },
    ) {
        ConversationResult::Messages { page } => page.items,
        other => panic!("{other:?}"),
    }
}

fn seed(runtime: &RuntimeExecutor, endpoint: &str) {
    action(
        runtime,
        ConversationCommand::SaveContact {
            command_id: "native-person".into(),
            expected_revision: 0,
            contact: Contact {
                id: ContactId("person".into()),
                revision: 0,
                name: "Conversation partner".into(),
                description: "Answer the actual question.".into(),
                archived: false,
            },
        },
    );
    action(
        runtime,
        ConversationCommand::CreateConversation {
            command_id: "native-thread".into(),
            conversation: Conversation {
                id: ConversationId("native-conversation".into()),
                revision: 0,
                kind: ConversationKind::Thread,
                title: "Native integration".into(),
                purpose: "Read and discuss the source".into(),
                package_id: "org.mlearn.english".into(),
                participants: vec![ContactId("person".into())],
                discarded: false,
            },
        },
    );
    action(
        runtime,
        ConversationCommand::SaveProviderSettings {
            command_id: "native-provider".into(),
            expected_revision: 0,
            endpoint: endpoint.into(),
            model: "actual-fixture".into(),
        },
    );
    action(
        runtime,
        ConversationCommand::SetSessionCredential {
            credential: Some("private-session-key".into()),
        },
    );
}

fn turn(runtime: &RuntimeExecutor) -> ConversationTurn {
    ConversationTurn {
        command_id: "native-send-once".into(),
        conversation_id: ConversationId("native-conversation".into()),
        expected_revision: conversation(runtime).revision,
        user_message_id: MessageId("native-user".into()),
        assistant_message_id: MessageId("native-answer".into()),
        generation_id: GenerationId("native-generation".into()),
        participant_id: ContactId("person".into()),
        text: "Tell me about this sentence.".into(),
        reply_to: None,
        sources: vec![],
    }
}

fn wait(receiver: tokio::sync::oneshot::Receiver<()>) {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            tokio::time::timeout(Duration::from_secs(10), receiver)
                .await
                .unwrap()
                .unwrap()
        });
}

struct HttpResponse {
    text: &'static str,
    hold: bool,
}

fn server(responses: Vec<HttpResponse>) -> (String, mpsc::Receiver<String>, JoinHandle<()>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
    let (requests, received) = mpsc::sync_channel(responses.len());
    let handle = std::thread::spawn(move || {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
            let listener = tokio::net::TcpListener::from_std(listener).unwrap();
            for response in responses {
                let (mut socket, _) = tokio::time::timeout(Duration::from_secs(10), listener.accept()).await.unwrap().unwrap();
                let mut bytes = Vec::new();
                let header_end = loop {
                    let mut buffer = [0; 4096];
                    let count = tokio::time::timeout(Duration::from_secs(10), socket.read(&mut buffer)).await.unwrap().unwrap();
                    assert_ne!(count, 0);
                    bytes.extend_from_slice(&buffer[..count]);
                    if let Some(end) = bytes.windows(4).position(|value| value == b"\r\n\r\n") {
                        break end + 4;
                    }
                    assert!(bytes.len() <= 16_384);
                };
                let headers = String::from_utf8(bytes[..header_end].to_vec()).unwrap();
                let length: usize = headers.lines().find_map(|line| {
                    line.to_ascii_lowercase().strip_prefix("content-length:")
                        .map(|length| length.trim().parse().unwrap())
                }).unwrap();
                assert!(length <= 131_072);
                while bytes.len() < header_end + length {
                    let mut buffer = [0; 4096];
                    let count = tokio::time::timeout(Duration::from_secs(10), socket.read(&mut buffer)).await.unwrap().unwrap();
                    assert_ne!(count, 0);
                    bytes.extend_from_slice(&buffer[..count]);
                }
                requests.send(String::from_utf8(bytes).unwrap()).unwrap();
                let frame = serde_json::json!({"choices":[{
                    "index":0, "delta":{"content":response.text},
                    "finish_reason":if response.hold { None } else { Some("stop") }
                }]});
                let body = format!("data: {frame}\n\n{}", if response.hold { "" } else { "data: [DONE]\n\n" });
                let length = if response.hold { String::new() } else { format!("Content-Length: {}\r\n", body.len()) };
                socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n{length}Connection: close\r\n\r\n{body}").as_bytes()).await.unwrap();
                if response.hold {
                    let mut byte = [0; 1];
                    assert_eq!(tokio::time::timeout(Duration::from_secs(10), socket.read(&mut byte)).await.unwrap().unwrap(), 0);
                }
            }
        });
    });
    (endpoint, received, handle)
}

#[test]
fn native_generation_trace_analysis_capture_and_frozen_return_survive_edits_and_restart() {
    let (directory, runtime, _) = crate::watch::source_execution_tests::fixture();
    let (endpoint, requests, server) = server(vec![HttpResponse {
        text: "Children walked home.",
        hold: false,
    }]);
    seed(&runtime, &endpoint);
    let turn = turn(&runtime);
    let (published, finished) = runtime.observe_generation();
    let admitted = action(
        &runtime,
        ConversationCommand::SendTurn { turn: turn.clone() },
    );
    assert!(matches!(admitted, ConversationResult::Generation { .. }));
    wait(published);
    wait(finished);
    server.join().unwrap();
    let sent = requests.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(sent.contains("private-session-key"));
    assert!(sent.contains(&turn.text));
    let page = messages(&runtime);
    assert_eq!(page.len(), 2);
    let answer = page
        .iter()
        .find(|message| message.role == ConversationRole::Assistant)
        .unwrap();
    assert_eq!(answer.status, ConversationContentStatus::Complete);
    assert_eq!(answer.text, "Children walked home.");
    let trace = match action(
        &runtime,
        ConversationCommand::ReadTrace {
            id: turn.generation_id.clone(),
            after: None,
        },
    ) {
        ConversationResult::Trace { page } => page,
        other => panic!("{other:?}"),
    };
    assert_eq!(trace.generation.status, GenerationStatus::Complete);
    assert!(
        trace
            .items
            .iter()
            .all(|row| !row.content.contains("private-session-key"))
    );
    assert!(
        trace
            .items
            .iter()
            .any(|row| row.kind == ConversationTraceKind::Request
                && row.content.contains(&endpoint)
                && row.content.contains(&turn.text))
    );
    let batch = match action(
        &runtime,
        ConversationCommand::AnalyzeVisibleMessages {
            conversation_id: answer.conversation_id.clone(),
            messages: vec![MessageReference {
                id: answer.id.clone(),
                revision: answer.revision,
            }],
        },
    ) {
        ConversationResult::Analysis { batch } => batch,
        other => panic!("{other:?}"),
    };
    assert_eq!(batch.messages[0].text, answer.text);
    let token = batch.messages[0]
        .tokens
        .iter()
        .find(|token| !token.targets.is_empty())
        .unwrap();
    let anchor = SourceAnchor {
        source_id: answer.conversation_id.0.clone(),
        content_revision: answer.content_revision.clone(),
        package_id: batch.package_id.clone(),
        package_version: batch.package_version.clone(),
        text: answer.text.clone(),
        locator: SourceLocator::Message {
            conversation_id: answer.conversation_id.clone(),
            message_id: answer.id.clone(),
            message_revision: answer.revision,
            context_start: 0,
            selection_start: token.start,
            selection_end: token.end,
        },
    };
    let command = MaterialCreate {
        command_id: "native-message-capture".into(),
        distinct: false,
        media_imports: vec![],
        content: MaterialContent {
            package_id: batch.package_id,
            target_id: Some(token.targets[0].clone()),
            package_revision: Some(batch.package_revision),
            sense: None,
            phrase: token.text.clone(),
            reading: String::new(),
            meaning: String::new(),
            context: answer.text.clone(),
            notes: String::new(),
            examples: vec![],
            source: Some(anchor.clone()),
            attachments: vec![],
        },
    };
    let captured: Response = serde_json::from_str(
        &runtime.execute(
            &serde_json::to_string(&Request::CreateMaterial {
                command: command.clone(),
            })
            .unwrap(),
        ),
    )
    .unwrap();
    let Response::MaterialWritten {
        outcome: MaterialWriteResult::Saved { material, .. },
    } = captured
    else {
        panic!("{captured:?}");
    };
    let user = page
        .iter()
        .find(|message| message.role == ConversationRole::User)
        .unwrap();
    action(
        &runtime,
        ConversationCommand::EditMessage {
            command_id: "correct-user".into(),
            message: MessageReference {
                id: user.id.clone(),
                revision: user.revision,
            },
            text: "An independently corrected question.".into(),
        },
    );
    let mut stale = command;
    stale.command_id = "stale-message-capture".into();
    let rejected: Response = serde_json::from_str(
        &runtime
            .execute(&serde_json::to_string(&Request::CreateMaterial { command: stale }).unwrap()),
    )
    .unwrap();
    assert!(matches!(rejected, Response::Error { .. }));
    let historical = action(
        &runtime,
        ConversationCommand::AnalyzeMessageSource {
            source: anchor.clone(),
        },
    );
    let ConversationResult::Analysis { batch: historical } = historical else {
        panic!("The immutable original must remain available to source inspection");
    };
    assert_eq!(historical.messages[0].text, answer.text);
    assert_eq!(
        historical.messages[0].content_revision,
        answer.content_revision
    );
    let live: Response = serde_json::from_str(
        &runtime.execute(
            &serde_json::to_string(&Request::Conversation {
                command: ConversationCommand::AnalyzeVisibleMessages {
                    conversation_id: answer.conversation_id.clone(),
                    messages: vec![MessageReference {
                        id: answer.id.clone(),
                        revision: answer.revision,
                    }],
                },
            })
            .unwrap(),
        ),
    )
    .unwrap();
    assert!(matches!(live, Response::Error { .. }));
    let mut forged = anchor.clone();
    forged.content_revision = "f".repeat(64);
    let rejected: Response = serde_json::from_str(
        &runtime.execute(
            &serde_json::to_string(&Request::Conversation {
                command: ConversationCommand::AnalyzeMessageSource { source: forged },
            })
            .unwrap(),
        ),
    )
    .unwrap();
    assert!(matches!(rejected, Response::Error { .. }));
    drop(runtime);
    let reopened = RuntimeExecutor::new(
        Runtime::open(
            &directory.path().join("profile"),
            CodePolicy::MobileBundled,
            None,
            vec![],
        )
        .unwrap(),
    );
    let result: Response = serde_json::from_str(&reopened.execute(
        &serde_json::to_string(&Request::ReturnMaterialSource { id: material.id }).unwrap(),
    ))
    .unwrap();
    let Response::ConversationMaterialSource {
        message,
        anchor: returned,
        ..
    } = result
    else {
        panic!("{result:?}");
    };
    assert_eq!(returned, anchor);
    assert_eq!(message.text, answer.text);
    assert_eq!(message.status, ConversationContentStatus::Complete);
    assert!(
        matches!(action(&reopened, ConversationCommand::ReadProviderSettings),
        ConversationResult::ProviderSettings { settings } if !settings.session_credential_ready)
    );
}

#[test]
fn native_cancel_releases_network_then_retry_reuses_one_user_message() {
    let (_directory, runtime, _) = crate::watch::source_execution_tests::fixture();
    let (endpoint, requests, server) = server(vec![
        HttpResponse {
            text: "Partial actual answer",
            hold: true,
        },
        HttpResponse {
            text: "Recovered actual answer",
            hold: false,
        },
    ]);
    seed(&runtime, &endpoint);
    let turn = turn(&runtime);
    let (published, finished) = runtime.observe_generation();
    action(
        &runtime,
        ConversationCommand::SendTurn { turn: turn.clone() },
    );
    wait(published);
    // Network I/O owns no runtime/guest lock: ordinary reads are admitted while
    // this actual response remains pending on the server.
    let snapshot: Response =
        serde_json::from_str(&runtime.execute(r#"{"type":"snapshot"}"#)).unwrap();
    assert!(matches!(snapshot, Response::Snapshot { .. }));
    let cancelled = action(
        &runtime,
        ConversationCommand::CancelGeneration {
            command_id: "stop-native".into(),
            id: turn.generation_id.clone(),
        },
    );
    assert!(
        matches!(cancelled, ConversationResult::Generation { generation }
        if generation.status == GenerationStatus::Cancelled)
    );
    wait(finished);
    let (published, finished) = runtime.observe_generation();
    let retried = action(
        &runtime,
        ConversationCommand::RetryGeneration {
            retry: ConversationRetry {
                command_id: "retry-native".into(),
                generation_id: GenerationId("native-retry".into()),
                previous_generation_id: turn.generation_id,
                assistant_message_id: MessageId("native-retry-answer".into()),
                expected_revision: conversation(&runtime).revision,
            },
        },
    );
    assert!(matches!(retried, ConversationResult::Generation { .. }));
    wait(published);
    wait(finished);
    server.join().unwrap();
    assert!(
        requests
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .contains(&turn.text)
    );
    assert!(
        requests
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .contains(&turn.text)
    );
    let page = messages(&runtime);
    assert_eq!(
        page.iter()
            .filter(|message| message.role == ConversationRole::User)
            .count(),
        1
    );
    assert!(page.iter().any(
        |message| message.status == ConversationContentStatus::Cancelled
            && message.text == "Partial actual answer"
    ));
    assert!(page.iter().any(
        |message| message.status == ConversationContentStatus::Complete
            && message.text == "Recovered actual answer"
    ));
}

#[test]
fn editing_an_external_message_origin_stops_its_pending_explanation() {
    let (_directory, runtime, source) = crate::watch::source_execution_tests::fixture();
    let (endpoint, _requests, server) = server(vec![
        HttpResponse {
            text: "Children walked home.",
            hold: false,
        },
        HttpResponse {
            text: "Older explanation",
            hold: true,
        },
    ]);
    seed(&runtime, &endpoint);
    let turn = turn(&runtime);
    let (published, finished) = runtime.observe_generation();
    action(&runtime, ConversationCommand::SendTurn { turn });
    wait(published);
    wait(finished);
    let page = messages(&runtime);
    let original = page
        .iter()
        .find(|message| message.role == ConversationRole::Assistant)
        .unwrap();
    let (published, finished) = runtime.observe_generation();
    let explanation = match action(
        &runtime,
        ConversationCommand::Explain {
            command_id: "explain-original-message".into(),
            source: SourceAnchor {
                source_id: original.conversation_id.0.clone(),
                content_revision: original.content_revision.clone(),
                package_id: source.package_id,
                package_version: source.package_version,
                text: original.text.clone(),
                locator: SourceLocator::Message {
                    conversation_id: original.conversation_id.clone(),
                    message_id: original.id.clone(),
                    message_revision: original.revision,
                    context_start: 0,
                    selection_start: 0,
                    selection_end: 8,
                },
            },
            instruction: "Explain the selected word in this actual sentence.".into(),
        },
    ) {
        ConversationResult::Generation { generation } => generation,
        other => panic!("{other:?}"),
    };
    wait(published);
    let user = page
        .iter()
        .find(|message| message.role == ConversationRole::User)
        .unwrap();
    action(
        &runtime,
        ConversationCommand::EditMessage {
            command_id: "change-explanation-origin".into(),
            message: MessageReference {
                id: user.id.clone(),
                revision: user.revision,
            },
            text: "A corrected originating question.".into(),
        },
    );
    let current = action(
        &runtime,
        ConversationCommand::ReadGeneration { id: explanation.id },
    );
    assert!(
        matches!(current, ConversationResult::Generation { generation }
        if generation.status == GenerationStatus::Failed),
        "Changing the actual source must terminate linked explanation publication"
    );
    wait(finished);
    server.join().unwrap();
}
