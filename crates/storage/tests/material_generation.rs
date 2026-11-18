use mlearn_core::*;
use mlearn_storage::{ProfileStore, StorageError};
use rusqlite::Connection;

fn source() -> SourceAnchor {
    SourceAnchor {
        source_id: "document-one".into(),
        content_revision: "content-v1".into(),
        package_id: "example.language".into(),
        package_version: "v1".into(),
        text: "猫と猫".into(),
        locator: SourceLocator::Document {
            parser_revision: "parser-v1".into(),
            resource: "text".into(),
            block_id: "block-one".into(),
            context_start: 0,
            selection_start: 0,
            selection_end: 9,
        },
    }
}

fn admit(store: &mut ProfileStore, basis: MaterialGenerationBasis) -> ConversationGeneration {
    match store
        .conversation_command(
            &ConversationCommand::GenerateMaterial {
                command: MaterialGenerationStart {
                    command_id: "generate".into(),
                    basis,
                    instruction: "Propose useful examples.".into(),
                    maximum: 4,
                },
            },
            false,
        )
        .unwrap()
    {
        ConversationResult::Generation { generation } => generation,
        other => panic!("Expected generation: {other:?}"),
    }
}

fn finish(
    store: &mut ProfileStore,
    generation: &ConversationGeneration,
    output: &str,
    failed: bool,
) {
    store
        .record_conversation_request(&GenerationRequestRecord {
            command_id: "request".into(),
            generation_id: generation.id.clone(),
            prompt: "storage fixture".into(),
            request: "fixture request".into(),
            started_at_ms: 10.0,
        })
        .unwrap();
    store
        .append_conversation_delta(&GenerationDelta {
            command_id: "delta".into(),
            generation_id: generation.id.clone(),
            sequence: 1,
            text: output.into(),
            at_ms: 11.0,
        })
        .unwrap();
    store
        .finish_conversation_generation(&GenerationFinish {
            command_id: "finish".into(),
            generation_id: generation.id.clone(),
            finished_at_ms: 12.0,
            outcome: if failed {
                GenerationOutcome::Failed {
                    error: "Provider disconnected".into(),
                }
            } else {
                GenerationOutcome::Complete {
                    response: output.into(),
                }
            },
        })
        .unwrap();
}

