use super::*;

#[test]
fn source_override_requires_the_saved_canonical_target_not_just_valid_source_coordinates() {
    // Given a real analyzed source token and a Material saved under its canonical identity.
    let directory = tempfile::tempdir().unwrap();
    let mut runtime = open(&directory.path().join("profile"), true);
    let video = directory.path().join("source.mp4");
    let subtitles = directory.path().join("source.srt");
    std::fs::write(&video, b"isolated practice source").unwrap();
    std::fs::write(
        &subtitles,
        "1\n00:00:01,000 --> 00:00:04,000\nChildren walked home.\n",
    )
    .unwrap();
    let opened = call(
        &mut runtime,
        json!({"type":"open_source","path":video,"packageId":"org.mlearn.english"}),
    );
    let associated = call(
        &mut runtime,
        json!({"type":"attach_subtitles","sourceId":opened["window"]["source"]["id"],"path":subtitles}),
    );
    let source = &associated["window"]["source"];
    let analysis = call(
        &mut runtime,
        json!({"type":"analyze_source","sourceId":source["id"],"positionMs":1500}),
    );
    let token = &analysis["batch"]["cues"][0]["tokens"][0];
    assert_eq!(token["text"], "Children");
    assert!(token["targets"][0].is_string());
    let material = create(&mut runtime, "saved", "Children", "young people");
    let mut content = material["content"].clone();
    content["targetId"] = token["targets"][0].clone();
    content["packageRevision"] = analysis["batch"]["packageRevision"].clone();
    call(
        &mut runtime,
        json!({"type":"update_material","command":{
            "commandId":"link","id":material["id"],"expectedRevision":1,"content":content,"excluded":false
        }}),
    );
    let anchor = json!({"sourceId":source["id"],"contentRevision":source["mediaRevision"],
        "packageId":source["packageId"],"packageVersion":source["packageVersion"],"text":"Children walked home.",
        "locator":{"kind":"video","subtitleRevision":source["subtitleRevision"],"cueIndex":0,
            "selectionStart":0,"selectionEnd":8,"positionMs":1500,"subtitleOffsetMs":0,"playbackRate":1.0}});
    let mut wrong = anchor.clone();
    wrong["locator"]["selectionStart"] = json!(9);
    wrong["locator"]["selectionEnd"] = json!(15);
    // When valid coordinates point to another target, rather than the saved selected word.
    let failed = execute(
        &mut runtime,
        json!({"type":"review","command":{"kind":"start","start":{
            "commandId":"wrong","sessionId":"wrong","mode":{"kind":"practice","items":[{"materialId":material["id"],"source":wrong}]}
        }}}),
    );
    // Then native target analysis rejects that retarget and accepts the original source-linked word.
    assert_eq!(failed["code"], "invalid_review");
    let started = call(
        &mut runtime,
        json!({"type":"review","command":{"kind":"start","start":{
            "commandId":"valid","sessionId":"valid","mode":{"kind":"practice","items":[{"materialId":material["id"],"source":anchor}]}
        }}}),
    );
    assert_eq!(started["commit"]["session"]["encounter"]["source"], anchor);
    assert_eq!(
        started["commit"]["session"]["encounter"]["materialId"],
        material["id"]
    );
    // Evidence inspection consumes the same actual admitted target and source,
    // and remains readable after the executable package is unavailable.
    let session = &started["commit"]["session"];
    let key = session["encounter"]["targets"]
        .as_array()
        .unwrap()
        .iter()
        .find(|target| !target["key"].is_null())
        .unwrap()["key"]
        .clone();
    let revealed = mutate(
        &mut runtime,
        session,
        "reveal-evidence",
        "reveal",
        json!({"encounterId":session["encounter"]["id"]}),
    );
    mutate(
        &mut runtime,
        &revealed,
        "submit-evidence",
        "submit",
        json!({"response":response(&revealed)}),
    );
    call(
        &mut runtime,
        json!({"type":"change_claim","change":{
            "key":key,"claim":true,"commandId":"claim-evidence"
        }}),
    );
    let evidence = call(
        &mut runtime,
        json!({"type":"knowledge_evidence","query":{
            "key":key,"after":null
        }}),
    );
    let projection = call(&mut runtime, json!({"type":"knowledge","keys":[key]}));
    assert_eq!(evidence["type"], "knowledge_evidence");
    assert_eq!(evidence["page"]["projection"], projection["projections"][0]);
    assert_eq!(evidence["page"]["projection"]["claim"], true);
    assert_eq!(evidence["page"]["projection"]["prediction"], Value::Null);
    assert_eq!(
        evidence["page"]["observations"].as_array().unwrap().len(),
        1
    );
    assert_eq!(evidence["page"]["observations"][0]["source"], anchor);
    assert_eq!(evidence["page"]["observations"][0]["practice"], true);
    drop(runtime);
    let mut runtime = open(&directory.path().join("profile"), false);
    let reopened = call(
        &mut runtime,
        json!({"type":"knowledge_evidence","query":{
            "key":key,"after":null
        }}),
    );
    assert_eq!(reopened, evidence);
}
