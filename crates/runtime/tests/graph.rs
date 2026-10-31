use mlearn_language_host::CodePolicy;
use mlearn_runtime::{BundledPlugin, Runtime, catalog::Manifest};
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::Path};

fn open(root: &Path, package: &str) -> Runtime {
    let artifacts = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/plugin-cdn");
    let manifests: Vec<Manifest> =
        serde_json::from_slice(&std::fs::read(artifacts.join("bundle.json")).unwrap()).unwrap();
    let manifest = manifests
        .into_iter()
        .find(|item| item.id == package)
        .unwrap();
    let bundled = BundledPlugin {
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
            .collect::<BTreeMap<_, _>>(),
        manifest,
    };
    Runtime::open(root, CodePolicy::MobileBundled, None, vec![bundled]).unwrap()
}

fn execute(runtime: &mut Runtime, request: Value) -> Value {
    serde_json::from_str(&runtime.execute(&request.to_string())).unwrap()
}

fn call(runtime: &mut Runtime, request: Value) -> Value {
    let response = execute(runtime, request);
    assert_ne!(response["type"], "error", "{response}");
    response
}

fn target(runtime: &mut Runtime, package: &str, text: &str) -> String {
    let analyzed = call(
        runtime,
        json!({"type":"invoke_plugin","pluginId":package,
        "capability":"text.analyze.v1","input":{"texts":[text]}}),
    );
    analyzed["output"][0][0]["targets"][0]
        .as_str()
        .unwrap()
        .into()
}

fn graph(
    runtime: &mut Runtime,
    package: &str,
    target: &str,
    revision: &Value,
    after: Value,
) -> Value {
    call(
        runtime,
        json!({"type":"graph_neighborhood","query":{
            "packageId":package,"targetId":target,"expectedRevision":revision,"after":after
        }}),
    )["page"]
        .clone()
}

#[test]
fn real_wordnet_graph_pages_keep_live_knowledge_separate_and_fence_package_target_identity() {
    // Given actual compiled WordNet data with several lexical analyses.
    let directory = tempfile::tempdir().unwrap();
    let profile = directory.path().join("profile");
    let package = "org.mlearn.english";
    let mut runtime = open(&profile, package);
    let target = target(&mut runtime, package, "run");
    let entry = call(
        &mut runtime,
        json!({"type":"inspect_target","packageId":package,
        "targetId":target,"expectedRevision":null}),
    );
    let revision = &entry["packageRevision"];
    let description = call(
        &mut runtime,
        json!({"type":"describe_language","packageId":package}),
    );
    let capability = &description["description"]["annotationCapability"];
    let first = graph(&mut runtime, package, &target, revision, Value::Null);
    assert_eq!(first["entity"]["targetId"], target);
    assert_eq!(first["connections"].as_array().unwrap().len(), 16);
    assert!(first["next"].is_object());
    let other = first["connections"]
        .as_array()
        .unwrap()
        .iter()
        .find_map(|connection| connection["entity"]["targetId"].as_str())
        .unwrap()
        .to_owned();
    assert_ne!(other, target);

    // When an explicit claim changes between immutable graph pages.
    call(
        &mut runtime,
        json!({"type":"change_claim","change":{"commandId":"root-claim",
        "key":{"packageId":package,"targetId":target,"capability":capability},"claim":true}}),
    );
    let second = graph(
        &mut runtime,
        package,
        &target,
        revision,
        first["next"].clone(),
    );
    assert!(second["knowledge"].as_array().unwrap().iter().any(
        |projection| projection["key"]["targetId"] == target
            && projection["key"]["capability"] == *capability
            && projection["claim"] == true
    ));
    assert!(
        second["knowledge"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|projection| projection["key"]["targetId"] != target)
            .all(|projection| projection["claim"].is_null())
    );
    let invalid_target_cursor = execute(
        &mut runtime,
        json!({"type":"graph_neighborhood","query":{
            "packageId":package,"targetId":other,"expectedRevision":revision,"after":first["next"]
        }}),
    );
    assert_eq!(invalid_target_cursor["type"], "error");
    let invalid_revision = execute(
        &mut runtime,
        json!({"type":"graph_neighborhood","query":{
            "packageId":package,"targetId":target,"expectedRevision":"0".repeat(64),"after":null
        }}),
    );
    assert_eq!(invalid_revision["type"], "error");

    // Then each stable relation appears once, and reopening retains the claim,
    // not a copied learner state on the alternative lexical targets.
    let mut ids = std::collections::BTreeSet::new();
    let mut page = graph(&mut runtime, package, &target, revision, Value::Null);
    let mut pages = 0;
    loop {
        for connection in page["connections"].as_array().unwrap() {
            assert!(ids.insert(connection["relation"]["id"].as_str().unwrap().to_owned()));
            assert!(
                ["alternative", "support"]
                    .contains(&connection["relation"]["category"].as_str().unwrap())
            );
        }
        pages += 1;
        assert!(pages < 16);
        if page["next"].is_null() {
            break;
        }
        page = graph(
            &mut runtime,
            package,
            &target,
            revision,
            page["next"].clone(),
        );
    }
    assert!(ids.len() > 16);
    drop(runtime);
    let mut runtime = open(&profile, package);
    let reopened = graph(&mut runtime, package, &target, revision, Value::Null);
    let knowledge = call(
        &mut runtime,
        json!({"type":"knowledge","keys":[
            {"packageId":package,"targetId":target,"capability":capability},
            {"packageId":package,"targetId":other,"capability":capability}
        ]}),
    );
    assert_eq!(knowledge["projections"][0]["claim"], true);
    assert_eq!(knowledge["projections"][1]["claim"], Value::Null);
    assert_eq!(reopened["connections"], first["connections"]);
}

