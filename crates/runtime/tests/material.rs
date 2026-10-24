use mlearn_language_host::CodePolicy;
use mlearn_runtime::Runtime;
use serde_json::{Value, json};
use std::path::Path;

fn open(root: &Path) -> Runtime {
    Runtime::open(root, CodePolicy::MobileBundled, None, vec![]).unwrap()
}

fn execute(runtime: &mut Runtime, request: Value) -> Value {
    serde_json::from_str(&runtime.execute(&request.to_string())).unwrap()
}

fn call(runtime: &mut Runtime, request: Value) -> Value {
    let reply = execute(runtime, request);
    assert_ne!(reply["type"], "error", "{reply}");
    reply
}

fn create(id: &str) -> Value {
    json!({
        "commandId":id, "distinct":false,
        "content":{
            "packageId":"example.language", "targetId":null, "packageRevision":null,
            "sense":null, "phrase":"authored phrase", "reading":"", "meaning":"meaning",
            "context":"", "notes":"", "examples":[], "source":null, "attachments":[]
        }
    })
}

fn saved(reply: &Value) -> &Value {
    assert_eq!(reply["type"], "material_written");
    assert_eq!(reply["outcome"]["status"], "saved");
    &reply["outcome"]["material"]
}

#[test]
fn model_free_authoring_and_old_receipts_survive_restart_without_reapplying() {
    let dir = tempfile::tempdir().unwrap();
    let mut runtime = open(dir.path());
    let command = create("create");
    let first = call(
        &mut runtime,
        json!({"type":"create_material","command":command}),
    );
    let item = saved(&first);
    let mut content = item["content"].clone();
    content["notes"] = json!("a persisted edit");
    let edit = json!({
        "commandId":"edit", "id":item["id"], "expectedRevision":item["revision"],
        "content":content, "excluded":true
    });
    let edited = call(
        &mut runtime,
        json!({"type":"update_material","command":edit}),
    );
    let current = saved(&edited).clone();
    let mut stale = edit.clone();
    stale["commandId"] = json!("stale-edit");
    let conflict = execute(
        &mut runtime,
        json!({"type":"update_material","command":stale}),
    );
    assert_eq!(conflict["code"], "conflict", "{conflict}");
    drop(runtime);
    let mut runtime = open(dir.path());
    let replay = call(
        &mut runtime,
        json!({"type":"create_material","command":command}),
    );
    assert_eq!(saved(&replay), &current);
    assert_eq!(replay["outcome"]["committedRevision"], 1);
    let replay = call(
        &mut runtime,
        json!({"type":"update_material","command":edit}),
    );
    assert_eq!(saved(&replay), &current);
    assert_eq!(replay["outcome"]["committedRevision"], 2);
    let listed = call(
        &mut runtime,
        json!({"type":"materials","query":{
            "after":null,"query":"","sourceId":null,"includeExcluded":true
        }}),
    );
    assert_eq!(listed["page"]["items"], json!([current]));
}

#[test]
fn authored_bytes_and_receipts_outlive_picker_files_and_shared_attachment_replacement() {
    let dir = tempfile::tempdir().unwrap();
    let profile = dir.path().join("profile");
    let selected = dir.path().join("picked.png");
    // Container admission fixture; decoding and playback belong to native-provider tests.
    let bytes = b"\x89PNG\r\n\x1a\nbounded authored bytes";
    std::fs::write(&selected, bytes).unwrap();
    let mut runtime = open(&profile);
    let mut command = create("with-media");
    command["mediaImports"] = json!([{
        "path":selected,"kind":"image","name":"picked.png","segment":null
    }]);
    let reply = call(
        &mut runtime,
        json!({"type":"create_material","command":command}),
    );
    let first = saved(&reply).clone();
    let media = first["media"][0].clone();
    assert_eq!(first["content"]["attachments"][0]["mediaId"], media["id"]);
    let location = call(
        &mut runtime,
        json!({"type":"material_media","id":media["id"]}),
    );
    let path = location["location"]["path"].as_str().unwrap();
    assert_eq!(std::fs::read(path).unwrap(), bytes);
    std::fs::remove_file(&selected).unwrap();
    drop(runtime);
    let mut runtime = open(&profile);
    let replay = call(
        &mut runtime,
        json!({"type":"create_material","command":command}),
    );
    assert_eq!(saved(&replay), &first);
    let mut second = create("shared");
    second["distinct"] = json!(true);
    second["content"]["attachments"] = first["content"]["attachments"].clone();
    let second = call(
        &mut runtime,
        json!({"type":"create_material","command":second}),
    );
    assert_eq!(saved(&second)["media"], json!([media]));
    let mut content = first["content"].clone();
    content["attachments"] = json!([]);
    call(
        &mut runtime,
        json!({"type":"update_material","command":{
            "commandId":"remove-first-use","id":first["id"],"expectedRevision":1,
            "content":content,"excluded":false
        }}),
    );
    assert_eq!(std::fs::read(path).unwrap(), bytes);
    let reader = runtime.authored_media_reader().unwrap();
    assert_eq!(
        reader(media["id"].as_str().unwrap()).unwrap().0,
        Path::new(path)
    );
    assert!(reader("../../private").is_err());
}

