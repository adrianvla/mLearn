#[path = "support/review.rs"]
pub mod support;
use mlearn_core::*;
use mlearn_storage::{ProfileStore, StorageError};
use support::*;

#[test]
fn frozen_membership_hidden_answers_and_exact_paused_restart() {
    // Given duplicate admission inputs and a finite user-selected limit.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("profile");
    let mut store = ProfileStore::open(&path).unwrap();
    let one = admission(&mut store, "one");
    let two = admission(&mut store, "two");
    let session = start(
        &mut store,
        "finite",
        &[one.clone(), one.clone(), two],
        ReviewMode::Finite { limit: 2 },
    );
    assert_eq!(session.total, Some(2));
    assert_eq!(session.encounter.as_ref().unwrap().answer, None);
    assert!(
        store
            .review_next(&mutation(&session, "replace"), None, 100)
            .is_err()
    );
    let session = reveal(&mut store, &session, "reveal");
    // When revealed work is paused and the process restarts.
    let paused = store
        .review_apply(
            &ReviewCommand::Pause {
                mutation: mutation(&session, "pause"),
            },
            102,
        )
        .unwrap()
        .session;
    drop(store);
    let mut store = ProfileStore::open(&path).unwrap();
    assert_eq!(store.review_session(&session.id).unwrap(), paused);
    let resumed = store
        .review_apply(
            &ReviewCommand::Resume {
                mutation: mutation(&paused, "resume"),
            },
            103,
        )
        .unwrap()
        .session;
    // Then exact task, exposure and source survive, without replaying admission.
    assert_eq!(resumed.encounter, session.encounter);
    assert_eq!(
        store
            .review_source(&session.id, &session.encounter.as_ref().unwrap().id)
            .unwrap(),
        one.source
    );
    assert_eq!(resumed.completed, 0);
}

#[test]
fn receipts_replay_original_revision_with_current_projection_and_atomic_recovery() {
    // Given an admitted revealed encounter and a real database failure at receipt persistence.
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
    let command = ReviewCommand::Submit {
        mutation: mutation(&session, "submit"),
        response: response(&session, Some(AttemptQuality::Fluent)),
    };
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch("CREATE TRIGGER fail_receipt BEFORE INSERT ON review_receipts BEGIN SELECT RAISE(ABORT,'disk failure fixture'); END;").unwrap();
    assert!(store.review_apply(&command, 102).is_err());
    assert_eq!(store.review_session(&session.id).unwrap(), session);
    assert!(schedule(&store, &item).is_none());
    assert_eq!(
        store.knowledge(&[key("meaning")]).unwrap()[0].assessed,
        None
    );
    db.execute_batch("DROP TRIGGER fail_receipt;").unwrap();
    // When the exact command retries and the current session later changes.
    let committed = store.review_apply(&command, 102).unwrap();
    let paused = store
        .review_apply(
            &ReviewCommand::Pause {
                mutation: mutation(&committed.session, "pause"),
            },
            103,
        )
        .unwrap()
        .session;
    drop(store);
    let mut store = ProfileStore::open(&path).unwrap();
    let replay = store.review_apply(&command, 999).unwrap();
    // Then retry neither doubles progress nor returns an obsolete session.
    assert_eq!(replay.committed_revision, committed.committed_revision);
    assert_eq!(replay.session, paused);
    assert_eq!(replay.session.completed, 1);
    let mut different = command.clone();
    if let ReviewCommand::Submit { response, .. } = &mut different {
        response.grades[0].quality = Some(AttemptQuality::Missed);
    }
    assert!(matches!(
        store.review_receipt(&different),
        Err(StorageError::Invalid(_))
    ));
    assert!(
        store
            .review_apply(
                &ReviewCommand::Submit {
                    mutation: mutation(&session, "other"),
                    response: response(&session, Some(AttemptQuality::Missed))
                },
                103
            )
            .is_err()
    );
}
