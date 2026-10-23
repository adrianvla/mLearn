use super::*;
use crate::archive::resolve;
#[test]
fn archive_rejects_traversal_absolute_windows_and_encoded_paths() {
    // Given actual ZIPs carrying unsafe resource names.
    for name in [
        "../escape",
        "/absolute",
        "C:\\escape",
        "EPUB/../../escape",
        "EPUB\\escape",
        "%2e%2e/escape",
    ] {
        let bytes = archive(&[(name, b"x", CompressionMethod::Stored)]);
        // When archive admission reads the central and local headers.
        let result = parse(&bytes, Format::Epub, Limits::default());
        // Then no extraction path is admitted.
        assert!(
            matches!(result, Err(Error::Invalid(_))),
            "{name}: {result:?}"
        );
    }
}

#[test]
fn archive_rejects_bombs_before_inflating_declared_expansion() {
    // Given a real deflated entry within the byte limit but over the ratio limit.
    let bytes = archive(&[("bomb", &vec![b'a'; 256 * 1024], CompressionMethod::Deflated)]);
    // When admission inspects the declared compressed/expanded sizes.
    let result = parse(&bytes, Format::Epub, Limits::default());
    // Then it rejects the bomb rather than allocating its expanded content.
    assert!(matches!(result, Err(Error::Limit("ZIP expansion ratio"))));
}

#[test]
fn archive_rejects_entry_count_before_central_directory_collection() {
    // Given a real archive exceeding the entry budget.
    let names: Vec<_> = (0..128).map(|index| format!("entry-{index}")).collect();
    let entries: Vec<_> = names
        .iter()
        .map(|name| (name.as_str(), b"x".as_slice(), CompressionMethod::Stored))
        .collect();
    let bytes = archive(&entries);
    // When the standard footer is admitted before ZipArchive construction.
    let result = parse(&bytes, Format::Epub, Limits::default());
    // Then the declared 129 entries fail the 128-entry policy.
    assert!(matches!(result, Err(Error::Limit("archive entries"))));
}

#[test]
fn archive_rejects_oversized_entry_and_aggregate_expanded_bytes() {
    // Given stored entries that cannot rely on compression-ratio rejection.
    let bytes = archive(&[(
        "large",
        &vec![b'a'; 512 * 1024 + 1],
        CompressionMethod::Stored,
    )]);
    // When per-entry admission runs.
    let result = parse(&bytes, Format::Epub, Limits::default());
    // Then size and independently constrained aggregate limits are both enforced.
    assert!(matches!(result, Err(Error::Limit("entry bytes"))));
    let limits = Limits {
        expanded_bytes: 40,
        ..Limits::default()
    };
    assert!(matches!(
        parse(EPUB, Format::Epub, limits),
        Err(Error::Limit("expanded bytes"))
    ));
}

#[test]
fn archive_rejects_symlinks_and_inconsistent_local_header_names() {
    // Given a ZIP symlink and a separately corrupted local-header name.
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    writer
        .start_file(
            "mimetype",
            SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
        )
        .unwrap();
    writer.write_all(b"application/epub+zip").unwrap();
    writer
        .add_symlink("link", "../escape", SimpleFileOptions::default())
        .unwrap();
    let symlink = writer.finish().unwrap().into_inner();
    // When normal archive admission runs.
    let result = parse(&symlink, Format::Epub, Limits::default());
    // Then symlinks and header-smuggling attempts fail.
    assert!(
        matches!(result, Err(Error::Unsupported("archive symlink"))),
        "{result:?}"
    );
    let mut changed = archive(&[("safe", b"x", CompressionMethod::Stored)]);
    let local_name = changed.windows(4).position(|part| part == b"safe").unwrap();
    changed[local_name..local_name + 4].copy_from_slice(b"gone");
    assert!(matches!(
        parse(&changed, Format::Epub, Limits::default()),
        Err(Error::Zip(_))
    ));
}

#[test]
fn href_resolution_rejects_external_and_archive_escape_targets() {
    // Given root-crossing and external resource references.
    for href in [
        "../../outside",
        "%2e%2e/%2e%2e/outside",
        "https://example.test/book",
        "file:///etc/passwd",
        "..\\outside",
    ] {
        // When resolving relative to the OPF.
        let result = resolve("EPUB/package.opf", href);
        // Then no ambient filesystem or network resource can be addressed.
        assert!(result.is_err(), "{href}");
    }
    assert_eq!(
        resolve("EPUB/package.opf", "chapter%20one.xhtml").unwrap(),
        "EPUB/chapter one.xhtml"
    );
}

#[test]
fn forged_zip_footer_counts_and_corrupt_payload_are_rejected() {
    // Given an actual archive with an exaggerated count, and one with broken CRC.
    let original = archive(&[("safe", b"payload", CompressionMethod::Stored)]);
    let footer = original
        .windows(4)
        .rposition(|part| part == b"PK\x05\x06")
        .unwrap();
    let mut count = original.clone();
    count[footer + 8..footer + 12].copy_from_slice(&[0xfe, 0xff, 0xfe, 0xff]);
    // When the bounded ZIP admission path runs.
    let result = parse(&count, Format::Epub, Limits::default());
    // Then count amplification is rejected before archive allocation.
    assert!(matches!(result, Err(Error::Limit("archive entries"))));
    let mut corrupt = original;
    let payload = corrupt
        .windows(7)
        .position(|part| part == b"payload")
        .unwrap();
    corrupt[payload] = b'X';
    assert!(matches!(
        parse(&corrupt, Format::Epub, Limits::default()),
        Err(Error::Io(_)) | Err(Error::Zip(_))
    ));
}
