use mlearn_runtime::{Runtime,BundledPlugin,catalog::Manifest};
use mlearn_language_host::CodePolicy;
use serde_json::{Value,json};
use std::{path::PathBuf,collections::BTreeMap};
fn bundles()->Vec<BundledPlugin>{
 bundles_for(&["org.mlearn.english"])
}
fn bundles_for(ids:&[&str])->Vec<BundledPlugin>{
 let root=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/plugin-cdn");
 let manifests:Vec<Manifest>=serde_json::from_slice(&std::fs::read(root.join("bundle.json")).expect("npm run build:plugin first")).unwrap();
 manifests.into_iter().filter(|m|ids.contains(&m.id.as_str())).map(|manifest|{let code=std::fs::read(root.join(&manifest.code.path)).unwrap();let assets=manifest.assets.iter().map(|(key,artifact)|(key.clone(),std::fs::read(root.join(&artifact.path)).unwrap().into())).collect::<BTreeMap<_,_>>();BundledPlugin{manifest,code,assets}}).collect()
}
fn call(runtime:&mut Runtime,request:Value)->Value{let reply:Value=serde_json::from_str(&runtime.execute(&request.to_string())).unwrap();assert_ne!(reply["type"],"error","{}: {reply}",request["type"]);reply}
#[test]
fn real_wasm_dictionary_source_restart_claim_projection_and_recovery(){
 let dir=tempfile::tempdir().unwrap();let profile=dir.path().join("profile");
 let video=dir.path().join("synthetic.mp4");std::fs::write(&video,b"source identity fixture; playback is tested in consuming app").unwrap();
 let subs=dir.path().join("authored.srt");std::fs::write(&subs,"1\n00:00:00,000 --> 00:00:10,000\nChildren walked home.\n\n2\n00:00:10,000 --> 00:00:20,000\nChildren came\nhome.\n").unwrap();
 let mut runtime=Runtime::open(&profile,CodePolicy::MobileBundled,None,bundles()).unwrap();
 let opened=call(&mut runtime,json!({"type":"open_source","path":video,"packageId":"org.mlearn.english"}));
 let id=opened["window"]["source"]["id"].as_str().unwrap().to_owned();
 call(&mut runtime,json!({"type":"attach_subtitles","sourceId":id,"path":subs}));
 let before=call(&mut runtime,json!({"type":"analyze_source","sourceId":id,"positionMs":0}));
 let token=&before["batch"]["cues"][0]["tokens"][0]; assert_eq!(token["text"],"Children");assert!(!token["targets"].as_array().unwrap().is_empty());
 assert_eq!(before["batch"]["cues"][1]["cue"]["text"],"Children came\nhome.");
 assert_eq!(before["batch"]["cues"][1]["tokens"][0]["targets"],token["targets"]);
 let projections=before["batch"]["knowledge"].as_array().unwrap();
 let distinct=projections.iter().map(|p|p["key"].to_string()).collect::<std::collections::BTreeSet<_>>();
 assert_eq!(distinct.len(),projections.len(),"Knowledge is deduplicated across occurrences");
 let target=token["targets"][0].as_str().unwrap();
 let entry=call(&mut runtime,json!({"type":"inspect_target","packageId":"org.mlearn.english","targetId":target}));assert_eq!(entry["entry"]["headword"],"child");assert!(entry["entry"]["definition"].as_str().unwrap().len()>10);
 let key=json!({"packageId":"org.mlearn.english","targetId":target,"capability":"org.mlearn.english:meaning"});
 let request=json!({"type":"change_claim","change":{"key":key,"claim":true,"commandId":"claim-once"}});
 let claimed=call(&mut runtime,request.clone());assert_eq!(call(&mut runtime,request),claimed);
 let after=call(&mut runtime,json!({"type":"analyze_source","sourceId":id,"positionMs":0}));
 assert_eq!(before["batch"]["cues"],after["batch"]["cues"]);
 let state=after["batch"]["knowledge"].as_array().unwrap().iter().find(|p|p["key"]==key).unwrap(); assert_eq!(state["claim"],true);assert_eq!(state["assessed"],Value::Null);assert_eq!(state["prediction"],Value::Null);
 call(&mut runtime,json!({"type":"save_position","sourceId":id,"positionMs":12345,"durationMs":20000}));
 drop(runtime);
 // iOS can relocate the data container on app updates. Owned imports must follow
 // the profile, while the source identity, claims and exact checkpoint survive.
 let relocated=dir.path().join("relocated-profile");std::fs::rename(&profile,&relocated).unwrap();let profile=relocated;
 let mut runtime=Runtime::open(&profile,CodePolicy::MobileBundled,None,bundles()).unwrap();
 let restored=call(&mut runtime,json!({"type":"resume_source","sourceId":id}));
 assert_eq!(restored["window"]["source"]["positionMs"],12345);assert_eq!(restored["window"]["source"]["packageId"],"org.mlearn.english");
 assert!(restored["window"]["source"]["subtitlePath"].as_str().unwrap().contains("imports"));
 let persisted=call(&mut runtime,json!({"type":"knowledge","keys":[key]}));assert_eq!(persisted["projections"][0]["claim"],true);
 // Unavailable source errors preserve the last saved record and its association.
 let imported=PathBuf::from(restored["window"]["source"]["mediaPath"].as_str().unwrap());std::fs::remove_file(imported).unwrap();
 let failed:Value=serde_json::from_str(&runtime.execute(&json!({"type":"resume_source","sourceId":id}).to_string())).unwrap();assert_eq!(failed["type"],"error");
 let recent=call(&mut runtime,json!({"type":"recent_sources"}));assert_eq!(recent["sources"][0]["positionMs"],12345);
 let recovered=call(&mut runtime,json!({"type":"open_source","path":video,"packageId":"org.mlearn.english"}));assert_eq!(recovered["window"]["source"]["id"],id);assert_eq!(recovered["window"]["source"]["positionMs"],12345);
}

