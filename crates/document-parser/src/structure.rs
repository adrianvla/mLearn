use super::*;
use crate::inline::inline;
use archive::{Archive, resolve};
use xml::{Node, Piece};

pub(super) fn collect_blocks(
    node: &Node,
    resource: &str,
    limits: Limits,
    document: &mut Document,
    archive: &Archive,
    anchors: &mut BTreeMap<String, (String, usize)>,
) -> Result<Option<WritingMode>, Error> {
    let styles = writing::Styles::read(node, resource, archive)?;
    let root = node
        .elements()
        .next()
        .ok_or_else(|| invalid("missing XHTML root"))?;
    let mode = styles.mode(root, None)?;
    Flow {
        resource,
        limits,
        document,
        archive,
        styles: &styles,
        mode: None,
        anchors,
        pending: Vec::new(),
    }
    .walk(node)?;
    Ok(mode)
}

struct Flow<'a> {
    resource: &'a str,
    limits: Limits,
    document: &'a mut Document,
    archive: &'a Archive,
    styles: &'a writing::Styles,
    mode: Option<WritingMode>,
    anchors: &'a mut BTreeMap<String, (String, usize)>,
    pending: Vec<String>,
}
fn structural(name: &str) -> bool {
    matches!(
        name,
        "html"
            | "body"
            | "section"
            | "article"
            | "div"
            | "p"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "li"
            | "ol"
            | "ul"
            | "blockquote"
            | "figure"
            | "figcaption"
            | "pre"
            | "dl"
            | "dt"
            | "dd"
    )
}
fn node_id(node: &Node) -> String {
    node.attrs
        .get("id")
        .cloned()
        .unwrap_or_else(|| format!("xml-byte:{}", node.start))
}
impl Flow<'_> {
    fn push(&mut self, mut value: Block) -> Result<(), Error> {
        check(
            self.document.blocks.len().saturating_add(1),
            self.limits.blocks,
            "blocks",
        )?;
        check(
            value.text.len(),
            self.limits.block_bytes,
            "canonical block bytes",
        )?;
        value.writing_mode = self.mode;
        for id in self.pending.drain(..) {
            self.anchors.insert(id, (value.id.clone(), 0));
        }
        self.document.blocks.push(value);
        Ok(())
    }
    fn walk(&mut self, node: &Node) -> Result<(), Error> {
        if !matches!(node.name.as_str(), "head" | "script" | "style")
            && let Some(id) = node.attrs.get("id")
        {
            self.pending.push(id.clone());
        }
        let inherited = self.mode;
        self.mode = self.styles.mode(node, inherited)?;
        let result = self.walk_contents(node);
        self.mode = inherited;
        result
    }
    fn walk_contents(&mut self, node: &Node) -> Result<(), Error> {
        match node.name.as_str() {
            "head" | "script" | "style" => return Ok(()),
            "table" | "math" | "audio" | "video" | "iframe" | "object" | "switch" => {
                return Err(Error::Unsupported("complex XHTML content"));
            }
            "img" | "svg" => return self.image(node),
            "rtc" => return Err(Error::Unsupported("complex ruby grouping")),
            "ruby" => {
                let mut text = String::new();
                let mut readings = Vec::new();
                let mut anchors = Vec::new();
                inline(node, &mut text, &mut readings, &mut anchors, self.limits)?;
                self.flush(node, &mut text, &mut readings, &mut anchors, 0)?;
                return Ok(());
            }
            _ => {}
        }
        let mut text = String::new();
        let mut readings = Vec::new();
        let mut anchors = Vec::new();
        let mut offset = 0usize;
        for piece in &node.children {
            match piece {
                Piece::Text(value) => text.push_str(value),
                Piece::Element(child)
                    if structural(&child.name) || matches!(child.name.as_str(), "img" | "svg") =>
                {
                    offset = self.flush(node, &mut text, &mut readings, &mut anchors, offset)?;
                    self.walk(child)?;
                }
                Piece::Element(child) => {
                    // A span/link may wrap an image or block; recurse without flattening it.
                    if child
                        .descendants("*")
                        .any(|n| structural(&n.name) || matches!(n.name.as_str(), "img" | "svg"))
                        || self.styles.mode(child, self.mode)? != self.mode
                    {
                        offset =
                            self.flush(node, &mut text, &mut readings, &mut anchors, offset)?;
                        self.walk(child)?;
                    } else {
                        inline(child, &mut text, &mut readings, &mut anchors, self.limits)?;
                    }
                }
            }
            check(text.len(), self.limits.block_bytes, "canonical block bytes")?;
        }
        self.flush(node, &mut text, &mut readings, &mut anchors, offset)?;
        Ok(())
    }
    fn flush(
        &mut self,
        node: &Node,
        text: &mut String,
        readings: &mut Vec<Reading>,
        anchors: &mut Vec<(String, usize)>,
        offset: usize,
    ) -> Result<usize, Error> {
        let length = text.len();
        // Inter-element indentation has no authored reading content.
        if text.trim().is_empty() && node.name != "pre" {
            text.clear();
            readings.clear();
            self.pending.extend(anchors.drain(..).map(|(id, _)| id));
            return Ok(offset.saturating_add(length));
        }
        let id = if offset == 0 {
            node_id(node)
        } else {
            format!("{}::text-byte:{offset}", node_id(node))
        };
        self.push(block(
            self.resource,
            id.clone(),
            &node.name,
            std::mem::take(text),
            Some(Span {
                start: ByteOffset(node.start),
                end: ByteOffset(node.end),
            }),
            std::mem::take(readings),
        ))?;
        for (anchor, offset) in anchors.drain(..) {
            self.anchors.insert(anchor, (id.clone(), offset));
        }
        Ok(offset.saturating_add(length))
    }
    fn image(&mut self, node: &Node) -> Result<(), Error> {
        let (resource, media_type, bytes) = match node.name.as_str() {
            "img" => {
                let resource = resolve(self.resource, node.attr("src")?)?;
                let bytes = self
                    .archive
                    .files
                    .get(&resource)
                    .ok_or_else(|| invalid("missing image resource"))?;
                let media_type = self
                    .document
                    .images
                    .iter()
                    .find(|image| image.resource == resource)
                    .map(|image| image.media_type.as_str())
                    .ok_or_else(|| invalid("image absent from manifest"))?;
                (resource, media_type.to_owned(), bytes.clone())
            }
            "svg" => {
                let chapter = self
                    .archive
                    .files
                    .get(self.resource)
                    .ok_or_else(|| invalid("missing SVG source"))?;
                let bytes = chapter
                    .get(node.start..node.end)
                    .ok_or_else(|| invalid("SVG source container"))?;
                (
                    format!("{}#xml-byte:{}", self.resource, node.start),
                    "image/svg+xml".into(),
                    bytes.to_vec(),
                )
            }
            _ => return Err(invalid("expected image")),
        };
        if !self
            .document
            .images
            .iter()
            .any(|image| image.resource == resource)
        {
            self.document.images.push(ImageResource {
                resource: resource.clone(),
                media_type,
                bytes,
            });
        }
        let mut image = block(
            self.resource,
            node_id(node),
            "image",
            node.attrs
                .get("alt")
                .or_else(|| node.attrs.get("aria-label"))
                .cloned()
                .or_else(|| {
                    node.elements()
                        .find(|node| node.name == "title")
                        .map(Node::text)
                })
                .unwrap_or_default(),
            Some(Span {
                start: ByteOffset(node.start),
                end: ByteOffset(node.end),
            }),
            Vec::new(),
        );
        image.image = Some(resource);
        self.push(image)
    }
}
