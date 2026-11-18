use super::{HttpResponse, action, seed, server, turn, wait};
use crate::RuntimeExecutor;
use mlearn_core::*;

fn execute(runtime: &RuntimeExecutor, request: Request) -> Response {
    serde_json::from_str(&runtime.execute(&serde_json::to_string(&request).unwrap())).unwrap()
}

fn start(source: &SourceRecord, command: &str) -> MaterialGenerationStart {
    MaterialGenerationStart {
        command_id: command.into(),
        instruction: "Suggest examples from this sentence.".into(),
        maximum: 2,
        basis: MaterialGenerationBasis::Source {
            source: SourceAnchor {
                source_id: source.id.clone(),
                content_revision: source.media_revision.clone(),
                package_id: source.package_id.clone(),
                package_version: source.package_version.clone(),
                text: "Children walked home.".into(),
                locator: SourceLocator::Video {
                    subtitle_revision: source.subtitle_revision.clone(),
                    cue_index: Some(0),
                    selection_start: 0,
                    selection_end: 21,
                    position_ms: 0,
                    subtitle_offset_ms: 0,
                    playback_rate: 1.0,
                },
            },
        },
    }
}

fn report(runtime: &RuntimeExecutor, request: Request) -> MaterialGenerationReport {
    match execute(runtime, request) {
        Response::MaterialGeneration { report } => report,
        other => panic!("Expected native generation report: {other:?}"),
    }
}

#[test]
fn generated_output_uses_the_shared_provider_and_requires_explicit_collection_and_acceptance() {
    // Given the actual native source/package and the common HTTP/SSE provider owner.
    let (_directory, runtime, source) = crate::watch::source_execution_tests::fixture();
    let (endpoint, requests, server) = server(vec![HttpResponse {
        text: concat!(
            "{\"quote\":\"Children\",\"reading\":\"\",\"meaning\":\"young people\",\"notes\":\"review this\",\"examples\":[\"Children read.\"]}\n",
            "{\"quote\":\"absent\",\"reading\":\"\",\"meaning\":\"\",\"notes\":\"\",\"examples\":[]}",
        ),
        hold: false,
    }]);
    seed(&runtime, &endpoint);
    let command = start(&source, "material-generate-once");
    let (published, finished) = runtime.observe_generation();
    let generation = match action(
        &runtime,
        ConversationCommand::GenerateMaterial {
            command: command.clone(),
        },
    ) {
        ConversationResult::Generation { generation } => generation,
        other => panic!("Expected native generation: {other:?}"),
    };
    wait(published);
    wait(finished);
    server.join().unwrap();
    let wire = requests
        .recv_timeout(std::time::Duration::from_secs(5))
        .unwrap();
    let (_, body) = wire.split_once("\r\n\r\n").unwrap();
    let body: serde_json::Value = serde_json::from_str(body).unwrap();
    assert_eq!(body["model"], "actual-fixture");
    assert_eq!(body["stream"], true);
    // When completed output is explicitly collected and its valid proposal is accepted.
    let before = report(
        &runtime,
        Request::MaterialGeneration {
            id: generation.id.clone(),
        },
    );
    assert_eq!(before.generation.status, GenerationStatus::Complete);
    assert!(!before.collected);
    assert!(before.proposal_ids.is_empty());
    let collected = report(
        &runtime,
        Request::CollectMaterialGeneration {
            id: generation.id.clone(),
        },
    );
    assert_eq!(collected.proposal_ids.len(), 1);
    assert_eq!(collected.errors.len(), 1);
    let proposal = match execute(
        &runtime,
        Request::MaterialProposal {
            id: collected.proposal_ids[0].clone(),
        },
    ) {
        Response::MaterialProposal { proposal } => proposal,
        other => panic!("Expected proposal: {other:?}"),
    };
    assert_eq!(proposal.generation_id, Some(generation.id.clone()));
    assert_eq!(proposal.content.phrase, "Children");
    assert_eq!(proposal.content.examples, vec!["Children read."]);
    let SourceLocator::Video {
        selection_start,
        selection_end,
        ..
    } = proposal.content.source.as_ref().unwrap().locator
    else {
        panic!("Expected original source");
    };
    assert_eq!((selection_start, selection_end), (0, 8));
    let accepted = match execute(
        &runtime,
        Request::ReviewMaterialProposal {
            command: MaterialProposalReview {
                command_id: "accept".into(),
                id: proposal.id,
                expected_revision: 1,
                decision: MaterialProposalDecision::Accept { distinct: false },
            },
        },
    ) {
        Response::MaterialProposalReviewed { receipt } => receipt,
        other => panic!("Expected proposal acceptance: {other:?}"),
    };
    // Then one actual Material exists, and replaying generation/collection starts no second request.
    assert!(matches!(
        accepted.acceptance,
        Some(MaterialProposalAcceptance::Saved { .. })
    ));
    assert_eq!(
        report(
            &runtime,
            Request::CollectMaterialGeneration {
                id: generation.id.clone()
            }
        ),
        collected
    );
    assert!(
        matches!(action(&runtime, ConversationCommand::GenerateMaterial { command }),
        ConversationResult::Generation { generation: current } if current.id == generation.id && current.status == GenerationStatus::Complete)
    );
    match execute(
        &runtime,
        Request::Materials {
            query: MaterialQuery {
                after: None,
                query: String::new(),
                source_id: None,
                include_excluded: true,
            },
        },
    ) {
        Response::Materials { page } => assert_eq!(page.items.len(), 1),
        other => panic!("Expected saved Material: {other:?}"),
    }
    assert!(requests.try_recv().is_err());
}

