#[path = "support/conversation.rs"]
mod conversation_support;
use conversation_support::*;
use mlearn_core::*;
use mlearn_storage::{ProfileStore, StorageError};
use rusqlite::Connection;
use std::sync::{Arc, Barrier};

fn explanation_source() -> SourceAnchor {
    SourceAnchor {
        source_id: "video".into(),
        content_revision: "source-revision".into(),
        package_id: "package".into(),
        package_version: "1".into(),
        text: "untouched source quotation".into(),
        locator: SourceLocator::Video {
            subtitle_revision: Some("subtitle-revision".into()),
            cue_index: Some(0),
            selection_start: 0,
            selection_end: 9,
            position_ms: 10,
            subtitle_offset_ms: 0,
            playback_rate: 1.0,
        },
    }
}

#[test]
fn explanation_admission_replays_one_actual_turn_and_reuses_edited_software_identity() {
    // Given an explicit explanation request with runtime-validated source context.
    let (_dir, mut store, _) = fixture();
    let source = explanation_source();
    let command = ConversationCommand::Explain {
        command_id: "explain".into(),
        source: source.clone(),
        instruction: "Explain this selection".into(),
    };
    let first = match run(&mut store, command.clone()) {
        ConversationResult::Generation { generation } => generation,
        other => panic!("{other:?}"),
    };
    let context = store.conversation_generation_context(&first.id).unwrap();
    assert_eq!(context.conversation.kind, ConversationKind::Thread);
    assert_eq!(context.conversation.package_id, source.package_id);
    assert_eq!(context.messages.len(), 1);
    assert_eq!(context.messages[0].text, "Explain this selection");
    assert_eq!(context.messages[0].sources, vec![source.clone()]);
    let mut assistant = context.participants[0].clone();
    assistant.name = "My assistant".into();
    assistant.description = "User-edited assistant profile".into();
    run(
        &mut store,
        ConversationCommand::SaveContact {
            command_id: "edit-assistant".into(),
            expected_revision: assistant.revision,
            contact: assistant.clone(),
        },
    );
    // When another explanation is admitted and the original action is retried.
    let second = match run(
        &mut store,
        ConversationCommand::Explain {
            command_id: "explain-second".into(),
            source: source.clone(),
            instruction: "A different question".into(),
        },
    ) {
        ConversationResult::Generation { generation } => generation,
        other => panic!("{other:?}"),
    };
    let reused = store.conversation_generation_context(&second.id).unwrap();
    assert_eq!(reused.participants[0].id, assistant.id);
    assert_eq!(reused.participants[0].name, assistant.name);
    assert_eq!(reused.participants[0].description, assistant.description);
    assert_ne!(second.conversation_id, first.conversation_id);
    match run(&mut store, command) {
        ConversationResult::Generation { generation } => assert_eq!(generation.id, first.id),
        other => panic!("{other:?}"),
    }
    // Then no second user turn is invented, and changed payload/archived identity is refused.
    let owner = store.read_conversation(&first.conversation_id).unwrap();
    assert_eq!(page(&mut store, &owner).items.len(), 2);
    assert!(
        store
            .conversation_command(
                &ConversationCommand::Explain {
                    command_id: "explain".into(),
                    source: source.clone(),
                    instruction: "different payload".into(),
                },
                false
            )
            .is_err()
    );
    assistant.revision = reused.participants[0].revision;
    assistant.archived = true;
    run(
        &mut store,
        ConversationCommand::SaveContact {
            command_id: "archive-assistant".into(),
            expected_revision: assistant.revision,
            contact: assistant,
        },
    );
    assert!(
        store
            .conversation_command(
                &ConversationCommand::Explain {
                    command_id: "archived-explanation".into(),
                    source,
                    instruction: "Explain".into(),
                },
                false
            )
            .is_err()
    );
}

