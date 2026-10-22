use mlearn_core::*;
use mlearn_storage::ProfileStore;

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
fn exact_origin_reuses_but_another_context_requires_explicit_distinct_command() {
    // Given an item whose authored meaning has changed.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("p");
    let mut store = ProfileStore::open(&path).unwrap();
    let first = saved(store.create_material(&capture("first")).unwrap());
    let mut change = edit(&first, "change");
    change.content.meaning = "edited meaning".into();
    store.update_material(&change).unwrap();
    // When the same span is captured at a different playback return time.
    let mut same = capture("same-origin");
    let SourceLocator::Video {
        position_ms,
        subtitle_offset_ms,
        playback_rate,
        ..
    } = &mut same.content.source.as_mut().unwrap().locator;
    *position_ms = 9000;
    *subtitle_offset_ms = 2000;
    *playback_rate = 1.5;
    let reused = store.create_material(&same).unwrap();
    // Then it reuses the current item, while another cue is a bounded duplicate.
    assert!(
        matches!(reused, MaterialWriteResult::Saved { reused: true, material, .. } if material.id == first.id && material.revision == 2)
    );
    let mut another = capture("another");
    let SourceLocator::Video { cue_index, .. } =
        &mut another.content.source.as_mut().unwrap().locator;
    *cue_index = Some(2);
    assert!(
        matches!(store.create_material(&another).unwrap(), MaterialWriteResult::Duplicate { items } if items.len() == 1 && items[0].id == first.id)
    );
    another.command_id = "distinct".into();
    another.distinct = true;
    let distinct = saved(store.create_material(&another).unwrap());
    assert_ne!(distinct.id, first.id);
    drop(store);
    let mut store = ProfileStore::open(&path).unwrap();
    assert_eq!(
        saved(store.create_material(&another).unwrap()).id,
        distinct.id
    );
}

#[test]
fn duplicate_receipt_retains_candidate_ids_but_reads_current_records() {
    // Given a duplicate receipt.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("p");
    let mut store = ProfileStore::open(&path).unwrap();
    let first = saved(store.create_material(&capture("first")).unwrap());
    let mut duplicate = capture("duplicate");
    duplicate.content.source.as_mut().unwrap().source_id = "other-video".into();
    store.create_material(&duplicate).unwrap();
    let mut change = edit(&first, "edit");
    change.content.notes = "current".into();
    let current = saved(store.update_material(&change).unwrap());
    drop(store);
    // When the duplicate command is replayed.
    let mut store = ProfileStore::open(&path).unwrap();
    // Then it returns current records for the original candidates.
    assert_eq!(
        store.create_material(&duplicate).unwrap(),
        MaterialWriteResult::Duplicate {
            items: vec![current]
        }
    );
}

#[test]
fn manual_content_and_targeted_sense_snapshots_have_separate_identities() {
    // Given a targeted capture and a manually authored item.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("p")).unwrap();
    let captured = saved(store.create_material(&capture("capture")).unwrap());
    let mut manual = capture("manual");
    manual.content.target_id = None;
    let authored = saved(store.create_material(&manual).unwrap());
    // When content or explicit target/sense identity differs despite equal phrase.
    manual.command_id = "manual-edited".into();
    manual.content.notes = "different authored content".into();
    let mut other_target = capture("other-target");
    other_target.content.target_id = Some("target-two".into());
    let mut other_sense = capture("other-sense");
    other_sense.content.sense.as_mut().unwrap().definitions =
        vec!["another selected definition".into()];
    // Then each is its own item; no phrase-only merging occurs.
    assert_ne!(
        saved(store.create_material(&manual).unwrap()).id,
        authored.id
    );
    assert_ne!(
        saved(store.create_material(&other_target).unwrap()).id,
        captured.id
    );
    assert_ne!(
        saved(store.create_material(&other_sense).unwrap()).id,
        captured.id
    );
}
