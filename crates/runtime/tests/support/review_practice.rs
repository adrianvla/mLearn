use super::*;

#[test]
fn selected_practice_freezes_every_supported_probe_without_consuming_global_due_work() {
    // Given two Materials but a deliberate one-Material selection.
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = open(directory.path(), true);
    let selected = create(&mut runtime, "selected", "children", "young people");
    let other = create(&mut runtime, "other", "trees", "woody plants");
    let command = json!({"kind":"start","start":{"commandId":"practice","sessionId":"practice",
        "mode":{"kind":"practice","items":[{"materialId":selected["id"],"source":null}]}}});
    // When all admitted practice work is answered, including its incompatible direction.
    let mut session =
        call(&mut runtime, json!({"type":"review","command":command}))["commit"]["session"].clone();
    assert_eq!(session["total"], 2);
    for index in 0..2 {
        assert_eq!(session["encounter"]["materialId"], selected["id"]);
        let id = session["encounter"]["id"].clone();
        session = mutate(
            &mut runtime,
            &session,
            &format!("reveal-{index}"),
            "reveal",
            json!({"encounterId":id}),
        );
        let report = response(&session);
        session = mutate(
            &mut runtime,
            &session,
            &format!("submit-{index}"),
            "submit",
            json!({"response":report}),
        );
        if index == 0 {
            session = mutate(&mut runtime, &session, "next", "next", json!({}));
            assert!(
                session["encounter"]["conditions"]["assistance"]
                    .as_array()
                    .unwrap()
                    .contains(&json!("prior_disclosure"))
            );
        }
    }
    // Then purpose and finite membership survive, and scheduled Review still sees all due probes.
    assert_eq!(session["state"], "complete");
    assert_eq!(session["mode"]["kind"], "practice");
    let due = call(
        &mut runtime,
        json!({"type":"review","command":{"kind":"start","start":{
        "commandId":"due","sessionId":"due","mode":{"kind":"finite","limit":128}}}}),
    );
    assert_eq!(due["commit"]["session"]["total"], 4);
    assert_ne!(selected["id"], other["id"]);
    let replay = call(&mut runtime, json!({"type":"review","command":command}));
    assert_eq!(replay["commit"]["session"], session);
}