#[test]
fn proposal_generation_shares_worker_admission_and_cancellation_prevents_late_review_admission() {
    // Given a real provider response held after publishing a complete candidate line.
    let (_directory, runtime, source) = crate::watch::source_execution_tests::fixture();
    let (endpoint, requests, server) = server(vec![HttpResponse {
        text: "{\"quote\":\"Children\",\"reading\":\"\",\"meaning\":\"young people\",\"notes\":\"\",\"examples\":[]}\n",
        hold: true,
    }]);
    seed(&runtime, &endpoint);
    let (published, finished) = runtime.observe_generation();
    let generation = match action(
        &runtime,
        ConversationCommand::GenerateMaterial {
            command: start(&source, "held"),
        },
    ) {
        ConversationResult::Generation { generation } => generation,
        other => panic!("Expected generation: {other:?}"),
    };
    wait(published);
    // When another conversation requests the same shared worker, then this task is cancelled.
    let concurrent = execute(
        &runtime,
        Request::Conversation {
            command: ConversationCommand::SendTurn {
                turn: turn(&runtime),
            },
        },
    );
    assert!(matches!(concurrent, Response::Error { code, .. } if code == "busy"));
    action(
        &runtime,
        ConversationCommand::CancelGeneration {
            command_id: "cancel".into(),
            id: generation.id.clone(),
        },
    );
    wait(finished);
    server.join().unwrap();
    requests
        .recv_timeout(std::time::Duration::from_secs(5))
        .unwrap();
    // Then cancellation releases the wire/worker and cannot turn partial text into new drafts.
    let cancelled = report(
        &runtime,
        Request::MaterialGeneration {
            id: generation.id.clone(),
        },
    );
    assert_eq!(cancelled.generation.status, GenerationStatus::Cancelled);
    assert!(matches!(
        execute(
            &runtime,
            Request::CollectMaterialGeneration { id: generation.id }
        ),
        Response::Error { .. }
    ));
    match execute(
        &runtime,
        Request::MaterialProposals {
            query: MaterialProposalQuery {
                after: None,
                package_id: None,
                pending_only: true,
            },
        },
    ) {
        Response::MaterialProposals { page } => assert!(page.items.is_empty()),
        other => panic!("Expected empty proposal review: {other:?}"),
    }
}

#[test]
fn missing_optional_provider_does_not_admit_generation_or_hide_existing_material() {
    // Given the native app with saved source-independent Material and no configured provider.
    let (_directory, runtime, _) = crate::watch::source_execution_tests::fixture();
    let original = match execute(
        &runtime,
        Request::CreateMaterial {
            command: MaterialCreate {
                command_id: "original".into(),
                distinct: false,
                media_imports: Vec::new(),
                content: MaterialContent {
                    package_id: "org.mlearn.english".into(),
                    target_id: None,
                    package_revision: None,
                    sense: None,
                    phrase: "cat".into(),
                    reading: String::new(),
                    meaning: "animal".into(),
                    context: String::new(),
                    notes: String::new(),
                    examples: Vec::new(),
                    source: None,
                    attachments: Vec::new(),
                },
            },
        },
    ) {
        Response::MaterialWritten {
            outcome: MaterialWriteResult::Saved { material, .. },
        } => *material,
        other => panic!("Expected saved Material: {other:?}"),
    };
    // When generation is requested without a usable optional provider.
    let refused = execute(
        &runtime,
        Request::Conversation {
            command: ConversationCommand::GenerateMaterial {
                command: MaterialGenerationStart {
                    command_id: "unavailable".into(),
                    basis: MaterialGenerationBasis::Material {
                        material: MaterialReference {
                            id: original.id.clone(),
                            revision: 1,
                        },
                    },
                    instruction: String::new(),
                    maximum: 1,
                },
            },
        },
    );
    // Then no task is admitted and the exact saved content remains available.
    assert!(matches!(refused, Response::Error { code, .. } if code == "provider_unavailable"));
    match execute(
        &runtime,
        Request::Material {
            id: original.id.clone(),
        },
    ) {
        Response::Material { material } => assert_eq!(material, original),
        other => panic!("Expected original Material: {other:?}"),
    }
    match execute(&runtime, Request::MaterialGenerations { after: None }) {
        Response::MaterialGenerations { page } => assert!(page.items.is_empty()),
        other => panic!("Expected no admitted task: {other:?}"),
    }
}
