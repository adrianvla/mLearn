use mlearn_core::{SourceRecord, ClaimChange, KnowledgeKey};
use mlearn_storage::{ProfileStore, SourceReader};
fn source() -> SourceRecord { SourceRecord { id:"content-sha".into(), title:"Local video".into(), media_path:"/isolated/movie.mp4".into(), media_revision:"sha".into(), subtitle_path:None, subtitle_revision:None, package_id:"org.mlearn.english".into(), package_version:"1".into(), position_ms:12345, duration_ms:30000 } }
#[test]
fn exact_resume_and_claim_retry_preserve_untracked_semantics() {
 let dir=tempfile::tempdir().unwrap(); let db=dir.path().join("profile.sqlite3");
 let key=KnowledgeKey{package_id:"org.mlearn.english".into(),target_id:"wn30:dog:n".into(),capability:"org.mlearn.english:meaning".into()};
 let mut store=ProfileStore::open(&db).unwrap();
 store.save_source(&source()).unwrap(); store.save_source(&source()).unwrap();
 assert_eq!(store.recents().unwrap().len(),1);
 let initial=store.knowledge(std::slice::from_ref(&key)).unwrap();
 assert_eq!(initial[0].claim,None); assert_eq!(initial[0].assessed,None);
 let change=ClaimChange{ key:key.clone(),claim:Some(true),command_id:"first".into() };
 let receipt=store.change_claim(&change).unwrap();
 assert_eq!(store.change_claim(&change).unwrap().revision,receipt.revision);
 assert!(store.change_claim(&ClaimChange{claim:Some(false),..change.clone()}).is_err());
 drop(store);
 let mut reopened=ProfileStore::open(&db).unwrap();
 assert_eq!(reopened.source("content-sha").unwrap().position_ms,12345);
 let projected=reopened.knowledge(std::slice::from_ref(&key)).unwrap();
 assert_eq!(projected[0].claim,Some(true)); assert_eq!(projected[0].assessed,None);
 reopened.change_claim(&ClaimChange{key:key.clone(),claim:None,command_id:"withdraw".into()}).unwrap();
 let projected=reopened.knowledge(&[key]).unwrap(); assert_eq!(projected[0].claim,None); assert_eq!(projected[0].assessed,None);
}
#[test]
fn overlapping_cues_keep_their_original_spans_in_a_bounded_window(){
 let dir=tempfile::tempdir().unwrap();let mut store=ProfileStore::open(&dir.path().join("p.sqlite")).unwrap();let source=source();store.save_source(&source).unwrap();
 let cues=(0..8).map(|i|mlearn_core::Cue{index:i,start_ms:i*1000,end_ms:20000,text:format!("line {i}")}).collect::<Vec<_>>();store.attach_cues(&source,&cues).unwrap();
 let (window,total)=store.cue_window(&source.id,7500).unwrap();assert_eq!(total,8);assert_eq!(window.len(),8);assert_eq!(window[0].text,"line 0");
}

#[test]
fn media_reader_observes_committed_source_reselection_without_a_cache() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("profile.sqlite3");
    let writer = ProfileStore::open(&path).unwrap();
    let mut selected = source();
    writer.save_source(&selected).unwrap();
    let reader = SourceReader::open(&path).unwrap();
    assert_eq!(reader.source(&selected.id).unwrap().media_path, selected.media_path);
    // When the canonical owner commits a different location for the same source.
    selected.media_path = "/isolated/reselected.mp4".into();
    writer.save_source(&selected).unwrap();
    // Then the independent reader sees it without activation or invalidation work.
    assert_eq!(reader.source(&selected.id).unwrap().media_path, selected.media_path);
    assert!(reader.source("not-admitted").is_err());
}