#[test]
fn subtitle_clock_and_playback_rate_persist_without_rewriting_authored_cues() {
 let dir=tempfile::tempdir().unwrap();
 let video=dir.path().join("timing.mp4");std::fs::write(&video,b"timing source identity").unwrap();
 let subs=dir.path().join("timing.srt");
 std::fs::write(&subs,"1\n00:00:00,000 --> 00:00:01,000\nChildren\n\n2\n00:00:01,000 --> 00:00:02,000\ncame home.\n\n3\n00:00:02,000 --> 00:00:03,000\nChildren came home.\n").unwrap();
 let profile=dir.path().join("profile");
 let mut runtime=Runtime::open(&profile,CodePolicy::MobileBundled,None,bundles()).unwrap();
 let opened=call(&mut runtime,json!({"type":"open_source","path":video,"packageId":"org.mlearn.english"}));
 let id=opened["window"]["source"]["id"].as_str().unwrap().to_owned();
 let original=call(&mut runtime,json!({"type":"attach_subtitles","sourceId":id,"path":subs}));
 let original_revision=original["window"]["source"]["subtitleRevision"].clone();
 call(&mut runtime,json!({"type":"save_position","sourceId":id,"positionMs":0,"durationMs":3000}));
 let shifted=call(&mut runtime,json!({"type":"set_subtitle_offset","sourceId":id,"offsetMs":2000}));
 assert_eq!(shifted["window"]["cues"][0]["index"],1);
 assert_eq!(shifted["window"]["cues"][1]["startMs"],2000);
 let analyzed=call(&mut runtime,json!({"type":"analyze_source","sourceId":id,"positionMs":0}));
 assert_eq!(analyzed["batch"]["cues"][1]["cue"]["text"],"Children came home.");
 assert_eq!(analyzed["batch"]["cues"][1]["cue"]["startMs"],2000);
 let target=call(&mut runtime,json!({"type":"cue_position","sourceId":id,"subtitleRevision":original_revision,"cueIndex":2}));
 assert_eq!(target["position"]["positionMs"],0);
 let before_video:Value=serde_json::from_str(&runtime.execute(&json!({"type":"cue_position","sourceId":id,"subtitleRevision":original_revision,"cueIndex":0}).to_string())).unwrap();
 assert_eq!(before_video["type"],"error");
 call(&mut runtime,json!({"type":"set_playback_rate","sourceId":id,"rate":1.25}));
 for invalid in [json!({"type":"set_subtitle_offset","sourceId":id,"offsetMs":86400001}),json!({"type":"set_playback_rate","sourceId":id,"rate":0})] {
  let rejected:Value=serde_json::from_str(&runtime.execute(&invalid.to_string())).unwrap();
  assert_eq!(rejected["type"],"error");
 }
 drop(runtime);
 let mut runtime=Runtime::open(&profile,CodePolicy::MobileBundled,None,bundles()).unwrap();
 let resumed=call(&mut runtime,json!({"type":"resume_source","sourceId":id}));
 assert_eq!(resumed["window"]["source"]["subtitleOffsetMs"],2000);
 assert_eq!(resumed["window"]["source"]["playbackRate"],1.25);
 assert_eq!(resumed["window"]["source"]["subtitleRevision"],original_revision);
 call(&mut runtime,json!({"type":"set_subtitle_offset","sourceId":id,"offsetMs":-2000}));
 let target=call(&mut runtime,json!({"type":"cue_position","sourceId":id,"subtitleRevision":original_revision,"cueIndex":0}));
 assert_eq!(target["position"]["positionMs"],2000);
 for invalid in [json!({"type":"cue_position","sourceId":id,"subtitleRevision":original_revision,"cueIndex":2}),json!({"type":"cue_position","sourceId":id,"subtitleRevision":"stale-association","cueIndex":0})] {
  let response:Value=serde_json::from_str(&runtime.execute(&invalid.to_string())).unwrap();
  assert_eq!(response["type"],"error");
 }
 let negative=call(&mut runtime,json!({"type":"source_window","sourceId":id,"positionMs":3000}));
 assert_eq!(negative["window"]["cues"][1]["index"],1);
 let reset=call(&mut runtime,json!({"type":"set_subtitle_offset","sourceId":id,"offsetMs":0}));
 assert_eq!(reset["window"]["cues"],original["window"]["cues"]);
 call(&mut runtime,json!({"type":"set_subtitle_offset","sourceId":id,"offsetMs":1000}));
 let replaced=call(&mut runtime,json!({"type":"attach_subtitles","sourceId":id,"path":subs}));
 assert_eq!(replaced["window"]["source"]["subtitleOffsetMs"],0);
 assert_eq!(replaced["window"]["source"]["playbackRate"],1.25);
 // Persisted pre-M02 documents receive neutral defaults, not a changed clock/rate.
 let mut old=replaced["window"]["source"].clone();
 old.as_object_mut().unwrap().remove("subtitleOffsetMs");
 old.as_object_mut().unwrap().remove("playbackRate");
 old.as_object_mut().unwrap().remove("inspectionTrigger");
 let old:mlearn_core::SourceRecord=serde_json::from_value(old).unwrap();
 assert_eq!(old.subtitle_offset_ms,0);assert_eq!(old.playback_rate,1.0);
 assert_eq!(old.inspection_trigger,mlearn_core::InspectionTrigger::Click);
}

