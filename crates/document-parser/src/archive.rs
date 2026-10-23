use super::*;
use zip::ZipArchive;
// ZIP32 footer admission precedes the library's central-directory allocation.
#[derive(Debug)]
pub(super) struct Archive {
    pub(super) files: BTreeMap<String, Vec<u8>>,
}
fn entry_path(name: &str) -> Result<String, Error> {
    if name.is_empty()
        || name.starts_with('/')
        || name.contains(['\\', ':', '%', '\0'])
        || name.chars().any(char::is_control)
        || name
            .trim_end_matches('/')
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(invalid(format!("unsafe archive path: {name:?}")));
    }
    Ok(name.trim_end_matches('/').to_owned())
}
pub(super) fn resolve(base: &str, href: &str) -> Result<String, Error> {
    let path = href
        .split('#')
        .next()
        .ok_or_else(|| invalid("missing href"))?;
    let decoded = percent_encoding::percent_decode_str(path).decode_utf8()?;
    if decoded.is_empty() {
        return entry_path(base);
    }
    if decoded.starts_with('/')
        || decoded.contains(['\\', ':', '%', '\0', '?'])
        || decoded.chars().any(char::is_control)
    {
        return Err(invalid("unsafe EPUB resource href"));
    }
    let mut parts: Vec<&str> = base
        .rsplit_once('/')
        .map_or_else(Vec::new, |(parent, _)| parent.split('/').collect());
    for part in decoded.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts
                    .pop()
                    .ok_or_else(|| invalid("resource href escapes archive"))?;
            }
            part => parts.push(part),
        }
    }
    let result = parts.join("/");
    entry_path(&result)?;
    Ok(result)
}
impl Archive {
    pub(super) fn text(&self, path: &str) -> Result<&str, Error> {
        let bytes = self
            .files
            .get(path)
            .ok_or_else(|| invalid(format!("missing resource: {path}")))?;
        Ok(std::str::from_utf8(bytes)?)
    }
}
pub(super) fn read_archive(bytes: &[u8], limits: Limits) -> Result<Archive, Error> {
    // Narrow ZIP32 policy preflight; ZIP parsing/CRC/decompression stay in zip.
    // zip 9 has no public entry-budget option before metadata allocation.
    let tail_start = bytes.len().saturating_sub(65_557);
    let tail = bytes.get(tail_start..).ok_or_else(|| invalid("ZIP tail"))?;
    let relative = tail
        .windows(4)
        .rposition(|word| word == b"PK\x05\x06")
        .ok_or_else(|| invalid("missing ZIP32 footer"))?;
    let offset = tail_start.saturating_add(relative);
    let suffix = bytes.get(offset..).ok_or_else(|| invalid("ZIP footer"))?;
    let word = |offset: usize| -> Result<u16, Error> {
        let bytes = suffix
            .get(offset..offset.saturating_add(2))
            .ok_or_else(|| invalid("short ZIP footer"))?;
        Ok(u16::from_le_bytes(
            bytes.try_into().map_err(|_| invalid("ZIP word"))?,
        ))
    };
    let dword = |offset: usize| -> Result<u32, Error> {
        let bytes = suffix
            .get(offset..offset.saturating_add(4))
            .ok_or_else(|| invalid("short ZIP footer"))?;
        Ok(u32::from_le_bytes(
            bytes.try_into().map_err(|_| invalid("ZIP dword"))?,
        ))
    };
    let entries = word(10)?;
    let directory_size = dword(12)?;
    let directory_offset = dword(16)?;
    if suffix.len() != 22usize.saturating_add(usize::from(word(20)?))
        || word(4)? != 0
        || word(6)? != 0
        || entries != word(8)?
        || entries == u16::MAX
        || directory_offset == u32::MAX
        || directory_size == u32::MAX
        || bytes.get(offset.saturating_sub(20)..offset.saturating_sub(16)) == Some(b"PK\x06\x07")
    {
        return Err(Error::Unsupported(
            "ZIP64, multidisk, trailing or ambiguous ZIP footer",
        ));
    }
    check(usize::from(entries), limits.entries, "archive entries")?;
    if u64::from(directory_offset).saturating_add(u64::from(directory_size))
        != u64::try_from(offset).map_err(|_| Error::Limit("ZIP offset"))?
    {
        return Err(invalid("ZIP central directory boundary"));
    }
    let mut zip = ZipArchive::new(Cursor::new(bytes))?;
    if zip.len() != usize::from(entries)
        || zip.offset() != 0
        || zip.central_directory_start() != u64::from(directory_offset)
    {
        return Err(invalid("ZIP footer interpretation changed"));
    }
    zip.validate_header_consistency()?;
    if zip.has_overlapping_entries()? {
        return Err(invalid("overlapping ZIP entries"));
    }
    let mut files = BTreeMap::new();
    let mut expanded = 0usize;
    for index in 0..zip.len() {
        let mut file = zip.by_index(index)?;
        let name = file.name()?.into_owned();
        let path = entry_path(&name)?;
        if file.is_symlink() {
            return Err(Error::Unsupported("archive symlink"));
        }
        if file.encrypted() {
            return Err(Error::Unsupported("encrypted ZIP entry"));
        }
        if index == 0
            && (path != "mimetype" || file.compression() != zip::CompressionMethod::Stored)
        {
            return Err(invalid("EPUB requires first stored mimetype"));
        }
        let size = usize::try_from(file.size()).map_err(|_| Error::Limit("entry bytes"))?;
        check(size, limits.entry_bytes, "entry bytes")?;
        if file.size()
            > file
                .compressed_size()
                .max(1)
                .saturating_mul(limits.expansion_ratio)
        {
            return Err(Error::Limit("ZIP expansion ratio"));
        }
        check(
            expanded.saturating_add(size),
            limits.expanded_bytes,
            "expanded bytes",
        )?;
        let bytes = bounded_read(
            &mut file,
            limits
                .entry_bytes
                .min(limits.expanded_bytes.saturating_sub(expanded)),
            "actual inflated bytes",
        )?;
        expanded = expanded.saturating_add(bytes.len());
        if !name.ends_with('/') && files.insert(path, bytes).is_some() {
            return Err(invalid("duplicate ZIP resource"));
        }
    }
    Ok(Archive { files })
}
