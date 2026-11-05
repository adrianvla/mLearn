#[path = "support/conversation.rs"]
mod conversation_support;
use conversation_support::*;
use mlearn_core::*;
use mlearn_storage::{ProfileStore, StorageError};
use std::sync::{Arc, Barrier};

#[test]
fn startup_interruption_and_explicit_retry_never_duplicate_the_user_turn() {
    // Given an admitted durable send whose worker was interrupted.
    let (dir, mut store, owner) = fixture();
    let command = ConversationCommand::SendTurn {
        turn: turn(&owner, "one"),
    };
    run(&mut store, command.clone());
    drop(store);
    // When startup explicitly recovers work and the same send is replayed.
    let mut store = ProfileStore::open(&dir.path().join("profile.sqlite")).unwrap();
    assert_eq!(store.interrupt_conversation_generations().unwrap(), 1);
    match run(&mut store, command.clone()) {
        ConversationResult::Generation { generation } => {
            assert_eq!(generation.status, GenerationStatus::Interrupted)
        }
        other => panic!("{other:?}"),
    }
    let retry = ConversationRetry {
        command_id: "retry".into(),
        generation_id: GenerationId("two".into()),
        previous_generation_id: GenerationId("one".into()),
        assistant_message_id: MessageId("assistant-two".into()),
        expected_revision: 2,
    };
    let generation = match run(
        &mut store,
        ConversationCommand::RetryGeneration {
            retry: retry.clone(),
        },
    ) {
        ConversationResult::Generation { generation } => generation,
        other => panic!("{other:?}"),
    };
    finish(&mut store, &generation);
    run(&mut store, ConversationCommand::RetryGeneration { retry });
    // Then retry has one original user, a distinct attempt and actual terminal state.
    let messages = page(&mut store, &owner).items;
    assert_eq!(messages.len(), 3);
    assert_eq!(
        messages
            .iter()
            .filter(|m| m.role == ConversationRole::User)
            .count(),
        1
    );
    assert_eq!(messages[0].status, ConversationContentStatus::Complete);
    assert_eq!(messages[2].text, "User one");
    if let ConversationCommand::SendTurn { mut turn } = command {
        turn.text = "different".into();
        assert!(matches!(
            store.conversation_command(&ConversationCommand::SendTurn { turn }, false),
            Err(StorageError::Invalid(_))
        ));
    }
}

#[test]
fn concurrent_distinct_sends_admit_only_one_active_generation() {
    // Given two connections with the same current conversation revision.
    let (dir, store, owner) = fixture();
    drop(store);
    let path = dir.path().join("profile.sqlite");
    let barrier = Arc::new(Barrier::new(2));
    let handles: Vec<_> = ["a", "b"]
        .into_iter()
        .map(|key| {
            let path = path.clone();
            let barrier = barrier.clone();
            let command = ConversationCommand::SendTurn {
                turn: turn(&owner, key),
            };
            std::thread::spawn(move || {
                let mut store = ProfileStore::open(&path).unwrap();
                barrier.wait();
                store.conversation_command(&command, false)
            })
        })
        .collect();
    // When different turns race for native ownership.
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    // Then exactly one durable user/provisional response pair is admitted.
    assert_eq!(results.iter().filter(|v| v.is_ok()).count(), 1);
    let mut store = ProfileStore::open(&path).unwrap();
    assert_eq!(page(&mut store, &owner).items.len(), 2);
}

