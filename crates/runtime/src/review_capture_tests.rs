use super::*;
use crate::guest::GuestOutput;
use crate::native_test_profile::NativeTestProfile;
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
fn real_bundled_lexical_tasks_keep_requested_keys_without_materials() {
    // Given independently opened profiles and the actual built language packages.
    let directory = NativeTestProfile::new();
    let artifacts = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/plugin-cdn");
    let manifests: Vec<crate::catalog::Manifest> =
        serde_json::from_slice(&std::fs::read(artifacts.join("bundle.json")).unwrap()).unwrap();
    for (package_id, text) in [("org.mlearn.english", "cat"), ("org.mlearn.japanese", "猫")] {
        let manifest = manifests
            .iter()
            .find(|manifest| manifest.id == package_id)
            .unwrap()
            .clone();
        let bundle = crate::BundledPlugin {
            code: std::fs::read(artifacts.join(&manifest.code.path)).unwrap(),
            assets: manifest
                .assets
                .iter()
                .map(|(key, artifact)| {
                    (
                        key.clone(),
                        std::fs::read(artifacts.join(&artifact.path))
                            .unwrap()
                            .into(),
                    )
                })
                .collect(),
            manifest,
        };
        let runtime = Runtime::open(
            &directory.path().join(package_id),
            mlearn_language_host::CodePolicy::MobileBundled,
            None,
            vec![bundle],
        )
        .unwrap();
        let package = runtime.installed.get(package_id).unwrap();
        assert!(package
            .manifest
            .capabilities
            .iter()
            .any(|capability| capability == "learning.probes.v2"));
        let work = LanguageWork {
            package: package.clone(),
            cancellation: Cancellation::durable(),
            action: LanguageAction::Describe,
        };
        // When actual guest analysis resolves the target and v2 admits only meaning.
        let tokens: Vec<Vec<AnalyzedToken>> = serde_json::from_value(
            work.invoke("text.analyze.v1", json!({"texts":[text]}))
                .unwrap(),
        )
        .unwrap();
        let target = tokens
            .iter()
            .flatten()
            .flat_map(|token| &token.targets)
            .next()
            .expect("The real package must resolve its canonical sample");
        let keys = [KnowledgeKey {
            package_id: package_id.into(),
            target_id: target.clone(),
            capability: format!("{package_id}:meaning"),
        }];
        let tasks = work
            .review_tasks(target, &package.revision().unwrap(), Some(&keys))
            .unwrap();
        // Then the real native owner receives exact, honest recall without hidden saves.
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].probe.targets.len(), 1);
        assert_eq!(tasks[0].probe.targets[0].key.as_ref(), Some(&keys[0]));
        assert!(!tasks[0].probe.supplied.contains(&keys[0]));
        assert!(tasks[0].task.answer_supplied.contains(&keys[0]));
        assert_eq!(tasks[0].task.response_spec, ResponseSpec::SelfReport);
        assert!(tasks[0].task.validator_id.is_none());
        assert!(runtime
            .store
            .review_due_materials(None, 0, 1)
            .unwrap()
            .is_empty());
    }
}

#[test]
fn partial_task_scope_retains_real_disclosures_without_testing_sibling_capabilities() {
    // Given a real package target with only one requested capability.
    let directory = NativeTestProfile::new();
    let runtime = super::tests::runtime_with_package(directory.path());
    let package = runtime.installed.get(PACKAGE).unwrap();
    let revision = package.revision().unwrap();
    let work = LanguageWork {
        package: package.clone(),
        cancellation: Cancellation::durable(),
        action: LanguageAction::Describe,
    };
    for capability in ["grammar-form", "grammar-meaning", "grammar-recall"] {
        let keys = [KnowledgeKey {
            package_id: PACKAGE.into(),
            target_id: TARGET.into(),
            capability: format!("{PACKAGE}:{capability}"),
        }];
        // When the real guest generates exactly the requested direction.
        let tasks = work.review_tasks(TARGET, &revision, Some(&keys)).unwrap();
        // Then tested scope stays narrow while honest sibling disclosure survives.
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].probe.targets.len(), 1);
        assert_eq!(tasks[0].probe.targets[0].key.as_ref(), Some(&keys[0]));
        assert_eq!(tasks[0].task.answer_supplied.len(), 3);
        assert!(tasks[0].probe.supplied.iter().all(|key| key != &keys[0]));
    }
    // Unsupported and foreign keys cannot become admitted work.
    for (target, capability) in [
        (TARGET, "meaning"),
        ("org.mlearn.english:grammar/unregistered", "grammar-form"),
    ] {
        let keys = [KnowledgeKey {
            package_id: PACKAGE.into(),
            target_id: target.into(),
            capability: format!("{PACKAGE}:{capability}"),
        }];
        assert!(work.review_tasks(TARGET, &revision, Some(&keys)).is_err());
    }
}

