use super::*;

#[test]
fn typed_validation_assesses_only_finite_cases_with_package_local_normalization() {
    // Given a real generated cloze and raw responses including unlisted alternatives.
    let output = tasks(&["grammar-form"]);
    let task = &output.tasks[0];
    let cases = [
        (" DID NOT FOLD \r\n", ValidationResult::Accepted),
        ("didn't fold", ValidationResult::Accepted),
        ("did not folded", ValidationResult::Rejected),
        ("does not fold", ValidationResult::Rejected),
        ("never folded", ValidationResult::Unassessed),
        ("", ValidationResult::Unassessed),
        ("did  not fold", ValidationResult::Unassessed),
        ("didn’t fold", ValidationResult::Unassessed),
        ("\u{a0}did not fold", ValidationResult::Unassessed),
    ];
    for (raw, expected) in cases {
        let input = invocation(task, json!({"kind":"typed_text","text":raw}));
        // When actual production validation executes on the response.
        let result: ValidationOutput =
            serde_json::from_value(dispatch("learning.validate.v1", input.clone()).unwrap())
                .unwrap();
        // Then the finite result binds exactly the admitted row.
        let parsed: ValidationInput = serde_json::from_value(input.clone()).unwrap();
        result.validate(&parsed, &["answer"]).unwrap();
        assert_eq!(result.outcomes[0].result, expected);
    }
}

#[test]
fn choices_compare_declared_option_ids_instead_of_display_text() {
    // Given both declared options and their true IDs.
    let output = tasks(&["grammar-meaning"]);
    let task = &output.tasks[0];
    for (id, expected) in [
        ("negative", ValidationResult::Accepted),
        ("positive", ValidationResult::Rejected),
    ] {
        // When executing the generated contrast validator.
        let result: ValidationOutput = serde_json::from_value(
            dispatch(
                "learning.validate.v1",
                invocation(task, json!({"kind":"choice_id","id":id})),
            )
            .unwrap(),
        )
        .unwrap();
        // Then the selected ID determines the outcome for the admitted row.
        assert_eq!(result.outcomes.len(), 1);
        assert_eq!(result.outcomes[0].target_id, "answer");
        assert_eq!(result.outcomes[0].result, expected);
    }
}

#[test]
fn invalid_validation_identity_or_response_returns_no_learner_outcome() {
    // Given valid generated typed/choice invocations and malformed variants.
    let typed = tasks(&["grammar-form"]);
    let contrast = tasks(&["grammar-meaning"]);
    let valid = invocation(
        &typed.tasks[0],
        json!({"kind":"typed_text","text":"did not fold"}),
    );
    let mut invalid = Vec::new();
    for (field, value) in [
        ("contractVersion", json!(2)),
        ("packageId", json!("org.example.foreign")),
        ("packageRevision", json!("")),
        ("taskId", json!("org.mlearn.english:grammar/unknown/typed")),
        ("taskRevision", json!(2)),
        (
            "validatorId",
            json!("org.mlearn.english:grammar/unknown/validator"),
        ),
        ("response", json!({"kind":"choice_id","id":"negative"})),
        (
            "response",
            json!({"kind":"typed_text","text":"x".repeat(2049)}),
        ),
        ("response", json!({"kind":"other","text":"did not fold"})),
    ] {
        let mut input = valid.clone();
        input[field] = value;
        invalid.push(input);
    }
    invalid.push(invocation(
        &contrast.tasks[0],
        json!({"kind":"choice_id","id":"not-an-option"}),
    ));
    invalid.push(invocation(
        &contrast.tasks[0],
        json!({"kind":"typed_text","text":"negative"}),
    ));
    // When dispatching these invocations rather than interpreting them as wrong answers.
    let results = invalid
        .into_iter()
        .map(|input| dispatch("learning.validate.v1", input));
    // Then every malformed operation fails without emitting a negative learner result.
    assert!(results.into_iter().all(|result| result.is_err()));
}

#[test]
fn retrospective_recall_has_no_validator_and_cannot_execute_one() {
    // Given a generated retrospective self-report task.
    let output = tasks(&["grammar-recall"]);
    let task = &output.tasks[0];
    assert_eq!(task.task.response_spec, ResponseSpec::SelfReport);
    assert!(task.task.validator_id.is_none());
    let mut forged = invocation(task, json!({"kind":"typed_text","text":"did not fold"}));
    forged["validatorId"] = json!(format!("{}/validator-v1", task.probe.id));
    // When attempting to route self-report through a fabricated validator.
    let result = dispatch("learning.validate.v1", forged);
    // Then no validator success or failure is invented.
    assert!(result.is_err());
}
