use mlearn_core::*;
use mlearn_storage::ProfileStore;

fn fixture() -> (tempfile::TempDir, ProfileStore, DocumentRecord) {
    let directory = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&directory.path().join("profile.sqlite3")).unwrap();
    let record = DocumentRecord {
        id: "images".into(),
        title: "Collection".into(),
        document_path: "/owned/images".into(),
        content_revision: "revision".into(),
        parser_revision: "images-1".into(),
        format: DocumentFormat::Images,
        package_id: "package".into(),
        package_version: "1".into(),
        position: None,
        appearance: Default::default(),
        progression: None,
        total_blocks: 2,
        total_pages: 2,
        fidelity: vec![],
    };
    let blocks: Vec<_> = (0..2)
        .map(|index| DocumentBlock {
            resource: format!("page-{index}"),
            id: format!("block-{index}"),
            kind: "image".into(),
            text: String::new(),
            readings: vec![],
            image: Some(DocumentImage {
                resource_id: format!("page-{index}"),
                alt: "".into(),
            }),
            page: Some(index),
            writing_mode: None,
        })
        .collect();
    let resources: Vec<_> = blocks
        .iter()
        .map(|block| DocumentResourceLocation {
            source_id: record.id.clone(),
            resource_id: block.resource.clone(),
            path: format!("/owned/{}.png", block.resource),
            mime_type: "image/png".into(),
            byte_length: 1024,
        })
        .collect();
    store
        .import_document(&record, &blocks, &[], &resources)
        .unwrap();
    (directory, store, record)
}

fn request(id: &str) -> OcrRequest {
    OcrRequest {
        request_id: id.into(),
        source_id: "images".into(),
        content_revision: "revision".into(),
        resource_id: "page-0".into(),
        provider_id: "fixture-provider".into(),
        recognition_languages: vec!["en".into()],
        crop: None,
    }
}
fn plan(request: &OcrRequest) -> OcrPlan {
    OcrPlan {
        request_id: request.request_id.clone(),
        source_id: request.source_id.clone(),
        content_revision: request.content_revision.clone(),
        resource_id: request.resource_id.clone(),
        path: "/owned/page-0.png".into(),
        mime_type: "image/png".into(),
        page_index: None,
        crop: request.crop.clone(),
        provider_id: request.provider_id.clone(),
        recognition_languages: request.recognition_languages.clone(),
    }
}
fn region(id: &str, x: f64, text: &str) -> OcrRegion {
    OcrRegion {
        id: id.into(),
        text: text.into(),
        quad: OcrQuad {
            top_left: OcrPoint { x, y: 0.1 },
            top_right: OcrPoint { x: x + 0.1, y: 0.1 },
            bottom_right: OcrPoint { x: x + 0.1, y: 0.2 },
            bottom_left: OcrPoint { x, y: 0.2 },
        },
        candidates: vec![OcrCandidate {
            text: text.into(),
            confidence: None,
        }],
        language: None,
        orientation: None,
        reading_of: None,
        context_region_ids: None,
    }
}
fn result(request: &OcrRequest) -> OcrNativeResult {
    OcrNativeResult {
        request_id: request.request_id.clone(),
        provider: OcrProvider {
            id: request.provider_id.clone(),
            label: "Explicit test boundary".into(),
            revision: "1".into(),
            availability: OcrAvailability::Ready,
            languages: vec!["en".into()],
            scripts: vec!["Latn".into()],
            language_provenance: "deterministic storage fixture, not recognition".into(),
            reason: None,
        },
        width: 1000,
        height: 1000,
        crop: request.crop.clone(),
        stage_evidence: None,
        regions: vec![
            region("0", 0.1, "A😀 bridge"),
            region("1", 0.7, "Read again."),
        ],
    }
}
fn recognize(store: &mut ProfileStore, id: &str) -> OcrPage {
    let request = request(id);
    store.plan_ocr(&request, &plan(&request)).unwrap();
    store.complete_ocr(&result(&request)).unwrap()
}

