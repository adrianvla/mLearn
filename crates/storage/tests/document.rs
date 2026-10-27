#[path = "support/review.rs"]
pub mod support;

use mlearn_core::*;
use mlearn_storage::ProfileStore;

fn fixture(
    count: u32,
) -> (
    DocumentRecord,
    Vec<DocumentBlock>,
    Vec<DocumentResourceLocation>,
) {
    let record = DocumentRecord {
        id: "book-one".into(),
        title: "Source book".into(),
        document_path: "/isolated/book.epub".into(),
        content_revision: "content-one".into(),
        parser_revision: "parser-one".into(),
        format: DocumentFormat::Epub,
        package_id: "package-one".into(),
        package_version: "1".into(),
        position: None,
        appearance: DocumentAppearance::default(),
        progression: Some("rtl".into()),
        total_blocks: count,
        total_pages: 0,
        fidelity: vec!["source-ruby".into()],
    };
    let blocks = (0..count)
        .map(|index| DocumentBlock {
            resource: "chapter-one".into(),
            id: format!("bridge-{index}"),
            kind: "paragraph".into(),
            text: "A\u{1f600} bridge\r\nbridge".into(),
            readings: vec![SourceReading {
                start: 1,
                end: 5,
                text: "source reading".into(),
            }],
            image: None,
            page: None,
            writing_mode: None,
        })
        .collect();
    let resources = vec![DocumentResourceLocation {
        source_id: record.id.clone(),
        resource_id: "chapter-one".into(),
        path: "/isolated/chapter-one.xhtml".into(),
        mime_type: "application/xhtml+xml".into(),
        byte_length: 300,
    }];
    (record, blocks, resources)
}

fn position(block: &str, offset: u32) -> DocumentPosition {
    DocumentPosition {
        parser_revision: "parser-one".into(),
        resource: "chapter-one".into(),
        block_id: block.into(),
        offset,
    }
}

fn checkpoint(record: &DocumentRecord) -> DocumentCheckpoint {
    DocumentCheckpoint {
        source_id: record.id.clone(),
        content_revision: record.content_revision.clone(),
        position: position("bridge-2", 5),
        appearance: DocumentAppearance {
            writing_mode: DocumentWritingMode::Horizontal,
            font: DocumentFont::Serif,
            font_size: 32,
            ..Default::default()
        },
    }
}

#[test]
fn document_windows_fit_native_transport_even_with_dense_authored_readings() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile")).unwrap();
    let (record, mut blocks, resources) = fixture(8);
    for block in &mut blocks {
        block.text = "x".repeat(4096);
        block.readings = (0..4096)
            .map(|start| SourceReading {
                start,
                end: start + 1,
                text: "x".into(),
            })
            .collect();
    }
    store
        .import_document(&record, &blocks, &[], &resources)
        .unwrap();
    let window = store.document_window(&record.id, None).unwrap();
    let count = window.blocks.len();
    let next = window.next.clone();
    assert!(
        serde_json::to_vec(&Response::Document { window })
            .unwrap()
            .len()
            <= 524_288
    );
    assert_eq!(next.unwrap().block_id, blocks[count].id);
}

#[test]
fn import_and_duplicate_reopen_preserve_exact_projection_and_checkpoint() {
    // Given canonical source-authored metadata and a persisted actual passage.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("profile");
    let mut store = ProfileStore::open(&path).unwrap();
    let (record, mut blocks, resources) = fixture(4);
    blocks[2].writing_mode = Some(DocumentFlow::VerticalRl);
    let contents = vec![DocumentNavigation {
        label: "Second bridge".into(),
        position: position("bridge-2", 5),
    }];
    assert_eq!(
        store
            .import_document(&record, &blocks, &contents, &resources)
            .unwrap(),
        record
    );
    let checkpoint = checkpoint(&record);
    let saved = store.checkpoint_document(&checkpoint).unwrap();
    drop(store);
    // When the same deterministic source is opened after restart.
    let mut store = ProfileStore::open(&path).unwrap();
    let mut reopened_record = record.clone();
    reopened_record.document_path = "/isolated/another-import-of-same-content.epub".into();
    let mut reopened_resources = resources.clone();
    reopened_resources[0].path = "/isolated/another-import/chapter-one.xhtml".into();
    assert_eq!(
        store
            .import_document(&reopened_record, &blocks, &contents, &reopened_resources)
            .unwrap(),
        saved
    );
    let window = store.document_window(&record.id, None).unwrap();
    // Then duplicate text never reanchors bridge-2 to bridge-1, and source values survive.
    assert_eq!(window.source.position, Some(checkpoint.position));
    assert_eq!(window.source.appearance, checkpoint.appearance);
    assert_eq!(window.source.total_blocks, 4);
    assert_eq!(window.source.progression.as_deref(), Some("rtl"));
    assert_eq!(window.blocks, blocks[2..]);
    assert_eq!(window.previous, Some(position("bridge-1", 0)));
    assert_eq!(window.next, None);
    assert_eq!(
        store
            .document_block(&record.id, "chapter-one", "bridge-2")
            .unwrap(),
        Some(blocks[2].clone())
    );
    assert_eq!(
        store.document_resource(&record.id, "chapter-one").unwrap(),
        Some(resources[0].clone())
    );
    assert_eq!(
        store.document_resource(&record.id, "unregistered").unwrap(),
        None
    );
    assert_eq!(
        store.document_contents(&record.id, None).unwrap().items,
        contents
    );
}