#[test]
fn explanation_receipt_failure_rolls_back_contact_thread_messages_and_generation() {
    // Given an injected SQLite failure at the last receipt write.
    let (dir, mut store, _) = fixture();
    let db = Connection::open(dir.path().join("profile.sqlite")).unwrap();
    db.execute_batch("CREATE TRIGGER reject_explanation_receipt BEFORE INSERT ON conversation_receipts WHEN NEW.command_id='rollback-explanation' BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END;").unwrap();
    // When the content owner admits all related explanation state in one action.
    let command = ConversationCommand::Explain {
        command_id: "rollback-explanation".into(),
        source: explanation_source(),
        instruction: "Explain the source".into(),
    };
    assert!(store.conversation_command(&command, false).is_err());
    // Then no related row can escape without its receipt.
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM conversation_contacts WHERE id=?1",
            [CONVERSATION_EXPLANATION_CONTACT_ID],
            |r| r.get::<_, u32>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM conversations", [], |r| r
            .get::<_, u32>(0))
            .unwrap(),
        1
    );
    for table in [
        "conversation_messages",
        "conversation_message_versions",
        "conversation_generations",
        "conversation_generation_inputs",
    ] {
        assert_eq!(
            db.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                .get::<_, u32>(0))
                .unwrap(),
            0
        );
    }
    db.execute_batch("DROP TRIGGER reject_explanation_receipt;")
        .unwrap();
    assert!(matches!(
        run(&mut store, command),
        ConversationResult::Generation { .. }
    ));
}

#[test]
fn version_eight_migration_preserves_existing_profile_rows() {
    // Given genuine existing profile tables/data at the previous schema version.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("profile.sqlite");
    let mut store = ProfileStore::open(&path).unwrap();
    let theme = ThemeDocument {
        name: "preserved".into(),
        ..Default::default()
    };
    store.save_theme(&theme, 0, "theme").unwrap();
    store
        .activate_plugin("package", "{\"version\":\"retained\"}")
        .unwrap();
    drop(store);
    let db = Connection::open(&path).unwrap();
    for table in [
        "conversation_worker_receipts",
        "conversation_receipts",
        "conversation_traces",
        "conversation_generation_contacts",
        "conversation_generation_inputs",
        "conversation_generations",
        "conversation_message_versions",
        "conversation_messages",
        "conversation_drafts",
        "conversation_participants",
        "conversations",
        "conversation_contacts",
        "conversation_provider",
    ] {
        db.execute_batch(&format!("DROP TABLE {table};")).unwrap();
    }
    db.pragma_update(None, "user_version", 8).unwrap();
    db.execute_batch("DROP TABLE view_preference_receipts; DROP TABLE view_preferences;")
        .unwrap();
    drop(db);
    // When the current schema is installed and reopened.
    let store = ProfileStore::open(&path).unwrap();
    // Then unrelated data and receipts remain intact and migration is durable.
    assert_eq!(store.preferences().unwrap().1.name, "preserved");
    assert_eq!(
        store.plugin_manifests().unwrap(),
        vec![("package".into(), "{\"version\":\"retained\"}".into())]
    );
    drop(store);
    let db = Connection::open(&path).unwrap();
    assert_eq!(
        db.pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
            .unwrap(),
        17
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM receipts WHERE command_id='theme'",
            [],
            |r| r.get::<_, u32>(0)
        )
        .unwrap(),
        1
    );
    db.pragma_update(None, "user_version", 18).unwrap();
    drop(db);
    assert!(ProfileStore::open(&path).is_err());
}

#[test]
fn identities_archive_restore_and_direct_conversations_reuse_after_reopen() {
    // Given one durable identity, a direct conversation and a separate Thread.
    let (dir, mut store, thread) = fixture();
    let direct = create(&mut store, "direct", ConversationKind::Direct);
    let mut contact = match run(
        &mut store,
        ConversationCommand::GetContact {
            id: ContactId("person".into()),
        },
    ) {
        ConversationResult::Contact { contact } => contact,
        other => panic!("{other:?}"),
    };
    contact.archived = true;
    run(
        &mut store,
        ConversationCommand::SaveContact {
            command_id: "archive".into(),
            expected_revision: 1,
            contact,
        },
    );
    run(
        &mut store,
        ConversationCommand::SaveDraft {
            command_id: "draft".into(),
            expected_revision: 0,
            draft: ConversationDraft {
                conversation_id: thread.id.clone(),
                revision: 0,
                text: "unfinished".into(),
                reply_to: None,
            },
        },
    );
    drop(store);
    // When the profile reopens without any provider or credential.
    let mut store = ProfileStore::open(&dir.path().join("profile.sqlite")).unwrap();
    let reused = create(&mut store, "another-direct", ConversationKind::Direct);
    // Then contact identity and both independent conversation/draft scopes survive.
    assert_eq!(reused.id, direct.id);
    assert_eq!(
        store.read_conversation(&thread.id).unwrap().participants,
        direct.participants
    );
    match run(
        &mut store,
        ConversationCommand::ListContacts {
            after: None,
            query: "".into(),
            archived: Some(true),
        },
    ) {
        ConversationResult::Contacts { page } => {
            assert_eq!(page.items.len(), 1);
            assert_eq!(page.items[0].revision, 2);
        }
        other => panic!("{other:?}"),
    }
    match run(
        &mut store,
        ConversationCommand::ReadDraft {
            conversation_id: thread.id,
        },
    ) {
        ConversationResult::Draft { draft } => assert_eq!(draft.text, "unfinished"),
        other => panic!("{other:?}"),
    }
    let mut contact = person_get(&mut store);
    contact.archived = false;
    run(
        &mut store,
        ConversationCommand::SaveContact {
            command_id: "restore".into(),
            expected_revision: 2,
            contact,
        },
    );
    assert!(!person_get(&mut store).archived);
}

