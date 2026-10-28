use mlearn_core::*;
use mlearn_storage::{ProfileStore, StorageError};

#[test]
fn retained_bulk_edit_content_reserves_recoverable_wire_capacity() {
    // Given large valid edit drafts retained for explicit native recovery.
    let directory = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&directory.path().join("profile")).unwrap();
    store.create_material(&capture("saved")).unwrap();
    let selected = select_materials(&mut store, "select-for-edit");
    let command = |index| MaterialBulkStart {
        command_id: format!("large-edit-{index}"),
        selection_id: selected.id.clone(),
        action: MaterialBulkAction::Edit {
            patch: MaterialBulkPatch {
                notes: Some("n".repeat(32000)),
                meaning: Some("m".repeat(32000)),
                ..Default::default()
            },
        },
    };
    for index in 0..4 {
        store.begin_material_bulk(&command(index)).unwrap();
        store
            .cancel_material_bulk(&format!("large-edit-{index}"))
            .unwrap();
    }

    // When another edit would consume the recovery response's reserved headroom.
    assert!(store.begin_material_bulk(&command(4)).is_err());

    // Then releasing an old result, not dropping unread handles, restores capacity.
    assert_eq!(store.material_bulk_jobs().unwrap().len(), 4);
    store.release_material_bulk("large-edit-0").unwrap();
    store.begin_material_bulk(&command(4)).unwrap();
    assert!(
        serde_json::to_vec(&store.material_bulk_jobs().unwrap())
            .unwrap()
            .len()
            < 524288
    );
}

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

