use mlearn_language_host::CodePolicy;
use mlearn_runtime::{BundledPlugin, Runtime, catalog::Manifest};
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::PathBuf};

fn bundle() -> Vec<BundledPlugin> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/plugin-cdn");
    let manifests: Vec<Manifest> = serde_json::from_slice(&std::fs::read(root.join("bundle.json")).expect("Run offline tools/prepare-plugins.mjs first")).unwrap();
    let manifest = manifests.into_iter().find(|m| m.id == "org.mlearn.japanese").expect("Japanese bundle required");
    let code = std::fs::read(root.join(&manifest.code.path)).unwrap();
    let assets = manifest.assets.iter().map(|(key, artifact)| (key.clone(), std::fs::read(root.join(&artifact.path)).unwrap().into())).collect::<BTreeMap<_, _>>();
    vec![BundledPlugin { manifest, code, assets }]
}
fn call(runtime: &mut Runtime, request: Value) -> Value {
    let response: Value = serde_json::from_str(&runtime.execute(&request.to_string())).unwrap();
    assert_ne!(response["type"], "error", "{request}: {response}");
    response
}
#[test]
fn japanese_real_abi_claim_withdraw_restart_preserves_source_and_entries() {
    let dir = tempfile::tempdir().unwrap();
    let video = dir.path().join("authored.mp4");
    std::fs::write(&video, b"identity fixture; actual playback belongs to native consuming QA").unwrap();
    // Normal tests are offline and public/authored. Integration can supply the
    // original read-only SRT without committing the user's corpus.
    let subtitle = match std::env::var_os("MLEARN_JAPANESE_SRT") {
        Some(path) => PathBuf::from(path),
        None => {
            let path = dir.path().join("public.srt");
            std::fs::write(&path, "1\n00:00:11,200 --> 00:00:14,600\n昨日、食べました。\n\n2\n00:00:14,800 --> 00:00:17,200\n昨日の食事。\n").unwrap();
            path
        }
    };
    let profile = dir.path().join("profile");
    let mut runtime = Runtime::open(&profile, CodePolicy::MobileBundled, None, bundle()).unwrap();
    let katakana = call(&mut runtime, json!({
        "type":"invoke_plugin", "pluginId":"org.mlearn.japanese",
        "capability":"text.analyze.v1", "input":{"texts":["ｶﾞｯﾂﾎﾟｰｽﾞ"]}
    }));
    assert_eq!(katakana["output"][0], json!([
        {"start":0,"end":12,"text":"ｶﾞｯﾂ","targets":["jmdict:1040280"]},
        {"start":12,"end":27,"text":"ﾎﾟｰｽﾞ","targets":["jmdict:1124650","jmdict:2780530","jmdict:2858735"]}
    ]));
    for (target, reading) in [
        ("jmdict:1040280", "ガッツ"),
        ("jmdict:1124650", "ポーズ"),
        ("jmdict:2780530", "ポーズ"),
        ("jmdict:2858735", "ポーズ"),
    ] {
        let entry = call(&mut runtime, json!({"type":"inspect_target","packageId":"org.mlearn.japanese","targetId":target}));
        assert_eq!(entry["entry"]["targetId"], target);
        assert!(entry["entry"]["reading"].as_str().unwrap().split(" / ").any(|value| value == reading));
    }
    let source = call(&mut runtime, json!({"type":"open_source","path":video,"packageId":"org.mlearn.japanese"}));
    let id = source["window"]["source"]["id"].clone();
    call(&mut runtime, json!({"type":"attach_subtitles","sourceId":id,"path":subtitle}));
    let before = call(&mut runtime, json!({"type":"analyze_source","sourceId":id,"positionMs":12000}));
    for cue in before["batch"]["cues"].as_array().unwrap() {
        let text = cue["cue"]["text"].as_str().unwrap();
        let mut cursor = 0usize;
        for token in cue["tokens"].as_array().unwrap() {
            assert_eq!(token["start"], cursor);
            let end = token["end"].as_u64().unwrap() as usize;
            assert_eq!(&text[cursor..end], token["text"].as_str().unwrap());
            cursor = end;
        }
        assert_eq!(cursor, text.len());
    }
    let target = "jmdict:1579260"; // Actual pinned JMdict entry for 昨日, not a gloss hash.
    assert!(before["batch"]["cues"].as_array().unwrap().iter().flat_map(|c| c["tokens"].as_array().unwrap()).any(|t| t["targets"].as_array().unwrap().contains(&json!(target))));
    let entry = call(&mut runtime, json!({"type":"inspect_target","packageId":"org.mlearn.japanese","targetId":target}));
    assert_eq!(entry["entry"]["headword"], "昨日");
    assert!(entry["entry"]["reading"].as_str().unwrap().contains("きのう"));
    assert!(entry["entry"]["definition"].as_str().unwrap().contains("yesterday"));
    let senses = entry["entry"]["senses"].as_array().expect("JMdict sense groups must survive the package/runtime boundary");
    assert!(!senses.is_empty());
    assert!(senses.iter().all(|sense| sense["definitions"].as_array().is_some_and(|definitions| !definitions.is_empty())));
    let key = json!({"packageId":"org.mlearn.japanese","targetId":target,"capability":"org.mlearn.japanese:meaning"});
    let claim = json!({"type":"change_claim","change":{"key":key,"claim":true,"commandId":"japanese-claim-once"}});
    let claimed = call(&mut runtime, claim.clone());
    assert_eq!(claimed, call(&mut runtime, claim));
    let after = call(&mut runtime, json!({"type":"analyze_source","sourceId":id,"positionMs":12000}));
    assert_eq!(before["batch"]["cues"], after["batch"]["cues"]);
    call(&mut runtime, json!({"type":"save_position","sourceId":id,"positionMs":12345,"durationMs":140000}));
    drop(runtime);
    let mut runtime = Runtime::open(&profile, CodePolicy::MobileBundled, None, bundle()).unwrap();
    let resumed = call(&mut runtime, json!({"type":"resume_source","sourceId":id}));
    assert_eq!(resumed["window"]["source"]["positionMs"], 12345);
    assert_eq!(resumed["window"]["source"]["packageId"], "org.mlearn.japanese");
    assert_eq!(call(&mut runtime, json!({"type":"knowledge","keys":[key]}))["projections"][0]["claim"], true);
    let withdrawn = call(&mut runtime, json!({"type":"change_claim","change":{"key":key,"claim":null,"commandId":"japanese-withdraw-once"}}));
    assert_eq!(withdrawn["projection"]["claim"], Value::Null);
    drop(runtime);
    let mut runtime = Runtime::open(&profile, CodePolicy::MobileBundled, None, bundle()).unwrap();
    let restored = call(&mut runtime, json!({"type":"knowledge","keys":[key]}));
    assert_eq!(restored["projections"][0]["claim"], Value::Null);
    assert_eq!(restored["projections"][0]["assessed"], Value::Null);
    assert_eq!(restored["projections"][0]["prediction"], Value::Null);
    println!("JAPANESE_RUNTIME_PROOF source={} target={} restart_claim_withdraw=PASS", id, target);
}
