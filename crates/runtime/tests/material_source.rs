use mlearn_language_host::CodePolicy;
use mlearn_runtime::{BundledPlugin, Runtime, catalog::Manifest};
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::Path};

fn open(root: &Path) -> Runtime {
    let artifacts = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/plugin-cdn");
    let manifests: Vec<Manifest> =
        serde_json::from_slice(&std::fs::read(artifacts.join("bundle.json")).unwrap()).unwrap();
    let bundled = manifests
        .into_iter()
        .filter(|manifest| manifest.id == "org.mlearn.english")
        .map(|manifest| BundledPlugin {
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
        })
        .collect();
    Runtime::open(root, CodePolicy::MobileBundled, None, bundled).unwrap()
}

fn execute(runtime: &mut Runtime, request: Value) -> Value {
    serde_json::from_str(&runtime.execute(&request.to_string())).unwrap()
}

fn call(runtime: &mut Runtime, request: Value) -> Value {
    let result = execute(runtime, request);
    assert_ne!(result["type"], "error", "{result}");
    result
}

#[test]
fn capture_return_restores_exact_context_and_rejects_changed_or_missing_source() {
    let dir = tempfile::tempdir().unwrap();
    let profile = dir.path().join("profile");
    let video = dir.path().join("source.mp4");
    let subtitles = dir.path().join("source.srt");
    std::fs::write(&video, b"canonical source fixture").unwrap();
    std::fs::write(
        &subtitles,
        "1\n00:00:05,000 --> 00:00:08,000\nChildren walked home.\n",
    )
    .unwrap();
    let mut runtime = open(&profile);
    let opened = call(
        &mut runtime,
        json!({
            "type":"open_source","path":video,"packageId":"org.mlearn.english"
        }),
    );
    let id = opened["window"]["source"]["id"].clone();
    call(
        &mut runtime,
        json!({"type":"attach_subtitles","sourceId":id,"path":subtitles}),
    );
    call(
        &mut runtime,
        json!({"type":"save_position","sourceId":id,"positionMs":4500,"durationMs":10000}),
    );
    call(
        &mut runtime,
        json!({"type":"set_subtitle_offset","sourceId":id,"offsetMs":1000}),
    );
    let window = call(
        &mut runtime,
        json!({"type":"set_playback_rate","sourceId":id,"rate":1.25}),
    );
    let source = &window["window"]["source"];
    let anchor = json!({
        "sourceId":id,"contentRevision":source["mediaRevision"],
        "packageId":source["packageId"],"packageVersion":source["packageVersion"],
        "text":"Children walked home.",
        "locator":{"kind":"video","subtitleRevision":source["subtitleRevision"],"cueIndex":0,
            "selectionStart":0,"selectionEnd":8,"positionMs":4500,
            "subtitleOffsetMs":1000,"playbackRate":1.25}
    });
    // Authored language is independent of the original source language.
    let command = json!({"commandId":"capture","distinct":false,"content":{
        "packageId":"example.authored","targetId":null,"packageRevision":null,"sense":null,
        "phrase":"Children","reading":"","meaning":"children","context":"edited context",
        "notes":"","examples":[],"attachments":[],"source":anchor
    }});
    let captured = call(
        &mut runtime,
        json!({"type":"create_material","command":command}),
    );
    let material = captured["outcome"]["material"].clone();
    assert_eq!(material["content"]["source"], anchor);
    call(
        &mut runtime,
        json!({"type":"set_subtitle_offset","sourceId":id,"offsetMs":0}),
    );
    call(
        &mut runtime,
        json!({"type":"set_playback_rate","sourceId":id,"rate":2.0}),
    );
    call(
        &mut runtime,
        json!({"type":"save_position","sourceId":id,"positionMs":9000,"durationMs":10000}),
    );
    drop(runtime);
    let mut runtime = open(&profile);
    let returned = call(
        &mut runtime,
        json!({"type":"return_material_source","id":material["id"]}),
    );
    assert_eq!(returned["anchor"], anchor);
    for field in [
        "packageId",
        "packageVersion",
        "positionMs",
        "subtitleOffsetMs",
        "playbackRate",
    ] {
        assert_eq!(
            returned["window"]["source"][field], source[field],
            "{field}"
        );
    }
    let owned = returned["window"]["source"]["mediaPath"].as_str().unwrap();
    std::fs::write(owned, b"changed bytes").unwrap();
    let failed = execute(
        &mut runtime,
        json!({"type":"return_material_source","id":material["id"]}),
    );
    assert_eq!(failed["type"], "error");
    std::fs::remove_file(owned).unwrap();
    assert_eq!(
        execute(
            &mut runtime,
            json!({"type":"return_material_source","id":material["id"]})
        )["type"],
        "error"
    );
    // Durable capture receipts and unrelated edits remain usable without the source.
    let replay = call(
        &mut runtime,
        json!({"type":"create_material","command":command}),
    );
    assert_eq!(replay["outcome"]["material"], material);
    let mut content = material["content"].clone();
    content["notes"] = json!("edited after source removal");
    let edited = call(
        &mut runtime,
        json!({"type":"update_material","command":{
            "commandId":"edit-missing","id":material["id"],"expectedRevision":1,
            "content":content,"excluded":false
        }}),
    );
    assert_eq!(edited["outcome"]["material"]["content"], content);
}

