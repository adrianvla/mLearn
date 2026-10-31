use mlearn_core::*;
use mlearn_storage::{ProfileStore, StorageError};
use rusqlite::Connection;
use std::collections::BTreeSet;

#[test]
fn replacement_review_preserves_a_different_source_language_without_reinterpreting_identity() {
    // Given accepted authored content whose target and source languages differ.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile")).unwrap();
    let mut content = suggestion("unused").content;
    content.source.as_mut().unwrap().package_id = "source.language".into();
    let original = saved(
        store
            .create_material(&MaterialCreate {
                command_id: "original".into(),
                content,
                distinct: false,
                media_imports: vec![],
            })
            .unwrap(),
    );
    let mut draft = original.content.clone();
    draft.examples = vec!["A reviewed example.".into()];
    let proposal = store
        .suggest_material(&MaterialSuggestion {
            command_id: "suggest".into(),
            content: draft,
            replaces: Some(MaterialReference {
                id: original.id.clone(),
                revision: original.revision,
            }),
        })
        .unwrap()
        .proposal;
    // When its explicit replacement is accepted.
    let accepted = store
        .review_material_proposal(&review(
            "accept",
            &proposal,
            MaterialProposalDecision::Accept { distinct: false },
        ))
        .unwrap();
    // Then source provenance and dictionary identity survive independently.
    assert!(matches!(
        accepted.acceptance,
        Some(MaterialProposalAcceptance::Saved { .. })
    ));
    let current = store.material(&original.id).unwrap();
    assert_eq!(current.content.source, original.content.source);
    assert_eq!(current.content.package_id, original.content.package_id);
    assert_eq!(current.content.target_id, original.content.target_id);
    assert_eq!(
        current.content.package_revision,
        original.content.package_revision
    );
    assert_eq!(current.content.examples, vec!["A reviewed example."]);
}

fn suggestion(command: &str) -> MaterialSuggestion {
    MaterialSuggestion {
        command_id: command.into(),
        replaces: None,
        content: MaterialContent {
            package_id: "example.language".into(),
            target_id: Some("target-cat".into()),
            package_revision: Some("package-v1".into()),
            sense: None,
            phrase: "cat".into(),
            reading: String::new(),
            meaning: "a small animal".into(),
            context: "A cat sleeps.".into(),
            notes: String::new(),
            examples: vec![],
            attachments: vec![],
            source: Some(SourceAnchor {
                source_id: "document-one".into(),
                content_revision: "content-v1".into(),
                package_id: "example.language".into(),
                package_version: "v1".into(),
                text: "A cat sleeps.".into(),
                locator: SourceLocator::Document {
                    parser_revision: "parser-v1".into(),
                    resource: "text".into(),
                    block_id: "block-one".into(),
                    context_start: 0,
                    selection_start: 2,
                    selection_end: 5,
                },
            }),
        },
    }
}

fn review(
    command: &str,
    proposal: &MaterialProposal,
    decision: MaterialProposalDecision,
) -> MaterialProposalReview {
    MaterialProposalReview {
        command_id: command.into(),
        id: proposal.id.clone(),
        expected_revision: proposal.revision,
        decision,
    }
}

fn saved(result: MaterialWriteResult) -> Material {
    match result {
        MaterialWriteResult::Saved { material, .. } => *material,
        other => panic!("Expected saved Material: {other:?}"),
    }
}