#[test]
fn validation_lease_binds_raw_response_and_rejects_foreign_scope() {
    // Given an actual typed task and both kinds of scoped reservation.
    let directory = NativeTestProfile::new();
    let mut runtime = super::tests::runtime_with_package(directory.path());
    let session = grammar_session(&mut runtime);
    let command = capture(&session, "fenced-capture");
    let raw = json!({"type":"review","command":command}).to_string();
    let executor = crate::RuntimeExecutor::new(runtime);
    let id = executor.begin_review_validation(&raw).unwrap();
    let read = executor.begin_bounded_read().unwrap();
    let mut changed = command.clone();
    let ReviewCommand::CaptureResponse { response, .. } = &mut changed else {
        panic!("Expected the captured response fixture");
    };
    *response = TaskResponse::TypedText {
        text: "did not fold".into(),
    };
    let changed = json!({"type":"review","command":changed}).to_string();
    // When raw input changes or a reservation is used through the other scope.
    for result in [
        executor.execute_review_validation(&id, &changed),
        executor.execute_bounded_read(&id, &raw),
        executor.execute_review_validation(&read, &raw),
    ] {
        let value: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(value["code"], "invalid_bounded_read");
    }
    assert!(matches!(
        executor.cancel_bounded_read(&id),
        Err(crate::BoundedReadError::InvalidHandle)
    ));
    assert!(matches!(
        executor.cancel_review_validation(&read),
        Err(crate::BoundedReadError::InvalidHandle)
    ));
    // Then neither reservation was consumed, and the original raw intent commits.
    let result: Response =
        serde_json::from_str(&executor.execute_review_validation(&id, &raw)).unwrap();
    let Response::Review { commit } = result else {
        panic!("Expected the original fenced response, received {result:?}");
    };
    assert_eq!(commit.session.revision, session.revision + 1);
    assert_eq!(
        commit.session.encounter.unwrap().capture.unwrap().response,
        TaskResponse::TypedText {
            text: " DID NOT FOLD ".into()
        }
    );
    executor.cancel_bounded_read(&read).unwrap();
}

#[test]
fn validation_lease_survives_source_epoch_change() {
    // Given a durable Practice response registered before unrelated source work.
    let directory = NativeTestProfile::new();
    let mut runtime = super::tests::runtime_with_package(directory.path());
    let session = grammar_session(&mut runtime);
    let raw = json!({"type":"review","command":capture(&session,"durable-capture")}).to_string();
    let executor = crate::RuntimeExecutor::new(runtime);
    let id = executor.begin_review_validation(&raw).unwrap();
    // When the source owner advances its independent cancellation epoch.
    executor.cancel_source_open();
    let result: Response =
        serde_json::from_str(&executor.execute_review_validation(&id, &raw)).unwrap();
    // Then the original response still executes its real validator and commits.
    let Response::Review { commit } = result else {
        panic!("Expected a source-independent response, received {result:?}");
    };
    let saved = commit.session.encounter.unwrap().capture.unwrap();
    assert_eq!(saved.feedback, None);
    assert_eq!(commit.session.revision, session.revision + 1);
}

