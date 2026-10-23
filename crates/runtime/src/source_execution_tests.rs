use crate::{BundledPlugin, Runtime, RuntimeExecutor, catalog::Manifest};
use mlearn_core::{Cue, Request, SourceRecord};
use mlearn_language_host::CodePolicy;
use mlearn_storage::ProfileStore;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    cell::RefCell,
    collections::BTreeMap,
    path::PathBuf,
    sync::{Arc, atomic::Ordering, mpsc},
    thread,
    time::Duration,
};

struct GuestReturnBarrier {
    capability: &'static str,
    returned: mpsc::SyncSender<()>,
    release: mpsc::Receiver<()>,
}
thread_local! {
    static GUEST_RETURN: RefCell<Option<GuestReturnBarrier>> = const { RefCell::new(None) };
}
// Holds an actual successful guest result after admission/global guest locks
// are released, before Runtime validates spans, caches or publishes it.
pub(crate) fn hold_guest_result(capability: &str) {
    GUEST_RETURN.with(|slot| {
        let matches = slot
            .borrow()
            .as_ref()
            .is_some_and(|barrier| barrier.capability == capability);
        if matches && let Some(barrier) = slot.take() {
            barrier.returned.send(()).unwrap();
            barrier
                .release
                .recv_timeout(Duration::from_secs(10))
                .unwrap();
        }
    });
}
fn fixture() -> (tempfile::TempDir, Arc<RuntimeExecutor>, SourceRecord) {
    let directory = tempfile::tempdir().unwrap();
    let profile = directory.path().join("profile");
    let cdn = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/plugin-cdn");
    let manifests: Vec<Manifest> = serde_json::from_slice(
        &std::fs::read(cdn.join("bundle.json")).expect("Prepare the existing plugin-cdn fixtures"),
    )
    .unwrap();
    let manifest = manifests
        .into_iter()
        .find(|m| m.id == "org.mlearn.english")
        .unwrap();
    let code = std::fs::read(cdn.join(&manifest.code.path)).unwrap();
    let assets = manifest
        .assets
        .iter()
        .map(|(key, artifact)| {
            (
                key.clone(),
                std::fs::read(cdn.join(&artifact.path)).unwrap().into(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let version = manifest.version.clone();
    let runtime = Runtime::open(
        &profile,
        CodePolicy::MobileBundled,
        None,
        vec![BundledPlugin {
            manifest,
            code,
            assets,
        }],
    )
    .unwrap();
    let source = SourceRecord {
        id: "held-guest-source".into(),
        title: "Fixture".into(),
        media_path: directory
            .path()
            .join("fixture.mp4")
            .to_string_lossy()
            .into_owned(),
        media_revision: format!("{:x}", Sha256::digest(b"isolated media identity")),
        subtitle_path: Some(
            directory
                .path()
                .join("original.srt")
                .to_string_lossy()
                .into_owned(),
        ),
        subtitle_revision: Some(format!(
            "{:x}",
            Sha256::digest(b"original subtitle revision")
        )),
        package_id: "org.mlearn.english".into(),
        package_version: version,
        position_ms: 0,
        duration_ms: 40_000,
        subtitle_offset_ms: 0,
        subtitle_offset_revision: 0,
        playback_rate: 1.0,
        inspection_trigger: Default::default(),
    };
    let mut store = ProfileStore::open(&profile.join("profile.sqlite3")).unwrap();
    store.save_source(&source).unwrap();
    let cues = (0_u32..40)
        .map(|index| Cue {
            index,
            start_ms: index * 1000,
            end_ms: (index + 1) * 1000,
            text: "Children walked home.".into(),
        })
        .collect::<Vec<_>>();
    store.attach_cues(&source, &cues).unwrap();
    (directory, Arc::new(RuntimeExecutor::new(runtime)), source)
}
fn with_held_guest<T>(
    executor: &Arc<RuntimeExecutor>,
    request: Request,
    action: impl FnOnce() -> T,
) -> (T, Value) {
    let capability = match &request {
        Request::AnalyzeSource { .. }
        | Request::AnalyzeDocument { .. }
        | Request::AnalyzeOcr { .. } => "text.analyze.v1",
        Request::OpenDocument { .. } | Request::ImportImageCollection { .. } => "document.parse",
        Request::ChangeClaim { .. } | Request::InspectTarget { .. } => "target.inspect.v1",
        _ => panic!("This fixture holds analysis, inspection or claim completion"),
    };
    let (returned, ready) = mpsc::sync_channel(1);
    let (release, resume) = mpsc::sync_channel(1);
    thread::scope(|scope| {
        let operation = scope.spawn(|| {
            GUEST_RETURN.with(|slot| {
                slot.replace(Some(GuestReturnBarrier {
                    capability,
                    returned,
                    release: resume,
                }))
            });
            serde_json::from_str::<Value>(
                &executor.execute(&serde_json::to_string(&request).unwrap()),
            )
            .unwrap()
        });
        ready
            .recv_timeout(Duration::from_secs(10))
            .expect("Real Wasm work did not return");
        let observed = action();
        release.send(()).unwrap();
        (observed, operation.join().unwrap())
    })
}
fn foreground_attempt(
    executor: &Arc<RuntimeExecutor>,
    request: Value,
) -> (
    Result<Value, mpsc::RecvTimeoutError>,
    thread::JoinHandle<Value>,
    mpsc::Receiver<Value>,
) {
    let executor = executor.clone();
    let (started, entered) = mpsc::sync_channel(1);
    let (finished, response) = mpsc::sync_channel(1);
    let worker = thread::spawn(move || {
        started.send(()).unwrap();
        let value: Value = serde_json::from_str(&executor.execute(&request.to_string())).unwrap();
        finished.send(value.clone()).unwrap();
        value
    });
    entered.recv_timeout(Duration::from_secs(10)).unwrap();
    let before_release = response.recv_timeout(Duration::from_secs(2));
    (before_release, worker, response)
}

#[test]
fn cancelled_document_import_discards_real_parsed_bytes_before_publication_and_recovers() {
    let (directory, executor, _) = fixture();
    let selected = directory.path().join("reader.txt");
    std::fs::write(&selected, "Children walked home.\n\nA bridge.").unwrap();
    let request = Request::OpenDocument {
        path: selected.to_string_lossy().into_owned(),
        package_id: "org.mlearn.english".into(),
    };
    let (_, result) = with_held_guest(&executor, request.clone(), || {
        executor
            .cancellation_handle()
            .fetch_add(1, Ordering::Relaxed);
    });
    assert_eq!(result["code"], "cancelled");
    let runtime = executor.runtime.lock().unwrap();
    assert!(runtime.store.recent_documents().unwrap().is_empty());
    assert_eq!(
        std::fs::read_dir(runtime.root.join("document-staging"))
            .unwrap()
            .count(),
        0
    );
    assert!(!runtime.root.join("documents").exists());
    drop(runtime);

    let recovered: Value =
        serde_json::from_str(&executor.execute(&serde_json::to_string(&request).unwrap())).unwrap();
    assert_eq!(recovered["type"], "document", "{recovered}");
    assert_eq!(
        recovered["window"]["blocks"][0]["text"],
        "Children walked home."
    );
}

#[test]
fn cancelled_image_import_releases_staged_originals_without_replacing_the_library() {
    // Given actual image bytes and a real parsed collection held before publication.
    let (directory, executor, _) = fixture();
    let image = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/ocr/vision/horizontal-mixed.png");
    let request = Request::ImportImageCollection {
        paths: vec![image.to_string_lossy().into_owned()],
        title: "Cancelled collection".into(),
        package_id: "org.mlearn.english".into(),
    };
    // When source navigation invalidates completion through the existing barrier.
    let (_, result) = with_held_guest(&executor, request.clone(), || {
        executor
            .cancellation_handle()
            .fetch_add(1, Ordering::Relaxed);
    });
    // Then no original/assets were published, and a fresh action can recover.
    assert_eq!(result["code"], "cancelled");
    let runtime = executor.runtime.lock().unwrap();
    assert!(runtime.store.recent_documents().unwrap().is_empty());
    assert_eq!(
        std::fs::read_dir(directory.path().join("profile/document-staging"))
            .unwrap()
            .count(),
        0
    );
    assert!(!directory.path().join("profile/document-assets").exists());
    drop(runtime);
    let recovered: Value =
        serde_json::from_str(&executor.execute(&serde_json::to_string(&request).unwrap())).unwrap();
    assert_eq!(recovered["type"], "document");
}

#[test]
fn correction_while_real_ocr_analysis_returns_rejects_stale_publication_and_keeps_current_knowledge()
 {
    // Given a real imported source, deterministic native boundary evidence, and actual package analysis.
    let (_directory, executor, _) = fixture();
    let image = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/ocr/vision/horizontal-mixed.png");
    let opened:Value = serde_json::from_str(&executor.execute(&json!({
        "type":"import_image_collection","paths":[image],"title":"Held analysis","packageId":"org.mlearn.english",
    }).to_string())).unwrap();
    assert_eq!(opened["type"], "document", "{opened}");
    let source = &opened["window"]["source"];
    let planned:Value = serde_json::from_str(&executor.execute(&json!({
        "type":"plan_ocr","request":{"requestId":"held-ocr","sourceId":source["id"],"contentRevision":source["contentRevision"],
            "resourceId":"image-0","providerId":"fixture","recognitionLanguages":["en"],"crop":null},
    }).to_string())).unwrap();
    assert_eq!(planned["type"], "ocr_plan", "{planned}");
    let recognized:Value = serde_json::from_str(&executor.execute(&json!({
        "type":"complete_ocr","result":{"requestId":"held-ocr",
            "provider":{"id":"fixture","label":"Test boundary","revision":"1","availability":"ready",
                "languages":["en"],"scripts":["Latn"],"languageProvenance":"deterministic fixture, not recognition","reason":null},
            "width":720,"height":300,"crop":null,"regions":[{"id":"0","text":"Children walked home.",
                "quad":{"topLeft":{"x":0.1,"y":0.1},"topRight":{"x":0.6,"y":0.1},
                    "bottomRight":{"x":0.6,"y":0.3},"bottomLeft":{"x":0.1,"y":0.3}},
                "candidates":[],"language":null,"orientation":null,"readingOf":null}]},
    }).to_string())).unwrap();
    assert_eq!(recognized["type"], "ocr_page", "{recognized}");
    let mut correction = recognized["page"]["regions"][0].clone();
    correction["text"] = json!("A bridge.");
    // When correction commits after genuine morphology returns but before it publishes.
    let (_, analyzed) = with_held_guest(
        &executor,
        Request::AnalyzeOcr {
            source_id: source["id"].as_str().unwrap().into(),
            resource_id: "image-0".into(),
            ocr_revision: 1,
            region_ids: vec!["0".into()],
        },
        || {
            let corrected:Value = serde_json::from_str(&executor.execute(&json!({
            "type":"correct_ocr","correction":{"commandId":"while-analyzing","sourceId":source["id"],
                "contentRevision":source["contentRevision"],"resourceId":"image-0","expectedRevision":1,"region":correction},
        }).to_string())).unwrap();
            assert_eq!(corrected["type"], "ocr_page", "{corrected}");
        },
    );
    // Then stale analysis is neither published nor cached under the new revision.
    assert_eq!(analyzed["code"], "cancelled");
    let runtime = executor.runtime.lock().unwrap();
    assert!(
        runtime
            .prepare_ocr_analysis(source["id"].as_str().unwrap(), "image-0", 2, &["0".into()])
            .unwrap()
            .cached
            .is_none()
    );
    drop(runtime);
    let refreshed:Value = serde_json::from_str(&executor.execute(&json!({
        "type":"analyze_ocr","sourceId":source["id"],"resourceId":"image-0","ocrRevision":2,"regionIds":["0"],
    }).to_string())).unwrap();
    assert_eq!(refreshed["type"], "ocr_analysis", "{refreshed}");
    assert_eq!(refreshed["batch"]["regions"][0]["text"], "A bridge.");
    let runtime = executor.runtime.lock().unwrap();
    assert!(
        runtime
            .prepare_ocr_analysis(source["id"].as_str().unwrap(), "image-0", 2, &["0".into()])
            .unwrap()
            .cached
            .is_some()
    );
    drop(runtime);
    // Package interpretation is an optional separate projection. A matching
    // persisted artifact projection is reused without invoking that capability.
    let mut runtime = executor.runtime.lock().unwrap();
    let source_id = source["id"].as_str().unwrap();
    let base = runtime.required_ocr_page(source_id, "image-0", 2).unwrap();
    let package = runtime.installed.get("org.mlearn.english").unwrap();
    let package = mlearn_core::OcrPackageProjection {
        package_id: package.manifest.id.clone(),
        package_version: package.manifest.version.clone(),
        package_revision: package.revision().unwrap(),
    };
    let projected = runtime
        .store
        .project_ocr(&base, &base.regions, &package)
        .unwrap();
    let cached = runtime
        .prepare(
            Request::PostprocessOcr {
                source_id: source_id.into(),
                resource_id: "image-0".into(),
                ocr_revision: 2,
            },
            0,
        )
        .unwrap();
    let crate::guest::Prepared::Immediate(response) = cached else {
        panic!("Cached interpretation readmitted package work");
    };
    assert!(matches!(*response,mlearn_core::Response::OcrPage {page} if page == projected));
    // A changed authenticated manifest identity invalidates derived data only.
    runtime
        .installed
        .get_mut("org.mlearn.english")
        .unwrap()
        .manifest
        .display_name = Some("Changed manifest identity".into());
    assert_eq!(
        runtime.current_ocr_page(source_id, "image-0").unwrap(),
        Some(base)
    );
    assert!(
        runtime
            .prepare_ocr_analysis(source_id, "image-0", 2, &["0".into()])
            .unwrap()
            .cached
            .is_none()
    );
}

#[test]
fn unchanged_document_language_retains_analysis_without_readmitting_guest_work() {
    let (directory, executor, _) = fixture();
    let selected = directory.path().join("reader.txt");
    std::fs::write(&selected, "Children walked home.").unwrap();
    let opened: Value = serde_json::from_str(
        &executor.execute(
            &json!({"type":"open_document","path":selected,"packageId":"org.mlearn.english"})
                .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(opened["type"], "document", "{opened}");
    let id = opened["window"]["source"]["id"].as_str().unwrap();
    let analyzed: Value = serde_json::from_str(
        &executor
            .execute(&json!({"type":"analyze_document","sourceId":id,"position":null}).to_string()),
    )
    .unwrap();
    assert_eq!(analyzed["type"], "document_analysis", "{analyzed}");
    let mut runtime = executor.runtime.lock().unwrap();
    let key = runtime.analysis_cache.front().unwrap().0.clone();

    let prepared = runtime
        .prepare(
            Request::SetDocumentLanguage {
                source_id: id.into(),
                package_id: "org.mlearn.english".into(),
            },
            0,
        )
        .unwrap();

    let crate::guest::Prepared::Immediate(response) = prepared else {
        panic!("Unchanged document language readmitted guest work");
    };
    assert!(matches!(*response, mlearn_core::Response::Document { .. }));
    assert!(
        runtime
            .analysis_cache
            .iter()
            .any(|(cached, _)| cached == &key)
    );
}

#[test]
fn unchanged_source_language_keeps_analysis_without_guest_execution() {
    // Given real cached morphology for the currently installed package/version.
    let (_directory, executor, source) = fixture();
    let analyzed: Value = serde_json::from_str(
        &executor.execute(
            &json!({
                "type":"analyze_source","sourceId":source.id,"positionMs":0,
            })
            .to_string(),
        ),
    )
    .unwrap();
    assert_eq!(analyzed["type"], "analysis");
    let mut runtime = executor.runtime.lock().unwrap();
    // When that exact package is selected again, the guest-work budget is zero.
    let prepared = runtime
        .prepare(
            Request::SetSourceLanguage {
                source_id: source.id.clone(),
                package_id: source.package_id.clone(),
            },
            0,
        )
        .unwrap();
    let crate::guest::Prepared::Immediate(response) = prepared else {
        panic!("Unchanged package selection admitted redundant guest work");
    };
    // Then the bounded source is returned without invalidating reusable morphology.
    assert_eq!(
        serde_json::to_value(response).unwrap()["window"]["source"]["id"],
        source.id
    );
    assert!(
        runtime
            .prepare_analysis(&source.id, 0)
            .unwrap()
            .cached
            .is_some(),
        "Unchanged package selection discarded reusable morphology"
    );
}

#[test]
fn source_language_reselection_adopts_a_new_installed_version() {
    // Given the same package ID saved with an older version.
    let (directory, executor, mut source) = fixture();
    let installed_version = source.package_version.clone();
    source.package_version = "previous-version".into();
    let store = ProfileStore::open(&directory.path().join("profile/profile.sqlite3")).unwrap();
    store.save_source(&source).unwrap();
    // When the installed package is explicitly selected, this is not a no-op.
    let changed: Value = serde_json::from_str(
        &executor.execute(
            &json!({
                "type":"set_source_language","sourceId":source.id,"packageId":source.package_id,
            })
            .to_string(),
        ),
    )
    .unwrap();
    // Then its current version is adopted through normal validated guest execution.
    assert_eq!(changed["type"], "source");
    assert_eq!(
        changed["window"]["source"]["packageVersion"],
        installed_version
    );
}

#[test]
fn bounded_source_window_completes_when_guest_result_is_held() {
    // Given real stored cues and actual Wasm output held before publication.
    let (_directory, executor, source) = fixture();
    // When the foreground requests a distant bounded cue window.
    let ((before_release, worker, response), analysis) = with_held_guest(
        &executor,
        Request::AnalyzeSource {
            source_id: source.id.clone(),
            position_ms: 0,
        },
        || {
            foreground_attempt(
                &executor,
                json!({"type":"source_window","sourceId":source.id,"positionMs":26_500}),
            )
        },
    );
    let eventual = worker.join().unwrap();
    drop(response);
    // Then raw cues arrive without releasing guest completion.
    assert_eq!(
        analysis["type"], "analysis",
        "The held operation must execute the real fixture"
    );
    assert_eq!(
        analysis["batch"]["cues"][0]["tokens"][0]["text"],
        "Children"
    );
    assert_eq!(eventual["window"]["totalCues"], 40);
    let indices = eventual["window"]["cues"]
        .as_array()
        .unwrap()
        .iter()
        .map(|cue| cue["index"].as_u64().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(indices, [25, 26, 27]);
    assert!(
        before_release.is_ok(),
        "source_window waited for guest release: {before_release:?}"
    );
}
#[test]
fn checkpoint_is_durable_when_guest_result_is_held() {
    // Given a saved source with actual guest output held before publication.
    let (directory, executor, source) = fixture();
    // When a foreground checkpoint is submitted independently of analysis.
    let ((before_release, worker, response), analysis) = with_held_guest(
        &executor,
        Request::AnalyzeSource {
            source_id: source.id.clone(),
            position_ms: 0,
        },
        || {
            foreground_attempt(
                &executor,
                json!({"type":"save_position","sourceId":source.id,"positionMs":27_123,"durationMs":40_000}),
            )
        },
    );
    let eventual = worker.join().unwrap();
    drop(response);
    // Then the durable receipt does not depend on releasing guest completion.
    assert_eq!(analysis["type"], "analysis");
    assert_eq!(eventual["type"], "position_saved");
    let store = ProfileStore::open(&directory.path().join("profile/profile.sqlite3")).unwrap();
    assert_eq!(store.source(&source.id).unwrap().position_ms, 27_123);
    assert!(
        before_release.is_ok(),
        "save_position waited for guest release: {before_release:?}"
    );
}
#[test]
fn subtitle_replacement_rejects_the_held_analysis_completion() {
    // Given an old-revision analysis whose real guest output has returned.
    let (directory, executor, source) = fixture();
    // When the normal Runtime action admits replacement before completion.
    let (replacement, completed) = with_held_guest(
        &executor,
        Request::AnalyzeSource {
            source_id: source.id.clone(),
            position_ms: 0,
        },
        || {
            let path = directory.path().join("replacement.srt");
            std::fs::write(
                &path,
                "1\n00:00:00,000 --> 00:00:10,000\nChildren came home.\n",
            )
            .unwrap();
            serde_json::from_str::<Value>(
                &executor.execute(
                    &json!({
                        "type":"attach_subtitles","sourceId":source.id,"path":path,
                    })
                    .to_string(),
                ),
            )
            .unwrap()
        },
    );
    // Then neither the returned batch nor cache admits old-source work.
    assert_eq!(replacement["type"], "source");
    let store = ProfileStore::open(&directory.path().join("profile/profile.sqlite3")).unwrap();
    assert_eq!(
        serde_json::to_value(store.source(&source.id).unwrap().subtitle_revision).unwrap(),
        replacement["window"]["source"]["subtitleRevision"]
    );
    assert_eq!(
        completed["type"], "error",
        "Replaced source published stale real guest output"
    );
    assert_eq!(completed["code"], "cancelled");
    assert!(
        executor.runtime.lock().unwrap().analysis_cache.is_empty(),
        "Rejected completion populated the analysis cache"
    );
}
#[test]
fn timing_change_rejects_held_analysis_without_rewriting_source_coordinates() {
    let (directory, executor, source) = fixture();
    let (changed, completed) = with_held_guest(
        &executor,
        Request::AnalyzeSource {
            source_id: source.id.clone(),
            position_ms: 0,
        },
        || {
            serde_json::from_str::<Value>(
                &executor.execute(
                    &json!({
                        "type":"set_subtitle_offset","sourceId":source.id,"offsetMs":20_000,
                    })
                    .to_string(),
                ),
            )
            .unwrap()
        },
    );
    assert_eq!(changed["window"]["cues"][1]["index"], 20);
    assert_eq!(changed["window"]["cues"][1]["startMs"], 20_000);
    assert_eq!(completed["type"], "error");
    assert_eq!(completed["code"], "cancelled");
    assert!(executor.runtime.lock().unwrap().analysis_cache.is_empty());
    let store = ProfileStore::open(&directory.path().join("profile/profile.sqlite3")).unwrap();
    assert_eq!(store.source(&source.id).unwrap().subtitle_offset_ms, 20_000);
}
#[test]
fn explicit_cancellation_rejects_the_held_analysis_without_losing_a_checkpoint() {
    // Given actual guest output held before the final epoch check.
    let (directory, executor, source) = fixture();
    let cancellation = executor.cancellation_handle();
    // When explicit source cancellation advances the native epoch.
    let ((), completed) = with_held_guest(
        &executor,
        Request::AnalyzeSource {
            source_id: source.id.clone(),
            position_ms: 0,
        },
        || {
            cancellation.fetch_add(1, Ordering::Relaxed);
        },
    );
    // Then cancellation rejects publication but does not discard checkpoints.
    assert_eq!(completed["type"], "error");
    assert_eq!(completed["code"], "cancelled");
    assert!(executor.runtime.lock().unwrap().analysis_cache.is_empty());
    let saved: Value = serde_json::from_str(&executor.execute(
        &json!({"type":"save_position","sourceId":source.id,"positionMs":31_789,"durationMs":40_000}).to_string(),
    )).unwrap();
    assert_eq!(saved["type"], "position_saved");
    let store = ProfileStore::open(&directory.path().join("profile/profile.sqlite3")).unwrap();
    assert_eq!(store.source(&source.id).unwrap().position_ms, 31_789);
}
#[path = "guest_lifetime_tests.rs"]
mod lifetime;
