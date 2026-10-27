use mlearn_language_host::CodePolicy;
use mlearn_runtime::{catalog::Manifest, BundledPlugin, Runtime};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

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
fn call(runtime: &mut Runtime, request: Value) -> Value {
    let response: Value = serde_json::from_str(&runtime.execute(&request.to_string())).unwrap();
    assert_ne!(response["type"], "error", "{request}: {response}");
    response
}
fn fixture(extension: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(format!("../../tests/fixtures/reader/journey.{extension}"))
}

#[test]
fn document_analysis_isolates_the_visible_passage_from_unsupported_neighboring_text() {
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = open(&directory.path().join("profile"));
    let document = call(
        &mut runtime,
        json!({
            "type":"open_document", "path":fixture("txt"), "packageId":"org.mlearn.english",
        }),
    );
    let source = &document["window"]["source"];
    let analyzed = call(
        &mut runtime,
        json!({
            "type":"analyze_document","sourceId":source["id"],"position":{
                "parserRevision":source["parserRevision"],"resource":"text","blockId":"byte:0","offset":0,
            },
        }),
    );
    let blocks = analyzed["batch"]["blocks"].as_array().unwrap();
    assert_eq!(blocks.len(), 1);
    assert_eq!(blocks[0]["text"], "A small journey");
    assert!(blocks[0]["tokens"]
        .as_array()
        .unwrap()
        .iter()
        .any(|token| !token["targets"].as_array().unwrap().is_empty()));
    let unsupported: Value = serde_json::from_str(&runtime.execute(&json!({
        "type":"analyze_document","sourceId":source["id"],"position":{
            "parserRevision":source["parserRevision"],"resource":"text","blockId":"byte:17","offset":0,
        },
    }).to_string())).unwrap();
    assert_eq!(unsupported["type"], "error");
}

#[test]
fn interrupted_journal_creation_does_not_prevent_profile_reopening() {
    let directory = tempfile::tempdir().unwrap();
    drop(open(directory.path()));
    for (name, bytes) in [
        ("empty", ""),
        ("partial", "{\"version\":1,"),
        ("pending", "{\"version\":"),
    ] {
        let staging = directory
            .path()
            .join("document-staging")
            .join(format!("import-{name}"));
        std::fs::create_dir_all(&staging).unwrap();
        let filename = if name == "pending" {
            "journal.pending"
        } else {
            "journal.json"
        };
        std::fs::write(staging.join(filename), bytes).unwrap();
    }
    let mut runtime = open(directory.path());
    assert_eq!(
        std::fs::read_dir(directory.path().join("document-staging"))
            .unwrap()
            .count(),
        0
    );
    let imported = call(
        &mut runtime,
        json!({
            "type":"open_document","path":fixture("txt"),"packageId":"org.mlearn.english",
        }),
    );
    assert_eq!(imported["window"]["source"]["totalBlocks"], 7);
}

#[test]
fn reopening_identical_bytes_applies_the_requested_language_without_resetting_progress() {
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = open(directory.path());
    let imported = call(
        &mut runtime,
        json!({
            "type":"open_document","path":fixture("txt"),"packageId":"org.mlearn.english",
        }),
    );
    let source = &imported["window"]["source"];
    let position = json!({"parserRevision":source["parserRevision"],"resource":"text","blockId":"byte:138","offset":4});
    call(
        &mut runtime,
        json!({"type":"checkpoint_document","checkpoint":{
            "sourceId":source["id"],"contentRevision":source["contentRevision"],"position":position,"appearance":source["appearance"],
        }}),
    );
    drop(runtime);
    {
        let mut store =
            mlearn_storage::ProfileStore::open(&directory.path().join("profile.sqlite3")).unwrap();
        store
            .set_document_language(
                source["id"].as_str().unwrap(),
                "previously-selected-package",
                "old",
            )
            .unwrap();
    }
    let mut runtime = open(directory.path());
    let reopened = call(
        &mut runtime,
        json!({
            "type":"open_document","path":fixture("txt"),"packageId":"org.mlearn.english",
        }),
    );
    assert_eq!(reopened["window"]["source"]["id"], source["id"]);
    assert_eq!(
        reopened["window"]["source"]["packageId"],
        "org.mlearn.english"
    );
    assert_eq!(reopened["window"]["source"]["position"], position);
    assert_eq!(
        reopened["window"]["source"]["appearance"],
        source["appearance"]
    );
}