#[test]
fn retry_recovery_distinguishes_cancelled_work_and_replays_only_the_committed_revision() {
    let (directory, mut store, _) = fixture();
    let cancelled = request("cancelled");
    assert_eq!(
        store.ocr_recovery(&cancelled).unwrap(),
        OcrRecovery::Unknown
    );
    store.plan_ocr(&cancelled, &plan(&cancelled)).unwrap();
    assert_eq!(
        store.ocr_recovery(&cancelled).unwrap(),
        OcrRecovery::Pending
    );
    store.cancel_ocr(&cancelled.request_id).unwrap();
    assert_eq!(
        store.ocr_recovery(&cancelled).unwrap(),
        OcrRecovery::Cancelled
    );
    assert!(store.plan_ocr(&cancelled, &plan(&cancelled)).is_err());

    let fresh = request("fresh");
    store.plan_ocr(&fresh, &plan(&fresh)).unwrap();
    let committed = store.complete_ocr(&result(&fresh)).unwrap();
    let mut edited = committed.regions[0].clone();
    edited.text = "Later user correction".into();
    let current = store
        .correct_ocr(&OcrCorrection {
            command_id: "edit-after-completion".into(),
            source_id: fresh.source_id.clone(),
            content_revision: fresh.content_revision.clone(),
            resource_id: fresh.resource_id.clone(),
            expected_revision: committed.ocr_revision,
            region: edited,
        })
        .unwrap();
    // Native cleanup may race a lost completion receipt. A committed result
    // wins over its cancellation tombstone and never becomes a fresh inference.
    store.cancel_ocr(&fresh.request_id).unwrap();
    store.cancel_ocr("cancelled-before-plan").unwrap();
    let interrupted = request("interrupted");
    store.plan_ocr(&interrupted, &plan(&interrupted)).unwrap();
    store.interrupt_ocr().unwrap();
    drop(store);

    let store = ProfileStore::open(&directory.path().join("profile.sqlite3")).unwrap();
    assert_eq!(
        store.ocr_recovery(&fresh).unwrap(),
        OcrRecovery::Completed {
            page: Box::new(committed)
        }
    );
    assert_eq!(
        store.ocr_recovery(&cancelled).unwrap(),
        OcrRecovery::Cancelled
    );
    assert_eq!(
        store.ocr_recovery(&interrupted).unwrap(),
        OcrRecovery::Cancelled
    );
    assert_eq!(
        store
            .ocr_recovery(&request("cancelled-before-plan"))
            .unwrap(),
        OcrRecovery::Cancelled
    );
    assert_eq!(
        store.ocr_base_page("images", "page-0").unwrap(),
        Some(current)
    );
    let mut forged = fresh.clone();
    forged.resource_id = "page-1".into();
    assert!(store.ocr_recovery(&forged).is_err());
}

#[test]
fn provider_evidence_and_corrections_survive_restart_without_mutating_frozen_pages() {
    // Given provider evidence, including a nonrectangular corner outside the source.
    let (directory, mut store, _) = fixture();
    let request = request("first");
    let mut actual = result(&request);
    actual.regions[0].quad.top_left.x = -0.001;
    actual.regions[0].quad.top_right.y = 0.11;
    actual.regions[0].candidates[0].confidence = Some(0.37);
    store.plan_ocr(&request, &plan(&request)).unwrap();
    let original = store.complete_ocr(&actual).unwrap();
    let mut corrected_region = original.regions[0].clone();
    corrected_region.text = "Corrected bridge".into();
    let correction = OcrCorrection {
        command_id: "correct".into(),
        source_id: "images".into(),
        content_revision: "revision".into(),
        resource_id: "page-0".into(),
        expected_revision: 1,
        region: corrected_region,
    };
    let corrected = store.correct_ocr(&correction).unwrap();
    drop(store);
    // When uncertain completion/correction retries arrive after restart.
    let mut store = ProfileStore::open(&directory.path().join("profile.sqlite3")).unwrap();
    assert_eq!(store.complete_ocr(&actual).unwrap(), original);
    assert_eq!(store.correct_ocr(&correction).unwrap(), corrected);
    // Then raw evidence and both immutable source projections remain exact.
    assert_eq!(
        store.ocr_evidence("images", "page-0", 1).unwrap().result,
        Some(actual)
    );
    assert_eq!(
        store.ocr_page("images", "page-0", Some(1)).unwrap(),
        Some(original)
    );
    assert_eq!(
        store.ocr_page("images", "page-0", None).unwrap(),
        Some(corrected)
    );
    assert_eq!(
        store
            .ocr_evidence("images", "page-0", 2)
            .unwrap()
            .correction,
        Some(correction)
    );
}

