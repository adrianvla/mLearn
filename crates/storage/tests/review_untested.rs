#[path = "support/review.rs"]
mod support;
use mlearn_core::*;
use mlearn_storage::ProfileStore;
use support::*;

#[test]
fn untested_correction_skips_same_work_without_inventing_evidence_or_schedule() {
    // Given a real response corrected to wholly untested.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("profile");
    let mut store = ProfileStore::open(&path).unwrap();
    let item = admission(&mut store, "one");
    let other = admission(&mut store, "other");
    let session = start(
        &mut store,
        "s",
        std::slice::from_ref(&item),
        ReviewMode::Continuous,
    );
    let session = reveal(&mut store, &session, "reveal");
    let session = submit(&mut store, &session, "submit");
    let undone = store
        .review_apply(
            &ReviewCommand::Undo {
                mutation: mutation(&session, "undo"),
            },
            103,
        )
        .unwrap()
        .session;
    let session = store
        .review_apply(
            &ReviewCommand::Correct {
                mutation: mutation(&undone, "correct"),
                response: response(&undone, None),
            },
            104,
        )
        .unwrap()
        .session;
    drop(store);
    let mut store = ProfileStore::open(&path).unwrap();
    assert!(
        store
            .review_work_untested(&session.id, &item.work_id)
            .unwrap()
    );
    assert!(schedule(&store, &item).is_none());
    assert_eq!(
        store.knowledge(&[key("meaning")]).unwrap()[0].assessed,
        None
    );
    // When the stale continuous candidate is retried.
    let mutation = mutation(&session, "next");
    assert!(store.review_next(&mutation, Some(&item), 105).is_err());
    assert!(
        store
            .review_receipt(&ReviewCommand::Next {
                mutation: mutation.clone()
            })
            .unwrap()
            .is_none()
    );
    // Then another due work can use the uncommitted identity; no fake grade is needed.
    let next = store
        .review_next(&mutation, Some(&other), 105)
        .unwrap()
        .session;
    assert_eq!(next.encounter.unwrap().work_id, other.work_id);
    assert_eq!(next.completed, 1);
}

#[test]
fn tested_work_can_recur_when_due_in_a_continuous_session() {
    // Given a tested probe with a real due schedule.
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile")).unwrap();
    let item = admission(&mut store, "one");
    let session = start(
        &mut store,
        "s",
        std::slice::from_ref(&item),
        ReviewMode::Continuous,
    );
    let session = reveal(&mut store, &session, "reveal");
    let session = submit(&mut store, &session, "submit");
    assert!(
        !store
            .review_work_untested(&session.id, &item.work_id)
            .unwrap()
    );
    let due = schedule(&store, &item).unwrap().due_at;
    // When genuinely due again, the same session can continue without a seen-work cap.
    let session = store
        .review_next(&mutation(&session, "next"), Some(&item), due)
        .unwrap()
        .session;
    // Then recurrence is an explicit new encounter with prior-disclosure conditions.
    let encounter = session.encounter.unwrap();
    assert_eq!(encounter.work_id, item.work_id);
    assert!(
        encounter
            .conditions
            .assistance
            .contains(&ReviewAssistance::PriorDisclosure)
    );
    assert_eq!(encounter.answer, None);
}

#[test]
fn wholly_untested_response_can_be_corrected_without_becoming_a_second_attempt() {
    // Given an initially untested response with no scheduler mutation.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("profile");
    let mut store = ProfileStore::open(&path).unwrap();
    let item = admission(&mut store, "one");
    let session = start(
        &mut store,
        "s",
        std::slice::from_ref(&item),
        ReviewMode::Continuous,
    );
    let session = reveal(&mut store, &session, "reveal");
    let session = store
        .review_apply(
            &ReviewCommand::Submit {
                mutation: mutation(&session, "submit"),
                response: response(&session, None),
            },
            102,
        )
        .unwrap()
        .session;
    let undone = store
        .review_apply(
            &ReviewCommand::Undo {
                mutation: mutation(&session, "undo"),
            },
            103,
        )
        .unwrap()
        .session;
    drop(store);
    let mut store = ProfileStore::open(&path).unwrap();
    // When the user replaces that report after restart.
    let corrected = store
        .review_apply(
            &ReviewCommand::Correct {
                mutation: mutation(&undone, "correct"),
                response: response(&undone, Some(AttemptQuality::Missed)),
            },
            999,
        )
        .unwrap()
        .session;
    // Then one attempt is scheduled at its original time, and exclusion is withdrawn.
    assert_eq!(corrected.completed, 1);
    assert!(
        !store
            .review_work_untested(&corrected.id, &item.work_id)
            .unwrap()
    );
    assert_eq!(schedule(&store, &item).unwrap().due_at, 162);
    assert_eq!(
        store.knowledge(&[key("meaning")]).unwrap()[0].assessed,
        Some(false)
    );
}