#[test]
fn imported_epub_retains_authored_ruby_images_flow_and_exact_progress_after_profile_relocation() {
    let directory = tempfile::tempdir().unwrap();
    let original = directory.path().join("selected.epub");
    std::fs::copy(fixture("epub"), &original).unwrap();
    let profile = directory.path().join("profile");
    let mut runtime = open(&profile);
    let document = call(
        &mut runtime,
        json!({
            "type":"open_document", "path":original, "packageId":"org.mlearn.english",
        }),
    );
    let source = document["window"]["source"].clone();
    assert_ne!(source["documentPath"], original.to_string_lossy().as_ref());
    let blocks = document["window"]["blocks"].as_array().unwrap();
    let seed = blocks.iter().find(|block| block["id"] == "seed").unwrap();
    assert_eq!(seed["text"], "🌱 東京へ歩く。");
    assert_eq!(
        seed["readings"],
        json!([{"start":5,"end":11,"text":"とうきょう"}])
    );
    assert_eq!(seed["writingMode"], "vertical-rl");
    let position = json!({
        "parserRevision":source["parserRevision"],
        "resource":"EPUB/return.xhtml","blockId":"bridge-two","offset":4,
    });
    let appearance = json!({
        "writingMode":"horizontal","font":"serif","fontSize":30,
        "lineHeight":1.8,"letterSpacing":0.5,
    });
    call(
        &mut runtime,
        json!({"type":"checkpoint_document","checkpoint":{
            "sourceId":source["id"],"contentRevision":source["contentRevision"],
            "position":position,"appearance":appearance,
        }}),
    );
    let image_window = call(
        &mut runtime,
        json!({
            "type":"document_window","sourceId":source["id"],"position":{
                "parserRevision":source["parserRevision"],
                "resource":"EPUB/return.xhtml","blockId":"bridge-one","offset":0,
            },
        }),
    );
    let image = image_window["window"]["blocks"]
        .as_array()
        .unwrap()
        .iter()
        .find_map(|block| block["image"]["resourceId"].as_str())
        .unwrap();
    let resource = call(
        &mut runtime,
        json!({
            "type":"document_resource","sourceId":source["id"],"resourceId":image,
        }),
    );
    let image_bytes = std::fs::read(resource["location"]["path"].as_str().unwrap()).unwrap();
    assert!(!image_bytes.is_empty());
    assert!(resource["location"]["mimeType"]
        .as_str()
        .unwrap()
        .starts_with("image/"));
    drop(runtime);
    std::fs::remove_file(original).unwrap();
    let relocated = directory.path().join("relocated");
    std::fs::rename(&profile, &relocated).unwrap();
    let mut runtime = open(&relocated);

    let resumed = call(
        &mut runtime,
        json!({"type":"resume_document","sourceId":source["id"]}),
    );

    assert_eq!(resumed["window"]["source"]["position"], position);
    assert_eq!(resumed["window"]["source"]["appearance"], appearance);
    assert_eq!(resumed["window"]["blocks"][0]["id"], "bridge-two");
    assert_eq!(
        resumed["window"]["blocks"][0]["writingMode"],
        "horizontal-tb"
    );
    let resource = call(
        &mut runtime,
        json!({
            "type":"document_resource","sourceId":source["id"],"resourceId":image,
        }),
    );
    assert_eq!(
        std::fs::read(resource["location"]["path"].as_str().unwrap()).unwrap(),
        image_bytes
    );
    let duplicate = call(
        &mut runtime,
        json!({
            "type":"open_document","path":fixture("epub"),"packageId":"org.mlearn.english",
        }),
    );
    assert_eq!(duplicate["window"]["source"]["position"], position);
    assert_eq!(duplicate["window"]["source"]["appearance"], appearance);
}

