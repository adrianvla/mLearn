#[path = "support/review.rs"]
mod support;
use mlearn_core::*;
use mlearn_storage::ProfileStore;
use support::*;

#[test]
fn undo_and_correction_preserve_suspended_next_work_and_peer_schedules() {
    // Given a completed response followed by an independently revealed next cue.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile")).unwrap();
    let one = admission(&mut store, "one");
    let two = admission(&mut store, "two");
    let session = start(
        &mut store,
        "s",
        &[one.clone(), two],
        ReviewMode::Finite { limit: 2 },
    );
    let session = reveal(&mut store, &session, "reveal");
    let session = submit(&mut store, &session, "submit");
    let session = store
        .review_next(&mutation(&session, "next"), None, 103)
        .unwrap()
        .session;
    let session = reveal(&mut store, &session, "reveal-next");
    let suspended = session.encounter.clone();
    // A peer owns the same probe scheduler before this session retracts.
    let peer = store
        .review_start(
            &ReviewStart {
                command_id: "start-peer".into(),
                session_id: ReviewSessionId("peer".into()),
                mode: ReviewMode::Continuous,
            },
            std::slice::from_ref(&one),
            100_000,
        )
        .unwrap()
        .session;
    let peer = reveal(&mut store, &peer, "reveal-peer");
    submit(&mut store, &peer, "submit-peer");
    let peer_schedule = schedule(&store, &one);
    // When Undo/correction replace only the original physical response.
    let undone = store
        .review_apply(
            &ReviewCommand::Undo {
                mutation: mutation(&session, "undo"),
            },
            104,
        )
        .unwrap()
        .session;
    assert!(undone.encounter.as_ref().unwrap().correction);
    assert_eq!(
        undone.encounter.as_ref().unwrap().answer.as_deref(),
        Some("answer")
    );
    assert_eq!(undone.completed, 0);
    let corrected = store
        .review_apply(
            &ReviewCommand::Correct {
                mutation: mutation(&undone, "correct"),
                response: response(&undone, Some(AttemptQuality::Missed)),
            },
            105,
        )
        .unwrap()
        .session;
    // Then the peer schedule and exact suspended exposure remain intact.
    assert_eq!(schedule(&store, &one), peer_schedule);
    assert_eq!(corrected.encounter, suspended);
    assert_eq!(corrected.completed, 1);
}

#[test]
fn correction_uses_original_conditions_and_claims_remain_separate() {
    // Given an ordinary revealed retrieval with one unresolved capability.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile")).unwrap();
    let item = admission(&mut store, "one");
    let session = start(
        &mut store,
        "s",
        std::slice::from_ref(&item),
        ReviewMode::Finite { limit: 1 },
    );
    let session = reveal(&mut store, &session, "reveal");
    let mut grades = response(&session, Some(AttemptQuality::Fluent));
    grades.grades[1].quality = None;
    let session = store
        .review_apply(
            &ReviewCommand::Submit {
                mutation: mutation(&session, "submit"),
                response: grades,
            },
            102,
        )
        .unwrap()
        .session;
    assert_eq!(
        store
            .knowledge(&[key("meaning"), key("reading")])
            .unwrap()
            .iter()
            .map(|p| p.assessed)
            .collect::<Vec<_>>(),
        vec![Some(true), None]
    );
    let claimed = store
        .change_claim(&ClaimChange {
            command_id: "claim".into(),
            key: key("meaning"),
            claim: Some(true),
        })
        .unwrap();
    let undone = store
        .review_apply(
            &ReviewCommand::Undo {
                mutation: mutation(&session, "undo"),
            },
            104,
        )
        .unwrap()
        .session;
    assert!(schedule(&store, &item).is_none());
    let inactive = store
        .knowledge_evidence(&KnowledgeEvidenceQuery {
            key: key("meaning"),
            after: None,
        })
        .unwrap();
    assert_eq!(inactive.projection.claim, Some(true));
    assert_eq!(inactive.projection.assessed, None);
    assert_eq!(inactive.assessed_attempt, None);
    assert_eq!(inactive.observations.len(), 1);
    assert!(!inactive.observations[0].active);
    // When correction replaces rather than adds evidence under original conditions.
    store
        .review_apply(
            &ReviewCommand::Correct {
                mutation: mutation(&undone, "correct"),
                response: response(&undone, Some(AttemptQuality::Missed)),
            },
            999,
        )
        .unwrap();
    let projection = &store.knowledge(&[key("meaning")]).unwrap()[0];
    // Then claim takes precedence while the assessment honestly records the correction.
    assert_eq!(projection.claim, claimed.claim);
    assert_eq!(projection.status, "claimed_known");
    assert_eq!(projection.assessed, Some(false));
    let evidence = store
        .knowledge_evidence(&KnowledgeEvidenceQuery {
            key: key("meaning"),
            after: None,
        })
        .unwrap();
    assert_eq!(&evidence.projection, projection);
    assert_eq!(evidence.projection.prediction, None);
    assert_eq!(evidence.claim_revision, Some(claimed.revision));
    assert_eq!(evidence.observations.len(), 1);
    let observation = &evidence.observations[0];
    assert_eq!(observation.attempt_id, inactive.observations[0].attempt_id);
    assert_eq!(
        evidence.assessed_attempt.as_ref(),
        Some(&observation.attempt_id)
    );
    assert!(observation.active);
    assert_eq!(observation.created_at, 102);
    assert_eq!(observation.conditions, inactive.observations[0].conditions);
    assert_eq!(observation.grade.quality, Some(AttemptQuality::Missed));
    assert_eq!(observation.grade.method, ResponseMethod::Remembered);
    assert_eq!(observation.assessed, Some(false));
    assert_eq!(observation.material_id, item.material_id);
    assert_eq!(observation.material_revision, item.material_revision);
    assert_eq!(observation.package_version, item.package_version);
    assert_eq!(observation.package_revision, item.package_revision);
    assert_eq!(observation.source, item.source);
    assert!(!observation.practice);
    assert_eq!(schedule(&store, &item).unwrap().due_at, 162);
    let withdrawn = store
        .change_claim(&ClaimChange {
            command_id: "withdraw".into(),
            key: key("meaning"),
            claim: None,
        })
        .unwrap();
    assert_eq!(withdrawn.status, "assessed_unknown");
    assert_eq!(withdrawn.assessed, Some(false));
}
