use super::*;
use crate::guest::GuestOutput;
use mlearn_core::*;
use serde_json::json;

const PACKAGE: &str = "org.mlearn.english";
const TARGET: &str = "org.mlearn.english:grammar/past-simple-negative";

fn execute(runtime: &mut Runtime, command: &ReviewCommand) -> ReviewSession {
    let response: Response = serde_json::from_str(
        &runtime.execute(&json!({"type":"review","command":command}).to_string()),
    )
    .unwrap();
    match response {
        Response::Review { commit } => commit.session,
        other => panic!("Expected a committed Review session, received {other:?}"),
    }
}

fn mutation(session: &ReviewSession, id: &str) -> ReviewMutation {
    ReviewMutation {
        command_id: id.into(),
        session_id: session.id.clone(),
        expected_revision: session.revision,
    }
}

fn grammar_session(runtime: &mut Runtime) -> ReviewSession {
    let mut content = super::tests::material().content;
    content.package_id = PACKAGE.into();
    content.target_id = Some(TARGET.into());
    content.package_revision = Some(runtime.installed.get(PACKAGE).unwrap().revision().unwrap());
    content.phrase = "Past simple negative".into();
    let response: Response = serde_json::from_str(&runtime.execute(&json!({
        "type":"create_material","command":{"commandId":"grammar","content":content,"distinct":true}
    }).to_string())).unwrap();
    let Response::MaterialWritten {
        outcome: MaterialWriteResult::Saved { material, .. },
    } = response
    else {
        panic!("Expected an actual saved grammar Material, received {response:?}");
    };
    execute(
        runtime,
        &ReviewCommand::Start {
            start: ReviewStart {
                command_id: "grammar-start".into(),
                session_id: ReviewSessionId("grammar-session".into()),
                mode: ReviewMode::Practice {
                    items: vec![PracticeItem {
                        material_id: material.id,
                        source: None,
                    }],
                },
            },
        },
    )
}

fn capture(session: &ReviewSession, id: &str) -> ReviewCommand {
    ReviewCommand::CaptureResponse {
        mutation: mutation(session, id),
        encounter_id: session.encounter.as_ref().unwrap().id.clone(),
        response: TaskResponse::TypedText {
            text: " DID NOT FOLD ".into(),
        },
    }
}

#[test]
fn actual_package_capture_restarts_reveals_and_submits_exactly_once() {
    // Given the real authenticated grammar package and its admitted typed task.
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = super::tests::runtime_with_package(directory.path());
    let session = grammar_session(&mut runtime);
    assert_eq!(session.total, Some(3));
    assert!(matches!(
        session
            .encounter
            .as_ref()
            .unwrap()
            .task
            .as_ref()
            .unwrap()
            .response_spec,
        ResponseSpec::TypedText { .. }
    ));
    let command = capture(&session, "capture");
    // When native execution captures, restarts, retries, Reveals and submits.
    let captured = execute(&mut runtime, &command);
    assert!(
        captured
            .encounter
            .as_ref()
            .unwrap()
            .capture
            .as_ref()
            .unwrap()
            .feedback
            .is_none(),
        "A durable raw response must not reveal its validation result"
    );
    drop(runtime);
    let mut runtime = super::tests::runtime_with_package(directory.path());
    assert_eq!(execute(&mut runtime, &command), captured);
    let revealed = execute(
        &mut runtime,
        &ReviewCommand::Reveal {
            mutation: mutation(&captured, "reveal"),
            encounter_id: captured.encounter.as_ref().unwrap().id.clone(),
        },
    );
    let encounter = revealed.encounter.as_ref().unwrap();
    let saved = encounter.capture.as_ref().unwrap();
    assert_eq!(
        saved.response,
        TaskResponse::TypedText {
            text: " DID NOT FOLD ".into()
        }
    );
    assert_eq!(
        saved.feedback.as_ref().unwrap().outcomes[0].result,
        ValidationResult::Accepted
    );
    let submit = ReviewCommand::Submit {
        mutation: mutation(&revealed, "submit"),
        response: ReviewResponse {
            encounter_id: encounter.id.clone(),
            capture_id: Some(saved.id.clone()),
            grades: vec![ReviewGrade {
                target_id: "answer".into(),
                quality: Some(AttemptQuality::Missed),
                method: ResponseMethod::Remembered,
                easy: false,
            }],
        },
    };
    let completed = execute(&mut runtime, &submit);
    assert_eq!(execute(&mut runtime, &submit), completed);
    // Then actual finite validation, not the contradictory self-report, owns one observation.
    let evidence = runtime
        .store
        .knowledge_evidence(&KnowledgeEvidenceQuery {
            key: KnowledgeKey {
                package_id: PACKAGE.into(),
                target_id: TARGET.into(),
                capability: format!("{PACKAGE}:grammar-form"),
            },
            after: None,
        })
        .unwrap();
    assert_eq!(evidence.projection.assessed, Some(true));
    assert_eq!(evidence.observations.len(), 1);
    assert_eq!(
        evidence.observations[0].grade.quality,
        Some(AttemptQuality::Missed)
    );
    assert!(
        runtime
            .store
            .review_due_materials(None, i64::MAX, 32)
            .unwrap()
            .iter()
            .all(|due| due.schedules.is_empty()),
        "Deliberate practice must not write retention schedules"
    );
}