#[test]
fn restart_reclaims_uncommitted_document_files_but_preserves_registered_imports() {
    let directory = tempfile::tempdir().unwrap();
    let selected = directory.path().join("reader.txt");
    std::fs::write(&selected, "Children walked home.").unwrap();
    let mut runtime = open(directory.path());
    let opened = call(
        &mut runtime,
        json!({
            "type":"open_document","path":selected,"packageId":"org.mlearn.english",
        }),
    );
    let saved = &opened["window"]["source"];
    let staging = directory.path().join("document-staging");
    let committed = staging.join("import-committed");
    std::fs::create_dir_all(&committed).unwrap();
    std::fs::write(
        committed.join("journal.json"),
        serde_json::to_vec(&json!({
            "version":1,"source_id":saved["id"],"revision":saved["contentRevision"],
            "format":"text","images":[],
        }))
        .unwrap(),
    )
    .unwrap();
    let orphan_id = format!("document-{}", "a".repeat(64));
    let orphan_revision = "b".repeat(64);
    let orphan = directory
        .path()
        .join("documents")
        .join(format!("{orphan_revision}.{orphan_id}.txt"));
    std::fs::write(&orphan, "Partial publication without a source row").unwrap();
    let abandoned = staging.join("import-uncommitted");
    std::fs::create_dir_all(&abandoned).unwrap();
    std::fs::write(
        abandoned.join("journal.json"),
        serde_json::to_vec(&json!({
            "version":1,"source_id":orphan_id,"revision":orphan_revision,
            "format":"text","images":[],
        }))
        .unwrap(),
    )
    .unwrap();
    drop(runtime);

    let mut runtime = open(directory.path());

    assert!(!orphan.exists());
    assert_eq!(std::fs::read_dir(staging).unwrap().count(), 0);
    let resumed = call(
        &mut runtime,
        json!({"type":"resume_document","sourceId":saved["id"]}),
    );
    assert_eq!(
        resumed["window"]["blocks"][0]["text"],
        "Children walked home."
    );
    assert!(Path::new(saved["documentPath"].as_str().unwrap()).is_file());
}

#[test]
fn pdf_import_preserves_original_blank_page_identity_without_fabricated_text_or_ocr() {
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = open(directory.path());
    let document = call(
        &mut runtime,
        json!({
            "type":"open_document","path":fixture("pdf"),"packageId":"org.mlearn.english",
        }),
    );
    let source = &document["window"]["source"];
    assert_eq!(source["totalPages"], 3);
    let blocks = document["window"]["blocks"].as_array().unwrap();
    assert_eq!(blocks.len(), 3);
    assert_eq!(blocks[0]["page"], 0);
    assert!(blocks[0]["text"].as_str().unwrap().contains("small bridge"));
    assert_eq!(blocks[1]["page"], 1);
    assert_eq!(blocks[1]["text"], "");
    assert_eq!(blocks[1]["image"], Value::Null);
    assert_eq!(blocks[2]["page"], 2);
    assert!(blocks[2]["text"]
        .as_str()
        .unwrap()
        .contains("Turn the page."));
    let analysis = call(
        &mut runtime,
        json!({
            "type":"analyze_document","sourceId":source["id"],"position":null,
        }),
    );
    assert_eq!(analysis["batch"]["blocks"].as_array().unwrap().len(), 1);
    assert_eq!(analysis["batch"]["blocks"][0]["blockId"], "pdf-page:0");
    let later = call(
        &mut runtime,
        json!({
            "type":"analyze_document","sourceId":source["id"],"position":{
                "parserRevision":source["parserRevision"],"resource":blocks[2]["resource"],"blockId":"pdf-page:2","offset":0,
            },
        }),
    );
    assert_eq!(later["batch"]["blocks"].as_array().unwrap().len(), 1);
    assert_eq!(later["batch"]["blocks"][0]["blockId"], "pdf-page:2");
}

