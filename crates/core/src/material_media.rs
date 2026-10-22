//! Authored assets have durable references, separate from regenerable caches.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct AuthoredMediaId(pub String);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum MaterialMediaKind {
    Image,
    Audio,
    Video,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MediaSegment {
    pub source_id: String,
    pub content_revision: String,
    pub start_ms: u32,
    pub end_ms: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct AuthoredMedia {
    pub id: AuthoredMediaId,
    pub kind: MaterialMediaKind,
    pub name: String,
    pub mime_type: String,
    pub byte_length: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MaterialAttachment {
    pub media_id: AuthoredMediaId,
    /// Origin belongs to this use of the bytes, not the shared asset.
    pub segment: Option<MediaSegment>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum MediaCaptureSelection {
    Frame {
        #[serde(rename = "positionMs")]
        position_ms: u32,
    },
    Audio {
        #[serde(rename = "startMs")]
        start_ms: u32,
        #[serde(rename = "endMs")]
        end_ms: u32,
    },
    Video {
        #[serde(rename = "startMs")]
        start_ms: u32,
        #[serde(rename = "endMs")]
        end_ms: u32,
    },
    Cue {
        #[serde(rename = "subtitleRevision")]
        subtitle_revision: String,
        #[serde(rename = "cueIndex")]
        cue_index: u32,
        #[serde(rename = "mediaKind")]
        media_kind: MaterialMediaKind,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MediaCaptureRequest {
    pub source_id: String,
    pub content_revision: String,
    pub selection: MediaCaptureSelection,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MediaCapturePlan {
    pub source_id: String,
    pub content_revision: String,
    pub path: String,
    pub kind: MaterialMediaKind,
    pub start_ms: u32,
    pub end_ms: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CapturedMediaFile {
    pub path: String,
    pub kind: MaterialMediaKind,
    pub name: String,
    pub segment: MediaSegment,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MaterialMediaImport {
    pub path: String,
    pub kind: MaterialMediaKind,
    pub name: String,
    pub segment: Option<MediaSegment>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MaterialMediaLocation {
    pub media: AuthoredMedia,
    pub path: String,
}
