use mlearn_language_host::CodePolicy;
use mlearn_runtime::{BundledPlugin, Runtime, catalog::Manifest};
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::Path};

#[path = "support/review_practice.rs"]
mod practice;
#[path = "support/review_practice_target.rs"]
mod practice_target;

fn open(root: &Path, packages: bool) -> Runtime {
    let artifacts = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/plugin-cdn");
    let bundled = if packages {
        let manifests: Vec<Manifest> =
            serde_json::from_slice(&std::fs::read(artifacts.join("bundle.json")).unwrap()).unwrap();
        manifests
            .into_iter()
            .filter(|m| m.id == "org.mlearn.english")
            .map(|manifest| {
                assert!(
                    manifest
                        .capabilities
                        .iter()
                        .any(|c| c == "learning.probes.v1"),
                    "Rebuild the actual Review package fixture before running this owner suite"
                );
                BundledPlugin {
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
                }
            })
            .collect()
    } else {
        vec![]
    };
    Runtime::open(root, CodePolicy::MobileBundled, None, bundled).unwrap()
}

fn execute(runtime: &mut Runtime, request: Value) -> Value {
    serde_json::from_str(&runtime.execute(&request.to_string())).unwrap()
}

fn call(runtime: &mut Runtime, request: Value) -> Value {
    let response = execute(runtime, request);
    assert_ne!(response["type"], "error", "{response}");
    response
}

fn create(runtime: &mut Runtime, id: &str, phrase: &str, meaning: &str) -> Value {
    call(
        runtime,
        json!({"type":"create_material","command":{
            "commandId":id,"distinct":true,"content":{
                "packageId":"org.mlearn.english","targetId":null,"packageRevision":null,
                "sense":null,"phrase":phrase,"reading":"","meaning":meaning,"context":"",
                "notes":"","examples":[],"source":null,"attachments":[]
            }
        }}),
    )["outcome"]["material"]
        .clone()
}

fn mutate(runtime: &mut Runtime, session: &Value, id: &str, kind: &str, fields: Value) -> Value {
    let mut command = json!({"kind":kind,"mutation":{
        "commandId":id,"sessionId":session["id"],"expectedRevision":session["revision"]
    }});
    for (key, value) in fields.as_object().unwrap() {
        command[key] = value.clone();
    }
    call(runtime, json!({"type":"review","command":command}))["commit"]["session"].clone()
}

fn response(session: &Value) -> Value {
    json!({
        "encounterId":session["encounter"]["id"],
        "grades":session["encounter"]["targets"].as_array().unwrap().iter().map(|target| json!({
            "targetId":target["id"],"quality":"fluent","method":"remembered","easy":false
        })).collect::<Vec<_>>()
    })
}

#[test]
fn package_probe_reveal_is_durable_and_start_receipt_replays_without_package() {
    // Given actual authored content and the real bundled package.
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = open(directory.path(), true);
    create(&mut runtime, "material", "children", "young people");
    let start = json!({"kind":"start","start":{
        "commandId":"start","sessionId":"session","mode":{"kind":"continuous"}
    }});
    let started = call(&mut runtime, json!({"type":"review","command":start}));
    let session = &started["commit"]["session"];
    assert_eq!(session["encounter"]["cue"], "children");
    assert!(session["encounter"]["answer"].is_null());
    let revealed = mutate(
        &mut runtime,
        session,
        "reveal",
        "reveal",
        json!({"encounterId":session["encounter"]["id"]}),
    );
    drop(runtime);

    // When restarting without a package and retrying the original Start.
    let mut runtime = open(directory.path(), false);
    let replay = call(&mut runtime, json!({"type":"review","command":start}));

    // Then the original receipt returns the current exact revealed encounter.
    assert_eq!(replay["commit"]["committedRevision"], 1);
    assert_eq!(replay["commit"]["session"], revealed);
    assert_eq!(revealed["encounter"]["answer"], "young people");
}

#[test]
fn finite_next_uses_frozen_package_content_after_authored_edit_and_restart() {
    // Given a finite two-direction work set whose first probe has been answered.
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = open(directory.path(), true);
    let material = create(&mut runtime, "material", "children", "young people");
    let started = call(
        &mut runtime,
        json!({"type":"review","command":{"kind":"start","start":{
            "commandId":"start","sessionId":"finite","mode":{"kind":"finite","limit":2}
        }}}),
    );
    let session = &started["commit"]["session"];
    assert_eq!(session["total"], 2);
    let revealed = mutate(
        &mut runtime,
        session,
        "reveal",
        "reveal",
        json!({"encounterId":session["encounter"]["id"]}),
    );
    let submitted = mutate(
        &mut runtime,
        &revealed,
        "submit",
        "submit",
        json!({"response":response(&revealed)}),
    );
    let mut content = material["content"].clone();
    content["phrase"] = json!("changed phrase");
    content["meaning"] = json!("changed meaning");
    call(
        &mut runtime,
        json!({"type":"update_material","command":{
            "commandId":"edit","id":material["id"],"expectedRevision":1,
            "content":content,"excluded":false
        }}),
    );
    drop(runtime);
    let mut runtime = open(directory.path(), false);

    // When advancing the persisted finite work with no executable package.
    let next = mutate(&mut runtime, &submitted, "next", "next", json!({}));

    // Then the second admitted direction retains its original cue and revision.
    assert_eq!(next["encounter"]["cue"], "young people");
    assert_eq!(next["encounter"]["materialRevision"], 1);
    assert!(next["encounter"]["answer"].is_null());
}