#[test]
fn real_jmdict_graph_properties_and_homophones_never_acquire_another_entrys_claim() {
    // Given actual Japanese package analysis, not a fabricated target ID.
    let directory = tempfile::tempdir().unwrap();
    let package = "org.mlearn.japanese";
    let mut runtime = open(&directory.path().join("profile"), package);
    let target = target(&mut runtime, package, "橋");
    let entry = call(
        &mut runtime,
        json!({"type":"inspect_target","packageId":package,
        "targetId":target,"expectedRevision":null}),
    );
    let revision = &entry["packageRevision"];
    let description = call(
        &mut runtime,
        json!({"type":"describe_language","packageId":package}),
    );
    let capability = &description["description"]["annotationCapability"];

    // When its existing canonical target receives an explicit claim.
    call(
        &mut runtime,
        json!({"type":"change_claim","change":{"commandId":"bridge-claim",
        "key":{"packageId":package,"targetId":target,"capability":capability},"claim":true}}),
    );
    let mut page = graph(&mut runtime, package, &target, revision, Value::Null);
    let mut property = false;
    let mut homophone = false;
    let mut pages = 0;
    loop {
        for connection in page["connections"].as_array().unwrap() {
            match connection["relation"]["category"].as_str().unwrap() {
                "property" => {
                    property = true;
                    assert!(connection["entity"]["targetId"].is_null());
                    assert!(
                        connection["entity"]["capabilities"]
                            .as_array()
                            .unwrap()
                            .is_empty()
                    );
                }
                "alternative" | "support" => {
                    assert_ne!(connection["entity"]["targetId"], target);
                    if connection["entity"]["label"] == "箸"
                        || connection["entity"]["label"] == "端"
                    {
                        homophone = true;
                    }
                }
                role => panic!("Unexpected JMdict relationship category {role}"),
            }
        }
        // Then every other explicit target still reads its own native state.
        assert!(
            page["knowledge"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|projection| projection["key"]["targetId"] != target)
                .all(|projection| projection["claim"].is_null())
        );
        pages += 1;
        assert!(pages < 32);
        if page["next"].is_null() {
            break;
        }
        page = graph(
            &mut runtime,
            package,
            &target,
            revision,
            page["next"].clone(),
        );
    }
    assert!(property && homophone);
}

#[test]
fn undeclared_graph_capability_reports_unavailable_instead_of_an_empty_neighborhood() {
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = open(&directory.path().join("profile"), "example.hello");
    let response = execute(
        &mut runtime,
        json!({"type":"graph_neighborhood","query":{
            "packageId":"example.hello","targetId":"not-a-declared-target",
            "expectedRevision":null,"after":null
        }}),
    );
    assert_eq!(response["type"], "error");
    assert!(response.get("page").is_none());
}
