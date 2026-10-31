use super::*;
use mlearn_core::{GraphNeighborhood, LexicalEntry};
use mlearn_language_sdk::serde_json::json;

mod validation;

fn dispatch(capability: &str, input: Value) -> Result<Value, String> {
    crate::handle(mlearn_language_sdk::Call {
        capability: capability.into(),
        input,
    })
}

fn request(capabilities: &[&str]) -> Value {
    json!({
        "contractVersion":2, "packageId":PACKAGE, "packageRevision":"authenticated-test-revision",
        "targetId":grammar::TARGET,
        "eligibleKeys":capabilities.iter().map(|capability| KnowledgeKey {
            package_id:PACKAGE.into(), target_id:grammar::TARGET.into(),
            capability:format!("{PACKAGE}:{capability}"),
        }).collect::<Vec<_>>(),
    })
}

fn tasks(capabilities: &[&str]) -> TaskOutput {
    serde_json::from_value(dispatch("learning.probes.v2", request(capabilities)).unwrap()).unwrap()
}

fn invocation(task: &PackageTask, response: Value) -> Value {
    json!({
        "contractVersion":1, "packageId":PACKAGE, "packageRevision":"authenticated-test-revision",
        "taskId":task.probe.id, "taskRevision":task.task.revision,
        "validatorId":task.task.validator_id, "response":response,
    })
}

#[test]
fn generation_tests_only_each_requested_key_without_supplying_it() {
    for capability in ["grammar-form", "grammar-meaning", "grammar-recall"] {
        // Given one admitted Knowledge key.
        let input = request(&[capability]);
        let expected: TaskInput = serde_json::from_value(input.clone()).unwrap();
        // When generating through actual package dispatch.
        let output: TaskOutput =
            serde_json::from_value(dispatch("learning.probes.v2", input).unwrap()).unwrap();
        // Then no other tested capability or supplied/tested overlap appears.
        assert_eq!(output.contract_version, 2);
        assert_eq!(output.tasks.len(), 1);
        let task = &output.tasks[0];
        task.task.validate().unwrap();
        assert_eq!(task.probe.targets.len(), 1);
        assert_eq!(
            task.probe.targets[0].key.as_ref(),
            Some(&expected.eligible_keys[0])
        );
        assert!(task.probe.supplied.is_empty());
        assert!(task.probe.required_media.is_none());
        let native: mlearn_core::ReviewProbe =
            serde_json::from_value(serde_json::to_value(&task.probe).unwrap()).unwrap();
        assert!(mlearn_core::review_compatible(&native));
    }
}

#[test]
fn generation_rejects_unregistered_or_widened_scope() {
    // Given unsupported identity/version, unknown capability, duplicate and foreign keys.
    let valid = request(&["grammar-form"]);
    let mut invalid = Vec::new();
    for (field, value) in [
        ("contractVersion", json!(1)),
        ("packageId", json!("org.example.foreign")),
        (
            "targetId",
            json!("org.mlearn.english:grammar/not-registered"),
        ),
        ("packageRevision", json!("")),
    ] {
        let mut input = valid.clone();
        input[field] = value;
        invalid.push(input);
    }
    invalid.push(request(&["meaning"]));
    invalid.push(request(&["grammar-form", "grammar-form"]));
    invalid.push(request(&[]));
    let mut foreign = valid;
    foreign["eligibleKeys"][0]["targetId"] = json!("wn30:n:0001:cat");
    invalid.push(foreign);
    // When invoking generation on each invalid scope.
    let results = invalid
        .into_iter()
        .map(|input| dispatch("learning.probes.v2", input));
    // Then none silently becomes admitted work.
    assert!(results.into_iter().all(|result| result.is_err()));
}

