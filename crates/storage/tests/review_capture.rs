#[path = "support/review.rs"]
mod support;
use mlearn_core::*;
use mlearn_storage::ProfileStore;
use support::*;

fn typed(store: &mut ProfileStore) -> (ReviewAdmission, ReviewSession) {
    let mut item = admission(store, "typed");
    item.task = Some(TaskContract {
        revision: 1,
        response_spec: ResponseSpec::TypedText { max_bytes: 2048 },
        validator_id: Some("package:finite".into()),
        answer_supplied: item
            .probe
            .targets
            .iter()
            .filter_map(|row| row.key.clone())
            .collect(),
        attribution: "Original test content".into(),
        limitations: "Finite validation fixture".into(),
    });
    let session = start(
        store,
        "typed-session",
        &[item.clone()],
        practice(&[item.clone()]),
    );
    (item, session)
}

fn capture(session: &ReviewSession) -> ReviewCommand {
    ReviewCommand::CaptureResponse {
        mutation: mutation(session, "capture"),
        encounter_id: session.encounter.as_ref().unwrap().id.clone(),
        response: TaskResponse::TypedText {
            text: "  raw ANSWER  ".into(),
        },
    }
}

fn output(item: &ReviewAdmission) -> ValidationOutput {
    ValidationOutput {
        contract_version: 1,
        task_id: item.probe.id.clone(),
        task_revision: 1,
        validator_id: "package:finite".into(),
        outcomes: vec![
            ValidationOutcome {
                target_id: "meaning".into(),
                result: ValidationResult::Accepted,
                reason: "finite_match".into(),
            },
            ValidationOutcome {
                target_id: "reading".into(),
                result: ValidationResult::Rejected,
                reason: "listed_contrast".into(),
            },
        ],
    }
}

fn reveal(store: &mut ProfileStore, session: &ReviewSession) -> ReviewSession {
    store
        .review_apply(
            &ReviewCommand::Reveal {
                mutation: mutation(session, "reveal"),
                encounter_id: session.encounter.as_ref().unwrap().id.clone(),
            },
            110,
        )
        .unwrap()
        .session
}

fn captured_response(session: &ReviewSession) -> ReviewResponse {
    let mut value = response(session, Some(AttemptQuality::Fluent));
    value.capture_id = Some(
        session
            .encounter
            .as_ref()
            .unwrap()
            .capture
            .as_ref()
            .unwrap()
            .id
            .clone(),
    );
    value
}

#[test]
fn capture_resumes_private_raw_input_and_retry_without_creating_an_attempt() {
    // Given an admitted typed task and a checked per-row package result.
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("profile");
    let mut store = ProfileStore::open(&path).unwrap();
    let (item, session) = typed(&mut store);
    let command = capture(&session);
    // When capture commits and a historical migration replay precedes restart/retry.
    let commit = store.review_capture(&command, &output(&item), 100).unwrap();
    drop(store);
    let existing = rusqlite::Connection::open(&path).unwrap();
    existing.pragma_update(None, "user_version", 19).unwrap();
    drop(existing);
    let mut store = ProfileStore::open(&path).unwrap();
    let retry = store.review_capture(&command, &output(&item), 101).unwrap();
    // Then raw input/identity survive, feedback and learner success remain private.
    assert_eq!(retry, commit);
    let encounter = retry.session.encounter.as_ref().unwrap();
    assert_eq!(encounter.answer, None);
    let saved = encounter.capture.as_ref().unwrap();
    assert_eq!(
        saved.response,
        TaskResponse::TypedText {
            text: "  raw ANSWER  ".into()
        }
    );
    assert_eq!(saved.feedback, None);
    assert!(!saved.conditions.revealed);
    let evidence = store
        .knowledge_evidence(&KnowledgeEvidenceQuery {
            key: key("meaning"),
            after: None,
        })
        .unwrap();
    assert!(evidence.observations.is_empty());
    assert_eq!(evidence.projection.assessed, None);
    assert!(
        store
            .review_capture_admission(&ReviewCommand::CaptureResponse {
                mutation: mutation(&retry.session, "replacement"),
                encounter_id: encounter.id.clone(),
                response: TaskResponse::TypedText {
                    text: "replacement".into()
                },
            })
            .is_err()
    );
}