#[test]
fn crop_replacement_preserves_unrelated_regions_and_raw_observation_order() {
    // Given two separate source regions and a crop over only the first.
    let (_directory, mut store, _) = fixture();
    let original = recognize(&mut store, "first");
    let mut request = request("crop");
    request.crop = Some(OcrRect {
        x: 0.0,
        y: 0.0,
        width: 0.5,
        height: 0.5,
    });
    let mut crop_result = result(&request);
    crop_result.regions = vec![region("0", 0.2, "Replacement")];
    store.plan_ocr(&request, &plan(&request)).unwrap();
    // When crop observations use their actual request-local ID again.
    let page = store.complete_ocr(&crop_result).unwrap();
    // Then the unrelated region is byte-for-byte unchanged, and raw IDs are not rewritten.
    assert_eq!(page.regions[0], original.regions[1]);
    assert_eq!(page.regions[1].id, "2:0");
    assert_eq!(page.regions[1].text, "Replacement");
    assert_eq!(
        store.ocr_evidence("images", "page-0", 2).unwrap().result,
        Some(crop_result)
    );
    assert_eq!(
        store.ocr_page("images", "page-0", Some(1)).unwrap(),
        Some(original)
    );
}

#[test]
fn crop_does_not_replace_a_slanted_polygon_whose_bounding_box_alone_overlaps() {
    // Given a slanted source region with an empty corner in its axis-aligned box.
    let (_directory, mut store, _) = fixture();
    let first = request("slanted");
    let mut output = result(&first);
    output.regions[0].quad = OcrQuad {
        top_left: OcrPoint { x: 0.1, y: 0.1 },
        top_right: OcrPoint { x: 0.2, y: 0.1 },
        bottom_right: OcrPoint { x: 0.9, y: 0.8 },
        bottom_left: OcrPoint { x: 0.8, y: 0.9 },
    };
    store.plan_ocr(&first, &plan(&first)).unwrap();
    let original = store.complete_ocr(&output).unwrap();
    let mut crop = request("empty-corner");
    crop.crop = Some(OcrRect {
        x: 0.1,
        y: 0.75,
        width: 0.1,
        height: 0.1,
    });
    let mut output = result(&crop);
    let mut added = region("0", 0.12, "Corner text");
    added.quad = OcrQuad {
        top_left: OcrPoint { x: 0.12, y: 0.77 },
        top_right: OcrPoint { x: 0.18, y: 0.77 },
        bottom_right: OcrPoint { x: 0.18, y: 0.83 },
        bottom_left: OcrPoint { x: 0.12, y: 0.83 },
    };
    output.regions = vec![added];
    store.plan_ocr(&crop, &plan(&crop)).unwrap();
    // When recognition replaces only pixels in the physically separate corner.
    let updated = store.complete_ocr(&output).unwrap();
    // Then the original provider polygon remains intact.
    assert_eq!(updated.regions[..2], original.regions);
}

#[test]
fn cancelled_interrupted_and_stale_completions_cannot_publish_or_occupy_an_unbounded_queue() {
    // Given one admitted action and an attempted second action.
    let (_directory, mut store, _) = fixture();
    let first = request("cancel");
    let second = request("second");
    store.plan_ocr(&first, &plan(&first)).unwrap();
    assert!(store.plan_ocr(&second, &plan(&second)).is_err());
    store.cancel_ocr(&first.request_id).unwrap();
    assert!(store.complete_ocr(&result(&first)).is_err());
    assert!(store.plan_ocr(&first, &plan(&first)).is_err());
    store.plan_ocr(&second, &plan(&second)).unwrap();
    store.interrupt_ocr().unwrap();
    assert!(store.complete_ocr(&result(&second)).is_err());
    let page = recognize(&mut store, "recovered");
    let stale = request("stale");
    store.plan_ocr(&stale, &plan(&stale)).unwrap();
    let mut correction = OcrCorrection {
        command_id: "correct".into(),
        source_id: "images".into(),
        content_revision: "revision".into(),
        resource_id: "page-0".into(),
        expected_revision: page.ocr_revision,
        region: page.regions[0].clone(),
    };
    correction.region.text = "Saved correction".into();
    let corrected = store.correct_ocr(&correction).unwrap();
    // When a native callback returns after the user's correction.
    assert!(store.complete_ocr(&result(&stale)).is_err());
    // Then its stale base cannot replace the admitted correction.
    assert_eq!(
        store.ocr_page("images", "page-0", None).unwrap(),
        Some(corrected)
    );
}

