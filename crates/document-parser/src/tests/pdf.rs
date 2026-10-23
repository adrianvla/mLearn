use super::*;
#[test]
fn pdf_fixture_extracts_real_text_pages_without_claiming_glyph_rectangles() {
    // Given the actual CoreGraphics PDF and source-text expectations.
    let expected = expected().pdf;
    // When lopdf independently decodes its streams/fonts.
    let document = parse(PDF, Format::Pdf, Limits::default()).unwrap();
    // Then all original pages and known text survive; layout whitespace is explicit.
    assert_eq!(document.pages.len(), expected.page_count);
    let normalized = |text: &str| text.split_whitespace().collect::<Vec<_>>().join(" ");
    assert_eq!(
        normalized(&document.blocks[0].text),
        normalized(&expected.page0_text)
    );
    assert_eq!(
        normalized(&document.blocks[2].text),
        normalized(&expected.page2_text)
    );
    assert!(document.blocks[0].text.contains(&expected.selection_text));
    assert_eq!(document.pages[1].text_available, expected.page1_has_text);
    assert_eq!(document.pages[2].rotation, Some(expected.page2_rotation));
    // The expected box is x/y/width/height; PDF dictionaries store x0/y0/x1/y1.
    let box_values = &expected.page2_crop_box;
    assert_eq!(
        document.pages[2].crop_box.as_ref().unwrap(),
        &vec![
            box_values[0],
            box_values[1],
            box_values[0] + box_values[2],
            box_values[1] + box_values[3]
        ]
    );
    assert!(document
        .blocks
        .iter()
        .all(|block| block.original_container_bytes.is_none()));
}

#[test]
fn pdf_decompression_bomb_and_multistream_sum_are_bounded() {
    // Given real PDFs containing valid compressed comment streams.
    let limit = 4096;
    let large = pdf_with_contents(
        vec![format!("%{}\n", "a".repeat(limit + 1)).into_bytes()],
        true,
    );
    let split = pdf_with_contents(
        vec![
            format!("%{}\n", "a".repeat(3000)).into_bytes(),
            format!("%{}\n", "b".repeat(3000)).into_bytes(),
        ],
        true,
    );
    let limits = Limits {
        pdf_stream_bytes: limit,
        ..Limits::default()
    };
    // When limited PDF text extraction reads their page streams.
    for bytes in [large, split] {
        let result = parse(&bytes, Format::Pdf, limits);
        // Then one stream and multiple-stream aggregate overflow both fail.
        assert!(matches!(result, Err(Error::Sandbox(_))), "{result:?}");
    }
}

#[test]
fn pdf_page_count_and_page_text_limits_are_explicit() {
    // Given the actual fixture with tighter parser budgets.
    let page_limits = Limits {
        pdf_pages: 2,
        ..Limits::default()
    };
    // When the fixture crosses those boundaries.
    let pages = parse(PDF, Format::Pdf, page_limits);
    // Then pages and canonical text cannot silently exceed their budgets.
    assert!(matches!(pages, Err(Error::Sandbox(_))));
    let text_limits = Limits {
        block_bytes: 4,
        ..Limits::default()
    };
    assert!(matches!(
        parse(PDF, Format::Pdf, text_limits),
        Err(Error::Sandbox(_))
    ));
}