#[test]
fn registered_grammar_target_resolves_through_description_inspection_and_graph() {
    // Given the exact registered target.
    let query = json!({"targetId":grammar::TARGET,"after":null});
    // When resolving its public package surfaces.
    let description = dispatch("language.describe.v1", json!({})).unwrap();
    let entry: LexicalEntry =
        serde_json::from_value(dispatch("target.inspect.v1", query.clone()).unwrap()).unwrap();
    let graph: GraphNeighborhood =
        serde_json::from_value(dispatch("graph.neighborhood.v1", query).unwrap()).unwrap();
    // Then description, target and graph agree on supported identities.
    let catalog: mlearn_core::CollectionDescription =
        serde_json::from_value(description["catalog"].clone()).unwrap();
    catalog.validate(PACKAGE).unwrap();
    assert!(
        catalog
            .kinds
            .iter()
            .any(|kind| kind.id == grammar::kind().id),
        "The registered grammar kind must be browsable"
    );
    let declared: Vec<mlearn_core::Capability> =
        serde_json::from_value(description["capabilities"].clone()).unwrap();
    assert_eq!(entry.target_id, grammar::TARGET);
    assert_eq!(entry.capabilities, grammar::capabilities());
    assert!(
        entry
            .capabilities
            .iter()
            .all(|capability| declared.contains(capability)),
        "Inspected capabilities must belong to the package description"
    );
    assert_eq!(graph.entity.target_id.as_deref(), Some(grammar::TARGET));
    assert_eq!(graph.entity.capabilities, entry.capabilities);
    for property in [
        "detail",
        "formation",
        "examples",
        "limitations",
        "relationships",
        "formation-reference",
    ] {
        assert!(
            graph
                .entity
                .properties
                .iter()
                .any(|value| value.id == format!("{PACKAGE}:grammar-{property}")),
            "The grammar graph must retain its declared {property} property"
        );
    }
    assert!(graph.connections.is_empty());
    assert!(graph.next.is_none());
}

#[test]
fn unknown_grammar_and_nonexistent_continuation_are_operation_errors() {
    // Given a plausible but unregistered topic and a cursor for a finite neighborhood.
    let unknown = json!({"targetId":"org.mlearn.english:grammar/affirmative-past","after":null});
    let cursor = json!({"targetId":grammar::TARGET,"after":"1"});
    // When asking existing target/graph dispatch to resolve them.
    let results = [
        dispatch("target.inspect.v1", unknown.clone()),
        dispatch("graph.neighborhood.v1", unknown),
        dispatch("graph.neighborhood.v1", cursor),
    ];
    // Then no invented target or relationship is returned.
    assert!(results.into_iter().all(|result| result.is_err()));
}

#[test]
fn registered_grammar_does_not_poison_the_existing_v1_due_queue() {
    // Given a genuine grammar target saved as Material beside ordinary vocabulary.
    let input = json!({
        "materialId":"grammar-material","materialRevision":1,"packageId":PACKAGE,
        "packageRevision":"r1","targetId":grammar::TARGET,
        "phrase":"Past simple negative","reading":"","meaning":"A past negative construction",
        "context":"","media":[]
    });
    // When the existing due Review owner asks for its v1 probe family.
    let output: mlearn_language_sdk::learning::ProbeOutput =
        serde_json::from_value(dispatch("learning.probes.v1", input).unwrap()).unwrap();
    // Then this v2-only target is skipped, not a fatal error or fake lexical recall.
    assert_eq!(output.contract_version, 1);
    assert!(output.probes.is_empty());
}

#[test]
fn original_v1_local_material_keeps_lexical_recall_wire_behavior() {
    // Given original local v1 Material rather than a grammar target.
    let input = json!({
        "materialId":"local", "materialRevision":1, "packageId":PACKAGE,
        "packageRevision":"r1", "targetId":null,
        "phrase":"cat", "reading":"", "meaning":"a feline", "context":"", "media":[],
    });
    // When invoking the unchanged production v1 path.
    let output: mlearn_language_sdk::learning::ProbeOutput =
        serde_json::from_value(dispatch("learning.probes.v1", input).unwrap()).unwrap();
    // Then written/focused recall remains v1 and acquires no grammar keys.
    assert_eq!(output.contract_version, 1);
    assert_eq!(output.probes.len(), 2);
    assert_eq!(output.probes[0].direction, ReviewDirection::Written);
    assert_eq!(output.probes[1].direction, ReviewDirection::Focused);
    assert!(
        output
            .probes
            .iter()
            .flat_map(|probe| &probe.targets)
            .all(|row| row.key.is_none()),
        "Local Material must not acquire canonical Knowledge rows"
    );
}
