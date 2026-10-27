use super::*;
use crate::WritingMode;

#[test]
fn contents_resolve_container_and_inline_utf8_anchors_without_importing_unrelated_links() {
    let chapter = r##"<html xmlns:epub="http://www.idpf.org/2007/ops"><body>
        <nav epub:type="toc" id="toc"><a href="#chapter">Chapter</a><a href="#middle">Middle</a></nav>
        <section id="chapter"><h1 id="title">Title</h1><p id="paragraph">🌱 <span id="middle">東京</span>へ歩く。</p></section>
        <a href="#toc">Back to contents</a><a href="https://example.invalid">Publisher</a>
        </body></html>"##;
    let bytes = archive(&[
        ("META-INF/container.xml", br#"<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>"#, CompressionMethod::Stored),
        ("book.opf", br#"<package><manifest><item id="body" href="body.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="body"/></spine></package>"#, CompressionMethod::Stored),
        ("body.xhtml", chapter.as_bytes(), CompressionMethod::Stored),
    ]);
    let document = parse(&bytes, Format::Epub, Limits::default()).unwrap();
    assert_eq!(document.navigation.len(), 2);
    assert_eq!(document.navigation[0].resource, "body.xhtml");
    assert_eq!(document.navigation[0].block_id, "title");
    assert_eq!(document.navigation[0].offset, ByteOffset(0));
    assert_eq!(document.navigation[1].block_id, "paragraph");
    assert_eq!(document.navigation[1].offset, ByteOffset(5));
    let block = document
        .blocks
        .iter()
        .find(|block| block.id == document.navigation[1].block_id)
        .unwrap();
    assert_eq!(
        &block.text[document.navigation[1].offset.0..],
        "東京へ歩く。"
    );
}

#[test]
fn authored_modes_and_inline_svg_survive_real_fixture() {
    // Given the real EPUB's external vertical CSS and body class override.
    let document = parse(EPUB, Format::Epub, Limits::default()).unwrap();
    // When original-order blocks are consumed.
    let bridge = document
        .blocks
        .iter()
        .position(|block| block.id == "bridge-one")
        .unwrap();
    // Then the graphic remains between both passages and modes are source-authored.
    assert_eq!(
        document.blocks[bridge].writing_mode,
        Some(WritingMode::HorizontalTb)
    );
    assert_eq!(document.blocks[bridge + 1].kind, "image");
    assert_eq!(document.blocks[bridge + 2].id, "bridge-two");
    assert_eq!(
        document
            .blocks
            .iter()
            .find(|block| block.id == "seed")
            .unwrap()
            .writing_mode,
        Some(WritingMode::VerticalRl)
    );
    let image = &document.images[0];
    assert_eq!(image.media_type, "image/svg+xml");
    assert!(
        std::str::from_utf8(&image.bytes)
            .unwrap()
            .contains("An original blue bridge")
    );
}

#[test]
fn mixed_inline_image_partial_ruby_and_nested_list_keep_order() {
    // Given ordinary XHTML with mixed inline image/text and nested lists.
    let bytes = archive(&[
        ("META-INF/container.xml", br#"<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>"#, CompressionMethod::Stored),
        ("book.opf", br#"<package><manifest><item id="body" href="body.xhtml" media-type="application/xhtml+xml"/><item id="picture" href="picture.png" media-type="image/png"/></manifest><spine><itemref idref="body"/></spine></package>"#, CompressionMethod::Stored),
        ("body.xhtml", br#"<html><body><h4>Heading</h4><p id="mixed">A<img id="picture" src="picture.png" alt="leaf"/>B<ruby>C<rt>see</rt></ruby>D</p><ul><li>Outer<ul><li>Inner</li></ul>Tail</li></ul><div>Direct text</div></body></html>"#, CompressionMethod::Stored),
        ("picture.png", b"\x89PNG\r\n\x1a\noriginal", CompressionMethod::Stored),
    ]);
    // When native structural extraction walks the authored flow.
    let document = parse(&bytes, Format::Epub, Limits::default()).unwrap();
    // Then common content is not dropped or appended out of order.
    assert_eq!(
        document
            .blocks
            .iter()
            .map(|block| block.text.as_str())
            .collect::<Vec<_>>(),
        [
            "Heading",
            "A",
            "leaf",
            "BCD",
            "Outer",
            "Inner",
            "Tail",
            "Direct text"
        ]
    );
    assert_eq!(document.blocks[0].kind, "h4");
    assert_eq!(document.blocks[2].image.as_deref(), Some("picture.png"));
    assert_eq!(document.images[0].bytes, b"\x89PNG\r\n\x1a\noriginal");
    assert_eq!(
        document.blocks[3].readings,
        [Reading {
            start: ByteOffset(1),
            end: ByteOffset(2),
            text: "see".into()
        }]
    );
}

#[test]
fn unsupported_complex_content_is_explicit_instead_of_disappearing() {
    // Given table and complex ruby content outside the supported structural subset.
    for source in [
        "<html><body><table><tr><td>Visible</td></tr></table></body></html>",
        "<html><body><p><ruby>A<rtc>complex</rtc><rt>a</rt></ruby></p></body></html>",
        "<html><head><style>body > p { writing-mode: vertical-rl; }</style></head><body><p>A</p></body></html>",
        "<html><body><p style='writing-mode: sideways-rl'>A</p></body></html>",
        "<html><head><style>body { writing-mode: unknown; }</style></head><body><p>A</p></body></html>",
    ] {
        // When admission reaches unsupported fidelity.
        let result = parse(&minimal_epub(source), Format::Epub, Limits::default());
        // Then no successful projection silently loses the content or authored mode.
        assert!(matches!(result, Err(Error::Unsupported(_))), "{result:?}");
    }
}

#[test]
fn authored_mode_cascade_preserves_inline_override_and_ruby_across_segments() {
    // Given tag/class/ID rules and an inline authored horizontal child.
    let source = "<html><head><style>html { writing-mode: vertical-rl; } .mode { writing-mode: vertical-lr; } #specific { writing-mode: vertical-rl !important; }</style></head><body><p id='specific' class='mode' style='writing-mode: horizontal-tb'>Before<span style='writing-mode: horizontal-tb'><ruby>A<rt>a</rt></ruby></span>After</p></body></html>";
    // When the structural owner separates the actual authored flow change.
    let document = parse(&minimal_epub(source), Format::Epub, Limits::default()).unwrap();
    // Then source-important wins on the parent, the child owns its mode and ruby.
    assert_eq!(
        document
            .blocks
            .iter()
            .map(|block| block.text.as_str())
            .collect::<Vec<_>>(),
        ["Before", "A", "After"]
    );
    assert_eq!(
        document
            .blocks
            .iter()
            .map(|block| block.writing_mode)
            .collect::<Vec<_>>(),
        [
            Some(WritingMode::VerticalRl),
            Some(WritingMode::HorizontalTb),
            Some(WritingMode::VerticalRl)
        ]
    );
    assert_eq!(
        document.blocks[1].readings,
        [Reading {
            start: ByteOffset(0),
            end: ByteOffset(1),
            text: "a".into()
        }]
    );
}

#[test]
fn caller_cannot_raise_native_admission_ceilings() {
    // Given a caller attempting to raise the XML depth policy.
    let limits = Limits {
        xml_depth: usize::MAX,
        ..Limits::default()
    };
    // When an otherwise valid document is admitted.
    let result = parse(TEXT, Format::Text, limits);
    // Then runtime callers cannot opt out of bounded parsing.
    assert!(matches!(result, Err(Error::Limit(_))));
}
