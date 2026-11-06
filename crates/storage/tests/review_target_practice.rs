use mlearn_core::*;
use mlearn_storage::{ProfileStore, StorageError};

#[test]
fn canonical_scope_rejects_partial_foreign_and_duplicate_work_without_poisoning_retry() {
    // Given explicit canonical scope and a real empty profile.
    let directory = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&directory.path().join("profile")).unwrap();
    let keys: Vec<_> = ["meaning", "reading"]
        .into_iter()
        .map(|capability| KnowledgeKey {
            package_id: "package".into(),
            target_id: "stable".into(),
            capability: capability.into(),
        })
        .collect();
    let value = ReviewAdmission {
        work_id: ReviewWorkId("work".into()),
        subject: ReviewSubject::Target {
            target_id: "stable".into(),
        },
        package_id: "package".into(),
        package_version: "1".into(),
        package_revision: "revision".into(),
        scheduler_version: REVIEW_POLICY_VERSION,
        probe: ReviewProbe {
            id: "recall".into(),
            contract_version: 1,
            direction: ReviewDirection::Written,
            cue: "cue".into(),
            answer: "answer".into(),
            targets: keys
                .iter()
                .map(|key| ReviewTarget {
                    id: key.capability.clone(),
                    label: key.capability.clone(),
                    mnemonic: None,
                    key: Some(key.clone()),
                })
                .collect(),
            supplied: vec![],
            required_media: None,
        },
        source: None,
        task: Some(TaskContract {
            revision: 1,
            response_spec: ResponseSpec::SelfReport,
            validator_id: None,
            answer_supplied: keys,
            attribution: "Original fixture".into(),
            limitations: "Retrospective recall only".into(),
        }),
    };
    let mode = ReviewMode::TargetPractice {
        assistance: Some(vec![ReviewAssistance::Inspector]),
        items: vec![TargetPracticeItem {
            package_id: "package".into(),
            package_revision: "revision".into(),
            target_id: "stable".into(),
            capabilities: vec!["meaning".into(), "reading".into()],
            source: None,
        }],
    };
    let mut omitted = value.clone();
    omitted.probe.targets.pop();
    let mut broadened = value.clone();
    broadened.probe.targets[1].key.as_mut().unwrap().capability = "writing".into();
    let mut duplicated = value.clone();
    let mut duplicate = value.probe.targets[0].clone();
    duplicate.id = "another-row".into();
    duplicated.probe.targets.push(duplicate);
    let mut stale = value.clone();
    stale.package_revision = "other-revision".into();
    let mut foreign = value.clone();
    foreign.subject = ReviewSubject::Target {
        target_id: "other-target".into(),
    };
    let mut missing_task = value.clone();
    missing_task.task = None;
    let mut first = value.clone();
    first.probe.targets.truncate(1);
    let mut second = value.clone();
    second.probe.targets.remove(0);
    let plans = [
        vec![omitted],
        vec![broadened],
        vec![duplicated],
        vec![stale],
        vec![foreign],
        vec![missing_task],
        vec![first, second],
    ];
    // When malformed native plans attempt the same exact requested scope.
    for (index, plan) in plans.iter().enumerate() {
        let start = ReviewStart {
            command_id: format!("start-{index}"),
            session_id: ReviewSessionId(format!("session-{index}")),
            mode: mode.clone(),
        };
        assert!(matches!(
            store.review_start(&start, plan, 100),
            Err(StorageError::Invalid(_))
        ));
        assert!(store.review_session(&start.session_id).is_err());
        let receipt = store
            .review_receipt(&ReviewCommand::Start {
                start: start.clone(),
            })
            .unwrap();
        assert!(receipt.is_none());
        // Then rollback preserves that command's identity for a valid retry.
        let committed = store
            .review_start(&start, std::slice::from_ref(&value), 100)
            .unwrap();
        assert_eq!(committed.session.total, Some(1));
        let encounter = committed.session.encounter.unwrap();
        assert_eq!(encounter.subject, value.subject);
        assert_eq!(
            encounter.conditions.assistance,
            vec![ReviewAssistance::Inspector]
        );
        drop(store);
        store = ProfileStore::open(&directory.path().join("profile")).unwrap();
        let recovered = store.review_session(&start.session_id).unwrap();
        assert_eq!(recovered.encounter.unwrap(), encounter);
    }
}