#[test]
fn target_capture_rejects_fabricated_senses_and_replays_without_its_language_package() {
    let dir = tempfile::tempdir().unwrap();
    let mut runtime = open(dir.path());
    let analyzed = call(
        &mut runtime,
        json!({
            "type":"invoke_plugin","pluginId":"org.mlearn.english",
            "capability":"text.analyze.v1","input":{"texts":["child"]}
        }),
    );
    let target = &analyzed["output"][0][0]["targets"][0];
    let inspected = call(
        &mut runtime,
        json!({
            "type":"inspect_target","packageId":"org.mlearn.english","targetId":target,"expectedRevision":null
        }),
    );
    let command = json!({"commandId":"actual-target","distinct":false,"content":{
        "packageId":"org.mlearn.english","targetId":inspected["entry"]["targetId"],
        "packageRevision":inspected["packageRevision"],"sense":null,
        "phrase":inspected["entry"]["headword"],"reading":"","meaning":inspected["entry"]["definition"],
        "context":"","notes":"","examples":[],"source":null,"attachments":[]
    }});
    let mut forged = command.clone();
    forged["commandId"] = json!("forged");
    forged["content"]["sense"] = json!({
        "heading":"fabricated","labels":[],"definitions":["not a package-produced sense"],"notes":[]
    });
    assert_eq!(
        execute(
            &mut runtime,
            json!({"type":"create_material","command":forged})
        )["type"],
        "error"
    );
    let mut stale = command.clone();
    stale["commandId"] = json!("stale");
    stale["content"]["packageRevision"] = json!("stale-revision");
    let batch = call(
        &mut runtime,
        json!({"type":"capture_materials","batch":{
            "packageId":"org.mlearn.english","commands":[command,stale]
        }}),
    );
    assert_eq!(batch["results"][0]["state"], "saved");
    assert_eq!(batch["results"][1]["state"], "failed");
    let rejected_edit = execute(
        &mut runtime,
        json!({"type":"update_material","command":{
            "commandId":"forged-edit","id":batch["results"][0]["materialId"],
            "expectedRevision":1,"content":forged["content"],"excluded":false
        }}),
    );
    assert_eq!(rejected_edit["type"], "error", "{rejected_edit}");
    drop(runtime);
    let mut runtime = Runtime::open(dir.path(), CodePolicy::MobileBundled, None, vec![]).unwrap();
    let replay = call(
        &mut runtime,
        json!({"type":"create_material","command":command}),
    );
    assert_eq!(
        replay["outcome"]["material"]["id"],
        batch["results"][0]["materialId"]
    );
    assert_eq!(replay["outcome"]["committedRevision"], 1);
}