#[test]
fn edited_and_rejected_proposals_survive_restart_without_authoring_or_evidence() {
    // Given a real profile with a source-grounded pending draft.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("profile");
    let mut store = ProfileStore::open(&path).unwrap();
    let input = suggestion("suggest");
    let first = store.suggest_material(&input).unwrap().proposal;
    let edit = review(
        "edit",
        &first,
        MaterialProposalDecision::Edit {
            patch: MaterialBulkPatch {
                notes: Some("my note".into()),
                ..Default::default()
            },
        },
    );
    let edited = store.review_material_proposal(&edit).unwrap();
    assert_eq!(edited.proposal.content.notes, "my note");
    assert_eq!(edited.proposal.content.source, first.content.source);
    // When the learner rejects the edited draft and reopens its durable receipt.
    let reject = review("reject", &edited.proposal, MaterialProposalDecision::Reject);
    store.review_material_proposal(&reject).unwrap();
    drop(store);
    let mut store = ProfileStore::open(&path).unwrap();
    let replay = store.suggest_material(&input).unwrap();
    // Then the original receipt cannot resurrect or reset the reviewed proposal.
    assert_eq!(replay.committed_revision, 1);
    assert_eq!(replay.proposal.revision, 3);
    assert_eq!(replay.proposal.state, MaterialProposalState::Rejected);
    assert_eq!(replay.proposal.content.notes, "my note");
    let db = Connection::open(&path).unwrap();
    for table in ["materials", "claims"] {
        let count: u32 = db
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
    }
    assert_eq!(
        db.query_row::<u32, _, _>(
            "SELECT revision FROM knowledge_revision WHERE id=1",
            [],
            |row| row.get(0)
        )
        .unwrap(),
        0
    );
    assert!(
        matches!(store.review_material_proposal(&edit), Ok(receipt) if receipt.committed_revision == 2)
    );
    let mut reused = input.clone();
    reused.content.notes = "different payload".into();
    assert!(store.suggest_material(&reused).is_err());
    assert!(
        store
            .review_material_proposal(&review(
                "resurrect",
                &replay.proposal,
                MaterialProposalDecision::Accept { distinct: false },
            ))
            .is_err()
    );
}

#[test]
fn acceptance_and_proposal_receipt_commit_together_and_replay_cannot_recreate_deleted_material() {
    // Given an injected failure exactly where the acceptance receipt is persisted.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("profile");
    let mut store = ProfileStore::open(&path).unwrap();
    let proposal = store
        .suggest_material(&suggestion("suggest"))
        .unwrap()
        .proposal;
    let accept = review(
        "accept",
        &proposal,
        MaterialProposalDecision::Accept { distinct: false },
    );
    let db = Connection::open(&path).unwrap();
    db.execute_batch(
        "CREATE TRIGGER fail_proposal_receipt BEFORE INSERT ON material_proposal_receipts
        WHEN NEW.command_id='accept' BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END;",
    )
    .unwrap();
    // When acceptance fails, then retries through the same command after recovery.
    assert!(store.review_material_proposal(&accept).is_err());
    assert_eq!(
        store.material_proposal(&proposal.id).unwrap().state,
        MaterialProposalState::Pending
    );
    assert_eq!(
        db.query_row::<u32, _, _>("SELECT COUNT(*) FROM materials", [], |row| row.get(0))
            .unwrap(),
        0
    );
    assert!(
        store
            .material_proposal_review_receipt(&accept)
            .unwrap()
            .is_none()
    );
    db.execute_batch("DROP TRIGGER fail_proposal_receipt;")
        .unwrap();
    let receipt = store.review_material_proposal(&accept).unwrap();
    let Some(MaterialProposalAcceptance::Saved {
        material_id,
        committed_revision,
        reused,
    }) = &receipt.acceptance
    else {
        panic!("Expected accepted Material");
    };
    assert!(!reused);
    assert_eq!(*committed_revision, 1);
    store
        .remove_material(&MaterialRemove {
            command_id: "remove".into(),
            id: material_id.clone(),
            expected_revision: 1,
        })
        .unwrap();
    drop(store);
    let mut store = ProfileStore::open(&path).unwrap();
    // Then receipt replay reports the original admission without writing Material again.
    assert_eq!(store.review_material_proposal(&accept).unwrap(), receipt);
    assert!(store.material(material_id).is_err());
    assert_eq!(
        db.query_row::<u32, _, _>("SELECT COUNT(*) FROM materials", [], |row| row.get(0))
            .unwrap(),
        0
    );
}