#[test]
fn actual_contrast_and_recall_keep_validation_and_disclosure_distinct() {
    // Given all three real package task directions in one deliberate session.
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = super::tests::runtime_with_package(directory.path());
    let mut session = grammar_session(&mut runtime);
    let cases = [
        (
            "grammar-form",
            "typed",
            Some(TaskResponse::TypedText {
                text: "never folded".into(),
            }),
            Some(ValidationResult::Unassessed),
        ),
        (
            "grammar-meaning",
            "contrast",
            Some(TaskResponse::ChoiceId {
                id: "negative".into(),
            }),
            Some(ValidationResult::Accepted),
        ),
        ("grammar-recall", "recall", None, None),
    ];
    // When actual native capture/Reveal/Submit executes each declared response kind.
    for (index, (capability, suffix, raw, expected)) in cases.into_iter().enumerate() {
        let encounter = session.encounter.as_ref().unwrap();
        let encounter_id = encounter.id.clone();
        assert_eq!(encounter.probe_id, format!("{TARGET}/{suffix}"));
        if let Some(raw) = raw {
            if matches!(&raw, TaskResponse::ChoiceId { .. }) {
                let invalid = ReviewCommand::CaptureResponse {
                    mutation: mutation(&session, "foreign-choice"),
                    encounter_id: encounter_id.clone(),
                    response: TaskResponse::ChoiceId {
                        id: "outside".into(),
                    },
                };
                assert!(matches!(
                    runtime.prepare_review(invalid.clone()),
                    Err(Failure::Protocol("invalid_review", _))
                ));
                assert!(runtime.store.review_receipt(&invalid).unwrap().is_none());
                assert_eq!(runtime.store.review_session(&session.id).unwrap(), session);
            }
            session = execute(
                &mut runtime,
                &ReviewCommand::CaptureResponse {
                    mutation: mutation(&session, &format!("capture-{suffix}")),
                    encounter_id: encounter_id.clone(),
                    response: raw,
                },
            );
            assert!(
                session
                    .encounter
                    .as_ref()
                    .unwrap()
                    .capture
                    .as_ref()
                    .unwrap()
                    .feedback
                    .is_none(),
                "Feedback for {suffix} must stay private before Reveal"
            );
        } else {
            assert!(matches!(
                encounter.task.as_ref().unwrap().response_spec,
                ResponseSpec::SelfReport
            ));
            let invalid = capture(&session, "recall-cannot-validate");
            assert!(matches!(
                runtime.prepare_review(invalid),
                Err(Failure::Protocol("invalid_review", _))
            ));
        }
        session = execute(
            &mut runtime,
            &ReviewCommand::Reveal {
                mutation: mutation(&session, &format!("reveal-{suffix}")),
                encounter_id: encounter_id.clone(),
            },
        );
        let saved = session.encounter.as_ref().unwrap().capture.as_ref();
        assert_eq!(
            saved.map(|capture| capture.feedback.as_ref().unwrap().outcomes[0].result),
            expected
        );
        let response = ReviewResponse {
            encounter_id,
            capture_id: saved.map(|capture| capture.id.clone()),
            grades: vec![ReviewGrade {
                target_id: "answer".into(),
                quality: Some(AttemptQuality::Fluent),
                method: ResponseMethod::Remembered,
                easy: false,
            }],
        };
        session = execute(
            &mut runtime,
            &ReviewCommand::Submit {
                mutation: mutation(&session, &format!("submit-{suffix}")),
                response,
            },
        );
        // Then unlisted input, exposed contrast and self-report remain distinct, not cold success.
        let evidence = runtime
            .store
            .knowledge_evidence(&KnowledgeEvidenceQuery {
                key: KnowledgeKey {
                    package_id: PACKAGE.into(),
                    target_id: TARGET.into(),
                    capability: format!("{PACKAGE}:{capability}"),
                },
                after: None,
            })
            .unwrap();
        assert_eq!(evidence.projection.assessed, None);
        assert_eq!(evidence.observations.len(), 1);
        assert_eq!(
            evidence.observations[0].capture.is_some(),
            expected.is_some()
        );
        if index < 2 {
            session = execute(
                &mut runtime,
                &ReviewCommand::Next {
                    mutation: mutation(&session, &format!("next-{suffix}")),
                },
            );
        }
    }
    assert_eq!(session.completed, 3);
    assert_eq!(session.state, ReviewSessionState::Complete);
}

