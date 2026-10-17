use mlearn_core::{ClaimChange, Cue, KnowledgeKey, SourceRecord};
use mlearn_language_host::{AssetMap, CodePolicy, CompiledPlugin, ResourcePaths};
use mlearn_runtime::Runtime;
use mlearn_storage::ProfileStore;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

fn call(runtime: &mut Runtime, request: Value) -> Value {
    let response: Value = serde_json::from_str(&runtime.execute(&request.to_string())).unwrap();
    assert_ne!(response["type"], "error", "{request}: {response}");
    response
}
fn retain_blob(profile: &Path, source: &Path, uppercase: bool) -> Value {
    let bytes = std::fs::read(source).unwrap();
    let digest = if uppercase { format!("{:X}", Sha256::digest(&bytes)) } else { format!("{:x}", Sha256::digest(&bytes)) };
    std::fs::write(profile.join("plugin-blobs").join(&digest), &bytes).unwrap();
    json!({"path":format!("objects/{digest}.bin"),"sha256":digest,"byteLength":bytes.len()})
}
#[test]
fn retained_abi1_modules_and_saved_source_run_offline_without_reinstallation() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let module = |variable: &str, name: &str| std::env::var_os(variable).map(PathBuf::from).unwrap_or_else(|| root.join(format!("target/wasm32-unknown-unknown/release/{name}.wasm")));
    // The compatibility run supplies retained pre-integration binaries. No build,
    // package install or network request occurs in this test.
    let hello = module("MLEARN_ABI1_HELLO", "mlearn_example_hello");
    let english = module("MLEARN_ABI1_ENGLISH", "mlearn_language_english");
    let lexicon = root.join("target/wordnet/lexicon-v1.sqlite");
    let code = std::fs::read(&english).expect("Prepare the offline ABI1 English module");
    let previous = CompiledPlugin::with_resources(&code, AssetMap::new(), ResourcePaths::from([("lexicon.sqlite".into(), lexicon.clone())])).unwrap();
    let expected = previous.invoke("text.analyze.v1", json!({"texts":["Children came home."]})).unwrap();
    let target = expected[0][0]["targets"][0].as_str().unwrap().to_owned();
    drop(previous);

    let directory = tempfile::tempdir().unwrap();
    let profile = directory.path().join("profile");
    std::fs::create_dir_all(profile.join("plugin-blobs")).unwrap();
    let video = directory.path().join("existing.mp4");
    let subtitle = directory.path().join("existing.srt");
    std::fs::write(&video, b"isolated saved-source identity").unwrap();
    std::fs::write(&subtitle, "1\n00:00:00,000 --> 00:00:10,000\nChildren came home.\n").unwrap();
    let media_revision = format!("{:x}", Sha256::digest(std::fs::read(&video).unwrap()));
    let subtitle_revision = format!("{:x}", Sha256::digest(std::fs::read(&subtitle).unwrap()));
    let source = SourceRecord {
        id: format!("video-{media_revision}"), title: "existing.mp4".into(),
        media_path: video.to_string_lossy().into_owned(), media_revision,
        subtitle_path: Some(subtitle.to_string_lossy().into_owned()), subtitle_revision: Some(subtitle_revision),
        package_id: "org.mlearn.english".into(), package_version: "0.1.0-wn30-batch1".into(),
        position_ms: 1987, duration_ms: 10000,
    };
    let mut store = ProfileStore::open(&profile.join("profile.sqlite3")).unwrap();
    let manifests = [
        json!({"id":"example.hello","version":"0.1.0","abiVersion":1,"capabilities":["example::hello"],
            "code":retain_blob(&profile,&hello,true),
            "assets":{"greeting.json":retain_blob(&profile,&root.join("language-plugins/hello/assets/greeting.json"),true)}}),
        json!({"id":"org.mlearn.english","version":"0.1.0-wn30-batch1","abiVersion":1,
            "capabilities":["language.describe.v1","text.analyze.v1","target.inspect.v1"],
            "code":retain_blob(&profile,&english,false),
            "assets":{"lexicon.sqlite":retain_blob(&profile,&lexicon,true)}}),
    ];
    for manifest in &manifests {
        assert!(manifest.get("execution").is_none() && manifest.get("resources").is_none());
        store.activate_plugin(manifest["id"].as_str().unwrap(), &manifest.to_string()).unwrap();
    }
    store.save_source(&source).unwrap();
    store.attach_cues(&source, &[Cue { index: 1, start_ms: 0, end_ms: 10000, text: "Children came home.".into() }]).unwrap();
    let key = KnowledgeKey { package_id: source.package_id.clone(), target_id: target, capability: "org.mlearn.english:meaning".into() };
    store.change_claim(&ClaimChange { key: key.clone(), claim: Some(true), command_id: "existing-claim".into() }).unwrap();
    drop(store);

    let mut runtime = Runtime::open(&profile, CodePolicy::DesktopDownloaded, None, vec![]).unwrap();
    assert_eq!(call(&mut runtime, json!({"type":"snapshot"}))["snapshot"]["catalogConfigured"], false);
    assert_eq!(call(&mut runtime, json!({"type":"invoke_plugin","pluginId":"example.hello","capability":"example::hello","input":{"name":"offline"}}))["output"]["message"], "Hello, offline!");
    let resumed = call(&mut runtime, json!({"type":"resume_source","sourceId":source.id}));
    assert_eq!(resumed["window"]["source"], serde_json::to_value(&source).unwrap());
    let analyzed = call(&mut runtime, json!({"type":"analyze_source","sourceId":source.id,"positionMs":1987}));
    assert_eq!(analyzed["batch"]["cues"][0]["tokens"], expected[0]);
    assert_eq!(call(&mut runtime, json!({"type":"knowledge","keys":[key]}))["projections"][0]["claim"], true);
    assert_eq!(call(&mut runtime, json!({"type":"inspect_target","packageId":key.package_id,"targetId":key.target_id}))["entry"]["headword"], "child");
    call(&mut runtime, json!({"type":"save_position","sourceId":source.id,"positionMs":3432,"durationMs":10000}));
    drop(runtime);
    let mut runtime = Runtime::open(&profile, CodePolicy::DesktopDownloaded, None, vec![]).unwrap();
    assert_eq!(call(&mut runtime, json!({"type":"resume_source","sourceId":source.id}))["window"]["source"]["positionMs"], 3432);
    assert_eq!(call(&mut runtime, json!({"type":"knowledge","keys":[key]}))["projections"][0]["claim"], true);
    println!("ABI1_OFFLINE_PROOF retained_modules/saved_source/claim/restart PASS; no catalog or reinstall");
}