#[test]
fn concurrent_identical_sends_deduplicate_and_stale_edits_conflict() {
    // Given two independent SQLite connections racing the same command.
    let (dir, store, owner) = fixture();
    drop(store);
    let path = dir.path().join("profile.sqlite");
    let barrier = Arc::new(Barrier::new(2));
    let command = ConversationCommand::SendTurn {
        turn: turn(&owner, "race"),
    };
    let handles: Vec<_> = (0..2)
        .map(|_| {
            let path = path.clone();
            let barrier = barrier.clone();
            let command = command.clone();
            std::thread::spawn(move || {
                let mut store = ProfileStore::open(&path).unwrap();
                barrier.wait();
                store.conversation_command(&command, false).unwrap()
            })
        })
        .collect();
    // When both transactions are admitted concurrently.
    for handle in handles {
        assert!(matches!(
            handle.join().unwrap(),
            ConversationResult::Generation { .. }
        ));
    }
    // Then only one turn exists and a stale authored edit cannot overwrite its successor.
    let mut store = ProfileStore::open(&path).unwrap();
    assert_eq!(page(&mut store, &owner).items.len(), 2);
    let reference = MessageReference {
        id: MessageId("user-race".into()),
        revision: 1,
    };
    run(
        &mut store,
        ConversationCommand::EditMessage {
            command_id: "edit".into(),
            message: reference.clone(),
            text: "corrected".into(),
        },
    );
    let mut second = ProfileStore::open(&path).unwrap();
    assert!(matches!(
        second.conversation_command(
            &ConversationCommand::EditMessage {
                command_id: "stale".into(),
                message: reference,
                text: "lost update".into()
            },
            false
        ),
        Err(StorageError::Conflict)
    ));
    assert_eq!(
        store
            .read_conversation_message(&MessageId("user-race".into()))
            .unwrap()
            .text,
        "corrected"
    );
}