#[test]
fn validated_rows_not_retrospective_grades_own_assessment_and_correction() {
    // Given a captured result accepting one row and rejecting another.
    let directory = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&directory.path().join("profile")).unwrap();
    let (item, session) = typed(&mut store);
    let session = store
        .review_capture(&capture(&session), &output(&item), 100)
        .unwrap()
        .session;
    let session = reveal(&mut store, &session);
    assert_eq!(
        session
            .encounter
            .as_ref()
            .unwrap()
            .capture
            .as_ref()
            .unwrap()
            .feedback,
        Some(output(&item))
    );
    let response = captured_response(&session);
    // When Fluent self-reports are submitted, undone and corrected to Missed.
    let submitted = store
        .review_apply(
            &ReviewCommand::Submit {
                mutation: mutation(&session, "submit"),
                response: response.clone(),
            },
            120,
        )
        .unwrap()
        .session;
    let undone = store
        .review_apply(
            &ReviewCommand::Undo {
                mutation: mutation(&submitted, "undo"),
            },
            121,
        )
        .unwrap()
        .session;
    let mut corrected = response;
    for grade in &mut corrected.grades {
        grade.quality = Some(AttemptQuality::Missed);
    }
    store
        .review_apply(
            &ReviewCommand::Correct {
                mutation: mutation(&undone, "correct"),
                response: corrected,
            },
            122,
        )
        .unwrap();
    // Then the same immutable validation still owns each single active observation.
    for (capability, assessed) in [("meaning", true), ("reading", false)] {
        let evidence = store
            .knowledge_evidence(&KnowledgeEvidenceQuery {
                key: key(capability),
                after: None,
            })
            .unwrap();
        assert_eq!(evidence.projection.assessed, Some(assessed));
        assert_eq!(evidence.observations.len(), 1);
        assert!(evidence.observations[0].active);
        assert_eq!(
            evidence.observations[0].grade.quality,
            Some(AttemptQuality::Missed)
        );
        assert!(evidence.observations[0].capture.is_some());
    }
    assert!(
        store
            .review_due_materials(None, 1000, 32)
            .unwrap()
            .iter()
            .all(|value| value.schedules.is_empty())
    );
}

#[test]
fn malformed_validation_does_not_partially_capture_or_advance_the_question() {
    // Given a two-row admitted task and output omitting one row.
    let directory = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&directory.path().join("profile")).unwrap();
    let (item, session) = typed(&mut store);
    let mut malformed = output(&item);
    malformed.outcomes.pop();
    // When the native persistence boundary rejects that result.
    let result = store.review_capture(&capture(&session), &malformed, 100);
    // Then the same raw response remains retryable with no receipt or state mutation.
    assert!(result.is_err());
    assert_eq!(store.review_session(&session.id).unwrap(), session);
    assert!(store.review_receipt(&capture(&session)).unwrap().is_none());
    assert!(
        store
            .review_capture(&capture(&session), &output(&item), 101)
            .is_ok()
    );
}

#[test]
fn revealing_before_capture_keeps_accepted_answers_unassessed() {
    // Given an answer durably revealed before any typed response.
    let directory = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&directory.path().join("profile")).unwrap();
    let (item, session) = typed(&mut store);
    let session = reveal(&mut store, &session);
    // When its copied answer validates and receives Fluent retrospective grades.
    let session = store
        .review_capture(&capture(&session), &output(&item), 120)
        .unwrap()
        .session;
    store
        .review_apply(
            &ReviewCommand::Submit {
                mutation: mutation(&session, "submit"),
                response: captured_response(&session),
            },
            121,
        )
        .unwrap();
    // Then the accepted result is inspectable but cannot become cold success.
    let evidence = store
        .knowledge_evidence(&KnowledgeEvidenceQuery {
            key: key("meaning"),
            after: None,
        })
        .unwrap();
    assert_eq!(evidence.projection.assessed, None);
    let capture = evidence.observations[0].capture.as_ref().unwrap();
    assert!(capture.conditions.revealed);
    assert_eq!(
        capture.feedback.as_ref().unwrap().outcomes[0].result,
        ValidationResult::Accepted
    );
}

