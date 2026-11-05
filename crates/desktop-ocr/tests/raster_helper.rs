use base64::Engine;
use serde_json::{Value, json};
use std::{
    io::Write,
    path::Path,
    process::{Command, Stdio},
};

fn helper(input: &[u8]) -> std::process::Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_mlearn-desktop-ocr"))
        .arg("--raster-page")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    stdin.write_all(input).unwrap();
    drop(stdin);
    child.wait_with_output().unwrap()
}

#[test]
fn shipped_helper_rasterizes_pdf_and_crops_the_same_original_pixels() {
    let root = tempfile::tempdir().unwrap();
    let output = root.path().join("page.png");
    let location = json!({"sourceId":"fixture","contentRevision":"1","resourceId":"pdf:0",
        "path":Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/ocr/vision/image-only.pdf"),
        "mimeType":"application/pdf","pageIndex":0});
    let rendered = helper(
        &serde_json::to_vec(&json!({"operation":"pdf","location":location,"output":output}))
            .unwrap(),
    );
    assert!(
        rendered.status.success(),
        "{}",
        String::from_utf8_lossy(&rendered.stderr)
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&rendered.stdout).unwrap(),
        Value::Null
    );
    let original = image::open(output).unwrap().to_rgb8();
    let display = helper(
        &serde_json::to_vec(&json!({"operation":"display","location":location,
        "crop":{"x":0.25,"y":0.25,"width":0.5,"height":0.5}}))
        .unwrap(),
    );
    assert!(
        display.status.success(),
        "{}",
        String::from_utf8_lossy(&display.stderr)
    );
    let uri: String = serde_json::from_slice(&display.stdout).unwrap();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(uri.strip_prefix("data:image/png;base64,").unwrap())
        .unwrap();
    let crop = image::load_from_memory(&bytes).unwrap().to_rgb8();
    let rect = mlearn_desktop_ocr::raster::actual_crop(
        &mlearn_core::OcrRect {
            x: 0.25,
            y: 0.25,
            width: 0.5,
            height: 0.5,
        },
        original.width(),
        original.height(),
    )
    .unwrap();
    let expected = image::imageops::crop_imm(
        &original,
        (rect.x * f64::from(original.width())).round() as u32,
        (rect.y * f64::from(original.height())).round() as u32,
        (rect.width * f64::from(original.width())).round() as u32,
        (rect.height * f64::from(original.height())).round() as u32,
    )
    .to_image();
    assert_eq!(crop, expected);
}

#[test]
fn helper_rejects_oversized_requests_and_missing_pdf_pages_without_success() {
    let oversized = helper(&vec![b' '; 32769]);
    assert!(!oversized.status.success());
    assert!(oversized.stdout.is_empty());
    let missing = helper(br#"{"operation":"display","location":{"sourceId":"fixture","contentRevision":"1","resourceId":"pdf:0","path":"absent.pdf","mimeType":"application/pdf","pageIndex":null},"crop":null}"#);
    assert!(!missing.status.success());
    assert!(missing.stdout.is_empty());
    assert!(String::from_utf8_lossy(&missing.stderr).contains("page index"));
}