#[test]
fn invalid_scalar_stale_or_missing_checkpoints_leave_saved_state_unchanged() {
    // Given a saved revision-bound position and user appearance.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile")).unwrap();
    let (record, blocks, resources) = fixture(4);
    store
        .import_document(&record, &blocks, &[], &resources)
        .unwrap();
    let valid = checkpoint(&record);
    let saved = store.checkpoint_document(&valid).unwrap();
    let mut variants = vec![];
    for offset in [2, 3, 4, 1000] {
        let mut bad = valid.clone();
        bad.position.offset = offset;
        variants.push(bad);
    }
    let mut bad = valid.clone();
    bad.content_revision = "old-content".into();
    variants.push(bad);
    let mut bad = valid.clone();
    bad.position.parser_revision = "old-parser".into();
    variants.push(bad);
    let mut bad = valid.clone();
    bad.position.block_id = "missing-same-text".into();
    variants.push(bad);
    let mut bad = valid.clone();
    bad.position.resource = "other-chapter".into();
    variants.push(bad);
    let mut bad = valid;
    bad.appearance.font_size = 100;
    variants.push(bad);
    // When invalid checkpoints and transient window anchors are submitted.
    for bad in variants {
        assert!(store.checkpoint_document(&bad).is_err());
        assert_eq!(store.document(&record.id).unwrap(), Some(saved.clone()));
    }
    let stale = DocumentPosition {
        parser_revision: "stale".into(),
        ..position("bridge-1", 0)
    };
    assert!(store.document_window(&record.id, Some(&stale)).is_err());
    assert!(
        store
            .document_window(&record.id, Some(&position("missing", 0)))
            .is_err()
    );
    // Then rejection preserves the original passage and appearance.
    assert_eq!(store.document(&record.id).unwrap(), Some(saved));
}

#[test]
fn immutable_projection_identity_rejects_content_parser_and_block_changes() {
    // Given an existing source with a saved passage.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile")).unwrap();
    let (record, blocks, resources) = fixture(4);
    store
        .import_document(&record, &blocks, &[], &resources)
        .unwrap();
    let saved = store.checkpoint_document(&checkpoint(&record)).unwrap();
    // When a deterministic ID is reused with another revision or projection.
    let mut changed = record.clone();
    changed.content_revision = "content-two".into();
    assert!(
        store
            .import_document(&changed, &blocks, &[], &resources)
            .is_err()
    );
    changed = record.clone();
    changed.parser_revision = "parser-two".into();
    assert!(
        store
            .import_document(&changed, &blocks, &[], &resources)
            .is_err()
    );
    let mut changed_blocks = blocks.clone();
    changed_blocks[2].text.push('!');
    assert!(
        store
            .import_document(&record, &changed_blocks, &[], &resources)
            .is_err()
    );
    // Then original projection, location and appearance remain authoritative.
    assert_eq!(store.document(&record.id).unwrap(), Some(saved));
    assert_eq!(
        store
            .document_block(&record.id, "chapter-one", "bridge-2")
            .unwrap(),
        Some(blocks[2].clone())
    );
}

