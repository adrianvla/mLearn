use super::*;
use mlearn_core::{ClaimChange, KnowledgeKey};

fn claim_for_first_token(executor: &RuntimeExecutor, source: &SourceRecord) -> (Value, ClaimChange) {
    let analysis: Value = serde_json::from_str(&executor.execute(&json!({
        "type":"analyze_source","sourceId":source.id,"positionMs":0,
    }).to_string())).unwrap();
    assert_eq!(analysis["type"], "analysis");
    let description: Value = serde_json::from_str(&executor.execute(&json!({
        "type":"describe_language","packageId":source.package_id,
    }).to_string())).unwrap();
    assert_eq!(description["type"], "language");
    let annotation = &description["description"]["annotationCapability"];
    let target = &analysis["batch"]["cues"][0]["tokens"][0]["targets"][0];
    let projection = analysis["batch"]["knowledge"].as_array().unwrap().iter()
        .find(|projection| &projection["key"]["targetId"] == target && &projection["key"]["capability"] == annotation).unwrap();
    let key: KnowledgeKey = serde_json::from_value(projection["key"].clone()).unwrap();
    (analysis, ClaimChange { key, claim: Some(true), command_id: "held-claim-receipt".into() })
}

#[test]
fn analysis_projects_current_knowledge_when_claim_commits_before_completion() {
    // Given cached real analysis with untracked, ambiguous lexical alternatives.
    let (_directory, executor, source) = fixture();
    let (before, change) = claim_for_first_token(&executor, &source);
    assert_eq!(before["batch"]["annotations"][0]["status"], "untracked");
    assert!(before["batch"]["cues"][0]["tokens"][0]["targets"].as_array().unwrap().len() > 1);
    // When a normal claim commits between guest return and analysis completion.
    let (claimed, completed) = with_held_guest(&executor,
        Request::AnalyzeSource { source_id: source.id.clone(), position_ms: 0 }, || {
            serde_json::from_str::<Value>(&executor.execute(&serde_json::to_string(
                &Request::ChangeClaim { change: change.clone() },
            ).unwrap())).unwrap()
        });
    // Then unchanged tokens reflect one claimed alternative, not a fabricated disambiguation.
    assert_eq!(claimed["type"], "claim_changed");
    assert_eq!(claimed["projection"]["claim"], true);
    assert_eq!(completed["type"], "analysis");
    assert_eq!(completed["batch"]["cues"], before["batch"]["cues"]);
    let key = serde_json::to_value(&change.key).unwrap();
    let projection = completed["batch"]["knowledge"].as_array().unwrap().iter()
        .find(|projection| projection["key"] == key).unwrap();
    assert_eq!(projection, &claimed["projection"]);
    assert_eq!(completed["batch"]["annotations"][0]["status"], "mixed");
}

#[test]
fn admitted_claim_preserves_receipt_when_source_cancellation_advances() {
    // Given a real target and claim whose guest validation has completed.
    let (directory, executor, source) = fixture();
    let (_analysis, change) = claim_for_first_token(&executor, &source);
    let cancellation = executor.cancellation_handle();
    // When source cancellation occurs before the admitted durable claim commits.
    let ((), completed) = with_held_guest(&executor,
        Request::ChangeClaim { change: change.clone() }, || {
            cancellation.fetch_add(1, Ordering::Relaxed);
        });
    // Then the exact command commits once and its retry retains the receipt.
    assert_eq!(completed["type"], "claim_changed");
    assert_eq!(completed["projection"]["claim"], true);
    let replay: Value = serde_json::from_str(&executor.execute(&serde_json::to_string(
        &Request::ChangeClaim { change: change.clone() },
    ).unwrap())).unwrap();
    assert_eq!(replay, completed);
    let store = ProfileStore::open(&directory.path().join("profile/profile.sqlite3")).unwrap();
    assert_eq!(serde_json::to_value(store.knowledge(&[change.key]).unwrap()[0].clone()).unwrap(), completed["projection"]);
}