#[test]
fn cancellation_arriving_before_native_planning_remains_a_bounded_tombstone() {
    // Given a cancellation delivered before a queued native planning call.
    let (_directory, mut store, _) = fixture();
    let request = request("cancel-before-plan");
    store.cancel_ocr(&request.request_id).unwrap();
    // When the delayed planning transport arrives with the cancelled identity.
    let planned = store.plan_ocr(&request, &plan(&request));
    // Then it cannot launch a new callback that resurrects the cancelled action.
    assert!(planned.is_err());
    assert!(store.complete_ocr(&result(&request)).is_err());
}

#[test]
fn uncertain_planning_retry_returns_the_current_rust_resolved_path_after_relocation() {
    // Given a previously persisted plan and a host-resolved relocated profile path.
    let (_directory, mut store, _) = fixture();
    let request = request("relocated-retry");
    let original = plan(&request);
    store.plan_ocr(&request, &original).unwrap();
    let mut relocated = original;
    relocated.path = "/new-profile/source/page-0.png".into();
    // When the identical action retries after source location resolution.
    let retried = store.plan_ocr(&request, &relocated).unwrap();
    // Then no stale native-container path escapes from the receipt.
    assert_eq!(retried, relocated);
}

#[test]
fn empty_recognition_is_distinct_from_unavailable_and_malformed_evidence() {
    // Given fresh bounded actions for each invalid provider output.
    let (_directory, mut store, _) = fixture();
    for index in 0..15 {
        let request = request(&format!("invalid-{index}"));
        let mut output = result(&request);
        match index {
            0 => output.provider.availability = OcrAvailability::Unavailable,
            1 => output.provider.id = "wrong-provider".into(),
            2 => output.provider.languages.clear(),
            3 => output.regions[0].quad.top_left.x = f64::INFINITY,
            4 => output.regions[0].candidates[0].confidence = Some(1.1),
            5 => output.regions[0].candidates = vec![output.regions[0].candidates[0].clone(); 4],
            6 => output.regions[0].text = "x".repeat(32769),
            7 => output.regions[1].id = output.regions[0].id.clone(),
            8 => output.regions[0].reading_of = Some("1".into()),
            9 => output.width = 0,
            10 => {
                output.regions = (0..513)
                    .map(|index| region(&index.to_string(), 0.1, "x"))
                    .collect()
            }
            11 => output.width = 65537,
            12 => output.regions[0].candidates[0].text = "x".repeat(32769),
            13 => output.provider.revision = "x".repeat(513),
            14 => output.regions[0].quad.bottom_right = OcrPoint { x: 0.05, y: 0.15 },
            _ => unreachable!(),
        }
        store.plan_ocr(&request, &plan(&request)).unwrap();
        assert!(store.complete_ocr(&output).is_err(), "case {index}");
        store.cancel_ocr(&request.request_id).unwrap();
        assert!(store.ocr_page("images", "page-0", None).unwrap().is_none());
    }
    // When an actual successful empty result crosses the provider boundary.
    let request = request("empty");
    let mut output = result(&request);
    output.regions.clear();
    store.plan_ocr(&request, &plan(&request)).unwrap();
    let page = store.complete_ocr(&output).unwrap();
    // Then it is a persisted successful page, not a missing cache or provider failure.
    assert!(page.regions.is_empty());
    assert_eq!(
        store.ocr_page("images", "page-0", None).unwrap(),
        Some(page)
    );
}