#[test]
fn document_capture_returns_the_original_duplicate_passage_and_rejects_changed_original_bytes() {
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = open(directory.path());
    let opened = call(
        &mut runtime,
        json!({
            "type":"open_document","path":fixture("epub"),"packageId":"org.mlearn.english",
        }),
    );
    let source = &opened["window"]["source"];
    let anchor = json!({
        "sourceId":source["id"],"contentRevision":source["contentRevision"],
        "packageId":source["packageId"],"packageVersion":source["packageVersion"],
        "text":"The small bridge is quiet.",
        "locator":{"kind":"document","parserRevision":source["parserRevision"],
            "resource":"EPUB/return.xhtml","blockId":"bridge-two","contextStart":0,
            "selectionStart":4,"selectionEnd":16},
    });
    let written = call(
        &mut runtime,
        json!({
            "type":"create_material","command":{"commandId":"capture-bridge","distinct":false,
                "content":{"packageId":"org.mlearn.english","targetId":null,"packageRevision":null,
                    "sense":null,"phrase":"small bridge","reading":"","meaning":"a short bridge","context":"",
                    "notes":"","examples":[],"attachments":[],"source":anchor}},
        }),
    );
    let id = &written["outcome"]["material"]["id"];

    let returned = call(
        &mut runtime,
        json!({"type":"return_material_source","id":id}),
    );

    assert_eq!(returned["type"], "document_material_source");
    assert_eq!(returned["anchor"], anchor);
    assert_eq!(returned["window"]["blocks"][0]["id"], "bridge-two");
    assert_eq!(returned["window"]["source"]["position"]["offset"], 4);
    let started = call(
        &mut runtime,
        json!({"type":"review","command":{"kind":"start","start":{
            "commandId":"start-document-review","sessionId":"document-review",
            "mode":{"kind":"finite","limit":1}
        }}}),
    );
    let session = &started["commit"]["session"];
    let encounter = &session["encounter"];
    assert_eq!(encounter["materialId"], *id);
    assert_eq!(encounter["source"], anchor);
    call(
        &mut runtime,
        json!({"type":"review","command":{"kind":"assistance","mutation":{
            "commandId":"document-source-assistance","sessionId":session["id"],
            "expectedRevision":session["revision"]
        },"encounterId":encounter["id"],"assistance":"source"}}),
    );
    let review_return = call(
        &mut runtime,
        json!({"type":"return_review_source","sessionId":session["id"],
            "encounterId":encounter["id"]}),
    );
    assert_eq!(review_return["type"], "document_material_source");
    assert_eq!(review_return["anchor"], anchor);
    assert_eq!(review_return["window"]["blocks"][0]["id"], "bridge-two");
    assert_eq!(review_return["window"]["source"]["position"]["offset"], 4);
    std::fs::write(
        returned["window"]["source"]["documentPath"]
            .as_str()
            .unwrap(),
        b"changed",
    )
    .unwrap();
    let rejected: Value = serde_json::from_str(
        &runtime.execute(&json!({"type":"return_material_source","id":id}).to_string()),
    )
    .unwrap();
    assert_eq!(rejected["type"], "error");
    let preserved = call(&mut runtime, json!({"type":"material","id":id}));
    assert_eq!(preserved["material"]["content"]["source"], anchor);
}

fn image_fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(format!("../../tests/fixtures/ocr/vision/{name}.png"))
}