#[test]
fn legacy_exposures_migrate_once_without_changing_receipts_or_material_identity() {
    // Given a v19-shaped profile with an unanswered revealed canonical target.
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("profile");
    let mut store = ProfileStore::open(&path).unwrap();
    let first = admission(&mut store, "first");
    let session = start(
        &mut store,
        "first-session",
        &[first],
        ReviewMode::Continuous,
    );
    let reveal_command = ReviewCommand::Reveal {
        mutation: mutation(&session, "reveal"),
        encounter_id: session.encounter.as_ref().unwrap().id.clone(),
    };
    let session = store.review_apply(&reveal_command, 110).unwrap().session;
    drop(store);
    let old = rusqlite::Connection::open(&path).unwrap();
    old.execute_batch(
        "DROP TABLE review_disclosures; DROP TABLE review_captures; PRAGMA user_version=19;",
    )
    .unwrap();
    drop(old);
    // When migration runs and another Material tests the same canonical keys.
    let mut store = ProfileStore::open(&path).unwrap();
    assert_eq!(store.review_session(&session.id).unwrap(), session);
    assert_eq!(
        store
            .review_receipt(&reveal_command)
            .unwrap()
            .unwrap()
            .session,
        session
    );
    let second = admission(&mut store, "second");
    let next = start(
        &mut store,
        "second-session",
        &[second.clone()],
        practice(&[second]),
    );
    // Then canonical prior disclosure survives the different authored identity.
    assert!(
        next.encounter
            .unwrap()
            .conditions
            .assistance
            .contains(&ReviewAssistance::PriorDisclosure)
    );
}

#[test]
fn an_unanswered_cue_taints_related_keys_on_another_material() {
    // Given an admitted cue supplying meaning while testing another direction.
    let directory = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&directory.path().join("profile")).unwrap();
    let mut first = admission(&mut store, "first");
    first.probe.targets.retain(|row| row.id == "reading");
    first.probe.supplied = vec![key("meaning")];
    let first_session = start(
        &mut store,
        "first-session",
        &[first.clone()],
        practice(&[first]),
    );
    assert!(
        !first_session
            .encounter
            .as_ref()
            .unwrap()
            .conditions
            .revealed
    );
    let mut second = admission(&mut store, "second");
    second.probe.targets.retain(|row| row.id == "meaning");
    // When another session admits that supplied canonical direction without Reveal.
    let session = start(
        &mut store,
        "second-session",
        &[second.clone()],
        practice(&[second]),
    );
    // Then the native conditions prevent an independent response claim.
    assert!(
        session
            .encounter
            .as_ref()
            .unwrap()
            .conditions
            .assistance
            .contains(&ReviewAssistance::PriorDisclosure)
    );
    let session = support::reveal(&mut store, &session, "second-reveal");
    submit(&mut store, &session, "second-submit");
    let evidence = store
        .knowledge_evidence(&KnowledgeEvidenceQuery {
            key: key("meaning"),
            after: None,
        })
        .unwrap();
    assert_eq!(evidence.projection.assessed, None);
    assert_eq!(evidence.observations.len(), 1);
}

#[test]
fn assistance_worked_out_and_unlisted_results_remain_unassessed() {
    for case in ["inspector", "source", "worked-out", "unlisted"] {
        // Given an actual captured task with one disqualifying measurement condition.
        let directory = tempfile::tempdir().unwrap();
        let mut store = ProfileStore::open(&directory.path().join("profile")).unwrap();
        let (item, mut session) = typed(&mut store);
        if let Some(assistance) = match case {
            "inspector" => Some(ReviewAssistance::Inspector),
            "source" => Some(ReviewAssistance::Source),
            _ => None,
        } {
            session = store
                .review_apply(
                    &ReviewCommand::Assistance {
                        mutation: mutation(&session, "assistance"),
                        encounter_id: session.encounter.as_ref().unwrap().id.clone(),
                        assistance,
                    },
                    99,
                )
                .unwrap()
                .session;
        }
        let mut result = output(&item);
        if case == "unlisted" {
            result.outcomes[0].result = ValidationResult::Unassessed;
        }
        session = store
            .review_capture(&capture(&session), &result, 100)
            .unwrap()
            .session;
        session = reveal(&mut store, &session);
        let mut response = captured_response(&session);
        if case == "worked-out" {
            response.grades[0].method = ResponseMethod::WorkedOut;
        }
        // When a Fluent retrospective rating accompanies that captured response.
        store
            .review_apply(
                &ReviewCommand::Submit {
                    mutation: mutation(&session, "submit"),
                    response,
                },
                120,
            )
            .unwrap();
        // Then raw validation survives without creating a qualified measurement.
        let evidence = store
            .knowledge_evidence(&KnowledgeEvidenceQuery {
                key: key("meaning"),
                after: None,
            })
            .unwrap();
        assert_eq!(evidence.projection.assessed, None, "{case}");
        assert_eq!(evidence.observations.len(), 1, "{case}");
        assert!(evidence.observations[0].capture.is_some(), "{case}");
    }
}