#[test]
fn failed_preference_window_does_not_commit_a_partial_source_change() {
 let dir=tempfile::tempdir().unwrap();let profile=dir.path().join("profile");
 let video=dir.path().join("overlap.mp4");std::fs::write(&video,b"overlap source identity").unwrap();
 let subs=dir.path().join("overlap.srt");
 let mut authored="1\n00:00:00,000 --> 00:00:01,000\nChildren\n\n".to_owned();
 for index in 2..=18 {authored.push_str(&format!("{index}\n00:01:00,000 --> 00:01:10,000\nChildren\n\n"));}
 std::fs::write(&subs,authored).unwrap();
 let mut runtime=Runtime::open(&profile,CodePolicy::MobileBundled,None,bundles()).unwrap();
 let opened=call(&mut runtime,json!({"type":"open_source","path":video,"packageId":"org.mlearn.english"}));
 let id=opened["window"]["source"]["id"].as_str().unwrap().to_owned();
 let before=call(&mut runtime,json!({"type":"attach_subtitles","sourceId":id,"path":subs}));
 let failed:Value=serde_json::from_str(&runtime.execute(&json!({"type":"set_subtitle_offset","sourceId":id,"offsetMs":60000}).to_string())).unwrap();
 assert_eq!(failed["type"],"error");
 let recent=call(&mut runtime,json!({"type":"recent_sources"}));
 assert_eq!(recent["sources"][0],before["window"]["source"],"A failed response must not commit its offset");
 // Existing playback can reach an over-budget overlap. Other preference changes
 // must likewise validate their response before changing durable source metadata.
 call(&mut runtime,json!({"type":"save_position","sourceId":id,"positionMs":60000,"durationMs":120000}));
 let saved=call(&mut runtime,json!({"type":"recent_sources"}))["sources"][0].clone();
 for request in [
  json!({"type":"set_playback_rate","sourceId":id,"rate":1.25}),
  json!({"type":"set_inspection_trigger","sourceId":id,"trigger":"delayed"}),
  json!({"type":"set_source_language","sourceId":id,"packageId":"org.mlearn.english"}),
 ] {
  let result:Value=serde_json::from_str(&runtime.execute(&request.to_string())).unwrap();
  assert_eq!(result["type"],"error");
  assert_eq!(call(&mut runtime,json!({"type":"recent_sources"}))["sources"][0],saved);
 }
}

