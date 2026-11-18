#[path = "support/review.rs"]
mod support;
use mlearn_core::*;
use mlearn_storage::ProfileStore;
use support::*;

fn report(store: &mut ProfileStore, item: &ReviewAdmission, index: u32) {
    let id = format!("evidence-{index}");
    let session = start(
        store,
        &id,
        std::slice::from_ref(item),
        practice(std::slice::from_ref(item)),
    );
    let session = reveal(store, &session, &format!("reveal-{id}"));
    let mut response = response(&session, Some(AttemptQuality::Fluent));
    if index % 2 == 1 {
        for grade in &mut response.grades {
            grade.method = ResponseMethod::WorkedOut;
        }
    }
    store
        .review_apply(
            &ReviewCommand::Submit {
                mutation: mutation(&session, &format!("submit-{id}")),
                response,
            },
            1000 + i64::from(index),
        )
        .unwrap();
}

#[test]
fn evidence_pages_preserve_physical_attempts_and_capability_identity_across_restart() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("profile");
    let mut store = ProfileStore::open(&path).unwrap();
    let item = admission(&mut store, "authored");
    for index in 0..40 {
        report(&mut store, &item, index);
    }

    let first = store
        .knowledge_evidence(&KnowledgeEvidenceQuery {
            key: key("meaning"),
            after: None,
        })
        .unwrap();
    assert_eq!(
        first.projection,
        store.knowledge(&[key("meaning")]).unwrap()[0]
    );
    assert_eq!(first.projection.assessed, Some(true));
    assert_eq!(first.projection.prediction, None);
    assert_eq!(first.claim_revision, None);
    assert_eq!(first.observations.len(), 16);
    assert!(first.observations.iter().all(|item| item.practice));
    assert_eq!(
        first.observations[0].grade.method,
        ResponseMethod::WorkedOut
    );
    assert_eq!(first.observations[0].assessed, None);
    assert_eq!(
        first.assessed_attempt.as_ref(),
        Some(&first.observations[1].attempt_id)
    );
    let cursor = first.next.clone().unwrap();
    assert!(
        store
            .knowledge_evidence(&KnowledgeEvidenceQuery {
                key: key("reading"),
                after: Some(cursor.clone()),
            })
            .is_err()
    );
    drop(store);

    let mut store = ProfileStore::open(&path).unwrap();
    let second = store
        .knowledge_evidence(&KnowledgeEvidenceQuery {
            key: key("meaning"),
            after: Some(cursor.clone()),
        })
        .unwrap();
    assert_eq!(second.observations.len(), 16);
    let third = store
        .knowledge_evidence(&KnowledgeEvidenceQuery {
            key: key("meaning"),
            after: second.next,
        })
        .unwrap();
    assert_eq!(third.observations.len(), 8);
    assert!(third.next.is_none());
    let ids = first
        .observations
        .iter()
        .chain(&second.observations)
        .chain(&third.observations)
        .map(|item| &item.attempt_id.0)
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(ids.len(), 40);
    assert!(first.observations.last().unwrap().sequence > second.observations[0].sequence);
    store
        .change_claim(&ClaimChange {
            command_id: "claim".into(),
            key: key("meaning"),
            claim: Some(false),
        })
        .unwrap();
    assert!(
        store
            .knowledge_evidence(&KnowledgeEvidenceQuery {
                key: key("meaning"),
                after: Some(cursor)
            })
            .is_err()
    );
    let claimed = store
        .knowledge_evidence(&KnowledgeEvidenceQuery {
            key: key("meaning"),
            after: None,
        })
        .unwrap();
    assert_eq!(claimed.projection.claim, Some(false));
    assert_eq!(claimed.projection.assessed, Some(true));
    assert_eq!(claimed.projection.status, "claimed_unknown");
    assert_eq!(claimed.observations[0], first.observations[0]);
}

#[test]
fn long_original_contexts_bound_evidence_payload_without_dropping_the_continuation() {
    let directory = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&directory.path().join("profile")).unwrap();
    let mut item = admission(&mut store, "long-context");
    item.source.as_mut().unwrap().text = "original".repeat(4096);
    for index in 0..8 {
        let id = format!("context-{index}");
        let session = start(
            &mut store,
            &id,
            std::slice::from_ref(&item),
            practice(std::slice::from_ref(&item)),
        );
        let session = reveal(&mut store, &session, &format!("reveal-{id}"));
        submit(&mut store, &session, &format!("submit-{id}"));
    }
    assert!(schedule(&store, &item).is_none());
    let mut after = None;
    let mut ids = std::collections::BTreeSet::new();
    loop {
        let page = store
            .knowledge_evidence(&KnowledgeEvidenceQuery {
                key: key("meaning"),
                after,
            })
            .unwrap();
        assert!(page.observations.len() < 16);
        assert!(serde_json::to_vec(&page).unwrap().len() < 196_608);
        assert!(!page.observations.is_empty());
        for observation in page.observations {
            assert_eq!(observation.source, item.source);
            assert!(ids.insert(observation.attempt_id.0));
        }
        after = page.next;
        if after.is_none() {
            break;
        }
    }
    assert_eq!(ids.len(), 8);
}
