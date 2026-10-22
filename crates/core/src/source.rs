//! Revision-bound return locations shared by inspection, capture and learning.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct SourceAnchor {
    pub source_id: String,
    pub content_revision: String,
    pub package_id: String,
    pub package_version: String,
    /// Untouched source text; authored context edits do not rewrite coordinates.
    pub text: String,
    pub locator: SourceLocator,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum SourceLocator {
    Video {
        #[serde(rename = "subtitleRevision")]
        subtitle_revision: Option<String>,
        #[serde(rename = "cueIndex")]
        cue_index: Option<u32>,
        #[serde(rename = "selectionStart")]
        selection_start: u32,
        #[serde(rename = "selectionEnd")]
        selection_end: u32,
        #[serde(rename = "positionMs")]
        position_ms: u32,
        #[serde(rename = "subtitleOffsetMs")]
        subtitle_offset_ms: i32,
        #[serde(rename = "playbackRate")]
        playback_rate: f64,
    },
}