// The nondeterministic native provider is mocked only at its real wire boundary.
// These observations exercise Rust ownership; they do not claim OCR recognition.
fn ocr_result(id: &str) -> Value {
    json!({
        "requestId":id,
        "provider":{"id":"fixture-provider","label":"Test boundary","revision":"1","availability":"ready",
            "languages":["en"],"scripts":["Latn"],"languageProvenance":"deterministic test fixture","reason":null},
        "width":720,"height":300,"crop":null,
        "regions":[
            {"id":"0","text":"Children walked home.",
                "quad":{"topLeft":{"x":0.1,"y":0.1},"topRight":{"x":0.5,"y":0.11},
                    "bottomRight":{"x":0.5,"y":0.2},"bottomLeft":{"x":0.1,"y":0.2}},
                "candidates":[{"text":"Children walked home.","confidence":null}],
                "language":null,"orientation":null,"readingOf":null},
            {"id":"1","text":"A😀 bridge",
                "quad":{"topLeft":{"x":0.7,"y":0.4},"topRight":{"x":0.9,"y":0.4},
                    "bottomRight":{"x":0.9,"y":0.6},"bottomLeft":{"x":0.7,"y":0.6}},
                "candidates":[],"language":null,"orientation":null,"readingOf":null},
        ]
    })
}

fn ocr_request(source: &Value, id: &str) -> Value {
    json!({"requestId":id,"sourceId":source["id"],"contentRevision":source["contentRevision"],
        "resourceId":"image-0","providerId":"fixture-provider","recognitionLanguages":["en"],"crop":null})
}