#[test]
fn delete_retains_frozen_source_and_draft_cas_rejects_stale_writes() {
    // Given completed authored text and a per-conversation saved draft.
    let (_dir, mut store, owner) = fixture();
    let generation = send(&mut store, &owner, "delete");
    finish(&mut store, &generation);
    let original = store
        .read_message_version(&generation.user_message_id, 1)
        .unwrap();
    let draft = ConversationDraft {
        conversation_id: owner.id.clone(),
        revision: 0,
        text: "draft".into(),
        reply_to: None,
    };
    run(
        &mut store,
        ConversationCommand::SaveDraft {
            command_id: "draft-one".into(),
            draft: draft.clone(),
            expected_revision: 0,
        },
    );
    // When the authored message is deleted and a stale draft is submitted.
    run(
        &mut store,
        ConversationCommand::DeleteMessage {
            command_id: "delete-one".into(),
            message: MessageReference {
                id: original.id.clone(),
                revision: 1,
            },
        },
    );
    assert!(matches!(
        store.conversation_command(
            &ConversationCommand::SaveDraft {
                command_id: "draft-stale".into(),
                draft,
                expected_revision: 0
            },
            false
        ),
        Err(StorageError::Conflict)
    ));
    // Then tombstone, original frozen source and unoverwritten draft are distinct.
    let current = store.read_conversation_message(&original.id).unwrap();
    assert_eq!(current.status, ConversationContentStatus::Deleted);
    assert!(current.text.is_empty());
    assert_eq!(
        store.read_message_version(&original.id, 1).unwrap(),
        original
    );
    match run(
        &mut store,
        ConversationCommand::ReadDraft {
            conversation_id: owner.id,
        },
    ) {
        ConversationResult::Draft { draft } => {
            assert_eq!(draft.revision, 1);
            assert_eq!(draft.text, "draft");
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn bounded_pages_literal_search_and_trace_chunks_reconstruct_actual_content() {
    // Given more saved content than one list/history page and a multi-row prompt.
    let (_dir, mut store, owner) = fixture();
    for index in 0..31 {
        person(&mut store, &format!("p-{index:02}"));
        create(
            &mut store,
            &format!("t-{index:02}"),
            ConversationKind::Thread,
        );
    }
    for index in 0..22 {
        let current = store.read_conversation(&owner.id).unwrap();
        let generation = send(&mut store, &current, &format!("page-{index:02}"));
        finish(&mut store, &generation);
    }
    let current = store.read_conversation(&owner.id).unwrap();
    let generation = send(&mut store, &current, "trace");
    let actual = "実際の入力".repeat(2000);
    store
        .record_conversation_request(&GenerationRequestRecord {
            command_id: "long-request".into(),
            generation_id: generation.id.clone(),
            prompt: actual.clone(),
            request: actual.clone(),
            started_at_ms: 10.0,
        })
        .unwrap();
    // When bounded pages and trace cursors are followed.
    let first = page(&mut store, &owner);
    assert_eq!(first.items.len(), 40);
    let second = match run(
        &mut store,
        ConversationCommand::ReadMessages {
            conversation_id: owner.id.clone(),
            before: first.next,
            query: "".into(),
        },
    ) {
        ConversationResult::Messages { page } => page,
        other => panic!("{other:?}"),
    };
    assert_eq!(second.items.len(), 6);
    assert!(
        first
            .items
            .iter()
            .all(|a| second.items.iter().all(|b| a.id != b.id))
    );
    let mut after = None;
    let mut prompt = String::new();
    let mut request = String::new();
    loop {
        match run(
            &mut store,
            ConversationCommand::ReadTrace {
                id: generation.id.clone(),
                after,
            },
        ) {
            ConversationResult::Trace { page } => {
                assert!(page.items.len() <= 40);
                for row in page.items {
                    match row.kind {
                        ConversationTraceKind::Prompt => prompt.push_str(&row.content),
                        ConversationTraceKind::Request => request.push_str(&row.content),
                        other => panic!("{other:?}"),
                    }
                }
                after = page.next;
                if after.is_none() {
                    break;
                }
            }
            other => panic!("{other:?}"),
        }
    }
    // Then no actual text is summarized or truncated and list/search bounds hold.
    assert_eq!(prompt, actual);
    assert_eq!(request, actual);
    match run(
        &mut store,
        ConversationCommand::ListContacts {
            after: None,
            query: "".into(),
            archived: None,
        },
    ) {
        ConversationResult::Contacts { page } => {
            assert_eq!(page.items.len(), 30);
            assert!(page.next.is_some());
        }
        other => panic!("{other:?}"),
    }
    match run(
        &mut store,
        ConversationCommand::ListConversations {
            after: None,
            query: "".into(),
        },
    ) {
        ConversationResult::Conversations { page } => {
            assert_eq!(page.items.len(), 30);
            assert!(page.next.is_some());
        }
        other => panic!("{other:?}"),
    }
    match run(
        &mut store,
        ConversationCommand::ReadMessages {
            conversation_id: owner.id,
            before: None,
            query: "%".into(),
        },
    ) {
        ConversationResult::Messages { page } => assert!(page.items.is_empty()),
        other => panic!("{other:?}"),
    }
}

#[test]
fn conversation_previews_are_bounded_original_text_and_do_not_reveal_deleted_content() {
    let (_dir, mut store, owner) = fixture();
    create(&mut store, "empty", ConversationKind::Thread);
    let generation = send(&mut store, &owner, "preview");
    start(&mut store, &generation);
    let text = "🌱".repeat(200);
    store
        .append_conversation_delta(&GenerationDelta {
            command_id: "preview-delta".into(),
            generation_id: generation.id.clone(),
            sequence: 1,
            text: text.clone(),
            at_ms: 11.0,
        })
        .unwrap();
    store
        .finish_conversation_generation(&GenerationFinish {
            command_id: "preview-finish".into(),
            generation_id: generation.id.clone(),
            outcome: GenerationOutcome::Complete { response: text },
            finished_at_ms: 12.0,
        })
        .unwrap();
    let list = |store: &mut ProfileStore| match run(
        store,
        ConversationCommand::ListConversations {
            after: None,
            query: String::new(),
        },
    ) {
        ConversationResult::Conversations { page } => page,
        other => panic!("{other:?}"),
    };
    let page = list(&mut store);
    assert_eq!(page.items.len(), 2);
    assert_eq!(page.previews.len(), 1);
    let preview = &page.previews[0];
    assert_eq!(preview.conversation_id, owner.id);
    assert_eq!(preview.message_id, generation.assistant_message_id);
    assert_eq!(preview.text, "🌱".repeat(160));
    assert_eq!(preview.status, ConversationContentStatus::Complete);
    let original = store
        .read_conversation_message(&preview.message_id)
        .unwrap();
    assert_eq!(preview.created_at_ms, original.created_at_ms);
    run(
        &mut store,
        ConversationCommand::DeleteMessage {
            command_id: "delete-preview".into(),
            message: MessageReference {
                id: original.id,
                revision: original.revision,
            },
        },
    );
    let deleted = list(&mut store);
    assert_eq!(
        deleted.previews[0].status,
        ConversationContentStatus::Deleted
    );
    assert!(deleted.previews[0].text.is_empty());
}

#[test]
fn corrupt_rows_and_oversized_inputs_fail_without_partial_admission() {
    // Given a valid profile and an oversized turn.
    let (dir, mut store, owner) = fixture();
    let mut oversized = turn(&owner, "oversized");
    oversized.text = "x".repeat(CONVERSATION_TEXT_BYTES + 1);
    assert!(
        store
            .conversation_command(&ConversationCommand::SendTurn { turn: oversized }, false)
            .is_err()
    );
    assert!(page(&mut store, &owner).items.is_empty());
    let generation = send(&mut store, &owner, "corrupt");
    let db = Connection::open(dir.path().join("profile.sqlite")).unwrap();
    // When a persisted row's text no longer agrees with its native content hash.
    db.execute(
        "UPDATE conversation_messages SET data=json_set(data,'$.text','tampered') WHERE id=?1",
        [&generation.user_message_id.0],
    )
    .unwrap();
    // Then current reads/context reject corruption rather than exposing invented content.
    assert!(matches!(
        store.read_conversation_message(&generation.user_message_id),
        Err(StorageError::Invalid(_))
    ));
    assert!(
        store
            .conversation_generation_context(&generation.id)
            .is_err()
    );
    db.execute(
        "UPDATE conversation_contacts SET data='not json' WHERE id='person'",
        [],
    )
    .unwrap();
    assert!(
        store
            .conversation_command(
                &ConversationCommand::GetContact {
                    id: ContactId("person".into())
                },
                false
            )
            .is_err()
    );
}

#[test]
fn provider_configuration_and_runtime_only_actions_never_persist_credentials() {
    // Given an ordinary provider configuration save with a session-ready projection.
    let (dir, mut store, _) = fixture();
    let command = ConversationCommand::SaveProviderSettings {
        command_id: "provider".into(),
        expected_revision: 0,
        endpoint: "https://provider.invalid/v1".into(),
        model: "actual-model".into(),
    };
    match store.conversation_command(&command, true).unwrap() {
        ConversationResult::ProviderSettings { settings } => {
            assert!(settings.session_credential_ready)
        }
        other => panic!("{other:?}"),
    }
    let secret = "never-store-this-token";
    // When credential dispatch is attempted at the content boundary and then reopened.
    assert!(
        store
            .conversation_command(
                &ConversationCommand::SetSessionCredential {
                    credential: Some(secret.into())
                },
                false
            )
            .is_err()
    );
    drop(store);
    let mut store = ProfileStore::open(&dir.path().join("profile.sqlite")).unwrap();
    // Then only configuration survives, and readiness reflects this new session.
    match store.conversation_command(&command, false).unwrap() {
        ConversationResult::ProviderSettings { settings } => {
            assert!(!settings.session_credential_ready);
            assert_eq!(settings.model, "actual-model");
        }
        other => panic!("{other:?}"),
    }
    let db = Connection::open(dir.path().join("profile.sqlite")).unwrap();
    let persisted: String = db
        .query_row("SELECT data FROM conversation_provider", [], |r| r.get(0))
        .unwrap();
    assert!(!persisted.contains(secret));
    let receipt: String = db
        .query_row(
            "SELECT result FROM conversation_receipts WHERE command_id='provider'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!receipt.contains("true"));
}
