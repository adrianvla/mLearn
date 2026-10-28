use mlearn_core::*;
use mlearn_storage::{ProfileStore, StorageError};

fn capture(command: &str) -> MaterialCreate {
    MaterialCreate {
        command_id: command.into(),
        distinct: false,
        media_imports: vec![],
        content: MaterialContent {
            package_id: "example.language".into(),
            target_id: Some("target-one".into()),
            package_revision: Some("package-v1".into()),
            sense: Some(LexicalSense {
                heading: "sense".into(),
                labels: vec![],
                definitions: vec!["selected definition".into()],
                notes: vec![],
            }),
            phrase: "語".into(),
            reading: "".into(),
            meaning: "word".into(),
            context: "語".into(),
            notes: "".into(),
            examples: vec![],
            attachments: vec![],
            source: Some(SourceAnchor {
                source_id: "video".into(),
                content_revision: "v1".into(),
                package_id: "example.language".into(),
                package_version: "v1".into(),
                text: "語".into(),
                locator: SourceLocator::Video {
                    subtitle_revision: Some("sub-v1".into()),
                    cue_index: Some(1),
                    selection_start: 0,
                    selection_end: 3,
                    position_ms: 100,
                    subtitle_offset_ms: 0,
                    playback_rate: 1.0,
                },
            }),
        },
    }
}

fn saved(result: MaterialWriteResult) -> Material {
    match result {
        MaterialWriteResult::Saved { material, .. } => *material,
        other => panic!("Expected saved material: {other:?}"),
    }
}

fn edit(item: &Material, command: &str) -> MaterialEdit {
    MaterialEdit {
        media_imports: vec![],
        command_id: command.into(),
        id: item.id.clone(),
        expected_revision: item.revision,
        content: item.content.clone(),
        excluded: item.excluded,
    }
}

#[test]
fn removal_preserves_receipts_and_claims_without_recreating_authored_material() {
    // Given a saved target, its edit receipt, a claim and a frozen selection.
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("profile.sqlite");
    let mut store = ProfileStore::open(&path).unwrap();
    let create = capture("create-before-removal");
    let original = saved(store.create_material(&create).unwrap());
    let mut change = edit(&original, "edit-before-removal");
    change.content.notes = "retained until removal".into();
    let current = saved(store.update_material(&change).unwrap());
    let key = KnowledgeKey {
        package_id: create.content.package_id.clone(),
        target_id: create.content.target_id.clone().unwrap(),
        capability: "example.language:meaning".into(),
    };
    let claim = store
        .change_claim(&ClaimChange {
            command_id: "claim-before-removal".into(),
            key: key.clone(),
            claim: Some(true),
        })
        .unwrap();
    let selected = store
        .create_collection_selection(&CollectionSelectionCreate {
            command_id: "select-before-removal".into(),
            source: CollectionSelectionSource::Matching {
                query: CollectionQuery {
                    package_id: None,
                    surface: CollectionSurface::Material,
                    filter: CollectionFilter::All { filters: vec![] },
                    sort: CollectionSort::Default,
                    after: None,
                },
            },
        })
        .unwrap();
    let command = MaterialRemove {
        command_id: "remove-once".into(),
        id: current.id.clone(),
        expected_revision: current.revision,
    };
    let mut stale = command.clone();
    stale.expected_revision = original.revision;
    assert!(matches!(
        store.remove_material(&stale),
        Err(StorageError::Conflict)
    ));
    assert_eq!(store.material(&current.id).unwrap(), current);
    let mut collision = command.clone();
    collision.command_id = create.command_id.clone();
    assert!(matches!(
        store.remove_material(&collision),
        Err(StorageError::Invalid(_))
    ));

    // When removed and the same native command is retried after restart.
    let removed = store.remove_material(&command).unwrap();
    drop(store);
    let mut store = ProfileStore::open(&path).unwrap();

    // Then retries have the original receipt, never a new card or deleted claim.
    assert_eq!(removed.committed_revision, current.revision + 1);
    assert_eq!(store.remove_material(&command).unwrap(), removed);
    assert!(store.material(&current.id).is_err());
    assert_eq!(store.knowledge(&[key]).unwrap(), vec![claim]);
    assert!(store.create_material(&create).is_err());
    assert!(store.update_material(&change).is_err());
    assert_eq!(
        store
            .collection_selection_page(&selected.id, None)
            .unwrap()
            .items[0]
            .item,
        CollectionItemId::Material {
            id: current.id.clone()
        }
    );
    let empty = store
        .materials(&MaterialQuery {
            after: None,
            query: "".into(),
            source_id: None,
            include_excluded: true,
        })
        .unwrap();
    assert!(empty.items.is_empty());
    let fresh = saved(
        store
            .create_material(&capture("explicitly-add-again"))
            .unwrap(),
    );
    assert_ne!(fresh.id, current.id);
}