#[test]
fn image_collection_ocr_uses_shared_analysis_and_frozen_capture_review_return_after_correction() {
    // Given a real source-owned imported raster and actual installed language package.
    let directory = tempfile::tempdir().unwrap();
    let profile = directory.path().join("profile");
    let mut runtime = open(&profile);
    let imported = call(
        &mut runtime,
        json!({
            "type":"import_image_collection","paths":[image_fixture("horizontal-mixed"),image_fixture("no-text")],
            "title":"Two source pages","packageId":"org.mlearn.english",
        }),
    );
    let source = imported["window"]["source"].clone();
    assert_eq!(source["format"], "images");
    assert_eq!(source["totalPages"], 2);
    let request = ocr_request(&source, "recognize");
    assert_eq!(
        call(
            &mut runtime,
            json!({"type":"ocr_recovery","request":request})
        )["recovery"]["state"],
        "unknown"
    );
    let plan = call(&mut runtime, json!({"type":"plan_ocr","request":request}));
    assert_eq!(plan["plan"]["pageIndex"], Value::Null);
    assert!(Path::new(plan["plan"]["path"].as_str().unwrap()).starts_with(&profile));
    assert_eq!(
        call(
            &mut runtime,
            json!({"type":"ocr_recovery","request":request})
        )["recovery"]["state"],
        "pending"
    );
    let output = ocr_result("recognize");
    let recognized = call(&mut runtime, json!({"type":"complete_ocr","result":output}));
    let page = recognized["page"].clone();
    let analyzed = call(
        &mut runtime,
        json!({
            "type":"analyze_ocr","sourceId":source["id"],"resourceId":"image-0","ocrRevision":1,"regionIds":["0"],
        }),
    );
    assert_eq!(
        analyzed["batch"]["regions"][0]["text"],
        "Children walked home."
    );
    assert!(!analyzed["batch"]["knowledge"]
        .as_array()
        .unwrap()
        .is_empty());
    let key = analyzed["batch"]["knowledge"][0]["key"].clone();
    call(
        &mut runtime,
        json!({"type":"change_claim","change":{"commandId":"ocr-claim","key":key,"claim":false}}),
    );
    let refreshed = call(
        &mut runtime,
        json!({
            "type":"analyze_ocr","sourceId":source["id"],"resourceId":"image-0","ocrRevision":1,"regionIds":["0"],
        }),
    );
    assert_eq!(refreshed["batch"]["regions"], analyzed["batch"]["regions"]);
    assert!(refreshed["batch"]["knowledge"]
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item["key"] == key && item["claim"] == false));
    let anchor = json!({
        "sourceId":source["id"],"contentRevision":source["contentRevision"],
        "packageId":source["packageId"],"packageVersion":source["packageVersion"],"text":"A😀 bridge",
        "locator":{"kind":"image","resourceId":"image-0","pageIndex":0,"ocrRevision":1,"regionId":"1",
            "contextStart":0,"selectionStart":6,"selectionEnd":12},
    });
    for (index, locator) in [
        json!({"kind":"image","resourceId":"image-0","pageIndex":0,"ocrRevision":1,"regionId":"1",
            "contextStart":0,"selectionStart":2,"selectionEnd":5}),
        json!({"kind":"image","resourceId":"image-0","pageIndex":0,"ocrRevision":999,"regionId":"1",
            "contextStart":0,"selectionStart":6,"selectionEnd":12}),
    ]
    .into_iter()
    .enumerate()
    {
        let mut invalid = anchor.clone();
        invalid["locator"] = locator;
        let rejected:Value = serde_json::from_str(&runtime.execute(&json!({
            "type":"create_material","command":{"commandId":format!("invalid-image-selection-{index}"),"distinct":false,
                "content":{"packageId":"org.mlearn.english","targetId":null,"packageRevision":null,"sense":null,
                    "phrase":"bridge","reading":"","meaning":"a crossing","context":"","notes":"","examples":[],"attachments":[],"source":invalid}},
        }).to_string())).unwrap();
        assert_eq!(rejected["type"], "error");
    }
    let written = call(
        &mut runtime,
        json!({
            "type":"create_material","command":{"commandId":"capture-image","distinct":false,"content":{
                "packageId":"org.mlearn.english","targetId":null,"packageRevision":null,"sense":null,
                "phrase":"bridge","reading":"","meaning":"a crossing","context":"","notes":"","examples":[],"attachments":[],"source":anchor}},
        }),
    );
    let id = written["outcome"]["material"]["id"].clone();
    let started = call(
        &mut runtime,
        json!({"type":"review","command":{"kind":"start","start":{
            "commandId":"start-image-review","sessionId":"image-review","mode":{"kind":"finite","limit":1},
        }}}),
    );
    let session = started["commit"]["session"].clone();
    assert_eq!(session["encounter"]["source"], anchor);
    let mut correction = page["regions"][1].clone();
    correction["text"] = json!("Different corrected text");
    call(
        &mut runtime,
        json!({"type":"correct_ocr","correction":{
            "commandId":"correct-image","sourceId":source["id"],"contentRevision":source["contentRevision"],
            "resourceId":"image-0","expectedRevision":1,"region":correction,
        }}),
    );
    drop(runtime);
    // When Material and the exact Review encounter resume after correction/restart.
    let mut runtime = open(&profile);
    let current = call(
        &mut runtime,
        json!({"type":"read_ocr","sourceId":source["id"],"resourceId":"image-0","ocrRevision":null}),
    );
    assert_eq!(current["page"]["ocrRevision"], 2);
    assert_eq!(
        call(
            &mut runtime,
            json!({"type":"ocr_recovery","request":request})
        )["recovery"],
        json!({"state":"completed","page":page})
    );
    let returned = call(
        &mut runtime,
        json!({"type":"return_material_source","id":id}),
    );
    assert_eq!(returned["type"], "image_material_source");
    assert_eq!(returned["anchor"], anchor);
    assert_eq!(returned["page"], page);
    let frozen_analysis = call(
        &mut runtime,
        json!({
            "type":"analyze_ocr","sourceId":source["id"],"resourceId":"image-0","ocrRevision":1,"regionIds":["0"],
        }),
    );
    assert_eq!(frozen_analysis["batch"]["ocrRevision"], 1);
    assert_eq!(
        frozen_analysis["batch"]["regions"],
        analyzed["batch"]["regions"]
    );
    let resumed = call(
        &mut runtime,
        json!({"type":"review_session","sessionId":session["id"]}),
    );
    assert_eq!(resumed["session"]["encounter"], session["encounter"]);
    call(
        &mut runtime,
        json!({"type":"review","command":{"kind":"assistance","mutation":{
        "commandId":"image-source-assistance","sessionId":session["id"],"expectedRevision":session["revision"],
    },"encounterId":session["encounter"]["id"],"assistance":"source"}}),
    );
    let review_return = call(
        &mut runtime,
        json!({
            "type":"return_review_source","sessionId":session["id"],"encounterId":session["encounter"]["id"],
        }),
    );
    // Then neither path silently substitutes the newer corrected region.
    assert_eq!(review_return["type"], "image_material_source");
    assert_eq!(review_return["page"], page);
    assert_eq!(review_return["anchor"], anchor);
    let evidence = call(
        &mut runtime,
        json!({"type":"ocr_evidence","sourceId":source["id"],"resourceId":"image-0","ocrRevision":1}),
    );
    assert_eq!(evidence["evidence"]["result"], output);
    std::fs::write(plan["plan"]["path"].as_str().unwrap(), b"changed").unwrap();
    let failed: Value = serde_json::from_str(
        &runtime.execute(&json!({"type":"return_material_source","id":id}).to_string()),
    )
    .unwrap();
    assert_eq!(failed["type"], "error");
    assert_eq!(
        call(&mut runtime, json!({"type":"material","id":id}))["material"]["content"]["source"],
        anchor
    );
}