#[test]
fn continuous_due_selection_crosses_native_pages_without_short_session_cap() {
    // Given more than one native page of unscheduled package-generated work.
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = open(directory.path(), true);
    let wanted = (0..35)
        .map(|index| {
            create(
                &mut runtime,
                &format!("material-{index}"),
                &format!("word-{index}"),
                "",
            )
        })
        .max_by_key(|material| material["id"].as_str().unwrap().to_owned())
        .unwrap();
    let mut content = wanted["content"].clone();
    content["meaning"] = json!("a distinct meaning");
    call(
        &mut runtime,
        json!({"type":"update_material","command":{
            "commandId":"make-last-usable","id":wanted["id"],"expectedRevision":1,
            "content":content,"excluded":false
        }}),
    );

    // When the package omits unavailable directions from the earlier material.
    let started = call(
        &mut runtime,
        json!({"type":"review","command":{"kind":"start","start":{
            "commandId":"start","sessionId":"continuous","mode":{"kind":"continuous"}
        }}}),
    );

    // Then bounded native paging still finds real work rather than an empty first page.
    assert_eq!(
        started["commit"]["session"]["encounter"]["materialId"],
        wanted["id"]
    );
    assert!(started["commit"]["session"]["total"].is_null());
}

#[test]
fn continuous_empty_session_can_retry_when_new_material_arrives() {
    // Given a continuous session with no current due material.
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = open(directory.path(), true);
    let started = call(
        &mut runtime,
        json!({"type":"review","command":{"kind":"start","start":{
            "commandId":"start","sessionId":"empty","mode":{"kind":"continuous"}
        }}}),
    );
    let session = &started["commit"]["session"];
    assert_eq!(session["state"], "unavailable");
    let material = create(&mut runtime, "material", "children", "young people");

    // When explicitly retrying due selection.
    let next = mutate(&mut runtime, session, "retry", "next", json!({}));

    // Then the same session admits the newly available package-generated encounter.
    assert_eq!(next["encounter"]["materialId"], material["id"]);
    assert_eq!(next["state"], "active");
}

#[test]
fn unavailable_earlier_package_does_not_strand_usable_due_work() {
    // Given an unavailable package sorting before usable English material.
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = open(directory.path(), true);
    let mut materials = [
        create(&mut runtime, "first", "children", "young people"),
        create(&mut runtime, "second", "trees", "woody plants"),
    ];
    materials.sort_by_key(|material| material["id"].as_str().unwrap().to_owned());
    let mut content = materials[0]["content"].clone();
    content["packageId"] = json!("unavailable.language");
    call(
        &mut runtime,
        json!({"type":"update_material","command":{
            "commandId":"missing-package","id":materials[0]["id"],"expectedRevision":1,
            "content":content,"excluded":false
        }}),
    );

    // When the scheduler scans the actual native queue.
    let started = call(
        &mut runtime,
        json!({"type":"review","command":{"kind":"start","start":{
            "commandId":"start","sessionId":"available","mode":{"kind":"continuous"}
        }}}),
    );

    // Then another unavailable package cannot suppress the supported work.
    assert_eq!(
        started["commit"]["session"]["encounter"]["materialId"],
        materials[1]["id"]
    );
}

#[test]
fn unavailable_package_failure_keeps_start_identity_retryable_after_recovery() {
    // Given persisted authored work without its executable language package.
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = open(directory.path(), false);
    create(&mut runtime, "material", "children", "young people");
    let command = json!({"kind":"start","start":{
        "commandId":"start","sessionId":"recovery","mode":{"kind":"continuous"}
    }});
    let failed = execute(&mut runtime, json!({"type":"review","command":command}));
    assert_eq!(failed["code"], "operation_failed");
    drop(runtime);
    let mut runtime = open(directory.path(), true);

    // When the same command retries after package availability is repaired.
    let recovered = call(&mut runtime, json!({"type":"review","command":command}));

    // Then no empty-success receipt or partial session stranded that identity.
    assert_eq!(recovered["commit"]["committedRevision"], 1);
    assert_eq!(
        recovered["commit"]["session"]["encounter"]["cue"],
        "children"
    );
}