#[test]
fn pause_cancels_prepared_validation_and_drops_its_owned_token() {
    // Given actual package validation prepared but not yet invoked.
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = super::tests::runtime_with_package(directory.path());
    let session = grammar_session(&mut runtime);
    let command = capture(&session, "capture");
    let Prepared::Work(work) = runtime.prepare_review(command.clone()).unwrap() else {
        unreachable!()
    };
    let weak = runtime
        .review_validations
        .get(&session.id.0)
        .unwrap()
        .clone();
    // When the same session is durably paused before guest execution.
    let paused = execute(
        &mut runtime,
        &ReviewCommand::Pause {
            mutation: mutation(&session, "pause"),
        },
    );
    let result = work.run();
    drop(work);
    // Then no raw capture, attempt or stale publication survives cancellation.
    assert!(matches!(result, Err(Failure::Cancelled)));
    assert_eq!(paused.state, ReviewSessionState::Paused);
    assert!(paused.encounter.as_ref().unwrap().capture.is_none());
    assert!(runtime.store.review_receipt(&command).unwrap().is_none());
    assert!(weak.upgrade().is_none());
    assert!(runtime.review_validations.is_empty());
}

#[test]
fn pause_after_real_validation_rejects_late_publication_then_resume_retries() {
    // Given a completed real validator result held before its native commit.
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = super::tests::runtime_with_package(directory.path());
    let session = grammar_session(&mut runtime);
    let command = capture(&session, "capture");
    let Prepared::Work(work) = runtime.prepare_review(command.clone()).unwrap() else {
        unreachable!()
    };
    let mut output = work.run().unwrap();
    assert!(
        matches!(&output, GuestOutput::Validation(result) if result.outcomes[0].result == ValidationResult::Accepted)
    );
    // When Pause commits before that result can publish.
    let paused = execute(
        &mut runtime,
        &ReviewCommand::Pause {
            mutation: mutation(&session, "pause"),
        },
    );
    let result = runtime.complete(&work, &mut output);
    drop(work);
    assert!(matches!(result, Err(Failure::Cancelled)));
    assert!(runtime.store.review_receipt(&command).unwrap().is_none());
    let resumed = execute(
        &mut runtime,
        &ReviewCommand::Resume {
            mutation: mutation(&paused, "resume"),
        },
    );
    let retried = execute(&mut runtime, &capture(&resumed, "retry-capture"));
    // Then the exact task remains recoverable and only the new response is durable.
    assert_eq!(
        retried.encounter.as_ref().unwrap().id,
        session.encounter.as_ref().unwrap().id
    );
    assert!(retried.encounter.as_ref().unwrap().capture.is_some());
    assert!(!retried.encounter.as_ref().unwrap().conditions.revealed);
}

#[test]
fn pausing_a_peer_session_does_not_cancel_this_validation() {
    // Given one actual validation and a separate admitted session.
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = super::tests::runtime_with_package(directory.path());
    let session = grammar_session(&mut runtime);
    let command = capture(&session, "capture");
    let Prepared::Work(work) = runtime.prepare_review(command).unwrap() else {
        unreachable!()
    };
    let peer = execute(
        &mut runtime,
        &ReviewCommand::Start {
            start: ReviewStart {
                command_id: "peer-start".into(),
                session_id: ReviewSessionId("peer".into()),
                mode: session.mode.clone(),
            },
        },
    );
    // When only the peer is paused before this validator invokes and publishes.
    let paused = execute(
        &mut runtime,
        &ReviewCommand::Pause {
            mutation: mutation(&peer, "peer-pause"),
        },
    );
    let mut output = work.run().unwrap();
    let (response, _) = runtime.complete(&work, &mut output).unwrap();
    // Then cancellation stays session-scoped and this immutable response commits.
    assert_eq!(paused.state, ReviewSessionState::Paused);
    let Response::Review { commit } = response else {
        unreachable!()
    };
    assert_eq!(commit.session.id, session.id);
    assert!(commit.session.encounter.as_ref().unwrap().capture.is_some());
    assert!(
        runtime
            .store
            .review_session(&peer.id)
            .unwrap()
            .encounter
            .unwrap()
            .capture
            .is_none(),
        "A peer session must not acquire this session's captured response"
    );
}

#[test]
fn unavailable_admitted_package_prevents_commit_and_remains_recoverable() {
    // Given a real validator result whose authenticated package becomes unavailable.
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = super::tests::runtime_with_package(directory.path());
    let session = grammar_session(&mut runtime);
    let command = capture(&session, "capture");
    let Prepared::Work(work) = runtime.prepare_review(command.clone()).unwrap() else {
        unreachable!()
    };
    let mut output = work.run().unwrap();
    let package = runtime.installed.remove(PACKAGE).unwrap();
    // When completion and another capture both recheck current package authority.
    let completed = runtime.complete(&work, &mut output);
    let retried = runtime.prepare_review(command.clone());
    // Then no stale result or receipt commits; restoring the exact package permits retry.
    assert!(matches!(completed, Err(Failure::Cancelled)));
    assert!(matches!(retried, Err(Failure::Operation(_))));
    assert_eq!(runtime.store.review_session(&session.id).unwrap(), session);
    assert!(runtime.store.review_receipt(&command).unwrap().is_none());
    drop(work);
    runtime.installed.insert(PACKAGE.into(), package);
    let recovered = execute(&mut runtime, &command);
    assert!(recovered.encounter.as_ref().unwrap().capture.is_some());
}
