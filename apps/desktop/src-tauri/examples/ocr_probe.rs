#[cfg(feature = "ocr-probe")]
fn main() -> Result<(), String> {
    if mlearn_desktop_ocr::worker::handle_process_mode() {
        return Ok(());
    }
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if !(args.len() == 3 || (args.len() == 4 && matches!(args[3].as_str(), "restore" | "generic")))
    {
        return Err("Usage: ocr_probe QA_ROOT FIXTURES TRUST_JSON [restore|generic]".into());
    }
    let trust: mlearn_runtime::catalog::CatalogTrust =
        serde_json::from_str(&std::fs::read_to_string(&args[2]).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if args.get(3).is_some_and(|s| s == "restore") {
        let root = std::path::absolute(&args[0]).map_err(|e| e.to_string())?;
        let started = std::time::Instant::now();
        let models = mlearn_runtime::native_ocr::NativeOcrModels::new(&root, Some(trust))?;
        let lease = models.admit("org.mlearn.paddle-manga.onnx.v1")?;
        let report = serde_json::json!({"elapsedMs":started.elapsed().as_secs_f64()*1000.0,"profileRevision":lease.installation().profile.revision()?});
        std::fs::write(
            root.join("native-resource-restore.json"),
            report.to_string(),
        )
        .map_err(|e| e.to_string())?;
        println!("NATIVE_RESOURCE_RESTORE_VERIFIED {report}");
        return Ok(());
    }
    let io = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;
    let root = std::path::absolute(&args[0]).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    for (name, width, height, striped) in [
        ("large-native.png", 3000, 1000, true),
        ("blank.png", 600, 300, false),
    ] {
        let path = root.join(name);
        if !path.exists() {
            image::RgbImage::from_fn(width, height, |x, _| {
                image::Rgb([if striped && x % 2 == 0 { 0 } else { 255 }; 3])
            })
            .save(path)
            .map_err(|e| e.to_string())?;
        }
    }
    let report = io.block_on(mlearn_desktop::ocr_probe::run(
        &root,
        std::path::Path::new(&args[1]),
        trust,
        args.get(3).is_some_and(|s| s == "generic"),
    ))?;
    // The same opt-in verifier runs on macOS and Windows, without Python fixture
    // preparation or a nominal assertion that a nonempty display is sufficient.
    use base64::Engine;
    let evidence: serde_json::Value = serde_json::from_slice(
        &std::fs::read(root.join("desktop-ocr-results.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let uri = evidence["nativePixelDisplayUri"]
        .as_str()
        .ok_or("Native-pixel display is missing")?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(
            uri.strip_prefix("data:image/png;base64,")
                .ok_or("Native-pixel display is not PNG")?,
        )
        .map_err(|e| e.to_string())?;
    let actual = image::load_from_memory(&bytes)
        .map_err(|e| e.to_string())?
        .to_rgb8();
    let original = image::open(root.join("large-native.png"))
        .map_err(|e| e.to_string())?
        .to_rgb8();
    let expected = image::imageops::crop_imm(&original, 2250, 250, 375, 250).to_image();
    if actual != expected {
        return Err("Magnifier is not an exact crop of original source pixels".into());
    }
    actual
        .save(root.join("native-pixel-display.png"))
        .map_err(|e| e.to_string())?;
    println!("NATIVE_PIXELS_VERIFIED 375x250 exact=true");
    println!("DESKTOP_OCR_VERIFIED {report}");
    Ok(())
}
#[cfg(not(feature = "ocr-probe"))]
fn main() {
    eprintln!("Build this standalone verifier with --features ocr-probe.");
    std::process::exit(1);
}
