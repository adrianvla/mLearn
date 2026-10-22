use mlearn_core::*;
use mlearn_storage::ProfileStore;
use std::collections::BTreeSet;

fn create(command: &str) -> MaterialCreate {
    MaterialCreate {
        command_id: command.into(),
        distinct: false,
        media_imports: vec![],
        content: MaterialContent {
            package_id: "package".into(),
            target_id: None,
            package_revision: None,
            sense: None,
            phrase: "phrase".into(),
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
fn large_pages_obey_encoded_budget_without_skipping_records() {
    // Given more than one page of near-limit records.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("p")).unwrap();
    let mut expected = BTreeSet::new();
    for index in 0..30 {
        let mut command = create(&format!("record-{index}"));
        command.distinct = true;
        command.content.notes = "n".repeat(32768);
        command.content.meaning = "m".repeat(20000);
        match store.create_material(&command).unwrap() {
            MaterialWriteResult::Saved { material, .. } => {
                expected.insert(material.id.0);
            }
            other => panic!("{other:?}"),
        }
    }
    let mut query = MaterialQuery {
        after: None,
        query: "".into(),
        source_id: None,
        include_excluded: true,
    };
    let mut observed = BTreeSet::new();
    // When every cursor is consumed.
    loop {
        let page = store.materials(&query).unwrap();
        // Then every page fits the actual serialized envelope and every ID occurs once.
        assert!(serde_json::to_vec(&page).unwrap().len() <= 262144);
        assert!(page.items.len() <= 24);
        assert!(!page.items.is_empty());
        for item in &page.items {
            assert!(observed.insert(item.id.0.clone()));
        }
        match page.next {
            Some(next) => {
                assert_eq!(page.items.last().unwrap().id, next);
                query.after = Some(next);
            }
            None => break,
        }
    }
    assert_eq!(observed, expected);
}

#[test]
fn malformed_content_is_rejected_at_the_storage_boundary() {
    // Given typed payloads whose structurally valid fields exceed storage bounds.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("p")).unwrap();
    let mutations: Vec<fn(&mut MaterialCreate)> = vec![
        |c| c.command_id.clear(),
        |c| c.command_id = "x".repeat(129),
        |c| c.content.package_id = "x".repeat(513),
        |c| c.content.target_id = Some("x".repeat(513)),
        |c| c.content.phrase = "x".repeat(2049),
        |c| c.content.reading = "x".repeat(2049),
        |c| c.content.meaning = "x".repeat(32769),
        |c| c.content.context = "x".repeat(32769),
        |c| c.content.notes = "x".repeat(32769),
        |c| c.content.examples = vec!["".into(); 17],
        |c| c.content.examples = vec!["x".repeat(4097)],
        |c| c.content.phrase = " \n ".into(),
        |c| {
            c.content.meaning = "x".repeat(32768);
            c.content.notes = "x".repeat(32768);
        },
        |c| {
            c.content.sense = Some(LexicalSense {
                heading: "x".repeat(65536),
                labels: vec![],
                definitions: vec![],
                notes: vec![],
            })
        },
        |c| {
            c.content.source = Some(SourceAnchor {
                source_id: "source".into(),
                content_revision: "v1".into(),
                package_id: "package".into(),
                package_version: "v1".into(),
                text: "語".into(),
                locator: SourceLocator::Video {
                    subtitle_revision: None,
                    cue_index: None,
                    selection_start: 1,
                    selection_end: 3,
                    position_ms: 0,
                    subtitle_offset_ms: 0,
                    playback_rate: 1.0,
                },
            })
        },
    ];
    // When each invalid request is admitted.
    for mutate in mutations {
        let mut command = create("invalid");
        mutate(&mut command);
        // Then it fails without a persisted item or command receipt.
        assert!(store.create_material(&command).is_err(), "{command:?}");
    }
    assert!(
        store
            .materials(&MaterialQuery {
                after: None,
                query: "".into(),
                source_id: None,
                include_excluded: true
            })
            .unwrap()
            .items
            .is_empty()
    );
    assert!(
        store
            .capture_eligibility(&vec![
                MaterialTarget {
                    package_id: "package".into(),
                    target_id: "target".into()
                };
                129
            ])
            .is_err()
    );
}

#[test]
fn small_pages_and_scoped_search_preserve_cursor_and_exclusion_filters() {
    // Given enough small items to hit the count cap and one source-bound exclusion.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("p")).unwrap();
    let source = SourceAnchor {
        source_id: "source".into(),
        content_revision: "v1".into(),
        package_id: "package".into(),
        package_version: "v1".into(),
        text: "phrase".into(),
        locator: SourceLocator::Video {
            subtitle_revision: None,
            cue_index: None,
            selection_start: 0,
            selection_end: 6,
            position_ms: 0,
            subtitle_offset_ms: 0,
            playback_rate: 1.0,
        },
    };
    for index in 0..26 {
        let mut command = create(&format!("record-{index}"));
        command.distinct = true;
        command.content.source = Some(source.clone());
        store.create_material(&command).unwrap();
    }
    let mut query = MaterialQuery {
        after: None,
        query: "phrase".into(),
        source_id: Some("source".into()),
        include_excluded: false,
    };
    // When the first page is read and its first item excluded from learning.
    let page = store.materials(&query).unwrap();
    assert_eq!(page.items.len(), 24);
    let first = &page.items[0];
    store
        .update_material(&MaterialEdit {
            media_imports: vec![],
            command_id: "exclude-learning".into(),
            id: first.id.clone(),
            expected_revision: first.revision,
            content: first.content.clone(),
            excluded: true,
        })
        .unwrap();
    // Then the cursor has no omissions and filters use the current item state.
    query.after = page.next;
    assert_eq!(store.materials(&query).unwrap().items.len(), 2);
    query.after = None;
    assert!(
        store
            .materials(&query)
            .unwrap()
            .items
            .iter()
            .all(|m| m.id != first.id)
    );
    query.source_id = Some("other-source".into());
    assert!(store.materials(&query).unwrap().items.is_empty());
}
