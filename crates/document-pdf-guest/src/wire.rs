use serde::{Deserialize, Serialize};

pub const CAPABILITY: &str = "document.pdf.v1";
pub const ASSET: &str = "document";
pub const MAX_PAGES: usize = 64;
pub const MAX_TEXT_BYTES: usize = 32 * 1024;
pub const MAX_STREAM_BYTES: usize = 512 * 1024;
pub const MAX_OBJECTS: usize = 8192;

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub operation: Operation,
    pub pages: usize,
    pub objects: usize,
    pub stream_bytes: usize,
    pub text_bytes: usize,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Operation {
    Metadata,
    Page { index: usize },
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Reply {
    Metadata { page_count: usize },
    Page(Page),
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Page {
    pub index: usize,
    pub object_id: (u32, u16),
    pub media_box: Option<[f32; 4]>,
    pub crop_box: Option<[f32; 4]>,
    pub rotation: Option<i64>,
    pub text: String,
    pub decoded_bytes: usize,
}
