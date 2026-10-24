#[path = "support/review.rs"]
mod support;
use mlearn_core::*;
use mlearn_storage::{ProfileStore, StorageError};
use support::*;

#[test]
fn selected_non_due_practice_preserves_scheduler_and_native_purpose_across_restart() {
    // Given a previously scheduled selected Material and an unrelated due Material.
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("profile");
    let mut store = ProfileStore::open(&path).unwrap();
    let selected = admission(&mut store, "selected");
    let unrelated = admission(&mut store, "unrelated");
    let scheduled = start(
        &mut store,
        "scheduled",
        std::slice::from_ref(&selected),
        ReviewMode::Continuous,
    );
    let scheduled = reveal(&mut store, &scheduled, "scheduled-reveal");
    submit(&mut store, &scheduled, "scheduled-submit");
    let original_schedule = schedule(&store, &selected);
    assert!(original_schedule.as_ref().unwrap().due_at > 100);

    // When explicit practice admits that same not-due selection and restarts paused.
    let session = start(
        &mut store,
        "practice",
        std::slice::from_ref(&selected),
        practice(std::slice::from_ref(&selected)),
    );
    let paused = store
        .review_apply(
            &ReviewCommand::Pause {
                mutation: mutation(&session, "pause"),
            },
            101,
        )
        .unwrap()
        .session;
    drop(store);
    let mut store = ProfileStore::open(&path).unwrap();
    let resumed = store
        .review_apply(
            &ReviewCommand::Resume {
                mutation: mutation(&paused, "resume"),
            },
            102,
        )
        .unwrap()
        .session;
    let revealed = reveal(&mut store, &resumed, "practice-reveal");
    let completed = submit(&mut store, &revealed, "practice-submit");

    // Then membership, exposure and purpose are exact, without consuming scheduled due work.
    assert_eq!(resumed.mode, practice(std::slice::from_ref(&selected)));
    assert_eq!(resumed.encounter, session.encounter);
    assert_eq!(completed.total, Some(1));
    assert_eq!(completed.state, ReviewSessionState::Complete);
    assert_eq!(schedule(&store, &selected), original_schedule);
    assert!(schedule(&store, &unrelated).is_none());
    let ordinary = start(
        &mut store,
        "ordinary",
        std::slice::from_ref(&unrelated),
        ReviewMode::Continuous,
    );
    assert_eq!(
        ordinary.encounter.unwrap().material_id,
        unrelated.material_id
    );
}

#[test]
fn practice_undo_correction_and_retry_replace_one_qualified_report_without_scheduler_writes() {
    // Given one genuinely unassisted practice report and a frozen original source.
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("profile");
    let mut store = ProfileStore::open(&path).unwrap();
    let item = admission(&mut store, "one");
    let session = start(
        &mut store,
        "practice",
        std::slice::from_ref(&item),
        practice(std::slice::from_ref(&item)),
    );
    let revealed = reveal(&mut store, &session, "reveal");
    let command = ReviewCommand::Submit {
        mutation: mutation(&revealed, "submit"),
        response: response(&revealed, Some(AttemptQuality::Fluent)),
    };
    let submitted = store.review_apply(&command, 102).unwrap();
    assert_eq!(
        store.knowledge(&[key("meaning")]).unwrap()[0].assessed,
        Some(true)
    );
    let undone = store
        .review_apply(
            &ReviewCommand::Undo {
                mutation: mutation(&submitted.session, "undo"),
            },
            103,
        )
        .unwrap()
        .session;
    assert_eq!(
        store.knowledge(&[key("meaning")]).unwrap()[0].assessed,
        None
    );
    drop(store);
    let mut store = ProfileStore::open(&path).unwrap();

    // When correction replaces the original physical report and its receipt is retried.
    let correction = ReviewCommand::Correct {
        mutation: mutation(&undone, "correct"),
        response: response(&undone, Some(AttemptQuality::Missed)),
    };
    let corrected = store.review_apply(&correction, 999).unwrap();
    let replay = store.review_apply(&correction, 1000).unwrap();

    // Then original exposure/source and a single practice attempt remain, never a Review schedule.
    assert_eq!(replay, corrected);
    assert_eq!(corrected.session.completed, 1);
    assert_eq!(
        store.knowledge(&[key("meaning")]).unwrap()[0].assessed,
        Some(false)
    );
    assert!(schedule(&store, &item).is_none());
    assert_eq!(
        undone.encounter.as_ref().unwrap().conditions,
        revealed.encounter.as_ref().unwrap().conditions
    );
    assert_eq!(
        store
            .review_source(&session.id, &revealed.encounter.as_ref().unwrap().id)
            .unwrap(),
        item.source
    );
    let db = rusqlite::Connection::open(&path).unwrap();
    let attempts: u32 = db
        .query_row("SELECT COUNT(*) FROM review_attempts", [], |r| r.get(0))
        .unwrap();
    assert_eq!(attempts, 1);
    let purpose: String = db.query_row("SELECT json_extract(s.projection,'$.mode.kind') FROM review_attempts a JOIN review_sessions s ON s.id=a.session_id", [], |r| r.get(0)).unwrap();
    assert_eq!(purpose, "practice");
    assert_eq!(
        store.review_apply(&command, 1001).unwrap().session,
        corrected.session
    );
}