#[test]
fn image_registry_relocates_and_interrupted_ocr_can_retry_without_exposing_arbitrary_paths() {
    // Given an owned collection and in-flight request in a disposable profile.
    let directory = tempfile::tempdir().unwrap();
    let profile = directory.path().join("original");
    let moved = directory.path().join("moved");
    let mut runtime = open(&profile);
    let imported = call(
        &mut runtime,
        json!({"type":"import_image_collection","paths":[image_fixture("horizontal-mixed")],
        "title":"Retained image","packageId":"org.mlearn.english"}),
    );
    let source = imported["window"]["source"].clone();
    let request = ocr_request(&source, "interrupted");
    call(&mut runtime, json!({"type":"plan_ocr","request":request}));
    drop(runtime);
    std::fs::rename(&profile, &moved).unwrap();
    // When the original callback races a restarted/relocated runtime.
    let mut runtime = open(&moved);
    assert_eq!(
        call(
            &mut runtime,
            json!({"type":"ocr_recovery","request":request})
        )["recovery"]["state"],
        "cancelled"
    );
    let stale: Value =
        serde_json::from_str(&runtime.execute(
            &json!({"type":"complete_ocr","result":ocr_result("interrupted")}).to_string(),
        ))
        .unwrap();
    assert_eq!(stale["type"], "error");
    let plan = call(
        &mut runtime,
        json!({"type":"plan_ocr","request":ocr_request(&source,"retry")}),
    );
    assert!(Path::new(plan["plan"]["path"].as_str().unwrap()).starts_with(&moved));
    let completed = call(
        &mut runtime,
        json!({"type":"complete_ocr","result":ocr_result("retry")}),
    );
    assert_eq!(completed["page"]["ocrRevision"], 1);
    let unregistered: Value = serde_json::from_str(
        &runtime.execute(
            &json!({
                "type":"image_page_location","sourceId":source["id"],"resourceId":"/etc/passwd",
            })
            .to_string(),
        ),
    )
    .unwrap();
    // Then only registered immutable source pages resolve.
    assert_eq!(unregistered["type"], "error");
    let location = call(
        &mut runtime,
        json!({"type":"image_page_location","sourceId":source["id"],"resourceId":"image-0"}),
    );
    assert_eq!(location["location"]["path"], plan["plan"]["path"]);
}