#[test]
fn validation_cancel_before_claim_rejects_late_execution_without_a_capture() {
    // Given an actual response whose native reservation has not executed.
    let directory = NativeTestProfile::new();
    let mut runtime = super::tests::runtime_with_package(directory.path());
    let session = grammar_session(&mut runtime);
    let raw = json!({"type":"review","command":capture(&session,"unclaimed-capture")}).to_string();
    let executor = crate::RuntimeExecutor::new(runtime);
    let id = executor.begin_review_validation(&raw).unwrap();
    // When cancellation acknowledges before a delayed execute arrives.
    executor.cancel_review_validation(&id).unwrap();
    let result: serde_json::Value =
        serde_json::from_str(&executor.execute_review_validation(&id, &raw)).unwrap();
    // Then the old identity cannot commit and a fresh reservation safely recovers.
    assert_eq!(result["code"], "invalid_bounded_read");
    let unsupported = json!({"type":"review_session","sessionId":session.id}).to_string();
    assert!(matches!(
        executor.begin_review_validation(&unsupported),
        Err(crate::BoundedReadError::InvalidValidation)
    ));
    let snapshot: Response = serde_json::from_str(&executor.execute(&unsupported)).unwrap();
    let Response::ReviewSession { session: saved } = snapshot else {
        panic!("Expected the unmodified session, received {snapshot:?}");
    };
    assert_eq!(saved.revision, session.revision);
    assert_eq!(saved.encounter.unwrap().capture, None);
    let retry = executor.begin_review_validation(&raw).unwrap();
    assert_ne!(retry, id);
    let result: Response =
        serde_json::from_str(&executor.execute_review_validation(&retry, &raw)).unwrap();
    assert!(matches!(result, Response::Review { .. }));
}

#[test]
fn validation_cancel_wakes_queued_work_without_unlocking_unrelated_guest() {
    use std::sync::Arc;
    use std::{sync::mpsc, thread, time::Duration};
    // Given a real validator request queued behind unrelated guest admission.
    let directory = NativeTestProfile::new();
    let mut runtime = super::tests::runtime_with_package(directory.path());
    let session = grammar_session(&mut runtime);
    let raw = json!({"type":"review","command":capture(&session,"queued-capture")}).to_string();
    let executor = Arc::new(crate::RuntimeExecutor::new(runtime));
    let id = executor.begin_review_validation(&raw).unwrap();
    thread::scope(|scope| {
        let admission = executor.guest.lock().unwrap();
        let waiting = executor.guest.observe_waiter();
        let running = Arc::clone(&executor);
        let handle = id.clone();
        let worker = scope.spawn(move || running.execute_review_validation(&handle, &raw));
        waiting.recv_timeout(Duration::from_secs(10)).unwrap();
        let (finished, receipt) = mpsc::sync_channel(1);
        let cancelling = Arc::clone(&executor);
        // When the operation-specific control cancels without guest capacity.
        let control = scope.spawn(move || {
            finished
                .send(cancelling.cancel_review_validation(&id))
                .unwrap();
        });
        let before_unlock = receipt.recv_timeout(Duration::from_secs(10));
        drop(admission);
        control.join().unwrap();
        let raw = worker.join().unwrap();
        // Then actual drainage acknowledges before the unrelated owner unlocks.
        before_unlock.unwrap().unwrap();
        let result: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(result["code"], "cancelled");
    });
}

