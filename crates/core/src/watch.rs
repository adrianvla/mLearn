//! Bounded source/linguistic protocol. Offsets are UTF-8 bytes into untouched cue text.
use serde::{Deserialize, Serialize};
macro_rules! model { ($name:ident { $($(#[$attr:meta])* $field:ident : $ty:ty),* $(,)? }) => {
 #[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
 #[serde(rename_all="camelCase")]
 #[cfg_attr(feature="typescript", derive(ts_rs::TS))]
 pub struct $name { $($(#[$attr])* pub $field: $ty),* }
}; }
fn normal_rate() -> f64 {
    1.0
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum InspectionTrigger {
    #[default]
    Click,
    Immediate,
    Delayed,
    Modifier,
}
model!(SourceRecord { id:String,title:String,media_path:String,media_revision:String,subtitle_path:Option<String>,subtitle_revision:Option<String>,package_id:String,package_version:String,position_ms:u32,duration_ms:u32,#[serde(default)] subtitle_offset_ms:i32,#[serde(default)] subtitle_offset_revision:u32,#[serde(default="normal_rate")] playback_rate:f64,#[serde(default)] inspection_trigger:InspectionTrigger });
model!(Cue {
    index: u32,
    start_ms: u32,
    end_ms: u32,
    text: String
});
model!(SourceWindow { source:SourceRecord,cues:Vec<Cue>,total_cues:u32 });
model!(CuePosition {
    source_id: String,
    subtitle_revision: String,
    cue_index: u32,
    position_ms: u32
});
model!(TranscriptPage { source_id:String,subtitle_revision:String,cues:Vec<Cue>,next_index:Option<u32> });
model!(Capability {
    id: String,
    label: String
});
model!(LevelScale {
    id: String,
    label: String,
    attribution: String
});
model!(InlineLevel {
    scale_id: String,
    level: String,
    label: String,
    rank: u32,
    attribution: String
});
model!(LanguageDescription { language:String,label:String,capabilities:Vec<Capability>,annotation_capability:String,attribution:String,
    #[serde(default,skip_serializing_if="Option::is_none")] #[cfg_attr(feature="typescript",ts(optional))] level_scales:Option<Vec<LevelScale>> });
// Packages own linguistic meaning. These bounded display values contain neither
// executable layout nor a core-maintained inventory of language-specific features.
model!(ReadingSpan {
    start: u32,
    end: u32,
    text: String,
    attribution: String,
    #[serde(default,skip_serializing_if="Option::is_none")]
    #[cfg_attr(feature="typescript",ts(optional))]
    base: Option<String>
});
model!(LinguisticLabel { id:String,label:String,color:Option<String>,attribution:String });
model!(ContourUnit {
    text: String,
    height: f64
});
model!(PronunciationContour { id:String,reading:String,units:Vec<ContourUnit>,following_height:Option<f64>,label:String,color:Option<String>,attribution:String });
model!(LinguisticPresentation { readings:Vec<ReadingSpan>,labels:Vec<LinguisticLabel>,contours:Vec<PronunciationContour>,
    #[serde(default,skip_serializing_if="Option::is_none")] #[cfg_attr(feature="typescript",ts(optional))] levels:Option<Vec<InlineLevel>> });
model!(AnalyzedToken { start:u32,end:u32,text:String,targets:Vec<String>,#[serde(default,skip_serializing_if="Option::is_none")] #[cfg_attr(feature="typescript",ts(optional))] presentation:Option<LinguisticPresentation>,#[serde(default,skip_serializing_if="Option::is_none")] #[cfg_attr(feature="typescript",ts(optional))] nearby_meaning:Option<bool> });
model!(CueAnalysis { cue:Cue,tokens:Vec<AnalyzedToken> });
model!(AnalysisBatch { source_id:String,subtitle_revision:String,package_id:String,package_version:String,package_revision:String,cues:Vec<CueAnalysis>,knowledge:Vec<KnowledgeProjection>,annotations:Vec<OccurrenceKnowledge> });
model!(LexicalSense { heading:String,labels:Vec<String>,definitions:Vec<String>,notes:Vec<String> });
// Absent structured detail remains readable for already installed ABI-v1 packages.
model!(LexicalEntry { target_id:String,headword:String,reading:Option<String>,part_of_speech:String,definition:String,summary:Option<String>,senses:Option<Vec<LexicalSense>>,attribution:String,capabilities:Vec<Capability>,#[serde(default,skip_serializing_if="Option::is_none")] #[cfg_attr(feature="typescript",ts(optional))] presentation:Option<LinguisticPresentation> });
model!(KnowledgeKey {
    package_id: String,
    target_id: String,
    capability: String
});
model!(KnowledgeProjection { key:KnowledgeKey,claim:Option<bool>,assessed:Option<bool>,prediction:Option<f64>,revision:u32,status:String });
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum AggregateClaim {
    Unavailable,
    Untracked,
    ClaimedKnown,
    ClaimedUnknown,
    Mixed,
}
model!(TargetKnowledge { projections:Vec<KnowledgeProjection>,claim:AggregateClaim });
model!(LexicalSummary { target_id:String,headword:String,reading:Option<String>,summary:String,presentation:Option<LinguisticPresentation> });
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum DictionaryResult {
    Available {
        summary: LexicalSummary,
    },
    Unavailable {
        #[serde(rename = "targetId")]
        target_id: String,
        message: String,
    },
}
model!(DictionaryBatch { source_id:String,subtitle_revision:String,package_id:String,package_version:String,package_revision:String,items:Vec<DictionaryResult> });
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum SubtitleDirection {
    Previous,
    Next,
}
model!(OccurrenceKnowledge {
    cue_index: u32,
    token_start: u32,
    status: String
});
model!(ClaimChange { key:KnowledgeKey,claim:Option<bool>,command_id:String });