#[test]
fn failed_generation_retry_and_exact_success_receipts_survive_reopen() {
    // Given a failed request with actual failure evidence.
    let (dir, mut store, owner) = fixture();
    let failed = send(&mut store, &owner, "failed");
    start(&mut store, &failed);
    store
        .finish_conversation_generation(&GenerationFinish {
            command_id: "failure".into(),
            generation_id: failed.id.clone(),
            outcome: GenerationOutcome::Failed {
                error: "actual provider failure".into(),
            },
            finished_at_ms: 12.0,
        })
        .unwrap();
    let retried = match run(
        &mut store,
        ConversationCommand::RetryGeneration {
            retry: ConversationRetry {
                command_id: "retry-failure".into(),
                generation_id: GenerationId("retry-failed".into()),
                previous_generation_id: failed.id.clone(),
                assistant_message_id: MessageId("assistant-retry-failed".into()),
                expected_revision: 2,
            },
        },
    ) {
        ConversationResult::Generation { generation } => generation,
        other => panic!("{other:?}"),
    };
    start(&mut store, &retried);
    let delta = GenerationDelta {
        command_id: "success-delta".into(),
        generation_id: retried.id.clone(),
        sequence: 1,
        text: "actual response".into(),
        at_ms: 11.0,
    };
    store.append_conversation_delta(&delta).unwrap();
    let success = GenerationFinish {
        command_id: "success".into(),
        generation_id: retried.id.clone(),
        outcome: GenerationOutcome::Complete {
            response: "actual response".into(),
        },
        finished_at_ms: 13.0,
    };
    store.finish_conversation_generation(&success).unwrap();
    drop(store);
    // When exact worker commands are retried after restart.
    let mut store = ProfileStore::open(&dir.path().join("profile.sqlite")).unwrap();
    assert_eq!(
        store.append_conversation_delta(&delta).unwrap().status,
        GenerationStatus::Complete
    );
    assert_eq!(
        store
            .finish_conversation_generation(&success)
            .unwrap()
            .status,
        GenerationStatus::Complete
    );
    // Then no text is duplicated and full actual failure/prompt/response is inspectable.
    let response = store
        .read_message_version(&retried.assistant_message_id, 1)
        .unwrap();
    assert_eq!(response.text, "actual response");
    assert_eq!(page(&mut store, &owner).items.len(), 3);
    match run(
        &mut store,
        ConversationCommand::ReadTrace {
            id: failed.id,
            after: None,
        },
    ) {
        ConversationResult::Trace { page } => {
            assert_eq!(
                page.generation.error.as_deref(),
                Some("actual provider failure")
            );
            assert!(
                page.items
                    .iter()
                    .any(|r| r.kind == ConversationTraceKind::Request)
            );
            assert_eq!(page.inputs.len(), 1);
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn deltas_are_ordered_idempotent_and_partial_text_is_not_complete() {
    // Given an active generation with an actual request.
    let (_dir, mut store, owner) = fixture();
    let generation = send(&mut store, &owner, "stream");
    start(&mut store, &generation);
    let delta = GenerationDelta {
        command_id: "delta-one".into(),
        generation_id: generation.id.clone(),
        sequence: 1,
        text: "part".into(),
        at_ms: 11.0,
    };
    // When actual deltas are replayed, collide or arrive out of order.
    store.append_conversation_delta(&delta).unwrap();
    store.append_conversation_delta(&delta).unwrap();
    let mut collision = delta.clone();
    collision.text = "different".into();
    assert!(store.append_conversation_delta(&collision).is_err());
    let mut out_of_order = delta.clone();
    out_of_order.command_id = "gap".into();
    out_of_order.sequence = 3;
    assert!(matches!(
        store.append_conversation_delta(&out_of_order),
        Err(StorageError::Conflict)
    ));
    let cancelled = run(
        &mut store,
        ConversationCommand::CancelGeneration {
            command_id: "stop".into(),
            id: generation.id.clone(),
        },
    );
    // Then the one partial response stays cancelled, never complete or appendable.
    assert!(matches!(
        cancelled,
        ConversationResult::Generation {
            generation: ConversationGeneration {
                status: GenerationStatus::Cancelled,
                ..
            }
        }
    ));
    let response = store
        .read_conversation_message(&generation.assistant_message_id)
        .unwrap();
    assert_eq!(response.text, "part");
    assert_eq!(response.status, ConversationContentStatus::Cancelled);
    let late = GenerationDelta {
        command_id: "late".into(),
        sequence: 2,
        ..delta
    };
    assert!(matches!(
        store.append_conversation_delta(&late),
        Err(StorageError::Conflict)
    ));
    assert!(
        store
            .finish_conversation_generation(&GenerationFinish {
                command_id: "late-finish".into(),
                generation_id: generation.id,
                outcome: GenerationOutcome::Complete {
                    response: "part".into()
                },
                finished_at_ms: 12.0
            })
            .is_err()
    );
}

#[test]
fn authored_changes_invalidate_transitive_outputs_but_preserve_later_authored_content() {
    // Given two completed dependent turns and a third in-flight generation.
    let (_dir, mut store, owner) = fixture();
    let first = send(&mut store, &owner, "first");
    finish(&mut store, &first);
    let second_owner = store.read_conversation(&owner.id).unwrap();
    let second = send(&mut store, &second_owner, "second");
    finish(&mut store, &second);
    let third_owner = store.read_conversation(&owner.id).unwrap();
    let third = send(&mut store, &third_owner, "third");
    start(&mut store, &third);
    let original = store
        .read_conversation_message(&first.user_message_id)
        .unwrap();
    // When the first user message is corrected.
    let edited = run(
        &mut store,
        ConversationCommand::EditMessage {
            command_id: "correct-first".into(),
            message: MessageReference {
                id: original.id.clone(),
                revision: 1,
            },
            text: "corrected first".into(),
        },
    );
    // Then stale derived outputs are invalid, later authored messages and frozen source remain.
    for generation in [&first, &second, &third] {
        assert_eq!(
            store
                .read_conversation_message(&generation.assistant_message_id)
                .unwrap()
                .status,
            ConversationContentStatus::Invalidated
        );
    }
    assert_eq!(
        store
            .read_conversation_message(&second.user_message_id)
            .unwrap()
            .status,
        ConversationContentStatus::Complete
    );
    assert_eq!(
        store.read_message_version(&original.id, 1).unwrap(),
        original
    );
    match edited {
        ConversationResult::Message { message } => {
            assert_ne!(message.content_revision, original.content_revision);
            assert_eq!(message.created_at_ms, original.created_at_ms);
        }
        other => panic!("{other:?}"),
    }
    assert!(
        store
            .finish_conversation_generation(&GenerationFinish {
                command_id: "stale-publish".into(),
                generation_id: third.id,
                outcome: GenerationOutcome::Complete {
                    response: "wrong".into()
                },
                finished_at_ms: 12.0
            })
            .is_err()
    );
}

#[test]
fn reply_requires_current_same_conversation_revision_and_records_actual_context() {
    // Given an older user message and a separate conversation.
    let (_dir, mut store, owner) = fixture();
    let first = send(&mut store, &owner, "reply-target");
    finish(&mut store, &first);
    let other = create(&mut store, "other", ConversationKind::Thread);
    let reference = MessageReference {
        id: first.user_message_id.clone(),
        revision: 1,
    };
    let mut invalid = turn(&other, "cross-reply");
    invalid.reply_to = Some(reference.clone());
    assert!(matches!(
        store.conversation_command(&ConversationCommand::SendTurn { turn: invalid }, false),
        Err(StorageError::Conflict)
    ));
    // When the reply targets the actual current message in this conversation.
    let current = store.read_conversation(&owner.id).unwrap();
    let mut reply = turn(&current, "reply");
    reply.reply_to = Some(reference.clone());
    let generation = match run(&mut store, ConversationCommand::SendTurn { turn: reply }) {
        ConversationResult::Generation { generation } => generation,
        other => panic!("{other:?}"),
    };
    // Then the durable reply and worker context contain that exact text/revision.
    let context = store
        .conversation_generation_context(&generation.id)
        .unwrap();
    assert!(
        context
            .messages
            .iter()
            .any(|m| m.id == reference.id && m.revision == reference.revision)
    );
    assert_eq!(context.messages.last().unwrap().reply_to, Some(reference));
}

#[test]
fn thread_changes_revoke_publication_and_discard_keeps_frozen_sources_and_people() {
    // Given each supported Thread metadata/participant action during generation.
    for operation in ["rename", "add", "remove", "discard"] {
        let (_dir, mut store, owner) = fixture();
        let second_person = person(&mut store, "other");
        let mut current = owner.clone();
        current.participants.push(second_person.id);
        run(
            &mut store,
            ConversationCommand::UpdateConversation {
                command_id: "add-initial".into(),
                expected_revision: 1,
                conversation: current,
            },
        );
        let current = store.read_conversation(&owner.id).unwrap();
        let generation = send(&mut store, &current, "metadata");
        start(&mut store, &generation);
        let mut current = store.read_conversation(&owner.id).unwrap();
        let original = store
            .read_message_version(&generation.user_message_id, 1)
            .unwrap();
        // When metadata changes or the temporary Thread is discarded.
        let command = match operation {
            "discard" => ConversationCommand::DiscardConversation {
                command_id: "discard".into(),
                id: current.id.clone(),
                expected_revision: current.revision,
            },
            "rename" | "add" | "remove" => {
                match operation {
                    "rename" => current.title = "renamed".into(),
                    "add" => {
                        let p = person(&mut store, "third");
                        current.participants.push(p.id);
                    }
                    "remove" => {
                        current.participants.pop();
                    }
                    _ => unreachable!(),
                }
                ConversationCommand::UpdateConversation {
                    command_id: "change".into(),
                    expected_revision: current.revision,
                    conversation: current,
                }
            }
            _ => unreachable!(),
        };
        run(&mut store, command);
        // Then stale publication is refused without deleting People/frozen Capture text.
        assert!(
            store
                .conversation_generation_context(&generation.id)
                .is_err()
        );
        assert_eq!(
            store
                .read_message_version(&generation.user_message_id, 1)
                .unwrap(),
            original
        );
        assert_eq!(person_get(&mut store).id, owner.participants[0]);
        if operation == "discard" {
            let tombstone = store
                .read_conversation_message(&generation.user_message_id)
                .unwrap();
            assert!(tombstone.text.is_empty());
            assert_eq!(tombstone.status, ConversationContentStatus::Deleted);
        }
    }
}