#[test]
fn mixed_capture_retries_preserve_success_and_failed_media_never_publish() {
    let dir = tempfile::tempdir().unwrap();
    let mut runtime = open(dir.path());
    let good = create("good");
    let mut bad = create("bad");
    bad["mediaImports"] = json!([{
        "path":dir.path().join("missing.png"),"kind":"image","name":"missing.png","segment":null
    }]);
    let request = json!({"type":"capture_materials","batch":{
        "packageId":"example.language","commands":[good,bad]
    }});
    let first = call(&mut runtime, request.clone());
    assert_eq!(first["results"][0]["state"], "saved");
    assert_eq!(first["results"][1]["state"], "failed");
    let retry = call(&mut runtime, request);
    assert_eq!(retry["results"][0], first["results"][0]);
    assert_eq!(retry["results"][1]["state"], "failed");
    let listed = call(
        &mut runtime,
        json!({"type":"materials","query":{
            "after":null,"query":"","sourceId":null,"includeExcluded":true
        }}),
    );
    assert_eq!(listed["page"]["items"].as_array().unwrap().len(), 1);
    assert_eq!(
        std::fs::read_dir(dir.path().join("material-staging"))
            .unwrap()
            .count(),
        0
    );
}

#[test]
fn restart_discards_interrupted_publications_but_preserves_catalogued_authored_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let profile = dir.path().join("profile");
    let input = dir.path().join("picked.png");
    std::fs::write(&input, b"\x89PNG\r\n\x1a\nsaved bytes").unwrap();
    let mut runtime = open(&profile);
    let mut command = create("saved-media");
    command["mediaImports"] = json!([{
        "path":input,"kind":"image","name":"picked.png","segment":null
    }]);
    let saved = call(
        &mut runtime,
        json!({"type":"create_material","command":command}),
    );
    let media = saved["outcome"]["material"]["media"][0].clone();
    drop(runtime);
    let staging = profile.join("material-staging");
    let interrupted = staging.join("capture-interrupted");
    std::fs::create_dir(&interrupted).unwrap();
    // A crash while writing the unpublished journal must not prevent restart.
    std::fs::write(interrupted.join("journal.part"), b"{").unwrap();
    let published = staging.join("capture-published");
    std::fs::create_dir(&published).unwrap();
    let mut orphan = media.clone();
    orphan["id"] = json!(format!("media-{}", "a".repeat(64)));
    let orphan_path = profile
        .join("authored")
        .join(format!("{}.png", orphan["id"].as_str().unwrap()));
    std::fs::write(&orphan_path, b"\x89PNG\r\n\x1a\nuncommitted bytes").unwrap();
    std::fs::write(
        published.join("journal.json"),
        serde_json::to_vec(&json!({
            "version":1,"media":[media,orphan]
        }))
        .unwrap(),
    )
    .unwrap();
    let mut runtime = open(&profile);
    assert!(!orphan_path.exists());
    assert_eq!(std::fs::read_dir(&staging).unwrap().count(), 0);
    let retained = call(
        &mut runtime,
        json!({"type":"material_media","id":media["id"]}),
    );
    assert_eq!(
        std::fs::read(retained["location"]["path"].as_str().unwrap()).unwrap(),
        b"\x89PNG\r\n\x1a\nsaved bytes"
    );
}