#[test]
fn duplicate_acceptance_keeps_a_draft_pending_until_a_distinct_decision() {
    // Given existing Material for the same target but a different source.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile")).unwrap();
    let mut original = suggestion("original");
    original.content.source.as_mut().unwrap().source_id = "other-document".into();
    let original = saved(
        store
            .create_material(&MaterialCreate {
                command_id: original.command_id,
                content: original.content,
                distinct: false,
                media_imports: vec![],
            })
            .unwrap(),
    );
    let proposal = store
        .suggest_material(&suggestion("suggest"))
        .unwrap()
        .proposal;
    let accept = review(
        "accept",
        &proposal,
        MaterialProposalDecision::Accept { distinct: false },
    );
    // When the normal duplicate policy refuses an implicit second context.
    let duplicate = store.review_material_proposal(&accept).unwrap();
    // Then the draft remains reviewable, and only a separate explicit decision creates a copy.
    assert_eq!(duplicate.proposal.state, MaterialProposalState::Pending);
    assert_eq!(
        duplicate.acceptance,
        Some(MaterialProposalAcceptance::Duplicate {
            material_ids: vec![original.id.clone()]
        })
    );
    let distinct = review(
        "distinct",
        &duplicate.proposal,
        MaterialProposalDecision::Accept { distinct: true },
    );
    let accepted = store.review_material_proposal(&distinct).unwrap();
    assert!(matches!(&accepted.acceptance,
        Some(MaterialProposalAcceptance::Saved { material_id, reused: false, .. }) if material_id != &original.id));
    let replay = store.review_material_proposal(&accept).unwrap();
    assert_eq!(replay.acceptance, duplicate.acceptance);
    assert_eq!(replay.proposal.state, accepted.proposal.state);
}

#[test]
fn replacement_proposals_keep_manual_identity_and_refuse_changed_authored_revisions() {
    // Given manual Material without a source and a proposed replacement example.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile")).unwrap();
    let mut content = suggestion("unused").content;
    content.source = None;
    content.target_id = None;
    content.package_revision = None;
    let original = saved(
        store
            .create_material(&MaterialCreate {
                command_id: "manual".into(),
                content,
                distinct: false,
                media_imports: vec![],
            })
            .unwrap(),
    );
    let mut draft = original.content.clone();
    draft.examples = vec!["A cat rests.".into()];
    let proposal = store
        .suggest_material(&MaterialSuggestion {
            command_id: "replacement".into(),
            content: draft,
            replaces: Some(MaterialReference {
                id: original.id.clone(),
                revision: original.revision,
            }),
        })
        .unwrap()
        .proposal;
    let mut changed = original.content.clone();
    changed.notes = "concurrent authored note".into();
    store
        .update_material(&MaterialEdit {
            command_id: "concurrent".into(),
            id: original.id.clone(),
            expected_revision: 1,
            content: changed,
            excluded: false,
            media_imports: vec![],
        })
        .unwrap();
    // When the old proposal tries to replace a newer authored revision.
    let accept = review(
        "accept",
        &proposal,
        MaterialProposalDecision::Accept { distinct: false },
    );
    // Then the edit is rejected without losing either the current content or the draft.
    assert!(matches!(
        store.review_material_proposal(&accept),
        Err(StorageError::Conflict)
    ));
    let current = store.material(&original.id).unwrap();
    assert_eq!(current.content.notes, "concurrent authored note");
    assert!(current.content.examples.is_empty());
    assert!(
        store
            .material_proposal_review_receipt(&accept)
            .unwrap()
            .is_none()
    );
    assert_eq!(store.material_proposal(&proposal.id).unwrap(), proposal);
}

#[test]
fn pending_proposal_capacity_and_paging_do_not_load_or_admit_the_whole_set() {
    // Given the bounded number of retained pending drafts.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile")).unwrap();
    for index in 0..128 {
        store
            .suggest_material(&suggestion(&format!("suggest-{index}")))
            .unwrap();
    }
    assert!(store.suggest_material(&suggestion("overflow")).is_err());
    // When a consumer pages the matching package through opaque proposal identities.
    let mut query = MaterialProposalQuery {
        after: None,
        package_id: Some("example.language".into()),
        pending_only: true,
    };
    let mut ids = BTreeSet::new();
    for _ in 0..12 {
        let page = store.material_proposals(&query).unwrap();
        assert!(page.items.len() <= 12);
        for item in page.items {
            assert!(ids.insert(item.id.0));
        }
        query.after = page.next;
        if query.after.is_none() {
            break;
        }
    }
    // Then all drafts are reachable once, and rejecting one frees admission capacity.
    assert_eq!(ids.len(), 128);
    let first = store
        .material_proposal(&MaterialProposalId(ids.first().unwrap().clone()))
        .unwrap();
    store
        .review_material_proposal(&review("reject", &first, MaterialProposalDecision::Reject))
        .unwrap();
    store.suggest_material(&suggestion("replacement")).unwrap();
    query.after = None;
    query.package_id = Some("unrelated.package".into());
    assert!(store.material_proposals(&query).unwrap().items.is_empty());
}
