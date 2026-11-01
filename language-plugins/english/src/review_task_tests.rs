use super::*;
use mlearn_language_sdk::{
    learning::{KnowledgeKey, ReviewDirection},
    serde_json::json,
};
use std::collections::BTreeSet;

const TARGET: &str = "wn30:n:0001:cat";

fn input(capabilities: &[&str]) -> Value {
    json!({
        "contractVersion":2,"packageId":PACKAGE,"packageRevision":"fixture-r1",
        "targetId":TARGET,
        "eligibleKeys":capabilities.iter().map(|capability| KnowledgeKey {
            package_id: PACKAGE.into(), target_id: TARGET.into(),
            capability: format!("{PACKAGE}:{capability}"),
        }).collect::<Vec<_>>(),
    })
}

fn lookup(key: &str) -> Result<Option<Value>, String> {
    Ok(match key {
        "lemma/cat" => Some(json!([TARGET])),
        "sense/n:0001" => Some(json!({"pos":"noun","definition":"a feline"})),
        _ => None,
    })
}

#[test]
fn canonical_requested_subset_uses_dictionary_and_self_report_contract() {
    // Given only meaning is eligible and no authored Material exists.
    let value = input(&["meaning"]);
    // When the real package generator resolves its canonical sense.
    let output: TaskOutput = serde_json::from_value(generate(value, &lookup).unwrap()).unwrap();
    // Then the task uses dictionary content and makes no grading/audio claim.
    assert_eq!(output.contract_version, 2);
    assert_eq!(output.tasks.len(), 1);
    let task = &output.tasks[0];
    assert_eq!(task.probe.cue, "cat");
    assert_eq!(task.probe.answer, "a feline");
    assert_eq!(task.probe.targets.len(), 1);
    assert_eq!(
        task.probe.targets[0].key.as_ref().unwrap().capability,
        format!("{PACKAGE}:meaning")
    );
    assert_eq!(task.task.response_spec, ResponseSpec::SelfReport);
    assert!(task.task.validator_id.is_none());
    assert!(task.probe.required_media.is_none());
    assert_eq!(
        task.task.attribution,
        inspect(TARGET, &lookup).unwrap().attribution
    );
    task.task.validate().unwrap();
    assert!(mlearn_core::review_compatible(&task.probe));
}

#[test]
fn canonical_all_requested_keys_have_exact_disjoint_coverage() {
    // Given both supported non-audio directions.
    let value = input(&["meaning", "written-recognition"]);
    let request: TaskInput = serde_json::from_value(value.clone()).unwrap();
    // When generating the canonical tasks.
    let output: TaskOutput = serde_json::from_value(generate(value, &lookup).unwrap()).unwrap();
    // Then tested keys cover exactly the request, never anything disclosed by a cue.
    let tested = output
        .tasks
        .iter()
        .flat_map(|task| &task.probe.targets)
        .map(|row| row.key.as_ref().unwrap().capability.as_str())
        .collect::<BTreeSet<_>>();
    let requested = request
        .eligible_keys
        .iter()
        .map(|key| key.capability.as_str())
        .collect::<BTreeSet<_>>();
    assert_eq!(tested, requested);
    assert!(output
        .tasks
        .iter()
        .all(|task| mlearn_core::review_compatible(&task.probe)));
    for task in &output.tasks {
        assert!(task.probe.targets.iter().all(|row| {
            let key = row.key.as_ref().unwrap();
            request.eligible_keys.contains(key) && !task.probe.supplied.contains(key)
        }));
    }
}

#[test]
fn canonical_answer_disclosures_follow_each_revealed_direction() {
    // Given both lexical directions.
    let value = input(&["meaning", "written-recognition"]);
    // When generating full answers independently of the cue disclosures.
    let output: TaskOutput = serde_json::from_value(generate(value, &lookup).unwrap()).unwrap();
    // Then answer reveal names only what that answer actually discloses.
    for task in output.tasks {
        let (cue_capability, answer_capability, answer) = match task.probe.direction {
            ReviewDirection::Written => ("written-recognition", "meaning", "a feline"),
            ReviewDirection::Focused => ("meaning", "written-recognition", "cat"),
            ReviewDirection::Audio => panic!("no canonical audio binding"),
        };
        assert_eq!(task.probe.answer, answer);
        assert_eq!(task.probe.supplied.len(), 1);
        assert_eq!(
            task.probe.supplied[0].capability,
            format!("{PACKAGE}:{cue_capability}")
        );
        assert_eq!(task.task.answer_supplied.len(), 1);
        assert_eq!(
            task.task.answer_supplied[0].capability,
            format!("{PACKAGE}:{answer_capability}")
        );
        assert_eq!(task.task.answer_supplied[0].target_id, TARGET);
    }
}

#[test]
fn canonical_listening_and_unknown_capabilities_are_rejected() {
    // Given requests for unavailable audio, an unknown or foreign capability.
    let values = [
        input(&["listening"]),
        input(&["meaning", "listening"]),
        input(&["unknown"]),
        {
            let mut value = input(&["meaning"]);
            value["eligibleKeys"][0]["capability"] = json!("org.mlearn.japanese:meaning");
            value
        },
    ];
    // When each request reaches the package owner.
    let results = values
        .into_iter()
        .map(|value| generate(value, &lookup))
        .collect::<Vec<_>>();
    // Then none silently becomes a written or partial listening success.
    assert!(results.iter().all(Result::is_err));
}

#[test]
fn canonical_foreign_unknown_and_mismatched_targets_are_rejected() {
    // Given foreign package, undeclared target and widened key scope.
    let mut foreign = input(&["meaning"]);
    foreign["packageId"] = json!("org.mlearn.japanese");
    let mut unknown = input(&["meaning"]);
    unknown["targetId"] = json!("wn30:n:0002:cat");
    unknown["eligibleKeys"][0]["targetId"] = unknown["targetId"].clone();
    let mut mismatch = input(&["meaning"]);
    mismatch["eligibleKeys"][0]["targetId"] = json!("wn30:n:0002:cat");
    // When canonical generation validates identity and resource membership.
    let results = [foreign, unknown, mismatch]
        .into_iter()
        .map(|value| generate(value, &lookup))
        .collect::<Vec<_>>();
    // Then no other target acquires this sense's task.
    assert!(results.iter().all(Result::is_err));
}

#[test]
fn canonical_definition_that_discloses_written_answer_is_rejected() {
    // Given the requested written answer already appears in its dictionary cue.
    let value = input(&["written-recognition"]);
    let revealing = |key: &str| {
        if key == "sense/n:0001" {
            Ok(Some(json!({"pos":"noun","definition":"a cat is a feline"})))
        } else {
            lookup(key)
        }
    };
    // When generating this direction rather than falling back to meaning.
    let result = generate(value, &revealing);
    // Then no contaminated or wrong-key task is returned.
    assert!(result.is_err());
}