#[test]
fn guest_admission_is_nonwaiting_before_runtime_lock_and_metadata_bypasses_it() {
    // Given occupied guest admission, independent foreground work still succeeds.
    let (_directory, executor, source) = fixture();
    let admission = executor.guest.lock().unwrap();
    for (request, expected) in [
        (json!({"type":"source_window","sourceId":source.id,"positionMs":26_500}), "source"),
        (json!({"type":"save_position","sourceId":source.id,"positionMs":1234,"durationMs":40_000}), "position_saved"),
        (json!({"type":"knowledge","keys":[]}), "knowledge"),
        (json!({"type":"recent_sources"}), "sources"),
        (json!({"type":"snapshot"}), "snapshot"),
    ] {
        let response: Value = serde_json::from_str(&executor.execute(&request.to_string())).unwrap();
        assert_eq!(response["type"], expected);
    }
    let runtime = executor.runtime.lock().unwrap();
    // When another guest request arrives while even Runtime is unavailable.
    let (before_release, worker, response) = foreground_attempt(&executor,
        json!({"type":"analyze_source","sourceId":source.id,"positionMs":0}));
    drop(runtime);
    drop(admission);
    let eventual = worker.join().unwrap();
    drop(response);
    // Then busy is returned without waiting for either occupied owner.
    assert_eq!(eventual["code"], "busy");
    assert_eq!(before_release.unwrap()["code"], "busy");
}

#[test]
fn foreground_lookup_waits_for_guest_capacity_without_holding_runtime() {
    // Given occupied guest capacity, a user lookup must not fail as busy merely
    // because background subtitle analysis is still running.
    let (_directory, executor, source) = fixture();
    let admission = executor.guest.lock().unwrap();
    let (before_release, worker, response) = foreground_attempt(&executor,
        json!({"type":"describe_language","packageId":source.package_id}));
    // When bounded source reads complete before guest capacity is released.
    let raw: Value = serde_json::from_str(&executor.execute(&json!({
        "type":"source_window","sourceId":source.id,"positionMs":0,
    }).to_string())).unwrap();
    drop(admission);
    let eventual = worker.join().unwrap();
    drop(response);
    // Then lookup succeeds after capacity returns; raw reads did not wait on it.
    assert_eq!(raw["type"], "source");
    assert!(before_release.is_err(), "Foreground lookup rejected occupied capacity: {before_release:?}");
    assert_eq!(eventual["type"], "language");
}

#[test]
fn total_admission_rejects_a_fourth_call_and_recovers_after_release_and_errors() {
    // Given all three call permits occupied and Runtime unavailable.
    let (_directory, executor, source) = fixture();
    let mut permits = (0..3).map(|_| executor.admit().unwrap()).collect::<Vec<_>>();
    let runtime = executor.runtime.lock().unwrap();
    // When a fourth foreground request arrives.
    let (before_release, worker, response) = foreground_attempt(&executor, json!({"type":"snapshot"}));
    drop(runtime);
    let eventual = worker.join().unwrap();
    drop(response);
    // Then it is rejected before Runtime, and releasing capacity works on every exit path.
    assert_eq!(eventual["code"], "busy");
    assert_eq!(before_release.unwrap()["code"], "busy");
    drop(permits.pop());
    for (request, expected) in [
        ("not-json".to_owned(), "invalid_request"),
        (json!({"type":"analyze_source","sourceId":"missing","positionMs":0}).to_string(), "operation_failed"),
    ] {
        let failed: Value = serde_json::from_str(&executor.execute(&request)).unwrap();
        assert_eq!(failed["code"], expected);
    }
    let available: Value = serde_json::from_str(&executor.execute(&json!({
        "type":"source_window","sourceId":source.id,"positionMs":26_500,
    }).to_string())).unwrap();
    assert_eq!(available["type"], "source");
    assert_eq!(available["window"]["totalCues"], 40);
}
