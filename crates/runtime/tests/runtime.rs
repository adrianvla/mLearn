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
