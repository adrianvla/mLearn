use super::*;
#[test]
fn epub_fixture_preserves_spine_base_text_and_partial_authored_ruby() {
    // Given an actual EPUB and independent expected source spans.
    let expected = expected();
    // When the Rust ZIP/XML parser extracts it.
    let document = parse(EPUB, Format::Epub, Limits::default()).unwrap();
    // Then source order, base strings and authored spans are preserved exactly.
    assert_eq!(document.progression.as_deref(), Some("rtl"));
    assert_eq!(
        document
            .spine
            .iter()
            .map(|item| item.resource.as_str())
            .collect::<Vec<_>>(),
        ["EPUB/start.xhtml", "EPUB/return.xhtml"]
    );
    assert_eq!(
        document
            .navigation
            .iter()
            .map(|item| (item.resource.as_str(), item.fragment.as_deref()))
            .collect::<Vec<_>>(),
        [
            ("EPUB/start.xhtml", Some("opening")),
            ("EPUB/return.xhtml", Some("crossing"))
        ]
    );
    assert_eq!(
        document.blocks.iter().filter(|b| b.image.is_none()).count(),
        expected.blocks.len()
    );
    for (block, expected) in document
        .blocks
        .iter()
        .filter(|b| b.image.is_none())
        .zip(&expected.blocks)
    {
        assert_eq!(
            (&block.resource, &block.id, &block.text, &block.readings),
            (
                &expected.href,
                &expected.id,
                &expected.text,
                &expected.readings
            )
        );
        assert_eq!(
            block.span,
            Span {
                start: ByteOffset(0),
                end: ByteOffset(expected.text.len())
            }
        );
    }
    let seed = document
        .blocks
        .iter()
        .find(|block| block.id == "seed")
        .unwrap();
    assert_eq!(seed.text.get(5..11), Some("東京"));
    assert_eq!(seed.readings.first().unwrap().start, ByteOffset(5));
}

#[test]
fn text_fixture_retains_original_byte_containers_without_normalizing_unicode() {
    // Given the independently authored UTF-8 text document.
    let expected = expected();
    // When its canonical paragraphs are extracted.
    let document = parse(TEXT, Format::Text, Limits::default()).unwrap();
    // Then every canonical block slices the actual original bytes exactly.
    assert_eq!(
        document
            .blocks
            .iter()
            .map(|block| block.text.as_str())
            .collect::<Vec<_>>(),
        expected
            .blocks
            .iter()
            .map(|block| block.text.as_str())
            .collect::<Vec<_>>()
    );
    for block in &document.blocks {
        let container = block.original_container_bytes.as_ref().unwrap();
        assert_eq!(
            TEXT.get(container.start.0..container.end.0),
            Some(block.text.as_bytes())
        );
    }
}

#[test]
fn duplicate_passage_anchor_restores_second_block_and_rejects_wrong_revision() {
    // Given two identical paragraphs and a persisted source-node anchor.
    let expected = expected().restore;
    let document = parse(EPUB, Format::Epub, Limits::default()).unwrap();
    let anchor = Anchor {
        content_revision: document.content_revision.clone(),
        parser_revision: document.parser_revision.to_owned(),
        resource: expected.href,
        block_id: expected.block_id,
        span: Span {
            start: expected.start,
            end: expected.end,
        },
    };
    // When the anchor survives serialization/restart of parser output.
    let saved = serde_json::to_vec(&anchor).unwrap();
    let restored: Anchor = serde_json::from_slice(&saved).unwrap();
    let reopened = parse(EPUB, Format::Epub, Limits::default()).unwrap();
    // Then it resolves to bridge-two, not the first matching quote.
    assert_eq!(restored.block_id, "bridge-two");
    assert_eq!(
        resolve_anchor(&reopened, &restored).unwrap(),
        expected.quote
    );
    let wrong_revision = Anchor {
        content_revision: "different-revision".into(),
        ..restored
    };
    assert!(matches!(
        resolve_anchor(&reopened, &wrong_revision),
        Err(Error::Invalid(_))
    ));
}

