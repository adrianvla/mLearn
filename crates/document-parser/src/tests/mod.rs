use super::*;
use lopdf::{dictionary, Dictionary, Document as Pdf, Object, Stream};
use serde::Deserialize;
use std::io::Write;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

const EPUB: &[u8] = include_bytes!("../../../../tests/fixtures/reader/journey.epub");
const PDF: &[u8] = include_bytes!("../../../../tests/fixtures/reader/journey.pdf");
const TEXT: &[u8] = include_bytes!("../../../../tests/fixtures/reader/journey.txt");

#[derive(Deserialize)]
struct Expected {
    blocks: Vec<ExpectedBlock>,
    restore: ExpectedRestore,
    pdf: ExpectedPdf,
}
#[derive(Deserialize)]
struct ExpectedBlock {
    href: String,
    id: String,
    text: String,
    readings: Vec<Reading>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExpectedRestore {
    href: String,
    block_id: String,
    start: ByteOffset,
    end: ByteOffset,
    quote: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExpectedPdf {
    page_count: usize,
    page0_text: String,
    selection_text: String,
    page1_has_text: bool,
    page2_text: String,
    page2_rotation: i64,
    page2_crop_box: Vec<f32>,
}
fn expected() -> Expected {
    serde_json::from_slice(include_bytes!(
        "../../../../tests/fixtures/reader/expected.json"
    ))
    .unwrap()
}
fn archive(entries: &[(&str, &[u8], CompressionMethod)]) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    writer
        .start_file(
            "mimetype",
            SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
        )
        .unwrap();
    writer.write_all(b"application/epub+zip").unwrap();
    for (name, bytes, compression) in entries {
        writer
            .start_file(
                name,
                SimpleFileOptions::default().compression_method(*compression),
            )
            .unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap().into_inner()
}
fn minimal_epub(chapter: &str) -> Vec<u8> {
    archive(&[
        ("META-INF/container.xml", br#"<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/book.opf"/></rootfiles></container>"#, CompressionMethod::Stored),
        ("EPUB/book.opf", br#"<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="body" href="body.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="body"/></spine></package>"#, CompressionMethod::Stored),
        ("EPUB/body.xhtml", chapter.as_bytes(), CompressionMethod::Stored),
    ])
}
fn pdf_with_contents(contents: Vec<Vec<u8>>, compress: bool) -> Vec<u8> {
    let mut pdf = Pdf::with_version("1.5");
    let pages_id = pdf.new_object_id();
    let mut content_ids = Vec::new();
    for content in contents {
        let mut stream = Stream::new(Dictionary::new(), content);
        if compress {
            stream.compress().unwrap();
        }
        content_ids.push(Object::Reference(pdf.add_object(stream)));
    }
    let page_id = pdf.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "Resources" => Dictionary::new(),
        "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
        "Contents" => content_ids,
    });
    pdf.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages", "Kids" => vec![page_id.into()], "Count" => 1,
        }),
    );
    let catalog = pdf.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    pdf.trailer.set("Root", catalog);
    let mut bytes = Vec::new();
    pdf.save_to(&mut bytes).unwrap();
    bytes
}

mod archive;
mod fidelity;
mod native;
mod pdf;
mod sandbox;