#[test]
fn image_collection_admission_failure_leaves_previous_library_and_staging_recoverable() {
    // Given a source collection already admitted from a deterministic filename order.
    let directory = tempfile::tempdir().unwrap();
    let selected = directory.path().join("selected");
    std::fs::create_dir(&selected).unwrap();
    std::fs::copy(image_fixture("no-text"), selected.join("02.png")).unwrap();
    std::fs::copy(image_fixture("horizontal-mixed"), selected.join("10.png")).unwrap();
    let mut runtime = open(&directory.path().join("profile"));
    let imported = call(
        &mut runtime,
        json!({"type":"import_image_collection","paths":[selected],
        "title":"Ordered folder","packageId":"org.mlearn.english"}),
    );
    let source = &imported["window"]["source"];
    let first = call(
        &mut runtime,
        json!({"type":"image_page","sourceId":source["id"],"pageIndex":0}),
    );
    let page = call(
        &mut runtime,
        json!({"type":"image_page","sourceId":source["id"],"pageIndex":1}),
    );
    assert_eq!(first["page"]["resourceId"], "image-0");
    assert_eq!(page["page"]["resourceId"], "image-1");
    let bad = directory.path().join("bad.png");
    std::fs::write(&bad, b"not an image").unwrap();
    // When a subsequent import fails after staging a valid first image.
    let rejected: Value = serde_json::from_str(
        &runtime.execute(
            &json!({
                "type":"import_image_collection","paths":[image_fixture("horizontal-mixed"),bad],
                "title":"Rejected","packageId":"org.mlearn.english",
            })
            .to_string(),
        ),
    )
    .unwrap();
    // Then the existing collection remains usable and staging owns no leaked files.
    assert_eq!(rejected["type"], "error");
    assert_eq!(
        call(&mut runtime, json!({"type":"recent_documents"}))["sources"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        std::fs::read_dir(directory.path().join("profile/document-staging"))
            .unwrap()
            .count(),
        0
    );
    let location = call(
        &mut runtime,
        json!({"type":"image_page_location","sourceId":source["id"],"resourceId":"image-0"}),
    );
    assert_eq!(
        std::fs::read(location["location"]["path"].as_str().unwrap()).unwrap(),
        std::fs::read(image_fixture("no-text")).unwrap()
    );
}

#[test]
fn pdf_page_locations_use_original_registry_indices_without_automatic_ocr_of_authored_text() {
    // Given the M05 PDF containing authored text and a genuinely blank source page.
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = open(directory.path());
    let imported = call(
        &mut runtime,
        json!({"type":"open_document","path":fixture("pdf"),"packageId":"org.mlearn.english"}),
    );
    let source = &imported["window"]["source"];
    // When a bounded original page descriptor and raster location are requested.
    let descriptor = call(
        &mut runtime,
        json!({"type":"image_page","sourceId":source["id"],"pageIndex":1}),
    );
    let location = call(
        &mut runtime,
        json!({"type":"image_page_location","sourceId":source["id"],"resourceId":descriptor["page"]["resourceId"]}),
    );
    // Then host rasterization uses original page 1, and text pages remain unrecognized.
    assert_eq!(location["location"]["pageIndex"], 1);
    assert_eq!(location["location"]["mimeType"], "application/pdf");
    assert_eq!(location["location"]["path"], source["documentPath"]);
    let text_descriptor = call(
        &mut runtime,
        json!({"type":"image_page","sourceId":source["id"],"pageIndex":0}),
    );
    let cached = call(
        &mut runtime,
        json!({"type":"read_ocr","sourceId":source["id"],"resourceId":text_descriptor["page"]["resourceId"],"ocrRevision":null}),
    );
    assert_eq!(cached["page"], Value::Null);
}