fn select_materials(store: &mut ProfileStore, command: &str) -> CollectionSelection {
    store
        .create_collection_selection(&CollectionSelectionCreate {
            command_id: command.into(),
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
        .unwrap()
}

fn selected_material_id(entry: &CollectionSelectionEntry) -> &MaterialId {
    match &entry.item {
        CollectionItemId::Material { id } => id,
        CollectionItemId::Target { .. } => panic!("Expected authored Material"),
    }
}

#[test]
fn bulk_edit_and_its_progress_rollback_together_and_replay_once() {
    // Given a frozen selection, a later outsider and a real failing progress write.
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("profile");
    let mut store = ProfileStore::open(&path).unwrap();
    let original = saved(store.create_material(&capture("selected")).unwrap());
    let selected = select_materials(&mut store, "select-once");
    let mut outside = capture("outside");
    outside.distinct = true;
    let outside = saved(store.create_material(&outside).unwrap());
    let command = MaterialBulkStart {
        command_id: "bulk-edit".into(),
        selection_id: selected.id,
        action: MaterialBulkAction::Edit {
            patch: MaterialBulkPatch {
                notes: Some("new notes".into()),
                ..Default::default()
            },
        },
    };
    assert!(store.begin_material_bulk(&command).unwrap().1);
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch("CREATE TRIGGER reject_bulk_result BEFORE INSERT ON material_bulk_results BEGIN SELECT RAISE(ABORT,'fixture result write rejected'); END;").unwrap();

    // When Material succeeds internally but the same transaction cannot save progress.
    assert!(
        store
            .apply_material_bulk_item(&command.command_id, &original.id.0, None)
            .is_err()
    );

    // Then neither mutation nor receipt escapes; the admitted retry later commits once.
    assert_eq!(store.material(&original.id).unwrap(), original);
    assert_eq!(
        store
            .material_bulk_status(&command.command_id)
            .unwrap()
            .processed,
        0
    );
    assert_eq!(
        db.query_row(
            "SELECT COUNT(*) FROM material_receipts WHERE command_id LIKE 'bulk-%'",
            [],
            |row| row.get::<_, u32>(0)
        )
        .unwrap(),
        0
    );
    db.execute_batch("DROP TRIGGER reject_bulk_result;")
        .unwrap();
    let result = store
        .apply_material_bulk_item(&command.command_id, &original.id.0, None)
        .unwrap();
    assert_eq!(
        store
            .apply_material_bulk_item(&command.command_id, &original.id.0, None)
            .unwrap(),
        result
    );
    let changed = store.material(&original.id).unwrap();
    assert_eq!(changed.revision, original.revision + 1);
    assert_eq!(changed.content.notes, "new notes");
    assert_eq!(changed.content.source, original.content.source);
    assert_eq!(store.material(&outside.id).unwrap(), outside);
    let finished = store
        .finish_material_bulk(&command.command_id, None)
        .unwrap();
    assert_eq!(finished.phase, MaterialBulkPhase::Completed);
    assert_eq!(
        (finished.total, finished.processed, finished.succeeded),
        (1, 1, 1)
    );
    assert_eq!(
        store
            .material_bulk_page(&command.command_id, None)
            .unwrap()
            .items[0]
            .outcome,
        Some(result)
    );
}

#[test]
fn bulk_recovery_retries_only_failed_and_pending_frozen_identities() {
    for cancelled in [false, true] {
        // Given one success, one recoverable failure and one pending selected item.
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("profile");
        let mut store = ProfileStore::open(&path).unwrap();
        for index in 0..3 {
            let mut create = capture(&format!("item-{index}"));
            create.distinct = true;
            store.create_material(&create).unwrap();
        }
        let selected = select_materials(&mut store, "select-three");
        let command = MaterialBulkStart {
            command_id: "bulk-exclude".into(),
            selection_id: selected.id.clone(),
            action: MaterialBulkAction::Exclude { excluded: true },
        };
        store.begin_material_bulk(&command).unwrap();
        let rows = store
            .material_bulk_page(&command.command_id, None)
            .unwrap()
            .items;
        let first = selected_material_id(&rows[0].entry);
        let second = selected_material_id(&rows[1].entry);
        let third = selected_material_id(&rows[2].entry);
        let committed = store
            .apply_material_bulk_item(&command.command_id, &first.0, None)
            .unwrap();
        store
            .fail_material_bulk_item(&command.command_id, &second.0, "Temporary failure")
            .unwrap();
        if cancelled {
            store.cancel_material_bulk(&command.command_id).unwrap();
            assert!(
                store
                    .apply_material_bulk_item(&command.command_id, &third.0, None)
                    .is_err()
            );
        }
        assert!(store.release_collection_selection(&selected.id).is_err());
        drop(store);

        // When restart recovery interrupts abandoned work, then retry is explicit.
        let mut store = ProfileStore::open(&path).unwrap();
        store.interrupt_material_bulk().unwrap();
        let stopped = store.material_bulk_status(&command.command_id).unwrap();
        assert_eq!(
            stopped.phase,
            if cancelled {
                MaterialBulkPhase::Cancelled
            } else {
                MaterialBulkPhase::Interrupted
            }
        );
        assert!(!store.material(third).unwrap().excluded);
        let retried = store.retry_material_bulk(&command.command_id).unwrap();

        // Then successes remain receipts, and only failed/pending items execute.
        assert_eq!(
            (retried.processed, retried.succeeded, retried.failed),
            (1, 1, 0)
        );
        assert_eq!(
            store
                .apply_material_bulk_item(&command.command_id, &first.0, None)
                .unwrap(),
            committed
        );
        let mut resumed = 0;
        while let Some(entry) = store.next_material_bulk_item(&command.command_id).unwrap() {
            let id = selected_material_id(&entry);
            assert_ne!(id, first);
            store
                .apply_material_bulk_item(&command.command_id, &id.0, None)
                .unwrap();
            resumed += 1;
        }
        assert_eq!(resumed, 2);
        let finished = store
            .finish_material_bulk(&command.command_id, None)
            .unwrap();
        assert_eq!(finished.phase, MaterialBulkPhase::Completed);
        assert_eq!(
            (finished.processed, finished.succeeded, finished.failed),
            (3, 3, 0)
        );
        for row in &rows {
            let material = store.material(selected_material_id(&row.entry)).unwrap();
            assert_eq!(material.revision, 2);
            assert!(material.excluded);
        }
        store.release_material_bulk(&command.command_id).unwrap();
        store.release_collection_selection(&selected.id).unwrap();
        assert!(store.material_bulk_jobs().unwrap().is_empty());
        assert!(store.retry_material_bulk(&command.command_id).is_err());
        let (receipt, admitted) = store.begin_material_bulk(&command).unwrap();
        assert!(!admitted);
        assert!(!receipt.results_available);
    }
}

#[test]
fn bulk_removal_pages_are_bounded_and_result_capacity_is_explicitly_released() {
    // Given 35 authored identities and a matching frozen native scope.
    let directory = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&directory.path().join("profile")).unwrap();
    for index in 0..35 {
        let mut create = capture(&format!("page-{index}"));
        create.distinct = true;
        store.create_material(&create).unwrap();
    }
    let selected = select_materials(&mut store, "select-pages");
    let command = |index| MaterialBulkStart {
        command_id: format!("remove-{index}"),
        selection_id: selected.id.clone(),
        action: MaterialBulkAction::Remove,
    };

    // When the operation is admitted, results page without copying the full collection.
    store.begin_material_bulk(&command(0)).unwrap();
    let first = store.material_bulk_page("remove-0", None).unwrap();
    let last = store
        .material_bulk_page("remove-0", first.next.as_deref())
        .unwrap();

    // Then pending identity pages are bounded and another action cannot reuse the receipt.
    assert_eq!(first.items.len(), 24);
    assert_eq!(last.items.len(), 11);
    assert!(last.next.is_none());
    assert!(
        first
            .items
            .iter()
            .chain(&last.items)
            .all(|row| row.outcome.is_none())
    );
    let mut collision = command(0);
    collision.action = MaterialBulkAction::Exclude { excluded: true };
    assert!(store.begin_material_bulk(&collision).is_err());
    let item_id = selected_material_id(&first.items[0].entry);
    assert!(matches!(
        store
            .apply_material_bulk_item("remove-0", &item_id.0, None)
            .unwrap(),
        MaterialBulkOutcome::Removed { .. }
    ));
    assert!(store.material(item_id).is_err());
    store.cancel_material_bulk("remove-0").unwrap();
    for index in 1..8 {
        store.begin_material_bulk(&command(index)).unwrap();
        store
            .cancel_material_bulk(&format!("remove-{index}"))
            .unwrap();
    }
    assert!(store.begin_material_bulk(&command(8)).is_err());
    store.release_material_bulk("remove-0").unwrap();
    assert!(store.material_bulk_page("remove-0", None).is_err());
    store.begin_material_bulk(&command(8)).unwrap();
}

#[test]
fn bulk_add_preserves_package_identity_and_reports_duplicates_before_distinct_admission() {
    // Given a real saved reference and a package-shaped target catalog.
    let directory = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&directory.path().join("profile")).unwrap();
    let original = saved(store.create_material(&capture("already-saved")).unwrap());
    let metadata = CollectionDescription {
        capabilities: vec![Capability {
            id: "example.language:meaning".into(),
            label: "Meaning".into(),
        }],
        kinds: vec![LinguisticLabel {
            id: "example.language:lexeme".into(),
            label: "Lexeme".into(),
            color: None,
            attribution: "Fixture".into(),
        }],
        scopes: vec![],
        levels: vec![],
    };
    store
        .begin_collection_catalog("example.language", "package-v1", &metadata, 1)
        .unwrap();
    store
        .put_collection_catalog_page(
            "example.language",
            "package-v1",
            0,
            None,
            &CollectionCatalogPage {
                items: vec![CollectionTarget {
                    summary: LexicalSummary {
                        target_id: "target-one".into(),
                        headword: "語".into(),
                        reading: None,
                        summary: "word".into(),
                        presentation: None,
                    },
                    kind: "example.language:lexeme".into(),
                    capabilities: vec!["example.language:meaning".into()],
                    scopes: vec![],
                    levels: vec![],
                    extensions: Default::default(),
                }],
                next: None,
                total: 1,
            },
        )
        .unwrap();
    let selected = store
        .create_collection_selection(&CollectionSelectionCreate {
            command_id: "select-target".into(),
            source: CollectionSelectionSource::Matching {
                query: CollectionQuery {
                    package_id: Some("example.language".into()),
                    surface: CollectionSurface::Knowledge,
                    filter: CollectionFilter::All { filters: vec![] },
                    sort: CollectionSort::Default,
                    after: None,
                },
            },
        })
        .unwrap();
    let command = MaterialBulkStart {
        command_id: "add-target".into(),
        selection_id: selected.id.clone(),
        action: MaterialBulkAction::Add { distinct: false },
    };
    store.begin_material_bulk(&command).unwrap();
    let mut content = original.content.clone();
    content.source = None;
    let mut foreign = content.clone();
    foreign.package_revision = Some("another-package-revision".into());

    // When native admission receives an identity mismatch, then the correct snapshot.
    assert!(
        store
            .apply_material_bulk_item("add-target", "target-one", Some(&foreign))
            .is_err()
    );
    assert_eq!(
        store.material_bulk_status("add-target").unwrap().processed,
        0
    );
    let outcome = store
        .apply_material_bulk_item("add-target", "target-one", Some(&content))
        .unwrap();

    // Then ambiguity is not reported as a save; a distinct action is a separate intent.
    assert_eq!(
        outcome,
        MaterialBulkOutcome::Duplicate {
            material_ids: vec![original.id.clone()]
        }
    );
    let finished = store.finish_material_bulk("add-target", None).unwrap();
    assert_eq!(
        (finished.succeeded, finished.duplicates, finished.failed),
        (0, 1, 0)
    );
    let distinct = MaterialBulkStart {
        command_id: "add-distinct-target".into(),
        selection_id: selected.id,
        action: MaterialBulkAction::Add { distinct: true },
    };
    store.begin_material_bulk(&distinct).unwrap();
    let MaterialBulkOutcome::Saved {
        material_id,
        reused,
        ..
    } = store
        .apply_material_bulk_item(&distinct.command_id, "target-one", Some(&content))
        .unwrap()
    else {
        panic!("Expected explicit distinct admission");
    };
    assert!(!reused);
    assert_ne!(material_id, original.id);
    assert_eq!(store.material(&material_id).unwrap().content, content);
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
