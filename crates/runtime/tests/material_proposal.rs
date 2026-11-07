use mlearn_core::*;
use mlearn_language_host::CodePolicy;
use mlearn_runtime::Runtime;

fn execute(runtime: &mut Runtime, request: Request) -> Response {
    serde_json::from_str(&runtime.execute(&serde_json::to_string(&request).unwrap())).unwrap()
}

fn content() -> MaterialContent {
    MaterialContent {
        package_id: "example.language".into(),
        target_id: None,
        package_revision: None,
        sense: None,
        phrase: "authored phrase".into(),
        reading: String::new(),
        meaning: "authored meaning".into(),
        context: String::new(),
        notes: String::new(),
        examples: vec![],
        source: None,
        attachments: vec![],
    }
}

fn receipt(response: Response) -> MaterialProposalReceipt {
    match response {
        Response::MaterialProposalReviewed { receipt } => receipt,
        other => panic!("Expected a proposal receipt: {other:?}"),
    }
}

#[test]
fn native_proposal_review_replaces_only_after_explicit_acceptance_and_recovers_exact_receipts() {
    // Given saved manual Material, independent of a provider or installed package.
    let dir = tempfile::tempdir().unwrap();
    let mut runtime = Runtime::open(dir.path(), CodePolicy::MobileBundled, None, vec![]).unwrap();
    let original = match execute(
        &mut runtime,
        Request::CreateMaterial {
            command: MaterialCreate {
                command_id: "original".into(),
                content: content(),
                distinct: false,
                media_imports: vec![],
            },
        },
    ) {
        Response::MaterialWritten {
            outcome: MaterialWriteResult::Saved { material, .. },
        } => *material,
        other => panic!("Expected saved Material: {other:?}"),
    };
    let mut draft = original.content.clone();
    draft.notes = "proposed note".into();
    let suggestion = MaterialSuggestion {
        command_id: "suggest".into(),
        content: draft,
        replaces: Some(MaterialReference {
            id: original.id.clone(),
            revision: 1,
        }),
    };
    let proposed = receipt(execute(
        &mut runtime,
        Request::SuggestMaterial {
            command: suggestion.clone(),
        },
    ));
    assert!(matches!(
        proposed.proposal.state,
        MaterialProposalState::Pending
    ));
    match execute(
        &mut runtime,
        Request::Material {
            id: original.id.clone(),
        },
    ) {
        Response::Material { material } => assert_eq!(material, original),
        other => panic!("Expected original Material: {other:?}"),
    }
    let edit = MaterialProposalReview {
        command_id: "edit".into(),
        id: proposed.proposal.id.clone(),
        expected_revision: 1,
        decision: MaterialProposalDecision::Edit {
            patch: MaterialBulkPatch {
                examples: Some(vec!["An edited example.".into()]),
                ..Default::default()
            },
        },
    };
    let edited = receipt(execute(
        &mut runtime,
        Request::ReviewMaterialProposal { command: edit },
    ));
    let accept = MaterialProposalReview {
        command_id: "accept".into(),
        id: edited.proposal.id.clone(),
        expected_revision: 2,
        decision: MaterialProposalDecision::Accept { distinct: false },
    };
    // When the explicit acceptance commits and its renderer receipt is retried after restart.
    let accepted = receipt(execute(
        &mut runtime,
        Request::ReviewMaterialProposal {
            command: accept.clone(),
        },
    ));
    drop(runtime);
    let mut runtime = Runtime::open(dir.path(), CodePolicy::MobileBundled, None, vec![]).unwrap();
    // Then only the original Material revision advances, once, with edited authored text.
    assert_eq!(
        receipt(execute(
            &mut runtime,
            Request::ReviewMaterialProposal { command: accept }
        )),
        accepted
    );
    match execute(
        &mut runtime,
        Request::Material {
            id: original.id.clone(),
        },
    ) {
        Response::Material { material } => {
            assert_eq!(material.id, original.id);
            assert_eq!(material.revision, 2);
            assert_eq!(material.content.notes, "proposed note");
            assert_eq!(material.content.examples, vec!["An edited example."]);
            assert_eq!(material.content.meaning, original.content.meaning);
        }
        other => panic!("Expected accepted Material: {other:?}"),
    }
    let replay = receipt(execute(
        &mut runtime,
        Request::SuggestMaterial {
            command: suggestion,
        },
    ));
    assert_eq!(replay.committed_revision, 1);
    assert_eq!(replay.proposal, accepted.proposal);
    match execute(
        &mut runtime,
        Request::MaterialProposals {
            query: MaterialProposalQuery {
                after: None,
                package_id: None,
                pending_only: true,
            },
        },
    ) {
        Response::MaterialProposals { page } => assert!(page.items.is_empty()),
        other => panic!("Expected proposal page: {other:?}"),
    }
}

#[test]
fn native_proposals_cannot_invent_dictionary_identity_or_change_an_existing_items_basis() {
    // Given a saved authored item and a renderer-supplied draft.
    let dir = tempfile::tempdir().unwrap();
    let mut runtime = Runtime::open(dir.path(), CodePolicy::MobileBundled, None, vec![]).unwrap();
    let original = match execute(
        &mut runtime,
        Request::CreateMaterial {
            command: MaterialCreate {
                command_id: "original".into(),
                content: content(),
                distinct: false,
                media_imports: vec![],
            },
        },
    ) {
        Response::MaterialWritten {
            outcome: MaterialWriteResult::Saved { material, .. },
        } => *material,
        other => panic!("Expected saved Material: {other:?}"),
    };
    let mut forged = content();
    forged.target_id = Some("unvalidated-target".into());
    // When it claims either a new dictionary identity or a different replacement identity.
    let new = execute(
        &mut runtime,
        Request::SuggestMaterial {
            command: MaterialSuggestion {
                command_id: "new".into(),
                content: forged.clone(),
                replaces: None,
            },
        },
    );
    let replacement = execute(
        &mut runtime,
        Request::SuggestMaterial {
            command: MaterialSuggestion {
                command_id: "replacement".into(),
                content: forged,
                replaces: Some(MaterialReference {
                    id: original.id,
                    revision: 1,
                }),
            },
        },
    );
    // Then both are rejected at the native boundary and no pending draft is admitted.
    assert!(matches!(new, Response::Error { .. }));
    assert!(matches!(replacement, Response::Error { .. }));
    match execute(
        &mut runtime,
        Request::MaterialProposals {
            query: MaterialProposalQuery {
                after: None,
                package_id: None,
                pending_only: true,
            },
        },
    ) {
        Response::MaterialProposals { page } => assert!(page.items.is_empty()),
        other => panic!("Expected proposal page: {other:?}"),
    }
}
