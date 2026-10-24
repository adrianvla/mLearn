use super::*;
use crate::{ParseControl, PdfReader};
use mlearn_language_host::{AssetMap, CompiledPlugin};

#[test]
fn cancellation_after_real_pdf_work_rejects_publication_and_next_job_recovers() {
    // Given real completed metadata/page work under the import owner's epoch.
    let control = ParseControl::default();
    let mut reader = PdfReader::open(PDF, Limits::default(), control.clone()).unwrap();
    assert!(reader.read_page(0).unwrap().page.text_available);
    control.cancellation.fetch_add(1, Ordering::AcqRel);
    // When the next original page is requested after the exact completion signal.
    let result = reader.read_page(2);
    // Then cancelled work is rejected and a new admitted epoch can extract again.
    assert!(matches!(result, Err(Error::Cancelled)));
    drop(reader);
    let resumed = ParseControl {
        epoch: 1,
        ..control
    };
    let mut next = PdfReader::open(PDF, Limits::default(), resumed).unwrap();
    assert!(next
        .read_page(2)
        .unwrap()
        .block
        .text
        .contains("Turn the page."));
}

#[test]
fn repeated_page_requests_consume_total_execution_attempts() {
    // Given a real three-page document, with an explicit three-page budget.
    let limits = Limits {
        pdf_pages: 3,
        ..Limits::default()
    };
    let mut reader = PdfReader::open(PDF, limits, ParseControl::default()).unwrap();
    for _ in 0..3 {
        reader.read_page(0).unwrap();
    }
    // When a repeated request would exceed metadata plus three page attempts.
    let result = reader.read_page(0);
    // Then retries cannot multiply the import CPU budget.
    assert!(matches!(
        result,
        Err(Error::Limit("PDF execution attempts"))
    ));
}

fn sandbox_failure(code: &str) -> String {
    let bytes = wat::parse_str(format!(
        r#"(module
        (memory (export "memory") 1)
        (func (export "mlearn_abi_version") (result i32) i32.const 1)
        (func (export "mlearn_alloc") (param i32) (result i32) i32.const 1024)
        (func (export "mlearn_dealloc") (param i32 i32))
        (func (export "mlearn_call") (param i32 i32) (result i64) {code})
    )"#
    ))
    .unwrap();
    CompiledPlugin::new(&bytes, AssetMap::new())
        .unwrap()
        .invoke("document.pdf.v1", serde_json::json!({}))
        .unwrap_err()
}

#[test]
fn existing_executor_fuel_cap_traps_and_next_real_pdf_recovers() {
    // Given a module that cannot finish under any finite fuel allowance.
    let code = "(loop $forever br $forever) i64.const 0";
    // When the same mechanical Fresh executor runs it.
    let error = sandbox_failure(code);
    // Then its finite fuel error is recoverable by the actual parser artifact.
    assert!(error.contains("fuel"), "{error}");
    assert_eq!(
        parse(PDF, Format::Pdf, Limits::default())
            .unwrap()
            .pages
            .len(),
        3
    );
}

#[test]
fn existing_executor_memory_cap_traps_and_next_real_pdf_recovers() {
    // Given a growth request for 1025 total pages, beyond Fresh's 64 MiB.
    let code = "i32.const 1024 memory.grow i32.const -1 i32.eq if unreachable end i64.const 0";
    // When the same mechanical Fresh executor denies the growth.
    let error = sandbox_failure(code);
    // Then the explicit denied-growth trap, not a malformed reply, is observed.
    assert!(error.contains("unreachable"), "{error}");
    assert_eq!(
        parse(PDF, Format::Pdf, Limits::default())
            .unwrap()
            .pages
            .len(),
        3
    );
}

#[test]
fn actual_many_object_pdf_fails_without_poisoning_the_host() {
    // Given a valid library-authored PDF containing over 8192 eager objects.
    let bytes = pdf_with_contents(vec![b"% ordinary\n".to_vec()], false);
    let mut pdf = Pdf::load_mem(&bytes).unwrap();
    for _ in 0..8300 {
        pdf.add_object(dictionary! { "Value" => 1 });
    }
    let mut bytes = Vec::new();
    pdf.save_to(&mut bytes).unwrap();
    // When eager loading takes place inside the actual parser artifact.
    let result = parse(&bytes, Format::Pdf, Limits::default());
    // Then finite work/objects reject it and the next real import still works.
    assert!(matches!(result, Err(Error::Sandbox(_))), "{result:?}");
    assert_eq!(
        parse(PDF, Format::Pdf, Limits::default())
            .unwrap()
            .pages
            .len(),
        3
    );
}

#[test]
fn aggregate_compressed_object_expansion_is_sandboxed_before_native_allocation() {
    // Given many individually legal compressed object streams: aggregate loading
    // is the prototype's gap, not a raw-byte or single-stream rejection.
    let bytes = pdf_with_contents(vec![b"% ordinary\n".to_vec()], false);
    let mut pdf = Pdf::load_mem(&bytes).unwrap();
    for _ in 0..32 {
        pdf.add_object(Object::string_literal(vec![b'x'; 200 * 1024]));
    }
    let mut bytes = Vec::new();
    pdf.save_with_options(
        &mut bytes,
        lopdf::SaveOptions::builder()
            .use_object_streams(true)
            .use_xref_streams(true)
            .max_objects_per_stream(1)
            .compression_level(6)
            .build(),
    )
    .unwrap();
    assert!(bytes.len() < Limits::default().input_bytes);
    // When the real guest eagerly decodes the aggregate object collection.
    let result = parse(&bytes, Format::Pdf, Limits::default());
    // Then a fuel/memory failure stays inside the sandbox; no host abort occurs.
    let Err(Error::Sandbox(error)) = result else {
        panic!("expected sandbox rejection: {result:?}");
    };
    assert!(
        error.contains("fuel") || error.contains("unreachable") || error.contains("memory"),
        "{error}"
    );
    assert_eq!(
        parse(PDF, Format::Pdf, Limits::default())
            .unwrap()
            .pages
            .len(),
        3
    );
}