#[test]
fn windows_and_contents_are_bounded_with_stable_original_neighbors() {
    // Given enough source blocks and navigation entries to require multiple windows.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile")).unwrap();
    let (record, blocks, resources) = fixture(40);
    let contents: Vec<_> = (0..40)
        .map(|index| DocumentNavigation {
            label: format!("Chapter {index}"),
            position: position(&format!("bridge-{index}"), 0),
        })
        .collect();
    store
        .import_document(&record, &blocks, &contents, &resources)
        .unwrap();
    // When ordinary windows and contents pages are requested.
    let first = store.document_window(&record.id, None).unwrap();
    let second = store
        .document_window(&record.id, first.next.as_ref())
        .unwrap();
    let page = store.document_contents(&record.id, None).unwrap();
    let rest = store
        .document_contents(&record.id, page.next_offset)
        .unwrap();
    // Then reads are bounded, original identities are continuous, and revision is explicit.
    assert_eq!(first.blocks, blocks[..8]);
    assert_eq!(first.previous, None);
    assert_eq!(first.next, Some(position("bridge-8", 0)));
    assert_eq!(second.blocks, blocks[8..16]);
    assert_eq!(second.previous, Some(position("bridge-7", 0)));
    assert_eq!(page.items, contents[..32]);
    assert_eq!(page.next_offset, Some(31));
    assert_eq!(page.parser_revision, record.parser_revision);
    assert_eq!(rest.items, contents[32..]);
    assert_eq!(rest.next_offset, None);
    assert_eq!(store.document(&record.id).unwrap().unwrap().position, None);
}

#[test]
fn full_size_block_and_readings_fit_without_loading_later_corpus() {
    // Given a legal full 64 KiB block, followed by a large second block.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("profile");
    let mut store = ProfileStore::open(&path).unwrap();
    let (record, mut blocks, resources) = fixture(3);
    blocks[0].text = "x".repeat(64 * 1024 - 4);
    blocks[0].readings = vec![SourceReading {
        start: 0,
        end: 1,
        text: "ruby".into(),
    }];
    blocks[1].text = "y".repeat(64 * 1024);
    blocks[1].readings.clear();
    store
        .import_document(&record, &blocks, &[], &resources)
        .unwrap();
    // A later corrupted payload proves the initial window does not deserialize it.
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute(
        "UPDATE document_blocks SET block='invalid' WHERE block_id='bridge-1'",
        [],
    )
    .unwrap();
    // When the full-size first source block is requested.
    let window = store.document_window(&record.id, None).unwrap();
    // Then the legal block is returned alone with a stable next locator.
    assert_eq!(window.blocks, blocks[..1]);
    assert_eq!(window.next, Some(position("bridge-1", 0)));
    assert!(
        store
            .document_window(&record.id, window.next.as_ref())
            .is_err()
    );
}

#[test]
fn language_selection_keeps_location_appearance_and_source_metadata_after_restart() {
    // Given an active document and actual saved position.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("profile");
    let mut store = ProfileStore::open(&path).unwrap();
    let (record, blocks, resources) = fixture(4);
    store
        .import_document(&record, &blocks, &[], &resources)
        .unwrap();
    let mut expected = store.checkpoint_document(&checkpoint(&record)).unwrap();
    expected.package_id = "another-package".into();
    expected.package_version = "2".into();
    // When the accepted package identity changes.
    assert_eq!(
        store
            .set_document_language(&record.id, "another-package", "2")
            .unwrap(),
        expected
    );
    drop(store);
    let mut store = ProfileStore::open(&path).unwrap();
    // Then a restart and duplicate import retain language without resetting the passage.
    assert_eq!(store.document(&record.id).unwrap(), Some(expected.clone()));
    assert_eq!(
        store
            .import_document(&record, &blocks, &[], &resources)
            .unwrap(),
        expected
    );
}

