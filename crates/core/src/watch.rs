//! Bounded source/linguistic protocol. Offsets are UTF-8 bytes into untouched cue text.
use serde::{Deserialize, Serialize};
macro_rules! model { ($name:ident { $($field:ident : $ty:ty),* $(,)? }) => {
 #[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
 #[serde(rename_all="camelCase")]
 #[cfg_attr(feature="typescript", derive(ts_rs::TS))]
 pub struct $name { $(pub $field: $ty),* }
}; }
model!(SourceRecord { id:String,title:String,media_path:String,media_revision:String,subtitle_path:Option<String>,subtitle_revision:Option<String>,package_id:String,package_version:String,position_ms:u32,duration_ms:u32 });
model!(Cue { index:u32,start_ms:u32,end_ms:u32,text:String });
model!(SourceWindow { source:SourceRecord,cues:Vec<Cue>,total_cues:u32 });
model!(Capability { id:String,label:String });
model!(LanguageDescription { language:String,label:String,capabilities:Vec<Capability>,annotation_capability:String,attribution:String });
model!(AnalyzedToken { start:u32,end:u32,text:String,targets:Vec<String> });
model!(CueAnalysis { cue:Cue,tokens:Vec<AnalyzedToken> });
model!(AnalysisBatch { source_id:String,subtitle_revision:String,package_id:String,package_version:String,cues:Vec<CueAnalysis>,knowledge:Vec<KnowledgeProjection>,annotations:Vec<OccurrenceKnowledge> });
model!(LexicalSense { heading:String,labels:Vec<String>,definitions:Vec<String>,notes:Vec<String> });
// Absent structured detail remains readable for already installed ABI-v1 packages.
model!(LexicalEntry { target_id:String,headword:String,reading:Option<String>,part_of_speech:String,definition:String,summary:Option<String>,senses:Option<Vec<LexicalSense>>,attribution:String,capabilities:Vec<Capability> });
model!(KnowledgeKey { package_id:String,target_id:String,capability:String });
model!(KnowledgeProjection { key:KnowledgeKey,claim:Option<bool>,assessed:Option<bool>,prediction:Option<f64>,revision:u32,status:String });
model!(OccurrenceKnowledge { cue_index:u32,token_start:u32,status:String });
model!(ClaimChange { key:KnowledgeKey,claim:Option<bool>,command_id:String });