#[test]
fn reused_attachment_origins_reject_forgery_without_committing_and_preserve_history() {
    let dir = tempfile::tempdir().unwrap();
    let video = dir.path().join("source.mp4");
    let image = dir.path().join("frame.png");
    let bytes = b"\x89PNG\r\n\x1a\ncatalogued image fixture";
    std::fs::write(&video, b"canonical source fixture").unwrap();
    std::fs::write(&image, bytes).unwrap();
    let mut runtime = open(dir.path());
    let opened = call(
        &mut runtime,
        json!({"type":"open_source","path":video,"packageId":"org.mlearn.english"}),
    );
    let source = &opened["window"]["source"];
    call(
        &mut runtime,
        json!({"type":"save_position","sourceId":source["id"],"positionMs":0,"durationMs":10000}),
    );
    let seed = json!({"commandId":"asset","distinct":true,"content":{
        "packageId":"example.manual","targetId":null,"packageRevision":null,"sense":null,
        "phrase":"frame","reading":"","meaning":"","context":"","notes":"","examples":[],
        "source":null,"attachments":[]
    },"mediaImports":[{"path":image,"kind":"image","name":"frame.png","segment":null}]});
    let created = call(
        &mut runtime,
        json!({"type":"create_material","command":seed}),
    );
    let mut current = created["outcome"]["material"].clone();
    let valid = json!({
        "sourceId":source["id"],"contentRevision":source["mediaRevision"],
        "startMs":5000,"endMs":5000
    });
    let mut missing = valid.clone();
    missing["sourceId"] = json!("missing-source");
    let mut stale = valid.clone();
    stale["contentRevision"] = json!("stale-revision");
    let mut overrun = valid.clone();
    overrun["endMs"] = json!(10001);
    for (name, forged) in [
        ("missing", missing),
        ("revision", stale),
        ("endpoint", overrun),
    ] {
        let query = json!({"type":"materials","query":{
            "after":null,"query":"","sourceId":null,"includeExcluded":true
        }});
        let before = call(&mut runtime, query.clone());
        let mut content = current["content"].clone();
        content["attachments"][0]["segment"] = forged;
        let create = json!({
            "commandId":format!("reuse-{name}"),"distinct":true,"content":content
        });
        let edit = json!({
            "commandId":format!("edit-{name}"),"id":current["id"],
            "expectedRevision":current["revision"],"content":content,"excluded":false
        });
        for (action, command) in [
            ("create_material", create.clone()),
            ("update_material", edit.clone()),
        ] {
            let rejected = execute(&mut runtime, json!({"type":action,"command":command}));
            assert_eq!(rejected["type"], "error", "{name}: {rejected}");
            assert_eq!(call(&mut runtime, query.clone()), before);
            let location = call(
                &mut runtime,
                json!({"type":"material_media","id":current["media"][0]["id"]}),
            );
            assert_eq!(
                std::fs::read(location["location"]["path"].as_str().unwrap()).unwrap(),
                bytes
            );
        }
        // Corrected retries retain the rejected IDs: no failed receipt was committed.
        let mut corrected = create;
        corrected["content"]["attachments"][0]["segment"] = valid.clone();
        let saved = call(
            &mut runtime,
            json!({"type":"create_material","command":corrected}),
        );
        assert_eq!(saved["outcome"]["status"], "saved");
        let mut corrected = edit;
        corrected["content"]["attachments"][0]["segment"] = valid.clone();
        let saved = call(
            &mut runtime,
            json!({"type":"update_material","command":corrected}),
        );
        current = saved["outcome"]["material"].clone();
        assert_eq!(current["content"]["attachments"][0]["segment"], valid);
    }
    std::fs::remove_file(source["mediaPath"].as_str().unwrap()).unwrap();
    let mut content = current["content"].clone();
    content["notes"] = json!("historical media remains editable");
    let edited = call(
        &mut runtime,
        json!({"type":"update_material","command":{
            "commandId":"historical","id":current["id"],"expectedRevision":current["revision"],
            "content":content,"excluded":false
        }}),
    );
    assert_eq!(edited["outcome"]["material"]["content"], content);
}