#[test]
fn failed_projection_write_rolls_back_document_blocks_and_registered_resources() {
    // Given a real SQLite failure after resources and blocks have been inserted.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("profile");
    let mut store = ProfileStore::open(&path).unwrap();
    let (record, blocks, resources) = fixture(4);
    let contents = [DocumentNavigation {
        label: "chapter".into(),
        position: position("bridge-2", 0),
    }];
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch("CREATE TRIGGER fail_document_navigation BEFORE INSERT ON document_navigation BEGIN SELECT RAISE(ABORT,'disk failure fixture'); END;").unwrap();
    // When complete projection admission fails.
    assert!(
        store
            .import_document(&record, &blocks, &contents, &resources)
            .is_err()
    );
    // Then no partial record, block or resource survives, and retry is safe.
    assert_eq!(store.document(&record.id).unwrap(), None);
    assert_eq!(
        store
            .document_block(&record.id, "chapter-one", "bridge-0")
            .unwrap(),
        None
    );
    assert_eq!(
        store.document_resource(&record.id, "chapter-one").unwrap(),
        None
    );
    for table in [
        "documents",
        "document_blocks",
        "document_resources",
        "document_navigation",
    ] {
        assert_eq!(
            db.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row
                .get::<_, u32>(0))
                .unwrap(),
            0
        );
    }
    db.execute_batch("DROP TRIGGER fail_document_navigation")
        .unwrap();
    assert_eq!(
        store
            .import_document(&record, &blocks, &contents, &resources)
            .unwrap(),
        record
    );
}

#[test]
fn schema_six_migration_retains_review_material_and_accepted_settings() {
    // Given persisted Review, Material and settings in the preceding schema.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("profile");
    let mut store = ProfileStore::open(&path).unwrap();
    let item = support::admission(&mut store, "retained-material");
    let session = support::start(
        &mut store,
        "retained-review",
        &[item],
        ReviewMode::Continuous,
    );
    let session = support::reveal(&mut store, &session, "reveal-retained");
    let theme = ThemeDocument {
        name: "retained-settings".into(),
        ..Default::default()
    };
    store.save_theme(&theme, 0, "retained-theme").unwrap();
    drop(store);
    let db = rusqlite::Connection::open(&path).unwrap();
    let material: String = db
        .query_row("SELECT content FROM materials", [], |row| row.get(0))
        .unwrap();
    db.execute_batch("DROP TABLE document_navigation; DROP TABLE document_blocks; DROP TABLE document_resources; DROP TABLE documents; DROP TABLE view_preference_receipts; DROP TABLE view_preferences; PRAGMA user_version=5;").unwrap();
    drop(db);
    // When the additive schema6 migration runs.
    let mut store = ProfileStore::open(&path).unwrap();
    // Then all prior authority survives and new document tables work.
    assert_eq!(store.review_session(&session.id).unwrap(), session);
    assert_eq!(store.preferences().unwrap(), (1, theme));
    let db = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        db.query_row("SELECT content FROM materials", [], |row| row
            .get::<_, String>(0))
            .unwrap(),
        material
    );
    assert_eq!(
        db.pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
            .unwrap(),
        12
    );
    let (record, blocks, resources) = fixture(1);
    store
        .import_document(&record, &blocks, &[], &resources)
        .unwrap();
    assert_eq!(store.document(&record.id).unwrap(), Some(record));
}

#[test]
fn malformed_or_oversized_admission_never_persists_a_partial_projection() {
    // Given a fresh real database for each malformed projection shape.
    for case in 0..19 {
        let dir = tempfile::tempdir().unwrap();
        let mut store = ProfileStore::open(&dir.path().join("profile")).unwrap();
        let (mut record, mut blocks, mut resources) = fixture(2);
        let mut contents = vec![];
        match case {
            0 => record.total_blocks = 3,
            1 => blocks[1].id = blocks[0].id.clone(),
            2 => blocks[1].resource = "unregistered".into(),
            3 => resources.push(resources[0].clone()),
            4 => resources[0].source_id = "another-book".into(),
            5 => contents.push(DocumentNavigation {
                label: "missing block".into(),
                position: position("missing", 0),
            }),
            6 => contents.push(DocumentNavigation {
                label: "old parser".into(),
                position: DocumentPosition {
                    parser_revision: "stale".into(),
                    ..position("bridge-1", 0)
                },
            }),
            7 => blocks[0].readings[0].start = 2,
            8 => blocks[0].readings[0].end = 1000,
            9 => {
                blocks[0].text = "x".repeat(64 * 1024 + 1);
                blocks[0].readings.clear();
            }
            10 => {
                (record, blocks, resources) = fixture(33);
                for block in &mut blocks {
                    block.text = "x".repeat(64 * 1024);
                    block.readings.clear();
                }
            }
            11 => {
                contents = vec![
                    DocumentNavigation {
                        label: "chapter".into(),
                        position: position("bridge-0", 0),
                    };
                    1025
                ]
            }
            12 => resources = vec![resources[0].clone(); 129],
            13 => (record, blocks, resources) = fixture(1025),
            14 => resources[0].byte_length = 8 * 1024 * 1024 + 1,
            15 => blocks[0].page = Some(0),
            16 => blocks[0].id = "x".repeat(513),
            17 => record.appearance.line_height = f64::NAN,
            18 => contents.push(DocumentNavigation {
                label: "split scalar".into(),
                position: position("bridge-0", 2),
            }),
            _ => unreachable!(),
        }
        // When storage admits malformed identity, anchors, scalar spans or bounds.
        assert!(
            store
                .import_document(&record, &blocks, &contents, &resources)
                .is_err(),
            "case {case}"
        );
        // Then no new document or resource authority exists.
        assert_eq!(store.document("book-one").unwrap(), None, "case {case}");
        assert_eq!(
            store.document_resource("book-one", "chapter-one").unwrap(),
            None
        );
        assert!(store.recent_documents().unwrap().is_empty());
    }
}