#[test]
fn receipts_survive_restart_and_reconstruct_current_item_without_reapplying() {
    // Given a saved item followed by two edits.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("p.sqlite");
    let mut store = ProfileStore::open(&path).unwrap();
    let create = capture("create");
    let first = saved(store.create_material(&create).unwrap());
    let mut change = edit(&first, "edit");
    change.content.notes = "first edit".into();
    let second = saved(store.update_material(&change).unwrap());
    let mut newer = edit(&second, "newer");
    newer.content.notes = "current content".into();
    let current = saved(store.update_material(&newer).unwrap());
    drop(store);
    // When old commands are replayed after reopening.
    let mut store = ProfileStore::open(&path).unwrap();
    for (result, revision) in [
        (store.create_material(&create).unwrap(), 1),
        (store.update_material(&change).unwrap(), 2),
    ] {
        // Then their committed revision stays historical, but Material is current.
        match result {
            MaterialWriteResult::Saved {
                material,
                committed_revision,
                reused,
            } => {
                assert_eq!(*material, current);
                assert_eq!(committed_revision, revision);
                assert!(!reused);
            }
            other => panic!("{other:?}"),
        }
    }
}

#[test]
fn command_payload_and_operation_collisions_are_rejected() {
    // Given a committed create.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("p")).unwrap();
    let command = capture("one-command");
    let item = saved(store.create_material(&command).unwrap());
    // When its identity is used for different payloads or operations.
    let mut collision = command.clone();
    collision.content.notes = "different".into();
    // Then none is admitted.
    assert!(matches!(
        store.create_material(&collision),
        Err(StorageError::Invalid(_))
    ));
    assert!(matches!(
        store.update_material(&edit(&item, "one-command")),
        Err(StorageError::Invalid(_))
    ));
    let exclusion = CaptureExclusion {
        command_id: "one-command".into(),
        target: MaterialTarget {
            package_id: item.content.package_id,
            target_id: "target-one".into(),
        },
        excluded: true,
    };
    assert!(matches!(
        store.set_capture_exclusion(&exclusion),
        Err(StorageError::Invalid(_))
    ));
}

#[test]
fn exclusion_replay_preserves_newer_policy_and_never_changes_knowledge() {
    // Given an explicitly known word with no saved material.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("p");
    let mut store = ProfileStore::open(&path).unwrap();
    let target = MaterialTarget {
        package_id: "example.language".into(),
        target_id: "target-one".into(),
    };
    let key = KnowledgeKey {
        package_id: target.package_id.clone(),
        target_id: target.target_id.clone(),
        capability: "meaning".into(),
    };
    store
        .change_claim(&ClaimChange {
            key: key.clone(),
            claim: Some(true),
            command_id: "claim".into(),
        })
        .unwrap();
    let knowledge = store.knowledge(std::slice::from_ref(&key)).unwrap();
    assert!(matches!(
        store
            .capture_eligibility(std::slice::from_ref(&target))
            .unwrap()[0]
            .availability,
        CaptureAvailability::Eligible
    ));
    let old = CaptureExclusion {
        command_id: "exclude".into(),
        target: target.clone(),
        excluded: true,
    };
    store.set_capture_exclusion(&old).unwrap();
    assert!(matches!(
        store
            .capture_eligibility(std::slice::from_ref(&target))
            .unwrap()[0]
            .availability,
        CaptureAvailability::Excluded
    ));
    store
        .set_capture_exclusion(&CaptureExclusion {
            command_id: "withdraw".into(),
            excluded: false,
            ..old.clone()
        })
        .unwrap();
    let item = saved(store.create_material(&capture("item")).unwrap());
    let mut change = edit(&item, "exclude-learning");
    change.excluded = true;
    store.update_material(&change).unwrap();
    drop(store);
    // When an old exclusion is replayed after restart.
    let mut store = ProfileStore::open(&path).unwrap();
    let result = store.set_capture_exclusion(&old).unwrap();
    // Then current target policy remains withdrawn, independent of learning exclusion.
    assert!(
        matches!(result.availability, CaptureAvailability::Existing { material_id, excluded: false } if material_id == item.id)
    );
    assert_eq!(store.knowledge(&[key]).unwrap(), knowledge);
}