#[test]
fn transcript_pages_and_literal_search_preserve_exact_source_text() {
 let dir=tempfile::tempdir().unwrap();
 let video=dir.path().join("transcript.mp4");std::fs::write(&video,b"transcript source identity").unwrap();
 let subs=dir.path().join("transcript.srt");
 let text=" e\u{301} 日本語 %_ ' Children";
 let authored=(0..60).map(|i|format!("{}\n00:{:02}:{:02},000 --> 00:{:02}:{:02},500\n{text}\n",i+1,i/60,i%60,i/60,i%60)).collect::<Vec<_>>().join("\n");
 std::fs::write(&subs,authored).unwrap();
 let mut runtime=Runtime::open(&dir.path().join("profile"),CodePolicy::MobileBundled,None,bundles()).unwrap();
 let opened=call(&mut runtime,json!({"type":"open_source","path":video,"packageId":"org.mlearn.english"}));
 let id=opened["window"]["source"]["id"].as_str().unwrap().to_owned();
 call(&mut runtime,json!({"type":"attach_subtitles","sourceId":id,"path":subs}));
 let mut after=Value::Null;let mut indices=Vec::new();
 loop {
  let result=call(&mut runtime,json!({"type":"transcript","sourceId":id,"afterIndex":after,"query":""}));
  let page=&result["page"];
  let cues=page["cues"].as_array().unwrap();assert!(cues.len()<=16);
  for cue in cues {assert_eq!(cue["text"],text);indices.push(cue["index"].as_u64().unwrap());}
  after=page["nextIndex"].clone();if after.is_null(){break;}
 }
 assert_eq!(indices,(0..60).collect::<Vec<_>>());
 let literal=call(&mut runtime,json!({"type":"transcript","sourceId":id,"afterIndex":null,"query":"%_ '"}));
 assert_eq!(literal["page"]["cues"].as_array().unwrap().len(),16);
 let missing=call(&mut runtime,json!({"type":"transcript","sourceId":id,"afterIndex":null,"query":"not in this source"}));
 assert!(missing["page"]["cues"].as_array().unwrap().is_empty());
 let invalid:Value=serde_json::from_str(&runtime.execute(&json!({"type":"transcript","sourceId":id,"afterIndex":null,"query":"x".repeat(129)}).to_string())).unwrap();
 assert_eq!(invalid["type"],"error");
 let analyzed=call(&mut runtime,json!({"type":"analyze_transcript","sourceId":id,"afterIndex":15,"query":""}));
 assert_eq!(analyzed["batch"]["cues"].as_array().unwrap().len(),16);
 assert_eq!(analyzed["batch"]["cues"][0]["cue"]["index"],16);
 let token=analyzed["batch"]["cues"][0]["tokens"].as_array().unwrap().iter().find(|token|token["text"]=="Children").unwrap();
 let key=json!({"packageId":"org.mlearn.english","targetId":token["targets"][0],"capability":"org.mlearn.english:meaning"});
 call(&mut runtime,json!({"type":"change_claim","change":{"key":key,"claim":true,"commandId":"from-transcript"}}));
 let refreshed=call(&mut runtime,json!({"type":"analyze_transcript","sourceId":id,"afterIndex":15,"query":""}));
 assert_eq!(refreshed["batch"]["cues"],analyzed["batch"]["cues"],"Knowledge refresh must preserve exact authored spans");
 assert_eq!(refreshed["batch"]["knowledge"].as_array().unwrap().iter().find(|p|p["key"]==key).unwrap()["claim"],true);
 let video=call(&mut runtime,json!({"type":"analyze_source","sourceId":id,"positionMs":16500}));
 assert_eq!(video["batch"]["knowledge"].as_array().unwrap().iter().find(|p|p["key"]==key).unwrap()["claim"],true);
}