#[test]
fn validation_cancel_drains_actual_guest_result_before_capacity_and_retry() {
    use crate::execution::bounded_read_tests::observe_cancel_join;
    use crate::execution::bounded_read_tests::HeldOperation;
    use std::sync::Arc;
    use std::{sync::mpsc, thread, time::Duration};
    // Given actual package output held before publication, with both slots charged.
    let directory = NativeTestProfile::new();
    let mut runtime = super::tests::runtime_with_package(directory.path());
    let session = grammar_session(&mut runtime);
    let raw = json!({"type":"review","command":capture(&session,"drained-capture")}).to_string();
    let executor = Arc::new(crate::RuntimeExecutor::new(runtime));
    let id = executor.begin_review_validation(&raw).unwrap();
    let read = executor.begin_bounded_read().unwrap();
    thread::scope(|scope| {
        let mut held =
            HeldOperation::start_validation(Arc::clone(&executor), id.clone(), raw.clone());
        held.reached.recv_timeout(Duration::from_secs(10)).unwrap();
        let permits = [executor.admit().unwrap(), executor.admit().unwrap()];
        assert!(matches!(executor.admit(), Err(Failure::Busy)));
        let (joining, waiters) = mpsc::sync_channel(2);
        let (finished, receipts) = mpsc::sync_channel(2);
        // When two controls await this real worker's drainage.
        for _ in 0..2 {
            let executor = Arc::clone(&executor);
            let id = id.clone();
            let joining = joining.clone();
            let finished = finished.clone();
            scope.spawn(move || {
                observe_cancel_join(joining);
                finished
                    .send(executor.cancel_review_validation(&id))
                    .unwrap();
            });
        }
        // This signal comes from inside the pending join, not before the join call.
        for _ in 0..2 {
            waiters.recv_timeout(Duration::from_secs(10)).unwrap();
        }
        assert!(matches!(
            executor.begin_bounded_read(),
            Err(crate::BoundedReadError::Busy)
        ));
        assert!(matches!(
            executor.cancel_bounded_read(&read),
            Err(crate::BoundedReadError::Busy)
        ));
        assert_eq!(held.finish()["code"], "cancelled");
        for _ in 0..2 {
            receipts
                .recv_timeout(Duration::from_secs(10))
                .unwrap()
                .unwrap();
        }
        drop(permits);
    });
    // Then no response committed; released capacity accepts the same exact intent.
    let snapshot: Response = serde_json::from_str(
        &executor.execute(&json!({"type":"review_session","sessionId":session.id}).to_string()),
    )
    .unwrap();
    let Response::ReviewSession { session: saved } = snapshot else {
        panic!("Expected the unchanged session, received {snapshot:?}");
    };
    assert_eq!(saved.revision, session.revision);
    assert_eq!(saved.encounter.unwrap().capture, None);
    executor.cancel_bounded_read(&read).unwrap();
    let retry = executor.begin_review_validation(&raw).unwrap();
    let result: Response =
        serde_json::from_str(&executor.execute_review_validation(&retry, &raw)).unwrap();
    let Response::Review { commit } = result else {
        panic!("Expected recoverable original response, received {result:?}");
    };
    assert_eq!(commit.session.revision, session.revision + 1);
    assert!(commit.session.encounter.unwrap().capture.is_some());
}

#[test]
fn actual_package_capture_restarts_reveals_and_submits_exactly_once() {
    // Given the real authenticated grammar package and its admitted typed task.
    let directory = NativeTestProfile::new();
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
    let directory = NativeTestProfile::new();
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
                    runtime.prepare_review(invalid.clone(), Cancellation::durable()),
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
                runtime.prepare_review(invalid, Cancellation::durable()),
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
    let directory = NativeTestProfile::new();
    let mut runtime = super::tests::runtime_with_package(directory.path());
    let session = grammar_session(&mut runtime);
    let command = capture(&session, "capture");
    let Prepared::Work(work) = runtime
        .prepare_review(command.clone(), Cancellation::durable())
        .unwrap()
    else {
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
    let directory = NativeTestProfile::new();
    let mut runtime = super::tests::runtime_with_package(directory.path());
    let session = grammar_session(&mut runtime);
    let command = capture(&session, "capture");
    let Prepared::Work(work) = runtime
        .prepare_review(command.clone(), Cancellation::durable())
        .unwrap()
    else {
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
    let directory = NativeTestProfile::new();
    let mut runtime = super::tests::runtime_with_package(directory.path());
    let session = grammar_session(&mut runtime);
    let command = capture(&session, "capture");
    let Prepared::Work(work) = runtime
        .prepare_review(command, Cancellation::durable())
        .unwrap()
    else {
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
    let directory = NativeTestProfile::new();
    let mut runtime = super::tests::runtime_with_package(directory.path());
    let session = grammar_session(&mut runtime);
    let command = capture(&session, "capture");
    let Prepared::Work(work) = runtime
        .prepare_review(command.clone(), Cancellation::durable())
        .unwrap()
    else {
        unreachable!()
    };
    let mut output = work.run().unwrap();
    let package = runtime.installed.remove(PACKAGE).unwrap();
    // When completion and another capture both recheck current package authority.
    let completed = runtime.complete(&work, &mut output);
    let retried = runtime.prepare_review(command.clone(), Cancellation::durable());
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
