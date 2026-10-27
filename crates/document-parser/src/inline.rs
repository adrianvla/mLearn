use super::*;
use xml::{Node, Piece};
pub(super) fn inline(
    node: &Node,
    text: &mut String,
    readings: &mut Vec<Reading>,
    anchors: &mut Vec<(String, usize)>,
    limits: Limits,
) -> Result<(), Error> {
    if !matches!(
        node.name.as_str(),
        "head" | "script" | "style" | "rt" | "rp"
    ) && let Some(id) = node.attrs.get("id")
    {
        anchors.push((id.clone(), text.len()));
    }
    match node.name.as_str() {
        "head" | "script" | "style" | "rt" | "rp" => return Ok(()),
        "rtc" | "table" | "math" | "audio" | "video" | "iframe" | "object" => {
            return Err(Error::Unsupported("complex XHTML content"));
        }
        "br" => {
            text.push('\n');
            return check(text.len(), limits.block_bytes, "canonical block bytes");
        }
        "ruby" => {
            let annotations: Vec<_> = node.elements().filter(|n| n.name == "rt").collect();
            if annotations.len() != 1
                || node.descendants("ruby").count() != 1
                || node
                    .descendants("*")
                    .any(|n| matches!(n.name.as_str(), "rtc" | "img" | "svg"))
            {
                return Err(Error::Unsupported("complex ruby grouping"));
            }
            let start = ByteOffset(text.len());
            for piece in &node.children {
                match piece {
                    Piece::Text(value) => text.push_str(value),
                    Piece::Element(child) => inline(child, text, readings, anchors, limits)?,
                }
            }
            let annotation = annotations
                .first()
                .ok_or_else(|| invalid("missing ruby reading"))?
                .text();
            check(annotation.len(), limits.block_bytes, "ruby bytes")?;
            readings.push(Reading {
                start,
                end: ByteOffset(text.len()),
                text: annotation,
            });
        }
        _ => {
            for piece in &node.children {
                match piece {
                    Piece::Text(value) => text.push_str(value),
                    Piece::Element(child) => inline(child, text, readings, anchors, limits)?,
                }
                check(text.len(), limits.block_bytes, "canonical block bytes")?;
            }
        }
    }
    check(text.len(), limits.block_bytes, "canonical block bytes")
}
