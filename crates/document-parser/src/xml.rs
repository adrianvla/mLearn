use super::*;
use quick_xml::{events::Event, Reader, XmlVersion};
#[derive(Debug)]
pub(super) struct Node {
    pub(super) name: String,
    pub(super) attrs: BTreeMap<String, String>,
    pub(super) children: Vec<Piece>,
    pub(super) start: usize,
    pub(super) end: usize,
}
#[derive(Debug)]
pub(super) enum Piece {
    Text(String),
    Element(Node),
}
impl Node {
    pub(super) fn elements(&self) -> impl Iterator<Item = &Node> {
        self.children.iter().filter_map(|piece| match piece {
            Piece::Text(_) => None,
            Piece::Element(node) => Some(node),
        })
    }
    pub(super) fn descendants<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Node> {
        // Only metadata calls this; all trees were bounded by XML depth/events/bytes.
        let mut nodes = Vec::new();
        fn collect<'a>(node: &'a Node, name: &str, output: &mut Vec<&'a Node>) {
            if name == "*" || node.name == name {
                output.push(node);
            }
            for child in node.elements() {
                collect(child, name, output);
            }
        }
        collect(self, name, &mut nodes);
        nodes.into_iter()
    }
    pub(super) fn attr(&self, name: &str) -> Result<&str, Error> {
        self.attrs
            .get(name)
            .map(String::as_str)
            .ok_or_else(|| invalid(format!("missing {} on {}", name, self.name)))
    }
    pub(super) fn text(&self) -> String {
        let mut output = String::new();
        for piece in &self.children {
            match piece {
                Piece::Text(text) => output.push_str(text),
                Piece::Element(node) => output.push_str(&node.text()),
            }
        }
        output
    }
}
pub(super) fn parse_xml(text: &str, limits: Limits) -> Result<Node, Error> {
    check(text.len(), limits.entry_bytes, "XML section bytes")?;
    let mut reader = Reader::from_str(text);
    reader.config_mut().expand_empty_elements = true;
    reader.config_mut().check_comments = true;
    let mut stack = vec![Node {
        name: "__root".into(),
        attrs: BTreeMap::new(),
        children: Vec::new(),
        start: 0,
        end: text.len(),
    }];
    let mut events = 0usize;
    loop {
        events = events.saturating_add(1);
        check(events, limits.xml_events, "XML events")?;
        let position =
            usize::try_from(reader.buffer_position()).map_err(|_| Error::Limit("XML position"))?;
        match reader.read_event()? {
            Event::Start(tag) => {
                check(stack.len(), limits.xml_depth, "XML depth")?;
                let name = tag.local_name().as_ref().to_owned();
                let mut attrs = BTreeMap::new();
                for attr in tag.attributes() {
                    let attr = attr.map_err(|e| invalid(e.to_string()))?;
                    check(attrs.len().saturating_add(1), 64, "XML attributes")?;
                    attrs.insert(
                        attr.key.as_ref().to_owned(),
                        attr.normalized_value(XmlVersion::Implicit1_0)?.into_owned(),
                    );
                }
                stack.push(Node {
                    name,
                    attrs,
                    children: Vec::new(),
                    start: position,
                    end: position,
                });
            }
            Event::End(_) => {
                let mut node = stack.pop().ok_or_else(|| invalid("XML stack underflow"))?;
                node.end = usize::try_from(reader.buffer_position())
                    .map_err(|_| Error::Limit("XML position"))?;
                stack
                    .last_mut()
                    .ok_or_else(|| invalid("multiple XML roots"))?
                    .children
                    .push(Piece::Element(node));
            }
            Event::Text(text) => stack
                .last_mut()
                .ok_or_else(|| invalid("XML text outside root"))?
                .children
                .push(Piece::Text(text.xml10_content().into_owned())),
            Event::CData(text) => stack
                .last_mut()
                .ok_or_else(|| invalid("XML CDATA outside root"))?
                .children
                .push(Piece::Text(text.xml10_content().into_owned())),
            Event::GeneralRef(reference) => {
                let value = match reference.resolve_char_ref()? {
                    Some(character) => character.to_string(),
                    None => quick_xml::escape::resolve_predefined_entity(reference.as_ref())
                        .ok_or(Error::Unsupported("XML custom entity"))?
                        .to_owned(),
                };
                stack
                    .last_mut()
                    .ok_or_else(|| invalid("XML entity outside root"))?
                    .children
                    .push(Piece::Text(value));
            }
            Event::DocType(doctype) => {
                if doctype.xml10_content().trim() != "html" {
                    return Err(Error::Unsupported("XML DTD/entity declarations"));
                }
            }
            Event::Decl(declaration) => {
                if let Some(encoding) = declaration.encoding()
                    && !encoding
                        .map_err(|e| invalid(e.to_string()))?
                        .eq_ignore_ascii_case("utf-8")
                {
                    return Err(Error::Unsupported("non-UTF-8 XML"));
                }
            }
            Event::Eof => break,
            Event::Comment(_) | Event::PI(_) => {}
            Event::Empty(_) => return Err(invalid("XML empty expansion disabled")),
        }
    }
    if stack.len() != 1 {
        return Err(invalid("unclosed XML"));
    }
    let root = stack.pop().ok_or_else(|| invalid("missing XML root"))?;
    if root.elements().count() != 1 {
        return Err(invalid("XML requires one root"));
    }
    Ok(root)
}
