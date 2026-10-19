use mlearn_language_host::CodePolicy;
use mlearn_runtime::Runtime;

#[test]
fn runtime_round_trip_is_rust_owned_and_survives_restart() {
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = Runtime::open(directory.path(), CodePolicy::DesktopDownloaded, None, vec![]).unwrap();
    let response: serde_json::Value = serde_json::from_str(&runtime.execute(r#"{"type":"snapshot"}"#)).unwrap();
    assert_eq!(response["snapshot"]["codePolicy"], "desktop-downloaded");
    let mut document = response["snapshot"]["theme"].clone();
    document["name"] = "Persisted custom theme".into();
    let command = serde_json::json!({"type":"save_theme","document":document,"expectedRevision":0,"commandId":"once"}).to_string();
    assert_eq!(serde_json::from_str::<serde_json::Value>(&runtime.execute(&command)).unwrap()["revision"], 1);
    drop(runtime);
    let mut runtime = Runtime::open(directory.path(), CodePolicy::DesktopDownloaded, None, vec![]).unwrap();
    let response: serde_json::Value = serde_json::from_str(&runtime.execute(r#"{"type":"snapshot"}"#)).unwrap();
    assert_eq!(response["snapshot"]["theme"]["name"], "Persisted custom theme");
    assert_eq!(response["snapshot"]["installedPlugins"].as_array().unwrap().len(), 0);
}

#[test]
fn mobile_does_not_attempt_executable_downloads() {
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = Runtime::open(directory.path(), CodePolicy::MobileBundled, None, vec![]).unwrap();
    let reply: serde_json::Value = serde_json::from_str(&runtime.execute(r#"{"type":"install_plugin","pluginId":"anything"}"#)).unwrap();
    assert_eq!(reply["type"], "error");
    assert!(reply["message"].as_str().unwrap().contains("prohibited"));
}

#[test]
fn malformed_requests_have_explicit_errors() {
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = Runtime::open(directory.path(), CodePolicy::MobileBundled, None, vec![]).unwrap();
    let reply: serde_json::Value = serde_json::from_str(&runtime.execute("not-json")).unwrap();
    assert_eq!(reply["code"], "invalid_request");
}

#[test]
fn damaged_package_does_not_block_settings_recents_or_other_installed_code() {
    // Given two real packages and durable preferences/source state.
    let directory = tempfile::tempdir().unwrap();
    let fixture = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/plugin-cdn");
    let manifests: Vec<mlearn_runtime::catalog::Manifest> =
        serde_json::from_slice(&std::fs::read(fixture.join("bundle.json")).unwrap()).unwrap();
    let blobs = directory.path().join("plugin-blobs");
    std::fs::create_dir_all(&blobs).unwrap();
    let mut store = mlearn_storage::ProfileStore::open(&directory.path().join("profile.sqlite3")).unwrap();
    for manifest in manifests.iter().filter(|m| m.id == "example.hello" || m.id == "org.mlearn.english") {
        for artifact in std::iter::once(&manifest.code).chain(manifest.assets.values()) {
            std::fs::copy(fixture.join(&artifact.path), blobs.join(&artifact.sha256)).unwrap();
        }
        store.activate_plugin(&manifest.id, &serde_json::to_string(manifest).unwrap()).unwrap();
    }
    let theme = mlearn_core::ThemeDocument { name: "Retained appearance".into(), ..Default::default() };
    store.save_theme(&theme, 0, "appearance-before-damage").unwrap();
    let source = mlearn_core::SourceRecord {
        id: "retained-source".into(), title: "Retained source".into(),
        media_path: directory.path().join("source.mp4").to_string_lossy().into_owned(),
        media_revision: "retained-media".into(), subtitle_path: None, subtitle_revision: None,
        package_id: "org.mlearn.english".into(), package_version: "0.1.0-wn30-batch1".into(),
        position_ms: 12_345, duration_ms: 30_000, subtitle_offset_ms: 0, playback_rate: 1.0, inspection_trigger: Default::default(),
    };
    store.save_source(&source).unwrap();
    let stored_before = store.plugin_manifests().unwrap();
    drop(store);
    let damaged = manifests.iter().find(|m| m.id == "org.mlearn.english").unwrap();
    std::fs::remove_file(blobs.join(&damaged.code.sha256)).unwrap();

    // When the application restores a profile with one missing package artifact.
    let mut runtime = Runtime::open(directory.path(), CodePolicy::DesktopDownloaded, None, vec![]).unwrap();

    // Then unrelated features work and the unavailable package remains recoverable.
    let snapshot: serde_json::Value = serde_json::from_str(&runtime.execute(r#"{"type":"snapshot"}"#)).unwrap();
    assert_eq!(snapshot["snapshot"]["theme"]["name"], "Retained appearance");
    assert_eq!(snapshot["snapshot"]["installedPlugins"][0]["id"], "example.hello");
    assert_eq!(snapshot["snapshot"]["packageIssues"][0]["packageId"], damaged.id);
    assert!(!snapshot["snapshot"]["packageIssues"][0]["message"].as_str().unwrap().is_empty());
    let recents: serde_json::Value = serde_json::from_str(&runtime.execute(r#"{"type":"recent_sources"}"#)).unwrap();
    assert_eq!(recents["sources"][0]["positionMs"], 12_345);
    let hello: serde_json::Value = serde_json::from_str(&runtime.execute(
        r#"{"type":"invoke_plugin","pluginId":"example.hello","capability":"example::hello","input":{"name":"kept"}}"#,
    )).unwrap();
    assert_eq!(hello["output"]["message"], "Hello, kept!");
    let store = mlearn_storage::ProfileStore::open(&directory.path().join("profile.sqlite3")).unwrap();
    assert_eq!(store.plugin_manifests().unwrap(), stored_before);
}