#[test]
fn two_sources_keep_independent_language_and_inspection_preferences_across_restart() {
 let dir=tempfile::tempdir().unwrap();let profile=dir.path().join("profile");
 let mut runtime=Runtime::open(&profile,CodePolicy::MobileBundled,None,bundles_for(&["org.mlearn.english","org.mlearn.japanese"])).unwrap();
 let subtitle=dir.path().join("context.srt");
 std::fs::write(&subtitle,"1\n00:00:00,000 --> 00:00:10,000\nChildren 度胸(どきょう)\n").unwrap();
 let mut ids=Vec::new();
 for index in 0..2 {
  let video=dir.path().join(format!("source-{index}.mp4"));
  std::fs::write(&video,format!("independent source {index}")).unwrap();
  let source=call(&mut runtime,json!({"type":"open_source","path":video,"packageId":"org.mlearn.english"}));
  let id=source["window"]["source"]["id"].as_str().unwrap().to_owned();
  call(&mut runtime,json!({"type":"attach_subtitles","sourceId":id,"path":subtitle}));
  ids.push(id);
 }
 let english=call(&mut runtime,json!({"type":"analyze_source","sourceId":ids[1],"positionMs":0}));
 let target=english["batch"]["cues"][0]["tokens"][0]["targets"][0].as_str().unwrap();
 let key=json!({"packageId":"org.mlearn.english","targetId":target,"capability":"org.mlearn.english:meaning"});
 call(&mut runtime,json!({"type":"change_claim","change":{"key":key,"claim":true,"commandId":"context-claim"}}));
 let changed=call(&mut runtime,json!({"type":"set_source_language","sourceId":ids[0],"packageId":"org.mlearn.japanese"}));
 assert_eq!(changed["window"]["source"]["id"],ids[0]);
 assert_eq!(changed["window"]["source"]["packageId"],"org.mlearn.japanese");
 let japanese=call(&mut runtime,json!({"type":"analyze_source","sourceId":ids[0],"positionMs":0}));
 assert!(japanese["batch"]["cues"][0]["tokens"].as_array().unwrap().iter().any(|token|
  token["text"].as_str().unwrap().starts_with("度胸") && !token["targets"].as_array().unwrap().is_empty()));
 call(&mut runtime,json!({"type":"set_inspection_trigger","sourceId":ids[0],"trigger":"delayed"}));
 for invalid in [json!({"type":"set_source_language","sourceId":ids[0],"packageId":"not.installed"}),json!({"type":"set_inspection_trigger","sourceId":ids[0],"trigger":"unsupported"})] {
  let result:Value=serde_json::from_str(&runtime.execute(&invalid.to_string())).unwrap();
  assert_eq!(result["type"],"error");
 }
 drop(runtime);
 let mut runtime=Runtime::open(&profile,CodePolicy::MobileBundled,None,bundles_for(&["org.mlearn.english","org.mlearn.japanese"])).unwrap();
 let first=call(&mut runtime,json!({"type":"resume_source","sourceId":ids[0]}));
 let second=call(&mut runtime,json!({"type":"resume_source","sourceId":ids[1]}));
 assert_eq!(first["window"]["source"]["packageId"],"org.mlearn.japanese");
 assert_eq!(first["window"]["source"]["inspectionTrigger"],"delayed");
 assert_eq!(second["window"]["source"]["packageId"],"org.mlearn.english");
 assert_eq!(second["window"]["source"]["inspectionTrigger"],"click");
 let retained=call(&mut runtime,json!({"type":"knowledge","keys":[key]}));
 assert_eq!(retained["projections"][0]["claim"],true);
 assert_eq!(retained["projections"][0]["revision"],1);
}