#[test]
fn package_interpretation_does_not_become_raw_evidence_or_erase_user_corrections() {
    // Given explicit package interpretation on top of actual provider rows.
    let (_directory, mut store, _) = fixture();
    let original = recognize(&mut store, "first");
    let mut regions = original.regions.clone();
    regions[1].reading_of = Some("0".into());
    regions[1].context_region_ids = Some(vec!["0".into(), "1".into()]);
    // Reading order is package interpretation, not provider identity.
    regions.reverse();
    let package = OcrPackageProjection {
        package_id: "package".into(),
        package_version: "1".into(),
        package_revision: "package-a".into(),
    };
    let projected = store.project_ocr(&original, &regions, &package).unwrap();
    assert_eq!(
        store.project_ocr(&projected, &regions, &package).unwrap(),
        projected
    );
    let mut correction = OcrCorrection {
        command_id: "edit".into(),
        source_id: "images".into(),
        content_revision: "revision".into(),
        resource_id: "page-0".into(),
        expected_revision: projected.ocr_revision,
        region: projected
            .regions
            .iter()
            .find(|region| region.id == "0")
            .unwrap()
            .clone(),
    };
    correction.region.text = "User correction".into();
    // When the user edits one region after package interpretation.
    let corrected = store.correct_ocr(&correction).unwrap();
    // Then other raw text and explicit edits remain package-independent.
    assert_eq!(corrected.regions[0].text, "User correction");
    assert_eq!(corrected.regions[1], original.regions[1]);
    assert_eq!(
        store.ocr_base_page("images", "page-0").unwrap(),
        Some(corrected)
    );
    assert_eq!(
        store
            .ocr_evidence("images", "page-0", 1)
            .unwrap()
            .result
            .unwrap()
            .regions,
        original.regions
    );
}

#[test]
fn package_context_retains_declared_order_and_original_source_bytes() {
    let (_directory, mut store, _) = fixture();
    let original = recognize(&mut store, "context");
    let mut regions = original.regions.clone();
    regions[0].context_region_ids = Some(vec!["1".into(), "0".into()]);
    let package = OcrPackageProjection {
        package_id: "package".into(),
        package_version: "1".into(),
        package_revision: "context-1".into(),
    };
    let projected = store.project_ocr(&original, &regions, &package).unwrap();
    assert_eq!(
        projected.regions[0].context_region_ids,
        Some(vec!["1".into(), "0".into()])
    );
    assert_eq!(projected.regions[0].text, original.regions[0].text);
    assert_eq!(projected.regions[0].quad, original.regions[0].quad);
    assert!(
        store
            .ocr_evidence("images", "page-0", original.ocr_revision)
            .unwrap()
            .result
            .unwrap()
            .regions[0]
            .context_region_ids
            .is_none()
    );
    regions[0].text = "Rewritten by package".into();
    assert!(store.project_ocr(&original, &regions, &package).is_err());
}

#[test]
fn package_context_rejects_cross_page_duplicate_missing_selection_and_text_overflow() {
    for context in [
        vec!["0".into(), "foreign-page".into()],
        vec!["0".into(), "0".into()],
        vec!["1".into()],
        vec![],
        vec!["0".into(); 17],
    ] {
        let (_directory, mut store, _) = fixture();
        let original = recognize(&mut store, "context");
        let mut regions = original.regions.clone();
        regions[0].context_region_ids = Some(context);
        let package = OcrPackageProjection {
            package_id: "package".into(),
            package_version: "1".into(),
            package_revision: "context-1".into(),
        };
        assert!(store.project_ocr(&original, &regions, &package).is_err());
        assert_eq!(
            store.ocr_page("images", "page-0", None).unwrap(),
            Some(original)
        );
    }
    let (_directory, mut store, _) = fixture();
    let request = request("large-context");
    let mut raw = result(&request);
    raw.regions[0].text = "a".repeat(2500);
    raw.regions[1].text = "b".repeat(2500);
    store.plan_ocr(&request, &plan(&request)).unwrap();
    let original = store.complete_ocr(&raw).unwrap();
    let mut regions = original.regions.clone();
    regions[0].context_region_ids = Some(vec!["0".into(), "1".into()]);
    let package = OcrPackageProjection {
        package_id: "package".into(),
        package_version: "1".into(),
        package_revision: "context-1".into(),
    };
    assert!(store.project_ocr(&original, &regions, &package).is_err());
}

