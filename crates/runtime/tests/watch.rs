use mlearn_runtime::{Runtime,BundledPlugin,catalog::Manifest};
use mlearn_language_host::CodePolicy;
use serde_json::{Value,json};
use std::{path::PathBuf,collections::BTreeMap};
fn bundles()->Vec<BundledPlugin>{
 let root=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/plugin-cdn");
 let manifests:Vec<Manifest>=serde_json::from_slice(&std::fs::read(root.join("bundle.json")).expect("npm run build:plugin first")).unwrap();
 manifests.into_iter().map(|manifest|{let code=std::fs::read(root.join(&manifest.code.path)).unwrap();let assets=manifest.assets.iter().map(|(key,artifact)|(key.clone(),std::fs::read(root.join(&artifact.path)).unwrap())).collect::<BTreeMap<_,_>>();BundledPlugin{manifest,code,assets}}).collect()
}
fn call(runtime:&mut Runtime,request:Value)->Value{let reply:Value=serde_json::from_str(&runtime.execute(&request.to_string())).unwrap();assert_ne!(reply["type"],"error","{}: {reply}",request["type"]);reply}
#[test]
fn real_wasm_dictionary_source_restart_claim_projection_and_recovery(){
 let dir=tempfile::tempdir().unwrap();let profile=dir.path().join("profile");
 let video=dir.path().join("synthetic.mp4");std::fs::write(&video,b"source identity fixture; playback is tested in consuming app").unwrap();
 let subs=dir.path().join("authored.srt");std::fs::write(&subs,"1\n00:00:00,000 --> 00:00:10,000\nChildren walked home.\n\n2\n00:00:10,000 --> 00:00:20,000\nChildren came home.\n").unwrap();
 let mut runtime=Runtime::open(&profile,CodePolicy::MobileBundled,None,bundles()).unwrap();
 let opened=call(&mut runtime,json!({"type":"open_source","path":video,"packageId":"org.mlearn.english"}));
 let id=opened["window"]["source"]["id"].as_str().unwrap().to_owned();
 call(&mut runtime,json!({"type":"attach_subtitles","sourceId":id,"path":subs}));
 let before=call(&mut runtime,json!({"type":"analyze_source","sourceId":id,"positionMs":0}));
 let token=&before["batch"]["cues"][0]["tokens"][0]; assert_eq!(token["text"],"Children");assert!(!token["targets"].as_array().unwrap().is_empty());
 assert_eq!(before["batch"]["cues"][1]["cue"]["text"],"Children came home.");
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
 let mut runtime=Runtime::open(&profile,CodePolicy::MobileBundled,None,bundles()).unwrap();
 let restored=call(&mut runtime,json!({"type":"resume_source","sourceId":id}));
 assert_eq!(restored["window"]["source"]["positionMs"],12345);assert_eq!(restored["window"]["source"]["packageId"],"org.mlearn.english");
 assert!(restored["window"]["source"]["subtitlePath"].as_str().unwrap().contains("imports"));
 // Unavailable source errors preserve the last saved record and its association.
 let imported=PathBuf::from(restored["window"]["source"]["mediaPath"].as_str().unwrap());std::fs::remove_file(imported).unwrap();
 let failed:Value=serde_json::from_str(&runtime.execute(&json!({"type":"resume_source","sourceId":id}).to_string())).unwrap();assert_eq!(failed["type"],"error");
 let recent=call(&mut runtime,json!({"type":"recent_sources"}));assert_eq!(recent["sources"][0]["positionMs"],12345);
 let recovered=call(&mut runtime,json!({"type":"open_source","path":video,"packageId":"org.mlearn.english"}));assert_eq!(recovered["window"]["source"]["id"],id);assert_eq!(recovered["window"]["source"]["positionMs"],12345);
}
