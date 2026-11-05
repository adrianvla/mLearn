use super::*;
use archive::{read_archive, resolve};
use structure::collect_blocks;
use xml::parse_xml;
pub(super) fn parse_epub(
    bytes: &[u8],
    limits: Limits,
    document: &mut Document,
) -> Result<(), Error> {
    let archive = read_archive(bytes, limits)?;
    if archive.files.contains_key("META-INF/encryption.xml") {
        return Err(Error::Unsupported(
            "EPUB resource encryption or font obfuscation",
        ));
    }
    if archive.text("mimetype")? != "application/epub+zip" {
        return Err(invalid("EPUB mimetype"));
    }
    let container = parse_xml(archive.text("META-INF/container.xml")?, limits)?;
    let rootfile = container
        .descendants("rootfile")
        .next()
        .ok_or_else(|| invalid("missing EPUB rootfile"))?;
    let opf_path = resolve("", rootfile.attr("full-path")?)?;
    let package = parse_xml(archive.text(&opf_path)?, limits)?;
    let manifest = package
        .descendants("manifest")
        .next()
        .ok_or_else(|| invalid("missing manifest"))?;
    let mut items = BTreeMap::new();
    for item in manifest.elements() {
        if item.name != "item" {
            continue;
        }
        let id = item.attr("id")?;
        let path = resolve(&opf_path, item.attr("href")?)?;
        if !archive.files.contains_key(&path) {
            return Err(invalid("missing manifest resource"));
        }
        if items.insert(id.to_owned(), (item, path)).is_some() {
            return Err(invalid("duplicate manifest ID"));
        }
    }
    let spine = package
        .descendants("spine")
        .next()
        .ok_or_else(|| invalid("missing spine"))?;
    for (item, path) in items.values() {
        let media_type = item.attr("media-type")?;
        if media_type.starts_with("image/") {
            match media_type {
                "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml" => {}
                _ => return Err(Error::Unsupported("image media type")),
            }
            if !document.images.iter().any(|image| image.resource == *path) {
                document.images.push(ImageResource {
                    resource: path.clone(),
                    media_type: media_type.to_owned(),
                    bytes: archive
                        .files
                        .get(path)
                        .ok_or_else(|| invalid("missing image"))?
                        .clone(),
                });
            }
        }
    }
    document.progression = spine.attrs.get("page-progression-direction").cloned();
    let mut seen_spine = BTreeSet::new();
    let mut authored_anchors = BTreeMap::new();
    for reference in spine.elements() {
        if reference.name != "itemref" {
            continue;
        }
        let id = reference.attr("idref")?;
        if !seen_spine.insert(id.to_owned()) {
            return Err(Error::Unsupported("repeated spine item"));
        }
        let (item, path) = items.get(id).ok_or_else(|| invalid("missing spine item"))?;
        if document
            .spine
            .iter()
            .any(|previous| previous.resource == *path)
        {
            return Err(Error::Unsupported("repeated spine resource"));
        }
        if item.attr("media-type")? != "application/xhtml+xml" {
            return Err(Error::Unsupported("non-XHTML spine item"));
        }
        document.spine.push(SpineItem {
            resource: path.clone(),
            manifest_id: id.to_owned(),
            properties: item.attrs.get("properties").cloned().unwrap_or_default(),
            writing_mode: None,
        });
        let chapter = parse_xml(archive.text(path)?, limits)?;
        let mut ids = BTreeSet::new();
        for node in chapter.descendants("*") {
            if let Some(id) = node.attrs.get("id")
                && !ids.insert(id)
            {
                return Err(invalid("duplicate authored ID"));
            }
        }
        let mut anchors = BTreeMap::new();
        let mode = collect_blocks(&chapter, path, limits, document, &archive, &mut anchors)?;
        authored_anchors.extend(
            anchors
                .into_iter()
                .map(|(id, target)| ((path.clone(), id), target)),
        );
        if let Some(item) = document.spine.last_mut() {
            item.writing_mode = mode;
        }
    }
    for (item, path) in items.values() {
        if item
            .attrs
            .get("properties")
            .is_some_and(|value| value.split_whitespace().any(|value| value == "nav"))
        {
            let nav = parse_xml(archive.text(path)?, limits)?;
            for link in nav
                .descendants("nav")
                .filter(|node| {
                    node.attrs
                        .get("epub:type")
                        .is_some_and(|value| value.split_whitespace().any(|value| value == "toc"))
                })
                .flat_map(|node| node.descendants("a"))
            {
                let href = link.attr("href")?;
                let resource = resolve(path, href)?;
                if !archive.files.contains_key(&resource) {
                    return Err(invalid("missing navigation resource"));
                }
                let fragment = href
                    .split_once('#')
                    .map(|(_, fragment)| {
                        percent_encoding::percent_decode_str(fragment)
                            .decode_utf8()
                            .map(|value| value.into_owned())
                    })
                    .transpose()?;
                let (block_id, offset) = if let Some(fragment) = &fragment {
                    authored_anchors.get(&(resource.clone(), fragment.clone())).cloned()
                        .ok_or_else(|| invalid(format!("Contents target has no preserved source anchor: {resource}#{fragment}")))?
                } else {
                    let block = document
                        .blocks
                        .iter()
                        .find(|block| block.resource == resource)
                        .ok_or_else(|| invalid("Contents target has no source block"))?;
                    (block.id.clone(), 0)
                };
                document.navigation.push(Navigation {
                    label: link.text(),
                    resource,
                    fragment,
                    block_id,
                    offset: ByteOffset(offset),
                });
            }
        }
    }
    document.fidelity.push("XHTML heading/paragraph/list/blockquote subset; authored simple ruby; mixed text/images and inline SVG; no CSS layout, scripting, DRM or complex ruby");
    document.fidelity.push("Authored writing-mode inherits tag/class/ID compound and inline rules; complex/conditional writing-mode CSS rejected; links retain text, not interactive destinations; emphasis and publisher layout unavailable");
    document
        .fidelity
        .push("ZIP32 only with a terminal footer; ZIP64/multidisk archives explicitly unsupported");
    Ok(())
}