#[test]
fn crop_replacement_invalidates_only_new_projection_context_links() {
    let (_directory, mut store, _) = fixture();
    let original = recognize(&mut store, "context-original");
    let mut region = original.regions[1].clone();
    region.context_region_ids = Some(vec!["1".into(), "0".into()]);
    let corrected = store
        .correct_ocr(&OcrCorrection {
            command_id: "declare-context".into(),
            source_id: "images".into(),
            content_revision: "revision".into(),
            resource_id: "page-0".into(),
            expected_revision: original.ocr_revision,
            region,
        })
        .unwrap();
    let mut request = request("context-crop");
    request.crop = Some(OcrRect {
        x: 0.05,
        y: 0.05,
        width: 0.2,
        height: 0.2,
    });
    let mut native = result(&request);
    native.regions.truncate(1);
    store.plan_ocr(&request, &plan(&request)).unwrap();
    let cropped = store.complete_ocr(&native).unwrap();
    assert!(
        cropped
            .regions
            .iter()
            .find(|r| r.id == "1")
            .unwrap()
            .context_region_ids
            .is_none()
    );
    assert_eq!(
        store
            .ocr_page("images", "page-0", Some(corrected.ocr_revision))
            .unwrap()
            .unwrap()
            .regions[1]
            .context_region_ids,
        Some(vec!["1".into(), "0".into()])
    );
}

#[test]
fn source_page_descriptors_and_preferences_preserve_checkpoint_identity_across_restart() {
    // Given a source page checkpoint and settings affecting only presentation.
    let (directory, mut store, record) = fixture();
    let page = store.image_page("images", 1).unwrap();
    let settings = ImageReaderSettings {
        fit: ImageFit::Width,
        paired: true,
        first_page_single: false,
        collate: true,
        direction: ImageDirection::Rtl,
        show_overlay: false,
        show_annotations: false,
    };
    store
        .checkpoint_document(&DocumentCheckpoint {
            source_id: record.id.clone(),
            content_revision: record.content_revision.clone(),
            position: page.position.clone(),
            appearance: record.appearance,
        })
        .unwrap();
    store
        .save_image_reader_settings("images", &settings)
        .unwrap();
    drop(store);
    // When a restarted reader resolves a specific bounded page.
    let store = ProfileStore::open(&directory.path().join("profile.sqlite3")).unwrap();
    // Then source identity never rounds to a neighboring page or depends on pairing/collation.
    assert_eq!(store.image_page("images", 1).unwrap(), page);
    assert_eq!(store.image_reader_settings("images").unwrap(), settings);
    assert_eq!(
        store.document("images").unwrap().unwrap().position,
        Some(page.position)
    );
    assert!(store.image_page("images", 2).is_err());
    assert!(
        store
            .image_page_for_resource("images", "unregistered")
            .is_err()
    );
}

#[test]
fn additive_page_registry_migration_preserves_existing_sources_ocr_and_preferences() {
    // Given the intermediate schema7 with durable provider evidence and UI settings.
    let (directory, mut store, record) = fixture();
    let original = recognize(&mut store, "before-upgrade");
    let settings = ImageReaderSettings {
        paired: true,
        collate: true,
        ..Default::default()
    };
    store
        .save_image_reader_settings(&record.id, &settings)
        .unwrap();
    drop(store);
    let path = directory.path().join("profile.sqlite3");
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch("DROP TABLE document_pages; DROP TABLE ocr_cancellations;
        CREATE INDEX document_source_pages ON document_blocks(source_id,json_extract(block,'$.page'),ordinal);
        PRAGMA user_version=7;").unwrap();
    drop(db);
    // When the normalized source-page registry replaces the expression index.
    let store = ProfileStore::open(&path).unwrap();
    // Then original source, evidence and presentation settings survive unchanged.
    assert_eq!(store.document(&record.id).unwrap(), Some(record));
    assert_eq!(
        store.ocr_page("images", "page-0", Some(1)).unwrap(),
        Some(original)
    );
    assert_eq!(store.image_reader_settings("images").unwrap(), settings);
    assert_eq!(store.image_page("images", 1).unwrap().resource_id, "page-1");
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute(
        "UPDATE document_blocks SET block='invalid' WHERE block_id='block-1'",
        [],
    )
    .unwrap();
    assert!(store.image_page("images", 0).is_ok());
    assert!(store.image_page("images", 1).is_err());
}