#[test]
fn unavailable_selected_probe_fails_whole_scope_and_recovers_under_the_same_identity() {
    // Given a supported Material and an explicit selected item with no supported task.
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = open(directory.path(), true);
    let good = create(&mut runtime, "good", "children", "young people");
    let unavailable = create(&mut runtime, "unavailable", "trees", "");
    let request = json!({"type":"review","command":{"kind":"start","start":{
    "commandId":"practice","sessionId":"practice","mode":{"kind":"practice","items":[
        {"materialId":good["id"],"source":null},{"materialId":unavailable["id"],"source":null}
    ]}}}});
    // When any selected member is unavailable, no partial or substituted session commits.
    let failed = execute(&mut runtime, request.clone());
    assert_eq!(failed["code"], "invalid_review");
    assert!(
        call(&mut runtime, json!({"type":"review_sessions"}))["sessions"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let mut content = unavailable["content"].clone();
    content["meaning"] = json!("woody plants");
    call(
        &mut runtime,
        json!({"type":"update_material","command":{
            "commandId":"repair","id":unavailable["id"],"expectedRevision":1,"content":content,"excluded":false
        }}),
    );
    // Then recovery retries the original intent without broadening its exact selection.
    let recovered = call(&mut runtime, request);
    assert_eq!(recovered["commit"]["session"]["total"], 4);
    assert_eq!(recovered["commit"]["committedRevision"], 1);
}

#[test]
fn compact_image_practice_override_returns_original_ocr_after_correction_and_restart() {
    // Given a real image registry, native OCR boundary result and an existing unrelated Material source.
    let directory = tempfile::tempdir().unwrap();
    let profile = directory.path().join("profile");
    let mut runtime = open(&profile, true);
    let image = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/ocr/vision/horizontal-mixed.png");
    let imported = call(
        &mut runtime,
        json!({"type":"import_image_collection","paths":[image],
        "title":"Practice source","packageId":"org.mlearn.english"}),
    );
    let source = &imported["window"]["source"];
    call(
        &mut runtime,
        json!({"type":"plan_ocr","request":{
            "requestId":"ocr","sourceId":source["id"],"contentRevision":source["contentRevision"],
            "resourceId":"image-0","providerId":"fixture","recognitionLanguages":["en"],"crop":null
        }}),
    );
    let recognized = call(
        &mut runtime,
        json!({"type":"complete_ocr","result":{
            "requestId":"ocr","provider":{"id":"fixture","label":"Boundary fixture","revision":"1","availability":"ready",
                "languages":["en"],"scripts":["Latn"],"languageProvenance":"deterministic test fixture","reason":null},
            "width":720,"height":300,"crop":null,"regions":[{
                "id":"0","text":"A😀 bridge","quad":{"topLeft":{"x":0.1,"y":0.1},"topRight":{"x":0.8,"y":0.1},
                    "bottomRight":{"x":0.8,"y":0.5},"bottomLeft":{"x":0.1,"y":0.5}},
                "candidates":[],"language":null,"orientation":null,"readingOf":null
            }]
        }}),
    );
    let page = recognized["page"].clone();
    let material = create(&mut runtime, "saved", "bridge", "a crossing");
    let anchor = json!({"sourceId":source["id"],"contentRevision":source["contentRevision"],
        "packageId":source["packageId"],"packageVersion":source["packageVersion"],"text":"bridge",
        "locator":{"kind":"image","resourceId":"image-0","pageIndex":0,"ocrRevision":1,"regionId":"0",
            "contextStart":6,"selectionStart":0,"selectionEnd":6}});
    let command = json!({"kind":"start","start":{"commandId":"practice","sessionId":"practice",
        "mode":{"kind":"practice","items":[{"materialId":material["id"],"source":anchor}]}}});
    for (index, (field, value)) in [
        ("text", json!("invented")),
        ("packageId", json!("other.package")),
        (
            "locator",
            json!({"kind":"image","resourceId":"image-0","pageIndex":0,"ocrRevision":1,
            "regionId":"0","contextStart":2,"selectionStart":0,"selectionEnd":6}),
        ),
        (
            "locator",
            json!({"kind":"image","resourceId":"image-0","pageIndex":0,"ocrRevision":999,
            "regionId":"0","contextStart":6,"selectionStart":0,"selectionEnd":6}),
        ),
    ]
    .into_iter()
    .enumerate()
    {
        let mut invalid = command.clone();
        invalid["start"]["commandId"] = json!(format!("invalid-{index}"));
        invalid["start"]["sessionId"] = json!(format!("invalid-{index}"));
        invalid["start"]["mode"]["items"][0]["source"][field] = value;
        assert_eq!(
            execute(&mut runtime, json!({"type":"review","command":invalid}))["type"],
            "error"
        );
    }
    let started = call(&mut runtime, json!({"type":"review","command":command}));
    let session = &started["commit"]["session"];
    assert_eq!(session["encounter"]["source"], anchor);
    assert_eq!(
        call(&mut runtime, json!({"type":"material","id":material["id"]}))["material"]["content"]["source"],
        Value::Null
    );
    let mut correction = page["regions"][0].clone();
    correction["text"] = json!("new OCR text");
    call(
        &mut runtime,
        json!({"type":"correct_ocr","correction":{
            "commandId":"correct-source","sourceId":source["id"],"contentRevision":source["contentRevision"],
            "resourceId":"image-0","expectedRevision":1,"region":correction
        }}),
    );
    let mut changed_source = anchor.clone();
    changed_source["text"] = json!("new OCR text");
    changed_source["locator"]["contextStart"] = json!(0);
    changed_source["locator"]["ocrRevision"] = json!(2);
    let mut content = material["content"].clone();
    content["source"] = changed_source.clone();
    call(
        &mut runtime,
        json!({"type":"update_material","command":{
            "commandId":"new-material-source","id":material["id"],"expectedRevision":1,
            "content":content,"excluded":false
        }}),
    );
    drop(runtime);
    let mut runtime = open(&profile, true);
    // When source assistance and Source Return act on the saved practice encounter after restart.
    let marked = mutate(
        &mut runtime,
        session,
        "assist",
        "assistance",
        json!({"encounterId":session["encounter"]["id"],"assistance":"source"}),
    );
    let returned = call(
        &mut runtime,
        json!({"type":"return_review_source",
        "sessionId":marked["id"],"encounterId":marked["encounter"]["id"]}),
    );
    // Then the exact original OCR revision is returned, while retry retains that original membership.
    assert_eq!(returned["page"], page);
    assert_eq!(returned["anchor"], anchor);
    assert_eq!(
        call(&mut runtime, json!({"type":"material","id":material["id"]}))["material"]["content"]["source"],
        changed_source
    );
    assert_eq!(
        call(&mut runtime, json!({"type":"review","command":command}))["commit"]["session"],
        marked
    );
    let stale = execute(
        &mut runtime,
        json!({"type":"review","command":{"kind":"start","start":{
            "commandId":"stale","sessionId":"stale","mode":{"kind":"practice","items":[{"materialId":material["id"],"source":anchor}]}
        }}}),
    );
    assert_eq!(stale["type"], "error");
}