#[test]
fn practice_admission_rejects_missing_duplicate_excluded_or_broadened_membership_atomically() {
    // Given selected, other and excluded saved Materials.
    let directory = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&directory.path().join("profile")).unwrap();
    let selected = admission(&mut store, "selected");
    let other = admission(&mut store, "other");
    let excluded = admission(&mut store, "excluded");
    let material = store.material(&excluded.material_id).unwrap();
    store
        .update_material(&MaterialEdit {
            command_id: "exclude".into(),
            id: material.id,
            expected_revision: material.revision,
            content: material.content,
            excluded: true,
            media_imports: vec![],
        })
        .unwrap();
    let cases = [
        (ReviewMode::Practice { items: vec![] }, vec![]),
        (
            practice(&[selected.clone(), selected.clone()]),
            vec![selected.clone()],
        ),
        (practice(std::slice::from_ref(&selected)), vec![other]),
        (practice(std::slice::from_ref(&selected)), vec![]),
        (practice(std::slice::from_ref(&excluded)), vec![excluded]),
        (
            ReviewMode::Practice {
                items: vec![PracticeItem {
                    material_id: MaterialId("missing".into()),
                    source: None,
                }],
            },
            vec![],
        ),
    ];
    // When each invalid explicit scope tries admission.
    for (index, (mode, admissions)) in cases.into_iter().enumerate() {
        let start = ReviewStart {
            command_id: format!("bad-{index}"),
            session_id: ReviewSessionId(format!("bad-{index}")),
            mode,
        };
        assert!(matches!(
            store.review_start(&start, &admissions, 100),
            Err(StorageError::Invalid(_))
        ));
        // Then failure leaves neither a successful receipt nor partial frozen work.
        assert!(
            store
                .review_receipt(&ReviewCommand::Start { start })
                .unwrap()
                .is_none()
        );
    }
    assert!(store.review_sessions().unwrap().is_empty());
}

#[test]
fn practice_capture_exclusion_is_native_and_receipt_failure_keeps_retry_identity() {
    // Given a selected canonical Material whose capture exclusion is independently owned.
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("profile");
    let mut store = ProfileStore::open(&path).unwrap();
    let item = admission(&mut store, "selected");
    store
        .set_capture_exclusion(&CaptureExclusion {
            command_id: "exclude".into(),
            target: MaterialTarget {
                package_id: "package".into(),
                target_id: "stable".into(),
            },
            excluded: true,
        })
        .unwrap();
    let start = ReviewStart {
        command_id: "practice".into(),
        session_id: ReviewSessionId("practice".into()),
        mode: practice(std::slice::from_ref(&item)),
    };
    assert!(
        store
            .review_start(&start, std::slice::from_ref(&item), 100)
            .is_err()
    );
    store
        .set_capture_exclusion(&CaptureExclusion {
            command_id: "include".into(),
            target: MaterialTarget {
                package_id: "package".into(),
                target_id: "stable".into(),
            },
            excluded: false,
        })
        .unwrap();
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch("CREATE TRIGGER fail_receipt BEFORE INSERT ON review_receipts BEGIN SELECT RAISE(ABORT,'disk failure fixture'); END;").unwrap();

    // When persistence fails after admission, then the unchanged intent recovers.
    assert!(
        store
            .review_start(&start, std::slice::from_ref(&item), 100)
            .is_err()
    );
    assert!(store.review_sessions().unwrap().is_empty());
    db.execute_batch("DROP TRIGGER fail_receipt;").unwrap();
    let committed = store
        .review_start(&start, std::slice::from_ref(&item), 100)
        .unwrap();

    // Then the exact command is committed once and no scheduled work is manufactured.
    assert_eq!(store.review_start(&start, &[], 999).unwrap(), committed);
    assert_eq!(store.review_sessions().unwrap().len(), 1);
    assert!(schedule(&store, &item).is_none());
}