#[test]
fn continuous_untested_work_does_not_starve_other_probe_directions_after_restart() {
    // Given a revealed written probe submitted wholly untested.
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = open(directory.path(), true);
    create(&mut runtime, "material", "children", "young people");
    let started = call(
        &mut runtime,
        json!({"type":"review","command":{"kind":"start","start":{
            "commandId":"start","sessionId":"untested","mode":{"kind":"continuous"}
        }}}),
    );
    let session = &started["commit"]["session"];
    let revealed = mutate(
        &mut runtime,
        session,
        "reveal",
        "reveal",
        json!({"encounterId":session["encounter"]["id"]}),
    );
    let mut untested = response(&revealed);
    for grade in untested["grades"].as_array_mut().unwrap() {
        grade["quality"] = Value::Null;
    }
    let submitted = mutate(
        &mut runtime,
        &revealed,
        "submit",
        "submit",
        json!({"response":untested}),
    );
    drop(runtime);
    let mut runtime = open(directory.path(), true);

    // When continuing the same native session after process restart.
    let next = mutate(&mut runtime, &submitted, "next", "next", json!({}));

    // Then unresolved rows remain ungraded without repeatedly replacing useful work.
    assert_eq!(next["encounter"]["direction"], "focused");
    assert_ne!(next["encounter"]["workId"], session["encounter"]["workId"]);
}

#[test]
fn review_source_return_uses_admitted_anchor_after_material_source_edit() {
    // Given a Review encounter admitted from an actual saved video cue.
    let directory = tempfile::tempdir().unwrap();
    let profile = directory.path().join("profile");
    let video = directory.path().join("source.mp4");
    let subtitles = directory.path().join("source.srt");
    std::fs::write(&video, b"isolated Review source").unwrap();
    std::fs::write(
        &subtitles,
        "1\n00:00:01,000 --> 00:00:04,000\nChildren walked home.\n",
    )
    .unwrap();
    let mut runtime = open(&profile, true);
    let opened = call(
        &mut runtime,
        json!({
            "type":"open_source","path":video,"packageId":"org.mlearn.english"
        }),
    );
    let source_id = opened["window"]["source"]["id"].clone();
    let associated = call(
        &mut runtime,
        json!({
            "type":"attach_subtitles","sourceId":source_id,"path":subtitles
        }),
    );
    let source = &associated["window"]["source"];
    let anchor = json!({
        "sourceId":source_id,"contentRevision":source["mediaRevision"],
        "packageId":source["packageId"],"packageVersion":source["packageVersion"],
        "text":"Children walked home.","locator":{
            "kind":"video","subtitleRevision":source["subtitleRevision"],"cueIndex":0,
            "selectionStart":0,"selectionEnd":8,"positionMs":1500,
            "subtitleOffsetMs":0,"playbackRate":1.0
        }
    });
    let material = create(&mut runtime, "authored", "Children", "young people");
    let mut content = material["content"].clone();
    content["source"] = anchor.clone();
    call(
        &mut runtime,
        json!({"type":"update_material","command":{
            "commandId":"attach-source","id":material["id"],"expectedRevision":1,
            "content":content,"excluded":false
        }}),
    );
    let started = call(
        &mut runtime,
        json!({"type":"review","command":{"kind":"start","start":{
            "commandId":"start","sessionId":"source-review","mode":{"kind":"finite","limit":1}
        }}}),
    );
    let encounter_id = started["commit"]["session"]["encounter"]["id"].clone();
    let unmarked = execute(
        &mut runtime,
        json!({
            "type":"return_review_source","sessionId":"source-review","encounterId":encounter_id
        }),
    );
    assert_eq!(unmarked["code"], "invalid_review");
    mutate(
        &mut runtime,
        &started["commit"]["session"],
        "source-assistance",
        "assistance",
        json!({"encounterId":encounter_id,"assistance":"source"}),
    );
    content["source"] = Value::Null;
    call(
        &mut runtime,
        json!({"type":"update_material","command":{
            "commandId":"remove-source","id":material["id"],"expectedRevision":2,
            "content":content,"excluded":false
        }}),
    );
    drop(runtime);
    let mut runtime = open(&profile, true);

    // When returning from the persisted encounter rather than the mutable Material.
    let returned = call(
        &mut runtime,
        json!({
            "type":"return_review_source","sessionId":"source-review","encounterId":encounter_id
        }),
    );

    // Then source identity and original location survive the authored edit/restart.
    assert_eq!(returned["anchor"], anchor);
    assert_eq!(returned["window"]["source"]["positionMs"], 1500);
    assert_eq!(returned["window"]["source"]["id"], source_id);
}
