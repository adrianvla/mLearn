use mlearn_core::*;
use mlearn_storage::{ProfileStore, StorageError};

fn create(id: &str) -> MaterialCreate {
    MaterialCreate {
        command_id: id.into(),
        distinct: false,
        media_imports: vec![],
        content: MaterialContent {
            package_id: "package".into(),
            target_id: Some("target".into()),
            package_revision: None,
            sense: None,
            phrase: "word".into(),
            reading: "".into(),
            meaning: "".into(),
            context: "".into(),
            notes: "".into(),
            examples: vec![],
            source: None,
            attachments: vec![],
        },
    }
}

#[test]
fn excluded_targets_reject_new_admissions_including_distinct_but_allow_exact_reuse() {
    // Given a saved target followed by a durable exclusion.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("p")).unwrap();
    let original = store.create_material(&create("original")).unwrap();
    let target = MaterialTarget {
        package_id: "package".into(),
        target_id: "target".into(),
    };
    store
        .set_capture_exclusion(&CaptureExclusion {
            command_id: "exclude".into(),
            target: target.clone(),
            excluded: true,
        })
        .unwrap();
    // When stale capture input requests a distinct item or an unsaved excluded target.
    let mut distinct = create("stale-distinct");
    distinct.distinct = true;
    assert!(matches!(
        store.create_material(&distinct),
        Err(StorageError::Invalid(_))
    ));
    let mut other_origin = create("stale-other-origin");
    other_origin.content.package_revision = Some("different-revision".into());
    assert!(matches!(
        store.create_material(&other_origin),
        Err(StorageError::Invalid(_))
    ));
    let mut unsaved = create("unsaved");
    unsaved.content.target_id = Some("unsaved-target".into());
    store
        .set_capture_exclusion(&CaptureExclusion {
            command_id: "exclude-unsaved".into(),
            target: MaterialTarget {
                target_id: "unsaved-target".into(),
                ..target.clone()
            },
            excluded: true,
        })
        .unwrap();
    assert!(store.create_material(&unsaved).is_err());
    // Then neither creates a receipt, but exact reuse preserves the existing item.
    assert!(store.material_create_receipt(&distinct).unwrap().is_none());
    assert!(matches!(
        store.create_material(&create("reuse")).unwrap(),
        MaterialWriteResult::Saved { reused: true, .. }
    ));
    assert_eq!(
        store.material_create_receipt(&create("original")).unwrap(),
        Some(original)
    );
    store
        .set_capture_exclusion(&CaptureExclusion {
            command_id: "withdraw".into(),
            target,
            excluded: false,
        })
        .unwrap();
    assert!(matches!(
        store.create_material(&distinct).unwrap(),
        MaterialWriteResult::Saved { reused: false, .. }
    ));
}

#[test]
fn read_only_receipts_validate_payload_and_action_before_any_new_admission() {
    // Given a create and edit committed before a later target policy change.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("p");
    let mut store = ProfileStore::open(&path).unwrap();
    let command = create("create");
    let item = match store.create_material(&command).unwrap() {
        MaterialWriteResult::Saved { material, .. } => material,
        other => panic!("{other:?}"),
    };
    let mut change = MaterialEdit {
        media_imports: vec![],
        command_id: "edit".into(),
        id: item.id.clone(),
        expected_revision: 1,
        content: item.content.clone(),
        excluded: false,
    };
    change.content.notes = "new notes".into();
    store.update_material(&change).unwrap();
    store
        .set_capture_exclusion(&CaptureExclusion {
            command_id: "policy".into(),
            target: MaterialTarget {
                package_id: "package".into(),
                target_id: "target".into(),
            },
            excluded: true,
        })
        .unwrap();
    drop(store);
    // When read-only replay precedes runtime source/package availability checks.
    let store = ProfileStore::open(&path).unwrap();
    let replay = store.material_create_receipt(&command).unwrap().unwrap();
    // Then it reconstructs current data with the original commit metadata.
    assert!(
        matches!(replay, MaterialWriteResult::Saved { material, committed_revision: 1, .. }
        if material.revision == 2 && material.content.notes == "new notes")
    );
    assert!(matches!(
        store.material_edit_receipt(&change).unwrap(),
        Some(MaterialWriteResult::Saved {
            committed_revision: 2,
            ..
        })
    ));
    assert!(
        store
            .material_create_receipt(&create("uncommitted"))
            .unwrap()
            .is_none()
    );
    let mut collision = command.clone();
    collision.content.meaning = "changed payload".into();
    assert!(store.material_create_receipt(&collision).is_err());
    let mut wrong_action = change;
    wrong_action.command_id = command.command_id;
    assert!(store.material_edit_receipt(&wrong_action).is_err());
}