#[test]
fn partial_generation_collects_only_literal_utf8_occurrences_and_retry_keeps_original_inputs() {
    // Given genuine stored generation output containing valid, malformed and ungrounded candidates.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("profile");
    let mut store = ProfileStore::open(&path).unwrap();
    let generation = admit(
        &mut store,
        MaterialGenerationBasis::Source { source: source() },
    );
    assert!(store.collect_material_generation(&generation.id).is_err());
    let output = concat!(
        "{\"quote\":\"猫\",\"occurrence\":0,\"reading\":\"\",\"meaning\":\"cat\",\"notes\":\"\",\"examples\":[\"A cat rests.\"]}\n",
        "not JSON\n",
        "{\"quote\":\"absent\",\"reading\":\"\",\"meaning\":\"\",\"notes\":\"\",\"examples\":[]}\n",
        "{\"quote\":\"猫\",\"occurrence\":1,\"reading\":\"\",\"meaning\":\"cat\",\"notes\":\"\",\"examples\":[]}",
    );
    finish(&mut store, &generation, output, true);
    // When complete lines from the failed response are explicitly collected for review.
    let report = store.collect_material_generation(&generation.id).unwrap();
    // Then valid proposals retain exact original occurrences, without admitting Material or evidence.
    assert!(report.collected);
    assert_eq!(report.generation.status, GenerationStatus::Failed);
    assert_eq!(report.proposal_ids.len(), 2);
    assert_eq!(report.errors.len(), 2);
    for (index, key) in report.proposal_ids.iter().enumerate() {
        let proposal = store.material_proposal(key).unwrap();
        assert_eq!(proposal.generation_id, Some(generation.id.clone()));
        assert_eq!(proposal.state, MaterialProposalState::Pending);
        assert_eq!(proposal.content.phrase, "猫");
        let anchor = proposal.content.source.unwrap();
        assert_eq!(anchor.text, "猫と猫");
        let SourceLocator::Document {
            selection_start,
            selection_end,
            ..
        } = anchor.locator
        else {
            panic!("Expected original document provenance");
        };
        assert_eq!(
            (selection_start, selection_end),
            if index == 0 { (0, 3) } else { (6, 9) }
        );
    }
    let db = Connection::open(&path).unwrap();
    assert_eq!(
        db.query_row::<u32, _, _>("SELECT COUNT(*) FROM materials", [], |row| row.get(0))
            .unwrap(),
        0
    );
    assert_eq!(
        db.query_row::<u32, _, _>(
            "SELECT revision FROM knowledge_revision WHERE id=1",
            [],
            |row| row.get(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(
        store.collect_material_generation(&generation.id).unwrap(),
        report
    );
    let conversation = store
        .read_conversation(&generation.conversation_id)
        .unwrap();
    let retried = match store
        .conversation_command(
            &ConversationCommand::RetryGeneration {
                retry: ConversationRetry {
                    command_id: "retry".into(),
                    generation_id: GenerationId("retried-generation".into()),
                    previous_generation_id: generation.id.clone(),
                    assistant_message_id: MessageId("retried-answer".into()),
                    expected_revision: conversation.revision,
                },
            },
            false,
        )
        .unwrap()
    {
        ConversationResult::Generation { generation } => generation,
        other => panic!("Expected retry: {other:?}"),
    };
    let pending = store.material_generation(&retried.id).unwrap();
    assert!(!pending.collected);
    assert!(pending.proposal_ids.is_empty());
    assert_eq!(
        store.material_generation_basis(&retried.id).unwrap(),
        Some(MaterialGenerationBasis::Source { source: source() })
    );
    drop(store);
    let mut store = ProfileStore::open(&path).unwrap();
    assert_eq!(store.interrupt_conversation_generations().unwrap(), 1);
    let interrupted = store.collect_material_generation(&retried.id).unwrap();
    assert_eq!(interrupted.generation.status, GenerationStatus::Interrupted);
    assert!(interrupted.proposal_ids.is_empty());
    assert_eq!(store.material_generation(&generation.id).unwrap(), report);
}

#[test]
fn failed_collection_rolls_back_all_drafts_and_replay_restores_one_atomic_report() {
    // Given completed output and a fault at the final collection report write.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("profile");
    let mut store = ProfileStore::open(&path).unwrap();
    let generation = admit(
        &mut store,
        MaterialGenerationBasis::Source { source: source() },
    );
    finish(
        &mut store,
        &generation,
        "{\"quote\":\"猫\",\"reading\":\"\",\"meaning\":\"cat\",\"notes\":\"\",\"examples\":[]}",
        false,
    );
    let db = Connection::open(&path).unwrap();
    db.execute_batch(
        "CREATE TRIGGER fail_collection BEFORE UPDATE ON material_generations
        WHEN json_extract(NEW.document,'$.collected')=1
        BEGIN SELECT RAISE(ABORT,'injected collection failure'); END;",
    )
    .unwrap();
    // When collection fails after preparing its proposals, then retries after recovery.
    assert!(store.collect_material_generation(&generation.id).is_err());
    assert!(!store.material_generation(&generation.id).unwrap().collected);
    assert_eq!(
        db.query_row::<u32, _, _>("SELECT COUNT(*) FROM material_proposals", [], |row| row
            .get(0))
            .unwrap(),
        0
    );
    assert_eq!(
        db.query_row::<u32, _, _>(
            "SELECT COUNT(*) FROM material_proposal_receipts",
            [],
            |row| row.get(0)
        )
        .unwrap(),
        0
    );
    db.execute_batch("DROP TRIGGER fail_collection;").unwrap();
    let committed = store.collect_material_generation(&generation.id).unwrap();
    drop(store);
    let mut store = ProfileStore::open(&path).unwrap();
    // Then one recoverable report and one proposal survive without a second admission.
    assert_eq!(committed.proposal_ids.len(), 1);
    assert_eq!(
        store.collect_material_generation(&generation.id).unwrap(),
        committed
    );
    assert_eq!(
        db.query_row::<u32, _, _>("SELECT COUNT(*) FROM material_proposals", [], |row| row
            .get(0))
            .unwrap(),
        1
    );
}

#[test]
fn changed_material_and_cancelled_work_cannot_publish_proposal_drafts() {
    // Given a completed generation grounded in one authored revision.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile")).unwrap();
    let content = MaterialContent {
        package_id: "example.language".into(),
        target_id: None,
        package_revision: None,
        sense: None,
        phrase: "cat".into(),
        reading: String::new(),
        meaning: "animal".into(),
        context: String::new(),
        notes: String::new(),
        examples: Vec::new(),
        source: None,
        attachments: Vec::new(),
    };
    let original = match store
        .create_material(&MaterialCreate {
            command_id: "original".into(),
            content,
            distinct: false,
            media_imports: Vec::new(),
        })
        .unwrap()
    {
        MaterialWriteResult::Saved { material, .. } => *material,
        other => panic!("Expected saved Material: {other:?}"),
    };
    let generation = admit(
        &mut store,
        MaterialGenerationBasis::Material {
            material: MaterialReference {
                id: original.id.clone(),
                revision: 1,
            },
        },
    );
    finish(
        &mut store,
        &generation,
        "{\"quote\":\"cat\",\"reading\":\"\",\"meaning\":\"animal\",\"notes\":\"\",\"examples\":[\"A cat rests.\"]}",
        false,
    );
    let mut current = original.content;
    current.notes = "new authored note".into();
    // When the original changes before proposals are collected.
    store
        .update_material(&MaterialEdit {
            command_id: "edit".into(),
            id: original.id,
            expected_revision: 1,
            content: current,
            excluded: false,
            media_imports: Vec::new(),
        })
        .unwrap();
    // Then collection cannot turn the obsolete output into a replacement draft.
    assert!(matches!(
        store.collect_material_generation(&generation.id),
        Err(StorageError::Conflict)
    ));
    assert!(
        store
            .material_proposals(&MaterialProposalQuery {
                after: None,
                package_id: None,
                pending_only: true,
            })
            .unwrap()
            .items
            .is_empty()
    );
    let cancelled = match store
        .conversation_command(
            &ConversationCommand::GenerateMaterial {
                command: MaterialGenerationStart {
                    command_id: "cancelled".into(),
                    basis: MaterialGenerationBasis::Source { source: source() },
                    instruction: String::new(),
                    maximum: 1,
                },
            },
            false,
        )
        .unwrap()
    {
        ConversationResult::Generation { generation } => generation,
        other => panic!("Expected generation: {other:?}"),
    };
    store
        .conversation_command(
            &ConversationCommand::CancelGeneration {
                command_id: "cancel".into(),
                id: cancelled.id.clone(),
            },
            false,
        )
        .unwrap();
    assert!(store.collect_material_generation(&cancelled.id).is_err());
}
