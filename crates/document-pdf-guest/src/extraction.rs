use crate::wire::*;
use lopdf::{Document, LoadOptions, Object, ObjectId};
use mlearn_language_sdk::Call;
use serde_json::Value;
use std::collections::BTreeSet;

// All lopdf allocations, font expansion, page-tree traversal and CPU execute
// inside Fresh's 64 MiB / 32M-fuel boundary, including eager object loading.
pub(crate) fn handle(call: Call) -> Result<Value, String> {
    if call.capability != CAPABILITY {
        return Err("unsupported document operation".into());
    }
    let request: Request = serde_json::from_value(call.input).map_err(|error| error.to_string())?;
    if request.pages > MAX_PAGES
        || request.objects > MAX_OBJECTS
        || request.stream_bytes > MAX_STREAM_BYTES
        || request.text_bytes > MAX_TEXT_BYTES
    {
        return Err("PDF request exceeds internal policy".into());
    }
    let bytes = mlearn_language_sdk::read_asset(ASSET)?;
    if !bytes.starts_with(b"%PDF-") {
        return Err("invalid PDF signature".into());
    }
    let pdf = Document::load_mem_with_options(
        &bytes,
        LoadOptions {
            strict: true,
            max_decompressed_size: Some(request.stream_bytes),
            ..LoadOptions::default()
        },
    )
    .map_err(|error| error.to_string())?;
    if pdf.was_encrypted() {
        return Err("encrypted PDF unsupported".into());
    }
    if pdf.objects.len() > request.objects {
        return Err("PDF object limit".into());
    }
    let pages: Vec<_> = pdf
        .page_iter()
        .take(request.pages.saturating_add(1))
        .collect();
    if pages.len() > request.pages {
        return Err("PDF page limit".into());
    }
    let reply = match request.operation {
        Operation::Metadata => Reply::Metadata {
            page_count: pages.len(),
        },
        Operation::Page { index } => {
            let id = *pages.get(index).ok_or("PDF page missing")?;
            let decoded = pdf
                .get_page_content_with_limit(id, request.stream_bytes)
                .map_err(|error| error.to_string())?;
            let page_number =
                u32::try_from(index.saturating_add(1)).map_err(|error| error.to_string())?;
            let text = pdf
                .extract_text_with_limit(&[page_number], request.stream_bytes)
                .map_err(|error| error.to_string())?;
            if text.len() > request.text_bytes {
                return Err("PDF page text limit".into());
            }
            Reply::Page(Page {
                index,
                object_id: id,
                media_box: page_box(&pdf, id, b"MediaBox")?,
                crop_box: page_box(&pdf, id, b"CropBox")?,
                rotation: inherited(&pdf, id, b"Rotate")?
                    .map(|v| v.as_i64().map_err(|e| e.to_string()))
                    .transpose()?,
                text,
                decoded_bytes: decoded.len(),
            })
        }
    };
    // 32 KiB worst-case JSON escaping plus metadata fits the SDK's 256 KiB envelope.
    serde_json::to_value(reply).map_err(|error| error.to_string())
}
fn inherited(pdf: &Document, mut id: ObjectId, key: &[u8]) -> Result<Option<Object>, String> {
    let mut seen = BTreeSet::new();
    loop {
        if !seen.insert(id) || seen.len() > 32 {
            return Err("cyclic or deep PDF page parents".into());
        }
        let dictionary = pdf.get_dictionary(id).map_err(|error| error.to_string())?;
        if let Ok(value) = dictionary.get(key) {
            return pdf
                .dereference(value)
                .map(|(_, value)| Some(value.clone()))
                .map_err(|error| error.to_string());
        }
        match dictionary.get(b"Parent") {
            Ok(parent) => id = parent.as_reference().map_err(|error| error.to_string())?,
            Err(_) => return Ok(None),
        }
    }
}
fn page_box(pdf: &Document, id: ObjectId, key: &[u8]) -> Result<Option<[f32; 4]>, String> {
    inherited(pdf, id, key)?
        .map(|value| {
            let values = value.as_array().map_err(|error| error.to_string())?;
            if values.len() != 4 {
                return Err("PDF box requires four numbers".into());
            }
            let mut result = [0.0; 4];
            for (slot, value) in result.iter_mut().zip(values) {
                *slot = value.as_float().map_err(|error| error.to_string())?;
                if !slot.is_finite() {
                    return Err("non-finite PDF box".into());
                }
            }
            Ok(result)
        })
        .transpose()
}