#[test]
fn resource_block_pair_identity_and_resource_order_are_not_array_positions() {
    // Given identical block IDs and text in different original source resources.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile")).unwrap();
    let (record, mut blocks, mut resources) = fixture(2);
    resources[0].byte_length = 8 * 1024 * 1024;
    let second = DocumentResourceLocation {
        resource_id: "chapter-two".into(),
        ..resources[0].clone()
    };
    resources.push(second);
    blocks[1].id = blocks[0].id.clone();
    blocks[1].resource = "chapter-two".into();
    store
        .import_document(&record, &blocks, &[], &resources)
        .unwrap();
    let second_position = DocumentPosition {
        resource: "chapter-two".into(),
        ..position("bridge-0", 5)
    };
    // When source resources arrive in another order on duplicate import.
    resources.reverse();
    assert_eq!(
        store
            .import_document(&record, &blocks, &[], &resources)
            .unwrap(),
        record
    );
    let window = store
        .document_window(&record.id, Some(&second_position))
        .unwrap();
    // Then the original resource+block pair selects only the intended passage.
    assert_eq!(window.blocks, blocks[1..]);
    assert_eq!(window.previous, Some(position("bridge-0", 0)));
    assert_eq!(window.next, None);
}

#[test]
fn byte_budget_stops_window_before_eight_blocks_and_pdf_pages_stay_source_metadata() {
    // Given source PDF pages with a payload budget smaller than eight blocks.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile")).unwrap();
    let (mut record, mut blocks, resources) = fixture(3);
    record.format = DocumentFormat::Pdf;
    record.total_pages = 3;
    for (index, block) in blocks.iter_mut().enumerate() {
        block.text = "x".repeat(40 * 1024);
        block.readings.clear();
        block.page = Some(u32::try_from(index).unwrap());
    }
    store
        .import_document(&record, &blocks, &[], &resources)
        .unwrap();
    // When the first source window is read.
    let window = store.document_window(&record.id, None).unwrap();
    // Then source totals and pages are untouched while the byte budget limits the window.
    assert_eq!(window.blocks, blocks[..1]);
    assert_eq!(window.next, Some(position("bridge-1", 0)));
    assert_eq!(window.source.total_pages, 3);
    assert_eq!(window.source.total_blocks, 3);
    let mut invalid = record.clone();
    invalid.id = "invalid-pdf".into();
    let mut invalid_resources = resources.clone();
    invalid_resources[0].source_id = invalid.id.clone();
    blocks[2].page = Some(3);
    assert!(
        store
            .import_document(&invalid, &blocks, &[], &invalid_resources)
            .is_err()
    );
    assert_eq!(store.document(&invalid.id).unwrap(), None);
}

#[test]
fn recent_documents_are_capped_without_profile_or_learning_state_reads() {
    // Given seventeen independent documents in the same profile.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile")).unwrap();
    for index in 0..17 {
        let (mut record, blocks, mut resources) = fixture(1);
        record.id = format!("book-{index}");
        resources[0].source_id = record.id.clone();
        store
            .import_document(&record, &blocks, &[], &resources)
            .unwrap();
    }
    // When the bounded recent-document projection is requested.
    let recents = store.recent_documents().unwrap();
    // Then only sixteen source records are returned.
    assert_eq!(recents.len(), 16);
    assert!(recents.iter().all(|record| record.total_blocks == 1));
}