#[test]
fn source_selection_rejects_split_utf8_scalar_and_changed_parser_revision() {
    // Given an anchor inside the four-byte emoji.
    let document = parse(EPUB, Format::Epub, Limits::default()).unwrap();
    let anchor = Anchor {
        content_revision: document.content_revision.clone(),
        parser_revision: document.parser_revision.to_owned(),
        resource: "EPUB/start.xhtml".into(),
        block_id: "seed".into(),
        span: Span {
            start: ByteOffset(1),
            end: ByteOffset(4),
        },
    };
    // When selection resolution is attempted.
    let result = resolve_anchor(&document, &anchor);
    // Then an invalid byte endpoint is rejected rather than rounding.
    assert!(matches!(result, Err(Error::Invalid(_))));
    let changed = Anchor {
        parser_revision: "other-parser".into(),
        span: Span {
            start: ByteOffset(5),
            end: ByteOffset(11),
        },
        ..anchor
    };
    assert!(matches!(
        resolve_anchor(&document, &changed),
        Err(Error::Invalid(_))
    ));
}

#[test]
fn xml_rejects_deep_sections_external_entities_and_oversized_blocks() {
    // Given actual EPUBs containing pathological XML sections.
    let cases = [
        (
            format!(
                "<html>{}<p>x</p>{}</html>",
                "<section>".repeat(40),
                "</section>".repeat(40)
            ),
            "XML depth",
        ),
        (
            format!("<html><p>{}</p></html>", "x".repeat(64 * 1024 + 1)),
            "canonical block bytes",
        ),
    ];
    // When bounded ZIP/XML extraction processes them.
    for (chapter, label) in cases {
        let result = parse(&minimal_epub(&chapter), Format::Epub, Limits::default());
        // Then the corresponding bound fails without publishing blocks.
        assert!(
            matches!(&result, Err(Error::Limit(found)) if *found == label),
            "{result:?}"
        );
    }
    let entity = minimal_epub(
        "<!DOCTYPE html [<!ENTITY steal SYSTEM 'file:///etc/passwd'>]><html><p>&steal;</p></html>",
    );
    assert!(matches!(
        parse(&entity, Format::Epub, Limits::default()),
        Err(Error::Unsupported("XML DTD/entity declarations"))
    ));
}

#[test]
fn malformed_and_over_budget_inputs_fail_before_source_publication() {
    // Given invalid UTF-8, mismatched XML and a byte budget below the real input.
    let limits = Limits {
        input_bytes: TEXT.len() - 1,
        ..Limits::default()
    };
    // When each input crosses the parser boundary.
    let oversized = parse(TEXT, Format::Text, limits);
    // Then invalid/oversized inputs produce errors instead of partial documents.
    assert!(matches!(oversized, Err(Error::Limit("input bytes"))));
    assert!(matches!(
        parse(b"\xff", Format::Text, Limits::default()),
        Err(Error::Utf8(_))
    ));
    assert!(parse(
        &minimal_epub("<html><p>x</html>"),
        Format::Epub,
        Limits::default()
    )
    .is_err());
}

#[test]
fn xml_entities_and_line_breaks_preserve_base_text_coordinates() {
    // Given real XHTML containing a named entity, astral reference and line break.
    let bytes = minimal_epub("<html><body><p id='line'>A&amp;B&#x1F331;<br/>C<ruby>取<rt>と</rt></ruby>り</p></body></html>");
    // When the ordinary XML parser builds canonical source text.
    let document = parse(&bytes, Format::Epub, Limits::default()).unwrap();
    // Then byte spans count decoded base characters, not entity spelling.
    let block = &document.blocks[0];
    assert_eq!(block.text, "A&B🌱\nC取り");
    assert_eq!(
        block.readings,
        vec![Reading {
            start: ByteOffset(9),
            end: ByteOffset(12),
            text: "と".into()
        }]
    );
}

#[test]
fn duplicate_ids_and_nested_ruby_are_rejected_instead_of_creating_ambiguous_anchors() {
    // Given source-node collisions and overlapping ruby.
    let chapters = [
        "<html><body><p id='same'>A<span id='same'>B</span></p></body></html>",
        "<html><body><p><ruby><ruby>取<rt>と</rt></ruby><rt>other</rt></ruby></p></body></html>",
    ];
    // When canonical source admission runs.
    for chapter in chapters {
        let result = parse(&minimal_epub(chapter), Format::Epub, Limits::default());
        // Then no ambiguous block identity or overlapping source reading is admitted.
        assert!(result.is_err());
    }
}
